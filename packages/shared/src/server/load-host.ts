import { z } from 'zod';

/**
 * Load test (M47): the student sim forks `apps/server/dist/scripts/load-host.js`, a real exam
 * server in its own Node process, and talks to it over the fork's IPC channel.
 */

/** Sim → load host. */
export const LoadHostCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  /** The host answers with `stats`. */
  z.object({ type: z.literal('stats') }),
  /** End the exam for everyone; the host answers with `ended`. */
  z.object({ type: z.literal('end') }),
  /** Close the listeners and the database, delete a temporary data folder, exit. */
  z.object({ type: z.literal('close') }),
]);
export type LoadHostCommand = z.infer<typeof LoadHostCommandSchema>;

/** One look at the host process, taken every few seconds while it runs. */
export const LoadHostSampleSchema = z.object({
  ts: z.number(),
  /** Percent of one core since the previous sample. */
  cpuPct: z.number(),
  rssMb: z.number(),
  heapMb: z.number(),
  /** Event loop delay over the interval, p99 (ms). */
  loopP99Ms: z.number(),
});
export type LoadHostSample = z.infer<typeof LoadHostSampleSchema>;

/** What the database holds for the load exam. */
export const LoadHostCountsSchema = z.object({
  events: z.number().int(),
  agentEvents: z.number().int(),
  withScreenshot: z.number().int(),
  answerVersions: z.number().int(),
  finalAnswers: z.number().int(),
});
export type LoadHostCounts = z.infer<typeof LoadHostCountsSchema>;

/** Load host → sim. */
export const LoadHostReplySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    examId: z.string(),
    pin: z.string(),
    studentPort: z.number().int(),
    teacherPort: z.number().int(),
    /** Teacher API token (loopback), for the sim's teacher socket. */
    token: z.string(),
    /** The host's LAN addresses, for a real student on another PC. */
    addresses: z.array(z.string()),
    /** Student IDs on the class list beyond the simulated ones, for real students. */
    spareCodes: z.array(z.string()),
  }),
  z.object({ type: z.literal('started') }),
  z.object({
    type: z.literal('stats'),
    samples: z.array(LoadHostSampleSchema),
    counts: LoadHostCountsSchema,
  }),
  z.object({ type: z.literal('ended') }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type LoadHostReply = z.infer<typeof LoadHostReplySchema>;
