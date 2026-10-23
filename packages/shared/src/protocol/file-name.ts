/** Longest file or folder name, in characters. */
export const FILE_NAME_MAX_CHARS = 120;

/** Characters Windows does not allow in a name, the two separators, and control characters. */
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\\/<>:"|?*\u0000-\u001f]/;
const DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Why `name` cannot be one file or folder name on a student's PC, or `null` if it can. One rule
 * for the teacher's upload, the student's copy and the Files panel, so a file the teacher
 * attached can always be written where it is going.
 */
export function checkFileName(name: string): string | null {
  if (name === '') return 'Enter a name.';
  if (name.length > FILE_NAME_MAX_CHARS) return 'That name is too long.';
  if (BAD_CHARS.test(name)) return 'A name cannot contain < > : " | ? * or \\ /.';
  if (/[ .]$/.test(name)) return 'A name cannot end with a space or a dot.';
  if (DEVICE_NAMES.test(name)) return `"${name}" is a reserved name on Windows.`;
  return null;
}
