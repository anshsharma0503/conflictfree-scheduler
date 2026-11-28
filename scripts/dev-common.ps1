# Shared helpers for setup.ps1 and start.ps1 (dot-sourced, not run directly).
# Windows PowerShell 5.1 compatible. Keep this file ASCII-only: PowerShell 5.1
# reads BOM-less scripts in the ANSI code page.

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:BackendDir = Join-Path $RepoRoot "backend"
$script:FrontendDir = Join-Path $RepoRoot "frontend"
$script:EnvFile = Join-Path $BackendDir ".env"
$script:RedisContainer = "conflictfree-redis"

# Node prints UTF-8 (check marks etc.); make the console show it correctly.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Step([string]$Message) { Write-Host ""; Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  [ok]   $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "  [warn] $Message" -ForegroundColor Yellow }
function Write-Bad([string]$Message) { Write-Host "  [fail] $Message" -ForegroundColor Red }

function Stop-WithError([string]$Message) {
    Write-Bad $Message
    exit 1
}

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Runs a native command silently and returns its exit code. Going through
# cmd.exe keeps PowerShell 5.1 from turning stderr output into errors.
function Invoke-Quiet([string]$CommandLine) {
    cmd /c "$CommandLine >nul 2>&1"
    return $LASTEXITCODE
}

# Reads KEY=value pairs from backend/.env (comments and blanks ignored).
function Get-EnvValues {
    $values = @{}
    if (-not (Test-Path $EnvFile)) { return $values }

    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $index = $line.IndexOf("=")
        $key = $line.Substring(0, $index).Trim()
        $value = $line.Substring($index + 1).Trim()
        if ($key) { $values[$key] = $value }
    }
    return $values
}

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 1000) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-PortInUse([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Assert-Node {
    if (-not (Test-CommandExists "node")) {
        Stop-WithError "Node.js is not installed. Install Node.js 22 LTS or newer: https://nodejs.org"
    }
    $version = (node -v).TrimStart("v")
    $major = [int]($version.Split(".")[0])
    if ($major -lt 22) {
        Stop-WithError "Node.js $version found; ConflictFree needs 22 or newer."
    }
    Write-Ok "Node.js $version"
}

# Makes sure the Docker engine is running, starting Docker Desktop if needed.
# Returns $true when Docker is usable.
function Initialize-Docker([int]$TimeoutSeconds = 180) {
    if (-not (Test-CommandExists "docker")) {
        Write-Note "Docker is not installed (https://www.docker.com/products/docker-desktop). Redis will be skipped."
        return $false
    }

    if ((Invoke-Quiet "docker info") -eq 0) {
        Write-Ok "Docker engine is running"
        return $true
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
    )
    $desktop = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if (-not $desktop) {
        Write-Note "Docker engine is not running and Docker Desktop was not found. Start Docker manually."
        return $false
    }

    Write-Host "  Starting Docker Desktop (this can take a minute)..."
    Start-Process -FilePath $desktop | Out-Null

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        if ((Invoke-Quiet "docker info") -eq 0) {
            Write-Ok "Docker engine is running"
            return $true
        }
    }

    Write-Note "Docker did not start within $TimeoutSeconds seconds."
    return $false
}

# Starts the Redis container from docker-compose.yml and waits for "healthy".
function Start-RedisContainer([int]$TimeoutSeconds = 60) {
    Push-Location $RepoRoot
    try {
        if ((Invoke-Quiet "docker compose up -d redis") -ne 0) {
            Write-Note "docker compose could not start Redis. Run 'docker compose up -d redis' to see why."
            return $false
        }
    } finally {
        Pop-Location
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $health = (docker inspect -f "{{.State.Health.Status}}" $RedisContainer 2>$null)
        if ($health -eq "healthy") {
            Write-Ok "Redis container '$RedisContainer' is healthy (127.0.0.1:6379)"
            return $true
        }
        Start-Sleep -Seconds 2
    }

    Write-Note "Redis did not become healthy within $TimeoutSeconds seconds."
    return $false
}

# Parses MONGODB_URI. Returns $null for Atlas / remote URIs.
function Get-LocalMongoTarget([string]$Uri) {
    if (-not $Uri -or $Uri -like "mongodb+srv://*") { return $null }
    if ($Uri -match '^mongodb://(?:[^@/]+@)?(localhost|127\.0\.0\.1)(?::(\d+))?') {
        $port = 27017
        if ($Matches[2]) { $port = [int]$Matches[2] }
        return @{ Host = "127.0.0.1"; Port = $port }
    }
    return $null
}

# For a local MONGODB_URI: make sure mongod is listening, starting it if we
# can. Order: already running -> Windows service "MongoDB" -> mongod from
# CONFLICTFREE_MONGOD (+ CONFLICTFREE_MONGOD_CONFIG). Remote URIs are left
# to the service check.
function Initialize-LocalMongo([string]$Uri) {
    $target = Get-LocalMongoTarget $Uri
    if (-not $target) {
        Write-Ok "MongoDB is remote (e.g. Atlas); nothing to start locally"
        return $true
    }

    if (Test-TcpPort $target.Host $target.Port) {
        Write-Ok "Local MongoDB is listening on port $($target.Port)"
        return $true
    }

    $service = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
    if ($service) {
        Write-Host "  Starting the 'MongoDB' Windows service..."
        try {
            Start-Service -Name "MongoDB" -ErrorAction Stop
        } catch {
            Write-Note "Could not start the MongoDB service (try an administrator terminal): $($_.Exception.Message)"
        }
    } elseif ($env:CONFLICTFREE_MONGOD -and (Test-Path $env:CONFLICTFREE_MONGOD)) {
        $arguments = @()
        if ($env:CONFLICTFREE_MONGOD_CONFIG) { $arguments = @("--config", "`"$env:CONFLICTFREE_MONGOD_CONFIG`"") }
        Write-Host "  Starting $env:CONFLICTFREE_MONGOD ..."
        if ($arguments.Count -gt 0) {
            Start-Process -FilePath $env:CONFLICTFREE_MONGOD -ArgumentList $arguments -WindowStyle Hidden | Out-Null
        } else {
            Start-Process -FilePath $env:CONFLICTFREE_MONGOD -WindowStyle Hidden | Out-Null
        }
    } else {
        Write-Bad "Local MongoDB is not running on port $($target.Port)."
        Write-Host "  Start it yourself, install it as the 'MongoDB' service, or set:"
        Write-Host "    `$env:CONFLICTFREE_MONGOD = 'C:\path\to\mongod.exe'"
        Write-Host "    `$env:CONFLICTFREE_MONGOD_CONFIG = 'C:\path\to\mongod.cfg'"
        return $false
    }

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        if (Test-TcpPort $target.Host $target.Port) {
            Write-Ok "Local MongoDB is listening on port $($target.Port)"
            return $true
        }
    }

    Write-Bad "MongoDB did not start listening on port $($target.Port) within 30 seconds."
    return $false
}

# Runs backend/scripts/checkServices.js. Returns $true when MongoDB is usable.
function Invoke-ServiceCheck([switch]$VerifyGemini) {
    Push-Location $BackendDir
    try {
        # Out-Host: without it the output would become this function's return
        # value (and a non-empty array always counts as "true").
        if ($VerifyGemini) { node scripts/checkServices.js --gemini | Out-Host } else { node scripts/checkServices.js | Out-Host }
        return ($LASTEXITCODE -eq 0)
    } finally {
        Pop-Location
    }
}
