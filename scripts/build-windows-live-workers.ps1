[CmdletBinding()]
param(
    [string]$Distro = 'Ubuntu-24.04',
    [string]$WslBuildUser,
    [switch]$SelfTest,
    [switch]$PlanOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-NonBlank([string]$Value, [string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name must be nonblank" }
}

function Assert-SafeArgument([string]$Value) {
    if ($Value.Contains('"')) { throw 'process_argument_contains_quote' }
    return $Value
}

function Invoke-Process([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $null) {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    if ($WorkingDirectory) { $info.WorkingDirectory = $WorkingDirectory }
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add((Assert-SafeArgument ([string]$argument))) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (-not $process.Start()) { throw "process_start_failed:$FilePath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "process_failed:$FilePath exit=$($process.ExitCode) stderr=$($stderr.Trim())" }
    return $stdout.Trim()
}

function Convert-WslArchToRustHost([string]$Architecture) {
    switch ($Architecture.Trim()) {
        'x86_64' { return 'x86_64-unknown-linux-gnu' }
        'aarch64' { return 'aarch64-unknown-linux-gnu' }
        default { throw "unsupported_wsl_arch:$Architecture" }
    }
}

function Get-TargetRoot([string]$RepositoryRoot) {
    if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) { return Join-Path $RepositoryRoot 'rust/target' }
    if ([System.IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) { return [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) }
    return [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot $env:CARGO_TARGET_DIR))
}

function New-WslArguments([string]$Distribution, [string]$BuildUser, [string[]]$CommandArguments) {
    $arguments = @('--distribution', $Distribution)
    if (-not [string]::IsNullOrWhiteSpace($BuildUser)) { $arguments += @('--user', $BuildUser) }
    $arguments += @('--exec')
    $arguments += $CommandArguments
    return $arguments
}

function Write-MachineJson([object]$Value) {
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 12 -Compress))
}

function Invoke-SelfTest {
    if ((Convert-WslArchToRustHost 'x86_64') -ne 'x86_64-unknown-linux-gnu') { throw 'x86_64_mapping_failed' }
    if ((Convert-WslArchToRustHost 'aarch64') -ne 'aarch64-unknown-linux-gnu') { throw 'aarch64_mapping_failed' }
    $withUser = New-WslArguments 'Ubuntu-24.04' 'builder' @('uname','-m')
    if (($withUser -join '|') -ne '--distribution|Ubuntu-24.04|--user|builder|--exec|uname|-m') { throw 'wsl_user_args_failed' }
    $defaultUser = New-WslArguments 'Ubuntu-24.04' '' @('uname','-m')
    if (($defaultUser -join '|') -ne '--distribution|Ubuntu-24.04|--exec|uname|-m') { throw 'wsl_default_args_failed' }
    try { Assert-SafeArgument 'bad"argument' | Out-Null; throw 'quote_rejection_failed' } catch {
        if ($_.Exception.Message -eq 'quote_rejection_failed') { throw }
    }
    Write-MachineJson ([ordered]@{ ok=$true; self_test=$true; architectures=@('x86_64','aarch64') })
}

if ($SelfTest) {
    try { Invoke-SelfTest; exit 0 } catch { Write-MachineJson ([ordered]@{ ok=$false; self_test=$true; failure=$_.Exception.Message }); exit 1 }
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetRoot = Get-TargetRoot $repositoryRoot
$windowsControl = Join-Path $targetRoot 'release/ade-control.exe'
$windowsWorker = Join-Path $targetRoot 'release/ade-worker.exe'
$plan = [ordered]@{
    ok = $true
    plan_only = [bool]$PlanOnly
    repository_root = $repositoryRoot
    target_root = $targetRoot
    distro = $Distro
    wsl_build_user = if ([string]::IsNullOrWhiteSpace($WslBuildUser)) { $null } else { $WslBuildUser }
    windows_cargo_args = @('build','--manifest-path','rust/Cargo.toml','--release','--locked','--package','ade-control','--package','ade-worker')
    windows_control_binary = $windowsControl
    windows_worker_binary = $windowsWorker
}
if ($PlanOnly) { Write-MachineJson $plan; exit 0 }

if ($env:OS -ne 'Windows_NT') { Write-MachineJson ([ordered]@{ ok=$false; failure='windows_required' }); exit 1 }

try {
    Assert-NonBlank $Distro 'Distro'
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw 'command_missing:cargo.exe' }
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'command_missing:wsl.exe' }

    [void](Invoke-Process 'cargo.exe' $plan.windows_cargo_args $repositoryRoot)
    foreach ($artifact in @($windowsControl, $windowsWorker)) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "windows_artifact_missing:$artifact" }
    }

    $repoWsl = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('wslpath','-a','-u',$repositoryRoot))
    Assert-NonBlank $repoWsl 'WSL repository path'
    $arch = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('uname','-m'))
    $rustHost = Convert-WslArchToRustHost $arch
    $observedRustHost = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('rustc','-vV'))
    if ($observedRustHost -notmatch "(?m)^host:\s*$([regex]::Escape($rustHost))\s*$") { throw "wsl_rust_host_mismatch:$rustHost" }

    $wslTargetDir = "$repoWsl/rust/target/wsl-live-$($arch.Trim())"
    $wslManifest = "$repoWsl/rust/Cargo.toml"
    [void](Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @(
        'env', "CARGO_TARGET_DIR=$wslTargetDir", 'cargo', 'build',
        '--manifest-path', $wslManifest, '--release', '--locked', '--package', 'ade-worker'
    )))
    $wslWorkerLinux = "$wslTargetDir/release/ade-worker"
    [void](Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('test','-x',$wslWorkerLinux)))
    $wslWorkerWindows = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('wslpath','-a','-w',$wslWorkerLinux))
    Assert-NonBlank $wslWorkerWindows 'WSL worker Windows path'
    if (-not (Test-Path -LiteralPath $wslWorkerWindows -PathType Leaf)) { throw "wsl_artifact_not_windows_accessible:$wslWorkerWindows" }

    Write-MachineJson ([ordered]@{
        ok = $true
        distro = $Distro
        wsl_build_user = if ([string]::IsNullOrWhiteSpace($WslBuildUser)) { $null } else { $WslBuildUser }
        wsl_arch = $arch.Trim()
        wsl_rust_host = $rustHost
        windows_control_binary = [System.IO.Path]::GetFullPath($windowsControl)
        windows_worker_binary = [System.IO.Path]::GetFullPath($windowsWorker)
        wsl_worker_binary = $wslWorkerWindows.Trim()
        wsl_worker_linux_path = $wslWorkerLinux
    })
} catch {
    Write-MachineJson ([ordered]@{ ok=$false; failure=$_.Exception.Message; distro=$Distro })
    exit 1
}
