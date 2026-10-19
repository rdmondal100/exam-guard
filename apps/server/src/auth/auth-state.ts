import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../http/errors.js';

/** Whether the teacher has logged in since this server process started. */
export class AuthState {
  private loggedIn = false;

  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  setLoggedIn(value: boolean): void {
    this.loggedIn = value;
  }

  /** Fastify `preHandler` for every teacher route except `/health` and `/auth/*`. */
  requireLogin = async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> =>
    this.loggedIn ? undefined : sendError(reply, 401, 'login_required', 'Log in first');
}
