#!/usr/bin/env python3
"""Contratos de contexto grafico Mega Drive: tile 4bpp, nametable, paleta.

Pesquisa (fora do produto, sem IPC/UI). Cada contrato abaixo e medido ou derivado
de fonte oficial fixada — nao de memoria — e preso por teste de resposta conhecida
em `test-md-tiles.py`.

LAYOUT DO TILE 4bpp — CONFIRMADO CHUNKY (nibble empacotado), NAO "planos de bit"
-------------------------------------------------------------------------------
Evidencia (tres fontes independentes, na ordem da mais forte):

1. Oraculo oficial medido: `rescomp.jar` do SGDK 2.11 (ResComp 3.95), sha256
   502a467047df66b7e4c24023fa2ccdceae3e963aee664ede4bdc28fb0f55e603, executado em
   2026-09-30 sobre PNG 8x8 autoral com pixel(r,c) = (r*8+c) & 15, com
   `TILESET tiles "tiles.png" NONE NONE ROW`. Saida medida em `out.s`:
   `dc.b 0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef` repetido 4x (32 bytes).
   Leitura chunky prevista: identica byte a byte. Leitura planar prevista para a
   mesma imagem: `55 33 0F 00 / 55 33 0F FF` — refutada pela medicao.
2. Fonte do mesmo pacote: `tools/rescomp/src/sgdk/rescomp/type/Tile.java`
   ("8 pixels of 4bpp per 'int' entry"; hflip = `TypeUtil.swapNibble32`, vflip =
   inverter a ordem dos ints) e `tools/commons/src/sgdk/tool/ImageUtil.java`
   (`convert8bppTo4bpp`: nibble alto = pixel par). `resource/Tileset.java` copia
   `t.data` cru para o BIN que vira ROM. `grep -rn -i planar` em src/, inc/ e
   tools/ do SGDK 2.11 NAO devolve nada: nao existe passo planar na ferramenta.
3. Oraculo visual sobre arte comercial: plains Nemesis de
   `Pulseman (Japan) (Translated En).gen` (sha256
   0745e1a248548bcec0fcd50343c0df1f2b9cfd0303c07010ca6ef933e5b4ec43) confirmados
   byte a byte contra o decodificador de referencia (mdcomp `nemcmp`), renderizados
   nas duas hipoteses. Chunky: formas coerentes, bordas suaves. Planar dos MESMOS
   bytes: listras verticais rigidas (assinatura de ler nibble como plano).

O contrato do produto (`src-tauri/src/tools/reverse/decomp/rex_resources.rs`,
`md_pixel_location`) e o mesmo: offset = tile*32 + row*4 + col/2, nibble alto na
coluna par. Este modulo e a copia de pesquisa desse contrato, com a hipotese
planar mantida EXPLICITAMENTE como alternativa para o discriminador poder errar.

ADAPTACAO registrada: o comentario em `nemesis_research.py` (`TILE_BYTES = 32`,
"Art Word 8x8 de planos de bit = 32 bytes") herdava a suposicao de planos de bit.
O tamanho (32 bytes/tile) continua correto — e confirmado aqui por 172/172 recursos
Nemesis de Pulseman com `output_size == rtiles*32` — mas o ROTULO do layout esta
errado; o layout medido e chunky. Nada no decoder depende do rotulo.

PALAVRA DE NAMETABLE — campos da fonte oficial do toolchain
-----------------------------------------------------------
`Tile.java` do mesmo SGDK 2.11: `TILE_HFLIP_SFT = 11`, `TILE_VFLIP_SFT = 12`,
`TILE_PALETTE_SFT = 13` (2 bits), `TILE_PRIORITY_SFT = 15`, mascara de indice
`TILE_INDEX_MASK = 0x7FF` (2048 tiles). A divisao que `nametable-structure.py`
traz como hipotese (bit14 vflip / bit13 hflip / bits12-11 paleta) estava errada
em tres campos; o modulo foi corrigido para as posicoes acima, medidas na fonte.
Os dois modulos agora dividem a mesma palavra: o confronto esta fixado em
`test-nametable-structure.py`, que exige que `entry_fields(w)` e
`MD.nametable_entry(w)` coincidam palavra a palavra.

PALETA — palavra VDP `xxxBBBxGGGxRRRx`, 3 bits por canal
--------------------------------------------------------
Conversao identica a do produto (`md_color_word_to_rgb`): `round(v*255/7)`, ou
seja `(v*255+3)//7`, para que branco (7) chegue em 255 e nao em 252.

O que este modulo NAO afirma
---------------------------
* Nada sobre qual paleta, plano (prioridade) ou flip pertence a qual tile: sem
  vinculo comprovado entre mapa, tiles e paleta, os recursos continuam separados.
* O discriminador de layout (`adjacency_rate`/`verdict_layout`) e calibrado em
  verdade de solo sintetica nos DOIS layouts e pode devolver "inconclusivo"; ha
  casos (imagem com variacao a cada pixel) em que a leitura errada e mais suave
  que a correta — ver `test-md-tiles.py`, secao 8.

Uso (medir um plain ja decodificado):
  python3 scripts/rex_corpus_b/md-tiles.py --plain ARQUIVO.BIN --largura 8 \
      [--altura N] [--origem JSON] [--out saida.json]
"""
import argparse
import hashlib
import json
import os
import sys

SCHEMA_VERSION = "rex-corpus-b/md-tiles/1"

TILE_SIDE = 8
TILE_BYTES = 32                 # 8 linhas x 4 bytes
LAYOUTS = ("chunky", "planar")
# Margem pre-registrada do discriminador (fixada antes de medir ROM).
MARGEM_LAYOUT = 0.6
# Indice de paleta transparente no hardware.
INDICE_TRANSPARENTE = 0
# Campos da palavra de nametable (SGDK 2.11, Tile.java).
SFT_HFLIP, SFT_VFLIP, SFT_PALETTE, SFT_PRIORITY = 11, 12, 13, 15
MASK_INDEX = 0x7FF


def _validar_pixel(tile, row, col):
    if not (0 <= tile <= 0xFFFF):
        raise ValueError(f"tile {tile} fora de 0..65535")
    if not (0 <= row < TILE_SIDE and 0 <= col < TILE_SIDE):
        raise ValueError(f"pixel ({row},{col}) fora do tile {TILE_SIDE}x{TILE_SIDE}")


def pixel_location(layout, tile, row, col):
    """Onde (e como) mora o pixel (row,col) do tile `tile` dentro de um plain.

    chunky -> (offset_do_byte, "high"|"low"): os 4 bits do pixel em um byte.
    planar -> (offset_da_linha, [0,1,2,3]): 4 bytes consecutivos, um por plano, e o
              pixel mora no bit (7-col) de cada um.
    """
    _validar_pixel(tile, row, col)
    if layout == "chunky":
        return tile * TILE_BYTES + row * 4 + col // 2, ("high" if col % 2 == 0 else "low")
    if layout == "planar":
        return tile * TILE_BYTES + row * 4, [0, 1, 2, 3]
    raise ValueError(f"layout {layout!r} desconhecido (esperado um de {LAYOUTS})")


def _validar_grade(grade):
    if len(grade) != TILE_SIDE or any(len(r) != TILE_SIDE for r in grade):
        raise ValueError("grade de tile precisa ser 8x8")
    for r in grade:
        for v in r:
            if not isinstance(v, int) or not 0 <= v <= 15:
                raise ValueError(f"indice de paleta {v!r} fora de 0..15")


def encode_tile(grade, layout):
    """Grade 8x8 de indices 0..15 -> 32 bytes no layout pedido."""
    _validar_grade(grade)
    if layout not in LAYOUTS:
        raise ValueError(f"layout {layout!r} desconhecido (esperado um de {LAYOUTS})")
    buf = bytearray(TILE_BYTES)
    for row in range(TILE_SIDE):
        for col in range(TILE_SIDE):
            v = grade[row][col]
            if layout == "chunky":
                off, nib = pixel_location("chunky", 0, row, col)
                if nib == "high":
                    buf[off] = (buf[off] & 0x0F) | (v << 4)
                else:
                    buf[off] = (buf[off] & 0xF0) | v
            else:
                base, planos = pixel_location("planar", 0, row, col)
                for p in planos:
                    if (v >> p) & 1:
                        buf[base + p] |= 1 << (7 - col)
                    else:
                        buf[base + p] &= ~(1 << (7 - col)) & 0xFF
    return bytes(buf)


def decode_tile(data, tile, layout):
    """32 bytes em `data` a partir de `tile` -> grade 8x8 de indices 0..15.

    Truncado e erro: dado que falta nao vira zero preenchido.
    """
    if layout not in LAYOUTS:
        raise ValueError(f"layout {layout!r} desconhecido (esperado um de {LAYOUTS})")
    _validar_pixel(tile, 0, 0)
    if len(data) < (tile + 1) * TILE_BYTES:
        raise ValueError(
            f"plain truncado: {len(data)} bytes, tile {tile} pede "
            f"{(tile + 1) * TILE_BYTES}")
    grade = []
    for row in range(TILE_SIDE):
        linha = []
        for col in range(TILE_SIDE):
            if layout == "chunky":
                off, nib = pixel_location(layout, tile, row, col)
                b = data[off]
                linha.append(b >> 4 if nib == "high" else b & 0x0F)
            else:
                base, planos = pixel_location(layout, tile, row, col)
                linha.append(sum(((data[base + p] >> (7 - col)) & 1) << p for p in planos))
        grade.append(linha)
    return grade


def decode_plain(data, largura, altura, layout):
    """Plain de `largura` x `altura` tiles -> lista de grades, em ordem de tile.

    Exige tamanho EXATO: `largura*altura*32` bytes. Sobra ou falta e erro.
    """
    if not (isinstance(largura, int) and isinstance(altura, int)) or largura < 1 or altura < 1:
        raise ValueError(f"dimensoes invalidas: {largura}x{altura}")
    esperado = largura * altura * TILE_BYTES
    if len(data) != esperado:
        raise ValueError(f"plain de {largura}x{altura} tiles pede {esperado} bytes, "
                         f"tem {len(data)}")
    return [decode_tile(data, t, layout) for t in range(largura * altura)]


def assemble(grades, largura):
    """Lista de grades -> imagem (lista de linhas de indices), em ordem de tile."""
    if largura < 1 or len(grades) % largura:
        raise ValueError(f"{len(grades)} tiles nao cabem em largura {largura}")
    linhas = []
    for base in range(0, len(grades), largura):
        for r in range(TILE_SIDE):
            linhas.append(sum((grades[base + i][r] for i in range(largura)), []))
    return linhas


def adjacency_rate(data, largura, layout, altura=None):
    """Taxa de pares de pixels adjacentes DESIGUAIS (horizontal + vertical).

    Medida sobre o plain inteiro montado como grade de tiles. E o indicador do
    discriminador de layout: arte real tem regioes planas, entao a leitura correta
    produz menos bordas falsas que a errada.
    """
    if largura < 1:
        raise ValueError("largura de tiles precisa ser >= 1")
    if altura is None:
        if len(data) % (largura * TILE_BYTES):
            raise ValueError(f"plain de {len(data)} bytes nao e multiplo de "
                             f"{largura} tiles x {TILE_BYTES}")
        altura = len(data) // (largura * TILE_BYTES)
    grades = decode_plain(data, largura, altura, layout)
    img = assemble(grades, largura)
    h, w = len(img), len(img[0])
    total = (w - 1) * h + w * (h - 1)
    desiguais = total
    for r in range(h):
        linha = img[r]
        desiguais -= sum(1 for c in range(w - 1) if linha[c] == linha[c + 1])
    for r in range(h - 1):
        a, b = img[r], img[r + 1]
        desiguais -= sum(1 for c in range(w) if a[c] == b[c])
    return desiguais / total if total else 1.0


def verdict_layout(data, largura, altura=None, margem=MARGEM_LAYOUT):
    """Veredito do layout sobre um plain, com o criterio pre-registrado.

    "chunky" se taxa_chunky <= margem * taxa_planar; "planar" se o inverso; senao
    "inconclusivo". Nunca chuta: sem margem, devolve inconclusivo.
    """
    tc = adjacency_rate(data, largura, "chunky", altura)
    tp = adjacency_rate(data, largura, "planar", altura)
    if tc <= margem * tp:
        v = "chunky"
    elif tp <= margem * tc:
        v = "planar"
    else:
        v = "inconclusivo"
    return {"veredito": v, "taxa_chunky": round(tc, 6), "taxa_planar": round(tp, 6),
            "margem": margem, "criterio": "pares adjacentes desiguais sobre o plain "
                                          "inteiro; vence quem tiver taxa <= margem x "
                                          "a do outro"}


# --- paleta -----------------------------------------------------------------------
def color_word_to_rgb(word):
    """Palavra VDP `xxxBBBxGGGxRRRx` (3 bits/canal) -> RGB8 em escala cheia."""
    if not 0 <= word <= 0xFFFF:
        raise ValueError(f"palavra de cor {word} fora de 16 bits")
    canal = lambda v: (v * 255 + 3) // 7
    return (canal((word >> 1) & 0x7), canal((word >> 5) & 0x7), canal((word >> 9) & 0x7))


def decode_palette(data, entradas, base=0):
    """`entradas` palavras big-endian de cor a partir de `base` -> lista de RGB8."""
    if entradas < 0:
        raise ValueError("numero de entradas negativo")
    if len(data) < base + entradas * 2:
        raise ValueError(f"paleta truncada: {len(data)} bytes, base {base}, "
                         f"{entradas} entradas pedem {base + entradas * 2}")
    return [color_word_to_rgb(int.from_bytes(data[base + i * 2:base + i * 2 + 2], "big"))
            for i in range(entradas)]


# --- nametable --------------------------------------------------------------------
def nametable_entry(word):
    """Palavra de nametable -> campos, na divisao da fonte oficial do toolchain."""
    if not 0 <= word <= 0xFFFF:
        raise ValueError(f"palavra de nametable {word} fora de 16 bits")
    return {"tile": word & MASK_INDEX,
            "hflip": (word >> SFT_HFLIP) & 1,
            "vflip": (word >> SFT_VFLIP) & 1,
            "palette": (word >> SFT_PALETTE) & 3,
            "priority": (word >> SFT_PRIORITY) & 1}


def make_entry(tile, palette=0, hflip=0, vflip=0, priority=0):
    """Inverso de `nametable_entry`. Recusa valores que nao cabem nos campos."""
    if not 0 <= tile <= MASK_INDEX:
        raise ValueError(f"tile {tile} nao cabe em {bin(MASK_INDEX)}")
    for nome, v, limite in (("palette", palette, 3), ("hflip", hflip, 1),
                            ("vflip", vflip, 1), ("priority", priority, 1)):
        if not 0 <= v <= limite:
            raise ValueError(f"{nome}={v} fora de 0..{limite}")
    return (tile | (hflip << SFT_HFLIP) | (vflip << SFT_VFLIP)
            | (palette << SFT_PALETTE) | (priority << SFT_PRIORITY))


# --- atributos de renderizacao ------------------------------------------------------
def apply_hflip(grade):
    return [list(reversed(r)) for r in grade]


def apply_vflip(grade):
    return [list(r) for r in reversed(grade)]


def is_transparent(indice):
    return indice == INDICE_TRANSPARENTE


# --- CLI ----------------------------------------------------------------------------
def medir_plain(caminho, largura, altura=None):
    with open(caminho, "rb") as f:
        data = f.read()
    doc = {
        "schema_version": SCHEMA_VERSION,
        "gerado_por": "scripts/rex_corpus_b/md-tiles.py",
        "plain": {"caminho": os.path.abspath(caminho), "bytes": len(data),
                  "sha256": hashlib.sha256(data).hexdigest(),
                  "tiles": len(data) // TILE_BYTES},
        "grade_de_tiles": {"largura_tiles": largura, "altura_tiles": altura},
        "layout_confirmado_fontes": "chunky (nibble empacotado, nibble alto = coluna par)",
    }
    doc.update(verdict_layout(data, largura, altura))
    return doc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--plain", required=True, help="arquivo .bin com o plain ja decodificado")
    ap.add_argument("--largura", type=int, required=True, help="largura em tiles")
    ap.add_argument("--altura", type=int, default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    doc = medir_plain(a.plain, a.largura, a.altura)
    saida = json.dumps(doc, ensure_ascii=False, indent=1)
    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with open(a.out, "w") as f:
            f.write(saida + "\n")
    print(saida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
