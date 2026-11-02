import { ANSWER_TEXT_KEY, type AnswerSnapshot, type Question } from '@examguard/shared';

export interface ChosenAnswer {
  questionId: string;
  language: string;
  content: string;
}

/**
 * The answer that counts for each question, one per question (docs/data-model.md `final_answers`):
 * the language of the newest version saved as selected; else the language of the newest version;
 * else the first allowed language (or `text`) with an empty answer.
 */
export function chooseFinalAnswers(
  questions: readonly Pick<Question, 'id' | 'type' | 'allowedLanguages'>[],
  snapshot: AnswerSnapshot,
): ChosenAnswer[] {
  return questions.map((question) => {
    const buffers = snapshot.buffers.filter((b) => b.questionId === question.id);
    const selected = snapshot.selected.find((s) => s.questionId === question.id);
    const chosen =
      (selected && buffers.find((b) => b.language === selected.language)) ||
      [...buffers].sort((a, b) => b.clientSeq - a.clientSeq)[0];
    if (chosen) {
      return { questionId: question.id, language: chosen.language, content: chosen.content };
    }
    const fallback =
      question.type === 'code' && question.allowedLanguages.length > 0
        ? (question.allowedLanguages[0] as string)
        : ANSWER_TEXT_KEY;
    return { questionId: question.id, language: selected?.language ?? fallback, content: '' };
  });
}
