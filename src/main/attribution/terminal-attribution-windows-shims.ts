// Generated Windows scripts remain independent from POSIX shell behavior.
const POWERSHELL_TICK = "`"

export const WIN32_GIT_CMD_WRAPPER = String.raw`@echo off
setlocal
if not "%ORCA_ENABLE_GIT_ATTRIBUTION%"=="1" goto run
if "%ORCA_ATTRIBUTION_BYPASS%"=="1" goto run
call :orca_is_git_commit %*
if errorlevel 1 goto run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-wrapper.ps1" %*
exit /b %ERRORLEVEL%
:run
if defined ORCA_REAL_GIT (
  "%ORCA_REAL_GIT%" %*
) else (
  echo Orca attribution wrapper could not locate git on PATH. 1>&2
  exit /b 127
)
exit /b %ERRORLEVEL%

:orca_is_git_commit
if "%~1"=="" exit /b 1
if /I "%~1"=="commit" exit /b 0
set "orca_git_arg=%~1"
if /I "%orca_git_arg%"=="-c" goto skip_two
if /I "%orca_git_arg%"=="--config" goto skip_two
if /I "%orca_git_arg%"=="-C" goto skip_two
if /I "%orca_git_arg%"=="--git-dir" goto skip_two
if /I "%orca_git_arg%"=="--work-tree" goto skip_two
if /I "%orca_git_arg%"=="--namespace" goto skip_two
if /I "%orca_git_arg:~0,9%"=="--config=" goto skip_one
if /I "%orca_git_arg:~0,10%"=="--git-dir=" goto skip_one
if /I "%orca_git_arg:~0,12%"=="--work-tree=" goto skip_one
if /I "%orca_git_arg:~0,12%"=="--namespace=" goto skip_one
if "%orca_git_arg:~0,1%"=="-" goto skip_one
exit /b 1
:skip_two
shift
shift
goto orca_is_git_commit
:skip_one
shift
goto orca_is_git_commit
`

export const WIN32_GH_CMD_WRAPPER = String.raw`@echo off
setlocal
if not "%ORCA_ENABLE_GIT_ATTRIBUTION%"=="1" goto run
if "%ORCA_ATTRIBUTION_BYPASS%"=="1" goto run
if /I "%~1"=="pr" if /I "%~2"=="create" goto wrap
if /I "%~1"=="issue" if /I "%~2"=="create" goto wrap
goto run
:wrap
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0gh-wrapper.ps1" %*
exit /b %ERRORLEVEL%
:run
if defined ORCA_REAL_GH (
  "%ORCA_REAL_GH%" %*
) else (
  echo Orca attribution wrapper could not locate gh on PATH. 1>&2
  exit /b 127
)
exit /b %ERRORLEVEL%
`

export const WIN32_GIT_PS_WRAPPER = String.raw`$ErrorActionPreference = 'Stop'
$realGit = if ($env:ORCA_REAL_GIT) { $env:ORCA_REAL_GIT } else { 'git' }
$trailer = if ($env:ORCA_GIT_COMMIT_TRAILER) { $env:ORCA_GIT_COMMIT_TRAILER } else { 'Co-authored-by: Orca <help@stably.ai>' }

if ($args -contains '--dry-run') {
  & $realGit @args
  exit $LASTEXITCODE
}

function Test-GitCommitCommand {
  param([string[]]$CommandArgs)
  for ($i = 0; $i -lt $CommandArgs.Count; $i++) {
    $arg = $CommandArgs[$i]
    if ($arg -eq '-c' -or $arg -eq '--config' -or $arg -eq '-C' -or $arg -eq '--git-dir' -or $arg -eq '--work-tree' -or $arg -eq '--namespace') {
      $i++
      continue
    }
    if ($arg.StartsWith('--config=') -or $arg.StartsWith('--git-dir=') -or $arg.StartsWith('--work-tree=') -or $arg.StartsWith('--namespace=')) {
      continue
    }
    if ($arg -eq 'commit') {
      return $true
    }
    if ($arg.StartsWith('-')) {
      continue
    }
    return $false
  }
  return $false
}

function Test-ExplicitCommitMessage {
  param([string[]]$CommandArgs)
  foreach ($arg in $CommandArgs) {
    if ($arg -eq '-m' -or $arg -eq '--message' -or $arg -eq '-F' -or $arg -eq '--file' -or $arg.StartsWith('--message=') -or $arg.StartsWith('--file=') -or ($arg.StartsWith('-m') -and $arg.Length -gt 2) -or ($arg.StartsWith('-F') -and $arg.Length -gt 2) -or ($arg.StartsWith('-') -and -not $arg.StartsWith('--') -and $arg.EndsWith('m'))) {
      return $true
    }
  }
  return $false
}

function Test-UnsupportedCommitMessageSource {
  param([string[]]$CommandArgs)
  $sawCommit = $false
  for ($i = 0; $i -lt $CommandArgs.Count; $i++) {
    $arg = $CommandArgs[$i]
    if (-not $sawCommit) {
      if ($arg -eq '-c' -or $arg -eq '--config' -or $arg -eq '-C' -or $arg -eq '--git-dir' -or $arg -eq '--work-tree' -or $arg -eq '--namespace') {
        $i++
        continue
      }
      if ($arg.StartsWith('--config=') -or $arg.StartsWith('--git-dir=') -or $arg.StartsWith('--work-tree=') -or $arg.StartsWith('--namespace=')) {
        continue
      }
      if ($arg -eq 'commit') {
        $sawCommit = $true
        continue
      }
    }
    if ($arg -eq '-C' -or $arg -eq '--reuse-message' -or $arg -eq '-c' -or $arg -eq '--reedit-message' -or $arg -eq '--fixup' -or $arg -eq '--squash') {
      return $true
    }
    if ($arg -eq '-F' -or $arg -eq '--file') {
      $i++
      if ($i -ge $CommandArgs.Count -or -not (Test-Path -LiteralPath $CommandArgs[$i])) {
        return $true
      }
      continue
    }
    if ($arg.StartsWith('--file=')) {
      if (-not (Test-Path -LiteralPath $arg.Substring('--file='.Length))) {
        return $true
      }
      continue
    }
    if ($arg.StartsWith('-F') -and $arg.Length -gt 2) {
      if (-not (Test-Path -LiteralPath $arg.Substring(2))) {
        return $true
      }
      continue
    }
  }
  return $false
}

function Test-CommitMessageHasTrailer {
  param([string[]]$CommandArgs)
  for ($i = 0; $i -lt $CommandArgs.Count; $i++) {
    $arg = $CommandArgs[$i]
    if ($arg -eq '-m' -or $arg -eq '--message') {
      $i++
      if ($i -lt $CommandArgs.Count -and $CommandArgs[$i] -match [Regex]::Escape($trailer)) {
        return $true
      }
    } elseif ($arg.StartsWith('--message=')) {
      if ($arg.Substring('--message='.Length) -match [Regex]::Escape($trailer)) {
        return $true
      }
    } elseif ($arg.StartsWith('-m') -and $arg.Length -gt 2) {
      if ($arg.Substring(2) -match [Regex]::Escape($trailer)) {
        return $true
      }
    } elseif ($arg.StartsWith('-') -and -not $arg.StartsWith('--') -and $arg.EndsWith('m')) {
      $i++
      if ($i -lt $CommandArgs.Count -and $CommandArgs[$i] -match [Regex]::Escape($trailer)) {
        return $true
      }
    } elseif ($arg -eq '-F' -or $arg -eq '--file') {
      $i++
      if ($i -lt $CommandArgs.Count -and (Test-Path -LiteralPath $CommandArgs[$i]) -and (Get-Content -LiteralPath $CommandArgs[$i] -Raw) -match [Regex]::Escape($trailer)) {
        return $true
      }
    } elseif ($arg.StartsWith('--file=')) {
      $path = $arg.Substring('--file='.Length)
      if ((Test-Path -LiteralPath $path) -and (Get-Content -LiteralPath $path -Raw) -match [Regex]::Escape($trailer)) {
        return $true
      }
    } elseif ($arg.StartsWith('-F') -and $arg.Length -gt 2) {
      $path = $arg.Substring(2)
      if ((Test-Path -LiteralPath $path) -and (Get-Content -LiteralPath $path -Raw) -match [Regex]::Escape($trailer)) {
        return $true
      }
    }
  }
  return $false
}

if (-not (Test-GitCommitCommand $args) -or -not (Test-ExplicitCommitMessage $args) -or (Test-UnsupportedCommitMessageSource $args) -or (Test-CommitMessageHasTrailer $args)) {
  & $realGit @args
  exit $LASTEXITCODE
}

$tmpFile = $null
$attributedArgs = New-Object System.Collections.Generic.List[string]
$replacedFileMessage = $false
for ($i = 0; $i -lt $args.Count; $i++) {
  $arg = $args[$i]
  if (($arg -eq '-F' -or $arg -eq '--file') -and -not $replacedFileMessage) {
    $i++
    $sourceFile = if ($i -lt $args.Count) { $args[$i] } else { '' }
    if ($sourceFile -and (Test-Path -LiteralPath $sourceFile)) {
      $tmpFile = [System.IO.Path]::GetTempFileName()
      Set-Content -LiteralPath $tmpFile -Value ((Get-Content -LiteralPath $sourceFile -Raw).TrimEnd("${POWERSHELL_TICK}r", "${POWERSHELL_TICK}n") + "${POWERSHELL_TICK}r${POWERSHELL_TICK}n${POWERSHELL_TICK}r${POWERSHELL_TICK}n" + $trailer) -NoNewline
      $attributedArgs.Add($arg)
      $attributedArgs.Add($tmpFile)
      $replacedFileMessage = $true
    } else {
      $attributedArgs.Add($arg)
      $attributedArgs.Add($sourceFile)
    }
  } elseif ($arg.StartsWith('--file=') -and -not $replacedFileMessage) {
    $sourceFile = $arg.Substring('--file='.Length)
    if (Test-Path -LiteralPath $sourceFile) {
      $tmpFile = [System.IO.Path]::GetTempFileName()
      Set-Content -LiteralPath $tmpFile -Value ((Get-Content -LiteralPath $sourceFile -Raw).TrimEnd("${POWERSHELL_TICK}r", "${POWERSHELL_TICK}n") + "${POWERSHELL_TICK}r${POWERSHELL_TICK}n${POWERSHELL_TICK}r${POWERSHELL_TICK}n" + $trailer) -NoNewline
      $attributedArgs.Add("--file=$tmpFile")
      $replacedFileMessage = $true
    } else {
      $attributedArgs.Add($arg)
    }
  } elseif ($arg.StartsWith('-F') -and $arg.Length -gt 2 -and -not $replacedFileMessage) {
    $sourceFile = $arg.Substring(2)
    if (Test-Path -LiteralPath $sourceFile) {
      $tmpFile = [System.IO.Path]::GetTempFileName()
      Set-Content -LiteralPath $tmpFile -Value ((Get-Content -LiteralPath $sourceFile -Raw).TrimEnd("${POWERSHELL_TICK}r", "${POWERSHELL_TICK}n") + "${POWERSHELL_TICK}r${POWERSHELL_TICK}n${POWERSHELL_TICK}r${POWERSHELL_TICK}n" + $trailer) -NoNewline
      $attributedArgs.Add("-F$tmpFile")
      $replacedFileMessage = $true
    } else {
      $attributedArgs.Add($arg)
    }
  } else {
    $attributedArgs.Add($arg)
  }
}

if (-not $replacedFileMessage) {
  $attributedArgs.Add('-m')
  $attributedArgs.Add($trailer)
}

# Why: commit-msg hooks and signing should validate the final message. Editor
# commits pass through unchanged rather than being amended after success.
$env:ORCA_ATTRIBUTION_BYPASS = '1'
try {
  $attributedArgArray = $attributedArgs.ToArray()
  & $realGit @attributedArgArray
  exit $LASTEXITCODE
} finally {
  if ($tmpFile) {
    Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
  }
}
`

export const WIN32_GH_PS_WRAPPER = String.raw`$ErrorActionPreference = 'Stop'
$realGh = if ($env:ORCA_REAL_GH) { $env:ORCA_REAL_GH } else { 'gh' }

function Test-NonInteractiveCreateArgs {
  param([string[]]$CommandArgs)
  foreach ($arg in $CommandArgs) {
    if ($arg -match '^(--title|-t|--body|-b|--body-file|-F|--fill|--fill-first|--fill-verbose|--template|-T|--recover|--web)(=|$)') {
      return $true
    }
  }
  return $false
}

function Test-PassthroughCreateArgs {
  param([string[]]$CommandArgs)
  foreach ($arg in $CommandArgs) {
    if ($arg -eq '--help' -or $arg -eq '-h' -or $arg -eq '--version') {
      return $true
    }
  }
  return $false
}

function Get-GitHubApiPath {
  param([string]$Kind, [string]$CreatedUrl)
  if ($Kind -eq 'pr' -and $CreatedUrl -match '^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)') {
    return "repos/$($Matches[1])/$($Matches[2])/pulls/$($Matches[3])"
  }
  if ($Kind -eq 'issue' -and $CreatedUrl -match '^https://github\.com/([^/]+)/([^/]+)/issues/([0-9]+)') {
    return "repos/$($Matches[1])/$($Matches[2])/issues/$($Matches[3])"
  }
  return $null
}

function Test-CreateCommand {
  param([string[]]$CommandArgs, [string]$Kind)
  return $CommandArgs.Count -ge 2 -and $CommandArgs[0].ToLowerInvariant() -eq $Kind -and $CommandArgs[1].ToLowerInvariant() -eq 'create'
}

$isPrCreate = Test-CreateCommand $args 'pr'
$isIssueCreate = Test-CreateCommand $args 'issue'
if (($isPrCreate -or $isIssueCreate) -and (Test-PassthroughCreateArgs $args)) {
  & $realGh @args
  exit $LASTEXITCODE
}

if (($isPrCreate -or $isIssueCreate) -and -not (Test-NonInteractiveCreateArgs $args)) {
  & $realGh @args
  $status = $LASTEXITCODE
  if ($status -ne 0) {
    exit $status
  }
  exit 0
}

$stdoutFile = [System.IO.Path]::GetTempFileName()
$stderrFile = [System.IO.Path]::GetTempFileName()
& $realGh @args > $stdoutFile 2> $stderrFile
$status = $LASTEXITCODE
$stdoutCapture = if (Test-Path -LiteralPath $stdoutFile) { Get-Content -LiteralPath $stdoutFile -Raw } else { '' }
$stderrCapture = if (Test-Path -LiteralPath $stderrFile) { Get-Content -LiteralPath $stderrFile -Raw } else { '' }
if ($stderrCapture) {
  [Console]::Error.Write($stderrCapture)
}
if ($status -ne 0) {
  if ($stdoutCapture) {
    [Console]::Out.Write($stdoutCapture)
  }
  Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
  exit $status
}
if ($stdoutCapture) {
  [Console]::Out.Write($stdoutCapture)
}

if ($isPrCreate) {
  $createdUrl = ([regex]::Matches(($stdoutCapture + [Environment]::NewLine + $stderrCapture), 'https://github.com/\S+/pull/\d+') | Select-Object -Last 1).Value
  if ($createdUrl) {
    $apiPath = Get-GitHubApiPath 'pr' $createdUrl
    $body = if ($apiPath) { (& $realGh api $apiPath --jq '.body // ""' 2>$null) | Out-String } else { $null }
    if ($LASTEXITCODE -ne 0) {
      $body = $null
    }
    $footer = if ($env:ORCA_GH_PR_FOOTER) { $env:ORCA_GH_PR_FOOTER } else { 'Made with [Orca](https://github.com/stablyai/orca) 🐋' }
    if ($null -ne $body -and $body -notmatch [Regex]::Escape($footer)) {
      $tmpFile = [System.IO.Path]::GetTempFileName()
      try {
        $trimmed = $body.TrimEnd("${POWERSHELL_TICK}r", "${POWERSHELL_TICK}n")
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
          Set-Content -LiteralPath $tmpFile -Value $footer -NoNewline
        } else {
          Set-Content -LiteralPath $tmpFile -Value ($trimmed + "${POWERSHELL_TICK}r${POWERSHELL_TICK}n${POWERSHELL_TICK}r${POWERSHELL_TICK}n" + $footer) -NoNewline
        }
        # Why: gh has no transactional body append for newly-created PRs. This
        # immediate REST patch keeps attribution scoped to the URL gh returned.
        try {
          & $realGh api -X PATCH $apiPath -F "body=@$tmpFile" | Out-Null
        } catch {
        }
      } finally {
        Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

if ($isIssueCreate) {
  $createdUrl = ([regex]::Matches(($stdoutCapture + [Environment]::NewLine + $stderrCapture), 'https://github.com/\S+/issues/\d+') | Select-Object -Last 1).Value
  if ($createdUrl) {
    $apiPath = Get-GitHubApiPath 'issue' $createdUrl
    $body = if ($apiPath) { (& $realGh api $apiPath --jq '.body // ""' 2>$null) | Out-String } else { $null }
    if ($LASTEXITCODE -ne 0) {
      $body = $null
    }
    $footer = if ($env:ORCA_GH_ISSUE_FOOTER) { $env:ORCA_GH_ISSUE_FOOTER } else { 'Made with [Orca](https://github.com/stablyai/orca) 🐋' }
    if ($null -ne $body -and $body -notmatch [Regex]::Escape($footer)) {
      $tmpFile = [System.IO.Path]::GetTempFileName()
      try {
        $trimmed = $body.TrimEnd("${POWERSHELL_TICK}r", "${POWERSHELL_TICK}n")
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
          Set-Content -LiteralPath $tmpFile -Value $footer -NoNewline
        } else {
          Set-Content -LiteralPath $tmpFile -Value ($trimmed + "${POWERSHELL_TICK}r${POWERSHELL_TICK}n${POWERSHELL_TICK}r${POWERSHELL_TICK}n" + $footer) -NoNewline
        }
        # Why: gh has no transactional body append for newly-created issues.
        # This immediate REST patch keeps attribution scoped to the URL gh returned.
        try {
          & $realGh api -X PATCH $apiPath -F "body=@$tmpFile" | Out-Null
        } catch {
        }
      } finally {
        Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
