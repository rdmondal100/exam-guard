import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ExamFile } from '@examguard/shared';
import { connectPinned, PinError, type PinnedTarget } from '../tls-pin.js';

export type DownloadFailure =
  'unreachable' | 'fingerprint_mismatch' | 'refused' | 'bad_size' | 'bad_hash' | 'failed';

export class DownloadError extends Error {
  constructor(
    readonly code: DownloadFailure,
    message: string,
    /** Whether trying again can help (a refusal such as "Files are off" cannot). */
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadOptions {
  target: PinnedTarget;
  /** The student's session token. */
  token: string;
  file: ExamFile;
  /** Where the verified file ends up; it is written next to it as `.part` first. */
  destPath: string;
  /** Idle time on the connection before the download is given up. */
  timeoutMs?: number;
}

/**
 * Downloads one of the teacher's exam files over the pinned connection (the fingerprint is
 * checked before any byte is sent, as for every student call). The bytes are streamed to
 * `<destPath>.part` while they are counted and hashed; the file is renamed to `destPath` only if
 * its size and SHA-256 are what the manifest said, so a half file or a wrong file never appears.
 */
export async function downloadExamFile({
  target,
  token,
  file,
  destPath,
  timeoutMs = 20_000,
}: DownloadOptions): Promise<void> {
  const connected = await connectPinned({ ...target, timeoutMs }).catch((e: unknown) => {
    throw e instanceof PinError ? new DownloadError(e.code, e.message) : e;
  });
  const part = `${destPath}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > file.size) {
        done(new DownloadError('bad_size', `${file.name} is larger than the server said`));
        return;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await mkdir(dirname(destPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          host: target.address,
          port: target.port,
          method: 'GET',
          path: `/api/v1/exam-files/${encodeURIComponent(file.id)}`,
          headers: { authorization: `Bearer ${token}` },
          agent: false,
          // The socket is already pinned; this only stops a second chain check on it.
          rejectUnauthorized: false,
          createConnection: () => connected.socket,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            res.resume();
            reject(new DownloadError('refused', `The server answered ${status}`, status >= 500));
            return;
          }
          if (Number(res.headers['content-length']) !== file.size) {
            res.resume();
            reject(new DownloadError('bad_size', `${file.name} is not the size the server said`));
            return;
          }
          pipeline(res, meter, createWriteStream(part)).then(resolve, reject);
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error('The download timed out')));
      req.on('error', (e) => reject(e));
      req.end();
    });
    if (bytes !== file.size) {
      throw new DownloadError('bad_size', `${file.name} ended early`);
    }
    if (hash.digest('hex') !== file.sha256) {
      throw new DownloadError('bad_hash', `${file.name} did not match its checksum`);
    }
    await rename(part, destPath);
  } catch (e) {
    await rm(part, { force: true });
    if (e instanceof DownloadError) throw e;
    throw new DownloadError('failed', e instanceof Error ? e.message : String(e));
  } finally {
    connected.socket.destroy();
  }
}
