# aPLib + TiledImage — consolidação para a próxima prova BYOR (PASSO 5)

Data: 2026-09-26. Dono: integrador. Este documento **não promove nada**: ele
registra **o que existe, onde existe, o que está provado e o que falta** antes de
abrir a frente de implementação do decoder aPLib em Rust canônico. Nada aqui
altera a matriz de codecs (`ROUND_STATE.md`): aPLib continua `blocked` em
`decode vs ref`, `encode vs ref`, `negativos` e `recurso real`, com `fixture`
apenas em "vetores+holdout".

## 1. Onde está cada coisa (verificado nesta data, por `git`, sem merge)

| Frente | HEAD | O que entrega | Caminhos |
|---|---|---|---|
| A (endereçamento) | `dbdc122` em `codex/rex-a-addressing` | Prova do alvo visível em tela (TiledImage APLIB) e a classe/consumidor de `0xc8cc8` — **não integrada** ao tronco do integrador | `scripts/rex_profiles/lz4w/{tiledimage.mjs,tiledimage.test.mjs,aplib.mjs,aplib.test.mjs,resourceclass.mjs,residual.mjs,visibility.mjs}`, `docs/rex_profiles/lz4w/VISIBLE-RESOURCE-EVIDENCE.md`, `data/rex_profiles/lz4w/{visible-resource-manifest.json,residual-attribution-cp129.json}` |
| A — commit do alvo | `19094b0` "test(rex): TiledImage APLIB @0x21b5c reconstruido pixel a pixel contra checkpoint-129" | o instrumento e as expectativas RED-antes-da-implementação do caso visível | idem |
| A — cópia dos goldens | mesmo branch | 9 pares `.ap`/`.expected.bin` + `source-manifest.json` em namespace **de B** | `data/rex_profiles/codecs/aplib-golden/` |
| B (codecs) | `9b2389d` em `codex/rex-b-codecs` (PR #79) | Pacote de contrato aPLib: variante fixada, 9 goldens, 8 plains cross-verified, 7 negativos negative-spec, contrato de produto e CLI de verificação | `data/rex_profiles/codec/aplib/**` (51 arquivos), `scripts/rex_profiles/codecs/aplib/{PRODUCT-CONTRACT.md,verify-product.sh,build-vectors.sh,gen_vectors.py}`, `docs/rex_profiles/codecs/aplib.md` |
| B — commit do pacote | `4f3c6ae` "test(codecs/aplib): add contract-derived negatives, EOD boundary golden, product contract package" | g08 + os 7 negativos + `PRODUCT-CONTRACT.md` | idem |
| Integrador (este tronco) | `d0744b0` | só LZ4W no produto; aPLib existe como **enum**, não como decoder | `src-tauri/src/tools/reverse/decomp/rex_resources.rs` |

## 2. O alvo da próxima prova (BYOR, HAMOOPIG)

Do documento de A (`VISIBLE-RESOURCE-EVIDENCE.md`, 191 linhas), com a identidade
da ROM que ele mede: corpus `data/canonical-local-2026-09-21/corpus/references/
hamoopig-reference.bin`, SHA-256 `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`,
917 504 bytes, header `HAMOOPIG (HAMOOPI MD PORT BY HUMBERTODIAS)`.

Cadeia estrutural lida do layout do SGDK 2.11 pinado (não inferida por
sequências de ponteiros):

| Componente | Endereço | Campos medidos por A |
|---|---|---|
| TiledImage | `0x21b5c` | `palette -> 0x21b56`, `tileset -> 0x21b44`, `tilemap -> 0x21b4c` |
| TileSet | `0x21b44` | `compression=1` (APLIB raw), `numTile=500`, dados em `0x2e4d4` (stream consome 4 485 B, produz 16 000 B) |
| TileMap | `0x21b4c` | `compression=1` (APLIB raw), 40×28, dados em `0x2d534` (stream consome 1 196 B, produz 2 240 B) |
| Palette | `0x2cbe8` | `numColor=16`, words BE `0xABGR` |

Discriminantes medidas por A contra o frame congelado `checkpoint-129` (Genesis
Plus GX v1.7.4 `46a5521`, PPM `5f4ce09d…`):

- formato dos tiles: **chunky** packed-nibble (`byte = row*4 + col/2`, nibble
  alto = coluna par) → **95,90 %** de correspondência por pixel contra
  **64,79 %** planar;
- flips: 15 entradas h, 27 v — ignorá-los derruba 95,90 % → 94,46 % (efeito
  medido, não assumido);
- paleta: 12 dos 16 índices usados têm uma única cor no frame; os índices 2 e 14
  carregam pixels não explicados pelo recurso (sprities sobrepostos ao plano A);
- os outros dois TiledImage da ROM ficam descartados como capa base: `0x21b80`
  (APLIB, 543 tiles) explica 27,98 % do frame e `0x21ba4` é `compression=0` com 2
  tiles. **Nenhum TiledImage referencia TileSet LZ4W** — o LZ4W desta ROM vive em
  sprites, e o que está comprovadamente na tela é APLIB.

Isso é o que motiva a troca de alvo: o recurso LZ4W `0xc8cc8` continua
`BLOQUEADO` quanto ao efeito em jogo (sonda causal sem diferença observada em
WRAM/VRAM, e as regiões alcançáveis pelo core não incluem CRAM nem o destino do
desempacotador), enquanto `0x21b5c` tem correspondência pixel a pixel medida.

## 3. O contrato aPLib que a implementação tem que cumprir

Variante fixada por B (do `manifest.json`, literal): stream **raw sem header**
(`"AP\0"` ausente) — byte 0 é o primeiro literal; tags de 8 bits lidas MSB→LSB
com busca de tag nova **somente** quando a máscara zera, o que permite token
atravessando tag; bytes de dados intercalados na ordem de consumo; gamma2 por
pares (dado, controle) com valor mínimo 2; EOD = token `110` + byte `0x00`;
ajustes de length `+2` (`off < 128` ou `off ≥ 32000`) / `+1`
(`1280 ≤ off < 32000`); rep-match apenas com LWM = 3.

API exigida (CONTRACTS §4 = `PRODUCT-CONTRACT.md` §1):
`decode(stream, limits) -> {data, bytes_consumed} | erro estruturado` e
`encode(data, limits) -> stream | {error, needs_space}`, com `limits = {max_mem,
max_work, max_out, cancelled}`; erros `truncated`, `invalid-reference`,
`overflow`, `excessive-output`, `work-limit`, `cancelled`; sem panic, sem leitura
fora do buffer, sem loop sem limite; validar antes de alocar.

Regras de rejeição são **derivadas do contrato, não do oráculo** (§3): os
decodificadores de referência não validam entrada (leem além do EOF — UB), então
aceitação de truncamento pelo oráculo **não** é comportamento esperado do
produto. `bytes_consumed` termina imediatamente após o byte de comando do EOD:
em `g08_eod_trailing` (EOD + 5 bytes de lixo) o produto deve produzir o plain
completo com `bytes_consumed == 6`, **não 11** — bytes depois do EOD pertencem ao
bloco vizinho da ROM. `max_work` sugerido: `2*len(stream) + max_out`.

Vetores publicados por B e suas expectativas (§4): 8 plains `*.apultra.ap` /
`*.apj.ap` e 9 goldens (decode == plain e `bytes_consumed == len(stream)`), 7
negativos `n01..n07` com `expected_error` próprio (`truncated`, `invalid-reference`,
`invalid-reference`, `truncated`, `excessive-output` com `max_out` do JSON,
`invalid-reference`, `invalid-reference`).

## 4. Verificações independentes feitas agora (nada copiado de alegação)

1. **Hash agregado da fixture de B, recomputado por mim** a partir da árvore
   commitada do branch, seguindo a receita canônica declarada
   (`sha256( sha256sum ordenado LC_ALL=C de plain/ golden/ negative/ ++ manifest.tsv )`):
   `3a9d7e9e2312a7457003feb8d15214926f84354d3b19aa6039e2a3a3b66bec0d` — **idêntico**
   ao registrado em `data/rex_profiles/codec/aplib/evidence/vectors-pinned-by-two-oracles.json`
   (51 arquivos). Comando na §7.
2. **As duas cópias dos goldens são byte-idênticas.** A cópia de
   `data/rex_profiles/codecs/aplib-golden/` (branch A) e a canônica de
   `data/rex_profiles/codec/aplib/golden/` (branch B) coincidem nos 9 pares
   `.ap`/`.expected.bin`. Streams (SHA-256, do caminho B):
   `g01_literals 40e7a53d8e51f0e745d8a25ab0b63bcef0b7b6132db72553f350ba8dc3714f1a`,
   `g01b_single_byte 4eb77c03e5059ca48a7ee3553edfc80d7fb175710e9127bf82be3d3e15b333bc`,
   `g02_short_zero bcbc35d0be87d70dd7f65436548a987146865236dc7fd355fef39f7f303a196d`,
   `g03_short_match 3986eb2b6b34348f026a2d843ce68d43459e2ba1a60630139ce70b512caccc61`,
   `g04_long_off_lt128 d974ede4f7a428ccd2a308a0def46fcda9e6bef1fc01fcfd81a36713ba022a9a`,
   `g05_repmatch c8a521fbf5321e54392b6fa15f7c9c5f8becb450a52fff272fb227ca5cf1d9ff`,
   `g06_mid_offset a9f90ddde202e5a95d28a29ca73e644637fb6d375ac735800535ec1952cb5e46`,
   `g07_far_offset f0a20d593cdda4e61c59513427046931312eced0f9b36b342ca7f37a4d7ba2a4`,
   `g08_eod_trailing d3d5efd4eab5fcf0de868f8e219c87ae70a4a464fd040482100ec1a2304c3e80`.
   Consequência prática: a divergência é de **namespace**, não de conteúdo, e a
   frente do produto pode pinar um único conjunto.
3. **Estado real do produto** (grep na árvore deste tronco): só existe o rótulo.
   `rex_resources.rs:23` declara `TilesetCompression::Aplib` e `:54` mapeia
   `compression == 1 => Aplib`, mas `verify_lz4w_resource` recusa candidatos não
   LZ4W (`:99-106`) e **não há nenhum decoder aPLib em Rust** — as outras
   ocorrências de "aplib" no crate são a lista de strings de compressão do
   perfil SGDK (`core/project_mgr.rs:2340`) e um comentário de modelo em
   `holdout.rs:213`. Ou seja: o produto **reconhece** o header do alvo `0x21b44`
   e **não decodifica** o stream dele. Isso é exatamente a lacuna da frente.

## 5. Conflitos a resolver antes de integrar (não são cosméticos)

- **Namespace:** CONTRACTS v1 §"Propriedade de arquivos" dá a B
  `data/rex_profiles/codecs/`; B publicou em `data/rex_profiles/codec/aplib/`
  (singular, seguindo §1 `data/rex_profiles/<kind>/<profile_id>/`), e A copiou
  goldens para dentro do namespace de B (`data/rex_profiles/codecs/aplib-golden/`),
  que é o namespace declarado. Só o integrador pode alterar arquivos comuns, então
  a decisão (um caminho canônico + o outro como referência removida) é minha, não
  de A nem de B, e precisa de registro antes de qualquer import.
- **Oráculos fora do git:** a prova de B depende de `apultra` (commit
  `8f340057d7402c10da3d9c76c599f9ab83b8a22d`, Zlib) e de `apj.jar` SGDK v2.11
  (SHA-256 `2d8cdc63cc800e4b86ff4d9cdfe514001b77f788abcd02d61974dc319d026204`).
  No meu ambiente há binários **não rastreados** na raiz do repositório
  (`APJ-unpack`, `a.out`, `apultra-decode`) que parecem pertencer a essa
  frente: **não foram executados, não serão adicionados ao staging e não serão
  apagados** por esta frente. Antes de usá-los é preciso registrar procedência
  (URL/commit/hash) como foi feito com a ferramenta do oráculo 68k
  (`scripts/rex_profiles/integrator/lz4w_68k/PROVENANCE.md`).
- **Prova dependente de corpus:** a evidência de A exige a ROM comercial e os PPMs
  em `/home/misael/RetroDevStudio/rex-evidence-2026-09-10/backend-hamoopig`
  (fora do repositório). Corpus BYOR **não é dependência provisionável**: o teste
  do produto tem que ser verde sem ele, e a perna BYOR roda como aceite ignorável
  com falha honesta quando o arquivo ou a identidade faltarem — nunca `return`
  silencioso contado como PASS.

## 6. O que a frente "aPLib em Rust canônico" precisa entregar (ordem de aceite)

Ordem herdada de `PRODUCT-CONTRACT.md` §5, com os requisitos do CONTRACTS v1 §4
em cima:

1. Importar o conjunto de vetores **pinado** (hash agregado §4.1) para o namespace
   do integrador com proveniência registrada, como bytes autorais de fixture (são
   sintéticos: podem entrar no git; nenhum byte comercial entra).
2. `decode` no produto: 8 plains + 9 goldens com plain exato **e**
   `bytes_consumed` exato (o caso `g08` é o discriminante de consumo), e os 7
   negativos com o erro estruturado correspondente. Estados do perfil só avançam
   depois disto.
3. Paridade bidirecional com os oráculos, que é o que o CONTRACTS exige e o que
   ainda **não existe**: `decode(produto, encode(ref, dados)) == dados` **e**
   `decode(ref, encode(produto, dados)) == dados`. `encode` aPLib só entra nessa
   etapa, com `needs_space` honesto quando o orçamento não cabe.
4. Só então a ligação com o recurso real: localizar o stream APLIB a partir do
   header TileSet `0x21b44` (identificação é capacidade separada de decode —
   CONTRACTS §4: "sucesso de decode não prova identificação"), decodificar os
   16 000/2 240 bytes e reproduzir a correspondência de 95,90 % que A mediu por
   JS. A reconstrução visual e a reinserção em slot fixo permanecem etapas
   separadas, com transação, proteção de dependentes e recusa quando não couber.

Limites a declarar na entrega, desde já: os oráculos não validam entrada; o
espelho Python de B é auto-verificação da fixture, não segunda implementação;
não existe vetor de `work-limit`, `cancelled` nem `overflow` (são decisões de
política do produto, sem comportamento observável nos oráculos); a variante com
header `"AP\0"` está fora do escopo.

## 7. Reexecutar as verificações desta seção

```bash
# 1) hash agregado da fixture de B, recomputado da árvore commitada
git archive codex/rex-b-codecs data/rex_profiles/codec/aplib \
  | tar -x -C /tmp/rex-aplib-verify-2026-09-26
OUT=/tmp/rex-aplib-verify-2026-09-26/data/rex_profiles/codec/aplib
{ find "$OUT/plain" "$OUT/golden" "$OUT/negative" -type f \
    | LC_ALL=C sed "s|^$OUT/||" | LC_ALL=C sort \
    | (cd "$OUT" && xargs sha256sum); cat "$OUT/manifest.tsv"; } | sha256sum
# esperado: 3a9d7e9e2312a7457003feb8d15214926f84354d3b19aa6039e2a3a3b66bec0d

# 2) identidade byte a byte das duas cópias dos goldens
for f in g01_literals g01b_single_byte g02_short_zero g03_short_match \
         g04_long_off_lt128 g05_repmatch g06_mid_offset g07_far_offset g08_eod_trailing; do
  git show codex/rex-a-addressing:data/rex_profiles/codecs/aplib-golden/$f.ap | sha256sum
  git show codex/rex-b-codecs:data/rex_profiles/codec/aplib/golden/$f.ap   | sha256sum
done

# 3) estado do produto (sem decoder aPLib)
grep -rn "Aplib\|aplib" src-tauri/src --include=*.rs
```

Referências: `docs/handoffs/PROMPT_REX_INTEGRATOR_RESUME_2026-09-26.md` (a
afirmação do alvo, §"A identificou um alvo alternativo"), `docs/rex_profiles/
CONTRACTS.md` §"Propriedade de arquivos", §4 e §5, `docs/rex_profiles/ROUND_STATE.md`
(linha aPLib da matriz de codecs e o estado de `0xc8cc8`).
