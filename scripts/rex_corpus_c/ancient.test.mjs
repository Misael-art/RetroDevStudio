import { describe, expect, it } from "vitest";

import {
  ANCIENT_VERSION,
  COMMAND_WIDTHS,
  classify,
  extractAncient,
  readSongIndex,
  readTrackHeader,
  walkStream,
} from "./ancient.mjs";

// These tests build ROM-shaped buffers in memory. Nothing here reads a real
// ROM, so the suite stays BYOR-safe and runs on any host.

function synthRom(size = 0x1000, fill = 0x00) {
  const buf = new Uint8Array(size).fill(fill);
  const put = (off, bytes) => bytes.forEach((b, i) => (buf[off + i] = b));
  const be32 = (off, v) => put(off, [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  const le16 = (off, v) => put(off, [v & 0xff, (v >>> 8) & 0xff]);
  const be16 = (off, v) => put(off, [(v >>> 8) & 0xff, v & 0xff]);
  return { buf, put, be32, be16, le16 };
}

// index@0x100 (4 slots), header@0x300, streams@0x322 and 0x340, pitch table@0x800
function fixture() {
  const { buf, put, be32, be16, le16 } = synthRom();
  const TABLE = 0x100;
  be32(TABLE + 0, 0x200); // song 0 -> header 0x300
  be32(TABLE + 4, 0); //     song 1 -> unused slot
  be32(TABLE + 8, 0x260); // song 2 -> header 0x360 (no tracks)
  be32(TABLE + 12, 0x9fff); // song 3 -> target outside the ROM
  le16(0x300, 0); //  track slot 0 is empty
  le16(0x302, 0x22); // track slot 1 -> 0x322
  le16(0x304, 0x40); // track slot 2 -> 0x340
  le16(0x306, 0); //  terminator
  put(0x360, [0x00]); // song 2 header: immediate terminator, no tracks
  put(0x322, [0xf0, 0x01, 0x3e, 0x25, 0x85, 0xf0, 0x02, 0x00, 0x99]);
  put(0x340, [0x00]);
  for (let i = 0; i < 16; i += 1) be16(0x800 + i * 2, 0x284 + i);
  return { buf, TABLE };
}

const profile = {
  profile: "ancient-music-driver-md",
  profile_version: "1",
  rom_sha256: null,
  normalized_sha256: null,
  song_index: { table_rom_offset: "0x100", consumer_offsets: ["0x60b50", "0x60f1c", "0x60f54"] },
  command_jump_table: { rom_offset: "0x200" },
  pitch_table: { rom_offset: "0x800" },
  z80_image: { rom_offset: "0x600" },
  limitations: ["fixture profile"],
  evidence: { fixture: true },
};

describe("ancient event grammar", () => {
  it("classifies every byte range the driver branches on", () => {
    expect(classify(0x00)).toBe("end");
    expect(classify(0x01)).toBe("note");
    expect(classify(0x7f)).toBe("note");
    expect(classify(0x80)).toBe("duration");
    expect(classify(0xef)).toBe("duration");
    expect(classify(0xf0)).toBe("command");
    expect(classify(0xff)).toBe("command");
  });

  it("covers all sixteen command bytes and marks the three unproven ones", () => {
    expect(Object.keys(COMMAND_WIDTHS)).toHaveLength(16);
    expect(Object.keys(COMMAND_WIDTHS).filter((c) => COMMAND_WIDTHS[c].certainty === "partial").sort()).toEqual([
      "f4",
      "fc",
      "ff",
    ]);
  });

  it("walks notes, durations and commands up to the end marker", () => {
    const { buf } = fixture();
    const w = walkStream(buf, 0x322, { streamEnd: 0x400 });
    expect(w.stopped).toBe("end_of_stream");
    expect(w.events.map((e) => e.kind)).toEqual(["command", "note", "duration", "command", "end_of_stream"]);
    expect(w.events[1]).toMatchObject({ offset: 0x324, pitch_code: 0x25, pitch_table_index: 5, octave_code: 2 });
    expect(w.events[2].length_code).toBe(5);
    expect(w.bytes_consumed).toBe(8);
    expect(w.unknown_events).toEqual([]);
  });

  it("stops at a command whose operand width is not proven instead of guessing", () => {
    const { buf, put } = synthRom();
    put(0x20, [0xff, 0x03, 0x41, 0x50, 0x00]);
    const w = walkStream(buf, 0x20, { streamEnd: 0x40 });
    expect(w.stopped).toBe("unproven_command_width");
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ command: "ff", certainty: "partial", semantics: "unproven_operand_width" });
    expect(w.unknown_events).toEqual([
      { offset: 0x20, byte: 0xff, kind: "command", command: "ff", reason: "unproven_operand_width" },
    ]);
  });

  it("treats the next stream's offset as a hard bound when no end marker exists", () => {
    const { buf, put } = synthRom();
    put(0x20, [0x41, 0x50, 0x83, 0x42, 0x51]);
    const w = walkStream(buf, 0x20, { streamEnd: 0x24, pitchTable: null });
    expect(w.stopped).toBe("truncated_operand");
    expect(w.events.map((e) => e.kind)).toEqual(["note", "duration"]);
    expect(w.unknown_events[0].reason).toBe("operand_outside_window");
  });

  it("honours maxEvents so a hostile stream cannot run the process", () => {
    const { buf, put } = synthRom();
    put(0x20, new Array(64).fill(0x81));
    const w = walkStream(buf, 0x20, { streamEnd: 0x60, maxEvents: 3 });
    expect(w.events).toHaveLength(3);
    expect(w.stopped).toBe("max_events");
  });
});

describe("ancient table readers", () => {
  it("reads big-endian, base-relative song slots and skips unused ones", () => {
    const { buf, TABLE } = fixture();
    const { songs, problems } = readSongIndex(buf, TABLE, { maxSongs: 4 });
    expect(songs.map((s) => s.index)).toEqual([0, 2, 3]);
    expect(songs[0].header_offset).toBe(0x300);
    expect(songs[2].valid).toBe(false);
    expect(problems).toEqual([{ index: 3, reason: "header_outside_rom", offset: 0x10c, target: 0xa0ff }]);
  });

  it("keeps track slot indices aligned through a leading empty slot", () => {
    const { buf } = fixture();
    const { tracks, problems } = readTrackHeader(buf, 0x300);
    expect(tracks.map((t) => t.slot)).toEqual([1, 2]);
    expect(tracks.map((t) => t.stream_offset)).toEqual([0x322, 0x340]);
    expect(problems).toEqual([]);
  });

  it("reports a non-monotonic header instead of silently accepting it", () => {
    const { buf, le16 } = synthRom();
    le16(0x300, 0x40);
    le16(0x302, 0x10);
    le16(0x304, 0);
    const { tracks, problems } = readTrackHeader(buf, 0x300);
    expect(tracks).toHaveLength(2);
    expect(problems[0].reason).toBe("non_monotonic_track_offsets");
  });
});

describe("extractAncient", () => {
  it("emits the contract fields the mission requires", () => {
    const { buf } = fixture();
    const out = extractAncient(buf, profile, {});
    expect(out.status).toBe("ok");
    for (const field of [
      "rom_sha256",
      "normalized_sha256",
      "driver_profile",
      "offsets",
      "references",
      "event_types",
      "unknown_events",
      "evidence",
      "limitations",
    ]) {
      expect(out, field).toHaveProperty(field);
    }
    expect(out.extractor_version).toBe(ANCIENT_VERSION);
    expect(out.songs[0].tracks[0].events.length).toBeGreaterThan(0);
    expect(out.event_types).toEqual({ command: 2, duration: 1, end_of_stream: 2, note: 1 });
  });

  it("refuses a profile whose declared ROM hash does not match the image", () => {
    const { buf } = fixture();
    const out = extractAncient(buf, { ...profile, rom_sha256: "0".repeat(64) }, {});
    expect(out.status).toBe("identity_mismatch");
    expect(out.songs).toBeUndefined();
  });

  it("extracts anyway when the operator explicitly overrides the identity gate", () => {
    const { buf } = fixture();
    const out = extractAncient(buf, { ...profile, rom_sha256: "0".repeat(64) }, { allowIdentityMismatch: true });
    expect(out.status).toBe("ok");
  });

  it("survives a song slot that points outside the ROM", () => {
    const { buf, TABLE } = fixture();
    const out = extractAncient(buf, profile, { song: 3 });
    expect(out.songs).toEqual([]);
    expect(out.index_problems[0].reason).toBe("header_outside_rom");
  });
});

describe("profile admission", () => {
  it("refuses a candidate table that has no proven driver consumer", () => {
    const { buf } = fixture();
    const bare = { ...profile, song_index: { table_rom_offset: "0x100" } };
    const out = extractAncient(buf, bare, {});
    expect(out.status).toBe("unproven_consumer");
    expect(out.songs).toBeUndefined();
  });

  it("records which driver sites justify the table it walks", () => {
    const { buf } = fixture();
    const out = extractAncient(buf, profile, { song: 2 });
    expect(out.references[0].proven_by).toEqual(["driver site 0x60b50", "driver site 0x60f1c", "driver site 0x60f54"]);
  });
});
