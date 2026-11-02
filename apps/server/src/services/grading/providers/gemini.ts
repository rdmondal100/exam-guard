import { ApiError, GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import { PROMPT_VERSION, RESPONSE_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from '../prompt.js';
import {
  ProviderError,
  errorKindForStatus,
  type GradingInput,
  type GradingOptions,
  type GradingProvider,
  type ProviderResult,
} from '../provider.js';

/** Used until the teacher picks a model in Settings (M43). */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
/** Low temperature for consistent marks (requirements §8.9). */
export const GEMINI_TEMPERATURE = 0.1;

/** The part of the SDK the adapter calls; tests pass a stand-in, never the real API. */
export interface GeminiModels {
  generateContent(params: GenerateContentParameters): Promise<{
    text?: string | undefined;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  }>;
}

export interface GeminiOptions {
  /** The teacher's key, decrypted in main and handed over only for grading. Never stored here. */
  apiKey: string;
  model?: string;
  /** Tests only. */
  models?: GeminiModels;
}

/**
 * Google Gemini (docs/architecture.md §7): JSON output with a response schema, temperature 0.1.
 * Failed calls become `ProviderError`s so the pipeline knows which ones to retry.
 */
export class GeminiProvider implements GradingProvider {
  readonly id = 'gemini';
  readonly model: string;
  readonly promptVersion = PROMPT_VERSION;
  private readonly models: GeminiModels;

  constructor(options: GeminiOptions) {
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.models = options.models ?? new GoogleGenAI({ apiKey: options.apiKey }).models;
  }

  async gradeAnswer(input: GradingInput, options: GradingOptions = {}): Promise<ProviderResult> {
    let response: Awaited<ReturnType<GeminiModels['generateContent']>>;
    try {
      response = await this.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input, options) }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: GEMINI_TEMPERATURE,
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          ...(options.signal ? { abortSignal: options.signal } : {}),
        },
      });
    } catch (e) {
      throw toProviderError(e);
    }
    const usage = response.usageMetadata;
    return {
      // No text (for example a blocked reply) fails validation and is retried like bad JSON.
      text: response.text ?? '',
      ...(usage
        ? {
            usage: {
              ...(usage.promptTokenCount !== undefined
                ? { inputTokens: usage.promptTokenCount }
                : {}),
              ...(usage.candidatesTokenCount !== undefined
                ? { outputTokens: usage.candidatesTokenCount }
                : {}),
            },
          }
        : {}),
    };
  }
}

/** Maps an SDK or network failure to a `ProviderError`. The key never appears in the message. */
export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const status =
    e instanceof ApiError
      ? e.status
      : typeof e === 'object' && e !== null && 'status' in e && typeof e.status === 'number'
        ? e.status
        : undefined;
  const kind = errorKindForStatus(status);
  const message =
    status === undefined
      ? 'Could not reach the AI provider'
      : `The AI provider answered ${status}${kind === 'auth' ? ' (check the API key)' : ''}`;
  return new ProviderError(kind, message, status);
}
