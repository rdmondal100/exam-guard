import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamState, ServerToStudent } from '@examguard/shared';
import type { Db } from '../db/connection.js';
import { initDatabase } from '../db/database.js';
import { ExamRepo } from '../db/exam-repo.js';
import { TeacherActionRepo } from '../db/teacher-action-repo.js';
import { TerminalRepo } from '../db/terminal-repo.js';
import type { SessionHub } from '../ws/session-hub.js';
import { HostingError } from './hosting-error.js';
import { TerminalSwitch } from './terminal-switch.js';

let dir: string;
let db: Db;
let examId: string;
let clock: number;
let pushed: ServerToStudent[];
let actions: TeacherActionRepo;
let terminals: TerminalRepo;
let sw: TerminalSwitch;

const setExamState = (state: ExamState) =>
  db.prepare('UPDATE exams SET state = ? WHERE id = ?').run(state, examId);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  vi.setSystemTime(clock);
  dir = mkdtempSync(join(tmpdir(), 'eg-term-'));
  db = initDatabase(dir);
  const exams = new ExamRepo(db);
  examId = exams.create({ title: 'Mid', durationMin: 60, classListId: null }, 1).id;
  setExamState('hosting');
  pushed = [];
  const hub = {
    broadcast: (build: (id: string) => ServerToStudent) => pushed.push(build('s1')),
  } as unknown as SessionHub;
  actions = new TeacherActionRepo(db);
  terminals = new TerminalRepo(db);
  sw = new TerminalSwitch({
    terminals,
    actions,
    hub,
    examState: (id) => exams.get(id)?.state,
    now: () => Date.now(),
  });
});

afterEach(() => {
  sw.disarm();
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const lastTerminal = () => {
  const message = pushed.at(-1);
  return message?.t === 'state' ? message.state.terminal : undefined;
};

describe('TerminalSwitch', () => {
  it('is off by default', () => {
    expect(sw.state(examId)).toEqual({ enabled: false, until: null });
  });

  it('turns on and off, pushes each change and logs it', () => {
    sw.set(examId, true);
    expect(lastTerminal()).toEqual({ enabled: true, until: null });
    sw.set(examId, false);
    expect(lastTerminal()).toEqual({ enabled: false, until: null });
    expect(actions.list(examId).map((a) => a.payload)).toEqual([
      { enabled: true },
      { enabled: false },
    ]);
  });

  it('counts "N minutes" from Start when set while hosting', () => {
    const result = sw.set(examId, true, 2);
    expect(result).toMatchObject({ terminal: { enabled: true, until: null }, pendingMinutes: 2 });
    setExamState('running');
    sw.examStarted(examId, clock + 5_000);
    expect(sw.state(examId)).toEqual({ enabled: true, until: clock + 5_000 + 120_000 });
    expect(sw.pendingMinutes(examId)).toBeNull();
  });

  it('counts from now when set while running, and turns off on time', () => {
    setExamState('running');
    sw.set(examId, true, 2);
    expect(sw.state(examId).until).toBe(clock + 120_000);
    vi.advanceTimersByTime(119_999);
    expect(sw.state(examId).enabled).toBe(true);
    vi.advanceTimersByTime(1);
    expect(sw.state(examId)).toEqual({ enabled: false, until: null });
    expect(lastTerminal()).toEqual({ enabled: false, until: null });
    expect(actions.list(examId).at(-1)?.payload).toEqual({ enabled: false, reason: 'time_up' });
  });

  it('re-arms from the stored window (after a restart)', () => {
    setExamState('running');
    terminals.set(examId, { enabled: true, until: clock + 1_000, pendingMinutes: null }, clock);
    sw.arm(examId);
    vi.advanceTimersByTime(1_000);
    expect(sw.state(examId).enabled).toBe(false);
  });

  it('check() turns off a window that has passed, and leaves an open one alone', () => {
    setExamState('running');
    terminals.set(examId, { enabled: true, until: clock + 10, pendingMinutes: null }, clock);
    sw.check(examId);
    expect(sw.state(examId).enabled).toBe(true);
    vi.setSystemTime(clock + 10);
    sw.check(examId);
    expect(sw.state(examId).enabled).toBe(false);
  });

  it.each(['draft', 'ready', 'ended'] as const)('refuses a change in a %s exam', (state) => {
    setExamState(state);
    expect(() => sw.set(examId, true)).toThrow(HostingError);
    expect(pushed).toEqual([]);
  });

  it('refuses an unknown exam', () => {
    expect(() => sw.set('nope', true)).toThrow(/not found/);
  });
});
