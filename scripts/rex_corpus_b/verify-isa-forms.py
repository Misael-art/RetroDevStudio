#!/usr/bin/env python3
"""Verifica as CODIFICACOES 68000 que o find-references.py rotula, com um montador real.

O classificador de referencias so pode rotular o que o ISA garante: um rotulo
errado vira falsa evidencia de consumidor. A fonte anterior era uma pagina de
documentacao; aqui a fonte e o `m68k-elf-as` (GNU binutils) OFICIAL do toolchain
SGDK, fixado por SHA-256. Cada forma e montada em um objeto PROPRIO (uma
instrucao por .o, sem ambiguidade de alinhamento), desmontada com
`m68k-elf-objdump -d`, e a primeira word e confrontada com o rotulo EXATO que o
classificador deve produzir (mnemonico + modo + registrador).

A sintaxe e a do GAS, nao a da Motorola: `0x123456` (o `$...` e aceito mas
silenciosamente zerado em `.w`), `1234(%pc)`, registradores `%a0`-`%a5`/`%d0`-`%d7`
(`%a6` e impresso como `%fp` para este alvo).

Uso:
  python3 scripts/rex_corpus_b/verify-isa-forms.py \
      --as CAMINHO/m68k-elf-as --sha256 20342db5... \
      --out data/rex_corpus_b/recursos/isa-forms.json

Saida: JSON com a codificacao medida por forma, o veredito por rotulo e a LACUNA
((d8,PC)) documentada pela propria saida do montador.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# Cada linha: (fonte GAS, modo esperado, classe do classificador, rotulo EXATO).
# Operandos fixos: absoluto longo 0x123456, absoluto curto 0x1234 (positivo, para o
# valor de 16 bits nao virar endereco negativo), deslocamento 0x1234 relativo ao PC.
FORMAS = [
    ("lea       0x123456, %a0", "(xxx).L", "classify", "lea (xxx).L,a0"),
    ("lea       0x123456, %a1", "(xxx).L", "classify", "lea (xxx).L,a1"),
    ("lea       0x123456, %a6", "(xxx).L", "classify", "lea (xxx).L,a6"),
    ("movea.l   0x123456, %a0", "(xxx).L", "classify", "movea.l (xxx).L,a0"),
    ("movea.l   0x123456, %a3", "(xxx).L", "classify", "movea.l (xxx).L,a3"),
    ("move.l    0x123456, %d0", "(xxx).L", "classify", "move.l (xxx).L,d0"),
    ("move.l    0x123456, %d7", "(xxx).L", "classify", "move.l (xxx).L,d7"),
    ("jsr       0x123456", "(xxx).L", "classify", "jsr (xxx).L"),
    ("jmp       0x123456", "(xxx).L", "classify", "jmp (xxx).L"),
    ("lea       0x1234.w, %a0", "(xxx).W", "classify_abs_w", "lea (xxx).W,a0"),
    ("lea       0x1234.w, %a6", "(xxx).W", "classify_abs_w", "lea (xxx).W,a6"),
    ("movea.l   0x1234.w, %a0", "(xxx).W", "classify_abs_w", "movea.l (xxx).W,a0"),
    ("move.l    0x1234.w, %d0", "(xxx).W", "classify_abs_w", "move.l (xxx).W,d0"),
    ("jsr       0x1234.w", "(xxx).W", "classify_abs_w", "jsr (xxx).W"),
    ("jmp       0x1234.w", "(xxx).W", "classify_abs_w", "jmp (xxx).W"),
    ("lea       0x1234(%pc), %a0", "(d16,PC)", "classify_pcrel", "lea (d16,PC),a0"),
    ("lea       0x1234(%pc), %a6", "(d16,PC)", "classify_pcrel", "lea (d16,PC),a6"),
    ("movea.l   0x1234(%pc), %a0", "(d16,PC)", "classify_pcrel", "movea.l (d16,PC),a0"),
    ("move.l    0x1234(%pc), %d0", "(d16,PC)", "classify_pcrel", "move.l (d16,PC),d0"),
    ("jsr       0x1234(%pc)", "(d16,PC)", "classify_pcrel", "jsr (d16,PC)"),
    ("jmp       0x1234(%pc)", "(d16,PC)", "classify_pcrel", "jmp (d16,PC)"),
]

# LACUNAS: formas que o scanner NAO rotula. A evidencia de que elas ficam fora e a
# saida do proprio montador, medida aqui — nao uma escolha de quem escreveu a
# ferramenta. `12(%pc)` pede um deslocamento de 8 bits; o GAS emite a forma de 16.
LACUNAS = [
    ("lea       12(%pc), %a0",
     "pedido de (d8,PC); o GAS emite d16 (41fa 000c), entao NAO ha codificacao "
     "(d8,PC) confirmada para este alvo — o modo fica fora do catalogo."),
    ("movea.l   12(%pc), %a0",
     "mesmo pedido de 8 bits na familia movea.l; sem encoding confirmado, "
     "a word 0x2070 nao pode ser rotulada."),
]
# Words que PADRIA-SE (d8,PC): nenhuma classe catalogada pode rotula-las.
NAO_CATALOGADAS = [0x41F0, 0x2070, 0x4EF0, 0x4BF0]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def measure(as_bin, objdump, src_line, out_dir, extra_as=()):
    """Monta UMA instrucao e devolve (bytes_cruus, texto_desmontado).

    Um objeto por forma elimina a ambiguidade de onde cada instrucao comeca; se o
    montador recusar a forma, o erro dele e reportado cru (nao maquiado).
    """
    s = os.path.join(out_dir, "f.s")
    o = os.path.join(out_dir, "f.o")
    with open(s, "w") as f:
        f.write("\t.text\n" + src_line + "\n")
    r = run([as_bin, "-m68000", *extra_as, "-o", o, s])
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip())
    d = run([objdump, "-d", o])
    if d.returncode:
        raise ValueError((d.stderr or d.stdout).strip())
    achadas, textos = [], []
    # Formato medido do objdump deste toolchain (cat -A):
    #     "   0:\t41f9 0012 3456 \tlea 0x123456,%a0"
    # os bytes vem AGRUPADOS POR WORD, nao por byte — separar por TAB e o unico
    # parse que nao confunde o mnemonico com hex.
    for ln in d.stdout.splitlines():
        partes = ln.split("\t")
        if len(partes) >= 3 and re.match(r"^\s*[0-9a-f]+:\s*$", partes[0]):
            achadas.append(partes[1].strip().replace(" ", ""))
            textos.append(partes[2].strip())
    if not achadas:                                   # variante sem TAB
        solta = re.compile(r"^\s*[0-9a-f]+:\s+((?:[0-9a-f]{2,4} ){1,4})\s*(\S.*)$")
        for ln in d.stdout.splitlines():
            m = solta.match(ln)
            if m:
                achadas.append(m.group(1).strip().replace(" ", ""))
                textos.append(m.group(2).strip())
    if len(achadas) != 1:
        raise ValueError(f"esperava 1 instrucao, desmontagem deu {len(achadas)}: {textos}")
    return achadas[0], textos[0]


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--as", dest="as_bin", required=True)
    ap.add_argument("--objdump")
    ap.add_argument("--sha256", required=True, help="SHA-256 esperado do binario do montador")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    medido = sha256(a.as_bin)
    if medido != a.sha256:
        raise SystemExit(f"[pin] SHA-256 do montador nao confere: esperado {a.sha256} "
                         f"obtido {medido}")
    objdump = a.objdump or os.path.join(os.path.dirname(a.as_bin), "m68k-elf-objdump")
    if not os.path.isfile(objdump):
        raise SystemExit(f"[erro] objdump nao encontrado em {objdump}")
    medido_obj = sha256(objdump)

    spec = importlib.util.spec_from_file_location("fref", os.path.join(HERE, "find-references.py"))
    F = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(F)
    classificadores = {"classify": F.classify, "classify_abs_w": F.classify_abs_w,
                       "classify_pcrel": F.classify_pcrel}
    # Se o classificador ganhar um rotulo (d8,PC) de novo sem encoding confirmado,
    # esta lista quebra primeiro — a lacuna e vigiada, nao assumida.
    if hasattr(F, "classify_d8pc"):
        raise SystemExit("[isa] o classificador voltou a expor classify_d8pc sem "
                         "codificacao confirmada pelo montador")

    regs = []
    vereditos = {"confirmadas": 0, "divergentes": 0, "sem_rotulo": 0, "nao_montaveis": 0}
    with tempfile.TemporaryDirectory(prefix="rex-isa-") as tmp:
        for fonte, modo, classe, esperado in FORMAS:
            try:
                bruto, texto = measure(a.as_bin, objdump, fonte, tmp)
            except ValueError as e:
                regs.append({"fonte": fonte, "modo": modo, "erro": f"montador recusou: {e}"})
                vereditos["nao_montaveis"] += 1
                continue
            word = int(bruto[:4], 16)
            rotulo = classificadores[classe](word)
            registro = {
                "fonte": fonte, "modo": modo, "classe": classe,
                "rotulo_esperado": esperado, "codificado": bruto,
                "primeira_word": format(word, "04x"),
                "campo_ea": format(word & 0x3F, "02x"),
                "desmontagem": texto, "rotulo_do_classificador": rotulo,
            }
            if rotulo is None:
                registro["veredito"] = "SEM-ROTULO (lacuna do classificador)"
                vereditos["sem_rotulo"] += 1
            elif rotulo != esperado:
                registro["veredito"] = f"DIVERGENTE (classificador disse {rotulo!r})"
                vereditos["divergentes"] += 1
            else:
                registro["veredito"] = "CONFIRMADO"
                vereditos["confirmadas"] += 1
            regs.append(registro)

        lacunas = []
        for fonte, motivo in LACUNAS:
            try:
                bruto, texto = measure(a.as_bin, objdump, fonte, tmp)
            except ValueError as e:
                lacunas.append({"fonte": fonte, "erro": f"montador recusou: {e}",
                                "conclusao": "na ha encoding — forma fica fora do catalogo"})
                continue
            word = int(bruto[:4], 16)
            rotulos = {n: c(word) for n, c in classificadores.items()}
            lacunas.append({"fonte": fonte, "codificado": bruto, "desmontagem": texto,
                            "primeira_word": format(word, "04x"),
                            "rotulos_do_catalogo": {k: v for k, v in rotulos.items() if v},
                            "conclusao": motivo})

    negativas = {format(w, "04x"): {n: c(w) for n, c in classificadores.items() if c(w)}
                 for w in NAO_CATALOGADAS}

    doc = {
        "schema_version": "rex-corpus-b/isa-forms/1",
        "gerado_por": "scripts/rex_corpus_b/verify-isa-forms.py",
        "montador": {"caminho": a.as_bin, "sha256": medido,
                     "versao": run([a.as_bin, "--version"]).stdout.splitlines()[0],
                     "flags": ["-m68000"]},
        "desmontador": {"caminho": objdump, "sha256": medido_obj},
        "metodo": "uma instrucao por objeto montado e desmontado; a primeira word e "
                  "confrontada com o rotulo exato do classificador (mnemonico + modo + "
                  "registrador). Sintaxe GAS: 0x..., 0x1234.w, 0x1234(%pc), %a0-%a6/%d0-%d7.",
        "cpu_alvo": "m68000",
        "vereditos": vereditos,
        "formas": regs,
        "lacunas": lacunas,
        "palavras_nao_catalogadas": negativas,
        "correcao_mensurada": {
            "antes": "jmp (d16,PC) = 0x4EDA (registrado em notas antigas)",
            "depois": "jmp (d16,PC) = 0x4EFA (medido: `jmp 0x1234(%pc)` -> 4efa 04d2)",
            "consequencia": "0x4EDA nao e jmp pc-relativo; o catalogo monta a forma por "
                            "base|ea e por isso nao carrega o rotulo errado.",
        },
        "limite": "Confere so as formas usadas pelo classificador. Regras de outros "
                  "modos de enderecamento ((a0,d16), (d8,PC,Xi), (xxx).W com sinal, "
                  "modo registrador) nao sao verificadas aqui e continuam fora do scanner. "
                  "Isto prova a CODIFICACAO, nao a semantica da rotina que executa o load.",
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"[isa] {vereditos['confirmadas']} confirmadas / {vereditos['divergentes']} "
          f"divergentes / {vereditos['sem_rotulo']} sem rotulo / "
          f"{vereditos['nao_montaveis']} nao montaveis  ({doc['montador']['versao']})")
    for r_ in regs:
        if r_.get("veredito") != "CONFIRMADO":
            print("  ", json.dumps(r_, ensure_ascii=False))
    for l_ in lacunas:
        print("  [lacuna]", l_["fonte"], "->", l_.get("codificado", "-"),
              l_.get("desmontagem", ""), l_.get("rotulos_do_catalogo", {}))
    return 1 if (vereditos["divergentes"] or vereditos["sem_rotulo"]
                 or vereditos["nao_montaveis"]) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
