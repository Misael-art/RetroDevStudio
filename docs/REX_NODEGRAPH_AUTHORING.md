# NodeGraph organizado e editável (Experimental)

Branch `codex/nodegraph-organize-authoring` (empilhada sobre `codex/reference-platformer-fox-art`). Sem merge.

## O que foi entregue (funcional pela interface)

- **Organizar visualmente** (`nodeLayout.ts`): layout em camadas a partir das conexões reais e das dimensões medidas dos cartões; ciclos, ramos Sim/Não e nós soltos tratados. Só `x/y` mudam — ordem, ids, parâmetros, portas, conexões e grupos são preservados, com guarda de assinatura semântica. "Organizar tudo" e "Organizar seleção"; nós **fixados** e fora do escopo nunca se movem; conflitos são informados. Nunca roda a cada render. "Criar conexões pela posição" fica separada e rotulada como ação que altera a lógica.
- **Desfazer/refazer** do grafo (botões e Ctrl+Z/Ctrl+Y reais), arrasto e digitação coalescidos; persistido pelo salvamento normal.
- **Linguagem visual unificada** (`nodeCatalog.ts`): categoria, nome, ícone (Icon.tsx do projeto), descrição; cartão com ação em português, entidade afetada com miniatura do quadro real do sprite, portas por tipo (execução, dados, Sim, Não), parâmetros essenciais editáveis e detalhes técnicos expansíveis. Botão do Mega Drive e tecla exibidos separadamente, derivados do mapa usado pela Game View; pressionar/manter/soltar explicados ("soltar" ainda não tem nó — dito explicitamente).
- **Conexão assistida**: ímã para a entrada compatível mais próxima com destaque; só conecta ao soltar; Esc cancela; ligações incompatíveis são recusadas com mensagem.
- **Grupos nomeáveis** por comportamento (nome sugerido, renomear, recolher, arrastar) e **navegação por entidade**.
- **Quando → Se → Fazer** edita no próprio nó os casos suportados (botão, limiar, velocidade, deslocamento, som) e mostra o caminho "Senão"; laços, bifurcações múltiplas, condições dentro do "senão" e nós sem forma simples continuam marcados como avançados e editáveis só no grafo.

Defeitos corrigidos no caminho: `BUTTON_START` compilava como `BUTTON_A`; cada salvamento automático reidratava o grafo e apagava o histórico/vista/seleção; Backspace dentro de um campo apagava o nó; o cartão selecionado ficava encoberto por cartões sobrepostos; âncoras das portas dependiam da escala da página.

## Prova integrada pelo desktop (nova)

`npm run test:e2e:desktop:nodegraph-authoring` — input nativo WebDriver, SGDK e core oficiais; RAM/imagem/áudio só observados.
Binário `src-tauri/target-test/debug/retro-dev-studio` SHA-256 `bcd940073fdc6cfbae0fdfda7b5c87e2a8a2ed6dfa978450dc447b7b12e50ecf`, construído do commit `bb0b2d0` (commits posteriores alteram só o script E2E). Relatório `nodegraph-authoring-2026-09-24T09-49-49-375Z-report.json` (cópia versionada em `data/nodegraph_authoring/evidence/`, SHA `83c1e5bd…`). ROM jogada SHA `8648def5450496267f4e3d2911b8011ba967dbde81f37210d272a98b959bfa05`. 13/13 etapas:

| Etapa | Resultado |
| --- | --- |
| Localizar/compreender o pulo | pela regra: "Ao apertar Botao A (tecla Z)", impulso vy −64, som `jump`, detalhes técnicos |
| Trocar o botão | cartão → Botão B (tecla X); regra e arquivo `BUTTON_B` |
| Limiar de uma passagem | principal 12 no cartão; segunda permanece 60 |
| Som no evento | pela regra, `goal_sound` → `victory` |
| Organizar / desfazer / refazer | 45 nós movidos em 23 ms (UI 327 ms); sobreposições 93 → 0; 0 conflitos; conexões 43 = 43; Ctrl+Z/Ctrl+Y reais restauram posições exatas sem afetar edições |
| Agrupar | "Pulo" sugerido, renomeado "Pulo (botao B)", recolhido |
| Tamanhos e escalas | 1920×1080, 1366×768, 125% e zoom 2,4×: controles visíveis e desobstruídos, 0 sobreposição, desvio fio↔porta ≤ 0,08 px nas portas visíveis |
| Salvar / reiniciar / reabrir | botão, limiares, som, grupo recolhido e posições preservados; 31 nós não editados idênticos (única diferença: padrão `rate=frame` materializado em 5 eventos, não lido pelo compilador); religação de `move_right/left` feita pelo editor de passagens |
| Jogar com teclado | Z não pula (y 176 fixo); X pula (y mínimo 161); passagem principal fechada no score 6 e aberta no 12 (x=36); segunda abre no 60 (x=106), sem atravessar antes; vitória x=132; `victory` (1320 Hz) após a vitória |
| Grafo maior | 106 nós: organizar em 22 ms (UI 363 ms), 0 sobreposição |

Capturas comparáveis: `…-01-before-organize.png` (antes) e `…-03-after-organize.png` (depois), além de reaberto, vitória e grafo maior.

Provas **novas**: tudo acima. Provas **herdadas** e não reexecutadas nesta fatia: aceite de autoria guiada (`a6c02af`/`9901b5f`), reference-platformer, ADDQ, branch-compare, reinserção Sonic.

## CI e revalidação

O primeiro CI do PR #75 falhou em `reference_goal`: o cartão passou a esconder a origem autoral nos detalhes técnicos, e o cenário (corretamente) exige rastreabilidade visível. Corrigido exibindo `origem:` no cartão, sem afrouxar a asserção. A reexecução local do cenário ficou bloqueada antes de qualquer passo (janela WebDriver presa em 948×314). O host estava sob pressão de recursos (~1 GiB livre, 9,1 GiB de swap), mas a causa do problema do WebDriver **não foi estabelecida**. O CI do HEAD `068ace1` passou (validate 2/2, linux-validate 2/2, desktop-smoke 2/2). A prova `nodegraph-authoring` 13/13 pertence ao binário `bcd94007…` (commit `bb0b2d0`), anterior à correção `59d4e71`; o CI verde **não** é uma repetição integral dessa prova.

## Revisão da etapa (sem mudanças de código)

- Preservação da lógica: organizar/arrastar/recolher alteram só `x/y`/`pinned`/`groups`; `organizeGraph` aborta se a assinatura semântica mudar; testes unitários cobrem grafo real, seleção, fixados, ciclos e grafo de 281 nós.
- Histórico: toda alteração passa por `setGraph`; o eco do salvamento é comparado na forma canônica; mudanças externas viram passo desfazível. Ctrl+Z/Ctrl+Y só agem no grafo enquanto o editor está montado.
- Conexões: `checkConnection` recusa tipos diferentes, duplicatas, auto-ligação e segunda fonte numa entrada de dado; o ímã só oferece portas aprovadas por ela.
- Grupos: apagar nós limpa os grupos; o deserializador descarta ids inexistentes.
- Linha `origem:`: o layout usa a altura medida no DOM. Medição desktop no binário `ccd0dab9…` (ver `docs/REX_BEHAVIORS.md`): 0 sobreposição após organizar e após reabrir, em todos os tamanhos. Posições salvas **antes** da linha existir continuam só analisadas (~13 px < espaçamento de 28 px), não medidas.
- Lacuna encontrada: a caixa de um grupo **recolhido** não entrava na verificação de sobreposição. **Corrigida** em `codex/reusable-behaviors` (ver `docs/REX_BEHAVIORS.md`).

## Limitações

- Usabilidade humana **não** validada: tudo acima é automação.
- Sem garantia de zero cruzamentos; ordenação por baricentro apenas reduz (0 cruzamentos no grafo de referência pela métrica de segmentos).
- Grupo recolhido aparece no canto dos seus nós; não há reorganização automática ao recolher.
- Não há nó "ao soltar"; reordenar quadros de animação segue não suportado.
- Sob escala de página (CSS zoom) o verificador de alinhamento compara apenas portas visíveis; a emulação sob WebDriver é lenta (3–7 FPS), por isso a janela de observação do pulo é 2,5 s.

## Próximos trabalhos

Validação com usuários iniciantes; nó "ao soltar" com suporte no emissor; roteamento de fios evitando cartões; testes de regressão desktop para ADDQ/branch-compare nesta branch.
