// CLI de extracao REX Sonic 1 (MISSAO D). NAO escreve dentro do repositorio:
// saidas vao para um diretorio local fora do Git (default ~/.cache/rex-corpus-d/out),
// pois assets comerciais e imagens reconstruidas nao podem ser versionados.
// Uso: node scripts/rex_corpus_d/cli.mjs [--rom <caminho>] [--out <dir>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SONIC1_US_EU, FR } from "./profile.mjs";
import { decodePaletteLine } from "./palette.mjs";
import { composeFrame } from "./compose.mjs";
import { buildFrameRecord, buildAnimRecord } from "./chain.mjs";
import { encodePng } from "./png.mjs";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function parseArgs(argv) {
  const out = { rom: null, out: join(homedir(), ".cache", "rex-corpus-d", "out") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rom") out.rom = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
  }
  if (!out.rom) {
    for (const d of SONIC1_US_EU.search_paths) {
      const p = join(d, SONIC1_US_EU.rom.filename);
      if (existsSync(p)) { out.rom = p; break; }
    }
  }
  if (!out.rom || !existsSync(out.rom)) fail(`ROM nao encontrada (BYOR). Use --rom. Perfil exige: ${SONIC1_US_EU.rom.filename}`);
  return out;
}

function fail(msg) {
  console.error(`rex-corpus-d: ${msg}`);
  process.exit(1);
}

export function main(argv) {
  const args = parseArgs(argv);
  const rom = readFileSync(args.rom);
  if (rom.length !== SONIC1_US_EU.rom.size) fail(`tamanho ${rom.length} != esperado ${SONIC1_US_EU.rom.size}`);
  const digest = sha(rom);
  if (digest !== SONIC1_US_EU.rom.sha256) fail(`SHA-256 ${digest} != pinado ${SONIC1_US_EU.rom.sha256} — identidade de ROM diferente, abortando`);
  const P = SONIC1_US_EU;
  const palettes = [decodePaletteLine(rom, P.pal_addr, 0)];

  mkdirSync(args.out, { recursive: true });
  const manifest = {
    mission: "D — personagens remontados e animacoes rastreaveis",
    generated_at: new Date().toISOString().slice(0, 10),
    tool: "scripts/rex_corpus_d/cli.mjs",
    profile: P,
    rom_used: { path: resolve(args.rom), sha256: digest, size: rom.length },
    proof_class: "consumidor-estatico (byte patterns 68k); observacao de runtime registrada separadamente como pendencia do integrador",
    frames: {},
    animations: {},
    outputs: {},
  };

  const frames = { stand: FR.Stand, look_up: FR.LookUp, walk13: FR.Walk13, run11: FR.Run11 };
  for (const [name, id] of Object.entries(frames)) {
    const img = composeFrame({ rom, profile: P, palettes, frame: id });
    const png = encodePng(img);
    const file = `frame-${name}.png`;
    writeFileSync(join(args.out, file), png);
    manifest.frames[name] = {
      mapping_frame_id: id,
      record: buildFrameRecord({ rom, profile: P, frame: id, frameName: name, palettes }),
      png: { file, sha256: sha(png), width: img.width, height: img.height },
    };
    const flipped = composeFrame({ rom, profile: P, palettes, frame: id, globalFlip: { x: true, y: false } });
    const fpng = encodePng(flipped);
    const ffile = `frame-${name}-flipx.png`;
    writeFileSync(join(args.out, ffile), fpng);
    manifest.frames[name].flipped = { file: ffile, sha256: sha(fpng) };
  }

  // sequencia de caminhada (anim 0, script especial de 6 frames)
  const walk = buildAnimRecord({ rom, profile: P, anim: 0, ticks: 24, special: true, palettes });
  manifest.animations.walk = walk;

  // contact sheet: frames da sequencia de caminhada lado a lado (ordem de apresentacao)
  const seqFrames = [];
  const seen = [];
  const byId = new Map();
  for (const s of walk.sequence) {
    if (s.frame !== null && !byId.has(s.frame)) {
      const img = composeFrame({ rom, profile: P, palettes, frame: s.frame });
      byId.set(s.frame, img);
      seen.push(s.frame);
      seqFrames.push(img);
    }
  }
  const gapPx = 4;
  const csW = seqFrames.reduce((n, f) => n + f.width, 0) + gapPx * (seqFrames.length + 1);
  const csH = Math.max(...seqFrames.map((f) => f.height)) + gapPx * 2;
  const sheet = { width: csW, height: csH, data: new Uint8ClampedArray(csW * csH * 4) };
  let x = gapPx;
  for (const f of seqFrames) {
    for (let row = 0; row < f.height; row++) {
      for (let col = 0; col < f.width; col++) {
        const s = (row * f.width + col) * 4;
        if (f.data[s + 3] === 0) continue;
        const d = ((gapPx + row) * csW + x + col) * 4;
        sheet.data[d] = f.data[s];
        sheet.data[d + 1] = f.data[s + 1];
        sheet.data[d + 2] = f.data[s + 2];
        sheet.data[d + 3] = 255;
      }
    }
    x += f.width + gapPx;
  }
  const csPng = encodePng(sheet);
  writeFileSync(join(args.out, "contact-sheet-walk.png"), csPng);
  manifest.outputs.contact_sheet = { file: "contact-sheet-walk.png", sha256: sha(csPng), frames: seen };

  // animador local: um PNG por frame unico da sequencia + HTML que apresenta por tick (sem interpolacao)
  const filesByFrame = {};
  for (const id of seen) {
    const png = encodePng(byId.get(id));
    const file = `walk-frame-0x${id.toString(16)}.png`;
    writeFileSync(join(args.out, file), png);
    filesByFrame[id] = { file, sha256: sha(png) };
  }
  manifest.animations.walk.frame_pngs = filesByFrame;
  const tickFiles = walk.sequence.map((s) => (s.frame === null ? null : filesByFrame[s.frame].file));
  const html = `<!doctype html><meta charset=utf-8><title>REX Sonic 1 — walk</title>
<body style="background:#202040;color:#eee;font-family:monospace;display:flex;flex-direction:column;align-items:center">
<h3>SonAni_Walk (anim 0): ${walk.frames.length} frames unicos, ${walk.intervalRaw} raw / ${walk.interval} ticks por frame, terminador ${walk.terminator.type}</h3>
<img id=f style="image-rendering:pixelated;width:320px" src="${tickFiles[0]}">
<pre id=log></pre>
<script>
const seq=${JSON.stringify(tickFiles)};
const ids=${JSON.stringify(walk.sequence.map((s) => s.frame))};
let i=0;
setInterval(()=>{const t=i%seq.length;if(seq[t])f.src=seq[t];log.textContent="tick "+i+" -> frame de mapping 0x"+(ids[t]??-1).toString(16)+" (buffer DPLC do proprio frame)";i++;},62.5);
</script>
`;
  writeFileSync(join(args.out, "animate-walk.html"), html);
  manifest.outputs.animation = { file: "animate-walk.html", note: "reproducao local da sequencia expandida por tick; nenhuma interpolacao" };

  const mf = join(args.out, "manifest.json");
  writeFileSync(mf, JSON.stringify(manifest, null, 2));
  console.log(`rex-corpus-d: prova gerada em ${args.out}`);
  console.log(`  ROM sha256=${digest.slice(0, 16)}… frames=${Object.keys(frames).length} anim=walk(${walk.frames.length} frames, ${walk.sequence.length} ticks)`);
  console.log(`  manifest: ${mf} (fora do Git)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
