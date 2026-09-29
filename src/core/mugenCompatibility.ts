// Relatorio de compatibilidade MUGEN (perfil mugen.character.v1, Experimental).
// Fonte: assets/mugen/<id>_import_report.json, gravado pelo importador do produto.
// Esta camada so le e apresenta; nao recalcula fidelidade.
import { listProjectAssets, readProjectAssetBytes } from "./ipc/toolsService";

export type MugenFidelity = "direct" | "approximate" | "manual" | "unsupported";
export type MugenCategoryStatus = MugenFidelity | "absent";

export interface MugenReportItem {
  item: string;
  source?: string | null;
  fidelity: MugenFidelity;
  reason?: string | null;
  consequence?: string | null;
  target?: unknown;
  transform?: string | null;
}

export interface MugenReportCategory {
  id: string;
  label: string;
  status: MugenCategoryStatus;
  counts: Record<MugenFidelity, number>;
  note: string;
  items: MugenReportItem[];
}

export interface MugenReportDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  source: string;
  message: string;
  action: string;
}

export interface MugenReportMetric {
  name: string;
  unit: string;
  value: number | null;
  origin: string;
  window: string;
  availability: string;
  budget: number | null;
  over_budget: boolean | null;
}

export interface MugenImportReport {
  schema: string;
  profile: string;
  maturity: string;
  summary?: {
    categories: MugenReportCategory[];
    totals: Record<MugenFidelity, number>;
    manual_bridges: number;
  };
  diagnostics?: MugenReportDiagnostic[];
  metrics?: MugenReportMetric[];
  [key: string]: unknown;
}

export interface LoadedMugenReport {
  id: string;
  reportPath: string;
  atlasPath: string;
  report: MugenImportReport;
  rawJson: string;
}

export const FIDELITY_ORDER: MugenFidelity[] = ["direct", "approximate", "manual", "unsupported"];

/** Rotulos para quem nao conhece MUGEN nem o hardware. */
export const FIDELITY_LABEL: Record<MugenCategoryStatus, string> = {
  direct: "Funciona igual",
  approximate: "Funciona com diferenca",
  manual: "Precisa de ajuste seu",
  unsupported: "Nao foi convertido",
  absent: "Nao existe neste pacote",
};

export const FIDELITY_HINT: Record<MugenCategoryStatus, string> = {
  direct: "Comporta-se como no original.",
  approximate: "Existe no jogo, mas com uma diferenca explicada abaixo.",
  manual: "Os dados foram trazidos, mas voce precisa ligar ou completar no editor.",
  unsupported: "Ficou de fora da conversao; o efeito original nao acontece.",
  absent: "O pacote nao tem este tipo de conteudo (ou ele nao se aplica).",
};

const REPORT_SUFFIX = "_import_report.json";

export function reportIdFromPath(relativePath: string): string | null {
  const match = /^assets\/mugen\/([^/]+)_import_report\.json$/.exec(relativePath);
  return match ? match[1] : null;
}

export function parseMugenReport(raw: string): MugenImportReport {
  const parsed = JSON.parse(raw) as MugenImportReport;
  if (!parsed || typeof parsed !== "object" || typeof parsed.schema !== "string") {
    throw new Error("Relatorio MUGEN sem schema.");
  }
  return parsed;
}

/** Frase curta com as perdas (a mesma informacao do aviso do backend). */
export function summarizeLosses(report: MugenImportReport): string {
  const totals = report.summary?.totals;
  if (!totals) {
    return "Relatorio sem resumo: abra o relatorio tecnico para ver os itens.";
  }
  return (
    `${totals.direct} funcionam igual, ${totals.approximate} com diferenca, ` +
    `${totals.manual} precisam de ajuste seu, ${totals.unsupported} nao convertidos` +
    ` (${report.summary?.manual_bridges ?? 0} pontes manuais no grafo)`
  );
}

/** Itens que nao funcionam igual, na ordem de gravidade, com o motivo e a consequencia. */
export function lossItems(report: MugenImportReport): Array<MugenReportItem & { category: string }> {
  const rank: Record<MugenFidelity, number> = { unsupported: 0, manual: 1, approximate: 2, direct: 3 };
  return (report.summary?.categories ?? [])
    .flatMap((category) =>
      category.items
        .filter((item) => item.fidelity !== "direct")
        .map((item) => ({ ...item, category: category.label }))
    )
    .sort((a, b) => rank[a.fidelity] - rank[b.fidelity]);
}

export async function loadMugenImportReports(projectDir: string): Promise<LoadedMugenReport[]> {
  const assets = await listProjectAssets(projectDir);
  const loaded: LoadedMugenReport[] = [];
  for (const asset of assets) {
    const id = reportIdFromPath(asset.relative_path);
    if (!id || !asset.relative_path.endsWith(REPORT_SUFFIX)) {
      continue;
    }
    const bytes = await readProjectAssetBytes(projectDir, asset.relative_path);
    const rawJson = new TextDecoder().decode(new Uint8Array(bytes));
    loaded.push({
      id,
      reportPath: asset.relative_path,
      atlasPath: `assets/sprites/mugen_${id}_atlas.png`,
      report: parseMugenReport(rawJson),
      rawJson,
    });
  }
  return loaded;
}
