import type { ServerState, ServerStatus } from '@examguard/shared';

const LABELS: Record<ServerState, string> = {
  stopped: 'Server stopped',
  starting: 'Server starting…',
  running: 'Server running',
  restarting: 'Server restarting…',
};

const DOT: Record<ServerState, string> = {
  stopped: 'bg-gray-400',
  starting: 'bg-amber-500',
  running: 'bg-green-600',
  restarting: 'bg-amber-500',
};

export function ServerStatusChip({ status }: { status: ServerStatus }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
    >
      <span className={`size-2 rounded-full ${DOT[status.state]}`} aria-hidden />
      {LABELS[status.state]}
    </span>
  );
}
