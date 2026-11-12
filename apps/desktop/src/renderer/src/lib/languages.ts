import type { QuestionLanguage } from '@examguard/shared';

export const LANGUAGE_LABEL: Record<QuestionLanguage, string> = {
  c: 'C',
  cpp: 'C++',
  js: 'JavaScript',
  py: 'Python',
};

export const MONACO_LANGUAGE: Record<QuestionLanguage, string> = {
  c: 'c',
  cpp: 'cpp',
  js: 'javascript',
  py: 'python',
};

/** The language to show: `current` if the question still allows it, else the first allowed one. */
export function pickLanguage(
  allowed: readonly QuestionLanguage[],
  current: QuestionLanguage | undefined,
): QuestionLanguage | undefined {
  if (current && allowed.includes(current)) return current;
  return allowed[0];
}
