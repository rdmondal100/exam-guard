import { describe, expect, it } from 'vitest';
import type { TerminalLogEvent } from '@examguard/shared';
import { describeTerminalEvent } from './terminalLog';

const ev = (type: string, details: Record<string, unknown> = {}): TerminalLogEvent => ({
  id: 1,
  type,
  serverTs: 0,
  clientTs: null,
  details,
});

describe('describeTerminalEvent', () => {
  it('describes each terminal event type', () => {
    expect(describeTerminalEvent(ev('terminal_opened'))).toBe('Opened the terminal');
    expect(describeTerminalEvent(ev('terminal_closed', { reason: 'closed' }))).toBe(
      'Closed the terminal',
    );
    expect(describeTerminalEvent(ev('terminal_closed', { reason: 'turned_off' }))).toBe(
      'Terminal closed (turned off)',
    );
    expect(describeTerminalEvent(ev('terminal_command', { line: 'npm i lodash' }))).toBe(
      '> npm i lodash',
    );
    expect(describeTerminalEvent(ev('terminal_command', { line: 'x', truncated: true }))).toBe(
      '> x …',
    );
    expect(
      describeTerminalEvent(ev('package_installed', { manager: 'pip', packages: ['numpy'] })),
    ).toBe('Installed with pip: numpy');
    expect(describeTerminalEvent(ev('package_installed', { manager: 'npm', packages: [] }))).toBe(
      'Installed with npm: (from the project file)',
    );
  });

  it('copes with odd details', () => {
    expect(describeTerminalEvent(ev('terminal_command', { line: 5 }))).toBe('> ');
    expect(describeTerminalEvent(ev('package_installed', { packages: 'x' }))).toBe(
      'Installed with : (from the project file)',
    );
  });
});
