import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { CapabilityAxisReport, RuntimeContractsReport } from "../../core/projectCapability";
import RuntimeContractsPanel from "./RuntimeContractsPanel";

let container: HTMLDivElement;
let root: Root;

function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function axis(status: string): CapabilityAxisReport {
  return {
    status,
    maturity: "experimental",
    evidence_refs: [],
    blocking_statuses: [],
    warnings: [],
    next_actions: [],
    experimental: true,
    source: null,
    owner: null,
    diagnostics: [],
  };
}

describe("RuntimeContractsPanel", () => {
  it("renders declared observed missing states for Inspector and Debug surfaces", () => {
    const report: RuntimeContractsReport = {
      project_dir: "F:/Project",
      axis: axis("partial"),
      runtime_evidence: axis("not_instrumented"),
      contracts: {
        scenes: {
          id: "scenes",
          title: "Cenas",
          state: "observed",
          evidence_refs: [],
          warnings: [],
          next_actions: [],
          experimental: true,
        },
        input: {
          id: "input",
          title: "Input",
          state: "declared",
          evidence_refs: [],
          warnings: [],
          next_actions: [],
          experimental: true,
        },
        save_sram: {
          id: "save_sram",
          title: "Save/SRAM",
          state: "missing",
          evidence_refs: [],
          warnings: [],
          next_actions: ["Declarar SRAM."],
          experimental: true,
        },
      },
    };

    render(<RuntimeContractsPanel report={report} />);

    expect(container.querySelector('[data-testid="runtime-contracts-panel"]')?.textContent).toContain("Runtime Contracts");
    expect(container.textContent).toContain("observed");
    expect(container.textContent).toContain("declared");
    expect(container.textContent).toContain("missing");
    expect(container.textContent).toContain("Experimental");
  });
});
