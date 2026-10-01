#!/usr/bin/env python3
"""Testes de resposta conhecida dos contratos graficos MD (tile 4bpp, nametable, paleta).

Nenhum caso depende de ROM: as respostas sao sabidas por construcao (bit a bit) ou
por oraculo externo fixado por SHA. Rodar:
  python3 scripts/rex_corpus_b/test-md-tiles.py

Proveniencia das respostas externas (medidas, nao lembradas):
  * `rescomp.jar` (SGDK 2.11, ResComp 3.95) sha256
    502a467047df66b7e4c24023fa2ccdceae3e963aee664ede4bdc28fb0f55e603, executado em
    2026-09-30 sobre um PNG 8x8 autoral com pixel(r,c) = (r*8+c) & 15, definicao
    `TILESET tiles "tiles.png" NONE NONE ROW`, emitindo em `out.s`:
        dc.b 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef   (x4, 32 bytes)
    Fontes do mesmo pacote (`tools/commons/src/sgdk/tool/ImageUtil.java`
    `convert8bppTo4bpp`, `tools/rescomp/src/sgdk/rescomp/type/Tile.java`
    "8 pixels of 4bpp per 'int' entry", `resource/Tileset.java`): nenhum passo
    planar existe na ferramenta; o que vai para a ROM e o pacote chunky.
  * `Tile.java` da mesma arvore fornece os campos da palavra de nametable:
    TILE_HFLIP_SFT=11, TILE_VFLIP_SFT=12, TILE_PALETTE_SFT=13 (2 bits),
    TILE_PRIORITY_SFT=15, mascara de indice 0x7FF (2048 tiles).
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("mdt", os.path.join(HERE, "md-tiles.py"))
MD = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MD)

checks = {"ok": 0, "fail": 0}
fails = []


def eq(nome, obtido, esperado):
    try:
        ok = obtido == esperado
    except Exception as e:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: avaliacao levantou {type(e).__name__}({e})")
        return
    if ok:
        checks["ok"] += 1
        print(f"[PASS] {nome}")
    else:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: esperado={esperado!r} obtido={obtido!r}")


def lancar(nome, fn, exc_esperada):
    try:
        fn()
    except exc_esperada:
        checks["ok"] += 1
        print(f"[PASS] {nome}")
        return
    except Exception as e:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: levantou {type(e).__name__}({e}) em vez de {exc_esperada.__name__}")
        return
    checks["fail"] += 1
    fails.append(nome)
    print(f"[FAIL] {nome}: nao levantou nenhuma excecao")


def grade_seq():
    """Grade 8x8 autoral: pixel(r,c) = (r*8+c) & 15 (a mesma do experimento rescomp)."""
    return [[(r * 8 + c) & 15 for c in range(8)] for r in range(8)]


# --- 1) codificacao chunky: a resposta medida pelo oraculo oficial -----------------
eq("chunky: grade (r*8+c)&15 codifica exatamente os 32 bytes medidos pelo rescomp",
   MD.encode_tile(grade_seq(), "chunky"),
   bytes.fromhex("0123456789abcdef" * 4))

eq("chunky: byte de um pixel = tile*32 + row*4 + col/2",
   [MD.pixel_location("chunky", 0, r, 0)[0] for r in range(8)],
   [0, 4, 8, 12, 16, 20, 24, 28])

eq("chunky: coluna par fica no nibble ALTO, impar no baixo",
   [MD.pixel_location("chunky", 0, 0, c)[1] for c in range(8)],
   ["high", "low", "high", "low", "high", "low", "high", "low"])

eq("chunky: decodifica os 32 bytes medidos de volta para a grade autoral",
   MD.decode_tile(bytes.fromhex("0123456789abcdef" * 4), 0, "chunky"),
   grade_seq())

# caso discriminante: UM pixel isolado no canto superior direito (col 7).
# chunky -> nibble baixo do ultimo byte da linha 0 (00 00 00 01);
# planar -> bit 0 do plano 0 da linha 0 (01 00 00 00). As duas hipoteses dao
# bytes DIFERENTES para a mesma imagem: o teste e falsificavel nos dois sentidos.
um_ponto = [[1 if (r == 0 and c == 7) else 0 for c in range(8)] for r in range(8)]
eq("chunky: pixel unico em (0,7) vira 00 00 00 01 na linha 0",
   MD.encode_tile(um_ponto, "chunky"),
   bytes.fromhex("00000001" + "00" * 28))
eq("planar: o MESMO pixel unico vira 01 00 00 00 na linha 0",
   MD.encode_tile(um_ponto, "planar"),
   bytes.fromhex("01000000" + "00" * 28))

# --- 2) codificacao planar: a hipotese alternativa, explicita ----------------------
eq("planar: grade (r*8+c)&15 codifica 55 33 0F 00 / 55 33 0F FF por linha",
   MD.encode_tile(grade_seq(), "planar"),
   bytes.fromhex("55330f0055330fff" * 4))

eq("planar: byte = tile*32 + row*4 + plano; pixel fica no bit (7-col)",
   MD.pixel_location("planar", 0, 3, 5),
   (3 * 4 + 0, [0, 1, 2, 3]))

eq("planar: decodifica os 32 bytes planar de volta para a grade autoral",
   MD.decode_tile(bytes.fromhex("55330f0055330fff" * 4), 0, "planar"),
   grade_seq())

eq("round-trip chunky preserva a grade",
   MD.decode_tile(MD.encode_tile(grade_seq(), "chunky"), 0, "chunky"), grade_seq())
eq("round-trip planar preserva a grade",
   MD.decode_tile(MD.encode_tile(grade_seq(), "planar"), 0, "planar"), grade_seq())

# --- 3) tile multiplas: deslocamento de base e ordem linha-a-linha ----------------
g2 = [[(r * 8 + c) & 15 for c in range(8)] for r in range(8)]
plain = MD.encode_tile(g2, "chunky") + MD.encode_tile(um_ponto, "chunky")
eq("tile 1 comeca em offset 32 (decode por indice de tile)",
   MD.decode_tile(plain, 1, "chunky"), um_ponto)
eq("plain de 2 tiles tem 64 bytes", len(plain), 64)

# --- 4) negativos de formato: truncado, layout invalido, coordenada fora ---------
lancar("truncado: tile incompleto NAO vira zero preenchido",
        lambda: MD.decode_tile(bytes.fromhex("0123456789abcd"), 0, "chunky"), ValueError)
lancar("truncado: plain com tamanho nao multiplo de 32 e rejeitado",
        lambda: MD.decode_plain(bytes.fromhex("00" * 33), 1, 1, "chunky"), ValueError)
lancar("layout desconhecido e rejeitado (nao cai em hipotese padrao)",
        lambda: MD.pixel_location("linear", 0, 0, 0), ValueError)
lancar("tile fora do plain e rejeitado",
        lambda: MD.decode_tile(bytes.fromhex("00" * 32), 1, "chunky"), ValueError)
lancar("coluna fora de 0..7 e rejeitada",
        lambda: MD.pixel_location("chunky", 0, 0, 8), ValueError)
lancar("indice de paleta fora de 0..15 e rejeitado na codificacao",
        lambda: MD.encode_tile([[16] * 8 for _ in range(8)], "chunky"), ValueError)

# --- 5) palavra de cor VDP (xxxBBBxGGGxRRRx) -> RGB8 em escala cheia -------------
eq("cor 0x0EEE (7,7,7) vira branco cheio 255, nao 252",
   MD.color_word_to_rgb(0x0EEE), (255, 255, 255))
eq("cor 0x000E so vermelho maximo", MD.color_word_to_rgb(0x000E), (255, 0, 0))
eq("cor 0x00E0 so verde maximo", MD.color_word_to_rgb(0x00E0), (0, 255, 0))
eq("cor 0x0E00 so azul maximo", MD.color_word_to_rgb(0x0E00), (0, 0, 255))
eq("cor 0x0000 preta", MD.color_word_to_rgb(0x0000), (0, 0, 0))
eq("degrau 1 de 3 bits vira 36 (round(255/7))", MD.color_word_to_rgb(0x0002), (36, 0, 0))
eq("bits de cor ignoram o bit 0 de cada campo e os bits 4,7,12",
   MD.color_word_to_rgb(0x1111), MD.color_word_to_rgb(0x0000))

lancar("paleta truncada (menos de 2 bytes por cor) e rejeitada",
        lambda: MD.decode_palette(bytes.fromhex("000E00"), 2), ValueError)

eq("paleta le palavras big-endian a partir de uma base",
   MD.decode_palette(bytes.fromhex("0EEE0000" + "0248"), 3, base=0),
   [MD.color_word_to_rgb(0x0EEE), MD.color_word_to_rgb(0x0000), MD.color_word_to_rgb(0x0248)])

# --- 6) palavra de nametable: campos fixados pela fonte oficial do toolchain -----
eq("nametable 0xD923: indice 0x123, hflip 1, vflip 1, paleta 2, prioridade 1",
   MD.nametable_entry(0xD923),
   {"tile": 0x123, "hflip": 1, "vflip": 1, "palette": 2, "priority": 1})
eq("nametable 0x0000: tudo zerado",
   MD.nametable_entry(0x0000),
   {"tile": 0, "hflip": 0, "vflip": 0, "palette": 0, "priority": 0})
eq("nametable 0xFFFF: indice 0x7FF e todos os atributos ligados",
   MD.nametable_entry(0xFFFF),
   {"tile": 0x7FF, "hflip": 1, "vflip": 1, "palette": 3, "priority": 1})
eq("montar a palavra e inverso exato de ler",
   MD.make_entry(0x123, palette=2, hflip=1, vflip=1, priority=1), 0xD923)
PALAVRAS = (0x0000, 0x0800, 0x1000, 0x2000, 0x4000, 0x8000, 0x07FF, 0xD923, 0xFFFF)
eq("round-trip de palavra de nametable",
   [MD.make_entry(**MD.nametable_entry(w)) for w in PALAVRAS], list(PALAVRAS))
lancar("indice acima de 0x7FF nao cabe na palavra e e rejeitado",
        lambda: MD.make_entry(0x800), ValueError)
lancar("paleta acima de 3 e rejeitada",
        lambda: MD.make_entry(0, palette=4), ValueError)

# --- 7) flips H/V e transparencia (index 0) — definicao, nao palpite -------------
g = [[c + 1 for c in range(8)] for r in range(8)]      # linhas identicas, colunas distintas
eq("hflip inverte a ordem das colunas", MD.apply_hflip(g)[0], [8, 7, 6, 5, 4, 3, 2, 1])
eq("vflip inverte a ordem das linhas",
   MD.apply_vflip([[r] * 8 for r in range(8)])[0], [7] * 8)
eq("transparencia: so o indice 0 e transparente",
   [MD.is_transparent(v) for v in (0, 1, 15)], [True, False, False])

# --- 8) discriminador de layout: calibrado em verdade de solo sintetica ----------
# Criterio PREEXISTENTE, fixado aqui ANTES de medir qualquer ROM: taxa de pares
# adjacentes desiguais (horizontal + vertical) sobre o plain inteiro, nas duas
# leituras. Vence a leitura com taxa <= 0,6x da outra; sem essa margem,
# "inconclusivo". Numeros de calibracao medidos em 2026-09-30 com
# /tmp/rex-corpus-b/calibrar-metrico.py (verdadade de solo nos dois layouts).
def imagem_blocos(larg_tiles, alt_tiles):
    """Autoral: valor = (col4 + lin4 + tx + ty) % 8 — blocos de 4 px, cor por tile."""
    return [[(((c % 8) // 4) + ((r % 8) // 4) + (c // 8) + (r // 8)) % 8
             for c in range(larg_tiles * 8)] for r in range(alt_tiles * 8)]


def plain_de(img, larg_tiles, layout):
    alt_tiles = len(img) // 8
    return b"".join(MD.encode_tile([row[tx * 8:tx * 8 + 8] for row in img[ty * 8:ty * 8 + 8]],
                                   layout)
                    for ty in range(alt_tiles) for tx in range(larg_tiles))


LARG, ALT = 4, 3
plain_chunky = plain_de(imagem_blocos(LARG, ALT), LARG, "chunky")
plain_planar = plain_de(imagem_blocos(LARG, ALT), LARG, "planar")

eq("calibracao: plain chunky de imagem em blocos tem taxa chunky < 0,2",
   MD.adjacency_rate(plain_chunky, LARG, "chunky") < 0.2, True)
eq("calibracao: a mesma leitura planar do plain chunky e pior",
   MD.adjacency_rate(plain_chunky, LARG, "planar") > MD.adjacency_rate(plain_chunky, LARG, "chunky"),
   True)
eq("calibracao: veredito em plain chunky e 'chunky'",
   MD.verdict_layout(plain_chunky, LARG)["veredito"], "chunky")

# O MESMO criterio aplicado ao plain planar da MESMA imagem tem de escolher planar;
# sem este lado, o indicador seria apenas um detector de chunky (nao falsificavel).
eq("calibracao cruzada: plain planar tem taxa planar < 0,2",
   MD.adjacency_rate(plain_planar, LARG, "planar") < 0.2, True)
eq("calibracao cruzada: leitura chunky do plain planar e pior",
   MD.adjacency_rate(plain_planar, LARG, "chunky") > MD.adjacency_rate(plain_planar, LARG, "planar"),
   True)
eq("calibracao cruzada: veredito em plain planar e 'planar'",
   MD.verdict_layout(plain_planar, LARG)["veredito"], "planar")

# LIMITE medido na calibracao: com variacao a cada pixel, a leitura ERRADA fica mais
# suave que a correta (chunky-certa 1,000 vs planar-errada 0,787). O criterio nao
# pode afirmar nesse caso — o teste abaixo prende essa recusa de afirmar.
def imagem_por_pixel(larg_tiles, alt_tiles):
    return [[(c + (r % 8) + 3 * (c // 8) + 5 * (r // 8)) % 16
             for c in range(larg_tiles * 8)] for r in range(alt_tiles * 8)]


eq("limite: caso ambiguo da calibracao -> 'inconclusivo', nunca um chut",
   MD.verdict_layout(plain_de(imagem_por_pixel(LARG, ALT), LARG, "chunky"), LARG)["veredito"],
   "inconclusivo")

# ruido puro: nenhum layout e melhor -> inconclusivo (o veredito pode falhar, e isso
# e o resultado correto, nao um bug).
import random
rnd = random.Random(20260930)
noise = bytes(rnd.randrange(256) for _ in range(LARG * 3 * 32))
eq("ruido: veredito e 'inconclusivo', nao um layout inventado",
   MD.verdict_layout(noise, LARG)["veredito"], "inconclusivo")

lancar("largura de tiles zero ou maior que o plain e rejeitada",
        lambda: MD.adjacency_rate(plain_chunky, 0, "chunky"), ValueError)
lancar("plain menor que largura*altura*32 e rejeitado",
        lambda: MD.adjacency_rate(plain_chunky, LARG, "chunky", altura=99), ValueError)

print(f"\nverificacoes: {checks['ok']} pass / {checks['fail']} fail")
if fails:
    print("falhas:", *fails, sep="\n  - ")
sys.exit(1 if checks["fail"] else 0)
