import { describe, expect, it } from 'vitest';
import { HostingInfoSchema, StudentInfoSchema } from './hosting.js';

describe('HostingInfoSchema', () => {
  it('accepts a 6-digit PIN with leading zeros', () => {
    const info = { pin: '004217', addresses: ['192.168.1.5'], port: 47820, fpCode: '7K2M' };
    expect(HostingInfoSchema.parse(info)).toEqual(info);
  });

  it('rejects a short PIN and a wrong-length code', () => {
    const base = { addresses: [], port: 47820 };
    expect(HostingInfoSchema.safeParse({ ...base, pin: '1234', fpCode: '7K2M' }).success).toBe(
      false,
    );
    expect(HostingInfoSchema.safeParse({ ...base, pin: '123456', fpCode: '7K2' }).success).toBe(
      false,
    );
  });
});

describe('StudentInfoSchema', () => {
  it('only reports hosting or running', () => {
    const base = { examTitle: 'Mid', protocol: { major: 1, minor: 0 }, fpCode: '7K2M' };
    expect(StudentInfoSchema.safeParse({ ...base, state: 'hosting' }).success).toBe(true);
    expect(StudentInfoSchema.safeParse({ ...base, state: 'ready' }).success).toBe(false);
  });
});
