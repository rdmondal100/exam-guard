import { execFile } from 'node:child_process';
import { getDomain } from 'tldts';
import type { FrontWindow } from './foreground.js';

/** The browsers whose address bar SiteReader has been tested on. */
const BROWSERS = new Set(['chrome.exe', 'msedge.exe']);
/** About 120 ms normally; a slow PC must not lose the site for a whole page visit. */
const READ_TIMEOUT_MS = 800;
/** Longest address kept as evidence. */
const MAX_URL = 2048;

export type AddressReading =
  { state: 'private' | 'typing' | 'none' } | { state: 'address'; text: string };
export type ReadAddress = (windowId: number) => Promise<AddressReading>;

/** What a browser window shows: a site (its domain and full address) or a private window. */
export type Site = { domain: string; url: string } | { privateWindow: true };

export function parseReading(output: string): AddressReading {
  const line = output.trim();
  if (line === 'private' || line === 'typing') return { state: line };
  if (line.startsWith('address ')) return { state: 'address', text: line.slice('address '.length) };
  return { state: 'none' };
}

/** Runs SiteReader.exe for one window. Never rejects: anything that goes wrong reads as "none". */
export function runSiteReader(path: string, windowId: number): Promise<AddressReading> {
  return new Promise((resolve) => {
    execFile(
      path,
      [String(windowId)],
      { encoding: 'utf8', timeout: READ_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error ? { state: 'none' } : parseReading(stdout)),
    );
  });
}

/**
 * The address bar's text as a site: the parent domain (`music.youtube.com/watch?v=x` →
 * `youtube.com`; private suffixes count, so `myapp.vercel.app` is its own site; localhost and IPs
 * stay as they are) and the full address. `null` for internal pages and anything that is no address.
 */
export function siteOf(address: string): { domain: string; url: string } | null {
  const text = address.trim();
  if (!text || /\s/.test(text)) return null;
  const hasScheme =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|data|file|chrome|edge):/i.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const domain =
    getDomain(host, { allowPrivateDomains: true }) ??
    (host.includes('.') || host === 'localhost' ? host : null);
  return domain ? { domain, url: url.href.slice(0, MAX_URL) } : null;
}

/**
 * Turns a browser in front into the site it shows. The address is read only when the window or
 * its title changes; digits are ignored in that check, so a ticking title doesn't start a read
 * every second. While the student types in the address bar, the last site of that window stays.
 */
export function createSiteResolver({ readAddress }: { readAddress: ReadAddress }) {
  // A promise, so callers that overlap share one read.
  let last: { key: string; showing: Promise<Site | null> } | null = null;
  let known: { windowId: number; site: { domain: string; url: string } } | null = null;

  async function read(windowId: number): Promise<Site | null> {
    const reading = await readAddress(windowId);
    if (reading.state === 'private') {
      known = null;
      return { privateWindow: true };
    }
    if (reading.state === 'typing') return known?.windowId === windowId ? known.site : null;
    const site = reading.state === 'address' ? siteOf(reading.text) : null;
    known = site ? { windowId, site } : null;
    return site;
  }

  async function resolve({ exe, title, windowId }: FrontWindow): Promise<Site | null> {
    if (!BROWSERS.has(exe.toLowerCase())) return null;
    const key = `${windowId}\n${title.replace(/\d+/g, '#')}`;
    if (last?.key !== key) last = { key, showing: read(windowId) };
    return last.showing;
  }

  return { resolve };
}

export type SiteResolver = ReturnType<typeof createSiteResolver>;
