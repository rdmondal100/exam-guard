import { isMonitoringEvent, type EventRow, type Severity } from '@examguard/shared';
import type { EventRepo, NewEvent } from '../../db/repositories/event.repo.js';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import { classifyEvent } from './classify.js';
import { riskPoints } from './risk.js';

/** An event to store; without `severity` the classifier decides it. */
export type RecordInput = Omit<NewEvent, 'severity'> & { severity?: Severity };

/** What listeners hear after an event is stored. */
export interface StoredEvent {
  examId: string;
  event: EventRow;
  /** Part of the monitoring view: pushed to the teacher as a live alert. */
  monitoring: boolean;
  /** Points added to the student's risk score (0 = unchanged). */
  riskAdded: number;
}

export interface EventRecorderDeps {
  events: Pick<EventRepo, 'insertReturningId' | 'row' | 'lastOfTypes'>;
  students: Pick<ExamStudentRepo, 'addRisk'>;
  exams: Pick<ExamRepo, 'get'>;
}

const OUTSIDE_TYPES = ['focus_lost', 'focus_returned'] as const;

/**
 * The one way events get stored (M31): classify the severity, insert once per dedupe key, add the
 * risk points to the student and tell the listeners (live alert, roster push). A repeated event
 * changes nothing and returns `null`.
 */
export class EventRecorder {
  private readonly listeners = new Set<(stored: StoredEvent) => void>();

  constructor(private readonly deps: EventRecorderDeps) {}

  /** Returns the unsubscribe function. */
  onStored(listener: (stored: StoredEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stores the event. `attach` runs right after the insert, before the listeners hear of it
   * (the screenshot is linked there, so the alert knows it has one).
   */
  record(input: RecordInput, attach?: (id: number) => void): number | null {
    const severity = input.severity ?? this.classify(input);
    const id = this.deps.events.insertReturningId({ ...input, severity });
    if (id === null) return null;
    attach?.(id);
    const points = input.examStudentId ? riskPoints(input.type, severity) : 0;
    if (input.examStudentId && points > 0) this.deps.students.addRisk(input.examStudentId, points);
    if (this.listeners.size > 0) {
      const event = this.deps.events.row(id);
      if (event) {
        const stored: StoredEvent = {
          examId: input.examId,
          event,
          monitoring: isMonitoringEvent(input.source, input.type),
          riskAdded: points,
        };
        for (const listener of this.listeners) listener(stored);
      }
    }
    return id;
  }

  private classify(input: RecordInput): Severity {
    const monitoring = this.deps.exams.get(input.examId)?.monitoring;
    return classifyEvent({
      type: input.type,
      details: input.details,
      highSeverityApps: monitoring?.highSeverityApps ?? [],
      ...this.outsideSoFar(input),
    });
  }

  /** For a shot taken while away: the time since the switch, on the student PC's clock. */
  private outsideSoFar(input: RecordInput): { outsideMs?: number } {
    if (input.type !== 'still_outside' && input.type !== 'title_changed') return {};
    if (!input.examStudentId || input.clientTs === undefined) return {};
    const last = this.deps.events.lastOfTypes(input.examStudentId, OUTSIDE_TYPES);
    if (last?.type !== 'focus_lost' || last.clientTs === null) return {};
    return { outsideMs: Math.max(0, input.clientTs - last.clientTs) };
  }
}
