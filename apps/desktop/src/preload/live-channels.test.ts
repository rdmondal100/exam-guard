import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '../shared/ipc-channels.js';

describe('live view preload', () => {
  const source = readFileSync(join(import.meta.dirname, 'live.ts'), 'utf8');

  it('uses the same channel names as main', () => {
    for (const channel of [IPC.liveStart, IPC.liveSignal, IPC.livePage]) {
      expect(source).toContain(`'${channel}'`);
    }
  });

  it('imports nothing but electron and types, so the build makes no shared chunk', () => {
    const imports = [...source.matchAll(/^import (type )?.* from '([^']+)';$/gm)];
    const runtime = imports.filter((m) => !m[1]).map((m) => m[2]);
    expect(runtime).toEqual(['electron']);
  });
});
