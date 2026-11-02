import type { Question, QuestionLanguage } from '@examguard/shared';
import type { GradingInput } from './provider.js';

/**
 * Builds the AI input for one final answer. Only the fields listed here leave the teacher PC:
 * the anonymous id stands in for the student, so no name or student code can slip through.
 */
export function gradingInput(
  question: Question,
  anonId: string,
  answer: { language: QuestionLanguage | null; content: string },
): GradingInput {
  return {
    anonId,
    question: {
      type: question.type,
      body: question.body,
      allowedLanguages: [...question.allowedLanguages],
      studentNote: question.studentNote,
      marks: question.marks,
      sampleAnswer: question.sampleAnswer,
      sampleLanguage: question.sampleLanguage,
      aiNotes: question.aiNotes,
      criteria: question.criteria.map((c) => ({ name: c.name, maxMarks: c.maxMarks })),
    },
    answer: { language: answer.language, content: answer.content },
  };
}
