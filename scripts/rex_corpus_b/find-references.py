#!/usr/bin/env python3
"""Procura ONDE O CODIGO DA ROM referencia um endereco absoluto (evidencia de consumidor).

A pergunta que o locator nao responde: quem CONSUME a tabela apontada. Em 68000,
tabelas de ponteiros em ROM sao alcancadas por `lea`/`movea` com endereco absoluto
longo (`lea 0x1B64C,%a0`), absoluto curto (`(xxx).W`), ou relativo ao PC
(`(d16,PC)`). Este script varre a ROM (somente-leitura) atras das 4 bytes
big-endian do endereco, enumera os sitios pc-relativos cujo alvo calculado bate,
e rotula o opcode quando ele casa com as formas catalogadas (ver `MODOS` e `FAM`
abaixo, conferidas word a word contra o montador do toolchain):

  lea      0100 ddd 1 11 MMM RRR  -> 0x41C0 | modo   (ddd em 11-9, A7 invalido)
  movea.l  0010 ddd 0 11 MMM RRR  -> 0x2040 | modo
  move.l   0011 ddd 0 00 MMM RRR  -> 0x2000 | modo
  jsr/jmp  sem campo de registrador nas formas absolutas

Qualquer outro par de bytes e registrado como `opcode-nao-classificado` com os
bytes crus ao redor: a ocorrencia e um CANDIDATO de referencia, nao uma prova de
consumo. O operador (ou a proxima etapa de desmontagem) decide.

Uso:
  python3 scripts/rex_corpus_b/find-references.py --rom CAMINHO \
      --addr 0x1b64c --addr 0x4100 [--out data/rex_corpus_b/recursos/x.json]
  ... --tabelas 0x1b600-0x1b670   # inventario do que os carregamentos apontam
"""
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MAX_HITS_PER_ADDR = 40


def load_rom(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if not n.startswith("__MACOSX")]
            cand = [n for n in names if os.path.splitext(n)[1].lower() in (".bin", ".md", ".gen", ".smd")] or names
            best = max((z.getinfo(n) for n in cand), key=lambda i: i.file_size)
            return z.read(best.filename), {"kind": "zip", "member": best.filename,
                                           "member_size": best.file_size,
                                           "member_crc32": format(best.CRC, "08x")}
    return open(path, "rb").read(), {"kind": "raw", "member": os.path.basename(path),
                                     "member_size": os.path.getsize(path)}


# --- ISA 68000: campos verificados, nao lembrados -------------------------------
# Fonte do campo de modo de endereco: tabela de modos do 68000, modo 111 (palavra
# de extensao) com campo de registrador: 000 = (xxx).W, 001 = (xxx).L, 010 = (d16).PC,
# 100 = imediato. (https://www.thedigitalcatonline.com/blog/2019/03/04/
# motorola-68000-addressing-modes/, consultado em 2026-09-30.)
# Posicoes de campo (derivadas da forma canonica de cada familia):
#   MOVE   : bits 15-14=00, 13-12=tamanho (10=.L), 11-9=registrador de destino
#            (passo 0x200), 8-6=modo do destino, 5-0=modo/registrador da fonte.
#   MOVEA  : mesmo campo ddd em 11-9 (passo 0x200), modo de destino 011.
#   LEA    : 0100 ddd(11-9) 1 11 MMM RRR -> passo 0x200.
#   JSR/JMP: sem campo de registrador na forma absoluta (0x4EB9 / 0x4EF9).
FIELD_D = 7 << 9      # bits 11-9: registrador de destino de MOVE/MOVEA/LEA
# Campos de modo (bits 5-0) CONFIRMADOS contra o montador do toolchain por
# verify-isa-forms.py (SAIDA data/rex_corpus_b/recursos/isa-forms.json). Nada entra
# aqui sem codificacao montada e desmontada: um rotulo errado vira falsa evidencia.
# (d8,PC) (modo 110 registrador 000, ea 0x30) FOI EXCLUVIDO: `lea 12(%pc),%a0` e
# montado como d16 (`41fa 000c`) ate sob -m68010, entao nao ha codificacao d8,PC
# confirmada para este alvo. Ele permanece LACUNA DOCUMENTADA, nao forma suportada.
MODOS = {0x38: "(xxx).W", 0x39: "(xxx).L", 0x3A: "(d16,PC)"}
FAM = {0x41C0: ("lea", "a", 6), 0x2040: ("movea.l", "a", 6),
       0x2000: ("move.l", "d", 7), 0x4E80: ("jsr", None, None),
       0x4EC0: ("jmp", None, None)}
# Tamanho do operando por modo, em bytes apos a word do opcode.
SPAN = {0x38: 2, 0x39: 4, 0x3A: 2}


def _ea(word):
    return word & 0x3F


def _forma(word, ea):
    """Rotulo de uma das familias catalogadas para o modo de enderecamento `ea`.

    `None` significa "nao catalogado por esta ferramenta", NAO "nao e instrucao".
    CMP nao e rotulado: a posicao exata do campo de registrador nao foi verificada
    contra o montador, e um rotulo errado aqui viraria falsa evidencia de consumidor.
    """
    if _ea(word) != ea:
        return None
    base = word & ~FIELD_D & 0xFFFF
    reg = (word >> 9) & 7
    for fam_base, (nome, letra, max_reg) in FAM.items():
        if letra is None:
            # JSR/JMP nao tem campo de registrador: o bit 11 e parte do opcode,
            # entao a comparacao e com a word inteira, nao com a mascara ddd=0.
            if word == fam_base | ea:
                return f"{nome} {MODOS[ea]}"
            continue
        if base == fam_base | ea:
            return f"{nome} {MODOS[ea]},{letra}{reg}" if reg <= max_reg else None
    return None


def classify(word):
    """(xxx).L — absoluto de 32 bits (modo 111, registrador 001)."""
    return _forma(word, 0x39)


def classify_abs_w(word):
    """(xxx).W — absoluto de 16 bits (modo 111, registrador 000).

    So alcanca enderecos ate $7FFF com sinal: para alvo acima de $FFFF esta forma
    esta fisicamente fora de jogo, o que e uma deducao, nao uma ausencia de busca.
    """
    return _forma(word, 0x38)


def classify_pcrel(word):
    """(d16,PC) — deslocamento de 16 bits relativo ao PC (modo 111, registrador 010)."""
    return _forma(word, 0x3A)


def _alvo(data, off, ea):
    """Operando cru e alvo calculado para uma forma catalogada em `off`.

    Retorna (operando_hex, alvo_hex) ou (None, None) se o arquivo nao contem o
    operando inteiro — truncado nao vira alvo inventado.
    """
    span = SPAN[ea]
    if off + 2 + span > len(data):
        return None, None
    bruto = data[off + 2:off + 2 + span]
    if ea == 0x39:
        v = int.from_bytes(bruto, "big")
        return "0x" + bruto.hex(), hex(v)
    if ea == 0x38:
        v = int.from_bytes(bruto, "big")
        v = v - 0x10000 if v >= 0x8000 else v          # (xxx).W e com sinal
        return "0x" + bruto.hex(), hex(v & 0xFFFFFFFF)
    d = int.from_bytes(bruto, "big")
    d = d - 0x10000 if d >= 0x8000 else d
    return "0x" + bruto.hex(), hex((off + 2 + d) & 0xFFFFFFFF)


def table_loads(data, prog_lo, prog_hi, alvo_lo=None, alvo_hi=None):
    """Inventario do que cada instrucao catalogada APONTA dentro da area de programa.

    Inverte a pergunta do find_ref/find_pcrel: em vez de 'quem cita o endereco X',
    'para onde apontam os carregamentos de tabela que existem'. Serve a duas
    coisas: achar o consumidor de uma tabela cujo endereco nao grafa no arquivo, e
    medir quantos carregamentos catalogados ha de fato (se nao ha nenhum, a pesquisa
    negativa e sobre a ferramenta, nao sobre a ROM).
    """
    out = []
    off = prog_lo & ~1
    while off + 2 <= min(prog_hi, len(data)):
        word = int.from_bytes(data[off:off + 2], "big")
        for ea in MODOS:
            forma = _forma(word, ea)
            if forma is None:
                continue
            operando, alvo = _alvo(data, off, ea)
            if alvo is None:
                continue
            v = int(alvo, 16)
            if alvo_lo is not None and not (alvo_lo <= v <= alvo_hi):
                continue
            out.append({"offset": hex(off), "opcode": format(word, "04x"),
                        "forma": forma, "operando": operando, "alvo": alvo})
            break
        off += 2
    return out


def parse_janela(s):
    """'0x50430-0x506a0' -> (0x50430, 0x506a0). Um unico traco, extremos numericos.

    Recusa janela invertida: uma janela fim<inicio nao erro de escrita, e uma
    pesquisa que nao pode casar nada — ela produziria um falso negativo.
    """
    if s.count("-") != 1:
        raise ValueError(f"janela deve ser INICIO-FIM (um traco), recebido {s!r}")
    lo_s, hi_s = s.split("-")
    try:
        lo, hi = int(lo_s, 0), int(hi_s, 0)
    except ValueError:
        raise ValueError(f"extremos de janela nao numericos: {s!r}") from None
    if hi < lo:
        raise ValueError(f"janela invertida (fim < inicio): {s!r}")
    return lo, hi


def inventario(data, prog_lo, prog_hi, janelas):
    """Documento do modo --tabelas: cargas catalogadas + o que cai em cada janela.

    `cargas_total` e medido SEM filtro de proposito: e ele que diz se uma janela
    vazia e ausencia de consumidor na ROM ou ausencia de carga catalogada na
    ferramenta.
    """
    cargas = table_loads(data, prog_lo, prog_hi)
    out = {"cargas_total": len(cargas), "janelas": []}
    for lo, hi in janelas:
        sitios = table_loads(data, prog_lo, prog_hi, lo, hi)
        por_forma = {}
        for s_ in sitios:
            por_forma[s_["forma"]] = por_forma.get(s_["forma"], 0) + 1
        out["janelas"].append({"janela": f"{hex(lo)}-{hex(hi)}", "total": len(sitios),
                               "por_forma": por_forma,
                               "sitios": sitios[:MAX_HITS_PER_ADDR],
                               "omitidos": max(0, len(sitios) - MAX_HITS_PER_ADDR)})
    return out


def find_pcrel_candidates(data, addr, prog_lo, prog_hi):
    """Enumera SITS cujos (opcode, disp16) apontam para `addr`, sem assumir opcode.

    A descoberta e independente do catalogo de opcodes: qualquer par em fronteira de
    palavra cujo alvo calculado seja o endereco consultado e reportado, com a palavra
    crua; a classificacao e so um rotulo quando o ISA e conhecido.
    """
    out = []
    lo = max(0, prog_lo) & ~1
    hi = min(prog_hi, len(data) - 3)
    for off in range(lo, hi + 1, 2):
        disp = struct.unpack(">h", data[off + 2:off + 4])[0]
        if off + 2 + disp != addr:
            continue
        word = struct.unpack(">H", data[off:off + 2])[0]
        out.append({"offset": hex(off), "opcode": hex(word),
                    "candidato_instrucao": classify_pcrel(word),
                    "disp": hex(disp), "alvo": hex(addr),
                    "antes": data[max(0, off - 8):off].hex(),
                    "depois": data[off + 4:off + 16].hex()})
    return out


def find_ref(data, addr, prog_lo, prog_hi):
    pat = struct.pack(">I", addr)
    hits = []
    for m in re.finditer(re.escape(pat), data):
        off = m.start()
        if off < 2:
            continue
        word = struct.unpack(">H", data[off - 2:off])[0]
        kind = classify(word)
        in_prog = prog_lo <= off < prog_hi
        hits.append({
            "offset": hex(off),
            "opcode_anterior": hex(word),
            "candidato_instrucao": kind,
            "na_area_de_programa_declarada": in_prog,
            "antes": data[max(0, off - 10):off].hex(),
            "depois": data[off + 4:off + 20].hex(),
        })
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", required=True)
    ap.add_argument("--addr", action="append", default=[],
                    help="endereco absoluto a citar (repetivel)")
    ap.add_argument("--tabelas", action="append", default=[],
                    metavar="INICIO-FIM",
                    help="janela de tabela: inventaria as cargas catalogadas que apontam "
                         "para ela (inverte a pergunta do --addr)")
    ap.add_argument("--nome", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    if not a.addr and not a.tabelas:
        ap.error("forneca --addr e/ou --tabelas")

    data, prov = load_rom(a.rom)
    base = 0x0
    if data[:4] == b"SEGA":
        base = 0
    prog_lo = int.from_bytes(data[0x1A0:0x1A4], "big") if len(data) > 0x1A4 else 0
    prog_hi_raw = int.from_bytes(data[0x1A4:0x1A8], "big") if len(data) > 0x1A8 else 0
    prog_hi = min(prog_hi_raw + 1, len(data)) if prog_hi_raw else len(data)

    doc = {
        "schema_version": 1,
        "gerado_por": "scripts/rex_corpus_b/find-references.py",
        "metodo": "duas passadas: (1) padrao de 4 bytes big-endian do endereco absoluto, com "
                  "classificacao do opcode anterior pelo ISA publico 68000; (2) instrucoes "
                  "lea/movea.l/move.l com deslocamento de 16 bits relativo ao PC cujo alvo "
                  "calculado e o endereco consultado. Com --tabelas soma-se a passada (3): "
                  "inventario de TODAS as cargas catalogadas e das que apontam para cada "
                  "janela, na direcao oposta a das passadas 1-2",
        "rom": {"caminho": a.rom, "nome": a.nome or os.path.basename(a.rom),
                "sha256_arquivo": hashlib.sha256(data).hexdigest(),
                "size_bytes": len(data), "procedencia_interna": prov,
                "internal_name": data[0x120:0x12C].decode("latin1").strip("\x00 ").strip() or None,
                "product_code": data[0x180:0x18E].decode("latin1").strip("\x00 ").strip() or None,
                "programa_declarado": [hex(prog_lo), hex(prog_hi)]},
        "enderecos": [],
        "limitacoes": [
            "Uma ocorrencia dos 4 bytes de um endereco pode ser dado coincidente; so a "
            "classificacao de opcode + contexto indica instrucao real.",
            "O passo absoluto so casa operando (xxx).L (4 bytes). Formas (xxx).W, modo "
            "registrador, (d8,PC), (d16,PC,Xi)/(d8,PC,Xi) com indice, tabelas indexadas "
            "a partir de um registrador base e salto via vetor NAO sao detectadas; "
            "ausencia de ocorrencia NAO e prova de ausencia de consumidor.",
            "(d8,PC) (modo 110 registrador 000) esta FORA do catalogo porque o montador "
            "do toolchain nao produz codificacao d8 para `lea 12(%pc),%a0` nem sob "
            "-m68010 (emitir 41fa 000c = d16): sem encoding confirmado, rotular seria "
            "adivinhar. Ver data/rex_corpus_b/recursos/isa-forms.json.",
            "O passo pc-relativo enumera candidatos por aritmetica de deslocamento (opcode "
            "cru no resultado); rotulos so sao emitidos para formas catalogadas "
            "(MOVE.L/MOVEA.L/LEA/JSR/JMP), e a classificacao so cobre os modos de "
            "enderecamento com codificacao montada e desmontada.",
            "Rotulos conferidos word a word contra m68k-elf-as (GNU binutils) do "
            "toolchain SGDK, fixado por SHA-256; a tabela de modos publica foi usada "
            "apenas para a POSICAO dos campos, nunca como unica fonte de codificacao.",
            "Isto e evidencia de CONSUMIDOR CANDIDATO; a semantica do recurso ainda exige "
            "leitura da rotina.",
            "No modo --tabelas, `cargas_total` e medido sem filtro de janela de proposito: "
            "cargas_total=0 significa que a FERRAMENTA nao ve carga catalogada alguma na "
            "area escaneada, o que torna nula qualquer conclusao de ausencia de consumidor "
            "para uma janela vazia.",
        ],
    }
    for s in a.addr:
        addr = int(s, 0)
        hits = find_ref(data, addr, prog_lo, prog_hi)
        ids = [h for h in hits if h["candidato_instrucao"]
               and h["na_area_de_programa_declarada"]]
        pch = find_pcrel_candidates(data, addr, prog_lo, prog_hi)
        doc["enderecos"].append({
            "endereco": hex(addr),
            "absoluto": {"total_ocorrencias": len(hits),
                         "instrucoes_classificadas_na_area_de_programa": len(ids),
                         "ocorrencias": hits[:MAX_HITS_PER_ADDR],
                         "omitidas": max(0, len(hits) - MAX_HITS_PER_ADDR)},
            "pc_relativo": {"total": len(pch),
                            "instrucoes_classificadas": len([h for h in pch if h["candidato_instrucao"]]),
                            "candidatos": pch[:MAX_HITS_PER_ADDR],
                            "omitidos": max(0, len(pch) - MAX_HITS_PER_ADDR)},
        })
        print(f"{hex(addr)}: abs {len(hits)} ocorrencia(s) / {len(ids)} instrucao(oes) "
              f"classificada(s); pc-rel {len(pch)} instrucao(oes)")
        for h in ids[:6] + pch[:6]:
            print(f"   @{h['offset']} {h['candidato_instrucao']} antes={h['antes']}")

    if a.tabelas:
        janelas = [parse_janela(s) for s in a.tabelas]
        doc["inventario"] = inventario(data, prog_lo, prog_hi, janelas)
        print(f"cargas catalogadas na area de programa declarada: "
              f"{doc['inventario']['cargas_total']}")
        for j in doc["inventario"]["janelas"]:
            print(f"  {j['janela']}: {j['total']} carga(s) apontando para la "
                  f"{j['por_forma'] or ''}")
            for s_ in j["sitios"][:8]:
                print(f"    @{s_['offset']} {s_['forma']} operando={s_['operando']} "
                      f"alvo={s_['alvo']}")

    out = a.out or os.path.join(ROOT, "data/rex_corpus_b/recursos",
                                "refs-" + (doc["rom"]["nome"].replace(" ", "_")) + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"\nevidencia: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
