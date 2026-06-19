import { describe, expect, it } from "vitest";
import {
  createFallbackDiagnostic,
  diagnosticConsoleMessage,
  normalizeBuildDiagnostics,
  buildAreaForTarget,
  type ActionableDiagnostic,
} from "./diagnostics";

describe("actionable diagnostics model", () => {
  it("prefers backend diagnostics and preserves the common contract", () => {
    const backendDiagnostic: ActionableDiagnostic = {
      severity: "error",
      area: "build_sgdk",
      source_path: "F:/Games/Demo/assets/sprites/missing.png",
      line: null,
      column: null,
      user_message:
        "Build falhou porque o asset assets/sprites/missing.png nao foi encontrado.",
      technical_detail:
        "Asset referenciado nao encontrado: 'F:/Games/Demo/assets/sprites/missing.png'.",
      suggested_action:
        "Restaure o arquivo ausente ou atualize a entidade para apontar para um asset existente.",
      blocking: true,
      evidence_path: "F:/Games/Demo/build/megadrive",
    };

    const diagnostics = normalizeBuildDiagnostics(
      {
        ok: false,
        rom_path: "",
        log: [{ level: "error", message: "Build failed" }],
        diagnostics: [backendDiagnostic],
      },
      "megadrive",
      "F:/Games/Demo"
    );

    expect(diagnostics).toEqual([backendDiagnostic]);
    expect(diagnosticConsoleMessage(diagnostics[0])).toContain("Acao recomendada");
    expect(diagnosticConsoleMessage(diagnostics[0])).not.toContain("Build failed");
  });

  it("creates an import fallback with area, source path and suggested action", () => {
    const diagnostic = createFallbackDiagnostic({
      area: "import_gamemaker",
      sourcePath: "F:/Projects/Game Maker/Sample.gmez",
      technicalDetail: "GameMaker donor missing room definitions",
    });

    expect(diagnostic).toMatchObject({
      severity: "error",
      area: "import_gamemaker",
      source_path: "F:/Projects/Game Maker/Sample.gmez",
      blocking: true,
    });
    expect(diagnostic.user_message).toContain("Importacao GameMaker falhou");
    expect(diagnostic.suggested_action).toContain("Verifique");
  });

  it("build failure fallback includes error, impact and next action for SGDK", () => {
    const diagnostic = createFallbackDiagnostic({
      area: "build_sgdk",
      technicalDetail: "Toolchain SGDK nao encontrada.",
    });

    expect(diagnostic.user_message).toBeTruthy();
    expect(diagnostic.user_message.toLowerCase()).toContain("build");
    expect(diagnostic.suggested_action).toContain("SGDK");
    expect(diagnostic.technical_detail).toContain("Toolchain SGDK");
    expect(diagnostic.blocking).toBe(true);
    expect(diagnosticConsoleMessage(diagnostic)).toContain("Acao recomendada");
  });

  it("build failure fallback includes error, impact and next action for SNES", () => {
    const diagnostic = createFallbackDiagnostic({
      area: "build_snes",
      technicalDetail: "PVSnesLib toolchain missing.",
    });

    expect(diagnostic.user_message).toBeTruthy();
    expect(diagnostic.user_message.toLowerCase()).toContain("build");
    expect(diagnostic.suggested_action).toContain("PVSnesLib");
    expect(diagnostic.technical_detail).toContain("PVSnesLib");
    expect(diagnostic.blocking).toBe(true);
  });

  it("emulator failure fallback includes error, impact and next action", () => {
    const diagnostic = createFallbackDiagnostic({
      area: "libretro_emulation",
      sourcePath: "F:/Games/build/game.md",
      technicalDetail: "Nenhum core Libretro para Mega Drive foi encontrado.",
    });

    expect(diagnostic.user_message).toContain("ROM");
    expect(diagnostic.user_message).toContain("Libretro");
    expect(diagnostic.suggested_action).toContain("Libretro");
    expect(diagnostic.source_path).toContain("game.md");
    expect(diagnostic.blocking).toBe(true);
  });

  it("normalizeBuildDiagnostics creates fallback from log lines when no diagnostic array", () => {
    const diagnostics = normalizeBuildDiagnostics(
      {
        ok: false,
        rom_path: "",
        log: [
          { level: "error", message: "Falha ao compilar main.c: linha 42." },
        ],
      },
      "megadrive",
      "F:/Demo"
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].technical_detail).toContain("main.c");
    expect(diagnostics[0].area).toBe("build_sgdk");
    expect(diagnostics[0].blocking).toBe(true);
  });

  it("buildAreaForTarget maps correctly", () => {
    expect(buildAreaForTarget("megadrive")).toBe("build_sgdk");
    expect(buildAreaForTarget("snes")).toBe("build_snes");
  });
});
