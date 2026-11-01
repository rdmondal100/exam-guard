/** A refusal the routes turn into an HTTP error. */
export class HostingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HostingError';
  }
}
