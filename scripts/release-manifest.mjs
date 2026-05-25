#!/usr/bin/env node
/**
 * release-manifest.mjs
 *
 * Gera a fotografia auditavel de distribuicao interna em
 * src-tauri/target-test/validation/release-manifest.json.
 *
 * Este manifesto nao assina artefatos, nao habilita updater e nao promove
 * producao publica. Ele apenas registra o estado dos binarios gerados,
 * readiness, toolchains e limites operacionais da rodada.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { repoRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Uso: node scripts/release-manifest.mjs --repo-root <caminho>");
      }
      args.repoRoot = value;
      index += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }
  return args;
}

function toPosixRelative(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function readJsonIfExists(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function gitValue(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return "unavailable";
  }
  return result.stdout.trim() || "unavailable";
}

function requireArtifact(repoRoot, key, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Artefato obrigatorio ausente: ${key} (${relativePath})`);
  }

  const metadata = statSync(absolutePath);
  if (!metadata.isFile()) {
    throw new Error(`Artefato obrigatorio invalido: ${key} (${relativePath})`);
  }

  return {
    path: toPosixRelative(repoRoot, absolutePath),
    sha256: sha256(absolutePath),
    sizeBytes: metadata.size,
  };
}

function findLatestMsi(repoRoot) {
  const msiDir = path.join(repoRoot, "src-tauri", "target-test", "release", "bundle", "msi");
  if (!existsSync(msiDir)) {
    throw new Error(
      "Artefato obrigatorio ausente: msi (src-tauri/target-test/release/bundle/msi)"
    );
  }

  const candidates = readdirSync(msiDir)
    .filter((entry) => entry.toLowerCase().endsWith(".msi"))
    .map((entry) => {
      const fullPath = path.join(msiDir, entry);
      return {
        fullPath,
        mtimeMs: statSync(fullPath).mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(
      "Artefato obrigatorio ausente: msi (src-tauri/target-test/release/bundle/msi/*.msi)"
    );
  }

  return requireArtifact(repoRoot, "msi", toPosixRelative(repoRoot, candidates[0].fullPath));
}

function summarizeToolchains(upstreamReport) {
  if (!upstreamReport || typeof upstreamReport !== "object") {
    return {
      status: "unavailable",
      components: [],
    };
  }

  const phases = upstreamReport.phases;
  const components = Array.isArray(phases)
    ? phases.map((value, index) => ({
        id:
          value && typeof value === "object" && typeof value.phase === "string"
            ? value.phase
            : String(index),
        status:
          value && typeof value === "object" && typeof value.status === "string"
            ? value.status
            : "unknown",
      }))
    : Object.entries(phases && typeof phases === "object" ? phases : {}).map(
        ([id, value]) => ({
          id,
          status:
            value && typeof value === "object" && typeof value.status === "string"
              ? value.status
              : "unknown",
        })
      );

  return {
    status: upstreamReport.success === true ? "passed" : "failed",
    components,
    generatedAt:
      typeof upstreamReport.generatedAt === "string" ? upstreamReport.generatedAt : null,
  };
}

function collectCiStatus() {
  if (process.env.GITHUB_ACTIONS === "true") {
    return {
      status: "available",
      provider: "github_actions",
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      ref: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? null,
      sha: process.env.GITHUB_SHA ?? null,
    };
  }

  return {
    status: "unavailable",
  };
}

function collectSigningStatus() {
  return {
    signed: false,
    status: "unsigned",
  };
}

function collectUpdaterStatus() {
  return {
    status: "deferred",
    channel: null,
    strategy: null,
  };
}

function validateManifest(manifest) {
  const requiredTopLevel = [
    "version",
    "commit",
    "branch",
    "date",
    "artifacts",
    "readinessReport",
    "toolchainSummary",
    "ciStatus",
    "signingStatus",
    "updaterStatus",
  ];
  const missing = requiredTopLevel.filter((key) => !(key in manifest));
  if (missing.length > 0) {
    throw new Error(`Manifest schema invalido; campos ausentes: ${missing.join(", ")}`);
  }

  for (const key of ["debugExe", "portableExe", "msi"]) {
    const artifact = manifest.artifacts[key];
    if (!artifact?.path || !artifact?.sha256 || typeof artifact.sizeBytes !== "number") {
      throw new Error(`Manifest schema invalido; artefato incompleto: ${key}`);
    }
  }

  if (manifest.signingStatus.signed !== false) {
    throw new Error("Manifest nao pode declarar assinatura sem etapa real de signing.");
  }
}

function buildManifest(repoRoot) {
  const validationDir = path.join(repoRoot, "src-tauri", "target-test", "validation");
  const packageJson = readJsonIfExists(path.join(repoRoot, "package.json"), {});
  const readinessMdPath = path.join(validationDir, "release-readiness.md");
  const readinessJsonPath = path.join(validationDir, "release-readiness.json");
  const upstreamReportPath = path.join(validationDir, "upstream-validation.json");
  const readinessJson = readJsonIfExists(readinessJsonPath, null);
  const upstreamReport = readJsonIfExists(upstreamReportPath, null);

  return {
    schemaVersion: 1,
    version: typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
    commit:
      process.env.RDS_RELEASE_MANIFEST_COMMIT?.trim() ||
      gitValue(repoRoot, ["rev-parse", "HEAD"]),
    branch:
      process.env.RDS_RELEASE_MANIFEST_BRANCH?.trim() ||
      gitValue(repoRoot, ["branch", "--show-current"]),
    date: new Date().toISOString(),
    artifacts: {
      debugExe: requireArtifact(
        repoRoot,
        "debugExe",
        path.join("src-tauri", "target-test", "debug", "retro-dev-studio.exe")
      ),
      portableExe: requireArtifact(
        repoRoot,
        "portableExe",
        path.join("src-tauri", "target-test", "release", "retro-dev-studio.exe")
      ),
      msi: findLatestMsi(repoRoot),
    },
    readinessReport: {
      path: toPosixRelative(repoRoot, readinessMdPath),
      exists: existsSync(readinessMdPath),
      jsonPath: toPosixRelative(repoRoot, readinessJsonPath),
      jsonExists: existsSync(readinessJsonPath),
      readyForPromotion: readinessJson?.summary?.readyForPromotion ?? null,
      blockers: Array.isArray(readinessJson?.summary?.blockers)
        ? readinessJson.summary.blockers
        : [],
    },
    toolchainSummary: {
      source: toPosixRelative(repoRoot, upstreamReportPath),
      ...summarizeToolchains(upstreamReport),
    },
    ciStatus: collectCiStatus(),
    signingStatus: collectSigningStatus(),
    updaterStatus: collectUpdaterStatus(),
    productionLimits: [
      "Distribuicao interna auditavel apenas; producao publica exige certificado real.",
      "Nao ha assinatura de artefatos sem certificado real e etapa de signing verificavel.",
      "Updater segue deferido ate definicao de estrategia, canal, endpoint e chaves.",
      "SDKs, cores Libretro e ROMs comerciais nao sao redistribuidos neste pacote.",
    ],
  };
}

function main() {
  const { repoRoot: rawRepoRoot } = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(rawRepoRoot);
  const validationDir = path.join(repoRoot, "src-tauri", "target-test", "validation");
  mkdirSync(validationDir, { recursive: true });

  const manifest = buildManifest(repoRoot);
  validateManifest(manifest);

  const outputPath = path.join(validationDir, "release-manifest.json");
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Release manifest gerado: ${toPosixRelative(repoRoot, outputPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
