param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$NativeDriverPath = "",
  [switch]$SessionProbe
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$Title) {
  Write-Host ""
  Write-Host "== $Title ==" -ForegroundColor Cyan
}

function Write-Sub([string]$Label, [string]$Value) {
  Write-Host ("{0}: {1}" -f $Label, $Value)
}

function Test-Command([string]$CommandName) {
  return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Run-Command([string]$CommandLine) {
  try {
    $result = & powershell -NoProfile -Command $CommandLine 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Sub "ERRO" ($result -join " ")
      return
    }
    if ($result) {
      $result | ForEach-Object { Write-Host $_ }
    }
  } catch {
    Write-Sub "EXCEPTION" $_.Exception.Message
  }
}

function Invoke-WebDriverSessionProbe([string]$AppPath, [string]$DriverPath) {
  Write-Step "WebDriver Session Probe"

  if (!(Test-Path $DriverPath)) {
    Write-Sub "SKIP" "Native driver nao encontrado: $DriverPath"
    return
  }
  if (!(Test-Path $AppPath)) {
    Write-Sub "SKIP" "App debug nao encontrado: $AppPath"
    return
  }

  $probeRoot = Join-Path ([System.IO.Path]::GetTempPath()) "retrodev-desktop-e2e-diagnostics"
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $probeDir = Join-Path $probeRoot "session-probe-$timestamp"
  New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
  $edgeLog = Join-Path $probeDir "msedgedriver.log"
  Write-Sub "Probe log dir" $probeDir

  $driverProc = $null
  try {
    $driverProc = Start-Process -FilePath $DriverPath -ArgumentList @("--port=9517", "--verbose", "--log-path=$edgeLog") -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2

    $payload = @{
      capabilities = @{
        alwaysMatch = @{
          browserName = "webview2"
          "ms:edgeChromium" = $true
          "ms:edgeOptions" = @{
            binary = $AppPath
            args = @()
          }
        }
      }
    } | ConvertTo-Json -Depth 8

    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:9517/session" -Method Post -ContentType "application/json" -Body $payload -TimeoutSec 90
      Write-Sub "Session probe status" $response.StatusCode
      if ($response.Content) {
        Write-Host $response.Content
      }
    } catch {
      Write-Sub "Session probe error" $_.Exception.Message
      $body = ""
      if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
      }
      if ($body) {
        Write-Sub "Session probe body" $body
      }
    }
  } catch {
    Write-Sub "Session probe exception" $_.Exception.Message
  } finally {
    if ($driverProc -and -not $driverProc.HasExited) {
      Stop-Process -Id $driverProc.Id -Force
    }
  }

  if (Test-Path $edgeLog) {
    Write-Sub "msedgedriver log" $edgeLog
    Get-Content $edgeLog -Tail 80
    if (Select-String -Path $edgeLog -Pattern "DevToolsActivePort file doesn't exist" -SimpleMatch -Quiet) {
      Write-Host "Indicador: DevToolsActivePort detectado no probe de sessao." -ForegroundColor Yellow
    }
  } else {
    Write-Sub "msedgedriver log" "Nao gerado"
  }
}

if ([string]::IsNullOrWhiteSpace($NativeDriverPath)) {
  $canonicalDriverPath = Join-Path $RepoRoot "toolchains\webdriver\msedgedriver.exe"
  $legacyDriverPath = Join-Path $RepoRoot "msedgedriver.exe"
  if (Test-Path $canonicalDriverPath) {
    $NativeDriverPath = $canonicalDriverPath
  } else {
    $NativeDriverPath = $legacyDriverPath
  }
}

$tauriDriverPath = Join-Path $env:USERPROFILE ".cargo\\bin\\tauri-driver.exe"
$releaseAppPath = Join-Path $RepoRoot "src-tauri\\target-test\\release\\retro-dev-studio.exe"
$debugAppPath = Join-Path $RepoRoot "src-tauri\\target-test\\debug\\retro-dev-studio.exe"
$appPath = if (Test-Path $releaseAppPath) { $releaseAppPath } else { $debugAppPath }
$webViewPath = "C:\Program Files (x86)\Microsoft\EdgeWebView\Application\145.0.3800.82\msedgewebview2.exe"

Write-Step "Environment"
Write-Sub "RepoRoot" $RepoRoot
Write-Sub "NativeDriverPath" $NativeDriverPath
Write-Sub "tauri-driver" $tauriDriverPath
Write-Sub "Desktop app" $appPath
Write-Sub "Node available" ((Test-Command "node").ToString())
Write-Sub "npm.cmd available" ((Test-Command "npm.cmd").ToString())

Write-Step "Versions"
if (Test-Command "node") { Run-Command "node --version" }
if (Test-Command "npm.cmd") { Run-Command "npm.cmd --version" }
if (Test-Path $NativeDriverPath) { Run-Command "& '$NativeDriverPath' --version" } else { Write-Sub "Native driver" "Not found" }
if (Test-Path $tauriDriverPath) { Run-Command "& '$tauriDriverPath' --help" } else { Write-Sub "tauri-driver" "Not found" }

Write-Step "Binary Presence"
Write-Sub "App exists" ((Test-Path $appPath).ToString())
Write-Sub "Native driver exists" ((Test-Path $NativeDriverPath).ToString())
Write-Sub "tauri-driver exists" ((Test-Path $tauriDriverPath).ToString())
Write-Sub "WebView runtime probe" ((Test-Path $webViewPath).ToString())

Write-Step "Process Snapshot"
$procs = Get-Process -Name "retro-dev-studio","tauri-driver","msedgedriver","msedgewebview2" -ErrorAction SilentlyContinue
if ($procs) {
  $procs | Select-Object Name, Id, Path | Format-Table -AutoSize
} else {
  Write-Host "No related processes running."
}

Write-Step "Node spawn probe"
$probe = @'
const { spawn } = require("node:child_process");
function run(label, command, args, options) {
  try {
    const child = spawn(command, args, options);
    child.on("error", (error) => {
      console.log(label, "error", error.code, error.message);
    });
    child.on("exit", (code) => {
      console.log(label, "exit", code);
    });
  } catch (error) {
    console.log(label, "throw", error.code, error.message);
  }
}
run("cmd-ignore", "cmd.exe", ["/d","/s","/c","exit 0"], { stdio: "ignore", shell: false });
run("cmd-pipe", "cmd.exe", ["/d","/s","/c","exit 0"], { stdio: "pipe", shell: false });
'@
@"
$probe
"@ | node -

Write-Step "Driver Port 4444"
try {
  $portLines = netstat -ano | Select-String "4444"
  if ($portLines) {
    $portLines | ForEach-Object { Write-Host $_.Line }
  } else {
    Write-Host "No listener on port 4444."
  }
} catch {
  Write-Sub "EXCEPTION" $_.Exception.Message
}

if ($SessionProbe) {
  Invoke-WebDriverSessionProbe -AppPath $appPath -DriverPath $NativeDriverPath
} else {
  Write-Step "WebDriver Session Probe"
  Write-Sub "Status" "Ignorado (use -SessionProbe para habilitar)."
}

Write-Host ""
Write-Host "Diagnostico concluido." -ForegroundColor Green
