# Starts Shift Scheduler as a desktop app: installs/builds when needed, backs up the database,
# starts the production server in the background and opens it in an Edge app window.
# Closing the window stops the server.
$ErrorActionPreference = "Stop"
$port = 3100
$url = "http://127.0.0.1:$port"

function Show-Error($message) {
  try { "$(Get-Date -Format s) $message" | Out-File -Append -Encoding utf8 -LiteralPath (Join-Path (Split-Path $PSScriptRoot) "logs\error.log") } catch {}
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "Shift Scheduler", "OK", "Error") | Out-Null
  exit 1
}

# Runs a command through cmd so its stderr goes to the log instead of stopping PowerShell.
function Invoke-Step($command, $log, $failMessage) {
  cmd /c "$command > logs\$log 2>&1"
  if ($LASTEXITCODE -ne 0) { Show-Error "$failMessage See logs\$log." }
}

# True only when this app (not some other program) answers on the port.
function Test-Server {
  try { (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).app -eq "shift-scheduler" } catch { $false }
}

function Test-PortBusy {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Server {
  for ($i = 0; $i -lt 60 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
  Test-Server
}

try {
  Set-Location -LiteralPath (Split-Path $PSScriptRoot)
  # Start-Process treats its working directory as a wildcard pattern, so "[" or "]" in the path must be escaped.
  $here = [WildcardPattern]::Escape((Get-Location).ProviderPath)
  New-Item -ItemType Directory -Force logs, backups | Out-Null

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Show-Error "Node.js is not installed. Install the LTS version from https://nodejs.org and try again."
  }
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $edge) { Show-Error "Microsoft Edge was not found. It is needed to open the app window." }

  # Only one launcher prepares and starts the server; a second double-click just opens a window.
  $mutex = New-Object System.Threading.Mutex($false, "Local\ShiftSchedulerLauncher")
  try { $owner = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owner = $true } # previous launcher was killed
  $server = $null
  if ($owner) {
    if (-not (Test-Server)) {
      if (Test-PortBusy) { Show-Error "Port $port is used by another program. Close it and try again." }

      # Install exactly what package-lock.json says, again whenever the lockfile changes (e.g. after git pull).
      # Pinned npm version: older 11.x releases (e.g. 11.4) fail on this lockfile's optional platform packages.
      $installed = "node_modules\.package-lock.json"
      if (-not (Test-Path $installed) -or (Get-Item package-lock.json).LastWriteTime -gt (Get-Item $installed).LastWriteTime) {
        Invoke-Step "npx -y npm@11.21.1 ci" "setup.log" "Installing dependencies failed."
      }

      # Create the database if it is missing (first start, or deleted to start from scratch).
      if (-not (Test-Path shift-scheduler.db)) { Invoke-Step "npm run db:setup" "db.log" "Creating the database failed." }

      # Rebuild (and update the database schema) when the code is newer than the last build.
      $buildId = ".next\BUILD_ID"
      $sources = Get-ChildItem src, public, package.json, package-lock.json, next.config.ts, tsconfig.json, drizzle.config.ts `
        -Recurse -File -ErrorAction SilentlyContinue
      $lastChange = ($sources | Measure-Object LastWriteTime -Maximum).Maximum
      if (-not (Test-Path $buildId) -or (Get-Item $buildId).LastWriteTime -lt $lastChange) {
        Invoke-Step "npm run db:setup" "db.log" "Preparing the database failed."
        Invoke-Step "npm run build" "build.log" "Building the app failed."
      }

      # Backup before every start (SQLite backup API, safe with WAL); keep the 30 newest.
      $backup = "backups\shift-scheduler-$(Get-Date -Format 'yyyy-MM-dd_HHmmss').db"
      cmd /c "node -e ""require('better-sqlite3')('shift-scheduler.db').backup(process.argv[1]).then(() => process.exit(0), () => process.exit(1))"" $backup > logs\backup.log 2>&1"
      if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $backup -ErrorAction SilentlyContinue
        Show-Error "Backing up the database failed. See logs\backup.log."
      }
      Get-ChildItem backups\*.db | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item

      $server = Start-Process cmd -WorkingDirectory $here -WindowStyle Hidden -PassThru -ArgumentList `
        "/c node node_modules\next\dist\bin\next start -H 127.0.0.1 -p $port > logs\server.log 2> logs\server-error.log"
      if (-not (Wait-Server)) {
        taskkill /PID $server.Id /T /F | Out-Null
        Show-Error "The server did not start. See logs\server-error.log."
      }
    }
  } elseif (-not (Wait-Server)) {
    Show-Error "The app is still starting. Try again in a moment."
  }

  # A separate Edge profile makes the app window its own process, so we can wait until it is closed.
  Start-Process $edge -Wait -WorkingDirectory $here -ArgumentList "--app=$url", "--user-data-dir=$env:LOCALAPPDATA\ShiftScheduler\edge", `
    "--no-first-run", "--no-default-browser-check", "--disable-background-mode"

  # Stop the server only if this launcher started it.
  if ($server -and -not $server.HasExited) { taskkill /PID $server.Id /T /F | Out-Null }
  if ($owner) { $mutex.ReleaseMutex() }
} catch {
  Show-Error "Unexpected error: $($_.Exception.Message)"
}
