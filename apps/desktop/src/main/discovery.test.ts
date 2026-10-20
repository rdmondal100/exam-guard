import { describe, expect, it } from 'vitest';
import type { Service } from 'bonjour-service';
import { toDiscoveredHost } from './discovery.js';

const FP = 'A'.repeat(43);

const service = (over: Partial<Service>): Service =>
  ({
    port: 47820,
    addresses: ['fe80::1', '192.168.1.7'],
    txt: { v: '1.0', exam: 'Mid', fp: FP },
    ...over,
  }) as Service;

describe('toDiscoveredHost', () => {
  it('builds a host from a valid service, preferring IPv4', () => {
    expect(toDiscoveredHost(service({}))).toMatchObject({
      id: '192.168.1.7:47820',
      examTitle: 'Mid',
      address: '192.168.1.7',
      port: 47820,
      fingerprint: FP,
      protocol: { major: 1, minor: 0 },
    });
    expect(toDiscoveredHost(service({}))?.fpCode).toMatch(/^[0-9A-Z]{4}$/);
  });

  it('ignores services with a bad TXT record', () => {
    expect(toDiscoveredHost(service({ txt: { v: '1.0', exam: 'x', fp: 'short' } }))).toBeNull();
    expect(toDiscoveredHost(service({ txt: undefined }))).toBeNull();
  });

  it('ignores another protocol major and services with no IPv4 address', () => {
    expect(toDiscoveredHost(service({ txt: { v: '2.0', exam: 'x', fp: FP } }))).toBeNull();
    expect(toDiscoveredHost(service({ addresses: ['fe80::1'] }))).toBeNull();
  });
});
