$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $repoRoot ".tools\node-v24.16.0-win-x64"
$node = Join-Path $nodeDir "node.exe"
$npm = Join-Path $nodeDir "npm.cmd"

if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $npm)) {
  Write-Host "Portable Node was not found. Downloading it now..."
  $zipName = "node-v24.16.0-win-x64.zip"
  $zipPath = Join-Path (Join-Path $repoRoot ".tools") $zipName
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $zipPath) | Out-Null
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v24.16.0/$zipName" -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath (Split-Path -Parent $zipPath) -Force
}

$env:PATH = "$nodeDir;$env:PATH"
Write-Host "Using portable Node:"
node --version
npm --version
