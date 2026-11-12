import { describe, expect, it } from 'vitest';
import { encodeThumbFrame } from '@examguard/shared';
import { ThumbStore, type UrlFactory } from './thumbStore';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1]);

function fakeUrls() {
  let n = 0;
  const live = new Set<string>();
  const urls: UrlFactory = {
    create: () => {
      const url = `blob:${(n += 1)}`;
      live.add(url);
      return url;
    },
    revoke: (url) => live.delete(url),
  };
  return { urls, live };
}

describe('ThumbStore', () => {
  it('keeps the newest picture per student and frees the one it replaces', () => {
    const { urls, live } = fakeUrls();
    const store = new ThumbStore(urls);
    let calls = 0;
    store.subscribe(() => (calls += 1));
    expect(store.addFrame(encodeThumbFrame({ examStudentId: 'a', ts: 1 }, JPEG))).toBe(true);
    expect(
      store.addFrame(encodeThumbFrame({ examStudentId: 'a', ts: 2 }, JPEG).buffer as ArrayBuffer),
    ).toBe(true);
    expect(store.get('a')).toEqual({ url: 'blob:2', ts: 2 });
    expect([...live]).toEqual(['blob:2']);
    expect(calls).toBe(2);
  });

  it('ignores an older picture and anything that is not a thumbnail', () => {
    const { urls } = fakeUrls();
    const store = new ThumbStore(urls);
    store.addFrame(encodeThumbFrame({ examStudentId: 'a', ts: 5 }, JPEG));
    store.addFrame(encodeThumbFrame({ examStudentId: 'a', ts: 4 }, JPEG));
    expect(store.get('a')?.ts).toBe(5);
    expect(store.addFrame(new Uint8Array([2, 0, 1, 0]))).toBe(false);
    expect(store.addFrame(encodeThumbFrame({ ts: 1 }, JPEG))).toBe(false);
  });

  it('frees every picture on clear', () => {
    const { urls, live } = fakeUrls();
    const store = new ThumbStore(urls);
    store.addFrame(encodeThumbFrame({ examStudentId: 'a', ts: 1 }, JPEG));
    store.addFrame(encodeThumbFrame({ examStudentId: 'b', ts: 1 }, JPEG));
    store.clear();
    expect(live.size).toBe(0);
    expect(store.get('a')).toBeUndefined();
  });
});
