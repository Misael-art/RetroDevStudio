#!/usr/bin/env python3
"""Confirma TODOS os recursos do locator contra o oraculo externo (nemcmp/enicmp).

O locator (`locate-streams.py`) roda com limite de casos por corrida e deixou
6/172 streams Nemesis de Pulseman com paridade externa registrada. Este script
fecha a lacuna: para CADA recurso do JSON do locator ele
  (1) re-decodifica com o decoder de pesquisa (mesmos limites do locator),
  (2) roda o oraculo no sandbox canônico (`run_oracle` do wrapper versionado)
      com `-x0xOFFSET` sobre o membro extraído da ROM,
  (3) compara SHA-256 byte a byte.
Status possiveis por recurso: `byte-identico`, `divergente`,
`meu-decoder-recusou`, `oraculo-recusou`, `fora-do-arquivo`.

Nada de comercial entra no Git: o membro da ROM e extraido para diretorio
temporario (fora do repositorio) e removido no fim; so o JSON de evidencia
(hashes e offsets) fica em data/rex_corpus_b/.

Uso:
  python3 scripts/rex_corpus_b/confirmar-oraculo-pulseman.py \
      --localizar "data/rex_corpus_b/recursos/locate-Pulseman (...).json" \
      --out data/rex_corpus_b/recursos/pulseman-oraculo-completo.json
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SANDBOX_SH = ROOT / "docs" / "rex_corpus_b" / "reference" / \
    "scripts_rex_profiles_codecs_common_sandbox.sh"
ORACLE_DIR = pathlib.Path.home() / ".cache" / "rex-codecs" / "oracle-tools" / "bin"
PINS = {
    "nemcmp": "7563a1522b01a89774dc8909204de433a1f4f87f8a99f6f10311989be2022a27",
    "enicmp": "a017430c0a7adadf051d754ed30dfded2ddd875a939a9a047e3f375da5c96d18",
}
MAX_OUT = 1 << 20
WORK_LIMIT = 1 << 24


def caminho_seguro(caminho, base):
    """Normaliza e exige que `caminho` fique dentro de `base` (sem traversal)."""
    p = pathlib.Path(caminho).resolve()
    b = pathlib.Path(base).resolve()
    if not (p == b or p.is_relative_to(b)):
        raise SystemExit(f"[caminho] fora da arvore permitida ({b}): {caminho}")
    return p


def load_module(nome, caminho):
    spec = importlib.util.spec_from_file_location(nome, str(caminho))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


NEM = load_module("nem", HERE / "nemesis_research.py")
ENI = load_module("eni", HERE / "enigma_research.py")


def sha256_file(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 16), b""):
            h.update(bloco)
    return h.hexdigest()


def conferir_pins():
    for nome, pin in PINS.items():
        caminho = (ORACLE_DIR / nome).resolve()
        if not caminho.is_file():
            raise SystemExit(f"[pin] oraculo ausente: {caminho}")
        obtido = sha256_file(caminho)
        if obtido != pin:
            raise SystemExit(f"[pin] SHA-256 de {nome} diverge do pin: {obtido}")


def extrair_membro(caminho_rom, membro, destino_tmp):
    if zipfile.is_zipfile(caminho_rom):
        with zipfile.ZipFile(caminho_rom) as z:
            alvo = membro or max(z.namelist(), key=lambda n: z.getinfo(n).file_size)
            dados = z.read(alvo)
    else:
        alvo = os.path.basename(caminho_rom)
        dados = open(caminho_rom, "rb").read()
    saida = pathlib.Path(destino_tmp) / "rom.gen"
    saida.write_bytes(dados)
    return str(saida), dados, alvo


def decode_meu(codec, rom, offset):
    """Retorna (data|None, detalhe)."""
    if codec == "nemesis":
        try:
            r = NEM.decode(rom, max_out=MAX_OUT, work_limit=WORK_LIMIT, offset=offset)
            return r.data, "ok"
        except NEM.NemesisError as e:
            return None, type(e).__name__
    try:
        data, consumed = ENI.decode(rom[offset:], max_out=MAX_OUT, work_limit=WORK_LIMIT)
        return data, "ok"
    except ENI.CodecError as e:
        return None, type(e).__name__


def run_oracle(tool, rom_path, offset, saida_oraculo, tmpdir):
    cmd = (
        f'source "{SANDBOX_SH}" && run_oracle 30 "{saida_oraculo}" -- '
        f'"{ORACLE_DIR / tool}" -x0x{offset:x} "{rom_path}" "{saida_oraculo}"'
    )
    proc = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True,
                          cwd=tmpdir, timeout=60)
    return proc.returncode


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--localizar", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--rom", default=None, help="sobrepoe o caminho do locator")
    args = ap.parse_args(argv)

    conferir_pins()
    # evidencia so pode ser escrita dentro da arvore do repositorio
    out_path = caminho_seguro(args.out, ROOT)
    doc = json.loads(pathlib.Path(args.localizar).read_text())
    origem = doc.get("origem", {})
    caminho = args.rom or origem.get("arquivo") or doc["rom"].get("caminho")
    if not caminho:
        raise SystemExit("[erro] locator sem caminho de ROM; use --rom")

    with tempfile.TemporaryDirectory(prefix="rex-b-oracle-") as tmp:
        rom_path, rom, membro = extrair_membro(caminho, origem.get("membro"), tmp)
        sha_rom = hashlib.sha256(rom).hexdigest()
        esperado = origem.get("sha256_arquivo") or doc["rom"].get("sha256_arquivo")
        if esperado and sha_rom != esperado:
            raise SystemExit(f"[pin] SHA da ROM diverge do locator: {sha_rom}")

        resultados = []
        contadores = {}
        for tabela in doc.get("tabelas_com_recursos", []):
            for r in tabela.get("recursos", []):
                if not isinstance(r, dict):
                    continue
                codec = r["codec"]
                tool = "nemcmp" if codec == "nemesis" else "enicmp"
                offset = int(r["ponteiro_valor"], 16)
                data, detalhe = decode_meu(codec, rom, offset)
                sha_meu = hashlib.sha256(data).hexdigest() if data is not None else None

                saida_oraculo = pathlib.Path(tmp) / f"out-{offset:x}.bin"
                rc = run_oracle(tool, rom_path, offset, saida_oraculo, tmp)
                if rc != 0:
                    status = "oraculo-recusou"
                    sha_oraculo = None
                    tamanho_oraculo = None
                else:
                    sha_oraculo = sha256_file(saida_oraculo)
                    tamanho_oraculo = saida_oraculo.stat().st_size
                    if data is None:
                        status = "meu-decoder-recusou"
                    elif sha_meu == sha_oraculo:
                        status = "byte-identico"
                    else:
                        status = "divergente"

                fim_span = offset + (r.get("bytes_consumed") or 0)
                dentro = fim_span <= len(rom)
                if status == "byte-identico" and not dentro:
                    status = "fora-do-arquivo"
                contadores[status] = contadores.get(status, 0) + 1
                resultados.append({
                    "tabela_offset": tabela["tabela_offset"],
                    "ponteiro_offset": r["ponteiro_offset"],
                    "offset_stream": hex(offset),
                    "codec": codec,
                    "variant": r.get("variant"),
                    "meu_output_size": len(data) if data is not None else None,
                    "meu_sha256": sha_meu,
                    "oraculo_rc": rc,
                    "oraculo_output_size": tamanho_oraculo,
                    "oraculo_sha256": sha_oraculo,
                    "span_dentro_do_arquivo": dentro,
                    "status": status,
                    "detalhe": detalhe,
                })
                print(f"[{len(resultados):3d}] {hex(offset)} {codec:8s} {status}")

    doc_out = {
        "schema_version": "rex-corpus-b/oracle-confirm/1",
        "gerado_por": "scripts/rex_corpus_b/confirmar-oraculo-pulseman.py",
        "insumo": {"localizar": os.path.abspath(args.localizar)},
        "rom": {"caminho": caminho, "membro": membro, "sha256": sha_rom,
                "size_bytes": len(rom)},
        "oraculos": {k: {"sha256": v, "papel": "referencia externa (LGPL, somente ferramenta)"}
                     for k, v in PINS.items()},
        "sandbox": "run_oracle 30 (wrapper versionado em docs/rex_corpus_b/reference/)",
        "criterio": "byte-identico = SHA-256(meu decode) == SHA-256(oraculo -x0xOFFSET) "
                    "e span consumido dentro do arquivo",
        "resumo": contadores,
        "recursos": resultados,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc_out, ensure_ascii=False, indent=1) + "\n")
    print("[resumo]", contadores)
    print("evidencia:", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
