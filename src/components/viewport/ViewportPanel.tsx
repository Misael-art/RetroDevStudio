import { useRef, useEffect, useCallback, useState } from "react";
import Tabs from "../common/Tabs";
import { useEditorStore } from "../../core/store/editorStore";
import {
  startFrameLoop,
  emulatorStop,
  emulatorSendInput,
  keyToJoypad,
  JOYPAD_DEFAULT,
  JoypadState,
  FramePayload,
} from "../../core/ipc/emulatorService";
import NodeGraphEditor from "../nodegraph/NodeGraphEditor";
import RetroFXDesigner from "../retrofx/RetroFXDesigner";
import type { Entity } from "../../core/ipc/sceneService";

const VIEWPORT_TABS = [
  { id: "scene",   label: "Cena",    icon: "◈" },
  { id: "game",    label: "Jogo",    icon: "▶" },
  { id: "logic",   label: "Logic",   icon: "⬡" },
  { id: "retrofx", label: "RetroFX", icon: "✦" },
];

// Mega Drive safe area
const MD_WIDTH  = 320;
const MD_HEIGHT = 224;

export default function ViewportPanel() {
  const {
    activeViewportTab, setActiveViewportTab, logMessage,
    activeScene, selectedEntityId, setSelectedEntityId, updateEntity,
    activeProjectDir, activeTarget,
  } = useEditorStore();
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const stopLoopRef    = useRef<(() => void) | null>(null);
  const joypadRef      = useRef<JoypadState>(JOYPAD_DEFAULT);
  const [emulatorActive, setEmulatorActive] = useState(false);
  // Estado reativo para cursor durante drag (ref sozinha não dispara re-render)
  const [isDragging, setIsDragging] = useState(false);

  // Drag state
  const dragRef = useRef<{
    entityId: string;
    startMx: number; startMy: number;
    origX: number;   origY: number;
  } | null>(null);

  // ── Render frame on canvas ────────────────────────────────────────────────
  const renderFrame = useCallback((payload: FramePayload) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageData = ctx.createImageData(payload.width, payload.height);
    imageData.data.set(new Uint8Array(payload.rgba));
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // ── Start emulator when switching to Game tab ─────────────────────────────
  useEffect(() => {
    if (activeViewportTab !== "game") {
      // Stop emulator if leaving Game tab
      if (stopLoopRef.current) {
        stopLoopRef.current();
        stopLoopRef.current = null;
        emulatorStop().catch(() => {});
        setEmulatorActive(false);
      }
      return;
    }

    // Start frame loop (emulator must already have ROM loaded via build_project)
    let cancelled = false;

    startFrameLoop(renderFrame).then((stopFn) => {
      if (cancelled) {
        stopFn();
        return;
      }
      stopLoopRef.current = stopFn;
      setEmulatorActive(true);
      logMessage("info", "Emulador iniciado. Modo simulado (Genesis Plus GX core não instalado).");
    }).catch((e: unknown) => {
      logMessage("error", `Falha ao iniciar emulador: ${e}`);
    });

    return () => {
      cancelled = true;
      if (stopLoopRef.current) {
        stopLoopRef.current();
        stopLoopRef.current = null;
        emulatorStop().catch(() => {});
        setEmulatorActive(false);
      }
    };
  }, [activeViewportTab, renderFrame, logMessage]);

  // ── Keyboard input handling ───────────────────────────────────────────────
  useEffect(() => {
    if (activeViewportTab !== "game") return;

    function onKeyDown(e: KeyboardEvent) {
      const updated = keyToJoypad(joypadRef.current, e.code, true);
      if (!updated) return;
      e.preventDefault();
      joypadRef.current = updated;
      emulatorSendInput(updated).catch(() => {});
    }

    function onKeyUp(e: KeyboardEvent) {
      const updated = keyToJoypad(joypadRef.current, e.code, false);
      if (!updated) return;
      joypadRef.current = updated;
      emulatorSendInput(updated).catch(() => {});
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [activeViewportTab]);

  // ── Scene canvas render ───────────────────────────────────────────────────
  useEffect(() => {
    if (activeViewportTab !== "scene") return;
    const canvas = sceneCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Fundo preto
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, MD_WIDTH, MD_HEIGHT);

    // Grade sutil
    ctx.strokeStyle = "rgba(205,214,244,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= MD_WIDTH; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MD_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y <= MD_HEIGHT; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MD_WIDTH, y); ctx.stroke();
    }

    if (!activeScene) {
      ctx.fillStyle = "#45475a";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("320 × 224 — Mega Drive Safe Area", MD_WIDTH / 2, MD_HEIGHT / 2);
      ctx.fillText("Abra um projeto para ver a cena", MD_WIDTH / 2, MD_HEIGHT / 2 + 16);
      return;
    }

    // Paleta de cores por índice de entidade
    const COLORS = [
      "#cba6f7", "#89b4fa", "#a6e3a1", "#fab387",
      "#f38ba8", "#94e2d5", "#f9e2af", "#b4befe",
    ];

    // Renderiza background layers como faixas horizontais
    activeScene.background_layers.forEach((layer, i) => {
      ctx.fillStyle = `rgba(137,180,250,${0.05 + i * 0.03})`;
      ctx.fillRect(0, 0, MD_WIDTH, MD_HEIGHT);
      ctx.fillStyle = "#45475a";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`BG: ${layer.layer_id}`, 4, 10 + i * 12);
    });

    // Renderiza entidades
    activeScene.entities.forEach((entity: Entity, i: number) => {
      const x = entity.transform.x;
      const y = entity.transform.y;
      const w = entity.components?.sprite?.frame_width  ?? 32;
      const h = entity.components?.sprite?.frame_height ?? 32;
      const isSelected = entity.entity_id === selectedEntityId;
      const color = COLORS[i % COLORS.length];

      // Caixa da entidade
      ctx.fillStyle = color + "33"; // 20% alpha
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = isSelected ? "#ffffff" : color;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(x, y, w, h);

      // Label
      ctx.fillStyle = isSelected ? "#ffffff" : color;
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      const label = entity.prefab ?? entity.entity_id;
      ctx.fillText(label.slice(0, 14), x + 2, y + 10);

      // Ponto de pivot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [activeViewportTab, activeScene, selectedEntityId]);

  // ── Scene canvas helpers ──────────────────────────────────────────────────
  function canvasCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      mx: (e.clientX - rect.left) * (MD_WIDTH  / rect.width),
      my: (e.clientY - rect.top)  * (MD_HEIGHT / rect.height),
    };
  }

  function hitTest(mx: number, my: number) {
    if (!activeScene) return null;
    for (let i = activeScene.entities.length - 1; i >= 0; i--) {
      const e = activeScene.entities[i];
      const x = e.transform.x, y = e.transform.y;
      const w = e.components?.sprite?.frame_width  ?? 32;
      const h = e.components?.sprite?.frame_height ?? 32;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) return e;
    }
    return null;
  }

  // ── Drag: mousedown inicia drag ou seleciona ───────────────────────────────
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeScene) return;
    const { mx, my } = canvasCoords(e);
    const entity = hitTest(mx, my);
    if (entity) {
      setSelectedEntityId(entity.entity_id);
      dragRef.current = {
        entityId: entity.entity_id,
        startMx: mx, startMy: my,
        origX: entity.transform.x,
        origY: entity.transform.y,
      };
      setIsDragging(true);
    } else {
      setSelectedEntityId(null);
    }
  }

  // ── Drag: mousemove atualiza posição ──────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || e.buttons !== 1) return;
    const { mx, my } = canvasCoords(e);
    const dx = Math.round(mx - drag.startMx);
    const dy = Math.round(my - drag.startMy);
    updateEntity(drag.entityId, {
      transform: { x: drag.origX + dx, y: drag.origY + dy },
    });
  }

  // ── Drag: mouseup persiste ────────────────────────────────────────────────
  async function handleMouseUp() {
    if (!dragRef.current) return;
    // Captura referência antes de zerar, para garantir que o save usa o estado atual
    const wasProjectDir = activeProjectDir;
    const wasScene = activeScene;
    dragRef.current = null;
    setIsDragging(false);
    // Auto-save após drag
    if (wasProjectDir && wasScene) {
      const { saveSceneData } = await import("../../core/ipc/sceneService");
      await saveSceneData(wasProjectDir, JSON.stringify(wasScene, null, 2));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#1e1e2e]">
      <Tabs
        tabs={VIEWPORT_TABS}
        activeTab={activeViewportTab}
        onTabChange={setActiveViewportTab}
      />

      <div className={`flex-1 bg-[#11111b] overflow-hidden ${
        activeViewportTab === "logic" || activeViewportTab === "retrofx"
          ? "flex"
          : "flex items-center justify-center"
      }`}>

        {/* ── Cena tab — Scene View ── */}
        {activeViewportTab === "scene" && (
          <div className="flex flex-col items-center gap-2">
            <canvas
              ref={sceneCanvasRef}
              width={MD_WIDTH}
              height={MD_HEIGHT}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="border border-[#45475a]"
              style={{
                imageRendering: "pixelated",
                width: MD_WIDTH, height: MD_HEIGHT,
                cursor: isDragging ? "grabbing" : "crosshair",
              }}
              title="Clique para selecionar · Arraste para mover"
            />
            <span className="text-[#6c7086] text-[10px] select-none">
              {activeScene
                ? `${activeScene.entities.length} entidade(s) · ${activeScene.background_layers.length} layer(s) — clique para selecionar · arraste para mover`
                : "Abra um projeto para visualizar a cena"}
            </span>
          </div>
        )}

        {/* ── Jogo tab — canvas do emulador ── */}
        {activeViewportTab === "game" && (
          <div className="flex flex-col items-center gap-2">
            <canvas
              ref={canvasRef}
              width={MD_WIDTH}
              height={MD_HEIGHT}
              className="border border-[#45475a] bg-black"
              style={{ imageRendering: "pixelated", width: MD_WIDTH, height: MD_HEIGHT }}
              tabIndex={0}
            />
            <div className="flex items-center gap-4 text-[10px] text-[#6c7086] select-none">
              {emulatorActive ? (
                <span className="text-[#a6e3a1]">● Emulador ativo (modo simulado)</span>
              ) : (
                <span className="text-[#45475a]">Aguardando emulador...</span>
              )}
              <span>Z=A · X=B · C=C · Enter=Start · Setas=D-Pad</span>
            </div>
          </div>
        )}

        {/* ── Logic tab — NodeGraph ── */}
        {activeViewportTab === "logic" && (
          <div className="w-full h-full">
            <NodeGraphEditor />
          </div>
        )}

        {/* ── RetroFX tab ── */}
        {activeViewportTab === "retrofx" && (
          <div className="w-full h-full">
            <RetroFXDesigner />
          </div>
        )}
      </div>

      {/* Status bar — adaptativa por target */}
      {(() => {
        const isSnes = activeTarget === "snes";
        const targetLabel  = isSnes ? "SNES"       : "Mega Drive";
        const resolution   = isSnes ? "256×224"    : "320×224";
        const spriteLimit  = isSnes ? 128          : 80;
        const bgLayerLimit = isSnes ? 4            : 4;
        return (
          <div className="flex items-center gap-4 px-3 h-6 bg-[#181825] border-t border-[#313244] shrink-0">
            <span className="text-[10px] text-[#45475a] select-none">{targetLabel}</span>
            <span className="text-[10px] text-[#45475a] select-none">{resolution} / 60fps</span>
            <span className="text-[10px] text-[#45475a] select-none">
              Sprites: {activeScene?.entities.length ?? 0} / {spriteLimit}
            </span>
            <span className="text-[10px] text-[#45475a] select-none">
              BG Layers: {activeScene?.background_layers.length ?? 0} / {bgLayerLimit}
            </span>
            {selectedEntityId && !selectedEntityId.startsWith("layer::") && (
              <span className="text-[10px] text-[#cba6f7] select-none ml-auto">
                ◈ {activeScene?.entities.find(e => e.entity_id === selectedEntityId)?.prefab ?? selectedEntityId}
              </span>
            )}
          </div>
        );
      })()}
    </div>
  );
}
