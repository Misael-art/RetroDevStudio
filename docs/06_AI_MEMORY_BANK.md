# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-04-21 (rodada 11+ - matriz corpus SGDK + CollisionMap world-sized + gates)

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-04-21 (rodada 11+)`, matriz de corpus real em `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (seis titulos SGDK 2.11 em `F:/Projects/MegaDrive_DEV/SGDK_Engines`, pastas verificadas; **linha 1 Platformer 2 = Parcial** com teste `sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker` `--ignored`; linhas 2-6 **Pendente** ate execucao por titulo). Validacao MD/SNES: `CollisionMap` world-sized deixa de ser fatal vs viewport; integridade + limites conservadores. Raiz do repo: removido `target-test-corrupt-salvage` apos realocacao previa para `F:/Projects/_RetroDevStudio_corrupt_salvage_relocated/`. Gates verdes na mesma sessao: `check:tree`, `lint`, `tsc --noEmit`, `npm test` (ajuste em `App.test.tsx` para evitar corrida com live validation), `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`, `preflight:sgdk-e2e`, `test:e2e:desktop:qa-rc`. Rodada 10 permanece valida como consolidacao E2E SGDK; SGDK segue `Experimental` sem promocao de `support_status`.

Em caso de conflito documental, a hierarquia continua sendo:
`docs/06_AI_MEMORY_BANK.md` -> `docs/03_ROADMAP_MVP.md` -> `docs/09_AGENT_DEV_MODE.md`.

---

### CHECKPOINT operacional (2026-04-21 — commit consolidado)

**Git:** mensagem `fix(md): validar CollisionMap world-sized; endurecer teste matriz SGDK P2` na branch `feat/desktop-e2e-workflow` (`git log -1 --oneline`).

- **Rust / hardware:** `md_profile.rs` e `snes_profile.rs` — `CollisionMap` world-sized (scroll/plataforma) deixa de ser **fatal** por exceder viewport; mantem validacao conservadora (tile multiplo de 8, limites de grid e de bytes em `data`, integridade `len` vs `width*height`, overflow com `checked_mul`); aviso quando o mundo em pixels excede a area visivel. Testes de regressao: `collision_map_wider_than_viewport_is_non_fatal_with_warning` (MD e SNES).
- **Corpus matriz Platformer 2:** teste renomeado `sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker`; com `--ignored`, doador ausente **panic** salvo `RDS_SGDK_MATRIX_CORPUS_SKIP=1`; assert final exige ROM com marca `SEGA`; leitura da ROM no ramo fake usa `project.join(rom_path)`.
- **Documentacao:** `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` (linha 1, comando e evidencia); `docs/06_CURRENT_WAVE_AI_BANK.md` (rodada 11+). Comentario UGDM em `CollisionMap` (`entities.rs`) alinhado a mapas maiores que viewport.
- **Gates verificados nesta entrega:** `npm run check:tree`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`, e `cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker ... --ignored` no host com corpus (ex.: `mode=sgdk_detect rom_sega=true`).
- **Governanca:** SGDK permanece **Experimental**; `support_status` nao promovido; matriz linha 1 **Parcial** (programa dos seis titulos incompleto).

