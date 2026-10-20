import { z } from 'zod';
import { ProtocolVersionSchema } from './protocol-version.js';
import { StudentInfoSchema } from './hosting.js';

/** mDNS service type advertised while hosting (docs/architecture.md §2). */
export const MDNS_SERVICE_TYPE = 'examguard';

/** TXT record of the advertised service. `v` is `major.minor`, `fp` is base64url SHA-256. */
export const MdnsTxtSchema = z.object({
  v: z.string().regex(/^\d+\.\d+$/),
  exam: z.string().max(200),
  fp: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type MdnsTxt = z.infer<typeof MdnsTxtSchema>;

/** Builds the TXT record the server advertises. */
export function toMdnsTxt(txt: { exam: string; fingerprint: string }, v: string): MdnsTxt {
  return { v, exam: txt.exam.slice(0, 200), fp: txt.fingerprint };
}

/** Parses `major.minor` from a TXT `v` value. */
export function parseTxtVersion(v: string): z.infer<typeof ProtocolVersionSchema> {
  const [major = '0', minor = '0'] = v.split('.');
  return { major: Number(major), minor: Number(minor) };
}

/** A host the student app found over mDNS. */
export const DiscoveredHostSchema = z.object({
  id: z.string(),
  examTitle: z.string(),
  address: z.string(),
  port: z.number().int().min(1).max(65535),
  protocol: ProtocolVersionSchema,
  fingerprint: z.string(),
  fpCode: z.string().length(4),
});
export type DiscoveredHost = z.infer<typeof DiscoveredHostSchema>;

/** Renderer → main: contact a host and read its `/info`. */
export const ProbeRequestSchema = z.object({
  address: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  /** Set for mDNS hosts (the TXT fingerprint). Omitted for manual IP (trust on first use). */
  expectedFingerprint: z.string().optional(),
});
export type ProbeRequest = z.infer<typeof ProbeRequestSchema>;

export const PROBE_ERROR_CODES = [
  'unreachable',
  'fingerprint_mismatch',
  'bad_response',
  'incompatible_protocol',
  'not_hosting',
] as const;

export const ProbeResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    address: z.string(),
    port: z.number().int(),
    info: StudentInfoSchema,
    fingerprint: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(PROBE_ERROR_CODES),
    message: z.string(),
  }),
]);
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
