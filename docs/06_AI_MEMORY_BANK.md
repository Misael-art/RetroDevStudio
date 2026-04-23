# 06 - AI MEMORY BANK & CONTEXT TRACKER
**Status:** ENTRADA CANONICA
**Ultima Atualizacao:** 2026-04-23 (rodada 13 - resolver SGDK `.mddev` + matriz corpus 6/6)

## ATENCAO PARA AGENTES DE IA

**Este arquivo continua sendo a entrada oficial do estado operacional.** Para reduzir token bounds, o conteudo foi fragmentado em:

| Arquivo | Uso |
|---------|-----|
| `docs/06_CURRENT_WAVE_AI_BANK.md` | Estado atual, Wave S+, sessoes recentes, decisoes e proximos passos |
| `docs/06_AI_MEMORY_BANK_WAVE_A_R.md` | Historico arquivado das waves A-R |

**Fluxo canonico:** leia este arquivo primeiro e siga imediatamente para `docs/06_CURRENT_WAVE_AI_BANK.md`.
**Atualizacao ativa mais recente:** em `2026-04-23 (rodada 13)`, `project_mgr.rs` ganhou resolucao canonica `resolve_sgdk_import_root` para pastas **REFERENCE** / `build_policy=disabled` que delegam SGDK real via `.mddev` + `README.md` (candidatos explicitos, maximo 2 saltos, escolha automatica apenas com exatamente um candidato buildavel e warning). Matriz `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md`: suite `cargo test sgdk_matrix_corpus_ ... --ignored` **6/6** com `rom_sega=true` no host com corpus; linha 2 (`PlatformerEngine`) usa `mddev_reference_redirect`. `stamp_imported_sgdk_metadata` mantem `source_path` do pedido do utilizador; ledger/report carregam `effective_root`. SGDK segue **Experimental**; `support_status` inalterado.

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

- **Build/constraints:** `build_orch.rs` passa `project.template_metadata.source_kind` para `validate_scene_with_source_kind` (MD/SNES).
- **Regressao:** `sgdk_managed_vram_overflow_warns_but_native_still_aborts`.
- **Corpus matriz:** helper com `stamp_imported_sgdk_metadata` + assert `source_kind=imported_sgdk`.

### CHECKPOINT operacional (2026-04-23 — rodada 13)

- **Resolver SGDK:** `resolve_sgdk_import_root` + integracao em `import_sgdk_project`; testes `sgdk_resolver_*`; ambiguidade multi-candidato falha com mensagem e lista de roots.
- **Matriz corpus:** `cargo test sgdk_matrix_corpus_ ... --ignored --test-threads=1` => **6/6** no host; linha 2 `MATRIX_PE` com `resolution_kind=mddev_reference_redirect`.
- **Gates locais desta rodada:** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy -D warnings`, `cargo test --lib --test-threads=1`.

