import type { RosterEntry } from '@examguard/shared';
import { formatDuration } from '@/lib/eventsView';

interface Props {
  students: RosterEntry[];
  /** Shows a "Terminal" button per student that opens their terminal log. */
  onTerminalLog?: (student: RosterEntry) => void;
  /** Shows an "Unlock" button for a locked student (M24: their monitoring agent was lost). */
  onUnlock?: (student: RosterEntry) => void;
}

/** Joined students: name, code, state and whether their socket is up. */
export function RosterList({ students, onTerminalLog, onUnlock }: Props) {
  if (students.length === 0) {
    return <p className="text-sm text-muted">Nobody has joined yet.</p>;
  }
  return (
    <ul aria-label="Joined students" className="max-h-72 divide-y divide-border overflow-auto">
      {students.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-1.5 text-sm">
          <span
            aria-label={s.connected ? 'Connected' : 'Disconnected'}
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.connected ? 'bg-green-600' : 'bg-red-500'}`}
          />
          <span className="w-24 shrink-0 font-mono">{s.studentCode}</span>
          <span className="flex-1 truncate">{s.name}</span>
          {s.outsideMs > 0 && (
            <span className="shrink-0 text-amber-700" title="Total time outside the exam window">
              Outside {formatDuration(s.outsideMs)}
            </span>
          )}
          <span className={s.state === 'locked' ? 'font-medium text-red-700' : 'text-muted'}>
            {s.connected ? s.state : `${s.state} · offline`}
          </span>
          {onUnlock && s.state === 'locked' && (
            <button
              type="button"
              className="rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-700"
              title="The monitoring agent on this PC was lost. Check the PC, then let the student continue."
              onClick={() => onUnlock(s)}
            >
              Unlock
            </button>
          )}
          {onTerminalLog && (
            <button
              type="button"
              className="rounded-md border px-2 py-0.5 text-xs"
              onClick={() => onTerminalLog(s)}
            >
              Terminal
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
