import type { EventRow } from '@examguard/shared';

/** `45 s`, `3 min 5 s`, `1 h 2 min`: the length of a stretch away from the exam. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The programs of a `processes_at_start` event, one entry per name with how many are running. */
export function programCounts(details: Record<string, unknown>): { exe: string; count: number }[] {
  const list = details['processes'];
  if (!Array.isArray(list)) return [];
  const counts = new Map<string, number>();
  for (const item of list) {
    const exe =
      item && typeof item === 'object' ? text((item as Record<string, unknown>)['exe']) : '';
    if (exe) counts.set(exe, (counts.get(exe) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([exe, count]) => ({ exe, count }))
    .sort((a, b) => a.exe.localeCompare(b.exe, undefined, { sensitivity: 'base' }));
}

const PASTE_SURFACE_TEXT: Record<string, string> = {
  editor: ' in the code editor',
  answer: ' in an answer box',
  terminal: ' in the terminal',
};

/** `: "the first 80 characters…"` of a paste or insertion preview, or nothing. */
function quote(details: Record<string, unknown>): string {
  const preview = text(details['preview']).replace(/\s+/g, ' ').trim();
  if (!preview) return '';
  return `: "${preview.length > 80 ? `${preview.slice(0, 80)}…` : preview}"`;
}

/** One line for the teacher's event list. */
export function describeEvent(event: EventRow): string {
  const { details } = event;
  const exe = text(details['exe']);
  const title = text(details['title']);
  const where = [exe, title].filter(Boolean).join(' · ');
  switch (event.type) {
    case 'focus_lost':
      return `Left the exam for ${where || 'another window'}`;
    case 'title_changed':
      return `Now on ${where || 'another page'}`;
    case 'still_outside':
      return `Still outside, on ${where || 'another window'}`;
    case 'focus_returned': {
      const away = details['durationMs'];
      const back = typeof away === 'number' ? ` after ${formatDuration(away)}` : '';
      return `Came back${back}${exe ? ` from ${exe}` : ''}`;
    }
    case 'app_launched': {
      const parent = text(details['parentExe']);
      return `Started ${exe || 'a program'}${parent ? ` (from ${parent})` : ''}`;
    }
    case 'processes_at_start': {
      const programs = programCounts(details);
      return programs.length === 0
        ? 'No programs were running at the start'
        : `Running at the start: ${programs.length} program${programs.length === 1 ? '' : 's'}`;
    }
    case 'paste_blocked': {
      const chars = typeof details['chars'] === 'number' ? details['chars'] : 0;
      const lines = typeof details['lines'] === 'number' ? details['lines'] : 0;
      const surface = PASTE_SURFACE_TEXT[text(details['surface'])] ?? '';
      const more =
        typeof details['suppressed'] === 'number' ? ` (+${details['suppressed']} more)` : '';
      return `Paste from outside the exam blocked${more} (${chars} chars, ${lines} line${lines === 1 ? '' : 's'})${surface}${quote(details)}`;
    }
    case 'app_relaunched':
      return 'ExamGuard was closed and the agent started it again';
    case 'monitor_changed': {
      const now = details['monitors'];
      const before = details['monitorsBefore'];
      if (typeof now !== 'number') return 'Screens changed';
      if (typeof before === 'number') return `Screens changed: ${before} → ${now}`;
      return `${now} screen${now === 1 ? '' : 's'} connected at the start`;
    }
    case 'secure_desktop': {
      const desktop = text(details['desktop']);
      if (desktop && desktop.toLowerCase() !== 'winlogon') {
        return `Another desktop took the screen: ${desktop}`;
      }
      return 'Security screen opened (Ctrl+Alt+Del, lock screen or UAC prompt)';
    }
    case 'taskmgr_opened': {
      const parent = text(details['parentExe']);
      return `Opened Task Manager${parent ? ` (from ${parent})` : ''}`;
    }
    case 'large_insertion': {
      const chars = typeof details['chars'] === 'number' ? details['chars'] : 0;
      const lines = typeof details['lines'] === 'number' ? details['lines'] : 0;
      const surface = PASTE_SURFACE_TEXT[text(details['surface'])] ?? '';
      const more =
        typeof details['suppressed'] === 'number' ? ` (+${details['suppressed']} more)` : '';
      const ms = typeof details['durationMs'] === 'number' ? details['durationMs'] : 0;
      const when = ms < 1000 ? 'at once' : `in ${formatDuration(ms)}`;
      return `Large text insertion${more}: ${chars} chars, ${lines} new line${lines === 1 ? '' : 's'} ${when}${surface}${quote(details)}`;
    }
    case 'network_lost':
      return 'Lost the connection to this PC';
    case 'network_restored': {
      const down = details['downMs'];
      return `Connection back${typeof down === 'number' ? ` after ${formatDuration(down)}` : ''}`;
    }
    case 'duplicate_login':
      return 'Someone tried to sign in as this student on another PC';
    case 'agent_lost': {
      const reason = text(details['reason']);
      return `Monitoring agent lost, student locked${reason ? `: ${reason}` : ''}`;
    }
    default:
      return event.type;
  }
}

/** Where the picture goes: a data URL, because the page may only load `data:` images. */
export function jpegDataUrl(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode(...view.subarray(i, i + step));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
