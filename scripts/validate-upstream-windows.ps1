param(
  [switch]$SkipRustTests
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "Este script suporta apenas Windows."
}

Write-Host "== RetroDev Studio: validacao oficial upstream =="
Write-Host "1. Baixa SGDK, PVSnesLib e cores Libretro oficiais sob demanda"
Write-Host "2. Executa o smoke test ignorado de build + load ROM + run frame"
Write-Host ""

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$validationDir = Join-Path $repoRoot "src-tauri\target-test\validation"
$validationReportPath = Join-Path $validationDir "upstream-validation.json"
$targetRoot = if ($env:RDS_VALIDATE_TARGET_DIR) {
  $env:RDS_VALIDATE_TARGET_DIR
} elseif ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA "RetroDevStudio\cargo-target-upstream-validation"
} else {
  Join-Path $repoRoot "src-tauri\target-test"
}

New-Item -ItemType Directory -Force -Path $validationDir | Out-Null
Write-Host "Cargo target dir: $targetRoot"
$env:CARGO_TARGET_DIR = $targetRoot

function Invoke-CargoChecked([string[]]$Arguments) {
  & cargo @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "cargo $($Arguments -join ' ') falhou com exit $LASTEXITCODE."
  }
}

function Write-ValidationReport([bool]$Success, [string]$ErrorMessage) {
  $payload = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    success = $Success
    skipRustTests = [bool]$SkipRustTests
    cargoTargetDir = $targetRoot
    reportPath = $validationReportPath
    error = if ([string]::IsNullOrWhiteSpace($ErrorMessage)) { $null } else { $ErrorMessage }
  }

  ($payload | ConvertTo-Json -Depth 4) + "`n" | Set-Content -Path $validationReportPath -Encoding UTF8
}

try {
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
    )
  }

  Write-Host ""
  Write-Host "Rodando validacao oficial com upstream real..."
  Invoke-CargoChecked @(
    "test",
    "--manifest-path",
    ".\src-tauri\Cargo.toml",
    "official_windows_upstream_validation_smoke_test",
    "--",
    "--ignored",
    "--nocapture"
  )

  Write-ValidationReport -Success $true -ErrorMessage ""
} catch {
  Write-ValidationReport -Success $false -ErrorMessage $_.Exception.Message
  throw
}
