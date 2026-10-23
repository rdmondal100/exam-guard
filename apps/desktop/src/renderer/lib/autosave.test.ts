import { describe, expect, it } from 'vitest';
import { Autosaver, type AutosaveSnapshot } from './autosave';

const code = { id: 'q1', type: 'code' as const, allowedLanguages: ['c' as const, 'cpp' as const] };
const written = { id: 'q2', type: 'written' as const, allowedLanguages: [] };

const snap = (over: Partial<AutosaveSnapshot> = {}): AutosaveSnapshot => ({
  questions: [code, written],
  answers: {},
  flags: {},
  languages: {},
  ...over,
});

describe('Autosaver', () => {
  it('sends nothing before the student has typed anything', () => {
    expect(new Autosaver().collect(snap(), 'interval')).toEqual([]);
  });

  it('sends a typed buffer once, then only when it changes', () => {
    const saver = new Autosaver();
    const typed = snap({ answers: { q1: { c: 'int main(){}' } } });
    expect(saver.collect(typed, 'interval')).toEqual([
      {
        questionId: 'q1',
        language: 'c',
        content: 'int main(){}',
        selected: true,
        reason: 'interval',
        flags: '',
      },
    ]);
    expect(saver.collect(typed, 'interval')).toEqual([]);
    const more = snap({ answers: { q1: { c: 'int main(){return 0;}' } } });
    expect(saver.collect(more, 'interval')).toHaveLength(1);
  });

  it('saves a written answer under "text" with no flags', () => {
    const saved = new Autosaver().collect(snap({ answers: { q2: { text: 'LIFO' } } }), 'interval');
    expect(saved).toEqual([
      { questionId: 'q2', language: 'text', content: 'LIFO', selected: true, reason: 'interval' },
    ]);
  });

  it('saves a code question that allows no language as text', () => {
    const odd = { id: 'q3', type: 'code' as const, allowedLanguages: [] };
    const saved = new Autosaver().collect(
      snap({ questions: [odd], answers: { q3: { text: 'by hand' } } }),
      'interval',
    );
    expect(saved.map((s) => s.language)).toEqual(['text']);
  });

  it('sends the new language, even empty, when the student switches, and stays quiet for the old one', () => {
    const saver = new Autosaver();
    saver.collect(snap({ answers: { q1: { c: 'int c;' } } }), 'interval');
    const switched = snap({ answers: { q1: { c: 'int c;' } }, languages: { q1: 'cpp' } });
    expect(saver.collect(switched, 'switch_language')).toEqual([
      {
        questionId: 'q1',
        language: 'cpp',
        content: '',
        selected: true,
        reason: 'switch_language',
        flags: '',
      },
    ]);
    expect(saver.collect(switched, 'interval')).toEqual([]);
  });

  it('sends the old language again when the student switches back to it', () => {
    const saver = new Autosaver();
    const base = { answers: { q1: { c: 'int c;', cpp: 'int cpp;' } } };
    saver.collect(snap(base), 'interval');
    saver.collect(snap({ ...base, languages: { q1: 'cpp' } }), 'switch_language');
    const back = saver.collect(snap({ ...base, languages: { q1: 'c' } }), 'switch_language');
    expect(back).toEqual([
      expect.objectContaining({ language: 'c', content: 'int c;', selected: true }),
    ]);
  });

  it('marks an edited buffer of the other language as not selected', () => {
    const saver = new Autosaver();
    saver.collect(snap({ answers: { q1: { c: 'a' } } }), 'interval');
    const edited = snap({ answers: { q1: { c: 'a', cpp: 'b' } }, languages: { q1: 'c' } });
    expect(saver.collect(edited, 'interval')).toEqual([
      expect.objectContaining({ language: 'cpp', selected: false }),
    ]);
  });

  it('counts a change of the flags as a change', () => {
    const saver = new Autosaver();
    const answers = { q1: { c: 'code' } };
    saver.collect(snap({ answers }), 'interval');
    const saved = saver.collect(snap({ answers, flags: { q1: { c: '-lm' } } }), 'run');
    expect(saved).toEqual([expect.objectContaining({ flags: '-lm', reason: 'run' })]);
  });

  it('sends a buffer again after forget()', () => {
    const saver = new Autosaver();
    const typed = snap({ answers: { q2: { text: 'x' } } });
    const first = saver.collect(typed, 'interval')[0];
    expect(first).toBeDefined();
    expect(saver.collect(typed, 'interval')).toEqual([]);
    if (first) saver.forget(first);
    expect(saver.collect(typed, 'interval')).toHaveLength(1);
  });

  it('sends every changed buffer together for a trigger', () => {
    const saved = new Autosaver().collect(
      snap({ answers: { q1: { c: 'a' }, q2: { text: 'b' } } }),
      'switch_question',
    );
    expect(saved.map((s) => s.reason)).toEqual(['switch_question', 'switch_question']);
  });
});
