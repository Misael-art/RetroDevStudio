import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";

describe("Dialog", () => {
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
    document.body.replaceChildren();
  });

  it("exposes its title and description and focuses the requested control", () => {
    function Fixture() {
      const initialFocusRef = useRef<HTMLInputElement | null>(null);
      return (
        <Dialog
          open
          title="Novo projeto"
          description="Defina os dados iniciais."
          initialFocusRef={initialFocusRef}
          onClose={() => undefined}
        >
          <input ref={initialFocusRef} aria-label="Nome" />
        </Dialog>
      );
    }

    act(() => root.render(<Fixture />));

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const title = document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "");
    const description = document.getElementById(dialog?.getAttribute("aria-describedby") ?? "");

    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(title?.textContent).toBe("Novo projeto");
    expect(description?.textContent).toBe("Defina os dados iniciais.");
    expect(document.activeElement).toBe(document.querySelector("input"));
  });

  it("traps forward and backward tab navigation", () => {
    act(() => {
      root.render(
        <Dialog open title="Ações" onClose={() => undefined} portal={false}>
          <button type="button">Primeiro</button>
          <button type="button">Último</button>
        </Dialog>
      );
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const closeButton = buttons[0];
    const firstAction = buttons[1];
    const lastAction = buttons[2];

    lastAction?.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(closeButton);

    closeButton?.focus();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(lastAction);
    expect(firstAction).toBeTruthy();
  });

  it("closes with Escape and restores focus to the invoker", () => {
    function Fixture() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir
          </button>
          <Dialog open={open} title="Confirmar" onClose={() => setOpen(false)}>
            <button type="button">Continuar</button>
          </Dialog>
        </>
      );
    }

    act(() => root.render(<Fixture />));
    const invoker = container.querySelector<HTMLButtonElement>("button");
    invoker?.focus();
    act(() => invoker?.click());
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it("can keep Escape from dismissing the dialog", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Dialog open title="Bloqueio" onClose={onClose} closeOnEscape={false}>
          Revise o erro antes de prosseguir.
        </Dialog>
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
  });
});
