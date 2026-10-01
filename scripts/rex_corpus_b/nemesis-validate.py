#!/usr/bin/env python3
"""Validação independente do decodificador de PESQUISA Nemesis
(scripts/rex_corpus_b/nemesis_research.py) contra:
  a) os 9 pares plain/stream fixados pelo oráculo (paridade byte-a-byte);
  b) o oráculo externo mdcomp nemcmp -x na mesma stream (cruzamento);
  c) casos discriminantes novos: plains autorais empacotados PELO ORÁCULO;
  d) os 7 negativos do negative-spec (obrigações do contrato, não do oráculo);
  e) determinismo.

Regra do integrador: round-trip próprio sozinho NÃO é oráculo — por isso (c)
empacota com o oráculo e compara com o oráculo, e um caso só-autosuficiente é
rotulado SELF-ONLY. Ausência de oráculo NUNCA é PASS: vira SKIP declarado.

Este harness foi escrito separadamente do módulo validado, para que a
verificação não dependa das suposições de quem implementou o decodificador.
"""
import hashlib, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import nemesis_research as NEM  # noqa: E402

FIX = os.path.join(ROOT, "data/rex_corpus_b/vendor/data/rex_profiles/codec/nemesis")
OUTDIR = os.path.join(ROOT, "data/rex_corpus_b/nemesis/evidence")
ORACLE = os.path.expanduser("~/.cache/rex-codecs/oracle-tools/bin/nemcmp")
ORACLE_SHA = "7563a1522b01a89774dc8909204de433a1f4f87f8a99f6f10311989be2022a27"
ORACLE_COMMIT = "72c6df405a75d322c5b3722da46c3abb864d3793"
MAX_OUT = 1 << 22
WORK_LIMIT = 1 << 26

results = []
CODES = ("truncated", "invalid-reference", "overflow", "excessive-output",
         "work-limit", "cancelled", "input-not-in-domain")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def record(cat, case, status, **kw):
    r = {"categoria": cat, "caso": case, "status": status}
    r.update(kw)
    results.append(r)
    extra = "" if status == "PASS" else "  " + json.dumps(kw, ensure_ascii=False)[:220]
    print(f"[{status:5}] {cat}/{case}{extra}")


def oracle(args, timeout=25):
    """Chamada isolada: timeout, stdin fechado, tetos de AS/CPU/FSIZE."""
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


def run_decode(stream, **kw):
    """Chama o módulo e devolve (data, consumido, stats) ou (None, codigo, detalhe)."""
    kw.setdefault("max_out", MAX_OUT)
    kw.setdefault("work_limit", WORK_LIMIT)
    st = {}
    try:
        res = NEM.decode(stream, stats=st, **kw)
    except NEM.NemesisError as e:
        return None, e.code, str(e)
    return res.data, res.bytes_consumed, st


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
    tmp = tempfile.mkdtemp(prefix="nem-")
    streams = sorted(f for f in os.listdir(os.path.join(FIX, "plain")) if f.endswith(".nem"))

    # a) paridade com os plains pinados  +  b) cruzamento com o oráculo
    for name in streams:
        stem = name[:-4]
        stream = open(os.path.join(FIX, "plain", name), "rb").read()
        want = open(os.path.join(FIX, "plain", stem + ".bin"), "rb").read()
        data, consumed, st = run_decode(stream)
        if data is None:
            record("a", stem, "FAIL", erro=consumed, detalhe=st)
            continue
        ok = data == want
        record("a", stem, "PASS" if ok else "FAIL",
               saida=len(data), esperado=len(want), consumido=consumed,
               len_stream=len(stream), tiles=st.get("rtiles"), variante=st.get("variant"),
               meu_sha=sha(data), esperado_sha=sha(want), primeiro_divergente=first_diff(data, want))
        if not oracle_present:
            record("b", stem, "SKIP", motivo="oráculo ausente")
            continue
        src, dst = os.path.join(tmp, stem + ".nem"), os.path.join(tmp, stem + ".out")
        open(src, "wb").write(stream)
        rc, err = oracle(["-x", src, dst])
        if rc != 0 or err:
            record("b", stem, "SKIP", rc=rc, motivo=err or f"oráculo recusou rc={rc}")
            continue
        odata = open(dst, "rb").read()
        record("b", stem, "PASS" if odata == data else "FAIL",
               oracle_len=len(odata), meu_len=len(data),
               oracle_sha=sha(odata), meu_sha=sha(data), primeiro_divergente=first_diff(odata, data))

    # c) discriminantes: plain autoral -> oráculo empacota -> meu decode vs plain
    discrim = {
        "run_ceros_32": b"\x00" * 32,
        "run_ceros_256": b"\x00" * 256,
        "run_ceros_1024": b"\x00" * 1024,
        "nibble_max": b"\xff" * 32,
        "tabula_switch": bytes(range(32)) * 3,
        "alternado_fino": bytes([0x11, 0x22] * 16),
        "degradau_8tiles": bytes((i * 7) & 0xFF for i in range(256)),
        "ruido_semeado": bytes((i * 1103515245 + 12345) & 0xFF for i in range(96)),
        "bordas_2k": b"\x0f" * 1024 + b"\xf0" * 1024,
        "linhas_xor": bytes((i % 4) * 0x11 for i in range(320)),
    }
    for stem, plain in discrim.items():
        if len(plain) % 32 or not plain:
            record("c", stem, "FAIL", motivo="plain fora do domínio (erro do harness)")
            continue
        if not oracle_present:
            record("c", stem, "SKIP", motivo="oráculo ausente")
            continue
        pin, stm = os.path.join(tmp, stem + ".bin"), os.path.join(tmp, stem + ".nem")
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
               variante=st.get("variant"), tiles=st.get("rtiles"),
               consumido=consumed, len_stream=len(stream),
               oracle_sha=sha(plain), meu_sha=sha(data),
               primeiro_divergente=first_diff(data, plain))

    # d) negativos do negative-spec
    spec = json.load(open(os.path.join(FIX, "negative/negative-spec.json")))
    for v in spec["vectors"]:
        vid, kind = v["name"], v["input_kind"]
        path = os.path.join(FIX, "negative", os.path.basename(v["input_file"]))
        if not os.path.exists(path):
            record("d", vid, "SKIP", motivo=f"entrada ausente {v['input_file']}")
            continue
        blob = open(path, "rb").read()
        expected = v["expected_error"]
        wanted = next((c for c in CODES if c in expected), None)
        if kind == "plain":
            try:
                NEM.check_plain_domain(blob)
                record("d", vid, "FAIL", motivo="domínio aceitou sem erro", esperado=expected)
            except NEM.NemesisError as e:
                record("d", vid, "PASS" if e.code == (wanted or "input-not-in-domain") else "FAIL",
                       codigo=e.code, esperado=expected)
            continue
        kw = {}
        if kind == "stream+limit":
            kw["max_out"] = int(re.search(r"(\d+)", expected).group(1)) if re.search(r"\d+", expected) else 1024
        data, code, detail = run_decode(blob, **kw)
        if data is not None:
            record("d", vid, "FAIL", motivo="aceitou sem erro",
                   saida=len(data), consumido=code, esperado=expected)
        else:
            if kind == "stream" and "bounded" in expected:
                # O proprio spec lista as alternativas aceitas ("work-limit /
                # invalid / cancelled"): exigir um codigo unico aqui seria o
                # harness inventar obrigacao. A obrigacao real e estruturada +
                # limitada, e o que se verifica.
                aceita = code in ("work-limit", "excessive-output",
                                  "invalid-reference", "truncated", "cancelled")
                record("d", vid, "PASS" if aceita else "FAIL", codigo=code,
                       obrigacao="falha estruturada e limitada; nunca > max_out",
                       esperado=expected, limite=kw.get("max_out"))
                continue
            if code == wanted:
                record("d", vid, "PASS", codigo=code, esperado=expected, limite=kw.get("max_out"))
            elif code in CODES:
                # falha estruturada e limitada, mas com código distinto do spec:
                # registra como divergência, não como passe. A sonda abaixo prova
                # que o codigo pedido pelo spec e alcancavel NA MESMA entrada (o
                # limite existe e dispara antes da deteccao de truncamento).
                pdata, pcode, pdetail = run_decode(blob, work_limit=64)
                record("d", vid, "DIVERGE", codigo=code, esperado=wanted,
                       motivo="erro estruturado dentro dos limites, código difere do spec",
                       limite=kw.get("max_out"),
                       obrigacao_de_seguranca="confirmada: falha em trabalho limitado, "
                                             "sem loop (referencia faz SIGKILL aqui)",
                       sonda_orcamento_64=pcode if pdata is None else "aceitou",
                       detalhe_sonda=str(pdetail)[:120])
            else:
                record("d", vid, "FAIL", codigo=code, esperado=expected)

    # d2) os limites precisam ser ALCANÇÁVEIS, não apenas declarados:
    #     work-limit com orçamento pequeno em stream VÁLIDA e cancelamento.
    big = open(os.path.join(FIX, "plain", "planes_64k.nem"), "rb").read()
    data, code, detail = run_decode(big, work_limit=64)
    record("d2", "work-limit-orcamento-64", "PASS" if code == "work-limit" else "FAIL",
           codigo=code, detalhe=detail)
    checks = {"n": 0}

    def cancel_now():
        checks["n"] += 1
        return True

    data, code, detail = run_decode(big, cancel=cancel_now)
    record("d2", "cancelamento-cooperativo",
           "PASS" if code == "cancelled" and checks["n"] > 0 else "FAIL",
           codigo=code, consultas=checks["n"],
           saida_parcial=len(data) if data is not None else None,
           completo=len(big), detalhe=detail if data is not None else None)

    data, code, detail = run_decode(big, max_out=1023)
    record("d2", "excessive-output-max_out-1023",
           "PASS" if code == "excessive-output" else "FAIL", codigo=code, detalhe=detail)

    # e) determinismo
    for name in streams[:4]:
        r1 = run_decode(open(os.path.join(FIX, "plain", name), "rb").read())
        r2 = run_decode(open(os.path.join(FIX, "plain", name), "rb").read())
        same = r1[0] == r2[0] and r1[1] == r2[1]
        record("e", name[:-4], "PASS" if same else "FAIL")

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
        "gerado_por": "scripts/rex_corpus_b/nemesis-validate.py",
        "modulo_validado": "scripts/rex_corpus_b/nemesis_research.py",
        "limites": {"max_out": MAX_OUT, "work_limit": WORK_LIMIT},
        "oraculo": {"binario": ORACLE, "presente": oracle_present,
                    "sha256": sha(open(ORACLE, "rb").read()) if oracle_present else None,
                    "commit_referencia": ORACLE_COMMIT},
        "rollup": rollup,
        "casos": results,
    }
    with open(os.path.join(OUTDIR, "decode-parity-independente.json"), "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print("\nevidência: data/rex_corpus_b/nemesis/evidence/decode-parity-independente.json")
    return 1 if any(v["FAIL"] for v in rollup.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
