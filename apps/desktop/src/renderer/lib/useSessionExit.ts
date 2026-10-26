import { useEffect, useState } from 'react';
import {
  sessionExit,
  type SessionExit,
  type SessionState,
  type SessionStatus,
} from '@examguard/shared';

/**
 * Whether the exam window is over for this student although the server could not say so (see
 * `sessionExit`). Ticks once a second only while the exam is open and the link is not up.
 */
export function useSessionExit(
  exam: SessionState | null,
  status: SessionStatus,
  examOpen: boolean,
): SessionExit | null {
  const [now, setNow] = useState(() => Date.now());
  const ticking = examOpen && status.link !== 'connected';
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return examOpen && exam ? sessionExit(exam, status, now) : null;
}
