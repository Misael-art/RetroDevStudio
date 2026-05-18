import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  eventMatchesShortcut,
  findShortcutConflicts,
  formatShortcutKeys,
  getShortcutTitle,
  groupShortcutsByGroup,
  normalizeShortcutChord,
  type ShortcutCommand,
} from "./shortcuts";

describe("shortcut registry", () => {
  it("declares a grouped production shortcut map without default conflicts", () => {
    const groups = groupShortcutsByGroup(DEFAULT_SHORTCUTS);

    expect(groups.map((group) => group.group)).toEqual([
      "Projeto",
      "Build",
      "Edicao",
      "Layout",
      "Viewport",
      "NodeGraph",
      "Emulador",
    ]);
    expect(DEFAULT_SHORTCUTS.some((shortcut) => shortcut.id === "build.run")).toBe(true);
    expect(DEFAULT_SHORTCUTS.some((shortcut) => shortcut.id === "layout.save")).toBe(true);
    expect(findShortcutConflicts(DEFAULT_SHORTCUTS)).toEqual([]);
  });

  it("formats shortcut hints for tooltips and compact menu labels", () => {
    expect(formatShortcutKeys(["Ctrl+B"])).toBe("Ctrl+B");
    expect(formatShortcutKeys(["Ctrl+Shift+Z", "Ctrl+Y"])).toBe("Ctrl+Shift+Z / Ctrl+Y");
    expect(getShortcutTitle("build.run", "Compila e inicia o playtest")).toBe(
      "Compila e inicia o playtest (Atalho: Ctrl+B)"
    );
  });

  it("normalizes modifier order and detects real binding conflicts", () => {
    const shortcuts: ShortcutCommand[] = [
      {
        id: "command.a",
        group: "Teste",
        label: "Comando A",
        keys: ["Ctrl+Shift+P"],
      },
      {
        id: "command.b",
        group: "Teste",
        label: "Comando B",
        keys: ["Shift+Ctrl+P"],
      },
    ];

    expect(normalizeShortcutChord("Shift + Ctrl + P")).toBe("ctrl+shift+p");
    expect(findShortcutConflicts(shortcuts)).toEqual([
      {
        normalizedKey: "ctrl+shift+p",
        displayKey: "Ctrl+Shift+P",
        commandIds: ["command.a", "command.b"],
        labels: ["Comando A", "Comando B"],
      },
    ]);
  });

  it("allows the same key in disjoint editor scopes", () => {
    const shortcuts: ShortcutCommand[] = [
      {
        id: "scene.delete",
        group: "Cena",
        label: "Apagar entidade",
        keys: ["Delete"],
        scope: "scene",
      },
      {
        id: "nodegraph.delete",
        group: "NodeGraph",
        label: "Apagar no",
        keys: ["Delete"],
        scope: "nodegraph",
      },
    ];

    expect(findShortcutConflicts(shortcuts)).toEqual([]);
  });

  it("matches keyboard events through the central registry", () => {
    expect(
      eventMatchesShortcut(
        {
          key: "/",
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        "shortcuts.show"
      )
    ).toBe(true);

    expect(
      eventMatchesShortcut(
        {
          key: "b",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        "build.run"
      )
    ).toBe(false);
  });
});
