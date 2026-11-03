import type { LoadHostCounts, LoadHostSample } from '@examguard/shared';
import type { SimOptions } from './args.js';
import { buildReport } from './load-report.js';
import { SimMetrics } from './metrics.js';
import { runSim } from './run-sim.js';
import { SelfHost } from './self-host.js';
import { TeacherView } from './teacher-view.js';

const STATS_MS = 5000;
const PROGRESS_MS = 30_000;
/** Students submit in the last minute: from `minutes - 1` to `minutes - 1/4`. */
const SUBMIT_SPREAD_MS = 45_000;
/** Thumbnail page of the teacher view (the real grid shows about 30). */
const PAGE_SIZE = 30;
const PAGE_MS = 30_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The M47 load test: a full exam for every student (join, autosave, events with screenshots,
 * drops, thumbnails on the visible page, submit), then the results table. Without `--host` the
 * exam server runs in a forked process and a teacher socket watches it; with `--host` the sim
 * joins the teacher app's exam (the teacher starts it and watches Task Manager). Resolves with
 * the exit code: 0 when every target held.
 */
export async function runFull(options: SimOptions, codes: string[]): Promise<number> {
  const metrics = new SimMetrics();
  const eventTimes = new Map<string, number>();
  let host: SelfHost | null = null;
  let target = { host: options.host, port: options.port, pin: options.pin };
  let teacher: TeacherView | null = null;

  if (options.selfHost) {
    console.log(`Starting an exam server for ${codes.length} students…`);
    const started = await SelfHost.start(codes.length, options.minutes);
    host = started.host;
    const { ready } = started;
    target = { host: '127.0.0.1', port: ready.studentPort, pin: ready.pin };
    console.log(
      `Hosting on ${ready.addresses.join(', ') || '127.0.0.1'} port ${ready.studentPort}, PIN ${ready.pin}. ` +
        `A real student can join with ID ${ready.spareCodes.join(' / ')} before the start.`,
    );
    teacher = new TeacherView({
      port: ready.teacherPort,
      token: ready.token,
      examId: ready.examId,
      pageSize: PAGE_SIZE,
      pageMs: PAGE_MS,
      metrics,
      eventTimes,
    });
    teacher.start();
  }

  const submitAfterMs = (options.minutes - 1) * 60_000;
  const began = Date.now();
  const run = runSim(
    {
      ...target,
      rampMs: options.rampMs,
      autosaveMs: options.autosaveMs,
      submitAfterMs,
      disconnectEveryMs: options.disconnectEveryMs,
    },
    codes,
    undefined,
    { submitSpreadMs: SUBMIT_SPREAD_MS, eventsEveryMs: options.eventsEveryMs, metrics, eventTimes },
  );
  await run.settled();
  const joined = run.counts();
  console.log(
    `Joined ${joined.connected}/${joined.total} (failed ${joined.failed}) in ${Date.now() - began} ms`,
  );
  if (host) {
    await wait(2000);
    await host.begin();
    console.log(`Exam started; students submit after about ${options.minutes - 1} minutes.`);
  } else {
    console.log('Waiting for the teacher to press Start…');
  }

  const samples: LoadHostSample[] = [];
  let counts: LoadHostCounts | null = null;
  const collect = async () => {
    if (!host) return;
    const stats = await host.stats();
    samples.push(...stats.samples);
    counts = stats.counts;
  };
  const statsTimer = setInterval(() => void collect().catch(() => {}), STATS_MS);
  const progressTimer = setInterval(() => {
    const s = run.saves();
    const e = run.events();
    const u = run.submits();
    const last = samples.at(-1);
    console.log(
      `${((Date.now() - began) / 60_000).toFixed(1)} min · connected ${run.counts().connected} · saves ${s.acked}/${s.sent} · ` +
        `events ${e.acked}/${e.made} · receipts ${u.receipts} · drops ${u.disconnects}` +
        (last ? ` · server ${last.cpuPct.toFixed(1)} % CPU, ${last.rssMb.toFixed(0)} MB` : ''),
    );
  }, PROGRESS_MS);

  const live = codes.length - joined.failed;
  const giveUpAt = Date.now() + (options.minutes + (host ? 3 : 15)) * 60_000;
  while (run.submits().receipts < live && Date.now() < giveUpAt) await wait(1000);
  // Acks still on their way.
  await wait(3000);
  const elapsedMs = Date.now() - began;
  clearInterval(statsTimer);
  clearInterval(progressTimer);
  await collect();
  teacher?.stop();
  run.stop();
  if (host) {
    await host.end().catch(() => {});
    await host.close();
  }

  const report = buildReport({ students: codes.length, elapsedMs, run, metrics, samples, counts });
  console.log(`\n${report.table}`);
  for (const [code, why] of [...run.failures()].slice(0, 5)) console.log(`  ${code}: ${why}`);
  for (const { code, problem } of run.submits().problems.slice(0, 5))
    console.log(`  ${code}: ${problem}`);
  return report.passed ? 0 : 1;
}
