import { describe, expect, it } from "vitest";
import {
  createFallbackDiagnostic,
  diagnosticConsoleMessage,
  normalizeBuildDiagnostics,
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
});
