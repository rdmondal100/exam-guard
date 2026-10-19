import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

const PasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

/** `POST /auth/setup` */
export const AuthSetupBodySchema = z.object({ password: PasswordSchema });
export type AuthSetupBody = z.infer<typeof AuthSetupBodySchema>;

/** `POST /auth/login`. No length rules, so a wrong short password is "wrong", not "invalid". */
export const AuthLoginBodySchema = z.object({ password: z.string().max(MAX_PASSWORD_LENGTH) });
export type AuthLoginBody = z.infer<typeof AuthLoginBodySchema>;

/** `GET /auth/status`: what the renderer needs to pick setup, login or home. */
export const AuthStatusSchema = z.object({
  setupRequired: z.boolean(),
  loggedIn: z.boolean(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const AuthOkSchema = z.object({ ok: z.literal(true) });

/** Standard error envelope (docs/protocol.md). */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
