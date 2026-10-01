#!/usr/bin/env python3
"""Testes do compor-recurso.py com stream sintetica empacotada PELO ORACULO.

Fluxo: plain sintetico (int16 BE, 4096 B) -> `enicmp` empacota -> stream
embutida em ROM sintetica -> consumidor sintetico (JSON com o mesmo SHA de
ROM) -> compositor compõe e executa as recusas (paleta, base != 0, proveniencia
cruzada, saida fora da arvore). Oraculo indisponivel => SKIP, nunca FAIL falso.
"""
import hashlib
import importlib.util
import json
import pathlib
import shutil
import struct
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TMP = ROOT / "data" / "rex_corpus_b" / "tmp-test-compor"
SANDBOX_SH = ROOT / "docs" / "rex_corpus_b" / "reference" / \
    "scripts_rex_profiles_codecs_common_sandbox.sh"
ENICMP = pathlib.Path.home() / ".cache" / "rex-codecs" / "oracle-tools" / "bin" / "enicmp"
ENICMP_PIN = "a017430c0a7adadf051d754ed30dfded2ddd875a939a9a047e3f375da5c96d18"

PASS, FAIL = [], []


def check(nome, cond, detalhe=""):
    (PASS if cond else FAIL).append(nome)
    print(f"[{'PASS' if cond else 'FAIL'}] {nome}" + (f" — {detalhe}" if detalhe and not cond else ""))


def spec(nome, caminho):
    s = importlib.util.spec_from_file_location(nome, caminho)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


def main():
    ENI = spec("eni", HERE / "enigma_research.py")

    if not (ENICMP.is_file() and hashlib.sha256(ENICMP.read_bytes()).hexdigest() == ENICMP_PIN):
        print("[SKIP] oraculo enicmp indisponivel ou pin divergente")
        return 0

    TMP.mkdir(parents=True, exist_ok=True)
    try:
        # plain sintetico: gradientes e repeticoes que o Enigma comprime bem
        palavras = ([0x0100 + i for i in range(16)] * 8
                    + [0x0200] * 64 + [0x0810] * 32 + [0x0000] * 64)
        palavras = (palavras * 16)[:2048]
        plain = struct.pack(f">{len(palavras)}H", *palavras)
        assert len(plain) == 4096

        entra = TMP / "plain.bin"
        sai = TMP / "stream.eni"
        entra.write_bytes(plain)
        cmd = (f'source "{SANDBOX_SH}" && run_oracle 30 null -- "{ENICMP}" '
               f'"{entra}" "{sai}"')
        proc = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, cwd=TMP)
        check("oraculo empacota a stream sintetica", proc.returncode == 0, proc.stderr[-200:])
        if proc.returncode != 0:
            return 1
        stream = sai.read_bytes()

        # ROM sintetica: header + stream em 0x20000 + tabela com 1 entrada
        rom = bytearray(0x30000)
        rom[0:4] = b"\x00\xff\x0f\xf0"
        OFFSET = 0x20000
        TABELA = 0x20100
        rom[OFFSET:OFFSET + len(stream)] = stream
        struct.pack_into(">I", rom, TABELA, OFFSET)
        caminho_rom = TMP / "synthetic.gen"
        caminho_rom.write_bytes(bytes(rom))
        sha_rom = hashlib.sha256(bytes(rom)).hexdigest()

        consumidor = {
            "schema_version": "rex-corpus-b/consumidor-negativo/1",
            "rom": {"sha256": sha_rom},
            "conclusao": "consumidor-localizado",
        }
        caminho_cons = TMP / "consumidor.json"
        caminho_cons.write_text(json.dumps(consumidor))

        COMP = spec("comp", HERE / "compor-recurso.py")
        saida = TMP / "recurso.json"

        rc = COMP.main(["--rom", str(caminho_rom), "--offset", hex(OFFSET),
                        "--consumidor", str(caminho_cons), "--out", str(saida)])
        check("rc==0 na composicao", rc == 0)
        doc = json.loads(saida.read_text())
        check("output_size == 4096", doc["recurso"]["output_size"] == 4096,
              str(doc["recurso"]["output_size"]))
        check("sha do plain confere com o plain sintetico",
              doc["recurso"]["output_sha256"] == hashlib.sha256(plain).hexdigest())
        check("negativo identidade ok", doc["negativos"]["identidade"]["identico"] is True)
        check("negativo limites: truncada recusada",
              doc["negativos"]["limites"]["truncada_recusada"] is True)
        check("vinculo paleta not-evidenced",
              doc["vinculos"]["paleta"]["status"] == "not-evidenced")

        # recusas
        try:
            COMP.main(["--rom", str(caminho_rom), "--offset", hex(OFFSET),
                       "--consumidor", str(caminho_cons), "--out", str(saida),
                       "--paleta", "inventada"])
            check("paleta inventada recusada", False)
        except SystemExit as e:
            check("paleta inventada recusada", "paleta" in str(e))

        try:
            COMP.main(["--rom", str(caminho_rom), "--offset", hex(OFFSET),
                       "--consumidor", str(caminho_cons), "--out", str(saida),
                       "--value-offset", "0x400"])
            check("base 0x400 recusada", False)
        except SystemExit as e:
            check("base 0x400 recusada", "base" in str(e))

        outra_rom = TMP / "outra.gen"
        outra_rom.write_bytes(b"\x00\xff\x0f\xf0" + bytes(0x1000))
        try:
            COMP.main(["--rom", str(outra_rom), "--offset", hex(OFFSET),
                       "--consumidor", str(caminho_cons), "--out", str(saida)])
            check("proveniencia cruzada recusada", False)
        except SystemExit as e:
            check("proveniencia cruzada recusada", "associacao" in str(e) or "ROM" in str(e))

        try:
            COMP.main(["--rom", str(caminho_rom), "--offset", hex(OFFSET),
                       "--consumidor", str(caminho_cons), "--out", "/tmp/rex-b-fora.json"])
            check("--out fora da arvore recusado", False)
        except SystemExit as e:
            check("--out fora da arvore recusado", "fora da arvore" in str(e))
    finally:
        shutil.rmtree(TMP, ignore_errors=True)

    print(f"\nverificacoes: {len(PASS)} pass / {len(FAIL)} fail")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
