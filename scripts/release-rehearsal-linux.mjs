#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const validationDir = path.join(repoRoot, "src-tauri", "target-test", "validation");
const outputPath = path.join(validationDir, "linux-release-rehearsal.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message;
    throw new Error(`${command} ${args.join(" ")} falhou: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

async function readJson(fileName) {
  const source = await readFile(path.join(validationDir, fileName), "utf8");
  return JSON.parse(source);
}

async function evidenceHash(fileName) {
  const bytes = await readFile(path.join(validationDir, fileName));
  return createHash("sha256").update(bytes).digest("hex");
}

function addCheck(checks, name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function runNpmAudit() {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmCli ? [npmCli, "audit", "--json"] : ["audit", "--json"];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  const payload = JSON.parse(result.stdout || "{}");
  const total = payload.metadata?.vulnerabilities?.total;
  if (result.error || result.status !== 0 || total !== 0) {
    throw new Error(`npm audit registrou ${total ?? "resultado invalido"} vulnerabilidades`);
  }
  return payload.metadata.vulnerabilities;
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error("O rehearsal local desta etapa suporta somente Linux.");
  }

  run(process.execPath, [path.join(scriptDir, "license-inventory.mjs")]);
  run(process.execPath, [path.join(scriptDir, "architecture-metrics.mjs")]);

  const commit = run("git", ["rev-parse", "HEAD"]);
  const branch = run("git", ["branch", "--show-current"]);
  const dirty = run("git", ["status", "--porcelain"]).length > 0;
  const checks = [];

  const host = await readJson("host-readiness.json");
  const upstream = await readJson("upstream-validation-linux.json");
  const licenses = await readJson("license-inventory.json");
  const architecture = await readJson("architecture-metrics.json");
  const mdE2e = await readJson("desktop-e2e-success-build-run-megadrive.json");
  const snesE2e = await readJson("desktop-e2e-success-build-run-snes.json");
  const npmVulnerabilities = runNpmAudit();
  const tauriConfig = JSON.parse(await readFile(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));

  addCheck(checks, "worktree_clean", !dirty, dirty ? "worktree possui alteracoes" : commit);
  addCheck(checks, "host_ready", host.schema === "rds-host-readiness/v1" && host.state === "READY", host.state);
  addCheck(checks, "host_commit", host.repository?.commit === commit && host.repository?.dirty === false, host.repository?.commit);
  addCheck(checks, "linux_upstream", upstream.schema === "rds-linux-upstream-validation/v1" && upstream.success === true, upstream.blocking_status_codes?.join(", ") || "success");
  addCheck(checks, "upstream_commit", upstream.repository?.commit === commit && upstream.repository?.dirty === false, upstream.repository?.commit);
  addCheck(checks, "contract_identity", upstream.lock_digest === host.lock_digest && upstream.host_fingerprint === host.host_fingerprint, `${host.lock_digest}/${host.host_fingerprint}`);
  addCheck(checks, "npm_audit", npmVulnerabilities.total === 0, JSON.stringify(npmVulnerabilities));
  addCheck(checks, "license_inventory", licenses.schema === "rds-license-inventory/v1" && licenses.toolchains?.every((item) => item.redistributed === false), `${licenses.summary?.toolchain_artifacts ?? 0} artefatos`);
  addCheck(checks, "architecture_metrics", architecture.schema === "rds-architecture-metrics/v1", architecture.generated_at ?? "sem timestamp");
  addCheck(checks, "updater_disabled", tauriConfig.bundle?.createUpdaterArtifacts === false && !tauriConfig.plugins?.updater, "release publica requer assinatura/updater deliberados");

  for (const [label, expectedTarget, report] of [
    ["md", "megadrive", mdE2e],
    ["snes", "snes", snesE2e],
  ]) {
    addCheck(
      checks,
      `desktop_e2e_${label}`,
      report.schema === "rds-desktop-e2e-success/v1" &&
        report.repository?.commit === commit &&
        report.repository?.dirty === false &&
        report.target === expectedTarget &&
        report.framebuffer?.nonBlackPixels > 0,
      report.repository?.commit ?? "sem commit"
    );
  }

  const blockers = checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`);
  const evidenceFiles = [
    "host-readiness.json",
    "upstream-validation-linux.json",
    "license-inventory.json",
    "architecture-metrics.json",
    "desktop-e2e-success-build-run-megadrive.json",
    "desktop-e2e-success-build-run-snes.json",
  ];
  const evidence = Object.fromEntries(
    await Promise.all(
      evidenceFiles.map(async (file) => [file, { sha256: await evidenceHash(file) }])
    )
  );
  const payload = {
    schema: "rds-linux-release-rehearsal/v1",
    generated_at: new Date().toISOString(),
    status: blockers.length === 0 ? "READY_FOR_WINDOWS_GATE" : "BLOCKED",
    repository: { commit, branch, dirty },
    lock_digest: host.lock_digest ?? null,
    host_fingerprint: host.host_fingerprint ?? null,
    windows_certification: "FROZEN_BY_OPERATOR",
    public_release_allowed: false,
    checks,
    blockers,
    evidence,
  };

  await mkdir(validationDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Linux release rehearsal: ${payload.status}`);
  console.log(`Report: ${outputPath}`);
  if (blockers.length > 0) {
    throw new Error(blockers.join("\n"));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
