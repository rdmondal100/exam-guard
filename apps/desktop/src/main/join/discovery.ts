import { Bonjour, type Service } from 'bonjour-service';
import {
  MDNS_SERVICE_TYPE,
  MdnsTxtSchema,
  fpCodeOf,
  isProtocolCompatible,
  parseTxtVersion,
  type DiscoveredHost,
} from '@examguard/shared';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Turns one mDNS service into a host, or `null` if it is not a usable ExamGuard teacher. */
export function toDiscoveredHost(service: Service): DiscoveredHost | null {
  const txt = MdnsTxtSchema.safeParse(service.txt);
  if (!txt.success) return null;
  const protocol = parseTxtVersion(txt.data.v);
  if (!isProtocolCompatible(protocol)) return null;
  const address = (service.addresses ?? []).find((a) => IPV4.test(a));
  if (!address) return null;
  return {
    id: `${address}:${service.port}`,
    examTitle: txt.data.exam,
    address,
    port: service.port,
    protocol,
    fingerprint: txt.data.fp,
    fpCode: fpCodeOf(Buffer.from(txt.data.fp, 'base64url')),
  };
}

/** Browses `_examguard._tcp` and reports the full list whenever it changes. */
export class Discovery {
  private bonjour: Bonjour | null = null;
  private readonly hosts = new Map<string, DiscoveredHost>();

  constructor(private readonly onChange: (hosts: DiscoveredHost[]) => void) {}

  list(): DiscoveredHost[] {
    return [...this.hosts.values()].sort((a, b) => a.examTitle.localeCompare(b.examTitle));
  }

  start(): void {
    if (this.bonjour) return;
    const bonjour = new Bonjour();
    this.bonjour = bonjour;
    const browser = bonjour.find({ type: MDNS_SERVICE_TYPE, protocol: 'tcp' });
    const upsert = (service: Service) => {
      const host = toDiscoveredHost(service);
      if (!host) return;
      this.hosts.set(host.id, host);
      this.onChange(this.list());
    };
    browser.on('up', upsert);
    browser.on('txt-update', upsert);
    browser.on('down', (service) => {
      const gone = toDiscoveredHost(service);
      if (gone && this.hosts.delete(gone.id)) this.onChange(this.list());
    });
  }

  stop(): void {
    const bonjour = this.bonjour;
    this.bonjour = null;
    bonjour?.destroy();
    if (this.hosts.size > 0) {
      this.hosts.clear();
      this.onChange([]);
    }
  }
}
