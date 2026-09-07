#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");

export const ARCHITECTURE_BASELINE = Object.freeze({
  commit: "9f908720e543ff4370148c617c9d8a086fdb3fde",
  recorded_at: "2026-07-17",
  files: {
    "src-tauri/src/core/project_mgr.rs": 24402,
    "src-tauri/src/lib.rs": 7448,
    "src/App.tsx": 5203,
    "src/components/viewport/ViewportPanel.tsx": 5458,
    "src/components/artstudio/ArtStudioPanel.tsx": 4281,
    "src-tauri/src/tools/dependency_manager.rs": 2659,
  },
});

function lineCount(file) {
  const raw = readFileSync(file, "utf8");
  return raw.length === 0 ? 0 : raw.split(/\r?\n/).length - (raw.endsWith("\n") ? 1 : 0);
}

export function buildArchitectureMetrics(root = repoRoot) {
  const files = Object.entries(ARCHITECTURE_BASELINE.files).map(([relativePath, before]) => {
    const after = lineCount(path.join(root, relativePath));
    return {
      path: relativePath,
      before_lines: before,
      after_lines: after,
      delta_lines: after - before,
      reduced: after < before,
    };
  });
  return {
    schema: "rds-architecture-metrics/v1",
    generated_at: new Date().toISOString(),
    baseline_commit: ARCHITECTURE_BASELINE.commit,
    files,
    summary: {
      before_lines: files.reduce((sum, entry) => sum + entry.before_lines, 0),
      after_lines: files.reduce((sum, entry) => sum + entry.after_lines, 0),
      reduced_files: files.filter((entry) => entry.reduced).length,
    },
  };
}

export function writeArchitectureMetrics(root = repoRoot) {
  const report = buildArchitectureMetrics(root);
  const output = path.join(root, "src-tauri", "target-test", "validation", "architecture-metrics.json");
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, output };
}

function main() {
  const { report, output } = writeArchitectureMetrics();
  console.log(`Metricas arquiteturais: ${output}`);
  console.log(
    `linhas ${report.summary.before_lines} -> ${report.summary.after_lines}; arquivos reduzidos=${report.summary.reduced_files}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
