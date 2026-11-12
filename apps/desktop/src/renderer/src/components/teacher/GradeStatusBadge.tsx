import type { AnswerGradeStatus } from '@examguard/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { STATUS_LABEL } from '@/lib/grading';

const TONE: Record<AnswerGradeStatus, BadgeTone> = {
  pending: 'neutral',
  ai_graded: 'info',
  verified: 'success',
  modified: 'primary',
  needs_manual: 'danger',
};

/** An answer's grading status as a badge (M51; was `STATUS_STYLE` in lib/grading). */
export function GradeStatusBadge({ status }: { status: AnswerGradeStatus }) {
  return <Badge variant={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
