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

function Get-BuildOutputRoot([string]$RepositoryRoot) {
    if (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
        return [System.IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'ade-windows-live-build'))
    }
    return [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'out/windows-live-build'))
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
$outputRoot = Get-BuildOutputRoot $repositoryRoot
$dockerfile = Join-Path $repositoryRoot 'Dockerfile.windows-live-workers'
$windowsControl = Join-Path $outputRoot 'windows/ade-control.exe'
$windowsWorker = Join-Path $outputRoot 'windows/ade-worker.exe'
$liveMatrix = Join-Path $outputRoot 'windows/live-target-matrix.exe'
$wslWorker = Join-Path $outputRoot 'wsl/ade-worker'
$plan = [ordered]@{
    ok = $true
    plan_only = [bool]$PlanOnly
    repository_root = $repositoryRoot
    output_root = $outputRoot
    dockerfile = $dockerfile
    distro = $Distro
    wsl_build_user = if ([string]::IsNullOrWhiteSpace($WslBuildUser)) { $null } else { $WslBuildUser }
    docker_command = @('docker','buildx','build')
    windows_control_binary = $windowsControl
    windows_worker_binary = $windowsWorker
    live_matrix_binary = $liveMatrix
    wsl_worker_binary = $wslWorker
}
if ($PlanOnly) { Write-MachineJson $plan; exit 0 }

if ($env:OS -ne 'Windows_NT') { Write-MachineJson ([ordered]@{ ok=$false; failure='windows_required' }); exit 1 }

try {
    Assert-NonBlank $Distro 'Distro'
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'command_missing:wsl.exe' }
    if (-not (Test-Path -LiteralPath $dockerfile -PathType Leaf)) { throw "dockerfile_missing:$dockerfile" }

    if (Test-Path -LiteralPath $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

    $repoWsl = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('wslpath','-a','-u',$repositoryRoot))
    Assert-NonBlank $repoWsl 'WSL repository path'
    $outputWsl = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('wslpath','-a','-u',$outputRoot))
    Assert-NonBlank $outputWsl 'WSL build output path'
    $arch = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('uname','-m'))
    $rustHost = Convert-WslArchToRustHost $arch
    if ($arch.Trim() -ne 'x86_64') { throw "windows_live_cross_build_requires_x86_64:$($arch.Trim())" }
    $dockerVersion = Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('docker','version','--format','{{.Server.Version}}'))
    Assert-NonBlank $dockerVersion 'Docker server version'
    $dockerfileWsl = "$repoWsl/Dockerfile.windows-live-workers"
    [void](Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @(
        'docker','buildx','build',
        '--file',$dockerfileWsl,
        '--output',"type=local,dest=$outputWsl",
        $repoWsl
    )))
    foreach ($artifact in @($windowsControl, $windowsWorker, $liveMatrix, $wslWorker)) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "build_artifact_missing:$artifact" }
    }
    $wslWorkerLinux = "$outputWsl/wsl/ade-worker"
    [void](Invoke-Process 'wsl.exe' (New-WslArguments $Distro $WslBuildUser @('test','-f',$wslWorkerLinux)))

    Write-MachineJson ([ordered]@{
        ok = $true
        distro = $Distro
        wsl_build_user = if ([string]::IsNullOrWhiteSpace($WslBuildUser)) { $null } else { $WslBuildUser }
        wsl_arch = $arch.Trim()
        wsl_rust_host = $rustHost
        docker_version = $dockerVersion.Trim()
        windows_control_binary = [System.IO.Path]::GetFullPath($windowsControl)
        windows_worker_binary = [System.IO.Path]::GetFullPath($windowsWorker)
        live_matrix_binary = [System.IO.Path]::GetFullPath($liveMatrix)
        wsl_worker_binary = [System.IO.Path]::GetFullPath($wslWorker)
        wsl_worker_linux_path = $wslWorkerLinux
    })
} catch {
    Write-MachineJson ([ordered]@{ ok=$false; failure=$_.Exception.Message; distro=$Distro })
    exit 1
}
