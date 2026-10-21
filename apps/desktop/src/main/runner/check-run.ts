import type { RunRequest, SessionState } from '@examguard/shared';

/**
 * Main's own check before running anything: the exam is running and the language is one the
 * teacher allowed for that code question. Returns the reason to refuse, or `null`.
 */
export function runRefusal(exam: SessionState | null, request: RunRequest): string | null {
  if (exam?.examState !== 'running') return 'Code can only be run while the exam is running.';
  const question = exam.questions?.find((q) => q.id === request.questionId);
  if (!question || question.type !== 'code') return 'This question has no code to run.';
  if (!question.allowedLanguages.includes(request.language)) {
    return 'That language is not allowed for this question.';
  }
  return null;
}
