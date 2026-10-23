import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerRepo, NewAnswerVersion } from '../db/answer-repo.js';
import { AnswerWriter } from './answer-writer.js';

const row = (clientSeq: number): NewAnswerVersion => ({
  examStudentId: 's1',
  questionId: 'q1',
  language: 'c',
  content: 'x',
  selected: true,
  reason: 'interval',
  clientSeq,
  clientTs: 1,
  serverTs: 2,
});

class FakeRepo {
  batches: number[][] = [];
  fail: (rows: readonly NewAnswerVersion[]) => unknown = () => null;
  insertMany(rows: readonly NewAnswerVersion[]): number {
    const error = this.fail(rows);
    if (error) throw error;
    this.batches.push(rows.map((r) => r.clientSeq));
    return rows.length;
  }
}

const constraint = Object.assign(new Error('FOREIGN KEY constraint failed'), {
  code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
});

let repo: FakeRepo;

beforeEach(() => {
  vi.useFakeTimers();
  repo = new FakeRepo();
});
afterEach(() => vi.useRealTimers());

const writer = (onRejected?: () => void) =>
  new AnswerWriter(repo as unknown as AnswerRepo, { onRejected });

describe('AnswerWriter', () => {
  it('writes what is waiting in one transaction 250 ms after the first row', () => {
    const w = writer();
    const acked: number[] = [];
    w.enqueue(row(1), () => acked.push(1));
    vi.advanceTimersByTime(100);
    w.enqueue(row(2), () => acked.push(2));
    vi.advanceTimersByTime(149);
    expect(repo.batches).toEqual([]);
    expect(acked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(repo.batches).toEqual([[1, 2]]);
    expect(acked).toEqual([1, 2]);
  });

  it('writes at once when 200 rows are waiting', () => {
    const w = writer();
    for (let i = 1; i <= 199; i += 1) w.enqueue(row(i), () => {});
    expect(repo.batches).toEqual([]);
    w.enqueue(row(200), () => {});
    expect(repo.batches).toHaveLength(1);
    expect(repo.batches[0]).toHaveLength(200);
    expect(w.waiting).toBe(0);
  });

  it('flush() writes straight away and leaves nothing for the timer', () => {
    const w = writer();
    w.enqueue(row(1), () => {});
    w.flush();
    expect(repo.batches).toEqual([[1]]);
    vi.advanceTimersByTime(1000);
    expect(repo.batches).toHaveLength(1);
  });

  it('acks after the commit, never before', () => {
    const w = writer();
    let seenWhenAcked = -1;
    w.enqueue(row(1), () => (seenWhenAcked = repo.batches.length));
    w.flush();
    expect(seenWhenAcked).toBe(1);
  });

  it('drops only the row the database refuses and still writes the others', () => {
    const rejected = vi.fn();
    const w = writer(rejected);
    repo.fail = (rows) => (rows.some((r) => r.clientSeq === 2) ? constraint : null);
    const acked: number[] = [];
    for (const n of [1, 2, 3]) w.enqueue(row(n), () => acked.push(n));
    w.flush();
    expect(repo.batches).toEqual([[1], [3]]);
    expect(acked).toEqual([1, 2, 3]);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('keeps a row for a retry, without an ack, when the failure may pass', () => {
    const w = writer();
    let failing = true;
    repo.fail = () => (failing ? new Error('database is locked') : null);
    const acked: number[] = [];
    w.enqueue(row(1), () => acked.push(1));
    w.flush();
    expect(acked).toEqual([]);
    expect(w.waiting).toBe(1);
    failing = false;
    vi.advanceTimersByTime(250);
    expect(repo.batches).toEqual([[1]]);
    expect(acked).toEqual([1]);
  });
});
