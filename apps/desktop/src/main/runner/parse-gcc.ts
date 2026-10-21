import type { Diagnostic } from '@examguard/shared';

const LINE = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;

/**
 * Turns gcc/g++ output (`file:line:col: error|warning|note: msg`) into diagnostics for the
 * student's source file. Linker errors and messages about other files (headers) are left out;
 * they still show in the Errors tab.
 */
export function parseGcc(output: string, fileName: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const [, file = '', line = '1', col = '1', kind = 'error', message = ''] = m;
    if (file.replace(/^\.[\\/]/, '') !== fileName) continue;
    diagnostics.push({
      line: Math.max(1, Number(line)),
      col: Math.max(1, Number(col)),
      severity: kind === 'fatal error' ? 'error' : (kind as Diagnostic['severity']),
      message,
    });
  }
  return diagnostics;
}
