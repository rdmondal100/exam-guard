import type { EventRow } from '@examguard/shared';

/** `45 s`, `3 min 5 s`, `1 h 2 min`: the length of a stretch away from the exam. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** One line for the teacher's event list. */
export function describeEvent(event: EventRow): string {
  const { details } = event;
  const exe = text(details['exe']);
  const title = text(details['title']);
  const where = [exe, title].filter(Boolean).join(' · ');
  switch (event.type) {
    case 'focus_lost':
      return `Left the exam for ${where || 'another window'}`;
    case 'title_changed':
      return `Now on ${where || 'another page'}`;
    case 'still_outside':
      return `Still outside, on ${where || 'another window'}`;
    case 'focus_returned': {
      const away = details['durationMs'];
      const back = typeof away === 'number' ? ` after ${formatDuration(away)}` : '';
      return `Came back${back}${exe ? ` from ${exe}` : ''}`;
    }
    default:
      return event.type;
  }
}

/** Where the picture goes: a data URL, because the page may only load `data:` images. */
export function jpegDataUrl(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode(...view.subarray(i, i + step));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
