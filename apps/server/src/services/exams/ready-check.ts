import type { ExamSummary, Question, ReadyProblem } from '@examguard/shared';

/** Everything that stops an exam from being marked Ready. An empty list means it can go. */
export function readyProblems(
  exam: Pick<ExamSummary, 'classListId'>,
  questions: Question[],
): ReadyProblem[] {
  const problems: ReadyProblem[] = [];
  if (exam.classListId === null) {
    problems.push({ code: 'no_class_list', message: 'Choose a class list for this exam' });
  }
  if (questions.length === 0) {
    problems.push({ code: 'no_questions', message: 'Add at least one question' });
  }
  for (const q of questions) {
    const label = `Question ${q.position}`;
    if (q.sampleAnswer.trim() === '') {
      problems.push({
        code: 'missing_sample_answer',
        message: `${label} has no sample answer`,
        questionId: q.id,
      });
    }
    if (q.criteria.length === 0) {
      problems.push({
        code: 'no_criteria',
        message: `${label} has no marking criteria`,
        questionId: q.id,
      });
    }
    if (q.type === 'code' && q.allowedLanguages.length === 0) {
      problems.push({
        code: 'no_languages',
        message: `${label} allows no programming language`,
        questionId: q.id,
      });
    }
  }
  return problems;
}
