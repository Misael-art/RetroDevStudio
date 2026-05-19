import { describe, expect, it } from "vitest";

import {
  formatInputCommandSequence,
  parseCommandDat,
  renderCommandTokensForProfile,
} from "./inputCommands";

describe("inputCommands command.dat parser", () => {
  it("parses Hadouken numpad notation into visual command steps", () => {
    const commands = parseCommandDat(
      `
[Command]
name = "Hadouken"
command = _2, _3, _6, _P
time = 15
`,
      "local-command.dat"
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      id: "hadouken",
      display_name: "Hadouken",
      notation: "_2, _3, _6, _P",
      max_frames: 15,
      unsupported_tokens: [],
    });
    expect(formatInputCommandSequence(commands[0])).toBe("↓ ↘ → P");
  });

  it("parses Shoryuken aliases and simultaneous input as blocking-free steps", () => {
    const [command] = parseCommandDat(
      `
[Command]
name = Shoryuken
command = F, D, DF+_P
time = 12
`,
      "local-command.dat"
    );

    expect(command.steps.map((step) => step.tokens)).toEqual([["F"], ["D"], ["DF", "_P"]]);
    expect(formatInputCommandSequence(command)).toBe("→ ↓ ↘+P");
    expect(command.unsupported_tokens).toEqual([]);
  });

  it("maps buttons by target profile without mutating source notation", () => {
    const [command] = parseCommandDat(
      `
[Command]
name = Fireball
command = _2, _3, _6, _P
time = 20
`,
      "local-command.dat"
    );

    const finalStep = command.steps[command.steps.length - 1];

    expect(renderCommandTokensForProfile(finalStep, "megadrive")).toBe("A");
    expect(renderCommandTokensForProfile(finalStep, "snes")).toBe("Y");
    expect(renderCommandTokensForProfile(finalStep, "keyboard")).toBe("J");
    expect(command.notation).toBe("_2, _3, _6, _P");
  });

  it("keeps unknown tokens as runtime-blocking unsupported_tokens", () => {
    const [command] = parseCommandDat(
      `
[Command]
name = Weird
command = ~30, _6, _P
time = 18
`,
      "local-command.dat"
    );

    expect(command.unsupported_tokens).toEqual(["~30"]);
  });
});
