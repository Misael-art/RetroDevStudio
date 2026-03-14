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
  emulatorStop,
  keyToJoypad,
  listenToAudioStream,
  startFrameLoop,
  type AudioPayload,
  type FramePayload,
  type JoypadState,
} from "../../core/ipc/emulatorService";
import { listenToProjectAssetChanges } from "../../core/ipc/projectWatcherService";
import NodeGraphEditor from "../nodegraph/NodeGraphEditor";
import RetroFXDesigner from "../retrofx/RetroFXDesigner";
import type { Entity } from "../../core/ipc/sceneService";
import { persistActiveScene } from "../../core/scenePersistence";
import { constrainSpriteFrameSize } from "../../core/sceneConstraints";

const VIEWPORT_TABS = [
  { id: "scene", label: "Cena", icon: "SC" },
  { id: "game", label: "Jogo", icon: "GM" },
  { id: "logic", label: "Logic", icon: "LG" },
  { id: "retrofx", label: "RetroFX", icon: "FX" },
];

const MD_WIDTH = 320;
const MD_HEIGHT = 224;
const GRID_SNAP_SIZE = 8;
const AUDIO_QUEUE_TARGET_FRAMES = 3;
const RESIZE_HANDLE_SIZE = 8;
const MIN_ENTITY_SIZE = GRID_SNAP_SIZE;

type ResizeHandle = "nw" | "ne" | "sw" | "se";

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

function resolveProjectAssetPath(projectDir: string, relativePath: string): string {
  const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalizedProjectDir}/${normalizedRelativePath}`;
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

export default function ViewportPanel() {
  const {
    activeViewportTab,
    setActiveViewportTab,
    logMessage,
    activeScene,
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
  } = useEditorStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
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

  const [emulatorActive, setEmulatorActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [gridSnap, setGridSnap] = useState(true);
  const [saveStateBusy, setSaveStateBusy] = useState(false);
  const [loadStateBusy, setLoadStateBusy] = useState(false);
  const [rewindBusy, setRewindBusy] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [playReplayBusy, setPlayReplayBusy] = useState(false);
  const [replayRecording, setReplayRecording] = useState(false);
  const [lastReplayPath, setLastReplayPath] = useState<string | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [assetHotReloadNotice, setAssetHotReloadNotice] = useState<string | null>(null);
  const [showPerformanceOverlay, setShowPerformanceOverlay] = useState(true);
  const [assetCacheVersion, setAssetCacheVersion] = useState(0);
  const hotReloadNoticeTimerRef = useRef<number | null>(null);
  const frameTimingRef = useRef<{ lastFrameAt: number; fps: number }>({
    lastFrameAt: 0,
    fps: 0,
  });

  activeTabRef.current = activeViewportTab;
  pausedRef.current = emulPaused;

  useEffect(() => {
    assetCacheRef.current.clear();
    setAssetCacheVersion((current) => current + 1);
  }, [activeProjectDir]);

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

            assetCacheRef.current.set(absolutePath, {
              status: "loaded",
              source: canvas,
              width: canvas.width,
              height: canvas.height,
            });
            setAssetCacheVersion((current) => current + 1);
          })
          .catch(() => {
            assetCacheRef.current.set(absolutePath, { status: "error" });
            setAssetCacheVersion((current) => current + 1);
          });

        return cacheEntry;
      }

      const image = new Image();
      image.onload = () => {
        assetCacheRef.current.set(absolutePath, {
          status: "loaded",
          source: image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        });
        setAssetCacheVersion((current) => current + 1);
      };
      image.onerror = () => {
        assetCacheRef.current.set(absolutePath, { status: "error" });
        setAssetCacheVersion((current) => current + 1);
      };
      image.src = assetUrl;
      return cacheEntry;
    },
    [activeProjectDir]
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

  const shutdownEmulator = useCallback(() => {
    stopFrameLoop();
    disposeAudioPlayback();
    emulatorStop().catch(() => {});
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
    if (!emulatorLoaded || emulPaused) {
      return;
    }

    setEmulPaused(true);
    logMessage("info", "Emulador pausado.");
  }, [emulPaused, logMessage, setEmulPaused]);

  const handleResume = useCallback(() => {
    if (!emulatorLoaded || !emulPaused) {
      return;
    }

    setEmulPaused(false);
    logMessage("info", "Emulador retomado.");
  }, [emulPaused, logMessage, setEmulPaused]);

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
    if (!emulatorLoaded || !emulPaused || stepBusy) {
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
  }, [emulatorLoaded, emulPaused, logMessage, renderFrame, startFrameLoop, stepBusy]);

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
      shutdownEmulator();
    };
  }, [shutdownEmulator]);

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

    context.imageSmoothingEnabled = false;
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

        if (tilemapAsset?.status === "loaded" && tilemapAsset.source) {
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

      const spriteAsset = getViewportAsset(entity.components?.sprite?.asset);
      const sprite = entity.components?.sprite;
      if (spriteAsset?.status === "loaded" && spriteAsset.source && sprite) {
        const sourceWidth = Math.min(sprite.frame_width, spriteAsset.width ?? sprite.frame_width);
        const sourceHeight = Math.min(sprite.frame_height, spriteAsset.height ?? sprite.frame_height);
        context.drawImage(spriteAsset.source, 0, 0, sourceWidth, sourceHeight, x, y, width, height);
      } else {
        context.fillStyle = `${color}33`;
        context.fillRect(x, y, width, height);
      }

      context.strokeStyle = isSelected ? "#ffffff" : color;
      context.lineWidth = isSelected ? 2 : 1;
      context.strokeRect(x, y, width, height);

      context.fillStyle = isSelected ? "#ffffff" : color;
      context.font = "9px monospace";
      context.textAlign = "left";
      context.fillText((entity.prefab ?? entity.entity_id).slice(0, 14), x + 2, y + 10);

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

      context.fillStyle = color;
      context.beginPath();
      context.arc(x + width / 2, y + height / 2, 2, 0, Math.PI * 2);
      context.fill();
    });
  }, [
    activeScene,
    activeTarget,
    activeViewportTab,
    assetCacheVersion,
    getViewportAsset,
    gridSnap,
    selectedEntityId,
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
    if (!activeScene) return;

    const { mx, my } = canvasCoords(event);
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
    const drag = dragRef.current;
    if (!drag || event.buttons !== 1) return;

    const { mx, my } = canvasCoords(event);
    if (drag.mode === "resize") {
      const entity = activeScene?.entities.find((candidate) => candidate.entity_id === drag.entityId);
      const sprite = entity?.components?.sprite;
      if (!entity || !sprite || !drag.handle) {
        return;
      }

      const pointerX = gridSnap ? snapToGrid(mx, GRID_SNAP_SIZE) : Math.round(mx);
      const pointerY = gridSnap ? snapToGrid(my, GRID_SNAP_SIZE) : Math.round(my);
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
        logMessage("error", `[Viewport] Falha ao salvar apos editar gizmo: ${describeError(error)}`);
      }
    }
  }

  const gameStatus = !emulatorLoaded
    ? "Carregue uma ROM para iniciar o emulador"
    : emulPaused
      ? "Emulador pausado"
      : emulatorActive
        ? "Emulador ativo"
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
              title="Clique para selecionar. Arraste para mover ou use os handles para redimensionar sprites."
            />
            {activeScene &&
              activeScene.entities.length === 0 &&
              activeScene.background_layers.length === 0 && (
                <div className="max-w-[320px] rounded border border-[#89b4fa]/30 bg-[#89b4fa]/8 px-3 py-2 text-center text-[10px] leading-relaxed text-[#89b4fa]">
                  Cena vazia. Use <span className="font-semibold">Hierarchy &gt; Sprite Inicial</span> ou{" "}
                  <span className="font-semibold">Tools &gt; Asset Browser &gt; Instanciar</span> para
                  comecar a montar a cena.
                </div>
              )}
            <span className="select-none text-[10px] text-[#6c7086]">
              {activeScene
                ? `${activeScene.entities.length} entidade(s) | ${activeScene.background_layers.length} layer(s) | ${gridSnap ? "snap 8px ativo" : "snap livre"} | arraste para mover${selectedEntityId && !selectedEntityId.startsWith("layer::") ? " / handles para resize" : ""}`
                : "Abra um projeto para visualizar a cena"}
            </span>
          </div>
        )}

        {activeViewportTab === "game" && (
          <div className="flex flex-col items-center gap-2">
            {assetHotReloadNotice && (
              <div
                data-testid="viewport-asset-hot-reload"
                className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-3 py-1 text-[10px] font-semibold text-[#f9e2af]"
              >
                Assets alterados no disco. {assetHotReloadNotice}
              </div>
            )}
            <div className="relative">
              <canvas
                ref={canvasRef}
                width={MD_WIDTH}
                height={MD_HEIGHT}
                data-testid="viewport-game-canvas"
                className="border border-[#45475a] bg-black"
                style={{ imageRendering: "pixelated", width: MD_WIDTH, height: MD_HEIGHT }}
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
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePause()}
                disabled={!emulatorLoaded || emulPaused}
                data-testid="viewport-pause"
                className="rounded border border-[#fab387]/40 bg-[#fab387]/10 px-2 py-1 text-[10px] font-semibold text-[#fab387] transition-colors hover:bg-[#fab387]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Pausar
              </button>
              <button
                type="button"
                onClick={() => handleResume()}
                disabled={!emulatorLoaded || !emulPaused}
                data-testid="viewport-resume"
                className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-1 text-[10px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Retomar
              </button>
              <button
                type="button"
                onClick={() => void handleStepFrame()}
                disabled={!emulatorLoaded || !emulPaused || stepBusy}
                data-testid="viewport-step-frame"
                className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-2 py-1 text-[10px] font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {stepBusy ? "Step..." : "Step 1 frame"}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveState()}
                disabled={!emulatorLoaded || saveStateBusy}
                data-testid="viewport-save-state"
                className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-2 py-1 text-[10px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saveStateBusy ? "Salvando..." : "Salvar state"}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadState()}
                disabled={!emulatorLoaded || loadStateBusy}
                data-testid="viewport-load-state"
                className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loadStateBusy ? "Carregando..." : "Carregar state"}
              </button>
              <button
                type="button"
                onClick={() => void handleRewind()}
                disabled={!emulatorLoaded || !emulPaused || rewindBusy}
                data-testid="viewport-rewind"
                className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-2 py-1 text-[10px] font-semibold text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/20 disabled:cursor-not-allowed disabled:opacity-40"
                title="Recuar snapshots automáticos do emulador (atalho: R)"
              >
                {rewindBusy ? "Rewind..." : "Rewind"}
              </button>
              <button
                type="button"
                onClick={() => void handleStartRecording()}
                disabled={!emulatorLoaded || recordBusy || replayRecording}
                data-testid="viewport-replay-record"
                className="rounded border border-[#94e2d5]/40 bg-[#94e2d5]/10 px-2 py-1 text-[10px] font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {recordBusy && !replayRecording ? "Record..." : "Record"}
              </button>
              <button
                type="button"
                onClick={() => void handleStopRecording()}
                disabled={!emulatorLoaded || recordBusy || !replayRecording || !activeProjectDir}
                data-testid="viewport-replay-stop"
                className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-2 py-1 text-[10px] font-semibold text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {recordBusy && replayRecording ? "Stop..." : "Stop"}
              </button>
              <button
                type="button"
                onClick={() => void handlePlayReplay()}
                disabled={!emulatorLoaded || playReplayBusy || replayRecording || !lastReplayPath || !emulPaused}
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
