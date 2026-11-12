import { randomBytes } from 'node:crypto';

/** OSC number of the command marker: `ESC ] 6973 ; <nonce> ; <base64 UTF-8 line> BEL`. */
export const COMMAND_OSC = '6973';

/** A fresh nonce per terminal, so text that merely looks like a marker is not taken as one. */
export function newNonce(): string {
  return randomBytes(12).toString('hex');
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** What PowerShell runs first (`-NoExit -Command`): dot-sources the init script. */
export function initCommand(scriptPath: string): string {
  return `. ${psQuote(scriptPath)}`;
}

/**
 * The PowerShell 5.1 init script (`.examguard\init.ps1`). PSReadLine's AddToHistoryHandler sees
 * each accepted line as the student finished it (Tab completion and history recall included),
 * before it runs, and writes the marker that student main turns into a `terminal_command` event.
 * A line that removes the handler is itself reported first. Without PSReadLine a `prompt`
 * function reports the last history entry instead (after it ran).
 */
export function shellInitScript(nonce: string, scriptPath: string): string {
  const init = psQuote(initCommand(scriptPath));
  const mark = (v: string) =>
    `[Console]::Write([string][char]27 + ']${COMMAND_OSC};${nonce};' + ` +
    `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${v})) + [string][char]7)`;
  return [
    '# ExamGuard exam terminal. Every command line is reported to the teacher.',
    'Import-Module PSReadLine -ErrorAction SilentlyContinue',
    'if (Get-Module PSReadLine) {',
    '  Set-PSReadLineOption -HistorySaveStyle SaveNothing -HistoryNoDuplicates:$false',
    '  try { [Microsoft.PowerShell.PSConsoleReadLine]::ClearHistory() } catch { }',
    '  Set-PSReadLineOption -AddToHistoryHandler {',
    '    param([string]$line)',
    `    if ($line -cne ${init}) { ${mark('$line')} }`,
    '    return $true',
    '  }',
    '} else {',
    '  $global:__egLastId = 0',
    '  function global:prompt {',
    '    $h = Get-History -Count 1',
    '    if ($h -and $h.Id -ne $global:__egLastId) {',
    '      $global:__egLastId = $h.Id',
    `      if ($h.CommandLine -cne ${init}) { ${mark('$h.CommandLine')} }`,
    '    }',
    '    "PS $($executionContext.SessionState.Path.CurrentLocation)$(\'>\' * ($nestedPromptLevel + 1)) "',
    '  }',
    '}',
    '',
  ].join('\r\n');
}
