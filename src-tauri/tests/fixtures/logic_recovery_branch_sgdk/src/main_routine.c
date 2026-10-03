#include "fixture_common.h"

extern u32 recovered_branch_logic_bridge(u32 value);

static const u16 rds_branch_inputs[] = {3, 4, 5, 0, 0xFFFF, 0x1234};
static u16 rds_branch_index;

int main(bool hardReset)
{
    u16 rds_boot_frame;
    (void) hardReset;
    rds_branch_index = 0;
    recovered_branch_logic_bridge(rds_branch_inputs[0]);
    rds_publish_branch_input(rds_branch_inputs[0]);
    for (rds_boot_frame = 0; rds_boot_frame < 90; rds_boot_frame++)
    {
        SYS_doVBlankProcess();
    }
    while (TRUE)
    {
        const u16 input = rds_branch_inputs[rds_branch_index % 6];
        recovered_branch_logic_bridge(input);
        rds_publish_branch_input(input);
        rds_branch_index++;
        SYS_doVBlankProcess();
    }
    return 0;
}
