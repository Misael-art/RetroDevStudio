import { describe, expect, it } from "vitest";
import {
  getPresetLayout,
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

  it("opens logic workspace with tools on the right by default", () => {
    const config = resolveWorkspaceShellConfig("logic", 1920);
    expect(config.showLeft).toBe(true);
    expect(config.showRight).toBe(true);
    expect(config.defaultRightMode).toBe("tools");
  });

  it("adapts authoring layout on narrow widths without negative sizes", () => {
    const layout = getPresetLayout("authoring", 800);
    expect(layout.left + layout.center + layout.right).toBe(100);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeGreaterThanOrEqual(0);
  });
});
