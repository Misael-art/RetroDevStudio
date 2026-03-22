#!/usr/bin/env node
/**
 * build.mjs - Script unificado de compilacao do RetroDev Studio
 * Gera MSI, EXE Debug e EXE Portable conforme docs/08_TREE_ARCHITECTURE.md
 *
 * Uso: node scripts/build.mjs <debug|msi|portable|all>
 *
 * Modos:
 *   debug    - EXE debug staged em target-test/debug/retro-dev-studio.exe
 *   msi      - Instalador MSI staged em target-test/release/bundle/msi/*.msi
 *   portable - EXE release staged em target-test/release/retro-dev-studio.exe
 *   all      - Executa debug, msi e portable em sequencia
 *
 * Separa o target bruto em target-test/dev, relatorios em target-test/validation
 * e artefatos canonicos em target-test/debug + target-test/release.
 * Respeita CARGO_TARGET_DIR se definido (hosts com AppLocker).
 * Cross-platform (Node.js).
 */

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const VALID_MODES = ["debug", "msi", "portable", "all"];
const CANONICAL_TARGET_DIR = path.join(repoRoot, "src-tauri", "target-test");
const DEV_WORK_TARGET_DIR = path.join(CANONICAL_TARGET_DIR, "dev", "cargo-target");
const VALIDATION_DIR = path.join(CANONICAL_TARGET_DIR, "validation");
const REQUESTED_TARGET_DIR = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : DEV_WORK_TARGET_DIR;
const SHADOW_TARGET_DIR = path.resolve(
  process.env.RDS_SHADOW_TARGET_DIR ??
    path.join(
      process.env.LOCALAPPDATA ?? os.tmpdir(),
      "RetroDevStudio",
      "cargo-target-shadow"
    )
);
const BUILD_REPORT_PATH = path.join(VALIDATION_DIR, "build-report.json");
const LEGACY_BUILD_REPORT_PATH = path.join(CANONICAL_TARGET_DIR, "build-report.json");
const DEBUG_EXE = path.join(CANONICAL_TARGET_DIR, "debug", "retro-dev-studio.exe");
const RELEASE_EXE = path.join(CANONICAL_TARGET_DIR, "release", "retro-dev-studio.exe");
const MSI_DIR = path.join(CANONICAL_TARGET_DIR, "release", "bundle", "msi");
const LEGACY_ROOT_ARTIFACTS = [
  ".rustc_info.json",
  "build-report.json",
  ".cargo-lock",
  ".fingerprint",
  "build",
  "deps",
  "examples",
  "incremental",
  "app_lib.d",
  "app_lib.dll",
  "app_lib.dll.exp",
  "app_lib.dll.lib",
  "app_lib.lib",
  "app_lib.pdb",
  "libapp_lib.d",
  "libapp_lib.rlib",
  "retro-dev-studio.d",
  "retro-dev-studio.exe",
  "retro_dev_studio.pdb",
  "resources",
];

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function profileForMode(mode) {
  return mode === "debug" ? "debug" : "release";
}

function runtimeFilesForProfile(profile) {
  const files = ["retro-dev-studio.exe", "app_lib.dll", "app_lib.pdb", "retro_dev_studio.pdb"];
  const directories = ["resources"];
  if (profile === "release") {
    directories.push("bundle");
  }
  return { files, directories };
}

function shouldSkipOpenDir() {
  return process.env.CI === "true" || process.env.CI === "1";
}

function samePath(leftPath, rightPath) {
  return path.resolve(leftPath) === path.resolve(rightPath);
}

function driveRoot(candidatePath) {
  return path.parse(path.resolve(candidatePath)).root.toLowerCase();
}

function systemDriveRoot() {
  return driveRoot(process.env.SystemDrive ?? path.parse(os.homedir()).root);
}

function shouldPreemptivelyUseShadowTarget(targetDir, mode) {
  if (process.platform !== "win32") {
    return false;
  }

  if (process.env.CARGO_TARGET_DIR || process.env.RDS_DISABLE_SHADOW_TARGET === "1") {
    return false;
  }

  return driveRoot(targetDir) !== systemDriveRoot();
}

function normalizeMode(mode) {
  return mode === "all" ? ["debug", "msi", "portable"] : [mode];
}

function buildReportTemplate() {
  return {
    generatedAt: new Date().toISOString(),
    canonicalTargetDir: CANONICAL_TARGET_DIR,
    devWorkTargetDir: DEV_WORK_TARGET_DIR,
    validationDir: VALIDATION_DIR,
    requestedTargetDir: REQUESTED_TARGET_DIR,
    shadowTargetDir: SHADOW_TARGET_DIR,
    modes: {},
  };
}

async function readExistingBuildReport() {
  if (!(await pathExists(BUILD_REPORT_PATH))) {
    return null;
  }

  try {
    const raw = await readFile(BUILD_REPORT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function spawnLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const useCmdShim = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
    const child = spawn(
      useCmdShim ? "cmd.exe" : command,
      useCmdShim ? ["/d", "/s", "/c", command, ...args] : args,
      {
        cwd: repoRoot,
        stdio: "inherit",
        shell: false,
        env: process.env,
        ...options,
      }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Comando falhou (exit ${code}): ${command} ${args.join(" ")}`));
      }
    });
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function resolveExecutable(expectedPath) {
  if (await pathExists(expectedPath)) {
    return expectedPath;
  }

  const parentDir = path.dirname(expectedPath);
  const preferredName = path.basename(expectedPath).toLowerCase();

  try {
    const entries = await readdir(parentDir);
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.toLowerCase().endsWith(".exe"))
        .map(async (entry) => {
          const fullPath = path.join(parentDir, entry);
          const metadata = await stat(fullPath);
          return {
            fullPath,
            fileName: entry.toLowerCase(),
            mtimeMs: metadata.mtimeMs,
          };
        })
    );

    candidates.sort((left, right) => {
      const leftPreferred = left.fileName === preferredName ? 1 : 0;
      const rightPreferred = right.fileName === preferredName ? 1 : 0;
      if (leftPreferred !== rightPreferred) {
        return rightPreferred - leftPreferred;
      }
      return right.mtimeMs - left.mtimeMs;
    });

    return candidates[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

async function findLatestFile(directoryPath, extension) {
  try {
    const entries = await readdir(directoryPath);
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.toLowerCase().endsWith(extension))
        .map(async (entry) => {
          const fullPath = path.join(directoryPath, entry);
          const metadata = await stat(fullPath);
          return {
            fullPath,
            mtimeMs: metadata.mtimeMs,
          };
        })
    );
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return candidates[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

async function findMsiFile(baseTargetDir = CANONICAL_TARGET_DIR) {
  return findLatestFile(path.join(baseTargetDir, "release", "bundle", "msi"), ".msi");
}

async function loadLibraryProbe(dllPath) {
  if (process.platform !== "win32") {
    return 0;
  }

  const probeScript = `
    $signature = @'
using System;
using System.Runtime.InteropServices;
public static class NativeLoader {
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr LoadLibrary(string lpFileName);
}
'@;
    Add-Type -TypeDefinition $signature | Out-Null;
    $candidate = [Environment]::GetEnvironmentVariable('RDS_PROBE_DLL');
    $handle = [NativeLoader]::LoadLibrary($candidate);
    if ($handle -eq [IntPtr]::Zero) {
      Write-Output ([Runtime.InteropServices.Marshal]::GetLastWin32Error());
    } else {
      Write-Output '0';
    }
  `;

  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Command", probeScript],
      {
        cwd: repoRoot,
        shell: false,
        env: { ...process.env, RDS_PROBE_DLL: dllPath },
        stdio: ["ignore", "pipe", "ignore"],
      }
    );

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(Number.NaN));
    child.on("exit", () => {
      const parsed = Number.parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(parsed) ? parsed : Number.NaN);
    });
  });
}

async function detectBlockedDll(targetDir, profile) {
  if (process.platform !== "win32") {
    return null;
  }

  const depsDir = path.join(targetDir, profile, "deps");
  try {
    const entries = await readdir(depsDir);
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.toLowerCase().endsWith(".dll"))
        .map(async (entry) => {
          const fullPath = path.join(depsDir, entry);
          const metadata = await stat(fullPath);
          return {
            fullPath,
            mtimeMs: metadata.mtimeMs,
          };
        })
    );

    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const candidate of candidates.slice(0, 24)) {
      const errorCode = await loadLibraryProbe(candidate.fullPath);
      if (errorCode === 4551) {
        return candidate.fullPath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function copyPathIfExists(sourcePath, destinationPath) {
  if (!(await pathExists(sourcePath))) {
    return false;
  }

  const sourceStats = await stat(sourcePath);
  if (sourceStats.isDirectory()) {
    await rm(destinationPath, { recursive: true, force: true });
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { recursive: true, force: true });
    return true;
  }

  await ensureParentDir(destinationPath);
  await copyFile(sourcePath, destinationPath);
  return true;
}

async function cleanCanonicalProfileDir(profile, preservedNames = []) {
  const profileDir = path.join(CANONICAL_TARGET_DIR, profile);
  await mkdir(profileDir, { recursive: true });
  const preserved = new Set(preservedNames.map((name) => name.toLowerCase()));

  try {
    const entries = await readdir(profileDir);
    await Promise.all(
      entries
        .filter((entry) => !preserved.has(entry.toLowerCase()))
        .map((entry) => rm(path.join(profileDir, entry), { recursive: true, force: true }))
    );
  } catch {
    // The profile directory is created lazily during staging.
  }
}

async function ensureOperationalLayout() {
  await mkdir(CANONICAL_TARGET_DIR, { recursive: true });
  await mkdir(DEV_WORK_TARGET_DIR, { recursive: true });
  await mkdir(VALIDATION_DIR, { recursive: true });
  await mkdir(path.dirname(DEBUG_EXE), { recursive: true });
  await mkdir(path.dirname(RELEASE_EXE), { recursive: true });
}

async function pruneLegacyRootArtifacts() {
  await Promise.all(
    LEGACY_ROOT_ARTIFACTS.map((name) =>
      rm(path.join(CANONICAL_TARGET_DIR, name), { recursive: true, force: true })
    )
  );
}

async function resetDormantDevWorkTarget(buildResults) {
  if (buildResults.length === 0) {
    return;
  }

  const allModesUsedShadow = buildResults.every((result) =>
    samePath(result.effectiveTargetDir, SHADOW_TARGET_DIR)
  );

  if (!allModesUsedShadow) {
    return;
  }

  await rm(DEV_WORK_TARGET_DIR, { recursive: true, force: true });
  await mkdir(DEV_WORK_TARGET_DIR, { recursive: true });
}

async function stageArtifactsForMode(mode, effectiveTargetDir) {
  const profile = profileForMode(mode);
  const actualProfileDir = path.join(effectiveTargetDir, profile);
  const canonicalProfileDir = path.join(CANONICAL_TARGET_DIR, profile);
  if (samePath(actualProfileDir, canonicalProfileDir)) {
    return;
  }
  const preservedNames = mode === "portable" && profile === "release" ? ["bundle"] : [];
  await cleanCanonicalProfileDir(profile, preservedNames);

  const { files, directories } = runtimeFilesForProfile(profile);
  for (const fileName of files) {
    await copyPathIfExists(
      path.join(actualProfileDir, fileName),
      path.join(canonicalProfileDir, fileName)
    );
  }

  for (const directoryName of directories) {
    if (directoryName === "bundle" && mode === "portable") {
      continue;
    }
    await copyPathIfExists(
      path.join(actualProfileDir, directoryName),
      path.join(canonicalProfileDir, directoryName)
    );
  }
}

async function runTauriBuild(mode, effectiveTargetDir) {
  const tauriArgs = ["run", "tauri", "build", "--"];
  switch (mode) {
    case "debug":
      tauriArgs.push("--debug", "--no-bundle");
      break;
    case "msi":
      break;
    case "portable":
      tauriArgs.push("--no-bundle");
      break;
    default:
      throw new Error(`Modo invalido: ${mode}`);
  }

  console.log(`\n[Build] Compilando Tauri (modo: ${mode})...\n`);
  console.log(`[Build] Cargo target efetivo: ${effectiveTargetDir}`);
  await spawnLogged(npmCommand(), tauriArgs, {
    env: { ...process.env, CARGO_TARGET_DIR: effectiveTargetDir },
  });
}

async function buildModeWithFallback(mode) {
  const profile = profileForMode(mode);
  const firstTarget = REQUESTED_TARGET_DIR;
  const useShadowPreemptively = shouldPreemptivelyUseShadowTarget(firstTarget, mode);
  const initialTarget = useShadowPreemptively ? SHADOW_TARGET_DIR : firstTarget;

  if (useShadowPreemptively) {
    console.log(
      `\n[Prep] Target solicitado em ${firstTarget} fica fora do drive do sistema (${systemDriveRoot()}).`
    );
    console.log(`[Prep] Usando shadow target preventivo em ${SHADOW_TARGET_DIR} para evitar bloqueios de policy.\n`);
  }

  try {
    await runTauriBuild(mode, initialTarget);
    await stageArtifactsForMode(mode, initialTarget);
    return {
      mode,
      profile,
      effectiveTargetDir: initialTarget,
      usedShadowFallback: path.resolve(initialTarget) === path.resolve(SHADOW_TARGET_DIR),
      blockedDll: null,
    };
  } catch (firstError) {
    if (
      process.platform !== "win32" ||
      path.resolve(initialTarget) === path.resolve(SHADOW_TARGET_DIR)
    ) {
      throw firstError;
    }

    const blockedDll = await detectBlockedDll(firstTarget, profile);
    if (!blockedDll) {
      throw firstError;
    }

    console.log("\n[Retry] Build bloqueado por politica de AppLocker no target do repositorio.");
    console.log(`[Retry] DLL bloqueada detectada: ${blockedDll}`);
    console.log(`[Retry] Reexecutando no shadow target permitido: ${SHADOW_TARGET_DIR}\n`);

    await runTauriBuild(mode, SHADOW_TARGET_DIR);
    await stageArtifactsForMode(mode, SHADOW_TARGET_DIR);
    return {
      mode,
      profile,
      effectiveTargetDir: SHADOW_TARGET_DIR,
      usedShadowFallback: true,
      blockedDll,
    };
  }
}

async function writeBuildReport(buildResults) {
  const existingReport = await readExistingBuildReport();
  const report = {
    ...existingReport,
    ...buildReportTemplate(),
    modes: {
      ...(existingReport?.modes ?? {}),
    },
  };
  for (const result of buildResults) {
    const canonicalProfileDir = path.join(CANONICAL_TARGET_DIR, result.profile);
    report.modes[result.mode] = {
      profile: result.profile,
      effectiveTargetDir: result.effectiveTargetDir,
      usedShadowFallback: result.usedShadowFallback,
      blockedDll: result.blockedDll,
      canonicalExe:
        result.profile === "debug"
          ? path.join(canonicalProfileDir, "retro-dev-studio.exe")
          : path.join(canonicalProfileDir, "retro-dev-studio.exe"),
      canonicalMsiDir:
        result.profile === "release"
          ? path.join(canonicalProfileDir, "bundle", "msi")
          : null,
    };
  }

  await mkdir(VALIDATION_DIR, { recursive: true });
  await writeFile(BUILD_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (BUILD_REPORT_PATH !== LEGACY_BUILD_REPORT_PATH) {
    await rm(LEGACY_BUILD_REPORT_PATH, { force: true });
  }
}

async function openDirectory(dirPath) {
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  await spawnLogged(command, [dirPath], { stdio: "ignore", detached: false });
}

async function maybeOpenArtifactDirectories(artifacts, openDirEnabled) {
  if (!openDirEnabled) {
    if (!shouldSkipOpenDir()) {
      console.log("[Hint] Use --open-dir para abrir a pasta do binario ao final do build.");
    }
    return;
  }

  if (shouldSkipOpenDir()) {
    console.log("[OpenDir] Ignorado em ambiente CI.");
    return;
  }

  const directories = [
    ...new Set(
      artifacts
        .map(([, filePath]) => filePath)
        .filter((filePath) => filePath && !filePath.includes("*"))
        .map((filePath) => path.dirname(filePath))
    ),
  ];

  for (const directory of directories) {
    console.log(`[OpenDir] Abrindo pasta do artefato: ${directory}`);
    await openDirectory(directory);
  }
}

async function reportArtifacts(artifacts, buildResults) {
  console.log("\n============================================================");
  console.log("  Artefatos gerados:");
  console.log("============================================================");
  for (const [label, filePath] of artifacts) {
    const exists = await pathExists(filePath);
    const status = exists ? " [OK]" : " [nao encontrado]";
    console.log(`  ${label}: ${filePath}${status}`);
  }
  const fallbackModes = buildResults.filter((result) => result.usedShadowFallback);
  if (fallbackModes.length > 0) {
    console.log("------------------------------------------------------------");
    for (const result of fallbackModes) {
      console.log(
        `  ${result.mode}: shadow target ${result.effectiveTargetDir} -> staging canonico em ${CANONICAL_TARGET_DIR}`
      );
    }
  }
  console.log(`  Dev work target: ${REQUESTED_TARGET_DIR}`);
  console.log(`  Validation dir: ${VALIDATION_DIR}`);
  console.log(`  Build report: ${BUILD_REPORT_PATH}`);
  console.log("============================================================\n");
}

async function assertArtifactsGenerated(artifacts, buildStartedAt) {
  const missing = [];

  for (const [label, filePath] of artifacts) {
    if (filePath.includes("*") || !(await pathExists(filePath))) {
      missing.push(`${label}: ${filePath}`);
      continue;
    }

    const metadata = await stat(filePath);
    if (metadata.mtimeMs + 1000 < buildStartedAt) {
      missing.push(`${label}: ${filePath} (artefato nao foi atualizado nesta execucao)`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Compilacao concluida sem os artefatos esperados:\n- ${missing.join("\n- ")}`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find((arg) => !arg.startsWith("-"))?.toLowerCase();
  const openDirEnabled = args.includes("--open-dir");
  if (!mode || !VALID_MODES.includes(mode)) {
    console.error("Uso: node scripts/build.mjs <debug|msi|portable|all> [--open-dir]");
    console.error("  debug    - EXE debug");
    console.error("  msi      - Instalador MSI");
    console.error("  portable - EXE release sem bundle");
    console.error("  all      - Todos os artefatos");
    console.error("  --open-dir - Abre a pasta do artefato ao final do build local");
    process.exit(1);
  }

  console.log("RetroDev Studio - Script Unificado de Compilacao");
  console.log(`Modo: ${mode}`);
  console.log(`Target dir canonico: ${CANONICAL_TARGET_DIR}`);
  console.log(`Target dir dev bruto: ${REQUESTED_TARGET_DIR}`);
  console.log(`Target dir validation: ${VALIDATION_DIR}`);
  if (process.platform === "win32") {
    console.log(`Shadow target fallback: ${SHADOW_TARGET_DIR}`);
  }

  try {
    await ensureOperationalLayout();
    await pruneLegacyRootArtifacts();
    const modesToRun = normalizeMode(mode);
    const buildStartedAt = Date.now();
    const buildResults = [];
    console.log("\n[Prep] Mantendo artefatos anteriores e validando atualizacao por timestamp.\n");

    for (const singleMode of modesToRun) {
      buildResults.push(await buildModeWithFallback(singleMode));
    }

    await resetDormantDevWorkTarget(buildResults);
    await writeBuildReport(buildResults);

    const artifacts = [];
    if (mode === "all" || mode === "debug") {
      const debugExe = (await resolveExecutable(DEBUG_EXE)) ?? DEBUG_EXE;
      artifacts.push(["EXE Debug", debugExe]);
    }
    if (mode === "all" || mode === "msi") {
      const msiPath = await findMsiFile(CANONICAL_TARGET_DIR);
      artifacts.push(["MSI", msiPath ?? path.join(MSI_DIR, "*.msi")]);
    }
    if (mode === "all" || mode === "portable") {
      const releaseExe = (await resolveExecutable(RELEASE_EXE)) ?? RELEASE_EXE;
      artifacts.push(["EXE Portable", releaseExe]);
    }

    await reportArtifacts(artifacts, buildResults);
    await assertArtifactsGenerated(artifacts, buildStartedAt);
    await maybeOpenArtifactDirectories(artifacts, openDirEnabled);
    process.exit(0);
  } catch (error) {
    console.error("\n[ERRO]", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
