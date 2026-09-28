# Proposta de integração — recuperação de regra de gameplay (frente própria)

Dono dos arquivos compartilhados: **integrador**. Esta frente não registra
comandos, não edita UI compartilhada, não toca Memory Bank nem ROUND_STATE.

## Território exclusivo desta frente (sem conflito)

- `crates/rex-gameplay/**` (pacote standalone, zero dependências)
- `src-tauri/src/tools/reverse/decomp/rex_gameplay.rs` (adaptador + prova real)
- `docs/rex_profiles/gameplay_recovery/**` (relatório, proposta, evidência)

## Alterações compartilhadas já feitas no branch, em commit separado, para curadoria

| Arquivo | Mudança | Por quê |
|---|---|---|
| `crates/registry.json` | entrada `rex-gameplay` (maturidade `gates-proprios-aprovados`) | sem ela `check:tree` reprova o diretório |
| `src-tauri/Cargo.toml` | `rex-gameplay = { path = "../crates/rex-gameplay" }` | adaptador |
| `src-tauri/Cargo.lock` | só a entrada do pacote local, zero crates externos | idem |
| `src-tauri/src/tools/reverse/decomp/mod.rs` | `pub mod rex_gameplay;` | registro do adaptador |

O integrador pode aceitar, reescrever ou descartar esse commit sem afetar o pacote.

## Não feito — proposta concreta para o integrador

### 1. Comandos Tauri (`src-tauri/src/lib.rs`)

```rust
#[tauri::command]
async fn rom_recover_gameplay_gate(rom_path: String, entry: u32, exits: Vec<u32>)
    -> Result<rex_gameplay::GameplayRecoveryDto, String>;          // recover_gameplay_gate
#[tauri::command]
async fn rom_edit_gameplay_threshold(graph_json: String, threshold: i64) -> Result<String, String>;
#[tauri::command]
async fn rom_rebuild_gameplay(base_path: String, expected_sha256: String, graph_json: String,
    output_path: String, method: String) -> Result<GameplayRebuildDto, String>; // "patch" | "regenerate"
```

Executar fora do fio principal com `run_heavy_command_off_main_thread` (mesmo padrão de
`rex_addressing_read_snapshot`) e registrar em `generate_handler!`.

### 2. Frontend (`src/core/nodegraph/*`, `ReverseWorkspace.tsx`, `toolsService.ts`)

- 7 tipos de nó em `nodeTypes.ts`/`nodeCatalog.ts`/`nodeDefinitions.ts`, categoria
  `bridge_source_mapping`, rótulo **Experimental**: `rom_region_entry`,
  `rom_input_bit_guard`, `rom_counter_add`, `rom_counter_compare` (único parâmetro
  editável: `threshold`, com `threshold_min/max` do próprio nó), `rom_state_write`,
  `rom_external_call` (exibir "não recuperado"), `rom_region_exit`.
- O Inspector deve mostrar `label` (editável, `label_origin: "user"`) separado de
  `semantic_origin` e dos `source_mappings`.
- Salvar = texto devolvido por `rom_edit_gameplay_threshold`; reabrir = qualquer
  chamada que passe o grafo pelo backend (`open_graph` recusa adulteração).
- Build: `rom_rebuild_gameplay(method="patch")` seguido do fluxo canônico de emulação.

### 3. E2E pela interface (harness principal, dono: integrador)

Passos a acrescentar a `scripts/e2e-tauri-build-run.mjs`:
abrir ROM gerada do template → recuperar com entrada/saída do candidato →
editar limiar 6→12 no Inspector → salvar, fechar, reabrir, conferir limiar e
mapping → reconstruir por patch → executar pelo teclado nativo (Right) →
ler `logic_var_goal_open`/`spr_player_x` → exigir abertura em 12 e não em 6.

### 4. Matriz (`docs/rex_profiles/ROUND_STATE.md`) e Memory Bank

Nova linha "regra de gameplay (contador+limiar+estado)": `biblioteca-implementada`
e `gates-proprios-aprovados` com as evidências do relatório; **não** promover a
`backend-integrado` antes dos comandos existirem, nem a `fluxo-do-usuario-comprovado`
antes do E2E pela interface.
