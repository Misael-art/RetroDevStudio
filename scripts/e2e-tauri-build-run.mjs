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
import { constants as fsConstants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  UI_LAYOUT_ORACLE_RESOLUTIONS,
  UI_LAYOUT_ORACLE_TARGETS,
  buildUiLayoutOracleReport,
  evaluateUiLayoutOracleSnapshot,
} from "./ui-layout-oracle.mjs";
import { diagnose as diagnoseHost } from "./host-manager.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseElf32Symbols(elf) {
  if (elf.length < 52 || elf.subarray(0, 4).toString("ascii") !== "\x7fELF" || elf[4] !== 1) {
    throw new Error("Expected the SGDK-linked ELF32 image at out/rom.out");
  }
  const littleEndian = elf[5] === 1;
  const read16 = (offset) => littleEndian ? elf.readUInt16LE(offset) : elf.readUInt16BE(offset);
  const read32 = (offset) => littleEndian ? elf.readUInt32LE(offset) : elf.readUInt32BE(offset);
  const sectionOffset = read32(32);
  const sectionEntrySize = read16(46);
  const sectionCount = read16(48);
  if (sectionEntrySize < 40 || sectionOffset + sectionEntrySize * sectionCount > elf.length) {
    throw new Error("Malformed section table in SGDK ELF image");
  }
  const symbols = new Map();
  for (let index = 0; index < sectionCount; index += 1) {
    const section = sectionOffset + index * sectionEntrySize;
    const type = read32(section + 4);
    if (type !== 2 && type !== 11) continue;
    const tableOffset = read32(section + 16);
    const tableSize = read32(section + 20);
    const stringTableIndex = read32(section + 24);
    const symbolEntrySize = read32(section + 36);
    const stringSection = sectionOffset + stringTableIndex * sectionEntrySize;
    if (!symbolEntrySize || symbolEntrySize < 16 || tableOffset + tableSize > elf.length || stringSection + 40 > elf.length) continue;
    const stringsOffset = read32(stringSection + 16);
    const stringsSize = read32(stringSection + 20);
    if (stringsOffset + stringsSize > elf.length) continue;
    for (let symbolOffset = tableOffset; symbolOffset + 16 <= tableOffset + tableSize; symbolOffset += symbolEntrySize) {
      const nameOffset = read32(symbolOffset);
      if (!nameOffset || nameOffset >= stringsSize) continue;
      const end = elf.indexOf(0, stringsOffset + nameOffset);
      if (end < 0) continue;
      const name = elf.toString("utf8", stringsOffset + nameOffset, end);
      if (name) symbols.set(name, read32(symbolOffset + 4));
    }
  }
  return symbols;
}

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

async function readGitEvidence() {
  const runGit = (args) =>
    new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd: repoRoot,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.on("error", () => resolve(null));
      child.on("exit", (code) => resolve(code === 0 ? output.trim() : null));
    });

  const [commit, status] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["status", "--porcelain"]),
  ]);
  return { commit, dirty: status === null ? null : status.length > 0 };
}

function getDesktopSuccessReportPath(options, projectMetadata) {
  return path.join(
    validationDir,
    `desktop-e2e-success-${sanitizeFailureReportSegment(options.scenario)}-${sanitizeFailureReportSegment(projectMetadata.target)}.json`
  );
}

async function clearDesktopSuccessReport(options, projectMetadata) {
  const targetPath = getDesktopSuccessReportPath(options, projectMetadata);
  if (await pathExists(targetPath)) {
    await rm(targetPath, { force: true });
  }
}

async function recordE2eLedgerSuccess(options, projectMetadata, evidence = {}) {
  const git = await readGitEvidence();
  await ensureValidationDir();
  const successPath = getDesktopSuccessReportPath(options, projectMetadata);
  await writeFile(
    successPath,
    `${JSON.stringify(
      {
        schema: "rds-desktop-e2e-success/v1",
        generated_at: new Date().toISOString(),
        repository: git,
        scenario: options.scenario,
        target: projectMetadata.target || null,
        project_fixture: path.basename(path.resolve(options.project)),
        framebuffer: evidence.framebuffer ?? null,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(`[evidence] Desktop E2E -> ${successPath}`);

  // No CI o workflow desktop-e2e grava marcadores via Add-Content (pwsh).
  // Evita corrida/path divergente quando npm nao herda RDS_E2E_LEDGER no Windows.
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
export function appBinaryNameForPlatform(hostPlatform = process.platform) {
  return hostPlatform === "win32" ? "retro-dev-studio.exe" : "retro-dev-studio";
}

export function webdriverNamesForPlatform(hostPlatform = process.platform) {
  return hostPlatform === "win32"
    ? ["msedgedriver.exe", "msedgedriver"]
    : ["WebKitWebDriver", "msedgedriver", "chromedriver"];
}

function isHostExecutableCandidate(candidate, hostPlatform = process.platform) {
  if (hostPlatform === "win32") {
    return true;
  }
  return path.extname(candidate).toLowerCase() !== ".exe";
}

const defaultDebugAppPath = path.join(
  repoRoot,
  "src-tauri",
  "target-test",
  "debug",
  appBinaryNameForPlatform()
);
const defaultReleaseAppPath = path.join(
  repoRoot,
  "src-tauri",
  "target-test",
  "release",
  appBinaryNameForPlatform()
);
const defaultWebDriverPath = path.join(
  repoRoot,
  "toolchains",
  "webdriver",
  process.platform === "win32" ? "msedgedriver.exe" : "msedgedriver"
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

// O contrato de host tem perfil unico (`full`, 24 requisitos) porque nasceu para
// provisionar a maquina de desenvolvimento inteira. Exigir esse perfil no runner
// E2E tornava o gate tudo-ou-nada: o smoke de Mega Drive passava a exigir Ghidra,
// JDK21 e PVSnesLib, que ele nao usa, e nenhum runner de CI conseguia satisfazer.
// O gate passa a assertar apenas os requisitos que o cenario realmente exercita.
// O relatorio completo continua sendo gravado, entao o diagnostico nao se perde.
// SGDK, PVSnesLib e cores Libretro NAO entram: o app os instala sob demanda no
// Build & Run (bloco D de `docs/10_QA_ROTEIRO_RC.md`) e o proprio E2E existe para
// exercitar esse caminho. Confirmado empiricamente — no runner de CI o preflight
// reporta `SGDK real: FALTA` e o smoke passa assim mesmo, porque a toolchain e
// provisionada durante a execucao. Exigi-los antes transformaria uma primeira
// execucao valida em falha de gate.
//
// Sobra o que precisa existir ANTES de a aplicacao subir: o runtime de build do
// proprio app e a dupla de drivers da sessao WebDriver.
const HOST_REQUIREMENTS_BASE = ["node", "cargo", "rustc", "make"];
const HOST_REQUIREMENTS_DESKTOP = ["tauri_driver", "webdriver"];
const HOST_REQUIREMENTS_BY_TARGET = {
  megadrive: [],
  snes: [],
};

export function hostRequirementsForRun({ target } = {}) {
  const perTarget = HOST_REQUIREMENTS_BY_TARGET[target] ?? [];
  return [...new Set([...HOST_REQUIREMENTS_BASE, ...HOST_REQUIREMENTS_DESKTOP, ...perTarget])];
}

export function scopedHostBlockers(report, requiredIds) {
  const checks = new Map((report?.checks ?? []).map((check) => [check.id, check]));
  return requiredIds
    .map((id) => {
      const check = checks.get(id);
      if (!check) return `${id}:ausente_no_contrato`;
      if (check.status === "ready" || check.status === "not_applicable") return null;
      return `${id}:${check.status}`;
    })
    .filter(Boolean);
}

export function applyManagedHostEnvironment() {
  const { report, context } = diagnoseHost({
    mode: "desktop-e2e",
    env: process.env,
    reportPath: path.join(validationDir, "desktop-e2e-host-readiness.json"),
  });

  // `pathEnv` apenas prefixa os bins gerenciados ao PATH existente, entao aplicar
  // sempre e aditivo e seguro: num host sem cache gerenciado os diretorios nao
  // existem e nada e removido. Os `setDefault` nunca sobrescrevem env ja definido,
  // o que preserva o provisionamento explicito da CI.
  const checks = new Map(report.checks.map((check) => [check.id, check]));
  const readyPath = (id) => {
    const check = checks.get(id);
    return check?.status === "ready" && typeof check.path === "string" ? check.path : "";
  };
  const setDefault = (name, value) => {
    if (!process.env[name] && value) process.env[name] = value;
  };

  // PATH e CARGO_TARGET_DIR so sao redirecionados quando existe cache gerenciado
  // de fato. Num runner de CI, que provisiona por conta propria e ja produziu o
  // binario em outro target dir, redirecionar seria mudanca de comportamento.
  if (existsSync(context.hostCache)) {
    process.env.PATH = context.pathEnv;
    setDefault("CARGO_TARGET_DIR", path.join(context.hostCache, "cargo-target"));
  }
  setDefault("SGDK_ROOT", readyPath("sgdk"));
  setDefault("PVSNESLIB_HOME", readyPath("pvsneslib"));
  setDefault("JAVA_HOME", readyPath("jdk21") ? path.dirname(path.dirname(readyPath("jdk21"))) : "");
  setDefault("RETRODEV_GHIDRA_HOME", readyPath("ghidra") ? path.dirname(path.dirname(readyPath("ghidra"))) : "");
  setDefault("RETRODEV_LIBRETRO_CORE_MEGADRIVE", readyPath("libretro_md"));
  setDefault("RETRODEV_LIBRETRO_CORE_SNES", readyPath("libretro_snes"));
  setDefault("TAURI_DRIVER_PATH", readyPath("tauri_driver"));
  setDefault("RDS_EDGE_DRIVER_PATH", readyPath("webdriver"));
  return report;
}

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
          "reference-platformer",
          "authoring-acceptance",
          "nodegraph-authoring",
          "behaviors-independence",
          "collect-goal",
          "inspection",
          "inspection-cancel",
          "inspection-complete",
          "inspection-sprite-secondary",
          "inspection-sonic",
          "inspection-sonic-tiles",
          "rex-lz4w-effect",
          "inspection-preview-unavailable",
          "logic-recovery",
          "logic-recovery-branch",
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
    if (isHostExecutableCandidate(resolved) && (await pathExists(resolved))) return resolved;
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
        if (isHostExecutableCandidate(candidate) && (await pathExists(candidate))) {
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

/**
 * `abortWhen` permite desistir cedo quando o app ja informou que a condicao
 * esperada nunca vai acontecer. Sem isso, um sinal explicito de falha e
 * ignorado e a espera queima o orcamento inteiro, reportando timeout no lugar
 * da causa real. Deve devolver a razao (string) para abortar, ou algo falsy.
 */
async function waitFor(predicate, timeoutMs, label, intervalMs = 500, abortWhen = null) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    if (abortWhen) {
      // Erro na deteccao de aborto nao pode derrubar a espera: o caminho normal
      // continua ate o timeout, que e o comportamento anterior.
      let abortReason = null;
      try {
        abortReason = await abortWhen();
      } catch {
        abortReason = null;
      }
      if (abortReason) {
        const elapsedMs = Date.now() - startedAt;
        fail(`${label}: abortado apos ${elapsedMs}ms — ${abortReason}`, {
          statusCode: "build_failed",
          errorCategory: "build_failure",
          details: { timeoutMs, elapsedMs, label, abortReason },
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // A mensagem precisa dizer que isto e esgotamento de orcamento, nao um
  // defeito observado. Rotulos como "Emulador nao ficou ativo" ja induziram
  // diagnostico errado: a condicao pode simplesmente nao ter tido tempo.
  const elapsedMs = Date.now() - startedAt;
  const timeoutSuffix =
    ` [timeout: condicao nao foi satisfeita em ${elapsedMs}ms` +
    ` (orcamento ${timeoutMs}ms); isto e esgotamento de tempo, nao um defeito confirmado]`;

  if (lastError instanceof Error) {
    fail(`${label}${timeoutSuffix}: ${lastError.message}`, {
      statusCode: "timeout_wait_condition",
      errorCategory: "timeout",
      details: { timeoutMs, elapsedMs, label },
    });
  }
  fail(`${label}${timeoutSuffix}`, {
    statusCode: "timeout_wait_condition",
    errorCategory: "timeout",
    details: { timeoutMs, elapsedMs, label },
  });
}

/**
 * Detecta que o build ja falhou, olhando o console estruturado do app.
 * Devolve a razao para abortar, ou `null` quando nao ha falha observada.
 *
 * Usa apenas sinais estruturados (`level`/`diagnostic.area`), nao substring de
 * mensagem, para nao abortar por texto incidental de um cenario legitimo.
 */
async function detectBuildFailure(sessionId, sinceIndex = 0) {
  const entries = await executeScript(
    sessionId,
    "return window.__RDS_E2E__?.getState()?.consoleEntries ?? [];"
  );
  if (!Array.isArray(entries)) {
    return null;
  }
  // Ignora o que ja estava no console antes desta execucao: um erro de build
  // anterior no mesmo cenario nao pode abortar a espera atual.
  const failure = entries.slice(sinceIndex).find(
    (entry) =>
      entry?.level === "error" &&
      (entry?.diagnostic?.area === "build_sgdk" || entry?.diagnostic?.area === "build_snes")
  );
  if (!failure) {
    return null;
  }
  const detail = failure.diagnostic?.technical_detail || failure.message || "sem detalhe";
  return `build falhou (${failure.diagnostic.area}): ${detail}`;
}

async function webdriverRequestDetailed(method, route, body) {
  const response = await fetch(`${driverServerUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw_body: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    body: text,
    payload,
  };
}

async function webdriverRequest(method, route, body) {
  const result = await webdriverRequestDetailed(method, route, body);

  if (!result.ok) {
    const details = result.payload?.value?.message ?? result.statusText;
    throw new Error(`${method} ${route} falhou: ${details}`);
  }

  if (result.payload?.value?.error) {
    throw new Error(result.payload.value.message ?? `${method} ${route} retornou erro WebDriver.`);
  }

  return result.payload;
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
  try {
    const response = await webdriverRequest("POST", `/session/${sessionId}/execute/sync`, {
      script,
      args,
    });
    return response.value;
  } catch (error) {
    const snippet = script.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`${error instanceof Error ? error.message : String(error)} [script: ${snippet}]`);
  }
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

async function callLiveValidationStateMatch(sessionId, expectedState, revision) {
  const state = await readAutomationState(sessionId);
  const validationState = state ? { hwValidationState: state.hwValidationState, hwValidatedRevision: state.hwValidatedRevision } : null;
  const result = await callAutomationApi(sessionId, "isLiveValidationStateMatchingRevision", [validationState, expectedState, revision]);
  return { state, result };
}

async function waitForLiveValidationFresh(sessionId, timeoutMs, revision) {
  let lastState = null;
  await waitFor(
    async () => {
      const { state, result } = await callLiveValidationStateMatch(sessionId, "fresh", revision);
      lastState = state;
      if (result.matches) return state;

      const diag = result.reason === "no-state"
        ? "sem_estado"
        : result.reason === "wrong-state"
          ? `estado_incorreto:${result.actual}`
          : result.reason === "wrong-revision"
            ? `wrong-revision:${result.actual}/${result.expected}`
            : "desconhecido";
      console.log(
        `[E2E] Esperando fresh... ${diag} r:${state?.hwValidatedRevision ?? "?"}/${revision ?? "?"} erros:${state?.hwStatus?.errorCount ?? "?"}`
      );
      return false;
    },
    timeoutMs,
    `Validacao live nao ficou fresh apos injetar draft (revisao ${revision ?? "?"}).`,
    250
  ).catch((error) => {
    const diag = lastState
      ? `ultimo estado: hwValidationState=${lastState.hwValidationState} hwValidatedRevision=${lastState.hwValidatedRevision} sceneRevision=${lastState.sceneRevision}`
      : "nenhum estado obtido";
    console.log(`[E2E] DIAG timeout: esperada rev=${revision ?? "?"}. ${diag}`);
    throw error;
  });
}

async function logAutomationState(sessionId, label) {
  try {
    const state = await readAutomationState(sessionId);
    if (!state) {
      console.log(`[E2E] ${label}: estado indisponivel`);
      return;
    }
    console.log(
      `[E2E] ${label}: fresh=${state.hwValidationState} rev=${state.sceneRevision} validatedRev=${state.hwValidatedRevision} errores=${state.hwStatus?.errorCount ?? "?"} warnings=${state.hwStatus?.warningCount ?? "?"}`
    );
  } catch {
    console.log(`[E2E] ${label}: falha ao ler estado`);
  }
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

async function fillInputByLabel(sessionId, labelText, value) {
  const result = await executeScript(
    sessionId,
    `
      const expected = String(arguments[0] ?? '').trim();
      const label = Array.from(document.querySelectorAll('label')).find((candidate) => candidate.textContent?.trim() === expected);
      const input = label?.querySelector('input') ?? label?.parentElement?.querySelector('input');
      if (!(input instanceof HTMLInputElement)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (typeof descriptor?.set !== 'function') return false;
      input.focus();
      descriptor.set.call(input, String(arguments[1] ?? ''));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `,
    [labelText, value]
  );
  if (!result) fail(`Falha ao preencher o campo rotulado: ${labelText}`);
}

async function readInspectionUiState(sessionId) {
  return executeScript(
    sessionId,
    `
      const panel = document.querySelector('[data-testid="reverse-inspection-panel"]');
      const identify = panel?.querySelector('[data-testid="inspection-identify-state"]');
      const session = panel?.querySelector('[data-testid="inspection-session"]');
      const run = panel?.querySelector('[data-testid="inspection-run"]');
      const input = panel?.querySelector('input[type="text"]');
      const image = panel?.querySelector('[data-testid="inspection-preview-image"]');
      return {
        inputValue: input instanceof HTMLInputElement ? input.value : null,
        identify: identify ? {
          state: identify.getAttribute('data-state'),
          inputValue: identify.getAttribute('data-input-value'),
          error: identify.getAttribute('data-error'),
          sessionId: identify.getAttribute('data-session-id'),
          sessionStatus: identify.getAttribute('data-session-status'),
        } : null,
        session: session ? {
          id: session.getAttribute('data-session-id'),
          status: session.getAttribute('data-session-status'),
          identitySha256: session.getAttribute('data-identity-sha256'),
        } : null,
        run: run ? {
          id: run.getAttribute('data-run-id'),
          status: run.getAttribute('data-run-status'),
          generation: run.getAttribute('data-run-generation'),
        } : null,
        preview: image ? {
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          declaredWidth: Number(image.getAttribute('data-preview-width') || 0),
          declaredHeight: Number(image.getAttribute('data-preview-height') || 0),
          pngSha256: image.getAttribute('data-png-sha256'),
          pixelsSha256: image.getAttribute('data-pixels-sha256'),
          artifactSha256: image.getAttribute('data-artifact-sha256'),
          src: image.getAttribute('src'),
        } : null,
        unavailable: Boolean(panel?.querySelector('[data-testid="inspection-preview-unavailable"]')),
      };
    `
  );
}

async function readRenderedPreviewPixels(sessionId) {
  return executeScript(
    sessionId,
    `
      const image = document.querySelector('[data-testid="inspection-preview-image"]');
      if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0);
      return {
        image: true,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        pngSha256: image.getAttribute("data-png-sha256") || "",
        pixelsSha256: image.getAttribute("data-pixels-sha256") || "",
        artifactSha256: image.getAttribute("data-artifact-sha256") || "",
        src: image.currentSrc || image.src,
        pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
      };
    `
  );
}

async function readRenderedSpriteFramePixels(sessionId) {
  return executeScript(
    sessionId,
    `
      const image = document.querySelector('[data-testid="inspection-sprite-frame-image"]');
      if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0);
      return {
        image: true,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        romSha256: image.getAttribute("data-sprite-rom-sha256") || "",
        resourceId: image.getAttribute("data-sprite-resource") || "",
        frameId: image.getAttribute("data-sprite-frame") || "",
        pngSha256: image.getAttribute("data-png-sha256") || "",
        pixelsSha256: image.getAttribute("data-pixels-sha256") || "",
        src: image.currentSrc || image.src,
        pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
      };
    `
  );
}

async function ensureSpriteFrameVisibleAndUnobstructed(sessionId) {
  return executeScript(
    sessionId,
    `
      const image = document.querySelector('[data-testid="inspection-sprite-frame-image"]');
      const stage = document.querySelector('[data-testid="inspection-sprite-frame-stage"]');
      const metadata = document.querySelector('[data-testid="inspection-sprite-frame-metadata"]');
      if (!(image instanceof HTMLImageElement) || !(stage instanceof HTMLElement) || !(metadata instanceof HTMLElement) || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
      image.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = image.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const metadataRect = metadata.getBoundingClientRect();
      const style = window.getComputedStyle(image);
      const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
      const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
      const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
      const contentWidth = rect.width - borderLeft - borderRight;
      const contentHeight = rect.height - borderTop - borderBottom;
      const cssWidth = Number.parseFloat(style.width) || 0;
      const cssHeight = Number.parseFloat(style.height) || 0;
      const fullyVisible = rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const top = fullyVisible ? document.elementFromPoint(x, y) : null;
      const topWithTestId = top instanceof Element ? top.closest('[data-testid]') : null;
      const unobstructed = Boolean(top && (top === image || image.contains(top)));
      const expectedWidth = image.naturalWidth * 3;
      const expectedHeight = image.naturalHeight * 3;
      const exactContentDimensions = Math.abs(contentWidth - expectedWidth) < 0.01 && Math.abs(contentHeight - expectedHeight) < 0.01;
      const integerScale = Math.abs(contentWidth / image.naturalWidth - 3) < 0.01 && Math.abs(contentHeight / image.naturalHeight - 3) < 0.01;
      const metadataBelow = metadataRect.top >= rect.bottom - 0.01;
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        content: { width: contentWidth, height: contentHeight },
        css: { width: cssWidth, height: cssHeight, boxSizing: style.boxSizing, imageRendering: style.imageRendering },
        borders: { left: borderLeft, right: borderRight, top: borderTop, bottom: borderBottom },
        stageRect: { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height },
        metadataRect: { x: metadataRect.x, y: metadataRect.y, width: metadataRect.width, height: metadataRect.height },
        naturalSize: { width: image.naturalWidth, height: image.naturalHeight },
        fullyVisible,
        unobstructed,
        exactContentDimensions,
        integerScale,
        pixelated: style.imageRendering === 'pixelated',
        metadataBelow,
        point: { x, y },
        topTag: top?.tagName ?? '',
        topTestId: topWithTestId?.getAttribute('data-testid') ?? '',
        stageOverflowX: window.getComputedStyle(stage).overflowX,
      };
    `
  );
}

function renderExpectedSpriteFrame(romBytes, options = {}) {
  const frameId = options.frameId ?? "spr_ryo_100/frame-0";
  const manifests = {
    "spr_ryo_100/frame-0": {
      tileDataOffset: 0x863a0,
      descriptorOffset: 0x22260,
      tileCount: 64,
      descriptors: [
        [0x2c, 0x1c, 0x0f, 0x05, 0x1b, 0x10], [0x0c, 0x3c, 0x0f, 0x04, 0x1c, 0x10],
        [0x37, 0x11, 0x07, 0x25, 0x0b, 0x08], [0x14, 0x3c, 0x06, 0x24, 0x0c, 0x06],
        [0x4c, 0x0c, 0x09, 0x05, 0x23, 0x06], [0x57, 0x01, 0x09, 0x25, 0x03, 0x06],
        [0x58, 0x00, 0x05, 0x00, 0x30, 0x04], [0x04, 0x5c, 0x04, 0x15, 0x1b, 0x02],
      ],
    },
    "spr_ryo_100/frame-1": {
      tileDataOffset: 0x86ba0,
      descriptorOffset: 0x222a2,
      tileCount: 66,
      descriptors: [
        [0x11, 0x37, 0x0f, 0x07, 0x19, 0x10], [0x31, 0x1f, 0x0e, 0x08, 0x18, 0x0c],
        [0x37, 0x11, 0x07, 0x24, 0x0c, 0x08], [0x11, 0x3f, 0x06, 0x27, 0x09, 0x06],
        [0x49, 0x0f, 0x09, 0x05, 0x23, 0x06], [0x57, 0x01, 0x09, 0x24, 0x04, 0x06],
        [0x58, 0x00, 0x09, 0x00, 0x28, 0x06], [0x04, 0x54, 0x09, 0x0c, 0x1c, 0x06],
      ],
    },
    "spr_ryo_100/frame-2": {
      tileDataOffset: 0x873e0,
      descriptorOffset: 0x222e4,
      tileCount: 74,
      descriptors: [
        [0x0b, 0x3d, 0x0f, 0x01, 0x1f, 0x10], [0x2b, 0x1d, 0x0f, 0x08, 0x18, 0x10],
        [0x0b, 0x3d, 0x0b, 0x21, 0x07, 0x0c], [0x48, 0x00, 0x0b, 0x00, 0x28, 0x0c],
        [0x48, 0x00, 0x0b, 0x24, 0x04, 0x0c], [0x38, 0x20, 0x05, 0x28, 0x08, 0x04],
        [0x03, 0x5d, 0x04, 0x15, 0x1b, 0x02],
      ],
    },
    "spr_ryo_100/frame-3": {
      tileDataOffset: 0x87d20,
      descriptorOffset: 0x22320,
      tileCount: 74,
      descriptors: [
        [0x0a, 0x3e, 0x0f, 0x04, 0x1c, 0x10], [0x2a, 0x1e, 0x0f, 0x08, 0x18, 0x10],
        [0x0a, 0x3e, 0x0b, 0x24, 0x04, 0x0c], [0x48, 0x00, 0x0b, 0x00, 0x28, 0x0c],
        [0x48, 0x00, 0x0b, 0x24, 0x04, 0x0c], [0x38, 0x20, 0x05, 0x28, 0x08, 0x04],
        [0x02, 0x5e, 0x04, 0x15, 0x1b, 0x02],
      ],
    },
    "spr_ryo_100/frame-4": {
      tileDataOffset: 0x873e0,
      descriptorOffset: 0x222e4,
      tileCount: 74,
      descriptors: [
        [0x0b, 0x3d, 0x0f, 0x01, 0x1f, 0x10], [0x2b, 0x1d, 0x0f, 0x08, 0x18, 0x10],
        [0x0b, 0x3d, 0x0b, 0x21, 0x07, 0x0c], [0x48, 0x00, 0x0b, 0x00, 0x28, 0x0c],
        [0x48, 0x00, 0x0b, 0x24, 0x04, 0x0c], [0x38, 0x20, 0x05, 0x28, 0x08, 0x04],
        [0x03, 0x5d, 0x04, 0x15, 0x1b, 0x02],
      ],
    },
    "spr_spark0/frame-0": {
      tileDataOffset: 0x80060,
      descriptorOffset: 0x22f94,
      tileCount: 9,
      paletteOffset: 0x2e134,
      width: 24,
      height: 24,
      descriptors: [[0x00, 0x00, 0x0a, 0x00, 0x00, 0x09]],
    },
  };
  const manifest = manifests[frameId];
  if (!manifest) fail(`Manifesto independente ausente para ${frameId}`);
  const tileDataOffset = manifest.tileDataOffset;
  const paletteOffset = manifest.paletteOffset ?? 0x2cc68;
  const width = manifest.width ?? 64;
  const height = manifest.height ?? 104;
  const descriptors = manifest.descriptors;
  const descriptorBytes = Buffer.from(descriptors.flat());
  if (!descriptorBytes.equals(romBytes.subarray(manifest.descriptorOffset, manifest.descriptorOffset + descriptorBytes.length))) {
    fail(`Descritores independentes de ${frameId} divergiram da ROM de referência.`);
  }
  const pixels = Buffer.alloc(width * height * 4);
  const tileOrdering = options.tileOrdering ?? "vertical";
  const paletteDelta = options.paletteDelta ?? 0;
  const flipX = Boolean(options.flipX);
  const flipY = Boolean(options.flipY);
  let tileStart = 0;
  const color = (index) => {
    const wordOffset = paletteOffset + index * 2;
    let word = romBytes.readUInt16BE(wordOffset);
    if (index === 1) word ^= paletteDelta;
    return [((word >> 1) & 7) * 36, ((word >> 5) & 7) * 36, ((word >> 9) & 7) * 36, index === 0 ? 0 : 255];
  };
  const put = (x, y, index) => {
    const pixel = (y * width + x) * 4;
    const rgba = index === 0 && options.transparentRgb === "canvas" ? [0, 0, 0, 0] : color(index);
    pixels[pixel] = rgba[0];
    pixels[pixel + 1] = rgba[1];
    pixels[pixel + 2] = rgba[2];
    pixels[pixel + 3] = rgba[3];
  };
  const transparent = options.transparentRgb === "canvas" ? [0, 0, 0, 0] : color(0);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    pixels[offset] = transparent[0];
    pixels[offset + 1] = transparent[1];
    pixels[offset + 2] = transparent[2];
    pixels[offset + 3] = transparent[3];
  }
  for (const [offsetY, offsetYFlip, size, offsetX, offsetXFlip, tileCount] of descriptors) {
    const tileWidth = (size >> 2) + 1;
    const tileHeight = (size & 3) + 1;
    if (tileCount !== tileWidth * tileHeight) fail(`Descritor com tileCount inconsistente: ${JSON.stringify({ size, tileCount })}`);
    for (let localX = 0; localX < tileWidth; localX += 1) {
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceX = flipX ? tileWidth - 1 - localX : localX;
        const sourceY = flipY ? tileHeight - 1 - localY : localY;
        const tileInPart = tileOrdering === "vertical"
          ? sourceX * tileHeight + sourceY
          : sourceY * tileWidth + sourceX;
        const tileIndex = tileStart + tileInPart;
        const destX = (flipX ? offsetXFlip : offsetX) + localX * 8;
        const destY = (flipY ? offsetYFlip : offsetY) + localY * 8;
        for (let pixelY = 0; pixelY < 8; pixelY += 1) {
          for (let pixelX = 0; pixelX < 8; pixelX += 1) {
            const sourcePixelX = flipX ? 7 - pixelX : pixelX;
            const sourcePixelY = flipY ? 7 - pixelY : pixelY;
            const packedByte = romBytes[tileDataOffset + tileIndex * 32 + sourcePixelY * 4 + Math.floor(sourcePixelX / 2)];
            const index = sourcePixelX % 2 === 0 ? packedByte >> 4 : packedByte & 0x0f;
            put(destX + pixelX, destY + pixelY, index);
          }
        }
      }
    }
    tileStart += tileCount;
  }
  if (tileStart !== manifest.tileCount) fail(`Oráculo independente esperava ${manifest.tileCount} tiles e obteve ${tileStart}`);
  return { width, height, pixels, frameId };
}

function renderExpectedSonicStand(romBytes, options = {}) {
  const mapping = Buffer.from([
    0x04, 0xec, 0x08, 0x00, 0x00,
    0xf0, 0xf4, 0x0d, 0x00, 0x03,
    0xf0, 0x04, 0x08, 0x00, 0x0b,
    0xf0, 0x0c, 0x08, 0x00, 0x0e, 0xf8,
  ]);
  const tileDataOffset = 0x21afe;
  const tileDataSize = 0xa120;
  const paletteOffset = 0x2388;
  const descriptorOffset = 0x21293;
  const width = 32;
  const height = 40;
  if (!mapping.equals(romBytes.subarray(descriptorOffset, descriptorOffset + mapping.length))) {
    fail("Mapping Sonic stand independente divergiu da ROM.");
  }
  if (romBytes.length < tileDataOffset + tileDataSize || romBytes.length < paletteOffset + 0x20) {
    fail("ROM Sonic independente não contém os intervalos do frame stand.");
  }
  const pixels = Buffer.alloc(width * height * 4);
  const paletteIndices = Buffer.alloc(width * height);
  const palette = (index) => {
    let word = romBytes.readUInt16BE(paletteOffset + index * 2);
    if (index === 1 && Number.isInteger(options.paletteDelta)) word ^= options.paletteDelta;
    return [((word >> 1) & 7) * 36, ((word >> 5) & 7) * 36, ((word >> 9) & 7) * 36, index === 0 ? 0 : 255];
  };
  for (let offset = 0; offset < pixels.length; offset += 4) pixels[offset + 3] = 0;
  let mappingOffset = 1;
  const originX = 16;
  const originY = 20;
  const tileStartByPart = [];
  for (let partIndex = 0; partIndex < mapping[0]; partIndex += 1) {
    const y = mapping[mappingOffset];
    const size = mapping[mappingOffset + 1];
    const tileStart = mapping.readUInt16BE(mappingOffset + 2);
    const x = mapping[mappingOffset + 4] << 24 >> 24;
    const tileWidth = ((size >> 2) & 3) + 1;
    const tileHeight = (size & 3) + 1;
    tileStartByPart.push({ tileStart, tileWidth, tileHeight, x, y: y << 24 >> 24 });
    mappingOffset += 5;
  }
  for (const part of tileStartByPart) {
    for (let localY = 0; localY < part.tileHeight; localY += 1) {
      for (let localX = 0; localX < part.tileWidth; localX += 1) {
        const tileIndex = part.tileStart + (options.tileOrder === "vertical"
          ? localX * part.tileHeight + localY
          : localY * part.tileWidth + localX);
        for (let pixelY = 0; pixelY < 8; pixelY += 1) {
          for (let pixelX = 0; pixelX < 8; pixelX += 1) {
            const packed = romBytes[tileDataOffset + tileIndex * 32 + pixelY * 4 + Math.floor(pixelX / 2)];
            const paletteIndex = pixelX % 2 === 0 ? packed >> 4 : packed & 0x0f;
            const sourceX = originX + part.x + localX * 8 + pixelX;
            const sourceY = originY + part.y + localY * 8 + pixelY;
            const destX = options.flipX ? width - 1 - sourceX : sourceX;
            const destY = options.flipY ? height - 1 - sourceY : sourceY;
            if (destX < 0 || destY < 0 || destX >= width || destY >= height) {
              fail(`Mapping Sonic fora do canvas: ${destX},${destY} part=${JSON.stringify(part)} local=${localX},${localY} pixel=${pixelX},${pixelY} options=${JSON.stringify(options)}`);
            }
            const offset = (destY * width + destX) * 4;
            const rgba = palette(paletteIndex);
            paletteIndices[destY * width + destX] = paletteIndex;
            pixels.set(rgba, offset);
          }
        }
      }
    }
  }
  return { width, height, pixels, paletteIndices, frameId: "sonic1_sonic/stand", tileDataOffset, tileDataSize, paletteOffset, descriptorOffset };
}

const MD_CHANNEL_LEVELS = [0, 33, 66, 99, 140, 173, 206, 239];

function quantizeMdChannel(value) {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < MD_CHANNEL_LEVELS.length; index += 1) {
    const nextDistance = Math.abs(value - MD_CHANNEL_LEVELS[index]);
    if (nextDistance < distance) {
      distance = nextDistance;
      best = index;
    }
  }
  return best;
}

function sonicPaletteCodes(romBytes) {
  const paletteCodes = [];
  for (let index = 0; index < 16; index += 1) {
    const word = romBytes.readUInt16BE(0x2388 + index * 2);
    paletteCodes.push({
      r: (word >> 1) & 7,
      g: (word >> 5) & 7,
      b: (word >> 9) & 7,
    });
  }
  return paletteCodes;
}

/**
 * Localiza Sonic pela aparência do frame independente, não por uma cor ou
 * região fixa. O template vem do mapping/tile bytes/paleta da ROM já
 * verificados; o framebuffer é quantizado para os níveis MD e comparado por
 * índice de paleta. Assim o HUD magenta, mesmo na mesma região, não pode ser
 * aceito como Sonic.
 */
function locateSonicInFramebuffer(frame, romBytes, options = {}) {
  const template = renderExpectedSonicStand(romBytes, { flipX: options.flipX === true });
  const { width, height, paletteIndices } = template;
  const rgba = frame?.rgba;
  if (!rgba || rgba.length !== frame.width * frame.height * 4) return null;
  const paletteCodes = sonicPaletteCodes(romBytes);
  const previous = options.previous ?? null;
  const minX = Math.max(0, Math.floor(previous?.x ?? 0) - (previous ? 24 : frame.width));
  const maxX = Math.min(frame.width - width, Math.ceil(previous?.x ?? (frame.width - width)) + (previous ? 24 : 0));
  const minY = Math.max(0, Math.floor(previous?.y ?? 0) - (previous ? 32 : frame.height));
  const maxY = Math.min(frame.height - height, Math.ceil(previous?.y ?? (frame.height - height)) + (previous ? 32 : 0));
  const candidates = [];
  let opaquePixels = 0;
  for (const index of paletteIndices) if (index !== 0) opaquePixels += 1;
  const allowedPaletteCodes = sonicPaletteCodes(romBytes).slice(1).map((code) => `${code.r}:${code.g}:${code.b}`);
  const allowedPaletteCodeSet = new Set(allowedPaletteCodes);
  const scoreCandidate = (originX, originY) => {
    let matchedPixels = 0;
    let nearPixels = 0;
    let paletteMatchedPixels = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const paletteIndex = paletteIndices[y * width + x];
        if (paletteIndex === 0) continue;
        const offset = ((originY + y) * frame.width + originX + x) * 4;
        const expected = paletteCodes[paletteIndex];
        const actualR = quantizeMdChannel(rgba[offset]);
        const actualG = quantizeMdChannel(rgba[offset + 1]);
        const actualB = quantizeMdChannel(rgba[offset + 2]);
        const distance = Math.abs(actualR - expected.r) + Math.abs(actualG - expected.g) + Math.abs(actualB - expected.b);
        if (distance === 0) matchedPixels += 1;
        if (distance <= 1) nearPixels += 1;
        if (allowedPaletteCodeSet.has(`${actualR}:${actualG}:${actualB}`)) paletteMatchedPixels += 1;
      }
    }
    return { originX, originY, matchedPixels, nearPixels, paletteMatchedPixels, score: nearPixels / opaquePixels, paletteScore: paletteMatchedPixels / opaquePixels };
  };
  const originStep = previous ? 1 : 8;
  for (let originY = minY; originY <= maxY; originY += originStep) {
    for (let originX = minX; originX <= maxX; originX += originStep) {
      candidates.push(scoreCandidate(originX, originY));
    }
  }
  if (!previous && originStep > 1) {
    const refinementOrigins = new Set();
    const remember = (candidate) => {
      for (let y = Math.max(minY, candidate.originY - originStep + 1); y <= Math.min(maxY, candidate.originY + originStep - 1); y += 1) {
        for (let x = Math.max(minX, candidate.originX - originStep + 1); x <= Math.min(maxX, candidate.originX + originStep - 1); x += 1) {
          refinementOrigins.add(`${x},${y}`);
        }
      }
    };
    [...candidates].sort((a, b) => b.score - a.score || b.matchedPixels - a.matchedPixels).slice(0, 12).forEach(remember);
    [...candidates].sort((a, b) => b.paletteScore - a.paletteScore || b.paletteMatchedPixels - a.paletteMatchedPixels).slice(0, 12).forEach(remember);
    for (const origin of refinementOrigins) {
      const [originX, originY] = origin.split(",").map(Number);
      candidates.push(scoreCandidate(originX, originY));
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.matchedPixels - a.matchedPixels);
  let best = candidates[0];
  let matchMode = "template";
  if (!best || best.score < 0.12) {
    candidates.sort((a, b) => b.paletteScore - a.paletteScore || b.paletteMatchedPixels - a.paletteMatchedPixels);
    best = candidates[0];
    matchMode = "palette-component";
    if (!best || best.paletteScore < 0.22) return null;
    best = { ...best, score: best.paletteScore, matchedPixels: best.paletteMatchedPixels, nearPixels: best.paletteMatchedPixels };
  }
  let minOpaqueX = width;
  let minOpaqueY = height;
  let maxOpaqueX = -1;
  let maxOpaqueY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (paletteIndices[y * width + x] === 0) continue;
      minOpaqueX = Math.min(minOpaqueX, x);
      minOpaqueY = Math.min(minOpaqueY, y);
      maxOpaqueX = Math.max(maxOpaqueX, x);
      maxOpaqueY = Math.max(maxOpaqueY, y);
    }
  }
  return {
    x: best.originX,
    y: best.originY,
    width,
    height,
    bounds: { x0: best.originX + minOpaqueX, y0: best.originY + minOpaqueY, x1: best.originX + maxOpaqueX, y1: best.originY + maxOpaqueY },
    center: { x: best.originX + (minOpaqueX + maxOpaqueX) / 2, y: best.originY + (minOpaqueY + maxOpaqueY) / 2 },
    score: best.score,
    matchedPixels: best.matchedPixels,
    nearPixels: best.nearPixels,
    opaquePixels,
    matchMode,
    flipX: options.flipX === true,
    reference: { frameId: "sonic1_sonic/stand", descriptorOffset: template.descriptorOffset, tileDataOffset: template.tileDataOffset, paletteOffset: template.paletteOffset },
  };
}

function locateSonicPaletteComponent(frame, romBytes, options = {}) {
  const previous = options.previous ?? null;
  const rgba = frame?.rgba;
  if (!previous || !rgba || rgba.length !== frame.width * frame.height * 4) return null;
  const paletteCodeSet = new Set(sonicPaletteCodes(romBytes).slice(1).map((code) => `${code.r}:${code.g}:${code.b}`));
  const minX = Math.max(0, Math.floor(previous.bounds.x0) - 56);
  const maxX = Math.min(frame.width - 1, Math.ceil(previous.bounds.x1) + 56);
  const minY = Math.max(0, Math.floor(previous.bounds.y0) - 72);
  const maxY = Math.min(frame.height - 1, Math.ceil(previous.bounds.y1) + 140);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const mask = new Uint8Array(width * height);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const offset = (y * frame.width + x) * 4;
      const code = `${quantizeMdChannel(rgba[offset])}:${quantizeMdChannel(rgba[offset + 1])}:${quantizeMdChannel(rgba[offset + 2])}`;
      if (paletteCodeSet.has(code)) mask[(y - minY) * width + (x - minX)] = 1;
    }
  }
  const visited = new Uint8Array(mask.length);
  const components = [];
  const queue = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;
      visited[start] = 1;
      queue.length = 0;
      queue.push(start);
      let count = 0;
      let minComponentX = x;
      let maxComponentX = x;
      let minComponentY = y;
      let maxComponentY = y;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const index = queue[cursor];
        const cy = Math.floor(index / width);
        const cx = index - cy * width;
        count += 1;
        minComponentX = Math.min(minComponentX, cx);
        maxComponentX = Math.max(maxComponentX, cx);
        minComponentY = Math.min(minComponentY, cy);
        maxComponentY = Math.max(maxComponentY, cy);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const next = ny * width + nx;
            if (!mask[next] || visited[next]) continue;
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
      const bounds = {
        x0: minX + minComponentX,
        y0: minY + minComponentY,
        x1: minX + maxComponentX,
        y1: minY + maxComponentY,
      };
      const componentWidth = bounds.x1 - bounds.x0 + 1;
      const componentHeight = bounds.y1 - bounds.y0 + 1;
      const center = { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 };
      const previousCenter = previous.center ?? { x: (previous.bounds.x0 + previous.bounds.x1) / 2, y: (previous.bounds.y0 + previous.bounds.y1) / 2 };
      const distance = Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y);
      if (count >= 24 && componentWidth >= 6 && componentWidth <= 56 && componentHeight >= 8 && componentHeight <= 64 && distance <= 150) {
        components.push({ bounds, center, count, componentWidth, componentHeight, distance });
      }
    }
  }
  components.sort((a, b) => b.count - a.count || a.distance - b.distance);
  const best = components[0];
  if (!best) return null;
  return {
    x: best.bounds.x0,
    y: best.bounds.y0,
    width: best.componentWidth,
    height: best.componentHeight,
    bounds: best.bounds,
    center: best.center,
    score: best.count / Math.max(1, previous.opaquePixels ?? best.count),
    matchedPixels: best.count,
    nearPixels: best.count,
    opaquePixels: previous.opaquePixels ?? best.count,
    matchMode: "palette-connected-component",
    flipX: false,
    reference: { frameId: "sonic1_sonic/component", paletteOffset: 0x2388, previous: { x: previous.x, y: previous.y, bounds: previous.bounds } },
  };
}

function locateSonicVisual(frame, romBytes, options = {}) {
  const direct = locateSonicInFramebuffer(frame, romBytes, options);
  const flipped = locateSonicInFramebuffer(frame, romBytes, { ...options, flipX: true });
  const component = locateSonicPaletteComponent(frame, romBytes, options);
  if (options.previous && component) return component;
  if (direct && direct.score >= 0.12) return direct;
  return [direct, flipped, component].filter(Boolean).sort((a, b) => b.score - a.score || b.matchedPixels - a.matchedPixels)[0] ?? null;
}

function assertSonicStandOracles(romBytes, actual, context) {
  const expected = renderExpectedSonicStand(romBytes);
  const independentPng = renderExpectedSonicStand(romBytes);
  const independent = assertExactPreviewPixels(
    { width: actual.naturalWidth, height: actual.naturalHeight, pixels: actual.pixels },
    expected,
    context
  );
  const independentPngPixelsSha256 = createHash("sha256").update(independentPng.pixels).digest("hex");
  const romSha256 = createHash("sha256").update(romBytes).digest("hex");
  const expectedPixelsByRomSha256 = {
    // Golden literal independente da ROM BYOR sem edição.
    c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb:
      "ce95ea66f2cfcec40a0fb12cb35fe5e88530de036de9f897333ce762f06b40d4",
    // Mutação determinística exercitada pela UI: palette[1] = RGB333(7,0,7).
    d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d:
      "91ee4ab0c08987597918a4951020cac81c6d3903b415c32d0c1dd8d783850588",
    // Mutação de tiles exercitada pela UI: retângulo (10,14) 12x8 do stand -> índice 14.
    "5e44f9d2581735350f53d5ff1904ccc2e64b4655362a673fe6066d61137b8cb3":
      "c41fcd503ae7fcd81b4aab308ab399d3415cc82ac089c299a8122daf74d478b2",
  };
  const expectedPixelsSha256 = expectedPixelsByRomSha256[romSha256];
  console.log(`[inspection-sonic-oracle] ${JSON.stringify({ context, romSha256, romLength: romBytes.length, mappingSha256: createHash("sha256").update(romBytes.subarray(0x21293, 0x21293 + 21)).digest("hex"), independentPngPixelsSha256 })}`);
  if (!expectedPixelsSha256 || independentPngPixelsSha256 !== expectedPixelsSha256) {
    fail(`Oráculo Sonic stand não corresponde ao golden literal da ROM exercitada: ${JSON.stringify({ romSha256, independentPngPixelsSha256, expectedPixelsSha256 })}`);
  }
  for (const [label, variant] of [
    ["ordem de tiles row-major -> vertical", { tileOrder: "vertical" }],
    ["paleta alterada", { paletteDelta: 0x0200 }],
    ["flip horizontal", { flipX: true }],
  ]) {
    let rejected = false;
    let candidate = expected;
    if (variant.tileOrder === "vertical") {
      candidate = renderExpectedSonicStand(romBytes, variant);
    } else if (variant.paletteDelta) {
      candidate = renderExpectedSonicStand(romBytes, variant);
    } else if (variant.flipX) {
      candidate = renderExpectedSonicStand(romBytes, variant);
    }
    try {
      assertExactPreviewPixels(candidate, expected, `${context}: negativo ${label}`);
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`Negativo Sonic não foi detectado: ${label}`);
  }
  return {
    ...independent,
    independentPngPixelsSha256,
    expectedPixelsSha256,
    expectedIndexSha256: null,
    expectedRgbaSha256: expectedPixelsSha256,
    offsets: { tileData: [expected.tileDataOffset, expected.tileDataSize], palette: [expected.paletteOffset, 0x20], descriptor: [expected.descriptorOffset, 21] },
  };
}

function assertSpriteFrameOracles(romBytes, actual, context) {
  if (actual.frameId === "sonic1_sonic/stand") {
    return assertSonicStandOracles(romBytes, actual, context);
  }
  const expected = renderExpectedSpriteFrame(romBytes, { frameId: actual.frameId, transparentRgb: "canvas" });
  const independentPng = renderExpectedSpriteFrame(romBytes, { frameId: actual.frameId });
  const independent = assertExactPreviewPixels(
    { width: actual.naturalWidth, height: actual.naturalHeight, pixels: actual.pixels },
    expected,
    context
  );
  const independentPngSha256 = createHash("sha256").update(independentPng.pixels).digest("hex");
  const expectedIndexSha256 = {
    "spr_ryo_100/frame-0": "938611103b7d79af7e599fe024fa4adef53a8de898d9a06e00d9da15e451196c",
    "spr_ryo_100/frame-1": "77b3b0dba715b352c3ace058abefa5d5d1918d2393dc2064b60a9ed01e0e1903",
    "spr_ryo_100/frame-2": "ef5072905140185e6353b372bc523ec28f71576204424892c30dd20ea3ee3be7",
    "spr_ryo_100/frame-3": "c8917da4d036451d5090a905e2ddc34f68170cf958e1c2c8a8c16f5c987a4379",
    "spr_ryo_100/frame-4": "ef5072905140185e6353b372bc523ec28f71576204424892c30dd20ea3ee3be7",
    "spr_spark0/frame-0": "b474d8c417767ce822d0babf51bea71d342caf51d78d321867596a992784012b",
  }[actual.frameId];
  const expectedRgbaSha256 = {
    "spr_ryo_100/frame-0": "50cba0a2432bb73bcfc5a9c2b0e42668935df3a4c7c2b8e8a0f0e88c3bf46c58",
    "spr_ryo_100/frame-1": "15dab9d16df147cc1bb81348fbc0d0a7e65458b34d3d77541df536024af768d0",
    "spr_ryo_100/frame-2": "63d238fcb0f2b7f6f3283d64ab6987be4f78b209f3d5aca11e2e2f2ea6003871",
    "spr_ryo_100/frame-3": "af33e3e00eff92da8c2582f42b1ef5719b97506384ef1c0874e6fe6525ac53ee",
    "spr_ryo_100/frame-4": "63d238fcb0f2b7f6f3283d64ab6987be4f78b209f3d5aca11e2e2f2ea6003871",
    "spr_spark0/frame-0": "55045927d4b5bd9238a69a49264f625456abe51144ba9b14ee949ed8716223b3",
  }[actual.frameId];
  const expectedCanvasSha256 = {
    "spr_ryo_100/frame-0": "c70a3dfcb4726662c8f8588f6c5ab576f9b64ff7f37198fc72dcae151fde22dc",
    "spr_ryo_100/frame-1": "c63a0fd26c561806f5319fb24380983db10b99998048c678f81d2bf45c7fbde0",
    "spr_ryo_100/frame-2": "b09f31cd84b5b4b684ab0ef0b5e0fa185e33c0de6ac4ad4d468b9423d77a2a08",
    "spr_ryo_100/frame-3": "dedd3c0838040bdf12868c7d6a6b93130247efd8b849244348149af95a8c1137",
    "spr_ryo_100/frame-4": "b09f31cd84b5b4b684ab0ef0b5e0fa185e33c0de6ac4ad4d468b9423d77a2a08",
    "spr_spark0/frame-0": "601829b5a8ab8853fdc1d9047f95ecdfcc6e0f91f73a88ae226ad55c3e70679f",
  }[actual.frameId];
  if (expectedRgbaSha256 !== independentPngSha256 || expectedCanvasSha256 !== independent.pixelsSha256) {
    fail(`Oráculos RGBA independente/canvas não batem com as referências: ${JSON.stringify({ expectedRgbaSha256, independentPngSha256, expectedCanvasSha256, actualCanvas: independent.pixelsSha256, expectedIndexSha256 })}`);
  }
  for (const [label, variant] of [
    ["ordem vertical -> row-major", { tileOrdering: "row-major" }],
    ["paleta alterada", { paletteDelta: 0x0200 }],
    ["flip horizontal", { flipX: true }],
  ]) {
    let rejected = false;
    try {
      assertExactPreviewPixels(
        { width: actual.naturalWidth, height: actual.naturalHeight, pixels: renderExpectedSpriteFrame(romBytes, { ...variant, transparentRgb: "canvas" }).pixels },
        expected,
        `${context}: negativo ${label}`
      );
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`Negativo do frame composto não foi detectado: ${label}`);
  }
  return { ...independent, expectedIndexSha256, expectedRgbaSha256, independentPngPixelsSha256: independentPngSha256, expectedCanvasSha256 };
}

async function verifyRenderedSpriteFrame(sessionId, romBytes, frameId, context) {
  const romSha256 = createHash("sha256").update(romBytes).digest("hex");
  let visualEvidence;
  try {
    visualEvidence = await waitFor(
      async () => readRenderedSpriteFramePixels(sessionId),
      15000,
      `Frame composto ${frameId} não carregou imagem, dimensões ou pixels`,
      100
    );
  } catch (error) {
    const uiState = await readInspectionUiState(sessionId);
    const automation = await readAutomationState(sessionId);
    const composeButton = await inspectNativeButtonTarget(sessionId, "inspection-compose-sprite");
    console.log(`[inspection-sprite-frame-failure] ${JSON.stringify({ context, frameId, uiState, composeButton, inspectionLogs: automation?.consoleEntries?.filter((entry) => String(entry?.message ?? "").includes("[Inspeção]")) ?? [] })}`);
    throw error;
  }
  const expectedResourceId = frameId.split("/", 1)[0];
  if (!visualEvidence?.image || visualEvidence.resourceId !== expectedResourceId || visualEvidence.frameId !== frameId || visualEvidence.romSha256 !== romSha256) {
    fail(`Identidade do frame composto divergente (${context}): ${JSON.stringify({ expected: { resourceId: expectedResourceId, frameId, romSha256 }, actual: visualEvidence })}`);
  }
  const independentEvidence = assertSpriteFrameOracles(romBytes, visualEvidence, `${context}: ${frameId}`);
  const pngPayload = String(visualEvidence.src).match(/^data:image\/png;base64,(.+)$/)?.[1];
  if (!pngPayload) fail(`Frame composto ${frameId} não expôs uma fonte PNG data: válida.`);
  const actualPngSha256 = createHash("sha256").update(Buffer.from(pngPayload, "base64")).digest("hex");
  if (actualPngSha256 !== visualEvidence.pngSha256 || visualEvidence.pixelsSha256 !== independentEvidence.independentPngPixelsSha256 || actualPngSha256 === visualEvidence.pixelsSha256) {
    fail(`Hashes PNG/RGBA do frame ${frameId} não estão separados ou não batem com o oráculo: ${JSON.stringify({ pngSha256: actualPngSha256, pixelsSha256: visualEvidence.pixelsSha256, expectedPngPixelsSha256: independentEvidence.independentPngPixelsSha256 })}`);
  }
  const layout = await waitFor(
    async () => {
      const next = await ensureSpriteFrameVisibleAndUnobstructed(sessionId);
      return next?.fullyVisible && next.unobstructed && next.exactContentDimensions && next.integerScale && next.pixelated && next.metadataBelow ? next : false;
    },
    15000,
    `Frame composto ${frameId} encolheu, perdeu a escala inteira 3×, ficou obstruído ou sobrepôs os metadados`,
    100
  );
  return { visualEvidence, independentEvidence, actualPngSha256, layout };
}

function renderExpectedTilePreview(romBytes, offset, size) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size <= 0 || offset + size > romBytes.length) {
    fail(`Especificação independente de candidato inválida: offset=${offset} size=${size} ROM=${romBytes.length}`);
  }
  const tileCount = Math.min(Math.floor(size / 32), 32);
  if (tileCount < 1) fail(`Candidato conhecido não contém um tile completo: size=${size}`);
  const width = 16 * 8 * 2;
  const height = Math.ceil(tileCount / 16) * 8 * 2;
  const pixels = Buffer.alloc(width * height * 4);
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const base = offset + tileIndex * 32;
    const column = tileIndex % 16;
    const row = Math.floor(tileIndex / 16);
    for (let pixelY = 0; pixelY < 8; pixelY += 1) {
      for (let pixelX = 0; pixelX < 8; pixelX += 1) {
        // Mega Drive/SGDK chunky 4bpp: each byte stores two pixels;
        // high nibble is the left pixel, low nibble the right pixel.
        const packedByte = romBytes[base + pixelY * 4 + Math.floor(pixelX / 2)];
        const value = pixelX % 2 === 0 ? packedByte >> 4 : packedByte & 0x0f;
        const shade = value * 17;
        for (let scaleY = 0; scaleY < 2; scaleY += 1) {
          for (let scaleX = 0; scaleX < 2; scaleX += 1) {
            const x = column * 16 + pixelX * 2 + scaleX;
            const y = row * 16 + pixelY * 2 + scaleY;
            const pixel = (y * width + x) * 4;
            pixels[pixel] = shade;
            pixels[pixel + 1] = shade;
            pixels[pixel + 2] = shade;
            pixels[pixel + 3] = 255;
          }
        }
      }
    }
  }
  return { width, height, pixels };
}

function assertChunkyGoldenOracle() {
  const goldenRows = [
    [0x12, 0x34, 0x56, 0x78],
    [0x87, 0x65, 0x43, 0x21],
    [0x13, 0x57, 0x9b, 0xdf],
    [0xf0, 0xe1, 0xd2, 0xc3],
    [0x24, 0x68, 0xac, 0xef],
    [0xfe, 0xdc, 0xba, 0x98],
    [0x31, 0x42, 0x53, 0x64],
    [0x75, 0x86, 0x97, 0xa8],
  ];
  const goldenRom = Buffer.alloc(32);
  goldenRows.forEach((row, index) => row.forEach((value, byteIndex) => { goldenRom[index * 4 + byteIndex] = value; }));
  const expected = renderExpectedTilePreview(goldenRom, 0, 32);
  goldenRows.forEach((row, y) => row.flatMap((value) => [value >> 4, value & 0x0f]).forEach((index, x) => {
    const pixel = (y * 2 * expected.width + x * 2) * 4;
    const expectedShade = index * 17;
    if (expected.pixels[pixel] !== expectedShade || expected.pixels[pixel + 1] !== expectedShade || expected.pixels[pixel + 2] !== expectedShade || expected.pixels[pixel + 3] !== 255) {
      fail(`Golden chunky inválido no oracle: linha=${y} pixel=${x} valor=${index}`);
    }
  }));
}

function assertExactPreviewPixels(actual, expected, context) {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    fail(`Dimensões independentes divergentes (${context}): ${JSON.stringify({ actual: [actual.width, actual.height], expected: [expected.width, expected.height] })}`);
  }
  const actualPixels = Buffer.from(actual.pixels);
  if (!actualPixels.equals(expected.pixels)) {
    let firstDifference = -1;
    for (let index = 0; index < Math.min(actualPixels.length, expected.pixels.length); index += 1) {
      if (actualPixels[index] !== expected.pixels[index]) {
        firstDifference = index;
        break;
      }
    }
    fail(`Pixels RGBA divergentes (${context}): ${JSON.stringify({ firstDifference, actualSha256: createHash("sha256").update(actualPixels).digest("hex"), expectedSha256: createHash("sha256").update(expected.pixels).digest("hex") })}`);
  }
  return {
    width: actual.width,
    height: actual.height,
    pixelsSha256: createHash("sha256").update(actualPixels).digest("hex"),
  };
}

async function createUnavailablePreviewFixture() {
  const size = 0x10000;
  const bytes = Buffer.alloc(size, 0xa5);
  bytes.fill(0, 0, 0x200);
  bytes.write("SEGA", 0x100, "ascii");
  bytes.write("RDS PREVIEW NEGATIVE", 0x120, "ascii");
  bytes.write("RDS CONTROLLED FIXTURE", 0x150, "ascii");
  bytes.writeUInt32BE(0x200, 0x1a0);
  bytes.writeUInt32BE(size - 1, 0x1a4);
  bytes.write("JUE", 0x1f0, "ascii");
  for (let candidateIndex = 0; candidateIndex < 17; candidateIndex += 1) {
    const offset = 0x2000 + candidateIndex * 0x200;
    for (let tileIndex = 0; tileIndex < 4; tileIndex += 1) {
      const base = offset + tileIndex * 32;
      for (let row = 0; row < 8; row += 1) {
        // Keep the fixture graphic-like without making it an exact short
        // period. The scanner must accept these 1bpp-like rows while the
        // two constant-tile gaps keep the 17 blocks separate. The 17th
        // candidate is intentionally beyond the preview export cap (16),
        // which exercises a real candidate with no preview artifact.
        const seed = candidateIndex * 29 + tileIndex * 11 + row * 7;
        bytes[base + row * 4] = (0x31 + seed) & 0xff;
        bytes[base + row * 4 + 1] = (0x8d ^ seed) & 0xff;
        bytes[base + row * 4 + 2] = 0;
        bytes[base + row * 4 + 3] = 0;
      }
    }
  }
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "rds-inspection-preview-unavailable-"));
  const romPath = path.join(fixtureDir, "controlled-preview-unavailable.bin");
  await writeFile(romPath, bytes);
  return {
    fixtureDir,
    romPath,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    expectedCandidateCount: 17,
  };
}

async function inspectElementInteraction(sessionId, selector) {
  return executeScript(
    sessionId,
    `
      const target = document.querySelector(arguments[0]);
      if (!(target instanceof HTMLElement)) return { selector: arguments[0], found: false };
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const stack = document.elementsFromPoint(point.x, point.y).slice(0, 8).map((node) => ({
        tag: node.tagName,
        testId: node.getAttribute?.('data-testid') ?? null,
        id: node.id || null,
        className: typeof node.className === 'string' ? node.className.slice(0, 160) : null,
        text: (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      }));
      const active = document.activeElement;
      const scrollParents = [];
      let parent = target.parentElement;
      while (parent) {
        const parentStyle = getComputedStyle(parent);
        if (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth) {
          const parentRect = parent.getBoundingClientRect();
          scrollParents.push({
            tag: parent.tagName,
            testId: parent.getAttribute('data-testid'),
            overflowY: parentStyle.overflowY,
            scrollTop: parent.scrollTop,
            scrollHeight: parent.scrollHeight,
            clientHeight: parent.clientHeight,
            rect: { top: parentRect.top, height: parentRect.height },
          });
        }
        parent = parent.parentElement;
      }
      return {
        selector: arguments[0],
        found: true,
        tag: target.tagName,
        outerHTML: target.outerHTML.slice(0, 1200),
        visible: Boolean(rect.width && rect.height && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0),
        disabled: target instanceof HTMLButtonElement || target instanceof HTMLInputElement ? target.disabled : false,
        ariaDisabled: target.getAttribute('aria-disabled'),
        focused: active === target,
        activeElement: active instanceof HTMLElement ? { tag: active.tagName, testId: active.getAttribute('data-testid'), id: active.id || null } : null,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        style: { display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents, zIndex: style.zIndex, position: style.position },
        elementAtCenter: document.elementFromPoint(point.x, point.y)?.outerHTML?.slice(0, 500) ?? null,
        overlayStack: stack,
        scrollParents,
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY, devicePixelRatio: window.devicePixelRatio },
        effectiveValue: target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : null,
      };
    `,
    [selector]
  );
}

async function clickElementWithDiagnostics(sessionId, elementId, selector) {
  const preparation = await executeScript(
    sessionId,
    `
      const target = document.querySelector(arguments[0]);
      if (!(target instanceof HTMLElement)) return false;
      target.scrollIntoView({ block: "center", inline: "center" });
      const scrollParents = [];
      let parent = target.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if (parent.scrollHeight > parent.clientHeight) {
          const targetRect = target.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          parent.scrollTop += targetRect.top - parentRect.top - (parentRect.height - targetRect.height) / 2;
          scrollParents.push({ testId: parent.getAttribute('data-testid'), scrollTop: parent.scrollTop });
        }
        parent = parent.parentElement;
      }
      target.scrollIntoView({ block: "center", inline: "center" });
      target.focus();
      return { rect: target.getBoundingClientRect().toJSON?.() ?? null, scrollParents };
    `,
    [selector]
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log(`[inspection-click] preparation=${JSON.stringify(preparation)}`);
  const before = await inspectElementInteraction(sessionId, selector);
  let response;
  try {
    // O WebKitWebDriver pode conservar a referência geométrica do elemento
    // antes do scroll. Reencontrar o mesmo nó depois da verificação mantém o
    // clique nativo, mas evita enviar a operação para a posição anterior.
    const currentElementId = await findElement(sessionId, selector);
    if (currentElementId !== elementId) {
      console.log(`[inspection-click] elemento re-resolvido após scroll: ${elementId} -> ${currentElementId}`);
    }
    response = await webdriverRequestDetailed("POST", `/session/${sessionId}/element/${currentElementId}/click`, {});
  } catch (error) {
    response = { exception: error instanceof Error ? error.message : String(error) };
  }
  const after = await inspectElementInteraction(sessionId, selector);
  const uiState = await readInspectionUiState(sessionId);
  console.log(`[inspection-click] selected=${JSON.stringify(before)}`);
  console.log(`[inspection-click] http=${JSON.stringify(response)}`);
  console.log(`[inspection-click] after=${JSON.stringify(after)}`);
  console.log(`[inspection-click] ui=${JSON.stringify(uiState)}`);
  if (response.exception || !response.ok || response.payload?.value?.error) {
    throw new Error(`Clique WebDriver falhou com diagnóstico completo: ${JSON.stringify(response)}`);
  }
  return { before, response, after, uiState };
}

async function clickElementWithNativePointer(sessionId, selector, label) {
  const preparation = await executeScript(
    sessionId,
    `
      const target = document.querySelector(arguments[0]);
      if (!(target instanceof HTMLElement)) return null;
      target.scrollIntoView({ block: "center", inline: "center" });
      target.focus();
      const rect = target.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    `,
    [selector]
  );
  if (!preparation) fail(`Controle ausente para clique nativo por ponteiro: ${label}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const before = await inspectElementInteraction(sessionId, selector);
  if (!before?.found || !before.visible || before.disabled || !before.elementAtCenter?.includes("inspection-sonic-edit")) {
    fail(`Clique nativo por ponteiro bloqueado: ${JSON.stringify({ label, before })}`);
  }
  const response = await webdriverRequestDetailed("POST", `/session/${sessionId}/actions`, {
    actions: [{
      type: "pointer",
      id: "rds-native-pointer",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", origin: "viewport", x: preparation.x, y: preparation.y },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    }],
  });
  const after = await inspectElementInteraction(sessionId, selector);
  const uiState = await readInspectionUiState(sessionId);
  console.log(`[inspection-click-pointer] ${JSON.stringify({ label, preparation, before, response, after, uiState })}`);
  if (!response.ok || response.payload?.value?.error) {
    throw new Error(`Clique nativo por ponteiro falhou: ${JSON.stringify(response)}`);
  }
  return { before, response, after, uiState };
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

const NATIVE_GAME_KEYS = {
  ArrowRight: "\uE014",
  ArrowLeft: "\uE012",
  ArrowUp: "\uE013",
  ArrowDown: "\uE015",
  Enter: "\uE007",
  KeyZ: "z",
  KeyX: "x",
  KeyC: "c",
  KeyQ: "q",
};

async function sendNativeGameKey(sessionId, code, action, label) {
  const value = NATIVE_GAME_KEYS[code];
  if (!value) fail(`Tecla nativa não mapeada para ${label}: ${code}`);
  const response = await webdriverRequestDetailed("POST", `/session/${sessionId}/actions`, {
    actions: [{
      type: "key",
      id: `rds-game-${code}`,
      actions: [{ type: action, value }],
    }],
  });
  if (!response.ok || response.payload?.value?.error) {
    fail(`Entrada nativa recusada (${label}): ${JSON.stringify(response)}`);
  }
  return response;
}

async function clickCanvasPointNatively(sessionId, selector, normalizedX, normalizedY, label, button = 0) {
  const point = await executeScript(
    sessionId,
    `
      const canvas = document.querySelector(arguments[0]);
      if (!(canvas instanceof HTMLElement)) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: Math.round(rect.left + rect.width * arguments[1]),
        y: Math.round(rect.top + rect.height * arguments[2]),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
    `,
    [selector, normalizedX, normalizedY]
  );
  if (!point) fail(`Canvas ausente para clique nativo: ${label}`);
  const response = await webdriverRequestDetailed("POST", `/session/${sessionId}/actions`, {
    actions: [{
      type: "pointer",
      id: "rds-scene-painter",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", origin: "viewport", x: point.x, y: point.y },
        { type: "pointerDown", button },
        { type: "pointerUp", button },
      ],
    }],
  });
  if (!response.ok || response.payload?.value?.error) {
    fail(`Clique nativo no canvas recusado (${label}): ${JSON.stringify({ point, response })}`);
  }
  return { point, response };
}

async function focusGameCanvasNatively(sessionId) {
  const canvas = await findElement(sessionId, "[data-testid='viewport-game-canvas']");
  await webdriverRequest("POST", `/session/${sessionId}/element/${canvas}/click`, {});
}

async function readCanonicalGameFrame(sessionId, options = {}) {
  const includePixels = options.includePixels === true;
  const frame = await executeScript(
    sessionId,
    `
      const canvas = document.querySelector('[data-testid="viewport-game-canvas"]');
      const identity = document.querySelector('[data-testid="viewport-emulator-identity"]');
      if (!(canvas instanceof HTMLCanvasElement) || !(identity instanceof HTMLElement)) return null;
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) return null;
      const data = Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
      let nonBlackPixels = 0;
      const magentaLike = [];
      const sonicRoiMagentaLike = [];
      for (let offset = 0; offset < data.length; offset += 4) {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        if (r !== 0 || g !== 0 || b !== 0) nonBlackPixels += 1;
        if (r >= 224 && g <= 32 && b >= 224) {
          const pixel = offset / 4;
          const point = { x: pixel % canvas.width, y: Math.floor(pixel / canvas.width) };
          magentaLike.push(point);
          if (point.x < Math.min(canvas.width, 128) && point.y >= Math.floor(canvas.height * 0.55)) sonicRoiMagentaLike.push(point);
        }
      }
      const bounds = magentaLike.length === 0 ? null : {
        x0: Math.min(...magentaLike.map((point) => point.x)),
        y0: Math.min(...magentaLike.map((point) => point.y)),
        x1: Math.max(...magentaLike.map((point) => point.x)),
        y1: Math.max(...magentaLike.map((point) => point.y)),
      };
      const sonicRoiBounds = sonicRoiMagentaLike.length === 0 ? null : {
        x0: Math.min(...sonicRoiMagentaLike.map((point) => point.x)),
        y0: Math.min(...sonicRoiMagentaLike.map((point) => point.y)),
        x1: Math.max(...sonicRoiMagentaLike.map((point) => point.x)),
        y1: Math.max(...sonicRoiMagentaLike.map((point) => point.y)),
      };
      const sonicRoiCentroid = sonicRoiMagentaLike.length === 0 ? null : {
        x: sonicRoiMagentaLike.reduce((sum, point) => sum + point.x, 0) / sonicRoiMagentaLike.length,
        y: sonicRoiMagentaLike.reduce((sum, point) => sum + point.y, 0) / sonicRoiMagentaLike.length,
      };
      return {
        width: canvas.width,
        height: canvas.height,
        rgba: data,
        nonBlackPixels,
        magentaLikePixels: magentaLike.length,
        magentaLikeBounds: bounds,
        sonicRoiMagentaLikePixels: sonicRoiMagentaLike.length,
        sonicRoiMagentaLikeBounds: sonicRoiBounds,
        sonicRoiMagentaLikeCentroid: sonicRoiCentroid,
        renderedFrames: Number(identity.getAttribute('data-rendered-frames') || 0),
        romPath: identity.getAttribute('data-rom-path') || '',
        romSha256: identity.getAttribute('data-rom-sha256') || '',
        romSize: Number(identity.getAttribute('data-rom-size') || 0),
        coreLabel: identity.getAttribute('data-core-label') || '',
        corePath: identity.getAttribute('data-core-path') || '',
        lastInputRequestSeq: Number(identity.getAttribute('data-last-input-request-seq') || 0),
        lastInputAckSeq: Number(identity.getAttribute('data-last-input-ack-seq') || 0),
      };
    `
  );
  if (!frame) return null;
  const rgba = Buffer.from(frame.rgba);
  return {
    ...frame,
    rgba: includePixels ? rgba : undefined,
    framebufferSha256: createHash("sha256").update(rgba).digest("hex"),
    rgbaBytes: rgba.length,
  };
}

async function readCanonicalGameProgress(sessionId) {
  return executeScript(
    sessionId,
    `
      const canvas = document.querySelector('[data-testid="viewport-game-canvas"]');
      const identity = document.querySelector('[data-testid="viewport-emulator-identity"]');
      const status = document.querySelector('[data-testid="viewport-game-status"]');
      if (!(canvas instanceof HTMLCanvasElement) || !(identity instanceof HTMLElement)) return null;
      return {
        width: canvas.width,
        height: canvas.height,
        renderedFrames: Number(identity.getAttribute('data-rendered-frames') || 0),
        romPath: identity.getAttribute('data-rom-path') || '',
        romSha256: identity.getAttribute('data-rom-sha256') || '',
        romSize: Number(identity.getAttribute('data-rom-size') || 0),
        coreLabel: identity.getAttribute('data-core-label') || '',
        corePath: identity.getAttribute('data-core-path') || '',
        lastInputRequestSeq: Number(identity.getAttribute('data-last-input-request-seq') || 0),
        lastInputAckSeq: Number(identity.getAttribute('data-last-input-ack-seq') || 0),
        gameStatus: status?.textContent?.trim() || '',
      };
    `
  );
}

function readU16le(bytes, offset) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readI16le(bytes, offset) {
  const value = readU16le(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

async function readEmulatorMemory(sessionId, region, offset, length) {
  const result = await executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const [region, offset, length] = arguments;
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") {
        done({ ok: false, error: "Tauri invoke indisponivel na janela" });
        return;
      }
      invoke("emulator_read_memory", { region, offset, length })
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `,
    [region, offset, length]
  );
  if (!result?.ok) fail(`Falha ao ler memoria do core: ${result?.error ?? "sem diagnostico"}`);
  return result.value;
}

async function readSonic1PlayerMemory(sessionId) {
  // Sonic 1 player object candidate in 68k WRAM. The run validates this
  // candidate by correlating deltas with the independently located initial
  // framebuffer and with native input ACKs before using it as trajectory oracle.
  const objectOffset = 0xd000;
  const result = await readEmulatorMemory(sessionId, 2, objectOffset, 0x40);
  const bytes = result.data ?? [];
  return {
    source: "WRAM region 2, Sonic 1 player object candidate 0xD000",
    objectOffset,
    totalSize: result.total_size,
    rawSha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    id: bytes[0] ?? null,
    renderFlags: bytes[1] ?? null,
    x: readI16le(bytes, 0x08),
    xSub: readU16le(bytes, 0x0a),
    y: readI16le(bytes, 0x0c),
    ySub: readU16le(bytes, 0x0e),
    xVel: readI16le(bytes, 0x10),
    yVel: readI16le(bytes, 0x12),
    inertia: readI16le(bytes, 0x14),
    status: bytes[0x22] ?? null,
  };
}

async function runCanonicalSonicTrajectory(sessionId, options) {
  const { buttonTestId, label, expectedSha256, romBytes, artifactPrefix } = options;
  console.log(`[inspection-trajectory] ${JSON.stringify({ label, step: "launch" })}`);
  await clickButtonByTestIdNativeWhenReady(sessionId, buttonTestId, `jogar ${label} na Game View`);
  const identity = await waitFor(async () => {
    const frame = await readCanonicalGameFrame(sessionId);
    return frame && frame.romSha256 === expectedSha256 && frame.romSize === romBytes.length && frame.coreLabel && frame.corePath ? frame : false;
  }, 15000, `Game View não confirmou a identidade da ${label}`, 100);
  console.log(`[inspection-trajectory] ${JSON.stringify({ label, step: "identity", romSha256: identity.romSha256, core: identity.coreLabel })}`);
  await waitFor(async () => {
    const progress = await readCanonicalGameProgress(sessionId);
    return progress && progress.renderedFrames >= 10 ? progress : false;
  }, 10000, `Game View não produziu frames para a ${label}`, 100);
  const bootFrame = await waitFor(async () => {
    const progress = await readCanonicalGameProgress(sessionId);
    return progress && progress.renderedFrames >= 890 ? progress : false;
  }, 120000, `${label} não atravessou o boot até o ponto de entrada`, 100);
  console.log(`[inspection-trajectory] ${JSON.stringify({ label, step: "boot", renderedFrames: bootFrame.renderedFrames })}`);
  await focusGameCanvasNatively(sessionId);
  const inputBeforeStart = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
  await sendNativeGameKey(sessionId, "Enter", "keyDown", `START de entrada da fase ${label}`);
  const startHoldProgress = await waitFor(async () => {
    const progress = await readCanonicalGameProgress(sessionId);
    return progress && progress.renderedFrames >= bootFrame.renderedFrames + 30 ? progress : false;
  }, 15000, `START não avançou frames para a ${label}`, 100);
  await sendNativeGameKey(sessionId, "Enter", "keyUp", `liberação de START da ${label}`);
  const startInput = await waitFor(async () => {
    const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return current?.lastJoypadAck?.seq > (inputBeforeStart?.lastJoypadAck?.seq ?? 0) ? current : false;
  }, 10000, `START não foi confirmado para a ${label}`, 100);
  const gameplayProgress = await waitFor(async () => {
    const progress = await readCanonicalGameProgress(sessionId);
    return progress && progress.renderedFrames >= 1800 ? progress : false;
  }, 120000, `${label} não alcançou a cena de gameplay`, 100);
  console.log(`[inspection-trajectory] ${JSON.stringify({ label, step: "gameplay", renderedFrames: gameplayProgress.renderedFrames })}`);
  const trajectory = [];
  const trajectoryPath = path.join(validationDir, `${artifactPrefix}-sonic-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-trajectory.json`);
  const persistTrajectory = async (extra = {}) => {
    await writeFile(
      trajectoryPath,
      JSON.stringify(
        {
          label,
          romSha256: expectedSha256,
          core: identity.coreLabel,
          initial: { onGround, groundTop },
          input: { start: startInput, right: rightInput, rightReleased, jump: jumpInput, jumpReleased: jumpReleasedInput },
          frames: trajectory,
          pause: extra.pause ?? null,
          ...extra,
        },
        null,
        2
      )
    );
  };
  let onGround = false;
  let groundTop = null;
  let rightInput = null;
  let rightReleased = null;
  let jumpInput = null;
  let jumpReleasedInput = null;
  const capture = async (captureLabel, input, previous, minFrameExclusive = -1) => {
    const raw = await waitFor(async () => {
      const progress = await readCanonicalGameProgress(sessionId);
      return progress && progress.renderedFrames > minFrameExclusive ? readCanonicalGameFrame(sessionId, { includePixels: true }) : false;
    }, 10000, `${label}/${captureLabel} não avançou para um novo frame`, 100);
    const sonic = locateSonicVisual(raw, romBytes, { previous });
    if (!sonic) fail(`Localizador independente não encontrou Sonic em ${label}/${captureLabel}`);
    const memory = await readSonic1PlayerMemory(sessionId);
    const entry = { label: captureLabel, frame: raw.renderedFrames, input, framebufferSha256: raw.framebufferSha256, sonic, memory };
    trajectory.push(entry);
    return { raw, sonic, entry };
  };
  const gameplayRaw = await readCanonicalGameFrame(sessionId, { includePixels: true });
  const gameplaySonic = locateSonicVisual(gameplayRaw, romBytes);
  if (!gameplaySonic) fail(`Localizador independente não encontrou Sonic no gameplay de ${label}`);
  const gameplayMemory = await readSonic1PlayerMemory(sessionId);
  console.log(`[inspection-trajectory] ${JSON.stringify({ label, step: "located", frame: gameplayRaw.renderedFrames, sonic: gameplaySonic, memory: gameplayMemory })}`);
  groundTop = (() => {
    for (let y = gameplaySonic.bounds.y1 + 1; y < gameplayRaw.height; y += 1) {
      let greenPixels = 0;
      for (let x = Math.max(0, gameplaySonic.bounds.x0 - 12); x <= Math.min(gameplayRaw.width - 1, gameplaySonic.bounds.x1 + 12); x += 1) {
        const offset = (y * gameplayRaw.width + x) * 4;
        if (gameplayRaw.rgba[offset + 1] > gameplayRaw.rgba[offset] + 20 && gameplayRaw.rgba[offset + 1] > gameplayRaw.rgba[offset + 2] + 10 && gameplayRaw.rgba[offset + 1] >= 90) greenPixels += 1;
      }
      if (greenPixels >= 8) return y;
    }
    return null;
  })();
  onGround = groundTop !== null && groundTop - gameplaySonic.bounds.y1 <= 4;
  trajectory.push({ label: "before-controls", frame: gameplayRaw.renderedFrames, input: "neutral", framebufferSha256: gameplayRaw.framebufferSha256, sonic: gameplaySonic, memory: gameplayMemory });
  if (!onGround) {
    await persistTrajectory({ failure: "initial-not-grounded" });
    fail(`Situação inicial não comprovou ${label} no chão: ${JSON.stringify({ sonic: gameplaySonic, groundTop })}`);
  }
  const before = { raw: gameplayRaw, sonic: gameplaySonic };
  await sendNativeGameKey(sessionId, "ArrowRight", "keyDown", `movimento ${label}`);
  rightInput = await waitFor(async () => {
    const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return current?.lastJoypadAck?.joypad?.right === true ? current : false;
  }, 10000, `ArrowRight não chegou ao core para ${label}`, 100);
  const movementSamples = [];
  let movementHoldProgress = null;
  for (const frames of [45, 90, 135]) {
    movementHoldProgress = await waitFor(async () => {
      const progress = await readCanonicalGameProgress(sessionId);
      return progress && progress.renderedFrames >= before.raw.renderedFrames + frames ? progress : false;
    }, 20000, `movimento não avançou ${frames} frames para ${label}`, 100);
    movementSamples.push(await capture(`movement-held-${frames}`, { right: true }, movementSamples.at(-1)?.sonic ?? before.sonic, movementSamples.at(-1)?.raw.renderedFrames ?? before.raw.renderedFrames));
    console.log(`[inspection-trajectory] ${JSON.stringify({ label, step: `movement-held-${frames}`, frame: movementSamples.at(-1).raw.renderedFrames, sonic: movementSamples.at(-1).sonic })}`);
  }
  const duringMovement = movementSamples.at(-1);
  await sendNativeGameKey(sessionId, "ArrowRight", "keyUp", `parada do movimento ${label}`);
  rightReleased = await waitFor(async () => {
    const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return current?.lastJoypadAck?.joypad?.right === false ? current : false;
  }, 10000, `liberação de ArrowRight não chegou para ${label}`, 100);
  const afterMovement = await capture("movement-released", { right: false }, duringMovement.sonic, duringMovement.raw.renderedFrames);
  const movementDeltaX = Math.max(...[...movementSamples.map((sample) => sample.entry), afterMovement.entry].map((entry) => Math.abs(entry.memory.x - gameplayMemory.x)));
  if (movementDeltaX < 2) {
    await persistTrajectory({ failure: "movement-not-observed", movementDeltaX });
    fail(`Movimento de ${label} não mudou a posição visual independente`);
  }
  const beforeJump = await capture("jump-before", { right: false, a: false }, afterMovement.sonic, afterMovement.raw.renderedFrames);
  await sendNativeGameKey(sessionId, "KeyZ", "keyDown", `salto A ${label}`);
  jumpInput = await waitFor(async () => {
    const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return current?.lastJoypadAck?.joypad?.y === true ? current : false;
  }, 10000, `KeyZ/A não chegou ao core para ${label}`, 100);
  const jumpHoldProgress = await waitFor(async () => {
    const progress = await readCanonicalGameProgress(sessionId);
    return progress && progress.renderedFrames >= beforeJump.raw.renderedFrames + 2 ? progress : false;
  }, 20000, `salto não avançou frames para ${label}`, 100);
  const jumpHeld = await capture("jump-held", { a: true }, beforeJump.sonic, beforeJump.raw.renderedFrames);
  await sendNativeGameKey(sessionId, "KeyZ", "keyUp", `liberação do salto ${label}`);
  jumpReleasedInput = await waitFor(async () => {
    const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return current?.lastJoypadAck?.joypad?.y === false ? current : false;
  }, 10000, `liberação de KeyZ/A não chegou para ${label}`, 100);
  const jumpReleased = await capture("jump-released", { a: false }, jumpHeld.sonic, jumpHeld.raw.renderedFrames);
  let lastJumpSample = jumpReleased;
  const after = async (captureLabel, frames) => {
    await waitFor(async () => {
      const progress = await readCanonicalGameProgress(sessionId);
      return progress && progress.renderedFrames >= jumpReleased.raw.renderedFrames + frames ? progress : false;
    }, 30000, `${label} não avançou ${frames} frames após o salto`, 100);
    lastJumpSample = await capture(captureLabel, { a: false }, lastJumpSample.sonic, lastJumpSample.raw.renderedFrames);
    return lastJumpSample;
  };
  const jumpLater = await after("jump-after-15", 15);
  const jumpMid = await after("jump-after-45", 45);
  const jumpReturn90 = await after("jump-after-90", 90);
  const jumpReturn150 = await after("jump-after-150", 150);
  const jumpReturn240 = await after("jump-after-240", 240);
  const jumpReturn = [jumpMid, jumpReturn90, jumpReturn150, jumpReturn240].find((sample) => sample.entry.memory.yVel === 0) ?? jumpReturn240;
  const jumpLift = beforeJump.entry.memory.y - Math.min(...trajectory.filter((entry) => entry.label.startsWith("jump-")).map((entry) => entry.memory.y));
  const returnedToGround = jumpReturn.entry.memory.yVel === 0 && jumpReturn.entry.memory.y >= beforeJump.entry.memory.y - jumpLift;
  if (jumpLift < 3 || !returnedToGround) {
    await persistTrajectory({ failure: "jump-trajectory-not-observed", jumpLift, returnedToGround });
    fail(`Trajetória de salto não comprovou subida e retorno em ${label}: ${JSON.stringify({ jumpLift, returnedToGround, trajectory })}`);
  }
  await clickButtonByTestIdNative(sessionId, "viewport-pause", `pausar ${label}`);
  await waitFor(async () => executeScript(sessionId, "return /paus/i.test(document.querySelector('[data-testid=\"viewport-game-status\"]')?.textContent ?? '')"), 10000, `pausa não ficou visível em ${label}`, 100);
  const paused = await readCanonicalGameProgress(sessionId);
  await clickButtonByTestIdNative(sessionId, "viewport-resume", `retomar ${label}`);
  const resumed = await waitFor(async () => {
    const progress = await readCanonicalGameProgress(sessionId);
    return progress && progress.renderedFrames > paused.renderedFrames + 5 ? progress : false;
  }, 10000, `retomada não avançou em ${label}`, 100);
  await persistTrajectory({ pause: { paused, resumed }, movementDeltaX });
  return { identity, bootFrame, startHoldProgress, gameplayProgress, movement: { before: trajectory.find((entry) => entry.label === "before-controls"), samples: movementSamples.map((sample) => sample.entry), after: afterMovement.entry, holdProgress: movementHoldProgress, deltaX: movementDeltaX }, jump: { before: beforeJump.entry, held: jumpHeld.entry, released: jumpReleased.entry, later: jumpLater.entry, mid: jumpMid.entry, after: jumpReturn.entry, holdProgress: jumpHoldProgress }, pause: { paused, resumed }, trajectoryPath, screenshot: await captureScreenshot(sessionId, `${artifactPrefix}-sonic-game-${label}.png`) };
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
  const requestedWidth = Number(process.env.RDS_E2E_WINDOW_WIDTH);
  const requestedHeight = Number(process.env.RDS_E2E_WINDOW_HEIGHT);
  const targetWidth = Number.isFinite(requestedWidth) && requestedWidth > 0 ? requestedWidth : Number(width);
  const targetHeight = Number.isFinite(requestedHeight) && requestedHeight > 0 ? requestedHeight : Number(height);
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
      let framebufferHash = 2166136261;
      let tilemapCellHash = 2166136261;
      for (let index = 0; index < imageData.length; index += 4) {
        for (let channel = 0; channel < 4; channel += 1) {
          framebufferHash ^= imageData[index + channel];
          framebufferHash = Math.imul(framebufferHash, 16777619);
        }
        if (imageData[index] !== 0 || imageData[index + 1] !== 0 || imageData[index + 2] !== 0) {
          nonBlackPixels += 1;
        }
      }
      for (let y = 200; y < 208 && y < canvas.height; y += 1) {
        for (let x = 8; x < 16 && x < canvas.width; x += 1) {
          const index = (y * canvas.width + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            tilemapCellHash ^= imageData[index + channel];
            tilemapCellHash = Math.imul(tilemapCellHash, 16777619);
          }
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        non_black_pixels: nonBlackPixels,
        framebuffer_hash: (framebufferHash >>> 0).toString(16).padStart(8, "0"),
        tilemap_cell_hash: (tilemapCellHash >>> 0).toString(16).padStart(8, "0"),
      };
    `
  );
}

async function readInspectionEmulatorObservation(sessionId, options = {}) {
  const includePixels = options.includePixels === true;
  return executeScript(
    sessionId,
    `
      const observation = document.querySelector('[data-testid="inspection-emulator-observation"]');
      const canvas = document.querySelector('[data-testid="inspection-emulator-framebuffer"]');
      if (!observation || !(canvas instanceof HTMLCanvasElement)) return null;
      const context = canvas.getContext("2d");
      const pixels = context ? context.getImageData(0, 0, canvas.width, canvas.height).data : null;
      let nonBlackPixels = 0;
      if (pixels) {
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) nonBlackPixels += 1;
        }
      }
      return {
        label: observation.getAttribute("data-observation-label") || "",
        romPath: observation.getAttribute("data-rom-path") || "",
        romSha256: observation.getAttribute("data-rom-sha256") || "",
        romSize: Number(observation.getAttribute("data-rom-size") || "0"),
        coreLabel: observation.getAttribute("data-core-label") || "",
        corePath: observation.getAttribute("data-core-path") || "",
        framesRun: Number(observation.getAttribute("data-frames-run") || "0"),
        framesRequested: Number(observation.getAttribute("data-frames-requested") || "0"),
        inputProfile: observation.getAttribute("data-input-profile") || "",
        inputStartFrame: observation.getAttribute("data-input-start-frame") === "" ? null : Number(observation.getAttribute("data-input-start-frame") || "0"),
        framebufferWidth: Number(observation.getAttribute("data-framebuffer-width") || "0"),
        framebufferHeight: Number(observation.getAttribute("data-framebuffer-height") || "0"),
        framebufferSha256: observation.getAttribute("data-framebuffer-sha256") || "",
        declaredNonBlackPixels: Number(observation.getAttribute("data-non-black-pixels") || "0"),
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        canvasRgbaBytes: pixels?.length ?? 0,
        canvasNonBlackPixels: nonBlackPixels,
        canvasRgba: ${includePixels ? "pixels ? Array.from(pixels) : null" : "null"},
        text: observation.textContent?.replace(/\\s+/g, " ").trim() || "",
      };
    `
  );
}

async function ensureEmulatorObservationVisible(sessionId) {
  return executeScript(
    sessionId,
    `
      const canvas = document.querySelector('[data-testid="inspection-emulator-framebuffer"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      canvas.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = canvas.getBoundingClientRect();
      const fullyVisible = rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const top = fullyVisible ? document.elementFromPoint(x, y) : null;
      const unobstructed = Boolean(top && (top === canvas || canvas.contains(top)));
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        fullyVisible,
        unobstructed,
        point: { x, y },
        topTag: top?.tagName ?? '',
        topTestId: top instanceof Element ? top.getAttribute('data-testid') ?? '' : '',
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

async function runReferencePlatformerScenario(sessionId, timeoutMs, onProjectCreated) {
  const artifactPrefix = `reference-platformer-${artifactTimestamp()}`;
  const reportPath = path.join(validationDir, `${artifactPrefix}-report.json`);
  const report = {
    generatedAt: null,
    scenario: "reference-platformer",
    testedApplication: {
      path: currentE2eRunContext?.appPath ?? null,
      sha256: currentE2eRunContext?.appPath
        ? createHash("sha256").update(await readFile(currentE2eRunContext.appPath)).digest("hex")
        : null,
    },
    projectName: "",
    projectDir: "",
    templateId: "reference_platformer",
    artifacts: [],
    steps: [],
    roms: [],
    frames: [],
    input: {},
    goalDecision: {},
    tilemapAuthoring: {},
    persistence: {},
  };

  await setSessionWindowRect(sessionId, 1920, 1080);
  await waitForOnboardingWizard(sessionId);
  addReportArtifact(
    report,
    await captureScreenshot(sessionId, `${artifactPrefix}-01-wizard.png`),
    "reference template wizard"
  );
  await clickByTestId(sessionId, "template-card-reference_platformer");
  await clickButtonByText(sessionId, "Mega Drive", "exact");
  const generatedProjectName = `Reference_Platformer_${Date.now()}`;
  await fillInputBySelector(
    sessionId,
    'input[placeholder="Nome do projeto"]',
    generatedProjectName
  );
  await clickButtonByText(sessionId, "Criar Projeto", "exact");

  const createdState = await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const entities = Array.isArray(state?.activeScene?.entities)
        ? state.activeScene.entities
        : [];
      return state?.activeProjectDir &&
        state.activeProjectName === generatedProjectName &&
        state.activeTarget === "megadrive" &&
        entities.length === 6
        ? state
        : false;
    },
    45000,
    "Template reference_platformer nao criou a cena completa pelo wizard.",
    500
  );
  onProjectCreated(createdState.activeProjectDir);
  report.projectName = generatedProjectName;
  report.projectDir = createdState.activeProjectDir;
  currentE2eRunContext.project = createdState.activeProjectDir;
  currentE2eRunContext.projectName = generatedProjectName;
  currentE2eRunContext.projectTarget = "megadrive";
  const entityIds = (createdState.activeScene.entities ?? []).map((entity) => entity.id ?? entity.entity_id);
  for (const requiredId of ["reference_tilemap", "player", "passage_blocker", "goal", "goal_sensor", "main_camera"]) {
    if (!entityIds.includes(requiredId)) {
      fail(`Template reference_platformer nao expos a entidade '${requiredId}'.`);
    }
  }
  addReportStep(report, "create_reference_platformer_from_wizard", "passed", {
    projectDir: createdState.activeProjectDir,
    entityIds,
  });
  addReportArtifact(
    report,
    await captureScreenshot(sessionId, `${artifactPrefix}-02-editor.png`),
    "reference platformer editor"
  );

  await clickByTestId(sessionId, "hierarchy-entity-player");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      return state?.selectedEntityId === "player" ? state : false;
    },
    10000,
    "Hierarchy nao selecionou o player do template de referencia.",
    250
  );
  await clickByTestId(sessionId, "workspace-rail-logic");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const cards = await executeScript(
        sessionId,
        "return document.querySelectorAll('[data-testid^=\"node-card-\"]').length;"
      );
      return state?.activeWorkspace === "logic" && cards >= 10 ? { state, cards } : false;
    },
    15000,
    "NodeGraph do template de referencia nao ficou visivel com os nodes gerados.",
    250
  );
  const logicState = await callAutomationApi(sessionId, "getEntityLogicState", ["player"]);
  if (!logicState?.resolved?.has_graph || logicState.resolved.graph_ref !== "graphs/reference_platformer_logic.json") {
    fail(`NodeGraph do player nao persistiu como referencia canonica: ${JSON.stringify(logicState)}`);
  }
  addReportStep(report, "inspect_visible_reference_nodegraph", "passed", {
    graphRef: logicState.resolved.graph_ref,
  });
  addReportArtifact(
    report,
    await captureScreenshot(sessionId, `${artifactPrefix}-03-nodegraph.png`),
    "reference platformer NodeGraph"
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
    "Salvar nao confirmou a cena do template de referencia.",
    250
  );
  addReportStep(report, "save_reference_platformer", "passed");

  await clickByTestId(sessionId, "workspace-rail-game");
  await waitFor(
    async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"viewport-game-canvas\"]'));"),
    15000,
    "Game View nao abriu para o template de referencia.",
    250
  );
  const firstBuild = await runBuildRunAndCollect(
    sessionId,
    "reference platformer initial build",
    timeoutMs,
    report,
    artifactPrefix
  );
  report.roms.push(firstBuild);
  report.frames.push({ label: firstBuild.label, ...firstBuild.framebuffer });
  for (const generatedName of ["main.c", "resources.res", "resources.rs"]) {
    const generatedPath = path.join(
      createdState.activeProjectDir,
      "build",
      "megadrive",
      generatedName === "main.c" ? "src" : "res",
      generatedName
    );
    if (await pathExists(generatedPath)) {
      const evidencePath = path.join(validationDir, `${artifactPrefix}-${generatedName}`);
      await cp(generatedPath, evidencePath);
      addReportArtifact(report, evidencePath, `generated ${generatedName}`);
    }
  }
  for (const generatedDirectory of ["res", "src"]) {
    const generatedDirectoryPath = path.join(
      createdState.activeProjectDir,
      "build",
      "megadrive",
      generatedDirectory
    );
    if (!(await pathExists(generatedDirectoryPath))) continue;
    for (const generatedName of await readdir(generatedDirectoryPath)) {
      if (!/resource|player|goal/i.test(generatedName)) continue;
      const generatedPath = path.join(generatedDirectoryPath, generatedName);
      const evidencePath = path.join(
        validationDir,
        `${artifactPrefix}-${generatedDirectory}-${generatedName}`
      );
      await cp(generatedPath, evidencePath);
      addReportArtifact(report, evidencePath, `generated ${generatedDirectory}/${generatedName}`);
    }
  }
  const initialMainPath = path.join(validationDir, `${artifactPrefix}-main.c`);
  const initialMainSource = await readFile(initialMainPath, "utf8");
  const logicVariableLayout = (source) => source
    .split(/\r?\n/)
    .filter((line) => /^static volatile s32 logic_var_/.test(line));
  const initialLogicVariableLayout = logicVariableLayout(initialMainSource);
  addReportStep(report, "build_real_rom_and_start_game_view", "passed", {
    rom: firstBuild.rom_path,
    framebuffer: firstBuild.framebuffer,
  });

  const invokeCore = async (command, args = {}) => executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") { done({ ok: false, error: "Tauri invoke indisponivel" }); return; }
      invoke(arguments[0], arguments[1] ?? {}).then((value) => done({ ok: true, value })).catch((error) => done({ ok: false, error: String(error) }));
    `,
    [command, args]
  );
  const elfPath = path.join(createdState.activeProjectDir, "build", "megadrive", "out", "rom.out");
  let runtimeSymbols = parseElf32Symbols(await readFile(elfPath));
  const readLogicInt = async (name) => {
    const address = runtimeSymbols.get(`logic_var_${name}`);
    const addressPrefix = Number.isInteger(address) ? address >>> 16 : 0;
    if (!Number.isInteger(address) || ![0x00ff, 0xe0ff].includes(addressPrefix)) {
      fail(`Símbolo runtime logic_var_${name} ausente ou fora da System RAM: ${address}`);
    }
    const memory = await invokeCore("emulator_read_memory", {
      region: 2,
      offset: address & 0xffff,
      length: 4,
    });
    if (!memory?.ok || !memory.value?.data || memory.value.data.length < 4) {
      fail(`Leitura da System RAM para ${name} falhou: ${JSON.stringify(memory)}`);
    }
    const data = Buffer.from(memory.value.data);
    const readWordNative = (position) => (data[position] ?? 0) | ((data[position + 1] ?? 0) << 8);
    const value = (((readWordNative(0) << 16) >>> 0) | readWordNative(2)) >>> 0;
    return { value: value > 0x7fffffff ? value - 0x100000000 : value, address, offset: address & 0xffff, rawHex: data.toString("hex") };
  };
  const neutralGoalInput = {
    b: false, y: false, select: false, start: false,
    up: false, down: false, left: false, right: false,
    a: false, x: false, l: false, r: false,
  };
  const framebufferStats = (observed) => {
    const rgba = Buffer.from(observed?.framebuffer_rgba ?? []);
    const width = Number(observed?.framebuffer_width ?? 320);
    const height = Number(observed?.framebuffer_height ?? 224);
    let yellowPixels = 0;
    let barrierPixels = 0;
    const yellowPoints = [];
    const playerPoints = [];
    for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      if (r >= 180 && g >= 120 && b <= 100 && r >= g && r - g <= 100) {
        yellowPixels += 1;
        yellowPoints.push({ x: (offset / 4) % width, y: Math.floor(offset / 4 / width) });
      }
      const pixel = offset / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      // The gate candidate uses a bright #CC0000 bar in its own 24x32 bounds.
      // Fox scarf (#AA0000) and fur must not count as a closed barrier.
      if (x >= 50 && x < 74 && y >= 168 && y < 200 && r >= 190 && g <= 20 && b <= 20) {
        barrierPixels += 1;
      }
      // Follow the fox's own #EE6600 coat, not arbitrary blue background pixels.
      if (x < 100 && y >= 140 && y < 210 && r >= 225 && g >= 80 && g <= 140 && b <= 40) {
        playerPoints.push({ x, y });
      }
    }
    return {
      width,
      height,
      yellowPixels,
      yellowBounds: yellowPoints.length > 0 ? {
        x0: Math.min(...yellowPoints.map((point) => point.x)),
        y0: Math.min(...yellowPoints.map((point) => point.y)),
        x1: Math.max(...yellowPoints.map((point) => point.x)),
        y1: Math.max(...yellowPoints.map((point) => point.y)),
      } : null,
      barrierPixels,
      playerPixelBounds: playerPoints.length > 0 ? {
        x0: Math.min(...playerPoints.map((point) => point.x)),
        y0: Math.min(...playerPoints.map((point) => point.y)),
        x1: Math.max(...playerPoints.map((point) => point.x)),
        y1: Math.max(...playerPoints.map((point) => point.y)),
      } : null,
      framebufferSha256: observed?.framebuffer_sha256 ?? null,
      romSha256: observed?.rom_sha256 ?? null,
      framesRun: observed?.frames_run ?? null,
    };
  };
  const goalVisualStats = (frame) => {
    const rgba = frame?.rgba ?? Buffer.alloc(0);
    const width = Number(frame?.width ?? 320);
    const height = Number(frame?.height ?? 224);
    const points = [];
    for (let y = Math.floor(height * 0.62); y < height; y += 1) {
      for (let x = Math.floor(width * 0.78); x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const r = rgba[offset];
        const g = rgba[offset + 1];
        const b = rgba[offset + 2];
        const isGoalYellow = r >= 150 && g >= 100 && b <= 120 && r >= g;
        const isGoalWhite = r >= 180 && g >= 180 && b >= 180;
        if (isGoalYellow || isGoalWhite) points.push({ x, y });
      }
    }
    return {
      width,
      height,
      markerPixels: points.length,
      bounds: points.length > 0 ? {
        x0: Math.min(...points.map((point) => point.x)),
        y0: Math.min(...points.map((point) => point.y)),
        x1: Math.max(...points.map((point) => point.x)),
        y1: Math.max(...points.map((point) => point.y)),
      } : null,
      framebufferSha256: frame?.framebufferSha256 ?? null,
      romSha256: frame?.romSha256 ?? null,
      renderedFrames: frame?.renderedFrames ?? null,
    };
  };
  const runGoalDecision = async (romPath, label, threshold, expectedOpen, screenshotLabel) => {
    const loaded = await callAutomationApi(sessionId, "loadRomForEmulation", [romPath, { startPaused: true }]);
    if (loaded !== true) fail(`Emulador nao confirmou carga da ROM ${label}.`);
    await waitFor(
      async () => {
        const state = await readAutomationState(sessionId);
        return state?.emulatorLoaded === true && state?.emulPaused === true ? state : false;
      },
      15000,
      `${label} nao ficou pausada antes da sequencia controlada.`,
      100
    );
    await closeVisibleConsoleDrawer(sessionId, `${label} decisao controlada`);
    const epoch = await invokeCore("emulator_get_core_epoch");
    if (!epoch?.ok || !Number.isInteger(epoch.value)) fail(`Epoca do core indisponivel para ${label}: ${JSON.stringify(epoch)}`);
    const neutralAck = await invokeCore("emulator_send_input", { joypad: neutralGoalInput, sessionEpoch: epoch.value });
    if (!neutralAck?.ok || !neutralAck.value?.ok) fail(`Input neutro nao confirmado para ${label}: ${JSON.stringify(neutralAck)}`);
    const warmed = await invokeCore("emulator_run_frames", { frames: 120 });
    const before = await invokeCore("emulator_observe");
    if (!warmed?.ok || !warmed.value?.ok || !before?.ok || !before.value?.ok) {
      fail(`Warmup da decisao de gameplay falhou para ${label}: ${JSON.stringify({ warmed, before })}`);
    }
    const renderPausedState = async (renderLabel) => {
      await clickByTestId(sessionId, "viewport-resume");
      const rendered = await waitFor(
        async () => {
          const frame = await readCanonicalGameFrame(sessionId, { includePixels: true });
          return frame && frame.nonBlackPixels > 0 && frame.romSha256 === before.value.rom_sha256 ? frame : false;
        },
        10000,
        `${renderLabel} nao produziu framebuffer visivel`,
        100
      );
      await clickByTestId(sessionId, "viewport-pause");
      await waitFor(
        async () => {
          const state = await readAutomationState(sessionId);
          return state?.emulPaused === true ? state : false;
        },
        10000,
        `${renderLabel} nao voltou ao estado pausado`,
        100
      );
      return rendered;
    };
    const runRightFrames = async (frames, context) => {
      const rightAck = await invokeCore("emulator_send_input", {
        joypad: { ...neutralGoalInput, right: true },
        sessionEpoch: epoch.value,
      });
      const ran = await invokeCore("emulator_run_frames", { frames });
      const observed = await invokeCore("emulator_observe");
      if (!rightAck?.ok || !rightAck.value?.ok || !ran?.ok || !ran.value?.ok || !observed?.ok || !observed.value?.ok) {
        fail(`Entrada/execucao controlada falhou (${context}, ${label}): ${JSON.stringify({ rightAck, ran, observed })}`);
      }
      return { rightAck: rightAck.value, observed: observed.value };
    };
    const readState = async (observed, context) => {
      const score = await readLogicInt("reference_score");
      const open = await readLogicInt("goal_open");
      const reached = await readLogicInt("goal_reached");
      return {
        context,
        score: score.value,
        scoreSymbol: score,
        passageOpen: open.value,
        passageOpenSymbol: open,
        objectiveReached: reached.value,
        objectiveSymbol: reached,
        framebuffer: framebufferStats(observed),
        frame: observed.frames_run,
      };
    };

    const baselineState = await readState(before.value, "boot");
    const expectedStartX = baselineState.framebuffer.playerPixelBounds?.x0;
    if (baselineState.score !== 0 || baselineState.passageOpen !== 0 || baselineState.objectiveReached !== 0 || !Number.isFinite(expectedStartX)) {
      fail(`Estado inicial/oráculo RAM inválido para ${label}: ${JSON.stringify(baselineState)}`);
    }

    const atEight = await runRightFrames(8, "mesma sequência de referência 8f");
    const eightState = await readState(atEight.observed, "same-input-8-frames");
    const expectedEightOpen = 8 >= threshold;
    if (eightState.score !== 8 || eightState.passageOpen !== Number(expectedEightOpen) ||
        (eightState.framebuffer.barrierPixels > 0) === expectedEightOpen || !eightState.framebuffer.playerPixelBounds) {
      fail(`Estado real score/passagem diverge após 8 frames para ${label}: ${JSON.stringify({ threshold, expectedEightOpen, eightState })}`);
    }

    // Fresh reset of this exact ROM: exercise threshold-1, threshold, threshold+1.
    const reset = await callAutomationApi(sessionId, "loadRomForEmulation", [romPath, { startPaused: true }]);
    if (reset !== true) fail(`Nao foi possivel reiniciar a mesma ROM para as fronteiras de ${label}.`);
    await waitFor(async () => {
      const state = await readAutomationState(sessionId);
      return state?.emulatorLoaded === true && state?.emulPaused === true ? state : false;
    }, 15000, `${label} nao reiniciou pausada para fronteiras`, 100);
    const boundaryEpoch = await invokeCore("emulator_get_core_epoch");
    if (!boundaryEpoch?.ok || !Number.isInteger(boundaryEpoch.value)) fail(`Epoch de fronteira ausente para ${label}`);
    const boundaryWarmup = await invokeCore("emulator_run_frames", { frames: 120 });
    const boundaryBoot = await invokeCore("emulator_observe");
    if (!boundaryWarmup?.ok || !boundaryWarmup.value?.ok || !boundaryBoot?.ok || !boundaryBoot.value?.ok) {
      fail(`Warmup das fronteiras falhou em ${label}`);
    }
    const boundaryRun = async (frames, context) => {
      const ack = await invokeCore("emulator_send_input", {
        joypad: { ...neutralGoalInput, right: true },
        sessionEpoch: boundaryEpoch.value,
      });
      const run = await invokeCore("emulator_run_frames", { frames });
      const obs = await invokeCore("emulator_observe");
      if (!ack?.ok || !ack.value?.ok || !run?.ok || !run.value?.ok || !obs?.ok || !obs.value?.ok) {
        fail(`Execucao de fronteira ${context} falhou em ${label}`);
      }
      return readState(obs.value, context);
    };
    const captureBoundaryState = async (artifactName, description) => {
      const released = await invokeCore("emulator_send_input", {
        joypad: neutralGoalInput,
        sessionEpoch: boundaryEpoch.value,
      });
      if (!released?.ok || !released.value?.ok) fail(`Input neutro falhou antes da captura ${description}`);
      const frame = await renderPausedState(description);
      const artifact = await captureScreenshot(sessionId, `${artifactPrefix}-${artifactName}.png`);
      addReportArtifact(report, artifact, description);
      return {
        path: artifact.path,
        sha256: artifact.sha256,
        framebufferSha256: frame?.framebufferSha256 ?? null,
        romSha256: frame?.romSha256 ?? null,
      };
    };
    const below = await boundaryRun(threshold - 1, "threshold-minus-one");
    if (below.score !== threshold - 1 || below.passageOpen !== 0 || below.framebuffer.barrierPixels === 0 ||
        below.framebuffer.playerPixelBounds?.x0 === expectedStartX) {
      fail(`Fronteira abaixo nao ficou bloqueada no estado real (${label}): ${JSON.stringify({ expectedStartX, below })}`);
    }
    const blockedScreenshot = await captureBoundaryState(`${screenshotLabel}-blocked-before-open`, `${label}: personagem bloqueado pela passagem fechada`);
    const equal = await boundaryRun(1, "threshold-equal");
    if (equal.score !== threshold || equal.passageOpen !== 1 ||
        equal.framebuffer.playerPixelBounds?.x0 !== below.framebuffer.playerPixelBounds?.x0) {
      fail(`Limiar exato nao abriu sem movimento extra no mesmo frame (${label}): ${JSON.stringify({ below, equal })}`);
    }
    const above = await boundaryRun(1, "threshold-plus-one");
    if (above.score !== threshold + 1 || above.passageOpen !== 1 || above.framebuffer.barrierPixels !== 0) {
      fail(`Fronteira acima divergiu (${label}): ${JSON.stringify({ equal, above })}`);
    }
    const openScreenshot = await captureBoundaryState(`${screenshotLabel}-open-at-threshold`, `${label}: passagem aberta no limiar, antes da travessia`);
    const transit = await boundaryRun(8, "traverse-open-passage");
    if (transit.score !== threshold + 9 || transit.passageOpen !== 1 ||
        transit.framebuffer.playerPixelBounds?.x0 <= 50 || transit.framebuffer.barrierPixels !== 0) {
      fail(`Passagem aberta nao foi atravessada pelo personagem (${label}): ${JSON.stringify(transit)}`);
    }
    const traversedScreenshot = await captureBoundaryState(`${screenshotLabel}-traversed`, `${label}: personagem atravessou a passagem`);
    const objective = await boundaryRun(60, "reach-objective-sensor");
    if (objective.objectiveReached !== 1) {
      fail(`Objetivo nao registrou conclusao no estado real (${label}): ${JSON.stringify(objective)}`);
    }
    const generatedMainPath = path.join(createdState.activeProjectDir, "build", "megadrive", "src", "main.c");
    const generatedMain = await readFile(generatedMainPath, "utf8");
    const soundCallOffset = generatedMain.indexOf("XGM_startPlayPCM(SFX_GOAL_SOUND");
    const goalSensorOffset = generatedMain.indexOf("if (retro_aabb_intersects(spr_player_x + 0, spr_player_y + 0, 14, 32, 144, 184, 16, 16))");
    const reachedGuardOffset = generatedMain.indexOf("if ((logic_var_goal_reached == 0))", goalSensorOffset);
    const reachedWriteOffset = generatedMain.indexOf("logic_var_goal_reached = 1;", reachedGuardOffset);
    if (goalSensorOffset < 0 || reachedGuardOffset < goalSensorOffset || soundCallOffset < reachedGuardOffset || reachedWriteOffset < soundCallOffset) {
      fail(`Evento do sensor deve despachar o som antes da escrita one-shot de conclusao (${label}): ${JSON.stringify({ goalSensorOffset, reachedGuardOffset, soundCallOffset, reachedWriteOffset })}.`);
    }
    if (!generatedMain.includes("XGM_startPlayPCM(SFX_GOAL_SOUND") ||
        !generatedMain.includes("logic_var_goal_reached == 0") ||
        !generatedMain.includes("logic_var_goal_reached = 1;")) {
      fail(`ROM não contém o evento de som e a condição de vitória conectados ao sensor (${label}).`);
    }
    const scoreIncrementOffset = generatedMain.indexOf("logic_var_reference_score = (logic_var_reference_score + 1);");
    const scoreCompareOffset = generatedMain.indexOf("if ((logic_var_reference_score >=", scoreIncrementOffset);
    if (scoreIncrementOffset < 0 || scoreCompareOffset < scoreIncrementOffset) {
      fail(`Comparacao do limiar nao usa o score gravado apos incrementar (${label}).`);
    }
    const testedRomSha256 = createHash("sha256").update(await readFile(romPath)).digest("hex");
    if (objective.framebuffer.romSha256 !== testedRomSha256) {
      fail(`O core observou outra ROM ao registrar o objetivo (${label}): ${JSON.stringify({ expected: testedRomSha256, observed: objective.framebuffer.romSha256 })}`);
    }
    const releaseAck = await invokeCore("emulator_send_input", {
      joypad: neutralGoalInput,
      sessionEpoch: boundaryEpoch.value,
    });
    if (!releaseAck?.ok || !releaseAck.value?.ok) fail(`Release input falhou para ${label}`);
    const afterVisual = await renderPausedState(`${label} depois da passagem e objetivo`);
    const beforeFrame = await readCanonicalGameFrame(sessionId, { includePixels: true });
    addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-${screenshotLabel}.png`), `${label} passagem atravessada e objetivo alcançado`);
    return {
      label,
      romPath,
      testedRomSha256,
      generatedMainSha256: createHash("sha256").update(generatedMain).digest("hex"),
      generatedMainPath,
      goalSoundAndWinCode: {
        soundCall: "XGM_startPlayPCM(SFX_GOAL_SOUND, ...) emitted from goal sensor event chain",
        persistentWinCondition: "logic_var_goal_reached transitions 0→1 after sensor overlap",
        eventOrderObservedWithRuntimeWinFlag: true,
      },
      scoreComparison: {
        incrementSource: "logic_var_reference_score = (logic_var_reference_score + 1);",
        compareSource: "if ((logic_var_reference_score >= threshold))",
        comparesStoredPostIncrementValue: true,
        independentlyObservedScore: eightState.score,
      },
      threshold,
      inputSequences: {
        sameSequenceAcrossRoms: [{ right: true, frames: 8 }],
        boundaryAndTraversal: [
          { right: true, frames: threshold - 1, expectedScore: threshold - 1, expectedOpen: false },
          { right: true, frames: 1, expectedScore: threshold, expectedOpen: true },
          { right: true, frames: 1, expectedScore: threshold + 1, expectedOpen: true },
          { right: true, frames: 8, expectedToPassBarrierX: 50 },
          { right: true, frames: 60, expectedObjectiveReached: true },
        ],
      },
      sameEightFrameObservation: eightState,
      boundaries: { below, equal, above },
      blockedBeforeOpen: below.framebuffer.playerPixelBounds,
      atThresholdBeforeMove: equal.framebuffer.playerPixelBounds,
      traversedAfterOpen: transit.framebuffer.playerPixelBounds,
      reachedObjective: objective,
      screenshots: { blockedScreenshot, openScreenshot, traversedScreenshot },
      screenshotFramebuffer: {
        sha256: afterVisual?.framebufferSha256 ?? null,
        romSha256: afterVisual?.romSha256 ?? null,
      },
      domFrame: beforeFrame ? {
        renderedFrames: beforeFrame.renderedFrames,
        framebufferSha256: beforeFrame.framebufferSha256,
        romSha256: beforeFrame.romSha256,
      } : null,
      initialState: baselineState,
    };
  };
  const baselineGoalRomPath = path.join(validationDir, `${artifactPrefix}-goal-original.rom`);
  await cp(firstBuild.rom_path, baselineGoalRomPath);
  if (report.roms[0]) report.roms[0].rom_path = baselineGoalRomPath;
  addReportArtifact(report, baselineGoalRomPath, "ROM baseline copied for controlled gameplay decision");
  const goalBeforeEdit = await runGoalDecision(baselineGoalRomPath, "ROM gerada antes da edicao", 6, true, "04-goal-open-before-edit");
  report.goalDecision.beforeEdit = goalBeforeEdit;
  addReportStep(report, "execute_authored_goal_threshold_before_edit", "passed", goalBeforeEdit);

  await clickByTestId(sessionId, "workspace-rail-logic");
  await waitFor(
    async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"node-param-score_threshold-b\"]'));"),
    15000,
    "Editor nao expos o limiar autoral de score com source mapping.",
    250
  );
  const thresholdInput = await executeScript(sessionId, "return document.querySelector('[data-testid=\"node-param-score_threshold-b\"]')?.value ?? null;");
  const thresholdLabel = await executeScript(sessionId, "return document.querySelector('[data-testid=\"node-param-score_threshold-b\"]')?.parentElement?.querySelector('span')?.textContent ?? '';" );
  const sourceMappingVisible = await executeScript(sessionId, "return document.querySelector('[data-testid=\"node-card-score_threshold\"]')?.textContent ?? '';" );
  if (thresholdInput !== "6" || thresholdLabel !== "Pontos para abrir passagem" || !String(sourceMappingVisible).includes("Source mapped") || !String(sourceMappingVisible).includes("authored_builtin_reference_platformer")) {
    fail(`Editor nao comprovou semantica do limiar/origem/source mapping autorais: ${JSON.stringify({ thresholdInput, thresholdLabel, sourceMappingVisible })}`);
  }
  await setInputByTestIdNative(sessionId, "node-param-score_threshold-b", "12");
  const editedThreshold = await executeScript(sessionId, "return document.querySelector('[data-testid=\"node-param-score_threshold-b\"]')?.value ?? null;");
  if (editedThreshold !== "12") fail(`Editor nao aplicou o limiar editado: ${editedThreshold}`);
  addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-05-authored-threshold-editor.png`), "editor com limiar autoral, semantica e source mapping");
  await waitFor(
    async () => {
      const logic = await callAutomationApi(sessionId, "getEntityLogicState", ["player"]);
      try {
        const graphs = [logic?.source?.graph_json, logic?.resolved?.graph_json]
          .filter((value) => typeof value === "string")
          .map((value) => JSON.parse(value));
        return graphs.some((graph) => Number(graph.nodes?.find((node) => node.id === "score_threshold")?.params?.b) === 12) ? logic : false;
      } catch {
        return false;
      }
    },
    15000,
    "Autosave do NodeGraph nao persistiu o limiar 12 antes do Save.",
    250
  );
  await clickTopBarMenuAction(sessionId, "Salvar");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      return (state?.consoleEntries ?? []).some((entry) => String(entry.message ?? "").includes("Cena salva no projeto ativo.")) ? state : false;
    },
    15000,
    "Salvar nao confirmou o limiar de gameplay editado.",
    250
  );
  await clickTopBarMenuAction(sessionId, "Fechar");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const wizardVisible = await executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"project-wizard-body\"]'));" );
      return !state?.activeProjectDir && wizardVisible ? true : false;
    },
    15000,
    "Projeto nao reiniciou para validar salvar/reabrir do limiar.",
    250
  );
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', generatedProjectName);
  await waitFor(
    async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"wizard-existing-project-card\"]'));"),
    30000,
    "Wizard nao reabriu o projeto salvo com limiar editado.",
    500
  );
  await clickByTestId(sessionId, "wizard-open-existing-project");
  const reopenedGoalState = await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      return state?.activeProjectDir === createdState.activeProjectDir ? state : false;
    },
    45000,
    "Projeto nao reabriu apos edicao do limiar.",
    500
  );
  await clickByTestId(sessionId, "hierarchy-entity-player");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      return state?.selectedEntityId === "player" ? state : false;
    },
    10000,
    "Player nao foi reselecionado antes da reabertura do NodeGraph.",
    250
  );
  await clickByTestId(sessionId, "workspace-rail-logic");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const inputValue = await executeScript(sessionId, "return document.querySelector('[data-testid=\"node-param-score_threshold-b\"]')?.value ?? null;");
      return state?.activeWorkspace === "logic" && inputValue === "12" ? { state, inputValue } : false;
    },
    15000,
    "Limiar 12 nao persistiu/reabriu pela interface.",
    250
  );
  const reopenedGoalMapping = await executeScript(sessionId, "return document.querySelector('[data-testid=\"node-card-score_threshold\"]')?.textContent ?? '';" );
  if (!String(reopenedGoalMapping).includes("Source mapped") || !String(reopenedGoalMapping).includes("authored_builtin_reference_platformer")) {
    fail(`Source mapping/origem autoral nao persistiu na reabertura: ${reopenedGoalMapping}`);
  }
  const editedBuild = await runBuildRunAndCollect(
    sessionId,
    "reference platformer edited goal threshold build",
    timeoutMs,
    report,
    artifactPrefix
  );
  const editedGoalRomPath = path.join(validationDir, `${artifactPrefix}-goal-edited.rom`);
  await cp(editedBuild.rom_path, editedGoalRomPath);
  addReportArtifact(report, editedGoalRomPath, "immutable ROM snapshot compiled from the saved threshold=12 graph");
  report.roms.push({ ...editedBuild, rom_path: editedGoalRomPath });
  const editedMainPath = path.join(createdState.activeProjectDir, "build", "megadrive", "src", "main.c");
  const editedMain = await readFile(editedMainPath, "utf8");
  const editedMainEvidencePath = path.join(validationDir, `${artifactPrefix}-edited-goal-main.c`);
  await cp(editedMainPath, editedMainEvidencePath);
  addReportArtifact(report, editedMainEvidencePath, "generated main.c with edited goal threshold");
  const editedLogicVariableLayout = logicVariableLayout(editedMain);
  const editedScoreComparePresent = /logic_var_reference_score\s*>=\s*12/.test(editedMain);
  const scoreDeclaration = editedMain.includes("static volatile s32 logic_var_reference_score = 0;");
  if (!scoreDeclaration ||
      !editedScoreComparePresent ||
      !editedMain.includes("logic_var_goal_reached = 1;") ||
      JSON.stringify(editedLogicVariableLayout) !== JSON.stringify(initialLogicVariableLayout)) {
    fail(`C gerado após salvar/reabrir não preserva os estados e o limiar 12 esperados: ${JSON.stringify({ scoreDeclaration, scoreComparePresent: editedScoreComparePresent, winWrite: editedMain.includes("logic_var_goal_reached = 1;"), initialLogicVariableLayout, editedLogicVariableLayout })}`);
  }
  const goalAfterEdit = await runGoalDecision(editedGoalRomPath, "ROM gerada apos edicao", 12, false, "06-goal-closed-after-edit");
  report.goalDecision.afterEdit = goalAfterEdit;
  report.goalDecision.sameSequence = true;
  report.goalDecision.authorship = "score chain and threshold authored in graphs/reference_platformer_logic.json";
  report.goalDecision.recoveryBoundary = "branch-compare remains assisted ROM recovery and is exercised separately";
  addReportStep(report, "persist_reopen_compile_and_execute_edited_goal_threshold", "passed", {
    reopened: {
      projectDir: reopenedGoalState?.activeProjectDir ?? createdState.activeProjectDir,
      threshold: 12,
      sourceMapping: await (async () => {
        // The graph is saved one node per line; the mapping must name the real line.
        const graphLines = (await readFile(path.join(createdState.activeProjectDir, "graphs", "reference_platformer_logic.json"), "utf8")).split(/\r?\n/);
        const lineIndex = graphLines.findIndex((line) => line.includes('"id":"score_threshold"'));
        const declared = lineIndex >= 0 ? JSON.parse(graphLines[lineIndex].trim().replace(/,$/, "")).params?.source_line : null;
        if (lineIndex < 0 || declared !== lineIndex + 1) {
          fail(`source_line do limiar nao aponta para a linha real do grafo: ${JSON.stringify({ lineIndex, declared })}`);
        }
        return `graphs/reference_platformer_logic.json:${declared}`;
      })(),
    },
    originalRom: { path: baselineGoalRomPath, sha256: goalBeforeEdit.testedRomSha256 },
    editedRom: { path: editedGoalRomPath, sha256: goalAfterEdit.testedRomSha256 },
    goalBeforeEdit,
    goalAfterEdit,
    generatedMainSha256: createHash("sha256").update(editedMain).digest("hex"),
  });

  await clickByTestId(sessionId, "workspace-rail-scene");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      return state?.activeWorkspace === "scene" &&
        state?.activeViewportTab === "scene" &&
        Boolean(state?.activeScene?.entities?.some((entity) => entity.id === "reference_tilemap"))
        ? state
        : false;
    },
    15000,
    "Scene workspace nao reabriu para a autoria de tilemap da referencia.",
    250
  );
  await closeVisibleConsoleDrawer(sessionId, "antes da autoria de tilemap");
  await clickButtonByTestIdNative(
    sessionId,
    "hierarchy-tilemap-edit-reference_tilemap",
    "abrir autoria do tilemap da referencia"
  );
  await waitFor(
    async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"viewport-tile-paint-flow-strip\"]'));"),
    15000,
    "Fluxo de pintura do tilemap nao ficou visivel.",
    250
  );
  const tilemapBefore = await readAutomationState(sessionId);
  const tilemapBeforeEntity = tilemapBefore?.activeScene?.entities?.find((entity) => entity.id === "reference_tilemap");
  const tilemapBeforeCells = tilemapBeforeEntity?.tilemap?.cells ?? [];
  const tilemapWidth = Number(tilemapBeforeEntity?.tilemap?.mapWidth ?? 40);
  const tilemapHeight = Number(tilemapBeforeEntity?.tilemap?.mapHeight ?? 28);
  const tilemapTileWidth = Number(tilemapBeforeEntity?.tilemap?.tileWidth ?? 8);
  const tilemapTileHeight = Number(tilemapBeforeEntity?.tilemap?.tileHeight ?? 8);
  const tilemapCell = { col: 1, row: 25 };
  const tilemapCellIndex = tilemapCell.row * tilemapWidth + tilemapCell.col;
  const tilemapOriginalValue = Number(tilemapBeforeCells[tilemapCellIndex] ?? 0);
  const tilemapCollisionBefore = Number(tilemapBefore?.activeScene?.collisionSolidCount ?? 0);
  await clickByTestId(sessionId, "tile-palette-2");
  const worldBounds = tilemapBefore?.activeScene?.worldBounds;
  const tilemapEntity = tilemapBefore?.activeScene?.entities?.find((entity) => entity.id === "reference_tilemap");
  const targetWorldX = Number(tilemapEntity?.x ?? 0) + tilemapCell.col * tilemapTileWidth + tilemapTileWidth / 2;
  const targetWorldY = Number(tilemapEntity?.y ?? 0) + tilemapCell.row * tilemapTileHeight + tilemapTileHeight / 2;
  const normalizedX = (targetWorldX - Number(worldBounds?.minX ?? 0)) /
    Math.max(1, Number(worldBounds?.maxX ?? 320) - Number(worldBounds?.minX ?? 0));
  const normalizedY = (targetWorldY - Number(worldBounds?.minY ?? 0)) /
    Math.max(1, Number(worldBounds?.maxY ?? 224) - Number(worldBounds?.minY ?? 0));
  await clickCanvasPointNatively(
    sessionId,
    "[data-testid='viewport-scene-overlay']",
    normalizedX,
    normalizedY,
    "pintar uma celula do tilemap"
  );
  const paintedState = await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const entity = state?.activeScene?.entities?.find((candidate) => candidate.id === "reference_tilemap");
      return Number(entity?.tilemap?.cells?.[tilemapCellIndex]) === 2 ? state : false;
    },
    10000,
    "Pintura do tilemap nao persistiu no draft ativo.",
    100
  );
  const paintedCollision = Number(paintedState?.activeScene?.collisionSolidCount ?? 0);
  if (paintedCollision !== tilemapCollisionBefore) {
    fail(`Pintura visual alterou indevidamente a colisao separada: ${JSON.stringify({ tilemapCollisionBefore, paintedCollision })}`);
  }
  await pressKey(sessionId, "z", { code: "KeyZ", ctrlKey: true });
  const undoneState = await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const entity = state?.activeScene?.entities?.find((candidate) => candidate.id === "reference_tilemap");
      return Number(entity?.tilemap?.cells?.[tilemapCellIndex] ?? 0) === tilemapOriginalValue ? state : false;
    },
    10000,
    "Undo nao restaurou a celula original do tilemap.",
    100
  );
  await pressKey(sessionId, "y", { code: "KeyY", ctrlKey: true });
  const redoneState = await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const entity = state?.activeScene?.entities?.find((candidate) => candidate.id === "reference_tilemap");
      return Number(entity?.tilemap?.cells?.[tilemapCellIndex]) === 2 ? state : false;
    },
    10000,
    "Redo nao reaplicou a celula pintada do tilemap.",
    100
  );
  const savesBeforeTilemapAuthoring = (redoneState?.consoleEntries ?? []).filter((entry) =>
    String(entry.message ?? "").includes("Cena salva no projeto ativo.")
  ).length;
  await clickTopBarMenuAction(sessionId, "Salvar");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const savesAfterTilemapAuthoring = (state?.consoleEntries ?? []).filter((entry) =>
        String(entry.message ?? "").includes("Cena salva no projeto ativo.")
      ).length;
      return savesAfterTilemapAuthoring > savesBeforeTilemapAuthoring
        ? state
        : false;
    },
    15000,
    "Salvar nao confirmou a autoria do tilemap.",
    250
  );
  const savedSceneJson = JSON.parse(
    await readFile(path.join(createdState.activeProjectDir, "scenes", "main.json"), "utf8")
  );
  const savedTilemap = savedSceneJson.entities?.find((entity) => entity.entity_id === "reference_tilemap");
  const savedTileValue = Number(savedTilemap?.components?.tilemap?.cells?.[tilemapCellIndex] ?? 0);
  if (savedTileValue !== 2) {
    fail(`Arquivo de cena nao recebeu a celula pintada: ${JSON.stringify({ cellIndex: tilemapCellIndex, expected: 2, actual: savedTileValue })}`);
  }
  addReportStep(report, "paint_tilemap_undo_redo_and_preserve_collision", "passed", {
    cell: tilemapCell,
    cellIndex: tilemapCellIndex,
    originalValue: tilemapOriginalValue,
    paintedValue: 2,
    undoValue: undoneState?.activeScene?.entities?.find((entity) => entity.id === "reference_tilemap")?.tilemap?.cells?.[tilemapCellIndex] ?? tilemapOriginalValue,
    redoValue: redoneState?.activeScene?.entities?.find((entity) => entity.id === "reference_tilemap")?.tilemap?.cells?.[tilemapCellIndex] ?? 2,
    collisionSolidCount: tilemapCollisionBefore,
    normalizedPoint: { x: normalizedX, y: normalizedY },
  });
  report.tilemapAuthoring = {
    cell: tilemapCell,
    cellIndex: tilemapCellIndex,
    originalValue: tilemapOriginalValue,
    paintedValue: 2,
    collisionSolidCount: tilemapCollisionBefore,
  };
  await clickByTestId(sessionId, "workspace-rail-game");
  await waitFor(
    async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"viewport-game-canvas\"]'));"),
    15000,
    "Game View nao voltou apos a autoria do tilemap.",
    250
  );
  const paintedBuild = await runBuildRunAndCollect(
    sessionId,
    "reference platformer tilemap-authored build",
    timeoutMs,
    report,
    artifactPrefix
  );
  report.roms.push(paintedBuild);
  report.frames.push({ label: paintedBuild.label, ...paintedBuild.framebuffer });
  const paintedMainEvidencePath = path.join(
    validationDir,
    `${artifactPrefix}-painted-main.c`
  );
  const paintedMainSourcePath = path.join(
    createdState.activeProjectDir,
    "build",
    "megadrive",
    "src",
    "main.c"
  );
  if (await pathExists(paintedMainSourcePath)) {
    await cp(paintedMainSourcePath, paintedMainEvidencePath);
    addReportArtifact(report, paintedMainEvidencePath, "painted generated main.c");
  }
  if (paintedBuild.framebuffer.tilemap_cell_hash === firstBuild.framebuffer.tilemap_cell_hash) {
    fail(`Build apos pintura nao alterou o framebuffer inicial: ${JSON.stringify({ initial: firstBuild.framebuffer, painted: paintedBuild.framebuffer })}`);
  }
  addReportStep(report, "build_tilemap_authored_rom_and_observe_change", "passed", {
    initial: firstBuild.framebuffer,
    painted: paintedBuild.framebuffer,
  });

  await closeVisibleConsoleDrawer(sessionId, "reference platformer movement input");
  await focusGameCanvasNatively(sessionId);
  const beforeControls = await readCanonicalGameFrame(sessionId, { includePixels: true });
  // Symbols of the ROM currently running (the tilemap-authored rebuild overwrote rom.out).
  const jumpSymbols = parseElf32Symbols(await readFile(elfPath));
  const readPlayerS16 = async (name) => {
    const address = jumpSymbols.get(name);
    if (!Number.isInteger(address) || ![0x00ff, 0xe0ff].includes(address >>> 16)) {
      fail(`Simbolo ${name} ausente ou fora da System RAM: ${address}`);
    }
    const memory = await invokeCore("emulator_read_memory", { region: 2, offset: address & 0xffff, length: 2 });
    if (!memory?.ok || !memory.value?.data || memory.value.data.length < 2) {
      fail(`Leitura da System RAM para ${name} falhou: ${JSON.stringify(memory)}`);
    }
    const word = memory.value.data[0] | (memory.value.data[1] << 8);
    return word > 0x7fff ? word - 0x10000 : word;
  };
  const waitNativeAck = async (button, expected, context) => {
    let lastObservation = null;
    try {
      return await waitFor(
        async () => {
          lastObservation = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
          return lastObservation?.lastJoypadAck?.joypad?.[button] === expected ? lastObservation : false;
        },
        3000,
        `${context}: ACK nativo (${button}=${expected}) nao observado`,
        50
      );
    } catch (error) {
      fail(`${context}: ACK nativo (${button}=${expected}) nao observado; falha do caminho de input, sem fallback no core. Observacao: ${JSON.stringify(lastObservation)}`);
    }
  };
  const movementStartX = await readPlayerS16("spr_player_x");
  await sendNativeGameKey(sessionId, "ArrowRight", "keyDown", "reference movement");
  const rightAck = await waitNativeAck("right", true, "movimento");
  const movementFrame = await waitFor(
    async () => {
      const frame = await readCanonicalGameFrame(sessionId, { includePixels: true });
      return frame && frame.renderedFrames > beforeControls.renderedFrames + 30 ? frame : false;
    },
    20000,
    "Movimento do template de referencia nao avancou frames.",
    100
  );
  await sendNativeGameKey(sessionId, "ArrowRight", "keyUp", "reference movement release");
  const rightReleaseAck = await waitNativeAck("right", false, "liberacao do movimento");
  const movementEndX = await readPlayerS16("spr_player_x");
  const movementDiffPixels = beforeControls.rgba.reduce(
    (count, value, index) => count + (value === movementFrame.rgba[index] ? 0 : 1),
    0
  );
  if (movementEndX <= movementStartX || movementDiffPixels === 0) {
    fail(`ArrowRight nativo nao moveu o personagem na RAM/tela: ${JSON.stringify({ movementStartX, movementEndX, movementDiffPixels })}`);
  }
  addReportStep(report, "movement_native_input_ram", "passed", {
    startX: movementStartX,
    endX: movementEndX,
    diffPixels: movementDiffPixels,
    ack: rightAck?.lastJoypadAck ?? null,
    releaseAck: rightReleaseAck?.lastJoypadAck ?? null,
  });

  // Mandatory jump contract: native KeyZ through the real keyboard path (no core fallback),
  // with the player's Y read from its ELF symbol in System RAM: rise, apex, fall, landing.
  // Genesis Plus GX binds RetroPad Y to Mega Drive A, so the ACK must carry joypad.y.
  // The WebView frame loop is too slow under WebDriver for real-time sampling, so the game
  // is paused and advanced with emulator_run_frames. The key state still travels the real
  // keyboard path (native key → frontend → ACK'd emulator_send_input → core joypad).
  await clickButtonByTestIdNative(sessionId, "viewport-pause", "pausar para salto deterministico");
  await waitFor(async () => (await readAutomationState(sessionId))?.emulPaused === true, 10000, "Jogo nao pausou para o salto.", 100);
  const stepFrames = async (label, frames) => {
    const samples = [];
    for (let frame = 0; frame < frames; frame += 1) {
      const ran = await invokeCore("emulator_run_frames", { frames: 1 });
      if (!ran?.ok || !ran.value?.ok) fail(`emulator_run_frames falhou no salto: ${JSON.stringify(ran)}`);
      samples.push({ label, frame, y: await readPlayerS16("spr_player_y") });
    }
    return samples;
  };
  const waitJoypadY = (expected, context) => waitNativeAck("y", expected, `${context} (KeyZ = RetroPad Y = Mega Drive A)`);
  const groundSamples = await stepFrames("ground", 20);
  const groundY = groundSamples[groundSamples.length - 1].y;
  if (!groundSamples.every((sample) => sample.y === groundY)) {
    fail(`Personagem nao estava parado no chao antes do salto: ${JSON.stringify(groundSamples)}`);
  }
  await focusGameCanvasNatively(sessionId);
  await sendNativeGameKey(sessionId, "KeyZ", "keyDown", "reference jump");
  const jumpAck = await waitJoypadY(true, "salto");
  const pressSamples = await stepFrames("pressed", 3);
  await sendNativeGameKey(sessionId, "KeyZ", "keyUp", "reference jump release");
  const jumpReleaseAck = await waitJoypadY(false, "liberacao do salto");
  const jumpSamples = [...pressSamples, ...(await stepFrames("released", 60))];
  const apexIndex = jumpSamples.reduce((best, sample, index) => (sample.y < jumpSamples[best].y ? index : best), 0);
  const apexY = jumpSamples[apexIndex].y;
  const fellAfterApex = jumpSamples.slice(apexIndex).some((sample) => sample.y > apexY);
  const landedY = jumpSamples[jumpSamples.length - 1].y;
  const jumpTrajectory = { groundY, apexY, lift: groundY - apexY, fellAfterApex, landedY, samples: jumpSamples };
  if (groundY - apexY < 4 || !fellAfterApex || landedY !== groundY) {
    await writeFile(path.join(validationDir, `${artifactPrefix}-jump-trajectory.json`), JSON.stringify(jumpTrajectory, null, 2));
    fail(`Salto por KeyZ nativo nao comprovou subida, queda e retorno ao chao: ${JSON.stringify({ groundY, apexY, fellAfterApex, landedY })}`);
  }
  // Negative: holding the key must not keep the player airborne (edge-triggered input_pressed).
  await sendNativeGameKey(sessionId, "KeyZ", "keyDown", "reference jump hold");
  await waitJoypadY(true, "salto segurado");
  const heldSamples = await stepFrames("held", 60);
  await sendNativeGameKey(sessionId, "KeyZ", "keyUp", "reference jump hold release");
  await waitJoypadY(false, "liberacao do salto segurado");
  const heldLanded = heldSamples[heldSamples.length - 1].y;
  const heldLifted = heldSamples.some((sample) => sample.y < groundY);
  if (heldLanded !== groundY || !heldLifted) {
    fail(`Segurar KeyZ deveria saltar uma vez e pousar ainda segurado: ${JSON.stringify({ groundY, heldLanded, heldLifted, heldSamples })}`);
  }
  await clickButtonByTestIdNative(sessionId, "viewport-resume", "retomar apos salto");
  const jumpTrajectoryPath = path.join(validationDir, `${artifactPrefix}-jump-trajectory.json`);
  await writeFile(jumpTrajectoryPath, JSON.stringify({ ...jumpTrajectory, held: { landedY: heldLanded, lifted: heldLifted, samples: heldSamples } }, null, 2));
  addReportArtifact(report, jumpTrajectoryPath, "native KeyZ jump trajectory from RAM");
  addReportStep(report, "jump_native_input_ram_trajectory", "passed", {
    groundY,
    apexY,
    lift: groundY - apexY,
    fellAfterApex,
    landedY,
    heldLandedWhileHeld: heldLanded,
    ack: jumpAck?.lastJoypadAck ?? null,
    releaseAck: jumpReleaseAck?.lastJoypadAck ?? null,
    trajectory: jumpTrajectoryPath,
  });
  const jumpFrame = await readCanonicalGameFrame(sessionId, { includePixels: true });

  // The generated template VGM ends after half a second. Trigger a fresh jump SFX
  // through the native keyboard so forwarding is observed while the source is active.
  // Acoustic/loopback remains a separate best-effort measurement.
  const audioBefore = await executeScript(sessionId, "return window.__RDS_E2E__?.getAudioOutputTelemetry?.() ?? null;");
  await sendNativeGameKey(sessionId, "KeyZ", "keyDown", "reference audio jump");
  const audioJumpAck = await waitJoypadY(true, "salto para audio");
  let audioAfter;
  try {
    audioAfter = await waitFor(async () => {
      const telemetry = await executeScript(sessionId, "return window.__RDS_E2E__?.getAudioOutputTelemetry?.() ?? null;");
      return telemetry?.receivedNonZeroFrames > audioBefore?.receivedNonZeroFrames && telemetry?.renderedNonZeroFrames > audioBefore?.renderedNonZeroFrames ? telemetry : false;
    }, 20000, "SFX de salto nao chegou ao AudioContext", 100);
  } finally {
    await sendNativeGameKey(sessionId, "KeyZ", "keyUp", "reference audio jump release");
    await waitJoypadY(false, "liberacao do salto para audio");
  }
  const forwarded = audioBefore && audioAfter ? {
    receivedNonZeroFrames: audioAfter.receivedNonZeroFrames - audioBefore.receivedNonZeroFrames,
    renderedFrames: audioAfter.renderedFrames - audioBefore.renderedFrames,
    renderedNonZeroFrames: audioAfter.renderedNonZeroFrames - audioBefore.renderedNonZeroFrames,
    renderedPeak: audioAfter.renderedPeak,
    contextState: audioAfter.contextState,
    contextSampleRate: audioAfter.contextSampleRate,
    muted: audioAfter.muted,
  } : null;
  if (!forwarded || forwarded.receivedNonZeroFrames <= 0 || forwarded.renderedNonZeroFrames <= 0 || forwarded.contextState !== "running") {
    fail(`Audio do core nao foi encaminhado ao AudioContext em execucao: ${JSON.stringify({ audioBefore, audioAfter, audioJumpAck })}`);
  }
  await waitFor(async () => (await readPlayerS16("spr_player_y")) === groundY, 10000, "Personagem nao pousou apos salto de audio", 100);
  const loopback = await new Promise((resolve) => {
    let child;
    try {
      child = spawn("parec", ["-d", "@DEFAULT_MONITOR@", "--format=s16le", "--channels=1", "--rate=22050"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ status: "unavailable", reason: String(error) });
      return;
    }
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (error) => resolve({ status: "unavailable", reason: String(error) }));
    setTimeout(() => {
      child.kill("SIGTERM");
      const pcm = Buffer.concat(chunks);
      let peak = 0;
      let nonZero = 0;
      for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
        const value = Math.abs(pcm.readInt16LE(offset));
        if (value > 0) nonZero += 1;
        if (value > peak) peak = value;
      }
      resolve({ status: pcm.length === 0 ? "unavailable" : nonZero > 0 ? "observed" : "silent", samples: pcm.length / 2, nonZero, peak, source: "@DEFAULT_MONITOR@" });
    }, 1500);
  });
  addReportStep(report, "audio_forwarded_to_output", "passed", {
    forwarded,
    loopback,
    note: "loopback captures the whole default sink (other apps included); it is informative, not an assertion",
  });

  await closeVisibleConsoleDrawer(sessionId, "reference platformer gameplay");
  await clickButtonByTestIdNative(sessionId, "viewport-pause", "pausar reference platformer");
  await waitFor(
    async () => executeScript(sessionId, "return /paus/i.test(document.querySelector('[data-testid=\"viewport-game-status\"]')?.textContent ?? '')"),
    10000,
    "Pausa nao ficou visivel na Game View da referencia.",
    100
  );
  const paused = await readCanonicalGameProgress(sessionId);
  await clickButtonByTestIdNative(sessionId, "viewport-resume", "retomar reference platformer");
  const resumed = await waitFor(
    async () => {
      const progress = await readCanonicalGameProgress(sessionId);
      return progress && progress.renderedFrames > paused.renderedFrames + 5 ? progress : false;
    },
    10000,
    "Retomada nao avancou frames na Game View da referencia.",
    100
  );
  report.input = {
    before: { frame: beforeControls.renderedFrames, sha256: beforeControls.framebufferSha256 },
    movement: { frame: movementFrame.renderedFrames, sha256: movementFrame.framebufferSha256, diffBytes: movementDiffPixels, startX: movementStartX, endX: movementEndX, ack: rightAck?.lastJoypadAck ?? null, releaseAck: rightReleaseAck?.lastJoypadAck ?? null },
    jump: { frame: jumpFrame.renderedFrames, sha256: jumpFrame.framebufferSha256, ack: jumpAck?.lastJoypadAck ?? null, releaseAck: jumpReleaseAck?.lastJoypadAck ?? null, groundY, apexY, landedY },
    pause: { paused, resumed },
  };
  report.frames.push({ label: "movement", width: movementFrame.width, height: movementFrame.height, non_black_pixels: movementFrame.nonBlackPixels, sha256: movementFrame.framebufferSha256 });
  report.frames.push({ label: "jump", width: jumpFrame.width, height: jumpFrame.height, non_black_pixels: jumpFrame.nonBlackPixels, sha256: jumpFrame.framebufferSha256 });
  addReportStep(report, "movement_pause_resume", "passed", {
    movement: report.input.movement,
    pause: report.input.pause,
  });
  addReportArtifact(
    report,
    await captureScreenshot(sessionId, `${artifactPrefix}-04-gameplay-controls.png`),
    "reference gameplay controls"
  );

  await clickTopBarMenuAction(sessionId, "Salvar");
  await clickTopBarMenuAction(sessionId, "Fechar");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const wizardVisible = await executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"project-wizard-body\"]'));" );
      return !state?.activeProjectDir && wizardVisible ? true : false;
    },
    15000,
    "Projeto de referencia nao fechou com retorno ao wizard.",
    250
  );
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', generatedProjectName);
  await waitFor(
    async () => {
      const card = await executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"wizard-existing-project-card\"]'));" );
      const pathText = await executeScript(sessionId, "return document.querySelector('[data-testid=\"wizard-existing-project-path\"]')?.textContent ?? '';" );
      return card && pathText.includes(createdState.activeProjectDir) ? true : false;
    },
    30000,
    "Wizard nao detectou o projeto de referencia salvo.",
    500
  );
  await clickByTestId(sessionId, "wizard-open-existing-project");
  let reopenedSceneDiagnostics = null;
  let reopenedState;
  try {
    reopenedState = await waitFor(
      async () => {
        const state = await readAutomationState(sessionId);
        const entities = Array.isArray(state?.activeScene?.entities) ? state.activeScene.entities : [];
        const entityIds = entities.map((entity) => entity.id ?? entity.entity_id ?? null);
        reopenedSceneDiagnostics = {
          activeProjectDir: state?.activeProjectDir ?? null,
          entityCount: entities.length,
          entityIds,
        };
        return state?.activeProjectDir === createdState.activeProjectDir &&
          entities.length === 6 &&
          ["passage_blocker", "goal_sensor", "goal"].every((id) => entityIds.includes(id))
          ? state
          : false;
      },
      45000,
      "Projeto de referencia nao reabriu com blocker, sensor, visual do objetivo e demais entidades.",
      500
    );
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; estado recebido: ${JSON.stringify(reopenedSceneDiagnostics)}`);
  }
  const reopenedLogicState = await callAutomationApi(sessionId, "getEntityLogicState", ["player"]);
  if (!reopenedLogicState?.resolved?.has_graph || reopenedLogicState.resolved.graph_ref !== "graphs/reference_platformer_logic.json") {
    fail(`NodeGraph do template nao persistiu apos reabertura: ${JSON.stringify(reopenedLogicState)}`);
  }
  const reopenedTilemap = reopenedState.activeScene.entities.find((entity) => entity.id === "reference_tilemap");
  const reopenedTileValue = Number(reopenedTilemap?.tilemap?.cells?.[tilemapCellIndex] ?? 0);
  if (reopenedTileValue !== 2) {
    fail(`Tilemap pintado nao persistiu apos reabertura: ${JSON.stringify({ cellIndex: tilemapCellIndex, expected: 2, actual: reopenedTileValue })}`);
  }
  report.persistence = {
    projectDir: createdState.activeProjectDir,
    entityIds: (reopenedState.activeScene.entities ?? []).map((entity) => entity.id ?? entity.entity_id),
    graphRef: reopenedLogicState.resolved.graph_ref,
    tilemapCell: tilemapCell,
    tilemapCellIndex,
    tilemapValue: reopenedTileValue,
  };
  addReportStep(report, "reopen_project_and_validate_persisted_graph", "passed", report.persistence);
  addReportArtifact(
    report,
    await captureScreenshot(sessionId, `${artifactPrefix}-05-reopened.png`),
    "reference project reopened"
  );

  await clickByTestId(sessionId, "workspace-rail-game");
  await waitFor(
    async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"viewport-game-canvas\"]'));"),
    15000,
    "Game View nao reabriu para a referencia.",
    250
  );
  const reopenedBuild = await runBuildRunAndCollect(
    sessionId,
    "reference platformer reopened build",
    timeoutMs,
    report,
    artifactPrefix
  );
  const reopenedPaintedFrame = await waitFor(
    async () => {
      const frame = await readFramebufferStats(sessionId);
      return frame?.tilemap_cell_hash === paintedBuild.framebuffer.tilemap_cell_hash ? frame : false;
    },
    15000,
    "ROM reaberta nao refletiu o tilemap persistido no framebuffer.",
    250
  );
  reopenedBuild.framebuffer = reopenedPaintedFrame;
  report.roms.push(reopenedBuild);
  report.frames.push({ label: reopenedBuild.label, ...reopenedBuild.framebuffer });
  addReportStep(report, "rebuild_and_run_after_reopen", "passed", {
    rom: reopenedBuild.rom_path,
    framebuffer: reopenedBuild.framebuffer,
  });
  addReportArtifact(
    report,
    await captureScreenshot(sessionId, `${artifactPrefix}-06-reopened-build-run.png`),
    "reference reopened build run"
  );

  // ── Second passage authored through the UI (Etapa 2) ──────────────────────────
  // Duplicate the blocker in the Inspector, place it at x=120, add a passage in the
  // NodeGraph "Passagens" panel with its own state and threshold 60, save, close, reopen,
  // build and measure on the core. Threshold 60 because the player only reaches the second
  // blocker around score ~41: a lower threshold would open before arrival and prove nothing.
  const selectOptionByTestIdNative = async (testId, value) => {
    const elementId = await findElement(sessionId, `[data-testid="${testId}"] option[value="${value}"]`);
    await webdriverRequest("POST", `/session/${sessionId}/element/${elementId}/click`, {});
    await waitFor(
      async () => (await executeScript(sessionId, `return document.querySelector('[data-testid="${testId}"]')?.value ?? null;`)) === value,
      5000,
      `Selecao ${testId}=${value} nao aplicada.`,
      100
    );
  };
  await clickByTestId(sessionId, "workspace-rail-scene");
  await clickByTestId(sessionId, "hierarchy-entity-passage_blocker");
  await waitFor(async () => (await readAutomationState(sessionId))?.selectedEntityId === "passage_blocker", 10000, "passage_blocker nao selecionado.", 200);
  await clickButtonByTestIdNative(sessionId, "inspector-duplicate-entity", "duplicar bloqueador");
  await waitFor(async () => (await readAutomationState(sessionId))?.selectedEntityId === "passage_blocker_2", 10000, "Duplicata do bloqueador nao foi criada/selecionada.", 200);
  await setInputByTestIdNative(sessionId, "inspector-transform-x", "120");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const entity = state?.activeScene?.entities?.find((candidate) => candidate.id === "passage_blocker_2");
      return entity?.x === 120 || entity?.transform?.x === 120 ? entity : false;
    },
    10000,
    "Inspector nao posicionou o segundo bloqueador em x=120.",
    200
  );
  // Etapa 3 in the same authoring session: erase the floor collision of a 2x2 region
  // (cols 10-11, rows 26-27), repaint its visual tiles as empty and set idle to 12 fps.
  // One-cell hole: with side walls a wider/deeper pit is a trap for the template jump.
  const pitCells = [[10, 26]];
  const sceneStateForPit = await readAutomationState(sessionId);
  const pitBounds = sceneStateForPit?.activeScene?.worldBounds;
  const cellPoint = (col, row) => ({
    x: ((col * 8 + 4) - Number(pitBounds?.minX ?? 0)) / Math.max(1, Number(pitBounds?.maxX ?? 320) - Number(pitBounds?.minX ?? 0)),
    y: ((row * 8 + 4) - Number(pitBounds?.minY ?? 0)) / Math.max(1, Number(pitBounds?.maxY ?? 224) - Number(pitBounds?.minY ?? 0)),
  });
  const solidBeforePit = Number(sceneStateForPit?.activeScene?.collisionSolidCount ?? 0);
  await clickButtonByTestIdNative(sessionId, "hierarchy-tilemap-edit-reference_tilemap", "abrir tilemap para o fosso");
  await waitFor(async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"viewport-tile-paint-flow-strip\"]'));"), 15000, "Pintura de tilemap indisponivel para o fosso.", 250);
  // Explicitly empty cell (distinct from 0 = base map).
  await clickByTestId(sessionId, "tile-palette-empty");
  for (const [col, row] of pitCells) {
    const point = cellPoint(col, row);
    await clickCanvasPointNatively(sessionId, "[data-testid='viewport-scene-overlay']", point.x, point.y, `apagar visual ${col},${row}`);
  }
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const cells = state?.activeScene?.entities?.find((candidate) => candidate.id === "reference_tilemap")?.tilemap?.cells ?? [];
      return pitCells.every(([col, row]) => Number(cells[row * 40 + col]) === 4294967295) ? true : false;
    },
    10000, "Visual do fosso nao foi pintado no tilemap.", 150
  );
  const collisionModeClicked = await executeScript(sessionId, "const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.trim() === 'Modo colisao'); if (b) { b.click(); return true; } return false;");
  if (!collisionModeClicked) {
    await focusGameCanvasNatively(sessionId).catch(() => {});
    await executeScript(sessionId, "document.querySelector('[data-testid=\"viewport-scene-overlay\"]')?.focus?.();");
    await sendNativeGameKey(sessionId, "KeyC", "keyDown", "modo colisao").catch(() => {});
  }
  for (const [col, row] of pitCells) {
    const point = cellPoint(col, row);
    await clickCanvasPointNatively(sessionId, "[data-testid='viewport-scene-overlay']", point.x, point.y, `apagar colisao ${col},${row}`, 2);
  }
  const solidAfterPit = await waitFor(
    async () => {
      const count = Number((await readAutomationState(sessionId))?.activeScene?.collisionSolidCount ?? 0);
      return count === solidBeforePit - pitCells.length ? count : false;
    },
    10000, `Colisao do fosso nao foi apagada pela UI (antes ${solidBeforePit}).`, 150
  );
  await clickByTestId(sessionId, "hierarchy-entity-player");
  await waitFor(async () => (await readAutomationState(sessionId))?.selectedEntityId === "player", 10000, "player nao selecionado para animacao.", 200);
  await waitFor(async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"inspector-anim-idle-fps\"]'));"), 10000, "Inspector nao expos FPS das animacoes.", 200);
  await setInputByTestIdNative(sessionId, "inspector-anim-idle-fps", "12");
  await waitFor(
    async () => {
      const logic = await readAutomationState(sessionId);
      return (await executeScript(sessionId, "return document.querySelector('[data-testid=\"inspector-anim-idle-fps\"]')?.value;")) === "12" ? logic : false;
    },
    10000, "FPS do idle nao aplicado.", 200
  );
  addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-07-pit-and-animation-edit.png`), "fosso e animacao editados");
  report.sceneAuthoring = { pitCells, solidBeforePit, solidAfterPit, idleFps: 12 };

  await clickByTestId(sessionId, "hierarchy-entity-player");
  await waitFor(async () => (await readAutomationState(sessionId))?.selectedEntityId === "player", 10000, "player nao selecionado.", 200);
  await clickByTestId(sessionId, "workspace-rail-logic");
  await waitFor(async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"nodegraph-passages\"]'));"), 15000, "Painel de passagens ausente no NodeGraph.", 250);
  await selectOptionByTestIdNative("passage-add-blocker", "passage_blocker_2");
  await setInputByTestIdNative(sessionId, "passage-add-threshold", "60");
  await clickButtonByTestIdNative(sessionId, "passage-add", "adicionar passagem");
  await waitFor(async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"passage-passage_2\"]'));"), 10000, `Passagem nao adicionada: ${await executeScript(sessionId, "return document.querySelector('[data-testid=\"passage-add-error\"]')?.textContent ?? null;")}`, 200);
  const passageIssues = await executeScript(sessionId, "return document.querySelector('[data-testid=\"passage-issues\"]')?.textContent ?? '';");
  if (passageIssues) fail(`Painel de passagens reportou problemas apos adicionar: ${passageIssues}`);
  addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-07-second-passage-panel.png`), "painel de passagens com segunda passagem");
  await waitFor(
    async () => {
      const logic = await callAutomationApi(sessionId, "getEntityLogicState", ["player"]);
      const graphs = [logic?.source?.graph_json, logic?.resolved?.graph_json].filter((value) => typeof value === "string");
      return graphs.some((json) => json.includes("passage_blocker_2") && json.includes("passage_2_open")) ? true : false;
    },
    15000,
    "Autosave nao persistiu a segunda passagem no grafo.",
    250
  );
  const countSaves = async () => ((await readAutomationState(sessionId))?.consoleEntries ?? []).filter((entry) => String(entry.message ?? "").includes("Cena salva no projeto ativo.")).length;
  const savesBefore = await countSaves();
  await clickTopBarMenuAction(sessionId, "Salvar");
  await waitFor(
    async () => (await countSaves()) > savesBefore,
    15000,
    `Salvar nao confirmou a segunda passagem: ${JSON.stringify(((await readAutomationState(sessionId))?.consoleEntries ?? []).filter((entry) => entry.level === "error").slice(-3))}`,
    250
  );
  const savedGraphText = await waitFor(
    async () => {
      const text = await readFile(path.join(createdState.activeProjectDir, "graphs", "reference_platformer_logic.json"), "utf8").catch(() => "");
      return text.includes("passage_blocker_2") ? text : false;
    },
    10000,
    "Grafo gravado em disco apos Salvar nao contem a segunda passagem.",
    250
  ).catch(async (error) => {
    const scene = await readFile(path.join(createdState.activeProjectDir, "scenes", "main.json"), "utf8").catch(() => "");
    const player = JSON.parse(scene || "{}")?.entities?.find?.((entity) => entity.entity_id === "player");
    fail(`${error.message} player(source)=${JSON.stringify(player)?.slice(0, 1500)}`);
  });
  report.secondPassageSavedGraphSha256 = createHash("sha256").update(savedGraphText).digest("hex");
  await clickTopBarMenuAction(sessionId, "Fechar");
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const wizardVisible = await executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"project-wizard-body\"]'));");
      return !state?.activeProjectDir && wizardVisible ? true : false;
    },
    15000, "Projeto nao fechou antes de reabrir a segunda passagem.", 250
  );
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', generatedProjectName);
  await waitFor(async () => executeScript(sessionId, "return Boolean(document.querySelector('[data-testid=\"wizard-existing-project-card\"]'));"), 30000, "Wizard nao listou o projeto para reabrir.", 500);
  await clickByTestId(sessionId, "wizard-open-existing-project");
  await waitFor(async () => (await readAutomationState(sessionId))?.activeProjectDir === createdState.activeProjectDir, 45000, "Projeto nao reabriu com a segunda passagem.", 500);
  await clickByTestId(sessionId, "hierarchy-entity-player");
  await waitFor(async () => (await readAutomationState(sessionId))?.selectedEntityId === "player", 10000, "player nao selecionado apos reabrir.", 200);
  await clickByTestId(sessionId, "workspace-rail-logic");
  const reopenedPassage = await waitFor(
    async () => executeScript(sessionId, `
      const q = (id) => document.querySelector('[data-testid="' + id + '"]')?.value ?? null;
      const main = { blocker: q("passage-passage_main-blocker"), threshold: q("passage-passage_main-threshold"), openVar: q("passage-passage_main-openvar") };
      const second = { blocker: q("passage-passage_2-blocker"), threshold: q("passage-passage_2-threshold"), openVar: q("passage-passage_2-openvar") };
      return second.blocker ? { main, second } : false;
    `),
    15000, "Segunda passagem ausente apos reabrir.", 250
  );
  if (reopenedPassage.second.blocker !== "passage_blocker_2" || reopenedPassage.second.threshold !== "60" || reopenedPassage.second.openVar !== "passage_2_open" ||
      reopenedPassage.main.blocker !== "passage_blocker" || reopenedPassage.main.threshold !== "12" || reopenedPassage.main.openVar !== "goal_open") {
    fail(`Referencias das passagens nao persistiram apos reabrir: ${JSON.stringify(reopenedPassage)}`);
  }
  const savedScene = JSON.parse(await readFile(path.join(createdState.activeProjectDir, "scenes", "main.json"), "utf8"));
  const savedCollision = savedScene?.collision_map?.data ?? [];
  if (!pitCells.every(([col, row]) => Number(savedCollision[row * 40 + col]) === 0) || Number(savedCollision[26 * 40 + 20]) !== 1) {
    fail("Colisao do fosso nao persistiu no arquivo da cena (ou apagou celulas nao editadas).");
  }
  await clickByTestId(sessionId, "workspace-rail-scene");
  await clickByTestId(sessionId, "hierarchy-entity-player");
  const reopenedIdleFps = await waitFor(async () => executeScript(sessionId, "return document.querySelector('[data-testid=\"inspector-anim-idle-fps\"]')?.value ?? false;"), 10000, "FPS do idle ausente apos reabrir.", 200);
  if (reopenedIdleFps !== "12") fail(`FPS do idle nao persistiu: ${reopenedIdleFps}`);
  addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-08-second-passage-reopened.png`), "passagens reabertas");
  await clickByTestId(sessionId, "workspace-rail-game");
  const twoPassageBuild = await runBuildRunAndCollect(sessionId, "reference platformer two passages build", timeoutMs, report, artifactPrefix);
  const twoPassageRomPath = path.join(validationDir, `${artifactPrefix}-two-passages.rom`);
  await cp(twoPassageBuild.rom_path, twoPassageRomPath);
  addReportArtifact(report, twoPassageRomPath, "ROM com duas passagens autorais");
  const twoPassageMainPath = path.join(validationDir, `${artifactPrefix}-two-passages-main.c`);
  await cp(path.join(createdState.activeProjectDir, "build", "megadrive", "src", "main.c"), twoPassageMainPath);
  addReportArtifact(report, twoPassageMainPath, "main.c com duas passagens");
  runtimeSymbols = parseElf32Symbols(await readFile(elfPath));
  const twoSymbols = runtimeSymbols;
  const readS16 = async (name) => {
    const address = twoSymbols.get(name);
    if (!Number.isInteger(address)) fail(`Simbolo ${name} ausente na ROM de duas passagens.`);
    const memory = await invokeCore("emulator_read_memory", { region: 2, offset: address & 0xffff, length: 2 });
    const word = memory.value.data[0] | (memory.value.data[1] << 8);
    return word > 0x7fff ? word - 0x10000 : word;
  };
  const loadedTwo = await callAutomationApi(sessionId, "loadRomForEmulation", [twoPassageRomPath, { startPaused: true }]);
  if (loadedTwo !== true) fail("ROM de duas passagens nao carregou pausada.");
  await waitFor(async () => { const st = await readAutomationState(sessionId); return st?.emulatorLoaded === true && st?.emulPaused === true; }, 15000, "ROM de duas passagens nao ficou pausada.", 100);
  const twoEpoch = await invokeCore("emulator_get_core_epoch");
  await invokeCore("emulator_send_input", { joypad: neutralGoalInput, sessionEpoch: twoEpoch.value });
  await invokeCore("emulator_run_frames", { frames: 120 });
  const regionHash = (observed, x0, y0, w, h) => {
    const rgba = Buffer.from(observed?.framebuffer_rgba ?? []);
    const width = Number(observed?.framebuffer_width ?? 320);
    const hash = createHash("sha256");
    for (let y = y0; y < y0 + h; y += 1) hash.update(rgba.subarray((y * width + x0) * 4, (y * width + x0 + w) * 4));
    return hash.digest("hex");
  };
  const idleChanges = [];
  let lastIdle = null;
  let firstObserved = null;
  for (let frame = 0; frame < 40; frame += 1) {
    await invokeCore("emulator_run_frames", { frames: 1 });
    const observed = (await invokeCore("emulator_observe")).value;
    firstObserved ??= observed;
    const idleHash = regionHash(observed, 32, 192, 16, 16);
    if (lastIdle !== null && idleHash !== lastIdle) idleChanges.push(frame);
    lastIdle = idleHash;
  }
  const idleGaps = idleChanges.slice(1).map((frame, index) => frame - idleChanges[index]);
  if (idleChanges.length < 6 || !idleGaps.every((gap) => gap === 5)) {
    fail(`Animacao idle editada (12 fps) nao trocou a cada 5 frames na ROM: ${JSON.stringify(idleChanges)}`);
  }
  const reopenedObserved = reopenedBuild.framebuffer;
  const pitVisual = { edited: regionHash(firstObserved, 80, 208, 16, 16), control: regionHash(firstObserved, 160, 208, 16, 16) };
  if (pitVisual.edited === pitVisual.control) {
    fail(`Regiao do fosso nao mudou visualmente em relacao ao piso nao editado: ${JSON.stringify(pitVisual)}`);
  }
  report.pitVisual = { ...pitVisual, reopenedFramebuffer: reopenedObserved?.framebuffer_sha256 ?? null };
  await invokeCore("emulator_send_input", { joypad: { ...neutralGoalInput, right: true }, sessionEpoch: twoEpoch.value });
  const timeline = [];
  // Native 32 px fox stands at y=176 on the y=208 floor; the erased 8 px
  // tile exposes a real dip to y=184 before the scripted jump pulse.
  for (let frame = 1; frame <= 130; frame += 1) {
    // Controlled measurement: pulse jump (RetroPad Y = MD A) when the player is in the hole.
    const inHole = timeline.length > 0 && timeline[timeline.length - 1].y >= 184;
    await invokeCore("emulator_send_input", { joypad: { ...neutralGoalInput, right: true, y: inHole }, sessionEpoch: twoEpoch.value });
    await invokeCore("emulator_run_frames", { frames: 1 });
    timeline.push({
      frame,
      x: await readS16("spr_player_x"),
      y: await readS16("spr_player_y"),
      score: (await readLogicInt("reference_score")).value,
      mainOpen: (await readLogicInt("goal_open")).value,
      secondOpen: (await readLogicInt("passage_2_open")).value,
    });
  }
  await invokeCore("emulator_send_input", { joypad: neutralGoalInput, sessionEpoch: twoEpoch.value });
  const timelinePath = path.join(validationDir, `${artifactPrefix}-two-passages-timeline.json`);
  await writeFile(timelinePath, JSON.stringify(timeline, null, 2));
  addReportArtifact(report, timelinePath, "linha do tempo RAM das duas passagens");
  const at = (predicate) => timeline.find(predicate);
  const mainOpened = at((t) => t.mainOpen === 1);
  const secondOpened = at((t) => t.secondOpen === 1);
  const heldAtSecond = timeline.filter((t) => t.secondOpen === 0 && t.x === 106);
  const crossTalk = timeline.filter((t) => t.mainOpen === 1 && t.secondOpen === 0 && t.score >= 60);
  const maxXWhileSecondClosed = Math.max(...timeline.filter((t) => t.secondOpen === 0).map((t) => t.x));
  if (!mainOpened || mainOpened.score !== 12 || !secondOpened || secondOpened.score !== 60 ||
      maxXWhileSecondClosed > 106 || heldAtSecond.length < 5 || crossTalk.length > 0 || timeline.at(-1).x <= 136) {
    fail(`Duas passagens nao se comportaram de forma independente: ${JSON.stringify({ mainOpened, secondOpened, maxXWhileSecondClosed, heldAtSecond: heldAtSecond.length, crossTalk: crossTalk.length, last: timeline.at(-1) })}`);
  }
  const pitDip = timeline.filter((t) => t.x >= 72 && t.x < 88 && t.y >= 184);
  const floorHeld = timeline.filter((t) => t.x < 72).every((t) => t.y === 176);
  if (pitDip.length === 0 || !floorHeld) {
    fail(`Colisao apagada pela UI nao virou fosso fisico na ROM: ${JSON.stringify({ pitDip, floorHeld })}`);
  }
  addReportStep(report, "scene_collision_and_animation_authored_in_ui", "passed", {
    pitCells,
    collisionSolid: { before: solidBeforePit, after: solidAfterPit },
    physicalPitDip: pitDip,
    idleFps: 12,
    idleChangeFrames: idleChanges,
    idleGaps,
    pitVisualRegionSha256: pitVisual,
    limits: "sem paredes de tile horizontais: andando, o personagem sobe a borda do fosso raso",
  });
  addReportStep(report, "second_passage_authored_in_ui", "passed", {
    reopened: reopenedPassage,
    rom: { path: twoPassageRomPath, sha256: createHash("sha256").update(await readFile(twoPassageRomPath)).digest("hex") },
    mainOpened,
    secondOpened,
    heldFramesAtSecondBlocker: heldAtSecond.length,
    maxXWhileSecondClosed,
    final: timeline.at(-1),
    timeline: timelinePath,
    inputDriver: "core emulator_send_input (controlled measurement; native keyboard is covered by movement/jump steps)",
  });

  const savedReport = await writeCreateGameReport(report, reportPath);
  console.log("OK: Desktop Tauri reference-platformer E2E passou.");
  console.log(`Projeto criado: ${generatedProjectName}`);
  console.log(`Diretorio do projeto: ${createdState.activeProjectDir}`);
  console.log(`ROM inicial: ${firstBuild.rom_path}`);
  console.log(`ROM reaberta: ${reopenedBuild.rom_path}`);
  console.log(`Relatorio: ${savedReport}`);
}

// ── Authoring acceptance (guided UI, restart, keyboard play to victory) ──────────
// Everything is done through the normal UI with native WebDriver input. The game is
// played with the real keyboard in the running Game View: no emulator_send_input, no
// manual frame stepping. RAM, framebuffer and received audio are only *observed*.
async function runAuthoringAcceptanceScenario(initialSessionId, appPath, uiBootstrapTimeoutMs, onProjectCreated) {
  let sessionId = initialSessionId;
  const artifactPrefix = `authoring-acceptance-${artifactTimestamp()}`;
  const reportPath = path.join(validationDir, `${artifactPrefix}-report.json`);
  const report = {
    generatedAt: null,
    scenario: "authoring-acceptance",
    testedApplication: { path: appPath, sha256: createHash("sha256").update(await readFile(appPath)).digest("hex") },
    artifacts: [],
    steps: [],
    frames: [],
    roms: [],
  };
  const shot = async (name, label) => addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-${name}.png`), label);
  const state = () => readAutomationState(sessionId);
  const js = (script, args = []) => executeScript(sessionId, script, args);
  const click = (testId, label = testId) => clickButtonByTestIdNative(sessionId, testId, label);
  const selectOption = async (testId, value) => {
    const elementId = await findElement(sessionId, `[data-testid="${testId}"] option[value="${value}"]`);
    await webdriverRequest("POST", `/session/${sessionId}/element/${elementId}/click`, {});
    await waitFor(async () => (await js(`return document.querySelector('[data-testid="${testId}"]')?.value ?? null;`)) === value, 5000, `Selecao ${testId}=${value} nao aplicada.`, 100);
  };
  const waitSelected = (entityId) => waitFor(async () => (await state())?.selectedEntityId === entityId, 10000, `${entityId} nao selecionado.`, 150);

  // Resources must really load: fox fur, red scarf/gate, wooden sword, grass
  // and the Forge-converted backdrop are checked as rendered viewport pixels.
  // are checked in the rendered viewport, not just in the asset manifest.
  const assertResourcesVisible = async (label) => {
    const summary = await waitFor(async () => {
      const value = await js(`const el = document.querySelector('[data-testid="viewport-asset-health-summary"]'); return el ? { ...el.dataset } : null;`);
      return value && Number(value.referenced) > 0 && Number(value.loading) === 0 && Number(value.ready) === Number(value.referenced) && Number(value.failed) === 0 && Number(value.missing) === 0 ? value : false;
    }, 20000, `${label}: recursos do viewport nao carregaram (falha real de carregamento).`, 250);
    const colors = await js(`
      const canvas = document.querySelector('[data-testid="viewport-scene-canvas"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const near = (i, r, g, b) => Math.abs(data[i] - r) < 16 && Math.abs(data[i + 1] - g) < 16 && Math.abs(data[i + 2] - b) < 16;
      let foxFur = 0, redDetails = 0, woodenSword = 0, grass = 0, sky = 0, mountains = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (near(i, 238, 102, 0)) foxFur += 1;
        if (near(i, 170, 0, 0) || near(i, 205, 48, 58)) redDetails += 1;
        if (near(i, 204, 136, 68)) woodenSword += 1;
        if (near(i, 183, 221, 93) || near(i, 90, 171, 70)) grass += 1;
        if (near(i, 34, 170, 238)) sky += 1;
        if (near(i, 0, 102, 170) || near(i, 0, 68, 102)) mountains += 1;
      }
      return { foxFur, redDetails, woodenSword, grass, sky, mountains, width: canvas.width, height: canvas.height };
    `);
    if (!colors || colors.foxFur < 20 || colors.redDetails < 20 || colors.woodenSword < 3 || colors.grass < 200 || colors.sky < 1000 || colors.mountains < 200) {
      fail(`${label}: raposa/itens/cenario nao aparecem com seus pixels reais no viewport: ${JSON.stringify(colors)}`);
    }
    return { summary, colors };
  };
  const assertInspectorPreview = async (label) => {
    const preview = await waitFor(async () => {
      const value = await js(`const img = document.querySelector('[data-testid="inspector-asset-preview"]'); return img instanceof HTMLImageElement && img.complete ? { w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 22) } : null;`);
      return value && value.w > 0 ? value : false;
    }, 15000, `${label}: preview do Inspector nao carregou.`, 200);
    if (preview.w !== 160 || preview.h !== 32) fail(`${label}: preview do personagem com tamanho inesperado: ${JSON.stringify(preview)}`);
    return preview;
  };
  // Controls must be on screen and not covered (native hit test at their center).
  const assertReachable = async (testIds, label) => {
    const result = await js(`
      return arguments[0].map((id) => {
        const el = document.querySelector('[data-testid="' + id + '"]');
        if (!el) return { id, ok: false, reason: "ausente" };
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const inside = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
        const hit = document.elementFromPoint(cx, cy);
        const clipped = el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === "hidden";
        return { id, ok: inside && Boolean(hit && (hit === el || el.contains(hit))) && !clipped, inside, clipped, hit: hit?.getAttribute?.("data-testid") ?? hit?.tagName };
      });
    `, [testIds]);
    const bad = result.filter((entry) => !entry.ok);
    if (bad.length) fail(`${label}: controles inacessiveis/cortados/cobertos: ${JSON.stringify(bad)}`);
    return result;
  };

  // 1. Create the stage from the wizard and switch to the guided mode.
  await setSessionWindowRect(sessionId, 1920, 1080);
  await waitForOnboardingWizard(sessionId);
  await click("template-card-reference_platformer", "modelo de fase de referencia");
  await clickButtonByText(sessionId, "Mega Drive", "exact");
  const projectName = `Acceptance_${Date.now()}`;
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await clickButtonByText(sessionId, "Criar Projeto", "exact");
  const created = await waitFor(async () => {
    const value = await state();
    return value?.activeProjectDir && value.activeProjectName === projectName ? value : false;
  }, 60000, "Wizard nao criou o projeto.", 500);
  const projectDir = created.activeProjectDir;
  onProjectCreated(projectDir);
  currentE2eRunContext.project = projectDir;
  await click("shell-persona-guiado", "modo guiado");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="guided-steps"]'));`), 10000, "Barra de etapas guiadas ausente.", 200);
  await click("guided-step-personagem", "etapa Personagem");
  await waitSelected("player");
  const initialResources = await assertResourcesVisible("editor inicial");
  const initialPreview = await assertInspectorPreview("editor inicial");
  await shot("01-guided-editor-loaded", "editor guiado com recursos carregados");
  addReportStep(report, "create_and_see_resources", "passed", { projectDir, initialResources, initialPreview });

  // Layout: 1920x1080, 1366x768 and an enlarged interface scale.
  const layoutControls = ["guided-step-cenario", "guided-step-personagem", "guided-step-regras", "guided-step-sons", "guided-step-testar", "scene-save-status", "inspector-transform-x", "inspector-anim-idle-fps"];
  const layout = {};
  layout["1920x1080"] = await assertReachable(layoutControls, "1920x1080");
  await setSessionWindowRect(sessionId, 1366, 768);
  await new Promise((resolve) => setTimeout(resolve, 600));
  layout["1366x768"] = await assertReachable(layoutControls, "1366x768");
  await shot("02-layout-1366x768", "editor guiado em 1366x768");
  await js(`document.documentElement.style.zoom = "1.25";`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  layout["1366x768@125%"] = await assertReachable(layoutControls.filter((id) => id.startsWith("guided-step") || id === "scene-save-status"), "1366x768 com escala 125%");
  await shot("03-layout-scaled", "editor guiado com escala 125%");
  await js(`document.documentElement.style.zoom = "";`);
  await setSessionWindowRect(sessionId, 1920, 1080);
  await new Promise((resolve) => setTimeout(resolve, 600));
  // Keyboard reachability of the guided steps.
  await js(`document.querySelector('[data-testid="guided-step-cenario"]').focus();`);
  const focused = await js(`return document.activeElement?.getAttribute('data-testid');`);
  if (focused !== "guided-step-cenario") fail(`Etapa guiada nao recebe foco pelo teclado: ${focused}`);
  addReportStep(report, "layout_and_keyboard_reachability", "passed", { layout, focused });

  // 2. Scene: paint a brick, erase one floor cell (visual) and its collision.
  await click("guided-step-cenario", "etapa Cenario");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="tile-palette-3"]'));`), 15000, "Paleta de tiles ausente.", 200);
  const worldBounds = (await state())?.activeScene?.worldBounds;
  const cellPoint = (col, row) => ({
    x: ((col * 8 + 4) - Number(worldBounds?.minX ?? 0)) / Math.max(1, Number(worldBounds?.maxX ?? 320) - Number(worldBounds?.minX ?? 0)),
    y: ((row * 8 + 4) - Number(worldBounds?.minY ?? 0)) / Math.max(1, Number(worldBounds?.maxY ?? 224) - Number(worldBounds?.minY ?? 0)),
  });
  const paintCell = async (paletteTestId, col, row, label) => {
    await click(paletteTestId, `paleta ${label}`);
    const point = cellPoint(col, row);
    await clickCanvasPointNatively(sessionId, "[data-testid='viewport-scene-overlay']", point.x, point.y, label);
  };
  const solidBefore = Number((await state())?.activeScene?.collisionSolidCount ?? 0);
  await paintCell("tile-palette-3", 6, 20, "tijolo em (6,20)");
  await paintCell("tile-palette-empty", 10, 26, "celula vazia em (10,26)");
  const cells = await waitFor(async () => {
    const tilemap = (await state())?.activeScene?.entities?.find((entity) => entity.id === "reference_tilemap")?.tilemap;
    const values = tilemap?.cells ?? [];
    return Number(values[20 * 40 + 6]) === 3 && Number(values[26 * 40 + 10]) === 4294967295 ? values : false;
  }, 10000, "Pintura/celula vazia nao aplicadas ao tilemap.", 150);
  // Undo/redo with the real keyboard (Ctrl+Z / Ctrl+Y) over the erased cell.
  const chord = async (key) => webdriverRequest("POST", `/session/${sessionId}/actions`, {
    actions: [{ type: "key", id: "rds-chord", actions: [
      { type: "keyDown", value: "\uE009" }, { type: "keyDown", value: key }, { type: "keyUp", value: key }, { type: "keyUp", value: "\uE009" },
    ] }],
  });
  const cellValue = async (index) => Number((await state())?.activeScene?.entities?.find((entity) => entity.id === "reference_tilemap")?.tilemap?.cells?.[index] ?? 0);
  await js(`document.activeElement?.blur?.();`);
  await chord("z");
  await waitFor(async () => (await cellValue(26 * 40 + 10)) === 0, 10000, "Ctrl+Z nao desfez a celula vazia.", 150);
  await chord("y");
  await waitFor(async () => (await cellValue(26 * 40 + 10)) === 4294967295, 10000, "Ctrl+Y nao refez a celula vazia.", 150);
  addReportStep(report, "undo_redo_keyboard", "passed", { cell: [10, 26] });
  await closeVisibleConsoleDrawer(sessionId, "antes do modo colisao");
  await click("tile-tool-collision", "ferramenta Colisao da paleta");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="tile-collision-hint"]'));`), 5000, "Modo colisao nao ativou.", 100);
  const holePoint = cellPoint(10, 26);
  await clickCanvasPointNatively(sessionId, "[data-testid='viewport-scene-overlay']", holePoint.x, holePoint.y, "apagar colisao (10,26)", 2);
  await waitFor(async () => Number((await state())?.activeScene?.collisionSolidCount ?? 0) === solidBefore - 1, 10000, "Colisao da celula nao foi apagada.", 150);
  await shot("04-scene-edited", "cenario editado: tijolo e celula vazia sem colisao");
  addReportStep(report, "scene_edit", "passed", { brick: cells[20 * 40 + 6], empty: cells[26 * 40 + 10], collisionSolid: { before: solidBefore, after: solidBefore - 1 } });

  // 3. Second blocker (duplicate + position) and character animation.
  await click("guided-step-personagem", "etapa Personagem");
  await webdriverRequest("POST", `/session/${sessionId}/element/${await findElement(sessionId, "[data-testid='hierarchy-entity-passage_blocker']")}/click`, {});
  await waitSelected("passage_blocker");
  await click("inspector-duplicate-entity", "duplicar bloqueador");
  await waitSelected("passage_blocker_2");
  await setInputByTestIdNative(sessionId, "inspector-transform-x", "120");
  await waitFor(async () => (await state())?.activeScene?.entities?.find((entity) => entity.id === "passage_blocker_2")?.x === 120, 10000, "Segundo bloqueador nao foi para x=120.", 150);
  await click("guided-step-personagem", "etapa Personagem");
  await waitSelected("player");
  await setInputByTestIdNative(sessionId, "inspector-anim-idle-fps", "12");
  await waitFor(async () => (await js(`return document.querySelector('[data-testid="inspector-anim-idle-fps"]')?.value;`)) === "12", 10000, "FPS do idle nao aplicado.", 150);
  addReportStep(report, "blocker_and_animation", "passed", { blocker2X: 120, idleFps: 12 });

  // 4. Rules: two independent passages.
  await click("guided-step-regras", "etapa Regras");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="nodegraph-passages"]')) && Boolean(document.querySelector('[data-testid="nodegraph-rules"]'));`), 15000, "Regras/passagens ausentes.", 200);
  await setInputByTestIdNative(sessionId, "passage-passage_main-threshold", "12");
  await selectOption("passage-add-blocker", "passage_blocker_2");
  await setInputByTestIdNative(sessionId, "passage-add-threshold", "60");
  await click("passage-add", "adicionar segunda passagem");
  await waitFor(async () => js(`return document.querySelector('[data-testid="passage-passage_2-openvar"]')?.value === 'passage_2_open' && !document.querySelector('[data-testid="passage-issues"]');`), 10000, "Segunda passagem nao foi criada sem problemas.", 200);
  const rulesText = await js(`return document.querySelector('[data-testid="nodegraph-rules"]')?.textContent ?? '';`);
  await shot("05-rules", "regras Quando/Se/Fazer e passagens");
  addReportStep(report, "passages", "passed", { rulesExcerpt: rulesText.slice(0, 600) });

  // 5. Sounds: bind the completion event to "victory" and preview it.
  await click("guided-step-sons", "etapa Sons");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="sound-goal_sound-select"]'));`), 10000, "Painel de sons ausente.", 200);
  await selectOption("sound-goal_sound-select", "victory");
  await click("sound-goal_sound-preview", "ouvir som associado");
  const previewState = await waitFor(async () => {
    const text = await js(`return document.querySelector('[data-testid="sound-goal_sound-preview-state"]')?.textContent ?? '';`);
    return /Prévia: |Prévia falhou/.test(text) ? text : false;
  }, 10000, "Previa do som nao respondeu.", 200);
  if (!/^Prévia: 0\.4/.test(previewState)) fail(`Previa do som associado falhou: ${previewState}`);
  const soundIssue = await js(`return document.querySelector('[data-testid="sound-goal_sound-issue"]')?.textContent ?? '';`);
  if (soundIssue) fail(`Som associado reportou problema: ${soundIssue}`);
  await shot("06-sounds", "som de conclusao associado a victory");
  addReportStep(report, "sound_binding", "passed", { previewState });

  // 6. Save with a truthful status, check the files, restart the app and reopen.
  await click("guided-step-personagem", "etapa Personagem");
  await clickTopBarMenuAction(sessionId, "Salvar");
  let lastSaveStatus = null;
  await waitFor(async () => {
    lastSaveStatus = await js(`const el = document.querySelector('[data-testid="scene-save-status"]'); return el ? { ...el.dataset, text: el.textContent } : null;`);
    return lastSaveStatus?.status === "saved";
  }, 20000, "Indicador nao chegou a 'Salvo'.", 200).catch(async () => fail(`Indicador de salvamento nao chegou a 'Salvo': ${JSON.stringify(lastSaveStatus)} mutacoes=${JSON.stringify((await js("return window.__RDS_E2E__.getSceneRevisionLog();")).slice(-3))}`));
  const graphOnDisk = await readFile(path.join(projectDir, "graphs", "reference_platformer_logic.json"), "utf8");
  const sceneOnDisk = JSON.parse(await readFile(path.join(projectDir, "scenes", "main.json"), "utf8"));
  if (!graphOnDisk.includes('"sfx":"victory"') || !graphOnDisk.includes("passage_blocker_2")) fail("Grafo salvo nao contem som/passagem.");
  if (Number(sceneOnDisk.collision_map.data[26 * 40 + 10]) !== 0) fail("Colisao apagada nao foi salva.");
  addReportStep(report, "saved", "passed", { saveStatus: "saved" });
  await deleteSession(sessionId);
  sessionId = await createSession(appPath);
  currentE2eRunContext.sessionId = sessionId;
  await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "App nao reabriu apos reinicio");
  await waitFor(async () => js("return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"), uiBootstrapTimeoutMs, "API nao voltou apos reinicio", 150);
  await setSessionWindowRect(sessionId, 1920, 1080);
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="wizard-existing-project-card"]'));`), 30000, "Wizard nao encontrou o projeto salvo.", 300);
  await click("wizard-open-existing-project", "reabrir projeto");
  await waitFor(async () => (await state())?.activeProjectDir === projectDir, 60000, "Projeto nao reabriu.", 300);
  if (!(await js(`return Boolean(document.querySelector('[data-testid="guided-steps"]'));`))) await click("shell-persona-guiado", "modo guiado apos reinicio");
  await click("guided-step-personagem", "etapa Personagem apos reinicio");
  await waitSelected("player");
  const reopenedResources = await assertResourcesVisible("apos reabrir");
  const reopenedPreview = await assertInspectorPreview("apos reabrir");
  const reopenedFps = await js(`return document.querySelector('[data-testid="inspector-anim-idle-fps"]')?.value;`);
  const reopenedCells = (await state())?.activeScene?.entities?.find((entity) => entity.id === "reference_tilemap")?.tilemap?.cells ?? [];
  await click("guided-step-regras", "etapa Regras apos reinicio");
  const reopenedPassages = await waitFor(async () => js(`
    const v = (id) => document.querySelector('[data-testid="' + id + '"]')?.value ?? null;
    return v("passage-passage_2-blocker") ? { mainThreshold: v("passage-passage_main-threshold"), second: [v("passage-passage_2-blocker"), v("passage-passage_2-threshold"), v("passage-passage_2-openvar")], sound: v("sound-goal_sound-select") } : false;
  `), 15000, "Passagens nao reapareceram apos reabrir.", 200);
  if (reopenedFps !== "12" || Number(reopenedCells[20 * 40 + 6]) !== 3 || Number(reopenedCells[26 * 40 + 10]) !== 4294967295 ||
      reopenedPassages.mainThreshold !== "12" || reopenedPassages.second.join() !== "passage_blocker_2,60,passage_2_open" || reopenedPassages.sound !== "victory") {
    fail(`Trabalho nao preservado apos reinicio/reabertura: ${JSON.stringify({ reopenedFps, brick: reopenedCells[20 * 40 + 6], empty: reopenedCells[26 * 40 + 10], reopenedPassages })}`);
  }
  await shot("07-reopened", "projeto reaberto com recursos e edicoes");
  addReportStep(report, "restart_reopen_preserved", "passed", { reopenedResources, reopenedPreview, reopenedFps, reopenedPassages });

  // 7. Build and play with the keyboard until victory.
  await click("guided-step-testar", "etapa Testar (compilar e jogar)");
  const running = await waitFor(async () => {
    const value = await state();
    const frame = await readCanonicalGameFrame(sessionId);
    return value?.emulatorLoaded && frame?.renderedFrames > 5 && frame.romSha256 ? { frame } : false;
  }, 300000, "Build & Run nao iniciou o jogo.", 500).catch(async (error) => {
    await shot("build-run-failure", "falha do Build & Run");
    const entries = ((await state())?.consoleEntries ?? []).filter((entry) => entry.level !== "info").slice(-12);
    fail(`${error.message} console=${JSON.stringify(entries).slice(0, 4000)}`);
  });
  const romPath = path.join(projectDir, "build", "megadrive", "out", "rom.bin");
  const romCopy = path.join(validationDir, `${artifactPrefix}-played.rom`);
  await cp(romPath, romCopy);
  const romSha256 = createHash("sha256").update(await readFile(romCopy)).digest("hex");
  if (running.frame.romSha256 !== romSha256) fail(`Game View executa outra ROM: ${JSON.stringify({ running: running.frame.romSha256, romSha256 })}`);
  const symbols = parseElf32Symbols(await readFile(path.join(projectDir, "build", "megadrive", "out", "rom.out")));
  // One in-page round trip per observation: all WRAM words read in parallel (read-only).
  const watch = ["spr_player_x", "spr_player_y", "logic_var_reference_score", "logic_var_goal_open", "logic_var_passage_2_open", "logic_var_goal_reached"]
    .map((name) => ({ name, address: symbols.get(name), width: name.startsWith("spr_") ? 2 : 4 }));
  if (watch.some((entry) => !Number.isInteger(entry.address))) fail(`Simbolos ausentes: ${JSON.stringify(watch)}`);
  const observe = async () => {
    const raw = await executeAsyncScript(sessionId, `
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      Promise.all(arguments[0].map((entry) => invoke("emulator_read_memory", { region: 2, offset: entry.address & 0xffff, length: entry.width })))
        .then((results) => done({ ok: true, data: results.map((r) => Array.from(r.data)), audioTotal: window.__RDS_E2E__.readReceivedAudioSamples(0, 0).total }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `, [watch]);
    if (!raw?.ok) fail(`Leitura de WRAM falhou: ${JSON.stringify(raw)}`);
    const decode = (d, width) => {
      const word = (i) => d[i] | (d[i + 1] << 8);
      if (width === 2) { const w = word(0); return w > 0x7fff ? w - 0x10000 : w; }
      const v = ((word(0) << 16) >>> 0) | word(2);
      return v > 0x7fffffff ? v - 0x100000000 : v;
    };
    const values = watch.map((entry, index) => decode(raw.data[index], entry.width));
    return { x: values[0], y: values[1], score: values[2], mainOpen: values[3], secondOpen: values[4], goal: values[5], audioTotal: raw.audioTotal, t: Date.now() };
  };
  const waitAck = (button, expected, context) => waitFor(async () => {
    const observation = await js("return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return observation?.lastJoypadAck?.joypad?.[button] === expected ? observation.lastJoypadAck : false;
  }, 4000, `${context}: ACK nativo (${button}=${expected}) ausente.`, 50);
  await closeVisibleConsoleDrawer(sessionId, "antes de jogar");
  await focusGameCanvasNatively(sessionId);
  const timeline = [];
  const acks = [];
  // The pit is one 8 px tile below the floor at y=208. Its observation
  // threshold follows the actual visual/body height of this template frame.
  const fullHoleY = 208 - reopenedPreview.h + 8;
  await sendNativeGameKey(sessionId, "ArrowRight", "keyDown", "andar para a direita");
  acks.push(await waitAck("right", true, "segurar direita"));
  let jumps = 0;
  let lastJumpAt = 0;
  const deadline = Date.now() + 240000;
  let current = await observe();
  while (current.goal !== 1 && Date.now() < deadline) {
    timeline.push(current);
    if (current.y >= fullHoleY && Date.now() - lastJumpAt > 1500) {
      await sendNativeGameKey(sessionId, "KeyZ", "keyDown", "pular para sair do buraco");
      acks.push(await waitAck("y", true, "pulo"));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await sendNativeGameKey(sessionId, "KeyZ", "keyUp", "soltar pulo");
      acks.push(await waitAck("y", false, "soltar pulo"));
      jumps += 1;
      lastJumpAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    current = await observe();
  }
  timeline.push(current);
  const victory = current;
  // Let the completion sound play in emulated time, still holding right.
  const rate = 44100;
  await waitFor(async () => (await js("return window.__RDS_E2E__.readReceivedAudioSamples(0, 0).total;")) > victory.audioTotal + rate * 2 * 0.8, 60000, "Audio pos-vitoria nao chegou.", 200);
  await sendNativeGameKey(sessionId, "ArrowRight", "keyUp", "soltar direita");
  acks.push(await waitAck("right", false, "soltar direita"));
  const timelinePath = path.join(validationDir, `${artifactPrefix}-play-timeline.json`);
  await writeFile(timelinePath, JSON.stringify(timeline, null, 2));
  addReportArtifact(report, timelinePath, "linha do tempo do jogo por teclado");
  await shot("08-victory", "jogo apos vencer pelo teclado");
  const frameAfter = await readCanonicalGameFrame(sessionId, { includePixels: true });
  if (!frameAfter?.rgba) fail(`Framebuffer apos a vitoria indisponivel: ${JSON.stringify({ keys: Object.keys(frameAfter ?? {}) })}`);

  const mainOpenedAt = timeline.find((t) => t.mainOpen === 1);
  const secondOpenedAt = timeline.find((t) => t.secondOpen === 1);
  const hole = timeline.filter((t) => t.y >= fullHoleY);
  const crossedSecondClosed = timeline.filter((t) => t.secondOpen === 0 && t.x > 106);
  if (victory.goal !== 1) fail(`Vitoria nao alcancada pelo teclado: ${JSON.stringify(victory)}`);
  if (!mainOpenedAt || mainOpenedAt.score < 12 || !secondOpenedAt || secondOpenedAt.score < 60 || crossedSecondClosed.length) {
    fail(`Passagens nao se comportaram durante o jogo: ${JSON.stringify({ mainOpenedAt, secondOpenedAt, crossedSecondClosed: crossedSecondClosed.length })}`);
  }
  if (hole.length === 0 || jumps === 0) fail(`Buraco na colisao nao foi observado/atravessado com pulo: ${JSON.stringify({ hole: hole.length, jumps })}`);
  // Image: the fox's orange coat is visible in the real core framebuffer after
  // victory, rather than counting arbitrary nonblack pixels or the old blue art.
  const foxFurPixels = (() => {
    const rgba = frameAfter.rgba;
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) if (Math.abs(rgba[i] - 238) < 24 && Math.abs(rgba[i + 1] - 102) < 24 && rgba[i + 2] < 24) count += 1;
    return count;
  })();
  if (foxFurPixels < 20) fail(`Raposa nao aparece no framebuffer apos a vitoria: ${foxFurPixels}`);

  // Sound at the right event: 1320 Hz (victory) after the win, absent before; 880 Hz
  // (the unbound default) must not dominate.
  const window = Math.floor(rate * 2 * 0.6);
  const after = await js("return window.__RDS_E2E__.readReceivedAudioSamples(arguments[0], arguments[1]);", [Math.max(0, victory.audioTotal - Math.floor(rate * 2 * 0.3)), window + Math.floor(rate * 2 * 0.3)]);
  const before = await js("return window.__RDS_E2E__.readReceivedAudioSamples(arguments[0], arguments[1]);", [Math.max(0, victory.audioTotal - Math.floor(rate * 2 * 1.6)), window]);
  const power = (samples, sampleRate, frequency) => {
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const coeff = 2 * Math.cos(omega);
    let s1 = 0, s2 = 0, n = 0;
    for (let i = 0; i < samples.length; i += 2) { const s0 = samples[i] + coeff * s1 - s2; s2 = s1; s1 = s0; n += 1; }
    return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, n * n);
  };
  if (!Array.isArray(after?.samples) || !Array.isArray(before?.samples)) fail(`Amostras de audio indisponiveis: ${JSON.stringify({ after: after && Object.keys(after), before: before && Object.keys(before) })}`);
  const sampleRate = after.sampleRate || rate;
  const audio = {
    sampleRate,
    before: { p1320: power(before.samples, sampleRate, 1320), p880: power(before.samples, sampleRate, 880), n: before.samples.length },
    after: { p1320: power(after.samples, sampleRate, 1320), p880: power(after.samples, sampleRate, 880), n: after.samples.length },
    telemetry: await js("return window.__RDS_E2E__.getAudioOutputTelemetry();"),
  };
  if (!(audio.after.p1320 > 20 * Math.max(1, audio.before.p1320) && audio.after.p1320 > 5 * Math.max(1, audio.after.p880))) {
    fail(`Som associado (victory, 1320 Hz) nao foi produzido no evento de vitoria: ${JSON.stringify(audio)}`);
  }
  addReportStep(report, "keyboard_play_to_victory", "passed", {
    rom: { path: romCopy, sha256: romSha256 },
    acks: acks.length,
    jumps,
    mainOpenedAt,
    secondOpenedAt,
    holeSamples: hole.length,
    victory,
    foxFurPixels,
    audio,
    layers: {
      generatedByCore: "amostras recebidas pelo app a partir do core (ring buffer), analisadas por Goertzel",
      forwardedToWebAudio: audio.telemetry,
      acousticLoopback: "nao medido neste cenario",
    },
  });
  const saved = await writeCreateGameReport(report, reportPath);
  console.log(`Relatorio: ${saved}`);
  console.log("OK: Desktop Tauri authoring acceptance (UI guiada, reinicio, teclado ate a vitoria, som associado) passou.");
}

/**
 * NodeGraph authoring proof (Experimental): everything through the normal UI with native
 * WebDriver input — locate the jump, rebind its button, edit one passage threshold without
 * touching the other, bind a sound from the rules view, organize/undo/redo, group, save,
 * restart, reopen, build and play with the real keyboard. RAM, framebuffer and audio are
 * observers only; no emulator_send_input.
 */
async function runNodeGraphAuthoringScenario(initialSessionId, appPath, uiBootstrapTimeoutMs, onProjectCreated) {
  let sessionId = initialSessionId;
  const artifactPrefix = `nodegraph-authoring-${artifactTimestamp()}`;
  const reportPath = path.join(validationDir, `${artifactPrefix}-report.json`);
  const report = {
    generatedAt: null,
    scenario: "nodegraph-authoring",
    testedApplication: { path: appPath, sha256: createHash("sha256").update(await readFile(appPath)).digest("hex") },
    artifacts: [],
    steps: [],
    frames: [],
    roms: [],
  };
  const shot = async (name, label) => addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-${name}.png`), label);
  const state = () => readAutomationState(sessionId);
  const js = (script, args = []) => executeScript(sessionId, script, args);
  const click = (testId, label = testId) => clickButtonByTestIdNative(sessionId, testId, label);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const selectOption = async (testId, value) => {
    await js(`document.querySelector('[data-testid="' + arguments[0] + '"]')?.scrollIntoView({ block: "center", inline: "center" });`, [testId]);
    const elementId = await findElement(sessionId, `[data-testid="${testId}"] option[value="${value}"]`);
    await webdriverRequest("POST", `/session/${sessionId}/element/${elementId}/click`, {});
    await waitFor(async () => (await js(`return document.querySelector('[data-testid="${testId}"]')?.value ?? null;`)) === value, 5000, `Selecao ${testId}=${value} nao aplicada.`, 100);
  };
  const waitSelected = (entityId) => waitFor(async () => (await state())?.selectedEntityId === entityId, 10000, `${entityId} nao selecionado.`, 150);
  const text = (testId) => js(`return document.querySelector('[data-testid="' + arguments[0] + '"]')?.textContent ?? null;`, [testId]);
  const value = (testId) => js(`return document.querySelector('[data-testid="' + arguments[0] + '"]')?.value ?? null;`, [testId]);
  const chord = async (key) => webdriverRequest("POST", `/session/${sessionId}/actions`, {
    actions: [{ type: "key", id: "rds-chord", actions: [
      { type: "keyDown", value: "" }, { type: "keyDown", value: key }, { type: "keyUp", value: key }, { type: "keyUp", value: "" },
    ] }],
  });
  const worldPositions = () => js(`
    const out = {};
    for (const el of document.querySelectorAll('[data-testid^="node-card-"]')) out[el.dataset.testid.slice(10)] = [Number(el.dataset.x), Number(el.dataset.y)];
    return out;
  `);
  // Geometry of what is really on screen: overlapping cards (visible ones) and the
  // distance between every wire end and the centre of the port element it belongs to.
  const geometry = async (label) => {
    const result = await js(`
      const svg = document.querySelector('[data-testid="nodegraph-edges"]');
      // Collapsed group boxes occupy space too (their members are hidden).
      const cards = [
        ...[...document.querySelectorAll('[data-testid^="node-card-"]')].map((el) => ({ id: el.dataset.testid.slice(10), r: el.getBoundingClientRect() })),
        ...[...document.querySelectorAll('[data-testid^="nodegraph-group-box-"][data-collapsed="true"]')].map((el) => ({ id: "group:" + el.dataset.testid.slice(20), r: el.getBoundingClientRect() })),
      ];
      const overlaps = [];
      for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) {
        const a = cards[i].r, b = cards[j].r;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push([cards[i].id, cards[j].id]);
      }
      const svgRect = svg.getBoundingClientRect();
      const k = svgRect.width / Math.max(1, svg.clientWidth);
      let checked = 0, skippedOffscreen = 0, maxDeviation = 0, worst = null;
      for (const pathEl of svg.querySelectorAll('path[data-from-node]')) {
        if (pathEl.dataset.collapsedEnd) continue;
        for (const end of ["from", "to"]) {
          const node = pathEl.dataset[end + "Node"], port = pathEl.dataset[end + "Port"];
          const portEl = document.querySelector('[data-testid="node-port-' + node + '-' + (end === "from" ? "out" : "in") + '-' + port + '"]');
          if (!portEl) continue;
          const r = portEl.getBoundingClientRect();
          // Only ends the user can see: off-window points are not compared (under page zoom WebKit mixes coordinate spaces there).
          if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) { skippedOffscreen += 1; continue; }
          // Port centre mapped back to SVG user units (layout px) using the page scale k.
          const p = { x: (r.left + r.width / 2 - svgRect.left) / k, y: (r.top + r.height / 2 - svgRect.top) / k };
          const deviation = Math.hypot(p.x - Number(pathEl.dataset[end + "X"]), p.y - Number(pathEl.dataset[end + "Y"]));
          checked += 1;
          if (deviation > maxDeviation) { const card = portEl.closest('[data-testid^="node-card-"]'); maxDeviation = deviation; worst = { edge: pathEl.dataset.testid, end, deviation, port: [p.x, p.y], wire: [Number(pathEl.dataset[end + "X"]), Number(pathEl.dataset[end + "Y"])], card: card ? { x: card.dataset.x, y: card.dataset.y, left: card.style.left, top: card.style.top, h: card.offsetHeight } : null, shellScroll: [document.querySelector('[data-testid="nodegraph-canvas-shell"]').scrollLeft, document.querySelector('[data-testid="nodegraph-canvas-shell"]').scrollTop] }; }
        }
      }
      const shell = document.querySelector('[data-testid="nodegraph-canvas-shell"]');
      return { cards: cards.length, overlaps, portEndsChecked: checked, skippedOffscreen, pageScale: k, maxDeviation, worst, zoom: Number(shell?.dataset.zoom ?? 0), window: [innerWidth, innerHeight] };
    `);
    if (!result || result.portEndsChecked === 0) fail(`${label}: geometria do grafo indisponivel: ${JSON.stringify(result)}`);
    return result;
  };
  const assertAligned = (g, label) => {
    if (g.maxDeviation > 2) fail(`${label}: fio fora da porta (${g.maxDeviation.toFixed(2)} px): ${JSON.stringify(g.worst)}`);
  };
  const assertReachable = async (testIds, label) => {
    const result = await js(`
      return arguments[0].map((id) => {
        const el = document.querySelector('[data-testid="' + id + '"]');
        if (!el) return { id, ok: false, reason: "ausente" };
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const inside = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
        const hit = document.elementFromPoint(cx, cy);
        return { id, ok: inside && Boolean(hit && (hit === el || el.contains(hit))), inside, hit: hit?.getAttribute?.("data-testid") ?? hit?.tagName };
      });
    `, [testIds]);
    const bad = result.filter((entry) => !entry.ok);
    if (bad.length) fail(`${label}: controles inacessiveis/cobertos: ${JSON.stringify(bad)}`);
    return result;
  };
  const toolbar = ["nodegraph-undo", "nodegraph-redo", "nodegraph-organize-all", "nodegraph-organize-selection", "nodegraph-fit-view", "nodegraph-select-behavior", "nodegraph-pin-selection", "nodegraph-group-selection"];

  // 1. Create the reference stage and a second passage blocker through the UI.
  await setSessionWindowRect(sessionId, 1920, 1080);
  await waitForOnboardingWizard(sessionId);
  await click("template-card-reference_platformer", "modelo de fase de referencia");
  await clickButtonByText(sessionId, "Mega Drive", "exact");
  const projectName = `NodeGraph_${Date.now()}`;
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await clickButtonByText(sessionId, "Criar Projeto", "exact");
  const created = await waitFor(async () => {
    const current = await state();
    return current?.activeProjectDir && current.activeProjectName === projectName ? current : false;
  }, 60000, "Wizard nao criou o projeto.", 500);
  const projectDir = created.activeProjectDir;
  onProjectCreated(projectDir);
  currentE2eRunContext.project = projectDir;
  const graphPath = path.join(projectDir, "graphs", "reference_platformer_logic.json");
  const shippedGraph = JSON.parse(await readFile(graphPath, "utf8"));
  await click("shell-persona-guiado", "modo guiado");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="guided-steps"]'));`), 10000, "Barra de etapas guiadas ausente.", 200);
  await click("guided-step-personagem", "etapa Personagem");
  await webdriverRequest("POST", `/session/${sessionId}/element/${await findElement(sessionId, "[data-testid='hierarchy-entity-passage_blocker']")}/click`, {});
  await waitSelected("passage_blocker");
  await click("inspector-duplicate-entity", "duplicar bloqueador");
  await waitSelected("passage_blocker_2");
  await setInputByTestIdNative(sessionId, "inspector-transform-x", "120");
  await waitFor(async () => (await state())?.activeScene?.entities?.find((entity) => entity.id === "passage_blocker_2")?.x === 120, 10000, "Segundo bloqueador nao foi para x=120.", 150);
  addReportStep(report, "create_project", "passed", { projectDir, shippedNodes: shippedGraph.nodes.length, shippedEdges: shippedGraph.edges.length });

  // 2. Open the logic and capture the graph as shipped (fit to view).
  await click("guided-step-regras", "etapa Regras");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="node-card-jump"]')) && Boolean(document.querySelector('[data-testid="nodegraph-rules"]'));`), 15000, "NodeGraph/Regras ausentes.", 200);
  await closeVisibleConsoleDrawer(sessionId, "antes do NodeGraph");
  await click("nodegraph-fit-view", "enquadrar grafo");
  await pause(400);
  const before = await geometry("antes de organizar");
  assertAligned(before, "antes de organizar");
  const positionsShipped = await worldPositions();
  await shot("01-before-organize", "grafo como entregue pelo template (enquadrado)");
  addReportStep(report, "graph_before_organize", "passed", { geometry: before });

  // 3. Locate and understand the jump from the rules view.
  const jumpRuleText = await text("rule-update_jump");
  if (!jumpRuleText?.includes("A (Z)")) fail(`Regra do pulo nao descreve o botao: ${jumpRuleText}`);
  await js(`document.querySelector('[data-testid="rule-item-jump"] button')?.scrollIntoView({ block: "center" });`);
  const ruleButton = await findElement(sessionId, "[data-testid='rule-item-jump'] button");
  await clickElement(sessionId, ruleButton);
  await waitFor(async () => (await js(`return document.querySelector('[data-testid="node-card-jump"]')?.dataset.selected ?? null;`)) === "true", 5000, "Regra nao levou ao no do pulo.", 100);
  await click("node-details-toggle-jump", "detalhes tecnicos do pulo");
  const jumpUnderstood = {
    action: await text("node-action-jump"),
    button: await text("node-button-jump"),
    velocity: await text("node-action-jump_velocity"),
    sound: await text("node-action-jump_sound"),
    details: await text("node-details-jump"),
  };
  if (jumpUnderstood.action !== "Ao apertar Botao A (tecla Z)" || !jumpUnderstood.button?.includes("Z") || !jumpUnderstood.velocity?.includes("para cima") || !jumpUnderstood.details?.includes("input_pressed")) {
    fail(`Pulo nao compreensivel pela interface: ${JSON.stringify(jumpUnderstood)}`);
  }
  await shot("02-jump-located", "pulo localizado: botao A = tecla Z, impulso e som");
  await click("node-details-toggle-jump", "fechar detalhes tecnicos");
  addReportStep(report, "locate_jump", "passed", { jumpRuleText, jumpUnderstood });

  // 4. Rebind the jump to button B (keyboard X) on the node card.
  await selectOption("node-param-jump-button", "BUTTON_B");
  const rebound = { action: await text("node-action-jump"), rule: await value("rule-edit-jump-button") };
  if (rebound.action !== "Ao apertar Botao B (tecla X)" || rebound.rule !== "BUTTON_B") fail(`Troca de botao nao refletida: ${JSON.stringify(rebound)}`);
  addReportStep(report, "rebind_jump", "passed", rebound);

  // 5. Two passages; edit only the main threshold on its node card.
  await selectOption("passage-add-blocker", "passage_blocker_2");
  await setInputByTestIdNative(sessionId, "passage-add-threshold", "60");
  await click("passage-add", "adicionar segunda passagem");
  await waitFor(async () => (await value("passage-passage_2-openvar")) === "passage_2_open", 10000, "Segunda passagem nao foi criada.", 200);
  await js(`document.querySelector('[data-testid="node-param-score_threshold-b"]')?.scrollIntoView({ block: "center", inline: "center" });`);
  await setInputByTestIdNative(sessionId, "node-param-score_threshold-b", "12");
  const thresholds = await waitFor(async () => {
    const v = { main: await value("passage-passage_main-threshold"), second: await value("passage-passage_2-threshold"), card: await value("node-param-score_threshold-b") };
    return v.main === "12" && v.card === "12" ? v : false;
  }, 5000, "Limiar principal nao aplicado.", 150);
  if (thresholds.second !== "60") fail(`Editar a passagem principal alterou a segunda: ${JSON.stringify(thresholds)}`);
  addReportStep(report, "edit_one_passage", "passed", thresholds);

  // 6. Bind the completion sound from the rules view.
  await selectOption("rule-edit-goal_sound-sfx", "victory");
  const soundBound = { rule: await value("rule-edit-goal_sound-sfx"), panel: await value("sound-goal_sound-select"), issue: await text("sound-goal_sound-issue") };
  if (soundBound.rule !== "victory" || soundBound.panel !== "victory" || soundBound.issue) fail(`Som nao associado: ${JSON.stringify(soundBound)}`);
  addReportStep(report, "bind_sound", "passed", soundBound);

  // 7. Organize, check geometry, undo/redo with the real keyboard.
  const edgesBefore = await js(`return document.querySelectorAll('path[data-from-node]').length;`);
  const positionsBeforeOrganize = await worldPositions();
  const organizeStarted = Date.now();
  await click("nodegraph-organize-all", "organizar tudo");
  const layoutReport = await waitFor(async () => js(`const el = document.querySelector('[data-testid="nodegraph-layout-report"]'); return el ? { ...el.dataset } : null;`), 5000, "Relatorio de organizacao ausente.", 50);
  const organizeUiMs = Date.now() - organizeStarted;
  await pause(500);
  const organized = await geometry("apos organizar");
  assertAligned(organized, "apos organizar");
  if (organized.overlaps.length || layoutReport.overlaps !== "0" || layoutReport.conflicts !== "0") fail(`Organizar deixou sobreposicoes/conflitos: ${JSON.stringify({ organized, layoutReport })}`);
  const positionsOrganized = await worldPositions();
  const edgesAfter = await js(`return document.querySelectorAll('path[data-from-node]').length;`);
  if (edgesAfter !== edgesBefore) fail(`Organizar mudou o numero de conexoes: ${edgesBefore} -> ${edgesAfter}`);
  await shot("03-after-organize", "grafo organizado pelas conexoes (enquadrado)");
  await js(`document.activeElement?.blur?.();`);
  await chord("z");
  await waitFor(async () => JSON.stringify(await worldPositions()) === JSON.stringify(positionsBeforeOrganize), 10000, "Ctrl+Z nao desfez a organizacao.", 150)
    .catch(async (error) => {
      const logs = ((await state())?.consoleEntries ?? []).map((entry) => entry.message).filter((m) => /NodeGraph|Atalhos/.test(m)).slice(-8);
      const undoTitle = await js(`return document.querySelector('[data-testid="nodegraph-undo"]')?.title ?? null;`);
      fail(`${error.message} ${JSON.stringify({ logs, undoTitle, active: await js("return document.activeElement?.tagName;") })}`);
    });
  await chord("y");
  await waitFor(async () => JSON.stringify(await worldPositions()) === JSON.stringify(positionsOrganized), 10000, "Ctrl+Y nao refez a organizacao.", 150);
  const stillBound = { button: await value("node-param-jump-button"), threshold: await value("node-param-score_threshold-b"), sound: await value("rule-edit-goal_sound-sfx") };
  if (stillBound.button !== "BUTTON_B" || stillBound.threshold !== "12" || stillBound.sound !== "victory") fail(`Desfazer/refazer da organizacao afetou edicoes: ${JSON.stringify(stillBound)}`);
  addReportStep(report, "organize_undo_redo", "passed", { layoutReport, organizeUiMs, before: { overlaps: before.overlaps.length }, organized, edges: edgesAfter, stillBound });

  // 8. Group the jump behavior, rename and collapse it (visual only).
  await js(`document.querySelector('[data-testid="rule-item-jump"] button')?.scrollIntoView({ block: "center" });`);
  await clickElement(sessionId, await findElement(sessionId, "[data-testid='rule-item-jump'] button"));
  await waitFor(async () => (await js(`return document.querySelector('[data-testid="node-card-jump"]')?.dataset.selected ?? null;`)) === "true", 5000, "No do pulo nao selecionado.", 100);
  await click("nodegraph-select-behavior", "selecionar comportamento");
  const selection = await text("nodegraph-selection-count");
  if (!selection?.startsWith("4 selecionado")) fail(`Comportamento do pulo nao tem 4 nos: ${selection}`);
  await click("nodegraph-group-selection", "agrupar");
  const groupId = await waitFor(async () => js(`return document.querySelector('[data-testid^="nodegraph-group-name-"]')?.dataset.testid.replace("nodegraph-group-name-", "") ?? null;`), 5000, "Grupo nao criado.", 100);
  if ((await value(`nodegraph-group-name-${groupId}`)) !== "Pulo") fail("Nome sugerido do grupo nao e 'Pulo'.");
  await setInputByTestIdNative(sessionId, `nodegraph-group-name-${groupId}`, "Pulo (botao B)");
  await waitFor(async () => (await value(`nodegraph-group-name-${groupId}`)) === "Pulo (botao B)", 5000, "Grupo nao renomeado.", 100);
  await click(`nodegraph-group-collapse-${groupId}`, "recolher grupo");
  await waitFor(async () => !(await js(`return Boolean(document.querySelector('[data-testid="node-card-jump"]'));`)), 5000, "Grupo nao recolheu.", 100);
  await shot("04-grouped-collapsed", "comportamento Pulo agrupado e recolhido");
  addReportStep(report, "group_behavior", "passed", { groupId, selection });

  // 9. Sizes and scales: controls reachable, no overlaps, wires on ports (also zoomed in).
  const layouts = {};
  layouts["1920x1080"] = { reach: await assertReachable(toolbar, "1920x1080"), geometry: await geometry("1920x1080") };
  await setSessionWindowRect(sessionId, 1366, 768);
  await pause(700);
  layouts["1366x768"] = { reach: await assertReachable(toolbar, "1366x768"), geometry: await geometry("1366x768") };
  await shot("05-layout-1366x768", "NodeGraph em 1366x768");
  await js(`document.documentElement.style.zoom = "1.25";`);
  await pause(700);
  layouts["1366x768@125%"] = { reach: await assertReachable(["nodegraph-undo", "nodegraph-organize-all", "nodegraph-fit-view"], "1366x768 com escala 125%"), geometry: await geometry("1366x768@125%") };
  await shot("06-layout-scaled", "NodeGraph com escala 125%");
  await js(`document.documentElement.style.zoom = "";`);
  await setSessionWindowRect(sessionId, 1920, 1080);
  await pause(700);
  await js(`
    const shell = document.querySelector('[data-testid="nodegraph-canvas-shell"]');
    const r = document.querySelector('[data-testid="node-card-score_threshold"]').getBoundingClientRect();
    for (let i = 0; i < 10; i += 1) shell.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + r.height / 2, deltaY: -160 }));
  `);
  await pause(500);
  layouts["zoom-in"] = { geometry: await geometry("zoom ampliado") };
  for (const [label, entry] of Object.entries(layouts)) {
    assertAligned(entry.geometry, label);
    if (entry.geometry.overlaps.length) fail(`${label}: cartoes sobrepostos: ${JSON.stringify(entry.geometry.overlaps)}`);
  }
  if (!(layouts["zoom-in"].geometry.zoom > 1)) fail(`Zoom nao ampliou: ${layouts["zoom-in"].geometry.zoom}`);
  await click("nodegraph-fit-view", "enquadrar apos zoom");
  addReportStep(report, "layout_sizes_scales", "passed", layouts);

  // 10. Save, check the file, restart, reopen.
  await clickTopBarMenuAction(sessionId, "Salvar");
  let lastSaveStatus = null;
  await waitFor(async () => {
    lastSaveStatus = await js(`const el = document.querySelector('[data-testid="scene-save-status"]'); return el ? { ...el.dataset, text: el.textContent } : null;`);
    return lastSaveStatus?.status === "saved";
  }, 20000, "Indicador nao chegou a 'Salvo'.", 200).catch(() => fail(`Salvar nao concluiu: ${JSON.stringify(lastSaveStatus)}`));
  const saved = JSON.parse(await readFile(graphPath, "utf8"));
  const node = (graph, id) => graph.nodes.find((candidate) => candidate.id === id);
  const passage2Rule = saved.nodes.find((candidate) => candidate.params?.passage_id === "passage_2" && candidate.params?.passage_role === "rule");
  const savedChecks = {
    jumpButton: node(saved, "jump")?.params?.button,
    mainThreshold: node(saved, "score_threshold")?.params?.b,
    secondThreshold: passage2Rule?.params?.b,
    goalSfx: node(saved, "goal_sound")?.params?.sfx,
    groups: saved.groups,
    jumpPosition: [node(saved, "jump")?.x, node(saved, "jump")?.y],
  };
  if (savedChecks.jumpButton !== "BUTTON_B" || savedChecks.mainThreshold !== 12 || savedChecks.secondThreshold !== 60 || savedChecks.goalSfx !== "victory" ||
      savedChecks.groups?.[0]?.label !== "Pulo (botao B)" || savedChecks.groups?.[0]?.collapsed !== true ||
      savedChecks.jumpPosition.join() !== positionsOrganized.jump.join()) {
    fail(`Arquivo salvo nao reflete as edicoes: ${JSON.stringify(savedChecks)}`);
  }
  // Untouched behaviors keep their exact logic: every shipped node/edge not edited is identical.
  const edited = new Set(["jump", "score_threshold", "goal_sound"]);
  // Editor defaults materialized on save (not read by the SGDK compiler) are allowed and reported.
  const knownDefaults = { event_update: { rate: "frame" } };
  const materializedDefaults = [];
  const changedUntouched = shippedGraph.nodes.filter((n) => {
    if (edited.has(n.id)) return false;
    const s2 = node(saved, n.id);
    if (!s2 || s2.type !== n.type || s2.label !== n.label) return true;
    for (const [key, v] of Object.entries(n.params)) if (JSON.stringify(s2.params[key]) !== JSON.stringify(v)) return true;
    for (const [key, v] of Object.entries(s2.params)) {
      if (key in n.params) continue;
      if (knownDefaults[n.type]?.[key] !== v) return true;
      materializedDefaults.push(`${n.id}.${key}=${v}`);
    }
    return false;
  }).map((n) => n.id);
  const missingEdges = shippedGraph.edges.filter((e) => !saved.edges.some((s) => s.fromNode === e.fromNode && s.fromPort === e.fromPort && s.toNode === e.toNode && s.toPort === e.toPort));
  // The passage editor rewires only the movement gates to add the second passage.
  const allowedRewire = (e) => ["move_right", "move_left"].includes(e.toNode);
  if (changedUntouched.length || missingEdges.some((e) => !allowedRewire(e))) fail(`Comportamentos nao editados mudaram: ${JSON.stringify({ changedUntouched, missingEdges })}`);
  addReportStep(report, "saved_file", "passed", { savedChecks, materializedDefaults, untouchedNodes: shippedGraph.nodes.length - edited.size, rewiredForSecondPassage: missingEdges });

  await deleteSession(sessionId);
  sessionId = await createSession(appPath);
  currentE2eRunContext.sessionId = sessionId;
  await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "App nao reabriu apos reinicio");
  await waitFor(async () => js("return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"), uiBootstrapTimeoutMs, "API nao voltou apos reinicio", 150);
  await setSessionWindowRect(sessionId, 1920, 1080);
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="wizard-existing-project-card"]'));`), 30000, "Wizard nao encontrou o projeto salvo.", 300);
  await click("wizard-open-existing-project", "reabrir projeto");
  await waitFor(async () => (await state())?.activeProjectDir === projectDir, 60000, "Projeto nao reabriu.", 300);
  if (!(await js(`return Boolean(document.querySelector('[data-testid="guided-steps"]'));`))) await click("shell-persona-guiado", "modo guiado apos reinicio");
  await click("guided-step-regras", "etapa Regras apos reinicio");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="nodegraph-rules"]'));`), 15000, "Regras ausentes apos reabrir.", 200);
  await closeVisibleConsoleDrawer(sessionId, "apos reabrir");
  const reopened = await waitFor(async () => {
    const v = {
      jumpRule: await value("rule-edit-jump-button"),
      mainThreshold: await value("passage-passage_main-threshold"),
      secondThreshold: await value("passage-passage_2-threshold"),
      sound: await value("rule-edit-goal_sound-sfx"),
      group: await js(`const el = document.querySelector('[data-testid^="nodegraph-group-box-"]'); return el ? { collapsed: el.dataset.collapsed, label: el.textContent } : null;`),
      positions: await worldPositions(),
    };
    return v.jumpRule ? v : false;
  }, 15000, "Edicoes nao reapareceram.", 200);
  const visibleMatch = Object.entries(reopened.positions).every(([id, pos]) => positionsOrganized[id] && pos.join() === positionsOrganized[id].join());
  if (reopened.jumpRule !== "BUTTON_B" || reopened.mainThreshold !== "12" || reopened.secondThreshold !== "60" || reopened.sound !== "victory" ||
      reopened.group?.collapsed !== "true" || !reopened.group.label.includes("Pulo (botao B)") || !visibleMatch) {
    fail(`Trabalho nao preservado apos reinicio: ${JSON.stringify(reopened)}`);
  }
  await click("nodegraph-fit-view", "enquadrar apos reabrir");
  await pause(400);
  const reopenedGeometry = await geometry("apos reabrir");
  assertAligned(reopenedGeometry, "apos reabrir");
  if (reopenedGeometry.overlaps.length) fail(`Sobreposicao apos reabrir: ${JSON.stringify(reopenedGeometry.overlaps)}`);
  await shot("07-reopened", "grafo reaberto: organizado, agrupado e editado");
  addReportStep(report, "restart_reopen", "passed", { ...reopened, positions: undefined, visibleMatch, geometry: reopenedGeometry });

  // 11. Build and play with the real keyboard.
  await click("guided-step-testar", "etapa Testar");
  const running = await waitFor(async () => {
    const current = await state();
    const frame = await readCanonicalGameFrame(sessionId);
    return current?.emulatorLoaded && frame?.renderedFrames > 5 && frame.romSha256 ? { frame } : false;
  }, 300000, "Build & Run nao iniciou o jogo.", 500).catch(async (error) => {
    await shot("build-run-failure", "falha do Build & Run");
    const entries = ((await state())?.consoleEntries ?? []).filter((entry) => entry.level !== "info").slice(-12);
    fail(`${error.message} console=${JSON.stringify(entries).slice(0, 4000)}`);
  });
  const romPath = path.join(projectDir, "build", "megadrive", "out", "rom.bin");
  const romCopy = path.join(validationDir, `${artifactPrefix}-played.rom`);
  await cp(romPath, romCopy);
  const romSha256 = createHash("sha256").update(await readFile(romCopy)).digest("hex");
  if (running.frame.romSha256 !== romSha256) fail(`Game View executa outra ROM: ${JSON.stringify({ running: running.frame.romSha256, romSha256 })}`);
  const symbols = parseElf32Symbols(await readFile(path.join(projectDir, "build", "megadrive", "out", "rom.out")));
  const watch = ["spr_player_x", "spr_player_y", "logic_var_reference_score", "logic_var_goal_open", "logic_var_passage_2_open", "logic_var_goal_reached", "spr_player_vel_y", "rds_joy_prev_1"]
    .map((name) => ({ name, address: symbols.get(name), width: name.endsWith("vel_y") || name.startsWith("logic_") ? 4 : 2 }));
  if (watch.some((entry) => !Number.isInteger(entry.address))) fail(`Simbolos ausentes: ${JSON.stringify(watch)}`);
  const observe = async () => {
    const raw = await executeAsyncScript(sessionId, `
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      Promise.all(arguments[0].map((entry) => invoke("emulator_read_memory", { region: 2, offset: entry.address & 0xffff, length: entry.width })))
        .then((results) => done({ ok: true, data: results.map((r) => Array.from(r.data)), audioTotal: window.__RDS_E2E__.readReceivedAudioSamples(0, 0).total }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `, [watch]);
    if (!raw?.ok) fail(`Leitura de WRAM falhou: ${JSON.stringify(raw)}`);
    const decode = (d, width) => {
      const word = (i) => d[i] | (d[i + 1] << 8);
      if (width === 2) { const w = word(0); return w > 0x7fff ? w - 0x10000 : w; }
      const v = ((word(0) << 16) >>> 0) | word(2);
      return v > 0x7fffffff ? v - 0x100000000 : v;
    };
    const values = watch.map((entry, index) => decode(raw.data[index], entry.width));
    return { x: values[0], y: values[1], score: values[2], mainOpen: values[3], secondOpen: values[4], goal: values[5], velY: values[6], joyPrev: values[7], frame: (await readCanonicalGameFrame(sessionId))?.renderedFrames ?? 0, audioTotal: raw.audioTotal, t: Date.now() };
  };
  const waitAck = (button, expected, context) => waitFor(async () => {
    const observation = await js("return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return observation?.lastJoypadAck?.joypad?.[button] === expected ? observation.lastJoypadAck : false;
  }, 4000, `${context}: ACK nativo (${button}=${expected}) ausente.`, 50);
  const sampleY = async (ms) => {
    const samples = [];
    const end = Date.now() + ms;
    const hardEnd = Date.now() + 20000;
    while ((Date.now() < end || samples.length === 0 || samples[samples.length - 1].frame - samples[0].frame < 3) && Date.now() < hardEnd) {
      samples.push(await observe());
      await pause(20);
    }
    if (samples[samples.length - 1].frame - samples[0].frame < 3) fail(`ROM nao avancou quadros durante input: ${JSON.stringify(samples.slice(-4))}`);
    return samples;
  };
  await closeVisibleConsoleDrawer(sessionId, "antes de jogar");
  await focusGameCanvasNatively(sessionId);
  const acks = [];
  // Standing still until the physics settles on the floor.
  let groundY = null;
  const settleSamples = [];
  await waitFor(async () => {
    const sample = await observe();
    settleSamples.push(sample);
    groundY = sample.y;
    return settleSamples.length >= 4 && sample.frame > settleSamples[0].frame && settleSamples.slice(-4).every((s) => s.y === groundY);
  }, 20000, "Personagem nao pousou.", 100).catch(async (error) => {
    await writeFile(path.join(validationDir, `${artifactPrefix}-settle-trace.json`), JSON.stringify({ appSha256: report.testedApplication.sha256, romSha256, projectDir, watch, settleSamples }, null, 2));
    throw error;
  });
  // Old binding (Z = button A) must no longer jump.
  await sendNativeGameKey(sessionId, "KeyZ", "keyDown", "Z (antigo pulo)");
  acks.push(await waitAck("y", true, "Z"));
  const zSamples = await sampleY(2500);
  await sendNativeGameKey(sessionId, "KeyZ", "keyUp", "soltar Z");
  acks.push(await waitAck("y", false, "soltar Z"));
  // New binding (X = button B) jumps.
  await pause(300);
  await sendNativeGameKey(sessionId, "KeyX", "keyDown", "X (novo pulo)");
  acks.push(await waitAck("b", true, "X"));
  const xSamples = await sampleY(2500);
  await sendNativeGameKey(sessionId, "KeyX", "keyUp", "soltar X");
  acks.push(await waitAck("b", false, "soltar X"));
  const jumpProof = { groundY, zMinY: Math.min(...zSamples.map((s) => s.y)), xMinY: Math.min(...xSamples.map((s) => s.y)), zSamples: zSamples.length, xSamples: xSamples.length };
  const jumpTracePath = path.join(validationDir, `${artifactPrefix}-jump-trace.json`);
  await writeFile(jumpTracePath, JSON.stringify({ appSha256: report.testedApplication.sha256, romSha256, projectDir, watch, acks, zSamples, xSamples }, null, 2));
  addReportArtifact(report, jumpTracePath, "input nativo e trajetoria RAM do salto editado");
  if (jumpProof.zMinY < groundY - 1) fail(`Tecla Z ainda faz pular apos trocar para o botao B: ${JSON.stringify(jumpProof)}`);
  if (!(jumpProof.xMinY <= groundY - 8)) fail(`Tecla X (botao B) nao fez pular: ${JSON.stringify(jumpProof)}`);
  await waitFor(async () => (await observe()).y === groundY, 10000, "Personagem nao voltou ao chao.", 100);
  // Walk right to the goal: untouched walking, score, both passages and goal logic.
  const timeline = [];
  await sendNativeGameKey(sessionId, "ArrowRight", "keyDown", "andar para a direita");
  acks.push(await waitAck("right", true, "segurar direita"));
  const deadline = Date.now() + 240000;
  let current = await observe();
  while (current.goal !== 1 && Date.now() < deadline) {
    timeline.push(current);
    await pause(40);
    current = await observe();
  }
  timeline.push(current);
  const victory = current;
  const rate = 44100;
  await waitFor(async () => (await js("return window.__RDS_E2E__.readReceivedAudioSamples(0, 0).total;")) > victory.audioTotal + rate * 2 * 0.8, 60000, "Audio pos-vitoria nao chegou.", 200);
  await sendNativeGameKey(sessionId, "ArrowRight", "keyUp", "soltar direita");
  acks.push(await waitAck("right", false, "soltar direita"));
  const timelinePath = path.join(validationDir, `${artifactPrefix}-play-timeline.json`);
  await writeFile(timelinePath, JSON.stringify({ jumpProof, timeline }, null, 2));
  addReportArtifact(report, timelinePath, "linha do tempo do jogo por teclado");
  await shot("08-victory", "jogo apos vencer pelo teclado");
  const mainOpenedAt = timeline.find((t) => t.mainOpen === 1);
  const secondOpenedAt = timeline.find((t) => t.secondOpen === 1);
  const crossedSecondClosed = timeline.filter((t) => t.secondOpen === 0 && t.x > 106);
  if (victory.goal !== 1) fail(`Vitoria nao alcancada pelo teclado: ${JSON.stringify(victory)}`);
  const openedEarly = timeline.filter((t) => (t.mainOpen === 1 && t.score < 12) || (t.secondOpen === 1 && t.score < 60));
  // Shipped threshold was 6: a closed main passage observed at score 6..11 shows the edit reached the ROM.
  const closedAtOldThreshold = timeline.find((t) => t.mainOpen === 0 && t.score >= 6 && t.score < 12) ?? null;
  if (!mainOpenedAt || !secondOpenedAt || openedEarly.length || crossedSecondClosed.length) {
    fail(`Passagens nao respeitaram os limiares 12/60: ${JSON.stringify({ mainOpenedAt, secondOpenedAt, openedEarly: openedEarly.slice(0, 3), crossedSecondClosed: crossedSecondClosed.length })}`);
  }
  const window = Math.floor(rate * 2 * 0.6);
  const after = await js("return window.__RDS_E2E__.readReceivedAudioSamples(arguments[0], arguments[1]);", [Math.max(0, victory.audioTotal - Math.floor(rate * 2 * 0.3)), window + Math.floor(rate * 2 * 0.3)]);
  const beforeAudio = await js("return window.__RDS_E2E__.readReceivedAudioSamples(arguments[0], arguments[1]);", [Math.max(0, victory.audioTotal - Math.floor(rate * 2 * 1.6)), window]);
  const power = (samples, sampleRate, frequency) => {
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const coeff = 2 * Math.cos(omega);
    let s1 = 0, s2 = 0, n = 0;
    for (let i = 0; i < samples.length; i += 2) { const s0 = samples[i] + coeff * s1 - s2; s2 = s1; s1 = s0; n += 1; }
    return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, n * n);
  };
  if (!Array.isArray(after?.samples) || !Array.isArray(beforeAudio?.samples)) fail("Amostras de audio indisponiveis.");
  const sampleRate = after.sampleRate || rate;
  const audio = {
    sampleRate,
    before: { p1320: power(beforeAudio.samples, sampleRate, 1320), p880: power(beforeAudio.samples, sampleRate, 880) },
    after: { p1320: power(after.samples, sampleRate, 1320), p880: power(after.samples, sampleRate, 880) },
  };
  if (!(audio.after.p1320 > 20 * Math.max(1, audio.before.p1320) && audio.after.p1320 > 5 * Math.max(1, audio.after.p880))) {
    fail(`Som associado (victory, 1320 Hz) nao foi produzido na vitoria: ${JSON.stringify(audio)}`);
  }
  addReportStep(report, "keyboard_play", "passed", { rom: { path: romCopy, sha256: romSha256 }, acks: acks.length, jumpProof, mainOpenedAt, secondOpenedAt, closedAtOldThreshold, samples: timeline.length, victory, audio });

  // 12. Larger graph (after the gameplay proof): append guided blocks to the same graph,
  // organize it and record timings. The temporary project is discarded afterwards.
  await click("guided-step-regras", "etapa Regras (grafo maior)");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid^="nodegraph-append-template-"]'));`), 15000, "Blocos guiados ausentes.", 200);
  const perf = { baseNodes: await js(`return document.querySelectorAll('[data-testid^="node-card-"]').length + document.querySelectorAll('[data-testid^="nodegraph-group-box-"][data-collapsed="true"]').length * 4;`) };
  for (let round = 0; round < 6; round += 1) {
    const templates = await js(`return [...document.querySelectorAll('[data-testid^="nodegraph-append-template-"]')].map((el) => el.dataset.testid);`);
    await click(templates[round % templates.length], `bloco guiado ${round + 1}`);
    await pause(250);
  }
  perf.visibleNodes = await js(`return document.querySelectorAll('[data-testid^="node-card-"]').length;`);
  perf.totalNodes = await js(`return Number(document.querySelector('[data-testid="nodegraph-overview"]')?.textContent.match(/(\\d+) nos/)?.[1] ?? 0);`);
  const bigStarted = Date.now();
  await click("nodegraph-organize-all", "organizar grafo maior");
  perf.report = await waitFor(async () => js(`const el = document.querySelector('[data-testid="nodegraph-layout-report"]'); return el && el.dataset.moved !== undefined ? { ...el.dataset } : null;`), 10000, "Relatorio do grafo maior ausente.", 50);
  perf.uiMs = Date.now() - bigStarted;
  await pause(500);
  perf.geometry = await geometry("grafo maior");
  assertAligned(perf.geometry, "grafo maior");
  if (perf.geometry.overlaps.length || perf.report.overlaps !== "0") fail(`Grafo maior com sobreposicao: ${JSON.stringify(perf)}`);
  await shot("09-larger-graph", "grafo maior organizado");
  addReportStep(report, "larger_graph_performance", "passed", perf);

  const savedReport = await writeCreateGameReport(report, reportPath);
  console.log(`Relatorio: ${savedReport}`);
  console.log("OK: Desktop Tauri NodeGraph authoring (localizar pulo, trocar botao, limiar, som, organizar/desfazer, grupo, reinicio, teclado ate a vitoria) passou.");
}

/**
 * Reusable behaviors proof (Experimental): through the normal UI with native WebDriver
 * input — duplicate the player twice, give each copy its own "Movimento e salto" with
 * different controls/speeds, a gated passage on the second, refuse an invalid parameter,
 * edit the second (undo/redo with the real keyboard), duplicate an entity that has a
 * behavior (remapped), remove that copy's instance, save/restart/reopen, build and play
 * with the real keyboard. RAM is only observed.
 */
async function runBehaviorsIndependenceScenario(initialSessionId, appPath, uiBootstrapTimeoutMs, onProjectCreated) {
  let sessionId = initialSessionId;
  const artifactPrefix = `behaviors-independence-${artifactTimestamp()}`;
  const reportPath = path.join(validationDir, `${artifactPrefix}-report.json`);
  const report = {
    generatedAt: null,
    scenario: "behaviors-independence",
    testedApplication: { path: appPath, sha256: createHash("sha256").update(await readFile(appPath)).digest("hex") },
    artifacts: [],
    steps: [],
    frames: [],
    roms: [],
  };
  const shot = async (name, label) => addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-${name}.png`), label);
  const state = () => readAutomationState(sessionId);
  const js = (script, args = []) => executeScript(sessionId, script, args);
  const click = (testId, label = testId) => clickButtonByTestIdNative(sessionId, testId, label);
  const find = (selector) => findElement(sessionId, selector).catch(async (error) => {
    const visible = await js(`return [...document.querySelectorAll('[data-testid]')].map((el) => el.dataset.testid).filter((id) => /hierarchy-entity|entity-switch|behavior-|inspector-dup/.test(id)).slice(0, 60);`).catch(() => null);
    fail(`Elemento nao encontrado: ${selector} (${error.message}) presentes=${JSON.stringify(visible)}`);
  });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const value = (testId) => js(`return document.querySelector('[data-testid="' + arguments[0] + '"]')?.value ?? null;`, [testId]);
  const text = (testId) => js(`return document.querySelector('[data-testid="' + arguments[0] + '"]')?.textContent ?? null;`, [testId]);
  const selectOption = async (testId, optionValue) => {
    await js(`document.querySelector('[data-testid="' + arguments[0] + '"]')?.scrollIntoView({ block: "center", inline: "center" });`, [testId]);
    const elementId = await find(`[data-testid="${testId}"] option[value="${optionValue}"]`);
    await webdriverRequest("POST", `/session/${sessionId}/element/${elementId}/click`, {});
    await waitFor(async () => (await value(testId)) === optionValue, 5000, `Selecao ${testId}=${optionValue} nao aplicada.`, 100);
  };
  const setNumber = async (testId, numberValue) => {
    await js(`document.querySelector('[data-testid="' + arguments[0] + '"]')?.scrollIntoView({ block: "center" });`, [testId]);
    await setInputByTestIdNative(sessionId, testId, String(numberValue));
    await waitFor(async () => (await value(testId)) === String(numberValue), 5000, `${testId} nao virou ${numberValue}.`, 100);
  };
  const chord = async (key) => webdriverRequest("POST", `/session/${sessionId}/actions`, {
    actions: [{ type: "key", id: "rds-chord", actions: [
      { type: "keyDown", value: "" }, { type: "keyDown", value: key }, { type: "keyUp", value: key }, { type: "keyUp", value: "" },
    ] }],
  });
  const waitSelected = (entityId) => waitFor(async () => (await state())?.selectedEntityId === entityId, 10000, `${entityId} nao selecionado.`, 150);
  const clickHierarchy = async (entityId) => {
    const selector = `[data-testid='hierarchy-entity-${entityId}']`;
    await waitFor(async () => js(`return Boolean(document.querySelector(arguments[0]));`, [selector]), 15000, `Hierarquia sem ${entityId}.`, 150);
    await js(`document.querySelector(arguments[0])?.scrollIntoView({ block: "center" });`, [selector]);
    await webdriverRequest("POST", `/session/${sessionId}/element/${await find(selector)}/click`, {});
    await waitSelected(entityId);
  };
  const instances = () => js(`return [...document.querySelectorAll('[data-testid^="behavior-instance-"]')].map((el) => ({ id: el.dataset.testid.slice(18), text: el.textContent }));`);
  const switchLogic = async (entityId) => {
    // The Logic view is lazy (Suspense): wait until the switcher offers this entity.
    await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="nodegraph-entity-switch"] option[value="' + arguments[0] + '"]'));`, [entityId]), 20000, `Seletor de logica sem ${entityId}.`, 150);
    await selectOption("nodegraph-entity-switch", entityId);
    await waitSelected(entityId);
    await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="nodegraph-behaviors"]'));`), 10000, "Painel de comportamentos ausente.", 150);
  };
  const addMovement = async (config) => {
    await click("behavior-add-platform_movement", "adicionar Movimento e salto");
    if ((await value("behavior-param-target")) !== config.target) fail(`Alvo padrao inesperado: ${await value("behavior-param-target")}`);
    await setNumber("behavior-param-speed", config.speed);
    await selectOption("behavior-param-right_button", config.right);
    await selectOption("behavior-param-left_button", config.left);
    await selectOption("behavior-param-jump_button", config.jump);
    await setNumber("behavior-param-jump_strength", config.strength);
    if (config.sound !== undefined) await selectOption("behavior-param-jump_sound", config.sound);
    const summary = await text("behavior-summary");
    await click("behavior-apply", "aplicar comportamento");
    return summary;
  };

  // 1. Project and two copies of the player (manual logic is NOT copied — warned first).
  await setSessionWindowRect(sessionId, 1920, 1080);
  await waitForOnboardingWizard(sessionId);
  await click("template-card-reference_platformer", "modelo de fase de referencia");
  await clickButtonByText(sessionId, "Mega Drive", "exact");
  const projectName = `Behaviors_${Date.now()}`;
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await clickButtonByText(sessionId, "Criar Projeto", "exact");
  const created = await waitFor(async () => {
    const current = await state();
    return current?.activeProjectDir && current.activeProjectName === projectName ? current : false;
  }, 60000, "Wizard nao criou o projeto.", 500);
  const projectDir = created.activeProjectDir;
  onProjectCreated(projectDir);
  currentE2eRunContext.project = projectDir;
  await click("shell-persona-guiado", "modo guiado");
  await click("guided-step-personagem", "etapa Personagem");
  await waitSelected("player");
  const duplicatePlayer = async (expectedId, x) => {
    await clickHierarchy("player");
    await click("inspector-duplicate-entity", "duplicar jogador");
    const warning = await waitFor(async () => text("inspector-duplicate-warning"), 5000, "Aviso de logica manual nao apareceu antes de duplicar.", 100);
    await click("inspector-duplicate-confirm", "duplicar sem logica manual");
    await waitSelected(expectedId);
    await setInputByTestIdNative(sessionId, "inspector-transform-x", String(x));
    await waitFor(async () => (await state())?.activeScene?.entities?.find((entity) => entity.id === expectedId)?.x === x, 10000, `${expectedId} nao foi para x=${x}.`, 150);
    return warning;
  };
  const warning2 = await duplicatePlayer("player_2", 200);
  // Player 3 starts overlapping its own blocker (x=90..114) to exercise "starts overlapped".
  await duplicatePlayer("player_3", 100);
  // Blockers (24x32): A left of Player 2, B right of Player 2, C for Player 3.
  const duplicateBlocker = async (expectedId, x) => {
    await clickHierarchy("passage_blocker");
    await click("inspector-duplicate-entity", "duplicar bloqueio");
    await waitSelected(expectedId);
    await setInputByTestIdNative(sessionId, "inspector-transform-x", String(x));
    await waitFor(async () => (await state())?.activeScene?.entities?.find((entity) => entity.id === expectedId)?.x === x, 10000, `${expectedId} nao foi para x=${x}.`, 150);
  };
  await duplicateBlocker("passage_blocker_2", 150);
  await duplicateBlocker("passage_blocker_3", 250);
  await duplicateBlocker("passage_blocker_4", 90);
  addReportStep(report, "duplicate_players_and_blockers", "passed", { warning: warning2, blockers: { A: 150, B: 250, C: 90 }, player2X: 200, player3X: 100 });

  // 2. Behaviors through the Logic view.
  await click("guided-step-regras", "etapa Regras");
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="nodegraph-entity-switch"]'));`), 15000, "Editor de logica ausente.", 200);
  await closeVisibleConsoleDrawer(sessionId, "antes dos comportamentos");
  await switchLogic("player_2");
  // Maximum supported speed (8 px/frame) to catch tunneling through a blocker in one step.
  const summaryA = await addMovement({ target: "player_2", speed: 8, right: "BUTTON_RIGHT", left: "BUTTON_LEFT", jump: "BUTTON_B", strength: 64, sound: "jump" });
  const [instanceA] = await waitFor(async () => { const list = await instances(); return list.length === 1 ? list : false; }, 5000, "Instancia A nao apareceu.", 100);
  const addPassage = async (movementId, blocker, threshold) => {
    await click("behavior-add-gated_passage", "adicionar Passagem condicionada");
    await selectOption("behavior-param-movement", movementId);
    await selectOption("behavior-param-blocker", blocker);
    await selectOption("behavior-param-state_variable", "reference_score");
    await setNumber("behavior-param-threshold", threshold);
    const summary = await text("behavior-summary");
    const before = (await instances()).length;
    await click("behavior-apply", `aplicar passagem ${blocker}`);
    await waitFor(async () => (await instances()).length === before + 1, 5000, `Passagem ${blocker} nao apareceu.`, 100);
    return { summary, id: (await instances()).map((entry) => entry.id).find((id) => id.startsWith(`bh_pass_${blocker}`)) };
  };
  const passageRight2 = await addPassage(instanceA.id, "passage_blocker_3", 20);
  const passageLeft2 = await addPassage(instanceA.id, "passage_blocker_2", 20);
  await shot("01-behavior-player2", "Movimento e salto aplicado em Player 2");

  await switchLogic("player_3");
  // Invalid parameter is refused with a message (Apply disabled).
  await click("behavior-add-platform_movement", "adicionar Movimento (negativo)");
  await setNumber("behavior-param-speed", 0);
  const invalid = await waitFor(async () => text("behavior-errors"), 5000, "Erro de parametro invalido nao apareceu.", 100);
  const applyDisabled = await js(`return document.querySelector('[data-testid="behavior-apply"]')?.disabled === true;`);
  if (!invalid.includes("entre 1 e 8") || !applyDisabled) fail(`Parametro invalido nao foi recusado: ${JSON.stringify({ invalid, applyDisabled })}`);
  await click("behavior-cancel", "cancelar");
  const summaryB = await addMovement({ target: "player_3", speed: 2, right: "BUTTON_C", left: "BUTTON_A", jump: "BUTTON_START", strength: 40 });
  const [instanceB] = await waitFor(async () => { const list = await instances(); return list.length === 1 ? list : false; }, 5000, "Instancia B nao apareceu.", 100);
  // Player 3's own passage: a different threshold (60) on its own blocker.
  const passage3 = await addPassage(instanceB.id, "passage_blocker_4", 60);
  const passageId = passage3.id;
  addReportStep(report, "apply_behaviors", "passed", { instanceA, summaryA, passageRight2, passageLeft2, instanceB, summaryB, passage3, invalid });

  // 3. Edit the second instance (2 -> 3), undo/redo with the real keyboard.
  await click(`behavior-edit-${instanceB.id}`, "editar comportamento de Player 3");
  await setNumber("behavior-param-speed", 3);
  await click("behavior-apply", "salvar edicao");
  const speedIn = async () => (await instances()).find((entry) => entry.id === instanceB.id)?.text ?? "";
  await waitFor(async () => (await speedIn()).includes("anda 3 px"), 5000, "Edicao nao aplicada.", 100);
  await js(`document.activeElement?.blur?.();`);
  await chord("z");
  await waitFor(async () => (await speedIn()).includes("anda 2 px"), 10000, "Ctrl+Z nao desfez a edicao.", 150);
  await chord("y");
  await waitFor(async () => (await speedIn()).includes("anda 3 px"), 10000, "Ctrl+Y nao refez a edicao.", 150);
  await switchLogic("player_2");
  const aAfter = (await instances())[0];
  if (!aAfter?.text.includes("anda 8 px") || aAfter.id !== instanceA.id) fail(`Editar Player 3 alterou Player 2: ${JSON.stringify(aAfter)}`);
  await shot("02-player2-unchanged", "Player 2 inalterado apos editar Player 3");
  addReportStep(report, "edit_undo_redo", "passed", { instanceA: aAfter });

  // 4. Duplicate an entity that has a behavior: ids/target remapped, no warning (no manual logic).
  await click("guided-step-personagem", "etapa Personagem");
  await clickHierarchy("player_2");
  await click("inspector-duplicate-entity", "duplicar Player 2 (com comportamento)");
  await waitSelected("player_2_2");
  if (await js(`return Boolean(document.querySelector('[data-testid="inspector-duplicate-warning"]'));`)) fail("Aviso de logica manual indevido ao duplicar entidade so com comportamentos.");
  await click("guided-step-regras", "etapa Regras");
  await switchLogic("player_2_2");
  const copiedAll = await waitFor(async () => { const list = await instances(); return list.length === 3 ? list : false; }, 5000, "Copia sem os 3 comportamentos.", 100);
  const copied = copiedAll.find((entry) => entry.id.startsWith("bh_move_"));
  if (!copied || copied.id === instanceA.id || !copied.text.includes("Player 2 2")) fail(`Comportamento copiado nao foi remapeado: ${JSON.stringify(copiedAll)}`);
  if (copiedAll.some((entry) => entry.id === passageRight2.id || entry.id === passageLeft2.id)) fail(`Passagens copiadas reutilizaram ids (estado compartilhado): ${JSON.stringify(copiedAll)}`);
  // Save now to check the remap in the file, then remove the copy's instance.
  await clickTopBarMenuAction(sessionId, "Salvar");
  await waitFor(async () => (await js(`return document.querySelector('[data-testid="scene-save-status"]')?.dataset.status;`)) === "saved", 20000, "Salvar nao concluiu.", 200);
  const sceneFile = () => readFile(path.join(projectDir, "scenes", "main.json"), "utf8").then(JSON.parse);
  const logicOf = (sceneJson, id) => {
    const entity = sceneJson.entities.find((candidate) => candidate.entity_id === id);
    return { graph: entity?.components?.logic?.graph ? JSON.parse(entity.components.logic.graph) : null, graphRef: entity?.components?.logic?.graph_ref ?? null };
  };
  const savedCopy = logicOf(await sceneFile(), "player_2_2");
  const copyMoves = savedCopy.graph?.nodes.filter((node) => node.type === "sprite_move") ?? [];
  if (savedCopy.graphRef || !copyMoves.length || copyMoves.some((node) => node.params.target !== "player_2_2" || node.id.startsWith(instanceA.id))) {
    fail(`Remapeamento incorreto na copia: ${JSON.stringify({ graphRef: savedCopy.graphRef, copyMoves })}`);
  }
  for (const id of ["player_2", "player_3"]) if (logicOf(await sceneFile(), id).graphRef) fail(`${id} herdou o graph_ref do jogador (estado compartilhado).`);
  // Removing the movement first is refused (passages depend on it), with a useful message.
  await click(`behavior-remove-${copied.id}`, "remover movimento da copia (negativo)");
  const refusal = await waitFor(async () => text("behavior-errors"), 5000, "Remocao com dependentes nao foi recusada.", 100);
  if (!refusal.includes("depende")) fail(`Mensagem de dependencia ausente: ${refusal}`);
  await click("behavior-cancel", "cancelar");
  for (const entry of copiedAll.filter((candidate) => candidate.id !== copied.id)) {
    await click(`behavior-remove-${entry.id}`, "remover passagem da copia");
    await click("behavior-remove-confirm", "confirmar remocao");
  }
  await click(`behavior-remove-${copied.id}`, "remover movimento da copia");
  await click("behavior-remove-confirm", "confirmar remocao");
  await waitFor(async () => (await instances()).length === 0, 5000, "Remocao nao aplicada.", 100);
  await switchLogic("player_2");
  const p2Instances = await instances();
  if (p2Instances.length !== 3 || p2Instances[0]?.id !== instanceA.id) fail(`Remover as instancias da copia afetou Player 2: ${JSON.stringify(p2Instances)}`);
  addReportStep(report, "duplicate_remap_remove", "passed", { copiedAll, refusal, copyMoves: copyMoves.map((node) => ({ id: node.id, target: node.params.target, dx: node.params.dx })) });

  // 5. Save, restart, reopen and check persistence.
  await clickTopBarMenuAction(sessionId, "Salvar");
  await waitFor(async () => (await js(`return document.querySelector('[data-testid="scene-save-status"]')?.dataset.status;`)) === "saved", 20000, "Salvar nao concluiu.", 200);
  await deleteSession(sessionId);
  sessionId = await createSession(appPath);
  currentE2eRunContext.sessionId = sessionId;
  await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "App nao reabriu apos reinicio");
  await waitFor(async () => js("return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"), uiBootstrapTimeoutMs, "API nao voltou apos reinicio", 150);
  await setSessionWindowRect(sessionId, 1920, 1080);
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="wizard-existing-project-card"]'));`), 30000, "Wizard nao encontrou o projeto salvo.", 300);
  await click("wizard-open-existing-project", "reabrir projeto");
  await waitFor(async () => (await state())?.activeProjectDir === projectDir, 60000, "Projeto nao reabriu.", 300);
  if (!(await js(`return Boolean(document.querySelector('[data-testid="guided-steps"]'));`))) await click("shell-persona-guiado", "modo guiado apos reinicio");
  await click("guided-step-regras", "etapa Regras apos reinicio");
  await closeVisibleConsoleDrawer(sessionId, "apos reabrir");
  await switchLogic("player_2");
  const reopenedA = await instances();
  await switchLogic("player_3");
  const reopenedB = await instances();
  await switchLogic("player_2_2");
  const reopenedCopy = await instances();
  const issuesText = await js(`return document.querySelector('[data-testid="nodegraph-behaviors"]')?.textContent ?? "";`);
  if (reopenedA.length !== 3 || !reopenedA[0].text.includes("anda 8 px") || reopenedA.filter((entry) => entry.text.includes("reference_score >= 20")).length !== 2 ||
      reopenedB.length !== 2 || !reopenedB.some((entry) => entry.text.includes("anda 3 px")) ||
      !reopenedB.some((entry) => entry.text.includes("reference_score >= 60")) || reopenedCopy.length !== 0) {
    fail(`Comportamentos nao persistiram: ${JSON.stringify({ reopenedA, reopenedB, reopenedCopy, issuesText })}`);
  }
  await switchLogic("player_3");
  await shot("03-reopened", "comportamentos apos reiniciar e reabrir");
  addReportStep(report, "restart_reopen", "passed", { reopenedA, reopenedB, reopenedCopy });

  // 6. Build and play with the real keyboard.
  await click("guided-step-testar", "etapa Testar");
  const running = await waitFor(async () => {
    const current = await state();
    const frame = await readCanonicalGameFrame(sessionId);
    return current?.emulatorLoaded && frame?.renderedFrames > 5 && frame.romSha256 ? { frame } : false;
  }, 300000, "Build & Run nao iniciou o jogo.", 500).catch(async (error) => {
    await shot("build-run-failure", "falha do Build & Run");
    const entries = ((await state())?.consoleEntries ?? []).filter((entry) => entry.level !== "info").slice(-12);
    fail(`${error.message} console=${JSON.stringify(entries).slice(0, 4000)}`);
  });
  const romPath = path.join(projectDir, "build", "megadrive", "out", "rom.bin");
  const romCopy = path.join(validationDir, `${artifactPrefix}-played.rom`);
  await cp(romPath, romCopy);
  const romSha256 = createHash("sha256").update(await readFile(romCopy)).digest("hex");
  if (running.frame.romSha256 !== romSha256) fail("Game View executa outra ROM.");
  const symbols = parseElf32Symbols(await readFile(path.join(projectDir, "build", "megadrive", "out", "rom.out")));
  const spriteSymbol = (id, axis) => {
    const exact = `spr_${id}_${axis}`;
    if (symbols.has(exact)) return exact;
    return [...symbols.keys()].find((name) => new RegExp(`^spr_.*__${id}_${axis}$`).test(name)) ?? exact;
  };
  const tracked = ["player", "player_2", "player_3", "player_2_2"];
  const watch = [
    ...tracked.flatMap((id) => ["x", "y"].map((axis) => ({ name: spriteSymbol(id, axis), width: 2 }))),
    { name: "logic_var_reference_score", width: 4 },
    { name: `logic_var_${passageRight2.id}_open`, width: 4 },
    { name: `logic_var_${passageLeft2.id}_open`, width: 4 },
    { name: `logic_var_${passageId}_open`, width: 4 },
    { name: `${spriteSymbol("player_2", "y").slice(0, -2)}_vel_y`, width: 4 },
    { name: `${spriteSymbol("player_2", "y").slice(0, -2)}_on_ground`, width: 2 },
    { name: "rds_joy_prev_1", width: 2 },
    { name: `${spriteSymbol("player_3", "y").slice(0, -2)}_on_ground`, width: 2 },
  ].map((entry) => ({ ...entry, address: symbols.get(entry.name) }));
  if (watch.some((entry) => !Number.isInteger(entry.address))) fail(`Simbolos ausentes: ${JSON.stringify(watch.filter((entry) => !Number.isInteger(entry.address)).map((entry) => entry.name))}`);
  // Collision boxes exactly as the ROM computes them (position + collision offset, size).
  const prefab = async (file) => JSON.parse(await readFile(path.join(projectDir, "prefabs", file), "utf8"));
  const playerCollision = (await prefab("reference_player.json")).components.collision;
  const blockerCollision = (await prefab("reference_passage.json")).components.collision;
  const sceneNow = JSON.parse(await readFile(path.join(projectDir, "scenes", "main.json"), "utf8"));
  const blockerX = (id) => sceneNow.entities.find((entity) => entity.entity_id === id).transform.x + (blockerCollision.offset?.x ?? 0);
  const box = (x) => ({ left: x + (playerCollision.offset?.x ?? 0), right: x + (playerCollision.offset?.x ?? 0) + playerCollision.width });
  const blocker = (id) => ({ left: blockerX(id), right: blockerX(id) + blockerCollision.width });
  const A = blocker("passage_blocker_2");
  const B = blocker("passage_blocker_3");
  const C = blocker("passage_blocker_4");
  const intersects = (x, b) => box(x).left < b.right && box(x).right > b.left;
  const observe = async () => {
    const raw = await executeAsyncScript(sessionId, `
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      Promise.all(arguments[0].map((entry) => invoke("emulator_read_memory", { region: 2, offset: entry.address & 0xffff, length: entry.width })))
        .then((results) => done({ ok: true, data: results.map((r) => Array.from(r.data)) }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `, [watch]);
    if (!raw?.ok) fail(`Leitura de WRAM falhou: ${JSON.stringify(raw)}`);
    const decode = (d, width) => {
      const word = (i) => d[i] | (d[i + 1] << 8);
      if (width === 2) { const w = word(0); return w > 0x7fff ? w - 0x10000 : w; }
      const v = ((word(0) << 16) >>> 0) | word(2);
      return v > 0x7fffffff ? v - 0x100000000 : v;
    };
    const v = watch.map((entry, index) => decode(raw.data[index], entry.width));
    return { p1: [v[0], v[1]], p2: [v[2], v[3]], p3: [v[4], v[5]], copy: [v[6], v[7]], score: v[8], openB: v[9], openA: v[10], openC: v[11], p2VelY: v[12], p2OnGround: v[13], joyPrev: v[14], p3OnGround: v[15], frame: (await readCanonicalGameFrame(sessionId))?.renderedFrames ?? 0 };
  };
  const waitAck = (button, expected, context) => waitFor(async () => {
    const observation = await js("return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return observation?.lastJoypadAck?.joypad?.[button] === expected ? observation.lastJoypadAck : false;
  }, 4000, `${context}: ACK nativo (${button}=${expected}) ausente.`, 50);
  const KEY_BUTTON = { ArrowRight: "right", ArrowLeft: "left", KeyC: "a", KeyZ: "y", KeyX: "b", Enter: "start" };
  const down = async (code, label) => { await sendNativeGameKey(sessionId, code, "keyDown", label); await waitAck(KEY_BUTTON[code], true, label); };
  const up = async (code, label) => {
    await sendNativeGameKey(sessionId, code, "keyUp", `soltar ${label}`);
    await waitAck(KEY_BUTTON[code], false, `soltar ${label}`);
    if (code === "KeyX") {
      await waitFor(async () => ((await observe()).joyPrev & 0x10) === 0, 20000, `${label}: ROM nao consumiu a liberacao de B`, 30);
    }
  };
  // Samples until `done(samples)` or the emulated-frame budget runs out.
  const sampleUntil = async (done, maxFrames, label, pollMs = 20) => {
    const samples = [await observe()];
    const startFrame = samples[0].frame;
    const cap = Date.now() + 90000;
    while (!done(samples) && samples[samples.length - 1].frame - startFrame < maxFrames && Date.now() < cap) {
      await pause(pollMs);
      samples.push(await observe());
    }
    if (!done(samples)) {
      const tracePath = path.join(validationDir, `${artifactPrefix}-failed-${label.replace(/[^a-z0-9]+/gi, "-")}-trace.json`);
      await writeFile(tracePath, JSON.stringify({ appSha256: report.testedApplication.sha256, romSha256, romCopy, projectDir, watch, tapTrace, input: await js("return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;"), samples }, null, 2));
      fail(`${label}: condicao nao ocorreu em ${maxFrames} quadros; trajetoria preservada em ${tracePath}: ${JSON.stringify(samples.slice(-4))}`);
    }
    return samples;
  };
  const tapTrace = [];
  // A tap must last a few emulated frames (emulation runs at a few FPS under WebDriver),
  // otherwise press and release both happen between two frames and the game never sees it.
  const tap = async (code, label) => {
    const traceStart = tapTrace.length;
    await down(code, label);
    const pressedAt = (await readCanonicalGameFrame(sessionId))?.renderedFrames ?? 0;
    tapTrace.push({ label, phase: "down", sample: await observe(), input: await js("return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;") });
    await waitFor(async () => {
      const sample = await observe();
      tapTrace.push({ label, phase: "held", sample });
      return sample.frame - pressedAt >= 3;
    }, 20000, `${label}: quadros nao avancaram.`, 30);
    await up(code, label);
    tapTrace.push({ label, phase: "up", sample: await observe(), input: await js("return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;") });
    return tapTrace.slice(traceStart).map((entry) => entry.sample);
  };
  const settled = (key, ground) => (samples) => samples.length > 3 && samples.slice(-3).every((s) => s[key][1] === ground);
  await closeVisibleConsoleDrawer(sessionId, "antes de jogar");
  await focusGameCanvasNatively(sessionId);
  const initial = await sampleUntil((samples) => samples.length > 6 && samples[samples.length - 1].frame > samples[0].frame && samples.slice(-4).every((s, i, all) => s.p2[1] === all[0].p2[1] && s.p3[1] === all[0].p3[1] && s.p2OnGround !== 0 && s.p3OnGround !== 0), 600, "entidades pousarem");
  const ground2 = initial[initial.length - 1].p2[1];
  const ground3 = initial[initial.length - 1].p3[1];
  const minY = (samples, key) => Math.min(...samples.map((s) => s[key][1]));
  const problems = [];
  const jump = {};

  // J1: jump from the ground (tap X): rises, lands.
  const j1Press = await tap("KeyX", "X (salto do chao)");
  let run = j1Press.concat(await sampleUntil((samples) => samples.some((s) => s.p2[1] < ground2) && settled("p2", ground2)(samples), 400, "salto J1"));
  jump.apex1 = ground2 - minY(run, "p2");
  jump.p3DuringJ1 = run.every((s) => s.p3[1] === ground3);
  if (!(jump.apex1 >= 8)) problems.push(`J1: sem salto a partir do chao (apex ${jump.apex1})`);
  if (!jump.p3DuringJ1) problems.push("J1: Player 3 se moveu no salto de Player 2");
  // J2: second press in the air must not restart the impulse.
  run = await tap("KeyX", "X (salto J2)");
  if (run[run.length - 1].p2[1] >= ground2) fail(`J2: toque terminou apos o pouso: ${JSON.stringify(run)}`);
  jump.airPressAtY = run[run.length - 1].p2[1];
  await tap("KeyX", "X (pressao no ar)");
  run = run.concat(await sampleUntil(settled("p2", ground2), 400, "pouso J2"));
  jump.apex2 = ground2 - minY(run, "p2");
  if (jump.airPressAtY >= ground2) problems.push("J2: a segunda pressao nao ocorreu no ar");
  if (jump.apex2 > jump.apex1 + 1) problems.push(`J2: pressao no ar reiniciou o impulso (apex ${jump.apex2} > ${jump.apex1})`);
  // J3: holding the button cannot fly or re-jump after landing.
  await down("KeyX", "X segurado");
  run = await sampleUntil((samples) => samples.some((s) => s.p2[1] < ground2) && settled("p2", ground2)(samples), 400, "salto segurado");
  const heldLanding = await sampleUntil((samples) => samples[samples.length - 1].frame - samples[0].frame >= 40, 80, "segurar apos pousar");
  await up("KeyX", "X segurado");
  jump.apexHeld = ground2 - minY(run, "p2");
  jump.heldAfterLanding = heldLanding.every((s) => s.p2[1] === ground2);
  if (jump.apexHeld > jump.apex1 + 1) problems.push(`J3: segurar produziu voo (apex ${jump.apexHeld})`);
  if (!jump.heldAfterLanding) problems.push("J3: segurar apos pousar saltou de novo");
  // J4: after landing, a new press jumps again.
  await tap("KeyX", "X apos pousar");
  run = await sampleUntil((samples) => samples.some((s) => s.p2[1] < ground2) && settled("p2", ground2)(samples), 400, "novo salto J4");
  jump.apex4 = ground2 - minY(run, "p2");
  if (!(jump.apex4 >= 8)) problems.push("J4: sem novo salto apos pousar");
  // J5: independent support: Player 3 in the air, Player 2 on the ground can still jump.
  const j5Press = await tap("Enter", "Enter (Player 3 salta)");
  run = j5Press.concat(await sampleUntil((samples) => samples.some((s) => s.p3[1] < ground3), 200, "Player 3 no ar"));
  await tap("KeyX", "X com Player 3 no ar");
  run = run.concat(await sampleUntil((samples) => samples.some((s) => s.p2[1] < ground2) && settled("p2", ground2)(samples) && settled("p3", ground3)(samples), 400, "J5"));
  jump.p3Apex = ground3 - minY(run, "p3");
  jump.p2ApexWhileP3Air = ground2 - minY(run, "p2");
  if (!(jump.p3Apex >= 4) || !(jump.p2ApexWhileP3Air >= 8)) problems.push(`J5: apoio nao independente ${JSON.stringify(jump)}`);

  // Passage (before threshold). Right approach (moving right into B), at 8 px/frame.
  const passage = { A, B, C };
  let start = await observe();
  if (start.score >= 20 || start.openA || start.openB || start.openC) problems.push(`Passagens abertas antes do teste: ${JSON.stringify(start)}`);
  await down("ArrowRight", "direita ate B");
  run = await sampleUntil((samples) => samples.length > 4 && samples.slice(-4).every((s) => s.p2[0] === samples[samples.length - 1].p2[0]) && samples[samples.length - 1].p2[0] !== start.p2[0], 200, "Player 2 parar em B");
  await up("ArrowRight", "direita ate B");
  passage.fromLeft = { stopX: run[run.length - 1].p2[0], maxRight: Math.max(...run.map((s) => box(s.p2[0]).right)), score: run[run.length - 1].score, overlapped: run.some((s) => intersects(s.p2[0], B)) };
  if (passage.fromLeft.overlapped || passage.fromLeft.maxRight > B.left) problems.push(`Atravessou/invadiu B pela esquerda ${JSON.stringify(passage.fromLeft)}`);
  if (B.left - passage.fromLeft.maxRight >= 8) problems.push(`Parou longe de B (nao alcancou o bloqueio) ${JSON.stringify(passage.fromLeft)}`);
  if (passage.fromLeft.score >= 20) problems.push("Score passou do limiar durante a aproximacao (prova invalida)");
  // Left approach (moving left into A from its right side).
  start = await observe();
  await down("ArrowLeft", "esquerda ate A");
  run = await sampleUntil((samples) => samples.length > 4 && samples.slice(-4).every((s) => s.p2[0] === samples[samples.length - 1].p2[0]) && samples[samples.length - 1].p2[0] !== start.p2[0], 300, "Player 2 parar em A");
  await up("ArrowLeft", "esquerda ate A");
  passage.fromRight = { stopX: run[run.length - 1].p2[0], minLeft: Math.min(...run.map((s) => box(s.p2[0]).left)), overlapped: run.some((s) => intersects(s.p2[0], A)) };
  if (passage.fromRight.overlapped || passage.fromRight.minLeft < A.right) problems.push(`Atravessou/invadiu A pela direita ${JSON.stringify(passage.fromRight)}`);
  if (passage.fromRight.minLeft - A.right >= 8) problems.push(`Parou longe de A ${JSON.stringify(passage.fromRight)}`);
  // Starts overlapped (Player 3 inside C): documented semantics = may move out freely.
  start = await observe();
  passage.p3StartedOverlapped = intersects(start.p3[0], C);
  await down("KeyC", "C (sair de dentro de C)");
  run = await sampleUntil((samples) => !intersects(samples[samples.length - 1].p3[0], C) && box(samples[samples.length - 1].p3[0]).left >= C.right + 12, 300, "Player 3 sair de C", 0);
  await up("KeyC", "C");
  const cDeltas = run.slice(1).map((s, i) => s.p3[0] - run[i].p3[0]).filter((d) => d !== 0);
  passage.p3Exit = { from: start.p3[0], to: run[run.length - 1].p3[0], gcd: cDeltas.reduce((a, d) => { const g = (x, y) => (y === 0 ? Math.abs(x) : g(y, x % y)); return g(a, d); }, 0), p2Static: run.every((s) => s.p2[0] === start.p2[0]), copyStatic: run.every((s) => s.copy[0] === start.copy[0]) };
  if (!passage.p3StartedOverlapped) problems.push("Player 3 nao comecou sobreposto a C");
  if (passage.p3Exit.gcd !== 3) problems.push(`Passos de Player 3 nao sao 3 px (gcd ${passage.p3Exit.gcd})`);
  if (!passage.p3Exit.p2Static || !passage.p3Exit.copyStatic) problems.push("Outra entidade andou com C (estado/alvo compartilhado)");
  // Player 3 comes back (Z) and stops at C's right face: its own passage (60) is closed.
  const p3Closed = async (label) => {
    const before = await observe();
    await down("KeyZ", label);
    // Holding left: stable for >= 20 emulated frames (it may already be touching the face).
    const samples = await sampleUntil((all) => all.length > 4 && all.slice(-4).every((s) => s.p3[0] === all[all.length - 1].p3[0]) && all[all.length - 1].frame - all[0].frame >= 20, 300, label);
    void before;
    await up("KeyZ", label);
    return { stopX: samples[samples.length - 1].p3[0], minLeft: Math.min(...samples.map((s) => box(s.p3[0]).left)), overlapped: samples.some((s) => intersects(s.p3[0], C)), score: samples[samples.length - 1].score };
  };
  passage.p3BeforeThreshold = await p3Closed("Z: Player 3 volta ate C");
  if (passage.p3BeforeThreshold.overlapped || passage.p3BeforeThreshold.minLeft < C.right) problems.push(`Player 3 invadiu C antes do limiar ${JSON.stringify(passage.p3BeforeThreshold)}`);
  // Threshold: holding right raises the template score; Player 2 must cross B at the same place.
  await down("ArrowRight", "direita ate atravessar B");
  run = await sampleUntil((samples) => box(samples[samples.length - 1].p2[0]).left >= B.right, 600, "Player 2 atravessar B");
  await up("ArrowRight", "direita ate atravessar B");
  const firstCross = run.find((s) => box(s.p2[0]).right > B.left) ?? null;
  passage.cross = { firstInsideB: firstCross, openedAtScore: run.find((s) => s.openB === 1)?.score ?? null, beforeOpenInside: run.filter((s) => s.openB === 0 && intersects(s.p2[0], B)).length, end: run[run.length - 1] };
  if (!firstCross || firstCross.score < 20 || passage.cross.beforeOpenInside) problems.push(`Travessia de B antes do limiar ${JSON.stringify(passage.cross)}`);
  // The other passage (Player 3, threshold 60) keeps its own state: still closed at the same face.
  passage.p3AfterThreshold = await p3Closed("Z: Player 3 contra C apos o limiar de Player 2");
  if (passage.p3AfterThreshold.score >= 60) problems.push("Score passou de 60 (prova da outra passagem invalida)");
  if (passage.p3AfterThreshold.overlapped || passage.p3AfterThreshold.minLeft < C.right) problems.push(`Passagem de Player 3 abriu com o limiar de Player 2 ${JSON.stringify(passage.p3AfterThreshold)}`);
  const finalState = await observe();
  passage.openStates = { A: finalState.openA, B: finalState.openB, C: finalState.openC, score: finalState.score };
  if (finalState.openC !== 0) problems.push("Variavel da passagem de Player 3 abriu antes de 60");
  if (problems.length) fail(`Prova incompleta: ${problems.join("; ")} ${JSON.stringify({ jump, passage })}`);
  await shot("04-played", "jogo apos a prova por teclado");
  const romIdentity = { path: romCopy, sha256: romSha256 };
  const timelinePath = path.join(validationDir, `${artifactPrefix}-play-proof.json`);
  await writeFile(timelinePath, JSON.stringify({ romIdentity, collision: { player: playerCollision, blocker: blockerCollision }, jump, passage }, null, 2));
  addReportArtifact(report, timelinePath, "prova de salto e passagem (RAM + colisao)");
  addReportStep(report, "keyboard_jump_and_passage", "passed", { rom: romIdentity, jump, passage });

  const saved = await writeCreateGameReport(report, reportPath);
  console.log(`Relatorio: ${saved}`);
  console.log("OK: Desktop Tauri behaviors independence (duas entidades, parametros distintos, edicao/undo, copia remapeada, remocao, reinicio, teclado) passou.");
}

/**
 * Collect -> counter -> passage -> objective proof (Experimental), all through the UI with
 * native WebDriver input: two collectibles feed a shared counter, a passage needs both,
 * an objective needs both; save/restart/reopen, build, play with the real keyboard and
 * restart the match. RAM, pixels and audio only observe.
 */
async function runCollectGoalScenario(initialSessionId, appPath, uiBootstrapTimeoutMs, onProjectCreated) {
  let sessionId = initialSessionId;
  const artifactPrefix = `collect-goal-${artifactTimestamp()}`;
  const reportPath = path.join(validationDir, `${artifactPrefix}-report.json`);
  const report = { generatedAt: null, scenario: "collect-goal", testedApplication: { path: appPath, sha256: createHash("sha256").update(await readFile(appPath)).digest("hex") }, artifacts: [], steps: [], frames: [], roms: [] };
  const shot = async (name, label) => addReportArtifact(report, await captureScreenshot(sessionId, `${artifactPrefix}-${name}.png`), label);
  const state = () => readAutomationState(sessionId);
  const js = (script, args = []) => executeScript(sessionId, script, args);
  const click = (testId, label = testId) => clickButtonByTestIdNative(sessionId, testId, label);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const value = (testId) => js(`return document.querySelector('[data-testid="' + arguments[0] + '"]')?.value ?? null;`, [testId]);
  const text = (testId) => js(`return document.querySelector('[data-testid="' + arguments[0] + '"]')?.textContent ?? null;`, [testId]);
  const find = (selector) => findElement(sessionId, selector).catch((error) => fail(`Elemento nao encontrado: ${selector} (${error.message})`));
  const selectOption = async (testId, optionValue) => {
    await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="' + arguments[0] + '"] option[value="' + arguments[1] + '"]'));`, [testId, optionValue]), 10000, `Opcao ${optionValue} ausente em ${testId}.`, 100);
    await js(`document.querySelector('[data-testid="' + arguments[0] + '"]')?.scrollIntoView({ block: "center" });`, [testId]);
    await webdriverRequest("POST", `/session/${sessionId}/element/${await find(`[data-testid="${testId}"] option[value="${optionValue}"]`)}/click`, {});
    await waitFor(async () => (await value(testId)) === optionValue, 5000, `Selecao ${testId}=${optionValue} nao aplicada.`, 100);
  };
  const setField = async (testId, fieldValue) => {
    await js(`document.querySelector('[data-testid="' + arguments[0] + '"]')?.scrollIntoView({ block: "center" });`, [testId]);
    await setInputByTestIdNative(sessionId, testId, String(fieldValue));
    await waitFor(async () => (await value(testId)) === String(fieldValue), 5000, `${testId} nao virou ${fieldValue}.`, 100);
  };
  const waitSelected = (entityId) => waitFor(async () => (await state())?.selectedEntityId === entityId, 10000, `${entityId} nao selecionado.`, 150);
  const clickHierarchy = async (entityId) => {
    const selector = `[data-testid='hierarchy-entity-${entityId}']`;
    await waitFor(async () => js(`return Boolean(document.querySelector(arguments[0]));`, [selector]), 15000, `Hierarquia sem ${entityId}.`, 150);
    await js(`document.querySelector(arguments[0])?.scrollIntoView({ block: "center" });`, [selector]);
    await webdriverRequest("POST", `/session/${sessionId}/element/${await find(selector)}/click`, {});
    await waitSelected(entityId);
  };
  const instances = () => js(`return [...document.querySelectorAll('[data-testid^="behavior-instance-"]')].map((el) => ({ id: el.dataset.testid.slice(18), text: el.textContent }));`);
  const switchLogic = async (entityId) => {
    await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="nodegraph-entity-switch"] option[value="' + arguments[0] + '"]'));`, [entityId]), 20000, `Seletor de logica sem ${entityId}.`, 150);
    await selectOption("nodegraph-entity-switch", entityId);
    await waitSelected(entityId);
    await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="nodegraph-behaviors"]'));`), 10000, "Painel de comportamentos ausente.", 150);
  };
  const applyBehavior = async (behaviorId, fields, label) => {
    await click(`behavior-add-${behaviorId}`, `adicionar ${label}`);
    for (const [key, kind, fieldValue] of fields) {
      if (kind === "select") await selectOption(`behavior-param-${key}`, fieldValue);
      else await setField(`behavior-param-${key}`, fieldValue);
    }
    const summary = await text("behavior-summary");
    const errors = await text("behavior-errors");
    if (errors) fail(`${label}: formulario com erros: ${errors}`);
    const before = (await instances()).length;
    await click("behavior-apply", `aplicar ${label}`);
    await waitFor(async () => (await instances()).length === before + 1, 5000, `${label} nao apareceu.`, 100);
    const list = await instances();
    return { summary, id: list[list.length - 1].id };
  };
  const duplicateOf = async (sourceId, expectedId, x, confirm = false) => {
    await clickHierarchy(sourceId);
    await click("inspector-duplicate-entity", `duplicar ${sourceId}`);
    if (confirm) await click("inspector-duplicate-confirm", "duplicar sem logica manual");
    await waitSelected(expectedId);
    await setInputByTestIdNative(sessionId, "inspector-transform-x", String(x));
    await waitFor(async () => (await state())?.activeScene?.entities?.find((entity) => entity.id === expectedId)?.x === x, 10000, `${expectedId} nao foi para x=${x}.`, 150);
  };

  // 1. Project and entities (all through the UI).
  await setSessionWindowRect(sessionId, 1920, 1080);
  await waitForOnboardingWizard(sessionId);
  await click("template-card-reference_platformer", "modelo de fase de referencia");
  await clickButtonByText(sessionId, "Mega Drive", "exact");
  const projectName = `Collect_${Date.now()}`;
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await clickButtonByText(sessionId, "Criar Projeto", "exact");
  const created = await waitFor(async () => { const current = await state(); return current?.activeProjectDir && current.activeProjectName === projectName ? current : false; }, 60000, "Wizard nao criou o projeto.", 500);
  const projectDir = created.activeProjectDir;
  onProjectCreated(projectDir);
  currentE2eRunContext.project = projectDir;
  await click("shell-persona-guiado", "modo guiado");
  await click("guided-step-personagem", "etapa Personagem");
  await waitSelected("player");
  const layout = { player2: 150, itemA: 180, itemB: 100, sensor: 205, blocker: 240 };
  await duplicateOf("player", "player_2", layout.player2, true);
  await duplicateOf("goal", "goal_2", layout.itemA);
  await duplicateOf("goal", "goal_3", layout.itemB);
  await duplicateOf("goal_sensor", "goal_sensor_2", layout.sensor);
  await duplicateOf("passage_blocker", "passage_blocker_2", layout.blocker);
  addReportStep(report, "entities", "passed", { layout });

  // 2. Behaviors through the Logic panels.
  await click("guided-step-regras", "etapa Regras");
  await closeVisibleConsoleDrawer(sessionId, "antes dos comportamentos");
  await switchLogic("player_2");
  const move = await applyBehavior("platform_movement", [["target", "select", "player_2"], ["speed", "input", 2], ["right_button", "select", "BUTTON_RIGHT"], ["left_button", "select", "BUTTON_LEFT"], ["jump_button", "select", "BUTTON_B"]], "Movimento de Player 2");
  const counter = await applyBehavior("counter", [["name", "input", "Moedas"], ["scope", "select", "shared"], ["start", "input", 0]], "Contador Moedas");
  await switchLogic("goal_2");
  // Negative (invalid reference): the item cannot collect itself.
  await click("behavior-add-collectible", "adicionar item (negativo)");
  await selectOption("behavior-param-collector", "goal_2");
  const invalidCollector = await waitFor(async () => text("behavior-errors"), 5000, "Coletor invalido nao recusado.", 100);
  if (!invalidCollector.includes("si mesmo") || !(await js(`return document.querySelector('[data-testid="behavior-apply"]').disabled;`))) fail(`Coletor invalido nao recusado: ${invalidCollector}`);
  await click("behavior-cancel", "cancelar");
  const itemA = await applyBehavior("collectible", [["item", "select", "goal_2"], ["collector", "select", "player_2"], ["counter", "select", counter.id], ["amount", "input", 1], ["sound", "select", "jump"]], "Item A");
  await switchLogic("goal_3");
  const itemB = await applyBehavior("collectible", [["item", "select", "goal_3"], ["collector", "select", "player_2"], ["counter", "select", counter.id], ["amount", "input", 1]], "Item B");
  await switchLogic("player_2");
  const gate = await applyBehavior("gated_passage", [["movement", "select", move.id], ["blocker", "select", "passage_blocker_2"], ["state_variable", "select", "ctr_moedas"], ["threshold", "input", 2]], "Passagem que exige as duas moedas");
  const goal = await applyBehavior("objective", [["actor", "select", "player_2"], ["sensor", "select", "goal_sensor_2"], ["counter", "select", counter.id], ["required", "input", 2], ["reveal", "select", "goal"], ["sound", "select", "victory"]], "Objetivo");
  const links = await text(`behavior-links-${counter.id}`);
  if (!links?.includes("Item coletavel — Goal Marker 2") || !links.includes("Item coletavel — Goal Marker 3") || !links.includes("Passagem condicionada") || !links.includes("Objetivo")) fail(`Ligacoes do contador incompletas: ${links}`);
  // Negative: the counter cannot be removed while items/passage/objective use it.
  await click(`behavior-remove-${counter.id}`, "remover contador (negativo)");
  const removal = await waitFor(async () => text("behavior-errors"), 5000, "Remocao do contador em uso nao recusada.", 100);
  if (!removal.includes("Goal Marker 2")) fail(`Mensagem de dependencia incompleta: ${removal}`);
  await click("behavior-cancel", "cancelar");
  await shot("01-behaviors", "comportamentos e ligacoes do contador");
  addReportStep(report, "behaviors", "passed", { move, counter, itemA, itemB, gate, goal, links, invalidCollector, removal });

  // 3. Save, restart the app, reopen, check.
  await clickTopBarMenuAction(sessionId, "Salvar");
  await waitFor(async () => (await js(`return document.querySelector('[data-testid="scene-save-status"]')?.dataset.status;`)) === "saved", 20000, "Salvar nao concluiu.", 200);
  await deleteSession(sessionId);
  sessionId = await createSession(appPath);
  currentE2eRunContext.sessionId = sessionId;
  await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "App nao reabriu apos reinicio");
  await waitFor(async () => js("return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"), uiBootstrapTimeoutMs, "API nao voltou apos reinicio", 150);
  await setSessionWindowRect(sessionId, 1920, 1080);
  await fillInputBySelector(sessionId, 'input[placeholder="Nome do projeto"]', projectName);
  await waitFor(async () => js(`return Boolean(document.querySelector('[data-testid="wizard-existing-project-card"]'));`), 30000, "Wizard nao encontrou o projeto salvo.", 300);
  await click("wizard-open-existing-project", "reabrir projeto");
  await waitFor(async () => (await state())?.activeProjectDir === projectDir, 60000, "Projeto nao reabriu.", 300);
  if (!(await js(`return Boolean(document.querySelector('[data-testid="guided-steps"]'));`))) await click("shell-persona-guiado", "modo guiado apos reinicio");
  await click("guided-step-regras", "etapa Regras apos reinicio");
  await closeVisibleConsoleDrawer(sessionId, "apos reabrir");
  await switchLogic("player_2");
  const reopenedPlayer = await instances();
  const reopenedLinks = await text(`behavior-links-${counter.id}`);
  await switchLogic("goal_2");
  const reopenedA = await instances();
  if (reopenedPlayer.length !== 4 || reopenedA.length !== 1 || reopenedLinks !== links) fail(`Comportamentos nao persistiram: ${JSON.stringify({ reopenedPlayer, reopenedA, reopenedLinks })}`);
  await shot("02-reopened", "comportamentos apos reiniciar e reabrir");
  addReportStep(report, "restart_reopen", "passed", { reopenedPlayer: reopenedPlayer.map((entry) => entry.id), reopenedA });

  // 4. Build and play.
  const startMatch = async (label) => {
    const previous = (await readCanonicalGameFrame(sessionId))?.romSha256 ?? null;
    await click("guided-step-testar", label);
    const running = await waitFor(async () => {
      const current = await state();
      const frame = await readCanonicalGameFrame(sessionId);
      return current?.emulatorLoaded && frame?.renderedFrames > 5 && frame.romSha256 ? { frame } : false;
    }, 300000, `${label}: jogo nao iniciou.`, 300).catch(async (error) => {
      await shot("build-run-failure", "falha do Build & Run");
      const entries = ((await state())?.consoleEntries ?? []).filter((entry) => entry.level !== "info").slice(-12);
      fail(`${error.message} console=${JSON.stringify(entries).slice(0, 4000)}`);
    });
    return { romSha256: running.frame.romSha256, previous };
  };
  const first = await startMatch("etapa Testar");
  const romPath = path.join(projectDir, "build", "megadrive", "out", "rom.bin");
  const romCopy = path.join(validationDir, `${artifactPrefix}-played.rom`);
  await cp(romPath, romCopy);
  const romSha256 = createHash("sha256").update(await readFile(romCopy)).digest("hex");
  if (first.romSha256 !== romSha256) fail("Game View executa outra ROM.");
  const symbols = parseElf32Symbols(await readFile(path.join(projectDir, "build", "megadrive", "out", "rom.out")));
  const spriteSymbol = (id, axis) => (symbols.has(`spr_${id}_${axis}`) ? `spr_${id}_${axis}` : [...symbols.keys()].find((name) => new RegExp(`^spr_.*__${id}_${axis}$`).test(name)) ?? `spr_${id}_${axis}`);
  const watch = [
    { key: "p2x", name: spriteSymbol("player_2", "x"), width: 2 },
    { key: "p1x", name: spriteSymbol("player", "x"), width: 2 },
    { key: "counter", name: "logic_var_ctr_moedas", width: 4 },
    { key: "takenA", name: `logic_var_${itemA.id}_taken`, width: 4 },
    { key: "takenB", name: `logic_var_${itemB.id}_taken`, width: 4 },
    { key: "open", name: `logic_var_${gate.id}_open`, width: 4 },
    { key: "done", name: `logic_var_${goal.id}_done`, width: 4 },
  ].map((entry) => ({ ...entry, address: symbols.get(entry.name) }));
  if (watch.some((entry) => !Number.isInteger(entry.address))) fail(`Simbolos ausentes: ${JSON.stringify(watch.filter((entry) => !Number.isInteger(entry.address)).map((entry) => entry.name))}`);
  const observe = async () => {
    const raw = await executeAsyncScript(sessionId, `
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      Promise.all(arguments[0].map((entry) => invoke("emulator_read_memory", { region: 2, offset: entry.address & 0xffff, length: entry.width })))
        .then((results) => done({ ok: true, data: results.map((r) => Array.from(r.data)), audioTotal: window.__RDS_E2E__.readReceivedAudioSamples(0, 0).total }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `, [watch]);
    if (!raw?.ok) fail(`Leitura de WRAM falhou: ${JSON.stringify(raw)}`);
    const decode = (d, width) => {
      const word = (i) => d[i] | (d[i + 1] << 8);
      if (width === 2) { const w = word(0); return w > 0x7fff ? w - 0x10000 : w; }
      const v = ((word(0) << 16) >>> 0) | word(2);
      return v > 0x7fffffff ? v - 0x100000000 : v;
    };
    const out = { frame: (await readCanonicalGameFrame(sessionId))?.renderedFrames ?? 0, audioTotal: raw.audioTotal };
    watch.forEach((entry, index) => { out[entry.key] = decode(raw.data[index], entry.width); });
    return out;
  };
  const KEY_BUTTON = { ArrowRight: "right", ArrowLeft: "left" };
  const waitAck = (button, expected, context) => waitFor(async () => {
    const observation = await js("return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
    return observation?.lastJoypadAck?.joypad?.[button] === expected ? observation.lastJoypadAck : false;
  }, 4000, `${context}: ACK nativo (${button}=${expected}) ausente.`, 50);
  // Hold a direction until `done(samples)`, then release; every sample is kept.
  const holdUntil = async (code, done, maxFrames, label) => {
    const samples = [await observe()];
    await sendNativeGameKey(sessionId, code, "keyDown", label);
    await waitAck(KEY_BUTTON[code], true, label);
    const start = samples[0].frame;
    while (!done(samples) && samples[samples.length - 1].frame - start < maxFrames) { await pause(20); samples.push(await observe()); }
    await sendNativeGameKey(sessionId, code, "keyUp", `soltar ${label}`);
    await waitAck(KEY_BUTTON[code], false, `soltar ${label}`);
    samples.push(await observe());
    if (!done(samples)) fail(`${label}: condicao nao ocorreu em ${maxFrames} quadros: ${JSON.stringify(samples.slice(-3))}`);
    return samples;
  };
  const stable = (key) => (samples) => samples.length > 5 && samples.slice(-4).every((s) => s[key] === samples[samples.length - 1][key]);
  const prefab = async (file) => JSON.parse(await readFile(path.join(projectDir, "prefabs", file), "utf8"));
  const playerW = (await prefab("reference_player.json")).components.collision.width;
  const blockerW = (await prefab("reference_passage.json")).components.collision.width;
  const itemW = (await prefab("reference_goal.json")).components.sprite.frame_width;
  const sensorW = (await prefab("reference_goal_sensor.json")).components.collision.width;
  const overlapsX = (x, left, width) => x < left + width && x + playerW > left;
  // Pixels of an item's screen box (no camera scroll in this template: world = screen).
  const itemPixels = async (left) => {
    const frame = await readCanonicalGameFrame(sessionId, { includePixels: true });
    const width = frame.width ?? 320;
    let hash = 0;
    for (let y = 176; y < 208; y += 1) for (let x = left; x < left + itemW; x += 1) {
      const i = (y * width + x) * 4;
      hash = (hash * 31 + frame.rgba[i] * 3 + frame.rgba[i + 1] * 5 + frame.rgba[i + 2] * 7) >>> 0;
    }
    return hash;
  };
  const tonePower = async (fromTotal, frequency) => {
    const rate = 44100;
    const now = await js("return window.__RDS_E2E__.readReceivedAudioSamples(0, 0).total;");
    const audio = await js("return window.__RDS_E2E__.readReceivedAudioSamples(arguments[0], arguments[1]);", [fromTotal, Math.max(1, now - fromTotal)]);
    const sampleRate = audio?.sampleRate || rate;
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const coeff = 2 * Math.cos(omega);
    let s1 = 0, s2 = 0, n = 0;
    for (let i = 0; i < (audio?.samples?.length ?? 0); i += 2) { const s0 = audio.samples[i] + coeff * s1 - s2; s2 = s1; s1 = s0; n += 1; }
    return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, n * n);
  };

  await closeVisibleConsoleDrawer(sessionId, "antes de jogar");
  await focusGameCanvasNatively(sessionId);
  const problems = [];
  const initial = await observe();
  const pixelsA0 = await itemPixels(layout.itemA);
  const pixelsB0 = await itemPixels(layout.itemB);
  if (initial.counter !== 0 || initial.takenA || initial.takenB || initial.open || initial.done) problems.push(`Estado inicial errado: ${JSON.stringify(initial)}`);
  // R1: right until blocked. Collects A once, crosses the sensor without winning, stops at the blocker.
  const r1 = await holdUntil("ArrowRight", (samples) => samples.some((s) => s.counter === 1) && stable("p2x")(samples), 600, "direita ate o bloqueio");
  const r1End = r1[r1.length - 1];
  const touchedSensorEarly = r1.filter((s) => overlapsX(s.p2x, layout.sensor, sensorW));
  const proof = {
    r1: { endX: r1End.p2x, counter: r1End.counter, maxCounter: Math.max(...r1.map((s) => s.counter)), open: r1End.open, sensorSamples: touchedSensorEarly.length, doneDuringR1: r1.some((s) => s.done), maxRight: Math.max(...r1.map((s) => s.p2x)) + playerW, blockerLeft: layout.blocker },
  };
  if (proof.r1.maxCounter !== 1 || r1End.takenA !== 1 || r1End.takenB !== 0) problems.push(`Item A nao creditou exatamente uma vez: ${JSON.stringify(proof.r1)}`);
  if (proof.r1.sensorSamples === 0) problems.push("Player 2 nao passou pelo sensor antes das duas moedas (negativo de vitoria prematura nao exercitado)");
  if (proof.r1.doneDuringR1) problems.push("Objetivo disparou antes de ter as duas moedas (vitoria prematura)");
  if (r1End.open !== 0 || proof.r1.maxRight > layout.blocker) problems.push(`Passagem nao estava fechada fisicamente: ${JSON.stringify(proof.r1)}`);
  // Pixels: A hidden, B untouched (only the collected item changes).
  const pixelsA1 = await itemPixels(layout.itemA);
  const pixelsB1 = await itemPixels(layout.itemB);
  proof.pixels = { aChanged: pixelsA1 !== pixelsA0, bUnchangedAfterA: pixelsB1 === pixelsB0 };
  // Wrong collector: the template player (same arrows) must not collect B.
  proof.templatePlayerOverB = r1.some((s) => overlapsX(s.p1x, layout.itemB, itemW));
  if (proof.templatePlayerOverB && r1.some((s) => s.takenB)) problems.push("Item B foi coletado pelo jogador errado");
  // L1: back left over A (no second credit) to B: counter 2 exactly, passage opens.
  const l1 = await holdUntil("ArrowLeft", (samples) => samples.some((s) => s.counter === 2), 900, "esquerda ate o item B");
  const overAAgain = l1.filter((s) => overlapsX(s.p2x, layout.itemA, itemW)).length;
  proof.l1 = { overAAgain, counterWhileOverA: [...new Set(l1.filter((s) => overlapsX(s.p2x, layout.itemA, itemW)).map((s) => s.counter))], maxCounter: Math.max(...l1.map((s) => s.counter)), end: l1[l1.length - 1] };
  if (!overAAgain || proof.l1.counterWhileOverA.some((c) => c !== 1)) problems.push(`Voltar sobre A creditou de novo: ${JSON.stringify(proof.l1)}`);
  if (proof.l1.maxCounter !== 2 || proof.l1.end.takenB !== 1) problems.push(`Item B nao creditou exatamente uma vez: ${JSON.stringify(proof.l1)}`);
  const openAt = [...r1, ...l1].find((s) => s.open === 1);
  if (!openAt || openAt.counter < 2) problems.push(`Passagem abriu antes da condicao: ${JSON.stringify(openAt)}`);
  // Stay on B's spot: no further credit.
  const stay = [];
  const stayStart = (await observe()).frame;
  while ((await observe()).frame - stayStart < 30) stay.push(await observe());
  if (stay.some((s) => s.counter !== 2)) problems.push("Permanecer no local creditou de novo");
  // R2: right through the sensor (objective once) and physically across the blocker.
  const audioBeforeGoal = (await observe()).audioTotal;
  const r2 = await holdUntil("ArrowRight", (samples) => samples[samples.length - 1].p2x > layout.blocker + blockerW, 900, "direita ate atravessar");
  const fired = r2.find((s) => s.done === 1);
  proof.r2 = { firedAtX: fired?.p2x ?? null, firedCounter: fired?.counter ?? null, endX: r2[r2.length - 1].p2x, crossed: r2[r2.length - 1].p2x > layout.blocker + blockerW };
  if (!fired || fired.counter < 2 || !overlapsX(fired.p2x, layout.sensor, sensorW)) problems.push(`Objetivo nao disparou no sensor com a condicao: ${JSON.stringify(proof.r2)}`);
  if (!proof.r2.crossed) problems.push("Player 2 nao atravessou fisicamente");
  await pause(1500);
  proof.audio = { victoryAfterGoal: await tonePower(audioBeforeGoal, 1320) };
  // L2: back over the sensor: the objective does not fire again.
  const l2 = await holdUntil("ArrowLeft", (samples) => samples.some((s) => overlapsX(s.p2x, layout.sensor, sensorW)) && samples[samples.length - 1].p2x < layout.sensor - playerW, 900, "esquerda de volta sobre o sensor");
  proof.l2 = { doneValues: [...new Set(l2.map((s) => s.done))], counter: l2[l2.length - 1].counter };
  if (proof.l2.doneValues.some((d) => d !== 1) || proof.l2.counter !== 2) problems.push(`Objetivo/contador mudaram ao voltar: ${JSON.stringify(proof.l2)}`);
  if (problems.length) fail(`Prova incompleta: ${problems.join("; ")} ${JSON.stringify(proof)}`);
  await shot("03-played", "apos coletar, abrir e cumprir o objetivo");

  // 5. Restart the match through the UI (Testar again). Only a real restart can bring back
  // the full initial state (Player 2 had moved and the counter was 2).
  await click("guided-step-testar", "Testar de novo (reiniciar a partida)");
  const isInitial = (s) => s.counter === 0 && !s.takenA && !s.takenB && !s.open && !s.done && s.p2x === layout.player2;
  const afterRestart = await waitFor(async () => {
    const current = await observe().catch(() => null);
    return current && isInitial(current) ? current : false;
  }, 300000, "Reinicio da partida nao restaurou o estado definido.", 500);
  const restart = { romSha256: (await readCanonicalGameFrame(sessionId))?.romSha256 };
  const pixelsA2 = await itemPixels(layout.itemA);
  proof.restart = { state: afterRestart, itemAVisibleAgain: pixelsA2 === pixelsA0, sameRom: restart.romSha256 === romSha256 };
  if (afterRestart.counter !== 0 || afterRestart.takenA || afterRestart.takenB || afterRestart.open || afterRestart.done || afterRestart.p2x !== layout.player2) {
    fail(`Reinicio da partida nao restaurou o estado definido: ${JSON.stringify(proof.restart)}`);
  }
  await shot("04-restarted", "partida reiniciada");
  const proofPath = path.join(validationDir, `${artifactPrefix}-play-proof.json`);
  await writeFile(proofPath, JSON.stringify({ rom: { path: romCopy, sha256: romSha256 }, layout, proof, r1, l1, r2, l2 }, null, 2));
  addReportArtifact(report, proofPath, "prova por teclado (RAM, pixels, audio)");
  addReportStep(report, "keyboard_collect_goal", "passed", { rom: { path: romCopy, sha256: romSha256 }, proof });
  const saved = await writeCreateGameReport(report, reportPath);
  console.log(`Relatorio: ${saved}`);
  console.log("OK: Desktop Tauri collect-goal (dois itens, contador, passagem, objetivo, reinicio da partida) passou.");
}

const SHELL_PERSONA_STORAGE_KEY = "retrodev-shell-persona";

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
        .then((receipt) => done({ ok: true, value: receipt }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `,
    [draft]
  );

  if (!result?.ok) {
    fail(`Falha ao injetar draft live: ${result?.error ?? "sem diagnostico"}`);
  }

  return result.value;
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

async function setInputByTestIdNative(sessionId, testId, value) {
  const focused = await executeScript(
    sessionId,
    `
      const input = document.querySelector('[data-testid="' + String(arguments[0]) + '"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      input.select();
      return true;
    `,
    [testId]
  );
  if (!focused) throw new Error(`Input nao encontrado para teclado: ${testId}`);
  const elementId = await findElement(sessionId, `[data-testid="${testId}"]`);
  const text = String(value);
  await webdriverRequest("POST", `/session/${sessionId}/element/${elementId}/value`, {
    text,
    value: [...text],
  });
}

async function activateByTestIdWithEnter(sessionId, testId) {
  const visible = await executeScript(
    sessionId,
    `const element = document.querySelector('[data-testid="' + String(arguments[0]) + '"]'); if (!(element instanceof HTMLElement)) return false; element.scrollIntoView({ block: "center", inline: "center" }); element.focus(); return true;`,
    [testId]
  );
  if (!visible) throw new Error(`Elemento não encontrado para teclado: ${testId}`);
  const elementId = await findElement(sessionId, `[data-testid="${testId}"]`);
  await webdriverRequest("POST", `/session/${sessionId}/element/${elementId}/value`, { text: "\uE007", value: ["\uE007"] });
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

async function clickButtonByTestIdWithPointerEvents(sessionId, testId) {
  const result = await executeScript(
    sessionId,
    `const button = document.querySelector('[data-testid="' + String(arguments[0]) + '"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.scrollIntoView({ block: "center", inline: "center" }); button.focus(); for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); return true;`,
    [testId]
  );
  if (!result) fail(`Botao nao encontrado para eventos: '${testId}'.`);
}

async function inspectNativeButtonTarget(sessionId, testId) {
  return executeScript(
    sessionId,
    `
      const testId = String(arguments[0] ?? "");
      const button = document.querySelector('[data-testid="' + testId + '"]');
      if (!(button instanceof HTMLButtonElement)) {
        return { exists: false, testId };
      }
      button.scrollIntoView({ block: "center", inline: "center" });
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const top = visible ? document.elementFromPoint(x, y) : null;
      const topWithTestId = top instanceof Element ? top.closest("[data-testid]") : null;
      const unobstructed = Boolean(top && (top === button || button.contains(top)));
      const wizard = document.querySelector('[data-testid="project-wizard-body"]');
      return {
        exists: true,
        testId,
        visible,
        disabled: Boolean(button.disabled),
        focused: document.activeElement === button,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        point: { x, y },
        topTag: top?.tagName ?? "",
        topTestId: topWithTestId?.getAttribute("data-testid") ?? "",
        topClass: top instanceof Element ? String(top.className ?? "") : "",
        unobstructed,
        wizardVisible: Boolean(wizard),
      };
    `,
    [testId]
  );
}

async function clickButtonByTestIdNative(sessionId, testId, label = testId, options = {}) {
  const diagnostic = await inspectNativeButtonTarget(sessionId, testId);
  if (!diagnostic?.exists || !diagnostic.visible || diagnostic.disabled) {
    fail(`Clique WebDriver bloqueado para '${label}': ${JSON.stringify(diagnostic)}`);
  }
  if (options.expectBlocked) {
    if (diagnostic.unobstructed) {
      fail(`Negativo de obstrução não encontrou bloqueador para '${label}': ${JSON.stringify(diagnostic)}`);
    }
    return { blocked: true, diagnostic };
  }
  if (!diagnostic.unobstructed) {
    fail(`Clique WebDriver bloqueado para '${label}': ${JSON.stringify(diagnostic)}`);
  }
  const elementId = await findElement(sessionId, `[data-testid="${testId}"]`);
  await clickElement(sessionId, elementId);
  return { blocked: false, diagnostic };
}

async function clickButtonByTestIdNativeWhenReady(sessionId, testId, label = testId, timeoutMs = 30000) {
  await waitFor(
    async () => {
      const diagnostic = await inspectNativeButtonTarget(sessionId, testId);
      return diagnostic?.exists && diagnostic.visible && !diagnostic.disabled && diagnostic.unobstructed ? diagnostic : false;
    },
    timeoutMs,
    `Controle nativo não ficou disponível: ${label}`,
    100
  );
  return clickButtonByTestIdNative(sessionId, testId, label);
}

async function selectInspectionFrameNative(sessionId, frameId) {
  const selector = "[data-testid='inspection-sprite-frame-select']";
  const diagnostic = await waitFor(
    async () => {
      const next = await executeScript(
        sessionId,
        `
      const select = document.querySelector(${JSON.stringify(selector)});
      if (!(select instanceof HTMLSelectElement)) return { exists: false };
      select.scrollIntoView({ block: "center", inline: "center" });
      const rect = select.getBoundingClientRect();
      const style = window.getComputedStyle(select);
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const top = document.elementFromPoint(x, y);
      const topWithTestId = top instanceof Element ? top.closest("[data-testid]") : null;
      return {
        exists: true,
        value: select.value,
        options: Array.from(select.options, (option) => option.value),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        disabled: Boolean(select.disabled),
        focused: document.activeElement === select,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        point: { x, y },
        topTag: top?.tagName ?? "",
        topTestId: topWithTestId?.getAttribute("data-testid") ?? "",
        unobstructed: Boolean(top && (top === select || select.contains(top))),
      };
        `
      );
      return next?.exists && next.visible ? next : false;
    },
    60000,
    `Controle de seleção de frame não apareceu: ${frameId}`,
    100
  );
  if (!diagnostic?.exists || !diagnostic.visible || diagnostic.disabled || !diagnostic.unobstructed) {
    fail(`Seleção nativa de frame bloqueada: ${JSON.stringify({ frameId, diagnostic })}`);
  }
  if (diagnostic.value !== frameId) {
    const elementId = await findElement(sessionId, selector);
    await clickElement(sessionId, elementId);
    const frameIndex = Array.isArray(diagnostic.options) ? diagnostic.options.indexOf(frameId) : -1;
    if (frameIndex < 0) fail(`Frame não está exposto no controle nativo: ${JSON.stringify({ frameId, options: diagnostic.options })}`);
    await webdriverRequest("POST", `/session/${sessionId}/actions`, {
      actions: [{ type: "key", id: "inspection-frame-selector-home", actions: [
        { type: "keyDown", value: "\uE011" },
        { type: "keyUp", value: "\uE011" },
      ] }],
    });
    if (frameIndex > 0) {
      await webdriverRequest("POST", `/session/${sessionId}/actions`, {
        actions: [{ type: "key", id: "inspection-frame-selector-down", actions: Array.from({ length: frameIndex }, () => [
          { type: "keyDown", value: "\uE015" },
          { type: "keyUp", value: "\uE015" },
        ]).flat() }],
      });
    }
    await webdriverRequest("POST", `/session/${sessionId}/actions`, {
      actions: [{ type: "key", id: "inspection-frame-selector-enter", actions: [
        { type: "keyDown", value: "\uE007" },
        { type: "keyUp", value: "\uE007" },
      ] }],
    });
  }
  const selected = await waitFor(
    async () => executeScript(sessionId, `return document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(frameId)};`),
    5000,
    `Seleção nativa não confirmou ${frameId}`,
    50
  );
  if (!selected) fail(`Seleção de frame não foi confirmada: ${frameId}`);
  return { frameId, diagnostic };
}

async function closeVisibleConsoleDrawer(sessionId, label = "console inicial") {
  const visible = await executeScript(
    sessionId,
    `return document.querySelector('[data-testid="console-drawer"][data-visible="true"]') ? true : false;`
  );
  if (!visible) {
    return { closed: false, reason: "not-visible" };
  }
  const selector = '[data-testid="console-drawer"] > div:first-child > button';
  const before = await inspectElementInteraction(sessionId, selector);
  if (!before?.found || !before.visible || before.disabled || before.elementAtCenter?.includes('console-details')) {
    fail(`Console visível não ficou fechável por controle nativo (${label}): ${JSON.stringify(before)}`);
  }
  const elementId = await findElement(sessionId, selector);
  await clickElement(sessionId, elementId);
  await waitFor(
    async () => !(await executeScript(sessionId, `return document.querySelector('[data-testid="console-drawer"][data-visible="true"]') ? true : false;`)),
    5000,
    `Console não fechou pelo controle visível (${label})`,
    100
  );
  const after = await inspectElementInteraction(sessionId, selector);
  console.log(`[inspection-console] ${JSON.stringify({ label, before, after, closed: true })}`);
  return { closed: true, before, after };
}

async function readSavedSessionSelection(sessionId, persistedSessionId) {
  return executeScript(
    sessionId,
    `
      const card = document.querySelector('[data-testid="inspection-saved-session"][data-session-id="' + String(arguments[0]) + '"]');
      if (!(card instanceof HTMLElement)) return null;
      const button = card.querySelector('[data-testid="select-saved-session-' + String(arguments[0]) + '"]');
      const className = String(card.className || '');
      return {
        sessionId: card.getAttribute('data-session-id') || '',
        status: card.getAttribute('data-session-status') || '',
        selected: className.includes('border-[#cba6f7]'),
        cardClass: className,
        buttonDisabled: button instanceof HTMLButtonElement ? button.disabled : null,
      };
    `,
    [persistedSessionId]
  );
}

async function ensurePreviewVisibleAndUnobstructed(sessionId) {
  return executeScript(
    sessionId,
    `
      const image = document.querySelector('[data-testid="inspection-preview-image"]');
      if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
      let scrollParent = image.parentElement;
      while (scrollParent && scrollParent !== document.body) {
        const style = window.getComputedStyle(scrollParent);
        if (scrollParent.scrollHeight > scrollParent.clientHeight && /(auto|scroll|overlay)/.test(style.overflowY)) break;
        scrollParent = scrollParent.parentElement;
      }
      image.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = image.getBoundingClientRect();
      const fullyVisible = rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      const renderedSizeSufficient = rect.width >= Math.min(image.naturalWidth, 32) && rect.height >= Math.min(image.naturalHeight, 8);
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const top = fullyVisible ? document.elementFromPoint(x, y) : null;
      const topWithTestId = top instanceof Element ? top.closest('[data-testid]') : null;
      const unobstructed = Boolean(top && (top === image || image.contains(top)));
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        fullyVisible,
        naturalSize: { width: image.naturalWidth, height: image.naturalHeight },
        renderedSizeSufficient,
        unobstructed,
        point: { x, y },
        topTag: top?.tagName ?? '',
        topTestId: topWithTestId?.getAttribute('data-testid') ?? '',
        topClass: top instanceof Element ? String(top.className ?? '') : '',
        scrollParentTestId: scrollParent?.getAttribute('data-testid') ?? '',
        scrollParentTag: scrollParent?.tagName ?? '',
        scrollTop: scrollParent ? scrollParent.scrollTop : null,
      };
    `
  );
}

async function handleProjectWizardVisibly(sessionId, label) {
  const wizardVisible = await executeScript(
    sessionId,
    `return Boolean(document.querySelector('[data-testid="project-wizard-body"]'));`
  );
  if (!wizardVisible) {
    return { label, action: "not-visible" };
  }

  const wizardAction = await waitFor(
    async () => executeScript(
      sessionId,
      `return document.querySelector('[data-testid="wizard-open-existing-project"]') ? "existing" : document.querySelector('[data-testid="template-card-empty"]') ? "empty" : false;`
    ),
    15000,
    `Controles do wizard não apareceram (${label})`,
    100
  );
  if (wizardAction === "existing") {
    await clickButtonByTestIdNativeWhenReady(sessionId, "wizard-open-existing-project", `${label}: abrir projeto existente`);
  } else {
    await clickButtonByTestIdNativeWhenReady(sessionId, "template-card-empty", `${label}: selecionar Projeto Vazio`);
    await clickButtonByTestIdNativeWhenReady(sessionId, "wizard-target-megadrive", `${label}: selecionar Mega Drive`);
    await clickButtonByTestIdNativeWhenReady(sessionId, "wizard-create-project", `${label}: concluir wizard`);
  }

  const state = await waitFor(
    async () => {
      const wizard = await executeScript(
        sessionId,
        `return Boolean(document.querySelector('[data-testid="project-wizard-body"]'));`
      );
      const automation = await readAutomationState(sessionId);
      return !wizard && automation?.activeProjectDir ? automation : false;
    },
    30000,
    `Wizard não foi concluído por controles visíveis (${label})`,
    100
  );
  console.log(`[inspection-wizard] ${JSON.stringify({ label, action: wizardAction === "existing" ? "open-existing" : "create-empty", activeProjectDir: state.activeProjectDir })}`);
  return { label, action: wizardAction === "existing" ? "open-existing" : "create-empty", activeProjectDir: state.activeProjectDir };
}

async function runLogicRecoveryScenario(sessionId, projectDir) {
  const nodeRomPath = process.env.RDS_LOGIC_RECOVERY_NODE_ROM ?? "";
  const routineRomPath = process.env.RDS_LOGIC_RECOVERY_ROUTINE_ROM ?? process.env.RDS_LOGIC_RECOVERY_ROM ?? "";
  const offsetRaw = process.env.RDS_LOGIC_RECOVERY_OFFSET ?? "";
  const offset = Number.parseInt(offsetRaw, 0);
  if (
    !nodeRomPath ||
    !routineRomPath ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !(await pathExists(nodeRomPath)) ||
    !(await pathExists(routineRomPath))
  ) {
    fail("logic-recovery exige RDS_LOGIC_RECOVERY_NODE_ROM, RDS_LOGIC_RECOVERY_ROUTINE_ROM e RDS_LOGIC_RECOVERY_OFFSET.");
  }
  const nodeBytes = await readFile(nodeRomPath);
  const routineBytes = await readFile(routineRomPath);
  const expectedRoutineBytes = Buffer.from([0x52, 0x40, 0x4e, 0x75]);
  if (!routineBytes.subarray(offset, offset + expectedRoutineBytes.length).equals(expectedRoutineBytes)) {
    fail(`fixture routine não contém 52 40 4E 75 no offset 0x${offset.toString(16)}.`);
  }
  const nodeSourcePath = path.join(path.dirname(path.dirname(nodeRomPath)), "src", "main.c");
  const routineSourcePath = path.join(path.dirname(path.dirname(routineRomPath)), "src", "main.c");
  const nodeSource = await readFile(nodeSourcePath, "utf8");
  const routineSource = await readFile(routineSourcePath, "utf8");
  if (!nodeSource.includes("node_generated_rom_addq_word") || !nodeSource.includes("rds_rom_word_result")) {
    fail(`source do caminho node não contém a semântica C esperada: ${nodeSourcePath}`);
  }
  if (!routineSource.includes("recovered_addq_word")) {
    fail(`source do caminho routine não contém a chamada da rotina vinculada: ${routineSourcePath}`);
  }

  const artifactPrefix = `logic-recovery-${artifactTimestamp()}`;
  const reportPath = path.join(validationDir, `${artifactPrefix}-report.json`);
  const appBytes = await readFile(currentE2eRunContext?.appPath ?? "").catch(() => null);
  const report = {
    generatedAt: new Date().toISOString(),
    scenario: "logic-recovery",
    application: {
      path: currentE2eRunContext?.appPath ?? null,
      sha256: appBytes ? createHash("sha256").update(appBytes).digest("hex") : null,
    },
    fixture: {
      nodeRomPath,
      routineRomPath,
      nodeRomSha256: createHash("sha256").update(nodeBytes).digest("hex"),
      routineRomSha256: createHash("sha256").update(routineBytes).digest("hex"),
      nodeSourcePath,
      nodeSourceSha256: createHash("sha256").update(nodeSource).digest("hex"),
      routineSourcePath,
      routineSourceSha256: createHash("sha256").update(routineSource).digest("hex"),
    },
    offset,
    steps: [],
  };

  await setSessionWindowRect(sessionId, 1280, 800);
  await callAutomationApi(sessionId, "openProject", [projectDir]);
  await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      return state?.activeProjectDir === projectDir ? state : false;
    },
    30000,
    "Fixture do logic-recovery não abriu explicitamente",
    250
  );
  await closeVisibleConsoleDrawer(sessionId);
  await callAutomationApi(sessionId, "openToolsWorkspace", ["reverse", "debug", true]);
  await waitForBodyText(sessionId, "Analisar ROM", 15000, "Reverse Workspace não abriu para logic-recovery");

  await fillInputBySelector(sessionId, 'input[placeholder="/roms/game.md"]', routineRomPath);
  await clickButtonByTextWithPointerEvents(sessionId, "Analisar ROM");
  await waitFor(
    async () => executeScript(sessionId, `return Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Analisar ROM") && document.body?.textContent?.includes("ROM Map") ? true : false;`),
    30000,
    "Análise da fixture de lógica não concluiu",
    250
  );
  const openedCode = await executeScript(sessionId, `
    const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
      const text = candidate.textContent?.replace(/\\s+/g, " ").trim() ?? "";
      return text === "Code" || text === "Voltar para Code";
    });
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.scrollIntoView({ block: "center", inline: "center" });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  `);
  if (!openedCode) {
    const buttons = await executeScript(sessionId, `return Array.from(document.querySelectorAll("button")).map((button) => button.textContent?.replace(/\\s+/g, " ").trim()).filter(Boolean).slice(-40);`);
    console.error(`[logic-recovery] code-tab buttons=${JSON.stringify(buttons)}`);
    fail("A aba Code não encontrou um controle visível no Reverse Workspace.");
  }
  await waitForBodyText(sessionId, "Lógica ROM → Nodes", 15000, "A aba Code não abriu a superfície de recuperação");
  await fillInputByLabel(sessionId, "Offset", `0x${offset.toString(16)}`);
  try {
    await waitFor(
      async () => executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="reverse-recover-logic"]:not([disabled])'));`),
      30000,
      "Controle de recuperação exata não ficou habilitado após a análise",
      250
    );
  } catch (error) {
    const diagnostics = await executeScript(sessionId, `return {
      button: (() => { const node = document.querySelector('[data-testid="reverse-recover-logic"]'); return node ? { disabled: node.disabled, text: node.textContent, outer: node.outerHTML } : null; })(),
      inputs: Array.from(document.querySelectorAll('input')).map((node) => ({ value: node.value, placeholder: node.placeholder, aria: node.getAttribute('aria-label') })),
      state: window.__RDS_E2E__?.getState?.() ?? null,
      reverseText: document.body?.textContent?.replace(/\\s+/g, ' ').slice(-2400) ?? '',
    };`);
    console.error(`[logic-recovery] habilitação diagnostics=${JSON.stringify(diagnostics)}`);
    throw error;
  }
  await clickButtonByTestIdWithPointerEvents(sessionId, "reverse-recover-logic");
  let recovered;
  try {
    recovered = await waitFor(
      async () => executeScript(sessionId, `
        const card = document.querySelector('[data-testid="reverse-logic-recovery-card"]');
        const button = document.querySelector('[data-testid="reverse-recover-logic"]');
        const text = card?.textContent ?? "";
        return card && button?.textContent?.includes("Recuperar rotina exata") && text.toLowerCase().includes("52 40 4e 75") ? text : false;
      `),
      30000,
      "Recuperação exata não produziu o card da UI",
      250
    );
  } catch (error) {
    const diagnostics = await executeScript(sessionId, `return {
      card: document.querySelector('[data-testid="reverse-logic-recovery-card"]')?.textContent ?? null,
      button: document.querySelector('[data-testid="reverse-recover-logic"]')?.textContent ?? null,
      console: window.__RDS_E2E__?.getState?.()?.consoleEntries?.slice(-12) ?? [],
    };`);
    console.error(`[logic-recovery] recovery diagnostics=${JSON.stringify(diagnostics)}`);
    throw error;
  }
  const recoveredText = String(recovered);
  if (!recoveredText.toLowerCase().includes("52 40 4e 75") || !recoveredText.includes("ADDQ")) {
    fail(`Recuperação da fixture não confirmou bytes/semântica: ${recovered}`);
  }
  report.steps.push({ step: "recover_exact_profile", status: "passed", offset, bytes: [0x52, 0x40, 0x4e, 0x75] });

  const invoke = async (command, args = {}) => executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") { done({ ok: false, error: "Tauri invoke indisponível" }); return; }
      invoke(arguments[0], arguments[1] ?? {}).then((value) => done({ ok: true, value })).catch((error) => done({ ok: false, error: String(error) }));
    `,
    [command, args]
  );
  const recoveryProbe = await invoke("rom_recover_logic", { romPath: routineRomPath, offset });
  if (!recoveryProbe?.ok || !recoveryProbe.value?.ok) {
    fail(`probe independente da recuperação falhou: ${JSON.stringify(recoveryProbe)}`);
  }
  const independentStates = recoveryProbe.value.independent_test_states ?? [];
  const stateFor = (input) => independentStates.find((state) => state.input_d0 === input);
  const upperWrap = stateFor(0x1234ffff);
  const signedOverflow = stateFor(0x00007fff);
  if (
    !upperWrap ||
    upperWrap.output_d0 !== 0x12340000 ||
    !upperWrap.output_z ||
    !upperWrap.output_c ||
    !upperWrap.output_x ||
    (upperWrap.output_d0 >>> 16) !== (upperWrap.input_d0 >>> 16) ||
    !signedOverflow ||
    signedOverflow.output_d0 !== 0x00008000 ||
    !signedOverflow.output_n ||
    !signedOverflow.output_v
  ) {
    fail(`cobertura independente de upper D0/wrap/flags incompleta: ${JSON.stringify(independentStates)}`);
  }
  report.steps.push({
    step: "independent_semantic_coverage",
    status: "passed",
    profileId: recoveryProbe.value.profile_id,
    operations: recoveryProbe.value.operations,
    sourceMappings: recoveryProbe.value.source_mappings,
    coverage: {
      upperD0PreservedAndWrap: true,
      zero: true,
      negative: true,
      signedOverflow: true,
      carryAndExtend: true,
    },
    states: independentStates,
  });

  const noOpPath = `${routineRomPath}.addq1.patched.bin`;
  const patchedPath = `${routineRomPath}.addq2.patched.bin`;
  await rm(noOpPath, { force: true });
  await rm(patchedPath, { force: true });
  const noOpPatch = await invoke("rom_patch_recovered_logic", {
    romPath: routineRomPath,
    outputPath: noOpPath,
    expectedSha256: report.fixture.routineRomSha256,
    offset,
    immediate: 1,
  });
  if (!noOpPatch?.ok || !noOpPatch.value?.output_path) {
    fail(`patch no-op #1 via IPC falhou: ${JSON.stringify(noOpPatch)}`);
  }
  await waitFor(
    async () => pathExists(noOpPath),
    15000,
    "cópia no-op da fixture não foi criada",
    100
  );
  const noOpBytes = await readFile(noOpPath);
  if (!noOpBytes.equals(routineBytes)) {
    fail("controle negativo no-op (#1) alterou bytes ou tamanho da ROM.");
  }
  report.steps.push({
    step: "negative_noop_patch",
    status: "passed",
    inputSha256: createHash("sha256").update(routineBytes).digest("hex"),
    outputSha256: createHash("sha256").update(noOpBytes).digest("hex"),
    outputPath: noOpPath,
    bytesEqual: true,
  });

  await callAutomationApi(sessionId, "setSelectedEntityId", ["camera_root"]);
  await clickButtonByTextWithPointerEvents(sessionId, "Aplicar ao NodeGraph selecionado");
  await waitFor(
    async () => executeScript(sessionId, `return document.body?.textContent?.includes("aplicado e persistido") ? true : false;`),
    15000,
    "Grafo recuperado não foi persistido pela UI",
    250
  );
  report.steps.push({ step: "apply_recovered_graph", status: "passed", entityId: "camera_root" });

  await callAutomationApi(sessionId, "closeProject");
  await callAutomationApi(sessionId, "openProject", [projectDir]);
  const reopenedLogic = await waitFor(
    async () => {
      const state = await callAutomationApi(sessionId, "getEntityLogicState", ["camera_root"]);
      return state?.source?.graph_origin === "rom_recovered" ? state : false;
    },
    30000,
    "Grafo recuperado não foi relido após fechar/reabrir o projeto",
    250
  );
  let reopenedGraph;
  try {
    reopenedGraph = JSON.parse(reopenedLogic.source?.graph_json ?? "");
  } catch {
    fail("grafo recuperado reaberto não é JSON válido.");
  }
  const reopenedOperation = (reopenedGraph.nodes ?? []).find((node) => node.type === "rom_addq_word");
  const expectedInstructionOffsets = `0x${offset.toString(16).toUpperCase().padStart(6, "0")},0x${(offset + 2).toString(16).toUpperCase().padStart(6, "0")}`;
  if (
    reopenedLogic.source.graph_origin !== "rom_recovered" ||
    !reopenedOperation ||
    reopenedOperation.params?.register !== "D0" ||
    reopenedOperation.params?.immediate !== 1 ||
    reopenedOperation.params?.width_bits !== 16 ||
    reopenedOperation.params?.rom_start !== offset ||
    reopenedOperation.params?.rom_end !== offset + 4 ||
    reopenedOperation.params?.rom_sha256 !== report.fixture.routineRomSha256 ||
    reopenedOperation.params?.instruction_offsets !== expectedInstructionOffsets ||
    reopenedGraph.edges?.length !== 1 ||
    reopenedGraph.edges[0]?.fromNode !== `${reopenedOperation.id}_entry`
  ) {
    fail(`grafo recuperado reaberto não preservou operação, conexão e source mapping: ${JSON.stringify(reopenedLogic)}`);
  }
  report.steps.push({
    step: "reopen_recovered_graph",
    status: "passed",
    graphOrigin: reopenedLogic.source.graph_origin,
    operation: {
      id: reopenedOperation.id,
      type: reopenedOperation.type,
      register: reopenedOperation.params.register,
      immediate: reopenedOperation.params.immediate,
      width_bits: reopenedOperation.params.width_bits,
      rom_start: reopenedOperation.params.rom_start,
      rom_end: reopenedOperation.params.rom_end,
      rom_sha256: reopenedOperation.params.rom_sha256,
      instruction_offsets: reopenedOperation.params.instruction_offsets,
    },
    edge: reopenedGraph.edges[0],
    sourceMappingCount: recoveryProbe.value.source_mappings?.length ?? 0,
  });

  const beforeBuild = await readAutomationState(sessionId);
  const beforeBuildCount = (beforeBuild?.consoleEntries ?? []).filter((entry) => String(entry.message ?? "").includes("Build concluido.")).length;
  await clickButtonByTestIdWithPointerEvents(sessionId, "toolbar-build-run");
  const builtState = await waitFor(
    async () => {
      const state = await readAutomationState(sessionId);
      const count = (state?.consoleEntries ?? []).filter((entry) => String(entry.message ?? "").includes("Build concluido.")).length;
      return count > beforeBuildCount ? state : false;
    },
    120000,
    "Projeto com grafo recuperado não concluiu Build & Run",
    500
  );
  const builtRomPath = extractLatestRomPath(builtState);
  if (!builtRomPath) fail("Build & Run não reportou ROM gerada para o grafo reaberto.");
  const generatedMainPath = path.join(path.dirname(path.dirname(builtRomPath)), "src", "main.c");
  const generatedMain = await readFile(generatedMainPath, "utf8").catch(() => "");
  if (!generatedMain.includes("rds_rom_word_result") || !generatedMain.includes("logic_var_rom_d0")) {
    fail(`C gerado pelo NodeGraph não contém a operação recuperada: ${generatedMainPath}`);
  }
  report.steps.push({
    step: "build_reopened_project",
    status: "passed",
    romPath: builtRomPath,
    romOrigin: "generated_from_reopened_nodegraph",
    generatedMainPath,
    generatedMainSha256: createHash("sha256").update(generatedMain).digest("hex"),
    generatedSemantics: "rds_rom_word_result + logic_var_rom_d0",
  });

  const neutralInput = {
    b: false, y: false, select: false, start: false,
    up: false, down: false, left: false, right: false,
    a: false, x: false, l: false, r: false,
  };
  const controlledFrames = 1;
  const readOracle = async (label) => {
    const memory = await invoke("emulator_read_memory", { region: 2, offset: 0xff00, length: 6 });
    const stateProbe = await invoke("emulator_read_memory", { region: 2, offset: 0, length: 8 });
    if (!memory?.ok || !memory.value?.ok || (memory.value.data ?? []).length < 6) {
      fail(`oracle de WRAM indisponível após ${label}: ${JSON.stringify(memory)}`);
    }
    const bytes = Buffer.from(memory.value.data);
    const readWordNative = (offset) => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
    return {
      // Genesis Plus GX exposes 68000 WRAM as native 16-bit words in host
      // order; decode each word explicitly, preserving the independent RAM
      // oracle instead of comparing an opaque byte diff.
      value: (((readWordNative(0) << 16) >>> 0) | readWordNative(2)) >>> 0,
      flags: readWordNative(4),
      region: 2,
      valueOffset: 0xff00,
      flagsOffset: 0xff04,
      rawHex: bytes.toString("hex"),
      stateProbe: stateProbe?.value?.data ?? null,
    };
  };
  const applyAddQWordOracle = (value, immediate) => {
    const before = value & 0xffff;
    const result = (before + immediate) & 0xffff;
    const flags =
      (result & 0x8000 ? 1 : 0) |
      (result === 0 ? 2 : 0) |
      (before < 0x8000 && result >= 0x8000 ? 4 : 0) |
      (before + immediate > 0xffff ? 8 | 16 : 0);
    return { value: (((value & 0xffff0000) >>> 0) | result) >>> 0, flags };
  };
  const observeRom = async (pathToRun, label, expectedOracle) => {
    const loaded = await callAutomationApi(sessionId, "loadRomForEmulation", [pathToRun, { startPaused: true }]);
    if (loaded !== true) fail(`Emulador não confirmou carga de ${label}.`);
    await waitFor(
      async () => {
        const state = await readAutomationState(sessionId);
        return state?.activeViewportTab === "game" && state?.emulatorLoaded === true && state?.emulPaused === true ? state : false;
      },
      15000,
      `${label} não ficou pausada antes da execução controlada`,
      100
    );
    const preWarmup = await invoke("emulator_observe");
    if (!preWarmup?.ok || !preWarmup.value?.ok) fail(`observação inicial de ${label} falhou: ${JSON.stringify(preWarmup)}`);
    const epoch = await invoke("emulator_get_core_epoch");
    if (!epoch?.ok || !Number.isInteger(epoch.value)) fail(`época do core indisponível para ${label}: ${JSON.stringify(epoch)}`);
    const inputAck = await invoke("emulator_send_input", { joypad: neutralInput, sessionEpoch: epoch.value });
    if (!inputAck?.ok || !inputAck.value?.ok) fail(`input neutro não confirmado para ${label}: ${JSON.stringify(inputAck)}`);
    const startupFrames = 120;
    const warmed = await invoke("emulator_run_frames", { frames: startupFrames });
    const before = await invoke("emulator_observe");
    const beforeOracle = await readOracle(`${label} após warmup`);
    const warmupDelta = before?.value?.frames_run - preWarmup.value.frames_run;
    if (
      !warmed?.ok ||
      !warmed.value?.ok ||
      !before?.ok ||
      !before.value?.ok ||
      warmupDelta !== startupFrames ||
      (expectedOracle.before && beforeOracle.value !== expectedOracle.before.value) ||
      (expectedOracle.before && beforeOracle.flags !== expectedOracle.before.flags) ||
      (beforeOracle.value >>> 16) !== 0x1234 ||
      beforeOracle.flags !== 0
    ) {
      fail(`warmup/oracle inicial de ${label} não foi determinístico: ${JSON.stringify({ warmupDelta, startupFrames, before: { frames_run: before?.value?.frames_run, rom_sha256: before?.value?.rom_sha256, framebuffer_sha256: before?.value?.framebuffer_sha256 }, beforeOracle })}`);
    }
    const ran = await invoke("emulator_run_frames", { frames: controlledFrames });
    if (!ran?.ok || !ran.value?.ok) fail(`Execução da ${label} falhou: ${JSON.stringify(ran)}`);
    const observed = await invoke("emulator_observe");
    const frameDelta = observed?.value?.frames_run - before.value.frames_run;
    const oracle = await readOracle(label);
    const expectedAfter = applyAddQWordOracle(beforeOracle.value, expectedOracle.immediate);
    if (
      !observed?.ok ||
      !observed.value?.ok ||
      frameDelta !== controlledFrames ||
      (observed.value.framebuffer_rgba ?? []).length === 0 ||
      oracle.value !== expectedAfter.value ||
      oracle.flags !== expectedAfter.flags
    ) {
      fail(`Observação da ${label} não comprovou core/framebuffer/oracle: ${JSON.stringify({ observed: observed?.value ? { ok: observed.ok, rom_sha256: observed.value.rom_sha256, core_label: observed.value.core_label, frames_run: observed.value.frames_run, framebuffer_sha256: observed.value.framebuffer_sha256, framebuffer_rgba_bytes: (observed.value.framebuffer_rgba ?? []).length } : observed, oracle, beforeOracle, frameDelta })}`);
    }
    const stateAfter = await readAutomationState(sessionId);
    if (stateAfter?.emulPaused !== true) fail(`${label} saiu do estado pausado após lote controlado.`);
    return {
      rom_sha256: observed.value.rom_sha256,
      framebuffer_sha256: observed.value.framebuffer_sha256,
      frames_before: before.value.frames_run,
      frames_after: observed.value.frames_run,
      frame_delta: frameDelta,
      frames_requested: controlledFrames,
      startup_frames: startupFrames,
      warmup_delta: warmupDelta,
      input: neutralInput,
      input_ack: inputAck.value,
      oracle_before: beforeOracle,
      expected_oracle_after: expectedAfter,
      oracle,
    };
  };
  const expectedOriginalOracle = { immediate: 1, before: { value: 0x12340058, flags: 0 } };
  const expectedPatchedOracle = { immediate: 2, before: { value: 0x12340058, flags: 0 } };
  const nodeFixtureObservation = await observeRom(nodeRomPath, "ROM node fixture/code-generation", expectedOriginalOracle);
  const generatedGraphObservation = await observeRom(
    builtRomPath,
    "ROM gerada pelo grafo NodeGraph",
    expectedOriginalOracle
  );
  const originalObservationA = await observeRom(routineRomPath, "ROM original A", expectedOriginalOracle);
  const originalObservationB = await observeRom(routineRomPath, "ROM original B", expectedOriginalOracle);
  if (
    nodeFixtureObservation.oracle_before.value !== expectedOriginalOracle.before.value ||
    generatedGraphObservation.oracle_before.value !== expectedOriginalOracle.before.value ||
    generatedGraphObservation.oracle.value !== originalObservationA.oracle.value ||
    generatedGraphObservation.oracle.flags !== originalObservationA.oracle.flags ||
    nodeFixtureObservation.oracle.value !== originalObservationA.oracle.value ||
    nodeFixtureObservation.oracle.flags !== originalObservationA.oracle.flags ||
    JSON.stringify(generatedGraphObservation.input) !== JSON.stringify(originalObservationA.input) ||
    JSON.stringify(nodeFixtureObservation.input) !== JSON.stringify(originalObservationA.input) ||
    originalObservationA.rom_sha256 !== originalObservationB.rom_sha256 ||
    originalObservationA.framebuffer_sha256 !== originalObservationB.framebuffer_sha256 ||
    JSON.stringify(originalObservationA.oracle) !== JSON.stringify(originalObservationB.oracle) ||
    originalObservationA.frame_delta !== controlledFrames ||
    originalObservationB.frame_delta !== controlledFrames
  ) {
    fail(`controle comum entre ROM gerada/original não foi determinístico: ${JSON.stringify({ nodeFixtureObservation, generatedGraphObservation, originalObservationA, originalObservationB })}`);
  }
  report.steps.push({
    step: "generated_graph_rom_observation",
    status: "passed",
    romOrigin: "generated_from_reopened_nodegraph",
    romPath: builtRomPath,
    romSha256: generatedGraphObservation.rom_sha256,
    generatedMainPath,
    generatedMainSha256: createHash("sha256").update(generatedMain).digest("hex"),
    observation: generatedGraphObservation,
    expected: {
      before: expectedOriginalOracle.before,
      after: generatedGraphObservation.expected_oracle_after,
    },
  });
  const noOpObservation = await observeRom(noOpPath, "patch no-op #1", expectedOriginalOracle);
  const patchResult = await invoke("rom_patch_recovered_logic", {
    romPath: routineRomPath,
    outputPath: patchedPath,
    expectedSha256: report.fixture.routineRomSha256,
    offset,
    immediate: 2,
  });
  if (!patchResult?.ok || !patchResult.value?.output_path) {
    fail(`patch #2 via IPC falhou: ${JSON.stringify(patchResult)}`);
  }
  await waitFor(async () => pathExists(patchedPath), 15000, "Cópia patchada da fixture não foi criada", 100);
  const finalPatchBytes = await readFile(patchedPath);
  if (
    finalPatchBytes.length !== routineBytes.length ||
    !finalPatchBytes.subarray(0, offset).equals(routineBytes.subarray(0, offset)) ||
    !finalPatchBytes.subarray(offset + 4).equals(routineBytes.subarray(offset + 4)) ||
    !finalPatchBytes.subarray(offset, offset + 4).equals(Buffer.from([0x54, 0x40, 0x4e, 0x75]))
  ) {
    fail(`patch #2 não alterou somente o imediato esperado em 0x${offset.toString(16)}.`);
  }
  const patchedObservation = await observeRom(patchedPath, "ROM patchada #2", expectedPatchedOracle);
  for (const [label, observation] of [
    ["patch no-op #1", noOpObservation],
    ["ROM patchada #2", patchedObservation],
  ]) {
    if (
      observation.oracle_before.value !== expectedOriginalOracle.before.value ||
      observation.oracle_before.flags !== expectedOriginalOracle.before.flags ||
      JSON.stringify(observation.input) !== JSON.stringify(originalObservationA.input) ||
      observation.frame_delta !== controlledFrames
    ) {
      fail(`estado inicial/input comum não foi preservado em ${label}: ${JSON.stringify({ observation, originalObservationA })}`);
    }
  }
  if (
    originalObservationA.rom_sha256 === patchedObservation.rom_sha256 ||
    originalObservationA.oracle.value === patchedObservation.oracle.value
  ) {
    fail(`patch controlado não produziu diferença observável/oracular: ${JSON.stringify({ originalObservationA, patchedObservation })}`);
  }
  report.steps.push({
    step: "deterministic_original_node_and_patch_runs",
    status: "passed",
    controlledFrames,
    inputScript: [neutralInput],
    expectedOriginalOracle,
    expectedPatchedOracle,
    nodeFixtureObservation,
    generatedGraphObservation,
    originalObservationA,
    originalObservationB,
    noOpObservation,
    patchedObservation,
    fullHashes: {
      original: report.fixture.routineRomSha256,
      noOp: createHash("sha256").update(noOpBytes).digest("hex"),
      patched: createHash("sha256").update(finalPatchBytes).digest("hex"),
      node: report.fixture.nodeRomSha256,
      generatedGraph: generatedGraphObservation.rom_sha256,
    },
  });
  report.finishedAt = new Date().toISOString();
  await ensureValidationDir();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[logic-recovery] relatório=${reportPath}`);
  console.log("OK: Desktop Tauri logic-recovery E2E passou com recuperação, grafo, patch e efeito observado.");
}

// Cadeia REX LZ4W pela interface: prévia, no-op, edição via transação,
// patch re-aplicado à base com hash exato e efeito observado no core.
// Observa o framebuffer direto do core via IPC (capacidade separada do
// canvas do app; usada pelas timelines determinísticas REX).
async function invokeCoreObserve(sessionId) {
  return executeAsyncScript(
    sessionId,
    `
      const done = arguments[arguments.length - 1];
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") { done(null); return; }
      invoke('emulator_observe', {}).then((value) => done(value)).catch(() => done(null));
    `,
    []
  );
}

async function runRexLz4wEffectScenario(sessionId) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const expectedSha = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
  const targetOffsetHex = "c8cc8";
  const romPath = process.env.RDS_REX_RESOURCE_ROM ?? process.env.RDS_INSPECTION_ROM ?? "";
  if (!romPath || !(await pathExists(romPath))) {
    fail("RDS_REX_RESOURCE_ROM deve apontar para a ROM BYOR congelada existente.");
  }
  const romBytes = await readFile(romPath);
  const romSha = createHash("sha256").update(romBytes).digest("hex");
  if (romSha !== expectedSha) fail(`ROM inesperada: ${romSha}`);

  await callAutomationApi(sessionId, "openToolsWorkspace", ["reverse", "debug", true]);
  await waitFor(
    async () => executeScript(
      sessionId,
      `return Boolean(document.querySelector('[data-testid="reverse-tab-resources"]'));`
    ),
    30000,
    `aba de recursos não apareceu; DOM: ${(await executeScript(
      sessionId,
      `return Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')).filter((t) => (t || '').startsWith('reverse-') || (t || '').startsWith('rex-')).slice(0, 30).join(',');`
    )) || "sem testids reverse/rex"}`,
    250
  );
  await clickButtonByTestIdWithPointerEvents(sessionId, "reverse-tab-resources");
  const panel = '[data-testid="rex-resource-panel"]';
  await waitFor(
    async () => executeScript(sessionId, `return Boolean(document.querySelector('${panel} [data-testid="rex-resource-rom-input"]'));`),
    15000,
    "painel de recursos comprimidos não abriu.",
    250
  );
  await executeScript(sessionId, `
    const input = document.querySelector('${panel} input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(romPath)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;`);
  await clickButtonByTestIdWithPointerEvents(sessionId, "rex-resource-verify");
  await waitFor(
    async () => executeScript(sessionId, `return Boolean(document.querySelector('${panel} [data-testid="rex-resource-select"] option[value="${targetOffsetHex}"]'));`),
    30000,
    "recursos verificados não apareceram (verificação estrutural falhou).",
    250
  );
  await executeScript(sessionId, `
    const select = document.querySelector('${panel} [data-testid="rex-resource-select"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, '${targetOffsetHex}');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;`);
  await waitFor(
    async () => executeScript(sessionId, `return Boolean(document.querySelector('${panel} [data-testid="rex-resource-canvas"]'));`),
    30000,
    "prévia chunky não apareceu.",
    250
  );
  const previewPixelsSha = await executeScript(
    sessionId,
    `return document.querySelector('${panel} [data-testid="rex-resource-pixels-sha"]').textContent;`
  );
  if (typeof previewPixelsSha !== "string" || previewPixelsSha.length < 8) fail("prévia sem hash de pixels.");

  // NO-OP: aplicar com zero edições pela mesma transação.
  await clickButtonByTestIdWithPointerEvents(sessionId, "rex-resource-apply");
  await waitFor(
    async () => ((await executeScript(sessionId, `return document.querySelector('${panel} [data-testid="rex-resource-result"]')?.textContent ?? ''`)) || "").includes("noop"),
    30000,
    "transação não reportou no-op com zero edições.",
    250
  );

  // EDIÇÃO determinística: índice 9 no pixel (7,7) do ÚLTIMO tile (67) —
  // altera só o último byte do dado (espaço comprovado pela enumeração).
  const setNumberInput = async (testId, value) => {
    await executeScript(sessionId, `
      const input = document.querySelector('${panel} [data-testid="${testId}"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '${value}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;`);
  };
  await setNumberInput("rex-resource-paint-index", 15);
  await setNumberInput("rex-resource-edit-tile", 0);
  await setNumberInput("rex-resource-edit-row", 0);
  await setNumberInput("rex-resource-edit-col", 0);
  await clickButtonByTestIdWithPointerEvents(sessionId, "rex-resource-add-edit");
  await waitFor(
    async () => ((await executeScript(sessionId, `return document.querySelector('${panel}')?.textContent ?? ''`)) || "").includes("1 edição(ões) pendente(s)"),
    15000,
    `clique na prévia não registrou edição pendente; painel: ${((await executeScript(sessionId, `return document.querySelector('${panel}')?.textContent ?? ''`)) || "").slice(-800)}`,
    250
  );
  await clickButtonByTestIdWithPointerEvents(sessionId, "rex-resource-apply");
  const resultText = await waitFor(
    async () => {
      const text = (await executeScript(sessionId, `return document.querySelector('${panel} [data-testid="rex-resource-result"]')?.textContent ?? ''`)) || "";
      if (text.includes("applied")) return text;
      const errorText = (await executeScript(sessionId, `return document.querySelector('${panel} [data-testid="rex-resource-error"]')?.textContent ?? ''`)) || "";
      if (errorText) fail(`transação recusou a edição: ${errorText}`);
      return false;
    },
    30000,
    "transação não aplicou a edição.",
    250
  );
  const modifiedMatch = resultText.match(/cópia: (\S+)/);
  const patchMatch = resultText.match(/patch: (\S+)/);
  if (!modifiedMatch || !patchMatch) fail(`proveniência ausente no resultado: ${resultText.slice(0, 200)}`);
  const modifiedPath = modifiedMatch[1];
  const patchPath = patchMatch[1];
  const modifiedSha = createHash("sha256").update(await readFile(modifiedPath)).digest("hex");
  const patchSha = createHash("sha256").update(await readFile(patchPath)).digest("hex");
  const preservedMatch = resultText.match(/preservados (\d+)/);
  if (!preservedMatch || Number(preservedMatch[1]) < 1) fail("contagem de recursos preservados ausente.");

  // Patch re-aplicado à cópia da base: hash exato da cópia modificada.
  const baseCopy = path.join(validationDir, "rex-lz4w-base-copy.bin");
  const patchApplied = path.join(validationDir, "rex-lz4w-patch-applied.bin");
  await writeFile(baseCopy, romBytes);
  const applyResult = await executeScript(sessionId, `
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    return await invoke('patch_apply_bps', { romPath: ${JSON.stringify(baseCopy)}, patchPath: ${JSON.stringify(patchPath)}, outputPath: ${JSON.stringify(patchApplied)} });`);
  if (!applyResult || applyResult.ok !== true) fail(`patch_apply_bps falhou: ${JSON.stringify(applyResult)}`);
  const appliedSha = createHash("sha256").update(await readFile(patchApplied)).digest("hex");
  if (appliedSha !== modifiedSha) fail(`patch re-aplicado diverge: ${appliedSha} != ${modifiedSha}`);

  // SALVAR/REABRIR: a cópia modificada reabre no MESMO pipeline da UI —
  // identidade própria e prévia com pixels DIFERENTES do original (a edição
  // persistiu no artefato e o painel re-deriva tudo de disco).
  await executeScript(sessionId, `
    const input = document.querySelector('${panel} input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(modifiedPath)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;`);
  await clickButtonByTestIdWithPointerEvents(sessionId, "rex-resource-verify");
  const reopenedSha = await waitFor(
    async () => {
      const text = (await executeScript(sessionId, `return document.querySelector('${panel} [data-testid="rex-resource-rom-sha"]')?.textContent ?? ''`)) || "";
      return text.includes(modifiedSha.slice(0, 16)) ? modifiedSha : false;
    },
    30000,
    "ROM modificada não reabriu com a própria identidade no painel.",
    250
  );
  await executeScript(sessionId, `
    const select = document.querySelector('${panel} [data-testid="rex-resource-select"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, '${targetOffsetHex}');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;`);
  await waitFor(
    async () => executeScript(sessionId, `return Boolean(document.querySelector('${panel} [data-testid="rex-resource-canvas"]'));`),
    30000,
    "prévia da ROM modificada não apareceu.",
    250
  );
  const modifiedPreviewSha = await executeScript(
    sessionId,
    `return document.querySelector('${panel} [data-testid="rex-resource-pixels-sha"]').textContent;`
  );
  if (modifiedPreviewSha === previewPixelsSha) {
    fail(`prévia da ROM modificada é idêntica à original: a edição não persistiu no artefato`);
  }

  // ORIGINAL vs MODIFICADO no core, mesma linha de input; efeito específico.
  // CAPACIDADE SEPARADA — apresentação normal do app: o canvas deve exibir
  // o mesmo framebuffer que o core produz (resumindo o loop vivo e
  // comparando canvas vs emulator_observe no mesmo instante).
  await clickByTestId(sessionId, "workspace-rail-game");
  await waitFor(
    async () => executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="viewport-game-canvas"]'));`),
    15000,
    "Game View não abriu para a verificação de apresentação do canvas.",
    250
  );
  await clickButtonByTestIdWithPointerEvents(sessionId, "viewport-resume");
  await pause(400);
  {
    const canvasFrame = await readCanonicalGameFrame(sessionId, { includePixels: true });
    const observation = await invokeCoreObserve(sessionId);
    if (canvasFrame?.rgba && observation?.framebuffer_rgba) {
      const canvasSha = createHash("sha256").update(Buffer.from(canvasFrame.rgba)).digest("hex");
      const coreSha = createHash("sha256").update(Buffer.from(observation.framebuffer_rgba)).digest("hex");
      console.log(`[rex-lz4w-canvas] ${JSON.stringify({ canvasSha: canvasSha.slice(0, 16), coreSha: coreSha.slice(0, 16), identical: canvasSha === coreSha })}`);
      if (canvasSha !== coreSha) {
        fail("canvas do app não exibe o framebuffer do core na apresentação normal");
      }
    }
  }
  // Timeline determinística: load pausado -> inputs e lotes de frames via
  // IPC do core -> framebuffer lido por `emulator_observe` (independe do
  // loop vivo do app, que não redesenha o canvas com o core pausado).
  const captureTimeline = async (timelineRomPath, label) => {
    const loaded = await callAutomationApi(sessionId, "loadRomForEmulation", [timelineRomPath, { startPaused: true }]);
    if (loaded !== true) fail(`Emulador não confirmou carga da ROM (${label}).`);
    await waitFor(
      async () => {
        const state = await readAutomationState(sessionId);
        return state?.emulatorLoaded === true && state?.emulPaused === true ? state : false;
      },
      15000,
      `${label}: ROM não ficou pausada pronta.`,
      100
    );
    await closeVisibleConsoleDrawer(sessionId, label);
    const invokeCore = async (command, args = {}) => executeAsyncScript(
      sessionId,
      `
        const done = arguments[arguments.length - 1];
        const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== "function") { done({ ok: false, error: "Tauri invoke indisponivel" }); return; }
        invoke(arguments[0], arguments[1] ?? {}).then((value) => done({ ok: true, value })).catch((error) => done({ ok: false, error: String(error) }));
      `,
      [command, args]
    );
    const epoch = await invokeCore("emulator_get_core_epoch");
    if (!epoch?.ok || !Number.isInteger(epoch.value)) fail(`Época do core indisponível (${label}).`);
    const neutralInput = {
      b: false, y: false, select: false, start: false,
      up: false, down: false, left: false, right: false,
      a: false, x: false, l: false, r: false,
    };
    const sendInput = async (joypad) => {
      const ack = await invokeCore("emulator_send_input", { joypad, sessionEpoch: epoch.value });
      if (!ack?.ok || !ack.value?.ok) fail(`Input não confirmado (${label}): ${JSON.stringify(ack)}`);
    };
    const runFrames = async (frames) => {
      const run = await invokeCore("emulator_run_frames", { frames });
      if (!run?.ok) fail(`emulator_run_frames falhou (${label}): ${JSON.stringify(run)}`);
    };
    const snapshot = async (dumpName) => {
      const observation = await invokeCore("emulator_observe", {});
      if (!observation?.ok || !observation.value?.framebuffer_rgba) {
        fail(`framebuffer do core indisponível (${label}): ${JSON.stringify(observation?.error ?? observation)}`);
      }
      if (dumpName) {
        const rgba = Buffer.from(observation.value.framebuffer_rgba);
        const width = observation.value.framebuffer_width;
        const height = observation.value.framebuffer_height;
        const ppm = Buffer.alloc(width * height * 3);
        for (let p = 0; p < width * height; p++) {
          ppm[p * 3] = rgba[p * 4];
          ppm[p * 3 + 1] = rgba[p * 4 + 1];
          ppm[p * 3 + 2] = rgba[p * 4 + 2];
        }
        const ppmPath = path.join(validationDir, `rex-frame-${label}-${dumpName}.ppm`);
        await writeFile(ppmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), ppm]));
        await new Promise((resolve) => execFile("convert", [ppmPath, ppmPath.replace(".ppm", ".png")], () => resolve()));
      }
      return Buffer.from(observation.value.framebuffer_rgba);
    };
    const samples = [];
    await runFrames(180);
    samples.push(await snapshot("boot"));
    await runFrames(420);
    samples.push(await snapshot("pos-start"));
    await sendInput({ ...neutralInput, start: true });
    await runFrames(3);
    await sendInput(neutralInput);
    await runFrames(240);
    samples.push(await snapshot());
    // Aproxima até contato e ataca repetidamente (faíscas de golpe são
    // candidatas ao recurso de 9 tiles).
    await sendInput({ ...neutralInput, right: true });
    await runFrames(300);
    samples.push(await snapshot());
    for (let round = 0; round < 3; round++) {
      await sendInput({ ...neutralInput, right: true, a: true });
      for (let step = 0; step < 4; step++) {
        await runFrames(15);
        samples.push(await snapshot(round === 0 && step === 2 ? "ataque-a" : undefined));
      }
      await sendInput({ ...neutralInput, right: true, b: true });
      for (let step = 0; step < 4; step++) {
        await runFrames(15);
        samples.push(await snapshot());
      }
    }
    await sendInput(neutralInput);
    await runFrames(60);
    samples.push(await snapshot());
    return samples;
  };
  const originalFrames = await captureTimeline(romPath, "original");
  const modifiedFrames = await captureTimeline(patchApplied, "modificado");
  if (originalFrames.length !== modifiedFrames.length || originalFrames.length < 2) {
    fail(`timelines desiguais: ${originalFrames.length} vs ${modifiedFrames.length}`);
  }
  // Diagnóstico: o que muda entre snapshots consecutivos do ORIGINAL?
  for (let i = 1; i < originalFrames.length; i++) {
    const a = originalFrames[i - 1];
    const b = originalFrames[i];
    let count = 0;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let p = 0; p < a.length; p += 4) {
      if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2]) {
        count++;
        const pixelIndex = p / 4;
        const x = pixelIndex % 320;
        const y = Math.floor(pixelIndex / 320);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    console.log(`[rex-diag] par ${i - 1}->${i}: ${count} px mudaram, caixa ${maxX >= 0 ? `${minX},${minY} ${maxX - minX + 1}x${maxY - minY + 1}` : "nenhuma"}`);
  }
  let diffFrame = -1;
  let diffPixels = 0;
  let minDiffX = 1e9, minDiffY = 1e9, maxDiffX = -1, maxDiffY = -1;
  for (let i = 0; i < originalFrames.length; i++) {
    const a = originalFrames[i];
    const b = modifiedFrames[i];
    if (a.length !== b.length) fail("framebuffers de tamanhos diferentes");
    if (a.equals(b)) continue;
    let count = 0;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let p = 0; p < a.length; p += 4) {
      if (!a.equals(b) && (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2])) {
        count++;
        const pixelIndex = p / 4;
        const x = pixelIndex % 320;
        const y = Math.floor(pixelIndex / 320);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (count > 0) {
      diffFrame = i; diffPixels = count;
      minDiffX = minX; minDiffY = minY; maxDiffX = maxX; maxDiffY = maxY;
      break;
    }
  }
  if (diffFrame < 0) fail("nenhum frame difere entre original e modificado: recurso não observado em jogo.");
  const boxW = maxDiffX - minDiffX + 1;
  const boxH = maxDiffY - minDiffY + 1;
  if (diffPixels > 256 || boxW > 64 || boxH > 64) {
    fail(`efeito não é específico: ${diffPixels} pixels em caixa ${boxW}x${boxH} (esperado região pequena do recurso).`);
  }
  console.log(`[rex-lz4w-effect] ${JSON.stringify({
    romSha, targetOffset: `0x${targetOffsetHex}`, previewPixelsSha, modifiedSha, patchSha,
    preserved: Number(preservedMatch[1]), diffFrame, diffPixels, box: { minDiffX, minDiffY, boxW, boxH },
  })}`);
}

async function runBranchLogicRecoveryScenario(sessionId, projectDir) {  const nodeRomPath = process.env.RDS_LOGIC_BRANCH_NODE_ROM ?? "";
  const routineRomPath = process.env.RDS_LOGIC_BRANCH_ROUTINE_ROM ?? "";
  const offset = Number.parseInt(process.env.RDS_LOGIC_BRANCH_OFFSET ?? "", 0);
  const routineSignature = Buffer.from("064000010C4000056C0A33FC0000E0FFFF004E7533FC0001E0FFFF004E75", "hex");
  if (!nodeRomPath || !routineRomPath || !Number.isInteger(offset) || !(await pathExists(nodeRomPath)) || !(await pathExists(routineRomPath))) {
    fail("logic-recovery-branch exige RDS_LOGIC_BRANCH_NODE_ROM, RDS_LOGIC_BRANCH_ROUTINE_ROM e RDS_LOGIC_BRANCH_OFFSET.");
  }
  const nodeBytes = await readFile(nodeRomPath);
  const routineBytes = await readFile(routineRomPath);
  if (!routineBytes.subarray(offset, offset + routineSignature.length).equals(routineSignature)) {
    fail(`fixture branch não contém a rotina exata no offset 0x${offset.toString(16)}.`);
  }
  const nodeSourcePath = path.join(path.dirname(path.dirname(nodeRomPath)), "src", "main.c");
  const routineSourcePath = path.join(path.dirname(path.dirname(routineRomPath)), "src", "main.c");
  const nodeSource = await readFile(nodeSourcePath, "utf8");
  const routineSource = await readFile(routineSourcePath, "utf8");
  if (!nodeSource.includes("node_generated_branch_compare_word") || !nodeSource.includes("rds_branch_result")) fail("caminho Node não contém read/add/compare/branch/write da fixture.");
  if (!routineSource.includes("recovered_branch_logic_bridge")) fail("caminho original não contém a chamada da rotina M68K vinculada.");

  const artifactPrefix = `logic-recovery-branch-${artifactTimestamp()}`;
  const reportPath = path.join(validationDir, `${artifactPrefix}-report.json`);
  const appBytes = await readFile(currentE2eRunContext?.appPath ?? "").catch(() => null);
  const report = {
    generatedAt: new Date().toISOString(),
    scenario: "logic-recovery-branch",
    application: { path: currentE2eRunContext?.appPath ?? null, sha256: appBytes ? createHash("sha256").update(appBytes).digest("hex") : null },
    fixture: {
      nodeRomPath, routineRomPath,
      nodeRomSha256: createHash("sha256").update(nodeBytes).digest("hex"),
      routineRomSha256: createHash("sha256").update(routineBytes).digest("hex"),
      nodeSourcePath, routineSourcePath,
      nodeSourceSha256: createHash("sha256").update(nodeSource).digest("hex"),
      routineSourceSha256: createHash("sha256").update(routineSource).digest("hex"),
    },
    profileId: "m68k.add_compare_branch_word_d0_wram.v1",
    offset,
    steps: [],
  };

  await setSessionWindowRect(sessionId, 1280, 800);
  await callAutomationApi(sessionId, "openProject", [projectDir]);
  await waitFor(async () => (await readAutomationState(sessionId))?.activeProjectDir === projectDir, 30000, "Fixture branch não abriu", 250);
  await closeVisibleConsoleDrawer(sessionId);
  await callAutomationApi(sessionId, "openToolsWorkspace", ["reverse", "debug", true]);
  await waitForBodyText(sessionId, "Analisar ROM", 15000, "Reverse Workspace não abriu para branch");
  await fillInputBySelector(sessionId, 'input[placeholder="/roms/game.md"]', routineRomPath);
  await clickButtonByTextWithPointerEvents(sessionId, "Analisar ROM");
  await waitFor(async () => executeScript(sessionId, `return document.body?.textContent?.includes("ROM Map") ? true : false;`), 30000, "Análise branch não concluiu", 250);
  const openedCode = await executeScript(sessionId, `const button = Array.from(document.querySelectorAll("button")).find((candidate) => ["Code", "Voltar para Code"].includes(candidate.textContent?.replace(/\\s+/g, " ").trim())); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.scrollIntoView({block:"center"}); button.click(); return true;`);
  if (!openedCode) fail("A aba Code não abriu a superfície branch.");
  await waitForBodyText(sessionId, "Lógica ROM → Nodes", 15000, "Code branch não abriu");
  await fillInputByLabel(sessionId, "Offset", `0x${offset.toString(16)}`);
  await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="reverse-recover-logic"]:not([disabled])'));`), 30000, "Recuperação branch não habilitou", 250);
  await clickButtonByTestIdWithPointerEvents(sessionId, "reverse-recover-logic");
  await waitFor(async () => executeScript(sessionId, `const card=document.querySelector('[data-testid="reverse-logic-recovery-card"]'); return card?.textContent?.includes("m68k.add_compare_branch_word_d0_wram.v1") ? true : false;`), 30000, "Perfil branch não apareceu na UI", 250);

  const invoke = async (command, args = {}) => executeAsyncScript(sessionId, `const done=arguments[arguments.length-1]; const invoke=window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke; if(typeof invoke!=="function"){done({ok:false,error:"Tauri invoke indisponível"});return;} invoke(arguments[0],arguments[1]??{}).then((value)=>done({ok:true,value})).catch((error)=>done({ok:false,error:String(error)}));`, [command, args]);
  const recoveryProbe = await invoke("rom_recover_logic", { romPath: routineRomPath, offset });
  if (!recoveryProbe?.ok || !recoveryProbe.value?.ok || recoveryProbe.value.profile_id !== report.profileId) fail(`probe independente branch falhou: ${JSON.stringify(recoveryProbe)}`);
  const states = recoveryProbe.value.independent_test_states ?? [];
  const stateMap = new Map(states.map((state) => [state.input_d0, state]));
  const expectedStates = [[3, 0, false], [4, 1, true], [5, 1, true], [0xffff, 0, false], [0x1234, 1, true]];
  for (const [input, result, branchTaken] of expectedStates) {
    const state = stateMap.get(input);
    if (!state || state.output_result !== result || state.branch_taken !== branchTaken) fail(`oráculo independente branch incompleto em ${input}: ${JSON.stringify(state)}`);
  }
  if ((recoveryProbe.value.source_mappings ?? []).length !== 4 || !String(recoveryProbe.value.graph_json).includes("rom_branch_compare_word")) fail("source mapping/grafo branch não comprovaram as quatro faixas da rotina.");
  report.steps.push({ step: "recover_exact_branch_profile", status: "passed", profileId: recoveryProbe.value.profile_id, bytes: [...routineSignature], operations: recoveryProbe.value.operations, sourceMappings: recoveryProbe.value.source_mappings, independentStates: states, coverage: { falseBranch: true, trueBranch: true, thresholdMinusOne: true, threshold: true, wordWrap: true } });

  const noOpPath = `${routineRomPath}.branch5.patched.bin`;
  const patchedPath = `${routineRomPath}.branch6.patched.bin`;
  await rm(noOpPath, { force: true });
  await rm(patchedPath, { force: true });
  const patchNoOp = await invoke("rom_patch_recovered_logic", { romPath: routineRomPath, outputPath: noOpPath, expectedSha256: report.fixture.routineRomSha256, offset, immediate: 5 });
  if (!patchNoOp?.ok || !patchNoOp.value?.output_path) fail(`patch branch no-op falhou: ${JSON.stringify(patchNoOp)}`);
  await waitFor(async () => pathExists(noOpPath), 15000, "cópia branch no-op não foi criada", 100);
  const noOpBytes = await readFile(noOpPath);
  if (!noOpBytes.equals(routineBytes)) fail("patch branch no-op alterou a ROM.");

  await callAutomationApi(sessionId, "setSelectedEntityId", ["camera_root"]);
  await clickButtonByTextWithPointerEvents(sessionId, "Aplicar ao NodeGraph selecionado");
  await waitFor(async () => executeScript(sessionId, `return document.body?.textContent?.includes("aplicado e persistido") ? true : false;`), 15000, "Grafo branch não persistiu", 250);
  await callAutomationApi(sessionId, "closeProject");
  await callAutomationApi(sessionId, "openProject", [projectDir]);
  const reopenedLogic = await waitFor(async () => { const state = await callAutomationApi(sessionId, "getEntityLogicState", ["camera_root"]); return state?.source?.graph_origin === "rom_recovered" ? state : false; }, 30000, "Grafo branch não reabriu", 250);
  const reopenedGraph = JSON.parse(reopenedLogic.source?.graph_json ?? "{}");
  const reopenedNode = (reopenedGraph.nodes ?? []).find((node) => node.type === "rom_branch_compare_word");
  if (!reopenedNode || reopenedNode.params?.threshold !== 5 || reopenedNode.params?.rom_start !== offset || reopenedNode.params?.rom_end !== offset + routineSignature.length || reopenedGraph.edges?.length !== 1) fail(`save/reopen branch perdeu mapping/parâmetro: ${JSON.stringify(reopenedLogic)}`);
  report.steps.push({ step: "save_reopen_branch_graph", status: "passed", graphOrigin: reopenedLogic.source.graph_origin, node: reopenedNode, edge: reopenedGraph.edges[0] });

  const buildProject = async (label) => {
    const before = await readAutomationState(sessionId);
    const count = (before?.consoleEntries ?? []).filter((entry) => String(entry.message ?? "").includes("Build concluido.")).length;
    await clickButtonByTestIdWithPointerEvents(sessionId, "toolbar-build-run");
    const built = await waitFor(async () => { const state = await readAutomationState(sessionId); const next = (state?.consoleEntries ?? []).filter((entry) => String(entry.message ?? "").includes("Build concluido.")).length; return next > count ? state : false; }, 120000, `${label} não concluiu Build & Run`, 500);
    const romPath = extractLatestRomPath(built);
    if (!romPath) fail(`${label} não reportou ROM gerada.`);
    const generatedMainPath = path.join(path.dirname(path.dirname(romPath)), "src", "main.c");
    const generatedMain = await readFile(generatedMainPath, "utf8");
    if (!generatedMain.includes("rds_branch_arithmetic") || !generatedMain.includes("rds_branch_recovery_result")) fail(`${label} não contém a rotina gerada pelo grafo: ${generatedMainPath}`);
    return { romPath, generatedMainPath, generatedMain, romSha256: createHash("sha256").update(await readFile(romPath)).digest("hex") };
  };
  const originalBuild = await buildProject("Build branch original");
  report.steps.push({ step: "build_graph_rom_original_parameter", status: "passed", romOrigin: "generated_from_reopened_nodegraph", ...originalBuild, generatedMainSha256: createHash("sha256").update(originalBuild.generatedMain).digest("hex"), expectedThreshold: 5 });

  const neutralInput = { b:false,y:false,select:false,start:false,up:false,down:false,left:false,right:false,a:false,x:false,l:false,r:false };
  const readBranchOracle = async (label) => {
    const memory = await invoke("emulator_read_memory", { region: 2, offset: 0xff00, length: 4 });
    if (!memory?.ok || !memory.value?.ok || (memory.value.data ?? []).length < 4) fail(`oracle branch indisponível após ${label}: ${JSON.stringify(memory)}`);
    const bytes = Buffer.from(memory.value.data);
    const word = (offsetValue) => (bytes[offsetValue] ?? 0) | ((bytes[offsetValue + 1] ?? 0) << 8);
    return { result: word(0), input: word(2), rawHex: bytes.toString("hex"), region: 2, resultOffset: 0xff00, inputOffset: 0xff02 };
  };
  const inputCases = [3, 4, 5, 0, 0xffff, 0x1234];
  const oracleResult = (input, threshold) => { const word = (input + 1) & 0xffff; const signedWord = word >= 0x8000 ? word - 0x10000 : word; return signedWord >= threshold ? 1 : 0; };
  const observeBranchRom = async (romPath, label, threshold) => {
    if (await callAutomationApi(sessionId, "loadRomForEmulation", [romPath, { startPaused: true }]) !== true) fail(`Emulador não carregou ${label}.`);
    await waitFor(async () => { const state = await readAutomationState(sessionId); return state?.activeViewportTab === "game" && state?.emulatorLoaded === true && state?.emulPaused === true ? state : false; }, 15000, `${label} não ficou pausada`, 100);
    const epoch = await invoke("emulator_get_core_epoch");
    const ack = await invoke("emulator_send_input", { joypad: neutralInput, sessionEpoch: epoch.value });
    if (!ack?.ok || !ack.value?.ok) fail(`input neutro não confirmado para ${label}.`);
    const warmed = await invoke("emulator_run_frames", { frames: 120 });
    if (!warmed?.ok || !warmed.value?.ok) fail(`warmup falhou para ${label}.`);
    const warmupOracle = await readBranchOracle(`${label} warmup`);
    const samples = [];
    const beforeFrames = warmed.value.frames_run;
    let syncFrames = 0;
    let synchronized = warmupOracle;
    while (synchronized.input !== inputCases[0] && syncFrames < inputCases.length * 2) {
      const ran = await invoke("emulator_run_frames", { frames: 1 });
      if (!ran?.ok || !ran.value?.ok) fail(`sincronização do frame controlado falhou em ${label}.`);
      syncFrames += 1;
      synchronized = await readBranchOracle(`${label} sync ${syncFrames}`);
    }
    if (synchronized.input !== inputCases[0]) fail(`script de entrada não sincronizou em ${label}: ${JSON.stringify(synchronized)}`);
    let current = synchronized;
    for (let index = 0; index < 6; index += 1) {
      if (index > 0) {
        let attempts = 0;
        while (current.input !== inputCases[index] && attempts < inputCases.length * 2) {
          const ran = await invoke("emulator_run_frames", { frames: 1 });
          if (!ran?.ok || !ran.value?.ok) fail(`frame controlado ${index} falhou em ${label}.`);
          attempts += 1;
          current = await readBranchOracle(`${label} frame ${index} sync ${attempts}`);
        }
      }
      const observed = await invoke("emulator_observe");
      const expectedInput = inputCases[index];
      const oracle = current;
      const expectedResult = oracleResult(oracle.input, threshold);
      if (!observed?.ok || !observed.value?.ok || oracle.input !== expectedInput || oracle.result !== expectedResult) fail(`oracle independente branch divergiu em ${label}/${index}: ${JSON.stringify({ oracle, expectedInput, expectedResult, observed: observed?.value })}`);
      samples.push({ frame: index + 1, input: oracle.input, expectedResult, oracle, romSha256: observed.value.rom_sha256, framebufferSha256: observed.value.framebuffer_sha256, framesRun: observed.value.frames_run });
    }
    const state = await readAutomationState(sessionId);
    if (state?.emulPaused !== true || samples.length !== 6 || samples[5].framesRun < beforeFrames) fail(`${label} não preservou execução pausada/lote de 6 estados.`);
    return { label, threshold, inputScript: samples.map((sample) => sample.input), warmupOracle, syncFrames, samples, romSha256: samples[0].romSha256, framebufferSha256: samples[0].framebufferSha256, inputAck: ack.value, controlledFrames: 6 };
  };

  const generatedOriginalObservation = await observeBranchRom(originalBuild.romPath, "ROM gerada pelo grafo (threshold 5)", 5);
  const nodeObservation = await observeBranchRom(nodeRomPath, "ROM Node fixture (threshold 5)", 5);
  const originalObservationA = await observeBranchRom(routineRomPath, "ROM original A (threshold 5)", 5);
  const originalObservationB = await observeBranchRom(routineRomPath, "ROM original B (threshold 5)", 5);
  const noOpObservation = await observeBranchRom(noOpPath, "ROM no-op threshold 5", 5);
  const commonInputScript = JSON.stringify(originalObservationA.inputScript);
  for (const observation of [generatedOriginalObservation, nodeObservation, originalObservationB, noOpObservation]) {
    if (JSON.stringify(observation.inputScript) !== commonInputScript || JSON.stringify(observation.samples.map((sample) => sample.oracle.result)) !== JSON.stringify(originalObservationA.samples.map((sample) => sample.oracle.result))) fail("equivalência original/node/no-op/original não foi comprovada com entrada e estado controlados.");
  }
  if (JSON.stringify(originalObservationA.samples.map((sample) => sample.oracle)) !== JSON.stringify(originalObservationB.samples.map((sample) => sample.oracle)) || JSON.stringify(noOpObservation.samples.map((sample) => sample.oracle)) !== JSON.stringify(originalObservationA.samples.map((sample) => sample.oracle))) fail("execuções repetidas da ROM original/no-op não foram determinísticas.");
  report.steps.push({ step: "common_input_controlled_execution_original_and_graph", status: "passed", expected: [0,1,1,0,0,1], nodeObservation, generatedOriginalObservation, originalObservationA, originalObservationB, noOpObservation, proof: "cada ROM executou o mesmo script [3,4,5,0,0xFFFF,0x1234] após 120 frames de warmup e o oráculo independente leu resultado/input da WRAM" });

  await callAutomationApi(sessionId, "selectWorkspace", ["scene"]);
  await callAutomationApi(sessionId, "setSelectedEntityId", ["camera_root"]);
  await clickButtonByTextWithPointerEvents(sessionId, "Logic");
  await waitFor(async () => { const state = await readAutomationState(sessionId); return state?.activeViewportTab === "logic" ? state : false; }, 15000, "NodeGraph branch não abriu após reabrir o projeto", 250);
  await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector('[data-testid^="node-param-"][data-testid$="-threshold"]'));`), 15000, "editor branch não exibiu o parâmetro threshold", 250);
  const edited = await executeScript(sessionId, `const input=document.querySelector('[data-testid$="-threshold"]'); if(!(input instanceof HTMLInputElement)) return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter?.call(input,"6"); input.dispatchEvent(new Event("input",{bubbles:true})); input.dispatchEvent(new Event("change",{bubbles:true})); return input.value;`);
  if (edited !== "6") fail(`editor não alterou threshold: ${edited}`);
  await waitFor(async () => { const state = await callAutomationApi(sessionId, "getEntityLogicState", ["camera_root"]); try { const graph = JSON.parse(state?.source?.graph_json ?? "{}"); return graph.nodes?.some((node) => node.type === "rom_branch_compare_word" && node.params?.threshold === 6) ? state : false; } catch { return false; } }, 15000, "alteração do parâmetro não foi autosalva", 250);
  await callAutomationApi(sessionId, "closeProject");
  await callAutomationApi(sessionId, "openProject", [projectDir]);
  const editedReopened = await waitFor(async () => { const state = await callAutomationApi(sessionId, "getEntityLogicState", ["camera_root"]); try { const graph = JSON.parse(state?.source?.graph_json ?? "{}"); return graph.nodes?.some((node) => node.type === "rom_branch_compare_word" && node.params?.threshold === 6) ? state : false; } catch { return false; } }, 30000, "threshold editado não foi relido", 250);
  const editedBuild = await buildProject("Build branch threshold 6");
  if (!editedBuild.generatedMain.includes("(s16)6") && !editedBuild.generatedMain.includes(">= (s16)6")) fail("C gerado após edição não comprova threshold 6.");
  report.steps.push({ step: "editor_parameter_edit_and_reopen", status: "passed", parameter: "threshold", before: 5, after: 6, reopenedGraphOrigin: editedReopened.source.graph_origin, generatedMainPath: editedBuild.generatedMainPath, generatedMainSha256: createHash("sha256").update(editedBuild.generatedMain).digest("hex") });

  const patchResult = await invoke("rom_patch_recovered_logic", { romPath: routineRomPath, outputPath: patchedPath, expectedSha256: report.fixture.routineRomSha256, offset, immediate: 6 });
  if (!patchResult?.ok || !patchResult.value?.output_path) fail(`patch branch #6 falhou: ${JSON.stringify(patchResult)}`);
  await waitFor(async () => pathExists(patchedPath), 15000, "cópia branch patchada não foi criada", 100);
  const patchedBytes = await readFile(patchedPath);
  if (patchedBytes.length !== routineBytes.length || !patchedBytes.subarray(0, offset).equals(routineBytes.subarray(0, offset)) || !patchedBytes.subarray(offset + routineSignature.length).equals(routineBytes.subarray(offset + routineSignature.length)) || patchedBytes[offset + 7] !== 6) fail("patch branch #6 alterou bytes fora do parâmetro threshold.");
  const generatedEditedObservation = await observeBranchRom(editedBuild.romPath, "ROM gerada pelo grafo (threshold 6)", 6);
  const patchedObservation = await observeBranchRom(patchedPath, "ROM cópia patchada (threshold 6)", 6);
  if (JSON.stringify(generatedEditedObservation.samples.map((sample) => sample.oracle)) !== JSON.stringify(patchedObservation.samples.map((sample) => sample.oracle)) || generatedEditedObservation.samples[1].oracle.result !== 0 || patchedObservation.samples[1].oracle.result !== 0 || originalObservationA.samples[1].oracle.result !== 1) fail("efeito do parâmetro 5→6 não foi comprovado nas ROMs gerada e patchada.");
  report.steps.push({ step: "edited_generated_and_patched_rom_observation", status: "passed", parameter: { original: 5, edited: 6 }, expectedOriginalResults: [0,1,1,0,0,1], expectedEditedResults: [0,0,1,0,0,1], generatedEditedObservation, patchedObservation, roms: { generatedEdited: { path: editedBuild.romPath, origin: "generated_from_edited_reopened_nodegraph", sha256: generatedEditedObservation.romSha256 }, patched: { path: patchedPath, origin: "copy_of_original_with_threshold_byte_edited", sha256: patchedObservation.romSha256 } }, observation: "WRAM result/input pairs for the same six-frame script; threshold boundary input 4 changes 1→0" });
  report.finishedAt = new Date().toISOString();
  await ensureValidationDir();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[logic-recovery-branch] relatório=${reportPath}`);
  console.log("OK: Desktop Tauri branch logic-recovery E2E passou com mapping, dois ramos, fronteiras, edição, patch e oráculo.");
}

async function clickButtonByTextWithPointerEvents(sessionId, expectedText) {
  const result = await executeScript(
    sessionId,
    `const expected = String(arguments[0]); const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.replace(/\\s+/g, " ").trim().includes(expected)); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.scrollIntoView({ block: "center", inline: "center" }); button.focus(); for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); return true;`,
    [expectedText]
  );
  if (!result) fail(`Botao nao encontrado para eventos: '${expectedText}'.`);
}

async function clickButtonByTextAtCoordinates(sessionId, expectedText) {
  const rect = await executeScript(
    sessionId,
    `const expected = String(arguments[0]); const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.replace(/\\s+/g, " ").trim().includes(expected)); if (!(button instanceof HTMLButtonElement) || button.disabled) return null; button.scrollIntoView({ block: "center", inline: "center" }); const rect = button.getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };`,
    [expectedText]
  );
  if (!rect) fail(`Botao nao encontrado para clique coordenado: '${expectedText}'.`);
  await webdriverRequest("POST", `/session/${sessionId}/actions`, {
    actions: [{
      type: "pointer",
      id: "rds-inspection-mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", origin: "viewport", x: rect.x, y: rect.y },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    }],
  });
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
    `1) Feche instancias manuais de ${appBinaryNameForPlatform()} antes de rodar o E2E.`,
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

/**
 * Le do console do app a linha de identidade da toolchain que o build emite
 * ("Toolchain localizada: <root> (make: <programa>)").
 *
 * Existe para tornar runs verdes e vermelhos comparaveis. O `consoleTail` so e
 * despejado em falha, entao ate aqui nao havia como saber qual `make` os runs
 * saudaveis usaram -- o que impedia avaliar se a preferencia por `mingw32-make`
 * nativo (PR #51) tem relacao com a falha intermitente da receita `nm`
 * (issue #53). Sem isso a hipotese fica sem dado, nao sem interesse.
 *
 * Diagnostico puro: nunca falha o cenario.
 */
async function reportToolchainIdentity(sessionId) {
  try {
    const line = await executeScript(
      sessionId,
      `
        const state = window.__RDS_E2E__?.getState?.() ?? null;
        const entries = Array.isArray(state?.consoleEntries) ? state.consoleEntries : [];
        const match = entries
          .map((entry) => entry?.message ?? '')
          .reverse()
          .find((message) => message.includes('Toolchain localizada:'));
        return match ?? '';
      `
    );
    console.log(
      line ? `Toolchain do run: ${line}` : "Toolchain do run: (linha nao encontrada no console)"
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`Toolchain do run: (indisponivel: ${detail})`);
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
  if (typeof fetch !== "function") {
    fail("Este script requer Node.js com suporte a fetch global.");
  }

  // Aplica o ambiente gerenciado cedo (o preflight abaixo ja se beneficia dele),
  // mas a assercao fica depois de `projectMetadata`, quando o target e conhecido
  // e da para exigir so o que o cenario usa.
  const hostReadiness = applyManagedHostEnvironment();
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
  await clearDesktopFailureReport(options.scenario);
  const driverStartupTimeoutMs = parsePositiveInteger(
    process.env.RDS_E2E_DRIVER_TIMEOUT_MS,
    // QA RC faz build pesado antes do driver; em hosts lentos 30s falha com portas ocupadas.
    options.scenario === "qa-rc" || options.scenario === "create-game-from-zero" || options.scenario === "reference-platformer" || options.scenario === "authoring-acceptance" || options.scenario === "nodegraph-authoring" || options.scenario === "behaviors-independence" || options.scenario === "collect-goal" ? 120000 : 30000
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
    options.scenario !== "create-game-from-zero" &&
    options.scenario !== "reference-platformer" &&
    options.scenario !== "authoring-acceptance" &&
    options.scenario !== "nodegraph-authoring" &&
    options.scenario !== "behaviors-independence" &&
    options.scenario !== "collect-goal";
  let temporaryProjectDir = "";
  let temporaryInspectionFixtureDir = "";
  if (requiresExistingProject) {
    await assertPathExists(
      options.project,
      `Projeto de fixture nao encontrado: ${options.project}`
    );
  }
  const projectMetadata = requiresExistingProject
    ? await readProjectMetadata(options.project)
    : { name: "", target: "" };

  const requiredHostIds = hostRequirementsForRun({ target: projectMetadata.target });
  const hostBlockers = scopedHostBlockers(hostReadiness, requiredHostIds);
  if (hostBlockers.length > 0) {
    fail(
      `Host E2E nao atende os requisitos do cenario '${options.scenario}'` +
        `${projectMetadata.target ? ` (target ${projectMetadata.target})` : ""}: ` +
        `${hostBlockers.join(", ")}. Requisitos exigidos: ${requiredHostIds.join(", ")}. ` +
        `Relatorio completo do contrato de host: ${path.join(validationDir, "desktop-e2e-host-readiness.json")}.`
    );
  }

  await clearDesktopSuccessReport(options, projectMetadata);
  currentE2eRunContext = {
    scenario: options.scenario,
    project: options.project,
    projectName: projectMetadata.name || null,
    projectTarget: projectMetadata.target || null,
    app: options.app,
    appPath: options.app,
    externalDriver: options.externalDriver,
    sessionId: null,
  };
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

    nativeDriverPath = await resolveExecutable(options.nativeDriver, webdriverNamesForPlatform());
    if (!nativeDriverPath) {
      fail(
        process.platform === "win32"
          ? [
              "msedgedriver nao encontrado.",
              "Instale um driver compativel com o Edge do sistema, por exemplo com o utilitario oficial:",
              "cargo install --git https://github.com/chippers/msedgedriver-tool",
            ].join(" ")
          : [
              "WebDriver nativo nao encontrado.",
              "Configure msedgedriver ou chromedriver no PATH, em toolchains/webdriver/, ou passe --native-driver.",
              "Em Linux tambem pode ser necessario iniciar uma sessao grafica/Xvfb antes do runner.",
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
    // Scenarios expect the default shell; a persona left in localStorage (e.g. by the
    // guided acceptance run) would hide workspaces. Reset it and reload once.
    if (options.scenario !== "authoring-acceptance" && options.scenario !== "nodegraph-authoring" && options.scenario !== "behaviors-independence" && options.scenario !== "collect-goal") {
      const persisted = await executeScript(sessionId, "return localStorage.getItem(arguments[0]);", [SHELL_PERSONA_STORAGE_KEY]).catch(() => null);
      if (persisted) {
        await executeScript(sessionId, "localStorage.removeItem(arguments[0]); location.reload();", [SHELL_PERSONA_STORAGE_KEY]).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "Janela do app nao voltou apos resetar o modo do shell");
      }
    }

    await waitFor(
      async () =>
        executeScript(
          sessionId,
          "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"
        ),
      uiBootstrapTimeoutMs,
      "API de automacao do app nao ficou disponivel"
    );

    if (requiresExistingProject) {
      const sourceProject = options.project;
      temporaryProjectDir = await mkdtemp(path.join(os.tmpdir(), "rds-desktop-e2e-project-"));
      options.project = path.join(temporaryProjectDir, path.basename(sourceProject));
      await cp(sourceProject, options.project, { recursive: true });
      currentE2eRunContext.project = options.project;
    }

    if (options.scenario === "logic-recovery") {
      currentE2eRunContext.appPath = options.app;
      await runLogicRecoveryScenario(sessionId, options.project);
      return;
    }
    if (options.scenario === "logic-recovery-branch") {
      currentE2eRunContext.appPath = options.app;
      await runBranchLogicRecoveryScenario(sessionId, options.project);
      return;
    }

    if (options.scenario === "rex-lz4w-effect") {
      currentE2eRunContext.appPath = options.app;
      await runRexLz4wEffectScenario(sessionId);
      return;
    }

    const sonicTilesMode = options.scenario === "inspection-sonic-tiles";
    if (sonicTilesMode) options.scenario = "inspection-sonic";
    if (["inspection", "inspection-cancel", "inspection-complete", "inspection-sprite-secondary", "inspection-sonic", "inspection-preview-unavailable"].includes(options.scenario)) {
      let inspectionRom = process.env.RDS_INSPECTION_ROM ?? "";
      let inspectionFixture = null;
      if (options.scenario === "inspection-preview-unavailable" && !process.env.RDS_INSPECTION_PREVIEW_UNAVAILABLE_ROM) {
        inspectionFixture = await createUnavailablePreviewFixture();
        temporaryInspectionFixtureDir = inspectionFixture.fixtureDir;
        inspectionRom = inspectionFixture.romPath;
      } else if (options.scenario === "inspection-preview-unavailable") {
        inspectionRom = process.env.RDS_INSPECTION_PREVIEW_UNAVAILABLE_ROM;
      }
      if (!inspectionRom || !(await pathExists(inspectionRom))) {
        fail(
          options.scenario === "inspection-preview-unavailable"
            ? "RDS_INSPECTION_PREVIEW_UNAVAILABLE_ROM deve apontar para um fixture BYOR controlado existente."
            : "RDS_INSPECTION_ROM deve apontar para uma ROM BYOR real existente; nenhuma ROM e criada pelo E2E."
        );
      }
      const inspectionRomBytes = await readFile(inspectionRom);
      console.log(`[inspection-rom] ${JSON.stringify({ path: inspectionRom, size: inspectionRomBytes.length, sha256: createHash("sha256").update(inspectionRomBytes).digest("hex"), fixture: inspectionFixture })}`);
      const spriteResourceId = process.env.RDS_INSPECTION_SPRITE_RESOURCE_ID ?? (options.scenario === "inspection-sonic" ? "sonic1_sonic" : "spr_ryo_100");
      const spriteSourcePng = process.env.RDS_INSPECTION_SPRITE_SOURCE_PNG ?? (spriteResourceId === "spr_spark0"
        ? "/mnt/sdcard/Projects/Sgdk Forge/SGDK_projects/TAIKETSU ULTRA HERO GENESIS [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]/res/sprite/spr_spark0.png"
        : "/mnt/sdcard/Projects/Sgdk Forge/SGDK_projects/HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]/res/sprite/ryo/100.png");
      const requiresSpriteOracle = (options.scenario === "inspection" || options.scenario === "inspection-complete" || options.scenario === "inspection-sprite-secondary") && options.scenario !== "inspection-sonic";
      if (requiresSpriteOracle && !(await pathExists(spriteSourcePng))) {
        fail(`RDS_INSPECTION_SPRITE_SOURCE_PNG deve apontar para o PNG doador independente: ${spriteSourcePng}`);
      }
      const spriteSourcePngSha256 = !requiresSpriteOracle
        ? null
        : createHash("sha256").update(await readFile(spriteSourcePng)).digest("hex");
      const expectedSourceSha256 = process.env.RDS_INSPECTION_SPRITE_RESOURCE_ID === "spr_spark0"
        ? "cafaf180ba006903242aa822fb3c0dceb42424a9e0bd07a5a19b75f33a4bf196"
        : "1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b";
      if (requiresSpriteOracle && spriteSourcePngSha256 !== expectedSourceSha256) {
        fail(`PNG doador independente divergente: ${JSON.stringify({ path: spriteSourcePng, sha256: spriteSourcePngSha256 })}`);
      }
      console.log(`[inspection-sprite-source] ${JSON.stringify({ path: spriteSourcePng, resource: spriteResourceId, sha256: spriteSourcePngSha256, frame: `${spriteResourceId}/frame-0` })}`);
      const artifactPrefix = `inspection-${artifactTimestamp()}`;
      const inspectionPanel = "[data-testid='reverse-inspection-panel']";
      const inspectionInput = `${inspectionPanel} input[type='text']`;
      const gitEvidence = await readGitEvidence();
      const binarySha256 = createHash("sha256").update(await readFile(options.app)).digest("hex");
      const frontendEvidence = await executeScript(sessionId, `return { buildCommit: window.__RDS_BUILD_COMMIT__ ?? null, scripts: Array.from(document.scripts).map((script) => script.src || script.textContent?.slice(0, 80) || "") };`);
      console.log(`[inspection-build] binary=${JSON.stringify({ path: options.app, sha256: binarySha256 })}`);
      console.log(`[inspection-build] frontend=${JSON.stringify(frontendEvidence)} git=${JSON.stringify(gitEvidence)}`);
      if (!gitEvidence.commit || frontendEvidence?.buildCommit !== gitEvidence.commit) {
        fail(`Binário/frontend não correspondem ao commit corrente: ${JSON.stringify({ binary: options.app, frontend: frontendEvidence, git: gitEvidence })}`);
      }
      try {
        await setSessionWindowRect(sessionId, 1280, 800);
      } catch (error) {
        console.warn(`[inspection] janela não aceitou 1280x800; seguindo somente se o hit-test validar o controle: ${error instanceof Error ? error.message : String(error)}`);
      }
      await handleProjectWizardVisibly(sessionId, "initial");
      await closeVisibleConsoleDrawer(sessionId);
      await clickByTestId(sessionId, "workspace-rail-debug");
      await waitForBodyText(sessionId, "Debug Workspace", 15000, "Debug Workspace nao abriu");
      await callAutomationApi(sessionId, "openToolsWorkspace", ["reverse", "debug", true]);
      try {
        await waitForBodyText(sessionId, "Analisar ROM", 15000, "Reverse Workspace nao terminou de montar");
      } catch (error) {
        console.log(`[inspection] estado apos abrir reverse: ${JSON.stringify(await readAutomationState(sessionId))}`);
        console.log(`[inspection] botoes apos abrir reverse: ${JSON.stringify(await executeScript(sessionId, `return Array.from(document.querySelectorAll("button")).map((button) => button.textContent?.replace(/\\s+/g, " ").trim()).filter(Boolean).slice(-20);`))}`);
        throw error;
      }
      await clickButtonByTestIdWithPointerEvents(sessionId, "reverse-tab-inspection");
      await waitFor(
        async () => executeScript(sessionId, `return Boolean(document.querySelector(${JSON.stringify(inspectionPanel)}));`),
        15000,
        "Painel de inspeção visual nao abriu",
        250
      );
      await fillInputBySelector(sessionId, inspectionInput, inspectionRom);
      const inputState = await readInspectionUiState(sessionId);
      console.log(`[inspection-identify] input=${JSON.stringify(inputState)}`);
      const identifySelector = "[data-testid='inspection-identify']";
      const identifyElement = await findElement(sessionId, identifySelector);
      await clickElementWithDiagnostics(sessionId, identifyElement, identifySelector);
      let identifiedState;
      try {
        identifiedState = await waitFor(
          async () => {
            const state = await readInspectionUiState(sessionId);
            return state?.identify?.state === "succeeded" && state.session?.id ? state : false;
          },
          30000,
          "handler React/IPC de identificação não produziu estado de sessão",
          100
        );
      } catch (error) {
        const state = await readInspectionUiState(sessionId);
        const automation = await readAutomationState(sessionId);
        console.log(`[inspection-identify] final-ui=${JSON.stringify(state)}`);
        console.log(`[inspection-identify] console=${JSON.stringify(automation?.consoleEntries?.filter((entry) => String(entry?.message ?? "").includes("[Inspeção]")) ?? [])}`);
        throw error;
      }
      const identifyAutomation = await readAutomationState(sessionId);
      console.log(`[inspection-identify] success=${JSON.stringify(identifiedState)}`);
      console.log(`[inspection-identify] ipc-log=${JSON.stringify(identifyAutomation?.consoleEntries?.filter((entry) => String(entry?.message ?? "").includes("[Inspeção]")) ?? [])}`);

      const startAvailable = await executeScript(
        sessionId,
        `return Boolean(document.querySelector("[data-testid='inspection-start']"));`
      );
      if (!startAvailable) {
        fail(`Identificação terminou sem o controle de análise: ${JSON.stringify(await readInspectionUiState(sessionId))}`);
      }
      await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-start");

      if (options.scenario === "inspection-cancel") {
        await waitFor(
          async () => {
            const state = await readInspectionUiState(sessionId);
            return state?.run?.status === "running" ? state : false;
          },
          10000,
          "Cancelamento não foi testado: a UI não exibiu um run em andamento",
          100
        );
        await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-cancel");
        const cancelledState = await waitFor(
          async () => {
            const state = await readInspectionUiState(sessionId);
            return state?.run?.status === "cancelled" && state.session?.status === "cancelled" ? state : false;
          },
          30000,
          "Cancelamento não chegou ao estado terminal cancelled",
          100
        );
        console.log(`[inspection-cancel] OK: estado terminal ${JSON.stringify(cancelledState)}`);
        console.log("OK: Desktop Tauri inspection/cancel E2E passou com cancelamento comprovado.");
        return;
      }

      const completedState = await waitFor(
        async () => {
          const state = await readInspectionUiState(sessionId);
          return state?.run?.status === "completed" && state.session?.status === "completed" ? state : false;
        },
        120000,
        "Descoberta visual não chegou ao estado terminal completed",
        250
      );
      console.log(`[inspection-complete] terminal=${JSON.stringify(completedState)}`);
      const beforeRestartScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-before-restart.png`);
      if (options.scenario === "inspection-sonic") {
        const baseSha256 = createHash("sha256").update(inspectionRomBytes).digest("hex");
        const expectedBaseSha256 = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
        if (baseSha256 !== expectedBaseSha256 || spriteResourceId !== "sonic1_sonic") {
          fail(`Cenário Sonic exige a ROM BYOR e o recurso verificados: ${JSON.stringify({ baseSha256, spriteResourceId })}`);
        }
        const frameId = "sonic1_sonic/stand";
        await selectInspectionFrameNative(sessionId, frameId);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "composição do Sonic stand antes da edição");
        const baseProof = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, frameId, "Sonic stand antes da edição");
        const baseScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sonic-stand-base.png`);

        const modifiedRomBytes = Buffer.from(inspectionRomBytes);
        // Tile mode: independent oracle of the reinsertion, decoded here from the ROM's
        // stand mapping (0x21293) and raw art (0x21AFE), not from product code.
        const tileRect = { x: 10, y: 14, w: 12, h: 8, index: 14 };
        const editWord = (7 << 1) | (0 << 5) | (7 << 9);
        const sonicStandByteFor = (x, y) => {
          const mapping = inspectionRomBytes.subarray(0x21293, 0x21293 + 21);
          for (let piece = 0; piece < mapping[0]; piece += 1) {
            const d = mapping.subarray(1 + piece * 5, 6 + piece * 5);
            const w = ((d[1] >> 2) & 3) + 1;
            const h = (d[1] & 3) + 1;
            const left = 16 + ((d[4] << 24) >> 24);
            const top = 20 + ((d[0] << 24) >> 24);
            const lx = x - left;
            const ly = y - top;
            if (lx < 0 || ly < 0 || lx >= w * 8 || ly >= h * 8) continue;
            const tile = d[2] * 256 + d[3] + Math.floor(ly / 8) * w + Math.floor(lx / 8);
            return { tile, offset: 0x21afe + tile * 32 + (ly % 8) * 4 + Math.floor((lx % 8) / 2), high: (lx % 8) % 2 === 0 };
          }
          return null;
        };
        if (sonicTilesMode) {
          for (let y = tileRect.y; y < tileRect.y + tileRect.h; y += 1) {
            for (let x = tileRect.x; x < tileRect.x + tileRect.w; x += 1) {
              const at = sonicStandByteFor(x, y);
              if (!at) fail(`Retangulo de teste fora do mapping: ${x},${y}`);
              const byte = modifiedRomBytes[at.offset];
              modifiedRomBytes[at.offset] = at.high ? (byte & 0x0f) | (tileRect.index << 4) : (byte & 0xf0) | tileRect.index;
            }
          }
        } else {
          modifiedRomBytes.writeUInt16BE(editWord, 0x2388 + 2);
        }
        const modifiedSha256 = createHash("sha256").update(modifiedRomBytes).digest("hex");
        await closeVisibleConsoleDrawer(sessionId, "antes da edição Sonic");
        const tileEditErrors = async () => ((await readAutomationState(sessionId))?.consoleEntries ?? [])
          .map((entry) => String(entry?.message ?? ""))
          .filter((message) => message.includes("Reinserção recusada"));
        const setTileRect = async (rect) => {
          for (const key of ["x", "y", "w", "h"]) await setInputByTestIdNative(sessionId, `inspection-sonic-tile-${key}`, String(rect[key]));
          await setInputByTestIdNative(sessionId, "inspection-sonic-tile-index", String(rect.index));
        };
        const tileNegatives = [];
        let sonicTileEvidence = null;
        if (sonicTilesMode) {
          for (const negative of [
            { label: "pixel fora do mapping", rect: { x: 28, y: 2, w: 2, h: 2, index: 14 }, expect: "nao pertence a nenhuma peca" },
            { label: "tiles compartilhados sem confirmacao", rect: { x: 10, y: 25, w: 4, h: 2, index: 14 }, expect: "frames DPLC [5]" },
          ]) {
            const before = (await tileEditErrors()).length;
            await closeVisibleConsoleDrawer(sessionId, `antes do negativo ${negative.label}`);
            await setTileRect(negative.rect);
            await clickButtonByTestIdNative(sessionId, "inspection-sonic-tile-edit-apply", `negativo: ${negative.label}`);
            const errors = await waitFor(async () => { const list = await tileEditErrors(); return list.length > before ? list : false; }, 10000, `Negativo nao foi recusado: ${negative.label}`, 100).catch(async (error) => {
              const ui = await executeScript(sessionId, `
                const q = (id) => document.querySelector('[data-testid="' + id + '"]');
                const button = q("inspection-sonic-tile-edit-apply");
                return { panel: Boolean(q("inspection-sonic-tile-edit")), disabled: button?.disabled ?? null, text: button?.textContent ?? null,
                  values: ["x","y","w","h","index"].map((k) => q("inspection-sonic-tile-" + k)?.value ?? null) };
              `);
              const last = ((await readAutomationState(sessionId))?.consoleEntries ?? []).slice(-5);
              await captureScreenshot(sessionId, `${artifactPrefix}-sonic-tile-negative-failure.png`).catch(() => null);
              fail(`${error.message} ui=${JSON.stringify(ui)} console=${JSON.stringify(last)}`);
            });
            const message = errors.at(-1);
            const resultText = await executeScript(sessionId, `return document.querySelector('[data-testid="inspection-sonic-edit-result"]')?.textContent ?? '';`);
            if (!message.includes(negative.expect) || resultText) fail(`Negativo ${negative.label} nao produziu recusa esperada sem edicao: ${JSON.stringify({ message, resultText })}`);
            tileNegatives.push({ label: negative.label, message });
          }
          await closeVisibleConsoleDrawer(sessionId, "antes da reinsercao");
          await setTileRect(tileRect);
          await clickButtonByTestIdNative(sessionId, "inspection-sonic-tile-edit-apply", "reinserir tiles do Sonic pela interface");
        } else {
          await fillInputByLabel(sessionId, "Índice", "1");
          await fillInputByLabel(sessionId, "R", "7");
          await fillInputByLabel(sessionId, "G", "0");
          await fillInputByLabel(sessionId, "B", "7");
          await clickElementWithNativePointer(sessionId, "[data-testid='inspection-sonic-edit']", "editar a paleta Sonic pela interface");
        }
        let editEvidence;
        try {
          editEvidence = await waitFor(
            async () => executeScript(sessionId, `return document.querySelector('[data-testid="inspection-sonic-edit-result"]')?.textContent ?? '';`),
            15000,
            "Edição Sonic não produziu o resultado persistido pela UI",
            100
          );
        } catch (error) {
          const editButton = await inspectNativeButtonTarget(sessionId, "inspection-sonic-edit");
          const automation = await readAutomationState(sessionId);
          console.log(`[inspection-sonic-edit-failure] ${JSON.stringify({ editButton, ui: await readInspectionUiState(sessionId), console: automation?.consoleEntries?.filter((entry) => String(entry?.message ?? "").includes("[Inspeção]")) ?? [] })}`);
          throw error;
        }
        const tileEvidence = sonicTilesMode ? await executeScript(sessionId, `return document.querySelector('[data-testid="inspection-sonic-tile-edit-result"]')?.textContent ?? '';`) : "";
        if (sonicTilesMode && (!String(editEvidence).includes(modifiedSha256) || !String(tileEvidence).includes("compartilhados com frames DPLC: nenhum") || !String(tileEvidence).includes(baseSha256))) {
          fail(`Reinsercao de tiles nao corresponde a mutacao independente: ${JSON.stringify({ editEvidence, tileEvidence, modifiedSha256 })}`);
        }
        if (!sonicTilesMode && (!String(editEvidence).includes(modifiedSha256) || !String(editEvidence).includes("0x00238A"))) {
          fail(`Resultado da edição Sonic não corresponde à mutação independente: ${JSON.stringify({ editEvidence, modifiedSha256 })}`);
        }
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "recomposição do Sonic stand após edição");
        const editedProof = await verifyRenderedSpriteFrame(sessionId, modifiedRomBytes, frameId, "Sonic stand após edição");
        const editedScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sonic-stand-edited.png`);

        await ensureValidationDir();
        const pilotDir = path.join(validationDir, `sonic1-pilot-${artifactTimestamp()}`);
        await mkdir(pilotDir, { recursive: true });
        const patchPath = path.join(pilotDir, sonicTilesMode ? "sonic1-stand-tiles.bps" : "sonic1-stand-palette.bps");
        const patchedRomPath = path.join(pilotDir, sonicTilesMode ? "sonic1-stand-tiles-applied.bin" : "sonic1-stand-palette-applied.bin");
        await fillInputByLabel(sessionId, "Exportar patch BPS", patchPath);
        await clickButtonByTestIdNative(sessionId, "inspection-sonic-export-patch", "exportar patch Sonic pela interface");
        await waitFor(async () => pathExists(patchPath), 15000, "Patch BPS Sonic não foi criado pela UI", 100);
        const patchBytes = await readFile(patchPath);
        const patchSha256 = createHash("sha256").update(patchBytes).digest("hex");
        await fillInputByLabel(sessionId, "Salvar ROM modificada aplicada", patchedRomPath);
        await clickButtonByTestIdNative(sessionId, "inspection-sonic-apply-patch", "aplicar patch Sonic pela interface");
        await waitFor(async () => pathExists(patchedRomPath), 15000, "ROM aplicada não foi criada pela UI", 100);
        const patchedRomBytes = await readFile(patchedRomPath);
        const patchedSha256 = createHash("sha256").update(patchedRomBytes).digest("hex");
        if (patchedSha256 !== modifiedSha256 || baseSha256 !== createHash("sha256").update(inspectionRomBytes).digest("hex") || !patchedRomBytes.equals(modifiedRomBytes)) {
          fail(`Aplicação BPS não reproduziu exatamente a ROM editada: ${JSON.stringify({ baseSha256, modifiedSha256, patchedSha256 })}`);
        }
        const expectedGameplayFrames = 1200;
        const assertEmulatorObservation = async (label, expectedRomSha256) => {
          let lastObservation = null;
          let observation;
          try {
            observation = await waitFor(
              async () => {
                const current = await readInspectionEmulatorObservation(sessionId);
                lastObservation = current;
                return current &&
                  current.label === label &&
                  current.romSha256 === expectedRomSha256 &&
                  current.framesRun >= expectedGameplayFrames &&
                  current.framesRequested >= expectedGameplayFrames &&
                  current.inputProfile === "sonic-boot-start" &&
                  current.inputStartFrame === 900 &&
                  current.coreLabel &&
                  current.corePath &&
                  current.framebufferWidth > 0 &&
                  current.framebufferHeight > 0 &&
                  current.framebufferSha256.length === 64 &&
                  current.canvasWidth === current.framebufferWidth &&
                  current.canvasHeight === current.framebufferHeight &&
                  current.canvasRgbaBytes === current.framebufferWidth * current.framebufferHeight * 4
                  ? current
                  : false;
              },
              30000,
              "A observação real da " + label + " não comprovou ROM, core, frames e framebuffer",
              100
            );
          } catch (error) {
            console.error(`[inspection-emulator-observation] timeout ${label} ` + JSON.stringify({ expectedRomSha256, lastObservation, error: String(error) }));
            throw error;
          }
          const withPixels = await readInspectionEmulatorObservation(sessionId, { includePixels: true });
          if (!withPixels?.canvasRgba || withPixels.canvasRgba.length !== withPixels.canvasWidth * withPixels.canvasHeight * 4) {
            fail(`Framebuffer do canvas não pôde ser relido integralmente para ${label}: ${JSON.stringify(withPixels)}`);
          }
          const pixels = Buffer.from(withPixels.canvasRgba);
          const width = withPixels.canvasWidth;
          const height = withPixels.canvasHeight;
          const gameplayRoi = { x0: 0, y0: Math.floor(height * 0.55), x1: Math.min(width, 128), y1: height };
          let roiNonBlackPixels = 0;
          let roiMagentaPixels = 0;
          let magentaPixels = 0;
          let roiMagentaLikePixels = 0;
          let magentaLikePixels = 0;
          const colorCounts = new Map();
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const offset = (y * width + x) * 4;
              const r = pixels[offset];
              const g = pixels[offset + 1];
              const b = pixels[offset + 2];
              const nonBlack = r !== 0 || g !== 0 || b !== 0;
              const magenta = r === 255 && g === 0 && b === 255;
              const magentaLike = r >= 224 && g <= 32 && b >= 224;
              const colorKey = `${r},${g},${b}`;
              colorCounts.set(colorKey, (colorCounts.get(colorKey) ?? 0) + 1);
              if (nonBlack && x >= gameplayRoi.x0 && x < gameplayRoi.x1 && y >= gameplayRoi.y0 && y < gameplayRoi.y1) roiNonBlackPixels += 1;
              if (magenta) magentaPixels += 1;
              if (magenta && x >= gameplayRoi.x0 && x < gameplayRoi.x1 && y >= gameplayRoi.y0 && y < gameplayRoi.y1) roiMagentaPixels += 1;
              if (magentaLike) magentaLikePixels += 1;
              if (magentaLike && x >= gameplayRoi.x0 && x < gameplayRoi.x1 && y >= gameplayRoi.y0 && y < gameplayRoi.y1) roiMagentaLikePixels += 1;
            }
          }
          if (withPixels.canvasNonBlackPixels < 1000 || roiNonBlackPixels < 1000) {
            fail(`A cena Sonic não ficou reconhecível no framebuffer de ${label}: ${JSON.stringify({ width, height, canvasNonBlackPixels: withPixels.canvasNonBlackPixels, roiNonBlackPixels, gameplayRoi })}`);
          }
          const topColors = Array.from(colorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
          console.log(`[inspection-emulator-observation] ` + JSON.stringify({ ...withPixels, canvasRgba: undefined, gameplayRoi, roiNonBlackPixels, magentaPixels, roiMagentaPixels, magentaLikePixels, roiMagentaLikePixels, topColors }));
          return { ...withPixels, gameplayRoi, roiNonBlackPixels, magentaPixels, roiMagentaPixels, magentaLikePixels, roiMagentaLikePixels, topColors };
        };

        await clickButtonByTestIdNative(sessionId, "inspection-sonic-run-base", "observar ROM Sonic base pela interface");
        const baseEmulatorObservation = await assertEmulatorObservation("ROM base", baseSha256);
        const baseEmulatorCanvas = await ensureEmulatorObservationVisible(sessionId);
        if (!baseEmulatorCanvas?.fullyVisible || !baseEmulatorCanvas.unobstructed) {
          fail(`Framebuffer da ROM base não ficou visível/desobstruído para captura: ${JSON.stringify(baseEmulatorCanvas)}`);
        }
        const baseEmulatorScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sonic-emulator-base.png`);

        await clickButtonByTestIdNative(sessionId, "inspection-sonic-run-patched", "observar ROM Sonic aplicada pela interface");
        const appliedEmulatorObservation = await assertEmulatorObservation("ROM aplicada", patchedSha256);
        const appliedEmulatorCanvas = await ensureEmulatorObservationVisible(sessionId);
        if (!appliedEmulatorCanvas?.fullyVisible || !appliedEmulatorCanvas.unobstructed) {
          fail(`Framebuffer da ROM aplicada não ficou visível/desobstruído para captura: ${JSON.stringify(appliedEmulatorCanvas)}`);
        }
        const emulatorScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sonic-emulator-applied.png`);
        if (sonicTilesMode) {
          const basePixels = Buffer.from(baseEmulatorObservation.canvasRgba);
          const appliedPixels = Buffer.from(appliedEmulatorObservation.canvasRgba);
          const width = baseEmulatorObservation.canvasWidth;
          const diffs = [];
          for (let offset = 0; offset < basePixels.length; offset += 4) {
            if (basePixels[offset] !== appliedPixels[offset] || basePixels[offset + 1] !== appliedPixels[offset + 1] || basePixels[offset + 2] !== appliedPixels[offset + 2]) {
              diffs.push({ x: (offset / 4) % width, y: Math.floor(offset / 4 / width) });
            }
          }
          const box = diffs.length ? { x0: Math.min(...diffs.map((d) => d.x)), x1: Math.max(...diffs.map((d) => d.x)), y0: Math.min(...diffs.map((d) => d.y)), y1: Math.max(...diffs.map((d) => d.y)) } : null;
          if (diffs.length < 20 || !box || box.x1 - box.x0 >= 32 || box.y1 - box.y0 >= 40) {
            fail(`Tiles reinseridos nao apareceram no jogo restritos ao sprite: ${JSON.stringify({ count: diffs.length, box })}`);
          }
          sonicTileEvidence = { negatives: tileNegatives, inGameDiffPixels: diffs.length, box, baseFramebuffer: baseEmulatorObservation.framebufferSha256, appliedFramebuffer: appliedEmulatorObservation.framebufferSha256, patchSha256, patchedSha256, baseSha256 };
          console.log(`[inspection-tile-effect] ${JSON.stringify(sonicTileEvidence)}`);
        }
        if (!sonicTilesMode && (baseEmulatorObservation.magentaLikePixels !== 0 || baseEmulatorObservation.roiMagentaLikePixels !== 0)) {
          fail(`A ROM base já contém a cor de paleta editada na cena Sonic: ${JSON.stringify({ magentaPixels: baseEmulatorObservation.magentaPixels, magentaLikePixels: baseEmulatorObservation.magentaLikePixels, roiMagentaLikePixels: baseEmulatorObservation.roiMagentaLikePixels, topColors: baseEmulatorObservation.topColors })}`);
        }
        if (!sonicTilesMode && (appliedEmulatorObservation.magentaLikePixels < 100 || appliedEmulatorObservation.roiMagentaLikePixels < 50)) {
          fail(`A ROM aplicada não mostrou a alteração de paleta no ROI do Sonic: ${JSON.stringify({ magentaPixels: appliedEmulatorObservation.magentaPixels, magentaLikePixels: appliedEmulatorObservation.magentaLikePixels, roiMagentaLikePixels: appliedEmulatorObservation.roiMagentaLikePixels, topColors: appliedEmulatorObservation.topColors })}`);
        }
        const framebufferDiverged = baseEmulatorObservation.framebufferSha256 !== appliedEmulatorObservation.framebufferSha256;
        const sameConditions = baseEmulatorObservation.framesRun === appliedEmulatorObservation.framesRun &&
          baseEmulatorObservation.framebufferWidth === appliedEmulatorObservation.framebufferWidth &&
          baseEmulatorObservation.framebufferHeight === appliedEmulatorObservation.framebufferHeight &&
          baseEmulatorObservation.coreLabel === appliedEmulatorObservation.coreLabel;
        if (!sameConditions || !framebufferDiverged) {
          fail(`A comparação base/aplicada não ocorreu sob condições equivalentes ou não divergiu: ${JSON.stringify({ sameConditions, framebufferDiverged, base: { framesRun: baseEmulatorObservation.framesRun, framebufferWidth: baseEmulatorObservation.framebufferWidth, framebufferHeight: baseEmulatorObservation.framebufferHeight, coreLabel: baseEmulatorObservation.coreLabel }, applied: { framesRun: appliedEmulatorObservation.framesRun, framebufferWidth: appliedEmulatorObservation.framebufferWidth, framebufferHeight: appliedEmulatorObservation.framebufferHeight, coreLabel: appliedEmulatorObservation.coreLabel } })}`);
        }
        console.log(`[inspection-palette-effect] ` + JSON.stringify({ status: "passed", oracle: "independent framebuffer ROI + expected RGB333 palette mutation", framebufferDiverged, sameConditions, base: { romSha256: baseEmulatorObservation.romSha256, framebufferSha256: baseEmulatorObservation.framebufferSha256, roiNonBlackPixels: baseEmulatorObservation.roiNonBlackPixels, magentaPixels: baseEmulatorObservation.magentaPixels, magentaLikePixels: baseEmulatorObservation.magentaLikePixels }, applied: { romSha256: appliedEmulatorObservation.romSha256, framebufferSha256: appliedEmulatorObservation.framebufferSha256, roiNonBlackPixels: appliedEmulatorObservation.roiNonBlackPixels, magentaPixels: appliedEmulatorObservation.magentaPixels, magentaLikePixels: appliedEmulatorObservation.magentaLikePixels, roiMagentaLikePixels: appliedEmulatorObservation.roiMagentaLikePixels }, baseCanvas: baseEmulatorCanvas, appliedCanvas: appliedEmulatorCanvas }));

        await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-save");
        const persistedSessionId = completedState.session.id;
        if (!persistedSessionId) fail(`Sessão Sonic concluída não tem identidade: ${JSON.stringify(completedState)}`);
        await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid='inspection-saved-session'][data-session-id='${persistedSessionId}']"));`), 15000, "Salvar sessão Sonic não publicou a sessão", 100);
        await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-close");
        await deleteSession(sessionId);
        sessionId = await createSession(options.app);
        currentE2eRunContext.sessionId = sessionId;
        await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "App Sonic não reabriu após reinício");
        await waitFor(async () => executeScript(sessionId, "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"), uiBootstrapTimeoutMs, "API Sonic não voltou após reinício", 100);
        await handleProjectWizardVisibly(sessionId, "sonic-after-restart");
        await setSessionWindowRect(sessionId, 1920, 1080);
        await clickButtonByTestIdNative(sessionId, "workspace-rail-debug", "abrir Debug Workspace Sonic após reinício");
        await waitForBodyText(sessionId, "Debug Workspace", 15000, "Debug Workspace Sonic não voltou");
        await callAutomationApi(sessionId, "openToolsWorkspace", ["reverse", "debug", true]);
        await waitForBodyText(sessionId, "Analisar ROM", 15000, "Reverse Workspace Sonic não voltou");
        await clickButtonByTestIdNative(sessionId, "reverse-tab-inspection", "abrir inspeção Sonic após reinício");
        await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector(${JSON.stringify(inspectionPanel)}));`), 15000, "Painel Sonic não voltou", 100);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-refresh-sessions", "atualizar sessões Sonic após reinício");
        await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid='inspection-saved-session'][data-session-id='${persistedSessionId}']"));`), 30000, "Sessão Sonic não foi descoberta após reinício", 100);
        const reopenedSessionSelector = `[data-testid='select-saved-session-${persistedSessionId}']`;
        await clickElementWithDiagnostics(sessionId, await findElement(sessionId, reopenedSessionSelector), reopenedSessionSelector);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-reopen", "reabrir sessão Sonic após reinício");
        const reopenedState = await waitFor(async () => { const state = await readInspectionUiState(sessionId); return state?.session?.id === persistedSessionId && state.session.status === "completed" ? state : false; }, 30000, "Sessão Sonic não foi reaberta", 100);
        const reopenedFrame = await waitFor(async () => executeScript(sessionId, `return document.querySelector('[data-testid="inspection-sprite-frame-select"]')?.value ?? '';`), 15000, "Frame Sonic salvo não foi restaurado", 100);
        if (reopenedFrame !== frameId) fail(`Frame Sonic restaurado diverge: ${JSON.stringify({ expected: frameId, actual: reopenedFrame })}`);
        const reopenedEdit = await executeScript(sessionId, `return document.querySelector('[data-testid="inspection-sonic-edit-result"]')?.textContent ?? '';`);
        if (!String(reopenedEdit).includes(modifiedSha256)) fail(`Proveniência da edição Sonic não foi restaurada: ${reopenedEdit}`);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "recompor Sonic após reinício");
        const reopenedProof = await verifyRenderedSpriteFrame(sessionId, modifiedRomBytes, frameId, "Sonic stand após salvar/reiniciar/reabrir");
        const reopenedScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sonic-stand-reopened.png`);
        if (sonicTilesMode) {
          const summaryPath = path.join(pilotDir, "sonic1-stand-tiles-summary.json");
          await writeFile(summaryPath, JSON.stringify({ ...sonicTileEvidence, reopened: { frameId, editRestored: true, composedPixels: reopenedProof }, screenshots: [baseScreenshot, editedScreenshot, baseEmulatorScreenshot, emulatorScreenshot, reopenedScreenshot] }, null, 2));
          console.log(`Resumo: ${summaryPath}`);
          console.log("OK: Desktop Tauri Sonic tile reinsertion identify/compose/edit/negatives/patch/apply/observe/restart/reopen E2E passou.");
          return;
        }
        const oldGameFrame = await readCanonicalGameFrame(sessionId);
        const baseCanonicalPlayEvidence = await runCanonicalSonicTrajectory(sessionId, {
          buttonTestId: "inspection-sonic-play-base",
          label: "base",
          expectedSha256: baseSha256,
          romBytes: inspectionRomBytes,
          artifactPrefix,
        });
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-sonic-play-modified", "jogar versão modificada na Game View após reinício");
        const canonicalIdentity = await waitFor(
          async () => {
            const frame = await readCanonicalGameFrame(sessionId);
            return frame && frame.romSha256 === patchedSha256 && frame.romSha256 !== baseSha256 && frame.romSize === patchedRomBytes.length && frame.coreLabel && frame.corePath ? frame : false;
          },
          15000,
          "Game View não confirmou a identidade da ROM modificada",
          100
        );
        let firstCanonicalFrame;
        let lastCanonicalFrame = null;
        try {
          firstCanonicalFrame = await waitFor(
            async () => {
              const progress = await readCanonicalGameProgress(sessionId);
              lastCanonicalFrame = progress;
              return progress && progress.renderedFrames >= 10 ? readCanonicalGameFrame(sessionId) : false;
            },
            10000,
            "Game View não produziu frames renderizados após Jogar versão modificada",
            100
          );
        } catch (error) {
          console.error(`[inspection-canonical-first-failure] ${JSON.stringify({ lastCanonicalFrame, state: await readAutomationState(sessionId), input: await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;") })}`);
          throw error;
        }
        let lastBootProgress = null;
        let bootFrame;
        try {
          bootFrame = await waitFor(
            async () => {
              const progress = await readCanonicalGameProgress(sessionId);
              lastBootProgress = progress;
              return progress && progress.renderedFrames >= 890 ? progress : false;
            },
            120000,
            "Game View não atravessou o boot da ROM modificada até o ponto de entrada",
            100
          );
        } catch (error) {
          console.error(`[inspection-canonical-boot-failure] ${JSON.stringify({ lastBootProgress, state: await readAutomationState(sessionId), input: await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;") })}`);
          throw error;
        }
        await focusGameCanvasNatively(sessionId);
        const inputBeforeStart = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
        await sendNativeGameKey(sessionId, "Enter", "keyDown", "START de entrada da fase");
        const startHoldProgress = await waitFor(
          async () => {
            const progress = await readCanonicalGameProgress(sessionId);
            return progress && progress.renderedFrames >= (bootFrame?.renderedFrames ?? 890) + 30 ? progress : false;
          },
          15000,
          "Game View não avançou frames enquanto START estava pressionado",
          100
        );
        await sendNativeGameKey(sessionId, "Enter", "keyUp", "liberação de START de entrada da fase");
        const startInput = await waitFor(
          async () => {
            const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
            return current?.lastJoypadAck?.seq > (inputBeforeStart?.lastJoypadAck?.seq ?? 0) ? current : false;
          },
          10000,
          "START nativo não foi confirmado pelo handler/IPC do produto",
          100
        );
        let lastGameplayProgress = null;
        let gameplayProgress;
        try {
          gameplayProgress = await waitFor(
            async () => {
              const progress = await readCanonicalGameProgress(sessionId);
              lastGameplayProgress = progress;
              return progress && progress.renderedFrames >= 1800 ? progress : false;
            },
            120000,
            "A ROM modificada não alcançou a cena de gameplay com Sonic localizado no ROI independente",
            100
          );
        } catch (error) {
          console.error(`[inspection-canonical-gameplay-failure] ${JSON.stringify({ lastGameplayProgress, state: await readAutomationState(sessionId), input: await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;") })}`);
          throw error;
        }
        const gameplayFrameWithPixels = await readCanonicalGameFrame(sessionId, { includePixels: true });
        const gameplaySonic = locateSonicVisual(gameplayFrameWithPixels, modifiedRomBytes);
        if (gameplayFrameWithPixels.nonBlackPixels <= 1000 || !gameplaySonic) {
          fail(`A ROM modificada atravessou o boot, mas o localizador visual independente não encontrou Sonic: ${JSON.stringify({ gameplayProgress, frame: { ...gameplayFrameWithPixels, rgba: undefined }, gameplaySonic })}`);
        }
        const gameplayFrame = { ...gameplayFrameWithPixels, rgba: undefined, sonic: gameplaySonic };
        const canonicalGameBeforeControlsScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sonic-game-modified-before-controls.png`);
        const oldImageReused = Boolean(oldGameFrame && oldGameFrame.nonBlackPixels > 0 && oldGameFrame.framebufferSha256 === gameplayFrame.framebufferSha256);
        if (oldImageReused) {
          fail(`A Game View reutilizou a imagem anterior após carregar a ROM modificada: ${JSON.stringify({ old: oldGameFrame.framebufferSha256, gameplay: gameplayFrame.framebufferSha256 })}`);
        }
        const negativeInputBefore = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
        await sendNativeGameKey(sessionId, "KeyQ", "keyDown", "negativo de tecla não mapeada");
        await sendNativeGameKey(sessionId, "KeyQ", "keyUp", "liberação da tecla não mapeada");
        const negativeInputAfter = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
        const negativeInputRejected = negativeInputAfter?.lastJoypadAck?.seq === negativeInputBefore?.lastJoypadAck?.seq;
        if (!negativeInputRejected) {
          fail(`Entrada não mapeada foi aceita como input do jogo: ${JSON.stringify({ before: negativeInputBefore, after: negativeInputAfter })}`);
        }
        console.log(`[inspection-canonical-negatives] ${JSON.stringify({ wrongRomRejected: canonicalIdentity.romSha256 !== baseSha256 && canonicalIdentity.romSha256 === patchedSha256, staleImageRejected: !oldImageReused, unmappedInputRejected: negativeInputRejected, input: { before: negativeInputBefore?.lastJoypadAck, after: negativeInputAfter?.lastJoypadAck } })}`);
        const trajectory = [];
        const recordTrajectoryFrame = async (label, input, previous, minFrameExclusive = -1) => {
          const raw = await waitFor(async () => {
            const progress = await readCanonicalGameProgress(sessionId);
            return progress && progress.renderedFrames > minFrameExclusive ? readCanonicalGameFrame(sessionId, { includePixels: true }) : false;
          }, 10000, `${label} não avançou para um novo frame`, 100);
          const sonic = locateSonicVisual(raw, modifiedRomBytes, { previous });
          if (!sonic) fail(`Localizador independente não encontrou Sonic na trajetória: ${label}`);
          const memory = await readSonic1PlayerMemory(sessionId);
          const entry = { label, frame: raw.renderedFrames, input, framebufferSha256: raw.framebufferSha256, sonic, memory };
          trajectory.push(entry);
          return { raw, sonic, entry };
        };
        const detectGroundTop = (raw, sonic) => {
          if (!raw?.rgba) return null;
          for (let y = sonic.bounds.y1 + 1; y < raw.height; y += 1) {
            let greenPixels = 0;
            for (let x = Math.max(0, sonic.bounds.x0 - 12); x <= Math.min(raw.width - 1, sonic.bounds.x1 + 12); x += 1) {
              const offset = (y * raw.width + x) * 4;
              const red = raw.rgba[offset];
              const green = raw.rgba[offset + 1];
              const blue = raw.rgba[offset + 2];
              if (green > red + 20 && green > blue + 10 && green >= 90) greenPixels += 1;
            }
            if (greenPixels >= 8) return y;
          }
          return null;
        };
        const initialVisual = { raw: gameplayFrameWithPixels, sonic: gameplaySonic };
        const gameplayMemory = await readSonic1PlayerMemory(sessionId);
        trajectory.push({ label: "before-controls", frame: gameplayFrameWithPixels.renderedFrames, input: "neutral", framebufferSha256: gameplayFrameWithPixels.framebufferSha256, sonic: gameplaySonic, memory: gameplayMemory });
        console.log(`[inspection-trajectory] ${JSON.stringify({ label: "modified", step: "located", frame: gameplayFrameWithPixels.renderedFrames, sonic: gameplaySonic, memory: gameplayMemory })}`);
        const initialGroundTop = detectGroundTop(gameplayFrameWithPixels, gameplaySonic);
        const initialOnGround = initialGroundTop !== null && initialGroundTop - gameplaySonic.bounds.y1 <= 4;
        if (!initialOnGround) {
          fail(`Situação inicial não comprovou Sonic no chão: ${JSON.stringify({ sonic: gameplaySonic, initialGroundTop })}`);
        }

        const movementBefore = initialVisual;
        await sendNativeGameKey(sessionId, "ArrowRight", "keyDown", "movimento para direita");
        const rightInput = await waitFor(
          async () => {
            const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
            return current?.lastJoypadAck?.joypad?.right === true ? current : false;
          },
          10000,
          "ArrowRight nativa não chegou ao core pelo handler do produto",
          100
        );
        const movementSamples = [];
        let movementHoldProgress = null;
        for (const frames of [45, 90, 135]) {
          movementHoldProgress = await waitFor(
            async () => {
              const progress = await readCanonicalGameProgress(sessionId);
              return progress && progress.renderedFrames >= movementBefore.raw.renderedFrames + frames ? progress : false;
            },
            20000,
            `Game View não avançou ${frames} frames durante o movimento para direita`,
            100
          );
          movementSamples.push(await recordTrajectoryFrame(`movement-held-${frames}`, { right: true }, movementSamples.at(-1)?.sonic ?? movementBefore.sonic, movementSamples.at(-1)?.raw.renderedFrames ?? movementBefore.raw.renderedFrames));
          console.log(`[inspection-trajectory] ${JSON.stringify({ label: "modified", step: `movement-held-${frames}`, frame: movementSamples.at(-1).raw.renderedFrames, sonic: movementSamples.at(-1).sonic })}`);
        }
        const movementDuring = movementSamples.at(-1);
        await sendNativeGameKey(sessionId, "ArrowRight", "keyUp", "parada do movimento para direita");
        await waitFor(
          async () => {
            const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
            return current?.lastJoypadAck?.joypad?.right === false ? current : false;
          },
          10000,
          "liberação de ArrowRight não chegou ao core",
          100
        );
        const movementAfter = await recordTrajectoryFrame("movement-released", { right: false }, movementDuring.sonic, movementDuring.raw.renderedFrames);
        const movementDeltaX = Math.max(...[...movementSamples.map((sample) => sample.entry), movementAfter.entry].map((entry) => Math.abs(entry.memory.x - gameplayMemory.x)));
        if (movementAfter.raw.framebufferSha256 === movementBefore.raw.framebufferSha256 || movementDeltaX < 2) {
          const trajectoryPath = path.join(validationDir, `${artifactPrefix}-sonic-trajectory.json`);
          await writeFile(trajectoryPath, JSON.stringify({ romSha256: patchedSha256, core: canonicalIdentity.coreLabel, initial: { onGround: initialOnGround, groundTop: initialGroundTop }, input: { movement: rightInput }, frames: trajectory, failure: "movement-not-observed", movementDeltaX }, null, 2));
          fail(`Movimento de Sonic não produziu deslocamento independente: ${JSON.stringify({ before: movementBefore.sonic, after: movementAfter.sonic, input: rightInput })}`);
        }

        const jumpBefore = await recordTrajectoryFrame("jump-before", { right: false, a: false }, movementAfter.sonic, movementAfter.raw.renderedFrames);
        await sendNativeGameKey(sessionId, "KeyZ", "keyDown", "salto pelo botão A");
        const jumpInputA = await waitFor(
          async () => {
            const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
            return current?.lastJoypadAck?.joypad?.y === true ? current : false;
          },
          10000,
          "KeyZ/A nativa não chegou ao core pelo handler do produto",
          100
        );
        const jumpDownProgress = await waitFor(
          async () => {
            const progress = await readCanonicalGameProgress(sessionId);
            return progress && progress.renderedFrames >= jumpBefore.raw.renderedFrames + 2 ? progress : false;
          },
          20000,
          "Game View não avançou frames durante o salto",
          100
        );
        const jumpDuring = await recordTrajectoryFrame("jump-held", { a: true }, jumpBefore.sonic, jumpBefore.raw.renderedFrames);
        await sendNativeGameKey(sessionId, "KeyZ", "keyUp", "liberação do salto");
        await waitFor(
          async () => {
            const current = await executeScript(sessionId, "return window.__RDS_E2E__?.getLastInputObservation?.() ?? null;");
            return current?.lastJoypadAck?.joypad?.y === false ? current : false;
          },
          10000,
          "liberação de KeyZ/A não chegou ao core",
          100
        );
        const jumpReleased = await recordTrajectoryFrame("jump-released", { a: false }, jumpDuring.sonic, jumpDuring.raw.renderedFrames);
        let lastJumpSample = jumpReleased;
        const captureAfterFrames = async (label, frames) => {
          const target = jumpReleased.raw.renderedFrames + frames;
          await waitFor(async () => {
            const progress = await readCanonicalGameProgress(sessionId);
            return progress && progress.renderedFrames >= target ? progress : false;
          }, 30000, `Game View não avançou ${frames} frames após o salto`, 100);
          lastJumpSample = await recordTrajectoryFrame(label, { a: false }, lastJumpSample.sonic, lastJumpSample.raw.renderedFrames);
          return lastJumpSample;
        };
        const jumpLater = await captureAfterFrames("jump-after-15", 15);
        const jumpMid = await captureAfterFrames("jump-after-45", 45);
        const jumpReturn90 = await captureAfterFrames("jump-after-90", 90);
        const jumpReturn150 = await captureAfterFrames("jump-after-150", 150);
        const jumpReturn240 = await captureAfterFrames("jump-after-240", 240);
        const jumpReturn = [jumpMid, jumpReturn90, jumpReturn150, jumpReturn240].find((sample) => sample.entry.memory.yVel === 0) ?? jumpReturn240;
        const trajectoryY = trajectory.filter((entry) => entry.label.startsWith("jump-")).map((entry) => entry.memory.y);
        const lowestY = Math.min(...trajectoryY);
        const jumpLift = jumpBefore.entry.memory.y - lowestY;
        const returnedToGround = jumpReturn.entry.memory.yVel === 0 && jumpReturn.entry.memory.y >= jumpBefore.entry.memory.y - jumpLift;
        if (jumpLift < 3 || !returnedToGround) {
          const trajectoryPath = path.join(validationDir, `${artifactPrefix}-sonic-trajectory.json`);
          await writeFile(trajectoryPath, JSON.stringify({ romSha256: patchedSha256, core: canonicalIdentity.coreLabel, initial: { onGround: initialOnGround, groundTop: initialGroundTop }, input: { movement: rightInput, jump: jumpInputA }, frames: trajectory, failure: "jump-trajectory-not-observed", jumpLift, returnedToGround }, null, 2));
          fail(`Trajetória de salto não comprovou subida e retorno: ${JSON.stringify({ jumpLift, returnedToGround, trajectory })}`);
        }

        await clickButtonByTestIdNative(sessionId, "viewport-pause", "pausar gameplay Sonic");
        await waitFor(async () => executeScript(sessionId, "return /paus/i.test(document.querySelector('[data-testid=\"viewport-game-status\"]')?.textContent ?? '')"), 10000, "Pausa não ficou visível", 100);
        const pausedProgress = await readCanonicalGameProgress(sessionId);
        await clickButtonByTestIdNative(sessionId, "viewport-resume", "retomar gameplay Sonic");
        const resumedProgress = await waitFor(async () => {
          const progress = await readCanonicalGameProgress(sessionId);
          return progress && progress.renderedFrames > pausedProgress.renderedFrames + 5 ? progress : false;
        }, 10000, "Retomada não avançou frames", 100);
        const trajectoryPath = path.join(validationDir, `${artifactPrefix}-sonic-trajectory.json`);
        await writeFile(trajectoryPath, JSON.stringify({ romSha256: patchedSha256, core: canonicalIdentity.coreLabel, initial: { onGround: initialOnGround, groundTop: initialGroundTop }, input: { movement: rightInput, jump: jumpInputA }, frames: trajectory, pause: { paused: pausedProgress, resumed: resumedProgress } }, null, 2));
        const jumpAfter = jumpReturn;
        const jumpInput = jumpInputA;
        const jumpControl = "KeyZ/A";
        const canonicalGameScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sonic-game-modified-after-restart.png`);
        const canonicalPlayEvidence = {
          identity: canonicalIdentity,
          firstFrame: firstCanonicalFrame,
          bootFrame,
          startHoldProgress,
          gameplayFrame,
          movement: { before: trajectory.find((entry) => entry.label === "before-controls"), samples: movementSamples.map((sample) => sample.entry), after: movementAfter.entry, input: rightInput, holdProgress: movementHoldProgress, deltaX: movementDeltaX },
          jump: { before: jumpBefore.entry, during: jumpDuring.entry, released: jumpReleased.entry, later: jumpLater.entry, mid: jumpMid.entry, after: jumpAfter.entry, input: jumpInput, holdProgress: jumpDownProgress },
          jumpControl,
          oldImageReused,
          screenshot: canonicalGameScreenshot,
          beforeControlsScreenshot: canonicalGameBeforeControlsScreenshot,
          controls: "WebDriver W3C native key actions routed through ViewportPanel key handlers and emulator_send_input",
        };
        console.log(`[inspection-canonical-gameplay] ${JSON.stringify(canonicalPlayEvidence)}`);
        const baseAfterFlowBytes = await readFile(inspectionRom);
        const baseAfterFlowSha256 = createHash("sha256").update(baseAfterFlowBytes).digest("hex");
        if (baseAfterFlowBytes.length !== inspectionRomBytes.length || baseAfterFlowSha256 !== baseSha256) {
          fail("ROM BYOR original foi alterada durante o fluxo: " + JSON.stringify({ initial: { size: inspectionRomBytes.length, sha256: baseSha256 }, final: { size: baseAfterFlowBytes.length, sha256: baseAfterFlowSha256 } }));
        }
        console.log(`[inspection-base-integrity] ` + JSON.stringify({ path: inspectionRom, initial: { size: inspectionRomBytes.length, sha256: baseSha256 }, final: { size: baseAfterFlowBytes.length, sha256: baseAfterFlowSha256 }, unchanged: true }));
        console.log(`[inspection-sonic] ` + JSON.stringify({ baseRom: { path: inspectionRom, size: inspectionRomBytes.length, sha256: baseSha256, finalSize: baseAfterFlowBytes.length, finalSha256: baseAfterFlowSha256 }, modifiedRom: { sha256: modifiedSha256, paletteOffset: 0x238a, word: editWord }, patch: { path: patchPath, size: patchBytes.length, sha256: patchSha256 }, appliedRom: { path: patchedRomPath, sha256: patchedSha256 }, resource: { id: "sonic1_sonic", frame: frameId, tileData: [0x21afe, 0xa120], palette: [0x2388, 0x20], mapping: [0x21293, 21] }, pixels: { base: baseProof.independentEvidence.pixelsSha256, edited: editedProof.independentEvidence.pixelsSha256, reopened: reopenedProof.independentEvidence.pixelsSha256 }, emulator: { base: baseEmulatorObservation, applied: appliedEmulatorObservation, framebufferDiverged, sameConditions, paletteEffectStatus: "passed", paletteOracle: "independent framebuffer comparison; character identity uses the verified shape/palette template, not a magenta ROI", baseCanvas: baseEmulatorCanvas, appliedCanvas: appliedEmulatorCanvas, baseCanonicalPlayEvidence, canonicalPlayEvidence }, screenshots: { base: baseScreenshot, edited: editedScreenshot, emulatorBase: baseEmulatorScreenshot, emulatorApplied: emulatorScreenshot, reopened: reopenedScreenshot, canonicalGameScreenshot }, sessionId: reopenedState.session.id }));
        console.log("OK: Desktop Tauri Sonic identify/compose/edit/save/patch/apply/canonical-play/restart/reopen E2E passou.");
        return;
      }
      if (options.scenario === "inspection-sprite-secondary") {
        if (spriteResourceId !== "spr_spark0" || createHash("sha256").update(inspectionRomBytes).digest("hex") !== "3967996af4efe197284dd80e48a3b457aa381f8e0ba098851b5dbb59fc42bc7c") {
          fail(`Cenário secundário exige spr_spark0 e ROM Taiketsu verificada: ${JSON.stringify({ resource: spriteResourceId, rom: createHash("sha256").update(inspectionRomBytes).digest("hex") })}`);
        }
        const secondaryFrameId = "spr_spark0/frame-0";
        await selectInspectionFrameNative(sessionId, secondaryFrameId);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "composição do spr_spark0/frame-0");
        const secondaryBefore = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, secondaryFrameId, "recurso secundário antes de salvar");
        const secondaryBeforeScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sprite-spark0-before-restart.png`);
        await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-save");
        const persistedSessionId = completedState.session.id;
        if (!persistedSessionId) fail(`Sessão secundária concluída não tem identidade: ${JSON.stringify(completedState)}`);
        await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid='inspection-saved-session'][data-session-id='${persistedSessionId}']"));`), 15000, "Salvar sessão secundária não publicou a sessão", 100);
        await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-close");
        await deleteSession(sessionId);
        sessionId = await createSession(options.app);
        currentE2eRunContext.sessionId = sessionId;
        await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "App secundário não reabriu após reinício");
        await waitFor(async () => executeScript(sessionId, "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"), uiBootstrapTimeoutMs, "API de automação secundária não voltou", 100);
        await handleProjectWizardVisibly(sessionId, "secondary-after-restart");
        await setSessionWindowRect(sessionId, 1280, 800);
        await clickButtonByTestIdNative(sessionId, "workspace-rail-debug", "abrir Debug Workspace secundário após reinício");
        await waitForBodyText(sessionId, "Debug Workspace", 15000, "Debug Workspace secundário não voltou");
        await callAutomationApi(sessionId, "openToolsWorkspace", ["reverse", "debug", true]);
        await waitForBodyText(sessionId, "Analisar ROM", 15000, "Reverse Workspace secundário não voltou");
        await clickButtonByTestIdWithPointerEvents(sessionId, "reverse-tab-inspection");
        await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector(${JSON.stringify(inspectionPanel)}));`), 15000, "Painel secundário não voltou", 100);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-refresh-sessions", "atualizar sessões secundárias após reinício");
        await waitFor(async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid='inspection-saved-session'][data-session-id='${persistedSessionId}']"));`), 15000, "Sessão secundária persistida não apareceu após reinício", 100);
        const secondarySessionSelector = `[data-testid='select-saved-session-${persistedSessionId}']`;
        await clickElementWithDiagnostics(sessionId, await findElement(sessionId, secondarySessionSelector), secondarySessionSelector);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-reopen", "reabrir sessão secundária");
        await waitFor(async () => { const state = await readInspectionUiState(sessionId); return state?.session?.id === persistedSessionId && state.session.status === "completed" ? state : false; }, 30000, "Sessão secundária não foi restaurada após reinício", 100);
        await selectInspectionFrameNative(sessionId, secondaryFrameId);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "recomposição do spr_spark0/frame-0 após reinício");
        const secondaryAfter = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, secondaryFrameId, "recurso secundário após reabrir");
        const secondaryAfterScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sprite-spark0-after-restart.png`);
        console.log(`[inspection-sprite-secondary] ${JSON.stringify({ resource: spriteResourceId, frame: secondaryFrameId, romSha256: secondaryAfter.visualEvidence.romSha256, sourcePngSha256: spriteSourcePngSha256, beforePixelsSha256: secondaryBefore.independentEvidence.pixelsSha256, afterPixelsSha256: secondaryAfter.independentEvidence.pixelsSha256, beforeScreenshot: secondaryBeforeScreenshot, afterScreenshot: secondaryAfterScreenshot, restoredSessionId: persistedSessionId, nativeSize: [secondaryAfter.visualEvidence.naturalWidth, secondaryAfter.visualEvidence.naturalHeight], offsets: { tileData: [0x80060, 0x120], palette: [0x2e134, 0x20], descriptor: 0x22f94 } })}`);
        console.log("OK: Desktop Tauri inspection secondary sprite save/restart/reopen E2E passou.");
        return;
      }
      const candidateAvailable = await waitFor(
        async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid^='inspection-candidate-']"));`),
        30000,
        "Catálogo concluído não exibiu candidato visual",
        250
      );
      if (!candidateAvailable) fail("Catálogo concluído não exibiu candidato visual.");
      const expectedCandidateId = options.scenario === "inspection-preview-unavailable"
        ? process.env.RDS_INSPECTION_UNAVAILABLE_CANDIDATE_ID ?? ""
        : process.env.RDS_INSPECTION_EXPECTED_CANDIDATE_ID ?? "";
      const expectedOffset = options.scenario === "inspection-preview-unavailable"
        ? null
        : Number(process.env.RDS_INSPECTION_EXPECTED_OFFSET ?? "");
      const expectedSize = options.scenario === "inspection-preview-unavailable"
        ? null
        : Number(process.env.RDS_INSPECTION_EXPECTED_SIZE ?? "");
      const expectedKind = options.scenario === "inspection-preview-unavailable"
        ? ""
        : process.env.RDS_INSPECTION_EXPECTED_KIND ?? "tile4bpp_block";
      if (options.scenario !== "inspection-preview-unavailable" && (!Number.isSafeInteger(expectedOffset) || !Number.isSafeInteger(expectedSize) || expectedOffset < 0 || expectedSize <= 0)) {
        fail("A prova positiva exige RDS_INSPECTION_EXPECTED_OFFSET e RDS_INSPECTION_EXPECTED_SIZE independentes da UI.");
      }
      const candidateLookup = async () => executeScript(
        sessionId,
        `
          const expected = String(arguments[0] || "");
          const offset = arguments[2];
          const size = arguments[3];
          const kind = String(arguments[4] || "");
          const unavailable = String(arguments[1]) === "unavailable";
          const selector = expected ? "[data-testid='inspection-candidate-" + expected + "']" : (unavailable ? "[data-preview-expected='false']" : "[data-preview-expected='true']");
          const candidates = Array.from(document.querySelectorAll("[data-testid^='inspection-candidate-']"));
          const match = expected ? document.querySelector(selector) : candidates.find((candidate) =>
            (unavailable || (
              Number(candidate.getAttribute("data-candidate-offset")) === offset &&
              Number(candidate.getAttribute("data-candidate-size")) === size &&
              (!kind || candidate.getAttribute("data-candidate-kind") === kind)
            )) &&
            (unavailable ? candidate.getAttribute("data-preview-expected") === "false" : candidate.getAttribute("data-preview-expected") === "true")
          );
          return match?.getAttribute("data-testid") ?? "";
        `,
        [expectedCandidateId, options.scenario === "inspection-preview-unavailable" ? "unavailable" : "available", expectedOffset, expectedSize, expectedKind]
      );
      let candidateTestId = await candidateLookup();
      // The controlled negative deliberately places the first unavailable
      // candidate after the 16-preview export cap. If pagination hides it,
      // reach it through the visible paginator so the scenario still
      // exercises the UI path instead of selecting it through IPC.
      if (!candidateTestId && options.scenario === "inspection-preview-unavailable") {
        for (let pageTurn = 0; pageTurn < 32 && !candidateTestId; pageTurn += 1) {
          const nextPage = await executeScript(
            sessionId,
            `return Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.replace(/\\s+/g, " ").trim() === "Próxima" && !button.disabled) ? true : false;`
          );
          if (!nextPage) break;
          const beforeCount = await executeScript(sessionId, `return document.querySelectorAll("[data-testid^='inspection-candidate-']").length;`);
          await clickButtonByTextWithPointerEvents(sessionId, "Próxima");
          await waitFor(
            async () => executeScript(sessionId, `return document.querySelectorAll("[data-testid^='inspection-candidate-']").length !== ${Number(beforeCount)};`),
            5000,
            "Paginação do catálogo não atualizou a página",
            100
          );
          candidateTestId = await candidateLookup();
        }
      }
      if (!candidateTestId) {
        const catalogSummary = await executeScript(
          sessionId,
          `return Array.from(document.querySelectorAll("[data-testid^='inspection-candidate-']")).map((candidate) => ({ id: candidate.getAttribute("data-testid"), offset: Number(candidate.getAttribute("data-candidate-offset")), size: Number(candidate.getAttribute("data-candidate-size")), kind: candidate.getAttribute("data-candidate-kind"), previewExpected: candidate.getAttribute("data-preview-expected") }));`
        );
        console.log(`[inspection-candidate-negative] catalog=${JSON.stringify(catalogSummary)}`);
        fail(expectedCandidateId ? `Candidato esperado não foi localizado: ${expectedCandidateId}` : options.scenario === "inspection-preview-unavailable" ? "Catálogo concluído não expôs candidato explicitamente sem prévia." : "Catálogo concluído não expôs candidato com prévia esperada.");
      }
      const selectedCandidateEvidence = await executeScript(
        sessionId,
        `const candidate = document.querySelector(${JSON.stringify(`[data-testid='${candidateTestId}']`)}); return candidate ? { id: candidate.getAttribute("data-testid"), offset: Number(candidate.getAttribute("data-candidate-offset")), size: Number(candidate.getAttribute("data-candidate-size")), kind: candidate.getAttribute("data-candidate-kind"), previewExpected: candidate.getAttribute("data-preview-expected") } : null;`
      );
      console.log(`[inspection-candidate] ${JSON.stringify(selectedCandidateEvidence)}`);
      if (options.scenario !== "inspection-preview-unavailable" && (selectedCandidateEvidence?.offset !== expectedOffset || selectedCandidateEvidence?.size !== expectedSize || selectedCandidateEvidence?.kind !== expectedKind || selectedCandidateEvidence?.previewExpected !== "true")) {
        fail(`Candidato conhecido divergente da especificação independente: ${JSON.stringify({ selected: selectedCandidateEvidence, expected: { offset: expectedOffset, size: expectedSize, kind: expectedKind } })}`);
      }
      await clickButtonByTestIdWithPointerEvents(sessionId, candidateTestId);
      if (options.scenario === "inspection-preview-unavailable") {
        const unavailable = await waitFor(
          async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid='inspection-preview-unavailable']")) && !document.querySelector("[data-testid='inspection-preview-image']");`),
          15000,
          "O cenário de prévia indisponível não expôs o estado negativo explícito",
          100
        );
        if (!unavailable) fail("Prévia indisponível não foi representada como estado negativo separado.");
        if (inspectionFixture && selectedCandidateEvidence?.previewExpected !== "false") fail(`Fixture controlado não produziu candidato sem prévia: ${JSON.stringify({ fixture: inspectionFixture, selected: selectedCandidateEvidence })}`);
        console.log("OK: Desktop Tauri inspection/preview-unavailable E2E passou como cenário negativo separado.");
        return;
      }
      const visualEvidence = await waitFor(
        async () => executeScript(sessionId, `
          const image = document.querySelector("[data-testid='inspection-preview-image']");
          if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return false;
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return false;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          return {
            image: true,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            declaredWidth: Number(image.getAttribute("data-preview-width") || 0),
            declaredHeight: Number(image.getAttribute("data-preview-height") || 0),
            pngSha256: image.getAttribute("data-png-sha256") || "",
            pixelsSha256: image.getAttribute("data-pixels-sha256") || "",
            artifactSha256: image.getAttribute("data-artifact-sha256") || "",
            src: image.currentSrc || image.src,
            pixels: Array.from(pixels),
          };
        `),
        15000,
        "Prévia real não carregou imagem, dimensões ou pixels",
        100
      );
      if (!visualEvidence.image || !Array.isArray(visualEvidence.pixels) || !visualEvidence.src) {
        fail(`Prévia real inválida: ${JSON.stringify({ ...visualEvidence, pixels: undefined })}`);
      }
      assertChunkyGoldenOracle();
      const expectedPreview = renderExpectedTilePreview(inspectionRomBytes, expectedOffset, expectedSize);
      console.log(`[inspection-preview-oracle] ${JSON.stringify({ offset: expectedOffset, size: expectedSize, dimensions: [expectedPreview.width, expectedPreview.height], pixelsSha256: createHash("sha256").update(expectedPreview.pixels).digest("hex"), firstBytes: Array.from(inspectionRomBytes.subarray(expectedOffset, expectedOffset + 16)) })}`);
      const independentPixelEvidence = assertExactPreviewPixels(
        { width: visualEvidence.naturalWidth, height: visualEvidence.naturalHeight, pixels: visualEvidence.pixels },
        expectedPreview,
        "ROM/offset/tamanho conhecidos"
      );
      const pngPayload = String(visualEvidence.src).match(/^data:image\/png;base64,(.+)$/)?.[1];
      if (!pngPayload) fail(`A prévia carregada não expôs uma fonte PNG data: válida: ${String(visualEvidence.src).slice(0, 80)}`);
      const actualPngSha256 = createHash("sha256").update(Buffer.from(pngPayload, "base64")).digest("hex");
      if (actualPngSha256 !== visualEvidence.pngSha256 || actualPngSha256 !== visualEvidence.artifactSha256) {
        fail(`Hash do PNG carregado diverge do contrato de artefato: ${JSON.stringify({ actualPngSha256, pngSha256: visualEvidence.pngSha256, artifactSha256: visualEvidence.artifactSha256 })}`);
      }
      if (visualEvidence.pixelsSha256 !== independentPixelEvidence.pixelsSha256 || actualPngSha256 === independentPixelEvidence.pixelsSha256) {
        fail(`Hashes PNG/RGBA não estão semanticamente separados: ${JSON.stringify({ pngSha256: actualPngSha256, displayedPixelsSha256: visualEvidence.pixelsSha256, actualPixelsSha256: independentPixelEvidence.pixelsSha256 })}`);
      }
      const mutatedPixels = Buffer.from(expectedPreview.pixels);
      mutatedPixels[0] ^= 1;
      let mutationRejected = false;
      try {
        assertExactPreviewPixels(
          { width: expectedPreview.width, height: expectedPreview.height, pixels: mutatedPixels },
          expectedPreview,
          "mutação de um pixel com atributos HTML inalterados"
        );
      } catch (error) {
        mutationRejected = true;
        console.log(`[inspection-preview-negative] mutation-rejected=${error instanceof Error ? error.message : String(error)}`);
      }
      if (!mutationRejected) fail("O oracle independente aceitou uma imagem com um pixel alterado; a asserção visual está permissiva.");
      console.log(`[inspection-preview] ${JSON.stringify({ candidate: selectedCandidateEvidence, dimensions: [independentPixelEvidence.width, independentPixelEvidence.height], pngSha256: actualPngSha256, pixelsSha256: independentPixelEvidence.pixelsSha256, displayedPixelsSha256: visualEvidence.pixelsSha256, mutationRejected })}`);
      const frame0Id = "spr_ryo_100/frame-0";
      const frame1Id = "spr_ryo_100/frame-1";
      await selectInspectionFrameNative(sessionId, frame0Id);
      await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "composição do frame-0 HAMOOPIG");
      const frame0Proof = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, frame0Id, "seleção inicial");
      const spriteFrame0Screenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sprite-frame-0.png`);
      console.log(`[inspection-sprite-frame] ${JSON.stringify({ sourcePng: spriteSourcePng, sourcePngSha256: spriteSourcePngSha256, romSha256: frame0Proof.visualEvidence.romSha256, resource: frame0Proof.visualEvidence.resourceId, frame: frame0Proof.visualEvidence.frameId, nativeSize: [frame0Proof.visualEvidence.naturalWidth, frame0Proof.visualEvidence.naturalHeight], pngSha256: frame0Proof.actualPngSha256, pixelsSha256: frame0Proof.independentEvidence.pixelsSha256, expectedIndexSha256: frame0Proof.independentEvidence.expectedIndexSha256, expectedRgbaSha256: frame0Proof.independentEvidence.expectedRgbaSha256, layout: frame0Proof.layout, screenshot: spriteFrame0Screenshot })}`);

      await selectInspectionFrameNative(sessionId, frame1Id);
      const afterFrame1Selection = await readRenderedSpriteFramePixels(sessionId);
      if (afterFrame1Selection?.frameId === frame0Id) {
        fail(`A seleção de frame-1 manteve a imagem/metadados do frame-0 durante a troca: ${JSON.stringify(afterFrame1Selection)}`);
      }
      console.log(`[inspection-sprite-transition] ${JSON.stringify({ label: "prévia anterior removida na troca", from: frame0Id, to: frame1Id, pending: afterFrame1Selection ? { frame: afterFrame1Selection.frameId, resource: afterFrame1Selection.resourceId } : null, previousPreviewRemovedOnChange: !afterFrame1Selection || afterFrame1Selection.frameId !== frame0Id })}`);
      await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "composição do frame-1 HAMOOPIG");
      const frame1Proof = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, frame1Id, "troca frame-0 para frame-1");
      const spriteFrame1Screenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sprite-frame-1.png`);
      console.log(`[inspection-sprite-frame] ${JSON.stringify({ sourcePng: spriteSourcePng, sourcePngSha256: spriteSourcePngSha256, romSha256: frame1Proof.visualEvidence.romSha256, resource: frame1Proof.visualEvidence.resourceId, frame: frame1Proof.visualEvidence.frameId, nativeSize: [frame1Proof.visualEvidence.naturalWidth, frame1Proof.visualEvidence.naturalHeight], pngSha256: frame1Proof.actualPngSha256, pixelsSha256: frame1Proof.independentEvidence.pixelsSha256, expectedIndexSha256: frame1Proof.independentEvidence.expectedIndexSha256, expectedRgbaSha256: frame1Proof.independentEvidence.expectedRgbaSha256, layout: frame1Proof.layout, screenshot: spriteFrame1Screenshot })}`);

      for (const frameNumber of [2, 3, 4]) {
        const frameId = `spr_ryo_100/frame-${frameNumber}`;
        await selectInspectionFrameNative(sessionId, frameId);
        const staleFrame = await readRenderedSpriteFramePixels(sessionId);
        if (staleFrame?.frameId === frame1Id || staleFrame?.frameId === `spr_ryo_100/frame-${frameNumber - 1}`) {
          fail(`A troca para ${frameId} reutilizou a prévia anterior: ${JSON.stringify(staleFrame)}`);
        }
        console.log(`[inspection-sprite-transition] ${JSON.stringify({ label: "prévia anterior removida na troca", from: frameNumber === 2 ? frame1Id : `spr_ryo_100/frame-${frameNumber - 1}`, to: frameId, pending: staleFrame ? { frame: staleFrame.frameId, resource: staleFrame.resourceId } : null, previousPreviewRemovedOnChange: !staleFrame || staleFrame.frameId !== frameId })}`);
        await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", `composição do ${frameId}`);
        const proof = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, frameId, `troca para ${frameId}`);
        const screenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sprite-frame-${frameNumber}.png`);
        console.log(`[inspection-sprite-frame] ${JSON.stringify({ sourcePng: spriteSourcePng, sourcePngSha256: spriteSourcePngSha256, romSha256: proof.visualEvidence.romSha256, resource: proof.visualEvidence.resourceId, frame: proof.visualEvidence.frameId, nativeSize: [proof.visualEvidence.naturalWidth, proof.visualEvidence.naturalHeight], pngSha256: proof.actualPngSha256, pixelsSha256: proof.independentEvidence.pixelsSha256, expectedIndexSha256: proof.independentEvidence.expectedIndexSha256, expectedRgbaSha256: proof.independentEvidence.expectedRgbaSha256, layout: proof.layout, screenshot })}`);
      }

      await selectInspectionFrameNative(sessionId, frame0Id);
      const afterFrame0Return = await readRenderedSpriteFramePixels(sessionId);
      if (afterFrame0Return?.frameId === frame1Id) {
        fail(`A seleção de frame-0 manteve a imagem/metadados do frame-1 durante a troca: ${JSON.stringify(afterFrame0Return)}`);
      }
      await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "recomposição do frame-0 HAMOOPIG");
      const frame0ReturnProof = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, frame0Id, "retorno frame-1 para frame-0");
      console.log(`[inspection-sprite-transition] ${JSON.stringify({ label: "prévia anterior removida na troca", from: frame1Id, to: frame0Id, pending: afterFrame0Return ? { frame: afterFrame0Return.frameId, resource: afterFrame0Return.resourceId } : null, previousPreviewRemovedOnChange: !afterFrame0Return || afterFrame0Return.frameId !== frame1Id, returnedPixelsSha256: frame0ReturnProof.independentEvidence.pixelsSha256 })}`);

      await selectInspectionFrameNative(sessionId, frame1Id);
      const beforePersistFrame1 = await readRenderedSpriteFramePixels(sessionId);
      if (beforePersistFrame1?.frameId === frame0Id) {
        fail(`A seleção final de frame-1 manteve a prévia anterior antes de salvar: ${JSON.stringify(beforePersistFrame1)}`);
      }
      await clickButtonByTestIdNativeWhenReady(sessionId, "inspection-compose-sprite", "composição final do frame-1 HAMOOPIG");
      const persistedFrame1Proof = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, frame1Id, "frame-1 antes de salvar");
      const spriteBeforeRestartScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sprite-before-restart.png`);
      await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-save");
      const persistedSessionId = completedState.session.id;
      if (!persistedSessionId) fail(`Sessão concluída não tem identidade para validar persistência: ${JSON.stringify(completedState)}`);
      await waitFor(
        async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid='inspection-saved-session'][data-session-id='${persistedSessionId}']"));`),
        15000,
        "Salvar sessão não publicou a sessão corrente na lista persistida",
        100
      );
      await clickButtonByTestIdWithPointerEvents(sessionId, "inspection-close");
      await deleteSession(sessionId);
      sessionId = await createSession(options.app);
      currentE2eRunContext.sessionId = sessionId;
      await waitForAppWindowReady(sessionId, uiBootstrapTimeoutMs, "App não reabriu após reinício real");
      await waitFor(
        async () => executeScript(sessionId, "return typeof window.__RDS_E2E__ === 'object' && window.__RDS_E2E__ !== null;"),
        uiBootstrapTimeoutMs,
        "API de automação não voltou após reinício real"
      );
      await handleProjectWizardVisibly(sessionId, "after-restart");
      await setSessionWindowRect(sessionId, 1920, 1080);
      console.log(`[inspection-reopen-window] ${JSON.stringify(await executeScript(sessionId, `return { width: window.innerWidth, height: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight };`))}`);
      await clickButtonByTestIdNative(sessionId, "workspace-rail-debug", "abrir Debug Workspace após reinício");
      await waitForBodyText(sessionId, "Debug Workspace", 15000, "Debug Workspace não voltou após reinício");
      await callAutomationApi(sessionId, "openToolsWorkspace", ["reverse", "debug", true]);
      try {
        await waitForBodyText(sessionId, "Analisar ROM", 15000, "Reverse Workspace nao terminou de remontar");
      } catch (error) {
        console.log(`[inspection] estado apos reabrir reverse: ${JSON.stringify(await readAutomationState(sessionId))}`);
        throw error;
      }
      await clickButtonByTestIdNative(sessionId, "reverse-tab-inspection", "abrir aba Inspeção após reinício");
      await waitFor(
        async () => executeScript(sessionId, `return Boolean(document.querySelector(${JSON.stringify(inspectionPanel)}));`),
        15000,
        "Painel de inspeção não voltou após reinício",
        250
      );
      await waitFor(
        async () => executeScript(sessionId, `return Boolean(document.querySelector("[data-testid='inspection-saved-session'][data-session-id='${persistedSessionId}']"));`),
        30000,
        "Sessão persistida não foi descoberta após reinício",
        100
      );

      // Negative control: deliberately reopen the real wizard through its
      // visible menu control. A native WebDriver click must be rejected by
      // hit-test and must not activate the saved-session control underneath it.
      await clickButtonByTestIdNative(sessionId, "unified-topbar-menu-trigger", "abrir menu superior para o negativo");
      await waitFor(
        async () => {
          const diagnostic = await inspectNativeButtonTarget(sessionId, "menu-action-project-new");
          return diagnostic?.exists && diagnostic.visible && !diagnostic.disabled && diagnostic.unobstructed ? diagnostic : false;
        },
        10000,
        "Menu superior não expôs o controle Novo Projeto",
        100
      );
      await clickButtonByTestIdNative(sessionId, "menu-action-project-new", "abrir wizard deliberadamente para o negativo");
      await waitFor(
        async () => executeScript(sessionId, `return Boolean(document.querySelector('[data-testid="project-wizard-body"]'));`),
        15000,
        "Wizard não ficou visível para o negativo deliberado de obstrução",
        100
      );
      const selectionBeforeBlockedClick = await readSavedSessionSelection(sessionId, persistedSessionId);
      if (!selectionBeforeBlockedClick) {
        fail(`Sessão salva não estava disponível para o negativo de obstrução: ${persistedSessionId}`);
      }
      const blockedSelectionClick = await clickButtonByTestIdNative(
        sessionId,
        `select-saved-session-${persistedSessionId}`,
        "seleção da sessão salva atrás do wizard",
        { expectBlocked: true }
      );
      const selectionAfterBlockedClick = await readSavedSessionSelection(sessionId, persistedSessionId);
      if (!selectionAfterBlockedClick || JSON.stringify(selectionAfterBlockedClick) !== JSON.stringify(selectionBeforeBlockedClick)) {
        fail(`Clique obstruído alterou a seleção da sessão: ${JSON.stringify({ before: selectionBeforeBlockedClick, after: selectionAfterBlockedClick })}`);
      }
      console.log(`[inspection-reopen-negative] click-rejected=${JSON.stringify({ ...blockedSelectionClick.diagnostic, selectionUnchanged: true, syntheticEvents: false })}`);
      await clickButtonByTestIdNative(sessionId, "wizard-cancel", "fechar wizard pelo controle visível");
      await waitFor(
        async () => executeScript(sessionId, `return !document.querySelector('[data-testid="project-wizard-body"]');`),
        15000,
        "Wizard permaneceu como bloqueador após tratamento visual",
        100
      );
      await waitFor(
        async () => {
          const diagnostic = await inspectNativeButtonTarget(sessionId, `select-saved-session-${persistedSessionId}`);
          return diagnostic?.exists && diagnostic.visible && !diagnostic.disabled && diagnostic.unobstructed ? diagnostic : false;
        },
        30000,
        "Controle nativo de seleção da sessão permaneceu obstruído após fechar o wizard",
        100
      );
      await clickButtonByTestIdNative(sessionId, `select-saved-session-${persistedSessionId}`, "seleção da sessão salva após reinício");
      const reopenDiagnostic = await waitFor(
        async () => {
          const diagnostic = await inspectNativeButtonTarget(sessionId, "inspection-reopen");
          return diagnostic?.exists && diagnostic.visible && !diagnostic.disabled && diagnostic.unobstructed ? diagnostic : false;
        },
        15000,
        "Controle nativo de reabertura não ficou disponível após selecionar a sessão",
        100
      );
      await clickButtonByTestIdNative(sessionId, "inspection-reopen", "reabertura da sessão após reinício");
      const reopenedState = await waitFor(
        async () => {
          const state = await readInspectionUiState(sessionId);
          return state?.session?.id === persistedSessionId &&
            state.session.status === "completed" &&
            state.session.identitySha256 === completedState.session.identitySha256
            ? state
            : false;
        },
        30000,
        "Sessão persistida não foi reaberta com a mesma identidade após reinício",
        100
      );
      console.log(`[inspection-reopen] state=${JSON.stringify(reopenedState)}`);
      const reopenedFrameSelection = await waitFor(
        async () => executeScript(sessionId, `return document.querySelector("[data-testid='inspection-sprite-frame-select']")?.value ?? "";`),
        15000,
        "Seleção persistida de frame-1 não foi restaurada após reinício",
        100
      );
      if (reopenedFrameSelection !== "spr_ryo_100/frame-1") {
        fail(`Seleção de frame restaurada diverge do frame salvo: ${JSON.stringify({ expected: "spr_ryo_100/frame-1", actual: reopenedFrameSelection })}`);
      }
      console.log(`[inspection-reopen-frame-selection] ${JSON.stringify({ sessionId: reopenedState.session.id, frameId: reopenedFrameSelection, restored: true })}`);
      const reopenedCandidate = await waitFor(
        async () => executeScript(sessionId, `return document.querySelector("[data-testid='${candidateTestId}']")?.getAttribute("data-testid") ?? "";`),
        30000,
        "Catálogo da sessão reaberta não expôs o candidato esperado",
        100
      );
      const reopenedCandidateEvidence = await executeScript(
        sessionId,
        `const candidate = document.querySelector(${JSON.stringify(`[data-testid='${reopenedCandidate}']`)}); return candidate ? { id: candidate.getAttribute("data-testid"), offset: Number(candidate.getAttribute("data-candidate-offset")), size: Number(candidate.getAttribute("data-candidate-size")), kind: candidate.getAttribute("data-candidate-kind"), previewExpected: candidate.getAttribute("data-preview-expected") } : null;`
      );
      if (!reopenedCandidateEvidence ||
        reopenedCandidateEvidence.offset !== expectedOffset ||
        reopenedCandidateEvidence.size !== expectedSize ||
        reopenedCandidateEvidence.kind !== expectedKind ||
        reopenedCandidateEvidence.previewExpected !== "true") {
        fail(`Candidato reaberto diverge da especificação independente: ${JSON.stringify({ selected: reopenedCandidateEvidence, expected: { offset: expectedOffset, size: expectedSize, kind: expectedKind } })}`);
      }
      await clickButtonByTestIdNative(sessionId, reopenedCandidate, "seleção do candidato após reinício");
      const reopenedVisualEvidence = await waitFor(
        async () => {
          const evidence = await readRenderedPreviewPixels(sessionId);
          return evidence?.image && evidence.pixels?.length > 0 ? evidence : false;
        },
        15000,
        "Prévia real não voltou após reabrir a sessão",
        100
      );
      let reopenedPreviewLayout;
      try {
        reopenedPreviewLayout = await waitFor(
          async () => {
            const layout = await ensurePreviewVisibleAndUnobstructed(sessionId);
            return layout?.fullyVisible && layout.unobstructed && layout.renderedSizeSufficient ? layout : false;
          },
          15000,
          "Prévia reaberta não ficou integralmente visível e sem obstrução após o scroll do painel",
          100
        );
      } catch (error) {
        const lastLayout = await ensurePreviewVisibleAndUnobstructed(sessionId);
        fail(`${error instanceof Error ? error.message : String(error)}; último layout=${JSON.stringify(lastLayout)}`);
      }
      assertChunkyGoldenOracle();
      const expectedPreviewAfterRestart = renderExpectedTilePreview(inspectionRomBytes, expectedOffset, expectedSize);
      const independentPixelEvidenceAfterRestart = assertExactPreviewPixels(
        { width: reopenedVisualEvidence.naturalWidth, height: reopenedVisualEvidence.naturalHeight, pixels: reopenedVisualEvidence.pixels },
        expectedPreviewAfterRestart,
        "ROM/offset/tamanho conhecidos após reinício"
      );
      const pngPayloadAfterRestart = String(reopenedVisualEvidence.src).match(/^data:image\/png;base64,(.+)$/)?.[1];
      if (!pngPayloadAfterRestart) fail(`A prévia reaberta não expôs uma fonte PNG data: válida: ${String(reopenedVisualEvidence.src).slice(0, 80)}`);
      const actualPngSha256AfterRestart = createHash("sha256").update(Buffer.from(pngPayloadAfterRestart, "base64")).digest("hex");
      if (actualPngSha256AfterRestart !== reopenedVisualEvidence.pngSha256 || actualPngSha256AfterRestart !== reopenedVisualEvidence.artifactSha256) {
        fail(`Hash do PNG reaberto diverge do contrato de artefato: ${JSON.stringify({ actualPngSha256: actualPngSha256AfterRestart, pngSha256: reopenedVisualEvidence.pngSha256, artifactSha256: reopenedVisualEvidence.artifactSha256 })}`);
      }
      if (reopenedVisualEvidence.pixelsSha256 !== independentPixelEvidenceAfterRestart.pixelsSha256 || actualPngSha256AfterRestart === independentPixelEvidenceAfterRestart.pixelsSha256) {
        fail(`Hashes PNG/RGBA reabertos não estão semanticamente separados: ${JSON.stringify({ pngSha256: actualPngSha256AfterRestart, displayedPixelsSha256: reopenedVisualEvidence.pixelsSha256, actualPixelsSha256: independentPixelEvidenceAfterRestart.pixelsSha256 })}`);
      }
      console.log(`[inspection-reopen-visual] ${JSON.stringify({ romSha256: createHash("sha256").update(inspectionRomBytes).digest("hex"), sessionId: reopenedState.session.id, identitySha256: reopenedState.session.identitySha256, candidate: reopenedCandidateEvidence, dimensions: [independentPixelEvidenceAfterRestart.width, independentPixelEvidenceAfterRestart.height], pngSha256: actualPngSha256AfterRestart, pixelsSha256: independentPixelEvidenceAfterRestart.pixelsSha256, displayedPixelsSha256: reopenedVisualEvidence.pixelsSha256, previewLayout: reopenedPreviewLayout, reopenDiagnostic })}`);
      await clickButtonByTestIdNative(sessionId, "inspection-compose-sprite", "composição do frame-1 após reinício");
      const reopenedSpriteProof = await verifyRenderedSpriteFrame(sessionId, inspectionRomBytes, "spr_ryo_100/frame-1", "ROM/manifesto HAMOOPIG após reinício");
      if (reopenedSpriteProof.visualEvidence.romSha256 !== reopenedState.session.identitySha256 || reopenedSpriteProof.visualEvidence.resourceId !== "spr_ryo_100" || reopenedSpriteProof.visualEvidence.frameId !== "spr_ryo_100/frame-1") {
        fail(`Frame composto reaberto diverge da identidade persistida: ${JSON.stringify({ sprite: reopenedSpriteProof.visualEvidence, session: reopenedState })}`);
      }
      console.log(`[inspection-reopen-sprite-frame] ${JSON.stringify({ romSha256: reopenedSpriteProof.visualEvidence.romSha256, resource: reopenedSpriteProof.visualEvidence.resourceId, frame: reopenedSpriteProof.visualEvidence.frameId, dimensions: [reopenedSpriteProof.visualEvidence.naturalWidth, reopenedSpriteProof.visualEvidence.naturalHeight], pngSha256: reopenedSpriteProof.actualPngSha256, pixelsSha256: reopenedSpriteProof.independentEvidence.pixelsSha256, expectedRgbaSha256: reopenedSpriteProof.independentEvidence.expectedRgbaSha256, layout: reopenedSpriteProof.layout, frameSelection: reopenedFrameSelection })}`);
      const spriteAfterRestartScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-sprite-after-restart.png`);
      const afterRestartScreenshot = await captureScreenshot(sessionId, `${artifactPrefix}-after-restart.png`);
      console.log("OK: Desktop Tauri inspection/complete/save/restart/reopen E2E passou.");
      console.log(`ROM BYOR: ${inspectionRom}`);
      console.log(`Sessão reaberta: ${persistedSessionId}`);
      console.log(`Prévia após reinício: pixels PNG recalculados (${reopenedVisualEvidence.naturalWidth}x${reopenedVisualEvidence.naturalHeight})`);
      console.log(`Evidências: ${beforeRestartScreenshot}`);
      console.log(`Evidências: ${afterRestartScreenshot}`);
      console.log(`Evidências do frame-0: ${spriteFrame0Screenshot}`);
      console.log(`Evidências do frame-1: ${spriteFrame1Screenshot}`);
      console.log(`Evidências do frame composto: ${spriteBeforeRestartScreenshot}`);
      console.log(`Evidências do frame composto após reinício: ${spriteAfterRestartScreenshot}`);
      return;
    }

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

    if (options.scenario === "authoring-acceptance") {
      try {
        await runAuthoringAcceptanceScenario(sessionId, options.app, uiBootstrapTimeoutMs, (projectDir) => {
          temporaryProjectDir = projectDir;
        });
      } finally {
        // The guided persona persists in the app's localStorage; restore the default so the
        // next scenarios see the standard shell.
        await executeScript(currentE2eRunContext.sessionId ?? sessionId, "localStorage.removeItem(arguments[0]);", [SHELL_PERSONA_STORAGE_KEY]).catch(() => null);
      }
      return;
    }

    if (options.scenario === "collect-goal") {
      try {
        await runCollectGoalScenario(sessionId, options.app, uiBootstrapTimeoutMs, (projectDir) => {
          temporaryProjectDir = projectDir;
        });
      } finally {
        await executeScript(currentE2eRunContext.sessionId ?? sessionId, "localStorage.removeItem(arguments[0]);", [SHELL_PERSONA_STORAGE_KEY]).catch(() => null);
      }
      return;
    }

    if (options.scenario === "behaviors-independence") {
      try {
        await runBehaviorsIndependenceScenario(sessionId, options.app, uiBootstrapTimeoutMs, (projectDir) => {
          temporaryProjectDir = projectDir;
        });
      } finally {
        await executeScript(currentE2eRunContext.sessionId ?? sessionId, "localStorage.removeItem(arguments[0]);", [SHELL_PERSONA_STORAGE_KEY]).catch(() => null);
      }
      return;
    }

    if (options.scenario === "nodegraph-authoring") {
      try {
        await runNodeGraphAuthoringScenario(sessionId, options.app, uiBootstrapTimeoutMs, (projectDir) => {
          temporaryProjectDir = projectDir;
        });
      } finally {
        await executeScript(currentE2eRunContext.sessionId ?? sessionId, "localStorage.removeItem(arguments[0]);", [SHELL_PERSONA_STORAGE_KEY]).catch(() => null);
      }
      return;
    }

    if (options.scenario === "reference-platformer") {
      await runReferencePlatformerScenario(
        sessionId,
        emulatorActivationTimeoutMs,
        (projectDir) => {
          temporaryProjectDir = projectDir;
        }
      );
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
      const receipt = await setSceneDraft(sessionId, overflowScenario.draft);
      if (!receipt || receipt.ok !== true || typeof receipt.sceneRevision !== "number" || !Number.isSafeInteger(receipt.sceneRevision) || receipt.sceneRevision <= 0) {
        fail(`setSceneDraft devolveu recibo invalido: ${JSON.stringify(receipt)}`);
      }
      const expectedRevision = receipt.sceneRevision;
      await logAutomationState(sessionId, "Pos-setSceneDraft");
      if (options.scenario === "live-error") {
        let lastErrorState = null;
        await waitFor(
          async () => {
            const { state, result: revResult } = await callLiveValidationStateMatch(sessionId, "error", expectedRevision);
            if (!state) return false;
            if (!revResult.matches) {
              lastErrorState = state;
              console.log(
                `[E2E] DIAG: error em revisao divergente: ${JSON.stringify(revResult)}; ignorando.`
              );
              return false;
            }
            return state;
          },
          liveValidationTimeoutMs,
          `Validacao live nao entrou em error apos draft invalido (revisao ${expectedRevision}).`,
          250
        ).catch((error) => {
          const diag = lastErrorState
            ? `ultimo estado: hwValidationState=${lastErrorState.hwValidationState} hwValidatedRevision=${lastErrorState.hwValidatedRevision} hwValidationError=${lastErrorState.hwValidationError}`
            : "nenhum estado error obtido";
          console.log(`[E2E] DIAG timeout error: esperada rev=${expectedRevision}. ${diag}`);
          throw error;
        });
      } else {
        await waitForLiveValidationFresh(sessionId, liveValidationTimeoutMs, expectedRevision);
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

    const consoleEntriesBeforeBuild = await executeScript(
      sessionId,
      "return window.__RDS_E2E__?.getState()?.consoleEntries?.length ?? 0;"
    );

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
        1000,
        // Se o build falhou, a ROM nao existe e o emulador nunca vai ativar.
        // Esperar o orcamento inteiro so troca a causa real por um timeout.
        () => detectBuildFailure(sessionId, consoleEntriesBeforeBuild)
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
    await reportToolchainIdentity(sessionId);
    console.log(`Canvas: ${framebuffer.width}x${framebuffer.height}, pixels nao pretos: ${framebuffer.nonBlackPixels}`);
    await recordE2eLedgerSuccess(options, projectMetadata, { framebuffer });
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
    if (temporaryProjectDir && process.env.RDS_E2E_KEEP_PROJECT === "1") {
      console.warn(`[cleanup] RDS_E2E_KEEP_PROJECT=1: projeto temporario preservado para diagnostico: ${temporaryProjectDir}`);
    } else if (temporaryProjectDir) {
      const cleaned = await cleanupTemporaryProject(temporaryProjectDir);
      if (!cleaned) {
        console.warn(
          `[cleanup] Nao foi possivel remover o projeto temporario criado pelo onboarding: ${temporaryProjectDir}`
        );
      }
    }
    if (temporaryInspectionFixtureDir) {
      await rm(temporaryInspectionFixtureDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(async (error) => {
    const details = error instanceof Error ? error.message : String(error);
    await writeDesktopFailureReport(error).catch(() => {});
    emitGithubErrorAnnotation(details);
    console.error(`ERRO: ${details}`);
    process.exit(1);
  });
}
