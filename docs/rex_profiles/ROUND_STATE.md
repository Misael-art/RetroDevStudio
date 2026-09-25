# Estado da rodada REX — perfis de endereçamento e codecs

Registro vivo do integrador. Matriz honesta por capacidade: `blocked`,
`fixture` (prova sintética autoral) ou `verified` (evidência registrada em
`data/rex_profiles/*/evidence/`). Nada aqui é badge único verde; cada célula
cita a evidência ou o bloqueio exato. Contratos: `CONTRACTS.md` (v1).

## Regras de execução e job pesado (dono: integrador)

- Host snapshot da rodada: 8 CPUs lógicas, 14 GiB RAM. Antes de cada job pesado,
  reavaliar memória disponível e swap; com menos de ~3 GiB disponíveis ou
  crescimento persistente de swap, adiar.
- **Um único job pesado por vez** (Rust/SGDK/Ghidra/Tauri/WebDriver/build
  completo). O dono da execução é o **integrador**; A e B não iniciam
  compilação completa por conta própria e pedem janela aqui.
- A/B fazem leitura, fixtures e testes pequenos e isolados na própria saída;
  nunca escrevem no ledger comum nem em arquivos de IPC/UI/manifests comuns.
- Não matar processos alheios; não limpar corpus; corpus é somente leitura
  para A/B (caminho canônico `data/canonical-local-2026-09-21/corpus/`).
- Janela atual: (preenchida pelo integrador ao reservar/executar).

## Matriz de endereçamento (propriedade: agente A)

| Perfil | Especificação | Fixture | Implementação ref. | Negativos | Corpus |
|---|---|---|---|---|---|
| MD linear | blocked | blocked | blocked | blocked | blocked |
| MD SSF2 | blocked | blocked | blocked | blocked | blocked |
| SNES LoROM | blocked | blocked | blocked | blocked | blocked |
| SNES HiROM | blocked | blocked | blocked | blocked | blocked |
| SNES ExHiROM | blocked | blocked | blocked | blocked | blocked |

Endereçamento não implica codecs da plataforma nem compilação de lógica
recuperada; estados separados.

## Matriz de codecs (propriedade: agente B)

| Codec | Variante fixada | Vetores+holdout | decode vs ref | encode vs ref | Negativos | Recurso real |
|---|---|---|---|---|---|---|
| aPLib | blocked | blocked | blocked | blocked | blocked | blocked |
| LZ4W SGDK | blocked | blocked | blocked | blocked | blocked | blocked |
| Nemesis | blocked | blocked | blocked | blocked | blocked | blocked |
| Kosinski | blocked | blocked | blocked | blocked | blocked | blocked |
| Enigma | blocked | blocked | blocked | blocked | blocked | blocked |

## Cadeia de recurso comprimido (propriedade: integrador)

| Etapa | Status | Evidência |
|---|---|---|
| ROM -> origem verificável | blocked | — |
| decode | blocked | — |
| prévia | blocked | — |
| edição | blocked | — |
| encode | blocked | — |
| reinserção em cópia + patch | blocked | — |
| efeito observado no jogo | blocked | — |

## Histórico da rodada

- 2026-09-24: base `0d8c413` confirmada (CI remoto verde em todos os checks;
  provas 4/4, 6/6, 13/13, 16/16 conferidas programaticamente no binário
  `9a6afe4b…`; corpus com hashes conferidos). Contratos v1 congelados;
  worktrees A/B preparados sobre a mesma base; estado inicial tudo `blocked`.
