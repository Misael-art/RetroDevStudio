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
