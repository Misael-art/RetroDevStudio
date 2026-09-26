/* Harness2 LZ4W — replay de streams do ENCODER RUST com o desempacotador
 * OFICIAL (lz4w_unpack de tools_a.s SGDK 2.11 via official.s).
 * LICENÇA: tools_a.s é LGPL/SGDK — harness é ferramenta externa de medição
 * (oráculo); NADA daqui entra no produto.
 *
 * Diferença p/ harness.s: o encoder Rust emite matches longos SEM bit-ROM
 * (offset medido a partir do fim do resultado dicionário+saída). O contexto
 * então vive no DESTINO: o harness copia o prefixo-dicionário (bytes ROM
 * antes do stream) para o início do buffer dst e chama
 *   lz4w_unpack(src, dst + prefix_len)
 * — exatamente o layout do pipeline do produto (decode com Some(&rom[..start])).
 * O MESMO blob de prefixo fica antes do stream na ROM (cobre referências com
 * bit-ROM source, como no recurso original do corpus em 0xc8cc8).
 *
 * Tabela por caso (4 longs): src, dict(ROM), plen, stride. Buffers dst são
 * contíguos a partir de $FF0200, cada um com `stride` bytes (a soma deve
 * caber na Work RAM de 64 KiB).
 *
 * Captura (lua/MAME):
 *   $FF0000 + i*4      : u32 BE = d0 retornado p/ caso i
 *   $FF0180            : u32 BE $DEADBEEF quando terminar
 *   $FF0200 + offsets  : dsts contíguos (soma dos strides)
 */
	.section .text.vectors
vtab:
	.long 0xFFFFFFFE
	.long reset
	.long err_st, err_st, err_st, err_st
	.long err_st, err_st, err_st, err_st
	.long err_st, err_st, err_st, err_st
	.long err_st
	.long err_st /* spurious */
	.long err_st /* autovector 1 */
	.long err_st, err_st, err_st, err_st
	.long err_st, err_st, err_st, err_st
	.long err_st, err_st, err_st, err_st
	.long err_st, err_st, err_st, err_st
	.space 0x100 - (. - vtab)
	.ascii "SEGA GENESIS    "
	.ascii "LZ4W RUSTCAPT T1"
	.ascii "REXBCODECSHAR   "
	.ascii "J"
	.word 0x0000
	.word 0x0000
	.word 0x0000
	.space 0x1E0 - (. - vtab)
	.long 0
	.long 0
	.space 0x200 - (. - vtab)

	.text
err_st:
	bra err_st

reset:
	move.w #0x2700, %sr
	move.l #0xFFFFFFFE, %a7

	.set STATUS, 0xFF0000
	.set DST0,   0xFF0200
	lea case_table, %a6
	lea STATUS, %a5
	move.l #DST0, %a4

main_loop:
	cmpa.l #case_table_end, %a6
	jcc done
	move.l (%a6)+, %a3              /* a3 = src (início do stream) */
	move.l (%a6)+, %a2              /* a2 = prefixo-dicionário na ROM */
	move.l (%a6)+, %d5              /* d5 = plen (bytes) */
	move.l (%a6)+, %d7              /* d7 = stride */

	/* pré-preenche o dst do caso com 0xFEFE (stride/2 words) */
	move.l %a4, %a0
	move.w #0xFEFE, %d2
	move.l %d7, %d3
	lsr.l #1, %d3
	subq.w #1, %d3
fill_lp:
	move.w %d2, (%a0)+
	dbf %d3, fill_lp

	/* copia o prefixo do dicionário (ROM -> dst), word a word */
	move.l %a4, %a0
	move.l %d5, %d4
	lsr.l #1, %d4
	beq do_call
copy_lp:
	move.w (%a2)+, (%a0)+
	dbf %d4, copy_lp

do_call:
	/* chamada C-stack oficial: empilha dst, depois src
	 * (prologue oficial: movem.l 4(sp),a0-a1 -> a0=src, a1=dst) */
	move.l %a4, %d1
	add.l %d5, %d1                  /* dst = base + plen */
	move.l %d1, -(%sp)
	move.l %a3, -(%sp)
	jsr lz4w_unpack
	addq.l #8, %sp

	move.l %d0, (%a5)+              /* tamanho devolvido */
	adda.l %d7, %a4
	jmp main_loop

done:
	move.l #0xDEADBEEF, 0xFF0180
halt:
	bra halt
