import type { DiscoveredHost } from '@examguard/shared';
import { Button } from '@/components/ui/button';

interface Props {
  hosts: DiscoveredHost[];
  busy: boolean;
  onPick: (host: DiscoveredHost) => void;
}

export function HostList({ hosts, busy, onPick }: Props) {
  if (hosts.length === 0) {
    return <p className="text-sm text-muted">Looking for exams on this network…</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {hosts.map((host) => (
        <li key={host.id} className="flex items-center justify-between gap-4 p-3">
          <div>
            <p className="font-medium">{host.examTitle}</p>
            <p className="text-sm text-muted">
              {host.address}:{host.port} · code {host.fpCode}
            </p>
          </div>
          <Button disabled={busy} onClick={() => onPick(host)}>
            Select
          </Button>
        </li>
      ))}
    </ul>
  );
}
