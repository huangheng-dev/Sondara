param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'Sondara Local Service'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runnerPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run-local-autostart.ps1'))
$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$shortcutPath = Join-Path $startupDirectory 'Sondara Local Service.lnk'

if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Removed the Windows logon task: $taskName"
  } else {
    Write-Output "The Windows logon task was not installed: $taskName"
  }
  if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Output "Removed the Windows Startup shortcut: $shortcutPath"
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
  throw "Startup runner does not exist: $runnerPath"
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd was not found. Install Node.js first.'
}

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Starts Sondara after Windows logon and automatically recovers from service failures.'
$installedMode = 'scheduled task'
try {
  Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
  if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
  }
} catch [Microsoft.Management.Infrastructure.CimException] {
  New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Starts Sondara after Windows logon.'
  $shortcut.Save()
  $installedMode = 'per-user Startup shortcut'
}

Write-Output "Installed Sondara autostart using a $installedMode."
Write-Output 'The current service is unchanged; the task takes over at the next Windows logon.'
Write-Output "Uninstall command: powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Uninstall"
