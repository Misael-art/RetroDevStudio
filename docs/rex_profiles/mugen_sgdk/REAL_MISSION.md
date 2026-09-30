# MUGEN real: Ken, fidelidade e execução (Experimental)

Missão de 2026-09-30. Documento de missão e matriz única desta frente; o estado
operacional continua no Memory Bank e a maturidade continua no roadmap.

Base confirmada: `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42`, PR #87 aberto,
dependente de `codex/rex-mugen-ux-v2` em
`d1b5a4d2bc37d4a9d3c78ea708b899ed44a38d7a`. Worktree exclusiva
`REX-MUGEN-REAL-2026-09-30`, branch `codex/rex-mugen-real`.
O checkout canônico e seus arquivos não rastreados foram preservados.
`0194f9465e759a3ba3d6fae84b4f5aef0576a4af` continua fora da base e deve ser
preservado na futura integração, juntamente com os checkpoints seguintes.
Nenhum merge ou release autorizado nesta missão.

Host nas duas worktrees: READY, fingerprint
`60249508aff61897cdd43160d4716b2344d69282507a36c5a457c0028143f6e2`, lock
`dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377`.
Na inspeção inicial não havia app, build ou harness RetroDev ativo.

## Fonte piloto

Candidato identificável: `Ken_Majik_.zip`, em
`SGDKForge/SGDK_projects/Mugenesis_Demo [VER.001] [SGDK 211] [GEN] [GAME] [FIGHTING]/rascunho/inputs/mugen_authorized_20260929/characters/street-fighter-zero/`.
Origem local BYOR; o operador confirmou expressamente: «este ken majik pode ser
usado, prossiga por ele». Nenhum pixel, pacote ou ROM de terceiros entra no Git.
Fonte preservada; derivados locais em `~/.retrodev/mugen-real-2026-09-30/`.

| Recurso | SHA-256 |
|---|---|
| pacote | `b244ec9a105fa0131b37c075dc06b032a87cf0f839f46ec7054ac60d9bd6f14c` |
| `ken8/ken8.def` | `fdbe2fb2498be72078232ca68f2cc74fd8347aac2c8304c626d5f15dc68f5fc8` |
| `ken8/ken.sff` (v1.0.1.0, 201 sprites) | `911e21b778af3e7a93cd69fe6132b8e87fb1cacddac757ada5842a8cb1c2172c` |
| `ken8/ken.air` (102 ações) | `b1f6c8d093dfd0849091035d7721a5748b59a476084bbc7ebf1ce2e1c6e7ed3a` |
| `ken8/ken1.act` | `89942f64862be6cb2bb0c094b2ab0ebb5cb411c06b7f1a6f9d69af64647687f2` |
| `ken8/ken.cmd` | `728e914f4de8d6de84af7c572af1e811c03ef142e1b168e49057bc0ba0416e16` |
| `ken8/ken.cns` | `0b4593b7fec0e555c41b21a032a95ea5efc540b61f201d2504a409cd4d692755` |

DEFs encontrados no pacote: `ken8/ken8.def` (personagem) e
`ken8/end/sfakenend.def` (storyboard, não candidato de personagem).
DEF declara `stcommon=common1.cns` externo e storyboard de introdução absoluto.
Inventário e diagnóstico dessas dependências ficam em `source_analysis` no
relatório reabrível. Seleção piloto explícita: ações 0 (idle), 20/21 (caminhada)
e 200 (soco), paleta `ken1.act`, comportamento autoral rotulado. São 21 elementos
AIR e 18 células distintas. As 98 ações excluídas são registradas, sem apagar a fonte.
Inspeção independente: extração PCX por Pillow, sem usar decoder RetroDev;
galeria original e hashes dos índices/RGBA em diretório BYOR.
A primeira galeria foi inspecionada: personagem reconhecível, gi vermelho,
seis elementos de idle/caminhada e três de soco; poses de larguras distintas.

## Matriz da missão

| Problema | Hipótese | Arquivo afetado | Teste | Evidência | Status |
|---|---|---|---|---|---|
| Prova anterior usa geometria | runtime demonstrado, fidelidade real não demonstrada | `fixture.rs`, harness | piloto com pixels reais | PR #87 e fonte BYOR acima | confirmado |
| DEF escolhido por pontuação | alternativa pode ser ocultada | `source.rs`, `project_mgr.rs` | DEFs múltiplos, case, duplicados, storyboard | seleção explícita; referências resolvidas chegam ao importador canônico | corrigido; testes verdes |
| Primeira divergência: ACT ignorada | associação de paleta, não decoder | `mugen_profile.rs`, `sff.rs` | Pillow × índices Rust, ACT × paleta embutida, escolha/reabertura | 201 sprites sem diferença de índices; cor usada nº 4 passa de (113,0,0) para (176,0,0) com ACT | corrigido; ACT declarada/hash persistido |
| Preto opaco vira transparente no BMP | índice 0 era escolhido por igualdade RGB | `build_orch.rs` | máscara RGBA de tiles da ROM × fonte quantizada; regressão de BMP | 172 pixels do idle 0 eram perdidos; fundo preto escondia a diferença | corrigido; oráculo compilado exato |
| Importação real causa panic | par numérico escalar avaliado antecipadamente | `project_mgr.rs` | vazio/escalar/par válido | `then_some` acessava índice 1; substituído por avaliação lazy | corrigido; regressão verde |
| Atlas inteiro contado como VRAM residente | estimativa estática inadequada ao SPR do SGDK | `md_profile.rs` | modelo 104×104/27 frames e ROM real | 142 KiB estimados versus 3.072 bytes de tiles residentes compilados | corrigido; warning conservador mantido |
| Revisão antes de gerar projeto ausente | escolhas precisam de contrato persistente | wizard, IPC, painéis existentes | selecionar/analisar/revisar/importar/editar/salvar/encerrar/reabrir | UI real: 21 prévias; velocidade 2,5 → 1,5 salva; relatório e pixels idênticos após reinício | comprovado |
| Idle/caminhada dependem de common states | lógica de origem não basta no pacote | modelo/geração | comportamento claramente rotulado, teclado e ROM | modo `authored_visual_demo`; CNS/controllers/grafo original preservados como referência | implementado, sem alegar CNS original convertido |
| Fidelidade core/canvas não demonstrada para Ken | diferenças podem surgir depois do atlas | `verify-mugen-real.py`, harness | pixels/máscara, negativos, sequência animada e reinício | 21 prévias/27 recursos compilados/204 frames core/212 UI; core=canvas integral; 5 negativos recusados | comprovado no piloto |
| Custos do piloto desconhecidos | decomposição e streaming podem preservar arte | plano/SGDK | estruturas ligadas na ROM e scanlines | 96 tiles, até 8 peças, pico 4 peças/104 px por linha; upload máximo 3.072 bytes | medido no artefato; CPU/DMA temporal indisponíveis |

## Forge → RetroDev

Consulta somente leitura; nenhum bootstrap, preparo, atualização ou build do
workspace doador foi executado. Licença raiz Forge: MIT, copyright 2026
SGDK-Forge contributors. Sem transplante de código nesta inspeção; assets de
terceiros têm redistribuição não verificada.

| Capacidade Forge | Implementação/prova consultada | Necessidade RetroDev | Decisão |
|---|---|---|---|
| resolução sem ambiguidade | `source.py`: candidatos e estratégias explícitos | DEF/referências com diagnósticos | adaptar contrato em Rust, preservar sandbox |
| triagem de fonte | `source_audit.py`, `inventory.py`: diagnóstico estático distinto de runtime | analisar antes de criar projeto | integrar ao importador canônico |
| SFF/ACT | `parsers/sff.py`: índices, paletas, ACT invertido | comparar decoder e paleta escolhida | conferir contra Pillow e fonte; sem copiar parser |
| AIR | `parsers/air.py`, crate RetroDev existente | ordem, duração, offset/flip | reaproveitar parser canônico com regressões |
| sprites | `converters/sprites.py`: recorte/decomposição e estimativas | reduzir custo sem perder geometria | implementar somente técnica justificada pelo piloto |
| contrato de paleta | `palette_contract.py`: conflitos e remapeamentos explícitos | impedir troca silenciosa de cores | escolha ACT/embutida visível, aplicada às ações escolhidas, com hashes; 15 cores opacas sem fusão no piloto |
| proveniência | `provenance.py`: fonte/derivado/hash/permissão | persistir revisão e rastreabilidade | reutilizar relatório de importação existente |
| telemetria e captura | curadoria 2026-09-28 e catálogo 2026-09-23 | distinguir frame/fase, estimativa/observação | aplicar nas provas; fila DMA ≠ orçamento temporal |

Arte/animação importadas e lógica original convertida terão vereditos
separados. Uma demonstração com comportamento autoral não certificará o CNS.
Emulação não certifica hardware físico; FPS do host não mede ticks da ROM.
Sem suporte geral a MUGEN, sem promoção de maturidade.

## Fronteiras e diagnóstico

1. **Pacote → SFF:** os 201 PCXs foram decodificados por Pillow e confrontados
   com índices/paletas do decoder Rust, sem divergência. Fonte/derivados permanecem
   fora do Git. Grupo/imagem, tamanho, eixo e offset SFF são preservados.
2. **SFF + ACT → AIR:** a lacuna anterior era associação da ACT, que o adaptador
   ignorava. A escolha agora é explícita; índice 0 é máscara. Todos os elementos
   selecionados do piloto têm flags sem flip. O negativo de flip usa os mesmos
   pixels reais espelhados e é recusado; isso não certifica facing.
3. **AIR → célula/modelo:** âncora (51,98), célula 104×104, ordem e offsets
   preservados. Durações 6/5/2 ticks. Nenhuma redução de resolução ou descarte
   de elemento escolhido. Paleta com 15 cores opacas; 58.697 pixels arredondados
   para RGB333, zero pixels fundidos (contagem estática de células, não telemetria).
4. **Modelo → SGDK/ROM:** BMP indexado reserva máscara distinta de preto opaco;
   tiles, CRAM, peças e timers ligados pelo rescomp são decodificados independentemente.
   São 27 frames compilados incluindo alias `idle`; frames repetidos são reutilizados
   pelo rescomp. Todos são exatos contra a referência RGB333, incluindo alfa.
5. **ROM → core:** RGB565 normal do Genesis Plus GX é reconstruído independentemente
   a partir dos níveis CRAM. A prévia RGB normalizada e a saída do core têm curvas
   distintas, declaradas. A apresentação mostra o estado do loop anterior (um frame);
   movimento Q8.8, sequência e duração são conferidos nos pixels, com RAM como confirmação.
6. **Core → canvas:** comparação integral dos bytes RGBA em repouso, com hash da ROM
   executada. O oráculo de personagem exclui apenas as primeiras 24 linhas do título
   gerado; a comparação integral core/canvas inclui o título.

Referência primária da saída RGB565:
[Genesis Plus GX, vdp_render.c, commit imutável 46a5521](https://github.com/ekeeke/Genesis-Plus-GX/blob/46a55214d0dab654e5a525ae0c54921ca9716872/core/vdp_render.c).
A referência do layout compilado é `inc/sprite_eng.h` do SGDK oficial 2.11
provisionado pelo lock do host; nada foi copiado para o runtime do produto.

## Custos e alternativas

Seleção das quatro ações evita a fusão de cores observada na análise de todas as
102 ações (23 cores VDP e 3.993 pixels fundidos na paleta embutida). Essa seleção
é decisão visível do piloto, não uma remoção automática de frames para fechar orçamento.
Recorte transparente preserva eixo na célula; rescomp decompõe em peças e reutiliza
frames idênticos. Streaming do quadro corrente já existe no SGDK; não foi criado
outro gerenciador de DMA, nem sistema de residência paralelo.

O hardware H40 permite 64 KiB de VRAM e tem limites de sprites/linha; custo
compilado deste personagem: até 8 sprites VDP por frame, 4 por linha, 104 pixels
por linha, 96 tiles/3.072 bytes de VRAM e até 3.072 bytes de tiles por mudança
de frame. Essas medidas vêm das estruturas e bytes ligados na ROM, não de uma
fila sem rejeições. Não há telemetria de ciclos CPU, duração de DMA, hardware
físico ou PAL. O orçamento conservador do analisador permanece um warning.
248 px por célula e os limites da revisão são restrições de ferramenta/perfil,
não um máximo universal. Residência total estática de atlas era uma restrição
do analisador atual, corrigida para a modalidade de consumo real do SGDK.

| Obstáculo | Classe | Decisão/prova |
|---|---|---|
| 16 entradas CRAM, máscara no índice 0 | físico do VDP | 15 cores opacas; zero fusões na seleção; RGB333 declarado |
| tamanho/alinhamento da célula e limite de prévias | ferramenta/perfil | célula 104×104 sem redução, limites explícitos; não universalizar |
| peças e tiles por frame | SGDK/rescomp | até 8 peças e 96 tiles medidos no recurso ligado |
| atlas contado integralmente como residente | analisador RetroDev | usar modalidade SGDK gerenciada, confirmada pela ROM; conservar política conservadora |
| transferências e orçamento de frame | hipótese temporal não medida | medir bytes compilados; não alegar CPU/DMA atendidos |
| input nativo observado em lotes de dez frames | runtime/apresentação atual | medir ticks dos pixels; não assumir duração da solicitação WebDriver |
| CNS original e common states ausentes | conversor/dependência da fonte | conservar inventário/referência; demonstração autoral explícita |

## Aceite real e inspeção visual

O cenário desktop `mugen-real` selecionou a pasta extraída BYOR no wizard,
analisou o DEF e a ACT, inspecionou todos os 21 pares de imagens e acionou a
prévia animada. Importou as quatro ações; digitou 1,5 no campo de velocidade
do estado 20; salvou; encerrou; reabriu projeto/relatório; executou Build & Run
oficial e teclas nativas →, ← e Z (A do Mega Drive). A substituição de diálogo
é somente a escolha nativa da pasta; importação/build/core não são mocks.

O oráculo independente passou em 21 prévias e 27 frames compilados em cada
projeto, 204 quadros core e 212 quadros UI. Compara índices/máscara, poses,
âncora, ordem AIR e duração. Na UI: idle 52 quadros; caminhada 38 com velocidade
384/256 e deslocamento visível 56 px; parada 18; volta 31 com −448/256 e −52 px;
segunda parada 18; dois ataques completos de 6 ticks; idle final 32. Os
intervalos estáveis removem somente a transição de ação na fronteira de input;
cada quadro da captura continua sujeito à identificação exata de pixels.
O backend aplica um toque de um tick e demonstra um ciclo de ataque.

A tentativa de toque curto na UI foi observada como 10 ticks entre os acks,
porque a apresentação avança em lotes. O comando autoral é de nível, portanto
reinicia ao voltar ao idle enquanto A permanece pressionado. O verificador
exige **dois ciclos completos**, conserva o idle entre eles e verifica idle
depois da soltura. Não declara um único ataque nem resposta temporal imediata.

Foram inspecionados visualmente a fonte Pillow, a galeria com a mesma pose
nas quatro fronteiras, a revisão real no app e a sequência de capturas do GIF
(212 quadros lógicos, 100 frames GIF após coalescer repetições, 3.530 ms por
centissegundos). Ken continua reconhecível, gi vermelho, poses/recortes variados,
deslocamento horizontal e soco; sem pixels substitutos. O GIF representa tempo
lógico, não uma gravação do FPS do host.

Galeria e sequência locais: `~/.retrodev/mugen-real-2026-09-30/oracle/gallery.png`,
`ken-sequence.gif` e `sequence-contact.png`. As duas primeiras são geradas pelo
verificador versionado; o contato é auxílio de inspeção local. Os PNGs da UI
e os dados completos de comparação permanecem fora do Git.

## Segurança e regressões

`mugen-import`, `mugen-control` e `mugen-locomotion` passaram no mesmo binário
final do produto; 14 processos próprios acompanhados por execução, nenhum
remanescente. Relatórios e hashes completos estão em `REAL_EVIDENCE.json`.

O audit encontrou a base com `brace-expansion` 5.0.9 vulnerável. Atualização
cirúrgica do override/lock para 5.0.12, única versão alterada, sem pacote novo:
[GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
[GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p).
`security:audit` passa no limiar high; quatro moderadas transitivas de
Vitest/mocker/browser/ui ficam registradas como dívida de ferramenta de teste
(GHSA-82fw-gwwq-j7x9), sem ignorar avisos ou reduzir o gate. RustSec passa com
oito avisos informacionais herdados: gtk/glib (RUSTSEC-2024-0429), gtk3-macros/
proc-macro-error (2024-0370), opener/zbus/event-listener (2026-0221) e
tauri-utils/urlpattern/unic (2025-0081, 0075, 0080, 0100, 0098).
Esses avisos permanecem risco transitivo conhecido; dependências Rust intactas.
Inventário de licenças reexecutado: npm 334, Cargo 499, toolchains 15.

Gates finais: `check:tree`, `lint`, `tsc --noEmit`, `cargo fmt --check`,
`cargo clippy -- -D warnings`, `npm test` (828 passed/6 skipped/834),
`cargo test --lib -- --nocapture` (818 passed/72 ignored/890), quatro pacotes
de `crates:gates`, syntax do harness e oráculo independente, todos aprovados.
`host:certify` terminou READY, inclusive frontend 831/3 com ambiente oficial,
Rust 818/72 e upstream Linux SGDK/PVSnesLib/core `success: true`. O warning
preexistente de atributo `#[test]` duplicado em `ast_generator.rs:3429` foi
registrado, sem alteração fora desta frente.

Commits: produto `90481e7d50b047ff0711d09290abbfe2b6269041`, prova
`44a850c8e11b14d178683129dbb3ff9a454b2a99`, patch de segurança
`23df72290ccdf29acbe5322756c35979d9af23f0`. O commit documental fecha a
frente antes da publicação. Base do PR: `codex/rex-mugen-locomotion` (#87).
Consultar CI pelo SHA final publicado; o resultado remoto não é presumido
por estes gates locais. PR/CI por SHA serão fornecidos no encerramento da tarefa.

## Reprodução (host oficial READY, fonte BYOR externa)

Usar Node 24.18/npm 11.16 provisionados e Rust/SGDK/core fixados pelo lock.
Os caminhos abaixo são configuráveis; a pasta fonte deve conter `ken8.def`.
Executar tarefas pesadas sequencialmente, de dentro desta worktree:

```sh
rtk proxy npm ci
rtk proxy npm run host:diagnose
rtk proxy env RDS_MUGEN_REAL_SOURCE=/caminho/ken8 RDS_MUGEN_REAL_OUTPUT=/caminho/evidencia/backend cargo test --manifest-path src-tauri/Cargo.toml --lib mugen_real_pilot_build_and_capture -- --ignored --nocapture --test-threads=1
rtk proxy npm run build:debug
rtk proxy env RDS_MUGEN_REAL_SOURCE=/caminho/ken8 RDS_MUGEN_REAL_UI_OUTPUT=/caminho/evidencia/ui RDS_E2E_KEEP_PROJECT=1 node scripts/e2e-tauri-build-run.mjs --scenario mugen-real --skip-build --app src-tauri/target-test/debug/retro-dev-studio
rtk proxy python3 scripts/verify-mugen-real.py --source /caminho/ken8 --backend /caminho/evidencia/backend --ui /caminho/evidencia/ui --output /caminho/evidencia/oracle
rtk proxy node scripts/e2e-tauri-build-run.mjs --scenario mugen-import --skip-build --app src-tauri/target-test/debug/retro-dev-studio
rtk proxy node scripts/e2e-tauri-build-run.mjs --scenario mugen-control --skip-build --app src-tauri/target-test/debug/retro-dev-studio
rtk proxy node scripts/e2e-tauri-build-run.mjs --scenario mugen-locomotion --skip-build --app src-tauri/target-test/debug/retro-dev-studio
rtk proxy npm run host:certify
```

Python/Pillow serve somente à QA externa independente, instalado no host;
não é dependência/runtime do app. O corpus não é provisionável. Reexecutar em
diretórios de evidência novos preserva as capturas anteriores; o projeto UI é
mantido pelo flag explicitamente para revisão. Nenhum recurso Ken ou ROM foi
versionado. O SHA da ROM depende também do nome/projeto gerado; conferir o hash
da execução correspondente, não exigir igualdade entre projetos distintos.
