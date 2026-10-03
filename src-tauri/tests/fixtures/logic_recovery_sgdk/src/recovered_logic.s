    .section .text
    .globl recovered_addq_word_bridge
    .type recovered_addq_word_bridge,@function
recovered_addq_word_bridge:
    move.l 4(%sp),%d0
    jsr recovered_addq_word
    rts

    .globl recovered_addq_word
    .type recovered_addq_word,@function
recovered_addq_word:
    addq.w #1,%d0
    rts
