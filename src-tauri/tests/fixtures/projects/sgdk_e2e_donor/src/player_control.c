#include <genesis.h>
#include "player_control.h"

void player_tick(void) {
    u16 joy = JOY_readJoypad(JOY_1);
    (void)joy;
    /* Fixture E2E RDS: SPR_* com identificador do recurso secundario para Fase D auditavel. */
    (void)SPR_addSprite(&foe_palette, &foe, 32, 32, TILE_ATTR(PAL0, 0, FALSE, FALSE));
    SPR_update();
}
