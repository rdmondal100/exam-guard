/** Latencies of one kind (ms), kept whole: a 30-minute run of 200 students is under 100k values. */
export class Latency {
  private readonly values: number[] = [];

  add(ms: number): void {
    this.values.push(ms);
  }

  get count(): number {
    return this.values.length;
  }

  /** `p` from 0 to 100; 0 when nothing was recorded. */
  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const at = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, at)] ?? 0;
  }

  max(): number {
    return this.values.reduce((a, b) => Math.max(a, b), 0);
  }
}

/** Everything one sim run measures (M47), shared by all its students and the teacher view. */
export class SimMetrics {
  /** `answer.save` first send → `answer.ack`. */
  readonly saveLag = new Latency();
  /** `event` first send (its first screenshot chunk) → `event.ack`. */
  readonly eventLag = new Latency();
  /** `event` first send → the teacher's `alert`. */
  readonly alertLag = new Latency();
  /** Payload bytes the students sent and got. */
  up = 0;
  down = 0;
  /** Payload bytes the teacher socket got, and its thumbnail frames. */
  teacherDown = 0;
  teacherThumbs = 0;
}
