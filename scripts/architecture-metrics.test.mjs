import { describe, expect, it } from "vitest";

import { ARCHITECTURE_BASELINE, buildArchitectureMetrics } from "./architecture-metrics.mjs";

describe("architecture metrics", () => {
  it("tracks every high-risk module from the recorded baseline", () => {
    const report = buildArchitectureMetrics();
    expect(report.schema).toBe("rds-architecture-metrics/v1");
    expect(report.files.map((entry) => entry.path)).toEqual(
      Object.keys(ARCHITECTURE_BASELINE.files)
    );
  });

  it("records the Runtime Setup consolidation as a material reduction", () => {
    const report = buildArchitectureMetrics();
    const dependencyManager = report.files.find(
      (entry) => entry.path === "src-tauri/src/tools/dependency_manager.rs"
    );
    expect(dependencyManager?.before_lines).toBe(2659);
    expect(dependencyManager?.after_lines).toBeLessThan(1000);
    expect(dependencyManager?.reduced).toBe(true);
  });
});
