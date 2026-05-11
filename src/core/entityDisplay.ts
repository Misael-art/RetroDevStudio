import type { Entity } from "./ipc/sceneService";

type EntityLabelLike = Pick<Entity, "entity_id" | "display_name" | "prefab">;

function trimToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function prefabReferenceLabel(prefab?: string | null): string | null {
  const normalized = trimToNull(prefab)?.replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }

  const baseName = normalized.replace(/^.*\//, "").replace(/\.json$/i, "");
  return baseName || normalized;
}

export function getEntityDisplayName(entity: EntityLabelLike): string {
  return (
    trimToNull(entity.display_name) ??
    prefabReferenceLabel(entity.prefab) ??
    trimToNull(entity.entity_id) ??
    "entity"
  );
}
