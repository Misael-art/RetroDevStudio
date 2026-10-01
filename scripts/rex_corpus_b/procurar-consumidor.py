#!/usr/bin/env python3
"""Varrida REPRODUZIVEL de formas de consumo 68000 sobre tabelas de ponteiros.

A pergunta: existe codigo que CARREGA as entradas de uma tabela (consumidor)?
O `find-references.py` cobre absoluto (.W/.L) e (d16,PC). Este script soma as
formas indexadas que ficavam como ponto cego declarado:

  (i)   (d8,PC,Xi)   — opcode das familias lea/movea.l/move.l com ea 0x3B,
                       extensao breve do 68000 (sem escala; ver extensao_breve);
                       alvo = pc + disp8 + Xn, com Xn em D0..D7/A0..A6 (x1);
  (ii)  base+indice  — carga absoluta longa (lea/movea.l) de uma BASE B em
                       [tabela-0x400, tabela], seguida dentro de 64 bytes por
                       (d8,An,Xi) ou (d16,An) cujo endereco computado caia
                       exatamente numa entrada da tabela.

Um endereco so e contado se a instrucao e de familia CATALOGADA (codificacao
confirmada contra o montador do toolchain; ver isa-forms.json). O resultado e
evidencia de NEGATIVO DELIMITADO: "nao ha consumidor NAS FORMAS VARRIDAS" —
nunca prova de ausencia de consumidor (lacunas listadas na saida).

Uso:
  python3 scripts/rex_corpus_b/procurar-consumidor.py --rom CAMINHO \
      --tabela 0x1b64c --tamanho 24 \
      [--entrada 0x65432 ...] \
      --out data/rex_corpus_b/recursos/consumidor-<nome>.json
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import struct
import sys
import tempfile
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
JANELA_POS_CARGA = 64
FAIXA_BASE = 0x400

# familias catalogadas, codificacao confirmada em isa-forms.json:
#   lea      0100 xxx 111 MMM RRR -> (op & 0xF1C0) == 0x41C0
#   movea.l  0010 xxx 011 MMM RRR -> (op & 0xF1C0) == 0x2040
#   move.l   0011 xxx 000 MMM RRR -> (op & 0xF1C0) == 0x2000
FAM_LEA = 0x41C0
FAM_MOVEA = 0x2040
FAM_MOVEL = 0x2000
ABS_L_OPS = (0x41F9, 0x43F9, 0x45F9, 0x47F9, 0x49F9, 0x4BF9, 0x4DF9, 0x4FF9,
             0x2079, 0x2179, 0x2279, 0x2379, 0x2479, 0x2579, 0x2679, 0x2779)

# extensao breve do 68000, fixada CONTRA O MONTADOR (m68k-elf-as -m68000):
#   movea.l (0,a5,d0.w),a0  = 2075 0000      movea.l (a5,a1.w),a0 = 2075 9000
#   movea.l (2,a5,d0.w),a0  = 2075 0002      movea.l (4,a5,a2.l),a1 = 2275 a804
#   movea.l (8,a5,d1.w),a3  = 2675 1008      movea.l (-2,a5,d0.w),a0 = 2075 00fe
#   movea.l (a5,d0.l),a0    = 2075 0800      movea.l (a5,d7.w),a0 = 2075 7000
# ou seja: bit15 = indice e Areg; bits 14-12 = registrador; bit 11 = 1=LONG;
# bits 10-8 = 0; bits 7-0 = disp8 ASSINADO. NAO existe campo de escala no
# 68000 (`needs cpu32 or 68020 or higher` do montador) —indice e sempre x1.
MASCARA_BRIEF_LIVRE = 0x0700


def _familia(op):
    for familia in (FAM_LEA, FAM_MOVEA, FAM_MOVEL):
        if (op & 0xF1C0) == familia:
            return familia
    return None


def carregar_rom(caminho):
    if zipfile.is_zipfile(caminho):
        with zipfile.ZipFile(caminho) as z:
            nomes = [n for n in z.namelist() if not n.startswith("__MACOSX")]
            cand = [n for n in nomes
                    if os.path.splitext(n)[1].lower() in (".bin", ".md", ".gen", ".smd")] or nomes
            melhor = max(cand, key=lambda n: z.getinfo(n).file_size)
            return z.read(melhor)
    return open(caminho, "rb").read()


def w16(rom, o):
    return int.from_bytes(rom[o:o + 2], "big")


def extensao_breve(rom, p):
    """Extensao (d8,An,Xi) do 68000 na posicao p.

    Devolve (disp8, reg, e_endereco, e_long) ou None se a word de extensao nao
    cabe no formato breve do 68000 (bits 10-8 diferentes de 0)."""
    if p + 4 > len(rom):
        return None
    ext = w16(rom, p + 2)
    if ext & MASCARA_BRIEF_LIVRE:
        return None
    disp = ext & 0xFF
    disp8 = disp - 256 if disp >= 0x80 else disp
    reg = (ext >> 12) & 7
    return disp8, reg, bool(ext & 0x8000), bool(ext & 0x0800)


def varrer_indexada_pc(rom, entradas):
    hits = []
    varridos = 0
    for p in range(0, len(rom) - 4):
        op = w16(rom, p)
        if (op & 0x3F) != 0x3B:
            continue
        if _familia(op) is None:
            continue
        varridos += 1
        ext = extensao_breve(rom, p)
        if ext is None:
            continue
        disp8, _reg, _addr, _long = ext
        base = p + 2 + disp8
        for xn in range(0, 64):
            alvo = base + xn            # 68000: indice sempre x1
            if alvo in entradas:
                hits.append({"offset": hex(p), "opcode": hex(op), "disp8": disp8,
                             "xn": xn, "alvo": hex(alvo)})
    return hits, varridos


def varrer_base_mais_indice(rom, tabela, entradas):
    hits = []
    bases = []
    lo, hi = tabela - FAIXA_BASE, tabela + FAIXA_BASE
    for q in range(0, len(rom) - 6):
        op = w16(rom, q)
        if op not in ABS_L_OPS:
            continue
        base = int.from_bytes(rom[q + 2:q + 6], "big")
        if not (lo <= base <= hi):
            continue
        bases.append({"offset": hex(q), "opcode": hex(op), "base": hex(base)})
        for p in range(q + 6, min(q + 6 + JANELA_POS_CARGA, len(rom) - 4)):
            iop = w16(rom, p)
            ea = iop & 0x3F
            if _familia(iop) is None:
                continue
            if 0x30 <= ea <= 0x37:
                ext = extensao_breve(rom, p)
                if ext is None:
                    continue
                disp, _reg, _addr, _long = ext
                for xn in range(0, 64):
                    alvo = base + disp + xn     # 68000: indice sempre x1
                    if alvo in entradas:
                        hits.append({"carga": hex(q), "instrucao": hex(p),
                                     "forma": "(d8,An,Xi)", "disp": disp,
                                     "xn": xn, "alvo": hex(alvo)})
            elif 0x28 <= ea <= 0x2F:
                disp = w16(rom, p + 2)
                alvo = base + disp
                if alvo in entradas:
                    hits.append({"carga": hex(q), "instrucao": hex(p),
                                 "forma": "(d16,An)", "disp": disp, "alvo": hex(alvo)})
    return hits, bases


def rodar_find_references(rom_path, enderecos, tmpdir):
    """Reusa o scanner catalogado (absoluto + d16,PC) IN-PROCESS via sys.argv."""
    spec = importlib.util.spec_from_file_location("fr", HERE / "find-references.py")
    FR = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(FR)
    saida = pathlib.Path(tmpdir) / "refs.json"
    argv_original = sys.argv
    try:
        sys.argv = ["find-references.py", "--rom", str(rom_path), "--out", str(saida)]
        for e in enderecos:
            sys.argv += ["--addr", e]
        FR.main()
    finally:
        sys.argv = argv_original
    return json.loads(saida.read_text())


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rom", required=True)
    ap.add_argument("--nome", required=True)
    ap.add_argument("--tabela", action="append", required=True,
                    help="base da tabela (hex); repita para varias")
    ap.add_argument("--tamanho", type=lambda x: int(x, 0), default=None,
                    help="tamanho da tabela em bytes (default: 1 entrada por tabela)")
    ap.add_argument("--entrada", action="append", default=[],
                    help="endereco de entrada a conferir nos hits (hex); repitivel")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    out_path = pathlib.Path(args.out).resolve()
    if not (out_path == ROOT or out_path.is_relative_to(ROOT)):
        raise SystemExit(f"[caminho] --out fora da arvore: {args.out}")

    rom_path = pathlib.Path(args.rom).resolve()
    if not rom_path.exists():
        raise SystemExit(f"[rom] ausente: {args.rom}")
    rom = carregar_rom(str(rom_path))

    alvos = []
    with tempfile.TemporaryDirectory(prefix="rex-b-consumidor-") as tmp:
        for t in args.tabela:
            tabela = int(t, 16)
            n = (args.tamanho // 4) if args.tamanho else 1
            entradas = {tabela + 4 * i for i in range(max(n, 1))}
            for e in args.entrada:
                v = int(e, 16)
                if tabela <= v < tabela + (args.tamanho or 0x1000):
                    entradas.add(v)
            refs = rodar_find_references(rom_path, [hex(x) for x in sorted(entradas)] + [hex(tabela)], tmp)
            idx_hits, idx_varridos = varrer_indexada_pc(rom, entradas)
            bi_hits, bases = varrer_base_mais_indice(rom, tabela, entradas)
            por_endereco = {}
            for a in refs.get("enderecos", []):
                por_endereco[a["endereco"]] = {
                    "absoluto_ocorrencias": a["absoluto"]["total_ocorrencias"],
                    "absoluto_classificadas": a["absoluto"]["instrucoes_classificadas_na_area_de_programa"],
                    "pc_relativo_candidatos": a["pc_relativo"]["total"],
                    "pc_relativo_classificadas": a["pc_relativo"]["instrucoes_classificadas"],
                }
            alvos.append({
                "tabela": hex(tabela),
                "entradas": sorted(hex(x) for x in entradas),
                "find_references": por_endereco,
                "indexada_pc_d8": {"hits": idx_hits, "instrucoes_varridas": idx_varridos},
                "base_mais_indexada": {"cargas_base": bases, "hits": bi_hits},
                "consumidor_localizado": bool(idx_hits or bi_hits),
            })

    doc = {
        "schema_version": "rex-corpus-b/consumidor-negativo/1",
        "gerado_por": "scripts/rex_corpus_b/procurar-consumidor.py",
        "rom": {"caminho": str(rom_path), "sha256": hashlib.sha256(rom).hexdigest(),
                "size_bytes": len(rom)},
        "formas_varridas": [
            "absoluto .W/.L com classificacao de opcode (find-references.py)",
            "(d16,PC) por aritmetica de deslocamento (find-references.py)",
            "(d8,PC,Xi) com familias catalogadas (esta ferramenta)",
            "carga absoluta longa de base em [tabela-0x400, tabela] + (d8,An,Xi)/(d16,An) em 64 bytes (esta ferramenta)",
        ],
        "lacunas_declaradas": [
            "(d8,An,Xi)/(d16,An) com base carregada FORA da janela de 64 bytes ou por caminho indireto (RAM)",
            "tabelas alcancadas por vetor de salto com base em registrador",
            "indice maior que 63",
            "ausencia de hit NAO prova ausencia de consumidor",
        ],
        "alvos": alvos,
        "conclusao": ("consumidor-localizado" if any(a["consumidor_localizado"] for a in alvos)
                      else "consumidor-nao-localizado-nas-formas-varridas"),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"[consumidor] {doc['conclusao']}")
    print("evidencia:", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
