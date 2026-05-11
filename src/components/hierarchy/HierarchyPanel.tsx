import { useEffect, useMemo, useState } from "react";
import Panel from "../common/Panel";
import SceneWorkspaceNotice from "../common/SceneWorkspaceNotice";
import { useEditorStore } from "../../core/store/editorStore";
import {
  createScene,
  getSceneData,
  listScenes,
  switchScene,
  type SceneInfo,
} from "../../core/ipc/sceneService";
import { hydrateSceneResult, persistActiveScene } from "../../core/scenePersistence";
import { listProjectAssets } from "../../core/ipc/toolsService";
import {
  createSpriteEntityFromAsset,
  pickDefaultSpriteAsset,
} from "../../core/editorEntityFactory";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { resolveImportedEntityContext } from "../../core/importedEntityContext";
import {
  getWorkspaceEntityRole,
  resolveSceneWorkspaceContext,
} from "../../core/sceneWorkspaceContext";
import {
  buildTilemapAuthoringBrush,
  resolvePrimaryAuthoringSurface,
} from "../../core/entityAuthoring";
import type { Entity } from "../../core/ipc/sceneService";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TYPE_ICON: Record<string, string> = {
  sprite: "◈",
  tilemap: "▦",
  camera: "⊙",
  audio: "♫",
  layer: "▬",
  object: "○",
};

const GROUP_ORDER: string[] = ["camera", "sprite", "tilemap", "audio", "object"];

const GROUP_LABELS: Record<string, string> = {
  camera: "Câmeras",
  sprite: "Sprites",
  tilemap: "Cenários",
  audio: "Áudio",
  object: "Outros",
};

interface EntityGroup {
  type: string;
  entities: Array<{ entity_id: string; display_name?: string | null; prefab?: string | null; components?: { sprite?: unknown; collision?: unknown; tilemap?: { map_width?: number; map_height?: number; cells?: number[] } | undefined; camera?: unknown; audio?: unknown } }>;
}

function tilemapPaintInfo(entity: {
  components?: { tilemap?: { map_width?: number; map_height?: number; cells?: number[] } };
}): { filled: number; total: number } | null {
  const tm = entity.components?.tilemap;
  if (!tm) return null;
  const total = (tm.map_width ?? 0) * (tm.map_height ?? 0);
  const filled = (tm.cells ?? []).reduce(
    (acc, v) => acc + ((v | 0) > 0 ? 1 : 0),
    0
  );
  return { filled, total };
}

function importedRoleBadgeClass(roleLabel: string | null): string {
  switch (roleLabel) {
    case "Jogador":
      return "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]";
    case "Inimigo":
    case "Lutador":
    case "Projetil":
      return "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#f38ba8]";
    case "Apoio":
    case "HUD / UI":
      return "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]";
    default:
      return "border-[#313244] bg-[#11111b] text-[#cdd6f4]";
  }
}

function importedEntityKindChip(entityType: string, roleLabel: string | null): string | null {
  if (entityType === "tilemap") return "Tilemap";
  if (entityType === "camera") return "Entrada";
  if (roleLabel === "Jogador") return "Driver";
  if (roleLabel === "Inimigo" || roleLabel === "Lutador" || roleLabel === "Projetil") return "Actor";
  if (roleLabel === "Apoio") return "Suporte";
  if (roleLabel === "HUD / UI") return "HUD";
  return null;
}

export default function HierarchyPanel() {
  const {
    selectedEntityId, setSelectedEntityId,
    activeProjectDir,
    activeTarget,
    activeScenePath,
    activeScene, setActiveScene,
    setActiveScenePath,
    projectSourceKind,
    projectLegacyIndex,
    addEntity, removeEntity,
    logMessage,
    setActiveWorkspace,
    setActiveViewportTab,
    setActiveTilemapId,
    setEditorMode,
    setActiveBrush,
  } = useEditorStore();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newName, setNewName] = useState("Entity");
  const [isAdding, setIsAdding] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingScenes, setIsLoadingScenes] = useState(false);
  const [isSwitchingScene, setIsSwitchingScene] = useState(false);
  const [isCreatingScene, setIsCreatingScene] = useState(false);
  const [sceneItems, setSceneItems] = useState<SceneInfo[]>([]);
  const [filterText, setFilterText] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  async function refreshSceneCatalog(projectDir: string) {
    const scenes = await listScenes(projectDir);
    setSceneItems(scenes);
    return scenes;
  }

  async function activateScene(scenePath: string, options?: { skipPersist?: boolean }) {
    if (!activeProjectDir || !scenePath || isSwitchingScene) {
      return false;
    }
    if (!options?.skipPersist && !(await persistActiveScene(activeProjectDir, "Hierarchy"))) {
      return false;
    }

    setIsSwitchingScene(true);
    try {
      const result = await switchScene(activeProjectDir, scenePath);
      if (!result.ok) {
        logMessage("error", `[Hierarchy] ${result.error}`);
        return false;
      }

      const hydrated = await hydrateSceneResult(activeProjectDir, result);
      if (!hydrated) {
        logMessage("error", "[Hierarchy] Falha ao reidratar a cena selecionada.");
        return false;
      }

      setSelectedEntityId(null);
      setActiveScenePath(result.scene_path);
      setActiveScene(hydrated.resolvedScene, hydrated.sourceScene);
      logMessage(
        "success",
        `[Hierarchy] Cena ativa: ${hydrated.resolvedScene.display_name ?? hydrated.resolvedScene.scene_id}`
      );
      return true;
    } catch (error) {
      logMessage("error", `[Hierarchy] Falha ao trocar cena: ${describeError(error)}`);
      return false;
    } finally {
      setIsSwitchingScene(false);
    }
  }

  // Recarrega cena sempre que o projeto ativo mudar
  useEffect(() => {
    let cancelled = false;

    if (!activeProjectDir) {
      setSceneItems([]);
      setActiveScenePath("");
      setActiveScene(null);
      return;
    }

    setIsLoadingScenes(true);
    Promise.all([listScenes(activeProjectDir), getSceneData(activeProjectDir)])
      .then(async ([scenes, result]) => {
        if (cancelled) return;
        setSceneItems(scenes);

        const hydrated = await hydrateSceneResult(activeProjectDir, result);
        setActiveScenePath(result.scene_path);
        setActiveScene(
          hydrated?.resolvedScene ?? null,
          hydrated?.sourceScene ?? null
        );
        if (!result.ok) {
          logMessage("warn", `[Hierarchy] ${result.error}`);
        } else if (!hydrated) {
          logMessage("error", "[Hierarchy] Falha ao reidratar a cena carregada.");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logMessage("error", `[Hierarchy] Falha ao carregar cena: ${describeError(error)}`);
        setSceneItems([]);
        setActiveScenePath("");
        setActiveScene(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingScenes(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectDir, logMessage, setActiveScene, setActiveScenePath]);

  const entities = activeScene?.entities ?? [];
  const bgLayers = activeScene?.background_layers ?? [];
  const sceneLayerCount = activeScene?.layers?.length ?? 0;

  const filterLower = filterText.toLowerCase();
  const filteredEntities = filterText
    ? entities.filter((entity) =>
      [getEntityDisplayName(entity), entity.prefab ?? ""].some((value) =>
        value.toLowerCase().includes(filterLower)
      )
    )
    : entities;
  const filteredLayers = filterText
    ? bgLayers.filter((layer) =>
      layer.layer_id.toLowerCase().includes(filterLower)
    )
    : bgLayers;
  const filteredItemCount = filteredEntities.length + filteredLayers.length;
  const sceneContext = useMemo(
    () =>
      resolveSceneWorkspaceContext({
        scene: activeScene,
        scenePath: activeScenePath,
        projectSourceKind,
        projectLegacyIndex,
      }),
    [activeScene, activeScenePath, projectLegacyIndex, projectSourceKind]
  );

  const entityGroups: EntityGroup[] = useMemo(() => {
    const grouped = new Map<string, EntityGroup>();
    for (const type of GROUP_ORDER) {
      grouped.set(type, { type, entities: [] });
    }
    for (const entity of filteredEntities) {
      const type = getWorkspaceEntityRole(entity);
      const group = grouped.get(type);
      if (group) {
        group.entities.push(entity);
      } else {
        const fallback = grouped.get("object")!;
        fallback.entities.push(entity);
      }
    }
    return GROUP_ORDER.map((type) => grouped.get(type)!).filter(
      (group) => group.entities.length > 0
    );
  }, [filteredEntities]);

  function openEntityAuthoringSurface(entity: Entity) {
    const surface = resolvePrimaryAuthoringSurface(entity);
    setSelectedEntityId(entity.entity_id);

    if (surface === "tilemap") {
      setActiveWorkspace("scene");
      setActiveViewportTab("scene");
      setActiveTilemapId(entity.entity_id);
      setEditorMode("paint");
      const brush = buildTilemapAuthoringBrush(entity);
      if (brush) {
        setActiveBrush(brush);
      }
      logMessage(
        "info",
        `[Hierarchy] Tilemap '${getEntityDisplayName(entity)}' aberto para pintura no viewport.`
      );
      return;
    }

    if (surface === "logic") {
      setActiveWorkspace("logic");
      setActiveViewportTab("logic");
      logMessage(
        "info",
        `[Hierarchy] Navegando para Logic Workspace: ${getEntityDisplayName(entity)}.`
      );
      return;
    }

    if (surface === "artstudio") {
      setActiveWorkspace("artstudio");
      setActiveViewportTab("artstudio");
      logMessage(
        "info",
        `[Hierarchy] Navegando para Art Workspace: ${getEntityDisplayName(entity)}.`
      );
      return;
    }

    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
  }

  function toggleGroup(type: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  async function resolveDefaultSpriteAsset(): Promise<string | null> {
    if (!activeProjectDir) {
      return null;
    }

    const assets = await listProjectAssets(activeProjectDir);
    return pickDefaultSpriteAsset(assets);
  }

  async function handleAddStarterSprite() {
    const { activeScene: currentScene } = useEditorStore.getState();
    if (!activeProjectDir || !currentScene || isAdding) return;

    setIsAdding(true);
    try {
      const assetPath = await resolveDefaultSpriteAsset();
      if (!assetPath) {
        logMessage("warn", "[Hierarchy] Nenhum asset de imagem encontrado em assets/ para instanciar na cena.");
        return;
      }

      const entity = createSpriteEntityFromAsset({
        assetPath,
        target: activeTarget,
        existingEntityIds: currentScene.entities.map((candidate) => candidate.entity_id),
        includeStarterLogic:
          currentScene.entities.length === 0 && currentScene.background_layers.length === 0,
      });

      addEntity(entity);
      setSelectedEntityId(entity.entity_id);
      await persistActiveScene(
        activeProjectDir,
        "Hierarchy",
        `Sprite '${getEntityDisplayName(entity)}' criado a partir de '${assetPath}'.`
      );
    } catch (error: unknown) {
      logMessage("error", `[Hierarchy] Falha ao criar sprite inicial: ${describeError(error)}`);
    } finally {
      setIsAdding(false);
    }
  }

  async function handleAddEntity() {
    const displayName = newName.trim();
    if (!activeProjectDir || !activeScene || !displayName || isAdding) return;

    setIsAdding(true);
    try {
      const id = `${displayName.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
      const newEntity = {
        entity_id: id,
        display_name: displayName,
        prefab: null,
        transform: { x: 16, y: 16 },
        components: {},
      };

      addEntity(newEntity);
      setSelectedEntityId(id);

      const saved = await persistActiveScene(activeProjectDir, "Hierarchy", `Entidade '${displayName}' adicionada.`);

      if (saved) {
        setShowAddDialog(false);
        setNewName("Entity");
        return;
      }

      const { activeScene: reloadedScene } = useEditorStore.getState();
      const entityStillExists = reloadedScene?.entities.some((entity) => entity.entity_id === id) ?? false;
      if (!entityStillExists) {
        setSelectedEntityId(null);
      }
    } catch (error: unknown) {
      logMessage("error", `[Hierarchy] Falha ao adicionar entidade: ${describeError(error)}`);
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDeleteEntity() {
    if (!activeProjectDir || !activeScene || !selectedEntityId || selectedEntityId.startsWith("layer::") || isDeleting) {
      return;
    }

    setIsDeleting(true);
    try {
      const entityId = selectedEntityId;
      const targetEntity = activeScene.entities.find((entity) => entity.entity_id === entityId);
      const name = targetEntity ? getEntityDisplayName(targetEntity) : entityId;
      removeEntity(entityId);

      const saved = await persistActiveScene(activeProjectDir, "Hierarchy", `Entidade '${name}' removida.`);

      if (saved) {
        return;
      }

      const { activeScene: reloadedScene } = useEditorStore.getState();
      const entityStillExists = reloadedScene?.entities.some((entity) => entity.entity_id === entityId) ?? false;
      if (entityStillExists) {
        setSelectedEntityId(entityId);
      }
    } catch (error: unknown) {
      logMessage("error", `[Hierarchy] Falha ao remover entidade: ${describeError(error)}`);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleCreateScene() {
    if (!activeProjectDir || isCreatingScene) return;

    const requestedName = window.prompt("Nome da nova cena", "New Scene");
    if (requestedName === null) {
      return;
    }

    if (!(await persistActiveScene(activeProjectDir, "Hierarchy"))) {
      return;
    }

    setIsCreatingScene(true);
    try {
      const created = await createScene(activeProjectDir, requestedName.trim() || undefined);
      await refreshSceneCatalog(activeProjectDir);
      await activateScene(created.path, { skipPersist: true });
    } catch (error) {
      logMessage("error", `[Hierarchy] Falha ao criar cena: ${describeError(error)}`);
    } finally {
      setIsCreatingScene(false);
    }
  }

  const activeSceneSelectValue = activeScenePath || sceneItems[0]?.path || "";
  const sceneBusy = isLoadingScenes || isSwitchingScene || isCreatingScene;

  return (
    <>
      {/* ── Modal: Nova Entidade ── */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#181825] border border-[#313244] rounded-lg p-4 w-60 flex flex-col gap-3 shadow-2xl">
            <h2 className="text-xs font-bold text-[#cba6f7]">Nova Entidade</h2>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleAddEntity()}
              className="bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1.5 text-xs text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]"
              placeholder="Nome da entidade"
              disabled={isAdding}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddDialog(false)}
                disabled={isAdding}
                className="px-2 py-1 text-xs rounded bg-[#313244] text-[#a6adc8] hover:bg-[#45475a] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleAddEntity()}
                disabled={isAdding}
                className="px-2 py-1 text-xs rounded bg-[#cba6f7] text-[#1e1e2e] font-semibold hover:bg-[#b4a0e0] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isAdding ? "Salvando..." : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Panel
        title="Hierarchy"
        className="h-full"
        headerActions={
          <div className="flex gap-1">
            <button
              onClick={() => { setNewName("Entity"); setShowAddDialog(true); }}
              disabled={!activeProjectDir || isAdding || isDeleting}
              className="text-xs text-[#6c7086] hover:text-[#a6e3a1] transition-colors px-1 disabled:opacity-30"
              title="Adicionar entidade"
            >
              +
            </button>
            <button
              onClick={() => void handleDeleteEntity()}
              disabled={!selectedEntityId || !!selectedEntityId?.startsWith("layer::") || isAdding || isDeleting}
              className="text-xs text-[#6c7086] hover:text-[#f38ba8] transition-colors px-1 disabled:opacity-30"
              title="Remover entidade selecionada"
            >
              −
            </button>
          </div>
        }
      >
        <div className="border-b border-[#313244] px-3 py-2">
          <div className="flex items-center gap-2">
            <select
              value={activeSceneSelectValue}
              onChange={(event) => {
                void activateScene(event.target.value);
              }}
              disabled={!activeProjectDir || sceneBusy || sceneItems.length === 0}
              className="min-w-0 flex-1 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs text-[#cdd6f4] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              title="Selecionar cena ativa"
            >
              {sceneItems.length === 0 ? (
                <option value="">Sem cenas</option>
              ) : (
                sceneItems.map((scene) => (
                  <option key={scene.path} value={scene.path}>
                    {scene.display_name}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => void handleCreateScene()}
              disabled={!activeProjectDir || sceneBusy}
              className="rounded bg-[#313244] px-2 py-1 text-[10px] font-semibold text-[#a6adc8] transition-colors hover:bg-[#45475a] disabled:cursor-not-allowed disabled:opacity-40"
              title="Criar nova cena"
            >
              {isCreatingScene ? "Criando..." : "Nova Cena"}
            </button>
          </div>
          <p className="mt-1 truncate text-[10px] text-[#45475a]">
            {activeSceneSelectValue || "Nenhuma cena ativa"}
          </p>
          {activeProjectDir ? (
            <div className="mt-2">
              <SceneWorkspaceNotice
                context={sceneContext}
                testId="hierarchy-scene-notice"
                actions={
                  sceneContext.focusEntityId ? (
                    <button
                      type="button"
                      onClick={() => setSelectedEntityId(sceneContext.focusEntityId)}
                      className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#89b4fa] hover:text-[#89b4fa]"
                    >
                      Focar entidade guia
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : null}
          <div
            data-testid="hierarchy-scene-summary"
            className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-[#7f849c]"
          >
            {[
              { label: "Cenas", value: sceneItems.length },
              { label: "Camadas", value: sceneLayerCount },
              { label: "Entidades", value: entities.length },
              { label: "Fundos", value: bgLayers.length },
            ].map((item) => (
              <span
                key={item.label}
                className="rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5"
              >
                {item.label}: <span className="font-semibold text-[#cdd6f4]">{item.value}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="border-b border-[#313244] px-3 py-2 flex items-center gap-2">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilterText("")}
            placeholder="Buscar..."
            disabled={!activeProjectDir || (entities.length === 0 && bgLayers.length === 0 && !filterText)}
            className="w-full rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs text-[#cdd6f4] focus:border-[#89b4fa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText("")}
              className="text-[14px] text-[#f38ba8] hover:text-[#eba0ac] font-bold px-1 transition-colors"
              title="Limpar busca"
            >
              ×
            </button>
          )}
        </div>

        <ul className="py-1">
          {/* Background Layers */}
          {filteredLayers.map((layer) => {
            const id = `layer::${layer.layer_id}`;
            const isSelected = id === selectedEntityId;
            return (
              <li
                key={id}
                onClick={() => setSelectedEntityId(id)}
                className={[
                  "flex items-center gap-2 px-3 py-1 cursor-pointer select-none text-xs transition-colors",
                  isSelected
                    ? "bg-[#313244] text-[#cdd6f4]"
                    : "text-[#a6adc8] hover:bg-[#24243a] hover:text-[#cdd6f4]",
                ].join(" ")}
              >
                <span className="text-[#7f849c]">{TYPE_ICON.layer}</span>
                <span>{layer.layer_id}</span>
                <span className="ml-auto text-[#45475a]">layer</span>
              </li>
            );
          })}

          {/* Entities (grouped by type) */}
          {entityGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.type);
            return (
              <li key={`group::${group.type}`}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.type)}
                  className="flex w-full items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#585b70] transition-colors hover:text-[#a6adc8]"
                >
                  <span className="text-[8px]">{isCollapsed ? "▸" : "▾"}</span>
                  <span>{TYPE_ICON[group.type] ?? "○"}</span>
                  <span>{GROUP_LABELS[group.type] ?? group.type}</span>
                  <span className="ml-auto font-mono text-[#45475a]">{group.entities.length}</span>
                </button>
                {!isCollapsed && (
                  <ul>
                    {group.entities.map((entity) => {
                      const isSelected = entity.entity_id === selectedEntityId;
                      const type = getWorkspaceEntityRole(entity);
                      const isFocusEntity = entity.entity_id === sceneContext.focusEntityId;
                      const importedContext = resolveImportedEntityContext(entity);
                      const importedKindChip = importedEntityKindChip(type, importedContext.roleLabel);
                      return (
                        <li
                          key={entity.entity_id}
                          onClick={() => setSelectedEntityId(entity.entity_id)}
                          onDoubleClick={() => openEntityAuthoringSurface(entity as Entity)}
                          className={[
                            "flex items-center gap-2 pl-6 pr-3 py-1 cursor-pointer select-none text-xs transition-colors",
                            isSelected
                              ? "bg-[#313244] text-[#cdd6f4]"
                              : isFocusEntity
                                ? "bg-[#89b4fa]/8 text-[#dbeafe] hover:bg-[#89b4fa]/12"
                                : "text-[#a6adc8] hover:bg-[#24243a] hover:text-[#cdd6f4]",
                          ].join(" ")}
                        >
                          <span className="text-[#7f849c]">{TYPE_ICON[type] ?? "○"}</span>
                          <span title={entity.prefab ? `Prefab: ${entity.prefab}` : entity.entity_id}>
                            {getEntityDisplayName(entity)}
                          </span>
                          {importedContext.roleLabel ? (
                            <span
                              data-testid={`hierarchy-imported-role-${entity.entity_id}`}
                              className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] ${importedRoleBadgeClass(importedContext.roleLabel)}`}
                              title={importedContext.detail ?? importedContext.summary ?? undefined}
                            >
                              {importedContext.roleLabel}
                            </span>
                          ) : null}
                          {importedContext.confidenceLabel ? (
                            <span
                              className="rounded-full border border-[#313244] bg-[#11111b] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#94a3b8]"
                              title={importedContext.reason ?? undefined}
                            >
                              {importedContext.confidenceLabel}
                            </span>
                          ) : null}
                          {importedKindChip ? (
                            <span className="rounded-full border border-[#313244] bg-[#11111b] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#cdd6f4]">
                              {importedKindChip}
                            </span>
                          ) : null}
                          {importedContext.positionLabel ? (
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] ${
                                importedContext.positionMode === "donor"
                                  ? "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]"
                                  : importedContext.positionMode === "staging"
                                    ? "border-[#fab387]/35 bg-[#fab387]/10 text-[#fab387]"
                                    : "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]"
                              }`}
                              title={importedContext.positionDetail ?? undefined}
                            >
                              {importedContext.positionMode === "donor"
                                ? "Pos real"
                                : importedContext.positionMode === "staging"
                                  ? "Staging"
                                  : "Pos inferida"}
                            </span>
                          ) : null}
                          {isFocusEntity ? (
                            <span className="rounded-full border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
                              Entrada
                            </span>
                          ) : null}
                          {type === "tilemap" && (() => {
                            const info = tilemapPaintInfo(entity);
                            if (!info || info.total === 0) return null;
                            return (
                              <div className="ml-auto flex items-center gap-1">
                                {importedContext.auditFlags.length > 0 ? (
                                  <span
                                    className="rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]"
                                    title={`Audit flags: ${importedContext.auditFlags.join(", ")}`}
                                  >
                                    {importedContext.auditFlags.length} flags
                                  </span>
                                ) : null}
                                {info.filled === 0 ? (
                                  <span
                                    className="rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#fab387]"
                                    title="Tilemap em fallback visual ate materializar cells[]"
                                  >
                                    fallback
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded px-1 py-0.5 font-mono text-[9px] ${
                                    info.filled > 0
                                      ? "bg-[#a6e3a1]/10 text-[#a6e3a1]"
                                      : "text-[#45475a]"
                                  }`}
                                  title={`${info.filled}/${info.total} células pintadas`}
                                >
                                  {info.filled}/{info.total}
                                </span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedEntityId(entity.entity_id);
                                    setActiveWorkspace("scene");
                                    setActiveViewportTab("scene");
                                    setActiveTilemapId(entity.entity_id);
                                    setEditorMode("paint");
                                    const full = entities.find((e) => e.entity_id === entity.entity_id) as
                                      | Entity
                                      | undefined;
                                    const brush = full ? buildTilemapAuthoringBrush(full) : null;
                                    if (brush) {
                                      setActiveBrush(brush);
                                    }
                                    logMessage(
                                      "info",
                                      `[Hierarchy] Tilemap '${getEntityDisplayName(entity)}' focado para pintura (brush tile #${brush?.tileIndex ?? 1}). Paleta: Tools > Paleta Contextual.`
                                    );
                                  }}
                                  className="rounded border border-[#94e2d5]/35 bg-[#94e2d5]/10 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20"
                                  title="Editar tilemap no viewport"
                                >
                                  Editar
                                </button>
                              </div>
                            );
                          })()}
                          {type !== "tilemap" && <span className="ml-auto text-[#45475a]">{type}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}

          {filterText && filteredItemCount === 0 && (entities.length > 0 || bgLayers.length > 0) && (
            <li className="px-3 py-4 text-[11px] italic text-[#6c7086]">
              Nenhum item corresponde a &quot;{filterText}&quot; na cena ativa.
            </li>
          )}

          {entities.length === 0 && bgLayers.length === 0 && activeProjectDir && (
            <li className="px-3 pt-4">
              <div className="flex flex-col gap-2">
                <p className="text-xs italic text-[#45475a]">
                  {sceneContext.isImportedProject
                    ? "Cena importada sem alvo visual claro. Crie um sprite inicial ou use o Asset Browser para continuar a autoria."
                    : sceneContext.isLegacyOverlayProject
                      ? "Overlay SGDK aberto sem entidade visual. Crie um sprite inicial ou use o Asset Browser para ancorar a cena no editor."
                      : "Cena vazia. Crie um sprite inicial ou adicione uma entidade manualmente."}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAddStarterSprite()}
                    disabled={isAdding || isDeleting}
                    className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isAdding ? "Criando..." : "Sprite Inicial"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewName("Entity");
                      setShowAddDialog(true);
                    }}
                    disabled={isAdding || isDeleting}
                    className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#cba6f7] hover:text-[#cba6f7] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Nova Entidade
                  </button>
                </div>
              </div>
            </li>
          )}

          {entities.length === 0 && bgLayers.length === 0 && !activeProjectDir && (
            <li className="px-3 py-4 text-xs text-[#45475a] italic">
              {activeProjectDir
                ? "Nenhuma entidade na cena."
                : "Abra um projeto (Arquivo → Abrir Projeto)."}
            </li>
          )}

          {(entities.length > 0 || bgLayers.length > 0) &&
            filteredEntities.length === 0 &&
            filteredLayers.length === 0 && (
              <li className="px-3 py-4 text-xs text-[#45475a] italic text-center">
                Nenhum item encontrado.
              </li>
            )}
        </ul>
      </Panel>
    </>
  );
}
