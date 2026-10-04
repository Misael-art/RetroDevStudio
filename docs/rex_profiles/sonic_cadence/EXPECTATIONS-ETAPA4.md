# EXPECTATIVAS da Etapa 4 — escrita ANTES de qualquer medição do oracle

Objeto: duração efetiva (em frames emulados) da animação `id_Wait` do Sonic 1
REV00 USA/EU (SHA `c7da53a1…c81ebb`) em função do byte de intervalo no offset
de arquivo `0x13BAE`, observada no core Libretro Genesis Plus GX
(SHA `07c10476…8310b1`) via `EmulatorCore` headless.

## Estado observado até aqui (sondas rotuladas, não promovidas a prova)

- Sonda 1 (run 20261002-01): um byte em WRAM-índice `0xD01F` decresce de 1 por
  frame em 1199/1199 frames observados, com salto `0 → 23` a cada ciclo; o byte
  em `0xD01D` vale 5 (id_Wait) em todos os votos. Janela de objeto em `0xD001`
  decodifica como `$1C=05 (anim), $1D=00 (prév), $1E=0A (timer)` — a janela do
  objeto do jogador começa no índice de região `0xD001`, que tem deslocamento
  +1 em relação a `$FFFFD000` (mapeamento da região não assumido; descoberto por
  temporalidade).
- Sonda 2 (run 20261002-02): um segundo START em 1600 congelou timer (14) e
  byte de frame (4) ⇒ é o pause do jogo; confirma que o primeiro START (frame
  900) coloca Sonic em jogo com idle/foot-tap rodando.
- O ROI central 64×48 não mudou em nenhuma sonda: posição de tela do Sonic não
  foi assumida; prova visual será feita na Etapa 5 (E2E desktop), não aqui.

## Semântica em disputa (relida do s1disasm rev00 pinado, HEAD `064e3c6`)

`Sonic_Animate` (`_incObj/01 Sonic.asm`, único consumidor localizador do
intervalo, prologue único em `0x139C4`):

```
subq.b  #1,obTimeFrame(a0)
bpl.s   (salta: ainda não é hora de avançar)
movea.l (anilptr).w, a1
move.b  (a2,d.l), d1      ; recarrega o byte do script
move.b  d1, obTimeFrame(a0)
<avança entrada da animação>
```

Duas leituras candidatas sobre o intervalo medido entre avanços de `obFrame`
(gaps em frames emulados, 1 tick = 1 `run_frame`):

- **H-N**: byte N ⇒ gap N. (Se a recarga efetiva valesse N−1 estados
  pós-decremento, o ciclo teria N frames.)
- **H-N+1**: byte N ⇒ gap N+1. (Estados pós-decremento N, N−1, …, 0 = N+1
  frames; o avanço ocorre no tick seguinte ao 0.)

A sonda 1 mostrou ciclo do timer com 24 estados distintos
(23, 22, …, 0) — consistente com H-N+1 para N=23, mas **ainda não mede o gap
de avanço de `obFrame`**, que é a grandeza arbitradora.

## Tabela de expectativa (compromissada antes da execução)

| corrida | ROM                        | byte 0x13BAE | gap se H-N | gap se H-N+1 |
|---------|----------------------------|--------------|------------|--------------|
| A       | original (pinada)          | 23           | 23         | 24           |
| B       | cópia via pipeline → 40    | 40           | 40         | 41           |
| C       | cópia via pipeline → 60    | 60           | 60         | 61           |

Regra de arbitragem (independente do parser do produto, implementada em
`scripts/qa/sonic-cadence-runtime-oracle.mjs`):

1. Para cada corrida, sobre frames com `anim == 5` contíguos da rota (START no
   frame 900, resto neutro), coletar os gaps entre transições consecutivas do
   byte de frame (`$1A` do objeto do jogador, descoberto por voto temporal em
   cada ROM, nunca por mapa fixo).
2. O arbitrador é a **moda** dos gaps; exige-se que ≥ 90% dos gaps sejam a moda
   e que a corrida A tenha moda ∈ {23, 24} exata.
3. A hipótese vencedora é a que **todas** as três corridas escolherem
   simultaneamente. Mistura ⇒ veredito `INCONCLUSIVE`, nada é promovido.
4. Mutações além de A/B/C não são permitidas sem nova tabela prévia.

## Controles e negativos (também comprometidos antes da execução)

- **C1 original-vs-original**: segunda execução da ROM pinada deve reproduzir a
  série de gaps da corrida A (determinismo do harness; mata estado obsoleto).
- **C2 no-op**: a corrida A (sem patch) mantém 23/24 mesmo depois de rodar
  B/C — mata a hipótese de que o harness "gruda" na última ROM vista.
- **C3 mutação discriminante**: gap(A) ≠ gap(B) ≠ gap(C), com deltas
  consistentes com a hipótese escolhida; se algum par empatar, a medição não
  discrimina e a prova falha.
- **C4 byte-escopo**: a diferença de bytes entre ROM original e cada cópia é
  exatamente `1` byte, no offset `0x13BAE`, lida do arquivo pela verificador
  independente (sem código do produto).
- **C5 recusa de valor reservado**: o pipeline canônico recusa `$00`,
  `$80`–`$FF` (incl. tokens `$FD`–`$FF` interpretados como duração) e recursos
  não comprovados; coberto pelos testes unitários da Etapa 2 e reafirmado aqui
  por chamada direta a `edit_sonic_duration`.
- **C6 SHA gate**: o verificador recusa qualquer ROM cujo SHA ≠ pinada (a
  negatively-injected copy is attempted and must be refused).
- **C7 consumer único**: verificação estática de que o prologue consumidor
  (assinatura em `0x139C4`) permanece íntegro em todas as cópias (byte alterado
  ≠ região de código); coberto pelo verificador do contrato.
- **C8 estado não injetado**: nenhuma escrita em RAM durante as corridas; o
  único input é a rota de teclado descrita. Registro no manifesto.

## Manifesto de evidência

`oracle/manifest.json` gravado pelo harness Rust: SHA-256 de ROM base, de cada
cópia modificada, do core, do binário de teste, do harness; contagem de frames
por corrida; caminho das séries. O verificador mjs não lê o diretório do
produto nem importa parser do produto.

## Resultado (pós-execução, registrado em 2026-10-03)

Seção escrita DEPOIS das corridas; nada acima foi alterado após congelar.

- Corridas: 6/6 (A1, A2, B40, C60, A3, D) em
  `data/rex_profiles/sonic_cadence/evidence/2026-10-03-oracle/`
  (`veredito.json` allPass=true, rc=0; log `cargo-test.log` 1 passed em 400,51 s).
- Modas de gap: A1=24 (byte 23, razão 0,99, 77 transições), B40=41 (razão
  0,97), C60=61 (razão 0,95); reload observado == byte do arquivo em 23/40/60.
- Arbitragem: **H_N+1 única** nas três corridas (byte N ⇒ N+1 frames de tela
  por frame animado, NTSC, caminho não-especial). Nada ficou INCONCLUSIVE.
- Controles: C1 A1==A2; C2 A1==A3; C3 modos 24/41/61 distintos aos pares;
  C4 cópias B/C diferem de A exatamente em 1 byte em 0x13BAE; C5 recusas
  0x00/0x80/0xFE/0xFF/no-op/recurso registradas; C6 ROM e core pelos SHAs
  pinados; C7 prólogo consumidor íntegro em A/B/C; D (consumidor adulterado)
  não reproduz 23/24 — cadência não descobrível sob adulteração.
- Incidente de host (registrado, não escondido): a primeira execução morreu em
  `No space left on device` no tmpfs `/tmp` cheio por artefatos de terceiros;
  nenhum arquivo alheio foi removido. Trabalho realocado para disco raiz e a
  evidência acima veio da reexecução completa seguinte.
- Defeito próprio achado e corrigido: o manifesto gravava `core_sha256: null`
  porque `loaded_core_file()` só resolve após um `load_rom` real; o verificador
  independente pegou (`FAIL manifesto: core é o pinado`) na primeira leitura.
- Consequência promovida ao produto: contrato (§5/§11), `describe()` do backend
  e a prévia da UI passaram a afirmar/segurar o ritmo medido byte+1; PAL e
  transições de animação permanecem marcados como não medidos.
