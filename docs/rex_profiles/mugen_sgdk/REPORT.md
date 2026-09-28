# Relatório — MUGEN → SGDK, perfil `mugen.character.v1` (Experimental)

Branch `codex/rex-mugen-sgdk` · worktree `/home/misael/Projects/REX-MUGEN-SGDK-2026-09-28` ·
base `a08c2c680c6dd76eaf8d3ad6b5502a1db6532ccc` · 2026-09-28.
Contrato: `crates/rex-mugen/CONTRACT.md`. Auditoria: `AUDIT.md`. Evidências:
`data/rex_profiles/mugen_sgdk/evidence/`.

## 1. Resultados herdados × novos

Medidos com a fixture Probe, pelo importador do produto, **antes** das mudanças desta frente.

| Item | Herdado (base `a08c2c6`) | Agora |
|---|---|---|
| SFF da Probe (paleta omitida nos sprites `same_palette`) | **recusado** ("PCX pequeno demais"); o decodificador exige paleta em todo PCX | a fixture grava a paleta em todo PCX; o perfil aceita as duas formas |
| célula | 26×24 (o `.res` usava 3 tiles = 24 px) | 32×24 (múltiplo de 8) |
| laço das animações | `loop: false` sem `Loopstart` | sempre repete (MUGEN) |
| tempos por frame na ROM | ignorados (1 fps médio) | tabela por frame |
| `-1` | virava 1 | parado |
| CLSN | 1 AABB (união das Clsn2 do 1º frame da ação 0) | por frame, Clsn1 e Clsn2 |
| flip/blend | ambíguos (`,,A` virava flip) | posicionais |
| grafo | 1 aresta; estados e transições soltos; gatilho como texto; `-1` como estado | estados com anim, `ChangeState` com condição real, ponte explícita para o resto |
| relatório de fidelidade | não existia | `assets/mugen/<id>_import_report.json` |
| caminho `../` no DEF | seguido (arquivo externo lido; caminho absoluto em `source_refs`) | recusado |

## 2. Provas técnicas (import pelo produto + SGDK oficial + core Libretro direto)

A previsão foi registrada antes de cada execução. Todas as medidas são **por pixels no core**,
com marcadores derivados do desenho das fixtures; a RAM foi usada só para as caixas.

### 2.1 Probe (amostra de desenvolvimento)

| Medida | Previsto | Observado |
|---|---|---|
| idle | `idle0 × 5`, `idle1 × 9` | igual |
| soco depois do A | `punch0 × 3`, `punch1 × 6` (offset +2, corpo amarelo), `punch0 × 4` com flip H (punho à esquerda do eixo), frame final × 2 e idle | igual |
| edição no modelo: frame 1, 6 → 12 ticks; salvar e reabrir | `punch1 × 12` | igual |
| Clsn1 ativa | 6 / 12 quadros | 6 / 12 |
| controles | ROM antiga falha a expectativa nova e vice-versa; SHA da ROM carregada registrado | ok |

ROMs:
- original `c9b15745…bb21`
- editada `16aaff85…1e4e`

Defeitos do produto achados na 1ª execução e corrigidos sem mudar o critério:
- `sprite_anim` é nó de setup: só roda antes do laço;
- o `matched` da transição não trocava a animação no mesmo tick.

### 2.2 Sentinel (2ª amostra; agora regressão)

A previsão foi registrada com o conversor congelado em `7db7c14`. Revelou um defeito: uma
action com sprite ausente virava um frame vazio, o `rescomp` gerou 2 de 4 animações e a ROM
travou com ADDRESS ERROR. Correção em `fe84e26`: a action não é convertida.

Depois da correção, observado:
- Clsn2 por frame (1 e depois 2);
- chute com flip V desenhado abaixo do eixo;
- frame `-1` parado;
- Clsn1 ativa por 5 quadros.

O marcador de pixel planejado para o flip V caía numa faixa colorida; foi trocado, e a
geometria prevista se confirmou (ver `evidence/2026-09-28-sentinel/OUTCOME.md`).
ROM `dca23534…b47f`.

### 2.3 Warden (3ª amostra, retida)

A previsão foi registrada com o conversor congelado em `fe84e26`. Confirmou **sem nenhuma
correção**:
- flip HV;
- `Loopstart` no último frame (o idle segura W1);
- `ChangeState` dentro do próprio statedef;
- volta por `AnimTime = 0`;
- relatório inteiramente `direct`.

ROM `a065cc29…e0b`.

Depois dela, `850154b` mudou apenas o acesso a arquivos (contenção e limites) e a ordem das
gravações, não a semântica de conversão, e a prova da Warden foi reexecutada verde.

### 2.4 Negativos no produto

| Caso | Resultado |
|---|---|
| SFF e CMD fora do pacote | recusados, sem atlas nem entidade |
| AIR > 1 MiB | recusado |
| SFF truncado | recusado, sem projeto parcial |
| célula > 248 px | `plan.budget.cell_too_large` |
| gatilho `Time > 20` | ponte, sem transição, `unsupported` |
| duração 0 editada no modelo | `#error` no build |
| métrica sem dado | `null` + motivo |

Negativos na crate:
- AIR: CLSN sem cabeçalho, contagem divergente, frame e tempo inválidos, flip inválido,
  `Interpolate`, action duplicada ou vazia, linha fora de action;
- SFF: assinatura, v2, número de imagens, truncamento, ciclo de `next`, link inválido,
  duplicata.

## 3. Matriz técnica × interface

| Camada | Estado |
|---|---|
| crate `rex-mugen` (12 testes; clippy `--all-targets` limpo) | verde |
| importador do produto (`import_mugen_project`) + modelo + relatório | verde (testes do produto) |
| compilador (runtime MUGEN, `sprite_anim_done`) | verde (C gerado conferido; ROMs reais) |
| build SGDK + ROM no core, edição e efeito | verde — **camada técnica, core direto** |
| comando Tauri / wizard de importação existente mostrando o relatório | **não verificado**; proposta em `INTEGRATION_PROPOSAL.md` |
| edição pela UI (Inspector de animação) e jogar pelo teclado | **não feito** (dono: integrador) |

## 4. Não alegado

- Conversão integral de MUGEN, SFF v2, blend, expressões gerais, facing, uso das caixas pela
  lógica, som, stage e IA.
- Compatibilidade com hardware real: só o core foi observado.
- Conteúdo comercial ou de terceiros: nenhum. As três fixtures são autorais, geradas por código.

## 5. Comandos

```
cd crates/rex-mugen && CARGO_TARGET_DIR=../../target/crates-gates cargo test && cargo clippy --all-targets -- -D warnings
CARGO_TARGET_DIR=$PWD/target cargo test --manifest-path src-tauri/Cargo.toml --lib mugen -- --include-ignored --nocapture --test-threads=1
REX_MUGEN_WRITE_FIXTURES=1 cargo test --test fixture_probe   # regrava as fixtures (a partir do gerador)
```

As provas reais exigem a SGDK oficial e o core Libretro detectados; o teste recusa toolchain
falso.

## 6. Gates (head desta entrega)

| Gate | Resultado |
|---|---|
| crate `rex-mugen` | 12 testes, `cargo fmt --check` e clippy `--all-targets -D warnings` limpos |
| `cargo test --lib` (src-tauri) | 781 passaram, 0 falharam, 69 ignorados |
| testes MUGEN com as provas reais (`--include-ignored`) | 24/24 |
| `cargo clippy -- -D warnings` | verde; 0 avisos nos arquivos da frente com `--all-targets` |
| `cargo fmt --check` | ok |
| `npm run check:tree` | ok |
| `npm run lint` / `npx tsc --noEmit` | ok |
| `npm test` | não executado: nenhum arquivo de frontend mudou (`git diff a08c2c6 -- src` vazio) |
| `npm run host:diagnose` | READY |
