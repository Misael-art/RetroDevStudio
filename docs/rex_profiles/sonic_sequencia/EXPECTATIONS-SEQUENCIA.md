# EXPECTATIONS-SEQUENCIA — edição da ORDEM das entradas do script `id_Wait`

Frente: próximo incremento funcional (PARTE 2), PR **dependente** sobre a
proposta integrada da Sonic (base `codex/rex-sonic-consolidacao`).

Este arquivo é o **contrato de expectativas congelado ANTES de qualquer
implementação ou execução**. Regra da frente (memória
`freeze-expectations-before-any-proof-run`): se o resultado observado divergir
desta lista, o veredicto é **FAIL / INCONCLUSIVE com a série bruta registrada**;
o arquivo **não é reescrito** depois.

## 0. O que é este incremento (e o que NÃO é)

- **É**: reordenar, no próprio script `id_Wait`, a sequência das 18 entradas de
  referência de moldura (frame), **in place**: mesmo comprimento de script,
  terminador `FE 02` preservado, sem realloc, sem expansão, sem mudar DPLC.
- **Não é**: editar a duração (isso é a frente de cadência #100, byte único
  `0x13BAE`); mudar o número de frames; introduzir valor de frame novo; tocar
  qualquer outro byte da ROM; engenharia reversa universal / outros jogos /
  animações dependentes de velocidade.

## 1. Fatos de byte provados contra a ROM pinada (pré-condição, não expectativa)

- ROM BYOR Sonic 1 USA/EU, 531577 B, SHA-256
  `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb` (confere).
- Tabela `Ani_Sonic` em `0x13B48` (31 palavras BE, offset relativo à base).
  Entrada da anim 5 (`id_Wait`) → script em `0x13BAE`. Próxima entrada (anim 6)
  → `0x13BC4`.
- Script `id_Wait` (bytes literais, verificados por despejo):
  - `0x13BAE` = `17` (intervalo; domínio da CADÊNCIA, **fora** deste incremento)
  - `0x13BAF..0x13BC0` = 18 entradas:
    `01 01 01 01 01 01 01 01 01 01 01 01 03 02 02 02 03 04`
  - `0x13BC1..0x13BC2` = `FE 02` (terminador `afBack k=2`)
  - `0x13BC3` = `00` (padding) — **não** tocar
  - `0x13BC4` em diante = script da anim 6 — **não** tocar
- **Conjunto de bytes autorizado deste incremento**: exatamente
  `0x13BAF..0x13BC0` (18 bytes). Nenhum outro offset é escrevível.

## 2. Domínio válido de cada entrada

- Cada entrada é uma referência de moldura (frame) já presente no script
  original. O multiconjunto original é `{01×12, 02×3, 03×2, 04}`.
- Este incremento é uma **permutação** desse multiconjunto: nenhum valor novo
  é escrito, logo toda entrada continua sendo uma referência que o produto já
  compõe/valida (pipeline de composição da frente multiframe #99). Por
  construção, "só referências que o produto já compõe" vale.
- Valores **reservados/nunca aceitos** como entrada: `$00` (degenerado),
  `$80..$FF` (bit 7 = handler especial), e os tokens de script `$FD $FE $FF`
  (não são molduras). Uma permutação válida jamais produz esses bytes, pois só
  reorganiza os 18 existentes.

## 3. Efeito do `FE 02` sobre o loop (documentado; usado na prova)

- `afBack $FE` com k=2: ao chegar ao terminador, retrocede 2 entradas e **repete
  para sempre as duas últimas posições** do script. No original, as duas
  últimas são `03`,`04` (batida de pé).
- Consequência direta para a reordenação: como o loop fixa **posições** (não
  valores), mover entradas distintas para as duas últimas posições muda o que
  é visto em regime estacionário, e mover uma entrada distinta para a
  **primeira** posição muda o que é visto no primeiro passo — ambos
  observáveis no core.

## 4. Compartilhamento / consumidores

- Único leitor do script: a caminhada sequencial de `Sonic_Animate`, acionada
  pelo deslocamento da tabela em `0x13B48` (contrato #100 §4: prólogo único em
  `0x139C4`, referência absoluta única em `0x139C6`).
- Nenhum outro script nem outra entrada da tabela aponta para dentro de
  `0x13BAF..0x13BC0` (tabela tem 31 deslocamentos distintos; anim 5 aponta
  `0x13BAE`, anim 6 aponta `0x13BC4`). A região de reordenação pertence só ao
  `id_Wait`. **Não** há aliasing que obrigue confirmação de compartilhamento.

## 5. CRITÉRIOS CONGELADOS da prova (o que DEVE acontecer)

Só se declara sucesso se **TODOS** passarem. Qualquer desvio = FAIL/INCONCLUSIVE
com série bruta anexada; nada é reescrito depois.

Positiva (discriminante, pela UI real, ponta a ponta):
1. **Sequência discriminante pré-escolhida**: mover a primeira `03` (posição
   original 12) para a **posição 0**, produzindo
   `03 01×12 02 02 02 03 04` (multiconjunto preservado; o primeiro frame
   observado passa de `01` a `03`). Uma permutação que troque duas entradas
   **idênticas** (ex.: `01`↔`01`) é declarada **NÃO-prova** e não conta como
   positivo.
2. Fluxo real, na interface: **abrir → editar ordem → aplicar à cópia →
   exportar/reaplicar BPS → salvar → reiniciar → reabrir → executar** — o byte
   reordenado deve chegar ao core por esse caminho, nunca por injeção direta.
3. **Verificador independente** (sem importar módulo de produto) confere:
   a. bytes em `0x13BAF..0x13BC0` = a permutação proposta;
   b. `0x13BAE` (intervalo), `0x13BC1..0x13BC2` (`FE 02`), `0x13BC3` (pad `00`)
      e `0x13BC4` (início da anim 6) **intactos**;
   c. **ordem de frame observada no core** corresponde à permutação (assinatura
      do primeiro frame = arte `03`, não `01`), usando **sprites reais**
      (pixels/paleta compostos pelo produto), **sem** placeholder, **sem**
      imagem antiga, **sem** framebuffer mudo (não-preto verificado);
   d. demais edições preservadas (pixel, paleta, cadência/duração — a ordem é
      a única coisa que mudou);
   e. **restauração seletiva** devolve exatamente a ordem original dos 18 bytes
      (e só ela).
4. **proposto ≠ aplicado**: a UI distingue claramente a ordem proposta da ordem
   aplicada (o aplicado só existe após confirmar/gravar na cópia).
5. **Reordenar miniaturas ≠ reordenar a ROM**: a prova do byte na ROM é
   independente do preview de miniatura; miniatura é ilustração, não evidência.

Negativos (cada um deve RECUSAR sem escrever, e a cópia fica byte a byte
inalterada):
- `frame-inválido`: entrada fora do domínio (ex. valor não presente no
  multiconjunto / byte que colide com token) → recusa.
- `token-reservado`: tentativa de escrever `$FD/$FE/$FF` como moldura → recusa.
- `comprimento-divergente`: operação que mudaria o tamanho do script (realloc /
  inserir/remover entrada) → recusa (in-place estrito).
- `sessão-errada`: aplicar a reordenação com id de sessão divergente da ROM
  carregada → recusa.
- `resposta-antiga`: ack/resposta de época de core anterior à atual → descartada.
- `cópia-adulterada`: working copy cujo intervalo/terminador/não-id_Wait difere
  do contrato antes da escrita → recusa.
- `fora-do-script`: qualquer pedido de escrita fora de `0x13BAF..0x13BC0`
  (inclui `0x13BAE`, `0x13BC3`, vizinhos) → recusa, zero bytes alterados.

Comparação visual: usa **sprites reais** compostos pelo produto; a captura
defeituosa/não-preta e o negativo magenta (da frente visual) continuam
reprovando o comparador — não se troca correção por artefato de ambiente.

## 6. Métricas e limites de honestidade

- Nenhum ganho de usabilidade é declarado sem participante humano.
- Superfície permanece **Experimental** até a prova ponta a ponta verde.
- Sem ROM/binário no repositório; só BYOR + patches IPS/BPS + evidência com SHA.
- Gates da barra mínima rodam no destino desta frente e são reconciliados com
  o que foi **realmente executado** (clippy `--all-targets` e usabilidade
  permanecem "não aprovados/não declarados" conforme memória da frente).

## 7. Sequência de execução desta frente (para o plano, não expectativa nova)

- P2: backend (read/validate/permute das 18 entradas com os recusos do §5) +
  UI (selecionar entrada, mover antes/depois, reconhecer repetições, comparar
  original vs proposta, aplicar à cópia, restaurar só a sequência) — TDD,
  testes discriminantes primeiro.
- P3: prova da sequência discriminante pela UI real + os 7 negativos +
  BPS/reinício/reabertura + verificador independente.
- P4: gates, evidência durável com SHA, PR dependente, CI terminal por SHA, sem
  merge.
