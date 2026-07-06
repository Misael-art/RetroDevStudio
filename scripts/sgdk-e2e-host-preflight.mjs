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

function isWindowsPlatform(hostPlatform = process.platform) {
  return hostPlatform === "win32";
}

function isHostExecutableCandidate(candidate, hostPlatform = process.platform) {
  if (isWindowsPlatform(hostPlatform)) {
    return true;
  }
  return path.extname(candidate).toLowerCase() !== ".exe";
}

function pathExtensions(hostPlatform = process.platform) {
  if (!isWindowsPlatform(hostPlatform)) {
    return [""];
  }

  const raw = process.env.PATHEXT ?? ".EXE;.CMD;.BAT";
  const extensions = raw
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return extensions.length > 0 ? extensions : [".exe", ".cmd", ".bat"];
}

export async function resolveExecutable(explicitPath, names, options = {}) {
  const hostPlatform = options.hostPlatform ?? process.platform;
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (isHostExecutableCandidate(resolved, hostPlatform) && (await pathExists(resolved))) return resolved;
  }
  const searchDirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), ".cargo", "bin"),
  ];
  const extensions = pathExtensions(hostPlatform);
  for (const directory of searchDirs) {
    for (const name of names) {
      const hasExtension = path.extname(name) !== "";
      const candidates = hasExtension ? [name] : extensions.map((extension) => `${name}${extension}`);
      for (const candidateName of candidates) {
        const candidate = path.join(directory, candidateName);
        if (isHostExecutableCandidate(candidate, hostPlatform) && (await pathExists(candidate))) {
          return candidate;
        }
      }
    }
  }
  return "";
}

async function resolveHostTool(names, hostPlatform) {
  return resolveExecutable("", names, { hostPlatform });
}

export async function resolveSgdkRoot(root, hostPlatform = process.platform) {
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
    const compilerPath = path.join(
      candidate,
      "bin",
      isWindowsPlatform(hostPlatform) ? "gcc.exe" : "m68k-elf-gcc"
    );
    const compilerInSgdk = await pathExists(compilerPath);
    const compilerFromPath = isWindowsPlatform(hostPlatform)
      ? ""
      : await resolveHostTool(["m68k-elf-gcc"], hostPlatform);
    const compiler = compilerInSgdk || Boolean(compilerFromPath);
    const gcc = isWindowsPlatform(hostPlatform)
      ? compiler
      : false;
    const make = isWindowsPlatform(hostPlatform)
      ? true
      : Boolean(await resolveHostTool(["make"], hostPlatform));
    const java = isWindowsPlatform(hostPlatform)
      ? true
      : Boolean(await resolveHostTool(["java"], hostPlatform));
    const makefileGen = await pathExists(path.join(candidate, "makefile.gen"));
    const ok = exists && compiler && make && java && makefileGen;
    const detail = {
      source,
      path: candidate,
      exists,
      gcc,
      compiler,
      compilerPath: compilerInSgdk ? compilerPath : compilerFromPath || null,
      make,
      java,
      makefileGen,
      ok,
    };
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
      compiler: false,
      compilerPath: null,
      make: false,
      java: false,
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
  const hostPlatform = options?.hostPlatform ?? process.platform;
  const sgdk = await resolveSgdkRoot(root, hostPlatform);
  const sgdkDir = sgdk.path;
  const sgdkDirExists = sgdk.exists;
  const sgdkGcc = sgdk.gcc;
  const sgdkMakefile = sgdk.makefileGen;
  const sgdkDirOk = sgdk.ok;
  let tauriDriverPath = "";
  let tauriDriverOk = Boolean(options?.externalDriver);
  if (!options?.externalDriver) {
    tauriDriverPath = await resolveExecutable(
      options?.tauriDriver ?? "",
      ["tauri-driver", "tauri-driver.exe"],
      { hostPlatform }
    );
    tauriDriverOk = Boolean(tauriDriverPath);
  }
  // Also search canonical toolchains/webdriver/ location
  const canonicalWebdriverDir = path.join(root, "toolchains", "webdriver");
  let nativeDriverPath = await resolveExecutable(
    options?.nativeDriver ?? "",
    ["msedgedriver", "msedgedriver.exe", "chromedriver"],
    { hostPlatform }
  );
  if (!nativeDriverPath) {
    const canonicalName = isWindowsPlatform(hostPlatform) ? "msedgedriver.exe" : "msedgedriver";
    const canonicalCandidate = path.join(canonicalWebdriverDir, canonicalName);
    if (isHostExecutableCandidate(canonicalCandidate, hostPlatform) && (await pathExists(canonicalCandidate))) {
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
        compiler: sgdk.compiler,
        compilerPath: sgdk.compilerPath,
        make: sgdk.make,
        java: sgdk.java,
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
      : isWindowsPlatform(hostPlatform)
        ? `INCOMPLETO (gcc.exe: ${sgdkGcc ? "OK" : "FALTA"}, makefile.gen: ${sgdkMakefile ? "OK" : "FALTA"})`
        : `INCOMPLETO (m68k-elf-gcc nativo: ${sgdk.compiler ? "OK" : "FALTA"}, make: ${sgdk.make ? "OK" : "FALTA"}, java: ${sgdk.java ? "OK" : "FALTA"}, makefile.gen: ${sgdkMakefile ? "OK" : "FALTA"})`;
  const lines = [
    "[RDS preflight host]",
    `  SGDK real: ${sgdkDetail}`,
    options?.externalDriver
      ? "  tauri-driver: omitido (externalDriver)"
      : `  tauri-driver: ${tauriDriverOk ? `OK (${tauriDriverPath})` : "FALTA — cargo install tauri-driver --locked"}`,
    `  WebDriver nativo: ${
      nativeDriverOk
        ? `OK (${nativeDriverPath})`
        : isWindowsPlatform(hostPlatform)
          ? "FALTA — baixe do Microsoft Edge WebDriver oficial e configure toolchains/webdriver/msedgedriver.exe, --native-driver, RDS_EDGE_DRIVER_PATH ou PATH"
          : "FALTA — configure msedgedriver ou chromedriver nativo em toolchains/webdriver/, --native-driver, RDS_EDGE_DRIVER_PATH ou PATH"
    }`,
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
