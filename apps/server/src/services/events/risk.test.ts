import { describe, expect, it } from 'vitest';
import { RISK_POINTS, riskPoints } from './risk.js';

describe('riskPoints', () => {
  it('weighs behaviour by severity', () => {
    expect(riskPoints('focus_lost', 'low')).toBe(RISK_POINTS.low);
    expect(riskPoints('focus_lost', 'high')).toBe(RISK_POINTS.high);
    expect(riskPoints('agent_lost', 'critical')).toBe(RISK_POINTS.critical);
    expect(RISK_POINTS.low).toBeLessThan(RISK_POINTS.medium);
    expect(RISK_POINTS.medium).toBeLessThan(RISK_POINTS.high);
    expect(RISK_POINTS.high).toBeLessThan(RISK_POINTS.critical);
  });

  it('gives the student’s own work and the teacher’s switches no points', () => {
    for (const type of [
      'run_executed',
      'terminal_command',
      'internet_blocked',
      'processes_at_start',
    ]) {
      expect(riskPoints(type, 'medium'), type).toBe(0);
    }
  });
});
