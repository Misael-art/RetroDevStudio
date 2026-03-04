#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const driverServerUrl = "http://127.0.0.1:4444";

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

function parseArgs(argv) {
  const options = {
    skipBuild: false,
    scenario: "build-run",
    project: path.join(repoRoot, "src-tauri", "tests", "fixtures", "projects", "megadrive_dummy"),
    app: path.join(repoRoot, "src-tauri", "target", "debug", "retro-dev-studio.exe"),
    tauriDriver: process.env.TAURI_DRIVER_PATH ?? "",
    nativeDriver: process.env.RDS_EDGE_DRIVER_PATH ?? process.env.NATIVE_DRIVER_PATH ?? "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-build") {
      options.skipBuild = true;
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
          "live-overflow",
          "live-overflow-vram",
          "live-warning-vram",
          "live-warning-sprites",
        ].includes(
          value
        )
      ) {
        fail(`Cenario E2E desconhecido: ${value}`);
      }
      options.scenario = value;
    } else if (argument === "--app") {
      options.app = path.resolve(repoRoot, value);
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
      prefab: "overflow_sprite",
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
        prefab: "overflow_vram",
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
        prefab: "warning_vram",
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
      prefab: "warning_sprite",
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

function buildLiveOverflowScenario(target, scenario) {
  if (scenario === "live-overflow-vram") {
    return {
      draft: buildVramOverflowScene(target),
      expectedReasonFragment: "VRAM Overflow",
      expectedSeverity: "OVERFLOW",
      expectedToolbarState: "BLOQUEADO",
      expectBuildDisabled: true,
    };
  }

  if (scenario === "live-warning-vram") {
    return {
      draft: buildVramWarningScene(target),
      expectedReasonFragment: "VRAM Warning",
      expectedSeverity: "WARN",
      expectedToolbarState: "WARN",
      expectBuildDisabled: false,
    };
  }

  if (scenario === "live-warning-sprites") {
    return {
      draft: buildSpriteWarningScene(target),
      expectedReasonFragment: "Sprite Warning",
      expectedSeverity: "WARN",
      expectedToolbarState: "WARN",
      expectBuildDisabled: false,
    };
  }

  return {
    draft: buildSpriteOverflowScene(target),
    expectedReasonFragment: "Sprite overflow",
    expectedSeverity: "OVERFLOW",
    expectedToolbarState: "BLOQUEADO",
    expectBuildDisabled: true,
  };
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

async function getTitle(sessionId) {
  const response = await webdriverRequest("GET", `/session/${sessionId}/title`);
  return response.value ?? "";
}

function summarizeDriverLogs(logs) {
  return logs.slice(-20).join("\n");
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
    `consoleTail=${consoleTail}`,
  ].join("\n");
}

async function main() {
  if (process.platform !== "win32") {
    fail("Este runner E2E desktop/Tauri e suportado apenas em Windows.");
  }

  if (typeof fetch !== "function") {
    fail("Este script requer Node.js com suporte a fetch global.");
  }

  const options = parseArgs(process.argv.slice(2));
  const driverStartupTimeoutMs = parsePositiveInteger(
    process.env.RDS_E2E_DRIVER_TIMEOUT_MS,
    30000
  );
  const emulatorActivationTimeoutMs = parsePositiveInteger(process.env.RDS_E2E_RUN_TIMEOUT_MS, 180000);
  await assertPathExists(
    options.project,
    `Projeto de fixture nao encontrado: ${options.project}`
  );
  const projectMetadata = await readProjectMetadata(options.project);
  if (!projectMetadata.name || !projectMetadata.target) {
    fail(`project.rds invalido ou incompleto em ${options.project}`);
  }

  const tauriDriverPath = await resolveExecutable(options.tauriDriver, ["tauri-driver", "tauri-driver.exe"]);
  if (!tauriDriverPath) {
    fail(
      [
        "tauri-driver nao encontrado.",
        "Instale-o com: cargo install tauri-driver --locked",
      ].join(" ")
    );
  }

  const nativeDriverPath = await resolveExecutable(options.nativeDriver, ["msedgedriver", "msedgedriver.exe"]);
  if (!nativeDriverPath) {
    fail(
      [
        "msedgedriver nao encontrado.",
        "Instale um driver compativel com o Edge do sistema, por exemplo com o utilitario oficial:",
        "cargo install --git https://github.com/chippers/msedgedriver-tool",
      ].join(" ")
    );
  }

  if (!options.skipBuild) {
    console.log("== Building debug Tauri app ==");
    await spawnLogged(npmCommand(), ["run", "tauri", "build", "--", "--debug", "--no-bundle"]);
  }

  await assertPathExists(
    options.app,
    `Binario debug do Tauri nao encontrado: ${options.app}`
  );

  console.log("== Starting tauri-driver ==");
  const driverLogs = [];
  const driverProcess = spawn(tauriDriverPath, ["--native-driver", nativeDriverPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  driverProcess.stdout.on("data", (chunk) => {
    const lines = chunk
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    driverLogs.push(...lines);
  });

  driverProcess.stderr.on("data", (chunk) => {
    const lines = chunk
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    driverLogs.push(...lines);
  });

  let sessionId = "";
  try {
    await waitFor(
      async () => {
        const response = await fetch(`${driverServerUrl}/status`);
        return response.ok;
      },
      driverStartupTimeoutMs,
      "tauri-driver nao ficou pronto a tempo"
    );

    sessionId = await createSession(options.app);
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
        const projectName = await executeScript(
          sessionId,
          "return document.querySelector('[data-testid=\"active-project-name\"]')?.textContent?.trim() ?? '';"
        );
        return projectName && projectName !== "Sem projeto";
      },
      15000,
      "Projeto nao apareceu na UI"
    );

    if (
      options.scenario === "live-overflow" ||
      options.scenario === "live-overflow-vram" ||
      options.scenario === "live-warning-vram" ||
      options.scenario === "live-warning-sprites"
    ) {
      const overflowScenario = buildLiveOverflowScenario(projectMetadata.target, options.scenario);
      const draftResult = await executeAsyncScript(
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
        [overflowScenario.draft]
      );

      if (!draftResult?.ok) {
        fail(`Falha ao injetar draft overflow: ${draftResult?.error ?? "sem diagnostico"}`);
      }

      const liveStatus = await waitFor(
        async () => {
          const result = await executeScript(
            sessionId,
            `
              const button = document.querySelector('[data-testid="toolbar-build-run"]');
              const reason = document.querySelector('[data-testid="build-disabled-reason"]');
              const summary = document.querySelector('[data-testid="build-warning-summary"]');
              const liveState = document.querySelector('[data-testid="build-live-state"]');
              const severity = document.querySelector('[data-testid="hardware-limits-severity"]');
              const warning = document.querySelector('[data-testid="hardware-warning-0"]');
              const error = document.querySelector('[data-testid="hardware-error-0"]');
              return {
                disabled: Boolean(button?.disabled),
                describedBy: button?.getAttribute('aria-describedby') ?? '',
                reason: reason?.textContent?.trim() ?? '',
                summary: summary?.textContent?.trim() ?? '',
                liveState: liveState?.textContent?.trim() ?? '',
                severity: severity?.textContent?.trim() ?? '',
                warning: warning?.textContent?.trim() ?? '',
                error: error?.textContent?.trim() ?? '',
              };
            `
          );
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
        30000,
        "UI live nao refletiu o estado esperado para o draft injetado",
        500
      );

      if (overflowScenario.expectBuildDisabled) {
        if (liveStatus.describedBy !== "build-disabled-reason") {
          fail(`Botao Build nao expôs aria-describedby esperado. Atual: ${liveStatus.describedBy}`);
        }

        if (!liveStatus.reason.includes(overflowScenario.expectedReasonFragment)) {
          fail(`Motivo visual inesperado para overflow live: ${liveStatus.reason}`);
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
          : `Warning visual: ${liveStatus.summary}`
      );
      return;
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
    driverProcess.kill();
  }
}

main().catch((error) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
