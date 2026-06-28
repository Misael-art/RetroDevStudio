import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import {
  crossCoreReportFromResult,
  cycleReportFromResult,
  formatCrossCoreSummary,
  formatCycleReportSummary,
  formatParitySummary,
  parityReportFromResult,
  runCrossCoreParity,
  runCycleReport,
  runParityCapture,
} from "./parityService";
import type {
  CrossCoreParityResult,
  CrossCoreReport,
  CycleReport,
  CycleReportResult,
  ParityReport,
  ParityRunResult,
} from "../projectCapability";

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

describe("runCrossCoreParity", () => {
  it("invokes parity_run_cross_core with all paths and frame cap", async () => {
    const result: CrossCoreParityResult = {
      ok: true,
      message: "cross-core ok",
      golden_path: "/project/golden.rds-input.json",
      golden_source: "script",
      core_a_label: "Genesis Plus GX",
      core_b_label: "PicoDrive",
      frames_run: 45,
      cores_agree: true,
      cross_divergence_count: 0,
      core_a_divergence_count: 0,
      core_b_divergence_count: 0,
      report_path: "/project/.rds/reports/cross-core-parity-report.json",
      report: null,
    };
    mocks.invoke.mockResolvedValue(result);

    await expect(
      runCrossCoreParity(
        "/project",
        "/project/golden.rds-input.json",
        "/cores/genesis_plus_gx_libretro.dll",
        "/cores/picodrive_libretro.dll",
        45
      )
    ).resolves.toEqual(result);

    expect(mocks.invoke).toHaveBeenCalledWith("parity_run_cross_core", {
      projectDir: "/project",
      goldenPath: "/project/golden.rds-input.json",
      coreAPath: "/cores/genesis_plus_gx_libretro.dll",
      coreBPath: "/cores/picodrive_libretro.dll",
      frames: 45,
    });
  });
});

describe("runCycleReport", () => {
  it("invokes parity_run_cycle_report with project, golden, core and frame cap", async () => {
    const result: CycleReportResult = {
      ok: true,
      message: "cycle report ok",
      golden_path: "/project/golden.rds-input.json",
      core_label: "Genesis Plus GX",
      frames_run: 30,
      report_path: "/project/.rds/reports/cycle-report.json",
      report: null,
    };
    mocks.invoke.mockResolvedValue(result);

    await expect(
      runCycleReport(
        "/project",
        "/project/golden.rds-input.json",
        "/cores/genesis_plus_gx_libretro.dll",
        30
      )
    ).resolves.toEqual(result);

    expect(mocks.invoke).toHaveBeenCalledWith("parity_run_cycle_report", {
      projectDir: "/project",
      goldenPath: "/project/golden.rds-input.json",
      corePath: "/cores/genesis_plus_gx_libretro.dll",
      frames: 30,
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

describe("formatCrossCoreSummary", () => {
  it("summarizes cross-core agreement and labels", () => {
    const base: ParityReport = {
      schema: "rds-gameplay-parity/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      core_label: "Genesis Plus GX",
      frames_run: 12,
      frame_hashes: [],
      final_state_sha256: "def",
      deterministic: true,
      divergences: [],
      fake_toolchain_used: false,
      not_measured_by_this_harness: [],
    };
    const report: CrossCoreReport = {
      schema: "rds-cross-core-parity/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      golden_path: "/golden.rds-input.json",
      golden_source: "script",
      core_a_label: "Genesis Plus GX",
      core_b_label: "PicoDrive",
      frames_run: 12,
      report_a: base,
      report_b: { ...base, core_label: "PicoDrive" },
      cross_divergences: [],
      cores_agree: true,
      not_measured_by_this_harness: ["m68k_cycle_trace"],
    };

    const summary = formatCrossCoreSummary(report);

    expect(summary).toContain("12");
    expect(summary).toContain("cores_agree=sim");
    expect(summary).toContain("Genesis Plus GX");
    expect(summary).toContain("PicoDrive");
  });
});

describe("formatCycleReportSummary", () => {
  it("summarizes missing cycle traces honestly", () => {
    const report: CycleReport = {
      schema: "rds-cycle-report/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      golden_path: "/golden.rds-input.json",
      core_label: "Genesis Plus GX",
      frames_run: 10,
      frame_samples: [],
      evidence_sources: [],
      m68k_cycle_trace: { status: "missing", source: "libretro", detail: "not exposed" },
      z80_cycle_trace: { status: "missing", source: "libretro", detail: "not exposed" },
      vdp_scanline_trace: { status: "missing", source: "libretro", detail: "not exposed" },
      dma_timing: { status: "missing", source: "libretro", detail: "not exposed" },
      limitations: {
        not_cycle_accurate: true,
        missing: ["m68k_cycle_trace", "z80_cycle_trace", "vdp_scanline_trace", "dma_timing"],
        notes: ["No trace source available."],
      },
      report_path: "/project/.rds/reports/cycle-report.json",
    };

    const summary = formatCycleReportSummary(report);

    expect(summary).toContain("10");
    expect(summary).toContain("m68k=missing");
    expect(summary).toContain("not_cycle_accurate=true");
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

describe("crossCoreReportFromResult", () => {
  it("returns embedded cross-core report when present", () => {
    const base: ParityReport = {
      schema: "rds-gameplay-parity/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      core_label: "Genesis Plus GX",
      frames_run: 1,
      frame_hashes: [],
      final_state_sha256: "def",
      deterministic: true,
      divergences: [],
      fake_toolchain_used: false,
      not_measured_by_this_harness: [],
    };
    const report: CrossCoreReport = {
      schema: "rds-cross-core-parity/v1",
      rom_path: "/rom.bin",
      rom_sha256: "abc",
      golden_path: "/golden.rds-input.json",
      golden_source: "script",
      core_a_label: "Genesis Plus GX",
      core_b_label: "PicoDrive",
      frames_run: 1,
      report_a: base,
      report_b: { ...base, core_label: "PicoDrive" },
      cross_divergences: [],
      cores_agree: true,
      not_measured_by_this_harness: [],
    };
    const result: CrossCoreParityResult = {
      ok: true,
      message: "ok",
      golden_path: report.golden_path,
      golden_source: report.golden_source,
      core_a_label: report.core_a_label,
      core_b_label: report.core_b_label,
      frames_run: report.frames_run,
      cores_agree: true,
      cross_divergence_count: 0,
      core_a_divergence_count: 0,
      core_b_divergence_count: 0,
      report_path: "/report.json",
      report,
    };

    expect(crossCoreReportFromResult(result)).toEqual(report);
  });
});

describe("cycleReportFromResult", () => {
  it("returns null when result has no report", () => {
    const result: CycleReportResult = {
      ok: false,
      message: "erro",
      golden_path: "",
      core_label: "",
      frames_run: 0,
      report_path: "",
      report: null,
    };

    expect(cycleReportFromResult(result)).toBeNull();
  });
});
