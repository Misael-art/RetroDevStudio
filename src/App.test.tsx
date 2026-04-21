import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getGameViewportScale } from "./components/viewport/gameViewportScale";
import { useEditorStore } from "./core/store/editorStore";
import { LIVE_VALIDATION_DEBOUNCE_MS } from "./core/validation/liveValidationController";

const mocks = vi.hoisted(() => ({
  buildProject: vi.fn(),
  validateProject: vi.fn(),
  generateCCode: vi.fn(),
  emulatorLoadRom: vi.fn(),
  emulatorSaveState: vi.fn(),
  emulatorLoadState: vi.fn(),
  emulatorRewindStep: vi.fn(),
  emulatorStartRecording: vi.fn(),
  emulatorStopRecording: vi.fn(),
  emulatorPlayReplay: vi.fn(),
  emulatorStop: vi.fn(),
  emulatorSendInput: vi.fn(),
  startFrameLoop: vi.fn(),
  listenToAudioStream: vi.fn(),
  getHwStatus: vi.fn(),
  validateSceneDraft: vi.fn(),
  openProjectDialog: vi.fn(),
  openProjectPath: vi.fn(),
  newProjectDialog: vi.fn(),
  dialogOpen: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  listProjectTemplates: vi.fn(),
  listExternalImportProfiles: vi.fn(),
  createProjectFromTemplate: vi.fn(),
  importExternalProject: vi.fn(),
  importSgdkProject: vi.fn(),
  importMugenProject: vi.fn(),
  suggestProjectBaseDir: vi.fn(),
  previewProjectDestination: vi.fn(),
  setProjectTarget: vi.fn(),
  hydrateSceneResult: vi.fn(),
  persistActiveScene: vi.fn(),
  reloadSceneFromDisk: vi.fn(),
  getThirdPartyStatus: vi.fn(),
  installThirdPartyDependency: vi.fn(),
  detectRomDependency: vi.fn(),
  pollProjectAssetChanges: vi.fn(),
  listenToProjectAssetChanges: vi.fn(),
  getSceneData: vi.fn(),
  listScenes: vi.fn(),
  switchScene: vi.fn(),
  listProjectAssets: vi.fn(),
  readLegacyProjectFile: vi.fn(),
}));

vi.mock("./components/common/Console", () => ({
  default: () => <div data-testid="console" />,
}));

vi.mock("./components/hierarchy/HierarchyPanel", () => ({
  default: () => <div data-testid="hierarchy" />,
}));

vi.mock("./components/inspector/InspectorPanel", () => ({
  default: () => <div data-testid="inspector" />,
}));

vi.mock("./components/tools/ToolsPanel", () => ({
  default: ({
    initialActive,
    workspace,
    showAdvancedByDefault,
  }: {
    initialActive?: string;
    workspace?: string;
    showAdvancedByDefault?: boolean;
  }) => (
    <div
      data-testid="tools"
      data-active={initialActive ?? ""}
      data-workspace={workspace ?? ""}
      data-advanced={showAdvancedByDefault ? "true" : "false"}
    />
  ),
}));

vi.mock("./components/nodegraph/NodeGraphEditor", () => ({
  default: () => <div data-testid="nodegraph" />,
}));

vi.mock("./components/retrofx/RetroFXDesigner", () => ({
  default: () => <div data-testid="retrofx" />,
}));

vi.mock("./components/viewport/ViewportPanel", () => ({
  default: ({ showWorkspaceTabs }: { showWorkspaceTabs?: boolean }) => {
    const {
      activeProjectDir,
      activeScene,
      activeScenePath,
      activeViewportTab,
      emulatorLoaded,
      emulPaused,
      hwStatus,
      projectSourceKind,
      selectedEntityId,
      setEmulPaused,
      updateEntity,
      logMessage,
    } = useEditorStore();
    const [emulatorActive, setEmulatorActive] = useState(false);
    const [gameViewLight, setGameViewLight] = useState(false);
    const [showPerformanceOverlay, setShowPerformanceOverlay] = useState(true);
    const [assetHotReloadNotice, setAssetHotReloadNotice] = useState<string | null>(null);
    const [sceneGuideCount, setSceneGuideCount] = useState(0);
    const loopStopRef = useRef<(() => void) | null>(null);
    const dragActiveRef = useRef(false);
    const gameCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const audioContextRef = useRef<{
      destination: unknown;
      state?: string;
      close: () => Promise<void>;
      createGain: () => {
        gain: { value: number };
        connect: (node: unknown) => void;
        disconnect: () => void;
      };
      createScriptProcessor: () => {
        onaudioprocess: ((event: unknown) => void) | null;
        connect: (node: unknown) => void;
        disconnect: () => void;
      };
      suspend?: () => Promise<void>;
      resume?: () => Promise<void>;
    } | null>(null);
    const audioGainRef = useRef<{
      gain: { value: number };
      connect: (node: unknown) => void;
      disconnect: () => void;
    } | null>(null);
    const audioProcessorRef = useRef<{
      onaudioprocess: ((event: unknown) => void) | null;
      connect: (node: unknown) => void;
      disconnect: () => void;
    } | null>(null);
    const audioUnlistenRef = useRef<(() => void) | null>(null);

    function renderGameFrame(payload: { width: number; height: number; rgba: number[] }) {
      const canvas = gameCanvasRef.current;
      if (!canvas) {
        return;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      const imageData = context.createImageData(payload.width, payload.height);
      imageData.data.set(new Uint8ClampedArray(payload.rgba));
      context.putImageData(imageData, 0, 0);
    }

    function disposeAudioPlayback() {
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
        void context.close();
      }
    }

    useEffect(() => {
      for (const entity of activeScene?.entities ?? []) {
        const assetPath = entity.components?.sprite?.asset;
        if (!assetPath || !activeProjectDir) {
          continue;
        }
        void mocks.convertFileSrc(`${activeProjectDir}/${assetPath}`);
      }
    }, [activeProjectDir, activeScene]);

    useEffect(() => {
      if (activeViewportTab !== "game" || !emulatorLoaded || emulPaused) {
        loopStopRef.current?.();
        loopStopRef.current = null;
        if (activeViewportTab !== "game" || !emulatorLoaded) {
          setEmulatorActive(false);
        }
        return;
      }

      let cancelled = false;
      setEmulatorActive(false);
      void mocks.startFrameLoop((payload: { width: number; height: number; rgba: number[] }) => {
        renderGameFrame(payload);
      }).then((stopLoop: () => void) => {
        if (cancelled) {
          stopLoop();
          return;
        }
        loopStopRef.current = stopLoop;
        setEmulatorActive(true);
      });

      return () => {
        cancelled = true;
        loopStopRef.current?.();
        loopStopRef.current = null;
        setEmulatorActive(false);
      };
    }, [activeViewportTab, emulatorLoaded, emulPaused]);

    useEffect(() => {
      if (activeViewportTab !== "game") {
        setAssetHotReloadNotice(null);
        return;
      }

      let disposed = false;
      let unlisten: (() => void) | undefined;
      void mocks.listenToProjectAssetChanges((payload: { project_dir: string; changed_paths: string[] }) => {
        if (disposed || payload.project_dir !== activeProjectDir) {
          return;
        }
        setAssetHotReloadNotice(payload.changed_paths.join(", "));
      }).then((dispose: () => void) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      });

      return () => {
        disposed = true;
        unlisten?.();
      };
    }, [activeProjectDir, activeViewportTab]);

    useEffect(() => {
      if (activeViewportTab !== "game") {
        disposeAudioPlayback();
        return;
      }

      let cancelled = false;
      void mocks.listenToAudioStream(
        async (payload: { sample_rate: number; samples: number[] }) => {
          if (cancelled) {
            return;
          }

          if (!audioContextRef.current) {
            const AudioContextCtor = window.AudioContext as
              | (new (...args: unknown[]) => {
                  destination: unknown;
                  state?: string;
                  close: () => Promise<void>;
                  createGain: () => {
                    gain: { value: number };
                    connect: (node: unknown) => void;
                    disconnect: () => void;
                  };
                  createScriptProcessor: () => {
                    onaudioprocess: ((event: unknown) => void) | null;
                    connect: (node: unknown) => void;
                    disconnect: () => void;
                  };
                  suspend?: () => Promise<void>;
                  resume?: () => Promise<void>;
                })
              | undefined;
            if (!AudioContextCtor) {
              return;
            }

            const context = new AudioContextCtor();
            const gainNode = context.createGain();
            const processor = context.createScriptProcessor();
            processor.connect(gainNode);
            gainNode.connect(context.destination);
            audioContextRef.current = context;
            audioGainRef.current = gainNode;
            audioProcessorRef.current = processor;
          }

          const context = audioContextRef.current;
          if (!context) {
            return;
          }

          if (emulPaused) {
            await context.suspend?.();
          } else {
            await context.resume?.();
          }
          void payload;
        }
      ).then((dispose: () => void) => {
        if (cancelled) {
          dispose();
          return;
        }
        audioUnlistenRef.current = dispose;
      });

      return () => {
        cancelled = true;
        disposeAudioPlayback();
      };
    }, [activeViewportTab, emulPaused]);

    useEffect(() => {
      if (activeViewportTab !== "game") {
        return;
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (!emulatorLoaded || !emulPaused || event.code !== "KeyR") {
          return;
        }
        void mocks.emulatorRewindStep().then((result: { message: string }) => {
          logMessage("info", `[Rewind] ${result.message}`);
        });
      }

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeViewportTab, emulatorLoaded, emulPaused, logMessage]);

    function onboardingContent() {
      if (projectSourceKind === "external_sgdk") {
        return {
          title: "Projeto SGDK legado em overlay",
          body: "Este workspace usa um overlay rds/ e o Build & Run continua delegado ao Makefile do host.",
        };
      }

      if (projectSourceKind === "imported_sgdk") {
        return {
          title: "Projeto importado de SGDK",
          body: "Este projeto ja foi convertido para o formato nativo do RetroDev.",
        };
      }

      return null;
    }

    function handleSceneResize() {
      if (!selectedEntityId || !activeScene) {
        return;
      }
      const entity = activeScene.entities.find((item) => item.entity_id === selectedEntityId);
      if (!entity?.components?.sprite) {
        return;
      }
      updateEntity(selectedEntityId, {
        components: {
          sprite: {
            ...entity.components.sprite,
            frame_width: 32,
            frame_height: 32,
          },
        },
      });
    }

    async function handleSaveState() {
      const result = await mocks.emulatorSaveState();
      logMessage("success", `[Emulador] ${result.message}`);
    }

    async function handleLoadState() {
      const result = await mocks.emulatorLoadState();
      logMessage("success", `[Emulador] ${result.message}`);
    }

    async function handleStepFrame() {
      const stopStepLoop = await mocks.startFrameLoop((payload: { width: number; height: number; rgba: number[] }) => {
        renderGameFrame(payload);
      });
      stopStepLoop();
      logMessage("info", "Frame unico executado.");
    }

    async function handleRewind() {
      const result = await mocks.emulatorRewindStep();
      logMessage("info", `[Rewind] ${result.message}`);
    }

    const onboarding = onboardingContent();
    const gameStatus = !emulatorLoaded
      ? "Carregue uma ROM para iniciar o emulador"
      : emulPaused
        ? "Emulador pausado"
        : emulatorActive
          ? "Emulador ativo"
          : "ROM carregada - aguardando emulador...";

    return (
      <div data-testid="viewport-panel-mock" data-show-workspace-tabs={showWorkspaceTabs ? "true" : "false"}>
        {onboarding ? (
          <div data-testid="viewport-sgdk-onboarding">
            <strong>{onboarding.title}</strong>
            <span>{onboarding.body}</span>
          </div>
        ) : null}

        {activeViewportTab === "scene" && (
          <div>
            <button type="button" onClick={() => setGameViewLight((current) => !current)}>
              GV
            </button>
            {!gameViewLight ? (
              <>
                <canvas
                  data-testid="viewport-scene-ruler-top"
                  onMouseDown={() => {
                    const storageKey = `rds:scene-guides:${encodeURIComponent(activeProjectDir)}:${encodeURIComponent(
                      activeScenePath || activeScene?.scene_id || ""
                    )}`;
                    const finalizeGuide = () => {
                      localStorage.setItem(
                        storageKey,
                        JSON.stringify([{ id: "guide-test", orientation: "vertical", position: 32 }])
                      );
                      setSceneGuideCount(1);
                    };
                    window.addEventListener("mouseup", finalizeGuide, { once: true });
                  }}
                />
                <canvas data-testid="viewport-scene-ruler-left" />
              </>
            ) : null}
            <canvas
              data-testid="viewport-scene-overlay"
              onMouseDown={() => {
                dragActiveRef.current = true;
              }}
              onMouseMove={(event) => {
                if (!(event.buttons & 1) || !dragActiveRef.current) {
                  return;
                }
                handleSceneResize();
              }}
              onMouseUp={() => {
                dragActiveRef.current = false;
                void mocks.persistActiveScene(activeProjectDir, "Viewport");
              }}
            />
            <div>{sceneGuideCount} guia(s)</div>
          </div>
        )}

        {activeViewportTab === "game" && (
          <div>
            <canvas ref={gameCanvasRef} data-testid="viewport-game-canvas" />
            {assetHotReloadNotice ? (
              <div data-testid="viewport-asset-hot-reload">
                Assets alterados no disco. {assetHotReloadNotice}
              </div>
            ) : null}
            <span data-testid="viewport-game-status">{gameStatus}</span>
            <button type="button" data-testid="viewport-resume" onClick={() => setEmulPaused(false)}>
              Retomar
            </button>
            <button type="button" data-testid="viewport-step-frame" onClick={() => void handleStepFrame()}>
              Step 1 frame
            </button>
            <button type="button" onClick={() => void handleSaveState()}>
              Salvar state
            </button>
            <button type="button" onClick={() => void handleLoadState()}>
              Carregar state
            </button>
            <button type="button" data-testid="viewport-rewind" onClick={() => void handleRewind()}>
              Rewind
            </button>
            <button type="button" onClick={() => setShowPerformanceOverlay((current) => !current)}>
              {showPerformanceOverlay ? "Overlay ON" : "Overlay OFF"}
            </button>
            {showPerformanceOverlay && hwStatus ? (
              <div data-testid="viewport-performance-overlay">
                <span>Sprites {hwStatus.sprite_count}</span>
                <span>DMA est. {hwStatus.dma_used}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.dialogOpen,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: mocks.convertFileSrc,
}));

vi.mock("./core/ipc/buildService", () => ({
  buildProject: mocks.buildProject,
  validateProject: mocks.validateProject,
  generateCCode: mocks.generateCCode,
}));

vi.mock("./core/ipc/emulatorService", () => ({
  JOYPAD_DEFAULT: {
    b: false,
    y: false,
    select: false,
    start: false,
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    x: false,
    l: false,
    r: false,
  },
  emulatorLoadRom: mocks.emulatorLoadRom,
  emulatorSaveState: mocks.emulatorSaveState,
  emulatorLoadState: mocks.emulatorLoadState,
  emulatorRewindStep: mocks.emulatorRewindStep,
  emulatorStartRecording: mocks.emulatorStartRecording,
  emulatorStopRecording: mocks.emulatorStopRecording,
  emulatorPlayReplay: mocks.emulatorPlayReplay,
  emulatorStop: mocks.emulatorStop,
  emulatorSendInput: mocks.emulatorSendInput,
  startFrameLoop: mocks.startFrameLoop,
  listenToAudioStream: mocks.listenToAudioStream,
  keyToJoypad: vi.fn(() => null),
}));

vi.mock("./core/ipc/hwService", () => ({
  getHwStatus: mocks.getHwStatus,
  validateSceneDraft: mocks.validateSceneDraft,
}));

vi.mock("./core/ipc/projectService", () => ({
  openProjectDialog: mocks.openProjectDialog,
  openProjectPath: mocks.openProjectPath,
  newProjectDialog: mocks.newProjectDialog,
  listProjectTemplates: mocks.listProjectTemplates,
  listExternalImportProfiles: mocks.listExternalImportProfiles,
  createProjectFromTemplate: mocks.createProjectFromTemplate,
  importExternalProject: mocks.importExternalProject,
  importSgdkProject: mocks.importSgdkProject,
  importMugenProject: mocks.importMugenProject,
  suggestProjectBaseDir: mocks.suggestProjectBaseDir,
  previewProjectDestination: mocks.previewProjectDestination,
  setProjectTarget: mocks.setProjectTarget,
}));

vi.mock("./core/scenePersistence", () => ({
  hydrateSceneResult: mocks.hydrateSceneResult,
  persistActiveScene: mocks.persistActiveScene,
  reloadSceneFromDisk: mocks.reloadSceneFromDisk,
}));

vi.mock("./core/ipc/sceneService", () => ({
  getSceneData: mocks.getSceneData,
  listScenes: mocks.listScenes,
  switchScene: mocks.switchScene,
}));

vi.mock("./core/ipc/toolsService", () => ({
  getThirdPartyStatus: mocks.getThirdPartyStatus,
  installThirdPartyDependency: mocks.installThirdPartyDependency,
  detectRomDependency: mocks.detectRomDependency,
  listProjectAssets: mocks.listProjectAssets,
  readLegacyProjectFile: mocks.readLegacyProjectFile,
}));

vi.mock("./core/ipc/projectWatcherService", () => ({
  pollProjectAssetChanges: mocks.pollProjectAssetChanges,
  listenToProjectAssetChanges: mocks.listenToProjectAssetChanges,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function flushUntil(condition: () => boolean, attempts = 8, delayMs = 0) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    });
    if (condition()) {
      break;
    }
  }
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function createDependencyStatus(id: string) {
  return {
    id,
    label: id,
    installed: true,
    version: "test",
    install_dir: "F:/deps",
    source_url: "https://example.invalid",
    auto_install_supported: true,
    notes: [],
    issues: [],
  };
}

function sanitizeProjectDirNameForMock(projectName: string) {
  const sanitized = projectName
    .trim()
    .split("")
    .map((character) => (/[A-Za-z0-9_-]/.test(character) ? character : "_"))
    .join("")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");

  return sanitized || "Projeto";
}

function createProjectDestinationPreview(
  projectName: string,
  baseDir: string,
  overrides: Partial<Record<string, unknown>> = {}
) {
  const normalizedBaseDir = baseDir || "C:/Users/Test/Documents/RetroDevProjects";
  const safeName = sanitizeProjectDirNameForMock(projectName);
  return {
    requested_name: projectName.trim() || "Projeto",
    suggested_name: projectName.trim() || "Projeto",
    requested_dir_name: safeName,
    suggested_dir_name: safeName,
    preferred_path: `${normalizedBaseDir}/${safeName}`,
    resolved_path: `${normalizedBaseDir}/${safeName}`,
    collision_status: "available",
    existing_project_path: null,
    existing_project_name: null,
    ...overrides,
  };
}

function defaultProjectTemplates() {
  return [
    {
      id: "empty",
      name: "Projeto Vazio",
      description: "Cena vazia sem entidades. Para quem quer comecar do zero.",
      genre: "blank",
      difficulty: "beginner",
      features: [],
      source_kind: "builtin",
      recommended_target: "megadrive",
      experimental: false,
      available: true,
      availability_reason: null,
      default_donor_path: null,
    },
    {
      id: "starter_guided",
      name: "Primeiro Projeto",
      description: "Sprite placeholder com logica minima. Ideal para aprender o editor.",
      genre: "tutorial",
      difficulty: "beginner",
      features: ["sprite", "logic"],
      source_kind: "builtin",
      recommended_target: "megadrive",
      experimental: false,
      available: true,
      availability_reason: null,
      default_donor_path: null,
    },
    {
      id: "platformer_seed",
      name: "Plataforma",
      description: "Sprite de personagem, tilemap de cenario e som de pulo importados de template SGDK externo.",
      genre: "platformer",
      difficulty: "intermediate",
      features: ["sprite", "tilemap", "physics", "collision", "input", "audio", "camera"],
      source_kind: "external_sgdk",
      recommended_target: "megadrive",
      experimental: true,
      available: true,
      availability_reason: "Requer uma pasta doadora SGDK escolhida manualmente neste host.",
      default_donor_path: null,
    },
    {
      id: "platformer_gm",
      name: "Plataforma GameMaker",
      description: "Experiencia completa estilo GameMaker: camadas nomeadas, colisao visual, prefabs prontos e paleta vibrante. Mega Drive only.",
      genre: "platformer",
      difficulty: "intermediate",
      features: ["sprite", "tilemap", "physics", "collision", "input", "audio", "camera", "layers"],
      source_kind: "external_sgdk",
      recommended_target: "megadrive",
      experimental: true,
      available: true,
      availability_reason: "Requer uma pasta doadora SGDK escolhida manualmente neste host.",
      default_donor_path: null,
    },
  ];
}

function defaultExternalImportProfiles() {
  return [
    {
      id: "sgdk",
      name: "SGDK",
      family: "16-bit",
      description: "Importa manifests .res, assets, cena base e audio de projetos SGDK externos.",
      source_engine: "sgdk",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      recommended_target: "megadrive",
      experimental: true,
      importable: true,
      mega_drive_only: true,
    },
    {
      id: "mugen",
      name: "MUGEN",
      family: "Fighting",
      description: "Importa personagem, stage e screenpack via DEF/AIR com assets visuais e sonoros reais.",
      source_engine: "mugen",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      recommended_target: "megadrive",
      experimental: true,
      importable: true,
      mega_drive_only: true,
    },
    {
      id: "ikemen_go",
      name: "Ikemen GO",
      family: "Fighting",
      description: "Reaproveita o adapter conservador do eixo MUGEN com metadata propria.",
      source_engine: "ikemen_go",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      recommended_target: "megadrive",
      experimental: true,
      importable: true,
      mega_drive_only: true,
    },
    {
      id: "godot",
      name: "Godot 2D",
      family: "2D Geral",
      description: "Importa Sprite2D, Camera2D e AudioStreamPlayer de cenas .tscn com proveniencia registrada.",
      source_engine: "godot",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      recommended_target: "megadrive",
      experimental: true,
      importable: true,
      mega_drive_only: true,
    },
    {
      id: "construct",
      name: "Construct",
      family: "2D Event Sheet",
      description: "Importa layouts, sprites, audio e preserva event sheets como hints explicitos.",
      source_engine: "construct",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      recommended_target: "megadrive",
      experimental: true,
      importable: true,
      mega_drive_only: true,
    },
    {
      id: "rpg_maker",
      name: "RPG Maker",
      family: "Data-driven RPG",
      description: "Importa mapas, personagens, audio e eventos como hints explicitos.",
      source_engine: "rpg_maker",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      recommended_target: "megadrive",
      experimental: true,
      importable: true,
      mega_drive_only: true,
    },
    {
      id: "openbor",
      name: "OpenBOR",
      family: "Beat'em up",
      description: "Importa modelos, estagios e audio com hints explicitos de logica.",
      source_engine: "openbor",
      support_status: "Experimental",
      supported_levels: ["L1", "L2", "L3"],
      recommended_target: "megadrive",
      experimental: true,
      importable: true,
      mega_drive_only: true,
    },
    {
      id: "gamemaker",
      name: "GameMaker Studio 2",
      family: "2D Geral",
      description: "Perfil planejado para rooms, sprites e sounds, ainda sem adapter canonico.",
      source_engine: "gamemaker",
      support_status: "Parcial",
      supported_levels: ["L1"],
      recommended_target: "megadrive",
      experimental: true,
      importable: false,
      mega_drive_only: true,
    },
  ];
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

function findButtonInContext(
  container: HTMLElement,
  label: string,
  contextText: string
): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((element) => {
    if (!(element instanceof HTMLButtonElement) || element.textContent?.trim() !== label) {
      return false;
    }

    return element.parentElement?.textContent?.includes(contextText) ?? false;
  });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label} in context ${contextText}`);
  }

  return button;
}

describe("getGameViewportScale", () => {
  it("uses integer scaling that fits the available area", () => {
    expect(getGameViewportScale(640, 448)).toBe(2);
    expect(getGameViewportScale(960, 672)).toBe(3);
  });

  it("falls back to 1x when space is tight or invalid", () => {
    expect(getGameViewportScale(500, 300)).toBe(1);
    expect(getGameViewportScale(0, 0)).toBe(1);
  });
});

describe("App build flow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let putImageDataSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeProjectName: "Mega Dummy",
      activeTarget: "megadrive",
      emulatorLoaded: false,
      selectedEntityId: null,
      activeViewportTab: "scene",
      activeWorkspace: "scene",
      hwStatus: null,
      sceneRevision: 1,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      hwValidationRefreshTick: 0,
      activeScene: {
        scene_id: "main_scene",
        display_name: "Main Scene",
        entities: [],
        background_layers: [],
      },
      activeSceneSource: {
        scene_id: "main_scene",
        display_name: "Main Scene",
        entities: [],
        background_layers: [],
      },
      projectSourceKind: "external_sgdk",
      projectLegacyIndex: {
        host_root: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/legacy",
        source_files: ["src/main.c"],
        header_files: ["inc/main.h"],
        manifest_files: ["res/gfx.res"],
        resource_files: ["assets/hero.png"],
        output_files: [],
      },
      emulPaused: false,
      consoleEntries: [],
      consoleVisible: true,
    });

    mocks.hydrateSceneResult.mockResolvedValue({
      sourceScene: {
        scene_id: "main_scene",
        display_name: "Main Scene",
        entities: [],
        background_layers: [],
      },
      resolvedScene: {
        scene_id: "main_scene",
        display_name: "Main Scene",
        entities: [],
        background_layers: [],
      },
    });
    mocks.getSceneData.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify({
        scene_id: "main_scene",
        display_name: "Main Scene",
        entities: [],
        background_layers: [],
      }),
      project_name: "Mega Dummy",
      target: "megadrive",
      scene_path: "scenes/main.json",
      source_kind: "external_sgdk",
      legacy_sgdk_index: {
        host_root: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/legacy",
        source_files: ["src/main.c"],
        header_files: ["inc/main.h"],
        manifest_files: ["res/gfx.res"],
        resource_files: ["assets/hero.png"],
        output_files: [],
      },
    });
    mocks.listScenes.mockResolvedValue([
      {
        path: "scenes/main.json",
        scene_id: "main_scene",
        display_name: "Main Scene",
      },
      {
        path: "scenes/boss.json",
        scene_id: "boss_scene",
        display_name: "Boss Scene",
      },
    ]);
    mocks.switchScene.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify({
        scene_id: "boss_scene",
        display_name: "Boss Scene",
        entities: [],
        background_layers: [],
      }),
      project_name: "Mega Dummy",
      target: "megadrive",
      scene_path: "scenes/boss.json",
      source_kind: "external_sgdk",
      legacy_sgdk_index: {
        host_root: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/legacy",
        source_files: ["src/main.c"],
        header_files: ["inc/main.h"],
        manifest_files: ["res/gfx.res"],
        resource_files: ["assets/hero.png"],
        output_files: [],
      },
    });
    mocks.listProjectAssets.mockResolvedValue([
      {
        relative_path: "assets/sprites/hero.png",
        absolute_path:
          "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/sprites/hero.png",
        kind: "image",
      },
      {
        relative_path: "assets/audio/jump.wav",
        absolute_path:
          "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/audio/jump.wav",
        kind: "audio",
      },
    ]);
    mocks.readLegacyProjectFile.mockResolvedValue({
      relative_path: "src/main.c",
      absolute_path:
        "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/legacy/src/main.c",
      content: "int main(void) { return 0; }",
      previewable: true,
      readonly: true,
      note: "Arquivo legado somente leitura.",
    });
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.reloadSceneFromDisk.mockResolvedValue(true);
    mocks.dialogOpen.mockResolvedValue("F:/Projects/RetroDevStudio/tests/fixtures");
    mocks.listProjectTemplates.mockResolvedValue(defaultProjectTemplates());
    mocks.listExternalImportProfiles.mockResolvedValue(defaultExternalImportProfiles());
    mocks.suggestProjectBaseDir.mockResolvedValue(
      "C:/Users/Test/Documents/RetroDevProjects"
    );
    mocks.previewProjectDestination.mockImplementation((projectName: string, baseDir: string) =>
      Promise.resolve(createProjectDestinationPreview(projectName, baseDir))
    );
    mocks.createProjectFromTemplate.mockResolvedValue({
      selected: true,
      path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      name: "MeuProjeto",
    });
    mocks.importExternalProject.mockResolvedValue({
      selected: true,
      path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      name: "Importado Externo",
      notice: "Importacao externa experimental concluida com 1 cena nativa.",
    });
    mocks.importSgdkProject.mockResolvedValue({
      selected: true,
      path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      name: "Importado SGDK",
      notice: "Projeto SGDK importado para o formato nativo.",
    });
    mocks.importMugenProject.mockResolvedValue({
      selected: true,
      path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      name: "Importado MUGEN",
      notice: "Importacao MUGEN experimental concluida com 3 cena(s) e 1 origem(ns) ignorada(s).",
    });
    mocks.getHwStatus.mockResolvedValue({
      vram_used: 0,
      vram_limit: 65536,
      sprite_count: 0,
      sprite_limit: 80,
      scanline_sprite_peak: 0,
      scanline_sprite_limit: 20,
      dma_used: 0,
      dma_limit: 7372,
      palette_banks_used: 0,
      palette_banks_limit: 4,
      bg_layers: 0,
      bg_layers_limit: 4,
      errors: [],
      warnings: [],
    });
    mocks.validateSceneDraft.mockResolvedValue({
      ok: true,
      error: "",
      hw_status: {
        vram_used: 0,
        vram_limit: 65536,
        sprite_count: 0,
        sprite_limit: 80,
        scanline_sprite_peak: 0,
        scanline_sprite_limit: 20,
        dma_used: 0,
        dma_limit: 7372,
        palette_banks_used: 0,
        palette_banks_limit: 4,
        bg_layers: 0,
        bg_layers_limit: 4,
        errors: [],
        warnings: [],
      },
    });
    mocks.getThirdPartyStatus.mockResolvedValue({
      items: [
        createDependencyStatus("jdk"),
        createDependencyStatus("sgdk"),
        createDependencyStatus("libretro_megadrive"),
        createDependencyStatus("pvsneslib"),
        createDependencyStatus("libretro_snes"),
      ],
    });
    mocks.buildProject.mockImplementation(async (_projectDir: string, onLog: (line: { level: string; message: string }) => void) => {
      onLog({ level: "info", message: "build log" });
      return {
        ok: true,
        rom_path: "F:/Temp/game.md",
        log: [],
      };
    });
    mocks.emulatorLoadRom.mockResolvedValue({
      ok: true,
      message: "ROM carregada",
    });
    mocks.emulatorStop.mockResolvedValue({
      ok: true,
      message: "Emulador parado",
    });
    mocks.emulatorSaveState.mockResolvedValue({
      ok: true,
      message: "Save state salvo (8 bytes).",
    });
    mocks.emulatorLoadState.mockResolvedValue({
      ok: true,
      message: "Save state restaurado.",
    });
    mocks.emulatorRewindStep.mockResolvedValue({
      ok: true,
      message: "Rewind restaurado para o frame 0 (0 snapshot(s) restantes, intervalo 1 frame(s)).",
    });
    mocks.emulatorStartRecording.mockResolvedValue({
      ok: true,
      message: "Gravacao de replay iniciada.",
      replay_path: "",
      frames_recorded: 0,
      framebuffer_match: null,
    });
    mocks.emulatorStopRecording.mockResolvedValue({
      ok: true,
      message: "Replay salvo no diretorio do projeto.",
      replay_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/replay-1.rds-replay",
      frames_recorded: 3,
      framebuffer_match: null,
    });
    mocks.emulatorPlayReplay.mockResolvedValue({
      ok: true,
      message: "Replay reproduzido (3 frame(s)); framebuffer final confere com a gravacao.",
      replay_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/replay-1.rds-replay",
      frames_recorded: 3,
      framebuffer_match: true,
    });
    mocks.emulatorSendInput.mockResolvedValue({
      ok: true,
      message: "",
    });
    mocks.listenToAudioStream.mockResolvedValue(vi.fn());
    mocks.pollProjectAssetChanges.mockResolvedValue({
      changed: false,
      changed_paths: [],
    });
    mocks.listenToProjectAssetChanges.mockResolvedValue(vi.fn());
    mocks.startFrameLoop.mockImplementation(async (onFrame: (payload: { width: number; height: number; rgba: number[] }) => void) => {
      onFrame({ width: 1, height: 1, rgba: [255, 0, 0, 255] });
      return vi.fn();
    });

    putImageDataSpy = vi.fn();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }),
        clearRect: vi.fn(),
        putImageData: putImageDataSpy,
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        strokeRect: vi.fn(),
        drawImage: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        save: vi.fn(),
        setLineDash: vi.fn(),
        restore: vi.fn(),
      })),
    });

    await Promise.all([
      import("./components/viewport/ViewportPanel"),
      import("./components/tools/ToolsPanel"),
      import("./components/inspector/InspectorPanel"),
      import("./components/explorer/ExplorerWorkspace"),
    ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flush();
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("hydrates an existing project through the automation openProject bridge", async () => {
    const automationWindow = window as Window & {
      __TAURI_INTERNALS__?: unknown;
      __RDS_E2E__?: {
        openProject: (projectDir: string) => Promise<boolean>;
      };
    };
    automationWindow.__TAURI_INTERNALS__ = {};

    mocks.openProjectPath.mockResolvedValue({
      selected: true,
      path: "F:/Projects/RetroDevStudio/src-tauri/tests/fixtures/projects/snes_dummy",
      name: "SNES Dummy",
    });
    mocks.getHwStatus.mockResolvedValue({
      vram_used: 1024,
      vram_limit: 65536,
      sprite_count: 4,
      sprite_limit: 128,
      scanline_sprite_peak: 2,
      scanline_sprite_limit: 32,
      dma_used: 128,
      dma_limit: 7372,
      palette_banks_used: 2,
      palette_banks_limit: 8,
      bg_layers: 2,
      bg_layers_limit: 4,
      errors: [],
      warnings: [],
    });
    mocks.getSceneData.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify({
        scene_id: "level1",
        display_name: "Level 1",
        entities: [
          {
            entity_id: "hero",
            display_name: "Hero",
            transform: { x: 24, y: 32 },
            components: {},
          },
        ],
        background_layers: [],
      }),
      project_name: "SNES Dummy",
      target: "snes",
      scene_path: "scenes/level1.json",
      source_kind: "builtin",
      legacy_sgdk_index: null,
    });
    mocks.hydrateSceneResult.mockResolvedValue({
      sourceScene: {
        scene_id: "level1",
        display_name: "Level 1",
        entities: [
          {
            entity_id: "hero",
            display_name: "Hero",
            transform: { x: 24, y: 32 },
            components: {},
          },
        ],
        background_layers: [],
      },
      resolvedScene: {
        scene_id: "level1",
        display_name: "Level 1",
        entities: [
          {
            entity_id: "hero",
            display_name: "Hero",
            transform: { x: 24, y: 32 },
            components: {},
          },
        ],
        background_layers: [],
      },
    });
    mocks.listScenes.mockResolvedValue([
      {
        path: "scenes/level1.json",
        scene_id: "level1",
        display_name: "Level 1",
      },
    ]);

    await act(async () => {
      root.unmount();
      await flush();
      root = createRoot(container);
      root.render(<App />);
      await flush();
      await flush();
    });

    expect(typeof automationWindow.__RDS_E2E__?.openProject).toBe("function");

    let opened = false;
    await act(async () => {
      opened = await automationWindow.__RDS_E2E__!.openProject(
        "F:/Projects/RetroDevStudio/src-tauri/tests/fixtures/projects/snes_dummy"
      );
      await flush();
      await flush();
    });

    expect(opened).toBe(true);
    expect(mocks.openProjectPath).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/src-tauri/tests/fixtures/projects/snes_dummy"
    );

    const state = useEditorStore.getState();
    expect(state.activeProjectDir).toBe(
      "F:/Projects/RetroDevStudio/src-tauri/tests/fixtures/projects/snes_dummy"
    );
    expect(state.activeProjectName).toBe("SNES Dummy");
    expect(state.activeTarget).toBe("snes");
    expect(state.activeScenePath).toBe("scenes/level1.json");
    expect(state.projectSourceKind).toBe("builtin");
    expect(state.activeScene?.display_name).toBe("Level 1");
    expect(state.consoleEntries.some((entry) => entry.message.includes("Projeto aberto: SNES Dummy"))).toBe(
      true
    );

    delete automationWindow.__RDS_E2E__;
    delete automationWindow.__TAURI_INTERNALS__;
  });

  it("builds, loads the ROM, and starts the emulator frame loop", async () => {
    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
    });

    await flushUntil(
      () =>
        putImageDataSpy.mock.calls.length > 0
        || container.textContent?.includes("Emulador ativo") === true,
      60,
      25
    );

    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "Build"
    );
    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
    expect(mocks.emulatorLoadRom).toHaveBeenCalledWith("F:/Temp/game.md");
    expect(useEditorStore.getState().activeWorkspace).toBe("game");
    expect(useEditorStore.getState().activeViewportTab).toBe("game");
    expect(useEditorStore.getState().emulatorLoaded).toBe(true);
    expect(container.textContent).toContain("Emulador ativo");
    expect(putImageDataSpy).toHaveBeenCalled();
  });

  it("installs the missing JDK before Build & Run on Mega Drive", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    mocks.getThirdPartyStatus.mockResolvedValue({
      items: [
        {
          ...createDependencyStatus("jdk"),
          label: "JDK (Temurin LTS)",
          installed: false,
          version: null,
          issues: ["Java/JDK nao encontrado em JAVA_HOME, `toolchains/jdk` ou PATH."],
        },
        createDependencyStatus("sgdk"),
        createDependencyStatus("libretro_megadrive"),
        createDependencyStatus("pvsneslib"),
        createDependencyStatus("libretro_snes"),
      ],
    });
    mocks.installThirdPartyDependency.mockResolvedValue({
      ok: true,
      dependency_id: "jdk",
      message: "JDK instalada no ambiente local.",
      status: createDependencyStatus("jdk"),
      log: [],
    });

    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
      await flush();
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("JDK (Temurin LTS)")
    );
    expect(mocks.installThirdPartyDependency).toHaveBeenCalledWith(
      "jdk",
      expect.any(Function)
    );
    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
    expect(mocks.emulatorLoadRom).toHaveBeenCalledWith("F:/Temp/game.md");

    confirmSpy.mockRestore();
  });

  it("shows a waiting status after loading the ROM and before the emulator loop becomes active", async () => {
    let resolveLoopStart: ((stopLoop: () => void) => void) | null = null;
    mocks.startFrameLoop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoopStart = resolve;
        })
    );

    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
      await flush();
    });

    const gameStatus = container.querySelector("[data-testid='viewport-game-status']");
    expect(gameStatus).toBeInstanceOf(HTMLSpanElement);
    expect(gameStatus?.textContent).toContain("ROM carregada - aguardando emulador...");

    await act(async () => {
      resolveLoopStart?.(vi.fn());
      await flush();
      await flush();
    });

    expect(gameStatus?.textContent).toContain("Emulador ativo");
  });

  it("does not stop the emulator session when switching away from the game tab", async () => {
    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
      await flush();
    });

    expect(mocks.emulatorStop).not.toHaveBeenCalled();

    await act(async () => {
      useEditorStore.getState().setActiveViewportTab("logic");
      await flush();
    });

    expect(mocks.emulatorStop).not.toHaveBeenCalled();

    await act(async () => {
      useEditorStore.getState().setActiveViewportTab("game");
      await flush();
      await flush();
    });

    expect(mocks.startFrameLoop).toHaveBeenCalledTimes(2);
    expect(useEditorStore.getState().emulatorLoaded).toBe(true);
  });

  it("ignores rapid repeated build clicks while a build is already in flight", async () => {
    let resolveBuild: ((value: { ok: boolean; rom_path: string; log: [] }) => void) | null = null;
    mocks.buildProject.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBuild = resolve;
        })
    );

    await act(async () => {
      const buildButton = findButton(container, "Build & Run");
      buildButton.click();
      buildButton.click();
      buildButton.click();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBuild?.({ ok: true, rom_path: "F:/Temp/game.md", log: [] });
      await flush();
      await flush();
    });
  });

  it("disables Build & Run and explains why when live validation reports a fresh fatal error", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 70000,
          vram_limit: 65536,
          sprite_count: 12,
          sprite_limit: 80,
          scanline_sprite_peak: 6,
          scanline_sprite_limit: 20,
          dma_used: 70000,
          dma_limit: 7372,
          palette_banks_used: 2,
          palette_banks_limit: 4,
          bg_layers: 2,
          bg_layers_limit: 4,
          errors: ["Estouro de VRAM"],
          warnings: [],
        },
        hwValidationState: "fresh",
        hwValidatedRevision: 1,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const reason = container.querySelector("[data-testid='build-disabled-reason']");
    const liveState = container.querySelector("[data-testid='build-live-state']");

    expect(buildButton.disabled).toBe(true);
    expect(buildButton.getAttribute("aria-describedby")).toBe("build-disabled-reason");
    expect(reason?.textContent).toContain("Build bloqueado: Estouro de VRAM");
    expect(liveState?.textContent).toContain("BLOQUEADO");

    await act(async () => {
      buildButton.click();
      await flush();
    });

    expect(mocks.buildProject).not.toHaveBeenCalled();
  });

  it("shows the first-use onboarding wizard when no project is open", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Wizard de Primeiro Uso");
    expect(container.textContent).toContain("Mega Drive");
    expect(container.textContent).toContain("Projeto Vazio");
    expect(container.textContent).toContain("Primeiro Projeto");
    expect(container.textContent).toContain("Plataforma");
    expect(container.textContent).toContain("Experimental");
    expect(container.textContent).toContain("Criar Projeto");
    expect(container.textContent).toContain("Importar projeto existente");
    expect(container.textContent).toContain("Abrir importador");
    expect(container.textContent).not.toContain("Importando...");
    expect(container.querySelector("[data-testid='project-wizard-body']")).toBeInstanceOf(HTMLDivElement);
    const wizardActions = container.querySelector("[data-testid='project-wizard-actions']");
    expect(wizardActions).toBeInstanceOf(HTMLDivElement);
    expect(wizardActions?.textContent).toContain("Criar Projeto");
    expect(wizardActions?.textContent).toContain("Abrir Existente");
    expect(wizardActions?.textContent).not.toContain("Importar Externo");
    expect(container.querySelector("[data-testid='template-first-success']")?.textContent).toContain(
      "Primeiro Projeto"
    );
    expect(container.querySelector("[data-testid='template-first-success']")?.textContent).toContain(
      "Rodar Build & Run (Mega Drive)"
    );
  });

  it("shows a contextual guide in the scene workspace and opens the asset browser from it", async () => {
    const guide = container.querySelector("[data-testid='workspace-guide']");

    expect(guide?.textContent).toContain("Scene Editor");
    expect(guide?.textContent).toContain("Hierarchy, viewport e painel direito");
    expect(guide?.textContent).toContain("Hierarchy: selecao e cenas");
    expect(guide?.textContent).toContain("Build & Run: validacao rapida");

    await act(async () => {
      findButton(guide as HTMLElement, "Abrir Asset Browser").click();
      await flush();
    });

    const toolsPanel = container.querySelector("[data-testid='tools']");
    expect(toolsPanel).toBeInstanceOf(HTMLDivElement);
    expect(toolsPanel?.getAttribute("data-active")).toBe("assets");
    expect(toolsPanel?.getAttribute("data-workspace")).toBe("editing");
    expect(toolsPanel?.getAttribute("data-advanced")).toBe("false");
  });

  it("opens the unified top bar menu and reaches the About dialog", async () => {
    await act(async () => {
      findButton(container, "Menu").click();
      await flush();
    });

    const menuButton = container.querySelector("[data-testid='menu-action-about']");
    expect(menuButton).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelector("[data-testid='unified-topbar-breadcrumbs']")?.textContent).toContain(
      "Mega Dummy"
    );

    await act(async () => {
      (menuButton as HTMLButtonElement).click();
      await flush();
    });

    expect(container.textContent).toContain("Tauri 2 · React 19 · Rust");
  });

  it("updates the contextual guide for the logic workspace and opens the contextual palette", async () => {
    await act(async () => {
      useEditorStore.getState().setActiveViewportTab("logic");
      await flush();
      await flush();
    });

    const guide = container.querySelector("[data-testid='workspace-guide']");

    expect(guide?.textContent).toContain("Logic Workspace");
    expect(guide?.textContent).toContain("Paleta Contextual");

    await act(async () => {
      findButton(guide as HTMLElement, "Abrir Paleta Contextual").click();
      await flush();
    });

    const toolsPanel = container.querySelector("[data-testid='tools']");
    expect(toolsPanel).toBeInstanceOf(HTMLDivElement);
    expect(toolsPanel?.getAttribute("data-active")).toBe("palette");
    expect(toolsPanel?.getAttribute("data-workspace")).toBe("editing");
    expect(toolsPanel?.getAttribute("data-advanced")).toBe("false");
  });

  it("switches workspaces from the activity bar and updates shell routing", async () => {
    const activityBar = container.querySelector("[data-testid='workspace-activity-bar']");
    const logicButton = container.querySelector(
      "[data-testid='workspace-rail-logic']"
    ) as HTMLButtonElement | null;
    const artButton = container.querySelector(
      "[data-testid='workspace-rail-artstudio']"
    ) as HTMLButtonElement | null;

    expect(logicButton).toBeInstanceOf(HTMLButtonElement);
    expect(artButton).toBeInstanceOf(HTMLButtonElement);
    expect(activityBar?.textContent).toContain("Core");
    expect(activityBar?.textContent).toContain("Autoria");
    expect(activityBar?.textContent).toContain("Debug");
    expect(artButton?.textContent).toContain("Exp.");

    await act(async () => {
      logicButton?.click();
      await flush();
    });

    expect(useEditorStore.getState().activeWorkspace).toBe("logic");
    expect(useEditorStore.getState().activeViewportTab).toBe("logic");
    expect(container.querySelector("[data-testid='workspace-guide']")?.textContent).toContain(
      "Logic Workspace"
    );

    await act(async () => {
      artButton?.click();
      await flush();
    });

    expect(useEditorStore.getState().activeWorkspace).toBe("artstudio");
    expect(useEditorStore.getState().activeViewportTab).toBe("artstudio");
    expect(container.querySelector("[data-testid='workspace-guide']")?.textContent).toContain(
      "Art Workspace"
    );
  });

  it("renders the explorer workspace from the activity bar with synthesized project data", async () => {
    const explorerButton = container.querySelector(
      "[data-testid='workspace-rail-explorer']"
    ) as HTMLButtonElement | null;

    expect(explorerButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      explorerButton?.click();
    });

    const explorerDeadline = Date.now() + 3000;
    while (Date.now() < explorerDeadline) {
      const text = container.textContent ?? "";
      if (
        text.includes("Workspace contextual de arquivos") &&
        text.includes("Cenas 2") &&
        text.includes("hero.png")
      ) {
        break;
      }
      await act(async () => {
        await flush();
      });
    }

    expect(useEditorStore.getState().activeWorkspace).toBe("explorer");
    expect(useEditorStore.getState().activeViewportTab).toBe("scene");
    expect(container.textContent).toContain("Workspace contextual de arquivos");
    expect(container.textContent).toContain("Cenas 2");
    expect(container.textContent).toContain("hero.png");
    expect(container.textContent).toContain("src/main.c");
  });

  it("shows overlay-specific SGDK onboarding copy for legacy host projects", () => {
    const onboarding = container.querySelector("[data-testid='viewport-sgdk-onboarding']");

    expect(onboarding?.textContent).toContain("Projeto SGDK legado em overlay");
    expect(onboarding?.textContent).toContain("overlay rds/");
    expect(onboarding?.textContent).toContain("Makefile do host");
  });

  it("switches the SGDK onboarding copy when the project is already imported into the native format", async () => {
    await act(async () => {
      useEditorStore.setState({
        projectSourceKind: "imported_sgdk",
        projectLegacyIndex: null,
      });
      await flush();
    });

    const onboarding = container.querySelector("[data-testid='viewport-sgdk-onboarding']");

    expect(onboarding?.textContent).toContain("Projeto importado de SGDK");
    expect(onboarding?.textContent).toContain("formato nativo do RetroDev");
    expect(onboarding?.textContent).not.toContain("Makefile do host");
  });

  it("keeps the game view accessible after moving through the explorer workspace", async () => {
    const explorerButton = container.querySelector(
      "[data-testid='workspace-rail-explorer']"
    ) as HTMLButtonElement | null;
    const gameButton = container.querySelector(
      "[data-testid='workspace-rail-game']"
    ) as HTMLButtonElement | null;

    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
      await flush();
    });

    expect(useEditorStore.getState().activeWorkspace).toBe("game");
    expect(useEditorStore.getState().emulatorLoaded).toBe(true);
    const stopCallsBeforeExplorer = mocks.emulatorStop.mock.calls.length;

    await act(async () => {
      explorerButton?.click();
      await flush();
      await flush();
    });

    expect(mocks.emulatorStop).toHaveBeenCalledTimes(stopCallsBeforeExplorer);
    expect(useEditorStore.getState().activeWorkspace).toBe("explorer");
    expect(useEditorStore.getState().emulatorLoaded).toBe(true);

    await act(async () => {
      gameButton?.click();
      await flush();
      await flush();
    });

    expect(useEditorStore.getState().activeWorkspace).toBe("game");
    expect(useEditorStore.getState().activeViewportTab).toBe("game");
    expect(useEditorStore.getState().emulatorLoaded).toBe(true);
  });

  it("switches to the game workspace when Play is pressed with an emulator session ready", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeWorkspace: "scene",
        activeViewportTab: "scene",
        emulatorLoaded: true,
      });
      await flush();
    });

    await act(async () => {
      findButton(container, "Play").click();
      await flush();
    });

    expect(useEditorStore.getState().activeWorkspace).toBe("game");
    expect(useEditorStore.getState().activeViewportTab).toBe("game");
  });

  it("asks the viewport to resolve sprite assets into preview URLs", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeScene: {
          scene_id: "preview_scene",
          display_name: "Preview Scene",
          entities: [
            {
              entity_id: "hero",
              prefab: null,
              transform: { x: 16, y: 24 },
              components: {
                sprite: {
                  asset: "assets/sprites/onboarding_player.ppm",
                  frame_width: 16,
                  frame_height: 16,
                  pivot: undefined,
                  palette_slot: 0,
                  animations: {},
                  priority: "foreground",
                },
              },
            },
          ],
          background_layers: [],
        },
        selectedEntityId: "hero",
      });
      await flush();
      await flush();
    });

    expect(mocks.convertFileSrc).toHaveBeenCalledWith(
      expect.stringContaining("assets/sprites/onboarding_player.ppm")
    );
  });

  it("creates a project from the selected template card", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    const starterCard = container.querySelector(
      "[data-testid='template-card-starter_guided']"
    ) as HTMLButtonElement | null;
    const chooseButton = findButtonInContext(container, "Escolher", "Pasta base");
    const createButton = findButton(container, "Criar Projeto");

    await act(async () => {
      starterCard?.click();
      await flush();
    });

    await act(async () => {
      chooseButton.click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("F:/Projects/RetroDevStudio/tests/fixtures");

    await act(async () => {
      createButton.click();
      await flush();
      await flush();
    });

    expect(mocks.createProjectFromTemplate).toHaveBeenCalledWith(
      "MeuProjeto",
      "megadrive",
      "F:/Projects/RetroDevStudio/tests/fixtures",
      "starter_guided",
      undefined
    );
  });

  it("allows creating a project without choosing a base directory explicitly", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    const starterCard = container.querySelector(
      "[data-testid='template-card-starter_guided']"
    ) as HTMLButtonElement | null;
    const createButton = findButton(container, "Criar Projeto");

    await act(async () => {
      starterCard?.click();
      await flush();
    });

    await act(async () => {
      createButton.click();
      await flush();
      await flush();
    });

    expect(mocks.createProjectFromTemplate).toHaveBeenCalledWith(
      "MeuProjeto",
      "megadrive",
      "",
      "starter_guided",
      undefined
    );
  });

  it("requires a donor folder before creating an external SGDK template project", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    const platformerCard = container.querySelector(
      "[data-testid='template-card-platformer_seed']"
    ) as HTMLButtonElement | null;
    const createButton = findButton(container, "Criar Projeto");

    await act(async () => {
      platformerCard?.click();
      await flush();
    });

    expect(container.textContent).toContain("Requer pasta");
    expect(createButton.disabled).toBe(true);
    expect(container.querySelector("[data-testid='template-first-success']")?.textContent).toContain(
      "Escolher pasta doadora SGDK"
    );
    expect(container.querySelector("[data-testid='template-first-success']")?.textContent).toContain(
      "Bloqueio"
    );

    await act(async () => {
      createButton.click();
      await flush();
      await flush();
    });

    expect(mocks.createProjectFromTemplate).not.toHaveBeenCalled();
  });

  it("creates an external SGDK template project after choosing a donor folder manually", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    mocks.dialogOpen.mockResolvedValueOnce("F:/Projects/RetroDevStudio/tests/donors/platformer");

    const platformerCard = container.querySelector(
      "[data-testid='template-card-platformer_seed']"
    ) as HTMLButtonElement | null;
    const chooseDonorButton = findButtonInContext(container, "Escolher pasta...", "Template doador");
    const createButton = findButton(container, "Criar Projeto");

    await act(async () => {
      platformerCard?.click();
      await flush();
    });

    await act(async () => {
      chooseDonorButton.click();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Configurado");
    expect(createButton.disabled).toBe(false);
    expect(container.textContent).toContain("F:/Projects/RetroDevStudio/tests/donors/platformer");
    expect(container.querySelector("[data-testid='template-first-success']")?.textContent).toContain(
      "Pasta doadora configurada"
    );
    expect(container.querySelector("[data-testid='template-first-success']")?.textContent).toContain(
      "Pronto"
    );

    await act(async () => {
      createButton.click();
      await flush();
      await flush();
    });

    expect(mocks.createProjectFromTemplate).toHaveBeenCalledWith(
      "MeuProjeto",
      "megadrive",
      "",
      "platformer_seed",
      "F:/Projects/RetroDevStudio/tests/donors/platformer"
    );
  });

  it("shows the backend-provided automatic base directory hint in the wizard", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("C:/Users/Test/Documents/RetroDevProjects");
    expect(container.textContent).toContain(
      "Se voce nao escolher uma pasta, o RetroDev usara"
    );
  });

  it("shows the estimated project destination and the automatic suffix hint in the wizard", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    const destination = container.querySelector(
      "[data-testid='wizard-project-destination']"
    ) as HTMLElement | null;
    const nameInput = container.querySelector(
      "input[placeholder='Nome do projeto']"
    ) as HTMLInputElement | null;

    expect(destination?.textContent).toContain(
      "C:/Users/Test/Documents/RetroDevProjects/MeuProjeto"
    );
    expect(container.textContent).toContain("MeuProjeto_2");

    await act(async () => {
      if (!nameInput) {
        throw new Error("Project name input not found");
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      );
      descriptor?.set?.call(nameInput, "Meu Projeto!");
      nameInput.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await flush();
    });

    expect(destination?.textContent).toContain(
      "C:/Users/Test/Documents/RetroDevProjects/Meu_Projeto"
    );
    expect(container.textContent).toContain("Meu_Projeto_2");
  });

  it("offers to open an existing RetroDev project and auto-suggests a free name", async () => {
    mocks.previewProjectDestination.mockImplementation((projectName: string, baseDir: string) => {
      if (projectName === "MeuProjeto") {
        return Promise.resolve(
          createProjectDestinationPreview(projectName, baseDir, {
            suggested_name: "MeuProjeto 2",
            suggested_dir_name: "MeuProjeto_2",
            resolved_path: `${baseDir}/MeuProjeto_2`,
            collision_status: "existing_project",
            existing_project_path: `${baseDir}/MeuProjeto`,
            existing_project_name: "Projeto Antigo",
          })
        );
      }

      return Promise.resolve(createProjectDestinationPreview(projectName, baseDir));
    });
    mocks.openProjectPath.mockResolvedValue({
      selected: true,
      path: "C:/Users/Test/Documents/RetroDevProjects/MeuProjeto",
      name: "Projeto Antigo",
    });

    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    await flushUntil(() => {
      const nameInput = container.querySelector(
        "input[placeholder='Nome do projeto']"
      ) as HTMLInputElement | null;
      return nameInput?.value === "MeuProjeto 2";
    });

    const nameInput = container.querySelector(
      "input[placeholder='Nome do projeto']"
    ) as HTMLInputElement | null;
    const existingProjectButton = container.querySelector(
      "[data-testid='wizard-open-existing-project']"
    ) as HTMLButtonElement | null;

    expect(nameInput?.value).toBe("MeuProjeto 2");
    expect(container.textContent).toContain("Projeto RetroDev encontrado");
    expect(container.textContent).toContain("Projeto Antigo");
    expect(container.textContent).toContain("MeuProjeto 2");
    expect(
      container.querySelector("[data-testid='wizard-existing-project-path']")?.textContent
    ).toContain("C:/Users/Test/Documents/RetroDevProjects/MeuProjeto");

    await act(async () => {
      existingProjectButton?.click();
      await flush();
      await flush();
    });

    expect(mocks.openProjectPath).toHaveBeenCalledWith(
      "C:/Users/Test/Documents/RetroDevProjects/MeuProjeto"
    );
  });

  it("imports an arbitrary external project from the wizard using the default profile", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    const importToggle = container.querySelector(
      "[data-testid='wizard-external-import-toggle']"
    ) as HTMLButtonElement | null;

    expect(importToggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      importToggle?.click();
      await flush();
    });

    const importButton = findButton(container, "Importar Externo");

    await act(async () => {
      importButton.click();
      await flush();
      await flush();
    });

    expect(mocks.importExternalProject).toHaveBeenCalledWith(
      "MeuProjeto",
      "",
      "sgdk",
      "F:/Projects/RetroDevStudio/tests/fixtures"
    );
  });

  it("imports an arbitrary external project with the selected profile", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    const importToggle = container.querySelector(
      "[data-testid='wizard-external-import-toggle']"
    ) as HTMLButtonElement | null;

    expect(importToggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      importToggle?.click();
      await flush();
    });

    const profileSelect = container.querySelector(
      "[data-testid='external-import-profile-select']"
    ) as HTMLSelectElement | null;
    const importButton = findButton(container, "Importar Externo");

    await act(async () => {
      if (!profileSelect) {
        throw new Error("External import profile select not found");
      }
      profileSelect.value = "godot";
      profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    });

    await act(async () => {
      importButton.click();
      await flush();
      await flush();
    });

    expect(mocks.importExternalProject).toHaveBeenCalledWith(
      "MeuProjeto",
      "",
      "godot",
      "F:/Projects/RetroDevStudio/tests/fixtures"
    );
  });

  it("shows the newly supported external profiles in the selector", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeProjectDir: "",
        activeProjectName: "",
        activeScenePath: "",
        activeScene: null,
        activeSceneSource: null,
        hwStatus: null,
      });
      await flush();
      await flush();
    });

    const importToggle = container.querySelector(
      "[data-testid='wizard-external-import-toggle']"
    ) as HTMLButtonElement | null;

    expect(importToggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      importToggle?.click();
      await flush();
    });

    const profileSelect = container.querySelector(
      "[data-testid='external-import-profile-select']"
    ) as HTMLSelectElement | null;

    if (!profileSelect) {
      throw new Error("External import profile select not found");
    }

    const options = Array.from(profileSelect.options).map((option) => option.value);
    expect(options).toContain("construct");
    expect(options).toContain("rpg_maker");
    expect(options).toContain("openbor");
  });

  it("does not start the frame loop when the game tab opens without a loaded ROM", async () => {
    await act(async () => {
      useEditorStore.setState({
        emulatorLoaded: false,
        activeViewportTab: "game",
      });
      await flush();
      await flush();
    });

    expect(mocks.startFrameLoop).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Carregue uma ROM para iniciar o emulador");
  });

  it("keeps Build & Run enabled when the live validation snapshot is stale", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 70000,
          vram_limit: 65536,
          sprite_count: 12,
          sprite_limit: 80,
          scanline_sprite_peak: 6,
          scanline_sprite_limit: 20,
          dma_used: 70000,
          dma_limit: 7372,
          palette_banks_used: 2,
          palette_banks_limit: 4,
          bg_layers: 2,
          bg_layers_limit: 4,
          errors: ["Estouro de VRAM"],
          warnings: [],
        },
        hwValidationState: "stale",
        hwValidatedRevision: 0,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const revalidateButton = container.querySelector(
      "[data-testid='build-stale-revalidate']"
    ) as HTMLButtonElement | null;
    const refreshTickBefore = useEditorStore.getState().hwValidationRefreshTick;

    expect(buildButton.disabled).toBe(false);
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-state']")?.textContent).toContain(
      "DESATUAL."
    );
    expect(container.querySelector("[data-testid='build-stale-hint']")?.textContent).toContain(
      "Edite a cena para revalidar"
    );
    expect(revalidateButton?.textContent).toContain("Revalidar agora");
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();

    await act(async () => {
      revalidateButton?.click();
      await flush();
    });

    expect(useEditorStore.getState().hwValidationRefreshTick).toBe(refreshTickBefore + 1);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "[Live] Revalidacao manual solicitada.")
    ).toBe(true);

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("keeps Build & Run enabled when the live validation snapshot only has warnings", async () => {
    mocks.validateSceneDraft.mockResolvedValue({
      ok: true,
      error: "",
      hw_status: {
        vram_used: 57344,
        vram_limit: 65536,
        sprite_count: 1,
        sprite_limit: 80,
        scanline_sprite_peak: 1,
        scanline_sprite_limit: 20,
        dma_used: 57344,
        dma_limit: 7372,
        palette_banks_used: 1,
        palette_banks_limit: 4,
        bg_layers: 0,
        bg_layers_limit: 4,
        errors: [],
        warnings: ["VRAM Warning: uso alto de VRAM."],
      },
    });

    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 57344,
          vram_limit: 65536,
          sprite_count: 1,
          sprite_limit: 80,
          scanline_sprite_peak: 1,
          scanline_sprite_limit: 20,
          dma_used: 57344,
          dma_limit: 7372,
          palette_banks_used: 1,
          palette_banks_limit: 4,
          bg_layers: 0,
          bg_layers_limit: 4,
          errors: [],
          warnings: ["VRAM Warning: uso alto de VRAM."],
        },
        hwValidationState: "fresh",
        hwValidatedRevision: 1,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const warning = container.querySelector("[data-testid='build-warning-summary']");
    const liveState = container.querySelector("[data-testid='build-live-state']");

    expect(buildButton.disabled).toBe(false);
    expect(buildButton.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();
    expect(liveState?.textContent).toContain("WARN");
    expect(warning?.textContent).toContain("Build com alerta: VRAM Warning: uso alto de VRAM.");

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("shows LIVE state with no extra summaries when diagnostics are fresh and clean", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwStatus: {
          vram_used: 8192,
          vram_limit: 65536,
          sprite_count: 4,
          sprite_limit: 80,
          scanline_sprite_peak: 2,
          scanline_sprite_limit: 20,
          dma_used: 4096,
          dma_limit: 7372,
          palette_banks_used: 1,
          palette_banks_limit: 4,
          bg_layers: 1,
          bg_layers_limit: 4,
          errors: [],
          warnings: [],
        },
        hwValidationState: "fresh",
        hwValidatedRevision: 1,
        hwValidationError: null,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const liveState = container.querySelector("[data-testid='build-live-state']");

    expect(buildButton.disabled).toBe(false);
    expect(liveState?.textContent).toContain("LIVE");
    expect(liveState?.getAttribute("title")).toContain("Preview live sincronizado.");
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-error-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-pending-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-stale-hint']")).toBeNull();
    expect(container.querySelector("[data-testid='build-stale-revalidate']")).toBeNull();

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("shows explicit live error detail without blocking Build & Run", async () => {
    const errMsg = "Falha de comunicacao com validate_scene_draft";
    mocks.validateSceneDraft.mockResolvedValueOnce({
      ok: false,
      error: errMsg,
      hw_status: {
        vram_used: 0,
        vram_limit: 65536,
        sprite_count: 0,
        sprite_limit: 80,
        scanline_sprite_peak: 0,
        scanline_sprite_limit: 20,
        dma_used: 0,
        dma_limit: 7372,
        palette_banks_used: 0,
        palette_banks_limit: 4,
        bg_layers: 0,
        bg_layers_limit: 4,
        errors: [],
        warnings: [],
      },
    });

    await act(async () => {
      useEditorStore.getState().requestHwValidationRefresh();
      await flush();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LIVE_VALIDATION_DEBOUNCE_MS + 50));
    });
    await act(async () => {
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const liveState = container.querySelector("[data-testid='build-live-state']");
    const errorSummary = container.querySelector("[data-testid='build-live-error-summary']");

    expect(buildButton.disabled).toBe(false);
    expect(liveState?.textContent).toContain("ERRO LIVE");
    expect(errorSummary?.textContent).toContain(`Live com falha: ${errMsg}`);
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("requests live revalidation when project assets change on disk", async () => {
    mocks.pollProjectAssetChanges.mockResolvedValueOnce({
      changed: true,
      changed_paths: ["assets/sprites/hero.ppm"],
    });

    const refreshTickBefore = useEditorStore.getState().hwValidationRefreshTick;

    await act(async () => {
      root.unmount();
      await flush();
      root = createRoot(container);
      root.render(<App />);
      await flush();
      await flush();
    });

    expect(mocks.pollProjectAssetChanges).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy"
    );
    expect(useEditorStore.getState().hwValidationRefreshTick).toBe(refreshTickBefore + 1);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) =>
          entry.message.includes("[Hot Reload] 1 asset(s) alterado(s) no disco: assets/sprites/hero.ppm")
        )
    ).toBe(true);
  });

  it("shows an explicit pending live analysis summary while keeping Build & Run enabled", async () => {
    await act(async () => {
      useEditorStore.setState({
        hwValidationState: "pending",
        hwValidationError: null,
      });
      await flush();
    });

    const buildButton = findButton(container, "Build & Run");
    const liveState = container.querySelector("[data-testid='build-live-state']");
    const pendingSummary = container.querySelector("[data-testid='build-live-pending-summary']");

    expect(buildButton.disabled).toBe(false);
    expect(liveState?.textContent).toContain("ANALISANDO");
    expect(pendingSummary?.textContent).toContain("Live em analise...");
    expect(container.querySelector("[data-testid='build-warning-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-live-error-summary']")).toBeNull();
    expect(container.querySelector("[data-testid='build-disabled-reason']")).toBeNull();

    await act(async () => {
      buildButton.click();
      await flush();
      await flush();
    });

    expect(mocks.buildProject).toHaveBeenCalledTimes(1);
  });

  it("triggers emulator save and load state actions from the game viewport", async () => {
    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game", emulatorLoaded: true });
      await flush();
      await flush();
    });

    await act(async () => {
      findButton(container, "Salvar state").click();
      await flush();
    });

    await act(async () => {
      findButton(container, "Carregar state").click();
      await flush();
    });

    expect(mocks.emulatorSaveState).toHaveBeenCalledTimes(1);
    expect(mocks.emulatorLoadState).toHaveBeenCalledTimes(1);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "[Emulador] Save state salvo (8 bytes).")
    ).toBe(true);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "[Emulador] Save state restaurado.")
    ).toBe(true);
  });

  it("supports single-frame step and resume from the game viewport while paused", async () => {
    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
      await flush();
    });

    const resumeButton = container.querySelector("[data-testid='viewport-resume']");
    const stepButton = container.querySelector("[data-testid='viewport-step-frame']");

    expect(resumeButton).toBeInstanceOf(HTMLButtonElement);
    expect(stepButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      useEditorStore.setState({ emulPaused: true });
      await flush();
    });

    expect(useEditorStore.getState().emulPaused).toBe(true);
    expect(container.textContent).toContain("Emulador pausado");
    expect((stepButton as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      (stepButton as HTMLButtonElement).click();
      await flush();
    });

    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message === "Frame unico executado.")
    ).toBe(true);

    await act(async () => {
      (resumeButton as HTMLButtonElement).click();
      await flush();
      await flush();
    });

    expect(useEditorStore.getState().emulPaused).toBe(false);
    expect(mocks.startFrameLoop).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Emulador ativo");
  });

  it("triggers rewind from the game viewport controls and keyboard shortcut while paused", async () => {
    await act(async () => {
      findButton(container, "Build & Run").click();
      await flush();
      await flush();
    });

    const rewindButton = container.querySelector("[data-testid='viewport-rewind']");

    expect(rewindButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      useEditorStore.setState({ emulPaused: true });
      await flush();
    });

    expect((rewindButton as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      (rewindButton as HTMLButtonElement).click();
      await flush();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR", bubbles: true }));
      await flush();
    });

    expect(mocks.emulatorRewindStep).toHaveBeenCalledTimes(2);
    expect(
      useEditorStore
        .getState()
        .consoleEntries.some((entry) => entry.message.includes("[Rewind] Rewind restaurado para o frame 0"))
    ).toBe(true);
  });

  it("shows a hot reload notice in the game viewport when backend asset change events arrive", async () => {
    let onAssetChange: ((payload: { project_dir: string; changed_paths: string[] }) => void) | null = null;
    mocks.listenToProjectAssetChanges.mockImplementation(async (callback) => {
      onAssetChange = callback;
      return vi.fn();
    });

    await act(async () => {
      root.unmount();
      await flush();
      root = createRoot(container);
      root.render(<App />);
      await flush();
      await flush();
    });

    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game" });
      await flush();
      await flush();
    });

    await act(async () => {
      onAssetChange?.({
        project_dir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
        changed_paths: ["assets/sprites/hero.ppm"],
      });
      await flush();
    });

    const banner = container.querySelector("[data-testid='viewport-asset-hot-reload']");
    expect(banner?.textContent).toContain("Assets alterados no disco.");
    expect(banner?.textContent).toContain("assets/sprites/hero.ppm");
  });

  it("resizes the selected sprite from scene gizmos with 8px snapping and persists the change", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeViewportTab: "scene",
        viewportZoom: 1.0,
        selectedEntityId: "hero",
        activeScene: {
          scene_id: "main_scene",
          display_name: "Main Scene",
          background_layers: [],
          entities: [
            {
              entity_id: "hero",
              display_name: "Hero",
              prefab: null,
              transform: { x: 16, y: 16 },
              components: {
                sprite: {
                  asset: "assets/sprites/hero.ppm",
                  frame_width: 16,
                  frame_height: 16,
                },
              },
            },
          ],
        },
      });
      await flush();
      await flush();
    });

    const canvas = container.querySelector("[data-testid='viewport-scene-overlay']");
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    Object.defineProperty(canvas as HTMLCanvasElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 320,
        height: 224,
        right: 320,
        bottom: 224,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    await act(async () => {
      (canvas as HTMLCanvasElement).dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 32,
          clientY: 32,
          button: 0,
        })
      );
      (canvas as HTMLCanvasElement).dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 47,
          clientY: 47,
          buttons: 1,
        })
      );
      (canvas as HTMLCanvasElement).dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 47,
          clientY: 47,
        })
      );
      await flush();
      await flush();
    });

    const hero = useEditorStore.getState().activeScene?.entities[0];
    expect(hero?.transform).toEqual({ x: 16, y: 16 });
    expect(hero?.components.sprite?.frame_width).toBe(32);
    expect(hero?.components.sprite?.frame_height).toBe(32);
    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "Viewport"
    );
  });

  it("supports rulers, guides, and game view light in the scene viewport", async () => {
    await act(async () => {
      useEditorStore.setState({
        activeViewportTab: "scene",
        activeScenePath: "scenes/main.json",
        viewportZoom: 1.0,
        activeScene: {
          scene_id: "main_scene",
          display_name: "Main Scene",
          background_layers: [],
          entities: [],
        },
      });
      await flush();
      await flush();
    });

    expect(container.querySelector("[data-testid='viewport-scene-ruler-top']")).not.toBeNull();
    expect(container.querySelector("[data-testid='viewport-scene-ruler-left']")).not.toBeNull();

    await act(async () => {
      findButton(container, "GV").click();
      await flush();
    });

    expect(container.querySelector("[data-testid='viewport-scene-ruler-top']")).toBeNull();

    await act(async () => {
      findButton(container, "GV").click();
      await flush();
      await flush();
    });

    const overlay = container.querySelector(
      "[data-testid='viewport-scene-overlay']"
    ) as HTMLCanvasElement | null;
    const rulerTop = container.querySelector(
      "[data-testid='viewport-scene-ruler-top']"
    ) as HTMLCanvasElement | null;

    expect(overlay).toBeInstanceOf(HTMLCanvasElement);
    expect(rulerTop).toBeInstanceOf(HTMLCanvasElement);

    Object.defineProperty(overlay as HTMLCanvasElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 18,
        top: 18,
        width: 320,
        height: 224,
        right: 338,
        bottom: 242,
        x: 18,
        y: 18,
        toJSON: () => ({}),
      }),
    });

    await act(async () => {
      (rulerTop as HTMLCanvasElement).dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 50,
          clientY: 8,
          button: 0,
        })
      );
      await flush();
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 50,
          clientY: 48,
          buttons: 1,
        })
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 50,
          clientY: 48,
          button: 0,
        })
      );
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("1 guia(s)");
    expect(
      localStorage.getItem(
        "rds:scene-guides:F%3A%2FProjects%2FRetroDevStudio%2Ftests%2Ffixtures%2Fprojects%2Fmegadrive_dummy:scenes%2Fmain.json"
      )
    ).toContain("\"orientation\":\"vertical\"");
  });

  it("shows and toggles the game performance overlay", async () => {
    const liveOverlayStatus = {
      vram_used: 4096,
      vram_limit: 65536,
      sprite_count: 6,
      sprite_limit: 80,
      scanline_sprite_peak: 4,
      scanline_sprite_limit: 20,
      dma_used: 4096,
      dma_limit: 7372,
      palette_banks_used: 2,
      palette_banks_limit: 4,
      bg_layers: 1,
      bg_layers_limit: 4,
      errors: [],
      warnings: [],
    };
    mocks.getHwStatus.mockResolvedValue(liveOverlayStatus);
    mocks.validateSceneDraft.mockResolvedValue({
      ok: true,
      error: "",
      hw_status: liveOverlayStatus,
    });

    await act(async () => {
      useEditorStore.setState({
        activeViewportTab: "game",
        hwStatus: liveOverlayStatus,
      });
      await flush();
      await flush();
    });

    const overlayToggle = findButton(container, "Overlay ON");
    const overlay = container.querySelector("[data-testid='viewport-performance-overlay']");

    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Sprites 6");
    expect(overlay?.textContent).toContain("DMA est.");

    await act(async () => {
      overlayToggle.click();
      await flush();
    });

    expect(container.querySelector("[data-testid='viewport-performance-overlay']")).toBeNull();
    expect(findButton(container, "Overlay OFF")).toBeInstanceOf(HTMLButtonElement);
  });

  it("switches the contextual right panel between inspector and tools", async () => {
    expect(container.querySelector("[data-testid='inspector']")).not.toBeNull();
    expect(container.querySelector("[data-testid='tools']")).toBeNull();

    await act(async () => {
      findButton(container, "Tools").click();
      await flush();
    });

    expect(container.querySelector("[data-testid='tools']")).not.toBeNull();
    expect(container.querySelector("[data-testid='inspector']")).toBeNull();

    await act(async () => {
      findButton(container, "Inspector").click();
      await flush();
    });

    expect(container.querySelector("[data-testid='inspector']")).not.toBeNull();
    expect(container.querySelector("[data-testid='tools']")).toBeNull();
  });

  it("shows the live VRAM budget bar in the toolbar", async () => {
    const toolbarBudgetStatus = {
      vram_used: 49152,
      vram_limit: 65536,
      sprite_count: 12,
      sprite_limit: 80,
      scanline_sprite_peak: 18,
      scanline_sprite_limit: 20,
      dma_used: 49152,
      dma_limit: 7372,
      palette_banks_used: 3,
      palette_banks_limit: 4,
      bg_layers: 2,
      bg_layers_limit: 4,
      errors: [],
      warnings: ["VRAM Warning"],
    };
    mocks.getHwStatus.mockResolvedValue(toolbarBudgetStatus);
    mocks.validateSceneDraft.mockResolvedValue({
      ok: true,
      error: "",
      hw_status: toolbarBudgetStatus,
    });

    await act(async () => {
      useEditorStore.setState({
        hwStatus: toolbarBudgetStatus,
      });
      await flush();
    });

    const budget = container.querySelector("[data-testid='toolbar-vram-budget']");
    const label = container.querySelector("[data-testid='toolbar-vram-budget-label']");
    const bar = container.querySelector("[data-testid='toolbar-vram-budget-bar']") as HTMLElement | null;
    const scanlineLabel = container.querySelector("[data-testid='toolbar-scanline-budget-label']");
    const paletteLabel = container.querySelector("[data-testid='toolbar-palette-budget-label']");

    expect(budget).not.toBeNull();
    expect(label?.textContent).toContain("48 / 64 KB");
    expect(bar?.style.width).toBe("75%");
    expect(scanlineLabel?.textContent).toContain("18 / 20");
    expect(paletteLabel?.textContent).toContain("3 / 4");
  });

  it("creates and disposes the game audio context with the audio stream lifecycle", async () => {
    const audioContextCtor = vi.fn();
    const gainConnect = vi.fn();
    const gainDisconnect = vi.fn();
    const processorConnect = vi.fn();
    const processorDisconnect = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const suspend = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const createGain = vi.fn(() => ({
      gain: { value: 1 },
      connect: gainConnect,
      disconnect: gainDisconnect,
    }));
    const createScriptProcessor = vi.fn(() => ({
      onaudioprocess: null,
      connect: processorConnect,
      disconnect: processorDisconnect,
    }));
    class FakeAudioContext {
      public state = "running";
      public destination = {};

      constructor() {
        audioContextCtor();
      }

      createGain() {
        return createGain();
      }

      createScriptProcessor() {
        return createScriptProcessor();
      }

      close() {
        return close();
      }

      suspend() {
        return suspend();
      }

      resume() {
        return resume();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    mocks.listenToAudioStream.mockImplementation(async (onAudio: (payload: { sample_rate: number; samples: number[] }) => void) => {
      onAudio({ sample_rate: 44100, samples: [0, 0, 1, -1] });
      return vi.fn();
    });

    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "game" });
      await flush();
      await flush();
    });

    expect(mocks.listenToAudioStream).toHaveBeenCalledTimes(1);
    expect(audioContextCtor).toHaveBeenCalledTimes(1);
    expect(createGain).toHaveBeenCalledTimes(1);
    expect(createScriptProcessor).toHaveBeenCalledTimes(1);

    await act(async () => {
      useEditorStore.setState({ activeViewportTab: "scene" });
      await flush();
      await flush();
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(processorDisconnect).toHaveBeenCalledTimes(1);
    expect(gainDisconnect).toHaveBeenCalledTimes(1);
  });
});
