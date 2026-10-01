#!/usr/bin/env python3
"""Sonda de SEMANTICA do CLI do oraculo: o que `-x={pointer}` realmente faz?

A ajuda diz "Extract from {pointer} address in file" — ambigua entre
(a) tratar o argumento como OFFSET no arquivo e decodificar de la, e
(b) tratar o argumento como ENDERECO DE UM PONTEIRO (u32 BE) no arquivo e
decodificar do valor apontado.

A distincao e feita com ARQUIVO AUTORAL (nenhum dado de ROM): constroi um
arquivo sinteticos com um ponteiro u32 em `ptr_addr` apontando para uma stream
vendored conhecida em `stream_addr`, entao chama o oraculo com cada interpretacao
candidata. A saida byte-a-byte contra o plain fixado identifica a semantica.

Oraculo sempre dentro de sandbox (timeout + ulimits + stdin fechado).
Somente-leitura fora do diretorio temporario proprio.

Uso: python3 scripts/rex_corpus_b/probe-oracle-extract.py [--codec nemesis,enigma,kosinski]
"""
import hashlib
import json
import os
import resource
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BIN = {"nemesis": "nemcmp", "enigma": "enicmp", "kosinski": "koscmp"}
EXT = {"nemesis": ".nem", "enigma": ".eni", "kosinski": ".kos"}
FIXDIR = os.path.join(ROOT, "data/rex_corpus_b/vendor/data/rex_profiles/codec")
ORACLE_ROOT = os.path.expanduser("~/.cache/rex-codecs/oracle-tools/bin")
DECODE_TIMEOUT = 25


def run_sandboxed(argv, timeout=DECODE_TIMEOUT):
    """Equivalente ao wrapper obrigatorio: timeout+kill, AS 2GiB, CPU 25s, FSIZE 8MiB, stdin fechado."""
    def limits():
        resource.setrlimit(resource.RLIMIT_AS, (2 << 30, 2 << 30))
        resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
        resource.setrlimit(resource.RLIMIT_FSIZE, (8 << 20, 8 << 20))
    try:
        p = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                           timeout=timeout, preexec_fn=limits)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, b"", b"timeout"


def fixtures(codec):
    d = os.path.join(FIXDIR, codec, "plain")
    ext = EXT[codec]
    out = []
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(ext):
            continue
        stem = name[:-len(ext)]
        stream = open(os.path.join(d, name), "rb").read()
        plain_path = os.path.join(d, stem + ".bin")
        if not os.path.exists(plain_path):
            continue
        out.append((stem, stream, open(plain_path, "rb").read()))
    return out


def authored_pair(codec, tmp):
    """Fallback: gera (stream, plain) com o PROPRIO oraculo no modo compressao
    sobre um plain autoral. Usado quando o codec nao tem fixture vendored nesta
    frente; a semantica sondada e do CLI, nao do formato."""
    plain = bytearray()
    for i in range(1024):
        plain += bytes([i & 0xFF, (i >> 4) & 0xFF, 0x00, 0x11])
    plain = bytes(plain)
    pp = os.path.join(tmp, codec + "_plain.bin")
    sp = os.path.join(tmp, codec + "_authored" + EXT[codec])
    open(pp, "wb").write(plain)
    orb = os.path.join(ORACLE_ROOT, BIN[codec])
    rc, so, se = run_sandboxed([orb, pp, sp])
    if rc != 0 or not os.path.exists(sp):
        return None
    return (codec + "-authored", open(sp, "rb").read(), plain)


def probe_codec(codec, tmp):
    orb = os.path.join(ORACLE_ROOT, BIN[codec])
    if not os.path.exists(orb):
        return {"codec": codec, "status": "oracle-absent"}
    cases = fixtures(codec)
    origem = "fixture-vendored"
    if not cases:
        pair = authored_pair(codec, tmp)
        if pair is None:
            return {"codec": codec, "status": "no-fixture"}
        cases = [pair]
        origem = "plain-autoral-empacotado-pelo-oraculo"
    stem, stream, plain = cases[0]
    # arquivo sintetico: cabecalho de 0x100 B com ponteiro u32 BE em 0x20,
    # stream em 0x100, lixo apos o fim da stream.
    ptr_addr = 0x20
    stream_addr = 0x100
    synth = bytearray(stream_addr + len(stream) + 0x40)
    synth[ptr_addr:ptr_addr + 4] = stream_addr.to_bytes(4, "big")
    synth[stream_addr:stream_addr + len(stream)] = stream
    spath = os.path.join(tmp, codec + "_synth.bin")
    open(spath, "wb").write(bytes(synth))

    def call(flag):
        """`flag` e a forma EXATA do argumento de extracao (None = sem ponteiro)."""
        op = os.path.join(tmp, f"{codec}_{flag}.out")
        if os.path.exists(op):
            os.remove(op)
        argv = [orb]
        if flag is not None:
            argv.append(flag)
        else:
            argv.append("-x")
        argv += [spath, op]
        rc, so, se = run_sandboxed(argv)
        data = open(op, "rb").read() if os.path.exists(op) else None
        return {"argv": [os.path.basename(a) if a == orb else a for a in argv],
                "rc": rc, "stdout": so.decode(errors="replace").strip() or None,
                "out_bytes": len(data) if data is not None else None,
                "equals_fixture_plain": data == plain if data is not None else False}

    results = {
        "sem_ponteiro": call(None),
        "curto_com_igual_endereco_ponteiro": call(f"-x={hex(ptr_addr)}"),
        "curto_com_igual_offset_stream": call(f"-x={hex(stream_addr)}"),
        "curto_anexado_endereco_ponteiro": call(f"-x{hex(ptr_addr)}"),
        "curto_anexado_offset_stream": call(f"-x{hex(stream_addr)}"),
        "longo_com_igual_endereco_ponteiro": call(f"--extract={hex(ptr_addr)}"),
        "longo_com_igual_offset_stream": call(f"--extract={hex(stream_addr)}"),
    }
    deref_keys = [k for k in results if k.endswith("endereco_ponteiro")]
    off_keys = [k for k in results if k.endswith("offset_stream")]
    deref_ok = [k for k in deref_keys if results[k]["equals_fixture_plain"]]
    off_ok = [k for k in off_keys if results[k]["equals_fixture_plain"]]
    ig_ok = results["sem_ponteiro"]["equals_fixture_plain"]
    if ig_ok:
        semantica = ("COM ARGUMENTO IGNORADO: sem ponteiro tambem reproduziu o plain "
                     "(fixture com stream em offset 0? nao e o caso) — revisar sonda")
    elif deref_ok and not off_ok:
        semantica = ("DEREFERENCIA: o argumento e o ENDERECO de um ponteiro u32 BE no "
                     "arquivo; o oraculo decodifica do valor apontado")
    elif off_ok and not deref_ok:
        semantica = ("OFFSET: o argumento e o offset da propria stream no arquivo")
    elif deref_ok and off_ok:
        semantica = "AMBIGUO: ambas as leituras reproduziram o plain (fixture insuficiente)"
    else:
        semantica = "INDETERMINADO: nenhuma forma de argumento reproduziu o plain"
    return {"codec": codec, "status": "ok", "fixture": stem,
            "fixture_origem": origem,
            "fixture_stream_sha256": hashlib.sha256(stream).hexdigest(),
            "fixture_plain_sha256": hashlib.sha256(plain).hexdigest(),
            "synth_sha256": hashlib.sha256(bytes(synth)).hexdigest(),
            "ptr_addr": hex(ptr_addr), "stream_addr": hex(stream_addr),
            "chamadas": results, "semantica": semantica}


def main():
    only = None
    if "--codec" in sys.argv:
        only = sys.argv[sys.argv.index("--codec") + 1].split(",")
    codecs = only or list(BIN)
    tmp = tempfile.mkdtemp(prefix="probe-x-")
    docs = {"schema_version": 1,
            "pergunta": "o que -x={pointer} faz no CLI do oraculo",
            "oracle_root": ORACLE_ROOT,
            "sandbox": {"timeout_s": DECODE_TIMEOUT, "as": "2GiB", "cpu": "25s",
                        "fsize": "8MiB", "stdin": "devnull"},
            "resultados": [probe_codec(c, tmp) for c in codecs]}
    print(json.dumps(docs, ensure_ascii=False, indent=1))
    outdir = os.path.join(ROOT, "data/rex_corpus_b/recursos")
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "oracle-extract-semantica.json"), "w") as f:
        json.dump(docs, f, ensure_ascii=False, indent=1)
    for r in docs["resultados"]:
        print(f"# {r['codec']}: {r.get('semantica', r.get('status'))}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
