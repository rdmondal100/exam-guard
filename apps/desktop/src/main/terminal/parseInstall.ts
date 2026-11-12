export type PackageManager = 'npm' | 'pip' | 'pacman';

export interface InstallCommand {
  manager: PackageManager;
  /** Package names as typed; empty for e.g. `npm install` from package.json. */
  packages: string[];
}

/** pip options that take a value, which is not a package name. */
const PIP_VALUE_FLAGS = new Set([
  '-r',
  '--requirement',
  '-c',
  '--constraint',
  '-t',
  '--target',
  '-i',
  '--index-url',
  '--extra-index-url',
  '--prefix',
  '--root',
]);
/** pacman `-S` letters that only refresh, upgrade or install; others search, query or clean. */
const PACMAN_INSTALL_LETTERS = /^-S[yudvw]*$/;

const unquote = (t: string) => t.replace(/^(['"])(.*)\1$/, '$2');

/** `C:\x\npm.cmd` → `npm`. */
function commandName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/, '');
}

function parseSegment(tokens: string[]): InstallCommand | null {
  const [first, ...rest] = tokens;
  if (first === undefined) return null;
  const name = commandName(first);

  if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
    const sub = rest.findIndex((t) => !t.startsWith('-'));
    if (sub < 0 || !['i', 'install', 'add', 'isntall'].includes(rest[sub] ?? '')) return null;
    return { manager: 'npm', packages: rest.slice(sub + 1).filter((t) => !t.startsWith('-')) };
  }

  let pipArgs: string[] | null = null;
  if (name === 'pip' || name === 'pip3') pipArgs = rest;
  else if (['python', 'python3', 'py'].includes(name)) {
    const m = rest.indexOf('-m');
    if (m >= 0 && rest[m + 1] === 'pip') pipArgs = rest.slice(m + 2);
  }
  if (pipArgs) {
    if (pipArgs[0] !== 'install') return null;
    const packages: string[] = [];
    for (let i = 1; i < pipArgs.length; i += 1) {
      const t = pipArgs[i] ?? '';
      if (PIP_VALUE_FLAGS.has(t)) i += 1;
      else if (!t.startsWith('-')) packages.push(t);
    }
    return { manager: 'pip', packages };
  }

  if (name === 'pacman') {
    const op = rest.find((t) => t.startsWith('-S') || t === '--sync');
    if (!op || !(op === '--sync' || PACMAN_INSTALL_LETTERS.test(op))) return null;
    return { manager: 'pacman', packages: rest.filter((t) => !t.startsWith('-')) };
  }
  return null;
}

/**
 * The package installs in one command line (`npm i`, `pip install`, `python -m pip install`,
 * `pacman -S`), split on `;`, `&&`, `||` and `|`. Best effort: it reads what was typed, not
 * whether the install worked.
 */
export function parseInstalls(line: string): InstallCommand[] {
  const found: InstallCommand[] = [];
  for (const segment of line.split(/;|&&|\|\||\|/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
    // `& 'C:\path\npm.cmd' i x` — the call operator.
    if (tokens[0] === '&') tokens.shift();
    const install = parseSegment(tokens);
    if (install) found.push(install);
  }
  return found;
}
