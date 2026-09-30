import { useEffect, useState } from "react";

import Dialog from "./Dialog";
import MugenVisualComparison from "./MugenVisualComparison";
import { visualReviewOf } from "../../core/mugenReview";
import { readProjectAssetBytes } from "../../core/ipc/toolsService";
import {
  FIDELITY_HINT,
  FIDELITY_LABEL,
  FIDELITY_ORDER,
  lossItems,
  summarizeLosses,
  type LoadedMugenReport,
  type MugenCategoryStatus,
} from "../../core/mugenCompatibility";

const STATUS_STYLE: Record<MugenCategoryStatus, string> = {
  direct: "bg-[#a6e3a1]/15 text-[#a6e3a1] border-[#a6e3a1]/40",
  approximate: "bg-[#f9e2af]/15 text-[#f9e2af] border-[#f9e2af]/40",
  manual: "bg-[#89b4fa]/15 text-[#89b4fa] border-[#89b4fa]/40",
  unsupported: "bg-[#f38ba8]/15 text-[#f38ba8] border-[#f38ba8]/40",
  absent: "bg-[#313244] text-[#7f849c] border-[#45475a]",
};

function StatusBadge({ status, testId }: { status: MugenCategoryStatus; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-status={status}
      title={FIDELITY_HINT[status]}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[status]}`}
    >
      {FIDELITY_LABEL[status]}
    </span>
  );
}

function useAtlasUrl(projectDir: string | null, atlasPath: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!projectDir) {
      return undefined;
    }
    let revoked: string | null = null;
    let cancelled = false;
    readProjectAssetBytes(projectDir, atlasPath)
      .then((bytes) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        setUrl(revoked);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [projectDir, atlasPath]);
  return url;
}

function CharacterReport({ projectDir, loaded }: { projectDir: string | null; loaded: LoadedMugenReport }) {
  const atlasUrl = useAtlasUrl(projectDir, loaded.atlasPath);
  const summary = loaded.report.summary;
  const losses = lossItems(loaded.report);
  const diagnostics = loaded.report.diagnostics ?? [];
  const metrics = loaded.report.metrics ?? [];
  return (
    <section data-testid={`mugen-compat-character-${loaded.id}`} className="space-y-3">
      {typeof loaded.report.behavior_notice === "string" && <p className="text-xs text-[#f9e2af]">{loaded.report.behavior_notice}</p>}
      {visualReviewOf(loaded.report) && <MugenVisualComparison visual={visualReviewOf(loaded.report)!} />}
      <div className="flex items-start gap-3">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded border border-[#313244] bg-[#11111b]">
          {atlasUrl ? (
            <img
              data-testid="mugen-compat-character-preview"
              src={atlasUrl}
              alt={`Sprites convertidos de ${loaded.id}`}
              className="max-h-full max-w-full"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-[10px] text-[#7f849c]">sem preview</span>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] font-semibold text-[#cdd6f4]">
            Personagem <span className="font-mono">{loaded.id}</span>{" "}
            <span className="rounded bg-[#fab387]/15 px-1.5 py-0.5 text-[10px] text-[#fab387]">Experimental</span>
          </p>
          <p data-testid="mugen-compat-summary" className="text-[11px] leading-5 text-[#bac2de]">
            {summarizeLosses(loaded.report)}.
          </p>
          <div className="flex flex-wrap gap-1">
            {FIDELITY_ORDER.map((fidelity) => (
              <span
                key={fidelity}
                data-testid={`mugen-compat-total-${fidelity}`}
                data-count={summary?.totals[fidelity] ?? 0}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[fidelity]}`}
              >
                {FIDELITY_LABEL[fidelity]}: {summary?.totals[fidelity] ?? 0}
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="w-full border-collapse text-left text-[11px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.1em] text-[#7f849c]">
            <th className="py-1">Parte do personagem</th>
            <th className="py-1">Situacao</th>
            <th className="py-1">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {(summary?.categories ?? []).map((category) => (
            <tr
              key={category.id}
              data-testid={`mugen-compat-category-${category.id}`}
              data-status={category.status}
              className="border-t border-[#313244] align-top"
            >
              <td className="py-1.5 pr-2 text-[#cdd6f4]">{category.label}</td>
              <td className="py-1.5 pr-2">
                <StatusBadge status={category.status} />
              </td>
              <td className="py-1.5 text-[#a6adc8]">
                {category.items.length === 0
                  ? category.note
                  : FIDELITY_ORDER.filter((f) => category.counts[f] > 0)
                      .map((f) => `${category.counts[f]} ${FIDELITY_LABEL[f].toLowerCase()}`)
                      .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <p className="mb-1 text-[11px] font-semibold text-[#cdd6f4]">O que muda no jogo</p>
        {losses.length === 0 ? (
          <p data-testid="mugen-compat-no-losses" className="text-[11px] text-[#a6e3a1]">
            Nada: todos os itens convertidos funcionam igual ao original (dentro do perfil Experimental).
          </p>
        ) : (
          <ul data-testid="mugen-compat-losses" className="space-y-1.5">
            {losses.map((item) => (
              <li
                key={`${item.category}-${item.item}`}
                data-testid={`mugen-compat-loss-${item.item}`}
                data-fidelity={item.fidelity}
                className="rounded border border-[#313244] bg-[#181825] px-2 py-1.5 text-[11px] leading-5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={item.fidelity} />
                  <span className="text-[#7f849c]">{item.category}</span>
                  <span className="font-mono text-[#cdd6f4]">{item.item}</span>
                </div>
                {item.consequence ? <p className="text-[#f5e0dc]">No jogo: {item.consequence}.</p> : null}
                {item.reason ? <p className="text-[#a6adc8]">Motivo: {item.reason}.</p> : null}
                {item.source ? <p className="font-mono text-[10px] text-[#7f849c]">Origem: {item.source}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {diagnostics.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-[#cdd6f4]">Avisos do conversor e o que fazer</p>
          <ul data-testid="mugen-compat-diagnostics" className="space-y-1">
            {diagnostics.map((d, index) => (
              <li key={`${d.code}-${index}`} className="text-[11px] leading-5 text-[#a6adc8]">
                <span className="font-mono text-[#f9e2af]">{d.code}</span> ({d.source}): {d.message}{" "}
                <span className="text-[#cdd6f4]">Acao: {d.action}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details data-testid="mugen-compat-technical" className="rounded border border-[#313244] bg-[#11111b] p-2">
        <summary className="cursor-pointer text-[11px] text-[#cdd6f4]">
          Relatorio tecnico completo (auditoria) - {loaded.reportPath}
        </summary>
        {metrics.length > 0 ? (
          <table className="mt-2 w-full text-[10px] text-[#a6adc8]">
            <tbody>
              {metrics.map((m) => (
                <tr key={m.name} data-testid={`mugen-compat-metric-${m.name}`}>
                  <td className="pr-2 font-mono">{m.name}</td>
                  <td className="pr-2">{m.value === null ? "-" : `${m.value} ${m.unit}`}</td>
                  <td className="pr-2">{m.origin}</td>
                  <td>{m.value === null ? m.availability : m.window}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <pre
          data-testid="mugen-compat-raw"
          className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px] text-[#7f849c]"
        >
          {loaded.rawJson}
        </pre>
      </details>
    </section>
  );
}

export interface MugenCompatibilityPanelProps {
  open: boolean;
  projectDir: string | null;
  reports: LoadedMugenReport[];
  onClose: () => void;
}

export function MugenCompatibilityPanel({ open, projectDir, reports, onClose }: MugenCompatibilityPanelProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Compatibilidade da importacao MUGEN"
      description="O que veio do pacote MUGEN, o que mudou e o que ficou de fora. Conversao Experimental: nao e suporte geral a MUGEN."
      className="max-h-[85vh] w-[760px] max-w-[95vw] overflow-auto"
    >
      <div data-testid="mugen-compat-panel" className="space-y-5">
        {reports.length === 0 ? (
          <p className="text-[11px] text-[#a6adc8]">Nenhum relatorio MUGEN encontrado neste projeto.</p>
        ) : (
          reports.map((loaded) => <CharacterReport key={loaded.id} projectDir={projectDir} loaded={loaded} />)
        )}
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="mugen-compat-close"
            onClick={onClose}
            className="rounded border border-[#cba6f7]/50 bg-[#cba6f7]/15 px-3 py-1 text-[11px] text-[#cdd6f4] hover:bg-[#cba6f7]/25"
          >
            Entendi, continuar no projeto
          </button>
        </div>
      </div>
    </Dialog>
  );
}
