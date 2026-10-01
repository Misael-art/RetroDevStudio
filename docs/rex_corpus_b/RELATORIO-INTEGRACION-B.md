# RELATORIO DE INTEGRACAO — MISSAO B (frente B, Nemesis/Enigma + contexto grafico)

**Estado: Experimental.** Nenhuma promocao de maturidade, nenhum merge,
nenhuma release. Este documento nao substitui os relatorios de pesquisa:
recolhe o que se pode integrar, o que fica aberto e o que **nao** se provou.

| | |
|---|---|
| Base declarada | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` (merge-base verificado) |
| HEAD da frente | `codex/rex-corpus-b` (7 commits anteriores a esta rodada + commits desta rodada, tabela §1) |
| Worktree | `~/RDS-REX-CORPUS-B`, exclusiva desta frente |
| Territorio rastreado | `scripts/rex_corpus_b/`, `docs/rex_corpus_b/`, `data/rex_corpus_b/` — nada mais foi tocado |
| Documentos de pesquisa | `NEMESIS-RESEARCH.md`, `ENIGMA-RESEARCH.md`, `RECONCILIACAO.md`, `MD-CONTEXTO-GRAFICO.md` |

## 1. O que esta rodada fechou (com o log que prova)

1. **Paridade externa do corpus real de Pulseman: 196/196.** O locator tinha
   confirmado 6/172 streams Nemesis por limite de corrida. O novo
   `confirmar-oraculo-pulseman.py` re-decodifica cada recurso e compara com
   `nemcmp -x0xOFFSET` / `enicmp -x0xOFFSET` no sandbox versionado: **172
   Nemesis + 24 Enigma byte-idênticos, todos com span dentro do arquivo**
   (`data/rex_corpus_b/recursos/pulseman-oraculo-completo.json`, log em
   `data/rex_corpus_b/logs/pulseman-oraculo-completo.log`).
2. **CONSUMIDOR REAL do Enigma no Sonic 1 (value_offset e destino fechados).**
   Varredura com a extensão breve do 68000 fixada CONTRA O MONTADOR
   (`m68k-elf-as -m68000`; bits 15/14-12/11 = An/reg/tamanho, bits 7-0 = disp8
   assinado, SEM escala no m68000) encontrou o consumidor que o scanner antigo
   perdia por tratar disp negativo como "formato completo":
   `0x1b6b6 lsl.w #2,d0` → `0x1b6c4 movea.l (-122,PC,D0.w),A0` (tabela
   `0x1b64c`) → `0x1b6c8 lea $FF4000,A1` (PORTA DE DADOS VDP) →
   `0x1b6ce move.w #0,d0` (**value_offset = 0 medido**) → `0x1b6d2 jsr $171E`
   (único sítio na ROM). Semântica do decodificador 68k desassemblada: soma do
   offset nos cursores inc/common; OR/ADD nos bits altos inline.
3. **Recurso contextual real composto: os 6 mapas (nametables 64x32) do Sonic
   1.** Decodificados por mim byte-idênticos ao oráculo, encadeados na ordem da
   tabela com pad word-rounded (`0x662f4+1233=0x667c5`, próxima `0x667c6`),
   compostos APENAS com os campos provados (índice, flips, slot de paleta,
   prioridade), em cinza — sem paleta escolhida, sem rotulo de "cena".
   `sonic1-mapa-0x65432.json` + 5 irmãos; mosaico de inspeção (PNG fora do
   Git, SHA-256 `4e24dc298290202d…`) mostra 6 formas coerentes e distintas.
4. **Classificação de evidências corrigida.** (a) MD-CONTEXTO §1: fonte e
   saída do rescomp são UMA linha de evidência; a segunda independente é a
   arte comercial sobre plains confirmados por referência — o "chunky" não
   depende do instrumento estatístico, que segue inconclusivo em 6/6 e preso
   como negativo. (b) `sonic1-confirm-by-reference.json` reclassificado por
   regra (não por rc=0): `0x64a00` e `0x64c62` são FALSAS ACEITAÇÕES do
   oráculo (leitura além do EOF / fora de domínio); `0x662f4` era listado como
   nemesis E enigma — vence a atribuição que o consumidor prova (enigma);
   `classificar-sonic1.py` → `sonic1-classificacao.json` (6 recursos, 6
   não-recursos).
5. **Divergência len=0 do Nemesis registrada com fixture** (quarta divergência
   do oráculo): a referência tolera registros de tabela `len=0` inatingíveis;
   meu decoder strict recusa (`InvalidReferenceError`), lenient decodifica
   byte-idêntico e registra em `unreachable_records`.
   `test-nemesis-len0.py` → `nemesis/evidence/len0-fixture.json`.
6. **Ponto cego base+índice varrido e fechado para Pulseman (negativo
   delimitado):** `procurar-consumidor.py` varre (d8,PC,Xi) catalogado e
   carga-base+(d8,An,Xi)/(d16,An) com controle positivo sintético preso por
   teste (11/11). Em Pulseman: consumidor das streams NÃO localizado nas
   formas varridas (`consumidor-pulseman-streams.json`); a carga catalogada
   `0x278fe lea $50694,a0` foi desmontada e é consumidor de structs de ÁUDIO
   (falso líder documentado), não do descompressor gráfico.

## 2. O que se entrega para integrar

**Ferramentas de pesquisa (Python 3 stdlib, somente leitura de ROM BYOR):**

| Ferramenta | Para que |
|---|---|
| `confirmar-oraculo-pulseman.py` | paridade externa de TODOS os recursos do locator |
| `procurar-consumidor.py` + `test-procurar-consumidor.py` | varredura reproduzível de consumidores (absoluto, d16,PC, d8,PC,Xi, base+índice) com negativo delimitado |
| `compor-recurso.py` + `test-compor-recurso.py` | composição de nametable real com pré-condições (consumidor, value_offset) e recusas (paleta inventada, base ≠ 0, proveniência cruzada, caminho fora da árvore) |
| `classificar-sonic1.py` | reclassificação das evidências Sonic 1 por regra |
| `test-nemesis-len0.py` | fixture da divergência len=0 vs oráculo |

**Evidências versionadas (JSON, sem bytes comerciais):**
`pulseman-oraculo-completo.json`, `consumidor-sonic1-mapas.json`,
`consumidor-pulseman-streams.json`, `sonic1-mapa-0x65432.json` (+5 irmãos),
`sonic1-classificacao.json`, `nemesis/evidence/len0-fixture.json`.

**PNGs de inspeção: FORA do Git** (registrados por SHA-256 nos JSONs;
mosaico `4e24dc298290202d…`).

## 3. Afirmações que se podem defender

1. 196/196 recursos de Pulseman byte-idênticos ao oráculo, span dentro do
   arquivo (pins conferidos antes de cada uso).
2. No Sonic 1, os 6 streams Enigma da tabela `0x1b64c` são nametables 64x32
   carregados pela porta de dados VDP pelo decodificador `$171E` com
   `value_offset = 0`; as 6 encadeiam na ROM com pad word-rounded.
3. O layout `chunky` é sustentado por duas linhas independentes (ferramenta
   oficial medida + arte comercial sobre plains confirmados por referência);
   o instrumento estatístico NÃO é uma delas (inconclusivo 6/6, preso como
   negativo).
4. A extensão breve do 68000 usada pela varredura está fixada contra o
   montador do toolchain (encodings gravados no código e em
   `test-procurar-consumidor.py`).
5. Toda recusa do compositor é por regra declarada (paleta sem CRAM provado,
   base que contradiz o consumidor, proveniência cruzada), nunca por gosto.

## 4. O que NAO se provou (nenhum leitor deve inferir)

- **Nenhuma ROM foi executada.** A cadeia do consumidor é estática (bytes →
  instruções → fluxo de dados até a porta VDP). Observação em jogo exige a
  janela do integrador (emulação).
- tiles→mapa e paleta→mapa seguem `not-evidenced`: falta a rotina de carga de
  arte Kosinski em VRAM e a carga de CRAM; a referência faltante está
  registrada por recurso.
- O consumidor das streams de Pulseman não foi encontrado NAS FORMAS VARRIDAS
  — ausência de hit não é prova de ausência de consumidor (lacunas listadas
  no JSON).
- "6 fases especiais" é leitura de contexto do mosaico, NÃO alegação desta
  frente; o que está provado são 6 nametables indexadas 0..5 com guarda
  `cmpi.b #6`.
- Nenhum produto, crate ou documentação comum foi alterado.

## 5. Decisões que correspondem ao integrador

1. Promocao de maturidade e merge (esta frente segue `Experimental`).
2. Observacao em emulacao dos 6 mapas (janela do integrador).
3. Se desejar, a cadeia do consumidor do Sonic 1 (`0x1b6c4`→`$171E`) pode
   alimentar o perfil Enigma do produto com `value_offset=0` como
   `consumer-proven` — decisao de contrato, nao desta frente.

## 6. Gates executados (HEAD desta rodada)

| Gate | Resultado |
|---|---|
| `nemesis-validate.sh` | 68/68 PASS (re-executado nesta rodada) |
| `enigma-validate.sh` | 70 PASS + 1 SKIP (e12, como documentado) |
| `test-md-tiles.py` / `test-nametable-structure.py` | 48/48, 57/57 |
| `test-find-references.py` / `test-locate-streams.py` | 70/70, 24/24 |
| `test-procurar-consumidor.py` | 11/11 (controle positivo sintetico) |
| `test-compor-recurso.py` | 11/11 (stream empacotada PELO ORACULO) |
| `test-nemesis-len0.py` | PASS (oraculo, lenient, strict) |
| `npm run check:tree` | conforme (arvore de dados/scripts/docs) |
| Bytes comerciais no indice | nenhum (ROMs BYOR ficam fora; PNGs fora do Git) |
