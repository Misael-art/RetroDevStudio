#!/usr/bin/env node
/**
 * build.mjs - Script unificado de compilacao do RetroDev Studio
 * Gera MSI, EXE Debug e EXE Portable conforme docs/08_TREE_ARCHITECTURE.md
 *
 * Uso: node scripts/build.mjs <debug|msi|portable|all>
 *
 * Modos:
 *   debug    - EXE debug (target-test/debug/retro-dev-studio.exe)
 *   msi      - Instalador MSI (target-test/release/bundle/msi/*.msi)
 *   portable - EXE release sem bundle (target-test/release/retro-dev-studio.exe)
 *   all      - Executa debug, msi e portable em sequencia
 *
 * Respeita CARGO_TARGET_DIR se definido (hosts com AppLocker).
 * Cross-platform (Node.js).
 */

import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access, readdir, rm } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const VALID_MODES = ["debug", "msi", "portable", "all"];
const TARGET_DIR = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "src-tauri", "target-test");
const DEBUG_EXE = path.join(TARGET_DIR, "debug", "retro-dev-studio.exe");
const RELEASE_EXE = path.join(TARGET_DIR, "release", "retro-dev-studio.exe");
const MSI_DIR = path.join(TARGET_DIR, "release", "bundle", "msi");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
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

async function removeIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return;
  }

  await rm(filePath, { force: true, recursive: false });
}

async function cleanupExpectedArtifacts(mode) {
  const modesToClean = mode === "all" ? ["debug", "msi", "portable"] : [mode];

  if (modesToClean.includes("debug")) {
    await removeIfExists(DEBUG_EXE);
  }

  if (modesToClean.includes("portable")) {
    await removeIfExists(RELEASE_EXE);
  }

  if (modesToClean.includes("msi")) {
    try {
      const entries = await readdir(MSI_DIR);
      await Promise.all(
        entries
          .filter((entry) => entry.endsWith(".msi"))
          .map((entry) => removeIfExists(path.join(MSI_DIR, entry)))
      );
    } catch {
      // Directory is created lazily by Tauri when bundling.
    }
  }
}

async function runTauriBuild(mode) {
  const tauriArgs = ["run", "tauri", "build", "--"];
  switch (mode) {
    case "debug":
      tauriArgs.push("--debug", "--no-bundle");
      break;
    case "msi":
      // release + bundle (targets msi em tauri.conf.json)
      break;
    case "portable":
      tauriArgs.push("--no-bundle");
      break;
    default:
      throw new Error(`Modo invalido: ${mode}`);
  }
  console.log(`\n[Build] Compilando Tauri (modo: ${mode})...\n`);
  await spawnLogged(npmCommand(), tauriArgs);
}

async function findMsiFile() {
  try {
    const entries = await readdir(MSI_DIR);
    const msi = entries.find((e) => e.endsWith(".msi"));
    return msi ? path.join(MSI_DIR, msi) : null;
  } catch {
    return null;
  }
}

async function reportArtifacts(mode, artifacts) {
  console.log("\n============================================================");
  console.log("  Artefatos gerados:");
  console.log("============================================================");
  for (const [label, filePath] of artifacts) {
    const exists = await pathExists(filePath);
    const status = exists ? " [OK]" : " [nao encontrado]";
    console.log(`  ${label}: ${filePath}${status}`);
  }
  console.log("============================================================\n");
}

async function assertArtifactsGenerated(artifacts) {
  const missing = [];

  for (const [label, filePath] of artifacts) {
    if (filePath.includes("*") || !(await pathExists(filePath))) {
      missing.push(`${label}: ${filePath}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Compilacao concluida sem os artefatos esperados:\n- ${missing.join("\n- ")}`
    );
  }
}

async function main() {
  const mode = process.argv[2]?.toLowerCase();
  if (!mode || !VALID_MODES.includes(mode)) {
    console.error("Uso: node scripts/build.mjs <debug|msi|portable|all>");
    console.error("  debug    - EXE debug");
    console.error("  msi      - Instalador MSI");
    console.error("  portable - EXE release sem bundle");
    console.error("  all      - Todos os artefatos");
    process.exit(1);
  }

  console.log("RetroDev Studio - Script Unificado de Compilacao");
  console.log(`Modo: ${mode}`);
  console.log(`Target dir: ${TARGET_DIR}`);

  try {
    const modesToRun = mode === "all" ? ["debug", "msi", "portable"] : [mode];
    console.log("\n[Prep] Limpando artefatos esperados antes da compilacao...\n");
    await cleanupExpectedArtifacts(mode);

    for (const m of modesToRun) {
      await runTauriBuild(m);
    }

    const artifacts = [];
    if (mode === "all" || mode === "debug") {
      artifacts.push(["EXE Debug", DEBUG_EXE]);
    }
    if (mode === "all" || mode === "msi") {
      const msiPath = await findMsiFile();
      artifacts.push(["MSI", msiPath ?? path.join(MSI_DIR, "*.msi")]);
    }
    if (mode === "all" || mode === "portable") {
      artifacts.push(["EXE Portable", RELEASE_EXE]);
    }

    await reportArtifacts(mode, artifacts);
    await assertArtifactsGenerated(artifacts);
    process.exit(0);
  } catch (error) {
    console.error("\n[ERRO]", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
