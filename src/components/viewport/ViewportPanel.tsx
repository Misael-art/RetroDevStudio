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
  const { activeViewportTab, setActiveViewportTab, logMessage } = useEditorStore();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const joypadRef  = useRef<JoypadState>(JOYPAD_DEFAULT);
  const [emulatorActive, setEmulatorActive] = useState(false);

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

        {/* ── Cena tab ── */}
        {activeViewportTab === "scene" && (
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative border border-[#45475a] bg-black"
              style={{ width: MD_WIDTH, height: MD_HEIGHT }}
            >
              <div
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(#cdd6f4 0 1px,transparent 1px 100%)," +
                    "repeating-linear-gradient(90deg,#cdd6f4 0 1px,transparent 1px 100%)",
                  backgroundSize: "16px 16px",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[#45475a] text-xs select-none">
                  320 × 224 — Mega Drive Safe Area
                </span>
              </div>
            </div>
            <span className="text-[#6c7086] text-xs select-none">
              Clique em "Jogo" para iniciar o emulador
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

      {/* Status bar */}
      <div className="flex items-center gap-4 px-3 h-6 bg-[#181825] border-t border-[#313244] shrink-0">
        <span className="text-[10px] text-[#45475a] select-none">Mega Drive</span>
        <span className="text-[10px] text-[#45475a] select-none">320×224 / 60fps</span>
        <span className="text-[10px] text-[#45475a] select-none">VRAM: 0 / 64 KB</span>
        <span className="text-[10px] text-[#45475a] select-none">Sprites: 0 / 80</span>
      </div>
    </div>
  );
}
