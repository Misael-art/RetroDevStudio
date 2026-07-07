import { describe, expect, it } from "vitest";
import roadmapDoc from "../../docs/03_ROADMAP_MVP.md?raw";
import {
  DEFAULT_SHELL_PERSONA,
  SHELL_PERSONAS,
  SURFACE_REGISTRY,
  WORKSPACE_SURFACE_ORDER,
  getShellPersonaLabel,
  getSurfaceBadge,
  getWorkspaceSurface,
  isSurfaceVisibleForPersona,
  loadShellPersona,
  normalizeShellPersona,
  saveShellPersona,
} from "./surfaceRegistry";

function createMemoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("surfaceRegistry", () => {
  it("keeps the canonical rail order without duplicates", () => {
    expect(SURFACE_REGISTRY.map((surface) => surface.id)).toEqual([
      ...WORKSPACE_SURFACE_ORDER,
    ]);
    expect(new Set(WORKSPACE_SURFACE_ORDER).size).toBe(WORKSPACE_SURFACE_ORDER.length);
  });

  it("declares complete metadata for every surface", () => {
    for (const surface of SURFACE_REGISTRY) {
      expect(surface.label.length).toBeGreaterThan(0);
      expect(surface.icon.length).toBeGreaterThan(0);
      expect(surface.description.length).toBeGreaterThan(0);
      expect(surface.capability.length).toBeGreaterThan(0);
      expect(surface.roadmapRef.length).toBeGreaterThan(0);
      expect(SHELL_PERSONAS).toContain(surface.minPersona);
    }
  });

  it("marks experimental surfaces with the visible Exp. badge and only those", () => {
    const experimental = SURFACE_REGISTRY.filter(
      (surface) => surface.maturity === "experimental"
    ).map((surface) => surface.id);
    expect(experimental).toEqual(["artstudio", "retrofx"]);
    for (const surface of SURFACE_REGISTRY) {
      expect(getSurfaceBadge(surface)).toBe(
        surface.maturity === "experimental" ? "Exp." : undefined
      );
    }
  });

  it("enforces registry x roadmap: every roadmapRef row exists in docs/03_ROADMAP_MVP.md", () => {
    for (const surface of SURFACE_REGISTRY) {
      expect(
        roadmapDoc.includes(`| ${surface.roadmapRef}`),
        `linha da matriz ausente no roadmap para "${surface.roadmapRef}" (superficie ${surface.id})`
      ).toBe(true);
    }
  });

  it("default persona reveals every current surface (zero regression)", () => {
    expect(DEFAULT_SHELL_PERSONA).toBe("pro");
    for (const surface of SURFACE_REGISTRY) {
      expect(isSurfaceVisibleForPersona(surface, DEFAULT_SHELL_PERSONA)).toBe(true);
    }
  });

  it("persona visibility is monotonic along the ladder", () => {
    for (const surface of SURFACE_REGISTRY) {
      let visible = false;
      for (const persona of SHELL_PERSONAS) {
        const now = isSurfaceVisibleForPersona(surface, persona);
        if (visible) {
          expect(now).toBe(true);
        }
        visible = now;
      }
      expect(visible).toBe(true);
    }
  });

  it("guiado hides advanced surfaces but keeps the core flow", () => {
    const visibleForGuiado = SURFACE_REGISTRY.filter((surface) =>
      isSurfaceVisibleForPersona(surface, "guiado")
    ).map((surface) => surface.id);
    expect(visibleForGuiado).toEqual(["scene", "game", "explorer"]);
  });

  it("normalizes, loads and saves persona with fallback to default", () => {
    expect(normalizeShellPersona("hacker")).toBe("hacker");
    expect(normalizeShellPersona("invalid")).toBe(DEFAULT_SHELL_PERSONA);
    expect(normalizeShellPersona(null)).toBe(DEFAULT_SHELL_PERSONA);

    const storage = createMemoryStorage();
    expect(loadShellPersona(storage)).toBe(DEFAULT_SHELL_PERSONA);
    saveShellPersona("criador", storage);
    expect(loadShellPersona(storage)).toBe("criador");
  });

  it("exposes labels and direct lookup", () => {
    expect(getShellPersonaLabel("guiado")).toBe("Guiado");
    expect(getWorkspaceSurface("scene").domain).toBe("core");
    expect(getWorkspaceSurface("debug").minPersona).toBe("pro");
  });
});
