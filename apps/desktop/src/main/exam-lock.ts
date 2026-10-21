/** The slice of BrowserWindow the lock needs, so tests can use a fake. */
export interface LockableWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: 'leave-full-screen', listener: () => void): unknown;
  setFullScreen(flag: boolean): void;
  isDestroyed(): boolean;
}

/**
 * While an exam is running the window is fullscreen and cannot be closed (Alt+F4, close button,
 * quit). It is not always-on-top: ExamGuard monitors, it does not block (CLAUDE.md).
 */
export class ExamLock {
  private active = false;
  private win: LockableWindow | null = null;

  /** `allowClose` is a dev escape hatch; the caller only sets it when the app is not packaged. */
  constructor(private readonly allowClose = false) {}

  attach(win: LockableWindow): void {
    this.win = win;
    win.on('close', (event) => {
      if (this.shouldBlockClose()) event.preventDefault();
    });
    win.on('leave-full-screen', () => {
      if (this.active && !this.allowClose && !win.isDestroyed()) win.setFullScreen(true);
    });
  }

  shouldBlockClose(): boolean {
    return this.active && !this.allowClose;
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (this.win && !this.win.isDestroyed()) this.win.setFullScreen(active);
  }
}
