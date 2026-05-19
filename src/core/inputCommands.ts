export type CommandButtonProfile = "megadrive" | "snes" | "keyboard" | "mouse";

export interface InputCommandStep {
  tokens: string[];
  display: string[];
}

export interface ParsedInputCommand {
  id: string;
  display_name: string;
  notation: string;
  source: string;
  max_frames: number;
  steps: InputCommandStep[];
  unsupported_tokens: string[];
}

const DEFAULT_MAX_FRAMES = 20;

const DIRECTION_GLYPHS: Record<string, string> = {
  "1": "↙",
  "2": "↓",
  "3": "↘",
  "4": "←",
  "5": "•",
  "6": "→",
  "7": "↖",
  "8": "↑",
  "9": "↗",
  D: "↓",
  F: "→",
  B: "←",
  U: "↑",
  DF: "↘",
  DB: "↙",
  UF: "↗",
  UB: "↖",
};

const BUTTON_PROFILE_LABELS: Record<CommandButtonProfile, Record<string, string>> = {
  megadrive: {
    P: "A",
    K: "B",
    A: "A",
    B: "B",
    C: "C",
    X: "X",
    Y: "Y",
    Z: "Z",
  },
  snes: {
    P: "Y",
    K: "B",
    A: "B",
    B: "Y",
    C: "X",
    X: "A",
    Y: "L",
    Z: "R",
  },
  keyboard: {
    P: "J",
    K: "K",
    A: "A",
    B: "S",
    C: "D",
    X: "J",
    Y: "K",
    Z: "L",
  },
  mouse: {
    P: "LMB",
    K: "RMB",
    A: "LMB",
    B: "RMB",
    C: "MMB",
    X: "X1",
    Y: "X2",
    Z: "Wheel",
  },
};

function stripComment(line: string): string {
  const semicolon = line.indexOf(";");
  const hash = line.indexOf("#");
  const cut =
    semicolon >= 0 && hash >= 0
      ? Math.min(semicolon, hash)
      : semicolon >= 0
        ? semicolon
        : hash;
  return cut >= 0 ? line.slice(0, cut) : line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "command"
  );
}

function normalizeToken(token: string): string {
  return token.trim();
}

function tokenKey(token: string): string {
  const trimmed = token.trim();
  const withoutPrefix = trimmed.startsWith("_") ? trimmed.slice(1) : trimmed;
  return withoutPrefix.toUpperCase();
}

function isSupportedToken(token: string): boolean {
  const raw = token.trim();
  if (/^[abcxyz]$/.test(raw)) {
    return true;
  }
  const key = tokenKey(token);
  if (/^[1-9]$/.test(key)) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(DIRECTION_GLYPHS, key)) {
    return true;
  }
  if (key === "P" || key === "K") {
    return true;
  }
  if (/^[ABCXYZ]$/.test(key)) {
    return true;
  }
  return false;
}

function displayToken(token: string): string {
  const raw = token.trim();
  if (/^[abcxyz]$/.test(raw)) {
    return raw.toUpperCase();
  }
  const key = tokenKey(token);
  if (Object.prototype.hasOwnProperty.call(DIRECTION_GLYPHS, key)) {
    return DIRECTION_GLYPHS[key];
  }
  if (key === "P" || key === "K") {
    return key;
  }
  if (/^[ABCXYZ]$/.test(key)) {
    return key;
  }
  return token.trim();
}

function parseSteps(notation: string): { steps: InputCommandStep[]; unsupportedTokens: string[] } {
  const unsupportedTokens: string[] = [];
  const steps = notation
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const tokens = chunk
        .split("+")
        .map(normalizeToken)
        .filter(Boolean);
      for (const token of tokens) {
        if (!isSupportedToken(token)) {
          unsupportedTokens.push(token);
        }
      }
      return {
        tokens,
        display: tokens.map(displayToken),
      };
    });

  return { steps, unsupportedTokens: Array.from(new Set(unsupportedTokens)) };
}

export function parseCommandDat(content: string, source = "command.dat"): ParsedInputCommand[] {
  const commands: ParsedInputCommand[] = [];
  let inCommand = false;
  let name = "";
  let notation = "";
  let maxFrames = DEFAULT_MAX_FRAMES;

  function flush() {
    if (!inCommand || !name || !notation) {
      return;
    }
    const { steps, unsupportedTokens } = parseSteps(notation);
    commands.push({
      id: slugify(name),
      display_name: name,
      notation,
      source,
      max_frames: maxFrames,
      steps,
      unsupported_tokens: unsupportedTokens,
    });
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      flush();
      inCommand = section[1].trim().toLowerCase() === "command";
      name = "";
      notation = "";
      maxFrames = DEFAULT_MAX_FRAMES;
      continue;
    }

    if (!inCommand) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = unquote(line.slice(eq + 1));
    if (key === "name") {
      name = value;
    } else if (key === "command") {
      notation = value;
    } else if (key === "time") {
      const parsed = Number.parseInt(value, 10);
      maxFrames = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FRAMES;
    }
  }
  flush();

  return commands;
}

export function renderCommandTokensForProfile(
  step: InputCommandStep,
  profile: CommandButtonProfile
): string {
  const profileLabels = BUTTON_PROFILE_LABELS[profile];
  return step.tokens
    .map((token) => {
      const raw = token.trim();
      if (/^[abcxyz]$/.test(raw)) {
        return profileLabels[raw.toUpperCase()] ?? raw.toUpperCase();
      }
      const key = tokenKey(token);
      if (Object.prototype.hasOwnProperty.call(DIRECTION_GLYPHS, key)) {
        return DIRECTION_GLYPHS[key];
      }
      return profileLabels[key] ?? displayToken(token);
    })
    .join("+");
}

export function formatInputCommandSequence(
  command: Pick<ParsedInputCommand, "steps">,
  profile?: CommandButtonProfile
): string {
  return command.steps
    .map((step) => (profile ? renderCommandTokensForProfile(step, profile) : step.display.join("+")))
    .join(" ");
}
