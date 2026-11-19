import { describe, expect, it } from 'vitest';
import type { ReadinessReport, SessionState } from '@examguard/shared';
import { LobbyReadiness, RETRY_AFTER_MS } from './lobbyReadiness.js';

const exam = (examState: SessionState['examState']) => ({ examState }) as SessionState;
const good: ReadinessReport = { checks: [{ name: 'c', ok: true, ms: 1 }] };
const bad: ReadinessReport = { checks: [{ name: 'c', ok: false, ms: 1, message: 'x' }] };
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(results: ReadinessReport[]) {
  let clock = 0;
  const runs: number[] = [];
  const published: ReadinessReport[] = [];
  const lobby = new LobbyReadiness({
    run: async () => {
      runs.push(clock);
      return results.shift() ?? good;
    },
    publish: (r) => published.push(r),
    now: () => clock,
  });
  return { lobby, runs, published, advance: (ms: number) => (clock += ms) };
}

describe('lobby readiness (M54)', () => {
  it('runs once in the lobby of a hosted exam and not while it runs', async () => {
    const t = setup([good]);
    t.lobby.onExam(exam('running'));
    t.lobby.onExam(exam('hosting'));
    t.lobby.onExam(exam('hosting'));
    await tick();
    t.lobby.onExam(exam('hosting'));
    expect(t.runs).toHaveLength(1);
    expect(t.published).toEqual([good]);
    expect(t.lobby.current()).toEqual(good);
  });

  it('tries a failed check again, but not before the pause', async () => {
    const t = setup([bad, good]);
    t.lobby.onExam(exam('hosting'));
    await tick();
    t.lobby.onExam(exam('hosting'));
    expect(t.runs).toHaveLength(1);
    t.advance(RETRY_AFTER_MS);
    t.lobby.onExam(exam('hosting'));
    await tick();
    expect(t.published).toEqual([bad, good]);
  });

  it('starts over for a new session', async () => {
    const t = setup([good, good]);
    t.lobby.onExam(exam('hosting'));
    await tick();
    t.lobby.reset();
    t.lobby.onExam(exam('hosting'));
    await tick();
    expect(t.runs).toHaveLength(2);
  });
});
