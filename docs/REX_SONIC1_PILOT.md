# REX — piloto visual Sonic 1 (Experimental)

Estado em 2026-09-20: implementação publicada na branch isolada `codex/rex-sonic1-pilot`, sem merge. A prova desktop final desta rodada foi executada no commit `524db87bfae9d79e5bfa89bbabbc0ce18323fcb2`, com o binário canônico `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `98b1c2ddb2592d7217c7c2aaa04e0d3a0768b7ba52b0bd2db3b612d2a082719c`; o frontend carregado foi `index-DwlMEBZm.js` e declarou o mesmo commit. O estado Git aparece dirty somente pelos holdouts preservados de outras sessões, que não foram incluídos. As capturas históricas de `243c3a6` permanecem preservadas abaixo.

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
- `host:certify`: READY no mesmo fingerprint/lock; check-tree, lint, TypeScript, Rust fmt, clippy, suíte frontend (`622/6` na execução focada e `625/3` no certify) e suíte Rust (`659 testes`, com os casos condicionais oficiais ignorados) passaram.
- O build canônico desta rodada gerou `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `98b1c2ddb2592d7217c7c2aaa04e0d3a0768b7ba52b0bd2db3b612d2a082719c`. O core efetivamente carregado foi `Genesis Plus GX v1.7.4 46a5521`, arquivo `genesis_plus_gx_libretro.so`, 12.618.472 bytes, SHA-256 `07c104765dcfe1f588d637c0fda1ab3987f86b94835d43b6506b0236948310b1`.
- Um primeiro teste falhou antes de executar por `ENOSPC`; a chamada exata foi Vitest escrevendo no cache. O teste Rust confirmou a causa: `src-tauri/src/lib.rs:7157` recebeu `StorageFull` ao escrever ROM sintética em `TMPDIR=/run/user/1000/codex-desktop/tmp`, tmpfs de 1,5 GiB usado em 100%. `df` do workspace mostrava blocos e inodes disponíveis. As repetições usam `TMPDIR=/tmp`, sem remover arquivos de outras sessões.
- O E2E final produziu patch e ROM aplicada em `src-tauri/target-test/validation/sonic1-pilot-2026-09-20T23-09-55-228Z/`: patch `sonic1-stand-palette.bps`, 32 bytes, SHA-256 `35c91e8d31a64d72a09f664deb67ec9ebe42015f0dd4aeb20cb95f9283ab817c`; ROM aplicada SHA-256 `d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d`. A prova registra HTTP 200 do WebDriver, identidade da ROM no core, 60 frames, framebuffer/canvas RGBA `320×224` com SHA `811a21a28045551ab6fdb3a94f27d5aee5043f0ba626f166295fc2e5813444b0`, hit-test no canvas, seleção persistida, recomposição independente após reinício e releitura do BYOR original sem alteração.
- Critério separado de execução: **PASS** para “ROM aplicada carregou e produziu frames/framebuffer”; **PENDENTE** para “alteração de paleta apareceu no jogo”. Nas condições neutras equivalentes da prova, base e cópia produziram o mesmo framebuffer preto (`nonBlackPixels=0`); isso não demonstra Sonic visível nem efeito da paleta. As capturas `inspection-2026-09-20T22-41-04-476Z-sonic-emulator-base.png` e `...-applied.png` mostram o canvas real e o estado pendente, não são apresentadas como prova visual do jogo.

## Matriz de aceite desta branch

| cenário | commit/binário | ROM ou fixture | resultado | evidência |
| --- | --- | --- | --- | --- |
| golden e composição Rust | `243c3a6` / `70314b…` | fixture literal + corpus Sonic | PASS focado; 9 testes | `cargo test ... sprite_composition` |
| base incompatível no BPS | `243c3a6` / `70314b…` | ROMs sintéticas do teste | PASS; rejeitou CRC divergente | `cargo test ... patch_studio`, 5 testes |
| identificação e análise pela UI | `524db87` / `98b1c2…` | ROM Sonic, SHA `c7da53…` | PASS; sessão `inspection-1789945780-00000000`, run concluído | log E2E `23-09-55` |
| composição/pixels base | `524db87` / `98b1c2…` | `sonic1_sonic/stand`, mapping `18749e…` | PASS; RGBA `ce95ea…`, negativos de ordem/paleta/flip | `inspection-2026-09-20T23-09-28-313Z-sonic-stand-base.png` |
| edição pela UI e pixels modificados | `524db87` / `98b1c2…` | paleta[1] RGB333 `(7,0,7)`, ROM modificada `d381b1…` | PASS; RGBA `91ee4a…` | `inspection-2026-09-20T23-09-28-313Z-sonic-stand-edited.png` |
| base BYOR relida após o fluxo | `524db87` / `98b1c2…` | original `c7da53…`, 531.577 bytes | PASS; tamanho/SHA inicial e final idênticos | log `[inspection-base-integrity]` |
| exportar/aplicar patch e identidade de execução | `524db87` / `98b1c2…` | BPS `35c91e…`; cópia aplicada `d381b1…`; core `07c104…` | PASS; base original não sobrescrita; ROM/core/60 frames/framebuffer `320×224` observados pela UI | `inspection-2026-09-20T23-09-28-313Z-sonic-emulator-base.png`, `...-applied.png`, diretório do patch |
| efeito visual da paleta no jogo | `524db87` / `98b1c2…` | base e cópia sob 60 frames neutros, mesmo core | PENDENTE; ambos `811a21…`, `nonBlackPixels=0`; Sonic não ficou visível | log `[inspection-palette-effect]`, canvas preto |
| salvar/reiniciar/reabrir e recompor | `524db87` / `98b1c2…` | mesma sessão e ROM modificada | PASS; seleção/proveniência restauradas; RGBA reaberto `91ee4a…`; BYOR original intacto | `inspection-2026-09-20T23-09-28-313Z-sonic-stand-reopened.png` |

O primeiro marco desta fatia está concluído: a prova desktop foi executada no binário identificado e deixou capturas, hashes, sessão, BPS, ROM aplicada e limitações rastreáveis. Esta fatia não declara extração automática, equivalência com o jogo original, reconstrução integral, animação ou uma fatia de lógica/nós. O avanço para lógica/nós permanece fora desta entrega porque ainda não há, para Sonic 1, uma rotina delimitada com semântica, source mapping, larguras/flags e execução pelo pipeline canônico demonstrados de forma independente; não se deve promovê-lo a partir da prova visual.
