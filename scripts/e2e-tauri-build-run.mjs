#!/usr/bin/env node

import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const driverServerUrl = process.env.RDS_E2E_DRIVER_URL ?? "http://127.0.0.1:4444";
const defaultDebugAppPath = path.join(
  repoRoot,
  "src-tauri",
  "target-test",
  "debug",
  "retro-dev-studio.exe"
);
const defaultReleaseAppPath = path.join(
  repoRoot,
  "src-tauri",
  "target-test",
  "release",
  "retro-dev-studio.exe"
);
const defaultWebDriverPath = path.join(
  repoRoot,
  "toolchains",
  "webdriver",
  "msedgedriver.exe"
);
const validationDir = path.join(
  repoRoot,
  "src-tauri",
  "target-test",
  "validation"
);
const buildReportPath = path.join(
  validationDir,
  "build-report.json"
);
const manualQaStatusPath = path.join(
  validationDir,
  "manual-qa-status.json"
);
let currentE2eRunContext = null;

class E2EFailure extends Error {
  constructor(message, metadata = {}) {
    super(message);
    this.name = "E2EFailure";
    this.statusCode = metadata.statusCode ?? "e2e_unknown";
    this.errorCategory = metadata.errorCategory ?? "app_failure";
    this.details = metadata.details ?? null;
  }
}

function fail(message, metadata = {}) {
  throw new E2EFailure(message, metadata);
}

function classifyFailureMetadata(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof E2EFailure) {
    return {
      statusCode: error.statusCode,
      errorCategory: error.errorCategory,
      details: error.details ?? null,
      message,
    };
  }
  const lower = message.toLowerCase();
  if (lower.includes("webdriver") || lower.includes("msedgedriver")) {
    return { statusCode: "webdriver_error", errorCategory: "webdriver_failure", details: null, message };
  }
  if (lower.includes("timeout") || lower.includes("excedeu")) {
    return { statusCode: "timeout_wait_condition", errorCategory: "timeout", details: null, message };
  }
  if (lower.includes("build") || lower.includes("rom")) {
    return { statusCode: "build_failed", errorCategory: "build_failure", details: null, message };
  }
  if (lower.includes("toolchains") || lower.includes("preflight") || lower.includes("host")) {
    return { statusCode: "host_issue", errorCategory: "host_failure", details: null, message };
  }
  return { statusCode: "app_failure", errorCategory: "app_failure", details: null, message };
}

function parsePositiveInteger(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readProjectMetadata(projectDir) {
  const projectFile = path.join(projectDir, "project.rds");
  const raw = await readFile(projectFile, "utf8");
  const parsed = JSON.parse(raw);
  return {
    name: String(parsed.name ?? "").trim(),
    target: String(parsed.target ?? "").trim(),
  };
}

async function readBuildReport() {
  if (!(await pathExists(buildReportPath))) {
    return null;
  }

  try {
    const raw = await readFile(buildReportPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function resolveDefaultDesktopApp() {
  if (await pathExists(defaultDebugAppPath)) {
    return defaultDebugAppPath;
  }

  if (await pathExists(defaultReleaseAppPath)) {
    return defaultReleaseAppPath;
  }

  const buildReport = await readBuildReport();
  const portableCanonical = buildReport?.modes?.portable?.canonicalExe;
  if (portableCanonical && await pathExists(portableCanonical)) {
    return portableCanonical;
  }

  const debugCanonical = buildReport?.modes?.debug?.canonicalExe;
  if (debugCanonical && await pathExists(debugCanonical)) {
    return debugCanonical;
  }

  if (portableCanonical && await pathExists(portableCanonical)) {
    return portableCanonical;
  }

  return defaultDebugAppPath;
}

function parseArgs(argv) {
  const options = {
    skipBuild: false,
    externalDriver: false,
    scenario: "build-run",
    project: path.join(repoRoot, "src-tauri", "tests", "fixtures", "projects", "megadrive_dummy"),
    app: "",
    appExplicitlyProvided: false,
    tauriDriver: process.env.TAURI_DRIVER_PATH ?? "",
    nativeDriver:
      process.env.RDS_EDGE_DRIVER_PATH ??
      process.env.NATIVE_DRIVER_PATH ??
      defaultWebDriverPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (argument === "--external-driver") {
      options.externalDriver = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value) {
      fail(`Argumento sem valor: ${argument}`);
    }

    if (argument === "--project") {
      options.project = path.resolve(repoRoot, value);
    } else if (argument === "--scenario") {
      if (
        ![
          "build-run",
          "live-ok",
          "live-overflow",
          "live-overflow-vram",
          "live-warning-vram",
          "live-warning-sprites",
          "live-error",
          "live-stale",
          "build-blocked-diagnostic",
          "onboarding-shell",
          "qa-rc",
        ].includes(
          value
        )
      ) {
        fail(`Cenario E2E desconhecido: ${value}`);
      }
      options.scenario = value;
    } else if (argument === "--app") {
      options.app = path.resolve(repoRoot, value);
      options.appExplicitlyProvided = true;
    } else if (argument === "--tauri-driver") {
      options.tauriDriver = path.resolve(repoRoot, value);
    } else if (argument === "--native-driver") {
      options.nativeDriver = path.resolve(repoRoot, value);
    } else {
      fail(`Argumento desconhecido: ${argument}`);
    }
    index += 1;
  }

  return options;
}

function overflowSpriteLimit(target) {
  return target === "snes" ? 129 : 81;
}

function buildSpriteOverflowScene(target) {
  const spriteCount = overflowSpriteLimit(target);
  return {
    scene_id: "live_overflow",
    display_name: "Live Overflow",
    background_layers: [],
    palettes: [],
    entities: Array.from({ length: spriteCount }, (_, index) => ({
      entity_id: `overflow_${index}`,
      transform: {
        x: (index % 16) * 8,
        y: Math.floor(index / 16) * 8,
      },
      components: {
        sprite: {
          asset: target === "snes" ? "assets/sprites/hero.ppm" : "assets/sprites/hero.png",
          frame_width: 8,
          frame_height: 8,
          palette_slot: 0,
          animations: {},
          priority: "foreground",
        },
      },
    })),
  };
}

function buildVramOverflowScene(target) {
  const frameWidth = target === "snes" ? 64 : 32;
  const frameHeight = frameWidth;
  const frameCount = target === "snes" ? 33 : 129;

  return {
    scene_id: "live_vram_overflow",
    display_name: "Live VRAM Overflow",
    background_layers: [],
    palettes: [],
    entities: [
      {
        entity_id: "overflow_vram_entity",
        transform: { x: 16, y: 16 },
        components: {
          sprite: {
            asset: target === "snes" ? "assets/sprites/hero.ppm" : "assets/sprites/hero.png",
            frame_width: frameWidth,
            frame_height: frameHeight,
            palette_slot: 0,
            animations: {
              stress: {
                frames: Array.from({ length: frameCount }, (_, index) => index),
                fps: 12,
                loop: true,
              },
            },
            priority: "foreground",
          },
        },
      },
    ],
  };
}

function buildVramWarningScene(target) {
  const frameWidth = target === "snes" ? 64 : 32;
  const frameHeight = frameWidth;
  const frameCount = target === "snes" ? 30 : 112;

  return {
    scene_id: "live_vram_warning",
    display_name: "Live VRAM Warning",
    background_layers: [],
    palettes: [],
    entities: [
      {
        entity_id: "warning_vram_entity",
        transform: { x: 16, y: 16 },
        components: {
          sprite: {
            asset: target === "snes" ? "assets/sprites/hero.ppm" : "assets/sprites/hero.png",
            frame_width: frameWidth,
            frame_height: frameHeight,
            palette_slot: 0,
            animations: {
              warning: {
                frames: Array.from({ length: frameCount }, (_, index) => index),
                fps: 12,
                loop: true,
              },
            },
            priority: "foreground",
          },
        },
      },
    ],
  };
}

function buildSpriteWarningScene(target) {
  const spriteCount = target === "snes" ? 103 : 65;
  return {
    scene_id: "live_sprite_warning",
    display_name: "Live Sprite Warning",
    background_layers: [],
    palettes: [],
    entities: Array.from({ length: spriteCount }, (_, index) => ({
      entity_id: `warning_sprite_${index}`,
      transform: {
        x: (index % 16) * 8,
        y: Math.floor(index / 16) * 8,
      },
      components: {
        sprite: {
          asset: target === "snes" ? "assets/sprites/hero.ppm" : "assets/sprites/hero.png",
          frame_width: 8,
          frame_height: 8,
          palette_slot: 0,
          animations: {},
          priority: "foreground",
        },
      },
    })),
  };
}

function buildLiveErrorScene() {
  return {
    scene_id: 123,
    display_name: "Live Error",
    background_layers: [],
    palettes: [],
    entities: [],
  };
}

function buildLiveHealthyScene(target, sceneId, xOffset) {
  return {
    scene_id: sceneId,
    display_name: "Live Healthy",
    background_layers: [],
    palettes: [],
    entities: [
      {
        entity_id: "healthy_sprite",
        transform: { x: 16 + xOffset, y: 16 },
        components: {
          sprite: {
            asset: target === "snes" ? "assets/sprites/hero.ppm" : "assets/sprites/hero.png",
            frame_width: 8,
            frame_height: 8,
            palette_slot: 0,
            animations: {},
            priority: "foreground",
          },
        },
      },
    ],
  };
}

function buildLiveStaleScenario(target) {
  return {
    firstDraft: buildLiveHealthyScene(target, "live_stale_base", 0),
    secondDraft: buildLiveHealthyScene(target, "live_stale_next", 24),
  };
}

function buildLiveOkScenario(target) {
  return {
    draft: buildLiveHealthyScene(target, "live_ok", 8),
    expectedToolbarState: "LIVE",
    expectedDetailFragment: "Preview live sincronizado.",
  };
}

function buildMissingAssetScene(target) {
  return {
    scene_id: "build_blocked_diagnostic",
    display_name: "Build Blocked Diagnostic",
    background_layers: [],
    palettes: [],
    entities: [
      {
        entity_id: "missing_asset_sprite",
        transform: { x: 16, y: 16 },
        components: {
          sprite: {
            asset:
              target === "snes"
                ? "assets/sprites/missing_build_diagnostic.ppm"
                : "assets/sprites/missing_build_diagnostic.png",
            frame_width: 8,
            frame_height: 8,
            palette_slot: 0,
            animations: {},
            priority: "foreground",
          },
        },
      },
    ],
  };
}

function buildLiveOverflowScenario(target, scenario) {
  if (scenario === "live-overflow-vram") {
    return {
      draft: buildVramOverflowScene(target),
      expectedReasonFragment: "VRAM Overflow",
      expectedSeverity: "OVERFLOW",
      expectedToolbarState: "BLOQUEADO",
      expectBuildDisabled: true,
      expectLiveError: false,
    };
  }

  if (scenario === "live-warning-vram") {
    return {
      draft: buildVramWarningScene(target),
      expectedReasonFragment: "VRAM Warning",
      expectedSeverity: "WARN",
      expectedToolbarState: "WARN",
      expectBuildDisabled: false,
      expectLiveError: false,
    };
  }

  if (scenario === "live-warning-sprites") {
    return {
      draft: buildSpriteWarningScene(target),
      expectedReasonFragment: "Sprite Warning",
      expectedSeverity: "WARN",
      expectedToolbarState: "WARN",
      expectBuildDisabled: false,
      expectLiveError: false,
    };
  }

  if (scenario === "live-error") {
    return {
      draft: buildLiveErrorScene(),
      expectedReasonFragment: "Live com falha:",
      expectedSeverity: "",
      expectedToolbarState: "ERRO LIVE",
      expectBuildDisabled: false,
      expectLiveError: true,
    };
  }

  return {
    draft: buildSpriteOverflowScene(target),
    expectedReasonFragment: "Sprite overflow",
    expectedSeverity: "OVERFLOW",
    expectedToolbarState: "BLOQUEADO",
    expectBuildDisabled: true,
    expectLiveError: false,
  };
}

function artifactTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function escapeGithubAnnotation(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function emitGithubErrorAnnotation(message) {
  if (process.env.GITHUB_ACTIONS !== "true") {
    return;
  }

  const normalized = String(message ?? "").trim();
  if (!normalized) {
    return;
  }

  const limited = normalized.length > 4000 ? `${normalized.slice(0, 3997)}...` : normalized;
  console.error(`::error::${escapeGithubAnnotation(limited)}`);
}

function sanitizeFailureReportSegment(value) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function getDesktopFailureReportPath(scenario) {
  return path.join(
    validationDir,
    `desktop-e2e-failure-${sanitizeFailureReportSegment(scenario)}.json`
  );
}

async function clearDesktopFailureReport(scenario) {
  const targetPath = getDesktopFailureReportPath(scenario);
  if (await pathExists(targetPath)) {
    await rm(targetPath, { force: true });
  }
}

async function writeDesktopFailureReport(error) {
  const scenario = currentE2eRunContext?.scenario ?? "unknown";
  await ensureValidationDir();
  const payload = {
    generatedAt: new Date().toISOString(),
    scenario,
    project: currentE2eRunContext?.project ?? null,
    projectName: currentE2eRunContext?.projectName ?? null,
    projectTarget: currentE2eRunContext?.projectTarget ?? null,
    app: currentE2eRunContext?.app ?? null,
    externalDriver: currentE2eRunContext?.externalDriver ?? null,
    sessionId: currentE2eRunContext?.sessionId ?? null,
    driverServerUrl,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
  };
  await writeFile(
    getDesktopFailureReportPath(scenario),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

async function ensureValidationDir() {
  await mkdir(validationDir, { recursive: true });
}

async function pathExists(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertPathExists(candidate, message) {
  if (!(await pathExists(candidate))) {
    fail(message);
  }
}

function pathExtensions() {
  if (process.platform !== "win32") {
    return [""];
  }

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
        reject(new Error(`Comando falhou (${code}): ${command} ${args.join(" ")}`));
      }
    });
  });
}

function describeSpawnError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = [];
  if (typeof error.code === "string" && error.code) {
    details.push(`code=${error.code}`);
  }
  if (typeof error.syscall === "string" && error.syscall) {
    details.push(`syscall=${error.syscall}`);
  }
  if (typeof error.path === "string" && error.path) {
    details.push(`path=${error.path}`);
  }
  details.push(error.message);
  return details.join(" | ");
}

async function assertChildProcessSpawnAvailable() {
  const probeCommand = process.platform === "win32" ? "cmd.exe" : "sh";
  const probeArgs = process.platform === "win32" ? ["/d", "/s", "/c", "exit 0"] : ["-c", "exit 0"];

  try {
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(probeCommand, probeArgs, {
          cwd: repoRoot,
          stdio: "ignore",
          shell: false,
        });
      } catch (error) {
        reject(error);
        return;
      }

      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Probe de spawn retornou codigo ${code}.`));
      });
    });
  } catch (error) {
    fail(
      [
        "Nao foi possivel abrir subprocessos via Node (child_process.spawn).",
        "O runner desktop local nao consegue iniciar tauri-driver/msedgedriver neste host.",
        `Detalhe: ${describeSpawnError(error)}`,
        "Execute este cenario em runner GitHub/Windows ou ajuste a policy de execucao local.",
      ].join(" ")
    );
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 500) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError instanceof Error) {
    fail(`${label}: ${lastError.message}`, {
      statusCode: "timeout_wait_condition",
      errorCategory: "timeout",
      details: { timeoutMs, label },
    });
  }
  fail(label, {
    statusCode: "timeout_wait_condition",
    errorCategory: "timeout",
    details: { timeoutMs, label },
  });
}

async function webdriverRequest(method, route, body) {
  const response = await fetch(`${driverServerUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const details = payload?.value?.message ?? response.statusText;
    throw new Error(`${method} ${route} falhou: ${details}`);
  }

  if (payload?.value?.error) {
    throw new Error(payload.value.message ?? `${method} ${route} retornou erro WebDriver.`);
  }

  return payload;
}

async function isDriverOnline() {
  try {
    const response = await fetch(`${driverServerUrl}/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDriverOffline(timeoutMs, label) {
  return waitFor(
    async () => !(await isDriverOnline()),
    timeoutMs,
    label,
    250
  );
}

async function createSession(applicationPath) {
  const payload = {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": {
          application: applicationPath,
        },
      },
    },
  };
  const response = await webdriverRequest("POST", "/session", payload);
  return response.value?.sessionId ?? response.sessionId;
}

async function deleteSession(sessionId) {
  try {
    await webdriverRequest("DELETE", `/session/${sessionId}`);
  } catch {
    // Session might already be gone if the app closed unexpectedly.
  }
}

async function executeScript(sessionId, script, args = []) {
  const response = await webdriverRequest("POST", `/session/${sessionId}/execute/sync`, {
    script,
    args,
  });
  return response.value;
}

async function executeAsyncScript(sessionId, script, args = []) {
  const response = await webdriverRequest("POST", `/session/${sessionId}/execute/async`, {
    script,
    args,
  });
  return response.value;
}

async function readAutomationState(sessionId) {
  return executeScript(
    sessionId,
    "return window.__RDS_E2E__?.getState?.() ?? null;"
  );
}

async function callAutomationApi(sessionId, methodName, args = []) {
  const result = await executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const api = window.__RDS_E2E__;
      const methodName = arguments[0];
      const methodArgs = Array.isArray(arguments[1]) ? arguments[1] : [];
      if (!api || typeof api[methodName] !== "function") {
        done({ ok: false, error: "Metodo de automacao indisponivel: " + methodName });
        return;
      }

      Promise.resolve(api[methodName](...methodArgs))
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `,
    [methodName, args]
  );

  if (!result?.ok) {
    fail(`Falha na API de automacao (${methodName}): ${result?.error ?? "sem diagnostico"}`);
  }

  return result.value;
}

async function tryAutomationApi(sessionId, methodName, args = [], timeoutMs = 8000) {
  return executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const api = window.__RDS_E2E__;
      const methodName = arguments[0];
      const methodArgs = Array.isArray(arguments[1]) ? arguments[1] : [];
      const timeoutMs = Number(arguments[2]) || 8000;
      if (!api || typeof api[methodName] !== "function") {
        done({ ok: false, reason: "Metodo de automacao indisponivel: " + methodName });
        return;
      }

      let settled = false;
      const finish = (payload) => {
        if (settled) {
          return;
        }
        settled = true;
        done(payload);
      };
      const timer = setTimeout(
        () => finish({ ok: false, timedOut: true, reason: methodName + " excedeu " + timeoutMs + "ms" }),
        timeoutMs
      );

      Promise.resolve(api[methodName](...methodArgs))
        .then((value) => {
          clearTimeout(timer);
          finish({ ok: true, value });
        })
        .catch((error) => {
          clearTimeout(timer);
          finish({ ok: false, reason: String(error) });
        });
    `,
    [methodName, args, timeoutMs]
  );
}

function createManualQaReport() {
  return {
    generatedAt: null,
    scenario: "qa-rc",
    projectName: "",
    projectDir: "",
    app: "",
    artifacts: [],
    metadata: {
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
    blocks: {
      A: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
      B: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
      C: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
      D: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
      E: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
      F: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
      G: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
      H: { status: "pending", note: null, status_code: null, error_category: null, started_at: null, finished_at: null, duration_ms: null },
    },
  };
}

async function writeManualQaReport(report) {
  await ensureValidationDir();
  report.generatedAt = new Date().toISOString();
  if (report.metadata) {
    report.metadata.finishedAt = report.generatedAt;
  }
  await writeFile(manualQaStatusPath, `${JSON.stringify(report, null, 2)}\n`);
}

function registerArtifact(report, filePath, label) {
  report.artifacts.push({
    label,
    path: filePath,
  });
}

async function markManualQaBlock(report, blockId, status, note, metadata = {}) {
  const nowIso = new Date().toISOString();
  const current = report.blocks[blockId] ?? {};
  const startedAt = metadata.startedAt ?? current.started_at ?? nowIso;
  const finishedAt = metadata.finishedAt ?? nowIso;
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  report.blocks[blockId] = {
    status,
    note,
    status_code: metadata.statusCode ?? current.status_code ?? null,
    error_category: metadata.errorCategory ?? current.error_category ?? null,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Number.isFinite(durationMs) ? durationMs : null,
  };
  await writeManualQaReport(report);
}

async function fillInputBySelector(sessionId, selector, value) {
  const result = await executeScript(
    sessionId,
    `
      const input = document.querySelector(arguments[0]);
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
        return false;
      }
      const prototype =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      const setValue = descriptor?.set;
      if (typeof setValue !== "function") {
        return false;
      }
      input.focus();
      setValue.call(input, arguments[1]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    `,
    [selector, value]
  );

  if (!result) {
    fail(`Falha ao preencher input via seletor: ${selector}`);
  }
}

async function waitForBodyText(sessionId, fragment, timeoutMs, label) {
  return waitFor(
    async () =>
      executeScript(
        sessionId,
        `
          const bodyText = document.body?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
          return bodyText.includes(arguments[0]) ? bodyText : false;
        `,
        [fragment]
      ),
    timeoutMs,
    label,
    250
  );
}

async function pressKey(sessionId, key, options = {}) {
  const code = options.code ?? key;
  const ctrlKey = Boolean(options.ctrlKey);
  const shiftKey = Boolean(options.shiftKey);
  const altKey = Boolean(options.altKey);
  const result = await executeScript(
    sessionId,
    `
      const eventInit = {
        key: arguments[0],
        code: arguments[1],
        ctrlKey: arguments[2],
        shiftKey: arguments[3],
        altKey: arguments[4],
        bubbles: true,
        cancelable: true,
      };
      const down = new KeyboardEvent("keydown", eventInit);
      const up = new KeyboardEvent("keyup", eventInit);
      window.dispatchEvent(down);
      window.dispatchEvent(up);
      return true;
    `,
    [key, code, ctrlKey, shiftKey, altKey]
  );

  if (!result) {
    fail(`Falha ao disparar atalho de teclado: ${key}`);
  }
}

async function clickHierarchyEntityByLabel(sessionId, label) {
  const result = await executeScript(
    sessionId,
    `
      const normalizedLabel = String(arguments[0]).trim();
      const candidate = Array.from(document.querySelectorAll("li"))
        .find((node) => {
          const text = node.textContent?.replace(/\\s+/g, " ").trim() ?? "";
          return text.includes(normalizedLabel);
        });
      if (!(candidate instanceof HTMLElement)) {
        return false;
      }
      candidate.click();
      return true;
    `,
    [label]
  );

  if (!result) {
    fail(`Entidade nao encontrada na Hierarchy: ${label}`);
  }
}

async function selectLayerByName(sessionId, layerName) {
  const result = await executeScript(
    sessionId,
    `
      const normalized = String(arguments[0]).trim();
      const label = Array.from(document.querySelectorAll("span[title]")).find((candidate) =>
        (candidate.getAttribute("title") ?? "").startsWith(normalized)
      );
      const row = label?.closest("div[class*='group']");
      if (!(row instanceof HTMLElement)) {
        return false;
      }
      row.click();
      return true;
    `,
    [layerName]
  );

  if (!result) {
    fail(`Camada nao encontrada para selecao: ${layerName}`);
  }
}

async function renameLayer(sessionId, currentName, nextName) {
  const activated = await executeScript(
    sessionId,
    `
      const normalized = String(arguments[0]).trim();
      const label = Array.from(document.querySelectorAll("span[title]")).find((candidate) =>
        (candidate.getAttribute("title") ?? "").startsWith(normalized)
      );
      if (!(label instanceof HTMLElement)) {
        return false;
      }
      label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return true;
    `,
    [currentName]
  );

  if (!activated) {
    fail(`Camada nao encontrada para renomear: ${currentName}`);
  }

  await waitFor(
    async () =>
      executeScript(
        sessionId,
        `
          const inputs = Array.from(document.querySelectorAll("input"));
          return inputs.some((candidate) => candidate.value === arguments[0]) ? true : false;
        `,
        [currentName]
      ),
    10000,
    `Campo de rename da camada '${currentName}' nao ficou ativo.`,
    100
  );

  const renamed = await executeScript(
    sessionId,
    `
      const currentName = String(arguments[0]).trim();
      const nextName = String(arguments[1]);
      const input = Array.from(document.querySelectorAll("input"))
        .find((candidate) => candidate.value === currentName);
      if (!(input instanceof HTMLInputElement)) {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      const setValue = descriptor?.set;
      if (typeof setValue !== "function") {
        return false;
      }
      input.focus();
      setValue.call(input, nextName);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.blur();
      return true;
    `,
    [currentName, nextName]
  );

  if (!renamed) {
    fail(`Falha ao concluir rename da camada '${currentName}' -> '${nextName}'.`);
  }
}

async function toggleLayerVisibility(sessionId, layerName) {
  const result = await executeScript(
    sessionId,
    `
      const normalized = String(arguments[0]).trim();
      const label = Array.from(document.querySelectorAll("span[title]")).find((candidate) =>
        (candidate.getAttribute("title") ?? "").startsWith(normalized)
      );
      const row = label?.closest("div[class*='group']");
      if (!(row instanceof HTMLElement)) {
        return false;
      }
      const button = Array.from(row.querySelectorAll("button")).find((candidate) => {
        const title = candidate.getAttribute("title") ?? "";
        return title === "Ocultar camada" || title === "Mostrar camada";
      });
      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }
      button.click();
      return true;
    `,
    [layerName]
  );

  if (!result) {
    fail(`Falha ao alternar visibilidade da camada: ${layerName}`);
  }
}

async function sceneOverlayPointerAction(sessionId, x, y, button = 0, modifiers = {}) {
  const result = await executeScript(
    sessionId,
    `
      const overlay = document.querySelector('[data-testid="viewport-scene-overlay"]');
      if (!(overlay instanceof HTMLCanvasElement)) {
        return false;
      }
      const rect = overlay.getBoundingClientRect();
      const clientX = rect.left + Number(arguments[0]);
      const clientY = rect.top + Number(arguments[1]);
      const button = Number(arguments[2]);
      const modifiers = arguments[3] ?? {};
      const buttons = button === 2 ? 2 : 1;
      const eventInit = {
        bubbles: true,
        cancelable: true,
        button,
        buttons,
        shiftKey: Boolean(modifiers.shiftKey),
        altKey: Boolean(modifiers.altKey),
        ctrlKey: Boolean(modifiers.ctrlKey),
        clientX,
        clientY,
      };
      overlay.dispatchEvent(new MouseEvent("mousemove", eventInit));
      overlay.dispatchEvent(new MouseEvent("mousedown", eventInit));
      overlay.dispatchEvent(new MouseEvent("mouseup", eventInit));
      overlay.dispatchEvent(new MouseEvent("click", eventInit));
      if (button === 2) {
        overlay.dispatchEvent(new MouseEvent("contextmenu", eventInit));
      }
      return true;
    `,
    [x, y, button, modifiers]
  );

  if (!result) {
    fail("Falha ao interagir com o overlay da cena.");
  }
}

async function updateInspectorIntField(sessionId, label, value) {
  const fieldSlug = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const valueSelector = `[data-testid="inspector-prop-${fieldSlug}-value"]`;
  const inputSelector = `[data-testid="inspector-prop-${fieldSlug}-input"]`;
  const activated = await executeScript(
    sessionId,
    `
      const valueNode = document.querySelector(arguments[0]);
      if (!(valueNode instanceof HTMLElement)) {
        return false;
      }
      valueNode.click();
      return true;
    `,
    [valueSelector]
  );

  if (!activated) {
    fail(`Falha ao abrir campo do Inspector para: ${label}`);
  }

  await waitFor(
    async () =>
      executeScript(
        sessionId,
        "return Boolean(document.querySelector(arguments[0]));",
        [inputSelector]
      ),
    10000,
    `Input do Inspector nao ficou disponivel para: ${label}`,
    50
  );

  const updated = await executeScript(
    sessionId,
    `
      const input = document.querySelector(arguments[0]);
      const nextValue = String(arguments[1]);
      if (!(input instanceof HTMLInputElement)) {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      const setValue = descriptor?.set;
      if (typeof setValue !== "function") {
        return false;
      }
      input.focus();
      setValue.call(input, nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.blur();
      return true;
    `,
    [inputSelector, value]
  );

  if (!updated) {
    fail(`Falha ao atualizar campo do Inspector: ${label}`);
  }
}

const UI_LAYOUT_CAPTURE_RESOLUTIONS = [
  { width: 1366, height: 768, tag: "1366x768" },
  { width: 1920, height: 1080, tag: "1920x1080" },
  { width: 2560, height: 1080, tag: "2560x1080" },
];

async function setSessionWindowRect(sessionId, width, height) {
  await webdriverRequest("POST", `/session/${sessionId}/window/rect`, {
    x: 0,
    y: 0,
    width: Number(width),
    height: Number(height),
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
}

const UI_LAYOUT_SHELL_EXPECTATIONS = {
  scene: { showLeft: true, showRight: true },
  logic: { showLeft: false, showRight: false },
  game: { showLeft: false, showRight: false },
  debug: { showLeft: false, showRight: true },
};

async function assertUiLayoutHealth(sessionId, workspaceId, resolutionTag) {
  const result = await executeScript(
    sessionId,
    `
      const workspace = arguments[0];
      const resolutionTag = arguments[1];
      const issues = [];
      const metrics = {};

      function panelVisible(panel) {
        if (!panel) return false;
        const rect = panel.getBoundingClientRect();
        return rect.width > 10 && rect.height > 10;
      }

      function rectsOverlap(a, b) {
        if (!a || !b) return false;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return overlapX > 2 && overlapY > 2;
      }

      /** Topbar: ignorar sobreposicoes <6px (anti-aliasing / bordas partilhadas entre chips adjacentes). */
      function rectsOverlapTopbarControls(a, b) {
        if (!a || !b) return false;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return overlapX > 6 && overlapY > 6;
      }

      const topbar = document.querySelector('[data-testid="unified-topbar"]');
      if (topbar) {
        metrics.topbarScrollWidth = topbar.scrollWidth;
        metrics.topbarClientWidth = topbar.clientWidth;
        if (topbar.scrollWidth > topbar.clientWidth + 2) {
          issues.push("topbar overflow horizontal");
        }
        const topbarCols = Array.from(topbar.children).filter(
          (node) => node instanceof HTMLElement
        );
        if (topbarCols.length >= 3) {
          const leftRect = topbarCols[0].getBoundingClientRect();
          const centerRect = topbarCols[1].getBoundingClientRect();
          const rightRect = topbarCols[2].getBoundingClientRect();
          if (centerRect.left < leftRect.right - 2) {
            issues.push("topbar: coluna central sobrepoe a esquerda (texto/comandos)");
          }
          if (centerRect.right > rightRect.left + 2) {
            issues.push("topbar: coluna central sobrepoe a direita (texto/comandos)");
          }
        }
        const topbarRect = topbar.getBoundingClientRect();
        metrics.topbarHeight = Math.round(topbarRect.height);
        const buildBtn = document.querySelector('[data-testid="toolbar-build-run"]');
        if (buildBtn) {
          const buildRect = buildBtn.getBoundingClientRect();
          metrics.buildButtonHeight = Math.round(buildRect.height);
          const buildStyle = window.getComputedStyle(buildBtn);
          if (Number.parseFloat(buildStyle.lineHeight) > topbarRect.height + 2) {
            issues.push("botao Build aumenta altura da topbar");
          }
          if (buildBtn.scrollHeight > buildBtn.clientHeight + 2) {
            issues.push("botao Build com quebra de linha");
          }
          if (buildRect.height > topbarRect.height + 2) {
            issues.push("botao Build mais alto que a topbar");
          }
        }
      }

      const centerPanel =
        document.querySelector('[data-panel-id="center"]') ??
        document.getElementById("center");
      if (centerPanel) {
        const centerRect = centerPanel.getBoundingClientRect();
        metrics.centerWidth = Math.round(centerRect.width);
        metrics.centerHeight = Math.round(centerRect.height);
        const minCenterWidth =
          resolutionTag === "1366x768" ? 520 : resolutionTag === "1920x1080" ? 720 : 900;
        const minCenterHeight = 280;
        if (centerRect.width < minCenterWidth) {
          issues.push(
            "painel central estreito demais (" + Math.round(centerRect.width) + "px)"
          );
        }
        if (centerRect.height < minCenterHeight) {
          issues.push(
            "painel central baixo demais (" + Math.round(centerRect.height) + "px)"
          );
        }
      } else {
        issues.push("painel central nao encontrado");
      }

      const guide = document.querySelector('[data-testid="workspace-guide"]');
      if (guide) {
        const guideRect = guide.getBoundingClientRect();
        metrics.guideHeight = Math.round(guideRect.height);
        const maxGuideHeight = window.innerHeight * 0.14;
        if (guideRect.height > maxGuideHeight) {
          issues.push(
            "workspace guide alto demais (" + Math.round(guideRect.height) + "px)"
          );
        }
      }

      const shellExpectations = {
        scene: { showLeft: true, showRight: true },
        logic: { showLeft: false, showRight: false },
        game: { showLeft: false, showRight: false },
        debug: { showLeft: false, showRight: true },
      };
      const expected = shellExpectations[workspace] ?? { showLeft: true, showRight: true };
      const leftPanel =
        document.querySelector('[data-panel-id="left"]') ?? document.getElementById("left");
      const rightPanel =
        document.querySelector('[data-panel-id="right"]') ?? document.getElementById("right");
      if (!expected.showLeft && panelVisible(leftPanel)) {
        issues.push("painel esquerdo visivel com showLeft=false");
      }
      if (!expected.showRight && panelVisible(rightPanel)) {
        issues.push("painel direito visivel com showRight=false");
      }

      const consoleDrawer = document.querySelector('[data-testid="console-drawer"]');
      if (consoleDrawer?.getAttribute("data-visible") === "true") {
        issues.push("console drawer aberto por padrao");
      }
      const statusBar = document.querySelector('[data-testid="production-status-bar"]');
      if (consoleDrawer && statusBar && consoleDrawer.getAttribute("data-visible") === "true") {
        const consoleRect = consoleDrawer.getBoundingClientRect();
        const statusRect = statusBar.getBoundingClientRect();
        if (consoleRect.bottom > statusRect.top + 1) {
          issues.push("console drawer cobre a status bar");
        }
      }

      if (workspace === "logic") {
        const rail = document.querySelector('[data-testid="nodegraph-side-rail"]');
        const canvas = document.querySelector('[data-testid="nodegraph-canvas"]');
        if (!rail) {
          issues.push("nodegraph side rail ausente");
        }
        if (rail && canvas) {
          const railRect = rail.getBoundingClientRect();
          const canvasRect = canvas.getBoundingClientRect();
          if (railRect.left < canvasRect.right - 4) {
            issues.push("nodegraph side rail sobrepoe o canvas");
          }
          const minimap = document.querySelector('[data-testid="nodegraph-minimap"]');
          if (minimap && rectsOverlap(minimap.getBoundingClientRect(), railRect)) {
            issues.push("minimap sobrepoe o side rail");
          }
          const toolbar = document.querySelector('[data-testid="nodegraph-canvas-toolbar"]');
          if (toolbar && rectsOverlap(toolbar.getBoundingClientRect(), railRect)) {
            issues.push("toolbar do canvas sobrepoe o side rail");
          }
          const nodeCards = Array.from(
            document.querySelectorAll('[data-testid^="node-card-"]')
          ).slice(0, 6);
          for (const card of nodeCards) {
            if (rectsOverlap(card.getBoundingClientRect(), railRect)) {
              issues.push("node card sobrepoe o side rail");
              break;
            }
          }
        }
      }

      const toolbarButtons = Array.from(
        document.querySelectorAll('[data-testid="unified-topbar"] button')
      ).filter((button) => {
        const rect = button.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4 || rect.top >= 120) {
          return false;
        }
        let node = button.parentElement;
        while (node && node !== topbar) {
          if (node instanceof HTMLElement) {
            const cls = node.getAttribute("class") ?? "";
            if (cls.includes("sr-only") || cls.includes("hidden")) {
              return false;
            }
          }
          node = node.parentElement;
        }
        return true;
      });
      for (let index = 0; index < toolbarButtons.length; index += 1) {
        for (let other = index + 1; other < toolbarButtons.length; other += 1) {
          if (
            rectsOverlapTopbarControls(
              toolbarButtons[index].getBoundingClientRect(),
              toolbarButtons[other].getBoundingClientRect()
            )
          ) {
            issues.push("controles da topbar sobrepostos");
            index = toolbarButtons.length;
            break;
          }
        }
      }

      return { ok: issues.length === 0, issues, metrics };
    `,
    [workspaceId, resolutionTag]
  );

  if (!result?.ok) {
    const metricsText = result?.metrics ? JSON.stringify(result.metrics) : "{}";
    fail(
      `Bloco H layout ${resolutionTag}/${workspaceId}: ${(result?.issues ?? ["sem diagnostico"]).join("; ")} | metrics=${metricsText}`
    );
  }
}

async function captureScreenshot(sessionId, filename) {
  await ensureValidationDir();
  const response = await webdriverRequest("GET", `/session/${sessionId}/screenshot`);
  const base64 = response.value;
  if (typeof base64 !== "string" || base64.length === 0) {
    fail("WebDriver nao retornou screenshot valida.");
  }

  const outputPath = path.join(validationDir, filename);
  await writeFile(outputPath, Buffer.from(base64, "base64"));
  return outputPath;
}

async function cleanupTemporaryProject(projectDir) {
  if (!projectDir) {
    return true;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(projectDir, { recursive: true, force: true });
      if (!(await pathExists(projectDir))) {
        return true;
      }
    } catch {
      // Retry while the app/OS releases any remaining file handles.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return !(await pathExists(projectDir));
}

async function setSceneDraft(sessionId, draft) {
  const result = await executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const api = window.__RDS_E2E__;
      if (!api) {
        done({ ok: false, error: "window.__RDS_E2E__ indisponivel" });
        return;
      }
      api
        .setSceneDraft(arguments[0])
        .then(() => done({ ok: true }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `,
    [draft]
  );

  if (!result?.ok) {
    fail(`Falha ao injetar draft live: ${result?.error ?? "sem diagnostico"}`);
  }
}

async function readLiveStatus(sessionId) {
  return executeScript(
    sessionId,
    `
      const automationState = window.__RDS_E2E__?.getState?.() ?? null;
      if (automationState) {
        const hwStatus = automationState.hwStatus ?? null;
        const hwValidationState = automationState.hwValidationState ?? "";
        const activeProjectDir = automationState.activeProjectDir ?? "";
        const liveBuildBlocked =
          hwValidationState === "fresh" && Boolean(hwStatus && hwStatus.errorCount > 0);

        let liveState = "";
        let liveStateDetail = "";
        if (activeProjectDir) {
          if (hwValidationState === "pending") {
            liveState = "ANALISANDO";
            liveStateDetail = "Preview live em analise.";
          } else if (hwValidationState === "stale") {
            liveState = "DESATUAL.";
            liveStateDetail =
              "O draft mudou depois da ultima analise live. Edite a cena para acionar a revalidacao automatica ou use Revalidar agora.";
          } else if (hwValidationState === "error") {
            liveState = "ERRO LIVE";
            liveStateDetail = automationState.hwValidationError ?? "Falha ao atualizar o preview live.";
          } else if (hwValidationState === "fresh" && hwStatus?.errorCount > 0) {
            liveState = "BLOQUEADO";
            liveStateDetail = hwStatus.firstError ?? "";
          } else if (hwValidationState === "fresh" && hwStatus?.warningCount > 0) {
            liveState = "WARN";
            liveStateDetail = hwStatus.firstWarning ?? "";
          } else if (hwValidationState === "fresh") {
            liveState = "LIVE";
            liveStateDetail = "Preview live sincronizado.";
          }
        }

        return {
          disabled: liveBuildBlocked,
          describedBy: liveBuildBlocked ? "build-disabled-reason" : "",
          reason: liveBuildBlocked && hwStatus?.firstError ? "Build bloqueado: " + hwStatus.firstError : "",
          summary: !liveBuildBlocked && hwStatus?.warningCount > 0 ? "Build com alerta: " + hwStatus.firstWarning : "",
          errorSummary: liveState === "ERRO LIVE" ? "Live com falha: " + liveStateDetail : "",
          pendingSummary: liveState === "ANALISANDO" ? liveStateDetail : "",
          liveState,
          liveStateDetail,
          severity: hwStatus
            ? hwStatus.errorCount > 0
              ? "OVERFLOW"
              : hwStatus.warningCount > 0
                ? "WARN"
                : "OK"
            : "OK",
          warning: hwStatus?.firstWarning ?? "",
          error: hwStatus?.firstError ?? "",
          staleHint: liveState === "DESATUAL." ? "Edite a cena para revalidar" : "",
          hasStaleRevalidateButton: liveState === "DESATUAL.",
        };
      }

      const button = document.querySelector('[data-testid="toolbar-build-run"]');
      const reason = document.querySelector('[data-testid="build-disabled-reason"]');
      const summary = document.querySelector('[data-testid="build-warning-summary"]');
      const errorSummary = document.querySelector('[data-testid="build-live-error-summary"]');
      const pendingSummary = document.querySelector('[data-testid="build-live-pending-summary"]');
      const liveState = document.querySelector('[data-testid="build-live-state"]');
      const severity = document.querySelector('[data-testid="hardware-limits-severity"]');
      const warning = document.querySelector('[data-testid="hardware-warning-0"]');
      const error = document.querySelector('[data-testid="hardware-error-0"]');
      const staleHint = document.querySelector('[data-testid="build-stale-hint"]');
      const staleRevalidateButton = document.querySelector('[data-testid="build-stale-revalidate"]');
      return {
        disabled: Boolean(button?.disabled),
        describedBy: button?.getAttribute('aria-describedby') ?? '',
        reason: reason?.textContent?.trim() ?? '',
        summary: summary?.textContent?.trim() ?? '',
        errorSummary: errorSummary?.textContent?.trim() ?? '',
        pendingSummary: pendingSummary?.textContent?.trim() ?? '',
        liveState: liveState?.textContent?.trim() ?? '',
        liveStateDetail: liveState?.getAttribute('title')?.trim() ?? '',
        severity: severity?.textContent?.trim() ?? '',
        warning: warning?.textContent?.trim() ?? '',
        error: error?.textContent?.trim() ?? '',
        staleHint: staleHint?.textContent?.trim() ?? '',
        hasStaleRevalidateButton: Boolean(staleRevalidateButton),
      };
    `
  );
}

function formatLiveStatus(status) {
  if (!status) {
    return "liveStatus=<indisponivel>";
  }

  return [
    `disabled=${status.disabled}`,
    `describedBy="${status.describedBy}"`,
    `reason="${status.reason}"`,
    `summary="${status.summary}"`,
    `errorSummary="${status.errorSummary}"`,
    `pendingSummary="${status.pendingSummary}"`,
    `liveState="${status.liveState}"`,
    `liveStateDetail="${status.liveStateDetail}"`,
    `severity="${status.severity}"`,
    `warning="${status.warning}"`,
    `error="${status.error}"`,
    `staleHint="${status.staleHint}"`,
    `hasStaleRevalidateButton=${status.hasStaleRevalidateButton}`,
  ].join("\n");
}

async function findElement(sessionId, selector) {
  const response = await webdriverRequest("POST", `/session/${sessionId}/element`, {
    using: "css selector",
    value: selector,
  });
  const element =
    response.value?.["element-6066-11e4-a52e-4f735466cecf"] ??
    response.value?.ELEMENT;
  if (!element) {
    throw new Error(`Elemento nao encontrado: ${selector}`);
  }
  return element;
}

async function clickElement(sessionId, elementId) {
  await webdriverRequest("POST", `/session/${sessionId}/element/${elementId}/click`, {});
}

async function clickByTestId(sessionId, testId) {
  const result = await executeScript(
    sessionId,
    `
      const testId = String(arguments[0] ?? "");
      const element = document.querySelector('[data-testid="' + testId + '"]');
      if (!(element instanceof HTMLElement)) {
        return { ok: false, reason: "elemento nao encontrado" };
      }
      if (element instanceof HTMLButtonElement && element.disabled) {
        return { ok: false, reason: "botao desabilitado" };
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return { ok: true };
    `,
    [testId]
  );
  if (!result?.ok) {
    throw new Error(
      `Nao foi possivel clicar [data-testid='${testId}']: ${result?.reason ?? "falha desconhecida"}`
    );
  }
}

async function clickButtonByText(sessionId, expectedText, mode = "contains") {
  const clicked = await executeScript(
    sessionId,
    `
      const expectedText = String(arguments[0] ?? "").trim();
      const mode = String(arguments[1] ?? "contains");
      const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
      const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
        if (!(candidate instanceof HTMLButtonElement) || candidate.disabled) {
          return false;
        }
        const text = normalize(candidate.textContent);
        return mode === "exact" ? text === expectedText : text.includes(expectedText);
      });
      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }
      button.click();
      return true;
    `,
    [expectedText, mode]
  );

  if (!clicked) {
    fail(`Botao nao encontrado para clique: '${expectedText}'.`);
  }
}

async function clickButtonByTestId(sessionId, testId) {
  const clicked = await executeScript(
    sessionId,
    `
      const testId = String(arguments[0] ?? "").trim();
      const button = document.querySelector('[data-testid="' + testId + '"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return false;
      }
      button.click();
      return true;
    `,
    [testId]
  );

  if (!clicked) {
    fail(`Botao nao encontrado ou desabilitado: ${testId}`);
  }
}

async function waitForBuildRunReady(sessionId, timeoutMs) {
  return waitFor(
    async () =>
      executeScript(
        sessionId,
        `
          const button = document.querySelector('[data-testid="toolbar-build-run"]');
          const state = window.__RDS_E2E__?.getState?.() ?? null;
          if (!button || !state) return false;
          const validationState = state.hwValidationState ?? "";
          const hasProject = Boolean(state.activeProjectDir);
          return hasProject && validationState !== "pending" && !button.disabled
            ? {
                validationState,
                activeProjectDir: state.activeProjectDir,
              }
            : false;
        `
      ),
    timeoutMs,
    "Toolbar Build & Run nao ficou pronto para clique.",
    250
  );
}

async function getTitle(sessionId) {
  const response = await webdriverRequest("GET", `/session/${sessionId}/title`);
  return response.value ?? "";
}

async function collectWindowBootstrapState(sessionId) {
  const state = {
    webdriverTitle: "",
    documentTitle: "",
    readyState: "",
    locationHref: "",
    rootPresent: false,
    rootChildCount: 0,
    bodyChildCount: 0,
    automationApiAvailable: false,
    bodyTextSample: "",
    domError: "",
  };

  try {
    state.webdriverTitle = await getTitle(sessionId);
  } catch (error) {
    state.webdriverTitle = `<getTitle falhou: ${error instanceof Error ? error.message : String(error)}>`;
  }

  try {
    const domState = await executeScript(
      sessionId,
      `
        const root = document.getElementById("root");
        const bodyText = (document.body?.textContent ?? "").replace(/\\s+/g, " ").trim();
        return {
          documentTitle: document.title ?? "",
          readyState: document.readyState ?? "",
          locationHref: window.location?.href ?? "",
          rootPresent: Boolean(root),
          rootChildCount: root?.childElementCount ?? 0,
          bodyChildCount: document.body?.childElementCount ?? 0,
          automationApiAvailable: typeof window.__RDS_E2E__ === "object" && window.__RDS_E2E__ !== null,
          bodyTextSample: bodyText.slice(0, 160),
        };
      `
    );

    if (domState && typeof domState === "object") {
      state.documentTitle = String(domState.documentTitle ?? "");
      state.readyState = String(domState.readyState ?? "");
      state.locationHref = String(domState.locationHref ?? "");
      state.rootPresent = Boolean(domState.rootPresent);
      state.rootChildCount = Number.isFinite(domState.rootChildCount) ? domState.rootChildCount : 0;
      state.bodyChildCount = Number.isFinite(domState.bodyChildCount) ? domState.bodyChildCount : 0;
      state.automationApiAvailable = Boolean(domState.automationApiAvailable);
      state.bodyTextSample = String(domState.bodyTextSample ?? "");
    }
  } catch (error) {
    state.domError = error instanceof Error ? error.message : String(error);
  }

  return state;
}

function formatWindowBootstrapDiagnostics(state) {
  if (!state) {
    return "";
  }

  return [
    "Diagnostico de bootstrap da janela:",
    `webdriverTitle="${state.webdriverTitle}"`,
    `documentTitle="${state.documentTitle}"`,
    `readyState="${state.readyState}"`,
    `locationHref="${state.locationHref}"`,
    `rootPresent="${state.rootPresent}"`,
    `rootChildCount="${state.rootChildCount}"`,
    `bodyChildCount="${state.bodyChildCount}"`,
    `automationApiAvailable="${state.automationApiAvailable}"`,
    `bodyTextSample="${state.bodyTextSample}"`,
    state.domError ? `domError="${state.domError}"` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function isWindowBootstrapReady(state) {
  if (!state) {
    return false;
  }

  const hasExpectedTitle =
    state.webdriverTitle.includes("RetroDev Studio") ||
    state.documentTitle.includes("RetroDev Studio");
  const domBooted =
    (state.readyState === "interactive" || state.readyState === "complete") &&
    state.rootPresent &&
    (state.rootChildCount > 0 || state.bodyChildCount > 0);

  return hasExpectedTitle || state.automationApiAvailable || domBooted;
}

async function waitForAppWindowReady(sessionId, timeoutMs, label) {
  let lastState = null;

  try {
    return await waitFor(
      async () => {
        lastState = await collectWindowBootstrapState(sessionId);
        return isWindowBootstrapReady(lastState) ? lastState : false;
      },
      timeoutMs,
      label,
      250
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const diagnostics = formatWindowBootstrapDiagnostics(lastState);
    throw new Error(diagnostics ? `${detail}\n${diagnostics}` : detail);
  }
}

async function waitForOnboardingWizard(sessionId) {
  return waitFor(
    async () =>
      executeScript(
        sessionId,
        `
          const templateCard = document.querySelector('[data-testid="template-card-starter_guided"]');
          const nameInput = document.querySelector('input[placeholder="Nome do projeto"]');
          const createButton = Array.from(document.querySelectorAll("button")).find((button) => {
            const text = button.textContent?.replace(/\\s+/g, " ").trim() ?? "";
            return text === "Criar Projeto";
          });
          return templateCard && nameInput && createButton
            ? {
                createDisabled: Boolean(createButton.disabled),
              }
            : false;
        `
      ),
    30000,
    "Wizard de primeiro uso nao ficou pronto com template e acoes visiveis.",
    250
  );
}

function summarizeDriverLogs(logs) {
  return logs.slice(-20).join("\n");
}

function waitForProcessExit(processHandle, timeoutMs) {
  return new Promise((resolve) => {
    if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) {
      resolve(true);
      return;
    }

    let settled = false;
    const finish = (exited) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      processHandle.off("exit", onExit);
      processHandle.off("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);

    processHandle.once("exit", onExit);
    processHandle.once("error", onError);
  });
}

function isSessionBootstrapFailure(details) {
  const normalized = details.toLowerCase();
  return (
    normalized.includes("devtoolsactiveport file doesn't exist") ||
    normalized.includes("chrome not reachable") ||
    normalized.includes("session not created")
  );
}

function sessionBootstrapHint(details, options) {
  if (!isSessionBootstrapFailure(details)) {
    return details;
  }

  return [
    details,
    "",
    "Falha de bootstrap WebDriver detectada (sessao nao iniciada).",
    `App: ${options.app}`,
    `Driver endpoint: ${driverServerUrl}`,
    "Acoes recomendadas:",
    "1) Feche instancias manuais de retro-dev-studio.exe antes de rodar o E2E.",
    "2) Rode o diagnostico local completo:",
    "   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\diagnose-desktop-e2e.ps1 -SessionProbe",
    "3) Se o host local continuar com DevToolsActivePort/chrome not reachable, use o workflow desktop-e2e no runner GitHub/Windows.",
  ].join("\n");
}

async function collectAppDiagnostics(sessionId) {
  try {
    return await executeScript(
      sessionId,
      `
        const status = document.querySelector('[data-testid="viewport-game-status"]')?.textContent?.trim() ?? '';
        const state = window.__RDS_E2E__?.getState?.() ?? null;
        const consoleTail = Array.isArray(state?.consoleEntries)
          ? state.consoleEntries.slice(-10).map((entry) => entry.message)
          : [];
        return {
          status,
          activeTarget: state?.activeTarget ?? null,
          activeViewportTab: state?.activeViewportTab ?? null,
          sceneRevision: state?.sceneRevision ?? null,
          hwValidationState: state?.hwValidationState ?? null,
          hwValidatedRevision: state?.hwValidatedRevision ?? null,
          hwValidationError: state?.hwValidationError ?? null,
          activeSceneEntityCount: state?.activeSceneEntityCount ?? null,
          hwStatus: state?.hwStatus ?? null,
          consoleTail,
        };
      `
    );
  } catch {
    return null;
  }
}

function formatAppDiagnostics(diagnostics) {
  if (!diagnostics) {
    return "";
  }

  const consoleTail =
    diagnostics.consoleTail && diagnostics.consoleTail.length > 0
      ? diagnostics.consoleTail.join(" | ")
      : "(sem console tail)";

  return [
    "Diagnostico do app:",
    `status="${diagnostics.status ?? ""}"`,
    `activeTarget="${diagnostics.activeTarget ?? ""}"`,
    `activeViewportTab="${diagnostics.activeViewportTab ?? ""}"`,
    `sceneRevision="${diagnostics.sceneRevision ?? ""}"`,
    `hwValidationState="${diagnostics.hwValidationState ?? ""}"`,
    `hwValidatedRevision="${diagnostics.hwValidatedRevision ?? ""}"`,
    `hwValidationError="${diagnostics.hwValidationError ?? ""}"`,
    `activeSceneEntityCount="${diagnostics.activeSceneEntityCount ?? ""}"`,
    `hwStatus="${diagnostics.hwStatus ? JSON.stringify(diagnostics.hwStatus) : ""}"`,
    `consoleTail=${consoleTail}`,
  ].join("\n");
}

function deriveLiveStatusFromDiagnostics(diagnostics) {
  if (!diagnostics) {
    return null;
  }

  const hwStatus = diagnostics.hwStatus ?? null;
  const hwValidationState = diagnostics.hwValidationState ?? "";
  const liveBuildBlocked =
    hwValidationState === "fresh" && Boolean(hwStatus && hwStatus.errorCount > 0);

  let liveState = "";
  let liveStateDetail = "";
  if (diagnostics.activeTarget) {
    if (hwValidationState === "pending") {
      liveState = "ANALISANDO";
      liveStateDetail = "Preview live em analise.";
    } else if (hwValidationState === "stale") {
      liveState = "DESATUAL.";
      liveStateDetail =
        "O draft mudou depois da ultima analise live. Edite a cena para acionar a revalidacao automatica ou use Revalidar agora.";
    } else if (hwValidationState === "error") {
      liveState = "ERRO LIVE";
      liveStateDetail = diagnostics.hwValidationError ?? "Falha ao atualizar o preview live.";
    } else if (hwValidationState === "fresh" && hwStatus?.errorCount > 0) {
      liveState = "BLOQUEADO";
      liveStateDetail = hwStatus.firstError ?? "";
    } else if (hwValidationState === "fresh" && hwStatus?.warningCount > 0) {
      liveState = "WARN";
      liveStateDetail = hwStatus.firstWarning ?? "";
    } else if (hwValidationState === "fresh") {
      liveState = "LIVE";
      liveStateDetail = "Preview live sincronizado.";
    }
  }

  return {
    disabled: liveBuildBlocked,
    describedBy: liveBuildBlocked ? "build-disabled-reason" : "",
    reason: liveBuildBlocked && hwStatus?.firstError ? `Build bloqueado: ${hwStatus.firstError}` : "",
    summary: !liveBuildBlocked && hwStatus?.warningCount > 0 ? `Build com alerta: ${hwStatus.firstWarning}` : "",
    errorSummary: liveState === "ERRO LIVE" ? `Live com falha: ${liveStateDetail}` : "",
    pendingSummary: liveState === "ANALISANDO" ? liveStateDetail : "",
    liveState,
    liveStateDetail,
    severity: hwStatus
      ? hwStatus.errorCount > 0
        ? "OVERFLOW"
        : hwStatus.warningCount > 0
          ? "WARN"
          : "OK"
      : "OK",
    warning: hwStatus?.firstWarning ?? "",
    error: hwStatus?.firstError ?? "",
    staleHint: liveState === "DESATUAL." ? "Edite a cena para revalidar" : "",
    hasStaleRevalidateButton: liveState === "DESATUAL.",
  };
}

async function main() {
  if (process.platform !== "win32") {
    fail("Este runner E2E desktop/Tauri e suportado apenas em Windows.");
  }

  if (typeof fetch !== "function") {
    fail("Este script requer Node.js com suporte a fetch global.");
  }

  const options = parseArgs(process.argv.slice(2));
  try {
    const preflightUrl = pathToFileURL(
      path.join(repoRoot, "scripts", "sgdk-e2e-host-preflight.mjs")
    ).href;
    const { logPreflightSummary } = await import(preflightUrl);
    await logPreflightSummary(
      {
        externalDriver: options.externalDriver,
        tauriDriver: options.tauriDriver,
        nativeDriver: options.nativeDriver,
      },
      repoRoot
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[RDS preflight host] indisponivel ou erro: ${detail}`);
  }
  if (!options.appExplicitlyProvided) {
    options.app = await resolveDefaultDesktopApp();
  }
  currentE2eRunContext = {
    scenario: options.scenario,
    project: options.project,
    projectName: null,
    projectTarget: null,
    app: options.app,
    externalDriver: options.externalDriver,
    sessionId: null,
  };
  await clearDesktopFailureReport(options.scenario);
  const driverStartupTimeoutMs = parsePositiveInteger(
    process.env.RDS_E2E_DRIVER_TIMEOUT_MS,
    // QA RC faz build pesado antes do driver; em hosts lentos 30s falha com portas ocupadas.
    options.scenario === "qa-rc" ? 120000 : 30000
  );
  const uiBootstrapTimeoutMs = parsePositiveInteger(
    process.env.RDS_E2E_UI_TIMEOUT_MS,
    process.env.GITHUB_ACTIONS === "true" ? 30000 : 15000
  );
  const emulatorActivationTimeoutMs = parsePositiveInteger(process.env.RDS_E2E_RUN_TIMEOUT_MS, 180000);
  const liveValidationTimeoutMs = parsePositiveInteger(process.env.RDS_E2E_LIVE_TIMEOUT_MS, 60000);
  const requiresExistingProject =
    options.scenario !== "onboarding-shell" && options.scenario !== "qa-rc";
  if (requiresExistingProject) {
    await assertPathExists(
      options.project,
      `Projeto de fixture nao encontrado: ${options.project}`
    );
  }
  const projectMetadata = requiresExistingProject
    ? await readProjectMetadata(options.project)
    : { name: "", target: "" };
  currentE2eRunContext.projectName = projectMetadata.name || null;
  currentE2eRunContext.projectTarget = projectMetadata.target || null;
  if (requiresExistingProject && (!projectMetadata.name || !projectMetadata.target)) {
    fail(`project.rds invalido ou incompleto em ${options.project}`);
  }

  let tauriDriverPath = "";
  let nativeDriverPath = "";
  if (!options.externalDriver) {
    tauriDriverPath = await resolveExecutable(options.tauriDriver, ["tauri-driver", "tauri-driver.exe"]);
    if (!tauriDriverPath) {
      fail(
        [
          "tauri-driver nao encontrado.",
          "Instale-o com: cargo install tauri-driver --locked",
        ].join(" ")
      );
    }

    nativeDriverPath = await resolveExecutable(options.nativeDriver, ["msedgedriver", "msedgedriver.exe"]);
    if (!nativeDriverPath) {
      fail(
        [
          "msedgedriver nao encontrado.",
          "Instale um driver compativel com o Edge do sistema, por exemplo com o utilitario oficial:",
          "cargo install --git https://github.com/chippers/msedgedriver-tool",
        ].join(" ")
      );
    }

    await assertChildProcessSpawnAvailable();
  }

  if (!options.skipBuild) {
    if (options.scenario === "qa-rc" && !process.env.RDS_FORCE_TAURI_CLI_DEBUG) {
      // No host atual, direct-cargo-debug abre localhost no WebDriver em vez da janela Tauri.
      // Forca o caminho Tauri CLI no build de QA RC para preservar o fluxo canonico desktop E2E.
      process.env.RDS_FORCE_TAURI_CLI_DEBUG = "1";
      console.log("[qa-rc] RDS_FORCE_TAURI_CLI_DEBUG=1 para build desktop canônico.");
    }

    if (options.scenario === "qa-rc") {
      // Mitigacao auditavel do blocker operacional:
      // Em alguns hosts, o build desktop do QA RC falha por esgotamento de memoria do rustc
      // (ex.: "rustc-LLVM ERROR: out of memory" compilando dependencias como tauri-utils).
      // Para preservar o fluxo canonico do gate (sem maquiar resultado), reduzimos paralelismo
      // e o custo do perfil dev apenas no cenario qa-rc.
      process.env.RDS_E2E_QA_RC_MEMORY_SAFE = "1";
      process.env.CARGO_BUILD_JOBS = "1";
      process.env.CARGO_INCREMENTAL = "0";
      process.env.CARGO_PROFILE_DEV_INCREMENTAL = "false";
      process.env.CARGO_PROFILE_DEV_DEBUG = "0";
      process.env.CARGO_PROFILE_DEV_CODEGEN_UNITS = "1";
      console.log(
        "[qa-rc] Mitigacao memoria ativa no build: CARGO_BUILD_JOBS=1, CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0, CARGO_PROFILE_DEV_CODEGEN_UNITS=1."
      );
    }
    console.log("== Building debug Tauri app ==");
    await spawnLogged(npmCommand(), ["run", "build:debug"]);
    if (!options.appExplicitlyProvided) {
      options.app = await resolveDefaultDesktopApp();
    }
  }

  await assertPathExists(
    options.app,
    `Binario canonico do Tauri nao encontrado: ${options.app}`
  );

  console.log(options.externalDriver ? "== Using external tauri-driver ==" : "== Starting tauri-driver ==");
  const driverLogs = [];
  let driverProcess = null;
  let driverExited = false;
  let driverExitCode = null;
  if (!options.externalDriver) {
    if (await isDriverOnline()) {
      try {
        await waitForDriverOffline(
          10000,
          `tauri-driver anterior ainda respondia em ${driverServerUrl}`
        );
      } catch {
        fail(
          [
            `Ja existe um tauri-driver respondendo em ${driverServerUrl}.`,
            "Finalize o processo existente ou execute o runner com --external-driver.",
          ].join(" ")
        );
      }
    }

    try {
      driverProcess = spawn(tauriDriverPath, ["--native-driver", nativeDriverPath], {
        cwd: repoRoot,
        // In this Windows host, stdio=pipe can be blocked by policy (spawn EPERM).
        stdio: "inherit",
        shell: false,
      });
    } catch (error) {
      fail(
        [
          "Falha ao iniciar o tauri-driver no host local.",
          `Driver: ${tauriDriverPath}`,
          `Native driver: ${nativeDriverPath}`,
          `Detalhe: ${describeSpawnError(error)}`,
        ].join(" ")
      );
    }

    driverProcess.on("exit", (code) => {
      driverExited = true;
      driverExitCode = code;
    });
  }

  let sessionId = "";
  let temporaryProjectDir = "";
  try {
    await waitFor(
      async () => {
        if (!options.externalDriver && driverExited) {
          throw new Error(
            `tauri-driver encerrou antes do handshake HTTP (exit=${driverExitCode ?? "sem codigo"}).`
          );
        }
        return isDriverOnline();
      },
      driverStartupTimeoutMs,
      options.externalDriver
        ? `tauri-driver externo nao ficou pronto em ${driverServerUrl}`
        : "tauri-driver nao ficou pronto a tempo"
    );

    try {
      sessionId = await createSession(options.app);
      currentE2eRunContext.sessionId = sessionId;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      fail(sessionBootstrapHint(details, options));
    }
    if (!sessionId) {
      fail("Sessao WebDriver nao foi criada.");
    }

    await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "Janela do app nao abriu corretamente");

    await waitFor(
      async () =>
        executeScript(
          sessionId,
          "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"
        ),
      uiBootstrapTimeoutMs,
      "API de automacao do app nao ficou disponivel"
    );

    if (options.scenario === "onboarding-shell") {
      const artifactPrefix = `onboarding-shell-${artifactTimestamp()}`;
      await waitForOnboardingWizard(sessionId);
      const wizardScreenshot = await captureScreenshot(
        sessionId,
        `${artifactPrefix}-wizard.png`
      );

      const templateCard = await findElement(sessionId, "[data-testid='template-card-starter_guided']");
      await clickElement(sessionId, templateCard);
      await waitForOnboardingWizard(sessionId);

      const generatedProjectName = `E2E_Onboarding_${Date.now()}`;
      await fillInputBySelector(
        sessionId,
        'input[placeholder="Nome do projeto"]',
        generatedProjectName
      );
      await clickButtonByText(sessionId, "Criar Projeto");

      const createdState = await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.activeProjectDir &&
            state?.activeProjectName === generatedProjectName
            ? state
            : false;
        },
        45000,
        "Projeto de onboarding nao foi criado e hidratado no shell.",
        500
      );

      temporaryProjectDir = createdState.activeProjectDir;

      const editorScreenshot = await captureScreenshot(
        sessionId,
        `${artifactPrefix}-editor.png`
      );

      const sceneTabVisible = await executeScript(
        sessionId,
        `
          return Array.from(document.querySelectorAll("button")).some((button) => {
            const text = button.textContent?.replace(/\\s+/g, " ").trim() ?? "";
            return text === "Cena";
          });
        `
      );
      if (!sceneTabVisible) {
        fail("Aba 'Cena' nao ficou visivel apos criar o projeto pelo wizard.");
      }

      await clickButtonByText(sessionId, "Camadas");
      await waitFor(
        async () =>
          executeScript(
            sessionId,
            `
              return Array.from(document.querySelectorAll("button")).some((button) => {
                const text = button.textContent?.replace(/\\s+/g, " ").trim() ?? "";
                return text === "+ Camada";
              });
            `
          ),
        15000,
        "LayerPanel nao ficou visivel apos abrir a aba Camadas.",
        250
      );

      const layerScreenshot = await captureScreenshot(
        sessionId,
        `${artifactPrefix}-layers.png`
      );

      const shellReady = await executeScript(
        sessionId,
        `
          const guideText = document.querySelector('[data-testid="workspace-guide"]')?.textContent?.toLowerCase() ?? "";
          const hasBuildAndRun = Array.from(document.querySelectorAll("button")).some((button) => {
            const text = button.textContent?.replace(/\\s+/g, " ").trim() ?? "";
            return text === "Build & Run";
          });
          return (
            hasBuildAndRun &&
            Boolean(document.querySelector('[data-testid="workspace-rail-scene"]')) &&
            Boolean(document.querySelector('[data-testid="workspace-rail-game"]')) &&
            Boolean(document.querySelector('[data-testid="workspace-rail-logic"]')) &&
            Boolean(document.querySelector('[data-testid="workspace-rail-debug"]')) &&
            guideText.includes("scene editor")
          );
        `
      );
      if (!shellReady) {
        fail("Shell principal nao exibiu os affordances esperados apos o onboarding.");
      }

      const finalState = await readAutomationState(sessionId);
      if (!finalState?.activeProjectDir || finalState.activeProjectName !== generatedProjectName) {
        fail("Estado final do onboarding nao expôs o projeto criado na automacao.");
      }

      console.log("OK: Desktop Tauri onboarding/shell E2E passou.");
      console.log(`Projeto criado: ${generatedProjectName}`);
      console.log(`Diretorio temporario: ${temporaryProjectDir}`);
      console.log(`Evidencias: ${wizardScreenshot}`);
      console.log(`Evidencias: ${editorScreenshot}`);
      console.log(`Evidencias: ${layerScreenshot}`);
      return;
    }

    if (options.scenario === "qa-rc") {
      const artifactPrefix = `qa-rc-${artifactTimestamp()}`;
      const manualQaReport = createManualQaReport();
      manualQaReport.app = options.app;
      let currentBlock = "A";

      try {
        await setSessionWindowRect(sessionId, 1920, 1080);
        await waitForOnboardingWizard(sessionId);
        const wizardScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-A-wizard.png`
        );
        registerArtifact(manualQaReport, wizardScreenshot, "A - wizard");

        const templateCard = await findElement(sessionId, "[data-testid='template-card-starter_guided']");
        await clickElement(sessionId, templateCard);
        await waitForOnboardingWizard(sessionId);

        const generatedProjectName = `QA_RC_${Date.now()}`;
        await fillInputBySelector(
          sessionId,
          'input[placeholder="Nome do projeto"]',
          generatedProjectName
        );
        await clickButtonByText(sessionId, "Criar Projeto");

        const createdState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeProjectDir &&
              state?.activeProjectName === generatedProjectName &&
              state?.activeScene?.entityCount >= 1
              ? state
              : false;
          },
          45000,
          "Projeto RC nao foi criado e hidratado no shell.",
          500
        );

        temporaryProjectDir = createdState.activeProjectDir;
        manualQaReport.projectName = generatedProjectName;
        manualQaReport.projectDir = temporaryProjectDir;

        const editorScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-A-editor.png`
        );
        registerArtifact(manualQaReport, editorScreenshot, "A - editor");

        await clickButtonByText(sessionId, "Cena");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.entityCount >= 1 ? state : false;
          },
          15000,
          "Hierarchy nao exibiu a cena ativa apos onboarding.",
          250
        );

        await clickButtonByText(sessionId, "Camadas");
        await waitFor(
          async () => {
            const bodyText = await executeScript(
              sessionId,
              `return document.body?.textContent?.replace(/\\s+/g, " ").trim() ?? "";`
            );
            return bodyText.includes("+ Camada") ? bodyText : false;
          },
          15000,
          "LayerPanel nao ficou visivel apos onboarding.",
          250
        );
        const layerScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-A-layers.png`
        );
        registerArtifact(manualQaReport, layerScreenshot, "A - camadas");

        await markManualQaBlock(
          manualQaReport,
          "A",
          "passed",
          [
            `Wizard, editor e LayerPanel validados para '${generatedProjectName}'.`,
            `Evidencias: ${path.basename(wizardScreenshot)}, ${path.basename(editorScreenshot)}, ${path.basename(layerScreenshot)}.`,
          ].join(" ")
        );

        currentBlock = "B";
        await clickButtonByText(sessionId, "+ Camada");
        await waitFor(
          async () =>
            executeScript(
              sessionId,
              `
                const inputs = Array.from(document.querySelectorAll("input"));
                return inputs.some((candidate) => candidate.value === "Nova Camada") ? true : false;
              `
            ),
          10000,
          "Formulario de criacao da camada nao ficou visivel.",
          100
        );
        await clickButtonByText(sessionId, "Criar");
        const layerCreatedState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.layers?.some((layer) => layer.name === "Nova Camada")
              ? state
              : false;
          },
          10000,
          "Camada padrao nao foi criada.",
          100
        );

        await renameLayer(sessionId, "Nova Camada", "Fundo");
        const renamedLayerState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.layers?.find((layer) => layer.name === "Fundo") ?? false;
          },
          10000,
          "Camada renomeada 'Fundo' nao apareceu no estado da cena.",
          100
        );

        await clickButtonByText(sessionId, "Cena");
        const hierarchyState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const candidate = state?.activeScene?.entities?.find((entity) => entity.type !== "camera");
            return candidate ? { state, candidate } : false;
          },
          15000,
          "Nenhuma entidade editavel foi encontrada na Hierarchy do projeto RC.",
          250
        );

        const targetEntity = hierarchyState.candidate;
        await clickHierarchyEntityByLabel(sessionId, targetEntity.displayName);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.selectedEntityId === targetEntity.id ? state : false;
          },
          10000,
          `Entidade '${targetEntity.displayName}' nao ficou selecionada.`,
          100
        );

        await clickButtonByText(sessionId, "Camadas");
        await selectLayerByName(sessionId, "Fundo");
        await clickButtonByText(sessionId, "Atribuir à camada ativa");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const layer = state?.activeScene?.layers?.find((candidate) => candidate.name === "Fundo");
            return layer?.entityIds?.includes(targetEntity.id) ? state : false;
          },
          10000,
          "Entidade selecionada nao foi atribuida a camada 'Fundo'.",
          100
        );

        await toggleLayerVisibility(sessionId, "Fundo");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const layer = state?.activeScene?.layers?.find((candidate) => candidate.name === "Fundo");
            return layer && layer.visible === false ? state : false;
          },
          10000,
          "Camada 'Fundo' nao ficou invisivel apos alternar o olho.",
          100
        );
        const hiddenLayerScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-B-layer-hidden.png`
        );
        registerArtifact(manualQaReport, hiddenLayerScreenshot, "B - camada oculta");

        await toggleLayerVisibility(sessionId, "Fundo");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const layer = state?.activeScene?.layers?.find((candidate) => candidate.name === "Fundo");
            return layer && layer.visible === true ? state : false;
          },
          10000,
          "Camada 'Fundo' nao voltou a ficar visivel.",
          100
        );

        await pressKey(sessionId, "z", { code: "KeyZ", ctrlKey: true });
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const layer = state?.activeScene?.layers?.find((candidate) => candidate.name === "Fundo");
            return layer && layer.visible === false ? state : false;
          },
          10000,
          "Primeiro Ctrl+Z nao restaurou o estado anterior da camada.",
          100
        );
        await pressKey(sessionId, "z", { code: "KeyZ", ctrlKey: true });
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const layer = state?.activeScene?.layers?.find((candidate) => candidate.name === "Fundo");
            return layer && layer.visible === true ? state : false;
          },
          10000,
          "Segundo Ctrl+Z nao concluiu a restauracao da camada.",
          100
        );

        await markManualQaBlock(
          manualQaReport,
          "B",
          "passed",
          [
            `Camada 'Fundo' criada, renomeada e vinculada a '${targetEntity.displayName}'.`,
            `Undo restaurou as alternancias de visibilidade.`,
            `Evidencia: ${path.basename(hiddenLayerScreenshot)}.`,
          ].join(" ")
        );

        currentBlock = "C";
        await pressKey(sessionId, "c", { code: "KeyC" });
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.editorMode === "collision" ? state : false;
          },
          10000,
          "Modo colisao nao ativou via atalho.",
          100
        );

        await sceneOverlayPointerAction(sessionId, 24, 24, 0);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.collisionSolidCount >= 1 ? state : false;
          },
          10000,
          "Clique esquerdo no overlay nao marcou tile solido.",
          100
        );

        await sceneOverlayPointerAction(sessionId, 24, 24, 2);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.collisionSolidCount === 0 ? state : false;
          },
          10000,
          "Clique direito no overlay nao limpou o tile de colisao.",
          100
        );

        await pressKey(sessionId, "Escape", { code: "Escape" });
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.editorMode === "select" ? state : false;
          },
          10000,
          "Escape nao retornou o editor ao modo selecao.",
          100
        );

        await callAutomationApi(sessionId, "openToolsWorkspace", ["palette", "editing", true]);
        await waitForBodyText(
          sessionId,
          "Paleta de Assets",
          15000,
          "Paleta contextual nao ficou visivel no painel Tools."
        );

        const brushAsset =
          (await readAutomationState(sessionId))?.activeScene?.entities?.find(
            (entity) => entity.spriteAsset
          )?.spriteAsset ?? null;
        if (!brushAsset) {
          fail("Nenhum asset de sprite ficou disponivel para validar pintura.");
        }
        await callAutomationApi(sessionId, "setActiveBrush", [brushAsset]);
        await pressKey(sessionId, "b", { code: "KeyB" });
        const paintReadyState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.editorMode === "paint" && state?.activeBrush?.assetPath === brushAsset
              ? state
              : false;
          },
          10000,
          "Modo pintar nao ficou armado com o brush esperado.",
          100
        );

        const entityCountBeforePaint = paintReadyState.activeScene.entityCount;
        await sceneOverlayPointerAction(sessionId, 112, 80, 0);
        const paintedState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.entityCount === entityCountBeforePaint + 1 ? state : false;
          },
          10000,
          "Clique de pintura nao criou uma nova entidade na cena.",
          100
        );
        const paintScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-C-painted-scene.png`
        );
        registerArtifact(manualQaReport, paintScreenshot, "C - pintura");

        await pressKey(sessionId, "v", { code: "KeyV" });
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.editorMode === "select" ? state : false;
          },
          10000,
          "Modo selecao nao voltou apos atalho V.",
          100
        );

        await markManualQaBlock(
          manualQaReport,
          "C",
          "passed",
          [
            "Colisao respondeu a clique esquerdo/direito e saiu com Esc.",
            `Pintura criou uma entidade adicional usando '${brushAsset}'.`,
            `Evidencia: ${path.basename(paintScreenshot)}.`,
          ].join(" ")
        );

        currentBlock = "D";
        try {
          await waitForBuildRunReady(sessionId, liveValidationTimeoutMs);
        } catch (error) {
          const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
          const details = error instanceof Error ? error.message : String(error);
          fail(diagnostics ? `${details}\n${diagnostics}` : details);
        }

        await clickByTestId(sessionId, "toolbar-build-run");
        await waitFor(
          async () => {
            const status = await executeScript(
              sessionId,
              "return document.querySelector('[data-testid=\"viewport-game-status\"]')?.textContent?.trim() ?? '';"
            );
            return status === "Emulador ativo";
          },
          emulatorActivationTimeoutMs,
          "Build & Run do RC nao ativou o emulador.",
          1000
        );

        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeWorkspace === "game" && state?.activeViewportTab === "game"
              ? state
              : false;
          },
          15000,
          "Workspace de jogo nao ficou ativo apos Build & Run.",
          250
        );

        const gameScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-D-game-view.png`
        );
        registerArtifact(manualQaReport, gameScreenshot, "D - game view");

        await clickByTestId(sessionId, "viewport-pause");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.emulPaused === true ? state : false;
          },
          10000,
          "Botao Pausar nao refletiu o estado pausado.",
          100
        );

        await clickByTestId(sessionId, "viewport-resume");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.emulPaused === false ? state : false;
          },
          10000,
          "Botao Retomar nao restaurou a execucao do emulador.",
          100
        );

        await markManualQaBlock(
          manualQaReport,
          "D",
          "passed",
          [
            "Build & Run concluiu com o emulador ativo.",
            "Pausar/Retomar responderam sem crash.",
            `Evidencia: ${path.basename(gameScreenshot)}.`,
          ].join(" ")
        );

        currentBlock = "E";
        await callAutomationApi(sessionId, "selectWorkspace", ["scene"]);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeWorkspace === "scene" ? state : false;
          },
          10000,
          "Workspace de cena nao voltou antes da validacao de ferramentas.",
          100
        );

        await callAutomationApi(sessionId, "openToolsWorkspace", ["assets", "editing", true]);
        await waitForBodyText(
          sessionId,
          "Asset Browser",
          15000,
          "Asset Browser nao abriu no painel Tools."
        );
        await waitForBodyText(
          sessionId,
          "Assets canonicos",
          20000,
          "Catalogo canonico de assets nao ficou visivel."
        );

        const assetToInstantiate = path.basename(brushAsset);
        const selectedAsset = await executeScript(
          sessionId,
          `
            const normalized = String(arguments[0]).trim();
            const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
              const text = candidate.textContent?.replace(/\\s+/g, " ").trim() ?? "";
              return text.includes(normalized);
            });
            if (!(button instanceof HTMLButtonElement)) {
              return false;
            }
            button.click();
            return true;
          `,
          [assetToInstantiate]
        );
        if (!selectedAsset) {
          fail(`Asset '${assetToInstantiate}' nao foi encontrado no Asset Browser.`);
        }

        await waitForBodyText(
          sessionId,
          "Instanciar",
          10000,
          "Acao de instanciar nao apareceu para o asset selecionado."
        );
        const entityCountBeforeInstantiate = paintedState.activeScene.entityCount;
        await clickButtonByText(sessionId, "Instanciar");
        const instancedState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.entityCount === entityCountBeforeInstantiate + 1 ? state : false;
          },
          15000,
          "Asset Browser nao instanciou um novo sprite na cena ativa.",
          100
        );

        await callAutomationApi(sessionId, "setRightPanelMode", ["inspector"]);
        await waitForBodyText(
          sessionId,
          "Inspector",
          10000,
          "Inspector nao abriu no painel direito."
        );

        const inspectorTargetId = instancedState.selectedEntityId;
        const inspectorTarget = instancedState.activeScene.entities.find(
          (entity) => entity.id === inspectorTargetId
        );
        if (!inspectorTarget) {
          fail("Inspector abriu sem uma entidade valida selecionada.");
        }
        await callAutomationApi(sessionId, "setSelectedEntityId", [inspectorTargetId]);
        await waitFor(
          async () =>
            executeScript(
              sessionId,
              "return Boolean(document.querySelector('[data-testid=\"inspector-prop-pos-x-value\"]'));"
            ),
          15000,
          "Campo Pos X nao ficou disponivel no Inspector.",
          100
        );
        const targetPosX = inspectorTarget.x + 8;
        await updateInspectorIntField(sessionId, "Pos X", targetPosX);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const entity = state?.activeScene?.entities?.find((candidate) => candidate.id === inspectorTargetId);
            return entity?.x === targetPosX ? state : false;
          },
          15000,
          "Inspector nao refletiu a alteracao de Pos X na cena.",
          100
        );
        await callAutomationApi(sessionId, "persistScene", ["Inspector QA RC"]);

        await markManualQaBlock(
          manualQaReport,
          "E",
          "passed",
          [
            `Asset Browser abriu, instanciou '${assetToInstantiate}' e manteve a selecao no Inspector.`,
            `Inspector atualizou Pos X para ${targetPosX}.`,
          ].join(" ")
        );

        currentBlock = "F";
        await callAutomationApi(sessionId, "persistScene", ["Persistencia QA RC"]);

        await deleteSession(sessionId);
        sessionId = "";

        sessionId = await createSession(options.app);
        await waitForAppWindowReady(
          sessionId,
          uiBootstrapTimeoutMs,
          "Janela do app nao reabriu para validar persistencia."
        );
        await waitFor(
          async () =>
            executeScript(
              sessionId,
              "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"
            ),
          uiBootstrapTimeoutMs,
          "API de automacao nao voltou apos reabrir o app"
        );

        await callAutomationApi(sessionId, "openProject", [temporaryProjectDir]);
        const reopenedState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const layer = state?.activeScene?.layers?.find((candidate) => candidate.name === "Fundo");
            const entity = state?.activeScene?.entities?.find((candidate) => candidate.id === inspectorTargetId);
            return state?.activeProjectDir === temporaryProjectDir &&
              layer &&
              entity?.x === targetPosX
              ? state
              : false;
          },
          20000,
          "Projeto RC nao reabriu com as alteracoes persistidas.",
          250
        );

        const reopenScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-F-reopen.png`
        );
        registerArtifact(manualQaReport, reopenScreenshot, "F - reopen");

        await markManualQaBlock(
          manualQaReport,
          "F",
          "passed",
          [
            `Projeto reaberto em '${reopenedState.activeProjectDir}' com camada 'Fundo' e Pos X=${targetPosX}.`,
            `Evidencia: ${path.basename(reopenScreenshot)}.`,
          ].join(" ")
        );

        currentBlock = "G";
        const sgdkDonorFixture = path.join(
          repoRoot,
          "src-tauri",
          "tests",
          "fixtures",
          "projects",
          "sgdk_e2e_donor"
        );
        await access(sgdkDonorFixture, fsConstants.F_OK).catch(() => {
          fail(
            `Fixture SGDK E2E ausente em '${sgdkDonorFixture}'. Este cenario exige o doador versionado no repositorio.`
          );
        });
        const sgdkBaseDir = path.dirname(temporaryProjectDir);
        const sgdkProjectName = `QA_RC_SGTK_${Date.now()}`;
        const sgdkProjectDir = await callAutomationApi(sessionId, "importSgdkProject", [
          sgdkProjectName,
          sgdkBaseDir,
          sgdkDonorFixture,
        ]);
        const importedSgdkState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeProjectDir === sgdkProjectDir && state?.activeScene?.entityCount >= 1
              ? state
              : false;
          },
          60000,
          "Importacao SGDK via automacao nao hidratou o projeto nativo.",
          500
        );
        const normScenePath = (value) => String(value ?? "").replace(/\\/g, "/").replace(/\/+/g, "/");
        const projectRdsParsed = JSON.parse(
          await readFile(path.join(sgdkProjectDir, "project.rds"), "utf8")
        );
        const entrySceneExpected = normScenePath(projectRdsParsed.entry_scene);
        if (!entrySceneExpected) {
          fail("Bloco G: project.rds sem entry_scene apos import SGDK.");
        }
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state && normScenePath(state.activeScenePath) === entrySceneExpected ? state : false;
          },
          20000,
          `Bloco G: IDE abriu cena errada (esperado entry_scene='${entrySceneExpected}', recebido estado activo).`,
          250
        );
        if (String(importedSgdkState.projectSourceKind ?? "") !== "imported_sgdk") {
          fail(
            `Bloco G: projectSourceKind esperado 'imported_sgdk', recebido '${importedSgdkState.projectSourceKind ?? ""}'.`
          );
        }
        const onboardingBlocksImportedScene = await executeScript(
          sessionId,
          "return Boolean(document.querySelector('[data-testid=\"viewport-sgdk-onboarding\"]'));"
        );
        if (onboardingBlocksImportedScene) {
          fail("Bloco G: onboarding SGDK nao deve cobrir a cena quando o import trouxe entidades/camadas.");
        }
        await waitFor(
          async () => {
            const text = await executeScript(
              sessionId,
              "return document.querySelector('[data-testid=\"viewport-asset-health\"]')?.textContent ?? '';"
            );
            return /assets\s+\d+\/\d+/.test(String(text));
          },
          25000,
          "Projeto SGDK importado nao exibiu estado auditavel de assets no viewport.",
          250
        );
        const importedTilemapEntities =
          importedSgdkState.activeScene?.entities?.filter((entity) => entity.type === "tilemap").length ?? 0;
        if (importedTilemapEntities < 1) {
          fail(
            `Bloco G: cena importada devia expor >=1 tilemap auditavel; encontrado ${importedTilemapEntities}.`
          );
        }
        const baseEntityCount = importedSgdkState.activeSceneEntityCount;
        const stageInst = await callAutomationApi(sessionId, "instantiateBrowserImageAsset", [
          "assets/tilesets/stage.png",
        ]);
        if (stageInst.kind !== "tilemap") {
          fail(
            `Bloco G: instantiateBrowserImageAsset(stage) devia ser tilemap; recebido '${stageInst.kind}' (${stageInst.reason}).`
          );
        }
        const heroInst = await callAutomationApi(sessionId, "instantiateBrowserImageAsset", [
          "assets/sprites/hero.png",
        ]);
        if (heroInst.kind !== "sprite") {
          fail(
            `Bloco G: instantiateBrowserImageAsset(hero) devia ser sprite; recebido '${heroInst.kind}' (${heroInst.reason}).`
          );
        }
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state && state.activeSceneEntityCount >= baseEntityCount + 2 ? state : false;
          },
          20000,
          "Bloco G: instanciacoes canonicas via automacao nao aumentaram entityCount como esperado.",
          250
        );
        await callAutomationApi(sessionId, "setRightPanelMode", ["inspector"]);
        const importedEntityId =
          importedSgdkState?.activeScene?.entities?.find((entity) => entity.type === "tilemap")?.id ??
          importedSgdkState?.activeScene?.entities?.find((entity) => entity.type === "sprite")?.id ??
          importedSgdkState?.activeScene?.entities?.[0]?.id;
        if (importedEntityId) {
          await callAutomationApi(sessionId, "setSelectedEntityId", [importedEntityId]);
          await waitFor(
            async () => {
              return executeScript(
                sessionId,
                `return Boolean(
                  document.querySelector('[data-testid="inspector-tilemap-legacy-fallback"]') ||
                  document.querySelector('[data-testid="inspector-asset-preview"]') ||
                  document.querySelector('[data-testid="inspector-asset-preview-fallback"]') ||
                  document.querySelector('[data-testid="inspector-tilemap-preview"]') ||
                  document.querySelector('[data-testid="inspector-tilemap-preview-fallback"]')
                ) ||
                  (document.body.textContent || '').includes('Estado visual:') ||
                  (document.body.textContent || '').includes('Estado visual (tileset):');`
              );
            },
            25000,
            "Inspector nao exibiu preview/fallback auditavel para entidade importada SGDK.",
            250
          );
        }
        const importedSpriteEntities =
          importedSgdkState?.activeScene?.entities?.filter((entity) => entity.type === "sprite") ?? [];
        const uniqueSpritePositions = new Set(
          importedSpriteEntities.map((entity) => `${entity.x}:${entity.y}`)
        );
        const denseSceneNote =
          importedSpriteEntities.length > 0
            ? `Cena densa: ${importedSpriteEntities.length} sprite(s) importado(s) com ${uniqueSpritePositions.size} posicao(oes) distintas no bootstrap da cena.`
            : "Cena densa: fixture sem sprite importado suficiente para aferir distribuicao.";
        const importedSceneScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-scene-authoring.png`
        );
        registerArtifact(manualQaReport, importedSceneScreenshot, "G - imported scene authoring");
        let denseWorkflowNote = "Cena densa: fixture sem sprites suficientes para provar picker/solo.";
        if (importedSpriteEntities.length >= 2) {
          const stackX = 72;
          const stackY = 72;
          const firstStackEntity = importedSpriteEntities[0];
          const secondStackEntity = importedSpriteEntities[1];
          await callAutomationApi(sessionId, "selectWorkspace", ["scene"]);
          await callAutomationApi(sessionId, "setEditorMode", ["select"]);
          await callAutomationApi(sessionId, "setEntityTransform", [firstStackEntity.id, stackX, stackY]);
          await callAutomationApi(sessionId, "setEntityTransform", [secondStackEntity.id, stackX, stackY]);
          const stackedState = await waitFor(
            async () => {
              const state = await readAutomationState(sessionId);
              const stackedEntities = state?.activeScene?.entities?.filter(
                (entity) =>
                  (entity.id === firstStackEntity.id || entity.id === secondStackEntity.id) &&
                  entity.x === stackX &&
                  entity.y === stackY
              );
              return stackedEntities?.length === 2 && state?.editorMode === "select" ? state : false;
            },
            10000,
            "Bloco G: empilhamento de entidades densas nao apareceu no estado ativo.",
            100
          );
          const worldBounds = stackedState.activeScene?.worldBounds ?? { minX: 0, minY: 0 };
          await sceneOverlayPointerAction(
            sessionId,
            stackX - worldBounds.minX + 12,
            stackY - worldBounds.minY + 12,
            0,
            { shiftKey: true }
          );
          await waitFor(
            async () =>
              executeScript(
                sessionId,
                "return Boolean(document.querySelector('[data-testid=\"viewport-dense-stack-picker\"]'));"
              ),
            15000,
            "Bloco G: Shift+clique em pilha densa nao abriu o picker contextual.",
            250
          );
          await executeScript(
            sessionId,
            `
              const button = document.querySelector('[data-testid="viewport-dense-stack-solo-preview"]');
              if (!(button instanceof HTMLButtonElement)) {
                return false;
              }
              button.click();
              return true;
            `
          );
          await waitFor(
            async () => {
              const state = await readAutomationState(sessionId);
              const dockText = await executeScript(
                sessionId,
                "return document.querySelector('[data-testid=\"viewport-creator-command-dock\"]')?.textContent ?? '';"
              );
              return state?.selectedEntityId && String(dockText).includes("Solo:") ? { state, dockText } : false;
            },
            15000,
            "Bloco G: picker denso nao selecionou/focou com solo ativo.",
            250
          );
          const denseSoloScreenshot = await captureScreenshot(
            sessionId,
            `${artifactPrefix}-G-dense-solo-authoring.png`
          );
          registerArtifact(manualQaReport, denseSoloScreenshot, "G - dense selection solo");
          denseWorkflowNote = [
            `Cena densa: '${firstStackEntity.id}' e '${secondStackEntity.id}' empilhados em ${stackX},${stackY}; Shift+clique abriu picker e 'Isolar alvo' ativou solo/foco.`,
            `Evidencia: ${path.basename(denseSoloScreenshot)}.`,
          ].join(" ");
        }
        const importedTilemapEntityId =
          importedSgdkState?.activeScene?.entities?.find((entity) => entity.type === "tilemap")?.id ??
          null;
        const sgdkLogicEntityId =
          importedSgdkState?.activeScene?.entities?.find((entity) => entity.type === "sprite")?.id ??
          importedSgdkState?.activeScene?.entities?.[0]?.id;
        if (!sgdkLogicEntityId) {
          fail("Bloco G: nenhuma entidade alvo encontrada para validar graph_ref no projeto SGDK.");
        }
        let tilemapWorkflowNote = "Tilemap workflow: sem tilemap importado selecionavel para prova adicional.";
        if (importedTilemapEntityId) {
          await callAutomationApi(sessionId, "setRightPanelMode", ["inspector"]);
          await callAutomationApi(sessionId, "setSelectedEntityId", [importedTilemapEntityId]);
          await clickButtonByText(sessionId, "Editar tilemap no viewport");
          const tilemapEditingState = await waitFor(
            async () => {
              const state = await readAutomationState(sessionId);
              return state?.activeWorkspace === "scene" &&
                state?.activeViewportTab === "scene" &&
                state?.editorMode === "paint" &&
                state?.activeTilemapId === importedTilemapEntityId
                ? state
                : false;
            },
            15000,
            "Bloco G: tilemap importado nao entrou no fluxo de pintura canonico.",
            250
          );
          const worldStripText = await executeScript(
            sessionId,
            "return document.querySelector('[data-testid=\"viewport-world-authoring-strip\"]')?.textContent ?? '';"
          );
          const tilemapScreenshot = await captureScreenshot(
            sessionId,
            `${artifactPrefix}-G-tilemap-authoring.png`
          );
          registerArtifact(manualQaReport, tilemapScreenshot, "G - tilemap authoring");
          tilemapWorkflowNote = [
            `Tilemap workflow: '${importedTilemapEntityId}' entrou em editorMode='${tilemapEditingState.editorMode}' com activeTilemapId='${tilemapEditingState.activeTilemapId}'.`,
            worldStripText
              ? `Faixa mundo/camera visivel: ${String(worldStripText).replace(/\s+/g, " ").trim()}.`
              : "Faixa mundo/camera nao apareceu para esta fixture (registrado sem maquiar).",
            `Evidencia: ${path.basename(tilemapScreenshot)}.`,
          ].join(" ");
        }
        await callAutomationApi(sessionId, "setRightPanelMode", ["inspector"]);
        await callAutomationApi(sessionId, "setSelectedEntityId", [sgdkLogicEntityId]);
        await waitFor(
          async () =>
            executeScript(
              sessionId,
              `const button = document.querySelector('[data-testid="inspector-open-logic-workspace"]');
               return button instanceof HTMLButtonElement && !button.disabled;`
            ),
          15000,
          "Bloco G: botao Objeto -> Logica nao ficou disponivel no Inspector.",
          250
        );
        await clickButtonByTestId(sessionId, "inspector-open-logic-workspace");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeWorkspace === "logic" && state?.activeViewportTab === "logic"
              ? state
              : false;
          },
          15000,
          "Bloco G: navegacao objeto -> logica nao ativou o Logic Workspace.",
          250
        );
        const navigationLogicState = await callAutomationApi(sessionId, "getEntityLogicState", [sgdkLogicEntityId]);
        const primarySourceRef =
          navigationLogicState?.source?.source_paths?.[0] ??
          navigationLogicState?.source?.external_source_refs?.[0] ??
          null;
        if (!primarySourceRef) {
          fail(`Bloco G: entidade '${sgdkLogicEntityId}' sem source_paths/external_source_refs navegaveis.`);
        }
        const openedSourceAttempt = await tryAutomationApi(
          sessionId,
          "openEntitySourcePath",
          [sgdkLogicEntityId, primarySourceRef],
          8000
        );
        const logicScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-logic-authoring.png`
        );
        registerArtifact(manualQaReport, logicScreenshot, "G - logic authoring");
        const sourceNavigationSummary = openedSourceAttempt?.ok
          ? `fonte '${openedSourceAttempt.value?.relative_path ?? primarySourceRef}' acionada no host`
          : `fallback honesto para '${primarySourceRef}': ${openedSourceAttempt?.reason ?? "sem retorno do host"}`;
        const logicSourceNote = [
          `Objeto -> logica -> fonte: entidade '${sgdkLogicEntityId}' abriu Logic Workspace; ${sourceNavigationSummary}.`,
          `Evidencia: ${path.basename(logicScreenshot)}.`,
        ].join(" ");
        // Com Option B, Logic oculta o painel direito global; o Inspector so volta a montar em Scene/Debug.
        await callAutomationApi(sessionId, "selectWorkspace", ["scene"]);
        await callAutomationApi(sessionId, "setRightPanelMode", ["inspector"]);
        await callAutomationApi(sessionId, "setSelectedEntityId", [sgdkLogicEntityId]);
        await waitFor(
          async () =>
            executeScript(
              sessionId,
              `const button = document.querySelector('[data-testid="inspector-open-art-workspace"]');
               return button instanceof HTMLButtonElement && !button.disabled;`
            ),
          15000,
          "Bloco G: botao Objeto -> Art nao ficou disponivel no Inspector.",
          250
        );
        await clickButtonByTestId(sessionId, "inspector-open-art-workspace");
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const hasArtSurface = await executeScript(
              sessionId,
              "return Boolean(document.querySelector('[data-testid=\"artstudio-main-stage\"]') && document.querySelector('[data-testid=\"artstudio-scene-context-bridge\"]'));"
            );
            return state?.activeWorkspace === "artstudio" &&
              state?.activeViewportTab === "artstudio" &&
              state?.selectedEntityId === sgdkLogicEntityId &&
              hasArtSurface
              ? state
              : false;
          },
          15000,
          "Bloco G: navegacao objeto -> art nao abriu o Art Workspace integrado.",
          250
        );
        const artScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-art-workspace.png`
        );
        registerArtifact(manualQaReport, artScreenshot, "G - art workspace");
        await callAutomationApi(sessionId, "selectWorkspace", ["scene"]);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeWorkspace === "scene" && state?.selectedEntityId === sgdkLogicEntityId
              ? state
              : false;
          },
          15000,
          "Bloco G: retorno Art -> Scene perdeu contexto da entidade selecionada.",
          250
        );
        const artWorkspaceNote = [
          `Art integrado: '${sgdkLogicEntityId}' abriu Art Workspace com stage/plano de apply e retornou ao Scene sem perder selectedEntityId.`,
          `Evidencia: ${path.basename(artScreenshot)}.`,
        ].join(" ");
        const initialLogicState = await callAutomationApi(sessionId, "getEntityLogicState", [sgdkLogicEntityId]);
        if (!initialLogicState?.source?.graph_ref) {
          fail(
            `Bloco G: entidade '${sgdkLogicEntityId}' sem graph_ref no source ao abrir projeto SGDK importado.`
          );
        }
        const editedGraphJson = JSON.stringify({
          version: 1,
          nodes: [
            {
              id: "node_start",
              type: "event_start",
              label: "On Start",
              x: 64,
              y: 64,
              inputs: [],
              outputs: [{ id: "exec", label: ">", kind: "exec" }],
              params: {},
            },
            {
              id: "node_edited_move",
              type: "sprite_move",
              label: "Move Sprite",
              x: 224,
              y: 64,
              inputs: [{ id: "exec", label: ">", kind: "exec" }],
              outputs: [{ id: "exec", label: ">", kind: "exec" }],
              params: { target: sgdkLogicEntityId, dx: 3, dy: 0 },
            },
          ],
          edges: [
            {
              id: "edge_start_move",
              fromNode: "node_start",
              fromPort: "exec",
              toNode: "node_edited_move",
              toPort: "exec",
            },
          ],
        });
        await callAutomationApi(sessionId, "setEntityLogicGraph", [sgdkLogicEntityId, editedGraphJson]);

        await callAutomationApi(sessionId, "selectWorkspace", ["scene"]);
        await pressKey(sessionId, "c", { code: "KeyC" });
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.editorMode === "collision" ? state : false;
          },
          15000,
          "Modo colisao nao ativou no projeto SGDK importado.",
          250
        );
        await sceneOverlayPointerAction(sessionId, 32, 32, 0);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeScene?.collisionSolidCount >= 1 ? state : false;
          },
          15000,
          "Clique de colisao nao persistiu no projeto SGDK importado.",
          250
        );
        await callAutomationApi(sessionId, "persistScene", ["SGDK import QA RC"]);
        await pressKey(sessionId, "Escape", { code: "Escape" });

        await deleteSession(sessionId);
        sessionId = "";
        sessionId = await createSession(options.app);
        await waitForAppWindowReady(
          sessionId,
          uiBootstrapTimeoutMs,
          "Janela do app nao reabriu para validar SGDK reaberto."
        );
        await waitFor(
          async () =>
            executeScript(
              sessionId,
              "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"
            ),
          uiBootstrapTimeoutMs,
          "API de automacao nao voltou apos reabrir para bloco G"
        );
        await callAutomationApi(sessionId, "openProject", [sgdkProjectDir]);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.activeProjectDir === sgdkProjectDir &&
              state?.activeScene?.collisionSolidCount >= 1
              ? state
              : false;
          },
          25000,
          "Projeto SGDK nao reabriu com colisao editada.",
          250
        );
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state && normScenePath(state.activeScenePath) === entrySceneExpected ? state : false;
          },
          15000,
          `Bloco G reopen: cena activa diferente de entry_scene ('${entrySceneExpected}').`,
          250
        );
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state && state.activeSceneEntityCount >= baseEntityCount + 2 ? state : false;
          },
          20000,
          "Bloco G reopen: entidades instanciadas nao foram persistidas/rehidratadas.",
          250
        );
        await waitFor(
          async () => {
            const text = await executeScript(
              sessionId,
              "return document.querySelector('[data-testid=\"viewport-asset-health\"]')?.textContent ?? '';"
            );
            return /assets\s+\d+\/\d+/.test(String(text));
          },
          25000,
          "Projeto SGDK reaberto sem estado auditavel de assets no viewport.",
          250
        );
        const reopenedLogicState = await callAutomationApi(sessionId, "getEntityLogicState", [sgdkLogicEntityId]);
        if (!reopenedLogicState?.source?.graph_ref) {
          fail(
            `Bloco G: graph_ref da entidade '${sgdkLogicEntityId}' perdeu referencia apos reopen do SGDK.`
          );
        }
        if (reopenedLogicState?.source?.graph_origin !== "user_edited_ref") {
          fail(
            `Bloco G: graph_origin esperado 'user_edited_ref' apos editar e salvar; recebido '${reopenedLogicState?.source?.graph_origin ?? "null"}'.`
          );
        }
        const graphRefRelative = String(reopenedLogicState.source.graph_ref).replace(/^graphs[\\/]/i, "");
        const graphRefAbs = path.join(sgdkProjectDir, "graphs", graphRefRelative);
        const graphRefContent = await readFile(graphRefAbs, "utf8");
        if (!graphRefContent.includes("node_edited_move")) {
          fail(
            `Bloco G: graph_ref '${reopenedLogicState.source.graph_ref}' nao contem o no editado esperado apos reopen.`
          );
        }

        try {
          await waitForBuildRunReady(sessionId, liveValidationTimeoutMs);
        } catch (error) {
          const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
          const details = error instanceof Error ? error.message : String(error);
          fail(diagnostics ? `${details}\n${diagnostics}` : details);
        }
        await clickByTestId(sessionId, "toolbar-build-run");
        try {
          await waitFor(
            async () => {
              const status = await executeScript(
                sessionId,
                "return document.querySelector('[data-testid=\"viewport-game-status\"]')?.textContent?.trim() ?? '';"
              );
              return status === "Emulador ativo";
            },
            emulatorActivationTimeoutMs,
            "Build & Run do projeto SGDK importado nao ativou o emulador.",
            1000
          );
        } catch (buildRunError) {
          const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
          const details = buildRunError instanceof Error ? buildRunError.message : String(buildRunError);
          fail(diagnostics ? `${details}\n${diagnostics}` : details);
        }

        // ROM lives in build/megadrive/out/ for native RDS projects
        const buildOutDir = path.join(sgdkProjectDir, "build", "megadrive", "out");
        const legacyOutDir = path.join(sgdkProjectDir, "out");
        const outDir = await pathExists(buildOutDir) ? buildOutDir : legacyOutDir;
        const outEntries = await readdir(outDir).catch(() => []);
        const romName = outEntries.find((entry) => {
          const lower = entry.toLowerCase();
          return lower.endsWith(".md") || lower.endsWith(".bin") || lower.endsWith(".gen");
        });
        if (!romName) {
          fail(
            `Bloco G: nenhuma ROM .md encontrada em '${outDir}' (entradas: ${outEntries.join(", ") || "(vazio)"}).`
          );
        }
        const romAbs = path.join(outDir, romName);
        const romBytes = await readFile(romAbs);
        const segBuf = Buffer.from("SEGA", "ascii");
        if (!romBytes.includes(segBuf)) {
          fail(
            `Bloco G: ficheiro '${romName}' (${romBytes.length} B) nao contem marca 'SEGA' esperada para ROM Mega Drive.`
          );
        }

        const sgdkChainShot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-sgdk-chain.png`
        );
        registerArtifact(manualQaReport, sgdkChainShot, "G - sgdk import reopen build rom");

        currentBlock = "H";
        await callAutomationApi(sessionId, "setConsoleVisible", [false]);
        const layoutWorkspaceIds = ["scene", "logic", "game", "debug"];
        const layoutShotNames = [];
        const layoutValidationNotes = [];
        for (const resolution of UI_LAYOUT_CAPTURE_RESOLUTIONS) {
          await setSessionWindowRect(sessionId, resolution.width, resolution.height);
          for (const workspaceId of layoutWorkspaceIds) {
            await callAutomationApi(sessionId, "selectWorkspace", [workspaceId]);
            await waitFor(
              async () => {
                const state = await readAutomationState(sessionId);
                if (!state || state.activeWorkspace !== workspaceId) {
                  return false;
                }
                if (workspaceId === "logic") {
                  const ready = await executeScript(
                    sessionId,
                    `return Boolean(
                      document.querySelector('[data-testid="nodegraph-side-rail"]') &&
                      document.querySelector('[data-testid="nodegraph-canvas"]')
                    );`
                  );
                  return ready ? state : false;
                }
                return state;
              },
              workspaceId === "logic" ? 25000 : 15000,
              `Bloco H: workspace '${workspaceId}' nao ativou em ${resolution.tag}.`,
              250
            );
            await assertUiLayoutHealth(sessionId, workspaceId, resolution.tag);
            layoutValidationNotes.push(`${resolution.tag}/${workspaceId}:ok`);
            const layoutShot = await captureScreenshot(
              sessionId,
              `${artifactPrefix}-H-ui-layout-${resolution.tag}-${workspaceId}.png`
            );
            registerArtifact(
              manualQaReport,
              layoutShot,
              `H - ui layout ${resolution.tag} ${workspaceId}`
            );
            layoutShotNames.push(path.basename(layoutShot));
          }
        }
        await markManualQaBlock(
          manualQaReport,
          "H",
          "passed",
          [
            `QA visual de layout: ${UI_LAYOUT_CAPTURE_RESOLUTIONS.length} resolucoes x ${layoutWorkspaceIds.length} workspaces (Scene, Logic, Game, Debug) com validacao automatica de shell (topbar, paineis, console, nodegraph).`,
            `Validacoes: ${layoutValidationNotes.join(", ")}.`,
            `Evidencias: ${layoutShotNames.join(", ")}.`,
          ].join(" ")
        );

        await markManualQaBlock(
          manualQaReport,
          "G",
          "passed",
          [
            `Import SGDK -> cena activa == entry_scene ('${entrySceneExpected}') -> projectSourceKind=imported_sgdk -> onboarding nao bloqueia -> viewport asset health -> Inspector preview -> instantiateBrowserImageAsset(stage)=tilemap(${stageInst.reason}) + hero=sprite(${heroInst.reason}) -> persistencias -> reopen mantem cena/entidades -> editar graph_ref '${sgdkLogicEntityId}' -> colisao -> persistir -> reabrir -> Build & Run -> ROM '${romName}' SEGA.`,
            denseSceneNote,
            denseWorkflowNote,
            tilemapWorkflowNote,
            logicSourceNote,
            artWorkspaceNote,
            `graph_ref '${reopenedLogicState.source.graph_ref}' preservado com graph_origin='${reopenedLogicState.source.graph_origin}' e no 'node_edited_move' confirmado em disco.`,
            `Projeto: ${sgdkProjectDir}`,
            `Evidencia: ${path.basename(sgdkChainShot)}.`,
          ].join(" ")
        );

        await writeManualQaReport(manualQaReport);
        console.log("OK: Desktop Tauri QA RC A-H passou.");
        console.log(`Projeto criado: ${generatedProjectName}`);
        console.log(`Diretorio temporario: ${temporaryProjectDir}`);
        console.log(`Relatorio QA: ${manualQaStatusPath}`);
        for (const artifact of manualQaReport.artifacts) {
          console.log(`Evidencias: ${artifact.path}`);
        }
        return;
      } catch (error) {
        const failure = classifyFailureMetadata(error);
        await markManualQaBlock(
          manualQaReport,
          currentBlock,
          "failed",
          `Falha no bloco ${currentBlock}: ${failure.message}`,
          {
            statusCode: failure.statusCode,
            errorCategory: failure.errorCategory,
          }
        );
        throw error;
      }
    }

    if (options.scenario === "build-blocked-diagnostic") {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rds-build-blocked-diagnostic-"));
      const copiedProject = path.join(tempRoot, path.basename(options.project));
      await cp(options.project, copiedProject, { recursive: true });
      options.project = copiedProject;
      temporaryProjectDir = tempRoot;
      if (currentE2eRunContext) {
        currentE2eRunContext.project = copiedProject;
      }
    }

    const openResult = await executeAsyncScript(
      sessionId,
      `
        const done = arguments[arguments.length - 1];
        const api = window.__RDS_E2E__;
        if (!api) {
          done({ ok: false, error: "window.__RDS_E2E__ indisponivel" });
          return;
        }
        api
          .openProject(arguments[0])
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: String(error) }));
      `,
      [options.project]
    );

    if (!openResult?.ok) {
      const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
      fail(
        [
          `Falha ao abrir projeto no app: ${openResult?.error ?? "sem diagnostico"}`,
          diagnostics,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    try {
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.activeProjectDir && state.activeProjectName ? state : false;
        },
        15000,
        "Projeto nao apareceu na UI"
      );
    } catch (error) {
      const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
      const details = error instanceof Error ? error.message : String(error);
      fail(
        [
          details,
          diagnostics,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    if (options.scenario === "live-ok") {
      const liveOkScenario = buildLiveOkScenario(projectMetadata.target);
      await setSceneDraft(sessionId, liveOkScenario.draft);

      let lastLiveStatus = null;
      let liveStatus;
      try {
        liveStatus = await waitFor(
          async () => {
            const status = await readLiveStatus(sessionId);
            lastLiveStatus = status;
            return !status?.disabled &&
              !status?.describedBy &&
              !status?.reason &&
              !status?.summary &&
              !status?.errorSummary &&
              !status?.pendingSummary &&
              !status?.staleHint &&
              !status?.hasStaleRevalidateButton &&
              !status?.warning &&
              !status?.error &&
              status?.liveState === liveOkScenario.expectedToolbarState &&
              status?.liveStateDetail.includes(liveOkScenario.expectedDetailFragment)
              ? status
              : false;
          },
          liveValidationTimeoutMs,
          "UI live nao refletiu o estado LIVE sincronizado para o draft saudavel.",
          250
        );
      } catch (error) {
        const fallbackLiveStatus = await readLiveStatus(sessionId).catch(() => null);
        const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
        const details = error instanceof Error ? error.message : String(error);
        fail(
          [
            details,
            formatLiveStatus(fallbackLiveStatus ?? lastLiveStatus),
            diagnostics,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }

      const state = await executeScript(
        sessionId,
        "return window.__RDS_E2E__?.getState() ?? null;"
      );
      if (!state) {
        fail("Estado de automacao do app nao esta disponivel.");
      }

      if (state.activeTarget !== projectMetadata.target) {
        fail(
          `Target hidratado incorretamente. Esperado: ${projectMetadata.target}. Atual: ${state.activeTarget}`
        );
      }

      if (state.consoleEntries.some((entry) => entry.message.includes("Iniciando build..."))) {
        fail("Console indicou inicio de build durante cenario live-ok.");
      }

      console.log("OK: Desktop Tauri live healthy state E2E passou.");
      console.log(`Projeto: ${options.project}`);
      console.log(`Target: ${projectMetadata.target}`);
      console.log(`Estado: ${liveStatus.liveState}`);
      return;
    }

    if (
      options.scenario === "live-overflow" ||
      options.scenario === "live-overflow-vram" ||
      options.scenario === "live-warning-vram" ||
      options.scenario === "live-warning-sprites" ||
      options.scenario === "live-error"
    ) {
      const overflowScenario = buildLiveOverflowScenario(projectMetadata.target, options.scenario);
      await setSceneDraft(sessionId, overflowScenario.draft);

      let lastLiveStatus = null;
      let liveStatus;
      try {
        liveStatus = await waitFor(
          async () => {
            const result = await readLiveStatus(sessionId);
            lastLiveStatus = result;
            if (overflowScenario.expectLiveError) {
              return !result?.disabled &&
                !result?.reason &&
                result?.liveState === overflowScenario.expectedToolbarState &&
                result?.errorSummary.includes(overflowScenario.expectedReasonFragment)
                ? result
                : false;
            }
            if (
              result?.severity !== overflowScenario.expectedSeverity ||
              result?.liveState !== overflowScenario.expectedToolbarState
            ) {
              return false;
            }
            if (overflowScenario.expectBuildDisabled) {
              return result?.disabled && result?.reason.includes("Build bloqueado:") ? result : false;
            }
            return !result?.disabled &&
              result?.warning.includes(overflowScenario.expectedReasonFragment) &&
              result?.summary.includes(overflowScenario.expectedReasonFragment)
              ? result
              : false;
          },
          liveValidationTimeoutMs,
          "UI live nao refletiu o estado esperado para o draft injetado",
          500
        );
      } catch (error) {
        const fallbackLiveStatus = await readLiveStatus(sessionId).catch(() => null);
        const rawDiagnostics = await collectAppDiagnostics(sessionId);
        const diagnosticLiveStatus = deriveLiveStatusFromDiagnostics(rawDiagnostics);
        if (diagnosticLiveStatus) {
          const diagnosticsMatch = overflowScenario.expectLiveError
            ? !diagnosticLiveStatus.disabled &&
              !diagnosticLiveStatus.reason &&
              diagnosticLiveStatus.liveState === overflowScenario.expectedToolbarState &&
              diagnosticLiveStatus.errorSummary.includes(overflowScenario.expectedReasonFragment)
            : overflowScenario.expectBuildDisabled
              ? diagnosticLiveStatus.disabled &&
                diagnosticLiveStatus.liveState === overflowScenario.expectedToolbarState &&
                diagnosticLiveStatus.reason.includes(overflowScenario.expectedReasonFragment) &&
                diagnosticLiveStatus.severity === overflowScenario.expectedSeverity
              : !diagnosticLiveStatus.disabled &&
                diagnosticLiveStatus.liveState === overflowScenario.expectedToolbarState &&
                diagnosticLiveStatus.summary.includes(overflowScenario.expectedReasonFragment) &&
                diagnosticLiveStatus.severity === overflowScenario.expectedSeverity;

          if (diagnosticsMatch) {
            liveStatus = diagnosticLiveStatus;
          }
        }

        if (liveStatus) {
          console.log("OK: Desktop Tauri live hardware state E2E passou via fallback de diagnostico.");
          console.log(`Projeto: ${options.project}`);
          console.log(`Target: ${projectMetadata.target}`);
          console.log(
            overflowScenario.expectBuildDisabled
              ? `Motivo visual: ${liveStatus.reason}`
              : overflowScenario.expectLiveError
                ? `Erro visual: ${liveStatus.errorSummary}`
                : `Warning visual: ${liveStatus.summary}`
          );
          return;
        }

        const diagnostics = formatAppDiagnostics(rawDiagnostics);
        const details = error instanceof Error ? error.message : String(error);
        fail(
          [
            details,
            formatLiveStatus(fallbackLiveStatus ?? lastLiveStatus),
            diagnostics,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }

      if (overflowScenario.expectBuildDisabled) {
        if (liveStatus.describedBy !== "build-disabled-reason") {
          fail(`Botao Build nao expoe aria-describedby esperado. Atual: ${liveStatus.describedBy}`);
        }

        if (!liveStatus.reason.includes(overflowScenario.expectedReasonFragment)) {
          fail(`Motivo visual inesperado para overflow live: ${liveStatus.reason}`);
        }
      } else if (overflowScenario.expectLiveError) {
        if (liveStatus.describedBy) {
          fail(`Build ficou associado a um motivo de bloqueio durante ERRO LIVE: ${liveStatus.describedBy}`);
        }

        if (liveStatus.reason) {
          fail(`Build exibiu motivo de bloqueio indevido durante ERRO LIVE: ${liveStatus.reason}`);
        }

        if (!liveStatus.errorSummary.includes(overflowScenario.expectedReasonFragment)) {
          fail(`Toolbar nao exibiu o resumo esperado de ERRO LIVE: ${liveStatus.errorSummary}`);
        }
      } else {
        if (liveStatus.describedBy) {
          fail(`Build ficou associado a um motivo de bloqueio mesmo com warning: ${liveStatus.describedBy}`);
        }

        if (liveStatus.reason) {
          fail(`Build exibiu motivo de bloqueio indevido: ${liveStatus.reason}`);
        }

        if (!liveStatus.summary.includes(overflowScenario.expectedReasonFragment)) {
          fail(`Toolbar nao exibiu o warning esperado: ${liveStatus.summary}`);
        }

        if (!liveStatus.warning.includes(overflowScenario.expectedReasonFragment)) {
          fail(`Painel de hardware nao exibiu o warning esperado: ${liveStatus.warning}`);
        }
      }

      const state = await executeScript(
        sessionId,
        "return window.__RDS_E2E__?.getState() ?? null;"
      );
      if (!state) {
        fail("Estado de automacao do app nao esta disponivel.");
      }

      if (state.activeTarget !== projectMetadata.target) {
        fail(
          `Target hidratado incorretamente. Esperado: ${projectMetadata.target}. Atual: ${state.activeTarget}`
        );
      }

      if (state.consoleEntries.some((entry) => entry.message.includes("Iniciando build..."))) {
        fail("Console indicou inicio de build mesmo com bloqueio live.");
      }

      console.log("OK: Desktop Tauri live hardware state E2E passou.");
      console.log(`Projeto: ${options.project}`);
      console.log(`Target: ${projectMetadata.target}`);
      console.log(
        overflowScenario.expectBuildDisabled
          ? `Motivo visual: ${liveStatus.reason}`
          : overflowScenario.expectLiveError
            ? `Erro visual: ${liveStatus.errorSummary}`
          : `Warning visual: ${liveStatus.summary}`
      );
      return;
    }

    if (options.scenario === "live-stale") {
      const staleScenario = buildLiveStaleScenario(projectMetadata.target);
      await setSceneDraft(sessionId, staleScenario.firstDraft);

      await waitFor(
        async () => {
          const status = await readLiveStatus(sessionId);
          return status.liveState === "LIVE" ? status : false;
        },
        liveValidationTimeoutMs,
        "Live nao estabilizou em estado fresco antes do cenario stale",
        250
      );

      await setSceneDraft(sessionId, staleScenario.secondDraft);

      const staleStatus = await waitFor(
        async () => {
          const status = await readLiveStatus(sessionId);
          return status.liveState === "DESATUAL." &&
            !status.disabled &&
            !status.reason &&
            status.staleHint.includes("Edite a cena para revalidar") &&
            status.hasStaleRevalidateButton
            ? status
            : false;
        },
        liveValidationTimeoutMs,
        "UI live nao refletiu o estado DESATUAL. com acao explicita",
        100
      );

      const clickedRevalidate = await executeScript(
        sessionId,
        `
          const button = document.querySelector('[data-testid="build-stale-revalidate"]');
          if (!button) return false;
          button.click();
          return true;
        `
      );

      if (!clickedRevalidate) {
        fail("Botao Revalidar agora nao ficou disponivel no estado DESATUAL.");
      }

      const validationStatus = await waitFor(
        async () => {
          const status = await readLiveStatus(sessionId);
          if (status.disabled || status.reason) {
            return false;
          }
          if (
            status.liveState === "ANALISANDO" &&
            status.pendingSummary.includes("Live em analise")
          ) {
            return status;
          }
          if (status.liveState === "LIVE" && status.liveStateDetail.includes("Preview live sincronizado")) {
            return status;
          }
          return false;
        },
        liveValidationTimeoutMs,
        "UI live nao refletiu ANALISANDO ou LIVE apos revalidacao manual",
        50
      );

      const state = await executeScript(
        sessionId,
        "return window.__RDS_E2E__?.getState() ?? null;"
      );
      if (!state) {
        fail("Estado de automacao do app nao esta disponivel.");
      }

      if (state.activeTarget !== projectMetadata.target) {
        fail(
          `Target hidratado incorretamente. Esperado: ${projectMetadata.target}. Atual: ${state.activeTarget}`
        );
      }

      if (
        !state.consoleEntries.some((entry) =>
          entry.message.includes("[Live] Revalidacao manual solicitada.")
        )
      ) {
        fail("Console nao registrou a solicitacao de revalidacao manual.");
      }

      if (state.consoleEntries.some((entry) => entry.message.includes("Iniciando build..."))) {
        fail("Console indicou inicio de build durante cenario live stale.");
      }

      console.log("OK: Desktop Tauri live stale/revalidate E2E passou.");
      console.log(`Projeto: ${options.project}`);
      console.log(`Target: ${projectMetadata.target}`);
      console.log(`Estado stale: ${staleStatus.liveState} | Hint: ${staleStatus.staleHint}`);
      console.log(
        `Estado apos revalidar: ${validationStatus.liveState} | Resumo: ${
          validationStatus.pendingSummary || validationStatus.liveStateDetail
        }`
      );
      return;
    }

    if (options.scenario === "build-blocked-diagnostic") {
      await setSceneDraft(sessionId, buildMissingAssetScene(projectMetadata.target));

      try {
        await waitForBuildRunReady(sessionId, liveValidationTimeoutMs);
      } catch (error) {
        const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
        const details = error instanceof Error ? error.message : String(error);
        fail(diagnostics ? `${details}\n${diagnostics}` : details);
      }

      await clickByTestId(sessionId, "toolbar-build-run");

      const diagnosticState = await waitFor(
        async () => {
          const state = await executeScript(
            sessionId,
            "return window.__RDS_E2E__?.getState() ?? null;"
          );
          if (!state?.consoleEntries?.length) {
            return false;
          }
          const actionable = state.consoleEntries.find(
            (entry) =>
              entry.diagnostic?.area === "build_sgdk" ||
              entry.diagnostic?.area === "build_snes"
          );
          return actionable?.message?.includes("Build falhou porque") ? state : false;
        },
        emulatorActivationTimeoutMs,
        "Build bloqueado nao exibiu diagnostico acionavel.",
        500
      );

      const actionableEntry = diagnosticState.consoleEntries.find(
        (entry) =>
          entry.diagnostic?.area === "build_sgdk" ||
          entry.diagnostic?.area === "build_snes"
      );
      if (!actionableEntry) {
        fail("Console nao registrou diagnostico de build estruturado.");
      }

      if (actionableEntry.message.includes("Build failed")) {
        fail(`Console exibiu erro generico em vez de diagnostico acionavel: ${actionableEntry.message}`);
      }

      if (!actionableEntry.message.includes("Acao recomendada")) {
        fail(`Diagnostico nao incluiu acao recomendada: ${actionableEntry.message}`);
      }

      const drawerState = await executeScript(
        sessionId,
        `
          const drawer = document.querySelector('[data-testid="console-drawer"]');
          const details = document.querySelector('[data-testid="console-details"]');
          const technical = document.querySelector('[data-testid="console-details-technical"]');
          const copy = document.querySelector('[data-testid="console-copy-diagnostic"]');
          const evidence = document.querySelector('[data-testid="console-evidence-link"]');
          return {
            drawerText: drawer?.textContent ?? "",
            detailsText: details?.textContent ?? "",
            technicalClosed: technical ? !technical.open : false,
            hasCopy: Boolean(copy),
            hasEvidence: Boolean(evidence),
          };
        `
      );

      if (!drawerState?.drawerText?.includes("Build falhou porque")) {
        fail("Console drawer nao exibiu a mensagem acionavel do build bloqueado.");
      }
      if (!drawerState.detailsText.includes("Acao Recomendada")) {
        fail("Painel Details nao exibiu a acao recomendada.");
      }
      if (!drawerState.detailsText.includes("Detalhe Tecnico")) {
        fail("Painel Details nao expos a secao tecnica colapsada.");
      }
      if (!drawerState.technicalClosed) {
        fail("Detalhe tecnico deveria iniciar colapsado para nao poluir a viewport.");
      }
      if (!drawerState.hasCopy) {
        fail("Painel Details nao exibiu acao de copiar erro.");
      }
      if (!drawerState.hasEvidence) {
        fail("Painel Details nao exibiu link de artefato/log.");
      }

      console.log("OK: Desktop Tauri build blocked diagnostic E2E passou.");
      console.log(`Projeto: ${options.project}`);
      console.log(`Target: ${projectMetadata.target}`);
      console.log(`Diagnostico: ${actionableEntry.message}`);
      return;
    }

    try {
      await waitForBuildRunReady(sessionId, liveValidationTimeoutMs);
    } catch (error) {
      const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
      const details = error instanceof Error ? error.message : String(error);
      fail(diagnostics ? `${details}\n${diagnostics}` : details);
    }

    await clickByTestId(sessionId, "toolbar-build-run");

    try {
      await waitFor(
        async () => {
          const status = await executeScript(
            sessionId,
            "return document.querySelector('[data-testid=\"viewport-game-status\"]')?.textContent?.trim() ?? '';"
          );
          return status === "Emulador ativo";
        },
        emulatorActivationTimeoutMs,
        "Emulador nao ficou ativo apos Build & Run",
        1000
      );
    } catch (error) {
      const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
      const details = error instanceof Error ? error.message : String(error);
      fail(diagnostics ? `${details}\n${diagnostics}` : details);
    }

    const state = await executeScript(
      sessionId,
      "return window.__RDS_E2E__?.getState() ?? null;"
    );
    if (!state) {
      fail("Estado de automacao do app nao esta disponivel.");
    }

    if (state.activeTarget !== projectMetadata.target) {
      fail(
        `Target hidratado incorretamente. Esperado: ${projectMetadata.target}. Atual: ${state.activeTarget}`
      );
    }

    if (state.activeViewportTab !== "game") {
      fail(`Viewport nao entrou na aba de jogo. Estado atual: ${state.activeViewportTab}`);
    }

    const consoleMessages = state.consoleEntries.map((entry) => entry.message);
    if (!consoleMessages.some((message) => message.includes("Build concluido."))) {
      fail("Console nao registrou conclusao de build.");
    }
    if (!consoleMessages.some((message) => message.includes("ROM carregada no emulador."))) {
      fail("Console nao registrou carga de ROM no emulador.");
    }

    const framebuffer = await waitFor(
      async () => {
        const result = await executeScript(
          sessionId,
          `
            const canvas = document.querySelector('[data-testid="viewport-game-canvas"]');
            if (!canvas) return null;
            const context = canvas.getContext("2d");
            if (!context) return null;
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let nonBlackPixels = 0;
            for (let index = 0; index < imageData.length; index += 4) {
              if (imageData[index] !== 0 || imageData[index + 1] !== 0 || imageData[index + 2] !== 0) {
                nonBlackPixels += 1;
              }
            }
            return {
              width: canvas.width,
              height: canvas.height,
              nonBlackPixels,
            };
          `
        );
        return result && result.nonBlackPixels > 0 ? result : false;
      },
      30000,
      "Canvas do jogo nao recebeu pixels validos apos rodar frames",
      1000
    );

    console.log("OK: Desktop Tauri E2E passou.");
    console.log(`Projeto: ${options.project}`);
    console.log(`Target: ${projectMetadata.target}`);
    console.log(`Canvas: ${framebuffer.width}x${framebuffer.height}, pixels nao pretos: ${framebuffer.nonBlackPixels}`);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const driverSummary = summarizeDriverLogs(driverLogs);
    throw new Error(
      driverSummary
        ? `${details}\n\nUltimos logs do tauri-driver:\n${driverSummary}`
        : details
    );
  } finally {
    if (sessionId) {
      await deleteSession(sessionId);
    }
    if (driverProcess) {
      if (!driverExited) {
        driverProcess.kill();
      }
      const processExited = await waitForProcessExit(driverProcess, 10000);
      if (!processExited) {
        console.warn("[cleanup] tauri-driver nao confirmou encerramento em ate 10s.");
      }
      try {
        await waitForDriverOffline(
          10000,
          `tauri-driver nao liberou ${driverServerUrl} apos encerramento do cenario`
        );
      } catch {
        console.warn(`[cleanup] tauri-driver ainda responde em ${driverServerUrl} apos cleanup.`);
      }
    }
    if (temporaryProjectDir) {
      const cleaned = await cleanupTemporaryProject(temporaryProjectDir);
      if (!cleaned) {
        console.warn(
          `[cleanup] Nao foi possivel remover o projeto temporario criado pelo onboarding: ${temporaryProjectDir}`
        );
      }
    }
  }
}

main().catch(async (error) => {
  const details = error instanceof Error ? error.message : String(error);
  await writeDesktopFailureReport(error).catch(() => {});
  emitGithubErrorAnnotation(details);
  console.error(`ERRO: ${details}`);
  process.exit(1);
});
