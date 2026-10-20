import { Agent, request } from 'node:https';

export interface Target {
  host: string;
  port: number;
}

/** Shared by all fake students so 200 joins reuse a few TLS connections. */
export const agent = new Agent({ keepAlive: true, maxSockets: 20, rejectUnauthorized: false });

export interface JsonResponse {
  status: number;
  json: unknown;
}

/** POST JSON to the student API. The cert is self-signed, so the sim does not verify it. */
export function postJson(
  target: Target,
  path: string,
  body: unknown,
  token?: string,
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        host: target.host,
        port: target.port,
        path: `/api/v1${path}`,
        method: 'POST',
        agent,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: null });
          }
        });
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}
