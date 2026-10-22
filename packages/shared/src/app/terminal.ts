import { z } from 'zod';

/**
 * Exam terminal limits (architecture §4). The shell and everything started from it share one
 * Job Object: each process may use `memoryMb`, at most `processes` run at once, no wall time.
 */
export const TERMINAL_LIMITS = {
  memoryMb: 2_048,
  processes: 64,
  /** Output is batched for this long before it is pushed to the renderer. */
  flushMs: 16,
  maxInputChars: 64 * 1024,
} as const;

/** Renderer → main `terminal:open` and `terminal:resize`: the xterm.js grid size. */
export const TerminalSizeSchema = z.object({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(200),
});
export type TerminalSize = z.infer<typeof TerminalSizeSchema>;

/** Renderer → main `terminal:input`: keystrokes or pasted text, as xterm.js reports them. */
export const TerminalInputSchema = z.string().max(TERMINAL_LIMITS.maxInputChars);

/** Main → renderer `terminal:open` reply. `message` says why it could not open. */
export const TerminalOpenResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type TerminalOpenResult = z.infer<typeof TerminalOpenResultSchema>;

/** Main → renderer `terminal:status`: may the terminal open now, and is one already open. */
export const TerminalStatusSchema = z.object({
  available: z.boolean(),
  open: z.boolean(),
});
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;

/** Main → renderer push `terminal:data`: output bytes as text (ConPTY sends UTF-8). */
export const TerminalDataSchema = z.string();

/** Main → renderer push `terminal:exit`: the shell ended or was closed. */
export const TerminalExitSchema = z.object({
  exitCode: z.number().int().nullable(),
  /**
   * `closed`: the student or the app closed it; `exited`: the shell ended by itself;
   * `turned_off`: the teacher turned it off, its time ran out or the exam ended.
   */
  reason: z.enum(['closed', 'exited', 'turned_off']),
});
export type TerminalExit = z.infer<typeof TerminalExitSchema>;
