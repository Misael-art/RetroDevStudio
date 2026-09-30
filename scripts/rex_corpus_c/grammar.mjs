// SMPS coordination-flag grammar, shared by the profile scanner and the extractor.
//
// Primary source (pinned 2026-09-30):
//   sonicretro/smps-rips @ master, file "SMPS_Commands+Terminology.txt"
//   sha256 of the local copy is recorded in data/rex_corpus_c/sources.json.
//   URL: https://raw.githubusercontent.com/sonicretro/smps-rips/master/SMPS_Commands%2BTerminology.txt
//
// The source states that "They differ slightly in almost every SMPS driver" for
// command flags, so this grammar is deliberately conservative: only parameter
// counts that the source gives without a version qualifier are encoded here.
// Anything version-dependent is declared UNKNOWN and reported as such rather
// than guessed.

export const GRAMMAR_VERSION = "smps-coord-flags/1";

// Command ids that appear in the pinned table with a fixed parameter count.
const FIXED_PARAMS = new Map([
  [0xe0, 2], // Pan
  [0xe1, 1], // Detune
  [0xe2, 1], // SetComm
  [0xe3, 1], // SilenceTrk
  [0xe6, 1], // ChgFMVol
  [0xe7, 0], // Hold
  [0xe8, 1], // NoteTimeout
  [0xe9, 3], // SetLFO
  [0xec, 1], // ChgPSGVol
  [0xed, 2], // FMChnWrite
  [0xee, 2], // FM1Write
  [0xef, 1], // SetIns (68k form; Z80 >=0x80 form is version-dependent)
  [0xf0, 5], // ModSetup
  [0xf2, 0], // StopTrk
  [0xf3, 1], // PSGNoise
  [0xf5, 1], // SetPSGIns
  [0xfa, 1], // TickMult
  [0xfb, 1], // ChgTransp
  [0xfd, 1], // RawFrqMode
]);

// Commands whose parameter count depends on the driver variant. Walkable, but
// the walk records the choice it made so a wrong guess is visible in the JSON.
const VERSION_DEPENDENT = new Map([
  [0xe4, "pananim"], // 68k: 1 or 5 params; Z80: always 5
  [0xe5, "chgpfmvol"], // 2 params, semantics differ 68k/Z80
  [0xf1, "modtypepfm"], // 2 params
  [0xf4, "modtype"], // 1 or 2 params depending on driver
  [0xfc, "pitcheslide"], // 1 or 2 params depending on driver
  [0xfe, "spcfm3mode"], // "varying amount of parameters" per the source
]);

// Pointer-bearing commands: size and base depend on the SMPS pointer format
// (68k / Ristar / Z80), which is a driver attribute, not a per-command one.
const POINTER_COMMANDS = new Map([
  [0xf6, "goto"],
  [0xf7, "loop"],
  [0xf8, "gosub"],
]);

// "FF <id>" prefixed commands (common in SMPS Z80).
const FF_COMMANDS = new Map([
  [0x00, 1], // SetTempo
  [0x01, 1], // PlaySnd
  [0x02, 1], // MusPause
  [0x03, 3], // CopyMem
  [0x04, 1], // TickMultAll
  [0x05, 1], // SSGEG
  [0x06, 1], // FMVolEnv
]);

export function isCoordinationFlag(byte) {
  return byte >= 0xe0 && byte <= 0xff;
}

// Bytes below 0xe0 are note/duration pairs in every SMPS family, so a stream
// of data bytes is expected to be mostly < 0xe0 with occasional flags.
export function classifyByte(byte) {
  if (byte === 0xff) return "ff_prefix";
  if (isCoordinationFlag(byte)) return "coordination_flag";
  return "data";
}

// Parameter count for one command under a chosen variant. Returns null when
// the byte is not a command in this grammar. `variant` selects the
// version-dependent readings ("68k" or "z80").
export function commandParamCount(byte, variant = "z80") {
  if (FIXED_PARAMS.has(byte)) return FIXED_PARAMS.get(byte);
  if (POINTER_COMMANDS.has(byte)) return pointerSizeFor(variant) + 1;
  if (byte === 0xf9) return 0; // Return
  if (byte === 0xff) return null; // handled by caller as a two-byte prefix
  const dep = VERSION_DEPENDENT.get(byte);
  if (!dep) return null;
  switch (dep) {
    case "pananim":
      return variant === "z80" ? 5 : 1;
    case "chgpfmvol":
    case "modtypepfm":
      return 2;
    case "modtype":
      return variant === "z80" ? 1 : 1;
    case "pitcheslide":
      return variant === "z80" ? 2 : 1;
    case "spcfm3mode":
      return variant === "z80" ? 2 : 1;
    default:
      return null;
  }
}

export function pointerSizeFor(variant) {
  return variant === "68k" ? 2 : 3;
}

// Walk a byte range as a command stream and report structural agreement:
// how many bytes the walk consumed, how many flags it saw, and whether the
// stream is dominated by coordination flags (which real sequences are not).
//
// This is a *discriminator*, not a decoder: it never assigns notes or
// durations, and it stops at the first byte that is not a valid command
// start under the chosen variant.
export function walkCommandStream(buf, start, { variant = "z80", maxBytes = 0x2000 } = {}) {
  const seen = [];
  let off = start;
  let consumed = 0;
  let flags = 0;
  let dataBytes = 0;
  let stopped = "range_end";
  const limit = Math.min(buf.length, start + maxBytes);

  while (off < limit) {
    const b = buf[off];
    if (isCoordinationFlag(b)) {
      let params;
      if (b === 0xff) {
        const sub = buf[off + 1];
        if (sub === undefined || !FF_COMMANDS.has(sub)) {
          stopped = "unknown_ff_command";
          break;
        }
        params = FF_COMMANDS.get(sub) + 1;
      } else {
        params = commandParamCount(b, variant);
        if (params === null) {
          stopped = "unknown_command";
          break;
        }
      }
      flags += 1;
      seen.push({ offset: off, byte: b, kind: "flag", params });
      off += 1 + params;
      consumed += 1 + params;
    } else {
      // Note/duration payload. The exact pairing rule is version-dependent
      // and is intentionally NOT modelled here; we count the byte and move on.
      dataBytes += 1;
      seen.push({ offset: off, byte: b, kind: "data", params: 0 });
      off += 1;
      consumed += 1;
    }
  }
  if (off >= limit && stopped === "range_end") stopped = "max_bytes_or_end";
  return { consumed, flags, dataBytes, stopped, off };
}
