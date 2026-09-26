#!/usr/bin/env python3
"""Desmonta um stream aPLib raw (variante SGDK, sem header `"AP\\0"`) token a token.

Instrumento de diagnóstico, não validação: a validação é o decoder do produto
(`src-tauri/src/tools/reverse/decomp/rex_aplib.rs`) contra os vetores pinados.
Este script existe para responder "de onde vêm os N bytes de diferença entre o
stream do oráculo e o stream do produto" — pergunta que o tamanho total não
responde, porque o mesmo byte pode ser um literal, um `111` ou o gamma2 de um
rep-match.

Duas coisas tornam o dump conferível em vez de opinião:

1. o plain reconstruído volta junto, e o SHA-256 dele confere com o hash pinado
   no `manifest.tsv` — errar o enquadramento de um token aparece como divergência
   de hash, não como um número silencioso;
2. a contabilidade fecha com o arquivo: `1 (literal físico do byte 0) + tags +
   dados <= len(stream)`, e a linha `FECHA` exige que os custos por token somem
   o mesmo número.

Regras espelhadas do decoder, incluídas as duas que a fixture da agente B não
exercitava: `110` **grava** o histórico de offset, `111` **não** grava e devolve
LWM a 3 (casos pinados em
`data/rex_profiles/integrator/aplib/discriminating/ORIGEM.md`).

Uso:
    python3 scripts/rex_profiles/integrator/aplib/token_dump.py \
        data/rex_profiles/integrator/aplib/vectors/plain/tile_like.apultra.ap
    python3 ... --sem-listagem          # só o resumo por tipo de token
"""
import argparse
import collections
import hashlib
import sys
from pathlib import Path

MIN_MATCH3_OFFSET = 1280
MIN_MATCH4_OFFSET = 32000

# (tipo, offset, comprimento, plain-produzido, bits, tags, bytes-de-dados)
CAMPOS = ("tipo", "offset", "comprimento", "plain", "bits", "tags", "dados")


class Leitor:
    def __init__(self, stream: bytes):
        self.s = stream
        self.pos = 1  # o byte 0 já foi consumido como literal físico
        self.tag = 0
        self.slot = 8  # 8 == nenhum tag aberto
        self.bits = 0
        self.tags = 0
        self.dados = 0
        self.out = bytearray([stream[0]]) if stream else bytearray()
        self.last_offset = 0
        self.lwm = 3  # 3 após literal/`111`, 2 após match

    def byte(self) -> int:
        if self.pos >= len(self.s):
            raise ValueError(f"EOF aos {self.pos} bytes com token em curso")
        v = self.s[self.pos]
        self.pos += 1
        return v

    def bit(self) -> int:
        if self.slot == 8:
            self.tag = self.byte()
            self.tags += 1
            self.slot = 0
        v = (self.tag >> (7 - self.slot)) & 1
        self.slot += 1
        self.bits += 1
        return v

    def dado(self) -> int:
        """Byte de dados (não tag): literal, `off_low` ou byte de comando."""
        v = self.byte()
        self.dados += 1
        return v

    def gamma2(self) -> int:
        v = 1
        while True:
            v = (v << 1) | self.bit()
            if self.bit() == 0:
                return v

    def copia(self, offset: int, length: int) -> None:
        if offset == 0 or offset > len(self.out):
            raise ValueError(f"referência inválida off={offset} len={length}")
        for _ in range(length):
            self.out.append(self.out[len(self.out) - offset])

    def ajuste(self, offset: int) -> int:
        if not (128 <= offset < MIN_MATCH4_OFFSET):
            return 2
        return 1 if offset >= MIN_MATCH3_OFFSET else 0


def desmonta(stream: bytes):
    """Devolve `(tokens, plain)`; veja `CAMPOS` para o formato do token."""
    if not stream:
        return [], b""
    r = Leitor(stream)
    tokens = [("literal-fisico", 0, 1, 1, 0, 0, 0)]
    while True:
        antes = (r.bits, r.tags, r.dados)
        if r.bit() == 0:
            r.out.append(r.dado())
            r.lwm = 3
            tokens.append(_token("literal", 0, 1, 1, r, antes))
            continue
        if r.bit() == 0:
            acumulado = r.gamma2()
            if acumulado < r.lwm:
                # rep-match: só o gamma2 do comprimento, sem byte de dados e
                # sem ajuste — a assimetria confirmada no desempacotador oficial.
                if r.last_offset == 0:
                    raise ValueError("rep-match sem offset histórico")
                offset, length, tipo = r.last_offset, r.gamma2(), "rep-match"
            else:
                offset = ((acumulado - r.lwm) << 8) | r.dado()
                length, tipo = r.gamma2() + r.ajuste(offset), "match-10"
            r.copia(offset, length)
            r.last_offset = offset
            r.lwm = 2
            tokens.append(_token(tipo, offset, length, length, r, antes))
            continue
        if r.bit() == 0:
            cmd = r.dado()
            if cmd == 0:
                tokens.append(_token("eod", 0, 0, 0, r, antes))
                return tokens, bytes(r.out)
            offset, length = cmd >> 1, 2 + (cmd & 1)
            r.copia(offset, length)
            r.last_offset = offset
            r.lwm = 2
            tokens.append(_token("cmd-110", offset, length, length, r, antes))
            continue
        curto = 0
        for _ in range(4):
            curto = (curto << 1) | r.bit()
        if curto == 0:
            r.out.append(0)
        else:
            r.copia(curto, 1)
        r.lwm = 3  # `111` não toca em last_offset
        tokens.append(_token("curto-111", curto, 1, 1, r, antes))


def _token(tipo, offset, comprimento, plain, r, antes):
    bits, tags, dados = antes
    return (tipo, offset, comprimento, plain, r.bits - bits, r.tags - tags, r.dados - dados)


def resumo(tokens):
    """Agrega por tipo de token: vezes, plain produzido, custo em bytes.

    O custo conta os BITS lidos para o token (o bit de tag já é um oitavo de
    byte, e o byte de dados vale os 8) mais os bytes de dados. Contar também o
    byte de tag inteiro duplicaria o que `bits` já mede; o que os bits não
    alcançam — o rabo não usado do último byte de tag lido — sai na linha
    `FECHA`, e é assim que a soma fecha com o tamanho real do stream.
    """
    acumulado = collections.OrderedDict()
    for tipo, _, _, plain, bits, tags, dados in tokens:
        linha = acumulado.setdefault(tipo, [0, 0, 0.0])
        linha[0] += 1
        linha[1] += plain
        linha[2] += bits / 8 + dados
    return acumulado


def confere(caminho: Path, stream: bytes, tokens, plain: bytes) -> int:
    """Fecha a contabilidade com o arquivo e, se houver manifest, com o hash.

    O hash conferido é o do **plain** (coluna 4 do `manifest.tsv`, vale para
    linhas `plain` e `golden`), não o do stream: é ele que prova que os tokens
    foram enquadrados certo. A linha tem que ser encontrada — conferência que
    não acha a linha não é conferência.

    Depois do EOD o arquivo pode ter bytes que pertencem ao bloco vizinho da ROM
    (é exatamente o caso `g08_eod_trailing`, cujo consumo o contrato fixa em 6 de
    11), então o fechamento é `consumido <= len(stream)` e a sobra é reportada,
    não ignorada.
    """
    consumido = 1 + sum(t[5] for t in tokens) + sum(t[6] for t in tokens)
    if consumido > len(stream):
        raise ValueError(
            f"contabilidade não fecha: 1 + tags + dados = {consumido} > {len(stream)}"
        )
    if len(plain) != sum(t[3] for t in tokens):
        raise ValueError("plain reconstruído difere da soma dos comprimentos")

    nome = caminho.name
    for sufixo in (".apultra.ap", ".apj.ap", ".js.ap", ".ap"):
        if nome.endswith(sufixo):
            nome = nome[: -len(sufixo)]
            break
    manifest = caminho.parent.parent / "manifest.tsv"
    if not manifest.exists():
        return consumido
    sha = hashlib.sha256(plain).hexdigest()
    for linha in manifest.read_text().splitlines()[1:]:
        col = linha.split("\t")
        if col[1] != nome:
            continue
        if col[3] and col[3] != sha:
            raise ValueError(
                f"{caminho.name}: plain {sha[:12]}… diverge do pinado {col[3][:12]}…"
            )
        return consumido
    raise ValueError(f"{caminho.name}: linha '{nome}' ausente do manifest.tsv")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("stream", type=Path)
    ap.add_argument("--listagem", action="store_true", default=True)
    ap.add_argument("--sem-listagem", dest="listagem", action="store_false")
    args = ap.parse_args()

    dados = args.stream.read_bytes()
    tokens, plain = desmonta(dados)
    if not tokens or tokens[-1][0] != "eod":
        print("ERRO: stream sem EOD", file=sys.stderr)
        return 1
    try:
        consumido = confere(args.stream, dados, tokens, plain)
    except ValueError as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 1

    print(f"== {args.stream}")
    print(f"   stream {len(dados)} B, consumidos pelo stream {consumido} B "
          f"(= 1 literal físico + {sum(t[5] for t in tokens)} tags + "
          f"{sum(t[6] for t in tokens)} dados)"
          + (f", {len(dados) - consumido} B depois do EOD = bloco vizinho"
             if len(dados) > consumido else ""))
    print(f"   plain {len(plain)} B  sha256 {hashlib.sha256(plain).hexdigest()}")

    print(f"{'token':16} {'vezes':>6} {'plain':>8} {'custo (B)':>11}")
    tabela = resumo(tokens)
    for tipo, (vezes, produzido, custo) in tabela.items():
        print(f"{tipo:16} {vezes:>6} {produzido:>8} {custo:>11.2f}")
    # Contabilidade de fechamento: 1 byte do literal físico + o que a mesa soma
    # + o rabo não usado dos bytes de tag = o stream consumido. Se não fechar, a
    # mesa está errada, não o stream.
    custo_total = sum(c for _, _, c in tabela.values()) + 1
    desperdicio = sum(t[5] for t in tokens) * 8 - sum(t[4] for t in tokens)
    print(f"{'FECHA':16} {'':>6} {len(plain):>8} {custo_total:>11.2f}"
          f"  (rabo de tag {desperdicio} bits = {desperdicio / 8:.2f} B; "
          f"stream consumido {consumido} B)")
    if abs(custo_total + desperdicio / 8 - consumido) > 0.01:
        print(f"ERRO: contabilidade não fecha: {custo_total} + "
              f"{desperdicio / 8} != {consumido}", file=sys.stderr)
        return 1

    if args.listagem:
        print("-- tokens --")
        for i, (tipo, offset, length, _, bits, tags, d) in enumerate(tokens):
            print(f"{i:5} {tipo:16} off={offset:<7} len={length:<6} "
                  f"bits={bits:<3} tags={tags} dados={d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
