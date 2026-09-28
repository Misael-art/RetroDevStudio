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

## 5. Checksum SGDK no patch — decisão do integrador (política NÃO alterada)

Hoje o patch só reescreve `0x18E` quando a base tem soma MD aditiva válida. As ROMs do
pipeline usam o XOR SGDK (`rom_mastering::sgdk_checksum`), então a ROM patcheada sai com
`inspect_rom_mastering → mismatch` (evidência na rodada 2).

Opções:

- **A (recomendada):** quando `sgdk_checksum(base) == gravado`, recalcular o XOR SGDK na
  saída, com `0x18E..0x190` como faixa autorizada declarada. Com isso, patch =
  recompilação SGDK byte a byte (já verificado no teste).
- **B:** manter o campo como está e expor `checksum_status: "stale_sgdk"` no DTO, com a
  UI avisando.

Com a opção A, a função precisa vir do produto (`rom_mastering`), porque a crate não
depende dele. O adaptador calcularia o valor e passaria à crate como faixa autorizada.
É uma mudança pequena no meu território, que só faço após o OK.

## 6. Localização no produto

Qualquer comando de "localizar" deve usar `rex_gameplay::locate` (lista candidatos e
quase-casos) ou `locate_unique` (recusa com 0 ou >1). A UI deve mostrar a lista e exigir
que o usuário escolha. Nunca pegar `candidates[0]`.

## 7. Expectativas para o E2E pela interface (dono: integrador)

Valores medidos na camada técnica (core direto), com builds reprodutíveis do template
`reference_platformer`, projeto "Rex Gate":

| Passo | Expectativa |
|---|---|
| localizar na ROM original (`86c4e90d…4f7e`) | 1 candidato: entrada `0x000946`, saída `0x000970` |
| recuperar | operador `>=`, limiar 6, faixa editável `[-127, 128]`, 9 nós (inclui `external_call` com `understood=false`) |
| editar limiar 12 → salvar → reabrir | `threshold=12`; os mappings continuam iguais; um grafo adulterado é recusado |
| reconstruir por patch | SHA `4030ec74…b1db`, `changed=[0x961]` (checksum: ver §5) |
| reconstruir por regeneração | mesmo SHA do patch |
| executar, segurando Right a partir de `score=0` | a original abre em score 6; a editada em **12**; `spr_player_x` preso em 36 enquanto `score < 12` |
| controle de ROM antiga | executar a original com a expectativa "abre em 12" tem de **falhar** |

O E2E precisa registrar o SHA da ROM carregada no core. Assim, uma resposta ou imagem
antiga reutilizada é detectada.

## 8. Revisão do adaptador

Quando os comandos Tauri existirem, eu reviso o adaptador (somente leitura, comentários no
PR do integrador). Pontos que vou conferir:

- saída distinta e inexistente;
- SHA da base obrigatório;
- `locate_unique` ou lista, sem escolha implícita;
- execução fora do thread principal;
- DTO com `limitations` e `understood=false` visível.
