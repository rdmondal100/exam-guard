import { describe, expect, it } from 'vitest';
import { ReadinessReportMessageSchema, readinessProblems } from './readiness.js';
import { StudentMessageSchema } from './ws.js';

describe('readiness report (M54)', () => {
  const report = {
    checks: [
      { name: 'c', ok: true, ms: 800 },
      { name: 'cpp', ok: false, ms: 20000, message: 'Timed out' },
      { name: 'python', ok: true, ms: 300 },
      { name: 'js', ok: true, ms: 200 },
      { name: 'disk', ok: false, ms: 1 },
    ],
  };

  it('is a student message', () => {
    const message = { t: 'readiness.report', ...report };
    expect(ReadinessReportMessageSchema.safeParse(message).success).toBe(true);
    expect(StudentMessageSchema.safeParse(message).success).toBe(true);
  });

  it('rejects unknown checks', () => {
    const bad = { t: 'readiness.report', checks: [{ name: 'java', ok: true, ms: 1 }] };
    expect(StudentMessageSchema.safeParse(bad).success).toBe(false);
  });

  it('needs every check exactly once (M60), so a partial report never reads as ready', () => {
    const t = 'readiness.report';
    expect(StudentMessageSchema.safeParse({ t, checks: [] }).success).toBe(false);
    const doubled = [...report.checks.slice(0, 4), report.checks[0]];
    expect(StudentMessageSchema.safeParse({ t, checks: doubled }).success).toBe(false);
  });

  it('names the failed checks for the teacher', () => {
    expect(readinessProblems(report as never)).toEqual(['C++: Timed out', 'Disk space']);
  });
});
