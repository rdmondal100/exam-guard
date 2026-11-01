import type { EventReport, MonitoringSettings } from '@examguard/shared';
import type { EventRepo } from '../db/event-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import { ChunkAssembler } from './chunk-assembler.js';
import { placeholderSeverity } from './placeholder-severity.js';
import type { ScreenshotStore } from './screenshot-store.js';

export interface EvidenceIntakeDeps {
  events: EventRepo;
  students: Pick<ExamStudentRepo, 'addOutsideMs'>;
  screenshots: Pick<ScreenshotStore, 'save'>;
  /** The exam's monitoring settings (the teacher's high-severity programs). */
  monitoring: (examId: string) => Pick<MonitoringSettings, 'highSeverityApps'> | undefined;
  /** A student's roster row changed (the outside total). */
  changed: (studentId: string) => void;
  now: () => number;
}

/**
 * What the agent saw, relayed by the student app: screenshot chunks arrive as binary frames, then
 * the `event` that names them. The event is stored with its picture, and `focus_returned` adds its
 * duration to the student's outside total. A repeated event (a replay) changes nothing.
 */
export class EvidenceIntake {
  private readonly chunks = new ChunkAssembler();

  constructor(private readonly deps: EvidenceIntakeDeps) {}

  /** One binary frame from the student. */
  chunk(studentId: string, frame: Uint8Array): void {
    this.chunks.add(studentId, frame);
  }

  report(examId: string, studentId: string, message: EventReport): void {
    // Taken before the duplicate check, so a replayed event's chunks never pile up.
    const jpeg = message.screenshotRef ? this.chunks.take(studentId, message.screenshotRef) : null;
    const details = message.details;
    const monitoring = this.deps.monitoring(examId);
    const id = this.deps.events.insertReturningId({
      examId,
      examStudentId: studentId,
      type: message.type,
      severity: placeholderSeverity(message.type, details, monitoring?.highSeverityApps ?? []),
      source: 'agent',
      details,
      serverTs: this.deps.now(),
      clientTs: message.clientTs,
      dedupeKey: `agent:${message.dedupeKey}`,
    });
    if (id === null) return;
    if (jpeg) {
      this.deps.events.setScreenshot(id, this.deps.screenshots.save(examId, studentId, id, jpeg));
    }
    const away = details['durationMs'];
    if (message.type === 'focus_returned' && typeof away === 'number' && away > 0) {
      this.deps.students.addOutsideMs(studentId, away);
      this.deps.changed(studentId);
    }
  }

  forget(studentId: string): void {
    this.chunks.forget(studentId);
  }
}
