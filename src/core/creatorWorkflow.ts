import { getEntityDisplayName } from "./entityDisplay";
import {
  entityHasLogicWorkspace,
  resolveEntitySourceRefs,
} from "./entityAuthoring";
import type { Entity, Scene } from "./ipc/sceneService";
import {
  getSceneEntityBounds,
  resolveSceneWorldMetrics,
} from "./sceneWorldModel";

export type EntityFocusTreatment = "normal" | "preview" | "solo" | "muted";

export interface CreatorWorkflowContextInput {
  scene: Scene | null | undefined;
  target: "megadrive" | "snes";
  selectedEntityId: string | null | undefined;
  activeTilemapId: string | null | undefined;
  editorMode: "select" | "paint" | "erase" | "collision";
  activeBrushTileIndex: number | null | undefined;
  tilePaintTool: string | null | undefined;
  soloEntityId?: string | null;
}

export interface CreatorWorkflowContext {
  frameLabel: string;
  worldLabel: string;
  cameraLabel: string;
  editableRegionLabel: string;
  selectedLabel: string;
  selectedBoundsLabel: string;
  selectedRoleLabel: string;
  sourceCountLabel: string;
  tilemapTargetLabel: string;
  tileBrushLabel: string;
  soloLabel: string;
  primaryAction: "select" | "tilemap" | "logic" | "artstudio" | "source";
}

function targetLabel(target: "megadrive" | "snes"): string {
  return target === "snes" ? "SNES" : "Mega Drive";
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function entityRoleLabel(entity: Entity | null | undefined): string {
  const role = entity?.components.logic?.imported_semantics?.entity_role?.trim();
  return role || "sem papel importado";
}

function getPrimaryAction(entity: Entity | null | undefined): CreatorWorkflowContext["primaryAction"] {
  if (!entity) {
    return "select";
  }
  if (entity.components?.tilemap) {
    return "tilemap";
  }
  if (entityHasLogicWorkspace(entity)) {
    return "logic";
  }
  if (entity.components?.sprite) {
    return "artstudio";
  }
  return resolveEntitySourceRefs(entity).length > 0 ? "source" : "select";
}

export function buildCreatorWorkflowContext({
  scene,
  target,
  selectedEntityId,
  activeTilemapId,
  editorMode,
  activeBrushTileIndex,
  tilePaintTool,
  soloEntityId,
}: CreatorWorkflowContextInput): CreatorWorkflowContext {
  const metrics = resolveSceneWorldMetrics(scene, target);
  const selectedEntity =
    selectedEntityId && !selectedEntityId.startsWith("layer::")
      ? scene?.entities.find((entity) => entity.entity_id === selectedEntityId) ?? null
      : null;
  const selectedBounds = selectedEntity
    ? getSceneEntityBounds(selectedEntity, target, scene?.entities ?? [])
    : null;
  const tilemapEntity =
    activeTilemapId
      ? scene?.entities.find((entity) => entity.entity_id === activeTilemapId && entity.components?.tilemap) ?? null
      : selectedEntity?.components?.tilemap
        ? selectedEntity
        : null;
  const sourceCount = resolveEntitySourceRefs(selectedEntity).length;
  const soloEntity =
    soloEntityId
      ? scene?.entities.find((entity) => entity.entity_id === soloEntityId) ?? null
      : null;

  return {
    frameLabel: `Janela ${targetLabel(target)} ${metrics.frame.width}x${metrics.frame.height}`,
    worldLabel: `Mundo ${metrics.worldWidth}x${metrics.worldHeight} px`,
    cameraLabel: metrics.camera
      ? `${metrics.camera.label}${metrics.camera.followEntityId ? ` segue ${metrics.camera.followEntityId}` : ""}`
      : "Camera: centro do mundo",
    editableRegionLabel: metrics.largeWorld
      ? "Mundo maior que a janela: pan/zoom e minimapa sao parte do fluxo."
      : "Mundo cabe na janela visivel: edicao direta no stage.",
    selectedLabel: selectedEntity ? getEntityDisplayName(selectedEntity) : "Nenhuma entidade",
    selectedBoundsLabel: selectedBounds
      ? `${selectedBounds.x},${selectedBounds.y} · ${selectedBounds.width}x${selectedBounds.height}`
      : "sem alvo visual",
    selectedRoleLabel: entityRoleLabel(selectedEntity),
    sourceCountLabel: sourceCount > 0 ? pluralize(sourceCount, "fonte", "fontes") : "sem fonte rastreavel",
    tilemapTargetLabel: tilemapEntity ? getEntityDisplayName(tilemapEntity) : "sem tilemap ativo",
    tileBrushLabel:
      editorMode === "paint" && activeBrushTileIndex != null
        ? `${tilePaintTool || "brush"} · tile #${activeBrushTileIndex}`
        : "paint inativo",
    soloLabel: soloEntity ? `Solo: ${getEntityDisplayName(soloEntity)}` : "Solo desligado",
    primaryAction: getPrimaryAction(selectedEntity),
  };
}

export function resolveEntityFocusTreatment(
  entityId: string,
  {
    soloEntityId,
    densePreviewEntityId,
    denseSpotlight,
  }: {
    soloEntityId?: string | null;
    densePreviewEntityId?: string | null;
    denseSpotlight?: boolean;
  }
): EntityFocusTreatment {
  if (soloEntityId) {
    return entityId === soloEntityId ? "solo" : "muted";
  }
  if (denseSpotlight && densePreviewEntityId === entityId) {
    return "preview";
  }
  return "normal";
}
