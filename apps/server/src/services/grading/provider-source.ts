import type { GradingProviderId } from '@examguard/shared';
import { ApiError } from '../../utils/ApiError.js';
import { GeminiProvider } from './providers/gemini.js';
import { SyntheticProvider } from './providers/synthetic.js';
import type { GradingProvider } from './provider.js';

/** Builds the grader for one grading run (M38). */
export interface ProviderSource {
  readonly id: GradingProviderId;
  create(): Promise<GradingProvider>;
}

/** A refusal before grading starts, sent as the HTTP error. */
export class GradingError extends ApiError {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.name = 'GradingError';
  }
}

/**
 * Gemini with the teacher's key, asked from main at the start of each run (and on resume), so
 * the key lives only in memory while grading. No key → 422 `no_api_key`.
 */
export function geminiSource(getKey: () => Promise<string | null>, model?: string): ProviderSource {
  return {
    id: 'gemini',
    create: async () => {
      const apiKey = await getKey();
      if (!apiKey) {
        throw new GradingError(
          422,
          'no_api_key',
          'No Gemini API key is set. Until Settings exists, start the app with EG_GEMINI_API_KEY set.',
        );
      }
      return new GeminiProvider({ apiKey, ...(model ? { model } : {}) });
    },
  };
}

/** The dev-only fake grader (`EG_FAKE_GRADER=1`): plausible marks, no network. */
export function syntheticSource(delayMs?: number): ProviderSource {
  return { id: 'fake', create: () => Promise.resolve(new SyntheticProvider(delayMs)) };
}

/** Always the same provider (tests pass a `FakeProvider`). */
export function fixedSource(
  provider: GradingProvider,
  id: GradingProviderId = 'fake',
): ProviderSource {
  return { id, create: () => Promise.resolve(provider) };
}
