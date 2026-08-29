$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logDirectory = Join-Path $projectRoot 'private\logs'
$logFile = Join-Path $logDirectory 'managed-startup.log'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Sondara after Windows logon" | Add-Content -LiteralPath $logFile -Encoding UTF8
& npm.cmd run start:managed *>> $logFile
exit $LASTEXITCODE
