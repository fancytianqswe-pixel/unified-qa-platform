param(
    [int] $IntervalSeconds = 45,
    [int] $MaxWaitMinutes = 90
)

$ErrorActionPreference = "Continue"
$maxIterations = [math]::Max(1, [int](($MaxWaitMinutes * 60) / $IntervalSeconds))

for ($i = 0; $i -lt $maxIterations; $i++) {
    $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $health = ""
    try {
        $health = (docker inspect mineru-api --format "{{.State.Health.Status}}" 2>$null).Trim()
    } catch { }

    if (-not $health) {
        $health = "(no health field — inspect failed or no healthcheck)"
    }

    Write-Host "[$t] mineru-api Health.Status: $health"

    if ($health -eq "healthy") {
        Write-Host "`nOK: mineru-api is healthy. Last log lines:"
        docker logs mineru-api --tail 20 2>&1 | ForEach-Object { Write-Host $_ }
        exit 0
    }

    $running = (docker inspect mineru-api --format "{{.State.Running}}" 2>$null).Trim()
    if ($running -ne "true") {
        Write-Host "Container not running (Running=$running). Exit."
        exit 2
    }

    Write-Host "  (log tail)"
    try {
        docker logs mineru-api --tail 4 2>&1 | ForEach-Object { Write-Host "  $_" }
    } catch { }

    Start-Sleep -Seconds $IntervalSeconds
}

Write-Host "`nTimeout: not healthy after $MaxWaitMinutes minutes."
exit 1
