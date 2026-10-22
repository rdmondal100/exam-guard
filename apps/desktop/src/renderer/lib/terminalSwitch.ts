import type { TerminalState } from '@examguard/shared';

/** `m:ss`, or `h:mm:ss` from an hour up. Never negative. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** What the teacher's terminal control says about the current switch. */
export function terminalLabel(
  terminal: TerminalState,
  pendingMinutes: number | null,
  now: number,
): string {
  if (!terminal.enabled) return 'Off';
  if (pendingMinutes !== null) return `On for ${pendingMinutes} min, counted from Start`;
  if (terminal.until === null) return 'On';
  return `On · turns off in ${formatRemaining(terminal.until - now)}`;
}

/** The minutes box: a whole number from 1 to 600, else `null`. */
export function parseMinutes(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= 600 ? n : null;
}
