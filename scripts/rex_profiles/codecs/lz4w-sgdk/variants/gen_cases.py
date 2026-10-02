#!/usr/bin/env python3
"""Gera casos DISCRIMINANTES p/ o desempate LZ4W Java(jar v1.43) vs 68000
(tools_a.s SGDK 2.11), conforme diretiva da rodada.

Regra desta fase: nada é "adaptado". Streams SEM ROM-bit são artesanais e
auto-validadas contra a semântica conhecida; streams COM ROM-bit são emitidas
pelo PRÓPRIO encoder do jar v1.43 em modo dicionário (CLI '@') — corretas por
construção para a variante Java; se o 68k divergir, a divergência é medida,
não presumida. Casos de borda de offset são artesanais e podem quebrar o jar
(medido, registrado como limite da referência, não como spec do produto).

Saída: <out>/cases/<id>.dict (pode faltar), <id>.stream, e <out>/table.s
(tabela montada p/ o harness 68k: gap 0x5AA5 + dict + stream por caso).
"""
import struct
import subprocess
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("cases-out")
CASES = OUT / "cases"
CASES.mkdir(parents=True, exist_ok=True)

JAR = "/home/misael/.cache/rex-codecs/oracle-tools/SGDK211/bin/lz4w.jar"
GAP = b"\x5A\xA5" * 128  # 256 B antes de cada dict/stream: janela legível p/ over-read


def hdr(lit, mat, off):
    return struct.pack(">H", (lit << 12) | (mat << 8) | off)


def w16(*ws):
    return b"".join(struct.pack(">H", w) for w in ws)


cases = []  # (id, dict_bytes_or_None, stream_bytes)


def add(cid, dct, stream):
    cases.append((cid, dct, stream))


# --- sem dicionário ------------------------------------------------------
lit2 = bytes([0x41, 0x42, 0x43, 0x44])
add("c01_lits", None, hdr(2, 0, 0) + lit2 + w16(0, 0))
# match curto: 2 literais; M=2 -> len 3 palavras; O=1 -> dist 2 palavras
add("c02_short_match", None, hdr(2, 2, 1) + lit2 + w16(0, 0))
# referência ao bloco anterior via LONG sem ROM-bit: 3 literais, len=O+2=4, dist=3
lit6 = bytes([0x55, 0xAA, 0x33, 0xCC, 0x99, 0x11])
add("c03_long_norom", None,
    hdr(3, 0, 2) + lit6 + w16((-(3 - 1)) & 0x7FFF) + w16(0, 0))
# esperados dos artesanais (semântica de cópia palavra-a-palavra com
# sobreposição idêntica nas duas variantes — a execução confirma):
(CASES / "c01_lits.plain_expected").write_bytes(bytes([0x41, 0x42, 0x43, 0x44]))
(CASES / "c02_short_match.plain_expected").write_bytes(
    bytes([0x41, 0x42, 0x43, 0x44]) * 2 + bytes([0x41, 0x42]))
(CASES / "c03_long_norom.plain_expected").write_bytes(
    bytes([0x55, 0xAA, 0x33, 0xCC, 0x99, 0x11, 0x55, 0xAA, 0x33, 0xCC, 0x99, 0x11, 0x55, 0xAA]))

# --- dicionário + encoder jar (ROM-bit "por construção") -----------------
DICT = bytes((i * 0x11) & 0xFF for i in range(64))


def jar_pack_dict(dct: bytes, inp: bytes) -> bytes:
    """pack modo dicionário via CLI do oráculo: 'p dict@input'. O Launcher
    'p' escreve APENAS o stream (sem prefixar o dict) — ver Launcher.java."""
    import tempfile
    d = Path(tempfile.mkdtemp())
    (d / "dd.bin").write_bytes(dct)
    (d / "in.bin").write_bytes(inp)
    r = subprocess.run(["timeout", "60", "java", "-jar", JAR, "p",
                        f"{d / 'dd.bin'}@{d / 'in.bin'}", str(d / "out.bin"), "s"],
                       capture_output=True, stdin=subprocess.DEVNULL, timeout=90)
    if r.returncode != 0:
        raise RuntimeError(f"jar p falhou rc={r.returncode}: {r.stderr[:200]}")
    return (d / "out.bin").read_bytes()


# c04: input contém fatia do dicionário -> >=1 match fonte-ROM
plain4 = DICT[16:24] + bytes([0x10, 0x20, 0x30, 0x40] * 4)
add("c04_rom_single", DICT, jar_pack_dict(DICT, plain4))
# c05: duas fatias distantes do dicionário -> refs fonte-ROM sucessivas
plain5 = DICT[0:8] + bytes([0x77] * 16) + DICT[40:56] + bytes([0x77] * 16)
add("c05_rom_successive", DICT, jar_pack_dict(DICT, plain5))

# --- fronteiras de offset (artesanais) ------------------------------------
# c06: ROM-bit com raw=1 no PRIMEIRO segmento: para o jar, dist = 1-offsetAdj
# (= -1 após +2 de cabeçalho+valor) -> posição além do cursor; para o 68k,
# a2 = src-2 (lê o próprio byte de valor). Caso degenerado: medir os dois.
add("c06_edge_raw_min", DICT, hdr(0, 0, 2) + w16((-(1 - 1)) & 0x7FFF | 0x8000) + w16(0, 0))
# c07: ROM-bit com raw=0x3FFF+1 (janela máxima do formato) com dict de só 64B:
# jar lê antes do início do buffer; 68k lê o gap 0x5AA5 antes do dict.
raw7 = 0x3FFF + 1
add("c07_edge_raw_max", DICT, hdr(0, 0, 2) + w16((-(raw7 - 1)) & 0x7FFF | 0x8000) + w16(0, 0))

# --- escrito pelo encoder em escala real (publicado na rodada anterior) ---
PUB = Path(__file__).resolve().parents[5] / "data/rex_profiles/codec/lz4w-sgdk"
if (PUB / "dict/d01_dict.bin").exists():
    add("c08_published_d01", (PUB / "dict/d01_dict.bin").read_bytes(),
        (PUB / "dict/d01_stream.lz4").read_bytes())

# --- gravação -------------------------------------------------------------
lines = [
    "# gerado por gen_cases.py — Tabela de casos p/ harness 68k",
    "# gap 0x5AA5*(256) antes de cada caso: over-read determinístico",
    "\t.section .rodata",
    "\t.even",
]
meta = []
for cid, dct, stream in cases:
    (CASES / f"{cid}.stream").write_bytes(stream)
    if dct is not None:
        (CASES / f"{cid}.dict").write_bytes(dct)
    meta.append((cid, dct is not None, len(stream)))
    lines.append(f"{cid}_blob:")
    lines.append("\t.rept 128\n\t.word 0x5AA5\n\t.endr")
    if dct is not None:
        for i in range(0, len(dct), 16):
            lines.append("\t.byte " + ",".join(f"0x{b:02X}" for b in dct[i:i + 16]))
    lines.append(f"{cid}_src:")  # rótulo EXATO do início do stream (a0 inicial)
    for i in range(0, len(stream), 16):
        lines.append("\t.byte " + ",".join(f"0x{b:02X}" for b in stream[i:i + 16]))
    lines.append(f"{cid}_end:")
    lines.append(f"\t.even")

lines.append("\t.text")
lines.append("case_table:")
for cid, has_d, ln in meta:
    lines.append(f"\t.long {cid}_src")
lines.append("case_table_end:")
(OUT / "table.s").write_text("\n".join(lines) + "\n")

for cid, has_d, ln in meta:
    print(f"caso={cid} dict={has_d} stream_bytes={ln}")
print(f"total={len(meta)}")
