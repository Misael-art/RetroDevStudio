# C4 — Medição do efeito global do `WEBKIT_DISABLE_COMPOSITING_MODE=1` (Linux)

Frente de consolidação, 2026-10-03. Expectativas congeladas em
`EXPECTATIONS-CONSOLIDACAO-C4.md` (commit `753805b`, anterior a qualquer
implementação/corrida). Este arquivo reporta resultado contra aquele contrato;
não o reescreve.

## pergunta e escopo

A entrega contém uma decisão de produto global: `app_lib::run()` define
`WEBKIT_DISABLE_COMPOSITING_MODE=1` para todo Linux
(`src-tauri/src/lib.rs:5593-5595`), corrigindo o não-re-pintar de `<img>` sob
compositor acelerado (negativo magenta, reconfirmado em `C3-PROVA-VISUAL.md`).
C4 mede o **custo** dessa decisão nos caminhos afetados, separando tempo
emulado de fluidez apresentada, e decide se há regressão relevante que exija
mudar a política de apresentação.

Caminhos medidos: **Game View** (única superfície do app com loop de re-pintura
contínuo — o pump `setTimeout(~16ms)` do `ViewportPanel`, que avança 1 frame no
core e blita o canvas a cada tick; é o caminho onde o custo do compositor se
decide). **NodeGraph** e prévia **MUGEN** são re-pintados por evento/timeout,
sem loop de canvas contínuo — tratados como lacunas de métrica (abaixo).

## desenho do experimento (condições equivalentes, única variável = binário)

- **Braço A** (produto, compositing-off): binário pinado `ce54d579…`, construído
  em `a0067d8`. Verificado: `git diff a0067d8..HEAD -- src src-tauri/src` **vazio**
  → código de produto idêntico ao destino. Define a flag internamente.
- **Braço B** (baseline, sem a mitigação): commit **local-only** `e00cc481…` que
  apaga exatamente as 3 linhas `#[cfg(target_os="linux")] std::env::set_var(...)`
  (diff toca só `lib.rs`), binário `01896c37…`. Nunca promovido/publishado.
- Ambiente: Xvfb pinado `5bfd315a…`, 1920×1080×24, dpr 1, janela em (0,0). ROM
  BYOR Sonic 1 USA/EU `c7da53a1…` (SHA conferido pré-cada corrida). O harness
  **asserta** que `WEBKIT_DISABLE_COMPOSITING_MODE` NÃO está no ambiente do
  processo node → nenhum braço troca a correção por variável oculta; a única
  diferença é o código do binário.
- Métricas por janela de 20 s, 3 janelas por braço, amostragem 1 Hz:
  - **tempo emulado** = delta de `emulator_observe.frames_run` (exato, no core);
  - **fluidez apresentada** = delta de `data-rendered-frames` (pump do produto;
    quantizado ×10 e cada leitura IPC de 1 Hz afama levemente o pump → grosseira,
    assumida);
  - **resposta** = round-trip de uma ida ao main thread durante o pump (proxy
    sempre disponível) + latência de ack do joypad via START nativo (secundária);
  - **CPU** = amostrador `/proc` EXTERNO (`cpu-sample.py`, fora do processo,
    árvore inteira: binário + filhos WebKit), alinhado por epoch-ms de cada janela.
- Harness: cenário `compositing-medicao` (só test-infra; produto intocado —
  commits `bab4829`, `a463a6b`; `git diff` de `src/` vazio contra eles).

## resultados

Duas rodadas com **ordem trocada** (controle de deriva de sessão) para testar se
o gap de throughput é estável ou ruído.

### emulado (fps) — a métrica que exige leitura cuidadosa

| rodada | ordem de corrida | A mediana | B mediana | A/B |
|---|---|---|---|---|
| R1 | A primeiro, B depois | 7,74 | 8,31 | 0,931 |
| R2 | B primeiro, A depois | 8,33 | 8,21 | 1,015 |

Por janela (A/B): R1 `[0,969, 0,975, 0,904]` → **2 de 3 janelas dentro de ±5%**, só
a janela 3 fora. R2 todas dentro de ±5%.

**O sinal do gap inverte com a ordem da corrida**: em ambas as rodadas o braço que
correu **segundo** teve throughput maior (R1: B=8,31>7,74; R2: A=8,33>8,21). Isso é
assinatura de deriva de sessão (aquecimento/cache/thermal), **não** efeito da
mitigação. O gap de R1 (0,931) e o de R2 (1,015) se cancelam: A≈B no conjunto.
A nota de "determinismo" do contrato (`frames_run` não deve depender do
compositor) parte de uma premissa que **não vale para um core acoplado ao pump**:
aqui o pump de render é quem avança o core, logo a TAXA de `frames_run` por
segundo de relógio acompanha o custo do paint. O throughput determinístico de
`emulator_run_frames(N)` não é o que está em jogo.

### apresentadas e demais métricas (todas as janelas válidas: `frames_run` avançou)

| métrica | R1 A / B | R2 A / B | critério | resultado |
|---|---|---|---|---|
| fps apresentado (mediana) | 7,74 / 8,06 | 8,08 / 8,52 | A ≥ B×0,6 | ✓ (A ≈ 95% de B) |
| resposta UI round-trip (mediana ms) | 276 / 286 | 270 / 290,5 | A ≤ B×1,5 | ✓ (A ≤ B) |
| ack de START (joypad) | lacuna | lacuna | — | indisponível no title |
| CPU média da árvore (%) | 101,2 / 100,0 | 100,5 / 99,7 | A ≤ B×1,5+10pp | ✓ (≈idênticas) |

A CPU da árvore inteira fica em ~100% (≈ 1 núcleo saturado pelo pump) em ambos os
braços, todas as janelas. Não há custo de CPU mensurável em ligar o render por
software neste regime.

## decisão (contra o contrato)

Regra congelada: regressão relevante = violação de qualquer métrica disponível em
≥2 janelas da MESMA superfície. Aplicada:
- latência de resposta (round-trip): 0 violações (A ≤ B em ambas as rodadas);
- fps apresentado: 0 violações;
- CPU: 0 violações;
- `frames_run` ±5%: R1 = 1 janela fora (não ≥2), R2 = 0 fora, e o desvio é
  explicado por ordem de corrida.

**Veredito: nenhuma regressão relevante.** Decisão de política: **MANter a flag
global** (`WEBKIT_DISABLE_COMPOSITING_MODE=1` em todo Linux) com custo medido ≈
zero dentro da variância de corrida, **mantendo o negativo magenta discriminante**
(a captura defeituosa arquivada continua reprovando o comparador independente —
reconfirmado em C3). Nenhuma mudança de política de apresentação é necessária.

## limitações registradas (não escondem nenhum bloqueio)

1. **Regime não reproduzido**: o Xvfb deste host não expõe compositor de hardware,
   então o braço B "com compositor ligado" também cai em render por software. A
   medição **restringe o custo ao regime de software**; NÃO mede — nem pode
   generalizar — o custo no **desktop com compositor acelerado** que motivou a
   correção. Ou seja: "barato no software" ≠ "barato em todo Linux". Isso é
   exatamente o "não generalize" que a frente exigia.
2. **NodeGraph**: sem hook de contagem de re-pintura (superfície evento-driven, sem
   RAF). LACUNA declarada — NÃO aprovado. Só CPU do processo (≈idêntica) vale aqui.
3. **Prévia MUGEN**: exige a jornada completa de import de personagem; fora de
   escopo de um probe de desempenho. LACUNA declarada — NÃO medida, NÃO aprovada.
   A prévia é DOM/timeout (repinta por evento), sem loop contínuo de canvas.
4. **Desvio do passo 4 do contrato** (3 superfícies): mediu-se a fundo a única
   superfície de re-pintura contínua (Game View), 2 ordens; NodeGraph/MUGEN
   registrados como lacunas por métrica indisponível/custo desproporcional.
   Registrado aqui; o arquivo de expectativas NÃO é reescrito.
5. **Contador apresentado ×10 + perturbação de leitura**: por isso `apresentado ≈
   emulado` (ambos acoplados ao mesmo pump) e o sinal primário de apresentação é o
   round-trip de IPC + CPU externa, não o fps apresentado bruto.
6. **ack de joypad**: sessão de input viva só em gameplay; no title screen fica
   lacuna. Usou-se round-trip de main thread como proxy de resposta sempre
   disponível.

## artefatos (verificação independente)

- Raw por braço/rodada: `c4-medicao-r1-a.json`, `c4-medicao-r1-b.json`,
  `c4-medicao-r2-a.json`, `c4-medicao-r2-b.json` (série completa de amostras,
  bounds epoch-ms de cada janela, SHAs de binário/ROM, `windowConfig`).
- Resumos do comparador: `c4-medicao-resumo-r1.json`, `c4-medicao-resumo-r2.json`.
- CPU crua (árvore /proc, epoch-ms): `cpu-r1-a.csv`, `cpu-r1-b.csv`,
  `cpu-r2-a.csv`, `cpu-r2-b.csv` (SHAs na manifestação ao final).
- Harness do cenário: commit `bab4829` + `a463a6b` (só `scripts/`; produto intocado).
- Binários: A `ce54d579381257364514c28833876127359edbaf61448726fee9709602ec7623`
  (em `a0067d8`), B `01896c37ad1d1528183030322800ef9273a8c1571516f24db91c9b456171fd67`
  (em `e00cc481`, local-only). ROM `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`.
- Amostras de CPU brutas ficam em `~/rds-scratch/c4-{A,B}-20261003/` (R2) e
  `~/rds-scratch/c4-consolidacao-20261003/round1/` (R1); `desktop.log` fica fora do
  repo por `*.gitignore *.log` — SHA registrado em `C5-EVIDENCIA-E-SHAS.md`.

## manifestação de SHAs (artefatos versionados nesta pasta)

Copiados dos diretórios de scratch acima para este `evidence/` e re-hashed por
`sha256sum` (2026-10-03). Cada linha é verificável com
`sha256sum <arquivo>` dentro deste diretório.

| Artefato | SHA-256 |
|---|---|
| `c4-medicao-r1-a.json` | `f22a02ed40ccf38d0db43446383c5de26ce28a8b2a5a2e27c9e38a0da1b5b675` |
| `c4-medicao-r1-b.json` | `802075fada918eb093c37ce75eeb381fe6cf582ca484f4814dcc34f5e3c7195a` |
| `c4-medicao-r2-a.json` | `d9c4d24941c3e7119e72a5cfcc815ff79ec6076d1bfc466438b17fd4b2a1a9bd` |
| `c4-medicao-r2-b.json` | `d99845b96549e77b6dc236a4305f58d83d1b6f43caa9c0c5cedadaf319009912` |
| `c4-medicao-resumo-r1.json` | `eafc8fb9b44cd019645f6ebc24e332a4b14386a66ffec0f5a417fd0ec0fbad97` |
| `c4-medicao-resumo-r2.json` | `ad5909bdb7d313e2862603c582a434d98938174ceef45a634d52258b424a26ad` |
| `cpu-r1-a.csv` | `015800633d45860fc541eb35f0d391088c3a0997dbb9e859295d14ca9f28c463` |
| `cpu-r1-b.csv` | `062df35129bf8bdf47d4bd9c55a791342a7ac75644bfb901b4423589634953cf` |
| `cpu-r2-a.csv` | `a4d7e1a278c5f359d4930f9a484ee8994e1b504bdf9ee1d74a1f6a72ce592712` |
| `cpu-r2-b.csv` | `ed9290290450565a4c0a553a37f2cb7481bcd3b651ae7c6a315cc3cccf1ea8e3` |

Binários e ROM permanecem fora do repo (política C5); os SHAs acima são dos
raws/métricas versionados, não dos binários.
