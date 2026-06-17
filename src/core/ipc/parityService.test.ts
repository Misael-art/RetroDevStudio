import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import { runParityCapture, formatParitySummary, parityReportFromResult } from "./parityService";
import type { ParityReport, ParityRunResult } from "../projectCapability";

describe("runParityCapture", () => {
  it("invokes parity_run_capture with full arguments", async () => {
    const result: ParityRunResult = {
      ok: true,
      message: "Parity deterministico: 60 frame(s)",
      golden_path: "/project/golden.rds-replay",
      golden_source: "replay",
      frames_run: 60,
      deterministic: true,
      divergence_count: 0,
      report_path: "/project/.rds/reports/gameplay-parity-report.json",
      report: null,
    };
    mocks.invoke.mockResolvedValue(result);

    await expect(
      runParityCapture("/project", "/project/golden.rds-replay", 60)
    ).resolves.toEqual(result);

    expect(mocks.invoke).toHaveBeenCalledWith("parity_run_capture", {
      projectDir: "/project",
      goldenPath: "/project/golden.rds-replay",
      frames: 60,
    });
  });

  it("invokes parity_run_capture with null frames when omitted", async () => {
    mocks.invoke.mockResolvedValue({
      ok: true,
      message: "ok",
      golden_path: "",
      golden_source: "script",
      frames_run: 10,
      deterministic: true,
      divergence_count: 0,
      report_path: "",
      report: null,
    });

    await runParityCapture("/project", "/project/script.rds-input.json");

    expect(mocks.invoke).toHaveBeenCalledWith("parity_run_capture", {
      projectDir: "/project",
      goldenPath: "/project/script.rds-input.json",
      frames: null,
    });
  });
});

describe("formatParitySummary", () => {
  it("returns deterministic summary when no divergences", () => {
    const report: ParityReport = {
      schema: "rds-gameplay-parity/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      core_label: "MockCore",
      frames_run: 60,
      frame_hashes: [],
      final_state_sha256: "def",
      deterministic: true,
      divergences: [],
      fake_toolchain_used: false,
      not_measured_by_this_harness: [],
    };

    const summary = formatParitySummary(report);
    expect(summary).toContain("60");
    expect(summary).toContain("deterministico=sim");
    expect(summary).toContain("0 divergencias");
  });

  it("returns non-deterministic summary with divergence count", () => {
    const report: ParityReport = {
      schema: "rds-gameplay-parity/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      core_label: "MockCore",
      frames_run: 30,
      frame_hashes: [],
      final_state_sha256: "def",
      deterministic: false,
      divergences: [{ frame_index: 5, kind: "frame_hash_mismatch", expected: "hash1", observed: "hash2" }],
      fake_toolchain_used: false,
      not_measured_by_this_harness: [],
    };

    const summary = formatParitySummary(report);
    expect(summary).toContain("30");
    expect(summary).toContain("deterministico=nao");
    expect(summary).toContain("1 divergencia");
  });
});

describe("parityReportFromResult", () => {
  it("returns null when result has no report", () => {
    const result: ParityRunResult = {
      ok: false,
      message: "erro",
      golden_path: "",
      golden_source: "",
      frames_run: 0,
      deterministic: false,
      divergence_count: 0,
      report_path: "",
      report: null,
    };

    expect(parityReportFromResult(result)).toBeNull();
  });

  it("returns embedded report when present", () => {
    const report: ParityReport = {
      schema: "rds-gameplay-parity/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      core_label: "MockCore",
      frames_run: 10,
      frame_hashes: [],
      final_state_sha256: "def",
      deterministic: true,
      divergences: [],
      fake_toolchain_used: false,
      not_measured_by_this_harness: [],
    };

    const result: ParityRunResult = {
      ok: true,
      message: "ok",
      golden_path: "",
      golden_source: "script",
      frames_run: 10,
      deterministic: true,
      divergence_count: 0,
      report_path: "/report.json",
      report,
    };

    expect(parityReportFromResult(result)).toEqual(report);
  });
});
