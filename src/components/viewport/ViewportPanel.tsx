import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import Tabs from "../common/Tabs";
import { useEditorStore } from "../../core/store/editorStore";
import {
  JOYPAD_DEFAULT,
  emulatorLoadState,
  emulatorPlayReplay,
  emulatorRewindStep,
  emulatorSaveState,
  emulatorSendInput,
  emulatorStartRecording,
  emulatorStopRecording,
  keyToJoypad,
  listenToAudioStream,
  startFrameLoop,
  type AudioPayload,
  type FramePayload,
  type JoypadState,
} from "../../core/ipc/emulatorService";
import { listenToProjectAssetChanges } from "../../core/ipc/projectWatcherService";
import type { Entity } from "../../core/ipc/sceneService";
import { persistActiveScene } from "../../core/scenePersistence";
import { constrainSpriteFrameSize, ONBOARDING_SPRITE_SIZE } from "../../core/sceneConstraints";
import {
  DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
  hasCanonicalTilemapCells,
  type AssetVisualLoadStatus,
} from "../../core/assetVisualState";
import { createSpriteEntityFromAsset } from "../../core/editorEntityFactory";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { resolveImportedEntityContext } from "../../core/importedEntityContext";
import { resolveProjectAssetPath } from "../../core/pathUtils";
import { summarizeSceneAssetHealth } from "../../core/sceneAssetHealth";
import { resolveSceneWorkspaceContext } from "../../core/sceneWorkspaceContext";
import {
  buildTilemapAuthoringBrush,
  entityHasLogicWorkspace,
  resolveEntitySourceRefs,
} from "../../core/entityAuthoring";
import {
  buildCreatorWorkflowContext,
  resolveEntityFocusTreatment,
} from "../../core/creatorWorkflow";
import { applyKeyColorTransparency } from "../../core/keyColorTransparency";
import { openProjectSourcePath } from "../../core/ipc/projectService";
import {
  clampViewportPan,
  getSceneEntityBounds,
  getViewportPanForWorldPoint,
  resolveSceneWorldMetrics,
} from "../../core/sceneWorldModel";
import SceneAssetHealthBadge from "./SceneAssetHealthBadge";
import { TilePalette } from "../tools/ContextualPalette";
import { getGameViewportScale } from "./gameViewportScale";

const VIEWPORT_TABS = [
  { id: "scene", label: "Cena", icon: "SC" },
  { id: "game", label: "Jogo", icon: "GM" },
  { id: "logic", label: "Logic", icon: "LG" },
  { id: "retrofx", label: "RetroFX", icon: "FX" },
  { id: "artstudio", label: "ArtStudio", icon: "AT" },
];

const NodeGraphEditor = lazy(() => import("../nodegraph/NodeGraphEditor"));
const ArtStudioPanel = lazy(() => import("../artstudio/ArtStudioPanel"));
const RetroFXDesigner = lazy(() => import("../retrofx/RetroFXDesigner"));

const MD_WIDTH = 320;
const MD_HEIGHT = 224;
const GRID_SNAP_SIZE = 8;
const SUB_GRID_SIZE = 4;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4.0;
const AUDIO_QUEUE_TARGET_FRAMES = 3;
const RESIZE_HANDLE_SIZE = 8;
const MIN_ENTITY_SIZE = GRID_SNAP_SIZE;
const SCENE_RULER_SIZE = 18;
const GUIDE_SCREEN_TOLERANCE = 6;
const GAME_VIEWPORT_PADDING = 24;

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type SceneGuideOrientation = "horizontal" | "vertical";

type EntityBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  resizable: boolean;
};

type QueuedAudioChunk = {
  left: Float32Array;
  right: Float32Array;
  offset: number;
};

type ViewportAssetCacheEntry = {
  status: "loading" | "loaded" | "missing" | "error";
  source?: CanvasImageSource;
  width?: number;
  height?: number;
  errorMessage?: string;
};

type SceneGuide = {
  id: string;
  orientation: SceneGuideOrientation;
  position: number;
};

type GuideDragState = {
  id: string;
  orientation: SceneGuideOrientation;
  position: number;
  creating: boolean;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toAssetVisualLoadStatus(entry?: ViewportAssetCacheEntry): AssetVisualLoadStatus {
  if (!entry) {
    return "loading";
  }
  if (entry.status === "loaded") {
    return "loaded";
  }
  if (entry.status === "loading") {
    return "loading";
  }
  if (entry.status === "missing") {
    return "missing";
  }
  return "failed";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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

function getGuideStorageKey(projectDir: string, scenePath: string | null | undefined): string | null {
  if (!projectDir || !scenePath) {
    return null;
  }

  return `rds:scene-guides:${encodeURIComponent(projectDir)}:${encodeURIComponent(scenePath)}`;
}

function loadSceneGuides(storageKey: string | null): SceneGuide[] {
  if (!storageKey) {
    return [];
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is SceneGuide => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof (item as SceneGuide).id === "string" &&
          ((item as SceneGuide).orientation === "horizontal"
            || (item as SceneGuide).orientation === "vertical") &&
          Number.isFinite((item as SceneGuide).position)
        );
      })
      .map((guide) => ({
        id: guide.id,
        orientation: guide.orientation,
        position: Math.round(guide.position),
      }));
  } catch {
    return [];
  }
}

function saveSceneGuides(storageKey: string | null, guides: SceneGuide[]) {
  if (!storageKey) {
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(guides));
  } catch {
    // Ignore localStorage quota / privacy failures in the editor shell.
  }
}

function createSceneGuideId() {
  return `guide_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function WorkspaceViewportFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#09090b] px-4 text-center text-[11px] text-[#64748b]">
      {label}
    </div>
  );
}

function getSgdkOnboardingContent(projectSourceKind: string) {
  if (projectSourceKind === "external_sgdk") {
    return {
      title: "Projeto SGDK legado em overlay",
      body:
        "Este workspace usa um overlay rds/ sobre o host SGDK. Codigo e manifests do host seguem somente leitura, e Build & Run continua delegado ao Makefile do host. Avisos de hardware nesta cena sao informativos, nao bloqueantes.",
    };
  }

  if (projectSourceKind === "imported_sgdk") {
    return {
      title: "Projeto importado de SGDK",
      body:
        "Este projeto ja foi convertido para o formato nativo do RetroDev, mas meta-sprites, VRAM e DMA ainda seguem a semantica do ResComp/SGDK. Avisos de hardware nesta cena continuam informativos, nao bloqueantes.",
    };
  }

  return {
    title: "Projeto vindo de SGDK",
    body:
      "Este projeto veio de uma origem SGDK. Revise warnings de hardware como orientacao de integracao, nao como bloqueio imediato.",
  };
}

function getRulerStep(zoom: number) {
  const options = [4, 8, 16, 32, 64, 128];
  return options.find((step) => step * zoom >= 48) ?? 256;
}

function buildSceneDensityStatus(scene: { entities: Entity[] } | null) {
  const sprites = (scene?.entities ?? []).filter((entity) => Boolean(entity.components?.sprite));
  const counts = new Map<string, number>();
  for (const entity of sprites) {
    const key = `${entity.transform.x}:${entity.transform.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const maxStack = Math.max(0, ...Array.from(counts.values()));
  const overlaps = Array.from(counts.values()).filter((value) => value >= 3).length;
  return {
    spriteCount: sprites.length,
    maxStack,
    overlaps,
    shouldSuggestStaging: sprites.length >= 10 && (maxStack >= 3 || overlaps >= 2),
  };
}

function drawRepeatedAsset(
  context: CanvasRenderingContext2D,
  asset: ViewportAssetCacheEntry,
  x: number,
  y: number,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0
) {
  if (!asset.source || !asset.width || !asset.height) {
    return;
  }

  const tileWidth = Math.max(1, asset.width);
  const tileHeight = Math.max(1, asset.height);
  const normalizedOffsetX = ((offsetX % tileWidth) + tileWidth) % tileWidth;
  const normalizedOffsetY = ((offsetY % tileHeight) + tileHeight) % tileHeight;
  const startX = x - normalizedOffsetX;
  const startY = y - normalizedOffsetY;

  for (let drawY = startY; drawY < y + height; drawY += tileHeight) {
    for (let drawX = startX; drawX < x + width; drawX += tileWidth) {
      context.drawImage(asset.source, drawX, drawY, tileWidth, tileHeight);
    }
  }
}

// ── Tilemap cells render ─────────────────────────────────────────────────────
// Calcula quantas colunas de tiles o tileset real expõe. Um tileset com
// dimensões não-múltiplas do tile (p.ex. palette PNG geradas por ferramentas
// externas) são tratadas com `Math.floor` — slices fora do atlas são ignoradas.
function computeTilesetColumns(
  asset: ViewportAssetCacheEntry,
  tileSize: number
): number {
  if (!asset.width || tileSize <= 0) return 0;
  return Math.max(0, Math.floor(asset.width / tileSize));
}

/**
 * Renderiza a malha pintada (`cells[]`) de um tilemap usando slices reais
 * do tileset. Desenha célula-a-célula com `drawImage(source, sx, sy, ...)`
 * garantindo WYSIWYG entre paleta/ghost/viewport.
 *
 * - Células vazias (índice 0) são puladas.
 * - Índices fora do atlas são desenhados como retângulo de aviso (não silencia).
 * - Scroll inteiro desloca a composição (positivo = puxa para esquerda/topo).
 */
function drawTilemapCells(
  context: CanvasRenderingContext2D,
  asset: ViewportAssetCacheEntry,
  originX: number,
  originY: number,
  mapWidth: number,
  mapHeight: number,
  cells: number[],
  tileSize: number,
  scrollX: number,
  scrollY: number
): void {
  if (!asset.source || tileSize <= 0) return;
  const cols = computeTilesetColumns(asset, tileSize);
  if (cols <= 0) return;
  const totalCells = mapWidth * mapHeight;
  context.save();
  for (let i = 0; i < Math.min(cells.length, totalCells); i++) {
    const value = cells[i] | 0;
    if (value <= 0) continue;
    const atlasIdx = value - 1;
    const ax = (atlasIdx % cols) * tileSize;
    const ay = Math.floor(atlasIdx / cols) * tileSize;
    if (asset.width && ax + tileSize > asset.width) continue;
    if (asset.height && ay + tileSize > asset.height) continue;
    const col = i % mapWidth;
    const row = (i - col) / mapWidth;
    const dx = originX + col * tileSize - scrollX;
    const dy = originY + row * tileSize - scrollY;
    context.drawImage(
      asset.source,
      ax,
      ay,
      tileSize,
      tileSize,
      dx,
      dy,
      tileSize,
      tileSize
    );
  }
  context.restore();
}

function getEntityBounds(
  entity: Entity,
  target: "megadrive" | "snes",
  entities: Entity[] = []
): EntityBounds {
  return getSceneEntityBounds(entity, target, entities);
}

function entityDisplayLabel(entity: Entity): string {
  return getEntityDisplayName(entity);
}

function releaseViewportAsset(entry: ViewportAssetCacheEntry) {
  if (
    entry.source &&
    typeof entry.source === "object" &&
    "close" in entry.source &&
    typeof (entry.source as { close?: () => void }).close === "function"
  ) {
    (entry.source as { close: () => void }).close();
  }
}

function drawResizeHandle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  fillStyle: string
) {
  const half = RESIZE_HANDLE_SIZE / 2;
  context.fillStyle = fillStyle;
  context.fillRect(x - half, y - half, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
  context.strokeStyle = "#11111b";
  context.lineWidth = 1;
  context.strokeRect(x - half, y - half, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
}

function decodePpmP3(content: string): ImageData | null {
  const cleaned = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
  if (!cleaned.startsWith("P3 ")) {
    return null;
  }

  const tokens = cleaned.split(/\s+/);
  if (tokens.length < 4) {
    return null;
  }

  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const maxValue = Number(tokens[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return null;
  }

  const expectedComponents = width * height * 3;
  const values = tokens.slice(4, 4 + expectedComponents).map((token) => Number(token));
  if (values.length !== expectedComponents || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const sourceOffset = index * 3;
    const targetOffset = index * 4;
    pixels[targetOffset] = Math.round((values[sourceOffset] / maxValue) * 255);
    pixels[targetOffset + 1] = Math.round((values[sourceOffset + 1] / maxValue) * 255);
    pixels[targetOffset + 2] = Math.round((values[sourceOffset + 2] / maxValue) * 255);
    pixels[targetOffset + 3] = 255;
  }

  return new ImageData(pixels, width, height);
}

export default function ViewportPanel({
  showWorkspaceTabs = true,
}: {
  showWorkspaceTabs?: boolean;
}) {
  const {
    activeViewportTab,
    setActiveViewportTab,
    setActiveWorkspace,
    logMessage,
    activeScene,
    activeScenePath,
    activeProjectDir,
    hwStatus,
    emulatorLoaded,
    setEmulatorLoaded,
    selectedEntityId,
    setSelectedEntityId,
    updateEntity,
    beginHistoryCapture,
    commitHistoryCapture,
    cancelHistoryCapture,
    activeTarget,
    emulPaused,
    setEmulPaused,
    viewportZoom,
    setViewportZoom,
    resetViewportZoom,
    editorMode,
    setEditorMode,
    activeBrush,
    addEntity,
    removeEntity,
    setActiveBrush,
    updateCollisionMap,
    activeLayerId,
    assignEntityToLayer,
    tilePaintTool,
    activeTilemapId,
    tilePaintSize,
    tilePaintRectPreview,
    setTilePaintRectPreview,
    setActiveTilemapId,
    paintTilemapCell,
    fillTilemapRect,
    fillTilemapFlood,
  } = useEditorStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameViewportStageRef = useRef<HTMLDivElement>(null);
  const sceneStageRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Ciclo Alt+clique em sprites sobrepostos (cena densa). */
  const densePickRef = useRef<{ mx: number; my: number; ids: string[]; idx: number } | null>(null);
  const sceneRulerTopRef = useRef<HTMLCanvasElement>(null);
  const sceneRulerLeftRef = useRef<HTMLCanvasElement>(null);
  const [sceneStageSize, setSceneStageSize] = useState({ width: 0, height: 0 });
  const stopLoopRef = useRef<(() => void) | null>(null);
  const loopStartingRef = useRef(false);
  const loopTokenRef = useRef(0);
  const activeTabRef = useRef(activeViewportTab);
  const pausedRef = useRef(emulPaused);
  const joypadRef = useRef<JoypadState>(JOYPAD_DEFAULT);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioUnlistenRef = useRef<(() => void) | null>(null);
  const audioQueueRef = useRef<QueuedAudioChunk[]>([]);
  const assetCacheRef = useRef<Map<string, ViewportAssetCacheEntry>>(new Map());
  const dragRef = useRef<{
    mode: "move" | "resize";
    entityId: string;
    handle?: ResizeHandle;
    startMx: number;
    startMy: number;
    origX: number;
    origY: number;
    origWidth: number;
    origHeight: number;
    lastX: number;
    lastY: number;
    lastWidth: number;
    lastHeight: number;
    historyCommitted: boolean;
  } | null>(null);
  const paintDragRef = useRef<{
    lastPaintCell: string;
    paintedInDrag: boolean;
  } | null>(null);
  const eraseDragRef = useRef<{
    erasedIds: Set<string>;
    erasedInDrag: boolean;
  } | null>(null);
  const collisionDragRef = useRef<{
    lastPaintTile: number;
    paintedInDrag: boolean;
    /** 1 = paint solid, 0 = erase */
    value: 0 | 1;
  } | null>(null);
  const tileDragRef = useRef<{
    entityId: string;
    tool: "pencil" | "eraser" | "rect";
    /** Para pencil/eraser: último (col,row) pintado — dedup durante drag. */
    lastCellKey: string | null;
    /** Para rect: origem do retângulo. */
    rectOrigin: { col: number; row: number } | null;
    /** Tile a ser aplicado (0 = apaga). */
    tileIndex: number;
    paintedInDrag: boolean;
  } | null>(null);

  const [emulatorActive, setEmulatorActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [gridSnap, setGridSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showSubGrid, setShowSubGrid] = useState(true);
  const [showBackground, setShowBackground] = useState(true);
  const [showTilemaps, setShowTilemaps] = useState(true);
  const [showSprites, setShowSprites] = useState(true);
  const [showCollisionOverlay, setShowCollisionOverlay] = useState(false);
  const [showCameraOverlay, setShowCameraOverlay] = useState(true);
  const [showEntityBounds, setShowEntityBounds] = useState(true);
  const [showEntityLabels, setShowEntityLabels] = useState(true);
  const [showStagingOverlay, setShowStagingOverlay] = useState(false);
  const [showViewportWarnings, setShowViewportWarnings] = useState(false);
  const [showSceneNavigator, setShowSceneNavigator] = useState(false);
  const [showCommandDock, setShowCommandDock] = useState(true);
  const [showKeyColor, setShowKeyColor] = useState(false);
  const [guideSnap, setGuideSnap] = useState(true);
  const [gameViewLight, setGameViewLight] = useState(false);
  const [sceneGuides, setSceneGuides] = useState<SceneGuide[]>([]);
  const [guideDrag, setGuideDrag] = useState<GuideDragState | null>(null);
  const [saveStateBusy, setSaveStateBusy] = useState(false);
  const [loadStateBusy, setLoadStateBusy] = useState(false);
  const [rewindBusy, setRewindBusy] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [playReplayBusy, setPlayReplayBusy] = useState(false);
  const [gameViewportScale, setGameViewportScale] = useState(1);
  const [replayRecording, setReplayRecording] = useState(false);
  const [lastReplayPath, setLastReplayPath] = useState<string | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [assetHotReloadNotice, setAssetHotReloadNotice] = useState<string | null>(null);
  const [showPerformanceOverlay, setShowPerformanceOverlay] = useState(true);
  const [assetCacheVersion, setAssetCacheVersion] = useState(0);
  const [sceneMousePos, setSceneMousePos] = useState<{ x: number; y: number } | null>(null);
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });
  const [clampViewportToWorld, setClampViewportToWorld] = useState(true);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const [sgdkOnboardingDismissed, setSgdkOnboardingDismissed] = useState(
    () => localStorage.getItem("rds:sgdk-onboarding-dismissed") === "1"
  );
  const projectSourceKind = useEditorStore((state) => state.projectSourceKind);
  const isSgdkProject = projectSourceKind === "external_sgdk" || projectSourceKind === "imported_sgdk";
  const hasEmulatorSession = emulatorLoaded || emulatorActive;
  const importedSceneHasAuthoringContent = Boolean(
    activeScene &&
      (activeScene.entities.length > 0 ||
        activeScene.background_layers.length > 0 ||
        (activeScene.layers?.some((layer) => layer.entity_ids.length > 0) ?? false))
  );
  const showSgdkOnboarding =
    isSgdkProject && !sgdkOnboardingDismissed && !importedSceneHasAuthoringContent;
  const sgdkOnboarding = getSgdkOnboardingContent(projectSourceKind);
  const sceneContext = resolveSceneWorkspaceContext({
    scene: activeScene,
    scenePath: activeScenePath,
    projectSourceKind,
  });
  const selectedEntity =
    selectedEntityId && !selectedEntityId.startsWith("layer::")
      ? activeScene?.entities.find((entity) => entity.entity_id === selectedEntityId) ?? null
      : null;
  const sceneWorld = resolveSceneWorldMetrics(activeScene, activeTarget);
  const selectedImportedContext = selectedEntity
    ? resolveImportedEntityContext(selectedEntity)
    : null;
  const selectedEntitySourceRefs = selectedEntity ? resolveEntitySourceRefs(selectedEntity) : [];
  const hotReloadNoticeTimerRef = useRef<number | null>(null);
  const assetIssueLogRef = useRef<Set<string>>(new Set());
  const [shortcutHint, setShortcutHint] = useState<{ key: string; label: string } | null>(null);
  const shortcutHintTimerRef = useRef<number | null>(null);
  /** Lista contextual de entidades sob o ponteiro (Shift+clique em pilha densa). */
  const [denseStackPicker, setDenseStackPicker] = useState<{
    clientX: number;
    clientY: number;
    stack: Entity[];
  } | null>(null);
  const [denseStackFilter, setDenseStackFilter] = useState<"all" | "sprite" | "tilemap" | "camera" | "imported">(
    "all"
  );
  const [denseStackSpotlight, setDenseStackSpotlight] = useState(false);
  const [denseStackPickerIndex, setDenseStackPickerIndex] = useState(0);
  const [denseStackPreviewEntityId, setDenseStackPreviewEntityId] = useState<string | null>(null);
  const [soloEntityId, setSoloEntityId] = useState<string | null>(null);
  const lastOverlayHwStatusRef = useRef(hwStatus);
  const frameTimingRef = useRef<{ lastFrameAt: number; fps: number }>({
    lastFrameAt: 0,
    fps: 0,
  });
  const sceneWidth = sceneWorld.worldWidth;
  const sceneHeight = sceneWorld.worldHeight;
  const sceneFrameWidth = sceneWorld.frame.width;
  const sceneFrameHeight = sceneWorld.frame.height;
  const creatorWorkflow = useMemo(
    () =>
      buildCreatorWorkflowContext({
        scene: activeScene,
        target: activeTarget,
        selectedEntityId,
        activeTilemapId,
        editorMode,
        activeBrushTileIndex: activeBrush?.kind === "tile" ? activeBrush.tileIndex ?? 0 : null,
        tilePaintTool,
        soloEntityId,
      }),
    [
      activeBrush,
      activeScene,
      activeTarget,
      activeTilemapId,
      editorMode,
      selectedEntityId,
      soloEntityId,
      tilePaintTool,
    ]
  );
  const sceneWorldMinX = sceneWorld.bounds.minX;
  const sceneWorldMinY = sceneWorld.bounds.minY;
  const sceneWorldMaxX = sceneWorld.bounds.maxX;
  const sceneWorldMaxY = sceneWorld.bounds.maxY;
  const sceneScaleWidth = Math.round(sceneWidth * viewportZoom);
  const sceneScaleHeight = Math.round(sceneHeight * viewportZoom);
  const sceneChromeOffset = gameViewLight ? 0 : SCENE_RULER_SIZE;
  const sceneGuideStorageKey = getGuideStorageKey(
    activeProjectDir,
    activeScenePath || activeScene?.scene_id || null
  );
  const sceneDensityStatus = useMemo(() => buildSceneDensityStatus(activeScene), [activeScene]);
  const activeTilemapEntityForPalette = useMemo(() => {
    if (!activeScene) {
      return null;
    }
    const id =
      activeTilemapId ??
      (selectedEntity?.components?.tilemap ? selectedEntity.entity_id : null);
    if (!id) {
      return null;
    }
    return activeScene.entities.find((e) => e.entity_id === id && e.components.tilemap) ?? null;
  }, [activeScene, activeTilemapId, selectedEntity]);
  const worldToSceneCanvasX = useCallback(
    (worldX: number) => Math.round((worldX - sceneWorldMinX) * viewportZoom),
    [sceneWorldMinX, viewportZoom]
  );
  const worldToSceneCanvasY = useCallback(
    (worldY: number) => Math.round((worldY - sceneWorldMinY) * viewportZoom),
    [sceneWorldMinY, viewportZoom]
  );
  const scaleSceneDimension = useCallback(
    (worldValue: number) => Math.round(worldValue * viewportZoom),
    [viewportZoom]
  );

  useEffect(() => {
    if (!denseStackPicker) {
      setDenseStackFilter("all");
      setDenseStackSpotlight(false);
      setDenseStackPickerIndex(0);
      setDenseStackPreviewEntityId(null);
      return;
    }
    function handleDocPointerDown(ev: PointerEvent) {
      const root = document.querySelector('[data-testid="viewport-dense-stack-picker"]');
      if (root instanceof HTMLElement && !root.contains(ev.target as Node)) {
        setDenseStackPicker(null);
      }
    }
    document.addEventListener("pointerdown", handleDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", handleDocPointerDown, true);
  }, [denseStackPicker]);
  const denseStackFiltered = useMemo(() => {
    if (!denseStackPicker) {
      return [] as Entity[];
    }
    return denseStackPicker.stack.filter((entity) => {
      if (denseStackFilter === "all") {
        return true;
      }
      if (denseStackFilter === "sprite") {
        return Boolean(entity.components?.sprite);
      }
      if (denseStackFilter === "tilemap") {
        return Boolean(entity.components?.tilemap);
      }
      if (denseStackFilter === "camera") {
        return Boolean(entity.components?.camera);
      }
      return resolveImportedEntityContext(entity).isImported;
    });
  }, [denseStackFilter, denseStackPicker]);
  useEffect(() => {
    if (!soloEntityId) {
      return;
    }
    if (!activeScene?.entities.some((entity) => entity.entity_id === soloEntityId)) {
      setSoloEntityId(null);
    }
  }, [activeScene?.entities, soloEntityId]);
  useEffect(() => {
    if (!denseStackPicker) {
      return;
    }
    const safeIndex = clamp(denseStackPickerIndex, 0, Math.max(0, denseStackFiltered.length - 1));
    if (safeIndex !== denseStackPickerIndex) {
      setDenseStackPickerIndex(safeIndex);
      return;
    }
    const previewEntityId = denseStackFiltered[safeIndex]?.entity_id ?? null;
    if (previewEntityId !== denseStackPreviewEntityId) {
      setDenseStackPreviewEntityId(previewEntityId);
    }
  }, [denseStackFiltered, denseStackPicker, denseStackPickerIndex, denseStackPreviewEntityId]);
  useEffect(() => {
    if (!denseStackPicker) {
      return;
    }
    const picker = denseStackFiltered;
    function handleDensePickerKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDenseStackPicker(null);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setDenseStackPickerIndex((current) =>
          picker.length > 0 ? (current + 1) % picker.length : 0
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setDenseStackPickerIndex((current) =>
          picker.length > 0
            ? (current - 1 + picker.length) % picker.length
            : 0
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const candidate = picker[denseStackPickerIndex];
        if (!candidate) {
          return;
        }
        setSelectedEntityId(candidate.entity_id);
        setDenseStackPicker(null);
        logMessage("info", `[Viewport] Selecionado da pilha: ${getEntityDisplayName(candidate)}.`);
      }
    }
    window.addEventListener("keydown", handleDensePickerKeyDown);
    return () => window.removeEventListener("keydown", handleDensePickerKeyDown);
  }, [denseStackFiltered, denseStackPicker, denseStackPickerIndex, logMessage, setSelectedEntityId]);
  const collisionOversizedForConsole = useMemo(() => {
    const sz = sceneWorld.collisionWorldSize;
    if (!sz) {
      return false;
    }
    return sz.width > sceneFrameWidth || sz.height > sceneFrameHeight;
  }, [sceneFrameHeight, sceneFrameWidth, sceneWorld.collisionWorldSize]);
  const collisionAuthoringWarnings = useMemo(() => {
    const lines = hwStatus?.warnings ?? [];
    return lines.filter((w) => /collision|colis|mapa/i.test(w)).slice(0, 3);
  }, [hwStatus?.warnings]);
  const showWorldAuthoringStrip =
    activeViewportTab === "scene" &&
    !gameViewLight &&
    Boolean(activeScene) &&
    (sceneWorld.largeWorld || collisionOversizedForConsole);
  const visibleWorldRect = useMemo(() => {
    if (sceneStageSize.width <= 0 || sceneStageSize.height <= 0 || viewportZoom <= 0) {
      return null;
    }
    const contentWidth = sceneScaleWidth + sceneChromeOffset;
    const contentHeight = sceneScaleHeight + sceneChromeOffset;
    const contentLeft =
      sceneStageSize.width / 2 - contentWidth / 2 + viewportPan.x + sceneChromeOffset;
    const contentTop =
      sceneStageSize.height / 2 - contentHeight / 2 + viewportPan.y + sceneChromeOffset;
    const minX = sceneWorld.bounds.minX + (0 - contentLeft) / viewportZoom;
    const minY = sceneWorld.bounds.minY + (0 - contentTop) / viewportZoom;
    const maxX = sceneWorld.bounds.minX + (sceneStageSize.width - contentLeft) / viewportZoom;
    const maxY = sceneWorld.bounds.minY + (sceneStageSize.height - contentTop) / viewportZoom;
    return {
      x: Math.max(sceneWorld.bounds.minX, minX),
      y: Math.max(sceneWorld.bounds.minY, minY),
      width: Math.min(sceneWorld.bounds.maxX, maxX) - Math.max(sceneWorld.bounds.minX, minX),
      height: Math.min(sceneWorld.bounds.maxY, maxY) - Math.max(sceneWorld.bounds.minY, minY),
    };
  }, [
    sceneChromeOffset,
    sceneScaleHeight,
    sceneScaleWidth,
    sceneStageSize.height,
    sceneStageSize.width,
    sceneWorld.bounds.maxX,
    sceneWorld.bounds.maxY,
    sceneWorld.bounds.minX,
    sceneWorld.bounds.minY,
    viewportPan.x,
    viewportPan.y,
    viewportZoom,
  ]);
  const cameraWindowRect = useMemo(() => {
    const cameraX = sceneWorld.camera?.x ?? Math.round(sceneWorld.centerX - sceneFrameWidth / 2);
    const cameraY = sceneWorld.camera?.y ?? Math.round(sceneWorld.centerY - sceneFrameHeight / 2);
    return {
      left: (cameraX - sceneWorld.bounds.minX) * viewportZoom + sceneChromeOffset,
      top: (cameraY - sceneWorld.bounds.minY) * viewportZoom + sceneChromeOffset,
      width: sceneFrameWidth * viewportZoom,
      height: sceneFrameHeight * viewportZoom,
    };
  }, [
    sceneChromeOffset,
    sceneFrameHeight,
    sceneFrameWidth,
    sceneWorld.bounds.minX,
    sceneWorld.bounds.minY,
    sceneWorld.camera?.x,
    sceneWorld.camera?.y,
    sceneWorld.centerX,
    sceneWorld.centerY,
    viewportZoom,
  ]);
  const clampPanToStage = useCallback(
    (pan: { x: number; y: number }, zoom = viewportZoom) => {
      const stageRect = sceneStageRef.current?.getBoundingClientRect();
      if (!stageRect) {
        return pan;
      }
      return clampViewportPan({
        enabled: clampViewportToWorld,
        pan,
        stageWidth: stageRect.width,
        stageHeight: stageRect.height,
        contentWidth: Math.round(sceneWidth * zoom) + sceneChromeOffset,
        contentHeight: Math.round(sceneHeight * zoom) + sceneChromeOffset,
      });
    },
    [clampViewportToWorld, sceneChromeOffset, sceneHeight, sceneWidth, viewportZoom]
  );
  const focusWorldPoint = useCallback(
    (pointX: number, pointY: number, nextZoom = viewportZoom) => {
      const nextPan = getViewportPanForWorldPoint({
        pointX,
        pointY,
        zoom: nextZoom,
        worldBounds: sceneWorld.bounds,
        worldWidth: sceneWidth,
        worldHeight: sceneHeight,
        contentOffset: sceneChromeOffset,
      });
      setViewportPan(clampPanToStage(nextPan, nextZoom));
    },
    [clampPanToStage, sceneChromeOffset, sceneHeight, sceneWidth, sceneWorld.bounds, viewportZoom]
  );
  const focusEntityInViewport = useCallback(
    (entity: Entity) => {
      const bounds = getEntityBounds(entity, activeTarget, activeScene?.entities ?? []);
      focusWorldPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    },
    [activeScene?.entities, activeTarget, focusWorldPoint]
  );
  const focusSelectedEntity = useCallback(() => {
    if (!selectedEntity) {
      return;
    }
    focusEntityInViewport(selectedEntity);
  }, [focusEntityInViewport, selectedEntity]);
  const focusActiveTilemapEntity = useCallback(() => {
    if (!activeTilemapEntityForPalette) {
      logMessage("warn", "[Viewport] Nenhum tilemap ativo para focar.");
      return;
    }
    focusEntityInViewport(activeTilemapEntityForPalette);
    logMessage(
      "info",
      `[Viewport] Tilemap ativo focado: ${getEntityDisplayName(activeTilemapEntityForPalette)}.`
    );
  }, [activeTilemapEntityForPalette, focusEntityInViewport, logMessage]);
  const selectDenseStackEntity = useCallback(
    (entity: Entity, options: { focus?: boolean; solo?: boolean } = {}) => {
      setSelectedEntityId(entity.entity_id);
      if (options.solo) {
        setSoloEntityId(entity.entity_id);
      }
      if (options.focus) {
        focusEntityInViewport(entity);
      }
      setDenseStackPicker(null);
      logMessage(
        "info",
        `[Viewport] Selecionado da pilha: ${getEntityDisplayName(entity)}${options.solo ? " (solo ativo)" : ""}.`
      );
    },
    [focusEntityInViewport, logMessage, setSelectedEntityId]
  );
  const toggleSelectedEntitySolo = useCallback(() => {
    if (!selectedEntity) {
      return;
    }
    setSoloEntityId((current) => {
      const next = current === selectedEntity.entity_id ? null : selectedEntity.entity_id;
      logMessage(
        "info",
        next
          ? `[Viewport] Solo temporario ligado para '${getEntityDisplayName(selectedEntity)}'.`
          : "[Viewport] Solo temporario desligado."
      );
      return next;
    });
  }, [logMessage, selectedEntity]);
  const openSelectedEntityLogic = useCallback(() => {
    if (!selectedEntity || !entityHasLogicWorkspace(selectedEntity)) {
      return;
    }
    setActiveWorkspace("logic");
    setActiveViewportTab("logic");
    setSelectedEntityId(selectedEntity.entity_id);
    logMessage(
      "info",
      `[Viewport] Navegando para Logic Workspace: ${getEntityDisplayName(selectedEntity)}.`
    );
  }, [logMessage, selectedEntity, setActiveViewportTab, setActiveWorkspace, setSelectedEntityId]);
  const openSelectedEntityArt = useCallback(() => {
    if (!selectedEntity?.components.sprite) {
      return;
    }
    setActiveWorkspace("artstudio");
    setActiveViewportTab("artstudio");
    setSelectedEntityId(selectedEntity.entity_id);
    logMessage(
      "info",
      `[Viewport] Navegando para Art Workspace: ${getEntityDisplayName(selectedEntity)}.`
    );
  }, [logMessage, selectedEntity, setActiveViewportTab, setActiveWorkspace, setSelectedEntityId]);
  const openSelectedEntityTilemap = useCallback(() => {
    if (!selectedEntity?.components.tilemap) {
      return;
    }
    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
    setSelectedEntityId(selectedEntity.entity_id);
    setActiveTilemapId(selectedEntity.entity_id);
    setEditorMode("paint");
    const brush = buildTilemapAuthoringBrush(selectedEntity);
    if (brush) {
      setActiveBrush(brush);
    }
    logMessage(
      "info",
      `[Viewport] Tilemap '${getEntityDisplayName(selectedEntity)}' travado para pintura no stage.`
    );
  }, [
    logMessage,
    selectedEntity,
    setActiveBrush,
    setActiveTilemapId,
    setActiveViewportTab,
    setActiveWorkspace,
    setEditorMode,
    setSelectedEntityId,
  ]);
  const openSelectedEntityPrimarySource = useCallback(async () => {
    if (!activeProjectDir) {
      logMessage("warn", "[Viewport] Abra um projeto antes de abrir a fonte real.");
      return;
    }
    const primarySourceRef = selectedEntitySourceRefs[0]?.trim();
    if (!primarySourceRef) {
      logMessage("warn", "[Viewport] Nenhuma fonte rastreavel para a entidade selecionada.");
      return;
    }
    try {
      const result = await openProjectSourcePath(activeProjectDir, primarySourceRef);
      if (!result?.ok) {
        throw new Error(result?.message ?? "Falha ao abrir a fonte no host.");
      }
      logMessage("info", `[Viewport] Fonte aberta: ${primarySourceRef}`);
    } catch (error) {
      logMessage(
        "error",
        `[Viewport] Falha ao abrir '${primarySourceRef}': ${describeError(error)}`
      );
    }
  }, [activeProjectDir, logMessage, selectedEntitySourceRefs]);
  const centerViewportOnCamera = useCallback(() => {
    focusWorldPoint(sceneWorld.centerX, sceneWorld.centerY);
  }, [focusWorldPoint, sceneWorld.centerX, sceneWorld.centerY]);
  const resetSceneView = useCallback(() => {
    resetViewportZoom();
    window.setTimeout(() => {
      focusWorldPoint(sceneWorld.centerX, sceneWorld.centerY, 1);
    }, 0);
  }, [focusWorldPoint, resetViewportZoom, sceneWorld.centerX, sceneWorld.centerY]);
  const focusCollisionMapCenter = useCallback(() => {
    const sz = sceneWorld.collisionWorldSize;
    if (sz) {
      focusWorldPoint(sz.width / 2, sz.height / 2);
      logMessage(
        "info",
        "[Viewport] Centro do mapa de colisao focado (ferramenta de autoria: mundo maior que a janela MD)."
      );
    } else {
      focusWorldPoint(sceneWorld.centerX, sceneWorld.centerY);
      logMessage("info", "[Viewport] Sem collision_map dimensionado; foco no centro do mundo.");
    }
  }, [focusWorldPoint, logMessage, sceneWorld.centerX, sceneWorld.centerY, sceneWorld.collisionWorldSize]);
  const applyAuthoringStagingLayout = useCallback(() => {
    if (!activeScene) {
      return;
    }
    const spriteEntities = activeScene.entities.filter((entity) => entity.components?.sprite);
    if (spriteEntities.length < 2) {
      logMessage("info", "[Viewport] Cena sem densidade suficiente para staging de autoria.");
      return;
    }
    beginHistoryCapture();
    try {
      spriteEntities.forEach((entity, index) => {
        const row = Math.floor(index / 8);
        const col = index % 8;
        const nextX = sceneWorld.bounds.minX + 40 + col * 56;
        const nextY = sceneWorld.bounds.minY + 48 + row * 56;
        const semantics = entity.components.logic?.imported_semantics;
        const auditFlags = Array.from(
          new Set([...(semantics?.audit_flags ?? []), "position:staging_layout"])
        );
        updateEntity(
          entity.entity_id,
          {
            transform: {
              ...entity.transform,
              x: nextX,
              y: nextY,
            },
            components: {
              ...entity.components,
              logic: entity.components.logic
                ? {
                    ...entity.components.logic,
                    imported_semantics: semantics
                      ? { ...semantics, audit_flags: auditFlags }
                      : entity.components.logic.imported_semantics,
                  }
                : entity.components.logic,
            },
          },
          { recordHistory: false }
        );
      });
      commitHistoryCapture();
      logMessage(
        "info",
        `[Viewport] Staging de autoria aplicado em ${spriteEntities.length} sprite(s) para remover sobreposicao densa.`
      );
    } catch (error) {
      cancelHistoryCapture();
      logMessage("error", `[Viewport] Falha ao aplicar staging de autoria: ${describeError(error)}`);
    }
  }, [
    activeScene,
    beginHistoryCapture,
    cancelHistoryCapture,
    commitHistoryCapture,
    logMessage,
    sceneWorld.bounds.minX,
    sceneWorld.bounds.minY,
    updateEntity,
  ]);

  activeTabRef.current = activeViewportTab;
  pausedRef.current = emulPaused;

  useEffect(() => {
    for (const entry of assetCacheRef.current.values()) {
      releaseViewportAsset(entry);
    }
    assetCacheRef.current.clear();
    setAssetCacheVersion((current) => current + 1);
  }, [activeProjectDir]);

  useEffect(() => {
    if (activeViewportTab !== "scene") {
      setViewportPan({ x: 0, y: 0 });
      panDragRef.current = null;
      setIsPanning(false);
    }
  }, [activeViewportTab]);

  useEffect(() => {
    if (activeViewportTab !== "scene") {
      return;
    }
    const stage = sceneStageRef.current;
    if (!stage) {
      return;
    }
    const syncSize = () => {
      const rect = stage.getBoundingClientRect();
      setSceneStageSize({ width: rect.width, height: rect.height });
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(stage);
    window.addEventListener("resize", syncSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSize);
    };
  }, [activeViewportTab]);

  useEffect(() => {
    setViewportPan((current) => {
      const next = clampPanToStage(current);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [clampPanToStage]);

  useEffect(() => {
    if (activeViewportTab !== "scene" || !activeScene?.scene_id) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      centerViewportOnCamera();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeScene?.scene_id, activeScenePath, activeViewportTab, centerViewportOnCamera]);

  useEffect(() => {
    setSceneGuides(loadSceneGuides(sceneGuideStorageKey));
  }, [sceneGuideStorageKey]);

  useEffect(() => {
    setSceneGuides((current) =>
      current
        .map((guide) => ({
          ...guide,
          position: clamp(
            guide.position,
            0,
            guide.orientation === "vertical" ? sceneWidth : sceneHeight
          ),
        }))
        .sort((left, right) => left.position - right.position)
    );
  }, [sceneHeight, sceneWidth]);

  useEffect(() => {
    saveSceneGuides(sceneGuideStorageKey, sceneGuides);
  }, [sceneGuideStorageKey, sceneGuides]);

  useEffect(() => {
    if (gameViewLight) {
      setSceneMousePos(null);
    }
  }, [gameViewLight]);

  useEffect(() => {
    for (const entry of assetCacheRef.current.values()) {
      releaseViewportAsset(entry);
    }
    assetCacheRef.current.clear();
    setAssetCacheVersion((current) => current + 1);
  }, [showKeyColor]);

  const getViewportAsset = useCallback(
    (relativePath?: string | null): ViewportAssetCacheEntry | null => {
      if (!activeProjectDir || !relativePath) {
        return null;
      }

      const absolutePath = resolveProjectAssetPath(activeProjectDir, relativePath);
      const cached = assetCacheRef.current.get(absolutePath);
      if (cached) {
        return cached;
      }

      const cacheEntry: ViewportAssetCacheEntry = { status: "loading" };
      assetCacheRef.current.set(absolutePath, cacheEntry);
      const assetUrl = convertFileSrc(absolutePath);
      const markLoaded = (source: CanvasImageSource, width: number, height: number) => {
        assetCacheRef.current.set(absolutePath, {
          status: "loaded",
          source,
          width,
          height,
        });
        setAssetCacheVersion((current) => current + 1);
      };
      const markFailure = (status: "missing" | "error", detail?: string) => {
        const issueKey = `${absolutePath}::${status}`;
        const message =
          status === "missing"
            ? `[Viewport] Asset ausente: '${relativePath}' (${absolutePath}).`
            : `[Viewport] Falha ao carregar asset: '${relativePath}' (${absolutePath}).`;
        const fullMessage = detail ? `${message} ${detail}` : message;
        if (!assetIssueLogRef.current.has(issueKey)) {
          assetIssueLogRef.current.add(issueKey);
          logMessage(status === "missing" ? "warn" : "error", fullMessage);
        }
        assetCacheRef.current.set(absolutePath, { status, errorMessage: fullMessage });
        setAssetCacheVersion((current) => current + 1);
      };
      const loadImageElement = (imageSrc: string, options?: { revokeOnLoad?: boolean; fallbackToAssetUrl?: boolean }) => {
        const image = new Image();
        image.onload = () => {
          if (options?.revokeOnLoad && typeof URL.revokeObjectURL === "function") {
            URL.revokeObjectURL(imageSrc);
          }
          markLoaded(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
        };
        image.onerror = () => {
          if (options?.revokeOnLoad && typeof URL.revokeObjectURL === "function") {
            URL.revokeObjectURL(imageSrc);
          }
          if (options?.fallbackToAssetUrl && imageSrc !== assetUrl) {
            loadImageElement(assetUrl);
            return;
          }
          markFailure("error", "Decode/draw Image falhou no WebView.");
        };
        image.src = imageSrc;
      };

      if (relativePath.toLowerCase().endsWith(".ppm")) {
        void fetch(assetUrl)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            return response.text();
          })
          .then((content) => {
            const imageData = decodePpmP3(content);
            if (!imageData) {
              throw new Error("PPM P3 invalido");
            }
            const processed = applyKeyColorTransparency(imageData, { showKeyColor }).imageData;

            const canvas = document.createElement("canvas");
            canvas.width = processed.width;
            canvas.height = processed.height;
            const context = canvas.getContext("2d");
            if (!context) {
              throw new Error("Canvas indisponivel");
            }
            context.putImageData(processed, 0, 0);

            markLoaded(canvas, canvas.width, canvas.height);
          })
          .catch((err) => {
            const detail = describeError(err);
            const status = detail.includes("HTTP 404") ? "missing" : "error";
            markFailure(status, `PPM fetch falhou: ${detail}`);
          });

        return cacheEntry;
      }

      void fetch(assetUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.blob();
        })
        .then((blob) => {
          if (typeof createImageBitmap === "function") {
            return createImageBitmap(blob).then((bitmap) => {
              const canvas = document.createElement("canvas");
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
              const context = canvas.getContext("2d");
              if (!context) {
                markLoaded(bitmap, bitmap.width, bitmap.height);
                return;
              }
              context.drawImage(bitmap, 0, 0);
              const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
              const processed = applyKeyColorTransparency(imageData, { showKeyColor });
              if (!processed.detected) {
                markLoaded(bitmap, bitmap.width, bitmap.height);
                return;
              }
              context.putImageData(processed.imageData, 0, 0);
              bitmap.close?.();
              markLoaded(canvas, canvas.width, canvas.height);
            });
          }

          if (typeof URL.createObjectURL === "function") {
            loadImageElement(URL.createObjectURL(blob), {
              revokeOnLoad: true,
              fallbackToAssetUrl: true,
            });
            return;
          }

          loadImageElement(assetUrl);
        })
        .catch((err) => {
          const detail = describeError(err);
          if (detail.includes("HTTP 404")) {
            markFailure("missing", `fetch retornou 404 para ${assetUrl}.`);
            return;
          }
          logMessage(
            "warn",
            `[Viewport] fetch do asset '${relativePath}' falhou (${detail}); tentando fallback Image().`
          );
          loadImageElement(assetUrl);
        });
      return cacheEntry;
    },
    [activeProjectDir, logMessage, showKeyColor]
  );

  // Pré-carregamento de assets da cena para garantir WYSIWYG no primeiro frame
  useEffect(() => {
    if (activeViewportTab !== "scene" || !activeScene || !activeProjectDir) return;
    activeScene.entities.forEach((entity) => {
      const sprite = entity.components?.sprite;
      if (sprite?.asset) {
        getViewportAsset(sprite.asset);
      }
      const tilemap = entity.components?.tilemap;
      if (tilemap?.tileset) {
        getViewportAsset(tilemap.tileset);
      }
    });
    activeScene.background_layers.forEach((layer) => {
      const backgroundAsset = layer.tilemap ?? layer.tileset;
      if (backgroundAsset) {
        getViewportAsset(backgroundAsset);
      }
    });
  }, [activeViewportTab, activeScene, activeProjectDir, getViewportAsset]);

  const getGuideSnapStep = useCallback(() => {
    return showSubGrid ? SUB_GRID_SIZE : GRID_SNAP_SIZE;
  }, [showSubGrid]);

  const snapPositionToGuides = useCallback(
    (value: number, orientation: SceneGuideOrientation) => {
      if (!guideSnap || sceneGuides.length === 0) {
        return value;
      }

      const threshold = GUIDE_SCREEN_TOLERANCE / Math.max(viewportZoom, 0.25);
      let best = value;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const guide of sceneGuides) {
        if (guide.orientation !== orientation) {
          continue;
        }
        const distance = Math.abs(guide.position - value);
        if (distance <= threshold && distance < bestDistance) {
          best = guide.position;
          bestDistance = distance;
        }
      }

      return best;
    },
    [guideSnap, sceneGuides, viewportZoom]
  );

  const getSceneCoordsFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const frame = sceneOverlayCanvasRef.current ?? sceneCanvasRef.current;
      if (!frame) {
        return null;
      }

      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      return {
        x: sceneWorldMinX + clamp(((clientX - rect.left) / rect.width) * sceneWidth, 0, sceneWidth),
        y: sceneWorldMinY + clamp(((clientY - rect.top) / rect.height) * sceneHeight, 0, sceneHeight),
      };
    },
    [sceneHeight, sceneWidth, sceneWorldMinX, sceneWorldMinY]
  );

  const handleSceneStageWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (activeViewportTab !== "scene") {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        const nextZoom = clamp(
          viewportZoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP),
          ZOOM_MIN,
          ZOOM_MAX
        );
        if (nextZoom === viewportZoom) {
          return;
        }
        const worldPoint = getSceneCoordsFromClient(event.clientX, event.clientY);
        setViewportZoom(nextZoom);
        if (worldPoint) {
          window.requestAnimationFrame(() => {
            focusWorldPoint(worldPoint.x, worldPoint.y, nextZoom);
          });
        }
        return;
      }

      if (!sceneWorld.largeWorld && clampViewportToWorld) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setViewportPan((current) =>
        clampPanToStage(
          {
            x: current.x - event.deltaX,
            y: current.y - event.deltaY,
          },
          viewportZoom
        )
      );
    },
    [
      activeViewportTab,
      clampPanToStage,
      clampViewportToWorld,
      focusWorldPoint,
      getSceneCoordsFromClient,
      sceneWorld.largeWorld,
      setViewportZoom,
      viewportZoom,
    ]
  );

  const startGuideDrag = useCallback(
    (orientation: SceneGuideOrientation, clientX: number, clientY: number, guideId?: string) => {
      const coords = getSceneCoordsFromClient(clientX, clientY);
      if (!coords) {
        return;
      }

      const axisLimit = orientation === "vertical" ? sceneWidth : sceneHeight;
      const axisValue = orientation === "vertical" ? coords.x : coords.y;
      const snapStep = getGuideSnapStep();
      const snapped = guideSnap ? snapToGrid(axisValue, snapStep) : axisValue;
      const clamped = clamp(Math.round(snapped), 0, axisLimit);
      setGuideDrag({
        id: guideId ?? createSceneGuideId(),
        orientation,
        position: clamped,
        creating: !guideId,
      });
    },
    [getGuideSnapStep, getSceneCoordsFromClient, guideSnap, sceneHeight, sceneWidth]
  );

  const getGuideHit = useCallback(
    (mx: number, my: number) => {
      const tolerance = GUIDE_SCREEN_TOLERANCE / Math.max(viewportZoom, 0.25);
      let bestGuide: SceneGuide | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const guide of sceneGuides) {
        const distance = guide.orientation === "vertical"
          ? Math.abs(mx - guide.position)
          : Math.abs(my - guide.position);
        if (distance <= tolerance && distance < bestDistance) {
          bestGuide = guide;
          bestDistance = distance;
        }
      }

      return bestGuide;
    },
    [sceneGuides, viewportZoom]
  );

  const renderFrame = useCallback((payload: FramePayload) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const imageData = context.createImageData(payload.width, payload.height);
    imageData.data.set(new Uint8Array(payload.rgba));
    context.putImageData(imageData, 0, 0);

    const now = performance.now();
    if (frameTimingRef.current.lastFrameAt > 0) {
      const deltaMs = now - frameTimingRef.current.lastFrameAt;
      const nextFps = deltaMs > 0 ? 1000 / deltaMs : 0;
      frameTimingRef.current.fps = frameTimingRef.current.fps === 0
        ? nextFps
        : (frameTimingRef.current.fps * 0.8) + (nextFps * 0.2);
    }
    frameTimingRef.current.lastFrameAt = now;
  }, []);

  const clearAudioQueue = useCallback(() => {
    audioQueueRef.current = [];
  }, []);

  const fillAudioOutput = useCallback((left: Float32Array, right: Float32Array) => {
    for (let index = 0; index < left.length; index += 1) {
      let chunk = audioQueueRef.current[0];
      while (chunk && chunk.offset >= chunk.left.length) {
        audioQueueRef.current.shift();
        chunk = audioQueueRef.current[0];
      }

      if (!chunk) {
        left[index] = 0;
        right[index] = 0;
        continue;
      }

      left[index] = chunk.left[chunk.offset] ?? 0;
      right[index] = chunk.right[chunk.offset] ?? 0;
      chunk.offset += 1;
    }
  }, []);

  const disposeAudioPlayback = useCallback(() => {
    clearAudioQueue();
    audioUnlistenRef.current?.();
    audioUnlistenRef.current = null;

    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current = null;
    }
    if (audioGainRef.current) {
      audioGainRef.current.disconnect();
      audioGainRef.current = null;
    }

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) {
      void context.close().catch(() => {});
    }
  }, [clearAudioQueue]);

  const ensureAudioPlayback = useCallback(
    async (sampleRate: number) => {
      if (audioContextRef.current) {
        return audioContextRef.current;
      }

      const AudioContextCtor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return null;
      }

      const context = new AudioContextCtor({
        sampleRate,
      });
      const gainNode = context.createGain();
      gainNode.gain.value = audioMuted ? 0 : 1;

      const processor = context.createScriptProcessor(1024, 0, 2);
      processor.onaudioprocess = (event) => {
        fillAudioOutput(
          event.outputBuffer.getChannelData(0),
          event.outputBuffer.getChannelData(1)
        );
      };

      processor.connect(gainNode);
      gainNode.connect(context.destination);

      audioContextRef.current = context;
      audioGainRef.current = gainNode;
      audioProcessorRef.current = processor;

      if (pausedRef.current) {
        await context.suspend();
      } else {
        await context.resume();
      }

      return context;
    },
    [audioMuted, fillAudioOutput]
  );

  const enqueueAudio = useCallback((payload: AudioPayload) => {
    const frameCount = Math.floor(payload.samples.length / 2);
    if (frameCount === 0) {
      return;
    }

    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);
    for (let index = 0; index < frameCount; index += 1) {
      left[index] = (payload.samples[index * 2] ?? 0) / 32768;
      right[index] = (payload.samples[(index * 2) + 1] ?? 0) / 32768;
    }

    audioQueueRef.current.push({ left, right, offset: 0 });
    const maxQueuedFrames = Math.max(
      Math.floor((payload.sample_rate / 60) * AUDIO_QUEUE_TARGET_FRAMES),
      1
    );
    let queuedFrames = audioQueueRef.current.reduce(
      (total, chunk) => total + (chunk.left.length - chunk.offset),
      0
    );
    while (queuedFrames > maxQueuedFrames && audioQueueRef.current.length > 0) {
      const dropped = audioQueueRef.current.shift();
      queuedFrames -= dropped ? dropped.left.length - dropped.offset : 0;
    }
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

  const detachViewportRuntime = useCallback(() => {
    stopFrameLoop();
    disposeAudioPlayback();
  }, [disposeAudioPlayback, stopFrameLoop]);

  const showHotReloadNotice = useCallback((message: string) => {
    setAssetHotReloadNotice(message);
    if (hotReloadNoticeTimerRef.current !== null) {
      window.clearTimeout(hotReloadNoticeTimerRef.current);
    }
    hotReloadNoticeTimerRef.current = window.setTimeout(() => {
      setAssetHotReloadNotice(null);
      hotReloadNoticeTimerRef.current = null;
    }, 4000);
  }, []);

  const startEmulatorLoop = useCallback(
    (logStartup: boolean) => {
      if (!emulatorLoaded || loopStartingRef.current || stopLoopRef.current) return;

      const token = loopTokenRef.current + 1;
      loopTokenRef.current = token;
      loopStartingRef.current = true;

      startFrameLoop(renderFrame, (message) => {
        if (loopTokenRef.current !== token) {
          return;
        }
        stopFrameLoop();
        if (message.includes("Nenhum core Libretro")) {
          setEmulatorLoaded(false);
        }
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
    [emulatorLoaded, logMessage, renderFrame, setEmulatorLoaded, stopFrameLoop]
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

  const handleRewind = useCallback(async () => {
    if (!emulPaused || rewindBusy) {
      return;
    }

    setRewindBusy(true);
    try {
      const result = await emulatorRewindStep();
      if (!result.ok) {
        logMessage("warn", `[Rewind] ${result.message}`);
        return;
      }
      logMessage("success", `[Rewind] ${result.message}`);
    } catch (error: unknown) {
      logMessage("error", `[Rewind] Falha ao restaurar snapshot: ${describeError(error)}`);
    } finally {
      setRewindBusy(false);
    }
  }, [emulPaused, logMessage, rewindBusy]);

  const handlePause = useCallback(() => {
    if (!hasEmulatorSession || emulPaused) {
      return;
    }

    setEmulPaused(true);
    logMessage("info", "Emulador pausado.");
  }, [emulPaused, hasEmulatorSession, logMessage, setEmulPaused]);

  const handleResume = useCallback(() => {
    if (!hasEmulatorSession || !emulPaused) {
      return;
    }

    setEmulPaused(false);
    logMessage("info", "Emulador retomado.");
  }, [emulPaused, hasEmulatorSession, logMessage, setEmulPaused]);

  const handleStartRecording = useCallback(async () => {
    if (!emulatorLoaded || recordBusy || replayRecording) {
      return;
    }

    setRecordBusy(true);
    try {
      const result = await emulatorStartRecording();
      if (!result.ok) {
        logMessage("error", `[Replay] ${result.message}`);
        return;
      }
      setReplayRecording(true);
      logMessage("success", `[Replay] ${result.message}`);
    } catch (error: unknown) {
      logMessage("error", `[Replay] Falha ao iniciar gravacao: ${describeError(error)}`);
    } finally {
      setRecordBusy(false);
    }
  }, [emulatorLoaded, logMessage, recordBusy, replayRecording]);

  const handleStopRecording = useCallback(async () => {
    if (!activeProjectDir || recordBusy || !replayRecording) {
      return;
    }

    setRecordBusy(true);
    try {
      const result = await emulatorStopRecording(activeProjectDir);
      if (!result.ok) {
        logMessage("error", `[Replay] ${result.message}`);
        return;
      }
      setReplayRecording(false);
      setLastReplayPath(result.replay_path || null);
      logMessage(
        "success",
        `[Replay] ${result.frames_recorded} frame(s) salvos em ${result.replay_path}`
      );
    } catch (error: unknown) {
      logMessage("error", `[Replay] Falha ao finalizar gravacao: ${describeError(error)}`);
    } finally {
      setRecordBusy(false);
    }
  }, [activeProjectDir, logMessage, recordBusy, replayRecording]);

  const handleStepFrame = useCallback(async () => {
    if (!hasEmulatorSession || !emulPaused || stepBusy) {
      return;
    }

    setStepBusy(true);
    let stopStepLoop: (() => void) | null = null;
    let resolved = false;

    try {
      stopStepLoop = await startFrameLoop(
        (payload) => {
          renderFrame(payload);
          if (resolved) {
            return;
          }
          resolved = true;
          stopStepLoop?.();
          stopStepLoop = null;
          setStepBusy(false);
          logMessage("info", "Frame unico executado.");
        },
        (message) => {
          if (resolved) {
            return;
          }
          resolved = true;
          setStepBusy(false);
          logMessage("error", `Falha ao executar frame unico: ${message}`);
        }
      );
    } catch (error: unknown) {
      if (!resolved) {
        setStepBusy(false);
        logMessage("error", `Falha ao iniciar frame unico: ${describeError(error)}`);
      }
    }
  }, [emulPaused, hasEmulatorSession, logMessage, renderFrame, startFrameLoop, stepBusy]);

  const handlePlayReplay = useCallback(async () => {
    if (!lastReplayPath || playReplayBusy || replayRecording || !emulPaused) {
      return;
    }

    setPlayReplayBusy(true);
    try {
      const result = await emulatorPlayReplay(lastReplayPath);
      if (!result.ok) {
        logMessage("error", `[Replay] ${result.message}`);
        return;
      }
      logMessage(
        result.framebuffer_match === false ? "warn" : "success",
        `[Replay] ${result.message}`
      );
    } catch (error: unknown) {
      logMessage("error", `[Replay] Falha ao reproduzir replay: ${describeError(error)}`);
    } finally {
      setPlayReplayBusy(false);
    }
  }, [emulPaused, lastReplayPath, logMessage, playReplayBusy, replayRecording]);

  useEffect(() => {
    if (activeViewportTab !== "game") {
      stopFrameLoop();
      disposeAudioPlayback();
      return;
    }

    if (!emulatorLoaded) {
      stopFrameLoop();
      disposeAudioPlayback();
      return;
    }

    if (!pausedRef.current) {
      startEmulatorLoop(true);
    } else {
      stopFrameLoop();
    }

    return () => {
      stopFrameLoop();
      disposeAudioPlayback();
    };
  }, [activeViewportTab, disposeAudioPlayback, emulatorLoaded, startEmulatorLoop, stopFrameLoop]);

  useEffect(() => {
    if (activeViewportTab !== "game" || !emulatorLoaded) return;

    if (emulPaused) {
      stopFrameLoop();
    } else {
      startEmulatorLoop(false);
    }
  }, [activeViewportTab, emulatorLoaded, emulPaused, startEmulatorLoop, stopFrameLoop]);

  useEffect(() => {
    return () => {
      detachViewportRuntime();
    };
  }, [detachViewportRuntime]);

  useEffect(() => {
    if (activeViewportTab !== "game") return;

    function onKeyDown(event: KeyboardEvent) {
      if (
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableTarget(event.target) &&
        event.code === "KeyR"
      ) {
        event.preventDefault();
        void handleRewind();
        return;
      }

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
  }, [activeViewportTab, handleRewind]);

  useEffect(() => {
    if (activeViewportTab !== "game") {
      return;
    }

    function updateGameScale() {
      const stage = gameViewportStageRef.current;
      if (!stage) {
        setGameViewportScale(1);
        return;
      }

      const rect = stage.getBoundingClientRect();
      const nextScale = getGameViewportScale(
        rect.width - GAME_VIEWPORT_PADDING,
        rect.height - GAME_VIEWPORT_PADDING
      );

      setGameViewportScale((current) => (current === nextScale ? current : nextScale));
    }

    updateGameScale();

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        updateGameScale();
      });

      const stage = gameViewportStageRef.current;
      if (stage) {
        observer.observe(stage);
      }

      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateGameScale);
    return () => window.removeEventListener("resize", updateGameScale);
  }, [activeViewportTab]);

  useEffect(() => {
    if (activeViewportTab !== "game") {
      disposeAudioPlayback();
      return;
    }

    let cancelled = false;

    void listenToAudioStream(async (payload) => {
      if (cancelled || activeTabRef.current !== "game" || pausedRef.current) {
        return;
      }

      try {
        const context = await ensureAudioPlayback(payload.sample_rate);
        if (!context || cancelled || pausedRef.current) {
          return;
        }
        enqueueAudio(payload);
        if (context.state === "suspended") {
          await context.resume();
        }
      } catch (error: unknown) {
        logMessage("error", `Falha ao reproduzir audio do emulador: ${describeError(error)}`);
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      audioUnlistenRef.current = unlisten;
    }).catch((error: unknown) => {
      logMessage("error", `Falha ao assinar audio do emulador: ${describeError(error)}`);
    });

    return () => {
      cancelled = true;
      disposeAudioPlayback();
    };
  }, [activeViewportTab, disposeAudioPlayback, enqueueAudio, ensureAudioPlayback, logMessage]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listenToProjectAssetChanges((payload) => {
      if (
        cancelled ||
        payload.project_dir !== activeProjectDir ||
        activeTabRef.current !== "game"
      ) {
        return;
      }

      const preview = payload.changed_paths.slice(0, 2).join(", ");
      const suffix = payload.changed_paths.length > 2 ? "..." : "";
      showHotReloadNotice(
        `${payload.changed_paths.length} asset(s) alterado(s): ${preview}${suffix}`
      );
    }).then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
    }).catch((error: unknown) => {
      logMessage("warn", `[Hot Reload] Falha ao assinar eventos de assets: ${describeError(error)}`);
    });

    return () => {
      cancelled = true;
      unlisten?.();
      if (hotReloadNoticeTimerRef.current !== null) {
        window.clearTimeout(hotReloadNoticeTimerRef.current);
        hotReloadNoticeTimerRef.current = null;
      }
    };
  }, [activeProjectDir, logMessage, showHotReloadNotice]);

  useEffect(() => {
    if (activeViewportTab !== "scene") return;

    function showHint(key: string, label: string) {
      if (shortcutHintTimerRef.current !== null) clearTimeout(shortcutHintTimerRef.current);
      setShortcutHint({ key, label });
      shortcutHintTimerRef.current = window.setTimeout(() => {
        setShortcutHint(null);
        shortcutHintTimerRef.current = null;
      }, 1500);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (isEditableTarget(event.target)) return;

      if (
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const key = event.key.toLowerCase();
        if (key === "g") {
          event.preventDefault();
          setGridSnap((current) => !current);
          showHint("G", gridSnap ? "Snap Livre" : "Snap 8px");
          return;
        }
        if (key === "v") {
          event.preventDefault();
          setEditorMode("select");
          showHint("V", "Selecionar");
          return;
        }
        if (key === "b") {
          event.preventDefault();
          setEditorMode("paint");
          showHint("B", "Pintar");
          return;
        }
        if (key === "e") {
          event.preventDefault();
          setEditorMode("erase");
          showHint("E", "Apagar");
          return;
        }
        if (key === "c") {
          event.preventDefault();
          setEditorMode("collision");
          showHint("C", "Colis\u00e3o");
          return;
        }
        if (key === "escape") {
          event.preventDefault();
          setActiveBrush(null);
          setEditorMode("select");
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && !event.repeat) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          setViewportZoom(Math.min(ZOOM_MAX, viewportZoom + ZOOM_STEP));
        } else if (event.key === "-") {
          event.preventDefault();
          setViewportZoom(Math.max(ZOOM_MIN, viewportZoom - ZOOM_STEP));
        } else if (event.key === "0") {
          event.preventDefault();
          resetViewportZoom();
        }
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(false);
        if (panDragRef.current) {
          panDragRef.current = null;
          setIsPanning(false);
        }
      }
    }

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      const { viewportZoom: current } = useEditorStore.getState();
      useEditorStore.getState().setViewportZoom(current + delta);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("wheel", onWheel);
    };
  }, [activeViewportTab, gridSnap, resetViewportZoom, setViewportZoom, viewportZoom]);

  useEffect(() => {
    return useEditorStore.subscribe((state) => {
      if (
        state.hwStatus &&
        (
          state.hwStatus.sprite_count > 0 ||
          state.hwStatus.dma_used > 0 ||
          state.hwStatus.palette_banks_used > 0 ||
          state.hwStatus.bg_layers > 0 ||
          state.hwStatus.errors.length > 0 ||
          state.hwStatus.warnings.length > 0 ||
          lastOverlayHwStatusRef.current === null
        )
      ) {
        lastOverlayHwStatusRef.current = state.hwStatus;
      }
    });
  }, []);

  useEffect(() => {
    if (activeViewportTab !== "scene" || !panDragRef.current) return;

    function onPanMove(event: MouseEvent) {
      const pan = panDragRef.current;
      if (!pan) return;
      setViewportPan({
        x: pan.startPanX + (event.clientX - pan.startX),
        y: pan.startPanY + (event.clientY - pan.startY),
      });
    }

    function onPanUp() {
      panDragRef.current = null;
      setIsPanning(false);
    }

    window.addEventListener("mousemove", onPanMove);
    window.addEventListener("mouseup", onPanUp);
    return () => {
      window.removeEventListener("mousemove", onPanMove);
      window.removeEventListener("mouseup", onPanUp);
    };
  }, [activeViewportTab]);

  useEffect(() => {
    if (activeViewportTab !== "scene" || !guideDrag) {
      return;
    }

    const activeGuideDrag = guideDrag;

    function onGuideMove(event: MouseEvent) {
      const coords = getSceneCoordsFromClient(event.clientX, event.clientY);
      if (!coords) {
        return;
      }

      const axisLimit = activeGuideDrag.orientation === "vertical" ? sceneWidth : sceneHeight;
      const axisValue = activeGuideDrag.orientation === "vertical" ? coords.x : coords.y;
      const snapStep = getGuideSnapStep();
      const snapped = guideSnap ? snapToGrid(axisValue, snapStep) : axisValue;
      setGuideDrag((current) =>
        current
          ? {
              ...current,
              position: clamp(Math.round(snapped), 0, axisLimit),
            }
          : current
      );
    }

    function onGuideUp() {
      setSceneGuides((current) => {
        const activeGuide = activeGuideDrag;
        const nextGuide: SceneGuide = {
          id: activeGuide.id,
          orientation: activeGuide.orientation,
          position: activeGuide.position,
        };

        const remaining = current.filter((guide) => guide.id !== activeGuide.id);
        return [...remaining, nextGuide].sort((left, right) => left.position - right.position);
      });
      setGuideDrag(null);
    }

    window.addEventListener("mousemove", onGuideMove);
    window.addEventListener("mouseup", onGuideUp);
    return () => {
      window.removeEventListener("mousemove", onGuideMove);
      window.removeEventListener("mouseup", onGuideUp);
    };
  }, [
    activeViewportTab,
    getGuideSnapStep,
    getSceneCoordsFromClient,
    guideDrag,
    guideSnap,
    sceneHeight,
    sceneWidth,
  ]);

  useEffect(() => {
    if (activeViewportTab !== "scene") return;

    const canvas = sceneCanvasRef.current;
    if (!canvas) return;

    canvas.width = sceneWidth;
    canvas.height = sceneHeight;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, sceneWidth, sceneHeight);
    context.fillStyle = "#060816";
    context.fillRect(0, 0, sceneWidth, sceneHeight);

    if (!activeScene) {
      return;
    }

    context.save();
    context.translate(-sceneWorldMinX, -sceneWorldMinY);

    const compositionHiddenByLayer = new Set<string>();
    const compositionLayerDepthByEntityId = new Map<string, number>();
    for (const sceneLayer of activeScene.layers ?? []) {
      for (const entityId of sceneLayer.entity_ids) {
        compositionLayerDepthByEntityId.set(entityId, sceneLayer.depth ?? 0);
      }
      if (!sceneLayer.visible) {
        for (const entityId of sceneLayer.entity_ids) {
          compositionHiddenByLayer.add(entityId);
        }
      }
    }

    const compositionEntities = activeScene.entities
      .map((entity, index) => ({
        entity,
        index,
        depth: compositionLayerDepthByEntityId.get(entity.entity_id) ?? 0,
      }))
      .filter(({ entity }) => !compositionHiddenByLayer.has(entity.entity_id))
      .sort((left, right) => {
        if (left.depth !== right.depth) {
          return left.depth - right.depth;
        }
        return left.index - right.index;
      });

    if (showBackground) {
      [...activeScene.background_layers]
        .sort((left, right) => left.depth - right.depth)
        .forEach((layer) => {
          const backgroundAsset = getViewportAsset(layer.tilemap ?? layer.tileset);
          if (backgroundAsset?.status !== "loaded" || !backgroundAsset.source) {
            return;
          }

          context.save();
          context.globalAlpha = 0.92;
          drawRepeatedAsset(
            context,
            backgroundAsset,
            0,
            0,
            sceneWidth,
            sceneHeight,
            layer.scroll_speed?.x ?? 0,
            layer.scroll_speed?.y ?? 0
          );
          context.restore();
        });
    }

    if (showTilemaps) {
      compositionEntities
        .filter(({ entity }) => Boolean(entity.components?.tilemap))
        .forEach(({ entity }) => {
          const tilemap = entity.components?.tilemap;
          if (!tilemap) {
            return;
          }

          const tilemapAsset = getViewportAsset(tilemap.tileset);
          if (tilemapAsset?.status !== "loaded" || !tilemapAsset.source) {
            return;
          }

          const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
          const cellsArr = tilemap.cells;
          const expectedCells = tilemap.map_width * tilemap.map_height;
          const hasCells =
            Array.isArray(cellsArr) &&
            cellsArr.length === expectedCells &&
            cellsArr.some((v) => (v | 0) > 0);
          if (hasCells) {
            // WYSIWYG: desenha cada célula pintada com slice real do tileset.
            drawTilemapCells(
              context,
              tilemapAsset,
              bounds.x,
              bounds.y,
              tilemap.map_width,
              tilemap.map_height,
              cellsArr as number[],
              8,
              tilemap.scroll_x ?? 0,
              tilemap.scroll_y ?? 0
            );
          } else {
            // Fallback legado (projetos importados sem `cells[]`): desenho esticado.
            drawRepeatedAsset(
              context,
              tilemapAsset,
              bounds.x,
              bounds.y,
              bounds.width,
              bounds.height,
              tilemap.scroll_x ?? 0,
              tilemap.scroll_y ?? 0
            );
          }
        });
    }

    if (showSprites) {
      compositionEntities
        .filter(({ entity }) => Boolean(entity.components?.sprite))
        .forEach(({ entity }) => {
          const sprite = entity.components?.sprite;
          const spriteAsset = getViewportAsset(sprite?.asset);
          if (!sprite || spriteAsset?.status !== "loaded" || !spriteAsset.source) {
            return;
          }

          const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
          const sourceWidth = Math.min(sprite.frame_width, spriteAsset.width ?? sprite.frame_width);
          const sourceHeight = Math.min(sprite.frame_height, spriteAsset.height ?? sprite.frame_height);
          context.drawImage(
            spriteAsset.source,
            0,
            0,
            sourceWidth,
            sourceHeight,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height
          );
        });
    }

    context.restore();
    return;

    /*
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

    // Build set of entity_ids hidden by a layer with visible=false
    const hiddenByLayer = new Set<string>();
    for (const sceneLayer of activeScene.layers ?? []) {
      if (!sceneLayer.visible) {
        for (const eid of sceneLayer.entity_ids) {
          hiddenByLayer.add(eid);
        }
      }
    }

    activeScene.entities.forEach((entity: Entity, index: number) => {
      if (hiddenByLayer.has(entity.entity_id)) return;

      const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
      const x = bounds.x;
      const y = bounds.y;
      const width = bounds.width;
      const height = bounds.height;
      const isSelected = entity.entity_id === selectedEntityId;
      const color = colors[index % colors.length];

      if (entity.components?.tilemap) {
        const tilemap = entity.components.tilemap;
        const mapWidth = tilemap.map_width * 8;
        const mapHeight = tilemap.map_height * 8;
        const tilemapAsset = getViewportAsset(tilemap.tileset);
        const tilemapImageLoaded = tilemapAsset?.status === "loaded" && tilemapAsset.source;
        const showTilemapGizmos =
          isSelected || editorMode === "collision" || editorMode === "paint" || editorMode === "erase";

        if (tilemapImageLoaded && tilemapAsset.source) {
          const cells = tilemap.cells;
          const expectedCells = tilemap.map_width * tilemap.map_height;
          const hasCells =
            Array.isArray(cells) &&
            cells.length === expectedCells &&
            cells.some((v) => (v | 0) > 0);
          context.save();
          context.globalAlpha = 0.82;
          if (hasCells) {
            // WYSIWYG: renderiza célula-a-célula usando slices reais do tileset.
            context.fillStyle = "rgba(148,226,213,0.05)";
            context.fillRect(x, y, mapWidth, mapHeight);
            drawTilemapCells(
              context,
              tilemapAsset,
              x,
              y,
              tilemap.map_width,
              tilemap.map_height,
              cells as number[],
              8,
              tilemap.scroll_x ?? 0,
              tilemap.scroll_y ?? 0
            );
          } else {
            // Fallback legado: projetos importados sem cells[] mantêm draw esticado.
            context.drawImage(tilemapAsset.source, x, y, mapWidth, mapHeight);
          }
          context.restore();
        } else {
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
        }

        if (showTilemapGizmos || !tilemapImageLoaded) {
          context.strokeStyle = isSelected ? "#94e2d5" : "rgba(148,226,213,0.5)";
          context.lineWidth = isSelected ? 2 : 1;
          context.strokeRect(x, y, mapWidth, mapHeight);
          context.fillStyle = "#94e2d5";
          context.font = "9px monospace";
          context.textAlign = "left";
          context.fillText(`TM ${entityDisplayLabel(entity)}`.slice(0, 16), x + 2, y + 10);
        }
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
        context.fillText(`CAM ${entityDisplayLabel(entity)}`.slice(0, 16), x + offsetX + 2, y + offsetY + 10);

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

      const spriteAsset = getViewportAsset(entity.components?.sprite?.asset);
      const sprite = entity.components?.sprite;
      const spriteImageLoaded = spriteAsset?.status === "loaded" && spriteAsset.source && sprite;
      const showSpriteGizmos =
        isSelected || editorMode === "collision" || editorMode === "paint" || editorMode === "erase";

      if (spriteImageLoaded && spriteAsset.source) {
        const sourceWidth = Math.min(sprite.frame_width, spriteAsset.width ?? sprite.frame_width);
        const sourceHeight = Math.min(sprite.frame_height, spriteAsset.height ?? sprite.frame_height);
        context.drawImage(spriteAsset.source, 0, 0, sourceWidth, sourceHeight, x, y, width, height);
      } else {
        context.fillStyle = `${color}33`;
        context.fillRect(x, y, width, height);
      }

      if (showSpriteGizmos || !spriteImageLoaded) {
        context.strokeStyle = isSelected ? "#ffffff" : color;
        context.lineWidth = isSelected ? 2 : 1;
        context.strokeRect(x, y, width, height);
        context.fillStyle = isSelected ? "#ffffff" : color;
        context.font = "9px monospace";
        context.textAlign = "left";
        context.fillText(entityDisplayLabel(entity).slice(0, 14), x + 2, y + 10);
        context.fillStyle = color;
        context.beginPath();
        context.arc(x + width / 2, y + height / 2, 2, 0, Math.PI * 2);
        context.fill();
      }

      if (isSelected) {
        context.save();
        context.strokeStyle = "#f9e2af";
        context.lineWidth = 1;
        context.setLineDash([3, 2]);
        context.strokeRect(x - 2, y - 2, width + 4, height + 4);
        context.setLineDash([]);
        if (bounds.resizable) {
          drawResizeHandle(context, x, y, "#f9e2af");
          drawResizeHandle(context, x + width, y, "#f9e2af");
          drawResizeHandle(context, x, y + height, "#f9e2af");
          drawResizeHandle(context, x + width, y + height, "#f9e2af");
        }
        context.restore();
      }
    });

    // ── Collision map overlay ─────────────────────────────────────────────
    const cmap = activeScene.collision_map ?? null;
    if (cmap) {
      const tw = cmap.tile_width;
      const th = cmap.tile_height;
      context.save();
      context.fillStyle = "rgba(243,139,168,0.35)";
      for (let ti = 0; ti < cmap.data.length; ti += 1) {
        if (cmap.data[ti] === 1) {
          const tx = (ti % cmap.width) * tw;
          const ty = Math.floor(ti / cmap.width) * th;
          context.fillRect(tx, ty, tw, th);
        }
      }
      context.restore();
    }
    // Collision mode tile cursor highlight (visible even before first paint)
    if (editorMode === "collision" && sceneMousePos) {
      const tw = cmap?.tile_width ?? GRID_SNAP_SIZE;
      const th = cmap?.tile_height ?? GRID_SNAP_SIZE;
      const mapW = cmap?.width ?? (activeTarget === "snes" ? 32 : 40);
      const mapH = cmap?.height ?? 28;
      const tileX = Math.floor(sceneMousePos.x / tw);
      const tileY = Math.floor(sceneMousePos.y / th);
      if (tileX >= 0 && tileX < mapW && tileY >= 0 && tileY < mapH) {
        context.save();
        context.fillStyle = "rgba(243,139,168,0.55)";
        context.fillRect(tileX * tw, tileY * th, tw, th);
        context.strokeStyle = "#f38ba8";
        context.lineWidth = 1;
        context.strokeRect(tileX * tw, tileY * th, tw, th);
        context.restore();
      }
    }

    // Brush ghost preview
    if (editorMode === "paint" && activeBrush && sceneMousePos) {
      const ghostSize = constrainSpriteFrameSize(
        activeTarget,
        activeBrush.assetPath ?? activeBrush.id,
        ONBOARDING_SPRITE_SIZE,
        ONBOARDING_SPRITE_SIZE
      );
      const gx = gridSnap ? snapToGrid(sceneMousePos.x, GRID_SNAP_SIZE) : Math.round(sceneMousePos.x);
      const gy = gridSnap ? snapToGrid(sceneMousePos.y, GRID_SNAP_SIZE) : Math.round(sceneMousePos.y);
      context.save();
      context.globalAlpha = 0.25;
      context.fillStyle = "#89b4fa";
      context.fillRect(gx, gy, ghostSize.frameWidth, ghostSize.frameHeight);
      context.globalAlpha = 0.6;
      context.strokeStyle = "#89b4fa";
      context.lineWidth = 1;
      context.setLineDash([3, 2]);
      context.strokeRect(gx, gy, ghostSize.frameWidth, ghostSize.frameHeight);
      context.setLineDash([]);
      context.restore();
    }
    */
  }, [
    activeScene,
    activeTarget,
    activeViewportTab,
    assetCacheVersion,
    getViewportAsset,
    sceneHeight,
    sceneWidth,
    sceneWorldMinX,
    sceneWorldMinY,
    showBackground,
    showSprites,
    showTilemaps,
  ]);

  useEffect(() => {
    if (activeViewportTab !== "scene") return;

    const canvas = sceneOverlayCanvasRef.current;
    if (!canvas) return;

    canvas.width = Math.max(sceneScaleWidth, 1);
    canvas.height = Math.max(sceneScaleHeight, 1);

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;

    const drawVerticalLine = (position: number, color: string, width = 1) => {
      const x = worldToSceneCanvasX(position) + 0.5;
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, sceneScaleHeight);
      context.stroke();
    };

    const drawHorizontalLine = (position: number, color: string, width = 1) => {
      const y = worldToSceneCanvasY(position) + 0.5;
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(sceneScaleWidth, y);
      context.stroke();
    };

    if (!activeScene) {
      context.fillStyle = "#45475a";
      context.font = "11px monospace";
      context.textAlign = "center";
      context.fillText(
        `${sceneWidth} x ${sceneHeight} - ${activeTarget === "snes" ? "SNES" : "Mega Drive"} Safe Area`,
        sceneScaleWidth / 2,
        sceneScaleHeight / 2
      );
      context.fillText("Abra um projeto para ver a cena", sceneScaleWidth / 2, sceneScaleHeight / 2 + 16);
      return;
    }

    if (gameViewLight) {
      return;
    }

    const hiddenByLayer = new Set<string>();
    const layerDepthByEntityId = new Map<string, number>();
    for (const sceneLayer of activeScene.layers ?? []) {
      for (const entityId of sceneLayer.entity_ids) {
        layerDepthByEntityId.set(entityId, sceneLayer.depth ?? 0);
      }
      if (!sceneLayer.visible) {
        for (const entityId of sceneLayer.entity_ids) {
          hiddenByLayer.add(entityId);
        }
      }
    }

    const orderedEntities = activeScene.entities
      .map((entity, index) => ({
        entity,
        index,
        depth: layerDepthByEntityId.get(entity.entity_id) ?? 0,
      }))
      .filter(({ entity }) => !hiddenByLayer.has(entity.entity_id))
      .sort((left, right) => {
        if (left.depth !== right.depth) {
          return left.depth - right.depth;
        }
        return left.index - right.index;
      });

    if (showGrid) {
      const showMinorGrid = showSubGrid && SUB_GRID_SIZE * viewportZoom >= 6;
      const minorAlpha = clamp(0.03 + (viewportZoom - 0.25) * 0.03, 0.03, 0.1);
      const majorAlpha = clamp(0.09 + viewportZoom * 0.04, 0.09, 0.24);
      const worldGridStartX = Math.floor(sceneWorldMinX / SUB_GRID_SIZE) * SUB_GRID_SIZE;
      const worldGridStartY = Math.floor(sceneWorldMinY / SUB_GRID_SIZE) * SUB_GRID_SIZE;
      const worldMajorGridStartX = Math.floor(sceneWorldMinX / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
      const worldMajorGridStartY = Math.floor(sceneWorldMinY / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;

      if (showMinorGrid) {
        for (let x = worldGridStartX; x <= sceneWorldMaxX; x += SUB_GRID_SIZE) {
          if (x % GRID_SNAP_SIZE === 0) continue;
          drawVerticalLine(x, `rgba(137,180,250,${minorAlpha.toFixed(3)})`);
        }
        for (let y = worldGridStartY; y <= sceneWorldMaxY; y += SUB_GRID_SIZE) {
          if (y % GRID_SNAP_SIZE === 0) continue;
          drawHorizontalLine(y, `rgba(137,180,250,${minorAlpha.toFixed(3)})`);
        }
      }

      for (let x = worldMajorGridStartX; x <= sceneWorldMaxX; x += GRID_SNAP_SIZE) {
        drawVerticalLine(x, `rgba(180,190,254,${majorAlpha.toFixed(3)})`);
      }
      for (let y = worldMajorGridStartY; y <= sceneWorldMaxY; y += GRID_SNAP_SIZE) {
        drawHorizontalLine(y, `rgba(180,190,254,${majorAlpha.toFixed(3)})`);
      }
    }

    if (showCollisionOverlay && activeScene.collision_map) {
      const collisionMap = activeScene.collision_map;
      const tileWidth = collisionMap.tile_width;
      const tileHeight = collisionMap.tile_height;
      context.save();
      context.fillStyle = "rgba(243,139,168,0.28)";
      for (let tileIndex = 0; tileIndex < collisionMap.data.length; tileIndex += 1) {
        if (collisionMap.data[tileIndex] !== 1) continue;
        const tileX = worldToSceneCanvasX((tileIndex % collisionMap.width) * tileWidth);
        const tileY = worldToSceneCanvasY(Math.floor(tileIndex / collisionMap.width) * tileHeight);
        context.fillRect(
          tileX,
          tileY,
          scaleSceneDimension(tileWidth),
          scaleSceneDimension(tileHeight)
        );
      }
      context.restore();

      for (let x = 0; x <= collisionMap.width * tileWidth; x += tileWidth) {
        drawVerticalLine(x, "rgba(243,139,168,0.24)");
      }
      for (let y = 0; y <= collisionMap.height * tileHeight; y += tileHeight) {
        drawHorizontalLine(y, "rgba(243,139,168,0.24)");
      }
    }

    orderedEntities.forEach(({ entity, index }) => {
      const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
      const x = worldToSceneCanvasX(bounds.x);
      const y = worldToSceneCanvasY(bounds.y);
      const width = scaleSceneDimension(bounds.width);
      const height = scaleSceneDimension(bounds.height);
      const isSelected = entity.entity_id === selectedEntityId;
      const focusTreatment = resolveEntityFocusTreatment(entity.entity_id, {
        soloEntityId,
        densePreviewEntityId: denseStackPreviewEntityId,
        denseSpotlight: denseStackSpotlight,
      });
      const isDensePreview = focusTreatment === "preview" && !isSelected;
      const isSoloFocus = focusTreatment === "solo";
      const color = entity.components?.tilemap
        ? "#94e2d5"
        : entity.components?.camera
          ? "#f9e2af"
          : ["#cba6f7", "#89b4fa", "#a6e3a1", "#fab387", "#f38ba8", "#94e2d5"][index % 6];

      if (entity.components?.camera) {
        if (!showCameraOverlay) return;
        context.save();
        context.setLineDash([6, 4]);
        context.strokeStyle = isSelected
          ? "#f9e2af"
          : isSoloFocus
            ? "#f9e2af"
          : isDensePreview
            ? "#fde68a"
            : "rgba(249,226,175,0.58)";
        context.lineWidth = isSelected || isDensePreview || isSoloFocus ? 2 : 1;
        context.strokeRect(x + 0.5, y + 0.5, width, height);
        context.setLineDash([]);
        context.fillStyle = isSelected || isDensePreview ? "#f9e2af" : "rgba(249,226,175,0.8)";
        context.font = "10px monospace";
        if (showEntityLabels) {
          context.fillText(`CAM ${entityDisplayLabel(entity)}`.slice(0, 22), x + 6, y + 14);
        }
        context.restore();
        return;
      }

      if (entity.components?.tilemap) {
        if (!showTilemaps) return;
        context.strokeStyle = isSelected
          ? "#94e2d5"
          : isSoloFocus
            ? "#f9e2af"
          : isDensePreview
            ? "#67e8f9"
            : "rgba(148,226,213,0.58)";
        context.lineWidth = isSelected || isDensePreview || isSoloFocus ? 2 : 1;
        if (showEntityBounds || isSelected || isDensePreview || isSoloFocus) {
          context.strokeRect(x + 0.5, y + 0.5, width, height);
        }
        if (showEntityLabels) {
          context.fillStyle = "#94e2d5";
          context.font = "10px monospace";
          context.fillText(`TM ${entityDisplayLabel(entity)}`.slice(0, 22), x + 6, y + 14);
        }
        if (isSelected || isDensePreview || isSoloFocus) {
          context.fillStyle = "rgba(148,226,213,0.16)";
          context.fillRect(x, y, width, height);
        }
        return;
      }

      if (entity.components?.sprite) {
        if (!showSprites) return;
        context.strokeStyle = isSelected || isSoloFocus ? "#ffffff" : isDensePreview ? "#f9e2af" : color;
        context.lineWidth = isSelected || isDensePreview || isSoloFocus ? 2 : 1;
        if (showEntityBounds || isSelected || isDensePreview || isSoloFocus) {
          context.strokeRect(x + 0.5, y + 0.5, width, height);
        }
        if (showEntityLabels) {
          context.fillStyle = isSelected || isSoloFocus ? "#ffffff" : isDensePreview ? "#f9e2af" : color;
          context.font = "10px monospace";
          context.fillText(entityDisplayLabel(entity).slice(0, 22), x + 6, y + 14);
        }
        const posCtx = resolveImportedEntityContext(entity);
        if (showEntityLabels && posCtx.positionMode) {
          const tag =
            posCtx.positionMode === "donor"
              ? "DOADOR"
              : posCtx.positionMode === "staging"
                ? "STAGING"
                : "INFERIDA";
          const pillBg =
            posCtx.positionMode === "donor"
              ? "rgba(166,227,161,0.92)"
              : posCtx.positionMode === "staging"
                ? "rgba(250,179,135,0.95)"
                : "rgba(137,180,250,0.92)";
          context.font = "bold 8px monospace";
          const tw = context.measureText(tag).width;
          const px = x + 6;
          const py = y + 18;
          context.fillStyle = pillBg;
          context.fillRect(px, py, tw + 8, 12);
          context.strokeStyle = "rgba(17,17,27,0.55)";
          context.lineWidth = 1;
          context.strokeRect(px + 0.5, py + 0.5, tw + 8, 12);
          context.fillStyle = "#11111b";
          context.textAlign = "left";
          context.fillText(tag, px + 4, py + 9);
          context.textAlign = "left";
        }
        if (isSelected) {
          context.save();
          context.strokeStyle = "#f9e2af";
          context.lineWidth = 1;
          context.setLineDash([4, 3]);
          context.strokeRect(x - 2.5, y - 2.5, width + 4, height + 4);
          context.setLineDash([]);
          if (bounds.resizable) {
            drawResizeHandle(context, x, y, "#f9e2af");
            drawResizeHandle(context, x + width, y, "#f9e2af");
            drawResizeHandle(context, x, y + height, "#f9e2af");
            drawResizeHandle(context, x + width, y + height, "#f9e2af");
          }
          context.restore();
        }
        return;
      }

      if (showEntityBounds || isSelected || isDensePreview || isSoloFocus) {
        context.strokeStyle = "rgba(205,214,244,0.55)";
        context.strokeRect(x + 0.5, y + 0.5, width, height);
      }
      if (showEntityLabels) {
        context.fillStyle = "#cdd6f4";
        context.font = "10px monospace";
        context.fillText(entityDisplayLabel(entity).slice(0, 22), x + 6, y + 14);
      }
    });

    const spotlightEntityId = soloEntityId ?? (denseStackSpotlight ? denseStackPreviewEntityId : null);
    if (spotlightEntityId) {
      const spotlightEntity = activeScene.entities.find((entity) => entity.entity_id === spotlightEntityId);
      if (spotlightEntity) {
        const sb = getEntityBounds(spotlightEntity, activeTarget, activeScene.entities);
        const sx = worldToSceneCanvasX(sb.x);
        const sy = worldToSceneCanvasY(sb.y);
        const sw = scaleSceneDimension(sb.width);
        const sh = scaleSceneDimension(sb.height);
        context.save();
        context.fillStyle = soloEntityId ? "rgba(0,0,0,0.48)" : "rgba(0,0,0,0.35)";
        context.fillRect(0, 0, sceneScaleWidth, sceneScaleHeight);
        context.globalCompositeOperation = "destination-out";
        context.fillRect(Math.max(0, sx - 6), Math.max(0, sy - 6), Math.max(1, sw + 12), Math.max(1, sh + 12));
        context.globalCompositeOperation = "source-over";
        context.strokeStyle = "#f9e2af";
        context.lineWidth = 2;
        context.setLineDash([6, 4]);
        context.strokeRect(sx - 2.5, sy - 2.5, sw + 4, sh + 4);
        context.setLineDash([]);
        if (soloEntityId) {
          context.font = "bold 10px monospace";
          context.fillStyle = "#f9e2af";
          context.fillText("SOLO", sx + 4, Math.max(12, sy - 8));
        }
        context.restore();
      }
    }

    // Prateleira visual quando varios sprites importados estao em staging (cena densa / beat'em up).
    const stagingSprites = activeScene.entities.filter(
      (candidate) =>
        candidate.components?.sprite &&
        resolveImportedEntityContext(candidate).positionMode === "staging"
    );
    if (showStagingOverlay && stagingSprites.length >= 2) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const ent of stagingSprites) {
        const b = getEntityBounds(ent, activeTarget, activeScene.entities);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
      const pad = 12;
      const sx = worldToSceneCanvasX(minX - pad);
      const sy = worldToSceneCanvasY(minY - pad);
      const sw = scaleSceneDimension(maxX - minX + pad * 2);
      const sh = scaleSceneDimension(maxY - minY + pad * 2);
      context.save();
      context.fillStyle = "rgba(250,179,135,0.08)";
      context.fillRect(sx, sy, sw, sh);
      context.setLineDash([8, 5]);
      context.strokeStyle = "rgba(250,179,135,0.55)";
      context.lineWidth = 1.5;
      context.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      context.setLineDash([]);
      context.fillStyle = "rgba(250,179,135,0.98)";
      context.font = "10px monospace";
      context.textAlign = "left";
      context.fillText("Prateleira / staging (autoria)", sx + 6, Math.min(sy + 14, sy + sh - 4));
      context.restore();
    }

    if (editorMode === "collision" && sceneMousePos) {
      const collisionMap = activeScene.collision_map;
      const tileWidth = collisionMap?.tile_width ?? GRID_SNAP_SIZE;
      const tileHeight = collisionMap?.tile_height ?? GRID_SNAP_SIZE;
      const mapWidth = collisionMap?.width ?? (activeTarget === "snes" ? 32 : 40);
      const mapHeight = collisionMap?.height ?? 28;
      const tileX = Math.floor(sceneMousePos.x / tileWidth);
      const tileY = Math.floor(sceneMousePos.y / tileHeight);
      if (tileX >= 0 && tileX < mapWidth && tileY >= 0 && tileY < mapHeight) {
        const screenX = worldToSceneCanvasX(tileX * tileWidth);
        const screenY = worldToSceneCanvasY(tileY * tileHeight);
        context.fillStyle = "rgba(243,139,168,0.55)";
        context.fillRect(
          screenX,
          screenY,
          scaleSceneDimension(tileWidth),
          scaleSceneDimension(tileHeight)
        );
        context.strokeStyle = "#f38ba8";
        context.lineWidth = 1;
        context.strokeRect(
          screenX + 0.5,
          screenY + 0.5,
          scaleSceneDimension(tileWidth),
          scaleSceneDimension(tileHeight)
        );
      }
    }

    if (editorMode === "paint" && activeBrush?.kind === "tile" && sceneMousePos) {
      // Ghost tile-sized, alinhado ao tilemap alvo.
      const tileSize = tilePaintSize > 0 ? tilePaintSize : 8;
      const target = resolveTilemapTarget(sceneMousePos.x, sceneMousePos.y);
      if (target) {
        const bounds = getEntityBounds(target.entity, activeTarget, activeScene.entities);
        const ghostX = bounds.x + target.col * tileSize;
        const ghostY = bounds.y + target.row * tileSize;
        const screenX = worldToSceneCanvasX(ghostX);
        const screenY = worldToSceneCanvasY(ghostY);
        const screenSize = scaleSceneDimension(tileSize);
        const isEraser = tilePaintTool === "eraser";
        context.save();
        context.globalAlpha = isEraser ? 0.18 : 0.3;
        context.fillStyle = isEraser ? "#f38ba8" : "#a6e3a1";
        context.fillRect(screenX, screenY, screenSize, screenSize);
        context.globalAlpha = 0.85;
        context.strokeStyle = isEraser ? "#f38ba8" : "#a6e3a1";
        context.lineWidth = 1;
        context.setLineDash([3, 2]);
        context.strokeRect(screenX + 0.5, screenY + 0.5, screenSize, screenSize);
        context.setLineDash([]);
        context.restore();
      }

      // Rect preview durante drag
      if (tilePaintRectPreview) {
        const target = activeTilemapId
          ? activeScene.entities.find((e) => e.entity_id === activeTilemapId)
          : null;
        if (target) {
          const bounds = getEntityBounds(target, activeTarget, activeScene.entities);
          const minC = Math.min(tilePaintRectPreview.c0, tilePaintRectPreview.c1);
          const maxC = Math.max(tilePaintRectPreview.c0, tilePaintRectPreview.c1);
          const minR = Math.min(tilePaintRectPreview.r0, tilePaintRectPreview.r1);
          const maxR = Math.max(tilePaintRectPreview.r0, tilePaintRectPreview.r1);
          const x0 = bounds.x + minC * tileSize;
          const y0 = bounds.y + minR * tileSize;
          const w = (maxC - minC + 1) * tileSize;
          const h = (maxR - minR + 1) * tileSize;
          context.save();
          context.globalAlpha = 0.2;
          context.fillStyle = "#f9e2af";
          context.fillRect(
            worldToSceneCanvasX(x0),
            worldToSceneCanvasY(y0),
            scaleSceneDimension(w),
            scaleSceneDimension(h)
          );
          context.globalAlpha = 0.9;
          context.strokeStyle = "#f9e2af";
          context.lineWidth = 1.5;
          context.setLineDash([5, 3]);
          context.strokeRect(
            worldToSceneCanvasX(x0) + 0.5,
            worldToSceneCanvasY(y0) + 0.5,
            scaleSceneDimension(w),
            scaleSceneDimension(h)
          );
          context.setLineDash([]);
          context.restore();
        }
      }
    } else if (editorMode === "paint" && activeBrush && sceneMousePos) {
      const ghostSize = constrainSpriteFrameSize(
        activeTarget,
        activeBrush.assetPath ?? activeBrush.id,
        ONBOARDING_SPRITE_SIZE,
        ONBOARDING_SPRITE_SIZE
      );
      let ghostX = gridSnap ? snapToGrid(sceneMousePos.x, GRID_SNAP_SIZE) : Math.round(sceneMousePos.x);
      let ghostY = gridSnap ? snapToGrid(sceneMousePos.y, GRID_SNAP_SIZE) : Math.round(sceneMousePos.y);
      ghostX = snapPositionToGuides(ghostX, "vertical");
      ghostY = snapPositionToGuides(ghostY, "horizontal");
      const screenX = worldToSceneCanvasX(ghostX);
      const screenY = worldToSceneCanvasY(ghostY);
      const screenWidth = scaleSceneDimension(ghostSize.frameWidth);
      const screenHeight = scaleSceneDimension(ghostSize.frameHeight);
      context.save();
      context.globalAlpha = 0.25;
      context.fillStyle = "#89b4fa";
      context.fillRect(screenX, screenY, screenWidth, screenHeight);
      context.globalAlpha = 0.85;
      context.strokeStyle = "#89b4fa";
      context.lineWidth = 1;
      context.setLineDash([4, 3]);
      context.strokeRect(screenX + 0.5, screenY + 0.5, screenWidth, screenHeight);
      context.setLineDash([]);
      context.restore();
    }

    const guidesToRender = guideDrag
      ? [...sceneGuides.filter((guide) => guide.id !== guideDrag.id), guideDrag]
      : sceneGuides;
    guidesToRender.forEach((guide) => {
      const isActiveGuide = guideDrag?.id === guide.id;
      const guideColor = isActiveGuide ? "#f9e2af" : "#89dceb";
      if (guide.orientation === "vertical") {
        drawVerticalLine(guide.position, guideColor, isActiveGuide ? 2 : 1);
        context.fillStyle = guideColor;
        context.font = "10px monospace";
        context.fillText(`${guide.position}px`, worldToSceneCanvasX(guide.position) + 4, 12);
      } else {
        drawHorizontalLine(guide.position, guideColor, isActiveGuide ? 2 : 1);
        context.fillStyle = guideColor;
        context.font = "10px monospace";
        context.fillText(`${guide.position}px`, 6, worldToSceneCanvasY(guide.position) - 4);
      }
    });
  }, [
    activeBrush,
    activeScene,
    activeTarget,
    activeViewportTab,
    editorMode,
    gameViewLight,
    gridSnap,
    guideDrag,
    sceneGuides,
    sceneHeight,
    sceneMousePos,
    sceneScaleHeight,
    sceneScaleWidth,
    sceneWidth,
    sceneWorldMinX,
    sceneWorldMinY,
    selectedEntityId,
    denseStackPicker,
    denseStackSpotlight,
    denseStackPreviewEntityId,
    soloEntityId,
    showCollisionOverlay,
    showCameraOverlay,
    showEntityBounds,
    showEntityLabels,
    showGrid,
    showStagingOverlay,
    showSprites,
    showSubGrid,
    showTilemaps,
    snapPositionToGuides,
    scaleSceneDimension,
    viewportZoom,
    tilePaintTool,
    tilePaintSize,
    tilePaintRectPreview,
    activeTilemapId,
    worldToSceneCanvasX,
    worldToSceneCanvasY,
  ]);

  useEffect(() => {
    const topCanvas = sceneRulerTopRef.current;
    const leftCanvas = sceneRulerLeftRef.current;
    if (!topCanvas || !leftCanvas) return;

    topCanvas.width = Math.max(sceneScaleWidth, 1);
    topCanvas.height = SCENE_RULER_SIZE;
    leftCanvas.width = SCENE_RULER_SIZE;
    leftCanvas.height = Math.max(sceneScaleHeight, 1);

    const topContext = topCanvas.getContext("2d");
    const leftContext = leftCanvas.getContext("2d");
    if (!topContext || !leftContext) return;

    topContext.clearRect(0, 0, topCanvas.width, topCanvas.height);
    leftContext.clearRect(0, 0, leftCanvas.width, leftCanvas.height);

    if (activeViewportTab !== "scene" || gameViewLight) {
      return;
    }

    const rulerStep = getRulerStep(viewportZoom);
    const guideMarkers = guideDrag
      ? [...sceneGuides.filter((guide) => guide.id !== guideDrag.id), guideDrag]
      : sceneGuides;

    topContext.fillStyle = "#181825";
    topContext.fillRect(0, 0, topCanvas.width, topCanvas.height);
    topContext.strokeStyle = "#313244";
    topContext.strokeRect(0.5, 0.5, topCanvas.width - 1, topCanvas.height - 1);
    topContext.fillStyle = "#6c7086";
    topContext.font = "10px monospace";

    const rulerStartX = Math.floor(sceneWorldMinX / rulerStep) * rulerStep;
    const rulerStartY = Math.floor(sceneWorldMinY / rulerStep) * rulerStep;

    for (let pixel = rulerStartX; pixel <= sceneWorldMaxX; pixel += rulerStep) {
      const x = worldToSceneCanvasX(pixel) + 0.5;
      topContext.strokeStyle = "rgba(108,112,134,0.85)";
      topContext.beginPath();
      topContext.moveTo(x, SCENE_RULER_SIZE);
      topContext.lineTo(x, pixel % (rulerStep * 2) === 0 ? 5 : 9);
      topContext.stroke();
      topContext.fillText(`${pixel}`, Math.min(x + 3, topCanvas.width - 28), 11);
    }

    leftContext.fillStyle = "#181825";
    leftContext.fillRect(0, 0, leftCanvas.width, leftCanvas.height);
    leftContext.strokeStyle = "#313244";
    leftContext.strokeRect(0.5, 0.5, leftCanvas.width - 1, leftCanvas.height - 1);
    leftContext.fillStyle = "#6c7086";
    leftContext.font = "10px monospace";

    for (let pixel = rulerStartY; pixel <= sceneWorldMaxY; pixel += rulerStep) {
      const y = worldToSceneCanvasY(pixel) + 0.5;
      leftContext.strokeStyle = "rgba(108,112,134,0.85)";
      leftContext.beginPath();
      leftContext.moveTo(SCENE_RULER_SIZE, y);
      leftContext.lineTo(pixel % (rulerStep * 2) === 0 ? 5 : 9, y);
      leftContext.stroke();
      leftContext.fillText(`${pixel}`, 2, Math.min(y - 2, leftCanvas.height - 4));
    }

    guideMarkers.forEach((guide) => {
      if (guide.orientation === "vertical") {
        const x = worldToSceneCanvasX(guide.position);
        topContext.fillStyle = "#89dceb";
        topContext.fillRect(Math.max(0, x - 1), 0, 3, SCENE_RULER_SIZE);
      } else {
        const y = worldToSceneCanvasY(guide.position);
        leftContext.fillStyle = "#89dceb";
        leftContext.fillRect(0, Math.max(0, y - 1), SCENE_RULER_SIZE, 3);
      }
    });
  }, [
    activeViewportTab,
    gameViewLight,
    guideDrag,
    sceneGuides,
    sceneHeight,
    sceneScaleHeight,
    sceneScaleWidth,
    sceneWidth,
    sceneWorldMaxX,
    sceneWorldMaxY,
    sceneWorldMinX,
    sceneWorldMinY,
    viewportZoom,
    worldToSceneCanvasX,
    worldToSceneCanvasY,
  ]);

  useEffect(() => {
    const gainNode = audioGainRef.current;
    if (gainNode) {
      gainNode.gain.value = audioMuted ? 0 : 1;
    }
  }, [audioMuted]);

  useEffect(() => {
    if (activeViewportTab !== "game") {
      return;
    }

    const context = audioContextRef.current;
    if (!context) {
      return;
    }

    if (emulPaused) {
      clearAudioQueue();
      void context.suspend().catch(() => {});
      return;
    }

    void context.resume().catch(() => {});
  }, [activeViewportTab, clearAudioQueue, emulPaused]);

  function canvasCoords(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = sceneWidth / Math.max(rect.width, 1);
    const scaleY = sceneHeight / Math.max(rect.height, 1);
    return {
      mx: sceneWorldMinX + (event.clientX - rect.left) * scaleX,
      my: sceneWorldMinY + (event.clientY - rect.top) * scaleY,
    };
  }

  function collectEntitiesUnderPoint(mx: number, my: number): Entity[] {
    if (!activeScene) {
      return [];
    }

    const hiddenByLayer = new Set<string>();
    for (const sceneLayer of activeScene.layers ?? []) {
      if (!sceneLayer.visible) {
        for (const entityId of sceneLayer.entity_ids) {
          hiddenByLayer.add(entityId);
        }
      }
    }

    const stack: Entity[] = [];
    for (let index = activeScene.entities.length - 1; index >= 0; index -= 1) {
      const entity = activeScene.entities[index];
      if (hiddenByLayer.has(entity.entity_id)) {
        continue;
      }
      if (entity.components?.tilemap && !showTilemaps) {
        continue;
      }
      if (entity.components?.sprite && !showSprites) {
        continue;
      }
      const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
      if (
        mx >= bounds.x &&
        mx <= bounds.x + bounds.width &&
        my >= bounds.y &&
        my <= bounds.y + bounds.height
      ) {
        stack.push(entity);
      }
    }

    return stack;
  }

  function hitTest(mx: number, my: number) {
    return collectEntitiesUnderPoint(mx, my)[0] ?? null;
  }

  function hitTestResizeHandle(mx: number, my: number): { entity: Entity; handle: ResizeHandle } | null {
    if (!activeScene || !selectedEntityId || selectedEntityId.startsWith("layer::")) {
      return null;
    }

    const entity = activeScene.entities.find((candidate) => candidate.entity_id === selectedEntityId);
    if (!entity) {
      return null;
    }

    const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
    if (!bounds.resizable) {
      return null;
    }

    const handles: Array<{ handle: ResizeHandle; x: number; y: number }> = [
      { handle: "nw", x: bounds.x, y: bounds.y },
      { handle: "ne", x: bounds.x + bounds.width, y: bounds.y },
      { handle: "sw", x: bounds.x, y: bounds.y + bounds.height },
      { handle: "se", x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ];
    const radius = RESIZE_HANDLE_SIZE;
    const matched = handles.find((candidate) =>
      Math.abs(mx - candidate.x) <= radius && Math.abs(my - candidate.y) <= radius
    );

    return matched ? { entity, handle: matched.handle } : null;
  }

  /**
   * Resolve a tilemap entity alvo de um clique (mx,my) e converte a coordenada
   * para (col,row) dentro da malha. Usa:
   *   1) `activeTilemapId` se definido (travado pelo painel contextual),
   *   2) senão hit-test: primeira entidade-tilemap cujos bounds contêm (mx,my).
   * Retorna `null` quando o clique cai fora de qualquer tilemap válido.
   */
  function resolveTilemapTarget(
    mx: number,
    my: number
  ): { entity: Entity; col: number; row: number } | null {
    if (!activeScene) return null;
    const tileSize = tilePaintSize > 0 ? tilePaintSize : 8;
    const candidates: Entity[] = [];
    if (activeTilemapId) {
      const locked = activeScene.entities.find((e) => e.entity_id === activeTilemapId);
      if (locked && locked.components?.tilemap) candidates.push(locked);
    }
    if (candidates.length === 0) {
      for (let i = activeScene.entities.length - 1; i >= 0; i--) {
        const e = activeScene.entities[i];
        if (e.components?.tilemap) candidates.push(e);
      }
    }
    for (const entity of candidates) {
      const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
      if (
        mx < bounds.x ||
        my < bounds.y ||
        mx >= bounds.x + bounds.width ||
        my >= bounds.y + bounds.height
      ) {
        continue;
      }
      const col = Math.floor((mx - bounds.x) / tileSize);
      const row = Math.floor((my - bounds.y) / tileSize);
      const tm = entity.components.tilemap!;
      if (col < 0 || row < 0 || col >= tm.map_width || row >= tm.map_height) continue;
      return { entity, col, row };
    }
    return null;
  }

  function handleMouseDown(event: React.MouseEvent<HTMLCanvasElement>) {
    const isPanIntent =
      event.button === 1 || (event.button === 0 && spacePressed);
    if (isPanIntent) {
      event.preventDefault();
      panDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startPanX: viewportPan.x,
        startPanY: viewportPan.y,
      };
      setIsPanning(true);
      return;
    }

    if (gameViewLight) {
      return;
    }

    if (!activeScene) return;

    const { mx, my } = canvasCoords(event);

    const guideHit = getGuideHit(mx, my);
    if (guideHit && editorMode === "select") {
      event.preventDefault();
      setGuideDrag({
        id: guideHit.id,
        orientation: guideHit.orientation,
        position: guideHit.position,
        creating: false,
      });
      return;
    }

    // Tile paint: pencil/eraser/picker/rect/fill sobre entidade-tilemap.
    // Acionado por `editorMode === "paint"` + `activeBrush.kind === "tile"`.
    // Sem brush tile ou sem tilemap alvo → cai para o fluxo de sprite paint.
    if (editorMode === "paint" && activeBrush?.kind === "tile") {
      const target = resolveTilemapTarget(mx, my);
      if (!target) {
        return;
      }
      const tileIndex = activeBrush.tileIndex ?? 0;

      if (tilePaintTool === "picker") {
        const tm = target.entity.components.tilemap!;
        const cellsArr = tm.cells ?? [];
        const idx = target.row * tm.map_width + target.col;
        const picked = cellsArr[idx] ?? 0;
        setActiveBrush({
          ...activeBrush,
          tileIndex: picked,
        });
        logMessage("info", `[Tile] Picker: tile #${picked}.`);
        return;
      }

      if (tilePaintTool === "fill") {
        fillTilemapFlood(target.entity.entity_id, target.col, target.row, tileIndex);
        void (async () => {
          const { activeProjectDir: projectDir } = useEditorStore.getState();
          if (projectDir) {
            try {
              await persistActiveScene(projectDir, "Viewport", "Fill tilemap aplicado.");
            } catch (error: unknown) {
              logMessage("error", `[Viewport] Falha ao salvar fill: ${describeError(error)}`);
            }
          }
        })();
        return;
      }

      if (tilePaintTool === "rect") {
        tileDragRef.current = {
          entityId: target.entity.entity_id,
          tool: "rect",
          lastCellKey: null,
          rectOrigin: { col: target.col, row: target.row },
          tileIndex,
          paintedInDrag: false,
        };
        setTilePaintRectPreview({
          c0: target.col,
          r0: target.row,
          c1: target.col,
          r1: target.row,
        });
        setActiveTilemapId(target.entity.entity_id);
        return;
      }

      // pencil / eraser (eraser = tileIndex 0)
      const effectiveIndex = tilePaintTool === "eraser" ? 0 : tileIndex;
      beginHistoryCapture();
      paintTilemapCell(target.entity.entity_id, target.col, target.row, effectiveIndex);
      tileDragRef.current = {
        entityId: target.entity.entity_id,
        tool: tilePaintTool === "eraser" ? "eraser" : "pencil",
        lastCellKey: `${target.col},${target.row}`,
        rectOrigin: null,
        tileIndex: effectiveIndex,
        paintedInDrag: true,
      };
      setActiveTilemapId(target.entity.entity_id);
      return;
    }

    if (editorMode === "paint" && activeBrush) {
      const currentEntities = activeScene.entities;
      const spriteCount = currentEntities.filter((e) => e.components?.sprite).length;
      const limit = hwStatus?.sprite_limit ?? (activeTarget === "snes" ? 128 : 80);
      if (spriteCount >= limit) {
        logMessage("warn", `Limite de sprites atingido (${spriteCount}/${limit}). Remova entidades antes de pintar.`);
        return;
      }

      beginHistoryCapture();
      let paintX = gridSnap ? snapToGrid(mx, GRID_SNAP_SIZE) : Math.round(mx);
      let paintY = gridSnap ? snapToGrid(my, GRID_SNAP_SIZE) : Math.round(my);
      paintX = snapPositionToGuides(paintX, "vertical");
      paintY = snapPositionToGuides(paintY, "horizontal");
      const entity = createSpriteEntityFromAsset({
        assetPath: activeBrush.assetPath ?? activeBrush.id,
        target: activeTarget,
        existingEntityIds: currentEntities.map((e) => e.entity_id),
        suggestedName: activeBrush.id,
        x: paintX,
        y: paintY,
      });
      addEntity(entity);
      if (activeLayerId) {
        assignEntityToLayer(entity.entity_id, activeLayerId);
      }
      setSelectedEntityId(entity.entity_id);
      logMessage(
        "success",
        `Sprite '${entity.entity_id}' pintado na cena${activeLayerId ? ` (Camada: ${activeLayerId})` : ""}.`
      );
      const cellKey = `${paintX},${paintY}`;
      paintDragRef.current = { lastPaintCell: cellKey, paintedInDrag: true };
      return;
    }

    if (editorMode === "erase") {
      beginHistoryCapture();
      const erasedIds = new Set<string>();
      const entity = hitTest(mx, my);
      if (entity) {
        removeEntity(entity.entity_id);
        erasedIds.add(entity.entity_id);
        logMessage("info", `Objeto '${entity.entity_id}' removido.`);
      }
      eraseDragRef.current = { erasedIds, erasedInDrag: erasedIds.size > 0 };
      return;
    }

    if (editorMode === "collision") {
      const cmap = activeScene.collision_map;
      const tw = cmap?.tile_width ?? GRID_SNAP_SIZE;
      const th = cmap?.tile_height ?? GRID_SNAP_SIZE;
      const mapW = cmap?.width ?? (activeTarget === "snes" ? 32 : 40);
      const tileX = Math.floor(mx / tw);
      const tileY = Math.floor(my / th);
      const tileIndex = tileY * mapW + tileX;
      // left button = solid (1); right button = free (0)
      const tileValue: 0 | 1 = event.button === 2 ? 0 : 1;
      beginHistoryCapture();
      updateCollisionMap(tileIndex, tileValue);
      collisionDragRef.current = { lastPaintTile: tileIndex, paintedInDrag: true, value: tileValue };
      return;
    }

    if (editorMode === "select" && event.shiftKey && event.button === 0) {
      const pickStack = collectEntitiesUnderPoint(mx, my);
      if (pickStack.length > 1) {
        setDenseStackPicker({ clientX: event.clientX, clientY: event.clientY, stack: pickStack });
        setDenseStackFilter("all");
        setDenseStackSpotlight(false);
        setDenseStackPickerIndex(0);
        setDenseStackPreviewEntityId(pickStack[0]?.entity_id ?? null);
        densePickRef.current = null;
        logMessage(
          "info",
          `[Viewport] ${pickStack.length} entidades sobrepostas — escolha na lista (Shift+clique).`
        );
        return;
      }
    }

    const resizeTarget = hitTestResizeHandle(mx, my);
    if (resizeTarget) {
      const bounds = getEntityBounds(resizeTarget.entity, activeTarget, activeScene.entities);
      setSelectedEntityId(resizeTarget.entity.entity_id);
      dragRef.current = {
        mode: "resize",
        entityId: resizeTarget.entity.entity_id,
        handle: resizeTarget.handle,
        startMx: mx,
        startMy: my,
        origX: bounds.x,
        origY: bounds.y,
        origWidth: bounds.width,
        origHeight: bounds.height,
        lastX: bounds.x,
        lastY: bounds.y,
        lastWidth: bounds.width,
        lastHeight: bounds.height,
        historyCommitted: false,
      };
      beginHistoryCapture();
      setIsDragging(true);
      return;
    }

    const stack = collectEntitiesUnderPoint(mx, my);
    if (stack.length === 0) {
      densePickRef.current = null;
      setSelectedEntityId(null);
      return;
    }

    let entity: Entity;
    if (event.altKey && stack.length > 1) {
      const prev = densePickRef.current;
      const nearby =
        prev &&
        Math.abs(prev.mx - mx) < 4 &&
        Math.abs(prev.my - my) < 4 &&
        prev.ids.length === stack.length &&
        prev.ids.every((id, i) => stack[i]?.entity_id === id);
      const nextIdx = nearby ? (prev.idx + 1) % stack.length : 0;
      densePickRef.current = { mx, my, ids: stack.map((e) => e.entity_id), idx: nextIdx };
      entity = stack[nextIdx]!;
      setSelectedEntityId(entity.entity_id);
      logMessage(
        "info",
        `[Viewport] Cena densa: ${nextIdx + 1}/${stack.length} — ${getEntityDisplayName(entity)} (Alt+clique para proxima sobreposicao).`
      );
      return;
    }

    densePickRef.current = null;
    entity = stack[0]!;

    const bounds = getEntityBounds(entity, activeTarget, activeScene.entities);
    setSelectedEntityId(entity.entity_id);
    dragRef.current = {
      mode: "move",
      entityId: entity.entity_id,
      startMx: mx,
      startMy: my,
      origX: entity.transform.x,
      origY: entity.transform.y,
      origWidth: bounds.width,
      origHeight: bounds.height,
      lastX: entity.transform.x,
      lastY: entity.transform.y,
      lastWidth: bounds.width,
      lastHeight: bounds.height,
      historyCommitted: false,
    };
    beginHistoryCapture();
    setIsDragging(true);
  }

  function handleMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    const { mx, my } = canvasCoords(event);

    if (gameViewLight || guideDrag) {
      return;
    }

    // Track mouse position for brush ghost preview and collision cursor
    if ((editorMode === "paint" && activeBrush) || editorMode === "collision") {
      setSceneMousePos({ x: mx, y: my });
    } else if (sceneMousePos) {
      setSceneMousePos(null);
    }

    // Tile paint drag — pencil/eraser pinta célula-a-célula; rect atualiza preview.
    if (
      editorMode === "paint" &&
      activeBrush?.kind === "tile" &&
      tileDragRef.current &&
      event.buttons === 1
    ) {
      const drag = tileDragRef.current;
      const target = resolveTilemapTarget(mx, my);
      if (!target || target.entity.entity_id !== drag.entityId) {
        return;
      }
      if (drag.tool === "rect" && drag.rectOrigin) {
        setTilePaintRectPreview({
          c0: drag.rectOrigin.col,
          r0: drag.rectOrigin.row,
          c1: target.col,
          r1: target.row,
        });
        return;
      }
      const cellKey = `${target.col},${target.row}`;
      if (cellKey !== drag.lastCellKey) {
        paintTilemapCell(drag.entityId, target.col, target.row, drag.tileIndex);
        drag.lastCellKey = cellKey;
        drag.paintedInDrag = true;
      }
      return;
    }

    // Paint drag — stamp entities along mouse path with grid-cell dedup
    if (editorMode === "paint" && activeBrush && paintDragRef.current && event.buttons === 1) {
      let paintX = gridSnap ? snapToGrid(mx, GRID_SNAP_SIZE) : Math.round(mx);
      let paintY = gridSnap ? snapToGrid(my, GRID_SNAP_SIZE) : Math.round(my);
      paintX = snapPositionToGuides(paintX, "vertical");
      paintY = snapPositionToGuides(paintY, "horizontal");
      const cellKey = `${paintX},${paintY}`;
      if (cellKey !== paintDragRef.current.lastPaintCell) {
        const currentEntities = useEditorStore.getState().activeScene?.entities ?? [];
        const spriteCount = currentEntities.filter((e) => e.components?.sprite).length;
        const limit = hwStatus?.sprite_limit ?? (activeTarget === "snes" ? 128 : 80);
        if (spriteCount < limit) {
          const entity = createSpriteEntityFromAsset({
            assetPath: activeBrush.assetPath ?? activeBrush.id,
            target: activeTarget,
            existingEntityIds: currentEntities.map((e) => e.entity_id),
            suggestedName: activeBrush.id,
            x: paintX,
            y: paintY,
          });
          addEntity(entity);
          setSelectedEntityId(entity.entity_id);
          paintDragRef.current.lastPaintCell = cellKey;
          paintDragRef.current.paintedInDrag = true;
        }
      }
      return;
    }

    // Erase drag — remove entities along mouse path with dedup
    if (editorMode === "erase" && eraseDragRef.current && event.buttons === 1) {
      const entity = hitTest(mx, my);
      if (entity && !eraseDragRef.current.erasedIds.has(entity.entity_id)) {
        removeEntity(entity.entity_id);
        eraseDragRef.current.erasedIds.add(entity.entity_id);
        eraseDragRef.current.erasedInDrag = true;
        logMessage("info", `Objeto '${entity.entity_id}' removido.`);
      }
      return;
    }

    // Collision drag — paint/erase tiles along mouse path with cell dedup
    if (editorMode === "collision" && collisionDragRef.current && event.buttons !== 0) {
      const latestCmap = useEditorStore.getState().activeScene?.collision_map;
      const tw = latestCmap?.tile_width ?? GRID_SNAP_SIZE;
      const th = latestCmap?.tile_height ?? GRID_SNAP_SIZE;
      const mapW = latestCmap?.width ?? (activeTarget === "snes" ? 32 : 40);
      const tileX = Math.floor(mx / tw);
      const tileY = Math.floor(my / th);
      const tileIndex = tileY * mapW + tileX;
      if (tileIndex !== collisionDragRef.current.lastPaintTile) {
        updateCollisionMap(tileIndex, collisionDragRef.current.value);
        collisionDragRef.current.lastPaintTile = tileIndex;
        collisionDragRef.current.paintedInDrag = true;
      }
      return;
    }

    // Select mode drag (existing behavior)
    const drag = dragRef.current;
    if (!drag || event.buttons !== 1) return;
    if (drag.mode === "resize") {
      const entity = activeScene?.entities.find((candidate) => candidate.entity_id === drag.entityId);
      const sprite = entity?.components?.sprite;
      if (!entity || !sprite || !drag.handle) {
        return;
      }

      let pointerX = gridSnap ? snapToGrid(mx, GRID_SNAP_SIZE) : Math.round(mx);
      let pointerY = gridSnap ? snapToGrid(my, GRID_SNAP_SIZE) : Math.round(my);
      pointerX = snapPositionToGuides(pointerX, "vertical");
      pointerY = snapPositionToGuides(pointerY, "horizontal");
      let left = drag.origX;
      let top = drag.origY;
      let right = drag.origX + drag.origWidth;
      let bottom = drag.origY + drag.origHeight;

      if (drag.handle.includes("w")) {
        left = Math.min(pointerX, right - MIN_ENTITY_SIZE);
      }
      if (drag.handle.includes("e")) {
        right = Math.max(pointerX, left + MIN_ENTITY_SIZE);
      }
      if (drag.handle.includes("n")) {
        top = Math.min(pointerY, bottom - MIN_ENTITY_SIZE);
      }
      if (drag.handle.includes("s")) {
        bottom = Math.max(pointerY, top + MIN_ENTITY_SIZE);
      }

      const rawNextWidth = Math.max(Math.round(right - left), MIN_ENTITY_SIZE);
      const rawNextHeight = Math.max(Math.round(bottom - top), MIN_ENTITY_SIZE);
      const constrained = constrainSpriteFrameSize(
        activeTarget,
        sprite.asset,
        rawNextWidth,
        rawNextHeight
      );
      const nextWidth = constrained.frameWidth;
      const nextHeight = constrained.frameHeight;
      const nextX = drag.handle.includes("w")
        ? Math.round(right - nextWidth)
        : Math.round(left);
      const nextY = drag.handle.includes("n")
        ? Math.round(bottom - nextHeight)
        : Math.round(top);

      if (
        nextX === drag.lastX &&
        nextY === drag.lastY &&
        nextWidth === drag.lastWidth &&
        nextHeight === drag.lastHeight
      ) {
        return;
      }

      if (!drag.historyCommitted) {
        commitHistoryCapture();
        drag.historyCommitted = true;
      }

      drag.lastX = nextX;
      drag.lastY = nextY;
      drag.lastWidth = nextWidth;
      drag.lastHeight = nextHeight;
      updateEntity(
        drag.entityId,
        {
          transform: { x: nextX, y: nextY },
          components: {
            ...entity.components,
            sprite: {
              ...sprite,
              frame_width: nextWidth,
              frame_height: nextHeight,
            },
          },
        },
        { recordHistory: false }
      );
      return;
    }

    const dx = Math.round(mx - drag.startMx);
    const dy = Math.round(my - drag.startMy);
    let nextX = gridSnap ? snapToGrid(drag.origX + dx, GRID_SNAP_SIZE) : drag.origX + dx;
    let nextY = gridSnap ? snapToGrid(drag.origY + dy, GRID_SNAP_SIZE) : drag.origY + dy;
    nextX = snapPositionToGuides(nextX, "vertical");
    nextY = snapPositionToGuides(nextY, "horizontal");
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
    // Collision drag commit — single undo entry + persist
    const collisionDrag = collisionDragRef.current;
    if (collisionDrag) {
      collisionDragRef.current = null;
      if (collisionDrag.paintedInDrag) {
        commitHistoryCapture();
        const { activeProjectDir: projectDir } = useEditorStore.getState();
        if (projectDir) {
          try {
            await persistActiveScene(projectDir, "Viewport", "Mapa de colis\u00e3o editado.");
          } catch (error: unknown) {
            logMessage("error", `[Viewport] Falha ao salvar mapa de colis\u00e3o: ${describeError(error)}`);
          }
        }
      } else {
        cancelHistoryCapture();
      }
      return;
    }

    // Tile paint drag commit — encerra pencil/eraser OR aplica rect ao soltar
    const tileDrag = tileDragRef.current;
    if (tileDrag) {
      tileDragRef.current = null;
      if (tileDrag.tool === "rect" && tileDrag.rectOrigin) {
        const preview = useEditorStore.getState().tilePaintRectPreview;
        setTilePaintRectPreview(null);
        if (preview) {
          fillTilemapRect(
            tileDrag.entityId,
            preview.c0,
            preview.r0,
            preview.c1,
            preview.r1,
            tileDrag.tileIndex
          );
          tileDrag.paintedInDrag = true;
        }
      }
      if (tileDrag.paintedInDrag) {
        if (tileDrag.tool !== "rect") {
          commitHistoryCapture();
        }
        const { activeProjectDir: projectDir } = useEditorStore.getState();
        if (projectDir) {
          try {
            await persistActiveScene(projectDir, "Viewport", "Tiles pintados.");
          } catch (error: unknown) {
            logMessage("error", `[Viewport] Falha ao salvar apos pintar tiles: ${describeError(error)}`);
          }
        }
      } else if (tileDrag.tool !== "rect") {
        cancelHistoryCapture();
      }
      return;
    }

    // Paint drag commit
    const paintDrag = paintDragRef.current;
    if (paintDrag) {
      paintDragRef.current = null;
      if (paintDrag.paintedInDrag) {
        commitHistoryCapture();
        const { activeProjectDir: projectDir } = useEditorStore.getState();
        if (projectDir) {
          try {
            await persistActiveScene(projectDir, "Viewport", "Sprites pintados via drag.");
          } catch (error: unknown) {
            logMessage("error", `[Viewport] Falha ao salvar apos pintar: ${describeError(error)}`);
          }
        }
      } else {
        cancelHistoryCapture();
      }
      return;
    }

    // Erase drag commit — single undo entry + batch persist
    const eraseDrag = eraseDragRef.current;
    if (eraseDrag) {
      eraseDragRef.current = null;
      if (eraseDrag.erasedInDrag) {
        commitHistoryCapture();
        const { activeProjectDir: projectDir } = useEditorStore.getState();
        if (projectDir) {
          try {
            await persistActiveScene(projectDir, "Viewport", "Entidades apagadas via drag.");
          } catch (error: unknown) {
            logMessage("error", `[Viewport] Falha ao salvar apos apagar: ${describeError(error)}`);
          }
        }
      } else {
        cancelHistoryCapture();
      }
      return;
    }

    // Select drag commit (existing behavior)
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
        logMessage("error", `[Viewport] Falha ao salvar apos editar gizmo: ${describeError(error)}`);
      }
    }
  }

  function handleMouseLeave() {
    void handleMouseUp();
    setSceneMousePos(null);
  }

  function handleSceneDoubleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (gameViewLight) {
      return;
    }

    const { mx, my } = canvasCoords(event);
    const guideHit = getGuideHit(mx, my);
    if (guideHit) {
      setSceneGuides((current) => current.filter((guide) => guide.id !== guideHit.id));
      return;
    }

    const picked = hitTest(mx, my);
    if (picked?.components?.tilemap) {
      setActiveWorkspace("scene");
      setActiveViewportTab("scene");
      setSelectedEntityId(picked.entity_id);
      setActiveTilemapId(picked.entity_id);
      setEditorMode("paint");
      const brush = buildTilemapAuthoringBrush(picked);
      if (brush) {
        setActiveBrush(brush);
      }
      logMessage(
        "info",
        `[Viewport] Duplo-clique: tilemap '${getEntityDisplayName(picked)}' — modo pintura; paleta embutida no topo do stage (ou Tools > Paleta Contextual).`
      );
      return;
    }

    const logic = picked?.components?.logic;
    const graphInline = logic?.graph?.trim() ?? "";
    const hasInlineGraph = graphInline.length > 2;
    if (picked && (logic?.graph_ref || hasInlineGraph)) {
      setActiveWorkspace("logic");
      setActiveViewportTab("logic");
      setSelectedEntityId(picked.entity_id);
      logMessage(
        "info",
        `[Viewport] Duplo-clique: abrindo Logic Workspace para '${getEntityDisplayName(picked)}' (graph_ref ou grafo embutido).`
      );
      return;
    }

    if (picked?.components?.sprite) {
      setActiveWorkspace("artstudio");
      setActiveViewportTab("artstudio");
      setSelectedEntityId(picked.entity_id);
      logMessage(
        "info",
        `[Viewport] Duplo-clique: abrindo Art Workspace para '${getEntityDisplayName(picked)}'.`
      );
    }
  }

  function handleRulerMouseDown(
    orientation: SceneGuideOrientation,
    event: React.MouseEvent<HTMLCanvasElement>
  ) {
    if (gameViewLight) {
      return;
    }

    event.preventDefault();
    startGuideDrag(orientation, event.clientX, event.clientY);
  }

  const gameStatus = !hasEmulatorSession
    ? "Carregue uma ROM para iniciar o emulador"
    : emulPaused
      ? "Emulador pausado"
      : emulatorActive
        ? "Emulador ativo"
        : emulatorLoaded
          ? "ROM carregada - aguardando emulador..."
          : "Aguardando emulador...";
  const overlayStatusLooksEmpty = Boolean(
    hwStatus &&
      hwStatus.sprite_count === 0 &&
      hwStatus.dma_used === 0 &&
      hwStatus.palette_banks_used === 0 &&
      hwStatus.bg_layers === 0 &&
      hwStatus.errors.length === 0 &&
      hwStatus.warnings.length === 0
  );
  const overlayHwStatus =
    overlayStatusLooksEmpty && lastOverlayHwStatusRef.current
      ? lastOverlayHwStatusRef.current
      : hwStatus ?? lastOverlayHwStatusRef.current;
  const dmaBudgetBytes = overlayHwStatus?.dma_limit ?? (activeTarget === "snes" ? 8192 : 7372);
  const dmaUsageBytes = Math.min(
    overlayHwStatus?.dma_used ?? overlayHwStatus?.vram_used ?? 0,
    dmaBudgetBytes
  );
  const dmaUsagePercent = Math.min(
    100,
    Math.round((dmaUsageBytes / Math.max(dmaBudgetBytes, 1)) * 100)
  );
  const overlayFps = frameTimingRef.current.fps > 0 ? frameTimingRef.current.fps.toFixed(1) : "0.0";
  const overlaySpriteCount = overlayHwStatus?.sprite_count ?? activeScene?.entities.length ?? 0;
  const sceneAssetHealth = (() => {
    if (!activeScene || !activeProjectDir) {
      return summarizeSceneAssetHealth([]);
    }
    const referenced = new Set<string>();
    const fallbackByPath = new Map<string, boolean>();
    for (const entity of activeScene.entities) {
      const spriteAsset = entity.components?.sprite?.asset?.trim();
      if (spriteAsset) referenced.add(spriteAsset);
      const tilemap = entity.components?.tilemap;
      const tilemapAsset = tilemap?.tileset?.trim();
      if (tilemapAsset) {
        referenced.add(tilemapAsset);
        if (!hasCanonicalTilemapCells(tilemap)) {
          fallbackByPath.set(tilemapAsset, true);
        }
      }
    }
    for (const layer of activeScene.background_layers) {
      const layerAsset = (layer.tilemap ?? layer.tileset)?.trim();
      if (layerAsset) referenced.add(layerAsset);
    }
    const refs = [];
    for (const relativePath of referenced) {
      const absolutePath = resolveProjectAssetPath(activeProjectDir, relativePath);
      const entry = assetCacheRef.current.get(absolutePath);
      refs.push({
        relativePath,
        loadStatus: toAssetVisualLoadStatus(entry),
        legacyFallback: fallbackByPath.get(relativePath) ?? false,
        legacyFallbackDetail: DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
      });
    }
    return summarizeSceneAssetHealth(refs);
  })();

  const isSnes = activeTarget === "snes";
  const targetLabel = isSnes ? "SNES" : "Mega Drive";
  const resolution = isSnes ? "256x224" : "320x224";
  const spriteLimit = isSnes ? 128 : 80;
  const bgLayerLimit = 4;
  const overlayInteractionBusy =
    activeViewportTab === "scene" && (isDragging || isPanning || Boolean(paintDragRef.current) || Boolean(eraseDragRef.current) || Boolean(collisionDragRef.current));
  const overlayAuthoringMode =
    activeViewportTab === "scene" &&
    (editorMode === "paint" || editorMode === "erase" || editorMode === "collision");
  const showNonCriticalSceneOverlays =
    showSceneNavigator && !gameViewLight && !overlayInteractionBusy && !overlayAuthoringMode;
  const showWorldAuthoringOverlay =
    showViewportWarnings && showWorldAuthoringStrip && !overlayInteractionBusy;

  return (
    <div className="flex h-full flex-col bg-[#1e1e2e]">
      {denseStackPicker && activeViewportTab === "scene" ? (
        <div
          data-testid="viewport-dense-stack-picker"
          className="fixed z-[120] max-h-[min(70vh,420px)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-[#89b4fa]/40 bg-[#11111b]/98 p-2 text-[11px] shadow-2xl backdrop-blur-md"
          style={{
            left: Math.min(
              typeof window !== "undefined" ? window.innerWidth - 280 : 12,
              Math.max(12, denseStackPicker.clientX - 8)
            ),
            top: Math.min(
              typeof window !== "undefined" ? window.innerHeight - 120 : 12,
              denseStackPicker.clientY + 12
            ),
          }}
        >
          <p className="border-b border-[#313244] px-1 pb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
            Entidades sob o ponteiro ({denseStackFiltered.length}/{denseStackPicker.stack.length})
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(
              [
                ["all", "Todas"],
                ["sprite", "Sprites"],
                ["tilemap", "Tilemaps"],
                ["camera", "Cameras"],
                ["imported", "Importadas"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setDenseStackFilter(value);
                  setDenseStackPickerIndex(0);
                }}
                className={`rounded border px-1.5 py-0.5 text-[9px] transition-colors ${
                  denseStackFilter === value
                    ? "border-[#89b4fa]/70 bg-[#89b4fa]/15 text-[#89b4fa]"
                    : "border-[#313244] bg-[#181825] text-[#a6adc8] hover:border-[#89b4fa]/50"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDenseStackSpotlight((current) => !current)}
              className={`rounded border px-1.5 py-0.5 text-[9px] transition-colors ${
                denseStackSpotlight
                  ? "border-[#f9e2af]/70 bg-[#f9e2af]/15 text-[#f9e2af]"
                  : "border-[#313244] bg-[#181825] text-[#a6adc8] hover:border-[#f9e2af]/50"
              }`}
              title="Escurece o resto da cena para focar o preview atual da pilha."
            >
              Spotlight {denseStackSpotlight ? "ON" : "OFF"}
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-1" role="listbox" aria-label="Entidades sob o ponteiro">
            {denseStackFiltered.map((ent, index) => {
              const ctx = resolveImportedEntityContext(ent);
              const isActive = index === denseStackPickerIndex;
              return (
                <li key={ent.entity_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => {
                      setDenseStackPickerIndex(index);
                      setDenseStackPreviewEntityId(ent.entity_id);
                    }}
                    onFocus={() => {
                      setDenseStackPickerIndex(index);
                      setDenseStackPreviewEntityId(ent.entity_id);
                    }}
                    onClick={() => {
                      selectDenseStackEntity(ent);
                    }}
                    className={`flex w-full flex-col items-start rounded border px-2 py-1.5 text-left transition-colors ${
                      isActive
                        ? "border-[#89b4fa] bg-[#1e1e2e] ring-1 ring-[#89b4fa]/35"
                        : "border-[#313244] bg-[#181825] hover:border-[#89b4fa]/60 hover:bg-[#1e1e2e]"
                    }`}
                  >
                    <span className="font-semibold text-[#cdd6f4]">
                      {index + 1}. {getEntityDisplayName(ent)}
                    </span>
                    <span className="font-mono text-[9px] text-[#6c7086]">{ent.entity_id}</span>
                    {ctx.badgeLabel ? (
                      <span className="mt-0.5 rounded bg-[#313244]/80 px-1.5 py-0.5 text-[8px] text-[#a6adc8]">
                        {ctx.badgeLabel}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {denseStackFiltered.length === 0 ? (
            <p className="mt-2 rounded border border-[#313244] bg-[#181825] px-2 py-1 text-[9px] text-[#6c7086]">
              Nenhuma entidade para o filtro atual. Troque o filtro para ver a pilha completa.
            </p>
          ) : null}
          {denseStackFiltered[denseStackPickerIndex] ? (
            <div className="mt-2 flex flex-wrap gap-1 border-t border-[#313244] px-1 pt-2">
              <button
                type="button"
                data-testid="viewport-dense-stack-focus-preview"
                onClick={() => selectDenseStackEntity(denseStackFiltered[denseStackPickerIndex], { focus: true })}
                className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[9px] font-semibold text-[#89b4fa] hover:bg-[#89b4fa]/20"
              >
                Selecionar + foco
              </button>
              <button
                type="button"
                data-testid="viewport-dense-stack-solo-preview"
                onClick={() =>
                  selectDenseStackEntity(denseStackFiltered[denseStackPickerIndex], { focus: true, solo: true })
                }
                className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-2 py-1 text-[9px] font-semibold text-[#f9e2af] hover:bg-[#f9e2af]/20"
              >
                Isolar alvo
              </button>
            </div>
          ) : null}
          <p className="mt-2 border-t border-[#313244] px-1 pt-2 text-[9px] text-[#6c7086]">
            ↑/↓ navega · Enter seleciona · Esc fecha · Alt+clique ainda cicla sem abrir a lista.
          </p>
        </div>
      ) : null}
      {(showWorkspaceTabs || activeViewportTab === "game") && (
        <div className="flex items-center justify-between border-b border-[#313244] bg-[#181825] pr-3">
          {showWorkspaceTabs ? (
            <Tabs
              tabs={VIEWPORT_TABS}
              activeTab={activeViewportTab}
              onTabChange={setActiveViewportTab}
              className="flex-1 border-b-0"
            />
          ) : (
            <div className="min-h-8 flex-1" />
          )}
          {activeViewportTab === "game" && (
            <button
              type="button"
              onClick={() => setShowPerformanceOverlay((current) => !current)}
              className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                showPerformanceOverlay
                  ? "border-[#89b4fa] bg-[#89b4fa]/15 text-[#89b4fa]"
                  : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
              }`}
              title="Alternar overlay de performance no Game View"
            >
              Overlay {showPerformanceOverlay ? "ON" : "OFF"}
            </button>
          )}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden bg-[#11111b] flex flex-col">
        <div
          className={`flex-1 overflow-hidden bg-[#11111b] h-full min-h-0 ${
            activeViewportTab === "logic" || activeViewportTab === "retrofx" || activeViewportTab === "artstudio"
              ? "flex"
              : "flex flex-col"
          }`}
        >
          {activeViewportTab === "scene" && (
            <div className="flex flex-1 flex-col min-h-0">
            {/* Toolbar horizontal dedicada (V, B, E, C, G, Zoom) */}
            <div className="flex shrink-0 items-center gap-1 border-b border-[#313244] bg-[#181825] px-2 py-1.5">
              {([
                { id: "select" as const, icon: "🖱️", label: "Selecionar (V)", activeColor: "bg-[#89b4fa]" },
                { id: "paint" as const, icon: "✏️", label: "Pintar (B)", activeColor: "bg-[#89b4fa]" },
                { id: "erase" as const, icon: "🧹", label: "Apagar (E)", activeColor: "bg-[#89b4fa]" },
                { id: "collision" as const, icon: "🛡️", label: "Colis\u00e3o (C)", activeColor: "bg-[#f38ba8]" },
              ]).map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => setEditorMode(tool.id)}
                  className={`rounded px-2 py-1 text-[10px] font-semibold transition-all ${
                    editorMode === tool.id
                      ? `${tool.activeColor} text-[#11111b]`
                      : "text-[#7f849c] hover:bg-[#313244] hover:text-[#cdd6f4]"
                  }`}
                  title={tool.label}
                >
                  {tool.icon}
                </button>
              ))}
              <div className="mx-1 w-px bg-[#313244] self-stretch" />
              <button
                type="button"
                onClick={() => setGridSnap((current) => !current)}
                className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
                  gridSnap
                    ? "border border-[#94e2d5] bg-[#94e2d5]/15 text-[#94e2d5]"
                    : "border border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Snap ao grid 8px (G)"
              >
                G
              </button>
              <button
                type="button"
                onClick={() => setShowGrid((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  showGrid
                    ? "border-[#89b4fa] bg-[#89b4fa]/15 text-[#89b4fa]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Mostrar grid principal"
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => setShowSubGrid((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  showSubGrid
                    ? "border-[#89b4fa] bg-[#89b4fa]/15 text-[#89b4fa]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Mostrar sub-grid"
              >
                Sub
              </button>
              <button
                type="button"
                onClick={() => setGuideSnap((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  guideSnap
                    ? "border-[#94e2d5] bg-[#94e2d5]/15 text-[#94e2d5]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Snap para guias e grid"
              >
                Guide
              </button>
              <button
                type="button"
                onClick={() => setShowBackground((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  showBackground
                    ? "border-[#a6e3a1] bg-[#a6e3a1]/15 text-[#a6e3a1]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Mostrar background"
              >
                BG
              </button>
              <button
                type="button"
                onClick={() => setShowTilemaps((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  showTilemaps
                    ? "border-[#94e2d5] bg-[#94e2d5]/15 text-[#94e2d5]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Mostrar tilemaps"
              >
                TM
              </button>
              <button
                type="button"
                onClick={() => setShowSprites((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  showSprites
                    ? "border-[#cba6f7] bg-[#cba6f7]/15 text-[#cba6f7]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Mostrar sprites"
              >
                SP
              </button>
              <button
                type="button"
                onClick={() => setShowCollisionOverlay((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  showCollisionOverlay
                    ? "border-[#f38ba8] bg-[#f38ba8]/15 text-[#f38ba8]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title={
                  activeScene?.collision_map
                    ? `Overlay de colisão (${activeScene.collision_map.width}×${activeScene.collision_map.height} tiles importados/cena)`
                    : "Mostrar overlay de colisao (sem collision_map na cena)"
                }
              >
                Col
              </button>
              {([
                ["Cam", showCameraOverlay, setShowCameraOverlay, "Mostrar camera e janela MD"],
                ["Bnd", showEntityBounds, setShowEntityBounds, "Mostrar bounds das entidades"],
                ["Lbl", showEntityLabels, setShowEntityLabels, "Mostrar labels das entidades"],
                ["Stg", showStagingOverlay, setShowStagingOverlay, "Mostrar staging importado"],
                ["Warn", showViewportWarnings, setShowViewportWarnings, "Mostrar avisos de autoria no viewport"],
                ["Nav", showSceneNavigator, setShowSceneNavigator, "Mostrar navegador do mundo"],
                ["Key", showKeyColor, setShowKeyColor, "Mostrar cor-chave magenta para debug"],
                ["Dock", showCommandDock, setShowCommandDock, "Mostrar dock do objeto selecionado"],
              ] as const).map(([label, active, setter, title]) => (
                <button
                  key={label}
                  type="button"
                  data-testid={`viewport-toggle-${label.toLowerCase()}`}
                  onClick={() => setter((current) => !current)}
                  className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                    active
                      ? "border-[#89dceb] bg-[#89dceb]/15 text-[#89dceb]"
                      : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                  }`}
                  title={title}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setGameViewLight((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  gameViewLight
                    ? "border-[#f9e2af] bg-[#f9e2af]/15 text-[#f9e2af]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Game View Light"
              >
                GV
              </button>
              <div className="mx-1 w-px bg-[#313244] self-stretch" />
              <button
                type="button"
                onClick={focusSelectedEntity}
                disabled={!selectedEntity}
                className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#89b4fa] hover:text-[#89b4fa] disabled:cursor-not-allowed disabled:opacity-40"
                title="Centralizar entidade selecionada"
              >
                Foco
              </button>
              <button
                type="button"
                data-testid="viewport-entity-solo-toggle"
                onClick={toggleSelectedEntitySolo}
                disabled={!selectedEntity}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  selectedEntity && soloEntityId === selectedEntity.entity_id
                    ? "border-[#f9e2af] bg-[#f9e2af]/15 text-[#f9e2af]"
                    : "border-[#313244] bg-[#11111b] text-[#a6adc8] hover:border-[#f9e2af] hover:text-[#f9e2af]"
                }`}
                title="Isolar visualmente a entidade selecionada sem alterar a cena"
              >
                Solo
              </button>
              <button
                type="button"
                onClick={centerViewportOnCamera}
                className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#f9e2af] transition-colors hover:border-[#f9e2af]"
                title="Centralizar camera/janela MD visivel"
              >
                Camera
              </button>
              <button
                type="button"
                onClick={resetSceneView}
                className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
                title="Resetar vista (zoom + pan)"
              >
                Reset View
              </button>
              <button
                type="button"
                onClick={() => setClampViewportToWorld((current) => !current)}
                className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  clampViewportToWorld
                    ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/10 text-[#a6e3a1]"
                    : "border-[#313244] bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8]"
                }`}
                title="Travar pan nos limites do mundo"
              >
                Clamp
              </button>
              {sceneDensityStatus.shouldSuggestStaging ? (
                <button
                  type="button"
                  onClick={applyAuthoringStagingLayout}
                  className="rounded border border-[#fab387]/35 bg-[#fab387]/10 px-2 py-1 text-[10px] font-semibold text-[#fab387] transition-colors hover:bg-[#fab387]/20"
                  title="Distribuir cena densa em staging de autoria sem perder auditabilidade"
                >
                  Normalizar Cena
                </button>
              ) : null}
              <span
                className="hidden max-w-[10rem] truncate text-[9px] text-[#6c7086] xl:inline"
                title="Shift+clique na pilha abre lista; Alt+clique cicla"
              >
                Shift=lista · Alt=ciclo
              </span>
              <div className="mx-1 w-px bg-[#313244] self-stretch" />
              <button
                type="button"
                onClick={() => setViewportZoom(Math.max(ZOOM_MIN, viewportZoom - ZOOM_STEP))}
                className="rounded border border-[#313244] bg-[#11111b] px-1.5 py-0.5 text-[10px] font-semibold text-[#6c7086] transition-colors hover:text-[#a6adc8] disabled:opacity-30"
                disabled={viewportZoom <= ZOOM_MIN}
                title="Zoom out (Ctrl+-)"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => resetViewportZoom()}
                className="min-w-[40px] rounded border border-[#313244] bg-[#11111b] px-1.5 py-0.5 text-center text-[10px] font-semibold text-[#6c7086] transition-colors hover:text-[#a6adc8]"
                title="Reset zoom (Ctrl+0)"
              >
                {Math.round(viewportZoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setViewportZoom(Math.min(ZOOM_MAX, viewportZoom + ZOOM_STEP))}
                className="rounded border border-[#313244] bg-[#11111b] px-1.5 py-0.5 text-[10px] font-semibold text-[#6c7086] transition-colors hover:text-[#a6adc8] disabled:opacity-30"
                disabled={viewportZoom >= ZOOM_MAX}
                title="Zoom in (Ctrl+=)"
              >
                +
              </button>
            </div>

            {/* Área de canvas com overflow para mais espaço */}
            <div
              ref={sceneStageRef}
              className="relative flex-1 overflow-hidden min-h-0"
              onWheel={handleSceneStageWheel}
              data-testid="viewport-scene-stage"
            >
            {showSgdkOnboarding && (
              <div
                data-testid="viewport-sgdk-onboarding"
                className="absolute left-1/2 top-4 z-10 -translate-x-1/2 flex max-w-[420px] items-start gap-2 rounded border border-[#fab387]/40 bg-[#fab387]/10 px-3 py-2"
              >
                <div className="flex-1">
                  <p className="text-[10px] font-semibold text-[#fab387]">
                    {sgdkOnboarding.title}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-[#a6adc8]">
                    {sgdkOnboarding.body}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSgdkOnboardingDismissed(true);
                    localStorage.setItem("rds:sgdk-onboarding-dismissed", "1");
                  }}
                  className="shrink-0 rounded border border-[#fab387]/40 px-2 py-0.5 text-[10px] font-semibold text-[#fab387] transition-colors hover:bg-[#fab387]/20"
                >
                  Entendi
                </button>
              </div>
            )}
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(calc(-50% + ${viewportPan.x}px), calc(-50% + ${viewportPan.y}px))`,
                width: sceneScaleWidth + sceneChromeOffset,
                height: sceneScaleHeight + sceneChromeOffset,
              }}
            >
              {!gameViewLight && showCameraOverlay && (
                <div
                  className="absolute left-0 top-0 border border-[#313244] bg-[#181825]"
                  style={{ width: SCENE_RULER_SIZE, height: SCENE_RULER_SIZE }}
                />
              )}
              {!gameViewLight && (
                <canvas
                  ref={sceneRulerTopRef}
                  data-testid="viewport-scene-ruler-top"
                  width={sceneScaleWidth}
                  height={SCENE_RULER_SIZE}
                  onMouseDown={(event) => handleRulerMouseDown("vertical", event)}
                  className="absolute border border-[#313244]"
                  style={{
                    left: SCENE_RULER_SIZE,
                    top: 0,
                    width: sceneScaleWidth,
                    height: SCENE_RULER_SIZE,
                    cursor: "col-resize",
                  }}
                />
              )}
              {!gameViewLight && (
                <canvas
                  ref={sceneRulerLeftRef}
                  data-testid="viewport-scene-ruler-left"
                  width={SCENE_RULER_SIZE}
                  height={sceneScaleHeight}
                  onMouseDown={(event) => handleRulerMouseDown("horizontal", event)}
                  className="absolute border border-[#313244]"
                  style={{
                    left: 0,
                    top: SCENE_RULER_SIZE,
                    width: SCENE_RULER_SIZE,
                    height: sceneScaleHeight,
                    cursor: "row-resize",
                  }}
                />
              )}
              <canvas
                ref={sceneCanvasRef}
                data-testid="viewport-scene-canvas"
                width={sceneWidth}
                height={sceneHeight}
                className="absolute border border-[#45475a]"
                style={{
                  imageRendering: "pixelated",
                  left: sceneChromeOffset,
                  top: sceneChromeOffset,
                  width: sceneScaleWidth,
                  height: sceneScaleHeight,
                }}
                title="Clique para selecionar. Arraste para mover. Espaço+arraste ou botão do meio: pan. Ctrl+Scroll: zoom."
              />
              {editorMode === "paint" && activeBrush?.kind === "tile" && activeScene ? (
                <div
                  data-testid="viewport-tile-paint-flow-strip"
                  className="absolute z-[6] flex max-h-[min(42vh,340px)] w-full max-w-full flex-col overflow-hidden rounded border border-[#313244] bg-[#11111b]/96 shadow-lg"
                  style={{
                    left: sceneChromeOffset,
                    top: sceneChromeOffset,
                    width: sceneScaleWidth,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#313244] px-2 py-1 text-[10px] text-[#cdd6f4]">
                    <span className="font-semibold uppercase tracking-wide text-[#89b4fa]">Fluxo tilemap</span>
                    <span className="text-[#a6adc8]">
                      Alvo:{" "}
                      <span className="font-mono text-[#f9e2af]">
                        {creatorWorkflow.tilemapTargetLabel}
                      </span>
                    </span>
                    <span className="text-[#6c7086]">|</span>
                    <span>
                      <span className="font-semibold text-[#cba6f7]">{creatorWorkflow.tileBrushLabel}</span>
                    </span>
                    <span className="text-[#6c7086]">|</span>
                    <span className="text-[#94e2d5]">Shift: lista pilha · Alt: ciclo · Duplo-clique tilemap</span>
                    <div className="ml-auto flex flex-wrap gap-1">
                      <button
                        type="button"
                        data-testid="viewport-tile-flow-focus-target"
                        onClick={focusActiveTilemapEntity}
                        disabled={!activeTilemapEntityForPalette}
                        className="rounded border border-[#94e2d5]/35 bg-[#94e2d5]/10 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Focar alvo
                      </button>
                      <button
                        type="button"
                        data-testid="viewport-tile-flow-exit-paint"
                        onClick={() => {
                          setEditorMode("select");
                          setActiveTilemapId(null);
                          logMessage("info", "[Viewport] Fluxo tilemap encerrado; retorno para selecao.");
                        }}
                        className="rounded border border-[#313244] bg-[#181825] px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#cdd6f4] transition-colors hover:border-[#89b4fa]"
                      >
                        Voltar select
                      </button>
                    </div>
                  </div>
                  {activeProjectDir && activeTilemapEntityForPalette?.components.tilemap ? (
                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#0b0f19]">
                      <TilePalette
                        tilesetAbsolutePath={resolveProjectAssetPath(
                          activeProjectDir,
                          activeTilemapEntityForPalette.components.tilemap.tileset
                        )}
                        tilesetRelativePath={activeTilemapEntityForPalette.components.tilemap.tileset}
                        tileSize={tilePaintSize > 0 ? tilePaintSize : 8}
                        tilemapEntityId={activeTilemapEntityForPalette.entity_id}
                      />
                    </div>
                  ) : (
                    <p className="pointer-events-none px-2 py-2 text-[9px] text-[#6c7086]">
                      Selecione um tilemap na cena ou abra um projeto para carregar a paleta embutida (fluxo central
                      sem depender só de Tools).
                    </p>
                  )}
                </div>
              ) : null}
              <canvas
                ref={sceneOverlayCanvasRef}
                data-testid="viewport-scene-overlay"
                width={sceneScaleWidth}
                height={sceneScaleHeight}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onDoubleClick={handleSceneDoubleClick}
                onContextMenu={(event) => event.preventDefault()}
                className="absolute"
                style={{
                  left: sceneChromeOffset,
                  top: sceneChromeOffset,
                  width: sceneScaleWidth,
                  height: sceneScaleHeight,
                  cursor: isPanning
                    ? "grabbing"
                    : isDragging
                      ? "grabbing"
                      : gameViewLight
                        ? "grab"
                        : editorMode === "paint"
                          ? activeBrush
                            ? "copy"
                            : "not-allowed"
                          : editorMode === "erase"
                            ? "pointer"
                            : spacePressed
                              ? "grab"
                              : "crosshair",
                }}
                title="Cena: selecionar/arrastar. Espaco+arraste ou botao do meio = pan. Shift+clique com pilha = lista. Alt+clique = proxima sobreposicao. Duplo-clique: guia remove | tilemap pintura | grafo abre Logic. Ctrl+scroll = zoom."
              />
              {!gameViewLight && (
                <div
                  className="pointer-events-none absolute border-2 border-[#f9e2af]/80 bg-[#f9e2af]/8"
                  style={{
                    left: cameraWindowRect.left,
                    top: cameraWindowRect.top,
                    width: cameraWindowRect.width,
                    height: cameraWindowRect.height,
                  }}
                  title="Janela visivel Mega Drive (320x224)"
                />
              )}
              {shortcutHint && (
                <div
                  key={shortcutHint.key}
                  className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex flex-col items-center gap-1 rounded-xl border border-white/20 bg-black/55 px-5 py-3 backdrop-blur-sm"
                  style={{ animation: "rds-hint-fade-in 0.18s ease-out both" }}
                >
                  <span className="text-[11px] font-semibold tracking-wide text-white/90">
                    {shortcutHint.label}
                  </span>
                  <kbd className="rounded bg-white/15 px-2 py-0.5 font-mono text-[10px] text-white/50">
                    {shortcutHint.key.toUpperCase()}
                  </kbd>
                </div>
              )}
              {showNonCriticalSceneOverlays ? (
                <div className="pointer-events-none absolute left-2 top-2 z-20 rounded border border-[#313244] bg-[#11111b]/85 px-2 py-1 text-[9px] text-[#a6adc8]">
                  <p className="font-semibold text-[#cdd6f4]">
                    Janela MD visivel: {sceneFrameWidth}x{sceneFrameHeight}
                  </p>
                  <p>
                    Mundo: {sceneWidth}x{sceneHeight} px
                  </p>
                  <p>
                    Tilemap:{" "}
                    {sceneWorld.tilemapWorldSize
                      ? `${sceneWorld.tilemapWorldSize.width}x${sceneWorld.tilemapWorldSize.height}`
                      : "n/a"}
                  </p>
                  <p>
                    Collision:{" "}
                    {sceneWorld.collisionWorldSize
                      ? `${sceneWorld.collisionWorldSize.width}x${sceneWorld.collisionWorldSize.height}`
                      : "n/a"}
                  </p>
                </div>
              ) : null}
              {overlayInteractionBusy || overlayAuthoringMode ? (
                <div
                  data-testid="viewport-overlay-lane-status"
                  className="pointer-events-none absolute left-2 top-2 z-20 rounded border border-[#313244] bg-[#11111b]/88 px-2 py-1 text-[9px] font-semibold text-[#94e2d5]"
                >
                  Overlays essenciais
                </div>
              ) : null}
              {selectedEntity && showCommandDock ? (
                <div
                  data-testid="viewport-creator-command-dock"
                  className="absolute right-2 top-2 z-20 max-w-[340px] rounded border border-[#313244] bg-[#11111b]/94 px-3 py-2 text-[9px] text-[#a6adc8] shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
                        Mesa de composicao
                      </p>
                      <p className="truncate text-[11px] font-semibold text-[#cdd6f4]">
                        {creatorWorkflow.selectedLabel}
                      </p>
                      <p className="truncate font-mono text-[#6c7086]">
                        {selectedEntity.entity_id} · {creatorWorkflow.selectedBoundsLabel}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={focusSelectedEntity}
                        className="rounded border border-[#313244] bg-[#181825] px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#cdd6f4] transition-colors hover:border-[#89b4fa] hover:text-[#89b4fa]"
                      >
                        Centralizar
                      </button>
                      <button
                        type="button"
                        onClick={toggleSelectedEntitySolo}
                        className={`rounded border px-2 py-1 text-[8px] font-semibold uppercase tracking-wide transition-colors ${
                          soloEntityId === selectedEntity.entity_id
                            ? "border-[#f9e2af] bg-[#f9e2af]/15 text-[#f9e2af]"
                            : "border-[#313244] bg-[#181825] text-[#cdd6f4] hover:border-[#f9e2af] hover:text-[#f9e2af]"
                        }`}
                      >
                        {soloEntityId === selectedEntity.entity_id ? "Solo on" : "Solo"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 rounded border border-[#313244] bg-[#0b1020]/70 p-2 font-mono text-[8px] text-[#94a3b8]">
                    <span>{creatorWorkflow.frameLabel}</span>
                    <span>{creatorWorkflow.worldLabel}</span>
                    <span>{creatorWorkflow.cameraLabel}</span>
                    <span className="font-sans text-[9px] text-[#6c7086]">
                      {creatorWorkflow.editableRegionLabel}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedImportedContext?.roleLabel ? (
                      <span className="rounded-full border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-0.5 text-[#89b4fa]">
                        {selectedImportedContext.roleLabel}
                      </span>
                    ) : null}
                    {selectedImportedContext?.positionLabel ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 ${
                          selectedImportedContext.positionMode === "donor"
                            ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/10 text-[#a6e3a1]"
                            : selectedImportedContext.positionMode === "staging"
                              ? "border-[#fab387]/40 bg-[#fab387]/10 text-[#fab387]"
                              : "border-[#89b4fa]/40 bg-[#89b4fa]/10 text-[#89b4fa]"
                        }`}
                        title={selectedImportedContext.positionDetail ?? undefined}
                      >
                        {selectedImportedContext.positionLabel}
                      </span>
                    ) : null}
                    {selectedEntitySourceRefs.length > 0 ? (
                      <span className="rounded-full border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-2 py-0.5 text-[#f9e2af]">
                        {creatorWorkflow.sourceCountLabel}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5 text-[#a6adc8]">
                      {creatorWorkflow.soloLabel}
                    </span>
                  </div>
                  {selectedImportedContext?.summary ? (
                    <p className="mt-2 leading-relaxed text-[#94a3b8]">
                      {selectedImportedContext.summary}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedEntity.components.tilemap ? (
                      <button
                        type="button"
                        onClick={openSelectedEntityTilemap}
                        className="rounded border border-[#94e2d5]/35 bg-[#94e2d5]/10 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20"
                      >
                        Tilemap
                      </button>
                    ) : null}
                    {entityHasLogicWorkspace(selectedEntity) ? (
                      <button
                        type="button"
                        onClick={openSelectedEntityLogic}
                        className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20"
                      >
                        Objeto -&gt; Logica
                      </button>
                    ) : null}
                    {selectedEntity.components.sprite ? (
                      <button
                        type="button"
                        onClick={openSelectedEntityArt}
                        className="rounded border border-[#a6e3a1]/35 bg-[#a6e3a1]/10 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20"
                      >
                        Objeto -&gt; Art
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void openSelectedEntityPrimarySource()}
                      disabled={selectedEntitySourceRefs.length === 0}
                      className="rounded border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Fonte real
                    </button>
                  </div>
                </div>
              ) : null}
              {showWorldAuthoringOverlay ? (
                <div
                  data-testid="viewport-world-authoring-strip"
                  className="pointer-events-auto absolute left-2 top-24 z-20 max-w-[280px] rounded border border-[#fab387]/45 bg-[#11111b]/95 px-2 py-2 text-[9px] text-[#cdd6f4] shadow-lg"
                >
                  <p className="font-semibold text-[#fab387]">Autoria: mundo vs janela MD</p>
                  <p className="mt-1 leading-relaxed text-[#a6adc8]">
                    O mundo util ou o mapa de colisao excede a area visivel ({sceneFrameWidth}×{sceneFrameHeight}).
                    Use as acoes abaixo em vez de depender apenas de avisos no log de hardware.
                  </p>
                  {collisionAuthoringWarnings.length > 0 ? (
                    <ul className="mt-1 list-inside list-disc font-mono text-[8px] text-[#94e2d5]/90">
                      {collisionAuthoringWarnings.map((w) => (
                        <li key={w} className="truncate" title={w}>
                          {w}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => void focusCollisionMapCenter()}
                      className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/15 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#89b4fa] hover:bg-[#89b4fa]/25"
                    >
                      Centro colisao
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditorMode("collision");
                        logMessage("info", "[Viewport] Modo colisao ativado (ferramenta de autoria).");
                      }}
                      className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/12 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#f38ba8] hover:bg-[#f38ba8]/22"
                    >
                      Modo colisao
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClampViewportToWorld(false);
                        logMessage("info", "[Viewport] Clamp ao mundo desligado — pan livre para navegar fora da moldura.");
                      }}
                      className="rounded border border-[#a6e3a1]/35 bg-[#a6e3a1]/10 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#a6e3a1] hover:bg-[#a6e3a1]/18"
                    >
                      Pan livre
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClampViewportToWorld(true);
                        logMessage("info", "[Viewport] Clamp ao mundo ligado.");
                      }}
                      className="rounded border border-[#313244] bg-[#181825] px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[#cdd6f4] hover:border-[#45475a]"
                    >
                      Clamp on
                    </button>
                  </div>
                </div>
              ) : null}
              {showNonCriticalSceneOverlays ? (
                <div className="absolute bottom-2 right-2 z-20 rounded border border-[#313244] bg-[#11111b]/92 p-2 text-[9px] text-[#a6adc8] shadow-lg">
                <p className="mb-1 font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Navegador do Mundo</p>
                <button
                  type="button"
                  onClick={(event) => {
                    const target = event.currentTarget.getBoundingClientRect();
                    const ratioX = (event.clientX - target.left) / Math.max(target.width, 1);
                    const ratioY = (event.clientY - target.top) / Math.max(target.height, 1);
                    const worldX = sceneWorld.bounds.minX + ratioX * sceneWorld.worldWidth;
                    const worldY = sceneWorld.bounds.minY + ratioY * sceneWorld.worldHeight;
                    focusWorldPoint(worldX, worldY);
                  }}
                  className="relative block h-24 w-36 rounded border border-[#313244] bg-[#0b1020]"
                  title="Mapa de navegacao: clique para centrar o pan no ponto. Moldura azul = area visivel no stage; amarelo = janela MD/camera quando definida."
                >
                  <div className="absolute inset-0 border border-[#6c7086]/40" />
                  {visibleWorldRect ? (
                    <div
                      className="absolute border border-[#89b4fa] bg-[#89b4fa]/20"
                      style={{
                        left: `${((visibleWorldRect.x - sceneWorld.bounds.minX) / Math.max(sceneWorld.worldWidth, 1)) * 100}%`,
                        top: `${((visibleWorldRect.y - sceneWorld.bounds.minY) / Math.max(sceneWorld.worldHeight, 1)) * 100}%`,
                        width: `${(visibleWorldRect.width / Math.max(sceneWorld.worldWidth, 1)) * 100}%`,
                        height: `${(visibleWorldRect.height / Math.max(sceneWorld.worldHeight, 1)) * 100}%`,
                      }}
                    />
                  ) : null}
                  {sceneWorld.camera ? (
                    <div
                      className="absolute border border-[#f9e2af]/80"
                      style={{
                        left: `${((sceneWorld.camera.x - sceneWorld.bounds.minX) / Math.max(sceneWorld.worldWidth, 1)) * 100}%`,
                        top: `${((sceneWorld.camera.y - sceneWorld.bounds.minY) / Math.max(sceneWorld.worldHeight, 1)) * 100}%`,
                        width: `${(sceneWorld.camera.width / Math.max(sceneWorld.worldWidth, 1)) * 100}%`,
                        height: `${(sceneWorld.camera.height / Math.max(sceneWorld.worldHeight, 1)) * 100}%`,
                      }}
                    />
                  ) : null}
                </button>
                <p className="mt-1 text-[#6c7086]">
                  Denso: {sceneDensityStatus.spriteCount} sprites | max stack {sceneDensityStatus.maxStack}
                </p>
                </div>
              ) : null}
            </div>
            {activeScene &&
              activeScene.entities.length === 0 &&
              activeScene.background_layers.length === 0 && (
                <div className="absolute left-1/2 top-1/2 z-10 max-w-[340px] -translate-x-1/2 -translate-y-1/2 rounded border border-[#89b4fa]/30 bg-[#89b4fa]/8 px-3 py-2 text-center text-[10px] leading-relaxed text-[#89b4fa]">
                  <p className="font-semibold">
                    {sceneContext.isImportedProject ? "Cena importada sem alvo visual pronto" : "Cena vazia"}
                  </p>
                  <p className="mt-1">
                    Use <span className="font-semibold">Hierarchy &gt; Sprite Inicial</span> ou{" "}
                    <span className="font-semibold">Tools &gt; Asset Browser &gt; Instanciar</span>{" "}
                    para comecar a montar a cena.
                  </p>
                </div>
              )}
            {activeScene && sceneAssetHealth.referenced > 0 && <SceneAssetHealthBadge health={sceneAssetHealth} />}
            <div className="absolute bottom-0 left-0 right-0 shrink-0 border-t border-[#313244] bg-[#181825]/90 px-2 py-1">
            <span className="select-none text-[10px] text-[#6c7086]">
              {activeScene
                ? `${activeScene.entities.length} entidade(s) | ${activeScene.background_layers.length} layer(s) | ${sceneGuides.length} guia(s) | ${gridSnap ? "snap 8px" : "snap livre"} | ${showGrid ? "grid on" : "grid off"}${
                    gameViewLight
                      ? " | Game View Light"
                      : editorMode === "paint"
                      ? ` | ✏️ Pintar${activeBrush ? ` (${activeBrush.id})` : " — selecione um brush"}`
                      : editorMode === "erase"
                        ? " | 🧹 Apagar — clique/arraste para remover"
                        : editorMode === "collision"
                          ? " | 🛡️ Colis\u00e3o — Esq: s\u00f3lido \u00b7 Dir: livre \u00b7 Esc: sair"
                          : ` | arraste para mover${selectedEntityId && !selectedEntityId.startsWith("layer::") ? " / handles para resize" : ""}`
                  }`
                : "Abra um projeto para visualizar a cena"}
            </span>
            </div>
            </div>
          </div>
        )}

        {activeViewportTab === "game" && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {assetHotReloadNotice && (
              <div
                data-testid="viewport-asset-hot-reload"
                className="mx-auto rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-3 py-1 text-[10px] font-semibold text-[#f9e2af]"
              >
                Assets alterados no disco. {assetHotReloadNotice}
              </div>
            )}
            <div
              ref={gameViewportStageRef}
              className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-2xl border border-[#313244] bg-[radial-gradient(circle_at_top,#111827,#05070f_72%)] p-3"
            >
              <div
                className="relative inline-block"
                data-testid="viewport-game-stage"
                style={{
                  width: MD_WIDTH * gameViewportScale,
                  height: MD_HEIGHT * gameViewportScale,
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={MD_WIDTH}
                  height={MD_HEIGHT}
                  data-testid="viewport-game-canvas"
                  className="border border-[#45475a] bg-black shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
                  style={{
                    imageRendering: "pixelated",
                    width: MD_WIDTH * gameViewportScale,
                    height: MD_HEIGHT * gameViewportScale,
                  }}
                  tabIndex={0}
                />
                {showPerformanceOverlay && (
                  <div
                    data-testid="viewport-performance-overlay"
                    className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1 rounded border border-[#313244] bg-[#11111b]/80 px-2 py-1 font-mono text-[10px] text-[#cdd6f4]"
                  >
                    <span>FPS {overlayFps}</span>
                    <span>Sprites {overlaySpriteCount}</span>
                    <span>DMA est. {Math.round(dmaUsageBytes / 1024)}KB / {Math.round(dmaBudgetBytes / 1024)}KB ({dmaUsagePercent}%)</span>
                  </div>
                )}
                <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-[#313244] bg-[#11111b]/80 px-2 py-1 text-[10px] font-mono text-[#7f849c]">
                  {MD_WIDTH}x{MD_HEIGHT} @ {gameViewportScale}x
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePause()}
                disabled={!hasEmulatorSession || emulPaused}
                data-testid="viewport-pause"
                className="rounded border border-[#fab387]/40 bg-[#fab387]/10 px-2 py-1 text-[10px] font-semibold text-[#fab387] transition-colors hover:bg-[#fab387]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Pausar
              </button>
              <button
                type="button"
                onClick={() => handleResume()}
                disabled={!hasEmulatorSession || !emulPaused}
                data-testid="viewport-resume"
                className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-1 text-[10px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Retomar
              </button>
              <button
                type="button"
                onClick={() => void handleStepFrame()}
                disabled={!hasEmulatorSession || !emulPaused || stepBusy}
                data-testid="viewport-step-frame"
                className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-2 py-1 text-[10px] font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {stepBusy ? "Step..." : "Step 1 frame"}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveState()}
                disabled={!hasEmulatorSession || saveStateBusy}
                data-testid="viewport-save-state"
                className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-1 text-[10px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saveStateBusy ? "Salvando..." : "Salvar state"}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadState()}
                disabled={!hasEmulatorSession || loadStateBusy}
                data-testid="viewport-load-state"
                className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loadStateBusy ? "Carregando..." : "Carregar state"}
              </button>
              <button
                type="button"
                onClick={() => void handleRewind()}
                disabled={!hasEmulatorSession || !emulPaused || rewindBusy}
                data-testid="viewport-rewind"
                className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-2 py-1 text-[10px] font-semibold text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/20 disabled:cursor-not-allowed disabled:opacity-40"
                title="Recuar snapshots automáticos do emulador (atalho: R)"
              >
                {rewindBusy ? "Rewind..." : "Rewind"}
              </button>
              <button
                type="button"
                onClick={() => void handleStartRecording()}
                disabled={!hasEmulatorSession || recordBusy || replayRecording}
                data-testid="viewport-replay-record"
                className="rounded border border-[#94e2d5]/40 bg-[#94e2d5]/10 px-2 py-1 text-[10px] font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {recordBusy && !replayRecording ? "Record..." : "Record"}
              </button>
              <button
                type="button"
                onClick={() => void handleStopRecording()}
                disabled={!hasEmulatorSession || recordBusy || !replayRecording || !activeProjectDir}
                data-testid="viewport-replay-stop"
                className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-2 py-1 text-[10px] font-semibold text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {recordBusy && replayRecording ? "Stop..." : "Stop"}
              </button>
              <button
                type="button"
                onClick={() => void handlePlayReplay()}
                disabled={!hasEmulatorSession || playReplayBusy || replayRecording || !lastReplayPath || !emulPaused}
                data-testid="viewport-replay-play"
                className="rounded border border-[#89dceb]/40 bg-[#89dceb]/10 px-2 py-1 text-[10px] font-semibold text-[#89dceb] transition-colors hover:bg-[#89dceb]/20 disabled:cursor-not-allowed disabled:opacity-40"
                title="Reproduzir o ultimo replay salvo com o estado inicial gravado"
              >
                {playReplayBusy ? "Play..." : "Play Replay"}
              </button>
              <button
                type="button"
                onClick={() => setAudioMuted((current) => !current)}
                data-testid="viewport-audio-mute"
                className="rounded border border-[#cba6f7]/40 bg-[#cba6f7]/10 px-2 py-1 text-[10px] font-semibold text-[#cba6f7] transition-colors hover:bg-[#cba6f7]/20"
              >
                {audioMuted ? "Ativar audio" : "Mutar audio"}
              </button>
            </div>
            <div className="flex items-center gap-4 select-none text-[10px] text-[#6c7086]">
              <span
                data-testid="viewport-game-status"
                className={emulPaused || emulatorActive ? "text-[#a6e3a1]" : "text-[#45475a]"}
              >
                {gameStatus}
              </span>
              {replayRecording && <span className="text-[#94e2d5]">REC ativo</span>}
              {lastReplayPath && !replayRecording && (
                <span className="max-w-64 truncate text-[#89dceb]" title={lastReplayPath}>
                  Replay pronto
                </span>
              )}
              <span>Z=A | X=B | C=C | Enter=Start | Setas=D-Pad | R=Rewind (pausado)</span>
            </div>
          </div>
        )}

        {activeViewportTab === "logic" && (
          <div className="h-full w-full">
            <Suspense fallback={<WorkspaceViewportFallback label="Carregando Logic..." />}>
              <NodeGraphEditor />
            </Suspense>
          </div>
        )}

        {activeViewportTab === "retrofx" && (
          <div className="h-full w-full">
            <Suspense fallback={<WorkspaceViewportFallback label="Carregando RetroFX..." />}>
              <RetroFXDesigner />
            </Suspense>
          </div>
        )}

        {activeViewportTab === "artstudio" && (
          <div className="h-full w-full">
            <Suspense fallback={<WorkspaceViewportFallback label="Carregando ArtStudio..." />}>
              <ArtStudioPanel />
            </Suspense>
          </div>
        )}
      </div>
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
            {(() => {
              const selectedEntity = activeScene?.entities.find(
                (entity) => entity.entity_id === selectedEntityId
              );
              if (!selectedEntity) {
                return selectedEntityId;
              }
              const importedContext = resolveImportedEntityContext(selectedEntity);
              return importedContext.roleLabel
                ? `${getEntityDisplayName(selectedEntity)} · ${importedContext.roleLabel}`
                : getEntityDisplayName(selectedEntity);
            })()}
          </span>
        )}
      </div>
    </div>
  );
}
