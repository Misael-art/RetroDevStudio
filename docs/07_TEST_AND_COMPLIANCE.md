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
- Backend: `cargo test --lib -- --nocapture --test-threads=1`.
- Cobrir parser/schema, hardware profiles, framebuffer, dependency manager e fluxos de editor sensiveis.

### 2.3 Integracao
- O pipeline de build deve ser testado por target.
- O workspace precisa provar geracao de `main.c`, manifestos e artefato de ROM.
- O caminho SNES precisa provar staging de asset real.

### 2.4 Regressao deterministica
- Projetos dummy canonicos ficam em `src-tauri/tests/fixtures/projects/`.
- Fixtures canonicas devem permanecer `BYOR-safe`: sem ROM comercial, sem depender de corpus local solto e sem versionar artefatos gerados em `build/`.
- O backend deve conseguir `Build -> Load ROM -> Run frame` em modo headless.
- O app desktop deve conseguir `Build -> Load ROM -> Run frames` via Tauri/WebDriver no runner canonico `scripts/e2e-tauri-build-run.mjs`.
- O cenario `qa-rc` do runner canonico deve conseguir reproduzir o roteiro RC `A-F` e gerar `src-tauri/target-test/validation/manual-qa-status.json` com screenshots anexas da propria rodada.
- O workflow dedicado `.github/workflows/desktop-e2e.yml` e o entrypoint institucional para repetir esse smoke em Windows, com `workflow_dispatch`, `workflow_call` e gatilhos `push`/`pull_request` filtrados por caminho, ja validado em runner GitHub/Windows real.
- Mudancas no pipeline que alterem esse comportamento precisam atualizar teste, fixture e memoria do projeto.

---

## 3. GATE MINIMO ANTES DE DECLARAR ENTREGA

1. `npm run check:tree`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm test`
5. `cargo clippy -- -D warnings`
6. `cargo test --lib -- --nocapture --test-threads=1`
7. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests` quando a mudanca tocar build/emulacao/toolchains reais no Windows
   Observacao canonica: este gate deve ser rerodado de forma direta, a partir do shell, e nao embrulhado por `scripts/run-in-msvc.cmd`, porque o proprio `validate-upstream-windows.ps1` ja chama internamente o runner MSVC canonico quando necessario.
8. `node scripts/e2e-tauri-build-run.mjs --skip-build --native-driver .\toolchains\webdriver\msedgedriver.exe` quando a mudanca tocar o fluxo publico `Build -> Load ROM -> Run frames`
9. `npm run test:e2e:desktop:qa-rc` quando a mudanca tocar onboarding, shell principal, camadas, viewport editavel, inspector, persistencia ou o fluxo desktop `Build & Run`
10. `npm run release:readiness:promotion` na rodada institucional que pretende promover o RC, anexando o report de QA `A-F`
11. Em host Windows com policy que bloqueia bootstrap interno do driver, usar fallback `--external-driver` com `tauri-driver` iniciado fora do processo Node.
12. Se a sessao WebDriver falhar em `DevToolsActivePort`/`chrome not reachable`, executar `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-desktop-e2e.ps1 -SessionProbe` e registrar o resultado.
13. Atualizacao de `docs/03_ROADMAP_MVP.md` e `docs/06_AI_MEMORY_BANK.md` quando o estado do produto mudar

### 3.1 Agregacao canonica de readiness
- `node scripts/release-readiness.mjs` gera um snapshot objetivo do estado de release em `src-tauri/target-test/validation/release-readiness.json` e `release-readiness.md`.
- `npm run release:readiness:baseline` reexecuta os 6 gates locais e, em Windows, tambem dispara automaticamente `build:debug` e `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests`; se `toolchains/webdriver/msedgedriver.exe` estiver disponivel, o agregador tambem executa o `desktop E2E` canonico com `--skip-build`.
- `npm run release:readiness:promotion` e a fotografia institucional conservadora para RC -> beta/producao: ele reexecuta a baseline, consome `src-tauri/target-test/validation/manual-qa-status.json` e falha em modo `strict` se qualquer bloco `A-F` continuar pendente.
- Em Windows, o report so deve ficar verde quando `build-report.json`, `upstream-validation.json` e o executavel debug canonico tiverem timestamps frescos da propria rodada.
- `src-tauri/target-test/validation/build-report.json` deve ser tratado como artefato `fresh-only`: cada execucao registra apenas os modos realmente rodados naquela rodada, sem herdar secoes antigas de `portable`, `msi` ou outros perfis.
- `src-tauri/target-test/validation/manual-qa-status.json` deve ser tratado como evidencia canonica do roteiro `A-F`; screenshots `qa-rc-*.png` da mesma rodada devem acompanhar esse report sempre que a promocao institucional depender do smoke de shell.
- Em Windows, os gates Rust da baseline de readiness devem rodar pelo wrapper canonico `scripts/run-cargo-msvc.cmd --manifest-path .\\src-tauri\\Cargo.toml`, e nao por `cargo` cru nem forçando `CARGO_TARGET_DIR=cargo-target-shadow` para esses dois gates.
- O report deve ser tratado como a fotografia canonica da promocao RC -> beta/producao: artefatos, dirty worktree, baseline, upstream report, QA manual pendente e bloqueadores explicitos.
- O agregador nao substitui a validacao manual nem o smoke institutional em Windows; ele reduz falso positivo e centraliza evidencias.

### 3.2 Criterios de aceite para rodada institucional de beta
- `npm run release:readiness:promotion` deve fechar verde na propria rodada de promocao.
- `src-tauri/target-test/validation/manual-qa-status.json` deve registrar os blocos `A-F` como `passed`, com screenshots `qa-rc-*.png` da mesma rodada.
- Em Windows, `build-report.json`, `upstream-validation.json` e o executavel debug canonico devem ter timestamps frescos da mesma execucao institucional.
- O worktree deve estar limpo no momento do snapshot que sera usado como evidencia de promocao.
- Se o escopo tocar build Mega Drive/SGDK real, a evidencia institucional deve cobrir onboarding, `platformer_seed`, pelo menos um projeto SGDK importado e as fixtures canonicas do smoke upstream oficial.
- Nenhuma superficie `Experimental` pode ser promovida documentalmente para `pronta` sem mudar o badge na UI, a documentacao e a cobertura do fluxo afetado.

### 3.3 Riscos residuais que precisam acompanhar notas de beta
- O shell principal melhorou materialmente de bundle, mas ainda segue em hardening e nao deve ser descrito como totalmente otimizado.
- `ArtStudio`, `RetroFX`, `Reverse Workspace`, `Asset Extractor`, `Memory Viewer` e importadores parciais continuam `Experimental`.
- A repeticao de MSI continua obrigatoria quando o escopo tocar release/packaging, mesmo que a baseline local esteja verde.
- O host local pode continuar sujeito a falhas ocasionais de WebDriver; quando isso ocorrer, a evidencia institucional principal deve vir do workflow GitHub/Windows.
- Qualquer regressao em `Build -> ROM -> Emulacao` invalida claim de promocao, mesmo que UI, docs ou smoke parciais permaneçam verdes.

Nenhum agente deve chamar uma feature de `pronta`, `completa` ou `entregue` se esse gate nao foi satisfeito ou se a feature continua parcial/experimental.
Nenhuma etapa deve ser tratada como `concluida` sem certificacao real do fluxo afetado, sem erro bloqueante conhecido e sem evidencia fake ou paralela ao caminho canonico.

---

## 4. ALERTAS ESPECIFICOS DO ESTADO ATUAL

- O setup automatico de terceiros ja existe e a validacao oficial em Windows foi comprovada, mas ela continua obrigatoria em mudancas relevantes de build/emulacao/toolchain.
- O modo correto de rerodar o gate upstream oficial neste host e no fluxo atual do projeto e direto: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-upstream-windows.ps1 -SkipRustTests`. Nao embrulhar esse script com `scripts/run-in-msvc.cmd`.
- No Windows, o caminho SNES precisa de Git Bash/MSYS2 real; o shim do WSL nao deve ser tratado como shell suportado.
- O runner desktop/Tauri depende de `tauri-driver` e `msedgedriver` provisionados localmente; sem isso o teste de aplicacao nao deve ser marcado como executado. O caminho local canonico para o driver nativo e `toolchains/webdriver/msedgedriver.exe`.
- Neste host local foi observado que `child_process.spawn` com `stdio` contendo `pipe` pode falhar com `EPERM`; o runner canonico ja usa bootstrap interno com `stdio: inherit` e oferece fallback `--external-driver`.
- Mesmo com bootstrap funcional do driver, a criacao de sessao WebDriver pode falhar localmente com `DevToolsActivePort/chrome not reachable`; nesse caso, a certificacao institucional deve ocorrer no `desktop-e2e.yml` em runner GitHub/Windows.
- Para diagnostico rapido e padronizado de ambiente local, usar `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-desktop-e2e.ps1`; para reproduzir handshake real de sessao, habilitar `-SessionProbe`.
- Historico relevante deste host: o comando cru `npm run tauri build -- --debug --no-bundle` ja apresentou sensibilidade a policy/AppLocker no `beforeBuildCommand`. Para validacao local canônica, preferir `npm run build:debug` / `node scripts/build.mjs debug`, que hoje volta a passar usando o shadow target automatico previsto no proprio script. A prova institucional de desktop continua no runner GitHub/Windows quando o escopo tocar packaging ou regressao sensivel de build.
- O workflow `desktop-e2e.yml` foi separado do `ci.yml`, ganhou `concurrency`, `timeout` e gatilhos dedicados por caminho, e ja passou em runner GitHub/Windows real; nao migrar esse smoke para o job unico do `ci.yml` sem justificativa forte de custo/tempo.
- Os workflows `ci.yml` e `desktop-e2e.yml` agora devem publicar sumarios em `GITHUB_STEP_SUMMARY` e anexar `src-tauri/target-test/validation/**` como artefatos de auditoria por execucao.
- Fixtures de projeto em `src-tauri/tests/fixtures/projects/` nao devem carregar diretórios `build/` versionados como precondicao silenciosa para testes; toda cobertura relevante deve nascer de assets tracked, fixtures sinteticas ou build gerado na propria rodada.
- A existencia de toolchain/core instalado localmente nao substitui compliance de licenca.
- Superficies experimentais devem continuar claramente marcadas ate deixarem de ser parciais ou stub.
