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
|-- build-test.bat
|-- eslint.config.mjs
|-- package.json
|-- vite.config.ts
|-- data/
|   |-- Blackheart_grande.gif
|   |-- Earthquake_large.png
|   |-- KenMasters_normal.png
|   |-- MegaMan_pequeno.png
|   |-- MetalSlug_Backgrounds.png
|   |-- template_registry.json
|   `-- ...
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
|   |-- 09_AGENT_DEV_MODE.md
|   `-- 10_QA_ROTEIRO_RC.md
|
|-- src/
|   |-- App.tsx
|   |-- main.tsx
|   |-- components/
|   |   |-- common/
|   |   |-- hierarchy/
|   |   |-- inspector/
|   |   |-- tools/
|   |   |-- artstudio/
|   |   |   |-- ArtStudioPanel.tsx
|   |   |   `-- useSpriteAnimator.ts
|   |   `-- viewport/
|   |-- core/
|   |   |-- ipc/
|   |   `-- store/
|   |-- test/
|   |   `-- setup.ts
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
|       |   |-- patch_studio.rs
|       |   |-- photo2sgdk.rs
|       |   `-- reverse_explorer.rs
|       `-- ugdm/
|           |-- components.rs
|           |-- entities.rs
|           `-- serde_helpers.rs
|
|-- scripts/
|   |-- bootstrap.ps1
|   |-- build.mjs
|   |-- check-tree.cjs
|   |-- check-tree.ps1
|   |-- create-icon-v2.mjs
|   |-- create-icon.mjs
|   |-- diagnose-desktop-e2e.ps1
|   |-- e2e-tauri-build-run.mjs
|   |-- release-readiness.mjs
|   |-- run-bootstrap.ps1
|   |-- run-cargo-msvc.cmd
|   |-- run-in-msvc.cmd
|   |-- setup-rust.ps1
|   `-- validate-upstream-windows.ps1
|
`-- toolchains/
    |-- sgdk/
    |-- pvsneslib/
    |-- webdriver/
    |   `-- msedgedriver.exe
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
- Drivers locais de validacao desktop, como `msedgedriver.exe`, devem ficar em `toolchains/webdriver/`, nunca soltos na raiz do repositorio.

---

## Regras Especificas do Estado Atual

- `src-tauri/src/tools/dependency_manager.rs` e a fonte canonica para detectar e instalar SGDK, PVSnesLib e cores Libretro.
- `src-tauri/src/compiler/build_orch.rs` e a fonte canonica do pipeline `UGDM -> workspace -> ROM`.
- `data/template_registry.json` e o catalogo canonico da galeria de templates do wizard; seeds externos apontam para donor paths locais do usuario e nao devem embutir ROMs, VGMs de terceiros ou artefatos de build no repositorio.
- ROMs, packs MUGEN/Ikemen, screenpacks e outros corpus locais de validacao devem permanecer fora da arvore versionada do repositorio. Quando necessarios para QA local, devem viver em diretorio externo BYOR e nunca ser tratados como fixture canonica do app.
- `prefabs/` e `graphs/` sao diretorios de projeto gerados dentro de cada workspace `.rds` do usuario; nao vivem na raiz do repositorio e devem continuar sendo tratados como dados do projeto, nao como modulos do app.
- Projetos SGDK externos podem conter um subdiretorio `rds/` (overlay) com `project.rds`, `scenes/`, `graphs/`, `prefabs/` e junctions NTFS para `assets/` e `build/`. O backend faz discovery de `project.rds` em subdiretorios de primeiro nivel quando nao encontra na raiz. Ver `docs/05_ARCHITECTURE_UGDM.md` secao 10.
- O caminho SNES real usa staging de asset no workspace e gera `hdr.asm`, `data.asm` e regras `gfx4snes`.
- `scripts/build.mjs` e o script canonico de compilacao: gera MSI, EXE Debug e EXE Portable. Uso: `node scripts/build.mjs <debug|msi|portable|all> [--open-dir]`. Scripts npm: `build:debug`, `build:debug:open`, `build:msi`, `build:msi:open`, `build:portable`, `build:portable:open`, `build:all`. O `build-test.bat` e um wrapper legado que chama `build.mjs debug`.
- `scripts/release-readiness.mjs` e o agregador canonico de readiness para promocao RC -> beta/producao: consolida baseline, artefatos, dirty worktree, reports de build/upstream e checklist manual em `src-tauri/target-test/validation/release-readiness.{json,md}`. Scripts npm: `release:readiness`, `release:readiness:baseline`.
- `scripts/run-in-msvc.cmd` e o wrapper canonico para executar comandos Node/npm em ambiente MSVC preparado no Windows institucional; usar junto de `build.mjs` quando o host exigir `vcvars64.bat`.
- `scripts/run-cargo-msvc.cmd` e o wrapper canonico para comandos `cargo` em ambiente MSVC preparado no Windows institucional.
- `scripts/e2e-tauri-build-run.mjs` e o runner canonico de regressao desktop/Tauri para `Build -> Load ROM -> Run frames`.
- `scripts/validate-upstream-windows.ps1` e o script canonico de validacao upstream real com SGDK, PVSnesLib e cores Libretro oficiais.
- `.github/workflows/desktop-e2e.yml` e o workflow canonico de regressao desktop em Windows e ja foi validado em runner GitHub real.
- `toolchains/libretro/cores/` e o local canonico dos DLLs de core baixados do upstream oficial.
- `toolchains/webdriver/msedgedriver.exe` e o local canonico do driver nativo usado pelo runner desktop/Tauri e pelos scripts de diagnostico locais.
- `tsconfig.tsbuildinfo`, `src-tauri/target-test/` e `src-tauri/target-sprint*/` sao artefatos gerados locais e nao fazem parte da arvore canonica versionada.
- `docs/09_AGENT_DEV_MODE.md` consolida a hierarquia de verdade, os gates e as regras anti-poluicao para agentes.
- `.github/workflows/ci.yml` e o baseline canonico de validacao automatizada do projeto e deve ser mantido verde em mudancas relevantes.
