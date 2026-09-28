# Revisão do adaptador e da serialização — rodada 3 (PR #84)

Estado revisado: canônico local `63d39a2` (curadoria do integrador, ainda não publicada) sobre
`f35ed0d` (cherry-pick de `308fd44`, rodada 1). Revisão somente leitura; nenhum arquivo do
integrador foi editado.

## 1. O que está no canônico

| Item | Situação |
|---|---|
| crate `rex-gameplay` | **só a rodada 1**. Faltam `emit.rs`, `locate`/`locate_unique` e `tests/hardening.rs` (`4163c47`, `9b3e755` e seguintes). |
| adaptador `rex_gameplay.rs` | idêntico a `308fd44`: sem `locate_unique` e com a prova real antiga (80/80) |
| `registry.json` | texto correto para a rodada 1 (16 testes, 80/80, nada alegado além disso) |
| `lib.rs` / IPC / UI | nada ainda; não há adaptador IPC a revisar |

**Pedido:** trazer `4163c47..HEAD` do branch da frente. Sem isso, o canônico mantém a
regeneração que remonta instruções salvas (e não a emissão semântica) e uma prova real que
pega o único candidato por contagem.

## 2. Serialização — o que preserva e o que não

| Propriedade | Verificado por | Resultado |
|---|---|---|
| operação, parâmetro, conexão ou mapping adulterado isoladamente é recusado | `profile.rs::tampered_graphs_are_refused` | ✓ |
| rótulos, `x` e `y` são os únicos campos ignorados na comparação | `graph.rs::strip_labels` | ✓ (nenhum campo semântico começa com `label`) |
| limites: limiar fora do `MOVEQ` é recusado na edição, na reabertura e na emissão | `profile.rs`, `hardening.rs` | ✓ |
| a chamada opaca continua `understood:false` e com os bytes preservados | `hardening.rs::opaque_call_*` | ✓ |
| o código de produto não contém constantes de fixture | grep em `crates/rex-gameplay/src` fora de `#[cfg(test)]` e no adaptador | ✓ (`0x946`, `E0FF0054`, `B10C` só aparecem em testes) |
| salvar/reabrir não troca a semântica por parâmetros conhecidos | a reabertura reeleva a partir dos `source_mappings` do próprio grafo; nada vem de fixture | ✓ |
| **reabrir vincula o grafo à ROM** | `hardening.rs::consistent_forgery_reopens_but_is_refused_against_the_base` | **✗ por desenho** (ver abaixo) |

**Achado:** `open_graph` verifica só a consistência **interna**. Uma falsificação coerente
reabre sem erro, por exemplo `value 1→2` junto com os bytes `7601→7602`, o `imm` e o mnemônico.
Ela é recusada apenas em `patch_threshold` e `regenerate_from_graph`, que conferem o SHA e os
bytes contra a base (`0x000CAE ... recusado`).

**Recomendação para o comando de reabrir:** receber a ROM-base (ou o seu SHA mais os bytes)
e executar a mesma verificação de `verify_base` antes de exibir o grafo como "recuperado".
Posso expor `patch::verify_against_base` como função pública, no meu território, se o
integrador quiser. Não fiz isso sem combinar.

## 3. Pontos para o adaptador IPC (quando existir)

1. Localizar usando `locate`/`locate_unique`; a UI lista os candidatos e nunca usa `[0]`.
2. Reabrir vinculado à base (item acima).
3. O DTO deve expor `limitations` e a chamada opaca (`understood:false`, alvo e argumentos)
   como campos, e não só dentro de `graph_json`.
4. A saída deve ser um caminho novo e distinto da base (já é assim em `rebuild_gameplay_rom`).
5. Checksum: seguir a decisão do §5 da proposta. Enquanto nada for decidido, o DTO deveria
   avisar que a saída fica com `mismatch` na inspeção.
6. Executar fora do thread principal.

## 4. "Contador e `goal_open` só são escritos pela rotina": alcance da evidência

| Nível | Evidência | Cobre | Não cobre |
|---|---|---|---|
| **fonte autoral** | grafo do template: `reference_score` só é escrito por `score_set`; `goal_open` só por `open_goal`/`close_goal`, todos na cadeia `update_score` | a intenção do autor | o que o compilador e a SGDK geram |
| **referências estáticas** (ROM `86c4e90d…`) | varredura de **todos** os literais de 32 bits iguais aos dois endereços, sem aliases `abs.W`/`00FF`/`FFFF`: 7 referências. As 3 escritas (`0x954`, `0x96A`, `0xCB0`) estão na região; as 4 restantes são leituras (`0x94C`, `0x95A` na região; `0xB7C` `MOVEA.L`, `0xBE6` `MOVE.L`, as checagens da passagem). Nenhuma toma o endereço como ponteiro. | escrita por endereçamento absoluto | escritas **indiretas**: inicialização de RAM do boot SGDK (`sys.c`/`sega.s`, cópia de `.data`/zeragem de `.bss` via ponteiro, com os literais `E0FF0000..E0FFFFFF` em `0x1A6`/`0x1AA`), `memset`/`memcpy` genéricos, o corpo do callee `0xB10C` |
| **observação dinâmica** | 160 casos × 1 quadro + 3 × 30 quadros: contador e `goal_open` sempre iguais ao previsto pela regra | que, **nesses estados e quadros**, nenhum outro escritor alterou os valores | outros quadros, cenas e estados; escritas que produzam o mesmo valor |

**Formulação correta:** "todas as escritas por endereço absoluto a esses dois endereços estão
dentro da região, e nos quadros medidos os valores observados coincidem com a regra". Isso
**não** equivale a "só a rotina escreve". A equivalência não se estende a flags, registradores,
CCR nem aos efeitos do callee: nada disso foi medido no core.

Comando da varredura (qualquer ROM):

```
node -e 'const b=require("fs").readFileSync(process.argv[1]);for(const a of [0xE0FF0054,0xE0FF0062])for(let i=0;i+4<=b.length;i+=2)if(b.readUInt32BE(i)===a)console.log(a.toString(16),"0x"+(i-2).toString(16),b.readUInt16BE(i-2).toString(16))' original-t6.rom
```

## 5. Contador em RAM deslocada: continua sem prova retida

Nas duas variantes deslocadas da rodada 2, o contador ficou em `0xE0FF0054`. **O requisito
"contador em endereço de RAM diferente, em amostra cega" continua aberto.**

- Na rodada 2, a asserção foi restringida ao que se demonstrou (código e estado); o requisito
  original **não** foi dado como fechado.
- Isso não impede o fluxo delimitado atual (original → edição → efeito), que não depende
  desse deslocamento.
- Uma nova amostra exigiria deslocamento obtido por build/link autoral reproduzível. Um
  exemplo seria declarar uma variável da cena antes de `reference_score`, se o emissor e o GCC
  a colocarem antes. Isso exigiria congelar de novo o reconhecedor e registrar a assistência
  usada. Não preparei essa amostra nesta rodada, que é de fechamento e não de expansão.
