import { useCallback, useState } from 'react';
import type { StudentQuestion } from '@examguard/shared';
import { newQuestions } from '@/lib/addedQuestions';

/**
 * The questions the teacher added after this screen opened (M58), until the student dismisses the
 * notice. The questions shown at first are never "new".
 */
export function useAddedQuestions(questions: StudentQuestion[]): {
  added: StudentQuestion[];
  dismiss: () => void;
} {
  const [known, setKnown] = useState(() => new Set(questions.map((q) => q.id)));
  const [added, setAdded] = useState<StudentQuestion[]>([]);
  const fresh = newQuestions(known, questions);
  if (fresh.length > 0) {
    // Updating state while rendering is React's documented way to follow a changed prop.
    setKnown(new Set([...known, ...fresh.map((q) => q.id)]));
    setAdded([...added, ...fresh]);
  }
  const dismiss = useCallback(() => setAdded([]), []);
  return { added, dismiss };
}
