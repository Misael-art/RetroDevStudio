/**
 * Verificacao objetiva de dependencias de host para E2E desktop / SGDK (sem dependencias npm novas).
 * Saida: linhas legiveis em stderr+stdout e objeto JSON quando invocado com --json.
 */
import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
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

function classifyExecutableProbeFailure(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = String(error?.message ?? error ?? "");
  const normalized = `${code} ${message}`.toLowerCase();
  if (
    normalized.includes("controle de aplicativo") ||
    normalized.includes("application control") ||
    normalized.includes("blocked") ||
    normalized.includes("bloque") ||
    code === "UNKNOWN"
  ) {
    return "tauri_driver_blocked";
  }
  if (code === "ENOENT") {
    return "tauri_driver_missing";
  }
  return "tauri_driver_unusable";
}

export async function probeExecutable(command, args = ["--help"], timeoutMs = 15000) {
  if (!command) {
    return {
      ok: false,
      statusCode: "tauri_driver_missing",
      detail: "Caminho do executavel vazio.",
    };
  }

  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      try {
        child?.kill();
      } catch {
        // Best effort: the probe is diagnostic only.
      }
      finish({
        ok: false,
        statusCode: "tauri_driver_timeout",
        detail: `Execucao excedeu ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    try {
      child = spawn(command, args, {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({
        ok: false,
        statusCode: classifyExecutableProbeFailure(error),
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    child.on("error", (error) => {
      finish({
        ok: false,
        statusCode: classifyExecutableProbeFailure(error),
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        finish({ ok: true, statusCode: null, detail: "" });
        return;
      }
      finish({
        ok: false,
        statusCode: "tauri_driver_unusable",
        detail: signal ? `Processo terminou por sinal ${signal}.` : `Processo saiu com codigo ${code}.`,
      });
    });
  });
}

export function buildTauriDriverCheck({ externalDriver, tauriDriverPath, executableProbe }) {
  if (externalDriver) {
    return {
      ok: true,
      exists: true,
      executable: null,
      statusCode: null,
      detail: "Driver externo informado pelo usuario.",
    };
  }
  if (!tauriDriverPath) {
    return {
      ok: false,
      exists: false,
      executable: false,
      statusCode: "tauri_driver_missing",
      detail: "tauri-driver nao encontrado no PATH nem em ~/.cargo/bin.",
    };
  }
  if (!executableProbe?.ok) {
    return {
      ok: false,
      exists: true,
      executable: false,
      statusCode: executableProbe?.statusCode ?? "tauri_driver_unusable",
      detail: executableProbe?.detail ?? "tauri-driver encontrado, mas nao executou.",
    };
  }
  return {
    ok: true,
    exists: true,
    executable: true,
    statusCode: null,
    detail: "",
  };
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
  let tauriDriverProbe = null;
  if (!options?.externalDriver) {
    tauriDriverPath = await resolveExecutable(options?.tauriDriver ?? "", [
      "tauri-driver",
      "tauri-driver.exe",
    ]);
    if (tauriDriverPath) {
      tauriDriverProbe = await probeExecutable(tauriDriverPath, ["--help"]);
    }
  }
  const tauriDriverCheck = buildTauriDriverCheck({
    externalDriver: Boolean(options?.externalDriver),
    tauriDriverPath,
    executableProbe: tauriDriverProbe,
  });
  const tauriDriverOk = tauriDriverCheck.ok;
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
  if (!tauriDriverOk) blockingStatusCodes.push(tauriDriverCheck.statusCode ?? "tauri_driver_unusable");
  if (!nativeDriverOk) blockingStatusCodes.push("webdriver_missing");
  const record = {
    repoRoot: root,
    sgdkDir,
    sgdkDirSource: sgdk.source,
    sgdkDirOk,
    tauriDriverOk,
    tauriDriverPath: tauriDriverPath || null,
    tauriDriverExecutableOk: tauriDriverCheck.executable,
    tauriDriverStatusCode: tauriDriverCheck.statusCode,
    tauriDriverDetail: tauriDriverCheck.detail,
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
        exists: tauriDriverCheck.exists,
        executable: tauriDriverCheck.executable,
        statusCode: tauriDriverCheck.statusCode,
        detail: tauriDriverCheck.detail,
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
  const tauriDriverDetail = (() => {
    if (options?.externalDriver) {
      return "omitido (externalDriver)";
    }
    if (!tauriDriverPath) {
      return "FALTA — cargo install tauri-driver --locked";
    }
    if (!tauriDriverOk) {
      const action =
        tauriDriverCheck.statusCode === "tauri_driver_blocked"
          ? "desbloqueie/allowlist o binario ou use um runner Windows institucional"
          : "reinstale com cargo install tauri-driver --locked";
      return `BLOQUEADO — ${tauriDriverCheck.detail} Proxima acao: ${action}.`;
    }
    return `OK (${tauriDriverPath})`;
  })();

  const lines = [
    "[RDS preflight host]",
    `  SGDK real: ${sgdkDetail}`,
    `  tauri-driver: ${tauriDriverDetail}`,
    `  Edge WebDriver (msedgedriver): ${
      nativeDriverOk
        ? `OK (${nativeDriverPath})`
        : "FALTA — baixe do Microsoft Edge WebDriver oficial e configure toolchains/webdriver/msedgedriver.exe, --native-driver, RDS_EDGE_DRIVER_PATH ou PATH"
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
