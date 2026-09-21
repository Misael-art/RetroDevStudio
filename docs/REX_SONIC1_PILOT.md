# REX — piloto visual Sonic 1 (Experimental)

Estado em 2026-09-21: implementação publicada na branch isolada `codex/rex-sonic1-pilot`, sem merge. A prova desktop final desta rodada foi executada no commit de código `c0ad292095c259498e8e67e9168e3d1d3f82d258`, com o binário canônico `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `b069a5fb8928023699816e164876bb39faf58615cbc62fcac3c04bc51f42d77d`; o frontend carregado foi `index-tGPqe_u5.js` (SHA-256 `74d3c8b61a5ff3e25accb547b60f3526d6d96d5a621f69985ba37d612cfc7952`) e declarou `c0ad292`. O estado Git aparece dirty somente pelos holdouts preservados de outras sessões, que não foram incluídos. As capturas históricas permanecem preservadas abaixo.

Nota de rastreabilidade: o parágrafo acima é evidência histórica de `c0ad292`, não resultado da continuação atual. A continuação em 2026-09-21 está registrada ao final deste documento; seu código ainda não foi promovido a aceite porque o salto por teclado permanece bloqueado por uma falha reproduzível de efeito no core.

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

Código em trabalho sobre `5284d458` (PR #74, sem merge), com binário canônico atual `src-tauri/target-test/debug/retro-dev-studio` SHA-256 `7b6ad560b899195b1b22b6a415c38bf6c2d594bbf4f806a7486858a9ac6158ff` e frontend `dist/assets/index-N1yRKj1H.js` SHA-256 `45523954b6c9cdd8cca8adf727e81ccde60b16973c9b77eb84ce9871150a04eb`. A ação `Jogar versão modificada` usa o mesmo `loadRomIntoEmulator` da superfície canônica; o painel expõe hash/tamanho/core, framebuffer, frames e ACK de input. Não foi criado emulador paralelo.

Execução desktop mais completa: `inspection-sonic`, sessão `inspection-1789983205-00000000`, diretório de artefatos `src-tauri/target-test/validation/sonic1-pilot-2026-09-21T09-33-38-764Z/`. ROM base `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb` / 531.577 bytes; ROM aplicada `d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d`; BPS `35c91e8d31a64d72a09f664deb67ec9ebe42015f0dd4aeb20cb95f9283ab817c`; core `07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1`. A captura `src-tauri/target-test/validation/inspection-2026-09-21T09-33-12-050Z-sonic-game-modified-before-controls.png` (SHA-256 `8a8b9b0de5bdeea7ea2f6cb2a7bbf27e01a1f304911922ce4484252b284bb03f`) mostra o framebuffer canônico em escala 3× com Sonic após a transição do cartão de fase.

Resultado atual:

- **PASS herdado e reexercitado:** identificação, composição/pixels independentes, edição, salvar/reabrir, BPS, identidade da ROM aplicada, base/aplicada sob o mesmo core e preservação da BYOR.
- **PASS novo:** `Jogar versão modificada` carregou `d381b1…`, produziu framebuffer real `320×224`, avançou até frames `>=1800`, e a máscara independente do personagem ficou visível; ArrowRight foi confirmado pelo ACK e alterou a máscara/centróide horizontal.
- **NEGATIVOS:** hash diferente da base é exigido antes de jogar; imagem anterior é rejeitada por hash; tecla não mapeada `Q` não pode avançar ACK. A execução que falhou no salto ainda não emitiu o marcador final desses negativos; eles permanecem no harness para a próxima execução verde.
- **BLOQUEIO:** A/B/C chegaram como estados ACK (`a`, `b`, `y`), mas nenhum produziu deslocamento vertical observável após a entrada em gameplay. A prova reprova; não há captura “aprovada” pós-salto. O estado final da última falha está em `src-tauri/target-test/validation/desktop-e2e-failure-inspection-sonic.json` (hash `911236bcf4da520ea203b4c01295e1bf17c5c5215b3ae3aa2926df7db753b21d`). A hipótese restante é integração de amostragem/mapeamento do input no core, não ausência de ROM.

Este bloqueio impede declarar o fluxo completo utilizável e impede aceite/merge. A classificação permanece **Experimental**; a alteração de paleta continua sujeita aos efeitos compartilhados da paleta do jogo, e a composição Sonic segue assistida por metadados. Não avançar para lógica/nós antes de fechar o salto real.
