# Contrato — `m68k.counter_threshold_state_gate.v1` (Experimental)

Recuperação **delimitada** de uma regra de gameplay com estado e decisão a partir
dos bytes de uma ROM Mega Drive. Não é decompilação geral, não é recuperação de
função inteira e não se aplica a Sonic nem a ROM comercial nesta versão.

## Entradas (todas declaradas pelo chamador)

| Entrada | Obrigatória | Uso |
|---|---|---|
| bytes da ROM | sim | única fonte da semântica |
| offset de entrada da região | sim | início do percurso |
| offsets de saída da região | sim | todo caminho tem de terminar num deles |
| nomes de endereços (metadados, ex.: símbolos ELF) | não | **somente rótulos** (`address_label`); nunca entram na elevação |

O caminho de recuperação não lê fonte C, AST, grafo autoral nem resultado esperado.
`locate` é uma varredura estrutural da forma com guarda. Ela devolve **candidatos**
(que elevam no perfil) e **quase-casos** (mesma abertura `BTST ; BEQ`, recusados na
elevação, com o motivo), não prova de uso em gameplay. `locate_unique` exige exatamente
um candidato: com zero ou mais de um, recusa listando o que achou. Nunca escolhe a
primeira ocorrência. `scan_guarded_candidates` = `locate(..).candidates`.

## Subconjunto M68000 aceito (fechado)

`MOVE.L abs.L,Dn` · `MOVE.L Dn,abs.L` · `ADDQ.L #q,Dn` · `ADDQ.L #q,SP` ·
`MOVEQ #i,Dn` · `CMP.L Dn,Dn` · `BTST #n,Dn` · `Bcc.S/.W` (eq/ne/ge/lt/gt/le) ·
`BRA.S/.W` · `PEA abs.W` · `MOVE.L abs.L,-(SP)` · `JSR abs.L`.

Qualquer outro opcode, `BSR`, `Bcc.L`, condições sem sinal, ciclos, instruções
sobrepostas, saída não alcançada, desvio para fora das saídas, ou mais de 64
instruções: **recusa** com offset e motivo. Nada vira no-op.

## Forma elevada

```
[guarda]     BTST #b,Dk ; BEQ saída                       (opcional)
[contador]   MOVE.L C,Dx ; ADDQ.L #q,Dx ; MOVE.L Dx,C     (opcional)
leitura      MOVE.L C,Dx
limiar       MOVEQ #K,Dy ; CMP.L (Dx,Dy | Dy,Dx) ; Bcc
resultados   2 blocos: MOVEQ #v,Dz ; MOVE.L Dz,G ; [PEA #w ; MOVE.L P,-(SP) ; JSR T ; ADDQ.L #8,SP] ; (fall-through | BRA) saída
```

Semântica recuperada: se a guarda falha, nada é escrito. Senão `C := C + q`
(32 bits, complemento de dois, com wraparound), e `G := v_set` quando
`C OP T`, senão `G := v_other`. `OP ∈ {>=, <, ==, !=}` e `T = K + bias`, derivados da
condição, da ordem dos operandos do `CMP` e da polaridade (qual ramo escreve o
valor não nulo). Comparação **assinada de 32 bits**; `K` é o `MOVEQ` estendido.

## Partes não compreendidas (explícitas)

- Equivalência observada na WRAM após quadros completos: inclui o callee e o resto do
  jogo. A alegação cobre só contador e estado: todas as suas escritas por endereço
  absoluto estão na região. Escritas indiretas (boot/`.bss`, `memset`, callee) não estão
  cobertas. Flags, registradores, CCR e efeitos do callee não são medidos no core.
- `JSR T` é **opaco**: alvo e argumentos são registrados (`rom_external_call`,
  `understood: false`); o corpo não é recuperado; D0/D1/A0/A1/CCR passam a
  desconhecidos após a chamada (ABI m68k-elf-gcc).
- A vivacidade de registradores e CCR após a saída não é analisada. O executor
  os registra; a equivalência declarada cobre escritas de memória e chamadas.
- Outros escritores de `C`/`G` fora da região não são analisados pelo pacote
  (a prova real verifica estruturalmente os escritores por endereço absoluto).

## Grafo

NodeGraph v1 (`version`, `nodes`, `edges`, `params`) com bloco `rex_gameplay`
(perfil, SHA-256 da ROM, entrada, saídas, blocos). Tipos de nó:
`rom_region_entry`, `rom_input_bit_guard`, `rom_counter_add`,
`rom_counter_compare`, `rom_state_write`, `rom_external_call`, `rom_region_exit`.
Cada nó leva `semantic_origin: "recovered_from_rom"` e `source_mappings`
(offset, bytes, mnemônico, instrução estruturada). `label`/`label_origin` e
`address_label` são apresentação; não participam da validação.

**Reabrir** remonta as instruções mapeadas, delimita e eleva de novo e exige que o
grafo reconstruído coincida com o salvo (exceto rótulos, posição e o limiar
editado). Operação, parâmetro, conexão ou mapping adulterados são recusados.

**Limite:** a reabertura verifica só a consistência **interna** do grafo. Uma falsificação
coerente (mapping e parâmetro alterados juntos) reabre; o vínculo com a ROM é cobrado na
reconstrução (SHA e bytes da base). Uma reabertura exibida como "recuperada da ROM" deve
verificar a base.

## Edição permitida

Somente o limiar `T` do nó `rom_counter_compare`, na faixa em que `K = T - bias`
cabe no `MOVEQ` original (`[-128+bias, 127+bias]`). Fora disso: recusa (não há
estratégia de crescimento; não se procura espaço livre nem se ajustam ponteiros).

## Reconstrução (dois caminhos, verificados — não presumidos — iguais)

- `patch_threshold`: reescreve só o byte imediato do `MOVEQ`.
- `regenerate_from_graph`: **emite a região a partir da regra semântica** (`emit::emit_region`).
  - Operandos: vêm dos campos da `GateRule` do grafo aberto (bit da guarda, endereço do
    contador, passo, limiar editado, operador/polaridade, valores e endereço de estado,
    alvo e argumentos da chamada, saída).
  - Do registro mapeado vêm só o **layout**: o offset de cada instrução e o tamanho `.S`/`.W`
    de cada desvio.
  - Da ROM-base não vem nenhum byte da região. Ela só fornece os bytes de fora da região,
    preservados e verificados.
  - `regeneration_plan` recusa se a semântica sem edição não reproduzir exatamente os bytes
    mapeados, se algum offset ficar sem emissão ou se o tipo de uma instrução mudar.
  - A ligação grafo ↔ regra é garantida na reabertura: `open_graph` reeleva e exige que os
    nós salvos coincidam com os reconstruídos.

Ambos exigem SHA-256 da base igual ao esperado **e** ao registrado no grafo, e
bytes da região iguais aos mapeados; recusam mudança de tamanho; verificam que
nenhum byte fora das faixas autorizadas mudou. O checksum do cabeçalho
(`0x18E`) é atualizado como faixa autorizada declarada **somente** se a base já
tinha checksum válido **pela soma MD aditiva**. ROMs do pipeline canônico usam o checksum
SGDK/sizebnd (XOR), que esta versão **não** atualiza. A saída do patch fica com checksum SGDK
desatualizado e o `inspect_rom_mastering` do produto reporta `mismatch`. A mudança de política
foi proposta ao integrador e não foi aplicada.

## Equivalência

Por conjunto declarado de estados (não prova universal): dois avaliadores do
pacote (instrução a instrução com flags; regra com aritmética inteira) são
cruzados em fronteiras, wraparound, ambos os ramos e guarda ligada/desligada; o
oráculo independente é a ROM original executada pelo core Libretro com estado
injetado (teste real do adaptador).
