/**
 * The message of an error thrown by main through `ipcRenderer.invoke`, without Electron's
 * "Error invoking remote method 'x': Error: " prefix, so students and teachers see plain words.
 */
export function ipcErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '');
}
