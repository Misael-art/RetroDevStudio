#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");

export const TOOLCHAIN_LICENSES = Object.freeze({
  "node-linux-x64": { license: "MIT", redistributed: false },
  "node-win32-x64": { license: "MIT", redistributed: false },
  "jdk-linux-x64": {
    license: "GPL-2.0-only WITH Classpath-exception-2.0",
    redistributed: false,
  },
  "jdk-win32-x64": {
    license: "GPL-2.0-only WITH Classpath-exception-2.0",
    redistributed: false,
  },
  "ghidra-all-x64": { license: "Apache-2.0", redistributed: false },
  "libretro-cores-linux-x64": {
    license: "NOASSERTION (heterogeneous per core)",
    redistributed: false,
  },
  "libretro-cores-win32-x64": {
    license: "NOASSERTION (heterogeneous per core)",
    redistributed: false,
  },
  "pvsneslib-source": { license: "MIT", redistributed: false },
  "pvsneslib-tcc-source": { license: "LGPL-2.1-or-later", redistributed: false },
  "pvsneslib-wla-source": { license: "GPL-2.0-or-later", redistributed: false },
  "pvsneslib-win32-x64": {
    license: "MIT + LGPL-2.1-or-later + GPL-2.0-or-later (bundled components)",
    redistributed: false,
  },
  "binutils-2.41-source": { license: "GPL-3.0-or-later", redistributed: false },
  "gcc-13.2.0-source": {
    license: "GPL-3.0-or-later WITH GCC-exception-3.1",
    redistributed: false,
  },
  "sgdk-source": { license: "MIT", redistributed: false },
  "sgdk-win32-x64": { license: "MIT", redistributed: false },
});

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function packageNameFromLockPath(lockPath) {
  return lockPath.split("node_modules/").at(-1);
}

export function collectNpmPackages(root = repoRoot) {
  const lock = readJson(path.join(root, "package-lock.json"));
  return Object.entries(lock.packages ?? {})
    .filter(([lockPath]) => lockPath.includes("node_modules/"))
    .map(([lockPath, value]) => ({
      ecosystem: "npm",
      name: value.name ?? packageNameFromLockPath(lockPath),
      version: value.version ?? "NOASSERTION",
      license: value.license ?? "NOASSERTION",
      development_only: value.dev === true,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function collectCargoPackages(root = repoRoot) {
  const result = spawnSync(
    "cargo",
    ["metadata", "--locked", "--format-version", "1", "--manifest-path", "src-tauri/Cargo.toml"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(`cargo metadata falhou: ${(result.stderr || result.stdout).trim()}`);
  }
  const metadata = JSON.parse(result.stdout);
  return metadata.packages
    .map((value) => ({
      ecosystem: "cargo",
      name: value.name,
      version: value.version,
      license: value.license ?? "NOASSERTION",
      source: value.source ?? "workspace",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function collectToolchainArtifacts(root = repoRoot) {
  const manifest = readJson(path.join(root, "toolchains", "host-requirements.lock.json"));
  return manifest.artifacts.map((artifact) => {
    const policy = TOOLCHAIN_LICENSES[artifact.id];
    if (!policy) throw new Error(`Politica de licenca ausente para ${artifact.id}`);
    return {
      ecosystem: "toolchain",
      id: artifact.id,
      version: artifact.version,
      source_url: artifact.url,
      sha256: artifact.sha256,
      ...policy,
    };
  });
}

export function buildInventory(root = repoRoot) {
  const npm = collectNpmPackages(root);
  const cargo = collectCargoPackages(root);
  const toolchains = collectToolchainArtifacts(root);
  const unknownRedistributable = toolchains.filter(
    (entry) => entry.redistributed && entry.license.startsWith("NOASSERTION")
  );
  if (unknownRedistributable.length > 0) {
    throw new Error(
      `Artefatos redistribuiveis sem licenca: ${unknownRedistributable.map((entry) => entry.id).join(", ")}`
    );
  }
  return {
    schema: "rds-license-inventory/v1",
    generated_at: new Date().toISOString(),
    policy: {
      toolchains_redistributed: false,
      commercial_roms_redistributed: false,
      public_release_allowed: false,
      notice: "NOTICE",
    },
    summary: {
      npm_packages: npm.length,
      cargo_packages: cargo.length,
      toolchain_artifacts: toolchains.length,
      npm_noassertion: npm.filter((entry) => entry.license === "NOASSERTION").length,
      cargo_noassertion: cargo.filter((entry) => entry.license === "NOASSERTION").length,
    },
    npm,
    cargo,
    toolchains,
  };
}

export function writeInventory(root = repoRoot) {
  const inventory = buildInventory(root);
  const validationDir = path.join(root, "src-tauri", "target-test", "validation");
  mkdirSync(validationDir, { recursive: true });
  const jsonPath = path.join(validationDir, "license-inventory.json");
  writeFileSync(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  return { inventory, jsonPath };
}

function main() {
  const { inventory, jsonPath } = writeInventory();
  console.log(`Inventario de licencas: ${jsonPath}`);
  console.log(
    `npm=${inventory.summary.npm_packages} cargo=${inventory.summary.cargo_packages} toolchains=${inventory.summary.toolchain_artifacts}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
