#include <genesis.h>

#include "pal_def.h"

/*
 * Fixture REX LZ4W autoral (nao e BYOR, nao e comercial).
 *
 * Cadeia consumer conhecida por construcao, nao inferida:
 *   res/tiles.png --rescomp (TILESET ... LZ4W)--> stream LZ4W na ROM
 *   fixture_tiles.tiles --unpackTileSet() [SGDK oficial, tools.h]--> WRAM
 *   --VDP_loadTileSet()--> VRAM --VDP_fillTileMapRectInc()--> BG_A
 *
 * 16 tiles 8x8 4bpp, cada um colocado UMA unica vez no plano, na ordem
 * linear do tileset: tile t -> celula (t % 4, t / 4) -> origem da tela
 * ((t % 4) * 8, (t / 4) * 8). Pixel (t, linha r, coluna c) do recurso
 * corresponde, portanto, a pixel de tela ((t % 4) * 8 + c, (t / 4) * 8 + r).
 * Isso e o que a prova causal exige: a expectativa nasce do codigo fonte do
 * fixture, nao de observacao.
 */
extern TileSet fixture_tiles;

static TileSet unpacked;
static u32 unpack_buffer[16 * 8]; /* 16 tiles * 32 bytes */

int main(bool hard) {
    SYS_disableInts();
    VDP_setScreenWidth320();

    unpacked.tiles = unpack_buffer;
    if (unpackTileSet(&fixture_tiles, &unpacked) == 0) {
        /* desempacotamento falhou: tela permanece zerada e a prova falha
         * de forma visivel em vez de fingir sucesso */
        while (TRUE) { }
    }
    PAL_setPalette(PAL0, fixture_pal, CPU);
    VDP_loadTileSet(&unpacked, TILE_USER_INDEX, CPU);
    VDP_fillTileMapRectInc(BG_A,
        TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX), 0, 0, 4, 4);

    SYS_enableInts();

    while (TRUE) {
        SYS_doVBlankProcess();
    }
    return 0;
}
