#include "fixture_common.h"

extern u32 recovered_addq_word_bridge(u32 value);

int main(bool hardReset)
{
    u16 rds_boot_frame;
    u32 d0 = 0x12340058;
    (void) hardReset;
    rds_publish_oracle(d0, 0);
    for (rds_boot_frame = 0; rds_boot_frame < 90; rds_boot_frame++)
    {
        SYS_doVBlankProcess();
    }
    while (TRUE)
    {
        d0 = recovered_addq_word_bridge(d0);
        rds_publish_oracle(d0, rds_flags_for_word((u16) (d0 - 1), (u16) d0, 1));
        SYS_doVBlankProcess();
    }
    return 0;
}
