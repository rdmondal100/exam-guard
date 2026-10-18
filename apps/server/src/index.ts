import { ServerConfigMessageSchema, type ServerReplyMessage } from '@examguard/shared';
import { buildTeacherApp } from './http/teacher-app.js';

/** The slice of Electron's `process.parentPort` this entry uses. */
interface ParentPort {
  once(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: ServerReplyMessage): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

async function start(data: unknown, port: ParentPort): Promise<void> {
  const config = ServerConfigMessageSchema.parse(data);
  const app = buildTeacherApp({ token: config.token });
  await app.listen({ host: config.host, port: config.port });
  console.log(`teacher API listening on ${config.host}:${config.port}`);
  port.postMessage({ type: 'ready', port: config.port });
}

if (!parentPort) {
  console.error('Exam server must run as an Electron utilityProcess');
  process.exit(1);
} else {
  const port = parentPort;
  port.once('message', (event) => {
    start(event.data, port).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`server failed to start: ${message}`);
      port.postMessage({ type: 'error', message });
      process.exit(1);
    });
  });
}
