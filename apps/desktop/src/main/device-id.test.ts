import { describe, expect, it } from 'vitest';
import { deviceIdOf, parseMachineGuid, readDeviceId } from './device-id.js';

const REG_OUTPUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    4f1c2d3e-1111-2222-3333-444455556666
`;

describe('device id', () => {
  it('parses MachineGuid from reg output', () => {
    expect(parseMachineGuid(REG_OUTPUT)).toBe('4f1c2d3e-1111-2222-3333-444455556666');
    expect(parseMachineGuid('nothing here')).toBeUndefined();
  });

  it('hashes the guid with the examguard salt, stably', () => {
    const id = deviceIdOf('abc');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceIdOf('abc')).toBe(id);
    expect(deviceIdOf('abd')).not.toBe(id);
  });

  it('honours the override only when the app is not packaged', async () => {
    const dev = await readDeviceId({ override: 'laptop', isPackaged: false });
    expect(dev).toBe(deviceIdOf('override:laptop'));
    expect(await readDeviceId({ override: 'other', isPackaged: false })).not.toBe(dev);
  });
});
