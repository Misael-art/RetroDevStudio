#!/usr/bin/env node

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function fail(message) {
  throw new Error(message);
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
    throw new Error(`${label}: ${lastError.message}`);
  }
  throw new Error(label);
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

function createManualQaReport() {
  return {
    generatedAt: null,
    scenario: "qa-rc",
    projectName: "",
    projectDir: "",
    app: "",
    artifacts: [],
    blocks: {
      A: { status: "pending", note: null },
      B: { status: "pending", note: null },
      C: { status: "pending", note: null },
      D: { status: "pending", note: null },
      E: { status: "pending", note: null },
      F: { status: "pending", note: null },
    },
  };
}

async function writeManualQaReport(report) {
  await ensureValidationDir();
  report.generatedAt = new Date().toISOString();
  await writeFile(manualQaStatusPath, `${JSON.stringify(report, null, 2)}\n`);
}

function registerArtifact(report, filePath, label) {
  report.artifacts.push({
    label,
    path: filePath,
  });
}

async function markManualQaBlock(report, blockId, status, note) {
  report.blocks[blockId] = {
    status,
    note,
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

async function sceneOverlayPointerAction(sessionId, x, y, button = 0) {
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
      const buttons = button === 2 ? 2 : 1;
      const eventInit = {
        bubbles: true,
        cancelable: true,
        button,
        buttons,
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
    [x, y, button]
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

async function clickButtonByText(sessionId, label) {
  const result = await executeScript(
    sessionId,
    `
      const normalizedLabel = String(arguments[0]).trim();
      const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
        const text = candidate.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        return text === normalizedLabel;
      });
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return false;
      }
      button.click();
      return true;
    `,
    [label]
  );

  if (!result) {
    fail(`Botao nao encontrado ou desabilitado: ${label}`);
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
          staleHint: liveState === "DESATUAL." ? liveStateDetail : "",
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
    staleHint: liveState === "DESATUAL." ? liveStateDetail : "",
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
  if (!options.appExplicitlyProvided) {
    options.app = await resolveDefaultDesktopApp();
  }
  const driverStartupTimeoutMs = parsePositiveInteger(
    process.env.RDS_E2E_DRIVER_TIMEOUT_MS,
    30000
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
      fail(
        [
          `Ja existe um tauri-driver respondendo em ${driverServerUrl}.`,
          "Finalize o processo existente ou execute o runner com --external-driver.",
        ].join(" ")
      );
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
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      fail(sessionBootstrapHint(details, options));
    }
    if (!sessionId) {
      fail("Sessao WebDriver nao foi criada.");
    }

    await waitFor(
      async () => {
        const title = await getTitle(sessionId);
        return title.includes("RetroDev Studio");
      },
      15000,
      "Janela do app nao abriu corretamente"
    );

    await waitFor(
      async () =>
        executeScript(
          sessionId,
          "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"
        ),
      15000,
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

        const buildRunButton = await findElement(sessionId, "[data-testid='toolbar-build-run']");
        await clickElement(sessionId, buildRunButton);
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

        const pauseButton = await findElement(sessionId, "[data-testid='viewport-pause']");
        await clickElement(sessionId, pauseButton);
        await waitFor(
          async () => {
            const state = await readAutomationState(sessionId);
            return state?.emulPaused === true ? state : false;
          },
          10000,
          "Botao Pausar nao refletiu o estado pausado.",
          100
        );

        const resumeButton = await findElement(sessionId, "[data-testid='viewport-resume']");
        await clickElement(sessionId, resumeButton);
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
        await waitFor(
          async () => {
            const title = await getTitle(sessionId);
            return title.includes("RetroDev Studio");
          },
          15000,
          "Janela do app nao reabriu para validar persistencia."
        );
        await waitFor(
          async () =>
            executeScript(
              sessionId,
              "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"
            ),
          15000,
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

        await writeManualQaReport(manualQaReport);
        console.log("OK: Desktop Tauri QA RC A-F passou.");
        console.log(`Projeto criado: ${generatedProjectName}`);
        console.log(`Diretorio temporario: ${temporaryProjectDir}`);
        console.log(`Relatorio QA: ${manualQaStatusPath}`);
        for (const artifact of manualQaReport.artifacts) {
          console.log(`Evidencias: ${artifact.path}`);
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markManualQaBlock(
          manualQaReport,
          currentBlock,
          "failed",
          `Falha no bloco ${currentBlock}: ${message}`
        );
        throw error;
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
      fail(`Falha ao abrir projeto no app: ${openResult?.error ?? "sem diagnostico"}`);
    }

    await waitFor(
      async () => {
        const state = await readAutomationState(sessionId);
        return state?.activeProjectDir && state.activeProjectName ? state : false;
      },
      15000,
      "Projeto nao apareceu na UI"
    );

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

      const pendingStatus = await waitFor(
        async () => {
          const status = await readLiveStatus(sessionId);
          return status.liveState === "ANALISANDO" &&
            !status.disabled &&
            !status.reason &&
            status.pendingSummary.includes("Live em analise")
            ? status
            : false;
        },
        liveValidationTimeoutMs,
        "UI live nao refletiu ANALISANDO apos revalidacao manual",
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
      console.log(`Estado apos revalidar: ${pendingStatus.liveState} | Resumo: ${pendingStatus.pendingSummary}`);
      return;
    }

    try {
      await waitForBuildRunReady(sessionId, liveValidationTimeoutMs);
    } catch (error) {
      const diagnostics = formatAppDiagnostics(await collectAppDiagnostics(sessionId));
      const details = error instanceof Error ? error.message : String(error);
      fail(diagnostics ? `${details}\n${diagnostics}` : details);
    }

    const buildRunButton = await findElement(sessionId, "[data-testid='toolbar-build-run']");
    await clickElement(sessionId, buildRunButton);

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
      driverProcess.kill();
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

main().catch((error) => {
  const details = error instanceof Error ? error.message : String(error);
  emitGithubErrorAnnotation(details);
  console.error(`ERRO: ${details}`);
  process.exit(1);
});
