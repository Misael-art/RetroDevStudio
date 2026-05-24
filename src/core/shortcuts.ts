export interface ShortcutCommand {
  id: string;
  group: string;
  label: string;
  keys: string[];
  scope?: string;
  description?: string;
  editable?: boolean;
  palette?: boolean;
  keywords?: string[];
}

export interface ShortcutGroup {
  group: string;
  shortcuts: ShortcutCommand[];
}

export interface ShortcutConflict {
  normalizedKey: string;
  displayKey: string;
  commandIds: string[];
  labels: string[];
  scopes: string[];
}

export interface ShortcutEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface CommandSearchResult {
  command: ShortcutCommand;
  score: number;
}

export interface ResolvedShortcutCommand {
  commandId: string | null;
  conflict: ShortcutConflict | null;
}

export const SHORTCUT_CUSTOMIZATIONS_STORAGE_KEY = "retrodev-shortcut-customizations-v1";

const MODIFIER_ORDER = ["ctrl", "alt", "shift"] as const;
const MODIFIER_ALIASES = new Map<string, (typeof MODIFIER_ORDER)[number]>([
  ["cmd", "ctrl"],
  ["command", "ctrl"],
  ["control", "ctrl"],
  ["ctrl", "ctrl"],
  ["meta", "ctrl"],
  ["option", "alt"],
  ["alt", "alt"],
  ["shift", "shift"],
]);

const DISPLAY_MODIFIERS: Record<(typeof MODIFIER_ORDER)[number], string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
};

export const DEFAULT_SHORTCUTS: ShortcutCommand[] = [
  {
    id: "project.new",
    group: "Projeto",
    label: "Novo projeto",
    keys: ["Ctrl+N"],
    scope: "shell",
    editable: true,
  },
  {
    id: "project.open",
    group: "Projeto",
    label: "Abrir workspace",
    keys: ["Ctrl+O"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["abrir projeto", "open project", "open workspace"],
  },
  {
    id: "scene.save",
    group: "Projeto",
    label: "Salvar cena",
    keys: ["Ctrl+S"],
    scope: "global",
    editable: true,
    palette: true,
  },
  {
    id: "build.run",
    group: "Build",
    label: "Build & Run",
    keys: ["Ctrl+B"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["build", "run", "emulacao", "rom"],
  },
  {
    id: "build.validate",
    group: "Build",
    label: "Validar projeto",
    keys: ["Ctrl+Shift+B"],
    scope: "global",
    editable: true,
    palette: true,
  },
  {
    id: "code.generate",
    group: "Build",
    label: "Gerar C",
    keys: ["Ctrl+Alt+C"],
    scope: "global",
    editable: true,
    palette: true,
  },
  {
    id: "entity.copy",
    group: "Edicao",
    label: "Copiar entidade",
    keys: ["Ctrl+C"],
    scope: "scene",
    editable: true,
  },
  {
    id: "entity.paste",
    group: "Edicao",
    label: "Colar entidade",
    keys: ["Ctrl+V"],
    scope: "scene",
    editable: true,
  },
  {
    id: "edit.undo",
    group: "Edicao",
    label: "Desfazer",
    keys: ["Ctrl+Z"],
    scope: "global",
    editable: true,
    palette: true,
  },
  {
    id: "edit.redo",
    group: "Edicao",
    label: "Refazer",
    keys: ["Ctrl+Shift+Z", "Ctrl+Y"],
    scope: "global",
    editable: true,
    palette: true,
  },
  {
    id: "entity.delete",
    group: "Edicao",
    label: "Remover selecao no editor ativo",
    keys: ["Delete"],
    scope: "scene",
    editable: true,
  },
  {
    id: "layout.focus",
    group: "Layout",
    label: "Maximizar/restaurar viewport",
    keys: ["Ctrl+Alt+F"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["focus", "foco", "layout"],
  },
  {
    id: "layout.save",
    group: "Layout",
    label: "Salvar layout",
    keys: ["Ctrl+Alt+S"],
    scope: "global",
    editable: true,
    palette: true,
  },
  {
    id: "layout.restore",
    group: "Layout",
    label: "Restaurar layout",
    keys: ["Ctrl+Alt+R"],
    scope: "global",
    editable: true,
    palette: true,
  },
  {
    id: "commandPalette.open",
    group: "Layout",
    label: "Abrir Command Palette",
    keys: ["Ctrl+P", "Ctrl+Shift+P"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["palette", "paleta", "command"],
  },
  {
    id: "shortcuts.edit",
    group: "Layout",
    label: "Abrir editor de atalhos",
    keys: ["Ctrl+/"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["atalhos", "shortcuts", "keybindings"],
  },
  {
    id: "workspace.scene",
    group: "Workspaces",
    label: "Ir para Scene",
    keys: ["Ctrl+Alt+1"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["scene", "cena", "viewport"],
  },
  {
    id: "workspace.logic",
    group: "Workspaces",
    label: "Ir para Logic",
    keys: ["Ctrl+Alt+2"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["logic", "nodegraph", "logica"],
  },
  {
    id: "workspace.artstudio",
    group: "Workspaces",
    label: "Ir para Art",
    keys: ["Ctrl+Alt+3"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["art", "artstudio", "sprite"],
  },
  {
    id: "tools.runtimeSetup",
    group: "Ferramentas",
    label: "Abrir Runtime Setup",
    keys: ["Ctrl+Alt+T"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["runtime", "setup", "toolchain", "dependencias"],
  },
  {
    id: "tools.assetBrowser",
    group: "Ferramentas",
    label: "Abrir Asset Browser",
    keys: ["Ctrl+Alt+A"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["asset", "browser", "assets"],
  },
  {
    id: "console.open",
    group: "Console",
    label: "Abrir Console",
    keys: ["Ctrl+`"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["console", "logs"],
  },
  {
    id: "viewport.grid",
    group: "Viewport",
    label: "Alternar grid",
    keys: ["G"],
    scope: "viewport",
  },
  {
    id: "viewport.resetZoom",
    group: "Viewport",
    label: "Resetar zoom",
    keys: ["0"],
    scope: "viewport",
  },
  {
    id: "viewport.tilePicker",
    group: "Viewport",
    label: "Alternar seletor de tiles",
    keys: ["T"],
    scope: "viewport",
  },
  {
    id: "nodegraph.delete",
    group: "NodeGraph",
    label: "Remover no selecionado",
    keys: ["Delete"],
    scope: "nodegraph",
  },
  {
    id: "nodegraph.chainLayout",
    group: "NodeGraph",
    label: "Encadear exec por layout",
    keys: ["Ctrl+Shift+L"],
    scope: "nodegraph",
  },
  {
    id: "emulator.inputA",
    group: "Emulador",
    label: "Botao A",
    keys: ["Z"],
    scope: "emulator",
  },
  {
    id: "emulator.inputB",
    group: "Emulador",
    label: "Botao B",
    keys: ["X"],
    scope: "emulator",
  },
  {
    id: "emulator.start",
    group: "Emulador",
    label: "Start",
    keys: ["Enter"],
    scope: "emulator",
  },
  {
    id: "emulator.dpad",
    group: "Emulador",
    label: "Direcional",
    keys: ["Setas"],
    scope: "emulator",
  },
  {
    id: "emulator.play",
    group: "Emulador",
    label: "Run / Playtest",
    keys: ["F5"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["run", "play", "emulador"],
  },
  {
    id: "emulator.stop",
    group: "Emulador",
    label: "Stop",
    keys: ["Shift+F5"],
    scope: "global",
    editable: true,
    palette: true,
    keywords: ["stop", "parar", "emulador"],
  },
];

function normalizeKeyToken(token: string): string {
  const compact = token.trim().toLowerCase();
  if (compact === "arrowup" || compact === "up") return "arrowup";
  if (compact === "arrowdown" || compact === "down") return "arrowdown";
  if (compact === "arrowleft" || compact === "left") return "arrowleft";
  if (compact === "arrowright" || compact === "right") return "arrowright";
  if (compact === "del") return "delete";
  if (compact === "esc") return "escape";
  if (compact === "spacebar") return "space";
  if (compact === "plus") return "+";
  return compact;
}

export function normalizeShortcutChord(chord: string): string {
  const parts = chord
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  let key = "";

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) {
      modifiers.add(modifier);
    } else {
      key = normalizeKeyToken(part);
    }
  }

  if (!key && parts.length > 0) {
    key = normalizeKeyToken(parts[parts.length - 1]);
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key]
    .filter(Boolean)
    .join("+");
}

export function formatNormalizedShortcutKey(normalizedKey: string): string {
  return normalizedKey
    .split("+")
    .filter(Boolean)
    .map((part) => {
      if (part === "ctrl" || part === "alt" || part === "shift") {
        return DISPLAY_MODIFIERS[part];
      }
      if (part === "/") return "/";
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}

export function formatShortcutKeys(keys: readonly string[]): string {
  return keys.join(" / ");
}

export function getShortcutById(
  commandId: string,
  shortcuts: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS
): ShortcutCommand | undefined {
  return shortcuts.find((shortcut) => shortcut.id === commandId);
}

export function getShortcutLabel(
  commandId: string,
  shortcuts: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS
): string | undefined {
  const shortcut = getShortcutById(commandId, shortcuts);
  return shortcut ? formatShortcutKeys(shortcut.keys) : undefined;
}

export function getShortcutTitle(
  commandId: string,
  baseTitle?: string,
  shortcuts: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS
): string | undefined {
  const shortcut = getShortcutLabel(commandId, shortcuts);
  if (!shortcut) {
    return baseTitle;
  }
  return baseTitle ? `${baseTitle} (Atalho: ${shortcut})` : `Atalho: ${shortcut}`;
}

export function groupShortcutsByGroup(
  shortcuts: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS
): ShortcutGroup[] {
  const groups: ShortcutGroup[] = [];
  const indexByGroup = new Map<string, number>();

  for (const shortcut of shortcuts) {
    const existingIndex = indexByGroup.get(shortcut.group);
    if (existingIndex === undefined) {
      indexByGroup.set(shortcut.group, groups.length);
      groups.push({ group: shortcut.group, shortcuts: [shortcut] });
    } else {
      groups[existingIndex].shortcuts.push(shortcut);
    }
  }

  return groups;
}

export function getPaletteCommands(
  shortcuts: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS
): ShortcutCommand[] {
  return shortcuts.filter((shortcut) => shortcut.palette);
}

export function findShortcutConflicts(
  shortcuts: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS
): ShortcutConflict[] {
  const byKey = new Map<
    string,
    {
      displayKey: string;
      commands: { id: string; label: string; scope: string }[];
    }
  >();

  for (const shortcut of shortcuts) {
    for (const key of shortcut.keys) {
      const normalizedKey = normalizeShortcutChord(key);
      if (!normalizedKey) {
        continue;
      }
      const entry = byKey.get(normalizedKey);
      const command = {
        id: shortcut.id,
        label: shortcut.label,
        scope: shortcut.scope ?? "global",
      };
      if (entry) {
        entry.commands.push(command);
      } else {
        byKey.set(normalizedKey, {
          displayKey: formatNormalizedShortcutKey(normalizedKey),
          commands: [command],
        });
      }
    }
  }

  return [...byKey.entries()]
    .map(([normalizedKey, entry]) => {
      const conflictedIndexes = new Set<number>();
      for (let left = 0; left < entry.commands.length; left += 1) {
        for (let right = left + 1; right < entry.commands.length; right += 1) {
          if (shortcutScopesOverlap(entry.commands[left].scope, entry.commands[right].scope)) {
            conflictedIndexes.add(left);
            conflictedIndexes.add(right);
          }
        }
      }

      const conflictedCommands = [...conflictedIndexes].map((index) => entry.commands[index]);
      return {
        normalizedKey,
        displayKey: entry.displayKey,
        commandIds: conflictedCommands.map((command) => command.id),
        labels: conflictedCommands.map((command) => command.label),
        scopes: conflictedCommands.map((command) => command.scope),
      };
    })
    .filter((conflict) => conflict.commandIds.length > 1);
}

function shortcutScopesOverlap(left: string, right: string): boolean {
  return left === right || left === "global" || right === "global" || left === "shell" || right === "shell";
}

export function normalizeShortcutEvent(event: ShortcutEventLike): string {
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  return [...modifiers, normalizeKeyToken(event.key)].filter(Boolean).join("+");
}

export function eventMatchesShortcut(
  event: ShortcutEventLike,
  commandId: string,
  shortcuts: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS
): boolean {
  const shortcut = getShortcutById(commandId, shortcuts);
  if (!shortcut) {
    return false;
  }
  const eventKey = normalizeShortcutEvent(event);
  return shortcut.keys.some((key) => normalizeShortcutChord(key) === eventKey);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/`+\s.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
}

function scoreToken(token: string, haystack: string): number {
  if (!token) return 0;
  if (haystack === token) return 100;
  if (haystack.startsWith(token)) return 80;
  if (haystack.includes(` ${token}`)) return 70;
  if (haystack.includes(token)) return 55;
  return isSubsequence(token, haystack) ? 25 : 0;
}

export function searchCommands(
  query: string,
  commands: readonly ShortcutCommand[] = getPaletteCommands(DEFAULT_SHORTCUTS)
): CommandSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return commands.map((command, index) => ({ command, score: 1000 - index }));
  }

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return commands
    .map((command, index) => {
      const haystack = normalizeSearchText(
        [
          command.label,
          command.group,
          command.description ?? "",
          formatShortcutKeys(command.keys),
          ...(command.keywords ?? []),
        ].join(" ")
      );
      const tokenScores = tokens.map((token) => scoreToken(token, haystack));
      if (tokenScores.some((score) => score === 0)) {
        return null;
      }
      const label = normalizeSearchText(command.label);
      const labelBoost = label.startsWith(normalizedQuery) ? 120 : label.includes(normalizedQuery) ? 60 : 0;
      return {
        command,
        score: tokenScores.reduce((total, score) => total + score, 0) + labelBoost - index / 100,
      };
    })
    .filter((result): result is CommandSearchResult => result !== null)
    .sort((left, right) => right.score - left.score);
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  shortcuts: readonly ShortcutCommand[],
  executableCommandIds: ReadonlySet<string>,
  activeScope = "global"
): ResolvedShortcutCommand {
  const eventKey = normalizeShortcutEvent(event);
  const matches = shortcuts.filter((shortcut) => {
    const scope = shortcut.scope ?? "global";
    return (
      executableCommandIds.has(shortcut.id) &&
      shortcutScopesOverlap(scope, activeScope) &&
      shortcut.keys.some((key) => normalizeShortcutChord(key) === eventKey)
    );
  });

  if (matches.length === 0) {
    return { commandId: null, conflict: null };
  }

  const conflict = findShortcutConflicts(matches).find(
    (candidate) => candidate.normalizedKey === eventKey
  );
  if (conflict) {
    return { commandId: null, conflict };
  }

  return { commandId: matches[0].id, conflict: null };
}

function parseShortcutKeys(value: string | readonly string[]): string[] {
  const parts = Array.isArray(value)
    ? value
    : value
        .split(/\s+\/\s+|,/g)
        .map((part) => part.trim());

  return parts
    .map((part) => normalizeShortcutChord(part))
    .filter(Boolean)
    .map(formatNormalizedShortcutKey);
}

function shortcutKeysEqual(left: readonly string[], right: readonly string[]): boolean {
  const leftNormalized = left.map(normalizeShortcutChord);
  const rightNormalized = right.map(normalizeShortcutChord);
  return (
    leftNormalized.length === rightNormalized.length &&
    leftNormalized.every((key, index) => key === rightNormalized[index])
  );
}

export function updateShortcutBinding(
  shortcuts: readonly ShortcutCommand[],
  commandId: string,
  nextKeys: string | readonly string[]
): ShortcutCommand[] {
  const parsedKeys = parseShortcutKeys(nextKeys);
  return shortcuts.map((shortcut) =>
    shortcut.id === commandId ? { ...shortcut, keys: parsedKeys } : shortcut
  );
}

export function saveShortcutCustomizations(
  shortcuts: readonly ShortcutCommand[],
  defaults: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage
): void {
  const overrides: Record<string, string[]> = {};
  for (const shortcut of shortcuts) {
    const defaultShortcut = defaults.find((candidate) => candidate.id === shortcut.id);
    if (!defaultShortcut || !shortcutKeysEqual(shortcut.keys, defaultShortcut.keys)) {
      overrides[shortcut.id] = shortcut.keys;
    }
  }

  if (Object.keys(overrides).length === 0) {
    storage.removeItem(SHORTCUT_CUSTOMIZATIONS_STORAGE_KEY);
    return;
  }

  storage.setItem(SHORTCUT_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(overrides));
}

export function loadShortcutCustomizations(
  defaults: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS,
  storage: Pick<Storage, "getItem"> = localStorage
): ShortcutCommand[] {
  const raw = storage.getItem(SHORTCUT_CUSTOMIZATIONS_STORAGE_KEY);
  if (!raw) {
    return defaults.map((shortcut) => ({ ...shortcut, keys: [...shortcut.keys] }));
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return defaults.map((shortcut) => {
      const override = parsed[shortcut.id];
      if (!Array.isArray(override) && typeof override !== "string") {
        return { ...shortcut, keys: [...shortcut.keys] };
      }
      const keys = parseShortcutKeys(override as string | string[]);
      return keys.length > 0 ? { ...shortcut, keys } : { ...shortcut, keys: [...shortcut.keys] };
    });
  } catch {
    return defaults.map((shortcut) => ({ ...shortcut, keys: [...shortcut.keys] }));
  }
}

export function resetShortcutCustomizations(
  defaults: readonly ShortcutCommand[] = DEFAULT_SHORTCUTS,
  storage: Pick<Storage, "removeItem"> = localStorage
): ShortcutCommand[] {
  storage.removeItem(SHORTCUT_CUSTOMIZATIONS_STORAGE_KEY);
  return defaults.map((shortcut) => ({ ...shortcut, keys: [...shortcut.keys] }));
}

