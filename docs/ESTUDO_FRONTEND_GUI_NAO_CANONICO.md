# Estudo Da GUI/Frontend - Nao Canonico

> Documento de estudo interno.
> Nao substitui a documentacao canonica do projeto.
> Nao altera a hierarquia de verdade definida em `docs/06_AI_MEMORY_BANK.md`.
> Objetivo: explicar pedagogicamente a GUI/frontend atual do MVP, com foco em telas, botoes, fluxos, comportamento e execucao.

## Escopo Deste Estudo

Este material foi montado por leitura do frontend real e dos estados principais que o movem, especialmente:

- `src/App.tsx`
- `src/core/store/editorStore.ts`
- `src/components/viewport/ViewportPanel.tsx`
- `src/components/hierarchy/HierarchyPanel.tsx`
- `src/components/hierarchy/LayerPanel.tsx`
- `src/components/inspector/InspectorPanel.tsx`
- `src/components/tools/ToolsPanel.tsx`
- `src/components/nodegraph/NodeGraphEditor.tsx`
- `src/components/retrofx/RetroFXDesigner.tsx`
- `src/components/artstudio/ArtStudioPanel.tsx`
- `src/components/common/Console.tsx`

## Leitura Rapida: O Que A GUI E

O app nao e organizado como um site com varias rotas. Ele funciona mais como um shell/editor desktop unico, com:

- uma casca principal (`App.tsx`)
- barras globais de comando
- um rail lateral de workspaces
- um viewport central que muda de modo
- paines laterais que trocam de papel
- um console inferior
- alguns modais globais

Em outras palavras:

```text
O usuario nao "navega por paginas web".
O usuario "muda o estado do editor".
```

## 1. Mapa Global Do Shell

### 1.1 Estrutura Macro

```text
+--------------------------------------------------------------------------------------------------+
| HEADER 1                                                                                         |
| [Novo] [Abrir] [Salvar] [Build & Run] [Play] [Stop]                                              |
+--------------------------------------------------------------------------------------------------+
| HEADER 2 / STATUS                                                                                |
| [Projeto] [MD|SNES] [estado live] [budgets HW] [Artist|Logic|Debug|Playtest]                    |
| [Salvar layout] [Restaurar layout] [Focus] [Tools|Inspector] [Validar] [Gerar C] [Copiar]      |
| [Colar] [Console] [Atalhos] [Sobre] [Fechar]                                                     |
+--------------------------------------------------------------------------------------------------+
| OPTIONAL: Workspace Guide Card                                                                   |
+-----+-----------------------------+----------------------------------+---------------------------+
| RAIL| LEFT PANEL                  | CENTER VIEWPORT                  | RIGHT PANEL               |
|     | Hierarchy or Layers         | Scene / Game / Logic / FX / Art | Inspector or Tools        |
|     |                             |                                  |                           |
|     | Scene                       |                                  |                           |
|     | Game                        |                                  |                           |
|     | Logic                       |                                  |                           |
|     | FX                          |                                  |                           |
|     | Art                         |                                  |                           |
|     | Debug                       |                                  |                           |
|     | --------------------------  |                                  |                           |
|     | Inspector                   |                                  |                           |
|     | Tools                       |                                  |                           |
|     | Console                     |                                  |                           |
|     | Focus                       |                                  |                           |
+-----+-----------------------------+----------------------------------+---------------------------+
| BOTTOM CONSOLE (colapsavel)                                                                     |
+--------------------------------------------------------------------------------------------------+
```

### 1.2 Principio De Navegacao

O shell responde principalmente a estes eixos:

| Eixo | Estado principal | Efeito visual |
|---|---|---|
| Workspace ativo | `scene`, `game`, `logic`, `retrofx`, `artstudio`, `debug` | muda a intencao do editor |
| Painel esquerdo | `scene` ou `layers` | troca Hierarchy por Layer Panel |
| Painel direito | `inspector` ou `tools` | troca Inspector por Tools |
| Focus mode | ligado/desligado | esconde partes do shell para concentrar |
| Console | aberto/fechado | mostra ou recolhe logs |
| Projeto alvo | `md` ou `snes` | muda restricoes, toolchain e leitura de budgets |
| Tab central | `scene`, `game`, `logic`, `retrofx`, `artstudio` | muda a tela central real |

### 1.3 Workspaces E Intencao De Uso

| Workspace | Funcao mental | Tela central esperada | Lado esquerdo comum | Lado direito comum |
|---|---|---|---|---|
| `scene` | montar cena e posicionar entidades | viewport de cena | Hierarchy/Layers | Inspector/Tools |
| `game` | rodar ROM e operar emulador | canvas do jogo | permanece shell padrao | Tools/Inspector |
| `logic` | editar grafo de logica | Node Graph | Hierarchy | Inspector/Tools |
| `retrofx` | montar efeitos retro | RetroFX Designer | Hierarchy | Inspector/Tools |
| `artstudio` | ingestao de sprite sheet e animacao | Art Studio | Hierarchy | Inspector/Tools |
| `debug` | investigacao tecnica | normalmente Tools em Profiler | Hierarchy | Tools priorizado |

Observacao importante:

- o `ViewportPanel` tem tabs internas, mas no shell principal elas ficam ocultas (`showWorkspaceTabs={false}`)
- quem realmente manda na troca de tela e o shell externo em `App.tsx`

## 2. Barras Globais E Controles De Shell

## 2.1 Barra Superior Primaria

```text
[Novo] [Abrir] [Salvar] [Build & Run] [Play] [Stop]
```

| Botao | O que o usuario entende | O que executa |
|---|---|---|
| `Novo` | abre o fluxo de criar projeto | exibe o wizard de primeiro uso/novo projeto |
| `Abrir` | escolhe um projeto existente | abre dialog, hidrata estado do projeto e cena |
| `Salvar` | persiste a cena atual | grava a cena ativa em disco |
| `Build & Run` | executa fluxo canonico | persiste cena, checa deps, valida status HW, builda projeto, encontra ROM e carrega no emulador |
| `Play` | ir para o jogo / retomar | se nao houver ROM, tenta carregar; se houver, muda para `game` e retoma se pausado |
| `Stop` | parar a execucao emulada | interrompe a sessao do emulador |

### 2.1.1 Fluxo Real Do `Build & Run`

```text
Salvar snapshot da cena
    ->
revalidar/consultar estado live
    ->
garantir dependencias oficiais / status de build
    ->
executar build do projeto ativo
    ->
obter ROM gerada
    ->
carregar ROM no emulador
    ->
alternar viewport para Game
```

Esse e o caminho mais importante do MVP porque ele fecha o fluxo:

```text
Build -> ROM -> Emulacao
```

## 2.2 Barra Superior Secundaria

Essa barra mistura contexto de projeto, estado live, atalhos de layout e acoes tecnicas.

### 2.2.1 Mapa Visual

```text
[Projeto ativo]
[MD] [SNES]
[badges live/dirty/hw]
[VRAM] [Scanline] [Palette]
[Artist] [Logic] [Debug] [Playtest]
[Salvar layout] [Restaurar layout]
[Focus/Sair do foco]
[Tools/Inspector]
[Validar] [Gerar C]
[Copiar] [Colar]
[Console]
[Atalhos]
[Sobre]
[Fechar]
```

### 2.2.2 Controles

| Controle | Papel |
|---|---|
| Projeto ativo | mostra o projeto em contexto |
| `MD` / `SNES` | troca o alvo ativo; ao trocar, o shell reseta a sessao do emulador para nao misturar contexto |
| badges de validacao | mostram se o snapshot live esta atualizado, stale, em erro etc. |
| budgets HW | resumem limites de VRAM, scanline e palette |
| presets `Artist`, `Logic`, `Debug`, `Playtest` | reconfiguram o arranjo visual do shell |
| `Salvar layout` | grava tamanhos/visibilidade dos paines no `localStorage` |
| `Restaurar layout` | recupera layout salvo ou preset |
| `Focus` / `Sair do foco` | entra/sai de modo concentrado |
| `Tools` / `Inspector` | troca o painel direito |
| `Validar` | persiste cena e executa validacao |
| `Gerar C` | persiste cena e executa codegen, com preview/log no console |
| `Copiar` | copia entidade selecionada |
| `Colar` | cola entidade copiada |
| `Console` | abre/fecha o console |
| `Atalhos` | abre modal de atalhos |
| `Sobre` | abre modal institucional |
| `Fechar` | fecha projeto atual |

## 2.3 Presets De Layout

Os presets nao criam feature nova. Eles reorganizam o shell conforme a tarefa:

| Preset | Leitura pedagogica |
|---|---|
| `Artist` | privilegia viewport e inspeccao de arte |
| `Logic` | privilegia grafo e inspeccao logica |
| `Debug` | privilegia ferramentas analiticas |
| `Playtest` | privilegia jogo/emulacao |

## 2.4 Focus Mode

Quando o foco entra:

- side panels podem ser reduzidos/ocultados
- console pode ser escondido
- a viewport ganha prioridade visual

Leitura mental:

```text
Focus mode = "menos chrome de editor, mais area util"
```

## 2.5 Workspace Guide Card

Em varios workspaces aparece um card de orientacao com acoes contextuais. Ele serve como ponte pedagogica para o usuario entrar na tarefa certa.

### 2.5.1 Acoes Por Workspace

| Workspace | Acoes sugeridas |
|---|---|
| `scene` | `Abrir Asset Browser`, `Abrir Inspector`, `Rodar no Emulador` |
| `game` | `Rodar no Emulador`, `Abrir Runtime Setup`, `Abrir Profiler` |
| `logic` | `Abrir Paleta Contextual`, `Validar Projeto`, `Abrir Inspector` |
| `retrofx` | `Abrir Inspector`, `Validar Projeto`, `Rodar no Emulador` |
| `artstudio` | `Abrir Asset Browser`, `Abrir Inspector`, `Rodar no Emulador` |
| `debug` | `Abrir Profiler`, `Abrir Memory Viewer`, `Abrir Runtime Setup` |

## 2.6 Rail Vertical Esquerdo

### 2.6.1 Estrutura

```text
Scene
Game
Logic
FX
Art
Debug
-----
Inspector
Tools
Console
Focus
```

### 2.6.2 Comportamento

| Botao | Comportamento |
|---|---|
| `Scene` | troca workspace para edicao de cena; viewport central vai para cena |
| `Game` | troca para viewport de jogo |
| `Logic` | abre o editor de grafo |
| `FX` | abre RetroFX |
| `Art` | abre Art Studio |
| `Debug` | entra no workspace de debug e tende a abrir Tools/Profiler |
| `Inspector` | prioriza painel direito em modo Inspector |
| `Tools` | prioriza painel direito em modo Tools |
| `Console` | mostra/esconde console |
| `Focus` | alterna focus mode |

## 2.7 Console Inferior

### 2.7.1 Mapa Visual

```text
[Console open/close] [contador]
----------------------------------------------
[hh:mm:ss] [INFO]  ...
[hh:mm:ss] [WARN]  ...
[hh:mm:ss] [ERROR] ...
[hh:mm:ss] [OK]    ...
----------------------------------------------
[x Limpar]
```

### 2.7.2 Regras

- console e colapsavel
- mostra quantidade de entradas
- `Limpar` apaga o buffer visivel
- erros tendem a autoabrir o console

Leitura pratica:

```text
Console = principal superficie de retorno operacional do shell
```

## 3. Modais Globais

## 3.1 Wizard De Primeiro Uso / Novo Projeto

O titulo muda conforme o contexto:

- `Wizard de Primeiro Uso` quando ainda nao existe projeto aberto
- `Novo Projeto` quando o usuario ja esta dentro do app com projeto ativo

### 3.1.1 Mapa Visual

```text
+----------------------------------------------------------------------------------+
| Titulo: Wizard de Primeiro Uso / Novo Projeto                                    |
|                                                                                  |
| [galeria de templates]                                                           |
|   - cards de template                                                            |
|   - badge Experimental quando aplicavel                                          |
|   - campo de donor path quando template externo SGDK exigir                      |
|                                                                                  |
| [importador externo / perfil]                                                    |
|                                                                                  |
| Target: [Mega Drive] [SNES]                                                      |
| Nome do projeto: [............................]                                  |
| Pasta base:      [............................] [Escolher]                        |
|                                                                                  |
| Footer: [Cancelar] [Abrir Existente] [Importar Externo] [Criar Projeto]          |
+----------------------------------------------------------------------------------+
```

### 3.1.2 Controles E Execucao

| Controle | Funcao |
|---|---|
| card de template | define o esqueleto inicial do projeto |
| donor path | necessario em templates externos/legacy que dependem de origem existente |
| seletor de target | define se o projeto nasce para Mega Drive ou SNES |
| nome do projeto | vira nome logico e pasta alvo |
| pasta base | local de criacao do projeto |
| `Abrir Existente` | troca o fluxo de criacao por abertura de projeto |
| `Importar Externo` | importa projeto legado segundo perfil selecionado |
| `Criar Projeto` | confirma criacao e hidrata o estado do editor |

### 3.1.3 Fluxos Principais

#### Criar projeto

```text
Selecionar template
    ->
definir target
    ->
preencher nome
    ->
escolher pasta base
    ->
confirmar
    ->
backend cria estrutura
    ->
frontend hidrata estado
```

#### Importar externo

```text
Selecionar perfil de importacao
    ->
selecionar origem externa
    ->
importar
    ->
hidratar projeto
    ->
ajustar shell para fluxo canonico
```

## 3.2 Modal De Atalhos

Lista observada:

| Atalho | Funcao |
|---|---|
| `Ctrl+C` | copiar entidade |
| `Ctrl+V` | colar entidade |
| `Ctrl+Z` | undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | redo |
| `Delete` | remover no selecionado no NodeGraph |
| `Z`, `X`, `C`, `Enter`, setas | controles do emulador |
| `R` | rewind quando o emulador esta pausado |

## 3.3 Modal Sobre

E uma tela simples de informacao institucional do app, com botao:

- `Fechar`

## 4. Tela/Painel: Hierarchy

## 4.1 Papel

A `HierarchyPanel` e o indice estrutural da cena.

Ela responde a duas perguntas:

```text
1. Quais objetos existem?
2. O que esta selecionado agora?
```

## 4.2 Mapa Visual

```text
Hierarchy
[+] [-]

Cena: [select de cenas] [Nova Cena]
path atual da cena

[Buscar...][x]

Background layers
  - layer::...

Camaras
Sprites
Cenarios
Audio
Outros

Empty state:
[Sprite Inicial] [Nova Entidade]
```

## 4.3 Botoes E Acao

| Controle | Comportamento |
|---|---|
| `+` | cria entidade |
| `-` | remove entidade selecionada |
| seletor de cena | troca a cena carregada |
| `Nova Cena` | cria nova cena via prompt |
| `Buscar...` | filtra itens da arvore |
| `x` do filtro | limpa busca |
| `Sprite Inicial` | cria sprite inicial usando o primeiro asset de imagem disponivel do projeto |
| `Nova Entidade` | abre modal de criacao |

## 4.4 Modal `Nova Entidade`

```text
Nome: [................]
[Cancelar] [Criar]
```

## 4.5 Regras De Agrupamento

Entidades aparecem agrupadas por tipo:

- `Cameras`
- `Sprites`
- `Cenarios`
- `Audio`
- `Outros`

As background layers tambem aparecem.

## 4.6 Efeito Da Selecao

Ao selecionar um item:

- o `Inspector` troca de contexto
- a viewport pode destacar o objeto
- certas ferramentas passam a agir sobre esse alvo

## 5. Tela/Painel: Layers

## 5.1 Papel

O `LayerPanel` deixa explicito o conceito de camada, visibilidade, lock e ordem.

## 5.2 Mapa Visual

```text
Camadas
[+ Camada]

se formulario aberto:
  Nome: [........]
  Tipo: [Sprite|Tile|Fundo|Objeto]
  [Criar] [Cancelar]

Lista de camadas
  [up] [down] [visivel] [lock] nome [x]

Rodape condicional
  [Remover da camada]
  ou
  [Atribuir a camada ativa]
```

## 5.3 Controles

| Controle | Funcao |
|---|---|
| `+ Camada` | abre form de criacao |
| `Tipo` | define comportamento da layer |
| `up` / `down` | muda ordem |
| `visivel` | liga/desliga visibilidade |
| `lock` | trava/destrava edicao |
| duplo clique no nome | renomeia |
| `x` | remove camada |

## 5.4 Efeito Da Layer Sobre O Modo De Edicao

Quando uma layer e selecionada:

- layer `collision` tende a colocar o editor em modo `collision`
- layer `sprite` ou `tile` tende a colocar o editor em modo `paint`

Isso e importante porque a UI nao e so visual; ela muda o comportamento da viewport.

## 6. Workspace Scene

## 6.1 Mapa Da Tela

```text
+--------------------------+-------------------------------------------+------------------------+
| Hierarchy / Layers       | Scene Viewport                            | Inspector / Tools      |
|                          |                                           |                        |
| cenas, entidades, layers | toolbar de edicao + canvas + status bar   | propriedades, limites  |
+--------------------------+-------------------------------------------+------------------------+
| Console                                                                                           |
+---------------------------------------------------------------------------------------------------+
```

## 6.2 Toolbar Da Scene View

### 6.2.1 Mapa Visual

```text
[Selecionar] [Pintar] [Apagar] [Colisao]
[G snap]
[Grid] [Sub] [Guide] [BG] [TM] [SP] [Col] [GV]
[ - ] [100%] [ + ]
```

### 6.2.2 Leitura Dos Controles

| Controle | Significado |
|---|---|
| `Selecionar (V)` | modo de selecao e transformacao |
| `Pintar (B)` | modo de pintar/instanciar usando brush ativo |
| `Apagar (E)` | apaga entidades/instancias conforme hit |
| `Colisao (C)` | edita mapa de colisao |
| `G` | liga/desliga snap |
| `Grid` | mostra/esconde grid principal |
| `Sub` | mostra/esconde subgrid |
| `Guide` | mostra/esconde guias |
| `BG` | mostra/esconde backgrounds |
| `TM` | mostra/esconde tilemaps |
| `SP` | mostra/esconde sprites |
| `Col` | mostra/esconde overlay de colisao |
| `GV` | `Game View Light`, simplifica chrome/rulers |
| `-` / `%` / `+` | zoom out / reset / zoom in |

## 6.3 Canvas De Cena

## 6.3.1 Comportamentos Principais

| Modo | Comportamento |
|---|---|
| `select` | clique seleciona; arraste move; sprites podem exibir handles de resize |
| `paint` | usa brush ativo; arraste pinta/instancia; respeita limite de sprites e layer ativa |
| `erase` | arraste apaga |
| `collision` | clique esquerdo pinta solido; clique direito limpa; arraste e suportado |

## 6.3.2 Interacoes De Camera/Viewport

| Gesto | Resultado |
|---|---|
| botao do meio + arraste | pan |
| `Space` + arraste | pan |
| `Ctrl + wheel` | zoom |
| `Ctrl + -` | zoom out |
| `Ctrl + =` | zoom in |
| `Ctrl + 0` | reset zoom |

## 6.3.3 Guias E Reguas

- reguas aparecem no topo e na esquerda, exceto quando `Game View Light` simplifica a tela
- guias podem ser criadas a partir das reguas
- guias podem ser arrastadas
- duplo clique pode remover guia
- guias sao persistidas localmente por cena em `localStorage`

## 6.3.4 Empty State

Quando a cena esta vazia, a viewport ensina o caminho:

```text
Hierarchy > Sprite Inicial
ou
Tools > Asset Browser > Instanciar
```

## 6.3.5 Status Bar Inferior Da Scene

Ela resume:

- target atual
- resolucao/fps alvo
- quantidade de sprites
- quantidade de background layers
- entidade selecionada
- dicas do modo corrente

Leitura mental:

```text
barra de baixo = "telemetria de edicao"
```

## 6.4 Inspector No Workspace Scene

## 6.4.1 Papel

O `InspectorPanel` e o editor de propriedades da selecao atual.

Se nada estiver selecionado:

```text
Selecione uma entidade na Hierarchy.
```

## 6.4.2 Cabecalho De Entidade

Pode mostrar:

- badge de tipo: `CAM`, `TM`, `SP`, `OBJ`
- nome exibido
- `id`
- prefab
- quantidade de componentes
- coordenadas

## 6.4.3 Secoes Possiveis

| Secao | O que edita |
|---|---|
| `Transform` | posicao, tamanho, orientacao base |
| `Sprite` | asset, frame width, frame height, palette slot, priority |
| `Collision` | colisao/logica de solido |
| `Physics` | propriedades fisicas |
| `Audio` | sons vinculados |
| `Input` | mapeamentos de input |
| `Camera` | config de camera |
| `Tilemap` | dados de tilemap |
| `Logic` | link com grafo de logica e parametros |

Cada secao tem `?` com tooltip baseado em `knowledgeBase.json`.

## 6.4.4 Edicao Inline

O `PropRow` permite:

- clicar e editar inline
- enxergar badge `Override` ou `Herdado` quando houver relacao com prefab

## 6.4.5 Destaques Por Secao

### Sprite

- preview do asset
- campos `Asset`, `Frame W`, `Frame H`, `Palette Slot`, `Priority`
- bloco `Preparacao para Build`
- botao `Normalizar Sprite para Mega Drive/SNES`

### Audio

- `RecordListEditor`
- rotulo `Audio SFX`
- adiciona/remove pares chave/valor

### Input

- `RecordListEditor`
- rotulo `Input Mapping`

### Tilemap

- bloco `Ferramentas Avancadas (Experimental)`
- botao desabilitado `Extrair Tilemap/Tileset`

### Logic

- resumo do grafo
- botao `Edit` para trocar a viewport central para `logic`
- `Graph Ref`
- `Imported Hints`
- parametros por no/variavel

## 6.4.6 Save

No fim do inspector existe:

- `Salvar Cena`
- estado `Salvando...`
- estado `Falha ao salvar`

## 6.4.7 Inspector De Background Layer

Se a selecao e uma layer de background, o inspector muda:

- secao `Background Layer`
- campos `ID`, `Depth`, `Tileset`
- mesmo botao de salvar

## 6.4.8 Hardware Limits Panel

Sempre aparece no rodape do inspector.

### Mostra:

- VRAM
- sprites por tela
- sprites por scanline
- DMA por frame
- palette banks
- BG layers

### Estados live:

- `ANALISANDO`
- `LIVE`
- `DESATUAL.`
- `ERRO`
- `IDLE`

### Severidade:

- `OVERFLOW`
- `WARN`
- `OK`

E tambem lista warnings/erros detectados.

## 7. Workspace Game

## 7.1 Mapa Da Tela

```text
+----------------------------------------------------------------------------------+
| hot reload notice (quando aplicavel)                                             |
|                                                                                  |
|                              GAME CANVAS                                         |
|                    [overlay opcional FPS/Sprites/DMA]                            |
|                         [badge 320x224 @ escala]                                 |
|                                                                                  |
+----------------------------------------------------------------------------------+
| [Pausar] [Retomar] [Step 1 frame] [Salvar state] [Carregar state] [Rewind]      |
| [Record] [Stop] [Play Replay] [Mutar/Ativar audio]                              |
+----------------------------------------------------------------------------------+
| status | REC ativo | Replay pronto | Z=A | X=B | C=C | Enter=Start | Setas | R  |
+----------------------------------------------------------------------------------+
```

## 7.2 Controles

| Botao | O que faz |
|---|---|
| `Pausar` | pausa a emulacao |
| `Retomar` | retoma a execucao |
| `Step 1 frame` | avanca um frame com o emulador pausado |
| `Salvar state` | salva estado do emulador |
| `Carregar state` | carrega estado salvo |
| `Rewind` | recua snapshots automaticos; atalho associado `R` |
| `Record` | inicia gravacao de replay |
| `Stop` | encerra gravacao de replay |
| `Play Replay` | reproduz ultimo replay salvo |
| `Mutar audio` / `Ativar audio` | alterna audio |

## 7.3 Overlay De Performance

Quando ligado, mostra:

- FPS
- quantidade de sprites
- estimativa de DMA em KB e percentual do budget

## 7.4 Status Textual

Pode mostrar:

- status corrente do jogo/emulador
- `REC ativo`
- `Replay pronto`
- legenda de controles

## 7.5 Escala

O canvas do jogo respeita escala inteira para preservar pixel art.

## 8. Workspace Logic

## 8.1 Papel

O `NodeGraphEditor` transforma logica por script/estado em um grafo visual editavel.

## 8.2 Mapa Visual

```text
+------------------------------+------------------------------------------------------+
| Palette de Nos               | Canvas / Graph                                       |
| [Buscar no...]               |                                                      |
| Eventos                      | [Logic Context]                                      |
| Movimento                    | [Minimap]                                            |
| Condicoes                    |                                                      |
| Som                          |  nos conectados por cabos                            |
| Variaveis                    |                                                      |
| Fluxo                        |                                                      |
| Estados                      |                                                      |
| Efeitos                      |                                                      |
+------------------------------+------------------------------------------------------+
```

## 8.3 Categorias De Nos

Categorias observadas:

- `Eventos`
- `Movimento`
- `Condicoes`
- `Som`
- `Variaveis`
- `Fluxo`
- `Estados`
- `Efeitos`

Exemplos de tipos:

- `event_start`
- `sprite_move`
- `sprite_anim`
- `condition_overlap`
- `effect_parallax`
- `effect_raster`
- `logic_and`
- `action_sound`
- `scroll_tilemap`
- `move_camera`

E tambem tipos avancados:

- variaveis
- math
- compare
- FSM
- flow
- timeline
- eventos de `vblank`, `hblank`, `dma`

## 8.4 Regras De Uso

| Acao | Resultado |
|---|---|
| clicar em no da palette | cria no no canvas |
| arrastar no | move no |
| arrastar saida -> entrada | cria conexao |
| `Delete` / `Backspace` | remove no selecionado |
| autosave | ocorre apos ~600ms, escrevendo em `LogicComponent.graph` |

## 8.5 Empty State Guiado

Se nao houver entidade selecionada:

- aparece overlay pedindo selecao pela Hierarchy

Se houver contexto vazio:

- quick actions:
  - `Criar Player Controller Basico`
  - `Logica de Inimigo Simples`
  - `Timer Event`

## 8.6 Logic Context Card

Resume:

- nome/id da entidade
- quantidade de nos
- quantidade de conexoes
- quantidade de eventos
- quantidade de nos desconectados

Tambem oferece:

- `Ir para Inicio`
- `Centralizar Selecao`
- `Resetar Vista`

## 8.7 Minimap

- mostra pontos dos nos
- clique navega pela area do grafo
- a vista e local; nao persiste como layout do grafo

## 9. Workspace RetroFX

## 9.1 Estado Geral

O `RetroFXDesigner` esta explicitamente marcado como `Experimental`.

## 9.2 Mapa Visual

```text
Tabs: [Parallax] [Raster]

PARALLAX
+-------------------+----------------------+----------------------+
| lista de camadas  | preview grande       | propriedades         |
| reorder           | [Pause/Play]         | nome                 |
| visible           | [Reiniciar]          | visible              |
| remover           |                      | Speed X              |
| + Adicionar       |                      | Speed Y              |
+-------------------+----------------------+----------------------+

RASTER
+-------------------+----------------------+----------------------+
| lista de linhas   | preview raster       | parametros           |
| enabled           |                      | Scanline             |
| remover           |                      | Offset X             |
| + Add Scanline    |                      | [Salvar]             |
+-------------------+----------------------+----------------------+
```

## 9.3 Tab Parallax

### Controles

- lista de camadas
- reorder por drag
- selecao de camada
- `visible` checkbox
- `Remover`
- `+ Adicionar camada`
- preview grande
- `Pause/Play`
- `Reiniciar`
- propriedades da camada selecionada:
  - nome
  - visibilidade
  - `Speed X`
  - `Speed Y`
- `Salvar`

## 9.4 Tab Raster

### Controles

- lista de linhas raster
- toggle enabled
- `Remover`
- `Scanline`
- `Offset X`
- `+ Add Scanline`
- preview raster
- `Salvar`

## 9.5 Observacao De Pipeline

O editor visual existe, mas a emissao final para build real ainda esta na zona `Experimental`.

## 10. Workspace Art Studio

## 10.1 Papel

O `ArtStudioPanel` e uma ferramenta de ingestao e preparo de sprites.

Ele resolve este problema:

```text
imagem crua
    ->
slicing
    ->
sequencias/animacoes
    ->
preview
    ->
asset canonico em assets/sprites
    ->
aplicar na cena
```

Mas o proprio painel deixa claro:

```text
integracao total com o pipeline ainda nao esta fechada
```

## 10.2 Mapa Visual

```text
+--------------------------------+-------------------------------+--------------------------------+
| 1. Source / Sprite Sheet       | 2. Sequences / Configuracao   | 3. Preview / Output / Apply    |
|                                |                               |                                |
| [Importar imagem]              | contadores                    | preview animado                |
| status / zoom / frame size     | lista de sequencias           | [Play] [Stop]                  |
| canvas de origem / drag-drop   | [Nova sequencia]              | aviso de asset nao canonico    |
| [ - ] [Ajustar] [ + ]          | renomear/remover              | erros de validacao             |
| diagnostico                    | FPS / Loop                    | output .res                    |
| metadados                      | compressao                    | [Trazer para assets/sprites]   |
| slicing                        | paleta alvo                   | [Aplicar...]                   |
+--------------------------------+-------------------------------+--------------------------------+
```

## 10.3 Bloco 1: `Source / Sprite Sheet`

### O que aparece

- badge `ArtStudio Experimental`
- CTA `Importar imagem`
- status: aguardando, carregando, pronta, erro
- zoom atual
- tamanho de frame atual
- canvas de origem
- drag and drop
- botoes `-`, `Ajustar`, `+`
- bloco `Diagnostico`
- bloco `Metadados`
- bloco `Slicing`

### Metadados exibidos

- arquivo
- formato
- resolucao
- frames
- origem (`Projeto`, `Externa`, `Nao carregada`)
- transparencia
- bounds
- saida sugerida
- slicing e numero de frames sugeridos
- perfil (`Meta-sprite` ou `Sprite simples`)
- fonte completa
- asset canonico gerado ou `Pendente de importacao canonica`

### Regras De Interacao

| Acao | Efeito |
|---|---|
| `Importar imagem` | abre dialog de arquivo suportando `png`, `bmp`, `jpg`, `jpeg`, `gif`, `webp`, `ppm` |
| drag-and-drop | tenta ingerir a imagem direto |
| clique no canvas | alterna o frame clicado na sequencia ativa |
| mudar `Frame W/H` | recalcula sugestoes de slicing usando backend |
| `Ajustar` | recalcula zoom inicial de enquadramento |

### Empty State Pedagogico

O painel explica:

1. importe uma imagem
2. ajuste o grid de slicing
3. monte sequencias, valide no preview e aplique

## 10.4 Bloco 2: `Sequences / Configuracao`

### O que aparece

- contadores `Sequencias` e `Frames usados`
- lista de sequencias
- `+ Nova sequencia`
- editor da sequencia ativa
- bloco `Preparacao para SGDK`
- `Compressao`
- `Paleta alvo`

### Controles Por Sequencia

| Controle | Efeito |
|---|---|
| clique no card | ativa sequencia |
| input do nome | renomeia |
| `Remover` | exclui sequencia |
| `FPS` | define velocidade |
| `Loop automatico` | alterna loop |
| clique em frame no canvas | inclui/remove frame da sequencia ativa |

### Preparacao Para SGDK

- seletor de compressao
- exibicao visual da paleta alvo
- fallback para paleta Mega Drive quando necessario

## 10.5 Bloco 3: `Preview / Output / Apply`

### O que aparece

- preview da sequencia ativa
- `Play`
- `Stop`
- badge `Animando` / `Parado`
- aviso quando a imagem ainda nao virou asset canonico
- bloco de erro de validacao
- `Output (.res)`
- `Trazer para assets/sprites` ou `Regerar asset canonico`
- `Aplicar e criar entidade na cena` ou `Atualizar entidade selecionada`

### Gate De Aplicacao

O botao de aplicar so fica realmente util quando:

- existe projeto aberto
- existe cena aberta
- existe imagem carregada
- existe asset canonico gerado
- existem frames sugeridos
- estado de carga esta `loaded`

### Validacoes Antes De Aplicar

O frontend barra a aplicacao se faltar:

- projeto/cena
- imagem
- asset canonico em `assets/sprites`
- sequencia
- frames validos

### Diferenca Entre Os Dois Botoes Finais

#### `Trazer para assets/sprites`

Fluxo:

```text
fonte crua
    ->
importArtAsset(...)
    ->
gera asset canonico no projeto
    ->
atualiza spritePath/spriteName/frame size
```

#### `Aplicar ...`

Fluxo:

```text
validar pre-condicoes
    ->
montar animations a partir das sequencias
    ->
constrain frame size para target
    ->
se ja existe entidade sprite selecionada:
       atualizar entidade
    senao:
       criar nova entidade sprite
    ->
mostrar feedback de sucesso
```

## 11. Workspace Tools / Debug Workspace

## 11.1 Papel

O `ToolsPanel` e a bancada de ferramentas operacionais do editor.

No workspace `debug`, ele ganha protagonismo.

## 11.2 Mapa Visual

```text
+----------------------+----------------------------------------------------------+
| categorias           | ferramenta ativa                                         |
|                      |                                                          |
| Create               | cabecalho: categoria, nome, descricao, badges            |
| Configure            |                                                          |
| Analyze              | superficie principal da ferramenta                        |
| Experimental         |                                                          |
|                      |                                                          |
| [Avancado ON/OFF]    |                                                          |
| [Inspector]          |                                                          |
+----------------------+----------------------------------------------------------+
```

## 11.3 Categorias

- `Create`
- `Configure`
- `Analyze`
- `Experimental`

## 11.4 Ferramentas Mapeadas

| Ferramenta | Categoria | Leitura |
|---|---|---|
| `Paleta Contextual` | Create | cria/instancia/edita rapidamente a partir do contexto |
| `Runtime Setup` | Configure | instala e verifica dependencias oficiais |
| `Patch Studio` | Configure | gera patch IPS/BPS |
| `Deep Profiler` | Analyze | analise heuristica de ROM/performance |
| `Asset Browser` | Experimental | navega assets canonicos e overlay legacy |
| `Asset Extractor` | Experimental | extrai assets de ROM |
| `Memory Viewer` | Experimental | le memoria em hex/ascii |
| `VRAM Viewer` | Experimental | le e visualiza VRAM |
| `Reverse Workspace` | Experimental | bancada de engenharia reversa |

## 11.5 `Paleta Contextual`

### Funcao

Serve para colocar o usuario rapidamente em modo produtivo no viewport de cena.

### Estrutura

- categorias: `Sprites`, `Tilemaps`, `Audio`, `Prefabs`, `Outros`
- expansao/colapso por categoria
- itens clicaveis
- botao de colisao
- footer com modo atual e `Limpar brush`

### Comportamento

| Acao | Efeito |
|---|---|
| clicar sprite/prefab | define brush ativo |
| ao definir brush | editor tende a entrar em modo `paint` |
| `Modo colisao` | entra em modo de colisao |
| `Sair do modo colisao` | sai desse modo |

Hint exibido:

```text
Esq: solido | Dir: livre | Esc: sair
```

## 11.6 `Runtime Setup`

### Funcao

Faz a ponte entre GUI e dependencias oficiais do pipeline.

### O que mostra

- dependencias como JDK, SGDK, PVSnesLib, cores Libretro etc.
- estado `INSTALADO` / `PENDENTE`
- versao
- pasta
- notas
- issues
- link `Fonte oficial`
- botao `Instalar` / `Reinstalar`
- `Atualizar`

### Extra

- secao `Multi-Target Build`
- botao `Build All Targets`
- relatarios por target com ROM path, warnings, erros e logs

Se for projeto externo SGDK:

- aparece `LegacySgdkProjectCard`
- com `Ver indice` / `Ocultar indice`

## 11.7 `Patch Studio`

### Mapa

```text
[Criar Patch] [Aplicar Patch Desabilitado]
formato: [ips|bps]
[ ] aviso legal aceito
ROM Original:    [........]
ROM Modificada:  [........]
Salvar Patch em: [........]
[Criar Patch IPS/BPS]
```

### Leitura

- ferramenta alinhada com a regra BYOR/patch
- o frontend ajuda a montar o patch sem distribuir ROM comercial

## 11.8 `Deep Profiler`

### O que oferece

- aviso de heuristica
- campo de ROM
- `Analisar`
- cards de metricas
- heatbars de DMA/sprites
- lista de issues

## 11.9 `Asset Browser`

### Modos

- `tree`
- `grid`

### Em `tree`

- arvore canonica de assets
- se houver overlay legacy SGDK:
  - secoes readonly do host
- asset canonico selecionado:
  - preview
  - `Focar`
  - `Instanciar` se for imagem
- arquivo host legado:
  - preview readonly

### Em `grid`

Cards mostram:

- preview
- tipo
- contagem de referencias
- path
- `Focar` / `Detalhes`
- `Instanciar` em imagens

Double click:

- foca ou instancia

## 11.10 `Asset Extractor`

### Campos

- ROM
- output dir
- `Max. tiles`
- `Slot de paleta`
- `BPP mode`
- `Extrair Assets`

### Saida

- lista de arquivos gerados

## 11.11 `Memory Viewer`

### Campos

- regiao: `WRAM`, `VRAM`, `SRAM`
- offset hex
- length hex
- auto-refresh 1s
- `Ler`
- busca
- `Procurar Proximo`

### Visual

- totalizadores
- tabela `Address / Hex / ASCII`
- destaque da linha corrente

## 11.12 `VRAM Viewer`

### Campos

- offset hex
- length hex
- zoom `8x` / `16x`
- seletor de paleta
- auto-refresh 1s
- `Ler VRAM`

### Visual

- barra de stats total/tiles/offset
- canvas `tools-vram-canvas`

## 11.13 `Reverse Workspace`

### Funcao

E a superficie mais explicitamente orientada a preservacao/engenharia reversa.

### Campos Principais

- ROM path
- offset
- length
- `Analisar ROM`
- `Atualizar Hex/Code`

### Resumos

- target sugerido
- formato
- identidade
- hashes
- sinais
- trace status

### Tabs

- `ROM Map`
- `Hex`
- `Graphics`
- `Text`
- `Audio`
- `Code`
- `Projection`

### Na tab `Code`

- funcoes priorizadas
- xrefs
- call graph
- editor de anotacoes:
  - tipo `label/comment/region/pointer`
  - end hex
  - label
  - comment
  - `Salvar anotacao`

## 12. Fluxos Transversais Mais Importantes

## 12.1 Abrir Projeto

```text
botao Abrir
    ->
dialog do sistema
    ->
backend localiza projeto
    ->
store recebe activeProjectDir / activeScene / target / etc.
    ->
shell atualiza barras, viewport, hierarchy e tools
```

## 12.2 Salvar

```text
Salvar
    ->
persistencia da cena ativa
    ->
feedback por estado/log
```

## 12.3 Validar

```text
Validar
    ->
persistir cena
    ->
rodar validacao
    ->
atualizar hardware panel
    ->
logar erros/warnings
    ->
abrir console se necessario
```

## 12.4 Gerar C

```text
Gerar C
    ->
persistir cena
    ->
rodar codegen
    ->
mostrar preview/log do resultado
```

## 12.5 Play Sem Build

```text
se nao existe ROM carregada:
    pedir/carregar ROM
senao:
    mudar para workspace Game
    retomar se pausado
```

## 12.6 Copiar E Colar Entidade

```text
selecionar entidade
    ->
Copiar / Ctrl+C
    ->
buffer interno
    ->
Colar / Ctrl+V
    ->
nova entidade derivada na cena
```

## 12.7 Alternar MD / SNES

```text
trocar target
    ->
store atualiza target ativo
    ->
restricoes e budgets mudam
    ->
emulador e resetado para evitar contaminacao de sessao
```

## 13. Atalhos E Gestos Importantes

| Entrada | Onde | Efeito |
|---|---|---|
| `Ctrl+C` | shell/scene | copia entidade |
| `Ctrl+V` | shell/scene | cola entidade |
| `Ctrl+Z` | shell | undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | shell | redo |
| `Delete` | NodeGraph | remove no |
| `V` | Scene | selecao |
| `B` | Scene | paint |
| `E` | Scene | erase |
| `C` | Scene | collision |
| `G` | Scene | snap/grid toggle relacionado |
| `Ctrl + wheel` | Scene | zoom |
| `Space + drag` | Scene | pan |
| `Middle mouse drag` | Scene | pan |
| `Z`, `X`, `C`, `Enter`, setas | Game | joypad |
| `R` | Game pausado | rewind |

## 14. O Que E Mais Estavel E O Que Ainda E Experimental

## 14.1 Superficies Mais Centrais Para O MVP

- shell principal
- Hierarchy
- Scene viewport
- Inspector
- Runtime Setup
- fluxo `Build -> ROM -> Emulacao`
- console e validacao live

## 14.2 Superficies Explicitamente Marcadas Como `Experimental`

- RetroFX
- Art Studio
- Asset Browser
- Asset Extractor
- Memory Viewer
- VRAM Viewer
- Reverse Workspace
- ferramentas avancadas de tilemap no inspector

## 15. Resumo Executivo Da GUI

Se alguem precisar entender a GUI em poucas linhas:

```text
1. O app e um shell unico, nao um conjunto de paginas.
2. O workspace escolhido muda a intencao do editor.
3. O centro da experiencia e Scene/Game/Logic.
4. O lado direito alterna entre editar propriedades e operar ferramentas.
5. O fluxo mais importante do produto hoje e:
   editar -> validar -> buildar -> gerar ROM -> emular.
6. Varias bancadas de apoio existem, mas algumas ainda estao explicitamente em zona Experimental.
```

## 16. Mapa Mental Final

```text
RETRODEV STUDIO GUI

Shell
|- Header 1
|  |- Novo
|  |- Abrir
|  |- Salvar
|  |- Build & Run
|  |- Play
|  `- Stop
|
|- Header 2
|  |- projeto / target / budgets
|  |- presets / focus / right panel mode
|  |- validar / gerar C
|  `- atalhos auxiliares
|
|- Workspaces
|  |- Scene
|  |  |- Hierarchy / Layers
|  |  |- Scene Viewport
|  |  `- Inspector / Tools
|  |- Game
|  |  `- Emulador + replay/state/audio
|  |- Logic
|  |  `- Node Graph
|  |- RetroFX
|  |  `- Parallax / Raster
|  |- ArtStudio
|  |  `- importar -> fatiar -> animar -> preview -> aplicar
|  `- Debug
|     `- bancada de ferramentas
|
`- Console
   `- log operacional do editor
```
