#!/usr/bin/env node
/**
 * release-readiness.mjs
 *
 * Agrega o estado operacional necessario para promover o RC a beta/producao
 * sem depender de memoria humana. Gera relatorios JSON + Markdown em
 * src-tauri/target-test/validation/.
 *
 * Uso:
 *   node scripts/release-readiness.mjs
 *   node scripts/release-readiness.mjs --run-baseline
 *   node scripts/release-readiness.mjs --run-build portable --run-upstream
 *   node scripts/release-readiness.mjs --run-desktop-e2e --manual-qa-json path.json
 *   node scripts/release-readiness.mjs --strict
 */

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const CANONICAL_TARGET_DIR = path.join(repoRoot, "src-tauri", "target-test");
const VALIDATION_DIR = path.join(CANONICAL_TARGET_DIR, "validation");
const BUILD_REPORT_PATH = path.join(VALIDATION_DIR, "build-report.json");
const UPSTREAM_REPORT_PATH = path.join(VALIDATION_DIR, "upstream-validation.json");
const READINESS_JSON_PATH = path.join(VALIDATION_DIR, "release-readiness.json");
const READINESS_MD_PATH = path.join(VALIDATION_DIR, "release-readiness.md");
const DEBUG_EXE_PATH = path.join(CANONICAL_TARGET_DIR, "debug", "retro-dev-studio.exe");
const RELEASE_EXE_PATH = path.join(CANONICAL_TARGET_DIR, "release", "retro-dev-studio.exe");
const MSI_DIR = path.join(CANONICAL_TARGET_DIR, "release", "bundle", "msi");
const WEBDRIVER_PATH = path.join(
  repoRoot,
  "toolchains",
  "webdriver",
  "msedgedriver.exe"
);
const QA_DOC_PATH = path.join(repoRoot, "docs", "10_QA_ROTEIRO_RC.md");
const DEFAULT_CARGO_TARGET_DIR =
  process.platform === "win32"
    ? path.join(
        process.env.LOCALAPPDATA ?? os.tmpdir(),
        "RetroDevStudio",
        "cargo-target-shadow"
      )
    : path.join(os.tmpdir(), "retrodevstudio-cargo-target");

const BASELINE_GATES = [
  { id: "check_tree", label: "check:tree", command: npmCommand(), args: ["run", "check:tree"] },
  { id: "lint", label: "lint", command: npmCommand(), args: ["run", "lint"] },
  { id: "tsc", label: "tsc --noEmit", command: npxCommand(), args: ["tsc", "--noEmit"] },
  { id: "frontend_tests", label: "npm test", command: npmCommand(), args: ["test"] },
  {
    id: "cargo_clippy",
    label: "cargo clippy",
    command: "cargo",
    args: ["clippy", "--", "-D", "warnings"],
    cwd: path.join(repoRoot, "src-tauri"),
    useCargoTargetDir: true,
  },
  {
    id: "cargo_test",
    label: "cargo test --lib",
    command: "cargo",
    args: ["test", "--lib", "--", "--nocapture", "--test-threads=1"],
    cwd: path.join(repoRoot, "src-tauri"),
    useCargoTargetDir: true,
  },
];

const MANUAL_QA_BLOCKS = [
  { id: "A", name: "Primeiro uso e onboarding" },
  { id: "B", name: "Edicao de cena e camadas" },
  { id: "C", name: "Colisao e pintura" },
  { id: "D", name: "Build e emulacao Mega Drive" },
  { id: "E", name: "Ferramentas e paineis" },
  { id: "F", name: "Persistencia e fechamento" },
];

const EXPERIMENTAL_SURFACES = [
  "ArtStudio",
  "RetroFX",
  "Asset Extractor",
  "Reverse Explorer",
  "Memory Viewer",
  "Importacao MUGEN",
  "Importacao Godot 2D",
  "Importacao Ikemen GO",
];

const LOCAL_ONLY_STATUS_PATHS = new Set([
  ".claude/settings.local.json",
  "AGENTS.md",
]);

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function powershellCommand() {
  return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

function parseArgs(argv) {
  const options = {
    runBaseline: false,
    runUpstream: false,
    runDesktopE2E: false,
    runBuildMode: null,
    strict: false,
    manualQaJson: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-baseline") {
      options.runBaseline = true;
    } else if (arg === "--run-upstream") {
      options.runUpstream = true;
    } else if (arg === "--run-desktop-e2e") {
      options.runDesktopE2E = true;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--run-build") {
      options.runBuildMode = argv[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--run-build=")) {
      options.runBuildMode = arg.slice("--run-build=".length);
    } else if (arg === "--manual-qa-json") {
      options.manualQaJson = argv[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--manual-qa-json=")) {
      options.manualQaJson = arg.slice("--manual-qa-json=".length);
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  return options;
}

function createEmptyGateResult(gate) {
  return {
    id: gate.id,
    label: gate.label,
    command: `${gate.command} ${gate.args.join(" ")}`,
    status: "not_run",
    durationMs: 0,
    startedAt: null,
    finishedAt: null,
    cwd: gate.cwd ?? repoRoot,
  };
}

async function pathExists(candidatePath) {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const normalized = raw.replace(/^\uFEFF/, "").trim();
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

async function findLatestMsi() {
  if (!(await pathExists(MSI_DIR))) {
    return null;
  }

  const entries = await readdir(MSI_DIR);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.toLowerCase().endsWith(".msi"))
      .map(async (entry) => {
        const fullPath = path.join(MSI_DIR, entry);
        const metadata = await stat(fullPath);
        return { fullPath, metadata };
      })
  );

  candidates.sort((left, right) => right.metadata.mtimeMs - left.metadata.mtimeMs);
  return candidates[0]?.fullPath ?? null;
}

async function inspectFile(filePath) {
  if (!filePath || !(await pathExists(filePath))) {
    return {
      path: filePath,
      exists: false,
      sizeBytes: null,
      lastModifiedIso: null,
    };
  }

  const metadata = await stat(filePath);
  return {
    path: filePath,
    exists: true,
    sizeBytes: metadata.size,
    lastModifiedIso: metadata.mtime.toISOString(),
  };
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve) => {
    const useCmdShim = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
    const child = spawn(useCmdShim ? "cmd.exe" : command, useCmdShim ? ["/d", "/s", "/c", command, ...args] : args, {
      cwd: repoRoot,
      shell: false,
      stdio: "inherit",
      env: process.env,
      ...options,
    });

    child.on("error", (error) => {
      resolve({ ok: false, exitCode: null, error: error.message });
    });

    child.on("exit", (code) => {
      resolve({ ok: code === 0, exitCode: code, error: null });
    });
  });
}

async function runGate(gate) {
  const startedAt = new Date();
  const env = { ...process.env };
  if (gate.useCargoTargetDir && !env.CARGO_TARGET_DIR) {
    env.CARGO_TARGET_DIR = DEFAULT_CARGO_TARGET_DIR;
  }

  const result = await spawnAndWait(gate.command, gate.args, {
    cwd: gate.cwd ?? repoRoot,
    env,
  });
  const finishedAt = new Date();

  return {
    id: gate.id,
    label: gate.label,
    command: formatCommand(gate.command, gate.args),
    status: result.ok ? "passed" : "failed",
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    exitCode: result.exitCode,
    error: result.error,
    cwd: gate.cwd ?? repoRoot,
  };
}

async function runAuxiliaryCommand(label, command, args, options = {}) {
  const startedAt = new Date();
  const result = await spawnAndWait(command, args, options);
  const finishedAt = new Date();

  return {
    label,
    command: formatCommand(command, args),
    status: result.ok ? "passed" : "failed",
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    exitCode: result.exitCode,
    error: result.error,
  };
}

async function gitOutput(args, options = {}) {
  const { trim = true } = options;
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repoRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(trim ? stdout.trim() : stdout);
      } else {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
      }
    });
  });
}

async function collectGitState() {
  const [branch, commit, status] = await Promise.all([
    gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]),
    gitOutput(["rev-parse", "HEAD"]),
    gitOutput(["status", "--porcelain"], { trim: false }),
  ]);

  const dirtyEntries = status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const normalized = line.slice(3).replaceAll("\\", "/");
      return {
        raw: line,
        path: normalized,
        localOnly: LOCAL_ONLY_STATUS_PATHS.has(normalized),
      };
    });

  return {
    branch,
    commit,
    dirtyEntries,
    dirtyTrackedEntries: dirtyEntries.filter((entry) => !entry.localOnly),
  };
}

async function loadManualQaStatus(manualQaJsonPath) {
  const blocks = MANUAL_QA_BLOCKS.map((block) => ({
    ...block,
    status: "pending",
    note: null,
  }));

  if (!manualQaJsonPath) {
    return { source: null, blocks };
  }

  const resolved = path.resolve(repoRoot, manualQaJsonPath);
  const payload = await readJsonIfExists(resolved);
  if (!payload || typeof payload !== "object") {
    return {
      source: resolved,
      blocks,
      error: "Arquivo de QA manual ausente ou invalido.",
    };
  }

  const statuses = payload.blocks && typeof payload.blocks === "object" ? payload.blocks : {};
  for (const block of blocks) {
    const raw = statuses[block.id];
    if (typeof raw === "string") {
      block.status = raw;
    } else if (raw && typeof raw === "object") {
      block.status = typeof raw.status === "string" ? raw.status : "pending";
      block.note = typeof raw.note === "string" ? raw.note : null;
    }
  }

  return { source: resolved, blocks };
}

function classifyReadiness({
  gitState,
  gateResults,
  auxiliary,
  artifacts,
  buildReport,
  upstreamReport,
  manualQa,
}) {
  const blockers = [];
  const warnings = [];

  const failedBaseline = gateResults.filter((gate) => gate.status === "failed");
  const pendingBaseline = gateResults.filter((gate) => gate.status === "not_run");
  if (failedBaseline.length > 0) {
    blockers.push(
      `Baseline com falha: ${failedBaseline.map((gate) => gate.label).join(", ")}`
    );
  }
  if (pendingBaseline.length > 0) {
    blockers.push(
      `Baseline nao executada nesta rodada: ${pendingBaseline
        .map((gate) => gate.label)
        .join(", ")}`
    );
  }

  if (gitState.dirtyTrackedEntries.length > 0) {
    blockers.push(
      `Workspace com mudancas locais fora do report canonico: ${gitState.dirtyTrackedEntries
        .map((entry) => entry.path)
        .join(", ")}`
    );
  }
  if (gitState.dirtyEntries.some((entry) => entry.localOnly)) {
    warnings.push(
      `Arquivos locais fora do Git canonico detectados: ${gitState.dirtyEntries
        .filter((entry) => entry.localOnly)
        .map((entry) => entry.path)
        .join(", ")}`
    );
  }

  if (!buildReport) {
    blockers.push("build-report.json ausente; o estado de artefatos nao esta consolidado.");
  }
  if (!artifacts.releaseExe.exists) {
    blockers.push("Executavel portable/release canonico ausente.");
  }
  if (!artifacts.msi.exists) {
    blockers.push("MSI canonico ausente.");
  }
  if (!artifacts.webdriver.exists) {
    warnings.push("msedgedriver.exe ausente; desktop E2E local nao pode ser reexecutado.");
  }

  if (!upstreamReport?.success) {
    blockers.push("Validacao upstream oficial nao comprovada no report atual.");
  }

  if (auxiliary.build?.status === "failed") {
    blockers.push("Build canonicamente solicitado nesta rodada falhou.");
  }
  if (auxiliary.upstream?.status === "failed") {
    blockers.push("validate-upstream-windows falhou nesta rodada.");
  }
  if (auxiliary.desktopE2E?.status === "failed") {
    blockers.push("Desktop E2E falhou nesta rodada.");
  }
  if (!auxiliary.desktopE2E) {
    warnings.push("Desktop E2E nao foi reexecutado nesta rodada pelo agregador.");
  }

  const pendingManualQa = manualQa.blocks.filter((block) => block.status !== "passed");
  if (pendingManualQa.length > 0) {
    blockers.push(
      `QA manual ainda pendente: ${pendingManualQa.map((block) => block.id).join(", ")}`
    );
  }

  if (EXPERIMENTAL_SURFACES.length > 0) {
    warnings.push(
      `Superficies ainda marcadas como Experimental: ${EXPERIMENTAL_SURFACES.join(", ")}`
    );
  }

  return {
    readyForPromotion: blockers.length === 0,
    blockers,
    warnings,
  };
}

function toMarkdown(report) {
  const gateLines = report.gates.map(
    (gate) =>
      `- ${gate.label}: ${gate.status}${gate.durationMs ? ` (${gate.durationMs} ms)` : ""}`
  );
  const artifactLines = [
    `- Debug EXE: ${report.artifacts.debugExe.exists ? "OK" : "ausente"}${report.artifacts.debugExe.path ? ` - ${report.artifacts.debugExe.path}` : ""}`,
    `- Release EXE: ${report.artifacts.releaseExe.exists ? "OK" : "ausente"}${report.artifacts.releaseExe.path ? ` - ${report.artifacts.releaseExe.path}` : ""}`,
    `- MSI: ${report.artifacts.msi.exists ? "OK" : "ausente"}${report.artifacts.msi.path ? ` - ${report.artifacts.msi.path}` : ""}`,
    `- Build report: ${report.artifacts.buildReport.exists ? "OK" : "ausente"}`,
    `- Upstream report: ${report.artifacts.upstreamReport.exists ? "OK" : "ausente"}`,
    `- WebDriver local: ${report.artifacts.webdriver.exists ? "OK" : "ausente"}`,
  ];
  const manualQaLines = report.manualQa.blocks.map(
    (block) =>
      `- ${block.id} - ${block.name}: ${block.status}${block.note ? ` (${block.note})` : ""}`
  );
  const blockerLines =
    report.summary.blockers.length > 0
      ? report.summary.blockers.map((item) => `- ${item}`)
      : ["- Nenhum bloqueador automatizado detectado."];
  const warningLines =
    report.summary.warnings.length > 0
      ? report.summary.warnings.map((item) => `- ${item}`)
      : ["- Nenhum aviso adicional detectado."];

  return [
    "# Release Readiness",
    "",
    `- Gerado em: ${report.generatedAt}`,
    `- Branch: ${report.git.branch}`,
    `- Commit: ${report.git.commit}`,
    `- Pronto para promocao: ${report.summary.readyForPromotion ? "SIM" : "NAO"}`,
    "",
    "## Gates baseline",
    ...gateLines,
    "",
    "## Artefatos canonicos",
    ...artifactLines,
    "",
    "## QA manual",
    `- Documento base: ${path.relative(repoRoot, QA_DOC_PATH).replaceAll("\\", "/")}`,
    ...manualQaLines,
    "",
    "## Bloqueadores",
    ...blockerLines,
    "",
    "## Avisos",
    ...warningLines,
    "",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(VALIDATION_DIR, { recursive: true });

  const gitState = await collectGitState();
  const gateResults = BASELINE_GATES.map((gate) => createEmptyGateResult(gate));
  const auxiliary = {};

  if (options.runBuildMode) {
    auxiliary.build = await runAuxiliaryCommand(
      `build:${options.runBuildMode}`,
      "node",
      [path.join("scripts", "build.mjs"), options.runBuildMode]
    );
  }

  if (options.runBaseline) {
    for (let index = 0; index < BASELINE_GATES.length; index += 1) {
      gateResults[index] = await runGate(BASELINE_GATES[index]);
    }
  }

  if (options.runUpstream) {
    auxiliary.upstream = await runAuxiliaryCommand(
      "validate-upstream-windows",
      powershellCommand(),
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join("scripts", "validate-upstream-windows.ps1"),
        "-SkipRustTests",
      ]
    );
  }

  if (options.runDesktopE2E) {
    if (!(await pathExists(WEBDRIVER_PATH))) {
      auxiliary.desktopE2E = {
        label: "desktop-e2e",
        command: `node scripts/e2e-tauri-build-run.mjs --skip-build --native-driver ${WEBDRIVER_PATH}`,
        status: "failed",
        durationMs: 0,
        startedAt: null,
        finishedAt: null,
        exitCode: null,
        error: "msedgedriver.exe ausente no caminho canonico.",
      };
    } else {
      auxiliary.desktopE2E = await runAuxiliaryCommand(
        "desktop-e2e",
        "node",
        [
          path.join("scripts", "e2e-tauri-build-run.mjs"),
          "--skip-build",
          "--native-driver",
          WEBDRIVER_PATH,
        ]
      );
    }
  }

  const [buildReport, upstreamReport, manualQa, debugExe, releaseExe, latestMsi, webdriver] =
    await Promise.all([
      readJsonIfExists(BUILD_REPORT_PATH),
      readJsonIfExists(UPSTREAM_REPORT_PATH),
      loadManualQaStatus(options.manualQaJson),
      inspectFile(DEBUG_EXE_PATH),
      inspectFile(RELEASE_EXE_PATH),
      findLatestMsi(),
      inspectFile(WEBDRIVER_PATH),
    ]);

  const artifacts = {
    debugExe,
    releaseExe,
    msi: await inspectFile(latestMsi),
    buildReport: await inspectFile(BUILD_REPORT_PATH),
    upstreamReport: await inspectFile(UPSTREAM_REPORT_PATH),
    webdriver,
  };

  const summary = classifyReadiness({
    gitState,
    gateResults,
    auxiliary,
    artifacts,
    buildReport,
    upstreamReport,
    manualQa,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    git: {
      branch: gitState.branch,
      commit: gitState.commit,
      dirtyEntries: gitState.dirtyEntries,
      dirtyTrackedEntries: gitState.dirtyTrackedEntries,
    },
    gates: gateResults,
    auxiliary,
    artifacts,
    reports: {
      buildReportPath: BUILD_REPORT_PATH,
      buildReport,
      upstreamReportPath: UPSTREAM_REPORT_PATH,
      upstreamReport,
    },
    manualQa: {
      source: manualQa.source,
      document: path.relative(repoRoot, QA_DOC_PATH).replaceAll("\\", "/"),
      blocks: manualQa.blocks,
      error: manualQa.error ?? null,
    },
    experimentalSurfaces: EXPERIMENTAL_SURFACES,
    summary,
  };

  await writeFile(READINESS_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(READINESS_MD_PATH, `${toMarkdown(report)}\n`, "utf8");

  console.log(`\n[Release Readiness] JSON: ${READINESS_JSON_PATH}`);
  console.log(`[Release Readiness] Markdown: ${READINESS_MD_PATH}`);
  console.log(
    `[Release Readiness] Pronto para promocao: ${summary.readyForPromotion ? "SIM" : "NAO"}`
  );

  if (summary.blockers.length > 0) {
    console.log("[Release Readiness] Bloqueadores:");
    for (const blocker of summary.blockers) {
      console.log(`- ${blocker}`);
    }
  }

  if (options.strict && summary.blockers.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[release-readiness] erro fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
