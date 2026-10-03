// Shared helpers for the rex_corpus_c audio-structure research front.
// Read-only BYOR tooling: never writes into the corpus, never executes ROM bytes.

import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";

export const MD_HEADER_MAGIC = "SEGA";
export const MD_HEADER_OFFSET = 0x100;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function readRomFile(p, { maxBytes = 32 * 1024 * 1024 } = {}) {
  if (!existsSync(p)) throw new Error(`rom_not_found: ${p}`);
  const st = statSync(p);
  if (!st.isFile()) throw new Error(`rom_not_a_file: ${p}`);
  if (st.size > maxBytes) throw new Error(`rom_too_large: ${st.size} > ${maxBytes}`);
  return readFileSync(p);
}

export function u16be(buf, off) {
  return (buf[off] << 8) | buf[off + 1];
}

export function u32be(buf, off) {
  return ((buf[off] * 0x1000000) + (buf[off + 1] << 16) + (buf[off + 2] << 8) + buf[off + 3]) >>> 0;
}

// Canonical Mega Drive header checksum: sum of 16-bit words from 0x200 to end
// of ROM, keeping only the low 16 bits. Source: plutiedev.com/rom-header
// (pinned 2026-09-30) and the repo's own megadrive_checksum
// (src-tauri/src/core/rom_mastering.rs:268).
export function megadriveChecksum(buf) {
  const end = buf.length - (buf.length % 2);
  let sum = 0;
  for (let off = 0x200; off < end; off += 2) {
    sum = (sum + u16be(buf, off)) & 0xffff;
  }
  return sum;
}

export function parseMdHeader(buf) {
  if (buf.length < MD_HEADER_OFFSET + 0x100) {
    throw new Error("rom_too_small_for_header");
  }
  const magic = buf.subarray(MD_HEADER_OFFSET, MD_HEADER_OFFSET + 4).toString("latin1");
  if (magic !== MD_HEADER_MAGIC) {
    throw new Error(`md_header_missing: found "${magic}" at 0x100`);
  }
  const ascii = (o, n) =>
    buf
      .subarray(MD_HEADER_OFFSET + o, MD_HEADER_OFFSET + o + n)
      .toString("latin1")
      .replace(/\s+$/g, "");
  const declaredStart = u32be(buf, MD_HEADER_OFFSET + 0xa0);
  const declaredEnd = u32be(buf, MD_HEADER_OFFSET + 0xa4);
  const storedChecksum = u16be(buf, MD_HEADER_OFFSET + 0x8e);
  const computed = megadriveChecksum(buf);
  return {
    magic,
    system: ascii(0x04, 16),
    name: ascii(0x20, 48),
    releaseDate: ascii(0x10, 10),
    version: ascii(0x30, 14),
    domesticRegion: ascii(0x50, 16),
    checksumStored: storedChecksum,
    checksumComputed: computed,
    checksumValid: storedChecksum === computed,
    declaredRomRange: { start: declaredStart, end: declaredEnd },
  };
}

// Trims a trailing run of a single padding byte (0x00 or 0xFF) so a padded
// container and a trimmed container can be compared on equal terms. Never
// guesses "real content": only a clear trailing run of >= RUN_MIN bytes is
// trimmed, and the trimmed byte count is recorded.
export function normalizeRom(buf) {
  const RUN_MIN = 0x400; // require a clear padding run before trimming
  const fill = buf[buf.length - 1];
  if (fill !== 0x00 && fill !== 0xff) {
    return { buffer: buf, bytes: buf, trimmedBytes: 0, paddingByte: null, sha256: sha256(buf) };
  }
  let run = 0;
  for (let i = buf.length - 1; i >= 0x200 && buf[i] === fill; i -= 1) run += 1;
  if (run < RUN_MIN) {
    return { buffer: buf, bytes: buf, trimmedBytes: 0, paddingByte: null, sha256: sha256(buf) };
  }
  let cut = buf.length - run;
  if (cut % 2) cut -= 1; // align the trimmed end down to an even offset (68000 words)
  const trimmed = buf.subarray(0, cut);
  return {
    buffer: trimmed,
    bytes: trimmed,
    trimmedBytes: buf.length - cut,
    paddingByte: fill,
    sha256: sha256(trimmed),
  };
}
