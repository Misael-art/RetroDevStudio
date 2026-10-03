#include "fixture_common.h"

static const u16 rds_branch_inputs[] = {3, 4, 5, 0, 0xFFFF, 0x1234};
static u16 rds_branch_index;
static u16 rds_branch_result;

static void node_generated_branch_compare_word(u16 input)
{
    u16 arithmetic = (u16) (input + 1);
    if ((s16) arithmetic >= 5)
    {
        rds_branch_result = 1;
    }
    else
    {
        rds_branch_result = 0;
    }
    *RDS_BRANCH_RESULT = rds_branch_result;
}

int main(bool hardReset)
{
    u16 rds_boot_frame;
    (void) hardReset;
    rds_branch_index = 0;
    node_generated_branch_compare_word(rds_branch_inputs[0]);
    rds_publish_branch_input(rds_branch_inputs[0]);
    for (rds_boot_frame = 0; rds_boot_frame < 90; rds_boot_frame++)
    {
        SYS_doVBlankProcess();
    }
    while (TRUE)
    {
        const u16 input = rds_branch_inputs[rds_branch_index % 6];
        node_generated_branch_compare_word(input);
        rds_publish_branch_input(input);
        rds_branch_index++;
        SYS_doVBlankProcess();
    }
    return 0;
}
