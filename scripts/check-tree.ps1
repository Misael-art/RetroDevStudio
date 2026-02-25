# ==============================================================================
# check-tree.ps1 - Valida a árvore de diretórios conforme docs/08_TREE_ARCHITECTURE.md
# Uso: .\scripts\check-tree.ps1 (execute na raiz do projeto)
# ==============================================================================

$ErrorActionPreference = "Stop"
$root = if ($PSScriptRoot) { Split-Path $PSScriptRoot -Parent } else { Get-Location }
if (-not (Test-Path (Join-Path $root "docs\08_TREE_ARCHITECTURE.md"))) {
    Write-Error "Execute este script na raiz do repositório RetroDev Studio (onde está a pasta docs)."
}

$allowedDirs = @("docs", "src", "src-tauri", "toolchains", "scripts")
$ignoreDirs = @(".git", "node_modules", "target", "dist", ".cursor", ".vscode", ".claude")

$invalid = @()
Get-ChildItem -Path $root -Directory | ForEach-Object {
    $name = $_.Name
    if ($allowedDirs -notcontains $name -and $ignoreDirs -notcontains $name) {
        $invalid += $name
    }
}

if ($invalid.Count -gt 0) {
    Write-Host "ERRO: Diretórios na raiz que não estão em docs/08_TREE_ARCHITECTURE.md:" -ForegroundColor Red
    $invalid | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "Diretórios permitidos na raiz: $($allowedDirs -join ', ')." -ForegroundColor Yellow
    Write-Host "Consulte docs/08_TREE_ARCHITECTURE.md antes de criar pastas." -ForegroundColor Yellow
    exit 1
}

Write-Host "OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md." -ForegroundColor Green
exit 0
