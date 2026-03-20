import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../core/store/editorStore";
import { createSpriteEntityFromAsset } from "../../core/editorEntityFactory";
import type { AnimationDef } from "../../core/ipc/sceneService";
import { constrainSpriteFrameSize } from "../../core/sceneConstraints";
import { useSpriteAnimator } from "./useSpriteAnimator";

const ARTSTUDIO_SUPPORTED_FORMATS_LABEL = "PNG, BMP, JPG/JPEG, GIF, WebP e PPM";
const ARTSTUDIO_CANVAS_MIN_ZOOM = 0.2;
const ARTSTUDIO_CANVAS_MAX_ZOOM = 8;

const ARTSTUDIO_FORMAT_LABELS = {
  png: "PNG",
  bmp: "BMP",
  jpg: "JPG",
  jpeg: "JPEG",
  gif: "GIF",
  webp: "WebP",
  ppm: "PPM",
} as const;

type ArtStudioFormatExtension = keyof typeof ARTSTUDIO_FORMAT_LABELS;
type ArtStudioLoadStatus = "idle" | "loading" | "loaded" | "error";
type ArtStudioSourceScope = "none" | "project" | "external";

interface ArtStudioImageMeta {
  sourcePath: string;
  displayName: string;
  format: string | null;
}

interface LoadedArtStudioImage extends ArtStudioImageMeta {
  image: HTMLImageElement;
  url: string;
  revokeUrl: string | null;
  size: { width: number; height: number };
}

interface ArtStudioImageRequest {
  sourcePath?: string;
  file?: File;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createErrorWithCause(message: string, cause: unknown): Error {
  return Object.assign(new Error(message), { cause });
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function basenameWithoutExtension(value: string): string {
  const baseName = normalizeFsPath(value).split("/").pop() ?? "sprite";
  return baseName.replace(/\.[^.]+$/, "") || "sprite";
}

function basenameWithExtension(value: string): string {
  return normalizeFsPath(value).split("/").pop() ?? value;
}

export function getArtStudioImageExtension(value: string): string | null {
  const match = basenameWithExtension(value).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function getArtStudioImageFormatFromMime(mimeType?: string | null): string | null {
  const normalized = mimeType?.toLowerCase().trim() ?? "";
  if (!normalized) {
    return null;
  }

  if (normalized === "image/png") return "PNG";
  if (normalized === "image/bmp" || normalized === "image/x-ms-bmp") return "BMP";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "JPEG";
  if (normalized === "image/gif") return "GIF";
  if (normalized === "image/webp") return "WebP";
  if (normalized === "image/x-portable-pixmap") return "PPM";
  return null;
}

export function getArtStudioImageFormatLabel(
  value: string,
  mimeType?: string | null
): string | null {
  const ext = getArtStudioImageExtension(value);
  if (ext && ext in ARTSTUDIO_FORMAT_LABELS) {
    return ARTSTUDIO_FORMAT_LABELS[ext as ArtStudioFormatExtension];
  }
  return getArtStudioImageFormatFromMime(mimeType);
}

function isArtStudioSupportedImage(value: string, mimeType?: string | null): boolean {
  return getArtStudioImageFormatLabel(value, mimeType) !== null;
}

export function describeArtStudioLoadFailure(sourceLabel: string, error: unknown): string {
  const detail = describeError(error).toLowerCase();

  if (!sourceLabel.trim()) {
    return "Nenhum caminho de imagem valido foi recebido pelo ArtStudio.";
  }

  if (!isArtStudioSupportedImage(sourceLabel)) {
    return `Formato nao suportado. O ArtStudio aceita ${ARTSTUDIO_SUPPORTED_FORMATS_LABEL}.`;
  }

  if (
    detail.includes("not found") ||
    detail.includes("404") ||
    detail.includes("enoent") ||
    detail.includes("nao encontrado")
  ) {
    return `Arquivo nao encontrado: ${sourceLabel}. Verifique o caminho e tente novamente.`;
  }

  if (
    detail.includes("eacces") ||
    detail.includes("eperm") ||
    detail.includes("access is denied") ||
    detail.includes("acesso negado") ||
    detail.includes("permission")
  ) {
    return `Sem permissao para ler '${sourceLabel}'. Verifique acesso ao arquivo e pasta.`;
  }

  if (
    detail.includes("scheme") ||
    detail.includes("protocol") ||
    detail.includes("asset://") ||
    detail.includes("failed to fetch") ||
    detail.includes("blocked")
  ) {
    return "O protocolo de asset bloqueou a leitura da imagem. Tente reimportar, reabrir o projeto ou mover o arquivo para assets/sprites.";
  }

  if (detail.includes("empty")) {
    return `O arquivo '${sourceLabel}' esta vazio e nao pode ser usado como sprite sheet.`;
  }

  if (
    detail.includes("decode") ||
    detail.includes("unsupported image") ||
    detail.includes("naturalwidth") ||
    detail.includes("corrupt")
  ) {
    return `O arquivo '${sourceLabel}' foi encontrado, mas o decode da imagem falhou. Verifique se o arquivo nao esta corrompido.`;
  }

  return `Nao foi possivel carregar '${sourceLabel}'. Verifique formato, caminho e permissao do arquivo.`;
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(ARTSTUDIO_CANVAS_MAX_ZOOM, Math.max(ARTSTUDIO_CANVAS_MIN_ZOOM, value));
}

function getInitialSourceZoom(size: { width: number; height: number }): number {
  const fitZoom = Math.min(1.5, 640 / Math.max(size.width, 1), 420 / Math.max(size.height, 1));
  return clampZoom(fitZoom);
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`decode failed for ${url}`));
    img.src = url;
  });

  if (typeof img.decode === "function") {
    try {
      await img.decode();
    } catch {
      // Some environments resolve onload before decode settles; onload is enough here.
    }
  }

  if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    throw new Error("invalid image dimensions");
  }

  return img;
}

async function loadArtStudioImage(
  request: ArtStudioImageRequest
): Promise<LoadedArtStudioImage> {
  const sourceLabel = request.sourcePath ?? request.file?.name ?? "";
  if (!sourceLabel) {
    throw new Error("invalid path");
  }

  const format = getArtStudioImageFormatLabel(sourceLabel, request.file?.type);
  if (!format) {
    throw new Error("unsupported format");
  }

  if (request.file) {
    if (request.file.size <= 0) {
      throw new Error("empty file");
    }
    const objectUrl = URL.createObjectURL(request.file);
    try {
      const image = await loadImageElement(objectUrl);
      return {
        image,
        url: objectUrl,
        revokeUrl: objectUrl,
        size: { width: image.naturalWidth, height: image.naturalHeight },
        sourcePath: sourceLabel,
        displayName: basenameWithExtension(sourceLabel),
        format,
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  const assetUrl = convertFileSrc(sourceLabel);
  try {
    const image = await loadImageElement(assetUrl);
    return {
      image,
      url: assetUrl,
      revokeUrl: null,
      size: { width: image.naturalWidth, height: image.naturalHeight },
      sourcePath: sourceLabel,
      displayName: basenameWithExtension(sourceLabel),
      format,
    };
  } catch (assetError) {
    try {
      const response = await fetch(assetUrl);
      if (!response.ok) {
        throw createErrorWithCause(`http ${response.status}`, assetError);
      }
      const blob = await response.blob();
      if (blob.size <= 0) {
        throw createErrorWithCause("empty file", assetError);
      }
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = await loadImageElement(objectUrl);
        return {
          image,
          url: objectUrl,
          revokeUrl: objectUrl,
          size: { width: image.naturalWidth, height: image.naturalHeight },
          sourcePath: sourceLabel,
          displayName: basenameWithExtension(sourceLabel),
          format,
        };
      } catch (decodeError) {
        URL.revokeObjectURL(objectUrl);
        throw decodeError;
      }
    } catch (fallbackError) {
      throw createErrorWithCause(
        `asset load: ${describeError(assetError)} | fallback: ${describeError(fallbackError)}`,
        fallbackError
      );
    }
  }
}

export function resolveArtStudioSpriteAssetPath(
  projectDir: string,
  sourcePath: string
): string | null {
  const normalizedProjectDir = normalizeFsPath(projectDir).replace(/\/+$/, "");
  const normalizedSourcePath = normalizeFsPath(sourcePath);
  if (!normalizedProjectDir) {
    return null;
  }

  const projectPrefix = `${normalizedProjectDir}/`;
  if (!normalizedSourcePath.toLowerCase().startsWith(projectPrefix.toLowerCase())) {
    return null;
  }

  const relativePath = normalizedSourcePath.slice(projectPrefix.length).replace(/^\/+/, "");
  if (!relativePath.toLowerCase().startsWith("assets/sprites/")) {
    return null;
  }

  return relativePath;
}

function sanitizeAnimationKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildArtStudioAnimations(
  sequences: SpriteSequence[]
): { animations: Record<string, AnimationDef>; error: string | null } {
  const animations: Record<string, AnimationDef> = {};
  const usedKeys = new Set<string>();

  for (const sequence of sequences) {
    const normalizedFrames = Array.from(
      new Set(sequence.frames.filter((frame) => Number.isInteger(frame) && frame >= 0))
    ).sort((left, right) => left - right);

    if (normalizedFrames.length === 0) {
      continue;
    }

    const key = sanitizeAnimationKey(sequence.name);
    if (!key) {
      return {
        animations: {},
        error: "Sequencias com frames precisam ter um nome valido.",
      };
    }
    if (usedKeys.has(key)) {
      return {
        animations: {},
        error: `As sequencias '${sequence.name}' geram a mesma chave '${key}'.`,
      };
    }

    usedKeys.add(key);
    animations[key] = {
      frames: normalizedFrames,
      fps: Math.max(1, Math.min(60, Math.trunc(sequence.fps || 12))),
      loop: sequence.loop,
    };
  }

  if (Object.keys(animations).length === 0) {
    return {
      animations: {},
      error: "Adicione ao menos uma sequencia com frames validos.",
    };
  }

  return { animations, error: null };
}

export interface SpriteSequence {
  id: string;
  name: string;
  frames: number[];
  fps: number;
  loop: boolean;
}

interface ArtStudioState {
  spriteSheetUrl: string | null;
  spriteSheetSize: { width: number; height: number } | null;
  spriteSheetSourcePath: string;
  spriteSheetDisplayName: string;
  spriteSheetFormat: string | null;
  spriteSheetLoadStatus: ArtStudioLoadStatus;
  spriteSheetLoadMessage: string | null;
  spriteSheetScope: ArtStudioSourceScope;
  sourceZoom: number;
  frameWidth: number;
  frameHeight: number;
  sequences: SpriteSequence[];
  activeSequenceId: string | null;
  playing: boolean;
  compression: string;
  spriteName: string;
  spritePath: string;
  saveFeedback: boolean;
  validationError: string | null;
}

type ArtStudioAction =
  | { type: "START_SPRITE_LOAD"; sourceLabel: string }
  | {
      type: "LOAD_SPRITE";
      url: string;
      size: { width: number; height: number };
      path: string;
      name: string;
      sourcePath: string;
      displayName: string;
      format: string | null;
      scope: ArtStudioSourceScope;
      zoom: number;
      message: string | null;
    }
  | { type: "LOAD_SPRITE_ERROR"; message: string }
  | { type: "SET_SOURCE_ZOOM"; value: number }
  | { type: "SET_FRAME_SIZE"; width?: number; height?: number }
  | { type: "ADD_SEQUENCE"; id: string; name: string }
  | { type: "DELETE_SEQUENCE"; id: string }
  | { type: "RENAME_SEQUENCE"; id: string; name: string }
  | { type: "SELECT_SEQUENCE"; id: string | null }
  | { type: "TOGGLE_FRAME"; cellIndex: number }
  | { type: "SET_SEQUENCE_FPS"; id: string; fps: number }
  | { type: "SET_SEQUENCE_LOOP"; id: string; loop: boolean }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "SET_COMPRESSION"; value: string }
  | { type: "SHOW_SAVE_FEEDBACK" }
  | { type: "HIDE_SAVE_FEEDBACK" }
  | { type: "SET_VALIDATION_ERROR"; message: string | null };

function artStudioReducer(state: ArtStudioState, action: ArtStudioAction): ArtStudioState {
  switch (action.type) {
    case "START_SPRITE_LOAD":
      return {
        ...state,
        spriteSheetLoadStatus: "loading",
        spriteSheetLoadMessage: `Carregando ${action.sourceLabel}...`,
        saveFeedback: false,
        validationError: null,
      };
    case "LOAD_SPRITE":
      return {
        ...state,
        spriteSheetUrl: action.url,
        spriteSheetSize: action.size,
        spriteSheetSourcePath: action.sourcePath,
        spriteSheetDisplayName: action.displayName,
        spriteSheetFormat: action.format,
        spriteSheetLoadStatus: "loaded",
        spriteSheetLoadMessage: action.message,
        spriteSheetScope: action.scope,
        sourceZoom: action.zoom,
        spritePath: action.path,
        spriteName: action.name,
        saveFeedback: false,
        validationError: null,
      };
    case "LOAD_SPRITE_ERROR":
      return {
        ...state,
        spriteSheetLoadStatus: "error",
        spriteSheetLoadMessage: action.message,
        saveFeedback: false,
      };
    case "SET_SOURCE_ZOOM":
      return {
        ...state,
        sourceZoom: clampZoom(action.value),
      };
    case "SET_FRAME_SIZE":
      return {
        ...state,
        frameWidth: action.width ?? state.frameWidth,
        frameHeight: action.height ?? state.frameHeight,
      };
    case "ADD_SEQUENCE": {
      const seq: SpriteSequence = {
        id: action.id,
        name: action.name,
        frames: [],
        fps: 12,
        loop: true,
      };
      return {
        ...state,
        sequences: [...state.sequences, seq],
        activeSequenceId: action.id,
      };
    }
    case "DELETE_SEQUENCE": {
      const next = state.sequences.filter((sequence) => sequence.id !== action.id);
      return {
        ...state,
        sequences: next,
        activeSequenceId:
          state.activeSequenceId === action.id ? next[0]?.id ?? null : state.activeSequenceId,
      };
    }
    case "RENAME_SEQUENCE":
      return {
        ...state,
        sequences: state.sequences.map((sequence) =>
          sequence.id === action.id ? { ...sequence, name: action.name } : sequence
        ),
      };
    case "SELECT_SEQUENCE":
      return { ...state, activeSequenceId: action.id };
    case "TOGGLE_FRAME": {
      const active = state.sequences.find((sequence) => sequence.id === state.activeSequenceId);
      if (!active) {
        return state;
      }
      const frameIndex = active.frames.indexOf(action.cellIndex);
      const frames =
        frameIndex >= 0
          ? active.frames.filter((_, index) => index !== frameIndex)
          : [...active.frames, action.cellIndex].sort((left, right) => left - right);
      return {
        ...state,
        sequences: state.sequences.map((sequence) =>
          sequence.id === state.activeSequenceId ? { ...sequence, frames } : sequence
        ),
      };
    }
    case "SET_SEQUENCE_FPS":
      return {
        ...state,
        sequences: state.sequences.map((sequence) =>
          sequence.id === action.id ? { ...sequence, fps: action.fps } : sequence
        ),
      };
    case "SET_SEQUENCE_LOOP":
      return {
        ...state,
        sequences: state.sequences.map((sequence) =>
          sequence.id === action.id ? { ...sequence, loop: action.loop } : sequence
        ),
      };
    case "SET_PLAYING":
      return { ...state, playing: action.playing };
    case "SET_COMPRESSION":
      return { ...state, compression: action.value };
    case "SHOW_SAVE_FEEDBACK":
      return { ...state, saveFeedback: true, validationError: null };
    case "HIDE_SAVE_FEEDBACK":
      return { ...state, saveFeedback: false };
    case "SET_VALIDATION_ERROR":
      return { ...state, validationError: action.message };
    default:
      return state;
  }
}

const INITIAL_STATE: ArtStudioState = {
  spriteSheetUrl: null,
  spriteSheetSize: null,
  spriteSheetSourcePath: "",
  spriteSheetDisplayName: "",
  spriteSheetFormat: null,
  spriteSheetLoadStatus: "idle",
  spriteSheetLoadMessage: null,
  spriteSheetScope: "none",
  sourceZoom: 1,
  frameWidth: 32,
  frameHeight: 32,
  sequences: [
    { id: "seq_idle", name: "IDLE", frames: [0], fps: 1, loop: true },
    { id: "seq_run", name: "RUN", frames: [], fps: 12, loop: true },
    { id: "seq_jump", name: "JUMP", frames: [], fps: 8, loop: false },
  ],
  activeSequenceId: "seq_idle",
  playing: false,
  compression: "NONE",
  spriteName: "sprite",
  spritePath: "",
  saveFeedback: false,
  validationError: null,
};

const MEGA_DRIVE_PALETTE: string[] = [
  "transparent",
  "#000000",
  "#242424",
  "#494949",
  "#6d6d6d",
  "#929292",
  "#b6b6b6",
  "#dbdbdb",
  "#ffffff",
  "#240000",
  "#490000",
  "#6d0000",
  "#920000",
  "#b60000",
  "#db0000",
  "#ff0000",
];

const COMPRESSION_OPTIONS = [
  { value: "NONE", label: "NONE" },
  { value: "APLIB", label: "APLIB" },
  { value: "FAST", label: "FAST" },
  { value: "BEST", label: "BEST" },
] as const;

function getGridCellIndex(
  canvasRect: DOMRect,
  canvasWidth: number,
  canvasHeight: number,
  imgWidth: number,
  imgHeight: number,
  frameWidth: number,
  frameHeight: number,
  clientX: number,
  clientY: number
): number | null {
  const scaleX = canvasWidth / imgWidth;
  const scaleY = canvasHeight / imgHeight;
  const imgX = (clientX - canvasRect.left) / scaleX;
  const imgY = (clientY - canvasRect.top) / scaleY;
  if (imgX < 0 || imgY < 0 || imgX >= imgWidth || imgY >= imgHeight) {
    return null;
  }
  const cellX = Math.floor(imgX / frameWidth);
  const cellY = Math.floor(imgY / frameHeight);
  const cols = Math.max(1, Math.floor(imgWidth / frameWidth));
  return cellY * cols + cellX;
}

export default function ArtStudioPanel() {
  const {
    logMessage,
    activeScene,
    activeProjectDir,
    activeTarget,
    selectedEntityId,
    addEntity,
    updateEntity,
  } = useEditorStore();

  const [state, dispatch] = useReducer(artStudioReducer, INITIAL_STATE);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const transientObjectUrlRef = useRef<string | null>(null);
  const saveFeedbackTimeoutRef = useRef<number | null>(null);
  const [currentPreviewCell, setCurrentPreviewCell] = useState<number>(-1);
  const [dragActive, setDragActive] = useState(false);

  const activeSequence = state.sequences.find((sequence) => sequence.id === state.activeSequenceId);
  const selectedEntity = activeScene?.entities.find((entity) => entity.entity_id === selectedEntityId);
  const selectedEntitySprite = selectedEntity?.components?.sprite;
  const canUpdateEntity = Boolean(selectedEntitySprite);

  const totalGridColumns =
    state.spriteSheetSize && state.frameWidth > 0
      ? Math.max(1, Math.floor(state.spriteSheetSize.width / state.frameWidth))
      : 0;
  const totalGridRows =
    state.spriteSheetSize && state.frameHeight > 0
      ? Math.max(1, Math.floor(state.spriteSheetSize.height / state.frameHeight))
      : 0;
  const totalFrameSlots = totalGridColumns * totalGridRows;
  const usedFrameCount = new Set(state.sequences.flatMap((sequence) => sequence.frames)).size;
  const externalSourceLoaded =
    state.spriteSheetLoadStatus === "loaded" && state.spriteSheetScope === "external";
  const canApplyToScene =
    Boolean(activeProjectDir) &&
    Boolean(activeScene) &&
    Boolean(state.spriteSheetUrl) &&
    Boolean(state.spritePath) &&
    state.spriteSheetLoadStatus === "loaded";

  useEffect(() => {
    return () => {
      if (transientObjectUrlRef.current) {
        URL.revokeObjectURL(transientObjectUrlRef.current);
      }
      if (saveFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(saveFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useSpriteAnimator(
    state.playing,
    activeSequence?.fps ?? 12,
    activeSequence?.frames ?? [],
    activeSequence?.loop ?? true,
    useCallback((cellIndex) => {
      setCurrentPreviewCell(cellIndex);
    }, [])
  );

  const releaseTransientUrl = useCallback(() => {
    if (transientObjectUrlRef.current) {
      URL.revokeObjectURL(transientObjectUrlRef.current);
      transientObjectUrlRef.current = null;
    }
  }, []);

  const ingestSpriteSheet = useCallback(
    async (request: ArtStudioImageRequest) => {
      const sourceLabel = request.sourcePath ?? request.file?.name ?? "imagem";
      dispatch({ type: "START_SPRITE_LOAD", sourceLabel: basenameWithExtension(sourceLabel) });

      try {
        const loaded = await loadArtStudioImage(request);
        releaseTransientUrl();
        if (loaded.revokeUrl) {
          transientObjectUrlRef.current = loaded.revokeUrl;
        }

        const relativeAssetPath =
          activeProjectDir && request.sourcePath
            ? resolveArtStudioSpriteAssetPath(activeProjectDir, request.sourcePath)
            : null;
        const spriteName = basenameWithoutExtension(relativeAssetPath ?? loaded.sourcePath);
        const scope: ArtStudioSourceScope = relativeAssetPath ? "project" : "external";
        const message = relativeAssetPath
          ? "Imagem pronta para slicing e aplicacao na cena."
          : "Imagem carregada para preparo. Para aplicar na cena, mova ou copie o arquivo para assets/sprites.";

        dispatch({
          type: "LOAD_SPRITE",
          url: loaded.url,
          size: loaded.size,
          path: relativeAssetPath ?? "",
          name: spriteName,
          sourcePath: loaded.sourcePath,
          displayName: loaded.displayName,
          format: loaded.format,
          scope,
          zoom: getInitialSourceZoom(loaded.size),
          message,
        });

        imageRef.current = loaded.image;
        logMessage(
          relativeAssetPath ? "success" : "info",
          `[ArtStudio] Imagem carregada: ${loaded.displayName} (${loaded.format ?? "imagem"} ${loaded.size.width}x${loaded.size.height}).`
        );
      } catch (error) {
        const friendlyMessage = describeArtStudioLoadFailure(sourceLabel, error);
        dispatch({ type: "LOAD_SPRITE_ERROR", message: friendlyMessage });
        logMessage(
          "error",
          `[ArtStudio] ${friendlyMessage} Detalhe tecnico: ${describeError(error)}`
        );
      }
    },
    [activeProjectDir, logMessage, releaseTransientUrl]
  );

  const handleLoadSpriteSheet = useCallback(async () => {
    try {
      const selected = await open({
        title: "Importar sprite sheet",
        filters: [
          {
            name: "Imagem",
            extensions: ["png", "bmp", "jpg", "jpeg", "gif", "webp", "ppm"],
          },
        ],
      });
      if (!selected) {
        return;
      }

      const imagePath = typeof selected === "string" ? selected : selected[0];
      if (!imagePath) {
        return;
      }

      await ingestSpriteSheet({ sourcePath: imagePath });
    } catch (error) {
      const message = describeArtStudioLoadFailure("imagem selecionada", error);
      dispatch({ type: "LOAD_SPRITE_ERROR", message });
      logMessage("error", `[ArtStudio] ${message}`);
    }
  }, [ingestSpriteSheet, logMessage]);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);

      const file = event.dataTransfer.files?.[0];
      if (!file) {
        return;
      }

      await ingestSpriteSheet({ file });
    },
    [ingestSpriteSheet]
  );

  const handleAddSequence = useCallback(() => {
    const id = `seq_${Date.now()}`;
    const count = state.sequences.length;
    dispatch({ type: "ADD_SEQUENCE", id, name: `ANIM_${count}` });
  }, [state.sequences.length]);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!state.activeSequenceId || !state.spriteSheetSize || !canvasRef.current) {
        return;
      }

      const rect = canvasRef.current.getBoundingClientRect();
      const cell = getGridCellIndex(
        rect,
        rect.width,
        rect.height,
        state.spriteSheetSize.width,
        state.spriteSheetSize.height,
        state.frameWidth,
        state.frameHeight,
        event.clientX,
        event.clientY
      );
      if (cell !== null) {
        dispatch({ type: "TOGGLE_FRAME", cellIndex: cell });
      }
    },
    [state.activeSequenceId, state.spriteSheetSize, state.frameWidth, state.frameHeight]
  );

  const setSourceZoom = useCallback((value: number) => {
    dispatch({ type: "SET_SOURCE_ZOOM", value });
  }, []);

  const fitSourceZoom = useCallback(() => {
    if (!state.spriteSheetSize) {
      return;
    }
    dispatch({
      type: "SET_SOURCE_ZOOM",
      value: getInitialSourceZoom(state.spriteSheetSize),
    });
  }, [state.spriteSheetSize]);

  const applyConstrainedFrameSize = useCallback(
    (nextWidth: number, nextHeight: number) => {
      const constrained = constrainSpriteFrameSize(
        activeTarget,
        state.spritePath || undefined,
        nextWidth,
        nextHeight
      );
      dispatch({
        type: "SET_FRAME_SIZE",
        width: constrained.frameWidth,
        height: constrained.frameHeight,
      });
    },
    [activeTarget, state.spritePath]
  );

  const handleApplyToScene = useCallback(() => {
    if (!activeProjectDir || !activeScene) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Abra um projeto e uma cena antes de aplicar dados do ArtStudio.",
      });
      return;
    }
    if (!state.spriteSheetUrl) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Carregue uma imagem antes de criar ou atualizar uma entidade.",
      });
      return;
    }
    if (!state.spritePath) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message:
          "A imagem foi carregada apenas para preparo. Mova ou copie o arquivo para assets/sprites do projeto antes de aplicar na cena.",
      });
      return;
    }
    if (state.sequences.length === 0) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Adicione pelo menos uma sequencia antes de aplicar na cena.",
      });
      return;
    }
    const hasValidFrames = state.sequences.some((sequence) => sequence.frames.length > 0);
    if (!hasValidFrames) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Cada sequencia precisa ter pelo menos um frame selecionado.",
      });
      return;
    }

    const constrainedFrame = constrainSpriteFrameSize(
      activeTarget,
      state.spritePath,
      state.frameWidth,
      state.frameHeight
    );
    if (
      constrainedFrame.frameWidth > (state.spriteSheetSize?.width ?? 0) ||
      constrainedFrame.frameHeight > (state.spriteSheetSize?.height ?? 0)
    ) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "O frame precisa caber dentro do sprite sheet selecionado.",
      });
      return;
    }

    const { animations, error } = buildArtStudioAnimations(state.sequences);
    if (error) {
      dispatch({ type: "SET_VALIDATION_ERROR", message: error });
      return;
    }

    dispatch({ type: "SET_VALIDATION_ERROR", message: null });
    if (
      constrainedFrame.frameWidth !== state.frameWidth ||
      constrainedFrame.frameHeight !== state.frameHeight
    ) {
      dispatch({
        type: "SET_FRAME_SIZE",
        width: constrainedFrame.frameWidth,
        height: constrainedFrame.frameHeight,
      });
      logMessage(
        "info",
        `[ArtStudio] Frame ajustado para ${constrainedFrame.frameWidth}x${constrainedFrame.frameHeight} conforme o target ativo.`
      );
    }

    if (canUpdateEntity && selectedEntityId) {
      updateEntity(selectedEntityId, {
        components: {
          ...selectedEntity!.components,
          sprite: {
            ...selectedEntitySprite!,
            asset: state.spritePath,
            frame_width: constrainedFrame.frameWidth,
            frame_height: constrainedFrame.frameHeight,
            animations,
          },
        },
      });
      logMessage("success", "[ArtStudio] Entidade atualizada com animacoes.");
    } else {
      const entity = createSpriteEntityFromAsset({
        assetPath: state.spritePath,
        target: activeTarget,
        existingEntityIds: activeScene.entities.map((entity) => entity.entity_id),
        suggestedName: state.spriteName,
        frameWidth: constrainedFrame.frameWidth,
        frameHeight: constrainedFrame.frameHeight,
        animations,
      });
      addEntity(entity);
      logMessage("success", `[ArtStudio] Entidade '${entity.entity_id}' criada na cena.`);
    }

    dispatch({ type: "SHOW_SAVE_FEEDBACK" });
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current);
    }
    saveFeedbackTimeoutRef.current = window.setTimeout(() => {
      dispatch({ type: "HIDE_SAVE_FEEDBACK" });
    }, 2000);
  }, [
    state.sequences,
    state.spritePath,
    state.spriteSheetUrl,
    state.frameWidth,
    state.frameHeight,
    state.spriteName,
    state.spriteSheetSize,
    canUpdateEntity,
    selectedEntityId,
    selectedEntity,
    selectedEntitySprite,
    activeScene,
    activeProjectDir,
    activeTarget,
    addEntity,
    updateEntity,
    logMessage,
  ]);

  useEffect(() => {
    const constrained = constrainSpriteFrameSize(
      activeTarget,
      state.spritePath || undefined,
      state.frameWidth,
      state.frameHeight
    );
    if (
      constrained.frameWidth !== state.frameWidth ||
      constrained.frameHeight !== state.frameHeight
    ) {
      dispatch({
        type: "SET_FRAME_SIZE",
        width: constrained.frameWidth,
        height: constrained.frameHeight,
      });
    }
  }, [activeTarget, state.spritePath, state.frameWidth, state.frameHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current || !state.spriteSheetSize) {
      return;
    }

    const image = imageRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const cols = Math.max(1, Math.floor(image.naturalWidth / state.frameWidth));
    const fontSize = Math.max(
      10,
      Math.min(18, Math.floor(Math.min(state.frameWidth, state.frameHeight) / 2))
    );

    if (activeSequence) {
      for (let order = 0; order < activeSequence.frames.length; order += 1) {
        const cell = activeSequence.frames[order];
        const cellX = (cell % cols) * state.frameWidth;
        const cellY = Math.floor(cell / cols) * state.frameHeight;
        ctx.fillStyle = "rgba(96, 165, 250, 0.28)";
        ctx.fillRect(cellX, cellY, state.frameWidth, state.frameHeight);
        ctx.strokeStyle = "rgba(191, 219, 254, 0.9)";
        ctx.lineWidth = 1;
        ctx.strokeRect(cellX + 0.5, cellY + 0.5, state.frameWidth - 1, state.frameHeight - 1);
        ctx.fillStyle = "#f9e2af";
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          String(order + 1),
          cellX + state.frameWidth / 2,
          cellY + state.frameHeight / 2
        );
      }
    }

    ctx.strokeStyle = "rgba(249, 226, 175, 0.58)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= image.naturalWidth; x += state.frameWidth) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, image.naturalHeight);
      ctx.stroke();
    }
    for (let y = 0; y <= image.naturalHeight; y += state.frameHeight) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(image.naturalWidth, y + 0.5);
      ctx.stroke();
    }
  }, [state.spriteSheetSize, state.frameWidth, state.frameHeight, activeSequence]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    if (!imageRef.current || !state.spriteSheetSize) {
      return;
    }

    const image = imageRef.current;
    const cols = Math.max(1, Math.floor(state.spriteSheetSize.width / state.frameWidth));
    const cellIndex = state.playing ? currentPreviewCell : activeSequence?.frames[0] ?? -1;

    if (cellIndex < 0) {
      return;
    }

    const sourceX = (cellIndex % cols) * state.frameWidth;
    const sourceY = Math.floor(cellIndex / cols) * state.frameHeight;
    const scale = Math.min(canvas.width / state.frameWidth, canvas.height / state.frameHeight, 5);
    const drawWidth = state.frameWidth * scale;
    const drawHeight = state.frameHeight * scale;
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;

    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      state.frameWidth,
      state.frameHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight
    );
  }, [
    state.spriteSheetSize,
    state.frameWidth,
    state.frameHeight,
    currentPreviewCell,
    state.playing,
    activeSequence,
  ]);

  const loadToneClass =
    state.spriteSheetLoadStatus === "loaded"
      ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/10 text-[#a6e3a1]"
      : state.spriteSheetLoadStatus === "error"
        ? "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f38ba8]"
        : state.spriteSheetLoadStatus === "loading"
          ? "border-[#89b4fa]/40 bg-[#89b4fa]/10 text-[#89b4fa]"
          : "border-[#313244] bg-[#11111b] text-[#7f849c]";

  const loadStatusText =
    state.spriteSheetLoadMessage ??
    `Suporta ${ARTSTUDIO_SUPPORTED_FORMATS_LABEL}. Importe qualquer imagem para preparar o sprite sheet.`;

  const sourceOriginLabel =
    state.spriteSheetScope === "project"
      ? "Projeto"
      : state.spriteSheetScope === "external"
        ? "Externa"
        : "Nao carregada";

  const resOutput = `SPRITE ${state.spriteName || "sprite"} "${state.spritePath || "PENDENTE_IMPORTACAO"}" [${state.frameWidth}] [${state.frameHeight}] [${state.compression}]`;

  return (
    <div className="flex h-full flex-col gap-3 bg-[#0b0f19]">
      <div className="mx-3 mt-3 rounded-xl border border-[#fab387]/35 bg-[linear-gradient(135deg,rgba(250,179,135,0.14),rgba(137,180,250,0.08))] px-4 py-3 text-[11px] text-[#f9e2af]">
        <div className="font-semibold uppercase tracking-[0.24em] text-[#fab387]">
          ArtStudio Experimental
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[#f5e0dc]">
          Ferramenta de ingestao e preparo de sprites. Importa imagens cruas, permite slicing e preview, mas a integracao total com o pipeline ainda nao esta fechada.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,340px)_minmax(320px,0.95fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
          <div className="border-b border-[#1f2937] px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                  1. Source / Sprite Sheet
                </p>
                <h3 className="mt-1 text-sm font-semibold text-[#e2e8f0]">
                  Importe uma imagem bruta e prepare o slicing
                </h3>
                <p className="mt-1 text-[11px] text-[#94a3b8]">
                  Aceita {ARTSTUDIO_SUPPORTED_FORMATS_LABEL}. Use arquivos do projeto ou imagens externas para preparar a animacao.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLoadSpriteSheet}
                className="rounded-xl border border-[#f9e2af]/50 bg-[#f9e2af]/14 px-4 py-2 text-xs font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/22"
              >
                Importar imagem
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${loadToneClass}`}>
                {state.spriteSheetLoadStatus === "loaded"
                  ? "Imagem pronta"
                  : state.spriteSheetLoadStatus === "error"
                    ? "Falha ao carregar"
                    : state.spriteSheetLoadStatus === "loading"
                      ? "Carregando"
                      : "Aguardando importacao"}
              </span>
              <span className="rounded-full border border-[#313244] bg-[#111827] px-2.5 py-1 text-[10px] font-semibold text-[#94a3b8]">
                Zoom {Math.round(state.sourceZoom * 100)}%
              </span>
              <span className="rounded-full border border-[#313244] bg-[#111827] px-2.5 py-1 text-[10px] font-semibold text-[#94a3b8]">
                Frames {state.frameWidth}x{state.frameHeight}
              </span>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div
                className={`flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-dashed ${
                  dragActive
                    ? "border-[#89b4fa] bg-[#89b4fa]/10"
                    : "border-[#334155] bg-[radial-gradient(circle_at_top,#162032,#0b1120_68%)]"
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragActive(false);
                }}
                onDrop={handleDrop}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f2937] px-4 py-3">
                  <div className="text-[11px] text-[#94a3b8]">
                    <div className="font-semibold uppercase tracking-[0.18em] text-[#cbd5e1]">
                      Canvas de origem
                    </div>
                    <div className="mt-1">
                      Clique nos quadros para montar a sequencia ativa. Arraste uma imagem para esta area se preferir.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSourceZoom(state.sourceZoom / 1.15)}
                      disabled={!state.spriteSheetSize}
                      className="rounded-lg border border-[#313244] bg-[#111827] px-2 py-1 text-[11px] font-semibold text-[#cbd5e1] transition-colors hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={fitSourceZoom}
                      disabled={!state.spriteSheetSize}
                      className="rounded-lg border border-[#313244] bg-[#111827] px-2 py-1 text-[11px] font-semibold text-[#cbd5e1] transition-colors hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Ajustar
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceZoom(state.sourceZoom * 1.15)}
                      disabled={!state.spriteSheetSize}
                      className="rounded-lg border border-[#313244] bg-[#111827] px-2 py-1 text-[11px] font-semibold text-[#cbd5e1] transition-colors hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
                  {state.spriteSheetUrl && state.spriteSheetSize ? (
                    <div className="inline-flex min-h-full min-w-full items-center justify-center">
                      <canvas
                        ref={canvasRef}
                        className="cursor-crosshair rounded-lg shadow-[0_14px_40px_rgba(0,0,0,0.35)]"
                        style={{
                          imageRendering: "pixelated",
                          width: `${Math.max(1, state.spriteSheetSize.width * state.sourceZoom)}px`,
                          height: `${Math.max(1, state.spriteSheetSize.height * state.sourceZoom)}px`,
                        }}
                        onClick={handleCanvasClick}
                        title="Clique para adicionar ou remover frames da sequencia ativa"
                      />
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 px-6 text-center">
                      <div className="rounded-2xl border border-[#7dd3fc]/25 bg-[#0f172a]/80 p-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                          Fluxo recomendado
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-[#e2e8f0]">
                          <p>1. Importe uma imagem crua ou arraste o arquivo para esta area.</p>
                          <p>2. Ajuste o grid de slicing.</p>
                          <p>3. Monte sequencias, valide no preview e aplique na entidade.</p>
                        </div>
                      </div>
                      <p className="max-w-xl text-[12px] leading-6 text-[#94a3b8]">
                        O ArtStudio nao presume um sprite sheet pronto para a plataforma. Ele pode receber imagens grandes, recortes soltos, fundos solidos e arquivos em formatos comuns para preparar a conversao futura.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-[#1f2937] bg-[#0f172a] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                    Diagnostico
                  </div>
                  <p className="mt-3 text-[12px] leading-5 text-[#cbd5e1]">{loadStatusText}</p>
                </div>

                <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                    Metadados
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
                    <dt className="text-[#64748b]">Arquivo</dt>
                    <dd className="truncate font-medium text-[#e2e8f0]">
                      {state.spriteSheetDisplayName || "Nenhum"}
                    </dd>
                    <dt className="text-[#64748b]">Formato</dt>
                    <dd className="font-medium text-[#e2e8f0]">
                      {state.spriteSheetFormat ?? "-"}
                    </dd>
                    <dt className="text-[#64748b]">Resolucao</dt>
                    <dd className="font-medium text-[#e2e8f0]">
                      {state.spriteSheetSize
                        ? `${state.spriteSheetSize.width} x ${state.spriteSheetSize.height}`
                        : "-"}
                    </dd>
                    <dt className="text-[#64748b]">Origem</dt>
                    <dd className="font-medium text-[#e2e8f0]">{sourceOriginLabel}</dd>
                    <dt className="text-[#64748b]">Asset</dt>
                    <dd className="truncate font-medium text-[#e2e8f0]">
                      {state.spritePath || "Pendente de mover para assets/sprites"}
                    </dd>
                  </dl>
                </div>

                <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                    Slicing
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-[11px] text-[#94a3b8]">
                      <span>Frame W</span>
                      <input
                        type="number"
                        min={8}
                        max={64}
                        value={state.frameWidth}
                        onChange={(event) =>
                          applyConstrainedFrameSize(
                            Math.max(8, Math.min(64, Number(event.target.value) || 32)),
                            state.frameHeight
                          )
                        }
                        className="w-full rounded-xl border border-[#334155] bg-[#111827] px-3 py-2 text-sm font-mono text-[#e2e8f0] focus:border-[#7dd3fc] focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1 text-[11px] text-[#94a3b8]">
                      <span>Frame H</span>
                      <input
                        type="number"
                        min={8}
                        max={64}
                        value={state.frameHeight}
                        onChange={(event) =>
                          applyConstrainedFrameSize(
                            state.frameWidth,
                            Math.max(8, Math.min(64, Number(event.target.value) || 32))
                          )
                        }
                        className="w-full rounded-xl border border-[#334155] bg-[#111827] px-3 py-2 text-sm font-mono text-[#e2e8f0] focus:border-[#7dd3fc] focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="mt-3 rounded-xl border border-[#1f2937] bg-[#111827] px-3 py-2 text-[11px] text-[#94a3b8]">
                    {state.spriteSheetSize
                      ? `${totalFrameSlots} quadros disponiveis em ${totalGridColumns} colunas x ${totalGridRows} linhas.`
                      : "Carregue uma imagem para destravar o slicing."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
          <div className="border-b border-[#1f2937] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#cba6f7]">
              2. Sequences / Configuracao
            </p>
            <h3 className="mt-1 text-sm font-semibold text-[#e2e8f0]">
              Organize quadros em animacoes reutilizaveis
            </h3>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-[#1f2937] bg-[#0b1220] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748b]">Sequencias</div>
                <div className="mt-1 text-lg font-semibold text-[#e2e8f0]">
                  {state.sequences.length}
                </div>
              </div>
              <div className="rounded-xl border border-[#1f2937] bg-[#0b1220] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748b]">
                  Frames usados
                </div>
                <div className="mt-1 text-lg font-semibold text-[#e2e8f0]">
                  {usedFrameCount}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#cba6f7]">
                  Lista de sequencias
                </div>
                <div className="mt-1 text-[12px] text-[#94a3b8]">
                  Clique nos quadros do canvas para preencher a sequencia ativa.
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddSequence}
                className="rounded-xl border border-[#cba6f7]/40 bg-[#cba6f7]/12 px-3 py-1.5 text-[11px] font-semibold text-[#e9d5ff] transition-colors hover:bg-[#cba6f7]/18"
              >
                + Nova sequencia
              </button>
            </div>

            <ul className="space-y-2">
              {state.sequences.map((sequence) => {
                const isActive = state.activeSequenceId === sequence.id;
                return (
                  <li
                    key={sequence.id}
                    role="button"
                    tabIndex={0}
                    className={`rounded-2xl border px-3 py-3 transition-colors ${
                      isActive
                        ? "border-[#cba6f7]/45 bg-[#cba6f7]/10"
                        : "border-[#1f2937] bg-[#0b1220] hover:border-[#334155]"
                    }`}
                    onClick={() => dispatch({ type: "SELECT_SEQUENCE", id: sequence.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        dispatch({ type: "SELECT_SEQUENCE", id: sequence.id });
                      }
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="text"
                        value={sequence.name}
                        onChange={(event) =>
                          dispatch({
                            type: "RENAME_SEQUENCE",
                            id: sequence.id,
                            name: event.target.value,
                          })
                        }
                        onClick={(event) => event.stopPropagation()}
                        className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-0 py-0 text-sm font-semibold text-[#e2e8f0] focus:border-transparent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatch({ type: "DELETE_SEQUENCE", id: sequence.id });
                        }}
                        className="rounded-lg border border-[#f38ba8]/35 bg-[#f38ba8]/10 px-2 py-1 text-[11px] font-semibold text-[#fda4af] transition-colors hover:bg-[#f38ba8]/16"
                        title="Remover sequencia"
                      >
                        Remover
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-[#94a3b8]">
                      <span>{sequence.frames.length} frame(s)</span>
                      <span>{sequence.loop ? "Loop" : "One shot"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {activeSequence ? (
              <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#cba6f7]">
                  Sequencia ativa
                </div>
                <div className="mt-3 space-y-3">
                  <label className="space-y-1 text-[11px] text-[#94a3b8]">
                    <span>FPS</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={activeSequence.fps}
                      onChange={(event) =>
                        dispatch({
                          type: "SET_SEQUENCE_FPS",
                          id: activeSequence.id,
                          fps: Math.max(1, Math.min(60, Number(event.target.value) || 12)),
                        })
                      }
                      className="w-full rounded-xl border border-[#334155] bg-[#111827] px-3 py-2 text-sm font-mono text-[#e2e8f0] focus:border-[#cba6f7] focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-[#e2e8f0]">
                    <input
                      type="checkbox"
                      checked={activeSequence.loop}
                      onChange={(event) =>
                        dispatch({
                          type: "SET_SEQUENCE_LOOP",
                          id: activeSequence.id,
                          loop: event.target.checked,
                        })
                      }
                    />
                    Loop automatico
                  </label>
                  <div className="rounded-xl border border-[#1f2937] bg-[#111827] px-3 py-2 text-[11px] text-[#94a3b8]">
                    {activeSequence.frames.length > 0
                      ? `Frames selecionados: ${activeSequence.frames.join(", ")}`
                      : "Selecione quadros no canvas para preencher esta sequencia."}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4 text-[12px] text-[#94a3b8]">
                Crie ou selecione uma sequencia para editar FPS, loop e quadros.
              </div>
            )}

            <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#cba6f7]">
                Preparacao para SGDK
              </div>
              <label className="mt-3 block space-y-1 text-[11px] text-[#94a3b8]">
                <span>Compressao</span>
                <select
                  value={state.compression}
                  onChange={(event) =>
                    dispatch({ type: "SET_COMPRESSION", value: event.target.value })
                  }
                  className="w-full rounded-xl border border-[#334155] bg-[#111827] px-3 py-2 text-sm font-mono text-[#e2e8f0] focus:border-[#cba6f7] focus:outline-none"
                >
                  {COMPRESSION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3 rounded-xl border border-[#1f2937] bg-[#111827] p-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748b]">
                  Paleta alvo
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {MEGA_DRIVE_PALETTE.map((color, index) => (
                    <div
                      key={index}
                      className="aspect-square rounded-lg border border-[#334155]"
                      style={{
                        backgroundColor: color === "transparent" ? "transparent" : color,
                        backgroundImage:
                          color === "transparent"
                            ? "linear-gradient(45deg, #334155 25%, transparent 25%), linear-gradient(-45deg, #334155 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #334155 75%), linear-gradient(-45deg, transparent 75%, #334155 75%)"
                            : undefined,
                        backgroundSize: color === "transparent" ? "8px 8px" : undefined,
                        backgroundPosition:
                          color === "transparent" ? "0 0, 0 4px, 4px -4px, -4px 0" : undefined,
                      }}
                      title={index === 0 ? "Transparente" : `Slot ${index}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
          <div className="border-b border-[#1f2937] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
              3. Preview / Output / Apply
            </p>
            <h3 className="mt-1 text-sm font-semibold text-[#e2e8f0]">
              Revise a animacao e aplique com seguranca
            </h3>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
                    Preview
                  </div>
                  <div className="mt-1 text-[12px] text-[#94a3b8]">
                    Validacao visual da sequencia ativa
                  </div>
                </div>
                <div className="text-right text-[11px] text-[#94a3b8]">
                  <div>{activeSequence?.name ?? "Sem sequencia"}</div>
                  <div>{activeSequence?.frames.length ?? 0} frame(s)</div>
                </div>
              </div>
              <div className="relative mt-4 flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-[#1f2937] bg-[radial-gradient(circle_at_top,#0f172a,#030712_72%)]">
                <canvas
                  ref={previewCanvasRef}
                  width={260}
                  height={260}
                  className="max-h-full max-w-full"
                  style={{ imageRendering: "pixelated" }}
                />
                {!state.spriteSheetUrl && (
                  <span className="absolute px-6 text-center text-[12px] leading-5 text-[#475569]">
                    Importe uma imagem e selecione frames para validar a animacao aqui.
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_PLAYING", playing: true })}
                  disabled={!activeSequence?.frames.length}
                  className="rounded-xl border border-[#a6e3a1]/45 bg-[#a6e3a1]/14 px-3 py-1.5 text-[11px] font-semibold text-[#bbf7d0] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Play
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_PLAYING", playing: false })}
                  className="rounded-xl border border-[#f38ba8]/45 bg-[#f38ba8]/12 px-3 py-1.5 text-[11px] font-semibold text-[#fecdd3] transition-colors hover:bg-[#f38ba8]/18"
                >
                  Stop
                </button>
                <span className="rounded-full border border-[#1f2937] bg-[#111827] px-2.5 py-1 text-[10px] font-semibold text-[#94a3b8]">
                  {state.playing ? "Animando" : "Parado"}
                </span>
              </div>
            </div>

            {externalSourceLoaded && (
              <div className="rounded-2xl border border-[#fab387]/35 bg-[#fab387]/10 px-4 py-3 text-[12px] leading-5 text-[#fcd9bd]">
                Imagem externa carregada com sucesso. Voce pode fatiar, montar sequencias e revisar o preview agora. Para aplicar a entidade na cena, mova ou copie o arquivo para <span className="font-semibold">assets/sprites</span> do projeto.
              </div>
            )}

            {state.validationError && (
              <div className="rounded-2xl border border-[#f38ba8]/35 bg-[#f38ba8]/10 px-4 py-3 text-[12px] leading-5 text-[#fecdd3]">
                {state.validationError}
              </div>
            )}

            <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
                Output (.res)
              </div>
              <pre className="mt-3 overflow-x-auto rounded-xl border border-[#1f2937] bg-[#020617] p-3 font-mono text-[11px] leading-5 text-[#86efac]">
                {resOutput}
              </pre>
            </div>

            <button
              type="button"
              onClick={handleApplyToScene}
              disabled={!canApplyToScene}
              className={`rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                state.saveFeedback
                  ? "bg-[#a6e3a1] text-[#082f1a]"
                  : "bg-[#a6e3a1]/90 text-[#082f1a] hover:bg-[#a6e3a1] disabled:cursor-not-allowed disabled:opacity-45"
              }`}
            >
              {state.saveFeedback
                ? "Aplicado com sucesso"
                : canUpdateEntity
                  ? "Atualizar entidade selecionada"
                  : "Aplicar e criar entidade na cena"}
            </button>

            <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4 text-[12px] leading-5 text-[#94a3b8]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
                Proximo passo natural
              </div>
              <p className="mt-2">
                O layout agora cobre o fluxo importar, fatiar, animar, revisar e aplicar. A conversao real para Mega Drive continua sendo uma etapa futura do pipeline.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
