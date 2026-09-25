import { useCallback, useMemo, useState } from "react";
import {
  rexResourceApplyEdit,
  rexResourceList,
  rexResourcePreview,
  type RexPixelEdit,
  type RexResourceResult,
  type RexResourceSummary,
} from "../../core/ipc/toolsService";

const TILE = 8;
const SCALE = 4;
const PER_ROW = 16;

function parseOffset(value: string): number | null {
  const trimmed = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Painel de recursos comprimidos LZ4W (REX, Experimental). Prévia chunky,
 * edição por pixel com transação canônica (identidade, dependentes, patch
 * BPS) e proveniência por hashes. Nenhuma detecção automática: os recursos
 * vêm de verificação estrutural assistida por header.
 */
type LogLevel = "info" | "warn" | "error" | "success";

export function CompressedResourcePanel({
  logMessage,
}: {
  logMessage?: (level: LogLevel, message: string) => void;
}) {
  const [romPath, setRomPath] = useState("");
  const [romSha, setRomSha] = useState("");
  const [resources, setResources] = useState<RexResourceSummary[]>([]);
  const [analyzedScope, setAnalyzedScope] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<RexResourceResult | null>(null);
  const [result, setResult] = useState<RexResourceResult | null>(null);
  const [edits, setEdits] = useState<RexPixelEdit[]>([]);
  const [paintIndex, setPaintIndex] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    setEdits([]);
    setSelected(null);
    try {
      const [sha, list] = await rexResourceList(romPath);
      setRomSha(sha);
      setResources(list);
      setAnalyzedScope(
        `Recursos LZ4W estruturalmente verificados nesta ROM: ${list.length}; preservação garantida apenas para este conjunto.`
      );
      if (logMessage) logMessage("info", `REX recursos: ${list.length} verificados (escopo declarado no painel).`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [romPath, logMessage]);

  const selectResource = useCallback(
    async (streamOffset: number) => {
      setSelected(streamOffset);
      setPreview(null);
      setResult(null);
      setEdits([]);
      setBusy(true);
      setError(null);
      try {
        const outcome = await rexResourcePreview(romPath, streamOffset);
        setPreview(outcome);
        setAnalyzedScope(outcome.analyzed_scope);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    },
    [romPath]
  );

  const paintAt = useCallback(
    (event: React.MouseEvent<HTMLImageElement>) => {
      if (!preview || preview.preview_width == null || selected == null) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const px = Math.floor(((event.clientX - rect.left) / rect.width) * preview.preview_width);
      const py = Math.floor(((event.clientY - rect.top) / rect.height) * (preview.preview_height ?? 0));
      if (px < 0 || py < 0) return;
      const tileRow = Math.floor(py / (TILE * SCALE));
      const tileCol = Math.floor(px / (TILE * SCALE));
      const tile = tileRow * PER_ROW + tileCol;
      const row = Math.floor((py % (TILE * SCALE)) / SCALE);
      const col = Math.floor((px % (TILE * SCALE)) / SCALE);
      setEdits((current) => [
        ...current.filter((e) => !(e.tile === tile && e.row === row && e.col === col)),
        { tile, row, col, index: paintIndex },
      ]);
    },
    [preview, selected, paintIndex]
  );

  const apply = useCallback(async () => {
    if (selected == null) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await rexResourceApplyEdit(romPath, selected, edits, romSha);
      setResult(outcome);
      setAnalyzedScope(outcome.analyzed_scope);
      if (outcome.outcome === "applied" && logMessage) {
        logMessage(
          "info",
          `REX edição aplicada: patch ${outcome.patch_bps_sha256}; preservados ${outcome.verified_preserved}.`
        );
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [selected, edits, romPath, romSha, logMessage]);

  const canvasStyle = useMemo(
    () => ({ imageRendering: "pixelated" as const, width: "100%" }),
    []
  );

  return (
    <div className="flex flex-col gap-3" data-testid="rex-resource-panel">
      <div className="rounded border border-[#313244] bg-[#11111b] p-3 text-[11px] text-[#a6adc8]">
        <p className="font-semibold text-[#f9e2af]">Recursos comprimidos LZ4W — Experimental</p>
        <p>
          Verificação estrutural assistida por header TileSet do SGDK (não é
          detecção automática). Edição passa por transação canônica: identidade
          da ROM, espaço comprovado, dependentes verificados no produto, patch
          BPS exportado e re-aplicado com hash exato. Sem expansão de ROM.
        </p>
        {analyzedScope && <p className="mt-1 text-[10px] text-[#6c7086]">{analyzedScope}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={romPath}
          onChange={(event) => setRomPath(event.target.value)}
          placeholder="/caminho/da/rom.bin"
          data-testid="rex-resource-rom-input"
          className="min-w-[320px] flex-1 rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[11px] text-[#cdd6f4]"
        />
        <button
          type="button"
          data-testid="rex-resource-verify"
          onClick={() => void verify()}
          disabled={busy || romPath.trim().length === 0}
          className="rounded border border-[#89b4fa] bg-[#89b4fa]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa] disabled:opacity-40"
        >
          Verificar recursos
        </button>
        {romSha && (
          <span className="text-[10px] text-[#6c7086]" data-testid="rex-resource-rom-sha">
            sha256 {romSha.slice(0, 16)}…
          </span>
        )}
      </div>

      {resources.length > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-[#a6adc8]">
          Recurso (offset do stream)
          <select
            data-testid="rex-resource-select"
            value={selected ?? ""}
            onChange={(event) => {
              const value = parseOffset(event.target.value);
              if (value != null) void selectResource(value);
            }}
            className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[11px] text-[#cdd6f4]"
          >
            <option value="">selecione…</option>
            {resources.map((resource) => (
              <option key={resource.stream_offset} value={resource.stream_offset.toString(16)}>
                0x{resource.stream_offset.toString(16)} — {resource.num_tiles} tiles (stream {resource.stream_len} B)
              </option>
            ))}
          </select>
        </label>
      )}

      {preview?.preview_data_url && (
        <div className="flex flex-col gap-2">
          <img
            src={preview.preview_data_url}
            alt="prévia chunky do recurso"
            data-testid="rex-resource-canvas"
            onClick={paintAt}
            style={canvasStyle}
            className="max-w-[512px] cursor-crosshair rounded border border-[#313244]"
          />
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-[#6c7086]">
            <span data-testid="rex-resource-pixels-sha">pixels {preview.preview_pixels_sha256?.slice(0, 16)}…</span>
            <label className="flex items-center gap-1 text-[#a6adc8]">
              índice
              <input
                type="number"
                min={1}
                max={15}
                value={paintIndex}
                onChange={(event) => setPaintIndex(Number(event.target.value) || 1)}
                data-testid="rex-resource-paint-index"
                className="w-14 rounded border border-[#313244] bg-[#11111b] px-1 py-0.5 text-[#cdd6f4]"
              />
            </label>
            <span>{edits.length} edição(ões) pendente(s)</span>
            <button
              type="button"
              data-testid="rex-resource-apply"
              onClick={() => void apply()}
              disabled={busy || selected == null}
              className="rounded border border-[#a6e3a1] bg-[#a6e3a1]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6e3a1] disabled:opacity-40"
            >
              Aplicar pela transação
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded border border-[#313244] bg-[#11111b] p-3 text-[11px] text-[#a6adc8]" data-testid="rex-resource-result">
          <p>
            desfecho: <span className="font-semibold text-[#f9e2af]">{result.outcome}</span>
            {result.modified_rom_sha256 && (
              <>
                {" "}· ROM modificada {result.modified_rom_sha256.slice(0, 16)}…
                {" "}· patch BPS {result.patch_bps_sha256?.slice(0, 16)}…
              </>
            )}
            {result.verified_preserved != null && <> · preservados {result.verified_preserved}</>}
          </p>
          {result.modified_rom_path && <p className="text-[10px] text-[#6c7086]">cópia: {result.modified_rom_path}</p>}
          {result.patch_bps_path && <p className="text-[10px] text-[#6c7086]">patch: {result.patch_bps_path}</p>}
          <p className="text-[10px] text-[#6c7086]">{result.analyzed_scope}</p>
        </div>
      )}

      {error && (
        <div className="rounded border border-[#f38ba8] bg-[#f38ba8]/10 p-2 text-[11px] text-[#f38ba8]" data-testid="rex-resource-error">
          {error}
        </div>
      )}
    </div>
  );
}
