import { describe, expect, it } from 'vitest';
import { buildReport } from './load-report.js';
import { SimMetrics } from './metrics.js';
import type { SimRun } from './run-sim.js';

function fakeRun(over: { pendingSaves?: number; receipts?: number } = {}): SimRun {
  return {
    counts: () => ({ total: 2, joining: 0, connecting: 0, connected: 2, failed: 0 }),
    settled: () => Promise.resolve(),
    stop: () => {},
    failures: () => new Map(),
    saves: () => ({
      sent: 10,
      acked: 10 - (over.pendingSaves ?? 0),
      pending: over.pendingSaves ?? 0,
    }),
    submits: () => ({
      receipts: over.receipts ?? 2,
      selfSubmitted: 2,
      disconnects: 1,
      refused: 0,
      problems: [],
    }),
    thumbs: () => ({ streaming: 0, starts: 1, sent: 4, bytes: 4096 }),
    events: () => ({ made: 3, acked: 3, pending: 0, withScreenshot: 2 }),
  };
}

function metrics(saveMs: number, alertMs: number): SimMetrics {
  const m = new SimMetrics();
  m.saveLag.add(saveMs);
  m.alertLag.add(alertMs);
  m.eventLag.add(5);
  return m;
}

const counts = {
  events: 3,
  agentEvents: 3,
  withScreenshot: 2,
  answerVersions: 10,
  finalAnswers: 2,
};
const samples = [{ ts: 1, cpuPct: 4, rssMb: 150, heapMb: 40, loopP99Ms: 12 }];

describe('buildReport', () => {
  it('passes when nothing is lost and the lags are under target', () => {
    const report = buildReport({
      students: 2,
      elapsedMs: 60_000,
      run: fakeRun(),
      metrics: metrics(300, 50),
      samples,
      counts,
    });
    expect(report.passed).toBe(true);
    expect(report.table).toContain('| Server CPU (one core) | avg 4.0 %, max 4.0 % |');
    expect(report.table).toContain('PASS  alert lag p95 < 2 s');
  });

  it('fails on a waiting save, a missing receipt, a slow ack or a lost event', () => {
    const input = { students: 2, elapsedMs: 60_000, samples, counts };
    expect(
      buildReport({ ...input, run: fakeRun({ pendingSaves: 1 }), metrics: metrics(1, 1) }).passed,
    ).toBe(false);
    expect(
      buildReport({ ...input, run: fakeRun({ receipts: 1 }), metrics: metrics(1, 1) }).passed,
    ).toBe(false);
    expect(buildReport({ ...input, run: fakeRun(), metrics: metrics(1500, 1) }).passed).toBe(false);
    expect(buildReport({ ...input, run: fakeRun(), metrics: metrics(1, 2500) }).passed).toBe(false);
    const lost = { ...counts, agentEvents: 2 };
    expect(
      buildReport({ ...input, counts: lost, run: fakeRun(), metrics: metrics(1, 1) }).passed,
    ).toBe(false);
  });

  it('skips the server rows and checks without a self-hosted server', () => {
    const report = buildReport({
      students: 2,
      elapsedMs: 60_000,
      run: fakeRun(),
      metrics: metrics(300, 50),
      samples: [],
      counts: null,
    });
    expect(report.passed).toBe(true);
    expect(report.table).not.toContain('Server CPU');
    expect(report.table).not.toContain('alert lag');
  });
});
