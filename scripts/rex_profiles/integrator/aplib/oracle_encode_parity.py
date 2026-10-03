#!/usr/bin/env python3
"""Prova de paridade: o que o encoder do PRODUTO emite tem que ser lido por um
decoder independente — senão só se provou que o nosso decoder concorda com o
nosso encoder, que é circular.

Os oráculos aqui NÃO usam o código do produto, e são duas implementações
independentes entre si: `apultra` é C (Emmanuel Marty / spke), `apj.jar` é Java
(Stephane Dallongeville, empacotador oficial do SGDK). Cada stream do produto tem
que desempacotar byte a byte no plain pinado no `manifest.tsv` (coluna 4) nos
dois; um nos dois é a alegação, e é por isso que `--oracle ambos` é o padrão.

Receita dos streams do produto (regenerável, não versionada):

    RDS_APLIB_DUMP=src-tauri/target-test/analysis/aplib cargo test --lib aplib_encode_dumpa
    python3 scripts/rex_profiles/integrator/aplib/oracle_encode_parity.py \
        src-tauri/target-test/analysis/aplib

Ausência de ferramenta, SHA divergido, stream que não desempacota, hash que não
bate, caso ausente, caso sem linha no manifesto, linha duplicada no manifesto e
timeout de oráculo são todos falha com rc != 0 e mensagem própria. Skip silencioso
não existe: sem oráculo a prova não aconteceu, e o script diz isso. O fecho é por
contagem — `esperado | executado | aprovado | divergente` — e `esperado` vem do
manifesto, não dos dumps presentes, porque "0 divergência" em 2 casos dos 8
esperados seria exatamente o aceite curto que a igualdade de conjuntos impede.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

APULTRA = Path.home() / ".cache/rex-codecs/oracle-tools/apultra"
# Origem registrada: build local do apultra v1.4.8 (Emmanuel Marty / spke), a
# mesma ferramenta que produziu os streams `plain/*.apultra.ap` da fixture.
APULTRA_SHA256 = "64be2a7a8e44d3c5a4ed33de3b6d8aba294aa02870f51c29c8985fea4b34b207"

APJ_JAR = Path.home() / ".cache/rex-codecs/references/sgdk/bin/apj.jar"
# Origem registrada: apj.jar v1.32 do SGDK 2.11, o empacotador que o toolchain
# oficial usa e que produziu os streams `plain/*.apj.ap` da fixture.
APJ_SHA256 = "2d8cdc63cc800e4b86ff4d9cdfe514001b77f788abcd02d61974dc319d026204"


def _monta_apultra(stream: Path, destino: Path) -> list[str]:
    return [str(APULTRA), "-d", str(stream), str(destino)]


def _monta_apj(stream: Path, destino: Path) -> list[str]:
    java = shutil.which("java")
    if java is None:
        raise FileNotFoundError("java ausente no PATH")
    # O parâmetro extra depois do destino é a chave de modo silencioso do jar.
    return [java, "-jar", str(APJ_JAR), "u", str(stream), str(destino), "x"]


# (nome, binário, SHA pinado, montador de comando)
ORACULOS = (
    ("apultra", APULTRA, APULTRA_SHA256, _monta_apultra),
    ("apj.jar", APJ_JAR, APJ_SHA256, _monta_apj),
)


def sha256_bytes(dados: bytes) -> str:
    return hashlib.sha256(dados).hexdigest()


def oracos_prontos(escolhidos):
    """Confere presença e hash de cada oráculo pedido. A recusa em executar um
    binário cujo SHA divergiu do registrado é a mesma para os dois: sem origem
    imutável não há oráculo, e a ausência deles é falha, não skip."""
    pront = []
    for nome, caminho, pino, monta in ORACULOS:
        if nome not in escolhidos:
            continue
        if not caminho.is_file():
            print(f"FALHA: oráculo {nome} ausente em {caminho}; a prova não aconteceu")
            return None
        real = sha256_bytes(caminho.read_bytes())
        if real != pino:
            print(
                f"FALHA: SHA-256 do oráculo {nome} divergiu do registrado — não "
                f"executo binário desconhecido\n  esperado {pino}\n  obtido   {real}"
            )
            return None
        pront.append((nome, monta))
    return pront


def pinados(manifest: Path) -> dict[str, str]:
    """`nome -> sha256 do plain` para as linhas `plain` do manifest.

    Duplicidade é falha, não última-vence: duas linhas com o mesmo nome são duas
    referências concorrentes, e a que sobrevivesse à leitura decidiria contra o
    que o aceite compara — o que é exatamente a escolha que não deve depender da
    ordem do arquivo.
    """
    saida: dict[str, str] = {}
    for linha in manifest.read_text().splitlines()[1:]:
        col = linha.split("\t")
        if col[0] != "plain":
            continue
        if not col[3]:
            raise ValueError(f"linha '{col[1]}' sem SHA-256 de plain pinado")
        if col[1] in saida:
            raise ValueError(
                f"manifesto com linha 'plain' duplicada para '{col[1]}': "
                f"{saida[col[1]][:12]}… e {col[3][:12]}…"
                if saida[col[1]] != col[3]
                else f"manifesto com linha 'plain' duplicada para '{col[1]}'"
            )
        saida[col[1]] = col[3]
    return saida


def conjuntos(esperado: dict[str, str], dumps: list[Path]) -> tuple[list[str], list[str]]:
    """`(faltando, desconhecidos)` entre o manifesto e os dumps presentes.

    Igualdade de conjuntos é o que torna a linha `0 divergência` legível: sem ela,
    rodar 2 casos dos 8 esperados também termina sem divergência nenhuma, e o
    número de casos executados é a única coisa que denunciaria o aceite curto.
    """
    nomes = [caminho.name[: -len(".produto.ap")] for caminho in dumps]
    presentes = set(nomes)
    faltando = sorted(set(esperado) - presentes)
    desconhecidos = sorted(presentes - set(esperado))
    if len(nomes) != len(presentes):
        raise ValueError("dois dumps com o mesmo nome no diretório")
    return faltando, desconhecidos


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dumps", type=Path, help="diretório com <nome>.produto.ap")
    ap.add_argument(
        "--vectors",
        type=Path,
        default=Path("data/rex_profiles/integrator/aplib/vectors"),
    )
    ap.add_argument(
        "--oracle",
        choices=("ambos", "apultra", "apj.jar"),
        default="ambos",
        help="o padrão exige os dois oráculos; nomear um só estreita a alegação "
        "e fica impresso no cabeçalho da saída",
    )
    ap.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="teto por chamada de oráculo, em segundos. Oráculo que não "
        "responde dentro do teto é falha contada, nunca skip.",
    )
    args = ap.parse_args(argv[1:])

    escolhidos = (
        {nome for nome, _, _, _ in ORACULOS}
        if args.oracle == "ambos"
        else {args.oracle}
    )
    oraculos = oracos_prontos(escolhidos)
    if oraculos is None:
        return 1

    manifest = args.vectors / "manifest.tsv"
    if not manifest.is_file():
        print(f"FALHA: manifest ausente: {manifest}")
        return 1
    try:
        esperado = pinados(manifest)
    except ValueError as e:
        print(f"FALHA: {e}")
        return 1

    dumps = sorted(args.dumps.glob("*.produto.ap"))
    if not dumps:
        print(
            f"FALHA: nenhum *.produto.ap em {args.dumps}; gere com "
            "`RDS_APLIB_DUMP=<dir> cargo test --lib aplib_encode_dumpa`"
        )
        return 1
    try:
        faltando, desconhecidos = conjuntos(esperado, dumps)
    except ValueError as e:
        print(f"FALHA: {e}")
        return 1

    execucoes = len(esperado) * len(oraculos)
    print(f"== {len(esperado)} casos esperados (manifest.tsv) x {len(oraculos)} "
          f"oráculo(s): {', '.join(n for n, _ in oraculos)} = {execucoes} execuções")
    for nome in faltando:
        print(f"FALHA  caso ausente: {nome}.produto.ap")
    for nome in desconhecidos:
        print(f"FALHA  caso desconhecido: {nome}.produto.ap sem linha 'plain' no manifest")

    falhas: list[str] = [
        f"caso ausente: {nome}" for nome in faltando
    ] + [
        f"caso desconhecido no manifesto: {nome}" for nome in desconhecidos
    ]
    aceitos = 0
    executados = 0
    with tempfile.TemporaryDirectory(prefix="rex-aplib-oracle-") as saida_dir:
        for caminho in dumps:
            nome = caminho.name[: -len(".produto.ap")]
            if nome not in esperado:
                # Já contado em `desconhecidos`: executar um caso sem referência
                # não tem o que comparar, e chamá-lo de aprovado seria o skip
                # silencioso que este script existe para não produzir.
                continue
            for oraculo, monta in oraculos:
                executados += 1
                destino = Path(saida_dir) / f"{nome}.{oraculo}.plain"
                try:
                    comando = monta(caminho, destino)
                except FileNotFoundError as e:
                    falhas.append(f"{nome}/{oraculo}: {e}")
                    continue
                try:
                    r = subprocess.run(
                        comando, capture_output=True, text=True, timeout=args.timeout
                    )
                except subprocess.TimeoutExpired:
                    falhas.append(
                        f"{nome}/{oraculo}: timeout de {args.timeout:g}s — o oráculo "
                        "não respondeu; contado como falha, não como skip"
                    )
                    continue
                if r.returncode != 0 or not destino.is_file():
                    falhas.append(
                        f"{nome}/{oraculo}: recusou o stream do produto "
                        f"(rc={r.returncode}): {(r.stderr or r.stdout).strip()[:160]}"
                    )
                    continue
                bytes_plain = destino.read_bytes()
                obtido = sha256_bytes(bytes_plain)
                if obtido != esperado[nome]:
                    falhas.append(
                        f"{nome}/{oraculo}: plain {obtido[:12]}… != pinado "
                        f"{esperado[nome][:12]}…"
                    )
                    continue
                aceitos += 1
                print(
                    f"PASS  {nome:18} {oraculo:8} stream {caminho.stat().st_size:>6} B"
                    f" -> plain {len(bytes_plain):>6} B  {obtido[:12]}…"
                )

    print(f"\nesperado {execucoes} | executado {executados} | aprovado {aceitos} "
          f"| divergente {len(falhas)}")
    if falhas:
        print(f"{len(falhas)} divergência(s):")
        for f in falhas:
            print(f"  FAIL {f}")
        return 1
    if aceitos != execucoes:
        print(f"FALHA: {aceitos} aprovações para {execucoes} execuções esperadas")
        return 1
    print(f"OK: {aceitos}/{execucoes} execuções aprovadas, 0 divergência.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
