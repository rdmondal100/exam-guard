import { useEffect, useState } from 'react';
import type { TeacherMessageToStudent } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { clockTime } from '@/lib/terminalLog';
import { queueMessage } from '@/lib/teacherMessages';

/**
 * Teacher messages and warnings (M35) as popups, one at a time and oldest first, above everything
 * else (also the lock screen). The student closes each with OK.
 */
export function TeacherMessagePopup() {
  const [queue, setQueue] = useState<TeacherMessageToStudent[]>([]);

  useEffect(
    () => window.examguard.onTeacherMessage((message) => setQueue((q) => queueMessage(q, message))),
    [],
  );

  const current = queue[0];
  if (!current) return null;
  const warning = current.kind === 'warning';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="teacher-message-title"
        aria-describedby="teacher-message-text"
        className={`flex w-full max-w-md flex-col gap-3 rounded-lg border-2 bg-card p-5 shadow-xl ${
          warning ? 'border-red-600' : 'border-blue-600'
        }`}
      >
        <h2
          id="teacher-message-title"
          className={`text-xl font-semibold ${warning ? 'text-red-700' : 'text-blue-800'}`}
        >
          {warning ? 'Warning from your teacher' : 'Message from your teacher'}
        </h2>
        <p id="teacher-message-text" className="whitespace-pre-wrap break-words text-lg">
          {current.text}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">
            {clockTime(current.sentAt)}
            {queue.length > 1 ? ` · ${queue.length - 1} more` : ''}
          </span>
          <Button className="ml-auto" autoFocus onClick={() => setQueue((q) => q.slice(1))}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
