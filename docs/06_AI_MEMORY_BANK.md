# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-04-13

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-04-13`, a wave S+ continuou endurecendo o fechamento institucional do MVP: o run publico `Desktop E2E #140` foi delimitado como falha de bootstrap da janela (`Janela do app nao abriu corretamente`) apos a criacao da sessao WebDriver, `scripts/e2e-tauri-build-run.mjs` passou a usar um handshake mais tolerante baseado em `document.title` + estado do DOM + raiz React + `window.__RDS_E2E__`, `.github/workflows/desktop-e2e.yml` ganhou `RDS_E2E_UI_TIMEOUT_MS=30000`, e `scripts/release-readiness.mjs` passou a registrar upstream/diferenca contra `origin/main` para impedir snapshot de promocao que esconda branch publica desatualizada. A leitura honesta segue a mesma: `build:debug`, `validate-upstream-windows` e `qa-rc` continuam com evidencias recentes, mas o produto ainda esta em `hardening` ate o `Desktop E2E` remoto ficar verde e a promocao ser regenerada em worktree limpo.

Em caso de conflito documental, a hierarquia continua sendo:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.
