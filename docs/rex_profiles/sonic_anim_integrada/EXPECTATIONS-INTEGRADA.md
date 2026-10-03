# EXPECTATIONS congeladas — jornada integrada de animação Sonic 1

Congelado e commitado **antes** de qualquer implementação ou execução de
prova desta frente (regra: nunca reescrever expectativas depois de observar
resultado; desvio = FAIL/INCONCLUSIVE com série bruta persistida).
Referência: `CONTRATO-ESTADO-INTEGRADA.md` do mesmo diretório.

Base pinada: `c7da53a1…c81ebb` (531577 B). Cadência do alvo: byte `0x13BAE`
original `$17` (23); veredito NTSC `H_N+1` já medido pela frente de cadência.

## E1 — Acumulação cruzada de domínios (Rust, BYOR real)

- Encadear na mesma sessão: pintura de exatamente **2 pixels** distintos do
  quadro stand + 1 cor de paleta (índice ≠ 0) + intervalo `40`.
- Diff cumulativo da cópia final contra a base: **exatamente** os 2 bytes de
  arte tocados, 2 bytes da palavra de paleta e 1 byte em `0x13BAE` — nenhum
  outro byte muda. Contagem e offsets listados na asserção.
- **Comutatividade byte a byte**: a cadeia base→pixel→paleta→cadência e a
  cadeia base→cadência→paleta→pixel produzem cópias **idênticas** (mesmo
  SHA de arquivo). Se divergirem, FAIL com os dois SHAs e o diff bruto.
- Preservação direcional: aplicar cadência após pixel mantém o byte de arte
  no valor pintado; aplicar pixel após cadência mantém `0x13BAE = 40`;
  paleta preserva ambos.

## E2 — Proveniência por domínio e reabertura

- Após os três domínios aplicados, salvar → destruir estado em memória →
  reabrir do disco deve restaurar: SHA da cópia, duração vigente lida dos
  BYTES da cópia (40, previsão 41), e **registro cumulativo** nomeando cada
  domínio aplicado (formato, offset, valor anterior→sucessivo, SHA da cópia
  resultante em cada passo da cadeia).
- Recomposição dos quadros após reabertura usa a cópia (RGBA bate com o
  composto pré-fechamento).

## E3 — Restauração seletiva

- "Restaurar original" da cadência, com pixel+paleta já aplicados: resultado
  é uma edição comum; diff final contra a base = só arte+paleta;
  `0x13BAE` volta a `$17`; pixel pintado permanece intacto (byte exato
  asserido). Restaurar quando o domínio já está no valor original = **noop
  explícito** (sem arquivo novo, cadeia de SHA inalterada).

## E4 — No-op explícito (mudança de comportamento)

- Valor de cadência igual ao corrente, cor de paleta igual à corrente,
  pixel pintado com a cor que já possui: cada um devolve `ok:true` com
  classificação `noop`, mensagem de usuário ("já está com esse valor; nada
  foi gravado"), **zero** arquivos novos. Hoje o produto RECUSA com erro —
  expectativa congelada: isso é o defeito a corrigir, não o contrato.

## E5 — Identidade capturada na carga do core

- `load_rom` captura SHA-256 dos bytes carregados; `emulator_load_rom` e os
  resultados de execução (`emulator_run_frames_sampled`, `emulator_observe`)
  reportam `loaded_rom_sha256` autoritativo.
- Teste de troca: carregar ROM a partir de **cópia scratch**, alterar o
  arquivo em disco após a carga (inverter 1 byte), amostrar:
  `loaded_rom_sha256` continua o da ROM carregada;
  `disk_matches_loaded: false`; `disk_file_sha256` = do arquivo alterado;
  as linhas amostradas permanecem as da execução carregada. Corpus original
  jamais usado como alvo de troca e é re-conferido byte-idêntico no fim.
- Caminho feliz: `disk_matches_loaded: true`.

## E6 — BPS round-trip integrado

- BPS(base → cópia tripla) reaplicado pela superfície canônica sobre a base
  reproduz a cópia **byte a byte**; base permanece no pino; base+ divergente
  recusa (negativo já existente preservado).

## E7 — Corrida de respostas e sessão errada

- Promises controladas (sem `sleep` como prova): disparar edição de cadência
  e, antes da resposta, trocar de sessão/moldura; resposta tardia é descartada
  e o estado do painel permanece o da sessão nova. Testes frontend existentes
  (ex.: "ignores a cadence reply…") são estendidos ao domínio pixel+paleta.
- Resposta de edição oriunda de outra sessão não substitui a atual (guarda de
  identidade no resultado).

## E8 — Controles de mutação (verificadores independentes)

- Trocar ordem de células VDP (linha↔coluna) no compositor de teste: oracle
  multiframe falha. Nibble trocado: falha.
- Alterar cadência fora do domínio (ex.: escrever no terminador `FE 02`, ou
  valor `$80`): verificador de cadência recusa; nenhum outro byte muda.
- Cada controle de mutação deve ser rejeitado pelo verificador do SEU
  domínio; um controle que só derruba o caso feliz e passa no restante é
  registrado como não discriminante, não como prova.

## E9 — Jornada desktop (10 passos, congelado para Etapa 5)

- Cenário `sonic-anim-integrada`, binário canônico reconstruído no HEAD exato
  (gate de procedência já ativo no harness). Passos: abrir BYOR → localizar
  `id_Wait` + 18 quadros → pintar 1 pixel permitido (confirmação de
  compartilhamento se houver) → mudar duração para 40 → conferir AMBOS na
  cópia (byte exato `0x13BAE=40` + nibble pintado lidos crus do arquivo) →
  exportar BPS e reaplicar pela UI → jogar ROM modificada na Game View com
  gate de identidade dos bytes carregados → salvar/destruir janela/reiniciar/
  reabrir → confirmar sequência+duração+pixel+proveniência → restaurar só a
  duração e confirmar pixel intacto.
- Números esperados da perna de medição (se executada): base byte 23 → moda
  24; modificada 40 → moda 41; janela bruta contínua; descartes fora da
  janela congelada registrados por nome. Discriminante 24 ≠ 41.
- Redação honesta: input via `send_input` direto no core é **sonda técnica**,
  não "teclado real"; ACK de START nativo na Game View é a prova de gameplay.
  Forma geométrica nunca substitui o Sonic em prova positiva.

## E10 — CX (três tarefas, congelado para Etapa 5)

- Tarefas: localizar a animação; deixá-la mais lenta; retomar a edição após
  reinício. Métricas: descobribilidade, linguagem, feedback, recuperação,
  obstruções. Sem participante humano nesta frente → entregar roteiro curto
  e marcar **validação humana pendente**, sem bloquear o resto.
- Corretivos de obstrução observados (não negociáveis do E2E): drawer do
  console não pode cobrir a ação principal do painel; wizard na reabertura
  deve coexistir com a inspeção retomada (fecho explícito visível, não
  supressão global de onboarding para passar teste).

## Critério de veredito

Cada E acima vira teste nomeado com asserções de bytes/valores exatos.
Qualquer desvio entre expectativa congelada e resultado medido é registrado
como FAIL com série bruta, e uma correção só entra por **adendo congelado
antes de reexecutar** (precedente: Addendum-A/Retificação A da cadência).
