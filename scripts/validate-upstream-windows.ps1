param(
  [switch]$SkipRustTests
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "Este script suporta apenas Windows."
}

Write-Host "== RetroDev Studio: validacao oficial upstream =="
Write-Host "1. Baixa JDK, SGDK, PVSnesLib e cores Libretro oficiais sob demanda"
Write-Host "2. Executa o smoke test ignorado de build + load ROM + run frame"
Write-Host ""

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$validationDir = Join-Path $repoRoot "src-tauri\target-test\validation"
$validationReportPath = Join-Path $validationDir "upstream-validation.json"
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

New-Item -ItemType Directory -Force -Path $validationDir | Out-Null
if (-not (Test-Path $cargoRunner)) {
  throw "Runner canonico do Cargo com MSVC nao encontrado em '$cargoRunner'."
}
Write-Host "Cargo target dir solicitado: $requestedTargetRoot"
$env:CARGO_TARGET_DIR = $effectiveTargetRoot

function Test-SamePath([string]$LeftPath, [string]$RightPath) {
  return [System.String]::Equals(
    [System.IO.Path]::GetFullPath($LeftPath),
    [System.IO.Path]::GetFullPath($RightPath),
    [System.StringComparison]::OrdinalIgnoreCase
  )
}

function Stop-StaleTargetProcesses([string]$TargetRoot) {
  $resolvedTargetRoot = [System.IO.Path]::GetFullPath($TargetRoot)
  $staleProcesses = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith(
      $resolvedTargetRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  }

  foreach ($process in $staleProcesses) {
    Write-Host "Encerrando processo residual do target upstream: PID=$($process.ProcessId) Path=$($process.ExecutablePath)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
}

function Invoke-CargoCaptured([string[]]$Arguments, [string]$LogName) {
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

  $process = Start-Process `
    -FilePath $cargoRunner `
    -ArgumentList $Arguments `
    -WorkingDirectory $repoRoot `
    -NoNewWindow `
    -Wait `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath

  $stdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
  $stderr = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }
  $combinedOutput = (($stdout, $stderr) | Where-Object { -not [string]::IsNullOrEmpty($_) }) -join ""

  if (-not [string]::IsNullOrEmpty($stdout)) {
    Write-Host $stdout -NoNewline
  }
  if (-not [string]::IsNullOrEmpty($stderr)) {
    Write-Host $stderr -NoNewline
  }

  $combinedOutput | Set-Content -Path $logPath -Encoding UTF8

  return [PSCustomObject]@{
    ExitCode = $process.ExitCode
    LogPath = $logPath
    Output = $combinedOutput
  }
}

function Test-AppLockerBuildBlock([string]$Output) {
  return $Output -match "os error 4551" -or $Output -match "Controle de Aplicativo bloqueou este arquivo"
}

function Invoke-CargoChecked([string[]]$Arguments, [string]$LogName) {
  $result = Invoke-CargoCaptured -Arguments $Arguments -LogName $LogName
  if ($result.ExitCode -ne 0) {
    throw "cargo $($Arguments -join ' ') falhou com exit $($result.ExitCode)."
  }
  return $result
}

function Write-ValidationReport([bool]$Success, [string]$ErrorMessage) {
  $payload = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    success = $Success
    skipRustTests = [bool]$SkipRustTests
    requestedCargoTargetDir = $requestedTargetRoot
    cargoTargetDir = $effectiveTargetRoot
    effectiveCargoTargetDir = $effectiveTargetRoot
    usedCanonicalRetry = -not (Test-SamePath $requestedTargetRoot $effectiveTargetRoot)
    reportPath = $validationReportPath
    error = if ([string]::IsNullOrWhiteSpace($ErrorMessage)) { $null } else { $ErrorMessage }
  }

  ($payload | ConvertTo-Json -Depth 4) + "`n" | Set-Content -Path $validationReportPath -Encoding UTF8
}

try {
  Stop-StaleTargetProcesses -TargetRoot $effectiveTargetRoot

  if (-not $SkipRustTests) {
    Write-Host "Rodando suite Rust baseline..."
    Invoke-CargoChecked @(
      "test",
      "--manifest-path",
      ".\src-tauri\Cargo.toml",
      "--lib",
      "--",
      "--nocapture",
      "--test-threads=1"
    ) "upstream-rust-baseline.log"
  }

  Write-Host ""
  Write-Host "Rodando validacao oficial com upstream real..."
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
  $smokeResult = Invoke-CargoCaptured -Arguments $smokeArgs -LogName "upstream-smoke.log"

  if (
    $smokeResult.ExitCode -ne 0 -and
    -not (Test-SamePath $effectiveTargetRoot $canonicalTargetRoot) -and
    (Test-AppLockerBuildBlock $smokeResult.Output)
  ) {
    Write-Host ""
    Write-Host "[Retry] Smoke upstream bloqueado por AppLocker no target solicitado."
    Write-Host "[Retry] Reexecutando no target canonico aquecido: $canonicalTargetRoot"

    New-Item -ItemType Directory -Force -Path $canonicalTargetRoot | Out-Null
    $effectiveTargetRoot = $canonicalTargetRoot
    $env:CARGO_TARGET_DIR = $effectiveTargetRoot
    Stop-StaleTargetProcesses -TargetRoot $effectiveTargetRoot
    $smokeResult = Invoke-CargoCaptured -Arguments $smokeArgs -LogName "upstream-smoke-canonical-retry.log"
  }

  if ($smokeResult.ExitCode -ne 0) {
    throw "cargo $($smokeArgs -join ' ') falhou com exit $($smokeResult.ExitCode)."
  }

  Write-ValidationReport -Success $true -ErrorMessage ""
} catch {
  Write-ValidationReport -Success $false -ErrorMessage $_.Exception.Message
  throw
}
