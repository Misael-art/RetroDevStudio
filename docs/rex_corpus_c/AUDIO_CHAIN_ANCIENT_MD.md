# Cadeia de áudio — Ancient Music Driver -MD- (frente REX corpus-C)

Ferramenta de pesquisa **read-only, BYOR**. Nada aqui executa bytes de ROM: a
imagem é tratada como dado e decodificada por `cstool` (Capstone 5.0.9) ou lida
como ints. Nenhum byte comercial entra no Git — só hashes, offsets e contadores.

Escopo: **estrutura de áudio em ROM real**, não editor de música. Ver
`MISSION` no cabeçalho de `scripts/rex_corpus_c/extract.mjs`.

## 1. ROMs e identidade (sem atribuir por franquia nem por nome de arquivo)

A identidade vem de **banner ASCII de primeira-mão dentro da ROM**, do
checksum SEGA válido e do hash do contêiner/membro/normalizado.

| ROM (membro) | sha-256 normalizado | tamanho | banner declarado | offsets do banner |
|---|---|---|---|---|
| `Story of Thor, The (Europe).gen` | `9afb0388a7f045241f9fddb87afe20ade65acbed9f1605637d8cbe23c0fd6415` | 3145728 (5398 de padding) | `Ancient Music Driver -MD- 68000/Z80 Program Version 1.06` | 68k `0x60010`, Z80 `0x62e58` |
| `Streets of Rage 3 (USA).gen` | `8855f797591823855cfe6440a0e33daac005b2531ecd2720ddc0c8718ed2ebe4` | 3145728 (sem padding) | `... Version 1.00` | 68k `0x1a8010`, Z80 `0x1a9fce` |
| `Mega Man - The Wily Wars (Europe).gen` | `b9e41127281edbfc16b680d99d8187234c00b0e7c4cd4182d8a93aface9a0787` | 2102230 | **nenhum** (SMPS não publica banner) | — |

Em ambas as ROMs Ancient o banner Z80 fica exatamente em
`início_da_imagem_Z80 + 0x20` — invariante observado, não suposição.

## 2. Cadeia reconstruída a partir das instruções do próprio driver

Cada passo abaixo foi lido do fluxo de instruções 68000 na ROM local. A
reconstrução não usou documentação externa como premissa; a fonte independente
só serviu de **verificação cruzada** (§4).

```
código do jogo
  └─ índice de músicas      256 registros × uint32 big-endian em TABLE
        valor = deslocamento do cabeçalho relativo ao próprio TABLE; 0 = vazio
        provado por: andi.w #$ff,d0 / lsl.w #$2,d0 / move.l (a0,d0.w),d1 / adda.l d1,a0
        TABLE = 0x638d4 (SoT) | 0x1aa6e4 (SoR3)
  └─ cabeçalho da música    vetor de uint16 little-endian auto-relativos ao cabeçalho
        0 = faixa vazia; lido por move.b $1(a0),d3 / lsl.w #$8,d3 / move.b (a0),d3 / add.l d1,d3
        e o cursor avança 2 por faixa (addq.l #$2,a0 / move.l a0,$2(a6))
  └─ stream da faixa        movido para $c(a6); eventos decodificados em 68k
  └─ imagem Z80             8 KiB copiada ROM → $a00000
        SoT: ROM 0x62e38, cópia em 0x6134e
        SoR3: ROM 0x1a9fae, cópia em 0x1a8a66 (lea $1a9fae,a1 / lea $a00000,a2 /
              move.w #$1fff,d0 / move.b (a1)+,(a2)+ / dbra / move.w #0,$a11200 / move.w #0,$a11100)
        protocolo de ocupação em SoT 0x611f4: move.w #$100,$a11100; btst #0 até liberar
```

### Modelo de evento (derivado do dispatch em SoT `0x619c4`)

`movea.l $2(a6),a0 / move.b (a0)+,d2 / cmpi.b #$f0,d2 / bcc <dispatch> / tst.b d2 / bne <nota> / <fim>`

| faixa | evento | tamanho | origem da prova |
|---|---|---|---|
| `0x00` | fim de stream | 1 | `tst.b d2 / beq` → tratante `0x62156` |
| `0x80–0xef` | duração | 1 | `bclr.b #$7,d2 / bne` → `move.b d2,$6(a6)`+`$7(a6)`; `$06` decrementado por `subq.b #$1,$6(a6)` |
| `0x01–0x7f` | nota | 2 | operando: `andi.b #$f` → índice da tabela de períodos; `andi.w #$f0 / lsl.w #$7` → código de oitava |
| `0xf0–0xff` | comando | 1 + operandos | `subi.b #$f0 / add.w d2,d2 / move.w JT(pc,d2.w) / jsr JT(pc,d2.w)` |

Tabela de períodos: SoT `0x62da8`, SoR3 `0x1a9f1e` (16 × uint16 BE). Tabela de
comandos: SoT `0x61f84`, SoR3 `0x1a912a`.

Larguras de operando por comando foram lidas handler a handler:
`f0:1 f1:1 f2:2(LE16) f3:1 f5:2(saltos) f6:0 f7:4 f8:1 f9:1 fa:2 fb:1 fd:0 fe:2(saltos)` — **provadas**;
`f4` (redespacha por `0x6229a`), `fc` (loop sobre `lea $84(a6),a1`), `ff` (sub-tabela em `0x61fb8`) — **parciais**.
O extrator **para** num comando parcial e registra `unknown_events` em vez de
adivinhar a largura. É a diferença entre uma cadeia provada e um parser que
"funciona por sorte".

## 3. O que NÃO está provado (e continua declarado como desconhecido)

* Semântica de cada comando `f0–ff`: sabe-se a largura, não o significado.
* Instrumentos FM, vozes PSG, envelopes e amostras: **não alcançados**.
* Tabela de períodos emitida como código opaco. Nenhuma afirmação de nota,
  frequência ou MIDI — o driver soma `oitava << 7` ao valor da tabela, o que não
  é uma mapeamento MIDI demonstrável.
* Não houve **captura de áudio**. Logo, **não se afirma reprodução sonora**:
  nada aqui foi comparado a WAV/VGM obtido por emulação. Sem essa janela, a
  cadeia é estrutural, não acústica.
* MAME existe no host, mas abrir janela de emulação competiria com outros
  frentes pesados; a correlação comando→som fica registrada como pendência.

## 4. Validação independente e generalização

* **Referência independente**: a desmontagem MIT de *Beyond Oasis (US)*
  (`tylerphotos/beyondoasis-disasm`, `docs/audio.md` + `src/audio/*.listing.asm`)
  descreve, por caminho próprio e sem consulta a este documento: índice de 256
  longs relativos em `$638D4`, cabeçalhos little-endian, nota `<$80` via tabela
  de períodos, dispatch `$F0–$FF` pela tabela `$61F84` e imagem Z80 de `$2000`
  bytes em ROM `$62E38`. Bate com o que foi lido das instruções.
  Duas divergências honestas: aquela fonte rotula `≥$80` como "comando" (a
  ramificação real separa `$80–$ef` de `$f0–$ff`) e marca terminador, papel dos
  argumentos de comando e layout de patch como UNKNOWN/PROVISIONAL — os mesmos
  itens que aqui ficam como desconhecidos.
* **Validação reservada**: SoR3 (v1.00) foi escolhida *antes* de sintonizar o
  reconhecimento e serve de segundo ROM, com âncoras derivadas
  independentemente. Resultado com a gramática herdada: 3 músicas,
  1056 notas / 1420 comandos / 25 durações / 8 fins limpos, 13 paradas em
  largura parcial, 0 ponteiros inválidos. A estrutura atravessa duas versões do
  driver sem reajuste de regras.
* **Gate de identidade**: aplicar o perfil de SoT à ROM de SoR3 devolve
  `identity_mismatch` e sai 1 sem extrair nada (`--allow-identity-mismatch` é a
  única saída).
* **Tabela semelhante sem consumidor**: o extrator recusa `unproven_consumer`
  se o perfil declarar endereço de tabela sem os sítios de instrução que a leem.
  Aritmética parecida com ponteiros não é estrutura.
* Casos adversariais cobertos por teste unitário (sem ROM real): ponteiro fora
  da ROM, cabeçalho não monotônico, operando truncado, stream que nunca termina
  (limite `max_events`/`max_bytes` e corte duro no offset da faixa seguinte).

## 5. Correção de fase registrada em cima do próprio trabalho

O rastreio da Fase 1 decidiu identidade **só por banner ASCII** e concluiu
"nenhuma ROM SMPS no corpus". Isso estava **errado por construção**: driver
SMPS-Z80 não publica string de versão. A verificação do padrão de código
`2a 02 1c` (`ld hl,($1C02)`) em `Mega Man - The Wily Wars (Europe).gen`
`0x1e505a` confirma um controlador da família SMPS no corpus. Consequência: a
detecção por banner é necessária mas não suficiente, e o perfil SMPS-Z80 fica
como frente de trabalho follow-up (é o único perfil com especificação de
primeira-mão pinável). O perfil Ancient entregue aqui não depende dessa
conclusão.

## 6. Proposta de adaptador (sem tocar no produto)

Não é editor de música, e não propõe integration ainda:

1. `rex_audio_scan_identity(rom_bytes) -> {banners[], candidate_tables[]}` — só
   metadados; expõe o que `identify.mjs` já faz, com a ressalva do §5.
2. `rex_audio_read_song_index(rom, profile) -> {slots[], consumers[]}` — exige
   sítios de instrução, recusa tabela sem consumidor.
3. `rex_audio_walk_track_stream(rom, offset, profile, limits) -> {events[],
   unknown_events[], stopped}` — devolve `stopped` sempre; nunca continua após
   largura não provada.
Contrato de saída: `scripts/rex_corpus_c/extract.mjs --rom <file> --profile
data/rex_corpus_c/profiles/<profile>.json` com os campos mínimos da missão
(`rom_sha256, normalized_sha256, driver_profile, offsets, references,
event_types, unknown_events, evidence, limitations`). Sequência por evento só
sai com `--include-events`, para o padrão permanecer metadado.

## 7. Pendências honestas

1. Captura em emulador para correlacionar um comando com um evento ouvido — sem
   isso, "reprodução de som" não é afirmado.
2. Instrumentos/envelopes/amostras e o significado de `f0–ff`.
3. Mucom-MD (SoR2): zero documentação de nível de byte em fonte alguma; o scan
   local confirma o banner, e a cadeia ainda não foi reconstruída.
4. Perfis por ROM: as âncoras são endereços absolutos; cada ROM nova exige
   re-derivação, não recusa "por família".
