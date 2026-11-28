<#
.SYNOPSIS
    Starts every ConflictFree service for local development.

.DESCRIPTION
    1. Docker engine (starts Docker Desktop if needed) and the Redis container.
    2. Local MongoDB, if MONGODB_URI points to this machine.
    3. Checks MongoDB / Redis / Gemini with backend/scripts/checkServices.js.
    4. Backend (nodemon, http://localhost:5000) and frontend (Vite,
       http://localhost:5173), then opens the browser.

    Both dev servers share this window. Press Ctrl+C to stop them; Redis
    keeps running (stop it with -Down) unless -StopRedisOnExit is given.

.PARAMETER SeparateWindows
    Run the backend and frontend in their own PowerShell windows instead.

.PARAMETER NoBrowser
    Do not open the app in the browser.

.PARAMETER StopRedisOnExit
    Stop the Redis container when the dev servers stop.

.PARAMETER Down
    Only stop the Redis container (data is kept) and exit.

.EXAMPLE
    .\start.cmd
    .\start.ps1 -SeparateWindows
    .\start.ps1 -Down
#>
param(
    [switch]$SeparateWindows,
    [switch]$NoBrowser,
    [switch]$StopRedisOnExit,
    [switch]$Down
)

$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "scripts\dev-common.ps1")

function Stop-Redis {
    Push-Location $RepoRoot
    try {
        if ((Invoke-Quiet "docker compose stop redis") -eq 0) {
            Write-Ok "Redis container stopped (data kept in the Docker volume)"
        } else {
            Write-Note "Could not stop Redis (is Docker running?)"
        }
    } finally {
        Pop-Location
    }
}

if ($Down) {
    Write-Step "Stopping Redis"
    Stop-Redis
    exit 0
}

Write-Host "ConflictFree: starting all services" -ForegroundColor White

# Preconditions --------------------------------------------------------------
if (-not (Test-Path $EnvFile)) { Stop-WithError "backend/.env is missing. Run .\setup.cmd first." }
foreach ($dir in @($BackendDir, $FrontendDir)) {
    if (-not (Test-Path (Join-Path $dir "node_modules"))) {
        Stop-WithError "$(Split-Path $dir -Leaf)/node_modules is missing. Run .\setup.cmd first."
    }
}

$envValues = Get-EnvValues
$backendPort = 5000
if ($envValues["PORT"]) { $backendPort = [int]$envValues["PORT"] }
$frontendPort = 5173

Write-Step "Checking ports"
foreach ($entry in @(@{ Port = $backendPort; Name = "backend" }, @{ Port = $frontendPort; Name = "frontend" })) {
    if (Test-PortInUse $entry.Port) {
        $owner = Get-NetTCPConnection -LocalPort $entry.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        $process = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue
        Stop-WithError "Port $($entry.Port) ($($entry.Name)) is already used by '$($process.ProcessName)' (PID $($owner.OwningProcess)). Close it, or stop the other ConflictFree window."
    }
    Write-Ok "Port $($entry.Port) is free ($($entry.Name))"
}

# Docker + Redis -------------------------------------------------------------
Write-Step "Starting Redis (Docker)"
$redisStarted = $false
if ($envValues["REDIS_URL"] -and $envValues["REDIS_URL"] -notmatch '127\.0\.0\.1|localhost') {
    Write-Ok "REDIS_URL points to a managed Redis; not starting the local container"
} elseif (Initialize-Docker) {
    $redisStarted = Start-RedisContainer
}
if (-not $redisStarted -and -not ($envValues["REDIS_URL"] -and $envValues["REDIS_URL"] -notmatch '127\.0\.0\.1|localhost')) {
    Write-Note "Continuing without local Redis: notifications and reminders are paused until it runs."
}

# MongoDB --------------------------------------------------------------------
Write-Step "Checking MongoDB"
if (-not (Initialize-LocalMongo $envValues["MONGODB_URI"])) {
    Stop-WithError "MongoDB is required. Fix it and run .\start.cmd again."
}

Write-Step "Checking services"
if (-not (Invoke-ServiceCheck)) {
    Stop-WithError "MongoDB is not usable (see above). The app cannot start without it."
}

if ($envValues["NODE_ENV"] -eq "production") {
    Write-Note "NODE_ENV=production: sign-in cookies are 'Secure'. Use http://localhost:$frontendPort (not 127.0.0.1) in Chrome or Edge."
}

# Dev servers ----------------------------------------------------------------
function Wait-ForUrl([string]$Url, [int]$TimeoutSeconds, $Process) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process -and $Process.HasExited) { return $false }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

$appUrl = "http://localhost:$frontendPort"
$healthUrl = "http://localhost:$backendPort/api/health"

if ($SeparateWindows) {
    Write-Step "Starting backend and frontend in separate windows"
    Start-Process powershell -WorkingDirectory $BackendDir -ArgumentList @("-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='ConflictFree backend'; npm run dev") | Out-Null
    Start-Process powershell -WorkingDirectory $FrontendDir -ArgumentList @("-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='ConflictFree frontend'; npm run dev") | Out-Null

    if (Wait-ForUrl $healthUrl 60 $null) { Write-Ok "Backend is up: $healthUrl" } else { Write-Note "Backend did not answer yet; check its window." }
    if (Wait-ForUrl $appUrl 60 $null) { Write-Ok "Frontend is up: $appUrl" } else { Write-Note "Frontend did not answer yet; check its window." }
    if (-not $NoBrowser) { Start-Process $appUrl | Out-Null }

    Write-Host ""
    Write-Host "Running. Close the two windows to stop. Stop Redis with: .\start.ps1 -Down" -ForegroundColor Green
    exit 0
}

Write-Step "Starting backend and frontend (Ctrl+C stops both)"
$backend = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory $BackendDir -NoNewWindow -PassThru
$frontend = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory $FrontendDir -NoNewWindow -PassThru
# Reading .Handle now makes .ExitCode available after the process ends
# (a Windows PowerShell quirk with -PassThru).
$null = $backend.Handle
$null = $frontend.Handle

function Stop-ProcessTree($Process) {
    if ($Process -and -not $Process.HasExited) {
        # npm.cmd starts node as a child: stop the whole tree.
        cmd /c "taskkill /PID $($Process.Id) /T /F >nul 2>&1"
    }
}

try {
    $backendUp = Wait-ForUrl $healthUrl 60 $backend
    $frontendUp = Wait-ForUrl $appUrl 60 $frontend

    Write-Host ""
    if ($backendUp) { Write-Ok "Backend   $healthUrl" } else { Write-Note "Backend did not answer at $healthUrl (see its output above)" }
    if ($frontendUp) { Write-Ok "Frontend  $appUrl" } else { Write-Note "Frontend did not answer at $appUrl (see its output above)" }
    if ($redisStarted) { Write-Ok "Redis     127.0.0.1:6379 (container $RedisContainer)" }
    Write-Host ""
    Write-Host "ConflictFree is running at $appUrl  -  press Ctrl+C to stop." -ForegroundColor Green

    if ($frontendUp -and -not $NoBrowser) { Start-Process $appUrl | Out-Null }

    while (-not $backend.HasExited -and -not $frontend.HasExited) {
        Start-Sleep -Seconds 1
    }

    if ($backend.HasExited) { Write-Note "The backend stopped (exit code $($backend.ExitCode)); stopping the frontend." }
    if ($frontend.HasExited) { Write-Note "The frontend stopped (exit code $($frontend.ExitCode)); stopping the backend." }
} finally {
    Write-Host ""
    Write-Host "Stopping dev servers..."
    Stop-ProcessTree $backend
    Stop-ProcessTree $frontend
    if ($StopRedisOnExit) { Stop-Redis } elseif ($redisStarted) { Write-Host "Redis is still running (stop it with .\start.ps1 -Down)." }
}
