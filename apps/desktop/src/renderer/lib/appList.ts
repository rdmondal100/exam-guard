/** The high-severity app list as typed ("chrome.exe, discord.exe") → the names. */
export function splitApps(text: string): string[] {
  return text
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
}
