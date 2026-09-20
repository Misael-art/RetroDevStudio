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
  inspectionEditSonicPalette,
  inspectionListSessions,
  inspectionOpen,
  inspectionPreview,
  inspectionReopen,
  inspectionSave,
  inspectionSavePaletteChoice,
  inspectionSpriteFrame,
  inspectionStatus,
  inspectionStart,
  listenInspectionProgress,
  patchApplyBps,
  patchCreateBps,
} from "../../core/ipc/toolsService";
import { emulatorLoadRom, emulatorRunFrame } from "../../core/ipc/emulatorService";
import { useEditorStore } from "../../core/store/editorStore";
import ToolPathField from "./ToolPathField";

interface InspectionPanelProps {
  logMessage: (level: "info" | "success" | "warn" | "error", message: string) => void;
}

const PAGE_SIZE = 24;

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

function statusLabel(status: string): string {
  return {
    identified: "Base identificada",
    running: "Análise em andamento",
    completed: "Análise concluída",
    cancelled: "Análise cancelada",
    failed: "Análise falhou",
  }[status] ?? status;
}

export default function InspectionPanel({ logMessage }: InspectionPanelProps) {
  const activeProjectDir = useEditorStore((state) => state.activeProjectDir);
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
  const [editRed, setEditRed] = useState(7);
  const [editGreen, setEditGreen] = useState(7);
  const [editBlue, setEditBlue] = useState(7);
  const [editBusy, setEditBusy] = useState(false);
  const [patchPath, setPatchPath] = useState("");
  const [patchedRomPath, setPatchedRomPath] = useState("");
  const [patchBusy, setPatchBusy] = useState(false);
  const generation = useRef(0);
  const lastSessionId = useRef("");
  const savedSessionId = useRef("");
  const sessionRef = useRef<InspectionSession | null>(null);
  const selectedRef = useRef<InspectionCandidate | null>(null);
  const queryRef = useRef("");
  const kindRef = useRef("");
  const catalogRequestSeq = useRef(0);
  const previewRequestSeq = useRef(0);
  const sessionRequestSeq = useRef(0);
  const statusRequestSeq = useRef(0);
  const savedSessionsRequestSeq = useRef(0);
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
    setSpriteFrame(null);
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

  async function reopen() {
    const id = session?.session_id || savedSessionId.current || lastSessionId.current;
    if (!id || !romPath.trim()) return;
    const requestId = ++sessionRequestSeq.current;
    invalidateAsyncRequests();
    setBusy(true);
    try {
      const next = await inspectionReopen(romPath, id);
      if (requestId !== sessionRequestSeq.current) return;
      sessionRef.current = next;
      savedSessionId.current = next.session_id;
      setSelectedSavedSessionId(next.session_id);
      setSession(next);
      setSpriteFrameId(next.sprite_frame_id ?? "spr_ryo_100/frame-0");
      setRun(null);
      if (next.status === "completed") await refreshCatalog(next.session_id, 0);
      logMessage("success", `[Inspeção] Sessão ${id} reaberta e identidade verificada.`);
    } catch (error) {
      logMessage("error", `[Inspeção] Reabertura recusada: ${describeError(error)}`);
    } finally {
      if (requestId === sessionRequestSeq.current) setBusy(false);
    }
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

  async function composeSpriteFrame() {
    const sessionId = sessionRef.current?.session_id;
    if (!sessionId) return;
    const requestedFrameId = spriteFrameId;
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
      logMessage("success", `[Inspeção] Frame composto ${resourceId} verificado contra bytes e metadado doador.`);
    } catch (error) {
      if (requestId !== previewRequestSeq.current || sessionRef.current?.session_id !== sessionId) return;
      logMessage("error", `[Inspeção] Composição de sprite recusada: ${describeError(error)}`);
    } finally {
      if (requestId === previewRequestSeq.current) setSpriteFrameBusy(false);
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
      logMessage("success", "[Inspeção] Snapshot da sessão salvo.");
      void refreshSavedSessions();
    } catch (error) {
      logMessage("error", `[Inspeção] Falha ao salvar sessão: ${describeError(error)}`);
    }
  }

  async function editSonicPalette() {
    if (!session || spriteFrameId !== "sonic1_sonic/stand") return;
    setEditBusy(true);
    try {
      const edit = await inspectionEditSonicPalette(
        session.session_id,
        "sonic1_sonic",
        "sonic1_sonic/stand",
        editPaletteIndex,
        editRed,
        editGreen,
        editBlue,
      );
      const next = { ...session, edit };
      sessionRef.current = next;
      setSession(next);
      setSpriteFrame(null);
      logMessage("success", `[Inspeção] Edição persistida em cópia BYOR: ${edit.modified_rom_sha256}.`);
    } catch (error) {
      logMessage("error", `[Inspeção] Edição recusada: ${describeError(error)}`);
    } finally {
      setEditBusy(false);
    }
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
      logMessage(result.ok ? "success" : "error", `[Patch] ${result.message}${result.patch_hash ? ` CRC32 ${result.patch_hash}` : ""}`);
    } catch (error) {
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
      logMessage(result.ok ? "success" : "error", `[Patch] ${result.message}`);
    } catch (error) {
      logMessage("error", `[Patch] Aplicação recusada: ${describeError(error)}`);
    } finally {
      setPatchBusy(false);
    }
  }

  async function runPatchedRom() {
    if (!patchedRomPath.trim()) return;
    setPatchBusy(true);
    try {
      const loaded = await emulatorLoadRom(patchedRomPath.trim());
      if (!loaded.ok) throw new Error(loaded.message);
      for (let frame = 0; frame < 60; frame += 1) {
        const result = await emulatorRunFrame();
        if (!result.ok) throw new Error(result.message);
      }
      logMessage("success", "[Emulador] ROM modificada carregada e executada por 60 frames no core canônico.");
    } catch (error) {
      logMessage("error", `[Emulador] Execução recusada: ${describeError(error)}`);
    } finally {
      setPatchBusy(false);
    }
  }

  function closeSession() {
    const currentSessionId = sessionRef.current?.session_id;
    if (currentSessionId) {
      lastSessionId.current = currentSessionId;
      savedSessionId.current = currentSessionId;
      setSelectedSavedSessionId(currentSessionId);
    }
    sessionRequestSeq.current += 1;
    invalidateAsyncRequests();
    sessionRef.current = null;
    selectedRef.current = null;
    setBusy(false);
    setSession(null);
    setRun(null);
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

  return (
    <div data-testid="reverse-inspection-panel" className="space-y-3">
      <div className="rounded border border-[#313244] bg-[#11111b] p-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#cba6f7]">Inspeção visual · Experimental</div>
        <p className="mb-3 text-[10px] text-[#94a3b8]">Leitura somente; candidatos heurísticos não promovem bytes e não são sprites montados.</p>
        <ToolPathField label="ROM BYOR" value={romPath} set={setRomPath} extensions={["md", "gen", "bin", "smd"]} accentColor="cba6f7" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" data-testid="inspection-identify" onClick={() => void identify()} disabled={busy} className="rounded bg-[#cba6f7] px-3 py-1 text-[10px] font-semibold text-[#1e1e2e]">Identificar base</button>
          <button type="button" data-testid="inspection-reopen" onClick={() => void reopen()} disabled={busy || !(session?.session_id || selectedSavedSessionId || lastSessionId.current)} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#cdd6f4]">Reabrir sessão</button>
          {session && <button type="button" data-testid="inspection-save" onClick={() => void save()} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#cdd6f4]">Salvar sessão</button>}
          {session && <button type="button" data-testid="inspection-close" onClick={closeSession} className="rounded border border-[#313244] px-3 py-1 text-[10px] text-[#f9e2af]">Fechar sessão</button>}
        </div>
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
            <span className="rounded-full border border-[#cba6f7]/40 bg-[#cba6f7]/10 px-2 py-1 text-[#cba6f7]">somente leitura</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="font-mono text-[#cdd6f4]">ROM {session.identity.original_sha256}</div>
            <div className="font-mono text-[#cdd6f4]">normalizada {session.identity.normalized_sha256}</div>
          </div>
          <div className="mt-2 text-[#7f849c]">Sessão {session.session_id} · catálogo {session.catalog_artifact.sha256} · desconhecido {session.unknown_bytes} bytes</div>
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
          <div data-testid="inspection-sprite-frame-panel" className="rounded border border-[#cba6f7]/40 bg-[#11111b] p-3 text-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#cba6f7]">Frame composto · recurso assistido · Experimental</div>
                <div className="mt-1 text-[#f9e2af]">Não é prévia de tile: composição assistida por metadado doador, com bytes compilados verificados.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-[#cdd6f4]">Frame
                  <select data-testid="inspection-sprite-frame-select" value={spriteFrameId} onChange={(event) => { setSpriteFrameId(event.target.value); setSpriteFrame(null); }} className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[10px] text-[#cdd6f4]">
                    <option value="spr_ryo_100/frame-0">spr_ryo_100 / frame 0</option>
                    <option value="spr_ryo_100/frame-1">spr_ryo_100 / frame 1</option>
                    <option value="spr_ryo_100/frame-2">spr_ryo_100 / frame 2</option>
                    <option value="spr_ryo_100/frame-3">spr_ryo_100 / frame 3</option>
                    <option value="spr_ryo_100/frame-4">spr_ryo_100 / frame 4 (deduplicado)</option>
                    <option value="spr_spark0/frame-0">spr_spark0 / frame 0 · Taiketsu</option>
                    <option value="sonic1_sonic/stand">sonic1_sonic / stand · Sonic 1 (assistido)</option>
                  </select>
                </label>
                <button type="button" data-testid="inspection-compose-sprite" onClick={() => void composeSpriteFrame()} aria-busy={spriteFrameBusy} className="rounded bg-[#cba6f7] px-3 py-1 text-[10px] font-semibold text-[#1e1e2e]">{spriteFrameBusy ? "Compondo..." : "Compor frame"}</button>
              </div>
            </div>
            {spriteFrame?.available && spriteFrame.data_url && <div className="mt-3 flex min-w-0 flex-col gap-3">
              <div data-testid="inspection-sprite-frame-stage" className="min-w-0 overflow-auto rounded border border-[#313244] bg-[#0b0f19] p-2" aria-label="Área reservada do frame composto">
                <div className="w-[196px] min-w-[196px] shrink-0">
                  <img data-testid="inspection-sprite-frame-image" data-sprite-resource={spriteFrame.resource_id} data-sprite-frame={spriteFrame.frame_id} data-sprite-rom-sha256={spriteFrame.rom_sha256} data-sprite-width={spriteFrame.width} data-sprite-height={spriteFrame.height} data-sprite-scale="3" data-png-sha256={spriteFrame.png_sha256 ?? ""} data-pixels-sha256={spriteFrame.pixels_sha256 ?? ""} src={spriteFrame.data_url} alt={`Frame composto ${spriteFrame.resource_id}`} width={spriteFrame.width * 3} height={spriteFrame.height * 3} className="block shrink-0 border border-[#313244] bg-[#ff00ff] [image-rendering:pixelated]" style={{ boxSizing: "content-box", imageRendering: "pixelated", width: `${spriteFrame.width * 3}px`, height: `${spriteFrame.height * 3}px`, maxWidth: "none", maxHeight: "none" }} />
                </div>
              </div>
              <div data-testid="inspection-sprite-frame-metadata" className="min-w-0 space-y-1 break-words text-[#cdd6f4]">
                <div className="font-mono text-[9px] text-[#7f849c]">Conteúdo CSS {spriteFrame.width * 3}×{spriteFrame.height * 3}px · escala inteira 3× · nativo {spriteFrame.width}×{spriteFrame.height}px</div>
                <div className="font-mono text-[9px] break-all text-[#7f849c]">RGBA pixels: {spriteFrame.pixels_sha256}</div>
                <div className="break-all">ROM recuperada: {spriteFrame.rom_sha256}</div>
                <div className="break-all">Bytes de tiles: 0x{hex(spriteFrame.tile_data_offset)} + {spriteFrame.tile_data_size} · paleta: 0x{hex(spriteFrame.palette_offset)} + {spriteFrame.palette_size}</div>
                <div className="break-all">Descritores VDP: 0x{hex(spriteFrame.descriptor_offset)} · flip X/Y: {String(spriteFrame.flip_x)}/{String(spriteFrame.flip_y)} · transparência: índice {spriteFrame.transparency_index}</div>
                <div className="text-[#f9e2af] break-words">{spriteFrame.metadata_source}</div>
                <div className="mt-2 text-[#7f849c] break-words">Doador: {spriteFrame.donor_evidence.join(" · ")}</div>
                <div className="mt-2 text-[#7f849c] break-words">Limitações: {spriteFrame.limitations.join(" · ")}</div>
              </div>
            </div>}
            {spriteFrameId === "sonic1_sonic/stand" && <div data-testid="inspection-sonic-edit-panel" className="mt-3 rounded border border-[#f9e2af]/30 bg-[#2a2414] p-3 text-[10px]">
              <div className="font-semibold uppercase tracking-[0.16em] text-[#f9e2af]">Edição piloto · paleta MD RGB333</div>
              <div className="mt-1 text-[#cdd6f4]">Opera somente sobre uma cópia persistida da ROM; o arquivo BYOR original nunca é sobrescrito.</div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[#7f849c]">Índice<input data-testid="inspection-sonic-palette-index" type="number" min={1} max={15} value={editPaletteIndex} onChange={(event) => setEditPaletteIndex(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <label className="flex flex-col gap-1 text-[#7f849c]">R<input data-testid="inspection-sonic-palette-red" type="number" min={0} max={7} value={editRed} onChange={(event) => setEditRed(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <label className="flex flex-col gap-1 text-[#7f849c]">G<input data-testid="inspection-sonic-palette-green" type="number" min={0} max={7} value={editGreen} onChange={(event) => setEditGreen(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <label className="flex flex-col gap-1 text-[#7f849c]">B<input data-testid="inspection-sonic-palette-blue" type="number" min={0} max={7} value={editBlue} onChange={(event) => setEditBlue(Number(event.target.value))} className="w-16 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[#cdd6f4]" /></label>
                <button type="button" data-testid="inspection-sonic-edit" disabled={editBusy || !session} onClick={() => void editSonicPalette()} className="rounded bg-[#f9e2af] px-3 py-1 font-semibold text-[#1e1e2e]">{editBusy ? "Editando..." : "Editar pela interface"}</button>
              </div>
              {session.edit && <div data-testid="inspection-sonic-edit-result" className="mt-2 break-all text-[#a6e3a1]">ROM modificada {session.edit.modified_rom_sha256} · offsets {session.edit.changed_offsets.map((offset) => `0x${hex(offset)}`).join(", ")} · {session.edit.bytes_changed} byte(s)</div>}
              {session.edit && <div className="mt-3 grid gap-2">
                <ToolPathField label="Exportar patch BPS" value={patchPath} set={setPatchPath} extensions={["bps"]} accentColor="f9e2af" />
                <button type="button" data-testid="inspection-sonic-export-patch" disabled={patchBusy || !patchPath.trim()} onClick={() => void exportPilotPatch()} className="rounded border border-[#f9e2af]/50 px-3 py-1 text-[#f9e2af]">Exportar patch BPS</button>
                <ToolPathField label="Salvar ROM modificada aplicada" value={patchedRomPath} set={setPatchedRomPath} extensions={["bin", "md", "gen"]} accentColor="f9e2af" />
                <div className="flex flex-wrap gap-2"><button type="button" data-testid="inspection-sonic-apply-patch" disabled={patchBusy || !patchPath.trim() || !patchedRomPath.trim()} onClick={() => void applyPilotPatch()} className="rounded border border-[#a6e3a1]/50 px-3 py-1 text-[#a6e3a1]">Aplicar à base</button><button type="button" data-testid="inspection-sonic-run-patched" disabled={patchBusy || !patchedRomPath.trim()} onClick={() => void runPatchedRom()} className="rounded border border-[#89b4fa]/50 px-3 py-1 text-[#89b4fa]">Carregar e executar 60 frames</button></div>
              </div>}
            </div>}
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
