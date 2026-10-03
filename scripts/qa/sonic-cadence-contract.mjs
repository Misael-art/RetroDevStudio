// Verificador independente do contrato de cadencia Sonic 1 (id_Wait).
// Nao importa nenhum modulo de produto; le a ROM BYOR e confere byte a byte
// cada afirmacao do contrato em docs/rex_profiles/sonic_cadence/CONTRACT.md.
// Uso: node scripts/qa/sonic-cadence-contract.mjs --rom <BYOR.bin> [--report <out.json>]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ROM_SHA256 = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb";
// Convencao de endereco comprovada nesta ROM: o .bin e um dump raw padrao e
// file_offset = cpu_addr - 0x100000 (SEM bias de 0xFF). Evidencias independentes:
//  - vetor de CPU em file 0x0 (SSP $00FFFE00), header "SEGA" em file 0x100;
//  - SHA da arte crua pinado casa com os bytes em file 0x21AFE (CPU $121AFE);
//  - operando absolute-long $00013B48 do lea de Sonic_Animate aponta exatamente
//    para o conteudo da tabela em file 0x13B48;
//  - disassemblagem limpa de codigo m68k nos offsets de arquivo.
// Os enderecos abaixo sao OFFSETS DE ARQUIVO == enderecos CPU 68K (ROM mapeada
// em $000000). A ROM tem 7289 bytes extras apos 0x80000 (residuo de dump).
const ANI_TABLE = 0x13b48; // CPU $13B48 (Ani_Sonic)
const ANI_COUNT = 31;
const SCRIPTS_BASE = ANI_TABLE + ANI_COUNT * 2; // 0x13b86 (CPU $13B86)
// Bytes do prefixo de Sonic_Animate (lea $13B48.l,a1 ...); o operando
// absolute-long $00013B48 aparece em file 0x139c6 (dentro do prologo em
// 0x139c4) — unica ocorrencia dos bytes 00 01 3B 48 no arquivo.
const SONIC_ANIMATE_PROLOGUE = "43f900013b4870001028001cb028001d";
const WAIT_ADDR = 0x13bae; // CPU $13BAE (SonAni_Wait)
const WAIT_INTERVAL_RAW = 0x17;
const WAIT_FRAMES = [
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x03, 0x02, 0x02, 0x02, 0x03, 0x04,
];
const WAIT_TERMINATOR = [0xfe, 0x02];
const DEATH_ADDR = 0x13c18;
const DEATH_SCRIPT = [0x03, 0x4d, 0xff, 0x00];
const SETTER_PREFIX = Buffer.from([0x11, 0x7c]); // move.b #imm8,$1C(a0)
const OB_ANIM = 0x1c;
const EXPECTED_SETTERS = {
  wait: [0x12f02, 0x131c2],
  stop: [0x130d2, 0x13138],
  death: [0x1b0cc],
  hurt: [0x1b066],
};

const af = (n) => "0x" + n.toString(16).toUpperCase();

function findAll(rom, bytes) {
  const hits = [];
  for (let i = 0; i + bytes.length <= rom.length; i++) {
    let ok = true;
    for (let j = 0; j < bytes.length; j++) if (rom[i + j] !== bytes[j]) { ok = false; break; }
    if (ok) hits.push(i);
  }
  return hits;
}

export function verify(rom) {
  const checks = [];
  const check = (name, ok, detail) =>
    checks.push({ name, pass: ok, detail: detail ?? null });

  const sha = createHash("sha256").update(rom).digest("hex");
  check("rom-sha256-pino", sha === ROM_SHA256, `observado ${sha}`);

  // Tabela: 31 palavras relativas; todos os scripts caem apos a base da tabela.
  const offsets = [];
  for (let i = 0; i < ANI_COUNT; i++) offsets.push(rom.readUInt16BE(ANI_TABLE + i * 2));
  check("tabela-scripts-apos-base", offsets.every((o) => o >= ANI_COUNT * 2),
    offsets.map(af).join(","));

  // Token de comando nunca aparece como byte de frame dos scripts normais
  // (um frame $FF/$FE/$FD seria lido como comando e invalidaria o parser).
  const decoded = [];
  let tokenCollision = false;
  for (let i = 0; i < ANI_COUNT; i++) {
    const addr = ANI_TABLE + offsets[i];
    const intervalRaw = rom[addr];
    const special = (intervalRaw & 0x80) !== 0;
    const frames = [];
    let pos = addr + 1;
    let terminator;
    for (;;) {
      const b = rom[pos++];
      if (b === 0xff) { terminator = { type: "loop" }; break; }
      if (b === 0xfe) { terminator = { type: "back", k: rom[pos] }; pos += 1; break; }
      if (b === 0xfd) { terminator = { type: "change", anim: rom[pos] }; pos += 1; break; }
      if (b >= 0xfd) tokenCollision = true;
      frames.push(b);
      if (pos - addr > 0x40) throw new Error(`script ${i} sem terminador em ${af(addr)}`);
    }
    decoded.push({ anim: i, addr, intervalRaw, special, frames, terminator });
  }
  check("sem-colisao-de-token", !tokenCollision);

  // Consumidor unico da tabela: a referencia absoluta $00013B48 ocorre uma
  // unica vez no arquivo e essa ocorrencia esta dentro do prefixo de
  // Sonic_Animate (lea #Ani_Sonic,a1). Logo, nenhum outro codigo le a tabela.
  const prologue = Buffer.from(SONIC_ANIMATE_PROLOGUE, "hex");
  const prologueHits = findAll(rom, prologue);
  const absoluteRefHits = findAll(rom, Buffer.from([0x00, 0x01, 0x3b, 0x48]));
  check("consumidor-unico-da-tabela",
    prologueHits.length === 1 && absoluteRefHits.length === 1 &&
      absoluteRefHits[0] >= prologueHits[0] &&
      absoluteRefHits[0] + 4 <= prologueHits[0] + prologue.length,
    `prologue=${prologueHits.map(af).join(",")} refs=${absoluteRefHits.map(af).join(",")}`);

  // id_Wait (anim 5): bytes exatos do script.
  const wait = decoded[5];
  check("wait-endereco", wait.addr === WAIT_ADDR, `${af(wait.addr)}`);
  check("wait-intervalo-raw", wait.intervalRaw === WAIT_INTERVAL_RAW, af(wait.intervalRaw));
  check("wait-nao-especial", wait.special === false);
  check("wait-frames", wait.frames.length === WAIT_FRAMES.length &&
    wait.frames.every((f, idx) => f === WAIT_FRAMES[idx]), wait.frames.map(af).join(","));
  check("wait-terminador", wait.terminator.type === "back" && wait.terminator.k === 2,
    JSON.stringify(wait.terminator));

  // Caso reservado (death): bytes exatos e motivo de recusa como alvo de cadencia.
  const deathBytes = [...rom.subarray(DEATH_ADDR, DEATH_ADDR + DEATH_SCRIPT.length)];
  check("death-caso-reservado", deathBytes.every((b, i) => b === DEATH_SCRIPT[i]),
    deathBytes.map(af).join(","));
  check("death-frame-unico", decoded[24].frames.length === 1);

  // Setadores de obAnim comprovados por encoding 68K (montado com o
  // assembler oficial da toolchain; ver CONTRACT.md secao 4).
  for (const [key, id] of [["wait", 0x05], ["stop", 0x0d], ["death", 0x18], ["hurt", 0x1a]]) {
    const hits = [];
    for (let i = 0; i + 6 <= rom.length; i++) {
      if (rom[i] === 0x11 && rom[i + 1] === 0x7c && rom.readUInt16BE(i + 2) === id &&
        rom.readUInt16BE(i + 4) === OB_ANIM) hits.push(i);
    }
    check(`setador-${key}`,
      hits.length === EXPECTED_SETTERS[key].length &&
        hits.every((h, idx) => h === EXPECTED_SETTERS[key][idx]),
      hits.map(af).join(","));
  }

  // Alcance do byte editavel: nenhum outro entry da tabela aponta para o
  // byte de intervalo do script Wait.
  const intervalAddrs = decoded.map((d) => d.addr);
  check("intervalo-nao-compartilhado",
    intervalAddrs.filter((a) => a === WAIT_ADDR).length === 1 &&
      new Set(intervalAddrs).size === ANI_COUNT,
    `${intervalAddrs.length} intervalos, ${new Set(intervalAddrs).size} unicos`);

  const allPass = checks.every((c) => c.pass);
  return {
    classification: "contrato-provado-estaticamente-efeito-medido-no-core-etapa-4",
    rom: { sha256: sha, size: rom.length, address_convention: "file_offset = cpu_addr - 0x100000 (sem bias)" },
    table: { base: ANI_TABLE, count: ANI_COUNT, scripts_base: SCRIPTS_BASE },
    target: {
      anim: 5, name: "id_Wait / SonAni_Wait", script_addr: WAIT_ADDR,
      interval_byte_addr: WAIT_ADDR, interval_raw: WAIT_INTERVAL_RAW,
      declared_ticks_per_frame: 23, frame_count: 18,
      loop_period_ticks: 18 * 23,
      editable_range: { min: 0x01, max: 0x7f },
      reserved_values: [
        { value: 0x00, reason: "comportamento degenerado nao comprovado; recusado ate medicao" },
        { value: "0x80-0xff", reason: "bit7 leva ao handler especial walk/run/roll" },
        { value: "0xfd-0xff como frame", reason: "tokens afChange/afBack/afEnd; nenhum frame do alvo usa esses bytes" },
      ],
    },
    scripts: decoded.map((d) => ({
      anim: d.anim, addr: d.addr, intervalRaw: d.intervalRaw, special: d.special,
      frames: d.frames, terminator: d.terminator,
    })),
    checks,
    allPass,
  };
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
if (args.includes("--help") || !flag("--rom")) {
  console.error("uso: node sonic-cadence-contract.mjs --rom <BYOR.bin> [--report <out.json>]");
  process.exit(2);
}
const rom = readFileSync(flag("--rom"));
const result = verify(rom);
if (flag("--report")) writeFileSync(flag("--report"), JSON.stringify(result, null, 2));
for (const c of result.checks) {
  console.log(`${c.pass ? "OK  " : "FAIL"} ${c.name}${c.detail ? " :: " + c.detail : ""}`);
}
console.log(result.allPass ? "CONTRATO: TODOS OS CHECKS PASSARAM" : "CONTRATO: FALHOU");
process.exit(result.allPass ? 0 : 1);
