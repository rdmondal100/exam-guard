import {
  GradingKeyMessageSchema,
  ReleaseDataMessageSchema,
  ServerConfigMessageSchema,
  type ServerReplyMessage,
} from '@examguard/shared';
import { initDatabase, type Db } from './db/connectDb.js';
import { buildTeacherApp, type TeacherApp } from './app.js';
import { syntheticSource } from './services/grading/provider-source.js';

/** The slice of Electron's `process.parentPort` this entry uses. */
interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: ServerReplyMessage): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

/** How long the server waits for main to hand over the grading key. */
const KEY_TIMEOUT_MS = 5000;

/**
 * Asks main for the teacher's Gemini key (architecture §7): it is decrypted there and lives here
 * only in memory, for one grading run. Never stored or logged.
 */
function keyRequester(port: ParentPort) {
  let nextId = 1;
  const waiting = new Map<number, (key: string | null) => void>();
  return {
    onMessage(data: unknown): void {
      const parsed = GradingKeyMessageSchema.safeParse(data);
      if (!parsed.success) return;
      waiting.get(parsed.data.requestId)?.(parsed.data.apiKey);
      waiting.delete(parsed.data.requestId);
    },
    request(): Promise<string | null> {
      const requestId = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          resolve(null);
        }, KEY_TIMEOUT_MS);
        waiting.set(requestId, (key) => {
          clearTimeout(timer);
          resolve(key);
        });
        port.postMessage({ type: 'grading-key-request', requestId });
      });
    },
  };
}

async function start(
  data: unknown,
  port: ParentPort,
  keys: ReturnType<typeof keyRequester>,
): Promise<Running> {
  const config = ServerConfigMessageSchema.parse(data);
  const db = initDatabase(config.dataDir);
  const teacher = buildTeacherApp({
    token: config.token,
    db,
    hosting: {
      dataDir: config.dataDir,
      onActive: (active) => port.postMessage({ type: 'hosting', active }),
    },
    grading: {
      // Gemini with the Settings model and the key main keeps encrypted (M43).
      ...(config.fakeGrader ? { source: syntheticSource() } : { getKey: () => keys.request() }),
    },
  });
  // Screenshot retention (M44) before anything is served; a failure must not stop the server.
  try {
    const removed = teacher.retention?.purge() ?? 0;
    if (removed > 0) console.log(`retention: deleted ${removed} old screenshots`);
  } catch (err) {
    console.error(`retention failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await teacher.listen({ host: config.host, port: config.port });
  // A student port that cannot be reopened must not take the teacher API down with it.
  await teacher.hosting?.resume().catch((err: unknown) => {
    console.error(`could not resume hosting: ${err instanceof Error ? err.message : String(err)}`);
  });
  console.log(`teacher API listening on ${config.host}:${config.port}`);
  port.postMessage({ type: 'ready', port: config.port });
  // Grading jobs left unfinished by a crash or restart carry on (M38).
  void teacher.grading.resume().catch((err: unknown) => {
    console.error(`could not resume grading: ${err instanceof Error ? err.message : String(err)}`);
  });
  return { db, teacher };
}

interface Running {
  db: Db;
  teacher: TeacherApp;
}

/**
 * `release-data` (M44): main is about to move the data folder. The check and closing the database
 * happen in one synchronous step, so no exam can start hosting in between; the process is then
 * stopped by main. When something still uses the data, nothing is closed.
 */
async function releaseData(running: Running, requestId: number, port: ParentPort): Promise<void> {
  const busy = running.teacher.maintenance.dataBusyReason();
  if (busy) {
    port.postMessage({ type: 'data-released', requestId, ok: false, message: busy });
    return;
  }
  running.db.close();
  await running.teacher.close().catch(() => undefined);
  port.postMessage({ type: 'data-released', requestId, ok: true });
}

if (!parentPort) {
  console.error('Exam server must run as an Electron utilityProcess');
  process.exit(1);
} else {
  const port = parentPort;
  const keys = keyRequester(port);
  let started = false;
  let running: Running | null = null;
  port.on('message', (event) => {
    if (started) {
      const release = ReleaseDataMessageSchema.safeParse(event.data);
      if (!release.success) return keys.onMessage(event.data);
      if (!running) {
        port.postMessage({
          type: 'data-released',
          requestId: release.data.requestId,
          ok: false,
          message: 'The exam server is still starting.',
        });
        return;
      }
      const requestId = release.data.requestId;
      void releaseData(running, requestId, port).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        port.postMessage({ type: 'data-released', requestId, ok: false, message });
      });
      return;
    }
    started = true;
    start(event.data, port, keys)
      .then((value) => {
        running = value;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`server failed to start: ${message}`);
        port.postMessage({ type: 'error', message });
        process.exit(1);
      });
  });
}
