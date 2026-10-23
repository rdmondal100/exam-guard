<#
  Removes the ExamGuard agent service from THIS PC (undoes dev-install-agent.ps1). Needs an
  elevated PowerShell. Logs and screenshots in %ProgramData%\ExamGuard\spike are kept.
#>
$ErrorActionPreference = 'Stop'

$name = 'ExamGuardAgent'
$dir = Join-Path $env:ProgramFiles 'ExamGuard\agent'

$admin = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an elevated (administrator) PowerShell.'
}

if (Get-Service $name -ErrorAction SilentlyContinue) {
  Stop-Service $name -Force -ErrorAction SilentlyContinue
  sc.exe delete $name | Out-Null
  for ($i = 0; $i -lt 40 -and (Get-Service $name -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Milliseconds 250
  }
}
Get-Process eg-agent -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Removed $name"
