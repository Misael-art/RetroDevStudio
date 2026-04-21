# 03 - ROADMAP MACRO & MVP TATICO

**Status:** Documento vivo
**Ultima revisao canonica:** 2026-04-21
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


| Eixo          | Valores                                             | Uso                                                           |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Escopo        | `Core MVP`, `Experimental`, `Fora do MVP/Q2`        | Diz se o item conta para o fechamento atual do produto ou nao |
| Implementacao | `Ausente`, `Parcial`, `Em codigo`                   | Diz se a capacidade existe no repositorio hoje                |
| Certificacao  | `Nenhuma`, `Local`, `Institucional`, `Em hardening` | Diz quanta prova real existe para o fluxo afetado             |


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
- `Desktop E2E` remoto ficou verde no GitHub/Windows em `2026-04-16` (runs #143/#144, commit `c1a7870`, todos os 16 cenarios confirmados no ledger).
- O gargalo principal agora e regenerar a fotografia institucional de promocao, fechar o gap de governanca com `origin/main` e revalidar MSI/portable.
- Superficies `Experimental` reais continuam visiveis, mas nao podem contaminar a leitura do fechamento do MVP.

---

## Bloqueadores Reais

- ~~`Desktop E2E` remoto ainda precisa ficar verde de forma repetivel no runner GitHub/Windows.~~ **Resolvido em 2026-04-16:** runs #143/#144 passaram com 16/16 cenarios.
- A fotografia institucional de promocao precisa ser regenerada em worktree limpo com snapshot fresco que inclua o `Desktop E2E` verde.
- MSI/portable precisam continuar sendo revalidados quando o fluxo `Menu inicial -> Criar Projeto` mudar.
- A trilha publica ainda precisa refletir o estado real da wave candidata; branch 191 commits a frente de `origin/main` continua sendo bloqueio de governanca.
- Readiness e onboarding publico devem ser sincronizados apos o merge para `main`.

---

## Fases

A coluna `Certificacao` usa exclusivamente o vocabulario travado deste roadmap:
`Nenhuma`, `Local`, `Institucional`, `Em hardening`.


| Fase                            | Certificacao  | Leitura objetiva                                                                          |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| Fase 0 - Fundacao               | Institucional | Base desktop e estrutura canonica consolidadas                                            |
| Fase 1 - Core Mega Drive        | Em hardening  | Build real, ROM real e emulacao real provados em Windows; hardening continua              |
| Fase 2 - SNES                   | Em hardening  | Pipeline oficial e emulacao oficial provados em Windows; hardening continua               |
| Fase 3 - Visual Logic & RetroFX | Local         | NodeGraph canonico e camada visual existem; superficies ainda heterogeneas                |
| Fase 4 - Camada Pro             | Local         | Patching, profiling, reverse e utilitarios existem, mas nem tudo e criterio de fechamento |
| Fase 5 - Release                | Em hardening  | Packaging, onboarding e readiness existem; falta repeticao institucional final            |


---

## Matriz de Superficies

A matriz abaixo espelha as superficies perceptiveis do shell atual em `src/App.tsx`, `src/components/viewport/ViewportPanel.tsx` e `src/components/tools/ToolsPanel.tsx`.
Capacidades nao visuais, importadores e itens legados continuam nas secoes proprias deste roadmap.


| Item                                   | Escopo       | Implementacao | Certificacao  | Evidencia atual                                                                                                                                                                            | Bloqueador para subir                                                                   | Conta para fechamento do MVP? |
| -------------------------------------- | ------------ | ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------- |
| Menu inicial / Criacao de projeto      | Core MVP     | Em codigo     | Em hardening  | Wizard endurecido, `manual-qa-status.json` A/F passed e packaging rebuildado em `2026-04-15`                                                                                               | Revalidar MSI/portable e rerodar `qa-rc` sempre que onboarding/wizard mudar             | Sim                           |
| Scene workspace                        | Core MVP     | Em codigo     | Em hardening  | `manual-qa-status.json` A-C/F passed; viewport editavel, pintura e persistencia reais                                                                                                      | Manter shell desktop, persistencia e `Desktop E2E` verdes apos mudancas sensiveis       | Sim                           |
| Hierarchy panel                        | Core MVP     | Em codigo     | Local         | Painel dedicado no shell, integracao real em `App.tsx` e cobertura em `HierarchyPanel.test.tsx`                                                                                            | Falta prova institucional dedicada alem da rodada geral do editor                       | Sim                           |
| Layer panel                            | Core MVP     | Em codigo     | Em hardening  | `manual-qa-status.json` A-B/F passed valida LayerPanel, visibilidade, renome e vinculacao                                                                                                  | Rerodar `qa-rc` sempre que fluxo de camadas mudar                                       | Sim                           |
| Inspector panel                        | Core MVP     | Em codigo     | Em hardening  | `manual-qa-status.json` E/F passed prova selecao, edicao de `Pos X` e persistencia no reopen                                                                                               | Repetir prova institucional apos mudancas de selecao/props                              | Sim                           |
| Game workspace / Build & Run           | Core MVP     | Em codigo     | Institucional | `manual-qa-status.json` D passed, `build-report.json` de `2026-04-15`, pipelines MD/SNES provados em Windows e `Desktop E2E` remoto verde em `2026-04-16` (runs #143/#144, 16/16 cenarios) | Rerodar readiness limpo e revalidar MSI/portable quando build/shell mudar               | Sim                           |
| Explorer workspace                     | Core MVP     | Em codigo     | Local         | Workspace real na rail, lazy-load no shell e cobertura em `ExplorerWorkspace.test.tsx`                                                                                                     | Falta prova institucional dedicada no fluxo de projeto                                  | Nao                           |
| Logic workspace / NodeGraph canonico   | Core MVP     | Em codigo     | Local         | `NodeGraphEditor.test.tsx`, `nodeCompiler.test.ts` e emissao SGDK/SNES reais                                                                                                               | Falta rodada institucional dedicada e refinamento continuo de UX do canvas              | Nao                           |
| ArtStudio workspace                    | Experimental | Em codigo     | Local         | `ArtStudioPanel.test.ts`, backend `photo2sgdk` e prova local de runtime em `build_orch.rs`                                                                                                 | Falta prova institucional `ArtStudio -> build -> runtime`                               | Nao                           |
| RetroFX workspace                      | Experimental | Em codigo     | Local         | `RetroFXDesigner.test.tsx`, persistencia em `scene JSON` e emissao MD/SNES provadas localmente                                                                                             | Falta prova institucional `RetroFX -> build -> runtime`                                 | Nao                           |
| Debug workspace (casca de ferramentas) | Core MVP     | Em codigo     | Local         | Workspace real na rail, alternancia `Tools/Inspector` no shell e cobertura base em `ToolsPanel.test.tsx`                                                                                   | Falta rodada institucional dedicada para a casca completa do workspace                  | Nao                           |
| Paleta Contextual                      | Core MVP     | Em codigo     | Local         | Aba real do `Debug workspace`, descoberta guiada em `App.test.tsx` e suporte a autoria contextual                                                                                          | Falta prova institucional dedicada de authoring pelo painel                             | Nao                           |
| Runtime Setup                          | Core MVP     | Em codigo     | Local         | Aba real do shell, `dependency_manager` ativo no Rust e testes de status/instalacao em `src-tauri/src/lib.rs`                                                                              | Falta rodada institucional dedicada em host Windows limpo apos alteracoes de toolchain  | Sim                           |
| Patch Studio                           | Core MVP     | Em codigo     | Local         | `patch_studio.rs` real e roundtrip BPS coberto em `src-tauri/src/lib.rs`                                                                                                                   | Falta prova institucional dedicada quando UI/export/apply mudar                         | Nao                           |
| Deep Profiler                          | Core MVP     | Em codigo     | Local         | `deep_profiler.rs` ativo, testes de profile e superficie visivel no `Debug workspace`                                                                                                      | Falta prova institucional dedicada em rodada de playtest/debug                          | Nao                           |
| Asset Browser                          | Experimental | Em codigo     | Em hardening  | `manual-qa-status.json` E passed instancia asset real e preserva selecao no Inspector; a UI ainda o marca como `experimental`                                                              | Alinhar UI/readiness/docs e repetir QA institucional sempre que o fluxo de assets mudar | Nao                           |
| Asset Extractor                        | Experimental | Em codigo     | Local         | Aba real do shell, IPC/backend existentes e cobertura base em `ToolsPanel.test.tsx`                                                                                                        | Falta prova ponta a ponta com ROM real e rodada institucional dedicada                  | Nao                           |
| Memory Viewer                          | Experimental | Em codigo     | Local         | Aba real do shell, leitura de memoria via IPC e cobertura base em `ToolsPanel.test.tsx`                                                                                                    | Falta prova institucional com emulador ativo e ROM real                                 | Nao                           |
| VRAM Viewer                            | Experimental | Em codigo     | Local         | Ferramenta real visivel no shell e integrada ao core ativo                                                                                                                                 | Falta rodada institucional dedicada com ROM/emulador reais                              | Nao                           |
| Reverse Workspace                      | Experimental | Em codigo     | Local         | Aba real do shell, lazy-load provado em `ToolsPanel.test.tsx` e backend de leitura/disassembly/anotacoes existente                                                                         | Falta certificacao de trace/projecao e UX tecnica final                                 | Nao                           |


---

## Matriz de Importadores


| Item             | Escopo         | Implementacao | Certificacao | Evidencia atual                                                                                                                                                                                                                         | Bloqueador para subir                                                                                                         | Conta para fechamento do MVP? |
| ---------------- | -------------- | ------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `sgdk`           | Experimental   | Em codigo     | Em hardening | Fase E provada: desktop E2E `qa-rc` A-G verde (import -> colisao -> persistir -> reabrir -> Build & Run -> ROM `SEGA` verificada). Preflight operacional, fixture `sgdk_e2e_donor` alinhada, smoke idempotente e cobertura de Fases B-E. **Rodada 11:** matriz de corpus real (`docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md`) com seis titulos SGDK 2.11 referenciados; gates do repo verdes em 2026-04-21; linhas por titulo ainda **Pendente** ate import manual titulo-a-titulo | Fase D parcial (heuristica sem AST); fechar as seis linhas da matriz de corpus com Passou/Parcial/Falhou + blocker; repeticao em CI para promocao | Nao                           |
| `mugen`          | Experimental   | Em codigo     | Local        | `import_mugen_project`, wizard dedicado e smoke idempotente em `smoke_import_mugen_project_is_idempotent`                                                                                                                               | Falta prova institucional alem da rodada local                                                                                | Nao                           |
| `ikemen_go`      | Experimental   | Em codigo     | Local        | Perfil proprio no registry, roteado pelo adapter MUGEN, smoke dedicado em `smoke_import_ikemen_go_reuses_mugen_adapter_without_losing_assets`                                                                                           | Falta evidencia institucional dedicada e validacao de metadata propria                                                        | Nao                           |
| `godot`          | Experimental   | Em codigo     | Local        | `import_godot_project`, smoke idempotente em `smoke_import_godot_project_is_idempotent`                                                                                                                                                 | Falta prova institucional alem da rodada local                                                                                | Nao                           |
| `construct`      | Experimental   | Em codigo     | Local        | Registry `importable: true`, `import_construct_project` e smoke idempotente em `smoke_import_construct_project_builds_scene_and_is_idempotent`                                                                                          | Falta prova institucional dedicada e QA manual com projetos Construct reais                                                   | Nao                           |
| `rpg_maker`      | Experimental   | Em codigo     | Local        | Registry `importable: true`, `import_rpg_maker_project` e smoke idempotente em `smoke_import_rpg_maker_project_builds_scene_and_is_idempotent`                                                                                          | Falta prova institucional dedicada e QA manual com projetos RPG Maker reais                                                   | Nao                           |
| `openbor`        | Experimental   | Em codigo     | Local        | Registry `importable: true`, `import_openbor_project` e smoke idempotente em `smoke_import_openbor_project_builds_scene_and_is_idempotent`                                                                                              | Falta prova institucional dedicada e QA manual com projetos OpenBOR reais                                                     | Nao                           |
| `gamemaker`      | Fora do MVP/Q2 | Parcial       | Nenhuma      | Registry com `support_status: Parcial`, ainda nao importavel                                                                                                                                                                            | Falta adapter canonico importavel e escopo aprovado                                                                           | Nao                           |
| `unity_2d`       | Fora do MVP/Q2 | Ausente       | Nenhuma      | Presente apenas como perfil nao suportado no registry                                                                                                                                                                                   | Falta adapter e escopo aprovado                                                                                               | Nao                           |
| `paper2d_bridge` | Fora do MVP/Q2 | Ausente       | Nenhuma      | Presente apenas como perfil nao suportado no registry                                                                                                                                                                                   | Falta adapter e escopo aprovado                                                                                               | Nao                           |


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

1. ~~Fechar o `Desktop E2E` remoto no GitHub/Windows e manter o badge honesto.~~ **Resolvido em 2026-04-16.**
2. Regenerar `release-readiness:promotion` em worktree limpo com os artefatos e QA corretos da propria rodada, incluindo o `Desktop E2E` verde.
3. Fechar o gap de governanca com `origin/main` (merge do branch `feat/desktop-e2e-workflow`).
4. Revalidar MSI/portable sempre que onboarding, shell ou wizard mudarem.
5. Continuar o hardening do shell e do primeiro sucesso sem abrir frentes novas antes da hora.
6. Manter todas as superficies `Experimental` claramente fora da leitura de fechamento do MVP ate existir prova correspondente.

### Fora do MVP/Q2

- Docking livre completo como default
- Auto-updater final de producao
- Conversao ampla de gameplay para MUGEN
- Promocao institucional de adapters ainda sem prova suficiente
- Expansoes visuais que concorram com a estabilizacao do fluxo core

---

## Iniciativa de Hardening de Importadores (Sessoes A-E)

**Contexto:** pedido operacional de `2026-04-18` para elevar os 7 importadores preservados (`sgdk`, `mugen`, `ikemen_go`, `godot`, `construct`, `rpg_maker`, `openbor`) de `Experimental` para `Completo e totalmente funcional resiliente a diferentes tipos de projetos`. Em vez de flipar labels, o trabalho foi segmentado em 5 sessoes com evidencia real a cada passo ? aderente a governanca deste roadmap (`Experimental nao significa inexistente; significa nao elegivel para claim plena`).

### Sessao A - Fundacao transversal (concluida em 2026-04-18)

Objetivo: estabelecer o minimo canonico para que qualquer importador possa ter evidencia institucional repetivel.


| Entrega                                                                                                                                                                                                                                | Status    | Evidencia                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| 7 fixtures minimas no arsenal de testes (`write_sgdk_fixture`, `write_mugen_fixture`, `write_godot_fixture`, `write_construct_fixture`, `write_rpg_maker_fixture`, `write_openbor_fixture` + compartilhamento do MUGEN para ikemen_go) | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests`         |
| 7 smoke tests de idempotencia (re-import nao duplica scenes/assets)                                                                                                                                                                    | Concluido | `smoke_import_`* (7 testes, todos verdes)               |
| Helper `count_files_in` para assertions de idempotencia                                                                                                                                                                                | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests`         |
| Correcao de 4 initializers faltando `cells` em `TilemapComponent`                                                                                                                                                                      | Concluido | `ast_generator.rs:2367`, `project_mgr.rs:949,1752,5877` |
| Normalizacao da coluna `Certificacao` em 4 valores canonicos                                                                                                                                                                           | Concluido | Este arquivo (Matriz de Superficies/Importadores)       |


**Gate local:** 262 cargo test --lib verdes (incluindo os 7 smoke novos), 232 vitest verdes, clippy clean, Vite build OK.
**Gate institucional:** adiado ? `tauri-driver` ausente no host; `cargo install tauri-driver --locked` continua como pre-requisito para `qa-rc`/`e2e-tauri-build-run`.

### Sessao B - Hardening por importador, camada 1 (concluida em 2026-04-18)

Objetivo: cobrir cenarios minimos de resiliencia por importador ? diretorio donor vazio, artefato-raiz ausente e leitura tolerante a BOM/CRLF/caminhos Unicode em host Windows.


| Entrega                                                                                                                                                | Status    | Evidencia                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------- |
| 7 testes `*_handles_empty_project_dir` (sgdk, mugen, ikemen_go via dispatcher, godot, construct, rpg_maker, openbor)                                   | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| 7 testes `*_handles_missing_root_artifact` (donor tem arquivos auxiliares mas falta manifesto/ponto-de-entrada canonico)                               | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| 4 testes `*_handles_lossy_text_or_unicode_paths` (godot, construct, rpg_maker, openbor) cobrem BOM UTF-8, CRLF e nomes Unicode NFC plausiveis em NTFS  | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| Helpers `list_project_artifact_files` + `assert_no_import_side_effects` provam que falha nao escreve em `scenes/` ou `assets/`                         | Concluido | `src-tauri/src/core/project_mgr.rs` mod `tests` |
| ikemen_go validado via `import_external_project("ikemen_go", ...)` preservando `profile.id == "ikemen_go"` e `source_engine == "ikemen_go"` apos falha | Concluido | `ikemen_go_handles_*_via_dispatcher`            |


**Gate local:** `cargo test --lib --test-threads=1` 287/0/3, `cargo clippy -- -D warnings` clean, 232 vitest verde, `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK.
**Escopo respeitado:** nenhum importador foi promovido; `support_status` do registry permanece `Experimental`/`Parcial` exatamente como estava. Non-UTF8 raw filename (nao-Windows) nao foi incluido nesta sessao por nao ser portavel em NTFS; fica opcional sob `#[cfg(unix)]` em futuras rodadas.

### Sessao C - Hardening por importador, camada 2 (pendente)

Objetivo: cobrir variantes reais de projetos encontradas no selvagem.

- `sgdk`: projeto com overlay parcial, projeto sem `rescomp.txt`, projeto multi-scene
- `mugen`/`ikemen_go`: charset `.def` com caracteres acentuados, stage com BG/ANIM multi-frame, DEF faltando assets
- `godot`: projetos Godot 3 (ausencia de `[gd_scene format=3]`), tscn com recursos binarios aninhados, project.godot mal formado
- `construct`: `.c3p` zipado vs `.c3proj` descompactado, plugins customizados nao-Sprite
- `rpg_maker`: MV vs MZ (`.rmmz` vs `.rpgproject`), tilesets com autotile, MapInfos encadeado
- `openbor`: levels com herdado `@import`, chars com frame-offset negativo, stages sem `music`

### Sessao D - Unificacao de `ImportReport` e degradacao graciosa (pendente)

Objetivo: remover assimetria entre `import_sgdk_project` (retorna `Scene` direto) e os demais (`ExternalImportReport`/`MugenImportReport`). Todos os importadores devem expor o mesmo contrato de `ImportReport { primary_scene, imported_scenes, skipped_sources, warnings }`.

- Refatorar `import_sgdk_project` para retornar `SgdkImportReport`
- Introduzir trait `ImportAdapter` com metodo unificado
- Promover `skipped_sources` a cidadao primeiro: cada skip precisa ser rastreavel com motivo (`ParseError`, `UnsupportedVariant`, `MissingAsset`)
- Adicionar log persistido por import em `<projeto>/.rds/import-log-<timestamp>.jsonl`

### Sessao E - QA institucional e promocao controlada (pendente)

Objetivo: transformar evidencia local em evidencia institucional, importador por importador.

- Criar `scripts/qa-import-<target>.ps1` por importador com projeto real anonimizado
- Rodar em host Windows limpo com `tauri-driver` instalado
- Atualizar `manual-qa-status.json` com resultado por importador
- Promover somente os importadores com prova institucional repetivel de `Experimental` para o proximo nivel
- Nunca flipar label sem evidencia correspondente

### Barra de promocao

Um importador **so** pode sair de `Experimental` para uma categoria superior (`Importador Completo`) quando satisfazer, em ordem:

1. Smoke tests canonicos (Sessao A)
2. Testes de resiliencia minima (Sessao B)
3. Testes de variantes reais (Sessao C)
4. `ImportReport` unificado e log persistido (Sessao D)
5. Evidencia institucional em host Windows limpo (Sessao E)

Saltar etapas e explicitamente proibido por governanca deste roadmap.

---

## Programa SGDK Real-World Import

**Contexto:** pedido operacional de `2026-04-18` para levar o importador SGDK de "gera recursos e cena base" para "materializa projeto canonico editavel, preserva rastreabilidade ao doador SGDK, recompila ROM funcional e permite evolucao visual/logica no editor". O programa e SGDK-first e **nao** faz round-trip textual do C legado: migra para o modelo canonico do RetroDevStudio.

Nenhum importador e promovido por esta frente; a barra de promocao continua sendo a "Barra de promocao" acima. O programa existe para encerrar, por classe de projeto, o gap entre importar e `recompilar ROM funcional editavel`.

### Referencias de classe (nao corpus obrigatorio de CI)

Os projetos usados como referencia entram apenas como classes, nao como fixtures promovidas:

- plataforma (estudo)
- platformer engine
- run and gun
- luta / engine
- shmup
- plataforma (extra)

### Matriz de compatibilidade SGDK por capacidade

Matriz de capacidades avaliada por classe de projeto, sem claim inflado.


| Capacidade                                                                                                     | Fase dona | Certificacao atual                   | Observacao                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descoberta de projeto (index de manifests/roots/recursos)                                                      | A         | Em codigo, Local                     | `scan_legacy_sgdk_project` + `find_sgdk_manifest_paths` existem                                                                                                                                                                                                                                                                                                                                          |
| Ingestao de assets (SPRITE/IMAGE/TILESET/MAP/WAV/XGM)                                                          | A         | Em codigo, Local                     | `import_sgdk_resources_into_scene` com idempotencia validada                                                                                                                                                                                                                                                                                                                                             |
| `SgdkImportReport` rico (primary_scene, imported_scenes, skipped_sources, warnings, fallbacks, source_summary) | A         | Em codigo, Local                     | Retorna relatorio estruturado e paridade com demais adapters                                                                                                                                                                                                                                                                                                                                             |
| Manifesto de import `.rds/imports/sgdk/*.json`                                                                 | A         | Em codigo, Local                     | Fingerprint do doador + mapeamento recurso->asset gravado                                                                                                                                                                                                                                                                                                                                                |
| Sintese de cenas (multiplas cenas / niveis)                                                                    | B         | Local (2026-04-18 rodada 4)          | Cada tilemap anchor IMAGE/TILESET/TILEMAP/MAP vira cena propria em `scenes/<slug>.json`; primaria mantem sprites+audio+camera em `scenes/main.json`                                                                                                                                                                                                                                                      |
| Tilemap real com `cells[]` a partir do doador                                                                  | B         | Local (2026-04-18 rodada 4)          | `extract_sgdk_tilemap_cells` faz dedupe 8x8 via HashMap<[u8;256], u32> com fallback explicito preservado quando PNG indisponivel/<8x8/totalmente transparente                                                                                                                                                                                                                                            |
| `SceneLayer` coerente (cenario, gameplay, HUD, parallax)                                                       | B         | Local (2026-04-18 rodada 4)          | `derive_sgdk_scene_layers` emite `layer_background` (tile, depth 0), `layer_gameplay` (sprite, depth 10), `layer_audio_objects` (object, depth 20, locked=true); HUD/parallax nao inventados                                                                                                                                                                                                             |
| Animacoes editaveis em `SpriteComponent.animations`                                                            | C         | Local (2026-04-19 rodada 5)          | `derive_sgdk_sprite_sheet_from_rescomp_png` materializa animacoes a partir da grelha rescomp (SGDK `bin/rescomp.txt` SPRITE); timer SGDK=0 gera aviso + fps=8 so para preview no editor; fallback explicito se PNG/parametros nao alinharem                                                                                                                                                              |
| Colisao canonica (`CollisionMap`)                                                                              | C         | Local (2026-04-19 rodada 5)          | `derive_sgdk_scene_collision_map_from_tile_cells`: solido onde indice de tile != 0 (indice 0 = tile totalmente transparente do dedupe 8x8); mensagem rastreavel no report/ledger; cenas secundarias com cells recebem o mesmo                                                                                                                                                                            |
| Logica importavel (`graph_ref` + `logic_hints` + `external_source_ref`)                                        | D         | Parcial, Local (2026-04-19 rodada 8) | Rodada 7 + `phase_d.cross_unit_function_refs` / `entity_spr_local_signal_hits`; stencil shmup/run-and-gun em secundario quando SPR_* + identificador do recurso na mesma linha; `deserializeNodeGraph` alinha portos ao editor e filtra arestas quebradas; testes `sgdk_phase_d_platformer_horizontal_scan_fixture_class`, `sgdk_phase_d_resolve_prefabs_hydrates_secondary_graph_ref`; sem AST completo |
| Build funcional (import -> salvar -> reabrir -> ROM funcional) | E | Local (2026-04-21 rodada 10) | Preflight verde no host; `qa-rc` A-G reprovado e recuperado no mesmo host; fix canonico no runner para forcar build debug via Tauri CLI em `qa-rc` (evita bootstrap `localhost` do direct-cargo); cadeia SGDK confirmada com evidencias (`manual-qa-status.json` + screenshot bloco G). Sem promocao institucional e sem mudar `support_status` |
| Reimport controlado / idempotente                                                                              | A         | Em codigo, Local                     | Smoke idempotente cobre assets/scene; manifesto agora cobre ledger                                                                                                                                                                                                                                                                                                                                       |

### Rodada 11 - Corpus real SGDK (matriz por titulo)

Checklist operacional para sair de fixture/E2E controlado e registrar compatibilidade por projeto real (import -> report/ledger -> cenas -> tilemaps -> animacoes -> collision map -> `graph_ref` -> salvar/reabrir -> build/ROM), com resultado **Passou** / **Parcial** / **Falhou** e blocker concreto.

- **Documento vivo:** `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (seis pastas sob `F:\Projects\MegaDrive_DEV\SGDK_Engines`, existencia verificada no host desta rodada).
- **Gates do repositorio (2026-04-21 neste host):** `check:tree`, `lint`, `tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `npm run preflight:sgdk-e2e`, `npm run test:e2e:desktop:qa-rc` - todos verdes na mesma sessao.
- **Estado honesto:** SGDK permanece **Experimental**; a matriz por titulo esta criada, mas as linhas de resultado por jogo continuam **Pendente** ate execucao manual (ou automacao dedicada) titulo a titulo. Nenhuma promocao de `support_status`.


### Fases

- **Fase A - Importador estrutural.** Projeto SGDK grande abre sem colapsar em cena opaca; gera manifesto `.rds/imports/sgdk/*.json`; reimport idempotente e auditavel; `SgdkImportReport` rico.
- **Fase B - Cena e assets. (concluida em 2026-04-18 rodada 4.)** Tilemaps relevantes viram `cells[]` (dedupe 8x8, indices 1-based, fallback explicito preservado quando reconstrucao impossivel); multiplas cenas e `SceneLayer` coerentes aparecem na Hierarchy via `listScenes`/`switchScene` (sem mudanca de frontend). Evidencia: inventario `scenes[]` por role no ledger SGDK (introduzido como `sgdk-import/v2` na rodada 4; o repo hoje persiste `sgdk-import/v4` como superset retrocompativel com `phase_c` + `phase_d`); `SgdkImportReport` ganhou `primary_scene_path` + `additional_scenes`; +6 testes Fase B (`sgdk_phase_b_import_populates_tilemap_cells_from_png`, `*_builds_multi_scene_when_multiple_tilemap_anchors_exist`, `*_derives_scene_layers_grouping_entities_coherently`, `*_keeps_explicit_fallback_when_tilemap_source_is_too_small`, `*_ledger_persists_scene_inventory_and_bumps_schema_version`, `*_reimport_multi_scene_is_idempotent_and_does_not_duplicate_scene_files`); teste existente `*_exposes_rich_fields_and_persists_ledger` reescrito para assertar ausencia do fallback "cells[] vazio" quando PNG permite reconstrucao. Gates locais da rodada 4: `cargo test --lib` 295/0/3 (+8), `cargo clippy -- -D warnings` clean, 232 vitest, check:tree/lint/tsc OK. SGDK continua `Experimental`; promocao continua bloqueada por Fases C+D+E.
- **Fase C - Animacao e colisao. (concluida no caminho canonico + fixtures em 2026-04-19 rodada 5.)** `SpriteComponent.animations` derivados da folha PNG alinhada ao SPRITE rescomp; `CollisionMap` na `Scene` quando `cells[]` existe; ledger `sgdk-import/v4` inclui bloco `phase_c`; reimport idempotente coberto (`sgdk_phase_c_reimport_preserves_sprite_animations_and_collision_map`). Barra (classe real plataforma+luta) continua em QA manual fora do CI.
- **Fase D - Logica jogavel. (parcial; hardening multi-ficheiro + auditoria TU em 2026-04-19 rodada 8.)** Rodada 7 + evidencia `func(` entre ficheiros escaneados (`cross_unit_function_refs`) e toques SPR locais por recurso (`entity_spr_local_signal_hits`); materializacao de classe alta tambem em sprite secundario quando ha prova textual SPR+identificador; editor hidrata `graph_ref` com portos canonicos; testes `sgdk_phase_d_platformer_horizontal_scan_fixture_class`, `sgdk_phase_d_resolve_prefabs_hydrates_secondary_graph_ref` e multificheiro RG estendido; sem AST completo.
- **Fase E - Build funcional. (provada localmente no host em 2026-04-21 rodada 10.)** Preflight explicito de `toolchains/sgdk`, `tauri-driver` e msedgedriver segue ativo; `qa-rc` A-G foi reprovado e recuperado no host real, com correcao canonica no runner para forcar build debug via Tauri CLI no cenario `qa-rc` (evita bootstrap `localhost` observado com direct-cargo). Mantem-se sem claim institucional: exige repeticao em host limpo/CI e SGDK segue `Experimental`.

### Gates por rodada

Adicionais aos gates gerais deste roadmap, aplicados sempre que o programa avancar:

- `npm run check:tree`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- `npm run preflight:sgdk-e2e`
- `npm run test:e2e:desktop:qa-rc`

### Nao confundir

- Esta frente **nao** e reescrita textual do C doador; o objetivo e migrar para o modelo canonico.
- Compatibilidade "totalmente funcional" se obtem por classe de projeto, nao em um salto unico.
- Os seis titulos do corpus real estao na matriz `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md`; o CI continua protegido por fixtures minimas e smoke ate a matriz fechar com **Passou** repetivel por titulo.

---

## Regra de Atualizacao

- Atualize este roadmap quando mudar o estado real de uma fase, superficie visivel ou importador.
- Nova superficie visivel no produto exige linha nova na `Matriz de Superficies` antes de qualquer claim de entrega.
- Novo importador no registry exige linha nova na `Matriz de Importadores` antes de qualquer claim de entrega.
- Um item nao pode continuar descrito como `planejamento` se o codigo o marcar como `importable: true`.
- Um item nao pode sair de `Experimental` sem evidencia institucional e sem alinhamento de UI, docs e backend.
- `README.md` nao deve manter claims de readiness mais especificas ou mais otimistas do que este arquivo.

