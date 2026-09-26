#!/usr/bin/env python3
"""Gera vetores determinísticos do perfil Kosinski (variante base, não-modular).

Autoridade: `src/lib/kosinski.cc` do mdcomp (flamewing, commit 72c6df40...,
LGPL — ferramenta externa, nada transplantado). Espelho Python do DECODE é
calibrado contra streams reais de `koscmp` ANTES de publicar goldens.

FATOS DE FORMATO (variante base; modular `-m` é capacidade separada) —
CALIBRADOS 12/12 CONTRA STREAMS REAIS DO koscmp em 2026-09-25:
  - DESCRIPTOR: palavra de 16 bits em 2 bytes little-endian, consumida
    LSB->MSB (kosinski.cc KosinskiAdaptor: uint16_t + LittleEndian +
    DescriptorLittleEndianBits). NÃO é tag de 8 bits MSB->LSB.
  - EARLY FETCH (ibitstream EarlyRead, bitstream.hh pop()): a próxima
    palavra é lida imediatamente após o 16º bit consumido — 2 bytes antes
    de quaisquer bytes de dados seguintes; um token pode cruzar a borda e
    seus dados ficarem após o placeholder da nova palavra.
  - bit 1                          -> literal: próximo byte.
  - bits 0,0 (inline) + 2 bits h,l -> len = ((h<<1)|l)+2 (2..5);
                                       dist = 0x100 - próximo byte (0 -> 256).
  - bits 0,1 (separado): byte Low, byte High; Count3 = High & 7
      Count3 != 0 -> len = Count3 + 2 (2..9)
      Count3 == 0 -> próximo byte c: c==0 -> FIM (decoder para aí; nada após
                     o terminator é consumido); c==1 -> continue (sem cópia);
                     senão len = c + 1 (3..256)
      dist = 0x2000 - (((High & 0xF8) << 5) | Low)   (1..0x2000)
  - cópia byte a byte de dst - dist (com sobreposição/eco); o decoder real
    NÃO valida histórico (seekg em posição inválida lê 0 — UB documentada);
    o produto deve retornar erro estruturado para dist > já-escrito.
  - terminador típico do encoder: 0,1 + 00 F0 00.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kos_mirror import mirror_decode

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("vectors")
(OUT / "plain").mkdir(parents=True, exist_ok=True)
(OUT / "golden").mkdir(parents=True, exist_ok=True)
(OUT / "negative").mkdir(parents=True, exist_ok=True)


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
    "abcdef": b"ABCDEF",
    "odd3": b"HELLO",
    "ab_repeat": b"AB" * 400,
    "zeros_64k": b"\x00" * 65536,
    "text_rep": b"the quick brown fox " * 300,
    "tile_like": bytes((i // 8) % 16 for i in range(8192)),
}
n = prng(0xC0FFEE)
plains["pseudo_random_8k"] = bytes(n() % 256 for _ in range(8192))
n = prng(0xBEEF01)
plains["noisy_runs_16k"] = b"".join(
    bytes([n() % 256]) * (1 + n() % 60) for _ in range(700)
)[:16384]
n = prng(0x5EED)
block = bytes(n() % 256 for _ in range(1024))
plains["far_window_40k"] = block + b"\xEE" * 38000 + block
n2 = prng(0x0D0D)
short_block = bytes(n2() % 256 for _ in range(40))
plains["near_window_2k"] = short_block + b"\x11" * 1600 + short_block

for name, data in plains.items():
    (OUT / "plain" / f"{name}.bin").write_bytes(data)


class Kos:
    """Montador de streams Kosinski com modelo de saída interno.

    Espelha o LEITOR real (kosinski.cc + ibitstream EarlyRead): descritor é
    uma palavra de 16 bits em 2 bytes little-endian, consumida LSB->MSB;
    quando o 16º bit é consumido a próxima palavra é buscada IMEDIATAMENTE
    (placeholder de 2 bytes), e bytes de dados do token que cruzou a borda
    entram DEPOIS desse placeholder. Validado 12/12 contra streams reais do
    koscmp em 2026-09-25.
    """

    def __init__(self):
        self.bytes = bytearray()
        self.out = bytearray()
        self.tag_start = None
        self.bit_used = 0  # bits já consumidos da palavra corrente (0..16)

    def _open_word(self):
        self.tag_start = len(self.bytes)
        self.bytes.append(0)
        self.bytes.append(0)
        self.bit_used = 0

    def w(self, *bits):
        for bit in bits:
            if self.tag_start is None:
                self._open_word()
            if bit:
                self.bytes[self.tag_start + self.bit_used // 8] |= (
                    1 << (self.bit_used % 8)
                )
            self.bit_used += 1
            if self.bit_used == 16:
                # EARLY FETCH: busca imediata da próxima palavra
                self._open_word()

    def d(self, byte: int):
        self.bytes.append(byte)

    def literal(self, byte: int):
        self.w(1)
        self.d(byte)
        self.out.append(byte)

    def inline(self, ln: int, dist: int):
        assert 2 <= ln <= 5 and 1 <= dist <= 256
        l = ln - 2
        self.w(0, 0, (l >> 1) & 1, l & 1)
        self.d(0x100 - dist)
        self._copy(dist, ln)

    def separate(self, ln: int, dist: int):
        assert 2 <= ln <= 0x100 and 1 <= dist <= 0x2000
        self.w(0, 1)
        d = 0x2000 - dist
        low = d & 0xFF
        high = (d >> 5) & 0xF8
        if 2 <= ln <= 9:
            self.d(low)
            self.d(high | (ln - 2))
        else:
            assert 3 <= ln <= 0x100
            self.d(low)
            self.d(high)
            self.d(ln - 1)
        self._copy(dist, ln)

    def continue_edge(self, dist: int):
        # 3-byte form com byte de contagem == 1: sem cópia (quirk da referência)
        self.w(0, 1)
        d = 0x2000 - dist
        self.d(d & 0xFF)
        self.d(((d >> 5) & 0xF8) | 0)
        self.d(1)

    def eod(self):
        self.w(0, 1)
        self.d(0x00)
        self.d(0xF0)
        self.d(0x00)

    def _copy(self, dist, ln):
        src = len(self.out) - dist
        assert src >= 0, f"dist {dist} > histórico {len(self.out)}"
        for i in range(ln):
            self.out.append(self.out[src + i])

    def result(self):
        return bytes(self.out), bytes(self.bytes)


goldens = {}

s = Kos()
for c in b"ABCDEF":
    s.literal(c)
s.eod()
goldens["m01_literals"] = s.result()

s = Kos()
s.literal(0x5A)
# NOTA: o nome diz "with_eod" mas o stream NÃO tem terminator — é literal
# único puro, aceito pelo oráculo por exaustão. Preservado para não alterar
# fixture já publicada; sob contrato do produto seria 'truncated'
# (exception registrada no loop de validação strict abaixo).
goldens["m02_single_with_eod"] = s.result()

s = Kos()
for c in b"ABCDE":
    s.literal(c)
s.inline(4, 5)          # eco 'ABCD' com dist 5? len4 de 'ABCDE' dist5 -> 'ABCDEA'
s.eod()
goldens["m03_inline_match"] = s.result()

s = Kos()
for c in b"HelloWorld!":
    s.literal(c)
s.separate(9, 11)       # curto: len 9 no limite do Count3, dist = histórico exato
s.eod()
goldens["m04_separate_short"] = s.result()

s = Kos()
for c in b"XYZ":
    s.literal(c)
for i in range(32):
    s.separate(256, 1)  # eco de 1 byte: enche histórico até > 8192 barato
s.separate(256, 8192)   # match longo: contador de 8 bits, dist grande
s.eod()
goldens["m05_separate_long_far"] = s.result()

s = Kos()
for c in b"ABCDE":
    s.literal(c)
s.continue_edge(2)      # quirk 'continue' sem cópia
s.inline(2, 5)
s.eod()
goldens["m06_continue_edge"] = s.result()

s = Kos()
for c in b"AAAA":
    s.literal(c)
s.inline(2, 4)          # inline dist exato = histórico, cópia com eco
s.eod()
goldens["m07_inline_exact_history"] = s.result()

s = Kos()
for _ in range(9):
    s.literal(0x42)
s.separate(10, 9)       # len 10 força forma de 3 bytes (>= 256 não; 10 usa c=9)
s.eod()
goldens["m08_len10_three_byte"] = s.result()

# --- FRONTeira de EARLY FETCH (vetores discriminantes) --------------------
# m09: 16 literais — o 16º bit do descritor é o bit do 16º literal; pelo modelo
# real (ibitstream EarlyRead) a PRÓXIMA palavra de 16 bits é buscada
# imediatamente nesse ponto, então o byte de dados do 16º literal cai DEPOIS do
# placeholder da nova palavra (offset 19), não em 17. Um leitor que buscasse o
# descritor só no início do próximo token (modelo ingênuo "late fetch") leria os
# 2 bytes de word2 como dados do 16º literal e deslocaria todo o resto — o
# oráculo rejeitaria (golden não confirmado). A confirmação pelo oráculo é,
# portanto, o teste discriminante; a asserção de offset documenta a intenção.
s = Kos()
for i in range(16):
    s.literal(0x40 + i)
s.eod()
exp09, st09 = s.result()
# layout esperado: word1[0:2] + 15 bytes de dados (2..16) + word2[17:19] + 16º dado[19]
assert len(st09) >= 20, st09
assert st09[19] == 0x4F, f"m09 early-fetch discriminant: 16º literal deve estar em 19, achou {st09[19]:#04x}"
goldens["m09_earlyfetch_boundary_literal"] = (exp09, st09)

# m10: match INLINE cujo par de bits de comprimento atravessa a borda dos 16
# bits; o byte de dist do inline entra após o placeholder da nova palavra.
s = Kos()
for i in range(13):
    s.literal(0x30 + i)
s.inline(3, 2)          # bits usados 13->14(0),15(0),16(h)->EARLY FETCH,entao l,byte dist
s.eod()
exp10, st10 = s.result()
# layout: word1[0:2] + 13 dados (2..14) + word2[15:17] + byte-dist do inline[17]
assert len(st10) >= 18, st10
assert st10[17] == 0xFE, f"m10 early-fetch straddle: byte de dist do inline deve estar em 17, achou {st10[17]:#04x}"
goldens["m10_earlyfetch_straddle_inline"] = (exp10, st10)

# --- calibração do espelho contra o oráculo real acontece em
# build-vectors.sh (koscmp -x reproduz cada golden; espelho confere cada
# stream gerada pelo oráculo). Aqui só auto-validação builder<->espelho.
fails = 0
for name in sorted(goldens):
    expected, stream = goldens[name]
    got, _consumed = mirror_decode(stream)
    if got != expected:
        fails += 1
        print(f"{name}: FALHA espelho -> {got!r} (esperado {expected!r})")
        continue
    # goldens são bem-formados: devem passar TAMBÉM no modo strict (contrato
    # do produto: terminator presente, referências dentro do histórico).
    # EXCEPÇÃO DECLARADA: m02 é exatamente o caso "literal único SEM EOD" — o
    # oráculo o aceita; sob o contrato do produto é 'truncated' (por isso não
    # é negativo: sua razão de ser é provar a aceitação da referência).
    if name == "m02_single_with_eod":
        sgot, sconsumed = mirror_decode(stream, strict=True)
        assert sgot == "ERR-trunc", f"m02 deve ser truncated sob o contrato, deu {sgot!r}"
        print(f"{name}: espelho OK (plain={len(expected)} comp={len(stream)}) [strict=ERR-trunc por desenho]")
        continue
    sgot, sconsumed = mirror_decode(stream, strict=True)
    if sgot != expected or sconsumed != len(stream):
        fails += 1
        print(f"{name}: FALHA espelho strict -> {sgot!r} consumed={sconsumed}/{len(stream)}")
        continue
    print(f"{name}: espelho OK (plain={len(expected)} comp={len(stream)})")
if fails:
    sys.exit(f"{fails} golden(s) divergem do espelho — não publicar")

for name, (expected, stream) in goldens.items():
    (OUT / "golden" / f"{name}.kos").write_bytes(stream)
    (OUT / "golden" / f"{name}.expected.bin").write_bytes(expected)

# ---------------------------------------------------------------------------
# Negativos negative-spec: derivados do CONTRATO v1/formato, não do oráculo —
# a referência (mdcomp koscmp) NÃO valida nada: seekg negativo lê 0, EOF sem
# terminator é aceito em silêncio (sondas registradas em build-vectors.sh).
# Auto-verificados pelo espelho em modo strict; oráculos NÃO rodam sobre
# estes streams no build principal.
negatives = {}

# k01: EOF após literal sem terminator (descritor 0x0001: 1º bit = 1, dado 0x41,
# depois exaustão) -> truncated
negatives["k01_no_terminator_after_literal"] = (
    ("ERR-trunc", None), (b"", bytes([0x01, 0x00, 0x41])))

# k02: token separado interrompido no byte de dados (Low presente, High ausente)
# -> truncated
negatives["k02_separate_missing_high_byte"] = (
    ("ERR-trunc", None), (b"", bytes([0x02, 0x00, 0x10])))

# k03: referência separada dist=3 com histórico VAZIO -> invalid-reference
negatives["k03_separate_ref_before_history_start"] = (
    ("ERR-off", None), (b"", bytes([0x02, 0x00, 0xFD, 0xFB])))

# k04: inline com byte de dist 0x00 -> dist=256 sobre 1 byte de histórico
# -> invalid-reference
negatives["k04_inline_dist_beyond_history"] = (
    ("ERR-off", None), (b"", bytes([0x00, 0x00, 0x41, 0x00, 0x00])))

# k05: stream BEM-FORMADA (passa no espelho inclusive em strict, e seria
# aceita pelo oráculo) que expande 512 bytes de saída; com max_out=16 o
# produto DEVE retornar excessive-output ANTES de emitir/concluir a cópia.
# Layout: 256 literais (histórico exato) + separado len=256 dist=256 (cópia
# com sobreposição legal) + terminator.
s = Kos()
for i in range(256):
    s.literal(i)
s.separate(256, 256)     # len máximo do contador de 8 bits, dist = histórico exato
s.eod()
expected05, st05 = s.result()
assert len(expected05) == 512, len(expected05)
g5, c5 = mirror_decode(st05)
assert g5 == expected05 and c5 == len(st05), "k05 deve ser bem-formada no espelho"
g5s, c5s = mirror_decode(st05, strict=True)
assert g5s == expected05, "k05 deve passar em strict (é válida; viola só max_out)"
negatives["k05_excessive_output"] = (("ERR-eod", 16), (expected05, st05))

nfail = 0
for name in sorted(negatives):
    (exp_kind, max_out), (expected, stream) = negatives[name]
    got, consumed = mirror_decode(stream, strict=True)
    if max_out is not None:
        ok = isinstance(got, (bytes, bytearray)) and got == expected and len(got) > max_out
    else:
        ok = got == exp_kind
    if ok:
        print(f"{name}: negativo OK ({exp_kind}, stream={len(stream)} B)")
    else:
        nfail += 1
        print(f"{name}: FALHA — espelho strict deu {got!r} (esperado {exp_kind})")

if nfail:
    sys.exit(f"{nfail} negativo(s) não confirmados — não publicar")

for name, ((exp_kind, max_out), (expected, stream)) in negatives.items():
    (OUT / "negative" / f"{name}.kos").write_bytes(stream)
    if max_out is not None:
        contract = "excessive-output"
    elif exp_kind == "ERR-trunc":
        contract = "truncated"
    else:
        contract = "invalid-reference"
    (OUT / "negative" / f"{name}.expected.json").write_text(json.dumps({
        "vector": name,
        "kind": "negative-spec",
        "expected_error": contract,
        "mirror_condition": exp_kind,
        "max_out": max_out,
        "stream_len": len(stream),
        "note": "Derivado do contrato/formato; o oráculo koscmp NÃO valida "
                "histórico nem exige terminator (defeito registrado em "
                "build-vectors.sh) e NÃO foi executado sobre este stream.",
    }, ensure_ascii=False) + "\n")

print(f"plain={len(plains)} golden={len(goldens)} negative={len(negatives)} em {OUT}")
