# Avaliação CX — jornada de cadência Sonic 1 (Etapa 3 consolidada em 2026-10-03)

Método: somente obstáculos REALMENTE observados durante as corridas E2E da
jornada (run-1..run-4, relatório em
`data/rex_profiles/sonic_cadence/evidence/2026-10-03-journey/`) e durante a
construção da UI (commits citados). Cada item diz o que o produto já resolve,
o que ficou como fricção residual e o que NÃO foi afirmado sem prova.

## Obstáculos encontrados e tratados no produto

1. **"Byte N ≠ N frames" — a armadilha central.** Um iniciante que digita uma
   duração espera que o número seja a duração vista na tela. A Etapa 4 provou
   por oracle independente que o quadro fica visível N+1 frames de tela (NTSC).
   Tratamento: o painel mostra a PREVISÃO MEDIDA ("byte 23 ⇒ cada quadro fica
   24 frames de tela ≈ 0,40 s") com a origem (oracle, veredito H_N+1) e marca
   PAL como não medido (ebe186f).
2. **Prévia do navegador confundida com prova do jogo.** A prévia toca no
   ritmo medido mas usa o relógio do navegador. O painel declara isso no
   próprio texto visível: "é demonstração, não prova da duração dentro do
   jogo" (ebe186f). Decisão CX deliberada: não esconder a limitação.
3. **Valores perigosos aceitos silenciosamente.** O byte de intervalo tem
   valores reservados com semântica (0x00, 0x80, 0xFE/0xFF terminadores).
   O núcleo recusa e o console explica o motivo, o intervalo comprovado
   (1–127) e a lista de reservados (InspectionPanel.tsx:482–491). No-ops
   (valor igual ao atual, restaurar quando já é original) são recusados com
   mensagem, não executados em silêncio.
4. **Edição sem confirmação do que mudou.** Após aplicar, a mensagem do
   console inclui offset real (0x13BAE), novo valor e SHA-256 da CÓPIA — a
   base nunca é tocada (gate `pipeline.base_preservada_ate_jogo`/
   `jogo.base_preservada_no_final` na jornada).
5. **Estado pendente invisível.** Digitar um valor sem clicar em "Aplicar
   duração" mostra aviso amarelo explícito ("ainda não foi gravado; nada muda
   no jogo") (InspectionPanel.tsx:875).
6. **Reabertura ambígua de sessão salva.** Havia empate não determinístico na
   escolha da sessão ao reabrir; corrigido com desempate determinístico e
   teste BYOR dedicado (fc06a81). A jornada prova a reabertura de ponta a
   ponta: painel restaura 40 ticks, previsão 41 e a proveniência da edição
   (SHA da cópia) antes de qualquer recomposição (`reabrir.restaura_40_previsao_41_proveniencia`).

## Fricções residuais (reais, não resolvidas no produto — workarounds no E2E)

1. **Drawer de console cobre a área de ação.** O E2E precisa fechar o drawer
   antes de vários cliques (`closeVisibleConsoleDrawer` chamado em cada uma
   dessas etapas). Usuário humano sofre o mesmo: botões de inspeção ficam
   alcançáveis porém sobrepostos. CANDIDATO a fix: drawer não-modal ou
   empurrável.
2. **Wizard de projeto cobre a tela na reabertura.** O driver trata o wizard
   explicitamente (`handleProjectWizardVisibly`); na sessão recriada ele
   aparece sobre o workspace recém-restaurado. CANDIDATO: suppression quando
   existe sessão salva recente.
3. **Contador de frames exibido é quantizado (×10).** `data-rendered-frames`
   só atualiza a cada 10 frames (ViewportPanel.tsx:1523–1526) — bom para
   FPS, enganoso como régua de medição. Nenhum número de cadência é exibido
   a partir dele; medicação séria exige o comando de amostragem no core
   (59fba41). Limitação documentada, não escondida.
4. **Custo de interação por IPC.** Leituras de memória vindas da página
   (~100 ms cada, mutex do core compartilhado com o pump) tornam
   impossível qualquer medicação frame-a-frame ao vivo (causa-raiz do FAIL
   da run-2, registrada no Addendum-A). Para o usuário isso se traduz em:
   observação longa da Game View degrada a fluidez. O desenho final (lote
   com mutex no core) elimina para o caso de cadência; genérico permanece.

## Lições de infraestrutura que afetam afirmações de CX

- run-1 provou o gate de fingerprint: binário SEMPRE reconstruído no HEAD
  exato da evidência antes de corrida isolada.
- run-2/run-3: desvios registrados como FAIL honestos com série bruta
  persistida e congelamento PRÉVIO da correção (Addendum-A, Retificação A)
  — nenhuma reescrita post-hoc.
- A jornada final (run-4) fecha allPass 48/48 no driver + 35/35 no
  verificador independente, com os números exatamente congelados:
  base 23→modo 24, modificada 40→modo 41, discriminante 24≠41.

## Escopo das alegações

Tudo acima vale para Sonic 1 (USA, Europe) Rev00 BYOR + core Genesis Plus GX
v1.7.4 46a5521 neste host, perfil `sonic_cadence`, classificação
**Experimental / local profile validation**. PAL, outros cores, outros jogos e
"qualquer animação" NÃO são afirmados.
