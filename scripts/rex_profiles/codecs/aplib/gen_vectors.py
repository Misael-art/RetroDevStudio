#!/usr/bin/env python3
"""Gera vetores determinísticos do perfil aPLib (agente B).

Artefatos:
  plain/<name>.bin  - dados de entrada p/ os oráculos (apultra / APJ); os
                       streams canônicos vêm dos oráculos via build-vectors.sh.
  golden/*.ap       - streams montados À MÃO pela especificação abaixo e
                       auto-validados por um ESPELHO Python do decoder de
                       referência (calibrado 2026-09-24 contra streams reais
                       de apultra e APJ). build-vectors.sh exige ainda que
                       AMBOS os oráculos decodifiquem cada golden para a saída
                       exata esperada; divergiu, o golden é rejeitado.

FATOS DE FORMATO (autoridade = oráculos + `src/tools_a.s` do SGDK):
  - byte 0 = literal inicial; o próximo byte é a 1ª tag.
  - tags: 8 slots, bits lidos MSB->LSB; quando a tag enche (ou o token pede
    um byte de dados), busca-se o PRÓXIMO byte como tag nova. Bytes de dados
    (literais, offset-low, cmd 110) são intercalados na ordem de consumo.
  - gamma2 (apultra expand.c:64-75): leitor v=1; consome pares (dado,
    controle): v=(v<<1)|dado; para no controle 0. Logo v>=2 sempre.
    writer: dígitos de v sem o '1' líder (MSB->LSB), cada um seguido de
    controle (1 em todos, exceto o último, 0). gamma2(2)=[0,0];
    gamma2(3)=[1,0]; gamma2(4)=[0,1,0,0]; gamma2(5)=[0,1,1,0].
  - token '10': off_hi = gamma2 - LWM; se >= 0: off=(off_hi<<8)|byte,
    len=gamma2 com +2 se off<128 ou off>=32000, +1 se 1280<=off<32000;
    se -1: rep-match, len=gamma2 SEM ajuste (tools_a.s).
  - token '110': cmd byte; 0x00=EOD; off=cmd>>1 (1..127), len=2+(cmd&1).
  - token '111': 4 bits, 1º lido pesa <<3; off4=0 -> escreve 0x00;
    senão copia 1 byte de off 1..15.
  - LWM (nFollowsLiteral): 3 após literal/111; 2 após match. Primeiro: 3.

NEGATIVOS (derivados do CONTRATO, não do oráculo): os decodificadores de
referência NÃO validam (leem bytes não inicializados além do EOF e aceitam
truncamento); portanto rejeições esperadas vêm da especificação acima. Cada
stream em negative/ é auto-verificado neste arquivo contra o espelho com
`negative_check` (ERR-in=EOF no meio, ERR-off=ref inválida, ERR-rep-first,
ERR-no-eod=decodou sem terminador); nenhum negativo é enviado aos oráculos.
`mirror_decode` também devolve bytes_consumed (posição no EOD) para o
vetor de fronteira de consumo.

Determinístico; dados sintéticos redistribuíveis.
"""
import json
import sys
from pathlib import Path

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


class Stream:
    """Monta streams aPLib crus simulando o ponteiro de bytes do decoder de referência.

    O leitor consome o stream sequencialmente: bits vêm da tag corrente (8
    slots, MSB->LSB) e um NOVO byte de tag é buscado na posição corrente
    SOMENTE quando a máscara zera — inclusive no meio de um token (provado
    pelo stream real de HELLO: `48 38 45 4C B0 4F 00`). Literais, off-low e
    cmd 110 entram na posição em que o decoder os lê. Escrever bits e bytes
    na ordem de consumo produz a intercalação correta; tags são bytes
    reserva patcheados conforme os bits chegam.
    """

    def __init__(self, first: int):
        self.bytes = bytearray([first])
        self.out = bytearray([first])
        self.tag_idx = None      # índice da tag corrente (placeholder)
        self.tag_used = 0        # slots já preenchidos da tag corrente (0..8)
        self.lwm = 3
        self.last_off = None

    def w(self, *bits):
        for bit in bits:
            if self.tag_idx is None or self.tag_used == 8:
                self.tag_idx = len(self.bytes)
                self.bytes.append(0)
                self.tag_used = 0
            if bit:
                self.bytes[self.tag_idx] |= 0x80 >> self.tag_used
            self.tag_used += 1

    def d(self, byte: int):
        # Byte de dados NÃO mexe na tag: a máscara continua de onde parou.
        self.bytes.append(byte)

    def gamma2(self, v: int):
        self.w(*self._gamma_bits(v))

    def literal(self, byte: int):
        self.w(0)
        self.d(byte)
        self.out.append(byte)
        self.lwm = 3

    def token10(self, off: int, raw_len: int):
        # raw_len = valor gamma2 do comprimento (>=2); ln real = raw_len + ajuste.
        assert raw_len >= 2, "gamma2 de comprimento mínimo é 2"
        off_hi, off_lo = divmod(off, 256)
        g_off = self._gamma_bits(off_hi + self.lwm)
        g_len = self._gamma_bits(raw_len)
        self.w(1, 0)
        self.w(*g_off)
        self.d(off_lo)
        self.w(*g_len)
        ln = raw_len + (2 if (off < 128 or off >= 32000) else 1 if off >= 1280 else 0)
        src = len(self.out) - off
        assert src >= 0, f"offset {off} fora do histórico {len(self.out)}"
        for i in range(ln):
            self.out.append(self.out[src + i])
        self.last_off = off
        self.lwm = 2
        return ln

    def token10_rep(self, raw_len: int):
        # off_hi = gamma - lwm = -1 exige gamma = lwm-1 >= 2 -> lwm >= 3,
        # i.e. rep-match só é codificável logo após literal/111 (lwm=3).
        assert self.last_off is not None and raw_len >= 2 and self.lwm >= 3
        g_rep = self._gamma_bits(self.lwm - 1)
        g_len = self._gamma_bits(raw_len)
        self.w(1, 0)
        self.w(*g_rep)
        self.w(*g_len)
        off = self.last_off
        src = len(self.out) - off
        for i in range(raw_len):
            self.out.append(self.out[src + i])
        self.lwm = 2
        return raw_len

    def token110(self, off: int, ln: int):
        assert 1 <= off <= 127 and ln in (2, 3)
        self.w(1, 1, 0)
        self.d((off << 1) | (ln - 2))
        src = len(self.out) - off
        assert src >= 0
        for i in range(ln):
            self.out.append(self.out[src + i])
        self.last_off = off
        self.lwm = 2

    def token111(self, off4: int):
        assert 0 <= off4 <= 15
        self.w(1, 1, 1)
        for sh in (3, 2, 1, 0):
            self.w((off4 >> sh) & 1)
        if off4:
            self.out.append(self.out[len(self.out) - off4])
        else:
            self.out.append(0)
        self.lwm = 3

    def eod(self):
        self.w(1, 1, 0)
        self.d(0x00)

    @staticmethod
    def _gamma_bits(v: int):
        # Leitor de referência (apultra expand.c:64-75): v=1; dicionário de
        # pares (dado, continua): v=(v<<1)|d; para quando o bit de controle é 0.
        # Logo v>=2 sempre; dígitos de v sem o '1' líder, MSB->LSB, cada um
        # seguido de controle (1 exceto o último, que é 0).
        assert v >= 2, "gamma2 não representa v=1 (mínimo lido é 2)"
        digits = bin(v)[3:]
        out = []
        for i, c in enumerate(digits):
            out.append(int(c))
            out.append(0 if i == len(digits) - 1 else 1)
        return out

    def result(self):
        return bytes(self.out), bytes(self.bytes)


def mirror_decode(data: bytes):
    out, status, pos = _decode_core(data)
    if status == "ERR-eod":
        return out, pos
    if isinstance(out, (bytes, bytearray)):
        return "ERR-no-eod", pos
    return out, pos


def _decode_core(data: bytes):
    """Espelho do decoder de referência (validado vs apultra/APJ).

    Devolve (out_ou_err, status, pos). status 'ERR-eod' = terminador visto;
    caso contrário um resultado de bytes sem EOD é reportado como 'ERR-no-eod'
    (o produto deve distinguir truncamento de decodificação completa).
    """
    pos = 1
    out = bytearray([data[0]])
    mask = 0
    bits = 0
    lwm = 3
    off_hist = None

    def rb():
        nonlocal pos, mask, bits
        if mask == 0:
            if pos >= len(data):
                return None
            bits = data[pos]
            pos += 1
            mask = 128
        b = (bits & 128) >> 7
        bits = (bits << 1) & 0xFF
        mask >>= 1
        return b

    def g2():
        v = 1
        while True:
            b = rb()
            if b is None:
                return None
            v = (v << 1) | b
            b2 = rb()
            if b2 is None:
                return None
            if b2 == 0:
                return v

    step = 0
    while True:
        step += 1
        if step > 200000:
            return "LOOP", "", None
        b = rb()
        if b is None:
            return "ERR-in", "", None
        if b == 0:
            if pos >= len(data):
                return "ERR-in", "", None
            out.append(data[pos])
            pos += 1
            lwm = 3
        else:
            b = rb()
            if b is None:
                return "ERR-in", "", None
            if b == 0:
                oh = g2()
                if oh is None:
                    return "ERR-in", "", None
                oh -= lwm
                if oh >= 0:
                    if pos >= len(data):
                        return "ERR-in", "", None
                    off = (oh << 8) | data[pos]
                    pos += 1
                    ln = g2()
                    if ln is None:
                        return "ERR-in", "", None
                    if off < 128 or off >= 32000:
                        ln += 2
                    elif off >= 1280:
                        ln += 1
                else:
                    if off_hist is None:
                        return "ERR-rep-first", "", None
                    off = off_hist
                    ln = g2()
                    if ln is None:
                        return "ERR-in", "", None
                off_hist = off
                lwm = 2
                src = len(out) - off
                if src < 0:
                    return "ERR-off", "", None
                for i in range(ln):
                    out.append(out[src + i])
            else:
                b = rb()
                if b is None:
                    return "ERR-in", "", None
                if b == 0:
                    if pos >= len(data):
                        return "ERR-in", "", None
                    cmd = data[pos]
                    pos += 1
                    if cmd == 0:
                        return bytes(out), "ERR-eod", pos
                    off = cmd >> 1
                    ln = 2 + (cmd & 1)
                    off_hist = off
                    lwm = 2
                    src = len(out) - off
                    if src < 0:
                        return "ERR-off", "", None
                    for i in range(ln):
                        out.append(out[src + i])
                else:
                    off = 0
                    for sh in (3, 2, 1, 0):
                        bb = rb()
                        if bb is None:
                            return "ERR-in", "", None
                        off |= bb << sh
                    lwm = 3
                    if off:
                        src = len(out) - off
                        if src < 0:
                            return "ERR-off", "", None
                        out.append(out[src])
                    else:
                        out.append(0)


goldens = {}

s = Stream(ord("H"))
for c in b"ELLO":
    s.literal(c)
s.eod()
goldens["g01_literals"] = s.result()

s = Stream(0x5A)
s.eod()
goldens["g01b_single_byte"] = s.result()

s = Stream(ord("S"))
s.token111(0)
s.token111(1)
s.eod()
goldens["g02_short_zero"] = s.result()

s = Stream(ord("A"))
s.literal(ord("B"))
s.literal(ord("C"))
s.token110(3, 3)
s.eod()
goldens["g03_short_match"] = s.result()

s = Stream(ord("A"))
s.token10(1, 2)   # gamma=2, off=1 -> +2 -> ln=4: 'AAAA'
s.eod()
goldens["g04_long_off_lt128"] = s.result()

s = Stream(ord("X"))
s.literal(ord("Y"))
s.literal(ord("Z"))
s.token10(3, 2)
s.literal(ord("W"))          # rep-match só é codificável com lwm=3
s.token10_rep(2)
s.eod()
goldens["g05_repmatch"] = s.result()

s = Stream(ord("M"))
for c in range(255):
    s.literal(c % 256)
# precisa histórico >= 1280 para off na faixa +1: enche com RLE barato
while len(s.out) < 1400:
    s.token10(1, 250)
ln = s.token10(1280, 4)   # 1280<=off<32000 -> len raw+1
s.eod()
goldens["g06_mid_offset"] = s.result()

s = Stream(0x11)
for _ in range(64):
    s.literal(0x22)
while len(s.out) < 33000:
    s.token10(1, 253)
s.token10(32100, 3)       # off>=32000 -> +2
s.eod()
goldens["g07_far_offset"] = s.result()

s = Stream(ord("E"))
s.literal(ord("F"))
s.literal(ord("G"))
s.token110(3, 3)
s.eod()
expected_bytes, stream = s.result()
trailing = b"\xFF\xFE\xFD\xFC\xFB"
goldens["g08_eod_trailing"] = (expected_bytes, stream + trailing, len(stream))

fails = 0
for name in sorted(goldens):
    entry = goldens[name]
    expected, stream = entry[0], entry[1]
    exp_consumed = entry[2] if len(entry) > 2 else len(stream)
    got, consumed = mirror_decode(stream)
    if got != expected or consumed != exp_consumed:
        fails += 1
        print(f"{name}: FALHA espelho -> {got!r} consumed={consumed} "
              f"(esperado {len(expected)} bytes, consumed={exp_consumed})")
    else:
        print(f"{name}: espelho OK (plain={len(expected)} comp={len(stream)} consumed={consumed})")

if fails:
    sys.exit(f"{fails} golden(s) divergem do espelho — não publicar")

for name, entry in goldens.items():
    (OUT / "golden" / f"{name}.ap").write_bytes(entry[1])
    (OUT / "golden" / f"{name}.expected.bin").write_bytes(entry[0])

# ---------------------------------------------------------------------------
# Negativos: derivados do CONTRATO (ver docstring). O espelho só é usado como
# auto-verificação da condição malformada intencional; nada aqui vai aos oráculos.
# pair=(condição, (esperado_espelho, max_out_ou_None))
negatives = {}

s = Stream(ord("N"))
s.literal(ord("1"))
s.literal(ord("2"))
negatives["n01_no_eod"] = (("ERR-trunc", None), s.result())

s = Stream(ord("P"))
s.w(1, 0)
s.w(*Stream._gamma_bits(2))          # off_hi = 2-3 = -1 -> rep-match
s.w(*Stream._gamma_bits(2))
negatives["n02_rep_first_token"] = (("ERR-rep-first", None), s.result())

s = Stream(ord("Q"))
s.w(1, 0)
s.w(*Stream._gamma_bits(3))          # off_hi = 0
s.d(200)
s.w(*Stream._gamma_bits(2))
negatives["n03_far_offset"] = (("ERR-off", None), s.result())

s = Stream(ord("T"))
s.literal(ord("1"))
s.literal(ord("2"))
s.token110(3, 3)
s.w(1, 0)
s.w(*Stream._gamma_bits(4))          # token10 completo até aqui; o próximo byte
expected, stream = s.result()        # lido seria off-low -> EOF = entrada truncada
negatives["n04_truncated_mid_token"] = (("ERR-in", None), (expected, stream))

s = Stream(0xAA)                     # decodifica 260 bytes; produto com max_out<260 deve erro
s.literal(0xBB)
s.literal(0xCC)
s.token10(1, 258)
s.eod()
negatives["n05_excessive_output"] = (("ERR-eod", 16), s.result())

s = Stream(ord("S"))
s.w(1, 1, 0)
s.d(0x06)                            # off=3, len=2 -> fora do histórico (1 byte)
negatives["n06_token110_first"] = (("ERR-off", None), s.result())

s = Stream(ord("Z"))
s.w(1, 1, 1)
for sh in (3, 2, 1, 0):
    s.w((5 >> sh) & 1)               # off4=5 > histórico
negatives["n07_token111_first"] = (("ERR-off", None), s.result())

nfail = 0
for name in sorted(negatives):
    (exp_kind, max_out), (expected, stream) = negatives[name]
    core_out, core_status, core_pos = _decode_core(stream)
    if max_out is not None:
        # stream estruturalmente válido; a rejeição vem do limite de saída do produto
        ok = isinstance(core_out, (bytes, bytearray)) and core_status == "ERR-eod" \
            and len(core_out) > max_out and core_out == expected
        got = f"len={len(core_out) if isinstance(core_out, bytes) else core_out!r}"
    else:
        if exp_kind == "ERR-trunc":
            ok = core_out in ("ERR-in", "ERR-no-eod")
            got = core_out
        else:
            ok = core_out == exp_kind
            got = core_out
    if ok:
        print(f"{name}: negativo OK (condição {exp_kind} confirmada no espelho, stream={len(stream)} B)")
    else:
        nfail += 1
        print(f"{name}: FALHA — condição intencional não reproduzida no espelho: {got!r}")

if nfail:
    sys.exit(f"{nfail} negativo(s) não confirmados no espelho — não publicar")

for name, ((exp_kind, max_out), (expected, stream)) in negatives.items():
    (OUT / "negative" / f"{name}.ap").write_bytes(stream)
    if max_out is not None:
        contract, exp_out_len = "excessive-output", len(expected)
    elif exp_kind in ("ERR-trunc", "ERR-in"):
        # EOF no meio da decodificação (sem terminador, ou byte de dados/tag
        # exigido por um token válido não existe) => entrada truncada
        contract, exp_out_len = "truncated", None
    elif exp_kind in ("ERR-rep-first", "ERR-off"):
        contract, exp_out_len = "invalid-reference", None
    else:
        raise AssertionError(f"condição de negativo não mapeada: {exp_kind}")
    (OUT / "negative" / f"{name}.expected.json").write_text(json.dumps({
        "vector": name,
        "kind": "negative-spec",
        "expected_error": contract,
        "mirror_condition": exp_kind,
        "max_out": max_out,
        "full_decode_len_if_unbounded": exp_out_len,
        "stream_len": len(stream),
        "note": "Derivado do contrato/formato; oráculos de referência não validam "
                "entrada (UB além do EOF) e NÃO foram executados sobre este stream.",
    }, ensure_ascii=False) + "\n")

print(f"plain={len(plains)} golden={len(goldens)} negative={len(negatives)} em {OUT}")
