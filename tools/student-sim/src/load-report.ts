import type { LoadHostCounts, LoadHostSample } from '@examguard/shared';
import type { Latency, SimMetrics } from './metrics.js';
import type { SimRun } from './run-sim.js';

export interface ReportInput {
  students: number;
  /** From the first student's start to the last receipt (ms). */
  elapsedMs: number;
  run: SimRun;
  metrics: SimMetrics;
  /** Self-hosted runs only. */
  samples: LoadHostSample[];
  counts: LoadHostCounts | null;
}

export interface Report {
  table: string;
  passed: boolean;
}

const ms = (latency: Latency) =>
  latency.count === 0
    ? 'n/a'
    : `p50 ${latency.percentile(50)} · p95 ${latency.percentile(95)} · max ${latency.max()} ms`;

/** The M47 results table (Markdown) and whether the acceptance targets held. */
export function buildReport({
  students,
  elapsedMs,
  run,
  metrics,
  samples,
  counts,
}: ReportInput): Report {
  const c = run.counts();
  const saves = run.saves();
  const events = run.events();
  const submits = run.submits();
  const thumbs = run.thumbs();
  const seconds = Math.max(1, elapsedMs / 1000);
  const kbs = (bytes: number) => `${(bytes / 1024 / seconds).toFixed(0)} KB/s`;
  const cpu = samples.map((s) => s.cpuPct);
  const avg = cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : 0;
  const top = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0);

  const checks: [string, boolean][] = [
    ['no student failed', c.failed === 0],
    ['no save waiting for an ack', saves.pending === 0],
    ['no event waiting for an ack', events.pending === 0],
    [
      'every student has a good receipt',
      submits.receipts === students && submits.problems.length === 0,
    ],
    ['save ack p95 < 1 s', metrics.saveLag.count > 0 && metrics.saveLag.percentile(95) < 1000],
  ];
  if (counts) {
    checks.push(['every sim event stored', counts.agentEvents >= events.made]);
    checks.push([
      'alert lag p95 < 2 s',
      metrics.alertLag.count > 0 && metrics.alertLag.percentile(95) < 2000,
    ]);
  }

  const rows: [string, string][] = [
    ['Students', `${students} (failed ${c.failed})`],
    ['Run time', `${(elapsedMs / 60_000).toFixed(1)} min`],
    ['Saves', `sent ${saves.sent}, acked ${saves.acked}, waiting ${saves.pending}`],
    ['Save ack lag', ms(metrics.saveLag)],
    [
      'Events',
      `made ${events.made} (${events.withScreenshot} with a screenshot), acked ${events.acked}, waiting ${events.pending}`,
    ],
    ['Event ack lag', ms(metrics.eventLag)],
    ['Alert lag (event → teacher)', ms(metrics.alertLag)],
    [
      'Receipts',
      `${submits.receipts} (own ${submits.selfSubmitted}), bad ${submits.problems.length}`,
    ],
    ['Drops / reconnects', String(submits.disconnects)],
    ['Student traffic (all)', `up ${kbs(metrics.up + thumbs.bytes)}, down ${kbs(metrics.down)}`],
    ['Teacher socket', `${kbs(metrics.teacherDown)}, ${metrics.teacherThumbs} thumbnails`],
  ];
  if (counts) {
    rows.push([
      'DB rows',
      `events ${counts.events} (agent ${counts.agentEvents}, screenshots ${counts.withScreenshot}), answer versions ${counts.answerVersions}, final answers ${counts.finalAnswers}`,
    ]);
  }
  if (samples.length > 0) {
    rows.push(['Server CPU (one core)', `avg ${avg.toFixed(1)} %, max ${top(cpu).toFixed(1)} %`]);
    rows.push([
      'Server memory',
      `RSS max ${top(samples.map((s) => s.rssMb)).toFixed(0)} MB, heap max ${top(samples.map((s) => s.heapMb)).toFixed(0)} MB`,
    ]);
    rows.push([
      'Server event loop p99',
      `max ${top(samples.map((s) => s.loopP99Ms)).toFixed(0)} ms`,
    ]);
  }
  const table = [
    '| Metric | Value |',
    '| --- | --- |',
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
    '',
    ...checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'}  ${name}`),
  ].join('\n');
  return { table, passed: checks.every(([, ok]) => ok) };
}
