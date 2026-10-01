#!/usr/bin/env bash
# Harness de isolamento para oráculos externos (missão REX-B, diretriz do
# integrador 2026-09-25: "Execute ferramentas potencialmente inseguras em
# processo isolado, com timeout e limites de saída/memória").
#
# Por que: os oráculos mdcomp NÃO têm limite de trabalho — entrada
# malformada pode entrar em loop consumindo CPU/ram indefinidamente
# (ORACLE-INVENTORY limitação 1). O wrapper impõe:
#   - timeout com kill-forçado (-k) — padrão 30s CPU-bound
#   - ulimit -v : teto de memória virtual (KB) — padrão 2 GiB
#   - ulimit -t : teto de CPU-segundos (hard) — padrão 25s
#   - ulimit -f : teto de arquivo de saída (blocos de 512B) — padrão 4 MiB
#   - stdin fechado (</dev/null) e cwd fixo
#   - JVM: -Xmx explícito para chamadas java -jar
#
# Uso:
#   source .../common/sandbox.sh
#   run_oracle 30 output.bin -- "$KOS" -x in.kos out.bin
#   run_java   60 512 -- -jar lz4w.jar p in out s
# Códigos: 0 ok; 124 timeout wall; 137/143 kill; 1 SSE (SIGXFSZ/SIGSEGV);
# outros = rc da ferramenta. SEMPRE trate rc!=0 como recusa do oráculo.

run_oracle() { # $1=timeout-s $2=arquivo-de-saida-a-limitar|null $3=-- ...cmd
  local tmo="$1" outfile="$2"; shift 3
  [ "${1:-}" = "--" ] && shift
  local limit_cmd=""
  if [ "$outfile" != "null" ]; then
    # corta a saída se ultrapassar o teto mesmo sem SIGXFSZ
    limit_cmd="ulimit -f 8192; ulimit -v 2097152; ulimit -t 25;"
  else
    limit_cmd="ulimit -v 2097152; ulimit -t 25;"
  fi
  timeout -k 5 "$tmo" bash -c "$limit_cmd exec \"\$@\"" _ "$@" </dev/null
}

run_java() { # $1=timeout-s $2=Xmx-MB $3=-- ...args-do-java
  local tmo="$1" mx="$2"; shift 3
  [ "${1:-}" = "--" ] && shift
  timeout -k 5 "$tmo" java -Xmx"${mx}m" "$@" </dev/null
}
