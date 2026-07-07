# Estudo UI/Produto - Proposta Consolidada De Interface - Nao Canonico

**Status:** Estudo interno, NAO CANONICO
**Data:** 2026-07-06
**Origem:** proposta tecnica de UI (v1) + ajustes de revisao (v2) aprovados pelo usuario como base de estudo.

> Documento de estudo interno.
> Nao substitui a documentacao canonica do projeto.
> Nao altera a hierarquia de verdade definida em `docs/00_AI_DIRECTIVES.md` e `docs/06_AI_MEMORY_BANK.md`.
> Nao antecipa nenhuma decisao canonica: as secoes de "texto proposto" (secao 12) sao rascunhos para avaliacao humana futura e NAO devem ser tratadas como aprovadas nem aplicadas.
> Os status de maturidade citados espelham `docs/03_ROADMAP_MVP.md` na data de escrita; em conflito, roadmap e Memory Bank vencem.
> Nada aqui autoriza dependencia nova, superficie visivel sem linha na matriz do roadmap, nem promocao de maturidade.

---

## 0. Tese De Produto (Proposta)

Texto-base da tese (destino natural futuro: `docs/01_PRD_MASTER.md`, secao 1; ver secao 12.1):

> **Tese RetroDev Studio.** Um unico editor acompanha o usuario do primeiro jogo sem codigo ate o limite fisico do console - no mesmo shell, no mesmo projeto, com a mesma verdade de hardware. O centro do produto nao sao os workspaces: e o ciclo **criar -> testar -> diagnosticar -> exportar um jogo retro real**. Toda superficie existe para encurtar uma volta desse ciclo; o que nao serve ao ciclo e periferia.

Corolarios operacionais:

1. Nenhuma feature entra se nao reduzir tempo ou atrito de uma volta do ciclo.
2. Ninguem "se forma para fora" da ferramenta: subir de nivel nunca exige migrar de app (anti-padrao do nicho: GB Studio -> GBDK).
3. A verdade do hardware e a mesma em todos os niveis: o iniciante ve menos numeros, nunca numeros falsos.

Anti-metas explicitas (guarda-corpo contra "colecao de workspaces bonitos"):

- Nao e frontend de emulador.
- Nao e suite de editores de asset desconexos.
- Nao e browser de documentacao.

Metricas-norte que operacionalizam a tese:

| Metrica | Alvo |
|---|---|
| Tempo ate a primeira ROM jogavel (novato, sem docs externas) | <= 15 min |
| Loop interno editar -> ver rodando no emulador | medido e exposto na UI; meta de reducao continua |
| % de voltas do ciclo completadas sem sair do app | crescente por release |

---

## 1. Principio Central: Um So Shell, Espectro Continuo De Usuario

O shell atual (`src/App.tsx`) ja acerta o fundamental: o app e um editor cujo estado muda, nao um site com paginas. A proposta mantem as zonas existentes (topbar unificada, rail de workspaces, docking com `react-resizable-panels`, Command Palette, presets de layout, budgets de hardware na toolbar, status bar, Workspace Guide) e adiciona a ideia organizadora que falta: **o mesmo shell se revela progressivamente conforme o nivel do usuario**, em vez de existirem "modo iniciante" e "modo avancado" como produtos separados. O novato nunca ve um app diferente do avancado - ve o mesmo app com menos superficie exposta.

### 1.1 Zonas Do Shell (alvo)

```text
+------------------------------------------------------------------------------------+
| TOPBAR: [logo] projeto | alvo (perfil HW) | Novo | Abrir | Build & Run |           |
|         modo: Guiado | Criador | Pro | Hacker | busca | config                     |
+------------------------------------------------------------------------------------+
| RAIL POR DOMINIO:  core [Cena][Jogo][Explorer]                                     |
|                    autoria [Arte][Som (proposta)][Logica][FX exp]                  |
|                    avancado [Reversa exp (gated)][Debug]                           |
+------------------------------------------------------------------------------------+
| FAIXA DE ORCAMENTO DE HARDWARE: VRAM | sprites/linha | paletas | DMA (por perfil)  |
+---------------+---------------------------------------------+----------------------+
| DOCK ESQUERDO | PALCO CENTRAL                               | DOCK DIREITO         |
| Hierarquia /  | Cena / Jogo / Logica / Arte / FX / Reversa  | Inspector / Tools /  |
| Camadas       | (resolucao e limites vem do perfil de HW)   | Ajuda + diagnostico  |
|               |                                             | "por que travado?"   |
+---------------+---------------------------------------------+----------------------+
| STATUS BAR: build | emulacao | core ativo | console                                |
+------------------------------------------------------------------------------------+
```

### 1.2 O Que Ja Existe x O Que A Proposta Adiciona

Ja existe em codigo: topbar, rail (Scene/Game/Explorer/Logic/Art/FX/Debug), docking, Command Palette, editor de atalhos com deteccao de conflito, presets/salvamento de layout, budgets VRAM/scanline/paleta na toolbar, status bar, Workspace Guide, wizard de templates, diagnosticos acionaveis (`ActionableDiagnostic`).

A proposta adiciona quatro elementos de coesao:

1. **Seletor de modo/persona** na topbar (secao 2).
2. **Rail agrupado por dominio** (core / autoria / avancado) em vez de lista plana; inclui o workspace **Som** (novo, proposta) e promove **Reversa** de aba de Tools para workspace gated.
3. **Faixa de orcamento de hardware sempre visivel**, dirigida pelo perfil de hardware ativo.
4. **Diagnostico "por que travado?" como cidadao de primeira classe** no dock direito: todo bloqueio de build/budget aponta causa + acao, reutilizando o `ActionableDiagnostic` existente.

---

## 2. Personas E Progressao (Criterios Objetivos De Transicao)

Quatro niveis, uma escada continua. Cada nivel **adiciona** superficie; nunca esconde o que o nivel anterior aprendeu. O usuario escolhe onde entra e sobe quando quiser.

### 2.1 Os Quatro Niveis

| Nivel | Quem e | Objetivo | O que o shell revela | O que fica recolhido |
|---|---|---|---|---|
| **Guiado** | Nunca programou | "Quero um jogo jogavel hoje" | Wizard de template, Cena com arrastar-e-soltar, Play, ajuda inline | Logica por nodes, budgets crus, ferramentas de reversa |
| **Criador** | Faz jogos sem codigo | Jogo completo (levels, arte, som, gameplay) | + Arte/Som/Logica visual, Asset Browser, budgets simplificados | Profiler, parity, disassembly, ASM |
| **Pro** | Empurra o hardware | Efeitos modernos dentro do limite real | + RetroFX, budgets crus (scanline/DMA/VRAM), profiler, save states | Decompilacao/patch, editor de ROM |
| **Hacker** | ROM hack / decompilacao | Explorar, extrair, editar, portar ROMs | + Reverse Workspace, Memory/VRAM viewer, Patch Studio, parity | (tudo visivel) |

### 2.2 Regras Invariantes De Transicao

- Transicao e **sempre sugestao**, nunca troca automatica.
- Nunca ha rebaixamento automatico.
- Override manual sempre disponivel (seletor na topbar).
- "Nao sugerir novamente" e respeitado.
- Todos os contadores sao locais (editorStore + localStorage), zero rede - e sao **os mesmos contadores** das metricas locais de produto da fatia 1 (uma so fonte de verdade).

### 2.3 Gatilhos Objetivos (>= 2 de 3 por transicao)

| Transicao | Gatilhos objetivos | Momento da oferta |
|---|---|---|
| Guiado -> Criador | (a) 1a ROM buildada e rodada com sucesso; (b) 1o asset proprio importado e instanciado em cena; (c) cena editada, persistida e reaberta | Card unico pos-build bem-sucedido |
| Criador -> Pro | (a) >= 5 avisos de budget acumulados ou 1 build bloqueado por budget; (b) >= 10 nodes criados/editados no Logic; (c) diagnostico detalhado aberto >= 3x | No instante do aviso de budget ("quer ver as ferramentas Pro?") |
| Pro -> Hacker | (a) tentativa de abrir/importar ROM externa (BYOR); (b) clique em superficie gated (Reversa/Memory/VRAM); (c) uso do Asset Extractor | O proprio clique na superficie gated abre a oferta de ativacao |

### 2.4 Mecanismo De Disclosure

- **Gate declarativo por nivel** no Surface Registry (secao 7): cada superficie declara `minPersona` e `maturity`. Rail, Command Palette e menus filtram por isso.
- **Destravar contextual:** importar ROM oferece subir para Hacker; estourar budget oferece revelar RetroFX/profiler.
- **Nunca mente sobre maturidade:** superficie `Experimental` leva o mesmo rotulo em qualquer nivel.

---

## 3. Camada Agnostica: Expansao Para Novos Consoles

Leitura vertical da arquitetura de UI:

```text
[Guiado] -> [Criador] -> [Pro] -> [Hacker]        (niveis do usuario)
        \      |       |      /
         v     v       v     v
   [ Um shell - uma cena - um projeto ]
                   |
                   v
   [UGDM agnostico] -> [Perfil de HW] -> [Platform adapter] -> [Alvos: MD, SNES, +novos]
```

A UI **nunca hardcoda Mega Drive/SNES**. Ela le o perfil de hardware (VRAM, modelo de paleta, resolucao, sprites/scanline, DMA) e se molda: budgets da faixa, resolucao do palco, limites do Inspector, tudo deriva do perfil. Adicionar um console novo = registrar um perfil + adapter no backend; o shell se adapta sem reescrita. Coerente com o `Hardware Profile Engine` do PRD e com a regra do UGDM agnostico (proibicao de nomes de hardware no UGDM).

---

## 4. Dominios Na UI: Caminho Amigavel x Caminho Avancado

Para cada dominio, um caminho amigavel (Guiado/Criador) e um caminho avancado (Pro/Hacker) convivem no mesmo workspace, com rotulo honesto de maturidade.

| Dominio | Workspace | Caminho amigavel | Caminho avancado | Base atual (honesto) |
|---|---|---|---|---|
| Graficos/Sprites | Arte | Importar imagem -> auto-slice -> paleta sugerida (snap MD) | Editor de paleta, onion-skin, hitboxes por frame, comandos | `ArtStudioPanel`, `photo2sgdk` - **Experimental** |
| Levels/Mundo | Cena | Arrastar tiles/entidades, snap, camadas | Metasprites, streaming/residencia VRAM, colisao avancada | Scene/Layer/Inspector - **Em hardening** |
| Som/Musica | Som (novo agrupamento) | Soltar audio em `assets/audio`, tocar no playtest | Canais, XGM, orcamento de audio, eventos por cena | Import de audio existe; workspace dedicado e **proposta** |
| Gameplay/Logica | Logica | Receitas/nodes prontos (pular, mover, spawnar) | NodeGraph completo, FSM, `input_command`, codegen C <-> nodes | `NodeGraphEditor`, `nodeCompiler` - **Experimental** |
| Efeitos modernos | FX (RetroFX) | Presets de parallax/paleta | Raster, line-scroll, DMA timeline, scanline events | `RetroFXDesigner` - **Experimental (Local)** |
| Emulacao/Playtest | Jogo | Botao Play, rewind, save state | Frame-step, sync editor, performance overlay | Libretro FFI - **Em hardening** |
| Decompilacao / ROM hack | Reversa (gated Hacker) | Extrair assets, inspecionar ROM | Disassembly, anotacoes, parity, Patch Studio, IPS/BPS | Reverse Workspace **Experimental**; decomp pareada **so spikes, LLM bloqueado, atras de GO** (secao 8) |

---

## 5. Sistema De Layout Adaptativo (Com Criterios De Teste Por Resolucao)

### 5.1 Tres Densidades De Shell

Dirigidas por breakpoint do host, usando o `react-resizable-panels` ja aprovado (zero dependencia nova):

| Perfil | Faixa | Comportamento |
|---|---|---|
| **Compacto** | <= 1366 px / Steam Deck (1280x800) | Docks laterais viram drawers sobrepostos; rail vira icones; budgets colapsam em 1 chip "HW" com popover; alvos de toque >= 40 px |
| **Padrao** | ~1920 px | Layout de 3 colunas; densidade media |
| **Amplo/ultrawide** | >= 2560 px | Quarta coluna opcional (ex.: Console + Profiler lado a lado); densidade confortavel |

Complementos:

- **Modo Foco** (ja existe) esconde tudo menos o palco.
- **Toggle global de densidade** compacta/confortavel.
- **Layouts salvos por workspace E por perfil de resolucao** (evolucao do `LAYOUT_STORAGE_KEY`/presets em `src/core/workspaceLayout.ts`), para um host pequeno nao herdar layout de ultrawide.
- Afordancias de toque/gamepad no Steam Deck sao desejaveis, mas entram **marcadas como futuro/experimental** - nao prometidas como prontas.

### 5.2 Criterios De Teste Por Resolucao (asserts, nao so screenshots)

Estende o bloco H do QA-RC (que ja screenshota 1366x768 / 1920x1080 / 2560x1080) com 1280x800 e com asserts programaticos:

| Criterio (assert automatizavel) | 1280x800 | 1366x768 | 1920x1080 | 2560x1080 |
|---|---|---|---|---|
| Perfil de shell ativo | Compacto | Compacto | Padrao | Amplo |
| Chrome sem scroll horizontal (`scrollWidth <= viewport`) | Sim | Sim | Sim | Sim |
| Acoes primarias alcancaveis (visiveis ou overflow "..." funcional) | Sim | Sim | Sim | Sim |
| Alvo interativo minimo | 40 px | 24 px | 24 px | 24 px |
| Docks laterais | drawers | drawers | 3 colunas | 3-4 colunas |
| Drawers fechados -> palco ocupa largura total menos o rail | Sim | Sim | n/a | n/a |
| Foco visivel em tab-through (screenshot + assert de outline) | Sim | Sim | Sim | Sim |
| Texto computado >= 11 px | Sim | Sim | Sim | Sim |
| Smoke de interacao por workspace core | Sim | Sim | Sim | Sim |

Onde vive: extensao do proprio `scripts/e2e-tauri-build-run.mjs` (bloco H) + vitest de unidade para a logica de breakpoint. Regra herdada do projeto: cada perfil novo de resolucao reproduz localmente antes de entrar no CI.

---

## 6. Design System (WCAG 2.2 AA Como Meta Minima)

### 6.1 Fundamentos

- **Tokenizar a paleta Catppuccin** que hoje esta espalhada em hex literais no JSX (`#cba6f7`, `#a6e3a1`, ...) para variaveis CSS semanticas (`--accent`, `--success`, `--danger`, `--surface-*`, `--text-*`, `--focus-ring`). Destrava tema claro/escuro e temas alternativos sem tocar componente; pre-requisito de "moderna e flexivel".
- Dois pesos de fonte, sentence case, sem gradiente/sombra pesada: linguagem visual limpa e nativa de desktop.
- **i18n:** o produto e PT-BR hoje; extrair strings para catalogo prepara EN. Marcar como fase propria, nao embutir na fatia 1.

### 6.2 Meta De Acessibilidade

**WCAG 2.2 AA e barra minima para superficies Core MVP.** Superficies Experimental podem entrar com backlog A11y aberto, mas sem regredir as regras estruturais (foco, teclado, alvo). Mapeamento dos criterios 2.2 para o shell concreto:

| Criterio WCAG 2.2 | Nivel | Aplicacao concreta |
|---|---|---|
| 2.5.7 Movimentos de arrastar | AA | Toda interacao de drag ganha alternativa: splitters por teclado (verificar suporte da lib de paineis e cobrir com teste), pintura de tiles clique-a-clique, mover node selecionado por setas, conectar portas por menu, timeline do ArtStudio por botoes |
| 2.5.8 Alvo minimo 24x24 | AA | Auditar chips/icones interativos de 7-9 px atuais: crescer ou torna-los nao interativos |
| 2.4.11 Foco nao obscurecido | AA | Foco nunca escondido sob toolbar sticky/drawer; assert de intersecao no tab-through |
| 2.4.7 Foco visivel | AA | Token `--focus-ring` consistente nos dois temas (entra na tokenizacao da fatia 1) |
| 1.4.3 / 1.4.11 Contraste texto e nao-texto | AA | Validado na criacao dos tokens, nao depois |
| 3.2.6 Ajuda consistente | A | Workspace Guide/ajuda sempre no mesmo slot em todos os workspaces |
| 3.3.7 Entrada redundante | A | Wizard nunca re-pede dado ja fornecido (donor path etc. - ja parcialmente feito) |
| 4.1.2 Name/Role/Value | A | Padrao ARIA unico para docks, drawers e toolbars |

Nota de stack: `axe-core` automatizaria a auditoria, mas e **dependencia nova** - so entra com aprovacao humana e reflexo em `docs/02_TECH_STACK.md`. Ate la: checklist manual + asserts com testing-library existente.

---

## 7. Extensibilidade: Surface Registry E Hardware Profiles

### 7.1 Surface Registry (regra normativa proposta)

> Nenhuma superficie visivel entra no shell sem entrada no **Surface Registry** com `{ id, dominio, minPersona, maturity, capability, roadmapRef }`. O registry e o espelho em codigo da matriz de maturidade de `docs/03_ROADMAP_MVP.md`: **divergencia registry x matriz = falha de gate**.

Campos:

| Campo | Significado |
|---|---|
| `id` | Identificador unico da superficie (workspace, ferramenta, importador) |
| `dominio` | core / autoria / avancado (agrupa o rail e a Command Palette) |
| `minPersona` | Nivel minimo que ve a superficie (guiado/criador/pro/hacker) |
| `maturity` | Vocabulario controlado do roadmap (`Em codigo`, `Em hardening`, `Experimental`, `spike`, ...) |
| `capability` | Capacidade backend requerida (permite desabilitar com diagnostico acionavel quando faltar toolchain/core) |
| `roadmapRef` | Ancora da linha correspondente na matriz do roadmap |

Enforcement minimo (sem dependencia nova):

- Teste Vitest que **falha** se um workspace/ferramenta renderizavel nao tiver entrada no registry.
- Teste que compara `maturity` do registry com o status da linha correspondente da matriz (ancorado por `roadmapRef`).
- Efeito: converte a regra 3.1.3 de `docs/09_AGENT_DEV_MODE.md` ("nova superficie visivel -> linha na matriz") de disciplina documental em **gate executavel**. Superficie sem linha de maturidade honesta nao passa no baseline. Este e o mecanismo estrutural contra "colecao de workspaces bonitos".

Implementacao: evolucao do `WORKSPACE_ITEMS`/`EXECUTABLE_COMMAND_IDS` de `src/App.tsx` + `data/template_registry.json`; modulo TS + testes, sem dependencia nova. Adicionar feature = adicionar entrada + componente lazy, sem mexer no shell.

### 7.2 Hardware Profile Registry

A UI consome o perfil de hardware (o `Hardware Profile Engine` do PRD): budgets, resolucao do palco, modelo de paleta, limites do Inspector. Novo console = novo perfil + adapter no backend; a UI se adapta sem reescrita (secao 3).

### 7.3 Marketplace

O "Plugin Marketplace" do PRD (camada Enterprise) fica **explicitamente como futuro**; os dois registries acima sao seu embriao honesto, nada alem disso.

---

## 8. Decompilacao / LLM: Gated, Experimental/Spike, Dependente De GO Formal

Regra deste estudo, alinhada a `docs/12_DECOMPILACAO_PAREADA_PLANO.md` e ao roadmap:

- O workspace **Reversa** e desenhado nesta proposta, mas permanece `Experimental` e **gated para a persona Hacker**.
- A decompilacao pareada existe hoje apenas como **spikes** (paridade referencia/candidata, fingerprint M68K, build-duplo reproduzivel). **Scanner/ledger/LLM/UI nao estao implementados nem autorizados.**
- **LLM permanece BLOQUEADO** ate GO formal do usuario + reflexo em `docs/02_TECH_STACK.md`.
- Dependencias externas sao BYOR/BYOK e devem ser explicitadas na propria UI: Ghidra 11.x/12.x + JDK 21+, `m68k-elf-gcc` (toolchain SGDK), chaves de API por conta do usuario.
- No Surface Registry, essas superficies entram com `maturity: experimental/spike` e a UI **nunca** as anuncia como prontas.
- Compliance inalterada: BYOR e patches IPS/BPS; nenhuma distribuicao de ROM comercial.

---

## 9. Mapeamento Honesto: Existe Hoje x Proposta x Futuro

| Camada da proposta | Existe hoje | Proposta (refino, sem dep nova) | Futuro / gated |
|---|---|---|---|
| Shell/docking/topbar/palette/atalhos | Em codigo | Agrupar por dominio; tokenizar tema | - |
| Persona/disclosure | Parcial (badges `Exp.`, `EXECUTABLE_COMMAND_IDS`) | `minPersona` + `maturity` no registry, seletor de modo | Sugestoes automaticas de "subir de nivel" calibradas por metricas |
| Layout adaptativo | Presets + Focus + QA multi-resolucao (bloco H) | 3 densidades + drawers + layout por resolucao + asserts | Toque/gamepad no Steam Deck |
| Budgets de hardware | VRAM/scanline/paleta na toolbar | Faixa dedicada + "por que travado?" acionavel | Profiler visual profundo |
| Arte/Logica/FX/Reversa | Em codigo, Experimental | Ergonomia amigavel + rotulos honestos | Certificacao institucional para sair de Experimental |
| Som (workspace proprio) | Import de audio existe | Novo workspace de som/musica | Editor de canais/XGM completo |
| Decompilacao pareada | So spikes | UI do workspace Reversa desenhada | Scanner/ledger/LLM/UI atras de GO + aprovacao de stack |
| Multi-console | UGDM agnostico + perfis MD/SNES | UI 100% dirigida por perfil | Registrar novos consoles |
| Parity/Cycle Report | Abas Experimentais em Tools | Permanecem gated Pro/Hacker com rotulo | Criterio institucional de equivalencia |

---

## 10. Primeira Fatia V2 (Sem Dependencia Nova)

Escopo 100% frontend, stack aprovado, **zero dependencia nova**, sem antecipar fases do roadmap. Ordem:

1. **Tokens de tema** (Catppuccin -> variaveis semanticas, incl. `--focus-ring`, contraste AA validado na criacao).
2. **Surface Registry + rail por dominio** (com o teste de enforcement da secao 7.1).
3. **Seletor de persona** + contadores de transicao (secao 2.3).
4. **3 densidades de layout** + drawers no Compacto (secao 5).
5. **Estados vazios:** todo painel vazio ganha componente padrao com "o que e isto + 1 acao seguinte real" - zero becos sem saida.
6. **Autosave + recuperacao:** draft com debounce sobre o `scenePersistence` existente, badge "rascunho salvo", recovery pos-crash (draft ao lado do `project.rds`, nunca sobrescreve sem confirmacao).
7. **Undo/redo confiavel:** contrato "toda mutacao de cena passa pelo historico do store", teste que enumera os comandos cobertos, indicador na UI.
8. **Metricas locais de produto:** time-to-first-ROM, taxa de sucesso de build, violacoes de budget, uso por workspace - JSON local, sem rede, opt-out; alimentam as metricas-norte (secao 0) e os gatilhos de persona (secao 2.3).

Criterios de aceite da fatia:

- Novato: template -> ROM rodando em <= 15 min sem docs externas (medido pela metrica, nao por opiniao).
- Zero paineis vazios sem acao seguinte.
- Undo/redo cobre 100% das mutacoes de cena expostas na UI.
- Kill do app perde no maximo ~30 s de trabalho (recovery testado).
- Bloco H estendido verde nas 4 resolucoes; regras estruturais WCAG (foco/alvo/teclado) sem regressao.
- Gates padrao do projeto verdes (`check:tree`, lint, tsc, `npm test`, clippy, `cargo test --lib`).

---

## 11. Matriz Comparativa Com Ferramentas Reais

Valores: Sim / Parcial / Nao. A coluna RetroDev anota o status honesto de hoje.

| Capacidade | GB Studio | NESmaker | SGDK + VS Code | Tiled + Aseprite | Mesen2 / BlastEm | Ghidra + Flips | RetroDev (hoje -> meta) |
|---|---|---|---|---|---|---|---|
| Jogo sem codigo -> ROM real | Sim (GB) | Sim (NES) | Nao | Nao | Nao | Nao | Parcial Exp. -> Sim MD/SNES |
| Budgets de hardware ao vivo no editor | Parcial | Parcial | Nao (descobre no crash) | Nao | Parcial (pos-fato) | Nao | Sim (hardening) - diferencial |
| Emulacao integrada ao editor | Parcial (preview) | Parcial | Nao (externa) | Nao | n/a | Nao | Sim (hardening) |
| Debug profundo (memoria/VRAM/eventos) | Nao | Nao | Parcial (via emulador) | Nao | Sim (referencia) | Nao | Parcial Exp. -> paridade basica |
| Arte/animacao especifica de console | Parcial | Parcial | Nao | Sim (generico) | Nao | Nao | Parcial Exp. |
| Musica/SFX integrados | Sim (tracker) | Parcial | Nao (externo) | Nao | Nao | Nao | Nao -> workspace Som proposto |
| Logica visual <-> codigo C | Parcial (eventos) | Parcial | Nao | Nao | Nao | Nao | Parcial Exp. (ambicao: C <-> nodes) |
| Reversa/extracao integrada ao rebuild | Nao | Nao | Nao | Nao | Parcial (inspecao) | Sim (generico, nao integrado) | Parcial (spikes gated) |
| Patch IPS/BPS (BYOR) | Nao | Nao | Nao | Nao | Nao | Sim (Flips) | Planejado -> paridade funcional |
| Multi-console 16-bit no mesmo projeto | Nao | Nao | Nao | Nao | n/a | n/a | Sim via UGDM - diferencial unico |
| Escada novato -> avancado na mesma ferramenta | Nao (gradua para fora) | Nao | Nao | Nao | Nao | Nao | **A tese deste estudo** |

Leitura acionavel - **benchmark por fatia** (cada linha nomeia quem igualar, nao quem "vencer"):

- Onboarding/no-code: igualar **GB Studio** (referencia de UX do nicho).
- Debug: paridade com o **basico do Mesen2** no MVP (Memory/VRAM ja existem como Experimental); profundidade total e meta pos-MVP.
- Arte: **nao competir com Aseprite - interoperar** (import/re-import fluido) e cobrir so o que e especifico de console (paletas/tiles/metasprites).
- Som: cobrir o especifico (canais/XGM/orcamento de audio); interoperar com o ecossistema em vez de reinventar tracker.
- Patch: paridade funcional com **Flips**.
- Reversa: **integracao > profundidade** - Ghidra continua por tras como BYOR, conforme o plano de decompilacao.

A ultima linha da matriz e a validacao de mercado da tese: ninguem no nicho oferece a escada continua - e exatamente onde a integracao do ciclo vira vantagem estrutural, nao cosmetica.

---

## 12. Textos Propostos Para Futuras Insercoes Canonicas

> **NAO APLICADO. NAO APLICAR sem decisao humana explicita.**
> Pre-condicao operacional: worktree limpo ou branch dedicada, porque `docs/03_ROADMAP_MVP.md` e `docs/08_TREE_ARCHITECTURE.md` estavam modificados por outra frente na data deste estudo.
> Estas secoes sao rascunho de redacao, nao decisao. A aplicacao exige a mesma sessao atualizar os docs canonicos afetados e rodar os gates aplicaveis.

### 12.1 Proposta Para `docs/01_PRD_MASTER.md` (secao 1 - Visao)

Inserir apos a Missao:

```markdown
### 1.x Tese De Produto
Um unico editor acompanha o usuario do primeiro jogo sem codigo ate o limite
fisico do console - no mesmo shell, no mesmo projeto, com a mesma verdade de
hardware. O centro do produto nao sao os workspaces: e o ciclo
criar -> testar -> diagnosticar -> exportar um jogo retro real.
Toda superficie existe para encurtar uma volta desse ciclo; o que nao serve ao
ciclo e periferia.

Corolarios: (1) nenhuma feature entra se nao reduzir tempo/atrito de uma volta
do ciclo; (2) subir de nivel nunca exige migrar de ferramenta; (3) a verdade do
hardware e a mesma em todos os niveis - o iniciante ve menos numeros, nunca
numeros falsos.

Anti-metas: nao e frontend de emulador; nao e suite de editores de asset
desconexos; nao e browser de documentacao.
```

### 12.2 Proposta Para `docs/03_ROADMAP_MVP.md` (junto as regras da matriz)

```markdown
### Regra: Surface Registry Obrigatorio
Nenhuma superficie visivel entra no shell sem entrada no Surface Registry com
`{ id, dominio, minPersona, maturity, capability, roadmapRef }`.
O registry e o espelho em codigo da matriz de maturidade deste roadmap:
divergencia registry x matriz = falha de gate.

Enforcement minimo (sem dependencia nova):
- teste Vitest que falha se um workspace/ferramenta renderizavel nao tiver
  entrada no registry;
- teste que compara `maturity` do registry com o status da linha correspondente
  da matriz (ancorado por `roadmapRef`);
- nova superficie sem linha na matriz nao passa no baseline.
```

### 12.3 Proposta Para `docs/08_TREE_ARCHITECTURE.md` (mapa de `docs/`)

Adicionar a linha:

```text
|   |-- ESTUDO_UI_PRODUTO_NAO_CANONICO.md    (estudo de UI/produto, nao canonico)
```

Observacao: `docs/ESTUDO_FRONTEND_GUI_NAO_CANONICO.md` existe no disco e tambem nao consta do mapa; a mesma edicao canonica pode registrar os dois arquivos de estudo para coerencia.

---

## 13. Governanca Deste Estudo

- Este documento e subordinado a hierarquia de verdade; qualquer conflito com `06_AI_MEMORY_BANK`, `03_ROADMAP_MVP`, `09_AGENT_DEV_MODE`, `08_TREE_ARCHITECTURE` ou `02_TECH_STACK` se resolve a favor dos canonicos.
- Nenhuma implementacao derivada deste estudo pode: adicionar dependencia sem aprovacao + reflexo em `02_TECH_STACK`; criar superficie sem linha na matriz do roadmap; declarar parcial como pronto; antecipar fases futuras como entregues.
- A primeira fatia v2 (secao 10) e a unica parte proposta como implementavel na fase atual de hardening, por ser 100% frontend, sem dependencia nova e a servico do fluxo canonico `Build -> ROM -> Emulacao`.

**[Fim do estudo]**
