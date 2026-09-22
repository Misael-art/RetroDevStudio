#ifndef RDS_LOGIC_RECOVERY_BRANCH_FIXTURE_COMMON_H
#define RDS_LOGIC_RECOVERY_BRANCH_FIXTURE_COMMON_H

#include "genesis.h"

#define RDS_BRANCH_RESULT ((volatile u16 *) 0xE0FFFF00)
#define RDS_BRANCH_INPUT ((volatile u16 *) 0xE0FFFF02)

static void rds_publish_branch_input(u16 value)
{
    *RDS_BRANCH_INPUT = value;
}

#endif
