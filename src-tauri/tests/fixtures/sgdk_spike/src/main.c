/*
 * Minimal OPEN SGDK fixture for the Experimental reference/candidate parity
 * spike. Built from source (no commercial ROM). Renders deterministic, visible,
 * per-frame-varying output so the harness sees real visual activity.
 *
 * Variants (see scripts/decomp/build_spike_fixture.sh):
 *   base     -DROW=10                       (reference)
 *   positive  = base with one byte flipped in the never-executed padding tail
 *              (different SHA-256, byte-identical execution -> identical frames)
 *   negative -DROW=14                       (different rendering -> must diverge)
 */
#include <genesis.h>

#ifndef ROW
#define ROW 10
#endif

int main(bool hard)
{
    (void)hard;

    VDP_setTextPalette(0);
    VDP_drawText("RDS PARITY SPIKE", 6, ROW);

    u16 t = 0;
    while (TRUE)
    {
        /* Deterministic color cycle => the framebuffer changes every frame
         * (non-black, non-static): real visual activity. */
        PAL_setColor(15, (u16)((t * 0x0111) & 0x0EEE));
        t++;
        SYS_doVBlankProcess();
    }
    return 0;
}
