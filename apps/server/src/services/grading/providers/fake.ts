import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ProviderError,
  type GradingInput,
  type GradingOptions,
  type GradingProvider,
  type ProviderResult,
} from '../provider.js';

/** One scripted reply: the model's text, or a failed call. */
const FixtureStepSchema = z.union([
  z.object({ text: z.string() }),
  z.object({
    error: z.object({
      kind: z.enum(['rate_limit', 'server', 'auth', 'bad_request', 'network']),
      status: z.number().int().optional(),
      message: z.string().default('Fake provider error'),
    }),
  }),
]);
export type FixtureStep = z.infer<typeof FixtureStepSchema>;

/**
 * A recorded grading exchange (`apps/server/fixtures/grading/*.json`): the input and the replies,
 * in order. Written by `record-fixture` from a real call, or by hand for failure cases.
 */
export const GradingFixtureSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  /** Where the replies came from: `recorded` (a real call) or `hand-written`. */
  source: z.enum(['recorded', 'hand-written']),
  provider: z.string().default('gemini'),
  model: z.string().default(''),
  promptVersion: z.string().default(''),
  input: z.custom<GradingInput>(
    (v) => typeof v === 'object' && v !== null && 'anonId' in v && 'question' in v,
  ),
  responses: z.array(FixtureStepSchema).min(1),
});
export type GradingFixture = z.infer<typeof GradingFixtureSchema>;

/** The fixtures shipped with the server tests. */
export const FIXTURES_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'grading',
);

/** Every `*.json` fixture in a folder, validated, by name. */
export function loadFixtures(dir = FIXTURES_DIR): Map<string, GradingFixture> {
  const fixtures = new Map<string, GradingFixture>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const fixture = GradingFixtureSchema.parse(
      JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown,
    );
    fixtures.set(fixture.name, fixture);
  }
  return fixtures;
}

/** One call the fake received, for tests that check the prompt or the repair hint. */
export interface FakeCall {
  input: GradingInput;
  options: GradingOptions;
}

/**
 * Replays scripted replies instead of calling an AI (every test uses it). Replies are chosen by the
 * answer's anonymous id; each call takes the next one, and the last repeats when they run out.
 */
export class FakeProvider implements GradingProvider {
  readonly id = 'fake';
  readonly calls: FakeCall[] = [];
  private readonly scripts = new Map<string, { steps: FixtureStep[]; next: number }>();

  constructor(
    scripts: Record<string, FixtureStep[]> = {},
    readonly model = 'fake-model',
  ) {
    for (const [anonId, steps] of Object.entries(scripts)) this.script(anonId, steps);
  }

  /** Builds a fake from fixtures: each fixture answers its own input's anonymous id. */
  static fromFixtures(fixtures: Iterable<GradingFixture>): FakeProvider {
    const fake = new FakeProvider();
    for (const f of fixtures) fake.script(f.input.anonId, f.responses);
    return fake;
  }

  script(anonId: string, steps: FixtureStep[]): void {
    if (steps.length === 0) throw new Error(`No replies scripted for ${anonId}`);
    this.scripts.set(anonId, { steps, next: 0 });
  }

  gradeAnswer(input: GradingInput, options: GradingOptions = {}): Promise<ProviderResult> {
    this.calls.push({ input, options });
    const script = this.scripts.get(input.anonId);
    if (!script) return Promise.reject(new Error(`No replies scripted for ${input.anonId}`));
    const step = script.steps[Math.min(script.next, script.steps.length - 1)];
    script.next += 1;
    if (!step) return Promise.reject(new Error(`No replies scripted for ${input.anonId}`));
    if ('error' in step) {
      const { kind, message, status } = step.error;
      return Promise.reject(new ProviderError(kind, message, status));
    }
    return Promise.resolve({ text: step.text });
  }
}
