#!/usr/bin/env node
// Varredura SOMENTE-LEITURA do corpus BYOR: hash SHA-256 por arquivo,
// deteccao de cabecalho Mega Drive, nome interno (0x120..0x13B), soma de
// verificacao declarada (0x18E) e soma calculada. NAO escreve nada fora do
// JSON de saida; arquivos do corpus nunca sao modificados.
// Uso: node scan-corpus.mjs <dir1> [<dir2> ...] > corpus-inventory.json
import { createHash } from 'node:crypto';
import { readdirSync, openSync, readSync, closeSync, statSync, fstatSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2);
if (dirs.length === 0) { console.error('uso: scan-corpus.mjs <dir> ...'); process.exit(2); }

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p; // inventaria todos; extensao fica no proprio path
  }
}

// le no maximo `cap` bytes comfd aberto (arquivos grandes: hash em streaming,
// janela de cabecalho limitada). Retorna {buf, sha, size}.
function readCapped(p, cap) {
  const fd = openSync(p, 'r');
  try {
    const st = fstatSync(fd);
    const h = createHash('sha256');
    const chunk = Buffer.allocUnsafe(1 << 20);
    const head = Buffer.allocUnsafe(Math.min(cap, st.size));
    let off = 0, headDone = false;
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, off);
      if (n <= 0) break;
      h.update(chunk.subarray(0, n));
      if (!headDone) {
        const take = Math.min(n, head.length - off);
        if (take > 0) chunk.copy(head, off, 0, take);
        if (off + take >= head.length) headDone = true;
      }
      off += n;
      if (off >= st.size) break;
    }
    return { buf: head, sha: h.digest('hex'), size: st.size };
  } finally { closeSync(fd); }
}

function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }

function inspect(buf, size, pathForChecksum) {
  const rec = {};
  // candidatos de cabecalho: 0x000 (raw) e 0x100 (com header de 16 bytes)
  for (const base of [0x000, 0x100]) {
    if (buf.length < base + 0x100 + 0x40) continue;
    const consoleId = buf.slice(base + 0x100, base + 0x100 + 16).toString('latin1');
    if (/^SEGA (MEGA DRIVE|GENESIS)/.test(consoleId.trim())) {
      const name = buf.slice(base + 0x120, base + 0x120 + 28).toString('latin1').replace(/\0.*$/, '').trim();
      rec.header = { offset: base, console_id: consoleId.trimEnd(), internal_name: name,
                     declared_checksum: u16be(buf, base + 0x18E) };
      if (size <= 32 * 1024 * 1024) {
        const cs = checksumFile(pathForChecksum, base, size);
        rec.header.computed_checksum = cs;
        rec.header.checksum_matches = cs === rec.header.declared_checksum;
      }
      break;
    }
  }
  return rec;
}

function checksumFile(p, base, size) {
  const fd = openSync(p, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    let off = base + 0x200, sum = 0, carry = 0;
    for (;;) {
      const want = Math.min(chunk.length, size - off);
      if (want <= 0) break;
      const n = readSync(fd, chunk, 0, want, off);
      if (n <= 0) break;
      for (let i = 0; i + 1 < n; i += 2) {
        const addr = off + i;
        const word = addr === base + 0x18E ? 0 : u16be(chunk, i);
        sum += word;
      }
      carry = n & 1; // byte órfão final é somado com 0 alto; irrelevante p/ par
      off += n;
    }
    if (carry) sum += 0; // size ímpar: último byte pareado com 0x00
    return sum & 0xFFFF;
  } finally { closeSync(fd); }
}

const out = [];
for (const d of dirs) {
  for (const p of walk(d)) {
    const { buf, sha, size } = readCapped(p, 0x200);
    out.push({ path: p, dir: d, size_bytes: size, sha256: sha, ...inspect(buf, size, p) });
    process.stderr.write(`.${p} ${sha.slice(0, 8)}\n`);
  }
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
