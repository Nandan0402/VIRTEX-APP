# ==============================================================================
# Reset PostgreSQL 18 'postgres' Superuser Password
# Self-elevates to Administrator if run from a standard terminal
# ==============================================================================

# 1. Self-Elevate to Administrator if needed (Triggers Windows UAC prompt)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow
    Write-Host "Please click 'YES' on the Windows popup (UAC) to continue." -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Cyan
    
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 0
}

# 2. Resolve Target Password directly from project .env
$envFile = Join-Path $PSScriptRoot "..\.env"
$targetSecret = "Manju@14gym"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line.StartsWith("DB_PASSWORD=")) {
            $extracted = $line.Substring("DB_PASSWORD=".Length).Trim()
            if (-not [string]::IsNullOrEmpty($extracted)) {
                $targetSecret = $extracted
            }
        }
    }
}

$hbaFile = "C:\Program Files\PostgreSQL\18\data\pg_hba.conf"
$psqlExe = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$serviceName = "postgresql-x64-18"

if (-not (Test-Path $hbaFile)) {
    Write-Error "Could not find pg_hba.conf at $hbaFile"
    Read-Host "Press Enter to exit..."
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🐘 Resetting PostgreSQL Password for user 'postgres'..." -ForegroundColor Cyan
Write-Host "Target Password: $targetSecret" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

Write-Host "1. Backing up pg_hba.conf..." -ForegroundColor Cyan
Copy-Item $hbaFile "$hbaFile.bak" -Force

Write-Host "2. Enabling temporary local trust access..." -ForegroundColor Cyan
(Get-Content $hbaFile) -replace 'scram-sha-256', 'trust' | Set-Content $hbaFile

Write-Host "3. Restarting PostgreSQL service..." -ForegroundColor Cyan
Restart-Service $serviceName -Force

Write-Host "4. Setting new password for user 'postgres' to match .env ($targetSecret)..." -ForegroundColor Cyan
& $psqlExe -U postgres -h localhost -p 5432 -c "ALTER USER postgres WITH PASSWORD '$targetSecret';"

Write-Host "5. Restoring security configuration (scram-sha-256)..." -ForegroundColor Cyan
Copy-Item "$hbaFile.bak" $hbaFile -Force
Remove-Item "$hbaFile.bak" -Force

Write-Host "6. Restarting PostgreSQL service with new password active..." -ForegroundColor Cyan
Restart-Service $serviceName -Force

Write-Host "7. Verifying connection with new password..." -ForegroundColor Cyan
$env:PGPASSWORD = $targetSecret
& $psqlExe -U postgres -h localhost -p 5432 -c "SELECT 'PASSWORD RESET SUCCESSFUL!' AS status;"

if ($LASTEXITCODE -eq 0) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "SUCCESS! Your PostgreSQL password is now set to: $targetSecret" -ForegroundColor Green
    Write-Host "User: postgres" -ForegroundColor Green
    Write-Host "Database is ready to use!" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    Write-Host "Failed to verify new password." -ForegroundColor Red
}

Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

Write-Host ""
Read-Host "Done! Press Enter to close this window..."
