import { useEffect, useState } from "react";

import { inspectAssetQuality } from "../../core/ipc/projectCapabilityService";
import { capabilityStatusLabel, capabilityTone, type AssetQualityReport } from "../../core/projectCapability";
import { useEditorStore } from "../../core/store/editorStore";

interface AssetQualityPanelProps {
  assetPath?: string | null;
  report?: AssetQualityReport | null;
}

const TONE_CLASS = {
  ok: "text-[#a6e3a1]",
  warn: "text-[#f9e2af]",
  block: "text-[#f38ba8]",
  muted: "text-[#7f849c]",
} as const;

export default function AssetQualityPanel({ assetPath, report: injectedReport }: AssetQualityPanelProps) {
  const activeProjectDir = useEditorStore((state) => state.activeProjectDir);
  const selectedEntity = useEditorStore((state) =>
    state.selectedEntityId
      ? state.activeScene?.entities.find((entity) => entity.entity_id === state.selectedEntityId) ?? null
      : null
  );
  const logMessage = useEditorStore((state) => state.logMessage);
  const [report, setReport] = useState<AssetQualityReport | null>(injectedReport ?? null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const resolvedAsset = assetPath ?? selectedEntity?.components.sprite?.asset ?? null;

  useEffect(() => {
    setReport(injectedReport ?? null);
  }, [injectedReport]);

  async function refresh() {
    if (!activeProjectDir) {
      logMessage("warn", "[ArtStudio] Abra um projeto antes de inspecionar Qualidade ROM.");
      return;
    }
    setLoading(true);
    try {
      const next = await inspectAssetQuality(activeProjectDir, resolvedAsset);
      setReport(next);
      logMessage("info", "[ArtStudio] Qualidade ROM atualizada.");
    } catch (error) {
      logMessage("error", `[ArtStudio] Qualidade ROM falhou: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  const firstAsset = report?.assets[0] ?? null;
  const tone = capabilityTone(report?.axis.status ?? "not_instrumented");

  return (
    <div className="rounded border border-[#313244] bg-[#11111b] p-3" data-testid="asset-quality-panel">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">Qualidade ROM</p>
          <p className="truncate font-mono text-[9px] text-[#6c7086]">{resolvedAsset ?? "asset nao selecionado"}</p>
        </div>
        <span className={`text-[9px] font-semibold uppercase ${TONE_CLASS[tone]}`}>
          {capabilityStatusLabel(report?.axis.status ?? "not inspected")}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !activeProjectDir}
          className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1 text-[9px] font-semibold text-[#89b4fa] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "..." : "Atualizar"}
        </button>
      </div>

      {!firstAsset ? (
        <p className="mt-2 text-[10px] text-[#7f849c]" data-testid="asset-quality-empty">
          Sem diagnostico de asset.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label="Paleta" status={firstAsset.palette.status} detail={firstAsset.palette.detail} />
            <Metric
              label="Indice 0"
              status={firstAsset.index_zero_transparency.status}
              detail={firstAsset.index_zero_transparency.detail}
            />
            <Metric label="Tiles" status={firstAsset.tile_efficiency.status} detail={firstAsset.tile_efficiency.detail} />
            <Metric
              label="Duplicados"
              status={firstAsset.duplicate_tiles.duplicate_count > 0 ? "warning" : "ok"}
              detail={`${firstAsset.duplicate_tiles.duplicate_count}`}
            />
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 text-[9px] font-semibold text-[#89b4fa]"
          >
            {expanded ? "Detalhes compactos" : "Ver detalhes"}
          </button>
          {expanded ? (
            <div className="mt-2 space-y-2" data-testid="asset-quality-details">
              {firstAsset.blockers.map((blocker) => (
                <p key={blocker} className="text-[9px] leading-snug text-[#f38ba8]">{blocker}</p>
              ))}
              {firstAsset.warnings.map((warning) => (
                <p key={warning} className="text-[9px] leading-snug text-[#f9e2af]">{warning}</p>
              ))}
              {firstAsset.source_to_rom_map.length > 0 ? (
                <p className="break-all text-[9px] text-[#7f849c]">
                  ROM map: <span className="font-mono text-[#cdd6f4]">{firstAsset.source_to_rom_map.join(", ")}</span>
                </p>
              ) : null}
              {firstAsset.next_actions[0] ? (
                <p className="text-[9px] leading-snug text-[#7f849c]">{firstAsset.next_actions[0]}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Metric({ label, status, detail }: { label: string; status: string; detail: string }) {
  const tone = capabilityTone(status);
  return (
    <div className="rounded border border-[#313244] bg-[#181825] p-2">
      <div className="text-[8px] uppercase text-[#45475a]">{label}</div>
      <div className={`text-[10px] font-semibold uppercase ${TONE_CLASS[tone]}`}>{capabilityStatusLabel(status)}</div>
      <div className="truncate text-[8px] text-[#7f849c]" title={detail}>{detail}</div>
    </div>
  );
}
