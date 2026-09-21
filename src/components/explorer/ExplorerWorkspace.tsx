import { useEffect, useMemo, useState } from "react";
import AssetPreview from "../common/AssetPreview";
import Button from "../common/Button";
import Icon, { type IconName } from "../common/Icon";
import Input from "../common/Input";
import {
  listScenes,
  switchScene,
  type LegacySgdkIndex,
  type SceneInfo,
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

type AssetView = "grid" | "tree";

function buildLegacyIndexSections(index: LegacySgdkIndex | null): LegacyIndexSection[] {
  if (!index) return [];
  return [
    { id: "source", label: "src/", files: index.source_files },
    { id: "headers", label: "inc/", files: index.header_files },
    { id: "manifests", label: "res/", files: index.manifest_files },
    { id: "resources", label: "assets host", files: index.resource_files },
    { id: "output", label: "out/", files: index.output_files },
  ].filter((section) => section.files.length > 0);
}

function countLegacyIndexedFiles(index: LegacySgdkIndex | null): number {
  return index
    ? index.source_files.length +
        index.header_files.length +
        index.manifest_files.length +
        index.resource_files.length +
        index.output_files.length
    : 0;
}

function buildAssetTree(assets: ProjectAssetEntry[]): AssetTreeNode {
  const root: AssetTreeNode = { name: "", path: "", isDir: true, children: [], fileCount: 0 };
  for (const asset of assets) {
    const segments = asset.relative_path.replace(/\\/g, "/").split("/");
    let current = root;
    segments.forEach((segment, index) => {
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
        return;
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
    });
  }
  const countFiles = (node: AssetTreeNode): number => {
    if (!node.isDir) return 1;
    node.fileCount = node.children.reduce((total, child) => total + countFiles(child), 0);
    return node.fileCount;
  };
  countFiles(root);
  return root;
}

function assetIcon(kind: ProjectAssetEntry["kind"]): IconName {
  if (kind === "image") return "palette";
  if (kind === "audio") return "gamepad";
  return "info-circle";
}

function assetKindLabel(kind: ProjectAssetEntry["kind"]): string {
  if (kind === "image") return "Imagem";
  if (kind === "audio") return "Áudio";
  return "Arquivo";
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
            role="treeitem"
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(node.path)}
            className="flex min-h-7 w-full items-center gap-2 rounded-[var(--rds-radius-md)] px-2 py-1 text-left text-[11px] text-[var(--rds-text-secondary)] transition-colors hover:bg-[var(--rds-surface-hover)]"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <Icon name={isCollapsed ? "sidebar-expand" : "sidebar-collapse"} size={14} />
            <Icon name="folder" size={15} className="text-[var(--rds-status-warning)]" />
            <span className="min-w-0 truncate font-semibold">{node.name}</span>
            <span className="ml-auto text-[10px] text-[var(--rds-text-muted)]">{node.fileCount}</span>
          </button>
        ) : null}
        {!isCollapsed
          ? node.children.map((child) => (
              <AssetTreeBranch
                key={child.path}
                node={child}
                collapsed={collapsed}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                depth={node.name ? depth + 1 : depth}
              />
            ))
          : null}
      </>
    );
  }

  const asset = node.asset!;
  const selected = asset.relative_path === selectedPath;
  return (
    <button
      type="button"
      role="treeitem"
      data-testid={`explorer-tree-asset-${asset.relative_path}`}
      aria-selected={selected}
      onClick={() => onSelect(asset)}
      title={asset.relative_path}
      className={`flex min-h-8 w-full items-center gap-2 rounded-[var(--rds-radius-md)] py-1 text-left text-[11px] transition-colors ${
        selected
          ? "bg-[var(--rds-surface-active)] text-[var(--rds-text-primary)]"
          : "text-[var(--rds-text-secondary)] hover:bg-[var(--rds-surface-hover)]"
      }`}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <Icon name={assetIcon(asset.kind)} size={15} className="text-[var(--rds-status-info)]" />
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
    setActiveWorkspace,
    setArtStudioAssetPath,
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
  const [assetView, setAssetView] = useState<AssetView>("grid");
  const [assetQuery, setAssetQuery] = useState("");

  const normalizedQuery = assetQuery.trim().toLocaleLowerCase("pt-BR");
  const visibleAssets = useMemo(
    () =>
      normalizedQuery
        ? assets.filter((asset) =>
            `${asset.relative_path} ${assetKindLabel(asset.kind)}`
              .toLocaleLowerCase("pt-BR")
              .includes(normalizedQuery)
          )
        : assets,
    [assets, normalizedQuery]
  );
  const assetTree = useMemo(() => buildAssetTree(visibleAssets), [visibleAssets]);
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
    if (!selection) onSelectionChange?.(null);
    else if (selection.kind === "scene") onSelectionChange?.(selection.scene.path);
    else if (selection.kind === "asset") onSelectionChange?.(selection.asset.relative_path);
    else onSelectionChange?.(selection.path);
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
    const load = async () => {
      setBusy(true);
      try {
        const [sceneList, assetList] = await Promise.all([
          listScenes(activeProjectDir),
          listProjectAssets(activeProjectDir),
        ]);
        if (!cancelled) {
          setScenes(sceneList);
          setAssets(assetList);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) setError(describeError(loadError));
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeProjectDir]);

  useEffect(() => {
    if (!activeProjectDir) return;
    let cancelled = false;
    let stopListening: (() => void) | null = null;
    void listenToProjectAssetChanges((payload) => {
      if (cancelled || payload.project_dir !== activeProjectDir) return;
      void listProjectAssets(activeProjectDir)
        .then((result) => {
          if (!cancelled) setAssets(result);
        })
        .catch((loadError) => {
          if (!cancelled) setError(describeError(loadError));
        });
    })
      .then((stop) => {
        if (cancelled) stop();
        else stopListening = stop;
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
    if (!activeProjectDir) return;
    const legacyPath = selection.path;
    let cancelled = false;
    setLegacyBusy(true);
    setLegacyError(null);
    void readLegacyProjectFile(activeProjectDir, legacyPath)
      .then((result) => {
        if (!cancelled) setLegacyPreview(result);
      })
      .catch((previewError) => {
        if (!cancelled) {
          setLegacyPreview(null);
          setLegacyError(describeError(previewError));
        }
      })
      .finally(() => {
        if (!cancelled) setLegacyBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectDir, selection]);

  async function handleActivateScene(scenePath: string) {
    if (!activeProjectDir || switchingScene) return;
    if (!(await persistActiveScene(activeProjectDir, "Explorer"))) return;
    setSwitchingScene(true);
    try {
      const result = await switchScene(activeProjectDir, scenePath);
      if (!result.ok) throw new Error(result.error);
      const hydrated = await hydrateSceneResult(activeProjectDir, result);
      if (!hydrated) throw new Error("Falha ao reidratar a cena selecionada.");
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
      logMessage("success", `[Explorer] Cena ativa: ${hydrated.resolvedScene.display_name ?? hydrated.resolvedScene.scene_id}`);
    } catch (sceneError) {
      logMessage("error", `[Explorer] Falha ao trocar cena: ${describeError(sceneError)}`);
    } finally {
      setSwitchingScene(false);
    }
  }

  function handleRefresh() {
    if (!activeProjectDir) return;
    setBusy(true);
    Promise.all([listScenes(activeProjectDir), listProjectAssets(activeProjectDir)])
      .then(([sceneList, assetList]) => {
        setScenes(sceneList);
        setAssets(assetList);
        setError(null);
      })
      .catch((refreshError) => setError(describeError(refreshError)))
      .finally(() => setBusy(false));
  }

  function toggleFolder(path: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function openAssetInArtStudio(asset: ProjectAssetEntry) {
    if (asset.kind !== "image") return;
    setArtStudioAssetPath(asset.absolute_path);
    setActiveWorkspace("artstudio");
    logMessage("info", `[Explorer] Asset aberto no Art Studio: ${asset.relative_path}`);
  }

  const selectedAssetPath = selection?.kind === "asset" ? selection.asset.relative_path : null;
  const legacyCount = legacySections.reduce((count, section) => count + section.files.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--rds-surface-canvas)] text-[var(--rds-text-primary)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rds-border-subtle)] bg-[var(--rds-surface-base)] px-4 py-3">
        <div>
          <span className="rds-sr-only">
            Workspace contextual de arquivos · Cenas {scenes.length}
          </span>
          <div className="flex items-center gap-2">
            <Icon name="folder" size={18} className="text-[var(--rds-status-info)]" />
            <h1 className="text-sm font-semibold">Explorer</h1>
            <span className="rounded-full border border-[var(--rds-border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--rds-status-warning)]">
              Experimental
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--rds-text-muted)]">
            Um catálogo canônico para navegar, visualizar e continuar a tarefa.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--rds-text-secondary)]">
          <span>{scenes.length} cenas</span>
          <span aria-hidden="true">·</span>
          <span>{assets.length} assets</span>
          {legacyCount > 0 ? <span>· {legacyCount} arquivos host</span> : null}
          <Button
            size="sm"
            variant="ghost"
            iconStart={<Icon name="refresh" size={16} />}
            onClick={handleRefresh}
            disabled={!activeProjectDir}
            loading={busy}
            loadingLabel="Atualizando catálogo"
          >
            Atualizar
          </Button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="m-3 flex items-start gap-2 rounded-[var(--rds-radius-lg)] border border-[var(--rds-status-error)] bg-[var(--rds-surface-panel)] px-3 py-2 text-xs text-[var(--rds-status-error)]">
          <Icon name="warning-triangle" size={17} />
          <span><strong>Não foi possível atualizar o Explorer.</strong> {error} Tente atualizar novamente.</span>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,0.7fr)_minmax(320px,1.4fr)_minmax(250px,0.9fr)]">
        <aside aria-label="Estrutura do projeto" className="min-h-0 overflow-auto border-r border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3">
          {isLegacyOverlayProject ? (
            <section data-testid="legacy-host-summary" className="mb-3 rounded-[var(--rds-radius-lg)] border border-[var(--rds-border-default)] bg-[var(--rds-surface-panel)] p-3 text-[11px]">
              <div className="flex items-center gap-2 font-semibold text-[var(--rds-status-warning)]">
                <Icon name="info-circle" size={16} /> Overlay SGDK · somente leitura no host
              </div>
              <p className="mt-2 break-all font-mono text-[var(--rds-text-secondary)]">{projectLegacyIndex?.host_root}</p>
              <p className="mt-2 text-[var(--rds-text-muted)]">
                Overlay rds/ editável · {legacyIndexedFileCount} arquivo(s) indexado(s) · Build &amp; Run delega ao Makefile do host.
              </p>
            </section>
          ) : null}

          <section aria-labelledby="explorer-scenes-title">
            <h2 id="explorer-scenes-title" className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-text-muted)]">Cenas</h2>
            <div className="space-y-1">
              {scenes.length ? scenes.map((scene) => {
                const selected = selection?.kind === "scene" && selection.scene.path === scene.path;
                return (
                  <button
                    key={scene.path}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelection({ kind: "scene", scene })}
                    className={`flex min-h-10 w-full items-center gap-2 rounded-[var(--rds-radius-md)] px-2 py-1.5 text-left text-[11px] transition-colors ${selected ? "bg-[var(--rds-surface-active)]" : "hover:bg-[var(--rds-surface-hover)]"}`}
                  >
                    <Icon name="network" size={16} className="text-[var(--rds-status-info)]" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{scene.display_name}</span><span className="block truncate text-[10px] text-[var(--rds-text-muted)]">{scene.path}</span></span>
                    {activeScenePath === scene.path ? <span className="text-[9px] font-semibold text-[var(--rds-status-success)]">Ativa</span> : null}
                  </button>
                );
              }) : <p className="rounded-[var(--rds-radius-md)] border border-dashed border-[var(--rds-border-default)] p-3 text-[11px] text-[var(--rds-text-muted)]">Nenhuma cena encontrada.</p>}
            </div>
          </section>

          {legacySections.length ? (
            <section className="mt-4" aria-labelledby="explorer-host-title">
              <h2 id="explorer-host-title" className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-text-muted)]">Host SGDK</h2>
              {legacySections.map((section) => (
                <details key={section.id} className="mb-1" open={section.id === "source"}>
                  <summary className="min-h-7 cursor-pointer rounded-[var(--rds-radius-md)] px-2 py-1 text-[11px] font-semibold hover:bg-[var(--rds-surface-hover)]">{section.label} <span className="text-[var(--rds-text-muted)]">{section.files.length}</span></summary>
                  <div className="ml-2 space-y-1 border-l border-[var(--rds-border-subtle)] pl-2">
                    {section.files.map((file) => (
                      <button key={file} type="button" onClick={() => setSelection({ kind: "legacy", path: file })} className="min-h-7 w-full truncate rounded-[var(--rds-radius-md)] px-2 py-1 text-left font-mono text-[10px] text-[var(--rds-text-secondary)] hover:bg-[var(--rds-surface-hover)]" title={file}>{file}</button>
                    ))}
                  </div>
                </details>
              ))}
            </section>
          ) : null}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-[var(--rds-surface-base)]">
          <div className="flex items-end gap-2 border-b border-[var(--rds-border-subtle)] p-3">
            <Input
              type="search"
              label="Buscar assets"
              hideLabel
              placeholder="Buscar por nome, tipo ou caminho"
              value={assetQuery}
              onChange={(event) => setAssetQuery(event.target.value)}
              leadingIcon={<Icon name="search" size={16} />}
              fieldClassName="min-w-0 flex-1"
            />
            <div role="group" aria-label="Modo de visualização" className="flex gap-1">
              <Button size="sm" variant={assetView === "grid" ? "primary" : "ghost"} aria-pressed={assetView === "grid"} onClick={() => setAssetView("grid")} iconStart={<Icon name="menu" size={15} />}>Grade</Button>
              <Button size="sm" variant={assetView === "tree" ? "primary" : "ghost"} aria-pressed={assetView === "tree"} onClick={() => setAssetView("tree")} iconStart={<Icon name="folder" size={15} />}>Árvore</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="mb-3 flex items-center justify-between text-[11px] text-[var(--rds-text-muted)]">
              <span>{visibleAssets.length} de {assets.length} assets</span>
              {normalizedQuery ? <Button size="sm" variant="ghost" onClick={() => setAssetQuery("")}>Limpar busca</Button> : null}
            </div>
            {!activeProjectDir ? (
              <div className="grid min-h-64 place-items-center rounded-[var(--rds-radius-lg)] border border-dashed border-[var(--rds-border-default)] text-center text-sm text-[var(--rds-text-muted)]"><div><Icon name="folder" size={30} className="mx-auto mb-3" /><strong className="block text-[var(--rds-text-primary)]">Abra um projeto para navegar</strong><span className="mt-1 block">O catálogo aparece aqui assim que o projeto estiver ativo.</span></div></div>
            ) : visibleAssets.length === 0 ? (
              <div className="grid min-h-64 place-items-center rounded-[var(--rds-radius-lg)] border border-dashed border-[var(--rds-border-default)] text-center text-sm text-[var(--rds-text-muted)]"><div><Icon name="search" size={30} className="mx-auto mb-3" /><strong className="block text-[var(--rds-text-primary)]">Nenhum asset corresponde à busca</strong><span className="mt-1 block">Ajuste o termo ou limpe a busca para ver todo o catálogo.</span></div></div>
            ) : assetView === "tree" ? (
              <div role="tree" aria-label="Assets canônicos" className="space-y-1 rounded-[var(--rds-radius-lg)] border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] p-2">
                <AssetTreeBranch node={assetTree} collapsed={collapsedFolders} selectedPath={selectedAssetPath} onToggle={toggleFolder} onSelect={(asset) => setSelection({ kind: "asset", asset })} depth={0} />
              </div>
            ) : (
              <div role="list" aria-label="Assets canônicos" className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
                {visibleAssets.map((asset) => {
                  const selected = asset.relative_path === selectedAssetPath;
                  const fileName = asset.relative_path.split("/").pop() ?? asset.relative_path;
                  return (
                    <button
                      key={asset.relative_path}
                      type="button"
                      role="listitem"
                      data-testid={`explorer-grid-asset-${asset.relative_path}`}
                      aria-pressed={selected}
                      onClick={() => setSelection({ kind: "asset", asset })}
                      onDoubleClick={() => openAssetInArtStudio(asset)}
                      className={`group min-h-32 rounded-[var(--rds-radius-lg)] border p-3 text-left transition-colors ${selected ? "border-[var(--rds-focus-ring)] bg-[var(--rds-surface-active)]" : "border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] hover:border-[var(--rds-border-strong)] hover:bg-[var(--rds-surface-hover)]"}`}
                    >
                      <span className="flex h-16 items-center justify-center rounded-[var(--rds-radius-md)] bg-[var(--rds-surface-canvas)] text-[var(--rds-status-info)]"><Icon name={assetIcon(asset.kind)} size={28} /></span>
                      <span className="mt-2 block truncate text-xs font-semibold">{fileName}</span>
                      <span className="mt-1 block text-[10px] text-[var(--rds-text-muted)]">{assetKindLabel(asset.kind)} · Enter para detalhes</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        <aside aria-label="Detalhes da seleção" className="min-h-0 overflow-auto border-l border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-text-muted)]">Detalhes</h2>
          {!selection ? (
            <div className="rounded-[var(--rds-radius-lg)] border border-dashed border-[var(--rds-border-default)] p-4 text-center text-[11px] text-[var(--rds-text-muted)]" data-testid="explorer-empty-state-copy">
              <Icon name="info-circle" size={24} className="mx-auto mb-2" />
              {isLegacyOverlayProject ? "Selecione uma cena ou asset do overlay, ou um arquivo host somente leitura." : "Selecione uma cena ou asset para visualizar e continuar a tarefa."}
            </div>
          ) : null}

          {selection?.kind === "scene" ? (
            <div className="space-y-3">
              <Icon name="network" size={28} className="text-[var(--rds-status-info)]" />
              <div><h3 className="font-semibold">{selection.scene.display_name}</h3><p className="mt-1 break-all font-mono text-[10px] text-[var(--rds-text-muted)]">{selection.scene.path}</p></div>
              <p data-testid="explorer-selection-source" className="text-[11px] text-[var(--rds-text-secondary)]">Origem: {isLegacyOverlayProject ? "overlay rds/scenes" : "projeto canônico"}</p>
              <Button className="w-full" variant="primary" loading={switchingScene} disabled={!activeProjectDir || activeScenePath === selection.scene.path} onClick={() => void handleActivateScene(selection.scene.path)}>Ativar cena</Button>
              <Button className="w-full" variant="secondary" iconStart={<Icon name="open-new-window" size={16} />} onClick={() => onOpenSceneEditor?.()}>Abrir no Scene Editor</Button>
            </div>
          ) : null}

          {selection?.kind === "asset" ? (
            <div className="space-y-3">
              <div className="flex h-44 items-center justify-center overflow-hidden rounded-[var(--rds-radius-lg)] border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-canvas)]">
                {selection.asset.kind === "image" ? <AssetPreview absolutePath={selection.asset.absolute_path} alt={selection.asset.relative_path} imageClassName="h-full w-full object-contain" fallbackClassName="text-xs text-[var(--rds-text-muted)]" fallbackLabel="Preview indisponível" pixelated /> : <Icon name={assetIcon(selection.asset.kind)} size={40} className="text-[var(--rds-status-info)]" />}
              </div>
              <div><h3 className="break-all font-semibold">{selection.asset.relative_path.split("/").pop()}</h3><p className="mt-1 text-[11px] text-[var(--rds-text-muted)]">{assetKindLabel(selection.asset.kind)}</p></div>
              <p data-testid="explorer-selection-source" className="text-[11px] text-[var(--rds-text-secondary)]">Origem: {isLegacyOverlayProject ? "assets canônicos do overlay" : "projeto canônico"}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-2 text-[11px]"><dt className="text-[var(--rds-text-muted)]">Caminho</dt><dd className="break-all font-mono">{selection.asset.relative_path}</dd></dl>
              {selection.asset.kind === "image" ? <Button className="w-full" variant="primary" iconStart={<Icon name="palette" size={16} />} onClick={() => openAssetInArtStudio(selection.asset)}>Abrir no Art Studio</Button> : null}
            </div>
          ) : null}

          {selection?.kind === "legacy" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[var(--rds-status-warning)]"><Icon name="warning-triangle" size={18} /><strong className="text-xs">Host somente leitura</strong></div>
              <h3 className="break-all font-mono text-xs">{selection.path}</h3>
              {legacyBusy ? <p role="status" className="text-xs text-[var(--rds-status-info)]">Carregando preview…</p> : null}
              {legacyError ? <p role="alert" className="text-xs text-[var(--rds-status-error)]">{legacyError}</p> : null}
              {legacyPreview ? <><p className="text-[11px] text-[var(--rds-text-muted)]">{legacyPreview.note}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-[var(--rds-radius-md)] border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-canvas)] p-3 text-[10px] leading-5 text-[var(--rds-text-secondary)]">{legacyPreview.content}</pre></> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
