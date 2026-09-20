# REX-04 / Sprite-Frame-01 — HAMOOPIG `spr_ryo_100` frames 0–1

Status da fatia: **Experimental / prova desktop concluída no branch isolado**. A composição agora aceita dois frames rastreáveis do mesmo recurso; outros recursos permanecem recusados até possuírem bytes e metadados equivalentes. Esta entrega não promove a descoberta heurística de tiles a recuperação automática de sprites. O painel mostra explicitamente `Frame composto`, `Metadado doador + bytes compilados verificáveis` e `Não é prévia de tile`.

Correção visual no produto foi preservada no PR #71; o HEAD verificável `f0d3347` contém apenas o rustfmt exigido pelo CI sobre o código já provado em `5b16970`. O frame tem área própria não encolhível, rolagem inteira quando necessário e metadados em bloco separado. A imagem usa `content-box` explícito de 192×312 CSS (64×104 nativos em escala 3×), bordas descontadas pelo E2E, proporção nativa, transparência e `image-rendering: pixelated`. Redução fracionária silenciosa é rejeitada pelo harness.

## Recurso rastreado

| Item | Proveniência | Identificador / hash |
| --- | --- | --- |
| Projeto doador | HAMOOPIG SGDK | `HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]` |
| Recurso | `res/sprite.res` | `SPRITE spr_ryo_100 "sprite/ryo/100.png" 8 13 NONE 0` |
| Frames | fonte com 5 células horizontais; células 0 e 1 | `spr_ryo_100/frame-0` e `spr_ryo_100/frame-1`, 64×104 px nativos |
| Referência independente | `res/sprite/ryo/100.png` | SHA-256 `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b` |
| ROM BYOR histórica | `investigation-sgdk-equivalence-2026-09-10/hamoopig/reference.bin` | 917.504 bytes; SHA-256 `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9` |

A ROM atual em `SGDKForge/SGDK_projects/.../out/rom.bin` não é substituída nem usada como referência silenciosa: ela mudou de tamanho/hash. Os bytes do frame foram vinculados à referência histórica por correspondência de dados compilados e descritores, preservando ambas as ROMs.

## O que é recuperável e o que é metadado

- Recuperado da ROM: frame 0 em `0x863A0 + 0x800` com descritores em `0x22260`; frame 1 em `0x86BA0 + 0x840` com descritores em `0x222A2`; ambos usam a paleta MD `0x2CC68 + 0x20`.
- Proveniente do projeto doador: identidade `spr_ryo_100`, seleção das células 0/1, relação dos frames com `sprite.res`, dimensões semânticas, ordem das partes e interpretação dos descritores ResComp.
- Transformação documentada: bytes 4bpp com nibble alto primeiro; `Tileset` do ResComp ordena tiles verticalmente dentro de cada VDP sprite (`x → y`); paleta usa RGB333 MD (`xxxxBBBxGGGxRRRx`); índice 0 é transparente. `offsetXFlip`/`offsetYFlip` são preservados para o flip global.
- Limitações: somente os frames 0 e 1 deste recurso e desta ROM; outros recursos, animação, hitbox/runtime, streaming ou reconstrução do jogo continuam fora da fatia. Se a ROM não tiver o SHA esperado, o IPC recusa a composição; não há fallback apresentado como recuperação automática.

## Oráculo e negativos

O oráculo independente seleciona o manifesto literal pelo `frame_id`, reconstrói o frame a partir dos bytes/descritores da ROM e compara todos os 6.656 pixels RGBA do canvas, sem ler os atributos HTML como fonte de verdade. Na leitura WebKit do canvas, RGB de pixels com alfa zero é canonicalizado para zero; essa forma é comparada separadamente do RGBA do PNG, que preserva o RGB da entrada transparente da paleta. Para o frame 0, a referência independente produz:

- índice do frame doador: `938611103b7d79af7e599fe024fa4adef53a8de898d9a06e00d9da15e451196c`;
- RGBA após RGB333/alpha: `50cba0a2432bb73bcfc5a9c2b0e42668935df3a4c7c2b8e8a0f0e88c3bf46c58`.
- RGBA observado no canvas WebKit: `c70a3dfcb4726662c8f8588f6c5ab576f9b64ff7f37198fc72dcae151fde22dc`.

Para o frame 1, o manifesto independente fixa `descriptor_offset=0x222A2`, `tile_data_offset=0x86BA0`, `tile_data_size=0x840` e 66 tiles; a máscara de transparência coincide pixel a pixel com a segunda célula do PNG doador. O E2E usa o mesmo oráculo literal e mantém os negativos de ordem, paleta, flip e mutação.

Os testes Rust e o harness E2E rejeitam, por comparação integral, ordem row-major incorreta, palavra de paleta alterada, flip horizontal incorreto e mutação de um pixel. O PNG possui hash separado do hash RGBA dos pixels.

## Matriz de evidência

| Cenário | Commit / binário | ROM ou fixture | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| Golden/ordem/paleta/flip e artefato | `f0d3347`; binário canônico abaixo | fixtures unitários | Rust `615 passed / 40 ignored`; negativos de ordem, paleta, flip, mutação e caminho inseguro rejeitados | `cargo test --lib -- --nocapture --test-threads=1` |
| Frame-0 independente | código runtime `5b16970` (HEAD documental `f0d3347`) | ROM `558bea…`; `0x863A0+0x800`, descritor `0x22260`, paleta `0x2CC68+0x20` | `64×104`; 6.656 pixels; índice `938611…`; RGBA independente `50cba0…`; canvas `c70a3d…`; PNG `8bb4dc…` | [captura frame-0](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-20T02-03-19-690Z-sprite-frame-0.png) |
| Frame-1 independente | código runtime `5b16970` (HEAD documental `f0d3347`) | ROM `558bea…`; `0x86BA0+0x840`, descritor `0x222A2`, paleta `0x2CC68+0x20` | `64×104`; 6.656 pixels; índice `77b3b0…`; RGBA independente `15dab9…`; canvas `c63a0f…`; PNG `48f82e…` | [captura frame-1](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-20T02-03-19-690Z-sprite-frame-1.png) |
| Troca `frame-0 → frame-1 → frame-0` | runtime `5b16970`; binário `ee3aac…` | mesma ROM; sessão `inspection-1789869813-00000000` | passou; `pending=null`, `staleFrameRejected=true` nas duas transições; a resposta atrasada não reaproveita imagem/metadados anteriores | log E2E da execução final |
| Salvar/reiniciar/reabrir com frame-1 | runtime `5b16970`; binário `ee3aac580e099c5eed3e0be0ca56da7aa1952a56bbc8991598417ef7a9bdb95b` | ROM `558bea…`; run `run-inspection-1789869813-00000000-00000001`; candidato `0xA490+192` | passou; `spr_ryo_100/frame-1`, ROM/sessão/candidato/offset/tamanho restaurados; pixels relidos após reinício; CSS `192×312`, escala 3×, pixelated, fully visible/unobstructed | [antes do reinício](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-20T02-03-19-690Z-sprite-before-restart.png), [depois](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-20T02-03-19-690Z-sprite-after-restart.png) |
| Negativos de frame desconhecido/metadado incorreto | `f0d3347`; testes de UI/Rust | manifests controlados sem frame ou com frame/manifesto divergente | rejeitados; a composição não reutiliza a prévia anterior | testes `sprite_composition` e painel de inspeção (7/7) |
| Negativo de wizard/obstrução | runtime `5b16970`; binário `ee3aac…` | mesma sessão persistida | clique nativo rejeitado com wizard visível; `unobstructed=false`, `selectionUnchanged=true`, `syntheticEvents=false` | execução E2E final |
| Cancelamento | herdado do executor no PR #70 | ROM `558bea…` | não reexecutado por esta alteração; não atribuir ao binário `ee3aac…` | evidência histórica do PR #70 |

Binário canônico usado na prova desktop: `/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/debug/retro-dev-studio`, SHA-256 `ee3aac580e099c5eed3e0be0ca56da7aa1952a56bbc8991598417ef7a9bdb95b`; commit/frontend carregado `5b16970d2c35057805e1ea509da077cade5c13fd`. O HEAD `f0d3347` é uma correção de formatação sem mudança de runtime; seu build canônico foi refeito e está registrado no ledger e no Memory Bank.

O primeiro run concorrente da suíte frontend teve erro de inicialização de worker durante a compilação Rust concorrente; a repetição serial (`--pool=forks --maxWorkers=1 --no-file-parallelism`) passou sem remover casos. O CI remoto reprovou inicialmente somente em `cargo fmt --check` pela mesma linha não formatada; `f0d3347` corrige isso. O caminho `src-tauri/src/tools/reverse/decomp-recovery/object_diff.rs` continua um holdout com I/O error reproduzível em `rg`, sem limpeza ou substituição.

## Hash ledger e gates finais

- Binário canônico de `f0d3347`: `e0fec553aceb18df25d30fc22d3655ff8b8f3fdfc00b6fbbed69a28b87da8982`.
- ROM BYOR: `/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/hamoopig/reference.bin`, 917.504 bytes, SHA-256 `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`.
- PNG doador: `/mnt/sdcard/Projects/Sgdk Forge/SGDK_projects/HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]/res/sprite/ryo/100.png`, SHA-256 `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b`.
- Frame-0: PNG `8bb4dc723fa4d9435f6eaa3ce1c2248df7a20e30b800a6c56bfdd0a54fa96168`; canvas `c70a3dfcb4726662c8f8588f6c5ab576f9b64ff7f37198fc72dcae151fde22dc`; referência RGBA `50cba0a2432bb73bcfc5a9c2b0e42668935df3a4c7c2b8e8a0f0e88c3bf46c58`; índices `938611103b7d79af7e599fe024fa4adef53a8de898d9a06e00d9da15e451196c`.
- Frame-1: PNG `48f82e1ccfb3e96552858cdeb99e535c1823b23e7f938286024d43a047f0fdc8`; canvas `c63a0fd26c561806f5319fb24380983db10b99998048c678f81d2bf45c7fbde0`; referência RGBA `15dab9d16df147cc1bb81348fbc0d0a7e65458b34d3d77541df536024af768d0`; índices `77b3b0dba715b352c3ace058abefa5d5d1918d2393dc2064b60a9ed01e0e1903`.
- Capturas: frame-0 `3cd14965d1812455d0fb800b7cb3d4e4a8bc006ccd8de1d4fb0ab09c0b579db8`; frame-1 e antes do reinício `a810c47180e7b0f0fdef96a20a7f66188adf3c3e689d174c7853c541d28deb6e`; após reinício `3873e4a1c2f066bb51b7f7379a11617c7e0fe6b3f6d2514665b326d3b06ec891`.
- CI no HEAD `f0d3347`: `linux-validate` 2/2, `validate` 2/2 e `desktop-smoke` 2/2 passaram. `host:certify`: `READY`, fingerprint `77bbc2a76ab04417b2c5e4f0ddcd82e10dcc4ef220883510652c9f67e632425c`, lock `dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377`.

O PR #70 permanece preservado e sem merge. A integração desta fatia será proposta em branch/PR separado, sem restaurar arquivos antigos por cópia indiscriminada.
