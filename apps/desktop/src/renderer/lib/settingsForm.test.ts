import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_LIMITS } from '@examguard/shared';
import { limitsDraft, limitsFromDraft } from './settingsForm';
import { splitApps } from './appList';

describe('settings form (M43)', () => {
  it('shows run limits in seconds, MB and KB and converts them back', () => {
    const draft = limitsDraft(DEFAULT_RUN_LIMITS);
    expect(draft).toEqual({ timeSec: '600', memoryMb: '256', outputKb: '64', processes: '8' });
    expect(limitsFromDraft(draft)).toEqual({ ok: true, limits: DEFAULT_RUN_LIMITS });
    expect(limitsFromDraft({ ...draft, timeSec: '2.5' })).toMatchObject({ ok: false });
    expect(limitsFromDraft({ ...draft, timeSec: '30' })).toMatchObject({
      ok: true,
      limits: { timeMs: 30_000 },
    });
  });

  it('names every field that is out of range or empty', () => {
    const result = limitsFromDraft({ timeSec: '1', memoryMb: '', outputKb: '64', processes: '99' });
    expect(result).toEqual({
      ok: false,
      problems: ['Time limit: 5 to 3600 seconds', 'Memory: 32 to 4096 MB', 'Processes: 1 to 64'],
    });
  });

  it('splits the app list', () => {
    expect(splitApps(' chrome.exe, ,discord.exe ')).toEqual(['chrome.exe', 'discord.exe']);
  });
});
