<#
.SYNOPSIS
    One-time (and repeatable) setup for ConflictFree on Windows.

.DESCRIPTION
    1. Checks Node.js 22+, npm and Docker.
    2. Creates backend/.env from backend/.env.example if it is missing and
       replaces the placeholder JWT secret with a random one. Existing values
       are never overwritten.
    3. Installs backend and frontend dependencies.
    4. Starts Redis in Docker (docker-compose.yml) and waits until healthy.
    5. Local MongoDB only: starts it if possible and initialises replica set rs0.
    6. Verifies MongoDB, Redis and the Gemini key.

    Safe to run again at any time.

.PARAMETER WithE2E
    Also install the Playwright Chromium browser for end-to-end tests.

.PARAMETER SkipInstall
    Skip "npm install" (faster when dependencies are already installed).

.PARAMETER NoDocker
    Do not start Docker/Redis (notifications and reminders will be off).

.EXAMPLE
    .\setup.cmd
    .\setup.ps1 -WithE2E
#>
param(
    [switch]$WithE2E,
    [switch]$SkipInstall,
    [switch]$NoDocker
)

$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "scripts\dev-common.ps1")

Write-Host "ConflictFree setup" -ForegroundColor White
Write-Host "Project: $RepoRoot"

# 1. Prerequisites -----------------------------------------------------------
Write-Step "Checking prerequisites"
Assert-Node
if (-not (Test-CommandExists "npm")) { Stop-WithError "npm was not found (it ships with Node.js)." }
Write-Ok "npm $(npm -v)"

# 2. backend/.env ------------------------------------------------------------
Write-Step "Configuring backend/.env"
$example = Join-Path $BackendDir ".env.example"

if (-not (Test-Path $EnvFile)) {
    if (-not (Test-Path $example)) { Stop-WithError "backend/.env.example is missing." }
    Copy-Item $example $EnvFile
    Write-Ok "Created backend/.env from .env.example"
} else {
    Write-Ok "backend/.env already exists (kept as is)"
}

$lines = [System.Collections.Generic.List[string]](Get-Content $EnvFile)
$changed = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*JWT_SECRET\s*=\s*(replace-this.*)?\s*$') {
        $bytes = New-Object byte[] 48
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $lines[$i] = "JWT_SECRET=" + (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
        $changed = $true
        Write-Ok "Generated a random JWT_SECRET"
    }
}
if ($changed) {
    [System.IO.File]::WriteAllLines($EnvFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
}

$envValues = Get-EnvValues
if (-not $envValues["MONGODB_URI"]) {
    Write-Note "MONGODB_URI is empty: set it in backend/.env (Atlas or mongodb://127.0.0.1:27017/conflictfree?replicaSet=rs0)."
}
if (-not $envValues["REDIS_URL"]) {
    Write-Note "REDIS_URL is empty: notifications and reminders will be off. Local value: redis://127.0.0.1:6379"
}
if (-not $envValues["GEMINI_API_KEY"]) {
    Write-Note "GEMINI_API_KEY is empty: the scheduling assistant will be hidden (optional)."
}
if ($envValues["GOOGLE_CLIENT_ID"] -like "your-*" -or -not $envValues["GOOGLE_CLIENT_ID"]) {
    Write-Note "Google sign-in is not configured (optional; email/password works without it)."
}
if ($envValues["NODE_ENV"] -eq "production") {
    Write-Note "NODE_ENV=production in backend/.env: login cookies are 'Secure' and only FRONTEND_URL is allowed. Use 'development' for local work."
}

# 3. Dependencies ------------------------------------------------------------
if ($SkipInstall) {
    Write-Step "Skipping npm install (-SkipInstall)"
} else {
    foreach ($dir in @($BackendDir, $FrontendDir)) {
        $name = Split-Path $dir -Leaf
        Write-Step "Installing $name dependencies"
        Push-Location $dir
        try {
            npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { Stop-WithError "npm install failed in $name." }
            Write-Ok "$name dependencies installed"
        } finally {
            Pop-Location
        }
    }
}

# 4. Docker + Redis ----------------------------------------------------------
if ($NoDocker) {
    Write-Step "Skipping Docker/Redis (-NoDocker)"
} else {
    Write-Step "Starting Redis (Docker)"
    if (Initialize-Docker) {
        [void](Start-RedisContainer)
    }
}

# 5. MongoDB -----------------------------------------------------------------
Write-Step "Preparing MongoDB"
$mongoUri = $envValues["MONGODB_URI"]
if (Initialize-LocalMongo $mongoUri) {
    $local = Get-LocalMongoTarget $mongoUri
    if ($local) {
        Push-Location $BackendDir
        try {
            $env:MONGO_HOST = "$($local.Host):$($local.Port)"
            npm run --silent db:init-replset
        } finally {
            Remove-Item Env:\MONGO_HOST -ErrorAction SilentlyContinue
            Pop-Location
        }
    }
}

# 6. Optional: Playwright browser -------------------------------------------
if ($WithE2E) {
    Write-Step "Installing the Playwright Chromium browser"
    Push-Location $FrontendDir
    try {
        npx playwright install chromium
        if ($LASTEXITCODE -eq 0) { Write-Ok "Chromium installed" } else { Write-Note "Playwright install failed." }
    } finally {
        Pop-Location
    }
}

# 7. Verify ------------------------------------------------------------------
Write-Step "Checking services"
$healthy = Invoke-ServiceCheck -VerifyGemini

Write-Host ""
if ($healthy) {
    Write-Host "Setup complete. Start everything with:  .\start.cmd" -ForegroundColor Green
    exit 0
}

Write-Host "Setup finished, but MongoDB is not usable yet. Fix the item marked above, then run .\setup.cmd again." -ForegroundColor Red
exit 1
