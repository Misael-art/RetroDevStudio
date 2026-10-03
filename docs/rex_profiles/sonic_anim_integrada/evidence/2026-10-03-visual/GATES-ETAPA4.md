# GATES-ETAPA4 — reconciliação dos gates com comandos realmente executados (2026-10-03)

Objetivo desta frente (ETAPA 4 da missão visual): nenhum gate aparece como
"aprovado" sem o comando correspondente ter sido executado neste worktree, com
resultado e contexto registrados. Regra aplicada: comandos não executados são
listados como **não executados** com o motivo — nunca como aprovados.

HEAD desta reconciliação: `3eb0cd0` + commits de docs da ETAPA 4 (mudança
exclusiva de documentação desde `a0067d8`, o HEAD do binário provado).

## Executados NESTE HEAD (frente visual, 2026-10-03)

| Comando | Resultado | Observação |
| --- | --- | --- |
| `npm run check:tree` | OK (exit 0) | "Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md" |
| `npm run lint -- --max-warnings=0` | OK (exit 0) | sem warnings |
| `npx tsc --noEmit` | OK (exit 0) | — |
| `npm test` (vitest) | OK (exit 0) | 930 passed, 6 skipped, 936 totais; 99 arquivos |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | OK (silent) | sem saída = limpo |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | OK (exit 0) | gate CANÔNICO apenas (ver abaixo) |
| `cargo test --lib -- --nocapture` | OK | 850 passed / 0 failed / 80 ignored |
| `npm run host:certify` | READY | fingerprint `60249508…`, lock `dd99a22f…`; inclui smoke SGDK e PVSnesLib oficiais e cargo test (850/0/80, `src-tauri/target-test/validation/host-readiness.json`) |

## Executados em `a0067d8` (HEAD do binário provado) e ainda válidos

- Build debug + jornada desktop `sonic-anim-integrada` pelo runner isolado:
  **allPass true, 28 checks, 0 falhas, 0 abortos**, sem
  `WEBKIT_DISABLE_COMPOSITING_MODE` no ambiente (E3-1), sprite visível pós-
  reabertura com 0 mismatches na 1ª captura (E3-2), prova offline
  discriminante (E3-3). Evidência:
  `report-jornada-retificada-e3-run01.json` (SHA-256 `507c1250…`) e
  `RESULTADO-VISUAL-ETAPA3.md`. Desde esse HEAD, a frente alterou apenas
  documentação — os gates acima foram re-executados e bateram os mesmos
  números.

## NÃO executados — registrados como tais (não aprovados)

- `cargo clippy --all-targets -- -D warnings`: **não aprovado**. A base já
  carrega 46 falhas preexistentes em código de teste (dívida registrada em
  `gates.json` da frente `sonic_cadence`, checkpoint PR #100/#101); a frente
  visual não as corrigiu nem as alegou. O gate canônico do AGENTS.md (sem
  `--all-targets`) está verde.
- `npm run security:audit` e `cargo audit --file src-tauri/Cargo.lock`:
  **não executados localmente**. Motivo: o AGENTS.md os exige quando
  dependências ou segurança mudam, e `git diff 8edf69d..HEAD -- package.json
  package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock` está vazio
  (zero mudança de dependências nesta frente). As duas auditorias rodam no
  workflow CI do PR e o veredito termina é acompanhado pelos checks da PR.
- Corrida do cenário `sonic-anim-visual-diagnostico` no binário final: **não
  executada nesta frente após `a0067d8`**. A perna E3-4 (remontagem hidratada)
  foi retificada e coberta em sua equivalente pela jornada integrada
  (`e34.banner_retomada_cede_apos_reabertura_explicita` verde); o re-run fica
  pendente apenas se a perna for citada como evidência de PR (registrado em
  `RESULTADO-VISUAL-ETAPA3.md`, seção pendências).
- Sessão humana de usabilidade: **não conduzida**. Nenhuma alegação de
  "iniciante consegue" é feita; a ETAPA 4 entrega o roteiro revisado
  (`CX-ROTEIRO.md`) pronto para aplicação com participante, e o status
  "validação humana pendente" permanece explícito no documento.

## Limites

Linux-only (a correção de apresentação é `#[cfg(target_os = "linux")]`);
perfil `sonic1_sonic` Rev00 permanece Experimental; sem merge, release,
promoção ou push forçado por esta frente; nada foi ampliado (codecs,
variantes, animações) — escopo é correção visual + workspace + CX.
