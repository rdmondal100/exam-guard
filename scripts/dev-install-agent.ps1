<#
  Installs the ExamGuard agent service on THIS PC (laptop / dev only). Needs an elevated PowerShell.
  Copies eg-agent.exe to %ProgramFiles%\ExamGuard\agent (a standard user cannot replace the file
  the service runs), registers the service and starts it. Undo with dev-uninstall-agent.ps1.
  The student app does the same through one UAC prompt (apps/desktop/src/main/agent/setup-scripts.ts).

  .\scripts\dev-install-agent.ps1 [-Source <path to eg-agent.exe>]
  Without -Source it takes target\release\eg-agent.exe, else target\debug\eg-agent.exe.
#>
param([string]$Source)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$name = 'ExamGuardAgent'
$dir = Join-Path $env:ProgramFiles 'ExamGuard\agent'
$exe = Join-Path $dir 'eg-agent.exe'

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

Write-Host "Installed and started $name from $exe"
Write-Host "Logs: $env:ProgramData\ExamGuard\spike\service.log and helper.log"
