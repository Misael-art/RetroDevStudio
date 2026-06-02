import { describe, expect, it } from "vitest";

import {
  getImportedConfidenceLabel,
  getImportedEntityRoleLabel,
  getImportedGameplayClassLabel,
  resolveImportedEntityContext,
  summarizeImportedStagingEntities,
} from "./importedEntityContext";

describe("importedEntityContext", () => {
  it("maps imported roles, gameplay classes and confidence to product-facing labels", () => {
    expect(getImportedEntityRoleLabel("player_avatar")).toBe("Jogador");
    expect(getImportedGameplayClassLabel("beat_em_up_close_range_signals")).toBe("Beat 'em up");
    expect(getImportedGameplayClassLabel("hybrid_action_scroll_signals")).toBe("Hibrido acao/scroll");
    expect(getImportedConfidenceLabel("high")).toBe("Alta confianca");
  });

  it("builds a shared imported context summary for SGDK Phase D entities", () => {
    const context = resolveImportedEntityContext({
      components: {
        logic: {
          imported_semantics: {
            source: "sgdk_phase_d",
            entity_role: "enemy_actor",
            gameplay_class: "run_and_gun_horizontal_signals",
            confidence: "high",
            role_reason: "nome do recurso sugere papel de inimigo",
            driver_functions: ["enemy_tick", "main"],
            source_paths: ["src/enemy.c", "src/main.c"],
            audit_flags: ["enemy_name_signal", "position:staging_layout"],
          },
        },
      },
    });

    expect(context.isImported).toBe(true);
    expect(context.roleLabel).toBe("Inimigo");
    expect(context.gameplayLabel).toBe("Run-and-gun");
    expect(context.confidenceLabel).toBe("Alta confianca");
    expect(context.summary).toContain("Inimigo importado");
    expect(context.detail).toContain("enemy_tick");
    expect(context.detail).toContain("src/enemy.c");
    expect(context.detail).toContain("enemy_name_signal");
    expect(context.positionMode).toBe("staging");
    expect(context.positionLabel).toBe("Staging de autoria");
    expect(context.focusPriority).toBeGreaterThan(80);
  });

  it("stays neutral for native entities without imported semantics", () => {
    const context = resolveImportedEntityContext({
      components: {
        sprite: {
          asset: "assets/sprites/hero.png",
          frame_width: 16,
          frame_height: 16,
          palette_slot: 0,
          animations: {},
        },
      },
    });

    expect(context.isImported).toBe(false);
    expect(context.summary).toBeNull();
    expect(context.focusPriority).toBe(0);
  });

  it("summarizes staging entities for imported scene authoring UX", () => {
    const stagedEntity = (id: string, x: number, y: number) => ({
      entity_id: id,
      transform: { x, y },
      components: {
        sprite: { asset: `assets/sprites/${id}.png` },
        logic: {
          imported_semantics: {
            source: "sgdk_phase_d",
            entity_role: "enemy_actor",
            audit_flags: ["position:staging_layout"],
          },
        },
      },
    });

    const summary = summarizeImportedStagingEntities([
      stagedEntity("a", 48, 88),
      stagedEntity("b", 112, 116),
      stagedEntity("c", 368, 88),
      {
        entity_id: "native",
        transform: { x: 0, y: 0 },
        components: { sprite: { asset: "assets/sprites/native.png" } },
      },
    ]);

    expect(summary.count).toBe(3);
    expect(summary.pageCount).toBe(2);
    expect(summary.bounds).toEqual({ minX: 48, minY: 88, maxX: 368, maxY: 116 });
    expect(summary.pages).toHaveLength(2);
    expect(summary.pages[0].entityIds).toEqual(["a", "b"]);
    expect(summary.pages[0].count).toBe(2);
    expect(summary.pages[0].label).toBe("Pagina 1 de 2");
    expect(summary.pages[1].entityIds).toEqual(["c"]);
    expect(summary.pages[1].count).toBe(1);
    expect(summary.pages[1].centerX).toBeGreaterThan(320);
    expect(summary.shouldShowOverlay).toBe(true);
    expect(summary.label).toContain("3 sprites");
    expect(summary.label).toContain("2 paginas");
  });
});
