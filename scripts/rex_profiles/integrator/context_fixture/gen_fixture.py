#!/usr/bin/env python3
"""Gerador determinístico do fixture REX de contexto aPLib (SGDK 2.11).

Emite, ANTES de qualquer compilação:
  res/pal.png    -> 48 cores (3 bancos de 16) para a diretiva PALETTE
  res/tiles.png  -> tileset 4bpp 4x4 (16 tiles), ordem ROW, opt=NONE
  res/map.png    -> mapa 15x9 indexado 8bpp: bits 4-5 = banco, bit 7 = prioridade
  res/ghost.png  -> mapa 8x16 compilado com map_base != 0 (o caso inválido)
  ground_truth.json + expected/composed_layer.png

Por que o esperado nasce aqui e não do ROM: as células são calculadas pela
reimplementação do algoritmo documentado em
``toolchains/sgdk/tools/rescomp/src/sgdk/rescomp/resource/Tilemap.java`` e
``type/Tile.java`` (procuramos ``getTileIndex`` exato, depois igualdade por
flip; ``TILE_ATTR_FULL(mapBasePal + tile.pal, mapBasePrio | tile.prio, vflip,
hflip, index)``). Nada aqui lê o artefato compilado: o teste de aceite compara
o stream decodificado por ferramenta **externa** (apj.jar) com este esperado.

A paleta é definida por palavras 68k ``xxxBBBxGGGxRRRx`` e os RGB do PNG são
``redondo(md * 255 / 7)``, que é exatamente o ponto fixo da codificação do
rescomp (pega o nibble alto de cada canal e descarta o bit menos significativo
com a máscara ``0x0EEE``). Assim o PNG sobrevive à ida-e-volta sem perda e a
camada composta esperada é conferível pixel a pixel.
"""

import json
import os
import struct
import sys
import zlib

TILE_PX = 8
TILE_BYTES = TILE_PX * TILE_PX // 2  # 4bpp chunky: 32 bytes/tile

TILESET_COLS = 4
TILESET_ROWS = 4
NUM_TILES = TILESET_COLS * TILESET_ROWS  # 16; índice = linha*4 + coluna

MAP_COLS = 15
MAP_ROWS = 9  # 135 células, 270 bytes de plain, 120x72 px de tela

GHOST_COLS = 8
GHOST_ROWS = 16  # 128 células, 256 bytes de plain
GHOST_BASE = 100  # map_base: deslocamento de índice de tile (useSystemTiles)

BANKS = 3
BACKDROP = (0, 0, 0)  # índice 0 do banco 0 é o próprio backdrop do VDP

# ---------------------------------------------------------------- paleta ---
# Banco b, índice i -> tripa 3 bits. i == 0 é transparente no plano; os
# bancos 1 e 2 têm cores próprias em i == 0 justamente para que um renderer
# ingênuo (que pintasse pal[banco][0] em vez do backdrop) diverja do esperado.


def _md_triples():
    """511 tripletas não nulas em ordem lexicográfica (r mais lento)."""
    return [(r, g, b) for r in range(8) for g in range(8) for b in range(8)
            if (r, g, b) != (0, 0, 0)]


def build_palette():
    tripa = _md_triples()
    banks = []
    for b in range(BANKS):
        row = []
        for i in range(16):
            if i == 0:
                # índice 0: transparente no plano. Banco 0 = backdrop preto;
                # bancos 1/2 recebem cores visíveis para pegar o renderer
                # ingênuo descrito acima.
                row.append((0, 0, 0) if b == 0 else tripa[400 + 7 * b + i])
            else:
                row.append(tripa[b * 16 + (i - 1)])
        banks.append(row)
    vistos = set()
    for banco in banks:
        for cor in banco:
            if cor in vistos:
                raise AssertionError(f"cor duplicada na paleta: {cor}")
            vistos.add(cor)
    return banks


PALETTE_TRIPLES = build_palette()  # [banco][indice] -> (r3,g3,b3)
PALETTE_WORDS = [((t[0] & 7) << 1) | ((t[1] & 7) << 5) | ((t[2] & 7) << 9)
                 for banco in PALETTE_TRIPLES for t in banco]


def _canal8(md):
    return (md * 255 + 3) // 7  # redondo(md * 255 / 7)


PALETTE_RGB = [[(_canal8(r), _canal8(g), _canal8(b)) for (r, g, b) in banco]
               for banco in PALETTE_TRIPLES]
PALETTE_RGB_FLAT = [cor for banco in PALETTE_RGB for cor in banco]


def write_pal_file(path, rgb_flat):
    """JASC-PAL: é o formato que ``ImageUtil.getRGBA88884PaletteFromPALFile`` lê
    para a extensão ``.pal``. Usamos .pal em vez de um PNG indexado porque o
    número de cores lidas de um PNG depende de ``IndexColorModel.getMapSize()``
    (que o leitor Java pode ampliar até 256) e queremos ``numColor`` determinístico."""
    linhas = ["JASC-PAL", "0100", str(len(rgb_flat))]
    linhas += [f"{r} {g} {b} 255" for (r, g, b) in rgb_flat]
    blob = ("\n".join(linhas) + "\n").encode("ascii")
    with open(path, "wb") as fh:
        fh.write(blob)
    return blob

# ------------------------------------------------------------------ tiles ---
# t0..t7 autoria explícita; t8..t15 são sólidos por linha (enchimento único,
# não referenciado pelo mapa) para dar matéria-comprimível ao stream.
TILE_HEX = [
    "0000000000000000000000000000000000000000000000000000000000000000",  # t0 vazio
    "0011110001111110011001100001111000111100011000000111100000000000",  # t1 glifo
    "022222200222222733333333333333333333333B333333339933333300099333",  # t2 alvo
    "4444444044444444044444444444444444444444444444444444444444444444",  # t3
    "0F0F0F0FF0F0F0F00F0F0F0FF0F0F0FE0F0F0F0FF0F0F0F00F0F0F0FEEEEEEEE",  # t4
    "1010101801010101101010100101010110101010010101021010101001010101",  # t5
    "6666666666666666666666666666666566666666666666666666666655555555",  # t6
    "000000000111111001000010010CC010010CC01001000010011111100000000C",  # t7
]


def _filler_tile(n):
    """t8..t15: linha r sólida com valor ((n*5 + r*3) % 16), sem padrão repetido."""
    linhas = []
    for r in range(TILE_PX):
        v = (n * 5 + r * 3) % 16
        linhas.append(format(v, "X") * TILE_PX)
    return "".join(linhas)


TILE_HEX = TILE_HEX + [_filler_tile(n) for n in range(8, NUM_TILES)]


def tile_data(hex_rows):
    assert len(hex_rows) == TILE_PX * TILE_PX, "tile precisa de 64 pixels"
    return [[int(hex_rows[r * TILE_PX + c], 16) for c in range(TILE_PX)]
            for r in range(TILE_PX)]


TILES = [tile_data(h) for h in TILE_HEX]


def hflip(t):
    return [list(reversed(linha)) for linha in t]


def vflip(t):
    return list(reversed(t))


def hvflip(t):
    return vflip(hflip(t))


def _shape(t):
    return tuple(tuple(linha) for linha in t)


# ------------------------------------------------------------------ mapa ----
# (coluna, linha) -> (tile, flip, banco, prioridade). flip em "", "H", "V", "B".
# O resto do mapa é vazio (tile 0, banco 0, sem prioridade).
MAP_SPEC = {
    (0, 0): (2, "B", 0, 0),   # t2 com os dois flips
    (7, 0): (2, "H", 0, 0),   # t2 espelhado na horizontal
    (2, 1): (2, "", 0, 0),    # t2 sem flip  -> 4 ocorrências no total
    (5, 3): (2, "V", 0, 0),   # t2 espelhado na vertical
    (4, 2): (3, "", 0, 0),
    (9, 2): (3, "", 0, 0),    # t3: tile compartilhado, 2 ocorrências
    (0, 5): (1, "", 1, 0),    # t1 usado UMA vez, no banco 1 (pixels 0 = vazio)
    (9, 5): (4, "", 1, 0),
    (6, 4): (5, "", 2, 0),
    (8, 3): (6, "", 0, 1),    # prioridade alta nesta célula
    (3, 3): (6, "", 2, 0),
    (1, 4): (7, "", 1, 0),
    (3, 4): (7, "", 1, 0),
}

EDIT = {"tile": 2, "row": 4, "col": 7, "de": 0x0B, "para": 0x03}


# "" (sem flip) NÃO é substring de "VB": use tuplas, senão toda célula sem flip
# vira flipada (foi o bug que o decoder externo do fixture pegou).
COM_V = ("V", "B")
COM_H = ("H", "B")


def _cell_word(index, flip, bank, prio):
    """Palavra 16 bits exatamente como ``TILE_ATTR_FULL`` monta no rescomp:
    ``prio<<15 | (mapBasePal + tile.pal)<<13 | vflip<<12 | hflip<<11 | index``."""
    return ((prio & 1) << 15) | ((bank & 3) << 13) | ((1 if flip in COM_V else 0) << 12) \
        | ((1 if flip in COM_H else 0) << 11) | (index & 0x7FF)


def source_pixel(flip, r, c):
    """Posição na fonte (tile) de um pixel exibido em (r,c) da célula."""
    return (TILE_PX - 1 - r if flip in COM_V else r,
            TILE_PX - 1 - c if flip in COM_H else c)


def cells_from_spec(spec, cols, rows):
    saida = []
    for j in range(rows):
        for i in range(cols):
            tile_ind, flip, bank, prio = spec.get((i, j), (0, "", 0, 0))
            saida.append({"col": i, "row": j, "tile": tile_ind, "flip": flip,
                          "bank": bank, "prio": prio,
                          "word": _cell_word(tile_ind, flip, bank, prio)})
    return saida


# ------------------------------------------------------------ PNG de saída ---
def chunk(tag, payload):
    return (struct.pack(">I", len(payload)) + tag + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))


def write_indexed_png(path, width, height, pixels, plte_rgb):
    assert len(pixels) == width * height
    assert len(plte_rgb) <= 256
    plte = b"".join(struct.pack(">BBB", *cor) for cor in plte_rgb)
    raw = b"".join(b"\x00" + bytes(pixels[y * width:(y + 1) * width])
                   for y in range(height))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0))
           + chunk(b"PLTE", plte)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)
    return png


def write_rgb_png(path, width, height, rgb_rows):
    raw = b"".join(b"\x00" + b"".join(struct.pack(">BBB", *p) for p in linha)
                   for linha in rgb_rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)
    return png


def entry(bank, idx, prio=0):
    """Índice de paleta no PNG 8bpp: bit 7 = prioridade, bits 4-5 = banco."""
    return (prio << 7) | (bank << 4) | (idx & 0xF)


# ------------------------------------------------------------ imagens ------
def tiles_png_pixels():
    """32x32: tile t na posição (t % 4, t / 4); só banco 0 (o tileset define
    padrões; banco é atributo da CÉLULA do mapa)."""
    pixels = [0] * (TILESET_COLS * TILE_PX * TILESET_ROWS * TILE_PX)
    largura = TILESET_COLS * TILE_PX
    for t, tile in enumerate(TILES):
        ti, tj = t % TILESET_COLS, t // TILESET_COLS
        for r in range(TILE_PX):
            for c in range(TILE_PX):
                pixels[(tj * TILE_PX + r) * largura + ti * TILE_PX + c] = tile[r][c]
    return pixels


def map_png_pixels(cells, cols, rows):
    """Desenha em cada bloco o padrão EXIBIDO pela célula (já com flip),
    com as cores do banco da célula e o bit de prioridade."""
    largura = cols * TILE_PX
    pixels = [0] * (largura * rows * TILE_PX)
    for celula in cells:
        tile = TILES[celula["tile"]]
        for r in range(TILE_PX):
            for c in range(TILE_PX):
                rs, cs = source_pixel(celula["flip"], r, c)
                pixels[(celula["row"] * TILE_PX + r) * largura
                       + celula["col"] * TILE_PX + c] = entry(celula["bank"], tile[rs][cs],
                                                              celula["prio"])
    return pixels


def ghost_png_pixels():
    """8x16 blocks: linha 0 = tile 7 (-> índice 107, fora do tileset);
    linhas 1-2 = vazio (sólido 0 -> tile de sistema 0); linha 3 = sólido 5
    (-> tile de sistema 5, que colide NUMERICAMENTE com o tile 5 do tileset);
    linhas 4-15 = tile 7 de novo. Tudo banco 0, sem prioridade."""
    largura = GHOST_COLS * TILE_PX
    pixels = [0] * (largura * GHOST_ROWS * TILE_PX)
    vazio = [[0] * TILE_PX for _ in range(TILE_PX)]
    solido5 = [[5] * TILE_PX for _ in range(TILE_PX)]
    for j in range(GHOST_ROWS):
        if j in (1, 2):
            origem = vazio
        elif j == 3:
            origem = solido5
        else:
            origem = TILES[7]
        for i in range(GHOST_COLS):
            for r in range(TILE_PX):
                for c in range(TILE_PX):
                    pixels[(j * TILE_PX + r) * largura + i * TILE_PX + c] = \
                        entry(0, origem[r][c], 0)
    return pixels


def ghost_cells():
    """Modelo de Tilemap.getTilemap com map_opt=ALL e map_base != 0:
    bloco sólido -> tile de sistema (sem offset); resto -> tileset + offset."""
    celulas = []
    for j in range(GHOST_ROWS):
        for i in range(GHOST_COLS):
            if j in (1, 2):
                index, origem = 0, "sistema(0)"
            elif j == 3:
                index, origem = 5, "sistema(5)"
            else:
                index, origem = 7 + GHOST_BASE, "tileset+base"
            celulas.append({"col": i, "row": j, "tile": index, "flip": "",
                            "bank": 0, "prio": 0, "origem": origem,
                            "word": _cell_word(index, "", 0, 0)})
    return celulas


def plain_tileset():
    out = bytearray()
    for tile in TILES:
        for r in range(TILE_PX):
            for pair in range(TILE_PX // 2):
                out.append((tile[r][pair * 2] << 4) | tile[r][pair * 2 + 1])
    assert len(out) == NUM_TILES * TILE_BYTES
    return bytes(out)


def plain_cells(cells):
    out = bytearray()
    for c in cells:
        out += struct.pack(">H", c["word"])
    return bytes(out)


def composed_layer(cells, cols, rows):
    """RGB esperado da camada composta: índice 0 = backdrop; senão a cor do
    banco da própria célula."""
    linhas = []
    for r in range(rows * TILE_PX):
        linha = []
        for c in range(cols * TILE_PX):
            celula = cells[(r // TILE_PX) * cols + (c // TILE_PX)]
            tile = TILES[celula["tile"]]
            rs, cs = source_pixel(celula["flip"], r % TILE_PX, c % TILE_PX)
            idx = tile[rs][cs]
            if idx == 0:
                linha.append(BACKDROP)
            else:
                linha.append(PALETTE_RGB[celula["bank"]][idx])
        linhas.append(linha)
    return linhas


def occurrences(cells):
    por_tile = {}
    for c in cells:
        por_tile.setdefault(c["tile"], []).append(
            {"col": c["col"], "row": c["row"], "flip": c["flip"],
             "bank": c["bank"], "prio": c["prio"]})
    return {str(k): v for k, v in sorted(por_tile.items())}


def predicted_screen(cells, tile, row, col):
    """Para cada célula que referencia `tile`, a posição de tela do pixel
    (row,col) da FONTE, respeitando o flip da célula."""
    alvo = []
    for c in cells:
        if c["tile"] != tile:
            continue
        flip = c["flip"]
        rs = TILE_PX - 1 - row if flip in COM_V else row
        cs = TILE_PX - 1 - col if flip in COM_H else col
        alvo.append({"col": c["col"], "row": c["row"], "flip": flip, "bank": c["bank"],
                     "prio": c["prio"], "x": c["col"] * TILE_PX + cs,
                     "y": c["row"] * TILE_PX + rs})
    return alvo


def sha(bs):
    import hashlib
    return hashlib.sha256(bs).hexdigest()


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("uso: gen_fixture.py <dir-do-projeto>\n")
        return 2
    project = sys.argv[1]
    res = os.path.join(project, "res")
    os.makedirs(res, exist_ok=True)
    os.makedirs(os.path.join(project, "expected"), exist_ok=True)

    # ---- conferências de autoria (falham alto, não em silêncio) ----------
    assert _cell_word(1, "", 0, 0) == 1, "célula sem flip não pode setar bit de flip"
    assert _cell_word(1, "", 1, 1) == 0x2001 + 0x8000, "banco/prioridade fora de lugar"
    assert source_pixel("", 4, 7) == (4, 7), "pixel de fonte não pode ser espelhado sem flip"
    shapes = [_shape(t) for t in TILES]
    assert len(set(shapes)) == NUM_TILES, "tiles do tileset não são únicos"
    for a in range(NUM_TILES):
        for b in range(NUM_TILES):
            if a == b:
                continue
            for flip in ("H", "V", "B"):
                t = {"H": hflip, "V": vflip, "B": hvflip}[flip](TILES[a])
                if _shape(t) == shapes[b]:
                    raise AssertionError(f"tile {a} com flip {flip} == tile {b}")

    for b in range(BANKS):
        for i in range(16):
            r3, g3, b3 = PALETTE_TRIPLES[b][i]
            r8, g8, b8 = PALETTE_RGB[b][i]
            # ida e volta pela codificação do rescomp: nibble alto, máscara 0x0EEE
            assert (r8 >> 4) >> 1 == r3 and (g8 >> 4) >> 1 == g3 and (b8 >> 4) >> 1 == b3, \
                f"cor {b},{i} não sobrevive à quantização do rescomp"

    cells = cells_from_spec(MAP_SPEC, MAP_COLS, MAP_ROWS)
    for c in cells:
        assert c["tile"] < NUM_TILES, "mapa principal referencia tile inexistente"
    ghost = ghost_cells()
    invalidos = [c for c in ghost if c["tile"] >= NUM_TILES]
    assert invalidos, "o ghost precisa expor referência fora do tileset"

    # ---- imagens ---------------------------------------------------------
    plte_map = [(0, 0, 0)] * 256
    for b in range(BANKS):
        for i in range(16):
            for prio in (0, 1):
                plte_map[entry(b, i, prio)] = PALETTE_RGB[b][i]
    plte_tiles = [(0, 0, 0)] * 256
    for i in range(16):
        plte_tiles[i] = PALETTE_RGB[0][i]

    tp = tiles_png_pixels()
    mp = map_png_pixels(cells, MAP_COLS, MAP_ROWS)
    gp = ghost_png_pixels()
    escreve_tiles = write_indexed_png(os.path.join(res, "tiles.png"),
                                      TILESET_COLS * TILE_PX, TILESET_ROWS * TILE_PX,
                                      tp, plte_tiles)
    escreve_mapa = write_indexed_png(os.path.join(res, "map.png"),
                                     MAP_COLS * TILE_PX, MAP_ROWS * TILE_PX,
                                     mp, plte_map)
    escreve_ghost = write_indexed_png(os.path.join(res, "ghost.png"),
                                      GHOST_COLS * TILE_PX, GHOST_ROWS * TILE_PX,
                                      gp, plte_map)
    escreve_pal = write_pal_file(os.path.join(res, "pal.pal"), PALETTE_RGB_FLAT)

    # ---- esperado --------------------------------------------------------
    camada = composed_layer(cells, MAP_COLS, MAP_ROWS)
    png_camada = write_rgb_png(os.path.join(project, "expected", "composed_layer.png"),
                               MAP_COLS * TILE_PX, MAP_ROWS * TILE_PX, camada)
    camada_pixels = b"".join(struct.pack(">BBB", *p) for linha in camada for p in linha)

    plano = plain_tileset()
    plain_mapa = plain_cells(cells)
    plain_ghost = plain_cells(ghost)
    tela = predicted_screen(cells, EDIT["tile"], EDIT["row"], EDIT["col"])

    # o pixel plantado tem que existir e o novo valor tem que ser visível
    for c in cells:
        if c["tile"] == EDIT["tile"]:
            assert TILES[EDIT["tile"]][EDIT["row"]][EDIT["col"]] == EDIT["de"]
            assert EDIT["para"] != 0, "editar para índice 0 ocultaria o pixel"
            cor_antes = PALETTE_RGB[c["bank"]][EDIT["de"]]
            depois = PALETTE_RGB[c["bank"]][EDIT["para"]]
            assert cor_antes != depois, f"edião invisível no banco {c['bank']}"
    assert len(tela) == 4, f"esperava 4 ocorrências de t2, obtive {len(tela)}"

    verdade = {
        "schema": "rex-context-aplib-fixture-ground-truth/v1",
        "authored_fixture": True,
        "byor": False,
        "expectation_source": ("constantes de autoria + semântica do rescomp 2.11 "
                               "lida em tools/rescomp/src; nada aqui lê o ROM compilado"),
        "derived_from_compiled_rom": False,
        "tileset": {
            "directive": "TILESET ctx_tiles \"tiles.png\" APLIB NONE",
            "cols": TILESET_COLS, "rows": TILESET_ROWS, "num_tile": NUM_TILES,
            "ordering": "ROW (index = linha * cols + coluna)",
            "num_tile_motivo": ("TILESET de imagem passa addBlank=false em "
                                "TilesetProcessor; com opt=NONE cada bloco vira um "
                                "tile na ordem raster, logo numTile == 16"),
            "plain_bytes": len(plano), "plain_sha256": sha(plano),
            "plain_hex": plano.hex(),
        },
        "map": {
            "directive": (f"TILEMAP ctx_map \"map.png\" ctx_tiles APLIB ALL"
                          "  (map_base 0, ordering ROW)"),
            "cols": MAP_COLS, "rows": MAP_ROWS, "cells": len(cells),
            "screen_px": [MAP_COLS * TILE_PX, MAP_ROWS * TILE_PX],
            "plain_bytes": len(plain_mapa), "plain_sha256": sha(plain_mapa),
            "plain_hex": plain_mapa.hex(),
            "cells_table": cells,
            "occurrences_por_tile": occurrences(cells),
            "tiles_nao_referenciados": [t for t in range(NUM_TILES)
                                        if str(t) not in occurrences(cells)],
        },
        "ghost": {
            "directive": (f"TILEMAP ctx_ghost \"ghost.png\" ctx_tiles APLIB ALL "
                          f"{GHOST_BASE}"),
            "cols": GHOST_COLS, "rows": GHOST_ROWS,
            "plain_bytes": len(plain_ghost), "plain_sha256": sha(plain_ghost),
            "plain_hex": plain_ghost.hex(),
            "cells_table": ghost,
            "fora_do_tileset": [{"col": c["col"], "row": c["row"], "tile": c["tile"]}
                                for c in invalidos],
            "tile_de_sistema": [{"col": c["col"], "row": c["row"], "tile": c["tile"],
                                 "nota": "índice em faixa mas aponta tile de sistema, "
                                         "não o tile do tileset"}
                                for c in ghost if c["origem"].startswith("sistema")],
        },
        "palette": {
            "directive": "PALETTE ctx_pal \"pal.pal\"",
            "words": PALETTE_WORDS, "num_color": len(PALETTE_WORDS),
            "plain_bytes": len(PALETTE_WORDS) * 2,
            "plain_sha256": sha(b"".join(struct.pack(">H", w) for w in PALETTE_WORDS)),
            "plain_hex": b"".join(struct.pack(">H", w) for w in PALETTE_WORDS).hex(),
            "banks": BANKS, "rgb8": PALETTE_RGB,
            "convencao": "palavra 68k xxxBBBxGGGxRRRx; RGB8 = round(md*255/7)",
            "estrutura": "Palette = { dc.w numColor; dc.l dados } (rescomp Palette.out)",
        },
        "image_chain": {
            "declaracao": "const Image ctx_image = { &ctx_pal, &ctx_tiles, &ctx_map }",
            "origem": "C do fixture; o tipo Image é do SGDK (inc/vdp_bg.h)",
            "ghost_chain": "const Image ctx_ghost_image = { &ctx_pal, &ctx_tiles, &ctx_ghost }",
        },
        "composed_layer": {
            "png": "expected/composed_layer.png",
            "png_sha256": sha(png_camada),
            "pixels_sha256": sha(camada_pixels),
            "largura": MAP_COLS * TILE_PX, "altura": MAP_ROWS * TILE_PX,
            "regra": "índice 0 = backdrop preto (COR0), não pal[banco][0]; "
                     "demais índices usam o banco da própria célula",
        },
        "edicao_canonica": {
            "recurso": "tileset (ctx_tiles)",
            "pixel_fonte": {"tile": EDIT["tile"], "row": EDIT["row"],
                            "col": EDIT["col"], "de": EDIT["de"], "para": EDIT["para"]},
            "ocorrencias_no_mapa_verificado": len(tela),
            "posicoes_de_tela_previstas": tela,
            "nao_prova": "ocorrências fora deste mapa (a ROM só tem este mapa "
                         "verificado para o tileset)",
        },
        "imagens_sha256": {
            "res/tiles.png": sha(escreve_tiles),
            "res/map.png": sha(escreve_mapa),
            "res/ghost.png": sha(escreve_ghost),
            "res/pal.png": sha(escreve_pal),
        },
    }
    with open(os.path.join(project, "ground_truth.json"), "w") as fh:
        json.dump(verdade, fh, indent=2)

    print(json.dumps({
        "tiles_plain": [len(plano), verdade["tileset"]["plain_sha256"][:16]],
        "map_plain": [len(plain_mapa), verdade["map"]["plain_sha256"][:16]],
        "ghost_plain": [len(plain_ghost), verdade["ghost"]["plain_sha256"][:16]],
        "composed_pixels_sha256": verdade["composed_layer"]["pixels_sha256"],
        "ocorrencias_alvo": len(tela),
        "tela_prevista": [(p["x"], p["y"], p["flip"]) for p in tela],
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
