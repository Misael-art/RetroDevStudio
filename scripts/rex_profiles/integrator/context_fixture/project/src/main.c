#include <genesis.h>

/*
 * Fixture REX de contexto aPLib (autoral: nao e BYOR, nao e comercial).
 *
 * A associacao paleta + tileset + mapa do ctx_image existe no artefato como
 * estrutura Image do SGDK (inc/vdp_bg.h: {palette, tileset, tilemap}), e o
 * leitor da ROM a encontra seguindo os tres ponteiros. Nao e inferida por
 * proximidade nem por tamanho.
 *
 * ctx_ghost_image NAO sobrevive ao link: sem referencia vinda de codigo, o
 * linker descarta a struct (medido: nenhum simbolo e nenhum trinco de
 * ponteiros igual ao do ghost no ROM). A associacao ghost <-> tileset e donc da
 * classe DESCONHECIDA no artefato, e deve ser registrada como tal.
 *
 * Tela: o mapa ctx_map (15x9 celulas = 120x72 px) em BG_A na origem (0,0),
 * com basetile TILE_ATTR_FULL(PAL0, .., TILE_USER_INDEX). Como os bits de
 * paleta/prioridade/flip de basetile sao zerados, VDP_setTileMapDataEx
 * (src/vdp_tile.c) preserva banco, prioridade e flip de cada celula emitida
 * pelo rescomp. Celula (i,j) -> tela (i*8, j*8).
 *
 * ctx_ghost (map_base 100) NAO e desenhado: ele existe para expor no artefato
 * referencia fora do TileSet (indice 107 com numTile 16) e celula solida que o
 * rescomp resolve como tile de sistema. O unpackTileMap oficial dele e feito e
 * o resultado e lido, o que mantem header e stream vivos no link e prova no
 * alvo que esse stream aPLib decodifica -- mas nao cria ponteiro de associacao.
 */

extern Palette ctx_pal;
extern TileSet ctx_tiles;
extern TileMap ctx_map;
extern TileMap ctx_ghost;

const Image ctx_image = { &ctx_pal, &ctx_tiles, &ctx_map };
const Image ctx_ghost_image = { &ctx_pal, &ctx_tiles, &ctx_ghost };

static TileMap ghost_dst;
static u16 ghost_cells[8 * 16];
volatile u16 ghost_probe;

static void falha(void) {
    /* desempacotamento ou carga falhou: a tela permanece vazia e a prova
     * falha de forma visivel em vez de fingir sucesso */
    while (TRUE) { }
}

int main(bool hard) {
    SYS_disableInts();
    VDP_setScreenWidth320();
    VDP_clearPlane(BG_A, TRUE);

    if (!VDP_drawImageEx(BG_A, &ctx_image,
            TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX),
            0, 0, TRUE, TRUE))
        falha();

    ghost_dst.w = 8;
    ghost_dst.h = 16;
    ghost_dst.tilemap = ghost_cells;
    if (unpackTileMap(&ctx_ghost, &ghost_dst) == 0)
        falha();
    ghost_probe = ghost_cells[0];

    SYS_enableInts();

    while (TRUE) {
        SYS_doVBlankProcess();
    }
    return 0;
}
