import {
  DEFAULT_SETTINGS,
  TeacherSettingsSchema,
  type SettingsPatch,
  type TeacherSettings,
} from '@examguard/shared';
import type { SettingsRepo } from '../../db/repositories/settings.repo.js';

type Section = keyof TeacherSettings;

/** The `settings` row of each section (docs/data-model.md). */
const KEYS: Record<Section, string> = {
  ai: 'ai',
  grading: 'grading',
  defaults: 'defaults',
  runLimits: 'runner.limits',
  server: 'server',
};

const SECTIONS = Object.keys(KEYS) as Section[];

/**
 * The teacher's settings (M43): one JSON row per section, each validated on read. A missing or
 * damaged row falls back to the default of that section, so an old database just works. The AI
 * key is never here (main keeps it with `safeStorage`).
 */
export class SettingsService {
  private cache: TeacherSettings | null = null;

  constructor(private readonly repo: SettingsRepo) {}

  get(): TeacherSettings {
    if (this.cache) return this.cache;
    const read = <S extends Section>(section: S): TeacherSettings[S] => {
      const parsed = TeacherSettingsSchema.shape[section].safeParse(this.repo.get(KEYS[section]));
      return (parsed.success ? parsed.data : DEFAULT_SETTINGS[section]) as TeacherSettings[S];
    };
    this.cache = {
      ai: read('ai'),
      grading: read('grading'),
      defaults: read('defaults'),
      runLimits: read('runLimits'),
      server: read('server'),
    };
    return this.cache;
  }

  /** Replaces the given sections (each already validated by `SettingsPatchSchema`). */
  update(patch: SettingsPatch): TeacherSettings {
    for (const section of SECTIONS) {
      const value = patch[section];
      if (value !== undefined) this.repo.set(KEYS[section], value);
    }
    this.cache = null;
    return this.get();
  }
}
