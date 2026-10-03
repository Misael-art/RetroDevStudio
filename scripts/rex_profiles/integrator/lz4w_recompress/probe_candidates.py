#!/usr/bin/env python3
"""Onde o orçamento de candidatos do LZ4W está custando bytes.

    probe_candidates.py <plain.bin> <dict.bin>

Compara três modelos de busca na mesma posição, sem tocar no código do produto:

  ideal     — todos os candidatos da janela (sem teto);
  real      — o que `rex_codecs.rs` faz: a tabela do dicionário primeiro,
              mais-próximos-primeiro, com orçamento de 128 candidatos
              COMPARTILHADO com a tabela de saída;
  mesclado  — proposta: as duas tabelas percorridas em ordem de proximidade
              mesclada, mesmo orçamento de 128.

Reporta as posições em que `mesclado` encontra um match aceitável que `real`
não vê, com o custo em words de cada forma. É instrumento de medição: não
muda comportamento nenhum.
"""
import sys

WINDOW = 0x4000
CAP = 128
SHORT_MAX_OFF = 0x100
LONG_MIN_SIZE = 2
MIN_SIZE = 1
LONG_MAX_LEN = 0xFF + LONG_MIN_SIZE


def words(blob):
    return [(blob[i] << 8) | blob[i + 1] for i in range(0, len(blob) - 1, 2)]


def match_len(buf, src, pos, limit):
    """Copiado word a word PARA FRENTE pelo desempacotador: sobreposição é
    permitida, então o match continua com período `pos - src` (RLE)."""
    period = pos - src
    n = 0
    while n < limit and buf[pos + n] == buf[src + (n % period)]:
        n += 1
    return n


def representable(length, off):
    return (length > LONG_MIN_SIZE and off <= WINDOW) or (
        MIN_SIZE <= length <= 0xF + MIN_SIZE and off <= SHORT_MAX_OFF)


def cost_words(length, off):
    """Words de stream que um token com esse match paga: match curto custa 1
    (o próprio token), match longo custa 2 (token + word de offset)."""
    return 1 if (MIN_SIZE <= length <= 0xF + MIN_SIZE and off <= SHORT_MAX_OFF) else 2


def best_from(buf, j, cands, limit):
    best = None
    for c in cands:
        off = j - c
        length = match_len(buf, c, j, limit)
        if best is None or length > best[0] or (length == best[0] and off < best[1]):
            best = (length, off)
    return best


def main():
    plain = words(open(sys.argv[1], "rb").read())
    dictionary = words(open(sys.argv[2], "rb").read())
    buf = dictionary + plain
    dict_words = len(dictionary)
    n = len(buf)
    print(f"plain {len(plain)} words | dicionário {dict_words} words | "
          f"janela {WINDOW} | cap {CAP} candidatos compartilhados")
    print("   pos   word   ideal      real         mesclado     ganho")
    gained = 0
    missed = 0
    hits = 0
    for i in range(len(plain) - 1):
        j = dict_words + i
        start = max(0, j - WINDOW)
        cands = [j - k for k in range(1, j - start + 1) if buf[j - k] == buf[j]]
        if not cands:
            continue
        hits += 1
        limit = n - j
        dic = [c for c in cands if c < dict_words]
        out = [c for c in cands if c >= dict_words]
        # real: dicionário até esgotar o cap; a tabela de saída recebe no máximo
        # um avaliador extra depois que `checked >= CAP` fica verdadeiro.
        real_cands = dic[:CAP] + (dic[CAP:CAP + 1] + out[:1] if len(dic) >= CAP else out)
        ideal = best_from(buf, j, cands, limit)
        real = best_from(buf, j, real_cands, limit)
        merged = best_from(buf, j, cands[:CAP], limit)
        if ideal is None:
            continue

        def price(match):
            if not match or not representable(*match):
                return None
            return cost_words(*match)

        if merged and price(merged) is not None:
            if price(real) is None:
                missed += 1
                print(f"  {i:4d}  {buf[j]:#06x}  {str(ideal):10s}  {str(real):11s}  "
                      f"{str(merged):11s}  real não vê match aceitável (orçamento esgotado)")
            elif price(real) > price(merged):
                gained += price(real) - price(merged)
                print(f"  {i:4d}  {buf[j]:#06x}  {str(ideal):10s}  {str(real):11s}  "
                      f"{str(merged):11s}  {price(real) - price(merged):+d} words")
    print(f"posições com candidatos: {hits} | ganho potencial total: {gained} words "
          f"({gained * 2} bytes) — antes de lazy, chunking de literais e custo do terminador")
    return 0


if __name__ == "__main__":
    sys.exit(main())
