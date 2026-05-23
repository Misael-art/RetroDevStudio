import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { CapabilityAxisReport, ProjectCapabilityReport, AudioPipelineReport } from "../../core/projectCapability";
import ProjectCapabilityPanel from "./ProjectCapabilityPanel";

let container: HTMLDivElement;
let root: Root;

function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(element);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
});

function axis(status: string, overrides: Partial<CapabilityAxisReport> = {}): CapabilityAxisReport {
  return {
    status,
    maturity: "experimental",
    evidence_refs: [],
    blocking_statuses: [],
    warnings: [],
    next_actions: ["Rodar Build & Run."],
    experimental: true,
    source: null,
    owner: null,
    diagnostics: [],
    ...overrides,
  };
}

function report(overrides: Partial<ProjectCapabilityReport> = {}): ProjectCapabilityReport {
  const baseAxis = axis("partial");
  return {
    project_dir: "F:/Project",
    documentation: axis("success", { evidence_refs: [{ kind: "doc", path: "project.rds", summary: "ok" }] }),
    implementation: axis("success"),
    build: baseAxis,
    rom: baseAxis,
    emulation: baseAxis,
    runtime_evidence: axis("not_instrumented"),
    visual_validation: baseAxis,
    assets: baseAxis,
    patterns: baseAxis,
    runtime_contracts: baseAxis,
    audio: baseAxis,
    blockers: [],
    ...overrides,
  };
}

describe("ProjectCapabilityPanel", () => {
  it("renders empty state before inspection", () => {
    render(<ProjectCapabilityPanel report={null} />);

    expect(container.querySelector('[data-testid="capability-empty"]')?.textContent).toContain("Sem snapshot");
  });

  it("renders blockers and keeps Experimental visible", () => {
    render(
      <ProjectCapabilityPanel
        report={report({
          build: axis("blocked", { blocking_statuses: ["build_not_run"] }),
          blockers: [
            {
              severity: "error",
              area: "project_capability",
              source_path: null,
              line: null,
              column: null,
              user_message: "Build sem evidencia.",
              technical_detail: "build ausente",
              suggested_action: "Rode Build & Run.",
              blocking: true,
              evidence_path: null,
            },
          ],
        })}
      />
    );

    expect(container.querySelector('[data-testid="capability-blockers"]')?.textContent).toContain("Build sem evidencia");
    expect(container.textContent).toContain("Experimental");
    expect(container.textContent).toContain("build not run");
  });

  it("renders complete evidence axes without cosmetic success promotion", () => {
    render(<ProjectCapabilityPanel report={report({ build: axis("success"), rom: axis("success") })} />);

    expect(container.textContent).toContain("Documentacao");
    expect(container.textContent).toContain("success");
    expect(container.textContent).toContain("experimental");
  });

  it("renders audio warnings semaphore", () => {
    const audioReport: AudioPipelineReport = {
      project_dir: "F:/Project",
      axis: axis("partial", { warnings: ["clipping"] }),
      entries: [
        {
          path: "assets/audio/hit.wav",
          kind: "pcm_wav",
          sample_rate: { status: "invalid", detail: "44100" },
          clipping: { detected: true, clipped_samples: 2 },
          dc_offset: { value: 0, normalized_abs: 0.9, status: "warning" },
          padding: { status: "ok", detail: "block_align=2" },
          sfx_priority: { status: "not_declared", detail: "" },
          channel_ownership: { status: "not_declared", detail: "" },
          memory_risks: [],
          warnings: ["clipping"],
          next_actions: [],
        },
      ],
    };

    render(<ProjectCapabilityPanel report={report()} audioReport={audioReport} />);

    expect(container.querySelector('[data-testid="audio-capability-panel"]')?.textContent).toContain("warnings");
    expect(container.textContent).toContain("Clip");
  });
});
