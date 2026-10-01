#!/usr/bin/env python3
"""Fixture da divergencia len=0 do Nemesis (descoberta em stream "real" do Sonic 1).

Stream autoral (16 B) com um registro de tabela de comprimento de codigo 0 que
NENHUM bitstream referencia (o acumulador comeca em len=1). A referencia
(nemesis.cc decode_header) armazena `codemap[Code{code, 0}]` sem checagem, e a
decodificacao nunca consulta (code, 0). O teste prov:
  (1) o ORACULO aceita e decodifica a stream (rc=0);
  (2) o decoder de pesquisa com strict=False decodifica byte-idêntico ao
      oraculo e registra o registro em `unreachable`;
  (3) o decoder de pesquisa com strict=True (contrato do produto) RECUSA com
      InvalidReferenceError — divergencia deliberada, agora REGISTRADA com
      fixture e nao mais inferida.

Uso: python3 scripts/rex_corpus_b/test-nemesis-len0.py [--oracle] [--out EVID.json]
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import struct
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SANDBOX_SH = ROOT / "docs" / "rex_corpus_b" / "reference" / \
    "scripts_rex_profiles_codecs_common_sandbox.sh"
ORACLE = pathlib.Path.home() / ".cache" / "rex-codecs" / "oracle-tools" / "bin" / "nemcmp"
ORACLE_PIN = "7563a1522b01a89774dc8909204de433a1f4f87f8a99f6f10311989be2022a27"

# stream: size word 0001 (1 tile), tabela com (a) registro valido e
# (b) registro len=0 inatingivel, terminator, bitstream de 64 bits zero
# -> saida esperada: 32 bytes 0xFF (nibble F, count 1, 64 vezes)
STREAM = bytes.fromhex("0001") + bytes.fromhex("8f") + bytes.fromhex("01") \
    + bytes.fromhex("00") + bytes.fromhex("00") + bytes.fromhex("11") \
    + bytes.fromhex("ff") + bytes(8)
TABLE = {
    "size_word": "0x0001", "flag_alt": 0, "rtiles": 1, "declared_out": 32,
    "registros": [
        {"bytes": "8f 01 00", "significado": "nibble=0xF; (code=0x00, len=1) -> (0xF, 1)"},
        {"bytes": "00 11", "significado": "(code=0x11, len=0) -> (0xF, 1); len=0 INATINGIVEL"},
        {"bytes": "ff", "significado": "terminador"},
    ],
    "bitstream": "8 bytes 0x00 (64 bits zero) -> 64 hits de (0,1) -> 64 nibbles 0xF",
}


def spec(nome, caminho):
    s = importlib.util.spec_from_file_location(nome, caminho)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=None, help="JSON de evidencia (dentro da arvore)")
    a = ap.parse_args(argv)

    NEM = spec("nem", HERE / "nemesis_research.py")
    resultado = {"schema_version": "rex-corpus-b/nemesis-len0/1",
                 "stream_hex": STREAM.hex(), "tabela": TABLE,
                 "stream_sha256": hashlib.sha256(STREAM).hexdigest()}

    # (1) oraculo
    sha_oraculo = None
    rc_oraculo = None
    if ORACLE.is_file() and hashlib.sha256(ORACLE.read_bytes()).hexdigest() == ORACLE_PIN:
        import tempfile
        with tempfile.TemporaryDirectory(prefix="rex-b-len0-") as tmp:
            entra = pathlib.Path(tmp) / "in.nem"
            sai = pathlib.Path(tmp) / "out.bin"
            entra.write_bytes(STREAM)
            cmd = (f'source "{SANDBOX_SH}" && run_oracle 30 "{sai}" -- '
                   f'"{ORACLE}" -x "{entra}" "{sai}"')
            proc = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, cwd=tmp)
            rc_oraculo = proc.returncode
            if rc_oraculo == 0:
                dados = sai.read_bytes()
                sha_oraculo = hashlib.sha256(dados).hexdigest()
                resultado["oraculo"] = {"rc": rc_oraculo, "output_size": len(dados),
                                        "output_sha256": sha_oraculo,
                                        "saida_e_32x_ff": dados == b"\xff" * 32}
                print(f"[oraculo] rc=0, {len(dados)} B, sha={sha_oraculo[:16]}, 32x0xFF={dados == b'\xff' * 32}")
            else:
                resultado["oraculo"] = {"rc": rc_oraculo}
                print(f"[oraculo] rc={rc_oraculo} (recusa)")
    else:
        resultado["oraculo"] = {"status": "indisponivel"}
        print("[oraculo] indisponivel (pin divergente ou ausente)")

    # (2) meu decoder leniente
    try:
        r = NEM.decode(STREAM, max_out=1 << 16, work_limit=1 << 20, strict=False)
        sha_meu = hashlib.sha256(r.data).hexdigest()
        hdr = NEM.parse_header(STREAM, 0, strict=False)
        resultado["meu_lenient"] = {
            "output_size": len(r.data), "output_sha256": sha_meu,
            "unreachable_records": hdr.unreachable_records,
            "bytes_consumed": r.bytes_consumed,
            "igual_oraculo": (sha_oraculo is not None and sha_meu == sha_oraculo),
        }
        print(f"[lenient] {len(r.data)} B, unreachable={hdr.unreachable_records}, "
              f"consumed={r.bytes_consumed}, igual_oraculo={sha_oraculo == sha_meu}")
    except NEM.NemesisError as e:
        resultado["meu_lenient"] = {"recusa": f"{type(e).__name__}: {e}"}
        print(f"[lenient] RECUSA inesperada: {e}")

    # (3) meu decoder strict
    try:
        NEM.decode(STREAM, max_out=1 << 16, work_limit=1 << 20, strict=True)
        resultado["meu_strict"] = {"recusa": None}
        print("[strict] decodificou (INESPERADO)")
    except NEM.InvalidReferenceError as e:
        resultado["meu_strict"] = {"recusa": "InvalidReferenceError", "mensagem": str(e)[:120]}
        print("[strict] recusa estruturada InvalidReferenceError (contrato)")

    ok = (resultado.get("oraculo", {}).get("saida_e_32x_ff") is True
          and resultado.get("meu_lenient", {}).get("igual_oraculo") is True
          and resultado.get("meu_strict", {}).get("recusa") == "InvalidReferenceError")
    print("[veredito]", "PASS" if ok else "FAIL")
    if a.out:
        caminho = pathlib.Path(a.out).resolve()
        if not (caminho == ROOT or caminho.is_relative_to(ROOT)):
            raise SystemExit(f"[caminho] --out fora da arvore: {a.out}")
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text(json.dumps(resultado, ensure_ascii=False, indent=1) + "\n")
        print("evidencia:", caminho)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
