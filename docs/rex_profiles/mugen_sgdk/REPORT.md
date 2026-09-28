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

---

## 7. Rodada de interface (PR #85): importação MUGEN pela UI

Commits `fe66639..6d07c39` sobre `321a7a9`. Estado de partida conferido:
- o branch do integrador avançou de `a08c2c6` para `00f9d29` (4 commits da frente de gameplay);
- uma simulação de merge (`git merge-tree`, sem escrita) acusa **um único conflito**, em
  `src-tauri/Cargo.toml`: os dois lados acrescentam um path-dep no mesmo ponto, dentro do
  commit de PROPOSTA; `registry.json` e `Cargo.lock` se mesclam sozinhos;
- **não foi feito rebase**. Fica registrado para a curadoria.

### 7.1 O que virou produto pela UI

| Capacidade | Como o usuário vê |
|---|---|
| Importar personagem MUGEN | Assistente → "Abrir importador" → perfil "MUGEN · Experimental" → nome → "Importar Projeto Externo" |
| Entender as perdas | **Painel "Compatibilidade da importação MUGEN"** logo após importar: personagem convertido (atlas); totais nas quatro classes em linguagem simples ("Funciona igual", "Funciona com diferença", "Precisa de ajuste seu", "Não foi convertido"); 7 categorias (sprites, animações, comandos, estados, colisões, som, stage), com "Não existe neste pacote" quando não se aplica; "O que muda no jogo" item a item, com consequência, motivo e origem; avisos com a ação sugerida; métricas (indisponível = "-"); relatório técnico bruto recolhível |
| Resumo no console e no aviso | `[MUGEN] <id> (Experimental): N funcionam igual, N com diferença, N precisam de ajuste seu, N não convertidos (N pontes manuais no grafo)` |
| Falha sem projeto aparente | a importação recusada remove a pasta que acabou de criar (ou devolve a pasta vazia preexistente ao estado vazio; nunca apaga conteúdo preexistente) |
| Mensagem de falha honesta | a causa real (caminho fora do pacote, arquivo grande demais, célula acima de 248 px, SFF v2), a ação e "Nenhum projeto foi criado" |
| Compilar e jogar | Build & Run visível, SGDK oficial, core Genesis Plus GX |

### 7.2 E2E desktop pela interface (`--scenario mugen-import`)

- **Binário testado**: `src-tauri/target-test/debug/retro-dev-studio`, sha256
  `07b5af2ba3d780676871ce5fc5380e150e732e3f639449942bb430b783448573`, compilado pelo próprio
  harness a partir do head desta rodada.
- **Amostra**: `crates/rex-mugen/fixtures/probe`

| Arquivo | sha256 |
|---|---|
| def | `4ced8bda…74cc` |
| air | `e342c02f…2ec6` |
| cmd | `cb28501b…a285` |
| cns | `71843724…cf7f` |
| sff | `f7313b65…e990` |

| Passo (UI visível) | Resultado |
|---|---|
| importar pelo assistente | ok; painel abre com sprites/animações/comandos/estados = "Funciona igual", colisões = "Precisa de ajuste seu", som e stage = "Não existe neste pacote"; o preview do personagem carrega; o relatório bruto está presente; o console resume as perdas |
| Build & Run (1) | ROM `9ac4afc8…d8a4`; no canvas do core, o corpo e o pé do personagem aparecem em (96, 96), com os dois frames do idle observados (19/19 amostras, 0 fora do padrão) |
| editar x = 140 no Inspector → Salvar | gravado em `scenes/main.json` |
| reiniciar o app (nova sessão) → reabrir pelo assistente | o Inspector mostra x = 140 |
| Build & Run (2) | ROM `d95a221c…26d0` (diferente); personagem em (140, 96), idle 15/25; **posição antiga vazia** (0 amostras do personagem) |
| negativo: pacote com `sprite = ../fora.sff` | a UI mostra "Importação MUGEN recusada por segurança: o pacote aponta para ../fora.sff, fora da pasta do personagem. Nenhum projeto foi criado." e a ação; nenhuma pasta `Mugen_Escape_*` na pasta base; o projeto ativo não muda |

Substituição declarada: **só o diálogo nativo de escolha de pasta** é trocado por
`setNextExternalImportPath`, como já é feito no `importSgdkProject` da automação. Todo o resto é
a UI visível.

Evidência: `data/rex_profiles/mugen_sgdk/evidence/2026-09-28-e2e-ui/` (relatório, 6 capturas,
log, `SHA256SUMS`). O relatório e o log contêm caminhos absolutos do host local.

### 7.3 O que continua só técnico

- As sequências de animação por frame, o flip, o offset, a janela da Clsn1, a edição de
  **durações** e o comando por botão (soco da Probe; Sentinel; Warden) continuam provados só
  pela camada técnica (§2), com o core direto.
- Este E2E pela UI prova a importação, as perdas, o build, o personagem visível com os dois
  frames do idle e uma edição de **posição** persistida. **Não** exercita o comando pelo
  teclado nem a edição de durações pela UI.

### 7.4 Perdas que aparecem ao usuário (Probe e Sentinel)

- **Probe**: colisões "Precisa de ajuste seu" (caixas preservadas; golpes não acertam sozinhos).
- **Sentinel**: todas as quatro classes aparecem:
  - paleta com diferença (2 px trocados de cor);
  - blend opaco;
  - animação com sprite ausente não convertida;
  - gatilhos `Time`/`&&` e OR não convertidos, cada um como ponte manual;
  - VelSet não ligado;
  - estado com animação inexistente.

### 7.5 Gates desta rodada

| Gate | Resultado |
|---|---|
| `npm run check:tree` | ok |
| `npm run lint` / `npx tsc --noEmit` | ok |
| `npm test` | 80 arquivos passaram (1 saltado); 754 testes passaram, 6 saltados |
| `cargo fmt --check` (src-tauri e crate) | ok |
| `cargo clippy -- -D warnings` | ok; crate `--all-targets` ok |
| `cargo test --lib` | 785 passaram, 0 falharam, 69 ignorados |
| testes MUGEN com as provas reais | 28/28 |
| crate `rex-mugen` | 12/12 |
| E2E desktop `mugen-import` | ok (acima) |
| `npm run host:diagnose` | READY |

Achados corrigidos nesta rodada:
- o C gerado pelo runtime MUGEN emitia `-Wunused-const-variable` no console do usuário. A prova
  real agora falha nesse caso (foi vermelha antes da correção);
- a falha de importação mostrava texto genérico e enganoso ("verifique os arquivos raiz").

### 7.6 Limitações explícitas

- **Continua Experimental.** Sem suporte geral a MUGEN, SFF v2, som, stage nem colisão lógica.
- **Campo enganoso no Inspector.** O Inspector mostra "Animações (FPS)" para animações MUGEN, mas
  quem manda na ROM são as durações por frame; editar esse fps **não** muda a animação MUGEN.
  Não há campo de UI para durações por frame nem `loop_start`: a edição só é possível no
  arquivo da cena (provada tecnicamente).
- **Painel só na importação.** O painel abre logo após a importação; não há botão para reabri-lo
  num projeto já importado. O relatório permanece em `assets/mugen/<id>_import_report.json`.
- **Aviso de rascunho.** Depois da reabertura aparece o aviso "Rascunho local encontrado…
  difere da cena aberta" (autosave do produto). Não afetou o resultado.
- **Comando pelo teclado não coberto.** O comando pelo teclado da Probe (A → soco) não foi
  exercitado pela UI.
