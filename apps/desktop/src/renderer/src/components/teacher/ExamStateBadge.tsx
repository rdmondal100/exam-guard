import { GraduationCapIcon } from 'lucide-react';
import type { ExamSummary } from '@examguard/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';

type ExamState = ExamSummary['state'];

export const STATE_LABEL: Record<ExamState, string> = {
  draft: 'Draft',
  ready: 'Ready',
  hosting: 'Hosting',
  running: 'Running',
  ended: 'Ended',
  grading: 'Grading',
  in_review: 'In review',
  finalized: 'Finalized',
};

const TONE: Record<ExamState, BadgeTone> = {
  draft: 'neutral',
  ready: 'primary',
  hosting: 'success',
  running: 'success',
  ended: 'secondary',
  grading: 'info',
  in_review: 'warning',
  finalized: 'outline',
};

/** An exam's state as a badge (M51); live states get a pulsing dot. */
export function ExamStateBadge({ state }: { state: ExamState }) {
  const live = state === 'hosting' || state === 'running';
  return (
    <Badge variant={TONE[state]} className="gap-1.5">
      {live && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
      {state === 'hosting' ? 'Hosting now' : STATE_LABEL[state]}
    </Badge>
  );
}

/** Marks a practice exam (M53): nothing is monitored, recorded or graded. */
export function PracticeBadge() {
  return (
    <Badge variant="info" className="gap-1">
      <GraduationCapIcon aria-hidden />
      Practice
    </Badge>
  );
}
