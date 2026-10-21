import { describe, expect, it } from 'vitest';
import { ExamLock, type LockableWindow } from './exam-lock.js';

function fakeWindow() {
  const handlers: Record<string, (event: { preventDefault(): void }) => void> = {};
  const win = {
    fullScreen: false,
    on: (event: string, listener: (event: { preventDefault(): void }) => void) => {
      handlers[event] = listener;
    },
    setFullScreen(flag: boolean) {
      win.fullScreen = flag;
    },
    isDestroyed: () => false,
  };
  const tryClose = () => {
    let prevented = false;
    handlers['close']?.({ preventDefault: () => (prevented = true) });
    return prevented;
  };
  return { win, handlers, tryClose };
}

describe('ExamLock', () => {
  it('lets the window close until an exam is running', () => {
    const { win, tryClose } = fakeWindow();
    const lock = new ExamLock();
    lock.attach(win as LockableWindow);
    expect(tryClose()).toBe(false);
    expect(lock.shouldBlockClose()).toBe(false);
  });

  it('goes fullscreen and blocks close while active', () => {
    const { win, tryClose } = fakeWindow();
    const lock = new ExamLock();
    lock.attach(win as LockableWindow);
    lock.setActive(true);
    expect(win.fullScreen).toBe(true);
    expect(tryClose()).toBe(true);
    expect(lock.shouldBlockClose()).toBe(true);
  });

  it('releases the window when the exam is no longer active', () => {
    const { win, tryClose } = fakeWindow();
    const lock = new ExamLock();
    lock.attach(win as LockableWindow);
    lock.setActive(true);
    lock.setActive(false);
    expect(win.fullScreen).toBe(false);
    expect(tryClose()).toBe(false);
  });

  it('goes back to fullscreen if it is left during the exam', () => {
    const { win, handlers } = fakeWindow();
    const lock = new ExamLock();
    lock.attach(win as LockableWindow);
    lock.setActive(true);
    win.fullScreen = false;
    handlers['leave-full-screen']?.({ preventDefault: () => {} });
    expect(win.fullScreen).toBe(true);
  });

  it('does not block when the dev escape hatch is on', () => {
    const { win, tryClose } = fakeWindow();
    const lock = new ExamLock(true);
    lock.attach(win as LockableWindow);
    lock.setActive(true);
    expect(tryClose()).toBe(false);
  });
});
