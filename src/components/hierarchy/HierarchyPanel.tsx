import { useEffect, useMemo, useState } from "react";
import Panel from "../common/Panel";
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
  entities: Array<{ entity_id: string; display_name?: string | null; prefab?: string | null; components?: { sprite?: unknown; collision?: unknown; tilemap?: unknown; camera?: unknown; audio?: unknown } }>;
}

function entityType(entity: { components?: { sprite?: unknown; collision?: unknown; tilemap?: unknown; camera?: unknown; audio?: unknown } }): string {
  if (entity.components?.camera) return "camera";
  if (entity.components?.tilemap) return "tilemap";
  if (entity.components?.sprite) return "sprite";
  if (entity.components?.audio && !entity.components?.sprite) return "audio";
  return "object";
}

export default function HierarchyPanel() {
  const {
    selectedEntityId, setSelectedEntityId,
    activeProjectDir,
    activeTarget,
    activeScenePath,
    activeScene, setActiveScene,
    setActiveScenePath,
    addEntity, removeEntity,
    logMessage,
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

  const entityGroups: EntityGroup[] = useMemo(() => {
    const grouped = new Map<string, EntityGroup>();
    for (const type of GROUP_ORDER) {
      grouped.set(type, { type, entities: [] });
    }
    for (const entity of filteredEntities) {
      const type = entityType(entity);
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
                      const type = entityType(entity);
                      return (
                        <li
                          key={entity.entity_id}
                          onClick={() => setSelectedEntityId(entity.entity_id)}
                          className={[
                            "flex items-center gap-2 pl-6 pr-3 py-1 cursor-pointer select-none text-xs transition-colors",
                            isSelected
                              ? "bg-[#313244] text-[#cdd6f4]"
                              : "text-[#a6adc8] hover:bg-[#24243a] hover:text-[#cdd6f4]",
                          ].join(" ")}
                        >
                          <span className="text-[#7f849c]">{TYPE_ICON[type] ?? "○"}</span>
                          <span title={entity.prefab ? `Prefab: ${entity.prefab}` : entity.entity_id}>
                            {getEntityDisplayName(entity)}
                          </span>
                          <span className="ml-auto text-[#45475a]">{type}</span>
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
                  Cena vazia. Crie um sprite inicial ou adicione uma entidade manualmente.
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
