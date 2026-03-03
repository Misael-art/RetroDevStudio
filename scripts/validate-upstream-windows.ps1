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

if (-not $SkipRustTests) {
  Write-Host "Rodando suite Rust baseline..."
  cargo test --manifest-path .\src-tauri\Cargo.toml --lib -- --nocapture
}

Write-Host ""
Write-Host "Rodando validacao oficial com upstream real..."
cargo test --manifest-path .\src-tauri\Cargo.toml official_windows_upstream_validation_smoke_test -- --ignored --nocapture
