# 在本地 PowerShell 中运行（需能访问 github.com）
# 用法示例：
#   $env:GITHUB_TOKEN = "ghp_你的PersonalAccessToken"
#   .\scripts\Publish-ToGitHub.ps1
# 或已安装并登录 GitHub CLI 时：
#   gh auth login
#   .\scripts\Publish-ToGitHub.ps1 -UseGhCli

param(
    [string]$RepoName = "unified-qa-platform",
    [string]$Description = "统一质检平台 — Next.js + Hermes + MCP",
    [switch]$Private,
    [switch]$UseGhCli
)

chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$gitName = "Sunflower"
$gitEmail = "765548564@qq.com"

# 仅本仓库的提交者信息（不修改全局 git config）
git config user.name $gitName
git config user.email $gitEmail

if ($UseGhCli) {
    $gh = Get-Command gh -ErrorAction Stop
    gh auth status 2>&1 | Out-Null
    if (-not $?) { throw "请先执行: gh auth login" }
    $visibility = if ($Private) { "--private" } else { "--public" }
    gh repo create $RepoName $visibility --source=. --remote=origin --description=$Description --push
    gh repo view --web
    exit 0
}

if (-not $env:GITHUB_TOKEN) {
    Write-Host @"

未设置 GITHUB_TOKEN，且未使用 -UseGhCli。

请任选一种方式：

【方式 A】浏览器创建（无需 Token）
  1. 打开 https://github.com/new
  2. Repository name: $RepoName
  3. 不要勾选 Initialize with README
  4. 创建后在本目录执行：
     git remote add origin https://github.com/<你的用户名>/$RepoName.git
     git push -u origin main

【方式 B】Personal Access Token
  1. GitHub → Settings → Developer settings → Personal access tokens
  2. 勾选 repo 权限，生成 token
  3. PowerShell:
     `$env:GITHUB_TOKEN = "ghp_xxxx"
     .\scripts\Publish-ToGitHub.ps1

"@
    exit 1
}

$headers = @{
    Authorization = "Bearer $env:GITHUB_TOKEN"
    Accept        = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$body = @{
    name        = $RepoName
    description = $Description
    private     = [bool]$Private
} | ConvertTo-Json

Write-Host "正在创建 GitHub 仓库: $RepoName ..."
$repo = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $headers -Body $body -ContentType "application/json"
$cloneUrl = $repo.clone_url
Write-Host "已创建: $($repo.html_url)"

$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0) {
    git remote set-url origin $cloneUrl
} else {
    git remote add origin $cloneUrl
}

git push -u origin main
Write-Host "推送完成: $($repo.html_url)"
