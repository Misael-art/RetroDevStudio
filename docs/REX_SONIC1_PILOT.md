# REX — piloto visual Sonic 1 (Experimental)

Estado em 2026-09-20: implementação publicada na branch isolada `codex/rex-sonic1-pilot`, sem merge. A prova desktop final foi executada no commit `57c27803e773cc9e7cf122c2131874e2af0c2eaa`, binário canônico `src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `3260f8080f6d4365865a8b04df6fad58ee52b9c71cfba4a172c898bf265ad145`; frontend `index-BChzqSef.js` declarou o mesmo commit.

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
- TypeScript, lint, Rust fmt, testes de composição `9/9`, testes de patch `5/5` e `InspectionPanel 8/8` passaram.
- Um primeiro teste falhou antes de executar por `ENOSPC`; a chamada exata foi Vitest escrevendo no cache. O teste Rust confirmou a causa: `src-tauri/src/lib.rs:7157` recebeu `StorageFull` ao escrever ROM sintética em `TMPDIR=/run/user/1000/codex-desktop/tmp`, tmpfs de 1,5 GiB usado em 100%. `df` do workspace mostrava blocos e inodes disponíveis. As repetições usam `TMPDIR=/tmp`, sem remover arquivos de outras sessões.
- O E2E final produziu patch e ROM aplicada em `src-tauri/target-test/validation/sonic1-pilot-2026-09-20T19-37-51-791Z/`: patch `sonic1-stand-palette.bps`, 32 bytes, SHA-256 `35c91e8d31a64d72a09f664deb67ec9ebe42015f0dd4aeb20cb95f9283ab817c`; ROM aplicada SHA-256 `d381b1eed8f47dcd08890007b58b90cd5e3cabdaed96deac9b1e7336b1558e4d`. A prova registra HTTP 200 do WebDriver, elemento/visibilidade/hit-test, seleção persistida e recomposição independente após reinício.

## Matriz de aceite desta branch

| cenário | commit/binário | ROM ou fixture | resultado | evidência |
| --- | --- | --- | --- | --- |
| golden e composição Rust | `57c2780` / `3260f8…` | fixture literal + corpus Sonic | PASS focado; 9 testes | `cargo test ... sprite_composition` |
| base incompatível no BPS | `57c2780` / `3260f8…` | ROMs sintéticas do teste | PASS; rejeitou CRC divergente | `cargo test ... patch_studio`, 5 testes |
| identificação e análise pela UI | `57c2780` / `3260f8…` | ROM Sonic, SHA `c7da53…` | PASS; sessão `inspection-1789933057-00000000`, run concluído | log E2E final |
| composição/pixels base | `57c2780` / `3260f8…` | `sonic1_sonic/stand`, mapping `18749e…` | PASS; RGBA `ce95ea…`, negativos de ordem/paleta/flip | `inspection-2026-09-20T19-37-19-572Z-sonic-stand-base.png` |
| edição pela UI e pixels modificados | `57c2780` / `3260f8…` | paleta[1] RGB333 `(7,0,7)`, ROM modificada `d381b1…` | PASS; RGBA `91ee4a…` | `inspection-2026-09-20T19-37-19-572Z-sonic-stand-edited.png` |
| exportar/aplicar patch e executar | `57c2780` / `3260f8…` | BPS `35c91e…`; cópia aplicada `d381b1…` | PASS; base original não sobrescrita; 60 frames no core canônico | `inspection-2026-09-20T19-37-19-572Z-sonic-emulator.png`, diretório do patch |
| salvar/reiniciar/reabrir e recompor | `57c2780` / `3260f8…` | mesma sessão e ROM modificada | PASS; seleção/proveniência restauradas; RGBA reaberto `91ee4a…` | `inspection-2026-09-20T19-37-19-572Z-sonic-stand-reopened.png` |

Esta fatia não declara extração automática, equivalência com o jogo original, reconstrução integral, animação ou uma fatia de lógica/nós. O menor próximo critério é concluir a prova desktop no binário identificado e registrar capturas, hashes, sessão, BPS, ROM aplicada e limitações.
