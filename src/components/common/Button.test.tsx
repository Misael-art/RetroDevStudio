import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Button from "./Button";
import IconButton from "./IconButton";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("shared buttons", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses safe defaults, forwards clicks and exposes the selected visual contract", () => {
    const onClick = vi.fn();
    act(() => {
      root.render(
        <Button variant="primary" size="lg" onClick={onClick}>
          Executar
        </Button>
      );
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.type).toBe("button");
    expect(button.classList).toContain("rds-button--primary");
    expect(button.classList).toContain("rds-button--lg");

    act(() => button.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("blocks interaction and announces progress while loading", () => {
    const onClick = vi.fn();
    act(() => {
      root.render(
        <Button loading loadingLabel="Compilando projeto" onClick={onClick}>
          Compilar
        </Button>
      );
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("[role='status']")?.textContent).toContain("Compilando projeto");

    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("requires an accessible name for icon-only actions", () => {
    act(() => {
      root.render(
        <IconButton
          aria-label="Fechar painel"
          variant="ghost"
          icon={<svg data-testid="close-icon" />}
        />
      );
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Fechar painel");
    expect(button.title).toBe("Fechar painel");
    expect(button.classList).toContain("rds-icon-button");
    expect(container.querySelector("[data-testid='close-icon']")?.parentElement?.getAttribute("aria-hidden"))
      .toBe("true");

    act(() => button.focus());
    expect(document.activeElement).toBe(button);
  });
});
