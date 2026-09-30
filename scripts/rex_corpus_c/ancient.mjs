// Bounded structural extractor for the "Ancient Music Driver -MD-" profile.
//
// Every rule encoded here was read out of the driver's own 68000 instructions
// in the local ROM (see docs/rex_corpus_c/AUDIO_CHAIN_ANCIENT_MD.md for the
// instruction-level evidence). Nothing here executes ROM bytes: the ROM image
// is treated strictly as data. Where the driver's behaviour was not proven,
// this module stops and records the reason instead of inventing semantics.

import { sha256, u16be } from "./lib.mjs";

export const ANCIENT_VERSION = "rex-corpus-c-ancient/1";
export const PROFILE_SCHEMA = "rex-corpus-c-profile/1";

export const EVENT_END = 0x00;
export const COMMAND_BASE = 0xf0;
export const DURATION_FLAG = 0x80;
export const INDEX_SLOTS = 256; // proven: the driver masks the index with $ff

// Operand widths per command byte, as derived from each jump-table handler.
// `partial` means the handler re-dispatches or loops and the remaining width
// was NOT proven, so a walk must stop there rather than guess.
export const COMMAND_WIDTHS = {
  f0: { operands: 1, certainty: "proven" },
  f1: { operands: 1, certainty: "proven" },
  f2: { operands: 2, certainty: "proven", operand_form: "le16" },
  f3: { operands: 1, certainty: "proven" },
  f4: { operands: 1, certainty: "partial" },
  f5: { operands: 2, certainty: "proven", operand_form: "skipped" },
  f6: { operands: 0, certainty: "proven" },
  f7: { operands: 4, certainty: "proven" },
  f8: { operands: 1, certainty: "proven" },
  f9: { operands: 1, certainty: "proven" },
  fa: { operands: 2, certainty: "proven" },
  fb: { operands: 1, certainty: "proven" },
  fc: { operands: 3, certainty: "partial" },
  fd: { operands: 0, certainty: "proven" },
  fe: { operands: 2, certainty: "proven", operand_form: "skipped" },
  ff: { operands: 1, certainty: "partial" },
};

export function classify(byte) {
  if (byte === EVENT_END) return "end";
  if (byte >= COMMAND_BASE) return "command";
  if (byte >= DURATION_FLAG) return "duration";
  return "note";
}

function u16le(buf, o) {
  return buf[o] | (buf[o + 1] << 8);
}

function u32be(buf, o) {
  return ((buf[o] * 0x1000000) + (buf[o + 1] << 16) + (buf[o + 2] << 8) + buf[o + 3]) >>> 0;
}

// Walks one track stream. Returns the decoded events plus an explicit stop
// reason; `unknown_events` carries anything the profile cannot interpret.
export function walkStream(buf, start, opts = {}) {
  const {
    maxEvents = 4096,
    maxBytes = 0x8000,
    streamEnd = buf.length,
    pitchTable = null,
  } = opts;
  const events = [];
  const unknown = [];
  let off = start;
  const limit = Math.min(streamEnd, start + maxBytes);
  const hitBoundLabel = streamEnd < buf.length ? "next_stream_bound" : "range_end";
  let stopped = hitBoundLabel;

  while (off < limit) {
    if (events.length >= maxEvents) {
      stopped = "max_events";
      break;
    }
    const byte = buf[off];
    const kind = classify(byte);

    if (kind === "end") {
      events.push({ offset: off, byte, kind: "end_of_stream", size: 1 });
      stopped = "end_of_stream";
      off += 1;
      break;
    }
    if (kind === "duration") {
      events.push({ offset: off, byte, kind: "duration", length_code: byte - DURATION_FLAG, size: 1 });
      off += 1;
      continue;
    }
    if (kind === "note") {
      if (off + 1 >= limit) {
        stopped = "truncated_operand";
        unknown.push({ offset: off, byte, kind: "note", reason: "operand_outside_window" });
        break;
      }
      const operand = buf[off + 1];
      const ev = {
        offset: off,
        byte,
        kind: "note",
        size: 2,
        pitch_code: operand,
        pitch_table_index: operand & 0x0f,
        octave_code: (operand & 0xf0) >> 4,
      };
      if (pitchTable !== null) {
        const to = pitchTable + ev.pitch_table_index * 2;
        if (to + 1 < buf.length) {
          ev.pitch_word = u16be(buf, to);
          ev.pitch_word_source_offset = to;
        }
      }
      events.push(ev);
      off += 2;
      continue;
    }

    const cmd = byte.toString(16).padStart(2, "0");
    const spec = COMMAND_WIDTHS[cmd];
    if (!spec) {
      stopped = "unknown_command";
      unknown.push({ offset: off, byte, kind: "command", reason: "no_width_in_profile" });
      break;
    }
    const size = 1 + spec.operands;
    if (off + size > limit) {
      stopped = "truncated_operand";
      unknown.push({ offset: off, byte, kind: "command", command: cmd, reason: "operands_outside_window" });
      break;
    }
    const ev = {
      offset: off,
      byte,
      kind: "command",
      command: cmd,
      operands: [...buf.subarray(off + 1, off + size)],
      size,
      certainty: spec.certainty,
    };
    if (spec.certainty !== "proven") {
      // The stream may continue past this point, but the bytes in between are
      // not attributable, so the walk stops and says so.
      ev.semantics = "unproven_operand_width";
      events.push(ev);
      unknown.push({ offset: off, byte, kind: "command", command: cmd, reason: "unproven_operand_width" });
      stopped = "unproven_command_width";
      break;
    }
    events.push(ev);
    off += size;
  }

  if (stopped === hitBoundLabel && off < limit) stopped = "max_bytes";
  return {
    start_offset: start,
    end_offset: off,
    bytes_consumed: off - start,
    stopped,
    events,
    unknown_events: unknown,
  };
}

// The song index: 256 slots of big-endian uint32, each an offset from the
// table itself to a song header. 0 marks an unused slot.
export function readSongIndex(buf, tableOffset, opts = {}) {
  const { maxSongs = INDEX_SLOTS } = opts;
  const songs = [];
  const refs = new Set();
  const problems = [];
  const slots = Math.min(maxSongs, INDEX_SLOTS);
  for (let i = 0; i < slots; i += 1) {
    const at = tableOffset + i * 4;
    if (at + 3 >= buf.length) {
      problems.push({ index: i, reason: "index_record_outside_rom", offset: at });
      break;
    }
    const value = u32be(buf, at);
    if (value === 0) continue;
    const target = tableOffset + value;
    const entry = {
      index: i,
      record_offset: at,
      raw_offset: value,
      header_offset: target,
      valid: target + 1 < buf.length,
    };
    if (!entry.valid) problems.push({ index: i, reason: "header_outside_rom", offset: at, target });
    else refs.add(target);
    songs.push(entry);
  }
  return { songs, references: [...refs], problems };
}

// A song header is an array of little-endian uint16 track-stream offsets,
// each relative to the header address itself. 0 is an empty slot.
export function readTrackHeader(buf, headerOffset, opts = {}) {
  const { maxTracks = 32 } = opts;
  const tracks = [];
  const problems = [];
  let sawNonZero = false;
  let previous = 0;
  for (let i = 0; i < maxTracks; i += 1) {
    const at = headerOffset + i * 2;
    if (at + 1 >= buf.length) {
      problems.push({ slot: i, reason: "header_outside_rom", offset: at });
      break;
    }
    const value = u16le(buf, at);
    if (value === 0) {
      if (sawNonZero) break; // terminator after real entries
      continue; // leading empty slots (silent tracks)
    }
    sawNonZero = true;
    const target = headerOffset + value;
    const track = { slot: i, record_offset: at, raw_offset: value, stream_offset: target, valid: target + 1 < buf.length };
    if (!track.valid) problems.push({ slot: i, reason: "stream_outside_rom", offset: at, target });
    if (value <= previous) problems.push({ slot: i, reason: "non_monotonic_track_offsets", offset: at, previous, current: value });
    previous = value;
    if (track.valid) tracks.push(track);
  }
  return { tracks, problems };
}

// Full profile-driven extraction. `profile` is the JSON contract under
// data/rex_corpus_c/profiles/. The ROM sha is re-checked here so a profile can
// never be silently applied to a different image.
export function extractAncient(buf, profile, opts = {}) {
  const {
    romPath = null,
    allowIdentityMismatch = false,
    song = null,
    maxSongs = 8,
    maxTracks = 32,
    maxEvents = 4096,
    maxBytes = 0x8000,
  } = opts;

  const romSha = sha256(buf);
  const declared = profile.rom_sha256 ?? null;
  if (declared && declared !== romSha && !allowIdentityMismatch) {
    return {
      schema: "rex-corpus-c-extract/1",
      driver_profile: profile.profile,
      rom_sha256: romSha,
      normalized_sha256: profile.normalized_sha256 ?? null,
      status: "identity_mismatch",
      error: `profile declares ${declared}, ROM is ${romSha}`,
      limitations: ["no data extracted: profile identity gate refused the image"],
    };
  }

  // A table address on its own is not enough: arithmetic that merely *looks*
  // like a pointer array must carry the driver sites that read it, otherwise
  // the extractor refuses rather than presenting a coincidence as structure.
  const consumers = profile.song_index?.consumer_offsets ?? [];
  if (consumers.length === 0) {
    return {
      schema: "rex-corpus-c-extract/1",
      driver_profile: profile.profile,
      rom_sha256: romSha,
      normalized_sha256: profile.normalized_sha256 ?? null,
      status: "unproven_consumer",
      error: "profile declares a song table with no driver instruction site that reads it",
      limitations: ["no data extracted: a candidate table is not evidence of a table"],
    };
  }
  const tableOffset = parseInt(profile.song_index.table_rom_offset, 16);
  const pitchTable = profile.pitch_table ? parseInt(profile.pitch_table.rom_offset, 16) : null;
  const index = readSongIndex(buf, tableOffset, { maxSongs });
  const selected = song === null ? index.songs : index.songs.filter((s) => s.index === song);

  const songs = [];
  const references = [
    { kind: "song_index_table", offset: tableOffset, proven_by: consumers.map((c) => `driver site ${c}`) },
  ];
  const unknownEvents = [];
  const eventTypes = new Map();

  for (const entry of selected) {
    if (!entry.valid) continue;
    const header = readTrackHeader(buf, entry.header_offset, { maxTracks });
    references.push({ kind: "song_header", offset: entry.header_offset, song_index: entry.index });
    const streams = [];
    for (let ti = 0; ti < header.tracks.length; ti += 1) {
      const track = header.tracks[ti];
      // The next track's stream is a hard structural bound: a stream that
      // never emits an end marker stops there instead of decoding its
      // neighbour as events.
      const next = header.tracks[ti + 1];
      const walk = walkStream(buf, track.stream_offset, {
        maxEvents,
        maxBytes,
        streamEnd: next ? next.stream_offset : buf.length,
        pitchTable,
      });
      for (const ev of walk.events) {
        eventTypes.set(ev.kind, (eventTypes.get(ev.kind) ?? 0) + 1);
      }
      for (const u of walk.unknown_events) {
        unknownEvents.push({ ...u, song_index: entry.index, track_slot: track.slot });
      }
      references.push({ kind: "track_stream", offset: track.stream_offset, song_index: entry.index, track_slot: track.slot });
      streams.push({ track_slot: track.slot, header_record_offset: track.record_offset, ...walk });
    }
    songs.push({ song_index: entry.index, header_offset: entry.header_offset, tracks: streams, problems: header.problems });
  }

  return {
    schema: "rex-corpus-c-extract/1",
    extractor_version: ANCIENT_VERSION,
    status: "ok",
    source_path: romPath,
    rom_sha256: romSha,
    normalized_sha256: profile.normalized_sha256 ?? null,
    driver_profile: `${profile.profile}@${profile.profile_version}`,
    profile_version: profile.profile_version,
    offsets: {
      song_index_table: tableOffset,
      command_jump_table: profile.command_jump_table ? parseInt(profile.command_jump_table.rom_offset, 16) : null,
      pitch_table: pitchTable,
      z80_image: profile.z80_image ? parseInt(profile.z80_image.rom_offset, 16) : null,
    },
    limits: { maxSongs, maxTracks, maxEvents, maxBytes },
    songs,
    references,
    event_types: Object.fromEntries([...eventTypes].sort()),
    unknown_events: unknownEvents,
    index_problems: index.problems,
    evidence: profile.evidence ?? null,
    limitations: [
      ...(profile.limitations ?? []),
      "Stream walks stop at commands 0xf4/0xfc/0xff because their operand widths are only partially proven; trailing bytes of those streams are reported as unknown_events, never decoded.",
      "No instrument, FM/PSG voice or sample representation is covered by this profile.",
      "The pitch word table is emitted as an opaque 16-bit code; no note-name or MIDI mapping is claimed.",
    ],
  };
}
