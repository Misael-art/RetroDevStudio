export interface ShortcutCommand {
  id: string;
  group: string;
  label: string;
  keys: string[];
  scope?: string;
  description?: string;
  editable?: boolean;
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
}

export interface ShortcutEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

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
    label: "Abrir projeto",
    keys: ["Ctrl+O"],
    scope: "shell",
    editable: true,
  },
  {
    id: "scene.save",
    group: "Projeto",
    label: "Salvar cena",
    keys: ["Ctrl+S"],
    scope: "shell",
    editable: true,
  },
  {
    id: "build.run",
    group: "Build",
    label: "Build & Run",
    keys: ["Ctrl+B"],
    scope: "shell",
    editable: true,
  },
  {
    id: "build.validate",
    group: "Build",
    label: "Validar projeto",
    keys: ["Ctrl+Shift+B"],
    scope: "shell",
    editable: true,
  },
  {
    id: "code.generate",
    group: "Build",
    label: "Gerar C",
    keys: ["Ctrl+Alt+C"],
    scope: "shell",
    editable: true,
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
    scope: "shell",
    editable: true,
  },
  {
    id: "edit.redo",
    group: "Edicao",
    label: "Refazer",
    keys: ["Ctrl+Shift+Z", "Ctrl+Y"],
    scope: "shell",
    editable: true,
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
    scope: "shell",
    editable: true,
  },
  {
    id: "layout.save",
    group: "Layout",
    label: "Salvar layout",
    keys: ["Ctrl+Alt+S"],
    scope: "shell",
    editable: true,
  },
  {
    id: "layout.restore",
    group: "Layout",
    label: "Restaurar layout",
    keys: ["Ctrl+Alt+R"],
    scope: "shell",
    editable: true,
  },
  {
    id: "shortcuts.show",
    group: "Layout",
    label: "Abrir mapa de atalhos",
    keys: ["Ctrl+/"],
    scope: "shell",
    editable: true,
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
      };
    })
    .filter((conflict) => conflict.commandIds.length > 1);
}

function shortcutScopesOverlap(left: string, right: string): boolean {
  return left === right || left === "global" || right === "global";
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
