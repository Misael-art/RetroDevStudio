#!/usr/bin/env python3
"""Verifica o conjunto de vetores aPLib importado (PASSO 5).

Reproduz a receita canônica de hash agregado declarada por B e confere, arquivo a
arquivo, os SHA-256 registrados em manifest.json. Sai com rc!=0 e mensagem
específica em qualquer divergência — ausência de arquivo é falha, não skip.
"""
import hashlib
import json
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def aggregate(vectors: Path) -> str:
    names = sorted(
        str(p.relative_to(vectors))
        for d in ("plain", "golden", "negative")
        for p in (vectors / d).rglob("*")
        if p.is_file()
    )
    listing = "".join(f"{sha256(vectors / n)}  {n}\n" for n in names)
    payload = listing.encode() + (vectors / "manifest.tsv").read_bytes()
    return hashlib.sha256(payload).hexdigest()


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path("data/rex_profiles/integrator/aplib")
    vectors = root / "vectors"
    manifest = json.loads((root / "manifest.json").read_text())
    expected_agg = "3a9d7e9e2312a7457003feb8d15214926f84354d3b19aa6039e2a3a3b66bec0d"

    for label in ("plain", "golden", "negative"):
        if not (vectors / label).is_dir():
            print(f"FALHA: diretório de vetores ausente: {label}/")
            return 1

    got = aggregate(vectors)
    if got != expected_agg:
        print(f"FALHA: hash agregado divergiu do pino de B\n  esperado {expected_agg}\n  obtido {got}")
        return 1
    recorded = manifest["verificacao"]["hash_agregado_receita_canonica"]
    if recorded != got:
        print(f"FALHA: manifest.json registra agregado {recorded}, receita dá {got}")
        return 1

    bad = []
    for rel, info in manifest["arquivos_por_sha256"].items():
        path = vectors / rel
        if not path.is_file():
            bad.append(f"{rel}: arquivo listado no manifest não existe")
        elif sha256(path) != info["sha256"]:
            bad.append(f"{rel}: SHA-256 divergiu")
        elif path.stat().st_size != info["bytes"]:
            bad.append(f"{rel}: tamanho divergiu")
    on_disk = {
        str(p.relative_to(vectors)) for p in vectors.rglob("*") if p.is_file()
    }
    for extra in sorted(on_disk - set(manifest["arquivos_por_sha256"])):
        bad.append(f"{extra}: arquivo presente mas não registrado no manifest")
    if bad:
        print("FALHA:")
        for line in bad:
            print("  " + line)
        return 1

    print(f"OK: {len(manifest['arquivos_por_sha256'])} arquivos, agregado {got}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
