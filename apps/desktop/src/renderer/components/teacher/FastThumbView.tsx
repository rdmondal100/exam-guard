import { useEffect, useState, useSyncExternalStore } from 'react';
import { FAST_THUMB_HIDDEN_CLOSE_MS, type RosterEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { RosterView } from '@/hooks/useRoster';
import { usePageVisible } from '@/hooks/usePageVisible';
import { thumbAge } from '@/lib/thumbGrid';

interface Props {
  student: RosterEntry;
  roster: RosterView;
  onClose: () => void;
}

/**
 * The fast thumbnail (M34 fallback for the WebRTC live view): the student's whole screen, a
 * larger picture every second, while this panel is open and the window is shown. Hidden for a
 * minute, it closes itself.
 */
export function FastThumbView({ student: s, roster, onClose }: Props) {
  const { focusThumbs, thumbs } = roster;
  const visible = usePageVisible();
  const thumb = useSyncExternalStore(thumbs.subscribe, () => thumbs.get(s.id));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    focusThumbs(visible ? [s.id] : []);
  }, [visible, s.id, focusThumbs]);
  useEffect(() => () => focusThumbs([]), [focusThumbs]);
  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(onClose, FAST_THUMB_HIDDEN_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [visible, onClose]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const age = thumbAge(thumb?.ts, now);
  return (
    <section aria-label="Live screen" className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm">
        <h3 className="font-semibold">Live screen</h3>
        <span className="text-muted">updates every second{age ? ` · ${age}` : ''}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={onClose}>
          Close live screen
        </Button>
      </div>
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black/80">
        {thumb ? (
          <img
            src={thumb.url}
            alt={`Live screen of ${s.name}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            {s.connected ? 'Waiting for a picture…' : 'The student is offline'}
          </span>
        )}
      </div>
    </section>
  );
}
