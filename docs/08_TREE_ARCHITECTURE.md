# 08 - TREE ARCHITECTURE & DIRECTORY MAP
**Status:** Definitivo
**Objetivo:** Padronizar alocacao de arquivos para humanos e agentes de IA.

> Antes de criar modulo novo, confira esta arvore.
> Nao duplicar pastas. Frontend fica em `src/`. Backend fica em `src-tauri/src/`.

---

## Mapa Atual do Projeto

```text
RetroDevStudio/
|
|-- .github/
|   `-- workflows/
|       |-- ci.yml
|       `-- desktop-e2e.yml
|
|-- README.md
|-- CLAUDE.md
|-- eslint.config.mjs
|-- package.json
|-- vite.config.ts
|-- data/
|   |-- rom_teste.bin
|   `-- sonic_test.gen
|
|-- docs/
|   |-- 00_AI_DIRECTIVES.md
|   |-- 01_PRD_MASTER.md
|   |-- 02_TECH_STACK.md
|   |-- 03_ROADMAP_MVP.md
|   |-- 04_HARDWARE_SPECS.md
|   |-- 05_ARCHITECTURE_UGDM.md
|   |-- 06_AI_MEMORY_BANK.md
|   |-- 07_TEST_AND_COMPLIANCE.md
|   |-- 08_TREE_ARCHITECTURE.md
|   `-- 09_AGENT_DEV_MODE.md
|
|-- src/
|   |-- App.tsx
|   |-- main.tsx
|   |-- components/
|   |   |-- common/
|   |   |-- hierarchy/
|   |   |-- inspector/
|   |   |-- tools/
|   |   `-- viewport/
|   |-- core/
|   |   |-- ipc/
|   |   `-- store/
|   `-- views/
|
|-- src-tauri/
|   |-- Cargo.toml
|   |-- build.rs
|   |-- tauri.conf.json
|   |-- tests/
|   |   `-- fixtures/
|   |       `-- projects/
|   |           |-- megadrive_dummy/
|   |           `-- snes_dummy/
|   |               `-- assets/
|   |                   `-- sprites/
|   |                       `-- hero.ppm
|   `-- src/
|       |-- lib.rs
|       |-- main.rs
|       |-- compiler/
|       |   |-- ast_generator.rs
|       |   |-- build_orch.rs
|       |   |-- sgdk_emitter.rs
|       |   `-- snes_emitter.rs
|       |-- core/
|       |   `-- project_mgr.rs
|       |-- emulator/
|       |   |-- frame_buffer.rs
|       |   `-- libretro_ffi.rs
|       |-- hardware/
|       |   |-- md_profile.rs
|       |   `-- snes_profile.rs
|       |-- tools/
|       |   |-- asset_extractor.rs
|       |   |-- deep_profiler.rs
|       |   |-- dependency_manager.rs
|       |   `-- patch_studio.rs
|       `-- ugdm/
|           |-- components.rs
|           `-- entities.rs
|
|-- scripts/
|   |-- bootstrap.ps1
|   |-- check-tree.cjs
|   |-- e2e-tauri-build-run.mjs
|   `-- create-icon.mjs
|
`-- toolchains/
    |-- sgdk/
    |-- pvsneslib/
    `-- libretro/
        `-- cores/
```

---

## Regras de Insercao

- UI, layout, estado visual e componentes React vao para `src/`.
- Build, parse, validacao, emulacao, assets e filesystem vao para `src-tauri/src/`.
- IPC de frontend fica em `src/core/ipc/`.
- Fixtures backend ficam em `src-tauri/tests/fixtures/`.
- Dependencias de terceiros instaladas sob demanda vivem em `toolchains/` e nao devem ser versionadas no Git.

---

## Regras Especificas do Estado Atual

- `src-tauri/src/tools/dependency_manager.rs` e a fonte canonica para detectar e instalar SGDK, PVSnesLib e cores Libretro.
- `src-tauri/src/compiler/build_orch.rs` e a fonte canonica do pipeline `UGDM -> workspace -> ROM`.
- O caminho SNES real usa staging de asset no workspace e gera `hdr.asm`, `data.asm` e regras `gfx4snes`.
- `scripts/e2e-tauri-build-run.mjs` e o runner canonico de regressao desktop/Tauri para `Build -> Load ROM -> Run frames`.
- `.github/workflows/desktop-e2e.yml` e o workflow canonico de regressao desktop em Windows e ja foi validado em runner GitHub real.
- `toolchains/libretro/cores/` e o local canonico dos DLLs de core baixados do upstream oficial.
- `docs/09_AGENT_DEV_MODE.md` consolida a hierarquia de verdade, os gates e as regras anti-poluicao para agentes.
- `.github/workflows/ci.yml` e o baseline canonico de validacao automatizada do projeto e deve ser mantido verde em mudancas relevantes.
