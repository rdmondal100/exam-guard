import { MonitorIcon } from 'lucide-react';
import type { DiscoveredHost } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { LoadingLine } from '../common/Spinner';

interface Props {
  hosts: DiscoveredHost[];
  busy: boolean;
  onPick: (host: DiscoveredHost) => void;
}

export function HostList({ hosts, busy, onPick }: Props) {
  if (hosts.length === 0) {
    return <LoadingLine>Looking for exams on this network…</LoadingLine>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {hosts.map((host) => (
        <li key={host.id} className="flex items-center justify-between gap-4 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <MonitorIcon className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{host.examTitle}</p>
              <p className="text-sm text-muted-foreground">
                {host.address}:{host.port} · code <span className="font-mono">{host.fpCode}</span>
              </p>
            </div>
          </div>
          <Button disabled={busy} onClick={() => onPick(host)}>
            Select
          </Button>
        </li>
      ))}
    </ul>
  );
}
