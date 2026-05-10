// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function buildWindowsEnv() {
  const setResult = spawnSync("cmd", ["/d", "/c", "set"], {
    encoding: "utf8",
  });
  if (setResult.status !== 0) {
    throw new Error(`Falha ao ler ambiente do host Windows: ${setResult.stderr}`);
  }

  const envEntries = setResult.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line: string) => {
      const separatorIndex = line.indexOf("=");
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)] as const;
    });

  return {
    ...Object.fromEntries(envEntries),
    OS: "Windows_NT",
  };
}

const describeWindows = process.platform === "win32" ? describe : describe.skip;

describeWindows("validate-upstream-windows.ps1", () => {
  it("falls back from CIM to Get-Process in self-test mode", () => {
    const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const reportDir = mkdtempSync(path.join(tmpdir(), "rds-upstream-validate-"));
    const reportPath = path.join(reportDir, "upstream-validation.json");
    const targetDir = path.join(reportDir, "cargo-target");
    mkdirSync(targetDir, { recursive: true });

    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(repoRoot, "scripts", "validate-upstream-windows.ps1"),
        "-SkipRustTests",
        "-SelfTestProcessSweep",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 8,
        env: {
          ...buildWindowsEnv(),
          RDS_VALIDATE_FORCE_CIM_FAILURE: "1",
          RDS_VALIDATE_REPORT_PATH: reportPath,
          RDS_VALIDATE_TARGET_DIR: targetDir,
        },
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const report = JSON.parse(readFileSync(reportPath, "utf8").replace(/^\uFEFF/, "")) as {
      success: boolean;
      selfTestProcessSweep: boolean;
      blocking_status_codes: string[];
      wrapper_reports: string[];
      processSweep: {
        strategy: string;
        warnings: string[];
      };
    };

    expect(report.success).toBe(true);
    expect(report.selfTestProcessSweep).toBe(true);
    expect(report.blocking_status_codes).toContain("host_wmi_unavailable");
    expect(report.wrapper_reports.join("\n")).toContain("fallback interno usado");
    expect(report.processSweep.strategy).toBe("get-process");
    expect(report.processSweep.warnings.join("\n")).toContain("CIM/WMI indisponivel");
  }, 30000);

  it("still detects Windows when the OS env var is missing", () => {
    const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const reportDir = mkdtempSync(path.join(tmpdir(), "rds-upstream-validate-"));
    const reportPath = path.join(reportDir, "upstream-validation.json");
    const targetDir = path.join(reportDir, "cargo-target");
    mkdirSync(targetDir, { recursive: true });

    const envWithoutOs = Object.fromEntries(
      Object.entries(buildWindowsEnv()).filter(([key]) => key !== "OS")
    );

    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(repoRoot, "scripts", "validate-upstream-windows.ps1"),
        "-SkipRustTests",
        "-SelfTestProcessSweep",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 8,
        env: {
          ...envWithoutOs,
          RDS_VALIDATE_REPORT_PATH: reportPath,
          RDS_VALIDATE_TARGET_DIR: targetDir,
        },
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const report = JSON.parse(readFileSync(reportPath, "utf8").replace(/^\uFEFF/, "")) as {
      success: boolean;
      selfTestProcessSweep: boolean;
      processSweep: {
        strategy: string;
      };
    };

    expect(report.success).toBe(true);
    expect(report.selfTestProcessSweep).toBe(true);
    expect(["cim", "get-process"]).toContain(report.processSweep.strategy);
  }, 30000);
});
