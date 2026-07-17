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
- Tauri JS API `2.11.0`, CLI `2.11.2` e dialog plugin `2.7.1`, fixados no lock npm
- React
- TypeScript
- Vite
- TailwindCSS
- Zustand para estado de editor
- react-resizable-panels para layout redimensionavel (docking/splitters)
- ESLint para lint estatico do frontend

### Backend / Core
- Rust `1.97.0`
- Tauri Rust `2.11.5`, build `2.6.3`, opener `2.5.4` e dialog `2.7.1`, fixados no Cargo lock
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
- Provisionamento bloqueado pelo manifesto comum em Windows e Linux a partir do upstream oficial

### Crates de suporte aprovadas no backend
- `base64` para codificacao de imagens processadas (Photo2SGDK)
- `libloading` para carregar cores Libretro
- `sevenz-rust2` para leitura de corpus/projetos compactados; downloads e extracao de toolchains pertencem exclusivamente ao host-manager, nao ao runtime Rust
- `image` para staging/conversao de asset real no caminho SNES e processamento Photo2SGDK (quantizacao, palette snapping Mega Drive)

### Ferramentas aprovadas de validacao e processo
- `scripts/check-tree.cjs` para validar a estrutura raiz
- `eslint` para lint do frontend
- `npx tsc --noEmit` para typecheck do frontend
- `cargo clippy -- -D warnings` para lint do backend Rust
- `cargo-audit 0.22.2` como auditor de desenvolvimento/CI, sem entrar no runtime
- `cargo test --lib -- --nocapture` e `npm test` para suites automatizadas

### Ambiente de desenvolvimento reproduzivel

- Node.js `24.18.0` LTS e npm `11.16.0`, fixados por `.node-version`, `package.json` e lock do host.
- Rust `1.97.0` com Clippy/Rustfmt, fixado por `rust-toolchain.toml`; `src-tauri/Cargo.lock` e obrigatorio para esta aplicacao Tauri.
- SGDK `2.11`, PVSnesLib `4.5.0`, Libretro `1.22.2`, Ghidra `12.1`, JDK 21 e `tauri-driver 2.0.6` compoem o profile full.
- `toolchains/host-requirements.lock.json` fixa tags/commits e hashes. Execucao normal nao consulta `latest`.
- Binarios ativos, Cargo target e caches de compilacao vivem no filesystem nativo por lock digest; o cartao mantem codigo e cache portatil de downloads por SHA-256.
- Hosts v1: Windows 10/11 x64 e Arch/Manjaro/BigLinux x64. Outros hosts retornam `UNSUPPORTED` sem instalacao.
- npm opera com `strict-allow-scripts`; somente o `esbuild` fixado pode executar install script e `fsevents` e explicitamente negado.
- Updater publico esta desabilitado ate existir certificado, canal, endpoint imutavel e politica de assinatura reais.

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
- O blocker institucional restante e a certificacao Windows no mesmo commit/lock, seguida por signing/updater/licencas de redistribuicao para qualquer release publico.
- O baseline de validacao local/CI inclui estrutura, Rustfmt, lint, typecheck, auditorias npm/RustSec, testes frontend e testes Rust.
- `scripts/host-manager.mjs` e o unico orquestrador de provisionamento. `src-tauri/src/tools/dependency_manager.rs` apenas projeta o report comum no Runtime Setup.
- Toolchains ativos vivem no cache nativo por lock digest; `toolchains/` no cartao guarda contrato, compatibilidade legada validada e cache portatil ignorado pelo Git.
