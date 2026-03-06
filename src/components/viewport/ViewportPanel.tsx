import { useCallback, useEffect, useRef, useState } from "react";
import Tabs from "../common/Tabs";
import { useEditorStore } from "../../core/store/editorStore";
import {
  JOYPAD_DEFAULT,
  emulatorLoadState,
  emulatorSaveState,
  emulatorSendInput,
  emulatorStop,
  keyToJoypad,
  startFrameLoop,
  type FramePayload,
  type JoypadState,
} from "../../core/ipc/emulatorService";
import NodeGraphEditor from "../nodegraph/NodeGraphEditor";
import RetroFXDesigner from "../retrofx/RetroFXDesigner";
import type { Entity } from "../../core/ipc/sceneService";
import { persistActiveScene } from "../../core/scenePersistence";

const VIEWPORT_TABS = [
  { id: "scene", label: "Cena", icon: "SC" },
  { id: "game", label: "Jogo", icon: "GM" },
  { id: "logic", label: "Logic", icon: "LG" },
  { id: "retrofx", label: "RetroFX", icon: "FX" },
];

const MD_WIDTH = 320;
const MD_HEIGHT = 224;
const GRID_SNAP_SIZE = 8;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export default function ViewportPanel() {
  const {
    activeViewportTab,
    setActiveViewportTab,
    logMessage,
    activeScene,
    selectedEntityId,
    setSelectedEntityId,
    updateEntity,
    beginHistoryCapture,
    commitHistoryCapture,
    cancelHistoryCapture,
    activeTarget,
    emulPaused,
  } = useEditorStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const loopStartingRef = useRef(false);
  const loopTokenRef = useRef(0);
  const activeTabRef = useRef(activeViewportTab);
  const pausedRef = useRef(emulPaused);
  const joypadRef = useRef<JoypadState>(JOYPAD_DEFAULT);
  const dragRef = useRef<{
    entityId: string;
    startMx: number;
    startMy: number;
    origX: number;
    origY: number;
    lastX: number;
    lastY: number;
    historyCommitted: boolean;
  } | null>(null);

  const [emulatorActive, setEmulatorActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [gridSnap, setGridSnap] = useState(true);
  const [saveStateBusy, setSaveStateBusy] = useState(false);
  const [loadStateBusy, setLoadStateBusy] = useState(false);

  activeTabRef.current = activeViewportTab;
  pausedRef.current = emulPaused;

  const renderFrame = useCallback((payload: FramePayload) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const imageData = context.createImageData(payload.width, payload.height);
    imageData.data.set(new Uint8Array(payload.rgba));
    context.putImageData(imageData, 0, 0);
  }, []);

  const stopFrameLoop = useCallback(() => {
    loopTokenRef.current += 1;
    loopStartingRef.current = false;

    if (stopLoopRef.current) {
      stopLoopRef.current();
      stopLoopRef.current = null;
    }

    setEmulatorActive(false);
  }, []);

  const shutdownEmulator = useCallback(() => {
    stopFrameLoop();
    emulatorStop().catch(() => {});
  }, [stopFrameLoop]);

  const startEmulatorLoop = useCallback(
    (logStartup: boolean) => {
      if (loopStartingRef.current || stopLoopRef.current) return;

      const token = loopTokenRef.current + 1;
      loopTokenRef.current = token;
      loopStartingRef.current = true;

      startFrameLoop(renderFrame, (message) => {
        if (loopTokenRef.current !== token) {
          return;
        }
        stopFrameLoop();
        logMessage("error", `Falha durante loop do emulador: ${message}`);
      })
        .then((stopFn) => {
          loopStartingRef.current = false;

          if (
            loopTokenRef.current !== token ||
            activeTabRef.current !== "game" ||
            pausedRef.current
          ) {
            stopFn();
            return;
          }

          stopLoopRef.current = stopFn;
          setEmulatorActive(true);
          if (logStartup) {
            logMessage("info", "Loop do emulador iniciado.");
          }
        })
        .catch((error: unknown) => {
          loopStartingRef.current = false;
          if (loopTokenRef.current !== token) return;
          logMessage("error", `Falha ao iniciar emulador: ${describeError(error)}`);
        });
    },
    [logMessage, renderFrame, stopFrameLoop]
  );

  const handleSaveState = useCallback(async () => {
    setSaveStateBusy(true);
    try {
      const result = await emulatorSaveState();
      if (!result.ok) {
        logMessage("error", `[Emulador] ${result.message}`);
        return;
      }
      logMessage("success", `[Emulador] ${result.message}`);
    } catch (error: unknown) {
      logMessage("error", `[Emulador] Falha ao salvar state: ${describeError(error)}`);
    } finally {
      setSaveStateBusy(false);
    }
  }, [logMessage]);

  const handleLoadState = useCallback(async () => {
    setLoadStateBusy(true);
    try {
      const result = await emulatorLoadState();
      if (!result.ok) {
        logMessage("error", `[Emulador] ${result.message}`);
        return;
      }
      logMessage("success", `[Emulador] ${result.message}`);
    } catch (error: unknown) {
      logMessage("error", `[Emulador] Falha ao carregar state: ${describeError(error)}`);
    } finally {
      setLoadStateBusy(false);
    }
  }, [logMessage]);

  useEffect(() => {
    if (activeViewportTab !== "game") {
      shutdownEmulator();
      return;
    }

    if (!pausedRef.current) {
      startEmulatorLoop(true);
    } else {
      stopFrameLoop();
    }

    return () => {
      if (activeViewportTab === "game") {
        shutdownEmulator();
      }
    };
  }, [activeViewportTab, shutdownEmulator, startEmulatorLoop, stopFrameLoop]);

  useEffect(() => {
    if (activeViewportTab !== "game") return;

    if (emulPaused) {
      stopFrameLoop();
    } else {
      startEmulatorLoop(false);
    }
  }, [activeViewportTab, emulPaused, startEmulatorLoop, stopFrameLoop]);

  useEffect(() => {
    if (activeViewportTab !== "game") return;

    function onKeyDown(event: KeyboardEvent) {
      const updated = keyToJoypad(joypadRef.current, event.code, true);
      if (!updated) return;

      event.preventDefault();
      joypadRef.current = updated;
      emulatorSendInput(updated).catch(() => {});
    }

    function onKeyUp(event: KeyboardEvent) {
      const updated = keyToJoypad(joypadRef.current, event.code, false);
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

  useEffect(() => {
    if (activeViewportTab !== "scene") return;

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        isEditableTarget(event.target) ||
        event.key.toLowerCase() !== "g"
      ) {
        return;
      }

      event.preventDefault();
      setGridSnap((current) => !current);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeViewportTab]);

  useEffect(() => {
    if (activeViewportTab !== "scene") return;

    const canvas = sceneCanvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#000000";
    context.fillRect(0, 0, MD_WIDTH, MD_HEIGHT);

    if (gridSnap) {
      context.strokeStyle = "rgba(205,214,244,0.08)";
      context.lineWidth = 1;
      for (let x = 0; x <= MD_WIDTH; x += GRID_SNAP_SIZE) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, MD_HEIGHT);
        context.stroke();
      }
      for (let y = 0; y <= MD_HEIGHT; y += GRID_SNAP_SIZE) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(MD_WIDTH, y);
        context.stroke();
      }
    }

    if (!activeScene) {
      context.fillStyle = "#45475a";
      context.font = "11px monospace";
      context.textAlign = "center";
      context.fillText("320 x 224 - Mega Drive Safe Area", MD_WIDTH / 2, MD_HEIGHT / 2);
      context.fillText("Abra um projeto para ver a cena", MD_WIDTH / 2, MD_HEIGHT / 2 + 16);
      return;
    }

    const colors = [
      "#cba6f7",
      "#89b4fa",
      "#a6e3a1",
      "#fab387",
      "#f38ba8",
      "#94e2d5",
      "#f9e2af",
      "#b4befe",
    ];

    activeScene.background_layers.forEach((layer, index) => {
      context.fillStyle = `rgba(137,180,250,${0.05 + index * 0.03})`;
      context.fillRect(0, 0, MD_WIDTH, MD_HEIGHT);
      context.fillStyle = "#45475a";
      context.font = "9px monospace";
      context.textAlign = "left";
      context.fillText(`BG: ${layer.layer_id}`, 4, 10 + index * 12);
    });

    activeScene.entities.forEach((entity: Entity, index: number) => {
      const x = entity.transform.x;
      const y = entity.transform.y;
      const width = entity.components?.sprite?.frame_width ?? 32;
      const height = entity.components?.sprite?.frame_height ?? 32;
      const isSelected = entity.entity_id === selectedEntityId;
      const color = colors[index % colors.length];

      if (entity.components?.tilemap) {
        const tilemap = entity.components.tilemap;
        const mapWidth = tilemap.map_width * 8;
        const mapHeight = tilemap.map_height * 8;

        context.fillStyle = "rgba(148,226,213,0.08)";
        context.fillRect(x, y, mapWidth, mapHeight);
        context.strokeStyle = "rgba(148,226,213,0.30)";
        context.lineWidth = 0.5;
        for (let tx = 0; tx <= mapWidth; tx += 8) {
          context.beginPath();
          context.moveTo(x + tx, y);
          context.lineTo(x + tx, y + mapHeight);
          context.stroke();
        }
        for (let ty = 0; ty <= mapHeight; ty += 8) {
          context.beginPath();
          context.moveTo(x, y + ty);
          context.lineTo(x + mapWidth, y + ty);
          context.stroke();
        }

        context.strokeStyle = isSelected ? "#94e2d5" : "rgba(148,226,213,0.5)";
        context.lineWidth = isSelected ? 2 : 1;
        context.strokeRect(x, y, mapWidth, mapHeight);
        context.fillStyle = "#94e2d5";
        context.font = "9px monospace";
        context.textAlign = "left";
        context.fillText(`TM ${entity.prefab ?? entity.entity_id}`.slice(0, 16), x + 2, y + 10);
        if (isSelected) {
          context.fillStyle = "rgba(148,226,213,0.15)";
          context.fillRect(x, y, mapWidth, mapHeight);
        }
        return;
      }

      if (entity.components?.camera) {
        const camera = entity.components.camera;
        const viewportWidth = activeTarget === "snes" ? 256 : 320;
        const viewportHeight = 224;
        const offsetX = camera.offset_x ?? 0;
        const offsetY = camera.offset_y ?? 0;

        context.save();
        context.setLineDash([4, 3]);
        context.strokeStyle = isSelected ? "#f9e2af" : "rgba(249,226,175,0.55)";
        context.lineWidth = isSelected ? 2 : 1;
        context.strokeRect(x + offsetX, y + offsetY, viewportWidth, viewportHeight);
        context.setLineDash([]);
        context.restore();

        context.fillStyle = isSelected ? "#f9e2af" : "rgba(249,226,175,0.7)";
        context.font = "9px monospace";
        context.textAlign = "left";
        context.fillText(`CAM ${entity.prefab ?? entity.entity_id}`.slice(0, 16), x + offsetX + 2, y + offsetY + 10);

        context.strokeStyle = isSelected ? "#f9e2af" : "rgba(249,226,175,0.4)";
        context.lineWidth = 1;
        const centerX = x + offsetX + viewportWidth / 2;
        const centerY = y + offsetY + viewportHeight / 2;
        context.beginPath();
        context.moveTo(centerX - 6, centerY);
        context.lineTo(centerX + 6, centerY);
        context.stroke();
        context.beginPath();
        context.moveTo(centerX, centerY - 6);
        context.lineTo(centerX, centerY + 6);
        context.stroke();
        return;
      }

      context.fillStyle = `${color}33`;
      context.fillRect(x, y, width, height);

      context.strokeStyle = isSelected ? "#ffffff" : color;
      context.lineWidth = isSelected ? 2 : 1;
      context.strokeRect(x, y, width, height);

      context.fillStyle = isSelected ? "#ffffff" : color;
      context.font = "9px monospace";
      context.textAlign = "left";
      context.fillText((entity.prefab ?? entity.entity_id).slice(0, 14), x + 2, y + 10);

      context.fillStyle = color;
      context.beginPath();
      context.arc(x + width / 2, y + height / 2, 2, 0, Math.PI * 2);
      context.fill();
    });
  }, [activeScene, activeTarget, activeViewportTab, gridSnap, selectedEntityId]);

  function canvasCoords(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      mx: (event.clientX - rect.left) * (MD_WIDTH / rect.width),
      my: (event.clientY - rect.top) * (MD_HEIGHT / rect.height),
    };
  }

  function hitTest(mx: number, my: number) {
    if (!activeScene) return null;

    for (let index = activeScene.entities.length - 1; index >= 0; index -= 1) {
      const entity = activeScene.entities[index];
      const x = entity.transform.x;
      const y = entity.transform.y;
      const width = entity.components?.sprite?.frame_width ?? 32;
      const height = entity.components?.sprite?.frame_height ?? 32;
      if (mx >= x && mx <= x + width && my >= y && my <= y + height) {
        return entity;
      }
    }

    return null;
  }

  function handleMouseDown(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeScene) return;

    const { mx, my } = canvasCoords(event);
    const entity = hitTest(mx, my);
    if (!entity) {
      setSelectedEntityId(null);
      return;
    }

    setSelectedEntityId(entity.entity_id);
    dragRef.current = {
      entityId: entity.entity_id,
      startMx: mx,
      startMy: my,
      origX: entity.transform.x,
      origY: entity.transform.y,
      lastX: entity.transform.x,
      lastY: entity.transform.y,
      historyCommitted: false,
    };
    beginHistoryCapture();
    setIsDragging(true);
  }

  function handleMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || event.buttons !== 1) return;

    const { mx, my } = canvasCoords(event);
    const dx = Math.round(mx - drag.startMx);
    const dy = Math.round(my - drag.startMy);
    const nextX = gridSnap ? snapToGrid(drag.origX + dx, GRID_SNAP_SIZE) : drag.origX + dx;
    const nextY = gridSnap ? snapToGrid(drag.origY + dy, GRID_SNAP_SIZE) : drag.origY + dy;
    if (nextX === drag.lastX && nextY === drag.lastY) {
      return;
    }

    if (!drag.historyCommitted) {
      commitHistoryCapture();
      drag.historyCommitted = true;
    }

    drag.lastX = nextX;
    drag.lastY = nextY;
    updateEntity(drag.entityId, {
      transform: { x: nextX, y: nextY },
    }, { recordHistory: false });
  }

  async function handleMouseUp() {
    const drag = dragRef.current;
    if (!drag) return;

    dragRef.current = null;
    setIsDragging(false);
    if (!drag.historyCommitted) {
      cancelHistoryCapture();
      return;
    }

    const { activeProjectDir: projectDir } = useEditorStore.getState();
    if (projectDir) {
      try {
        await persistActiveScene(projectDir, "Viewport");
      } catch (error: unknown) {
        logMessage("error", `[Viewport] Falha ao salvar apos mover: ${describeError(error)}`);
      }
    }
  }

  const gameStatus = emulPaused
    ? "Emulador pausado"
    : emulatorActive
      ? "Emulador ativo"
      : "Aguardando emulador...";

  const isSnes = activeTarget === "snes";
  const targetLabel = isSnes ? "SNES" : "Mega Drive";
  const resolution = isSnes ? "256x224" : "320x224";
  const spriteLimit = isSnes ? 128 : 80;
  const bgLayerLimit = 4;

  return (
    <div className="flex h-full flex-col bg-[#1e1e2e]">
      <div className="flex items-center justify-between border-b border-[#313244] bg-[#181825] pr-3">
        <Tabs
          tabs={VIEWPORT_TABS}
          activeTab={activeViewportTab}
          onTabChange={setActiveViewportTab}
          className="flex-1 border-b-0"
        />
        {activeViewportTab === "scene" && (
          <button
            type="button"
            onClick={() => setGridSnap((current) => !current)}
            className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
              gridSnap
                ? "border-[#94e2d5] bg-[#94e2d5]/15 text-[#94e2d5]"
                : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
            }`}
            title="Alternar snap-to-grid de 8px (atalho: G)"
          >
            Snap 8px {gridSnap ? "ON" : "OFF"}
          </button>
        )}
      </div>

      <div
        className={`flex-1 overflow-hidden bg-[#11111b] ${
          activeViewportTab === "logic" || activeViewportTab === "retrofx"
            ? "flex"
            : "flex items-center justify-center"
        }`}
      >
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
                width: MD_WIDTH,
                height: MD_HEIGHT,
                cursor: isDragging ? "grabbing" : "crosshair",
              }}
              title="Clique para selecionar. Arraste para mover."
            />
            <span className="select-none text-[10px] text-[#6c7086]">
              {activeScene
                ? `${activeScene.entities.length} entidade(s) | ${activeScene.background_layers.length} layer(s) | ${gridSnap ? "snap 8px ativo" : "snap livre"} | arraste para mover`
                : "Abra um projeto para visualizar a cena"}
            </span>
          </div>
        )}

        {activeViewportTab === "game" && (
          <div className="flex flex-col items-center gap-2">
            <canvas
              ref={canvasRef}
              width={MD_WIDTH}
              height={MD_HEIGHT}
              data-testid="viewport-game-canvas"
              className="border border-[#45475a] bg-black"
              style={{ imageRendering: "pixelated", width: MD_WIDTH, height: MD_HEIGHT }}
              tabIndex={0}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveState()}
                disabled={saveStateBusy}
                data-testid="viewport-save-state"
                className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-1 text-[10px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saveStateBusy ? "Salvando..." : "Salvar state"}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadState()}
                disabled={loadStateBusy}
                data-testid="viewport-load-state"
                className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loadStateBusy ? "Carregando..." : "Carregar state"}
              </button>
            </div>
            <div className="flex items-center gap-4 select-none text-[10px] text-[#6c7086]">
              <span
                data-testid="viewport-game-status"
                className={emulPaused || emulatorActive ? "text-[#a6e3a1]" : "text-[#45475a]"}
              >
                {gameStatus}
              </span>
              <span>Z=A | X=B | C=C | Enter=Start | Setas=D-Pad</span>
            </div>
          </div>
        )}

        {activeViewportTab === "logic" && (
          <div className="h-full w-full">
            <NodeGraphEditor />
          </div>
        )}

        {activeViewportTab === "retrofx" && (
          <div className="h-full w-full">
            <RetroFXDesigner />
          </div>
        )}
      </div>

      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-[#313244] bg-[#181825] px-3">
        <span className="select-none text-[10px] text-[#45475a]">{targetLabel}</span>
        <span className="select-none text-[10px] text-[#45475a]">{resolution} / 60fps</span>
        <span className="select-none text-[10px] text-[#45475a]">
          Sprites: {activeScene?.entities.length ?? 0} / {spriteLimit}
        </span>
        <span className="select-none text-[10px] text-[#45475a]">
          BG Layers: {activeScene?.background_layers.length ?? 0} / {bgLayerLimit}
        </span>
        {selectedEntityId && !selectedEntityId.startsWith("layer::") && (
          <span className="ml-auto select-none text-[10px] text-[#cba6f7]">
            {activeScene?.entities.find((entity) => entity.entity_id === selectedEntityId)?.prefab ?? selectedEntityId}
          </span>
        )}
      </div>
    </div>
  );
}
