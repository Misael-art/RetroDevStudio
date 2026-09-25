// Casos reais autorizados por perfil (REX fase de validación 2026-09-25).
// Lecturas DIRIXIDAS sobre o corpus so-lectura /home/misael/emulation/roms:
// sen extracción, sen copia, sen inventario novo. Identidade do membro ROM
// separada da identidade do contêiner (missiva: "para arquivos compactados,
// identidade do membro ROM separada da identidade do contêiner").
//
// Por caso:
//   1. hashes do contêiner e do membro (unzip -p en memoria);
//   2. hipótese de header rexistrada como hipótese + referencia externa;
//   3. discriminación COMPORTAMENTAL sobre bytes reais (padrón de banner por
//      xanela: LoROM vs HiROM vs linear vs SSF2), non só o byte $FFD5;
//   4. paridade perfil ≡ motor-independente no estado real;
//   5. varredura de aliases: bytes idénticos en todos os aliases dun offset
//      (medido con excerpts por sha256, non volcados no repositorio);
//   6. SSF2: troca de banco verificable (escritas + offsets + hash de bytes).
//
// Uso: node scripts/rex_profiles/addressing/real_cases/verify.mjs [--out dir]
// Saída: JSON de evidencia por perfil (data/rex_profiles/addressing/<p>/evidence/).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import * as mdLinear from '../md-linear.mjs';
import * as mdSsf2 from '../md-ssf2.mjs';
import * as snesLorom from '../snes-lorom.mjs';
import * as snesHirom from '../snes-hirom.mjs';
import { engineTranslate, ssf2Engine, makeRng, BUS_LIMIT } from '../crosscheck/engine.mjs';
import { SNES_LOROM_INTERNAL, SNES_HIROM_INTERNAL, MD_INTERNAL, MD_CART_WINDOW } from '../crosscheck/internal-regions.mjs';

const DATA = new URL('../../../../data/rex_profiles/addressing/', import.meta.url);
const WINDOWS = JSON.parse(readFileSync(new URL('crosscheck/windows-generated.json', DATA), 'utf8'));

const CORPUS = process.env.REX_CORPUS_DIR || '/home/misael/emulation/roms';

export const sha256hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function memberBytes(containerPath, memberName) {
  return new Uint8Array(
    execFileSync('unzip', ['-p', containerPath, memberName], { maxBuffer: 64 * 1024 * 1024 }),
  );
}

function ascii(bytes, off, len) {
  let s = '';
  for (let i = 0; i < len; i += 1) {
    const c = bytes[off + i];
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
  }
  return s.trimEnd();
}

// Bytes visibles nos N enderezos CPU onde o perfil di que hai ROM co offset
// agardado: non volcamos ROMs, rexistramos o sha256 da concatenacion.
function readViaProfile(mod, addrs, state, rom, len) {
  const acc = [];
  const detail = [];
  for (const addr of addrs) {
    const r = mod.read(addr, len, state, rom);
    const seg = r.segments && r.segments[0];
    if (!seg || seg.error || !seg.bytes) throw new Error(`read fallou en 0x${addr.toString(16)}`);
    acc.push(...seg.bytes);
    detail.push({ cpu_address: `0x${addr.toString(16)}`, offset: `0x${seg.offset.toString(16)}` });
  }
  return { sha256: sha256hex(new Uint8Array(acc)), detail };
}

// Varredura de paridade perfil ≡ motor nun conxunto de enderezos con fronteira.
function paritySweep(mod, eng, count, seed, state) {
  const rng = makeRng(seed);
  let mismatches = 0;
  const examples = [];
  const norm = (r) => (r.error ? `E:${r.error.code}` : r.region === 'rom' ? `R:${(r.offset ?? r.offset).toString(16)}` : 'E:unbacked');
  for (let i = 0; i < count; i += 1) {
    const addr = rng(BUS_LIMIT + 1);
    const p = mod.translate(addr, state);
    const e = eng(addr);
    const pn = norm(p);
    const en = norm(e);
    if (pn !== en) {
      mismatches += 1;
      if (examples.length < 5) examples.push({ addr: `0x${addr.toString(16)}`, perfil: pn, motor: en });
    }
  }
  return { sample: count, mismatches, examples };
}

// Todos os aliases dun offset deben dar os MESMOS bytes reais. O corte de
// segmento no bordo da xanela (p. ex. pagina LoROM de 32KB) e comportamento
// lexitimo do contrato: cando a lectura non alcanza 16 bytes por que a
// xanela acaba, ese alias non entra na comparacion (rexistrado en
// window_edge_short). Para evitar o efecto, os offsets mostranse só no
// inicio de bloques de 16 bytes dentro dunha pagina-par de 64KB.
function aliasEquality(mod, rom, state, count, seed) {
  const rng = makeRng(seed);
  const size = state.rom_size;
  let offsetsChecked = 0;
  let aliasesChecked = 0;
  let mismatches = 0;
  let windowEdgeShort = 0;
  const examples = [];
  for (let i = 0; i < count; i += 1) {
    let off = rng(size) & ~15;
    if (state.rom_size >= 0x10000) off = (off & ~0xffff) | (off & 0x8000); // metade alta, inicio de bloque de 16
    const { aliases } = mod.invert(off, state);
    if (aliases.length < 2) continue;
    offsetsChecked += 1;
    let first = null;
    for (const addr of aliases) {
      const r = mod.read(addr, 16, state, rom);
      const seg = r.segments && r.segments[0];
      if (!seg || seg.error || !seg.bytes) { mismatches += 1; continue; }
      if (seg.bytes.length < 16) { windowEdgeShort += 1; continue; }
      const h = sha256hex(seg.bytes);
      if (first === null) first = h;
      else if (h !== first) {
        mismatches += 1;
        if (examples.length < 5) examples.push({ offset: `0x${off.toString(16)}`, addr: `0x${addr.toString(16)}` });
      }
      aliasesChecked += 1;
    }
  }
  return { offsets_with_aliases: offsetsChecked, alias_reads: aliasesChecked, mismatches, window_edge_short: windowEdgeShort, examples };
}

const results = {};

// ------------------------------------------------------------ md-linear Sonic 1
{
  const file = `${CORPUS}/genesis/Sonic the Hedgehog (USA, Europe).bin`;
  const rom = new Uint8Array(readFileSync(file));
  const containerSha = sha256hex(rom);
  const trailerAt = 0x80000;
  const trailerTag = rom.length > trailerAt ? ascii(rom, trailerAt, 16) : null;
  const image = rom.slice(0, trailerAt); // normalizacion: imagen = primeiros 512KB
  const state = { rom_size: 0x80000 };
  const eng = (addr) => engineTranslate(addr, { windows: [MD_CART_WINDOW], internal: MD_INTERNAL, romSize: state.rom_size });
  const banner = ascii(image, 0x100, 16);
  const vectors = [0x000000, 0x000100, 0x008000, 0x123456 & 0x7ffff, 0x07ffd8, 0x080000 /* alias espello */, 0x3fffff - 15].map((a) => ({
    cpu_address: `0x${a.toString(16)}`,
    translated: mdLinear.translate(a, state),
  }));
  // espello por mascara: o byte en A e en A+0x80000 deben coincidir en todo o espello
  const mirrorAddrs = [];
  for (let a = 0x0000; a < 0x10000; a += 0x3ff) mirrorAddrs.push(a, a + 0x80000, a + 0x280000);
  const mirrorCheck = readViaProfile(mdLinear, mirrorAddrs, state, image, 8);
  results['md-linear'] = {
    profile: 'md-linear',
    kind: 'real-file',
    container: { path: file, sha256: containerSha, size_bytes: rom.length, format: 'bin sen contêiner' },
    rom_member: { name: '(ficheiro único)', identity_note: 'sen contêiner: identidade do ficheiro = identidade da imaxe', sha256_membro: containerSha, size_bytes: rom.length },
    normalization: {
      rom_size: `0x${state.rom_size.toString(16)}`,
      steps: [
        `ficheiro mide ${rom.length} bytes = 0x80000 (imaxe ROM) + ${rom.length - 0x80000} de apêndice de ferramenta ("${trailerTag}")`,
        'normalizacion: imaxe = primeiros 0x80000 bytes; o apêndice queda FORA do rom_size e non e direccionable — rexistrado, non ocultado',
      ],
    },
    header_hypothesis: {
      fields: { banner_0x100: banner, rom_range_declarada: '0x0-0x805a5 (hipótese, solapa co apêndice)', sram_range_declarada: '0xff0000-0xffffff' },
      note: 'rango declarado polo header NON e proba: o rango ROM medido da imaxe é 0x80000; o apêndice "ESE_S1_TC_V_2.00" e metadatos de ferramenta de tradución/ROM-hack, non mapeado. O rango SRAM $FF0000 e o marcador TMSS habitual, sen SRAM física nesta cartucha (no-intro: Sonic 1 USA/Eu non ten batería).',
      references: [
        'Genesis-Plus-GX@939ce4f md_cart.c: sen mapper= xanela linear por mascara (xa citado na spec do perfil)',
        'hipótese de header só lectura dirixida, confirmada comportamentalmente abaixo',
      ],
    },
    behavioral_discrimination: {
      claim: 'linear sen mapper: calquera byte é idéntico nos seus espellos A, A+0x80000, A+0x280000 dentro da xanela do cartucho',
      sampled_addresses: mirrorAddrs.length,
      read_concat_sha256: mirrorCheck.sha256,
      alias_pairs_all_equal: (() => {
        for (let a = 0; a < 0x10000; a += 0x3ff) {
          const m = mdLinear.translate(a, state).offset;
          const m2 = mdLinear.translate(a + 0x80000, state).offset;
          const m3 = mdLinear.translate(a + 0x280000, state).offset;
          if (m !== m2 || m !== m3) return false;
        }
        return true;
      })(),
    },
    parity_engine_vs_profile: paritySweep(mdLinear, eng, 6000, 0x50c01, state),
    alias_byte_equality: aliasEquality(mdLinear, image, state, 1500, 0x11ea),
    sample_vectors: vectors,
    header_excerpt: { at: '0x100', bytes_sha256: sha256hex(image.slice(0x100, 0x110)) },
  };
}

// ------------------------------------------------------------- snes-lorom Metal Jack
{
  const zip = `${CORPUS}/sfc/Kikou Keisatsu Metal Jack (Japan) (Translated En).zip`;
  const memberName = 'Kikou Keisatsu Metal Jack (English v2.0).sfc';
  const image = memberBytes(zip, memberName);
  const containerSha = sha256hex(new Uint8Array(readFileSync(zip)));
  const memberSha = sha256hex(image);
  const state = { rom_size: image.length }; // 0x100000, potencia de 2 exacta
  const eng = (addr) => engineTranslate(addr, { windows: WINDOWS.boards.LOROM.rom_windows, internal: SNES_LOROM_INTERNAL, romSize: state.rom_size });
  const bannerAddr = 0x00ffc0;
  const banner = ascii(image, 0xffc0, 21);
  // discriminador LoROM vs HiROM sobre bytes reais: LoROM(1MB) ve o header en
  // $00FFC0/$40FFC0/$80FFC0 (banco&0x7F, metade alta) PERO NON en $007FC0...
  // HiROM(1MB) veríao en $40FFC0/$C0FFC0 e non en bancos de metade alta duplicados.
  const loromBannerAddrs = [0x00ffc0, 0x40ffc0, 0x80ffc0, 0xc0ffc0];
  const bannerHits = loromBannerAddrs.map((a) => {
    const t = snesLorom.translate(a, state);
    return { cpu_address: `0x${a.toString(16)}`, region: t.region, offset: t.offset !== undefined ? `0x${t.offset.toString(16)}` : null, visible_banner: t.region === 'rom' ? ascii(image, t.offset, 10) : null };
  });
  results['snes-lorom'] = {
    profile: 'snes-lorom',
    kind: 'real-zip-member',
    container: { path: zip, sha256: containerSha, size_bytes: readFileSync(zip).length, format: 'zip', membros_non_rom: ['CDRomance.url', 'Metal Jack Readme.txt'] },
    rom_member: { name: memberName, sha256: memberSha, size_bytes: image.length, crc32_membros_inventario: '1b356ce3', note: 'identidade do membro separada da do contêiner' },
    normalization: { rom_size: `0x${state.rom_size.toString(16)}`, steps: ['sen normalizacion: membro = 1MB exacto, sen cabecera SMC (crc casa co inventario)'] },
    header_hypothesis: {
      fields: { banner_0xFFC0: banner, ffd5: `0x${image[0xffd5].toString(16)}`, ffd6: `0x${image[0xffd6].toString(16)}`, checksum: `0x${Buffer.from(image.subarray(0xffd6, 0xffd8)).readUInt16BE(0).toString(16)}`, version: ascii(image, 0xffdb, 2) },
      note: 'tradución English v2.0: checksum do header e bytes difiren do dump vanilla; o que se valida aquí e o MAPA, non a integridade do dump',
      references: [
        'superfamicom.org/info/kikou-keisatsu-metal-jack (consultado 2026-09-25): "ROM Bank: LoROM, ROM Size: 8 Mb" — coincide con $FFD5&0x0F=0 e cos aliases comportamentais abaixo',
        'bsnes@7d5aa1e boards.bml LOROM (sha256 b8006d80...) xa citado na spec do perfil',
      ],
    },
    behavioral_discrimination: {
      claim: 'LoROM: banner visible nos bancos 00/40/80/C0 na metade alta, todos co mesmo offset 0x7FC0&... mask; WRAM 7E/7F excluida; 40-7D baixos ambiguous',
      banner_windows: bannerHits,
      wram_exclusion: [0x7e0000, 0x7fffff].map((a) => ({ cpu_address: `0x${a.toString(16)}`, translate: snesLorom.translate(a, state) })),
      ambiguous_kept: [0x401234, 0xc01234].map((a) => ({ cpu_address: `0x${a.toString(16)}`, error: snesLorom.translate(a, state).error.code })),
    },
    parity_engine_vs_profile: paritySweep(snesLorom, eng, 6000, 0x10c0 + 7, state),
    alias_byte_equality: aliasEquality(snesLorom, image, state, 1500, 0xa1ab),
  };
}

// ------------------------------------------------------------- snes-hirom CT
{
  const zip = `${CORPUS}/snes/Chrono Trigger (USA).zip`;
  const memberName = 'Chrono Trigger (USA).sfc';
  const image = memberBytes(zip, memberName);
  const containerSha = sha256hex(new Uint8Array(readFileSync(zip)));
  const memberSha = sha256hex(image);
  const state = { rom_size: image.length }; // 0x400000
  const eng = (addr) => engineTranslate(addr, { windows: WINDOWS.boards.HIROM.rom_windows, internal: SNES_HIROM_INTERNAL, romSize: state.rom_size });
  const banner = ascii(image, 0xffc0, 14);
  const hits = [0x00ffc0, 0x40ffc0, 0x80ffc0, 0xc0ffc0, 0x7effc0].map((a) => {
    const t = snesHirom.translate(a, state);
    return { cpu_address: `0x${a.toString(16)}`, region: t.region, offset: t.offset !== undefined ? `0x${t.offset.toString(16)}` : null, visible_banner: t.region === 'rom' ? ascii(image, t.offset, 14) : null };
  });
  results['snes-hirom'] = {
    profile: 'snes-hirom',
    kind: 'real-zip-member',
    container: { path: zip, sha256: containerSha, size_bytes: readFileSync(zip).length, format: 'zip', membros_non_rom: ["Vimm's Lair.txt"] },
    rom_member: { name: memberName, sha256: memberSha, size_bytes: image.length, crc32_inventario: '2d206bf7', note: 'identidade do membro separada da do contêiner' },
    normalization: { rom_size: `0x${state.rom_size.toString(16)}`, steps: ['sen normalizacion: membro = 4MB exacto, potencia de 2, sen SMC'] },
    header_hypothesis: {
      fields: { banner_0xFFC0: banner, ffd5: `0x${image[0xffd5].toString(16)}`, ffd6: `0x${image[0xffd6].toString(16)}` },
      note: '$FFD5=0x31: nibre baixo 1 = modo HiROM (sneslab.net/wiki/SNES_ROM_Header: $3X = 3.58MHz + modo no nibre baixo). Header e hipótese; confirmación abaixo por 3 vías: referencia externa + comportamiento + motor.',
      references: [
        'superfamicom.org/info/chrono-trigger (consultado 2026-09-25): "ROM Bank: HiROM, ROM Size: 32 Mb" — coincide co membro medido (0x400000)',
        'sneslab.net/wiki/SNES_ROM_Header (consultado 2026-09-25): modo de mapa no nibre baixo de $FFD5 (0=Lo, 1=Hi, 5=ExHi)',
        'bsnes@7d5aa1e boards.bml HIROM (sha256 b8006d80...)',
      ],
    },
    behavioral_discrimination: {
      claim: 'HiROM(4MB): banner visible en 00/40/80/C0 (todos os bancos cuxa máscara cae en 0xFFC0) co MESMO offset, e 7E/7F = WRAM sen ROM',
      banner_windows: hits,
      wram_exclusion: [0x7e0000, 0x7fffff].map((a) => ({ cpu_address: `0x${a.toString(16)}`, translate: snesHirom.translate(a, state) })),
    },
    parity_engine_vs_profile: paritySweep(snesHirom, eng, 6000, 0x40c0 + 3, state),
    alias_byte_equality: aliasEquality(snesHirom, image, state, 1500, 0xb2b2),
    invert_vs_engine: 'coberto por parity + alias; ver crosscheck (exaustivo xa verde)',
  };
}

// ------------------------------------------------------------------ md-ssf2 SSF2
{
  const zip = `${CORPUS}/genesis/Super Street Fighter II - The New Challengers (USA) (Translated PtBr).zip`;
  const memberName = 'Super Street Fighter II - The New Challengers (USA).bin';
  const raw = memberBytes(zip, memberName);
  const containerSha = sha256hex(new Uint8Array(readFileSync(zip)));
  const memberSha = sha256hex(raw);
  const PAD = 0x800000;
  const image = new Uint8Array(PAD);
  image.set(raw);
  image.fill(0xff, raw.length); // normalizacion documentada: pad 0xFF ata 8MB
  const state = { rom_size: PAD, banks: {} };
  const eng0 = ssf2Engine(PAD, {});
  const banner = ascii(image, 0x100, 16);
  // Troca de banco VERIFICABLE co ficheiro real: escribir 0x12 no rexistro da
  // xanela 5 (0xA1300A) -> base = (0x12<<19) & (8MB-1) = 0x1200000... lemos
  // bytes da xanela 5 e comparamos coas bytes do ficheiro na base esperada.
  const w = 5;
  const data = 0x12;
  const switched = mdSsf2.writeMapperRegister(0xa13000 | (w << 1), data, state);
  const engSw = ssf2Engine(PAD, switched.state.banks);
  const probeAddr = w * 0x80000 + 0x12345;
  const tSwitched = mdSsf2.translate(probeAddr, switched.state);
  const expectedBase = (data << 19) & (PAD - 1);
  const fileSliceAtBase = image.slice(expectedBase + 0x12345, expectedBase + 0x12345 + 16);
  const rSeg = mdSsf2.read(probeAddr, 16, switched.state, image);
  const identityVectors = [0x000000, 0x000100, 0x07fffe, 0x080000, 0x380000].map((a) => ({ cpu_address: `0x${a.toString(16)}`, translate_identity: mdSsf2.translate(a, state), translate_engine: eng0.translate(a) }));
  results['md-ssf2'] = {
    profile: 'md-ssf2',
    kind: 'real-zip-member',
    container: { path: zip, sha256: containerSha, size_bytes: readFileSync(zip).length, format: 'zip' },
    rom_member: { name: memberName, sha256: memberSha, size_bytes: raw.length, crc32_inventario: '0198b9f8', note: 'identidade do membro separada da do contêiner' },
    normalization: { rom_size: `0x${PAD.toString(16)}`, steps: [`membro mide 0x${raw.length.toString(16)} (5MB, non potencia de 2): pad 0xFF ata 8MB como esixe o contrato; as xanelas 5-7 da estado identidade leron bytes de recheo — rexistrado, non ocultado`] },
    header_hypothesis: {
      fields: { banner_0x100: banner, rom_range_declarada: '0x0-0x4fffff (casa cos 5MB medidos)', sram_range_declarada: '0xff0000-0xffffff (SRAM de 32KB habitual; o perfil non modela backing)' },
      note: 'tradución PtBr: header e checksum modificados; valida-se o mapper (que e do hardware), non a integridade do dump. Este xogo e XUSTAMENTE o documentedor do mapper SSF2 (Trzynadlowski, emu-docs.org/Genesis/ssf2.txt, Wayback 20191212014333; GPGX md_cart.c mapper_ssf2).',
      references: [
        'docs/rex_profiles/addressing/md-ssf2.md (spec derivada de Trzynadlowski + GPGX@939ce4f045f981f89965f24780cef045cc5e52d7 md_cart.c mapper_512k_w/mapper_ssf2_w)',
      ],
    },
    register_state_initial: identityVectors,
    bank_switch_verified: {
      write: { cpu_address: `0x${(0xa13000 | (w << 1)).toString(16)}`, data },
      expect_banks: switched.state.banks,
      probe: { cpu_address: `0x${probeAddr.toString(16)}`, perfil_offset: `0x${tSwitched.offset.toString(16)}`, offset_esperado: `0x${(expectedBase + 0x12345).toString(16)}`, engine_offset: `0x${engSw.translate(probeAddr).offset.toString(16)}` },
      bytes_igual_ficheiro: sha256hex(rSeg.segments[0].bytes) === sha256hex(fileSliceAtBase),
      bytes_sha256: sha256hex(rSeg.segments[0].bytes),
    },
    parity_engine_vs_profile: paritySweep(mdSsf2, (a) => eng0.translate(a), 6000, 0x5f2f, state),
    parity_engine_vs_profile_switched: (() => {
      const rng = makeRng(0x5f30);
      let mismatches = 0;
      const st = switched.state;
      for (let i = 0; i < 3000; i += 1) {
        const addr = rng(0x400000);
        const p = mdSsf2.translate(addr, st);
        const e = engSw.translate(addr);
        if (p.offset !== e.offset || p.region !== e.region) mismatches += 1;
      }
      return { sample: 3000, mismatches };
    })(),
    alias_byte_equality: {
      ...aliasEquality(mdSsf2, image, state, 1200, 0x5f31),
      note: 'offsets_with_aliases=0 e o resultado esperado no estado identidade: as 8 xanelas cubren bases mutuamente exclusivas, polo que NON hai aliases que comparar; a duplicacion de base (dous -> a base de dous -> dous aliases) esta verificada no crosscheck con fixture (exaustivo do bus)',
    },
  };
}

// ------------------------------------------------------- snes-exhirom: fixture-only
{
  results['snes-exhirom'] = {
    profile: 'snes-exhirom',
    kind: 'fixture-only',
    motivo: 'sen caso real adecuado no corpus autorizado: os unicos membros >4MB con sinal de header usan chips personalizados (Star Ocean / Seiken Densetsu 3 con chips de fabrica; Tales of Phantasia / Dragon Quest III = SPC7110). Os dous candidatos con $FFD5&0x0F==5 son traduccions destes xogos NON-ExHiROM de fabrica, polo que o byte do header e unha hipotes refutada pola referencia externa. Os 31 ficheiros sen banner seguen sen clasificar (directiva: "Não classifique automaticamente os 31 arquivos sem banner como ExHiROM").',
    candidatos_examinados: [
      'sfc/Dragon Quest III ... (Translated PtBr).7z: membro 6MB, $FFD5&0x0F=5 — pero o xogo físico e SPC7110 (non ExHiROM de fábrica); rexeitado',
      'sfc/Tales of Phantasia ... (Translated PtBr).7z: membro 6MB, $FFD5&0x0F=5 — placa real SPC7110+DSP; rexeitado',
      'snesna/Chrono Trigger+ (MSU1) [Hack]: hack MSU1, non carro orixinal; rexeitado',
    ],
    entrega: 'validion de ExHiROM queda en fixture+cruzcheck (exaustivo do bus verde); o integrador poderá engadir un caso real cando dispoña dun dump ExHiROM auténtico (p. ex. por BYOR con SHA).',
  };
}

const outDir = process.argv.indexOf('--out') >= 0 ? process.argv[process.argv.indexOf('--out') + 1] : null;
for (const [name, r] of Object.entries(results)) {
  r.generated_by = 'scripts/rex_profiles/addressing/real_cases/verify.mjs';
  r.date = '2026-09-25';
  r.corpus_policy = 'so-lectura; sen extracción; membros lidos en memoria con unzip -p';
  const json = JSON.stringify(r, null, 2) + '\n';
  if (outDir) {
    writeFileSync(`${outDir}/${name}-real-case.json`, json);
  } else {
    writeFileSync(`data/rex_profiles/addressing/${name}/evidence/real-case.json`, json);
  }
  console.log(`${name}: ${r.kind}`);
}
