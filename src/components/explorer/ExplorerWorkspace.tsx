import { useEffect, useMemo, useState } from "react";
import AssetPreview from "../common/AssetPreview";
import {
  listScenes,
  switchScene,
  type SceneInfo,
  type LegacySgdkIndex,
} from "../../core/ipc/sceneService";
import {
  listProjectAssets,
  readLegacyProjectFile,
  type LegacyProjectFilePreview,
  type ProjectAssetEntry,
} from "../../core/ipc/toolsService";
import { listenToProjectAssetChanges } from "../../core/ipc/projectWatcherService";
import { hydrateSceneResult, persistActiveScene } from "../../core/scenePersistence";
import { useEditorStore } from "../../core/store/editorStore";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ExplorerWorkspaceProps {
  onSelectionChange?: (label: string | null) => void;
  onOpenSceneEditor?: () => void;
}

interface LegacyIndexSection {
  id: string;
  label: string;
  files: string[];
}

interface AssetTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: AssetTreeNode[];
  asset?: ProjectAssetEntry;
  fileCount: number;
}

type ExplorerSelection =
  | { kind: "scene"; scene: SceneInfo }
  | { kind: "asset"; asset: ProjectAssetEntry }
  | { kind: "legacy"; path: string }
  | null;

function buildLegacyIndexSections(index: LegacySgdkIndex | null): LegacyIndexSection[] {
  if (!index) {
    return [];
  }

  return [
    { id: "source", label: "src/", files: index.source_files },
    { id: "headers", label: "inc/", files: index.header_files },
    { id: "manifests", label: "res/", files: index.manifest_files },
    { id: "resources", label: "assets host", files: index.resource_files },
    { id: "output", label: "out/", files: index.output_files },
  ].filter((section) => section.files.length > 0);
}

function countLegacyIndexedFiles(index: LegacySgdkIndex | null): number {
  if (!index) {
    return 0;
  }

  return (
    index.source_files.length +
    index.header_files.length +
    index.manifest_files.length +
    index.resource_files.length +
    index.output_files.length
  );
}

function buildAssetTree(assets: ProjectAssetEntry[]): AssetTreeNode {
  const root: AssetTreeNode = { name: "", path: "", isDir: true, children: [], fileCount: 0 };

  for (const asset of assets) {
    const segments = asset.relative_path.replace(/\\/g, "/").split("/");
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLast = index === segments.length - 1;

      if (isLast) {
        current.children.push({
          name: segment,
          path: asset.relative_path,
          isDir: false,
          children: [],
          asset,
          fileCount: 0,
        });
        continue;
      }

      let folder = current.children.find((child) => child.isDir && child.name === segment);
      if (!folder) {
        folder = {
          name: segment,
          path: segments.slice(0, index + 1).join("/"),
          isDir: true,
          children: [],
          fileCount: 0,
        };
        current.children.push(folder);
      }
      current = folder;
    }
  }

  function countFiles(node: AssetTreeNode): number {
    if (!node.isDir) {
      return 1;
    }
    const total = node.children.reduce((sum, child) => sum + countFiles(child), 0);
    node.fileCount = total;
    return total;
  }

  countFiles(root);
  return root;
}

function AssetTreeBranch({
  node,
  collapsed,
  selectedPath,
  onToggle,
  onSelect,
  depth,
}: {
  node: AssetTreeNode;
  collapsed: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (asset: ProjectAssetEntry) => void;
  depth: number;
}) {
  if (node.isDir) {
    const isCollapsed = collapsed.has(node.path);
    return (
      <>
        {node.name ? (
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-[#a1a1aa] transition-colors hover:bg-[#0f172a] hover:text-[#e4e4e7]"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <span className="text-[8px]">{isCollapsed ? "\u25b8" : "\u25be"}</span>
            <span className="font-semibold">{node.name}/</span>
            <span className="ml-auto text-[10px] text-[#52525b]">{node.fileCount}</span>
          </button>
        ) : null}

        {!isCollapsed &&
          node.children.map((child) => (
            <AssetTreeBranch
              key={child.path}
              node={child}
              collapsed={collapsed}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
              depth={node.name ? depth + 1 : depth}
            />
          ))}
      </>
    );
  }

  const asset = node.asset!;
  const selected = asset.relative_path === selectedPath;

  return (
    <button
      type="button"
      onClick={() => onSelect(asset)}
      title={asset.relative_path}
      className={`flex w-full items-center gap-2 rounded-lg py-1 text-left text-[11px] transition-colors ${
        selected
          ? "bg-[#cba6f7]/10 text-[#f5e1ff]"
          : "text-[#d4d4d8] hover:bg-[#0f172a] hover:text-[#ffffff]"
      }`}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[#27272a] bg-[#0b1120] text-[9px] font-semibold uppercase text-[#7dd3fc]">
        {asset.kind === "image" ? "IMG" : asset.kind === "audio" ? "AUD" : "FILE"}
      </span>
      <span className="min-w-0 truncate">{node.name}</span>
    </button>
  );
}

export default function ExplorerWorkspace({
  onSelectionChange,
  onOpenSceneEditor,
}: ExplorerWorkspaceProps) {
  const {
    activeProjectDir,
    activeScenePath,
    projectSourceKind,
    projectLegacyIndex,
    setActiveScene,
    setActiveScenePath,
    setSelectedEntityId,
    logMessage,
  } = useEditorStore();

  const [scenes, setScenes] = useState<SceneInfo[]>([]);
  const [assets, setAssets] = useState<ProjectAssetEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ExplorerSelection>(null);
  const [legacyPreview, setLegacyPreview] = useState<LegacyProjectFilePreview | null>(null);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [switchingScene, setSwitchingScene] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const assetTree = useMemo(() => buildAssetTree(assets), [assets]);
  const isLegacyOverlayProject = projectSourceKind === "external_sgdk" && Boolean(projectLegacyIndex);
  const legacyIndexedFileCount = useMemo(
    () => countLegacyIndexedFiles(projectLegacyIndex),
    [projectLegacyIndex]
  );
  const legacySections = useMemo(
    () => (projectSourceKind === "external_sgdk" ? buildLegacyIndexSections(projectLegacyIndex) : []),
    [projectLegacyIndex, projectSourceKind]
  );

  useEffect(() => {
    if (!onSelectionChange) {
      return;
    }

    if (!selection) {
      onSelectionChange(null);
      return;
    }

    if (selection.kind === "scene") {
      onSelectionChange(selection.scene.path);
      return;
    }

    if (selection.kind === "asset") {
      onSelectionChange(selection.asset.relative_path);
      return;
    }

    onSelectionChange(selection.path);
  }, [onSelectionChange, selection]);

  useEffect(() => {
    if (!activeProjectDir) {
      setScenes([]);
      setAssets([]);
      setSelection(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadExplorerData() {
      setBusy(true);
      try {
        const [sceneList, assetList] = await Promise.all([
          listScenes(activeProjectDir),
          listProjectAssets(activeProjectDir),
        ]);

        if (cancelled) {
          return;
        }

        setScenes(sceneList);
        setAssets(assetList);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(describeError(loadError));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadExplorerData();

    return () => {
      cancelled = true;
    };
  }, [activeProjectDir]);

  useEffect(() => {
    if (!activeProjectDir) {
      return;
    }

    let cancelled = false;
    let stopListening: (() => void) | null = null;

    void listenToProjectAssetChanges((payload) => {
      if (cancelled || payload.project_dir !== activeProjectDir) {
        return;
      }

      void listProjectAssets(activeProjectDir)
        .then((result) => {
          if (!cancelled) {
            setAssets(result);
          }
        })
        .catch((loadError) => {
          if (!cancelled) {
            setError(describeError(loadError));
          }
        });
    })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        stopListening = stop;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      stopListening?.();
    };
  }, [activeProjectDir]);

  useEffect(() => {
    if (selection?.kind !== "legacy") {
      setLegacyPreview(null);
      setLegacyBusy(false);
      setLegacyError(null);
      return;
    }

    if (!activeProjectDir) {
      return;
    }

    const legacyPath = selection.path;

    let cancelled = false;

    async function loadLegacyPreview() {
      setLegacyBusy(true);
      setLegacyError(null);
      try {
        const result = await readLegacyProjectFile(activeProjectDir, legacyPath);
        if (!cancelled) {
          setLegacyPreview(result);
        }
      } catch (previewError) {
        if (!cancelled) {
          setLegacyPreview(null);
          setLegacyError(describeError(previewError));
        }
      } finally {
        if (!cancelled) {
          setLegacyBusy(false);
        }
      }
    }

    void loadLegacyPreview();

    return () => {
      cancelled = true;
    };
  }, [activeProjectDir, selection]);

  async function handleActivateScene(scenePath: string) {
    if (!activeProjectDir || switchingScene) {
      return;
    }

    if (!(await persistActiveScene(activeProjectDir, "Explorer"))) {
      return;
    }

    setSwitchingScene(true);
    try {
      const result = await switchScene(activeProjectDir, scenePath);
      if (!result.ok) {
        throw new Error(result.error);
      }

      const hydrated = await hydrateSceneResult(activeProjectDir, result);
      if (!hydrated) {
        throw new Error("Falha ao reidratar a cena selecionada.");
      }

      setSelectedEntityId(null);
      setActiveScenePath(result.scene_path);
      setActiveScene(hydrated.resolvedScene, hydrated.sourceScene);
      setSelection({
        kind: "scene",
        scene: {
          path: result.scene_path,
          display_name: hydrated.resolvedScene.display_name ?? hydrated.resolvedScene.scene_id,
          scene_id: hydrated.resolvedScene.scene_id,
        },
      });
      logMessage(
        "success",
        `[Explorer] Cena ativa: ${hydrated.resolvedScene.display_name ?? hydrated.resolvedScene.scene_id}`
      );
    } catch (sceneError) {
      logMessage("error", `[Explorer] Falha ao trocar cena: ${describeError(sceneError)}`);
    } finally {
      setSwitchingScene(false);
    }
  }

  function handleRefresh() {
    if (!activeProjectDir) {
      return;
    }

    setBusy(true);
    Promise.all([listScenes(activeProjectDir), listProjectAssets(activeProjectDir)])
      .then(([sceneList, assetList]) => {
        setScenes(sceneList);
        setAssets(assetList);
        setError(null);
      })
      .catch((refreshError) => {
        setError(describeError(refreshError));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function toggleFolder(path: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  const sceneCount = scenes.length;
  const legacyCount = legacySections.reduce((count, section) => count + section.files.length, 0);
  const selectedAssetPath = selection?.kind === "asset" ? selection.asset.relative_path : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
      <div className="flex items-center justify-between gap-3 border-b border-[#27272a] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f9e2af]">
              Explorer
            </span>
            <span className="text-[11px] text-[#64748b]">Workspace contextual de arquivos</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#94a3b8]">
            <span className="rounded-full border border-[#27272a] bg-[#111827] px-2.5 py-1">
              Cenas {sceneCount}
            </span>
            <span className="rounded-full border border-[#27272a] bg-[#111827] px-2.5 py-1">
              Assets {assets.length}
            </span>
            {legacyCount > 0 ? (
              <span className="rounded-full border border-[#27272a] bg-[#111827] px-2.5 py-1">
                Host SGDK {legacyCount}
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={!activeProjectDir || busy}
          className="rounded-xl border border-[#313244] bg-[#111827] px-3 py-2 text-[11px] font-semibold text-[#cbd5e1] transition-colors hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-auto border-r border-[#27272a] bg-[#0b1120]">
          <div className="space-y-4 p-3">
            {isLegacyOverlayProject ? (
              <section
                data-testid="legacy-host-summary"
                className="rounded-2xl border border-[#3f3f46] bg-[#111827] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f9e2af]">
                      Overlay SGDK
                    </div>
                    <p className="mt-2 break-all font-mono text-[10px] text-[#cbd5e1]">
                      {projectLegacyIndex?.host_root}
                    </p>
                  </div>
                  <span className="rounded-full border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#f9e2af]">
                    Read-only host
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[9px] text-[#cbd5e1]">
                  <span className="rounded-full border border-[#313244] bg-[#0b1120] px-2 py-0.5">
                    Overlay rds/
                  </span>
                  <span className="rounded-full border border-[#313244] bg-[#0b1120] px-2 py-0.5">
                    {legacyIndexedFileCount} arquivo(s) indexado(s)
                  </span>
                  <span className="rounded-full border border-[#313244] bg-[#0b1120] px-2 py-0.5">
                    Build &amp; Run delega ao Makefile do host
                  </span>
                </div>
                <p className="mt-3 text-[11px] leading-5 text-[#94a3b8]">
                  Cenas e assets abaixo continuam editáveis no overlay <span className="font-mono text-[#e4e4e7]">rds/</span>.
                  Arquivos do host SGDK seguem somente leitura nesta workspace.
                </p>
              </section>
            ) : null}

            <section className="rounded-2xl border border-[#1f2937] bg-[#0f172a]/60 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7dd3fc]">
                Scenes
              </div>
              <div className="space-y-1">
                {scenes.length > 0 ? (
                  scenes.map((scene) => {
                    const selected = selection?.kind === "scene" && selection.scene.path === scene.path;
                    const active = activeScenePath === scene.path;
                    return (
                      <button
                        key={scene.path}
                        type="button"
                        onClick={() => setSelection({ kind: "scene", scene })}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] transition-colors ${
                          selected
                            ? "bg-[#7dd3fc]/12 text-[#e0f2fe]"
                            : "text-[#d4d4d8] hover:bg-[#111827] hover:text-[#ffffff]"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{scene.display_name}</div>
                          <div className="truncate text-[10px] text-[#64748b]">{scene.path}</div>
                        </div>
                        {active ? (
                          <span className="rounded-full border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#bbf7d0]">
                            Active
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-[#334155] px-3 py-4 text-[11px] text-[#64748b]">
                    Nenhuma cena encontrada.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-[#1f2937] bg-[#0f172a]/60 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#cba6f7]">
                Assets
              </div>
              <div className="space-y-1">
                {assets.length > 0 ? (
                  <AssetTreeBranch
                    node={assetTree}
                    collapsed={collapsedFolders}
                    selectedPath={selectedAssetPath}
                    onToggle={toggleFolder}
                    onSelect={(asset) => setSelection({ kind: "asset", asset })}
                    depth={0}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-[#334155] px-3 py-4 text-[11px] text-[#64748b]">
                    Sem assets canonicos no projeto.
                  </div>
                )}
              </div>
            </section>

            {legacySections.length > 0 ? (
              <section className="rounded-2xl border border-[#1f2937] bg-[#0f172a]/60 p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f9e2af]">
                  Host SGDK
                </div>
                <div className="space-y-3">
                  {legacySections.map((section) => (
                    <div key={section.id} className="rounded-xl border border-[#1f2937] bg-[#0b1120] p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f9e2af]">
                          {section.label}
                        </span>
                        <span className="text-[10px] text-[#52525b]">{section.files.length}</span>
                      </div>
                      <div className="space-y-1">
                        {section.files.map((file) => {
                          const selected = selection?.kind === "legacy" && selection.path === file;
                          return (
                            <button
                              key={file}
                              type="button"
                              onClick={() => setSelection({ kind: "legacy", path: file })}
                              className={`w-full rounded-lg px-2 py-1 text-left font-mono text-[10px] transition-colors ${
                                selected
                                  ? "bg-[#f9e2af]/10 text-[#f9e2af]"
                                  : "text-[#d4d4d8] hover:bg-[#111827]"
                              }`}
                              title={file}
                            >
                              {file}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_top,rgba(30,41,59,0.35),transparent_45%),linear-gradient(180deg,#09090b,#111827)]">
          <div className="min-h-full p-4">
            {error ? (
              <div className="rounded-2xl border border-[#f38ba8]/35 bg-[#f38ba8]/10 px-4 py-3 text-[12px] text-[#fecdd3]">
                {error}
              </div>
            ) : null}

            {!error && !selection ? (
              <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-dashed border-[#334155] bg-[#0b1120]/60 px-8 text-center">
                <div>
                  <div className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#7dd3fc]">
                    Explorer Ready
                  </div>
                  <p
                    data-testid="explorer-empty-state-copy"
                    className="mt-3 max-w-lg text-[13px] leading-6 text-[#94a3b8]"
                  >
                    {isLegacyOverlayProject
                      ? "Selecione uma cena do overlay, um asset canonico ou um arquivo legado do host SGDK para navegar entre o que continua editavel em rds/ e o que permanece somente leitura."
                      : "Selecione uma cena, asset ou arquivo legado para navegar pela estrutura sintetizada do projeto."}
                  </p>
                </div>
              </div>
            ) : null}

            {selection?.kind === "scene" ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-[#1f2937] bg-[#0b1120]/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7dd3fc]">
                        Scene File
                      </div>
                      <h2 className="mt-2 text-xl font-semibold text-[#f8fafc]">
                        {selection.scene.display_name}
                      </h2>
                      <p className="mt-2 font-mono text-[12px] text-[#94a3b8]">{selection.scene.path}</p>
                      <p
                        data-testid="explorer-selection-source"
                        className="mt-3 text-[11px] text-[#94a3b8]"
                      >
                        Origem:{" "}
                        <span className="font-semibold text-[#e4e4e7]">
                          {isLegacyOverlayProject ? "overlay rds/scenes" : "projeto canônico"}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleActivateScene(selection.scene.path)}
                        disabled={!activeProjectDir || switchingScene || activeScenePath === selection.scene.path}
                        className="rounded-xl border border-[#7dd3fc]/30 bg-[#7dd3fc]/10 px-3 py-2 text-[12px] font-semibold text-[#dff6ff] transition-colors hover:bg-[#7dd3fc]/18 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {switchingScene && activeScenePath !== selection.scene.path ? "Abrindo..." : "Ativar cena"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSceneEditor?.()}
                        className="rounded-xl border border-[#313244] bg-[#111827] px-3 py-2 text-[12px] font-semibold text-[#cbd5e1] transition-colors hover:bg-[#1f2937]"
                      >
                        Abrir no Scene Editor
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {selection?.kind === "asset" ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-[#1f2937] bg-[#0b1120]/70 p-5">
                  <div className="flex flex-wrap items-start gap-5">
                    <div className="flex h-48 w-full max-w-[260px] items-center justify-center overflow-hidden rounded-2xl border border-[#1f2937] bg-[#030712]">
                      {selection.asset.kind === "image" ? (
                        <AssetPreview
                          absolutePath={selection.asset.absolute_path}
                          alt={selection.asset.relative_path}
                          imageClassName="h-full w-full object-contain"
                          fallbackClassName="flex h-full w-full items-center justify-center text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7dd3fc]"
                          fallbackLabel="Preview"
                          pixelated
                        />
                      ) : (
                        <span className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#7dd3fc]">
                          {selection.asset.kind}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#cba6f7]">
                        Asset
                      </div>
                      <h2 className="mt-2 text-xl font-semibold text-[#f8fafc]">
                        {selection.asset.relative_path.split("/").pop() ?? selection.asset.relative_path}
                      </h2>
                      <p
                        data-testid="explorer-selection-source"
                        className="mt-3 text-[11px] text-[#94a3b8]"
                      >
                        Origem:{" "}
                        <span className="font-semibold text-[#e4e4e7]">
                          {isLegacyOverlayProject ? "assets canônicos do overlay" : "projeto canônico"}
                        </span>
                      </p>
                      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px]">
                        <dt className="text-[#64748b]">Caminho</dt>
                        <dd className="break-all font-mono text-[#e4e4e7]">{selection.asset.relative_path}</dd>
                        <dt className="text-[#64748b]">Tipo</dt>
                        <dd className="text-[#e4e4e7]">{selection.asset.kind}</dd>
                        <dt className="text-[#64748b]">Origem</dt>
                        <dd className="break-all font-mono text-[#94a3b8]">{selection.asset.absolute_path}</dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {selection?.kind === "legacy" ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-[#1f2937] bg-[#0b1120]/70 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f9e2af]">
                        Legacy Host File
                      </div>
                      <h2 className="mt-2 break-all font-mono text-[16px] font-semibold text-[#f8fafc]">
                        {selection.path}
                      </h2>
                    </div>
                    <span className="rounded-full border border-[#313244] bg-[#111827] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f9e2af]">
                      Read-only
                    </span>
                  </div>

                  {legacyBusy ? (
                    <div className="mt-4 text-[12px] text-[#89b4fa]">Carregando preview...</div>
                  ) : null}

                  {legacyError ? (
                    <div className="mt-4 rounded-2xl border border-[#f38ba8]/35 bg-[#f38ba8]/10 px-4 py-3 text-[12px] text-[#fecdd3]">
                      {legacyError}
                    </div>
                  ) : null}

                  {legacyPreview ? (
                    <>
                      <p className="mt-4 break-all font-mono text-[11px] text-[#64748b]">
                        {legacyPreview.absolute_path}
                      </p>
                      <p className="mt-2 text-[12px] text-[#94a3b8]">{legacyPreview.note}</p>
                      <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl border border-[#1f2937] bg-[#020617] p-4 text-[11px] leading-6 text-[#cbd5e1]">
                        {legacyPreview.content}
                      </pre>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
