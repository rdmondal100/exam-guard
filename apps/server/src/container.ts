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
import { AnswerWriter } from './services/answers/answer-writer.js';
import { AuthState } from './services/auth/auth-state.js';
import { LoginLimiter } from './services/auth/login-limiter.js';
import { ExamFileService } from './services/exam-files/exam-file-service.js';
import { ExamFileStore } from './services/exam-files/exam-file-store.js';
import { StudentDeadlines } from './services/exams/student-deadlines.js';
import { ConnectionEvents } from './services/hosting/connection-events.js';
import { HostingManager, type HostingManagerDeps } from './services/hosting/hosting-manager.js';
import { ScreenshotStore } from './services/screenshots/screenshot-store.js';
import { SubmissionService } from './services/submissions/submission-service.js';
import { SessionHub } from './sockets/sessionHub.js';

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
  > & {
    /** How long a student may be offline before `network_lost`; tests shorten it. */
    networkGraceMs?: number;
  };
}

/** The live hosting parts, present when `hosting` options and an exam-files folder exist. */
export interface Live {
  hosting: HostingManager;
  hub: SessionHub;
  connections: ConnectionEvents;
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
  terminalLogs: TerminalLogRepo;
  answers: AnswerRepo;
  examFiles?: ExamFileService;
  screenshots?: ScreenshotStore;
  live?: Live;
}

export function createContainer({ db, now, filesDir, hosting }: ContainerOptions): Container {
  const exams = new ExamRepo(db);
  const questions = new QuestionRepo(db);
  const students = new ExamStudentRepo(db);
  const events = new EventRepo(db);
  const terminalLogs = new TerminalLogRepo(db);
  const answers = new AnswerRepo(db);
  const examFilesDir = filesDir ?? (hosting && join(hosting.dataDir, 'exam-files'));
  const examFiles = examFilesDir
    ? new ExamFileService(new ExamFileRepo(db), new ExamFileStore(examFilesDir))
    : undefined;
  const screenshots = hosting && new ScreenshotStore(hosting.dataDir);

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
    terminalLogs,
    answers,
    ...(examFiles ? { examFiles } : {}),
    ...(screenshots ? { screenshots } : {}),
  };
  if (!hosting || !examFiles) return container;

  const { networkGraceMs, ...managerOptions } = hosting;
  const connections = new ConnectionEvents({
    students,
    exams,
    events,
    now,
    ...(networkGraceMs === undefined ? {} : { graceMs: networkGraceMs }),
  });
  const hub = new SessionHub({
    students,
    now,
    onConnection: (id, connected) => connections.onConnection(id, connected),
  });
  const answerWriter = new AnswerWriter(answers, {
    onRejected: (row, error) =>
      console.warn(
        `answer save ${row.clientSeq} refused: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });
  const finals = new FinalAnswerRepo(db);
  const manager = new HostingManager({
    connections,
    exams,
    questions,
    students,
    events,
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
    actions: new TeacherActionRepo(db),
    examFiles,
    hub,
    now,
    ...managerOptions,
  });
  container.live = { hosting: manager, hub, connections };
  return container;
}
