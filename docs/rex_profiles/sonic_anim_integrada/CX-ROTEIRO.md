# Roteiro CX — jornada integrada de animação Sonic 1 (revisado na frente visual, 2026-10-03)

Participante-alvo: pessoa iniciante em engenharia reversa, sem treino com o
produto. Ferramenta: RetroDev Studio, caminho real da superfície atual:
aba **Ferramentas → Reverse Workspace** (chip Experimental) → aba **Inspeção
visual** → ROM BYOR Sonic 1 (USA, Europe) Rev00 → selecionar um frame do
perfil assistido `Sonic 1 / …` no "Frame composto".

**Status: validação humana pendente.** Nenhuma sessão com participante humano
foi conduzida nesta frente; nada aqui é evidência de usabilidade medida. As
obstruções citadas foram observadas pelo E2E e corrigidas no produto: duas
ações da Etapa 5/entrega (drawer sobre a ação; wizard sem fecho na reabertura,
commit d46cafd) e as três da frente visual (perna de retorno do diagnóstico
`573e2c0`; workspace de animação E2-1..E2-10 `ac08fbb`; sprite invisível após
reabertura da janela — correção de apresentação `932f2c6`, provada sem
mitigação de ambiente em `b396abb`). O E2E da jornada
(`sonic-anim-integrada`, 28 checks verde no binário final) cobre o caminho
técnico, não a experiência do participante.

## Preparação (facilitador, ~2 min)

- Binário reconstruído no HEAD da evidência; ROM BYOR escolhida pelo
  participante (não fornecer o caminho pronto).
- Nenhuma dica sobre offsets, bytes ou endereços antes do fim das tarefas.
- Registrar verbalizações ("o que você espera que aconteça?") e tempo por
  tarefa. Critério de sucesso é do participante, não do produto.

## Tarefa 1 — Localizar a animação (métrica: descobribilidade)

Prompt: *"Abra a ROM e me mostre onde fica a animação de esperar do Sonic."*

O que observar:
- Se encontra **Ferramentas → Reverse Workspace → Inspeção visual** sem ajuda
  (o painel abre com "Identificar base" / "ROM BYOR") e se o termo
  "Inspeção visual / perfil assistido" faz sentido para ela.
- Se reconhece a sequência `id_Wait` na tira de quadros embaixo do painel
  **Duração da animação** — as miniaturas mostram o Sonic REAL (prévias
  compostas), e a legenda declara entradas na ordem do script versus desenhos
  únicos; ver se ela entende a diferença sem explicação.
- Se procura a duração em lugar errado (ex.: nos detalhes técnicos do frame em
  vez do painel de cadência) ou se descobre que os detalhes técnicos estão
  recolhidos num `<details>` secundário.

Sinal de passagem: a participante nomeia a animação, a contagem de quadros e o
conceito de duração em suas palavras antes de editar.

## Tarefa 2 — Deixar a animação mais lenta (métricas: linguagem, feedback)

Prompt: *"Faça o Sonic esperar mais tempo, sem escrever nenhum número se
puder evitar."*

O que observar:
- Se descobre os botões **Mais lento / Mais rápido** e se entende que eles são
  **política de proposta** (E2-4): cada clique ajusta só o valor proposto
  (tooltip "Proposta: +1 tick… nada é gravado até você clicar em Aplicar
  duração"); a gravação exige "Aplicar duração". Ver se a pessoa procura esse
  segundo passo ou se espera que o clique já grave.
- Se compreende a "Previsão da proposta" exibida ("byte 24 ⇒ cada quadro
  ficará 25 frames de tela em NTSC ≈ 0,42 s") e não confunde com segundos
  diretos nem com a linha do valor já aplicado.
- Se o bloco **Estado do trabalho** (Pendente / Aplicado à cópia / Salvo)
  elimina a edição fantasma — ela deve apontar qual chip prova o quê.
- Se a recusa de valores reservados (0, ≥128, terminadores) é explicada em
  linguagem de usuário, não em código de erro.
- Se entende o que a mensagem de sucesso prova: offset `0x13BAE`, novo valor,
  SHA da CÓPIA — e que a ROM original (chip "base: somente leitura") não foi
  tocada.

Sinal de passagem: a participante prevê o efeito na tela ANTES de aplicar e
confirma o efeito depois conferindo a cópia (byte exato).

## Tarefa 2b — Pintar um pixel e ver original vs modificado (métrica: comparação)

Prompt: *"Mude a cor de um detalhe do Sonic e me mostre o que mudou sem
conferir byte nenhum."*

O que observar:
- Se encontra o grupo **Cor** ("Editar cor da paleta" — paleta MD RGB333,
  índice + R/G/B) ou o editor de **Pixels** dentro da área de animação, e se a
  linguagem do painel ("paleta é compartilhada", "cópia") a ajuda ou confunde.
- Se usa a comparação lado a lado do palco — **Cópia atual (edições
  acumuladas)** ao lado de **Original · ROM base intocada** (E2-3) — como
  resposta natural ao prompt, em vez de pedir verificação byte a byte.
- Se a prévia animada ("Reproduzir prévia") casa com a expectativa dela sobre
  "ver a animação" (e se entende o aviso de que a prévia é demonstração do
  navegador, não prova dentro do jogo).

Sinal de passagem: a participante aponta as duas janelas e nomeia a diferença
sem usar offset ou SHA.

## Tarefa 3 — Retomar a edição após reinício (métrica: recuperação)

Prompt: *"Feche tudo, reabra o programa e me mostre que sua edição continua
lá — depois desfaça só a parte da duração."*

O que observar:
- Se o **banner de retomada** ("Há uma sessão de inspeção anterior…") aparece
  na reabertura e é lido como convite, não como aviso ignorado; se usa
  "Reabrir última sessão" ou refaz o caminho explicitamente — e se nota que o
  banner **cede** (desaparece) quando a sessão fica viva (E3-4).
- Se o painel restaura sequência + duração + pixel sem reeditar nada — e se o
  sprite **está visível** na janela recriada (correção de apresentação
  `932f2c6`; antes, o palco aparecia magenta após reabertura).
- Se o wizard de projeto na reabertura é entendido (fecho explícito visível
  coexiste com a inspeção retomada — correção E10, não supressão).
- Se encontra o ledger de procedência (detalhes técnicos / resultado da
  edição com SHA da ROM modificada) e explica, com ele aberto, QUEM mudou QUÊ
  (domínio, offset, anterior→sucessivo, SHA da cópia).
- Se "Restaurar original" da cadência é escolhido para desfazer só a duração,
  e se confere pelo editor e pela comparação que o pixel pintado permanece
  intacto (escopo do desfazer declarado no próprio painel).

Sinal de passagem: a participante recupera o estado completo sem pedir ajuda
e descreve a restauração seletiva como "só a duração voltou, o resto ficou".

## Métricas de fechamento (por tarefa)

| Métrica | Como registrar |
| --- | --- |
| Descobribilidade | cliques/perguntas até o primeiro controle certo |
| Linguagem | termos do painel que a participante repetiu corretamente (proposta, pendente, aplicado à cópia, original/modificado) |
| Feedback | instante em que soube que a gravação aconteceu e em qual arquivo |
| Comparação | se usou o palco lado a lado antes de pedir prova byte a byte |
| Recuperação | ajuda necessária após reinício (0 = ideal); se notou o sprite visível |
| Obstruções | qualquer momento em que o produto impediu (drawer, wizard, overzap, banner que briga com o fluxo) |

## Limites de alegação

Vale apenas para Sonic 1 (USA, Europe) Rev00 + core Genesis Plus GX v1.7.4
neste host, classificação **Experimental**. Enquanto não houver sessão humana
gravada com este roteiro, a frente NÃO afirma "iniciante consegue"; afirma
apenas que o caminho técnico é provado por E2E (jornada `sonic-anim-integrada`
allPass 28/28 no binário final, sem mitigação de ambiente) e que as
obstruções conhecidas — drawer sobre a ação, wizard sem fecho na reabertura,
retorno do diagnóstico depois de "Parar", sprite invisível pós-reabertura —
foram corrigidas e têm teste automatizado. A revisão deste roteiro (ETAPA 4)
descreve a superfície entregue em `ac08fbb`/`932f2c6`; não é, por si,
evidência de usabilidade.
