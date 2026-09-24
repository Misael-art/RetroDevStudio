# Comportamentos reutilizáveis (Experimental)

Branch `codex/reusable-behaviors`, **dependente** de `codex/nodegraph-organize-authoring` (PR #75, HEAD revisado `e316942`), que por sua vez depende de `codex/reference-platformer-fox-art`. Sem merge nem release. Não se aplica a recuperação de lógica de ROMs comerciais.

## Entregue

- **Biblioteca** (`src/core/nodegraph/behaviorLibrary.ts`) com dois comportamentos completos:
  - *Movimento e salto*: entidade, velocidade (1–8 px/quadro), botões de direita/esquerda/salto (com a tecla correspondente), força do salto (8–128), animação e som do salto opcionais (somente os que existem na entidade/cena).
  - *Passagem condicionada*: movimento bloqueado (instância de movimento da entidade), bloqueio (entidade com sprite/colisão), variável de estado existente e limiar (0–32767). Cria uma variável de abertura **exclusiva da instância**.
- Os comportamentos geram nós comuns do NodeGraph: mesmo salvamento, mesma compilação SGDK, grafo acessível ("Ver no grafo") e agrupado.
- **Identidade**: cada instância tem id único na cena inteira (as variáveis derivadas dele são globais na ROM). Referências externas (bloqueio, variável, instância de movimento) são parâmetros explícitos.
- **Aplicar/editar/remover** passam por um plano: parâmetros e referências inválidos são recusados com mensagem; duplicar lógica na mesma entidade, lógica manual concorrente, edições manuais e conexões manuais nos nós gerados aparecem como conflitos a confirmar; remover um movimento do qual uma passagem depende é recusado; editar preserva ids/posições e reaplica dependentes; remover restaura as conexões substituídas no lugar original; referências órfãs após reabrir são avisadas.
- **UI**: painel "Comportamentos" no editor de lógica (descrição, formulário tipado com limites, resultado ao vivo, erros, conflitos, ver/editar/remover) e seletor "Editar lógica de"; tudo pelo histórico (desfazer/refazer).
- **Duplicar entidade** copia só os comportamentos, remapeando ids, alvo e estado privado; mantém e lista referências externas; nunca herda o `graph_ref` nem a lógica manual do original (aviso antes).
- **Grupos recolhidos** (lacuna da etapa anterior): a caixa fica abaixo dos cartões (controles de outros nós seguem acessíveis), ocupa espaço no organizar sem reorganizar os membros ocultos, é incluída na verificação de sobreposição e gera aviso quando cobre um cartão; fixados sob a caixa viram conflito informado.

## Defeitos reais encontrados e corrigidos

| Defeito | Efeito | Correção / regressão |
| --- | --- | --- |
| `set_velocity` escrevia `spr_<id>_vel_*`, mas entidades que compartilham o sprite usam `spr_<recurso>__<id>` na física | salto sem efeito em qualquer cópia (o jogador original funcionava por coincidência de nomes) | variável real resolvida no gerador; teste Rust `set_velocity_targets_the_physics_var_of_entities_sharing_a_sprite_asset` |
| merge de prefab profundo, sem `null` | a cópia de uma entidade de prefab re-herdava o `graph_ref` e rodaria a lógica manual do original | cópia sobrescreve `logic` explicitamente (`graph_ref: ""`); teste no Inspector |
| duplicação copiava `graph_ref` | salvar escreveria duas entidades no mesmo arquivo de grafo | idem |
| trocar de entidade antes de 600 ms | edição da entidade anterior descartada | commit pendente gravado antes de hidratar; teste |
| refazer até o estado persistido | commit obsoleto de estado intermediário sobrevivia e podia ser gravado pelo Salvar | pendente limpo; commit recusa grafo que não é o atual; teste |
| ids de instância por grafo | passagens em entidades diferentes compartilhariam a variável de abertura | ids únicos na cena; teste (controle negativo) |
| grupo recolhido acima dos cartões e fora do layout | podia encobrir controles de outro nó | ver acima; testes de layout e de componente |

## Prova desktop (nova)

`npm run test:e2e:desktop:behaviors-independence`, teclado/mouse nativos (WebDriver), SGDK e core oficiais; RAM só observada.
Binário `src-tauri/target-test/debug/retro-dev-studio` SHA-256 `ccd0dab9e0317138c5f20c7762d3371c50c5cedd11dbf7686952b2596a85aac4`, construído do commit `9fb0c89` (commits seguintes só alteram o script E2E). Relatório `behaviors-independence-2026-09-24T14-36-40-628Z-report.json` (SHA `732e20c9…`, cópia em `data/behaviors/evidence/`), ROM jogada SHA `32525aab5935887de35b73c625d8b37e5239f1f439b6fb81d9e72300605281e5`. 6/6 etapas:

| Etapa | Resultado |
| --- | --- |
| Duplicar o jogador 2× | aviso antes ("lógica manual (34 nós) não copiada"); cópias sem `graph_ref` |
| Aplicar | Player 2: velocidade 1, ←/→, salto B (X) força 64, som `jump`. Player 3: velocidade 2, C, salto Start (Enter) força 40; Passagem "Goal Marker" até `reference_score >= 20` |
| Inválido | velocidade 0 recusada ("entre 1 e 8"), Aplicar desabilitado |
| Editar/desfazer | Player 3 → 3 px; Ctrl+Z real volta a 2, Ctrl+Y a 3; Player 2 inalterado |
| Duplicar com comportamento | Player 2 → Player 2 2 sem aviso; instância nova `bh_move_player_2_2_1`, `sprite_move` alvo `player_2_2` no arquivo salvo; remover a instância da cópia preserva a de Player 2 |
| Reiniciar/reabrir | instâncias, parâmetros (1 px; 3 px; limiar 20) e a remoção persistem |
| Jogar (teclado) | → move só Player 2 (+28 px; Player 3 e a cópia 0); C move só Player 3 (+81 px, passos múltiplos de 3 → exclui a velocidade antiga 2); X salta só Player 2 (15 px); Enter salta só Player 3 (5 px); passagem de Player 3 fechada abaixo de 20 e aberta exatamente no score 20 |

Controles negativos: outra entidade parada em cada tecla (estado/alvo compartilhado), cópia sem comportamento parada (remapeamento/remoção), variável privada distinta por instância (unitário), `graph_ref` não herdado (arquivo).

Observação honesta: duas execuções anteriores falharam por espera insuficiente do script (hierarquia/visão de lógica carregando); corrigido no script, não no produto. Uma execução anterior passou sem exercitar a abertura da passagem (score 12 < 20); a asserção passou a ser incondicional.

## Revalidação da etapa anterior no mesmo binário

`nodegraph-authoring` passou 13/13 no binário `ccd0dab9…` (relatório `nodegraph-authoring-2026-09-24T14-39-10-347Z-report.json`, SHA `c4fba34f…`): organizar 45 nós em 12 ms, sobreposições 93 → 0, alinhamento ≤ 0,22 px em 1920×1080, 1366×768, 125% e zoom; Z não pula e X pula (y 176 → 161); limiares 12/60; grafo de 106 nós em 20 ms. Com a linha `origem:` presente, as medições desktop após organizar e após reabrir deram 0 sobreposição. **Ainda não medido**: posições salvas antes da linha existir. A prova 13/13 anterior continua atribuída ao binário `bcd94007…`; esta é uma nova execução.

## Gates

check:tree, lint, tsc, Vitest 687/6 skipped, clippy, cargo test --lib 630/47 ignored.

## Limitações e pendentes

- Salto sem checagem de chão (igual ao template): saltos repetidos no ar.
- A passagem foi comprovada pela variável de abertura; o bloqueio físico da entidade não foi exercitado (Player 3 não alcança o bloqueio nesta fase).
- Biblioteca com 2 comportamentos; coleta, porta e vitória pendentes. Sequência de animação com ordem/duração na ROM pendente.
- Sem animação de "andar" automática; sem nó "ao soltar".
- Usabilidade humana não validada (roteiro abaixo).
- Causa da janela WebDriver 948×314 continua não estabelecida (não reapareceu nestas execuções).

## Roteiro curto de validação humana (não bloqueia as etapas técnicas)

Projeto novo pelo modelo "Fase de referência", modo Guiado. Para cada tarefa, anote: tempo, onde hesitou, o que precisou perguntar, se concluiu sem ajuda.

1. **Localizar o salto**: em "3. Regras", encontre a regra do pulo e mostre o nó correspondente no grafo. Diga qual botão do Mega Drive e qual tecla fazem pular.
2. **Trocar o botão**: faça o pulo usar o Botão B. Confirme na regra e no cartão que a tecla agora é X. (Opcional: em "5. Testar", verifique que Z não pula e X pula.)
3. **Modificar uma passagem**: mude para 12 os pontos necessários para abrir a passagem principal, sem mexer em nenhuma outra. Salve.

Perguntas finais: o que estava escrito de forma confusa? Algum controle ficou escondido ou difícil de clicar? Organizar tudo ajudou ou atrapalhou?
