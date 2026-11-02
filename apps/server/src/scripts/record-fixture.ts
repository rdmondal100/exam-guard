/**
 * Manual only, never in tests: grades one answer with real Gemini and saves the exchange as a
 * fixture (M37 smoke test). The teacher's key comes from the shell, never from a file in the repo:
 *
 *   $env:EG_GEMINI_API_KEY = '…'   (PowerShell; unset it afterwards)
 *   pnpm record-fixture -- <input.json> <fixture-name> [model]
 *
 * `<input.json>` is an existing fixture or a bare `GradingInput`. The result goes to
 * `apps/server/fixtures/grading/<fixture-name>.json` with `source: "recorded"`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GradingInput } from '../services/grading/provider.js';
import { PROMPT_VERSION } from '../services/grading/prompt.js';
import { FIXTURES_DIR, type GradingFixture } from '../services/grading/providers/fake.js';
import { GeminiProvider } from '../services/grading/providers/gemini.js';
import { validateGrade } from '../services/grading/validate.js';

async function main(): Promise<number> {
  const [inputPath, name, model] = process.argv.slice(2).filter((a) => a !== '--');
  const apiKey = process.env.EG_GEMINI_API_KEY;
  if (!inputPath || !name || !/^[a-z0-9-]+$/.test(name)) {
    console.error('Usage: record-fixture <input.json> <fixture-name: a-z, 0-9, -> [model]');
    return 2;
  }
  if (!apiKey) {
    console.error('Set EG_GEMINI_API_KEY in this shell first (never in a file in the repo).');
    return 2;
  }
  const raw = JSON.parse(readFileSync(inputPath, 'utf8')) as {
    input?: GradingInput;
  } & GradingInput;
  const input: GradingInput = raw.input ?? raw;
  const provider = new GeminiProvider({ apiKey, ...(model ? { model } : {}) });
  const started = Date.now();
  const result = await provider.gradeAnswer(input);
  const check = validateGrade(result.text, input.question.criteria);
  const fixture: GradingFixture = {
    name,
    description: `Recorded ${new Date().toISOString().slice(0, 10)}.`,
    source: 'recorded',
    provider: provider.id,
    model: provider.model,
    promptVersion: PROMPT_VERSION,
    input,
    responses: [{ text: result.text }],
  };
  const out = join(FIXTURES_DIR, `${name}.json`);
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Saved ${out} (${Date.now() - started} ms, tokens ${JSON.stringify(result.usage)})`);
  console.log(
    check.ok ? `Valid: total ${check.grade.total / 2}` : 'Invalid:',
    check.ok ? '' : check.problems,
  );
  return check.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
