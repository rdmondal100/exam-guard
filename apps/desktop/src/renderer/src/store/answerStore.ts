import { create } from 'zustand';
import {
  ANSWER_TEXT_KEY,
  QuestionLanguageSchema,
  type QuestionLanguage,
  type RestoredAnswers,
} from '@examguard/shared';

export { ANSWER_TEXT_KEY };

type Buffers = Record<string, string>;

export interface AnswerState {
  /** answers[questionId][language] for code, answers[questionId].text for written. */
  answers: Record<string, Buffers>;
  /** The language the student picked last, per question. */
  languages: Record<string, QuestionLanguage>;
  /** flags[questionId][language]: the student's own compiler (C/C++) or Node (JS) flags, kept with the answer. */
  flags: Record<string, Buffers>;
  setAnswer: (questionId: string, key: string, value: string) => void;
  setLanguage: (questionId: string, language: QuestionLanguage) => void;
  setFlags: (questionId: string, language: QuestionLanguage, value: string) => void;
  /** Fills the editors from what main restored after a restart. */
  restore: (restored: RestoredAnswers) => void;
  reset: () => void;
}

export const useAnswerStore = create<AnswerState>((set) => ({
  answers: {},
  languages: {},
  flags: {},
  setAnswer: (questionId, key, value) =>
    set((s) => ({
      answers: { ...s.answers, [questionId]: { ...s.answers[questionId], [key]: value } },
    })),
  setLanguage: (questionId, language) =>
    set((s) => ({ languages: { ...s.languages, [questionId]: language } })),
  setFlags: (questionId, language, value) =>
    set((s) => ({
      flags: { ...s.flags, [questionId]: { ...s.flags[questionId], [language]: value } },
    })),
  restore: (restored) =>
    set((s) => {
      const answers = { ...s.answers };
      const flags = { ...s.flags };
      const languages = { ...s.languages };
      for (const b of restored.buffers) {
        answers[b.questionId] = { ...answers[b.questionId], [b.language]: b.content };
        if (b.flags) flags[b.questionId] = { ...flags[b.questionId], [b.language]: b.flags };
      }
      for (const l of restored.languages) {
        const language = QuestionLanguageSchema.safeParse(l.language);
        if (language.success) languages[l.questionId] = language.data;
      }
      return { answers, flags, languages };
    }),
  reset: () => set({ answers: {}, languages: {}, flags: {} }),
}));

export function getAnswer(
  answers: AnswerState['answers'],
  questionId: string,
  key: string,
): string {
  return answers[questionId]?.[key] ?? '';
}

/**
 * Questions with something typed. Only the buffer for the selected language counts for code,
 * since that is what would be submitted.
 */
export function answeredIds(
  answers: AnswerState['answers'],
  keyOf: (questionId: string) => string,
): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys(answers)) {
    if (getAnswer(answers, id, keyOf(id)).trim()) out.add(id);
  }
  return out;
}
