/**
 * PowerShell run elevated (one UAC prompt) to put the agent service in or take it out. The exe is
 * copied under Program Files first, so a standard user cannot swap the file the service runs.
 * Each script writes `ok` or the error message to the file given as `-Result`.
 * `-App` (dev builds only) is the program file the agent lets use its pipe. It is kept in
 * `HKLM:\SOFTWARE\ExamGuard\AppPath`, where only an administrator can change it; the installer
 * (M45) writes it for a packaged app.
 */

const PREAMBLE = String.raw`param([string]$Source, [string]$App, [string]$Result)
$ErrorActionPreference = 'Stop'
$name = 'ExamGuardAgent'
$dir = Join-Path $env:ProgramFiles 'ExamGuard\agent'
$exe = Join-Path $dir 'eg-agent.exe'
$regKey = 'HKLM:\SOFTWARE\ExamGuard'
function Remove-AgentService {
  if (Get-Service $name -ErrorAction SilentlyContinue) {
    Stop-Service $name -Force -ErrorAction SilentlyContinue
    sc.exe delete $name | Out-Null
    for ($i = 0; $i -lt 40 -and (Get-Service $name -ErrorAction SilentlyContinue); $i++) {
      Start-Sleep -Milliseconds 250
    }
  }
  Get-Process eg-agent -ErrorAction SilentlyContinue | Stop-Process -Force
}
`;

export const INSTALL_SCRIPT =
  PREAMBLE +
  String.raw`try {
  Remove-AgentService
  New-Item -ItemType Directory -Force $dir | Out-Null
  Copy-Item -LiteralPath $Source -Destination $exe -Force
  if ($App) {
    New-Item -Path $regKey -Force | Out-Null
    Set-ItemProperty -Path $regKey -Name AppPath -Value $App
  }
  $out = & $exe --install 2>&1
  if ($LASTEXITCODE -ne 0) { throw "eg-agent --install failed: $out" }
  'ok' | Set-Content -LiteralPath $Result
} catch {
  $_.Exception.Message | Set-Content -LiteralPath $Result
}
`;

export const UNINSTALL_SCRIPT =
  PREAMBLE +
  String.raw`try {
  Remove-AgentService
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $regKey -Name AppPath -ErrorAction SilentlyContinue
  'ok' | Set-Content -LiteralPath $Result
} catch {
  $_.Exception.Message | Set-Content -LiteralPath $Result
}
`;
