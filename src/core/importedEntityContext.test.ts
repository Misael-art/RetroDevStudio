import { describe, expect, it } from "vitest";

import {
  getImportedConfidenceLabel,
  getImportedEntityRoleLabel,
  getImportedGameplayClassLabel,
  resolveImportedEntityContext,
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
});
