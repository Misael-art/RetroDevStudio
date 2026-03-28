import { useCallback, useEffect, useRef, useState } from "react";
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
import NodeGraphEditor from "../nodegraph/NodeGraphEditor";
import ArtStudioPanel from "../artstudio/ArtStudioPanel";
import RetroFXDesigner from "../retrofx/RetroFXDesigner";
import type { Entity } from "../../core/ipc/sceneService";
import { persistActiveScene } from "../../core/scenePersistence";
import { constrainSpriteFrameSize, ONBOARDING_SPRITE_SIZE } from "../../core/sceneConstraints";
import { createSpriteEntityFromAsset } from "../../core/editorEntityFactory";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { resolveProjectAssetPath } from "../../core/pathUtils";

const VIEWPORT_TABS = [
  { id: "scene", label: "Cena", icon: "SC" },
  { id: "game", label: "Jogo", icon: "GM" },
  { id: "logic", label: "Logic", icon: "LG" },
  { id: "retrofx", label: "RetroFX", icon: "FX" },
  { id: "artstudio", label: "ArtStudio", icon: "AT" },
];

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
  status: "loading" | "loaded" | "error";
  source?: CanvasImageSource;
  width?: number;
  height?: number;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getGameViewportScale(
  availableWidth: number,
  availableHeight: number,
  baseWidth = MD_WIDTH,
  baseHeight = MD_HEIGHT
): number {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    return 1;
  }

  const widthScale = Math.floor(availableWidth / baseWidth);
  const heightScale = Math.floor(availableHeight / baseHeight);

  return Math.max(1, Math.min(widthScale, heightScale));
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

function getSceneDimensions(target: "megadrive" | "snes") {
  return {
    width: target === "snes" ? 256 : MD_WIDTH,
    height: MD_HEIGHT,
  };
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

function getRulerStep(zoom: number) {
  const options = [4, 8, 16, 32, 64, 128];
  return options.find((step) => step * zoom >= 48) ?? 256;
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

function getEntityBounds(entity: Entity, target: "megadrive" | "snes"): EntityBounds {
  if (entity.components?.tilemap) {
    return {
      x: entity.transform.x,
      y: entity.transform.y,
      width: entity.components.tilemap.map_width * 8,
      height: entity.components.tilemap.map_height * 8,
      resizable: false,
    };
  }

  if (entity.components?.camera) {
    return {
      x: entity.transform.x + (entity.components.camera.offset_x ?? 0),
      y: entity.transform.y + (entity.components.camera.offset_y ?? 0),
      width: target === "snes" ? 256 : 320,
      height: 224,
      resizable: false,
    };
  }

  return {
    x: entity.transform.x,
    y: entity.transform.y,
    width: entity.components?.sprite?.frame_width ?? 32,
    height: entity.components?.sprite?.frame_height ?? 32,
    resizable: Boolean(entity.components?.sprite),
  };
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
  } = useEditorStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameViewportStageRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRulerTopRef = useRef<HTMLCanvasElement>(null);
  const sceneRulerLeftRef = useRef<HTMLCanvasElement>(null);
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

  const [emulatorActive, setEmulatorActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [gridSnap, setGridSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showSubGrid, setShowSubGrid] = useState(true);
  const [showBackground, setShowBackground] = useState(true);
  const [showTilemaps, setShowTilemaps] = useState(true);
  const [showSprites, setShowSprites] = useState(true);
  const [showCollisionOverlay, setShowCollisionOverlay] = useState(true);
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
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const [sgdkOnboardingDismissed, setSgdkOnboardingDismissed] = useState(
    () => localStorage.getItem("rds:sgdk-onboarding-dismissed") === "1"
  );
  const projectSourceKind = useEditorStore((state) => state.projectSourceKind);
  const isSgdkProject = projectSourceKind === "external_sgdk" || projectSourceKind === "imported_sgdk";
  const hasEmulatorSession = emulatorLoaded || emulatorActive;
  const showSgdkOnboarding = isSgdkProject && !sgdkOnboardingDismissed;
  const hotReloadNoticeTimerRef = useRef<number | null>(null);
  const frameTimingRef = useRef<{ lastFrameAt: number; fps: number }>({
    lastFrameAt: 0,
    fps: 0,
  });
  const sceneDimensions = getSceneDimensions(activeTarget);
  const sceneWidth = sceneDimensions.width;
  const sceneHeight = sceneDimensions.height;
  const sceneScaleWidth = Math.round(sceneWidth * viewportZoom);
  const sceneScaleHeight = Math.round(sceneHeight * viewportZoom);
  const sceneChromeOffset = gameViewLight ? 0 : SCENE_RULER_SIZE;
  const sceneGuideStorageKey = getGuideStorageKey(
    activeProjectDir,
    activeScenePath || activeScene?.scene_id || null
  );

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
      const markError = () => {
        console.warn(
          "[Viewport] Falha ao carregar asset:",
          absolutePath,
          "| assetUrl:",
          assetUrl
        );
        assetCacheRef.current.set(absolutePath, { status: "error" });
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
          markError();
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

            const canvas = document.createElement("canvas");
            canvas.width = imageData.width;
            canvas.height = imageData.height;
            const context = canvas.getContext("2d");
            if (!context) {
              throw new Error("Canvas indisponivel");
            }
            context.putImageData(imageData, 0, 0);

            markLoaded(canvas, canvas.width, canvas.height);
          })
          .catch((err) => {
            console.warn("[Viewport] PPM fetch falhou:", absolutePath, err);
            markError();
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
              markLoaded(bitmap, bitmap.width, bitmap.height);
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
          console.warn("[Viewport] Asset fetch falhou:", absolutePath, err);
          loadImageElement(assetUrl);
        });
      return cacheEntry;
    },
    [activeProjectDir]
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
        x: clamp(((clientX - rect.left) / rect.width) * sceneWidth, 0, sceneWidth),
        y: clamp(((clientY - rect.top) / rect.height) * sceneHeight, 0, sceneHeight),
      };
    },
    [sceneHeight, sceneWidth]
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
          return;
        }
        if (key === "v") {
          event.preventDefault();
          setEditorMode("select");
          return;
        }
        if (key === "b") {
          event.preventDefault();
          setEditorMode("paint");
          return;
        }
        if (key === "e") {
          event.preventDefault();
          setEditorMode("erase");
          return;
        }
        if (key === "c") {
          event.preventDefault();
          setEditorMode("collision");
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
  }, [activeViewportTab, resetViewportZoom, setViewportZoom, viewportZoom]);

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

          const bounds = getEntityBounds(entity, activeTarget);
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

          const bounds = getEntityBounds(entity, activeTarget);
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

      const bounds = getEntityBounds(entity, activeTarget);
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
          context.save();
          context.globalAlpha = 0.82;
          context.drawImage(tilemapAsset.source, x, y, mapWidth, mapHeight);
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
      const x = Math.round(position * viewportZoom) + 0.5;
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, sceneScaleHeight);
      context.stroke();
    };

    const drawHorizontalLine = (position: number, color: string, width = 1) => {
      const y = Math.round(position * viewportZoom) + 0.5;
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

      if (showMinorGrid) {
        for (let x = 0; x <= sceneWidth; x += SUB_GRID_SIZE) {
          if (x % GRID_SNAP_SIZE === 0) continue;
          drawVerticalLine(x, `rgba(137,180,250,${minorAlpha.toFixed(3)})`);
        }
        for (let y = 0; y <= sceneHeight; y += SUB_GRID_SIZE) {
          if (y % GRID_SNAP_SIZE === 0) continue;
          drawHorizontalLine(y, `rgba(137,180,250,${minorAlpha.toFixed(3)})`);
        }
      }

      for (let x = 0; x <= sceneWidth; x += GRID_SNAP_SIZE) {
        drawVerticalLine(x, `rgba(180,190,254,${majorAlpha.toFixed(3)})`);
      }
      for (let y = 0; y <= sceneHeight; y += GRID_SNAP_SIZE) {
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
        const tileX = (tileIndex % collisionMap.width) * tileWidth * viewportZoom;
        const tileY = Math.floor(tileIndex / collisionMap.width) * tileHeight * viewportZoom;
        context.fillRect(
          Math.round(tileX),
          Math.round(tileY),
          Math.round(tileWidth * viewportZoom),
          Math.round(tileHeight * viewportZoom)
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
      const bounds = getEntityBounds(entity, activeTarget);
      const x = Math.round(bounds.x * viewportZoom);
      const y = Math.round(bounds.y * viewportZoom);
      const width = Math.round(bounds.width * viewportZoom);
      const height = Math.round(bounds.height * viewportZoom);
      const isSelected = entity.entity_id === selectedEntityId;
      const color = entity.components?.tilemap
        ? "#94e2d5"
        : entity.components?.camera
          ? "#f9e2af"
          : ["#cba6f7", "#89b4fa", "#a6e3a1", "#fab387", "#f38ba8", "#94e2d5"][index % 6];

      if (entity.components?.camera) {
        context.save();
        context.setLineDash([6, 4]);
        context.strokeStyle = isSelected ? "#f9e2af" : "rgba(249,226,175,0.58)";
        context.lineWidth = isSelected ? 2 : 1;
        context.strokeRect(x + 0.5, y + 0.5, width, height);
        context.setLineDash([]);
        context.fillStyle = isSelected ? "#f9e2af" : "rgba(249,226,175,0.8)";
        context.font = "10px monospace";
        context.fillText(`CAM ${entityDisplayLabel(entity)}`.slice(0, 22), x + 6, y + 14);
        context.restore();
        return;
      }

      if (entity.components?.tilemap) {
        if (!showTilemaps) return;
        context.strokeStyle = isSelected ? "#94e2d5" : "rgba(148,226,213,0.58)";
        context.lineWidth = isSelected ? 2 : 1;
        context.strokeRect(x + 0.5, y + 0.5, width, height);
        context.fillStyle = "#94e2d5";
        context.font = "10px monospace";
        context.fillText(`TM ${entityDisplayLabel(entity)}`.slice(0, 22), x + 6, y + 14);
        if (isSelected) {
          context.fillStyle = "rgba(148,226,213,0.16)";
          context.fillRect(x, y, width, height);
        }
        return;
      }

      if (entity.components?.sprite) {
        if (!showSprites) return;
        context.strokeStyle = isSelected ? "#ffffff" : color;
        context.lineWidth = isSelected ? 2 : 1;
        context.strokeRect(x + 0.5, y + 0.5, width, height);
        context.fillStyle = isSelected ? "#ffffff" : color;
        context.font = "10px monospace";
        context.fillText(entityDisplayLabel(entity).slice(0, 22), x + 6, y + 14);
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

      context.strokeStyle = "rgba(205,214,244,0.55)";
      context.strokeRect(x + 0.5, y + 0.5, width, height);
      context.fillStyle = "#cdd6f4";
      context.font = "10px monospace";
      context.fillText(entityDisplayLabel(entity).slice(0, 22), x + 6, y + 14);
    });

    if (editorMode === "collision" && sceneMousePos) {
      const collisionMap = activeScene.collision_map;
      const tileWidth = collisionMap?.tile_width ?? GRID_SNAP_SIZE;
      const tileHeight = collisionMap?.tile_height ?? GRID_SNAP_SIZE;
      const mapWidth = collisionMap?.width ?? (activeTarget === "snes" ? 32 : 40);
      const mapHeight = collisionMap?.height ?? 28;
      const tileX = Math.floor(sceneMousePos.x / tileWidth);
      const tileY = Math.floor(sceneMousePos.y / tileHeight);
      if (tileX >= 0 && tileX < mapWidth && tileY >= 0 && tileY < mapHeight) {
        const screenX = Math.round(tileX * tileWidth * viewportZoom);
        const screenY = Math.round(tileY * tileHeight * viewportZoom);
        context.fillStyle = "rgba(243,139,168,0.55)";
        context.fillRect(
          screenX,
          screenY,
          Math.round(tileWidth * viewportZoom),
          Math.round(tileHeight * viewportZoom)
        );
        context.strokeStyle = "#f38ba8";
        context.lineWidth = 1;
        context.strokeRect(
          screenX + 0.5,
          screenY + 0.5,
          Math.round(tileWidth * viewportZoom),
          Math.round(tileHeight * viewportZoom)
        );
      }
    }

    if (editorMode === "paint" && activeBrush && sceneMousePos) {
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
      const screenX = Math.round(ghostX * viewportZoom);
      const screenY = Math.round(ghostY * viewportZoom);
      const screenWidth = Math.round(ghostSize.frameWidth * viewportZoom);
      const screenHeight = Math.round(ghostSize.frameHeight * viewportZoom);
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
        context.fillText(`${guide.position}px`, Math.round(guide.position * viewportZoom) + 4, 12);
      } else {
        drawHorizontalLine(guide.position, guideColor, isActiveGuide ? 2 : 1);
        context.fillStyle = guideColor;
        context.font = "10px monospace";
        context.fillText(`${guide.position}px`, 6, Math.round(guide.position * viewportZoom) - 4);
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
    selectedEntityId,
    showCollisionOverlay,
    showGrid,
    showSprites,
    showSubGrid,
    showTilemaps,
    snapPositionToGuides,
    viewportZoom,
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

    for (let pixel = 0; pixel <= sceneWidth; pixel += rulerStep) {
      const x = Math.round(pixel * viewportZoom) + 0.5;
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

    for (let pixel = 0; pixel <= sceneHeight; pixel += rulerStep) {
      const y = Math.round(pixel * viewportZoom) + 0.5;
      leftContext.strokeStyle = "rgba(108,112,134,0.85)";
      leftContext.beginPath();
      leftContext.moveTo(SCENE_RULER_SIZE, y);
      leftContext.lineTo(pixel % (rulerStep * 2) === 0 ? 5 : 9, y);
      leftContext.stroke();
      leftContext.fillText(`${pixel}`, 2, Math.min(y - 2, leftCanvas.height - 4));
    }

    guideMarkers.forEach((guide) => {
      if (guide.orientation === "vertical") {
        const x = Math.round(guide.position * viewportZoom);
        topContext.fillStyle = "#89dceb";
        topContext.fillRect(Math.max(0, x - 1), 0, 3, SCENE_RULER_SIZE);
      } else {
        const y = Math.round(guide.position * viewportZoom);
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
    viewportZoom,
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
      mx: (event.clientX - rect.left) * scaleX,
      my: (event.clientY - rect.top) * scaleY,
    };
  }

  function hitTest(mx: number, my: number) {
    if (!activeScene) return null;

    const hiddenByLayer = new Set<string>();
    for (const sceneLayer of activeScene.layers ?? []) {
      if (!sceneLayer.visible) {
        for (const entityId of sceneLayer.entity_ids) {
          hiddenByLayer.add(entityId);
        }
      }
    }

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
      const bounds = getEntityBounds(entity, activeTarget);
      if (
        mx >= bounds.x &&
        mx <= bounds.x + bounds.width &&
        my >= bounds.y &&
        my <= bounds.y + bounds.height
      ) {
        return entity;
      }
    }

    return null;
  }

  function hitTestResizeHandle(mx: number, my: number): { entity: Entity; handle: ResizeHandle } | null {
    if (!activeScene || !selectedEntityId || selectedEntityId.startsWith("layer::")) {
      return null;
    }

    const entity = activeScene.entities.find((candidate) => candidate.entity_id === selectedEntityId);
    if (!entity) {
      return null;
    }

    const bounds = getEntityBounds(entity, activeTarget);
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

    const resizeTarget = hitTestResizeHandle(mx, my);
    if (resizeTarget) {
      const bounds = getEntityBounds(resizeTarget.entity, activeTarget);
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

    const entity = hitTest(mx, my);
    if (!entity) {
      setSelectedEntityId(null);
      return;
    }

    const bounds = getEntityBounds(entity, activeTarget);
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
    if (!guideHit) {
      return;
    }

    setSceneGuides((current) => current.filter((guide) => guide.id !== guideHit.id));
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
  const dmaBudgetBytes = hwStatus?.dma_limit ?? (activeTarget === "snes" ? 8192 : 7372);
  const dmaUsageBytes = Math.min(hwStatus?.dma_used ?? hwStatus?.vram_used ?? 0, dmaBudgetBytes);
  const dmaUsagePercent = Math.min(
    100,
    Math.round((dmaUsageBytes / Math.max(dmaBudgetBytes, 1)) * 100)
  );
  const overlayFps = frameTimingRef.current.fps > 0 ? frameTimingRef.current.fps.toFixed(1) : "0.0";
  const overlaySpriteCount = hwStatus?.sprite_count ?? activeScene?.entities.length ?? 0;

  const isSnes = activeTarget === "snes";
  const targetLabel = isSnes ? "SNES" : "Mega Drive";
  const resolution = isSnes ? "256x224" : "320x224";
  const spriteLimit = isSnes ? 128 : 80;
  const bgLayerLimit = 4;

  return (
    <div className="flex h-full flex-col bg-[#1e1e2e]">
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
                title="Mostrar overlay de colisao"
              >
                Col
              </button>
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
            <div className="relative flex-1 overflow-hidden min-h-0">
            {showSgdkOnboarding && (
              <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 flex max-w-[420px] items-start gap-2 rounded border border-[#fab387]/40 bg-[#fab387]/10 px-3 py-2">
                <div className="flex-1">
                  <p className="text-[10px] font-semibold text-[#fab387]">
                    Projeto importado de SGDK externo
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-[#a6adc8]">
                    Este projeto foi importado de um projeto SGDK. Meta-sprites, VRAM e DMA sao
                    gerenciados pelo ResComp/SGDK — avisos de hardware nesta cena sao informativos,
                    nao bloqueantes.
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
              {!gameViewLight && (
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
                title="Cena WYSIWYG. Arraste para editar; espaco+arraste ou botao do meio para pan; duplo clique em uma guia para remover."
              />
            </div>
            {activeScene &&
              activeScene.entities.length === 0 &&
              activeScene.background_layers.length === 0 && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 max-w-[320px] rounded border border-[#89b4fa]/30 bg-[#89b4fa]/8 px-3 py-2 text-center text-[10px] leading-relaxed text-[#89b4fa]">
                  Cena vazia. Use <span className="font-semibold">Hierarchy &gt; Sprite Inicial</span> ou{" "}
                  <span className="font-semibold">Tools &gt; Asset Browser &gt; Instanciar</span> para
                  comecar a montar a cena.
                </div>
              )}
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
            <NodeGraphEditor />
          </div>
        )}

        {activeViewportTab === "retrofx" && (
          <div className="h-full w-full">
            <RetroFXDesigner />
          </div>
        )}

        {activeViewportTab === "artstudio" && (
          <div className="h-full w-full">
            <ArtStudioPanel />
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
              return selectedEntity ? getEntityDisplayName(selectedEntity) : selectedEntityId;
            })()}
          </span>
        )}
      </div>
    </div>
  );
}
