import type { ImportedLogicSemantics } from "./ipc/sceneService";

export type ImportedEntityTone = "primary" | "accent" | "support" | "neutral";

export type ImportedEntityContext = {
  isImported: boolean;
  entityRole: string | null;
  roleLabel: string | null;
  gameplayClass: string | null;
  gameplayLabel: string | null;
  confidence: string | null;
  confidenceLabel: string | null;
  badgeLabel: string | null;
  tone: ImportedEntityTone;
  summary: string | null;
  detail: string | null;
  driverFunctions: string[];
  sourcePaths: string[];
  auditFlags: string[];
  reason: string | null;
  focusPriority: number;
  positionMode: "donor" | "inferred" | "staging" | null;
  positionLabel: string | null;
  positionDetail: string | null;
};

type ImportedEntityLike = {
  components?: unknown;
};

function trimOrNull(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeList(values: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
    )
  );
}

export function getImportedEntityRoleLabel(entityRole: string | null | undefined): string | null {
  switch (trimOrNull(entityRole)) {
    case "player_avatar":
      return "Jogador";
    case "enemy_actor":
      return "Inimigo";
    case "projectile_actor":
      return "Projetil";
    case "support_actor":
      return "Apoio";
    case "fighter_actor":
      return "Lutador";
    case "hud_actor":
      return "HUD / UI";
    case "generic_imported_sprite":
      return "Importado";
    default:
      return null;
  }
}

export function getImportedGameplayClassLabel(gameplayClass: string | null | undefined): string | null {
  switch (trimOrNull(gameplayClass)) {
    case "hybrid_action_scroll_signals":
      return "Hibrido acao/scroll";
    case "run_and_gun_horizontal_signals":
      return "Run-and-gun";
    case "shmup_vertical_signals":
      return "Shmup";
    case "platformer_horizontal_scroller_signals":
      return "Platformer";
    case "beat_em_up_close_range_signals":
      return "Beat 'em up";
    default:
      return null;
  }
}

export function getImportedConfidenceLabel(confidence: string | null | undefined): string | null {
  switch (trimOrNull(confidence)) {
    case "high":
      return "Alta confianca";
    case "medium":
      return "Confianca moderada";
    case "low":
      return "Hipotese inicial";
    default:
      return null;
  }
}

export function getImportedLogicSemantics(
  entity: ImportedEntityLike | null | undefined
): ImportedLogicSemantics | null {
  const components =
    entity?.components && typeof entity.components === "object"
      ? (entity.components as Record<string, unknown>)
      : null;
  const logic = components && "logic" in components
    ? (components.logic as { imported_semantics?: ImportedLogicSemantics | null } | null | undefined)
    : null;
  return logic?.imported_semantics ?? null;
}

function resolveImportedTone(entityRole: string | null): ImportedEntityTone {
  switch (entityRole) {
    case "player_avatar":
      return "primary";
    case "enemy_actor":
    case "fighter_actor":
    case "projectile_actor":
      return "accent";
    case "support_actor":
    case "hud_actor":
      return "support";
    default:
      return "neutral";
  }
}

function resolveImportedFocusPriority(
  entityRole: string | null,
  confidence: string | null,
  gameplayClass: string | null,
  positionMode: ImportedEntityContext["positionMode"]
): number {
  let priority = 0;
  switch (entityRole) {
    case "player_avatar":
      priority += 120;
      break;
    case "fighter_actor":
      priority += 95;
      break;
    case "enemy_actor":
      priority += 85;
      break;
    case "support_actor":
      priority += 70;
      break;
    case "projectile_actor":
      priority += 60;
      break;
    case "hud_actor":
      priority += 55;
      break;
    case "generic_imported_sprite":
      priority += 40;
      break;
    default:
      priority += 20;
      break;
  }

  switch (confidence) {
    case "high":
      priority += 20;
      break;
    case "medium":
      priority += 10;
      break;
    case "low":
      priority += 0;
      break;
    default:
      priority += 5;
      break;
  }

  if (gameplayClass === "beat_em_up_close_range_signals" && entityRole === "fighter_actor") {
    priority += 10;
  }

  if (positionMode === "donor") {
    priority += 6;
  } else if (positionMode === "staging") {
    priority += 2;
  }

  return priority;
}

function resolveImportedPositionContext(auditFlags: string[]): {
  mode: ImportedEntityContext["positionMode"];
  label: string | null;
  detail: string | null;
} {
  if (auditFlags.includes("position:staging_layout")) {
    return {
      mode: "staging",
      label: "Staging de autoria",
      detail:
        "Esta posicao foi distribuida para edicao porque o doador nao ofereceu coordenadas confiaveis para abrir a cena de forma operacional.",
    };
  }

  if (auditFlags.includes("position:donor_trusted")) {
    return {
      mode: "donor",
      label: "Posicao do doador",
      detail: "A cena preserva a posicao materializada a partir do donor original.",
    };
  }

  if (auditFlags.includes("position:inferred")) {
    return {
      mode: "inferred",
      label: "Posicao inferida",
      detail: "A posicao foi inferida por sinais rastreaveis e ainda pode precisar de ajuste manual.",
    };
  }

  return {
    mode: null,
    label: null,
    detail: null,
  };
}

export function resolveImportedEntityContext(
  entity: ImportedEntityLike | null | undefined
): ImportedEntityContext {
  const semantics = getImportedLogicSemantics(entity);
  const entityRole = trimOrNull(semantics?.entity_role);
  const gameplayClass = trimOrNull(semantics?.gameplay_class);
  const confidence = trimOrNull(semantics?.confidence);
  const roleLabel = getImportedEntityRoleLabel(entityRole);
  const gameplayLabel = getImportedGameplayClassLabel(gameplayClass);
  const confidenceLabel = getImportedConfidenceLabel(confidence);
  const driverFunctions = normalizeList(semantics?.driver_functions);
  const sourcePaths = normalizeList(semantics?.source_paths);
  const auditFlags = normalizeList(semantics?.audit_flags);
  const reason = trimOrNull(semantics?.role_reason);
  const positionContext = resolveImportedPositionContext(auditFlags);
  const isImported = Boolean(semantics && (entityRole || gameplayClass || confidence || driverFunctions.length > 0));

  if (!isImported) {
    return {
      isImported: false,
      entityRole: null,
      roleLabel: null,
      gameplayClass: null,
      gameplayLabel: null,
      confidence: null,
      confidenceLabel: null,
      badgeLabel: null,
      tone: "neutral",
      summary: null,
      detail: null,
      driverFunctions: [],
      sourcePaths: [],
      auditFlags: [],
      reason: null,
      focusPriority: 0,
      positionMode: null,
      positionLabel: null,
      positionDetail: null,
    };
  }

  const headline = roleLabel ? `${roleLabel} importado` : "Entidade importada";
  const summary = [headline, gameplayLabel, confidenceLabel, positionContext.label].filter(Boolean).join(" · ");
  const detailParts = [reason];
  if (positionContext.detail) {
    detailParts.push(positionContext.detail);
  }
  if (driverFunctions.length > 0) {
    detailParts.push(`Funcoes-chave: ${driverFunctions.join(", ")}`);
  }
  if (sourcePaths.length > 0) {
    detailParts.push(`Fontes: ${sourcePaths.join(", ")}`);
  }
  if (auditFlags.length > 0) {
    detailParts.push(`Sinais: ${auditFlags.join(", ")}`);
  }

  return {
    isImported: true,
    entityRole,
    roleLabel,
    gameplayClass,
    gameplayLabel,
    confidence,
    confidenceLabel,
    badgeLabel: roleLabel ?? gameplayLabel ?? "Importado",
    tone: resolveImportedTone(entityRole),
    summary,
    detail: detailParts.filter(Boolean).join(" "),
    driverFunctions,
    sourcePaths,
    auditFlags,
    reason,
    focusPriority: resolveImportedFocusPriority(entityRole, confidence, gameplayClass, positionContext.mode),
    positionMode: positionContext.mode,
    positionLabel: positionContext.label,
    positionDetail: positionContext.detail,
  };
}
