import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_LIMITS } from '@examguard/shared';
import { limitsDraft, limitsFromDraft } from './settingsForm';
import { splitApps } from './appList';

describe('settings form (M43)', () => {
  it('shows run limits in seconds and KB and converts them back', () => {
    const draft = limitsDraft(DEFAULT_RUN_LIMITS);
    expect(draft).toEqual({ timeSec: '600', outputKb: '64' });
    expect(limitsFromDraft(draft)).toEqual({ ok: true, limits: DEFAULT_RUN_LIMITS });
    expect(limitsFromDraft({ ...draft, timeSec: '2.5' })).toMatchObject({ ok: false });
    expect(limitsFromDraft({ ...draft, timeSec: '30' })).toMatchObject({
      ok: true,
      limits: { timeMs: 30_000 },
    });
  });

  it('names every field that is out of range or empty', () => {
    const result = limitsFromDraft({ timeSec: '1', outputKb: '' });
    expect(result).toEqual({
      ok: false,
      problems: ['Time limit: 5 to 3600 seconds', 'Output: 4 to 4096 KB'],
    });
  });

  it('splits the app list', () => {
    expect(splitApps(' chrome.exe, ,discord.exe ')).toEqual(['chrome.exe', 'discord.exe']);
  });
});
