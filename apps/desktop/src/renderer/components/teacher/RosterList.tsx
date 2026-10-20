import type { RosterEntry } from '@examguard/shared';

/** Joined students: name, code, state and whether their socket is up. */
export function RosterList({ students }: { students: RosterEntry[] }) {
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
          <span className="text-muted">{s.connected ? s.state : `${s.state} · offline`}</span>
        </li>
      ))}
    </ul>
  );
}
