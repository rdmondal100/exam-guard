import type { ThumbStart } from '@examguard/shared';

export interface ThumbCaptureDeps {
  /** A JPEG of the whole primary screen, `width` px wide; `null` when capture failed. */
  capture(width: number): Promise<Uint8Array | null>;
  send(jpeg: Uint8Array, capturedAt: number): void;
  now?: () => number;
}

/**
 * Grid thumbnails (M33): captures the screen every `intervalMs` while the server asks for it
 * (`thumb.start`, only students on the teacher's visible page) and the exam is being monitored.
 * The first picture goes at once, so a page switch fills quickly. Captures never overlap; a slow
 * one skips the next tick.
 */
export class ThumbCapture {
  private command: ThumbStart | null = null;
  private monitoring = false;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly now: () => number;

  constructor(private readonly deps: ThumbCaptureDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** `thumb.start`, or `null` for `thumb.stop` and a closed socket. */
  setCommand(command: ThumbStart | null): void {
    const same =
      command &&
      this.command?.intervalMs === command.intervalMs &&
      this.command.width === command.width;
    this.command = command;
    if (!same) this.restart();
  }

  /** Whether the exam is running for this student (the same rule as the agent's monitoring). */
  setMonitoring(on: boolean): void {
    if (this.monitoring === on) return;
    this.monitoring = on;
    this.restart();
  }

  get running(): boolean {
    return this.timer !== null;
  }

  stop(): void {
    this.command = null;
    this.restart();
  }

  private restart(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const command = this.command;
    if (!command || !this.monitoring) return;
    this.timer = setInterval(() => void this.tick(command.width), command.intervalMs);
    void this.tick(command.width);
  }

  private async tick(width: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const jpeg = await this.deps.capture(width).catch(() => null);
      // The page may have changed while capturing.
      if (jpeg && this.timer) this.deps.send(jpeg, this.now());
    } finally {
      this.busy = false;
    }
  }
}
