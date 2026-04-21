# SGDK - Matriz de validacao em corpus real (Mega Drive)

**Status do documento:** operacional (nao promove `support_status`).  
**Alvo:** sair de fixture/E2E controlado para matriz repetivel por genero/projeto.  
**Regra de produto:** SGDK permanece **Experimental** ate os seis titulos abaixo passarem no fluxo completo (import -> editar -> salvar -> reabrir -> build/ROM) com evidencia documentada e sem regressao nos gates do repositorio.

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
| 1 | `Platformer 2 [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]` | Plataforma | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Parcial** | Evidencia: `cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (2026-04-21, host Windows, doador em `F:\\Projects\\MegaDrive_DEV\\SGDK_Engines\\...`). Import OK; ledger JSON OK; `imported_scenes=2`; `scenes/*.json` presentes; tilemap com `cells[]` nao vazio; sprite com animacoes; `collision_map` presente; `graph_ref` nao vazio; `save_scene`/`load_scene` round-trip num sprite. **Build/ROM:** ROM com marca `SEGA` neste run (`MATRIX_P2 build: mode=sgdk_detect rom_sega=true`) apos correcao conservadora em `md_profile.rs`/`snes_profile.rs` (mapas `CollisionMap` world-sized ja nao bloqueiam por exceder viewport). **Resultado Parcial:** criterio institucional da matriz (seis titulos) ainda nao satisfeito; linhas 2-6 Pendente. Sem doador e com `--ignored`, o teste **panic** salvo `RDS_SGDK_MATRIX_CORPUS_SKIP=1`. SGDK continua Experimental. |
| 2 | `PlatformerEngine [VER.1.0] [SGDK 211] [GEN] [ENGINE] [PLATAFORMA]` | Engine plataforma | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | **Pendente** | Idem. |
| 3 | `Shadow Dancer Revisitado [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]` | Plataforma | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | **Pendente** | Idem. |
| 4 | `Metal Slug Warfare Demo [VER.001] [SGDK 211] [GEN] [ESTUDO] [RUN AND GUN]` | Run and gun | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | **Pendente** | Idem. |
| 5 | `Mortal Kombat Plus [VER.001] [SGDK 211] [GEN] [ENGINE] [LUTA]` | Luta | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | **Pendente** | Idem. |
| 6 | `NEXZR MD [VER.001] [SGDK 211] [GEN] [GAME] [SHMUP]` | Shmup | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | Pendente | **Pendente** | Idem. |

### Linha 1 - como repetir a prova (Platformer 2)

Teste Rust ignorado no suite normal (nao corre em CI sem `--ignored`):

```text
cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1
```

Requer o doador no caminho absoluto acima (ou `RDS_SGDK_MATRIX_CORPUS_SKIP=1` para saltar explicitamente sem corpus). Saida util: linhas `MATRIX_P2 signals:` e `MATRIX_P2 build:` no stdout.

---

## Criterio de suporte "completo" (nao satisfeito)

So considerar SGDK fora de **Experimental** quando **os seis** fluxos acima forem **Passou** com evidencia repetivel, documentacao de falhas residuais (se houver) e **todos** os gates desta pagina verdes na mesma revisao - sem regressao em CI/local.

---

## Rodada documental

- **Rodada 9** (ja descrita em `docs/06_CURRENT_WAVE_AI_BANK.md`): Fase E com prova `qa-rc` A-G no host.  
- **Rodada 11 (esta matriz):** formaliza o **programa de corpus real** e os gates; nao altera promocao de `support_status`.
