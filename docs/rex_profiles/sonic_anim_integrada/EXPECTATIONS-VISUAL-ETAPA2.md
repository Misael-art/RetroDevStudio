# EXPECTATIONS-VISUAL-ETAPA2 — congelado antes de implementar (2026-10-03)

Escopo: ETAPA 2 da missão visual — "Entregar o workspace de animação"
organizando a superfície existente (InspectionPanel, perfil assistido Sonic 1
Rev00 `sonic1_sonic`, cadência `id_Wait`). Nenhuma ampliação de codecs,
variantes ou animações. Os contratos da ETAPA 1 (N+1, unidades, proveniência,
limitações, Experimental) permanecem integralmente; nada deste documento
reduz critérios anteriores.

Disciplina: este arquivo é commitado sozinho, antes de qualquer mudança de
código ou execução de prova. Desvio observado = FAIL/INCONCLUSIVE com série
bruta registrada; nunca reescrever o esperado depois de medir.

## Decisão de política congelada (uniformização exigida pela missão)

- `Mais lento` / `Mais rápido` operam em **política de proposta**: alteram
  apenas o valor proposto (input `inspection-cadence-value`) e o aviso de
  pendência; **nenhuma escrita** é enviada ao núcleo ao clicar nesses botões.
- A gravação ocorre por um único caminho de aplicação: `Aplicar duração`
  (e `Restaurar original`, que mantém a semântica de aplicação direta com
  escopo declarado de desfazer somente o byte de duração).
- Texto do botão, aviso de pendência e botão Aplicar devem concordar com essa
  política (título `title` dos botões diz "proposta"; o aviso pendente diz que
  nada muda na cópia até Aplicar).

## Gates (verdes = requisitos cumpridos; cada gate é discriminante)

E2-1. **Área de animação dedicada.** Com um frame `sonic1_sonic/*` selecionado,
a superfície apresenta uma região `data-testid="inspection-animation-area"`
com, nesta ordem legível: palco com sprite ampliado em escala inteira
pixelada; tira de miniaturas da sequência com reprodução/pausa; grupos de
controles; estado do trabalho; ações. Gate: a região existe, contém o `<img>`
do palco (`inspection-sprite-frame-image`) e os grupos
`inspection-anim-group-duration`, `inspection-anim-group-color`,
`inspection-anim-group-pixels`, e o bloco `inspection-work-state`.
Negativo: com recurso não-Sonic (ex.: `spr_ryo_100`), a área de animação
não é exibida (o workspace é do perfil demonstrado, não uma promessa geral).

E2-2. **Entrada da sequência ≠ desenho único.** A legenda da tira declara
"N entradas na ordem do script" e "M desenhos únicos" com M ≤ N, derivados dos
bytes da cadência lidos do núcleo (para `id_Wait` comprovado: 18 e o número de
bytes distintos). Gate: os dois números aparecem corretos no texto; negativo:
um byte repetido não pode ser contado como desenho novo (teste com fixture
de repetição).

E2-3. **Comparação original/modificado lado a lado.** Quando a sessão possui
edições aplicadas (`session.edit` presente), o palco exibe duas imagens:
`inspection-sprite-frame-image` (cópia atual) e
`inspection-sprite-frame-original-image` (ROM base, composta com
`from_base=true` pelo mesmo pipeline canônico, sem reimplementação no front).
Cada imagem porta `data-sprite-rom-sha256` e `data-pixels-sha256`. Gate:
após editar um pixel de arte comprovado, a imagem da cópia muda de
pixels_sha256 e a original permanece com a SHA dos bytes da base; o
`rom_sha256` da original é o da base intocada
(`c7da53a1…` no BYOR demonstrado; em testes unitários, a SHA do fixture base).
Negativo: sem edições, nenhuma imagem original é composta (nenhuma chamada
`from_base=true`) — a comparação só aparece quando há algo a comparar.

E2-4. **Estado pendente / aplicado à cópia / salvo.** O bloco
`inspection-work-state` expõe três indicadores com estados verificáveis:
- pendente: visível e nomeando o valor proposto exatamente quando
  `proposta ≠ intervalo vigente na cópia` (inclui proposta vinda de
  Mais lento/mais rápido);
- aplicado à cópia: visível com o SHA da cópia quando existe edição aplicada
  (pixels, paleta ou cadência) e desaparece do "nada aplicado" quando
  `session.edit` existe;
- salvo: visível com o instante da última sessão salva depois de `Salvar
  sessão`; volta a "alterado após salvar" quando uma nova escrita é aplicada
  depois do salvamento.
Gate: transições acima em testes de componente. Negativos: (a) clicar
Mais lento NUNCA produz "aplicado" novo (nenhuma escrita); (b) valor fora do
domínio comprovado produz recusa local com "nada foi enviado ao núcleo".

E2-5. **N+1 preservado; unidades não equiparadas.** Para cada valor proposto,
a previsão do grupo Duração mostra "quadro fica byte+1 frames de tela" e a
conversão a segundos é rotulada como previsão derivada do ritmo NTSC medido;
a UI não usa a palavra "FPS" como unidade de duração e não apresenta
ticks/frames/segundos como equivalentes. Gate: asserções de texto no grupo
Duração, incluindo a previsão da **proposta** (não só do valor vigente).

E2-6. **Mensagens junto da operação, não só no console.** Cada grupo de
operação tem um slot `aria-live="polite"` próprio que recebe o resultado da
própria operação: composição de frame, paleta (`inspection-palette-message`),
tiles/pixels, duração (`inspection-cadence-error` preservado), exportar BPS
(`inspection-patch-message`), salvar sessão (`inspection-session-message`).
Gate: sucesso e erro aparecem no slot do grupo sem depender do console;
o `logMessage` do console permanece (não é removido). Negativo: uma recusa do
núcleo não pode deixar apenas rastro no console.

E2-7. **Ações claras: jogar, exportar, retomar.** Um bloco de ações agrupa os
botões existentes sem renomeá-los (testids preservados). Retomar: a sessão
sobrevive ao desmonte do painel na mesma instância do app (cache de sessão em
escopo de módulo com verificação `inspectionStatus` ao remontar); após
reinício completo do app, um banner `inspection-resume-banner` oferece a
reabertura da última sessão salva (id persistido em `localStorage`
`rds.inspection.lastSessionId`) com um clique. Gate: remontar o painel com
sessão viva restaura palco, cadência e estado sem navegar pelo catálogo; o
banner aparece quando há id persistido e nenhuma sessão viva, e ao clicar
reabre a sessão correta. Negativo: id persistido de sessão inexistente no
núcleo resulta em erro acionável no banner, não em sessão fantasma.

E2-8. **Detalhe técnico secundário, proveniência preservada.** O bloco de
metadados do frame (`inspection-sprite-frame-metadata`) e a proveniência/
limitações da cadência (`inspection-cadence-provenience`) passam a
apresentação secundária (`<details>`), mantendo todos os textos e testids no
DOM (atributos legíveis por harness sem expandir). Gate: nenhum texto de
proveniência ou limitação é removido; a área de animação não exige que o
iniciante leia offsets/SHA para concluir a tarefa (nenhum offset obrigatório
fora dos `<details>` exceto os já existentes nos resultados de edição).

E2-9. **Sem regressão do que já foi provado.** Os suites existentes
(vitest do painel, contrato de cadência, composição Sonic, gates de
integridade da rodada integrada) permanecem verdes com as adaptações mínimas
exigidas pela política E2-0 (proposta em Mais lento/rápido) — a única mudança
de comportamento deliberada deste ETAPA; cada teste adaptado é marcado com o
gate que o justifica. O comportamento dos demais caminhos (aplicar, restaurar,
no-op, respostas atrasadas, identidade carregada vs disco) fica inalterado.

E2-10. **Teclado, foco e rolagem.** Os controles novos são botões/inputs
nativos alcançáveis por Tab com ordem lógica (palco → tira → grupos → estado →
ações); o palco mantém `overflow-auto` com conteúdo maior que a área. Gate:
testes de componente verificam `focus` programático nas âncoras novas
(âncora de retomada incluída); a verificação desktop (foco real sob Xvfb,
drawer/console aberto, wizard, rolagem) pertence à ETAPA 3 no binário final e
é registrada como pendente até lá.

## O que NÃO é gate desta etapa

- Correção de apresentação do magenta (compositing) — é ETAPA 3; esta etapa
  não altera o fundo CSS `#ff00ff` nem o pipeline de pixels.
- Comportamento do botão "Parar" da Game View (navegação para Scene) —
  registrado como achado; E2-7 cobre a retomada, não a navegação.
- Redesenho do app, mudança de workspaces ou novos cores/animações.

## Provas novas versus herdadas (registro)

Novas: E2-1..E2-8 e E2-10 (componente) + testes Rust de `from_base` e do
pipeline de composição intacto. Herdadas: tudo listado em E2-9, mais o
contrato ETAPA 1 (`EXPECTATIONS-VISUAL-ETAPA1.md`, commit 08d3918) e as
provas da rodada integrada (PR #100/#101) que não tocam estes arquivos.
