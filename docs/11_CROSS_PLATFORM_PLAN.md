# 11 - PLANO DE ADAPTACAO CROSS-PLATFORM (Linux + Windows)
**Status:** Fases 1 e 2 entregues no host Linux; Fase 3 pendente de toolchains oficiais nativas
**Data de registro:** 2026-06-30
**Ultima atualizacao:** 2026-07-04
**Contexto:** O projeto foi construido para Windows. Este host e Linux (BigLinux/Manjaro).
**Objetivo:** Poder desenvolver e validar em ambos os sistemas operacionais.

---

## Diagnostico Resumido

### Bloqueadores Imediatos no Linux

**Atualizacao 2026-07-04:** B1-B3 foram fechados no checkout Linux. O baseline local passou com `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` e `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1`. A validacao upstream real permanece bloqueada por dependencias nativas ausentes no host (`m68k-elf-gcc`, `tauri-driver`, WebDriver Linux e core Libretro `.so`).

| # | Bloqueador | Arquivo | Causa |
|---|-----------|---------|-------|
| B1 | `npm test` quebra | `node_modules` | `@rollup/rollup-win32-x64-gnu` instalado no lugar de `linux-x64-gnu` |
| B2 | `cargo check` quebra | `src-tauri/icons/32x32.png` | Icone nao e RGBA (exigencia Tauri Linux) |
| B3 | `tauri dev/build` quebra | `src-tauri/tauri.conf.json` | `beforeDevCommand: "cmd /c npm..."` — `cmd` inexistente no Linux |
| B4 | `cargo test` timeout | `src-tauri/` | Primeira compilacao Rust lenta (esperado) |

### Dependências Existentes (Windows-only)

| Dependencia | Caminho | Arquivos |
|-------------|---------|----------|
| SGDK 2.11 | `toolchains/sgdk/bin/` | `gcc.exe`, `make.exe`, `sjasm.exe`, JARs Java |
| PVSnesLib | `toolchains/pvsneslib/devkitsnes/bin/` | `816-tcc.exe`, `wla-65816.exe`, `wlalink.exe`, `gfx4snes.exe` |
| Libretro cores | `toolchains/libretro/cores/` | `bsnes_libretro.dll`, `genesis_plus_gx_libretro.dll`, etc. |
| WebDriver | `toolchains/webdriver/` | `msedgedriver.exe` |
| JDK | `toolchains/jdk/` | JDK Windows |

### Scripts com logica Windows

| Script | Problema |
|--------|----------|
| `scripts/build.mjs` | Caminhos `.exe`/`.dll` fixos, `loadLibraryProbe` Windows-only |
| `scripts/e2e-tauri-build-run.mjs` | Caminhos `.exe` fixos, `msedgedriver` hardcoded |
| `scripts/sgdk-e2e-host-preflight.mjs` | Verifica `gcc.exe`, `msedgedriver.exe` fixos |
| `scripts/bootstrap.ps1` | 100% Windows (winget, vswhere, registro) |
| `scripts/validate-upstream-windows.ps1` | 100% Windows (PowerShell, MSVC, taskkill) |
| `scripts/run-cargo-msvc.cmd` | Wrapper MSVC, desnecessario no Linux |

### Codigo Rust com suporte cross-platform parcial

| Arquivo | Status |
|---------|--------|
| `emulator/libretro_ffi.rs` | **OK** — `core_library_extension()` retorna `.so`/`.dll`/`.dylib` conforme SO |
| `compiler/build_orch.rs` | **Quase OK** — `platform_make_name()`, `platform_java_name()`, `find_in_path()` corretos; `detect_bash_program()` quebra (usa `where`) |
| `tools/dependency_manager.rs` | **Parcial** — downloads sempre buscam Windows; `detect_bash_program()` quebra; `auto_install_supported()` retorna `false` fora Windows |
| `core/project_mgr.rs` | **OK** — `ReplaceFileW` vs `fs::rename` com `cfg!` |
| `tools/reverse/` | Nao verificado (nao toca toolchain) |

---

## Fases de Implementacao

### Fase 1 — Destravar host Linux (prioridade maxima)

**Objetivo:** Conseguir rodar `npm test`, `cargo check --lib`, `npm run lint`, `npx tsc --noEmit` no Linux.
**Status:** Concluida no checkout Linux.

| Passo | Acao | Arquivos afetados | Validacao |
|-------|------|-------------------|-----------|
| 1.1 | Reinstalar node_modules para Linux | `node_modules/`, `package-lock.json` | `npm test` passa |
| 1.2 | Corrigir icones Tauri (RGBA) | `src-tauri/icons/32x32.png`, `128x128.png`, `128x128@2x.png` | `cargo check --lib` passa |
| 1.3 | Corrigir `tauri.conf.json` (remover `cmd /c`) | `src-tauri/tauri.conf.json` | `cargo check --lib` passa; `npm run tauri dev` funciona |

**1.1** Detalhes:
```bash
rm -rf node_modules package-lock.json
npm install
```
Se `@rollup/rollup-linux-x64-gnu` continuar ausente:
```bash
npm install @rollup/rollup-linux-x64-gnu --save-optional
```

**1.2** Detalhes:
```bash
# Verificar formato atual
identify src-tauri/icons/32x32.png
# Converter se nao for RGBA
convert src-tauri/icons/32x32.png -type TrueColorAlpha src-tauri/icons/32x32.png
# Ou usar script existente
node scripts/create-icon.mjs
```

**1.3** Detalhes:
- `tauri.conf.json` linha 7: `"beforeDevCommand": "npm run dev"` (remover `cmd /c`)
- `tauri.conf.json` linha 8: `"beforeBuildCommand": "npm run build"` (remover `cmd /c`)
- `tauri.conf.json` bundle targets: adicionar `"deb"` e/ou `"appimage"` ao lado de `"msi"` (opcional)

---

### Fase 2 — Scripts Node cross-platform

**Objetivo:** `build.mjs`, `e2e-tauri-build-run.mjs`, `sgdk-e2e-host-preflight.mjs` funcionarem em ambos OS.
**Status:** Concluida para resolucao host-aware e scripts Linux de diagnostico/validacao. A execucao upstream real depende da Fase 3.

| Passo | Arquivo | Mudanca |
|-------|---------|---------|
| 2.1 | `scripts/build.mjs` | `resolveExecutable()`: usar `pathExtensions()` em vez de `.exe` fixo |
| 2.2 | `scripts/build.mjs` | `runtimeFilesForProfile()`: adicionar ELF (sem extensao) e `.so` |
| 2.3 | `scripts/build.mjs` | `loadLibraryProbe()`: stub Linux seguro (ja tem guarda) |
| 2.4 | `scripts/e2e-tauri-build-run.mjs` | Caminhos `.exe` fixos → resolucao dinamica |
| 2.5 | `scripts/e2e-tauri-build-run.mjs` | WebDriver: aceitar `chromedriver` como fallback |
| 2.6 | `scripts/sgdk-e2e-host-preflight.mjs` | `gcc.exe` → `gcc` tambem; `msedgedriver.exe` → sem extensao tambem |
| 2.7 | `scripts/validate-upstream-windows.ps1` | `scripts/validate-upstream-linux.sh` criado com report JSON, blockers estruturados e sem instalacao automatica de pacotes de sistema |
| 2.8 | `scripts/bootstrap.ps1` | `scripts/bootstrap.sh` criado para checkout Linux existente, diagnostico, npm install opcional, baseline opcional e validacao upstream opcional |

**Evidencia adicionada:** `scripts/sgdk-e2e-host-preflight.test.mjs`, `scripts/build-environment.test.mjs` e `scripts/linux-host-scripts.test.mjs` cobrem rejeicao de binarios Windows-only no Linux, resolucao de executaveis nativos, scripts Bash e report `rds-linux-upstream-validation/v1`.

---

### Fase 3 — Toolchains Linux

**Objetivo:** SGDK, PVSnesLib, Libretro cores e WebDriver funcionando nativamente no Linux.
**Status:** Parcialmente concluida (2026-07-05). `m68k-elf-gcc` 16.1.0 (AUR) e `genesis_plus_gx_libretro.so` (buildbot) instalados no host Linux; build SGDK duplo reproduzivel provado 5/5 com esse gcc (debug/`libmd_debug.a`; release `libmd.a` e LTO-13, incompativel). Pendente: `sjasm`/`sjasmplus` (Z80), tools nativos SGDK (`convsym`, `padROM`, `bintos`, `mac68k`), PVSnesLib Linux, WebDriver Linux. As demais linhas seguem requerendo instalacao manual/provisionamento.

| Passo | Toolchain | Acao |
|-------|-----------|------|
| 3.1 | SGDK cross-compiler | `sudo pacman -S m68k-elf-gcc` (ou `gcc-m68k-elf` no apt) |
| 3.2 | SGDK Z80 assembler | `sudo pacman -S sjasmplus` (ou compilar do fonte) |
| 3.3 | SGDK Java | `sudo pacman -S jre-openjdk` |
| 3.4 | SGDK extras | Compilar `mac68k`, `convsym`, `bintos` do fonte SGDK para ELF |
| 3.5 | PVSnesLib 65816 | `sudo pacman -S wla-dx` (fornece `wla-65816`, `wlalink`) |
| 3.6 | PVSnesLib tools | Compilar `gfx4snes`, `smconv`, `snesbrr` do fonte |
| 3.7 | Libretro cores | Baixar `.so` do buildbot oficial para Linux |
| 3.8 | WebDriver | `sudo pacman -S chromedriver` ou baixar `msedgedriver` Linux |
| 3.9 | Make | `sudo pacman -S make` (ja instalado) |

**Nota:** O `toolchains/sgdk/common.mk` ja tem branch Linux (linhas 28-46):
```makefile
PREFIX ?= m68k-elf-
SHELL := sh
RM := rm
CP := cp
CC := $(PREFIX)gcc
```
Basta ter `m68k-elf-gcc` no PATH e Java Runtime.

---

### Fase 4 — Rust cross-platform

**Objetivo:** `dependency_manager.rs` baixar toolchains corretas para cada SO.

| Passo | Arquivo | Mudanca |
|-------|---------|---------|
| 4.1 | `tools/dependency_manager.rs` | `detect_bash_program()`: trocar `where` por `which` no Linux |
| 4.2 | `tools/dependency_manager.rs` | URLs de download: bifurcar entre Windows `.dll`/`.zip` e Linux `.so`/`.tar.gz` |
| 4.3 | `tools/dependency_manager.rs` | `auto_install_supported()`: estender para Linux (opcional, pode virar config) |
| 4.4 | `tools/dependency_manager.rs` | `fetch_latest_temurin_lts_package()`: `os=linux` no Linux |

---

### Fase 5 — CI/CD (GitHub Actions)

**Objetivo:** Validar ambos OS no CI.

| Passo | Workflow | Mudanca |
|-------|----------|---------|
| 5.1 | `.github/workflows/ci.yml` | Adicionar job `linux-validate` com `runs-on: ubuntu-latest` |
| 5.2 | `.github/workflows/desktop-e2e.yml` | Adicionar job `linux-desktop-smoke` (quando houver WebDriver Linux configurado) |

**5.1** Job Linux minimo:
```yaml
linux-validate:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '26' }
    - uses: actions-rust-lang/setup-rust-toolchain@v1
    - run: npm ci
    - run: npm run check:tree
    - run: npm run lint
    - run: npx tsc --noEmit
    - run: npm test
    - run: cargo clippy --lib -- -D warnings
    - run: cargo test --lib -- --nocapture --test-threads=1
```

---

### Fase 6 — Merge da branch atual

**Objetivo:** Fechar o ciclo W7.4/W7.5 (Cross-Core Parity + Cycle Report).

| Passo | Acao |
|-------|------|
| 6.1 | `git add` seletivo ou `git commit -a` com mensagem adequada |
| 6.2 | `git push origin codex/w7-4-blastem-parity` |
| 6.3 | Abrir PR no GitHub de `codex/w7-4-blastem-parity` para `main` |
| 6.4 | Acompanhar checks remotos (Windows CI) |
| 6.5 | Apos merge, `npm run release:readiness:promotion` em `main` |

---

### Fase 7 — Documentacao

| Passo | Arquivo | Mudanca |
|-------|---------|---------|
| 7.1 | `docs/02_TECH_STACK.md` | Adicionar Linux como plataforma suportada |
| 7.2 | `docs/07_TEST_AND_COMPLIANCE.md` | Adicionar gates Linux |
| 7.3 | `docs/08_TREE_ARCHITECTURE.md` | Adicionar `scripts/validate-upstream-linux.sh`, `scripts/bootstrap.sh` |
| 7.4 | `docs/06_AI_MEMORY_BANK.md` | Registrar esta fase de adaptacao |
| 7.5 | `AGENTS.md` | Atualizar comandos uteis para Linux |

---

## Comandos Uteis para Validacao no Linux

```bash
# Gates minimos
npm run check:tree
npm run lint
npx tsc --noEmit
npm test
cargo clippy --lib --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --lib --manifest-path src-tauri/Cargo.toml -- --nocapture --test-threads=1

# Build
npm run build:debug    # apos corrigir tauri.conf.json e icones

# Preflight (apos Fase 2.6)
node scripts/sgdk-e2e-host-preflight.mjs

# Bootstrap Linux seguro (nao instala pacotes de sistema)
bash scripts/bootstrap.sh --diagnostics-only
bash scripts/bootstrap.sh --skip-npm-ci --run-upstream-validation

# Validacao upstream Linux com report estruturado
bash scripts/validate-upstream-linux.sh --skip-rust-tests --json
```

---

## Riscos Conhecidos

1. **SGDK makefile.gen + common.mk**: O branch Linux do `common.mk` espera `m68k-elf-gcc`, `sjasm`, `mac68k`, `convsym`, `bintos` como ELFs nativos no PATH. Se esses binarios nao existirem, o build SGDK falha.
2. **PVSnesLib Linux**: O mantenedor oficial nao distribui binarios Linux. Necessario compilar do fonte ou usar alternativa (`wla-dx` + scripts proprios).
3. **Tauri bundle no Linux**: `npm run build:msi` nao funciona (MSI e Windows-only). Criar alias `build:linux` para `deb`/`appimage`.
4. **Desktop E2E no Linux**: `msedgedriver` para Linux existe, mas o teste E2E pode precisar de `chromedriver` ou configuracao adicional de display (Xvfb).
5. **Node 26.2.0**: Versao muito recente; pode haver incompatibilidade com algumas dependencias. `npm install` pode precisar de `--legacy-peer-deps`.
