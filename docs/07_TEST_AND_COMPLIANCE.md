# 07 - COMPLIANCE LEGAL & ARQUITETURA DE TESTES
**Status:** Definitivo

> Este documento existe para impedir duas classes de falha:
> 1. Violacao de IP/licenca.
> 2. Regressao silenciosa do pipeline `Build -> ROM -> Emulacao`.

---

## 1. COMPLIANCE LEGAL

### 1.1 BYOR
- O usuario traz a propria ROM quando estiver usando recursos de engenharia reversa.
- O projeto nao distribui ROM comercial.
- O software pode operar com ROMs fornecidas pelo usuario para fins educacionais, pesquisa e preservacao.

### 1.2 Patches em vez de redistribuicao
- Exportacao de modificacao em ROM comercial deve privilegiar IPS/BPS.
- O app nao deve empacotar ROM modificada de terceiro como artefato distribuivel.

### 1.3 SDKs e cores de terceiros
- SGDK, PVSnesLib e cores Libretro sao componentes externos.
- Eles devem ser baixados do upstream oficial, sob demanda e com consentimento do usuario.
- Esses binarios nao devem ser versionados no repositorio.
- Para cores Libretro, a IA deve sempre registrar que a licenca do core precisa ser revisada antes de redistribuicao ou uso comercial.

---

## 2. ARQUITETURA DE VALIDACAO

### 2.1 Validacao estatica e estrutural
- `npm run check:tree` valida a estrutura raiz contra a arvore canonica.
- `npm run lint` cobre o baseline estatico do frontend.
- `npx tsc --noEmit` protege o contrato de tipos do frontend.
- `cargo clippy -- -D warnings` protege o baseline de qualidade do backend Rust.

### 2.2 Unitarios
- Frontend: Vitest.
- Backend: `cargo test --lib -- --nocapture`.
- Cobrir parser/schema, hardware profiles, framebuffer, dependency manager e fluxos de editor sensiveis.

### 2.3 Integracao
- O pipeline de build deve ser testado por target.
- O workspace precisa provar geracao de `main.c`, manifestos e artefato de ROM.
- O caminho SNES precisa provar staging de asset real.

### 2.4 Regressao deterministica
- Projetos dummy canonicos ficam em `src-tauri/tests/fixtures/projects/`.
- O backend deve conseguir `Build -> Load ROM -> Run frame` em modo headless.
- O app desktop deve conseguir `Build -> Load ROM -> Run frames` via Tauri/WebDriver no runner canonico `scripts/e2e-tauri-build-run.mjs`.
- O workflow dedicado `.github/workflows/desktop-e2e.yml` e o entrypoint institucional para repetir esse smoke em Windows, com `workflow_dispatch`, `workflow_call` e gatilhos `push`/`pull_request` filtrados por caminho, ja validado em runner GitHub/Windows real.
- Mudancas no pipeline que alterem esse comportamento precisam atualizar teste, fixture e memoria do projeto.

---

## 3. GATE MINIMO ANTES DE DECLARAR ENTREGA

1. `npm run check:tree`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm test`
5. `cargo clippy -- -D warnings`
6. `cargo test --lib -- --nocapture`
7. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` quando a mudanca tocar build/emulacao/toolchains reais no Windows
8. `node scripts/e2e-tauri-build-run.mjs --skip-build --native-driver <caminho-do-msedgedriver.exe>` quando a mudanca tocar o fluxo publico `Build -> Load ROM -> Run frames`
9. Atualizacao de `docs/03_ROADMAP_MVP.md` e `docs/06_AI_MEMORY_BANK.md` quando o estado do produto mudar

Nenhum agente deve chamar uma feature de `pronta`, `completa` ou `entregue` se esse gate nao foi satisfeito ou se a feature continua parcial/experimental.

---

## 4. ALERTAS ESPECIFICOS DO ESTADO ATUAL

- O setup automatico de terceiros ja existe e a validacao oficial em Windows foi comprovada, mas ela continua obrigatoria em mudancas relevantes de build/emulacao/toolchain.
- No Windows, o caminho SNES precisa de Git Bash/MSYS2 real; o shim do WSL nao deve ser tratado como shell suportado.
- O runner desktop/Tauri depende de `tauri-driver` e `msedgedriver` provisionados localmente; sem isso o teste de aplicacao nao deve ser marcado como executado.
- O workflow `desktop-e2e.yml` foi separado do `ci.yml`, ganhou `concurrency`, `timeout` e gatilhos dedicados por caminho, e ja passou em runner GitHub/Windows real; nao migrar esse smoke para o job unico do `ci.yml` sem justificativa forte de custo/tempo.
- A existencia de toolchain/core instalado localmente nao substitui compliance de licenca.
- Superficies experimentais devem continuar claramente marcadas ate deixarem de ser parciais ou stub.
