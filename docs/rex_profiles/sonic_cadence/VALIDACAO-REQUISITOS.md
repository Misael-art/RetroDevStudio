# Mapa requisito → implementação → teste — fatia de cadência Sonic (Etapas 1–6)

Cada linha aponta requisito da missão, implementação (commit/arquivo) e a
prova executada. "UI" = scenario `sonic-cadence-journey` no desktop E2E
isolado (run-4 allPass; evidência em `evidence/2026-10-03-journey/`).

| # | Requisito | Implementação | Prova |
|---|---|---|---|
| 1 | Abrir a própria ROM (BYOR), sem dump no repo | perfil `sonic_cadence` consome `RDS_INSPECTION_ROM` | gates de SHA nas corridas; ROM pin `c7da53a1…` só em `.staging` local |
| 2 | Encontrar sequência de animação PROVADA (id_Wait) e publicar contrato | d8796dc `CONTRACT.md` + núcleo id_Wait (d9f09ea) | verificador independente do contrato; offsets lidos crus da ROM |
| 3 | Ver quadros reais na ordem correta | 19efccc composição pelos índices do script via pipeline canônico | painel 18 quadros com miniaturas compostas (`painel.ordem_e_miniaturas`) + recomposição pós-reabertura |
| 4 | Entender a duração atual em unidades do usuário | ebe186f: original/aplicado em ticks + hex + previsão medida H_N+1 | `painel.original_23/current_23/previsao_24` na UI real |
| 5 | Mudar a duração pelo fluxo canônico (nunca byte solto) | `rex_inspection_edit_sonic_duration` (d9f09ea) + Apply na UI | `editar.mensagem_com_sha_independente`, `pipeline.edit_formato_offset_unico`, `pipeline.copia_bytes_exatos` (1 byte em 0x13BAE, cópia byte a byte igual à mutação independente) |
| 6 | Ver previsão/prévia antes de aplicar | ebe186f prévia no ritmo medido + aviso pendente | estados do painel verificados na UI; texto declara "demonstração, não prova" |
| 7 | Aplicar numa CÓPIA; base intocada | edita só cópia da sessão | `pipeline.base_preservada_ate_jogo` + `jogo.base_preservada_no_final` (leitura cru == base) |
| 8 | Exportar BPS e aplicar pela UI | barra de export/apply Sonic | `bps.aplicado_igual_mutacao_independente` (aplicada ≡ cópia esperada, byte a byte) |
| 9 | Rodar a ROM modificada e ver efeito no JOGO | botões Jogar base/modificada na Game View | portões ao vivo ×2 (identidade, reancoragem, ACK de START nativo, +10 frames pós-ACK, framebuffer novo, negativo KeyQ) |
| 10 | Provar a cadência de forma INDEPENDENTE do produto | Etapa 4: oracle em Rust (a4fdc6d) + verificador Node de série bruta | suíte A1/A2/A3/B40/C60/D com veredito H_N+1, determinismo e negativo; allPass |
| 11 | Medir a cadência na jornada desktop frame a frame | 59fba41 `emulator_run_frames_sampled` (mutex segurado, 1:1, índices absolutos) + Addendum-A/Retificação A | run-4: 1402 linhas contínuas 1500..2901 por corrida; base modo 24 (58 recargas, razão 1,0), modificada 41 (35, razão 1,0); discriminante 24≠41; `sonic-cadence-journey-verifier.mjs` 35/35 recalculando do hex bruto |
| 12 | Salvar → fechar → REABRIR preservando edição + procedência | sessão salva + proveniência no resultado da edição | `reabrir.restaura_40_previsao_41_proveniencia` (janela destruída e recriada de verdade) |
| 13 | CX: obstáculos fixados/registrados | ebe186f/fc06a81 + fricções residuais documentadas | `CX-EVAL.md` (metodologia: só observação real das corridas) |
| 14 | Qualidade de engenharia (gates do repo) | esta entrega | check:tree, lint, tsc, npm test, clippy -D warnings, cargo test --lib 846/0, cargo fmt --check, host:certify, npm audit (high) limpo, cargo audit exit 0 → `gates.json` |

Negativos deliberados: valores reservados e no-ops recusados com mensagem;
tecla não mapeada não produz input; framebuffer reutilizado de corrida
anterior mata a jornada; ROM aplicada divergente da mutação independente mata
a jornada.
