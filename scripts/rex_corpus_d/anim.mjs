// Leitor da tabela de animacao (Ani_Sonic) e expansor de sequencia por tick.
// Semantica de _incObj/01 Sonic.asm (Sonic_Animate) e _anim/Sonic.asm (s1disasm 064e3c6):
//  - tabela = N palavras = offset RELATIVO da base ate o script;
//  - primeiro byte do script = duracao (raw<=0x7f usa o valor; 0x80.. = marker
//    negativo dos scripts especiais walk/run/roll, duracao = |signed|);
//  - terminadores: afEnd $FF (loop), afBack $FE + k (volta k frames),
//    afChange $FD + id (troca de animacao sem resetar posicao).
import { sbyte } from "./reader.mjs";

const AF_END = 0xff;
const AF_BACK = 0xfe;
const AF_CHANGE = 0xfd;

export function readAnimTable(rom, profile) {
  const out = [];
  for (let i = 0; i < profile.anim_count; i++) {
    const offset = (rom[profile.anim_table + i * 2] << 8) | rom[profile.anim_table + i * 2 + 1];
    out.push({ anim: i, offset, addr: profile.anim_table + offset });
  }
  return out;
}

export function decodeAnimScript(rom, profile, anim, { special = false } = {}) {
  const table = readAnimTable(rom, profile);
  const entry = table[anim];
  if (!entry) throw new Error(`anim ${anim} fora da tabela (0..${profile.anim_count - 1})`);
  const intervalRaw = rom[entry.addr];
  let pos = entry.addr + 1;
  const frames = [];
  let terminator = { type: "end" };
  for (;;) {
    const b = rom[pos++];
    if (b === AF_END) {
      terminator = { type: "loop" };
      break;
    }
    if (b === AF_BACK) {
      terminator = { type: "back", frames: rom[pos++] };
      break;
    }
    if (b === AF_CHANGE) {
      terminator = { type: "change", anim: rom[pos++] };
      break;
    }
    frames.push(b);
  }
  return {
    anim,
    addr: entry.addr,
    intervalRaw,
    interval: Math.max(1, Math.abs(sbyte(intervalRaw))),
    special,
    frames,
    terminator,
  };
}

export function expandAnimFrames(script, ticks) {
  const out = [];
  const { frames, interval, terminator } = script;
  if (frames.length === 0) throw new Error("script sem frames");
  let idx = 0;
  let held = 0;
  let switched = false;
  for (let t = 0; t < ticks; t++) {
    if (switched) {
      out.push({ frame: null, switchTo: terminator.anim });
      continue;
    }
    if (held === 0) {
      held = interval;
      if (terminator.type === "change" && idx >= frames.length) switched = true;
    }
    if (switched) {
      out.push({ frame: null, switchTo: terminator.anim });
      continue;
    }
    out.push({ frame: frames[idx] });
    held--;
    if (held === 0) {
      idx++;
      if (idx >= frames.length) {
        if (terminator.type === "back") idx = frames.length - 1 - terminator.frames;
        else if (terminator.type === "loop") idx = 0;
      }
    }
  }
  return out;
}
