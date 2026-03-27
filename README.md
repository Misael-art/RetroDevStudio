# RetroDev Studio

> Plataforma desktop para desenvolvimento, preservacao e engenharia reversa de jogos 16-bit, com foco atual em Mega Drive e SNES.

![Status](https://img.shields.io/badge/Status-Beta_Tecnica_%2F_Hardening-orange.svg)
![Targets](https://img.shields.io/badge/Targets-Mega_Drive_%2B_SNES-blue.svg)
![Desktop](https://img.shields.io/badge/Desktop-Tauri_2-0ea5e9.svg)
![Pipeline](https://img.shields.io/badge/Pipeline-Build_%E2%86%92_ROM_%E2%86%92_Emulacao-green.svg)
![Licenca](https://img.shields.io/badge/Licenca-Proprietaria-red.svg)

---

## Estado Real

- Data de referencia: `2026-03-27`.
- Fase ativa real: `release candidate / beta testing do desktop Tauri`, com foco em hardening do fluxo canonico `Build -> ROM -> Emulacao`.
- O estado operacional canônico fica em [docs/06_AI_MEMORY_BANK.md](./docs/06_AI_MEMORY_BANK.md).
- Se este `README` divergir do estado real, prevalecem:
  `docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.

### O que esta certificado hoje

- Editor desktop com `Tauri + React + TypeScript + Rust`.
- Pipeline real por target para `Mega Drive` e `SNES`.
- Emulacao integrada via `Libretro`.
- Setup nativo sob demanda de `JDK`, `SGDK`, `PVSnesLib` e cores `Libretro` no Windows.
- Validacao oficial upstream em Windows via [scripts/validate-upstream-windows.ps1](./scripts/validate-upstream-windows.ps1).
- Smoke desktop local `Build -> ROM -> Run` via [scripts/e2e-tauri-build-run.mjs](./scripts/e2e-tauri-build-run.mjs).
- Baseline local restaurada neste host com:
  `check-tree`, `lint`, `tsc`, `vitest`, `cargo clippy` e `cargo test`.

### O que ainda esta em hardening

- O foco do projeto ainda nao e expansao de escopo; e consolidacao do caminho canonico e QA.
- O shell principal ja e forte, mas ainda nao e um sistema de docking livre no nivel de uma IDE madura.
- O build desktop local canonico via `scripts/build.mjs debug` / `npm run build:debug` voltou a passar neste host, usando o shadow target automatico previsto no proprio script e sem override manual de `beforeBuildCommand`.
- Ferramentas como `ArtStudio`, `RetroFX`, `Reverse Workspace`, `Asset Extractor` e `Memory Viewer` continuam visiveis, mas com status `Experimental` onde o backend e a certificacao ainda nao sustentam claim plena.

---

## O Produto Hoje

RetroDev Studio ja passou de prototipo. O produto esta em uma fase de `beta tecnica / hardening`, com provas reais de pipeline e validacao de host Windows para:

- criar/abrir projeto;
- editar cena e ativos;
- compilar ROM para Mega Drive ou SNES;
- carregar ROM no emulador integrado;
- validar o fluxo por smoke desktop e por upstream oficial.

O produto ainda nao deve ser descrito como engine plenamente pronta para producao comercial nem como substituto direto de Unity/GameMaker. A prioridade atual e consistencia, ergonomia e repetibilidade dos fluxos certificados.

---

## Fluxo Canonico

```text
Projeto (.rds / UGDM)
    -> editor desktop
    -> validacao por hardware profile
    -> build workspace por target
    -> ROM
    -> emulacao Libretro
```

### Targets atuais

- `megadrive` -> `SGDK`
- `snes` -> `PVSnesLib`

### Stack principal

| Camada | Tecnologia |
|--------|------------|
| Desktop | Tauri 2 |
| Frontend | React + TypeScript + Vite + TailwindCSS + Zustand |
| Backend | Rust |
| Emulacao | Libretro via FFI |
| Mega Drive SDK | SGDK |
| SNES SDK | PVSnesLib |
| Modelo de dados | UGDM JSON (`.rds`, `scenes/*.json`) |

---

## Superficies Visiveis

### Core ja integrado ao fluxo principal

- Editor de cena
- Hierarchy / Inspector
- Asset Browser
- Build & Run
- Game View com emulador integrado
- Setup nativo de dependencias externas
- Importacao externa sob escopo controlado

### Ainda marcadas como `Experimental`

- ArtStudio
- RetroFX
- Reverse Workspace
- Asset Extractor
- Memory Viewer
- Partes do NodeGraph fora do pipeline canonico consolidado

Essas superficies existem de verdade no produto, mas continuam com rotulo de maturidade controlado para nao prometer mais do que o fluxo atual entrega.

---

## Estrutura Essencial

```text
RetroDevStudio/
|-- README.md
|-- CLAUDE.md
|-- docs/
|-- scripts/
|-- src/
|-- src-tauri/
`-- toolchains/
```

O mapa detalhado de diretorios fica em [docs/08_TREE_ARCHITECTURE.md](./docs/08_TREE_ARCHITECTURE.md).

---

## Documentos De Verdade

- [docs/06_AI_MEMORY_BANK.md](./docs/06_AI_MEMORY_BANK.md): estado operacional real, proximo passo e memoria do projeto.
- [docs/03_ROADMAP_MVP.md](./docs/03_ROADMAP_MVP.md): fase vigente e escopo do produto.
- [docs/09_AGENT_DEV_MODE.md](./docs/09_AGENT_DEV_MODE.md): regras de processo, entrega e push.
- [docs/07_TEST_AND_COMPLIANCE.md](./docs/07_TEST_AND_COMPLIANCE.md): gates, compliance e validacao oficial.
- [docs/08_TREE_ARCHITECTURE.md](./docs/08_TREE_ARCHITECTURE.md): organizacao canonica de arquivos.

### Onboarding para agentes

1. Ler `docs/06_AI_MEMORY_BANK.md`.
2. Ler `docs/03_ROADMAP_MVP.md`.
3. Ler `docs/08_TREE_ARCHITECTURE.md`.
4. Ler `docs/09_AGENT_DEV_MODE.md` quando a tarefa tocar processo, CI, docs, estado ou governanca.
5. Responder com `[Contexto Carregado]` antes de propor mudanca relevante.

---

## Validacao Minima

Antes de declarar entrega relevante:

- `npm run check:tree`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cargo clippy -- -D warnings`
- `cargo test --lib -- --nocapture`

Quando a mudanca tocar `build`, `emulacao` ou `toolchains` reais no Windows, tambem:

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests`
- `node scripts/e2e-tauri-build-run.mjs --skip-build --native-driver .\toolchains\webdriver\msedgedriver.exe`

Sem esses gates, o status correto continua sendo `em hardening`.

---

## Compliance

- O projeto nao distribui ROM comercial.
- O usuario traz a propria ROM quando usar recursos de engenharia reversa.
- Modificacao de ROM comercial deve privilegiar `IPS` e `BPS`.
- `SGDK`, `PVSnesLib` e cores `Libretro` devem ser baixados do upstream oficial, sob demanda.
- Binarios de terceiros instalados em `toolchains/` nao devem ser versionados no Git.

Detalhes completos em [docs/07_TEST_AND_COMPLIANCE.md](./docs/07_TEST_AND_COMPLIANCE.md).
