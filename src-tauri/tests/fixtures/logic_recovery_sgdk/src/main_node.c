#include "fixture_common.h"

static u32 logic_var_rom_d0 = 0x12340058;
static bool logic_var_rom_d0_n;
static bool logic_var_rom_d0_z;
static bool logic_var_rom_d0_v;
static bool logic_var_rom_d0_c;
static bool logic_var_rom_d0_x;

static void node_generated_rom_addq_word(void)
{
    u16 rds_rom_word_before = (u16) logic_var_rom_d0;
    u16 rds_rom_word_result = (u16) (rds_rom_word_before + 1);
    logic_var_rom_d0 = (logic_var_rom_d0 & ~0xFFFF) | rds_rom_word_result;
    logic_var_rom_d0_n = (rds_rom_word_result & 0x8000) != 0;
    logic_var_rom_d0_z = rds_rom_word_result == 0;
    logic_var_rom_d0_v = rds_rom_word_before == 0x7FFF;
    logic_var_rom_d0_c = rds_rom_word_before > (u16) (0xFFFF - 1);
    logic_var_rom_d0_x = logic_var_rom_d0_c;
}

int main(bool hardReset)
{
    u16 rds_boot_frame;
    (void) hardReset;
    rds_publish_oracle(logic_var_rom_d0, 0);
    for (rds_boot_frame = 0; rds_boot_frame < 90; rds_boot_frame++)
    {
        SYS_doVBlankProcess();
    }
    while (TRUE)
    {
        node_generated_rom_addq_word();
        rds_publish_oracle(
            logic_var_rom_d0,
            (logic_var_rom_d0_n ? 1 : 0) |
                (logic_var_rom_d0_z ? 2 : 0) |
                (logic_var_rom_d0_v ? 4 : 0) |
                (logic_var_rom_d0_c ? 8 : 0) |
                (logic_var_rom_d0_x ? 16 : 0)
        );
        SYS_doVBlankProcess();
    }
    return 0;
}
