# ==============================================================================
# bootstrap.ps1 - RetroDev Studio: Automated Bootstrap Script
# Diagnostica, instala dependencias e cria o scaffold completo do projeto.
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
# Requisitos: Windows 11, PowerShell 5.1+, winget disponivel
# ==============================================================================

#Requires -Version 5.1
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# --- Constantes ---
$SCRIPT_DIR = $PSScriptRoot
$PROJECT_ROOT = Split-Path $SCRIPT_DIR -Parent
$TEMP_SCAFFOLD = Join-Path $env:TEMP "retrodev-scaffold-$(Get-Random)"
$LOG_FILE = Join-Path $PROJECT_ROOT "bootstrap.log"

# Arquivos que NUNCA devem ser sobrescritos pelo scaffold
$PRESERVE_FILES = @(
    "docs", "scripts", "src", "CLAUDE.md", ".cursorrules",
    "README.md", ".claude", ".git", ".gitignore"
)

# --- Utilitarios ---

function Write-Step {
    param(
        [string]$Module,
        [string]$Message,
        [ValidateSet("INFO", "OK", "WARN", "FAIL")]
        [string]$Level = "INFO"
    )
    $colors = @{ INFO = "Cyan"; OK = "Green"; WARN = "Yellow"; FAIL = "Red" }
    $symbols = @{ INFO = ">>"; OK = "[OK]"; WARN = "[!!]"; FAIL = "[XX]" }
    $line = "[$Module] $($symbols[$Level]) $Message"
    Write-Host $line -ForegroundColor $colors[$Level]
    Add-Content -Path $LOG_FILE -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $line"
}

function Test-CommandExists {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Install-Prerequisite {
    param(
        [string]$DisplayName,
        [string]$WingetId,
        [string]$TestCommand,
        [string]$ExtraArgs = ""
    )
    if (Test-CommandExists $TestCommand) {
        Write-Step "INSTALL" "$DisplayName ja esta instalado." "OK"
        return $true
    }
    Write-Step "INSTALL" "Instalando $DisplayName ($WingetId)..." "INFO"
    try {
        $args_list = @("install", "--id", $WingetId, "--accept-source-agreements", "--accept-package-agreements", "-e")
        if ($ExtraArgs) { $args_list += $ExtraArgs.Split(" ") }
        $proc = Start-Process -FilePath "winget" -ArgumentList $args_list `
            -Wait -PassThru -NoNewWindow
        if ($proc.ExitCode -ne 0) {
            Write-Step "INSTALL" "winget retornou exit code $($proc.ExitCode) para $DisplayName." "WARN"
        }
        return $true
    }
    catch {
        Write-Step "INSTALL" "Falha ao instalar $DisplayName : $_" "FAIL"
        return $false
    }
}

function Reload-Path {
    Write-Step "ENV" "Recarregando PATH do sistema..." "INFO"
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$machinePath;$userPath"

    # Rust/Cargo path especifico
    $cargoPath = Join-Path $env:USERPROFILE ".cargo\bin"
    if ((Test-Path $cargoPath) -and ($env:PATH -notlike "*$cargoPath*")) {
        $env:PATH = "$cargoPath;$env:PATH"
    }
}

# ==============================================================================
# MODULO 1: DIAGNOSTICO DO SISTEMA
# ==============================================================================

function Invoke-Diagnostics {
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 1: DIAGNOSTICO DO SISTEMA" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    $checks = @(
        @{ Name = "Node.js";         Cmd = "node";      VersionArg = "--version" },
        @{ Name = "npm";             Cmd = "npm";       VersionArg = "--version" },
        @{ Name = "Git";             Cmd = "git";       VersionArg = "--version" },
        @{ Name = "Rust (rustc)";    Cmd = "rustc";     VersionArg = "--version" },
        @{ Name = "Cargo";           Cmd = "cargo";     VersionArg = "--version" },
        @{ Name = "winget";          Cmd = "winget";    VersionArg = "--version" }
    )

    $results = @{}
    foreach ($check in $checks) {
        if (Test-CommandExists $check.Cmd) {
            try {
                $ver = & $check.Cmd $check.VersionArg 2>&1 | Select-Object -First 1
                Write-Step "DIAG" "$($check.Name): $ver" "OK"
                $results[$check.Name] = "PASS"
            }
            catch {
                Write-Step "DIAG" "$($check.Name): encontrado mas erro ao obter versao." "WARN"
                $results[$check.Name] = "WARN"
            }
        }
        else {
            Write-Step "DIAG" "$($check.Name): NAO ENCONTRADO" "FAIL"
            $results[$check.Name] = "FAIL"
        }
    }

    # VS Build Tools — verifica via vswhere ou pelo path conhecido
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vsInstall) {
            Write-Step "DIAG" "VS Build Tools (C++): $vsInstall" "OK"
            $results["VS Build Tools"] = "PASS"
        }
        else {
            Write-Step "DIAG" "VS Build Tools (C++): NAO ENCONTRADO (workload C++ ausente)" "FAIL"
            $results["VS Build Tools"] = "FAIL"
        }
    }
    else {
        Write-Step "DIAG" "VS Build Tools: NAO ENCONTRADO (vswhere ausente)" "FAIL"
        $results["VS Build Tools"] = "FAIL"
    }

    # WebView2 — verifica no registro
    $wv2 = Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
    if ($wv2 -and $wv2.pv) {
        Write-Step "DIAG" "WebView2 Runtime: $($wv2.pv)" "OK"
        $results["WebView2"] = "PASS"
    }
    else {
        # Tenta path alternativo
        $wv2Alt = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
        if ($wv2Alt -and $wv2Alt.pv) {
            Write-Step "DIAG" "WebView2 Runtime: $($wv2Alt.pv)" "OK"
            $results["WebView2"] = "PASS"
        }
        else {
            Write-Step "DIAG" "WebView2 Runtime: NAO ENCONTRADO" "WARN"
            $results["WebView2"] = "WARN"
        }
    }

    Write-Host ""
    Write-Step "DIAG" "Resumo: $($results.Values | Where-Object { $_ -eq 'PASS' } | Measure-Object | Select-Object -ExpandProperty Count) PASS, $($results.Values | Where-Object { $_ -eq 'FAIL' } | Measure-Object | Select-Object -ExpandProperty Count) FAIL, $($results.Values | Where-Object { $_ -eq 'WARN' } | Measure-Object | Select-Object -ExpandProperty Count) WARN" "INFO"

    return $results
}

# ==============================================================================
# MODULO 2: INSTALACAO DE DEPENDENCIAS
# ==============================================================================

function Invoke-DependencyInstall {
    param([hashtable]$DiagResults)

    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 2: INSTALACAO DE DEPENDENCIAS" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    if (-not (Test-CommandExists "winget")) {
        Write-Step "INSTALL" "winget nao encontrado. Instale o App Installer pela Microsoft Store." "FAIL"
        throw "winget e obrigatorio para este script."
    }

    $needsReload = $false

    # Git
    if ($DiagResults["Git"] -eq "FAIL") {
        Install-Prerequisite "Git" "Git.Git" "git"
        $needsReload = $true
    }

    # Node.js
    if ($DiagResults["Node.js"] -eq "FAIL") {
        Install-Prerequisite "Node.js LTS" "OpenJS.NodeJS.LTS" "node"
        $needsReload = $true
    }

    # VS Build Tools (C++ workload) — necessario para compilar modulos nativos Rust/Tauri
    if ($DiagResults["VS Build Tools"] -eq "FAIL") {
        Write-Step "INSTALL" "Instalando Visual Studio Build Tools 2022 (workload C++)..." "INFO"
        Write-Step "INSTALL" "Isso pode levar varios minutos. Aguarde..." "WARN"
        try {
            $proc = Start-Process -FilePath "winget" -ArgumentList @(
                "install", "--id", "Microsoft.VisualStudio.2022.BuildTools",
                "--accept-source-agreements", "--accept-package-agreements", "-e",
                "--override", "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
            ) -Wait -PassThru -NoNewWindow
            if ($proc.ExitCode -eq 0) {
                Write-Step "INSTALL" "VS Build Tools 2022 instalado." "OK"
            }
            else {
                Write-Step "INSTALL" "VS Build Tools: winget retornou exit code $($proc.ExitCode). Pode precisar de reboot." "WARN"
            }
        }
        catch {
            Write-Step "INSTALL" "Falha ao instalar VS Build Tools: $_" "FAIL"
            Write-Step "INSTALL" "Instale manualmente: https://visualstudio.microsoft.com/visual-cpp-build-tools/" "WARN"
        }
        $needsReload = $true
    }

    # Rust via rustup
    if ($DiagResults["Rust (rustc)"] -eq "FAIL" -or $DiagResults["Cargo"] -eq "FAIL") {
        Install-Prerequisite "Rustup (Rust toolchain)" "Rustlang.Rustup" "rustup"
        $needsReload = $true

        # Reload para que rustup fique disponivel, depois instala a toolchain
        Reload-Path

        if (Test-CommandExists "rustup") {
            Write-Step "INSTALL" "Configurando toolchain stable via rustup..." "INFO"
            try {
                & rustup default stable 2>&1 | Out-Null
                & rustup update 2>&1 | Out-Null
                Write-Step "INSTALL" "Rust stable configurado." "OK"
            }
            catch {
                Write-Step "INSTALL" "Erro ao configurar rustup: $_" "WARN"
            }
        }
    }

    if ($needsReload) {
        Reload-Path
    }

    # Validacao pos-instalacao
    $critical = @("node", "npm", "git", "rustc", "cargo")
    $allGood = $true
    foreach ($cmd in $critical) {
        if (-not (Test-CommandExists $cmd)) {
            Write-Step "INSTALL" "$cmd ainda nao encontrado apos instalacao. Pode ser necessario reiniciar o terminal." "FAIL"
            $allGood = $false
        }
    }

    if ($allGood) {
        Write-Step "INSTALL" "Todas as dependencias criticas estao disponiveis." "OK"
    }
    else {
        Write-Step "INSTALL" "Algumas dependencias nao foram detectadas. Tente reabrir o terminal e rodar o script novamente." "WARN"
    }

    return $allGood
}

# ==============================================================================
# MODULO 3: SCAFFOLD TAURI + REACT + TYPESCRIPT
# ==============================================================================

function Invoke-TauriScaffold {
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 3: SCAFFOLD TAURI + REACT + TYPESCRIPT" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    # Se ja existe src-tauri e package.json, pula o scaffold
    if ((Test-Path (Join-Path $PROJECT_ROOT "src-tauri")) -and (Test-Path (Join-Path $PROJECT_ROOT "package.json"))) {
        Write-Step "SCAFFOLD" "Projeto Tauri ja existe (src-tauri/ e package.json encontrados). Pulando scaffold." "OK"
        return
    }

    # Cria scaffold em diretorio temporario
    Write-Step "SCAFFOLD" "Criando scaffold Tauri em diretorio temporario: $TEMP_SCAFFOLD" "INFO"

    if (Test-Path $TEMP_SCAFFOLD) {
        Remove-Item -Recurse -Force $TEMP_SCAFFOLD
    }
    New-Item -ItemType Directory -Path $TEMP_SCAFFOLD -Force | Out-Null

    try {
        # Usa npm create tauri-app com flags nao-interativas
        Write-Step "SCAFFOLD" "Executando: npm create tauri-app@latest ..." "INFO"
        Push-Location $TEMP_SCAFFOLD

        & npm create "tauri-app@latest" "retrodev-studio" -- `
            --template react-ts `
            --manager npm 2>&1 | ForEach-Object { Write-Step "SCAFFOLD" $_ "INFO" }

        Pop-Location

        $scaffoldDir = Join-Path $TEMP_SCAFFOLD "retrodev-studio"
        if (-not (Test-Path $scaffoldDir)) {
            # Tenta nome alternativo (alguns templates usam o nome diretamente)
            $candidates = Get-ChildItem -Path $TEMP_SCAFFOLD -Directory
            if ($candidates.Count -eq 1) {
                $scaffoldDir = $candidates[0].FullName
            }
            else {
                throw "Diretorio do scaffold nao encontrado em $TEMP_SCAFFOLD"
            }
        }

        Write-Step "SCAFFOLD" "Scaffold criado em: $scaffoldDir" "OK"

        # Copia arquivos do scaffold para o projeto, preservando arquivos existentes
        Write-Step "SCAFFOLD" "Mesclando scaffold com projeto existente (preservando docs, scripts, CLAUDE.md)..." "INFO"

        Get-ChildItem -Path $scaffoldDir -Force | ForEach-Object {
            $destPath = Join-Path $PROJECT_ROOT $_.Name
            $shouldPreserve = $PRESERVE_FILES -contains $_.Name

            if ($shouldPreserve -and (Test-Path $destPath)) {
                Write-Step "SCAFFOLD" "  Preservado: $($_.Name)" "WARN"
            }
            else {
                if ($_.PSIsContainer) {
                    if (Test-Path $destPath) {
                        # Merge: copia conteudo sem sobrescrever
                        Copy-Item -Path "$($_.FullName)\*" -Destination $destPath -Recurse -Force
                    }
                    else {
                        Copy-Item -Path $_.FullName -Destination $destPath -Recurse -Force
                    }
                }
                else {
                    Copy-Item -Path $_.FullName -Destination $destPath -Force
                }
                Write-Step "SCAFFOLD" "  Copiado: $($_.Name)" "OK"
            }
        }
    }
    catch {
        Write-Step "SCAFFOLD" "Erro no scaffold: $_" "FAIL"
        throw
    }
    finally {
        # Limpa diretorio temporario
        if (Test-Path $TEMP_SCAFFOLD) {
            Remove-Item -Recurse -Force $TEMP_SCAFFOLD -ErrorAction SilentlyContinue
        }
        Write-Step "SCAFFOLD" "Diretorio temporario removido." "INFO"
    }

    # npm install
    Write-Step "SCAFFOLD" "Executando npm install..." "INFO"
    Push-Location $PROJECT_ROOT
    try {
        & npm install 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Step "SCAFFOLD" $_ "INFO" }
        Write-Step "SCAFFOLD" "npm install concluido." "OK"
    }
    catch {
        Write-Step "SCAFFOLD" "Erro no npm install: $_" "FAIL"
        throw
    }
    finally {
        Pop-Location
    }
}

# ==============================================================================
# MODULO 4: DEPENDENCIAS FRONTEND (TailwindCSS v4, Zustand)
# ==============================================================================

function Invoke-FrontendDeps {
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 4: DEPENDENCIAS FRONTEND" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    Push-Location $PROJECT_ROOT
    try {
        # TailwindCSS v4 + plugin Vite
        Write-Step "FRONTEND" "Instalando TailwindCSS v4..." "INFO"
        & npm install tailwindcss @tailwindcss/vite 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Step "FRONTEND" $_ "INFO" }
        Write-Step "FRONTEND" "TailwindCSS v4 instalado." "OK"

        # Zustand
        Write-Step "FRONTEND" "Instalando Zustand..." "INFO"
        & npm install zustand 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Step "FRONTEND" $_ "INFO" }
        Write-Step "FRONTEND" "Zustand instalado." "OK"

        # Atualizar vite.config.ts para adicionar plugin TailwindCSS
        $viteConfig = Join-Path $PROJECT_ROOT "vite.config.ts"
        if (Test-Path $viteConfig) {
            $content = Get-Content $viteConfig -Raw
            if ($content -notmatch "tailwindcss") {
                Write-Step "FRONTEND" "Atualizando vite.config.ts com plugin TailwindCSS..." "INFO"
                $newContent = $content `
                    -replace '(import\s+react\s+from\s+[''"]@vitejs/plugin-react[''"];?)', "`$1`nimport tailwindcss from `"@tailwindcss/vite`";" `
                    -replace '(plugins:\s*\[\s*react\(\))', "`$1, tailwindcss()"
                Set-Content -Path $viteConfig -Value $newContent -Encoding UTF8
                Write-Step "FRONTEND" "vite.config.ts atualizado." "OK"
            }
            else {
                Write-Step "FRONTEND" "vite.config.ts ja contem TailwindCSS." "OK"
            }
        }
        else {
            Write-Step "FRONTEND" "vite.config.ts nao encontrado. Sera criado pelo scaffold." "WARN"
        }

        # Criar src/styles/index.css com import do Tailwind
        $stylesDir = Join-Path $PROJECT_ROOT "src" "styles"
        if (-not (Test-Path $stylesDir)) {
            New-Item -ItemType Directory -Path $stylesDir -Force | Out-Null
        }
        $cssPath = Join-Path $stylesDir "index.css"
        if (-not (Test-Path $cssPath)) {
            Set-Content -Path $cssPath -Value '@import "tailwindcss";' -Encoding UTF8
            Write-Step "FRONTEND" "Criado src/styles/index.css com @import tailwindcss." "OK"
        }
        else {
            Write-Step "FRONTEND" "src/styles/index.css ja existe." "OK"
        }
    }
    catch {
        Write-Step "FRONTEND" "Erro nas dependencias frontend: $_" "FAIL"
        throw
    }
    finally {
        Pop-Location
    }
}

# ==============================================================================
# MODULO 5: ESTRUTURA DE DIRETORIOS (08_TREE_ARCHITECTURE.md)
# ==============================================================================

function Invoke-DirectoryStructure {
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 5: ESTRUTURA DE DIRETORIOS" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    # Frontend: src/
    $frontendDirs = @(
        "src/assets",
        "src/components/common",
        "src/components/inspector",
        "src/components/hierarchy",
        "src/components/viewport",
        "src/core/ipc",
        "src/core/store",
        "src/styles",
        "src/views"
    )

    # Backend: src-tauri/src/
    $backendDirs = @(
        "src-tauri/src/core",
        "src-tauri/src/hardware",
        "src-tauri/src/compiler",
        "src-tauri/src/emulator",
        "src-tauri/src/ugdm"
    )

    # Toolchains
    $toolchainDirs = @(
        "toolchains/sgdk",
        "toolchains/pvsneslib"
    )

    $allDirs = $frontendDirs + $backendDirs + $toolchainDirs

    foreach ($dir in $allDirs) {
        $fullPath = Join-Path $PROJECT_ROOT $dir
        if (-not (Test-Path $fullPath)) {
            New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
            Write-Step "DIRS" "Criado: $dir" "OK"
        }
        else {
            Write-Step "DIRS" "Existe: $dir" "OK"
        }

        # Adiciona .gitkeep em pastas vazias
        $gitkeep = Join-Path $fullPath ".gitkeep"
        $items = Get-ChildItem -Path $fullPath -Force -ErrorAction SilentlyContinue
        if ($items.Count -eq 0) {
            Set-Content -Path $gitkeep -Value "" -Encoding UTF8
        }
    }

    Write-Step "DIRS" "Estrutura de diretorios criada conforme 08_TREE_ARCHITECTURE.md." "OK"
}

# ==============================================================================
# MODULO 6: .gitignore
# ==============================================================================

function Invoke-Gitignore {
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 6: .gitignore" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    $gitignorePath = Join-Path $PROJECT_ROOT ".gitignore"
    $gitignoreContent = @"
# ==============================================================================
# RetroDev Studio - .gitignore
# ==============================================================================

# --- Node / Frontend ---
node_modules/
dist/
*.local

# --- Rust / Backend ---
target/
Cargo.lock

# --- Tauri ---
WixTools/
*.msi
*.nsis
*.deb
*.rpm
*.AppImage

# --- Toolchains (binarios pesados, baixar separadamente) ---
toolchains/sgdk/
toolchains/pvsneslib/
!toolchains/sgdk/.gitkeep
!toolchains/pvsneslib/.gitkeep

# --- Build artifacts ---
build/
*.rom
*.md.bin
*.sfc
*.smc

# --- IDE ---
.vscode/
.cursor/
.idea/
*.swp
*.swo

# --- OS ---
Thumbs.db
.DS_Store
Desktop.ini

# --- Logs ---
*.log
bootstrap.log

# --- Environment ---
.env
.env.local
"@

    if (Test-Path $gitignorePath) {
        Write-Step "GITIGNORE" ".gitignore ja existe. Substituindo com versao completa..." "WARN"
    }
    Set-Content -Path $gitignorePath -Value $gitignoreContent -Encoding UTF8
    Write-Step "GITIGNORE" ".gitignore criado/atualizado." "OK"
}

# ==============================================================================
# MODULO 7: ATUALIZACAO DE DOCS
# ==============================================================================

function Invoke-DocUpdates {
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 7: ATUALIZACAO DE DOCS" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    # Atualiza 08_TREE_ARCHITECTURE.md: remove tailwind.config.js se ainda estiver la
    $treePath = Join-Path $PROJECT_ROOT "docs" "08_TREE_ARCHITECTURE.md"
    if (Test-Path $treePath) {
        $content = Get-Content $treePath -Raw
        if ($content -match "tailwind\.config\.js") {
            $content = $content -replace '.*tailwind\.config\.js.*\r?\n', ''
            Set-Content -Path $treePath -Value $content -Encoding UTF8
            Write-Step "DOCS" "Removida referencia a tailwind.config.js em 08_TREE_ARCHITECTURE.md" "OK"
        }
        else {
            Write-Step "DOCS" "08_TREE_ARCHITECTURE.md ja esta atualizado (sem tailwind.config.js)." "OK"
        }
    }
    else {
        Write-Step "DOCS" "08_TREE_ARCHITECTURE.md nao encontrado." "WARN"
    }
}

# ==============================================================================
# MODULO 8: VALIDACAO FINAL
# ==============================================================================

function Invoke-Validation {
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  MODULO 8: VALIDACAO FINAL" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    $failures = @()

    # 1. check-tree.js
    Write-Step "VALID" "Rodando check-tree.js..." "INFO"
    Push-Location $PROJECT_ROOT
    try {
        $output = & node scripts/check-tree.js 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Step "VALID" "check-tree.js: PASSOU" "OK"
        }
        else {
            Write-Step "VALID" "check-tree.js: FALHOU — $output" "FAIL"
            $failures += "check-tree.js"
        }
    }
    catch {
        Write-Step "VALID" "check-tree.js: ERRO — $_" "FAIL"
        $failures += "check-tree.js"
    }

    # 2. npm run build (frontend)
    Write-Step "VALID" "Rodando npm run build (frontend)..." "INFO"
    try {
        $output = & npm run build 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Step "VALID" "npm run build: PASSOU" "OK"
        }
        else {
            $lastLines = ($output | Select-Object -Last 5) -join "`n"
            Write-Step "VALID" "npm run build: FALHOU — $lastLines" "FAIL"
            $failures += "npm run build"
        }
    }
    catch {
        Write-Step "VALID" "npm run build: ERRO — $_" "FAIL"
        $failures += "npm run build"
    }

    # 3. cargo clippy (Rust)
    $srcTauri = Join-Path $PROJECT_ROOT "src-tauri"
    if (Test-Path (Join-Path $srcTauri "Cargo.toml")) {
        Write-Step "VALID" "Rodando cargo clippy no src-tauri..." "INFO"
        try {
            Push-Location $srcTauri
            $output = & cargo clippy -- -D warnings 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Step "VALID" "cargo clippy: PASSOU" "OK"
            }
            else {
                $lastLines = ($output | Select-Object -Last 5) -join "`n"
                Write-Step "VALID" "cargo clippy: FALHOU — $lastLines" "FAIL"
                $failures += "cargo clippy"
            }
            Pop-Location
        }
        catch {
            Write-Step "VALID" "cargo clippy: ERRO — $_" "FAIL"
            $failures += "cargo clippy"
            Pop-Location
        }
    }
    else {
        Write-Step "VALID" "src-tauri/Cargo.toml nao encontrado. Pulando cargo clippy." "WARN"
        $failures += "cargo clippy (Cargo.toml ausente)"
    }

    Pop-Location

    # Relatorio final
    Write-Host ""
    Write-Host "=" * 60 -ForegroundColor Magenta
    Write-Host "  RELATORIO FINAL" -ForegroundColor Magenta
    Write-Host "=" * 60 -ForegroundColor Magenta

    if ($failures.Count -eq 0) {
        Write-Host ""
        Write-Step "FINAL" "TUDO VERDE! Bootstrap concluido com sucesso." "OK"
        Write-Step "FINAL" "Proximo passo: npm run tauri dev" "INFO"
        Write-Host ""
    }
    else {
        Write-Host ""
        Write-Step "FINAL" "$($failures.Count) validacao(oes) falharam:" "FAIL"
        foreach ($f in $failures) {
            Write-Step "FINAL" "  - $f" "FAIL"
        }
        Write-Step "FINAL" "Corrija os problemas e rode o script novamente." "WARN"
        Write-Host ""
    }

    return $failures.Count
}

# ==============================================================================
# MAIN — Orquestra todos os modulos
# ==============================================================================

function Main {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  RetroDev Studio — Bootstrap Automatico" -ForegroundColor Cyan
    Write-Host "  Projeto: $PROJECT_ROOT" -ForegroundColor Cyan
    Write-Host "  Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""

    # Limpa log anterior
    if (Test-Path $LOG_FILE) { Remove-Item $LOG_FILE -Force }

    # Verifica que estamos na raiz correta
    if (-not (Test-Path (Join-Path $PROJECT_ROOT "docs" "08_TREE_ARCHITECTURE.md"))) {
        Write-Step "MAIN" "ERRO: Execute este script de dentro do projeto RetroDevStudio." "FAIL"
        Write-Step "MAIN" "Esperado: docs/08_TREE_ARCHITECTURE.md na raiz do projeto." "FAIL"
        exit 1
    }

    try {
        # Modulo 1: Diagnostico
        $diagResults = Invoke-Diagnostics

        # Modulo 2: Instalacao de dependencias
        $depsOk = Invoke-DependencyInstall -DiagResults $diagResults
        if (-not $depsOk) {
            Write-Step "MAIN" "Dependencias criticas ausentes. Tente reabrir o terminal e rodar novamente." "WARN"
            Write-Step "MAIN" "Se o problema persistir, instale manualmente: Node.js, Git, Rust, VS Build Tools." "WARN"
        }

        # Modulo 3: Scaffold Tauri
        Invoke-TauriScaffold

        # Modulo 4: Dependencias Frontend
        Invoke-FrontendDeps

        # Modulo 5: Estrutura de Diretorios
        Invoke-DirectoryStructure

        # Modulo 6: .gitignore
        Invoke-Gitignore

        # Modulo 7: Atualizacao de docs
        Invoke-DocUpdates

        # Modulo 8: Validacao
        $failCount = Invoke-Validation

        exit $failCount
    }
    catch {
        Write-Host ""
        Write-Step "MAIN" "ERRO FATAL: $_" "FAIL"
        Write-Step "MAIN" "Verifique o log em: $LOG_FILE" "FAIL"
        exit 1
    }
}

# Executa
Main
