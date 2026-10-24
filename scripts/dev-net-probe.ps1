<#
  M21a laptop helper: shows what the PC can reach right now, so a run before and during the
  internet block can be compared. Read-only; it changes nothing.

  .\scripts\dev-net-probe.ps1 -Teacher 192.168.1.10
#>
param(
  [Parameter(Mandatory = $true)][string]$Teacher,
  [int]$TeacherPort = 47820
)

function Test-Tcp([string]$Address, [int]$Port, [int]$TimeoutMs = 3000) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($Address, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
    $client.EndConnect($pending)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-Https([string]$Url) {
  & curl.exe --silent --show-error --output NUL --max-time 5 $Url 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Show([string]$Label, [bool]$Ok) {
  $mark = if ($Ok) { 'reachable' } else { 'BLOCKED  ' }
  Write-Host ('{0}  {1}' -f $mark, $Label)
}

Write-Host ("ExamGuard net probe, {0:HH:mm:ss}" -f (Get-Date))
Show "teacher $Teacher`:$TeacherPort (TCP)" (Test-Tcp $Teacher $TeacherPort)
Show 'loopback 127.0.0.1:47821 (TCP, only when the teacher app runs here)' (Test-Tcp '127.0.0.1' 47821)
Show 'https://example.com' (Test-Https 'https://example.com')
Show 'https://1.1.1.1 (no DNS needed)' (Test-Https 'https://1.1.1.1')
Show '8.8.8.8:53 (TCP)' (Test-Tcp '8.8.8.8' 53)
Show 'DNS lookup of example.com' ([bool](Resolve-DnsName example.com -QuickTimeout -ErrorAction SilentlyContinue))
