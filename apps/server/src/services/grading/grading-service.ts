import type { GradingStatus, Question, ReevaluateBody } from '@examguard/shared';
import type { AnswerGradeRepo } from '../../db/repositories/answerGrade.repo.js';
import type { EvaluationRepo } from '../../db/repositories/evaluation.repo.js';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { GradingJobRepo, JobRecord } from '../../db/repositories/gradingJob.repo.js';
import type { QuestionRepo } from '../../db/repositories/question.repo.js';
import type { ReevaluateQueueRepo } from '../../db/repositories/reevaluateQueue.repo.js';
import { newId } from '../../utils/ids.js';
import { canTransition } from '../exams/exam-state.js';
import { GradingAuthError, gradeAnswer } from './grade-answer.js';
import { runPool } from './pool.js';
import { PROMPT_VERSION } from './prompt.js';
import type { GradingProvider } from './provider.js';
import { GradingError, type ProviderSource } from './provider-source.js';
import { queueReevaluation } from './reevaluate.js';
import { abortableSleep } from './sleep.js';

export const DEFAULT_CONCURRENCY = 4;

export interface GradingServiceDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  jobs: GradingJobRepo;
  grades: AnswerGradeRepo;
  evaluations: EvaluationRepo;
  /** Answers queued for a re-evaluation (M41). */
  queue: ReevaluateQueueRepo;
  source: ProviderSource;
  now?: () => number;
  concurrency?: number;
  /** Tests pass a 0 backoff. */
  backoffMs?: number;
  /** Pushed as `grading.progress`, at most once per `progressMs` per exam. */
  onProgress?: (status: GradingStatus) => void;
  progressMs?: number;
}

/**
 * "Evaluate with AI" (M38, docs/architecture.md §7): one job per question, run question by question;
 * inside a job the answers go through a pool of `concurrency`. Ended → Grading → In review. Jobs
 * live in the database, so a restarted server resumes them (`resume`).
 */
export class GradingService {
  private readonly now: () => number;
  /** One run per exam; a new run waits for the previous one to wind down. */
  private readonly runs = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly progressTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: GradingServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  status(examId: string): GradingStatus | undefined {
    const exam = this.deps.exams.get(examId);
    if (!exam) return undefined;
    return {
      examId,
      examState: exam.state,
      provider: this.deps.source.id,
      jobs: this.deps.jobs.latestPerQuestion(examId),
      questions: this.deps.grades.counts(examId),
    };
  }

  /**
   * Grades every answer of the chosen questions that is `pending` or `needs_manual`. From `ended`
   * this is the first run; from `in_review` it retries what is left.
   */
  async start(examId: string, questionIds?: readonly string[]): Promise<GradingStatus> {
    const { exams, questions, jobs, grades } = this.deps;
    const exam = exams.get(examId);
    if (!exam) throw new GradingError(404, 'not_found', 'Exam not found');
    if (!canTransition(exam.state, 'grading')) {
      throw new GradingError(409, 'invalid_state', `A ${exam.state} exam cannot be graded`);
    }
    const all = questions.list(examId);
    const unknown = questionIds?.filter((id) => !all.some((q) => q.id === id)) ?? [];
    if (unknown.length > 0) throw new GradingError(400, 'unknown_question', 'Unknown question');
    const chosen = questionIds ? all.filter((q) => questionIds.includes(q.id)) : all;
    const provider = await this.deps.source.create();

    const now = this.now();
    let created = 0;
    exams.transaction(() => {
      for (const q of chosen) {
        const scope = grades.queueAnswers(q.id, ['pending', 'needs_manual'], now);
        if (scope.length === 0) continue;
        jobs.insert({
          id: newId(now),
          examId,
          questionId: q.id,
          kind: 'initial',
          instruction: null,
          scope,
          position: q.position,
          provider: provider.id,
          model: provider.model,
          promptVersion: PROMPT_VERSION,
          now,
        });
        created += 1;
      }
      if (created > 0) exams.setState(examId, 'grading', now);
    });
    if (created === 0) {
      throw new GradingError(409, 'nothing_to_grade', 'Every answer is already graded');
    }
    this.launch(examId, provider);
    return this.requireStatus(examId);
  }

  /** Grades one question again with the teacher's instruction (M41, `reevaluate.ts`). */
  async reevaluate(examId: string, body: ReevaluateBody): Promise<GradingStatus> {
    const provider = await this.deps.source.create();
    queueReevaluation(this.deps, examId, body, provider, this.now());
    this.launch(examId, provider);
    return this.requireStatus(examId);
  }

  /**
   * Stops the exam's grading. Answers not graded yet stay `pending`; answers queued for a
   * re-evaluation keep their grade.
   */
  cancel(examId: string): GradingStatus {
    const status = this.status(examId);
    if (!status) throw new GradingError(404, 'not_found', 'Exam not found');
    if (status.examState !== 'grading') {
      throw new GradingError(409, 'invalid_state', 'The exam is not being graded');
    }
    this.deps.jobs.cancelExam(examId, this.now());
    this.aborts.get(examId)?.abort(new Error('cancelled'));
    this.finishIfIdle(examId);
    return this.requireStatus(examId);
  }

  /** After a restart: runs the unfinished jobs again, and closes grading that has none left. */
  async resume(): Promise<void> {
    const examIds = new Set(this.deps.jobs.unfinished().map((j) => j.examId));
    for (const exam of this.deps.exams.list()) {
      if (exam.state === 'grading' && !examIds.has(exam.id)) this.finishIfIdle(exam.id);
    }
    for (const examId of examIds) {
      try {
        this.launch(examId, await this.deps.source.create());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const job of this.deps.jobs.unfinished(examId)) {
          this.deps.jobs.setState(job.id, 'failed', this.now(), message);
        }
        this.finishIfIdle(examId);
      }
    }
  }

  /** Resolves once the exam's current run has finished (tests). */
  async idle(examId: string): Promise<void> {
    await this.runs.get(examId);
  }

  dispose(): void {
    for (const controller of this.aborts.values()) controller.abort(new Error('shutdown'));
    for (const timer of this.progressTimers.values()) clearTimeout(timer);
    this.progressTimers.clear();
  }

  private launch(examId: string, provider: GradingProvider): void {
    const previous = this.runs.get(examId) ?? Promise.resolve();
    const run = previous
      .then(() => this.run(examId, provider))
      .catch((err: unknown) => {
        console.error(
          `grading ${examId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    this.runs.set(examId, run);
  }

  private async run(examId: string, provider: GradingProvider): Promise<void> {
    const controller = new AbortController();
    this.aborts.set(examId, controller);
    try {
      for (;;) {
        const job = this.deps.jobs.unfinished(examId)[0];
        if (!job || controller.signal.aborted) break;
        const question = this.deps.questions.get(job.questionId);
        if (!question) {
          this.deps.jobs.setState(job.id, 'failed', this.now(), 'The question was deleted');
          continue;
        }
        const stop = await this.runJob(job, question, provider, controller.signal);
        if (stop) {
          for (const rest of this.deps.jobs.unfinished(examId)) {
            this.deps.jobs.setState(rest.id, 'failed', this.now(), stop);
          }
          break;
        }
      }
    } finally {
      if (this.aborts.get(examId) === controller) this.aborts.delete(examId);
      this.finishIfIdle(examId);
    }
  }

  /** Grades one job's pending answers. Returns why the whole run must stop, if it must. */
  private async runJob(
    job: JobRecord,
    question: Question,
    provider: GradingProvider,
    signal: AbortSignal,
  ): Promise<string | null> {
    const { jobs, grades, evaluations } = this.deps;
    jobs.setState(job.id, 'running', this.now());
    this.progress(job.examId, true);
    const answers =
      job.kind === 'reevaluate'
        ? this.deps.queue.answers(job.id)
        : grades.pendingAnswers(question.id, job.scope);
    const deps = {
      provider,
      evaluations,
      grades,
      now: this.now,
      sleep: abortableSleep,
      ...(this.deps.backoffMs === undefined ? {} : { backoffMs: this.deps.backoffMs }),
    };
    try {
      await runPool(
        answers,
        this.deps.concurrency ?? DEFAULT_CONCURRENCY,
        async (answer) => {
          try {
            const outcome = await gradeAnswer(deps, job, question, answer, signal);
            jobs.countAnswer(job.id, outcome === 'graded');
          } catch (err) {
            if (signal.aborted) return;
            throw err;
          }
          this.progress(job.examId);
        },
        signal,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jobs.setState(job.id, 'failed', this.now(), message);
      return err instanceof GradingAuthError ? `The grading key was refused: ${message}` : message;
    }
    // Cancelled: the job is already `cancelled`. Shut down: it stays `running` for `resume`.
    if (signal.aborted) return null;
    if (jobs.get(job.id)?.state === 'running') jobs.setState(job.id, 'done', this.now());
    this.progress(job.examId, true);
    return null;
  }

  /** Grading → In review once nothing is queued or running. */
  private finishIfIdle(examId: string): void {
    this.deps.queue.release(examId);
    const exam = this.deps.exams.get(examId);
    if (exam?.state === 'grading' && this.deps.jobs.unfinished(examId).length === 0) {
      this.deps.exams.setState(examId, 'in_review', this.now());
    }
    this.progress(examId, true);
  }

  private progress(examId: string, now = false): void {
    const { onProgress } = this.deps;
    if (!onProgress) return;
    const send = () => {
      this.progressTimers.delete(examId);
      const status = this.status(examId);
      if (status) onProgress(status);
    };
    if (now) {
      clearTimeout(this.progressTimers.get(examId));
      return send();
    }
    if (this.progressTimers.has(examId)) return;
    this.progressTimers.set(examId, setTimeout(send, this.deps.progressMs ?? 250));
  }

  private requireStatus(examId: string): GradingStatus {
    const status = this.status(examId);
    if (!status) throw new GradingError(404, 'not_found', 'Exam not found');
    return status;
  }
}
