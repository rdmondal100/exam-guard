import { useSyncExternalStore } from 'react';
import type { RosterEntry } from '@examguard/shared';
import { riskLevel, statusText } from '@/lib/rosterTable';
import { thumbAge } from '@/lib/thumbGrid';
import type { ThumbStore } from '@/lib/thumbStore';

interface Props {
  student: RosterEntry;
  store: ThumbStore;
  /** Re-rendered every few seconds so the picture's age stays current. */
  now: number;
  selected: boolean;
  onSelect: (student: RosterEntry) => void;
}

const RISK_STYLE: Record<ReturnType<typeof riskLevel>, string> = {
  none: 'bg-black/5 text-muted',
  low: 'bg-black/10',
  medium: 'bg-amber-100 text-amber-900',
  high: 'bg-red-100 font-semibold text-red-800',
};

/** One student's screen in the grid (M33): the latest thumbnail, name, status and risk. */
export function ThumbTile({ student: s, store, now, selected, onSelect }: Props) {
  const thumb = useSyncExternalStore(store.subscribe, () => store.get(s.id));
  const age = thumbAge(thumb?.ts, now);
  const stale = thumb !== undefined && now - thumb.ts > 15_000;

  return (
    <button
      type="button"
      onClick={() => onSelect(s)}
      aria-pressed={selected}
      className={`flex flex-col overflow-hidden rounded-md border text-left text-sm hover:border-blue-500 ${
        selected ? 'border-blue-600 ring-2 ring-blue-300' : 'border-border'
      } ${s.state === 'locked' ? 'bg-red-50' : 'bg-card'}`}
    >
      <div className="relative aspect-video w-full bg-black/80">
        {thumb ? (
          <img
            src={thumb.url}
            alt={`Screen of ${s.name}`}
            className={`h-full w-full object-contain ${stale ? 'opacity-50' : ''}`}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs text-white/70">
            {s.connected ? 'Waiting for a picture…' : 'Offline'}
          </span>
        )}
        {age && (
          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
            {age}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 py-1">
        <span
          aria-label={s.connected ? 'Connected' : 'Disconnected'}
          className={`h-2 w-2 shrink-0 rounded-full ${s.connected ? 'bg-green-600' : 'bg-red-500'}`}
        />
        <span className="min-w-0 flex-1 truncate" title={`${s.studentCode} · ${s.name}`}>
          <span className="font-mono">{s.studentCode}</span> {s.name}
        </span>
        <span className={`rounded px-1.5 font-mono text-xs ${RISK_STYLE[riskLevel(s.riskScore)]}`}>
          {s.riskScore}
        </span>
      </div>
      <div
        className={`truncate px-2 pb-1 text-xs ${s.state === 'locked' ? 'font-medium text-red-700' : 'text-muted'}`}
      >
        {statusText(s)}
        {s.monitors > 1 ? ` · ${s.monitors} screens` : ''}
        {!s.agentOk ? ' · no agent' : ''}
      </div>
    </button>
  );
}
