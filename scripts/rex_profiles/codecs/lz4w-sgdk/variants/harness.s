/* Harness LZ4W variantes — executa o desempacotador OFICIAL (rótulo
 * lz4w_unpack, incluído verbatim de tools_a.s SGDK 2.11 via official.s).
 * LICENÇA: tools_a.s é LGPL/SGDK — este harness é ferramenta externa de
 * teste (oráculo); NADA daqui entra no produto.
 *
 * Contrato de posicionamento testado aqui (layout 68k / pipeline rescomp):
 *   a0 = início do stream; "dicionário" = bytes imediatamente ANTES do
 *   stream no MESMO espaço (aqui ROM, precedido de gap 0x5AA5 determinístico
 *   para over-read legível). dst = buffers RAM independentes (0x200 B),
 *   pré-preenchidos com 0xFE para detectar escrita além do retornado.
 *
 * Captura (lua/MAME):
 *   $FF0000 + i*4 : u32 BE = tamanho devolvido em d0 p/ caso i
 *   $FF0100       : u32 BE $DEADBEEF quando todos os casos terminarem
 *   $FF0200 + i*0x200 : dst do caso i (512 B)
 */
	.section .text.vectors
vtab:
	.long 0xFFFFFFFE
	.long reset
	/* nível 2..7, trap, traçador etc. -> stub */
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
	.ascii "LZ4W VARIANTS T1"
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

	/* pré-preenche o dst atual com 0xFEFE */
	move.l %a4, %a0
	move.w #0xFEFE, %d2
	move.w #255, %d3
fill_lp:
	move.w %d2, (%a0)+
	dbf %d3, fill_lp

	/* chamada C-stack do desempacotador oficial: empilha dst, depois src
	 * (prologue oficial: movem.l 4(sp),a0-a1 -> a0=4(sp)=src, a1=8(sp)=dst) */
	move.l %a4, -(%sp)
	move.l %a3, -(%sp)
	jsr lz4w_unpack
	addq.l #8, %sp

	move.l %d0, (%a5)+              /* tamanho devolvido */
	adda.l #0x200, %a4
	jmp main_loop

done:
	move.l #0xDEADBEEF, 0xFF0180
halt:
	bra halt
