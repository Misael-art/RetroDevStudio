#!/usr/bin/env python3
"""Triage somente-leitura do corpus BYOR para a misses B: ranqueia ROMs por
evidencia ESTRUTURAL de recursos Nemesis/Enigma, sem usar o titulo.

Por que triage separada: o localizador completo (locate-streams.py) decodifica
cada alvo, o que e caro (minutos por ROM). Aqui so se conta quantos alvos de
tabelas de ponteiros passam um filtro de CABECALHO barato; isso ordena
candidatos. A confirmacao (decode + oraculo + encadeamento) fica a cargo do
localizador completo nos poucos selecionados.

Saida: JSON com sha256, header, contagem de corridas, alvos plausiveis por
codec e limitacoes. Corpus nunca e modificado.
Uso: python3 corpus-triage.py > data/rex_corpus_b/recursos/triage.json
"""
import hashlib, importlib.util, json, os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
_sp = importlib.util.spec_from_file_location("locate_streams", os.path.join(HERE, "locate-streams.py"))
LOC = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(LOC)

NEMESIS = importlib.import_module("nemesis_research")
ENIGMA = importlib.import_module("enigma_research")
DIRS = ["/home/misael/emulation/roms/genesis", "/home/misael/emulation/roms/megadrive",
        "/home/misael/emulation/roms/megadrivejp"]
MIN_RUN = 4


def header_plausible_nemesis(data, target):
    blob = data[target:target + 0x100]
    if len(blob) < 4:
        return None
    try:
        hdr = NEMESIS.parse_header(blob, 0, work_limit=1 << 16, strict=True)
    except NEMESIS.NemesisError:
        return None
    if not (LOC.MIN_TILES <= hdr.rtiles <= LOC.MAX_TILES) or hdr.declared_out > LOC.MAX_ART_BYTES:
        return None
    return {"codec": "nemesis", "variant": NEMESIS.variant_name(hdr.mode_bit),
            "rtiles": hdr.rtiles, "declared_out": hdr.declared_out,
            "header_bytes": hdr.header_end - target if hdr.header_end >= target else hdr.header_end}


def header_plausible_enigma(data, target):
    blob = data[target:target + 6]
    if len(blob) < 6:
        return None
    pl, mask = blob[0], blob[1]
    lo, hi = ENIGMA.PACKET_LENGTH_DOMAIN
    if not (lo <= pl <= hi) or mask > 0x1F:
        return None
    return {"codec": "enigma", "header_hex": blob.hex(), "packet_length": pl, "mask": mask}


def triage_rom(data):
    base = LOC.md_header_base(data)
    if base is None:
        return None
    declared_end = LOC.u32(data, base + 0x1A4)
    prog_hi = min(declared_end + 1, len(data))
    runs = LOC.pointer_runs(data, 0x2000, prog_hi, MIN_RUN)
    alvos, vistos = [], set()
    for run in runs:
        for _, v in run:
            if v in vistos:
                continue
            vistos.add(v)
            hn = header_plausible_nemesis(data, v)
            he = header_plausible_enigma(data, v)
            if hn:
                hn["alvo"] = hex(v)
                alvos.append(hn)
            elif he:
                he["alvo"] = hex(v)
                alvos.append(he)
    from collections import Counter
    c = Counter(a["codec"] for a in alvos)
    return {
        "header_base": base,
        "internal_name": data[base + 0x120:base + 0x12C].decode("latin1", "replace").split("\0")[0].strip(),
        "product_code": data[base + 0x180:base + 0x180 + 14].decode("latin1", "replace").strip("\x00"),
        "declared_checksum": f"0x{LOC.u16(data, base + 0x18E):04X}",
        "computed_checksum": f"0x{LOC.checksum(data, base, 0x200, len(data) - base):04X}",
        "declared_rom_end": hex(declared_end),
        "file_size": len(data),
        "corridas_de_ponteiros": len(runs),
        "alvos_distintos": len(vistos),
        "plausiveis_nemesis_header": c.get("nemesis", 0),
        "plausiveis_enigma_header": c.get("enigma", 0),
        "plausiveis_por_mil_alvos": round(1000 * len(alvos) / max(1, len(vistos)), 1),
        "detalhe_limite": [a.get("alvo") for a in alvos[:40]],
    }


def main():
    out = []
    dirs = sys.argv[1:] or DIRS
    for d in dirs:
        if not os.path.exists(d):
            sys.stderr.write(f"caminho ausente: {d}\n")
            continue
        if os.path.isfile(d):
            iterator = [(os.path.dirname(d) or ".", None, [os.path.basename(d)])]
        else:
            iterator = list(os.walk(d))
        for root, _, files in iterator:
            for fn in sorted(files):
                p = os.path.join(root, fn)
                low = fn.lower()
                try:
                    if low.endswith(".zip"):
                        with zipfile.ZipFile(p) as z:
                            for n in [m for m in z.namelist() if not m.endswith("/")]:
                                data = z.read(n)
                                t = triage_rom(data)
                                if t:
                                    t.update({"arquivo": p, "membro": n,
                                              "arquivo_sha256": hashlib.sha256(data).hexdigest()})
                                    out.append(t)
                    elif low.endswith((".bin", ".gen", ".md", ".smd")):
                        data = open(p, "rb").read()
                        t = triage_rom(data)
                        if t:
                            t.update({"arquivo": p, "membro": None,
                                      "arquivo_sha256": hashlib.sha256(data).hexdigest()})
                            out.append(t)
                except Exception as e:  # noqa: BLE001 - triagem: registra e segue
                    out.append({"arquivo": p, "erro": f"{type(e).__name__}: {e}"[:160]})
                sys.stderr.write(".")
    sys.stderr.write("\n")
    out.sort(key=lambda r: -(r.get("plausiveis_nemesis_header", 0) + r.get("plausiveis_enigma_header", 0)))
    print(json.dumps({"schema_version": 1,
                      "gerado_por": "scripts/rex_corpus_b/corpus-triage.py",
                      "metodo": "corridas de >=%d ponteiros BE crescentes e alinhados; filtro de cabecalho barato (sem decode)" % MIN_RUN,
                      "limitacoes": ["filtro de cabecalho NAO confirma recurso: decodificacao + encadeamento + oraculo ficam com locate-streams.py",
                                     "contagem relativa serve para ordenar candidatos, nao para afirmar presenca de codec em uma ROM especifica"],
                      "entradas": out}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
