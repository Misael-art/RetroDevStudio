import { useEffect, useRef, useState } from "react";
import type { MugenVisualReview } from "../../core/mugenReview";

export default function MugenVisualComparison({ visual }: { visual: MugenVisualReview }) {
  const actions = [...new Set(visual.frames.map((f) => f.action))];
  const [action, setAction] = useState(actions[0]);
  const [element, setElement] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [anchor, setAnchor] = useState(false);
  const previousVisual = useRef(visual);
  const frames = visual.frames.filter((f) => f.action === action);
  const frame = frames[element] ?? frames[0];
  useEffect(() => {
    if (previousVisual.current === visual) return;
    previousVisual.current = visual;
    setAction(visual.frames[0]?.action); setElement(0); setPlaying(false);
  }, [visual]);
  useEffect(() => {
    if (!playing || !frame || frame.duration < 0) return;
    const timer = window.setTimeout(() => setElement((i) => i + 1 < frames.length ? i + 1 : visual.loop_start[String(action)] ?? 0), frame.duration * 1000 / 60);
    return () => window.clearTimeout(timer);
  }, [playing, frame, frames.length, visual, action]);
  if (!frame) return null;
  const bounds = visual.frames.map((f) => {
    const x = visual.anchor[0] + f.offset[0] + (f.hflip ? f.sprite_axis[0] - f.sprite_size[0] : -f.sprite_axis[0]);
    const y = visual.anchor[1] + f.offset[1] + (f.vflip ? f.sprite_axis[1] - f.sprite_size[1] : -f.sprite_axis[1]);
    return [x, y, x + f.sprite_size[0], y + f.sprite_size[1]];
  });
  const viewX = Math.max(0, Math.min(...bounds.map((b) => b[0])) - 8);
  const viewY = Math.max(0, Math.min(...bounds.map((b) => b[1])) - 8);
  const viewW = Math.min(visual.width, Math.max(...bounds.map((b) => b[2])) + 8) - viewX;
  const viewH = Math.min(visual.height, Math.max(...bounds.map((b) => b[3])) + 8) - viewY;
  return <section data-testid="mugen-visual-review" className="space-y-2 rounded border border-[#45475a] p-3 text-xs">
    <p className="font-semibold">Pixels do personagem — Experimental</p>
    <div className="flex flex-wrap items-center gap-3">
      <label>Ação <select data-testid="mugen-review-action" value={action} onChange={(e) => { setAction(Number(e.target.value)); setElement(0); setPlaying(false); }} className="bg-[#313244] p-1">
        {actions.map((n) => <option key={n} value={n}>{n}{n === 0 ? " · idle" : n === 20 || n === 21 ? " · caminhada" : n === 200 ? " · soco" : ""}</option>)}
      </select></label>
      <label>Quadro <select data-testid="mugen-review-frame" value={element} onChange={(e) => {setElement(Number(e.target.value)); setPlaying(false);}} className="bg-[#313244] p-1">
        {frames.map((f,i) => <option key={i} value={i}>{i+1} · {f.group},{f.image}</option>)}
      </select></label>
      <button data-testid="mugen-review-play" onClick={() => setPlaying(!playing)} className="rounded bg-[#45475a] px-2 py-1">{playing ? "Pausar" : "Animar"}</button>
      <label><input type="checkbox" checked={anchor} onChange={(e) => setAnchor(e.target.checked)} /> Mostrar eixo</label>
    </div>
    <div className="flex gap-1 overflow-auto" aria-label="Miniaturas dos quadros reais">
      {frames.map((f, i) => <button key={i} data-testid={`mugen-review-thumbnail-${i}`} aria-label={`Selecionar quadro ${i + 1}`} aria-pressed={element === i} onClick={() => { setElement(i); setPlaying(false); }} className={`shrink-0 rounded border ${element === i ? "border-[#89b4fa]" : "border-[#45475a]"}`}>
        <svg width="56" height="64" viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}><image href={f.original_png} width={visual.width} height={visual.height} style={{imageRendering:"pixelated"}} /></svg>
      </button>)}
    </div>
    <div className="flex gap-4 overflow-auto">
      {(["original", "converted"] as const).map((kind) => <div key={kind} className="shrink-0">
        <p className="mb-1">{kind === "original" ? "Original · paleta escolhida" : "Convertido · cores Mega Drive"} · 2×</p>
        <svg data-testid={`mugen-review-${kind}`} data-action={frame.action} data-element={frame.element} data-sha256={frame[`${kind}_sha256`]} width={viewW*2} height={viewH*2} viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`} style={{ backgroundColor: "#363640", backgroundImage: "conic-gradient(#25252e 25%, transparent 0 50%, #25252e 0 75%, transparent 0)", backgroundSize: "16px 16px" }}>
          <image href={frame[`${kind}_png`]} width={visual.width} height={visual.height} style={{imageRendering:"pixelated"}} />
          {anchor && <g stroke="#89dceb" strokeWidth="0.5"><path d={`M ${visual.anchor[0]} ${viewY} V ${viewY+viewH} M ${viewX} ${visual.anchor[1]} H ${viewX+viewW}`} /></g>}
        </svg>
      </div>)}
    </div>
    <p data-testid="mugen-review-frame-detail">Sprite {frame.group},{frame.image} · {frame.sprite_size.join("×")} px · eixo ({frame.sprite_axis.join(", ")}) · deslocamento ({frame.offset.join(", ")}) · flip {frame.hflip ? "H" : ""}{frame.vflip ? "V" : ""}{!frame.hflip && !frame.vflip ? "nenhum" : ""} · {frame.duration === -1 ? "parado" : `${frame.duration} ticks (1/60 s)`}</p>
    <p className="text-[#f9e2af]">{visual.note}</p>
  </section>;
}
