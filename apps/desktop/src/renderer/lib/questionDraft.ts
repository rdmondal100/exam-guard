import {
  QuestionBodySchema,
  type Question,
  type QuestionBody,
  type QuestionLanguage,
  type QuestionType,
} from '@examguard/shared';

/** A criterion as typed in the form: marks stay text until the form is saved. */
export interface CriterionDraft {
  name: string;
  maxMarks: string;
}

export interface QuestionDraft {
  type: QuestionType;
  body: string;
  allowedLanguages: QuestionLanguage[];
  studentNote: string;
  sampleAnswer: string;
  sampleLanguage: string;
  aiNotes: string;
  criteria: CriterionDraft[];
}

export function emptyDraft(type: QuestionType): QuestionDraft {
  return {
    type,
    body: '',
    allowedLanguages: type === 'code' ? ['c', 'cpp', 'js'] : [],
    studentNote: '',
    sampleAnswer: '',
    sampleLanguage: type === 'code' ? 'c' : 'text',
    aiNotes: '',
    criteria: [{ name: '', maxMarks: '' }],
  };
}

export function draftFromQuestion(q: Question): QuestionDraft {
  return {
    type: q.type,
    body: q.body,
    allowedLanguages: q.allowedLanguages,
    studentNote: q.studentNote,
    sampleAnswer: q.sampleAnswer,
    sampleLanguage: q.sampleLanguage,
    aiNotes: q.aiNotes,
    criteria: q.criteria.map((c) => ({ name: c.name, maxMarks: String(c.maxMarks) })),
  };
}

/** A positive multiple of 0.5, or `null` when the text is anything else. */
export function parseMarks(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 && Number.isInteger(n * 2) ? n : null;
}

/** Sum of the valid criteria marks, shown as the question's marks while editing. */
export function draftTotal(draft: QuestionDraft): number {
  return draft.criteria.reduce((sum, c) => sum + (parseMarks(c.maxMarks) ?? 0), 0);
}

const isBlank = (c: CriterionDraft) => c.name.trim() === '' && c.maxMarks.trim() === '';

/** The API body, or a message for the teacher. Fully blank criteria rows are dropped. */
export function draftToBody(draft: QuestionDraft): { body: QuestionBody } | { error: string } {
  const criteria: QuestionBody['criteria'] = [];
  for (const [index, row] of draft.criteria.entries()) {
    if (isBlank(row)) continue;
    const maxMarks = parseMarks(row.maxMarks);
    if (row.name.trim() === '' || maxMarks === null) {
      return { error: `Criterion ${index + 1} needs a name and marks in steps of 0.5` };
    }
    criteria.push({ name: row.name, maxMarks });
  }
  const parsed = QuestionBodySchema.safeParse({
    ...draft,
    allowedLanguages: draft.type === 'code' ? draft.allowedLanguages : [],
    criteria,
  });
  if (parsed.success) return { body: parsed.data };
  return { error: parsed.error.issues[0]?.message ?? 'Check the question text and criteria' };
}
