#!/usr/bin/env node
// Bounded, read-only CLI for the Ancient Music Driver profile.
//
//   node scripts/rex_corpus_c/extract.mjs --rom <file> --profile <profile.json> [options]
//
// The ROM is opened read-only and treated as data; no ROM byte is ever
// executed. Sequence bytes are NOT included unless --include-events is passed,
// so the default output stays structural metadata safe to keep outside Git.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractAncient } from "./ancient.mjs";
import { normalizeRom, parseMdHeader, readRomFile, sha256 } from "./lib.mjs";

function parseArgs(argv) {
  const opts = { includeEvents: false, pretty: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing_value_for:${a}`);
      return argv[i];
    };
    switch (a) {
      case "--rom": opts.rom = next(); break;
      case "--profile": opts.profilePath = next(); break;
      case "--song": opts.song = Number.parseInt(next(), 10); break;
      case "--max-songs": opts.maxSongs = Number.parseInt(next(), 10); break;
      case "--max-tracks": opts.maxTracks = Number.parseInt(next(), 10); break;
      case "--max-events": opts.maxEvents = Number.parseInt(next(), 10); break;
      case "--max-bytes": opts.maxBytes = Number.parseInt(next(), 16); break;
      case "--out": opts.out = next(); break;
      case "--include-events": opts.includeEvents = true; break;
      case "--allow-identity-mismatch": opts.allowIdentityMismatch = true; break;
      case "--compact": opts.pretty = false; break;
      case "--help":
      case "-h": opts.help = true; break;
      default: throw new Error(`unknown_argument:${a}`);
    }
  }
  return opts;
}

const HELP = `Usage: extract.mjs --rom <file> --profile <profile.json> [options]
  --song N                  extract one song slot instead of a bounded prefix
  --max-songs N             song slots decoded (default 8)
  --max-tracks N            track slots per song header (default 32)
  --max-events N            events per stream (default 4096)
  --max-bytes N             stream window in hex (default 0x8000)
  --include-events          emit per-event records (off by default)
  --allow-identity-mismatch apply a profile to a ROM it was not derived from
  --out <file>              write JSON to a file instead of stdout`;

function stripEvents(result) {
  if (result.songs === undefined) return result;
  return {
    ...result,
    songs: result.songs.map((song) => ({
      ...song,
      tracks: song.tracks.map(({ events, ...rest }) => rest),
    })),
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.rom || !opts.profilePath) {
    process.stdout.write(`${HELP}\n`);
    return opts.help ? 0 : 2;
  }
  const profile = JSON.parse(readFileSync(resolve(opts.profilePath), "utf8"));
  const raw = readRomFile(resolve(opts.rom));
  const normalized = normalizeRom(raw);
  const header = parseMdHeader(raw);

  const result = extractAncient(normalized.bytes, profile, opts);
  const payload = {
    ...stripEvents(result),
    rom: {
      source_path: resolve(opts.rom),
      container_sha256: sha256(raw),
      rom_sha256: sha256(normalized.bytes),
      normalized_sha256: result.normalized_sha256,
      rom_size: raw.length,
      trimmed_padding_bytes: normalized.trimmedBytes,
      header: {
        name: header.name,
        version: header.version,
        release_date: header.releaseDate,
        checksum_valid: header.checksumValid,
      },
    },
    profile_source: resolve(opts.profilePath),
  };
  if (opts.includeEvents) payload.songs = result.songs ?? undefined;

  const text = `${JSON.stringify(payload, null, opts.pretty ? 2 : 0)}\n`;
  if (opts.out) writeFileSync(resolve(opts.out), text);
  else process.stdout.write(text);
  return result.status === "ok" ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`extract failed: ${err.message}\n`);
    process.exitCode = 1;
  }
}

export { main, parseArgs, stripEvents };
