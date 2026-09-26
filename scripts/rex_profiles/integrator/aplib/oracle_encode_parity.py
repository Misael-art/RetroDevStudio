#!/usr/bin/env python3
"""Prova de paridade: o que o encoder do PRODUTO emite tem que ser lido por um
decoder independente — senão só se provou que o nosso decoder concorda com o
nosso encoder, que é circular.

Os oráculos aqui NÃO usam o código do produto. `apultra` é uma implementação em
C do formato aPLib; o resultado de desempacotar cada stream do produto tem que
bater byte a byte com o plain pinado no `manifest.tsv` (coluna 4).

Receita dos streams do produto (regenerável, não versionada):

    RDS_APLIB_DUMP=src-tauri/target-test/analysis/aplib cargo test --lib aplib_encode_dumpa
    python3 scripts/rex_profiles/integrator/aplib/oracle_encode_parity.py \
        src-tauri/target-test/analysis/aplib

Ausência de ferramenta, SHA divergido, stream que não desempacota ou hash que não
bate são todos falha com rc != 0 e mensagem própria. Skip silencioso não existe:
sem oráculo a prova não aconteceu, e o script diz isso.
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

APULTRA = Path.home() / ".cache/rex-codecs/oracle-tools/apultra"
# Origem registrada: build local do apultra v1.4.8 (Emmanuel Marty / spke), a
# mesma ferramenta que produziu os streams `plain/*.apultra.ap` da fixture.
APULTRA_SHA256 = "64be2a7a8e44d3c5a4ed33de3b6d8aba294aa02870f51c29c8985fea4b34b207"


def sha256_bytes(dados: bytes) -> str:
    return hashlib.sha256(dados).hexdigest()


def pinados(manifest: Path) -> dict[str, str]:
    """`nome -> sha256 do plain` para as linhas `plain` do manifest."""
    linhas = manifest.read_text().splitlines()
    saida: dict[str, str] = {}
    for linha in linhas[1:]:
        col = linha.split("\t")
        if col[0] == "plain":
            if not col[3]:
                raise ValueError(f"linha '{col[1]}' sem SHA-256 de plain pinado")
            saida[col[1]] = col[3]
    return saida


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dumps", type=Path, help="diretório com <nome>.produto.ap")
    ap.add_argument(
        "--vectors",
        type=Path,
        default=Path("data/rex_profiles/integrator/aplib/vectors"),
    )
    args = ap.parse_args(argv[1:])

    if not APULTRA.is_file():
        print(f"FALHA: oráculo ausente em {APULTRA}; a prova não aconteceu")
        return 1
    real = sha256_bytes(APULTRA.read_bytes())
    if real != APULTRA_SHA256:
        print(
            "FALHA: SHA-256 do oráculo divergiu do registrado — não executo binário "
            f"desconhecido\n  esperado {APULTRA_SHA256}\n  obtido   {real}"
        )
        return 1

    manifest = args.vectors / "manifest.tsv"
    if not manifest.is_file():
        print(f"FALHA: manifest ausente: {manifest}")
        return 1
    try:
        esperado = pinados(manifest)
    except ValueError as e:
        print(f"FALHA: {e}")
        return 1

    dumps = sorted(args.dumps.glob("*.produto.ap"))
    if not dumps:
        print(
            f"FALHA: nenhum *.produto.ap em {args.dumps}; gere com "
            "`RDS_APLIB_DUMP=<dir> cargo test --lib aplib_encode_dumpa`"
        )
        return 1

    falhas: list[str] = []
    with tempfile.TemporaryDirectory(prefix="rex-aplib-oracle-") as saida_dir:
        for caminho in dumps:
            nome = caminho.name[: -len(".produto.ap")]
            if nome not in esperado:
                falhas.append(f"{nome}: sem linha 'plain' pinada no manifest.tsv")
                continue
            destino = Path(saida_dir) / f"{nome}.plain"
            r = subprocess.run(
                [str(APULTRA), "-d", str(caminho), str(destino)],
                capture_output=True,
                text=True,
            )
            if r.returncode != 0:
                falhas.append(
                    f"{nome}: apultra recusou o stream do produto (rc={r.returncode}): "
                    f"{(r.stderr or r.stdout).strip()[:160]}"
                )
                continue
            bytes_plain = destino.read_bytes()
            obtido = sha256_bytes(bytes_plain)
            if obtido != esperado[nome]:
                falhas.append(
                    f"{nome}: plain do oráculo {obtido[:12]}… != pinado "
                    f"{esperado[nome][:12]}…"
                )
                continue
            print(
                f"PASS  {nome:18} stream {caminho.stat().st_size:>6} B -> "
                f"plain {len(bytes_plain):>6} B  {obtido[:12]}…"
            )

    if falhas:
        print(f"\n{len(falhas)} divergência(s):")
        for f in falhas:
            print(f"  FAIL {f}")
        return 1
    print(f"\n{len(dumps)} streams do produto desempacotados pelo oráculo, 0 divergência.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
