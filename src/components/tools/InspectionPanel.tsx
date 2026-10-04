import { useEffect, useMemo, useRef, useState } from "react";

import {
  type InspectionCandidate,
  type InspectionCatalogPage,
  type InspectionPreview,
  type InspectionProgress,
  type InspectionRun,
  type InspectionSession,
  type InspectionSpriteFrame,
  inspectionCancel,
  inspectionCatalogPage,
  inspectionEditSonicDuration,
  inspectionEditSonicPalette,
  inspectionEditSonicSequence,
  inspectionEditSonicTiles,
  type InspectionPixelEdit,
  inspectionListSessions,
  inspectionOpen,
  inspectionPreview,
  inspectionReopen,
  inspectionRestoreSonicSequence,
  inspectionSave,
  inspectionSavePaletteChoice,
  inspectionSonicCadence,
  inspectionSonicSequence,
  inspectionSpriteFrame,
  inspectionStatus,
  inspectionStart,
  listenInspectionProgress,
  patchApplyBps,
  patchCreateBps,
  type SonicCadenceInfo,
  type SonicSequenceInfo,
} from "../../core/ipc/toolsService";
import {
  emulatorGetCoreEpoch,
  emulatorLoadRom,
  emulatorObserve,
  emulatorRunFrames,
  emulatorSendInput,
  JOYPAD_DEFAULT,
  type EmulatorObservationResult,
} from "../../core/ipc/emulatorService";
import { useEditorStore } from "../../core/store/editorStore";
import ToolPathField from "./ToolPathField";
import SonicPixelEditor from "./SonicPixelEditor";

interface InspectionPanelProps {
  logMessage: (level: "info" | "success" | "warn" | "error", message: string) => void;
}

const PAGE_SIZE = 24;
const SONIC_BOOT_START_FRAME = 900;
const SONIC_BOOT_FRAME_BUDGET = 1_200;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function hex(value: number, width = 6): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function cadenceThumbId(byte: number): string {
  return `sonic1_sonic/anim-${byte.toString(16).padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  return {
    identified: "Base identificada",
    running: "Análise em andamento",
    completed: "Análise concluída",
    cancelled: "Análise cancelada",
    failed: "Análise falhou",
  }[status] ?? status;
}

// E2-7 (EXPECTATIONS-VISUAL-ETAPA2): "Parar" na Game View desmonta este painel
// (InspectionPanel voltava a zero porque a sessão era useState local). A sessão
// viva passa a sobreviver ao desmonte nesta cache de módulo, verificada contra
// o núcleo ao remontar; localStorage só alimenta o banner de retomada pós-restart.
const RESUME_SESSION_KEY = "rds.inspection.lastSessionId";
const RESUME_ROM_KEY = "rds.inspection.lastRomPath";

type InspectionLiveCache = {
  session: InspectionSession;
  spriteFrameId: string;
  spriteFrame: InspectionSpriteFrame | null;
  savedAt: number | null;
};

let liveInspectionCache: InspectionLiveCache | null = null;

export function __resetInspectionPanelSessionCacheForTests() {
  liveInspectionCache = null;
  try {
    window.localStorage.removeItem(RESUME_SESSION_KEY);
    window.localStorage.removeItem(RESUME_ROM_KEY);
  } catch {
    /* jsdom sem storage */
  }
}

function readResumeHint(): { sessionId: string; romPath: string } | null {
  try {
    const sessionId = window.localStorage.getItem(RESUME_SESSION_KEY) ?? "";
    const romPath = window.localStorage.getItem(RESUME_ROM_KEY) ?? "";
    return sessionId && romPath ? { sessionId, romPath } : null;
  } catch {
    return null;
  }
}

export default function InspectionPanel({ logMessage }: InspectionPanelProps) {
  const activeProjectDir = useEditorStore((state) => state.activeProjectDir);
  const requestEmulatorLaunch = useEditorStore((state) => state.requestEmulatorLaunch);
  const consoleVisible = useEditorStore((state) => state.consoleVisible);
  const [romPath, setRomPath] = useState("");
  const [session, setSession] = useState<InspectionSession | null>(null);
  const [run, setRun] = useState<InspectionRun | null>(null);
  const [page, setPage] = useState<InspectionCatalogPage | null>(null);
  const [palettePage, setPalettePage] = useState<InspectionCatalogPage | null>(null);
  const [selected, setSelected] = useState<InspectionCandidate | null>(null);
  const [preview, setPreview] = useState<InspectionPreview | null>(null);
  const [spriteFrame, setSpriteFrame] = useState<InspectionSpriteFrame | null>(null);
  const [spriteFrameId, setSpriteFrameId] = useState("spr_ryo_100/frame-0");
  const [spriteFrameBusy, setSpriteFrameBusy] = useState(false);
  const [sonicFrames, setSonicFrames] = useState<NonNullable<InspectionSpriteFrame["sonic_context"]>["frames"]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [pageOffset, setPageOffset] = useState(0);
  const [selectedPalette, setSelectedPalette] = useState("");
  const [savedSessions, setSavedSessions] = useState<InspectionSession[]>([]);
  const [savedSessionsBusy, setSavedSessionsBusy] = useState(false);
  const [selectedSavedSessionId, setSelectedSavedSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [identifyState, setIdentifyState] = useState<"idle" | "running" | "succeeded" | "failed">("idle");
  const [identifyInput, setIdentifyInput] = useState("");
  const [identifyError, setIdentifyError] = useState("");
  const [editPaletteIndex, setEditPaletteIndex] = useState(1);
  const [tileEditRect, setTileEditRect] = useState({ x: 10, y: 14, w: 12, h: 8 });
  const [tileEditIndex, setTileEditIndex] = useState(14);
  const [tileEditAllowShared, setTileEditAllowShared] = useState(false);
  const [editRed, setEditRed] = useState(7);
  const [editGreen, setEditGreen] = useState(7);
  const [editBlue, setEditBlue] = useState(7);
  const [editBusy, setEditBusy] = useState(false);
  const [cadence, setCadence] = useState<SonicCadenceInfo | null>(null);
  const [cadenceValue, setCadenceValue] = useState<number | "">("");
  const [cadenceBusy, setCadenceBusy] = useState(false);
  const [cadenceError, setCadenceError] = useState("");
  const [cadenceThumbs, setCadenceThumbs] = useState<Record<string, InspectionSpriteFrame>>({});
  const [cadencePlaying, setCadencePlaying] = useState(false);
  const [cadenceTick, setCadenceTick] = useState(0);
  const [sequence, setSequence] = useState<SonicSequenceInfo | null>(null);
  const [sequenceProposal, setSequenceProposal] = useState<number[] | null>(null);
  const [sequenceSelected, setSequenceSelected] = useState<number | null>(null);
  const [sequenceBusy, setSequenceBusy] = useState(false);
  const [sequenceError, setSequenceError] = useState("");
  const [sequenceMessage, setSequenceMessage] = useState("");
  const [sequenceThumbs, setSequenceThumbs] = useState<Record<string, InspectionSpriteFrame>>({});
  const [emulatorObservation, setEmulatorObservation] = useState<EmulatorObservationResult | null>(null);
  const [emulatorObservationLabel, setEmulatorObservationLabel] = useState("");
  const [emulatorObservationHistory, setEmulatorObservationHistory] = useState<Array<{ label: string; observation: EmulatorObservationResult }>>([]);
  const [emulatorFrameBudget, setEmulatorFrameBudget] = useState(SONIC_BOOT_FRAME_BUDGET);
  const [emulatorInputProfile, setEmulatorInputProfile] = useState<"sonic-boot-start" | "neutral">("sonic-boot-start");
  const emulatorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [patchPath, setPatchPath] = useState("");
  const [patchedRomPath, setPatchedRomPath] = useState("");
  const [patchBusy, setPatchBusy] = useState(false);
  const [originalFrame, setOriginalFrame] = useState<InspectionSpriteFrame | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(() => liveInspectionCache?.savedAt ?? null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [paletteMessage, setPaletteMessage] = useState("");
  const [tileMessage, setTileMessage] = useState("");
  const [patchMessage, setPatchMessage] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [composeMessage, setComposeMessage] = useState("");
  const [resumeHint, setResumeHint] = useState<{ sessionId: string; romPath: string } | null>(null);
  const generation = useRef(0);
  const lastSessionId = useRef("");
  const savedSessionId = useRef("");
  const sessionRef = useRef<InspectionSession | null>(null);
  const selectedRef = useRef<InspectionCandidate | null>(null);
  const queryRef = useRef("");
  const kindRef = useRef("");
  const catalogRequestSeq = useRef(0);
  const previewRequestSeq = useRef(0);
  const editRequestSeq = useRef(0);
  const sessionRequestSeq = useRef(0);
  const statusRequestSeq = useRef(0);
  const savedSessionsRequestSeq = useRef(0);
  const cadenceRequestSeq = useRef(0);
  const cadenceEditSeq = useRef(0);
  const sequenceRequestSeq = useRef(0);
  const sequenceEditSeq = useRef(0);
  const originalRequestSeq = useRef(0);
  const progressListener = useRef<{ sessionId: string; generation: number; unlisten?: () => void } | null>(null);
  const bufferedProgress = useRef(new Map<string, InspectionProgress>());

  const palettes = palettePage?.candidates ?? [];
  const selectedChoice = useMemo(
    () => page?.user_choices.find((choice) => choice.tile_candidate_id === selected?.id),
    [page?.user_choices, selected?.id]
  );

  function invalidateAsyncRequests() {
    catalogRequestSeq.current += 1;
    previewRequestSeq.current += 1;
    statusRequestSeq.current += 1;
    bufferedProgress.current.clear();
    progressListener.current?.unlisten?.();
    progressListener.current = null;
    editRequestSeq.current += 1;
    setEditBusy(false);
    setSpriteFrameBusy(false);
    setSonicFrames([]);
    setSpriteFrame(null);
    cadenceRequestSeq.current += 1;
    cadenceEditSeq.current += 1;
    setCadence(null);
    setCadenceThumbs({});
    setCadenceBusy(false);
    setCadenceError("");
    setCadencePlaying(false);
    setCadenceTick(0);
    sequenceRequestSeq.current += 1;
    sequenceEditSeq.current += 1;
    setSequence(null);
    setSequenceProposal(null);
    setSequenceSelected(null);
    setSequenceThumbs({});
    setSequenceBusy(false);
    setSequenceError("");
    setSequenceMessage("");
  }

  function applyProgress(progress: InspectionProgress) {
    const key = `${progress.session_id}:${progress.generation}`;
    bufferedProgress.current.set(key, progress);
    if (sessionRef.current?.session_id !== progress.session_id || generation.current !== progress.generation) return;
    setRun((current) => {
      if (!current || current.run_id !== progress.run_id) return current;
      return {
        ...current,
        status: progress.status === "running" ? current.status : progress.status,
        progress,
      };
    });
    if (progress.status !== "running") void reconcileStatus(progress.session_id, progress.generation);
  }

  async function installProgressListener(sessionId: string, expectedGeneration: number) {
    invalidateAsyncRequests();
    const registration: { sessionId: string; generation: number; unlisten?: () => void } = { sessionId, generation: expectedGeneration };
    progressListener.current = registration;
    const cleanup = await listenInspectionProgress(applyProgress);
    if (progressListener.current === registration) {
      registration.unlisten = cleanup;
    } else {
      cleanup();
    }
  }

  async function reconcileStatus(sessionId: string, expectedGeneration: number) {
    const requestId = ++statusRequestSeq.current;
    try {
      const status = await inspectionStatus(sessionId);
      if (requestId !== statusRequestSeq.current || sessionRef.current?.session_id !== sessionId || generation.current !== expectedGeneration) return;
      sessionRef.current = status.session;
      setSession(status.session);
      setSpriteFrameId(status.session.sprite_frame_id ?? "spr_ryo_100/frame-0");
      const nextRun = status.run && status.run.generation === expectedGeneration ? status.run : null;
      if (nextRun) {
        const buffered = bufferedProgress.current.get(`${sessionId}:${expectedGeneration}`);
        setRun(buffered && buffered.run_id === nextRun.run_id ? { ...nextRun, status: buffered.status === "running" ? nextRun.status : buffered.status, progress: buffered } : nextRun);
        if (nextRun.status !== "running" || status.session.status === "completed") void refreshCatalog(sessionId, 0, queryRef.current, kindRef.current);
      }
    } catch (error) {
      logMessage("error", `[Inspeção] Falha ao reconciliar estado: ${describeError(error)}`);
    }
  }

  async function refreshSavedSessions() {
    const requestId = ++savedSessionsRequestSeq.current;
    setSavedSessionsBusy(true);
    try {
      const next = await inspectionListSessions();
      if (requestId === savedSessionsRequestSeq.current) setSavedSessions(next);
    } catch (error) {
      logMessage("error", `[Inspeção] Falha ao listar sessões salvas: ${describeError(error)}`);
    } finally {
      if (requestId === savedSessionsRequestSeq.current) setSavedSessionsBusy(false);
    }
  }

  useEffect(() => {
    void refreshSavedSessions();
    const cached = liveInspectionCache;
    const requestId = ++sessionRequestSeq.current;
    if (cached) {
      void (async () => {
        try {
          const status = await inspectionStatus(cached.session.session_id);
          if (requestId !== sessionRequestSeq.current) return;
          if (status.session.identity.normalized_sha256 !== cached.session.identity.normalized_sha256
            || status.session.status !== "completed") {
            setResumeHint(readResumeHint());
            return;
          }
          sessionRef.current = status.session;
          setSession(status.session);
          setRomPath(status.session.rom_path);
          setSpriteFrameId(cached.spriteFrameId);
          setSpriteFrame(cached.spriteFrame);
          setPatchedRomPath(status.session.edit?.modified_rom_path ?? "");
          void refreshCatalog(status.session.session_id, 0);
        } catch {
          if (requestId === sessionRequestSeq.current) setResumeHint(readResumeHint());
        }
      })();
    } else {
      setResumeHint(readResumeHint());
    }
    return () => {
      sessionRequestSeq.current += 1;
      catalogRequestSeq.current += 1;
      previewRequestSeq.current += 1;
      statusRequestSeq.current += 1;
      savedSessionsRequestSeq.current += 1;
      progressListener.current?.unlisten?.();
      progressListener.current = null;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    liveInspectionCache = { session, spriteFrameId, spriteFrame, savedAt };
    try {
      window.localStorage.setItem(RESUME_SESSION_KEY, session.session_id);
      window.localStorage.setItem(RESUME_ROM_KEY, session.rom_path);
    } catch {
      /* storage indisponível: retomada segue só na instância viva */
    }
  }, [session, spriteFrameId, spriteFrame, savedAt]);

  useEffect(() => {
    const canvas = emulatorCanvasRef.current;
    const observation = emulatorObservation;
    if (!canvas || !observation?.ok || observation.framebuffer_width <= 0 || observation.framebuffer_height <= 0) return;
    canvas.width = observation.framebuffer_width;
    canvas.height = observation.framebuffer_height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(observation.framebuffer_rgba),
        observation.framebuffer_width,
        observation.framebuffer_height,
      ),
      0,
      0,
    );
  }, [emulatorObservation]);

  useEffect(() => {
    const sessionId = session?.session_id;
    if (!sessionId || session?.status !== "completed") return;
    if (!spriteFrameId.startsWith("sonic1_sonic/")) return;
    void loadCadence(sessionId);
    void loadSequence(sessionId);
  }, [session?.session_id, session?.status, spriteFrameId.startsWith("sonic1_sonic/")]);

  // E2-3: o "Original" só existe quando há edições na cópia; vem do mesmo
  // pipeline canônico com from_base=true — nenhuma reimplementação no front.
  useEffect(() => {
    const sessionId = session?.session_id;
    const request = ++originalRequestSeq.current;
    if (!sessionId || !session?.edit || !spriteFrameId.startsWith("sonic1_sonic/")) {
      setOriginalFrame(null);
      return;
    }
    void (async () => {
      try {
        const base = await inspectionSpriteFrame(sessionId, "sonic1_sonic", spriteFrameId, false, false, true);
        if (request !== originalRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
        if (base.resource_id !== "sonic1_sonic" || base.frame_id !== spriteFrameId) return;
        setOriginalFrame(base);
      } catch {
        if (request === originalRequestSeq.current) setOriginalFrame(null);
      }
    })();
  }, [session?.session_id, session?.status, session?.edit?.modified_rom_sha256, spriteFrameId]);

  useEffect(() => {
    if (!spriteFrameId.startsWith("sonic1_sonic/")) {
      setCadencePlaying(false);
      setCadenceTick(0);
    }
  }, [spriteFrameId]);

  useEffect(() => {
    if (!cadencePlaying || !cadence) return;
    const timer = window.setInterval(() => setCadenceTick((tick) => tick + 1), 1000 / 60);
    return () => window.clearInterval(timer);
  }, [cadencePlaying, cadence]);

  async function refreshCatalog(sessionId: string, offset: number, nextQuery = queryRef.current, nextKind = kindRef.current) {
    const requestId = ++catalogRequestSeq.current;
    try {
      const [nextPage, nextPalettes] = await Promise.all([
        inspectionCatalogPage(sessionId, offset, PAGE_SIZE, nextQuery, nextKind),
        inspectionCatalogPage(sessionId, 0, PAGE_SIZE, "", "palettes"),
      ]);
      if (requestId !== catalogRequestSeq.current || sessionRef.current?.session_id !== sessionId || queryRef.current !== nextQuery || kindRef.current !== nextKind) return;
      setPage(nextPage);
      setPalettePage(nextPalettes);
    } catch (error) {
      if (requestId !== catalogRequestSeq.current) return;
      logMessage("error", `[Inspeção] Falha ao carregar catálogo: ${describeError(error)}`);
    }
  }

  async function identify() {
    const effectiveRomPath = romPath.trim();
    if (!effectiveRomPath) {
      setIdentifyState("failed");
      setIdentifyInput("");
      setIdentifyError("rom_path_empty");
      logMessage("warn", "[Inspeção] Selecione uma ROM BYOR.");
      return;
    }
    const requestId = ++sessionRequestSeq.current;
    invalidateAsyncRequests();
    setBusy(true);
    setIdentifyState("running");
    setIdentifyInput(effectiveRomPath);
    setIdentifyError("");
    try {
      const next = await inspectionOpen(effectiveRomPath);
      if (requestId !== sessionRequestSeq.current) return;
      generation.current += 1;
      lastSessionId.current = next.session_id;
      savedSessionId.current = next.session_id;
      sessionRef.current = next;
      selectedRef.current = null;
      setSession(next);
      setSpriteFrameId(next.sprite_frame_id ?? "spr_ryo_100/frame-0");
      setRun(null);
      setPage(null);
      setSelected(null);
      setPreview(null);
      setSelectedSavedSessionId(next.session_id);
      setIdentifyState("succeeded");
      if (next.status === "completed") void refreshCatalog(next.session_id, 0, queryRef.current, kindRef.current);
      void refreshSavedSessions();
      logMessage("success", `[Inspeção] ${next.identity.variant} identificado (${next.identity.header_title || "sem título"}).`);
    } catch (error) {
      setIdentifyState("failed");
      setIdentifyError(describeError(error));
      logMessage("error", `[Inspeção] Não foi possível identificar a ROM: ${describeError(error)}`);
    } finally {
      if (requestId === sessionRequestSeq.current) setBusy(false);
    }
  }

  async function reopen(romPathOverride?: string, sessionIdOverride?: string): Promise<boolean> {
    const id = sessionIdOverride || session?.session_id || savedSessionId.current || lastSessionId.current;
    const effectiveRomPath = (romPathOverride ?? romPath).trim();
    if (!id || !effectiveRomPath) return false;
    const requestId = ++sessionRequestSeq.current;
    invalidateAsyncRequests();
    setBusy(true);
    try {
      const next = await inspectionReopen(effectiveRomPath, id);
      if (requestId !== sessionRequestSeq.current) return false;
      sessionRef.current = next;
      savedSessionId.current = next.session_id;
      setSelectedSavedSessionId(next.session_id);
      setSession(next);
      setSpriteFrameId(next.sprite_frame_id ?? "spr_ryo_100/frame-0");
      setRun(null);
      setPatchedRomPath(next.edit?.modified_rom_path ?? "");
      setSessionMessage(`Sessão ${next.session_id} reaberta e identidade verificada.`);
      if (next.status === "completed") await refreshCatalog(next.session_id, 0);
      logMessage("success", `[Inspeção] Sessão ${id} reaberta e identidade verificada.`);
      return true;
    } catch (error) {
      setSessionMessage(`Reabertura recusada: ${describeError(error)} Verifique o caminho da ROM base e tente "Reabrir sessão" novamente.`);
      logMessage("error", `[Inspeção] Reabertura recusada: ${describeError(error)}`);
      return false;
    } finally {
      if (requestId === sessionRequestSeq.current) setBusy(false);
    }
  }

  async function resumeFromBanner() {
    if (!resumeHint) return;
    setSessionMessage("");
    setRomPath(resumeHint.romPath);
    savedSessionId.current = resumeHint.sessionId;
    lastSessionId.current = resumeHint.sessionId;
    setSelectedSavedSessionId(resumeHint.sessionId);
    const resumed = await reopen(resumeHint.romPath, resumeHint.sessionId);
    if (resumed) setResumeHint(null);
  }

  async function start() {
    if (!session) return;
    setBusy(true);
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    try {
      await installProgressListener(session.session_id, nextGeneration);
      const nextRun = await inspectionStart(session.session_id, nextGeneration);
      const status = await inspectionStatus(session.session_id);
      if (sessionRef.current?.session_id !== session.session_id || generation.current !== nextGeneration) return;
      const reconciled = status.run?.run_id === nextRun.run_id ? status.run : nextRun;
      const buffered = bufferedProgress.current.get(`${session.session_id}:${nextGeneration}`);
      const effectiveRun = buffered && buffered.run_id === reconciled.run_id ? { ...reconciled, status: buffered.status === "running" ? reconciled.status : buffered.status, progress: buffered } : reconciled;
      sessionRef.current = status.session;
      setSession(status.session);
      setRun(effectiveRun);
      setPage(null);
      if (effectiveRun.status !== "running" || status.session.status === "completed") void refreshCatalog(session.session_id, 0, queryRef.current, kindRef.current);
      logMessage("info", "[Inspeção] Descoberta iniciada fora da thread da UI.");
    } catch (error) {
      invalidateAsyncRequests();
      logMessage("error", `[Inspeção] Falha ao iniciar descoberta: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!session || !run) return;
    try {
      setRun(await inspectionCancel(session.session_id, run.run_id));
    } catch (error) {
      logMessage("error", `[Inspeção] Falha ao cancelar: ${describeError(error)}`);
    }
  }

  async function choose(candidate: InspectionCandidate) {
    const requestId = ++previewRequestSeq.current;
    const sessionId = sessionRef.current?.session_id;
    selectedRef.current = candidate;
    setSelected(candidate);
    setPreview(null);
    if (!sessionId) return;
    try {
      const nextPreview = await inspectionPreview(sessionId, candidate.id);
      if (requestId !== previewRequestSeq.current || sessionRef.current?.session_id !== sessionId || selectedRef.current?.id !== candidate.id) return;
      setPreview(nextPreview);
    } catch (error) {
      if (sessionRef.current?.session_id !== sessionId || selectedRef.current?.id !== candidate.id) return;
      logMessage("error", `[Inspeção] Prévia recusada: ${describeError(error)}`);
    }
  }

  async function composeSpriteFrame(requestedFrameId = spriteFrameId) {
    const sessionId = sessionRef.current?.session_id;
    if (!sessionId) return;
    const resourceId = requestedFrameId.split("/", 1)[0] || "spr_ryo_100";
    const requestId = ++previewRequestSeq.current;
    setSpriteFrame(null);
    setSpriteFrameBusy(true);
    try {
      const next = await inspectionSpriteFrame(sessionId, resourceId, requestedFrameId, false, false);
      if (requestId !== previewRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
      if (next.resource_id !== resourceId || next.frame_id !== requestedFrameId) {
        throw new Error(`Resposta de composição incompatível: esperado ${requestedFrameId}, recebido ${next.resource_id}/${next.frame_id}`);
      }
      setSpriteFrame(next);
      if (next.sonic_context) setSonicFrames(next.sonic_context.frames);
      setComposeMessage(`Frame ${requestedFrameId} composto e verificado contra os bytes da cópia ${next.rom_sha256}.`);
      logMessage("success", `[Inspeção] Frame composto ${resourceId} verificado contra bytes e metadado doador.`);
    } catch (error) {
      if (requestId !== previewRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
      setComposeMessage(`Composição recusada: ${describeError(error)} A base original não foi tocada.`);
      logMessage("error", `[Inspeção] Composição de sprite recusada: ${describeError(error)}`);
    } finally {
      if (requestId === previewRequestSeq.current) setSpriteFrameBusy(false);
    }
  }

  async function loadCadence(sessionId: string) {
    const request = ++cadenceRequestSeq.current;
    setCadenceBusy(true);
    setCadenceError("");
    try {
      const info = await inspectionSonicCadence(sessionId);
      if (request !== cadenceRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
      setCadence(info);
      setCadenceValue(info.current_interval);
      const thumbs: Record<string, InspectionSpriteFrame> = {};
      for (const byte of [...new Set(info.frames)]) {
        const frameId = cadenceThumbId(byte);
        const frame = await inspectionSpriteFrame(sessionId, "sonic1_sonic", frameId, false, false);
        if (request !== cadenceRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
        if (frame.resource_id !== "sonic1_sonic" || frame.frame_id !== frameId) {
          throw new Error(`Resposta de composição incompatível: esperado ${frameId}, recebido ${frame.resource_id}/${frame.frame_id}`);
        }
        thumbs[frameId] = frame;
      }
      setCadenceThumbs(thumbs);
    } catch (error) {
      if (request === cadenceRequestSeq.current && sessionRef.current?.session_id === sessionId) {
        setCadenceError(`Contrato de cadência indisponível: ${describeError(error)} Reabra a sessão ou tente novamente.`);
      }
    } finally {
      if (request === cadenceRequestSeq.current) setCadenceBusy(false);
    }
  }

  async function applyCadence(nextValue: number, purpose: "apply" | "restore") {
    const current = sessionRef.current;
    if (!current || !cadence) return;
    if (!Number.isInteger(nextValue) || nextValue < cadence.editable_min || nextValue > cadence.editable_max) {
      setCadenceError(
        `Valor ${String(nextValue)} fora do intervalo comprovado (${cadence.editable_min}–${cadence.editable_max} ticks); nada foi enviado ao núcleo. Reservados: ${cadence.reserved.join(" · ")}.`,
      );
      return;
    }
    if (purpose === "restore" && cadence.current_interval === cadence.original_interval) {
      // Idempotencia honesta: devolver ao vigente nao e falha, mas tampouco escreve.
      setCadenceError("");
      logMessage("info", `[Inspeção] Nada a restaurar: o byte já está no valor original ${cadence.original_interval} ticks; nenhuma escrita foi realizada.`);
      return;
    }
    const request = ++cadenceEditSeq.current;
    setCadenceBusy(true);
    setCadenceError("");
    try {
      const edit = await inspectionEditSonicDuration(current.session_id, "sonic1_sonic", nextValue);
      if (request !== cadenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      const next = { ...sessionRef.current, edit };
      sessionRef.current = next;
      setSession(next);
      await loadCadence(current.session_id);
      if (edit.noop) {
        // No-op e resultado explicito do nucleo: valor ja vigente, copia imutavel intacta.
        logMessage(
          "info",
          `[Inspeção] No-op explícito: o byte já valia ${nextValue} ticks; nenhuma escrita adicional. Cópia ${edit.modified_rom_sha256}.`,
        );
      } else {
        setUnsavedChanges(true);
        setCadenceError("");
        logMessage(
          "success",
          `[Inspeção] Cadência id_Wait ${purpose === "restore" ? "restaurada" : "aplicada"}: byte em 0x${hex(cadence.interval_addr, 5)} agora ${nextValue} ticks na cópia ${edit.modified_rom_sha256}.`,
        );
      }
    } catch (error) {
      if (request !== cadenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      setCadenceError(`Edição de cadência recusada: ${describeError(error)} A base original não foi tocada.`);
      logMessage("error", `[Inspeção] Edição de cadência recusada: ${describeError(error)}`);
    } finally {
      if (request === cadenceEditSeq.current) setCadenceBusy(false);
    }
  }

  // E2-0 (EXPECTATIONS-VISUAL-ETAPA2): política congelada — "Mais lento/Mais
  // rápido" propõem, nunca escrevem. A escrita acontece em "Aplicar duração"
  // ou "Restaurar original"; o texto, o aviso de pendência e o botão concordam.
  function stepCadence(delta: number) {
    if (!cadence) return;
    const start = cadenceValue === "" ? cadence.current_interval : Number(cadenceValue);
    const clamped = Math.min(cadence.editable_max, Math.max(cadence.editable_min, start + delta));
    setCadenceValue(clamped);
    setCadenceError("");
  }

  // PART 2 — ordem das 18 entradas do script id_Wait. Lê o contrato no núcleo
  // (nunca reimplementa endereços/tokens), permite selecionar uma posição,
  // movê-la antes/depois, comparar proposta vs original vs aplicado, aplicar à
  // cópia e restaurar SOMENTE a sequência. Reconhece repetições: mover duas
  // entradas iguais não altera o byte stream e é tratado como no-op.
  async function loadSequence(sessionId: string) {
    const request = ++sequenceRequestSeq.current;
    setSequenceBusy(true);
    setSequenceError("");
    try {
      const info = await inspectionSonicSequence(sessionId);
      if (request !== sequenceRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
      setSequence(info);
      setSequenceProposal(info.current_frames.slice());
      setSequenceSelected(null);
      const thumbs: Record<string, InspectionSpriteFrame> = {};
      for (const byte of Array.from(new Set(info.current_frames))) {
        const frameId = cadenceThumbId(byte);
        try {
          const frame = await inspectionSpriteFrame(sessionId, "sonic1_sonic", frameId, false, false);
          if (frame.resource_id === "sonic1_sonic" && frame.frame_id === frameId) thumbs[frameId] = frame;
        } catch {
          /* miniatura opcional — o byte é exibido em hex quando indisponível */
        }
        if (request !== sequenceRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
      }
      setSequenceThumbs(thumbs);
    } catch (error) {
      if (request === sequenceRequestSeq.current && sessionRef.current?.session_id === sessionId) {
        setSequence(null);
        setSequenceError(`Contrato da sequência indisponível: ${describeError(error)} Reabra a sessão ou tente novamente.`);
      }
    } finally {
      if (request === sequenceRequestSeq.current) setSequenceBusy(false);
    }
  }

  function moveSequencePosition(index: number, delta: number) {
    if (!sequence || !sequenceProposal) return;
    const target = index + delta;
    if (target < 0 || target >= sequenceProposal.length) return;
    const next = sequenceProposal.slice();
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    setSequenceProposal(next);
    setSequenceSelected(target);
    setSequenceError("");
    const equalsApplied = next.every((b, i) => b === sequence.current_frames[i]);
    setSequenceMessage(equalsApplied
      ? "Proposta igual à ordem já gravada: mover duas entradas idênticas não altera a sequência."
      : "");
  }

  async function applySequence() {
    const current = sessionRef.current;
    if (!current || !sequence || !sequenceProposal) return;
    if (sequenceProposal.every((b, i) => b === sequence.current_frames[i])) {
      setSequenceError("");
      setSequenceMessage("Nada a aplicar: a proposta é idêntica à ordem já gravada na cópia (trocar entradas repetidas não muda a sequência).");
      return;
    }
    const request = ++sequenceEditSeq.current;
    setSequenceBusy(true);
    setSequenceError("");
    setSequenceMessage("");
    try {
      const edit = await inspectionEditSonicSequence(current.session_id, "sonic1_sonic", sequenceProposal);
      if (request !== sequenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      await loadSequence(current.session_id);
      if (request !== sequenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      logMessage("success", `[Inspeção] Ordem id_Wait aplicada: janela 0x${hex(sequence.frames_addr, 5)}..0x${hex(sequence.frames_addr + sequence.frames_len - 1, 5)} reordenada na cópia ${edit.modified_rom_sha256}.`);
    } catch (error) {
      if (request !== sequenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      setSequenceError(`Edição da sequência recusada: ${describeError(error)} A base original não foi tocada.`);
    } finally {
      if (request === sequenceEditSeq.current) setSequenceBusy(false);
    }
  }

  async function restoreSequence() {
    const current = sessionRef.current;
    if (!current || !sequence) return;
    if (sequence.current_frames.every((b, i) => b === sequence.original_frames[i])) {
      setSequenceError("");
      setSequenceMessage("Nada a restaurar: a sequência já está na ordem original; nenhuma escrita foi realizada.");
      setSequenceProposal(sequence.original_frames.slice());
      return;
    }
    const request = ++sequenceEditSeq.current;
    setSequenceBusy(true);
    setSequenceError("");
    setSequenceMessage("");
    try {
      await inspectionRestoreSonicSequence(current.session_id, "sonic1_sonic");
      if (request !== sequenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      await loadSequence(current.session_id);
      if (request !== sequenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      logMessage("info", `[Inspeção] Sequência id_Wait restaurada à ordem original (somente a janela 0x${hex(sequence.frames_addr, 5)}..0x${hex(sequence.frames_addr + sequence.frames_len - 1, 5)}); duração, pixels e paleta permanecem.`);
    } catch (error) {
      if (request !== sequenceEditSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      setSequenceError(`Restauração da sequência recusada: ${describeError(error)} A base original não foi tocada.`);
    } finally {
      if (request === sequenceEditSeq.current) setSequenceBusy(false);
    }
  }

  async function saveChoice() {
    if (!session || !selected || selected.kind !== "tile4bpp_block" || !selectedPalette) return;
    try {
      const sessionId = session.session_id;
      const candidateId = selected.id;
      await inspectionSavePaletteChoice(sessionId, candidateId, selectedPalette);
      if (sessionRef.current?.session_id !== sessionId || selectedRef.current?.id !== candidateId) return;
      await refreshCatalog(sessionId, pageOffset, queryRef.current, kindRef.current);
      logMessage("success", "[Inspeção] Associação manual de paleta salva como escolha do usuário.");
    } catch (error) {
      logMessage("error", `[Inspeção] Associação não salva: ${describeError(error)}`);
    }
  }

  async function save() {
    if (!session) return;
    try {
      const next = await inspectionSave(session.session_id, spriteFrameId);
      if (sessionRef.current?.session_id !== next.session_id) return;
      sessionRef.current = next;
      setSession(next);
      setSpriteFrameId(next.sprite_frame_id ?? spriteFrameId);
      setSavedAt(Date.now());
      setUnsavedChanges(false);
      setSessionMessage(`Sessão ${next.session_id} salva em disco; estado atual combinado com a cópia ${next.edit?.modified_rom_sha256 ?? "sem edição"}.`);
      logMessage("success", "[Inspeção] Snapshot da sessão salvo.");
      void refreshSavedSessions();
    } catch (error) {
      setSessionMessage(`Falha ao salvar sessão: ${describeError(error)} Tente novamente; edições na cópia permanecem.`);
      logMessage("error", `[Inspeção] Falha ao salvar sessão: ${describeError(error)}`);
    }
  }

  async function applySonicPixels(pixels: InspectionPixelEdit[], allowShared: boolean) {
    const current = sessionRef.current;
    if (!current || !spriteFrameId.startsWith("sonic1_sonic/")) throw new Error("Selecione um frame Sonic verificado");
    const request = ++editRequestSeq.current;
    setEditBusy(true);
    try {
      const edit = await inspectionEditSonicTiles(current.session_id, "sonic1_sonic", spriteFrameId, pixels, allowShared);
      if (request !== editRequestSeq.current || sessionRef.current?.session_id !== current.session_id) throw new Error("A sessão mudou; resposta antiga descartada");
      const next = { ...sessionRef.current, edit };
      sessionRef.current = next;
      setSession(next);
      await composeSpriteFrame();
      if (!edit.noop) setUnsavedChanges(true);
      setTileMessage(edit.noop
        ? "No-op explícito: os pixels já estão vigentes; nenhuma escrita adicional."
        : `Pintura acumulada na cópia ${edit.modified_rom_sha256}. A base original não foi tocada.`);
      logMessage(edit.noop ? "info" : "success", `[Inspeção] ${edit.noop ? "No-op explícito (pixels já vigentes), nenhuma escrita adicional" : "Pintura acumulada"} na cópia ${edit.modified_rom_sha256}.`);
    } catch (error) {
      if (request === editRequestSeq.current) {
        setTileMessage(`Reinserção recusada: ${describeError(error)} A base original não foi tocada.`);
      }
      throw error;
    } finally {
      if (request === editRequestSeq.current) setEditBusy(false);
    }
  }

  async function editSonicPalette() {
    const current = sessionRef.current;
    if (!current || !spriteFrameId.startsWith("sonic1_sonic/")) return;
    const request = ++editRequestSeq.current;
    setEditBusy(true);
    try {
      const edit = await inspectionEditSonicPalette(current.session_id, "sonic1_sonic", spriteFrameId, editPaletteIndex, editRed, editGreen, editBlue);
      if (request !== editRequestSeq.current || sessionRef.current?.session_id !== current.session_id) return;
      const next = { ...sessionRef.current, edit };
      sessionRef.current = next;
      setSession(next);
      await composeSpriteFrame();
      if (!edit.noop) setUnsavedChanges(true);
      setPaletteMessage(edit.noop
        ? "No-op explícito: a paleta já está vigente; nenhuma escrita adicional."
        : `Paleta acumulada na cópia ${edit.modified_rom_sha256}. A base original não foi tocada.`);
      logMessage(edit.noop ? "info" : "success", `[Inspeção] ${edit.noop ? "No-op explícito (paleta já vigente), nenhuma escrita adicional" : "Paleta acumulada"} na cópia ${edit.modified_rom_sha256}.`);
    } catch (error) {
      if (request === editRequestSeq.current) {
        setPaletteMessage(`Edição recusada: ${describeError(error)} A base original não foi tocada.`);
      }
      logMessage("error", `[Inspeção] Edição recusada: ${describeError(error)}`);
    } finally {
      if (request === editRequestSeq.current) setEditBusy(false);
    }
  }

  async function editSonicTiles() {
    const { x, y, w, h } = tileEditRect;
    if (![x, y, w, h, tileEditIndex].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1
      || w > 40 || h > 40 || x + w > (spriteFrame?.width ?? 32) || y + h > (spriteFrame?.height ?? 40)
      || tileEditIndex < 0 || tileEditIndex > 15) {
      setTileMessage("Retângulo ou índice inválido; nenhum envio realizado.");
      logMessage("error", "[Inspeção] Retângulo ou índice inválido; nenhum envio realizado.");
      return;
    }
    const pixels: InspectionPixelEdit[] = [];
    for (let py = y; py < y + h; py += 1) {
      for (let px = x; px < x + w; px += 1) pixels.push({ x: px, y: py, index: tileEditIndex });
    }
    try { await applySonicPixels(pixels, tileEditAllowShared); }
    catch (error) { logMessage("error", `[Inspeção] Reinserção recusada: ${describeError(error)}`); }
  }

  async function exportPilotPatch() {
    if (!session?.edit || !patchPath.trim()) return;
    setPatchBusy(true);
    try {
      const result = await patchCreateBps(
        session.rom_path,
        session.edit.modified_rom_path,
        patchPath.trim(),
        activeProjectDir || null,
      );
      setPatchMessage(`${result.ok ? "Patch BPS exportado" : "Exportação recusada"}: ${result.message}${result.patch_hash ? ` CRC32 ${result.patch_hash}` : ""}`);
      logMessage(result.ok ? "success" : "error", `[Patch] ${result.message}${result.patch_hash ? ` CRC32 ${result.patch_hash}` : ""}`);
    } catch (error) {
      setPatchMessage(`Exportação recusada: ${describeError(error)}`);
      logMessage("error", `[Patch] Exportação recusada: ${describeError(error)}`);
    } finally {
      setPatchBusy(false);
    }
  }

  async function applyPilotPatch() {
    if (!session || !patchPath.trim() || !patchedRomPath.trim()) return;
    setPatchBusy(true);
    try {
      const result = await patchApplyBps(session.rom_path, patchPath.trim(), patchedRomPath.trim());
      setPatchMessage(`${result.ok ? "ROM aplicada gerada" : "Aplicação recusada"}: ${result.message}`);
      logMessage(result.ok ? "success" : "error", `[Patch] ${result.message}`);
    } catch (error) {
      setPatchMessage(`Aplicação recusada: ${describeError(error)}`);
      logMessage("error", `[Patch] Aplicação recusada: ${describeError(error)}`);
    } finally {
      setPatchBusy(false);
    }
  }

  async function runRomAndObserve(romPathToRun: string, label: string) {
    if (!romPathToRun.trim()) return;
    setPatchBusy(true);
    setEmulatorObservation(null);
    setEmulatorObservationLabel(label);
    try {
      const loaded = await emulatorLoadRom(romPathToRun.trim());
      if (!loaded.ok) throw new Error(loaded.message);
      const frameBudget = Math.max(60, Math.min(10_000, Math.trunc(emulatorFrameBudget) || SONIC_BOOT_FRAME_BUDGET));
      const inputEpoch = await emulatorGetCoreEpoch();
      const runFrames = async (frames: number) => {
        if (frames <= 0) return;
        const result = await emulatorRunFrames(frames);
        if (!result.ok) throw new Error(result.message);
      };
      if (emulatorInputProfile === "sonic-boot-start" && SONIC_BOOT_START_FRAME < frameBudget) {
        await runFrames(SONIC_BOOT_START_FRAME);
        const inputResult = await emulatorSendInput({ ...JOYPAD_DEFAULT, start: true }, inputEpoch);
        if (!inputResult.ok) throw new Error(inputResult.message);
        await runFrames(1);
        const releaseResult = await emulatorSendInput(JOYPAD_DEFAULT, inputEpoch);
        if (!releaseResult.ok) throw new Error(releaseResult.message);
        await runFrames(frameBudget - SONIC_BOOT_START_FRAME - 1);
      } else {
        await runFrames(frameBudget);
      }
      const observation = await emulatorObserve();
      if (!observation.ok) throw new Error(observation.message || "Observação do core recusada.");
      setEmulatorObservation(observation);
      setEmulatorObservationHistory((current) => [...current.filter((entry) => entry.label !== label), { label, observation }].slice(-4));
      logMessage("success", `[Emulador] ${observation.message} Perfil=${emulatorInputProfile}; orçamento=${frameBudget}; START=${SONIC_BOOT_START_FRAME}.`);
    } catch (error) {
      logMessage("error", `[Emulador] Execução recusada: ${describeError(error)}`);
    } finally {
      setPatchBusy(false);
    }
  }

  async function runBaseRom() {
    if (!session?.rom_path) return;
    await runRomAndObserve(session.rom_path, "ROM base");
  }

  async function runPatchedRom() {
    if (!patchedRomPath.trim()) return;
    await runRomAndObserve(patchedRomPath.trim(), "ROM aplicada");
  }

  function playModifiedRom() {
    const modifiedPath = patchedRomPath.trim() || session?.edit?.modified_rom_path?.trim() || "";
    if (!modifiedPath) {
      logMessage("warn", "[Emulador] Salve/aplique a ROM modificada antes de jogar pela superfície canônica.");
      return;
    }
    setPatchedRomPath(modifiedPath);
    requestEmulatorLaunch(modifiedPath, "ROM modificada · sessão de inspeção");
    logMessage("info", `[Emulador] Jogar versão modificada solicitado pela superfície Game View: ${modifiedPath}`);
  }

  function playBaseRom() {
    const basePath = session?.rom_path?.trim() || "";
    if (!basePath) {
      logMessage("warn", "[Emulador] Identifique uma ROM antes de jogar a versão base pela superfície canônica.");
      return;
    }
    requestEmulatorLaunch(basePath, "ROM base · comparação de controles");
    logMessage("info", `[Emulador] Jogar ROM base solicitado pela superfície Game View: ${basePath}`);
  }

  function closeSession() {
    const currentSessionId = sessionRef.current?.session_id;
    if (currentSessionId) {
      lastSessionId.current = currentSessionId;
      savedSessionId.current = currentSessionId;
      setSelectedSavedSessionId(currentSessionId);
    }
    liveInspectionCache = null;
    try {
      window.localStorage.removeItem(RESUME_SESSION_KEY);
      window.localStorage.removeItem(RESUME_ROM_KEY);
    } catch {
      /* storage indisponível */
    }
    setResumeHint(null);
    setSavedAt(null);
    setUnsavedChanges(false);
    setSessionMessage("Sessão fechada na interface; a cópia editada permanece em disco e pode ser reaberta.");
    setPaletteMessage("");
    setTileMessage("");
    setPatchMessage("");
    setComposeMessage("");
    sessionRequestSeq.current += 1;
    invalidateAsyncRequests();
    sessionRef.current = null;
    selectedRef.current = null;
    setBusy(false);
    setSession(null);
    setRun(null);
    setEmulatorObservation(null);
    setEmulatorObservationLabel("");
    setEmulatorObservationHistory([]);
    setPage(null);
    setPalettePage(null);
    setSelected(null);
    setPreview(null);
    setIdentifyState("idle");
    setIdentifyInput("");
    setIdentifyError("");
  }

  function selectSavedSession(saved: InspectionSession) {
    sessionRequestSeq.current += 1;
    invalidateAsyncRequests();
    sessionRef.current = null;
    selectedRef.current = null;
    savedSessionId.current = saved.session_id;
    lastSessionId.current = saved.session_id;
    setRomPath(saved.rom_path);
    setPatchedRomPath(saved.edit?.modified_rom_path ?? "");
    setSelectedSavedSessionId(saved.session_id);
    setBusy(false);
    setSession(null);
    setRun(null);
    setPage(null);
    setPalettePage(null);
    setSelected(null);
    setPreview(null);
  }

  const currentProgress = run?.progress;
  const percent = currentProgress ? Math.min(100, Math.round((currentProgress.completed_work / Math.max(currentProgress.total_work, 1)) * 100)) : 0;
  // Ritmo medido no oracle da Etapa 4 (veredito H_N+1): byte N mantem o frame
  // visivel por N+1 frames de tela em NTSC. A previa segue o ritmo medido.
  const cadenceFrameTicks = Math.max(1, (cadence?.current_interval ?? 1) + 1);
  const cadenceActiveIndex = cadence && cadence.frames.length > 0
    ? Math.floor(cadenceTick / cadenceFrameTicks) % cadence.frames.length
    : 0;
  const isSonicFrame = spriteFrameId.startsWith("sonic1_sonic/");
  const cadenceProposed = cadence && cadenceValue !== "" && Number.isInteger(Number(cadenceValue))
    && Number(cadenceValue) !== cadence.current_interval
    ? Number(cadenceValue) : null;

  return (
    <div data-testid="reverse-inspection-panel" className={`min-w-0 max-w-full space-y-3 [overflow-wrap:anywhere] ${consoleVisible ? "pb-[min(46vh,376px)]" : "pb-2"}`}>
      <div className="rounded border border-[#313244] bg-[#11111b] p-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#cba6f7]">Inspeção visual · Experimental</div>
        <p className="mb-3 text-[10px] text-[#94a3b8]">Inspecione a ROM e edite uma cópia nos perfis assistidos disponíveis. A base é preservada; candidatos heurísticos não são sprites montados.</p>
        <ToolPathField label="ROM BYOR" value={romPath} set={setRomPath} extensions={["md", "gen", "bin", "smd"]} accentColor="cba6f7" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" data-testid="inspection-identify" onClick={() => void identify()} disabled={busy} className="rounded bg-[#cba6f7] px-3 py-1 text-[10px] font-semibold text-[#1e1e2e]">Identificar base</button>
          <button type="button" data-testid="inspection-reopen" onClick={() => void reopen()} disabled={busy || !(session?.session_id || selectedSavedSessionId || lastSessionId.current)} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#cdd6f4]">Reabrir sessão</button>
          {session && <button type="button" data-testid="inspection-save" onClick={() => void save()} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#cdd6f4]">Salvar sessão</button>}
          {session && <button type="button" data-testid="inspection-close" onClick={closeSession} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#f9e2af]">Fechar sessão</button>}
        </div>
        {resumeHint && !session && (
          <div data-testid="inspection-resume-banner" className="mt-2 rounded border border-[#89b4fa]/40 bg-[#101b2e] p-2">
            <div className="text-[10px] text-[#cdd6f4]">Há uma sessão de inspeção anterior: {resumeHint.sessionId} · {resumeHint.romPath}</div>
            <div className="mt-1 text-[10px] text-[#7f849c]">Reabra para retomar palco, cadência e edições acumuladas na cópia sem percorrer o catálogo de novo. A identidade da ROM base é verificada na reabertura.</div>
            <button type="button" data-testid="inspection-resume-reopen" onClick={() => void resumeFromBanner()} className="mt-2 rounded bg-[#89b4fa] px-3 py-1 text-[10px] font-semibold text-[#111827]">Reabrir última sessão</button>
          </div>
        )}
        <div aria-live="polite" data-testid="inspection-session-message" className="mt-2 break-words text-[10px] text-[#a6e3a1]">{sessionMessage}</div>
        <div
          data-testid="inspection-identify-state"
          data-state={identifyState}
          data-input-value={identifyInput}
          data-error={identifyError}
          data-session-id={session?.session_id ?? ""}
          data-session-status={session?.status ?? ""}
          className="sr-only"
        />
        <div className="mt-3 rounded border border-[#313244] bg-[#0f172a] p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#7f849c]">Sessões salvas</div>
            <button type="button" data-testid="inspection-refresh-sessions" onClick={() => void refreshSavedSessions()} disabled={savedSessionsBusy} className="rounded border border-[#313244] px-2 py-1 text-[10px] text-[#cdd6f4]">{savedSessionsBusy ? "Atualizando..." : "Atualizar lista"}</button>
          </div>
          {savedSessions.length === 0 ? <div className="mt-2 text-[10px] text-[#7f849c]">Nenhuma sessão persistida encontrada neste aplicativo.</div> : <div className="mt-2 space-y-2">{savedSessions.map((saved) => <div data-testid="inspection-saved-session" data-session-id={saved.session_id} data-session-status={saved.status} key={saved.session_id} className={`flex flex-wrap items-center justify-between gap-2 rounded border p-2 ${selectedSavedSessionId === saved.session_id ? "border-[#cba6f7] bg-[#1b1630]" : "border-[#1e1e2e]"}`}><div className="min-w-0"><div className="truncate text-[10px] text-[#cdd6f4]">{saved.identity.header_title || "ROM sem título"} · {statusLabel(saved.status)}</div><div className="mt-1 truncate font-mono text-[9px] text-[#7f849c]">{saved.session_id} · {saved.identity.normalized_sha256.slice(0, 16)}…</div><div className="mt-1 truncate text-[9px] text-[#7f849c]">{saved.rom_path}</div></div><button type="button" data-testid={`select-saved-session-${saved.session_id}`} onClick={() => selectSavedSession(saved)} className="rounded border border-[#cba6f7]/50 px-2 py-1 text-[10px] text-[#cba6f7]">Selecionar</button></div>)}</div>}
        </div>
      </div>

      {session && (
        <div data-testid="inspection-session" data-session-id={session.session_id} data-session-status={session.status} data-identity-sha256={session.identity.normalized_sha256} className="rounded border border-[#313244] bg-[#11111b] p-3 text-[10px]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[#e5e7eb]">{session.identity.header_title || "ROM sem título"}</div>
              <div className="mt-1 text-[#94a3b8]">{session.identity.header_console || "Mega Drive"} · {session.identity.variant} · {statusLabel(session.status)}</div>
            </div>
            <span className="rounded-full border border-[#cba6f7]/40 bg-[#cba6f7]/10 px-2 py-1 text-[#cba6f7]">base: somente leitura</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="min-w-0 break-all font-mono text-[#cdd6f4]">ROM {session.identity.original_sha256}</div>
            <div className="min-w-0 break-all font-mono text-[#cdd6f4]">normalizada {session.identity.normalized_sha256}</div>
          </div>
          <div className="mt-2 break-all text-[#7f849c]">Sessão {session.session_id} · catálogo {session.catalog_artifact.sha256} · desconhecido {session.unknown_bytes} bytes</div>
          {session.identity.size_note && <div className="mt-2 text-[#f9e2af]">Nota de tamanho: {session.identity.size_note}</div>}
        </div>
      )}

      {session && !run && session.status !== "completed" && <button type="button" data-testid="inspection-start" onClick={() => void start()} className="rounded bg-[#89b4fa] px-3 py-1 text-[10px] font-semibold text-[#1e1e2e]">Executar descoberta</button>}
      {run && (
        <div data-testid="inspection-run" data-run-id={run.run_id} data-run-status={run.status} data-run-generation={run.generation} className="rounded border border-[#313244] bg-[#11111b] p-3">
          <div className="flex justify-between text-[10px] text-[#cdd6f4]"><span>{currentProgress?.message}</span><span>{percent}%</span></div>
          <div className="mt-2 h-2 rounded bg-[#1e1e2e]"><div className="h-2 rounded bg-[#89b4fa]" style={{ width: `${percent}%` }} /></div>
          <div className="mt-2 text-[10px] text-[#7f849c]">Fase: {currentProgress?.phase} · geração {run.generation} · estado {statusLabel(run.status)}</div>
          {run.status === "running" && <button type="button" data-testid="inspection-cancel" onClick={() => void cancel()} className="mt-2 rounded border border-[#f38ba8]/50 px-3 py-1 text-[10px] text-[#f38ba8]">Cancelar análise</button>}
          {run.error && <div className="mt-2 text-[#f38ba8]">{run.error.message}</div>}
        </div>
      )}

      {session?.status === "completed" && page && (
        <>
          <div data-testid={isSonicFrame ? "inspection-animation-area" : undefined} className="contents">
          <div data-testid="inspection-sprite-frame-panel" className="rounded border border-[#cba6f7]/40 bg-[#11111b] p-3 text-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#cba6f7]">Frame composto · recurso assistido · Experimental</div>
                <div className="mt-1 text-[#f9e2af]">Não é prévia de tile: composição assistida por metadado doador, com bytes compilados verificados.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-[#cdd6f4]">Frame
                  <select data-testid="inspection-sprite-frame-select" disabled={editBusy} value={spriteFrameId} onChange={(event) => { previewRequestSeq.current += 1; setSpriteFrameBusy(false); setSpriteFrameId(event.target.value); setSpriteFrame(null); }} className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[10px] text-[#cdd6f4]">
                    <option value="spr_ryo_100/frame-0">spr_ryo_100 / frame 0</option>
                    <option value="spr_ryo_100/frame-1">spr_ryo_100 / frame 1</option>
                    <option value="spr_ryo_100/frame-2">spr_ryo_100 / frame 2</option>
                    <option value="spr_ryo_100/frame-3">spr_ryo_100 / frame 3</option>
                    <option value="spr_ryo_100/frame-4">spr_ryo_100 / frame 4 (deduplicado)</option>
                    <option value="spr_spark0/frame-0">spr_spark0 / frame 0 · Taiketsu</option>
                    <option value="sonic1_sonic/stand">Sonic 1 / Parado · perfil assistido</option>
                    {spriteFrameId.startsWith("sonic1_sonic/") && spriteFrameId !== "sonic1_sonic/stand" && !sonicFrames.some((f) => f.id === spriteFrameId) && <option value={spriteFrameId}>Sonic 1 / frame salvo {spriteFrameId.split("/")[1]}</option>}
                    {sonicFrames.filter((f) => f.id !== "sonic1_sonic/stand").map((f) => <option key={f.id} value={f.id}>Sonic 1 / {f.label}</option>)}
                  </select>
                </label>
                <button type="button" data-testid="inspection-compose-sprite" disabled={editBusy} onClick={() => void composeSpriteFrame()} aria-busy={spriteFrameBusy} className="rounded bg-[#cba6f7] px-3 py-1 text-[10px] font-semibold text-[#1e1e2e]">{spriteFrameBusy ? "Compondo..." : "Compor frame"}</button>
              </div>
            </div>
            {spriteFrame?.available && spriteFrame.data_url && <div className="mt-3 flex min-w-0 flex-col gap-3">
              <div data-testid="inspection-sprite-frame-stage" className="min-w-0 overflow-auto rounded border border-[#313244] bg-[#0b0f19] p-2" aria-label="Área reservada do frame composto">
                <div className="flex min-w-0 gap-3">
                  <div className="w-[196px] min-w-[196px] shrink-0">
                    {originalFrame && <div data-testid="inspection-sprite-frame-copy-label" className="mb-1 text-[9px] uppercase tracking-[0.14em] text-[#a6e3a1]">Cópia atual (edições acumuladas)</div>}
                    <img data-testid="inspection-sprite-frame-image" data-sprite-resource={spriteFrame.resource_id} data-sprite-frame={spriteFrame.frame_id} data-sprite-rom-sha256={spriteFrame.rom_sha256} data-sprite-width={spriteFrame.width} data-sprite-height={spriteFrame.height} data-sprite-scale="3" data-png-sha256={spriteFrame.png_sha256 ?? ""} data-pixels-sha256={spriteFrame.pixels_sha256 ?? ""} src={spriteFrame.data_url} alt={`Frame composto ${spriteFrame.resource_id}`} width={spriteFrame.width * 3} height={spriteFrame.height * 3} className="block shrink-0 border border-[#313244] bg-[#ff00ff] [image-rendering:pixelated]" style={{ boxSizing: "content-box", imageRendering: "pixelated", width: `${spriteFrame.width * 3}px`, height: `${spriteFrame.height * 3}px`, maxWidth: "none", maxHeight: "none" }} />
                  </div>
                  {originalFrame?.available && originalFrame.data_url && (
                    <div className="w-[196px] min-w-[196px] shrink-0">
                      <div data-testid="inspection-sprite-frame-original-label" className="mb-1 text-[9px] uppercase tracking-[0.14em] text-[#7f849c]">Original · ROM base intocada</div>
                      <img data-testid="inspection-sprite-frame-original-image" data-sprite-resource={originalFrame.resource_id} data-sprite-frame={originalFrame.frame_id} data-sprite-rom-sha256={originalFrame.rom_sha256} data-sprite-width={originalFrame.width} data-sprite-height={originalFrame.height} data-sprite-scale="3" data-png-sha256={originalFrame.png_sha256 ?? ""} data-pixels-sha256={originalFrame.pixels_sha256 ?? ""} src={originalFrame.data_url} alt={`Frame original da base ${originalFrame.frame_id}`} width={originalFrame.width * 3} height={originalFrame.height * 3} className="block shrink-0 border border-[#313244] bg-[#ff00ff] [image-rendering:pixelated]" style={{ boxSizing: "content-box", imageRendering: "pixelated", width: `${originalFrame.width * 3}px`, height: `${originalFrame.height * 3}px`, maxWidth: "none", maxHeight: "none" }} />
                    </div>
                  )}
                </div>
              </div>
              <div aria-live="polite" data-testid="inspection-compose-message" className="break-words text-[#a6e3a1]">{composeMessage}</div>
              <details className="min-w-0 rounded border border-[#313244] bg-[#0f172a] p-2">
                <summary className="cursor-pointer text-[9px] uppercase tracking-[0.14em] text-[#7f849c]">Detalhes técnicos do frame · offsets, SHA e proveniência da composição</summary>
                <div data-testid="inspection-sprite-frame-metadata" className="mt-2 min-w-0 space-y-1 break-words text-[#cdd6f4]">
                <div className="font-mono text-[9px] text-[#7f849c]">Conteúdo CSS {spriteFrame.width * 3}×{spriteFrame.height * 3}px · escala inteira 3× · nativo {spriteFrame.width}×{spriteFrame.height}px</div>
                <div className="font-mono text-[9px] break-all text-[#7f849c]">RGBA pixels: {spriteFrame.pixels_sha256}</div>
                <div className="break-all">ROM recuperada: {spriteFrame.rom_sha256}</div>
                <div className="break-all">Bytes de tiles: 0x{hex(spriteFrame.tile_data_offset)} + {spriteFrame.tile_data_size} · paleta: 0x{hex(spriteFrame.palette_offset)} + {spriteFrame.palette_size}</div>
                <div className="break-all">Descritores VDP: 0x{hex(spriteFrame.descriptor_offset)} · flip X/Y: {String(spriteFrame.flip_x)}/{String(spriteFrame.flip_y)} · transparência: índice {spriteFrame.transparency_index}</div>
                <div className="text-[#f9e2af] break-words">{spriteFrame.metadata_source}</div>
                <div className="mt-2 text-[#7f849c] break-words">Doador: {spriteFrame.donor_evidence.join(" · ")}</div>
                <div className="mt-2 text-[#7f849c] break-words">Limitações: {spriteFrame.limitations.join(" · ")}</div>
                </div>
              </details>
            </div>}
            {spriteFrameId.startsWith("sonic1_sonic/") && <div data-testid="inspection-sonic-edit-panel" className="mt-3 rounded border border-[#f9e2af]/30 bg-[#2a2414] p-3 text-[10px]">
              <div className="font-semibold uppercase tracking-[0.16em] text-[#f9e2af]">Edição piloto · paleta MD RGB333</div>
              <div className="mt-1 text-[#cdd6f4]">Opera somente sobre uma cópia persistida da ROM; o arquivo BYOR original nunca é sobrescrito.</div>
              <div data-testid="inspection-anim-group-duration">
              <div data-testid="inspection-sonic-cadence-panel" className="mt-2 rounded border border-[#89b4fa]/30 bg-[#101b2e] p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">Duração da animação · {cadence?.name ?? "id_Wait"} · Experimental</div>
                  {cadence && <button type="button" data-testid="inspection-cadence-preview-toggle" onClick={() => { setCadenceTick(0); setCadencePlaying((playing) => !playing); }} className="rounded border border-[#89b4fa]/50 px-2 py-1 text-[#89b4fa]">{cadencePlaying ? "Pausar prévia" : "Reproduzir prévia"}</button>}
                </div>
                <p className="mt-1 text-[#cdd6f4]">Sequência comprovada de duração fixa do Sonic parado. A ordem dos quadros vem do script real da ROM lido pelo núcleo; a interface não reimplementa endereços, tokens nem duração.</p>
                {cadenceBusy && !cadence && <div className="mt-1 text-[#7f849c]">Lendo o contrato de cadência no núcleo…</div>}
                {cadence && <>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-[#7f849c]">Duração por etapa · ticks por quadro<input data-testid="inspection-cadence-value" type="number" min={cadence.editable_min} max={cadence.editable_max} step={1} value={cadenceValue} onChange={(event) => setCadenceValue(event.target.value === "" ? "" : Number(event.target.value))} className="w-20 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                    <button type="button" data-testid="inspection-cadence-slower" disabled={cadenceBusy || editBusy} onClick={() => stepCadence(1)} className="rounded border border-[#89b4fa]/50 px-3 py-1 text-[#89b4fa]" title="Proposta: +1 tick no valor proposto; nada é gravado até você clicar em Aplicar duração">Mais lento</button>
                    <button type="button" data-testid="inspection-cadence-faster" disabled={cadenceBusy || editBusy} onClick={() => stepCadence(-1)} className="rounded border border-[#89b4fa]/50 px-3 py-1 text-[#89b4fa]" title="Proposta: −1 tick no valor proposto; nada é gravado até você clicar em Aplicar duração">Mais rápido</button>
                    <button type="button" data-testid="inspection-cadence-apply" disabled={cadenceBusy || editBusy} onClick={() => void applyCadence(cadenceValue === "" ? Number.NaN : cadenceValue, "apply")} className="rounded bg-[#89b4fa] px-3 py-1 font-semibold text-[#111827]">{cadenceBusy ? "Aplicando…" : "Aplicar duração"}</button>
                    <button type="button" data-testid="inspection-cadence-restore" disabled={cadenceBusy || editBusy} onClick={() => void applyCadence(cadence.original_interval, "restore")}>Restaurar original</button>
                  </div>
                  <div className="mt-2 grid gap-1 md:grid-cols-2">
                    <div data-testid="inspection-cadence-original" className="text-[#cdd6f4]">Original: {cadence.original_interval} ticks (0x{hex(cadence.original_interval, 2)})</div>
                    <div data-testid="inspection-cadence-current" className="text-[#a6e3a1]">Aplicado na cópia: {cadence.current_interval} ticks (0x{hex(cadence.current_interval, 2)})</div>
                  </div>
                  {cadenceValue !== "" && Number.isInteger(Number(cadenceValue)) && Number(cadenceValue) !== cadence.current_interval && <div data-testid="inspection-cadence-pending" className="mt-1 text-[#f9e2af]">Pendente: {cadenceValue} ticks ainda não foi gravado; a cópia mantém {cadence.current_interval}. Nada muda no jogo até você clicar em “Aplicar duração”.</div>}
                  <div className="mt-1 text-[#7f849c]">Unidade: {cadence.unit}. {cadence.semantics}</div>
                  <div data-testid="inspection-cadence-prediction" className="mt-1 text-[#7f849c]">Previsão medida no core (oracle, veredito H_N+1): byte {cadence.current_interval} ⇒ cada quadro fica {cadence.current_interval + 1} frames de tela em NTSC ≈ {((cadence.current_interval + 1) / 60).toFixed(2)} s; PAL permanece não medido.</div>
                  {cadenceProposed !== null && <div data-testid="inspection-cadence-proposal-prediction" className="mt-1 text-[#f9e2af]">Previsão da proposta (mesma fórmula medida no core, veredito H_N+1): byte {cadenceProposed} ⇒ cada quadro ficará {cadenceProposed + 1} frames de tela em NTSC ≈ {((cadenceProposed + 1) / 60).toFixed(2)} s — derivada do ritmo NTSC medido; só vale na cópia após Aplicar duração.</div>}
                  <div className="mt-1 text-[#a6e3a1]">Escopo do desfazer: “Restaurar original” altera somente o byte do intervalo em 0x{hex(cadence.interval_addr, 5)}; pinturas de arte e paleta já acumuladas na cópia permanecem.</div>
                  <div data-testid="inspection-cadence-timeline" className="mt-2 flex flex-wrap gap-1" aria-label="Quadros da sequência em ordem">
                    {cadence.frames.map((byte, index) => {
                      const frameId = cadenceThumbId(byte);
                      const thumb = cadenceThumbs[frameId];
                      const active = cadencePlaying && index === cadenceActiveIndex;
                      return <button key={`${frameId}-${index}`} type="button" data-testid={`inspection-cadence-frame-${index}`} data-frame-byte={byte} data-active={String(active)} data-selected={String(spriteFrameId === frameId)} title={`Quadro ${index + 1}: índice de arte 0x${hex(byte, 2)}; clique para compor`} onClick={() => { setSpriteFrameId(frameId); void composeSpriteFrame(frameId); }} className={`rounded border p-1 ${active ? "border-[#89b4fa] bg-[#16263f]" : spriteFrameId === frameId ? "border-[#cba6f7] bg-[#1b1630]" : "border-[#313244] bg-[#0b0f19]"}`}>
                        {thumb?.available && thumb.data_url
                          ? <img src={thumb.data_url} alt={`Quadro ${index + 1}`} width={thumb.width * 2} height={thumb.height * 2} className="block bg-[#ff00ff] [image-rendering:pixelated]" style={{ imageRendering: "pixelated" }} />
                          : <span className="block px-1 py-2 font-mono text-[9px] text-[#7f849c]">{hex(byte, 2)}</span>}
                      </button>;
                    })}
                  </div>
                  <div data-testid="inspection-cadence-caption" className="mt-1 text-[#7f849c]">{cadence.frames.length} entradas na ordem do script · {new Set(cadence.frames).size} desenhos únicos (bytes distintos). A prévia toca no ritmo medido no core (byte + 1 frames de tela) usando o relógio do navegador — é demonstração, não prova da duração dentro do jogo. Toque num quadro para compô-lo no palco acima.</div>
                  <div data-testid="inspection-cadence-terminator" className="mt-1 text-[#bac2de]">Término: {cadence.terminator}</div>
                  <div data-testid="inspection-cadence-limits" className="mt-1 text-[#bac2de]">Intervalo editável comprovado: {cadence.editable_min}–{cadence.editable_max} ticks. Valores recusados: {cadence.reserved.join(" · ")}.</div>
                  <details className="mt-2 border-t border-[#313244] pt-2">
                    <summary className="cursor-pointer text-[9px] uppercase tracking-[0.14em] text-[#bac2de]">Proveniência e limitações do contrato (detalhe técnico)</summary>
                    <div data-testid="inspection-cadence-provenience" className="mt-1 space-y-1 text-[9px] text-[#7f849c]">
                      {cadence.provenience.map((line) => <div key={line}>{line}</div>)}
                      <div className="pt-1 uppercase tracking-[0.14em] text-[#bac2de]">Limitações</div>
                      {cadence.limitations.map((line) => <div key={line}>{line}</div>)}
                      <div className="break-all font-mono">Contrato: {cadence.contract_path}</div>
                    </div>
                  </details>
                </>}
                <div aria-live="polite" data-testid="inspection-cadence-error" className="mt-2 break-words text-[#f38ba8]">{cadenceError}</div>
              </div>
              </div>
              <div data-testid="inspection-anim-group-sequence" className="mt-2">
              <div data-testid="inspection-sonic-sequence-panel" className="rounded border border-[#94e2d5]/30 bg-[#0d2021] p-2">
                <div className="font-semibold uppercase tracking-[0.14em] text-[#94e2d5]">Ordem das entradas · {sequence?.name ?? "id_Wait"} · Experimental</div>
                <p className="mt-1 text-[#cdd6f4]">Reordene as {sequence?.frames_len ?? 18} entradas do script id_Wait. A edição escreve só na janela 0x{hex(sequence?.frames_addr ?? 0, 5)}..0x{hex((sequence?.frames_addr ?? 0) + (sequence?.frames_len ?? 18) - 1, 5)}: o byte de duração (0x{hex((sequence?.script_addr ?? 0), 5)}), o terminador e o script vizinho nunca mudam. Entradas repetidas são posições distintas — mover duas iguais não altera a sequência.</p>
                {sequenceBusy && !sequence && <div className="mt-1 text-[#7f849c]">Lendo o contrato da sequência no núcleo…</div>}
                {sequence && <>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <button type="button" data-testid="inspection-sequence-move-before" disabled={sequenceBusy || editBusy || sequenceSelected === null || sequenceSelected === 0} onClick={() => { if (sequenceSelected !== null) moveSequencePosition(sequenceSelected, -1); }} className="rounded border border-[#94e2d5]/50 px-3 py-1 text-[#94e2d5]" title="Proposta: move a entrada selecionada uma posição para trás; nada é gravado até “Aplicar ordem”">Mover antes</button>
                    <button type="button" data-testid="inspection-sequence-move-after" disabled={sequenceBusy || editBusy || sequenceSelected === null || !sequenceProposal || sequenceSelected >= sequenceProposal.length - 1} onClick={() => { if (sequenceSelected !== null) moveSequencePosition(sequenceSelected, 1); }} className="rounded border border-[#94e2d5]/50 px-3 py-1 text-[#94e2d5]" title="Proposta: move a entrada selecionada uma posição para frente; nada é gravado até “Aplicar ordem”">Mover depois</button>
                    <button type="button" data-testid="inspection-sequence-apply" disabled={sequenceBusy || editBusy} onClick={() => void applySequence()} className="rounded bg-[#94e2d5] px-3 py-1 font-semibold text-[#111827]">{sequenceBusy ? "Aplicando…" : "Aplicar ordem"}</button>
                    <button type="button" data-testid="inspection-sequence-restore" disabled={sequenceBusy || editBusy} onClick={() => void restoreSequence()}>Restaurar sequência</button>
                  </div>
                  <div data-testid="inspection-sequence-timeline" className="mt-2 flex flex-wrap gap-1" aria-label="Entradas da sequência na ordem proposta">
                    {(sequenceProposal ?? sequence.current_frames).map((byte, index) => {
                      const frameId = cadenceThumbId(byte);
                      const thumb = sequenceThumbs[frameId];
                      const changedVsOriginal = byte !== sequence.original_frames[index];
                      const pendingVsApplied = byte !== sequence.current_frames[index];
                      const selected = sequenceSelected === index;
                      return <div key={`seq-${index}`} className="flex flex-col items-center gap-0.5">
                        <button type="button" data-testid={`inspection-sequence-entry-${index}`} data-byte={byte} data-selected={String(selected)} data-changed={String(changedVsOriginal)} data-pending={String(pendingVsApplied)} title={`Posição ${index + 1}: índice de arte 0x${hex(byte, 2)}${changedVsOriginal ? " · difere do original" : ""}${pendingVsApplied ? " · pendente na cópia" : ""}`} onClick={() => setSequenceSelected(index)} className={`rounded border p-1 ${selected ? "border-[#cba6f7] bg-[#1b1630]" : pendingVsApplied ? "border-[#94e2d5] bg-[#0d2021]" : changedVsOriginal ? "border-[#f9e2af]/60 bg-[#2a2414]" : "border-[#313244] bg-[#0b0f19]"}`}>
                          {thumb?.available && thumb.data_url
                            ? <img src={thumb.data_url} alt={`Entrada ${index + 1}`} width={thumb.width * 2} height={thumb.height * 2} className="block bg-[#ff00ff] [image-rendering:pixelated]" style={{ imageRendering: "pixelated" }} />
                            : <span className="block px-1 py-2 font-mono text-[9px] text-[#7f849c]">{hex(byte, 2)}</span>}
                        </button>
                        <span className="font-mono text-[8px] text-[#7f849c]">{index + 1}</span>
                      </div>;
                    })}
                  </div>
                  <div className="mt-2 grid gap-1 md:grid-cols-3">
                    <div data-testid="inspection-sequence-original" className="text-[#cdd6f4]">Original: {sequence.original_frames.map((b) => hex(b, 2)).join(" ")}</div>
                    <div data-testid="inspection-sequence-current" className="text-[#a6e3a1]">Aplicado na cópia: {sequence.current_frames.map((b) => hex(b, 2)).join(" ")}</div>
                    <div data-testid="inspection-sequence-proposed" className="text-[#94e2d5]">Proposta: {(sequenceProposal ?? sequence.current_frames).map((b) => hex(b, 2)).join(" ")}</div>
                  </div>
                  {sequenceProposal && sequenceProposal.some((b, i) => b !== sequence.current_frames[i]) && <div data-testid="inspection-sequence-pending" className="mt-1 text-[#f9e2af]">Pendente: {sequenceProposal.filter((b, i) => b !== sequence.current_frames[i]).length} posição(ões) diferem da ordem aplicada; nada muda no jogo até você clicar em “Aplicar ordem”.</div>}
                  {sequenceProposal && sequenceProposal.every((b, i) => b === sequence.current_frames[i]) && !sequenceMessage && <div data-testid="inspection-sequence-none-pending" className="mt-1 text-[#7f849c]">Nenhuma reordenação pendente: a proposta coincide com a ordem aplicada na cópia.</div>}
                  {sequenceProposal && <div data-testid="inspection-sequence-diff-original" className="mt-1 text-[#bac2de]">{sequenceProposal.filter((b, i) => b !== sequence.original_frames[i]).length} posição(ões) diferem do original · {new Set(sequenceProposal).size} desenhos únicos (bytes distintos).</div>}
                  <div className="mt-1 text-[#a6e3a1]">Escopo: esta ferramenta altera somente a ordem das entradas; a duração, o byte de intervalo, o terminador, os pixels e a paleta já acumulados na cópia permanecem intactos. Restaurar sequência devolve só a ordem original.</div>
                  <div data-testid="inspection-sequence-loop-effect" className="mt-1 text-[#bac2de]">Efeito do loop: {sequence.loop_effect}</div>
                  <div data-testid="inspection-sequence-terminator" className="mt-1 text-[#bac2de]">Término: {sequence.terminator}</div>
                  <div data-testid="inspection-sequence-domain" className="mt-1 text-[#bac2de]">Valores válidos como entrada: {sequence.valid_values.map((b) => `0x${hex(b, 2)}`).join(", ")}. Recusados: {sequence.reserved.join(" · ")}.</div>
                  <details className="mt-2 border-t border-[#313244] pt-2">
                    <summary className="cursor-pointer text-[9px] uppercase tracking-[0.14em] text-[#bac2de]">Proveniência e limitações do contrato (detalhe técnico)</summary>
                    <div data-testid="inspection-sequence-provenience" className="mt-1 space-y-1 text-[9px] text-[#7f849c]">
                      {sequence.provenience.map((line) => <div key={line}>{line}</div>)}
                      <div className="pt-1 uppercase tracking-[0.14em] text-[#bac2de]">Limitações</div>
                      {sequence.limitations.map((line) => <div key={line}>{line}</div>)}
                      <div className="break-all font-mono">Contrato: {sequence.contract_path}</div>
                    </div>
                  </details>
                </>}
                <div aria-live="polite" data-testid="inspection-sequence-message" className="mt-2 break-words text-[#a6e3a1]">{sequenceMessage}</div>
                <div aria-live="polite" data-testid="inspection-sequence-error" className="mt-2 break-words text-[#f38ba8]">{sequenceError}</div>
              </div>
              </div>
              <div data-testid="inspection-anim-group-color" className="mt-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[#7f849c]">Índice<input data-testid="inspection-sonic-palette-index" type="number" min={1} max={15} value={editPaletteIndex} onChange={(event) => setEditPaletteIndex(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <label className="flex flex-col gap-1 text-[#7f849c]">R<input data-testid="inspection-sonic-palette-red" type="number" min={0} max={7} value={editRed} onChange={(event) => setEditRed(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <label className="flex flex-col gap-1 text-[#7f849c]">G<input data-testid="inspection-sonic-palette-green" type="number" min={0} max={7} value={editGreen} onChange={(event) => setEditGreen(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <label className="flex flex-col gap-1 text-[#7f849c]">B<input data-testid="inspection-sonic-palette-blue" type="number" min={0} max={7} value={editBlue} onChange={(event) => setEditBlue(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <button type="button" data-testid="inspection-sonic-edit" disabled={editBusy || !session} onClick={() => void editSonicPalette()} className="rounded bg-[#f9e2af] px-3 py-1 font-semibold text-[#1e1e2e]">{editBusy ? "Editando..." : "Editar cor da paleta"}</button>
              </div>
              <div aria-live="polite" data-testid="inspection-palette-message" className="mt-1 break-words text-[#a6e3a1]">{paletteMessage}</div>
              </div>
              {spriteFrame?.sonic_context && <div data-testid="sonic-frame-context" className="mt-2 text-[#bac2de]">Âncora ({spriteFrame.sonic_context.anchor_x}, {spriteFrame.sonic_context.anchor_y}) · mapping {spriteFrame.sonic_context.mapping_index} · DPLC 0x{hex(spriteFrame.sonic_context.dplc_offset)} · {spriteFrame.sonic_context.geometry_version}</div>}
              <div data-testid="inspection-anim-group-pixels">
              {spriteFrame?.sonic_context && <SonicPixelEditor key={`${session.session_id}:${spriteFrameId}`} frame={spriteFrame} disabled={editBusy || spriteFrameBusy} onApply={applySonicPixels} />}
              <div className="mt-2 text-[#f9e2af]">A paleta é compartilhada por todos os frames deste perfil. Pinturas e cores anteriores permanecem na cópia; BPS usa a base original.</div>
              <div data-testid="inspection-sonic-tile-edit" className="mt-3 rounded border border-[#cba6f7]/30 p-2">
                <div className="font-semibold uppercase tracking-[0.14em] text-[#cba6f7]">Reinserção de tiles · 4bpp não comprimido · tamanho preservado</div>
                <div className="mt-1 text-[#cdd6f4]">Pinta um retângulo do frame selecionado com um índice de paleta, direto na arte Art_Sonic da cópia. Pixels fora do mapping, formatos comprimidos, crescimento e tiles compartilhados (DPLC) sem confirmação são recusados.</div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {(["x", "y", "w", "h"] as const).map((key) => (
                    <label key={key} className="flex flex-col gap-1 text-[#7f849c]">{key.toUpperCase()}<input data-testid={`inspection-sonic-tile-${key}`} type="number" min={key === "w" || key === "h" ? 1 : 0} max={key === "x" || key === "w" ? (spriteFrame?.width ?? 32) : (spriteFrame?.height ?? 40)} value={tileEditRect[key]} onChange={(event) => setTileEditRect((rect) => ({ ...rect, [key]: Number(event.target.value) }))} className="w-14 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                  ))}
                  <label className="flex flex-col gap-1 text-[#7f849c]">Índice<input data-testid="inspection-sonic-tile-index" type="number" min={0} max={15} value={tileEditIndex} onChange={(event) => setTileEditIndex(Number(event.target.value))} className="w-14 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                  <label className="flex items-center gap-1 text-[#7f849c]"><input data-testid="inspection-sonic-tile-allow-shared" type="checkbox" checked={tileEditAllowShared} onChange={(event) => setTileEditAllowShared(event.target.checked)} />permitir tiles compartilhados</label>
                  <button type="button" data-testid="inspection-sonic-tile-edit-apply" disabled={editBusy || !session} onClick={() => void editSonicTiles()} className="rounded bg-[#cba6f7] px-3 py-1 font-semibold text-[#1e1e2e]">{editBusy ? "Reinserindo..." : "Reinserir tiles"}</button>
                </div>
                <div aria-live="polite" data-testid="inspection-tile-message" className="mt-1 break-words text-[#a6e3a1]">{tileMessage}</div>
              </div>
              </div>
              {session.edit?.format === "md_4bpp_tile_nibbles" && <div data-testid="inspection-sonic-tile-edit-result" className="mt-2 break-all text-[#a6e3a1]">Tiles de arte {session.edit.art_tiles?.join(", ")} · {session.edit.pixels_changed} pixel(s) · compartilhados com frames DPLC: {session.edit.shared_with_frames?.length ? session.edit.shared_with_frames.join(", ") : "nenhum"} · base após edição {session.edit.base_rom_sha256_after}</div>}
              {session.edit && <div data-testid="inspection-sonic-edit-result" className="mt-2 break-all text-[#a6e3a1]">ROM modificada {session.edit.modified_rom_sha256} · offsets {session.edit.changed_offsets.map((offset) => `0x${hex(offset)}`).join(", ")} · {session.edit.bytes_changed} byte(s)</div>}
              <div data-testid="inspection-work-state" className="mt-2 rounded border border-[#313244] bg-[#0f172a] p-2">
                <div className="text-[9px] uppercase tracking-[0.14em] text-[#7f849c]">Estado do trabalho</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span data-testid="inspection-state-pending" data-visible={String(cadenceProposed !== null)} className={`rounded border px-2 py-1 text-[9px] ${cadenceProposed !== null ? "border-[#f9e2af]/60 text-[#f9e2af]" : "border-[#313244] text-[#7f849c]"}`}>
                    {cadenceProposed !== null ? `Pendente: ${cadenceProposed} ticks propostos; a cópia mantém ${cadence?.current_interval ?? "—"} até você Aplicar duração.` : "Nenhuma proposta pendente."}
                  </span>
                  <span data-testid="inspection-state-applied" data-visible={String(Boolean(session.edit))} className={`rounded border px-2 py-1 text-[9px] ${session.edit ? "border-[#a6e3a1]/60 text-[#a6e3a1]" : "border-[#313244] text-[#7f849c]"}`}>
                    {session.edit ? `Aplicado à cópia ${session.edit.modified_rom_sha256.slice(0, 16)}… (pixels, paleta e/ou duração).` : "Nada aplicado à cópia ainda."}
                  </span>
                  <span data-testid="inspection-state-saved" data-visible={String(savedAt !== null && !unsavedChanges)} className={`rounded border px-2 py-1 text-[9px] ${savedAt === null ? "border-[#313244] text-[#7f849c]" : unsavedChanges ? "border-[#f9e2af]/60 text-[#f9e2af]" : "border-[#a6e3a1]/60 text-[#a6e3a1]"}`}>
                    {savedAt === null ? "Nunca salvo nesta interface." : unsavedChanges ? `Salvo anteriormente · Alterado após salvar: há nova escrita na cópia desde o último salvamento.` : `Salvo · última sessão salva em ${new Date(savedAt).toLocaleString("pt-BR")}.`}
                  </span>
                </div>
              </div>
              {session.edit && <div data-testid="inspection-anim-actions" className="mt-3 grid gap-2">
                <div className="text-[9px] uppercase tracking-[0.14em] text-[#7f849c]">Ações · exportar patch, aplicar à base, jogar e observar</div>
                <div data-testid="sonic-patch-path"><ToolPathField label="Exportar patch BPS" value={patchPath} set={setPatchPath} extensions={["bps"]} accentColor="f9e2af" /></div>
                <button type="button" data-testid="inspection-sonic-export-patch" disabled={patchBusy || !patchPath.trim()} onClick={() => void exportPilotPatch()} className="rounded border border-[#f9e2af]/50 px-3 py-1 text-[#f9e2af]">Exportar patch BPS</button>
                <div data-testid="sonic-applied-path"><ToolPathField label="Salvar ROM modificada aplicada" value={patchedRomPath} set={setPatchedRomPath} extensions={["bin", "md", "gen"]} accentColor="f9e2af" /></div>
                <div className="flex flex-wrap gap-2"><button type="button" data-testid="inspection-sonic-apply-patch" disabled={patchBusy || !patchPath.trim() || !patchedRomPath.trim()} onClick={() => void applyPilotPatch()} className="rounded border border-[#a6e3a1]/50 px-3 py-1 text-[#a6e3a1]">Aplicar à base</button><button type="button" data-testid="inspection-sonic-run-base" disabled={patchBusy || !session.rom_path} onClick={() => void runBaseRom()} className="rounded border border-[#cdd6f4]/50 px-3 py-1 text-[#cdd6f4]">Observar ROM base</button><button type="button" data-testid="inspection-sonic-run-patched" disabled={patchBusy || !patchedRomPath.trim()} onClick={() => void runPatchedRom()} className="rounded border border-[#89b4fa]/50 px-3 py-1 text-[#89b4fa]">Observar ROM aplicada</button><button type="button" data-testid="inspection-sonic-play-base" disabled={patchBusy || !session.rom_path} onClick={playBaseRom} className="rounded border border-[#cdd6f4]/50 px-3 py-1 text-[#cdd6f4]">Jogar ROM base</button><button type="button" data-testid="inspection-sonic-play-modified" disabled={patchBusy || !patchedRomPath.trim()} onClick={playModifiedRom} className="rounded bg-[#89b4fa] px-3 py-1 font-semibold text-[#111827]">Jogar versão modificada</button></div>
                <div aria-live="polite" data-testid="inspection-patch-message" className="break-words text-[#a6e3a1]">{patchMessage}</div>
                <div data-testid="inspection-emulator-run-controls" className="rounded border border-[#313244] bg-[#0f172a] p-2 text-[9px] text-[#bac2de]">
                  <div className="font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">Cenário de execução real</div>
                  <div className="mt-1">Cada observação recarrega a ROM no core, executa um orçamento explícito e envia START pelo IPC; 60 frames isolados não são aceitos como prova de gameplay.</div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1">Frames<input data-testid="inspection-emulator-frame-budget" type="number" min={60} max={10000} step={1} value={emulatorFrameBudget} onChange={(event) => setEmulatorFrameBudget(Number(event.target.value))} className="w-20 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                    <label className="flex flex-col gap-1">Perfil<input data-testid="inspection-emulator-input-profile" readOnly value={emulatorInputProfile === "sonic-boot-start" ? "boot Sonic + START" : "neutro"} className="w-36 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                    <button type="button" data-testid="inspection-emulator-neutral-profile" onClick={() => setEmulatorInputProfile("neutral")} className={`rounded border px-2 py-1 ${emulatorInputProfile === "neutral" ? "border-[#cba6f7] text-[#cba6f7]" : "border-[#313244] text-[#7f849c]"}`}>Neutro</button>
                    <button type="button" data-testid="inspection-emulator-sonic-profile" onClick={() => setEmulatorInputProfile("sonic-boot-start")} className={`rounded border px-2 py-1 ${emulatorInputProfile === "sonic-boot-start" ? "border-[#89b4fa] text-[#89b4fa]" : "border-[#313244] text-[#7f849c]"}`}>Boot + START</button>
                  </div>
                  <div className="mt-1 text-[#f9e2af]">Boot + START: neutro até o frame {SONIC_BOOT_START_FRAME}, START por um frame, depois neutro. A saída só é evidência positiva se o framebuffer mostrar uma cena reconhecível.</div>
                </div>
              </div>}
              {emulatorObservation && <div data-testid="inspection-emulator-observation" data-observation-label={emulatorObservationLabel} data-rom-path={emulatorObservation.rom_path} data-rom-sha256={emulatorObservation.rom_sha256} data-rom-size={emulatorObservation.rom_size} data-core-label={emulatorObservation.core_label} data-core-path={emulatorObservation.core_path} data-frames-run={emulatorObservation.frames_run} data-frames-requested={emulatorFrameBudget} data-input-profile={emulatorInputProfile} data-input-start-frame={emulatorInputProfile === "sonic-boot-start" ? SONIC_BOOT_START_FRAME : ""} data-framebuffer-width={emulatorObservation.framebuffer_width} data-framebuffer-height={emulatorObservation.framebuffer_height} data-framebuffer-sha256={emulatorObservation.framebuffer_sha256} data-non-black-pixels={emulatorObservation.non_black_pixels} className="mt-3 rounded border border-[#89b4fa]/40 bg-[#101b2e] p-3 text-[10px]">
                <div className="font-semibold uppercase tracking-[0.16em] text-[#89b4fa]">Observação real do core · {emulatorObservationLabel}</div>
                <div className="mt-1 break-all text-[#cdd6f4]">{emulatorObservation.message}</div>
                <div className="mt-2 grid gap-1 font-mono text-[9px] text-[#bac2de] md:grid-cols-2">
                  <div>ROM: {emulatorObservation.rom_sha256} · {emulatorObservation.rom_size} bytes</div>
                  <div>Core: {emulatorObservation.core_label} · {emulatorObservation.core_path}</div>
                  <div>Frames observados: {emulatorObservation.frames_run} / orçamento {emulatorFrameBudget}</div>
                  <div>Input: {emulatorInputProfile === "sonic-boot-start" ? `START no frame ${SONIC_BOOT_START_FRAME}` : "neutro"}</div>
                  <div>Framebuffer: {emulatorObservation.framebuffer_width}×{emulatorObservation.framebuffer_height} · {emulatorObservation.non_black_pixels} pixels não pretos</div>
                  <div className="break-all md:col-span-2">RGBA SHA-256: {emulatorObservation.framebuffer_sha256}</div>
                </div>
                <canvas ref={emulatorCanvasRef} data-testid="inspection-emulator-framebuffer" width={emulatorObservation.framebuffer_width} height={emulatorObservation.framebuffer_height} aria-label={"Framebuffer observado da " + emulatorObservationLabel} className="mt-3 block h-auto w-full max-w-[640px] border border-[#313244] bg-black [image-rendering:pixelated]" style={{ imageRendering: "pixelated" }} />
                <div className="mt-2 text-[#a6e3a1]">Critério 1 — ROM carregada e frames/framebuffer produzidos: PASS quando esta observação tem identidade, frames e pixels reais.</div>
                <div data-testid="inspection-palette-effect-status" className="mt-1 text-[#f9e2af]">Critério 2 — alteração de paleta no jogo: a tela expõe a observação real do framebuffer; a confirmação de Sonic visível, ROI e cor editada é feita pelo E2E independente, com base e cópia sob as mesmas condições.</div>
                {emulatorObservationHistory.length > 1 && <div data-testid="inspection-emulator-observation-history" className="mt-2 space-y-1 border-t border-[#313244] pt-2">{emulatorObservationHistory.map((entry) => <div key={entry.label + "-" + entry.observation.rom_sha256} data-testid={"inspection-emulator-observation-" + (entry.label === "ROM base" ? "base" : "applied")} className="break-all text-[#bac2de]">{entry.label}: ROM {entry.observation.rom_sha256} · frames {entry.observation.frames_run} · framebuffer {entry.observation.framebuffer_sha256}</div>)}</div>}
              </div>}
            </div>}
          </div>
        </div>
        <div className="rounded border border-[#313244] bg-[#11111b] p-3">
          <div className="flex flex-wrap gap-2">
              <input aria-label="Buscar candidatos" value={query} onChange={(event) => { const nextQuery = event.target.value; queryRef.current = nextQuery; kindRef.current = kind; setQuery(nextQuery); setPageOffset(0); selectedRef.current = null; previewRequestSeq.current += 1; setSelected(null); setPreview(null); void refreshCatalog(session.session_id, 0, nextQuery, kind); }} placeholder="Buscar método ou tipo" className="min-w-[180px] flex-1 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[10px] text-[#cdd6f4]" />
              <select aria-label="Filtrar candidatos" value={kind} onChange={(event) => { const nextKind = event.target.value; queryRef.current = query; kindRef.current = nextKind; setKind(nextKind); setPageOffset(0); selectedRef.current = null; previewRequestSeq.current += 1; setSelected(null); setPreview(null); void refreshCatalog(session.session_id, 0, query, nextKind); }} className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[10px] text-[#cdd6f4]"><option value="">Todos</option><option value="tiles">Tiles</option><option value="palettes">Paletas</option><option value="unknown">Unknown</option></select>
            </div>
            <div className="mt-2 text-[10px] text-[#7f849c]">{page.total_candidates} candidato(s) · página {Math.floor(pageOffset / PAGE_SIZE) + 1} · descoberta {page.run_id || "não identificada"}</div>
            <div className="mt-3 grid gap-2 xl:grid-cols-2">
              {page.candidates.map((candidate) => <button type="button" data-testid={`inspection-candidate-${candidate.id}`} data-preview-expected={candidate.previews.length > 0} data-candidate-offset={candidate.offset} data-candidate-size={candidate.size} data-candidate-kind={candidate.kind} key={candidate.id} onClick={() => void choose(candidate)} className={`rounded border p-3 text-left ${selected?.id === candidate.id ? "border-[#cba6f7] bg-[#1b1630]" : "border-[#1e1e2e] bg-[#0f172a]"}`}><div className="flex justify-between gap-2 text-[10px]"><span className="font-mono text-[#cdd6f4]">{candidate.kind}</span><span className="text-[#7f849c]">{hex(candidate.offset)} +{candidate.size}</span></div><div className="mt-1 font-mono text-[10px] text-[#cdd6f4]">{candidate.id}</div><div className="mt-1 text-[10px] text-[#94a3b8]">{candidate.method} · confiança {(candidate.confidence * 100).toFixed(1)}% · {candidate.status}</div><div className="mt-1 text-[10px] text-[#7f849c]">{candidate.previews.length ? "prévia disponível" : "prévia indisponível"}</div></button>)}
            </div>
            {page.unknown_regions.map((region) => <div key={`${region.offset}-${region.size}`} className="mt-2 rounded border border-[#f9e2af]/30 bg-[#2a2414] p-2 text-[10px] text-[#f9e2af]">UNKNOWN · {hex(region.offset)} +{region.size} · {region.method}</div>)}
            <div className="mt-3 flex gap-2"><button type="button" disabled={pageOffset === 0} onClick={() => { const next = Math.max(0, pageOffset - PAGE_SIZE); setPageOffset(next); void refreshCatalog(session.session_id, next); }} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#cdd6f4]">Anterior</button><button type="button" disabled={pageOffset + PAGE_SIZE >= page.total_candidates} onClick={() => { const next = pageOffset + PAGE_SIZE; setPageOffset(next); void refreshCatalog(session.session_id, next); }} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#cdd6f4]">Próxima</button></div>
          </div>

          {selected && <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded border border-[#313244] bg-[#11111b] p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[#7f849c]">Pixels e proveniência</div>
              <div className="mt-2 text-[10px] text-[#cdd6f4]">{selected.id} · offset 0x{hex(selected.offset)} · tamanho {selected.size} · método {selected.method}</div>
              {preview?.available && preview.data_url ? <img data-testid="inspection-preview-image" data-preview-width={preview.width ?? ""} data-preview-height={preview.height ?? ""} data-png-sha256={preview.png_sha256 ?? ""} data-pixels-sha256={preview.pixels_sha256 ?? ""} data-artifact-sha256={preview.artifact?.sha256 ?? ""} src={preview.data_url} alt={`Prévia real de ${selected.id}`} className="mt-3 max-w-full border border-[#313244] bg-black [image-rendering:pixelated]" /> : <div data-testid="inspection-preview-unavailable" className="mt-3 rounded border border-[#f9e2af]/30 bg-[#2a2414] p-3 text-[10px] text-[#f9e2af]">{preview?.reason || "Prévia indisponível; nenhum placeholder representa bytes recuperados."}</div>}
              {preview?.artifact && <div className="mt-2 break-all font-mono text-[9px] text-[#7f849c]">PNG {preview.png_sha256} · pixels RGBA {preview.pixels_sha256}</div>}
            </div>
            <div className="rounded border border-[#313244] bg-[#11111b] p-3 text-[10px]">
              <div className="text-[#7f849c]">Associação manual de paleta</div>
              {selected.kind === "tile4bpp_block" ? <><select aria-label="Paleta manual" value={selectedPalette} onChange={(event) => setSelectedPalette(event.target.value)} className="mt-2 w-full rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[10px] text-[#cdd6f4]"><option value="">Selecionar paleta...</option>{palettes.map((palette) => <option key={palette.id} value={palette.id}>{palette.id} · 0x{hex(palette.offset)}</option>)}</select><button type="button" disabled={!selectedPalette} onClick={() => void saveChoice()} className="mt-2 rounded bg-[#a6e3a1] px-3 py-1 text-[10px] font-semibold text-[#1e1e2e]">Salvar associação do usuário</button>{selectedChoice && <div className="mt-2 text-[#a6e3a1]">Associação do usuário preservada: {selectedChoice.palette_candidate_id}</div>}</> : <div className="mt-2 text-[#7f849c]">Selecione um bloco de tiles para associar uma paleta.</div>}
            </div>
          </div>}
        </>
      )}
    </div>
  );
}
