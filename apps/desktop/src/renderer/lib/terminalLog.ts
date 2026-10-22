import type { TerminalLogEvent } from '@examguard/shared';

/** One line of the teacher's terminal log list. */
export function describeTerminalEvent(event: TerminalLogEvent): string {
  const d = event.details;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (event.type) {
    case 'terminal_opened':
      return 'Opened the terminal';
    case 'terminal_closed': {
      const reason = text(d.reason);
      if (reason === 'turned_off') return 'Terminal closed (turned off)';
      if (reason === 'exited') return 'Terminal ended (shell exited)';
      return 'Closed the terminal';
    }
    case 'terminal_command':
      return `> ${text(d.line)}${d.truncated === true ? ' …' : ''}`;
    case 'package_installed': {
      const packages = Array.isArray(d.packages)
        ? d.packages.filter((p) => typeof p === 'string')
        : [];
      const what = packages.length > 0 ? packages.join(', ') : '(from the project file)';
      return `Installed with ${text(d.manager)}: ${what}`;
    }
    default:
      return event.type;
  }
}

/** `HH:MM:SS` in local time. */
export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
