import type { EditorWorkspace } from "./store/editorStore";

/**
 * Surface Registry (fatia 1 v2 do estudo de UI, docs/ESTUDO_UI_PRODUTO_NAO_CANONICO.md).
 *
 * Fonte unica das superficies de workspace visiveis no shell:
 * - `minPersona` controla revelacao progressiva (escada Guiado -> Criador -> Pro -> Hacker);
 * - `maturity` espelha o vocabulario controlado da matriz de docs/03_ROADMAP_MVP.md;
 * - `roadmapRef` e o rotulo exato da linha correspondente na matriz do roadmap
 *   (o teste de enforcement verifica que a linha existe no documento).
 *
 * Nenhuma superficie visivel deve entrar no rail sem entrada aqui.
 */
export type ShellPersona = "guiado" | "criador" | "pro" | "hacker";

export type SurfaceDomain = "core" | "authoring" | "advanced";

/** Vocabulario controlado: `hardening` = Em hardening; `experimental` = Experimental. */
export type SurfaceMaturity = "hardening" | "experimental";

export type WorkspaceSurface = {
  id: EditorWorkspace;
  label: string;
  icon: string;
  description: string;
  domain: SurfaceDomain;
  minPersona: ShellPersona;
  maturity: SurfaceMaturity;
  /** Capacidade de backend da qual a superficie depende. */
  capability: string;
  /** Rotulo da linha correspondente na matriz de docs/03_ROADMAP_MVP.md. */
  roadmapRef: string;
};

export const SHELL_PERSONAS: readonly ShellPersona[] = [
  "guiado",
  "criador",
  "pro",
  "hacker",
];

/**
 * Default `pro`: revela exatamente as superficies visiveis antes da introducao
 * de personas (zero regressao para usuarios existentes).
 */
export const DEFAULT_SHELL_PERSONA: ShellPersona = "pro";

const PERSONA_STORAGE_KEY = "retrodev-shell-persona";

const WORKSPACE_SURFACES: Record<EditorWorkspace, Omit<WorkspaceSurface, "id">> = {
  scene: {
    label: "Scene",
    icon: "SC",
    description: "Composicao e edicao da cena",
    domain: "core",
    minPersona: "guiado",
    maturity: "hardening",
    capability: "scene_authoring",
    roadmapRef: "Scene workspace",
  },
  game: {
    label: "Game",
    icon: "GM",
    description: "Playtest e runtime",
    domain: "core",
    minPersona: "guiado",
    maturity: "hardening",
    capability: "build_rom_emulation",
    roadmapRef: "Game workspace",
  },
  explorer: {
    label: "Explorer",
    icon: "EX",
    description: "Arquivos, assets e cenas",
    domain: "core",
    minPersona: "guiado",
    maturity: "hardening",
    capability: "project_files",
    roadmapRef: "Explorer workspace",
  },
  logic: {
    label: "Logic",
    icon: "LG",
    description: "Fluxo visual e scripting",
    domain: "authoring",
    minPersona: "criador",
    maturity: "hardening",
    capability: "nodegraph_logic",
    roadmapRef: "Logic workspace / NodeGraph canonico",
  },
  artstudio: {
    label: "Art",
    icon: "AT",
    description: "Sprites, slicing e preview",
    domain: "authoring",
    minPersona: "criador",
    maturity: "experimental",
    capability: "art_pipeline",
    roadmapRef: "ArtStudio workspace",
  },
  retrofx: {
    label: "FX",
    icon: "FX",
    description: "Profundidade e parallax",
    domain: "authoring",
    minPersona: "pro",
    maturity: "experimental",
    capability: "retrofx_pipeline",
    roadmapRef: "RetroFX workspace",
  },
  debug: {
    label: "Debug",
    icon: "DB",
    description: "Analise e ferramentas avancadas",
    domain: "advanced",
    minPersona: "pro",
    maturity: "hardening",
    capability: "debug_tools",
    roadmapRef: "Debug workspace",
  },
};

/** Ordem canonica do rail (identica a ordem visual anterior a esta derivacao). */
export const WORKSPACE_SURFACE_ORDER: readonly EditorWorkspace[] = [
  "scene",
  "game",
  "explorer",
  "logic",
  "artstudio",
  "retrofx",
  "debug",
];

export const SURFACE_REGISTRY: readonly WorkspaceSurface[] = WORKSPACE_SURFACE_ORDER.map(
  (id) => ({ id, ...WORKSPACE_SURFACES[id] })
);

export function getWorkspaceSurface(id: EditorWorkspace): WorkspaceSurface {
  return { id, ...WORKSPACE_SURFACES[id] };
}

/** Superficie `experimental` sempre carrega o rotulo visivel `Exp.`. */
export function getSurfaceBadge(
  surface: Pick<WorkspaceSurface, "maturity">
): string | undefined {
  return surface.maturity === "experimental" ? "Exp." : undefined;
}

export function isSurfaceVisibleForPersona(
  surface: Pick<WorkspaceSurface, "minPersona">,
  persona: ShellPersona
): boolean {
  return SHELL_PERSONAS.indexOf(persona) >= SHELL_PERSONAS.indexOf(surface.minPersona);
}

export function getShellPersonaLabel(persona: ShellPersona): string {
  switch (persona) {
    case "guiado":
      return "Guiado";
    case "criador":
      return "Criador";
    case "pro":
      return "Pro";
    case "hacker":
      return "Hacker";
  }
}

export function normalizeShellPersona(value: string | null | undefined): ShellPersona {
  return SHELL_PERSONAS.includes(value as ShellPersona)
    ? (value as ShellPersona)
    : DEFAULT_SHELL_PERSONA;
}

export function loadShellPersona(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage
): ShellPersona {
  try {
    return normalizeShellPersona(storage?.getItem(PERSONA_STORAGE_KEY));
  } catch {
    return DEFAULT_SHELL_PERSONA;
  }
}

export function saveShellPersona(
  persona: ShellPersona,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage
): void {
  try {
    storage?.setItem(PERSONA_STORAGE_KEY, persona);
  } catch {
    // storage indisponivel: persona segue apenas em memoria nesta sessao
  }
}
