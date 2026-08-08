[CmdletBinding()]
param(
    [string]$Distro = 'Ubuntu-24.04',
    [string]$ServiceUser = 'ade',
    [string]$ControlBinary,
    [string]$WindowsWorkerBinary,
    [string]$WslWorkerBinary,
    [string]$WorkerVersion = 'acceptance',
    [string]$JsonOut,
    [switch]$SelfTest,
    [string]$TestNamesFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Diagnostic([string]$Message) {
    [Console]::Error.WriteLine("[windows-live-acceptance] $Message")
}

function Assert-NonBlank([string]$Value, [string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name must be nonblank" }
}

function Assert-SafeProcessArgument([string]$Value) {
    if ($Value.Contains('"')) { throw 'process_argument_contains_quote' }
    return $Value
}

function New-ProcessStartInfo([string]$FilePath, [string[]]$Arguments, [bool]$RedirectInput = $false) {
    Assert-NonBlank $FilePath 'process path'
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $RedirectInput
    $info.CreateNoWindow = $true
    foreach ($argument in $Arguments) {
        [void]$info.ArgumentList.Add((Assert-SafeProcessArgument ([string]$argument)))
    }
    return $info
}

function Invoke-External(
    [string]$FilePath,
    [string[]]$Arguments,
    [hashtable]$Environment = @{},
    [string]$StandardInput = $null
) {
    $redirectInput = $null -ne $StandardInput
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = New-ProcessStartInfo $FilePath $Arguments $redirectInput
    foreach ($entry in $Environment.GetEnumerator()) {
        $process.StartInfo.Environment[[string]$entry.Key] = [string]$entry.Value
    }
    if (-not $process.Start()) { throw "process_start_failed:$FilePath" }
    if ($redirectInput) {
        $process.StandardInput.Write($StandardInput)
        $process.StandardInput.Close()
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdoutTask.GetAwaiter().GetResult()
        Stderr = $stderrTask.GetAwaiter().GetResult()
    }
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [hashtable]$Environment = @{}) {
    $result = Invoke-External $FilePath $Arguments $Environment
    if ($result.ExitCode -ne 0) {
        throw "process_failed:$FilePath exit=$($result.ExitCode) stderr=$($result.Stderr.Trim())"
    }
    return $result.Stdout.Trim()
}

function Convert-WslArchToRustTarget([string]$Architecture) {
    switch ($Architecture.Trim()) {
        'x86_64' { return 'x86_64-unknown-linux-gnu' }
        'aarch64' { return 'aarch64-unknown-linux-gnu' }
        default { throw "unsupported_wsl_arch:$Architecture" }
    }
}

function Classify-LiveTestName([string]$Name) {
    if ($Name -notmatch '^(windows_native|wsl2)_(file|git|pty)_(folder|worktree)$') {
        throw "matrix_contract_unmapped:$Name"
    }
    return [pscustomobject]@{ Target = $Matches[1]; Operation = $Matches[2]; Context = $Matches[3] }
}

function Assert-LiveMatrixContract([string[]]$Names) {
    $mapped = @{}
    foreach ($name in $Names) {
        $classification = Classify-LiveTestName $name
        $key = "$($classification.Target)|$($classification.Operation)|$($classification.Context)"
        if ($mapped.ContainsKey($key)) { throw "matrix_contract_ambiguous:$name" }
        $mapped[$key] = $name
    }
    foreach ($target in @('windows_native', 'wsl2')) {
        foreach ($operation in @('file', 'git', 'pty')) {
            foreach ($context in @('folder', 'worktree')) {
                $key = "$target|$operation|$context"
                if (-not $mapped.ContainsKey($key)) { throw "matrix_contract_unmapped:$key" }
            }
        }
    }
    if ($mapped.Count -ne 12) { throw "matrix_contract_ambiguous:count=$($mapped.Count)" }
    return $mapped
}

function Write-JsonResult([object]$Value, [string]$Path) {
    $json = $Value | ConvertTo-Json -Depth 20 -Compress
    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        $full = [System.IO.Path]::GetFullPath($Path)
        $directory = [System.IO.Path]::GetDirectoryName($full)
        if ($directory) { [System.IO.Directory]::CreateDirectory($directory) | Out-Null }
        $temp = "$full.$PID.tmp"
        [System.IO.File]::WriteAllText($temp, $json + [Environment]::NewLine)
        Move-Item -LiteralPath $temp -Destination $full -Force
    }
    [Console]::Out.WriteLine($json)
}

function Invoke-SelfTest {
    if ((Convert-WslArchToRustTarget 'x86_64') -ne 'x86_64-unknown-linux-gnu') { throw 'x86_64 mapping failed' }
    if ((Convert-WslArchToRustTarget 'aarch64') -ne 'aarch64-unknown-linux-gnu') { throw 'aarch64 mapping failed' }
    if ((Assert-SafeProcessArgument 'path with spaces') -ne 'path with spaces') { throw 'space argument failed' }
    try { Assert-SafeProcessArgument 'bad"quote' | Out-Null; throw 'quote rejection failed' } catch {
        if ($_.Exception.Message -eq 'quote rejection failed') { throw }
    }
    $names = @()
    foreach ($target in @('windows_native', 'wsl2')) {
        foreach ($operation in @('file', 'git', 'pty')) {
            foreach ($context in @('folder', 'worktree')) { $names += "${target}_${operation}_${context}" }
        }
    }
    if ($TestNamesFile) {
        $names = @(Get-Content -LiteralPath $TestNamesFile | ForEach-Object {
            if ($_ -match '^([^:]+): test$') { $Matches[1] }
        } | Where-Object { $_ -match '^(windows_native|wsl2)_' })
    }
    $map = Assert-LiveMatrixContract $names
    Write-JsonResult ([ordered]@{ ok = $true; self_test = $true; tests = $map.Count; cells = 6 }) $JsonOut
}

if ($SelfTest) {
    try { Invoke-SelfTest; exit 0 } catch {
        Write-JsonResult ([ordered]@{ ok = $false; self_test = $true; failure = $_.Exception.Message }) $JsonOut
        exit 1
    }
}

if ($env:OS -ne 'Windows_NT') {
    Write-JsonResult ([ordered]@{ ok = $false; failure = 'windows_required'; platform = [Environment]::OSVersion.Platform.ToString() }) $JsonOut
    exit 1
}

$server = $null
$endpointFile = $null
$fixtureRoot = $null
$wslFixtureRoot = $null
$report = [ordered]@{
    protocol_version = 1
    run_id = [Guid]::NewGuid().ToString('N')
    platform = 'windows'
    distro = $Distro
    wsl_arch = $null
    control = [ordered]@{}
    cells = @()
    cleanup = [ordered]@{ server = $false; endpoint_removed = $false; fixtures = $false }
    ok = $false
    failure = $null
}
$exitCode = 1

try {
    Assert-NonBlank $Distro 'Distro'
    Assert-NonBlank $ServiceUser 'ServiceUser'
    Assert-NonBlank $WorkerVersion 'WorkerVersion'
    foreach ($pathValue in @($ControlBinary, $WindowsWorkerBinary, $WslWorkerBinary)) {
        Assert-NonBlank $pathValue 'binary path'
        if (-not (Test-Path -LiteralPath $pathValue -PathType Leaf)) { throw "binary_missing:$pathValue" }
    }
    foreach ($command in @('wsl.exe', 'git.exe', 'cargo.exe')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "command_missing:$command" }
    }

    $wslArch = Invoke-Checked 'wsl.exe' @('--distribution', $Distro, '--exec', 'uname', '-m')
    [void](Convert-WslArchToRustTarget $wslArch)
    $report.wsl_arch = $wslArch.Trim()
    $serviceUid = Invoke-Checked 'wsl.exe' @('--distribution', $Distro, '--user', 'root', '--exec', 'id', '-u', $ServiceUser)
    if ($serviceUid.Trim() -eq '0') { throw 'service_user_is_root' }

    $fixtureRoot = Join-Path $env:RUNNER_TEMP "ade-live-$($report.run_id)"
    New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
    $nativeFolder = Join-Path $fixtureRoot 'folder-native'
    New-Item -ItemType Directory -Path $nativeFolder -Force | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeFolder, 'init') | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeFolder, 'config', 'user.email', 'ade-acceptance@example.invalid') | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeFolder, 'config', 'user.name', 'ADE Acceptance') | Out-Null
    Set-Content -LiteralPath (Join-Path $nativeFolder '.ade-live-marker') -Value 'ade-live-ready' -NoNewline
    Invoke-Checked 'git.exe' @('-C', $nativeFolder, 'add', '.') | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeFolder, 'commit', '-m', 'fixture') | Out-Null
    $nativeFolderExpected = Invoke-Checked 'git.exe' @('-C', $nativeFolder, 'rev-parse', '--show-toplevel')

    $nativeBase = Join-Path $fixtureRoot 'native-base'
    New-Item -ItemType Directory -Path $nativeBase -Force | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeBase, 'init') | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeBase, 'config', 'user.email', 'ade-acceptance@example.invalid') | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeBase, 'config', 'user.name', 'ADE Acceptance') | Out-Null
    Set-Content -LiteralPath (Join-Path $nativeBase 'base.txt') -Value 'base' -NoNewline
    Invoke-Checked 'git.exe' @('-C', $nativeBase, 'add', '.') | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeBase, 'commit', '-m', 'base') | Out-Null
    $nativeWorktree = Join-Path $fixtureRoot 'worktree-native'
    Invoke-Checked 'git.exe' @('-C', $nativeBase, 'worktree', 'add', '-b', 'acceptance-worktree', $nativeWorktree) | Out-Null
    Set-Content -LiteralPath (Join-Path $nativeWorktree '.ade-live-marker') -Value 'ade-live-ready' -NoNewline
    Invoke-Checked 'git.exe' @('-C', $nativeWorktree, 'add', '.') | Out-Null
    Invoke-Checked 'git.exe' @('-C', $nativeWorktree, 'commit', '-m', 'marker') | Out-Null
    $nativeWorktreeExpected = Invoke-Checked 'git.exe' @('-C', $nativeWorktree, 'rev-parse', '--show-toplevel')

    $wslFixtureRoot = "/tmp/ade-live-$($report.run_id)"
    $wslScript = "set -eu; root='$wslFixtureRoot'; rm -rf -- `"`$root`"; mkdir -p `"`$root/folder-wsl`" `"`$root/wsl-base`"; git -C `"`$root/folder-wsl`" init -q; git -C `"`$root/folder-wsl`" config user.email ade-acceptance@example.invalid; git -C `"`$root/folder-wsl`" config user.name 'ADE Acceptance'; printf ade-live-ready > `"`$root/folder-wsl/.ade-live-marker`"; git -C `"`$root/folder-wsl`" add .; git -C `"`$root/folder-wsl`" commit -qm fixture; git -C `"`$root/wsl-base`" init -q; git -C `"`$root/wsl-base`" config user.email ade-acceptance@example.invalid; git -C `"`$root/wsl-base`" config user.name 'ADE Acceptance'; printf base > `"`$root/wsl-base/base.txt`"; git -C `"`$root/wsl-base`" add .; git -C `"`$root/wsl-base`" commit -qm base; git -C `"`$root/wsl-base`" worktree add -q -b acceptance-worktree `"`$root/worktree-wsl`"; printf ade-live-ready > `"`$root/worktree-wsl/.ade-live-marker`"; git -C `"`$root/worktree-wsl`" add .; git -C `"`$root/worktree-wsl`" commit -qm marker"
    Invoke-Checked 'wsl.exe' @('--distribution', $Distro, '--exec', 'sh', '-lc', $wslScript) | Out-Null
    $wslFolder = "$wslFixtureRoot/folder-wsl"
    $wslWorktree = "$wslFixtureRoot/worktree-wsl"
    $wslFolderExpected = Invoke-Checked 'wsl.exe' @('--distribution', $Distro, '--exec', 'git', '-C', $wslFolder, 'rev-parse', '--show-toplevel')
    $wslWorktreeExpected = Invoke-Checked 'wsl.exe' @('--distribution', $Distro, '--exec', 'git', '-C', $wslWorktree, 'rev-parse', '--show-toplevel')

    $matrixPath = Join-Path $fixtureRoot 'live-target-matrix.json'
    $matrix = [ordered]@{ cases = @(
        [ordered]@{ name='folder-native'; workspace_kind='folder'; target=[ordered]@{kind='windows-native'}; workspace_path=$nativeFolder; repository_path=$nativeFolder; expected_worktree_path=$nativeFolderExpected; marker_path=(Join-Path $nativeFolder '.ade-live-marker'); marker_contains='ade-live-ready'; pty_program='cmd.exe'; pty_args=@('/C','echo ADE_LIVE_NATIVE_OK'); pty_marker='ADE_LIVE_NATIVE_OK' },
        [ordered]@{ name='worktree-native'; workspace_kind='git-worktree'; target=[ordered]@{kind='windows-native'}; workspace_path=$nativeWorktree; repository_path=$nativeWorktree; expected_worktree_path=$nativeWorktreeExpected; marker_path=(Join-Path $nativeWorktree '.ade-live-marker'); marker_contains='ade-live-ready'; pty_program='cmd.exe'; pty_args=@('/C','echo ADE_LIVE_NATIVE_OK'); pty_marker='ADE_LIVE_NATIVE_OK' },
        [ordered]@{ name='folder-wsl'; workspace_kind='folder'; target=[ordered]@{kind='wsl2'; identity=$Distro}; workspace_path=$wslFolder; repository_path=$wslFolder; expected_worktree_path=$wslFolderExpected; marker_path="$wslFolder/.ade-live-marker"; marker_contains='ade-live-ready'; pty_program='sh'; pty_args=@('-lc',"printf 'ADE_LIVE_WSL_OK\n'"); pty_marker='ADE_LIVE_WSL_OK' },
        [ordered]@{ name='worktree-wsl'; workspace_kind='git-worktree'; target=[ordered]@{kind='wsl2'; identity=$Distro}; workspace_path=$wslWorktree; repository_path=$wslWorktree; expected_worktree_path=$wslWorktreeExpected; marker_path="$wslWorktree/.ade-live-marker"; marker_contains='ade-live-ready'; pty_program='sh'; pty_args=@('-lc',"printf 'ADE_LIVE_WSL_OK\n'"); pty_marker='ADE_LIVE_WSL_OK' }
    ) }
    [System.IO.File]::WriteAllText($matrixPath, ($matrix | ConvertTo-Json -Depth 8 -Compress))

    $stateDb = Join-Path $fixtureRoot 'host-state.sqlite3'
    $endpointFile = Join-Path $fixtureRoot 'agent-control.json'
    $server = [System.Diagnostics.Process]::new()
    $server.StartInfo = New-ProcessStartInfo $ControlBinary @('--json','--serve','--state-db',$stateDb,'--endpoint-file',$endpointFile) $true
    $server.StartInfo.RedirectStandardError = $false
    if (-not $server.Start()) { throw 'control_server_start_failed' }
    $startupTask = $server.StandardOutput.ReadLineAsync()
    if (-not $startupTask.Wait(10000)) { throw 'control_server_start_timeout' }
    $startupLine = $startupTask.GetAwaiter().GetResult()
    $startup = $startupLine | ConvertFrom-Json
    if (-not $startup.ok -or $startup.type -ne 'control_server' -or $startup.protocol_version -ne 1 -or $startup.server_pid -ne $server.Id) { throw 'control_server_startup_invalid' }
    if ([System.IO.Path]::GetFullPath($startup.endpoint_file) -ne [System.IO.Path]::GetFullPath($endpointFile)) { throw 'control_server_endpoint_mismatch' }

    function Invoke-Control([string]$RequestId, [string]$Command, [object]$Args = $null) {
        $request = [ordered]@{ protocol_version=1; request_id=$RequestId; command=$Command }
        if ($null -ne $Args) { $request.args = $Args }
        $json = ($request | ConvertTo-Json -Depth 8 -Compress) + [Environment]::NewLine
        $result = Invoke-External $ControlBinary @('--json','--jsonl','--connect',$endpointFile) @{} $json
        if ($result.ExitCode -ne 0) { throw "control_client_failed:$Command stderr=$($result.Stderr.Trim())" }
        $line = ($result.Stdout -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
        if (-not $line) { throw "control_client_empty:$Command" }
        $response = $line | ConvertFrom-Json
        if (-not $response.ok) { throw "control_request_failed:${Command}:$($response.error.code):$($response.error.message)" }
        return $response
    }

    $report.control.status = Invoke-Control 'acceptance-control-status' 'control_status'
    $report.control.baseline = Invoke-Control 'acceptance-worker-baseline' 'worker_status'
    $workerId = "ade-live-$($report.run_id)"
    $workerIncarnation = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000) + ($PID % 1000)
    $sha = (Get-FileHash -LiteralPath $WslWorkerBinary -Algorithm SHA256).Hash.ToLowerInvariant()
    $updateArgs = [ordered]@{ distro=$Distro; service_user=$ServiceUser; worker_id=$workerId; worker_incarnation=$workerIncarnation; worker_version=$WorkerVersion; expected_sha256=$sha; binary_path=[System.IO.Path]::GetFullPath($WslWorkerBinary) }
    $report.control.update = Invoke-Control 'acceptance-worker-update' 'worker_update' $updateArgs
    $ready = Invoke-Control 'acceptance-worker-ready' 'worker_status'
    if ($ready.result.state -ne 'ready' -or $ready.result.maintenance -ne $false -or $ready.result.distro -ne $Distro -or $ready.result.worker_id -ne $workerId -or [uint64]$ready.result.worker_incarnation -ne [uint64]$workerIncarnation -or $ready.result.worker_version -ne $WorkerVersion) { throw 'worker_ready_identity_mismatch' }
    $report.control.ready = $ready

    $list = Invoke-Checked 'cargo.exe' @('test','--manifest-path','rust/Cargo.toml','-p','ade-worker','--test','live_target_matrix','--','--list')
    $testNames = @($list -split "`r?`n" | ForEach-Object { if ($_ -match '^([^:]+): test$' -and $Matches[1] -match '^(windows_native|wsl2)_') { $Matches[1] } } | Where-Object { $_ })
    $mapped = Assert-LiveMatrixContract $testNames
    $acceptanceEnv = @{
        ADE_ACCEPTANCE_CONTROL_ENDPOINT = [System.IO.Path]::GetFullPath($endpointFile)
        ADE_ACCEPTANCE_WINDOWS_WORKER_BIN = [System.IO.Path]::GetFullPath($WindowsWorkerBinary)
        ADE_ACCEPTANCE_WSL_WORKER_BIN = [System.IO.Path]::GetFullPath($WslWorkerBinary)
        ADE_ACCEPTANCE_DISTRO = $Distro
        ADE_ACCEPTANCE_WORKER_ID = $workerId
        ADE_ACCEPTANCE_WORKER_INCARNATION = [string]$workerIncarnation
        ADE_ACCEPTANCE_WORKER_VERSION = $WorkerVersion
        ADE_LIVE_TARGET_MATRIX = [System.IO.Path]::GetFullPath($matrixPath)
    }

    foreach ($target in @('windows_native','wsl2')) {
        foreach ($operation in @('file','git','pty')) {
            $cell = [ordered]@{ target=$target; operation=$operation; ok=$true; contexts=@() }
            foreach ($context in @('folder','worktree')) {
                $name = $mapped["$target|$operation|$context"]
                $started = [System.Diagnostics.Stopwatch]::StartNew()
                $test = Invoke-External 'cargo.exe' @('test','--manifest-path','rust/Cargo.toml','-p','ade-worker','--test','live_target_matrix',$name,'--','--ignored','--exact','--nocapture') $acceptanceEnv
                $started.Stop()
                $contextResult = [ordered]@{ context=$context; test=$name; exit_code=$test.ExitCode; duration_ms=$started.ElapsedMilliseconds }
                if ($test.ExitCode -ne 0) {
                    $contextResult.stderr = $test.Stderr.Trim()
                    $cell.ok = $false
                }
                $cell.contexts += $contextResult
            }
            if (-not $cell.ok) { $report.failure = "matrix_cell_failed:${target}:$operation" }
            $report.cells += $cell
        }
    }
    if ($report.cells.Where({ -not $_.ok }).Count -gt 0) { throw $report.failure }
    $report.ok = $true
    $exitCode = 0
} catch {
    if (-not $report.failure) { $report.failure = $_.Exception.Message }
    Write-Diagnostic $report.failure
} finally {
    if ($server) {
        try { $server.StandardInput.Close() } catch {}
        if (-not $server.WaitForExit(3000)) {
            try { $server.Kill($true) } catch {}
            [void]$server.WaitForExit(3000)
        }
        $report.cleanup.server = $server.HasExited
    }
    if ($endpointFile) {
        $report.cleanup.endpoint_removed = -not (Test-Path -LiteralPath $endpointFile)
        if (-not $report.cleanup.endpoint_removed) {
            $report.ok = $false
            $report.failure = 'control_endpoint_cleanup_failed'
            $exitCode = 1
        }
    }
    try {
        if ($wslFixtureRoot) { Invoke-External 'wsl.exe' @('--distribution',$Distro,'--exec','rm','-rf','--',$wslFixtureRoot) | Out-Null }
        if ($fixtureRoot -and (Test-Path -LiteralPath $fixtureRoot)) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
        $report.cleanup.fixtures = $true
    } catch {
        $report.ok = $false
        $report.failure = "fixture_cleanup_failed:$($_.Exception.Message)"
        $exitCode = 1
    }
}

Write-JsonResult $report $JsonOut
exit $exitCode
