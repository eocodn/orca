param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDirectory,
  [Parameter(Mandatory = $true)]
  [string]$JsonOut
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath $PackageDirectory).Path
$reportPath = [System.IO.Path]::GetFullPath($JsonOut)
$installer = Join-Path $packageRoot 'orca-ade-windows-x64-unsigned-setup.exe'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$applicationProcess = $null
$controlProcessIds = @()
$installLocation = $null
$uninstallEntry = $null
$failure = $null
$observed = [ordered]@{
  windows_10 = $false
  installer_present = $false
  application_present = $false
  agent_control_present = $false
  native_worker_present = $false
  application_running = $false
  agent_control_running = $false
  uninstalled = $false
}

try {
  $caption = (Get-CimInstance Win32_OperatingSystem).Caption
  if ($caption -notmatch 'Windows 10') {
    throw "Dedicated runner must be Windows 10; observed: $caption"
  }
  $observed.windows_10 = $true

  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Installer is missing: $installer"
  }
  $observed.installer_present = $true

  $install = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($install.ExitCode -ne 0) {
    throw "Installer exited with $($install.ExitCode)"
  }

  $uninstallEntries = @(Get-ChildItem $uninstallRoot |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -eq 'Orca ADE' })
  if ($uninstallEntries.Count -ne 1) {
    throw "Expected one Orca ADE uninstall registration; observed: $($uninstallEntries.Count)"
  }
  $uninstallEntry = $uninstallEntries[0]
  $installLocation = ([string]$uninstallEntry.InstallLocation).Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($installLocation) -or -not (Test-Path -LiteralPath $installLocation -PathType Container)) {
    throw "Invalid installed location: $installLocation"
  }

  $installedExecutables = @(Get-ChildItem -LiteralPath $installLocation -Filter '*.exe' -File -Recurse)
  $controls = @($installedExecutables | Where-Object Name -eq 'ade-control.exe')
  $workers = @($installedExecutables | Where-Object Name -eq 'ade-worker.exe')
  $applications = @($installedExecutables |
    Where-Object { $_.Name -notin @('ade-control.exe', 'ade-worker.exe', 'uninstall.exe') })
  $observed.agent_control_present = $controls.Count -eq 1
  $observed.native_worker_present = $workers.Count -eq 1
  $observed.application_present = $applications.Count -eq 1
  if (-not $observed.agent_control_present -or -not $observed.native_worker_present -or -not $observed.application_present) {
    throw 'Installed package does not contain the app and both required sidecars'
  }
  $control = $controls[0]
  $worker = $workers[0]
  $application = $applications[0]

  $applicationProcess = Start-Process -FilePath $application.FullName -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $appState = Get-Process -Id $applicationProcess.Id -ErrorAction SilentlyContinue
    $controlProcesses = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq $control.FullName
    })
  } while (($null -eq $appState -or $controlProcesses.Count -eq 0) -and [DateTime]::UtcNow -lt $deadline)
  $observed.application_running = $null -ne $appState
  $observed.agent_control_running = $controlProcesses.Count -gt 0
  $controlProcessIds = @($controlProcesses | ForEach-Object ProcessId)
  if (-not $observed.application_running -or -not $observed.agent_control_running) {
    throw 'Installed application and Agent Control did not remain observable'
  }
} catch {
  $failure = $_.Exception.Message
} finally {
  if ($null -ne $applicationProcess) {
    Stop-Process -Id $applicationProcess.Id -Force -ErrorAction SilentlyContinue
  }
  foreach ($processId in $controlProcessIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }

  if ($null -ne $uninstallEntry -and -not [string]::IsNullOrWhiteSpace([string]$uninstallEntry.UninstallString)) {
    $uninstallCommand = [string]$uninstallEntry.UninstallString
    if ($uninstallCommand -match '^"([^"]+)"\s*(.*)$') {
      $uninstaller = $Matches[1]
      $uninstallArguments = @($Matches[2], '/S') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    } else {
      $uninstaller = $uninstallCommand
      $uninstallArguments = @('/S')
    }
    try {
      $uninstall = Start-Process -FilePath $uninstaller -ArgumentList $uninstallArguments -Wait -PassThru
      $registrationRemains = Get-ChildItem $uninstallRoot |
        ForEach-Object { Get-ItemProperty $_.PSPath } |
        Where-Object { $_.DisplayName -eq 'Orca ADE' }
      $observed.uninstalled = $uninstall.ExitCode -eq 0 -and $null -eq $registrationRemains -and -not (Test-Path -LiteralPath $installLocation)
      if (-not $observed.uninstalled -and $null -eq $failure) {
        $failure = 'Silent uninstall did not remove installation state'
      }
    } catch {
      if ($null -eq $failure) {
        $failure = "Uninstall failed: $($_.Exception.Message)"
      }
    }
  }

  $reportDirectory = Split-Path -Parent $reportPath
  New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
  [ordered]@{
    protocol_version = 1
    service = 'windows-tauri-package-acceptance'
    ok = $null -eq $failure -and $observed.uninstalled
    failure = $failure
    install_location = $installLocation
    observed = $observed
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8
}

if ($null -ne $failure) {
  throw $failure
}
