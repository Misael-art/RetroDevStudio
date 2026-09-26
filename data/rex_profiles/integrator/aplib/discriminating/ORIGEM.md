# Vetores discriminadores de histórico de offset (aPLib)

Data: 2026-09-26. Dono: integrador. Bytes **sintéticos autoriais** — nenhum byte
de ROM comercial entra aqui.

## Por que estes quatro arquivos existem

O conjunto importado de B (`../vectors/`: 8 plains, 9 goldens, 7 negativos,
`manifest.tsv`) cobre rep-match **somente** depois de um match explícito `10`.
Os outros dois ramos que podem escrever em `offset_history` — o `110` (byte de
comando) e o `111` (offset curto de 4 bits) — nunca são seguidos de um
rep-match em nenhum vetor. A especificação de B (`docs/rex_profiles/codecs/aplib.md`
no branch `codex/rex-b-codecs`, §"Especificação do formato") declara `111` como
não-atualizante mas **não diz nada sobre `110`**.

Consequência medida nesta data: o decoder aPLib do produto passou nos 49 arquivos
importados e divergiu de cada um dos **dois** decodificadores de referência em
**703 dos 16 000 bytes** do TileSet APLIB real da ROM BYOR (offset de stream
`0x2e4d4`). O modo de falha era exatamente o ramo não coberto: o `110` não
gravava o histórico, então o rep-match seguinte reusava um offset obsoleto.

## Conteúdo

| Arquivo | O que fixa |
|---|---|
| `rep_after_cmd110.ap` (14 B) / `.expected.bin` (18 B) | `110` **atualiza** `offset_history`; o rep-match seguinte usa o offset 5 do `110`, não o 3 do `10` anterior |
| `rep_after_short111.ap` (12 B) / `.expected.bin` (15 B) | `111` **não** atualiza `offset_history` **e** devolve LWM a 3 (só assim `gamma2 = 2` é rep-match) |

Streams montados bit a bit por
`scripts/rex_profiles/integrator/aplib/gen_discriminating_vector.py`.

## Quem definiu o plain esperado

Não este repositório. Os dois decodificadores externos, em concordância, e a
alternativa rejeitada está documentada no script:

- `apultra` (referência independente do formato; commit `8f340057d7402c10da3d9c76c599f9ab83b8a22d`,
  Zlib) binário local `~/.cache/rex-codecs/oracle-tools/apultra`, SHA-256
  `64be2a7a8e44d3c5a4ed33de3b6d8aba294aa02870f51c29c8985fea4b34b207`
- `apj.jar` da SGDK 2.11, SHA-256
  `2d8cdc63cc800e4b86ff4d9cdfe514001b77f788abcd02d61974dc319d026204`
  (verificada nesta data antes de executar), em
  `~/.cache/rex-codecs/oracle-tools/SGDK211/bin/apj.jar`

Ambos reproduziram, nos dois casos, exatamente o `.expected.bin` (e nem a
predição do bug). Limitação honesta: o hash do binário `apultra` fica registrado
aqui como *este* exemplar executado; o commit acima é o da origem declarada por
B, e esta frente não reconstruiu o binário a partir do fonte.

## Reexecutar

```bash
python3 scripts/rex_profiles/integrator/aplib/gen_discriminating_vector.py --saidas /tmp/disc
for n in rep_after_cmd110 rep_after_short111; do
  ~/.cache/rex-codecs/oracle-tools/apultra -d /tmp/disc/$n.ap /tmp/disc/$n.apultra.bin
  java -jar ~/.cache/rex-codecs/oracle-tools/SGDK211/bin/apj.jar u /tmp/disc/$n.ap /tmp/disc/$n.apj.bin s
  cmp /tmp/disc/$n.apultra.bin /tmp/disc/$n.expected.bin 2>/dev/null \
    || cmp /tmp/disc/$n.apultra.bin /tmp/disc/$n.pred-A.bin
  cmp /tmp/disc/$n.apj.bin /tmp/disc/$n.pred-A.bin
done
```

## Onde é coberto no produto

`src-tauri/src/tools/reverse/decomp/rex_aplib.rs::tests::
aplib_rep_match_depois_de_cmd110_usa_o_offset_do_cmd` e
`aplib_rep_match_depois_de_111_usa_o_ultimo_offset_explicito`, mais o aceite
BYOR `rex_resources.rs::tests::byor_aplib_decodifica_os_dois_streams_do_tiledimage_visivel`.
