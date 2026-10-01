#!/usr/bin/env python3
"""Reclassifica as evidencias Sonic 1 do confirm-by-reference contra as regras da missao.

O JSON original rotulou `decoded` qualquer decode rc=0 do oraculo. Regras
corretas (medidas):
  * `sai_do_arquivo` (tellg = -1) => leitura alem do EOF: FALSA ACEITACAO do
    oraculo, nao recurso;
  * decode fora do dominio do formato (packet_length 0) => FALSA ACEITACAO;
  * codec so pode ser atribuido com o CONSUMIDOR: 0x662f4 foi listado como
    `nemesis raw` (90592 B) e tambem `enigma` (4096 B) — o consumidor medido
    chama $171E (Enigma) com d0=0, logo a atribuicao nemesis e INCORRETA;
  * mesmo offset, dois codecs => associao incorreta registrada, vence a que o
    consumidor prova.

Saida: data/rex_corpus_b/recursos/sonic1-classificacao.json (dentro da arvore).
"""
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def spec(nome, caminho):
    s = importlib.util.spec_from_file_location(nome, caminho)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


def main(argv=None):
    ENI = spec("eni", HERE / "enigma_research.py")
    NEM = spec("nem", HERE / "nemesis_research.py")

    ref = json.loads((ROOT / "data/rex_corpus_b/recursos/sonic1-confirm-by-reference.json")
                     .read_text())
    rom_path = ref["rom"]["caminho"]
    rom = open(rom_path, "rb").read()
    sha_rom = ref["rom"]["sha256_arquivo"]
    if hashlib_sha := __import__("hashlib").sha256(rom).hexdigest() != sha_rom:
        raise SystemExit(f"[pin] SHA da ROM diverge: {hashlib_sha}")

    mapa_json = ROOT / "data/rex_corpus_b/recursos/sonic1-mapa-0x65432.json"
    consumidor_json = ROOT / "data/rex_corpus_b/recursos/consumidor-sonic1-mapas.json"
    mapa = json.loads(mapa_json.read_text()) if mapa_json.exists() else None
    consumidor = json.loads(consumidor_json.read_text()) if consumidor_json.exists() else None

    classificacoes = []
    for res in ref["resultados"]:
        offset = res["offset"]
        o = int(offset, 16)
        linhas = []
        for p in res["por_codec"]:
            codec = p["codec"]
            status = p.get("status")
            motivo = None
            classe = "nao-recurso"
            if codec == "enigma":
                try:
                    dados, consumido = ENI.decode(rom[o:], max_out=1 << 20, work_limit=1 << 24)
                    dentro = o + consumido <= len(rom)
                    classe = "recurso" if dentro else "falsa-aceitacao (le alem do EOF)"
                    motivo = f"meu decode {len(dados)} B, consumido {consumido}, dentro={dentro}"
                except ENI.CodecError as e:
                    classe = "fora-do-dominio"
                    motivo = f"meu decoder recusa: {type(e).__name__}: {str(e)[:80]}"
            elif codec == "nemesis":
                try:
                    r = NEM.decode(rom, max_out=1 << 20, work_limit=1 << 24, offset=o)
                    dentro = o + r.bytes_consumed <= len(rom)
                    classe = "recurso" if dentro else "falsa-aceitacao (le alem do EOF)"
                    motivo = f"meu decode {len(r.data)} B, consumido {r.bytes_consumed}, dentro={dentro}"
                except NEM.NemesisError as e:
                    classe = "nao-recurso"
                    motivo = f"meu decoder recusa: {type(e).__name__}: {str(e)[:80]}"
            if p.get("sai_do_arquivo"):
                classe = "falsa-aceitacao do oraculo (tellg=-1: le alem do EOF)"
            linhas.append({"codec": codec, "status_oraculo": status,
                           "oraculo_output": p.get("output_size"),
                           "classificacao_final": classe, "motivo": motivo})

        enigma_ok = any(l["codec"] == "enigma" and l["classificacao_final"] == "recurso"
                        for l in linhas)
        if enigma_ok:
            final = "recurso (enigma)"
            for l in linhas:
                if l["codec"] == "nemesis" and l["status_oraculo"] == "decoded":
                    l["associacao_incorreta"] = ("mesmo offset decodifica como enigma "
                                                  "confirmado pelo consumidor; atribuicao "
                                                  "nemesis do oraculo nao tem consumidor")
        classificacoes.append({"offset": offset, "por_codec": linhas,
                               "final": final if enigma_ok else "nao-recurso"})

    doc = {
        "schema_version": "rex-corpus-b/sonic1-classificacao/1",
        "gerado_por": "scripts/rex_corpus_b/classificar-sonic1.py",
        "rom": {"caminho": rom_path, "sha256": sha_rom, "size_bytes": len(rom)},
        "regra": "codec e recurso so existem com span dentro do arquivo e consumidor; "
                 "decode rc=0 do oraculo que le alem do EOF e falsa aceitacao",
        "consumidor_medido": {
            "evidencia": str(consumidor_json.name) if consumidor else None,
            "composicao": str(mapa_json.name) if mapa else None,
            "unico_jsr_para_171E": "0x1b6d2, com value_offset d0=0 e destino $FF4000",
        },
        "classificacoes": classificacoes,
        "resumo": {
            "recursos": sum(1 for c in classificacoes if c["final"].startswith("recurso")),
            "nao-recursos": sum(1 for c in classificacoes if c["final"] == "nao-recurso"),
        },
    }
    saida = ROOT / "data/rex_corpus_b/recursos/sonic1-classificacao.json"
    saida.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print("[classificacao]", doc["resumo"])
    for c in classificacoes:
        print(f'  {c["offset"]}: {c["final"]}')
    print("evidencia:", saida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
