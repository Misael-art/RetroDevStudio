import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bootstrapScript = path.join(repoRoot, "scripts", "bootstrap.sh");
const validateScript = path.join(repoRoot, "scripts", "validate-upstream-linux.sh");

const linuxDescribe = process.platform === "linux" ? describe : describe.skip;

function runBash(args, env = {}) {
  return spawnSync("bash", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function createExecutable(target, body) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body, "utf8");
  chmodSync(target, 0o755);
}

linuxDescribe("Linux host scripts", () => {
  it("keeps Linux shell scripts executable", () => {
    expect((statSync(bootstrapScript).mode & 0o111) !== 0).toBe(true);
    expect((statSync(validateScript).mode & 0o111) !== 0).toBe(true);
  });

  it("documents bootstrap options without mutating the checkout", () => {
    const result = runBash([bootstrapScript, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RetroDev Studio Linux bootstrap");
    expect(result.stdout).toContain("--ensure");
    expect(result.stdout).toContain("--profile full");
    expect(result.stdout).toContain("--offline");
    expect(result.stdout).toContain("--run-baseline");
    expect(result.stdout).toContain("--run-upstream-validation");
  });

  it("documents Linux upstream validation options", () => {
    const result = runBash([validateScript, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RetroDev Studio Linux upstream validation");
    expect(result.stdout).toContain("--skip-rust-tests");
    expect(result.stdout).toContain("--require-decomp-tools");
  });

  it("writes a structured Linux upstream validation report even when blockers exist", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "rds-linux-validation-"));
    const reportPath = path.join(tempDir, "upstream-validation-linux.json");

    try {
      const result = runBash([validateScript, "--skip-rust-tests", "--json"], {
        RDS_VALIDATE_REPORT_PATH: reportPath,
      });

      expect([0, 1]).toContain(result.status);
      expect(existsSync(reportPath)).toBe(true);

      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      expect(report.schema).toBe("rds-linux-upstream-validation/v1");
      expect(report.host_platform).toBe("linux");
      expect(Array.isArray(report.blocking_status_codes)).toBe(true);
      expect(report.checks.sgdk).toBeTruthy();
      expect(report.checks.desktop_e2e).toBeTruthy();
      expect(report.checks.libretro).toBeTruthy();
      expect(report.checks.rust_smoke.skipped_by_flag).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves managed host tools from the active-host pointer", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "rds-linux-active-host-"));
    const hostCacheBase = path.join(tempDir, "cache");
    const activeCache = path.join(hostCacheBase, "locked-host");
    const reportPath = path.join(tempDir, "upstream-validation-linux.json");
    const managedBin = path.join(tempDir, "managed-bin");
    const jdk = path.join(activeCache, "toolchains", "jdk");
    const ghidra = path.join(activeCache, "toolchains", "ghidra");
    const pinnedNode = path.join(hostCacheBase, "bootstrap", "node-v24.18.0-linux-x64", "bin", "node");
    createExecutable(pinnedNode, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
    createExecutable(path.join(managedBin, "node"), "#!/bin/sh\nexit 99\n");
    createExecutable(path.join(activeCache, "toolchains", "m68k-elf", "bin", "m68k-elf-gcc"), "#!/bin/sh\nexit 0\n");
    createExecutable(path.join(jdk, "bin", "java"), "#!/bin/sh\nprintf 'openjdk version \\\"21.0.11\\\"\\n' >&2\n");
    createExecutable(path.join(ghidra, "support", "analyzeHeadless"), "#!/bin/sh\nexit 0\n");
    createExecutable(path.join(managedBin, "WebKitWebDriver"), "#!/bin/sh\nexit 0\n");
    const cores = path.join(activeCache, "toolchains", "libretro", "cores");
    mkdirSync(cores, { recursive: true });
    writeFileSync(path.join(cores, "genesis_plus_gx_libretro.so"), "fixture", "utf8");
    writeFileSync(path.join(cores, "snes9x_libretro.so"), "fixture", "utf8");
    mkdirSync(hostCacheBase, { recursive: true });
    writeFileSync(
      path.join(hostCacheBase, "active-host.json"),
      `${JSON.stringify({
        schema: "rds-active-host/v1",
        native_cache: activeCache,
        lock_digest: "test-lock-digest",
        host_fingerprint: "test-host-fingerprint",
      })}\n`,
      "utf8",
    );

    try {
      const result = runBash([validateScript, "--skip-rust-tests", "--require-decomp-tools"], {
        PATH: `${managedBin}${path.delimiter}${process.env.PATH}`,
        RDS_HOST_CACHE: hostCacheBase,
        RDS_VALIDATE_REPORT_PATH: reportPath,
      });
      expect(result.status).toBe(1);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      expect(report.active_host_cache).toBe(activeCache);
      expect(report.lock_digest).toBe("test-lock-digest");
      expect(report.host_fingerprint).toBe("test-host-fingerprint");
      expect(report.checks.baseline_tools.node).toBe(pinnedNode);
      expect(report.checks.sgdk.native_compiler_path).toBe(
        path.join(activeCache, "toolchains", "m68k-elf", "bin", "m68k-elf-gcc"),
      );
      expect(report.checks.sgdk.native_compiler).toBe(true);
      expect(report.checks.desktop_e2e.native_webdriver).toBe(path.join(managedBin, "WebKitWebDriver"));
      expect(report.checks.libretro.native_core).toBe(path.join(cores, "genesis_plus_gx_libretro.so"));
      expect(report.checks.decompilation_optional).toMatchObject({
        ghidra_ok: true,
        jdk21_ok: true,
        java_major: 21,
        operational_probe: "passed",
      });
      expect(report.blocking_status_codes).toContain("sgdk_root_missing");
      expect(report.blocking_status_codes).not.toContain("webdriver_missing");
      expect(report.blocking_status_codes).not.toContain("libretro_md_core_missing");
      expect(report.blocking_status_codes).not.toContain("libretro_snes_core_missing");
      expect(report.blocking_status_codes).not.toContain("ghidra_missing");
      expect(report.blocking_status_codes).not.toContain("jdk21_missing");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps system package mutation behind the explicit ensure path", () => {
    const bootstrapSource = readFileSync(bootstrapScript, "utf8");
    const validateSource = readFileSync(validateScript, "utf8");

    expect(bootstrapSource).toContain('if [[ "$ENSURE_HOST" != "1" ]]');
    expect(bootstrapSource).toContain("sudo pacman -S --needed --noconfirm");
    expect(validateSource).not.toMatch(/\bsudo\b/);
  });
});
