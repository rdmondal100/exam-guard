import type { StudentQuestion } from '@examguard/shared';

/** The questions not in `known`, in exam order (M58: the teacher added them mid-exam). */
export function newQuestions(
  known: ReadonlySet<string>,
  questions: readonly StudentQuestion[],
): StudentQuestion[] {
  return questions.filter((q) => !known.has(q.id));
}

/** "Your teacher added Question 4." / "... added Questions 4 and 5." */
export function addedQuestionsText(added: readonly Pick<StudentQuestion, 'position'>[]): string {
  const numbers = added.map((q) => q.position).sort((a, b) => a - b);
  if (numbers.length === 1) return `Your teacher added Question ${numbers[0]}.`;
  const last = numbers.at(-1);
  return `Your teacher added Questions ${numbers.slice(0, -1).join(', ')} and ${last}.`;
}
