// Optional analysis aid: linear-sweep 68000 disassembly through the local
// Capstone CLI (`cstool`). This never executes ROM bytes — it only decodes
// them, and the whole front keeps working when cstool is absent.

import { spawnSync } from "node:child_process";

export const DISASM_VERSION = "rex-corpus-c-disasm/1";

export function cstoolAvailable() {
  const r = spawnSync("cstool", ["-h"], { encoding: "utf8" });
  return r.status === 0 || (r.stderr || "").includes("Cstool");
}

// Decode `bytes` starting at `startAddr`. Returns one entry per instruction;
// undecodable bytes are reported as `data`, never silently skipped, so a wrong
// assumption about where code begins becomes visible instead of misleading.
export function disassembleM68k(bytes, startAddr, { maxInsns = 4096 } = {}) {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const r = spawnSync("cstool", ["m68k", hex, `0x${startAddr.toString(16)}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`cstool_failed: ${(r.stderr || "").slice(0, 200)}`);
  const out = [];
  for (const line of (r.stdout || "").split("\n")) {
    const m = /^([0-9a-f]+)\s{2}((?:[0-9a-f]{2} )+)\s+(.*)$/.exec(line.trim() + " ");
    if (!m) continue;
    const addr = parseInt(m[1], 16);
    const raw = m[2].trim().split(" ");
    out.push({ address: addr, bytes: raw.length, text: m[3].trim(), kind: "insn" });
    if (out.length >= maxInsns) break;
  }
  return out;
}

// Collect absolute addresses an instruction mentions, so tables can be found
// by *who points at them* rather than by guessing a layout.
export function referencedAddresses(insns) {
  const refs = new Map();
  for (const ins of insns) {
    const hits = ins.text.matchAll(/\$([0-9a-f]{5,8})\b/gi);
    for (const h of hits) {
      const v = parseInt(h[1], 16);
      if (!refs.has(v)) refs.set(v, []);
      refs.get(v).push({ from: ins.address, text: ins.text });
    }
  }
  return refs;
}
