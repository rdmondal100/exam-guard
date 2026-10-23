<#
  Installs the ExamGuard agent service on THIS PC (laptop / dev only). Needs an elevated PowerShell.
  Copies eg-agent.exe to %ProgramFiles%\ExamGuard\agent (a standard user cannot replace the file
  the service runs), registers the service and starts it. Undo with dev-uninstall-agent.ps1.
  The student app does the same through one UAC prompt (apps/desktop/src/main/agent/setup-scripts.ts).

  .\scripts\dev-install-agent.ps1 [-Source <path to eg-agent.exe>] [-App <path to the student app exe>]
  Without -Source it takes target\release\eg-agent.exe, else target\debug\eg-agent.exe.
  -App is the program the agent lets use its pipe (HKLM\SOFTWARE\ExamGuard\AppPath). In dev that is
  Electron, apps\desktop\node_modules\electron\dist\electron.exe, which is the default when it exists.
#>
param([string]$Source, [string]$App)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$name = 'ExamGuardAgent'
$dir = Join-Path $env:ProgramFiles 'ExamGuard\agent'
$exe = Join-Path $dir 'eg-agent.exe'
$regKey = 'HKLM:\SOFTWARE\ExamGuard'

$admin = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an elevated (administrator) PowerShell.'
}

if (-not $Source) {
  $Source = @('release', 'debug') |
    ForEach-Object { Join-Path $root "target\$_\eg-agent.exe" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}
if (-not $Source -or -not (Test-Path -LiteralPath $Source)) {
  throw 'eg-agent.exe not found. Run "cargo build -p eg-agent" or pass -Source.'
}

if (-not $App) {
  $electron = Join-Path $root 'apps\desktop\node_modules\electron\dist\electron.exe'
  if (Test-Path -LiteralPath $electron) { $App = $electron }
}

if (Get-Service $name -ErrorAction SilentlyContinue) {
  Stop-Service $name -Force -ErrorAction SilentlyContinue
  sc.exe delete $name | Out-Null
  for ($i = 0; $i -lt 40 -and (Get-Service $name -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Milliseconds 250
  }
}
Get-Process eg-agent -ErrorAction SilentlyContinue | Stop-Process -Force

New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item -LiteralPath $Source -Destination $exe -Force
& $exe --install
if ($LASTEXITCODE -ne 0) { throw "eg-agent --install failed (exit $LASTEXITCODE)" }

if ($App) {
  # pnpm links node_modules\electron to node_modules\.pnpm\electron@x\...; Windows reports the real
  # path of a running program, so register the real one or the agent never matches the app.
  $real = (Resolve-Path -LiteralPath $App).Path
  $stream = [System.IO.File]::Open($real, 'Open', 'Read', 'ReadWrite')
  try {
    Add-Type -Namespace Eg -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern uint GetFinalPathNameByHandleW(System.IntPtr h, System.Text.StringBuilder s, uint n, uint flags);
'@ -ErrorAction SilentlyContinue
    $sb = New-Object System.Text.StringBuilder 1024
    if ([Eg.Native]::GetFinalPathNameByHandleW($stream.SafeFileHandle.DangerousGetHandle(), $sb, 1024, 0) -gt 0) {
      $real = $sb.ToString() -replace '^\\\\\?\\', ''
    }
  } finally { $stream.Dispose() }
  New-Item -Path $regKey -Force | Out-Null
  Set-ItemProperty -Path $regKey -Name AppPath -Value $real
  Write-Host "The agent will accept the app $real"
} else {
  Write-Warning 'No -App given and Electron was not found: no app may use the agent pipe.'
}

Write-Host "Installed and started $name from $exe"
Write-Host "Logs: $env:ProgramData\ExamGuard\spike\service.log and helper.log"
