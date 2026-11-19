import { describe, expect, it } from 'vitest';
import { ipcErrorText } from './ipcError';

describe('ipcErrorText', () => {
  it("drops Electron's remote-method prefix", () => {
    const e = new Error(
      "Error invoking remote method 'shutdownPc': Error: Submit your exam first.",
    );
    expect(ipcErrorText(e)).toBe('Submit your exam first.');
  });

  it('keeps any other message as it is', () => {
    expect(ipcErrorText(new Error('Disk full'))).toBe('Disk full');
    expect(ipcErrorText('plain')).toBe('plain');
  });
});
