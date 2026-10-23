import type {
  AnswerSaveRequest,
  AnswerStatus,
  AppInfo,
  AppMode,
  DiscoveredHost,
  ExamFilesStatus,
  FileCreateRequest,
  FileReadResult,
  FileRenameRequest,
  FileWriteRequest,
  FilesList,
  FilesListRequest,
  FilesResult,
  JoinAttempt,
  JoinConfirmResult,
  JoinResult,
  ProbeRequest,
  ProbeResult,
  RunRequestInput,
  RunResult,
  RunSize,
  ServerConnection,
  ServerStatus,
  SessionState,
  SessionStatus,
  TerminalExit,
  TerminalOpenResult,
  TerminalSize,
  TerminalStatus,
} from '@examguard/shared';

/** The only surface the renderer gets: `window.examguard`. */
export interface ExamGuardApi {
  getInfo(): Promise<AppInfo>;
  setMode(mode: AppMode): Promise<AppInfo>;
  /** Teacher mode only. `null` while the server has not started. */
  getServerConnection(): Promise<ServerConnection | null>;
  getServerStatus(): Promise<ServerStatus>;
  /** Returns an unsubscribe function. */
  onServerStatus(listener: (status: ServerStatus) => void): () => void;
  /** Student mode: start browsing for teachers over mDNS. Returns the hosts known so far. */
  startDiscovery(): Promise<DiscoveredHost[]>;
  stopDiscovery(): Promise<void>;
  /** Returns an unsubscribe function. */
  onDiscoveryHosts(listener: (hosts: DiscoveredHost[]) => void): () => void;
  /** Contacts a host (mDNS or manual IP), pins its cert and reads its info. */
  probeHost(request: ProbeRequest): Promise<ProbeResult>;
  /** Student mode: join the pinned host. The session token stays in main. */
  joinExam(attempt: JoinAttempt): Promise<JoinResult>;
  /** Student mode: the monitoring notice was accepted. */
  confirmJoin(): Promise<JoinConfirmResult>;
  /** Student mode: open the live session socket after the notice. Status arrives below. */
  startSession(): Promise<void>;
  /** Returns an unsubscribe function. */
  onSessionStatus(listener: (status: SessionStatus) => void): () => void;
  /** Exam state (state, deadline, questions) after each welcome and push. Returns an unsubscribe. */
  onSessionExam(listener: (state: SessionState) => void): () => void;
  /** Student mode: autosave one answer buffer. Main numbers it and re-sends it until the server acks. */
  saveAnswer(request: AnswerSaveRequest): Promise<void>;
  /** How many saves wait for the server. Returns an unsubscribe function. */
  onAnswerStatus(listener: (status: AnswerStatus) => void): () => void;
  /** Student mode: compile and run code on this PC (one at a time). Resolves when it ends. */
  runCode(request: RunRequestInput): Promise<RunResult>;
  /** Stops the current run, if any. */
  stopRun(): Promise<void>;
  /** Keystrokes for the running program of an interactive run. */
  runInput(data: string): void;
  resizeRun(size: RunSize): void;
  /** Output of an interactive run, as it is produced. Returns an unsubscribe function. */
  onRunData(listener: (data: string) => void): () => void;
  /** Student mode: the project folder (the exam workspace). A call can be refused with a message. */
  filesList(request: FilesListRequest): Promise<FilesResult<FilesList>>;
  filesRead(path: string): Promise<FilesResult<FileReadResult>>;
  filesWrite(request: FileWriteRequest): Promise<FilesResult<null>>;
  filesCreate(request: FileCreateRequest): Promise<FilesResult<null>>;
  filesRename(request: FileRenameRequest): Promise<FilesResult<null>>;
  filesRemove(path: string): Promise<FilesResult<null>>;
  /** Student mode: how the download of the teacher's exam files is going. */
  examFilesStatus(): Promise<ExamFilesStatus>;
  /** Tries the failed downloads again. */
  retryExamFiles(): Promise<void>;
  /** Returns an unsubscribe function. */
  onExamFilesStatus(listener: (status: ExamFilesStatus) => void): () => void;
  /** Student mode: may the exam terminal open now, and is one already running. */
  terminalStatus(): Promise<TerminalStatus>;
  /** Starts the exam terminal (or resizes the one already running). */
  openTerminal(size: TerminalSize): Promise<TerminalOpenResult>;
  /** Keystrokes and pasted text for the shell. */
  terminalInput(data: string): void;
  resizeTerminal(size: TerminalSize): void;
  /** Kills the shell and everything started from it. */
  closeTerminal(): Promise<void>;
  /** Shell output. Returns an unsubscribe function. */
  onTerminalData(listener: (data: string) => void): () => void;
  /** The shell ended or was closed. Returns an unsubscribe function. */
  onTerminalExit(listener: (exit: TerminalExit) => void): () => void;
}
