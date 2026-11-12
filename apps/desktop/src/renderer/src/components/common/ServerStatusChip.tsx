import type { ServerState, ServerStatus } from '@examguard/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LABELS: Record<ServerState, string> = {
  stopped: 'Server stopped',
  starting: 'Server starting…',
  running: 'Server running',
  restarting: 'Server restarting…',
};

const TONE: Record<ServerState, BadgeTone> = {
  stopped: 'neutral',
  starting: 'warning',
  running: 'success',
  restarting: 'warning',
};

export function ServerStatusChip({
  status,
  className,
}: {
  status: ServerStatus;
  className?: string;
}) {
  return (
    <Badge role="status" variant={TONE[status.state]} className={cn('gap-1.5', className)}>
      <span
        className={cn(
          'size-1.5 rounded-full bg-current',
          status.state !== 'running' && status.state !== 'stopped' && 'animate-pulse',
        )}
        aria-hidden
      />
      {LABELS[status.state]}
    </Badge>
  );
}
