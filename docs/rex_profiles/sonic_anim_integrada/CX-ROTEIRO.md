# Roteiro CX — jornada integrada de animação Sonic 1 (E10, Etapa 5)

Participante-alvo: pessoa iniciante em engenharia reversa, sem treino com o
produto. Ferramenta: RetroDev Studio com o painel **Analisar ROM → Inspecionar
→ Sonic** sobre a ROM BYOR Sonic 1 (USA, Europe) Rev00.

**Status: validação humana pendente.** Nenhuma sessão com participante humano
foi conduzida nesta frente; nada aqui é evidência de usabilidade medida. As
obstruções citadas foram as observadas pelo E2E e corrigidas no produto
(Etapa 3, commit d46cafd); o E2E da jornada (`sonic-anim-integrada`) cobre o
caminho técnico, não a experiência do participante.

## Preparação (facilitador, ~2 min)

- Binário reconstruído no HEAD da evidência; ROM BYOR escolhida pelo
  participante (não fornecer o caminho pronto).
- Nenhuma dica sobre offsets, bytes ou endereços antes do fim das tarefas.
- Registrar verbalizações ("o que você espera que aconteça?") e tempo por
  tarefa. Critério de sucesso é do participante, não do produto.

## Tarefa 1 — Localizar a animação (métrica: descobribilidade)

Prompt: *"Abra a ROM e me mostre onde fica a animação de esperar do Sonic."*

O que observar:
- Se encontra o rail **Depurar → Analisar ROM** sem ajuda e se o termo
  "Inspecionar/Sonic" faz sentido para ela.
- Se reconhece os 18 quadros da animação `id_Wait` pelas prévias de sprite —
  e se sabe que estão mostrando o Sonic REAL (não forma geométrica).
- Se procura a duração em lugar errado (ex.: nos metadados do quadro em vez
  do painel de cadência).

Sinal de passagem: a participante nomeia a animação, a contagem de quadros e
o conceito de duração em suas palavras antes de editar.

## Tarefa 2 — Deixar a animação mais lenta (métricas: linguagem, feedback)

Prompt: *"Faça o Sonic esperar mais tempo, sem escrever nenhum número se
puder evitar."*

O que observar:
- Se descobre os botões **Mais lento / Mais rápido** (semântica de iniciante)
  antes de digitar o valor numérico.
- Se compreende a previsão exibida ("byte 24 ⇒ cada quadro fica 25 frames de
  tela ≈ 0,42 s") e não confunde com duração em segundos direto.
- Se o aviso de pendência ("ainda não foi gravado") evita a edição fantasma.
- Se a recusa de valores reservados (0, ≥128, terminadores) é explicada em
  linguagem de usuário, não em código de erro.
- Se entende o que a mensagem de sucesso prova: offset `0x13BAE`, novo valor,
  SHA da CÓPIA — e que a ROM original não foi tocada.

Sinal de passagem: a participante prevê o efeito na tela ANTES de aplicar e
confirma o efeito depois conferindo a cópia (byte exato).

## Tarefa 3 — Retomar a edição após reinício (métrica: recuperação)

Prompt: *"Feche tudo, reabra o programa e me mostre que sua edição continua
lá — depois desfaça só a parte da duração."*

O que observar:
- Se reabre a sessão salva e o painel restaura sequência + duração + pixel
  sem reeditar nada.
- Se o wizard de projeto na reabertura é entendido (fecho explícito visível
  coexiste com a inspeção retomada — correção E10, não supressão).
- Se encontra o ledger de procedência e explica, com ele aberto, QUEM mudou
  QUÊ (domínio, offset, anterior→sucessivo, SHA da cópia).
- Se "Restaurar original" da cadência é escolhido para desfazer só a duração,
  e se confere que o pixel pintado permanece intacto.

Sinal de passagem: a participante recupera o estado completo sem pedir ajuda
e descreve a restauração seletiva como "só a duração voltou, o resto ficou".

## Métricas de fechamento (por tarefa)

| Métrica | Como registrar |
| --- | --- |
| Descobribilidade | cliques/perguntas até o primeiro controle certo |
| Linguagem | termos do painel que a participante repetiu corretamente |
| Feedback | instante em que soube que a gravação aconteceu e em qual arquivo |
| Recuperação | ajuda necessária após reinício (0 = ideal) |
| Obstruções | qualquer momento em que o produto impediu (drawer, wizard, overzap) |

## Limites de alegação

Vale apenas para Sonic 1 (USA, Europe) Rev00 + core Genesis Plus GX v1.7.4
neste host, classificação **Experimental**. Enquanto não houver sessão
humana gravada com este roteiro, a frente NÃO afirma "iniciante consegue";
afirma apenas que o caminho técnico é provado por E2E e que as duas
obstruções conhecidas (drawer sobre a ação; wizard sem fecho na reabertura)
foram corrigidas e têm teste automatizado.
