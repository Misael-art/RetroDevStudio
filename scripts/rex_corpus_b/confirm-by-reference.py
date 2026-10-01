#!/usr/bin/env python3
"""Confirmacao de recursos reais POR REFERENCIA EXTERNA, no offset da ROM.

Diferenca para o locator: aqui o oraculo e chamado com a stream NO PROPRIO
ARQUIVO DA ROM (`-x0x<offset>`), sem fatiar nada, e o `nemcmp -i` reporta onde
a referencia diz que o dado termina — o que permite testar o ENCADEAMENTO
(fim da stream i == inicio da stream i+1) como evidencia estrutural, e nao o
decoder autoral provando a si mesmo.

Semantica do `-x` fixada por sonda em probe-oracle-extract.py:
  * o argumento e o OFFSET da stream no arquivo (apesar da ajuda dizer "pointer");
  * `-x=0xADDR` NAO funciona (getopt curto: o "=" entra no valor e e ignorado);
    a forma valida e `-x0xADDR` ou `--extract=0xADDR`;
  * `-x` sem argumento = offset 0.
Por isso esta ferramenta usa somente `-x0x...` e recusa qualquer outra forma.

Corpus SEMPRE somente-leitura: a ROM e aberta para leitura; unicos arquivos
escritos sao a saida JSON e temporarios removidos no fim.

Uso:
  python3 scripts/rex_corpus_b/confirm-by-reference.py --rom CAMINHO \
      --addr 0x64a00 --addr 0x64b9a ... [--codec nemesis,enigma,kosinski] \
      [--nome ROTULO] [--out data/rex_corpus_b/recursos/x.json]
"""
import argparse
import hashlib
import json
import os
import resource
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ORACLE_ROOT = os.path.expanduser("~/.cache/rex-codecs/oracle-tools/bin")
BIN = {"nemesis": "nemcmp", "enigma": "enicmp", "kosinski": "koscmp",
       "kosinski-moduled": "koscmp"}
# pins verificados contra os binarios instalados (docs/rex_corpus_b/RECONCILIACAO.md)
PIN = {
    "nemesis": "7563a1522b01a89774dc8909204de433a1f4f87f8a99f6f10311989be2022a27",
    "enigma": "a017430c0a7adadf051d754ed30dfded2ddd875a939a9a047e3f375da5c96d18",
    "kosinski": "a74c92957eccf9c1e5143167af9d6d98b2ce087aed8fe10d50b1f9c016373ea3",
}
SANDBOX = {"timeout_s": 25, "as_bytes": 2 << 30, "cpu_s": 25, "fsize_bytes": 8 << 20}


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rom(path):
    """Le a ROM (zip ou crua) sem escrever nada fora do diretorio temporario."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if not n.startswith("__MACOSX")]
            cand = [n for n in names
                    if os.path.splitext(n)[1].lower() in (".bin", ".md", ".gen", ".smd")] or names
            best = max((z.getinfo(n) for n in cand), key=lambda i: i.file_size)
            data = z.read(best.filename)
            return data, {"kind": "zip", "member": best.filename,
                          "member_crc32": format(best.CRC, "08x"),
                          "member_size": best.file_size}
    data = open(path, "rb").read()
    return data, {"kind": "raw", "member": os.path.basename(path),
                  "member_size": len(data)}


def run_oracle(argv, cwd, timeout=SANDBOX["timeout_s"]):
    def limits():
        resource.setrlimit(resource.RLIMIT_AS, (SANDBOX["as_bytes"], SANDBOX["as_bytes"]))
        resource.setrlimit(resource.RLIMIT_CPU, (SANDBOX["cpu_s"], SANDBOX["cpu_s"]))
        resource.setrlimit(resource.RLIMIT_FSIZE, (SANDBOX["fsize_bytes"], SANDBOX["fsize_bytes"]))
    try:
        p = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                           timeout=timeout, preexec_fn=limits, cwd=cwd)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, b"", b"timeout"


def u32(b, o):
    return int.from_bytes(b[o:o + 4], "big") if o + 4 <= len(b) else None


def u16(b, o):
    return int.from_bytes(b[o:o + 2], "big") if o + 2 <= len(b) else None


def confirm_one(codec, rom_path, addr, tmp, rom_len, head):
    """Chama a referencia no offset da ROM e descreve o resultado medido.

    `head` sao os bytes da ROM NO offset: o cabecalho do codec e lido da
    ENTRADA, nunca da saida decodificada (ler o header da saida produziria
    variante inventada).
    """
    orb = os.path.join(ORACLE_ROOT, BIN[codec])
    base = {"codec": codec, "offset": hex(addr), "tool": os.path.basename(orb),
            "invocacao": f"-x0x{addr:x}"}
    if not os.path.exists(orb):
        base["status"] = "oracle-absent"
        return base
    pin_key = codec.split("-")[0]
    if sha256_file(orb) != PIN.get(pin_key):
        base["status"] = "oracle-pin-mismatch"
        base["pin_esperado"] = PIN.get(pin_key)
        base["pin_obtido"] = sha256_file(orb)
        return base
    out = os.path.join(tmp, f"{codec}-{addr:x}.bin")
    if codec == "nemesis":
        flags = ["-i", f"-x0x{addr:x}"]
    elif codec == "kosinski-moduled":
        flags = ["-m", f"-x0x{addr:x}"]
    else:
        flags = [f"-x0x{addr:x}"]
    argv = [orb] + flags + [rom_path, out]
    rc, so, se = run_oracle(argv, tmp)
    data = open(out, "rb").read() if os.path.exists(out) else None
    n = len(data) if data is not None else 0
    timed_out = se == b"timeout"
    r = {**base, "rc": rc, "stdout": so.decode(errors="replace").strip() or None,
         "stderr": se.decode(errors="replace").strip()[:200] or None,
         "output_size": n, "output_sha256": hashlib.sha256(data).hexdigest() if data else None}
    if codec == "nemesis" and len(head) >= 2:
        sw = int.from_bytes(head[:2], "big")
        r["size_word_entrada"] = hex(sw)
        r["declared_tiles"] = sw & 0x7FFF
        r["flag_alt"] = (sw >> 15) & 1
        r["saida_declarada_bytes"] = (sw & 0x7FFF) * 32
    if r["stdout"] and codec == "nemesis":
        raw = int(r["stdout"], 16)
        end = raw - (1 << 64) if raw >= (1 << 63) else raw
        if end < 0:
            r["referencia_sem_fim_valido"] = (
                f"stdout={r['stdout']} (tellg=-1: a referencia leu alem do EOF)")
        else:
            r["referencia_diz_que_termina_em"] = hex(end)
            r["bytes_consumed_pela_referencia"] = end - addr
            r["sai_do_arquivo"] = end > rom_len
    if timed_out:
        r["status"] = "timeout-no-sandbox"
    elif n > 0:
        r["status"] = "decoded"
    else:
        r["status"] = "empty" if rc == 0 else "refused"
    if os.path.exists(out):
        os.remove(out)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--addr", action="append", default=[], help="hex ou decimal, repetivel")
    ap.add_argument("--codec", default="nemesis,enigma,kosinski")
    ap.add_argument("--nome", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    addrs = [int(x, 0) for x in a.addr]
    codecs = [c.strip() for c in a.codec.split(",") if c.strip()]
    bad = [c for c in codecs if c not in BIN]
    if bad:
        print(f"codec(s) desconhecido(s): {bad}", file=sys.stderr)
        return 2
    if not os.path.exists(a.rom):
        print(f"ROM ausente: {a.rom}", file=sys.stderr)
        return 2

    data, prov = load_rom(a.rom)
    doc = {
        "schema_version": 1,
        "gerado_por": "scripts/rex_corpus_b/confirm-by-reference.py",
        "metodo": "referencia externa decodificando NO OFFSET DA ROM (-x0xADDR); "
                  "nemcmp -i reporta o fim declarado pela referencia",
        "sandbox": SANDBOX,
        "semantica_x": "offset da stream no arquivo; forma valida -x0xADDR (o -x=ADDR e ignorado; "
                       "sonda: scripts/rex_corpus_b/probe-oracle-extract.py)",
        "rom": {"caminho": a.rom, "nome": a.nome or os.path.basename(a.rom),
                "sha256_arquivo": sha256_file(a.rom), "size_bytes": len(data),
                "procedencia_interna": prov,
                "internal_name": data[0x120:0x12C].decode("latin1").strip("\x00 ").strip()
                                 if len(data) > 0x12C else None,
                "product_code": data[0x180:0x18E].decode("latin1").strip("\x00 ").strip()
                                if len(data) > 0x18E else None,
                "declared_checksum": hex(u16(data, 0x18E)) if len(data) > 0x190 else None,
                "rom_range": [hex(u32(data, 0x1A0)), hex(u32(data, 0x1A4))]
                             if len(data) > 0x1A8 else None},
        "enderecos_sondados": [hex(x) for x in addrs],
        "resultados": [],
    }
    tmp = tempfile.mkdtemp(prefix="cbr-")
    try:
        for addr in addrs:
            head = data[addr:addr + 16]
            row = {"offset": hex(addr),
                   "u32_no_offset": hex(u32(data, addr)) if addr + 4 <= len(data) else None,
                   "bytes": head[:8].hex(),
                   "por_codec": [confirm_one(c, a.rom, addr, tmp, len(data), head)
                                 for c in codecs]}
            # encadeamento: a referencia diz que termina no proximo alvo?
            ends = {r["codec"]: r.get("bytes_consumed_pela_referencia")
                    for r in row["por_codec"]}
            row["fim_referencia"] = {k: v for k, v in ends.items() if v is not None}
            doc["resultados"].append(row)
            line = " | ".join(f"{r['codec']}:{r['status']}/{r.get('output_size')}B"
                              for r in row["por_codec"])
            print(f"{hex(addr)}  {line}")
    finally:
        for f in os.listdir(tmp):
            os.remove(os.path.join(tmp, f))
        os.rmdir(tmp)

    # ordena alvos e testa a hipotese de cadeia contigua
    ordered = sorted(addrs)
    pairs = []
    by_off = {r["offset"]: r for r in doc["resultados"]}
    for i in range(len(ordered) - 1):
        cur, nxt = hex(ordered[i]), hex(ordered[i + 1])
        end = by_off.get(cur, {}).get("fim_referencia", {}).get("nemesis")
        if end is None:
            continue
        pairs.append({"de": cur, "para": nxt, "fim_nemesis": hex(ordered[i] + end),
                      "encadeia": ordered[i] + end == ordered[i + 1],
                      "gaps_bytes": ordered[i + 1] - ordered[i], "span": end})
    doc["encadeamento_nemesis_entre_alvos"] = pairs
    doc["limitacoes"] = [
        "A referencia decodifica no offset e nao valida a tabela que (se) aponta para la: "
        "identidade do consumidor continua exigindo evidencia do ponteiro.",
        "Decodificar NAO prova variante grafica (2B/4B/8B e convencao do consumidor, nao do formato).",
        "Sem --confirmar por hash do output: a saida e registrada por tamanho+SHA-256, comparavel "
        "a qualquer outra medicao.",
    ]
    out = a.out or os.path.join(ROOT, "data/rex_corpus_b/recursos",
                                "confirm-" + (doc["rom"]["nome"].replace(" ", "_")) + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"\nevidencia: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
