import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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

  it("keeps system package mutation behind the explicit ensure path", () => {
    const bootstrapSource = readFileSync(bootstrapScript, "utf8");
    const validateSource = readFileSync(validateScript, "utf8");

    expect(bootstrapSource).toContain('if [[ "$ENSURE_HOST" != "1" ]]');
    expect(bootstrapSource).toContain("sudo pacman -S --needed --noconfirm");
    expect(validateSource).not.toMatch(/\bsudo\b/);
  });
});
