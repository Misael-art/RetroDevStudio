# C5 — reconciliação de evidência, SHAs e política de PNGs (2026-10-03)

## cadeia produto→binário→execução (reviveada hoje, por computação, por citação)

| Artefato | SHA-256 pinado | Estado na re-verificação |
|----------|----------------|--------------------------|
| Binário E3 (built em `a0067d8`) | `ce54d579381257364514c28833876127359edbaf61448726fee9709602ec7623` | presente em `REX-SONIC-ANIM-VISUAL-2026-10-03/src-tauri/target-test/debug/retro-dev-studio`, hash confere |
| Relatório jornada E3 run-01 | `507c1250daa1dc7a5408858808111e190570394b1aa1e732ca2c7d8bc29ed23a` | versionado, confere |
| Metadata do runner | `d033263c741624702389d88bf34c70133926acb434e7969381a8d9978e87e15d` | versionado, confere |
| Log do runner (fora do repo por `*.log`) | `898121f039d00b00e3fda52ca1e91b5c3b130788556f5369912ade7cd8ba16d2` | presente em `~/rds-scratch/anim-e3-journey-20261003-01/desktop.log`, confere |
| Captura defeituosa (negativo) | `207b233f7ef40cda74ee55925c942d458dbcf93f0683a1c25bf910b8f81c11fe` | confere; reprovada de novo em C3 (12258 mismatches) |
| Captura E3 correta | `554eb5ff9ec1bf573124e3954447ee811a9fce8e5ac95c1075b3583853880027` | confere; 0 mismatches em C3 |
| Captura passo-9 jornada | `8e8e05a8af02fa26e3026e030447d53020fe6c13d3c8194efbdc4398099157e1` | confere |
| Capturas ETAPA 1 (A/B + originais magenta/stand) | `89a35a2b…`, `a081b0be…`, `f9fbf627…`, `02d6adb7…`, `8eb45b37…` | conferem |
| Referências de dados | pixels recompostos `abbf2d5e…78ac`; ROM base `c7da53a1…` (531577 B); relatório run-03 `eca15e84…` | recomputados em C3, batem |

Fato de código usado como garantia de corrente: entre `a0067d8` (build do
binário) e `36c9a05` (HEAD do destino) só há commits de documentação
(`c184ee2`, `36c9a05`) — o binário pinado representa o código de produto do
destino. Nenhum commit entre build e execução na prova original (gate de
proveniência registrado em `RESULTADO-VISUAL-ETAPA3.md`).

## política de PNGs versionados

- Precedente consolidado no repo: evidências PNG já são versionadas em
  `data/behaviors/evidence/`, `data/nodegraph_authoring/evidence/`,
  `data/reference_platformer_art/doc/evidence/` e
  `data/rex_profiles/mugen_sgdk/evidence/` (rodadas 2026-09-23/24/28).
- Os 7 PNGs da rodada visual em
  `docs/rex_profiles/sonic_anim_integrada/evidence/2026-10-03-visual/`
  seguem o mesmo padrão (os 7 PNGs somam 1.545.216 bytes, medido hoje) e
  estão cobertos por `.gitattributes`
  (`*.png binary`).
- `check:tree` no destino: OK (estrutura conforme
  `docs/08_TREE_ARCHITECTURE.md`; `docs/rex_profiles/**/evidence` é árvore
  já usada por outras frentes).
- Logs de runner permanecem FORA do repo (gitignore `*.log`), com SHA e
  caminho local registrados no documento de resultado — política mantida.
- Decisão: manter capturas de prova versionadas em `docs/.../evidence/`
  (armazenamento permitido); nada de ROM/binário no repo; artefatos grandes
  em `~/rds-scratch` com hash registrado.

## pendências reconciliadas desta corrente

- Gate `clippy --all-targets`: NUNCA verde no repo (46 falhas pré-existentes
  em código de teste) — permanece "não aprovado", não "aprovado".
- Audits de segurança locais: não executados nesta frente; dependências
  inalteradas (diff vazio de `package.json`/locks/`Cargo.toml`/lock); CI os
  executa remotamente.
- Sessão de usabilidade humana: nenhum participante; ETAPA 4 e esta
  consolidação NÃO declaram usabilidade.
- Rerun do cenário `sonic-anim-visual-diagnostico` no binário final:
  executado em C6 somente se a perna E3-4 for usada como evidência; até
  aqui a jornada integrada cobriu o equivalente (banner que cede).
