#!/usr/bin/env python3
"""Gera vetores determinísticos do perfil LZ4W-SGDK (agente B).

Autoridade do formato: LZ4W.java v1.43 (SGDK commit 2eac605a..., MIT) +
streams reais produzidos por `java -jar lz4w.jar p` (calibrado 2026-09-25
contra 7 streams do oráculo: ABCDEF/HELLO/ABCAB/long-lit/rep/tail-odd/empty).
A documentação bin/lz4w.txt contradiz o código no flag do bloco final
(diz D==0 escreve byte; código+oráculo: D==1 escreve) — código é a referência.

FATOS DE FORMATO (variante fixada: stream cru do CLI, SEM header de tamanho;
o `start`/prev do modo dicionário é DEPENDÊNCIA DECLARADA, não coberta aqui):
  - stream = sequência de palavras de 16 bits lidas big-endian da stream.
  - header de bloco: LLLL MMMM OOOOOOOO
      L = nº de palavras literais que seguem (0..15; dados literais são
          copiados byte a byte da stream para a saída);
      M != 0: match curto, comprimento = M+1 palavras, offset = O+1 palavras;
      M == 0 e O != 0: match LONGO, comprimento = O+2 palavras; a palavra
          SEGUINTE (após os literais) codifica o offset:
          off = ((-valor) & 0x7FFF) + 1; bit 0x8000 = fonte ROM (ajuste por
          offsetAdj — fora do escopo dos goldens, capacidade separada);
      L=M=O=0: EOD.
  - após EOD: palavra final: bit 0x8000 set -> byte baixo = último byte ímpar;
    caso contrário nada. Truncamento: o loop do oráculo PARA silenciosamente em
    `ind >= n-1` e aceita a palavra final — o oráculo NÃO sinaliza erro de
    truncamento; erro estruturado é responsabilidade do produto (contrato v1).
  - vazio packeia como EOD+0000; 1 byte como EOD+80XX (oráculo lida bem —
    ao contrário do aPLib).

Artefatos: plain/*.bin (entradas), golden/*.lz4 + *.expected.bin (montados à
mão pela spec e validados pelo ESPELHO abaixo; build-vectors.sh exige que o
oráculo externo decodifique cada golden para a saída exata).
"""
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("vectors")
(OUT / "plain").mkdir(parents=True, exist_ok=True)
(OUT / "golden").mkdir(parents=True, exist_ok=True)


def prng(seed: int):
    x = seed & 0x7FFFFFFF

    def nxt() -> int:
        nonlocal x
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        return x

    return nxt


plains = {
    "empty": b"",
    "single": b"\x5A",
    "odd5": b"HELLO",
    "abcdef": b"ABCDEF",
    "ab_repeat": b"AB" * 400,
    "zeros_64k": b"\x00" * 65536,
    "text_rep": b"the quick brown fox " * 300,
    "tile_like": bytes((i // 8) % 16 for i in range(8192)),
}
n = prng(0xC0FFEE)
plains["pseudo_random_8k"] = bytes(n() % 256 for _ in range(8192))
n = prng(0xBEEF01)
plains["noisy_runs_16k"] = b"".join(
    bytes([n() % 256]) * (2 + 2 * (n() % 30)) for _ in range(500)
)[:16384]
n = prng(0x5EED)
block = bytes(n() % 256 for _ in range(1024))
plains["far_window_40k"] = block + b"\xEE" * 38000 + block
n2 = prng(0x0D0D)
short_block = bytes(n2() % 256 for _ in range(40))
plains["near_window_2k"] = short_block + b"\x11" * 1600 + short_block

for name, data in plains.items():
    (OUT / "plain" / f"{name}.bin").write_bytes(data)


def mirror_decode(st: bytes):
    """Espelho do unpack de referência (LZ4W.java v1.43), validado vs jar."""
    n = len(st) // 2
    out = bytearray()
    ind = 0
    offset_adj = 0
    while ind < n - 1:
        seg = (st[2 * ind] << 8) | st[2 * ind + 1]
        ind += 1
        offset_adj += 1
        lit = seg >> 12
        mlen = (seg >> 8) & 0xF
        offb = seg & 0xFF
        if lit == 0 and mlen == 0 and offb == 0:
            break  # EOD
        for _ in range(lit):
            if ind >= n:
                return "ERR-trunc"
            out += st[2 * ind:2 * ind + 2]
            ind += 1
        length, moff = 0, 0
        if mlen == 0:
            if offb != 0:  # match longo
                if ind >= n:
                    return "ERR-trunc"
                val = (st[2 * ind] << 8) | st[2 * ind + 1]
                ind += 1
                offset_adj += 1
                length = offb + 2
                moff = ((-val) & 0x7FFF) + 1
                if val & 0x8000:
                    moff -= offset_adj
                    if moff < 1:
                        return "ERR-rom-offset"
        else:
            length = mlen + 1
            moff = offb + 1
            offset_adj -= length
        if length:
            src = len(out) - moff * 2
            if src < 0:
                return "ERR-off"
            for i in range(length * 2):
                out.append(out[src + i])
    if ind < n:
        v = (st[2 * ind] << 8) | st[2 * ind + 1]
        if v & 0x8000:
            out.append(v & 0xFF)
    return bytes(out)


class Lw:
    """Montador de streams LZ4W com verificação interna do output."""

    def __init__(self):
        self.words = []   # palavras de 16 bits já emitidas (header/data)
        self.out = bytearray()

    def _w16(self, v: int):
        self.words.append((v >> 8) & 0xFF)
        self.words.append(v & 0xFF)

    def _check_match(self, off: int, length: int):
        src = len(self.out) - off * 2
        assert src >= 0, f"offset {off} palavras fora do histórico"
        for i in range(length * 2):
            self.out.append(self.out[src + i])

    def block(self, lit_words, short=None, long_=None):
        assert len(lit_words) <= 15
        assert not (short and long_)
        l = len(lit_words)
        if short:
            off, ln = short          # palavras; MMMM = ln-1 em 1..15; O = off-1 em 0..255
            assert 1 <= ln - 1 <= 15 and 0 <= off - 1 <= 255
            self._w16((l << 12) | ((ln - 1) << 8) | (off - 1))
        elif long_:
            off, ln = long_          # palavras; O = ln-2 em 1..255
            assert 2 <= ln - 2 <= 255 and 1 <= off
            self._w16((l << 12) | (ln - 2))
        else:
            self._w16(l << 12)
        for wb in lit_words:
            self._w16(wb)
            self.out.append(wb >> 8)
            self.out.append(wb & 0xFF)
        if long_:
            self._w16((1 - long_[0]) & 0x7FFF)
        if short:
            self._check_match(short[0], short[1])
        elif long_:
            self._check_match(long_[0], long_[1])
        # literal-only: nada a fazer

    def end(self, final_byte=None):
        self._w16(0)                       # EOD
        if final_byte is not None:
            self._w16(0x8000 | final_byte)
            self.out.append(final_byte)
        else:
            self._w16(0)

    def result(self):
        return bytes(self.out), bytes(self.words)

    @staticmethod
    def words_of(data: bytes):
        return [data[i] << 8 | data[i + 1] for i in range(0, len(data) - 1, 2)]


def W(s: bytes):
    return Lw.words_of(s)


goldens = {}

s = Lw()
s.block(W(b"ABCD"))
s.block(W(b"EF"))
s.end()
goldens["k01_literals_even"] = s.result()          # 'ABCDEF'

s = Lw()
s.block(W(b"HELL"))
s.end(final_byte=ord("O"))
goldens["k02_final_byte_odd"] = s.result()          # 'HELLO'

s = Lw()
s.end(final_byte=0x5A)
goldens["k03_single_odd"] = s.result()             # 'Z' (EOD puro + final)

s = Lw()
s.end()
goldens["k04_empty"] = s.result()                  # vazio

s = Lw()
s.block(W(b"XY") + W(b"ABCD")[:1], short=(2, 2))    # lit 'XYAB' + match off2 len2
s.end()
goldens["k05_short_match"] = s.result()

s = Lw()
s.block(list(range(15)), short=(1, 2))             # 15 palavras literais (máx)
s.end()
goldens["k06_max_literals"] = s.result()

s = Lw()
s.block(W(b"AA"), long_= (1, 40))                  # run longa off=1 (estilo rep)
s.end()
goldens["k07_long_match_near"] = s.result()

s = Lw()
s.block(W(b"ABCD"), long_= (2, 38))                # valor estendido 0x7fff
s.end(final_byte=0x5A)
goldens["k08_long_match_far"] = s.result()

s = Lw()
s.block(W(b"0123456789abcdef0123")[:8], short=(8, 2))  # ecoa probe real (off 8 palavras)
s.block(W(b"ZZ"), long_= (5, 12))
s.end(final_byte=0x21)
goldens["k09_mixed"] = s.result()

# --- calibração do espelho contra streams REAIS do oráculo jar ----------
real = [
    (b"ABCDEF", bytes.fromhex("30004142434445460000" + "0000")),
    (b"HELLO", bytes.fromhex("200048454C4C0000" + "804F")),
    (b"ABCAB", bytes.fromhex("2000414243410000" + "8042")),
    (b"0123456789abcdef0123", bytes.fromhex("8107" + b"0123456789abcdef".hex() + "00000000")),
    (b"AAAA" * 40, bytes.fromhex("104d4141" + "00000000")),
    (b"ABCD" * 20 + b"Z", bytes.fromhex("2024" + "41424344" + "7fff" + "0000" + "805a")),
    (b"", bytes.fromhex("0000" + "0000")),
    (b"\x5A", bytes.fromhex("0000" + "805a")),
]
fails = 0
for exp, st in real:
    got = mirror_decode(st)
    if got != exp:
        fails += 1
        print(f"CALIBRAÇÃO FALHOU: esperado {exp!r} obtido {got!r}")
print(f"espelho vs oráculo real: {len(real) - fails}/{len(real)} OK")
if fails:
    sys.exit("espelho diverge do oráculo — não publicar")

# --- validação interna dos goldens via espelho ---------------------------
for name in sorted(goldens):
    expected, stream = goldens[name]
    got = mirror_decode(stream)
    if got != expected:
        sys.exit(f"{name}: FALHA espelho -> {got!r} (esperado {expected!r})")
    print(f"{name}: espelho OK (plain={len(expected)} comp={len(stream)})")

for name, (expected, stream) in goldens.items():
    (OUT / "golden" / f"{name}.lz4").write_bytes(stream)
    (OUT / "golden" / f"{name}.expected.bin").write_bytes(expected)

print(f"plain={len(plains)} golden={len(goldens)} em {OUT}")
