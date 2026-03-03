# 02 - TECH STACK & ARQUITETURA DE SISTEMA
**Status:** Definitivo

> Nenhuma nova tecnologia entra no projeto sem refletir aqui.

---

## 1. Principios

1. Performance nativa no core, build e emulacao.
2. UI rica, mas desacoplada do backend.
3. Sem GC no loop principal do runtime/exporter.
4. O fluxo de build em runtime continua 100% Rust no app; scripts externos entram apenas como toolchains oficiais de terceiros.

---

## 2. Stack Definitiva

### Desktop / Frontend
- Tauri 2
- React
- TypeScript
- Vite
- TailwindCSS
- Zustand para estado de editor
- ESLint para lint estatico do frontend

### Backend / Core
- Rust
- IPC Tauri para toda operacao de filesystem, build e emulacao
- `serde` / `serde_json` para schema UGDM

### Emulacao
- Libretro API via FFI no Rust
- Cores oficiais consumidos como binarios externos
- Mega Drive: Genesis Plus GX ou Picodrive
- SNES: Snes9x ou bsnes

### Toolchains Alvo
- SGDK para Mega Drive
- PVSnesLib para SNES
- Instalacao sob demanda no Windows a partir do upstream oficial

### Crates de suporte aprovadas no backend
- `libloading` para carregar cores Libretro
- `reqwest` para baixar SDKs/cores oficiais sob demanda
- `zip` e `sevenz-rust2` para extrair pacotes oficiais
- `image` para staging/conversao de asset real no caminho SNES

### Ferramentas aprovadas de validacao e processo
- `scripts/check-tree.cjs` para validar a estrutura raiz
- `eslint` para lint do frontend
- `npx tsc --noEmit` para typecheck do frontend
- `cargo clippy -- -D warnings` para lint do backend Rust
- `cargo test --lib -- --nocapture` e `npm test` para suites automatizadas

---

## 3. Regras Rigidas

1. Nao usar Electron.
2. Nao usar Python no runtime do app para `scene -> ROM`.
3. Nao gerar codigo C por concatenacao espaguete fora de AST/emitter estruturado.
4. Dependencias de terceiros nao devem ser commitadas no repositorio.
5. SDKs e cores devem ser baixados apenas do upstream oficial e mediante consentimento do usuario.
6. No Windows, o caminho SNES deve detectar e preferir Git Bash/MSYS2 real; nao usar o shim `C:\Windows\System32\bash.exe`.
7. Nenhum gate novo entra no CI sem reproduzir localmente o comando e corrigir os erros reais expostos.

---

## 4. Fluxo Macro Atual

1. Usuario clica em `Build & Run`.
2. Frontend consulta status de dependencias externas.
3. Se faltar SGDK/PVSnesLib ou core Libretro, o app oferece instalacao sob demanda.
4. Backend Rust le UGDM e gera workspace por target.
5. Toolchain oficial compila a ROM.
6. Backend carrega a ROM no core Libretro real.
7. Framebuffer vai para o frontend.

---

## 5. Observacoes de Estado

- O projeto segue com `Libretro API via FFI no Rust` como decisao arquitetural consolidada.
- O caminho SNES atual suporta o exporter simples validado no hardware profile atual; metasprites e combinacoes mais amplas continuam fora do baseline atual.
- O gate restante do roadmap nao e arquitetura nova, e sim validacao externa com toolchains/cores oficiais.
- O baseline de validacao local/CI agora inclui estrutura, lint, typecheck, `cargo clippy`, testes frontend e testes Rust.
