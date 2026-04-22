# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-04-22 (rodada 12 - prova SGDK corpus com source_kind correto + gates)

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-04-22 (rodada 12)`, prova da matriz de corpus real SGDK em `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md` foi corrigida para usar o mesmo contrato do wizard/IPC: helper de teste stampeia `template_metadata.source_kind=imported_sgdk` e valida explicitamente `project.rds` antes do Build/ROM. Reexecucao `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1`: linhas **1, 3, 4, 5, 6** com `rom_sega=true`; linha **2** falhou no import por ausencia de manifesto `.res` (`PlatformerEngine`). Build tambem passou a encaminhar `source_kind` para `validate_scene_with_source_kind` (MD/SNES), preservando fatal em projeto nativo e warning auditavel em `imported_sgdk`. SGDK segue `Experimental` sem promocao de `support_status`.

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

### CHECKPOINT operacional (2026-04-22 — rodada 12)

- **Build/constraints:** `build_orch.rs` agora passa `project.template_metadata.source_kind` para `md_profile::validate_scene_with_source_kind` e `snes_profile::validate_scene_with_source_kind`.
- **Regressao:** teste `sgdk_managed_vram_overflow_warns_but_native_still_aborts` prova que overflow VRAM continua fatal em nativo e vira warning auditavel em `imported_sgdk`.
- **Corpus matriz:** helper `run_sgdk_matrix_corpus_partial_flow_documents_build_blocker` stampeia `stamp_imported_sgdk_metadata(&project, donor)`, asserta `source_kind=imported_sgdk` em `project.rds` e loga `source_kind` nos prefixos `MATRIX_*`.
- **Resultado rodada 12:** P2/SD/MS/MK/NEXZR com Build/ROM `SEGA`; `PlatformerEngine` falhou no import (`.res` ausente). Sem claim de suporte completo.

