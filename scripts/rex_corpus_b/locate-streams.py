#!/usr/bin/env python3
"""Localiza recursos REAIS Nemesis/Enigma em ROMs Mega Drive por ancora
estrutural: as PROPRIAS tabelas de ponteiros do jogo.

Por que nao varredura cega de offsets: o contrato da misses proibe atribuir
codec por varrer todos os offsets com todos os codecs (falsos positivos em
dados aleatorios sao inevitaveis). Aqui o candidato precisa (1) pertencer a
uma corrida de >=4 ponteiros BE-validos contiguos, i.e. uma tabela que o
proprio jogo mantem, e (2) o alvo precisa decodificar com header estrito e
tamanho de saida plausivel de arte. A ancora (1) e a evidencia de consumidor.

Somente-leitura no corpus: nunca escreve fora de --out.
Uso:
  python3 locate-streams.py --rom ROM.bin [--out data/.../recursos/x.json]
  python3 locate-streams.py --rom X.zip [--membro nome]
"""
import argparse, hashlib, importlib.util, json, os, resource, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
nemesis = importlib.import_module("nemesis_research")
enigma = importlib.import_module("enigma_research")

ORACLE_BIN = {
    "nemesis": os.path.expanduser("~/.cache/rex-codecs/oracle-tools/bin/nemcmp"),
    "enigma": os.path.expanduser("~/.cache/rex-codecs/oracle-tools/bin/enicmp"),
}
# pin do oraculo Enigma ja verificado nesta frente; o do Nemesis e registrado
# por extenso na evidencia e conferido contra docs/rex_corpus_b/reference.
ORACLE_PIN = {
    "enigma": "a017430c0a7adadf051d754ed30dfded2ddd875a939a9a047e3f375da5c96d18",
}

TILE_BYTES = 32
MAX_WINDOW = 0x20000          # janela maxima lida a partir de um alvo
MAX_ART_BYTES = 0x20000       # saida maxima plausivel de um chunk de arte
MIN_TILES, MAX_TILES = 4, 4096
DECODER_WORK = 1 << 22


def sha(b):
    return hashlib.sha256(b).hexdigest()


def u16(b, o):
    return int.from_bytes(b[o:o + 2], "big")


def u32(b, o):
    return int.from_bytes(b[o:o + 4], "big")


def load_rom(path, member=None):
    """Le ROM sem nunca modifica-la. Retorna (bytes, origem)."""
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            names = [m for m in z.namelist() if not m.endswith("/")]
            if member:
                names = [n for n in names if n == member]
                if not names:
                    raise SystemExit(f"membro {member} ausente")
            for n in names:
                data = z.read(n)
                if md_header_base(data) is not None:
                    return data, {"arquivo": path, "membro": n, "zip": True}
            raise SystemExit("nenhum membro com header MD")
    return open(path, "rb").read(), {"arquivo": path, "membro": None, "zip": False}


def md_header_base(data):
    for base in (0x000, 0x100):
        if len(data) >= base + 0x140:
            cid = data[base + 0x100:base + 0x110].decode("latin1", "replace").strip()
            if cid.startswith("SEGA MEGA DRIVE") or cid.startswith("SEGA GENESIS"):
                return base
    return None


def checksum(data, base, lo, hi, zero_off=0x18E):
    s = 0
    for off in range(base + lo, min(base + hi, len(data) - 1), 2):
        w = 0 if off == base + zero_off else u16(data, off)
        s = (s + w) & 0xFFFF
    return s


def oracle_decode(codec, blob):
    """Decodifica na referencia externa dentro de sandbox (limites + timeout)."""
    exe = ORACLE_BIN[codec]
    if not os.path.exists(exe):
        return None, "oraculo-ausente"

    def limits():
        resource.setrlimit(resource.RLIMIT_AS, (2 << 30, 2 << 30))
        resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32 << 20, 32 << 20))

    d = tempfile.mkdtemp(prefix="loc-")
    src, dst = os.path.join(d, "in"), os.path.join(d, "out")
    open(src, "wb").write(blob)
    try:
        p = subprocess.run([exe, "-x", src, dst], stdin=subprocess.DEVNULL,
                           capture_output=True, timeout=30, preexec_fn=limits)
    except subprocess.TimeoutExpired:
        return None, "oraculo-timeout"
    out = open(dst, "rb").read() if os.path.exists(dst) else None
    for f in (src, dst):
        if os.path.exists(f):
            os.remove(f)
    os.rmdir(d)
    if p.returncode != 0 or out is None:
        return None, f"oraculo-rc={p.returncode}"
    return out, None


def try_nemesis(data, target, limit=MAX_WINDOW):
    """Valida e decodifica um candidato Nemesis. None se nao for."""
    blob = data[target:target + limit]
    if len(blob) < 4:
        return None
    try:
        hdr = nemesis.parse_header(blob, 0, work_limit=DECODER_WORK, strict=True)
    except nemesis.NemesisError as e:
        return None, f"header:{e.code}"
    if not (MIN_TILES <= hdr.rtiles <= MAX_TILES) or hdr.declared_out > MAX_ART_BYTES:
        return None, f"dominio-tiles={hdr.rtiles}"
    st = {}
    try:
        res = nemesis.decode(blob, max_out=MAX_ART_BYTES, work_limit=DECODER_WORK, stats=st)
    except nemesis.NemesisError as e:
        return None, f"decode:{e.code}"
    return {"codec": "nemesis", "variant": nemesis.variant_name(hdr.mode_bit),
            "rtiles": hdr.rtiles, "declared_out": hdr.declared_out,
            "header_bytes": hdr.header_end, "table_records": hdr.table_records,
            "bytes_consumed": res.bytes_consumed, "output_size": len(res.data),
            "span_palavra": res.bytes_consumed + (res.bytes_consumed % 2),
            "output_sha256": sha(res.data), "work_units": st.get("work_units")}


def try_enigma(data, target, limit=MAX_WINDOW):
    blob = data[target:target + limit]
    if len(blob) < enigma.HEADER_LEN + 2:
        return None
    st = {}
    try:
        out, consumed = enigma.decode(blob, max_out=MAX_ART_BYTES,
                                      work_limit=DECODER_WORK, stats=st)
    except enigma.CodecError as e:
        return None, f"decode:{e.code}"
    if len(out) < 64 or consumed < enigma.HEADER_LEN:
        return None, "saida-implausivel"
    return {"codec": "enigma", "variant": "enigma-plain", "output_size": len(out),
            "bytes_consumed": consumed, "span_palavra": consumed + (consumed % 2),
            "output_sha256": sha(out),
            "header_hex": blob[:6].hex(), "stats": st or None}


def pointer_runs(data, prog_lo, prog_hi, min_run=4):
    """Corridas de ponteiros BE verossimeis na area de programa.

    Um ponteiro vale se aponta para dentro da area de programa, e alinhado a
    2 e nao decrescente em relacao ao anterior da mesma corrida (tabelas de
    recursos do 68k listam alvos em ordem). A exigncia de monotonicidade e
    uma HIPTESE estrutural registrada, no uma lei do formato: corridas que
    so passam sem ela continuam visiveis no diagnostico.
    """
    runs = []
    o, prev, cur = prog_lo, None, []
    for o in range(prog_lo, prog_hi - 3, 4):
        v = u32(data, o)
        # alvo deve estar na area de programa, alinhado a 2 e SER maior que o
        # anterior da corrida: repeticao/queda e sinal de preenchimento ou
        # codigo, nao de tabela de recursos.
        ok = prog_lo <= v < prog_hi and v % 2 == 0
        if ok and cur and prev is not None and v <= prev:
            ok = False
        if ok:
            cur.append((o, v))
            prev = v
        else:
            if len(cur) >= min_run:
                runs.append(cur)
            cur, prev = [], None
    if len(cur) >= min_run:
        runs.append(cur)
    return runs


def locate(data, origin, min_run=4, max_runs=4000, top_decode_checks=4000):
    base = md_header_base(data)
    # campo de 32 bits em 0x1A4 (medido: Addams=0x000FFFFF p/ 1 MiB,
    # Aladdin=0x001FFFFF p/ 2 MiB). Fim declarado = valor + 1.
    declared_end = u32(data, base + 0x1A4) if len(data) > base + 0x1A7 else len(data) - 1
    prog_hi = min(declared_end + 1, len(data))
    prog_lo = 0x2000
    info = {
        "header_base": base,
        # campo medido: nome domestic @0x120 com 12 bytes (0x12C inicia o USA)
        "internal_name": data[base + 0x120:base + 0x12C].decode("latin1", "replace").split("\0")[0].strip(),
        "product_code": data[base + 0x180:base + 0x180 + 14].decode("latin1", "replace").strip("\x00"),
        "declared_checksum": f"0x{u16(data, base + 0x18E):04X}",
        "computed_checksum_full": f"0x{checksum(data, base, 0x200, len(data) - base):04X}",
        "computed_checksum_declared_range":
            f"0x{checksum(data, base, 0x200, prog_hi - base):04X}",
        "declared_rom_end_from_header": hex(u32(data, base + 0x1A4)),
        "file_size": len(data),
        "_programa_sha256": sha(data[:prog_hi]),
        "programa_fim": hex(prog_hi),
    }
    runs = pointer_runs(data, prog_lo, prog_hi, min_run)
    resources, checked = [], 0
    for run in runs[:max_runs]:
        hits = []
        for toff, tval in run:
            if checked >= top_decode_checks:
                break
            checked += 1
            r = try_nemesis(data, tval)
            if isinstance(r, dict):  # noqa: PLR0911
                r["ponteiro_offset"] = toff
                r["ponteiro_valor"] = hex(tval)
                hits.append(r)
                continue
            r2 = try_enigma(data, tval)
            if isinstance(r2, dict):
                r2["ponteiro_offset"] = toff
                r2["ponteiro_valor"] = hex(tval)
                if isinstance(r2.get("stats"), dict):
                    r2["stats"] = None
                hits.append(r2)
        if hits:
            # Encadeamento: alvo[i] + span[i] == alvo[i+1]. E a evidencia mais
            # forte disponivel sem disasembling: a propria tabela do jogo fatia
            # a regiao em streams contiguas, entao o span consumido tem que
            # bater com o proximo ponteiro. Coincidencia nao encadeia.
            hits.sort(key=lambda r: int(r["ponteiro_valor"], 16))
            elinks, eexatos, eword = [], 0, 0
            for a, b in zip(hits, hits[1:]):
                ta, tb = int(a["ponteiro_valor"], 16), int(b["ponteiro_valor"], 16)
                if ta + a["bytes_consumed"] == tb:
                    eexatos += 1
                elif ta + a.get("span_palavra", a["bytes_consumed"]) == tb:
                    eword += 1
            terminator = u32(data, run[-1][0] + 4) == 0xFFFFFFFF if run[-1][0] + 8 <= len(data) else False
            resources.append({
                "tabela_offset": hex(run[0][0]),
                "tabela_entradas": len(run),
                "tabela_terminador_FFFFFFFF": terminator,
                "alvos_validados": len(hits),
                "fracao": round(len(hits) / len(run), 3),
                "elinks_encadeados": eexatos + eword,
                "elinks_por_byte": eexatos,
                "elinks_por_palavra": eword,
                "elinks_possiveis": len(hits) - 1,
                "confianca": ("alta" if len(hits) >= 3 and (eexatos + eword) == len(hits) - 1
                              else "media" if hits else "baixa"),
                "recursos": hits,
            })
    return info, runs, resources, {"corridas_analisadas": min(len(runs), max_runs),
                                   "alvos_decodificados": checked,
                                   "min_run": min_run}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--membro")
    ap.add_argument("--out")
    ap.add_argument("--min-run", type=int, default=4)
    ap.add_argument("--confirmar", type=int, default=12,
                    help="max de recursos confirmados pelo oraculo externo")
    args = ap.parse_args()

    data, origin = load_rom(args.rom, args.membro)
    info, runs, resources, probe = locate(data, origin, min_run=args.min_run)
    origin["sha256_arquivo"] = sha(data)
    origin["crc32_arquivo"] = f"0x{__import__('zlib').crc32(data) & 0xFFFFFFFF:08X}"

    conf = 0
    for tbl in resources:
        for r in tbl["recursos"]:
            if conf >= args.confirmar:
                r["confirmacao_externa"] = "nao-executada (limite do run)"
                continue
            blob = data[int(r["ponteiro_valor"], 16):
                        int(r["ponteiro_valor"], 16) + r["bytes_consumed"]]
            out, err = oracle_decode(r["codec"], blob)
            conf += 1
            if out is None:
                r["confirmacao_externa"] = {"status": "recusado", "motivo": err,
                                            "span_lido": len(blob)}
            else:
                r["confirmacao_externa"] = {
                    "status": ("byte-identico" if sha(out) == r["output_sha256"]
                               and len(out) == r["output_size"] else "DIVERGE"),
                    "span_lido": len(blob),
                    "oracle_size": len(out), "oracle_sha256": sha(out)}
    doc = {
        "schema_version": 1,
        "gerado_por": "scripts/rex_corpus_b/locate-streams.py",
        "origem": origin,
        "rom": info,
        "hashes_normalizados": {
            "arquivo_sha256": sha(data),
            "area_de_programa_sha256": info["_programa_sha256"],
        },
        "sonda": probe,
        "corridas_de_ponteiros_total": len(runs),
        "tabelas_com_recursos": resources,
        "metodo": {
            "ancora": "corridas de >=4 ponteiros BE contiguos, nao decrescentes, apontando para a area de programa",
            "validacao": "header estrito do codec + decodificacao limitada (max_out 128 KiB, work 4 Mi) + dominio de arte",
            "limitacoes": ["monotonicidade dos ponteiros e hiptese estrutural, no lei do formato",
                           "sem prova de que o consumidor da tabela seja arte de plano de fundo/sprites",
                           "um alvo que decodifica continua sendo candidato ate evidncia de consumo"],
        },
    }
    txt = json.dumps(doc, ensure_ascii=False, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        open(args.out, "w").write(txt + "\n")
    tables = len(resources)
    tot = sum(len(t["recursos"]) for t in resources)
    print(json.dumps({"rom": info["internal_name"], "header_base": info["header_base"],
                      "checksum_ok": info["declared_checksum"] == info["computed_checksum_full"],
                      "corridas": len(runs), "tabelas_com_recursos": tables,
                      "recursos": tot, "arquivo_saida": args.out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
