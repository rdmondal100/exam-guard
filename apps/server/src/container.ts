import { join } from 'node:path';
import type { Db } from './db/connectDb.js';
import { AnswerRepo } from './db/repositories/answer.repo.js';
import { ClassListRepo } from './db/repositories/classList.repo.js';
import { EventRepo } from './db/repositories/event.repo.js';
import { ExamRepo } from './db/repositories/exam.repo.js';
import { ExamFileRepo } from './db/repositories/examFile.repo.js';
import { ExamStudentRepo } from './db/repositories/examStudent.repo.js';
import { FinalAnswerRepo } from './db/repositories/finalAnswer.repo.js';
import { QuestionRepo } from './db/repositories/question.repo.js';
import { TeacherRepo } from './db/repositories/teacher.repo.js';
import { TeacherActionRepo } from './db/repositories/teacherAction.repo.js';
import { TerminalRepo } from './db/repositories/terminal.repo.js';
import { TerminalLogRepo } from './db/repositories/terminalLog.repo.js';
import { AnswerGradeRepo } from './db/repositories/answerGrade.repo.js';
import { EvaluationRepo } from './db/repositories/evaluation.repo.js';
import { GradingJobRepo } from './db/repositories/gradingJob.repo.js';
import { ReevaluateQueueRepo } from './db/repositories/reevaluateQueue.repo.js';
import { AnswerWriter } from './services/answers/answer-writer.js';
import { AuthState } from './services/auth/auth-state.js';
import { LoginLimiter } from './services/auth/login-limiter.js';
import { ExamFileService } from './services/exam-files/exam-file-service.js';
import { ExamFileStore } from './services/exam-files/exam-file-store.js';
import { EventRecorder } from './services/events/event-recorder.js';
import { StudentDeadlines } from './services/exams/student-deadlines.js';
import { ConnectionEvents } from './services/hosting/connection-events.js';
import { HostingManager, type HostingManagerDeps } from './services/hosting/hosting-manager.js';
import { GradingService, type GradingServiceDeps } from './services/grading/grading-service.js';
import { geminiSource } from './services/grading/provider-source.js';
import { ReviewService } from './services/grading/review-service.js';
import { ResultsService } from './services/results/results-service.js';
import { ResultsRepo } from './db/repositories/results.repo.js';
import { SettingsRepo } from './db/repositories/settings.repo.js';
import { MaintenanceService } from './services/settings/maintenance-service.js';
import { SettingsService } from './services/settings/settings-service.js';
import { ScreenshotRetention } from './services/screenshots/screenshot-retention.js';
import { ScreenshotStore } from './services/screenshots/screenshot-store.js';
import { SubmissionService } from './services/submissions/submission-service.js';
import { SessionHub } from './sockets/sessionHub.js';
import { ThumbRelay } from './sockets/thumbRelay.js';

export interface ContainerOptions {
  db: Db;
  /** Clock for the login rate limiter and the teacher row; tests inject a fake. */
  now?: () => number;
  /** Where the teacher's exam files are kept. Defaults to `exam-files` in the hosting data folder. */
  filesDir?: string;
  /** Student listener settings. Without it there is no hosting, roster, actions or teacher WS. */
  hosting?: Omit<
    HostingManagerDeps,
    | 'exams'
    | 'questions'
    | 'students'
    | 'events'
    | 'recorder'
    | 'terminals'
    | 'terminalLogs'
    | 'answers'
    | 'answerWriter'
    | 'finals'
    | 'deadlines'
    | 'submissions'
    | 'actions'
    | 'examFiles'
    | 'hub'
    | 'connections'
    | 'thumbs'
    | 'settings'
  > & {
    /** How long a student may be offline before `network_lost`; tests shorten it. */
    networkGraceMs?: number;
  };
  /** The grader and pipeline settings (M38). Without it, grading asks for a Gemini key and gets none. */
  grading?: Partial<
    Pick<GradingServiceDeps, 'source' | 'concurrency' | 'backoffMs' | 'progressMs'>
  > & {
    /** Asks main for the AI key (Gemini with the Settings model) when there is no `source`. */
    getKey?: () => Promise<string | null>;
  };
  /** The app data folder for backups and exports (M42). Defaults to the hosting data folder. */
  dataDir?: string;
}

/** The live hosting parts, present when `hosting` options and an exam-files folder exist. */
export interface Live {
  hosting: HostingManager;
  hub: SessionHub;
  connections: ConnectionEvents;
  /** Grid thumbnails: who streams, the latest frame per student, the counters (M29, M33). */
  thumbs: ThumbRelay;
}

/** Every repository and service of the teacher server, built once from the database. */
export interface Container {
  now?: () => number;
  state: AuthState;
  teacher: TeacherRepo;
  limiter: LoginLimiter;
  classLists: ClassListRepo;
  exams: ExamRepo;
  questions: QuestionRepo;
  students: ExamStudentRepo;
  events: EventRepo;
  /** Classifies and stores events, adds risk points, announces them (M31). */
  recorder: EventRecorder;
  terminalLogs: TerminalLogRepo;
  answers: AnswerRepo;
  /** The audit log of teacher actions (M36 view). */
  actions: TeacherActionRepo;
  examFiles?: ExamFileService;
  screenshots?: ScreenshotStore;
  /** AI grading (M38). */
  grading: GradingService;
  /** Review, accept and edit (M39, M40). */
  review: ReviewService;
  /** Finalize and the CSV export (M42). */
  results: ResultsService;
  /** The teacher's settings, backup and certificate (M43). */
  settings: SettingsService;
  maintenance: MaintenanceService;
  /** Screenshot retention (M44); present with a data folder. */
  retention?: ScreenshotRetention;
  live?: Live;
}

export function createContainer({
  db,
  now,
  filesDir,
  hosting,
  grading: gradingOptions,
  dataDir,
}: ContainerOptions): Container {
  const exams = new ExamRepo(db);
  const questions = new QuestionRepo(db);
  const students = new ExamStudentRepo(db);
  const events = new EventRepo(db);
  const recorder = new EventRecorder({ events, students, exams });
  const terminalLogs = new TerminalLogRepo(db);
  const answers = new AnswerRepo(db);
  const actions = new TeacherActionRepo(db);
  const examFilesDir = filesDir ?? (hosting && join(hosting.dataDir, 'exam-files'));
  const examFiles = examFilesDir
    ? new ExamFileService(new ExamFileRepo(db), new ExamFileStore(examFilesDir))
    : undefined;
  const screenshots = hosting && new ScreenshotStore(hosting.dataDir);
  const finals = new FinalAnswerRepo(db);
  const grades = new AnswerGradeRepo(db);
  const evaluations = new EvaluationRepo(db);
  // The hub exists only with hosting; progress is pushed once it is built (below).
  let pushProgress: GradingServiceDeps['onProgress'] = undefined;
  const settings = new SettingsService(new SettingsRepo(db));
  const jobs = new GradingJobRepo(db);
  const resultsDir = dataDir ?? hosting?.dataDir;
  const retention =
    resultsDir &&
    new ScreenshotRetention({
      events,
      store: screenshots ?? new ScreenshotStore(resultsDir),
      days: () => settings.get().retention.screenshotDays,
      ...(now ? { now } : {}),
    });
  const { getKey, ...pipelineOptions } = gradingOptions ?? {};
  const grading = new GradingService({
    exams,
    questions,
    jobs,
    grades,
    evaluations,
    queue: new ReevaluateQueueRepo(db),
    source: geminiSource(getKey ?? (() => Promise.resolve(null)), () => settings.get().ai.model),
    concurrencyOf: () => settings.get().grading.concurrency,
    ...pipelineOptions,
    ...(now ? { now } : {}),
    onProgress: (status) => pushProgress?.(status),
  });
  const review = new ReviewService({
    exams,
    questions,
    students,
    finals,
    grades,
    evaluations,
    ...(now ? { now } : {}),
  });
  const results = new ResultsService({
    db,
    exams,
    questions,
    grades,
    results: new ResultsRepo(db),
    actions,
    ...(resultsDir ? { dataDir: resultsDir } : {}),
    ...(now ? { now } : {}),
  });

  const container: Container = {
    now,
    state: new AuthState(),
    teacher: new TeacherRepo(db),
    limiter: new LoginLimiter(now),
    classLists: new ClassListRepo(db),
    exams,
    questions,
    students,
    events,
    recorder,
    terminalLogs,
    answers,
    actions,
    ...(examFiles ? { examFiles } : {}),
    ...(screenshots ? { screenshots } : {}),
    grading,
    review,
    results,
    settings,
    ...(retention ? { retention } : {}),
    maintenance: new MaintenanceService({
      db,
      exams,
      jobs,
      ...(resultsDir ? { dataDir: resultsDir } : {}),
      ...(now ? { now } : {}),
    }),
  };
  if (!hosting || !examFiles) return container;

  const { networkGraceMs, ...managerOptions } = hosting;
  const connections = new ConnectionEvents({
    students,
    exams,
    events,
    recorder,
    now,
    ...(networkGraceMs === undefined ? {} : { graceMs: networkGraceMs }),
  });
  // Built before the hub it reads from; it only calls the hub later, on socket traffic.
  let thumbs: ThumbRelay | null = null;
  const hub = new SessionHub({
    students,
    now,
    onConnection: (id, connected) => {
      connections.onConnection(id, connected);
      if (!connected) thumbs?.onDisconnect(id);
    },
  });
  thumbs = new ThumbRelay({ students: hub, ...(now ? { now } : {}) });
  // Live alert feed and the roster's risk score (M31).
  recorder.onStored((stored) => hub.eventStored(stored));
  const answerWriter = new AnswerWriter(answers, {
    onRejected: (row, error) =>
      console.warn(
        `answer save ${row.clientSeq} refused: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });
  pushProgress = (status) => hub.toExam(status.examId, { t: 'grading.progress', status });
  const manager = new HostingManager({
    connections,
    exams,
    questions,
    students,
    events,
    recorder,
    terminals: new TerminalRepo(db),
    terminalLogs,
    answers,
    answerWriter,
    finals,
    deadlines: new StudentDeadlines(exams, students),
    submissions: new SubmissionService({
      exams,
      students,
      questions,
      answers,
      finals,
      writer: answerWriter,
      hub,
      now: now ?? Date.now,
    }),
    actions,
    examFiles,
    hub,
    thumbs,
    now,
    settings: () => settings.get(),
    ...managerOptions,
  });
  container.live = { hosting: manager, hub, connections, thumbs };
  return container;
}
