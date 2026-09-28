# Proposta de integração — MUGEN → SGDK (frente `codex/rex-mugen-sgdk`)

Arquivos do integrador **não editados em paralelo**: `lib.rs`, IPC, UI, harness E2E, Memory Bank
e ROUND_STATE. As mudanças compartilhadas estão em commits separados marcados como PROPOSTA.

## 1. Território desta frente

- `crates/rex-mugen/**`: núcleo, fixtures Probe, Sentinel e Warden, e o contrato.
- `src-tauri/src/core/mugen_profile.rs`: adaptador e testes, incluindo as provas reais.
- `src-tauri/src/compiler/mugen_runtime.rs`: runtime gerado.
- `docs/rex_profiles/mugen_sgdk/**` e `data/rex_profiles/mugen_sgdk/**`.

## 2. Código compartilhado alterado (revisão do integrador)

| Arquivo | Mudança | Commit |
|---|---|---|
| `crates/registry.json`, `src-tauri/Cargo.toml`/`Cargo.lock`, `core/mod.rs` | registro da crate, path-dep (zero crates externos), `pub mod mugen_profile` | PROPOSTA `03dfbf3`, `56036c4` (Cargo.lock) |
| `compiler/ast_generator.rs` | `SpriteAnimation::mugen`, nó `sprite_anim_done` → `LogicBoolExpr::SpriteAnimDone` | `e1f96af` |
| `compiler/sgdk_emitter.rs` | 3 ganchos (declarações, tick antes de `SPR_update`, condição) | `e1f96af` |
| `compiler/snes_emitter.rs` | `sprite_anim_done` bloqueia o build | `e1f96af` |
| `compiler/mod.rs`, `build_orch.rs` (testes) | `pub mod mugen_runtime`; `mugen: None` em construções de teste | `e1f96af` |
| `core/project_mgr.rs` (seção MUGEN) | perfil no importador de personagem, comportamento ligado, contenção de caminhos, validação antes de gravar | `1cbd856`, `850154b` |

Os testes MUGEN herdados continuam verdes, incluindo o que exige nós VelSet/PosSet/PlaySnd.
Esses nós agora levam `wired: false` e aparecem como `unsupported` no relatório.

## 3. O IPC já usa o conversor

O comando Tauri existente `import_mugen_project` (`lib.rs`) chama o mesmo
`project_mgr::import_mugen_project`. Isso tem duas consequências:
- a importação pela UI já passa pelo perfil v1 e grava
  `assets/mugen/<id>_import_report.json`;
- ela importa num diretório de projeto novo (`reserve_project_dir`), o que preserva o pacote
  de origem.

**Não verificado pela UI**: nenhum teste desta frente passou pela interface.

## 4. Pedidos pequenos (dono: integrador)

1. **Falha não pode deixar projeto aparente.** Em `import_mugen_project_at_base_dir`, se
   `import_mugen_scene` falhar, remover o diretório que acabou de ser reservado. Hoje o
   esqueleto vazio fica no disco.
2. **Aviso honesto.** Trocar "Importação MUGEN experimental concluída" por um resumo do
   relatório: contagens por fidelidade (`direct`/`approximate`/`unsupported`) e o caminho do
   relatório. Exemplo:
   `Personagem importado (Experimental): 7 direto, 2 aproximado, 3 não suportado — ver relatório.`
3. **DTO.** Acrescentar ao `OpenProjectResult` (ou a um comando
   `inspect_mugen_import_report(project_dir)`) o conteúdo do relatório para a UI.

## 5. Fluxo de UI proposto (reutilizando o wizard de importação existente)

1. **Selecionar a origem**: a pasta do pacote (o wizard atual).
2. **Entender a compatibilidade**, antes de gravar: executar o plano sem gravar. Um comando
   novo, `preview_mugen_import(mugen_path)`, devolveria o relatório (recursos, comportamento,
   diagnósticos com a ação sugerida, métricas com unidade e origem; indisponível como "—" e
   nunca 0).
3. **Importar**: o comando atual.
4. **Revisar personagem e animação**: o Inspector de sprite existente mostra
   `frame_durations`, `loop_start` e flips/caixas de `mugen_frames`. As animações `approximate`
   ou `unsupported` recebem um selo Experimental com o `reason` e a `consequence`.
5. **Editar**: durações e `loop_start` no Inspector. Valores inválidos são recusados já na
   edição, com a mesma regra que bloqueia o build (−1 ou 1..255; `loop_start` menor que o
   número de frames).
6. **Compilar e jogar**: o fluxo canônico `Build → ROM → Emulação`.

## 6. Expectativas para o E2E pela interface (fixture Probe)

| Passo | Expectativa |
|---|---|
| importar `crates/rex-mugen/fixtures/probe` | entidade `probe`, célula 32×24, pivô (6, 24); relatório com `anim:200` e `palette` = `direct` |
| editar `action_200.frame_durations[1]` para 12 no Inspector e salvar | reabrir mostra `[3,12,4,2]` |
| compilar e jogar; pressionar A (teclado) | soco: 3 quadros com punho à direita, 12 com corpo amarelo, 4 com punho à esquerda do eixo (102,120), depois o idle |
| controle | a ROM sem a edição mostra 6 quadros de corpo amarelo |

## 7. Maturidade

Não passar de `biblioteca-implementada` / `gates-proprios-aprovados` para a crate. O importador
continua **Experimental**. Não promover para "fluxo do usuário" antes do E2E pela interface.

---

## 8. Atualização — rodada de interface (commits `fe66639..6d07c39`)

### 8.1 Pedidos do §4 atendidos nesta frente

| Pedido | Feito em | Arquivo |
|---|---|---|
| 1. Falha não deixa projeto aparente | `abbdb95` | `src-tauri/src/lib.rs` (**do integrador**; commit isolado): `reserved_dir_origin` + `discard_failed_import` nas duas funções de importação |
| 2. Aviso honesto | `abbdb95` + `ac65958` | `lib.rs` anexa `mugen_profile::summary_line`; a UI registra o resumo por personagem |
| 3. Relatório para a UI | `ac65958` | **Sem DTO novo**: a UI lê `assets/mugen/*_import_report.json` pelos comandos existentes `list_project_assets` e `read_project_asset_bytes` |

### 8.2 Arquivos compartilhados tocados nesta rodada (curadoria)

| Arquivo | Mudança |
|---|---|
| `src-tauri/src/lib.rs` | limpeza na falha e aviso com resumo (acima) |
| `src/App.tsx` | estado e abertura do painel após importar com perfil `mugen`/`ikemen_go`; `testId="external-import-confirm"`; automação `setNextExternalImportPath` (substitui só o diálogo nativo) e `mugenCompatibility` no `getState` |
| `src/core/diagnostics.ts` (+ teste) | causas específicas de falha MUGEN |
| `scripts/e2e-tauri-build-run.mjs` | cenário `mugen-import` (função isolada + registro + despacho + timeout de bootstrap); commit `6d07c39` isolado |
| `package.json` | **não alterado**. Sugestão: `"test:e2e:desktop:mugen": "node scripts/e2e-tauri-build-run.mjs --scenario mugen-import"` |

Arquivos novos desta frente:
- `src/components/common/MugenCompatibilityPanel.tsx` (+ teste);
- `src/core/mugenCompatibility.ts`.

### 8.3 Pendências para o integrador

1. **Conflito de base.** Um conflito trivial em `src-tauri/Cargo.toml` ao integrar sobre `00f9d29`:
   manter as duas linhas de path-dep (`rex-gameplay` e `rex-mugen`).
2. **Inspector.** Para animações com `mugen_frames`, esconder ou marcar como sem efeito o campo
   "FPS", e expor `frame_durations`/`loop_start` editáveis, com a mesma validação que bloqueia o
   build (−1 ou 1..255; `loop_start` menor que o número de frames).
3. **Reabrir o painel.** Ação "Ver compatibilidade MUGEN" no Inspector da entidade importada
   (o `inspector-imported-context` existente), que abre o mesmo `MugenCompatibilityPanel`.
4. **Prévia antes de gravar.** `preview_mugen_import` (proposta do §5, passo 2) continua não
   implementada: hoje o usuário entende as perdas logo **depois** de importar. Como uma falha não
   deixa projeto, o risco é baixo.
5. **E2E pelo teclado.** Acrescentar ao cenário `mugen-import` o soco da Probe pelo teclado real
   (A), com a expectativa da §6.
6. **Memory Bank.** Proposta de texto em `MEMORY_BANK_PROPOSAL.md` (esta frente não edita o
   Memory Bank).
