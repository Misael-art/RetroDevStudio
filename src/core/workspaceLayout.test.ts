import { describe, expect, it } from "vitest";
import {
  getLayoutStorageKeyForDensity,
  getPresetLayout,
  getShellDensity,
  resolveLayoutPreset,
  resolveWorkspaceShellConfig,
} from "./workspaceLayout";

describe("workspaceLayout", () => {
  it("maximizes center for playtest and art presets", () => {
    expect(getPresetLayout("playtest", 1920)).toEqual({ left: 0, center: 100, right: 0 });
    expect(getPresetLayout("art", 1920)).toEqual({ left: 0, center: 100, right: 0 });
  });

  it("maps workspaces to production presets", () => {
    expect(resolveLayoutPreset("scene")).toBe("authoring");
    expect(resolveLayoutPreset("game")).toBe("playtest");
    expect(resolveLayoutPreset("artstudio")).toBe("art");
    expect(resolveLayoutPreset("logic")).toBe("logic");
    expect(resolveLayoutPreset("debug")).toBe("debug");
  });

  it("hides duplicate global inspector for ArtStudio workspace", () => {
    const config = resolveWorkspaceShellConfig("artstudio", 1920);
    expect(config.showRight).toBe(false);
    expect(config.defaultRightMode).toBe("hidden");
    expect(config.panels.right).toBe(0);
  });

  it("keeps game workspace emulator-first without side panels", () => {
    const config = resolveWorkspaceShellConfig("game", 1366);
    expect(config.showLeft).toBe(false);
    expect(config.showRight).toBe(false);
    expect(config.preset).toBe("playtest");
  });

  it("keeps logic workspace full-width; palette and rail live inside NodeGraphEditor", () => {
    const config = resolveWorkspaceShellConfig("logic", 1920);
    expect(config.showLeft).toBe(false);
    expect(config.showRight).toBe(false);
    expect(config.defaultRightMode).toBe("hidden");
    expect(config.panels).toEqual({ left: 0, center: 100, right: 0 });
  });

  it("adapts authoring layout on narrow widths without negative sizes", () => {
    const layout = getPresetLayout("authoring", 800);
    expect(layout.left + layout.center + layout.right).toBe(100);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeGreaterThanOrEqual(0);
  });
});

describe("shell density (fatia 1 v2 do estudo de UI)", () => {
  it("maps host width to density profiles", () => {
    expect(getShellDensity(1280)).toBe("compact");
    expect(getShellDensity(1366)).toBe("compact");
    expect(getShellDensity(1439)).toBe("compact");
    expect(getShellDensity(1440)).toBe("standard");
    expect(getShellDensity(1920)).toBe("standard");
    expect(getShellDensity(2399)).toBe("standard");
    expect(getShellDensity(2400)).toBe("wide");
    expect(getShellDensity(2560)).toBe("wide");
  });

  it("keeps the legacy storage key for standard and namespaces other densities", () => {
    expect(getLayoutStorageKeyForDensity("retrodev-shell-saved-layout", "standard")).toBe(
      "retrodev-shell-saved-layout"
    );
    expect(getLayoutStorageKeyForDensity("retrodev-shell-saved-layout", "compact")).toBe(
      "retrodev-shell-saved-layout::compact"
    );
    expect(getLayoutStorageKeyForDensity("retrodev-shell-saved-layout", "wide")).toBe(
      "retrodev-shell-saved-layout::wide"
    );
  });

  it("treats Deck-class widths (1280/1366) as compact in preset layouts", () => {
    expect(getPresetLayout("authoring", 1280)).toEqual({ left: 16, center: 64, right: 20 });
    expect(getPresetLayout("authoring", 1366)).toEqual({ left: 16, center: 64, right: 20 });
    expect(getPresetLayout("authoring", 1920)).toEqual({ left: 18, center: 60, right: 22 });
  });
});
