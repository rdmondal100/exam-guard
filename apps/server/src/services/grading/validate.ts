import { z } from 'zod';

/** The model's reply as it must look (requirements §8.9). Marks are the teacher's numbers. */
const RawGradeSchema = z.object({
  criteria: z.array(
    z.object({
      name: z.string(),
      max: z.number(),
      awarded: z.number(),
      reason: z.string(),
    }),
  ),
  total: z.number(),
  feedback: z.string(),
  teacher_notes: z.array(z.object({ line: z.number().int(), issue: z.string() })),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type Confidence = 'high' | 'medium' | 'low';

/** A grade that passed every rule. Marks are integer half-units (`marks * 2`), as stored. */
export interface ValidGrade {
  /** In the marking guide's order, with the guide's names. */
  criteria: { name: string; max: number; awarded: number; reason: string }[];
  total: number;
  feedback: string;
  teacherNotes: { line: number; issue: string }[];
  confidence: Confidence;
}

export type GradeCheck = { ok: true; grade: ValidGrade } | { ok: false; problems: string[] };

/** The marking guide as the teacher wrote it (steps of 0.5). */
export type Guide = readonly { name: string; maxMarks: number }[];

const key = (name: string) => name.trim().toLowerCase();

/** `n * 2` when it is a whole number of half marks, otherwise `null`. */
function toHalfUnits(n: number): number | null {
  const half = n * 2;
  const rounded = Math.round(half);
  return Number.isFinite(half) && Math.abs(half - rounded) < 1e-9 ? rounded : null;
}

/** The JSON inside a reply, also when the model wrapped it in a Markdown code fence. */
function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/**
 * Checks one reply against the marking guide (docs/architecture.md §7): valid JSON of the right
 * shape, the guide's criteria exactly (names match, ignoring case and spaces), each max equal to
 * the guide's, each award between 0 and max in steps of 0.5, and a total equal to the sum.
 * The problems are short sentences, sent back to the model as a repair hint.
 */
export function validateGrade(text: string, guide: Guide): GradeCheck {
  let raw: unknown;
  try {
    raw = parseJson(text);
  } catch {
    return { ok: false, problems: ['The reply is not valid JSON.'] };
  }
  const parsed = RawGradeSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join('.') || 'reply'}: ${i.message}.`,
    );
    return { ok: false, problems };
  }
  const reply = parsed.data;
  const problems: string[] = [];
  const byName = new Map<string, (typeof reply.criteria)[number]>();
  for (const c of reply.criteria) {
    if (byName.has(key(c.name))) problems.push(`Criterion "${c.name}" appears twice.`);
    byName.set(key(c.name), c);
  }
  const known = new Set(guide.map((g) => key(g.name)));
  for (const c of reply.criteria) {
    if (!known.has(key(c.name))) problems.push(`"${c.name}" is not one of the marking criteria.`);
  }

  const criteria: ValidGrade['criteria'] = [];
  let sum = 0;
  for (const g of guide) {
    const c = byName.get(key(g.name));
    if (!c) {
      problems.push(`Criterion "${g.name}" is missing.`);
      continue;
    }
    const max = toHalfUnits(g.maxMarks) ?? 0;
    if (toHalfUnits(c.max) !== max)
      problems.push(`"${g.name}" has max ${g.maxMarks}, not ${c.max}.`);
    const awarded = toHalfUnits(c.awarded);
    if (awarded === null) {
      problems.push(`"${g.name}": ${c.awarded} is not a step of 0.5.`);
    } else if (awarded < 0 || awarded > max) {
      problems.push(`"${g.name}": ${c.awarded} is outside 0 to ${g.maxMarks}.`);
    } else {
      sum += awarded;
      criteria.push({ name: g.name, max, awarded, reason: c.reason.trim() });
    }
  }
  const total = toHalfUnits(reply.total);
  if (problems.length === 0 && total !== sum) {
    problems.push(`"total" is ${reply.total} but the criteria add up to ${sum / 2}.`);
  }
  if (!reply.feedback.trim()) problems.push('"feedback" is empty.');
  for (const note of reply.teacher_notes) {
    if (note.line < 1) problems.push(`teacher_notes line ${note.line} must be 1 or more.`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    grade: {
      criteria,
      total: sum,
      feedback: reply.feedback.trim(),
      teacherNotes: reply.teacher_notes.map((n) => ({ line: n.line, issue: n.issue.trim() })),
      confidence: reply.confidence,
    },
  };
}

/** The repair hint for the next attempt (at most a few lines). */
export function repairHint(problems: readonly string[]): string {
  const shown = problems.slice(0, 8);
  const more = problems.length - shown.length;
  return [...shown, ...(more > 0 ? [`(and ${more} more)`] : [])].join('\n');
}
