"""Simulador fiel do lz4w_unpack 68000 (tools_a.s) + comparação com a
semântica Rust (rex_codecs.rs) sobre os streams do corpus congelado e
sobre o stream produzido pelo encoder Rust."""
import struct, subprocess, glob, os

ROM = '/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin'
rom = open(ROM, 'rb').read()

def u16s(rom, pos):
    return (rom[pos] << 8) | rom[pos + 1]

def unpack_asm(rom, stream_start, dict_start):
    """Simula lz4w_unpack_a com o DESTINO pré-carregado com o bloco anterior
    (contrato da API SGDK: o chamador passa o buffer com o dicionário).
    A1 começa em rom[dict_start..stream_start] (prefixo); matches não-ROM
    endereçam A1; matches ROM-source endereçam A0 (espaço do stream)."""
    prefix = rom[dict_start:stream_start]
    dst = bytearray(prefix)
    dict_len = len(prefix)
    src = stream_start
    n = len(rom)
    while src + 2 <= n:
        b0 = rom[src]; b1 = rom[src + 1]
        src += 2
        lit = (b0 >> 4) & 0xF
        mn = b0 & 0xF
        mb = b1
        # literais: lit words verbatim (2 bytes cada)
        if src + lit * 2 > n:
            return 'ERRO', 'trunc-lit'
        dst += rom[src:src + lit * 2]
        src += lit * 2
        if mn > 0:
            # COPY_MATCH: copia (mn+1) words de A1 - (mb+1)*2
            off_bytes = (mb + 1) * 2
            if off_bytes > len(dst):
                return 'ERRO', f'off-oob dst ({off_bytes} > {len(dst)})'
            a2 = len(dst) - off_bytes
            for _ in range(mn + 1):
                dst += dst[a2:a2 + 2]
                a2 += 2
            continue
        if mb == 0:
            if lit == 0:
                # terminador: word final
                if src + 2 > n:
                    return 'ERRO', 'trunc-final'
                fw = u16s(rom, src); src += 2
                if fw & 0x8000:
                    dst.append(fw & 0xFF)
                elif fw != 0:
                    return 'ERRO', f'word-final inválido {fw:#06x}'
                return bytes(dst)[dict_len:], src
            # mb==0 e lit>0: só literais, sem match (LZ4W_NEXT)
            continue
        # match longo
        if src + 2 > n:
            return 'ERRO', 'trunc-longoff'
        v = u16s(rom, src); src += 2
        mw = mb + 2
        if v & 0x8000:
            # .lm_rom: a2 = (A0-2) + (int16)(v*2) — espaço do STREAM
            signed = struct.unpack('>h', struct.pack('>H', (v * 2) & 0xFFFF))[0]
            a2 = (src - 2) + signed
            if a2 < 0:
                return 'ERRO', f'rom-source antes da ROM ({a2:#x})'
            if a2 + mw * 2 > n:
                return 'ERRO', 'rom-source além da ROM'
            dst += rom[a2:a2 + mw * 2]
        else:
            # não-ROM: a2 = A1 + (int16)(v*2) - 2 — espaço do DESTINO
            signed = struct.unpack('>h', struct.pack('>H', (v * 2) & 0xFFFF))[0]
            a2 = len(dst) + signed - 2
            if a2 < 0 or a2 + mw * 2 > len(dst):
                return 'ERRO', f'off-oob dst longo ({a2}, len {len(dst)})'
            for _ in range(mw):
                dst += dst[a2:a2 + 2]
                a2 += 2
    return 'ERRO', 'stream sem terminador'

def unpack_rust_semantics(stream, dictionary):
    """Espelho da semântica Rust (rex_codecs::lz4w_decode_with_dictionary)."""
    out = bytearray(dictionary); dict_len = len(dictionary); ind = 0; adj = 0
    while ind + 2 <= len(stream):
        token = (stream[ind] << 8) | stream[ind + 1]; ind += 2; adj += 1
        lit = (token >> 12) & 0xF; mn = (token >> 8) & 0xF; mb = token & 0xFF
        if token == 0:
            fw = (stream[ind] << 8) | stream[ind + 1]; ind += 2
            if fw & 0x8000:
                out.append(fw & 0xFF)
            elif fw != 0:
                return None, f'word-final {fw:#x}'
            return bytes(out[dict_len:]), None
        out += stream[ind:ind + lit * 2]; ind += lit * 2
        if mn > 0:
            mw = mn + 1; mow = mb + 1
        elif mb > 0:
            v = (stream[ind] << 8) | stream[ind + 1]; ind += 2; adj += 1
            raw = ((-v) & 0x7FFF) + 1
            if v & 0x8000:
                mow = raw - adj
                if mow < 1 or mow > len(out) // 2:
                    return None, f'rom-src fora ({mow})'
            else:
                mow = raw
                if mow > len(out) // 2:
                    return None, 'off-oob'
            mw = mb + 2
        else:
            mw = 0
        if mw > 0:
            s = len(out) - mow * 2
            for _ in range(mw):
                out += out[s:s + 2]; s += 2
            adj -= mw
    return None, 'sem terminador'

# 1) streams do corpus
headers = []
for off in range(0, len(rom) - 8, 2):
    comp, numtile = struct.unpack_from('>HH', rom, off)
    if comp != 2 or not (1 <= numtile <= 2048):
        continue
    ptr, = struct.unpack_from('>I', rom, off + 4)
    if not ptr or ptr >= len(rom) or ptr % 2:
        continue
    headers.append((off, numtile, ptr))
asm_ok = 0; rust_ok = 0; both_ok = 0; fails = []
for off, numtile, ptr in headers:
    a = unpack_asm(rom, ptr, 0)
    if isinstance(a, tuple) and a[0] == 'ERRO':
        fails.append((hex(ptr), a[1])); continue
    adata, consumed = a
    r, err = unpack_rust_semantics(rom[ptr:], rom[:ptr])
    if r is None:
        fails.append((hex(ptr), 'rust: ' + str(err))); continue
    asm_ok += 1; rust_ok += 1
    if adata == r and len(r) == numtile * 32:
        both_ok += 1
    else:
        fails.append((hex(ptr), f'divergente asm_len={len(adata)} rust_len={len(r)} esperado={numtile*32} primeiro_diff={next((i for i,(x,y) in enumerate(zip(adata,r)) if x!=y), "len")}'))
print(f'corpus: asm_ok={asm_ok} rust_ok={rust_ok} ambos(exato+iguais)={both_ok} de {len(headers)}')
for f in fails[:5]:
    print('  falha:', f)

# 2) stream produzido pelo Rust para 0xc8cc8 (editado): usa a cópia modificada
mods = glob.glob('/home/misael/.retrodev/decomp_work/extract/558bea6c*/edits/rex-lz4w-modified-*.bin')
print('cópias modificadas:', len(mods))
if mods:
    mod_rom = open(sorted(mods)[-1], 'rb').read()
    ptr = 0xc8cc8
    a = unpack_asm(mod_rom, ptr, 0)
    r, err = unpack_rust_semantics(mod_rom[ptr:], mod_rom[:ptr])
    if isinstance(a, tuple) and a[0] == 'ERRO':
        print('mod stream: ERRO asm', a[1])
    else:
        adata, consumed = a
        same = (adata == r)
        print(f'mod stream 0xc8cc8: asm_len={len(adata)} rust_len={len(r) if r else None} iguais={same} consumidos={consumed}')
        print('mod primeiros 8 bytes (asm):', adata[:8].hex(' '))
