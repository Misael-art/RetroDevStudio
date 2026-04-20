#include <genesis.h>
#include "player_control.h"

int main(void) {
    while (1) {
        MAP_scrollH(BG_B, 1);
        player_tick();
        SYS_doVBlankProcess();
    }
    return 0;
}
