import {
  ServerToTeacherSchema,
  type EventRow,
  type GradingStatus,
  type HostingCounts,
  type RosterEntry,
  type ServerToTeacher,
} from '@examguard/shared';
import { pushAlert } from './eventFeed';

export interface RosterState {
  students: ReadonlyMap<string, RosterEntry>;
  counts: HostingCounts | null;
  /** Monitoring events pushed live since the socket opened, newest first (M31). */
  alerts: readonly EventRow[];
  /** The latest `grading.progress` push (M38), `null` until one arrives. */
  grading: GradingStatus | null;
}

export const EMPTY_ROSTER: RosterState = {
  students: new Map(),
  counts: null,
  alerts: [],
  grading: null,
};

/** Parses one teacher WS frame; `null` when it is not a known message. */
export function parseTeacherFrame(raw: string): ServerToTeacher | null {
  try {
    const parsed = ServerToTeacherSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Merges a push into the roster: `roster` carries the students that changed, by id; `alert` adds
 * a live monitoring event.
 */
export function applyTeacherMessage(state: RosterState, message: ServerToTeacher): RosterState {
  if (message.t === 'roster') {
    const students = new Map(state.students);
    for (const entry of message.students) students.set(entry.id, entry);
    return { ...state, students };
  }
  if (message.t === 'hosting') {
    const { joined, inLobby, active, submitted, connected } = message;
    return { ...state, counts: { joined, inLobby, active, submitted, connected } };
  }
  if (message.t === 'alert') return { ...state, alerts: pushAlert(state.alerts, message.event) };
  if (message.t === 'grading.progress') return { ...state, grading: message.status };
  return state;
}

/** Roster rows ordered by student code, numerically when both codes are numbers. */
export function sortedStudents(state: RosterState): RosterEntry[] {
  return [...state.students.values()].sort((a, b) =>
    a.studentCode.localeCompare(b.studentCode, undefined, { numeric: true }),
  );
}
