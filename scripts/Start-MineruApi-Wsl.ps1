#Requires -Version 5.1
<#
.SYNOPSIS
  在 WSL 发行版中启动 mineru-api（默认监听 0.0.0.0:8000）。
.DESCRIPTION
  通过 Base64 将同目录下的 wsl-start-mineru-api.sh 写入 WSL 的 /tmp 再执行，避免 Windows 含中文路径经 wslpath 乱码。
.PARAMETER Distro
  WSL 发行版名称，默认 Ubuntu-24.04。
#>
param(
  [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$winScript = Join-Path $here "wsl-start-mineru-api.sh"
if (-not (Test-Path -LiteralPath $winScript)) {
  Write-Error "未找到: $winScript"
}

$content = [IO.File]::ReadAllText($winScript)
$content = $content -replace "`r`n", "`n" -replace "`r", "`n"
$utf8 = New-Object System.Text.UTF8Encoding $false
$bytes = $utf8.GetBytes($content)
$b64 = [Convert]::ToBase64String($bytes)
$remote = "/tmp/wsl-start-mineru-api-xingyan.sh"

wsl -d $Distro -- bash -lc "echo '$b64' | base64 -d > '$remote' && chmod +x '$remote' && exec bash '$remote'"
