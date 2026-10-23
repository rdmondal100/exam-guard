import { z } from 'zod';

/**
 * State of the monitoring agent's Windows service as the student app sees it (main → renderer,
 * M19). `unknown` covers the in-between service states (starting, stopping) and query errors.
 */
export const AgentStateSchema = z.enum(['running', 'stopped', 'missing', 'unknown']);
export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * The student app's link to the agent over the verified pipe (M21). `verified` is false until the
 * agent has passed the app's checks and answered; `problems` says why the link or the system check
 * is not good, in words a student can read.
 */
export const AgentLinkStatusSchema = z.object({
  verified: z.boolean(),
  ok: z.boolean(),
  helper: z.boolean(),
  captureOk: z.boolean(),
  monitors: z.number().int().nonnegative(),
  problems: z.array(z.string()),
});
export type AgentLinkStatus = z.infer<typeof AgentLinkStatusSchema>;

export const AgentServiceStatusSchema = z.object({
  state: AgentStateSchema,
  /** The pipe link and the system check. Not `ok` when the service is stopped. */
  link: AgentLinkStatusSchema,
  /** `eg-agent.exe` was found next to the app (dev: in the Cargo target folder). */
  exeFound: z.boolean(),
  /** `EG_FAKE_AGENT=1` in a dev build: no service is touched and the state is always `running`. */
  fake: z.boolean(),
  /** Unpackaged builds only: the tester may remove the service again from the app. */
  canUninstall: z.boolean(),
  /** A short reason for `unknown` or for a failed install. */
  message: z.string().optional(),
});
export type AgentServiceStatus = z.infer<typeof AgentServiceStatusSchema>;

/** Result of an install or uninstall request: the outcome plus the service state afterwards. */
export const AgentChangeResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  status: AgentServiceStatusSchema,
});
export type AgentChangeResult = z.infer<typeof AgentChangeResultSchema>;

/** What the spike helper has logged lately, so a tester can see it works without opening files. */
export const AgentReportSchema = z.object({
  /** The newest `foreground` and `screenshot` log lines, oldest first. */
  lines: z.array(z.string()),
  shotsDir: z.string(),
  shotCount: z.number().int().nonnegative(),
});
export type AgentReport = z.infer<typeof AgentReportSchema>;
