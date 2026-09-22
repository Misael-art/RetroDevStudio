#ifndef RDS_LOGIC_RECOVERY_FIXTURE_COMMON_H
#define RDS_LOGIC_RECOVERY_FIXTURE_COMMON_H

#include "genesis.h"

#define RDS_ORACLE_VALUE ((volatile u32 *) 0xE0FFFF00)
#define RDS_ORACLE_FLAGS ((volatile u16 *) 0xE0FFFF04)

static void rds_publish_oracle(u32 value, u16 flags)
{
    *RDS_ORACLE_VALUE = value;
    *RDS_ORACLE_FLAGS = flags;
}

static u16 rds_flags_for_word(u16 before, u16 result, u16 immediate)
{
    u16 flags = 0;
    if (result & 0x8000) flags |= 1;
    if (result == 0) flags |= 2;
    if ((s16) before >= 0 && (s16) result < 0) flags |= 4;
    if ((u32) before + immediate > 0xFFFF) flags |= 8;
    if (flags & 8) flags |= 16;
    return flags;
}

#endif
