import { act } from "react";
import { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdaptivePanel, { type AdaptivePanelState } from "./AdaptivePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`Controle ausente: ${testId}`);
  act(() => button.click());
}

function key(element: Element, value: string, shiftKey = false) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value, shiftKey }));
  });
}

function lastState(callback: ReturnType<typeof vi.fn>): AdaptivePanelState {
  const call = callback.mock.calls[callback.mock.calls.length - 1];
  if (!call) throw new Error("Estado não emitido");
  return call[0] as AdaptivePanelState;
}

describe("AdaptivePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(globalThis, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(globalThis, "innerHeight", { configurable: true, value: 800 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("never auto-hides warnings, dangers, or build blockers", () => {
    for (const tone of ["warning", "danger", "build-blocker"] as const) {
      act(() => {
        root.render(
          <AdaptivePanel panelId="critical" title="Build bloqueado" tone={tone} defaultAutoHide>
            Corrija o erro antes de compilar.
          </AdaptivePanel>
        );
      });

      const autoHide = container.querySelector(
        '[data-testid="critical-auto-hide"]'
      ) as HTMLButtonElement;
      expect(autoHide.disabled).toBe(true);
      expect(autoHide.title).toContain("permanecem visíveis");
      expect(container.querySelector('[data-testid="critical"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="critical-restore"]')).toBeNull();
    }
  });

  it("allows informative panels to auto-hide and remain recoverable", () => {
    act(() => {
      root.render(
        <AdaptivePanel panelId="context" title="Contexto">
          Informação auxiliar.
        </AdaptivePanel>
      );
    });

    click(container, "context-auto-hide");
    const autoHideControl = container.querySelector('[data-testid="context-auto-hide"]')!;
    act(() => {
      autoHideControl.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body })
      );
    });

    const restore = container.querySelector(
      '[data-testid="context-restore"]'
    ) as HTMLButtonElement | null;
    expect(restore?.getAttribute("aria-label")).toBe("Mostrar painel Contexto");

    act(() => restore?.click());
    expect(container.querySelector('[data-testid="context"]')).not.toBeNull();

    click(container, "context-pin");
    expect(container.querySelector('[data-testid="context-auto-hide"]')?.getAttribute("aria-pressed"))
      .toBe("false");
  });

  it("moves and resizes a floating panel by keyboard in 8 px and 32 px steps", async () => {
    const onStateChange = vi.fn();
    await act(async () => {
      root.render(
        <AdaptivePanel panelId="metrics" title="Métricas" onStateChange={onStateChange}>
          Uso de VRAM.
        </AdaptivePanel>
      );
      await Promise.resolve();
    });

    click(container, "metrics-float");
    await act(async () => Promise.resolve());

    const moveHandle = container.querySelector('[data-testid="metrics-move-handle"]')!;
    key(moveHandle, "ArrowRight");
    key(moveHandle, "ArrowDown", true);
    expect(lastState(onStateChange).position).toEqual({ x: 328, y: 292 });

    const resizeHandle = container.querySelector('[data-testid="metrics-resize-handle"]')!;
    key(resizeHandle, "ArrowRight");
    key(resizeHandle, "ArrowDown", true);
    expect(lastState(onStateChange).size).toEqual({ width: 368, height: 312 });

    key(resizeHandle, "Enter");
    expect(lastState(onStateChange).size).toEqual({ width: 360, height: 280 });
    expect(lastState(onStateChange).position).toEqual({ x: 320, y: 260 });
  });

  it("supports pointer movement and resizing with bounded geometry", () => {
    const onStateChange = vi.fn();
    act(() => {
      root.render(
        <AdaptivePanel
          panelId="pointer-panel"
          title="Diagnóstico"
          defaultFloating
          onStateChange={onStateChange}
        >
          Estado auxiliar.
        </AdaptivePanel>
      );
    });

    const moveHandle = container.querySelector('[data-testid="pointer-panel-move-handle"]')!;
    act(() => {
      moveHandle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20 })
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 36, clientY: 52 })
      );
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
    expect(lastState(onStateChange).position).toEqual({ x: 40, y: 104 });

    const resizeHandle = container.querySelector(
      '[data-testid="pointer-panel-resize-handle"]'
    )!;
    act(() => {
      resizeHandle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 30 })
      );
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
    expect(lastState(onStateChange).size).toEqual({ width: 400, height: 300 });
  });

  it("clamps floating geometry to its bounds and recovers it automatically", () => {
    const bounds = document.createElement("div");
    bounds.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        right: 700,
        bottom: 450,
        width: 600,
        height: 400,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect;
    const boundsRef = createRef<HTMLElement>();
    boundsRef.current = bounds;

    act(() => {
      root.render(
        <AdaptivePanel
          panelId="bounded"
          title="Ferramentas"
          boundsRef={boundsRef}
          defaultFloating
          defaultPosition={{ x: 900, y: 700 }}
          defaultSize={{ width: 900, height: 700 }}
        >
          Ferramentas auxiliares.
        </AdaptivePanel>
      );
    });

    const panel = container.querySelector('[data-testid="bounded"]') as HTMLElement;
    expect(panel.style.left).toBe("100px");
    expect(panel.style.top).toBe("50px");
    expect(panel.style.width).toBe("600px");
    expect(panel.style.height).toBe("400px");
  });
});
