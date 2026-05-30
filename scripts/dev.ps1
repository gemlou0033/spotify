$ErrorActionPreference = "Stop"
. "$PSScriptRoot\use-portable-node.ps1"
Set-Location (Split-Path -Parent $PSScriptRoot)
npm run dev
