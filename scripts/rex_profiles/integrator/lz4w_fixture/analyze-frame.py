#!/usr/bin/env python3
"""Diagnóstico offline do framebuffer do fixture LZ4W.

Lê os PPM dumps do cenário rex-lz4w-fixture-effect e ground_truth.json e
responde, sem fórmula de paleta: quantas cores distintas aparecem, quais
índices colidem, e onde (se em algum lugar) o bloco 32x32 esperado casa com a
estrutura de cores observada.
"""
import json
import sys
from collections import Counter


def read_ppm(path):
    data = open(path, "rb").read()
    tokens = []
    i = 0
    while len(tokens) < 4:
        while i < len(data) and data[i:i + 1].isspace():
            i += 1
        if data[i:i + 1] == b"#":
            i = data.find(b"\n", i) + 1
            continue
        j = i
        while j < len(data) and not data[j:j + 1].isspace():
            j += 1
        tokens.append(data[i:j])
        i = j
    i += 1
    width, height, _max = int(tokens[1]), int(tokens[2]), int(tokens[3])
    px = data[i:]
    rows = []
    for y in range(height):
        row = []
        for x in range(width):
            p = (y * width + x) * 3
            row.append((px[p], px[p + 1], px[p + 2]))
        rows.append(row)
    return rows


def block_from(truth, edit=None):
    px = int(truth["tile_px"])
    tiles = int(truth["tile_count"])
    map_w = int(truth["map_w"])
    map_h = int(truth["map_h"])
    rows = truth["tile_pixels"]
    if not isinstance(rows[0], str):
        raise SystemExit("tile_pixels ainda é aninhado; ground_truth desatualizado")
    indices = []
    for t in range(tiles):
        flat = "".join(rows[t * px:(t + 1) * px])
        for ch in flat:
            indices.append(int(ch, 16))
    if edit:
        t, r, c, value = edit
        indices[t * px * px + r * px + c] = value
    w, h = map_w * px, map_h * px
    grid = [[indices[((y // px) * map_w + (x // px)) * px * px + (y % px) * px + (x % px)]
             for x in range(w)] for y in range(h)]
    return grid


def match(rows, ox, oy, grid):
    """index->cor exige que o mesmo índice tenha sempre a mesma cor.

    Cores repetidas entre índices distintos são colisão de DAC: registradas
    (não rejeitadas), porque é exatamente isso que se quer medir.
    """
    index_to_color = {}
    color_to_indices = {}
    for y, row in enumerate(grid):
        for x, index in enumerate(row):
            color = rows[oy + y][ox + x]
            known = index_to_color.get(index)
            if known is not None and known != color:
                return None
            index_to_color[index] = color
            seen = color_to_indices.setdefault(color, set())
            seen.add(index)
    merged = sum(len(s) - 1 for s in color_to_indices.values())
    return index_to_color, merged


def scan(rows, grid):
    h = len(grid)
    w = len(grid[0])
    hits = []
    for oy in range(len(rows) - h + 1):
        for ox in range(len(rows[0]) - w + 1):
            found = match(rows, ox, oy, grid)
            if found:
                hits.append((found[1], ox, oy))
    hits.sort()
    return hits


def dump_origin(rows, grid, ox, oy):
    """O que de fato se vê na origem prevista pelo fonte, índice por índice."""
    per_index = {}
    for y, row in enumerate(grid):
        for x, index in enumerate(row):
            per_index.setdefault(index, Counter())[(rows[oy + y][ox + x])] += 1
    for index in sorted(per_index):
        colors = per_index[index]
        mark = "OK " if len(colors) == 1 else "MISTURA"
        print(f"  índice {index:2d}: {mark} {dict(colors)}")


def main():
    ppm, truth_path = sys.argv[1], sys.argv[2]
    truth = json.load(open(truth_path))
    rows = read_ppm(ppm)
    print(f"frame {len(rows[0])}x{len(rows)}")
    hist = Counter(color for row in rows for color in row)
    print(f"cores distintas no frame: {len(hist)}")
    for color, n in hist.most_common(20):
        print(f"  {color} x{n}")
    grid = block_from(truth)
    if len(sys.argv) > 3:
        ox, oy = (int(v) for v in sys.argv[3:5])
        print(f"varredura da origem prevista ({ox},{oy}):")
        dump_origin(rows, grid, ox, oy)
    hits = scan(rows, grid)
    if not hits:
        print("nenhuma origem compatível com a estrutura de cores esperada")
        return
    best = hits[0][0]
    winners = [hit for hit in hits if hit[0] == best]
    print(f"melhor número de colisões: {best}; janelas com esse score: {len(winners)} -> {winners[:10]}")
    _, ox, oy = winners[0]
    index_to_color, _ = match(rows, ox, oy, grid)
    print(f"origem ({ox},{oy}) índice->cor:")
    for index in sorted(index_to_color):
        print(f"  {index:2d} {index_to_color[index]}")


if __name__ == "__main__":
    main()
