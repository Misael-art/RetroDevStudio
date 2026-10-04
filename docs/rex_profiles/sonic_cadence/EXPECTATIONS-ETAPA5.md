# EXPECTATIVAS CONGELADAS — Etapa 5 (jornada completa no desktop E2E)

Escrito e commitado ANTES de qualquer execução do cenário `sonic-cadence-journey`.
Se qualquer número abaixo divergir na execução, a jornada é declarada
falha/inconclusiva e NADA é promovido; a discussão do desvio entra na
avaliação de CX, não numa reescrita deste documento.

## Rota idêntica para base e modificada

- App reconstruído a partir do commit da branch; binário com SHA registrado no
  relatório. Nenhuma ROM escrita pelo E2E além da cópia do pipeline e da
  aplicada via BPS da própria UI.
- Botões nativos da barra: `Jogar ROM base` e `Jogar versão modificada`
  (Game View real do produto). Gate de identidade: `data-rom-sha256` da Game
  View == SHA esperado (base: `c7da53a1…`; modificada: SHA da cópia aplicada
  pelo BPS, ≠ base) e `data-rom-size` == 531577.
- Input nativo WebDriver (nunca IPC de input): foco no canvas, `Enter`
  (START) pressionado quando `renderedFrames >= 900`, segurado por ≥ 30
  frames de tela, liberado; ACK de input deve avançar de sequência. Negativo:
  `KeyQ` (não mapeada) não pode alterar o ACK.
- Janela de amostragem: frames de tela 1500..2900, sem nenhum botão
  pressionado. Amostragem por burst na própria página (RAF +
  `emulator_read_memory` region 2, offset 0xD000, length 0x40), um sample por
  frame renderizado, costurado no driver.

## Candidato do jogador — re-verificação por dados (não presunção)

O endereço do timer vem do oracle (índice de região 0xD01F = objeto em
0xD000 + 0x1F; obAnim 0x1D; obFrame 0x1B), mas aqui o candidato é
re-aceito somente se os dados da corrida concordarem:

- entre amostras consecutivas com `anim == 5`, ≥ 80% mostram timer
  decrescendo de exatamente 1;
- ≥ 3 recargas por corrida com salto 0 → byte esperado;
- caso contrário: falha de jornada (endereço não se validou nesta execução).

## Números esperados (consequência do veredito H_N+1 da Etapa 4)

| corrida | byte | moda esperada dos gaps | recarga esperada |
|---|---|---|---|
| base | 23 | **24** | 0 → 23 |
| modificada via UI | 40 | **41** | 0 → 40 |

- transições do byte de frame (obFrame) entre frames de tela consecutivos:
  ≥ 5 por corrida na janela;
- razão da moda ≥ 0,80 por corrida;
- modos das duas corridas devem ser diferentes entre si (discriminante);
- cobertura: ≥ 40% das amostras da janela com `anim == 5` (chegou a idle);
- ≥ 10 frames de tela avançados após a primeira observação usable
  (portão do harness), com re-anchor se o contador resetar (nova carga de
  ROM redefine renderedFrames — cada corrida ancora no seu próprio 0).

## Jornada de UI antes do jogo (ordem obrigatória)

1. Identificar → analisar (concluído) → painel de cadência mostra 18 quadros
   na ordem do script com miniaturas reais, original 23 e previsão
   "24 frames de tela".
2. Digitar 40 → Aplicar duração → console registra o byte em 0x13BAE e o SHA
   da cópia; painel passa a mostrar 40 ticks e previsão "41 frames de tela".
   Independente: bytes esperados = base com 1 byte alterado em 0x13BAE.
3. Exportar BPS pela barra → aplicar à base → ROM aplicada byte a byte igual à
   cópia esperada (independente do produto).
4. Salvar → fechar → DESTRUIR a janela de sessão → recriar app → reabrir a
   sessão salva → painel restaura 40 ticks, proveniência da edição
   (inspection-sonic-edit-result com o SHA da cópia) e previsão 41; recompor
   um quadro prova pixels contra a ROM esperada.
5. Só então: jogar base e modificada com a rota acima.

## Veredito

- allPass apenas se: gates de SHA, ACK, negativo de tecla, re-verificação do
  candidato, tabela de modos, razão, cobertura, discriminante e jornada de UI
  passarem na ordem.
- Qualquer desvio numérico ⇒ INCONCLUSIVE/FAIL registrado no relatório com a
  série bruta; nenhuma mudança de semântica é feita sem novo congelamento
  prévio.
