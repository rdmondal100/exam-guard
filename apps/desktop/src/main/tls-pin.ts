import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { connect, type TLSSocket } from 'node:tls';

/** SHA-256 of a DER certificate as base64url, the form in the mDNS TXT `fp`. */
export function fingerprintOfDer(der: Uint8Array): string {
  return createHash('sha256').update(der).digest('base64url');
}

export type PinFailure = 'unreachable' | 'fingerprint_mismatch';

export class PinError extends Error {
  constructor(
    readonly code: PinFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PinError';
  }
}

export interface PinnedTarget {
  address: string;
  port: number;
  /** Required fingerprint. When omitted the cert is trusted on first use and reported back. */
  expectedFingerprint?: string | undefined;
  timeoutMs?: number;
}

export interface PinnedResponse {
  status: number;
  body: string;
  /** Fingerprint of the cert that was actually presented. */
  fingerprint: string;
}

/**
 * Opens TLS and checks the fingerprint BEFORE any HTTP byte is sent, so a PIN can never reach a
 * host with the wrong cert. Chain validation is off: the cert is self-signed, the pin is the trust.
 */
export function connectPinned(
  target: PinnedTarget,
): Promise<{ socket: TLSSocket; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: target.address,
      port: target.port,
      rejectUnauthorized: false,
      // The cert has no name for an IP; the pin replaces the hostname check.
      servername: '',
    });
    const fail = (error: PinError) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(target.timeoutMs ?? 5000, () =>
      fail(new PinError('unreachable', 'The connection timed out')),
    );
    socket.once('error', (e) => fail(new PinError('unreachable', e.message)));
    socket.once('secureConnect', () => {
      const der = socket.getPeerCertificate().raw;
      if (!der) return fail(new PinError('unreachable', 'The host sent no certificate'));
      const fingerprint = fingerprintOfDer(der);
      if (target.expectedFingerprint && target.expectedFingerprint !== fingerprint) {
        return fail(
          new PinError('fingerprint_mismatch', 'The certificate does not match the pinned one'),
        );
      }
      socket.setTimeout(0);
      resolve({ socket, fingerprint });
    });
  });
}

export interface PinnedRequestOptions {
  method?: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string>;
  /** Sent as JSON with a content-length. */
  json?: unknown;
}

/** One HTTPS GET to a pinned host. */
export function pinnedGet(target: PinnedTarget, path: string): Promise<PinnedResponse> {
  return pinnedRequest(target, { path });
}

/** One HTTPS request to a pinned host. The first HTTP byte goes out only after the pin matched. */
export async function pinnedRequest(
  target: PinnedTarget,
  options: PinnedRequestOptions,
): Promise<PinnedResponse> {
  const { socket, fingerprint } = await connectPinned(target);
  const payload = options.json === undefined ? undefined : JSON.stringify(options.json);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: target.address,
        port: target.port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: {
          ...(payload === undefined
            ? {}
            : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
          ...options.headers,
        },
        agent: false,
        // The socket above is already pinned; this only stops a second chain check on it.
        rejectUnauthorized: false,
        createConnection: () => socket,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, fingerprint }));
        res.on('error', (e) => reject(new PinError('unreachable', e.message)));
      },
    );
    req.setTimeout(target.timeoutMs ?? 5000, () => req.destroy(new Error('The request timed out')));
    req.on('error', (e) => reject(new PinError('unreachable', e.message)));
    req.end(payload);
  });
}
