import { describe, expect, it } from 'vitest';
import { parseHostAddress } from './hostAddress.js';

describe('parseHostAddress', () => {
  it('defaults the port', () => {
    expect(parseHostAddress(' 192.168.1.7 ')).toEqual({ address: '192.168.1.7', port: 47820 });
  });

  it('reads an explicit port and host names', () => {
    expect(parseHostAddress('10.0.0.2:5000')).toEqual({ address: '10.0.0.2', port: 5000 });
    expect(parseHostAddress('teacher-pc:47820')).toEqual({ address: 'teacher-pc', port: 47820 });
  });

  it('rejects bad input', () => {
    for (const bad of [
      '',
      '999.1.1.1',
      '1.2.3.4:0',
      '1.2.3.4:70000',
      '1.2.3.4:x',
      'a:b:c',
      ':80',
    ]) {
      expect(parseHostAddress(bad), bad).toBeNull();
    }
  });
});
