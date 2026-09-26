# Relatório técnico — ETAPA E (prova pelo produto)

Data: 2026-09-26 · Rodada: integrador REX · Branch: `codex/rex-integrator-profiles-codecs`
Commits desta etapa: `4d04a4f`, `99a7f08`, `0e4937e`, `9849aac` (push: remoto == `9849aac`)
Pacote de evidência: `data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/`
Estado de maturidade: **Experimental**. Sem merge, sem release, sem promoção (ordem do operador).

---

## 1. Objetivo e veredito

**Objetivo da etapa:** fechar a cadeia de recurso comprimido LZ4W *pelo produto* —
a edição de um recurso comprimido aplicada pela interface real deve produzir um
efeito observável na aplicação, com negativos alcançáveis recusados sem escrita.

**Veredito:** **PASS em dado autoral.** Uma edição de 1 pixel produz exatamente
**1 pixel de tela diferente**, na coordenada prevista pelo fonte antes de qualquer
emulação, com a perna de memória provada em **WRAM** e a apresentação provada por
**canvas do app == framebuffer do core**. Os dois negativos alcançáveis pela UI
foram recusados sem escrita. Duas pernas **não** foram provadas e ficam
registradas como limitação (§7), não como sucesso.

**O que isto não é:** não é prova sobre o alvo comercial `0xc8cc8` (continua
`semanticState: BLOQUEADO`, consumidor não provado), não é equivalência de codec
para o corpus, não cobre expansão de ROM nem realocação de ponteiros.

---

## 2. Artefatos sob prova (identidade conferida por SHA-256)

| Item | Valor |
|---|---|
| Binário do app testado | `src-tauri/target-test/debug/retro-dev-studio` → `e69077927863c15788bf2006e344f71f4a4b84408714201c48a67d450fc26574` |
| Core Libretro | Genesis Plus GX v1.7.4 `46a5521` (cache do host, lock `dd99a22f…`) |
| ROM do fixture (autoral) | `159298eb1c9a437a6abc83c80becfe38c52d469d6284aeab4dc9dc06e9b2b9b5`, 393 216 B |
| `ground_truth.json` | `5cc90f0b56f8b5005862c74ee9180f07d9a83d0670f8b41769a3f9753326b386` |
| Recurso | header `95464`, stream `0x5f988` (391 560), 16 tiles, slot 444 B (plain 512 B) |
| ROM modificada | `e55dba92015a2a6981c91d52b161285560bc930b5a60cc27b4cf7b299dede6c9` |
| Patch BPS | `52ce036f071bd54380fcf1ccdd7229cab32d39d9502da651114ccbafaf16e18d`, 74 B |
| Receita | `gen_fixture.py 3e474f44882363f14006a48b1da1b7ace4db54bfb70ee5cc7babbf3869309904`; toolchain SGDK 2.11 pinada (`libmd.a ef904a37…`, `rescomp.jar 502a4670…`) |
| Cenário E2E | `scripts/e2e-tauri-build-run.mjs::runRexLz4wFixtureEffectScenario` |

Todo hash acima foi **reconferido contra o disco** nesta rodada, junto com os 16
artefatos do pacote listados no `manifest.json` (relatório do run11, relatório de
reconstrução, `run1..run11.log`, os dois PPMs e o log de portas) e com os números do
`rex-lz4w-fixture-effect-report-run11.json` usados na tabela §4 — divergências:
nenhuma. Os arquivos fora do pacote (binário do app, ROM durável do fixture, cópia
modificada e BPS em `~/.retrodev/decomp_work/…`) foram conferidos por `sha256sum`. A
verificação do pacote é reproduzível com:

```bash
python3 - <<'PY'
import json,os,hashlib
b="data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e"
m=json.load(open(f"{b}/manifest.json"))
bad=[k for k,v in m["artifacts"].items()
     if hashlib.sha256(open(os.path.join(b,k),'rb').read()).hexdigest()!=v]
print("divergentes:",bad)
PY
```

---

## 3. Método

O cenário dirige o binário real por WebDriver + `callAutomationApi`, e a expectativa
**nasce do fonte gerador do fixture** (não da observação): o `main.c` autoral
desempacota o TileSet LZ4W (`unpackTileSet` → `VDP_loadTileSet` →
`VDP_fillTileMapRectInc`) e coloca o tile `t` numa única célula `(t%4, t/4)`. Isso
dá uma coordenada de tela calculável antes de ligar o emulador.

O plantio no fonte (`row 5 = NOISE_ROWS+1`, `col 7 = TILE_PX-1`, valor `(v+1)&15`
onde a regra é `v = (tile*7 + row*3) & 15`) existe por uma propriedade do formato:
**LZ4W casa words de 16 bits, não pixels**. Sem o near-miss, nenhuma das 15.360
edições de 1 pixel encurtava o stream o suficiente para caber no slot — medida e
documentada na ETAPA D, com varredura exaustiva preservada.

**Barreiras não-vacuosas** (o requisito do operador é "testes discriminantes"):

1. Cada verificação espera **o SHA dos bytes que estão no disco agora**, não
   "algum select existe" — o estado do painel persiste entre fases, então uma
   espera satisfeita por uma fase anterior seria verde falso.
2. Reabertura do painel passa pela vista **Inspeção** para desmontar
   `CompressedResourcePanel` e zerar `romPath`/`romSha`/recursos/edições.
3. `selectWorkspace("debug")` antes de `openToolsWorkspace("reverse","debug",true)`:
   as medições deixam o workspace numa concha sem painel direito
   (`showRight:false` em `src/core/workspaceLayout.ts`), onde o `ReverseWorkspace`
   nem é montado.
4. Leitura de memória **falha alto** quando `total_size == 0`. O core responde
   `ok: true` com `data` vazio para `VIDEO_RAM`; comparar isso daria
   "0 divergências" de forma vazia.
5. A asserção de intervalo assera a **guarda do cliente** com controle positivo,
   porque a recusa do núcleo é inalcançável pela UI (§7.3).

---

## 4. Passos executados e resultados medidos

| # | Alegação | Observado |
|---|---|---|
| 1 | Terra firme do fonte conferida | ROM `159298eb…`; pixels originais `19cc30aefe4da564…`, editados `917048cc35508e9a…` |
| 2 | Descoberta + decode **pela UI** | opção única `0x5f988 — 16 tiles (stream 444 B)`; `1/5 candidatos` verificados; prévia == fonte recomposto |
| 3 | No-op honesto | desfecho `noop`, zero edições, nenhuma escrita |
| 4 | Edição pela transação canônica | modificada `e55dba92…`; BPS `52ce036f…` 74 B; **268 bytes distintos** confinados em `0x5f9a1..0x5fb3f`; `diferenteForaDoSlot: 0` |
| 5 | BPS re-aplicado à base | reproduz o hash exato da cópia modificada |
| 6 | Cópia reaberta no produto | decodifica no plain editado (`917048cc35508e9a` == esperado) |
| 7 | Prova de memória | **WRAM**: 1 byte em `0x5e`, `f0 → ff` (região lida integralmente: 65 536/65 536); **VRAM**: não observável (`observed: false`) |
| 8 | **Efeito visual causal** | framebuffer 320×224; **exatamente 1** pixel de tela diferente, em **(7,5)**; `0x212021 → 0x8c008c`; índice 0 → 15; 11 classes de cor no frame |
| 9 | Apresentação | canvas do app == framebuffer do core no mesmo frame congelado |
| 10 | Negativos pela UI | fila de intervalo: `0 edição(ões) pendente(s)`, SHA da cópia inalterado; controle positivo enfileira 1 · identidade: `rom_identity_mismatch: ROM base mudou: esperado 159298eb…, atual 4e700a4d…` · ROM do fixture **intacta** |

**Reprodução independente do passo 8** (fora do cenário): comparar byte a byte os
dois PPMs promovidos devolve `pixels diferentes: 1` em `(7,5)`, `(33,32,33) →
(140,0,140)`. O `analyze-frame.py` promovido reproduz a partição de cores (11 cores
distintas; índice→cor consistente; colisões `0↔7`, `1↔9`, `2↔10`, `3↔6`, `4↔8`).

---

## 5. Por que a cadeia é causal, não correlata

A edição entra por um caminho com identidade conferida (SHA da ROM, evidência
re-verificada contra os bytes, re-codificação dentro do slot, ida-e-volta dentro da
transação, BPS exportado e re-aplicado com hash exato). O único byte do plain que
muda é o do pixel plantado; o stream re-codificado é **menor** (440 B no slot de
444 B) e por isso coube sem expansão. O desempacotador 68000 **oficial** já reproduz
byte a byte o stream que o produto escreveu (ETAPA D, `runF`: `i30` rescomp / `i31`
produto, `68k == jar == esperado`). O plain menor é o que o fixture carrega para a
VRAM no boot; o pixel resultante aparece na única célula do tile 0 prevista pelo
fonte. Não há segundo candidato a causa nesta janela: **original vs. modificado difere
em 1 pixel de tela e em 1 byte de WRAM**, e o controle original-vs-original é
idêntico (determinismo do `run_frames` validado).

---

## 6. Negativos cobertos, e onde cada um vive

| Negativo | Onde é provado |
|---|---|
| Tile fora do recurso (núcleo) | `rex_resources.rs:634` → teste unitário `apply_rejects_tile_outside_resource_without_writing` (recusa + ROM em disco inalterada) |
| Tile fora do recurso (cliente) | cenário E2E, passo 10 (fila guarda 0 entradas, 0 escritas, controle positivo enfileira 1) |
| Identidade da ROM trocada sob o painel (TOCTOU) | cenário E2E, passo 10 (`rom_identity_mismatch`) |
| Re-codificação maior que o slot (`excessive_output`/`needs_space`) | teste de aceite do produto com varredura exaustiva de 15.360 candidatos (ETAPA D) |
| Dependente modificado | BYOR (`0x91a00` dependente de `0x8ff8e`); não alcançável no fixture, que tem 1 recurso sem dependentes |

---

## 7. Limitações medidas (registradas como NÃO PROVADAS)

1. **`VIDEO_RAM` não é exposta** pelo core carregado:
   `retro_get_memory_size(VIDEO_RAM) == 0`, enquanto `emulator_read_memory` responde
   `ok: true` com buffer vazio. Uma comparação diria "0 divergências" **vaciamente**.
   A perna de VRAM fica `observed: false`; a cadeia é provada por WRAM + framebuffer.
   Consequência metodológica: a barreira por `total_size` passou a ser obrigatória em
   qualquer sonda de memória deste repositório.
2. **Fusão de DAC do Mega Drive**: as 16 palavras de paleta autorais renderizam
   **11 cores**. Índice→cor é função, mas **não é injetiva**; a identidade do pixel
   alterado é estabelecida por **posição**, e a cor só confirma a classe. Um
   veredito "a cor mudou, logo o índice mudou" seria inválido aqui.
3. **A recusa de intervalo do núcleo é inalcançável pela interface**: o painel
   descarta `editTile >= num_tiles` no cliente
   (`src/components/tools/CompressedResourcePanel.tsx`, botão "Adicionar edição").
   O E2E, tal como pode observar, prova a guarda do cliente. **Decisão desta rodada:**
   não alterar a UI para tornar o negativo alcançável (fora do escopo autorizado);
   em vez disso, fixar a recusa do núcleo com teste unitário e registrar o
   comportamento silencioso do cliente como achado.
4. **Prova de mecanismo, não de cobertura**: o fixture foi desenhado para que
   exatamente uma edição coubesse. Nada aqui promove a cadeia para "funciona no
   corpus". O alvo comercial `0xc8cc8` segue bloqueado por **consumidor não
   provado**, não por falta de espaço.
5. **Vínculo binário**: run10/run11 exercitaram `scripts/e2e-tauri-build-run.mjs`
   (`becf096c…`) e `rex_resources.rs` (`24c23cab…`). Após a promoção, esses arquivos
   mudaram apenas por conteúdo não-executivo de teste (comentário do bloco; asserções
   sem aritmética constante). O binário sob teste permanece `e6907792…`, reconferido
   depois da promoção, e a suíte Rust permanece verde — as corridas descrevem o mesmo
   código de produto.
6. **As duas corridas verdes leram a ROM de `/tmp`**: `fixture.romPath` no relatório
   do run11 é `/tmp/rex-lz4w-fixture/project/out/rom.bin` (e o cenário continua
   consumindo o que `RDS_REX_LZ4W_FIXTURE_ROM` apontar; ele não reconstrói o fixture
   sozinho). A partir desta rodada o caminho durável
   `src-tauri/target-test/validation/rex-lz4w-fixture/project/out/rom.bin` devolve o
   **mesmo** SHA (`159298eb…`, 393 216 B), provido em `fixture-rebuild-report.json` —
   ou seja, a entrada é reprodutível a partir do repositório, mas **não** foi o
   arquivo do repositório que as corridas registradas abriram.

---

## 8. Portas de validação

`npm run check:tree` · `npm run lint` · `npx tsc --noEmit` · `npm test` ·
`cargo clippy -- -D warnings` · `cargo test --lib -- --nocapture` ·
`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` · `npm run host:certify`

| Porta | Resultado |
|---|---|
| `check:tree` / `lint` / `tsc --noEmit` | rc=0, sem saídas |
| `cargo clippy -- -D warnings` | rc=0 |
| `cargo fmt --check` | rc=0 |
| `cargo test --lib -- --nocapture` | **669 passed / 0 failed / 51 ignored** |
| `npm test` | 76 arquivos (75 passed / 1 skipped); **699 passed / 6 skipped (705)** |
| `npm run host:certify` (`--profile full`) | **READY** · fingerprint `60249508aff61897cdd43160d4716b2344d69282507a36c5a457c0028143f6e2` · lock `dd99a22f…` · mesma suíte Rust 669/0/51 · frontend **702 passed / 3 skipped (705)** |

**Reconciliação 699 ↔ 702 (mesma árvore, mesmo total 705, zero falhas):** os 3 testes
a mais no certify pertencem a `scripts/decomp/decomp-scripts.test.mjs`, que pula por
disponibilidade de toolchain (`HAS_SGDK_BUILD_TOOLCHAIN` l.122, `GHIDRA_AVAILABLE`
l.195, `HAS_M68K_TOOLS` l.231); o profile `full` exporta SGDK/m68k/Ghidra. O skip
fixo de `validateUpstreamWindows.test.ts` (2) é `process.platform === "win32"`.

**Achado paralelo:** `cargo clippy --all-targets -D warnings` (gate mais estrito que o
documentado, que não alcança código de teste) falha com 18 erros no alvo `lib test`:
8 no arquivo desta etapa (`rex_resources.rs:1210-1212`, corrigidos) e 10 em código de
teste **pré-existente** de outros módulos (`build_orch.rs:5225`; `project_mgr.rs`
21081/22014/25744/26217/26316; `graphics_discovery.rs:1946`; `holdout.rs:661`;
`logic_recovery.rs:620`; `lib.rs:165`) — **atribuídos e não corrigidos** nesta rodada.

---

## 9. Reprodução

```bash
# 1) reconstruir o ROM autoral (bit-idêntico; /tmp deixa de ser a única origem)
scripts/rex_profiles/integrator/lz4w_fixture/build-fixture.sh \
  --out src-tauri/target-test/validation/rex-lz4w-fixture
sha256sum src-tauri/target-test/validation/rex-lz4w-fixture/project/out/rom.bin
# 159298eb1c9a437a6abc83c80becfe38c52d469d6284aeab4dc9dc06e9b2b9b5

# 2) aceite no produto (núcleo)
RDS_REX_LZ4W_FIXTURE_ROM=src-tauri/target-test/validation/rex-lz4w-fixture/project/out/rom.bin \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture fixture_lz4w

# 3) prova pela aplicação (E2E)
RDS_REX_LZ4W_FIXTURE_ROM=src-tauri/target-test/validation/rex-lz4w-fixture/project/out/rom.bin \
  npm run test:e2e:desktop -- --scenario rex-lz4w-fixture-effect

# 4) conferir o efeito sem o cenário (usa os PPM promovidos)
python3 scripts/rex_profiles/integrator/lz4w_fixture/analyze-frame.py \
  data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/rex-fixture-frame-original.ppm \
  src-tauri/target-test/validation/rex-lz4w-fixture/project/ground_truth.json 0 0

# 5) fronteira do núcleo
cargo test --manifest-path src-tauri/Cargo.toml --lib -- \
  apply_rejects_tile_outside_resource_without_writing
```

Requisitos: host `READY`, `java` no PATH, SGDK 2.11 + m68k-elf no cache do host,
`tauri-driver` + `WebKitWebDriver`. BYOR não é dependência provisionável; a ausência
do arquivo faz o teste **falhar**, nunca pular em silêncio.

---

## 10. Pacote de evidência

`data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/`

- `manifest.json` — manifesto que amarra binário, ROM, ground truth, modificada, BPS,
  receitas, portas, limitações e a razão transcrita de cada corrida de diagnóstico.
- `rex-lz4w-fixture-effect-report-run11.json` — relatório do cenário (passos 1–10,
  `limitacoes`, `semanticState`, `escopo`).
- `fixture-rebuild-report.json` — reprodução durável do artefato testado.
- `run1.log … run11.log` — histórico honesto: run1–run9 com a linha de erro
  transcrita de cada log; run10/run11 com rc=0 no código final.
- `rex-fixture-frame-original.ppm`, `rex-fixture-frame-modificado.ppm` — frames do
  run11, para o leitor recontar o pixel sem o cenário.
- `gates-2026-09-26.log` — comandos, rc e a reconciliação 699↔702.

Bytes comerciais: **nenhum**. Os PPMs e o `ground_truth` derivam do fonte autoral; as
ROMs (base, modificada, patch-aplicada) continuam fora do git por política e são
reconstruíveis pela receita pinada.

---

## 11. Pendências e recomendações para a próxima rodada (não executadas aqui)

1. **Gap de codificador** (444 B rescomp vs 448 B produto no plain não-editado) é o
   que obriga o plantio. Um DP fiel exige dimensão "literais pendentes mod 15"; o
   porte ingênuo do DP ótimo foi tentado, medido pior (382 vs 380) e revertido.
   Fechar esse gap é o que tornaria recursos comerciais reinseríveis sem expansão.
2. **Consumidor do alvo comercial** continua o bloqueio real. Ferramentas novas
   precisam de uma perna observável que este core não dá (VRAM/CRAM, tracer de
   `JSR`); instrumentar o jogo está fora da autorização.
3. **aPLib** em Rust canônico com oráculo independente permanece o caminho para
   outros codecs do corpus.
4. **Qualidade de UI:** o descarte silencioso de `editTile >= num_tiles` no painel é
   defensável como guarda, mas deveria reportar o motivo ao usuário — decisão de
   produto, não feita nesta rodada por estar fora do escopo.
5. **Higiene de portas:** considerar adicionar `cargo clippy --all-targets` ao bar
   documentado (10 lints de código de teste pré-existente já mapeados acima).
