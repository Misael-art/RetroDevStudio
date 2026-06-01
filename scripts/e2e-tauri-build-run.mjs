#!/usr/bin/env node

import {
  access,
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  UI_LAYOUT_ORACLE_RESOLUTIONS,
  UI_LAYOUT_ORACLE_TARGETS,
  buildUiLayoutOracleReport,
  evaluateUiLayoutOracleSnapshot,
} from "./ui-layout-oracle.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function resolveLedgerMarker(options, projectMetadata) {
  const suffix = projectMetadata.target === "snes" ? "snes" : "md";
  switch (options.scenario ?? "build-run") {
    case "build-run":
      return `smoke_${suffix}`;
    case "live-overflow":
      return `live_overflow_${suffix}`;
    case "live-overflow-vram":
      return `live_vram_overflow_${suffix}`;
    case "live-warning-vram":
      return `live_vram_warning_${suffix}`;
    case "live-warning-sprites":
      return `live_sprite_warning_${suffix}`;
    case "live-ok":
      return `live_ok_${suffix}`;
    case "live-error":
      return `live_error_${suffix}`;
    case "live-stale":
      return `live_stale_${suffix}`;
    default:
      return null;
  }
}

function resolveE2eLedgerPath() {
  if (process.env.GITHUB_ACTIONS && process.env.RUNNER_TEMP) {
    return path.join(process.env.RUNNER_TEMP, "desktop-e2e-passed.txt");
  }

  if (process.env.RDS_E2E_LEDGER) {
    return process.env.RDS_E2E_LEDGER;
  }

  if (process.env.RUNNER_TEMP) {
    return path.join(process.env.RUNNER_TEMP, "desktop-e2e-passed.txt");
  }

  return null;
}

async function recordE2eLedgerSuccess(options, projectMetadata) {
  // No CI o workflow desktop-e2e grava marcadores via Add-Content (pwsh).
  // Evita corrida/ path divergente quando npm nao herda RDS_E2E_LEDGER no Windows.
  if (process.env.GITHUB_ACTIONS) {
    return;
  }

  const marker = resolveLedgerMarker(options, projectMetadata);
  const ledgerPath = resolveE2eLedgerPath();
  if (!marker || !ledgerPath) {
    return;
  }

  await appendFile(ledgerPath, `${marker}\n`, "utf8");
  console.log(`[ledger] ${marker} -> ${ledgerPath}`);
}
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
const uiLayoutOracleReportPath = path.join(
  validationDir,
  "ui-layout-oracle.json"
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
          "create-game-from-zero",
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

async function writeArtStudioVerticalFixtures(projectDir) {
  const fixtureDir = path.join(projectDir, ".rds", "e2e-artstudio");
  await mkdir(fixtureDir, { recursive: true });

  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  const colors = [
    [244, 80, 80],
    [80, 220, 120],
    [80, 140, 255],
    [250, 220, 80],
  ];
  const keyColor = [255, 0, 255];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const quadrant = (x >= 32 ? 1 : 0) + (y >= 32 ? 2 : 0);
      const localX = x % 32;
      const localY = y % 32;
      const color =
        localX >= 4 && localX < 28 && localY >= 4 && localY < 28
          ? colors[quadrant]
          : keyColor;
      const offset = (y * width + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }

  const spritePath = path.join(fixtureDir, "artstudio-hero-sheet.ppm");
  await writeFile(
    spritePath,
    Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii"), pixels])
  );

  const commandPath = path.join(fixtureDir, "command.dat");
  await writeFile(
    commandPath,
    [
      "[Command]",
      "name = Slash",
      "command = _6, _P",
      "time = 10",
      "",
    ].join("\n"),
    "utf8"
  );

  return { spritePath, commandPath };
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

async function waitForLiveValidationFresh(sessionId, timeoutMs) {
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      return state?.hwValidationState === "fresh" ? state : false;
    },
    timeoutMs,
    "Validacao live nao ficou fresh apos injetar draft.",
    250
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

async function callArtStudioApi(sessionId, methodName, args = []) {
  const result = await executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const api = window.__RDS_ARTSTUDIO_E2E__;
      const methodName = arguments[0];
      const methodArgs = Array.isArray(arguments[1]) ? arguments[1] : [];
      if (!api || typeof api[methodName] !== "function") {
        done({ ok: false, error: "Metodo ArtStudio E2E indisponivel: " + methodName });
        return;
      }

      Promise.resolve(api[methodName](...methodArgs))
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `,
    [methodName, args]
  );

  if (!result?.ok) {
    fail(`Falha na API ArtStudio E2E (${methodName}): ${result?.error ?? "sem diagnostico"}`);
  }

  return result.value;
}

async function readArtStudioState(sessionId) {
  return executeScript(
    sessionId,
    "return window.__RDS_ARTSTUDIO_E2E__?.getState?.() ?? null;"
  );
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

async function setSessionWindowRect(sessionId, width, height) {
  const targetWidth = Number(width);
  const targetHeight = Number(height);
  const widthTolerance = 64;
  const heightTolerance = 96;
  try {
    await webdriverRequest("POST", `/session/${sessionId}/window/fullscreen`, {
      fullscreen: false,
    });
  } catch {
    // Alguns drivers nao expõem fullscreen; seguir com window/rect.
  }
  try {
    await webdriverRequest("POST", `/session/${sessionId}/window/minimize`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch {
    // minimize opcional.
  }
  let lastSize = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await webdriverRequest("POST", `/session/${sessionId}/window/rect`, {
      x: 0,
      y: 0,
      width: targetWidth,
      height: targetHeight,
    });
    await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 350));
    lastSize = await executeScript(
      sessionId,
      `return {
        width: window.innerWidth,
        height: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
      };`
    );
    if (
      lastSize &&
      Math.abs(Number(lastSize.width) - targetWidth) <= widthTolerance &&
      Math.abs(Number(lastSize.height) - targetHeight) <= heightTolerance
    ) {
      await executeScript(sessionId, `window.dispatchEvent(new Event("resize"));`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return;
    }
  }
  fail(
    `Janela do WebDriver nao redimensionou para ${targetWidth}x${targetHeight} (atual inner=${lastSize?.width ?? "?"}x${lastSize?.height ?? "?"}, outer=${lastSize?.outerWidth ?? "?"}x${lastSize?.outerHeight ?? "?"}).`
  );
}

async function collectUiLayoutOracleSnapshot(sessionId, targetId, resolutionTag) {
  return executeScript(
    sessionId,
    `
      const targetId = arguments[0];
      const resolutionTag = arguments[1];
      const allowedHorizontalScrollTestIds = new Set([
        "unified-topbar",
        "unified-topbar-center",
        "unified-topbar-breadcrumbs",
        "artstudio-timeline",
        "artstudio-command-panel",
        "artstudio-main-stage",
        "artstudio-inspector",
        "nodegraph-canvas",
        "nodegraph-side-rail",
        "nodegraph-context-rail",
        "viewport-scene-toolbar",
        "viewport-scene-stage",
        "viewport-game-stage",
        "shortcut-map",
      ]);

      function rectOf(node) {
        if (!(node instanceof Element)) return null;
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }

      function visible(node) {
        if (!(node instanceof Element)) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) return false;
        const style = window.getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.02;
      }

      function hitTestVisible(node) {
        if (!(node instanceof Element)) return false;
        const rect = node.getBoundingClientRect();
        const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
        const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === node || node.contains(hit)));
      }

      function ownTestId(node) {
        return node instanceof Element ? node.getAttribute("data-testid") || "" : "";
      }

      function nearestTestId(node) {
        let current = node instanceof Element ? node : null;
        while (current) {
          const testId = ownTestId(current);
          if (testId) return testId;
          current = current.parentElement;
        }
        return "";
      }

      function verticalScrollRegion(node) {
        let current = node instanceof Element ? node.parentElement : null;
        while (current && current !== document.documentElement && current !== document.body) {
          if (current instanceof HTMLElement) {
            const style = window.getComputedStyle(current);
            const scrollable =
              ["auto", "scroll", "overlay"].includes(style.overflowY) &&
              current.scrollHeight > current.clientHeight + 2;
            if (scrollable) {
              return {
                key: ownTestId(current) || nearestTestId(current) || current.tagName.toLowerCase(),
                scrollTop: current.scrollTop,
                clientHeight: current.clientHeight,
                scrollHeight: current.scrollHeight,
              };
            }
          }
          current = current.parentElement;
        }
        return null;
      }

      function horizontalScrollRegion(node) {
        let current = node instanceof Element ? node.parentElement : null;
        while (current && current !== document.documentElement && current !== document.body) {
          if (current instanceof HTMLElement) {
            const style = window.getComputedStyle(current);
            const scrollable =
              ["auto", "scroll", "overlay"].includes(style.overflowX) &&
              current.scrollWidth > current.clientWidth + 2;
            if (scrollable) {
              return {
                key: ownTestId(current) || nearestTestId(current) || current.tagName.toLowerCase(),
                allowed: horizontalScrollAllowed(current),
                scrollLeft: current.scrollLeft,
                clientWidth: current.clientWidth,
                scrollWidth: current.scrollWidth,
              };
            }
          }
          current = current.parentElement;
        }
        return null;
      }

      function keyFor(node, index) {
        const testId = nearestTestId(node);
        const own = ownTestId(node);
        const label =
          own ||
          node.getAttribute("aria-label") ||
          node.getAttribute("title") ||
          node.textContent?.replace(/\\s+/g, " ").trim().slice(0, 40) ||
          node.tagName.toLowerCase();
        return String(testId || "no-testid") + ":" + String(label) + ":" + String(index);
      }

      function snapshotNode(node, key) {
        if (!(node instanceof HTMLElement || node instanceof SVGElement)) return null;
        const rect = rectOf(node);
        const text = node.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        const scrollRegion = verticalScrollRegion(node);
        const xScrollRegion = horizontalScrollRegion(node);
        const hasTooltip = (() => {
          let current = node;
          for (let depth = 0; depth < 6 && current instanceof Element; depth += 1) {
            if ((current.getAttribute("title") || "").trim()) return true;
            if ((current.getAttribute("aria-label") || "").trim()) return true;
            if ((current.getAttribute("aria-describedby") || "").trim()) return true;
            current = current.parentElement;
          }
          return false;
        })();
        return {
          key,
          tag: node.tagName.toLowerCase(),
          testId: ownTestId(node),
          nearestTestId: nearestTestId(node),
          text,
          title: node.getAttribute("title") || "",
          ariaLabel: node.getAttribute("aria-label") || "",
          ariaDescribedBy: node.getAttribute("aria-describedby") || "",
          hasTooltip,
          role: node.getAttribute("role") || "",
          rect,
          visible: visible(node),
          hitTestVisible: hitTestVisible(node),
          disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
          clientWidth: node.clientWidth ?? 0,
          clientHeight: node.clientHeight ?? 0,
          scrollWidth: node.scrollWidth ?? 0,
          scrollHeight: node.scrollHeight ?? 0,
          dataVisible: node.getAttribute("data-visible") || "",
          insideVerticalScrollRegion: Boolean(scrollRegion),
          verticalScrollRegion: scrollRegion,
          insideAllowedHorizontalScrollRegion: Boolean(xScrollRegion?.allowed),
          horizontalScrollRegion: xScrollRegion,
        };
      }

      function oracleScopeRoot() {
        if (targetId === "import-wizard") {
          return document.querySelector('[data-testid="project-wizard-body"]') || document.body;
        }
        return document.body;
      }

      function scopedQueryAll(root, selector) {
        const nodes = [];
        if (root instanceof Element && root.matches(selector)) nodes.push(root);
        if (root instanceof Element || root instanceof Document) {
          nodes.push(...Array.from(root.querySelectorAll(selector)));
        }
        return nodes;
      }

      function scopedTree(root) {
        if (!(root instanceof Element)) return [];
        return [root, ...Array.from(root.querySelectorAll("*"))];
      }

      function isLeafTextCandidate(node, clickableSelector) {
        if (!(node instanceof HTMLElement)) return false;
        const tag = node.tagName.toLowerCase();
        if (["button", "label", "h1", "h2", "h3", "p", "span", "dd", "dt", "kbd"].includes(tag)) {
          return true;
        }
        const own = ownTestId(node);
        if (!own) return false;
        if (node.querySelector(clickableSelector)) return false;
        const text = node.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        if (text.length > 160) return false;
        let directText = "";
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) directText += child.textContent || "";
        }
        return directText.replace(/\\s+/g, " ").trim().length > 0 && node.children.length <= 2;
      }

      function bySelector(selector, key) {
        return snapshotNode(document.querySelector(selector), key);
      }

      function mainVisual(selector, containerSelector, key, kind) {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLElement || node instanceof SVGElement)) return null;
        const container = containerSelector ? document.querySelector(containerSelector) : node.parentElement;
        return {
          ...snapshotNode(node, key),
          kind,
          containerRect: rectOf(container instanceof Element ? container : node.parentElement),
        };
      }

      function horizontalScrollAllowed(node) {
        if (!(node instanceof Element)) return false;
        if (node.closest('[data-rds-allow-horizontal-scroll="true"]')) return true;
        if (node.closest("pre, code")) return true;
        let current = node;
        while (current) {
          const testId = ownTestId(current);
          if (allowedHorizontalScrollTestIds.has(testId)) return true;
          current = current.parentElement;
        }
        return false;
      }

      const topbar = document.querySelector('[data-testid="unified-topbar"]');
      const topbarChildren = topbar ? Array.from(topbar.children) : [];
      const elements = {
        topbar: bySelector('[data-testid="unified-topbar"]', "topbar"),
        topbarLeft: snapshotNode(topbarChildren[0], "topbar-left"),
        topbarCenter: snapshotNode(topbarChildren[1], "topbar-center"),
        topbarRight: snapshotNode(topbarChildren[2], "topbar-right"),
        buildButton: bySelector('[data-testid="toolbar-build-run"]', "toolbar-build-run"),
        centerPanel: bySelector('[data-panel-id="center"], #center', "center-panel"),
        leftPanel: bySelector('[data-panel-id="left"], #left', "left-panel"),
        rightPanel: bySelector('[data-panel-id="right"], #right', "right-panel"),
        workspaceGuide: bySelector('[data-testid="workspace-guide"]', "workspace-guide"),
        consoleDrawer: bySelector('[data-testid="console-drawer"]', "console-drawer"),
        statusBar: bySelector('[data-testid="production-status-bar"]', "production-status-bar"),
        nodegraphRail: bySelector('[data-testid="nodegraph-side-rail"]', "nodegraph-side-rail"),
        nodegraphCanvas: bySelector('[data-testid="nodegraph-canvas"]', "nodegraph-canvas"),
        nodegraphContextRail: bySelector('[data-testid="nodegraph-context-rail"]', "nodegraph-context-rail"),
        nodegraphOverview: bySelector('[data-testid="nodegraph-overview"]', "nodegraph-overview"),
        nodegraphMinimap: bySelector('[data-testid="nodegraph-minimap"]', "nodegraph-minimap"),
        nodegraphCanvasToolbar: bySelector('[data-testid="nodegraph-canvas-toolbar"]', "nodegraph-canvas-toolbar"),
        importWizard: bySelector('[data-testid="project-wizard-body"]', "project-wizard-body"),
        runtimeSetup: bySelector('[data-testid="runtime-setup-panel"]', "runtime-setup-panel"),
      };
      const scopeRoot = oracleScopeRoot();

      const clickableSelector = [
        "button",
        "a[href]",
        "input",
        "select",
        "textarea",
        "summary",
        '[role="button"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(",");
      const clickables = scopedQueryAll(scopeRoot, clickableSelector)
        .filter((node) => visible(node))
        .map((node, index) => snapshotNode(node, keyFor(node, index)))
        .filter(Boolean);

      const criticalSelector = [
        "button",
        "[data-testid]",
        "h1",
        "h2",
        "h3",
        "label",
        "p",
        "span",
        "dd",
        "dt",
        "kbd",
      ].join(",");
      const criticalTexts = scopedQueryAll(scopeRoot, criticalSelector)
        .filter((node) => {
          if (!visible(node)) return false;
          const text = node.textContent?.replace(/\\s+/g, " ").trim() ?? "";
          if (text.length < 3) return false;
          if (!isLeafTextCandidate(node, clickableSelector)) return false;
          const truncated =
            node.scrollWidth > node.clientWidth + 2 ||
            node.scrollHeight > node.clientHeight + 2;
          if (!truncated) return false;
          const testId = nearestTestId(node);
          return Boolean(
            node.tagName.toLowerCase() === "button" ||
              testId.includes("toolbar") ||
              testId.includes("workspace") ||
              testId.includes("inspector") ||
              testId.includes("nodegraph") ||
              testId.includes("artstudio") ||
              testId.includes("runtime") ||
              testId.includes("wizard") ||
              testId.includes("viewport") ||
              testId.includes("tools") ||
              testId.includes("production")
          );
        })
        .slice(0, 80)
        .map((node, index) => snapshotNode(node, keyFor(node, index)))
        .filter(Boolean);

      const horizontalScrolls = scopedTree(scopeRoot)
        .filter((node) => {
          if (!(node instanceof HTMLElement)) return false;
          if (!visible(node)) return false;
          const overflowX = window.getComputedStyle(node).overflowX;
          if (!["auto", "scroll", "overlay"].includes(overflowX)) return false;
          return node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 24;
        })
        .slice(0, 80)
        .map((node, index) => ({
          ...snapshotNode(node, keyFor(node, index)),
          allowed: horizontalScrollAllowed(node),
        }));

      const mainVisuals = [
        mainVisual('[data-testid="project-wizard-body"]', '[data-testid="project-wizard-body"]', "import-wizard", "wizard"),
        mainVisual('[data-testid="viewport-scene-canvas"]', '[data-testid="viewport-scene-stage"]', "viewport-scene-canvas", "scene"),
        mainVisual('[data-testid="viewport-game-canvas"]', '[data-testid="viewport-game-stage"]', "viewport-game-canvas", "game"),
        mainVisual('[data-testid="nodegraph-canvas"]', '[data-panel-id="center"], #center', "nodegraph-canvas", "nodegraph"),
        mainVisual('[data-testid="artstudio-main-stage"]', '[data-testid="artstudio-main-stage"]', "artstudio-main-stage", "art"),
        mainVisual('[data-testid="runtime-setup-panel"]', '[data-panel-id="right"], #right', "runtime-setup-panel", "runtime"),
        mainVisual('[data-panel-id="right"], #right', '[data-panel-id="right"], #right', "debug-tools", "debug"),
      ].filter(Boolean);

      return {
        targetId,
        workspaceId: targetId === "import-wizard" ? null : window.__RDS_E2E__?.getState?.()?.activeWorkspace ?? null,
        resolutionTag,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
        },
        elements,
        clickables,
        criticalTexts,
        horizontalScrolls,
        mainVisuals,
      };
    `,
    [targetId, resolutionTag]
  );
}

async function writeUiLayoutOracleReport(records, artifactPrefix) {
  await ensureValidationDir();
  const report = buildUiLayoutOracleReport({ artifactPrefix, records });
  await writeFile(uiLayoutOracleReportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function formatUiLayoutIssues(record) {
  return (record.issues ?? [])
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join("; ");
}

async function evaluateUiLayoutHealth(sessionId, targetId, resolutionTag) {
  const snapshot = await collectUiLayoutOracleSnapshot(sessionId, targetId, resolutionTag);
  return evaluateUiLayoutOracleSnapshot(snapshot);
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

async function prepareUiLayoutOracleTarget(sessionId, target) {
  if (!target) {
    fail("Alvo do oraculo visual nao foi encontrado.");
  }

  if (target.id === "import-wizard") {
    await waitForOnboardingWizard(sessionId);
    return;
  }

  if (target.workspaceId) {
    await callAutomationApi(sessionId, "selectWorkspace", [target.workspaceId]);
  }

  if (target.id === "runtime-setup") {
    await callAutomationApi(sessionId, "openToolsWorkspace", ["setup", "debug", true]);
  }

  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      if (!state || state.activeWorkspace !== target.workspaceId) {
        return false;
      }
      if (target.id === "scene") {
        return executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="viewport-scene-stage"]'));`);
      }
      if (target.id === "art") {
        return executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="artstudio-main-stage"]'));`);
      }
      if (target.id === "game") {
        return executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="viewport-game-stage"]'));`);
      }
      if (target.id === "logic" || target.id === "nodegraph") {
        return executeScript(
          sessionId,
          `return Boolean(
            document.querySelector('[data-testid="nodegraph-side-rail"]') &&
            document.querySelector('[data-testid="nodegraph-canvas"]')
          );`
        );
      }
      if (target.id === "debug") {
        return executeScript(sessionId, `return Boolean(document.querySelector('[data-panel-id="right"], #right'));`);
      }
      if (target.id === "runtime-setup") {
        return executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="runtime-setup-panel"]'));`);
      }
      return state;
    },
      target.id === "logic" || target.id === "nodegraph" ? 25000 : 15000,
      `Oraculo visual: alvo '${target.id}' nao ficou pronto.`,
    250
  );
}

function addReportStep(report, id, status, details = {}) {
  report.steps.push({
    id,
    status,
    at: new Date().toISOString(),
    ...details,
  });
}

function addReportArtifact(report, filePath, label) {
  report.artifacts.push({ label, path: filePath });
  return filePath;
}

async function writeCreateGameReport(report, outputPath) {
  report.generatedAt = new Date().toISOString();
  report.non_black_pixels =
    report.frames[report.frames.length - 1]?.non_black_pixels ?? 0;
  await ensureValidationDir();
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

function createByorSafePlayerPpm() {
  const width = 96;
  const height = 32;
  const colors = {
    bg: [0, 0, 0],
    skin: [255, 206, 150],
    idle: [72, 201, 176],
    run: [249, 199, 79],
    jump: [86, 180, 233],
    boot: [232, 93, 117],
    eye: [255, 255, 255],
  };

  function inRect(x, y, left, top, right, bottom) {
    return x >= left && x <= right && y >= top && y <= bottom;
  }

  function pixel(x, y) {
    const frame = Math.floor(x / 32);
    const lx = x % 32;
    const body = frame === 0 ? colors.idle : frame === 1 ? colors.run : colors.jump;
    const runShift = frame === 1 ? 2 : 0;
    const jumpLift = frame === 2 ? -3 : 0;

    if (inRect(lx, y, 13, 4 + jumpLift, 18, 9 + jumpLift)) {
      return colors.skin;
    }
    if (inRect(lx, y, 18, 6 + jumpLift, 18, 6 + jumpLift)) {
      return colors.eye;
    }
    if (inRect(lx, y, 11, 10 + jumpLift, 20, 20 + jumpLift)) {
      return body;
    }
    if (inRect(lx, y, 8 - runShift, 12 + jumpLift, 10 - runShift, 18 + jumpLift)) {
      return body;
    }
    if (inRect(lx, y, 21 + runShift, 12 + jumpLift, 23 + runShift, 18 + jumpLift)) {
      return body;
    }
    if (inRect(lx, y, 11 - runShift, 21 + jumpLift, 14 - runShift, 26 + jumpLift)) {
      return colors.boot;
    }
    if (inRect(lx, y, 17 + runShift, 21 + jumpLift, 20 + runShift, 26 + jumpLift)) {
      return colors.boot;
    }
    return colors.bg;
  }

  const lines = [`P3`, `${width} ${height}`, `255`];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      row.push(pixel(x, y).join(" "));
    }
    lines.push(row.join(" "));
  }
  return `${lines.join("\n")}\n`;
}

async function writeByorSafePlayerFixture(outputPath) {
  await ensureValidationDir();
  await writeFile(outputPath, createByorSafePlayerPpm(), "utf8");
  return outputPath;
}

async function waitForArtStudioAutomationApi(sessionId, timeoutMs) {
  await waitFor(
    async () =>
      executeScript(
        sessionId,
        "return typeof window.__RDS_ARTSTUDIO_E2E__?.ingestSpriteSheet === 'function';"
      ),
    timeoutMs,
    "API E2E do ArtStudio nao ficou disponivel.",
    250
  );
}

async function runUiLayoutOracleCheck(
  sessionId,
  target,
  resolution,
  artifactPrefix,
  records,
  shotNames,
  manualQaReport
) {
  await setSessionWindowRect(sessionId, resolution.width, resolution.height);
  await prepareUiLayoutOracleTarget(sessionId, target);
  const record = await evaluateUiLayoutHealth(sessionId, target.id, resolution.tag);
  const viewportWidth = Number(record?.metrics?.viewportWidth ?? 0);
  if (
    Number.isFinite(resolution.width) &&
    viewportWidth > 0 &&
    Math.abs(viewportWidth - resolution.width) > 96
  ) {
    fail(
      `Oraculo visual ${resolution.tag}/${target.id}: viewport ${viewportWidth}px diverge da resolucao pedida (${resolution.width}px).`
    );
  }
  const screenshot = await captureScreenshot(
    sessionId,
    `${artifactPrefix}-H-ui-oracle-${resolution.tag}-${target.id}.png`
  );
  record.screenshot = path.basename(screenshot);
  records.push(record);
  shotNames.push(path.basename(screenshot));
  registerArtifact(
    manualQaReport,
    screenshot,
    `H - ui oracle ${resolution.tag} ${target.id}`
  );
  await writeUiLayoutOracleReport(records, artifactPrefix);

  if (!record.ok) {
    const metricsText = record.metrics ? JSON.stringify(record.metrics) : "{}";
    fail(
      `Oraculo visual ${resolution.tag}/${target.id}: ${formatUiLayoutIssues(record)} | metrics=${metricsText}`
    );
  }

  return record;
}

async function readNodeGraphUiDiagnostics(sessionId) {
  return executeScript(
    sessionId,
    `
      const textOf = (selector) =>
        document.querySelector(selector)?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
      const cards = Array.from(document.querySelectorAll('[data-testid^="node-card-"]'))
        .filter((node) => node instanceof HTMLElement);
      const rects = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          id: card.getAttribute("data-testid") ?? "",
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          text: card.textContent?.replace(/\\s+/g, " ").trim() ?? "",
        };
      });
      const overlaps = [];
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const overlapW = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const overlapH = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          const overlapArea = overlapW * overlapH;
          const smallerArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
          if (overlapW > 18 && overlapH > 18 && overlapArea / smallerArea > 0.18) {
            overlaps.push({ a: a.id, b: b.id, overlapW, overlapH });
          }
        }
      }
      const sourceMappingText = textOf('[data-testid="nodegraph-source-mapping"]');
      const gapPanelText = textOf('[data-testid="nodegraph-import-gaps"]');
      const provenanceText = textOf('[data-testid="nodegraph-import-provenance"]');
      return {
        hasCanvas: Boolean(document.querySelector('[data-testid="nodegraph-canvas"]')),
        hasOverview: Boolean(document.querySelector('[data-testid="nodegraph-overview"]')),
        cardCount: cards.length,
        fsmCardCount: rects.filter((card) => /FSM|Estado FSM|Transicao FSM|Transition/i.test(card.text)).length,
        convertedBadgeCount: rects.filter((card) => card.text.includes("Converted")).length,
        bridgeBadgeCount: rects.filter((card) => card.text.includes("Bridge")).length,
        gapBadgeCount: rects.filter((card) => card.text.includes("Gap")).length,
        sourceMappedBadgeCount: rects.filter((card) => card.text.includes("Source mapped")).length,
        sourceMappingVisible: sourceMappingText.length > 0,
        sourceMappingText,
        gapPanelVisible: gapPanelText.length > 0,
        gapPanelText,
        provenanceVisible: provenanceText.length > 0,
        provenanceText,
        overlaps,
      };
    `
  );
}

async function ingestArtStudioSprite(sessionId, sourcePath) {
  const result = await executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const api = window.__RDS_ARTSTUDIO_E2E__;
      if (!api || typeof api.ingestSpriteSheet !== "function") {
        done({ ok: false, error: "window.__RDS_ARTSTUDIO_E2E__ indisponivel" });
        return;
      }
      api.ingestSpriteSheet(arguments[0])
        .then(() => done({ ok: true }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `,
    [sourcePath]
  );

  if (!result?.ok) {
    fail(`Falha ao carregar sprite BYOR-safe no ArtStudio: ${result?.error ?? "sem diagnostico"}`);
  }
}

async function clickArtStudioFrame(sessionId, sequenceId, frameIndex) {
  await clickByTestId(sessionId, `artstudio-sequence-card-${sequenceId}`);

  const result = await executeScript(
    sessionId,
    `
      const frameIndex = Number(arguments[0]);
      const canvas = document.querySelector('[data-testid="artstudio-source-canvas"]');
      const state = window.__RDS_ARTSTUDIO_E2E__?.getState?.() ?? null;
      if (!(canvas instanceof HTMLCanvasElement) || !state) {
        return { ok: false, reason: "canvas ou estado indisponivel" };
      }
      const frame = state.suggestedFrames.find((candidate) => candidate.index === frameIndex)
        ?? state.suggestedFrames[frameIndex];
      if (!frame) {
        return { ok: false, reason: "frame sugerido nao encontrado: " + frameIndex };
      }
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / Math.max(1, canvas.width);
      const scaleY = rect.height / Math.max(1, canvas.height);
      const clientX = rect.left + (frame.x + frame.width / 2) * scaleX;
      const clientY = rect.top + (frame.y + frame.height / 2) * scaleY;
      canvas.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        view: window,
      }));
      return { ok: true, clientX, clientY };
    `,
    [frameIndex]
  );

  if (!result?.ok) {
    fail(`Falha ao selecionar frame ${frameIndex} no ArtStudio: ${result?.reason ?? "sem diagnostico"}`);
  }

  await waitFor(
    async () => {
      const state = await readArtStudioState(sessionId);
      const sequence = state?.sequences?.find((candidate) => candidate.id === sequenceId);
      return sequence?.frames?.includes(frameIndex) ? sequence : false;
    },
    10000,
    `Sequencia ${sequenceId} nao recebeu o frame ${frameIndex}.`,
    250
  );
}

async function readFramebufferStats(sessionId) {
  return executeScript(
    sessionId,
    `
      const canvas = document.querySelector('[data-testid="viewport-game-canvas"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
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
        non_black_pixels: nonBlackPixels,
      };
    `
  );
}

async function assertNodeGraphUiDiagnostics(sessionId, options = {}) {
  const diagnostics = await readNodeGraphUiDiagnostics(sessionId);
  if (!diagnostics?.hasCanvas || !diagnostics?.hasOverview || diagnostics.cardCount < 1) {
    fail(
      `Bloco G: NodeGraph nao ficou visivel com nodes renderizados (canvas=${diagnostics?.hasCanvas}, overview=${diagnostics?.hasOverview}, nodes=${diagnostics?.cardCount ?? 0}).`
    );
  }
  if (diagnostics.overlaps?.length) {
    fail(
      `Bloco G: nodes do NodeGraph sobrepostos grosseiramente: ${JSON.stringify(diagnostics.overlaps.slice(0, 3))}.`
    );
  }
  if (!diagnostics.sourceMappingVisible) {
    fail("Bloco G: painel Source Mapping nao ficou visivel no Logic Workspace.");
  }
  if (!diagnostics.gapPanelVisible) {
    fail("Bloco G: painel Import Gaps nao ficou acessivel no Logic Workspace.");
  }
  if (!diagnostics.provenanceVisible) {
    fail("Bloco G: aviso de proveniencia SGDK Logic nao ficou visivel no Logic Workspace.");
  }
  if (options.expectFsm) {
    if (diagnostics.fsmCardCount < 1) {
      fail("Bloco G: grafo SGDK declarou FSM, mas nenhum node FSM foi renderizado.");
    }
    if (!/FSM extraida/i.test(diagnostics.provenanceText)) {
      fail(`Bloco G: grafo FSM nao foi identificado como 'FSM extraida' (texto: ${diagnostics.provenanceText}).`);
    }
  } else if (!/heur/i.test(diagnostics.provenanceText) && !/grafo heuristico/i.test(diagnostics.provenanceText)) {
    fail(`Bloco G: grafo SGDK sem FSM real nao exibiu aviso heuristico forte (texto: ${diagnostics.provenanceText}).`);
  }
  return diagnostics;
}

async function assertNoGrossMainShellTextOverlap(sessionId) {
  const overlaps = await executeScript(
    sessionId,
    `
      const directText = (element) => Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ")
        .replace(/\\s+/g, " ")
        .trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0.05 &&
          rect.width > 8 &&
          rect.height > 8;
      };
      const scopeSelectors = [
        '[data-testid="sgdk-import-summary"] p',
        '[data-testid="sgdk-import-summary"] span',
        '[data-testid="sgdk-import-summary"] li',
        '[data-testid="nodegraph-overview"] p',
        '[data-testid="nodegraph-overview"] span',
        '[data-testid="nodegraph-overview"] button',
        '[data-testid="nodegraph-overview"] input',
        '[data-testid="inspector-logic-import-truth"] span',
        '[data-testid="inspector-logic-import-truth"] p'
      ];
      const resolveLabelText = (element) => {
        const direct = directText(element);
        const normalize = (value) => value.replace(/\\s+/g, " ").trim();
        if (direct) {
          return normalize(direct);
        }
        if (element instanceof HTMLButtonElement) {
          return normalize(element.textContent || "");
        }
        return normalize(
          element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.textContent ||
            ""
        );
      };
      const elements = Array.from(document.querySelectorAll(scopeSelectors.join(",")))
        .filter(isVisible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = resolveLabelText(element);
          return { element, rect, text };
        })
        .filter((item) => item.text.length > 0 && item.text.length < 220);
      const overlaps = [];
      for (let i = 0; i < elements.length; i += 1) {
        for (let j = i + 1; j < elements.length; j += 1) {
          const a = elements[i];
          const b = elements[j];
          if (a.element.contains(b.element) || b.element.contains(a.element)) {
            continue;
          }
          const overlapW = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
          const overlapH = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
          const overlapArea = overlapW * overlapH;
          const smallerArea = Math.max(1, Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height));
          if (overlapW > 10 && overlapH > 8 && overlapArea / smallerArea > 0.32) {
            overlaps.push({
              a: a.text.slice(0, 80),
              b: b.text.slice(0, 80),
              overlapW: Math.round(overlapW),
              overlapH: Math.round(overlapH),
            });
          }
        }
      }
      return overlaps.slice(0, 6);
    `
  );
  if (Array.isArray(overlaps) && overlaps.length > 0) {
    fail(`Bloco G: texto sobreposto no shell principal: ${JSON.stringify(overlaps)}.`);
  }
}

function extractLatestRomPath(state) {
  const entries = [...(state?.consoleEntries ?? [])].reverse();
  for (const entry of entries) {
    const message = String(entry.message ?? "");
    const match = message.match(/Build concluido\. ROM:\s*(.+)$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

async function assertSegaHeader(romPath) {
  const buffer = await readFile(romPath);
  if (buffer.length < 0x104) {
    fail(`ROM pequena demais para header Mega Drive: ${romPath} (${buffer.length} bytes)`);
  }
  const header = buffer.subarray(0x100, 0x104).toString("ascii");
  if (header !== "SEGA") {
    fail(`Header Mega Drive invalido em ${romPath}: esperado SEGA, obtido '${header}'`);
  }
  return {
    header,
    sizeBytes: buffer.length,
  };
}

async function clickTopBarMenuAction(sessionId, label) {
  await clickByTestId(sessionId, "unified-topbar-menu-trigger");
  await waitFor(
    async () =>
      executeScript(
        sessionId,
        `
          const label = String(arguments[0] ?? "").trim();
          const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
          const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
            const actionLabel = normalize(candidate.querySelector("span")?.textContent ?? candidate.textContent);
            return candidate instanceof HTMLButtonElement && actionLabel === label;
          });
          if (!(button instanceof HTMLButtonElement) || button.disabled) {
            return false;
          }
          button.click();
          return true;
        `,
        [label]
      ),
    5000,
    `Menu superior nao exibiu a acao '${label}'.`,
    100
  );
}

async function runBuildRunAndCollect(sessionId, label, timeoutMs, report, artifactPrefix) {
  const beforeState = await readAutomationState(sessionId);
  const beforeBuildCount = (beforeState?.consoleEntries ?? []).filter((entry) =>
    String(entry.message ?? "").includes("Build concluido.")
  ).length;

  await waitForBuildRunReady(sessionId, timeoutMs);
  await clickByTestId(sessionId, "toolbar-build-run");

  let lastBuildRunDiagnostics = null;
  const state = await waitFor(
    async () => {
      const nextState = await readAutomationState(sessionId);
      const buildCount = (nextState?.consoleEntries ?? []).filter((entry) =>
        String(entry.message ?? "").includes("Build concluido.")
      ).length;
      const gameStatus = await executeScript(
        sessionId,
        "return document.querySelector('[data-testid=\"viewport-game-status\"]')?.textContent?.trim() ?? '';"
      );
      lastBuildRunDiagnostics = await executeScript(
        sessionId,
        `
          const state = window.__RDS_E2E__?.getState?.() ?? null;
          const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
          const buttons = Array.from(document.querySelectorAll("button"))
            .map((button) => ({
              text: normalize(button.textContent),
              disabled: button instanceof HTMLButtonElement ? button.disabled : false,
              testId: button.getAttribute("data-testid"),
            }))
            .slice(0, 80);
          return {
            activeWorkspace: state?.activeWorkspace ?? null,
            activeViewportTab: state?.activeViewportTab ?? null,
            selectedEntityId: state?.selectedEntityId ?? null,
            emulatorLoaded: state?.emulatorLoaded ?? null,
            emulPaused: state?.emulPaused ?? null,
            hwValidationState: state?.hwValidationState ?? null,
            hwValidationError: state?.hwValidationError ?? null,
            activeProjectDir: state?.activeProjectDir ?? null,
            buildCount: arguments[0],
            beforeBuildCount: arguments[1],
            gameStatus: document.querySelector('[data-testid="viewport-game-status"]')?.textContent?.trim() ?? "",
            buildButtonText: document.querySelector('[data-testid="toolbar-build-run"]')?.textContent?.trim() ?? "",
            buildButtonDisabled: Boolean(document.querySelector('[data-testid="toolbar-build-run"]')?.disabled),
            consoleTail: (state?.consoleEntries ?? []).slice(-30),
            buttons,
            bodyText: document.body?.textContent?.replace(/\\s+/g, " ").trim().slice(0, 1800) ?? "",
          };
        `,
        [buildCount, beforeBuildCount]
      );
      return buildCount > beforeBuildCount && gameStatus === "Emulador ativo" ? nextState : false;
    },
    timeoutMs,
    `Build & Run nao concluiu para ${label}.`,
    1000
  ).catch(async (error) => {
    const diagnosticPayload = {
      label,
      cause: error instanceof Error ? error.message : String(error),
      diagnostics: lastBuildRunDiagnostics,
    };
    const safeLabel = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const diagnosticsPath = path.join(
      validationDir,
      `${artifactPrefix}-${safeLabel}-build-run-diagnostics.json`
    );
    await writeFile(diagnosticsPath, JSON.stringify(diagnosticPayload, null, 2), "utf8");
    addReportArtifact(report, diagnosticsPath, `${label} build run diagnostics`);
    await captureScreenshot(sessionId, `${artifactPrefix}-${safeLabel}-build-run-diagnostics.png`).catch(
      () => null
    );
    console.error(`Build & Run diagnostics: ${JSON.stringify(diagnosticPayload)}`);
    fail(`Build & Run nao concluiu para ${label}.`, {
      statusCode: "build_run_timeout",
      errorCategory: "ui_assertion",
      details: diagnosticPayload,
    });
  });

  const romPath = extractLatestRomPath(state);
  if (!romPath) {
    fail(`Console nao registrou caminho de ROM para ${label}.`);
  }
  await assertPathExists(romPath, `ROM gerada nao encontrada para ${label}: ${romPath}`);
  const rom = await assertSegaHeader(romPath);

  const framebuffer = await waitFor(
    async () => {
      const stats = await readFramebufferStats(sessionId);
      return stats && stats.non_black_pixels > 0 ? stats : false;
    },
    30000,
    `Framebuffer do Libretro permaneceu vazio para ${label}.`,
    1000
  );

  return {
    label,
    rom_path: romPath,
    sega_header: rom.header,
    rom_size_bytes: rom.sizeBytes,
    framebuffer,
  };
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
    const preflightRecord = await logPreflightSummary(
      {
        externalDriver: options.externalDriver,
        tauriDriver: options.tauriDriver,
        nativeDriver: options.nativeDriver,
      },
      repoRoot
    );
    const tauriDriverCheck = preflightRecord?.checks?.tauriDriver;
    const webdriverCheck = preflightRecord?.checks?.webdriver;
    if (!options.externalDriver && tauriDriverCheck && !tauriDriverCheck.ok) {
      const code = tauriDriverCheck.statusCode ?? "tauri_driver_unusable";
      const detail = tauriDriverCheck.detail ? ` Detalhe: ${tauriDriverCheck.detail}` : "";
      fail(
        `Preflight desktop falhou: ${code}.${detail} ` +
          "Desbloqueie/allowlist o tauri-driver ou execute em runner Windows institucional."
      );
    }
    if (webdriverCheck && !webdriverCheck.ok) {
      fail(
        "Preflight desktop falhou: webdriver_missing. Configure toolchains/webdriver/msedgedriver.exe, " +
          "--native-driver, RDS_EDGE_DRIVER_PATH ou PATH."
      );
    }
  } catch (error) {
    if (error instanceof E2EFailure) {
      throw error;
    }
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
    options.scenario === "qa-rc" || options.scenario === "create-game-from-zero" ? 120000 : 30000
  );
  const uiBootstrapTimeoutMs = parsePositiveInteger(
    process.env.RDS_E2E_UI_TIMEOUT_MS,
    process.env.GITHUB_ACTIONS === "true" ? 30000 : 15000
  );
  const emulatorActivationTimeoutMs = parsePositiveInteger(process.env.RDS_E2E_RUN_TIMEOUT_MS, 300000);
  const liveValidationTimeoutMs = parsePositiveInteger(process.env.RDS_E2E_LIVE_TIMEOUT_MS, 60000);
  const requiresExistingProject =
    options.scenario !== "onboarding-shell" &&
    options.scenario !== "qa-rc" &&
    options.scenario !== "create-game-from-zero";
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

    if (options.scenario === "create-game-from-zero") {
      const artifactPrefix = `create-game-from-zero-${artifactTimestamp()}`;
      const reportPath = path.join(
        validationDir,
        `${artifactPrefix}-report.json`
      );
      const report = {
        generatedAt: null,
        scenario: "create-game-from-zero",
        projectName: "",
        projectDir: "",
        byorFixture: "",
        app: options.app,
        artifacts: [],
        steps: [],
        rom: null,
        roms: [],
        frames: [],
        non_black_pixels: 0,
      };

      await setSessionWindowRect(sessionId, 1920, 1080);

      await waitForOnboardingWizard(sessionId);
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-01-wizard.png`),
        "wizard"
      );
      addReportStep(report, "open_wizard", "passed");

      await clickByTestId(sessionId, "template-card-empty");
      await clickButtonByText(sessionId, "Mega Drive", "exact");

      const generatedProjectName = `E2E_Create_From_Zero_${Date.now()}`;
      await fillInputBySelector(
        sessionId,
        'input[placeholder="Nome do projeto"]',
        generatedProjectName
      );
      await clickButtonByText(sessionId, "Criar Projeto", "exact");

      const createdState = await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.activeProjectDir &&
            state.activeProjectName === generatedProjectName &&
            state.activeTarget === "megadrive" &&
            state.activeScene?.entityCount === 0
            ? state
            : false;
        },
        45000,
        "Projeto Mega Drive vazio nao foi criado pelo wizard.",
        500
      );
      report.projectName = generatedProjectName;
      report.projectDir = createdState.activeProjectDir;
      currentE2eRunContext.project = createdState.activeProjectDir;
      currentE2eRunContext.projectName = generatedProjectName;
      currentE2eRunContext.projectTarget = "megadrive";
      addReportStep(report, "create_empty_megadrive_project", "passed", {
        projectDir: createdState.activeProjectDir,
      });
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-02-empty-project.png`),
        "empty project"
      );

      const byorFixtureDir = path.join(validationDir, artifactPrefix);
      await mkdir(byorFixtureDir, { recursive: true });
      const byorFixturePath = path.join(byorFixtureDir, "player.ppm");
      await writeByorSafePlayerFixture(byorFixturePath);
      report.byorFixture = byorFixturePath;
      addReportArtifact(report, byorFixturePath, "BYOR-safe player sprite fixture");
      addReportStep(report, "create_byor_safe_sprite_fixture", "passed", {
        path: byorFixturePath,
      });

      await clickByTestId(sessionId, "workspace-rail-artstudio");
      await waitFor(
        async () =>
          executeScript(
            sessionId,
            "return Boolean(document.querySelector('[data-testid=\"artstudio-main-stage\"]'));"
          ),
        15000,
        "ArtStudio nao abriu pelo workspace rail.",
        250
      );
      await waitForArtStudioAutomationApi(sessionId, uiBootstrapTimeoutMs);
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-03-artstudio-open.png`),
        "artstudio open"
      );

      await ingestArtStudioSprite(sessionId, byorFixturePath);
      const loadedArt = await waitFor(
        async () => {
          const artState = await readArtStudioState(sessionId);
          return artState?.spriteSheetLoadStatus === "loaded" &&
            artState.suggestedFrames.length >= 3
            ? artState
            : false;
        },
        45000,
        "ArtStudio nao processou o sprite BYOR-safe com pelo menos 3 frames.",
        500
      );
      addReportStep(report, "import_byor_safe_sprite_in_artstudio", "passed", {
        suggestedFrames: loadedArt.suggestedFrames.length,
      });
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-04-artstudio-sprite-loaded.png`),
        "artstudio sprite loaded"
      );

      await clickArtStudioFrame(sessionId, "seq_run", 1);
      await clickArtStudioFrame(sessionId, "seq_jump", 2);
      const sequencedArt = await readArtStudioState(sessionId);
      addReportStep(report, "create_idle_run_jump_sequences", "passed", {
        sequences: sequencedArt?.sequences ?? [],
      });
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-05-artstudio-sequences.png`),
        "artstudio sequences"
      );

      await clickByTestId(sessionId, "artstudio-import-to-project");
      const importedArt = await waitFor(
        async () => {
          const artState = await readArtStudioState(sessionId);
          return artState?.spritePath && artState.canApplyToScene ? artState : false;
        },
        45000,
        "ArtStudio nao gerou asset canonico em assets/sprites.",
        500
      );
      addReportStep(report, "import_sprite_to_project_assets", "passed", {
        spritePath: importedArt.spritePath,
      });

      await clickByTestId(sessionId, "artstudio-apply-to-scene");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.selectedEntityId === "player" &&
            state.activeScene?.entities?.some(
              (entity) => entity.id === "player" && entity.spriteAsset
            )
            ? state
            : false;
        },
        15000,
        "ArtStudio nao criou a entidade player na cena.",
        250
      );
      addReportStep(report, "create_player_entity_from_artstudio", "passed", {
        entityId: "player",
      });
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-06-player-created.png`),
        "player entity created"
      );

      await clickTopBarMenuAction(sessionId, "Salvar");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.consoleEntries?.some((entry) =>
            String(entry.message ?? "").includes("Cena salva no projeto ativo.")
          )
            ? state
            : false;
        },
        15000,
        "Save via menu nao persistiu a entidade player antes do NodeGraph.",
        250
      );
      addReportStep(report, "save_player_entity_before_logic", "passed");

      await clickButtonByText(sessionId, "Voltar para Cena", "exact");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.activeWorkspace === "scene" &&
            state.selectedEntityId === "player" &&
            state.activeScene?.entities?.some((entity) => entity.id === "player")
            ? state
            : false;
        },
        15000,
        "Retorno Scene -> Art nao preservou o player selecionado.",
        250
      );
      await clickByTestId(sessionId, "hierarchy-entity-player");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.activeWorkspace === "scene" &&
            state.selectedEntityId === "player" &&
            state.activeScene?.entities?.some((entity) => entity.id === "player")
            ? state
            : false;
        },
        15000,
        "Hierarchy nao selecionou a entidade player antes do NodeGraph.",
        250
      );

      await clickByTestId(sessionId, "workspace-rail-logic");
      let lastNodeGraphDiagnostics = null;
      const nodeGraphReady = await waitFor(
        async () => {
          lastNodeGraphDiagnostics = await executeScript(
            sessionId,
            `
              const state = window.__RDS_E2E__?.getState?.() ?? null;
              const hasTemplate = Boolean(document.querySelector('[data-testid="nodegraph-template-mini_platformer"]'));
              const hasAppend = Boolean(document.querySelector('[data-testid="nodegraph-append-template-mini_platformer"]'));
              const actionTestId = hasTemplate
                ? "nodegraph-template-mini_platformer"
                : hasAppend
                  ? "nodegraph-append-template-mini_platformer"
                  : null;
              const templateIds = Array.from(
                document.querySelectorAll('[data-testid^="nodegraph-template-"], [data-testid^="nodegraph-append-template-"]')
              )
                .map((element) => element.getAttribute("data-testid"))
                .filter(Boolean)
                .slice(0, 20);
              const entityIds = Array.isArray(state?.activeScene?.entities)
                ? state.activeScene.entities
                    .map((entity) => entity?.entity_id ?? entity?.id)
                    .filter(Boolean)
                    .slice(0, 20)
                : [];
              return {
                ready:
                  state?.activeWorkspace === "logic" &&
                  state?.selectedEntityId === "player" &&
                  Boolean(actionTestId),
                actionTestId,
                activeWorkspace: state?.activeWorkspace ?? null,
                selectedEntityId: state?.selectedEntityId ?? null,
                activeViewportTab: state?.activeViewportTab ?? null,
                entityIds,
                hasCanvas: Boolean(document.querySelector('[data-testid="nodegraph-canvas"]')),
                hasEmpty: Boolean(document.querySelector('[data-testid="nodegraph-empty-overlay"]')),
                hasTemplate,
                hasAppend,
                nodeCount: document.querySelectorAll('[data-testid^="node-card-"]').length,
                templateIds,
                bodyText: document.body?.textContent?.replace(/\\s+/g, " ").trim().slice(0, 1200) ?? "",
              };
            `
          );
          return lastNodeGraphDiagnostics?.ready ? lastNodeGraphDiagnostics : false;
        },
        15000,
        "NodeGraph nao exibiu o atalho mini platformer para o player.",
        250
      ).catch(async (error) => {
        const diagnosticPayload = {
          cause: error instanceof Error ? error.message : String(error),
          diagnostics: lastNodeGraphDiagnostics,
        };
        const diagnosticsPath = path.join(
          validationDir,
          `${artifactPrefix}-nodegraph-diagnostics.json`
        );
        await writeFile(diagnosticsPath, JSON.stringify(diagnosticPayload, null, 2), "utf8");
        addReportArtifact(report, diagnosticsPath, "nodegraph diagnostics");
        await captureScreenshot(sessionId, `${artifactPrefix}-nodegraph-diagnostics.png`).catch(
          () => null
        );
        console.error(`NodeGraph diagnostics: ${JSON.stringify(diagnosticPayload)}`);
        fail("NodeGraph nao exibiu o atalho mini platformer para o player.", {
          statusCode: "nodegraph_template_missing",
          errorCategory: "ui_assertion",
          details: diagnosticPayload,
        });
      });
      await clickByTestId(sessionId, nodeGraphReady.actionTestId);
      await waitFor(
        async () =>
          executeScript(
            sessionId,
            "return document.querySelectorAll('[data-testid^=\"node-card-\"]').length >= 20;"
          ),
        15000,
        "NodeGraph nao materializou o mini platformer no-code.",
        250
      );
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-07-nodegraph-platformer.png`),
        "nodegraph platformer"
      );

      await waitFor(
        async () => {
          const logicState = await callAutomationApi(sessionId, "getEntityLogicState", ["player"]);
          return logicState?.resolved?.has_graph ? logicState : false;
        },
        15000,
        "Grafo do mini platformer nao foi aplicado na entidade player.",
        500
      );
      addReportStep(report, "create_nodegraph_platformer_logic", "passed", {
        includes: ["input", "movement", "gravity", "collision", "camera"],
        actionTestId: nodeGraphReady.actionTestId,
      });

      await clickTopBarMenuAction(sessionId, "Salvar");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.consoleEntries?.some((entry) =>
            String(entry.message ?? "").includes("Cena salva no projeto ativo.")
          )
            ? state
            : false;
        },
        15000,
        "Save via menu nao registrou persistencia da cena.",
        250
      );
      addReportStep(report, "save_created_game", "passed");

      const firstBuild = await runBuildRunAndCollect(
        sessionId,
        "first build from zero",
        emulatorActivationTimeoutMs,
        report,
        artifactPrefix
      );
      report.rom = firstBuild.rom_path;
      report.roms.push(firstBuild);
      report.frames.push({
        label: firstBuild.label,
        ...firstBuild.framebuffer,
      });
      addReportStep(report, "build_run_validate_rom_and_libretro", "passed", {
        rom: firstBuild.rom_path,
        non_black_pixels: firstBuild.framebuffer.non_black_pixels,
      });
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-08-first-build-run.png`),
        "first build run"
      );

      await clickTopBarMenuAction(sessionId, "Salvar");
      await clickTopBarMenuAction(sessionId, "Fechar");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          const wizardVisible = await executeScript(
            sessionId,
            "return Boolean(document.querySelector('[data-testid=\"project-wizard-body\"]'));"
          );
          return !state?.activeProjectDir && wizardVisible ? true : false;
        },
        15000,
        "Projeto nao fechou e/ou wizard nao reabriu.",
        250
      );
      addReportStep(report, "close_project", "passed");
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-09-closed-wizard.png`),
        "closed wizard"
      );

      await fillInputBySelector(
        sessionId,
        'input[placeholder="Nome do projeto"]',
        generatedProjectName
      );
      await waitFor(
        async () =>
          executeScript(
            sessionId,
            `
              const card = document.querySelector('[data-testid="wizard-existing-project-card"]');
              const path = document.querySelector('[data-testid="wizard-existing-project-path"]')?.textContent ?? "";
              return Boolean(card) && path.includes(arguments[0]);
            `,
            [createdState.activeProjectDir]
          ),
        30000,
        "Wizard nao detectou o projeto existente para reabrir.",
        500
      );
      await clickByTestId(sessionId, "wizard-open-existing-project");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.activeProjectDir === createdState.activeProjectDir &&
            state.activeScene?.entities?.some((entity) => entity.id === "player")
            ? state
            : false;
        },
        45000,
        "Projeto criado do zero nao reabriu com a entidade player.",
        500
      );
      addReportStep(report, "reopen_project", "passed", {
        projectDir: createdState.activeProjectDir,
      });
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-10-reopened-project.png`),
        "reopened project"
      );

      await clickByTestId(sessionId, "hierarchy-entity-player");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.selectedEntityId === "player" ? state : false;
        },
        10000,
        "Hierarchy nao selecionou o player reaberto.",
        250
      );

      const reopenedLogicState = await callAutomationApi(sessionId, "getEntityLogicState", ["player"]);
      if (!reopenedLogicState?.resolved?.has_graph && !reopenedLogicState?.source?.has_graph) {
        fail("Grafo do player nao persistiu apos fechar e reabrir.");
      }
      addReportStep(report, "validate_persisted_nodegraph_after_reopen", "passed");

      const secondBuild = await runBuildRunAndCollect(
        sessionId,
        "reopened build",
        emulatorActivationTimeoutMs,
        report,
        artifactPrefix
      );
      report.roms.push(secondBuild);
      report.frames.push({
        label: secondBuild.label,
        ...secondBuild.framebuffer,
      });
      addReportStep(report, "rebuild_after_reopen", "passed", {
        rom: secondBuild.rom_path,
        non_black_pixels: secondBuild.framebuffer.non_black_pixels,
      });
      addReportArtifact(
        report,
        await captureScreenshot(sessionId, `${artifactPrefix}-11-reopened-build-run.png`),
        "reopened build run"
      );

      const savedReport = await writeCreateGameReport(report, reportPath);
      console.log("OK: Desktop Tauri create-game-from-zero E2E passou.");
      console.log(`Projeto criado: ${generatedProjectName}`);
      console.log(`Diretorio do projeto: ${createdState.activeProjectDir}`);
      console.log(`Fixture BYOR-safe: ${byorFixturePath}`);
      console.log(`ROM inicial: ${firstBuild.rom_path}`);
      console.log(`ROM reaberta: ${secondBuild.rom_path}`);
      console.log(
        `Framebuffer reaberto: ${secondBuild.framebuffer.width}x${secondBuild.framebuffer.height}, pixels nao pretos: ${secondBuild.framebuffer.non_black_pixels}`
      );
      console.log(`Relatorio: ${savedReport}`);
      return;
    }

    if (options.scenario === "qa-rc") {
      const artifactPrefix = `qa-rc-${artifactTimestamp()}`;
      const manualQaReport = createManualQaReport();
      manualQaReport.app = options.app;
      const uiLayoutOracleRecords = [];
      const uiLayoutShotNames = [];
      let currentBlock = "A";

      try {
        await setSessionWindowRect(sessionId, 1920, 1080);
        await waitForOnboardingWizard(sessionId);
        const wizardScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-A-wizard.png`
        );
        registerArtifact(manualQaReport, wizardScreenshot, "A - wizard");

        currentBlock = "H";
        const importWizardTarget = UI_LAYOUT_ORACLE_TARGETS.find((target) => target.id === "import-wizard");
        for (const resolution of UI_LAYOUT_ORACLE_RESOLUTIONS) {
          await setSessionWindowRect(sessionId, resolution.width, resolution.height);
          await waitForOnboardingWizard(sessionId);
          await runUiLayoutOracleCheck(
            sessionId,
            importWizardTarget,
            resolution,
            artifactPrefix,
            uiLayoutOracleRecords,
            uiLayoutShotNames,
            manualQaReport
          );
        }
        await setSessionWindowRect(sessionId, 1920, 1080);
        currentBlock = "A";

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
            "Build & Run do RC nao ativou o emulador.",
            1000
          );
        } catch (error) {
          const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
          const details = error instanceof Error ? error.message : String(error);
          fail(diagnostics ? `${details}\n${diagnostics}` : details);
        }

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
        const importSummaryText = await waitFor(
          async () => {
            const text = await executeScript(
              sessionId,
              "return document.querySelector('[data-testid=\"sgdk-import-summary\"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';"
            );
            return /Resumo SGDK Logic/.test(String(text)) &&
              /estados detectados/.test(String(text)) &&
              /transicoes detectadas/.test(String(text)) &&
              /nodes gerados/.test(String(text)) &&
              /bridges criadas/.test(String(text)) &&
              /Equivalencia gameplay nao certificada/.test(String(text))
              ? String(text)
              : false;
          },
          20000,
          "Bloco G: resumo pos-import SGDK Logic nao ficou visivel com contadores honestos.",
          250
        );
        const importSummaryScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-scene-import-summary.png`
        );
        registerArtifact(manualQaReport, importSummaryScreenshot, "G - scene import summary");
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
        const initialGraphRef =
          navigationLogicState?.source?.graph_ref ?? navigationLogicState?.resolved?.graph_ref ?? null;
        let initialGraphNodeCount = 0;
        let initialGraphHasFsm = false;
        let initialGraphHasBridge = false;
        let initialGraphHasMappedNode = false;
        if (initialGraphRef) {
          const initialGraphRefRelative = String(initialGraphRef).replace(/^graphs[\\/]/i, "");
          const initialGraphAbs = path.join(sgdkProjectDir, "graphs", initialGraphRefRelative);
          if (await pathExists(initialGraphAbs)) {
            const initialGraphContent = await readFile(initialGraphAbs, "utf8");
            const initialGraphParsed = JSON.parse(initialGraphContent);
            const initialGraphNodes = Array.isArray(initialGraphParsed.nodes) ? initialGraphParsed.nodes : [];
            initialGraphNodeCount = initialGraphNodes.length;
            initialGraphHasFsm = initialGraphNodes.some((node) =>
              String(node?.type ?? "").toLowerCase().startsWith("fsm_")
            );
            initialGraphHasBridge = initialGraphNodes.some((node) => {
              const type = String(node?.type ?? "");
              const params = node?.params ?? {};
              return type === "bridge_unconverted_source" ||
                String(params.import_status ?? "").toLowerCase() === "bridge" ||
                Boolean(params.bridge) ||
                Boolean(params.gap || params.gap_id);
            });
            initialGraphHasMappedNode = initialGraphNodes.some((node) => {
              const params = node?.params ?? {};
              return Boolean(params.source_file || params.source_path || params.source);
            });
          }
        }
        await waitFor(
          async () => {
            const diagnostics = await readNodeGraphUiDiagnostics(sessionId);
            return diagnostics?.hasCanvas && diagnostics?.hasOverview && diagnostics.cardCount >= 1
              ? diagnostics
              : false;
          },
          20000,
          "Bloco G: NodeGraph nao renderizou nodes apos abrir Logic Workspace.",
          250
        );
        const graphDiagnostics = await assertNodeGraphUiDiagnostics(sessionId, {
          expectFsm: initialGraphHasFsm,
        });
        if (initialGraphHasMappedNode && graphDiagnostics.sourceMappedBadgeCount < 1) {
          fail("Bloco G: grafo importado tinha source mapping por node, mas badge 'Source mapped' nao apareceu.");
        }
        if (initialGraphHasBridge && graphDiagnostics.bridgeBadgeCount < 1 && graphDiagnostics.gapBadgeCount < 1) {
          fail("Bloco G: grafo importado tinha bridge/gap, mas nenhum badge Bridge/Gap apareceu.");
        }
        await assertNoGrossMainShellTextOverlap(sessionId);
        const logicGraphScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-logic-fsm-graph.png`
        );
        registerArtifact(manualQaReport, logicGraphScreenshot, "G - logic graph FSM/heuristic truth");
        const sourceMappingScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-node-source-mapping.png`
        );
        registerArtifact(manualQaReport, sourceMappingScreenshot, "G - node source mapping");
        const gapFilterNeedle = graphDiagnostics.gapPanelText.includes("AST/FSM")
          ? "AST"
          : graphDiagnostics.gapPanelText.includes("Bridge")
            ? "Bridge"
            : "";
        if (gapFilterNeedle) {
          const gapFilterApplied = await executeScript(
            sessionId,
            `
              const input = document.querySelector('[data-testid="nodegraph-gap-filter"]');
              if (!(input instanceof HTMLInputElement)) {
                return false;
              }
              const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
              descriptor?.set?.call(input, arguments[0]);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              return true;
            `,
            [gapFilterNeedle]
          );
          if (!gapFilterApplied) {
            fail("Bloco G: painel Import Gaps nao aceitou filtro.");
          }
        }
        const gapBridgeScreenshot = await captureScreenshot(
          sessionId,
          `${artifactPrefix}-G-gap-bridge-panel.png`
        );
        registerArtifact(manualQaReport, gapBridgeScreenshot, "G - gap bridge panel");
        const openedSourceAttempt = await tryAutomationApi(
          sessionId,
          "openEntitySourcePath",
          [sgdkLogicEntityId, primarySourceRef],
          8000
        );
        const sourceNavigationSummary = openedSourceAttempt?.ok
          ? `fonte '${openedSourceAttempt.value?.relative_path ?? primarySourceRef}' acionada no host`
          : `fallback honesto para '${primarySourceRef}': ${openedSourceAttempt?.reason ?? "sem retorno do host"}`;
        const logicSourceNote = [
          `Objeto -> logica -> fonte: entidade '${sgdkLogicEntityId}' abriu Logic Workspace com ${graphDiagnostics.cardCount} node(s) renderizado(s), graph_ref='${initialGraphRef ?? "inline"}', FSM=${initialGraphHasFsm ? "sim" : "nao/heuristico"}, bridge/gap=${initialGraphHasBridge || graphDiagnostics.gapPanelVisible ? "visivel" : "ausente"}. ${sourceNavigationSummary}.`,
          `Source Mapping: ${graphDiagnostics.sourceMappingText}.`,
          `Gaps: ${graphDiagnostics.gapPanelText}.`,
          `Evidencias: ${path.basename(logicGraphScreenshot)}, ${path.basename(sourceMappingScreenshot)}, ${path.basename(gapBridgeScreenshot)}.`,
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
          30000,
          "Bloco G: navegacao objeto -> art nao abriu o Art Workspace integrado.",
          250
        );
        const artStudioFixtures = await writeArtStudioVerticalFixtures(sgdkProjectDir);
        await callArtStudioApi(sessionId, "loadImage", [artStudioFixtures.spritePath]);
        await waitFor(
          async () => {
            const bodyText = await executeScript(
              sessionId,
              "return document.body?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';"
            );
            return bodyText.includes("Imagem pronta") && bodyText.includes("Key color: transparente")
              ? bodyText
              : false;
          },
          25000,
          "Bloco G: ArtStudio nao processou a imagem E2E com preview/key color.",
          250
        );
        await callArtStudioApi(sessionId, "setFrameSize", [32, 32]);
        await callArtStudioApi(sessionId, "renameSequence", ["seq_idle", "Idle"]);
        await callArtStudioApi(sessionId, "renameSequence", ["seq_run", "Run"]);
        await callArtStudioApi(sessionId, "renameSequence", ["seq_jump", "Jump"]);
        await callArtStudioApi(sessionId, "renameSequence", ["seq_attack", "Attack"]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_idle", [0]]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_run", [0, 1]]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_jump", [2]]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_attack", [3]]);
        const commandCount = await callArtStudioApi(sessionId, "importCommandDat", [
          artStudioFixtures.commandPath,
        ]);
        if (commandCount < 1) {
          fail("Bloco G: command.dat E2E nao retornou comandos importaveis.");
        }
        const commandAssigned = await callArtStudioApi(sessionId, "assignCommand", [
          "seq_attack",
          "slash",
        ]);
        if (!commandAssigned) {
          fail("Bloco G: ArtStudio nao associou o comando Slash a animacao Attack.");
        }
        await callArtStudioApi(sessionId, "importToProject");
        await executeScript(
          sessionId,
          "return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));"
        );
        const artImportedState = await waitFor(
          async () => {
            const state = await readArtStudioState(sessionId);
            return state?.spritePath?.startsWith("assets/sprites/") ? state : false;
          },
          30000,
          "Bloco G: ArtStudio nao gerou asset canonico em assets/sprites.",
          250
        );
        // Reaplica authoring apos import canonico para evitar reset de metadata da entidade SGDK.
        await callArtStudioApi(sessionId, "renameSequence", ["seq_idle", "Idle"]);
        await callArtStudioApi(sessionId, "renameSequence", ["seq_run", "Run"]);
        await callArtStudioApi(sessionId, "renameSequence", ["seq_jump", "Jump"]);
        await callArtStudioApi(sessionId, "renameSequence", ["seq_attack", "Attack"]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_idle", [0]]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_run", [0, 1]]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_jump", [2]]);
        await callArtStudioApi(sessionId, "setSequenceFrames", ["seq_attack", [3]]);
        const commandRebound = await callArtStudioApi(sessionId, "assignCommand", [
          "seq_attack",
          "slash",
        ]);
        if (!commandRebound) {
          fail("Bloco G: ArtStudio perdeu o binding Slash apos import canonico.");
        }
        await callAutomationApi(sessionId, "setSelectedEntityId", [sgdkLogicEntityId]);
        const artApplied = await callArtStudioApi(sessionId, "applyToScene", [sgdkLogicEntityId]);
        if (!artApplied) {
          const artStudioDiag = await readArtStudioState(sessionId);
          const automationDiag = await readAutomationState(sessionId);
          const entityDiag = automationDiag?.activeScene?.entities?.find(
            (candidate) => candidate.id === sgdkLogicEntityId
          );
          fail(
            [
              "Bloco G: ArtStudio applyToScene retornou falso",
              `(${artStudioDiag?.validationError ?? "sem diagnostico de validacao"})`,
              entityDiag
                ? `entidade=${sgdkLogicEntityId} spriteAsset=${entityDiag.spriteAsset ?? "null"} animations=${(entityDiag.animationNames ?? []).join("|") || "none"} commands=${entityDiag.commandCount ?? 0}`
                : `entidade=${sgdkLogicEntityId} ausente no estado de automacao`,
              artStudioDiag?.spritePath
                ? `artStudio.spritePath=${artStudioDiag.spritePath}`
                : "artStudio.spritePath=ausente",
            ].join(" ")
          );
        }
        const normalizeAssetPath = (value) => String(value ?? "").replace(/\\/g, "/");
        const importedSpritePath = normalizeAssetPath(artImportedState.spritePath);
        const artAppliedState = await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            const entity = state?.activeScene?.entities?.find(
              (candidate) => candidate.id === sgdkLogicEntityId
            );
            return entity &&
              normalizeAssetPath(entity.spriteAsset) === importedSpritePath &&
              entity.animationNames?.includes("attack") &&
              entity.commandCount >= 1
              ? state
              : false;
          },
          15000,
          "Bloco G: ArtStudio nao aplicou sprite, animacoes e command binding na entidade.",
          250
        );
        const artAppliedEntity = artAppliedState.activeScene.entities.find(
          (candidate) => candidate.id === sgdkLogicEntityId
        );
        await callAutomationApi(
          sessionId,
          "persistScene",
          [
            "E2E ArtStudio vertical",
            `[E2E] ArtStudio aplicou '${artImportedState.spritePath}' com animacoes ${artAppliedEntity.animationNames.join(", ")} e command.dat na entidade '${sgdkLogicEntityId}'.`,
          ]
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
          `Art integrado: '${sgdkLogicEntityId}' importou sheet, criou Idle/Run/Jump/Attack, associou command.dat, aplicou '${artImportedState.spritePath}' na entidade e retornou ao Scene sem perder selectedEntityId.`,
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
        const layoutTargets = UI_LAYOUT_ORACLE_TARGETS.filter((target) => target.id !== "import-wizard");
        for (const resolution of UI_LAYOUT_ORACLE_RESOLUTIONS) {
          await setSessionWindowRect(sessionId, resolution.width, resolution.height);
          for (const target of layoutTargets) {
            await runUiLayoutOracleCheck(
              sessionId,
              target,
              resolution,
              artifactPrefix,
              uiLayoutOracleRecords,
              uiLayoutShotNames,
              manualQaReport
            );
          }
        }
        const uiLayoutOracleReport = await writeUiLayoutOracleReport(
          uiLayoutOracleRecords,
          artifactPrefix
        );
        const layoutValidationNotes = uiLayoutOracleRecords.map(
          (record) => `${record.resolutionTag}/${record.targetId}:${record.ok ? "ok" : "fail"}`
        );
        await markManualQaBlock(
          manualQaReport,
          "H",
          "passed",
          [
            `QA visual de layout: ${UI_LAYOUT_ORACLE_RESOLUTIONS.length} resolucoes x ${UI_LAYOUT_ORACLE_TARGETS.length} alvos (Import Wizard, Scene, Art, Logic, NodeGraph, Game, Debug, Runtime Setup) com oraculo DOM/BoundingClientRect.`,
            `Validacoes: ${layoutValidationNotes.join(", ")}.`,
            `Relatorio: ${path.basename(uiLayoutOracleReportPath)} status=${uiLayoutOracleReport.status}.`,
            `Evidencias: ${uiLayoutShotNames.join(", ")}.`,
          ].join(" ")
        );

        await markManualQaBlock(
          manualQaReport,
          "G",
          "passed",
          [
            `Import SGDK -> cena activa == entry_scene ('${entrySceneExpected}') -> projectSourceKind=imported_sgdk -> onboarding nao bloqueia -> viewport asset health -> Inspector preview -> instantiateBrowserImageAsset(stage)=tilemap(${stageInst.reason}) + hero=sprite(${heroInst.reason}) -> persistencias -> reopen mantem cena/entidades -> editar graph_ref '${sgdkLogicEntityId}' -> colisao -> persistir -> reabrir -> Build & Run -> ROM '${romName}' SEGA.`,
            `Resumo pos-import: ${importSummaryText}. Evidencia: ${path.basename(importSummaryScreenshot)}.`,
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
      await recordE2eLedgerSuccess(options, projectMetadata);
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
      if (options.scenario === "live-error") {
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.hwValidationState === "error" ? state : false;
          },
          liveValidationTimeoutMs,
          "Validacao live nao entrou em error apos draft invalido.",
          250
        );
      } else {
        await waitForLiveValidationFresh(sessionId, liveValidationTimeoutMs);
      }

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
          await recordE2eLedgerSuccess(options, projectMetadata);
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
      await recordE2eLedgerSuccess(options, projectMetadata);
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
      await recordE2eLedgerSuccess(options, projectMetadata);
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
    await recordE2eLedgerSuccess(options, projectMetadata);
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
