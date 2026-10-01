# Contexto gráfico MD — layout de tile, nametable e paleta (frente B, corpus)

Data das medições: 2026-09-30. Corpus somente leitura. Ferramentas externas fixadas
por SHA-256. Nada aqui toca o produto (sem IPC, sem UI).

## 1. A pergunta e a resposta

**Como 32 bytes de padrão viram 8×8 pixels de 4 bpp num Mega Drive?** Duas
hipóteses estavam em jogo:

* `chunky` — nibble empacotado: `byte = tile*32 + row*4 + col/2`, nibble **alto**
  na coluna **par**;
* `planar` — bitplanes: `byte = tile*32 + row*4 + plano`, e o pixel mora no bit
  `7-col` de cada um dos 4 bytes da linha.

**Resposta medida: `chunky`.** As três evidências abaixo são independentes entre si
(ferramenta oficial medida, fonte da mesma ferramenta, arte comercial renderizada).

### Evidência 1 — oráculo oficial medido (rescomp do SGDK)

* `rescomp.jar` (SGDK 2.11, ResComp 3.95), SHA-256
  `502a467047df66b7e4c24023fa2ccdceae3e963aee664ede4bdc28fb0f55e603`.
* Entrada: PNG 8×8 **autoral** com `pixel(r,c) = (r*8+c) & 15` (138 bytes), definição
  `TILESET tiles "tiles.png" NONE NONE ROW`.
* Saída medida (`out.s`), 32 bytes:

  ```
  tiles_data:
      dc.b 0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef, 0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef
      dc.b 0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef, 0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef
  ```

  que é exatamente a codificação `chunky` da grade autoral. A codificação `planar`
  da **mesma** grade seria `55 33 0F 00 / 55 33 0F FF` por linha — refutada byte a
  byte. Caso discriminante usado nos testes: um único pixel em `(0,7)` vira
  `00 00 00 01` na linha 0 em `chunky` e `01 00 00 00` em `planar`.

### Evidência 2 — a fonte do toolchain não tem passo planar

No SGDK 2.11 (`/home/misael/.cache/rex-codecs/references/sgdk`):

* `tools/commons/src/sgdk/tool/ImageUtil.java` — `convert8bppTo4bpp`:
  `result[i] = (data[2i] & 0x0F) << 4 | (data[2i+1] & 0x0F)`, ou seja, nibble alto =
  pixel par.
* `tools/rescomp/src/sgdk/rescomp/type/Tile.java` — comentário
  *"8 pixels of 4bpp per 'int' entry"*; `hflip` é `TypeUtil.swapNibble32` + inversão
  da ordem dos ints, `vflip` é inversão da ordem dos ints. Essa aritmética de flip só
  é correta sob o modelo chunky: sob o modelo planar, um hflip seria inversão de bits
  dentro de cada byte, não troca de nibbles.
* `tools/rescomp/src/sgdk/rescomp/resource/Tileset.java` — copia `t.data` cru para o
  `BIN` que vira ROM; nenhum passo entre um e outro.
* `grep -rn -i "planar\|bitplane"` em `src/`, `inc/`, `doc/` e `tools/` do SGDK 2.11
  **não devolve nada** (verificado 2026-09-30). Não existe conversão de plano na
  ferramenta — o que vai para a ROM é o pacote de nibbles.

### Evidência 3 — oráculo visual sobre arte comercial confirmada

Plains Nemesis de `Pulseman (Japan) (Translated En).gen` (SHA-256
`0745e1a248548bcec0fcd50343c0df1f2b9cfd0303c07010ca6ef933e5b4ec43`) cujo resultado
bateu **byte a byte** com o decodificador de referência externo (`nemcmp`, mdcomp
`72c6df405a75d322c5b3722da46c3abb864d3793`) — isto é, o plain não é hipótese, é o
mesmo bytes que a referência produz. Cada plain foi renderizado nas duas hipóteses
(`scripts/rex_corpus_b/measure-md-layout.py --render`); PNGs ficam **fora do Git**,
registrados por SHA-256:

| stream   | tiles | chunky (SHA-256, 16 primeiros) | planar (SHA-256, 16 primeiros) |
|----------|-------|---------------------------------|---------------------------------|
| `0x979d4`| 44    | `957c6a5425331015`              | `a0d65c50a62466d8`              |
| `0x97bba`| 56    | `a111115ce1a1ec87`              | `d939804039d60655`              |
| `0x97da6`| 40    | `c4548d224b432a3f`              | `c596c2479f4c3fb9`              |
| `0x981aa`| 64    | `f3ea7ae080300291`              | `0784ee1c63d1e833`              |
| `0x99112`| 16    | `0c0f3eacdbcf1c74`              | `23a009db894113d1`              |
| `0xec144`| 48    | `95c44195ed5be1c5`              | `bd6bc4385ceafb0a`              |

Observação registrada (inspeção humana, 2026-09-30, escala 6×, cinza = índice×17):
em `0x981aa` e `0x99112` a leitura chunky mostra traços contínuos, bordas diagonais
suaves e formas reconhecíveis; a leitura planar dos **mesmos bytes** mostra listras
verticais rígidas — assinatura de ler um nibble como se fosse um plano. Em `0xec144`
(dithering ordenado denso) o mesmo contraste aparece: chunky = textura coerente,
planar = colunas em pentinho.

## 3. O instrumento estatístico pré-registrado — e por que ele NÃO sustenta a afirmação

Para não decidir o layout por gosto, foi pré-registrado um critério **antes** de
medir ROM (`md-tiles.py`, margem `0,6`; preso por teste em `test-md-tiles.py`
seção 8) e **calibrado em verdade de solo nos dois layouts**:

| imagem de calibração (autoral) | plain chunky: certa / errada | plain planar: certa / errada |
|--------------------------------|------------------------------|------------------------------|
| blocos de 4 px                 | 0,130 / 0,451                | 0,130 / 0,274                |
| tiles planos                   | 0,092 / 0,268                | 0,092 / 0,143                |
| blocos de 2 px                 | 0,481 / 0,662                | 0,481 / 0,485                |
| variação a cada pixel          | 1,000 / 0,787 (**inverte**)  | 1,000 / 0,763 (**inverte**)  |

Aplicado aos seis plains reais, o critério respondeu **`inconclusivo` em 6/6**
(`data/rex_corpus_b/recursos/pulseman-layout-medido.json`). Ele tinha razão em não
afirmar: a arte real usa **dithering ordenado**, que é exatamente alternância
legítima a cada pixel — o pressuposto "leitura correta é mais suave" cai. No caso
`0xec144` a leitura errada chegou a ficar mais suave (chunky 0,62 vs planar 0,41)
e ainda assim o plano planar é pentinho vertical, visível.

Consequência metodológica registrada: **a afirmação de layout não depende do
instrumento estatístico**; depende das evidências 1–3. O instrumento continua no
módulo porque ele é falsificável nos dois sentidos (a calibração acima o pegaria
errando) e porque recusa responder é um resultado útil. O caso ambíguo está preso
como negativo no teste, para ninguém "melhorar" o critério até ele afirmar.

## 4. Contratos fixados (todos presos por teste de resposta conhecida)

`scripts/rex_corpus_b/md-tiles.py` — 48 verificações em `test-md-tiles.py`:

* **tile**: `pixel_location`, `decode_tile`, `encode_tile`, `decode_plain`
  (tamanho exato; truncado é erro, não zero preenchido).
* **nametable**: `nametable_entry` / `make_entry` com os campos da fonte oficial
  (`Tile.java`): índice `0..0x7FF`, **hflip bit 11**, **vflip bit 12**,
  **paleta bits 13-14**, **prioridade bit 15**.
  Essa divisão **corrige** a que `nametable-structure.py` trazia como hipótese
  (bit14 vflip / bit13 hflip / bits12-11 paleta): as posições ali eram suposição,
  as daqui vêm da fonte do toolchain. O medidor foi alinhado na mesma rodada — e
  os dois módulos são agora confrontados **por teste**:
  `test-nametable-structure.py` exige que `entry_fields(w)` e
  `MD.nametable_entry(w)` coincidam nas palavras `0x0000, 0x0800, 0x1000, 0x2000,
  0x4000, 0xD923, 0xFFFF`. As taxas que o medidor apura são por bit, então a
  medição anterior não era inválida — a *rotulagem* sim, e o relatório do Sonic 1
  foi regerado com os rótulos certos (counts crus, deltas, SHA de saída e veredito
  de período permanecem idênticos; só os histogramas de campo e
  `palette_nao_zero` mudam: em `0x65432`, paleta passa de `{0:1937,1:34,2:8,3:69}`
  para `{0:1938,1:107,2:3}` e vflip de 3 para 77).
* **paleta**: `color_word_to_rgb` (`xxxBBBxGGGxRRRx`, 3 bits/canal,
  `(v*255+3)//7` → branco em 255, não 252) e `decode_palette` (palavras
  big-endian, truncada é erro). Bits fora dos campos (0, 4, 7, 12) são ignorados.
* **atributos**: `apply_hflip`, `apply_vflip`, `is_transparent` (só índice 0).

Contrato do produto (`src-tauri/src/tools/reverse/decomp/rex_resources.rs`,
`md_pixel_location`) — **não alterado**: a cópia de pesquisa bate com ele, inclusive
no deslocamento `tile*32 + row*4 + col/2` e no nibble alto na coluna par.

**Adaptação registrada**: o comentário em `scripts/rex_corpus_b/nemesis_research.py`
(`TILE_BYTES = 32`, *"Art Word 8x8 de planos de bit = 32 bytes"*) herdava a suposição
de bitplanes. O **tamanho** está certo — confirmado por 172/172 recursos Nemesis de
Pulseman com `output_size == rtiles*32` — mas o **rótulo** do layout está errado.
Nada no decodificador depende do rótulo; só o comentário precisa de correção.

## 5. O que continua deliberadamente separado

Nada aqui associa um tile a uma paleta, a um plano de prioridade ou a uma posição de
mapa. Sem esse vínculo comprovado, tiles, nametable e paleta ficam como recursos
distintos — nenhuma imagem "parecida" foi montada. Vínculo comprovado é a etapa
seguinte (ver §6).

## 6. Reproduzir

```bash
cd /home/misael/RDS-REX-CORPUS-B
python3 scripts/rex_corpus_b/test-md-tiles.py
python3 scripts/rex_corpus_b/test-nametable-structure.py
python3 scripts/rex_corpus_b/measure-md-layout.py \
    --localizar "data/rex_corpus_b/recursos/locate-Pulseman (Japan) (Translated En) (Translated PtBr).json" \
    --out data/rex_corpus_b/recursos/pulseman-layout-medido.json \
    --render /tmp/rex-corpus-b/layout-visual        # PNGs fora do Git
# relatorio de estrutura de nametable do Sonic 1 (6 offsets Enigma ja confirmados)
python3 scripts/rex_corpus_b/nametable-structure.py \
    --rom "/home/misael/emulation/roms/genesis/Sonic the Hedgehog (USA, Europe).bin" \
    --offset 0x65432 --offset 0x656ac --offset 0x65abe \
    --offset 0x65e1a --offset 0x662f4 --offset 0x667c6 \
    --out data/rex_corpus_b/recursos/sonic1-nametable-structure.json
```

O experimento do rescomp (evidência 1) foi executado em diretório local com o jar
pelo SHA acima; a definição, o PNG autoral e o `out.s` medido estão descritos em
§1 e não são redistribuídos aqui.

## 7. Pendências desta frente

1. Achar (ou provar que não há) o vínculo mapa↔tiles↔paleta: uma composição com
   associação **comprovada** por consumidor, ou o achado explícito "recursos
   separados". A busca de consumidor por carregamento catalogado está aberta
   (`pulseman-inventario-tabelas.json`: 4830 cargas, nenhuma apontando para tabela
   de streams Nemesis confirmados; forma base+índice é ponto cego conhecido).
2. Negativos deliberados da prova visual (nibble invertido, paleta errada, flip
   errado, base errada, associação errada) com critério fixado antes — etapa 5 da
   missão.
3. A rotulagem de campos em `nametable-structure.py` **foi corrigida** para as
   posições da fonte oficial (§4), com o relatório do Sonic 1 regerado e o
   confronto entre os dois módulos fixado por teste.
