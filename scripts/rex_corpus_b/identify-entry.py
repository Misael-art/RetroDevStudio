#!/usr/bin/env python3
"""Identifica uma entrada de corpus Mega Drive de forma reproduzível e
somente-leitura: hashes por região, campos de cabeçalho MD, verificação da
soma de 16 bits nas faixas candidatas e caracterização de cauda excedente.

Por que por região: o arquivo local de Sonic tem 531577 B (512 KiB + 7289 B
de cauda assinada). Um hash único do arquivo inteiro não diz se a área de
programa é a comercial ou se foi patcheada; o hash do prefixo 0..0x80000 diz.

Uso: identify-entry.py ARQUIVO [--zip-membro NOME]
Saída: JSON no stdout.
"""
import argparse, hashlib, json, re, sys, zipfile, zlib

HEADER_FIELDS = [
    ("console_id", 0x100, 16, "ascii"),
    ("copyright", 0x110, 16, "ascii"),
    ("name_domestic", 0x120, 12, "ascii"),
    ("name_usa", 0x130, 16, "ascii"),
    ("name_intl", 0x140, 48, "ascii"),
    ("reserved_170", 0x170, 16, "ascii"),
    ("product_code", 0x180, 14, "ascii"),
    ("io_regions", 0x190, 16, "hex"),
    ("rom_start", 0x1A0, 4, "u32"),
    ("rom_end", 0x1A4, 4, "u32"),
    ("ram_start", 0x1A8, 4, "u32"),
    ("ram_end", 0x1AC, 4, "u32"),
    ("sram_start", 0x1B0, 4, "u32"),
    ("sram_end", 0x1B4, 4, "u32"),
]


def u16(b, o):
    return int.from_bytes(b[o:o + 2], "big")


def u32(b, o):
    return int.from_bytes(b[o:o + 4], "big")


def decode_field(data, off, length, kind):
    raw = data[off:off + length]
    if kind == "ascii":
        return raw.decode("latin1", "replace").rstrip("\x00")
    if kind == "hex":
        return raw.hex(" ")
    return f"0x{u32(data, off):08X}"


def checksum(data, lo, hi, zero_off=0x18E):
    """Soma de palavras de 16 bits em [lo, hi), com o campo da própria soma
    tratado como 0 — convenção MD padrão. hi ímpar é arredondado para baixo."""
    hi = min(hi, len(data))
    if hi % 2:
        hi -= 1
    total = 0
    for off in range(lo, hi, 2):
        total = (total + (0 if off == zero_off else u16(data, off))) & 0xFFFF
    return total


def region_hashes(data, name, lo, hi):
    chunk = data[lo:hi]
    return {
        "region": name,
        "offset": f"0x{lo:06X}",
        "end_exclusive": f"0x{hi:06X}",
        "size": len(chunk),
        "sha256": hashlib.sha256(chunk).hexdigest(),
        "md5": hashlib.md5(chunk).hexdigest(),
        "crc32": f"0x{zlib.crc32(chunk) & 0xFFFFFFFF:08x}",
    }


def signature(data):
    """Primeiro texto ASCII >=4 chars na cauda, com seu offset (assinatura de
    ferramenta, não presunção de origem)."""
    m = re.search(rb"[\x20-\x7e]{4,}", data)
    return None if not m else {"offset": f"0x{m.start():06X}", "text": m.group().decode("latin1")}


def identify(data, rom_bytes=0x80000):
    out = {}
    base = None
    for cand in (0x000, 0x100):
        cid = data[cand + 0x100:cand + 0x110].decode("latin1", "replace")
        if re.match(r"^SEGA (MEGA DRIVE|GENESIS)", cid):
            base = cand
            break
    out["md_header_base"] = None if base is None else f"0x{base:03X}"
    if base is None:
        out["header"] = None
        return out
    hdr = {}
    for name, off, length, kind in HEADER_FIELDS:
        hdr[name] = decode_field(data, base + off, length, kind)
    declared = u16(data, base + 0x18E)
    hdr["declared_checksum"] = f"0x{declared:04X}"
    rom_end = u32(data, base + 0x1A4)
    declared_size = rom_end + 1
    spans = {
        "0x200..0x80000 (512 KiB)": checksum(data, base + 0x200, base + rom_bytes),
        "0x200..rom_end+1": checksum(data, base + 0x200, base + declared_size),
        "0x200..fim-do-arquivo": checksum(data, base + 0x200, len(data)),
    }
    hdr["checksum_computed"] = {k: f"0x{v:04X}" for k, v in spans.items()}
    hdr["checksum_ok_any"] = declared in spans.values()
    out["header"] = hdr
    out["declared_rom_size_from_header"] = declared_size
    out["extra_bytes_past_512KiB"] = max(0, len(data) - rom_bytes)
    if len(data) > rom_bytes:
        tail = data[rom_bytes:]
        out["trailer"] = {
            **region_hashes(data, "cauda além de 0x80000", rom_bytes, len(data)),
            "signature": signature(tail),
            "nonzero_bytes": sum(1 for b in tail if b),
            "distinct_byte_values": len(set(tail)),
        }
    out["regions"] = [
        region_hashes(data, "arquivo inteiro", 0, len(data)),
        region_hashes(data, "área de programa 0..0x80000", 0, min(rom_bytes, len(data))),
    ]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--zip-membro", default=None)
    args = ap.parse_args()

    if zipfile.is_zipfile(args.path):
        with zipfile.ZipFile(args.path) as z:
            members = z.infolist()
            name = args.zip_membro or next(
                (m.filename for m in members if identify(z.read(m), 0x10).get("md_header_base")), None
            )
            if name is None:
                print(json.dumps({"path": args.path, "erro": "nenhum membro com header MD"}))
                return 2
            data = z.read(name)
            container = {"zip": args.path, "membro": name, "membros_no_zip": [m.filename for m in members]}
    else:
        data = open(args.path, "rb").read()
        container = None

    result = {"schema_version": 1, "path": args.path, "container": container}
    result.update(identify(data))
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
