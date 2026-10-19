import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { lanAddresses } from './lan-addresses.js';

const v4 = (address: string, internal: boolean): NetworkInterfaceInfo => ({
  address,
  family: 'IPv4',
  internal,
  netmask: '255.255.255.0',
  mac: '00:00:00:00:00:00',
  cidr: `${address}/24`,
});
const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  family: 'IPv6',
  internal: false,
  netmask: 'ffff:ffff:ffff:ffff::',
  mac: '00:00:00:00:00:00',
  cidr: `${address}/64`,
  scopeid: 0,
});

describe('lanAddresses', () => {
  it('keeps external IPv4 only', () => {
    expect(
      lanAddresses({
        lo: [v4('127.0.0.1', true)],
        wifi: [v6('fe80::1'), v4('192.168.1.7', false)],
        eth: undefined,
      }),
    ).toEqual(['192.168.1.7']);
  });
});
