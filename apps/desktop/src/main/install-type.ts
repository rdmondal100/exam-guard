import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InstallTypeSchema, type InstallType } from '@examguard/shared';

const run = promisify(execFile);
const REG_KEY = 'HKLM\\Software\\ExamGuard';

/** Pulls the value out of `reg query ... /v InstallType` output. Anything unexpected is `dev`. */
export function parseRegQueryOutput(text: string): InstallType {
  const match = /InstallType\s+REG_SZ\s+(\S+)/i.exec(text);
  const parsed = InstallTypeSchema.safeParse(match?.[1]?.toLowerCase());
  return parsed.success ? parsed.data : 'dev';
}

export interface InstallTypeOptions {
  /** Only honoured when the app is not packaged. */
  override?: string | undefined;
  isPackaged: boolean;
}

export async function readInstallType({
  override,
  isPackaged,
}: InstallTypeOptions): Promise<InstallType> {
  if (!isPackaged && override) {
    const parsed = InstallTypeSchema.safeParse(override.toLowerCase());
    if (parsed.success) return parsed.data;
  }
  try {
    const { stdout } = await run('reg', ['query', REG_KEY, '/v', 'InstallType'], {
      windowsHide: true,
    });
    return parseRegQueryOutput(stdout);
  } catch {
    return 'dev'; // key missing: developer machine
  }
}
