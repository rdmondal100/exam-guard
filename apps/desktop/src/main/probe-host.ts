import {
  StudentInfoSchema,
  STUDENT_API_PORT,
  isProtocolCompatible,
  type ProbeRequest,
  type ProbeResult,
} from '@examguard/shared';
import { PinError, pinnedGet } from './tls-pin.js';

const MESSAGES = {
  unreachable:
    'Could not reach that computer. Check the address and that you are on the lab network.',
  fingerprint_mismatch:
    "This computer's certificate does not match the one the teacher announced. Do not continue; tell your invigilator.",
  bad_response: 'That computer did not answer like an ExamGuard teacher.',
  incompatible_protocol: 'This app version cannot talk to that teacher. Ask for an updated app.',
  not_hosting: 'That teacher is not hosting an exam right now.',
} as const;

const fail = (code: keyof typeof MESSAGES): ProbeResult => ({
  ok: false,
  code,
  message: MESSAGES[code],
});

/** Contacts a host, pins its cert and reads `/info`. */
export async function probeHost(request: ProbeRequest): Promise<ProbeResult> {
  const port = request.port ?? STUDENT_API_PORT;
  try {
    const response = await pinnedGet(
      { address: request.address, port, expectedFingerprint: request.expectedFingerprint },
      '/api/v1/info',
    );
    if (response.status === 503) return fail('not_hosting');
    if (response.status !== 200) return fail('bad_response');
    const info = StudentInfoSchema.safeParse(JSON.parse(response.body) as unknown);
    if (!info.success) return fail('bad_response');
    if (!isProtocolCompatible(info.data.protocol)) return fail('incompatible_protocol');
    return {
      ok: true,
      address: request.address,
      port,
      info: info.data,
      fingerprint: response.fingerprint,
    };
  } catch (e) {
    if (e instanceof PinError) return fail(e.code);
    return fail('bad_response');
  }
}
