# Safe bootstrap for an existing RetroDev Studio checkout.
# This script does not scaffold or rewrite tracked project files.

#Requires -Version 5.1
param(
    [switch]$InstallMissingTools,
    [switch]$SkipNpmCi,
    [switch]$RunBaseline,
    [switch]$RunUpstreamValidation
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = $PSScriptRoot
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$LogFile = Join-Path $ProjectRoot "bootstrap.log"

function Write-Step {
    param(
        [string]$Module,
        [string]$Message,
        [ValidateSet("INFO", "OK", "WARN", "FAIL")]
        [string]$Level = "INFO"
    )

    $colors = @{ INFO = "Cyan"; OK = "Green"; WARN = "Yellow"; FAIL = "Red" }
    $prefix = @{ INFO = ">>"; OK = "[OK]"; WARN = "[!!]"; FAIL = "[XX]" }
    $line = "[$Module] $($prefix[$Level]) $Message"
    Write-Host $line -ForegroundColor $colors[$Level]
    Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $line"
}

function Test-CommandExists {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Reset-PathFromMachineAndUser {
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$machinePath;$userPath"

    $cargoPath = Join-Path $env:USERPROFILE ".cargo\bin"
    if ((Test-Path $cargoPath) -and ($env:PATH -notlike "*$cargoPath*")) {
        $env:PATH = "$cargoPath;$env:PATH"
    }
}

function Get-VsBuildToolsPath {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) {
        return $null
    }

    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ([string]::IsNullOrWhiteSpace($installPath)) {
        return $null
    }

    return $installPath.Trim()
}

function Test-WebView2Installed {
    $keys = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )

    foreach ($key in $keys) {
        $item = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        if ($item -and $item.pv) {
            return $true
        }
    }

    return $false
}

function Install-WingetPackage {
    param(
        [string]$DisplayName,
        [string]$WingetId,
        [string[]]$ExtraArgs = @()
    )

    if (-not (Test-CommandExists "winget")) {
        throw "winget nao esta disponivel para instalar $DisplayName."
    }

    Write-Step "INSTALL" "Instalando $DisplayName via winget..." "INFO"
    $arguments = @(
        "install",
        "--id", $WingetId,
        "--accept-source-agreements",
        "--accept-package-agreements",
        "-e"
    ) + $ExtraArgs

    & winget @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "winget install falhou para $DisplayName com exit code $LASTEXITCODE."
    }
}

function Assert-ExistingCheckout {
    $requiredPaths = @(
        (Join-Path $ProjectRoot "package.json"),
        (Join-Path $ProjectRoot "src-tauri\Cargo.toml"),
        (Join-Path $ProjectRoot "scripts\build.mjs"),
        (Join-Path $ProjectRoot "scripts\run-cargo-msvc.cmd")
    )

    foreach ($path in $requiredPaths) {
        if (-not (Test-Path $path)) {
            throw "Checkout existente nao encontrado: faltando '$path'. Este bootstrap nao cria scaffold novo."
        }
    }
}

function Show-Diagnostics {
    $result = [ordered]@{
        node = Test-CommandExists "node"
        npm = Test-CommandExists "npm"
        git = Test-CommandExists "git"
        rustc = Test-CommandExists "rustc"
        cargo = Test-CommandExists "cargo"
        vsBuildTools = $null -ne (Get-VsBuildToolsPath)
        webView2 = Test-WebView2Installed
    }

    foreach ($key in $result.Keys) {
        $value = [bool]$result[$key]
        $level = if ($value) { "OK" } else { "WARN" }
        Write-Step "DIAG" "$key = $value" $level
    }

    if ($result.node) {
        Write-Step "DIAG" "node version: $(& node --version)" "OK"
    }
    if ($result.npm) {
        Write-Step "DIAG" "npm version: $(& npm --version)" "OK"
    }
    if ($result.git) {
        Write-Step "DIAG" "git version: $(& git --version)" "OK"
    }
    if ($result.rustc) {
        Write-Step "DIAG" "rustc version: $(& rustc --version)" "OK"
    }
    if ($result.cargo) {
        Write-Step "DIAG" "cargo version: $(& cargo --version)" "OK"
    }
    if ($result.vsBuildTools) {
        Write-Step "DIAG" "VS Build Tools: $(Get-VsBuildToolsPath)" "OK"
    }

    return $result
}

function Install-MissingSystemTools {
    param([hashtable]$Diagnostics)

    if (-not $InstallMissingTools) {
        return
    }

    if (-not $Diagnostics.git) {
        Install-WingetPackage -DisplayName "Git" -WingetId "Git.Git"
    }
    if (-not $Diagnostics.node) {
        Install-WingetPackage -DisplayName "Node.js LTS" -WingetId "OpenJS.NodeJS.LTS"
    }
    if (-not $Diagnostics.rustc -or -not $Diagnostics.cargo) {
        Install-WingetPackage -DisplayName "Rustup" -WingetId "Rustlang.Rustup"
    }
    if (-not $Diagnostics.vsBuildTools) {
        Install-WingetPackage `
            -DisplayName "Visual Studio Build Tools 2022" `
            -WingetId "Microsoft.VisualStudio.2022.BuildTools" `
            -ExtraArgs @("--override", "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended")
    }
    if (-not $Diagnostics.webView2) {
        Install-WingetPackage -DisplayName "Microsoft Edge WebView2 Runtime" -WingetId "Microsoft.EdgeWebView2Runtime"
    }

    Reset-PathFromMachineAndUser
}

function Assert-BuildPrerequisites {
    param([hashtable]$Diagnostics)

    $required = @("node", "npm", "git", "rustc", "cargo")
    $missing = New-Object System.Collections.Generic.List[string]

    foreach ($name in $required) {
        if (-not $Diagnostics[$name]) {
            $missing.Add($name)
        }
    }

    if (-not $Diagnostics.vsBuildTools) {
        $missing.Add("vsBuildTools")
    }

    if ($missing.Count -gt 0) {
        $missingMessage = ($missing | Sort-Object -Unique) -join ", "
        throw "Host ainda incompleto para build local: $missingMessage. Rode novamente com -InstallMissingTools ou instale manualmente."
    }

    if (-not $Diagnostics.webView2) {
        Write-Step "DIAG" "WebView2 nao foi detectado. O app pode nao abrir no Windows ate o runtime ser instalado." "WARN"
    }
}

function Invoke-CommandChecked {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    Write-Step "RUN" $Label "INFO"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label falhou com exit code $LASTEXITCODE."
    }
}

function Invoke-NpmCi {
    Push-Location $ProjectRoot
    try {
        if (Test-Path (Join-Path $ProjectRoot "package-lock.json")) {
            Invoke-CommandChecked -Label "npm ci" -FilePath "npm" -Arguments @("ci")
        } else {
            Invoke-CommandChecked -Label "npm install" -FilePath "npm" -Arguments @("install")
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-BaselineValidation {
    Push-Location $ProjectRoot
    try {
        Invoke-CommandChecked -Label "check tree" -FilePath "npm" -Arguments @("run", "check:tree")
        Invoke-CommandChecked -Label "lint" -FilePath "npm" -Arguments @("run", "lint")
        Invoke-CommandChecked -Label "typescript" -FilePath "npx" -Arguments @("tsc", "--noEmit")
        Invoke-CommandChecked -Label "frontend tests" -FilePath "npm" -Arguments @("test")
        Invoke-CommandChecked -Label "rust clippy" -FilePath (Join-Path $ProjectRoot "scripts\run-cargo-msvc.cmd") -Arguments @("clippy", "--manifest-path", ".\src-tauri\Cargo.toml", "--", "-D", "warnings")
        Invoke-CommandChecked -Label "rust tests" -FilePath (Join-Path $ProjectRoot "scripts\run-cargo-msvc.cmd") -Arguments @("test", "--manifest-path", ".\src-tauri\Cargo.toml", "--lib", "--", "--nocapture", "--test-threads=1")
    }
    finally {
        Pop-Location
    }
}

function Invoke-UpstreamValidation {
    Push-Location $ProjectRoot
    try {
        Invoke-CommandChecked `
            -Label "upstream validation" `
            -FilePath "powershell" `
            -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\validate-upstream-windows.ps1", "-SkipRustTests")
    }
    finally {
        Pop-Location
    }
}

if (Test-Path $LogFile) {
    Remove-Item -LiteralPath $LogFile -Force
}

Reset-PathFromMachineAndUser
Assert-ExistingCheckout

Write-Step "BOOT" "Bootstrap seguro do checkout existente em $ProjectRoot" "INFO"
Write-Step "BOOT" "Flags: InstallMissingTools=$InstallMissingTools SkipNpmCi=$SkipNpmCi RunBaseline=$RunBaseline RunUpstreamValidation=$RunUpstreamValidation" "INFO"

$diagnostics = Show-Diagnostics
Install-MissingSystemTools -Diagnostics $diagnostics

if ($InstallMissingTools) {
    Write-Step "BOOT" "Revalidando diagnostico apos instalacao de pre-requisitos..." "INFO"
    $diagnostics = Show-Diagnostics
}

Assert-BuildPrerequisites -Diagnostics $diagnostics

if (-not $SkipNpmCi) {
    Invoke-NpmCi
} else {
    Write-Step "BOOT" "npm ci ignorado por flag explicita." "WARN"
}

if ($RunBaseline) {
    Invoke-BaselineValidation
} else {
    Write-Step "BOOT" "Baseline completa nao executada. Use -RunBaseline para validar todos os gates locais." "INFO"
}

if ($RunUpstreamValidation) {
    Invoke-UpstreamValidation
} else {
    Write-Step "BOOT" "Validacao upstream nao executada. Use -RunUpstreamValidation quando precisar certificar toolchains oficiais." "INFO"
}

Write-Step "BOOT" "Bootstrap concluido sem scaffold invasivo. Proximo passo recomendado: npm run build:debug" "OK"
