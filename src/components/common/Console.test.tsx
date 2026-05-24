import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Console from "./Console";
import { useEditorStore } from "../../core/store/editorStore";
import type { ActionableDiagnostic } from "../../core/diagnostics";

function renderConsole(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<Console variant="drawer" />);
  });
  return root;
}

function click(container: HTMLElement, testId: string) {
  const element = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  if (!element) {
    throw new Error(`Missing ${testId}`);
  }
  act(() => {
    element.click();
  });
}

describe("Console actionable diagnostics", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let clipboardWrite: ReturnType<typeof vi.fn>;

  const buildDiagnostic: ActionableDiagnostic = {
    severity: "error",
    area: "build_sgdk",
    source_path: "F:/Games/Demo/assets/sprites/missing.png",
    line: null,
    column: null,
    user_message:
      "Build falhou porque o asset assets/sprites/missing.png nao foi encontrado.",
    technical_detail:
      "Asset referenciado nao encontrado: 'F:/Games/Demo/assets/sprites/missing.png'.\nstack trace completo",
    suggested_action:
      "Restaure o arquivo ausente ou atualize a entidade para apontar para um asset existente.",
    blocking: true,
    evidence_path: "F:/Games/Demo/build/megadrive",
  };

  const runtimeDiagnostic: ActionableDiagnostic = {
    severity: "warn",
    area: "runtime_setup",
    source_path: null,
    line: null,
    column: null,
    user_message: "Runtime Setup encontrou uma dependencia pendente.",
    technical_detail: "JDK ausente no PATH.",
    suggested_action: "Instale JDK (Temurin LTS) pelo Runtime Setup.",
    blocking: false,
    evidence_path: null,
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    useEditorStore.setState({ consoleEntries: [], consoleVisible: true });
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("filters diagnostics by severity and area, expands details, and copies the full error", async () => {
    act(() => {
      useEditorStore.getState().logDiagnostic(buildDiagnostic);
      useEditorStore.getState().logDiagnostic(runtimeDiagnostic);
    });
    root = renderConsole(container);

    expect(container.textContent).toContain("Build falhou porque");
    expect(container.textContent).toContain("Runtime Setup encontrou");

    click(container, "console-filter-severity-error");
    expect(container.textContent).toContain("Build falhou porque");
    expect(container.textContent).not.toContain("Runtime Setup encontrou");

    click(container, "console-filter-area-build_sgdk");
    click(container, "console-entry-1");
    expect(container.querySelector("[data-testid='console-details']")).not.toBeNull();
    expect(container.textContent).toContain("F:/Games/Demo/build/megadrive");

    const technical = container.querySelector(
      "[data-testid='console-details-technical']"
    ) as HTMLDetailsElement | null;
    expect(technical?.open).toBe(false);
    expect(technical?.textContent).toContain("stack trace completo");

    click(container, "console-copy-diagnostic");
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("stack trace completo"));
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("Acao recomendada"));
  });
});
