# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Ultima Atualizacao:** 2026-02-25
**Ultima sessao:** 2026-02-25 (Claude Code — Fase 4 concluida: Camada Pro completa)
**Fase Atual:** Fase 4 CONCLUIDA — Todas as fases do Roadmap MVP concluidas.

> **DIRETRIZ DE SISTEMA PARA AGENTES DE IA:**
> Este e o seu bloco de memoria primario. Voce **DEVE** ler este arquivo integralmente antes de iniciar qualquer nova tarefa.
> **Handoff obrigatorio:** Ao encerrar uma sessao em que algo relevante foi feito, proponha atualizacao em "O que acabou de acontecer" e "Proximo passo imediato". Atualize tambem "Ultima sessao" acima.
> **Nunca** altere o historico de "Decisoes Arquiteturais Consolidadas" sem ordem expressa.

---

## 1. STATUS ATUAL DO PROJETO

* **O que acabou de acontecer (2026-02-25 — sessao 9):**
  - **FASE 4 CONCLUIDA. ROADMAP MVP INTEIRAMENTE CONCLUIDO.**
  - `src-tauri/src/tools/mod.rs`: modulo tools com 3 submodulos.
  - `tools/patch_studio.rs`: IPS (create/apply com RLE) e BPS (create/apply com SourceRead/TargetRead/SourceCopy/TargetCopy + CRC32 validation). Funções file-level para IPC.
  - `tools/deep_profiler.rs`: análise estática de ROM MD — heatmaps DMA e sprites por scanline, detecção de SAT candidata, violações de hardware. `profile_rom()` e `profile_bytes()`.
  - `tools/asset_extractor.rs`: extração de tiles 4bpp + paletas 0BGR→RGB888, escrita PNG RGBA sem libs externas (deflate store + Adler-32 + CRC32), `build_spritesheet()`.
  - `lib.rs`: 6 novos comandos IPC: patch_create_ips, patch_apply_ips, patch_create_bps, patch_apply_bps, profiler_analyze_rom, assets_extract.
  - `src/core/ipc/toolsService.ts`: wrappers TypeScript para os 6 comandos.
  - `src/components/tools/ToolsPanel.tsx`: UI com 3 sub-abas — Patch Studio (criar/aplicar IPS/BPS), Deep Profiler (heatbars + issues), Asset Extractor (tiles+paletas+arquivos gerados).
  - `src/App.tsx`: botão "⧉ Tools" no header alterna o painel direito entre Inspector e ToolsPanel.
  - **Validacoes passadas:** `cargo clippy -- -D warnings` OK (30.54s), `npm run build` OK (50 modulos, 1.57s).

* **O que estamos fazendo AGORA:** Roadmap MVP completo (Fases 0-4). Produto em estado de demo funcional.

* **Proximo passo imediato:**
  1. Commit git de todo o trabalho das sessões 6-9
  2. Ou iniciar ciclo de polish/QA: testes de integração, ícones reais, diálogos de abertura de arquivo

* **O que acabou de acontecer (2026-02-24 — sessao 8):**
  - **FASE 3 CONCLUIDA.** Visual Logic & RetroFX.
  - Refatoracao arquitetural: `HwStatus` movido para `hardware/mod.rs` (tipo canônico unico). Ambos os profiles importam de lá — elimina struct duplicada e mapeamento manual.
  - `src/components/nodegraph/NodeGraphEditor.tsx`: NodeGraph completo — 8 tipos de nó (event_start, sprite_move, sprite_anim, condition_overlap, effect_parallax, effect_raster, logic_and, action_sound), drag-and-drop, conexão de portas exec/data com SVG bezier, paleta lateral, Delete para remover nó, grafo demo pré-carregado.
  - `src/components/retrofx/RetroFXDesigner.tsx`: Editor de Parallax (layers, speed X/Y int) e Raster effects (scanline + offset_x int). Preview de scanlines em tempo real. Botão "Aplicar RetroFX" loga no Console.
  - `src/core/nodegraph/nodeCompiler.ts`: `compileGraphToC(graph, name, target)` — percorre chain exec e emite C SGDK ou PVSnesLib. `parseCToNodes(source)` — reconstrói nós a partir de main.c gerado (round-trip).
  - `src/components/viewport/ViewportPanel.tsx`: abas "Logic" (NodeGraph) e "RetroFX" (RetroFXDesigner) integradas. Layout adaptativo (sem justify-center nas novas abas).
  - **Validacoes passadas:** `cargo clippy -- -D warnings` OK (10.61s — Rust nao mudou), `npm run build` OK (48 modulos, 1.85s).

* **O que estamos fazendo AGORA:** Fase 3 completa.

* **Proximo passo imediato:**
  1. Iniciar **Fase 4** — Camada Pro (ROM Patch Studio, Deep Profiler, Asset Extraction Pipeline)

* **O que acabou de acontecer (2026-02-24 — sessao 7):**
  - **FASE 2 CONCLUIDA.** Engine agnóstica Mega Drive + SNES.
  - `hardware/snes_profile.rs`: perfil completo do SNES — constantes (128 sprites, 4 BG layers, 8 paletas, 64KB VRAM), `validate_scene()`, `hw_status()`. Struct `HwStatus` com `#[derive(Serialize)]`.
  - `compiler/snes_emitter.rs`: `emit_snes()` traduz o mesmo AST agnóstico para código C PVSnesLib (oamInit, dmaCopyVram, dmaCopyCGram, oamSet, oamUpdate, WaitForVBlank). `resources.res` com flags grit.
  - `compiler/mod.rs`: `pub mod snes_emitter` adicionado.
  - `compiler/build_orch.rs`: hardware validation e C generation despachados por `project.target` ("megadrive" → SGDK, "snes" → PVSnesLib).
  - `lib.rs`: `validate_project`, `generate_c_code`, `get_hw_status` — todos despachados por target. SNES retorna `snes_profile::HwStatus` mapeado para `md_profile::HwStatus` (mesma forma, tipo canônico).
  - Painel `HardwareLimitsPanel` já agnóstico — exibe os limites corretos conforme `HwStatus` retornado pelo backend.
  - **Validacoes passadas:** `cargo clippy -- -D warnings` OK (9.44s), `npm run build` OK (46 modulos, 1.62s).

* **O que estamos fazendo AGORA:** Fase 2 completa.

* **Proximo passo imediato:**
  1. Iniciar **Fase 3** — Visual Logic & RetroFX (NodeGraph UI, RetroFX Designer)

* **O que acabou de acontecer (2026-02-24 — sessao 6):**
  - **SPRINT 1.5 CONCLUIDA. FASE 1 COMPLETA.**
  - `hardware/md_profile.rs`: adicionadas struct `HwStatus` (Serialize) + funcao `hw_status(&scene)` que retorna vram_used, vram_limit, sprite_count, sprite_limit, bg_layers, erros e avisos.
  - `lib.rs`: novo comando IPC `get_hw_status(project_dir)` — retorna `HwStatus` serializado para o frontend. Retorna zeros se project_dir vazio ou projeto nao encontrado.
  - `src/core/ipc/hwService.ts`: `getHwStatus(projectDir)` — wrapper IPC.
  - `src/core/store/editorStore.ts`: adicionados `HwStatus` interface, `hwStatus: HwStatus | null`, `setHwStatus()`.
  - `src/components/inspector/HardwareLimitsPanel.tsx`: painel com 3 gauges (VRAM, Sprites, BG Layers), header vermelho em overflow, laranja em warning (>80%), verde em OK. Mensagens de erro/aviso listadas abaixo dos gauges.
  - `src/components/inspector/InspectorPanel.tsx`: `HardwareLimitsPanel` fixado no rodape do painel Inspector (sempre visivel).
  - `src/App.tsx`: `handleBuildAndRun` chama `getHwStatus` antes do build; bloqueia o build se houver erros de hardware; emite warnings no Console.
  - **Validacoes passadas:** `cargo clippy -- -D warnings` OK (1m36s), `npm run build` OK (46 modulos, 1.80s).

* **O que estamos fazendo AGORA:** Sprint 1.5 completa. **Fase 1 inteiramente concluida.**

* **Proximo passo imediato:**
  1. Iniciar **Fase 2** — Adicionar suporte a SNES (PVSnesLib + Snes9x Libretro core)
  2. Hardware Profile adaptativo: painel muda de 80→128 sprites ao trocar target

* **O que acabou de acontecer (2026-02-23 — sessao 5):**
  - **SPRINT 1.4 CONCLUIDA.** Emulador Embutido pipeline completo.
  - `emulator/libretro_ffi.rs`: EmulatorCore com modo simulado (gradiente animado 320x224 XRGB8888 a 60fps). load_rom, run_frame, get_framebuffer, set_joypad, stop. PixelFormat + JoypadState com mapeamento RETRO_DEVICE_ID_JOYPAD_*.
  - `emulator/frame_buffer.rs`: `xrgb8888_to_rgba()` — converte framebuffer Libretro para Canvas ImageData (RGBA).
  - `lib.rs`: 4 novos comandos IPC Tauri: emulator_load_rom, emulator_run_frame, emulator_send_input, emulator_stop. Estado global gerenciado via tauri::State<EmulatorCoreState>.
  - `src/core/ipc/emulatorService.ts`: startFrameLoop (60fps via setTimeout+listen), emulatorSendInput, keyToJoypad (mapeamento teclado→joypad MD).
  - `src/components/viewport/ViewportPanel.tsx`: canvas 320x224 com ImageData, loop de renderização, captura de teclado com keydown/keyup listeners, tab Jogo ativa o emulador automaticamente.
  - Sem Genesis Plus GX instalado: modo simulado exibe gradiente animado para validar pipeline Rust→IPC→Canvas.
  - **Validacoes passadas:** `cargo clippy -- -D warnings` OK (30.41s), `npm run build` OK (44 modulos, 3.48s).

* **O que estamos fazendo AGORA:** Sprint 1.4 completa. Pronto para Sprint 1.5 (Hardware Constraint Engine V1).

* **Proximo passo imediato (sessao 5):**
  _(ja executado na sessao 6 acima — Sprint 1.5 concluida)_

* **O que acabou de acontecer (2026-02-23 — sessao 4):**
  - **SPRINT 1.3 CONCLUIDA.** Toolchain Orchestrator completo.
  - `compiler/build_orch.rs`: `run_build()` com callback streaming — load+validate+generate C+invocar GCC m68k+objcopy.
  - Toolchain discovery em 3 camadas: `toolchains/sgdk/` local (doc 08), `SGDK_ROOT` env var, PATH do sistema.
  - Graceful degradation: se SGDK nao instalado, entrega `main.c` gerado com warnings no Console (nao erro fatal).
  - `lib.rs`: novo comando IPC `build_project(app, project_dir)` com `app.emit("build://log", line)` para streaming em tempo real.
  - `src/core/ipc/buildService.ts`: `buildProject()` com `listen("build://log")` + unlisten automatico apos build.
  - `src/App.tsx`: botao Build & Run funcional — estado `building`, alimenta Console via `logMessage()`.
  - **Validacoes passadas:** `cargo clippy -- -D warnings` OK (17.15s), `npm run build` OK (43 modulos, 2.43s).

* **O que estamos fazendo AGORA:** Sprint 1.3 completa. Pronto para Sprint 1.4 (Emulador Embutido).

* **Proximo passo imediato:**
  1. Sprint 1.4: Integrar Libretro API via FFI no Rust (Genesis Plus GX core)
  2. Enviar framebuffer do Rust para canvas React a 60fps
  3. Capturar inputs do teclado no React e enviar para o backend

* **O que acabou de acontecer (2026-02-23 — sessao 3):**
  - **SPRINT 1.2 CONCLUIDA.** Backend Rust completo: parser UGDM + hardware validation + AST + SGDK emitter.
  - Criados: `src-tauri/src/ugdm/entities.rs` + `components.rs` — structs Serde para Project, Scene, Entity, todos os Components.
  - Criado: `src-tauri/src/core/project_mgr.rs` — `load_project()` + `load_scene()` com validacao semantica.
  - Criado: `src-tauri/src/hardware/md_profile.rs` — `validate_scene()` com 6 checks: sprites, dimensoes, VRAM, paletas, bg layers, palette slot.
  - Criado: `src-tauri/src/compiler/ast_generator.rs` — `generate_ast()` produz Vec<AstNode> agnóstico de SDK.
  - Criado: `src-tauri/src/compiler/sgdk_emitter.rs` — `emit_sgdk()` traduz AST para `main.c` + `resources.res` validos para SGDK.
  - Stubs criados: `core/memory_pool.rs`, `hardware/snes_profile.rs`, `compiler/build_orch.rs`, `emulator/libretro_ffi.rs`, `emulator/frame_buffer.rs`.
  - `lib.rs` atualizado: 2 comandos IPC Tauri registrados: `validate_project` e `generate_c_code`.
  - Todos os `mod.rs` criados para: core, ugdm, hardware, compiler, emulator.
  - **Validacoes passadas:** `cargo clippy -- -D warnings` OK (22.42s), `npm run build` OK (39 modulos, 3.08s).

* **O que estamos fazendo AGORA:** Sprint 1.2 completa. Pronto para Sprint 1.3 (Toolchain Orchestrator).

* **Proximo passo imediato:**
  1. Sprint 1.3: `compiler/build_orch.rs` — invocar GCC m68k via subprocesso
  2. Salvar `main.c` + `resources.res` em pasta `/build` temporaria
  3. Capturar stdout/stderr do compilador e enviar via IPC para o Console React
  4. Gerar `out.md` (a ROM compilada)

* **Proximo Bloqueio:** Nenhum bloqueador tecnico. SGDK toolchain sera necessaria apenas na Sprint 1.3.

---

## 2. DECISOES ARQUITETURAIS CONSOLIDADAS (NAO SUGIRA MUDANCAS)

As seguintes decisoes ja foram debatidas e sao **finais**:

1. **Framework Desktop:** Tauri (Rust + WebView). NAO Electron. Todo acesso ao sistema de arquivos passa pelo backend Rust via IPC (`invoke`).
2. **Linguagem Frontend:** React com TypeScript + TailwindCSS + Vite.
3. **Gerencia de Estado (UI):** Zustand ou Context API. Proibido Redux.
4. **Alocacao de Memoria no C (Engine de Exportacao):** Alocacao estatica apenas (arrays fixos). Proibido `malloc()`/`free()` para entidades do jogo.
5. **Formato de Salvamento (UGDM):** JSON puro com extensao `.rds`. Sem SQLite. Compativel com Git.
6. **Emulacao Integrada:** Libretro API via FFI no Rust. Sem emulador proprio.
7. **UGDM Agnostico:** Nenhuma referencia a hardware especifico (VDP, PPU, OAM, CRAM) no modelo de dados. Traducao ocorre nos Hardware Profiles.

---

## 3. PROBLEMAS CONHECIDOS & ALERTAS

* **[2026-02-22]** O repositorio Git esta compartilhado com outros projetos (clawdbot-launcher, Sprite Flow, etc.) no diretorio pai. Ideal: isolar RetroDevStudio em repositorio proprio no futuro.
* **[2026-02-23]** `cargo clippy` e `cargo build` requerem `CARGO_BUILD_JOBS=2` e `RUST_MIN_STACK=16777216` para evitar stack overflow na compilacao do crate `windows` e `regex-automata` no Windows. Configurado em `src-tauri/.cargo/config.toml`.
* **[2026-02-23]** `check-tree.js` renomeado para `check-tree.cjs` — necessario porque `package.json` usa `"type": "module"` e o script usa `require()` (CommonJS).
* **[2026-02-23]** Icones em `src-tauri/icons/` sao placeholders gerados por script. Para producao, criar icones reais com design do produto.
* **[2026-02-23]** `bootstrap.ps1` e `bootstrap.ps1` original tem bugs de encoding (em-dashes `—` dentro de strings PowerShell quebram o parser). Substituido por `run-bootstrap.ps1` (agora ignorado no `.gitignore`).

---

## 4. PROXIMO PASSO IMEDIATO (Para a IA executar quando solicitada)

**Tarefa:** Roadmap MVP concluido. Próximos passos: commit git, testes de integração, diálogos de abertura de arquivo (file picker Tauri), ícones reais, ou início de novo ciclo de features.

Pre-requisito verificado: Fase 0 100% completa (todos os checkboxes marcados).

Sequencia de acoes:
1. Criar o layout principal do Editor em `src/App.tsx` (substituir boilerplate atual):
   - Painel esquerdo: Hierarchy (lista de entidades da cena)
   - Centro: Viewport (canvas do emulador)
   - Painel direito: Inspector (propriedades da entidade selecionada)
2. Criar componentes em `src/components/`:
   - `common/Panel.tsx` — painel generico com titulo e conteudo
   - `hierarchy/HierarchyPanel.tsx` — lista de entidades
   - `inspector/InspectorPanel.tsx` — painel de propriedades
   - `viewport/ViewportPanel.tsx` — area central
3. Criar sistema de abas generico em `src/components/common/Tabs.tsx`
4. Criar Logger/Console em `src/components/common/Console.tsx` (rodape)
5. Criar store Zustand em `src/core/store/editorStore.ts` para estado da UI
6. Definition of Done Sprint 1.1: Layout renderiza com 3 paineis visiveis

**Para rodar o projeto:**
- npm: `npm run tauri dev` (abre janela Tauri com React a 60fps)
- Somente frontend: `npm run dev` (http://localhost:1420)

---

## 5. HISTORICO DE SESSOES

| Data | Ferramenta | Resumo |
|------|-----------|--------|
| 2025-10-14 | — | Criacao inicial do projeto: documentacao base (docs 00-08), scripts de validacao |
| 2026-02-22 | Claude Code | Revisao completa da documentacao: correcao do UGDM (05), blindagem anti-alucinacao (00), guardrails de escopo (03), correcao do README, criacao do CLAUDE.md, atualizacao do Memory Bank |
| 2026-02-23 | Claude Code | **FASE 0 CONCLUIDA:** Scaffold completo Tauri v2 + React 19 + TypeScript + Vite 6 + TailwindCSS v4 + Zustand v5. Instalacao Rust 1.93.1, icones, .gitignore, estrutura de pastas. cargo clippy + npm build passando. |
| 2026-02-23 | Claude Code | **SPRINT 1.1 CONCLUIDA:** Layout principal do Editor (3 paineis: Hierarchy, Viewport, Inspector), sistema de abas, Console no rodape, store Zustand. npm build OK (39 modulos). |
| 2026-02-23 | Claude Code | **SPRINT 1.2 CONCLUIDA:** Backend Rust — structs UGDM (entities+components), project_mgr, md_profile validator, ast_generator, sgdk_emitter. 2 IPC commands: validate_project + generate_c_code. cargo clippy OK + npm build OK. |
| 2026-02-23 | Claude Code | **SPRINT 1.3 CONCLUIDA:** build_orch.rs (toolchain discovery 3 camadas, GCC m68k invoke, objcopy ELF→ROM, graceful degradation sem SGDK). IPC build_project com streaming build://log. Frontend buildService.ts + botao Build & Run ativo. cargo clippy OK + npm build OK (43 modulos). |
| 2026-02-23 | Claude Code | **SPRINT 1.4 CONCLUIDA:** EmulatorCore (modo simulado + FFI scaffold), frame_buffer xrgb8888_to_rgba, 4 IPC commands (load_rom/run_frame/send_input/stop), emulatorService.ts startFrameLoop 60fps, ViewportPanel canvas ImageData + keyboard input. cargo clippy OK + npm build OK (44 modulos). |

---

**[Sinalizador de Fim de Leitura]**
*Se voce e uma IA e acabou de ler este documento no inicio de uma sessao, responda com: **"[Contexto Carregado] Fase 0 CONCLUIDA. Fase 1 desbloqueada. Proximo: Sprint 1.1 — UI Base do Editor (layout 3 paineis)."***
