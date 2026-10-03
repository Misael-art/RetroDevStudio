#!/usr/bin/env python3
"""Valida o fixture de contexto aPLib SEM usar o decoder nem o renderer do produto.

Três pernas, todas a partir do ROM compilado:

1. decode  — os streams aPLib encontrados na ROM são decodificados pelo
   ``apj.jar`` do SDK pinado (ferramenta externa, ``APJ.unpack`` cru, sem header
   nem checksum; é o par de ``Util.appack`` -> ``APJ.pack(data, false, true)``
   que o rescomp usa). A saída é comparada byte a byte com o esperado escrito
   ANTES da compilação em ``ground_truth.json``.
2. render  — a camada composta é reconstruída a partir DOS BYTES DECODIFICADOS
   (tileset chunky 4bpp + células do mapa + palavras de paleta) por um renderer
   de ~40 linhas escrito contra a especificação pública do VDP, e comparada
   pixel a pixel com ``expected/composed_layer.png``.
3. impacto — aplica a edição canônica (tile 2, linha 4, coluna 7: 0xB -> 0x3)
   aos bytes decodificados e exige que exatamente as 4 posições de tela previstas
   mudem, e nada mais.

Uso: verify-external.py <dir-do-fixture>   (o mesmo --out de build-fixture.sh)

Independência declarada: nenhuma destas pernas chama código de
``src-tauri/``. O esperado nasce de constantes de autoria; a evidência nasce do
artefato. Se as duas divergirem, o fixture é que está errado.
"""

import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import zlib

# SHA-256 registrado do apj.jar v1.32 do SGDK 2.11 (mesmo pino do trabalho de
# paridade de oráculos em scripts/rex_profiles/integrator/aplib/).
APJ_SHA256 = "2d8cdc63cc800e4b86ff4d9cdfe514001b77f788abcd02d61974dc319d026204"


def sha(d):
    return hashlib.sha256(d).hexdigest()


def fail(msg):
    sys.stderr.write("FALHA: %s\n" % msg)
    sys.exit(1)


# --------------------------------------------------------------- decode -----
def apj_unpack(apj_jar, stream, tmpdir):
    """Decodifica um stream aPLib cru com a ferramenta externa (sem o produto)."""
    src = os.path.join(tmpdir, "in.ap")
    dst = os.path.join(tmpdir, "out.bin")
    with open(src, "wb") as fh:
        fh.write(stream)
    r = subprocess.run(["java", "-jar", apj_jar, "u", src, dst, "s"],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        fail("apj.jar u falhou (rc=%d): %s %s" % (r.returncode, r.stdout, r.stderr))
    with open(dst, "rb") as fh:
        return fh.read()


def apj_pack(apj_jar, plain, tmpdir, ultra=False):
    """Recomprime com a mesma ferramenta externa: o stream na ROM deve ser
    reproduzível byte a byte a partir do plain esperado (perna de round-trip)."""
    src = os.path.join(tmpdir, "in.bin")
    dst = os.path.join(tmpdir, "out.ap")
    with open(src, "wb") as fh:
        fh.write(plain)
    r = subprocess.run(["java", "-jar", apj_jar, "pp" if ultra else "p", src, dst, "s"],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        fail("apj.jar p falhou (rc=%d): %s %s" % (r.returncode, r.stdout, r.stderr))
    with open(dst, "rb") as fh:
        return fh.read()


# ------------------------------------------------- renderer independente ----
def md_para_rgb8(md):
    return int(round(md * 255 / 7))


def cram_para_rgb(word):
    """Palavra CRAM 68k ``xxxBBBxGGGxRRRx`` -> RGB888."""
    return (md_para_rgb8((word >> 1) & 7), md_para_rgb8((word >> 5) & 7),
            md_para_rgb8((word >> 9) & 7))


def tile_pixel(chunky, tile_ind, r, c):
    """4bpp planar-na-linearidade-do-byte: byte = tile*32 + linha*4 + col/2,
    nibble ALTO = coluna par (ImageUtil.convert8bppTo4bpp)."""
    b = chunky[tile_ind * 32 + r * 4 + (c >> 1)]
    return (b >> 4) if (c & 1) == 0 else (b & 0xF)


def render(camada, cells, words_por_banco, backdrop):
    """cells: lista linha-a-linha de (index, flipH, flipV, banco, prio)."""
    px = []
    for j in range(camada["rows"]):
        for r in range(8):
            linha = []
            for i in range(camada["cols"]):
                index, fh, fv, bank, _prio = cells[j * camada["cols"] + i]
                for c in range(8):
                    rs = 7 - r if fv else r
                    cs = 7 - c if fh else c
                    idx = tile_pixel(camada["tileset"], index, rs, cs)
                    linha.append(backdrop if idx == 0 else words_por_banco[bank][idx])
            px.append(linha)
    return px


def cells_from_stream(map_plain, cols, rows):
    out = []
    for k in range(cols * rows):
        w = struct.unpack_from(">H", map_plain, k * 2)[0]
        out.append((w & 0x7FF, (w >> 11) & 1, (w >> 12) & 1, (w >> 13) & 3, (w >> 15) & 1))
    return out


def png_rgb_pixels(path):
    """Leitor PNG mínimo (8bpp RGB, não entrelaçado, sem trns) do esperado."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        fail("expected/composed_layer.png não é PNG")
    pos, idat, w, h, ctype, bitdepth = 8, b"", None, None, None, None
    while pos < len(data):
        ln = struct.unpack_from(">I", data, pos)[0]
        tag = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + ln]
        if tag == b"IHDR":
            w, h, bitdepth, ctype = struct.unpack(">IIBB", payload[:10])
        elif tag == b"IDAT":
            idat += payload
        elif tag == b"IEND":
            break
        pos += 12 + ln
    if (bitdepth, ctype) != (8, 2):
        fail("esperado PNG 8bpp RGB truecolor, obtido bitdepth=%s colorType=%s"
             % (bitdepth, ctype))
    raw = zlib.decompress(idat)
    stride = w * 3
    prev = bytearray(stride)
    linhas, off = [], 0
    for _ in range(h):
        ftype = raw[off]
        line = bytearray(raw[off + 1:off + 1 + stride])
        off += 1 + stride
        if ftype == 0:
            pass
        elif ftype == 1:
            for x in range(3, stride):
                line[x] = (line[x] + line[x - 3]) & 0xFF
        elif ftype == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif ftype == 3:
            for x in range(stride):
                a = line[x - 3] if x >= 3 else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif ftype == 4:
            for x in range(stride):
                a = line[x - 3] if x >= 3 else 0
                b = prev[x]
                c = prev[x - 3] if x >= 3 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        else:
            fail("filtro PNG %d não suportado" % ftype)
        linhas.append([(line[3 * k], line[3 * k + 1], line[3 * k + 2])
                       for k in range(w)])
        prev = line
    return w, h, linhas


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("uso: verify-external.py <dir-do-fixture>\n")
        return 2
    out_dir = sys.argv[1]
    report = json.load(open(os.path.join(out_dir, "fixture-build-report.json")))
    truth = report["ground_truth"]
    rom = open(report["rom_path"], "rb").read()
    sdk = report["sgdk_root"]
    apj = os.path.join(sdk, "bin", "apj.jar")
    with open(apj, "rb") as fh:
        real = sha(fh.read())
    if real != APJ_SHA256:
        fail("apj.jar diverge do pino registrado (%s != %s)" % (real[:12], APJ_SHA256[:12]))

    checks = []

    def confere(nome, ok, detalhe):
        checks.append({"check": nome, "ok": bool(ok), "detalhe": detalhe})
        if not ok:
            fail("%s: %s" % (nome, detalhe))

    ts_off = report["resources"]["tileset_aplib"]["stream_offset"]
    tm_off = report["resources"]["tilemap_ctx_map_aplib"]["stream_offset"]
    gh_off = report["resources"]["tilemap_ctx_ghost_aplib"]["stream_offset"]
    pal_off = report["resources"]["palette"]["stream_offset"]

    with tempfile.TemporaryDirectory() as tmp:
        dec = {
            "tileset": apj_unpack(apj, rom[ts_off:], tmp),
            "map": apj_unpack(apj, rom[tm_off:], tmp),
            "ghost": apj_unpack(apj, rom[gh_off:], tmp),
        }

    # 1) decode externo == esperado pré-compilação, byte a byte
    for chave, recurso in (("tileset", "tileset"), ("map", "map"), ("ghost", "ghost")):
        esperado = bytes.fromhex(truth[recurso]["plain_hex"])
        obtido = dec[chave]
        confere("decode-apj-%s" % chave,
                len(obtido) == len(esperado) and obtido == esperado,
                "len=%d esperado=%d sha=%s esperado=%s"
                % (len(obtido), len(esperado), sha(obtido)[:16],
                   truth[recurso]["plain_sha256"][:16]))

    # paleta não é comprimida pelo rescomp: são palavras diretas na ROM
    palavras = list(struct.unpack_from(">%dH" % truth["palette"]["num_color"], rom, pal_off))
    confere("paleta-na-rom", palavras == truth["palette"]["words"],
            "primeiras 4 = %s vs %s" % ([hex(w) for w in palavras[:4]],
                                        [hex(w) for w in truth["palette"]["words"][:4]]))

    # 1b) round-trip pelo mesmo oráculo externo: o empacotador deve reproduzir
    # byte a byte o stream que está no artefato.
    tamanhos = {}
    with tempfile.TemporaryDirectory() as tmp:
        for chave, recurso, offset in (("tileset", "tileset", ts_off),
                                       ("map", "map", tm_off),
                                       ("ghost", "ghost", gh_off)):
            esperado = bytes.fromhex(truth[recurso]["plain_hex"])
            packed = apj_pack(apj, esperado, tmp)
            na_rom = rom[offset:offset + len(packed)]
            tamanhos[chave] = {"plain": len(esperado), "aplib": len(packed)}
            confere("roundtrip-apj-%s" % chave, packed == na_rom,
                    "externo %d B vs ROM %d B no offset %d" % (len(packed), len(na_rom), offset))

    # 2) camada composta reconstruída a partir dos bytes decodificados
    cols, rows = truth["map"]["cols"], truth["map"]["rows"]
    cells = cells_from_stream(dec["map"], cols, rows)
    banks = [palavras[b * 16:b * 16 + 16] for b in range(truth["palette"]["banks"])]
    cores = [[cram_para_rgb(w) for w in banco] for banco in banks]
    camada = {"tileset": dec["tileset"], "cols": cols, "rows": rows}
    render_px = render(camada, cells, cores, cram_para_rgb(palavras[0]))
    pw, ph, esperado_px = png_rgb_pixels(os.path.join(out_dir, "project", "expected",
                                                      "composed_layer.png"))
    confere("render-vs-esperado",
            (pw, ph) == (cols * 8, rows * 8) and render_px == esperado_px,
            "dim %dx%d vs %dx%d" % (pw, ph, cols * 8, rows * 8))
    render_flat = b"".join(struct.pack(">BBB", *p) for lin in render_px for p in lin)
    confere("render-sha256", sha(render_flat) == truth["composed_layer"]["pixels_sha256"],
            "%s vs %s" % (sha(render_flat)[:16],
                          truth["composed_layer"]["pixels_sha256"][:16]))

    # as células decodificadas do ROM batem com a tabela de células do esperado?
    tabela = truth["map"]["cells_table"]
    palavras_got = list(struct.unpack(">%dH" % (cols * rows), dec["map"]))
    dif = [(k // cols, k % cols, hex(palavras_got[k]), hex(tabela[k]["word"]))
           for k in range(cols * rows) if palavras_got[k] != tabela[k]["word"]]
    confere("celulas-vs-tabela", not dif,
            "%d célula(s) divergente(s) (col,linha,ROM,esperado): %s" % (len(dif), dif[:4]))

    # 3) impacto da edição canônica, previsto antes da compilação
    ed = truth["edicao_canonica"]["pixel_fonte"]
    alvo_t, ar, ac = ed["tile"], ed["row"], ed["col"]
    tile_bytes = bytearray(dec["tileset"])
    pos = alvo_t * 32 + ar * 4 + (ac >> 1)
    atual = (tile_bytes[pos] >> 4) if (ac & 1) == 0 else (tile_bytes[pos] & 0xF)
    confere("pixel-fonte-na-rom", atual == ed["de"], "na ROM = 0x%X, esperado 0x%X"
            % (atual, ed["de"]))

    antes = render_px
    if ac & 1:
        tile_bytes[pos] = (tile_bytes[pos] & 0xF0) | ed["para"]
    else:
        tile_bytes[pos] = (tile_bytes[pos] & 0x0F) | (ed["para"] << 4)
    depois = render({"tileset": bytes(tile_bytes), "cols": cols, "rows": rows},
                    cells, cores, cram_para_rgb(palavras[0]))

    mudados = [(x, y) for y in range(rows * 8) for x in range(cols * 8)
               if antes[y][x] != depois[y][x]]
    # mesma ordem de varredura do render: linha antes de coluna
    previstas = sorted(((p["x"], p["y"])
                        for p in truth["edicao_canonica"]["posicoes_de_tela_previstas"]),
                       key=lambda xy: (xy[1], xy[0]))
    confere("impacto-da-edicao", mudados == previstas,
            "mudaram %s; previsto %s" % (mudados, previstas))
    for p in truth["edicao_canonica"]["posicoes_de_tela_previstas"]:
        x, y = p["x"], p["y"]
        banco = p["bank"]
        confere("cor-prevista-em-%d-%d" % (x, y),
                depois[y][x] == cores[banco][ed["para"]]
                and antes[y][x] == cores[banco][ed["de"]],
                "antes=%s depois=%s esperado=%s" % (antes[y][x], depois[y][x],
                                                    cores[banco][ed["para"]]))

    # o mapa-ghost deve realmente conter referência fora do tileset descoberto
    ghost_cells = cells_from_stream(dec["ghost"], truth["ghost"]["cols"], truth["ghost"]["rows"])
    num_tile = truth["tileset"]["num_tile"]
    fora_rom = sorted({c[0] for c in ghost_cells if c[0] >= num_tile})
    fora_esperado = sorted({c["tile"] for c in truth["ghost"]["cells_table"]
                            if c["tile"] >= num_tile})
    confere("ghost-fora-do-tileset", fora_rom == fora_esperado and bool(fora_rom),
            "ROM %s vs esperado %s (numTile=%d)" % (fora_rom, fora_esperado, num_tile))
    sistemas = sorted({c[0] for c in ghost_cells if c[0] < num_tile})
    confere("ghost-tile-de-sistema", sistemas == [0, 5],
            "índices abaixo de numTile no mapa de base 100: %s" % sistemas)

    resultado = {
        "schema": "rex-context-aplib-external-verify/v1",
        "oracle": {"tool": "apj.jar (SGDK 2.11, APJ.unpack cru)", "path": apj,
                   "sha256": real},
        "rom_sha256": report["rom_sha256"],
        "decoded_sizes": {k: len(v) for k, v in dec.items()},
        "decoded_sha256": {k: sha(v) for k, v in dec.items()},
        "stream_sizes": tamanhos,
        "render_pixels_sha256": sha(render_flat),
        "edicao": {"pixel_fonte": ed, "posicoes_mudadas": mudados},
        "ghost": {"fora_do_tileset": len(fora_rom), "tiles_de_sistema": sistemas},
        "independente_do_produto": True,
        "checks": checks,
    }
    with open(os.path.join(out_dir, "external-verify.json"), "w") as fh:
        json.dump(resultado, fh, indent=2)
    print(json.dumps({"ok": True, "checks": len(checks),
                      "rom_sha256": report["rom_sha256"],
                      "decoded_sizes": resultado["decoded_sizes"],
                      "posicoes_mudadas": mudados}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
