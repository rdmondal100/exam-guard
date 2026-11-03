/**
 * Load test host (M47): a real exam server in its own Node process, forked by the student sim
 * (`pnpm sim -- --scenario full`, no `--host`). It sets up a hosted exam for `--students N` plus a
 * few spare IDs for real students, then follows the sim's commands over the IPC channel
 * (`LoadHostCommand`) and samples its own CPU, memory and event loop every 5 s.
 *
 *   node dist/scripts/load-host.js --students 200 --minutes 30 [--data-dir <folder>]
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  LoadHostCommandSchema,
  TEACHER_TOKEN_HEADER,
  type LoadHostReply,
  type LoadHostSample,
} from '@examguard/shared';
import { buildTeacherApp } from '../app.js';
import { initDatabase } from '../db/connectDb.js';
import { LoadStatsRepo } from '../db/repositories/loadStats.repo.js';
import { lanAddresses } from '../utils/tls/lanAddresses.js';

const SAMPLE_MS = 5000;
const SPARE_CODES = ['9001', '9002', '9003', '9004', '9005'];

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const reply = (message: LoadHostReply) => process.send?.(message);

async function main(): Promise<void> {
  const students = Number(flag('students') ?? '200');
  const minutes = Number(flag('minutes') ?? '30');
  const given = flag('data-dir');
  const dataDir = given ?? mkdtempSync(join(tmpdir(), 'eg-load-'));
  const token = randomBytes(24).toString('hex');
  const db = initDatabase(dataDir);
  const teacher = buildTeacherApp({ token, db, hosting: { dataDir } });
  await teacher.listen({ host: '127.0.0.1', port: 0 });
  const teacherPort = (teacher.server.address() as { port: number }).port;

  const call = async (method: 'GET' | 'POST', path: string, body?: object) => {
    const res = await fetch(`http://127.0.0.1:${teacherPort}/api/v1${path}`, {
      method,
      headers: { [TEACHER_TOKEN_HEADER]: token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  await call('POST', '/auth/setup', { password: 'load test password' });
  const codes = [...Array.from({ length: students }, (_, i) => String(i + 1)), ...SPARE_CODES];
  const csvText = codes.map((code) => `${code},Student ${code}`).join('\n');
  const list = (await call('POST', '/class-lists/import', { name: 'Load', csvText })).list as {
    id: string;
  };
  // Long enough that the sim's own submits come first; the sim ends the exam afterwards.
  const exam = await call('POST', '/exams', {
    title: `Load test ${students} × ${minutes} min`,
    durationMin: minutes + 10,
    classListId: list.id,
  });
  const examId = String(exam.id);
  const criteria = [{ name: 'Correctness', maxMarks: 5 }];
  const question = (type: 'code' | 'written', allowedLanguages: string[], body: string) =>
    call('POST', `/exams/${examId}/questions`, {
      type,
      body,
      allowedLanguages,
      studentNote: '',
      sampleAnswer: 'x',
      sampleLanguage: allowedLanguages[0] ?? 'text',
      aiNotes: '',
      criteria,
    });
  await question('code', ['c', 'cpp', 'py'], 'Reverse a linked list');
  await question('code', ['js'], 'Debounce a function');
  await question('written', [], 'Explain a stack');
  await call('POST', `/exams/${examId}/ready`);
  const hosted = await call('POST', `/exams/${examId}/host`);

  const stats = new LoadStatsRepo(db);
  const samples: LoadHostSample[] = [];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let cpu = process.cpuUsage();
  let at = Date.now();
  const sampler = setInterval(() => {
    const used = process.cpuUsage(cpu);
    const now = Date.now();
    const memory = process.memoryUsage();
    samples.push({
      ts: now,
      cpuPct: ((used.user + used.system) / 1000 / (now - at)) * 100,
      rssMb: memory.rss / 1024 / 1024,
      heapMb: memory.heapUsed / 1024 / 1024,
      loopP99Ms: loop.percentile(99) / 1e6,
    });
    loop.reset();
    cpu = process.cpuUsage();
    at = now;
  }, SAMPLE_MS);

  const close = async () => {
    clearInterval(sampler);
    await teacher.close();
    db.close();
    if (!given) rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  };

  process.on('message', (raw: unknown) => {
    const parsed = LoadHostCommandSchema.safeParse(raw);
    if (!parsed.success) return;
    const command = parsed.data;
    const run = async () => {
      if (command.type === 'start') {
        await call('POST', `/exams/${examId}/start`);
        reply({ type: 'started' });
      } else if (command.type === 'stats') {
        reply({ type: 'stats', samples: samples.splice(0), counts: stats.counts(examId) });
      } else if (command.type === 'end') {
        await call('POST', `/exams/${examId}/end`);
        reply({ type: 'ended' });
      } else {
        await close();
      }
    };
    run().catch((e: unknown) =>
      reply({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  });
  process.on('disconnect', () => void close());

  reply({
    type: 'ready',
    examId,
    pin: String(hosted.pin),
    studentPort: Number(hosted.port),
    teacherPort,
    token,
    addresses: Array.isArray(hosted.addresses) ? hosted.addresses.map(String) : lanAddresses(),
    spareCodes: SPARE_CODES,
  });
}

main().catch((e: unknown) => {
  reply({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
