import { useEffect, useMemo, useState } from "react";

import { useEditorStore } from "../../core/store/editorStore";
import Button from "../common/Button";
import Icon from "../common/Icon";
import Input from "../common/Input";
import Select from "../common/Select";
import Tabs from "../common/Tabs";
import {
  type ReverseAnnotation,
  type ReverseExplorerResult,
  type RomAnalysisManifest,
  reverseExplorerRead,
  romAnalyzeWithEmulatorTrace,
  romDisassemble,
  romSaveAnnotations,
} from "../../core/ipc/toolsService";
import { ExperimentalNotice } from "./ToolNotices";
import ToolPathField from "./ToolPathField";

type ReverseView =
  | "map"
  | "hex"
  | "graphics"
  | "text"
  | "audio"
  | "code"
  | "projection";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseHexInput(value: string): number | null {
  const normalized = value.trim().replace(/^0x/i, "");
  if (normalized.length === 0) {
    return 0;
  }
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    return null;
  }
  return Number.parseInt(normalized, 16);
}

function formatHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

export default function ReverseWorkspace() {
  const { activeTarget, logMessage } = useEditorStore();
  const [romPath, setRomPath] = useState("");
  const [activeView, setActiveView] = useState<ReverseView>("map");
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<RomAnalysisManifest | null>(null);
  const [hexResult, setHexResult] = useState<ReverseExplorerResult | null>(null);
  const [codeResult, setCodeResult] =
    useState<Awaited<ReturnType<typeof romDisassemble>> | null>(null);
  const [offsetHex, setOffsetHex] = useState("000000");
  const [lengthHex, setLengthHex] = useState("0200");
  const [annotationKind, setAnnotationKind] = useState("label");
  const [annotationEndHex, setAnnotationEndHex] = useState("");
  const [annotationLabel, setAnnotationLabel] = useState("");
  const [annotationComment, setAnnotationComment] = useState("");
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifest) {
      return;
    }
    const entry = manifest.code_regions[0]?.start ?? manifest.header.entry_point ?? 0;
    setOffsetHex(entry.toString(16).toUpperCase().padStart(6, "0"));
  }, [manifest]);

  async function inspectHex(
    nextManifest?: RomAnalysisManifest | null,
    nextOffsetHex?: string
  ) {
    const activeManifest = nextManifest ?? manifest;
    if (!romPath || !activeManifest) {
      return;
    }
    const offset = parseHexInput(nextOffsetHex ?? offsetHex);
    const length = parseHexInput(lengthHex);
    if (offset === null || length === null) {
      logMessage("warn", "[Reverse] Offset e length devem estar em hexadecimal.");
      return;
    }
    const target =
      activeManifest.target === "snes"
        ? "snes"
        : ("megadrive" as "megadrive" | "snes");
    setWorkspaceError(null);
    try {
      const [hexInspection, disassembly] = await Promise.all([
        reverseExplorerRead(romPath, target, offset, length),
        romDisassemble(romPath, offset, length),
      ]);
      setHexResult(hexInspection);
      setCodeResult(disassembly);
    } catch (error) {
      const message = describeError(error);
      setWorkspaceError(`Falha ao atualizar Hex/Code: ${message}`);
      logMessage("error", `[Reverse] Falha ao atualizar Hex/Code: ${message}`);
    }
  }

  async function analyze() {
    if (!romPath) {
      logMessage("warn", "[Reverse] Informe o caminho da ROM.");
      return;
    }

    setBusy(true);
    setWorkspaceError(null);
    try {
      const nextManifest = await romAnalyzeWithEmulatorTrace(romPath);
      setManifest(nextManifest);
      setActiveView("map");
      logMessage(
        "success",
        `[Reverse] Manifesto ${nextManifest.target} carregado (${nextManifest.detected_format}, ${nextManifest.total_size} bytes).`
      );
      const nextOffset = (
        nextManifest.code_regions[0]?.start ??
        nextManifest.header.entry_point ??
        0
      )
        .toString(16)
        .toUpperCase()
        .padStart(6, "0");
      setOffsetHex(nextOffset);
      await inspectHex(nextManifest, nextOffset);
    } catch (error) {
      const message = describeError(error);
      setWorkspaceError(`Falha ao analisar a ROM: ${message}`);
      logMessage("error", `[Reverse] Erro inesperado: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveAnnotation() {
    if (!manifest || !romPath) {
      logMessage("warn", "[Reverse] Analise uma ROM antes de salvar anotacoes.");
      return;
    }

    const start = parseHexInput(offsetHex);
    const end = annotationEndHex.trim() ? parseHexInput(annotationEndHex) : null;
    if (start === null || (annotationEndHex.trim() && end === null)) {
      logMessage("warn", "[Reverse] Inicio/fim da anotacao devem estar em hexadecimal.");
      return;
    }

    const label = annotationLabel.trim();
    const comment = annotationComment.trim();
    if (!label && !comment) {
      logMessage("warn", "[Reverse] Informe pelo menos um label ou comentario.");
      return;
    }

    const nextAnnotation: ReverseAnnotation = {
      kind: annotationKind,
      start,
      end,
      label: label || `${annotationKind}_${formatHex(start, 6)}`,
      comment,
    };
    const nextAnnotations = [...manifest.annotations, nextAnnotation];

    setAnnotationBusy(true);
    setWorkspaceError(null);
    try {
      await romSaveAnnotations(romPath, nextAnnotations);
      setManifest({
        ...manifest,
        annotations: nextAnnotations,
      });
      setAnnotationEndHex("");
      setAnnotationLabel("");
      setAnnotationComment("");
      logMessage(
        "success",
        `[Reverse] Anotacao ${nextAnnotation.kind} salva em ${formatHex(nextAnnotation.start, 6)}.`
      );
    } catch (error) {
      const message = describeError(error);
      setWorkspaceError(`Falha ao salvar a anotação: ${message}`);
      logMessage("error", `[Reverse] Falha ao salvar anotacao: ${message}`);
    } finally {
      setAnnotationBusy(false);
    }
  }

  const summaryChips = manifest?.special_chips.length
    ? manifest.special_chips.join(", ")
    : "nenhum";
  const traceAvailable = manifest?.trace.available ?? false;
  const traceStatusLabel = traceAvailable
    ? "Overlay ativo"
    : manifest?.trace.note
      ? "Sem overlay ao vivo"
      : "Indisponivel";
  const traceBadgeClassName = traceAvailable
    ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/10 text-[#a6e3a1]"
    : "border-[#fab387]/35 bg-[#fab387]/10 text-[#fab387]";
  const codeRegion = manifest?.code_regions[0] ?? null;
  const xrefs = useMemo(
    () => manifest?.code_regions.flatMap((region) => region.xrefs) ?? [],
    [manifest]
  );
  const callGraph = manifest?.call_graph ?? [];
  const executedFunctionAddresses = useMemo(() => {
    const addresses = new Set<number>();
    for (const region of manifest?.code_regions ?? []) {
      for (const fnCandidate of region.functions) {
        if (fnCandidate.executed) {
          addresses.add(fnCandidate.address);
        }
      }
    }
    return addresses;
  }, [manifest]);
  const prioritizedFunctions = useMemo(
    () =>
      (codeRegion?.functions ?? [])
        .map((fnCandidate, index) => ({ fnCandidate, index }))
        .sort((left, right) => {
          const tracePriority =
            Number(right.fnCandidate.executed) - Number(left.fnCandidate.executed);
          if (tracePriority !== 0) {
            return tracePriority;
          }
          return left.index - right.index;
        }),
    [codeRegion]
  );
  const prioritizedXrefs = useMemo(
    () =>
      xrefs
        .map((xref, index) => ({
          xref,
          index,
          touchedByTrace:
            traceAvailable &&
            (executedFunctionAddresses.has(xref.from) ||
              executedFunctionAddresses.has(xref.to)),
        }))
        .sort((left, right) => {
          const tracePriority =
            Number(right.touchedByTrace) - Number(left.touchedByTrace);
          if (tracePriority !== 0) {
            return tracePriority;
          }
          return left.index - right.index;
        }),
    [executedFunctionAddresses, traceAvailable, xrefs]
  );
  const prioritizedCallGraph = useMemo(
    () =>
      callGraph
        .map((edge, index) => ({
          edge,
          index,
          touchedByTrace:
            traceAvailable &&
            (executedFunctionAddresses.has(edge.from) ||
              executedFunctionAddresses.has(edge.to)),
        }))
        .sort((left, right) => {
          const tracePriority =
            Number(right.touchedByTrace) - Number(left.touchedByTrace);
          if (tracePriority !== 0) {
            return tracePriority;
          }
          return left.index - right.index;
        }),
    [callGraph, executedFunctionAddresses, traceAvailable]
  );
  const executedFunctionCount = prioritizedFunctions.filter(
    ({ fnCandidate }) => fnCandidate.executed
  ).length;
  const touchedXrefCount = prioritizedXrefs.filter(
    ({ touchedByTrace }) => touchedByTrace
  ).length;
  const touchedCallGraphCount = prioritizedCallGraph.filter(
    ({ touchedByTrace }) => touchedByTrace
  ).length;
  const reverseReadinessLabel = !manifest
    ? "Analise uma ROM para liberar mapa estrutural, leituras Hex/Code e anotacoes."
    : activeView !== "code"
      ? "Abra Code para priorizar funcoes/xrefs e registrar anotacoes persistidas."
      : manifest.annotations.length === 0
        ? "Salve ao menos uma anotacao para transformar achados em contexto persistido."
        : !manifest.projection_status.supported
          ? "Projection continua informativa nesta wave; use anotacoes como saida persistida."
          : "Projection suportada para esta ROM; revise hints antes de gerar qualquer saida.";
  const viewTabs: { id: ReverseView; label: string }[] = [
    { id: "map", label: "ROM Map" },
    { id: "hex", label: "Hex" },
    { id: "graphics", label: "Graphics" },
    { id: "text", label: "Text" },
    { id: "audio", label: "Audio" },
    { id: "code", label: "Code" },
    { id: "projection", label: "Projection" },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <ExperimentalNotice summary="Workspace reverso canônico. O manifesto, a segmentação e a disassembly inicial já são reais; trace, projeção .rds e recuperação avançada de lógica seguem em hardening." />

      <div
        data-testid="reverse-readiness"
        className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3 text-xs text-[var(--rds-text-secondary)]"
      >
        <p className="flex items-center gap-2 font-semibold text-[var(--rds-status-warning)]">
          <Icon name="warning-triangle" size={15} />
          Readiness Experimental
        </p>
        <p className="mt-1 leading-5">
          O mapa estrutural e a leitura Hex/Code são evidências locais. Trace depende de uma sessão compatível;
          Projection continua informativa e não reconstrói gameplay nem prova equivalência 1:1.
        </p>
      </div>

      <ToolPathField
        label="ROM alvo"
        value={romPath}
        set={setRomPath}
        placeholder="/roms/game.md"
        extensions={["md", "bin", "gen", "smc", "sfc", "fig"]}
        helperText="Use apenas uma ROM própria (BYOR). A análise não altera o arquivo original."
      />

      {workspaceError ? (
        <div
          data-testid="reverse-workspace-error"
          role="alert"
          className="rounded border border-[var(--rds-status-error)] bg-[color-mix(in_srgb,var(--rds-status-error)_10%,transparent)] p-3 text-xs text-[var(--rds-text-primary)]"
        >
          <p className="font-semibold text-[var(--rds-status-error)]">A operação não foi concluída.</p>
          <p className="mt-1 text-[var(--rds-text-secondary)]">
            {workspaceError}. Revise o caminho e tente novamente; o Console mantém os detalhes técnicos.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Input
            fieldClassName="w-28"
            controlSize="sm"
            label="Offset hexadecimal"
            type="text"
            value={offsetHex}
            onChange={(event) => setOffsetHex(event.target.value)}
            className="text-right font-mono"
          />
        <Input
            fieldClassName="w-28"
            controlSize="sm"
            label="Tamanho hexadecimal"
            type="text"
            value={lengthHex}
            onChange={(event) => setLengthHex(event.target.value)}
            className="text-right font-mono"
          />
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          loadingLabel="Analisando ROM"
          iconStart={<Icon name="search" size={15} />}
          onClick={() => void analyze()}
          disabled={busy}
        >
          {busy ? "Analisando..." : "Analisar ROM"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconStart={<Icon name="refresh" size={15} />}
          onClick={() => void inspectHex()}
          disabled={!manifest || busy}
        >
          Atualizar Hex/Code
        </Button>
        <span className="rounded-full border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-text-muted)]">
          Target sugerido: {manifest?.target ?? activeTarget}
        </span>
      </div>

      {manifest && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
            <div className="rounded border border-[#313244] bg-[#11111b] p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                Formato
              </div>
              <div className="mt-2 text-sm font-semibold text-[#e5e7eb]">
                {manifest.target} · {manifest.detected_format}
              </div>
              <div className="mt-2 text-[10px] text-[#94a3b8]">
                Header offset removido: {manifest.stripped_header_bytes} byte(s)
              </div>
            </div>
            <div className="rounded border border-[#313244] bg-[#11111b] p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                Identidade
              </div>
              <div className="mt-2 text-sm font-semibold text-[#e5e7eb]">
                {manifest.header.internal_title || "(sem titulo)"}
              </div>
              <div className="mt-2 text-[10px] text-[#94a3b8]">
                Mapper: {manifest.mapper} · Chips: {summaryChips}
              </div>
            </div>
            <div className="rounded border border-[#313244] bg-[#11111b] p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                Hashes
              </div>
              <div className="mt-2 text-[10px] font-mono text-[#cdd6f4]">
                CRC32 {manifest.hashes.crc32}
              </div>
              <div className="mt-1 text-[10px] font-mono text-[#94a3b8]">
                {manifest.hashes.sha1}
              </div>
            </div>
            <div className="rounded border border-[#313244] bg-[#11111b] p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                Sinais
              </div>
              <div className="mt-2 text-[10px] text-[#94a3b8]">
                GFX {manifest.graphics_regions.length} · TXT {manifest.text_regions.length} ·
                {" "}AUD {manifest.audio_regions.length}
              </div>
              <div className="mt-1 text-[10px] text-[#94a3b8]">
                CODE {manifest.code_regions.length} · XREF{" "}
                {manifest.code_regions.reduce((sum, region) => sum + region.xrefs.length, 0)}
              </div>
            </div>
          </div>

          <div
            data-testid="reverse-trace-status-card"
            className="rounded border border-[#313244] bg-[#11111b] p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                  Trace dinamico
                </div>
                <div className="mt-2 text-sm font-semibold text-[#e5e7eb]">
                  {traceStatusLabel}
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${traceBadgeClassName}`}
              >
                {traceAvailable
                  ? `${manifest.trace.executed_regions.length} regiao(oes) executada(s)`
                  : "Sessao estendida opcional"}
              </span>
            </div>
            <div className="mt-2 text-[10px] text-[#94a3b8]">
              {manifest.trace.note ||
                "Nenhuma sessao do emulador compativel foi usada nesta analise."}
            </div>
          </div>

          <div
            data-testid="reverse-operational-plan"
            className="rounded border border-[#313244] bg-[#11111b] p-3"
          >
            <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
              Trilha operacional
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[10px]">
              <dt className="text-[#64748b]">Leitura util hoje</dt>
              <dd className="text-[#cdd6f4]">
                ROM Map, Hex, Code e heuristicas de Graphics/Text/Audio.
              </dd>
              <dt className="text-[#64748b]">Trace</dt>
              <dd className="text-[#cdd6f4]">
                {traceAvailable
                  ? "Sessao com overlay ativo para priorizar navegacao real."
                  : "Leitura estatica; overlay ao vivo indisponivel nesta sessao."}
              </dd>
              <dt className="text-[#64748b]">Persistencia</dt>
              <dd className="text-[#cdd6f4]">
                {manifest.annotations.length} anotacao(oes) salva(s) para esta ROM.
              </dd>
              <dt className="text-[#64748b]">Projection</dt>
              <dd className="text-[#cdd6f4]">
                {manifest.projection_status.status} ·{" "}
                {manifest.projection_status.supported ? "suportada" : "somente informativa"}
              </dd>
              <dt className="text-[#64748b]">Proximo passo</dt>
              <dd className="text-[#cdd6f4]">{reverseReadinessLabel}</dd>
            </dl>
          </div>

          <div className="overflow-x-auto">
            <Tabs
              ariaLabel="Visões do Reverse Workspace"
              tabs={viewTabs}
              activeTab={activeView}
              onTabChange={(id) => setActiveView(id as ReverseView)}
              className="min-w-max"
            />
          </div>

          <div
            role="tabpanel"
            aria-labelledby={`rds-tab-${activeView}`}
            className="min-w-0"
          >
          {activeView === "map" && (
            <div className="rounded border border-[#313244] bg-[#11111b] p-3">
              <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                Segmentacao estrutural
              </div>
              <div className="space-y-2">
                {manifest.segments.slice(0, 24).map((segment) => {
                  const widthPct = Math.max(
                    3,
                    Math.round(
                      ((segment.end - segment.start) / Math.max(manifest.total_size, 1)) * 100
                    )
                  );
                  return (
                    <div key={`${segment.start}-${segment.end}`} className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-mono text-[#cdd6f4]">
                          {segment.label} · {segment.kind}
                        </span>
                        <span className="text-[#7f849c]">
                          {formatHex(segment.start, 6)} - {formatHex(segment.end, 6)}
                        </span>
                      </div>
                      <div className="h-2 rounded bg-[#1e1e2e]">
                        <div
                          className="h-2 rounded bg-[#89b4fa]"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeView === "hex" && (
            <div className="rounded border border-[#313244] bg-[#11111b]">
              {!hexResult?.ok ? (
                <div className="p-3 text-[10px] text-[#7f849c]">
                  Use "Atualizar Hex/Code" para carregar a janela atual do manifesto.
                </div>
              ) : (
                <div className="max-h-96 overflow-auto">
                  {hexResult.rows.map((row) => (
                    <div
                      key={row.offset}
                      className="grid grid-cols-[88px_minmax(0,1fr)_140px_minmax(0,1fr)] gap-3 border-b border-[#1e1e2e] px-3 py-2 text-[10px]"
                    >
                      <span className="font-mono text-[#89b4fa]">{formatHex(row.offset, 6)}</span>
                      <span className="font-mono text-[#cdd6f4]">
                        {row.bytes.map((value) => formatHex(value)).join(" ")}
                      </span>
                      <span className="font-mono text-[#7f849c]">{row.ascii}</span>
                      <span className="leading-tight text-[#f9e2af]">{row.annotation}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeView === "graphics" && (
            <div className="space-y-2 rounded border border-[#313244] bg-[#11111b] p-3">
              {manifest.graphics_regions.length === 0 ? (
                <p className="text-[10px] text-[#7f849c]">
                  Nenhuma regiao grafica candidata detectada.
                </p>
              ) : (
                manifest.graphics_regions.map((candidate) => (
                  <div key={candidate.id} className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#e5e7eb]">
                        {candidate.id} · {candidate.kind}
                      </div>
                      <div className="text-[10px] text-[#7f849c]">
                        {formatHex(candidate.start, 6)} - {formatHex(candidate.end, 6)}
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-[#94a3b8]">
                      {candidate.bpp}bpp · {candidate.tile_count} tiles · paleta{" "}
                      {candidate.palette_slot ?? "?"} · conf. {candidate.confidence}%
                    </div>
                    <div className="mt-1 text-[10px] text-[#7f849c]">{candidate.note}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeView === "text" && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-3">
              <div className="space-y-2 rounded border border-[#313244] bg-[#11111b] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                  Strings
                </div>
                {manifest.text_regions.length === 0 ? (
                  <p className="text-[10px] text-[#7f849c]">
                    Nenhuma string candidata detectada.
                  </p>
                ) : (
                  manifest.text_regions.map((candidate) => (
                    <div key={candidate.id} className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3">
                      <div className="flex items-center justify-between gap-3 text-[10px]">
                        <span className="font-mono text-[#cdd6f4]">{candidate.id}</span>
                        <span className="text-[#7f849c]">
                          {formatHex(candidate.start, 6)} - {formatHex(candidate.end, 6)}
                        </span>
                      </div>
                      <div className="mt-2 text-[10px] text-[#94a3b8]">
                        {candidate.encoding} · conf. {candidate.confidence}%
                      </div>
                      <div className="mt-2 rounded bg-[#11111b] px-2 py-2 font-mono text-[10px] text-[#e5e7eb]">
                        {candidate.preview}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 rounded border border-[#313244] bg-[#11111b] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                  Pointer tables
                </div>
                {manifest.pointer_tables.length === 0 ? (
                  <p className="text-[10px] text-[#7f849c]">
                    Nenhuma pointer table candidata detectada.
                  </p>
                ) : (
                  manifest.pointer_tables.map((table) => (
                    <div key={`${table.start}-${table.end}`} className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3 text-[10px]">
                      <div className="font-mono text-[#cdd6f4]">
                        {formatHex(table.start, 6)} - {formatHex(table.end, 6)}
                      </div>
                      <div className="mt-1 text-[#94a3b8]">
                        {table.encoding} · entrada {table.entry_size} byte(s) · conf.{" "}
                        {table.confidence}%
                      </div>
                      <div className="mt-2 text-[#7f849c]">
                        {table.destinations.map((value) => formatHex(value, 6)).join(", ")}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeView === "audio" && (
            <div className="space-y-2 rounded border border-[#313244] bg-[#11111b] p-3">
              {manifest.audio_regions.length === 0 ? (
                <p className="text-[10px] text-[#7f849c]">
                  Nenhum candidato de audio detectado nesta ROM.
                </p>
              ) : (
                manifest.audio_regions.map((candidate) => (
                  <div key={candidate.id} className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#e5e7eb]">
                        {candidate.driver ?? candidate.format}
                      </div>
                      <div className="text-[10px] text-[#7f849c]">
                        {formatHex(candidate.start, 6)} - {formatHex(candidate.end, 6)}
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-[#94a3b8]">
                      {candidate.format} · conf. {candidate.confidence}%
                    </div>
                    <div className="mt-1 text-[10px] text-[#7f849c]">{candidate.note}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeView === "code" && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-3">
              <div className="space-y-2 rounded border border-[#313244] bg-[#11111b] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                  Funcoes
                </div>
                <div
                  data-testid="reverse-code-trace-summary"
                  className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3 text-[10px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#e5e7eb]">
                      {traceAvailable
                        ? "Sessao com trace aplicada"
                        : "Analise estatica priorizada"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                        traceAvailable
                          ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/10 text-[#a6e3a1]"
                          : "border-[#313244] bg-[#11111b] text-[#94a3b8]"
                      }`}
                    >
                      {traceAvailable ? "Trace ativo" : "Sem trace ao vivo"}
                    </span>
                  </div>
                  <div className="mt-2 text-[#94a3b8]">
                    Funcoes executadas: {executedFunctionCount} · Xrefs tocadas: {touchedXrefCount}
                    {" "}· Arestas tocadas: {touchedCallGraphCount}
                  </div>
                  <div className="mt-1 text-[#7f849c]">
                    {traceAvailable
                      ? "Itens tocados pela sessao sobem para o topo desta vista para acelerar a leitura do fluxo executado."
                      : manifest.trace.note ||
                        "Ative uma sessao compativel no emulador para priorizar a navegacao por execucao real."}
                  </div>
                </div>
                {prioritizedFunctions.length ? (
                  prioritizedFunctions.map(({ fnCandidate, index }) => (
                    <div
                      key={fnCandidate.address}
                      data-testid="reverse-code-function"
                      className={`rounded border p-3 text-[10px] ${
                        fnCandidate.executed
                          ? "border-[#a6e3a1]/40 bg-[#0f2a1d]"
                          : "border-[#1e1e2e] bg-[#0f172a]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono text-[#cdd6f4]">{fnCandidate.name}</div>
                        <div className="flex items-center gap-2">
                          {fnCandidate.executed && (
                            <span className="rounded-full border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a6e3a1]">
                              Executada
                            </span>
                          )}
                          <span className="text-[9px] text-[#7f849c]">#{index + 1}</span>
                        </div>
                      </div>
                      <div className="mt-1 text-[#94a3b8]">
                        {formatHex(fnCandidate.address, 6)} - {formatHex(fnCandidate.end, 6)}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-[#7f849c]">
                    Nenhuma funcao candidata mapeada.
                  </p>
                )}
                <div className="pt-2 text-[10px] text-[#94a3b8]">
                  Call graph: {callGraph.length} aresta(s) · Xrefs: {xrefs.length}
                </div>
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                    <span>Xrefs</span>
                    {traceAvailable && touchedXrefCount > 0 && (
                      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a6e3a1]">
                        Priorizadas pela sessao
                      </span>
                    )}
                  </div>
                  {prioritizedXrefs.length === 0 ? (
                    <p className="text-[10px] text-[#7f849c]">
                      Nenhuma cross-reference mapeada nesta janela.
                    </p>
                  ) : (
                    prioritizedXrefs.slice(0, 12).map(({ xref, touchedByTrace }) => (
                      <div
                        key={`${xref.from}-${xref.to}-${xref.kind}`}
                        data-testid="reverse-code-xref"
                        className={`rounded border p-3 text-[10px] ${
                          touchedByTrace
                            ? "border-[#a6e3a1]/40 bg-[#0f2a1d]"
                            : "border-[#1e1e2e] bg-[#0f172a]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-mono text-[#cdd6f4]">{xref.label}</div>
                          {touchedByTrace && (
                            <span className="rounded-full border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a6e3a1]">
                              Trace
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[#94a3b8]">
                          {formatHex(xref.from, 6)} → {formatHex(xref.to, 6)} · {xref.kind}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                    <span>Call graph</span>
                    {traceAvailable && touchedCallGraphCount > 0 && (
                      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a6e3a1]">
                        Priorizado pela sessao
                      </span>
                    )}
                  </div>
                  {prioritizedCallGraph.length === 0 ? (
                    <p className="text-[10px] text-[#7f849c]">
                      Nenhuma aresta de call graph detectada.
                    </p>
                  ) : (
                    prioritizedCallGraph.slice(0, 12).map(({ edge, touchedByTrace }) => (
                      <div
                        key={`${edge.from}-${edge.to}-${edge.kind}`}
                        data-testid="reverse-code-edge"
                        className={`rounded border p-3 text-[10px] ${
                          touchedByTrace
                            ? "border-[#a6e3a1]/40 bg-[#0f2a1d]"
                            : "border-[#1e1e2e] bg-[#0f172a]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-mono text-[#cdd6f4]">
                            {formatHex(edge.from, 6)} → {formatHex(edge.to, 6)}
                          </div>
                          {touchedByTrace && (
                            <span className="rounded-full border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a6e3a1]">
                              Trace
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[#94a3b8]">{edge.kind}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-2 pt-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                    Anotacoes
                  </div>
                  <div className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3">
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2">
                      <Select
                          label="Tipo"
                          controlSize="sm"
                          value={annotationKind}
                          onChange={(event) => setAnnotationKind(event.target.value)}
                        >
                          <option value="label">label</option>
                          <option value="comment">comment</option>
                          <option value="region">region</option>
                          <option value="pointer">pointer</option>
                        </Select>
                      <Input
                          label="Fim (hex, opcional)"
                          controlSize="sm"
                          type="text"
                          value={annotationEndHex}
                          onChange={(event) => setAnnotationEndHex(event.target.value)}
                          placeholder="000240"
                          className="font-mono"
                        />
                    </div>
                    <label className="mt-2 flex flex-col gap-1 text-[10px] text-[#7f849c]">
                      Label
                      <input
                        type="text"
                        value={annotationLabel}
                        onChange={(event) => setAnnotationLabel(event.target.value)}
                        placeholder="spawn_player"
                        className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-xs text-[#cdd6f4] focus:border-[#f9e2af] focus:outline-none"
                      />
                    </label>
                    <label className="mt-2 flex flex-col gap-1 text-[10px] text-[#7f849c]">
                      Comentario
                      <textarea
                        value={annotationComment}
                        onChange={(event) => setAnnotationComment(event.target.value)}
                        placeholder="Comentario opcional"
                        rows={3}
                        className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-xs text-[#cdd6f4] focus:border-[#f9e2af] focus:outline-none"
                      />
                    </label>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-[#94a3b8]">
                      <span>Inicio atual: {formatHex(parseHexInput(offsetHex) ?? 0, 6)}</span>
                      <button
                        type="button"
                        onClick={() => void saveAnnotation()}
                        disabled={annotationBusy || !manifest}
                        className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                          annotationBusy || !manifest
                            ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                            : "bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#94d78b]"
                        }`}
                      >
                        {annotationBusy ? "Salvando..." : "Salvar anotacao"}
                      </button>
                    </div>
                  </div>
                  {manifest.annotations.length === 0 ? (
                    <p className="text-[10px] text-[#7f849c]">
                      Nenhuma anotacao persistida para esta ROM.
                    </p>
                  ) : (
                    manifest.annotations.slice(0, 12).map((annotation, index) => (
                      <div
                        key={`${annotation.kind}-${annotation.start}-${annotation.end ?? index}`}
                        className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3 text-[10px]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-[#e5e7eb]">{annotation.label}</div>
                          <div className="font-mono text-[#94a3b8]">
                            {formatHex(annotation.start, 6)}
                            {annotation.end !== null && annotation.end !== undefined
                              ? ` - ${formatHex(annotation.end, 6)}`
                              : ""}
                          </div>
                        </div>
                        <div className="mt-1 text-[#94a3b8]">{annotation.kind}</div>
                        {annotation.comment ? (
                          <div className="mt-2 text-[#cdd6f4]">{annotation.comment}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded border border-[#313244] bg-[#11111b]">
                <div className="border-b border-[#1e1e2e] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                  Disassembly
                </div>
                {!codeResult?.ok ? (
                  <div className="p-3 text-[10px] text-[#7f849c]">
                    Use "Atualizar Hex/Code" para recarregar a janela de disassembly.
                  </div>
                ) : (
                  <div className="max-h-96 overflow-auto">
                    {codeResult.rows.map((row) => (
                      <div
                        key={`${row.offset}-${row.text}`}
                        className="grid grid-cols-[88px_88px_minmax(0,1fr)] gap-3 border-b border-[#1e1e2e] px-3 py-2 text-[10px]"
                      >
                        <span className="font-mono text-[#89b4fa]">
                          {formatHex(row.offset, 6)}
                        </span>
                        <span className="font-mono text-[#7f849c]">{row.kind}</span>
                        <span className="font-mono text-[#cdd6f4]">{row.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeView === "projection" && (
            <div className="space-y-3 rounded border border-[#313244] bg-[#11111b] p-3">
              <div className="rounded border border-[#fab387]/35 bg-[#fab387]/8 p-3 text-[10px] text-[#fab387]">
                {manifest.projection_status.message}
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-3">
                <div className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                    Projection status
                  </div>
                  <div className="mt-2 text-sm font-semibold text-[#e5e7eb]">
                    {manifest.projection_status.status}
                  </div>
                  <div className="mt-2 text-[10px] text-[#94a3b8]">
                    Suportado: {manifest.projection_status.supported ? "sim" : "nao"}
                  </div>
                </div>
                <div className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">
                    Logic hints
                  </div>
                  <div className="mt-2 text-[10px] text-[#94a3b8]">
                    {manifest.logic_hints.length} hint(s) preservados para projecao futura.
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {manifest.logic_hints.map((hint) => (
                  <div key={hint.id} className="rounded border border-[#1e1e2e] bg-[#0f172a] p-3 text-[10px]">
                    <div className="font-semibold text-[#e5e7eb]">{hint.category}</div>
                    <div className="mt-1 text-[#94a3b8]">{hint.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}
