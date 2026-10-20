import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REG_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography';

/** Pulls the GUID out of `reg query ... /v MachineGuid` output. */
export function parseMachineGuid(text: string): string | undefined {
  return /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(text)?.[1];
}

/** `SHA-256(MachineGuid + "examguard")` as hex (docs/architecture.md §6). */
export function deviceIdOf(machineGuid: string): string {
  return createHash('sha256').update(`${machineGuid}examguard`).digest('hex');
}

export interface DeviceIdOptions {
  /** Only honoured when the app is not packaged: lets two dev profiles act as two computers. */
  override?: string | undefined;
  isPackaged: boolean;
}

let cached: Promise<string> | undefined;

/** Stable id of this computer. Throws if Windows will not tell us (join then cannot proceed). */
export function readDeviceId({ override, isPackaged }: DeviceIdOptions): Promise<string> {
  if (!isPackaged && override) return Promise.resolve(deviceIdOf(`override:${override}`));
  cached ??= run('reg', ['query', REG_KEY, '/v', 'MachineGuid'], { windowsHide: true }).then(
    ({ stdout }) => {
      const guid = parseMachineGuid(stdout);
      if (!guid) throw new Error('MachineGuid not found');
      return deviceIdOf(guid);
    },
  );
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}
