#!/usr/bin/env python3
"""Analisa um arquivo de ROM MD (raw ou traduzido): classifica layout, mostra
campos de cabecalho, valida soma e produz mapa de regioes divergentes quando
comparado a outro arquivo do mesmo jogo. Somente-leitura no corpus."""
import hashlib, json, sys, zipfile, re

def u16(b, o): return int.from_bytes(b[o:o+2], 'big')

def header_info(data):
    out = {}
    for base in (0x000, 0x100):
        if len(data) < base + 0x140:
            continue
        cid = data[base+0x100:base+0x110].decode('latin1', 'replace').strip()
        if re.match(r'^SEGA (MEGA DRIVE|GENESIS)', cid):
            s = 0
            for off in range(base+0x200, len(data)-1, 2):
                w = 0 if off == base+0x18E else u16(data, off)
                s = (s + w) & 0xFFFF
            out = {
                "base": base,
                "console_id": cid,
                "internal_name": data[base+0x120:base+0x13C].decode('latin1','replace').split('\0')[0],
                "checksum_declared": f"0x{u16(data, base+0x18E):04X}",
                "checksum_computed": f"0x{s:04X}",
                "checksum_ok": s == u16(data, base+0x18E),
                "start_vector": hex(u16(data, base+0)),
                "rom_start": hex(u16(data, base+0x38)),
                "size_field": f"{u16(data, base+0x30):08X}",
            }
            break
    return out

def run_regions(a, b, chunk=2):
    """regioes contiguas (em bytes, alinhadas a 2) onde a != b"""
    n = min(len(a), len(b))
    regions, i = [], 0
    while i < n:
        if a[i:i+2] != b[i:i+2]:
            j = i
            while j < n and (a[j:j+2] != b[j:j+2] or (j+2 < n and a[j+2:j+4] != b[j+2:j+4] and a[j:j+2] != b[j:j+2])):
                j += 2
                if j - i > 0x40000:  # trava anti-explosao: fecha regiao grande
                    break
            regions.append((hex(i), hex(j), j - i))
            i = j
        else:
            i += 2
    if len(a) != len(b):
        regions.append(("tamanho", f"{len(a)} vs {len(b)}", abs(len(a)-len(b))))
    return regions

def main():
    raw_path, zip_path = sys.argv[1], sys.argv[2]
    raw = open(raw_path, 'rb').read()
    info_raw = {"path": raw_path, "sha256": hashlib.sha256(raw).hexdigest(),
                "size": len(raw), "layout": header_info(raw),
                "layout_at_0x100_if_any": None}
    inner = None
    with zipfile.ZipFile(zip_path) as z:
        for m in z.infolist():
            d = z.read(m)
            if header_info(d):
                inner = (m.filename, d)
                break
    if inner is None:
        print(json.dumps({"erro": "nenhum membro do zip com header MD"}, ensure_ascii=False))
        return
    name, data = inner
    info_zip = {"member": name, "sha256": hashlib.sha256(data).hexdigest(),
                "size": len(data), "layout": header_info(data)}
    res = {"raw_bin": info_raw, "translated_member": info_zip,
           "same_content": info_raw["sha256"] == info_zip["sha256"]}
    if not res["same_content"] and raw and data:
        res["regions_diferentes"] = run_regions(raw, data)
    print(json.dumps(res, ensure_ascii=False, indent=1))

main()
