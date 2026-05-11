import type { Entity } from "./ipc/sceneService";
import type { ProjectAssetEntry } from "./ipc/toolsService";

/** Normaliza caminho relativo de asset para comparação estável (Windows/Linux). */
export function normalizeAssetRelativePath(relativePath: string): string {
  return String(relativePath).replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function pathSuggestsTilemapOrTilesetByLayout(normalizedLower: string): boolean {
  return (
    normalizedLower.includes("/tilesets/") ||
    normalizedLower.includes("/tilemaps/") ||
    normalizedLower.includes("/maps/") ||
    normalizedLower.includes("res/maps/") ||
    normalizedLower.includes("_tilemap") ||
    normalizedLower.includes("_tileset")
  );
}

function isSgdkLikeProjectSource(projectSourceKind: string): boolean {
  const k = projectSourceKind.trim().toLowerCase();
  return k === "imported_sgdk" || k === "external_sgdk" || k === "sgdk_overlay";
}

export type ImageAssetInstantiationKind = "tilemap" | "sprite";

export type ImageAssetInstantiationClassification = {
  kind: ImageAssetInstantiationKind;
  /** Origem da decisão (para logs e auditoria; não é heurística “mágica” silenciosa). */
  reason: string;
  /** Resumo curto para UI/Inspector/Asset Browser. */
  title: string;
  /** Explicação em linguagem de produto; o `reason` continua sendo a trilha auditável. */
  detail: string;
  /** Tipo de entidade que será criada. */
  entityLabel: "Sprite" | "Tilemap";
  /** Próximo passo sugerido logo após a instanciação. */
  nextStep: string;
};

function describeInstantiationDecision(
  kind: ImageAssetInstantiationKind,
  reason: string
): Omit<ImageAssetInstantiationClassification, "kind" | "reason"> {
  if (kind === "tilemap") {
    switch (reason) {
      case "cena-referencia-tileset":
        return {
          title: "Instanciar como tilemap",
          detail: "Este asset ja aparece na cena como tileset, entao manter tilemap evita leituras diferentes entre browser, viewport e inspector.",
          entityLabel: "Tilemap",
          nextStep: "Depois de instanciar, use o viewport para pintar/importar cells[] quando quiser sair do fallback legado.",
        };
      case "sgdk-layout-canónico-pastas":
        return {
          title: "Instanciar como tilemap",
          detail: "O layout canonico do importado SGDK indica tileset/tilemap; por isso a instancia coerente aqui continua sendo um tilemap.",
          entityLabel: "Tilemap",
          nextStep: "Revise o tileset no Inspector e materialize cells[] no viewport se precisar edicao fina por celula.",
        };
      default:
        return {
          title: "Instanciar como tilemap",
          detail: "O caminho deste asset sugere mapa ou tileset, entao a instancia mais previsivel no editor e um tilemap.",
          entityLabel: "Tilemap",
          nextStep: "Depois de instanciar, confirme o tileset no Inspector e ajuste cells[] no viewport quando necessario.",
        };
    }
  }

  switch (reason) {
    case "cena-referencia-sprite":
      return {
        title: "Instanciar como sprite",
        detail: "Este asset ja e usado como sprite na cena ativa, entao a nova instancia segue o mesmo tipo para manter a autoria coerente.",
        entityLabel: "Sprite",
        nextStep: "Depois de instanciar, ajuste frame, palette e logica no Inspector conforme o target ativo.",
      };
    case "nao-imagem: apenas sprites aceitam kind!=image no fluxo atual":
      return {
        title: "Instanciar como sprite",
        detail: "O fluxo atual so suporta assets nao-imagem como sprite, por isso nao ha ambiguidade nesta escolha.",
        entityLabel: "Sprite",
        nextStep: "Revise a entidade no Inspector antes de continuar a montagem da cena.",
      };
    default:
      return {
        title: "Instanciar como sprite",
        detail: "Sem sinais de tilemap no caminho nem referencias existentes na cena, este asset entra como sprite por padrao explicito.",
        entityLabel: "Sprite",
        nextStep: "Depois de instanciar, use o Inspector para ajustar quadro, palette e comportamento inicial.",
      };
  }
}

/**
 * Classifica se um asset de imagem do browser deve instanciar `components.tilemap` ou `components.sprite`.
 *
 * Ordem:
 * 1. Cena já referencia o path como `tilemap.tileset` → tilemap.
 * 2. Cena já referencia como `sprite.asset` → sprite.
 * 3. Projeto SGDK-like + layout canónico (tilesets, tilemaps, maps) → tilemap.
 * 4. Layout canónico (qualquer projeto) → tilemap.
 * 5. Caso contrário → sprite.
 */
export function classifyImageAssetInstantiation(options: {
  asset: Pick<ProjectAssetEntry, "kind" | "relative_path">;
  projectSourceKind: string;
  sceneEntities: Pick<Entity, "entity_id" | "components">[];
}): ImageAssetInstantiationClassification {
  const { asset, projectSourceKind, sceneEntities } = options;
  if (asset.kind !== "image") {
    const reason = "nao-imagem: apenas sprites aceitam kind!=image no fluxo atual";
    return {
      kind: "sprite",
      reason,
      ...describeInstantiationDecision("sprite", reason),
    };
  }

  const normalized = normalizeAssetRelativePath(asset.relative_path);

  const usedAsTileset = sceneEntities.some((e) => {
    const ts = e.components?.tilemap?.tileset?.trim();
    return ts && normalizeAssetRelativePath(ts) === normalized;
  });
  if (usedAsTileset) {
    const reason = "cena-referencia-tileset";
    return { kind: "tilemap", reason, ...describeInstantiationDecision("tilemap", reason) };
  }

  const usedAsSprite = sceneEntities.some((e) => {
    const sp = e.components?.sprite?.asset?.trim();
    return sp && normalizeAssetRelativePath(sp) === normalized;
  });
  if (usedAsSprite) {
    const reason = "cena-referencia-sprite";
    return { kind: "sprite", reason, ...describeInstantiationDecision("sprite", reason) };
  }

  const lower = normalized.toLowerCase();
  if (isSgdkLikeProjectSource(projectSourceKind) && pathSuggestsTilemapOrTilesetByLayout(lower)) {
    const reason = "sgdk-layout-canónico-pastas";
    return { kind: "tilemap", reason, ...describeInstantiationDecision("tilemap", reason) };
  }

  if (pathSuggestsTilemapOrTilesetByLayout(lower)) {
    const reason = "layout-pastas-maps-tilesets";
    return { kind: "tilemap", reason, ...describeInstantiationDecision("tilemap", reason) };
  }

  const reason = "padrao-sprite-sem-sinais-de-tilemap";
  return { kind: "sprite", reason, ...describeInstantiationDecision("sprite", reason) };
}

export function shouldInstantiateImageAsTilemapEntity(options: {
  asset: Pick<ProjectAssetEntry, "kind" | "relative_path">;
  projectSourceKind: string;
  sceneEntities: Pick<Entity, "entity_id" | "components">[];
}): boolean {
  return classifyImageAssetInstantiation(options).kind === "tilemap";
}
