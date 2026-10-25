import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExamState, ServerToStudent } from '@examguard/shared';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { ExamRepo } from '../db/exam-repo.js';
import { TeacherActionRepo } from '../db/teacher-action-repo.js';
import type { SessionHub } from '../ws/session-hub.js';
import { HostingError } from './hosting-error.js';
import { InternetSwitch } from './internet-switch.js';

let dir: string;
let db: Db;
let examId: string;
let pushed: ServerToStudent[];
let actions: TeacherActionRepo;
let sw: InternetSwitch;

const setExamState = (state: ExamState) =>
  db.prepare('UPDATE exams SET state = ? WHERE id = ?').run(state, examId);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-net-'));
  db = initDatabase(dir);
  const exams = new ExamRepo(db);
  examId = exams.create({ title: 'Mid', durationMin: 60, classListId: null }, 1).id;
  setExamState('hosting');
  pushed = [];
  const hub = {
    broadcast: (build: (id: string) => ServerToStudent) => pushed.push(build('s1')),
  } as unknown as SessionHub;
  actions = new TeacherActionRepo(db);
  sw = new InternetSwitch({ exams, actions, hub, now: () => 5000 });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('InternetSwitch', () => {
  it('starts allowed', () => {
    expect(sw.state(examId)).toBe('allowed');
    expect(sw.state('nope')).toBe('allowed');
  });

  it('blocks and allows, pushes each change and logs it', () => {
    expect(sw.set(examId, false)).toEqual({ ok: true, internet: 'blocked' });
    expect(pushed.at(-1)).toEqual({ t: 'state', state: { internet: 'blocked' } });
    sw.set(examId, true);
    expect(pushed.at(-1)).toEqual({ t: 'state', state: { internet: 'allowed' } });
    expect(actions.list(examId).map((a) => a.payload)).toEqual([
      { enabled: false },
      { enabled: true },
    ]);
  });

  it('can be changed while running but not in a draft, ready or ended exam', () => {
    setExamState('running');
    expect(sw.set(examId, false).internet).toBe('blocked');
    for (const state of ['draft', 'ready', 'ended'] as const) {
      setExamState(state);
      expect(() => sw.set(examId, true)).toThrow(HostingError);
    }
  });

  it('refuses an unknown exam', () => {
    expect(() => sw.set('nope', false)).toThrow(/not found/i);
  });

  it('reset allows the internet again without logging a teacher action', () => {
    sw.set(examId, false);
    sw.reset(examId);
    expect(sw.state(examId)).toBe('allowed');
    expect(actions.list(examId)).toHaveLength(1);
  });
});
