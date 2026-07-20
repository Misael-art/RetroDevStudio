# RetroDev Studio — Auditoria Sênior de UI/UX

## Adendo B2 — iconografia, resize e caixas adaptáveis (18/07/2026)

Após a primeira entrega dos mocks, foi solicitado um contrato transversal mais próximo de IDEs modernas. A Fase B passou a incluir:

- ícones vetoriais modernos e consistentes para workspaces, ações e estados, substituindo siglas/emoji sempre que houver equivalente inequívoco;
- `DockPanel`, `BottomDrawer`, `UtilityWindow`, `TaskDialog` e `TransientOverlay` como taxonomia explícita;
- resize manual com área de captura de 8 px, `role="separator"`, setas de 8 px, `Shift` + setas de 32 px e duplo clique para ajuste automático;
- presets responsivos por largura real do container: Balanceado, Auto e Foco;
- caixas de contexto/informação móveis, redimensionáveis, fixáveis, flutuantes e auto-ocultáveis;
- restauração segura da última geometria estável e limites que mantêm cabeçalho/controle recuperáveis dentro da viewport.

Regra de segurança: auto-ocultação é exclusiva de informação/contexto não crítico. `warning`, `danger`, validação de formulário e bloqueio de Build persistem até ação ou resolução consciente. A Command Palette adapta o tamanho automaticamente e não recebe resize manual.

Para a Fase C, a equivalência de mouse/teclado, os limites geométricos, a restauração por workspace/resolução, a pausa de auto-hide em hover/foco e os estados ARIA entram como gates obrigatórios.

**Fase:** A — auditoria, sem implementação do produto  
**Base auditada:** `codex/w7-4-blastem-parity` em `6ab6edd`  
**Data:** 2026-07-18  
**Barra:** WCAG 2.2 AA nas superfícies core; superfícies parciais preservadas como `Experimental`

## 1. Resumo executivo

O RetroDev Studio já tem um shell de IDE moderno, um fluxo operacional coerente e uma quantidade incomum de ferramentas integradas. O problema principal não é falta de superfície: é a ausência de uma linguagem de interação comum. Há 3.908 ocorrências de cores hexadecimais em `src/**/*.ts(x)`, 229 elementos `<button>` e somente 29 ocorrências estáticas de atributos `aria-*`. Os dez tokens `--rds-*` existentes em `src/styles/index.css` ainda não governam o produto.

Isso aparece para o usuário de quatro formas:

1. falhas críticas podem ficar escondidas no Console atrás de um modal;
2. ações iguais mudam de aparência, tamanho, foco e vocabulário entre painéis;
3. o layout responde à largura da janela, não à largura real do dock, comprimindo ferramentas em 1366 px;
4. estados vazio, carregando, erro e bloqueado nem sempre ensinam a próxima ação.

A recomendação é um overhaul incremental que preserve o shell e o fluxo `Build -> ROM -> Emulação`: primeiro tokens e primitivas, depois as superfícies core de maior risco, e só então a adoção sistemática nos workspaces `Experimental`. Nenhuma proposta desta auditoria exige dependência nova.

## 2. Método e evidências

- Leitura do código real no SHA-base, dos testes colocalizados e do layout oracle.
- Inspeção do app via Vite em `127.0.0.1:1420`; sem o runtime Tauri, essa execução foi usada apenas para observar o primeiro uso e a degradação de IPC.
- Comparação com evidências desktop/Tauri reais de 2026-06-28 nas quatro resoluções canônicas: 1366x768, 1600x900, 1920x1080 e 2560x1080, em `src-tauri/target-test/validation/qa-rc-2026-06-28T21-03-11-191Z-H-ui-oracle-*`.
- Contagem reproduzível no branch-base: 3.908 hex, 229 `<button>`, 29 `aria-*`; maiores concentrações: `ToolsPanel.tsx` 573, `App.tsx` 494, `ViewportPanel.tsx` 463, `ArtStudioPanel.tsx` 435, `NodeGraphEditor.tsx` 301, `InspectorPanel.tsx` 294.
- Auditoria estática de Tools: 49 botões, 31 campos, nenhum `aria-*`/`role`/`htmlFor`; 24 campos sem nome programático; 32 botões com `py-0.5`/`py-1` e só dois com tamanho mínimo explícito.
- O layout oracle atual passa seus quatro testes unitários, mas cobre apenas oito alvos macro e não mede tamanho de alvo, contraste, nome acessível, ordem/foco ou profundidade de scroll.

Limite da evidência: a auditoria não chama uma superfície de “validada” por causa de um mock ou screenshot. Os PNGs da Fase B são decisão visual; a certificação funcional pertence à Fase C.

## 3. Priorização

Escala de impacto: 5 = bloqueia tarefa core ou cria estado falso; 4 = atrito alto/erro provável; 3 = inconsistência relevante. Esforço: S, M, L.

### P0 — corrigir primeiro após aprovação dos mocks

| ID | Impacto | Esforço | Achado e evidência | Direção proposta |
|---|---:|:---:|---|---|
| A01 | 5 | M | **Wizard pode terminar em beco sem saída silencioso.** Erros de catálogo/criação são enviados ao Console (`src/App.tsx:1981`, `src/App.tsx:2680`, `src/App.tsx:2751`), mas o modal cobre essa superfície (`src/App.tsx:4055`; `src/components/common/Console.tsx:95`). | Wizard em três passos, erro/retry inline, resumo “Falta corrigir”, CTA desabilitado com razão visível e estado de sucesso no próprio diálogo. |
| A02 | 5 | M | **Diálogos globais sem contrato completo de foco.** Wizard e Sobre não expõem `role="dialog"`, `aria-modal`, nome/descrição nem trap; a Command Palette trata `Esc` apenas enquanto o input tem foco (`src/App.tsx:1174`, `src/App.tsx:4055`, `src/App.tsx:4774`). | Primitiva `Dialog` com foco inicial, trap, Escape controlado, restauração ao invocador e descrição acessível. |
| A03 | 5 | M | **Runtime Setup pode mascarar falha como ambiente vazio.** `refreshStatus` só registra erro no Console (`src/components/tools/ToolsPanel.tsx:1350`), enquanto o painel continua com totais zero (`src/components/tools/ToolsPanel.tsx:1521`). | Estados distintos loading/error/ready/installing; erro acionável local; progresso por dependência; Console como detalhe secundário. |
| A04 | 5 | M | **Debug/Tools responde ao viewport, não ao container.** Dock direito usa 42% e o conteúdo ativa `xl:flex-row`/`md:grid-cols-6` porque a janela é larga, embora sobrem ~300 px em 1366 (`src/core/workspaceLayout.ts:53`, `src/components/tools/ToolsPanel.tsx:1521`, `src/components/tools/ToolsPanel.tsx:3057`). | Layout por container: navegação vira toolbar/select no dock estreito, conteúdo em uma coluna e expansão progressiva conforme a largura real. |
| A05 | 5 | S | **Navegações visuais não têm semântica de tabs.** Insp/Tools, categorias de Tools e as sete views de Reverse são botões sem `tablist/tab/aria-selected` ou roving tabindex (`src/App.tsx:5118`, `src/components/tools/ToolsPanel.tsx:3089`, `src/components/tools/ReverseWorkspace.tsx:453`). | Tabs compartilhadas, setas/Home/End, foco visível e seleção anunciada. |
| A06 | 5 | M | **Sistema visual não é governado.** 3.908 hex e dez tokens; Tools concentra 1.074 ocorrências/41 cores e nenhum `var(--rds-*)`. | Tokens semânticos completos + Button/Input/Dialog/EmptyState/Status; meta mensurável por área migrada. |
| A07 | 5 | M | **Acessibilidade básica dos formulários técnicos está quebrada.** `ToolPathField` e campos de Parity/Cross-Core/Cycle usam texto irmão/placeholder sem associação (`src/components/tools/ToolPathField.tsx:41`, `src/components/tools/ToolsPanel.tsx:2369`, `src/components/tools/ToolsPanel.tsx:2545`). | `Input`/`PathField` com `useId`, label, descrição, erro, browse com nome acessível e motivo de bloqueio. |
| A08 | 5 | M | **Cobertura responsiva produz falso conforto.** O oracle verifica oito alvos macro, mas não percorre Profiler, Memory, VRAM, Reverse, Parity, Cross-Core, Cycle ou Console, nem foco/alvos/contraste (`scripts/ui-layout-oracle.mjs:8`, `scripts/e2e-tauri-build-run.mjs:1818`). | Na Fase C, ampliar alvos e asserts programáticos nas quatro resoluções sem enfraquecer os atuais. |
| A29 | 5 | S | **Delete/Backspace do NodeGraph pode apagar um nó enquanto o usuário digita.** O handler global não exclui `input`, `textarea` ou contenteditable e não exige foco no canvas (`src/components/nodegraph/NodeGraphEditor.tsx:3431`). | Filtrar alvo editável, escopar o comando ao editor e oferecer undo/confirmar quando destrutivo. |

### P1 — alto impacto na fluidez e compreensão

| ID | Impacto | Esforço | Achado e evidência | Direção proposta |
|---|---:|:---:|---|---|
| A09 | 5 | M | Wizard é longo e foca o nome abaixo da dobra (`src/App.tsx:1941`, `src/App.tsx:4058`). | Stepper Template → Plataforma/Destino → Revisão; importação externa como rota irmã. |
| A10 | 4 | M | Menu principal e popover de warning não têm roles, setas, `aria-expanded` ou roving focus (`src/components/common/UnifiedTopBar.tsx:48`, `src/App.tsx:1014`). | Menu acessível com grupos, atalhos e razão para itens indisponíveis. |
| A11 | 4 | M | Topbar recorta ações via `overflow-hidden`/scroll invisível, e o oracle não detecta foco recortado (`src/components/common/UnifiedTopBar.tsx:69`, `scripts/ui-layout-oracle.mjs:182`). | Prioridade fixa Projeto/Target/Build; chip HW condensado; overflow “Mais”. |
| A12 | 4 | M | Command Palette só conhece parte do shell, não explica bloqueios e não implementa combobox/listbox (`src/App.tsx:256`, `src/App.tsx:1192`, `src/App.tsx:1736`). | Resultados agrupados, todos os comandos reais, motivo + ação de desbloqueio e ARIA completa. |
| A13 | 4 | M | Game duplica comandos da topbar, mistura PT/EN e mantém uma linha extensa sem wrap; canvas focável não tem nome (`src/components/viewport/ViewportPanel.tsx:5265`, `src/components/viewport/ViewportPanel.tsx:5293`). | Build/Parar como primários; controles avançados por disclosure; canvas nomeado e instruções de input. |
| A14 | 4 | S | Badge do Game usa constantes MD mesmo quando o target pode ser SNES (`src/components/viewport/ViewportPanel.tsx:5260`, `src/components/viewport/ViewportPanel.tsx:5288`). | Derivar target/resolução/frame reais e explicitar escala inteira. |
| A15 | 4 | M | Console usa link sem destino, abre detalhes possivelmente não relacionados e força autoscroll a cada entrada (`src/components/common/Console.tsx:36`, `src/components/common/Console.tsx:83`, `src/components/common/Console.tsx:252`). | Follow somente no fim, chip de novas mensagens, artefato real/copiar caminho e entrada correspondente selecionada. |
| A16 | 4 | M | Status bar mostra enums/microcopy mista e depende de cor/truncamento (`src/App.tsx:1058`, `src/App.tsx:2193`). | Quatro segmentos PT-BR com ícone+texto e CTA contextual “Ver erro/Configurar runtime”. |
| A17 | 4 | M | Build bloqueado tem razão principalmente sr-only; popover de warning não oferece ação de recuperação (`src/App.tsx:4835`, `src/App.tsx:1014`). | Faixa compacta “Build bloqueado” com causa principal e CTA direto. |
| A18 | 4 | M | Deep Profiler usa heatbars coloridas/hover-only e falha apenas no Console (`src/components/tools/ToolsPanel.tsx:235`, `src/components/tools/ToolsPanel.tsx:265`). | Resumo + tabela/legenda acessível e estados inline. |
| A19 | 4 | M | Memory Viewer não associa labels, não anuncia resultados/erros e pode comprimir 16 bytes no dock (`src/components/tools/ToolsPanel.tsx:1900`, `src/components/tools/ToolsPanel.tsx:2043`). | Região hex com scroll horizontal deliberado, “n de m” e foco no match. |
| A20 | 4 | M | Reverse tem trilha forte, mas sete tabs sem semântica, erros só no Console e grids definidos pelo viewport (`src/components/tools/ReverseWorkspace.tsx:453`). | Header compacto, tabs reais, summary de overview/trace e split somente quando couber. |
| A21 | 4 | M | Parity/Cross-Core/Cycle duplicam formulários ad-hoc, exigem paths manuais e misturam inglês; estados de erro são inconsistentes (`src/components/tools/ToolsPanel.tsx:2369`, `src/components/tools/ToolsPanel.tsx:2545`, `src/components/tools/ToolsPanel.tsx:2732`). | “Laboratório de Evidências” compartilhando inputs/readiness, preservando as três ferramentas e badges `Experimental`. |
| A22 | 4 | S | Splitter visual tem 4 px e hit area abaixo de 24 px; não há regressão de teclado (`src/components/common/LayoutSplitter.tsx:16`). | Hairline visual com hit area invisível ≥24 e teste de setas/Home/End/F6. |
| A23 | 4 | M | Cores secundárias falham contraste: `#45475a` chega a 1,80:1; `#64748b` 3,45:1; `#6c7086` 3,36:1; `#7f849c` é limítrofe em painel. | Tokens de texto/surface validados em pares; não usar cor “muted” para informação essencial. |
| A30 | 4 | M | Hierarchy não é uma árvore acessível: itens são `<li>` com click/duplo clique, sem foco/teclado; abrir Logic pode depender de duplo clique (`src/components/hierarchy/HierarchyPanel.tsx:658`). | `tree/treeitem` ou botões focáveis, setas/Enter e ação explícita “Abrir Logic”. |
| A31 | 4 | S | Remover entidade é imediato e minúsculo, sem confirmação ou undo (`src/components/hierarchy/HierarchyPanel.tsx:446`, `src/components/hierarchy/HierarchyPanel.tsx:553`). | IconButton ≥24 px + Dialog/undo conforme risco. |
| A32 | 4 | M | LayerPanel usa setas de 8 px, ícones de 10–13 px e remoção só no hover; reorder não tem alternativa robusta (`src/components/hierarchy/LayerPanel.tsx:249`). | Ações visíveis no foco, ≥24 px, mover por botões/teclado e anúncio de posição. |
| A33 | 4 | S | `PropRow` do Inspector só edita por clique em `<span>` e o label não está associado ao campo (`src/components/inspector/InspectorPanel.tsx:90`). | Campo focável/acionável por Enter, label programático e estados de override herdado. |
| A34 | 4 | M | Canvas de Scene é mouse-only; não há alternativa de teclado para selecionar, mover ou redimensionar (`src/components/viewport/ViewportPanel.tsx:4891`). | Stage focável/nomeado, seleção pela árvore/lista, nudge por setas e edição numérica de tamanho. |
| A35 | 4 | M | Toolbar de Scene vira faixa horizontal com dezenas de controles compactos; 1366 e 1600 mostram controles cortados (`src/components/viewport/ViewportPanel.tsx:4466`). | Ferramentas primárias fixas; overlays/visualização em menu; labels em largura ampla. |
| A36 | 4 | M | Vários overlays cobrem simultaneamente o stage em 1366 (`src/components/viewport/ViewportPanel.tsx:4823`, `src/components/viewport/ViewportPanel.tsx:4985`). | Um HUD contextual colapsável/dockado; avisos empilhados fora do canvas. |
| A37 | 4 | M | Explorer e Asset Browser duplicam o catálogo com ações divergentes (`src/components/explorer/ExplorerWorkspace.tsx:712`, `src/components/tools/ToolsPanel.tsx:983`). | Modelo visual compartilhado e conjunto canônico de ações Focar/Instanciar/Abrir no Art. |
| A38 | 4 | S | Cards do Asset Browser usam `<div onDoubleClick>` e não são acionáveis por teclado (`src/components/tools/ToolsPanel.tsx:1235`). | `article`/button focável, Enter/Space, seleção simples e ações explícitas. |
| A39 | 4 | L | Canvas/nós/ports do NodeGraph são mouse-only e o canvas fica `aria-hidden`; ports têm 12x12 (`src/components/nodegraph/NodeGraphEditor.tsx:2600`, `src/components/nodegraph/NodeGraphEditor.tsx:3695`). | Lista paralela acessível, nós focáveis/nudge, conexão por comando/select e alvos ≥24. |
| A40 | 4 | S | Paleta do NodeGraph cria nó em `onMouseDown`, então ativação normal por teclado não funciona (`src/components/nodegraph/NodeGraphEditor.tsx:3653`). | Botão semântico em `onClick`, feedback de criação e foco no novo nó. |
| A41 | 4 | M | ArtStudio tem overflow horizontal real até em 1920 e uma coluna de Inspector longa que esconde timeline/CTA (`src/components/artstudio/ArtStudioPanel.tsx:1943`, `src/components/artstudio/ArtStudioPanel.tsx:4104`). | `min-w-0`, grids responsivos, tabs Contexto/Animação/Export/Diagnóstico e action bar sticky. |
| A42 | 4 | M | RetroFX substitui estado local ao trocar cena sem guardar alterações; dirty é apenas textual (`src/components/retrofx/RetroFXDesigner.tsx:443`). | Guard/autosave explícito, indicador dirty e diálogo antes da troca. |
| A43 | 4 | S | RetroFX reorder é drag-only e falha de salvar volta ao estado normal após log no Console (`src/components/retrofx/RetroFXDesigner.tsx:536`, `src/components/retrofx/RetroFXDesigner.tsx:627`). | Mover cima/baixo + Alt+setas; saveStatus local com retry e anúncio live. |

### P2 — consistência e polimento sistemático

| ID | Impacto | Esforço | Achado | Direção proposta |
|---|---:|:---:|---|---|
| A24 | 3 | S | Console e ferramentas misturam “Severity”, “Details”, “Stack Trace”, “Missing” e “Cycle evidence”. | Microcopy PT-BR consistente; termos técnicos mantidos apenas quando são nomes do domínio. |
| A25 | 3 | S | Workspace Guide persiste uma expansão global e, compacto, mostra só a primeira ação (`src/App.tsx:549`). | Persistência por workspace e ação de recuperação sempre visível. |
| A26 | 3 | M | Runtime Setup e Multi-Target usam `window.confirm` (`src/components/tools/ToolsPanel.tsx:1387`, `src/components/tools/ToolsPanel.tsx:1426`). | Dialog de consentimento com origem, destino, impacto e CTA explícito. |
| A27 | 3 | S | Empty states como “Sem snapshot”/“Nenhum byte carregado” não respondem por que importa e o que fazer. | Primitiva `EmptyState`: contexto + próxima ação real + alternativa quando bloqueado. |
| A28 | 3 | M | Há textos de 8–10 px em Tools e muitos controles abaixo de 24 px. | Piso 11 px para informação auxiliar; alvo mínimo 24x24, 32 px para ações frequentes. |

## 4. Auditoria por superfície

| Superfície | Fluxo e estados observados | Fricção principal | Prioridade |
|---|---|---|---:|
| Wizard primeiro uso / Novo projeto | Template → target/nome/destino → criar; importação externa aparece no mesmo modal. Há vazio de catálogo, mas erro/retry não é inline. | Excesso de conteúdo, foco abaixo da dobra e falha invisível. | P0 |
| Scene | Hierarchy/Layers + viewport + Inspector/Tools; forte contexto de autoria e hardware. | Densidade sem hierarquia consistente; toolbar com abreviações, alvos pequenos e scroll horizontal; notices competem com o palco. | P1 |
| Game | Canvas com escala inteira, overlay e controles de state/replay/audio. | Comandos duplicados, bloqueios sem explicação e linha de controles sem adaptação. | P1 |
| Explorer / Asset Browser | Árvore/grid, preview, referências e instanciar/focar. | Dois modelos de navegação, estados vazios heterogêneos e ações sem primitive comum. | P1 |
| Logic / NodeGraph | Palette, canvas, Logic Context, source mapping, gaps e hardware. | Bom contexto, mas excesso de painéis concorrentes; drag sem alternativa completa; validação depende de cor e o painel direito fica estreito. | P1 |
| Art Studio (`Experimental`) | Fonte → slicing → sequências → preview/output/aplicar. | Três colunas densas, sequência longa sem progresso visual e muitos controles ad-hoc; manter rótulo `Experimental`. | P1 |
| RetroFX (`Experimental`) | Tabs Parallax/Raster, lista, preview e propriedades. | Drag/reorder sem alternativa evidente, inglês/PT misturado e sem estados de pipeline consistentes. | P2 |
| Debug / Tools | Navegação Create/Configure/Analyze/Experimental e conteúdo contextual. | Breakpoints da janela comprimem o dock; seleção visual sem tabs e informação demais antes da tarefa. | P0 |
| Runtime Setup | Revalidar, instalar/reinstalar, origem oficial, multi-target. | Falha parece “0”, confirmação nativa, progresso escondido e bloqueio global dos cards. | P0 |
| Profiler / Memory / VRAM | Formulários técnicos + leitura densa. | Labels ausentes, gráficos dependentes de cor, estados só no Console e grid comprimido. | P1 |
| Reverse (`Experimental`) | Analisar ROM, overview/trace e sete views técnicas. | Navegação/erros não acessíveis e split não segue a largura do container. | P1 |
| Parity / Cross-Core / Cycle (`Experimental`) | Paths + frame cap → execução → report. | Três formulários repetidos, readiness fragmentado e limitações difíceis de ler. | P1 |
| Console | Log, filtro/severidade, diagnóstico e artefato. | Autoscroll, link falso, detalhe desconectado e microcopy mista. | P1 |
| Status bar | Build/import/emulação/hardware + diagnóstico. | Enums crus, dependência de cor e pouca ação contextual. | P1 |
| Menus / Command Palette | Comandos globais e atalhos. | Cobertura incompleta e padrões ARIA/teclado insuficientes. | P1 |
| Diálogos / erros / bloqueios | Wizard, Sobre, Atalhos, Settings, confirmações. | Implementações ad-hoc, foco não restaurado e feedback distante da ação. | P0 |

## 5. Comportamento por resolução

### 1366x768

- Topbar e toolbar de cena disputam largura; ações podem ficar em scroll/overflow invisível.
- Debug deixa aproximadamente 550 px para o dock; a sidebar interna de 230 px comprime o conteúdo principal.
- Runtime ainda ativa grids de seis colunas porque o breakpoint lê o viewport.
- Console/detalhes consomem altura crítica e notices empurram a tarefa.

### 1600x900

- É o ponto intermediário mais estável, mas ainda herda grids por viewport dentro de docks estreitos.
- As mesmas falhas de foco, alvo e contraste permanecem; “caber” não equivale a ser acessível.

### 1920x1080

- O shell de três painéis funciona bem; a oportunidade é hierarquia, consistência e progressive disclosure.
- Espaço extra deve melhorar leitura, não multiplicar colunas automaticamente.

### 2560x1080

- Há área para painéis secundários, mas o produto não deve abrir uma quarta coluna sem intenção explícita.
- Limites máximos de leitura e centralização evitam “oceano” vazio no Game/Scene.

## 6. Direção do sistema visual

### Tokens

- Superfícies: canvas, base, painel, painel elevado, overlay.
- Bordas: sutil, forte, foco, selecionado.
- Texto: primário, secundário, muted acessível, inverso.
- Ações: primary, secondary, ghost, danger; hover/pressed/disabled.
- Estado: info, success, warning, danger, blocked, experimental; sempre ícone + texto.
- Espaçamento: escala 2/4/6/8/12/16/24/32.
- Tipografia: 11/12/14/16/20; mono somente para dados técnicos.
- Raios: 4/6/8/12; sombras só para menus/dialogs/elevated.
- Preparação para tema claro: tokens sem nomes de cor; nenhum componente escolhe hex.

### Primitivas mínimas

`Button`, `IconButton`, `Input`, `Select`, `PathField`, `Tabs`, `Dialog`, `Alert`, `EmptyState`, `StatusChip`, `Progress`, `Toolbar` e `Tooltip`. Tudo sem dependência nova, com HTML/ARIA nativos e testes colocalizados na Fase C.

## 7. Telas selecionadas para a Fase B

Cada item terá HTML estático reutilizável e PNG antes/depois em 1366x768 e 1920x1080.

1. **Design system / primitives** — tokens, Button, Input, Dialog, status e empty state.
2. **Wizard de primeiro uso** — loading, pronto e erro recuperável.
3. **Scene shell** — topbar, hierarchy, viewport, inspector, status e Build bloqueado.
4. **Game** — sessão vazia/ativa e controles com disclosure.
5. **Explorer / Asset Browser** — busca, filtros, preview e próximo passo.
6. **Logic / NodeGraph** — autoria, contexto, gaps e feedback de hardware.
7. **Art + FX Experimental** — linguagem compartilhada sem promoção de maturidade.
8. **Debug / Tools** — navegação responsiva por container.
9. **Runtime Setup** — loading/error/ready/installing e consentimento.
10. **Console + estados globais** — erro selecionado, novas mensagens, status bar e bloqueio.
11. **Command Palette + Dialog** — busca, indisponibilidade explicada e teclado.
12. **Reverse + Laboratório de Evidências Experimental** — tabs, readiness e limitações honestas.

## 8. Sequência recomendada para a Fase C (somente após aprovação)

1. tokens e primitivas, com testes;
2. shell/topbar/status/dialogs;
3. wizard;
4. Runtime Setup + Console;
5. Scene/Game;
6. Explorer/Logic;
7. adoção nos workspaces `Experimental`, preservando rótulos;
8. oracle ampliado e validação manual nas quatro resoluções.

Nenhuma implementação do produto foi iniciada nesta fase.
