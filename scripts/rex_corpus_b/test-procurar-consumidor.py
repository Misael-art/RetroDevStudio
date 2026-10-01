#!/usr/bin/env python3
"""Testes do procurar-consumidor.py com controle positivo e negativo sinteticos.

Controle positivo: ROM sintetica com `lea $TABELA,a5` seguido de
`movea.l (d8,a5,d0.w),a0` cujo endereco computado cai numa entrada — a
ferramenta DEVE localizar. Controle negativo: mesma ROM sem o codigo — DEVE
declarar consumidor-nao-localizado sem erro.
"""
import importlib.util
import json
import pathlib
import shutil
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
TMP = HERE.parent.parent / "data" / "rex_corpus_b" / "tmp-test-consumidor"
PASS = []
FAIL = []


def check(nome, cond, detalhe=""):
    (PASS if cond else FAIL).append(nome)
    print(f"[{'PASS' if cond else 'FAIL'}] {nome}" + (f" — {detalhe}" if detalhe and not cond else ""))


def rom_sintetica(variante):
    """0=sem consumidor; 1=disp positivo; 2=disp negativo."""
    rom = bytearray(0x30000)
    rom[0:4] = b"\x00\xff\x0f\xf0"
    tabela = 0x20000
    entradas = [0x28000, 0x28040]
    struct.pack_into(">II", rom, tabela, *entradas)
    stream = bytes(range(0x80))
    rom[0x28000:0x28000 + len(stream)] = stream
    if variante == 1:
        # lea ($TABELA-4).l,a5 ; movea.l (4,a5,d0.w),a0 ; rts
        # ext breve 0x0004: disp=+4, indice d0 (bits 14-12=000, size bit11=0)
        code = (bytes.fromhex("45f9") + struct.pack(">I", tabela - 4)
                + bytes.fromhex("2075") + struct.pack(">H", 0x0004)
                + bytes.fromhex("4e75"))
    elif variante == 2:
        # lea ($TABELA+8).l,a5 ; movea.l (-8,a5,d0.w),a0 ; rts
        # ext breve 0x00f8: disp=-8 (0xf8 assinado), indice d0
        code = (bytes.fromhex("45f9") + struct.pack(">I", tabela + 8)
                + bytes.fromhex("2075") + struct.pack(">H", 0x00f8)
                + bytes.fromhex("4e75"))
    else:
        code = b""
    rom[0x1000:0x1000 + len(code)] = code
    return bytes(rom), tabela


def main():
    spec = importlib.util.spec_from_file_location("pc", HERE / "procurar-consumidor.py")
    PC = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(PC)

    TMP.mkdir(parents=True, exist_ok=True)
    try:
        for variante in (1, 2, 0):
            rom, tabela = rom_sintetica(variante)
            caminho = TMP / f"synthetic-{variante}.gen"
            caminho.write_bytes(rom)
            saida = TMP / f"out-{variante}.json"
            rc = PC.main(["--rom", str(caminho), "--nome", "sintetico",
                          "--tabela", hex(tabela), "--tamanho", "8",
                          "--out", str(saida)])
            doc = json.loads(saida.read_text())
            check(f"rc==0 com variante={variante}", rc == 0)
            if variante in (1, 2):
                check(f"positivo({variante}): consumidor localizado",
                      doc["conclusao"] == "consumidor-localizado", doc["conclusao"])
                hits = doc["alvos"][0]["base_mais_indexada"]["hits"]
                check(f"positivo({variante}): hit na forma (d8,An,Xi)",
                      len(hits) >= 1 and all(h["forma"] == "(d8,An,Xi)" for h in hits),
                      json.dumps(hits))
                check(f"positivo({variante}): algum hit cai na entrada [0] da tabela",
                      any(h["alvo"] == hex(tabela) for h in hits), json.dumps(hits))
            else:
                check("negativo: consumidor nao localizado",
                      doc["conclusao"] == "consumidor-nao-localizado-nas-formas-varridas",
                      doc["conclusao"])
                check("negativo: entrada existe mas sem hit",
                      doc["alvos"][0]["base_mais_indexada"]["hits"] == [])
    finally:
        shutil.rmtree(TMP, ignore_errors=True)

    print(f"\nverificacoes: {len(PASS)} pass / {len(FAIL)} fail")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
