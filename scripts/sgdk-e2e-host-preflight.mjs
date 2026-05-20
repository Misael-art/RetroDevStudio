#!/usr/bin/env node
/**
 * Verificacao objetiva de dependencias de host para E2E desktop / SGDK (sem dependencias npm novas).
 * Saida: linhas legiveis em stderr+stdout e objeto JSON quando invocado com --json.
 */
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

async function pathExists(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathExtensions() {
  const raw = process.env.PATHEXT ?? ".EXE;.CMD;.BAT";
  const extensions = raw
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return extensions.length > 0 ? extensions : [".exe", ".cmd", ".bat"];
}

async function resolveExecutable(explicitPath, names) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (await pathExists(resolved)) return resolved;
  }
  const searchDirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), ".cargo", "bin"),
  ];
  const extensions = pathExtensions();
  for (const directory of searchDirs) {
    for (const name of names) {
      const hasExtension = path.extname(name) !== "";
      const candidates = hasExtension ? [name] : extensions.map((extension) => `${name}${extension}`);
      for (const candidateName of candidates) {
        const candidate = path.join(directory, candidateName);
        if (await pathExists(candidate)) {
          return candidate;
        }
      }
    }
  }
  return "";
}

async function resolveSgdkRoot(root) {
  const candidates = [
    ["SGDK_ROOT", process.env.SGDK_ROOT ?? ""],
    ["GDK", process.env.GDK ?? ""],
    ["GDK_WIN", process.env.GDK_WIN ?? ""],
    ["toolchains/sgdk", path.join(root, "toolchains", "sgdk")],
  ].filter(([, candidate]) => candidate);

  let firstExisting = null;
  for (const [source, rawCandidate] of candidates) {
    const candidate = path.resolve(rawCandidate);
    const exists = await pathExists(candidate);
    const gcc = await pathExists(path.join(candidate, "bin", "gcc.exe"));
    const makefileGen = await pathExists(path.join(candidate, "makefile.gen"));
    const ok = exists && gcc && makefileGen;
    const detail = { source, path: candidate, exists, gcc, makefileGen, ok };
    if (!firstExisting && exists) {
      firstExisting = detail;
    }
    if (ok) {
      return detail;
    }
  }

  return (
    firstExisting ?? {
      source: "toolchains/sgdk",
      path: path.join(root, "toolchains", "sgdk"),
      exists: false,
      gcc: false,
      makefileGen: false,
      ok: false,
    }
  );
}

/**
 * @param {object} options
 * @param {boolean} [options.externalDriver]
 * @param {string} [options.tauriDriver]
 * @param {string} [options.nativeDriver]
 * @param {string} [root]
 */
export async function logPreflightSummary(options, root = repoRoot) {
  const sgdk = await resolveSgdkRoot(root);
  const sgdkDir = sgdk.path;
  const sgdkDirExists = sgdk.exists;
  const sgdkGcc = sgdk.gcc;
  const sgdkMakefile = sgdk.makefileGen;
  const sgdkDirOk = sgdk.ok;
  let tauriDriverPath = "";
  let tauriDriverOk = Boolean(options?.externalDriver);
  if (!options?.externalDriver) {
    tauriDriverPath = await resolveExecutable(options?.tauriDriver ?? "", [
      "tauri-driver",
      "tauri-driver.exe",
    ]);
    tauriDriverOk = Boolean(tauriDriverPath);
  }
  // Also search canonical toolchains/webdriver/ location
  const canonicalWebdriverDir = path.join(root, "toolchains", "webdriver");
  let nativeDriverPath = await resolveExecutable(options?.nativeDriver ?? "", ["msedgedriver.exe"]);
  if (!nativeDriverPath) {
    const canonicalCandidate = path.join(canonicalWebdriverDir, "msedgedriver.exe");
    if (await pathExists(canonicalCandidate)) {
      nativeDriverPath = canonicalCandidate;
    }
  }
  const nativeDriverOk = Boolean(nativeDriverPath);

  const allReady = sgdkDirOk && tauriDriverOk && nativeDriverOk;
  const blockingStatusCodes = [];
  if (!sgdkDirOk) blockingStatusCodes.push("toolchain_missing");
  if (!tauriDriverOk) blockingStatusCodes.push("tauri_driver_missing");
  if (!nativeDriverOk) blockingStatusCodes.push("webdriver_missing");
  const record = {
    repoRoot: root,
    sgdkDir,
    sgdkDirSource: sgdk.source,
    sgdkDirOk,
    tauriDriverOk,
    tauriDriverPath: tauriDriverPath || null,
    nativeDriverOk,
    nativeDriverPath: nativeDriverPath || null,
    externalDriver: Boolean(options?.externalDriver),
    ready: allReady,
    blocking_status_codes: blockingStatusCodes,
    checks: {
      sgdk: {
        exists: sgdkDirExists,
        gcc: sgdkGcc,
        makefileGen: sgdkMakefile,
        source: sgdk.source,
      },
      tauriDriver: {
        ok: tauriDriverOk,
        externalDriver: Boolean(options?.externalDriver),
      },
      webdriver: {
        ok: nativeDriverOk,
      },
    },
  };

  const sgdkDetail = sgdkDirOk
    ? `OK (${sgdkDir} via ${sgdk.source})`
    : !sgdkDirExists
      ? "FALTA — configure SGDK_ROOT/GDK/GDK_WIN ou copie/instale SGDK para toolchains/sgdk"
      : `INCOMPLETO (gcc: ${sgdkGcc ? "OK" : "FALTA"}, makefile.gen: ${sgdkMakefile ? "OK" : "FALTA"})`;
  const lines = [
    "[RDS preflight host]",
    `  SGDK real: ${sgdkDetail}`,
    options?.externalDriver
      ? "  tauri-driver: omitido (externalDriver)"
      : `  tauri-driver: ${tauriDriverOk ? `OK (${tauriDriverPath})` : "FALTA — cargo install tauri-driver --locked"}`,
    `  Edge WebDriver (msedgedriver): ${nativeDriverOk ? `OK (${nativeDriverPath})` : "FALTA — --native-driver ou RDS_EDGE_DRIVER_PATH"}`,
    `  Ready: ${allReady ? "SIM" : "NAO"}`,
  ];
  console.log(lines.join("\n"));
  return record;
}

const ranAsCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url));

if (ranAsCli) {
  const wantJson = process.argv.includes("--json");
  const bare = {
    externalDriver: false,
    tauriDriver: process.env.TAURI_DRIVER_PATH ?? "",
    nativeDriver: process.env.RDS_EDGE_DRIVER_PATH ?? "",
  };
  logPreflightSummary(bare)
    .then((record) => {
      if (wantJson) {
        console.log(JSON.stringify(record, null, 2));
      }
      if (!record.ready) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
