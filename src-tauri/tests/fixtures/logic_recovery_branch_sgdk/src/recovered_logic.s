    .section .text
    .globl recovered_branch_logic_bridge
    .type recovered_branch_logic_bridge,@function
recovered_branch_logic_bridge:
    move.l 4(%sp),%d0
    jsr recovered_branch_logic
    rts

    .globl recovered_branch_logic
    .type recovered_branch_logic,@function
recovered_branch_logic:
    addi.w #1,%d0
    cmpi.w #5,%d0
    bge.s .branch_true
    move.w #0,0xE0FFFF00.l
    rts
.branch_true:
    move.w #1,0xE0FFFF00.l
    rts
