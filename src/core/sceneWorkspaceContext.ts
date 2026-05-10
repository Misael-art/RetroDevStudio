import { getEntityDisplayName } from "./entityDisplay";
import { hasCanonicalTilemapCells } from "./assetVisualState";
import { resolveImportedEntityContext } from "./importedEntityContext";
import type { Entity, LegacySgdkIndex, Scene } from "./ipc/sceneService";

export type WorkspaceEntityRole = "sprite" | "tilemap" | "camera" | "audio" | "object";
export type SceneWorkspaceTone = "info" | "warn" | "success";

export type SceneWorkspaceContext = {
  eyebrow: string;
  title: string;
  summary: string;
  detail: string;
  checkpoints: string[];
  tone: SceneWorkspaceTone;
  sourceBadgeLabel: string;
  activeSceneLabel: string;
  activeScenePath: string | null;
  focusEntityId: string | null;
  focusEntityLabel: string | null;
  focusEntityRole: WorkspaceEntityRole | null;
  hasAuthoringContent: boolean;
  isImportedProject: boolean;
  isLegacyOverlayProject: boolean;
  entityCount: number;
  backgroundCount: number;
  layerCount: number;
  spriteCount: number;
  tilemapCount: number;
};

function normalizeProjectSourceKind(projectSourceKind: string): string {
  return projectSourceKind.trim().toLowerCase();
}

export function isImportedProjectSource(projectSourceKind: string): boolean {
  return normalizeProjectSourceKind(projectSourceKind) === "imported_sgdk";
}

export function isLegacyOverlayProjectSource(
  projectSourceKind: string,
  projectLegacyIndex?: LegacySgdkIndex | null
): boolean {
  return normalizeProjectSourceKind(projectSourceKind) === "external_sgdk" && Boolean(projectLegacyIndex);
}

export function getWorkspaceEntityRole(
  entity: {
    components?: {
      sprite?: unknown;
      tilemap?: unknown;
      camera?: unknown;
      audio?: unknown;
    } | undefined;
  }
): WorkspaceEntityRole {
  if (entity.components?.camera) {
    return "camera";
  }
  if (entity.components?.tilemap) {
    return "tilemap";
  }
  if (entity.components?.sprite) {
    return "sprite";
  }
  if (entity.components?.audio && !entity.components?.sprite) {
    return "audio";
  }
  return "object";
}

export function getWorkspaceEntityRoleLabel(role: WorkspaceEntityRole): string {
  switch (role) {
    case "sprite":
      return "Sprite";
    case "tilemap":
      return "Tilemap";
    case "camera":
      return "Camera";
    case "audio":
      return "Audio";
    default:
      return "Objeto";
  }
}

export function getPreferredSceneEntity(scene: Scene | null | undefined): Entity | null {
  if (!scene) {
    return null;
  }

  const entities = [...scene.entities];
  entities.sort((a, b) => getSceneEntityFocusScore(b) - getSceneEntityFocusScore(a));
  return entities[0] ?? null;
}

function getSceneEntityFocusScore(entity: Entity): number {
  const importedContext = resolveImportedEntityContext(entity);
  let score = importedContext.focusPriority;

  if (entity.components?.sprite) {
    score += 80;
  } else if (entity.components?.tilemap) {
    score += 55;
    if (hasCanonicalTilemapCells(entity.components.tilemap)) {
      score += 5;
    }
  } else if (entity.components?.camera) {
    score += 20;
  } else if (entity.components?.audio) {
    score += 10;
  }

  return score;
}

export function resolveSceneWorkspaceContext(options: {
  scene: Scene | null | undefined;
  scenePath?: string | null;
  projectSourceKind: string;
  projectLegacyIndex?: LegacySgdkIndex | null;
}): SceneWorkspaceContext {
  const { scene, projectSourceKind, projectLegacyIndex } = options;
  const activeScenePath = String(options.scenePath ?? "").trim() || null;
  const activeSceneLabel =
    scene?.display_name?.trim() ||
    scene?.scene_id?.trim() ||
    activeScenePath ||
    "Sem cena ativa";
  const isImportedProject = isImportedProjectSource(projectSourceKind);
  const isLegacyOverlayProject = isLegacyOverlayProjectSource(projectSourceKind, projectLegacyIndex);
  const entityCount = scene?.entities.length ?? 0;
  const backgroundCount = scene?.background_layers.length ?? 0;
  const layerCount = scene?.layers?.length ?? 0;
  const spriteCount =
    scene?.entities.filter((entity) => getWorkspaceEntityRole(entity) === "sprite").length ?? 0;
  const tilemapCount =
    scene?.entities.filter((entity) => getWorkspaceEntityRole(entity) === "tilemap").length ?? 0;
  const hasAuthoringContent = Boolean(
    scene &&
      (entityCount > 0 ||
        backgroundCount > 0 ||
        (scene.layers?.some((layer) => layer.entity_ids.length > 0) ?? false))
  );
  const focusEntity = getPreferredSceneEntity(scene);
  const focusEntityRole = focusEntity ? getWorkspaceEntityRole(focusEntity) : null;
  const focusEntityLabel = focusEntity ? getEntityDisplayName(focusEntity) : null;
  const focusImportedContext = focusEntity ? resolveImportedEntityContext(focusEntity) : null;
  const focusRoleLabel =
    focusImportedContext?.roleLabel ?? (focusEntityRole ? getWorkspaceEntityRoleLabel(focusEntityRole) : null);
  const focusCheckpoint =
    focusEntity && focusRoleLabel
      ? `${focusRoleLabel} foco: ${focusEntityLabel}`
      : "Sem entidade foco";

  if (isLegacyOverlayProject) {
    return {
      eyebrow: "Overlay SGDK",
      title: hasAuthoringContent
        ? "Cena pronta para editar com contexto do host legado"
        : "Overlay SGDK aberto sem alvo visual inicial",
      summary: hasAuthoringContent
        ? `A cena '${activeSceneLabel}' ja abriu no formato nativo do editor, enquanto o host SGDK permanece apenas como referencia auditavel no Tools.`
        : `O overlay legado abriu a cena '${activeSceneLabel}', mas ainda nao ha alvo visual claro; o editor manteve o fluxo no workspace de cena para voce continuar sem console.`,
      detail: hasAuthoringContent
        ? "Hierarchy destaca a entidade principal, Inspector explica o estado visual atual e Asset Browser continua sendo o ponto de entrada para novas instancias."
        : "Use Hierarchy > Sprite Inicial ou Tools > Asset Browser para criar o primeiro sprite ou tilemap antes do playtest.",
      checkpoints: [
        "Host SGDK em overlay",
        `Entidades: ${entityCount}`,
        `Tilemaps: ${tilemapCount}`,
        focusCheckpoint,
      ],
      tone: hasAuthoringContent ? "warn" : "info",
      sourceBadgeLabel: "Overlay SGDK",
      activeSceneLabel,
      activeScenePath,
      focusEntityId: focusEntity?.entity_id ?? null,
      focusEntityLabel,
      focusEntityRole,
      hasAuthoringContent,
      isImportedProject,
      isLegacyOverlayProject,
      entityCount,
      backgroundCount,
      layerCount,
      spriteCount,
      tilemapCount,
    };
  }

  if (isImportedProject) {
    return {
      eyebrow: "Cena importada",
      title: hasAuthoringContent
        ? "Cena importada pronta para autoria"
        : "Cena importada aberta sem entidade visual pronta",
      summary: hasAuthoringContent
        ? `Voce ja esta na cena '${activeSceneLabel}'. Hierarchy, Inspector, viewport e Asset Browser estao alinhados para continuar a edicao sem descoberta por tentativa.`
        : `A cena '${activeSceneLabel}' foi aberta e o shell ja ficou na superficie certa, mas ainda falta um alvo visual claro para continuar a autoria.`,
      detail: hasAuthoringContent
        ? `Ponto de partida: ${focusCheckpoint.toLowerCase()}. Use o Asset Browser para ampliar a cena com o mesmo contrato de sprite/tilemap visto no Inspector e no viewport.`
        : "Use Asset Browser para instanciar sprite ou tilemap, ou crie um Sprite Inicial pela Hierarchy para sair do estado vazio com contexto.",
      checkpoints: [
        "Cena importada ativa",
        `Sprites: ${spriteCount}`,
        `Tilemaps: ${tilemapCount}`,
        focusCheckpoint,
      ],
      tone: hasAuthoringContent ? "success" : "info",
      sourceBadgeLabel: "Cena importada",
      activeSceneLabel,
      activeScenePath,
      focusEntityId: focusEntity?.entity_id ?? null,
      focusEntityLabel,
      focusEntityRole,
      hasAuthoringContent,
      isImportedProject,
      isLegacyOverlayProject,
      entityCount,
      backgroundCount,
      layerCount,
      spriteCount,
      tilemapCount,
    };
  }

  return {
    eyebrow: "Cena ativa",
    title: hasAuthoringContent ? "Cena pronta para editar" : "Cena pronta para comecar",
    summary: hasAuthoringContent
      ? `A cena '${activeSceneLabel}' ja tem contexto suficiente para editar no viewport, revisar na Hierarchy e detalhar no Inspector sem trocar de fluxo.`
      : `A cena '${activeSceneLabel}' ainda esta vazia; o editor manteve as acoes principais por perto para voce comecar sem ruido tecnico.`,
    detail: hasAuthoringContent
      ? "Abra o Asset Browser quando precisar instanciar novos recursos, use a Hierarchy para trocar de cena e o Inspector para refinar a selecao atual."
      : "Use Hierarchy > Sprite Inicial ou Tools > Asset Browser para adicionar o primeiro elemento editavel e seguir para o viewport.",
    checkpoints: [
      `Entidades: ${entityCount}`,
      `Fundos: ${backgroundCount}`,
      `Camadas: ${layerCount}`,
      focusCheckpoint,
    ],
    tone: hasAuthoringContent ? "info" : "success",
    sourceBadgeLabel: "Cena nativa",
    activeSceneLabel,
    activeScenePath,
    focusEntityId: focusEntity?.entity_id ?? null,
    focusEntityLabel,
    focusEntityRole,
    hasAuthoringContent,
    isImportedProject,
    isLegacyOverlayProject,
    entityCount,
    backgroundCount,
    layerCount,
    spriteCount,
    tilemapCount,
  };
}
