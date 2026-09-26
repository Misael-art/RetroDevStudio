// Inventario leve de corpus autorizado (REX rodada 2026-09-25, paso 6 de la
// mision agente A). SOLO LECTURA: nunca extrae, nunca copia ROMs al disco.
// - Tier A: por archivo (ruta, tamano, sha256 en streaming, clase de formato).
// - Miembros de zip/7z listados sin extraer (unzip -l -v / 7z l -slt).
// - Tier B: primeros 0x8000 bytes del primer miembro ROM de cada zip, leidos
//   por streaming (unzip -p | head -c) — solo para senales de cabecera que
//   producen HIPOTESIS de mapa; el header no es prueba y jamas se asigna
//   mapper por extension.
// Salida: <argv2>/corpus-inventory.json (stdout si argv2 == '-')

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';

const CORPUS_ROOT = '/home/misael/emulation/roms';
const DIRS = [
  'sfc', 'snes', 'sneshd', 'snesna', 'sufami', 'satellaview',
  'genesis', 'megadrive', 'megadrivejp', 'genesiswide',
];
const ROM_INNER_EXT = new Set(['sfc', 'smc', 'bin', 'gen', 'md', 'smd', 'fig', 'swc', 'bs', 'gd', 'rom']);
const SNIFF_BYTES = 0x11000; // cubre 0x7FC0, 0x7FC0+512 (SMC), 0xFFC0 y 0xFFC0+512

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')));
  });
}

function zipMembers(path) {
  try {
    const out = execFileSync('unzip', ['-l', '-v', path], { encoding: 'latin1', maxBuffer: 32 * 1024 * 1024 });
    const rows = [];
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+[\d.]+%\s+\S+\s+\S+\s+([0-9a-fA-F]{8})\s+(.*)$/);
      if (m) rows.push({ name: m[5], uncompressed_size: Number(m[1]), method: m[2], crc32: m[4] });
    }
    return rows;
  } catch {
    return { error: 'unzip-list-failed' };
  }
}

function sevenZipMembers(path) {
  try {
    const out = execFileSync('7z', ['l', '-slt', '-ba', path], { encoding: 'latin1', maxBuffer: 32 * 1024 * 1024 });
    const rows = [];
    let cur = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('----------')) break;
      if (line.startsWith('Path = ')) cur = { name: line.slice(7).replace(/\r$/, '') };
      else if (cur && line.startsWith('Size = ')) cur.uncompressed_size = Number(line.slice(7).replace(/\r$/, '') || 0);
      else if (cur && line.startsWith('Method = ')) cur.method = line.slice(9).split(' ')[0];
      else if (cur && line.startsWith('CRC = ')) cur.crc32 = line.slice(6).replace(/\r$/, '');
      else if (cur && line.startsWith('Modified = ')) { rows.push(cur); cur = null; }
    }
    return rows.filter((r) => r.uncompressed_size > 0);
  } catch {
    return { error: '7z-list-failed' };
  }
}

// Cabecera de los primeros n bytes del miembro `name` de un zip, por streaming.
function zipPeekHead(path, name, n) {
  try {
    return execFileSync(
      'sh',
      ['-c', 'unzip -p "$1" "$2" 2>/dev/null | head -c "$3"', 'sh', path, name, String(n)],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
}

// Igual para 7z: `7z x -so` descomprime a stdout, nunca escribe en disco.
function sevenZipPeekHead(path, name, n) {
  try {
    return execFileSync(
      'sh',
      ['-c', '7z x -y -so "$1" "$2" 2>/dev/null | head -c "$3"', 'sh', path, name, String(n)],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
}

const asciiAt = (buf, off, len) => (buf.length >= off + len ? Buffer.from(buf.subarray(off, off + len)).toString('latin1') : null);
const printable = (s) => s !== null && /^[\x20-\x7e]*$/.test(s) && s.trim().length > 0;

// Senales de cabecera SNES (estilo LoROM/HiROM estandar, con o sin cabecera
// .smc de 512 bytes). Produce SOLO hipotesis; la deteccion real de mapa es
// "blocked" en todos los perfiles (ver limits de cada manifest).
function snesHeaderSignals(buf) {
  const out = [];
  for (const [label, base] of [['lo/normal', 0], ['smc +512', 512]]) {
    const romChar = asciiAt(buf, base + 0x7fc0, 21);
    const mapDev = buf.length >= base + 0x7fd5 ? buf[base + 0x7fd5] : null;
    const sum = buf.length >= base + 0x7fd8 ? buf.readUInt16BE(base + 0x7fd6) : null;
    const sizeByte = buf.length >= base + 0x7fd9 ? buf[base + 0x7fd9] : null;
    if (printable(romChar)) {
      out.push({
        window: label,
        rom_chars: romChar.replace(/\0+$/, '').trim(),
        map_bits: mapDev === null ? null : mapDev >> 4,
        device_type: mapDev === null ? null : mapDev & 0x0f,
        checksum_be: sum === null ? null : `0x${sum.toString(16).padStart(4, '0')}`,
        rom_size_code: sizeByte === null ? null : `0x${sizeByte.toString(16).padStart(2, '0')}`,
        note: 'header no es prueba; hipotesis de mapa requiere corpus-identification desbloqueado',
      });
    }
    const extChar = asciiAt(buf, base + 0xffc0, 21);
    if (buf.length >= base + 0xffe0 && printable(extChar) && !printable(romChar)) {
      out.push({
        window: `${label} (solo 0xFFC0)`,
        rom_chars: extChar.replace(/\0+$/, '').trim(),
        map_bits: buf[base + 0xffd5] >> 4,
        device_type: buf[base + 0xffd5] & 0x0f,
        checksum_be: `0x${buf.readUInt16BE(base + 0xffd6).toString(16).padStart(4, '0')}`,
        rom_size_code: `0x${buf[base + 0xffd9].toString(16).padStart(2, '0')}`,
        note: 'ventana alta presente sin espejo bajo: tipico de dumps >32KB sin modo LoROM duplicado',
      });
    }
  }
  return out;
}

// Senales de cabecera Mega Drive: "SEGA" a 0x100 con header de 512 bytes.
function mdHeaderSignals(buf) {
  const out = [];
  const consoleName = asciiAt(buf, 0x100, 16);
  if (printable(consoleName) && consoleName.trim().startsWith('SEGA')) {
    out.push({
      console: consoleName.trim(),
      copyright: (asciiAt(buf, 0x110, 14) || '').trim(),
      domestic: (asciiAt(buf, 0x120, 12) || '').trim(),
      international: (asciiAt(buf, 0x130, 12) || '').trim(),
      serial: (asciiAt(buf, 0x140, 10) || '').trim(),
      field_0x180: (asciiAt(buf, 0x180, 14) || '').trim(), // codigo de producto (p.ej. "GM 00001009-00")
      checksum: buf.length >= 0x190 ? `0x${buf.readUInt16BE(0x18e).toString(16).padStart(4, '0')}` : null,
      rom_start: buf.length >= 0x1a4 ? `0x${buf.readUInt32BE(0x1a0).toString(16)}` : null,
      rom_end: buf.length >= 0x1a8 ? `0x${buf.readUInt32BE(0x1a4).toString(16)}` : null,
      sram_start: buf.length >= 0x1ac ? `0x${buf.readUInt32BE(0x1a8).toString(16)}` : null,
      sram_end: buf.length >= 0x1b0 ? `0x${buf.readUInt32BE(0x1ac).toString(16)}` : null,
      note: 'rango ROM/SRAM declarado por el header: senal, no prueba; no implica MBD/SSF2 — la deteccion de mapa sigue blocked',
    });
  }
  return out;
}

// Clasificacion honesta de cada entrada (el inventario es ligero: la senal de
// cabecera solo se busca en la ventana de sniff; su ausencia NO prueba ExHiROM
// ni Unl, solo marca la brecha).
function classifyGap(entry) {
  if (entry.sniff && entry.sniff.length > 0) return 'header-signal';
  if (['txt', 'directory', 'bkp'].includes(entry.format) || entry.path.startsWith('.')) return 'document';
  if (entry.members && entry.members.error) return 'list-failed';
  if (entry.members) {
    const exts = new Set(entry.members.map((m) => extname(m.name).slice(1).toLowerCase()));
    if (exts.has('32x')) return 'out-of-scope-32x-cd';
    if (exts.has('nes')) return 'misplaced-other-platform';
    if (!entry.inner_rom_member) return 'no-rom-content';
    const firstRom = entry.members.find((m) => m.name === entry.inner_rom_member);
    if (firstRom.uncompressed_size < 0x8000) return 'too-small-for-sniff';
    return 'no-banner-in-sniff-window';
  }
  return 'no-signal';
}

async function main() {
  const files = [];
  for (const dir of DIRS) {
    let names;
    try {
      names = execFileSync('find', [`${CORPUS_ROOT}/${dir}`, '-type', 'f', '-printf', '%s\t%P\n'], { encoding: 'latin1', maxBuffer: 32 * 1024 * 1024 }).trim().split('\n');
    } catch {
      continue;
    }
    for (const row of names) {
      const [sizeStr, ...rest] = row.split('\t');
      const rel = rest.join('\t');
      const full = `${CORPUS_ROOT}/${dir}/${rel}`;
      const size = Number(sizeStr);
      const ext = extname(rel).slice(1).toLowerCase();
      const entry = { platform_dir: dir, path: rel, size_bytes: size, format: ext };
      if (['txt', 'directory', 'bkp'].includes(ext) || rel.startsWith('.')) {
        entry.hashes = null; // documentos: sin valor para identificacion
      } else {
        entry.sha256 = await sha256File(full);
      }
      if (ext === 'zip' || ext === '7z') {
        const members = ext === 'zip' ? zipMembers(full) : sevenZipMembers(full);
        if (members.error) {
          entry.members = members;
        } else {
          entry.members = members.map((m) => ({ name: m.name, uncompressed_size: m.uncompressed_size, method: m.method, crc32: m.crc32 }));
          const firstRom = members.find((m) => ROM_INNER_EXT.has(extname(m.name).slice(1).toLowerCase()));
          entry.inner_rom_member = firstRom ? firstRom.name : null;
          if (firstRom && firstRom.uncompressed_size >= 0x8000) {
            const head = ext === 'zip' ? zipPeekHead(full, firstRom.name, SNIFF_BYTES) : sevenZipPeekHead(full, firstRom.name, SNIFF_BYTES);
            if (head) {
              entry.sniff = ['genesis', 'megadrive', 'megadrivejp', 'genesiswide'].includes(dir)
                ? mdHeaderSignals(head)
                : snesHeaderSignals(head);
            }
          }
        }
      } else if (ext === 'bin') {
        const head = execFileSync('head', ['-c', String(SNIFF_BYTES), full]);
        entry.sniff = dir === 'genesis' || dir.startsWith('mega') ? mdHeaderSignals(head) : snesHeaderSignals(head);
      }
      entry.gap_class = classifyGap(entry);
      files.push(entry);
    }
  }
  const report = {
    contract_version: 1,
    generated_by: 'scripts/rex_profiles/addressing/inventory-corpus.mjs',
    date: '2026-09-25',
    root: CORPUS_ROOT,
    scope_dirs: DIRS,
    read_only: true,
    extraction_performed: false,
    roms_copied: false,
    policy: [
      'mapper nunca asignado por extension',
      'header tratado como hipotesis, no prueba',
      'capacidad = tamano de miembro, no mapa',
    ],
    counts: {
      files: files.length,
      archives: files.filter((f) => ['zip', '7z'].includes(f.format)).length,
      raw_roms: files.filter((f) => ['bin'].includes(f.format)).length,
      documents: files.filter((f) => f.gap_class === 'document').length,
      by_gap_class: files.reduce((acc, f) => { acc[f.gap_class] = (acc[f.gap_class] || 0) + 1; return acc; }, {}),
    },
    files,
  };
  const out = JSON.stringify(report, null, 1);
  if (process.argv[2] === '-') process.stdout.write(out);
  else process.stdout.write(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
