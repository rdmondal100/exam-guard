import { STUDENT_API_PORT } from '@examguard/shared';

export interface HostAddress {
  address: string;
  port: number;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;

/** Parses `IP`, `IP:port`, `name` or `name:port`. Returns `null` when it is not usable. */
export function parseHostAddress(input: string): HostAddress | null {
  const text = input.trim();
  const [address = '', portText, ...rest] = text.split(':');
  if (rest.length > 0 || address === '') return null;
  const v4 = IPV4.exec(address);
  if (v4) {
    if (v4.slice(1).some((part) => Number(part) > 255)) return null;
  } else if (!HOSTNAME.test(address)) {
    return null;
  }
  if (portText === undefined) return { address, port: STUDENT_API_PORT };
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  return port >= 1 && port <= 65535 ? { address, port } : null;
}
