# Barra reexecutada sobre a árbore final curada (PR #85 MUGEN -> SGDK)

Janela UTC: 2026-09-29T03:00Z–03:17Z. Branch `codex/rex-integrator-mugen-85`,
HEAD `b410de0bddf64666762f2d5c7984ed598dfeebcd` (merge curado do PR #85).

## Que se mediu aquí e por que

A barra de entrega do PR #85 executara antes, entre 02:08Z e 02:20Z, co E2E
desktop `mugen-import` (run7) entre 02:36Z e 02:50Z; esa evidencia está en
`../2026-09-28-integracao-integrador/`. Despois desa barra entraron na árbore
catro cambios de curaduría do integrador — `crates/registry.json` (entrada
`rex-mugen` reescrita ao esquema do integrador), `docs/rex_profiles/ROUND_STATE.md`,
`docs/06_AI_MEMORY_BANK.md` e a aserción de proxecto fantasma de
`scripts/e2e-tauri-build-run.mjs` (+4 liñas, a que run7 xa tiña aplicada). Como
dous deses arquivos (`registry.json` e o harness) son lidos por gates concretos,
a barra volveu executarse íntegra sobre a árbore final. Resultados:

| Gate | Comando | rc | Log | Medida |
|---|---|---|---|---|
| check:tree | `npm run check:tree` | 0 | `check-tree.log` | `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` |
| lint | `npm run lint` | 0 | `lint.log` | `eslint src vite.config.ts --max-warnings=0`, sen saída |
| tsc | `npx tsc --noEmit` | 0 | `tsc.log` | sen erros |
| npm test | `npm test` | 0 | `npm-test.log` | **812 passed / 0 failed / 6 skipped** (83 ficheiros passed, 1 skipped de 84) |
| cargo fmt | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 0 | `cargo-fmt.log` | baleiro |
| clippy (gate declarado) | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | 0 | `cargo-clippy.log` | `Finished` sen avisos |
| clippy `--lib` | `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` | 0 | `cargo-clippy-lib.log` | `Finished` sen avisos |
| cargo test --lib | `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture` | 0 | `cargo-test-lib.log` | **796 passed / 0 failed / 70 ignored** |
| crates:gates | `npm run crates:gates` | 0 | `crates-gates.log` | `OK: 4 pacote(s) registrado(s), gates proprios aprovados.` |
| harness sintaxe | `node --check scripts/e2e-tauri-build-run.mjs` | 0 | (non xera log; sen saída) | — |
| host:certify | `npm run host:certify` | 0 | `host-certify.log` | host **READY**, fingerprint `60249508aff61897cdd43160d4716b2344d69282507a36c5a457c0028143f6e2`, lock `dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377`, Rust 796/0/70, smoke oficial SGDK/PVSnesLib `Success: true` (`src-tauri/target-test/validation/upstream-validation-linux.json`) |

Contaxes idénticas ás da barra anterior (02:08Z–02:20Z): sen regresión nin deriva
entre as dúas execucións.

## O que NON se reexecutou e por que

O E2E desktop `mugen-import` **non** volveu executarse. Entre run7 (02:46Z) e
esta reexecución só mudaron `crates/registry.json` e tres documentos; ningún
byte de produto (`src/`, `src-tauri/src/`, `crates/*`), de fixture ou do propio
escenario `mugen-import` cambiou, e a aserción reforzada do paso
`negative_path_escape` xa estaba aplicada en run7. Polo tanto
`../2026-09-28-integracao-integrador/e2e-mugen-import-run7.log` segue sendo a
proba válida para o binario SHA-256
`1b46ff504ba3aacab59f27c3c3bb664fcf0d83428fc1499207acc507d31abb09`.

## Débeda coñecida que estes logs NON ocultan

`cargo clippy --all-targets` no backend reproba con 46 avisos de `#[cfg(test)]`
previos ao PR #85 (`rex_context` 18, `rex_aplib` 8, `rex_resources` 5,
`project_mgr` 5, `rex_codecs` 4 e 6 dispersos). O gate declarado neste
repositorio é `cargo clippy -- -D warnings` (sen `--all-targets`), que dá rc=0.
Das 45 localizacións únicas, **ningunha** cae nas liñas engadidas polo PR.
Rexistrada e non corregida nesta rolda.
