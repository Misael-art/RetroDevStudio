# SGDK - Matriz de validacao em corpus real (Mega Drive)

**Status do documento:** operacional (nao promove `support_status`).  
**Alvo:** sair de fixture/E2E controlado para matriz repetivel por genero/projeto.  
**Regra de produto:** SGDK so pode ser chamado Stable quando corpus, BLAZE e jogo no-code tiverem prova real (SGDK oficial + Libretro real) ou bridge formal quando build nao for aplicavel, sem fake como evidencia final.

**Nota host/QA (2026-05-14, rodada 43):** a branch `codex/sgdk-stable-node-engine-blaze` removeu fake da prova Stable. `sgdk_corpus_real_build_rom_emulation_report --ignored` processou **122 projetos** em `F:\Projects\MegaDrive_DEV\SGDK_Engines`: **68** com build SGDK real, ROM real e emulacao Genesis Plus GX; **54** com bridge formal persistida; **0 falhas**; `stable_candidate=true`; `fake_toolchain_used=false`. O report fica em `src-tauri/target-test/validation/sgdk-corpus-real-build/sgdk-corpus-real-build-report.{json,md}` e grava ROMs/frames persistentes sob `roms/` e `frames/`. `official_sgdk_nocode_game_builds_and_runs_with_real_toolchain --ignored` provou jogo 100% por nodes com ROM real e `non_black_pixels=15506`. `sgdk_matrix_corpus_blaze_engine_partial_flow_documents_build_blocker --ignored` provou `BLAZE_ENGINE` por modo compativel real com ROM real, Genesis Plus GX 60 frames e `non_black_pixels=71680`. Leitura: SGDK Stable local **SIM** nesta branch; Node Engine Stable local **SIM**; promocao publica ainda depende de PR/checks/merge/readiness.

**Nota host/QA (2026-05-14, rodada 42):** na branch `codex/sgdk-stable-node-engine-blaze`, `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` passou **7/7** com `BLAZE_ENGINE` agora gerando build/ROM por perfil de compatibilidade conservador. O original de BLAZE ainda expõe blocker real antes da transformacao (`Sprite overflow`/residencia), mas `build_orch.rs` aplica culling/multiplex/streaming deterministico, revalida budget e registra `SGDK compatibility profile` com `sprite culling` e `multiplex`; o teste exige ROM com assinatura `SEGA`. O inventario real tambem foi regenerado: **122 projetos**, **2.511 gaps** em `project_details`, **0 blockers** para no-code/build/round-trip por bridge formal, com agregados `assembly_source=150`, `lossy_source_encoding=33`, `preprocessor_condition=1471`, `unsupported_resource_kind=236`, `function_like_macro=484`, `multiline_macro=90`, `inline_assembly=47`. Isto reduz o bloqueio de BLAZE e dos gaps para ponte/compatibilidade, mas ainda **nao** promove SGDK Stable porque nao houve build/ROM/emulacao individual para os 122 projetos.

**Nota host/QA (2026-05-13, rodada 40):** a branch `codex/sgdk-nocode-production-ui` manteve a matriz de sete projetos verde (`cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` = **7/7**) e regenerou o inventario ampliado com gaps acionaveis e candidatos de nodes. O report `src-tauri/target-test/validation/sgdk-corpus-inventory.json` continua cobrindo **122 projetos**; agora registra **32.251 `node_candidates`** em **100 projetos**, preservando gaps agregados inalterados: `preprocessor_condition=1471`, `function_like_macro=484`, `unsupported_resource_kind=236`, `assembly_source=150`, `multiline_macro=90`, `inline_assembly=47`, `lossy_source_encoding=33`. Top projetos mais bloqueados por quantidade de gaps: `SGDK LizarDrive` (706), `NEXZR MD` (465), `Raycasting Anael` (321), `MegaDriving` (135) e `Vigilante Tutorial` (55). Isto melhora autoria/triagem, mas **nao** reduz os gaps nem substitui round-trip/build/emulacao por projeto; `BLAZE_ENGINE` segue stress corpus com blocker legitimo de budget.

**Nota main (2026-05-11, rodada 37):** PR #3 foi mergeado em `main` por `76ccd7d978ea741771478d89053818285213d32e` apos `CI` e `Desktop E2E` remotos verdes. `release:readiness:promotion` passou em `main`. A matriz SGDK permanece com a evidencia da rodada 36 nesta mesma mudanca antes do merge; isto **nao** promove `support_status`.

**Nota host/QA (2026-05-12, rodada 38):** a branch `codex/sgdk-nocode-engine-hardening` adicionou inventario estrutural para o corpus ampliado `F:\Projects\MegaDrive_DEV\SGDK_Engines`. O comando de teste `cargo test sgdk_corpus_inventory_real_corpus_report --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` passou e gerou `src-tauri/target-test/validation/sgdk-corpus-inventory.json` (**20,817,228 bytes**) com **122 projetos** e `project_details` completo por projeto: arquivos C/H/RES, assets, resources, includes, defines/macros, structs/enums, globais/arrays, funcoes, calls SGDK por familia, callbacks, loops/update e semantic gaps. Gaps agregados: `preprocessor_condition=1471`, `function_like_macro=484`, `unsupported_resource_kind=236`, `assembly_source=150`, `multiline_macro=90`, `inline_assembly=47`, `lossy_source_encoding=33`. Na mesma rodada passaram `sgdk_matrix_corpus_ --ignored` **7/7**, `preflight:sgdk-e2e`, QA RC A-G e builds Debug/Portable/MSI; apos o commit tecnico `37a0c52`, `release:readiness:promotion` ficou `Pronto para promocao: NAO` apenas porque a branch estava 1 commit a frente de `origin/main`. Isto **nao** substitui o round-trip/build/emulacao por projeto e **nao** promove `support_status`; e uma fotografia tecnica para reduzir gaps em rodadas seguintes.

**Nota host/QA (2026-05-11, rodada 36):** a barra completa foi rerodada na branch `codex/product-hardening-runtime-setup`. `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` passou **7/7**: seis linhas base continuam com `rom_sega=true` e `BLAZE_ENGINE` continua blocker legitimo auditavel (`fatal=1`, sem assert de ROM). `validate-upstream-windows.ps1 -SkipRustTests` ficou `success=true`, `preflight:sgdk-e2e` ficou `Ready: SIM`, `qa-rc` A-G gerou `manual-qa-status.json` em `2026-05-11T23:49:43.761Z`, e Debug/Portable/MSI foram regenerados. Isto **nao** promove `support_status` e nao transforma Phase D em AST.

**Nota host/QA (2026-05-11, rodada 32):** a barra completa foi rerodada neste host apos a preparacao da rodada 31. `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` passou **7/7** (`BLAZE_ENGINE` continua blocker legitimo auditavel, sem assert de ROM), `validate-upstream-windows.ps1 -SkipRustTests` ficou `success=true`, `preflight:sgdk-e2e` ficou `Ready: SIM` e `qa-rc` A-G gerou `manual-qa-status.json` em `2026-05-11T11:54:18.251Z`. Isto **nao** promove `support_status` e nao transforma Phase D em AST.

**Nota host/QA (2026-05-10, rodada 31):** a barra completa foi rerodada neste host apos preparar Rust/MSVC/`tauri-driver`/WiX. `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` passou **7/7** (`BLAZE_ENGINE` continua blocker legitimo auditavel, sem assert de ROM), `validate-upstream-windows.ps1 -SkipRustTests` ficou `success=true`, `preflight:sgdk-e2e` ficou `Ready: SIM` e `qa-rc` A-G gerou `manual-qa-status.json` em `2026-05-10T19:51:16.583Z`. Isto **nao** promove `support_status` e nao transforma Phase D em AST.

**Nota IDE (2026-05-02, rodada 29):** a matriz deste ficheiro continua centrada em **Rust/corpus/build**. **Prova desktop IDE** continua no runner **`npm run test:e2e:desktop:qa-rc`**; nesta rodada o bloco G passou com evidencias especificas de cena importada, picker/solo em cena densa, tilemap authoring, objeto -> Logic -> fonte, Art -> Scene e reopen/build/ROM `SEGA` (`qa-rc-2026-05-02T05-14-22-572Z-*`). Isso **não** substitui as linhas de corpus abaixo e **nao** promove `support_status`; complementa a barra de UX. Ver `docs/06_CURRENT_WAVE_AI_BANK.md`.

**Cobertura por genero (codigo):** existem **sete** testes Rust `#[ignore]` em `src-tauri/src/core/project_mgr.rs` (seis titulos-base + um corpus de estresse `BLAZE_ENGINE`). Os seis titulos-base mantem o contrato completo com assert de ROM `SEGA`; desde a rodada 42, `BLAZE_ENGINE` tambem exige build/ROM `SEGA` por perfil de compatibilidade conservador, mantendo o blocker original visivel antes da transformacao. Ausencia do doador com `--ignored` => **panic**, salvo `RDS_SGDK_MATRIX_CORPUS_SKIP=1`. Isto nao promove `support_status`.

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

**Ultima revalidacao registrada nesta sessao (2026-05-13, rodada 40, branch `codex/sgdk-nocode-production-ui`):** `npm run check:tree` OK, `npm run lint` OK, `npx tsc --noEmit` OK, `npm test` (**301** passed), `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` OK, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1` (**333** passed / **11** ignored), `cargo test sgdk_corpus_inventory_real_corpus_report --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` OK (**122** projetos), `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (**7** passed), `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\validate-upstream-windows.ps1 -SkipRustTests` OK, `npm run preflight:sgdk-e2e` (**Ready: SIM**), `npm run test:e2e:desktop:qa-rc` (**OK**, evidencias `qa-rc-2026-05-13T01-31-23-216Z-*`), `npm run build:debug`, `npm run build:portable` e `npm run build:msi` (**OK**). SGDK segue **Experimental**; sem promocao de `support_status`.

---

**Atualizacao 2026-04-25 (rodada 19):** a barra acima foi rerodada nesta sessao e permaneceu verde com `cargo test sgdk_matrix_corpus_ ... --ignored` = `7/7`, `validate-upstream-windows -SkipRustTests` = `success=true` e `qa-rc` = bloco G importado SGDK `passed`. Operacionalmente, o gate oficial Windows deixou de depender de `%OS%` herdado e o launcher do make SGDK em Windows passou a exportar `OS=Windows_NT`, evitando falsos ramos Linux (`m68k-elf-gcc`) ao reconstruir a prova upstream no host.

**Complemento 2026-04-26 (rodada 20):** a barra completa foi rerodada nesta sessao com `npm test` (`272` testes), `cargo test --lib` (`320 passed / 0 failed / 10 ignored`), `cargo test sgdk_matrix_corpus_ ... --ignored` (`7/7`, `156.49s`), `validate-upstream-windows -SkipRustTests` (`success=true`, `processSweep.strategy=get-process`), `npm run preflight:sgdk-e2e` (`Ready: SIM`) e `npm run test:e2e:desktop:qa-rc` (`code=0`, `manual-qa-status.json` em `2026-04-26T05:19:54.185Z`, blocos A-G `passed`). Em paralelo, a Fase D passou a materializar semantica importada por entidade (`ImportedLogicSemantics`, `driver_functions`, `source_paths`, `entity_role`) sem alterar o contrato desta matriz: continua sendo prova de corpus/build, nao promocao de `support_status`.

## Manutencao da arvore (`check:tree`)

A pasta `target-test-corrupt-salvage` na raiz do repo violava `scripts/check-tree.cjs` e, neste host, nao podia ser apagada de forma fiavel enquanto nao estava vazia (conteudo foi movido antes com `Move-Item`). Estado final: **diretorio removido da raiz do RetroDevStudio**; conteudo/arquivo residual, se existir, ficou sob:

`F:\Projects\_RetroDevStudio_corrupt_salvage_relocated\`

---

## Matriz por projeto (preenchimento honesto)

Legenda de resultado: **Passou** | **Parcial** | **Falhou** | **Pendente** (ainda nao executado nesta rodada).

Para cada linha, ao executar no editor: import SGDK -> relatorio/ledger -> cenas -> tilemaps -> animacoes -> collision map -> `graph_ref` -> salvar/reabrir -> build/ROM (quando aplicavel). Registrar **blocker concreto** em Parcial/Falhou.

| # | Pasta do corpus | Genero / nota | Import | Report/Ledger | Cenas | Tilemaps | Anim. | Collision | graph_ref | Salvar/Reabrir | Build/ROM | Resultado | Blocker / evidencia |
|---|------------------|---------------|--------|---------------|-------|----------|-------|-----------|-----------|----------------|-----------|-----------|---------------------|
| 1 | `Platformer 2 [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]` | Plataforma | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Parcial** | Evidencia: `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` (rodada 13, 2026-04-23). `MATRIX_P2 signals`: `resolution_kind=direct`, `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=2`; `MATRIX_P2 build: rom_sega=true`. Mantem **Parcial** por governanca (coluna Collision + SGDK ainda **Experimental**; sem promocao de `support_status`). |
| 2 | `PlatformerEngine [VER.1.0] [SGDK 211] [GEN] [ENGINE] [PLATAFORMA]` | Engine plataforma | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Passou** | Evidencia (rodada 13, 2026-04-23): import a partir da pasta **REFERENCE** / `build_policy=disabled` do corpus; `resolve_sgdk_import_root` segue cadeia declarada (README backticks + `.mddev` da variante + `sgdk_root` -> upstream). `MATRIX_PE signals`: `resolution_kind=mddev_reference_redirect`, `redirected=true`, `effective_root=...PlatformerEngine Toolkit...\\upstream\\PlatformerEngine`, `source_kind=imported_sgdk`, `imported_scenes=1`, `warnings=3`; `MATRIX_PE build: rom_sega=true`. Metadata `template_metadata.source_path` continua a apontar para o doador **solicitado** (alias); ledger/report registam `effective_root`. |
| 3 | `Shadow Dancer Revisitado [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]` | Plataforma | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Passou** | Evidencia rodada 12 (2026-04-22): `MATRIX_SD signals`: `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=8`, `warnings=8`; `MATRIX_SD build: source_kind=imported_sgdk mode=sgdk_detect rom_sega=true`. Reavaliado com contrato correto (metadata stamp) — blocker de VRAM fatal removido como falso-positivo de prova anterior. |
| 4 | `Metal Slug Warfare Demo [VER.001] [SGDK 211] [GEN] [ESTUDO] [RUN AND GUN]` | Run and gun | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Passou** | Evidencia rodada 14 (2026-04-23): `MATRIX_MS signals` passou e build com ROM `SEGA`; novo breakdown `MATRIX_MS hw`: `mode=sgdk_managed`, `total_kb=5240`, `resident_kb=45`, `streamable_kb=5194`, `dma_frame_kb=1313`, `fatal=0`, `warn=5`. O excesso no volume total deixa de bloquear sozinho; leitura explicita de residencia e DMA. |
| 5 | `Mortal Kombat Plus [VER.001] [SGDK 211] [GEN] [ENGINE] [LUTA]` | Luta | Passou | Passou | Passou | Passou | Passou | Parcial | Passou | Passou | Passou | **Passou** | Evidencia rodada 14 (2026-04-23): `MATRIX_MK signals` passou e build com ROM `SEGA`; breakdown `MATRIX_MK hw`: `mode=sgdk_managed`, `total_kb=1002`, `resident_kb=33`, `streamable_kb=969`, `dma_frame_kb=258`, `fatal=0`, `warn=4`. Modelo separa claramente volume total de conjunto residente. |
| 6 | `NEXZR MD [VER.001] [SGDK 211] [GEN] [GAME] [SHMUP]` | Shmup | Passou | Passou | Passou | Passou | Passou | Passou | Passou | Passou | Passou | **Passou** | Evidencia rodada 12 (2026-04-22): `MATRIX_NEXZR signals`: `source_kind=imported_sgdk`, `tilemap_cells_nonempty=true`, `sprite_anim_nonempty=true`, `collision_present=true`, `graph_ref_nonempty=true`, `imported_scenes=5`, `warnings=0`; `MATRIX_NEXZR build: source_kind=imported_sgdk mode=sgdk_detect rom_sega=true`. |
| 7 | `BLAZE_ENGINE [VER.001] [SGDK 211] [GEN] [ENGINE] [BRIGA DE RUA]` | Beat 'em up (estresse) | Passou | Passou | Passou | Passou | Passou | Passou por bridge/compat | Passou | Passou | **Passou por compat real** | **Coberto por modo compativel** | Evidencia rodada 43 (2026-05-14): `sgdk_matrix_corpus_blaze_engine_partial_flow_documents_build_blocker --ignored` passou com SGDK real e Libretro real. O teste confirma blocker original antes da transformacao, aplica `SGDK compatibility profile` com `sprite culling`, `multiplex`, breakdown `MD VRAM analysis` com `spr_res=`/`banks=`, gera ROM real e roda Genesis Plus GX por 60 frames (`non_black_pixels=71680`). Nao declara equivalencia visual 1:1 do original; declara modo compativel conservador coberto. |

**Nota de reavaliacao (rodada 12, 2026-04-22):** o helper da matriz segue o contrato do wizard/IPC: apos `import_sgdk_project`, `stamp_imported_sgdk_metadata` e `source_kind=imported_sgdk` antes do build; overflow VRAM em corpus deixou de ser falso bloqueador fatal onde aplicavel.

**Rodada 13 (2026-04-23):** `resolve_sgdk_import_root` em `src-tauri/src/core/project_mgr.rs` resolve raiz SGDK com no maximo dois saltos de wrapper, candidatos apenas de caminhos explicitos (`.mddev` `sgdk_root`, `notes` entre backticks, `README.md` entre backticks), um unico candidato buildavel aceite com **warning** auditavel; zero ou varios candidatos -> `LoadError` guiado. Linha 2 do corpus passou (`mddev_reference_redirect`); suite `sgdk_matrix_corpus_` **6/6** `ok` neste host com corpus montado.

### Linha 1 - como repetir a prova (Platformer 2)

Teste Rust ignorado no suite normal (nao corre em CI sem `--ignored`):

```text
cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1
```

Requer o doador no caminho absoluto acima (ou `RDS_SGDK_MATRIX_CORPUS_SKIP=1` para saltar explicitamente sem corpus). Saida util: linhas `MATRIX_P2 signals:` e `MATRIX_P2 build:` no stdout.

### Linhas 2 a 7 — mesma suite, tags distintas no stdout

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
| 7 | Beat 'em up (estresse) | `sgdk_matrix_corpus_blaze_engine_partial_flow_documents_build_blocker` | `MATRIX_BLAZE` |

**Proximo passo de governanca:** executar cada linha no host com corpus, copiar para a matriz as colunas Passou/Parcial/Falhou e o texto de evidencia (como na linha 1). Opcional (demorado, use `--test-threads=1` para nao paralelizar builds SGDK): `cargo test sgdk_matrix_corpus_ --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1` corre os seis testes que casam o prefixo; doador em falta sem `RDS_SGDK_MATRIX_CORPUS_SKIP=1` => **panic** naquele teste; com skip `=1`, o teste em falta retorna sem falhar e os restantes continuam.

---

## Criterio de suporte "completo" (nao satisfeito)

So considerar SGDK fora de **Experimental** quando **os seis** fluxos acima forem **Passou** com evidencia repetivel, documentacao de falhas residuais (se houver) e **todos** os gates desta pagina verdes na mesma revisao - sem regressao em CI/local.

---

## Rodada documental

- **Rodada 9** (ja descrita em `docs/06_CURRENT_WAVE_AI_BANK.md`): Fase E com prova `qa-rc` A-G no host.  
- **Rodada 11 (esta matriz):** formaliza o **programa de corpus real** e os gates; nao altera promocao de `support_status`.
- **Rodada 12 (2026-04-22):** reexecucao da suite com `stamp_imported_sgdk_metadata` + assert de `source_kind`; cinco linhas com Build/ROM `SEGA` ate resolver wrappers (linha 2 bloqueava por `.res` apenas no alias).
- **Rodada 13 (2026-04-23):** resolucao auditavel de raiz SGDK; suite `cargo test sgdk_matrix_corpus_ ... --ignored` **6/6** com `rom_sega=true` no host de referencia; `npm run preflight:sgdk-e2e` e `npm run test:e2e:desktop:qa-rc` rerodados com sucesso apos `d24cf14`. SGDK continua **Experimental**.
- **Rodada 14 (2026-04-23):** modelo de residencia/streaming VRAM para SGDK gerenciado (`project_asset_bytes`, `resident_vram_bytes`, `streamable_vram_bytes`, `dma_frame_bytes`, `analysis_mode`). Suite `sgdk_matrix_corpus_` ampliada para **7/7**: seis titulos-base continuam com ROM `SEGA`; `BLAZE_ENGINE` entra como corpus de estresse com blocker fatal legitimo e auditavel.
- **Rodada 18 (2026-04-25):** sem mudar a matriz de corpus em si, o host voltou a fechar a barra completa (incluindo `validate-upstream-windows -SkipRustTests`, `preflight:sgdk-e2e` e `qa-rc`) depois da consolidacao do `asset visual state` canonico e do fallback auditavel do gate oficial Windows. `manual-qa-status.json` desta rodada voltou a fechar o bloco G do importado SGDK com screenshot `G - sgdk import reopen build rom`.
- **Rodada 19 (2026-04-25):** a matriz Rust/corpus continuou verde (`7/7`) e o desktop voltou a provar o fluxo SGDK importado com o bloco G do `qa-rc`. Operacionalmente, o gate oficial Windows deixou de depender de `%OS%` herdado e o launcher do make SGDK em Windows passou a exportar `OS=Windows_NT`, evitando falsos ramos Linux (`m68k-elf-gcc`) ao reconstruir a prova upstream no host.

- **Rodada 20 (2026-04-26):** a matriz Rust/corpus voltou a passar (`7/7`, `156.49s`) e o desktop confirmou novamente o fluxo importado no `qa-rc` com `manual-qa-status.json` desta rodada (`2026-04-26T05:19:54.185Z`, blocos A-G `passed`). O gate oficial Windows passou com `processSweep.strategy=get-process` apos timeout real de CIM/WMI, registrando a degradacao no report em vez de esconder fallback manual.
- **Rodada 21 (2026-04-28):** corpus Rust manteve `7/7` e o gate oficial Windows voltou a passar com upstream real; `preflight:sgdk-e2e` ficou `Ready: SIM`. O `qa-rc` falhou no build desktop por OOM de `rustc` (`tauri-utils`) e foi registrado como blocker de host/build (sem falso verde). SGDK segue **Experimental** e a matriz continua sem promover `support_status`.
- **Rodada 22 (2026-04-29):** o `qa-rc` voltou a passar no host canônico apos mitigacao controlada de memoria aplicada apenas ao cenario `qa-rc` (redução de paralelismo e custo do perfil dev no build desktop). `validate-upstream-windows -SkipRustTests` e `preflight:sgdk-e2e` tambem permaneceram verdes. SGDK segue **Experimental** e a matriz continua sem promover `support_status`.
- **Rodada 23 (2026-04-29):** sprint focada em operacionalizar o editor para cenas importadas (viewport mundo/camera, staging de cena densa, fluxo tilemap acionavel, navegacao objeto->logica->objeto/fonte e Art Workspace sincronizado com entidade selecionada), com revalidacao completa da barra de gates listada acima. Resultado manteve corpus/build verdes sem mudar `support_status`; SGDK continua **Experimental**.
- **Rodada 24 (2026-04-30):** na mesma branch, reforco de **autoria no viewport** (avisos mundo/colisao -> acoes) + papel **`hud_actor`** no materializado Phase D; barra de gates do bloco acima rerodada no host com numeros no paragrafo "Ultima revalidacao". Matriz de linhas 1-7 **inalterada** em promocao/resultado por projeto; continua imperativo nao confundir prova IDE `qa-rc` com "Passou" institucional da matriz onde a linha ainda e Parcial/Falhou.
- **Rodada 25 (2026-04-30):** incrementos de **UX operacional** no editor (viewport denso, duplo-clique tilemap/logic, faixa de fluxo tilemap, graph com fonte + inferencia, Art sem sprite) com rerodagem completa dos gates; matriz de corpus por linha **inalterada**; BLAZE e linhas Parcial/Falhou mantem-se como limites honestos de autoria/build.
- **Rodada 29 (2026-05-02):** nova prova IDE no `qa-rc` (`qa-rc-2026-05-02T05-14-22-572Z-*`) cobre composicao de cena, pilha densa com solo, tilemap authoring, objeto -> Logic -> fonte, Art -> Scene e reopen/build/ROM. A suite Rust de corpus continua **7/7** no host, com `BLAZE_ENGINE` como blocker legitimo auditavel. Matriz de linhas 1-7 **inalterada** em promocao/resultado por projeto; SGDK segue **Experimental** e `support_status` permanece inalterado.
- **Rodada 31 (2026-05-10):** host Windows preparado e barra completa rerodada: baseline frontend/Rust verde, corpus `sgdk_matrix_corpus_` **7/7**, upstream oficial `success=true`, preflight `Ready: SIM`, `qa-rc` A-G fresco e packaging portable/MSI gerado. Matriz por linha **inalterada**; `BLAZE_ENGINE` continua blocker legitimo auditavel, Phase D continua heuristica e SGDK segue **Experimental**.
- **Rodada 32 (2026-05-11):** host Windows rechecado e barra completa rerodada: baseline frontend/Rust verde, corpus `sgdk_matrix_corpus_` **7/7**, upstream oficial `success=true`, preflight `Ready: SIM`, `qa-rc` A-G fresco e packaging portable/MSI gerado. Matriz por linha **inalterada**; `BLAZE_ENGINE` continua blocker legitimo auditavel, Phase D continua heuristica e SGDK segue **Experimental**.
- **Rodada 43 (2026-05-14):** fake removido da prova Stable. Corpus real fechou **122/122 cobertos**, **68** build/ROM/emulacao reais, **54** bridges formais, **0 falhas**, `stable_candidate=true`; jogo no-code real e BLAZE real passaram com SGDK oficial + Genesis Plus GX.

### Resolver de raiz SGDK (import canonico)

Implementacao: `resolve_sgdk_import_root` (antes de `validate_sgdk_project_path` / `load_sgdk_resources`). Tipos de resolucao: `direct`, `mddev_sgdk_root`, `mddev_reference_redirect`. Relatorio `SgdkSourceSummary` e ledger `.rds/imports/sgdk/*.json` expoem `donor_root` (path pedido), `effective_root`, `resolution_kind`, avisos e lista de caminhos declarados (sugestoes / auditoria). Testes dedicados: `sgdk_resolver_follows_mddev_reference_chain_to_upstream_root`, `sgdk_resolver_fails_when_reference_declares_multiple_buildable_candidates`.
