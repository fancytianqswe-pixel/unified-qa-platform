#Requires -Version 5.1
<#
.SYNOPSIS
  在 WSL Ubuntu 中执行 wsl-download-mineru-models.sh（Base64 写入 /tmp，避免中文路径 wslpath 问题）。
.PARAMETER Distro
  WSL 发行版名称，默认 Ubuntu-24.04。
#>
param(
  [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$winScript = Join-Path $here "wsl-download-mineru-models.sh"
if (-not (Test-Path -LiteralPath $winScript)) {
  Write-Error "未找到: $winScript"
}

$content = [IO.File]::ReadAllText($winScript)
$content = $content -replace "`r`n", "`n" -replace "`r", "`n"
$utf8 = New-Object System.Text.UTF8Encoding $false
$bytes = $utf8.GetBytes($content)
$b64 = [Convert]::ToBase64String($bytes)
$remote = "/tmp/wsl-download-mineru-models-xingyan.sh"

wsl -d $Distro -- bash -lc "echo '$b64' | base64 -d > '$remote' && chmod +x '$remote' && exec bash '$remote'"
