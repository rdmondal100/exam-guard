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
}

export const USAGE = `Usage: student-sim --host <ip[:port]> --pin <6 digits> [--students 200] [--csv file] [--ramp-ms 20] [--autosave-ms 10000]

  --host        Teacher address (default port 47820)
  --pin         The 6-digit PIN shown on the hosting screen
  --students    How many fake students to run (1-1000, default 10)
  --csv         Class list CSV (student ID in column 1); default codes 1..N
  --ramp-ms     Pause between starting two students (default 20)
  --autosave-ms Each student saves an answer this often once the exam runs (0 = never, default 0)`;

const DEFAULT_PORT = 47820;

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
  const known = new Set(['host', 'pin', 'students', 'csv', 'ramp-ms', 'autosave-ms']);
  for (const name of flags.keys()) if (!known.has(name)) throw new Error(`Unknown flag --${name}`);

  const hostText = flags.get('host');
  if (!hostText) throw new Error('--host is required');
  const [host = '', portText, ...extra] = hostText.split(':');
  const port = portText === undefined ? DEFAULT_PORT : Number(portText);
  if (!host || extra.length > 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`"${hostText}" is not a valid host`);
  }

  const pin = flags.get('pin') ?? '';
  if (!/^\d{6}$/.test(pin)) throw new Error('--pin must be 6 digits');

  const students = Number(flags.get('students') ?? '10');
  if (!Number.isInteger(students) || students < 1 || students > 1000) {
    throw new Error('--students must be a whole number from 1 to 1000');
  }
  const rampMs = Number(flags.get('ramp-ms') ?? '20');
  if (!Number.isInteger(rampMs) || rampMs < 0 || rampMs > 10_000) {
    throw new Error('--ramp-ms must be a whole number from 0 to 10000');
  }
  const autosaveMs = Number(flags.get('autosave-ms') ?? '0');
  if (!Number.isInteger(autosaveMs) || autosaveMs < 0 || (autosaveMs > 0 && autosaveMs < 100)) {
    throw new Error('--autosave-ms must be 0 (off) or a whole number of at least 100');
  }
  return { host, port, pin, students, csv: flags.get('csv'), rampMs, autosaveMs };
}
