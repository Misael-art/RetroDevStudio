#!/usr/bin/env python3
"""Mede o layout dos tiles nos plains Nemesis JA CONFIRMADOS byte a byte contra referencia.

Insumo: o JSON do locator (`--localizar`) so entra com recursos cuja saida bateu
byte a byte com o decodificador de referencia externo (mdcomp `nemcmp`). Nada aqui
re-decodifica "no escuro": o span consumido e o SHA de saida ja sao evidenciados
la, e este script refaz o decode com os mesmos limites para obter o plain.

O criterio de decisao (margem, taxa de pares adjacentes desiguais) esta PRÉ-fixado
em `md-tiles.py` e preso por teste em `test-md-tiles.py`, calibrado em verdade de
solo sintetica nos DOIS layouts. A largura real do plain nao e conhecida sem o
nametable, entao cada plain e medido em varias larguras e o veredito so e afirmado
se for unanime; caso contrario o resultado e "inconclusivo".

Uso:
  python3 scripts/rex_corpus_b/measure-md-layout.py \
      --localizar data/rex_corpus_b/recursos/locate-<ROM>.json \
      --out data/rex_corpus_b/recursos/<rom>-layout-medido.json
"""
import argparse
import hashlib
import importlib.util
import json
import os
import struct
import sys
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_spec = importlib.util.spec_from_file_location("mdt", os.path.join(HERE, "md-tiles.py"))
MD = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(MD)
_spec = importlib.util.spec_from_file_location("nem", os.path.join(HERE, "nemesis_research.py"))
NEM = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(NEM)

LARGURAS = (1, 2, 4, 6, 8, 12)      # larguras de plain em tiles a testar
MAX_OUT = 1 << 20
WORK_LIMIT = 1 << 24
ESCALA_PNG = 6


def png_cinza(caminho, linhas, escala=ESCALA_PNG):
    """PNG 8-bit em escala de cinza, so com a stdlib (sem Pillow).

    Valor de pixel = indice * 17, para que 0..15 cubra 0..255.
    """
    h, w = len(linhas), len(linhas[0])
    corpo = b"".join(
        b"\x00" + bytes(v * 17 for v in linha for _ in range(escala))
        for linha in linhas for _ in range(escala)
    )

    def chunk(tipo, dado):
        return (struct.pack(">I", len(dado)) + tipo + dado
                + struct.pack(">I", zlib.crc32(tipo + dado) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w * escala, h * escala, 8, 0, 0, 0, 0)
    with open(caminho, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                + chunk(b"IDAT", zlib.compress(corpo, 9)) + chunk(b"IEND", b""))
    return hashlib.sha256(open(caminho, "rb").read()).hexdigest()


def linhas_do_plain(plain, layout, largura_desejada=8):
    """Monta o plain em `largura_desejada` tiles; se o total nao divide, usa a
    maior largura <= desejada que divide (a grade e so para inspecao visual)."""
    nt = len(plain) // MD.TILE_BYTES
    largura = next((w for w in range(min(largura_desejada, nt), 0, -1) if nt % w == 0), 1)
    grades = MD.decode_plain(plain, largura, nt // largura, layout)
    return MD.assemble(grades, largura), largura


def load_rom(caminho, membro=None):
    if zipfile.is_zipfile(caminho):
        with zipfile.ZipFile(caminho) as z:
            nomes = [n for n in z.namelist()
                     if not n.startswith("__MACOSX") and os.path.splitext(n)[1].lower()
                     in (".bin", ".md", ".gen", ".smd")] or z.namelist()
            alvo = membro or nomes[0]
            return z.read(alvo), alvo
    return open(caminho, "rb").read(), os.path.basename(caminho)


def recursos_confirmados(doc):
    out = []
    for tabela in doc.get("tabelas_com_recursos", []):
        for r in tabela.get("recursos", []):
            ce = r.get("confirmacao_externa")
            if not isinstance(ce, dict) or ce.get("status") != "byte-identico":
                continue
            if ce.get("oracle_sha256") != r.get("output_sha256"):
                continue                      # so o que a referencia confirmou
            out.append((tabela["tabela_offset"], r))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--localizar", required=True)
    ap.add_argument("--rom")
    ap.add_argument("--membro")
    ap.add_argument("--codec", default="nemesis")
    ap.add_argument("--out", required=True)
    ap.add_argument("--render", default=None,
                    help="diretorio LOCAL (fora do Git) para escrever os PNGs das duas hipoteses")
    a = ap.parse_args(argv)

    doc_loc = json.load(open(a.localizar))
    origem = doc_loc.get("origem", {})
    caminho = a.rom or origem.get("arquivo") or doc_loc["rom"].get("caminho")
    if not caminho:
        raise SystemExit("[erro] o JSON do locator nao registra o caminho da ROM; "
                         "passe --rom")
    rom, membro = load_rom(caminho, a.membro or origem.get("membro"))
    sha = hashlib.sha256(rom).hexdigest()
    esperado = origem.get("sha256_arquivo") or doc_loc["rom"].get("sha256_arquivo")
    if esperado and sha != esperado:
        raise SystemExit(f"[pin] SHA-256 da ROM nao confere com o locator: "
                         f"{sha} != {esperado}")

    medidos, pulos = [], 0
    for tabela_offset, r in recursos_confirmados(doc_loc):
        if r["codec"] != a.codec:
            continue
        alvo = int(r["ponteiro_valor"], 16)
        plain = NEM.decode(rom, max_out=MAX_OUT, work_limit=WORK_LIMIT, offset=alvo)
        if hashlib.sha256(plain.data).hexdigest() != r["output_sha256"]:
            pulos += 1
            continue
        por_largura = {}
        for larg in LARGURAS:
            if len(plain.data) // MD.TILE_BYTES % larg:
                por_largura[larg] = {"veredito": "nao-medivel",
                                     "motivo": "numero de tiles nao e multiplo da largura"}
                continue
            v = MD.verdict_layout(plain.data, larg)
            por_largura[larg] = v
        vereditos = {v["veredito"] for v in por_largura.values()
                     if v["veredito"] != "nao-medivel"}
        prova = None
        if a.render:
            os.makedirs(a.render, exist_ok=True)
            prova = {}
            for layout in MD.LAYOUTS:
                nome = f"{os.path.splitext(os.path.basename(a.out))[0]}-" \
                       f"{alvo:x}-{layout}.png"
                linhas, larg = linhas_do_plain(plain.data, layout)
                sha_png = png_cinza(os.path.join(a.render, nome), linhas)
                prova[layout] = {"caminho": os.path.abspath(os.path.join(a.render, nome)),
                                 "sha256": sha_png, "escala": ESCALA_PNG,
                                 "largura_tiles": larg}
        medidos.append({
            "tabela_offset": tabela_offset,
            "ponteiro_offset": hex(r["ponteiro_offset"]),
            "offset_stream": hex(alvo),
            "variante": r["variant"],
            "bytes_consumidos": r["bytes_consumed"],
            "output_size": len(plain.data),
            "output_sha256": r["output_sha256"],
            "tiles": len(plain.data) // MD.TILE_BYTES,
            "confirmacao_externa": "byte-identico (mdcomp nemcmp)",
            "prova_visual": prova,
            "por_largura": {str(k): v for k, v in por_largura.items()},
            "veredito_unanime": (next(iter(vereditos)) if len(vereditos) == 1 else None),
        })

    unanimes = [m["veredito_unanime"] for m in medidos]
    doc = {
        "schema_version": "rex-corpus-b/md-layout/1",
        "gerado_por": "scripts/rex_corpus_b/measure-md-layout.py",
        "rom": {"caminho": caminho, "membro": membro, "sha256": sha,
                "size_bytes": len(rom),
                "internal_name": doc_loc["rom"].get("internal_name"),
                "product_code": doc_loc["rom"].get("product_code")},
        "insumo": {"localizar": os.path.abspath(a.localizar), "codec": a.codec},
        "criterio": {
            "descricao": "taxa de pares de pixels adjacentes desiguais (horizontal + "
                         "vertical) sobre o plain montado; vence a leitura com taxa "
                         "<= margem x a outra, senao inconclusivo",
            "margem": MD.MARGEM_LAYOUT,
            "larguras_testadas": list(LARGURAS),
            "preso_por_teste": "scripts/rex_corpus_b/test-md-tiles.py (secao 8)",
            "calibrado_em": "verdade de solo sintetica nos dois layouts; o caso em que "
                            "a leitura errada fica mais suave esta preso como negativo "
                            "('limite: caso ambiguo')",
        },
        "recursos": medidos,
        "descartados_decode_divergente": pulos,
        "resumo": {
            "medidos": len(medidos),
            "vereditos": {v: unanimes.count(v) for v in sorted(set(unanimes))},
            "soma_vereditos": sum(unanimes.count(v) for v in set(unanimes)),
        },
        "nota_prova_visual": (
            "Os PNGs sao gerados nas duas hipoteses para inspecao humana; a leitura "
            "que mostra formas coerentes e a que mostra listas verticais rigidas "
            "(assinatura de ler nibble como plano) e registrada em "
            "docs/rex_corpus_b/, com o SHA-256 de cada arquivo."),
        "limitacoes": [
            "A largura real do plain nao e conhecida sem o nametable; o veredito so e "
            "afirmado quando todas as larguras testadas concordam.",
            "O indicador de adjacencia e estatistico: ha imagens (variacao a cada "
            "pixel) em que a leitura errada e mais suave — por isso o criterio pode "
            "responder 'inconclusivo' e responde.",
            "Nada aqui associa paleta, prioridade ou flip a um tile: e so o layout dos "
            "bytes de padrao.",
        ],
    }
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"[layout] {len(medidos)} plain(s) medido(s): "
          + " / ".join(f"{k}={n}" for k, n in doc["resumo"]["vereditos"].items())
          + f"  (soma {doc['resumo']['soma_vereditos']})")
    print(f"evidencia: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
