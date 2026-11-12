/**
 * Characters cmd.exe reads even inside quotes (`%`), or that would end the quoting (`"`). A run
 * whose command contains one is refused rather than handed to cmd.
 */
const CMD_SPECIAL = /["%]/;

/** The command line cmd.exe runs: every argument quoted, the whole wrapped once more for `/s`. */
export function cmdHostArgs(argv: string[]): string | null {
  if (argv.length === 0 || argv.some((arg) => CMD_SPECIAL.test(arg))) return null;
  return `/d /s /c "${argv.map((arg) => `"${arg}"`).join(' ')}"`;
}

/**
 * JavaScript runs on Electron's executable with `ELECTRON_RUN_AS_NODE`, and Electron is a GUI
 * program: started as the pseudo-console's own process it has no console, so it prints nothing
 * and reads nothing. cmd.exe (a console program) hosts it instead; Electron attaches to cmd's
 * console, which is the run console, and cmd waits for it and passes its exit code on. Stop and
 * the time limit kill cmd's whole process tree, so Electron ends with it.
 */
export function viaCmd(comspec: string, argv: string[]): { command: string; args: string } | null {
  const args = cmdHostArgs(argv);
  return args === null ? null : { command: comspec, args };
}
