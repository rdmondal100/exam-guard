import { execFile } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  /** Exit code; `-1` if the program could not be started. */
  code: number;
}

/** Runs a program and never rejects: a non-zero exit is a result, not an error. */
export type RunCommand = (file: string, args: string[]) => Promise<CommandResult>;

export const runCommand: RunCommand = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 120_000 }, (error, stdout) => {
      if (!error) return resolve({ stdout, code: 0 });
      resolve({ stdout, code: typeof error.code === 'number' ? error.code : -1 });
    });
  });
