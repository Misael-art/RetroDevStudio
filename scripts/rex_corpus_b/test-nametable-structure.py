#!/usr/bin/env python3
"""Testes de resposta conhecida do medidor de estrutura de nametable (hipotese de campos).

Nenhum caso depende de ROM: as palavras de entrada sao construidas a mao e a
resposta e sabida por construcao. Rodar:
  python3 scripts/rex_corpus_b/test-nametable-structure.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("nts", os.path.join(HERE, "nametable-structure.py"))
NTS = importlib.util.module_from_spec(spec)
spec.loader.exec_module(NTS)
spec_md = importlib.util.spec_from_file_location("md_tiles", os.path.join(HERE, "md-tiles.py"))
MD = importlib.util.module_from_spec(spec_md)
spec_md.loader.exec_module(MD)

checks = {"ok": 0, "fail": 0}
fails = []


def eq(nome, obtido, esperado):
    try:
        ok = obtido == esperado
    except Exception as e:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: avaliacao levantou {type(e).__name__}({e})")
        return
    if ok:
        checks["ok"] += 1
        print(f"[PASS] {nome}")
    else:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: esperado={esperado!r} obtido={obtido!r}")


def lancar(nome, fn, exc_esperada):
    try:
        fn()
    except exc_esperada:
        checks["ok"] += 1
        print(f"[PASS] {nome}")
        return
    except Exception as e:
        checks["fail"] += 1
        fails.append(nome)
        print(f"[FAIL] {nome}: levantou {type(e).__name__}({e}) em vez de {exc_esperada.__name__}")
        return
    checks["fail"] += 1
    fails.append(nome)
    print(f"[FAIL] {nome}: nao levantou nenhuma excecao")


# 1) DIVISAO DE CAMPOS. As POSICOES vem de fonte oficial, nao de documentacao
#    secundaria: SGDK tools/rescomp/src/sgdk/rescomp/type/Tile.java define
#    mascara de indice 0x7FF (bits10-0), HFLIP bit 11, VFLIP bit 12, PALETTE
#    bits 14-13, PRIORITY bit 15. O que continua hipotese e se uma plain
#    decodificada SE COMPORTA como entrada de nametable; a divisao em si e fato
#    de hardware.
#    Registro historico: esta secao rotulava vflip=bit14, hflip=bit13 e
#    paleta=bits12-11. As medidas bit a bit feitas com aquela tabela continuam
#    validas -- o que estava errado era a ROTULAGEM de tres campos. Os casos
#    abaixo foram reescritos contra a fonte ANTES de mexer na tabela do modulo.
eq("palavra 0x0000: todos os campos zerados",
   NTS.entry_fields(0x0000),
   {"priority": 0, "vflip": 0, "hflip": 0, "palette": 0, "tile": 0})
eq("palavra 0x8000: somente prioridade (bit15)",
   NTS.entry_fields(0x8000),
   {"priority": 1, "vflip": 0, "hflip": 0, "palette": 0, "tile": 0})
eq("palavra 0x1000: bit12 isolado = vflip, NAO paleta",
   NTS.entry_fields(0x1000),
   {"priority": 0, "vflip": 1, "hflip": 0, "palette": 0, "tile": 0})
eq("palavra 0x0800: bit11 isolado = hflip, NAO paleta",
   NTS.entry_fields(0x0800),
   {"priority": 0, "vflip": 0, "hflip": 1, "palette": 0, "tile": 0})
eq("palavra 0x2000: bit13 isolado = paleta 1 (bit pouco significativo)",
   NTS.entry_fields(0x2000),
   {"priority": 0, "vflip": 0, "hflip": 0, "palette": 1, "tile": 0})
eq("palavra 0x4000: bit14 isolado = paleta 2 (bit mais significativo)",
   NTS.entry_fields(0x4000),
   {"priority": 0, "vflip": 0, "hflip": 0, "palette": 2, "tile": 0})
eq("palavra 0x6000: bits14-13 = paleta 3",
   NTS.entry_fields(0x6000),
   {"priority": 0, "vflip": 0, "hflip": 0, "palette": 3, "tile": 0})
eq("palavra 0x07FF: dominio maximo do campo de tile (11 bits)",
   NTS.entry_fields(0x07FF),
   {"priority": 0, "vflip": 0, "hflip": 0, "palette": 0, "tile": 2047})
# Palavra-ancora compartilhada com test-md-tiles.py, que afirma
# make_entry(0x123, palette=2, hflip=1, vflip=1, priority=1) == 0xD923. Se os dois
# modulos divergirem na divisao da mesma palavra, esta resposta conhecida cai.
eq("palavra 0xD923: tile 0x123 + paleta 2 + hflip + vflip + prioridade",
   NTS.entry_fields(0xD923),
   {"priority": 1, "vflip": 1, "hflip": 1, "palette": 2, "tile": 0x123})
eq("palavra 0xE805: campos combinados",
   NTS.entry_fields(0xE805),
   {"priority": 1, "vflip": 0, "hflip": 1, "palette": 3, "tile": 5})
# NEGATIVO: a mascara de tile tem 11 bits; um bit acima dela NAO pode vazar para o
# indice (erro classique de mascara 0xFFF), senao o tile "cresce" e a hipotese
# e avaliada contra um campo que nao existe no hardware.
eq("bit11 (hflip) nao entra no campo de tile (mascara de 11 bits)",
   NTS.entry_fields(0x0801),
   {"priority": 0, "vflip": 0, "hflip": 1, "palette": 0, "tile": 1})
eq("bit13 (paleta) nao entra no campo de tile",
   NTS.entry_fields(0x2005),
   {"priority": 0, "vflip": 0, "hflip": 0, "palette": 1, "tile": 5})
lancar("word acima de 16 bits e recusada", lambda: NTS.entry_fields(0x10000), ValueError)
lancar("word negativa e recusada", lambda: NTS.entry_fields(-1), ValueError)

# 2) ESTATISTICAS CRUSAS (independentes de hipotese): o que a palavra e, nao o que
#    ela significaria. Resposta sabida por construcao.
st = NTS.word_stats([0x0000, 0x0001, 0x0001, 0x07FF, 0x4000])
eq("numero de palavras", st["palavras"], 5)
eq("valores distintos", st["distintos"], 4)
eq("minimo", st["min"], 0)
eq("maximo", st["max"], 0x4000)
eq("bit15 nunca setado aqui", st["bit15_setadas"], 0)
eq("bit14 setado uma vez (0x4000)", st["bit14_setadas"], 1)
eq("bit13 nunca setado", st["bit13_setadas"], 0)
# palette_nao_zero e o UNICO contador desta secao derivado de campo (os bit*_setadas
# acima sao posicoes cruas). Ele le a posicao da tabela CAMPOS por nome, entao nao
# pode mais dessincronizar da divisao. Bits 14-13 = paleta: 0x4000 e bit14, ou seja
# paleta 2, e conta.
eq("campo de paleta nao-zero: 0x4000 = bit14 = paleta 2, conta 1", st["palette_nao_zero"], 1)
eq("hflip/vflip (bits 11 e 12) nao contam como paleta",
   NTS.word_stats([0x0800, 0x1000])["palette_nao_zero"], 0)
eq("delta adjacente mais frequente", st["deltas_top"][0], (0, 1))
# O total de zeros e medido a parte: em plains de jogo almofadados com 0x0000 a
# maioria bruta decide sozinha qualquer "periodo" por igualdade, e o leitor
# precisa ver a proporcao, nao so o fracao de igualdade.
eq("zeros contamados separadamente", NTS.word_stats([0, 0, 1, 2, 0])["zeros"], 3)
eq("zeros contamados em lista com um zero", st["zeros"], 1)
eq("fracao de zeros explicita", NTS.word_stats([0, 0, 1, 2, 0])["fracao_zeros"], 0.6)
# NEGATIVO: palavras com bit15 SETADO devem ser contadas — senao a ausencia de
# prioridade seria lida como dado onde ha sinal contrario.
st2 = NTS.word_stats([0x8000, 0x8001, 0xFFFF])
eq("bit15 setado contado", st2["bit15_setadas"], 3)
eq("maximo do dominio de 16 bits", st2["max"], 0xFFFF)
eq("palavras vazias produzem estatisticas neutras, nao excecao",
   NTS.word_stats([]),
   {"palavras": 0, "distintos": 0, "min": None, "max": None,
    "bit15_setadas": 0, "bit14_setadas": 0, "bit13_setadas": 0,
    "palette_nao_zero": 0, "deltas_top": [], "zeros": 0, "fracao_zeros": None})

# 3) PERIODO VERTICAL por largura de linha. Construa um mapa de 4 linhas x 16
#    colunas em que TODAS as linhas repetem o mesmo conteudo: entao a igualdade
#    com passo 16 e total (fracao 1.0) e o periodo e a propria largura.
lin = list(range(1, 17))                     # 16 palavras por linha
mapa = lin * 4
per = NTS.vertical_periods(mapa, widths=range(4, 33))
eq("periodo vertical detectado na largura construida", per["candidatos"],
   [{"largura": 16, "fracao_iguais": 1.0}])
eq("nenhum outro largura atinge o minimo", per["ambigua"], False)
eq("larguras abaixo do minimo nao viram candidato",
   [c["largura"] for c in per["candidatos"] if c["largura"] != 16], [])
# NEGATIVO: array constante — TODAS as larguras empatam em 1.0, entao o detector
# nao pode escolher uma e chama-la periodo. Tem de se declarar ambiguo.
const = [0x1234] * 32
pc = NTS.vertical_periods(const, widths=range(4, 33))
eq("array constante e reportada como ambigua", pc["ambigua"], True)
eq("array constante nao produce periodo afirmativo", pc["candidatos"], [])
# NEGATIVO: dados sem periodicidade nenhuma nao podem gerar candidato.
sem = [i * 7919 & 0xFFFF for i in range(64)]
eq("sem periodicidade: nenhum candidato",
   NTS.vertical_periods(sem, widths=range(4, 33))["candidatos"], [])
# deslocamento vertical constante (padrao de rolagem): igualdade nao, delta sim.
# Duas linhas de 16 colunas em que a linha 2 e a linha 1 + 16 em cada coluna:
# nenhum par com passo 16 e igual, e todos os 16 pares tem delta +16.
linha1 = list(range(16))
linha2 = [(v + 16) & 0xFFFF for v in linha1]
degrau = linha1 + linha2
eq("pares comparaveis no passo construido",
   NTS.stride_repetition(degrau, 16)["pares_comparaveis"], 16)
eq("delta vertical dominante detectado",
   NTS.stride_repetition(degrau, 16)["delta_mais_frequente"], 16)
eq("fracao de igualdade nula quando so ha delta constante",
   NTS.stride_repetition(degrau, 16)["fracao_iguais"], 0.0)
eq("passo maior que o numero de palavras nao inventa nada",
   NTS.stride_repetition([1, 2, 3], 16),
   {"largura": 16, "fracao_iguais": None, "delta_mais_frequente": None,
    "pares_comparaveis": 0})

# 3b) MODO MASCARA (palavra != 0). Em plain almofadado com 0x0000 a maioria dos
#     pares "iguais" e par de zeros: a igualdade bruta nao distingue o passo real.
#     Construa 4 linhas DISTINTAS de 10 colunas, cada linha completada com zeros
#     ate 32 palavras: o periodo da mascara e 32 por construcao, e o conteudo
#     muda linha a linha (entao so a mascara da o passo).
def mapa_almofadado(linhas=4, cols=10, largura=32):
    out = []
    for r in range(linhas):
        out += [0x0100 + r * 0x10 + c for c in range(cols)] + [0] * (largura - cols)
    return out


mp = mapa_almofadado()
eq("projecao nao_zero", [NTS.nao_zero(v) for v in (0, 1, 0x8000)], [False, True, True])
eq("modo mascara encontra a largura construida",
   NTS.vertical_periods(mp, widths=range(4, 41), project=NTS.nao_zero)["candidatos"],
   [{"largura": 32, "fracao_iguais": 1.0}])
eq("modo mascara nao se declara ambiguo na largura construida",
   NTS.vertical_periods(mp, widths=range(4, 41), project=NTS.nao_zero)["ambigua"], False)
eq("fracao bruta na mesma largura e rejeitada pelo minimo (0.6875 < 0.75)",
   NTS.stride_repetition(mp, 32)["fracao_iguais"], 0.6875)
# NEGATIVO: so padding (tudo zero) nao tem periodo — a mascara e constante e o
# detector tem de se declarar ambiguo, nao afirmar 4, 8 ou 32.
eq("padding puro e ambiguo no modo mascara",
   NTS.vertical_periods([0] * 96, widths=range(4, 41), project=NTS.nao_zero),
   {"candidatos": [], "ambigua": True})
# NEGATIVO: zeros espalhados sem periodicidade nao geram candidato.
soltos = [0] * 96
for i in (3, 17, 40, 55, 71, 88):
    soltos[i] = 0x0101

# 3c) CONCORDANCIA CORRIGIDA POR ACASO (kappa). A igualdade bruta e inflada pelo
#     padding: num plain com 80% de zeros, qualquer passo "concorda" quase sempre.
#     O kappa mede apenas o acordo que EXCEDE o acaso, entao padding sozinho nao
#     produce periodo. Respostas sabidas por construcao no mapa almofadado.
eq("kappa 1.0 quando o passo reproduz a mascara exatamente",
   NTS.stride_kappa(mp, 32, project=NTS.nao_zero),
   {"largura": 32, "concordancia": 1.0, "acaso": 0.570312, "kappa": 1.0,
    "pares_comparaveis": 96})
eq("kappa indefinido quando todos os itens sao iguais (nao vira 1.0)",
   NTS.stride_kappa([0] * 32, 8, project=NTS.nao_zero),
   {"largura": 8, "concordancia": 1.0, "acaso": 1.0, "kappa": None,
    "pares_comparaveis": 24})
eq("kappa nao calculavel sem pares comparaveis",
   NTS.stride_kappa([1, 2], 8),
   {"largura": 8, "concordancia": None, "acaso": None, "kappa": None,
    "pares_comparaveis": 0})
eq("periodo por kappa na largura construida",
   NTS.period_candidates(mp, widths=range(4, 41), project=NTS.nao_zero),
   {"candidatos": [{"largura": 32, "kappa": 1.0, "concordancia": 1.0}],
    "ambigua": False})
eq("passos vizinhos do verdadeiro ficam abaixo do maximo (31 nao ganha)",
   NTS.stride_kappa(mp, 31, project=NTS.nao_zero)["kappa"] < 1.0, True)
# NEGATIVO: padding puro (mascara constante) nao tem periodo; o detector recusa.
eq("padding puro: kappa indefinido e o detector se declara ambiguo",
   NTS.period_candidates([0] * 96, widths=range(4, 41), project=NTS.nao_zero),
   {"candidatos": [], "ambigua": True})
# NEGATIVO: esparsos sem periodicidade — o acordo residual e explicavel pelo
# acaso, entao kappa fica perto de zero e nenhum candidato passa do minimo.
eq("sparse sem periodo: nenhum candidato, nenhuma ambiguidade",
   NTS.period_candidates(soltos, widths=range(4, 41), project=NTS.nao_zero),
   {"candidatos": [], "ambigua": False})

# 4) MASCARA DE HIPOTESE: o medidor deve rotular a hipotese como HIPOTESE, com o
#    veredito derivado das medidas — nunca hardcoded.
eq("resumo da hipotese traz as fontes de campo",
   sorted(NTS.HIPOTESE_CAMPOS.keys()),
   ["hflip", "palette", "priority", "tile", "vflip"])
eq("dominio do campo de tile declarado na hipotese", NTS.HIPOTESE_CAMPOS["tile"], (0, 0x7FF))
eq("posicoes dos campos batem com Tile.java (indice 0-10, hflip 11, vflip 12, paleta 13-14, prioridade 15)",
   {k: NTS.CAMPOS[k][:2] for k in sorted(NTS.CAMPOS)},
   {"hflip": (11, 11), "palette": (13, 14), "priority": (15, 15),
    "tile": (0, 10), "vflip": (12, 12)})
# Consistencia entre modulos da mesma frente: os dois leem a MESMA palavra de
# nametable. Sem isto, um rotulo corrigido em um arquivo e esquecido no outro.
eq("este medidor e md-tiles.py dividem a mesma divisao de palavra",
   [NTS.entry_fields(w) for w in (0x0000, 0x0800, 0x1000, 0x2000, 0x4000, 0xD923, 0xFFFF)],
   [MD.nametable_entry(w) for w in (0x0000, 0x0800, 0x1000, 0x2000, 0x4000, 0xD923, 0xFFFF)])
lancar("hipotese nao aceita campo desconhecido",
       lambda: NTS.fields_from_words([0x0001], "naoexiste"), KeyError)

print(f"\nverificacoes: {checks['ok']} pass / {checks['fail']} fail")
if fails:
    print("falhas:", *fails, sep="\n  - ")
sys.exit(1 if checks["fail"] else 0)
