#!/usr/bin/env python3
"""RÉPLICA do codificador guloso do produto, em Python, para diagnóstico.

    model_encoder.py <plain.bin> <dict.bin> [<stream-esperado.bin>] [--trace ini fim]

Não é o código do produto: é uma réplica linha a linha de
`lz4w_encode_with_dictionary_index` (`src-tauri/src/tools/reverse/decomp/rex_codecs.rs`)
para poder INVERTER as decisões e mostrar por que o guloso emite o que emite.
Só vale como instrumento se reproduzir o stream do produto byte a byte, então
ele próprio se verifica: quando `<stream-esperado>` é dado, a igualdade é
asserção, não comentário.

CONGELADA NA REVISÃO ANTERIOR DO CODIFICADOR: esta réplica percorre a tabela do
dicionário antes da da saída (comportamento de 2026-09-26-r1). Depois da correção
"ordem mesclada por proximidade" o produto emite outro stream; a réplica continua
válida contra `sa-product.stream` de r1 e NÃO contra o de r3. Ela existe para
reproduzir o diagnóstico documentado em
`docs/rex_profiles/LZ4W_ENCODER_444_VS_448_2026-09-26.md`, não para acompanhar o
código do produto.

Regras replicadas (com os nomes do Rust):
  * `find_best(j)`: candidatos da mesma word, mais próximos primeiro,
    janela `ENCODER_WINDOW_WORDS = 0x4000`, teto de 128 candidatos avaliados,
    desempate "mais longo, depois menor offset";
  * aceite: `(len > 2 && off <= 0x4000) || (2 <= len <= 16 && off <= 0x100)`;
  * lazy de 1 passo: `take_match = next_len <= len`;
  * `out_positions` registra a palavra inicial de cada match e cada literal —
    as palavras INTERMEDIÁRIAS de um match não são registradas;
  * `emit_segment`: curto `lit<<12|(len-1)<<8|(off-1)`, longo
    `lit<<12|(len-2)` + word de offset `((-(off-1)) & 0x7FFF)`.
"""
import sys

WINDOW = 0x4000
CAP = 128
LIT_MAX = 15
SHORT_MAX_OFF = 0x100
MIN_SIZE = 1          # MATCH_MIN_SIZE: len = nibble + 1
LONG_MIN_SIZE = 2     # MATCH_LONG_MIN_SIZE: len = match_byte + 2
LONG_MAX_LEN = 0xFF + LONG_MIN_SIZE
MASK15 = 0x7FFF


def w(blob, i):
    return (blob[2 * i] << 8) | blob[2 * i + 1]


def encode(plain, dictionary, trace=None):
    data = plain
    total = [w(dictionary, i) for i in range(len(dictionary) // 2)]
    total += [w(data, i) for i in range(len(data) // 2)]
    dict_words = len(dictionary) // 2
    word_count = len(data) // 2
    total_words = len(total)

    def word_at(j):
        return total[j]

    dict_positions = {}
    for i in range(dict_words):
        dict_positions.setdefault(total[i], []).append(i)
    out_positions = {}
    out = bytearray()
    literals = []
    decisions = []

    def consider(j, pos, best, checked):
        off = j - pos
        length = 1
        while (j + length < total_words
               and word_at(j + length) == word_at(j + length - off)
               and length < LONG_MAX_LEN):
            length += 1
        if best is None or length > best[0] or (length == best[0] and off < best[1]):
            best = (length, off)
        checked += 1
        return best, checked, checked >= CAP or (best is not None and best[0] >= LONG_MAX_LEN)

    def find_best(j):
        cur = word_at(j)
        window_start = max(0, j - WINDOW)
        best = None
        checked = 0
        seen = 0
        for table in (dict_positions, out_positions):
            for pos in reversed(table.get(cur, [])):
                if pos < window_start:
                    break
                seen += 1
                best, checked, stop = consider(j, pos, best, checked)
                if stop:
                    break
        if best is None:
            return None, seen
        length, off = best
        representable = (length > LONG_MIN_SIZE and off <= WINDOW) or (
            MIN_SIZE <= length <= 0xF + MIN_SIZE and off <= SHORT_MAX_OFF)
        return (best if representable else None), seen

    def emit_segment(match_info):
        nonlocal out, literals
        while True:
            lit = min(len(literals), LIT_MAX)
            if match_info is not None:
                length, off = match_info
                short = (MIN_SIZE <= length <= 0xF + MIN_SIZE
                         and off <= SHORT_MAX_OFF)
                if short:
                    token = (lit << 12) | ((length - MIN_SIZE) << 8) | (off - 1)
                    out += token.to_bytes(2, "big")
                    for x in literals[:lit]:
                        out += x.to_bytes(2, "big")
                    del literals[:lit]
                    return
                if (length > LONG_MIN_SIZE and off <= WINDOW
                        and len(literals) <= LIT_MAX):
                    token = (lit << 12) | (length - LONG_MIN_SIZE)
                    out += token.to_bytes(2, "big")
                    for x in literals[:lit]:
                        out += x.to_bytes(2, "big")
                    del literals[:lit]
                    out += ((((1 - off) & MASK15))).to_bytes(2, "big")
                    return
            if lit == 0:
                if match_info is None:
                    return
                raise AssertionError(
                    f"match não representável sem literais: {match_info}")
            token = lit << 12
            out += token.to_bytes(2, "big")
            for x in literals[:lit]:
                out += x.to_bytes(2, "big")
            del literals[:lit]

    i = 0
    while i < word_count:
        j = dict_words + i
        current, seen_cur = find_best(j)
        nxt, seen_next = find_best(j + 1) if i + 1 < word_count else (None, 0)
        if current is None:
            take = False
        elif i + 1 >= word_count:
            take = True
        else:
            take = nxt is None or nxt[0] <= current[0]
        chosen = current if (current is not None and take and current[0] >= 2) else None
        if trace and trace[0] <= i <= trace[1]:
            decisions.append(
                f"  i={i:4d} word={word_at(j):#06x} melhor={current} "
                f"(candidatos vistos={seen_cur}) próximo={nxt} "
                f"(vistos={seen_next}) -> {'MATCH' if chosen else 'literal'}")
        if chosen is not None:
            length, off = chosen
            emit_segment(chosen)
            out_positions.setdefault(word_at(j), []).append(j)
            i += length
        else:
            if len(literals) == LIT_MAX:
                emit_segment(None)
            literals.append(word_at(j))
            out_positions.setdefault(word_at(j), []).append(j)
            i += 1
    emit_segment(None)
    out += (0).to_bytes(2, "big")
    if len(data) % 2 == 1:
        out += (0x8000 | data[-1]).to_bytes(2, "big")
    else:
        out += (0).to_bytes(2, "big")
    return bytes(out), decisions


def main():
    argv = sys.argv[1:]
    trace = None
    if "--trace" in argv:
        k = argv.index("--trace")
        lo, hi = argv[k + 1].split(":")
        trace = (int(lo), int(hi))
        argv = argv[:k] + argv[k + 2:]
    plain = open(argv[0], "rb").read()
    dictionary = open(argv[1], "rb").read()
    stream, decisions = encode(plain, dictionary, trace)
    print(f"réplica: {len(stream)} bytes (plain {len(plain)} B, dicionário "
          f"{len(dictionary)} B)")
    if len(argv) > 2:
        expect = open(argv[2], "rb").read()
        same = stream == expect
        print(f"stream do produto: {len(expect)} bytes | idêntico: {'SIM' if same else 'NÃO'}")
        if not same:
            for k in range(min(len(stream), len(expect))):
                if stream[k] != expect[k]:
                    print(f"  primeira divergência no byte {k}: réplica "
                          f"{stream[k]:#04x} vs produto {expect[k]:#04x}")
                    break
            raise AssertionError("a réplica não reproduz o codificador do produto")
    for line in decisions:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
