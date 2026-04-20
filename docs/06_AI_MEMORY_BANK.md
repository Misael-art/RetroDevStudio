# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-04-20 (rodada 9)

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-04-20 (rodada 9)`, Fase E do Programa SGDK Real-World Import fechada com prova pratica no host real. Preflight operacional (`scripts/sgdk-e2e-host-preflight.mjs`) valida SGDK toolchain completo (`bin/gcc.exe` + `makefile.gen`), `tauri-driver` e `msedgedriver` do canonico `toolchains/webdriver/`; exit code nao-zero quando deps faltam. Bug critico corrigido: `updateCollisionMap` no `editorStore.ts` nao propagava `collision_map` para `activeSceneSource`, causando perda de colisao na persistencia. Fixture `sgdk_e2e_donor` regenerada com imagens 32x32/16x16/256x224 compativeis com pipeline BMP do SGDK. E2E runner: ROM lookup corrigido para `build/megadrive/out/` com extensoes `.md`/`.bin`/`.gen`; diagnostico de falha de Build&Run agora captura console tail. Desktop E2E `qa-rc` blocos A-G passaram no host local (SGDK import -> colisao -> persistir -> reabrir -> Build & Run -> ROM com header SEGA verificado em disco). Gates: `cargo test --lib` 303/0/3, `cargo clippy -D warnings`, 235 vitest, check:tree/lint/tsc OK. SGDK continua `Experimental`.

Em caso de conflito documental, a hierarquia continua sendo:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.
