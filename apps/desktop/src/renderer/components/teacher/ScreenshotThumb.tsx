import { useEffect, useRef, useState } from 'react';
import type { EventRow } from '@examguard/shared';
import type { ExamApi } from '@/api/examApi';

interface Props {
  event: EventRow;
  api: ExamApi;
  onOpen: (event: EventRow) => void;
}

/**
 * A small inline picture of an event's screenshot (M32). It is fetched only once it scrolls into
 * view, so a long timeline does not load every picture at once.
 */
export function ScreenshotThumb({ event, api, onOpen }: Props) {
  const box = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    api
      .screenshot(event.id)
      .then((url) => {
        if (!cancelled) setPicture(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, event.id, visible]);

  return (
    <button
      ref={box}
      type="button"
      title="Open the screenshot"
      onClick={() => onOpen(event)}
      className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-black/5 text-xs text-muted"
    >
      {picture ? (
        <img src={picture} alt="Screenshot" className="h-full w-full object-cover" />
      ) : failed ? (
        'No picture'
      ) : (
        'Loading…'
      )}
    </button>
  );
}
