# REX — passagem de objetivo no jogo de referência (Experimental)

Fatia dependente `codex/rex-reference-goal-pilot`, sem merge. Reutiliza o jogo builtin `reference_platformer`; não recupera uma rotina de ROM externa e não amplia instruções nem perfil. O comportamento permanece **Experimental**, restrito a esta cena e ao caminho SGDK/Mega Drive comprovado.

## O que está ligado no jogo

O bloqueador da passagem (`passage_blocker`) é uma entidade visual com colisão sólida 16×32. O marcador visual do objetivo (`goal`) é separado e não colide; a entidade `goal_sensor` é uma AABB invisível, não sólida, que detecta a conclusão. Com a passagem fechada, o ramo de movimento consulta simultaneamente a colisão e `goal_open`; movimento fica impedido enquanto há sobreposição. Ao abrir, o bloqueador fica oculto e a condição permite o movimento através da mesma AABB. A aparência acompanha a colisão: a cena inicial mede pixels da barreira e o core mostra posição do player antes/depois — não se usa o desaparecimento do sprite como prova de travessia.

No ciclo real do jogo, `BUTTON_RIGHT` incrementa `reference_score` uma vez e grava o valor. Em seguida o grafo lê de novo a variável armazenada e compara `reference_score >= threshold`, sem somar na comparação. O ramo altera `goal_open` e só oculta o bloqueador. Ao tocar o sensor, o evento one-shot chama `XGM_startPlayPCM(SFX_GOAL_SOUND, ...)` antes de definir `goal_reached=1`; o valor `goal_reached` foi observado na RAM real da ROM após o contato. A forma de onda de saída não é capturada por este teste; o que fica provado é a chamada de áudio dentro do ramo que foi executado e a gravação one-shot observada.

## Autoria, persistência e prova da ROM

É autoria do template builtin, não recuperação assistida. No editor, o parâmetro editável aparece como **“Pontos para abrir passagem”**, com origem `authored_builtin_reference_platformer`, semântica e source mapping `graphs/reference_platformer_logic.json:24`. O perfil condicional reutilizado continua experimental. Save, fechar/reiniciar, reabrir, confirmar limiar/mapping, compilar e executar foram exercitados pela interface.

Evidência final de execução: `src-tauri/target-test/validation/reference-platformer-2026-09-22T23-32-40-004Z-report.json` (gerada pelo E2E desktop completo). O app exercitado é `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `f0eada419f91f8b05b0a0ddf2484684f14ef0bf0b9fbb85eb23235e68c72e319`. O relatório contém snapshots imutáveis das ROMs original e editada, hashes dos C gerados, sequência de input, score e estado lidos dos símbolos na RAM 68K do core, pixels do framebuffer e screenshots. As cópias `*-goal-original.rom` e `*-goal-edited.rom` preservam exatamente as duas ROMs testadas, antes dos builds de tilemap/reabertura que reutilizam o caminho de saída.

Com a entrada comum `Right` por 8 frames, a ROM gerada antes da edição (`threshold=6`) observou score real `8` e `goal_open=1`; a cópia gerada após editar/reabrir (`threshold=12`) observou score real `8` e `goal_open=0`. O código C gerado registra incremento antes de comparar a variável gravada. As ROMs efetivamente observadas pelo core são identificadas por seus SHA no relatório: original `0351d890630885daf2115fca32c6c94bcc6d4461f721f9516150960b59adcd8c`; ROM recompilada/editada `bd97076a3a85c1bd3b5b2986664bb1214b1fc975bf28ba4ef6b457597afd87ee`. A prova causal não é a diferença de hash/build: é o mesmo input produzindo score 8, estados opostos de `goal_open` lidos da RAM e o estado visual correspondente na ROM identificada.

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

Capturas desta execução: [bloqueado antes de abrir](../src-tauri/target-test/validation/reference-platformer-2026-09-22T23-32-40-004Z-04-goal-open-before-edit-blocked-before-open.png), [travessia após abrir](../src-tauri/target-test/validation/reference-platformer-2026-09-22T23-32-40-004Z-04-goal-open-before-edit-traversed.png) e [editor com parâmetro/source mapping](../src-tauri/target-test/validation/reference-platformer-2026-09-22T23-32-40-004Z-05-authored-threshold-editor.png). O smoke genérico de salto é opcional e tem status próprio no relatório; ausência de ACK/efeito visual não altera nem substitui a prova de passagem.

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

## Checkpoint 2026-09-23 — fluxo autoral reutilizável (Experimental)

E2E desktop `src-tauri/target-test/validation/reference-platformer-2026-09-23T02-17-00-937Z-report.json`, binário `src-tauri/target-test/debug/retro-dev-studio` SHA `95095d3daa0b57cfdfbfcf429e803328c15f085e80b9130ce67e48c0ee7adec3`, commit `c3f6de4`. Todos os 15 passos passaram.

### Defeitos de produto encontrados e corrigidos

| Defeito | Efeito observado | Correção |
| --- | --- | --- |
| `KeyZ → RetroPad A` no Mega Drive | No Genesis Plus GX RetroPad Y/B/A = MD A/B/C; Z chegava como C, o salto nativo nunca ocorria (era a causa do "inconclusivo") | Mapa por plataforma: Z→Y (MD A), X→B, C→A; SNES inalterado |
| Build & Run não atualizava `coreEpoch` | Após qualquer recarga, o backend recusava todo input de teclado (`ACK=0`); o fallback direto no core do harness antigo mascarava isso | Build & Run ancora a época nova com o mesmo hold de sessão |
| `input_pressed` emitido como "segurado" | Segurar A mantinha o personagem voando | Borda de subida (`rds_joy_prev_N`) |
| `XGM_startPlayPCM(..., SOUND_PCM_CH_AUTO)` | Valor só válido em XGM2/DPCM2; no XGM v1 a chamada é no-op — **nenhum SFX tocava** (a prova anterior de "chamada PCM no C" não implicava som) | `SOUND_PCM_CH2` |
| `play_music` a cada frame | BGM reiniciada todo frame | Idempotente (`rds_music_current`/`XGM_isPlaying`) |
| Passagem só bloqueava ao mover para a direita | Pela esquerda atravessava fechada; sobreposto ficava preso | `condition_overlap` com `probe_dx` ("entraria no AABB"); gate nos dois sentidos |
| Entidades com mesmo asset colapsavam num sprite | Bloqueador duplicado não existia na ROM | Uma instância runtime por entidade |
| `rds_collision_map` não usado | Pintar colisão não tinha efeito físico | Chão por coluna a partir do mapa (pouso ao cair; células apagadas = fosso) |
| `source_line` fixo (24) com grafo em linha única | Source mapping não apontava a linha real | Grafo gravado um nó por linha; `source_line` recalculado ao salvar |

### Matriz

| Capacidade | Classificação | Evidência |
| --- | --- | --- |
| Movimento por teclado nativo | Funcional pela interface | ACK `right=true`, `spr_player_x` 32→58 na RAM, sem fallback no core |
| Salto por teclado nativo | Funcional pela interface (tempo avançado pelo core, input pelo caminho real) | y 192→185→192; segurado pousa em 192 |
| Salto/ápice/queda/pouso, segurar A | Comprovado por teste técnico | `reference_platformer_real_jump_and_goal_audio_contract` (SGDK+core oficiais) |
| SFX de vitória gerado pelo core | Comprovado por teste técnico | Controle com o mesmo código/input e WAV silenciado: stream idêntico até o evento (frame 52), rajada nos frames 56–70, volta a idêntico; BGM determinística e não silenciosa |
| Áudio encaminhado ao dispositivo | Funcional (camada WebAudio) | `receivedNonZeroFrames=7358`, `renderedNonZeroFrames=6624`, `AudioContext=running`, 44100 Hz |
| Captura acústica/loopback | Inconclusivo | `parec @DEFAULT_MONITOR@` não retornou amostras neste host |
| Passagem pelos dois lados / sobreposto | Comprovado por teste técnico | `reference_platformer_real_passage_gating_contract`: para em x=36 (esq.), x=66 (dir.), sai quando começa dentro |
| Segunda passagem configurada pela UI | Funcional pela interface | Inspector "Duplicar" + X=120; painel "Passagens" limiar 60; salvar/fechar/reabrir preserva refs; ROM `5d624f9f…`: principal abre no score 12 com a 2ª fechada, jogador segura em x=106 por 13 frames, 2ª abre no 60, x final 206 |
| Colisão pintada na física da ROM | Comprovado por teste técnico | Fosso x=80..95: parado sobre ele cai a y=208; piso não editado mantém 192 |
| Colisão/cenário pela UI até a ROM | Parcial | Tilemap visual pela UI já comprovado; colisão pela UI + física ainda sem E2E |
| Animação, regra com validação pela UI, autoria sem preparação, reinserção gráfica | Não implementado nesta fatia | — |

### Limites

- Sem paredes de tile horizontais: andando, o jogador sobe a borda de um fosso raso.
- O salto no E2E avança frames pelo core com o jogo pausado; o loop de frames do WebView é lento sob WebDriver. O estado da tecla segue o caminho real (evento nativo → frontend → ACK).
- `sgdk_matrix_corpus_skip_requires_explicit_env_flag_when_donor_missing` falhou uma vez na suíte paralela e passa isolado (corrida de variável de ambiente preexistente).
- Tudo segue **Experimental**, restrito ao template SGDK/Mega Drive.

## Checkpoint 2026-09-23 (b) — cenário, colisão e animação pela UI até a ROM

E2E `reference-platformer-2026-09-23T03-06-00-927Z-report.json`, binário SHA `d2ec495b4fc281d06d111031fa74e0d0b0f64ce351c38cd7d44f24137678b9e8`, commit `af11d4e`: 16/16 passos.

Na mesma sessão de autoria (antes de salvar/fechar/reabrir): 4 células do tilemap (cols 10–11, linhas 26–27) repintadas com o tile 1; colisão das mesmas células apagada no modo colisão (botão direito), `collisionSolidCount 88→84`; FPS da animação `idle` 4→12 no Inspector; segunda passagem adicionada. Após reabrir, a cena salva mantém as 4 células livres e a célula não editada (26,20) sólida; FPS e passagens persistem.

ROM `5084e8ff…` (duas passagens + fosso + animação):
- Física: ao passar sobre o fosso o personagem desce (x=74..86, y 193→205); antes dele y=192 constante.
- Visual: hash da região do fosso ≠ hash da região de piso não editada no mesmo frame.
- Animação: troca do frame idle nos frames 1,6,11,…,36 (período 5 = 60/12); o original (4 fps) troca a cada 15 (teste técnico `reference_platformer_real_animation_timing_contract`).
- Passagens: principal abre no score 12 com a segunda fechada; segura em x=106 por 13 frames; segunda abre no score 60.

Defeitos adicionais corrigidos nesta etapa:
- Reidratação assíncrona do NodeGraph (`graph_ref`) sobrescrevia edições locais ainda não autosalvas quando outro painel alterava a cena (teste de regressão com mutação verificada).
- Edição de sprite em instância de prefab gerava override parcial sem `asset`; o backend rejeitava a cena inteira, o salvar falhava e a cena era recarregada do disco, descartando outras edições. A edição de FPS agora grava o componente completo. **Outras edições aninhadas do Inspector em instâncias de prefab podem ter o mesmo defeito** — não auditadas.
- NodeGraph passa a acusar referência de entidade inexistente, parâmetro não inteiro/fora de faixa, operador inválido e nome de variável inválido (erros com nó e parâmetro).

Limites: célula de tilemap 0 significa "sem sobreposição" no emissor (pintar "vazio" não altera a ROM); sem paredes de tile horizontais; reordenar frames de uma animação não é representável no recurso SPRITE do rescomp (só duração); medições de passagem/fosso usam `emulator_send_input` controlado (teclado nativo coberto nos passos de movimento/salto).
