param(
  [switch]$SkipRustTests,
  [switch]$SelfTestProcessSweep
)

$ErrorActionPreference = "Stop"

function Test-RunningOnWindows {
  if (($IsWindows -is [bool]) -and $IsWindows) {
    return $true
  }

  if ($env:OS -eq "Windows_NT") {
    return $true
  }

  try {
    return [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
  } catch {
    return $false
  }
}

if (-not (Test-RunningOnWindows)) {
  throw "Este script suporta apenas Windows."
}

Write-Host "== RetroDev Studio: validacao oficial upstream =="
Write-Host "1. Baixa JDK, SGDK, PVSnesLib e cores Libretro oficiais sob demanda"
Write-Host "2. Executa o smoke test ignorado de build + load ROM + run frame"
Write-Host ""

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$validationDir = Join-Path $repoRoot "src-tauri\target-test\validation"
$validationReportPath = if ($env:RDS_VALIDATE_REPORT_PATH) {
  $env:RDS_VALIDATE_REPORT_PATH
} else {
  Join-Path $validationDir "upstream-validation.json"
}
$cargoRunner = Join-Path $repoRoot "scripts\run-cargo-msvc.cmd"
$canonicalTargetRoot = Join-Path $repoRoot "src-tauri\target-test"
$requestedTargetRoot = if ($env:RDS_VALIDATE_TARGET_DIR) {
  $env:RDS_VALIDATE_TARGET_DIR
} elseif ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA "RetroDevStudio\cargo-target-upstream-validation"
} else {
  $canonicalTargetRoot
}
$effectiveTargetRoot = $requestedTargetRoot
$cargoTimeoutSeconds = 0
$baselineTimeoutSeconds = 0
$smokeTimeoutSeconds = 0
$processSweepTimeoutSeconds = 0
$processSweepResult = $null
$statusCodes = New-Object System.Collections.Generic.List[string]
$wrapperReports = New-Object System.Collections.Generic.List[string]
$phaseTimeline = New-Object System.Collections.Generic.List[object]
$scriptStartedAt = Get-Date

New-Item -ItemType Directory -Force -Path $validationDir | Out-Null
$reportParentDir = Split-Path -Parent $validationReportPath
if ($reportParentDir) {
  New-Item -ItemType Directory -Force -Path $reportParentDir | Out-Null
}
if (-not (Test-Path $cargoRunner)) {
  throw "Runner canonico do Cargo com MSVC nao encontrado em '$cargoRunner'."
}
Write-Host "Cargo target dir solicitado: $requestedTargetRoot"
$env:CARGO_TARGET_DIR = $effectiveTargetRoot

function Get-PositiveEnvInt([string]$Name, [int]$DefaultValue) {
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $DefaultValue
  }

  $parsed = 0
  if (-not [int]::TryParse($raw, [ref]$parsed) -or $parsed -le 0) {
    throw "[gate-config] $Name precisa ser inteiro positivo; recebido '$raw'."
  }

  return $parsed
}

function Test-SamePath([string]$LeftPath, [string]$RightPath) {
  return [System.String]::Equals(
    [System.IO.Path]::GetFullPath($LeftPath),
    [System.IO.Path]::GetFullPath($RightPath),
    [System.StringComparison]::OrdinalIgnoreCase
  )
}

function Test-PathStartsWith([string]$CandidatePath, [string]$TargetRoot) {
  try {
    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
      return $false
    }

    $resolvedCandidate = [System.IO.Path]::GetFullPath($CandidatePath)
    $resolvedRoot = [System.IO.Path]::GetFullPath($TargetRoot)
    return $resolvedCandidate.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Get-TargetProcessesFromCim([string]$TargetRoot) {
  if ([Environment]::GetEnvironmentVariable("RDS_VALIDATE_FORCE_CIM_FAILURE") -eq "1") {
    throw "[process-sweep:cim-simulated] falha CIM simulada para smoke do fallback."
  }

  $cimTimeoutSeconds = Get-PositiveEnvInt "RDS_VALIDATE_CIM_TIMEOUT_SECONDS" 10
  return @(Get-CimInstance Win32_Process -OperationTimeoutSec $cimTimeoutSeconds -ErrorAction Stop | Where-Object {
      $_.ExecutablePath -and (Test-PathStartsWith $_.ExecutablePath $TargetRoot)
    } | ForEach-Object {
      [PSCustomObject]@{
        ProcessId = [int]$_.ProcessId
        ExecutablePath = $_.ExecutablePath
        Source = "cim"
      }
    })
}

function Get-TargetProcessesFromGetProcess([string]$TargetRoot) {
  $matches = @()
  foreach ($process in Get-Process -ErrorAction Stop) {
    $executablePath = $null
    try {
      $executablePath = $process.Path
    } catch {
      $executablePath = $null
    }

    if (-not $executablePath) {
      try {
        $executablePath = $process.MainModule.FileName
      } catch {
        $executablePath = $null
      }
    }

    if (-not $executablePath) {
      continue
    }

    if (Test-PathStartsWith $executablePath $TargetRoot) {
      $matches += [PSCustomObject]@{
          ProcessId = [int]$process.Id
          ExecutablePath = $executablePath
          Source = "get-process"
        }
    }
  }

  return @($matches)
}

function Resolve-StaleTargetProcesses([string]$TargetRoot) {
  $warnings = @()
  $primaryError = $null

  try {
    $processes = Get-TargetProcessesFromCim -TargetRoot $TargetRoot
    return [PSCustomObject]@{
      Strategy = "cim"
      Processes = @($processes)
      Warnings = @($warnings)
      PrimaryError = $null
      FallbackError = $null
    }
  } catch {
    $primaryError = $_.Exception.Message
    $warnings += "[process-sweep:cim-unavailable] CIM/WMI indisponivel ao enumerar processos residuais; a validacao vai degradar para Get-Process. Detalhe: $primaryError"
  }

  try {
    $processes = Get-TargetProcessesFromGetProcess -TargetRoot $TargetRoot
    return [PSCustomObject]@{
      Strategy = "get-process"
      Processes = @($processes)
      Warnings = @($warnings)
      PrimaryError = $primaryError
      FallbackError = $null
    }
  } catch {
    $fallbackError = $_.Exception.Message
    $warnings += "[process-sweep:fallback-unavailable] Get-Process tambem falhou; a validacao seguira sem encerrar processos residuais do target. Detalhe: $fallbackError"
    return [PSCustomObject]@{
      Strategy = "skipped"
      Processes = @()
      Warnings = @($warnings)
      PrimaryError = $primaryError
      FallbackError = $fallbackError
    }
  }
}

function Stop-ProcessTree([int]$ProcessId) {
  $killCommand = "taskkill /PID $ProcessId /T /F >NUL 2>NUL"
  & cmd.exe /d /c $killCommand | Out-Null
}

function Stop-StaleTargetProcesses([string]$TargetRoot) {
  $resolved = Resolve-StaleTargetProcesses -TargetRoot $TargetRoot
  $terminationErrors = @()
  $terminated = @()

  foreach ($process in $resolved.Processes) {
    try {
      Write-Host "Encerrando processo residual do target upstream: PID=$($process.ProcessId) Path=$($process.ExecutablePath) [$($process.Source)]"
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      $terminated += [PSCustomObject]@{
          ProcessId = $process.ProcessId
          ExecutablePath = $process.ExecutablePath
          Source = $process.Source
        }
    } catch {
      try {
        Stop-ProcessTree -ProcessId $process.ProcessId
        $terminated += [PSCustomObject]@{
            ProcessId = $process.ProcessId
            ExecutablePath = $process.ExecutablePath
            Source = "$($process.Source)+taskkill"
          }
      } catch {
        $terminationErrors += "[process-sweep:terminate-failed] Falha ao encerrar PID=$($process.ProcessId) Path=$($process.ExecutablePath). Detalhe: $($_.Exception.Message)"
      }
    }
  }

  return [PSCustomObject]@{
    Strategy = $resolved.Strategy
    TargetRoot = [System.IO.Path]::GetFullPath($TargetRoot)
    MatchedCount = @($resolved.Processes).Count
    TerminatedCount = $terminated.Count
    Terminated = @($terminated)
    Warnings = @($resolved.Warnings)
    TerminationErrors = @($terminationErrors)
    PrimaryError = $resolved.PrimaryError
    FallbackError = $resolved.FallbackError
    Skipped = $resolved.Strategy -eq "skipped"
  }
}

function Invoke-CargoCaptured([string[]]$Arguments, [string]$LogName, [int]$TimeoutSeconds) {
  $logPath = Join-Path $validationDir $LogName
  $stdoutPath = Join-Path $validationDir ($LogName + ".stdout")
  $stderrPath = Join-Path $validationDir ($LogName + ".stderr")
  if (Test-Path $logPath) {
    Remove-Item -Path $logPath -Force -ErrorAction SilentlyContinue
  }
  foreach ($pathToClear in @($stdoutPath, $stderrPath)) {
    if (Test-Path $pathToClear) {
      Remove-Item -Path $pathToClear -Force -ErrorAction SilentlyContinue
    }
  }

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $env:ComSpec
  $startInfo.Arguments = "/d /c call `"$cargoRunner`" $($Arguments -join ' ')"
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "[gate-wrapper-failed] Nao foi possivel iniciar '$($Arguments -join ' ')'."
  }

  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()

  $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
  if ($timedOut) {
    try {
      Stop-ProcessTree -ProcessId $process.Id
    } catch {
      Write-Warning "[gate-timeout] Falha ao encerrar arvore do processo $($process.Id) apos timeout."
    }
    try {
      $process.WaitForExit()
    } catch {
      # Ignora erro extra apos timeout; o log parcial continua sendo a verdade util.
    }
  }

  try {
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
  } catch {
    throw "[gate-wrapper-failed] O wrapper terminou, mas a captura de stdout/stderr falhou para '$($Arguments -join ' ')'. Detalhe: $($_.Exception.Message)"
  }

  $exitCode = $null
  if (-not $timedOut) {
    try {
      $process.Refresh()
      $exitCode = [int]$process.ExitCode
    } catch {
      throw "[gate-wrapper-failed] O wrapper aguardou o cargo terminar, mas nao conseguiu materializar o ExitCode para '$($Arguments -join ' ')'. Detalhe: $($_.Exception.Message)"
    }
  }

  $stdout | Set-Content -Path $stdoutPath -Encoding UTF8
  $stderr | Set-Content -Path $stderrPath -Encoding UTF8
  $combinedOutput = (($stdout, $stderr) | Where-Object { -not [string]::IsNullOrEmpty($_) }) -join ""

  if (-not [string]::IsNullOrEmpty($stdout)) {
    Write-Host $stdout -NoNewline
  }
  if (-not [string]::IsNullOrEmpty($stderr)) {
    Write-Host $stderr -NoNewline
  }

  $combinedOutput | Set-Content -Path $logPath -Encoding UTF8

  return [PSCustomObject]@{
    ExitCode = if ($timedOut) { $null } else { $exitCode }
    LogPath = $logPath
    Output = $combinedOutput
    TimedOut = $timedOut
    TimeoutSeconds = $TimeoutSeconds
    ProcessId = $process.Id
  }
}

function Test-AppLockerBuildBlock([string]$Output) {
  return $Output -match "os error 4551" -or $Output -match "Controle de Aplicativo bloqueou este arquivo"
}

function Invoke-CargoChecked([string[]]$Arguments, [string]$LogName, [int]$TimeoutSeconds) {
  $result = Invoke-CargoCaptured -Arguments $Arguments -LogName $LogName -TimeoutSeconds $TimeoutSeconds
  if ($result.TimedOut) {
    throw "[gate-timeout] cargo $($Arguments -join ' ') excedeu ${TimeoutSeconds}s. Log parcial: $($result.LogPath)."
  }
  if ($result.ExitCode -ne 0) {
    throw "[gate-failed] cargo $($Arguments -join ' ') falhou com exit $($result.ExitCode)."
  }
  return $result
}

function New-StatusError([string]$Code, [string]$Message) {
  return "[status:$Code] $Message"
}

function Add-StatusCode([string]$Code) {
  if ([string]::IsNullOrWhiteSpace($Code)) {
    return
  }
  if (-not $statusCodes.Contains($Code)) {
    $statusCodes.Add($Code) | Out-Null
  }
}

function Add-WrapperReport([string]$Message) {
  if ([string]::IsNullOrWhiteSpace($Message)) {
    return
  }
  $wrapperReports.Add($Message) | Out-Null
}

function Start-Phase([string]$Name) {
  return [PSCustomObject]@{
    Name = $Name
    StartedAt = Get-Date
  }
}

function Complete-Phase([object]$Token, [string]$Status, [string]$StatusCode = $null, [string]$Detail = $null) {
  $finishedAt = Get-Date
  $durationMs = [int][Math]::Round(($finishedAt - $Token.StartedAt).TotalMilliseconds)
  $normalizedStatusCode = if ([string]::IsNullOrWhiteSpace($StatusCode)) { $null } else { $StatusCode }
  if ($normalizedStatusCode) {
    Add-StatusCode $normalizedStatusCode
  }
  $phaseTimeline.Add([ordered]@{
      phase = $Token.Name
      status = $Status
      status_code = $normalizedStatusCode
      detail = $Detail
      started_at = $Token.StartedAt.ToString("o")
      finished_at = $finishedAt.ToString("o")
      duration_ms = $durationMs
    }) | Out-Null
}

function Resolve-BlockingStatusCode([string]$ErrorMessage) {
  if ([string]::IsNullOrWhiteSpace($ErrorMessage)) {
    return "unknown_failure"
  }

  if ($ErrorMessage -match "\[status:([a-z0-9_]+)\]") {
    return $matches[1]
  }

  if ($ErrorMessage -match "\[gate-timeout\].*baseline" -or $ErrorMessage -match "upstream-rust-baseline\.log") {
    return "timeout_baseline"
  }
  if ($ErrorMessage -match "\[gate-timeout\].*official_windows_upstream_validation_smoke_test") {
    return "timeout_build"
  }
  if ($ErrorMessage -match "CIM/WMI" -or $ErrorMessage -match "Win32_Process") {
    return "host_wmi_unavailable"
  }
  if ($ErrorMessage -match "run-cargo-msvc\.cmd") {
    return "toolchain_missing"
  }
  if ($ErrorMessage -match "SEGA" -or $ErrorMessage -match "ROM") {
    return "rom_signature_missing"
  }
  if ($ErrorMessage -match "gate-failed" -or $ErrorMessage -match "Build") {
    return "build_failed"
  }
  return "unknown_failure"
}

function Write-ValidationReport([bool]$Success, [string]$ErrorMessage) {
  $finishedAt = Get-Date
  $blockingCodes = @($statusCodes.ToArray())
  if (-not $Success -and $blockingCodes.Count -eq 0) {
    $blockingCodes = @((Resolve-BlockingStatusCode $ErrorMessage))
  }
  $payload = [ordered]@{}
  $payload.generatedAt = $finishedAt.ToString("o")
  $payload.startedAt = $scriptStartedAt.ToString("o")
  $payload.durationMs = [int][Math]::Round(($finishedAt - $scriptStartedAt).TotalMilliseconds)
  $payload.success = $Success
  $payload.blocking_status_codes = @($blockingCodes)
  $payload.wrapper_reports = @($wrapperReports.ToArray())
  $payload.skipRustTests = [bool]$SkipRustTests
  $payload.selfTestProcessSweep = [bool]$SelfTestProcessSweep
  $payload.requestedCargoTargetDir = $requestedTargetRoot
  $payload.cargoTargetDir = $effectiveTargetRoot
  $payload.effectiveCargoTargetDir = $effectiveTargetRoot
  $payload.usedCanonicalRetry = -not (Test-SamePath $requestedTargetRoot $effectiveTargetRoot)
  $payload.reportPath = $validationReportPath
  $payload.cargoTimeoutSeconds = $cargoTimeoutSeconds
  $payload.baselineTimeoutSeconds = $baselineTimeoutSeconds
  $payload.smokeTimeoutSeconds = $smokeTimeoutSeconds
  $payload.processSweepTimeoutSeconds = $processSweepTimeoutSeconds
  $payload.phases = @($phaseTimeline.ToArray())
  if ($processSweepResult) {
    $payload.processSweep = [ordered]@{
      strategy = $processSweepResult.Strategy
      targetRoot = $processSweepResult.TargetRoot
      matchedCount = $processSweepResult.MatchedCount
      terminatedCount = $processSweepResult.TerminatedCount
      warnings = @($processSweepResult.Warnings)
      terminationErrors = @($processSweepResult.TerminationErrors)
      primaryError = $processSweepResult.PrimaryError
      fallbackError = $processSweepResult.FallbackError
      skipped = [bool]$processSweepResult.Skipped
    }
  } else {
    $payload.processSweep = $null
  }
  $payload.error = if ([string]::IsNullOrWhiteSpace($ErrorMessage)) { $null } else { $ErrorMessage }

  ($payload | ConvertTo-Json -Depth 6) + "`n" | Set-Content -Path $validationReportPath -Encoding UTF8
}

function Write-ProcessSweepSummary([object]$Result) {
  if (-not $Result) {
    return
  }

  Write-Host "[ProcessSweep] strategy=$($Result.Strategy) matched=$($Result.MatchedCount) terminated=$($Result.TerminatedCount) target=$($Result.TargetRoot)"
  foreach ($warning in $Result.Warnings) {
    Write-Warning $warning
  }
  foreach ($terminationError in $Result.TerminationErrors) {
    Write-Warning $terminationError
  }
}

$cargoTimeoutSeconds = Get-PositiveEnvInt "RDS_VALIDATE_CARGO_TIMEOUT_SECONDS" 1800
$baselineTimeoutSeconds = Get-PositiveEnvInt "RDS_VALIDATE_BASELINE_TIMEOUT_SECONDS" $cargoTimeoutSeconds
$smokeTimeoutSeconds = Get-PositiveEnvInt "RDS_VALIDATE_SMOKE_TIMEOUT_SECONDS" $cargoTimeoutSeconds
$processSweepTimeoutSeconds = Get-PositiveEnvInt "RDS_VALIDATE_PROCESS_SWEEP_TIMEOUT_SECONDS" 45

try {
  $phase = Start-Phase "process_sweep"
  $processSweepStartedAt = Get-Date
  $processSweepResult = Stop-StaleTargetProcesses -TargetRoot $effectiveTargetRoot
  $processSweepDurationSeconds = ($((Get-Date) - $processSweepStartedAt)).TotalSeconds
  if ($processSweepDurationSeconds -gt $processSweepTimeoutSeconds) {
    Add-WrapperReport "[process-sweep] excedeu timeout observacional de ${processSweepTimeoutSeconds}s (duracao real: $([int]$processSweepDurationSeconds)s)."
    Complete-Phase $phase "failed" "timeout_process_sweep" "Sweep de processos excedeu timeout observacional."
    throw (New-StatusError "timeout_process_sweep" "Sweep de processos excedeu timeout observacional de ${processSweepTimeoutSeconds}s.")
  }
  if ($processSweepResult.Strategy -eq "get-process") {
    Add-StatusCode "host_wmi_unavailable"
    Add-WrapperReport "[process-sweep] fallback interno usado: CIM -> Get-Process."
  } elseif ($processSweepResult.Strategy -eq "skipped") {
    Add-StatusCode "host_wmi_unavailable"
    Add-WrapperReport "[process-sweep] CIM e Get-Process indisponiveis; sweep pulado."
  }
  Complete-Phase $phase "passed" $null "Sweep finalizado com strategy=$($processSweepResult.Strategy)."
  Write-ProcessSweepSummary -Result $processSweepResult

  if ($SelfTestProcessSweep) {
    Write-Host "[SelfTest] Processo residual sweep exercitado sem rodar cargo."
    Complete-Phase (Start-Phase "self_test") "passed" $null "Self-test de sweep concluido."
    Write-ValidationReport -Success $true -ErrorMessage ""
    return
  }

  if (-not $SkipRustTests) {
    $phase = Start-Phase "baseline_rust_tests"
    Write-Host "Rodando suite Rust baseline..."
    $baselineResult = Invoke-CargoCaptured -Arguments @(
      "test",
      "--manifest-path",
      ".\src-tauri\Cargo.toml",
      "--lib",
      "--",
      "--nocapture",
      "--test-threads=1"
    ) -LogName "upstream-rust-baseline.log" -TimeoutSeconds $baselineTimeoutSeconds
    if ($baselineResult.TimedOut) {
      Complete-Phase $phase "failed" "timeout_baseline" "Baseline excedeu timeout."
      throw (New-StatusError "timeout_baseline" "Baseline Rust excedeu ${baselineTimeoutSeconds}s.")
    }
    if ($baselineResult.ExitCode -ne 0) {
      Complete-Phase $phase "failed" "build_failed" "Baseline Rust falhou."
      throw (New-StatusError "build_failed" "Baseline Rust falhou com exit $($baselineResult.ExitCode).")
    }
    Complete-Phase $phase "passed" $null "Baseline Rust concluida."
  }

  Write-Host ""
  Write-Host "Rodando validacao oficial com upstream real..."
  $phase = Start-Phase "upstream_smoke"
  $smokeArgs = @(
    "test",
    "--manifest-path",
    ".\src-tauri\Cargo.toml",
    "--lib",
    "official_windows_upstream_validation_smoke_test",
    "--",
    "--ignored",
    "--nocapture"
  )
  $smokeResult = Invoke-CargoCaptured -Arguments $smokeArgs -LogName "upstream-smoke.log" -TimeoutSeconds $smokeTimeoutSeconds

  if (
    -not $smokeResult.TimedOut -and
    $smokeResult.ExitCode -ne 0 -and
    -not (Test-SamePath $effectiveTargetRoot $canonicalTargetRoot) -and
    (Test-AppLockerBuildBlock $smokeResult.Output)
  ) {
    Add-WrapperReport "[smoke] retry canonico por bloqueio AppLocker no target solicitado."
    Write-Host ""
    Write-Host "[Retry] Smoke upstream bloqueado por AppLocker no target solicitado."
    Write-Host "[Retry] Reexecutando no target canonico aquecido: $canonicalTargetRoot"

    New-Item -ItemType Directory -Force -Path $canonicalTargetRoot | Out-Null
    $effectiveTargetRoot = $canonicalTargetRoot
    $env:CARGO_TARGET_DIR = $effectiveTargetRoot
    $processSweepResult = Stop-StaleTargetProcesses -TargetRoot $effectiveTargetRoot
    Write-ProcessSweepSummary -Result $processSweepResult
    $smokeResult = Invoke-CargoCaptured -Arguments $smokeArgs -LogName "upstream-smoke-canonical-retry.log" -TimeoutSeconds $smokeTimeoutSeconds
  }

  if ($smokeResult.TimedOut) {
    Complete-Phase $phase "failed" "timeout_build" "Smoke upstream excedeu timeout."
    throw (New-StatusError "timeout_build" "Smoke upstream excedeu ${smokeTimeoutSeconds}s. Log parcial: $($smokeResult.LogPath).")
  }
  if ($smokeResult.ExitCode -ne 0) {
    $smokeOutput = $smokeResult.Output
    if ($smokeOutput -match "Get-CimInstance|Win32_Process|HRESULT 0x80041033") {
      Complete-Phase $phase "failed" "host_wmi_unavailable" "Host WMI indisponivel durante smoke."
      throw (New-StatusError "host_wmi_unavailable" "Host WMI/CIM indisponivel durante smoke upstream.")
    }
    if ($smokeOutput -match "java.*(nao encontrado|not found|not recognized)") {
      Complete-Phase $phase "failed" "java_missing" "Java ausente."
      throw (New-StatusError "java_missing" "Java nao encontrado no host para build upstream.")
    }
    if ($smokeOutput -match "tauri-driver|tauri driver") {
      Complete-Phase $phase "failed" "tauri_driver_missing" "tauri-driver ausente."
      throw (New-StatusError "tauri_driver_missing" "tauri-driver ausente no host para smoke upstream.")
    }
    if ($smokeOutput -match "msedgedriver|webdriver") {
      Complete-Phase $phase "failed" "webdriver_missing" "WebDriver ausente."
      throw (New-StatusError "webdriver_missing" "WebDriver nativo ausente/invalido para smoke upstream.")
    }
    if ($smokeOutput -match "SEGA|ROM") {
      Complete-Phase $phase "failed" "rom_signature_missing" "ROM sem assinatura valida."
      throw (New-StatusError "rom_signature_missing" "Build concluiu sem assinatura ROM esperada.")
    }
    if ($smokeOutput -match "vswhere|Visual Studio|Build Tools|vcvars64|cargo\.exe not found|toolchain|SGDK|PVSNESLIB|gcc|make") {
      Complete-Phase $phase "failed" "toolchain_missing" "Toolchain ausente/invalida."
      throw (New-StatusError "toolchain_missing" "Toolchain oficial ausente ou invalida durante smoke upstream.")
    }
    Complete-Phase $phase "failed" "build_failed" "Smoke upstream falhou."
    throw (New-StatusError "build_failed" "Smoke upstream falhou com exit $($smokeResult.ExitCode).")
  }
  Complete-Phase $phase "passed" $null "Smoke upstream concluido."

  Write-ValidationReport -Success $true -ErrorMessage ""
} catch {
  $resolvedCode = Resolve-BlockingStatusCode $_.Exception.Message
  Add-StatusCode $resolvedCode
  Write-ValidationReport -Success $false -ErrorMessage $_.Exception.Message
  throw
}
