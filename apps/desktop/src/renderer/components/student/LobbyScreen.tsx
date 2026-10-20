import { useEffect, useState } from 'react';
import type { SessionStatus } from '@examguard/shared';

interface Props {
  name: string;
  examTitle: string;
}

const LINK_TEXT: Record<SessionStatus['link'], string> = {
  connecting: 'Connecting to the teacher…',
  connected: 'Connected',
  reconnecting: 'Connection lost. Trying again…',
  failed: 'Disconnected',
};

const REASON_TEXT: Record<string, string> = {
  replaced: 'This student signed in on another window or computer.',
  unauthorized: 'Your sign-in expired. Close ExamGuard and join again.',
  protocol_mismatch: "Update ExamGuard to match the teacher's version.",
  fingerprint_mismatch: 'This computer is not the teacher you checked. Tell your invigilator.',
};

/** The lobby: opens the live session and shows its state while the teacher has not started. */
export function LobbyScreen({ name, examTitle }: Props) {
  const [status, setStatus] = useState<SessionStatus>({ link: 'connecting', offsetMs: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = window.examguard.onSessionStatus(setStatus);
    window.examguard.startSession().catch(() => setError('Could not start the live connection.'));
    return off;
  }, []);

  const tone =
    status.link === 'connected'
      ? 'bg-green-100 text-green-900'
      : status.link === 'failed'
        ? 'bg-red-100 text-red-900'
        : 'bg-amber-100 text-amber-900';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-8">
      <h1 className="text-3xl font-semibold">You are in</h1>
      <p className="text-lg">{name}</p>
      <p className="text-muted">{examTitle}</p>
      <p role="status" className={`w-fit rounded-md px-3 py-1 text-sm ${tone}`}>
        {LINK_TEXT[status.link]}
      </p>
      {(status.reason || error) && (
        <p role="alert" className="text-sm text-red-700">
          {error ?? REASON_TEXT[status.reason ?? ''] ?? 'The connection was closed.'}
        </p>
      )}
      <p className="text-sm text-muted">Waiting for the teacher to start the exam.</p>
    </main>
  );
}
