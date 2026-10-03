# EXPECTATIONS ETAPA 5 — ADDENDUM 2 (congelado antes de reexecutar)

Precedente de disciplina: mesmo processo do Addendum-1 (R-1..R-4) e da
Retificacao A da frente de cadencia — desvio entre expectativa congelada e
resultado medido e registrado como FAIL com serie bruta; a correcao entra
SO por este adendo, commitado sozinho antes de qualquer mudanca de meio e
antes de reexecutar.

## Série bruta das corridas

- run-2 (HEAD 43d945d): abortou no gate de boot do PASSO 7 sem traco cru.
  report SHA-256 `30cf2c75a78d1ceaca056d730f5c59e9e5b19d5e69bf644054d67aefec6b7b9a`,
  run.log SHA-256 `0a1e94b3927a2f5906b1be9e92bcf145fee4965118719b27c0269b24c49b96f6`,
  run.json SHA-256 `04a568829e5740543e082c15072302e5bb7d4106511676cb4f8d38334c56e649`.
- run-3 (HEAD 2bfb513, binario `54bc04dfb5611a0e1cd7752131a209d9b642d4ec4039b4ef4d0d6bba4cce5c55`):
  abortou no MESMO gate com o traco diagnostico pedido. report SHA-256
  `a5d65cf09cface4d061f0e14030716bf17016984269e042714583de6fac5662f`,
  run.log SHA-256 `c08f6ee1fcf631daab9b338782bd802ca13bdd72b9f14b8f67195198611f3cbf`,
  run.json SHA-256 `49d256287393e0951791b83f972c2117f401593b0d397a1b7117438bf29f0781`.
  Evidencia integral em `~/rds-scratch/anim-integrada-journey-20261003-03/evidence-run3-*`.

Traco cru do gate de boot (`renderedFrames` por amostra ~5s, janela 0..120s,
leg `modificada-integrada` do PASSO 7; todos os pontos com status
"Emulador ativo"):

```
t_ms:    328   5338  10419 15573 20664 25930 31006 36163 41349 46584 51785 56990
rf:       10    40    90   120   150   190   240   290   330   360   380   420
t_ms:   62109 67188 72593 77897 83343 88662 93891 99006 104013 109034 114143 119181
rf:      450   470   490   510   520   550   570   590    600    620    640    660
```

Complementos da corrida: as 12 verificacoes registradas ate o abort estao
verdes (passo1..passo6, incluindo `passo5.byte_cadencia_cru`,
`passo5.nibble_cru`, `passo6.bps_reproduz_copia`); a `console_tail` do app
nao contem nenhuma mensagem de falha de frame do emulador; a ROM carregada
foi confirmada pelo core com SHA `3274e7c4…` (copia esperada da jornada).

## Classificacao da causa

O traco discrimina as tres hipoteses abertas na run-2:

- pump MORTO (serie plana apos um `ok:false` no loop sequencial de
  `src/core/ipc/emulatorService.ts`): REFUTADA — a serie cresce monotonicamente
  de 10 a 660 durante os 120s, sem mensagem de falha no console.
- erro de frame do core: REFUTADA — nenhum `Falha ao executar frame` na cauda.
- pump VIVO e LENTO: CONFIRMADA — media 660/119,2s ≈ 5,5 fps (regime final
  ≈ 4 fps) em renderizacao por software sob Xvfb com binario debug. Para
  890 frames o tempo estimado e ≈ 165–225s, acima do orcamento de 120s.

O gate de 890 frames em 120s e MEIO de navegacao herdado da frente de
cadencia (calibrado quando a maquina estava ociosa); nao e uma das
assercoes de bytes/valores congeladas em E9. E9 congela "jogar ROM
modificada na Game View com gate de identidade dos bytes carregados" —
identidade confirmada em run-2 e run-3 (`3274e7c4…` + `romSize 531577`).

## Correcao de meio (unica)

M-1 — orcamento do gate de boot da perna ao vivo:

- `playCadenceRunLiveGates` passa a aceitar `bootBudgetMs` opcional, com
  padrao `120000` (comportamento da jornada de cadencia ja entregue NAO muda).
- A chamada do cenario `sonic-anim-integrada` (PASSO 7, label
  `modificada-integrada`) passa `bootBudgetMs = 300000`.
- O LIMIAR permanece 890 frames em ambos os cenarios. O traco diagnostico de
  2bfb513 permanece (meio, nao expectativa).
- Justificativa do numero: 890 frames no pior regime medido (≈ 4 fps) exige
  ≈ 223s; 300s da folga ≈ 34% sem transformar o gate em espera infinita. Se a
  perna exceder 300s, o FAIL sera registrado com o mesmo traco e tratado como
  bloqueio concreto, nao como expectativa reescrita.

Auditoria dos demais orcamentos da mesma perna (mantidos, com margem no
regime medido): identidade 20s (evento, nao frames); reancoragem ≤1200 e
>=1 em 15s (1o frame em ~0,3s); 10 frames em 10s (≈ 2,3s); 30 frames pos-START
em 15s (≈ 7,5s); ACK em 10s (evento); 10 frames pos-ACK em 15s (≈ 2,5s);
negativo KeyQ e framebuffer sem espera de frames.

## O que NAO muda

- E1–E10 permanecem as congeladas em a657423 (correcoes R-1..R-4 do
  Addendum-1 continuam valendo).
- Nenhum limiar de frames, nenhum byte esperado, nenhuma assercao de
  resultado muda. M-1 ajusta somente o orcamento de tempo de UM gate de meio
  neste cenario.
- Continua proibido nesta frente: merge remoto, release, promocao de
  maturidade, push forcado.
