import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { terminalEnv, terminalPaths } from './terminal-env.js';

const root = 'C:\\Users\\Ann Lee\\AppData\\Local\\ExamGuard\\run\\es1';
const paths = terminalPaths(root);

describe('terminalPaths', () => {
  it('keeps the workspace and ExamGuard files apart under the run root', () => {
    expect(paths).toEqual({
      workspace: join(root, 'workspace'),
      msysOverlay: join(root, 'workspace', '.msys'),
      support: join(root, '.examguard'),
      shims: join(root, '.examguard', 'bin'),
    });
  });
});

describe('terminalEnv', () => {
  const base = {
    Path: 'C:\\Windows\\system32;C:\\Windows',
    USERPROFILE: 'C:\\Users\\Ann Lee',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
    EG_TERMINAL: '1',
    EG_DEVICE_ID: 'x',
    VITE_DEV: '1',
  };

  it('puts shims, gcc, installed packages and then the system PATH in that order', () => {
    const env = terminalEnv({ base, paths, mingwBin: 'C:\\tools\\mingw64\\bin' });
    expect(env.PATH?.split(';')).toEqual([
      paths.shims,
      'C:\\tools\\mingw64\\bin',
      join(paths.msysOverlay, 'ucrt64', 'bin'),
      join(paths.workspace, 'node_modules', '.bin'),
      'C:\\Windows\\system32',
      'C:\\Windows',
    ]);
    expect(env).not.toHaveProperty('Path');
  });

  it('points gcc at the pacman packages and quiets npm', () => {
    const env = terminalEnv({ base, paths, mingwBin: null });
    expect(env.C_INCLUDE_PATH).toBe(join(paths.msysOverlay, 'ucrt64', 'include'));
    expect(env.CPLUS_INCLUDE_PATH).toBe(env.C_INCLUDE_PATH);
    expect(env.LIBRARY_PATH).toBe(join(paths.msysOverlay, 'ucrt64', 'lib'));
    expect(env.npm_config_update_notifier).toBe('false');
    expect(env.PATH?.split(';')[1]).toBe(join(paths.msysOverlay, 'ucrt64', 'bin'));
  });

  it('keeps the user environment but drops ExamGuard and Electron variables', () => {
    const env = terminalEnv({ base, paths, mingwBin: null });
    expect(env.USERPROFILE).toBe('C:\\Users\\Ann Lee');
    for (const key of [
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_RENDERER_URL',
      'EG_TERMINAL',
      'EG_DEVICE_ID',
      'VITE_DEV',
    ]) {
      expect(env).not.toHaveProperty(key);
    }
  });
});
