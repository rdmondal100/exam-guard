import { describe, expect, it } from 'vitest';
import type { FrontWindow } from './foreground.js';
import { createSiteResolver, parseReading, siteOf, type AddressReading } from './site.js';

const chrome = (title: string, windowId = 1): FrontWindow => ({
  exe: 'chrome.exe',
  path: 'C:\\Chrome\\chrome.exe',
  pid: 10,
  windowId,
  title,
});

describe('parseReading', () => {
  it('reads what SiteReader prints', () => {
    expect(parseReading('private\r\n')).toEqual({ state: 'private' });
    expect(parseReading('typing')).toEqual({ state: 'typing' });
    expect(parseReading('address chatgpt.com/c/1')).toEqual({
      state: 'address',
      text: 'chatgpt.com/c/1',
    });
    expect(parseReading('')).toEqual({ state: 'none' });
    expect(parseReading('nonsense')).toEqual({ state: 'none' });
  });
});

describe('siteOf', () => {
  it('keeps the parent domain and the full address', () => {
    expect(siteOf('music.youtube.com/watch?v=x')).toEqual({
      domain: 'youtube.com',
      url: 'https://music.youtube.com/watch?v=x',
    });
    expect(siteOf('http://gemini.google.com/app')).toEqual({
      domain: 'google.com',
      url: 'http://gemini.google.com/app',
    });
  });

  it('treats private suffixes, localhost and IPs as their own site', () => {
    expect(siteOf('myapp.vercel.app/x')?.domain).toBe('myapp.vercel.app');
    expect(siteOf('localhost:3000/')?.domain).toBe('localhost');
    expect(siteOf('192.168.1.7:8080')?.domain).toBe('192.168.1.7');
  });

  it('is null for internal pages, searches typed with spaces and junk', () => {
    expect(siteOf('chrome://settings')).toBeNull();
    expect(siteOf('edge://newtab')).toBeNull();
    expect(siteOf('file:///C:/x.html')).toBeNull();
    expect(siteOf('how to sort')).toBeNull();
    expect(siteOf('')).toBeNull();
    expect(siteOf('nodot')).toBeNull();
  });
});

describe('createSiteResolver', () => {
  const resolverWith = (readings: AddressReading[]) => {
    const calls: number[] = [];
    const resolver = createSiteResolver({
      readAddress: async (id) => {
        calls.push(id);
        return readings.shift() ?? { state: 'none' };
      },
    });
    return { resolver, calls };
  };

  it('reads the address only for Chrome and Edge', async () => {
    const { resolver, calls } = resolverWith([]);
    const notepad = { ...chrome('x'), exe: 'notepad.exe' };
    expect(await resolver.resolve(notepad)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reads again only when the window or the title (digits aside) changes', async () => {
    const { resolver, calls } = resolverWith([
      { state: 'address', text: 'chatgpt.com/c/1' },
      { state: 'address', text: 'wikipedia.org/wiki/Sort' },
    ]);
    const first = await resolver.resolve(chrome('ChatGPT (1)'));
    expect(first).toEqual({ domain: 'chatgpt.com', url: 'https://chatgpt.com/c/1' });
    expect(await resolver.resolve(chrome('ChatGPT (2)'))).toEqual(first);
    expect(await resolver.resolve(chrome('Sort - Wikipedia'))).toMatchObject({
      domain: 'wikipedia.org',
    });
    expect(calls).toHaveLength(2);
  });

  it('marks a private window and keeps the last site while the student types', async () => {
    const { resolver } = resolverWith([
      { state: 'address', text: 'chatgpt.com' },
      { state: 'typing' },
      { state: 'private' },
    ]);
    await resolver.resolve(chrome('a'));
    expect(await resolver.resolve(chrome('b'))).toMatchObject({ domain: 'chatgpt.com' });
    expect(await resolver.resolve(chrome('c', 2))).toEqual({ privateWindow: true });
  });
});
