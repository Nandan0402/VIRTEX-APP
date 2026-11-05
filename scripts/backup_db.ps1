<#
.SYNOPSIS
    Automated PostgreSQL Backup and Retention Script for PulseCore Gym Receptionist Robot.
.DESCRIPTION
    Creates a timestamped SQL backup of the gym_robot_db database using pg_dump.
    Automatically manages backup rotation by removing files older than the retention threshold.
.EXAMPLE
    .\scripts\backup_db.ps1
.EXAMPLE
    .\scripts\backup_db.ps1 -RetentionDays 7
.EXAMPLE
    To restore a backup:
    psql -U postgres -d gym_robot_db -f backups\gym_robot_db_backup_20261105_090000.sql
#>

[CmdletBinding()]
param (
    [string]$DbHost = "localhost",
    [int]$DbPort = 5432,
    [string]$DbName = "gym_robot_db",
    [string]$DbUser = "postgres",
    [string]$OutputDir = "$PSScriptRoot\..\backups",
    [int]$RetentionDays = 14
)

# 1. Resolve Project Root and Environment Variables
$projectRoot = Resolve-Path "$PSScriptRoot\.."
$envFile = Join-Path $projectRoot ".env"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            if (-not [string]::IsNullOrEmpty($key)) {
                if ($key -eq "DB_HOST" -and -not $PSBoundParameters.ContainsKey('DbHost')) { $DbHost = $val }
                if ($key -eq "DB_PORT" -and -not $PSBoundParameters.ContainsKey('DbPort')) { $DbPort = [int]$val }
                if ($key -eq "DB_NAME" -and -not $PSBoundParameters.ContainsKey('DbName')) { $DbName = $val }
                if ($key -eq "DB_USER" -and -not $PSBoundParameters.ContainsKey('DbUser')) { $DbUser = $val }
                if ($key -eq "DB_PASSWORD") { $script:DbPassword = $val }
            }
        }
    }
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "🐘 PulseCore Gym Robot - PostgreSQL Backup Utility" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Target Database : $DbName" -ForegroundColor Gray
Write-Host "Host & Port     : $DbHost`:$DbPort" -ForegroundColor Gray
Write-Host "Database User   : $DbUser" -ForegroundColor Gray
Write-Host "Retention Period: $RetentionDays days" -ForegroundColor Gray

# 2. Locate pg_dump Executable
$pgDump = Get-Command "pg_dump.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source

if (-not $pgDump) {
    # Check common PostgreSQL installation directories on Windows
    $possiblePaths = @(
        "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe",
        "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
        "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
        "C:\Program Files\PostgreSQL\15\bin\pg_dump.exe",
        "C:\Program Files\PostgreSQL\14\bin\pg_dump.exe"
    )

    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $pgDump = $path
            break
        }
    }
}

if (-not $pgDump) {
    Write-Error "pg_dump.exe was not found in PATH or standard Program Files locations.`nPlease add PostgreSQL bin to your PATH or verify PostgreSQL installation."
    exit 1
}

Write-Host "Using pg_dump  : $pgDump" -ForegroundColor Gray

# 3. Ensure Output Directory Exists
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFilename = "${DbName}_backup_${timestamp}.sql"
$backupPath = Join-Path $OutputDir $backupFilename

Write-Host "Generating backup file: $backupFilename..." -ForegroundColor Yellow

# 4. Set Password Environment Variable Safely
if ($script:DbPassword) {
    $env:PGPASSWORD = $script:DbPassword
}

try {
    # Execute pg_dump
    & $pgDump -h $DbHost -p $DbPort -U $DbUser --clean --if-exists --format=plain --file="$backupPath" $DbName

    if ($LASTEXITCODE -eq 0 -and (Test-Path $backupPath)) {
        $fileSize = (Get-Item $backupPath).Length / 1KB
        Write-Host "Backup completed successfully!" -ForegroundColor Green
        Write-Host "File saved to : $backupPath ([math]::Round($fileSize, 2) KB)" -ForegroundColor Green
    } else {
        Write-Error "pg_dump terminated with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }
} finally {
    # Clear password from session memory
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# 5. Apply Retention / Rotation Policy
Write-Host "Evaluating backup rotation (retaining last $RetentionDays days)..." -ForegroundColor Gray
$cutoffDate = (Get-Date).AddDays(-$RetentionDays)
$purgedCount = 0

Get-ChildItem -Path $OutputDir -Filter "*.sql" | Where-Object {
    $_.CreationTime -lt $cutoffDate
} | ForEach-Object {
    Remove-Item $_.FullName -Force
    $purgedCount++
    Write-Host "Purged expired backup: $($_.Name)" -ForegroundColor DarkGray
}

Write-Host "Rotation complete. $purgedCount old backup(s) removed." -ForegroundColor Gray
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "To restore this backup, run:" -ForegroundColor White
Write-Host "psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -f `"$backupPath`"" -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Cyan
