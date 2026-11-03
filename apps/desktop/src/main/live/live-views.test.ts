import { describe, expect, it } from 'vitest';
import type { LivePageMessage, LiveRequest, LiveState, RtcSignal } from '@examguard/shared';
import { LiveViews, MAX_LIVE_SESSIONS } from './live-views.js';

const request = (sessionId: string): LiveRequest => ({
  t: 'live.request',
  sessionId,
  maxWidth: 1280,
  fps: 8,
});

function setup(sourceId: string | null = 'screen:0:0') {
  const sent: (RtcSignal | LiveState)[] = [];
  const pages: {
    started: unknown[];
    signals: unknown[];
    destroyed: boolean;
    message: (m: LivePageMessage) => void;
    gone: () => void;
  }[] = [];
  const views = new LiveViews({
    open: (onMessage, onGone) => {
      const page = {
        started: [] as unknown[],
        signals: [] as unknown[],
        destroyed: false,
        message: onMessage,
        gone: onGone,
      };
      pages.push(page);
      return {
        start: (s) => page.started.push(s),
        signal: (d) => page.signals.push(d),
        destroy: () => {
          page.destroyed = true;
        },
      };
    },
    sourceId: async () => sourceId,
    send: (m) => sent.push(m),
  });
  return { views, sent, pages };
}

describe('LiveViews', () => {
  it('opens a page only while monitoring and passes the capture source', async () => {
    const { views, sent, pages } = setup();
    await views.request(request('l1'));
    expect(pages).toHaveLength(0);
    expect(sent).toEqual([
      { t: 'live.state', sessionId: 'l1', status: 'failed', reason: 'not monitoring' },
    ]);
    views.setMonitoring(true);
    await views.request(request('l2'));
    expect(pages[0]?.started).toEqual([
      { sessionId: 'l2', maxWidth: 1280, fps: 8, sourceId: 'screen:0:0' },
    ]);
  });

  it('relays signals both ways and destroys the page on stop', async () => {
    const { views, sent, pages } = setup();
    views.setMonitoring(true);
    await views.request(request('l1'));
    const page = pages[0];
    page?.message({ kind: 'signal', sessionId: 'l1', data: { type: 'offer', sdp: 'v=0' } });
    page?.message({ kind: 'signal', sessionId: 'other', data: { candidate: 'x' } });
    expect(sent).toEqual([
      { t: 'rtc.signal', sessionId: 'l1', data: { type: 'offer', sdp: 'v=0' } },
    ]);
    views.signal('l1', { type: 'answer', sdp: 'v=0' });
    expect(page?.signals).toEqual([{ type: 'answer', sdp: 'v=0' }]);
    views.stop('l1');
    expect(page?.destroyed).toBe(true);
    expect(views.count()).toBe(0);
  });

  it('reports a failing page and one that dies by itself', async () => {
    const { views, sent, pages } = setup();
    views.setMonitoring(true);
    await views.request(request('l1'));
    await views.request(request('l2'));
    pages[0]?.message({ kind: 'state', sessionId: 'l1', status: 'failed', reason: 'denied' });
    pages[1]?.gone();
    expect(pages[0]?.destroyed).toBe(true);
    expect(sent).toEqual([
      { t: 'live.state', sessionId: 'l1', status: 'failed', reason: 'denied' },
      { t: 'live.state', sessionId: 'l2', status: 'failed', reason: 'capture page closed' },
    ]);
    expect(views.count()).toBe(0);
  });

  it('keeps at most two pages and closes them all when monitoring ends', async () => {
    const { views, sent, pages } = setup();
    views.setMonitoring(true);
    for (let i = 1; i <= MAX_LIVE_SESSIONS + 1; i += 1) await views.request(request(`l${i}`));
    expect(views.count()).toBe(MAX_LIVE_SESSIONS);
    expect(pages[0]?.destroyed).toBe(true);
    views.setMonitoring(false);
    expect(pages.every((p) => p.destroyed)).toBe(true);
    expect(sent.map((m) => (m.t === 'live.state' ? `${m.sessionId}:${m.status}` : m.t))).toEqual([
      'l1:ended',
      'l2:ended',
      'l3:ended',
    ]);
  });

  it('closes silently when the socket closes, and fails without a screen', async () => {
    const { views, sent, pages } = setup();
    views.setMonitoring(true);
    await views.request(request('l1'));
    views.socketClosed();
    expect(pages[0]?.destroyed).toBe(true);
    expect(sent).toEqual([]);

    const blind = setup(null);
    blind.views.setMonitoring(true);
    await blind.views.request(request('l9'));
    expect(blind.sent).toEqual([
      { t: 'live.state', sessionId: 'l9', status: 'failed', reason: 'no screen to capture' },
    ]);
  });

  it('drops a request that is stopped while it waits for the source', async () => {
    const { views, pages } = setup();
    views.setMonitoring(true);
    const pending = views.request(request('l1'));
    views.stop('l1');
    await pending;
    expect(pages).toHaveLength(0);
  });
});
