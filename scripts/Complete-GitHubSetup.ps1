# 在 Cursor 集成终端（非 Agent 后台）中运行，保持窗口不关闭直到完成。
# 用法：.\scripts\Complete-GitHubSetup.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

Write-Host "=== 1/3 GitHub 登录（浏览器设备码）===" -ForegroundColor Cyan
& $gh auth login -h github.com -p https -w
& $gh auth status

$user = & $gh api user -q .login
Write-Host "已登录: $user" -ForegroundColor Green

Write-Host "`n=== 2/3 创建仓库并关联 remote ===" -ForegroundColor Cyan
$visibility = "--public"
& $gh repo create unified-qa-platform $visibility --source=. --remote=origin `
  --description="统一质检平台 — Next.js + Hermes + MCP" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "仓库可能已存在，尝试仅设置 remote 并推送..." -ForegroundColor Yellow
  $url = "https://github.com/$user/unified-qa-platform.git"
  git remote remove origin 2>$null
  git remote add origin $url
}

git config user.name "Sunflower"
git config user.email "765548564@qq.com"

Write-Host "`n=== 3/3 推送 main ===" -ForegroundColor Cyan
$pending = git status --porcelain
if ($pending) {
  git add -A
  git -c user.name="Sunflower" -c user.email="765548564@qq.com" commit -m "chore: 同步本地变更"
}
git push -u origin main

Write-Host "`n完成: https://github.com/$user/unified-qa-platform" -ForegroundColor Green
& $gh repo view --web
