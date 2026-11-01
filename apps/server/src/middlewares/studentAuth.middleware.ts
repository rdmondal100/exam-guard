/** The token of an `Authorization: Bearer <token>` header, or `undefined`. */
export function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match?.[1];
}
