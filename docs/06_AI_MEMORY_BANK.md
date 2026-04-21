# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-04-21 (rodada 11 - matriz corpus SGDK + gates)

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-04-21 (rodada 11)`, matriz de corpus real em `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (seis titulos SGDK 2.11 em `F:/Projects/MegaDrive_DEV/SGDK_Engines`, pastas verificadas; linhas de resultado por titulo **Pendente** ate checklist import-to-ROM). Raiz do repo: removido `target-test-corrupt-salvage` apos realocacao previa para `F:/Projects/_RetroDevStudio_corrupt_salvage_relocated/`. Gates verdes na mesma sessao: `check:tree`, `lint`, `tsc --noEmit`, `npm test` (ajuste em `App.test.tsx` para evitar corrida com live validation), `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc`. Rodada 10 permanece valida como consolidacao E2E SGDK; SGDK segue `Experimental` sem promocao de `support_status`.

Em caso de conflito documental, a hierarquia continua sendo:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.

