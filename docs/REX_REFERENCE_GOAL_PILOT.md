# REX — passagem de objetivo no jogo de referência (Experimental)

Fatia dependente `codex/rex-reference-goal-pilot`, sem merge. Reutiliza o jogo builtin `reference_platformer`; não recupera uma rotina de ROM externa e não amplia instruções nem perfil. O comportamento permanece **Experimental**, restrito a esta cena e ao caminho SGDK/Mega Drive comprovado.

## O que está ligado no jogo

O bloqueador da passagem (`passage_blocker`) é uma entidade visual com colisão sólida 16×32. O marcador visual do objetivo (`goal`) é separado e não colide; a entidade `goal_sensor` é uma AABB invisível, não sólida, que detecta a conclusão. Com a passagem fechada, o ramo de movimento consulta simultaneamente a colisão e `goal_open`; movimento fica impedido enquanto há sobreposição. Ao abrir, o bloqueador fica oculto e a condição permite o movimento através da mesma AABB. A aparência acompanha a colisão: a cena inicial mede pixels da barreira e o core mostra posição do player antes/depois — não se usa o desaparecimento do sprite como prova de travessia.

No ciclo real do jogo, `BUTTON_RIGHT` incrementa `reference_score` uma vez e grava o valor. Em seguida o grafo lê de novo a variável armazenada e compara `reference_score >= threshold`, sem somar na comparação. O ramo altera `goal_open` e só oculta o bloqueador. Ao tocar o sensor, o evento one-shot chama `XGM_startPlayPCM(SFX_GOAL_SOUND, ...)` antes de definir `goal_reached=1`; o valor `goal_reached` foi observado na RAM real da ROM após o contato. A forma de onda de saída não é capturada por este teste; o que fica provado é a chamada de áudio dentro do ramo que foi executado e a gravação one-shot observada.

## Autoria, persistência e prova da ROM

É autoria do template builtin, não recuperação assistida. No editor, o parâmetro editável aparece como **“Pontos para abrir passagem”**, com origem `authored_builtin_reference_platformer`, semântica e source mapping `graphs/reference_platformer_logic.json:24`. O perfil condicional reutilizado continua experimental. Save, fechar/reiniciar, reabrir, confirmar limiar/mapping, compilar e executar foram exercitados pela interface.

Evidência de execução: `src-tauri/target-test/validation/reference-platformer-2026-09-22T22-54-19-868Z-report.json` (gerada pelo E2E desktop). O app exercitado é `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `f0eada419f91f8b05b0a0ddf2484684f14ef0bf0b9fbb85eb23235e68c72e319`. O relatório contém snapshots imutáveis das ROMs original e editada, hashes dos C gerados, sequência de input, score e estado lidos dos símbolos na RAM 68K do core, pixels do framebuffer e screenshots. As cópias `*-goal-original.rom` e `*-goal-edited.rom` preservam exatamente as duas ROMs testadas, antes dos builds de tilemap/reabertura que reutilizam o caminho de saída.

Com a entrada comum `Right` por 8 frames, a ROM gerada antes da edição (`threshold=6`) observou score real `8` e `goal_open=1`; a cópia gerada após editar/reabrir (`threshold=12`) observou score real `8` e `goal_open=0`. O código C gerado registra incremento antes de comparar a variável gravada. As ROMs efetivamente observadas pelo core são identificadas por seus SHA no relatório: original `33258082e6b5b64c12dc14d7fb6c9d7da17410d62b6a826ff6b7b547c46b6d00`; ROM recompilada/editada `0ed0e439c82dc3bb94699b58ef66a2ae5110afb0da4605ee0494f85835899a75`. A prova causal não é a diferença de hash/build: é o mesmo input produzindo score 8, estados opostos de `goal_open` lidos da RAM e o estado visual correspondente na ROM identificada.

## Fronteiras e travessia observadas

O teste reinicia cada ROM no mesmo estado, alimenta inputs equivalentes e lê o score real após cada sequência. Posição abaixo/do limiar permanece em `x=41..50` com a barreira renderizada; após a abertura, a posição chega a `x=57..66`, passando o limite `x=50`, e o pixel count da barreira cai para zero. A comparação é `>=`, por isso igualdade abre o estado lógico no mesmo frame em que o score é incrementado. O framebuffer ainda mostra a barreira nesse instante de fronteira (atualização visual do VDP até o frame seguinte); no passo seguinte os pixels da barreira são zero. A posição permanece inalterada no frame da abertura e só avança depois.

| Limiar salvo | Sequência | Score RAM | `goal_open` RAM | Barreira / posição observadas |
| ---: | --- | ---: | ---: | --- |
| 6 | abaixo: 5 frames | 5 | 0 | 399 pixels; player `x=41..50` (bloqueado) |
| 6 | igual: +1 frame | 6 | 1 | player ainda `x=41..50`; visual antigo durante o frame de transição |
| 6 | acima: +1 frame | 7 | 1 | 0 pixels de barreira |
| 6 | travessia: +8 frames | 15 | 1 | player `x=57..66` |
| 12 | abaixo: 11 frames | 11 | 0 | 399 pixels; player `x=41..50` (bloqueado) |
| 12 | igual: +1 frame | 12 | 1 | player ainda `x=41..50`; visual antigo durante o frame de transição |
| 12 | acima: +1 frame | 13 | 1 | 0 pixels de barreira |
| 12 | travessia: +8 frames | 21 | 1 | player `x=57..66` |

Após a sequência longa até o sensor, `goal_reached=1` foi lido na RAM nas duas ROMs; o evento one-shot do sensor contém a chamada PCM anterior à gravação de conclusão. Valores finais de score após inputs continuados: 75 (limiar 6) e 81 (limiar 12).

## Matriz de aceite

### Comprovado

| Critério | Evidência |
| --- | --- |
| Entidades de passagem e conclusão separadas | Cena reaberta contém `passage_blocker`, `goal` e `goal_sensor`; o sensor não é sólido, o bloqueador é sólido e o marcador não colide. |
| Fechada bloqueia, aberta permite atravessar | Inputs equivalentes; player `x=41..50` enquanto fechado e `x=57..66` depois de aberto; contagem visual da barreira `399→0`. |
| Fronteiras abaixo/igual/acima | RAM medida para `5/6/7` e `11/12/13`, com `goal_open` `0/1/1`; regra `>=`. |
| Sem somar de novo no teste do limiar | C gerado incrementa e grava `reference_score`; a comparação usa leitura posterior; RAM lê score 8 após 8 inputs e não 9/16. |
| Edição e reabertura | UI muda 6→12, salva, reinicia/fecha, reabre e confirma valor + mapping antes da compilação. |
| ROM do grafo de fato exercitada | Hash da ROM copiada antes de ser sobrescrita é ligado à observação do core; os estados de RAM e framebuffer distinguem os limiares sob o mesmo input. Relatório e capturas são artefatos do workflow Desktop E2E. |
| Objetivo, vitória e evento | Contato real com o sensor produz `goal_reached=1`; C gerado despacha a chamada PCM no mesmo ramo one-shot antes da gravação observada. |
| ADDQ e branch-compare preservados | Reexecutados no mesmo binário f0eada4: `logic-recovery-2026-09-22T22-58-17-445Z-report.json` prova original #1/node/no-op `0x12340058→0x12340059`, patch #2 `→0x1234005A`, original/original, flags e wrap. `logic-recovery-branch-2026-09-22T22-58-44-489Z-report.json` prova dois ramos e `[3,4,5,0,0xFFFF,0x1234]→[0,1,1,0,0,1]`, incluindo fronteiras assinadas e wrap de word. Fixtures duráveis continuam em `src-tauri/tests/fixtures/`. |

### Pendências e limites

- O teste prova despacho da função PCM pelo evento do sensor, mas não faz loopback/captura acústica desta chamada específica.
- Não é recuperação da rotina autoral nem reconstrução de Sonic; autoria e recuperação assistida continuam separadas.
- Não certifica equivalência geral M68K, callers indiretos/PC-relative, outras larguras/operações, SNES ou suporte geral ao jogo.
- O perfil e a funcionalidade permanecem **Experimental**, sem promoção ou merge.

As regressões ADDQ e branch-compare usam as fixtures duráveis em `src-tauri/tests/fixtures/logic_recovery_sgdk/` e `src-tauri/tests/fixtures/logic_recovery_branch_sgdk/`. Corpus BYOR local, ROM comercial e arquivos de terceiros não fazem parte desta entrega.
