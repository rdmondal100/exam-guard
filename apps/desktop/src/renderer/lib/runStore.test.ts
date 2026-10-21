import { beforeEach, describe, expect, it } from 'vitest';
import type { RunResult } from '@examguard/shared';
import { runKey, useRunStore } from './runStore';
import { errorsText, statusLine, tabAfterRun } from './runStatus';

const result = (over: Partial<RunResult> = {}): RunResult => ({
  status: 'ok',
  exitCode: 0,
  timeMs: 12,
  stdout: 'hi',
  stderr: '',
  compileOutput: '',
  diagnostics: [],
  message: '',
  ...over,
});

beforeEach(() => useRunStore.setState({ stdin: {}, results: {}, running: null, cooldownUntil: 0 }));

describe('useRunStore', () => {
  const key = runKey('q1', 'c');

  it('keeps stdin per buffer', () => {
    useRunStore.getState().setStdin(key, '1 2');
    useRunStore.getState().setStdin(runKey('q1', 'js'), 'x');
    expect(useRunStore.getState().stdin).toEqual({ 'q1.c': '1 2', 'q1.js': 'x' });
  });

  it('clears the old result on start and sets the cooldown on finish', () => {
    const s = useRunStore.getState();
    s.finish(key, result({ stdout: 'old' }), 0);
    s.start(key);
    expect(useRunStore.getState()).toMatchObject({ running: key, results: {} });
    s.finish(key, result(), 1000);
    expect(useRunStore.getState()).toMatchObject({ running: null, cooldownUntil: 3000 });
    expect(useRunStore.getState().results[key]?.stdout).toBe('hi');
  });

  it('treats a cooldown refusal as a wait, not a result', () => {
    const s = useRunStore.getState();
    s.start(key);
    s.finish(key, result({ status: 'cooldown', retryInMs: 700 }), 1000);
    expect(useRunStore.getState()).toMatchObject({
      running: null,
      results: {},
      cooldownUntil: 1700,
    });
  });
});

describe('run status helpers', () => {
  it('describes a normal finish', () => {
    expect(statusLine(result())).toEqual({ text: 'Exit code 0 · 12 ms', tone: 'ok' });
    expect(statusLine(result({ exitCode: 3 })).tone).toBe('warn');
  });

  it('describes a limit with its message', () => {
    const r = result({ status: 'time_limit', exitCode: null, timeMs: 5003, message: 'Stopped: x' });
    expect(statusLine(r)).toEqual({ text: '5003 ms · Stopped: x', tone: 'error' });
  });

  it('opens Errors for a compile error or when only stderr has text', () => {
    expect(tabAfterRun(result({ status: 'compile_error', compileOutput: 'e' }))).toBe('errors');
    expect(tabAfterRun(result({ stdout: '', stderr: 'boom' }))).toBe('errors');
    expect(tabAfterRun(result())).toBe('output');
  });

  it('joins compiler output and stderr for the Errors tab', () => {
    expect(errorsText(result({ compileOutput: 'warn', stderr: 'err' }))).toBe('warn\n\nerr');
    expect(errorsText(result())).toBe('');
  });
});
