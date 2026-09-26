#!/usr/bin/env python3
"""Varre o piso do formato LZ4W sobre dumps do benchmark e mede a margem.

    floor_sweep.py <dir-de-dumps> [--jsonl <saida.jsonl>]

Lê os dumps escritos por `RDS_REX_BENCH_DUMP_DIR` (teste ignorado
`lz4w_recompression_benchmark` em `src-tauri/src/tools/reverse/decomp/
rex_resources.rs`) e roda o DP de custo explícito de `dp_floor.py` sobre cada
recurso. O que responde é uma pergunta só: **quanto o codificador guloso do
produto ainda deixa na mesa** — e se essa sobra alguma vez cruzaria o slot.

Saída é medida, não bytes: este script nunca escreve plain nem stream, então o
resultado pode ser versionado sem levar conteúdo comercial para o git.

Barreiras por recurso (asserções, não comentários):
  * o stream que a DP reconstrói decodifica de volta ao plain pelo tokenizador
    independente de `tokens.py`, consumindo o stream inteiro;
  * o custo que o modelo anuncia é exatamente o comprimento do stream.
Sem essas duas, o número seria só uma heurística com nome de piso. A palavra
"ótimo" só vale porque `dp_floor.py --selftest` compara a DP com busca exaustiva
(1165 entradas pequenas, cinco configurações) — ver o docstring de lá.

Unidades: bytes, sempre. `piso` é o stream completo (descritores + literais +
palavras de offset + terminador de 2 words).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dp_floor  # noqa: E402
from tokens import tokenize  # noqa: E402


def medir(entry: dict, dump_dir: Path, escrever_stream: bool) -> dict:
    stem = entry["stem"]
    plain = (dump_dir / f"{stem}-plain.bin").read_bytes()
    dict_blob = (dump_dir / f"{stem}-dict.bin").read_bytes()
    produto = (dump_dir / f"{stem}-produto.stream").read_bytes()
    rescomp = (dump_dir / f"{stem}-rescomp.stream").read_bytes()
    assert len(plain) % 2 == 0 and len(dict_blob) % 2 == 0, \
        f"{stem}: dump com extensão ímpar não é palavra alinhada"

    dict_w = dp_floor.words_of(dict_blob)
    plain_w = dp_floor.words_of(plain)
    total = dict_w + plain_w
    dp, choice = dp_floor.solve(total, len(dict_w), len(plain_w))
    words = dp[0][0] + dp_floor.TERMINATOR_WORDS
    stream = dp_floor.render(total, len(dict_w), choice, len(plain_w))

    back, tokens, consumed = tokenize(stream, dict_blob)
    assert back == plain, f"{stem}: stream da DP não reproduz o plain"
    assert consumed == len(stream), \
        f"{stem}: stream da DP consumido parcialmente ({consumed}/{len(stream)})"
    assert len(stream) // 2 == words, \
        f"{stem}: modelo anuncia {words} words, stream tem {len(stream) // 2}"

    if escrever_stream:
        (dump_dir / f"{stem}-piso.stream").write_bytes(stream)

    slot = entry["slot"]
    return {
        "recurso": entry["recurso"],
        "conjunto": entry["conjunto"],
        "grupo": entry["grupo"],
        "stem": stem,
        "plain_bytes": len(plain),
        "plain_sha256": hashlib.sha256(plain).hexdigest(),
        "dict_sha256": hashlib.sha256(dict_blob).hexdigest(),
        "piso_stream_sha256": hashlib.sha256(stream).hexdigest(),
        "produto_stream_sha256": hashlib.sha256(produto).hexdigest(),
        "slot": slot,
        "rescomp": len(rescomp),
        "produto": len(produto),
        "piso": words * 2,
        "tokens_piso": len(tokens),
        "tokens_produto": len(tokenize(produto, dict_blob)[1]),
        "gap_produto_sobre_piso": len(produto) - words * 2,
        "gap_rescomp_sobre_piso": len(rescomp) - words * 2,
        # O ponto decisivo: o stream do produto NÃO cabe no slot, mas o piso
        # caberia. É recurso que um codificador melhor tornaria editável sem
        # expansão — nenhum outro critico traduz margem em capacidade de edição.
        "piso_cabe_no_slot": words * 2 <= slot,
        "passaria_a_caber": len(produto) > slot and words * 2 <= slot,
    }


def fora_do_repositorio(path: Path) -> bool:
    """O dump contém plain de ROM comercial: nada dele pode cair no git."""
    try:
        path.relative_to(REPO)
        return False
    except ValueError:
        return True


def resumo(sel: list[dict]) -> dict:
    if not sel:
        return {"recursos": 0}
    gaps = [r["gap_produto_sobre_piso"] for r in sel]
    return {
        "recursos": len(sel),
        "soma_gap_produto_sobre_piso_bytes": sum(gaps),
        "mediana_gap": statistics.median(gaps),
        "gap_maximo": max(gaps),
        "recursos_com_piso_igual_produto": sum(g for g in gaps if g == 0),
        "recursos_com_piso_menor_que_produto": sum(g for g in gaps if g > 0),
        "recursos_com_piso_maior_que_produto": sum(g for g in gaps if g < 0),
        "piso_cabe_no_slot": sum(r["piso_cabe_no_slot"] for r in sel),
        "passariam_a_caber": sum(r["passaria_a_caber"] for r in sel),
        "soma_produto_bytes": sum(r["produto"] for r in sel),
        "soma_piso_bytes": sum(r["piso"] for r in sel),
        "soma_slot_bytes": sum(r["slot"] for r in sel),
    }


REPO = Path(__file__).resolve().parents[4]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dump_dir")
    ap.add_argument("--jsonl", default=None)
    ap.add_argument("--escrever-streams", action="store_true",
                    help="grava {stem}-piso.stream no próprio dump dir (fora do "
                         "repositório) para o verificador do decoder do produto")
    args = ap.parse_args()
    dump_dir = Path(args.dump_dir).resolve()
    if args.escrever_streams:
        assert fora_do_repositorio(dump_dir), \
            f"--escrever-streams recusado: {dump_dir} está dentro de {REPO}"
    index = json.loads((dump_dir / "dumps-index.json").read_text())
    entries = index["recursos"]

    rows = []
    t0 = time.time()
    for k, entry in enumerate(entries, 1):
        rows.append(medir(entry, dump_dir, args.escrever_streams))
        if k % 40 == 0:
            print(f"  ... {k}/{len(entries)} em {time.time() - t0:.1f}s",
                  file=sys.stderr)

    grupos = {g: resumo([r for r in rows if r["grupo"] == g])
              for g in ("ajuste", "validacao", "referencia")}
    print(json.dumps({"resumo": grupos,
                      "varredura": {
                          "dir_de_dumps": str(dump_dir),
                          "streams_de_piso_escritos": args.escrever_streams,
                          "dp_floor_sha256": hashlib.sha256(
                              (Path(__file__).resolve().parent / "dp_floor.py")
                              .read_bytes()).hexdigest(),
                      },
                      "tempo_varredura_s": round(time.time() - t0, 1)},
                     ensure_ascii=False, indent=2))
    print()
    print(f"{'recurso':>10} {'grupo':>11} {'plain':>6} {'slot':>6} "
          f"{'produto':>7} {'piso':>6} {'gap':>5}  caberia?")
    for r in sorted(rows, key=lambda r: -r["gap_produto_sobre_piso"]):
        if r["gap_produto_sobre_piso"] == 0 and not r["passaria_a_caber"]:
            continue
        print(f"{r['recurso']:>10} {r['grupo']:>11} {r['plain_bytes']:>6} "
              f"{r['slot']:>6} {r['produto']:>7} {r['piso']:>6} "
              f"{r['gap_produto_sobre_piso']:>+5}  "
              f"{'SIM' if r['passaria_a_caber'] else 'não'}")
    if args.jsonl:
        Path(args.jsonl).write_text("\n".join(json.dumps(r, ensure_ascii=False)
                                              for r in rows) + "\n")
        print(f"\n[jsonl] {args.jsonl}: {len(rows)} linhas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
