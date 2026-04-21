# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-04-21 (rodada 10)

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-04-21 (rodada 10)`, a consolidacao do Programa SGDK no host real confirmou: `npm run preflight:sgdk-e2e` verde; `npm run build:debug` verde apos recuperar o path canonico `src-tauri/target-test` que estava corrompido no filesystem local; `npm run test:e2e:desktop:qa-rc` inicialmente falhou com `webdriverTitle="localhost"` quando o build debug usava direct-cargo, e passou de forma repetivel apos forcar o caminho canônico Tauri CLI no proprio runner (`e2e-tauri-build-run.mjs` seta `RDS_FORCE_TAURI_CLI_DEBUG=1` para `qa-rc`). A cadeia SGDK A-G foi reprovada e aprovada no mesmo host com evidencia objetiva (`manual-qa-status.json` + screenshot G). `scripts/build.mjs` teve diff validado no host (refresh de mtime continua funcional e sem falso-negativo). `src-tauri/src/core/project_mgr.rs` (heuristicas de audio Fase D) validado com suite focada `sgdk_phase_d_*` e suite Rust completa, sem regressao. Estado honesto: Fase E provada localmente no host atual; SGDK permanece `Experimental` e sem claim institucional.

Em caso de conflito documental, a hierarquia continua sendo:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.

