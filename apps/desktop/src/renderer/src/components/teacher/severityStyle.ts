import type { Severity } from '@examguard/shared';
import type { BadgeTone } from '@/components/ui/badge';

/** Text colour of an event line by severity (theme tokens, M51). */
export const SEVERITY_TEXT: Record<Severity, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
  critical: 'font-semibold text-destructive',
};

/** The severity badge's tone. */
export const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  critical: 'destructive',
};
