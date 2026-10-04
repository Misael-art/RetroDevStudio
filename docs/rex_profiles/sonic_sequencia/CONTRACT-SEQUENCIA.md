# CONTRATO-SEQUENCIA — reordenação das entradas do script `id_Wait`

Frente PARTE 2 (PR dependente da proposta integrada Sonic). Complementa o
`docs/rex_profiles/sonic_cadence/CONTRACT.md` (duração) tratando **só da ordem**
das 18 entradas de moldura. As expectativas de prova estão congeladas em
`EXPECTATIONS-SEQUENCIA.md` (commit `d80b30c`, anterior a qualquer código).

## Identidade da ROM (herdada do contrato de cadência)

- Sonic 1 USA/EU, 531577 B, SHA-256
  `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`.
- Endereçamento: offset de arquivo = endereço CPU − `$100000` (dump raw;
  comprovado no contrato de cadência §2).

## Layout do script `id_Wait` (bytes literais, verificados por despejo 2026-10-03)

| Faixa (file) | Bytes | Papel | Editável nesta frente |
|---|---|---|---|
| `0x13BAE` | `17` | intervalo (duração) | **NÃO** (domínio da cadência) |
| `0x13BAF..0x13BC0` | `01×12, 03, 02, 02, 02, 03, 04` | 18 entradas de moldura | **SIM** (permutação) |
| `0x13BC1..0x13BC2` | `FE 02` | terminador `afBack k=2` | **NÃO** (preservar) |
| `0x13BC3` | `00` | padding | **NÃO** |
| `0x13BC4..` | script anim 6 | vizinho | **NÃO** |

- Tabela `Ani_Sonic` em `0x13B48`; anim 5 → `0x13BAE`; anim 6 → `0x13BC4`. O
  script do alvo ocupa `0x13BAE..0x13BC2` e termina antes do vizinho.

## Conjunto de bytes autorizado

- **Exatamente** `0x13BAF..0x13BC0` (18 bytes). Toda escrita fora disso é
  recusada sem alterar a cópia. O incremento é **in-place estrito**: mesmo
  comprimento, sem inserir/remover entrada, sem tocar intervalo/terminador.

## Domínio de entrada e natureza da operação

- Operação = **permutação** do multiconjunto original
  `{01×12, 02×3, 03×2, 04}`. Nenhum valor novo é escrito; portanto cada
  entrada continua uma referência de moldura que o produto já compõe (pipeline
  da frente multiframe). `frame-inválido` = proposta cujo multiconjunto difere
  do original (introduz/remove valor ou muda contagens) → recusado.
- Nunca aceitos como entrada: `$00` (degenerado), `$80..$FF` (bit 7 = handler
  especial), e os tokens `$FD $FE $FF` (comandos de script, não molduras). Uma
  permutação válida jamais os produz — mas o validador os rejeita por
  defesa-em-camada.

## Efeito do terminador `FE 02` (obrigatório para projetar a prova)

- `afBack $FE` com k=2 retrocede 2 **posições** e repete para sempre as duas
  últimas entradas. O loop é por **posição**, não por valor: reordenar muda o
  que aparece tanto no primeiro passo (posição 0) quanto no regime
  estacionário (posições 17,18). Isso torna a reordenação **observável** no
  core com entradas distintas e permite distinguir de uma troca de entradas
  idênticas (que é NÃO-prova).

## Consumidor / compartilhamento

- Único leitor: caminhada sequencial de `Sonic_Animate` via deslocamento da
  tabela (prólogo único `0x139C4`, referência absoluta única `0x139C6` —
  contrato de cadência §4). Nenhuma outra entrada da tabela nem outro script
  aponta para dentro de `0x13BAF..0x13BC0` (31 deslocamentos distintos; anim 5
  = `0x13BAE`, anim 6 = `0x13BC4`). A região pertence só ao `id_Wait`; não há
  aliasing.

## Critérios de recusa do backend (por código de erro)

- `seq_base_mismatch` — working copy cujo intervalo/terminador/não-alvo difere
  do contrato antes da escrita (origem adulterada).
- `seq_frame_invalid` — proposta cujo multiconjunto ≠ `{01×12,02×3,03×2,04}`.
- `seq_token_reserved` — `$00`/`$80..$FF`/`$FD..$FF` como entrada.
- `seq_length_divergent` — operação que altere o tamanho do script.
- `seq_out_of_scope` — escrita fora de `0x13BAF..0x13BC0`.
- `seq_session_mismatch` / `seq_stale_ack` — sessão/época de core divergente da
  atual (integridade de estado; reaproveita o modelo da jornada #101).
- No-op explícito: permutação igual à ordem atual é reportada como "sem
  mudança", não como erro silencioso nem como edição gravada.

## Superfície da API (o que P2 implementa; UI nunca reimplementa endereços)

- `read_frames(rom) -> [u8;18]` (valida estrutura; devolve a ordem atual).
- `describe(base, rom) -> SequenceInfo` (ordem original vs atual, domínio,
  terminador, limites, proveniência, o que ainda não foi medido).
- `permute(rom, proposta: &[u8;18]) -> Result<Vec<u8>, String>` (escreve as 18
  posições; retorna ordem anterior; recusa antes de tocar no buffer).
- `restore(rom) -> Result<(), String>` (devolve exatamente a ordem original das
  18 entradas; **só** a sequência; intervalo/pixel/paleta intocados).

Limites: nada aqui autoriza mudar contagem de frames, outro byte da ROM, outro
jogo, nem animações de velocidade. PAL não medido. Prévia da UI é ilustração,
nunca prova.
