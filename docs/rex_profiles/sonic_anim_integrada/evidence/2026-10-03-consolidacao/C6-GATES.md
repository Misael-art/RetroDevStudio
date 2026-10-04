# C6 — Gates no destino + base da proposta integrada (2026-10-03)

Destino: branch `codex/rex-sonic-consolidacao`, HEAD `2a3d842` (esta frente de
consolidação sobre #99→#102). Host `READY` (`host:diagnose`, fingerprint
`60249508…`, lock `dd99a22f…`).

## Base da proposta integrada (C1 reconciliado)

A linhagem do Sonic é **linear sobre o tronco do integrador**, não sobre
`origin/main`:

- `origin/main` está **~555 commits atrás** de `#102` — o corpo REX inteiro
  (nodegraph/mugen/corpus/kosinski/addressing) vive em branches ainda não
  integrados ao `main` canônico. Um PR `base:main` arrastaria tudo isso.
- `codex/rex-integrator-consolidation` (`0ef540e`, cabeça da #98) é **ancestral
  direto** de `#99..HEAD` (`git merge-base --is-ancestor` = YES).
- Portanto a proposta integrada = PR **base `codex/rex-integrator-consolidation`
  ← head `codex/rex-sonic-consolidacao`**: 59 commits, 15 arquivos de produto
  (`src`+`src-tauri/src`, +4442/−553), 89 arquivos de docs/evidência. Sem
  duplicar commits, sem perder fix, sem puxar o corpo não-integrado do REX.

## Gates executados no destino (serializados; um cargo por vez)

| Gate | Comando | Resultado | Log SHA-256 |
|---|---|---|---|
| Estrutura | `npm run check:tree` | OK (conforme `docs/08_TREE_ARCHITECTURE.md`) | `97e11479…` |
| Lint FE | `npm run lint` (`--max-warnings=0`) | OK, 0 saída | `1382871e…` |
| Tipos | `npx tsc --noEmit` | OK | `40194098…` |
| Testes FE | `npm test` | **930 passed / 6 skipped** (99 arquivos ok / 1 skip) | `556fda8c…` |
| Clippy (lib) | `cargo clippy --all-features -- -D warnings` | **exit 0, 0 warnings**, Finished 3m09s | `dfb7f4f1…` |
| fmt | `cargo fmt --check` | OK (log vazio = sem diff) | `e3b0c442…` |
| Testes Rust | `cargo test --lib -- --nocapture` | **850 passed / 0 failed / 80 ignored** (51.78s) | `cdcac6cf…` |
| Certificação host | `npm run host:certify` | **state READY, blockers []** (mode certify, `2026-10-04T00:54:59Z`) | `35bceca6…` |

Diagnóstico de partida: `host:diagnose` → READY (`e8db0387…`).

Log do `host-readiness.json` regravado pela certificação:
`src-tauri/target-test/validation/host-readiness.json` (gitignored), estado
READY, blockers vazio, gates vazio (nada pendente).

## Reconciliação honesta (regra da frente)

- **`cargo clippy --all-targets`**: NUNCA verde neste repo (46 falhas
  pré-existentes em código de teste). Rodou-se o gate da barra mínima (`-D
  warnings` no alvo de biblioteca) → OK. `--all-targets` permanece **não
  aprovado**, não "aprovado".
- **Audits de segurança** (`npm run security:audit`, `cargo audit`): NÃO
  executados localmente aqui — dependências **inalteradas** na faixa (diff vazio
  de `package.json`/locks/`Cargo.toml`/`Cargo.lock`); o CI remoto os roda.
  Registrado como "não executado nesta frente", não "aprovado".
- **Usabilidade humana**: nenhum participante; a entrega **não** declara
  usabilidade.
- **Validação manual com dependências oficiais** (build→ROM→emulação reais):
  coberta pelas jornadas E2E desktop das frentes #100/#101/#102 (reproduzidas no
  destino em C3/C4 com Xvfb/ROM pinados); não repetida aqui por serialização de
  trabalho pesado.

## Publicação

- Push **normal** (não-forçado) do branch `codex/rex-sonic-consolidacao`.
- PR **base `codex/rex-integrator-consolidation`** (proposta revisável).
- **Sem merge remoto, sem release, sem promoção, sem push forçado.**
- CI terminal confirmado por SHA fixo (um push por lote; sem monitor vivo de CI).
