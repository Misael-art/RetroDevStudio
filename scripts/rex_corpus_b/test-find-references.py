#!/usr/bin/env python3
"""Testes de resposta conhecida do find-references.py.

Os alvos sao codigos do ISA 68000 verificados contra a tabela publica de modos de
enderecamento (modo 111: registrador 000 = (xxx).W, 001 = (xxx).L, 010 = (d16).PC,
100 = imediato) e contra as posicoes de campo de cada familia. Cada caso NEGATIVO
fixa que um opcode de OUTRA forma (.W, .PC, imediato, moveq, nop) NAO pode ser
rotulado como acesso a tabela — rotulo errado aqui viraria falsa evidencia de
consumidor.

Rodar: python3 scripts/rex_corpus_b/test-find-references.py
"""
import importlib.util
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("fref", os.path.join(HERE, "find-references.py"))
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)

checks = {"ok": 0, "fail": 0}
fails = []


def eq(nome, obtido_fn, esperado):
    if callable(obtido_fn):
        try:
            obtido = obtido_fn()
        except Exception as e:
            checks["fail"] += 1
            fails.append(nome)
            print(f"[FAIL] {nome}: lancou {type(e).__name__}: {e}")
            return
    else:
        obtido = obtido_fn
    if obtido == esperado:
        checks["ok"] += 1
        print(f"[PASS] {nome}")
    else:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: esperado={esperado!r} obtido={obtido!r}")


# 1) (xxx).L — operando absoluto de 32 bits (modo 111, registrador 001)
eq("lea (xxx).L,a0 = $41F9", F.classify(0x41F9), "lea (xxx).L,a0")
eq("lea (xxx).L,a1 = $43F9", F.classify(0x43F9), "lea (xxx).L,a1")
eq("lea (xxx).L,a6 = $4DF9", F.classify(0x4DF9), "lea (xxx).L,a6")
eq("movea.l (xxx).L,a0 = $2079", F.classify(0x2079), "movea.l (xxx).L,a0")
eq("movea.l (xxx).L,a3 = $2679", F.classify(0x2679), "movea.l (xxx).L,a3")
eq("move.l (xxx).L,d0 = $2039", F.classify(0x2039), "move.l (xxx).L,d0")
eq("move.l (xxx).L,d1 = $2239 (registrador em 11-9, passo 0x200)",
   F.classify(0x2239), "move.l (xxx).L,d1")
eq("jsr (xxx).L = $4EB9", F.classify(0x4EB9), "jsr (xxx).L")
eq("jmp (xxx).L = $4EF9", F.classify(0x4EF9), "jmp (xxx).L")
eq("cmp.l (xxx).L NAO e rotulado (campo nao verificado)", F.classify(0x0C39), None)

# 2) NEGATIVOS de forma: outras formas do mesmo modo 111 nao sao (xxx).L
eq("lea (xxx).W $41F8 nao vira acesso a tabela", F.classify(0x41F8), None)
eq("lea (d16,PC) $41FA nao vira absoluto", F.classify(0x41FA), None)
eq("movea.l imediato $207C nao vira absoluto", F.classify(0x207C), None)
eq("move.l imediato $203C nao vira absoluto", F.classify(0x203C), None)
eq("moveq $7079 (campos de outra familia) nao vira absoluto", F.classify(0x7079), None)
eq("nop $4E71 nao e classicado", F.classify(0x4E71), None)
eq("a7/USP $4FF9 nao e rotulado como registrador de endereco", F.classify(0x4FF9), None)
eq("movea.w $3079 (tamanho palavra) nao e rotulado como .L", F.classify(0x3079), None)

# 3) varredura em ROM SINTETICA: a instrucao real e encontrada e rotulada;
#    ocorrencias de dado que casam os 4 bytes permanecem nao-classificadas.
addr = 0x1B64C
A = struct.pack(">I", addr)          # 00 01 b6 4c
code = (b"\x4e\xb9\x00\x00\x1b\x64"  # 0..5   jmp (xxx).W: tem 00 00 1b 64, NAO o padrao
        + A                          # 6      ocorrencia precedida por dado (1b64)
        + b"\x41\xf9" + A             # 10..13 lea, alvo em 12
        + b"\x20\x79" + A             # 16..19 movea.l, alvo em 18
        + b"\xff\xff\xff\xff" + A)    # 22..27 filler, alvo em 26
hits = F.find_ref(code, addr, 0, len(code))
cls = [h for h in hits if h["candidato_instrucao"]
       and h["na_area_de_programa_declarada"]]
eq("as 4 ocorrencias do padrao de 4 bytes sao encontradas", len(hits), 4)
eq("somente as 2 instrucoes reais sao classicadas", len(cls), 2)
eq("offsets das ocorrencias", [h["offset"] for h in hits],
   [hex(6), hex(12), hex(18), hex(26)])
eq("primeira instrucao classicada e lea", cls[0]["candidato_instrucao"], "lea (xxx).L,a0")
eq("primeira instrucao esta no offset da instrucao", cls[0]["offset"], hex(12))
eq("segunda instrucao classicada e movea.l", cls[1]["candidato_instrucao"], "movea.l (xxx).L,a0")
eq("ocorrencia precedida por 0xffff nao e classicada",
   [h["offset"] for h in cls if h["opcode_anterior"] == 0xffff], [])
eq("ocorrencia precedida por 0x1b64 nao e classicada",
   [h["offset"] for h in cls if h["opcode_anterior"] == 0x1b64], [])

# 4) a area de programa declarada e registrada por hit (filtragem fora do codigo)
hits2 = F.find_ref(code, addr, 6, 14)
eq("flag de area de programa discrimina",
   sorted({h["na_area_de_programa_declarada"] for h in hits2}), [False, True])
eq("hits dentro da area declarada",
   [h["offset"] for h in hits2 if h["na_area_de_programa_declarada"]], [hex(6), hex(12)])

# 5) PASSO PC-RELATIVO: tabelas em ROM costumam ser alcancadas por lea/movea
#    relativos ao PC, onde os 4 bytes do endereco NUNCA aparecem no arquivo.
#    Resposta conhecida por construcao: disp = alvo - (offset_da_instrucao + 2).
rom = bytearray(0x400)
t1 = 0x200
i1 = 0x100                      # lea (d16,PC),a0
struct.pack_into(">Hh", rom, i1, 0x41FA, t1 - (i1 + 2))
i2 = 0x140                      # movea.l (d16,PC),a1
struct.pack_into(">Hh", rom, i2, 0x227A, 0x300 - (i2 + 2))
i3 = 0x180                      # lea (d16,PC),a2 apontando para outro lugar
struct.pack_into(">Hh", rom, i3, 0x45FA, 0x2C0 - (i3 + 2))
i4 = 0x1C0                      # lea (d16,PC),a0 para 0x3FF
struct.pack_into(">Hh", rom, i4, 0x41FA, 0x3FF - (i4 + 2))
rom += b"\x00" * (0x300 - len(rom))
def labeled(data, a, lo, hi):
    return [(h["offset"], h["candidato_instrucao"]) for h in
            F.find_pcrel_candidates(data, a, lo, hi) if h["candidato_instrucao"]]


eq("pc-relativo: unico lea rotulado para o alvo e o construido",
   labeled(bytes(rom), t1, 0, len(rom)), [(hex(i1), "lea (d16,PC),a0")])
one = F.find_pcrel_candidates(bytes(rom), t1, 0, len(rom))[0]
eq("disp lido corretamente", one["disp"], hex(t1 - (i1 + 2)))
eq("alvo calculado", one["alvo"], hex(t1))
eq("movea.l pc-relativo detectado e rotulado", labeled(bytes(rom), 0x300, 0, len(rom)),
   [(hex(i2), "movea.l (d16,PC),a1")])
eq("lea para 0x2c0 detectado", labeled(bytes(rom), 0x2C0, 0, len(rom)),
   [(hex(i3), "lea (d16,PC),a2")])
eq("alvo sem referencia nao produz candidato rotulado",
   labeled(bytes(rom), 0x202, 0, len(rom)), [])
eq("o lea de 0x1c0 so e rotulado para o alvo que ele realmente aponta",
   labeled(bytes(rom), 0x3FF, 0, len(rom)), [(hex(i4), "lea (d16,PC),a0")])
eq("fora da area de programa nenhum candidato rotulado",
   labeled(bytes(rom), t1, i1 + 2, len(rom)), [])
# a enumeracao agnostica TEM falsos positivos aritmeticos (regiao zerada: disp=0 e
# off+2 == alvo). Isso e registrado, nao escondido: o rotulo e que filtra.
zeros = bytes(0x200)
eq("candidato bruto de regiao zerada e enumerado sem rotulo",
   [(h["offset"], h["opcode"], h["candidato_instrucao"]) for h in
    F.find_pcrel_candidates(zeros, 0x102, 0, len(zeros))], [("0x100", "0x0", None)])

# 6) descoberta AGNOSTICA de forma: um opcode nao catalogado ainda e reportado
#    cru — evidencia nao pode se perder por falta de rotulo na ferramenta
rom2 = bytearray(0x200)
struct.pack_into(">Hh", rom2, 0x100, 0x0C3A, 0x180 - 0x102)   # CMP (d16,PC): nao catalogado
cand = F.find_pcrel_candidates(bytes(rom2), 0x180, 0, len(rom2))
eq("candidato sem rotulo conhecido ainda e enumerado",
   "0x100" in [h["offset"] for h in cand], True)
eq("e marcado como sem classificacao", cand[0]["candidato_instrucao"], None)
eq("o opcode cru fica registrado", cand[0]["opcode"], "0xc3a")


# 7) FORMAS QUE FALTAVAM: (xxx).W e (d8,PC). Sem elas, uma pesquisa de consumidor
#    negativa pode ser so um buraco da ferramenta. Campos verificados na mesma
#    tabela de modos: modo 111 registrador 000 = (xxx).W (0x38); modo 110
#    registrador 000 = (d8,PC) (0x30).
eq("lea (xxx).W,a0 = $41F8", F.classify_abs_w(0x41F8), "lea (xxx).W,a0")
eq("lea (xxx).W,a6 = $4DF8", F.classify_abs_w(0x4DF8), "lea (xxx).W,a6")
eq("movea.l (xxx).W,a0 = $2078", F.classify_abs_w(0x2078), "movea.l (xxx).W,a0")
eq("move.l (xxx).W,d0 = $2038", F.classify_abs_w(0x2038), "move.l (xxx).W,d0")
eq("jmp (xxx).W = $4EF8", F.classify_abs_w(0x4EF8), "jmp (xxx).W")
eq("NEGATIVO lea $41F9 (.L) nao e .W", F.classify_abs_w(0x41F9), None)
eq("NEGATIVO lea $41FA (.PC) nao e .W", F.classify_abs_w(0x41FA), None)
eq("NEGATIVO a=7 nao existe em lea", F.classify_abs_w(0x4FF8), None)
# (d8,PC) FOI REMOVIDO do catalogo: o montador do toolchain nao confirma nenhuma
# codificacao (d8,PC) para este alvo — `lea 12(%pc),%a0` e montado como d16
# (41fa 000c) mesmo sob -m68010. Sem codificacao confirmada, rotular seria
# chutar; entao 0x30 permanece LACUNA DOCUMENTADA, nao forma suportada.
eq("nenhuma classe catalogada rotula $41F0 (padria-se (d8,PC))",
   [F.classify(0x41F0), F.classify_abs_w(0x41F0), F.classify_pcrel(0x41F0)],
   [None, None, None])
eq("nenhuma classe catalogada rotula $2070 (padria-se movea.l (d8,PC))",
   [F.classify(0x2070), F.classify_abs_w(0x2070), F.classify_pcrel(0x2070)],
   [None, None, None])
eq("catalogo de modos tem SO os modos com codificacao confirmada pelo montador",
   sorted(F.MODOS), [0x38, 0x39, 0x3A])
eq("SPAN cobre exatamente o catalogo de modos", sorted(F.SPAN), sorted(F.MODOS))

# 8) INVENTARIO DE CARREGAMENTOS DE TABELA: em vez de perguntar "quem cita o
#    endereco X", pergunta "o que cada instrucao catalogada aponta". Alvos
#    sabidos por construcao. Os dois sitios (d8,PC) ficam na ROM de proposito:
#    servem de NEGATIVO para a lacuna documentada — o scanner nao os ve.
rom3 = bytearray(0x300)
struct.pack_into(">HI", rom3, 0x100, 0x41F9, 0x1B64C)          # lea (xxx).L,a0   -> 0x1b64c
struct.pack_into(">Hh", rom3, 0x108, 0x207A, 0xF8)             # movea.l (d16,PC),a0 -> 0x202
struct.pack_into(">HH", rom3, 0x110, 0x41F0, 0x1000)           # (d8,PC) NAO catalogado
struct.pack_into(">HH", rom3, 0x114, 0x43F0, 0xF000)           # (d8,PC) NAO catalogado
struct.pack_into(">HH", rom3, 0x118, 0x4EF8, 0x1234)           # jmp (xxx).W -> 0x1234
struct.pack_into(">HI", rom3, 0x11C, 0x41F9, 0x99999)          # lea (xxx).L,a0 -> fora da janela
tl = F.table_loads(bytes(rom3), 0x100, 0x120)
eq("todas as formas catalogadas entram no inventario",
   [(h["offset"], h["forma"], h["alvo"]) for h in tl],
   [("0x100", "lea (xxx).L,a0", "0x1b64c"),
    ("0x108", "movea.l (d16,PC),a0", "0x202"),
    ("0x118", "jmp (xxx).W", "0x1234"),
    ("0x11c", "lea (xxx).L,a0", "0x99999")])
eq("NEGATIVO: sitios (d8,PC) ficam FORA do inventario (lacuna, nao ausencia de uso)"
   , [h["offset"] for h in tl if h["offset"] in ("0x110", "0x114")], [])
eq("janela de alvo filtra (so o jmp .W cai em 0x1000-0x2000)",
   [h["offset"] for h in F.table_loads(bytes(rom3), 0x100, 0x120, 0x1000, 0x2000)],
   ["0x118"])
eq("operando de 32 bits registrado como esta no arquivo", tl[0]["operando"], "0x0001b64c")
eq("operando de 16 bits registrado como esta no arquivo", tl[2]["operando"], "0x1234")
# SINAL: (xxx).W e endereco de 16 bits COM sinal; $B64C tem o bit 14 setado e o
# ISA o estende para negativo. Registrado como o ISA calcula, nao "consertado".
rom5 = bytearray(0x40)
struct.pack_into(">HH", rom5, 0x20, 0x4EF8, 0xB64C)
eq("(xxx).W e so-estendido pelo ISA (0xB64C vira endereco negativo)",
   F.table_loads(bytes(rom5), 0, len(rom5))[0]["alvo"], "0xffffb64c")
# NEGATIVO: instrucao nao catalogada (aqui, um `ori` pc-rel) nao entra.
rom4 = bytearray(0x40)
struct.pack_into(">Hh", rom4, 0x20, 0x00BA, 0x180 - 0x22)      # ori.l (d16,PC),d0: nao catalogado
eq("forma nao catalogada fica fora do inventario (e nao vira alvo inventado)",
   F.table_loads(bytes(rom4), 0, len(rom4)), [])


# 9) MODO --tabelas da CLI: inverter a pergunta ("o que aponta PARA esta janela de
#    tabela?") exige parse de janela + agrupamento. Sem isso, o docstring promete
#    um uso que o programa nao entrega.
def lançar(nome, fn, exc):
    try:
        fn()
    except exc:
        checks["ok"] += 1
        print(f"[PASS] {nome}")
        return
    except Exception as e:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: excecao errada {type(e).__name__}: {e}")
        return
    checks["fail"] += 1
    fails.append(nome)
    print(f"[FAIL] {nome}: nao lancou {exc.__name__}")


eq("janela '0x100-0x200' vira par de inteiros",
   lambda: F.parse_janela("0x100-0x200"), (0x100, 0x200))
eq("janela admite enderecos grandes sem prefixo 0x repetido",
   lambda: F.parse_janela("0x50430-0x506a0"), (0x50430, 0x506a0))
lançar("NEGATIVO: janela sem traco e recusada", lambda: F.parse_janela("0x100"), ValueError)
lançar("NEGATIVO: janela com extremos nao numericos e recusada",
       lambda: F.parse_janela("abc-0x10"), ValueError)
lançar("NEGATIVO: janela invertida (fim < inicio) e recusada",
       lambda: F.parse_janela("0x200-0x100"), ValueError)

inv = F.inventario(bytes(rom3), 0x100, 0x120, [(0x1000, 0x2000)])
eq("inventario registra TODAS as cargas catalogadas (medida da ferramenta, nao da ROM)",
   inv["cargas_total"], 4)
eq("janela filtra os sitios que apontam para ela",
   [(s["offset"], s["forma"], s["alvo"]) for s in inv["janelas"][0]["sitios"]],
   [("0x118", "jmp (xxx).W", "0x1234")])
eq("agrupamento por forma na janela", inv["janelas"][0]["por_forma"], {"jmp (xxx).W": 1})
eq("janela sem alvo produz registro vazio, nao ausencia de registro",
   lambda: F.inventario(bytes(rom3), 0x100, 0x120, [(0x1, 0x2)])["janelas"][0]["total"], 0)
eq("sem janela, o inventario ainda mede as cargas catalogadas",
   F.inventario(bytes(rom3), 0x100, 0x120, []), {"cargas_total": 4, "janelas": []})
eq("inventario esvazia a area de programa fora do scan (ROM sintetica pequena)",
   F.inventario(bytes(rom3), 0x0, 0x20, [])["cargas_total"], 0)


print(f"\nverificacoes: {checks['ok']} pass / {checks['fail']} fail")
if fails:
    print("falhas:", *fails, sep="\n  - ")
sys.exit(1 if checks["fail"] else 0)
