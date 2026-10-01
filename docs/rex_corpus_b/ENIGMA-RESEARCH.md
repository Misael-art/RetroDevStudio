# REX corpus B — Pesquisa Enigma (decoder de pesquisa vs oráculo enicmp)

**Escopo:** ferramenta de **pesquisa/análise local** (`scripts/rex_corpus_b/enigma_research.py`).
`enigma_research.py` foi escrito **derivado da LEITURA** da referência LGPL-3.0
mdcomp (`src/lib/enigma.cc` @ `72c6df405a75d322c5b3722da46c3abb864c3793`).
Nenhum código C++ foi transplantado. **Isto NÃO é candidato a produto**: por ser
derivado de obra LGPL usada como referência de formato, destino máximo é
análise/estudo; o produto deve ser implementado a partir dos vetores publicados,
não deste arquivo.

Re-run: `bash scripts/rex_corpus_b/enigma-validate.sh`
Evidência: `data/rex_corpus_b/enigma/evidence/decode-parity.json`
(run de 2026-09-30: a=10/10, b=10/10, c=35/35, d=6/7+1 SKIP, e=10/10, fail=0).

## 1. Formato MEDIDO (variante fixada: mdcomp plain-Enigma, `enicmp -x`)

Domínio: array de int16 big-endian (saída sempre de comprimento PAR por
construção; o decoder jamais produz/clampa ímpar).

```
[0]     packet_length : largura em bits do campo "valor" (domínio da variante: 1..11)
[1]     mask byte     : bits 0..4 = quais bits altos (11..15) são lidos 1-bit-por-valor (0..31)
[2:4]   incrementing_value (BE u16) — cursor do token "00"
[4:6]   common_value        (BE u16) — valor do token "01"
payload: bits MSB-first em palavras de 16 bits BE:
  bit0=0 → sub-bit: 0 = run incremento (cnt=read4+1 valores incr,incr+1,… mod 2^16;
                     incr avança)  |  1 = run comum (cnt=read4+1 cópias de common_value)
  bit0=1 → mode=read2:
      0/1/2 → run repetida cnt=read4+1, valor = read(packet_length) | getMask();
              deltas 0, +1, −1 (mod 2^16)
      3     → cnt=read4; cnt==0x0F = TERMINADOR fim-de-stream;
              senão cnt+1 valores inline, cada read(packet_length) | getMask()
getMask(): para j=4..0 (bit 15 primeiro): se mask&2^j, lê 1 bit → posição j+11.
```

Não existe "largura de campo de delta" nem "threshold de zeros" no formato
MEDIDO desta variante: os deltas são fixos {0,+1,−1} e runs têm máximo 16
(campo de 4 bits). A descrição folclórica de "nibbles de modo com offset de
delta/threshold" NÃO se confirmou aqui (ver §6 pendências).

## 2. Tabela de evidência dos campos do cabeçalho (sondas controladas via oráculo)

Cada sonda muda UM campo de uma stream publicada e compara decode do oráculo
sandboxado vs decode próprio vs decode pleno. Rows completas em
`decode-parity.json` (category `c`, casos `probe_*`).

| Stream | Campo→valor | oráculo (rc, Δ vs pleno) | meu decoder | conclusão |
|---|---|---|---|---|
| planes_4k | [0] 0x0B→0x01 | rc=0, 818 B, diff@3 | byte-idêntico ao oráculo | [0] afeta leitura de valor inline ⇒ **largura de bits do valor** |
| planes_4k | [0]→0x0A | rc=0, 1412 B, diff@3 | idêntico ao oráculo | idem |
| planes_4k | [0]→0x0C | rc=0, 562 B | `malformed-header` (≥12 fora do domínio: colide com bits 11+ do mask; encoder jamais produz) | divergência = estrito-intencional |
| planes_4k | [0]→0x20 | rc=25 (SIGXFSZ — saída desborda ulimit -f) | `malformed-header` | oráculo destrói fora de domínio |
| planes_4k | [1] 0x1F→0x00/0x01 | rc=0, 3054/1178 B, diff@3 | idêntico ao oráculo | [1] consome 1 bit por bit-alto ligado ⇒ **seletor de bits 11..15** |
| planes_4k | [1]→0x20 | rc=11 (SIGSEGV; índice 32 fora do array de máscaras) | `malformed-header` | domínio [1] = 0..31 |
| planes_4k | [2:4]→0xFFFF | rc=0, 4096 B, **diff@0** | idêntico ao oráculo | [2:4] usado por run-incremento ⇒ **incrementing_value** |
| planes_4k | [4:6]→0xFFFF | rc=0, saída IDÊNTICA ao pleno | idêntico (campo não Referenciado) | [4:6] = common_value; stream sem run-comum ⇒ declaração ignorada (explica e03) |
| const_500 | [0] 0x09→0x02 (== e04) | rc=0, IDÊNTICO ao pleno | decodifica, idêntico ao oráculo e ao plain | [0] numérico; stream só usa runs 00/01 ⇒ largura nunca lida. **Não é "código de modo inexistente"** |
| const_500 | [0]→0x00 | rc=0, idêntico (campo jamais lido) | `malformed-header` (0 fora do domínio 1..11) | estrito-intencional |
| const_500 | [1]→0x1F / 0x20 | rc=0 idêntico / rc=0 idêntico (getMask nunca chamado) | decodifica 0x1F; rejeita 0x20 | domínio via índice do array |
| const_500 | [2:4]→0xFFFF | rc=0, 400 B, diff@0 | idêntico ao oráculo | incr usado |
| const_500 | [4:6]→0xFFFF | rc=0, diff@2 | idêntico ao oráculo | **common_value confirmado** (runs comuns usam [4:6]) |
| single_word | [0]/[1] alterados | rc=0, idêntico | idêntico | tokens 00 não leem [0]/[1] |
| single_word | [2:4]→0x0001 | rc=0, diff@0 | idêntico | incr confirmado |
| single_word | [4:6]→0x0001 | rc=0, idêntico | idêntico | common não referenciado |

Conclusão: **os 6 bytes do cabeçalho estão totalmente fixados por evidência**
(era a pendência "semântica pós-modo não fixada" da fase anterior). O oráculo
aceita [0]=12..31 (decodifica de forma destrutiva) e [0]=0/[1]≥32 sem erro ou
com SIGSEGV; meu decoder recusa `malformed-header` — único ponto de divergência
permitida, sempre em entradas fora do domínio do encoder.

## 3. Cobertura de tokens (fixtures + casos discriminantes, todos decode-oráculo vs meu)

`incr-run`, `common-run`, run-delta mode0/mode1/mode2, inline mode3,
terminador 0x0F: cobertos. Mask bytes {0x00,0x01,0x10,0x1F}, packet_length
{1,2,3,4,5,6,7,8,9,10,11} (9=const_500, 10=single/big_deltas… 11=planes), bordas
de sinal 0x7FFF/0x8000, wrap ±1 em 0xFFFF↔0x0000, runs de zeros 15/16/17/31/33
(cnt de 4 bits, máx 16/token). Em TODOS os casos in-domain: byte-exato com o
oráculo e `consumed_word_rounded == len(stream)`.

## 4. `bytes_consumed` (definição adotada)

Contrato v1 exige span exato. Registro dois números por stream:
* `bytes_consumed` = 6 + ceil(bits_realmente_lidos/8) (span mínimo sustentado
  por bytes lidos);
* `consumed_word_rounded` = span que o próprio mdcomp consome (ibitstream lê em
  palavras de 16 bits; `enigma::decode` faz `seekg(loc + tellg)`): **igual a
  len(stream) nas 10 streams completas** — esta é a âncora assertada.
`empty.eni` não precisou de skip: o terminador existe (8 B, wr-span 8).

## 5. Parâmetros externos (declarados, NUNCA adivinhados)

O stream NÃO contém: `value_offset` (base de tiles/pattern adicionada aos
valores decodificados — nos jogos clássicos), `write_destination` (endereço de
escrita, ex. VRAM) nem `write_size`.

**RESOLVIDO para o Sonic 1 (2026-10-01), pelo consumidor real — não pela
aparência da imagem:**

* O decodificador 68k do Sonic 1 está em `$171E` e tem **um único sítio de
  chamada na ROM inteira**: `jsr $171E` em `0x1b6d2` (varredura de
  `4E B9 00 00 17 1E` na ROM toda).
* No sítio de chamada (rotina de carga do mapa, tabela de ponteiros em
  `0x1b64c`): `movea.l (-122,PC,D0.w),A0` (`0x1b6c4`, entrada da tabela) →
  `lea $FF4000,A1` (`0x1b6c8`, **destino = porta de dados VDP**) →
  `move.w #0,d0` (`0x1b6ce`) → `jsr $171E` (`0x1b6d2`).
  **`value_offset = 0` medido, não escolhido.**
* Semântica do decodificador 68k (desassemblado por bytes): `movea.w d0,A3`
  guarda o offset; `adda.w A3,A2` / `adda.w A3,A4` aplicam o offset por
  **SOMA** aos cursores incrementing/common; na leitura inline (`$17DC`) o
  offset inicia `D3` e recebe **OR/ADD** dos bits altos lidos pela máscara
  (bits 15..11). Com `d0=0` tudo colapsa em valores crus.
* A saída vai direto para a porta de dados VDP → o recurso é um **nametable**
  (64×32 entradas), não tile art. Evidência completa:
  `data/rex_corpus_b/recursos/sonic1-mapa-0x65432.json` (e irmãos dos outros
  5 offsets) e `data/rex_corpus_b/recursos/consumidor-sonic1-mapas.json`.
* Empacotamento real confirmado: as 6 streams encadeiam na ordem da tabela com
  consumo word-rounded (1 byte de pad antes da 6ª: `0x662f4+1233=0x667c5`,
  próxima em `0x667c6`) — confirma `consumed_word_rounded` (§4) em ROM real.

Para streams sem consumidor localizado (ex.: as 24 Enigma do Pulseman), o
registro permanece `{"parameter": null, "status": "not-evidenced"}`. O CLI
aceita `--offset N` como hipótese explícita do operador (`status:
operator-supplied-hypothesis`, aplicado como `(v+N) mod 2^16`).

## 6. Variantes: implementada vs blocked

* **IMPLEMENTADA (fixture-verified):** mdcomp plain-Enigma decode, paridade
  byte-exata com `enicmp` (SHA-256 `a017430c…96d18`, pin do commit
  verificado antes de cada uso) em 10 fixtures + 16 streams discriminantes +
  19 sondas de cabeçalho.
* **blocked:** paridade com driver 68k clássico de Sonic 2 (2º oráculo) — sem
  segundo oráculo no host; goldens literais artesanais — não necessários
  (paridade externa obtida), mas seguem fora de escopo; **moduled-Enigma**
  (`ModuledAdaptor<enigma,4096,1>` / `-x={pointer}` multi-bloco) — não
  exercitado pelo CLI sandboxado desta frente; encode próprio — NÃO
  implementado de propósito: streams de teste são geradas PELO ORÁCULO
  (encode `enicmp IN OUT`), logo não há roundtrip self-made; todo "roundtrip"
  aqui é autor-externo→oráculo→oráculo, rotulado nos registros.
* divergências de truncamento/aceitação (produto ≠ oráculo POR OBRIGAÇÃO do
  contrato, não bug): e02 → oráculo rc=0 com 4098 B; meu `truncated`.
  e05 → oráculo rc=0 0 B; meu `truncated`. e06 → oráculo rc=0 0 B; meu
  `malformed-header` (rc e tempo de recusa registrados). Nenhuma stream
  in-domain divergiu (first-diff = none em 100% a/b/c).

## 7. Comandos exatos (isolamento)

Toda chamada ao oráculo usa equivalente Python do wrapper mandatório
`docs/rex_corpus_b/reference/scripts_rex_profiles_codecs_common_sandbox.sh`
(`run_oracle`): `timeout -k 5 30s`, `ulimit -v 2GiB`, `-t 25s` CPU,
`-f 8192` blocos (4 MiB), stdin fechado. Manual:

```bash
sha256sum ~/.cache/rex-codecs/oracle-tools/bin/enicmp   # deve = a017430c…96d18
run_oracle 30 out.bin -- enicmp -x in.eni out.bin       # decode
run_oracle 30 out.eni -- enicmp plain.bin out.eni       # encode
python3 scripts/rex_corpus_b/enigma_research.py decode --in F --out G [--offset N] [--max-out N] [--work-limit N]
bash scripts/rex_corpus_b/enigma-validate.sh            # re-run completo (limpa data/rex_corpus_b/tmp-enigma/)
```

## 8. O que permanece NÃO provado

1. ~~Semântica/combinação do `value_offset` externo~~ — **FECHADO para o
   consumidor do Sonic 1** (§5: soma nos cursores, OR/ADD nos bits altos
   inline, valor medido 0 no único sítio de chamada). Outros jogos/streams sem
   consumidor localizado continuam `not-evidenced` — cada ROM prova o seu.
2. Equivalência com o decoder 68k clássico de Sonic 2 (2º oráculo absent).
3. Enigma modular (múltiplos blocos 4 KiB + tabela de offsets) — não
   exercitado.
4. Domínio real de ROM além do Sonic 1: as 24 streams Enigma do Pulseman têm
   paridade byte a byte confirmada (196/196 com as Nemesis — ver
   `pulseman-oraculo-completo.json`) mas CONSUMIDOR NÃO LOCALIZADO nas formas
   varridas (negativo delimitado: `consumidor-pulseman-streams.json`);
   `value_offset`/destino delas permanecem `not-evidenced`.
5. Encode do produto (recusa de plain ímpar com erro estruturado
   `input-not-in-domain` é obrigação registrada; este arquivo não implementa
   encoder — e01 é tratado no lado decode como header incompleto → `truncated`).
6. Observação da composição NO JOGO (emulação) — exige janela do integrador;
   o que está provado aqui é a cadeia estática decode→porta VDP.
