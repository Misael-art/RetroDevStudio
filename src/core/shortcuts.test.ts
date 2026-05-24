import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  getPaletteCommands,
  eventMatchesShortcut,
  findShortcutConflicts,
  formatShortcutKeys,
  getShortcutTitle,
  groupShortcutsByGroup,
  loadShortcutCustomizations,
  normalizeShortcutChord,
  resetShortcutCustomizations,
  resolveShortcutCommand,
  saveShortcutCustomizations,
  searchCommands,
  updateShortcutBinding,
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
      "Workspaces",
      "Ferramentas",
      "Console",
      "Viewport",
      "NodeGraph",
      "Emulador",
    ]);
    expect(DEFAULT_SHORTCUTS.some((shortcut) => shortcut.id === "build.run")).toBe(true);
    expect(DEFAULT_SHORTCUTS.some((shortcut) => shortcut.id === "layout.save")).toBe(true);
    expect(DEFAULT_SHORTCUTS.some((shortcut) => shortcut.id === "commandPalette.open")).toBe(true);
    expect(findShortcutConflicts(DEFAULT_SHORTCUTS)).toEqual([]);
  });

  it("registers only executable app commands for the command palette", () => {
    const paletteCommands = getPaletteCommands(DEFAULT_SHORTCUTS);
    const commandIds = paletteCommands.map((command) => command.id);

    expect(commandIds).toEqual(
      expect.arrayContaining([
        "project.open",
        "build.run",
        "emulator.play",
        "emulator.stop",
        "layout.focus",
        "layout.save",
        "tools.runtimeSetup",
        "console.open",
        "tools.assetBrowser",
        "workspace.scene",
        "workspace.logic",
        "workspace.artstudio",
      ])
    );
    expect(commandIds).not.toContain("viewport.grid");
    expect(commandIds).not.toContain("emulator.dpad");
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
        scopes: ["global", "global"],
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

  it("searches command labels with a simple fuzzy match", () => {
    const results = searchCommands("rt setup", getPaletteCommands(DEFAULT_SHORTCUTS));

    expect(results[0]?.command.id).toBe("tools.runtimeSetup");
    expect(searchCommands("bld rn", getPaletteCommands(DEFAULT_SHORTCUTS))[0]?.command.id).toBe(
      "build.run"
    );
    expect(searchCommands("art", getPaletteCommands(DEFAULT_SHORTCUTS))[0]?.command.id).toBe(
      "workspace.artstudio"
    );
  });

  it("resolves shortcut execution and blocks ambiguous conflicts in the active scope", () => {
    const shortcuts: ShortcutCommand[] = [
      {
        id: "command.a",
        group: "Teste",
        label: "Comando A",
        keys: ["Ctrl+K"],
        scope: "shell",
        palette: true,
      },
      {
        id: "command.b",
        group: "Teste",
        label: "Comando B",
        keys: ["Ctrl+K"],
        scope: "scene",
        palette: true,
      },
      {
        id: "command.c",
        group: "Teste",
        label: "Comando C",
        keys: ["Ctrl+L"],
        scope: "nodegraph",
        palette: true,
      },
    ];

    expect(
      resolveShortcutCommand(
        { key: "l", ctrlKey: true },
        shortcuts,
        new Set(["command.a", "command.b", "command.c"]),
        "nodegraph"
      )
    ).toEqual({
      commandId: "command.c",
      conflict: null,
    });

    expect(
      resolveShortcutCommand(
        { key: "k", ctrlKey: true },
        shortcuts,
        new Set(["command.a", "command.b", "command.c"]),
        "scene"
      )
    ).toEqual({
      commandId: null,
      conflict: {
        normalizedKey: "ctrl+k",
        displayKey: "Ctrl+K",
        commandIds: ["command.a", "command.b"],
        labels: ["Comando A", "Comando B"],
        scopes: ["shell", "scene"],
      },
    });
  });

  it("persists shortcut customizations and can restore defaults", () => {
    localStorage.clear();
    const customized = updateShortcutBinding(DEFAULT_SHORTCUTS, "build.run", "Ctrl+Alt+B");

    saveShortcutCustomizations(customized, DEFAULT_SHORTCUTS, localStorage);

    expect(localStorage.getItem("retrodev-shortcut-customizations-v1")).toContain("build.run");
    expect(loadShortcutCustomizations(DEFAULT_SHORTCUTS, localStorage).find((shortcut) => shortcut.id === "build.run")?.keys).toEqual([
      "Ctrl+Alt+B",
    ]);

    const restored = resetShortcutCustomizations(DEFAULT_SHORTCUTS, localStorage);

    expect(restored.find((shortcut) => shortcut.id === "build.run")?.keys).toEqual(["Ctrl+B"]);
    expect(localStorage.getItem("retrodev-shortcut-customizations-v1")).toBeNull();
  });
});
