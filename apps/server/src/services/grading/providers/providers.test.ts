import { describe, expect, it } from 'vitest';
import { ApiError, type GenerateContentParameters } from '@google/genai';
import { ProviderError } from '../provider.js';
import { PROMPT_VERSION, RESPONSE_JSON_SCHEMA, SYSTEM_PROMPT } from '../prompt.js';
import { validateGrade } from '../validate.js';
import { FakeProvider, loadFixtures } from './fake.js';
import {
  GEMINI_TEMPERATURE,
  GeminiProvider,
  toProviderError,
  type GeminiModels,
} from './gemini.js';

const fixtures = loadFixtures();
const fixture = (name: string) => {
  const f = fixtures.get(name);
  if (!f) throw new Error(`fixture ${name} missing`);
  return f;
};

describe('grading fixtures', () => {
  it('load, use the current prompt version and match their own guide when valid', () => {
    expect(fixtures.size).toBeGreaterThanOrEqual(6);
    for (const f of fixtures.values()) {
      expect(f.promptVersion).toBe(PROMPT_VERSION);
      expect(JSON.stringify(f.input)).not.toMatch(/studentCode|"name":"(?!Correct|Uses|Code)/);
    }
    const valid = fixture('valid-c');
    const step = valid.responses[0];
    const text = step && 'text' in step ? step.text : '';
    expect(validateGrade(text, valid.input.question.criteria).ok).toBe(true);
  });
});

describe('FakeProvider', () => {
  it('replays a fixture in order, errors included, and repeats the last reply', async () => {
    const f = fixture('rate-limited-then-valid');
    const fake = FakeProvider.fromFixtures([f]);
    const first = await fake.gradeAnswer(f.input).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(ProviderError);
    expect(first).toMatchObject({ kind: 'rate_limit', status: 429, retryable: true });
    await expect(fake.gradeAnswer(f.input)).rejects.toThrow(ProviderError);
    const third = await fake.gradeAnswer(f.input, { repairHint: 'x' });
    expect(validateGrade(third.text, f.input.question.criteria).ok).toBe(true);
    expect((await fake.gradeAnswer(f.input)).text).toBe(third.text);
    expect(fake.calls).toHaveLength(4);
    expect(fake.calls[2]?.options).toEqual({ repairHint: 'x' });
  });

  it('refuses an answer nobody scripted', async () => {
    const fake = new FakeProvider({ a: [{ text: '{}' }] });
    await expect(fake.gradeAnswer({ ...fixture('valid-c').input, anonId: 'b' })).rejects.toThrow(
      'No replies scripted for b',
    );
  });
});

describe('GeminiProvider', () => {
  const input = fixture('valid-c').input;

  function standIn(reply: () => Promise<Awaited<ReturnType<GeminiModels['generateContent']>>>) {
    const sent: GenerateContentParameters[] = [];
    const models: GeminiModels = {
      generateContent: (params) => {
        sent.push(params);
        return reply();
      },
    };
    return { sent, provider: new GeminiProvider({ apiKey: 'unused', models }) };
  }

  it('asks for JSON with the schema, the system prompt and a low temperature', async () => {
    const { sent, provider } = standIn(async () => ({
      text: '{"ok":1}',
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
    }));
    const result = await provider.gradeAnswer(input, { repairHint: 'fix total' });
    expect(result).toEqual({ text: '{"ok":1}', usage: { inputTokens: 120, outputTokens: 40 } });
    const params = sent[0];
    expect(params?.model).toBe('gemini-2.5-flash');
    expect(params?.config).toMatchObject({
      systemInstruction: SYSTEM_PROMPT,
      temperature: GEMINI_TEMPERATURE,
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_JSON_SCHEMA,
    });
    expect(JSON.stringify(params?.contents)).toContain('fix total');
    expect(provider.id).toBe('gemini');
  });

  it('returns empty text for a reply without text', async () => {
    const { provider } = standIn(async () => ({}));
    expect(await provider.gradeAnswer(input)).toEqual({ text: '' });
  });

  it('maps failures to retryable and final provider errors', async () => {
    const fail = (e: unknown) => standIn(() => Promise.reject(e)).provider.gradeAnswer(input);
    await expect(fail(new ApiError({ message: 'busy', status: 429 }))).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
    await expect(fail(new ApiError({ message: 'no', status: 503 }))).rejects.toMatchObject({
      kind: 'server',
      retryable: true,
    });
    await expect(fail(new ApiError({ message: 'key', status: 403 }))).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
    await expect(fail(new TypeError('fetch failed'))).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });
    expect(toProviderError({ status: 400 })).toMatchObject({ kind: 'bad_request' });
  });
});
