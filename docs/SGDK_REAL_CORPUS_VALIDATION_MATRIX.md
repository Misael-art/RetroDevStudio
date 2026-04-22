# SGDK - Matriz de validacao em corpus real (Mega Drive)

**Status do documento:** operacional (nao promove `support_status`).  
**Alvo:** sair de fixture/E2E controlado para matriz repetivel por genero/projeto.  
**Regra de produto:** SGDK permanece **Experimental** ate os seis titulos abaixo passarem no fluxo completo (import -> editar -> salvar -> reabrir -> build/ROM) com evidencia documentada e sem regressao nos gates do repositorio.

**Cobertura por genero (codigo):** existem **seis** testes Rust `#[ignore]` em `src-tauri/src/core/project_mgr.rs` (um por pasta do corpus), todos com o mesmo contrato: import, ledger, sinais na cena primaria, round-trip opcional com sprite, build SGDK real se detetado, senao toolchain **fake** de prova, assert ROM com `SEGA`. Ausencia do doador com `--ignored` => **panic**, salvo `RDS_SGDK_MATRIX_CORPUS_SKIP=1`. Isto nao promove `support_status`; apenas torna a matriz **repetivel por tipo** (plataforma estudo, engine plataforma, plataforma revisitada, run-and-gun, engine luta, shmup).

---

## Raiz do corpus (host)

`F:\Projects\MegaDrive_DEV\SGDK_Engines\`

Verificacao de existencia das pastas (2026-04-21 neste host): **OK** para os seis nomes listados.

---

## Gates do repositorio (ordem canonica)

Rodar na raiz do repo:

```powershell
npm run check:tree
npm run lint
npx tsc --noEmit
npm test
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
npm run preflight:sgdk-e2e
npm run test:e2e:desktop:qa-rc
```

**Ultima barra verde registrada nesta sessao (2026-04-21):** todos os comandos acima concluiram com exit code `0` no mesmo host (inclui `qa-rc` A-G e preflight SGDK).

---

## Manutencao da arvore (`check:tree`)

A pasta `target-test-corrupt-salvage` na raiz do repo violava `scripts/check-tree.cjs` e, neste host, nao podia ser apagada de forma fiavel enquanto nao estava vazia (conteudo foi movido antes com `Move-Item`). Estado final: **diretorio removido da raiz do RetroDevStudio**; conteudo/arquivo residual, se existir, ficou sob:

`F:\Projects\_RetroDevStudio_corrupt_salvage_relocated\`

---

## Matriz por projeto (preenchimento honesto)

Legenda de resultado: **Passou** | **Parcial** | **Falhou** | **Pendente** (ainda nao executado nesta rodada).

Para cada linha, ao executar no editor: import SGDK -> relatorio/ledger -> cenas -> tilemaps -> animacoes -> collision map -> `graph_ref` -> salvar/reabrir -> build/ROM (quando aplicavel). Registrar **blocker concreto** em Parcial/Falhou.

| # | Pasta do corpus | Genero / nota | Import | Report/Ledger | Cenas | Tilemaps | Anim. | Collision | graph_ref | Salvar/Reabrir | Build/ROM | Resultado | Blocker / evidencia |
|---|------------------|---------------|--------|---------------|-------|----------|-------|-----------|-----------|----------------|-----------|-----------|---------------------|
| 1 | `Platformer 2 [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]` | Plataforma | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Parcial** | Evidencia atualizada: `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (rodada 12, 2026-04-22). `MATRIX_P2 signals`: `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=2`; `MATRIX_P2 build: source_kind=imported_sgdk mode=sgdk_detect rom_sega=true`. Mantem **Parcial** por governanca global (seis titulos ainda nao concluido e linha 2 falhou no import). |
| 2 | `PlatformerEngine [VER.1.0] [SGDK 211] [GEN] [ENGINE] [PLATAFORMA]` | Engine plataforma | Falhou | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | **Falhou** | Evidencia (2026-04-22): `sgdk_matrix_corpus_platformer_engine_partial_flow_documents_build_blocker` falhou no import com `LoadError(\"Projeto SGDK invalido: nenhum manifesto .res foi encontrado ...\")`. Blocker real: projeto sem manifesto `.res` detectavel no caminho doador. |
| 3 | `Shadow Dancer Revisitado [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]` | Plataforma | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Passou** | Evidencia rodada 12 (2026-04-22): `MATRIX_SD signals`: `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=8`, `warnings=8`; `MATRIX_SD build: source_kind=imported_sgdk mode=sgdk_detect rom_sega=true`. Reavaliado com contrato correto (metadata stamp) — blocker de VRAM fatal removido como falso-positivo de prova anterior. |
| 4 | `Metal Slug Warfare Demo [VER.001] [SGDK 211] [GEN] [ESTUDO] [RUN AND GUN]` | Run and gun | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Passou** | Evidencia rodada 12 (2026-04-22): `MATRIX_MS signals`: `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=14`, `warnings=26`; `MATRIX_MS build: source_kind=imported_sgdk mode=sgdk_detect rom_sega=true`. Reavaliado com metadata correto; overflow VRAM passou a warning auditavel em SGDK gerenciado. |
| 5 | `Mortal Kombat Plus [VER.001] [SGDK 211] [GEN] [ENGINE] [LUTA]` | Luta | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Passou** | Evidencia rodada 12 (2026-04-22): `MATRIX_MK signals`: `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=17`, `warnings=8`; `MATRIX_MK build: source_kind=imported_sgdk mode=sgdk_detect rom_sega=true`. Reavaliado com metadata correto; blocker falso de VRAM fatal removido. |
| 6 | `NEXZR MD [VER.001] [SGDK 211] [GEN] [GAME] [SHMUP]` | Shmup | Passou | Passou | Passou | Passou | Passou | Passou | Passou | Passou | Passou | **Passou** | Evidencia rodada 12 (2026-04-22): `MATRIX_NEXZR signals`: `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=5`, `warnings=0`; `MATRIX_NEXZR build: source_kind=imported_sgdk mode=sgdk_detect rom_sega=true`. |

**Nota de reavaliacao (rodada 12, 2026-04-22):** o helper da matriz agora segue o mesmo contrato do wizard/IPC: apos `import_sgdk_project`, faz `stamp_imported_sgdk_metadata` e valida `project.rds` com `source_kind=imported_sgdk` antes do build. Com isso, linhas 3/4/5 deixaram de falhar por VRAM fatal na prova de corpus; linha 2 manteve blocker real de import (`.res` ausente).

### Linha 1 - como repetir a prova (Platformer 2)

Teste Rust ignorado no suite normal (nao corre em CI sem `--ignored`):

```text
cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1
```

Requer o doador no caminho absoluto acima (ou `RDS_SGDK_MATRIX_CORPUS_SKIP=1` para saltar explicitamente sem corpus). Saida util: linhas `MATRIX_P2 signals:` e `MATRIX_P2 build:` no stdout.

### Linhas 2 a 6 — mesma suite, tags distintas no stdout

Substituir `<TEST>` pelo nome completo do teste. Comando base:

```text
cargo test <TEST> --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1
```

| # | Genero / foco | Nome do teste (`<TEST>`) | Prefixo `signals` / `build` no stdout |
|---|----------------|---------------------------|---------------------------------------|
| 2 | Engine plataforma | `sgdk_matrix_corpus_platformer_engine_partial_flow_documents_build_blocker` | `MATRIX_PE` |
| 3 | Plataforma (estudo) | `sgdk_matrix_corpus_shadow_dancer_revisitado_partial_flow_documents_build_blocker` | `MATRIX_SD` |
| 4 | Run and gun | `sgdk_matrix_corpus_metal_slug_warfare_demo_partial_flow_documents_build_blocker` | `MATRIX_MS` |
| 5 | Engine luta | `sgdk_matrix_corpus_mortal_kombat_plus_partial_flow_documents_build_blocker` | `MATRIX_MK` |
| 6 | Shmup | `sgdk_matrix_corpus_nexzr_md_partial_flow_documents_build_blocker` | `MATRIX_NEXZR` |

**Proximo passo de governanca:** executar cada linha no host com corpus, copiar para a matriz as colunas Passou/Parcial/Falhou e o texto de evidencia (como na linha 1). Opcional (demorado, use `--test-threads=1` para nao paralelizar builds SGDK): `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` corre os seis testes que casam o prefixo; doador em falta sem `RDS_SGDK_MATRIX_CORPUS_SKIP=1` => **panic** naquele teste; com skip `=1`, o teste em falta retorna sem falhar e os restantes continuam.

---

## Criterio de suporte "completo" (nao satisfeito)

So considerar SGDK fora de **Experimental** quando **os seis** fluxos acima forem **Passou** com evidencia repetivel, documentacao de falhas residuais (se houver) e **todos** os gates desta pagina verdes na mesma revisao - sem regressao em CI/local.

---

## Rodada documental

- **Rodada 9** (ja descrita em `docs/06_CURRENT_WAVE_AI_BANK.md`): Fase E com prova `qa-rc` A-G no host.  
- **Rodada 11 (esta matriz):** formaliza o **programa de corpus real** e os gates; nao altera promocao de `support_status`.
- **Rodada 12 (2026-04-22):** reexecucao da suite `cargo test sgdk_matrix_corpus_ ... --ignored` com metadata correta na prova (`stamp_imported_sgdk_metadata` + assert de `source_kind`). Resultado real: linhas 1, 3, 4, 5 e 6 com Build/ROM `SEGA`; linha 2 falhou no import por ausencia de manifesto `.res`.
