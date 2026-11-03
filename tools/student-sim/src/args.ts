export interface SimOptions {
  host: string;
  port: number;
  pin: string;
  students: number;
  /** CSV path; without it the sim uses the codes 1..N. */
  csv?: string | undefined;
  /** Delay between starting two students. */
  rampMs: number;
  /** Each student saves an answer this often once the exam runs; 0 = never. */
  autosaveMs: number;
  /** Each student submits this long after the questions arrive; 0 = wait for the auto-submit. */
  submitAfterMs: number;
  /** Each student drops its socket about this often; 0 = never. */
  disconnectEveryMs: number;
  /** Each student leaves the exam window about this often (events with screenshots); 0 = never. */
  eventsEveryMs: number;
  /** `full` (M47): saves, events, drops, thumbnails and submits, then a metrics report. */
  scenario: 'basic' | 'full';
  /** Full scenario: minutes the exam runs before the students submit. */
  minutes: number;
  /** No `--host` in the full scenario: the sim starts its own exam server. */
  selfHost: boolean;
}

export const USAGE = `Usage: student-sim --host <ip[:port]> --pin <6 digits> [--students 200] [--csv file] [--ramp-ms 20] [--autosave-ms 10000]
                    [--submit-after-ms 60000] [--disconnect-every-ms 20000] [--events-every-ms 120000]
       student-sim --scenario full [--students 200] [--minutes 30] [--host <ip[:port]> --pin <6 digits>]

  --host        Teacher address (default port 47820)
  --pin         The 6-digit PIN shown on the hosting screen
  --students    How many fake students to run (1-1000, default 10)
  --csv         Class list CSV (student ID in column 1); default codes 1..N
  --ramp-ms     Pause between starting two students (default 20)
  --autosave-ms Each student saves an answer this often once the exam runs (0 = never, default 0)
  --submit-after-ms     Each student submits this long after the questions arrive, once its saves are
                        in (0 = leave them to the auto-submit at time-up, default 0)
  --disconnect-every-ms Each student drops its connection about this often and reconnects
                        (0 = never, default 0; at least 1000)
  --events-every-ms     Each student leaves the exam window about this often: focus_lost with a
                        150 KB screenshot, sometimes still_outside, then focus_returned (0 = never)
  --scenario    basic (default) or full (M47 load test): autosave 10 s, events every 2 min, a drop
                about every 5 min, submits in the last minute, and a metrics report. Without --host
                the sim starts its own exam server (and a teacher socket showing 30 thumbnails);
                with --host it joins the teacher app's exam, which the teacher starts and ends.
  --minutes     Full scenario: minutes before the students submit (2-240, default 30)`;

const DEFAULT_PORT = 47820;

const KNOWN = new Set([
  'host',
  'pin',
  'students',
  'csv',
  'ramp-ms',
  'autosave-ms',
  'submit-after-ms',
  'disconnect-every-ms',
  'events-every-ms',
  'scenario',
  'minutes',
]);

/** A whole number flag that is 0 (off) or at least `min`. */
function interval(flags: Map<string, string>, name: string, fallback: number, min: number): number {
  const value = Number(flags.get(name) ?? String(fallback));
  if (!Number.isInteger(value) || value < 0 || (value > 0 && value < min)) {
    throw new Error(`--${name} must be 0 (off) or a whole number of at least ${min}`);
  }
  return value;
}

/** Parses `--flag value` pairs. Throws an Error with a readable message when invalid. */
export function parseArgs(argv: string[]): SimOptions {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag === '--') continue;
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument "${flag}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    flags.set(flag.slice(2), value);
    i += 1;
  }
  for (const name of flags.keys()) if (!KNOWN.has(name)) throw new Error(`Unknown flag --${name}`);

  const scenario = flags.get('scenario') ?? 'basic';
  if (scenario !== 'basic' && scenario !== 'full') {
    throw new Error('--scenario must be basic or full');
  }
  const full = scenario === 'full';
  const selfHost = full && !flags.has('host');

  let host = '127.0.0.1';
  let port = 0;
  let pin = '000000';
  if (!selfHost) {
    const hostText = flags.get('host');
    if (!hostText) throw new Error('--host is required');
    const [name = '', portText, ...extra] = hostText.split(':');
    host = name;
    port = portText === undefined ? DEFAULT_PORT : Number(portText);
    if (!host || extra.length > 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`"${hostText}" is not a valid host`);
    }
    pin = flags.get('pin') ?? '';
    if (!/^\d{6}$/.test(pin)) throw new Error('--pin must be 6 digits');
  } else if (flags.has('pin')) {
    throw new Error('--pin needs --host (without --host the sim hosts its own exam)');
  }

  const students = Number(flags.get('students') ?? '10');
  if (!Number.isInteger(students) || students < 1 || students > 1000) {
    throw new Error('--students must be a whole number from 1 to 1000');
  }
  const rampMs = Number(flags.get('ramp-ms') ?? '20');
  if (!Number.isInteger(rampMs) || rampMs < 0 || rampMs > 10_000) {
    throw new Error('--ramp-ms must be a whole number from 0 to 10000');
  }
  const minutes = Number(flags.get('minutes') ?? '30');
  if (!Number.isInteger(minutes) || minutes < 2 || minutes > 240) {
    throw new Error('--minutes must be a whole number from 2 to 240');
  }
  return {
    host,
    port,
    pin,
    students,
    csv: flags.get('csv'),
    rampMs,
    autosaveMs: interval(flags, 'autosave-ms', full ? 10_000 : 0, 100),
    submitAfterMs: interval(flags, 'submit-after-ms', 0, 100),
    disconnectEveryMs: interval(flags, 'disconnect-every-ms', full ? 300_000 : 0, 1000),
    eventsEveryMs: interval(flags, 'events-every-ms', full ? 120_000 : 0, 1000),
    scenario,
    minutes,
    selfHost,
  };
}
