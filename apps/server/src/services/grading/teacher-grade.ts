import type { AnswerEditBody, Criterion } from '@examguard/shared';
import type { StoredCriterion } from '../../db/repositories/evaluation.repo.js';

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export type TeacherGradeCheck =
  { ok: true; criteria: StoredCriterion[]; total: number } | { ok: false; problems: string[] };

/**
 * Checks a teacher's edit (M40) against the marking guide: every criterion once, names as in the
 * guide (ignoring case and spaces), each award at most its max. Returns half-units in the
 * guide's order. Steps of 0.5 and the 0 floor are already checked by the body schema.
 */
export function checkTeacherGrade(
  guide: readonly Criterion[],
  criteria: AnswerEditBody['criteria'],
): TeacherGradeCheck {
  const problems: string[] = [];
  const byName = new Map<string, AnswerEditBody['criteria'][number]>();
  for (const c of criteria) {
    if (byName.has(key(c.name))) problems.push(`"${c.name}" appears twice.`);
    byName.set(key(c.name), c);
  }
  const known = new Set(guide.map((g) => key(g.name)));
  for (const c of criteria) {
    if (!known.has(key(c.name))) problems.push(`"${c.name}" is not one of the marking criteria.`);
  }
  const stored: StoredCriterion[] = [];
  let total = 0;
  for (const g of guide) {
    const c = byName.get(key(g.name));
    if (!c) {
      problems.push(`"${g.name}" is missing.`);
      continue;
    }
    const max = Math.round(g.maxMarks * 2);
    const awarded = Math.round(c.awarded * 2);
    if (awarded > max) problems.push(`"${g.name}" can have at most ${g.maxMarks}.`);
    stored.push({ name: g.name, max, awarded, reason: (c.reason ?? '').trim() });
    total += awarded;
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, criteria: stored, total };
}
