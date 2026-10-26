import { describe, expect, it } from 'vitest';
import { createDropLogger } from './drop-logger.js';

describe('createDropLogger', () => {
  it('logs the first drop at once, then only a summary per interval', () => {
    const lines: string[] = [];
    let time = 1000;
    const drop = createDropLogger(
      (l) => lines.push(l),
      () => time,
      5000,
    );

    drop('after_deadline');
    expect(lines).toEqual(['dropped saves: after_deadline x1']);

    for (let i = 0; i < 50; i++) drop('after_deadline');
    drop('past_grace');
    expect(lines).toHaveLength(1);

    time += 5000;
    drop('after_deadline');
    expect(lines).toEqual([
      'dropped saves: after_deadline x1',
      'dropped saves: after_deadline x51, past_grace x1',
    ]);
  });

  it('starts counting again after a summary', () => {
    const lines: string[] = [];
    let time = 0;
    const drop = createDropLogger(
      (l) => lines.push(l),
      () => time,
      1000,
    );
    drop('a');
    time = 1000;
    drop('b');
    expect(lines).toEqual(['dropped saves: a x1', 'dropped saves: b x1']);
  });
});
