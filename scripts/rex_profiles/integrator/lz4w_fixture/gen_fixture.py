#!/usr/bin/env python3
"""Gerador determinístico do fixture REX LZ4W (SGDK 2.11).

Emite exatamente três artefatos a partir de um seed fixo:
  res/tiles.png  -> tileset 4bpp, TILE_PX x TILE_PX, ordem ROW
  res/map.png    -> tilemap 8bpp indexado: 1 pixel = 1 indice de tile
  inc/pal_def.h  -> paleta PAL0 (fonte unica; o JSON repete os valores)

Nada aqui depende de PIL/ImageMagick: PNG indexado e escrito a mao
(IHDR/PLTE/IDAT/tRNS omitido), deflate via zlib com filtros 0.

Terreno conhecido (ground_truth.json) e o que a prova causal exige: a
correspondencia tile/linha/coluna -> pixel da tela, derivada do layout do
tilemap, nao de observacao.
"""

import json
import os
import struct
import sys
import zlib

TILES_X = 8
TILES_Y = 2
TILE_PX = 8
TILE_BYTES = TILE_PX * TILE_PX // 2  # 4bpp, 8x8 = 32 bytes
TILE_COUNT = TILES_X * TILES_Y
NOISE_ROWS = 4

MAP_W = 4
MAP_H = 4

# LCG (Knuth MMIX): 64-bit, multiplicador/implemento impares.
LCG_A = 6364136223846793005
LCG_C = 1442695040888963407
LCG_SEED = 0x5245584C5A345731  # "REXLZ4W1"

# Paleta 68k (RGB inverte em 3 bits; layout: ----BBBRRRGGG where each is 3-bit
# inverted... SGDK usa u16 0x0---BBBRRRGGG com intensidades invertidas por nibble
# de cor). Definimos valores crus e os documentamos no JSON; o renderizador do
# produto decodifica CRAM do core, entao comparamos framebuffer, nao hex.
PALETTE = [
    0x0222, 0x0AAA, 0x0555, 0x0777,
    0x0888, 0x0CCC, 0x0666, 0x0333,
    0x0999, 0x0BBB, 0x0444, 0x0800,
    0x0080, 0x0008, 0x0880, 0x0808,
]


def lcg_stream(n, seed=LCG_SEED):
    state = seed
    out = []
    for _ in range(n):
        state = (state * LCG_A + LCG_C) & 0xFFFFFFFFFFFFFFFF
        # bits 33..40: alta qualidade, evita os padrões fracos dos bits baixos
        out.append((state >> 33) & 0xF)
    return out


def chunk(tag, payload):
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def write_indexed_png(path, width, height, pixels):
    assert len(pixels) == width * height
    plte = b"".join(struct.pack(">BBB", (c >> 8 & 7) * 255 // 7,
                                (c >> 4 & 7) * 255 // 7,
                                (c >> 1 & 7) * 255 // 7) for c in PALETTE)
    raw = b"".join(b"\x00" + bytes(pixels[y * width:(y + 1) * width])
                   for y in range(height))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0))
           + chunk(b"PLTE", plte)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


# Palavra (2 pixels) quase igual à anterior: o LZ4W casa em WORDS, então uma
# edição de UM pixel só encurta o stream quando torna duas palavras adjacentes
# idênticas. A linha NEAR_MISS_ROW é sólida em v nos 7 primeiros pixels e v+1
# no último; editar esse último pixel para v junta as duas palavras e é a
# edição que se espera caber no espaço do stream original.
NEAR_MISS_ROW = NOISE_ROWS + 1


def tile_value(t, r, c):
    if r < NOISE_ROWS:
        return None  # preenchido abaixo, depende do ruído
    v = (t * 7 + r * 3) & 0xF
    if r == NEAR_MISS_ROW and c == TILE_PX - 1:
        return (v + 1) & 0xF
    return v


def main(outdir):
    noise = lcg_stream(TILE_COUNT * NOISE_ROWS * TILE_PX)
    # rows 0..NOISE_ROWS-1: literais pseudoaleatorios (impede compressao
    # trivial); rows NOISE_ROWS..7: linha solida por (tile, row), com a
    # palavra quase-igual plantada em NEAR_MISS_ROW. Compresso vencedora, mas
    # com literais suficientes para que 1 pixel edite o stream.
    def value(t, r, c):
        if r < NOISE_ROWS:
            return noise[t * NOISE_ROWS * TILE_PX + r * TILE_PX + c]
        return tile_value(t, r, c)

    indices = [value(t, r, c)
               for t in range(TILE_COUNT) for r in range(TILE_PX) for c in range(TILE_PX)]
    # imagem do tileset: tiles em ordem ROW (linha-major)
    img_w = TILES_X * TILE_PX
    img_h = TILES_Y * TILE_PX
    tiles_img = [0] * (img_w * img_h)
    for t in range(TILE_COUNT):
        tx, ty = (t % TILES_X) * TILE_PX, (t // TILES_X) * TILE_PX
        for row in range(TILE_PX):
            for col in range(TILE_PX):
                tiles_img[(ty + row) * img_w + tx + col] = indices[t * TILE_PX * TILE_PX + row * TILE_PX + col]
    write_indexed_png(os.path.join(outdir, "res", "tiles.png"), img_w, img_h, tiles_img)

    # O tilemap NAO e um recurso: src/main.c preenche uma area 4x4 com
    # VDP_fillTileMapRectInc, entao cada tile aparece exatamente uma vez e a
    # posicao de tela e funcao direta do indice do tile (MAP_W/MAP_H abaixo
    # documentam essa decisao de layout, que vive no fonte C).
    with open(os.path.join(outdir, "inc", "pal_def.h"), "w") as fh:
        fh.write("/* gerado por gen_fixture.py — nao editar a mao */\n")
        fh.write("#ifndef RDS_FIXTURE_PAL_H\n#define RDS_FIXTURE_PAL_H\n")
        fh.write("#include <genesis.h>\n\nstatic const u16 fixture_pal[16] = {\n    ")
        fh.write(", ".join("0x%04X" % c for c in PALETTE))
        fh.write("\n};\n\n#endif\n")

    truth = {
        "schema": "rex-lz4w-fixture-ground-truth/v1",
        "seed_hex": "0x%016X" % LCG_SEED,
        "lcg": {"a": LCG_A, "c": LCG_C, "shift": 33, "mask": 15},
        "tile_px": TILE_PX,
        "tiles_x": TILES_X,
        "tiles_y": TILES_Y,
        "tile_count": TILE_COUNT,
        "map_w": MAP_W,
        "map_h": MAP_H,
        "palette": [c for c in PALETTE],
        "noise_rows": NOISE_ROWS,
        "near_miss_row": NEAR_MISS_ROW,
        # Edição de UM pixel que o fixture planta para ter efeito encurtante:
        # em todo tile, o ultimo pixel de near_miss_row vale v+1, com
        # v = (tile*7 + near_miss_row*3) & 0xF; reescreve-lo para v torna
        # iguais as duas palavras adjacentes (o LZ4W casa em words).
        "planted_edit": {"row": NEAR_MISS_ROW, "col": TILE_PX - 1,
                         "value_rule": "v = (tile*7 + row*3) & 15; de (v+1)&15 para v"},
        # indices de cor por tile (ROW-major na imagem de entrada, opt=NONE):
        # tile_pixels[t][row*16+col] -> o que o produto deve ler no stream e o
        # que a tela deve mostrar em (mx*16+col, my*16+row) com mx=t%20, my=t/20.
        "tile_pixels": [["".join("%X" % indices[t * TILE_PX * TILE_PX + r * TILE_PX + c]
                                 for r in range(TILE_PX) for c in range(TILE_PX))]
                        for t in range(TILE_COUNT)],
    }
    with open(os.path.join(outdir, "ground_truth.json"), "w") as fh:
        json.dump(truth, fh, indent=2)
    print("fixture sources written to %s (tile_count=%d, %dx%d px tileset)" %
          (outdir, TILE_COUNT, img_w, img_h))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
