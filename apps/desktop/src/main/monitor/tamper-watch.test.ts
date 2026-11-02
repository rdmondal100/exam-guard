import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TamperWatch, type AgentLoss } from './tamper-watch.js';

describe('TamperWatch', () => {
  let lost: AgentLoss[];
  let watch: TamperWatch;

  beforeEach(() => {
    vi.useFakeTimers();
    lost = [];
    watch = new TamperWatch({ onLost: (l) => lost.push(l), lockAfterMs: 5000 });
  });
  afterEach(() => {
    watch.dispose();
    vi.useRealTimers();
  });

  it('reports a link that drops during the exam and stays down', () => {
    watch.setLinked(true);
    watch.setWorking(true);
    vi.advanceTimersByTime(60_000);
    expect(lost).toEqual([]);
    watch.setLinked(false, 'The monitoring agent stopped answering.');
    vi.advanceTimersByTime(4999);
    expect(lost).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(lost).toEqual([{ reason: 'The monitoring agent stopped answering.', downMs: 5000 }]);
  });

  it('forgives a link that comes back in time', () => {
    watch.setLinked(true);
    watch.setWorking(true);
    watch.setLinked(false, 'x');
    vi.advanceTimersByTime(3000);
    watch.setLinked(true);
    vi.advanceTimersByTime(10_000);
    expect(lost).toEqual([]);
  });

  it('reports a link that was never up once the exam runs', () => {
    watch.setLinked(false, 'The monitoring agent is not running.');
    vi.advanceTimersByTime(20_000);
    expect(lost).toEqual([]);
    watch.setWorking(true);
    vi.advanceTimersByTime(5000);
    expect(lost).toHaveLength(1);
  });

  it('reports one outage once, and a new loss after the link came back', () => {
    watch.setWorking(true);
    watch.setLinked(true);
    watch.setLinked(false, 'a');
    vi.advanceTimersByTime(5000);
    // The teacher unlocked; the student is still working and the link is still down.
    watch.setWorking(true);
    vi.advanceTimersByTime(60_000);
    expect(lost).toHaveLength(1);
    watch.setLinked(true);
    watch.setLinked(false, 'b');
    vi.advanceTimersByTime(5000);
    expect(lost.map((l) => l.reason)).toEqual(['a', 'b']);
  });

  it('says nothing once the student stops working', () => {
    watch.setLinked(true);
    watch.setWorking(true);
    watch.setLinked(false, 'x');
    vi.advanceTimersByTime(2000);
    watch.setWorking(false);
    vi.advanceTimersByTime(60_000);
    expect(lost).toEqual([]);
  });
});
