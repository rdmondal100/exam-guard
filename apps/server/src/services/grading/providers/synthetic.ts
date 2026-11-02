import { createHash } from 'node:crypto';
import {
  ProviderError,
  type GradingInput,
  type GradingOptions,
  type GradingProvider,
  type ProviderResult,
} from '../provider.js';
import { abortableSleep } from '../sleep.js';

/**
 * The dev grader (`EG_FAKE_GRADER=1`, M38): grades without any network so the pipeline and the
 * review screens can be tried on a sim exam. Marks follow a hash of the answer, so they are
 * stable. Some answers get a low confidence, and a few start with a 429 or an invalid reply to
 * show the retries. Never used for real marks.
 */
export class SyntheticProvider implements GradingProvider {
  readonly id = 'fake';
  readonly model = 'synthetic';
  private readonly attempts = new Map<string, number>();

  constructor(private readonly delayMs = 300) {}

  async gradeAnswer(input: GradingInput, options: GradingOptions = {}): Promise<ProviderResult> {
    const content = input.answer.content;
    const seed = createHash('sha256')
      .update(`${input.anonId}\n${input.question.body}\n${content}`)
      .digest();
    const key = seed.toString('hex');
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    await abortableSleep(
      this.delayMs + ((seed[0] ?? 0) % 5) * 60,
      options.signal ?? new AbortController().signal,
    );

    const pick = seed[1] ?? 0;
    if (attempt === 1 && pick % 13 === 1) {
      throw new ProviderError('rate_limit', 'Synthetic 429', 429);
    }
    if (attempt === 1 && pick % 11 === 2) return { text: 'Sorry, I cannot grade this.' };

    const empty = content.trim() === '';
    let total = 0;
    const criteria = input.question.criteria.map((c, i) => {
      const steps = Math.round(c.maxMarks * 2);
      const share = empty ? 0 : 0.4 + ((seed[2 + i] ?? 0) / 255) * 0.6;
      const awarded = Math.round(steps * share) / 2;
      total += awarded;
      return {
        name: c.name,
        max: c.maxMarks,
        awarded,
        reason: empty ? 'No answer was given.' : `Synthetic mark for "${c.name}".`,
      };
    });
    const lines = content.split('\n').length;
    return {
      text: JSON.stringify({
        criteria,
        total,
        feedback: empty
          ? 'You did not answer this question.'
          : 'Synthetic feedback from the dev grader. These marks are not real.',
        teacher_notes: empty || lines < 2 ? [] : [{ line: 2, issue: 'Synthetic note on line 2' }],
        confidence: empty ? 'high' : pick % 5 === 0 ? 'low' : pick % 2 === 0 ? 'high' : 'medium',
      }),
    };
  }
}
