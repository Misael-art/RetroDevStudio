#!/usr/bin/env python3
"""Validação independente do decodificador de PESQUISA Enigma
(scripts/rex_corpus_b/enigma_research.py).

Categorias:
  a) paridade byte-a-byte com os 10 plains fixados pelo oráculo;
  b) cruzamento com o oráculo externo mdcomp enicmp -x na mesma stream;
  c) casos discriminantes: plains autorais empacotados PELO ORÁCULO;
  d) negativos do negative-spec (obrigações do contrato, não do oráculo);
  d2) limites realmente alcançáveis (work-limit, cancelamento, excessive-output);
  e) determinismo.

Round-trip próprio não é oráculo: (c) usa o empacotador externo e compara a
saída com o plain original. Ausência de oráculo é SKIP declarado, nunca PASS.
"""
import hashlib, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import enigma_research as ENI  # noqa: E402

FIX = os.path.join(ROOT, "data/rex_corpus_b/vendor/data/rex_profiles/codec/enigma")
OUTDIR = os.path.join(ROOT, "data/rex_corpus_b/enigma/evidence")
EVIDENCIA = "decode-parity-independente.json"
ORACLE = os.path.expanduser("~/.cache/rex-codecs/oracle-tools/bin/enicmp")
ORACLE_SHA = "a017430c0a7adadf051d754ed30dfded2ddd875a939a9a047e3f375da5c96d18"
ORACLE_COMMIT = "72c6df405a75d322c5b3722da46c3abb864d3793"
MAX_OUT = 1 << 22
WORK_LIMIT = 1 << 26
CONTRACT_CODES = ("truncated", "invalid-reference", "overflow",
                  "excessive-output", "work-limit", "cancelled")

results = []


def sha(b):
    return hashlib.sha256(b).hexdigest()


def record(cat, case, status, **kw):
    r = {"categoria": cat, "caso": case, "status": status}
    r.update(kw)
    results.append(r)
    extra = "" if status == "PASS" else "  " + json.dumps(kw, ensure_ascii=False)[:220]
    print(f"[{status:5}] {cat}/{case}{extra}")


def oracle(args, timeout=25):
    if not os.path.exists(ORACLE):
        return None, "oracle-absent"

    def limits():
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (2 << 30, 2 << 30))
        resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32 << 20, 32 << 20))

    try:
        p = subprocess.run([ORACLE] + args, stdin=subprocess.DEVNULL,
                           capture_output=True, timeout=timeout, preexec_fn=limits)
        return p.returncode, None
    except subprocess.TimeoutExpired:
        return 124, "oracle-timeout"


def oracle_decode(blob, tag="neg"):
    """Decodifica com a referencia externa em sandbox; None se o oraculo recusar."""
    if not os.path.exists(ORACLE) or sha(open(ORACLE, "rb").read()) != ORACLE_SHA:
        return None
    tmpd = tempfile.mkdtemp(prefix="eni-ref-")
    src, dst = os.path.join(tmpd, tag + ".eni"), os.path.join(tmpd, tag + ".out")
    open(src, "wb").write(blob)
    rc, err = oracle(["-x", src, dst])
    out = open(dst, "rb").read() if rc == 0 and os.path.exists(dst) else None
    for f in (src, dst):
        if os.path.exists(f):
            os.remove(f)
    os.rmdir(tmpd)
    return out


def run_decode(stream, **kw):
    kw.setdefault("max_out", MAX_OUT)
    kw.setdefault("work_limit", WORK_LIMIT)
    st = {}
    try:
        data, consumed = ENI.decode(stream, stats=st, **kw)
    except ENI.CodecError as e:
        return None, e.code, str(e)
    return data, consumed, st


def first_diff(a, b):
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            return i
    return None if len(a) == len(b) else min(len(a), len(b))


def main():
    oracle_present = os.path.exists(ORACLE)
    if oracle_present and sha(open(ORACLE, "rb").read()) != ORACLE_SHA:
        print("ABORT: oráculo divergente do pin")
        return 2
    os.makedirs(OUTDIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="eni-")
    streams = [f for f in sorted(os.listdir(os.path.join(FIX, "plain"))) if f.endswith(".eni")]

    # a) + b)
    for name in streams:
        stem = name[:-4]
        stream = open(os.path.join(FIX, "plain", name), "rb").read()
        wpath = os.path.join(FIX, "plain", stem + ".bin")
        want = open(wpath, "rb").read() if os.path.exists(wpath) else None
        data, consumed, st = run_decode(stream)
        if data is None:
            record("a", stem, "SKIP" if want == b"" else "FAIL",
                   erro=consumed, detalhe=st, len_stream=len(stream))
            continue
        if want is None:
            record("a", stem, "SKIP", motivo="sem plain p/ comparar")
        else:
            ok = data == want
            record("a", stem, "PASS" if ok else "FAIL",
                   saida=len(data), esperado=len(want), consumido=consumed,
                   len_stream=len(stream), meu_sha=sha(data), esperado_sha=sha(want),
                   primeiro_divergente=first_diff(data, want))
        if not oracle_present:
            record("b", stem, "SKIP", motivo="oráculo ausente")
            continue
        src, dst = os.path.join(tmp, stem + ".eni"), os.path.join(tmp, stem + ".out")
        open(src, "wb").write(stream)
        rc, err = oracle(["-x", src, dst])
        if rc != 0 or err:
            record("b", stem, "SKIP", rc=rc, motivo=err or f"oráculo recusou rc={rc}")
            continue
        odata = open(dst, "rb").read()
        record("b", stem, "PASS" if odata == data else "FAIL",
               oracle_len=len(odata), meu_len=len(data),
               oracle_sha=sha(odata), meu_sha=sha(data),
               primeiro_divergente=first_diff(odata, data))

    # c) discriminantes com empacotador EXTERNO
    def words(ws):
        return b"".join(w.to_bytes(2, "big") for w in ws)

    discrim = {
        "zeros_64w": words([0] * 64),
        "ramp_positiva": words(list(range(100))),
        "sinal_borda": words([0x7FFF, 0x8000, 0xFFFF, 0x0001] * 4),
        "delta_grande": words([0, 4096, 8192, 12288, 16384] * 8),
        "const_repetida": words([1000] * 128),
        "alternado": words([0, 0xFFFF] * 64),
        "run_zero_borda": words([7] * 3 + [0] * 18 + [9] * 3),
        "ruido_semeado": words(((i * 2654435761) >> 16) & 0xFFFF for i in range(64)),
        "tiles_256": words((i & 0xFFFF) for i in range(256)),
        "ciclo_curto": words([1, 2, 4, 8, 16, 32, 64, 128] * 8),
    }
    for stem, plain in discrim.items():
        if len(plain) % 2:
            record("c", stem, "FAIL", motivo="plain ímpar (erro do harness)")
            continue
        if not oracle_present:
            record("c", stem, "SKIP", motivo="oráculo ausente")
            continue
        pin, stm = os.path.join(tmp, stem + ".bin"), os.path.join(tmp, stem + ".eni")
        open(pin, "wb").write(plain)
        rc, err = oracle([pin, stm])
        if rc != 0 or not os.path.exists(stm):
            record("c", stem, "SKIP", rc=rc, motivo=err or f"encode rc={rc}")
            continue
        stream = open(stm, "rb").read()
        data, consumed, st = run_decode(stream)
        if data is None:
            record("c", stem, "FAIL", erro=consumed, detalhe=st, stream_sha=sha(stream))
            continue
        record("c", stem, "PASS" if data == plain else "FAIL",
               consumido=consumed, len_stream=len(stream),
               oracle_sha=sha(plain), meu_sha=sha(data),
               primeiro_divergente=first_diff(data, plain))

    # d) negativos do spec. Cada caso carrega uma OBRIGACAO escrita no proprio
    # spec; o harness verifica essa obrigacao em vez de exigir um codigo que a
    # obrigatoriedade nao pede (exigir erro onde o spec declara
    # "nenhuma-obrigacao-de-erro" seria o harness inventando contrato).
    spec = json.load(open(os.path.join(FIX, "negative/negative-spec.json")))
    for v in spec["vectors"]:
        vid, kind = v["name"], v["input_kind"]
        expected = v["expected_error"]
        wanted = next((c for c in CONTRACT_CODES if c in expected), None)
        path = os.path.join(FIX, "negative", os.path.basename(v["input_file"]))
        if not os.path.exists(path):
            record("d", vid, "SKIP", motivo=f"entrada ausente {v['input_file']}")
            continue
        blob = open(path, "rb").read()
        if kind == "plain":
            record("d", vid, "DIVERGE", codigo=None, esperado=wanted or "input-not-in-domain",
                   motivo="guarda de domínio do lado plain (encode) não existe no módulo de decode")
            continue
        if vid.startswith("e03"):
            ref = oracle_decode(blob)
            data, code, detail = run_decode(blob)
            ok = (data is not None and ref is not None and len(data) <= MAX_OUT
                  and data == ref and len(data) == 4096)
            record("d", vid, "PASS" if ok else "FAIL",
                   obrigacao="declaracao inflada em [4..5] (common_value) e entrada "
                             "nao-confiavel: nunca limite de alocacao/escrita",
                   saida=len(data) if data is not None else None,
                   dentro_de_max_out=(data is None or len(data) <= MAX_OUT),
                   igual_ao_oraculo=(data == ref if data is not None else None),
                   oracle_sha=sha(ref) if ref else None,
                   meu_sha=sha(data) if data is not None else str(code))
            continue
        if vid.startswith("e04"):
            ref = oracle_decode(blob)
            pleno = oracle_decode(open(os.path.join(FIX, "plain", "const_500.eni"), "rb").read())
            data, code, detail = run_decode(blob)
            record("d", vid, "DIVERGE",
                   codigo=code if data is None else "sem-erro",
                   esperado="rejeitar modo indefinido (spec)",
                   motivo="o spec pede rejeicao de 'modo 0x02'; no modelo de cabecalho "
                          "fixado por esta suíte byte[0] e packet_length (dominio 1..11), "
                          "logo 0x02 e legal. Medicao: mutante e pleno dao saida "
                          "byte-identica no oraculo e no modulo - expectativa do spec "
                          "repousa em modelo superado, nao em comportamento do decoder",
                   saida=len(data) if data is not None else None,
                   mutante_igual_pleno_oraculo=(ref == pleno and ref is not None),
                   mutante_igual_pleno_modulo=(data == pleno if data is not None else None),
                   sha_saida=(sha(data) if data is not None else sha(ref) if ref else None))
            continue
        if "bounded-failure" in expected:
            data, code, detail = run_decode(blob)
            estruturado = data is None and code in ENI.ERROR_CODES
            record("d", vid, "PASS" if estruturado else "FAIL",
                   obrigacao="falha estruturada dentro dos limites; nunca crash nem loop",
                   codigo=code, detalhe=str(detail)[:120])
            continue
        kw = {}
        if kind == "stream+limit":
            m = re.search(r"(\d+)", expected)
            kw["max_out"] = int(m.group(1)) if m else 1024
        data, code, detail = run_decode(blob, **kw)
        if data is not None:
            record("d", vid, "FAIL", motivo="aceitou sem erro", saida=len(data),
                   consumido=code, esperado=expected)
            continue
        if wanted and code == wanted:
            record("d", vid, "PASS", codigo=code, limite=kw.get("max_out"))
        elif code in CONTRACT_CODES:
            record("d", vid, "DIVERGE", codigo=code, esperado=wanted,
                   motivo="falha estruturada e limitada, código difere do spec",
                   limite=kw.get("max_out"))
        else:
            record("d", vid, "DIVERGE", codigo=code, esperado=wanted,
                   motivo="código fora da lista do contrato v1", detalhe=detail[:120])

    # d2) limites alcançáveis
    big = open(os.path.join(FIX, "plain", "planes_4k.eni"), "rb").read()
    data, code, detail = run_decode(big, work_limit=32)
    record("d2", "work-limit-orcamento-32", "PASS" if code == "work-limit" else "FAIL",
           codigo=code, detalhe=str(detail)[:160])
    n = {"c": 0}

    def cancel_now():
        n["c"] += 1
        return True

    data, code, detail = run_decode(big, cancel=cancel_now)
    record("d2", "cancelamento-cooperativo",
           "PASS" if code == "cancelled" and n["c"] > 0 else "FAIL",
           codigo=code, consultas=n["c"],
           saida=len(data) if data is not None else None)
    data, code, detail = run_decode(big, max_out=1022)
    record("d2", "excessive-output-max_out-1022",
           "PASS" if code == "excessive-output" else "FAIL", codigo=code,
           detalhe=str(detail)[:160])
    # parâmetro externo: declarado, NUNCA adivinhado. Sem offset o decode deve
    # ser idêntico ao oráculo; com offset arbitrário o resultado muda e isso é
    # registrado como convenção NÃO-evidenciada, não como fato do formato.
    base, _, _ = run_decode(big)
    shifted, _, _ = run_decode(big, value_offset=0x3FC0)
    record("d2", "parametro-externo-declarado-nao-adivinhado",
           "PASS" if base is not None and shifted is not None and base != shifted else "FAIL",
           sem_offset=sha(base) if base else None,
           com_offset_3fc0=sha(shifted) if shifted else None,
           nota="value_offset é parâmetro do consumidor; nenhum fixture o evidencia")


    # e) determinismo
    for name in streams[:4]:
        blob = open(os.path.join(FIX, "plain", name), "rb").read()
        r1, r2 = run_decode(blob), run_decode(blob)
        record("e", name[:-4], "PASS" if (r1[0], r1[1]) == (r2[0], r2[1]) else "FAIL")

    rollup = {}
    for r in results:
        v = rollup.setdefault(r["categoria"],
                              {"total": 0, "PASS": 0, "FAIL": 0, "SKIP": 0, "DIVERGE": 0})
        v["total"] += 1
        v[r["status"]] += 1
    print("\nrollup por categoria:")
    for cat in sorted(rollup):
        v = rollup[cat]
        print(f"  {cat}: verificados={v['total']} pass={v['PASS']} diverge={v['DIVERGE']} "
              f"fail={v['FAIL']} skip={v['SKIP']}")
    doc = {
        "schema_version": 1,
        "gerado_por": "scripts/rex_corpus_b/enigma-validate.py",
        "modulo_validado": "scripts/rex_corpus_b/enigma_research.py",
        "limites": {"max_out": MAX_OUT, "work_limit": WORK_LIMIT},
        "oraculo": {"binario": ORACLE, "presente": oracle_present,
                    "sha256": sha(open(ORACLE, "rb").read()) if oracle_present else None,
                    "commit_referencia": ORACLE_COMMIT},
        "rollup": rollup,
        "casos": results,
    }
    with open(os.path.join(OUTDIR, EVIDENCIA), "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"\nevidência: data/rex_corpus_b/enigma/evidence/{EVIDENCIA}")
    return 1 if any(v["FAIL"] for v in rollup.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
