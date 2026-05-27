import { useMemo } from "react";

import AssetPreview from "../common/AssetPreview";
import { classifyImageAssetInstantiation } from "../../core/assetInstantiation";
import type { Entity } from "../../core/ipc/sceneService";
import type { ProjectAssetEntry } from "../../core/ipc/toolsService";
import type { HwStatus } from "../../core/store/editorStore";
import {
  buildAssetBudgetSummary,
  classifyAssetBrowserAsset,
  type AssetReference,
} from "./assetBrowserModel";

type AssetBrowserSelectionCardProps = {
  activeProjectDir: string;
  asset: ProjectAssetEntry;
  matches: AssetReference[];
  projectSourceKind: string;
  sceneEntities: Pick<Entity, "entity_id" | "components">[];
  hwStatus: HwStatus | null;
  canInstantiate: boolean;
  instantiating: boolean;
  onFocus: () => void;
  onOpenArtStudio: () => void;
  onOpenAuthoringTarget: (match: AssetReference) => void;
  onOpenSource: (match: AssetReference) => void;
  onInstantiate: () => void;
};

function referenceRoleBadgeClass(roleLabel: string | null): string {
  switch (roleLabel) {
    case "Jogador":
      return "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]";
    case "Inimigo":
    case "Lutador":
    case "Projetil":
      return "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#f38ba8]";
    case "Apoio":
      return "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]";
    default:
      return "border-[#313244] bg-[#181825] text-[#cdd6f4]";
  }
}

function getAuthoringActionLabel(match: AssetReference | null): string | null {
  switch (match?.authoringSurface) {
    case "tilemap":
      return "Editar tilemap";
    case "logic":
      return "Objeto -> Logica";
    case "artstudio":
      return "Objeto -> Art";
    default:
      return null;
  }
}

export default function AssetBrowserSelectionCard({
  activeProjectDir,
  asset,
  matches,
  projectSourceKind,
  sceneEntities,
  hwStatus,
  canInstantiate,
  instantiating,
  onFocus,
  onOpenArtStudio,
  onOpenAuthoringTarget,
  onOpenSource,
  onInstantiate,
}: AssetBrowserSelectionCardProps) {
  const classification = useMemo(() => classifyAssetBrowserAsset(asset), [asset]);
  const budgetSummary = useMemo(
    () => buildAssetBudgetSummary(asset, matches, hwStatus),
    [asset, hwStatus, matches]
  );
  const instantiationDecision = useMemo(() => {
    if (asset.kind !== "image") {
      return null;
    }
    return classifyImageAssetInstantiation({
      asset,
      projectSourceKind,
      sceneEntities,
    });
  }, [asset, projectSourceKind, sceneEntities]);
  const primaryMatch = matches[0] ?? null;
  const authoringActionLabel = getAuthoringActionLabel(primaryMatch);

  return (
    <div
      data-testid="asset-browser-selection-card"
      className="flex flex-col gap-2 rounded border border-[#cba6f7]/30 bg-[#1e1e2e] p-3"
    >
      {asset.kind === "image" && (
        <div className="flex h-24 w-full min-w-0 items-center justify-center overflow-hidden rounded bg-black/20">
          <AssetPreview
            testId="asset-browser-selected-preview"
            fallbackTestId="asset-browser-selected-preview-fallback"
            absolutePath={asset.absolute_path}
            projectDir={activeProjectDir}
            relativePath={asset.relative_path}
            alt={asset.relative_path}
            imageClassName="max-h-24 max-w-full object-contain"
            fallbackClassName="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7f849c]"
            fallbackLabel="Preview indisponivel"
            pixelated
          />
        </div>
      )}
      {asset.kind !== "image" && (
        <div
          data-testid="asset-browser-safe-preview"
          className="flex h-20 w-full min-w-0 items-center justify-center rounded border border-[#313244] bg-[#11111b] px-3 text-center text-[10px] text-[#94a3b8]"
        >
          Preview seguro: {classification.typeLabel}. O browser nao executa nem interpreta este
          arquivo.
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate font-mono text-[10px] text-[#cdd6f4]" title={asset.relative_path}>
          {asset.relative_path}
        </p>
        <p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-[#6c7086]">
          {classification.typeLabel}
          {classification.generated ? " · generated" : ""}
        </p>
      </div>

      <div
        data-testid="asset-browser-budget-summary"
        className={`rounded border px-2.5 py-2 text-[10px] ${
          budgetSummary.status === "over"
            ? "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f2cdcd]"
            : "border-[#313244] bg-[#11111b] text-[#94a3b8]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-[#cdd6f4]">Orcamento rapido</span>
          <span className="rounded border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px]">
            VRAM {budgetSummary.vramLabel}
          </span>
          <span className="rounded border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px]">
            DMA {budgetSummary.dmaLabel}
          </span>
          <span className="rounded border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px]">
            Spr {budgetSummary.spriteLabel}
          </span>
          <span className="rounded border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px]">
            Pal {budgetSummary.paletteLabel}
          </span>
          {matches.length === 0 ? (
            <span className="rounded border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-1.5 py-0.5 font-semibold uppercase tracking-[0.12em] text-[#f9e2af]">
              Orfao
            </span>
          ) : null}
          {budgetSummary.status === "over" ? (
            <span className="rounded border border-[#f38ba8]/35 bg-[#f38ba8]/10 px-1.5 py-0.5 font-semibold uppercase tracking-[0.12em] text-[#f38ba8]">
              Over-budget
            </span>
          ) : null}
        </div>
        <p className="mt-1 leading-relaxed text-[#94a3b8]">{budgetSummary.reason}</p>
      </div>

      <div
        data-testid="asset-browser-reference-summary"
        className="rounded border border-[#313244] bg-[#11111b] px-2.5 py-2 text-[10px] text-[#94a3b8]"
      >
        {matches.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p>
              Usado por{" "}
              <span className="font-semibold text-[#cdd6f4]">{matches.length} item(ns)</span> na
              cena ativa.
            </p>
            <div className="flex flex-wrap gap-1">
              {matches.map((match) => (
                <span
                  key={`${match.entityId}-${match.label}`}
                  className="flex items-center gap-1 rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5 text-[9px] text-[#cdd6f4]"
                  title={match.reason ?? undefined}
                >
                  <span>{match.label}</span>
                  {match.roleLabel ? (
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] ${referenceRoleBadgeClass(match.roleLabel)}`}
                    >
                      {match.roleLabel}
                    </span>
                  ) : null}
                  {match.confidenceLabel ? (
                    <span className="rounded-full border border-[#313244] bg-[#11111b] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#94a3b8]">
                      {match.confidenceLabel}
                    </span>
                  ) : null}
                  {match.isSceneFocus ? (
                    <span className="rounded-full border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#f9e2af]">
                      Guia
                    </span>
                  ) : null}
                  {match.positionLabel ? (
                    <span className="rounded-full border border-[#313244] bg-[#11111b] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#94a3b8]">
                      {match.positionLabel}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
            {matches.some((match) => match.roleLabel) ? (
              <p className="text-[9px] text-[#7f849c]">
                Referencias importadas priorizadas por papel e foco da cena.
              </p>
            ) : null}
            <div className="flex flex-col gap-0.5 border-t border-[#1f2937] pt-1 text-[9px] text-[#7f849c]">
              {primaryMatch?.scenePath || primaryMatch?.sceneLabel ? (
                <p>
                  Cena:{" "}
                  <span className="font-mono text-[#cdd6f4]">
                    {primaryMatch.scenePath ?? primaryMatch.sceneLabel}
                  </span>
                </p>
              ) : null}
              {primaryMatch?.graphRef ? (
                <p>
                  Node: <span className="font-mono text-[#cdd6f4]">{primaryMatch.graphRef}</span>
                </p>
              ) : null}
            </div>
            {primaryMatch?.authoringSurface ? (
              <p className="text-[9px] text-[#94a3b8]">
                Fluxo pronto:{" "}
                <span className="font-semibold text-[#cdd6f4]">{authoringActionLabel}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <p>
            Asset orfao: ainda nao usado pela cena ativa. Esta selecao continua pronta para
            autoria a partir do browser.
          </p>
        )}
      </div>

      <div
        data-testid="asset-browser-instantiation-notice"
        className="rounded border border-[#89b4fa]/25 bg-[#89b4fa]/8 px-2.5 py-2 text-[10px]"
      >
        {instantiationDecision ? (
          <>
            <p className="font-semibold text-[#89b4fa]">{instantiationDecision.title}</p>
            <p className="mt-1 leading-relaxed text-[#cdd6f4]">{instantiationDecision.detail}</p>
            <p className="mt-2 text-[#94a3b8]">
              Tipo criado:{" "}
              <span className="font-semibold text-[#e2e8f0]">{instantiationDecision.entityLabel}</span>
              <span className="mx-1 text-[#45475a]">|</span>
              Motivo auditavel:{" "}
              <span className="font-mono text-[#bac2de]">{instantiationDecision.reason}</span>
            </p>
            <p className="mt-1 text-[9px] text-[#94a3b8]">
              Classe de decisao:{" "}
              <span className="font-mono text-[#cdd6f4]">{instantiationDecision.kind}</span>
            </p>
            <p className="mt-1 text-[#7f849c]">{instantiationDecision.nextStep}</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-[#89b4fa]">Item nao instanciavel no canvas</p>
            <p className="mt-1 leading-relaxed text-[#cdd6f4]">
              Este tipo de asset continua visivel no catalogo, mas a autoria no viewport esta
              reservada para sprites e tilemaps.
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onFocus}
          className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#cba6f7] hover:text-[#cba6f7]"
        >
          {matches.length > 0 ? "Focar na cena" : "Abrir contexto"}
        </button>
        {asset.kind === "image" ? (
          <button
            type="button"
            data-testid="asset-browser-open-artstudio"
            onClick={onOpenArtStudio}
            className="rounded border border-[#cba6f7]/40 bg-[#cba6f7]/10 px-2 py-1 text-[10px] font-semibold text-[#cba6f7] transition-colors hover:bg-[#cba6f7]/20"
          >
            Abrir no ArtStudio
          </button>
        ) : null}
        {primaryMatch && authoringActionLabel ? (
          <button
            type="button"
            data-testid="asset-browser-open-authoring-target"
            onClick={() => onOpenAuthoringTarget(primaryMatch)}
            className="rounded border border-[#94e2d5]/40 bg-[#94e2d5]/10 px-2 py-1 text-[10px] font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20"
          >
            {authoringActionLabel}
          </button>
        ) : null}
        {primaryMatch && primaryMatch.sourcePaths.length > 0 ? (
          <button
            type="button"
            data-testid="asset-browser-open-source"
            onClick={() => onOpenSource(primaryMatch)}
            className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-2 py-1 text-[10px] font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20"
          >
            Fonte real
          </button>
        ) : null}
        {asset.kind === "image" ? (
          <button
            type="button"
            onClick={onInstantiate}
            disabled={!canInstantiate || instantiating}
            className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {instantiating ? "Criando..." : "Instanciar"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
