#!/usr/bin/env python3
"""Tokenizador LZ4W INDEPENDENTE do decoder em Rust.

Uso:
    tokens.py <plain.bin> <dict.bin> <stream.bin> [<stream2.bin> ...]

Ele não confia em `lz4w_decode_with_dictionary`: reimplementa o formato a
partir do unpacker oficial (`tools_a.s` do SGDK 2.11) e SÓ imprime a análise
depois de reproduzir o plain byte a byte e consumir o stream inteiro. Se o
parser estivesse errado, a análise estaria errada junto — por isso a barreira
vem antes de qualquer número.

Custo de um token (em words, o stream é big-endian de words):
    1 (o próprio token) + literal_words + (1 se match longo com word de offset)
Match curto não paga word extra: offset e comprimento cabem no token.
"""
import sys

MATCH_MIN_SIZE = 1          # comprimento = nibble + 1
MATCH_LONG_MIN_SIZE = 2     # comprimento = match_byte + 2
ROM_SOURCE_FLAG = 0x8000
OFFSET_MASK = 0x7FFF


def word(stream, pos):
    if pos + 2 > len(stream):
        raise ValueError(f"stream truncado em {pos}")
    return (stream[pos] << 8) | stream[pos + 1]


def tokenize(stream, dictionary):
    """Retorna (plain, tokens, consumed). Cada token é um dict de contabilidade."""
    buf = bytearray(dictionary)
    dict_len = len(buf)
    tokens = []
    offset_adj = 0
    pos = 0
    while True:
        out_before = (len(buf) - dict_len) // 2
        token_at = pos
        tok = word(stream, pos)
        pos += 2
        offset_adj += 1
        if tok == 0:
            final_at = pos
            final = word(stream, final_at)
            cost_words = 1
            produced = 0
            if final & ROM_SOURCE_FLAG:
                buf.append(final & 0xFF)
                produced = 1
                cost_words = 2
            elif final != 0:
                raise ValueError(f"word final {final:#06x} sem flag de byte ímpar")
            tokens.append({
                "kind": "terminador",
                "at": token_at,
                "word": tok,
                "out_word": out_before,
                "cost_words": cost_words,
                "produced_words": produced,
                "detail": f"final={final:#06x}",
            })
            consumed = token_at + 4
            return bytes(buf[dict_len:]), tokens, min(consumed, len(stream))

        literal_words = (tok >> 12) & 0xF
        match_nibble = (tok >> 8) & 0xF
        match_byte = tok & 0xFF
        cost_words = 1
        lits_at = pos
        pos += literal_words * 2
        cost_words += literal_words
        buf += stream[lits_at:lits_at + literal_words * 2]

        match_words = 0
        kind = "literal"
        detail = f"{literal_words} literais"
        if match_nibble > 0:
            match_words = match_nibble + MATCH_MIN_SIZE
            offset_words = match_byte + 1
            kind = "curto"
            detail = (
                f"{literal_words} lit + match {match_words}w @{offset_words}w "
                f"(curto, <= 0x100)"
            )
        elif match_byte > 0:
            enc_at = pos
            encoded = word(stream, enc_at)
            pos += 2
            cost_words += 1
            offset_adj += 1
            raw_offset = ((-encoded) & OFFSET_MASK) + 1
            match_words = match_byte + MATCH_LONG_MIN_SIZE
            if encoded & ROM_SOURCE_FLAG:
                offset_words = raw_offset - offset_adj
                kind = "longo-rom"
            else:
                offset_words = raw_offset
                kind = "longo"
            detail = (
                f"{literal_words} lit + match {match_words}w @{offset_words}w "
                f"(longo, bruto={raw_offset} adj={offset_adj} v={encoded:#06x})"
            )
        src = len(buf) - offset_words * 2 if match_words else 0
        for _ in range(match_words):
            buf += bytes(buf[src:src + 2])
            src += 2
        if match_words:
            offset_adj -= match_words
        tokens.append({
            "kind": kind,
            "at": token_at,
            "word": tok,
            "out_word": out_before,
            "cost_words": cost_words,
            "produced_words": (len(buf) - dict_len) // 2 - out_before,
            "detail": detail,
            "literals": literal_words,
            "match_words": match_words,
        })


def report(name, path, plain_expect, dictionary):
    stream = open(path, "rb").read()
    plain, tokens, consumed = tokenize(stream, dictionary)
    ok = plain == plain_expect
    print(f"\n===== {name}: {path} ({len(stream)} bytes) =====")
    print(
        f"  plain reproduzido: {'SIM' if ok else 'NÃO'}   "
        f"consumido: {consumed}/{len(stream)}   tokens: {len(tokens)}"
    )
    if not ok:
        raise AssertionError(f"{name}: o tokenizador independente NÃO reproduziu o plain")
    if consumed != len(stream):
        raise AssertionError(f"{name}: sobrou stream ({len(stream) - consumed} bytes)")
    kinds = {}
    for t in tokens:
        kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
    lit = sum(t["cost_words"] for t in tokens)
    out = sum(t["produced_words"] for t in tokens)
    print(f"  kinds: {kinds}")
    print(f"  custo em words: {lit}  |  saída: {out} words ({out * 2} bytes)  "
          f"|  words de saída por word de stream: {out / lit:.3f}")
    print("  #  offset  custo  cobre   out    detalhe")
    for i, t in enumerate(tokens):
        print(f"{i:3d}  {t['at']:#06x}  {t['cost_words']:5d}  {t['produced_words']:5d}  "
              f"{t['out_word']:5d}  {t['kind']:10s} {t['detail']}")
    return tokens


def diff(a_name, a, b_name, b):
    """Compara o custo das duas codificações apportionando o custo de cada
    token pela fração da faixa que ele cobre — somar o custo inteiro em cada
    subfaixa contaria o mesmo token mais de uma vez."""
    print(f"\n===== {a_name} x {b_name}: custo por faixa da saída "
          f"(cost apportionado, em words) =====")
    bounds = sorted({t["out_word"] for t in a} | {t["out_word"] for t in b}
                    | {t["out_word"] + t["produced_words"] for t in a}
                    | {t["out_word"] + t["produced_words"] for t in b})
    print("  faixa(out)   | tokens |  words  | tokens |  words  | delta")
    total = 0.0

    def cost(tokens, lo, hi):
        sel = [t for t in tokens if t["out_word"] < hi and t["out_word"] + t["produced_words"] > lo]
        own = sum(t["cost_words"] * (min(hi, t["out_word"] + t["produced_words"])
                                     - max(lo, t["out_word"])) / max(t["produced_words"], 1)
                  for t in sel)
        return len(sel), own

    for lo, hi in zip(bounds, bounds[1:]):
        na, ca = cost(a, lo, hi)
        nb, cb = cost(b, lo, hi)
        if abs(cb - ca) < 1e-9:
            continue
        total += cb - ca
        print(f"  {lo:4d}..{hi:<4d}   |  {na:3d}   | {ca:7.2f}   |  {nb:3d}   "
              f"| {cb:7.2f}   | {cb - ca:+.2f}")
    print(f"  soma dos deltas: {total:+.2f} words = {total * 2:+.0f} bytes")


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    plain_expect = open(sys.argv[1], "rb").read()
    dictionary = open(sys.argv[2], "rb").read()
    streams = sys.argv[3:]
    parsed = [(s, report(f"stream{s}", s, plain_expect, dictionary)) for s in streams]
    print(f"\nplain: {len(plain_expect)} bytes ({len(plain_expect) // 2} words)   "
          f"dicionário: {len(dictionary)} bytes")
    for (na, a), (nb, b) in zip(parsed, parsed[1:]):
        diff(na.rsplit("/", 1)[-1], a, nb.rsplit("/", 1)[-1], b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
