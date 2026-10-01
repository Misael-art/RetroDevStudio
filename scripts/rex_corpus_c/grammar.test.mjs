import { describe, expect, it } from "vitest";
import {
  GRAMMAR_VERSION,
  classifyByte,
  commandParamCount,
  isCoordinationFlag,
  walkCommandStream,
} from "./grammar.mjs";

// Unit-only: never reads a ROM, so `npm test` stays BYOR-safe.
describe("SMPS coordination-flag grammar", () => {
  it("pins the grammar version", () => {
    expect(GRAMMAR_VERSION).toBe("smps-coord-flags/1");
  });

  it("classifies bytes at the 0xE0 coordination boundary", () => {
    expect(classifyByte(0xdf)).toBe("data");
    expect(classifyByte(0xe0)).toBe("coordination_flag");
    expect(classifyByte(0xfe)).toBe("coordination_flag");
    expect(classifyByte(0xff)).toBe("ff_prefix");
    expect(isCoordinationFlag(0x58)).toBe(false);
  });

  it("uses the pinned fixed parameter counts", () => {
    expect(commandParamCount(0xe0)).toBe(2); // Pan
    expect(commandParamCount(0xef)).toBe(1); // SetIns
    expect(commandParamCount(0xf2)).toBe(0); // StopTrk
    expect(commandParamCount(0x58)).toBe(null); // note/duration payload
  });

  it("sizes pointer commands with the chosen pointer format", () => {
    expect(commandParamCount(0xf6, "68k")).toBe(3);
    expect(commandParamCount(0xf6, "z80")).toBe(4);
  });

  it("consumes a well-formed command stream", () => {
    // The pointer payload comes from the pinned table itself so this test
    // checks the walker's arithmetic, not a hand-counted byte string.
    const pointerParams = commandParamCount(0xf8, "z80");
    const buf = Buffer.from([0xef, 0x03, 0x3e, 0xf8, ...new Array(pointerParams).fill(0x00), 0xf2]);
    const r = walkCommandStream(buf, 0, { variant: "z80" });
    expect(r.stopped).toBe("max_bytes_or_end");
    expect(r.flags).toBe(3);
    expect(r.dataBytes).toBe(1);
    expect(r.consumed).toBe(buf.length);
  });

  it("stops on an unknown FF subcommand instead of inventing one", () => {
    const buf = Buffer.from([0xff, 0x7f, 0x00]);
    const r = walkCommandStream(buf, 0, { variant: "z80" });
    expect(r.stopped).toBe("unknown_ff_command");
    expect(r.off).toBe(0);
  });

  it("stops on a coordination byte outside the pinned table", () => {
    // 0xEB has three mutually exclusive readings in the source, so it is
    // deliberately absent from the grammar.
    const buf = Buffer.from([0xeb, 0x10]);
    const r = walkCommandStream(buf, 0);
    expect(r.stopped).toBe("unknown_command");
  });

  it("does not mistake arithmetic filler for a command stream", () => {
    const buf = Buffer.alloc(0x400);
    for (let i = 0; i < buf.length; i += 1) buf[i] = (i * 7 + 13) & 0xff;
    const r = walkCommandStream(buf, 0, { maxBytes: 0x400 });
    expect(r.dataBytes).toBeGreaterThan(r.flags);
  });
});
