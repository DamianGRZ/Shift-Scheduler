# Creates a "Shift Scheduler" shortcut on the desktop that runs scripts\launcher.ps1.
$root = Split-Path $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut("$desktop\Shift Scheduler.lnk")
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\launcher.ps1`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$root\scripts\icon.ico"
$shortcut.Description = "Shift Scheduler"
$shortcut.Save()
Write-Host "Shortcut created: $desktop\Shift Scheduler.lnk"
