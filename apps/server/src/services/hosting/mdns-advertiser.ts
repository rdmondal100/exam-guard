import { Bonjour } from 'bonjour-service';
import { MDNS_SERVICE_TYPE, PROTOCOL_VERSION, toMdnsTxt } from '@examguard/shared';

export interface Advertisement {
  title: string;
  port: number;
  /** SHA-256 of the cert, base64url. */
  fingerprint: string;
}

/** Starts advertising and returns the function that stops it. */
export type Advertise = (ad: Advertisement) => () => void;

/** `_examguard._tcp` over mDNS while an exam is hosted (docs/architecture.md §2). */
export const advertiseOverMdns: Advertise = (ad) => {
  const bonjour = new Bonjour();
  const txt = toMdnsTxt(
    { exam: ad.title, fingerprint: ad.fingerprint },
    `${PROTOCOL_VERSION.major}.${PROTOCOL_VERSION.minor}`,
  );
  bonjour.publish({
    name: `ExamGuard-${ad.fingerprint.slice(0, 8)}`,
    type: MDNS_SERVICE_TYPE,
    protocol: 'tcp',
    port: ad.port,
    txt,
  });
  return () => {
    bonjour.unpublishAll(() => bonjour.destroy());
  };
};
