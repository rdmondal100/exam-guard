import type { BadgeTone } from '@/components/ui/badge';
import type { riskLevel } from '@/lib/rosterTable';

/** The risk score's badge colour (M51), shared by the roster table and the screen tiles. */
export const RISK_TONE: Record<ReturnType<typeof riskLevel>, BadgeTone> = {
  none: 'outline',
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
};
