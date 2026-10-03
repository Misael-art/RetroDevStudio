# Mapa requisito → implementação → teste → resultado (E1–E10)

Frente: jornada integrada de edição de animação Sonic 1 (superfície canônica
de inspeção, desktop real). Expectativas congeladas em
`EXPECTATIONS-INTEGRADA.md` (a657423), com correções de driver pelo
`EXPECTATIONS-ETAPA5-ADDENDUM-1.md` (R-1..R-4, 717ec2d) e de meio pelo
`EXPECTATIONS-ETAPA5-ADDENDUM-2.md` (M-1, 03986d0).

Veredito terminal: corrida 4 no HEAD `b824e11`, binário
`03628796c1fdfd8ad9630fd4634e0d62dc81dde5bf7c897a05b1552d367e053a`,
`allPass: true`, 24/24 checks nomeados, 10/10 passos, sem aborto
(`report-journey-run4.json`; hashes integrais no `manifest.json`).

| E | Requisito (resumo congelado) | Implementação | Teste nomeado | Resultado |
|---|---|---|---|---|
| E1 | Edição acumulável: uma edição não desfaz silenciosamente a outra; `changed_offsets` é a diff CUMULATIVA base→cópia; por-operação vive no ledger | inspeção canônica (pipeline `inspection.rs`; cumulativa em :1398, ledger por-operação em :1443–:1486) — contrato provado na Etapa 2 (60447fb) | `passo5.diff_exatamente_dois_bytes`, `passo5.copia_identica_mutacao_independente`, `passo9.ledger_nomeia_os_dominios`, `passo10.ledger_registra_a_restauracao` (E2E) + suite Rust da Etapa 2/4 | PASS (byte-exato: offsets `[80814, 139582]`, `bytes_changed=2`; ledger com offsets/old/new por domínio) |
| E2 | Integridade de carga: identidade SHA por sessão, no-op detectado, sessão errada recusada | Etapa 2 (identidade de carga + transações) | testes Rust `etapa2`/E7 da Etapa 4 + `passo1.byor_pinado`, `final.base_preservada` | PASS |
| E3 | Cadência `id_Wait` editável pelo pipeline canônico (byte $01..$7F em 0x13BAE), mensagem com SHA da cópia | Etapa 2 + painel de duração (Etapa 3) | `passo4.mensagem_com_sha_da_copia_acumulada`, `passo5.byte_cadencia_cru` | PASS (cru no arquivo: `0x13BAE=40`) |
| E4 | Pintura de 1 pixel nibble com confirmação de compartilhamento quando aplicável | pintura acumulada canônica (existente) + fluxo confirmado na UI | `passo3.pintura_offset_unico`, `passo3.copia_so_pixel`, `passo5.nibble_cru` | PASS (cópia só-pixel `b1ed600d…`; nibble cru lido do arquivo) |
| E5 | BPS exporta e reaplica reproduzindo a cópia byte a byte | fluxo BPS canônico | `passo6.bps_reproduz_copia` | PASS (patch `4c039980…`, cópia reaplicada `3274e7c4…` = esperada da jornada) |
| E6 | Reconhecimento de sprites reais: quadro composto verificado contra bytes e metadado doador (sem forma geométrica substituta em prova positiva) | verificação de quadro composto da frente multiframe/cadência | `passo2.id_wait_18_quadros`, `passo9.copia_reaberta_e_a_jornada` (recompose 40×40 por pixels_sha256) | PASS |
| E7 | Corrida de respostas e sessão errada (negativos) | Etapa 4 (controles por domínio) | testes negativos Rust + `modificada-integrada.negativo_tecla_nao_mapeada`, `modificada-integrada.framebuffer_nao_reutilizado` | PASS |
| E8 | Duração previsível: byte 23 → previsão 24; 40 → 41 (discriminante 24≠41) | contrato Etapa 1 + painel Etapa 3 | `passo2.original_23_previsao_24`, painel em `passo4`/`passo10` (`23 ticks (0x17)` após restaurar) | PASS |
| E9 | Jornada desktop de 10 passos no binário reconstruído no HEAD exato, com gate de identidade dos bytes carregados na Game View e input nativo | cenário `sonic-anim-integrada` (d141a49, 7f82ff7, 43d945d, b824e11) | 10 passos nomeados em `report-journey-run4.json` (24 checks; ACK de START nativo = prova de gameplay; sonda `send_input` nunca chamada como teclado real nesta corrida) | PASS (run-1→4: histórico honesto no manifest; correções por adendo, limiar de frames nunca afrouxado) |
| E10 | CX para iniciante: três tarefas, métricas, validação humana pendente sem fraude; drawer não cobre ação principal; wizard coexiste com fecho visível | Etapa 3 (d46cafd) + roteiro `CX-ROTEIRO.md` (39d2277) | `passo2.linguagem_iniciante`, `passo8.wizard_coexiste_com_fecho_visivel` | PASS (máquina); validação humana com participante permanece PENDENTE por design do roteiro |

## O que esta frente NÃO afirma

- Não afirma "iniciante consegue" sem participante humano (E10 marca a
  validação como pendente; o roteiro está entregue).
- Não há release, merge ou promoção de maturidade: PR dependente da cadeia
  codex/rex-sonic-cadence (PR #100), base `a59e7dc`.
- ROM e derivados binários não são versionados (BYOR; só SHA-256 pinado).
- Superfície permanece Experimental/validação do MVP conforme AGENTS.md.
