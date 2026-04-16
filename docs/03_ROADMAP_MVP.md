# 03 - ROADMAP MACRO & MVP TATICO
**Status:** Documento vivo
**Ultima revisao canonica:** 2026-04-16
**Fase ativa real:** Release candidate / beta tecnica em hardening

> **DIRETRIZ PARA AGENTES E HUMANOS**
> Este roadmap e a matriz central de maturidade do produto.
> Ele nao substitui o `Memory Bank` como diario operacional, mas passa a ser a referencia permanente para:
> `fases`, `superficies visiveis`, `importadores`, `escopo do MVP` e `status de maturidade`.

---

## Como Ler

- Hierarquia de verdade:
  `docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.
- `docs/06_CURRENT_WAVE_AI_BANK.md` guarda cronologia da wave, evidencias recentes e proximo passo.
- Este arquivo guarda a fotografia permanente de escopo e maturidade do produto.

### Eixos canonicos de leitura

| Eixo | Valores | Uso |
|------|---------|-----|
| Escopo | `Core MVP`, `Experimental`, `Fora do MVP/Q2` | Diz se o item conta para o fechamento atual do produto ou nao |
| Implementacao | `Ausente`, `Parcial`, `Em codigo` | Diz se a capacidade existe no repositorio hoje |
| Certificacao | `Nenhuma`, `Local`, `Institucional`, `Em hardening` | Diz quanta prova real existe para o fluxo afetado |

### Vocabulario travado

- `Em codigo`: existe no repositorio.
- `Validado localmente`: ha prova local do fluxo afetado.
- `Validado institucionalmente`: ha evidencia canonica da rodada/host institucional.
- `Em hardening`: existe validacao real, mas ainda nao ha barra para chamar de fechado.
- `Experimental`: superficie visivel, parcial ou fora do criterio de fechamento.
- `Fora do MVP/Q2`: nao entra no fechamento atual, mesmo que exista algum codigo.

---

## Estado Executivo Atual

- Data de referencia: `2026-04-16`.
- Leitura honesta: o projeto ja tem produto real, mas ainda esta em `release candidate / beta tecnica em hardening`.
- O core canonico `Projeto -> Editor -> Build -> ROM -> Emulacao` existe e ja foi provado para `Mega Drive` e `SNES`.
- O gargalo principal hoje nao e backlog escondido de feature; e certificacao institucional, repetibilidade do `Desktop E2E`, readiness limpo e disciplina documental.
- Superficies `Experimental` reais continuam visiveis, mas nao podem contaminar a leitura do fechamento do MVP.

---

## Bloqueadores Reais

- `Desktop E2E` remoto ainda precisa ficar verde de forma repetivel no runner GitHub/Windows.
- A fotografia institucional de promocao precisa ser regenerada em worktree limpo depois das mudancas recentes de onboarding/wizard.
- MSI/portable precisam continuar sendo revalidados quando o fluxo `Menu inicial -> Criar Projeto` mudar.
- A trilha publica ainda precisa refletir o estado real da wave candidata; branch muito a frente de `origin/main` continua sendo bloqueio de governanca.
- O roadmap e o onboarding nao podem continuar divergindo do registry real de importadores e das superficies visiveis no produto.

---

## Fases

| Fase | Status atual | Leitura objetiva |
|------|--------------|------------------|
| Fase 0 - Fundacao | Concluida e verificada | Base desktop e estrutura canonica consolidadas |
| Fase 1 - Core Mega Drive | Validada institucionalmente, em hardening | Build real, ROM real e emulacao real provados em Windows |
| Fase 2 - SNES | Validada institucionalmente, em hardening | Pipeline oficial e emulacao oficial provados em Windows |
| Fase 3 - Visual Logic & RetroFX | Em codigo, validada localmente, em hardening | NodeGraph canonico e camada visual existem; superficies ainda heterogeneas |
| Fase 4 - Camada Pro | Em codigo, validada localmente, em hardening | Patching, profiling, reverse e utilitarios existem, mas nem tudo e criterio de fechamento |
| Fase 5 - Release | Release candidate / beta tecnica em hardening | Packaging, onboarding e readiness existem; falta repeticao institucional final |

---

## Matriz de Superficies

A matriz abaixo espelha as superficies perceptiveis do shell atual em `src/App.tsx`, `src/components/viewport/ViewportPanel.tsx` e `src/components/tools/ToolsPanel.tsx`.
Capacidades nao visuais, importadores e itens legados continuam nas secoes proprias deste roadmap.

| Item | Escopo | Implementacao | Certificacao | Evidencia atual | Bloqueador para subir | Conta para fechamento do MVP? |
|------|--------|---------------|--------------|-----------------|-----------------------|-------------------------------|
| Menu inicial / Criacao de projeto | Core MVP | Em codigo | Em hardening | Wizard endurecido, `manual-qa-status.json` A/F passed e packaging rebuildado em `2026-04-15` | Revalidar MSI/portable e rerodar `qa-rc` sempre que onboarding/wizard mudar | Sim |
| Scene workspace | Core MVP | Em codigo | Em hardening | `manual-qa-status.json` A-C/F passed; viewport editavel, pintura e persistencia reais | Manter shell desktop, persistencia e `Desktop E2E` verdes apos mudancas sensiveis | Sim |
| Hierarchy panel | Core MVP | Em codigo | Local | Painel dedicado no shell, integracao real em `App.tsx` e cobertura em `HierarchyPanel.test.tsx` | Falta prova institucional dedicada alem da rodada geral do editor | Sim |
| Layer panel | Core MVP | Em codigo | Em hardening | `manual-qa-status.json` A-B/F passed valida LayerPanel, visibilidade, renome e vinculacao | Rerodar `qa-rc` sempre que fluxo de camadas mudar | Sim |
| Inspector panel | Core MVP | Em codigo | Em hardening | `manual-qa-status.json` E/F passed prova selecao, edicao de `Pos X` e persistencia no reopen | Repetir prova institucional apos mudancas de selecao/props | Sim |
| Game workspace / Build & Run | Core MVP | Em codigo | Em hardening | `manual-qa-status.json` D passed, `build-report.json` de `2026-04-15` e pipelines MD/SNES ja provados em Windows | `Desktop E2E` remoto ainda precisa ficar repetivel e readiness limpo precisa ser rerodado quando build/shell mudar | Sim |
| Explorer workspace | Core MVP | Em codigo | Local | Workspace real na rail, lazy-load no shell e cobertura em `ExplorerWorkspace.test.tsx` | Falta prova institucional dedicada no fluxo de projeto | Nao |
| Logic workspace / NodeGraph canonico | Core MVP | Em codigo | Local | `NodeGraphEditor.test.tsx`, `nodeCompiler.test.ts` e emissao SGDK/SNES reais | Falta rodada institucional dedicada e refinamento continuo de UX do canvas | Nao |
| ArtStudio workspace | Experimental | Em codigo | Local | `ArtStudioPanel.test.ts`, backend `photo2sgdk` e prova local de runtime em `build_orch.rs` | Falta prova institucional `ArtStudio -> build -> runtime` | Nao |
| RetroFX workspace | Experimental | Em codigo | Local | `RetroFXDesigner.test.tsx`, persistencia em `scene JSON` e emissao MD/SNES provadas localmente | Falta prova institucional `RetroFX -> build -> runtime` | Nao |
| Debug workspace (casca de ferramentas) | Core MVP | Em codigo | Local | Workspace real na rail, alternancia `Tools/Inspector` no shell e cobertura base em `ToolsPanel.test.tsx` | Falta rodada institucional dedicada para a casca completa do workspace | Nao |
| Paleta Contextual | Core MVP | Em codigo | Local | Aba real do `Debug workspace`, descoberta guiada em `App.test.tsx` e suporte a autoria contextual | Falta prova institucional dedicada de authoring pelo painel | Nao |
| Runtime Setup | Core MVP | Em codigo | Local | Aba real do shell, `dependency_manager` ativo no Rust e testes de status/instalacao em `src-tauri/src/lib.rs` | Falta rodada institucional dedicada em host Windows limpo apos alteracoes de toolchain | Sim |
| Patch Studio | Core MVP | Em codigo | Local | `patch_studio.rs` real e roundtrip BPS coberto em `src-tauri/src/lib.rs` | Falta prova institucional dedicada quando UI/export/apply mudar | Nao |
| Deep Profiler | Core MVP | Em codigo | Local | `deep_profiler.rs` ativo, testes de profile e superficie visivel no `Debug workspace` | Falta prova institucional dedicada em rodada de playtest/debug | Nao |
| Asset Browser | Experimental | Em codigo | Em hardening | `manual-qa-status.json` E passed instancia asset real e preserva selecao no Inspector; a UI ainda o marca como `experimental` | Alinhar UI/readiness/docs e repetir QA institucional sempre que o fluxo de assets mudar | Nao |
| Asset Extractor | Experimental | Em codigo | Local | Aba real do shell, IPC/backend existentes e cobertura base em `ToolsPanel.test.tsx` | Falta prova ponta a ponta com ROM real e rodada institucional dedicada | Nao |
| Memory Viewer | Experimental | Em codigo | Local | Aba real do shell, leitura de memoria via IPC e cobertura base em `ToolsPanel.test.tsx` | Falta prova institucional com emulador ativo e ROM real | Nao |
| VRAM Viewer | Experimental | Em codigo | Local | Ferramenta real visivel no shell e integrada ao core ativo | Falta rodada institucional dedicada com ROM/emulador reais | Nao |
| Reverse Workspace | Experimental | Em codigo | Local | Aba real do shell, lazy-load provado em `ToolsPanel.test.tsx` e backend de leitura/disassembly/anotacoes existente | Falta certificacao de trace/projecao e UX tecnica final | Nao |

---

## Matriz de Importadores

| Item | Escopo | Implementacao | Certificacao | Evidencia atual | Bloqueador para subir | Conta para fechamento do MVP? |
|------|--------|---------------|--------------|-----------------|-----------------------|-------------------------------|
| `sgdk` | Experimental | Em codigo | Em hardening | Importacao/overlay reais no backend e no wizard | QA manual com projetos legados reais continua obrigatoria | Nao |
| `mugen` | Experimental | Em codigo | Local | `import_mugen_project`, wizard dedicado e cobertura backend documentada | Falta prova institucional alem da rodada local | Nao |
| `ikemen_go` | Experimental | Em codigo | Nenhuma | Perfil proprio no registry, roteado pelo adapter MUGEN | Falta evidencia dedicada para metadata e fluxo proprio | Nao |
| `godot` | Experimental | Em codigo | Local | `import_godot_project` e cobertura backend documentada | Falta prova institucional alem da rodada local | Nao |
| `construct` | Experimental | Em codigo | Nenhuma | Registry `importable: true` e `import_construct_project` no backend | Falta teste dedicado, QA e alinhamento documental mais forte | Nao |
| `rpg_maker` | Experimental | Em codigo | Nenhuma | Registry `importable: true` e `import_rpg_maker_project` no backend | Falta teste dedicado, QA e alinhamento documental mais forte | Nao |
| `openbor` | Experimental | Em codigo | Nenhuma | Registry `importable: true` e `import_openbor_project` no backend | Falta teste dedicado, QA e institucionalizacao documental | Nao |
| `gamemaker` | Fora do MVP/Q2 | Parcial | Nenhuma | Registry com `support_status: Parcial`, ainda nao importavel | Falta adapter canonico importavel e escopo aprovado | Nao |
| `unity_2d` | Fora do MVP/Q2 | Ausente | Nenhuma | Presente apenas como perfil nao suportado no registry | Falta adapter e escopo aprovado | Nao |
| `paper2d_bridge` | Fora do MVP/Q2 | Ausente | Nenhuma | Presente apenas como perfil nao suportado no registry | Falta adapter e escopo aprovado | Nao |

---

## Nao Confundir

- Checklist operacional nao e a mesma coisa que evidencia institucional.
- `Em codigo` nao significa `validado`.
- `Validado localmente` nao significa `pronto para promocao`.
- `Experimental` nao significa `inexistente`; significa `nao elegivel para claim plena`.
- `Fora do MVP/Q2` nao significa `nunca`; significa `nao conta para o fechamento atual`.
- Build por target, importadores, legados e updater continuam relevantes, mas nao entram como linha da matriz de superficies se nao forem perceptiveis como superficie propria no shell.

---

## Roadmap Operacional

### Prioridades imediatas

1. Fechar o `Desktop E2E` remoto no GitHub/Windows e manter o badge honesto.
2. Regenerar `release-readiness:promotion` em worktree limpo com os artefatos e QA corretos da propria rodada.
3. Revalidar MSI/portable sempre que onboarding, shell ou wizard mudarem.
4. Continuar o hardening do shell e do primeiro sucesso sem abrir frentes novas antes da hora.
5. Manter todas as superficies `Experimental` claramente fora da leitura de fechamento do MVP ate existir prova correspondente.

### Fora do MVP/Q2

- Docking livre completo como default
- Auto-updater final de producao
- Conversao ampla de gameplay para MUGEN
- Promocao institucional de adapters ainda sem prova suficiente
- Expansoes visuais que concorram com a estabilizacao do fluxo core

---

## Regra de Atualizacao

- Atualize este roadmap quando mudar o estado real de uma fase, superficie visivel ou importador.
- Nova superficie visivel no produto exige linha nova na `Matriz de Superficies` antes de qualquer claim de entrega.
- Novo importador no registry exige linha nova na `Matriz de Importadores` antes de qualquer claim de entrega.
- Um item nao pode continuar descrito como `planejamento` se o codigo o marcar como `importable: true`.
- Um item nao pode sair de `Experimental` sem evidencia institucional e sem alinhamento de UI, docs e backend.
- `README.md` nao deve manter claims de readiness mais especificas ou mais otimistas do que este arquivo.
