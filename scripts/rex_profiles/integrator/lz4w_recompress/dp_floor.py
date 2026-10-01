#!/usr/bin/env python3
"""PISO do formato LZ4W: parse ótimo por custo explícito, em Python, só como instrumento.

    dp_floor.py --selftest
    dp_floor.py <plain.bin> <dict.bin> [<stream-rescomp> [<stream-produto>]]

Não é código do produto. O codificador do produto é **guloso**: escolhe o melhor
match na posição corrente (com teto de 128 candidatos e lazy de 1 passo). Este
script resolve o mesmo problema por **programação dinâmica** sobre o grafo
`(posição i, literais pendentes p)`, com o custo real do formato:

    token descritor .......... 1 word  (sempre)
    literais no token ........ `lit` words
    match longo .............. +1 word (a word de offset)
    match curto .............. +0      (offset e comprimento cabem no descritor)
    terminador ............... 2 words (0x0000 + word final)

O estado `p` (0..14) existe porque a palavra de custo por token NÃO ignora o
chunk: um token carrega no máximo 15 literais, então "1 token + 15 literais" e
"1 token + 1 literal" têm custos diferentes e a pendência muda o futuro. Sem
`p` o modelo daria o resultado errado — foi exatamente assim que o DP portado de
`LZ4W.java` piorou o produto (382 B contra 380 B).

Barreiras (asserções, não comentários):
  1. o stream reconstruído pelo DP **decodifica** com o tokenizador
     INDEPENDENTE de `tokens.py` e reproduz o plain byte a byte, consumindo o
     stream inteiro;
  2. `--selftest` compara o DP com **busca exaustiva** (DFS sobre todas as
     transições) em entradas pequenas e aleatórias: sem isso nenhuma palavra
     "ótimo" ou "piso" é dita aqui.

Matches NÃO maximais são explorados. Restringir o DP a "só o comprimento máximo
por fonte" passou no selftest por acaso em 25 das 26 primeiras tentativas e
FALHOU na 26.ª (`plain=[2,2,1,2,1,0,2,1,1,1,1,2] dict=[2]`: DP 10 words contra 9
da busca exaustiva): parar um match mais cedo muda a posição seguinte, e ali o
próximo token pode gastar menos literais/descritores. O modelo então enumera
todos os comprimentos representáveis.

Isso não custa complexidade extra: para uma posição `i`, o conjunto de
comprimentos alcançáveis por alguma fonte curta é o intervalo contíguo
`[2, max_curto]` (uma prefixo de match também é match), e o das fontes longas é
`[3, max_longo]`. Basta então o mínimo de `dp[i+k][0]` sobre cada intervalo, e a
fonte testemunha do comprimento máximo serve para qualquer `k` menor.

Regras de representabilidade são as do produto (mesmas de `model_encoder.py`,
que é validada byte a byte contra o stream do produto): match curto
`2 <= len <= 16` com `off <= 0x100`; match longo `len > 2` com
`off <= 0x4000`; comprimento máximo `257`. Janela de busca `0x4000` words — a do
codificador, não o teto de hardware medido (16385), para que o número responda
"quanto o produto ainda pode ganhar".

Um match de **1 word não existe** no formato: o campo de comprimento do match
curto é `nibble - 1`, então `len = 1` codificaria `nibble = 0`, que o formato lê
como "match longo". O produto tem a mesma exigência (só aceita `len >= 2`), e a
busca exaustiva do `--selftest` usa a mesma regra.
"""
from __future__ import annotations

import random
import sys
from bisect import bisect_left
from pathlib import Path

# O decoder do produto mantém `buf = dicionário + saída` e lê offsets não-ROM
# para trás nesse histórico contíguo (o harness 68k copia o prefixo para o
# destino antes de desempacotar), então a convenção do codificador — offset no
# espaço combinado, sem o bit 0x8000 — é a mesma que o hardware validou nos 12
# casos de `docs/rex_profiles/LZ4W_68K_ORACLE.md`.
SHORT_MAX_OFF = 0x100
SHORT_MAX_LEN = 0xF + 1          # nibble + 1  => 1..16
LONG_MIN_LEN = 3                 # len > 2
LONG_MAX_LEN = 0xFF + 2          # match_byte + 2 => até 257
WINDOW = 0x4000
LIT_MAX = 15
OFFSET_MASK = 0x7FFF
TERMINATOR_WORDS = 2


def words_of(blob: bytes) -> list[int]:
    return [(blob[2 * i] << 8) | blob[2 * i + 1] for i in range(len(blob) // 2)]


def match_length(total: list[int], j: int, off: int) -> int:
    """Comprimento máximo da cópia em `j` lendo `off` words para trás.

    A cópia do desempacotador é palavra a palavra PARA FRENTE, então uma origem
    que se sobrepõe ao destino (RLE) é legal: o word lido é o que acabou de ser
    escrito, que é exatamente `total[j + k - off]` do plain.
    """
    length = 1
    while (j + length < len(total) and length < LONG_MAX_LEN
           and total[j + length] == total[j + length - off]):
        length += 1
    return length


def solve(total: list[int], dict_words: int, plain_words: int):
    """DP sobre (posição i, literais pendentes p). Retorna (palavras, escolha).

    Exato: enumera todos os comprimentos representáveis (não só os maximais),
    explorando os intervalos `[2, max_curto]` e `[3, max_longo]` por posição.
    """
    n = plain_words
    inf = float("inf")
    # dp[i][p]: custo em words para cobrir plain[i:] com p literais pendentes.
    dp = [[inf] * LIT_MAX for _ in range(n + 1)]
    choice: list[list[tuple | None]] = [[None] * LIT_MAX for _ in range(n + 1)]
    for p in range(LIT_MAX):
        dp[n][p] = (1 + p) if p > 0 else 0
        choice[n][p] = ("fim", p)

    by_value: dict[int, list[int]] = {}
    # Todas as fontes possíveis, em ordem crescente (o bisect recorta a janela
    # `[j-WINDOW, j)`). Restrição de precedência: a fonte tem de estar ANTES da
    # posição corrente — o desempacotador só lê para trás.
    for s in range(max(0, dict_words - WINDOW), dict_words + n):
        by_value.setdefault(total[s], []).append(s)

    for i in range(n - 1, -1, -1):
        j = dict_words + i
        lo = bisect_left(lst := by_value.get(total[j], ()), j - WINDOW)
        hi = bisect_left(lst, j)
        # Melhor comprimento alcançável por fonte curta (off <= 0x100) e por
        # fonte longa (off <= WINDOW), com a testemunha de cada um.
        max_short, src_short = 0, None
        max_long, src_long = 0, None
        for s in lst[lo:hi]:
            off = j - s
            length = match_length(total, j, off)
            if length > max_long:
                max_long, src_long = length, s
            if off <= SHORT_MAX_OFF and length > max_short:
                max_short, src_short = length, s

        # Custo de fechar um match de `k` words na posição i: base do token + o
        # resto a partir de i+k. Como a base independe de `p`, o mínimo sobre o
        # intervalo é o mesmo para qualquer pendência.
        best = {"curto": (inf, None), "longo": (inf, None)}
        if src_short is not None and max_short >= 2:
            base, src = 1, src_short
            for k in range(2, min(max_short, SHORT_MAX_LEN) + 1):
                cand = base + dp[i + k][0]
                if cand < best["curto"][0]:
                    best["curto"] = (cand, k)
        if src_long is not None and max_long >= LONG_MIN_LEN:
            base, src = 2, src_long
            for k in range(LONG_MIN_LEN, min(max_long, LONG_MAX_LEN) + 1):
                cand = base + dp[i + k][0]
                if cand < best["longo"][0]:
                    best["longo"] = (cand, k)

        for p in range(LIT_MAX - 1, -1, -1):
            # 1) literal na posição i
            if p == LIT_MAX - 1:
                cost, move = dp[i + 1][0] + 1 + LIT_MAX, ("flush",)
            else:
                cost, move = dp[i + 1][p + 1], ("lit",)
            # 2) matches a partir de i (qualquer comprimento representável)
            for kind, (core, k) in best.items():
                if k is None:
                    continue
                cand = core + p
                if cand < cost:
                    off = j - (src_short if kind == "curto" else src_long)
                    cost, move = cand, (kind, k, off)
            dp[i][p] = cost
            choice[i][p] = move

    return dp, choice


def solve_exact(total: list[int], dict_words: int, plain_words: int) -> int:
    """Busca exaustiva (DFS com memo) permitindo matches NÃO maximais.

    Só para entradas pequenas: é a referência contra a qual o DP é validado.
    """
    n = plain_words
    memo: dict[tuple[int, int], int] = {}

    def go(i: int, p: int) -> int:
        if i == n:
            return (1 + p) if p > 0 else 0
        key = (i, p)
        if key in memo:
            return memo[key]
        j = dict_words + i
        if p == LIT_MAX - 1:
            best = 1 + LIT_MAX + go(i + 1, 0)
        else:
            best = go(i + 1, p + 1)
        for s in range(max(0, j - WINDOW), j):
            off = j - s
            if total[s] != total[j]:
                continue
            length = match_length(total, j, off)
            if off <= SHORT_MAX_OFF and length >= 2:
                for k in range(2, min(length, SHORT_MAX_LEN) + 1):
                    best = min(best, 1 + p + go(i + k, 0))
            if length >= LONG_MIN_LEN:
                for k in range(LONG_MIN_LEN, length + 1):
                    best = min(best, 2 + p + go(i + k, 0))
        memo[key] = best
        return best

    return go(0, 0)


def render(total: list[int], dict_words: int, choice, plain_words: int) -> bytes:
    """Reconstrói o stream a partir das escolhas da DP (palavras -> bytes BE)."""
    out: list[int] = []
    literals: list[int] = []
    i = 0
    while i < plain_words:
        move = choice[i][len(literals)] if i < plain_words else None
        kind = move[0] if move else "fim"
        if kind == "lit":
            literals.append(total[dict_words + i])
            i += 1
            continue
        if kind == "flush":
            literals.append(total[dict_words + i])
            assert len(literals) == LIT_MAX
            out.append(LIT_MAX << 12)
            out += literals
            literals = []
            i += 1
            continue
        if kind == "fim":
            break
        _, length, off = move
        short = kind == "curto"
        # Representabilidade: os campos têm de caber no descritor real. Sem esta
        # asserção um bug de modelo viraria um stream ilegível (ou, pior, legível
        # com outro significado) em vez de uma falha.
        if short:
            assert 2 <= length <= SHORT_MAX_LEN and 1 <= off <= SHORT_MAX_OFF, \
                f"curto irrepresentável: len={length} off={off}"
        else:
            assert LONG_MIN_LEN <= length <= LONG_MAX_LEN and 1 <= off <= WINDOW, \
                f"longo irrepresentável: len={length} off={off}"
        token = (len(literals) << 12)
        if short:
            token |= ((length - 1) << 8) | (off - 1)
        else:
            token |= (length - 2)
        out.append(token)
        out += literals
        if not short:
            out.append((1 - off) & OFFSET_MASK)
        literals = []
        i += length
    if literals:
        out.append(len(literals) << 12)
        out += literals
    out.append(0)
    out.append(0)
    blob = bytearray()
    for value in out:
        blob += value.to_bytes(2, "big")
    return bytes(blob)


def selftest(trials: int = 60, seed: int = 20260926, *, n_min: int = 1,
             n_max: int = 12, d_min: int = 0, d_max: int = 6,
             alpha_min: int = 1, alpha_max: int = 4,
             windows: tuple[int, ...] | None = None) -> int:
    """DP == busca exaustiva (DFS sobre todas as transições representáveis).

    Valida também a barreira 1 em cada tentativa: o stream que a DP emite
    decodifica de volta ao plain com o tokenizador independente de `tokens.py`.

    `windows` reduz a janela de busca (o global `WINDOW`, lido em tempo de
    chamada por `solve` e `solve_exact`) para que os casos exerçam o recorte de
    janela, coisa que entradas pequenas com a janela real de 0x4000 nunca tocam.
    """
    global WINDOW
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from tokens import tokenize

    rng = random.Random(seed)
    worst = 0
    failures = 0
    checked = 0
    saved_window = WINDOW
    try:
        for win in (windows or (WINDOW,)):
            WINDOW = win
            for t in range(trials):
                n = rng.randint(n_min, n_max)
                d = rng.randint(d_min, d_max)
                alphabet = rng.randint(alpha_min, alpha_max)
                dict_list = [rng.randrange(alphabet) for _ in range(d)]
                plain_list = [rng.randrange(alphabet) for _ in range(n)]
                total = dict_list + plain_list
                dict_blob = _be(dict_list)
                plain_blob = _be(plain_list)
                checked += 1

                dp, choice = solve(total, d, n)
                a = dp[0][0] + TERMINATOR_WORDS
                b = solve_exact(total, d, n) + TERMINATOR_WORDS
                if a != b:
                    failures += 1
                    print(f"  FALHA trial {t} (win={win:#x}): dp={a} "
                          f"exaustivo={b} n={n} d={d} plain={plain_list} "
                          f"dict={dict_list}")
                else:
                    stream = render(total, d, choice, n)
                    if len(stream) // 2 != a:
                        failures += 1
                        print(f"  FALHA custo declarado trial {t} (win={win:#x}): "
                              f"modelo {a} words, stream {len(stream) // 2}")
                    else:
                        back, _tk, consumed = tokenize(stream, dict_blob)
                        if back != plain_blob or consumed != len(stream):
                            failures += 1
                            print(f"  FALHA barreira 1 trial {t} (win={win:#x}): "
                                  f"reproduz={back == plain_blob} "
                                  f"consumido={consumed}/{len(stream)}")
                worst = max(worst, n)
                if failures >= 5:
                    print("selftest: abortando após 5 falhas")
                    return 1
    finally:
        WINDOW = saved_window
    if failures:
        print(f"selftest: {failures}/{checked} FALHAS")
        return 1
    print(f"selftest: {checked} entradas (até {worst} words, alfabeto "
          f"{alpha_min}..{alpha_max}, janelas "
          f"{', '.join(hex(w) for w in (windows or (saved_window,)))}) — DP "
          f"coincide com a busca exaustiva em TODAS e cada stream reproduz o "
          f"plain via tokens.py")
    return 0


def _be(values: list[int]) -> bytes:
    blob = bytearray()
    for v in values:
        blob += v.to_bytes(2, "big")
    return bytes(blob)


def suite() -> int:
    """Bateria de barreiras do `--selftest`.

    As configurações não são redundantes: a contagem de transições mostrou que
    só "pequena/grande" jamais emite match longo (todo match caberia como
    curto) e jamais encosta no teto curto de 16 words. Por isso entram "fontes
    distantes" (dicionário acima de `SHORT_MAX_OFF`, onde só o formato longo
    alcança) e "repetição" (alfabeto de 1 word, onde os tetos de 16 e 257 são
    tocados).
    """
    configs = [
        ("pequena (n<=12, dicionário <=6, alfabeto 1..4)",
         dict(trials=400, seed=777)),
        ("semeia histórica",
         dict(trials=400, seed=20260926)),
        ("flush (n 15..34, alfabeto 2..8: literais encostam em 15)",
         dict(trials=120, seed=31337, n_min=15, n_max=34, d_min=4, d_max=40,
              alpha_min=2, alpha_max=8)),
        ("janela curta (recorte de WINDOW exercitado)",
         dict(trials=150, seed=90210, n_min=6, n_max=18, d_min=6, d_max=24,
              alpha_min=1, alpha_max=3, windows=(2, 4, 9, 0x101))),
        ("fontes distantes (dicionário > 0x100: só match longo alcança)",
         dict(trials=40, seed=5, n_min=8, n_max=24, d_min=260, d_max=420,
              alpha_min=1, alpha_max=3)),
        ("repetição (alfabeto 1 word: tetos de 16 e 257 words)",
         dict(trials=20, seed=6, n_min=20, n_max=40, d_min=1, d_max=6,
              alpha_min=1, alpha_max=1)),
        ("repetição longa (n 60..90: vários tokens longos em cadeia)",
         dict(trials=5, seed=7, n_min=60, n_max=90, d_min=1, d_max=8,
              alpha_min=1, alpha_max=1)),
    ]
    rc = 0
    for label, kwargs in configs:
        print(f"[selftest] {label}")
        rc |= selftest(**kwargs)
    rc |= rle_barrier()
    return rc


def rle_barrier() -> int:
    """Barreira extra no único ponto que a busca exaustiva não alcança.

    Com 200..512 words idênticas o ótimo usa repetidamente o comprimento máximo
    do formato; o DFS exaustivo sobre esse tamanho custa caro sem necessidade,
    então aqui a referência trocada é outra, e dela não se tira a palavra "ótimo":
    (a) o stream decodifica de volta ao plain pelo `tokens.py` independente,
    (b) o custo declarado pelo modelo é exatamente o comprimento do stream, e
    (c) algum match encosta no teto de 257 words — sem (c) a barreira não diria
    nada sobre o caminho que se quis exercitar.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from tokens import tokenize
    for n in (200, 258, 300, 512):
        total = [0xAA55] * (n + 1)
        dp, choice = solve(total, 1, n)
        claimed = dp[0][0] + TERMINATOR_WORDS
        stream = render(total, 1, choice, n)
        plain = _be(total[1:])
        back, tokens, consumed = tokenize(stream, _be(total[:1]))
        if back != plain or consumed != len(stream) or len(stream) // 2 != claimed:
            print(f"[rle] FALHA n={n}: reproduz={back == plain} "
                  f"stream={len(stream) // 2} modelo={claimed} "
                  f"consumido={consumed}")
            return 1
        longest = max((t.get("match_words", 0) for t in tokens), default=0)
        print(f"[rle] n={n} words: piso {claimed} words = {claimed * 2} B, "
              f"{len(tokens)} tokens, match mais longo {longest} words "
              f"(teto do formato {LONG_MAX_LEN})")
        if n > LONG_MAX_LEN and longest != LONG_MAX_LEN:
            print(f"[rle] FALHA n={n}: nenhum match encostou no teto de 257")
            return 1
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if "--selftest" in argv:
        return suite()
    if len(argv) < 2:
        print(__doc__)
        return 2
    plain = open(argv[0], "rb").read()
    dictionary = open(argv[1], "rb").read()
    if len(plain) % 2:
        print("este instrumento exige plain de extensão par")
        return 2

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from tokens import tokenize  # tokenizador INDEPENDENTE, barreira 1

    dict_w = words_of(dictionary)
    plain_w = words_of(plain)
    total = dict_w + plain_w
    dp, choice = solve(total, len(dict_w), len(plain_w))
    words = dp[0][0] + TERMINATOR_WORDS
    stream = render(total, len(dict_w), choice, len(plain_w))

    back, tokens, consumed = tokenize(stream, dictionary)
    assert len(stream) // 2 == words, (
        f"modelo anuncia {words} words, stream tem {len(stream) // 2}")
    assert back == plain, "o stream do DP não reproduz o plain (barreira 1)"
    assert consumed == len(stream), (
        f"stream do DP consumido parcialmente: {consumed} de {len(stream)}")

    print(f"plain {len(plain)} B ({len(plain_w)} words), dicionário "
          f"{len(dictionary)} B ({len(dict_w)} words)")
    print(f"piso do formato nesta janela: {words} words = {words * 2} bytes "
          f"({len(tokens)} tokens)")
    for name, path in (("rescomp", argv[2] if len(argv) > 2 else None),
                       ("produto", argv[3] if len(argv) > 3 else None)):
        if not path:
            continue
        blob = open(path, "rb").read()
        _, tk, cons = tokenize(blob, dictionary)
        got = len(blob)
        delta = got - words * 2
        print(f"{name:>8}: {got} B ({len(tk)} tokens, consumido {cons}) "
              f"| gap sobre o piso: {delta:+d} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
