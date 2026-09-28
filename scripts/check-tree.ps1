# ==============================================================================
# check-tree.ps1 - Valida a árvore de diretórios conforme docs/08_TREE_ARCHITECTURE.md
# Uso: .\scripts\check-tree.ps1 (execute na raiz do projeto)
#
# Espelho fiel de scripts/check-tree.cjs: as duas implementações aceitam o mesmo
# conjunto de diretórios e aplicam a mesma regra de crates/ com registro
# explícito. A paridade é asserida por scripts/check-tree-crates.test.mjs.
# ==============================================================================

$ErrorActionPreference = "Stop"
$root = if ($env:RDS_CHECK_TREE_ROOT) {
    (Resolve-Path -Path $env:RDS_CHECK_TREE_ROOT).Path
} elseif ($PSScriptRoot) {
    Split-Path $PSScriptRoot -Parent
} else {
    Get-Location
}
if (-not (Test-Path (Join-Path $root "docs\08_TREE_ARCHITECTURE.md"))) {
    Write-Error "Execute este script na raiz do repositório RetroDev Studio (onde está a pasta docs)."
}

$allowedDirs = @(".github", "crates", "data", "docs", "src", "src-tauri", "toolchains", "scripts")
$ignoreDirs = @(".git", "node_modules", "target", "dist", ".cursor", ".vscode", ".claude", ".mimosa", ".zcode")
$cratesFiles = @("registry.json", "README.md")

$invalid = @()
Get-ChildItem -Path $root -Directory | ForEach-Object {
    $name = $_.Name
    if ($allowedDirs -notcontains $name -and $ignoreDirs -notcontains $name) {
        $invalid += $name
    }
}

$problems = @()

if ($invalid.Count -gt 0) {
    Write-Host "ERRO: Diretórios na raiz que não estão em docs/08_TREE_ARCHITECTURE.md:" -ForegroundColor Red
    $invalid | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "Diretórios permitidos na raiz: $($allowedDirs -join ', ')." -ForegroundColor Yellow
    Write-Host "Consulte docs/08_TREE_ARCHITECTURE.md antes de criar pastas." -ForegroundColor Yellow
    exit 1
}

# --- crates/: contêiner declarado, não caixa livre ---------------------------
$cratesDir = Join-Path $root "crates"
if (Test-Path $cratesDir) {
    $registryPath = Join-Path $cratesDir "registry.json"
    $names = @()
    if (-not (Test-Path $registryPath)) {
        $problems += "crates/registry.json não existe. crates/ só é aceito com registro explícito de pacotes."
    } else {
        $registry = $null
        try {
            $registry = Get-Content -Raw -Path $registryPath | ConvertFrom-Json
        } catch {
            $problems += "crates/registry.json não é JSON válido: $($_.Exception.Message)"
        }
        if ($null -ne $registry) {
            if ($registry.schema -ne "rex-crate-registry/v1") {
                $problems += "crates/registry.json: schema esperado rex-crate-registry/v1, encontrado $($registry.schema)."
            }
            if ($null -eq $registry.pacotes) {
                $problems += "crates/registry.json: campo pacotes precisa ser uma lista."
            } else {
                foreach ($pacote in @($registry.pacotes)) {
                    $nome = $pacote.nome
                    if (-not $nome) {
                        $problems += "crates/registry.json: pacote sem campo nome."
                        continue
                    }
                    if ($names -contains $nome) {
                        $problems += "crates/registry.json: pacote $nome declarado duas vezes."
                        continue
                    }
                    $names += $nome
                    $manifesto = Join-Path $cratesDir (Join-Path $nome "Cargo.toml")
                    $esperado = "crates/$nome/Cargo.toml"
                    if ($pacote.manifesto -and (($pacote.manifesto -replace '\\', '/') -ne $esperado)) {
                        $problems += "crates/registry.json: pacote $nome declara manifesto $($pacote.manifesto); esperado $esperado."
                    }
                    if (-not (Test-Path $manifesto)) {
                        $problems += "pacote registrado ausente: $esperado não existe. Um pacote esperado é reprovado, não ignorado."
                    }
                }
            }
        }
    }

    if ($problems.Count -eq 0) {
        Get-ChildItem -Path $cratesDir | ForEach-Object {
            if ($_.PSIsContainer) {
                if ($names -notcontains $_.Name) {
                    $problems += "crates/$($_.Name) não está em crates/registry.json. Módulo novo se registra antes de existir."
                }
            } elseif ($cratesFiles -notcontains $_.Name) {
                $problems += "crates/$($_.Name) é arquivo solto: só $($cratesFiles -join ', ') são aceitos nesse nível."
            }
        }
    }
}

if ($problems.Count -gt 0) {
    Write-Host "ERRO: Estrutura fora de docs/08_TREE_ARCHITECTURE.md:" -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "Diretórios permitidos na raiz: $($allowedDirs -join ', ')." -ForegroundColor Yellow
    Write-Host "Consulte docs/08_TREE_ARCHITECTURE.md antes de criar pastas." -ForegroundColor Yellow
    exit 1
}

Write-Host "OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md." -ForegroundColor Green
exit 0
