# REX — piloto visual Sonic 1 (Experimental)

Estado em 2026-09-21: implementação publicada na branch isolada `codex/rex-sonic1-pilot`, sem merge. A prova desktop final desta rodada foi executada no commit de código `c0ad292095c259498e8e67e9168e3d1d3f82d258`, com o binário canônico `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `b069a5fb8928023699816e164876bb39faf58615cbc62fcac3c04bc51f42d77d`; o frontend carregado foi `index-tGPqe_u5.js` (SHA-256 `74d3c8b61a5ff3e25accb547b60f3526d6d96d5a621f69985ba37d612cfc7952`) e declarou `c0ad292`. O estado Git aparece dirty somente pelos holdouts preservados de outras sessões, que não foram incluídos. As capturas históricas permanecem preservadas abaixo.

Nota de rastreabilidade: o parágrafo acima é evidência histórica de `c0ad292`, não resultado da continuação atual. A continuação em 2026-09-21 está registrada ao final deste documento; o salto por teclado foi fechado na superfície canônica por observação da WRAM do core correlacionada com a identidade visual inicial do personagem.

### Continuação 2026-09-22 — perfil ROM→Node delimitado (Experimental; implementado; equivalência e causalidade pendentes)

A continuação implementou um perfil delimitado de Mega Drive para `ADDQ.W #1,D0; RTS`, com mapping por hash/offset, flags, estados independentes, patch para cópia distinta e nó `rom_addq_word`. A fixture durável `src-tauri/tests/fixtures/logic_recovery_sgdk/` (com o resumo versionado `e2e-proof-report.json`) e o E2E `src-tauri/target-test/validation/logic-recovery-2026-09-22T14-06-47-769Z-report.json` passaram os caminhos node→C→ROM e rotina vinculada→patch→ROM, usando entrada neutra e estado comum `0x12340058` após 120 frames de warmup. A observação do ROM realmente gerado pelo grafo registra `romOrigin=generated_from_reopened_nodegraph`, `0x12340058→0x12340059`; a rotina original faz o mesmo, enquanto patch #2 faz `0x12340058→0x1234005A`. Original/original e no-op permanecem controles aprovados. O relatório vincula a execução ao binário `src-tauri/target-test/debug/retro-dev-studio` (`47afc726…cb8c78`). Classificação documental: implementado; equivalência e causalidade pendentes fora desse perfil delimitado. Ele não é uma recuperação do Sonic 1: a ROM Sonic e a ROM autoral do E2E não foram declaradas como contendo essa rotina exata.

Matriz desta rodada: **comprovado** — node→C→ROM, Build do grafo reaberto→ROM observada, original #1, patch #2, estado/input/frame comum, oracle independente de WRAM D0/flags, original/original, no-op e reabertura com operação/conexão/source mapping; **pendente** — equivalência geral, callers indiretos/PC-relative, trace dinâmico, contexto de chamada, hardware e qualquer operação além de `ADDQ.W; RTS`. A superfície permanece **Experimental**, sem merge.

### Continuação 2026-09-22 — rotina branch compare delimitada (Experimental; commit `312cee2`)

Esta fatia separada preserva a prova ADDQ como regressão e acrescenta somente o perfil exato `m68k.add_compare_branch_word_d0_wram.v1`. A fixture própria está em `src-tauri/tests/fixtures/logic_recovery_branch_sgdk/`: `ADDI.W #1,D0; CMPI.W #5,D0; BGE.S; MOVE.W #0/#1,$E0FFFF00.L; RTS`, 30 bytes contíguos, sem instruções sem uso. O caminho de nós implementa o mesmo contrato limitado em C; o perfil continua restrito a Mega Drive/M68K, esse formato, `branch_input/branch_result`, bias `0..8` e threshold assinado `0..32767`; não declara suporte geral.

O relatório E2E local desta execução é `src-tauri/target-test/validation/logic-recovery-branch-2026-09-22T16-15-43-099Z-report.json`, vinculado ao código `312cee2` e ao binário realmente exercitado `/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `85fff5739c3c888b00ba519d068c451ef9bfe6426baeb97b3d3832122c25bc2e`. A rotina oficial SGDK fixture tem SHA `467074aa2bbdb5abe84841952435ae7a56b422d44732614117d2f06f7e0e1130`, offset `29486` (`0x732E`), e o fixture Node tem SHA `04510aa8cd2467939eb132a69e57d9b7f7124c2528fde2c69c620acad1cb1c4c`.

Matriz da fatia, separando aceite de pendências:

| critério comprovado | evidência executada no código desta fatia |
| --- | --- |
| recuperação exata, source mapping e dois ramos | IPC `rom_recover_logic` contra os 30 bytes; 4 mappings; estados independentes `3→0` (falso), `4→1` (limiar), `5→1` (verdadeiro), `0xFFFF→0` (wrap assinado) e `0x1234→1`; `coverage=falseBranch/trueBranch/thresholdMinusOne/threshold/wordWrap=true` |
| save/reopen do grafo | UI aplicou `rom_recovered`; reabertura preservou nó `rom_branch_compare_word_00732E`, uma conexão, `rom_start=29486`, `rom_end=29516` e threshold `5` |
| ROM gerada pelo grafo, identificada sem inferência por hash | ROM gerada pelo Build do grafo reaberto: `/run/user/1000/codex-desktop/tmp/rds-desktop-e2e-project-ybzLHI/megadrive_dummy/build/megadrive/out/rom.bin`, SHA `a542d89c9d760c7cdb7c2e5fd43e136055d6267306d92d250eb79100abb18cc5`; o `main.c` gerado foi lido e contém `rds_branch_arithmetic`/`rds_branch_recovery_result` |
| observação que comprova a ROM gerada | no core Genesis Plus GX, com estado pausado, 120 frames de warmup e o mesmo vetor de entrada `[3,4,5,0,0xFFFF,0x1234]`, leitura independente da WRAM `region=2`, resultado `0xff00` e entrada `0xff02` observou `0,1,1,0,0,1` na ROM acima; a ROM original, o fixture Node e o no-op produziram a mesma sequência |
| controles original/original e no-op | duas execuções independentes da ROM original foram byte/estado-equivalentes; patch threshold `5` criou cópia byte a byte idêntica à original, SHA `467074aa…e1130` |
| edição pelo editor e cópia patchada | editor persistiu threshold `5→6`, save/reopen confirmou `6`; ROM gerada após edição SHA `e329cf88b9c4e127959278ca777eca6bfb11dcb46d10b08fe1d93a86ecae7550`; cópia patchada `/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/src-tauri/target-test/validation/logic-recovery-branch-fixture/routine/out/rom.bin.branch6.patched.bin`, SHA `e41c1d917e244feef4202d4aa81b2575e38732be2f9ab1f538b21b165f797482`; ambas observaram `0,0,1,0,0,1`, comprovando `4: 1→0` |
| regressão ADDQ | cenário `logic-recovery`, fixture e controles original/original/no-op/patch #2 permanecem no harness e não foram removidos ou ampliados |

Pendências explícitas: nenhum suporte geral a M68K, nenhum caller indireto/PC-relative, nenhuma equivalência fora desta fixture, nenhum trace dinâmico de jogo, nenhuma promessa SNES ou de outra largura/operação. O perfil ADDQ permanece **Experimental** e restrito a `ADDQ.W; RTS`; o branch compare é uma segunda fixture Experimental igualmente delimitada, sem promoção de suporte geral e sem merge. A única alteração posterior ao binário acima é documentação/matriz, não uma nova execução atribuída ao binário.

## Corpus e referência

ROM BYOR preservada localmente:

- caminho: `/home/misael/emulation/roms/genesis/Sonic the Hedgehog (USA, Europe).bin`
- tamanho: `531.577` bytes
- SHA-256: `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`
- cabeçalho: Mega Drive/Genesis, `SONIC THE`, `(C)SEGA 1991.APR`, produto `GM 00001009-00`, região `J`
- revisão comercial ainda não confirmada por um identificador suficiente; o perfil local é fixado pelo SHA, não pelo nome do arquivo.

Referência pública: [sonicretro/s1disasm](https://github.com/sonicretro/s1disasm), commit `064e3c68eb19cc85b8801b087f9d95f9b3e82cea`, build `Revision=0` (Rev00). O build reproduzido tem 524.288 bytes, SHA-256 `46160baa06362c711c9f1a5017cb7371026444936c8af5e93a78996cf32ff2a6` e MD5 `1bc674be034e43c96b86487ac69d9293`; não é byte a byte igual à ROM local: há 675 diferenças no prefixo de 512 KiB e bytes extras após `0x80000`.

## Modalidades e proveniência

**Assistida:** `Pal_Sonic`, `Map_Sonic`, `MS_Stand`, o formato `SonicMappingsVer=1` e as fronteiras `Art_Sonic` foram obtidos do disassembly doador e codificados em manifesto explícito. A UI identifica isso como “perfil assistido”; não é descoberta automática.

**ROM-only após a seleção do perfil:** o produto lê, valida e compõe somente os bytes da ROM indicada. Para `sonic1_sonic/stand` os intervalos comprovados são:

| recurso | intervalo | SHA-256 dos bytes |
| --- | --- | --- |
| art bruto | `0x21AFE + 0xA120` | `934e48178cfddd8af1627493114a25d09671bbb4a5626f4d95a93001c8b78589` |
| paleta | `0x2388 + 0x20` | `8391d8af82c19043c89e32abf87bdd057dbe2a845c58a3a58761edceaeeb9f8a` |
| mapping | `0x21293 + 21` | `18749e9ba7ab2eae27ebafd451a6f8a05e42b426b841d03d6ef28b08ed0abae1` |

Mapping literal: quatro peças, nibble alto primeiro, tiles row-major, origem do canvas `(16,20)`, transparência no índice `0`, paleta RGB333 e frame nativo `32×40`.

Oráculo independente Node/RGBA para a ROM base: `ce95ea66f2cfcec40a0fb12cb35fe5e88530de036de9f897333ce762f06b40d4`. O oráculo E2E é separado do decoder Rust e inclui negativos para ordem de tiles, paleta e flip.

## Fluxo implementado pela interface

`Identificar base` → `Executar descoberta` → selecionar `sonic1_sonic / stand` → `Compor frame` → editar uma palavra de paleta MD RGB333 numa cópia → salvar sessão → exportar BPS → aplicar BPS à base em outro arquivo → carregar/executar pelo serviço de emulação → reiniciar → listar e reabrir a mesma sessão → recompor e comparar pixels novamente.

A aplicação não sobrescreve a ROM BYOR. O BPS valida tamanho e CRC da base; aplicação sobre uma base do mesmo tamanho, mas de conteúdo diferente, é rejeitada. A edição piloto aceita apenas índice de paleta `1..15` e canais `0..7`; relocação, crescimento, compressão, animação e edição geral permanecem fora do escopo.

## Gates e ambiente

- `host:diagnose`: READY; fingerprint `77bbc2a76ab04417b2c5e4f0ddcd82e10dcc4ef220883510652c9f67e632425c`, lock `dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377`.
- `host:certify` no commit `c0ad292`: READY no fingerprint/lock `77bbc2a…`/`dd99a22…`; check-tree, lint, TypeScript, Rust fmt, clippy, suíte frontend (`625 passed, 3 skipped`) e suíte Rust (`619 passed, 40 ignored`) passaram; validação upstream Linux terminou `success=true`. A execução focada adicional registrou `622 passed, 6 skipped` e `619 passed, 0 failed, 40 ignored`.
- O build canônico desta rodada gerou `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `b069a5fb8928023699816e164876bb39faf58615cbc62fcac3c04bc51f42d77d`. O core efetivamente carregado foi `Genesis Plus GX v1.7.4 46a5521`, arquivo `genesis_plus_gx_libretro.so`, SHA-256 `07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1`.
- Um primeiro teste falhou antes de executar por `ENOSPC`; a chamada exata foi Vitest escrevendo no cache. O teste Rust confirmou a causa: `src-tauri/src/lib.rs:7157` recebeu `StorageFull` ao escrever ROM sintética em `TMPDIR=/run/user/1000/codex-desktop/tmp`, tmpfs de 1,5 GiB usado em 100%. `df` do workspace mostrava blocos e inodes disponíveis. As repetições usam `TMPDIR=/tmp`, sem remover arquivos de outras sessões.
- O resultado histórico de 60 frames permaneceu preservado como lacuna: framebuffer preto não prova gameplay. O E2E atual usa `emulator_run_frames` em lotes, executa 1200 frames, envia START no frame 900 e exige identidade da ROM/core, contagem de frames, dimensões, hash e pixels RGBA relidos do canvas.
- O E2E final passou em `inspection-sonic` e produziu patch e ROM aplicada em `src-tauri/target-test/validation/sonic1-pilot-2026-09-21T03-56-34-468Z/`: patch `sonic1-stand-palette.bps`, 32 bytes, SHA-256 `35c91e8d31a64d72a09f664deb67ec9ebe42015f0dd4aeb20cb95f9283ab817c`; ROM aplicada SHA-256 `d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d`. Base e aplicada carregaram no mesmo core, sob 1200 frames e START no frame 900, com framebuffer `320×224`; base SHA RGBA `680faf48878e4639d956c78f9807de72ba070e2e32508c94dfa674b42c9d0cd8`, aplicada SHA RGBA `02b1fb61836893f905a4d0be0bd30ee2f6be388e5b4706d8f511e1c940717a3f`.
- Critérios separados: **PASS** para “ROM aplicada carregou e produziu frames/framebuffer” (`71680` pixels não pretos); **PASS** para “alteração de paleta apareceu no jogo” nesta condição reproduzível: base teve `70488` pixels não pretos, ROI `12739`, nenhuma cor magenta-like; aplicada teve `71680`, ROI `12928`, `1192` pixels magenta-like, `189` na ROI. O E2E exige divergência do framebuffer, mesmas condições e canvas visível/desobstruído.
- A base BYOR foi relida depois de salvar, aplicar, executar, reiniciar e reabrir: `531577` bytes e SHA `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb` tanto no início quanto no fim.

## Matriz de aceite desta branch

| cenário | commit/binário | ROM ou fixture | resultado | evidência |
| --- | --- | --- | --- | --- |
| golden e composição Rust | `243c3a6` / `70314b…` | fixture literal + corpus Sonic | PASS focado; 9 testes | `cargo test ... sprite_composition` |
| base incompatível no BPS | `243c3a6` / `70314b…` | ROMs sintéticas do teste | PASS; rejeitou CRC divergente | `cargo test ... patch_studio`, 5 testes |
| identificação e análise pela UI | `c0ad292` / `b069a5…` | ROM Sonic, SHA `c7da53…` | PASS; sessão `inspection-1789962978-00000000`, run concluído | log final `[inspection-identify]`/`[inspection-complete]` |
| composição/pixels base | `c0ad292` / `b069a5…` | `sonic1_sonic/stand`, mapping `18749e…` | PASS; RGBA `ce95ea…`, negativos de ordem/paleta/flip | `inspection-2026-09-21T03-56-06-406Z-sonic-stand-base.png` |
| edição pela UI e pixels modificados | `c0ad292` / `b069a5…` | paleta[1] RGB333 `(7,0,7)`, ROM modificada `d381b1…` | PASS; RGBA `91ee4a…` | `inspection-2026-09-21T03-56-06-406Z-sonic-stand-edited.png` |
| base BYOR relida após o fluxo | `c0ad292` / `b069a5…` | original `c7da53…`, 531.577 bytes | PASS; tamanho/SHA inicial e final idênticos | log `[inspection-base-integrity]` |
| exportar/aplicar patch | `c0ad292` / `b069a5…` | BPS `35c91e…`; cópia aplicada `d381b1…` | PASS; base original não sobrescrita e aplicação byte a byte idêntica à edição | diretório do patch `03-56-34-468Z` |
| ROM aplicada carregou e produziu frames/framebuffer | `c0ad292` / `b069a5…` | ROM aplicada `d381b1…`, core `07c104…`, START frame 900 | PASS; 1200 frames, `320×224`, `71680` pixels não pretos, canvas desobstruído | `[inspection-emulator-observation]`, `...sonic-emulator-applied.png` |
| efeito visual da paleta no jogo | `c0ad292` / `b069a5…` | base/aplicada, 1200 frames, mesmo core e input | PASS; base ROI `12739` sem magenta-like; aplicada ROI `12928`/`189` magenta-like; framebuffer divergiu | `[inspection-palette-effect]`, `...sonic-emulator-base.png`, `...-applied.png` |
| salvar/reiniciar/reabrir e recompor | `c0ad292` / `b069a5…` | mesma sessão e ROM modificada | PASS; seleção/proveniência restauradas; RGBA reaberto `91ee4a…`; BYOR original intacto | `inspection-2026-09-21T03-56-06-406Z-sonic-stand-reopened.png` |

O primeiro marco desta fatia está concluído: a prova desktop foi executada no binário identificado e deixou capturas, hashes, sessão, BPS, ROM aplicada e limitações rastreáveis. Esta fatia não declara extração automática, equivalência com o jogo original, reconstrução integral, animação ou uma fatia de lógica/nós. O avanço para lógica/nós permanece fora desta entrega porque ainda não há, para Sonic 1, uma rotina delimitada com semântica, source mapping, larguras/flags e execução pelo pipeline canônico demonstrados de forma independente; não se deve promovê-lo a partir da prova visual.

## Continuação 2026-09-21 — superfície canônica de jogo

Código em trabalho no PR #74, branch isolada `codex/rex-sonic1-pilot`, sem merge. A execução desktop mais recente foi feita sobre `4b96ec3` com árvore dirty pelas correções atuais de harness/UI; o binário executado foi `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `126e8b7e341a8b8605011360750ce661d80381a3f0ab8f2adeb149fce317ac10`. A ação `Jogar versão modificada` e a nova ação `Jogar ROM base` usam o mesmo `loadRomIntoEmulator` da Game View canônica; não há emulador paralelo nem caminho exclusivo para o harness.

Execução desktop: `inspection-sonic`, prefixo `inspection-2026-09-21T14-23-44-938Z`, artefatos de patch em `src-tauri/target-test/validation/sonic1-pilot-2026-09-21T14-24-15-921Z/`. ROM base BYOR `/home/misael/emulation/roms/genesis/Sonic the Hedgehog (USA, Europe).bin`, `531.577` bytes, SHA-256 `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`; ROM aplicada SHA-256 `d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d`; BPS SHA-256 `35c91e8d31a64d72a09f664deb67ec9ebe42015f0dd4aeb20cb95f9283ab817c`; core `Genesis Plus GX v1.7.4 46a5521`, arquivo SHA-256 `07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1`.

Oráculo de personagem: a identidade visual inicial usa o template independente do frame `sonic1_sonic/stand` produzido de mapping/tile/paleta da ROM, não um conjunto de pixels magenta em uma região fixa. A trajetória depois usa leitura da WRAM do core, região `2`, objeto candidato `0xD000`, decodificado em little-endian; essa leitura foi validada durante a própria execução por correlação com a posição visual inicial (`center.x≈78,5`, WRAM `x=80`, `y=944`) e por deltas causados por input nativo. O rastreador visual por componente de paleta permanece diagnóstico para capturas, não é a prova única de movimento ou salto.

Matriz atual da continuação:

| cenário | commit/binário | ROM ou fixture | resultado | evidência |
| --- | --- | --- | --- | --- |
| composição, edição, BPS e reabertura | herdado de `c0ad292` e reexercitado na execução `14-23-44` / binário `126e8b7…` | base `c7da53…`; aplicada `d381b1…`; BPS `35c91e…` | PASS; pixels independentes base `ce95ea…`, edição/reabertura `91ee4a…`; BYOR relida no fim sem alteração | `...sonic-stand-base.png`, `...sonic-stand-edited.png`, `...sonic-stand-reopened.png`; log `[inspection-base-integrity]` |
| ROM base na Game View canônica | `4b96ec3` dirty / `126e8b7…` | base `c7da53…`, core `07c104…` | PASS; identidade da ROM e core, frames reais, START via handler do produto, gameplay após transição | `inspection-2026-09-21T14-23-44-938Z-sonic-game-base.png`; `...sonic-base-trajectory.json` SHA `bf766dbb20777aaaed8739f49bc137cb4d5269466f7111aa65518f2b6bc20b65` |
| ROM modificada após salvar/reiniciar/reabrir | `4b96ec3` dirty / `126e8b7…` | aplicada `d381b1…`, core `07c104…` | PASS; hash/tamanho da ROM carregada confirmados após reabertura; imagem anterior rejeitada por hash | `inspection-2026-09-21T14-23-44-938Z-sonic-game-modified-before-controls.png` SHA `44a9fb25b49860f61bf273ce9550f53eab42c19cbe194361666344e2cfff0d45` |
| movimento real por teclado | `4b96ec3` dirty / `126e8b7…` | base e aplicada sob mesmo core | PASS; `ArrowRight` confirmado por ACK; WRAM `x` mudou de `80` para `451` na aplicada (`deltaX=371`) e de `80` para `443` na base | `...sonic-trajectory.json` SHA `eb3195bd3746cd270355a5ec4356c21fb1615760dcd98daff0452465a4411b8d`; `...sonic-base-trajectory.json` |
| salto real por teclado | `4b96ec3` dirty / `126e8b7…` | aplicada `d381b1…` | PASS; `KeyZ/A` confirmado por ACK; WRAM `y` saiu de `940` para `904` com `yVel=-1272` e depois `844`, demonstrando subida/queda no referencial do jogo | `...sonic-trajectory.json`, frames `jump-before`, `jump-held`, `jump-released` |
| pausa/retomada | `4b96ec3` dirty / `126e8b7…` | aplicada `d381b1…` | PASS; UI mostrou “Emulador pausado”; após retomar, frames avançaram de `2250` para `2260` | campo `pause` em `...sonic-trajectory.json` |
| negativos canônicos | `4b96ec3` dirty / `126e8b7…` | aplicada `d381b1…` | PASS integrado ao cenário: ROM errada rejeitada pela exigência de hash modificado, imagem antiga rejeitada por framebuffer SHA, tecla `Q` não mapeada não avançou ACK | log `[inspection-canonical-negatives]`; cenários dedicados ainda podem ser separados se o revisor exigir isolamento por caso |

Capturas legíveis principais:

- base canônica: `src-tauri/target-test/validation/inspection-2026-09-21T14-23-44-938Z-sonic-game-base.png`, SHA-256 `a0d57b7194f23106aa30efe5489ec57730d78d6be85625884a50de6e42320aa8`.
- modificada antes dos controles: `src-tauri/target-test/validation/inspection-2026-09-21T14-23-44-938Z-sonic-game-modified-before-controls.png`, SHA-256 `44a9fb25b49860f61bf273ce9550f53eab42c19cbe194361666344e2cfff0d45`.
- modificada após salto/pausa/reabertura: `src-tauri/target-test/validation/inspection-2026-09-21T14-23-44-938Z-sonic-game-modified-after-restart.png`, SHA-256 `8ae8fb27536fa9037a51b0b097c0383e95d273fd5cf01cb742ba8f52ed26dab9`.

Limitações: a prova continua **Experimental** e assistida por metadados para o recurso `sonic1_sonic/stand`. A alteração é de paleta compartilhada; a captura de gameplay demonstra o efeito no personagem sob condições equivalentes, mas não promete isolamento de paleta no jogo inteiro, extração automática geral, reconstrução integral, animação ou lógica/nós recuperados. Antes de declarar a rodada final do PR #74, ainda é necessário publicar os commits, reconstruir/validar o destino final limpo e acompanhar o CI desse SHA.

## Continuação 2026-09-21 — jogo de referência builtin para a próxima frente

Além do piloto Sonic, esta sessão materializou o próximo marco de autoria em `reference_platformer`, template builtin Experimental do registry. Ele cria um pequeno jogo Mega Drive autocontido com player animado (`idle`/`run`/`jump`), movimento, salto, colisão, tilemap, câmera, dois SFX, BGM VGM e objetivo por NodeGraph visível. O template não usa ROM comercial, BYOR ou doador externo.

Prova local: card e criação pelo wizard cobertos em `src/App.test.tsx`; seed e componentes canônicos cobertos em `project_mgr`; build real com SGDK oficial, ROM `SEGA`, carga no núcleo Libretro oficial, 45 frames com `Right` e framebuffer alterado cobertos pelo teste manual ignorado `reference_platformer_real_toolchain_build`. A colisão Assembly encontrada entre sprite e SFX `goal` foi corrigida com o nome de recurso `goal_sound`.

Esta prova não promove o piloto Sonic a reconstrução, não fecha save/restart/reopen desktop para o novo template e não converte importação/Phase D em equivalência ou AST completo. O template permanece Experimental até a prova visual de autoria e persistência ser reexecutada no desktop final.

### Continuação 2026-09-22 — evidência local consolidada

O template de autoria foi reexecutado no desktop canônico e o relatório `src-tauri/target-test/validation/reference-platformer-2026-09-22T01-29-49-822Z-report.json` registra wizard, quatro entidades, NodeGraph, save, ROM `SEGA`, movimento/salto, pausa/retomada, reabertura e rebuild. A prova de áudio real do mesmo template passou no teste SGDK/Libretro ignorado, com amostras não vazias e não silenciosas.

As provas de inspeção foram reexecutadas contra as referências locais: HAMOOPIG (`558bea6c…f8529be9`) fechou candidato `42128/192`, frames Ryo `0..4`, oráculo de pixels e save/restart/reopen; Taiketsu (`3967996a…42bc7c`) fechou `spr_spark0/frame-0`, `24×24`, e pixels iguais antes/depois da reabertura. Na tentativa nova de `inspection-sonic`, composição/edição/BPS e comparação de framebuffer base/aplicada passaram, mas a trajetória da ROM base expirou aguardando `renderedFrames >= 890`; o resultado não é contado como novo aceite de gameplay. A rotina ROM→nós continua fora do aceite por falta de fronteiras, semântica, source mapping e equivalência independente comprovados.

### Continuação 2026-09-22 — autoria persistente de tilemap

O fluxo canônico `Build → ROM → Emulação` ganhou uma prova de autoria persistente no template `reference_platformer`. O relatório `src-tauri/target-test/validation/reference-platformer-2026-09-22T02-45-27-246Z-report.json` registra seleção nativa do tile 2, pintura da célula `{col: 1, row: 25}` (`index 1001`), transição `0 → 2`, undo/redo, colisões sólidas preservadas em `88`, save, reabertura com valor `2` e rebuild com a mesma região visual (`92e737c5 → 26a7da45`).

O artefato C gerado confirma o overlay esparso `VDP_setTileMapXY` sobre o mapa-base carregado por `VDP_drawImageEx`, preservando o cenário não editado. A paleta agora carrega PPM P3/P6 por IPC seguro de bytes do projeto, sem depender do protocolo de assets do navegador. A superfície permanece `Experimental`; essa prova fecha autoria/persistência do template de referência, não a reconstrução ROM→nós do piloto Sonic. A aceitação F continua explicitamente pendente de fronteiras, semântica, source mapping e equivalência independente.
