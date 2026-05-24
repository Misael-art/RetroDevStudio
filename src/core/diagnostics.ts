import type { BuildResult } from "./ipc/buildService";

export type DiagnosticSeverity = "info" | "warn" | "error";

export type DiagnosticArea =
  | "import_sgdk"
  | "import_gamemaker"
  | "import_mugen"
  | "import_ikemen"
  | "import_openbor"
  | "build_sgdk"
  | "build_snes"
  | "libretro_emulation"
  | "runtime_setup"
  | "hardware"
  | "project"
  | "codegen";

export interface ActionableDiagnostic {
  severity: DiagnosticSeverity;
  area: DiagnosticArea;
  source_path: string | null;
  line: number | null;
  column: number | null;
  user_message: string;
  technical_detail: string;
  suggested_action: string;
  blocking: boolean;
  evidence_path: string | null;
}

export const DIAGNOSTIC_AREA_LABELS: Record<DiagnosticArea, string> = {
  import_sgdk: "Import SGDK",
  import_gamemaker: "Import GameMaker",
  import_mugen: "Import MUGEN",
  import_ikemen: "Import Ikemen",
  import_openbor: "Import OpenBOR",
  build_sgdk: "Build SGDK",
  build_snes: "Build SNES",
  libretro_emulation: "Libretro",
  runtime_setup: "Runtime Setup",
  hardware: "Hardware",
  project: "Projeto",
  codegen: "CodeGen",
};

export const DIAGNOSTIC_SEVERITY_LABELS: Record<DiagnosticSeverity, string> = {
  info: "Info",
  warn: "Warn",
  error: "Error",
};

const IMPORT_AREAS = new Set<DiagnosticArea>([
  "import_sgdk",
  "import_gamemaker",
  "import_mugen",
  "import_ikemen",
  "import_openbor",
]);

export function diagnosticConsoleMessage(diagnostic: ActionableDiagnostic): string {
  return `${diagnostic.user_message} Acao recomendada: ${diagnostic.suggested_action}`;
}

export function diagnosticCopyText(diagnostic: ActionableDiagnostic): string {
  const location = [
    diagnostic.source_path ? `Arquivo: ${diagnostic.source_path}` : null,
    diagnostic.line ? `Linha: ${diagnostic.line}` : null,
    diagnostic.column ? `Coluna: ${diagnostic.column}` : null,
    diagnostic.evidence_path ? `Evidencia: ${diagnostic.evidence_path}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `[${DIAGNOSTIC_AREA_LABELS[diagnostic.area]} / ${DIAGNOSTIC_SEVERITY_LABELS[diagnostic.severity]}]`,
    diagnostic.user_message,
    `Acao recomendada: ${diagnostic.suggested_action}`,
    location,
    "Detalhe tecnico:",
    diagnostic.technical_detail,
  ]
    .filter((part) => part && part.length > 0)
    .join("\n");
}

export function importAreaForProfile(profileId: string): DiagnosticArea {
  switch (profileId) {
    case "gamemaker":
      return "import_gamemaker";
    case "mugen":
      return "import_mugen";
    case "ikemen_go":
      return "import_ikemen";
    case "openbor":
      return "import_openbor";
    default:
      return "project";
  }
}

export function buildAreaForTarget(target: string): DiagnosticArea {
  return target === "snes" ? "build_snes" : "build_sgdk";
}

export function createFallbackDiagnostic(input: {
  area: DiagnosticArea;
  technicalDetail: string;
  sourcePath?: string | null;
  evidencePath?: string | null;
  severity?: DiagnosticSeverity;
  blocking?: boolean;
  suggestedAction?: string;
}): ActionableDiagnostic {
  const severity = input.severity ?? "error";
  const blocking = input.blocking ?? severity === "error";
  const technicalDetail = input.technicalDetail || "Erro nao detalhado.";
  const sourcePath = input.sourcePath ?? extractQuotedPath(technicalDetail);
  const { line, column } = parseLineColumn(technicalDetail);

  return {
    severity,
    area: input.area,
    source_path: sourcePath ?? null,
    line,
    column,
    user_message: fallbackUserMessage(input.area, sourcePath, technicalDetail),
    technical_detail: technicalDetail,
    suggested_action: input.suggestedAction ?? fallbackSuggestedAction(input.area),
    blocking,
    evidence_path: input.evidencePath ?? null,
  };
}

export function normalizeBuildDiagnostics(
  result: BuildResult,
  target: "megadrive" | "snes" | string,
  projectDir: string
): ActionableDiagnostic[] {
  if (result.diagnostics && result.diagnostics.length > 0) {
    return result.diagnostics;
  }

  const area = buildAreaForTarget(target);
  const errorLines = result.log
    .filter((line) => line.level === "error")
    .map((line) => line.message.trim())
    .filter(Boolean);

  if (errorLines.length === 0) {
    return [
      createFallbackDiagnostic({
        area,
        technicalDetail:
          "Build falhou sem linhas de erro estruturadas no log; verifique o historico completo do Console.",
        evidencePath: buildEvidencePath(projectDir, target),
      }),
    ];
  }

  return errorLines.map((technicalDetail) =>
    createFallbackDiagnostic({
      area,
      technicalDetail,
      sourcePath: extractQuotedPath(technicalDetail),
      evidencePath: buildEvidencePath(projectDir, target),
    })
  );
}

function fallbackUserMessage(
  area: DiagnosticArea,
  sourcePath: string | null | undefined,
  technicalDetail: string
): string {
  const lower = technicalDetail.toLowerCase();
  if (area === "build_sgdk" || area === "build_snes") {
    if (lower.includes("asset referenciado nao encontrado")) {
      return `Build falhou porque o asset ${sourcePath ?? "referenciado"} nao foi encontrado.`;
    }
    if (lower.includes("toolchain")) {
      return `Build falhou porque uma toolchain obrigatoria nao esta disponivel.`;
    }
    return "Build falhou durante a emissao, staging ou execucao da toolchain.";
  }

  if (area === "libretro_emulation") {
    return "Emulacao falhou porque a ROM ou o core Libretro nao pode ser carregado.";
  }

  if (area === "runtime_setup") {
    return "Runtime Setup falhou ao preparar uma dependencia oficial.";
  }

  if (IMPORT_AREAS.has(area)) {
    return `${importFailureLabel(area)} falhou porque a origem nao pode ser processada.`;
  }

  if (area === "hardware") {
    return "Build foi bloqueado por violacoes de hardware do target.";
  }

  return "Operacao falhou e precisa de acao antes de continuar.";
}

function importFailureLabel(area: DiagnosticArea): string {
  switch (area) {
    case "import_sgdk":
      return "Importacao SGDK";
    case "import_gamemaker":
      return "Importacao GameMaker";
    case "import_mugen":
      return "Importacao MUGEN";
    case "import_ikemen":
      return "Importacao Ikemen";
    case "import_openbor":
      return "Importacao OpenBOR";
    default:
      return "Importacao";
  }
}

function fallbackSuggestedAction(area: DiagnosticArea): string {
  if (area === "build_sgdk") {
    return "Abra o detalhe tecnico, corrija o asset/codigo indicado ou reinstale SGDK pelo Runtime Setup.";
  }
  if (area === "build_snes") {
    return "Abra o detalhe tecnico, corrija o asset/codigo indicado ou reinstale PVSnesLib pelo Runtime Setup.";
  }
  if (area === "runtime_setup") {
    return "Abra Runtime Setup, revise o item indicado e tente reinstalar a dependencia oficial.";
  }
  if (area === "libretro_emulation") {
    return "Verifique se a ROM e valida para o target e instale o core Libretro correspondente.";
  }
  if (IMPORT_AREAS.has(area)) {
    return "Verifique se a pasta doadora contem os arquivos raiz esperados e tente importar novamente.";
  }
  if (area === "hardware") {
    return "Reduza os recursos marcados como fatais e rode a validacao novamente.";
  }
  return "Revise o detalhe tecnico, corrija a causa indicada e tente novamente.";
}

function extractQuotedPath(message: string): string | null {
  const match = message.match(/'([^']+)'/);
  return match?.[1] ?? null;
}

function parseLineColumn(message: string): { line: number | null; column: number | null } {
  const match = message.match(/:(\d+):(\d+):/);
  return {
    line: match ? Number.parseInt(match[1], 10) : null,
    column: match ? Number.parseInt(match[2], 10) : null,
  };
}

function buildEvidencePath(projectDir: string, target: string): string | null {
  if (!projectDir) {
    return null;
  }
  return `${projectDir.replace(/[\\/]$/, "")}/build/${target === "snes" ? "snes" : "megadrive"}`;
}
