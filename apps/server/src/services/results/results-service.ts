import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportResult, FinalizeResult } from '@examguard/shared';
import type { Db } from '../../db/connectDb.js';
import type { AnswerGradeRepo } from '../../db/repositories/answerGrade.repo.js';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { QuestionRepo } from '../../db/repositories/question.repo.js';
import type { ResultsRepo } from '../../db/repositories/results.repo.js';
import type { TeacherActionRepo } from '../../db/repositories/teacherAction.repo.js';
import { ApiError } from '../../utils/ApiError.js';
import { backupData } from './backup.js';
import { buildResultsCsv, exportFileName } from './results-csv.js';

export interface ResultsServiceDeps {
  db: Db;
  exams: ExamRepo;
  questions: QuestionRepo;
  grades: AnswerGradeRepo;
  results: ResultsRepo;
  actions: TeacherActionRepo;
  /** The app data folder (`backups/`, `exports/`). Without it finalize and export are refused. */
  dataDir?: string;
  now?: () => number;
}

/**
 * Finalize and the CSV export (M42). Finalize needs every answer graded (no `pending` or
 * `needs_manual`), takes a backup first and then locks the marks: review, re-evaluate and
 * grading refuse a finalized exam. The export is built only from a finalized exam.
 */
export class ResultsService {
  private readonly now: () => number;

  constructor(private readonly deps: ResultsServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  async finalize(examId: string): Promise<FinalizeResult> {
    const dataDir = this.requireDataDir();
    this.checkReady(examId);
    const backup = await backupData(this.deps.db, dataDir, new Date(this.now()));
    const now = this.now();
    this.deps.exams.transaction(() => {
      // Checked again: the teacher could have started a grading run during the backup.
      this.checkReady(examId);
      if (!this.deps.exams.finalize(examId, now)) {
        throw new ApiError(409, 'invalid_state', 'Only an exam in review can be finalized');
      }
      this.deps.actions.insert({
        examId,
        examStudentId: null,
        action: 'finalize',
        payload: { backup },
        ts: now,
      });
    });
    return { examId, examState: 'finalized', finalizedAt: now, backup };
  }

  /** The results CSV of a finalized exam, with a BOM for Excel. */
  csv(examId: string): { fileName: string; text: string; rows: number } {
    const exam = this.deps.exams.get(examId);
    if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
    if (exam.state !== 'finalized') {
      throw new ApiError(409, 'not_finalized', 'Finalize the exam before exporting the results');
    }
    const rows = this.deps.results.rows(examId);
    return {
      fileName: exportFileName(exam.title, new Date(this.now())),
      text: buildResultsCsv(this.deps.questions.list(examId), rows),
      rows: rows.length,
    };
  }

  /** Writes the CSV to `exports/` in the data folder. */
  async exportCsv(examId: string): Promise<ExportResult> {
    const dataDir = this.requireDataDir();
    const { fileName, text, rows } = this.csv(examId);
    const dir = join(dataDir, 'exports');
    await mkdir(dir, { recursive: true });
    const path = join(dir, fileName);
    await writeFile(path, text, 'utf8');
    return { fileName, path, rows };
  }

  private checkReady(examId: string): void {
    const exam = this.deps.exams.get(examId);
    if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
    if (exam.state !== 'in_review') {
      throw new ApiError(
        409,
        'invalid_state',
        exam.state === 'finalized'
          ? 'The exam is already finalized'
          : 'Only an exam in review can be finalized',
      );
    }
    const counts = this.deps.grades.counts(examId);
    const pending = counts.reduce((n, q) => n + q.pending, 0);
    const needsManual = counts.reduce((n, q) => n + q.needsManual, 0);
    if (pending + needsManual > 0) {
      throw new ApiError(
        409,
        'not_ready',
        'Every answer needs a grade before finalizing: grade the pending answers and the ones that need manual grading.',
        { pending, needsManual },
      );
    }
  }

  private requireDataDir(): string {
    if (!this.deps.dataDir) throw new ApiError(503, 'no_data_dir', 'The data folder is not set');
    return this.deps.dataDir;
  }
}
