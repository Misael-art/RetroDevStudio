// Phase 1: driver *identity* discovery, from in-ROM self-declared banners only.
//
// Why this exists: attributing a sound driver from the game's name, its
// franchise, or a secondary game->driver table is not evidence. This tool only
// reports what the ROM bytes themselves declare, and it treats a short ASCII
// fragment as a candidate rather than a conclusion, because Portuguese
// translations and credit screens produce the same words by accident
// (verified in this corpus: "ACHE MAIS GEMS" in a menu string, staff credits
// containing "GEMS", story text containing "Ancient").
//
// Read-only BYOR tooling. Never executes ROM bytes, never writes to the corpus.

import { readRomFile, sha256, parseMdHeader, normalizeRom } from "./lib.mjs";

export const IDENTIFY_VERSION = "rex-corpus-c-identify/1";

// A banner must be long enough to carry structure. Short runs are recorded as
// fragments and never used for identification on their own.
export const MIN_BANNER_CHARS = 24;

// Driver families whose *declaration* is a documented string, with the source
// that pins the declaration. The regexes match the banner text, not the game.
export const FAMILY_PATTERNS = [
  {
    family: "ancient-music-driver",
    // "Ancient Music   Driver -MD-     68000 Program       Version 1.06"
    test: (t) => /Ancient\s+Music\s*Driver/i.test(t),
    version: (t) => /Version\s*([0-9]+\.[0-9]+)/i.exec(t)?.[1] ?? null,
    copyright: (t) => /(19[89][0-9]|20[0-9][0-9])/.exec(t)?.[1] ?? null,
    pinned_source:
      "in-ROM banner; corroborated by https://vgmpf.com/Wiki/index.php?title=Mega_Drive/Genesis_Sound_Driver_List (secondary)",
  },
  {
    family: "mucom-md",
    // "  MUSIC DRIVER  Mucom-MD Ver0.85Programmed by ... T.Maruyama(M.N.M Software)"
    test: (t) => /Mucom[-\s]?MD/i.test(t),
    version: (t) => /Ver\s*([0-9]+\.[0-9]+)/i.exec(t)?.[1] ?? null,
    copyright: () => null,
    pinned_source:
      "in-ROM banner; corroborated by https://vgmpf.com/Wiki/index.php?title=Mega_Drive/Genesis_Sound_Driver_List (secondary)",
  },
  {
    family: "smps",
    // Sega's own SMPS builds stamp "SMPS 68000 Type 1b" / "Sound-Source" style
    // banners; none of those appear in this corpus, so this stays unproven here.
    test: (t) => /\bSMPS\b/i.test(t) || /Sound[-\s]?Sou?rce/i.test(t),
    version: (t) => /Type\s*([0-9][A-Za-z0-9]*)/i.exec(t)?.[1] ?? null,
    copyright: () => null,
    pinned_source: "https://web.archive.org/web/2024/https://segaretro.org/SMPS",
  },
  {
    family: "gems",
    // Only a full banner counts, never the bare word "GEMS".
    test: (t) => /GEMS.*(All\s+Rights\s+Reserved|driver)/i.test(t),
    version: (t) => /GEMS\s*(?:Ver\.?|Version\s*)([0-9.]+)/i.exec(t)?.[1] ?? null,
    copyright: () => null,
    pinned_source: "https://web.archive.org/web/2024/https://segaretro.org/GEMS",
  },
];

// Maximal runs of printable ASCII (space included) at or above MIN_BANNER_CHARS.
export function asciiRuns(buf, { min = MIN_BANNER_CHARS, limit = buf.length } = {}) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < limit; i += 1) {
    const b = buf[i];
    const printable = b === 0x20 || (b >= 0x21 && b <= 0x7e) || b === 0x0d || b === 0x0a;
    if (printable) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start >= min) runs.push({ offset: start, length: i - start });
      start = -1;
    }
  }
  if (start !== -1 && limit - start >= min) runs.push({ offset: start, length: limit - start });
  return runs;
}

// Merge adjacent/overlapping scan windows so a banner split across two reads is
// still seen whole.
export function coalesce(runs, { min = MIN_BANNER_CHARS, overlap = 8 } = {}) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r.offset - (last.offset + last.length) <= overlap) {
      last.length = Math.max(last.length, r.offset + r.length - last.offset);
    } else {
      out.push({ ...r });
    }
  }
  return out.filter((r) => r.length >= min);
}

export function classifyRun(buf, run) {
  const text = buf.subarray(run.offset, run.offset + run.length).toString("latin1");
  const matches = [];
  for (const p of FAMILY_PATTERNS) {
    if (!p.test(text)) continue;
    matches.push({
      family: p.family,
      offset: run.offset,
      declared_text: text.replace(/\s+/g, " ").trim().slice(0, 160),
      declared_version: p.version(text),
      declared_year: p.copyright(text),
      evidence_sha256: sha256(buf.subarray(run.offset, run.offset + run.length)),
      pinned_source: p.pinned_source,
    });
  }
  return { matches, text_length: run.length };
}

// Bounded scan: `maxBytes` and `window` keep work finite; the scan is reported
// as truncated when it does not cover the whole ROM.
export function identifyDriver(buf, { maxBytes = 8 * 1024 * 1024, window = 0x10000, stride = 0x8000 } = {}) {
  const scanEnd = Math.min(buf.length, maxBytes);
  const all = [];
  let truncated = false;
  for (let base = 0; base < scanEnd; base += stride) {
    const hi = Math.min(scanEnd, base + window);
    if (base + window >= scanEnd && hi < buf.length) truncated = true;
    const slice = buf.subarray(base, hi);
    const runs = coalesce(asciiRuns(slice).map((r) => ({ offset: r.offset + base, length: r.length })));
    for (const run of runs) {
      const { matches } = classifyRun(buf, run);
      for (const m of matches) all.push(m);
    }
    if (hi >= scanEnd) break;
  }
  // De-duplicate: the same banner can be reached from two overlapping windows.
  const seen = new Set();
  const unique = all.filter((m) => {
    const k = `${m.family}@0x${m.offset.toString(16)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { matches: unique, scanned_bytes: scanEnd, truncated };
}

export function analyzeRomFile(p, opts = {}) {
  const raw = readRomFile(p);
  const header = parseMdHeader(raw);
  const norm = normalizeRom(raw);
  const { matches, scanned_bytes, truncated } = identifyDriver(raw, opts);
  return {
    schema: IDENTIFY_VERSION,
    source_path: p,
    rom_sha256: sha256(raw),
    normalized_sha256: norm.sha256,
    rom_size: raw.length,
    normalized_trimmed_bytes: norm.trimmedBytes,
    header: {
      name: header.name,
      version: header.version,
      releaseDate: header.releaseDate,
      domesticRegion: header.domesticRegion,
      checksum_stored: header.checksumStored,
      checksum_computed: header.checksumComputed,
      checksum_valid: header.checksumValid,
      declared_rom_range: header.declaredRomRange,
    },
    driver_matches: matches,
    scan: { scanned_bytes, truncated },
    limitations: [
      "identifies only what the ROM declares as ASCII text in the 68000 address space",
      "compressed or Z80-only banners are not visible to this scan",
      "no sequence, instrument or sample data is interpreted here",
    ],
  };
}
