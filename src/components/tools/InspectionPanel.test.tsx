import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InspectionPanel from "./InspectionPanel";

const mocks = vi.hoisted(() => ({
  inspectionOpen: vi.fn(),
  inspectionStart: vi.fn(),
  inspectionCancel: vi.fn(),
  inspectionStatus: vi.fn(),
  inspectionListSessions: vi.fn(),
  listenInspectionProgress: vi.fn(),
  inspectionCatalogPage: vi.fn(),
  inspectionPreview: vi.fn(),
  inspectionReopen: vi.fn(),
  inspectionSave: vi.fn(),
  inspectionSavePaletteChoice: vi.fn(),
  inspectionSpriteFrame: vi.fn(),
}));

vi.mock("../../core/ipc/toolsService", () => mocks);

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  schema_version: "rex-inspection-session/v1",
  session_id: "session-visual-001",
  rom_path: "/roms/test.md",
  identity: {
    original_sha256: "a".repeat(64),
    normalized_sha256: "b".repeat(64),
    original_size: 4096,
    normalized_size: 4096,
    variant: "Mega Drive",
    header_console: "SEGA GENESIS",
    header_title: "VISUAL TEST",
    region: "U",
    version: "01",
    size_note: null,
  },
  catalog_artifact: { label: "catalog", path: "/artifacts/catalog.json", sha256: "c".repeat(64) },
  artifact_refs: [],
  user_choice_artifacts: [],
  discovery_run_id: null,
  status: "identified",
  candidates_total: 0,
  unknown_bytes: 4096,
  created_at_unix: 1,
  completed_at_unix: null,
  error: null,
};

const running = {
  run_id: "run-visual-001",
  session_id: session.session_id,
  generation: 2,
  status: "running",
  progress: {
    session_id: session.session_id,
    run_id: "run-visual-001",
    generation: 2,
    phase: "discover",
    status: "running",
    completed_work: 35,
    total_work: 100,
    candidates_found: 2,
    message: "Descobrindo candidatos",
  },
  started_at_unix: 2,
  finished_at_unix: null,
  error: null,
};

const completedSession = { ...session, status: "completed", candidates_total: 2, unknown_bytes: 2048, discovery_run_id: "run-visual-001" };
const completed = { ...running, status: "completed", progress: { ...running.progress, status: "completed", completed_work: 100, message: "Descoberta concluída" }, finished_at_unix: 3 };

const candidateA = { id: "candidate-a", offset: 0x100, size: 32, kind: "tile4bpp_block", status: "candidate", method: "grid", confidence: 0.9, evidence: {}, previews: [] };
const candidateB = { id: "candidate-b", offset: 0x200, size: 32, kind: "tile4bpp_block", status: "candidate", method: "grid", confidence: 0.8, evidence: {}, previews: [] };

function setTextInput(input: Element, value: string) {
  if (!(input instanceof HTMLInputElement)) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("InspectionPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectionOpen.mockResolvedValue(session);
    mocks.inspectionStart.mockResolvedValue(running);
    mocks.inspectionCancel.mockResolvedValue({ ...running, status: "cancelled", progress: { ...running.progress, status: "cancelled", completed_work: 100, message: "Análise cancelada" } });
    mocks.inspectionStatus.mockResolvedValue({ session: { ...session, status: "running" }, run: running });
    mocks.inspectionListSessions.mockResolvedValue([]);
    mocks.listenInspectionProgress.mockResolvedValue(() => undefined);
    mocks.inspectionCatalogPage.mockResolvedValue({ session_id: session.session_id, run_id: "", offset: 0, limit: 24, total_candidates: 0, candidates: [], unknown_regions: [], user_choices: [] });
    mocks.inspectionSpriteFrame.mockResolvedValue({
      session_id: completedSession.session_id,
      resource_id: "spr_ryo_100",
      frame_id: "spr_ryo_100/frame-0",
      available: true,
      width: 64,
      height: 104,
      data_url: "data:image/png;base64,sprite",
      artifact: { label: "sprite-frame", path: "/artifacts/sprite.png", sha256: "d".repeat(64) },
      png_sha256: "e".repeat(64),
      pixels_sha256: "f".repeat(64),
      rom_sha256: "b".repeat(64),
      tile_data_offset: 0x863a0,
      tile_data_size: 0x800,
      palette_offset: 0x2cc68,
      palette_size: 0x20,
      descriptor_offset: 0x22260,
      flip_x: false,
      flip_y: false,
      transparency_index: 0,
      parts: [],
      metadata_source: "Metadado doador + bytes compilados verificáveis",
      rom_evidence: [],
      donor_evidence: [],
      limitations: [],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("identifies a BYOR ROM, starts discovery, and cancels through IPC", async () => {
    await act(async () => {
      root.render(<InspectionPanel logMessage={vi.fn()} />);
      await flush();
    });

    const romInput = container.querySelector("input[type='text']");
    expect(romInput).toBeTruthy();

    await act(async () => {
      setTextInput(romInput as Element, "/roms/test.md");
      await flush();
    });

    const button = (label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement;

    await act(async () => {
      button("Identificar base").click();
      await flush();
    });
    expect(mocks.inspectionOpen).toHaveBeenCalledWith("/roms/test.md");
    expect(container.textContent).toContain("VISUAL TEST");
    expect(container.textContent).toContain("somente leitura");

    await act(async () => {
      button("Executar descoberta").click();
      await flush();
    });
    expect(mocks.inspectionStart).toHaveBeenCalledWith(session.session_id, 2);
    expect(container.textContent).toContain("Descobrindo candidatos");

    await act(async () => {
      button("Cancelar análise").click();
      await flush();
    });
    expect(mocks.inspectionCancel).toHaveBeenCalledWith(session.session_id, running.run_id);
    expect(container.textContent).toContain("Análise cancelada");
  });

  it("keeps a completion emitted before start returns and reconciles the final status", async () => {
    let progressCallback: ((progress: typeof running.progress) => void) | undefined;
    mocks.listenInspectionProgress.mockImplementation(async (callback: typeof progressCallback) => {
      progressCallback = callback;
      return () => undefined;
    });
    mocks.inspectionStart.mockImplementation(async () => {
      expect(progressCallback).toBeTypeOf("function");
      progressCallback?.({ ...running.progress, status: "completed", completed_work: 100, message: "Concluída antes do retorno" });
      return completed;
    });
    mocks.inspectionStatus.mockResolvedValue({ session: completedSession, run: completed });
    mocks.inspectionCatalogPage.mockResolvedValue({ session_id: session.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 1, candidates: [candidateA], unknown_regions: [], user_choices: [] });

    await act(async () => {
      root.render(<InspectionPanel logMessage={vi.fn()} />);
      await flush();
    });
    const input = container.querySelector("input[type='text']");
    setTextInput(input as Element, "/roms/test.md");
    await act(async () => { await flush(); });
    const button = (label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement;
    await act(async () => { button("Identificar base").click(); await flush(); });
    await act(async () => { button("Executar descoberta").click(); await flush(); await flush(); });

    expect(mocks.listenInspectionProgress).toHaveBeenCalledBefore(mocks.inspectionStart);
    expect(container.textContent).toContain("Análise concluída");
    expect(container.textContent).toContain("candidate-a");
  });

  it("does not let a slow preview for candidate A replace candidate B", async () => {
    const pending = new Map<string, (value: { session_id: string; candidate_id: string; available: boolean; data_url: string; artifact: null; png_sha256: null; pixels_sha256: null }) => void>();
    mocks.inspectionOpen.mockResolvedValue(completedSession);
    mocks.inspectionStatus.mockResolvedValue({ session: completedSession, run: completed });
    mocks.inspectionCatalogPage.mockImplementation(async (_sessionId: string, _offset: number, _limit: number, _query: string, requestedKind: string) => requestedKind === "palettes"
      ? { session_id: session.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 0, candidates: [], unknown_regions: [], user_choices: [] }
      : { session_id: session.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 2, candidates: [candidateA, candidateB], unknown_regions: [], user_choices: [] });
    mocks.inspectionPreview.mockImplementation((_sessionId: string, candidateId: string) => new Promise((resolve) => pending.set(candidateId, resolve)));

    await act(async () => {
      root.render(<InspectionPanel logMessage={vi.fn()} />);
      await flush();
    });
    const input = container.querySelector("input[type='text']");
    setTextInput(input as Element, "/roms/test.md");
    await act(async () => { await flush(); });
    const identifyButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Identificar base") as HTMLButtonElement;
    await act(async () => { identifyButton.click(); await flush(); await flush(); });
    const candidateButton = (id: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(id)) as HTMLButtonElement;
    await act(async () => { candidateButton("candidate-a").click(); candidateButton("candidate-b").click(); await flush(); });
    await act(async () => { pending.get("candidate-b")?.({ session_id: session.session_id, candidate_id: "candidate-b", available: true, data_url: "data:image/png;base64,B", artifact: null, png_sha256: null, pixels_sha256: null }); await flush(); });
    await act(async () => { pending.get("candidate-a")?.({ session_id: session.session_id, candidate_id: "candidate-a", available: true, data_url: "data:image/png;base64,A", artifact: null, png_sha256: null, pixels_sha256: null }); await flush(); });

    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,B");
    expect(container.querySelector("img")?.getAttribute("alt")).toContain("candidate-b");
  });

  it("lists saved sessions after remount and reopens the selected one", async () => {
    const saved = { ...completedSession, session_id: "session-persisted-002", rom_path: "/roms/persisted.md" };
    mocks.inspectionListSessions.mockResolvedValue([saved]);
    mocks.inspectionReopen.mockResolvedValue(saved);
    mocks.inspectionCatalogPage.mockResolvedValue({ session_id: saved.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 0, candidates: [], unknown_regions: [], user_choices: [] });

    await act(async () => {
      root.render(<InspectionPanel logMessage={vi.fn()} />);
      await flush();
    });
    expect(container.textContent).toContain("session-persisted-002");

    await act(async () => { root.unmount(); await flush(); });
    root = createRoot(container);
    await act(async () => { root.render(<InspectionPanel logMessage={vi.fn()} />); await flush(); });
    const selectButton = container.querySelector("[data-testid='select-saved-session-session-persisted-002']");
    expect(selectButton).toBeTruthy();
    await act(async () => { (selectButton as HTMLButtonElement).click(); await flush(); });
    const reopenButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Reabrir sessão") as HTMLButtonElement;
    await act(async () => { reopenButton.click(); await flush(); await flush(); });

    expect(mocks.inspectionReopen).toHaveBeenCalledWith("/roms/persisted.md", "session-persisted-002");
    expect(container.textContent).toContain("session-persisted-002");
  });

  it("renders the donor-assisted composed sprite frame through IPC", async () => {
    mocks.inspectionOpen.mockResolvedValue(completedSession);
    mocks.inspectionStatus.mockResolvedValue({ session: completedSession, run: completed });
    mocks.inspectionCatalogPage.mockResolvedValue({ session_id: completedSession.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 0, candidates: [], unknown_regions: [], user_choices: [] });

    await act(async () => {
      root.render(<InspectionPanel logMessage={vi.fn()} />);
      await flush();
    });
    const input = container.querySelector("input[type='text']");
    setTextInput(input as Element, "/roms/test.md");
    await act(async () => { await flush(); });
    const identifyButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Identificar base") as HTMLButtonElement;
    await act(async () => { identifyButton.click(); await flush(); await flush(); });
    const composeButton = container.querySelector("[data-testid='inspection-compose-sprite']") as HTMLButtonElement;
    expect(composeButton).toBeTruthy();
    await act(async () => { composeButton.click(); await flush(); });

    expect(mocks.inspectionSpriteFrame).toHaveBeenCalledWith(completedSession.session_id, "spr_ryo_100", "spr_ryo_100/frame-0", false, false);
    const spriteImage = container.querySelector("[data-testid='inspection-sprite-frame-image']") as HTMLImageElement;
    expect(spriteImage.getAttribute("data-sprite-frame")).toBe("spr_ryo_100/frame-0");
    expect(spriteImage.getAttribute("width")).toBe("192");
    expect(spriteImage.getAttribute("height")).toBe("312");
    expect(spriteImage.dataset.spriteScale).toBe("3");
    expect(spriteImage.style.width).toBe("192px");
    expect(spriteImage.style.height).toBe("312px");
    expect(spriteImage.style.maxWidth).toBe("none");
    expect(container.querySelector("[data-testid='inspection-sprite-frame-stage']")).toBeTruthy();
    expect(container.querySelector("[data-testid='inspection-sprite-frame-metadata']")).toBeTruthy();
    expect(container.textContent).toContain("Não é prévia de tile");
  });

  it("selects a second manifest-backed frame without changing the resource provenance", async () => {
    mocks.inspectionOpen.mockResolvedValue(completedSession);
    mocks.inspectionStatus.mockResolvedValue({ session: completedSession, run: completed });
    mocks.inspectionCatalogPage.mockResolvedValue({ session_id: completedSession.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 0, candidates: [], unknown_regions: [], user_choices: [] });

    await act(async () => {
      root.render(<InspectionPanel logMessage={vi.fn()} />);
      await flush();
    });
    setTextInput(container.querySelector("input[type='text']") as Element, "/roms/test.md");
    await act(async () => { await flush(); });
    const identifyButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Identificar base") as HTMLButtonElement;
    await act(async () => { identifyButton.click(); await flush(); await flush(); });
    const frameSelect = container.querySelector("[data-testid='inspection-sprite-frame-select']") as HTMLSelectElement;
    frameSelect.value = "spr_ryo_100/frame-1";
    frameSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await act(async () => { await flush(); });
    await act(async () => { (container.querySelector("[data-testid='inspection-compose-sprite']") as HTMLButtonElement).click(); await flush(); });

    expect(mocks.inspectionSpriteFrame).toHaveBeenCalledWith(completedSession.session_id, "spr_ryo_100", "spr_ryo_100/frame-1", false, false);
  });

  it("keeps frame B image, selection, and provenance when frame A resolves out of order", async () => {
    const frameA = createDeferred<Record<string, unknown>>();
    const frameB = createDeferred<Record<string, unknown>>();
    const startedA = createDeferred<void>();
    const startedB = createDeferred<void>();
    mocks.inspectionOpen.mockResolvedValue(completedSession);
    mocks.inspectionStatus.mockResolvedValue({ session: completedSession, run: completed });
    mocks.inspectionCatalogPage.mockResolvedValue({ session_id: completedSession.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 0, candidates: [], unknown_regions: [], user_choices: [] });
    mocks.inspectionSpriteFrame.mockImplementation((_sessionId: string, _resourceId: string, frameId: string) => {
      if (frameId === "spr_ryo_100/frame-0") {
        startedA.resolve();
        return frameA.promise;
      }
      startedB.resolve();
      return frameB.promise;
    });

    await act(async () => {
      root.render(<InspectionPanel logMessage={vi.fn()} />);
      await flushMicrotasks();
    });
    setTextInput(container.querySelector("input[type='text']") as Element, "/roms/test.md");
    await act(async () => { await flushMicrotasks(); });
    const identifyButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Identificar base") as HTMLButtonElement;
    await act(async () => { identifyButton.click(); await flushMicrotasks(); });

    const frameSelect = container.querySelector("[data-testid='inspection-sprite-frame-select']") as HTMLSelectElement;
    const composeButton = () => container.querySelector("[data-testid='inspection-compose-sprite']") as HTMLButtonElement;
    await act(async () => {
      composeButton().click();
      await startedA.promise;
    });

    frameSelect.value = "spr_ryo_100/frame-1";
    frameSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await act(async () => { await flushMicrotasks(); });
    await act(async () => {
      composeButton().click();
      await startedB.promise;
    });

    await act(async () => {
      frameB.resolve({
        session_id: completedSession.session_id,
        resource_id: "spr_ryo_100",
        frame_id: "spr_ryo_100/frame-1",
        available: true,
        width: 64,
        height: 104,
        data_url: "data:image/png;base64,frame-B",
        artifact: null,
        png_sha256: "png-B",
        pixels_sha256: "pixels-B",
        rom_sha256: "b".repeat(64),
        tile_data_offset: 0x86ba0,
        tile_data_size: 0x840,
        palette_offset: 0x2cc68,
        palette_size: 0x20,
        descriptor_offset: 0x222a2,
        flip_x: false,
        flip_y: false,
        transparency_index: 0,
        parts: [],
        metadata_source: "proveniência B",
        rom_evidence: [],
        donor_evidence: [],
        limitations: [],
      });
      await flushMicrotasks();
    });

    expect((container.querySelector("[data-testid='inspection-sprite-frame-select']") as HTMLSelectElement).value).toBe("spr_ryo_100/frame-1");
    expect(container.querySelector("[data-testid='inspection-sprite-frame-image']")?.getAttribute("src")).toBe("data:image/png;base64,frame-B");
    expect(container.querySelector("[data-testid='inspection-sprite-frame-image']")?.getAttribute("data-sprite-frame")).toBe("spr_ryo_100/frame-1");
    expect(container.textContent).toContain("proveniência B");

    await act(async () => {
      frameA.resolve({
        session_id: completedSession.session_id,
        resource_id: "spr_ryo_100",
        frame_id: "spr_ryo_100/frame-0",
        available: true,
        width: 64,
        height: 104,
        data_url: "data:image/png;base64,frame-A",
        artifact: null,
        png_sha256: "png-A",
        pixels_sha256: "pixels-A",
        rom_sha256: "b".repeat(64),
        tile_data_offset: 0x863a0,
        tile_data_size: 0x800,
        palette_offset: 0x2cc68,
        palette_size: 0x20,
        descriptor_offset: 0x22260,
        flip_x: false,
        flip_y: false,
        transparency_index: 0,
        parts: [],
        metadata_source: "proveniência A",
        rom_evidence: [],
        donor_evidence: [],
        limitations: [],
      });
      await flushMicrotasks();
    });

    expect((container.querySelector("[data-testid='inspection-sprite-frame-select']") as HTMLSelectElement).value).toBe("spr_ryo_100/frame-1");
    expect(container.querySelector("[data-testid='inspection-sprite-frame-image']")?.getAttribute("src")).toBe("data:image/png;base64,frame-B");
    expect(container.querySelector("[data-testid='inspection-sprite-frame-image']")?.getAttribute("data-sprite-frame")).toBe("spr_ryo_100/frame-1");
    expect(container.textContent).toContain("proveniência B");
    expect(container.textContent).not.toContain("proveniência A");
  });

  it("rejects a delayed response carrying the wrong frame metadata without reusing the previous image", async () => {
    mocks.inspectionOpen.mockResolvedValue(completedSession);
    mocks.inspectionStatus.mockResolvedValue({ session: completedSession, run: completed });
    mocks.inspectionCatalogPage.mockResolvedValue({ session_id: completedSession.session_id, run_id: completed.run_id, offset: 0, limit: 24, total_candidates: 0, candidates: [], unknown_regions: [], user_choices: [] });
    mocks.inspectionSpriteFrame.mockResolvedValue({
      session_id: completedSession.session_id,
      resource_id: "spr_ryo_100",
      frame_id: "spr_ryo_100/frame-0",
      available: true,
      width: 64,
      height: 104,
      data_url: "data:image/png;base64,wrong-frame",
      png_sha256: "wrong",
      pixels_sha256: "wrong",
      rom_sha256: "b".repeat(64),
      tile_data_offset: 0x863a0,
      tile_data_size: 0x800,
      palette_offset: 0x2cc68,
      palette_size: 0x20,
      descriptor_offset: 0x22260,
      flip_x: false,
      flip_y: false,
      transparency_index: 0,
      parts: [],
      metadata_source: "wrong",
      rom_evidence: [],
      donor_evidence: [],
      limitations: [],
    });

    await act(async () => { root.render(<InspectionPanel logMessage={vi.fn()} />); await flush(); });
    setTextInput(container.querySelector("input[type='text']") as Element, "/roms/test.md");
    await act(async () => { await flush(); });
    const identifyButton = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Identificar base") as HTMLButtonElement;
    await act(async () => { identifyButton.click(); await flush(); await flush(); });
    const frameSelect = container.querySelector("[data-testid='inspection-sprite-frame-select']") as HTMLSelectElement;
    frameSelect.value = "spr_ryo_100/frame-1";
    frameSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await act(async () => { await flush(); });
    await act(async () => { (container.querySelector("[data-testid='inspection-compose-sprite']") as HTMLButtonElement).click(); await flush(); });

    expect(container.querySelector("[data-testid='inspection-sprite-frame-image']")).toBeNull();
  });
});
