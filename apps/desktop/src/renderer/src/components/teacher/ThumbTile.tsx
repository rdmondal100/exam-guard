import { useSyncExternalStore } from 'react';
import { MonitorOffIcon } from 'lucide-react';
import type { RosterEntry } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { riskLevel, statusText } from '@/lib/rosterTable';
import { thumbAge } from '@/lib/thumbGrid';
import type { ThumbStore } from '@/lib/thumbStore';
import { Hint } from '../common/Hint';
import { RISK_TONE } from './riskTone';
import { ConnectionDot } from './rosterColumns';

interface Props {
  student: RosterEntry;
  store: ThumbStore;
  /** Re-rendered every few seconds so the picture's age stays current. */
  now: number;
  selected: boolean;
  onSelect: (student: RosterEntry) => void;
}

/** One student's screen in the grid (M33): the latest thumbnail, name, status and risk. */
export function ThumbTile({ student: s, store, now, selected, onSelect }: Props) {
  const thumb = useSyncExternalStore(store.subscribe, () => store.get(s.id));
  const age = thumbAge(thumb?.ts, now);
  const stale = thumb !== undefined && now - thumb.ts > 15_000;
  const locked = s.state === 'locked';

  return (
    <Hint label={`${s.studentCode} · ${s.name}`}>
      <button
        type="button"
        onClick={() => onSelect(s)}
        aria-pressed={selected}
        className={cn(
          'flex flex-col overflow-hidden rounded-lg border bg-card text-left text-sm shadow-xs transition-colors outline-none hover:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          selected && 'border-primary ring-2 ring-primary/30',
          locked && 'border-destructive/50 bg-destructive/5',
        )}
      >
        <div className="relative aspect-video w-full bg-black/80">
          {thumb ? (
            <img
              src={thumb.url}
              alt={`Screen of ${s.name}`}
              className={cn('h-full w-full object-contain', stale && 'opacity-50')}
            />
          ) : (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center text-xs text-white/70">
              {!s.connected && <MonitorOffIcon className="size-4" aria-hidden />}
              {s.connected ? 'Waiting for a picture…' : 'Offline'}
            </span>
          )}
          {age && (
            <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">
              {age}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 px-2.5 pt-2">
          <ConnectionDot connected={s.connected} className="size-2" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-mono text-muted-foreground">{s.studentCode}</span>{' '}
            <span className="font-medium">{s.name}</span>
          </span>
          <Badge variant={RISK_TONE[riskLevel(s.riskScore)]} className="font-mono">
            {s.riskScore}
          </Badge>
        </div>
        <div
          className={cn(
            'truncate px-2.5 pt-0.5 pb-2 text-xs',
            locked ? 'font-medium text-destructive' : 'text-muted-foreground',
          )}
        >
          {statusText(s)}
          {s.monitors > 1 ? ` · ${s.monitors} screens` : ''}
          {!s.monitorOk ? ' · not monitored' : ''}
        </div>
      </button>
    </Hint>
  );
}
