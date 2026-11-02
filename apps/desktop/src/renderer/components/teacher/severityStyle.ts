import type { Severity } from '@examguard/shared';

/** Text colour of an event line by severity. */
export const SEVERITY_TEXT: Record<Severity, string> = {
  low: 'text-muted',
  medium: 'text-amber-700',
  high: 'text-red-700',
  critical: 'font-semibold text-red-800',
};

/** Small severity badge. */
export const SEVERITY_BADGE: Record<Severity, string> = {
  low: 'bg-black/5 text-muted',
  medium: 'bg-amber-100 text-amber-900',
  high: 'bg-red-100 text-red-800',
  critical: 'bg-red-700 text-white',
};
