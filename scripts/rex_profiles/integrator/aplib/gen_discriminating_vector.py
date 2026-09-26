#!/usr/bin/env python3
"""Constrói os vetores discriminadores de HISTÓRICO DE OFFSET do aPLib.

Motivo: os 49 arquivos importados de B (8 plains, 9 goldens, 7 negativos +
manifest.tsv) nunca colocam um rep-match depois de um match codificado pelo
token `110` (byte de comando) nem depois de um `111` (offset curto de 4 bits).
Esses são exatamente os dois ramos em que a regra "quem escreve em
`offset_history`" fica ambígua na especificação de B. Sem cobertura, o decoder
do produto passou nos 49 vetores e divergiu em 703 dos 16 000 bytes do TileSet
APLIB real da ROM BYOR (medido 2026-09-26 pelo aceite
`byor_aplib_decodifica_os_dois_streams_do_tiledimage_visivel`).

O plain esperado NÃO é definido por este script: cada caso declara as duas
predições em disputa e quem decide é a concordância dos dois decodificadores de
referência (`apultra` e o `apj.jar` da SGDK 2.11). Sem essa concordância o
vetor não entra no conjunto.

Reexecutar a arbitragem (para cada caso NOME):

    python3 scripts/rex_profiles/integrator/aplib/gen_discriminating_vector.py --saidas /tmp/disc
    ~/.cache/rex-codecs/oracle-tools/apultra -d /tmp/disc/NOME.ap /tmp/disc/NOME.apultra.bin
    java -jar ~/.cache/rex-codecs/oracle-tools/SGDK211/bin/apj.jar u \\
        /tmp/disc/NOME.ap /tmp/disc/NOME.apj.bin s
    cmp /tmp/disc/NOME.apultra.bin /tmp/disc/NOME.apj.bin
"""

import argparse
import hashlib
import os
import sys

# byte 0 do stream raw é literal direto, sem token; em todos os casos 'A'.
PREVIEW = 0x41

# Cada elemento é (bits do token na ordem MSB->LSB, bytes de dados consumidos em
# seguida). `10` usa gamma2 = (off_hi + LWM) para o offset e gamma2 puro para o
# comprimento, com os ajustes +2 (off < 128 ou >= 32000) / +1 (1280..32000).
LITERAL = lambda v: ([0], [v])  # noqa: E731
MATCH_10_OFF3_LEN4 = [([1, 0, 1, 0], [0x03]), ([0, 0], [])]  # gamma2 3 - LWM 3 = 0
CMD_110_OFF5_LEN3 = [([1, 1, 0], [0x0B])]  # cmd 0x0B -> off 5, len 2 + (0x0B & 1)
SHORT_111_OFF4 = [([1, 1, 1, 0, 1, 0, 0], [])]  # `111` + off4 = 0b0100
REP_LEN4 = [([1, 0, 0, 0], []), ([0, 1, 0, 0], [])]  # gamma2 2 < LWM 3; len gamma2 4
EOD = [([1, 1, 0], [0x00])]

BASE_SEIS_LITERAIS = [LITERAL(v) for v in b"BCDEF"]

CASOS = {
    # Rep-match logo depois de um `110`: o `110` tem que ter gravado o
    # histórico (offset 5), senão o rep reusa o offset 3 do `10` anterior.
    "rep_after_cmd110": {
        "elementos": BASE_SEIS_LITERAIS
        + MATCH_10_OFF3_LEN4
        + CMD_110_OFF5_LEN3
        + [LITERAL(0x47)]  # literal 'G' devolve LWM a 3
        + REP_LEN4
        + EOD,
        "correto": b"ABCDEF" b"DEFD" b"FDE" b"G" b"DFDE",
        "bug": b"ABCDEF" b"DEFD" b"FDE" b"G" b"DEGD",
        "regra": "`110` atualiza offset_history",
    },
    # Rep-match logo depois de um `111`: além de o `111` NÃO poder gravar o
    # histórico (senão o rep usaria off4 = 4), ele tem que devolver LWM a 3
    # (senão gamma2 = 2 deixaria de ser rep-match e o enquadramento mudaria).
    "rep_after_short111": {
        "elementos": BASE_SEIS_LITERAIS
        + MATCH_10_OFF3_LEN4
        + SHORT_111_OFF4
        + REP_LEN4
        + EOD,
        # off 3 sobre o histórico: posições 11..14 lêem out[8]='F', out[9]='D',
        # out[10]='D', out[11]='F' (o 'F' sai do próprio match em curso).
        "correto": b"ABCDEF" b"DEFD" b"D" b"FDDF",
        # se o `111` gravasse o histórico, o rep usaria off4 = 4:
        "bug": b"ABCDEF" b"DEFD" b"D" b"EFDD",
        "regra": "`111` NÃO atualiza offset_history e devolve LWM a 3",
    },
}


def monta_stream(elementos) -> bytes:
    """Serializa na ordem de consumo do decodificador.

    O byte de tag é lido INTEIRO antes de qualquer um dos seus 8 bits, então um
    byte de dado consumido no meio de um tag fica fisicamente DEPOIS desse tag,
    ainda que os bits finais do tag pertençam a tokens posteriores.
    """
    out = bytearray([PREVIEW])
    idx_tag = None
    proximo_bit = 8  # 8 == nenhum tag aberto
    for bits, dados in elementos:
        for b in bits:
            if proximo_bit == 8:
                out.append(0)
                idx_tag = len(out) - 1
                proximo_bit = 0
            if b:
                out[idx_tag] |= 0x80 >> proximo_bit
            proximo_bit += 1
        out.extend(dados)
    return bytes(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--saidas", help="diretório para escrever stream + predições")
    args = ap.parse_args()

    for nome, caso in CASOS.items():
        stream = monta_stream(caso["elementos"])
        correto, bug = caso["correto"], caso["bug"]
        assert correto != bug, nome
        print(f"== {nome}: {caso['regra']}")
        print(f"   stream ({len(stream)} B): {stream.hex(' ')}")
        print(f"     sha256 {hashlib.sha256(stream).hexdigest()}")
        print(f"   predição A ({len(correto)} B) {correto!r} sha256 {hashlib.sha256(correto).hexdigest()}")
        print(f"   predição B ({len(bug)} B) {bug!r} sha256 {hashlib.sha256(bug).hexdigest()}")
        if args.saidas:
            os.makedirs(args.saidas, exist_ok=True)
            with open(os.path.join(args.saidas, f"{nome}.ap"), "wb") as f:
                f.write(stream)
            with open(os.path.join(args.saidas, f"{nome}.pred-A.bin"), "wb") as f:
                f.write(correto)
            with open(os.path.join(args.saidas, f"{nome}.pred-B.bin"), "wb") as f:
                f.write(bug)
    if args.saidas:
        print(f"escrito em {args.saidas}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
