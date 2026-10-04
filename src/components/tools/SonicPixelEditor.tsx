import { useState, type MouseEvent } from "react";
import type { InspectionPixelEdit, InspectionSpriteFrame } from "../../core/ipc/toolsService";

interface Props {
  frame: InspectionSpriteFrame;
  disabled: boolean;
  onApply: (pixels: InspectionPixelEdit[], allowShared: boolean) => Promise<void>;
}

/** Screen coordinates select a pixel only. The backend supplies its art tile
 * and resolves the byte/nibble; the UI never reimplements DPLC or VDP flips. */
export default function SonicPixelEditor({ frame, disabled, onApply }: Props) {
  const [index, setIndex] = useState(1);
  const [history, setHistory] = useState<InspectionPixelEdit[][]>([[]]);
  const [allowShared, setAllowShared] = useState(false);
  const [message, setMessage] = useState("");
  const context = frame.sonic_context;
  if (!context || !frame.data_url) return null;
  const queue = history[history.length - 1];
  const tiles = new Set(queue.map((p) => context.pixel_art_tiles[p.y * frame.width + p.x]));
  const affected = [...new Set(context.tile_uses.filter((t) => tiles.has(t.art_tile))
    .flatMap((t) => t.frames).filter((f) => f !== context.mapping_index))].sort((a, b) => a - b);

  function paint(event: MouseEvent<HTMLImageElement>) {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.floor((event.clientX - rect.left) * frame.width / rect.width);
    const y = Math.floor((event.clientY - rect.top) * frame.height / rect.height);
    if (x < 0 || x >= frame.width || y < 0 || y >= frame.height
      || context?.pixel_art_tiles[y * frame.width + x] == null) {
      setMessage("Este espaço não pertence a uma peça do sprite. A fila foi preservada.");
      return;
    }
    const next = queue.filter((p) => p.x !== x || p.y !== y);
    next.push({ x, y, index });
    setHistory((h) => [...h.slice(-100), next]);
    setAllowShared(false);
    setMessage(`Pixel (${x}, ${y}) na fila; índice ${index}${index === 0 ? " (transparente)" : ""}.`);
  }

  async function apply() {
    try {
      await onApply(queue, allowShared);
      setHistory([[]]); setAllowShared(false); setMessage("Pintura gravada na cópia verificada.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(`${detail}. A fila foi preservada.`);
    }
  }

  return <section data-testid="sonic-pixel-editor" className="mt-3 rounded border border-[#89b4fa]/40 bg-[#11111b] p-3">
    <h3 className="font-semibold text-[#89b4fa]">Pintar pixels do sprite</h3>
    <p className="mt-1 text-[#bac2de]">Escolha uma cor e clique no personagem. A marca é uma intenção até aplicar. Índice 0 apaga o pixel para transparência.</p>
    <div className="my-2 flex flex-wrap gap-1" aria-label="Cores da paleta do sprite">
      {context.palette_rgba.map((color, i) => <button key={i} type="button" data-testid={`sonic-color-${i}`}
        aria-label={`Índice ${i}${i === 0 ? ", transparente" : ""}`} aria-pressed={i === index} disabled={disabled}
        onClick={() => { setIndex(i); setMessage(""); }} className={`h-8 w-8 rounded border-2 ${i === index ? "border-white" : "border-[#45475a]"}`}
        style={{ backgroundColor: i === 0 ? "#222" : `rgb(${color[0]},${color[1]},${color[2]})`, color: "white", textShadow: "0 1px 2px black" }}>{i === 0 ? "∅" : i}</button>)}
    </div>
    <div className="overflow-auto rounded border border-[#313244] bg-[#262636] p-2">
      <div className="relative" style={{ width: frame.width * 8, height: frame.height * 8 }}>
        <img data-testid="sonic-paint-image" src={frame.data_url} alt={`Pintar ${frame.frame_id}`}
          draggable={false} onClick={paint} className="block cursor-crosshair" style={{ width: frame.width * 8, height: frame.height * 8, maxWidth: "none", imageRendering: "pixelated" }} />
        {queue.map((p) => <span key={`${p.x}:${p.y}`} aria-hidden="true" className="pointer-events-none absolute border border-white"
          style={{ left: p.x * 8, top: p.y * 8, width: 8, height: 8, background: p.index === 0 ? "#ff00ff" : `rgb(${context.palette_rgba[p.index].slice(0, 3).join(",")})` }} />)}
      </div>
    </div>
    <div data-testid="sonic-paint-queue" className="mt-2 text-[#cdd6f4]">{queue.length} pixel(s) na fila · tiles {Array.from(tiles).join(", ") || "nenhum"}</div>
    <div data-testid="sonic-paint-dependencies" className="mt-1 text-[#f9e2af]">Outros frames afetados: {affected.map((f) => context.frames.find((c) => c.mapping_index === f)?.label ?? `DPLC ${f}`).join(", ") || "nenhum"}</div>
    {affected.length > 0 && <label className="mt-2 flex gap-2 text-[#f9e2af]"><input data-testid="sonic-paint-confirm-shared" type="checkbox" checked={allowShared} disabled={disabled}
      onChange={(e) => setAllowShared(e.target.checked)} />Confirmo a alteração dos tiles compartilhados com os frames listados.</label>}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" data-testid="sonic-paint-undo" disabled={disabled || history.length === 1} onClick={() => { setHistory((h) => h.slice(0, -1)); setAllowShared(false); }} className="rounded border border-[#45475a] px-2 py-1">Desfazer pixel</button>
      <button type="button" disabled={disabled || !queue.length} onClick={() => { setHistory([[]]); setAllowShared(false); }} className="rounded border border-[#45475a] px-2 py-1">Limpar fila</button>
      <button type="button" data-testid="sonic-paint-apply" disabled={disabled || !queue.length || (affected.length > 0 && !allowShared)} onClick={() => void apply()} className="rounded bg-[#89b4fa] px-3 py-1 font-semibold text-[#11111b]">Aplicar pintura à cópia</button>
    </div>
    <p role="status" className="mt-2 text-[#bac2de]">{message}</p>
  </section>;
}
