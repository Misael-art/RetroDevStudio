#!/usr/bin/env python3
"""Mede a ESTRUTURA de plains decodificadas contra a hipotese de entrada de nametable MD.

Escopo deliberado: medir, nao montar. Este script nao compoe imagem, nao escolhe
paleta e nao afirma que um plain seja um tilemap. Ele responde a duas perguntas
verificaveis:

  1) As palavras tem a assinatura de distribicao esperada de uma tabela de
     entradas de nametable (bit15 prioridade, bit14 vflip, bit13 hflip,
     bits12-11 paleta, bits10-0 indice de tile)?
  2) Existe periodo vertical (largura de linha) nas palavras? Medido de quatro
     maneiras e reportado junto: igualdade dos valores crus, igualdade da mascara
     "palavra != 0", e as versoes corrigidas pelo acaso (kappa). A mascara e a
     correcao existem porque plains de jogo sao almofadados com 0x0000, e ai a
     igualdade bruta sobe em QUALQUER passo — so ela nao prova periodo.

A divisao de campos e uma HIPOTESE vinda da documentacao publica do VDP, nao uma
propriedade da stream: as saidas sao rotuladas `hipotese_*` e o veredito e sempre
derivado das medidas. Um plain que viola a hipotese (por ex. bit15 setado) e
reportado como violacao, nao como "outro formato".

Uso (somente-leitura no corpus):
  python3 scripts/rex_corpus_b/nametable-structure.py --rom CAMINHO \
      --offset 0x65432 [--offset ...] --out data/rex_corpus_b/recursos/x.json
Testes de resposta conhecida: test-nametable-structure.py (nao dependem de ROM).
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import struct
import sys
import zipfile
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_VERSION = "rex-corpus-b/nametable-structure/1"

# --- Hipotese de campos da entrada de nametable (Mega Drive / VDP) --------------
# (bit_inicial, bit_final, dominio_de_valor). O dominio e o que o HARDWARE
# representa; um valor fora dele e uma violacao da hipotese, nao um campo valido.
CAMPOS = {
    "priority": (15, 15, (0, 1)),
    "vflip": (14, 14, (0, 1)),
    "hflip": (13, 13, (0, 1)),
    "palette": (11, 12, (0, 3)),
    "tile": (0, 10, (0, 0x7FF)),
}
HIPOTESE_CAMPOS = {k: (v[2][0], v[2][1]) for k, v in CAMPOS.items()}
DELTA_TOP = 12
MIN_FRAC = 0.75
MIN_KAPPA = 0.6
CASAS = 6


def _extrai(word, lo, hi):
    return (word >> lo) & ((1 << (hi - lo + 1)) - 1)


def nao_zero(word):
    """Projecao 'tem conteudo': ignora o VALOR e preserva so a almofada."""
    return word != 0


def entry_fields(word):
    """Divide uma palavra de 16 bits pelos campos da HIPOTESE (nome, nao prova)."""
    if not isinstance(word, int) or isinstance(word, bool):
        raise ValueError(f"palavra precisa ser int, veio {type(word).__name__}")
    if not (0 <= word <= 0xFFFF):
        raise ValueError(f"palavra {word!r} fora do dominio de 16 bits (0..0xFFFF)")
    return {k: _extrai(word, lo, hi) for k, (lo, hi, _) in CAMPOS.items()}


def fields_from_words(words, name):
    """Valores de um unico campo hipotetico sobre todas as palavras."""
    lo, hi, _ = CAMPOS[name]          # KeyError em campo nao catalogado
    return [_extrai(w, lo, hi) for w in words]


def _delta(a, b):
    """Diferenca b-a enrolada para [-32768, 32767]: deltas de estouro de 16 bits
    permanecem na mesma escala que o consumidor do mapa veria."""
    d = (b - a) & 0xFFFF
    return d - 0x10000 if d >= 0x8000 else d


def _ordena_deltas(counter):
    # Empate: menor magnitude primeiro (mudanca "zero" nao deve perder o topo por
    # ordem de insercao), depois o valor.
    return sorted(counter.items(), key=lambda kv: (-kv[1], abs(kv[0]), kv[0]))


def word_stats(words):
    """Estatisticas CRUSAS das palavras (independentes de qualquer hipotese)."""
    if not words:
        return {"palavras": 0, "distintos": 0, "min": None, "max": None,
                "bit15_setadas": 0, "bit14_setadas": 0, "bit13_setadas": 0,
                "palette_nao_zero": 0, "deltas_top": [], "zeros": 0,
                "fracao_zeros": None}
    deltas = Counter(_delta(words[i], words[i + 1]) for i in range(len(words) - 1))
    zeros = sum(1 for w in words if w == 0)
    return {
        "palavras": len(words),
        "distintos": len(set(words)),
        "min": min(words),
        "max": max(words),
        "zeros": zeros,
        "fracao_zeros": round(zeros / len(words), CASAS),
        "bit15_setadas": sum(1 for w in words if w & 0x8000),
        "bit14_setadas": sum(1 for w in words if w & 0x4000),
        "bit13_setadas": sum(1 for w in words if w & 0x2000),
        "palette_nao_zero": sum(1 for w in words if _extrai(w, 11, 12)),
        "deltas_top": _ordena_deltas(deltas)[:DELTA_TOP],
    }


def stride_repetition(words, width, project=None):
    """Compara cada palavra com a que esta `width` posicoes a frente.

    `project` (por ex. nao_zero) troca o QUE e comparado; os deltas continuam
    sendo dos valores crus, porque delta de booleano nao significa nada.
    """
    n = len(words) - width
    if n <= 0:
        return {"largura": width, "fracao_iguais": None,
                "delta_mais_frequente": None, "pares_comparaveis": 0}
    itens = [project(w) for w in words] if project else list(words)
    iguais = sum(1 for i in range(n) if itens[i] == itens[i + width])
    deltas = Counter(_delta(words[i], words[i + width]) for i in range(n))
    top = _ordena_deltas(deltas)[0]
    return {"largura": width,
            "fracao_iguais": round(iguais / n, CASAS),
            "delta_mais_frequente": top[0],
            "pares_comparaveis": n}


def stride_kappa(items, width, project=None):
    """Concordancia entre a sequencia e ela mesma deslocada de `width`, corrigida
    pelo acaso (kappa de Cohen, duas "avaliacoes" sobre a mesma populacao).

    Numerador/denominador usam po = pares iguais / pares e pe = soma das
    probabilidades ao quadrado da distribuicao projetada inteira. Com pe == 1
    (projecao constante: so padding, ou so zeros) o kappa e INDEFINIDO e e
    reportado como None — nunca como 1.0, que leria "periodo perfeito" onde nao
    ha informacao alguma.
    """
    itens = [project(w) for w in items] if project else list(items)
    n = len(itens) - width
    if n <= 0:
        return {"largura": width, "concordancia": None, "acaso": None,
                "kappa": None, "pares_comparaveis": 0}
    iguais = sum(1 for i in range(n) if itens[i] == itens[i + width])
    po = iguais / n
    dist = Counter(itens)
    total = len(itens)
    pe = sum((c / total) ** 2 for c in dist.values())
    k = None if pe >= 1.0 else (po - pe) / (1.0 - pe)
    return {"largura": width, "concordancia": round(po, CASAS),
            "acaso": round(pe, CASAS),
            "kappa": None if k is None else round(k, CASAS),
            "pares_comparaveis": n}


def _fundamentais(vencedores, chave):
    """Empatados no melhor indice, mantendo so os menores nao-multiplas."""
    out = []
    for v in sorted(vencedores, key=chave):
        if any(chave(v) % chave(o) == 0 for o in out):
            continue
        out.append(v)
    return out


def vertical_periods(words, widths=range(4, 65), min_frac=MIN_FRAC, project=None):
    """Larguras em que a sequencia se repete, pelo criterio da igualdade bruta.

    So entram larguras com fracao >= min_frac; dentre elas vence a MAIOR fracao
    (um passo vizinho do verdadeiro concorda em quase tudo e nao pode empatar com
    ele). Empate real acima de um periodo fundamental -> ambiguo.
    """
    medidas = [stride_repetition(words, w, project=project)
               for w in sorted(widths) if w < len(words)]
    validas = [m for m in medidas if m["fracao_iguais"] is not None
               and m["fracao_iguais"] >= min_frac]
    if not validas:
        return {"candidatos": [], "ambigua": False}
    melhor = max(m["fracao_iguais"] for m in validas)
    empat = _fundamentais([m for m in validas if m["fracao_iguais"] == melhor],
                          lambda m: m["largura"])
    ambigua = len(empat) > 1
    return {"candidatos": [] if ambigua else
            [{"largura": m["largura"], "fracao_iguais": m["fracao_iguais"]}
             for m in empat],
            "ambigua": ambigua}


def period_candidates(items, widths=range(4, 65), min_kappa=MIN_KAPPA, project=None):
    """Periodo vertical pelo kappa: exige acordo que EXCEDE o acaso.

    Numeros de igualdade bruta sobem sozinhos quando o plain e almofadado com
    0x0000; o kappa nao sobe. Se nenhuma largura tem kappa definido (projecao
    constante), o resultado e ambiguo por definicao: sem variacao nao ha periodo
    a medir.
    """
    medidas = [stride_kappa(items, w, project=project)
               for w in sorted(widths) if w < len(items)]
    definidos = [m for m in medidas if m["kappa"] is not None]
    if not definidos:
        return {"candidatos": [], "ambigua": True}
    acima = [m for m in definidos if m["kappa"] >= min_kappa]
    if not acima:
        return {"candidatos": [], "ambigua": False}
    melhor = max(m["kappa"] for m in acima)
    empat = _fundamentais([m for m in acima if m["kappa"] == melhor],
                          lambda m: m["largura"])
    ambigua = len(empat) > 1
    return {"candidatos": [] if ambigua else
            [{"largura": m["largura"], "kappa": m["kappa"],
              "concordancia": m["concordancia"]} for m in empat],
            "ambigua": ambigua}


def load_rom(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if not n.startswith("__MACOSX")]
            cand = [n for n in names
                    if os.path.splitext(n)[1].lower() in (".bin", ".md", ".gen", ".smd")] or names
            best = max((z.getinfo(n) for n in cand), key=lambda i: i.file_size)
            return z.read(best.filename), {"kind": "zip", "member": best.filename,
                                           "member_size": best.file_size,
                                           "member_crc32": format(best.CRC, "08x")}
    with open(path, "rb") as f:
        data = f.read()
    return data, {"kind": "raw", "member": os.path.basename(path),
                  "member_size": len(data)}


def load_enigma():
    spec = importlib.util.spec_from_file_location("eni_research",
                                                 os.path.join(HERE, "enigma_research.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def measure_stream(data, offset, eni):
    """Decodifica IN LOCO na ROM (sem recorte manual) e mede as palavras."""
    out = {"offset": hex(offset)}
    try:
        plain, consumed = eni.decode(data[offset:])
    except eni.CodecError as e:
        out["erro"] = f"{e.code}: {e.detail}"
        return out
    if len(plain) % 2:
        out["limitacao"] = f"saida impar ({len(plain)} B): dominio de int16 violado"
        return out
    words = list(struct.unpack(f">{len(plain) // 2}H", plain))
    head = data[offset:offset + 6]
    out.update({
        "codec": "enigma",
        "header_evidenciado": {
            "packet_length": head[0],
            "mask_byte": head[1],
            "incrementing_value": int.from_bytes(head[2:4], "big"),
            "common_value": int.from_bytes(head[4:6], "big"),
        },
        "input_span": hex(consumed),
        "output_size": len(plain),
        "output_sha256": hashlib.sha256(plain).hexdigest(),
        "palavras": len(words),
        "estatisticas_crusas": word_stats(words),
        "hipotese_campos": HIPOTESE_CAMPOS,
        "hipotese_histogramas": {
            k: dict(sorted(Counter(fields_from_words(words, k)).items()))
            for k in CAMPOS
        },
        "periodos_bruto_cru": vertical_periods(words),
        "periodos_bruto_mascara": vertical_periods(words, project=nao_zero),
        "periodos_kappa_cru": period_candidates(words),
        "periodos_kappa_mascara": period_candidates(words, project=nao_zero),
        "rank_larguras_bruto_cru": _rank(words, None),
        "rank_larguras_bruto_mascara": _rank(words, nao_zero),
    })
    # Verificacao da hipotese. A checagem de dominio e estruturalmente VAZIA para
    # 16 bits (todo word cabe nos cinco campos), então ela nao discrimina nada e é
    # registrada como tal. O que discrimina e a faixa do campo de tile contra o
    # recurso de artes — vinculo ainda NAO comprovado, portanto nao julgado aqui.
    viol = {}
    for k, (lo_bit, hi_bit, (dmin, dmax)) in CAMPOS.items():
        vals = fields_from_words(words, k)
        fori = sum(1 for v in vals if not (dmin <= v <= dmax))
        if fori:
            viol[k] = fori
    tiles = fields_from_words(words, "tile")
    out["verificacao_hipotese"] = {
        "violacoes_de_dominio": viol,
        "violacoes_de_dominio_discriminam": False,
        "tile_distintos": len(set(tiles)),
        "tile_min": min(tiles),
        "tile_max": max(tiles),
        "palavras_tile_fora_de_0x0_0x7FF": sum(1 for t in tiles if not 0 <= t <= 0x7FF),
    }
    return out


def _rank(words, project, top=6, widths=range(4, 65)):
    """As `top` larguras com maior igualdade bruta — a margem do vencedor fica
    visivel, para o leitor conferir que 32 nao e escolha arbitraria."""
    medidas = [stride_repetition(words, w, project=project)
               for w in widths if w < len(words)]
    medidas = [m for m in medidas if m["fracao_iguais"] is not None]
    medidas.sort(key=lambda m: (-m["fracao_iguais"], m["largura"]))
    return [{"largura": m["largura"], "fracao_iguais": m["fracao_iguais"],
             "pares_comparaveis": m["pares_comparaveis"]} for m in medidas[:top]]


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rom", required=True)
    ap.add_argument("--offset", action="append", required=True,
                    help="offset da stream na ROM (0x...), repetivel")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    data, origem = load_rom(a.rom)
    eni = load_enigma()
    doc = {
        "schema_version": SCHEMA_VERSION,
        "gerado_em": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "rom": a.rom,
        "rom_sha256": hashlib.sha256(data).hexdigest(),
        "origem": origem,
        "tamanho_rom": len(data),
        "decoder": "scripts/rex_corpus_b/enigma_research.py (pesquisa isolada, nao o codec do produto)",
        "metodo": "decode in-loco no arquivo, sem recorte; palavras como int16 BE",
        "purpose": "medir distribuicao e periodo; NAO compor imagem nem afirmar tilemap",
        "streams": [measure_stream(data, int(x, 16), eni) for x in a.offset],
        "limitacoes": [
            "A divisao de campos e HIPOTESE de documentacao publica do VDP; nada aqui prova que as palavras sejam entradas de nametable.",
            "Nenhum vinculo comprovado entre mapa, tiles e paleta: permanecem recursos separados. Nenhuma imagem e montada.",
            "value_offset (base de tile) e parametro EXTERNO nao evidenciado: nao aplicado.",
            "Larguras testadas: 4..64 palavras. Mapa mais largo, irregular ou com linhas de comprimentos diferentes nao e detectado.",
            "Igualdade bruta e inflada pelo padding: em plain dominado por 0x0000 quase todo passo 'repete'. Os campos periodos_kappa_* separam o acordo que excede o acaso; os campos periodos_bruto_* ficam registrados como contexto, nao como veredito.",
            "kappa sobre os VALORES crus nao atinge o minimo em plain almofadado (so o acordo casual ja vale ~0.7): 'periodos_kappa_cru=nenhum' e o resultado esperado, nao ausencia de periodo.",
            "violacoes_de_dominio e estruturalmente vazia em 16 bits (todo word cabe nos cinco campos) e por isso vem marcada como nao discriminante; o que discrimina e a faixa do indice de tile contra o recurso de artes, ainda nao vinculado.",
            "Ausencia de violacao nao e prova de pertenca: um int16 comum tambem tem bit15 limpo.",
            "deltas_top sao pares [delta, contagem] em ordem de contagem decrescente, empate por menor magnitude.",
        ],
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False, sort_keys=False)
        f.write("\n")
    print(f"[ok] {a.out}: {len(doc['streams'])} stream(s) medidas em "
          f"{os.path.basename(a.rom)} (rom_sha256 {doc['rom_sha256'][:12]}…)")

    def fmt(d):
        if d["ambigua"]:
            return "AMBIGUO (nenhum passo afirmado)"
        if not d["candidatos"]:
            return "nenhum"
        return " ".join(
            f"{c['largura']}@{c.get('kappa', c.get('fracao_iguais'))}"
            for c in d["candidatos"])

    for s in doc["streams"]:
        if "erro" in s:
            print(f"  {s['offset']}: ERRO {s['erro']}")
            continue
        e = s["estatisticas_crusas"]
        v = s.get("verificacao_hipotese", {})
        print(f"  {s['offset']}: {s['palavras']} palavras, distintos={e['distintos']}, "
              f"zeros={e['zeros']} ({e['fracao_zeros']}), max={hex(e['max'])}, "
              f"bit15={e['bit15_setadas']}, tile {hex(v.get('tile_min', 0))}.."
              f"{hex(v.get('tile_max', 0))} ({v.get('tile_distintos')} distintos)")
        print(f"      periodo bruto-cru={fmt(s['periodos_bruto_cru'])} | "
              f"bruto-mascara={fmt(s['periodos_bruto_mascara'])} | "
              f"kappa-cru={fmt(s['periodos_kappa_cru'])} | "
              f"kappa-mascara={fmt(s['periodos_kappa_mascara'])}")
        print(f"      margem (largura@igualdade): "
              + " ".join(f"{r['largura']}@{r['fracao_iguais']}"
                         for r in s["rank_larguras_bruto_mascara"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
