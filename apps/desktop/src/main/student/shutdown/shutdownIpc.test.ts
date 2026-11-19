import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@examguard/shared';
import { handleShutdown, shutdownAllowed } from './shutdownIpc.js';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

const exam = (over: Partial<SessionState>) => ({ examState: 'running', ...over }) as SessionState;

describe('shut down after submitting (M57)', () => {
  it('is allowed only with a receipt or once the exam is over', () => {
    expect(shutdownAllowed(null)).toBe(false);
    expect(shutdownAllowed(exam({}))).toBe(false);
    expect(shutdownAllowed(exam({ receipt: {} as never }))).toBe(true);
    expect(shutdownAllowed(exam({ examState: 'ended' }))).toBe(true);
    expect(shutdownAllowed(exam({ examState: 'hosting' }))).toBe(false);
  });

  it('refuses before the answers are submitted and never runs shutdown then', async () => {
    const run = vi.fn(async () => undefined);
    await expect(handleShutdown({ exam: () => exam({}), run })).rejects.toThrow(/Submit/);
    expect(run).not.toHaveBeenCalled();
    await handleShutdown({ exam: () => exam({ receipt: {} as never }), run });
    expect(run).toHaveBeenCalledOnce();
  });

  it('waits for unsent evidence, but not forever (M60)', async () => {
    const run = vi.fn(async () => {});
    let pending = 3;
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      pending -= 1;
    };
    const receipt = () => exam({ receipt: {} as never });
    await handleShutdown({ exam: receipt, pendingEvidence: () => pending, run, sleep });
    expect(sleeps).toHaveLength(3);
    expect(run).toHaveBeenCalledOnce();
    const stuck = vi.fn(async () => {});
    await handleShutdown({
      exam: receipt,
      pendingEvidence: () => 1,
      run: stuck,
      sleep,
      waitMs: 1000,
    });
    expect(stuck).toHaveBeenCalledOnce();
  });
});
