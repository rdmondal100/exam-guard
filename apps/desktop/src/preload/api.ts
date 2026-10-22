import type {
  AppInfo,
  AppMode,
  DiscoveredHost,
  JoinAttempt,
  JoinConfirmResult,
  JoinResult,
  ProbeRequest,
  ProbeResult,
  RunRequest,
  RunResult,
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
  /** Student mode: compile and run code on this PC (one at a time). Resolves when it ends. */
  runCode(request: RunRequest): Promise<RunResult>;
  /** Stops the current run, if any. */
  stopRun(): Promise<void>;
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
