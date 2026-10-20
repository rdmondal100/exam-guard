import {
  ServerToTeacherSchema,
  type HostingCounts,
  type RosterEntry,
  type ServerToTeacher,
} from '@examguard/shared';

export interface RosterState {
  students: ReadonlyMap<string, RosterEntry>;
  counts: HostingCounts | null;
}

export const EMPTY_ROSTER: RosterState = { students: new Map(), counts: null };

/** Parses one teacher WS frame; `null` when it is not a known message. */
export function parseTeacherFrame(raw: string): ServerToTeacher | null {
  try {
    const parsed = ServerToTeacherSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Merges a push into the roster: `roster` carries the students that changed, by id. */
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
  return state;
}

/** Roster rows ordered by student code, numerically when both codes are numbers. */
export function sortedStudents(state: RosterState): RosterEntry[] {
  return [...state.students.values()].sort((a, b) =>
    a.studentCode.localeCompare(b.studentCode, undefined, { numeric: true }),
  );
}
