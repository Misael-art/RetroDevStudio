import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { flushSync } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { Group, Panel } from "react-resizable-panels";
import LayoutSplitter from "../common/LayoutSplitter";
import { useEditorStore, type HwStatus } from "../../core/store/editorStore";
import { createSpriteEntityFromAsset } from "../../core/editorEntityFactory";
import {
  artProcessPalette,
  type ArtContentBounds,
  importArtAsset,
  type ArtSuggestedFrame,
} from "../../core/ipc/artStudioService";
import { parseInputCommandFile } from "../../core/ipc/inputCommandService";
import AssetQualityPanel from "./AssetQualityPanel";
import type { AnimationDef, SpriteCommandBinding, SpriteComponent } from "../../core/ipc/sceneService";
import {
  formatInputCommandSequence,
  type CommandButtonProfile,
  type ParsedInputCommand,
} from "../../core/inputCommands";
import { constrainSpriteFrameSize } from "../../core/sceneConstraints";
import { useSpriteAnimator } from "./useSpriteAnimator";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { buildTilemapAuthoringBrush, resolvePrimaryAuthoringSurface } from "../../core/entityAuthoring";

declare global {
  interface Window {
    __RDS_ARTSTUDIO_E2E__?: {
      ingestSpriteSheet: (sourcePath: string) => Promise<boolean>;
      loadImage: (sourcePath: string) => Promise<boolean>;
      importToProject: () => Promise<boolean>;
      importCommandDat: (commandPath: string) => Promise<number>;
      selectSequence: (sequenceId: string | null) => boolean;
      renameSequence: (sequenceId: string, name: string) => boolean;
      setFrameSize: (width: number, height: number) => boolean;
      setSequenceFrames: (sequenceId: string, frames: number[]) => boolean;
      assignCommand: (sequenceId: string, commandId: string) => boolean;
      applyToScene: (entityId?: string) => boolean;
      getState: () => {
        spriteSheetLoadStatus: string;
        spriteSheetSourcePath: string;
        spritePath: string;
        spriteName: string;
        frameWidth: number;
        frameHeight: number;
        activeSequenceId: string | null;
        suggestedFrames: ArtSuggestedFrame[];
        sequences: SpriteSequence[];
        canApplyToScene: boolean;
        validationError: string | null;
      };
    };
  }
}

const ARTSTUDIO_SUPPORTED_FORMATS_LABEL = "PNG, BMP, JPG/JPEG, GIF, WebP e PPM";
const ARTSTUDIO_CANVAS_MIN_ZOOM = 0.2;
const ARTSTUDIO_CANVAS_MAX_ZOOM = 24;

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

interface ArtStudioImageRequest {
  sourcePath?: string;
  file?: File;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function getArtStudioPanOffsets({
  startX,
  startY,
  currentX,
  currentY,
  scrollLeft,
  scrollTop,
}: {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  scrollLeft: number;
  scrollTop: number;
}) {
  return {
    scrollLeft: scrollLeft - (currentX - startX),
    scrollTop: scrollTop - (currentY - startY),
  };
}

export function getArtStudioWheelZoomState({
  clientX,
  clientY,
  deltaY,
  rect,
  scrollLeft,
  scrollTop,
  sourceZoom,
}: {
  clientX: number;
  clientY: number;
  deltaY: number;
  rect: Pick<DOMRect, "left" | "top">;
  scrollLeft: number;
  scrollTop: number;
  sourceZoom: number;
}) {
  const pointerX = clientX - rect.left + scrollLeft;
  const pointerY = clientY - rect.top + scrollTop;
  const nextZoom = clampZoom(sourceZoom * Math.exp(-deltaY * 0.0015));
  const ratio = nextZoom / sourceZoom;
  const viewportX = clientX - rect.left;
  const viewportY = clientY - rect.top;

  return {
    nextZoom,
    scrollLeft: pointerX * ratio - viewportX,
    scrollTop: pointerY * ratio - viewportY,
  };
}

function getInitialSourceZoom(size: { width: number; height: number }): number {
  const fitZoom = Math.min(
    2,
    900 / Math.max(size.width, 1),
    560 / Math.max(size.height, 1)
  );
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

function resolveDroppedFilePath(file: File): string | null {
  const fileWithPath = file as File & { path?: string };
  return typeof fileWithPath.path === "string" && fileWithPath.path.trim()
    ? fileWithPath.path
    : null;
}

function getArtStudioFriendlyError(sourceLabel: string, error: unknown): string {
  const detail = describeError(error).trim();
  if (
    detail.startsWith("Falha ao") ||
    detail.startsWith("Arquivo nao") ||
    detail.startsWith("O caminho informado")
  ) {
    return detail;
  }

  return describeArtStudioLoadFailure(sourceLabel, error);
}

async function loadArtStudioPreviewFromBase64(processedBase64: string): Promise<{
  image: HTMLImageElement;
  url: string;
  size: { width: number; height: number };
}> {
  const url = `data:image/png;base64,${processedBase64}`;
  const image = await loadImageElement(url);
  return {
    image,
    url,
    size: { width: image.naturalWidth, height: image.naturalHeight },
  };
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

export function buildArtStudioCommandBindings(
  sequences: SpriteSequence[],
  buttonProfile: CommandButtonProfile
): SpriteCommandBinding[] {
  return sequences
    .filter((sequence) => sequence.command && sequence.frames.length > 0)
    .map((sequence) => {
      const command = sequence.command!;
      return {
        id: command.id,
        display_name: command.display_name,
        notation: command.notation,
        source: command.source,
        target_animation: sanitizeAnimationKey(sequence.name),
        max_frames: command.max_frames,
        button_profile: buttonProfile,
        unsupported_tokens: command.unsupported_tokens,
        steps: command.steps,
      };
    })
    .filter((binding) => binding.target_animation.length > 0);
}

export interface SpriteSequence {
  id: string;
  name: string;
  frames: number[];
  fps: number;
  loop: boolean;
  command?: ParsedInputCommand;
}

const DEFAULT_ARTSTUDIO_SEQUENCES: SpriteSequence[] = [
  { id: "seq_idle", name: "IDLE", frames: [0], fps: 1, loop: true },
  { id: "seq_run", name: "RUN", frames: [], fps: 12, loop: true },
  { id: "seq_jump", name: "JUMP", frames: [], fps: 8, loop: false },
  { id: "seq_attack", name: "ATTACK", frames: [], fps: 12, loop: false },
];

function cloneDefaultArtStudioSequences(): SpriteSequence[] {
  return DEFAULT_ARTSTUDIO_SEQUENCES.map((sequence) => ({
    ...sequence,
    frames: [...sequence.frames],
  }));
}

function titleCaseAnimationKey(value: string): string {
  const words = value
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return "Animacao";
  }
  return words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(" ");
}

function spriteCommandBindingToParsedCommand(binding: SpriteCommandBinding): ParsedInputCommand {
  return {
    id: binding.id,
    display_name: binding.display_name,
    notation: binding.notation,
    source: binding.source,
    max_frames: binding.max_frames,
    unsupported_tokens: binding.unsupported_tokens ?? [],
    steps: binding.steps ?? [],
  };
}

function resolveArtStudioSequenceIdForAnimationKey(
  animationKey: string,
  usedCanonicalIds: Set<string>
): string {
  const normalizedKey = sanitizeAnimationKey(animationKey) || "animation";
  const canonicalByKey = DEFAULT_ARTSTUDIO_SEQUENCES.find(
    (sequence) =>
      sequence.id === `seq_${normalizedKey}` ||
      sanitizeAnimationKey(sequence.name) === normalizedKey
  );
  if (canonicalByKey && !usedCanonicalIds.has(canonicalByKey.id)) {
    return canonicalByKey.id;
  }

  const freeCanonical = DEFAULT_ARTSTUDIO_SEQUENCES.find(
    (sequence) => !usedCanonicalIds.has(sequence.id)
  );
  if (freeCanonical) {
    return freeCanonical.id;
  }

  return `seq_${normalizedKey}`;
}

export function buildArtStudioSequencesFromSpriteMetadata(
  sprite: Pick<SpriteComponent, "animations" | "commands"> | null | undefined
): SpriteSequence[] {
  const animations = sprite?.animations ?? {};
  const animationEntries = Object.entries(animations);
  if (animationEntries.length === 0) {
    return cloneDefaultArtStudioSequences();
  }

  const commandsByAnimation = new Map(
    (sprite?.commands ?? []).map((binding) => [
      sanitizeAnimationKey(binding.target_animation),
      spriteCommandBindingToParsedCommand(binding),
    ])
  );

  const base = cloneDefaultArtStudioSequences();
  const usedCanonicalIds = new Set<string>();

  for (const [key, animation] of animationEntries) {
    const normalizedKey = sanitizeAnimationKey(key) || "animation";
    const sequenceId = resolveArtStudioSequenceIdForAnimationKey(key, usedCanonicalIds);
    usedCanonicalIds.add(sequenceId);
    const command = commandsByAnimation.get(normalizedKey);
    const slotIndex = base.findIndex((sequence) => sequence.id === sequenceId);
    const hydratedSequence: SpriteSequence = {
      id: sequenceId,
      name: titleCaseAnimationKey(key),
      frames: [...animation.frames],
      fps: animation.fps,
      loop: animation.loop,
      ...(command ? { command } : {}),
    };

    if (slotIndex >= 0) {
      base[slotIndex] = hydratedSequence;
      continue;
    }

    base.push(hydratedSequence);
  }

  return base;
}

export interface ArtStudioHardwareBudgetSummary {
  tone: "idle" | "ok" | "warn" | "error";
  label: string;
  items: string[];
  overflowCount: number;
}

export function summarizeArtStudioHardwareBudget(
  hwStatus: HwStatus | null | undefined,
  maxItems = 2
): ArtStudioHardwareBudgetSummary {
  if (!hwStatus) {
    return {
      tone: "idle",
      label: "Orcamento aguardando validacao",
      items: [],
      overflowCount: 0,
    };
  }

  const issues = hwStatus.errors.length > 0 ? hwStatus.errors : hwStatus.warnings;
  const tone =
    hwStatus.errors.length > 0 ? "error" : hwStatus.warnings.length > 0 ? "warn" : "ok";
  const issueCount = issues.length;
  const label =
    tone === "error"
      ? `${issueCount} bloqueio${issueCount === 1 ? "" : "s"} de hardware`
      : tone === "warn"
        ? `${issueCount} alerta${issueCount === 1 ? "" : "s"} de hardware`
        : `Budget OK: sprites ${hwStatus.sprite_count}/${hwStatus.sprite_limit}, VRAM ${hwStatus.vram_used}/${hwStatus.vram_limit}`;

  return {
    tone,
    label,
    items: issues.slice(0, maxItems),
    overflowCount: Math.max(0, issueCount - maxItems),
  };
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
  spriteSheetFrameCount: number | null;
  spriteSheetBackgroundMode: string | null;
  spriteSheetTransparentPixels: number | null;
  spriteSheetPalette: string[];
  spriteSheetWarnings: string[];
  spriteSheetContentBounds: ArtContentBounds | null;
  spriteSheetRecommendedOutput: { width: number; height: number; scalePercent: number } | null;
  spriteSheetMetaSpriteCandidate: boolean;
  suggestedFrames: ArtSuggestedFrame[];
  slicingMode: string | null;
  sourceZoom: number;
  frameWidth: number;
  frameHeight: number;
  sequences: SpriteSequence[];
  commandLibrary: ParsedInputCommand[];
  commandImportSource: string;
  commandButtonProfile: CommandButtonProfile;
  activeSequenceId: string | null;
  playing: boolean;
  compression: string;
  spriteName: string;
  spritePath: string;
  spriteSourceAssetPath: string;
  saveFeedback: boolean;
  validationError: string | null;
}

type ArtStudioAutomationState = {
  spriteSheetLoadStatus: ArtStudioLoadStatus;
  spriteSheetSourcePath: string;
  spritePath: string;
  spriteName: string;
  frameWidth: number;
  frameHeight: number;
  canApplyToScene: boolean;
  activeSequenceId: string | null;
  suggestedFrames: ArtSuggestedFrame[];
  sequences: Array<Pick<SpriteSequence, "id" | "name" | "frames" | "fps" | "loop">>;
};

type ArtStudioAutomationApi = {
  ingestSpriteSheet: (sourcePath: string) => Promise<boolean>;
  getState: () => ArtStudioAutomationState;
};

declare global {
  interface Window {
    __RDS_ARTSTUDIO_E2E__?: ArtStudioAutomationApi;
  }
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
      frameCount: number | null;
      backgroundMode: string | null;
      transparentPixels: number | null;
      palette: string[];
      warnings: string[];
      contentBounds: ArtContentBounds | null;
      recommendedOutput: { width: number; height: number; scalePercent: number } | null;
      metaSpriteCandidate: boolean;
      suggestedFrames: ArtSuggestedFrame[];
      slicingMode: string | null;
      suggestedFrameWidth: number;
      suggestedFrameHeight: number;
    }
  | {
      type: "SET_IMPORTED_ASSET";
      path: string;
      name: string;
      width: number;
      height: number;
    }
  | {
      type: "UPDATE_SLICING_SUGGESTIONS";
      frameWidth: number;
      frameHeight: number;
      suggestedFrames: ArtSuggestedFrame[];
      warnings: string[];
      contentBounds: ArtContentBounds | null;
      recommendedOutput: { width: number; height: number; scalePercent: number } | null;
      slicingMode: string | null;
    }
  | { type: "LOAD_SPRITE_ERROR"; message: string }
  | { type: "SET_SOURCE_ZOOM"; value: number }
  | { type: "SET_FRAME_SIZE"; width?: number; height?: number }
  | { type: "ADD_SEQUENCE"; id: string; name: string }
  | { type: "DELETE_SEQUENCE"; id: string }
  | { type: "RENAME_SEQUENCE"; id: string; name: string }
  | { type: "SELECT_SEQUENCE"; id: string | null }
  | { type: "TOGGLE_FRAME"; cellIndex: number }
  | { type: "SET_SEQUENCE_FRAMES"; id: string; frames: number[] }
  | { type: "SET_SEQUENCE_FPS"; id: string; fps: number }
  | { type: "SET_SEQUENCE_LOOP"; id: string; loop: boolean }
  | { type: "SET_COMMAND_LIBRARY"; source: string; commands: ParsedInputCommand[] }
  | { type: "SET_COMMAND_PROFILE"; profile: CommandButtonProfile }
  | { type: "ASSIGN_COMMAND_TO_SEQUENCE"; sequenceId: string; command: ParsedInputCommand }
  | { type: "CREATE_SEQUENCE_FROM_COMMAND"; id: string; command: ParsedInputCommand }
  | { type: "CLEAR_SEQUENCE_COMMAND"; sequenceId: string }
  | { type: "HYDRATE_SPRITE_METADATA"; sequences: SpriteSequence[] }
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
        spriteSheetWarnings: [],
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
        spriteSheetFrameCount: action.frameCount,
        spriteSheetBackgroundMode: action.backgroundMode,
        spriteSheetTransparentPixels: action.transparentPixels,
        spriteSheetPalette: action.palette,
        spriteSheetWarnings: action.warnings,
        spriteSheetContentBounds: action.contentBounds,
        spriteSheetRecommendedOutput: action.recommendedOutput,
        spriteSheetMetaSpriteCandidate: action.metaSpriteCandidate,
        suggestedFrames: action.suggestedFrames,
        slicingMode: action.slicingMode,
        sourceZoom: action.zoom,
        spritePath: "",
        spriteSourceAssetPath: action.path,
        spriteName: action.name,
        frameWidth: action.suggestedFrameWidth,
        frameHeight: action.suggestedFrameHeight,
        saveFeedback: false,
        validationError: null,
      };
    case "LOAD_SPRITE_ERROR":
      return {
        ...state,
        spriteSheetLoadStatus: "error",
        spriteSheetLoadMessage: action.message,
        spriteSheetFrameCount: null,
        spriteSheetBackgroundMode: null,
        spriteSheetTransparentPixels: null,
        spriteSheetPalette: [],
        spriteSheetWarnings: [],
        spriteSheetContentBounds: null,
        spriteSheetRecommendedOutput: null,
        spriteSheetMetaSpriteCandidate: false,
        suggestedFrames: [],
        slicingMode: null,
        saveFeedback: false,
      };
    case "SET_IMPORTED_ASSET":
      return {
        ...state,
        spritePath: action.path,
        spriteName: action.name,
        frameWidth: action.width,
        frameHeight: action.height,
        validationError: null,
      };
    case "UPDATE_SLICING_SUGGESTIONS":
      {
        const available = new Set(action.suggestedFrames.map((frame) => frame.index));
        return {
          ...state,
          frameWidth: action.frameWidth,
          frameHeight: action.frameHeight,
          suggestedFrames: action.suggestedFrames,
          spriteSheetWarnings: action.warnings,
          spriteSheetContentBounds: action.contentBounds,
          spriteSheetRecommendedOutput: action.recommendedOutput,
          slicingMode: action.slicingMode,
          sequences: state.sequences.map((sequence) => ({
            ...sequence,
            frames: sequence.frames.filter((frame) => available.has(frame)),
          })),
        };
      }
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
    case "SET_SEQUENCE_FRAMES":
      return {
        ...state,
        sequences: state.sequences.map((sequence) =>
          sequence.id === action.id
            ? {
                ...sequence,
                frames: Array.from(
                  new Set(
                    action.frames.filter((frame) => Number.isInteger(frame) && frame >= 0)
                  )
                ).sort((left, right) => left - right),
              }
            : sequence
        ),
      };
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
    case "SET_COMMAND_LIBRARY":
      return {
        ...state,
        commandLibrary: action.commands,
        commandImportSource: action.source,
        validationError: null,
      };
    case "SET_COMMAND_PROFILE":
      return {
        ...state,
        commandButtonProfile: action.profile,
      };
    case "ASSIGN_COMMAND_TO_SEQUENCE":
      return {
        ...state,
        sequences: state.sequences.map((sequence) =>
          sequence.id === action.sequenceId ? { ...sequence, command: action.command } : sequence
        ),
        activeSequenceId: action.sequenceId,
        validationError: null,
      };
    case "CREATE_SEQUENCE_FROM_COMMAND": {
      const seq: SpriteSequence = {
        id: action.id,
        name: action.command.display_name,
        frames: [],
        fps: 12,
        loop: false,
        command: action.command,
      };
      return {
        ...state,
        sequences: [...state.sequences, seq],
        activeSequenceId: action.id,
        validationError: null,
      };
    }
    case "CLEAR_SEQUENCE_COMMAND":
      return {
        ...state,
        sequences: state.sequences.map((sequence) => {
          if (sequence.id !== action.sequenceId) {
            return sequence;
          }
          const nextSequence = { ...sequence };
          delete nextSequence.command;
          return nextSequence;
        }),
      };
    case "HYDRATE_SPRITE_METADATA":
      return {
        ...state,
        sequences: action.sequences,
        activeSequenceId: null,
        validationError: null,
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
  spriteSheetFrameCount: null,
  spriteSheetBackgroundMode: null,
  spriteSheetTransparentPixels: null,
  spriteSheetPalette: [],
  spriteSheetWarnings: [],
  spriteSheetContentBounds: null,
  spriteSheetRecommendedOutput: null,
  spriteSheetMetaSpriteCandidate: false,
  suggestedFrames: [],
  slicingMode: null,
  sourceZoom: 1,
  frameWidth: 32,
  frameHeight: 32,
  sequences: cloneDefaultArtStudioSequences(),
  commandLibrary: [],
  commandImportSource: "",
  commandButtonProfile: "megadrive",
  activeSequenceId: null,
  playing: false,
  compression: "NONE",
  spriteName: "sprite",
  spritePath: "",
  spriteSourceAssetPath: "",
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

export function getSuggestedFrameIndex(
  canvasRect: DOMRect,
  canvasWidth: number,
  canvasHeight: number,
  imgWidth: number,
  imgHeight: number,
  frames: ArtSuggestedFrame[],
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

  const match = frames.find(
    (frame) =>
      imgX >= frame.x &&
      imgX < frame.x + frame.width &&
      imgY >= frame.y &&
      imgY < frame.y + frame.height
  );

  return match?.index ?? null;
}

interface ArtStudioContextValue {
  state: ArtStudioState;
  dispatch: Dispatch<ArtStudioAction>;
  activeProjectDir: string;
  activeSequence: SpriteSequence | undefined;
  canUpdateEntity: boolean;
  canApplyToScene: boolean;
  totalFrameSlots: number;
  usedFrameCount: number;
  hardwareBudgetSummary: ArtStudioHardwareBudgetSummary;
  externalSourceLoaded: boolean;
  loadStatusText: string;
  sourceOriginLabel: string;
  displayPalette: string[];
  resOutput: string;
  applyPlanLabel: string;
  buildReadinessLabel: string;
  applyNextStepLabel: string;
  previewCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  handleAddSequence: () => void;
  applyConstrainedFrameSize: (nextWidth: number, nextHeight: number) => void;
  handleImportCommandDat: () => Promise<void>;
  handleImportToProject: () => Promise<void>;
  handleApplyToScene: () => void;
}

const ArtStudioContext = createContext<ArtStudioContextValue | null>(null);

function useArtStudioContext() {
  const context = useContext(ArtStudioContext);
  if (!context) {
    throw new Error("ArtStudioContext indisponivel fora do provider.");
  }
  return context;
}

function ArtStudioTimelineSection() {
  const { state, dispatch, usedFrameCount, handleAddSequence } = useArtStudioContext();

  return (
    <section
      data-testid="artstudio-timeline"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]"
    >
      <div className="border-b border-[#1f2937] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#cba6f7]">
          Timeline
        </p>
        <h3 className="mt-1 text-sm font-semibold text-[#e2e8f0]">
          Organize quadros em animacoes reutilizaveis
        </h3>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[#313244] bg-[#0b1220] px-2.5 py-1 text-[10px] font-semibold text-[#94a3b8]">
              Sequencias {state.sequences.length}
            </span>
            <span className="rounded-full border border-[#313244] bg-[#0b1220] px-2.5 py-1 text-[10px] font-semibold text-[#94a3b8]">
              Frames usados {usedFrameCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => dispatch({ type: "SELECT_SEQUENCE", id: null })}
              className={`rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                state.activeSequenceId === null
                  ? "border-[#7dd3fc]/40 bg-[#7dd3fc]/10 text-[#dff6ff]"
                  : "border-[#313244] bg-[#111827] text-[#cbd5e1] hover:bg-[#1e293b]"
              }`}
            >
              Imagem
            </button>
            <button
              type="button"
              onClick={handleAddSequence}
              className="rounded-xl border border-[#cba6f7]/40 bg-[#cba6f7]/12 px-3 py-1.5 text-[11px] font-semibold text-[#e9d5ff] transition-colors hover:bg-[#cba6f7]/18"
            >
              + Nova sequencia
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-x-auto overflow-y-hidden">
          <div className="flex min-h-full gap-3">
            {state.sequences.map((sequence) => {
              const isActive = state.activeSequenceId === sequence.id;
              return (
                <div
                  key={sequence.id}
                  role="button"
                  tabIndex={0}
                  data-testid={`artstudio-sequence-card-${sequence.id}`}
                  className={`flex min-w-[220px] max-w-[220px] flex-col gap-2 rounded-2xl border px-3 py-3 transition-colors ${
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
                  <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                    <span>{sequence.frames.length} frame(s)</span>
                    <span>{sequence.loop ? "Loop" : "One shot"}</span>
                  </div>
                  <div className="truncate rounded-xl border border-[#1f2937] bg-[#111827] px-2.5 py-2 text-[11px] text-[#94a3b8]">
                    {sequence.frames.length > 0
                      ? `Frames selecionados: ${sequence.frames.join(", ")}`
                      : "Sem frames ainda"}
                  </div>
                  {sequence.command ? (
                    <div className="rounded-xl border border-[#94e2d5]/35 bg-[#94e2d5]/10 px-2.5 py-2 text-[11px] text-[#ccfbf1]">
                      Comando: {sequence.command.display_name}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <details
          open
          className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-3"
          data-testid="artstudio-command-panel"
        >
          <summary className="cursor-pointer list-none">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94e2d5]">
                Comandos
              </p>
              <p className="mt-1 text-[11px] text-[#94a3b8]">
                {state.commandLibrary.length > 0
                  ? `${state.commandLibrary.length} comando(s) de ${state.commandImportSource || "command.dat"}`
                  : "Importe command.dat para associar movimentos a animacoes."}
              </p>
            </div>
          </summary>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full border border-[#334155] bg-[#111827] px-2 py-1 text-[10px] font-semibold text-[#94a3b8]">
              Painel colapsavel
            </span>
            <select
              value={state.commandButtonProfile}
              onChange={(event) =>
                dispatch({
                  type: "SET_COMMAND_PROFILE",
                  profile: event.target.value as CommandButtonProfile,
                })
              }
              className="rounded-lg border border-[#313244] bg-[#111827] px-2 py-1 text-[11px] text-[#cdd6f4]"
              aria-label="Perfil de botoes"
            >
              <option value="megadrive">Mega Drive</option>
              <option value="snes">SNES</option>
              <option value="keyboard">Teclado</option>
              <option value="mouse">Mouse</option>
            </select>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {state.commandLibrary.length === 0 ? (
              <span className="rounded-xl border border-dashed border-[#334155] px-3 py-2 text-[11px] text-[#64748b]">
                Nenhum comando carregado
              </span>
            ) : (
              state.commandLibrary.map((command) => {
                const canAssign = Boolean(state.activeSequenceId);
                return (
                  <div
                    key={command.id}
                    className="min-w-[210px] rounded-xl border border-[#1f2937] bg-[#111827] p-3 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-[#e2e8f0]">
                          {command.display_name}
                        </p>
                        <p className="mt-1 text-[13px] font-semibold text-[#f9e2af]">
                          {formatInputCommandSequence(command, state.commandButtonProfile)}
                        </p>
                      </div>
                      {command.unsupported_tokens.length > 0 ? (
                        <span className="rounded-full border border-[#f38ba8]/35 bg-[#f38ba8]/10 px-2 py-0.5 text-[9px] font-semibold text-[#f38ba8]">
                          bloqueia
                        </span>
                      ) : (
                        <span className="rounded-full border border-[#a6e3a1]/35 bg-[#a6e3a1]/10 px-2 py-0.5 text-[9px] font-semibold text-[#a6e3a1]">
                          runtime
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={!canAssign}
                        onClick={() =>
                          state.activeSequenceId &&
                          dispatch({
                            type: "ASSIGN_COMMAND_TO_SEQUENCE",
                            sequenceId: state.activeSequenceId,
                            command,
                          })
                        }
                        className="rounded-lg border border-[#94e2d5]/40 bg-[#94e2d5]/10 px-2 py-1 text-[10px] font-semibold text-[#94e2d5] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Associar {command.display_name}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "CREATE_SEQUENCE_FROM_COMMAND",
                            id: `seq_cmd_${command.id}_${Date.now()}`,
                            command,
                          })
                        }
                        className="rounded-lg border border-[#cba6f7]/35 bg-[#cba6f7]/10 px-2 py-1 text-[10px] font-semibold text-[#e9d5ff]"
                      >
                        Criar sequencia
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

function ArtStudioInspectorSection() {
  const {
    state,
    dispatch,
    activeProjectDir,
    activeSequence,
      canUpdateEntity,
      canApplyToScene,
      totalFrameSlots,
      usedFrameCount,
      hardwareBudgetSummary,
      externalSourceLoaded,
      loadStatusText,
      sourceOriginLabel,
    displayPalette,
    resOutput,
    applyPlanLabel,
    buildReadinessLabel,
    applyNextStepLabel,
    previewCanvasRef,
    handleImportToProject,
    handleApplyToScene,
    applyConstrainedFrameSize,
  } = useArtStudioContext();
  const keyColorLabel =
    state.spriteSheetLoadStatus === "loaded" &&
    (state.spriteSheetTransparentPixels || displayPalette[0] === "transparent")
      ? "Key color: transparente"
      : "Key color: nao detectada";
  const budgetToneClass =
    hardwareBudgetSummary.tone === "error"
      ? "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#fecdd3]"
      : hardwareBudgetSummary.tone === "warn"
        ? "border-[#f9e2af]/35 bg-[#f9e2af]/10 text-[#fef3c7]"
        : hardwareBudgetSummary.tone === "ok"
          ? "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#bbf7d0]"
          : "border-[#334155] bg-[#111827] text-[#94a3b8]";

  return (
    <section
      data-testid="artstudio-inspector"
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]"
    >
      <div className="border-b border-[#1f2937] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
          Inspector
        </p>
        <h3 className="mt-1 text-sm font-semibold text-[#e2e8f0]">Preview, output e apply</h3>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
                Preview
              </div>
              <div className="mt-1 text-[12px] text-[#94a3b8]">
                {activeSequence ? "Validacao visual da sequencia ativa" : "Metadados e status da imagem carregada"}
              </div>
            </div>
            <div className="text-right text-[11px] text-[#94a3b8]">
              <div>{activeSequence?.name ?? "Sem sequencia"}</div>
              <div>{activeSequence?.frames.length ?? 0} frame(s)</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#94e2d5]/30 bg-[#94e2d5]/10 px-2.5 py-1 text-[10px] font-semibold text-[#ccfbf1]">
              {keyColorLabel}
            </span>
            <span className="rounded-full border border-[#1f2937] bg-[#111827] px-2.5 py-1 text-[10px] font-semibold text-[#94a3b8]">
              Preview usa PNG quantizado do backend
            </span>
          </div>
          <div
            className="relative mt-4 flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-[#1f2937]"
            style={{
              backgroundColor: "#030712",
              backgroundImage:
                "linear-gradient(45deg, rgba(148,163,184,0.16) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.16) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.16) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.16) 75%)",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
              backgroundSize: "16px 16px",
            }}
          >
            <canvas
              ref={previewCanvasRef}
              width={260}
              height={260}
              className="max-h-full max-w-full"
              style={{ imageRendering: "pixelated" }}
            />
            {!state.spriteSheetUrl && (
              <span className="absolute px-6 text-center text-[12px] leading-5 text-[#475569]">
                Sem preview ainda.
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
          <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
              Metadados da imagem
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
              <dt className="text-[#64748b]">Arquivo</dt>
              <dd className="truncate font-medium text-[#e2e8f0]" title={state.spriteSheetDisplayName || "Nenhum"}>
                {state.spriteSheetDisplayName || "Nenhum"}
              </dd>
              <dt className="text-[#64748b]">Formato</dt>
              <dd className="font-medium text-[#e2e8f0]">{state.spriteSheetFormat ?? "-"}</dd>
              <dt className="text-[#64748b]">Resolucao</dt>
              <dd className="font-medium text-[#e2e8f0]">
                {state.spriteSheetSize ? `${state.spriteSheetSize.width} x ${state.spriteSheetSize.height}` : "-"}
              </dd>
              <dt className="text-[#64748b]">Origem</dt>
              <dd className="font-medium text-[#e2e8f0]">{sourceOriginLabel}</dd>
              <dt className="text-[#64748b]">Frames</dt>
              <dd className="font-medium text-[#e2e8f0]">
                {state.spriteSheetFrameCount ?? (totalFrameSlots > 0 ? totalFrameSlots : "-")}
              </dd>
              <dt className="text-[#64748b]">Asset</dt>
              <dd className="truncate font-medium text-[#e2e8f0]" title={state.spritePath || "Pendente de importacao canonica"}>
                {state.spritePath || "Pendente de importacao canonica"}
              </dd>
            </dl>
          </div>
        )}

        <details className="rounded-2xl border border-[#1f2937] bg-[#0f172a] p-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
            Diagnostico ({state.spriteSheetWarnings.length})
          </summary>
          <p className="mt-3 text-[12px] leading-5 text-[#cbd5e1]">{loadStatusText}</p>
          {state.spriteSheetWarnings.length > 0 ? (
            <ul className="mt-3 space-y-2 text-[11px] leading-5 text-[#f9e2af]">
              {state.spriteSheetWarnings.map((warning) => (
                <li
                  key={warning}
                  className="rounded-xl border border-[#f9e2af]/20 bg-[#f9e2af]/8 px-3 py-2"
                >
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </details>

        <div
          data-testid="artstudio-apply-plan"
          className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
            Plano de apply
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
            <dt className="text-[#64748b]">Destino</dt>
            <dd className="font-medium text-[#e2e8f0]">{applyPlanLabel}</dd>
            <dt className="text-[#64748b]">Build</dt>
            <dd className="truncate font-medium text-[#e2e8f0]" title={buildReadinessLabel}>
              {buildReadinessLabel}
            </dd>
            <dt className="text-[#64748b]">Budget</dt>
            <dd>
              <div
                data-testid="artstudio-hardware-budget"
                className={`flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium ${budgetToneClass}`}
              >
                <span className="truncate">{hardwareBudgetSummary.label}</span>
                {hardwareBudgetSummary.items.map((item) => (
                  <span
                    key={item}
                    className="max-w-full truncate rounded-full border border-current/20 px-2 py-0.5"
                    title={item}
                  >
                    {item}
                  </span>
                ))}
                {hardwareBudgetSummary.overflowCount > 0 ? (
                  <span className="rounded-full border border-current/20 px-2 py-0.5">
                    +{hardwareBudgetSummary.overflowCount}
                  </span>
                ) : null}
              </div>
            </dd>
            <dt className="text-[#64748b]">Frames</dt>
            <dd className="font-medium text-[#e2e8f0]">
              {usedFrameCount > 0
                ? `${usedFrameCount} frame(s) ja selecionados nas sequencias`
                : "Selecione frames em pelo menos uma sequencia"}
            </dd>
            <dt className="text-[#64748b]">Proximo passo</dt>
            <dd className="font-medium text-[#e2e8f0]">{applyNextStepLabel}</dd>
          </dl>
        </div>

        <AssetQualityPanel assetPath={state.spritePath || undefined} />

        <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
            Metadados completos
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
            <dt className="text-[#64748b]">Arquivo</dt>
            <dd className="truncate font-medium text-[#e2e8f0]" title={state.spriteSheetDisplayName || "Nenhum"}>
              {state.spriteSheetDisplayName || "Nenhum"}
            </dd>
            <dt className="text-[#64748b]">Formato</dt>
            <dd className="font-medium text-[#e2e8f0]">{state.spriteSheetFormat ?? "-"}</dd>
            <dt className="text-[#64748b]">Resolucao</dt>
            <dd className="font-medium text-[#e2e8f0]">
              {state.spriteSheetSize ? `${state.spriteSheetSize.width} x ${state.spriteSheetSize.height}` : "-"}
            </dd>
            <dt className="text-[#64748b]">Origem</dt>
            <dd className="font-medium text-[#e2e8f0]">{sourceOriginLabel}</dd>
            <dt className="text-[#64748b]">Transparencia</dt>
            <dd className="font-medium text-[#e2e8f0]">
              {state.spriteSheetBackgroundMode
                ? `${state.spriteSheetBackgroundMode} (${state.spriteSheetTransparentPixels ?? 0} px)`
                : "-"}
            </dd>
            <dt className="text-[#64748b]">Bounds</dt>
            <dd className="font-medium text-[#e2e8f0]">
              {state.spriteSheetContentBounds
                ? `${state.spriteSheetContentBounds.width}x${state.spriteSheetContentBounds.height} -> ${state.spriteSheetContentBounds.aligned_width}x${state.spriteSheetContentBounds.aligned_height}`
                : "-"}
            </dd>
            <dt className="text-[#64748b]">Saida sug.</dt>
            <dd className="font-medium text-[#e2e8f0]">
              {state.spriteSheetRecommendedOutput
                ? `${state.spriteSheetRecommendedOutput.width}x${state.spriteSheetRecommendedOutput.height} @ ${state.spriteSheetRecommendedOutput.scalePercent}%`
                : "-"}
            </dd>
            <dt className="text-[#64748b]">Slicing</dt>
            <dd className="font-medium text-[#e2e8f0]">
              {state.slicingMode ?? "-"} ({state.suggestedFrames.length} frames)
            </dd>
            <dt className="text-[#64748b]">Perfil</dt>
            <dd className="font-medium text-[#e2e8f0]">
              {state.spriteSheetMetaSpriteCandidate ? "Meta-sprite" : "Sprite simples"}
            </dd>
            <dt className="text-[#64748b]">Fonte</dt>
            <dd className="truncate font-medium text-[#e2e8f0]" title={state.spriteSheetSourcePath || "-"}>
              {state.spriteSheetSourcePath || "-"}
            </dd>
            <dt className="text-[#64748b]">Asset</dt>
            <dd className="truncate font-medium text-[#e2e8f0]" title={state.spritePath || "Pendente de importacao canonica"}>
              {state.spritePath || "Pendente de importacao canonica"}
            </dd>
          </dl>
        </div>

        <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
            Configuracoes de exportacao
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
          <label className="mt-3 block space-y-1 text-[11px] text-[#94a3b8]">
            <span>Compressao</span>
            <select
              value={state.compression}
              onChange={(event) =>
                dispatch({ type: "SET_COMPRESSION", value: event.target.value })
              }
              className="w-full rounded-xl border border-[#334155] bg-[#111827] px-3 py-2 text-sm font-mono text-[#e2e8f0] focus:border-[#7dd3fc] focus:outline-none"
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
              {displayPalette.map((color, index) => (
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

        {(externalSourceLoaded || (state.spriteSheetLoadStatus === "loaded" && !state.spritePath)) && (
          <div className="rounded-2xl border border-[#fab387]/35 bg-[#fab387]/10 px-4 py-3 text-[12px] leading-5 text-[#fcd9bd]">
            A imagem foi processada com sucesso, mas ainda nao virou um asset canonico do projeto. Gere o sprite sheet em <span className="font-semibold">assets/sprites</span> para alinhar os indices de frame com o pipeline oficial antes de aplicar na cena.
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
          data-testid="artstudio-import-to-project"
          onClick={() => {
            void handleImportToProject();
          }}
          disabled={!state.spriteSheetSourcePath || !activeProjectDir || state.suggestedFrames.length === 0}
          className="rounded-2xl border border-[#89b4fa]/40 bg-[#89b4fa]/12 px-4 py-3 text-sm font-semibold text-[#dbeafe] transition-colors hover:bg-[#89b4fa]/18 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.spritePath ? "Regerar asset canonico" : "Trazer para assets/sprites"}
        </button>

        <button
          type="button"
          data-testid="artstudio-apply-to-scene"
          onClick={() => {
            handleApplyToScene();
          }}
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
              ? "Aplicar nesta entidade"
              : "Aplicar e criar entidade na cena"}
        </button>
      </div>
    </section>
  );
}

export default function ArtStudioPanel() {
  const {
    logMessage,
    activeScene,
    activeProjectDir,
    activeTarget,
    hwStatus,
    selectedEntityId,
    addEntity,
    updateEntity,
    setEditorMode,
    setActiveWorkspace,
    setActiveViewportTab,
    setSelectedEntityId,
    setActiveTilemapId,
    setActiveBrush,
  } = useEditorStore();

  const [state, dispatch] = useReducer(artStudioReducer, INITIAL_STATE);
  const artStudioStateRef = useRef(state);
  artStudioStateRef.current = state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageScrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const processingRequestIdRef = useRef(0);
  const autoHydratedSpriteRef = useRef<string | null>(null);
  const saveFeedbackTimeoutRef = useRef<number | null>(null);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [currentPreviewCell, setCurrentPreviewCell] = useState<number>(-1);
  const [dragActive, setDragActive] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);

  const activeSequence = state.sequences.find((sequence) => sequence.id === state.activeSequenceId);
  const selectedEntity = activeScene?.entities.find((entity) => entity.entity_id === selectedEntityId);
  const selectedEntitySprite = selectedEntity?.components?.sprite;
  const canUpdateEntity = Boolean(selectedEntitySprite);
  const returnToSceneWithSelectedContext = useCallback(() => {
    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
    if (selectedEntity) {
      setSelectedEntityId(selectedEntity.entity_id);
      const preferredSurface = resolvePrimaryAuthoringSurface(selectedEntity);
      if (preferredSurface === "tilemap") {
        setEditorMode("paint");
        setActiveTilemapId(selectedEntity.entity_id);
        setActiveBrush(buildTilemapAuthoringBrush(selectedEntity));
        logMessage(
          "info",
          `[ArtStudio] Retorno para Cena com contexto de tilemap: ${getEntityDisplayName(selectedEntity)}.`
        );
        return;
      }
    }
    setEditorMode("select");
    logMessage(
      "info",
      selectedEntity
        ? `[ArtStudio] Retorno para Cena com foco em ${getEntityDisplayName(selectedEntity)}.`
        : "[ArtStudio] Retorno ao Scene workspace."
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

  const totalGridColumns =
    state.spriteSheetSize && state.frameWidth > 0
      ? Math.max(1, Math.floor(state.spriteSheetSize.width / state.frameWidth))
      : 0;
  const totalGridRows =
    state.spriteSheetSize && state.frameHeight > 0
      ? Math.max(1, Math.floor(state.spriteSheetSize.height / state.frameHeight))
      : 0;
  const totalFrameSlots =
    state.suggestedFrames.length > 0 ? state.suggestedFrames.length : totalGridColumns * totalGridRows;
  const usedFrameCount = new Set(state.sequences.flatMap((sequence) => sequence.frames)).size;
  const hardwareBudgetSummary = summarizeArtStudioHardwareBudget(hwStatus);
  const hasValidAnimationFrames = state.sequences.some((sequence) => sequence.frames.length > 0);
  const externalSourceLoaded =
    state.spriteSheetLoadStatus === "loaded" && state.spriteSheetScope === "external";
  const canApplyToScene =
    Boolean(activeProjectDir) &&
    Boolean(activeScene) &&
    Boolean(state.spriteSheetUrl) &&
    Boolean(state.spritePath) &&
    state.suggestedFrames.length > 0 &&
    state.spriteSheetLoadStatus === "loaded";
  const projectedEntityId = useMemo(() => {
    if (!activeScene || !state.spritePath) {
      return null;
    }

    return createSpriteEntityFromAsset({
      assetPath: state.spritePath,
      target: activeTarget,
      existingEntityIds: activeScene.entities.map((entity) => entity.entity_id),
      suggestedName: state.spriteName,
      frameWidth: state.frameWidth,
      frameHeight: state.frameHeight,
    }).entity_id;
  }, [
    activeScene,
    activeTarget,
    state.frameHeight,
    state.frameWidth,
    state.spriteName,
    state.spritePath,
  ]);
  const applyPlanLabel =
    canUpdateEntity && selectedEntityId
      ? `Atualizar entidade ${selectedEntityId}`
      : projectedEntityId
        ? `Criar entidade ${projectedEntityId}`
        : "Criar entidade na cena";
  const buildReadinessLabel = state.spritePath
    ? `Asset canonico pronto em ${state.spritePath}`
    : "Asset canonico pendente em assets/sprites";
  const applyNextStepLabel = !activeProjectDir
    ? "Abra um projeto antes de continuar."
    : !activeScene
      ? "Abra uma cena antes de aplicar na cena."
      : !state.spriteSheetUrl
        ? "Importe uma imagem para iniciar o preparo."
        : !state.spritePath
          ? "Gere primeiro o asset canonico em assets/sprites."
          : !hasValidAnimationFrames
            ? "Selecione frames em pelo menos uma sequencia."
            : canUpdateEntity && selectedEntityId
              ? `Pronto para atualizar ${selectedEntityId} na cena atual.`
              : projectedEntityId
                ? `Pronto para criar ${projectedEntityId} na cena atual.`
                : "Pronto para aplicar na cena atual.";

  useEffect(() => {
    return () => {
      if (saveFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(saveFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === " ") {
        setSpacePressed(true);
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === " ") {
        setSpacePressed(false);
      }
    }

    function handleMouseMove(event: MouseEvent) {
      if (!panStateRef.current || !stageScrollRef.current) {
        return;
      }

      const nextOffsets = getArtStudioPanOffsets({
        startX: panStateRef.current.startX,
        startY: panStateRef.current.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        scrollLeft: panStateRef.current.scrollLeft,
        scrollTop: panStateRef.current.scrollTop,
      });
      stageScrollRef.current.scrollLeft = nextOffsets.scrollLeft;
      stageScrollRef.current.scrollTop = nextOffsets.scrollTop;
    }

    function handleMouseUp() {
      panStateRef.current = null;
      setPanning(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
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

  const ingestSpriteSheet = useCallback(
    async (request: ArtStudioImageRequest) => {
      const sourcePath = request.sourcePath ?? (request.file ? resolveDroppedFilePath(request.file) : null);
      const sourceLabel = sourcePath ?? request.file?.name ?? "imagem";
      dispatch({ type: "START_SPRITE_LOAD", sourceLabel: basenameWithExtension(sourceLabel) });

      try {
        if (!sourcePath) {
          throw new Error(
            "O drag-and-drop atual nao expôs um caminho nativo. Use 'Importar imagem' para processar este arquivo com o backend do ArtStudio."
          );
        }

        const processed = await artProcessPalette(sourcePath);
        if (!processed.ok || !processed.processed_base64) {
          throw new Error(processed.error ?? "Falha ao processar a imagem no backend.");
        }

        const loaded = await loadArtStudioPreviewFromBase64(processed.processed_base64);

        const relativeAssetPath =
          activeProjectDir && sourcePath
            ? resolveArtStudioSpriteAssetPath(activeProjectDir, sourcePath)
            : null;
        const spriteName = basenameWithoutExtension(relativeAssetPath ?? sourcePath);
        const scope: ArtStudioSourceScope = relativeAssetPath ? "project" : "external";
        const message = relativeAssetPath
          ? "Imagem processada no backend, quantizada e pronta para slicing."
          : "Imagem processada no backend para preparo. Para aplicar na cena, mova ou copie o arquivo para assets/sprites.";

        const suggestedFrame = constrainSpriteFrameSize(
          activeTarget,
          relativeAssetPath ?? undefined,
          processed.suggested_frame_width ?? 32,
          processed.suggested_frame_height ?? 32
        );
        const recommendedOutput =
          processed.recommended_output_width &&
          processed.recommended_output_height &&
          processed.recommended_scale_percent
            ? {
                width: processed.recommended_output_width,
                height: processed.recommended_output_height,
                scalePercent: processed.recommended_scale_percent,
              }
            : null;

        dispatch({
          type: "LOAD_SPRITE",
          url: loaded.url,
          size: loaded.size,
          path: relativeAssetPath ?? "",
          name: spriteName,
          sourcePath,
          displayName: basenameWithExtension(sourcePath),
          format: processed.format ?? getArtStudioImageFormatLabel(sourcePath, request.file?.type),
          scope,
          zoom: getInitialSourceZoom(loaded.size),
          message,
          frameCount: processed.frame_count,
          backgroundMode: processed.background_mode,
          transparentPixels: processed.transparent_pixels,
          palette: processed.palette,
          warnings: processed.warnings,
          contentBounds: processed.content_bounds,
          recommendedOutput,
          metaSpriteCandidate: processed.meta_sprite_candidate,
          suggestedFrames: processed.suggested_frames,
          slicingMode: processed.slicing_mode,
          suggestedFrameWidth: suggestedFrame.frameWidth,
          suggestedFrameHeight: suggestedFrame.frameHeight,
        });

        imageRef.current = loaded.image;
        if (typeof stageScrollRef.current?.scrollTo === "function") {
          stageScrollRef.current.scrollTo({ left: 0, top: 0 });
        }
        logMessage(
          relativeAssetPath ? "success" : "info",
          `[ArtStudio] Imagem processada no backend: ${basenameWithExtension(sourcePath)} (${processed.format ?? "imagem"} ${loaded.size.width}x${loaded.size.height}, paleta ${processed.palette_size}/16).`
        );
      } catch (error) {
        const friendlyMessage = getArtStudioFriendlyError(sourceLabel, error);
        dispatch({ type: "LOAD_SPRITE_ERROR", message: friendlyMessage });
        logMessage(
          "error",
          `[ArtStudio] ${friendlyMessage} Detalhe tecnico: ${describeError(error)}`
        );
      }
    },
    [activeProjectDir, activeTarget, logMessage]
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

  const importCommandDatFromPath = useCallback(async (commandPath: string): Promise<number> => {
    const commands = await parseInputCommandFile(commandPath);
    dispatch({ type: "SET_COMMAND_LIBRARY", source: commandPath, commands });
    logMessage(
      commands.some((command) => command.unsupported_tokens.length > 0) ? "warn" : "success",
      `[ArtStudio] command.dat importado: ${commands.length} comando(s) de ${basenameWithExtension(commandPath)}.`
    );
    return commands.length;
  }, [logMessage]);

  const handleImportCommandDat = useCallback(async () => {
    try {
      const selected = await open({
        title: "Importar command.dat",
        filters: [{ name: "Command DAT", extensions: ["dat", "txt"] }],
      });
      if (!selected) {
        return;
      }
      const commandPath = typeof selected === "string" ? selected : selected[0];
      if (!commandPath) {
        return;
      }

      await importCommandDatFromPath(commandPath);
    } catch (error) {
      const message = `Falha ao importar command.dat: ${describeError(error)}`;
      dispatch({ type: "SET_VALIDATION_ERROR", message });
      logMessage("error", `[ArtStudio] ${message}`);
    }
  }, [importCommandDatFromPath, logMessage]);

  useEffect(() => {
    if (!selectedEntitySprite) {
      return;
    }
    const hasManualSequenceEdits = state.sequences.some((sequence) => {
      const defaults = DEFAULT_ARTSTUDIO_SEQUENCES.find((candidate) => candidate.id === sequence.id);
      if (!defaults) {
        return sequence.frames.length > 0;
      }
      return (
        sequence.frames.length > 0 &&
        (sequence.name !== defaults.name ||
          sequence.fps !== defaults.fps ||
          sequence.loop !== defaults.loop)
      );
    });
    const hasManualAuthoring =
      state.commandLibrary.length > 0 || hasManualSequenceEdits;
    if (hasManualAuthoring) {
      return;
    }
    dispatch({
      type: "HYDRATE_SPRITE_METADATA",
      sequences: buildArtStudioSequencesFromSpriteMetadata(selectedEntitySprite),
    });
  }, [selectedEntitySprite, state.commandLibrary.length, state.sequences.length]);

  useEffect(() => {
    if (!activeProjectDir || !selectedEntitySprite?.asset) {
      return;
    }
    const spriteAsset = selectedEntitySprite.asset.trim();
    if (!spriteAsset) {
      return;
    }
    if (
      autoHydratedSpriteRef.current === spriteAsset &&
      (state.spritePath === spriteAsset || state.spriteSourceAssetPath === spriteAsset)
    ) {
      return;
    }
    autoHydratedSpriteRef.current = spriteAsset;
    const absolutePath = normalizeFsPath(`${activeProjectDir}/${spriteAsset}`);
    void ingestSpriteSheet({
      sourcePath: absolutePath,
    }).then(() => {
      dispatch({
        type: "SET_IMPORTED_ASSET",
        path: spriteAsset,
        name: basenameWithoutExtension(spriteAsset),
        width: selectedEntitySprite.frame_width,
        height: selectedEntitySprite.frame_height,
      });
      logMessage(
        "info",
        `[ArtStudio] Entidade selecionada sincronizada automaticamente: ${spriteAsset}.`
      );
    }).catch((error) => {
      logMessage(
        "warn",
        `[ArtStudio] Nao foi possivel sincronizar sprite da entidade selecionada: ${describeError(error)}`
      );
    });
  }, [
    activeProjectDir,
    ingestSpriteSheet,
    logMessage,
    selectedEntitySprite,
    state.spritePath,
    state.spriteSourceAssetPath,
  ]);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
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

  const refreshSlicingSuggestions = useCallback(
    async (sourcePath: string, nextWidth: number, nextHeight: number) => {
      const requestId = processingRequestIdRef.current + 1;
      processingRequestIdRef.current = requestId;

      try {
        const processed = await artProcessPalette(sourcePath, {
          gridWidth: nextWidth,
          gridHeight: nextHeight,
          slicingMode: "grid",
        });

        if (processingRequestIdRef.current !== requestId || !processed.ok) {
          if (!processed.ok) {
            throw new Error(processed.error ?? "Falha ao atualizar slicing.");
          }
          return;
        }

        const constrained = constrainSpriteFrameSize(
          activeTarget,
          state.spritePath || state.spriteSourceAssetPath || undefined,
          processed.suggested_frame_width ?? nextWidth,
          processed.suggested_frame_height ?? nextHeight
        );
        const recommendedOutput =
          processed.recommended_output_width &&
          processed.recommended_output_height &&
          processed.recommended_scale_percent
            ? {
                width: processed.recommended_output_width,
                height: processed.recommended_output_height,
                scalePercent: processed.recommended_scale_percent,
              }
            : null;

        dispatch({
          type: "UPDATE_SLICING_SUGGESTIONS",
          frameWidth: constrained.frameWidth,
          frameHeight: constrained.frameHeight,
          suggestedFrames: processed.suggested_frames,
          warnings: processed.warnings,
          contentBounds: processed.content_bounds,
          recommendedOutput,
          slicingMode: processed.slicing_mode,
        });
      } catch (error) {
        const friendlyMessage = getArtStudioFriendlyError(sourcePath, error);
        dispatch({ type: "SET_VALIDATION_ERROR", message: friendlyMessage });
        logMessage(
          "error",
          `[ArtStudio] Falha ao recalcular slicing: ${friendlyMessage} Detalhe tecnico: ${describeError(error)}`
        );
      }
    },
    [activeTarget, logMessage, state.spritePath, state.spriteSourceAssetPath]
  );

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (
        !state.activeSequenceId ||
        !state.spriteSheetSize ||
        !canvasRef.current ||
        state.suggestedFrames.length === 0 ||
        spacePressed
      ) {
        return;
      }

      const rect = canvasRef.current.getBoundingClientRect();
      const cell = getSuggestedFrameIndex(
        rect,
        rect.width,
        rect.height,
        state.spriteSheetSize.width,
        state.spriteSheetSize.height,
        state.suggestedFrames,
        event.clientX,
        event.clientY
      );
      if (cell !== null) {
        dispatch({ type: "TOGGLE_FRAME", cellIndex: cell });
      }
    },
    [spacePressed, state.activeSequenceId, state.spriteSheetSize, state.suggestedFrames]
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

  const handleStageWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!state.spriteSheetSize || !stageScrollRef.current) {
        return;
      }

      event.preventDefault();
      const container = stageScrollRef.current;
      const rect = container.getBoundingClientRect();
      const nextState = getArtStudioWheelZoomState({
        clientX: event.clientX,
        clientY: event.clientY,
        deltaY: event.deltaY,
        rect,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
        sourceZoom: state.sourceZoom,
      });

      dispatch({ type: "SET_SOURCE_ZOOM", value: nextState.nextZoom });

      window.requestAnimationFrame(() => {
        container.scrollLeft = nextState.scrollLeft;
        container.scrollTop = nextState.scrollTop;
      });
    },
    [state.sourceZoom, state.spriteSheetSize]
  );

  const handleStageMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if ((!spacePressed && event.button !== 1) || !stageScrollRef.current) {
        return;
      }

      event.preventDefault();
      panStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: stageScrollRef.current.scrollLeft,
        scrollTop: stageScrollRef.current.scrollTop,
      };
      setPanning(true);
    },
    [spacePressed]
  );

  const applyConstrainedFrameSize = useCallback(
    (nextWidth: number, nextHeight: number) => {
      const constrained = constrainSpriteFrameSize(
        activeTarget,
        state.spritePath || state.spriteSourceAssetPath || undefined,
        nextWidth,
        nextHeight
      );
      dispatch({
        type: "SET_FRAME_SIZE",
        width: constrained.frameWidth,
        height: constrained.frameHeight,
      });
      if (state.spriteSheetSourcePath) {
        void refreshSlicingSuggestions(
          state.spriteSheetSourcePath,
          constrained.frameWidth,
          constrained.frameHeight
        );
      }
    },
    [activeTarget, refreshSlicingSuggestions, state.spritePath, state.spriteSheetSourcePath, state.spriteSourceAssetPath]
  );

  const handleApplyToScene = useCallback((forcedEntityId?: string): boolean => {
    const artState = artStudioStateRef.current;
    const editorState = useEditorStore.getState();
    const scene = editorState.activeScene;
    const targetEntityId = forcedEntityId ?? editorState.selectedEntityId ?? selectedEntityId;
    const targetEntity =
      scene?.entities.find((entity) => entity.entity_id === targetEntityId) ?? null;
    const targetSprite = targetEntity?.components?.sprite;
    const canUpdateTarget = Boolean(targetSprite);

    if (forcedEntityId && editorState.selectedEntityId !== forcedEntityId) {
      setSelectedEntityId(forcedEntityId);
    }

    if (forcedEntityId && !targetEntity) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: `Entidade '${forcedEntityId}' nao encontrada na cena ativa para aplicar o ArtStudio.`,
      });
      return false;
    }

    if (!activeProjectDir || !scene) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Abra um projeto e uma cena antes de aplicar dados do ArtStudio.",
      });
      return false;
    }
    if (!artState.spriteSheetUrl) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Carregue uma imagem antes de criar ou atualizar uma entidade.",
      });
      return false;
    }
    if (!artState.spritePath) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message:
          "Gere primeiro o asset canonico em assets/sprites para alinhar os frames com o pipeline oficial antes de aplicar na cena.",
      });
      return false;
    }
    if (artState.sequences.length === 0) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Adicione pelo menos uma sequencia antes de aplicar na cena.",
      });
      return false;
    }
    const hasValidFrames = artState.sequences.some((sequence) => sequence.frames.length > 0);
    if (!hasValidFrames) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Cada sequencia precisa ter pelo menos um frame selecionado.",
      });
      return false;
    }

    const constrainedFrame = constrainSpriteFrameSize(
      activeTarget,
      artState.spritePath,
      artState.frameWidth,
      artState.frameHeight
    );
    if (
      constrainedFrame.frameWidth > (artState.spriteSheetSize?.width ?? 0) ||
      constrainedFrame.frameHeight > (artState.spriteSheetSize?.height ?? 0)
    ) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "O frame precisa caber dentro do sprite sheet selecionado.",
      });
      return false;
    }

    const { animations, error } = buildArtStudioAnimations(artState.sequences);
    if (error) {
      dispatch({ type: "SET_VALIDATION_ERROR", message: error });
      return false;
    }
    const commandBindings = buildArtStudioCommandBindings(
      artState.sequences,
      artState.commandButtonProfile
    );
    const unsupportedCommand = commandBindings.find(
      (binding) => (binding.unsupported_tokens ?? []).length > 0
    );
    if (unsupportedCommand) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: `O comando '${unsupportedCommand.display_name}' tem tokens ainda nao suportados para runtime: ${(unsupportedCommand.unsupported_tokens ?? []).join(", ")}.`,
      });
      return false;
    }

    dispatch({ type: "SET_VALIDATION_ERROR", message: null });
    if (
      constrainedFrame.frameWidth !== artState.frameWidth ||
      constrainedFrame.frameHeight !== artState.frameHeight
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

    if (canUpdateTarget && targetEntityId && targetEntity) {
      const nextSprite = {
        ...targetSprite!,
        asset: artState.spritePath,
        frame_width: constrainedFrame.frameWidth,
        frame_height: constrainedFrame.frameHeight,
        animations,
        commands: commandBindings,
      };
      updateEntity(
        targetEntityId,
        {
          components: {
            sprite: nextSprite,
          },
        },
        { recordHistory: false }
      );

      const postUpdateSprite = useEditorStore
        .getState()
        .activeScene?.entities.find((entity) => entity.entity_id === targetEntityId)
        ?.components?.sprite;
      const attackApplied = Boolean(
        postUpdateSprite &&
          Object.prototype.hasOwnProperty.call(postUpdateSprite.animations ?? {}, "attack")
      );
      const commandsApplied = (postUpdateSprite?.commands?.length ?? 0) > 0;
      const assetApplied = postUpdateSprite?.asset === artState.spritePath;

      if (!attackApplied || !commandsApplied || !assetApplied) {
        useEditorStore.setState((store) => {
          if (!store.activeScene) {
            return {};
          }

          const patchEntity = (entity: (typeof store.activeScene.entities)[number]) =>
            entity.entity_id === targetEntityId
              ? {
                  ...entity,
                  components: {
                    ...entity.components,
                    sprite: nextSprite,
                  },
                }
              : entity;

          return {
            activeScene: {
              ...store.activeScene,
              entities: store.activeScene.entities.map(patchEntity),
            },
            ...(store.activeSceneSource
              ? {
                  activeSceneSource: {
                    ...store.activeSceneSource,
                    entities: store.activeSceneSource.entities.map(patchEntity),
                  },
                }
              : {}),
            sceneRevision: store.sceneRevision + 1,
          };
        });
      }

      logMessage("success", "[ArtStudio] Entidade atualizada com animacoes.");
    } else if (forcedEntityId) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: `Entidade '${forcedEntityId}' nao possui componente sprite para receber o fluxo ArtStudio.`,
      });
      return false;
    } else {
      const entity = createSpriteEntityFromAsset({
        assetPath: artState.spritePath,
        target: activeTarget,
        existingEntityIds: scene.entities.map((entity) => entity.entity_id),
        suggestedName: artState.spriteName,
        frameWidth: constrainedFrame.frameWidth,
        frameHeight: constrainedFrame.frameHeight,
        animations,
        commands: commandBindings,
      });
      addEntity(entity);
      setSelectedEntityId(entity.entity_id);
      logMessage("success", `[ArtStudio] Entidade '${entity.entity_id}' criada na cena.`);
    }

    dispatch({ type: "SHOW_SAVE_FEEDBACK" });
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current);
    }
    saveFeedbackTimeoutRef.current = window.setTimeout(() => {
      dispatch({ type: "HIDE_SAVE_FEEDBACK" });
    }, 2000);
    return true;
  }, [
    state.sequences,
    state.spritePath,
    state.spriteSheetUrl,
    state.frameWidth,
    state.frameHeight,
    state.spriteName,
    state.spriteSheetSize,
    state.commandButtonProfile,
    selectedEntityId,
    activeProjectDir,
    activeTarget,
    addEntity,
    setSelectedEntityId,
    updateEntity,
    logMessage,
  ]);

  const handleImportToProject = useCallback(async () => {
    if (!activeProjectDir) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Abra um projeto antes de gerar o asset canonico do ArtStudio.",
      });
      return;
    }
    if (!state.spriteSheetSourcePath) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        message: "Carregue uma imagem antes de importar para assets/sprites.",
      });
      return;
    }

    try {
      const imported = await importArtAsset(state.spriteSheetSourcePath, activeProjectDir, {
        spriteName: state.spriteName,
        gridWidth: state.frameWidth,
        gridHeight: state.frameHeight,
        slicingMode: state.slicingMode ?? "grid",
      });

      if (!imported.ok || !imported.relative_path) {
        throw new Error(imported.error ?? "Falha ao gerar asset canonico.");
      }

      const nextName =
        imported.sprite_name ?? basenameWithoutExtension(imported.relative_path);
      dispatch({
        type: "SET_IMPORTED_ASSET",
        path: imported.relative_path,
        name: nextName,
        width: imported.frame_width ?? state.frameWidth,
        height: imported.frame_height ?? state.frameHeight,
      });
      logMessage(
        "success",
        `[ArtStudio] Asset canonico gerado em ${imported.relative_path} com ${imported.frame_count} frame(s).`
      );
    } catch (error) {
      const message = getArtStudioFriendlyError(state.spriteSheetSourcePath, error);
      dispatch({ type: "SET_VALIDATION_ERROR", message });
      logMessage(
        "error",
        `[ArtStudio] Falha ao importar asset canonico: ${message} Detalhe tecnico: ${describeError(error)}`
      );
    }
  }, [
    activeProjectDir,
    logMessage,
    state.frameHeight,
    state.frameWidth,
    state.slicingMode,
    state.spriteName,
    state.spriteSheetSourcePath,
  ]);

  useEffect(() => {
    const automationEnabled =
      typeof window !== "undefined" &&
      (Boolean(window.__RDS_E2E__) ||
        "__TAURI_INTERNALS__" in window ||
        import.meta.env.DEV ||
        import.meta.env.MODE === "test");

    if (!automationEnabled) {
      delete window.__RDS_ARTSTUDIO_E2E__;
      return;
    }

    window.__RDS_ARTSTUDIO_E2E__ = {
      ingestSpriteSheet: async (sourcePath: string) => {
        await ingestSpriteSheet({ sourcePath });
        return true;
      },
      loadImage: async (sourcePath: string) => {
        await ingestSpriteSheet({ sourcePath });
        return true;
      },
      importToProject: async () => {
        await handleImportToProject();
        return Boolean(
          artStudioStateRef.current.spritePath?.startsWith("assets/sprites/")
        );
      },
      importCommandDat: importCommandDatFromPath,
      selectSequence: (sequenceId: string | null) => {
        dispatch({ type: "SELECT_SEQUENCE", id: sequenceId });
        return true;
      },
      renameSequence: (sequenceId: string, name: string) => {
        dispatch({ type: "RENAME_SEQUENCE", id: sequenceId, name });
        return true;
      },
      setFrameSize: (width: number, height: number) => {
        applyConstrainedFrameSize(width, height);
        return true;
      },
      setSequenceFrames: (sequenceId: string, frames: number[]) => {
        dispatch({ type: "SET_SEQUENCE_FRAMES", id: sequenceId, frames });
        return true;
      },
      assignCommand: (sequenceId: string, commandId: string) => {
        const latest = artStudioStateRef.current;
        const command = latest.commandLibrary.find((candidate) => candidate.id === commandId);
        if (!command) {
          return false;
        }
        if (!latest.sequences.some((sequence) => sequence.id === sequenceId)) {
          return false;
        }
        dispatch({ type: "ASSIGN_COMMAND_TO_SEQUENCE", sequenceId, command });
        return true;
      },
      applyToScene: (entityId?: string) => {
        if (entityId) {
          setSelectedEntityId(entityId);
        }

        let applied = false;
        flushSync(() => {
          applied = handleApplyToScene(entityId);
        });
        if (!applied) {
          return false;
        }

        const editor = useEditorStore.getState();
        const targetEntityId = entityId ?? editor.selectedEntityId;
        if (!targetEntityId || !editor.activeScene) {
          return false;
        }

        const entity = editor.activeScene.entities.find(
          (candidate) => candidate.entity_id === targetEntityId
        );
        const sprite = entity?.components?.sprite;
        const latestArtState = artStudioStateRef.current;
        if (!sprite || sprite.asset !== latestArtState.spritePath) {
          return false;
        }
        if (!Object.prototype.hasOwnProperty.call(sprite.animations ?? {}, "attack")) {
          return false;
        }
        if ((sprite.commands?.length ?? 0) < 1) {
          return false;
        }

        return true;
      },
      getState: () => {
        const latest = artStudioStateRef.current;
        return {
          spriteSheetLoadStatus: latest.spriteSheetLoadStatus,
          spriteSheetSourcePath: latest.spriteSheetSourcePath,
          spritePath: latest.spritePath,
          spriteName: latest.spriteName,
          frameWidth: latest.frameWidth,
          frameHeight: latest.frameHeight,
          activeSequenceId: latest.activeSequenceId,
          suggestedFrames: latest.suggestedFrames,
          sequences: latest.sequences.map((sequence) => ({
            ...sequence,
            frames: [...sequence.frames],
          })),
          canApplyToScene,
          validationError: latest.validationError,
        };
      },
    };

    return () => {
      delete window.__RDS_ARTSTUDIO_E2E__;
    };
  }, [
    canApplyToScene,
    handleApplyToScene,
    handleImportToProject,
    importCommandDatFromPath,
    ingestSpriteSheet,
    applyConstrainedFrameSize,
    state.commandLibrary.length,
    state.sequences.length,
    state.spritePath,
    state.validationError,
  ]);

  useEffect(() => {
    const constrained = constrainSpriteFrameSize(
      activeTarget,
      state.spritePath || state.spriteSourceAssetPath || undefined,
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
  }, [activeTarget, state.spritePath, state.spriteSourceAssetPath, state.frameWidth, state.frameHeight]);

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

    const fontSize = Math.max(
      10,
      Math.min(18, Math.floor(Math.min(state.frameWidth, state.frameHeight) / 2))
    );

    state.suggestedFrames.forEach((frame) => {
      ctx.strokeStyle = "rgba(249, 226, 175, 0.58)";
      ctx.lineWidth = 1;
      ctx.strokeRect(frame.x + 0.5, frame.y + 0.5, frame.width - 1, frame.height - 1);
    });

    if (activeSequence) {
      for (let order = 0; order < activeSequence.frames.length; order += 1) {
        const frame = state.suggestedFrames.find(
          (candidate) => candidate.index === activeSequence.frames[order]
        );
        if (!frame) {
          continue;
        }

        ctx.fillStyle = "rgba(96, 165, 250, 0.28)";
        ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
        ctx.strokeStyle = "rgba(191, 219, 254, 0.9)";
        ctx.lineWidth = 1;
        ctx.strokeRect(frame.x + 0.5, frame.y + 0.5, frame.width - 1, frame.height - 1);
        ctx.fillStyle = "#f9e2af";
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          String(order + 1),
          frame.x + frame.width / 2,
          frame.y + frame.height / 2
        );
      }
    }
  }, [state.spriteSheetSize, state.frameWidth, state.frameHeight, state.suggestedFrames, activeSequence]);

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
    const cellIndex = state.playing ? currentPreviewCell : activeSequence?.frames[0] ?? -1;
    const frame = state.suggestedFrames.find((candidate) => candidate.index === cellIndex);

    if (cellIndex < 0 || !frame) {
      return;
    }

    const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height, 5);
    const drawWidth = frame.width * scale;
    const drawHeight = frame.height * scale;
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;

    ctx.drawImage(
      image,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
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
    state.suggestedFrames,
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
  const displayPalette =
    state.spriteSheetPalette.length > 0 ? state.spriteSheetPalette : MEGA_DRIVE_PALETTE;

  const resOutput = `SPRITE ${state.spriteName || "sprite"} "${state.spritePath || "PENDENTE_IMPORTACAO"}" [${state.frameWidth}] [${state.frameHeight}] [${state.compression}]`;
  const contextValue = useMemo<ArtStudioContextValue>(
    () => ({
      state,
      dispatch,
      activeProjectDir,
      activeSequence,
      canUpdateEntity,
      canApplyToScene,
      totalFrameSlots,
      usedFrameCount,
      hardwareBudgetSummary,
      externalSourceLoaded,
      loadStatusText,
      sourceOriginLabel,
      displayPalette,
      resOutput,
      applyPlanLabel,
      buildReadinessLabel,
      applyNextStepLabel,
      previewCanvasRef,
      handleAddSequence,
      applyConstrainedFrameSize,
      handleImportCommandDat,
      handleImportToProject,
      handleApplyToScene,
    }),
    [
      state,
      activeProjectDir,
      activeSequence,
      canUpdateEntity,
      canApplyToScene,
      totalFrameSlots,
      usedFrameCount,
      hardwareBudgetSummary,
      externalSourceLoaded,
      loadStatusText,
      sourceOriginLabel,
      displayPalette,
      resOutput,
      applyPlanLabel,
      buildReadinessLabel,
      applyNextStepLabel,
      handleAddSequence,
      applyConstrainedFrameSize,
      handleImportCommandDat,
      handleImportToProject,
      handleApplyToScene,
    ]
  );

  return (
    <ArtStudioContext.Provider value={contextValue}>
      <div className="flex h-full flex-col gap-2 bg-[#0b0f19]">
      <div className="mx-3 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#313244]/80 bg-[#111827]/90 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full border border-[#fab387]/35 bg-[#fab387]/12 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#fab387]">
            Experimental
          </span>
          <span className="truncate text-[11px] font-semibold text-[#e2e8f0]">Art Studio</span>
          <span className="hidden text-[10px] text-[#94a3b8] sm:inline">
            ingestao · slicing · animacao
          </span>
        </div>
        <span className="text-[10px] text-[#6c7086]">{ARTSTUDIO_SUPPORTED_FORMATS_LABEL}</span>
      </div>

      {selectedEntity && selectedEntitySprite ? (
        <div
          data-testid="artstudio-scene-context-bridge"
          className="mx-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-3 py-2 text-[11px] text-[#cdd6f4]"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#89b4fa]">
              Scene -&gt; Art
            </p>
            <p className="mt-1 truncate">
              <span className="font-semibold text-[#fff]">{getEntityDisplayName(selectedEntity)}</span>
              <span className="text-[#6c7086]"> · </span>
              <span className="font-mono text-[#94a3b8]">{selectedEntity.entity_id}</span>
              <span className="text-[#6c7086]"> · </span>
              <span className="font-mono text-[#a6e3a1]">{selectedEntitySprite.asset}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              type="button"
              onClick={returnToSceneWithSelectedContext}
              className="rounded-lg border border-[#94e2d5]/45 bg-[#94e2d5]/12 px-3 py-1.5 text-[10px] font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/22"
            >
              Voltar para Cena
            </button>
            <button
              type="button"
              data-testid="artstudio-apply-selected-entity"
              onClick={() => {
                handleApplyToScene();
              }}
              disabled={!canApplyToScene}
              className="rounded-lg border border-[#a6e3a1]/45 bg-[#a6e3a1]/12 px-3 py-1.5 text-[10px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/22 disabled:cursor-not-allowed disabled:opacity-40"
              title={canApplyToScene ? "Aplicar sprite/animacoes na entidade selecionada" : applyNextStepLabel}
            >
              Aplicar nesta entidade
            </button>
          </div>
        </div>
      ) : null}

      {selectedEntity && !selectedEntitySprite ? (
        <div
          data-testid="artstudio-no-sprite-context"
          className="mx-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#fab387]/40 bg-[#fab387]/10 px-3 py-2 text-[11px] text-[#fde68a]"
        >
          <p className="min-w-0 flex-1">
            A entidade <span className="font-semibold text-[#fff]">{getEntityDisplayName(selectedEntity)}</span> nao
            tem <span className="font-mono">sprite</span>. O Art Studio trabalha com folhas de sprite; selecione um
            sprite na Hierarchy ou volte à cena para escolher outra entidade.
          </p>
          <button
            type="button"
            onClick={returnToSceneWithSelectedContext}
            className="shrink-0 rounded-lg border border-[#94e2d5]/50 bg-[#94e2d5]/15 px-3 py-1.5 text-[10px] font-semibold text-[#94e2d5] hover:bg-[#94e2d5]/25"
          >
            Ir para Cena
          </button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Group
          orientation="vertical"
          className="min-h-0"
        >
          <Panel minSize={52} defaultSize={78}>
            <section
          data-testid="artstudio-main-stage"
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]"
        >
          <div className="border-b border-[#1f2937] px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                  Source Stage
                </p>
                <h3 className="mt-1 text-sm font-semibold text-[#e2e8f0]">Canvas de origem</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportCommandDat}
                  className="rounded-xl border border-[#94e2d5]/45 bg-[#94e2d5]/12 px-3 py-2 text-xs font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/22"
                >
                  Importar command.dat
                </button>
                <button
                  type="button"
                  onClick={handleLoadSpriteSheet}
                  className="rounded-xl border border-[#f9e2af]/50 bg-[#f9e2af]/14 px-4 py-2 text-xs font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/22"
                >
                  Importar imagem
                </button>
              </div>
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

            <div className="grid gap-3 grid-cols-1">
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
                  <div>
                    <div className="font-semibold uppercase tracking-[0.18em] text-[#cbd5e1]">
                      Canvas de origem
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[#94a3b8]">
                      <span
                        className="rounded-full border border-[#1f2937] bg-[#0b1120] px-2 py-0.5"
                        title="Role para aproximar ou afastar"
                      >
                        Zoom wheel
                      </span>
                      <span
                        className="rounded-full border border-[#1f2937] bg-[#0b1120] px-2 py-0.5"
                        title="Segure espaco e arraste para mover o stage"
                      >
                        Space + drag
                      </span>
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

                <div
                  ref={stageScrollRef}
                  className={`min-h-0 flex-1 overflow-auto px-4 py-4 ${
                    panning ? "cursor-grabbing" : spacePressed ? "cursor-grab" : ""
                  }`}
                  onMouseDown={handleStageMouseDown}
                  onWheel={handleStageWheel}
                  title="Scroll: zoom. Espaço + arraste: pan."
                >
                  {state.spriteSheetUrl && state.spriteSheetSize ? (
                    <div className="inline-flex min-h-full min-w-full items-center justify-center">
                      <canvas
                        ref={canvasRef}
                        data-testid="artstudio-source-canvas"
                        className={`${spacePressed ? "" : "cursor-crosshair "}rounded-lg shadow-[0_14px_40px_rgba(0,0,0,0.35)]`}
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
                      <div className="rounded-2xl border border-[#7dd3fc]/25 bg-[#0f172a]/80 px-6 py-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                          Stage vazio
                        </div>
                        <p className="mt-3 max-w-xl text-[12px] leading-6 text-[#94a3b8]">
                          Importe uma imagem ou solte um arquivo para abrir o sprite sheet.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </section>
          </Panel>
          <LayoutSplitter orientation="vertical" />
          <Panel minSize={18} defaultSize={22}>
            <ArtStudioTimelineSection />
          </Panel>
        </Group>

        <ArtStudioInspectorSection />
      </div>
      </div>
    </ArtStudioContext.Provider>
  );
}
