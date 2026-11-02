import { ApiError } from '../../utils/ApiError.js';

/** A refusal the error middleware turns into an HTTP error. */
export class HostingError extends ApiError {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.name = 'HostingError';
  }
}
