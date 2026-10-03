#!/usr/bin/env python3
"""Censo das cadeias TiledImage de uma ROM BYOR: que recurso aPLib existe, quem
aponta para ele, e onde o tile desse recurso aparece na tela.

Existe porque a escolha da edição-alvo não pode ser cópia de anotação. O slot de
reinserção de cada recurso é o tamanho do stream que a toolchain produziu, e o
encoder do produto só re-inseri onde iguala (ou melhora) esse tamanho — medido no
registro de capacidade. Então, antes de propor edição, mede-se daqui:

  1. os TileSets aPLib que o desempacotador fecha em `numTile * 32` (verificados),
     com o stream de cada um;
  2. as posições de 4 bytes na ROM que apontam para cada header, lidas como o
     struct `TiledImage` do SGDK 2.11 empacota (`{u32 palette; u32 tileset;
     u32 tilemap}`);
  3. o TileMap dessa cadeia, desempacotado pelo MESMO instrumento da fixture
     (`token_dump.desmonta`, que data do aceite do decoder do produto), com o
     censo das células que usam cada tile — flip e banco incluídos, porque um
     hflip muda a posição prevista do pixel;
  4. a paleta da cadeia, para confirmar que os dois índices de uma edição de
     pixel são cores diferentes.

O desempacotador importado é o mesmo que produziu os números da fixture; reuso,
não reimplementação — se ele discordar do produto, a divergência aparece como o
plain não bater com o esperado, não como um número silencioso.

A ROM não entra no repositório: o arquivo é local (BYOR) e o script exige o
SHA-256 esperado. Nada aqui é aceite; é medida que produz números.

Uso:
  python3 scripts/rex_profiles/integrator/aplib/survey_tiledimage_refs.py \
      --rom <hamoopig-reference.bin> \
      --pin-sha256 558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9
"""
from __future__ import annotations

import argparse
import hashlib
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from token_dump import desmonta  # noqa: E402  (instrumento do aceite, reusado)

TILEDIMAGE_STRIDE = 12  # {u32 palette; u32 tileset; u32 tilemap}, empacotado
TILE_BYTES = 32  # tile 8x8 4bpp chunky


def u16_be(b: bytes, o: int) -> int:
    return struct.unpack_from(">H", b, o)[0]


def u32_be(b: bytes, o: int) -> int:
    return struct.unpack_from(">I", b, o)[0]


def aplib_stream(rom: bytes, ptr: int, esperado: int | None = None):
    """Desempacota o stream que começa em `ptr`. Devolve (plain, consumido) ou
    (None, motivo). `esperado`, quando dado, é o comprimento do plain que o
    header anuncia — a igualdade é o que verifica o candidato."""
    try:
        tokens, plain = desmonta(rom[ptr:])
    except ValueError as e:
        return None, f"recusado: {e}"
    if not tokens or tokens[-1][0] != "eod":
        return None, "recusado: sem EOD"
    consumido = 1 + sum(t[5] for t in tokens) + sum(t[6] for t in tokens)
    if esperado is not None and len(plain) != esperado:
        return None, f"recusado: plain {len(plain)} B != anunciado {esperado} B"
    return (plain, consumido), "ok"


def tileset_headers(rom: bytes):
    """Headers TileSet do SGDK com compressão aPLib (1) cujo stream fecha no
    comprimento anunciado. Varredura de 2 em 2 bytes: o 68000 endereça par."""
    out = []
    for h in range(0, len(rom) - 8, 2):
        if u16_be(rom, h) != 1:
            continue
        num = u16_be(rom, h + 2)
        data = u32_be(rom, h + 4)
        if not 1 <= num <= 4096 or not 0 < data < len(rom):
            continue
        ver, motivo = aplib_stream(rom, data, esperado=num * TILE_BYTES)
        if ver is None:
            out.append({"header": h, "num_tiles": num, "stream": data, "erro": motivo})
            continue
        plain, consumido = ver
        out.append(
            {
                "header": h,
                "num_tiles": num,
                "stream": data,
                "consumido": consumido,
                "plain": plain,
                "sha_plain": hashlib.sha256(plain).hexdigest(),
            }
        )
    return out


def refs(rom: bytes, alvo: int) -> list[int]:
    agulha = struct.pack(">I", alvo)
    return [i for i in range(len(rom) - 3) if rom[i : i + 4] == agulha]


def tiledimages(rom: bytes, tileset_ptr: int):
    """Todo deslocamento que, lido como `TiledImage`, aponta o tileset em
    `tileset_ptr` e tem paleta e tilemap plausíveis (numColor 1..=512 para o
    Palette empacotado, compressão 0/1 e dimensões dentro do plano)."""
    achados = []
    for pos in refs(rom, tileset_ptr):
        base = pos - 4  # o ponteiro do tileset é o segundo u32 do struct
        if base < 0 or base + TILEDIMAGE_STRIDE > len(rom):
            continue
        pal, tset, tmap = (u32_be(rom, base + 4 * k) for k in range(3))
        if tset != tileset_ptr or not (0 < pal < len(rom) and 0 < tmap < len(rom)):
            continue
        nc = u16_be(rom, pal)
        comp, w, h = u16_be(rom, tmap), u16_be(rom, tmap + 2), u16_be(rom, tmap + 4)
        if not (1 <= nc <= 512 and comp in (0, 1) and 1 <= w <= 128 and 1 <= h <= 64):
            continue
        achados.append(
            {"base": base, "palette": pal, "num_color": nc, "tilemap": tmap, "w": w, "h": h, "comp": comp}
        )
    return achados


def cells_usando(rom: bytes, tmap: int, tile: int):
    """Decodifica o TileMap e lista as células que referenciam `tile`."""
    comp, w, h = u16_be(rom, tmap), u16_be(rom, tmap + 2), u16_be(rom, tmap + 4)
    data = u32_be(rom, tmap + 6)
    esperado = w * h * 2
    if comp == 1:
        ver, motivo = aplib_stream(rom, data, esperado=esperado)
        if ver is None:
            raise SystemExit(f"TileMap {tmap:#x}: {motivo}")
        raw, consumido = ver
    else:
        raw, consumido = rom[data : data + esperado], esperado
    usados = []
    for i in range(w * h):
        e = u16_be(raw, i * 2)
        if (e & 0x7FF) == tile:
            usados.append(
                {
                    "col": i % w,
                    "row": i // w,
                    "hflip": bool(e >> 11 & 1),
                    "vflip": bool(e >> 12 & 1),
                    "banco": e >> 13 & 3,
                    "prio": e >> 15 & 1,
                }
            )
    return {"w": w, "h": h, "consumido": consumido, "tiles_usados": len(set(u16_be(raw, i * 2) & 0x7FF for i in range(w * h))), "usados": usados}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True, type=Path)
    ap.add_argument("--pin-sha256", required=True)
    ap.add_argument("--tile", default="1", help="índice de tile a censar nas tilemaps")
    args = ap.parse_args()

    rom = args.rom.read_bytes()
    sha = hashlib.sha256(rom).hexdigest()
    if sha != args.pin_sha256:
        print(f"ERRO: SHA-256 {sha} != pino {args.pin_sha256}", file=sys.stderr)
        return 2
    print(f"ROM {args.rom.name}: {len(rom)} B, pino confere\n")

    ts = tileset_headers(rom)
    verificados = [t for t in ts if "erro" not in t]
    print(f"=== TileSets com compressão 1: {len(ts)} | verificados: {len(verificados)} ===")
    for t in ts:
        if "erro" in t:
            print(f"  header {t['header']:#x}: {t['erro']}")
    print()
    for t in verificados:
        print(
            f"  header {t['header']:#x}: {t['num_tiles']} tiles | stream {t['stream']:#x} "
            f"{t['consumido']} B | plain {len(t['plain'])} B | sha {t['sha_plain'][:12]}…"
        )

    tile = int(args.tile, 0)
    for t in verificados:
        cadeias = tiledimages(rom, t["header"])
        print(f"\n=== TileSet {t['header']:#x} — {len(cadeias)} TiledImage que o aponta ===")
        for c in cadeias:
            info = cells_usando(rom, c["tilemap"], tile)
            paleta = rom[u32_be(rom, c["palette"] + 2) :][: c["num_color"] * 2]
            palavras = [u16_be(paleta, 2 * i) for i in range(min(tile + 1, len(paleta) // 2))]
            print(
                f"  TiledImage {c['base']:#x}: pal {c['palette']:#x} ({c['num_color']} cores) "
                f"map {c['tilemap']:#x} {c['w']}x{c['h']} comp {c['comp']} "
                f"(stream {info['consumido']} B, {info['tiles_usados']} tiles distintos)"
            )
            print(f"    células com tile {tile}: {len(info['usados'])}")
            for u in info["usados"][:8]:
                x0, y0 = u["col"] * 8, u["row"] * 8
                print(
                    f"      ({u['col']},{u['row']}) rect {x0}..{x0+7}x{y0}..{y0+7} "
                    f"hflip={u['hflip']} vflip={u['vflip']} banco={u['banco']} prio={u['prio']}"
                )
            if len(palavras) > tile:
                print(f"    palavras da paleta[0..{tile}]: " + " ".join(f"{p:#06x}" for p in palavras))
    return 0


if __name__ == "__main__":
    sys.exit(main())
