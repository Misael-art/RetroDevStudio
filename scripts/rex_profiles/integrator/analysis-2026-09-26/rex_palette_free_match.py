"""Casamento padrão por tile (invariante de paleta) entre recursos LZ4W
chunky da ROM congelada e os screenshots 2x da sessão interativa."""
import struct, os
from PIL import Image

ROM = '/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin'
SD = '/mnt/sdcard/Projects/Sgdk Forge/SGDK_projects/HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]'
SHOT = SD + '/out/emulator_evidence/interactive-20260910T195804Z'
rom = open(ROM, 'rb').read()

def lz4w_decode_dict(stream, dictionary):
    out = bytearray(dictionary); dict_len = len(dictionary); ind = 0; adj = 0
    while ind + 2 <= len(stream):
        token = (stream[ind] << 8) | stream[ind + 1]; ind += 2; adj += 1
        lit = (token >> 12) & 0xF; mn = (token >> 8) & 0xF; mb = token & 0xFF
        if token == 0:
            fw = (stream[ind] << 8) | stream[ind + 1]; ind += 2
            if fw & 0x8000:
                out.append(fw & 0xFF)
            return bytes(out[dict_len:])
        out += stream[ind:ind + lit * 2]; ind += lit * 2
        if mn > 0:
            mw = mn + 1; mow = mb + 1
        elif mb > 0:
            v = (stream[ind] << 8) | stream[ind + 1]; ind += 2; adj += 1
            raw = ((-v) & 0x7FFF) + 1
            mow = raw - adj if (v & 0x8000) else raw
            mw = mb + 2
        else:
            mw = 0
        if mw > 0:
            if mow < 1 or mow > len(out) // 2:
                return None
            s = len(out) - mow * 2
            for _ in range(mw):
                out += out[s:s + 2]; s += 2
            adj -= mw
    return None

resources = []
for off in range(0, len(rom) - 8, 2):
    comp, numtile = struct.unpack_from('>HH', rom, off)
    if comp != 2 or not (1 <= numtile <= 96):
        continue
    ptr, = struct.unpack_from('>I', rom, off + 4)
    if not ptr or ptr >= len(rom) or ptr % 2:
        continue
    data = lz4w_decode_dict(rom[ptr:], rom[:ptr])
    if data is not None and len(data) == numtile * 32 and ptr >= 0x88660:
        resources.append((off, numtile, ptr, data))
print('recursos pose (<=96 tiles, cluster):', len(resources))

def normalize_grid(cells):
    """Normaliza uma grade 8x8 de símbolos por primeira aparição."""
    mapping = {}
    out = []
    for v in cells:
        if v not in mapping:
            mapping[v] = len(mapping)
        out.append(mapping[v])
    return tuple(out)

def tile_grids(data, numtile):
    grids = {}
    for t in range(numtile):
        cells = []
        for row in range(8):
            for col in range(8):
                byte = data[t * 32 + row * 4 + col // 2]
                idx = (byte >> 4) if col % 2 == 0 else (byte & 0xF)
                cells.append(idx)
        # apenas tiles com conteúdo e ≤8 cores (reduz falsos positivos)
        distinct = len(set(cells))
        if 1 < distinct <= 8 and sum(1 for c in cells if c != 0) >= 12:
            grids.setdefault(normalize_grid(cells), (t, distinct))
    return grids

lib = {}
for off, numtile, ptr, data in resources:
    for norm, (t, distinct) in tile_grids(data, numtile).items():
        lib.setdefault(norm, []).append((off, ptr, t, numtile))
print('tiles únicos indexados:', len(lib))

def match_screenshot(path, label):
    img = Image.open(path).convert('RGB')
    px = img.load()
    W, H = img.size
    scale1 = 'frame' in path
    hits = {}
    for y_base in (0,):
        if y_base + 224 > H:
            continue
        for gy in range(0, min(224, H) - 8):
            for gx in range(0, min(320, W) - 8):
                cells = []
                for r in range(8):
                    for c in range(8):
                        cells.append(px[gx + c, y_base + gy + r])
                distinct = len(set(cells))
                if not (1 < distinct <= 8):
                    continue
                norm = normalize_grid(cells)
                if norm in lib:
                    for off, ptr, t, numtile in lib[norm]:
                        key = ptr
                        if key not in hits:
                            hits[key] = (gx, gy, t, numtile, label, y_base)
    return hits

total = {}
for shot in ('rex-frame-original-boot.png', 'rex-frame-original-pos-start.png', 'rex-frame-original-ataque-a.png'):
    hits = match_screenshot('/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/src-tauri/target-test/validation/' + shot, shot)
    for ptr, info in hits.items():
        total.setdefault(ptr, []).append(info)
print()
print('=== recursos com tiles encontrados EM TELA ===')
for ptr, infos in sorted(total.items()):
    ex = infos[0]
    print(f'stream@{ptr:#x} tiles={ex[3]}: {len(infos)} tile(s) vistos, ex.: screenshot={ex[4]} pos=({ex[0]},{ex[1]}) tile={ex[2]}')
