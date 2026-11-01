import type { FastifyReply } from 'fastify';

/** Sends the `{ error: { code, message, details? } }` envelope from docs/protocol.md. */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  return reply.code(status).send({ error: { code, message, details } });
}
