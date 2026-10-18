import { join } from 'node:path';

export const DEFAULT_PROFILE = 'default';
const PROFILE_NAME = /^[a-z0-9_-]{1,32}$/;

/** Reads `--profile <name>` or `--profile=<name>`. Invalid names throw. */
export function parseProfile(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;
    if (arg === '--profile') value = argv[i + 1];
    else if (arg?.startsWith('--profile=')) value = arg.slice('--profile='.length);
    else continue;
    if (value === undefined || !PROFILE_NAME.test(value)) {
      throw new Error(`Invalid --profile value: ${String(value)}`);
    }
    return value;
  }
  return DEFAULT_PROFILE;
}

/** The default profile keeps Electron's own folder; others get a sibling folder. */
export function userDataPathFor(defaultUserData: string, profile: string): string {
  return profile === DEFAULT_PROFILE ? defaultUserData : join(defaultUserData, 'profiles', profile);
}
