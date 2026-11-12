import type { LivePageMessage, LiveStart, RtcSignalData } from '@examguard/shared';

/** What the hidden live view capture page may call (`window.examguardLive`, M34). */
export interface ExamGuardLiveApi {
  onStart(listener: (start: LiveStart & { sourceId: string }) => void): void;
  onSignal(listener: (data: RtcSignalData) => void): void;
  send(message: LivePageMessage): void;
}
