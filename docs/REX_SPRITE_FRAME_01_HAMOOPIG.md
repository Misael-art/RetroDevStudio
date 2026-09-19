# REX-04 / Sprite-Frame-01 — HAMOOPIG `spr_ryo_100` frame 0

Status da fatia: **Experimental / prova desktop concluída no branch isolado**. Esta entrega não promove a descoberta heurística de tiles a recuperação automática de sprites. O painel mostra explicitamente `Frame composto`, `Metadado doador + bytes compilados verificáveis` e `Não é prévia de tile`.

## Recurso rastreado

| Item | Proveniência | Identificador / hash |
| --- | --- | --- |
| Projeto doador | HAMOOPIG SGDK | `HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]` |
| Recurso | `res/sprite.res` | `SPRITE spr_ryo_100 "sprite/ryo/100.png" 8 13 NONE 0` |
| Frame | fonte com 5 células horizontais; primeira célula | `spr_ryo_100/frame-0`, 64×104 px nativos |
| Referência independente | `res/sprite/ryo/100.png` | SHA-256 `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b` |
| ROM BYOR histórica | `investigation-sgdk-equivalence-2026-09-10/hamoopig/reference.bin` | 917.504 bytes; SHA-256 `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9` |

A ROM atual em `SGDKForge/SGDK_projects/.../out/rom.bin` não é substituída nem usada como referência silenciosa: ela mudou de tamanho/hash. Os bytes do frame foram vinculados à referência histórica por correspondência de dados compilados e descritores, preservando ambas as ROMs.

## O que é recuperável e o que é metadado

- Recuperado da ROM: bloco 4bpp (`0x863A0 + 0x800`), paleta MD (`0x2CC68 + 0x20`), oito descritores VDP (`0x22260 + 0x30`) e os pixels RGBA derivados desses bytes.
- Proveniente do projeto doador: identidade `spr_ryo_100`, seleção do frame 0, relação do frame com `sprite.res`, dimensões semânticas da célula, ordem das partes e interpretação dos descritores ResComp.
- Transformação documentada: bytes 4bpp com nibble alto primeiro; `Tileset` do ResComp ordena tiles verticalmente dentro de cada VDP sprite (`x → y`); paleta usa RGB333 MD (`xxxxBBBxGGGxRRRx`); índice 0 é transparente. `offsetXFlip`/`offsetYFlip` são preservados para o flip global.
- Limitações: apenas este frame e esta ROM; sem animação, hitbox/runtime, streaming ou reconstrução do jogo. Se a ROM não tiver o SHA esperado, o IPC recusa a composição; não há fallback apresentado como recuperação automática.

## Oráculo e negativos

O oráculo independente reconstrói o frame a partir dos bytes/descritores literais e compara todos os 6.656 pixels RGBA do canvas, sem ler os atributos HTML como fonte de verdade. Na leitura WebKit do canvas, RGB de pixels com alfa zero é canonicalizado para zero; essa forma é comparada separadamente do RGBA do PNG, que preserva o RGB da entrada transparente da paleta. A referência independente produz:

- índice do frame doador: `938611103b7d79af7e599fe024fa4adef53a8de898d9a06e00d9da15e451196c`;
- RGBA após RGB333/alpha: `50cba0a2432bb73bcfc5a9c2b0e42668935df3a4c7c2b8e8a0f0e88c3bf46c58`.
- RGBA observado no canvas WebKit: `c70a3dfcb4726662c8f8588f6c5ab576f9b64ff7f37198fc72dcae151fde22dc`.

Os testes Rust e o harness E2E rejeitam, por comparação integral, ordem row-major incorreta, palavra de paleta alterada, flip horizontal incorreto e mutação de um pixel. O PNG possui hash separado do hash RGBA dos pixels.

## Matriz de evidência

| Cenário | Commit / binário | ROM ou fixture | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| Golden/ordem/paleta/flip | `2425bd0`; binário canônico `4d9f95790b6758271240d21ae186d5e1079cb8590cfd15c0037231fd8fb47b8d` | fixtures unitários | 4 testes Rust passam; negativos de ordem, paleta e flip rejeitados | `cargo test --lib sprite_composition -- --nocapture` |
| Fonte independente | `2425bd0` + binário acima | PNG doador acima; offsets `0x863A0`, `0x2CC68`, `0x22260` | todos os 6.656 pixels; PNG/RGBA separados; mutação rejeitada | [log E2E final no HEAD](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/sprite-frame-01-e2e-final-head.log) |
| Desktop composição | `2425bd0` + binário `4d9f95790b6758271240d21ae186d5e1079cb8590cfd15c0037231fd8fb47b8d` | ROM BYOR `558bea…`; sessão `inspection-1789834584-00000000`; `spr_ryo_100/frame-0` | passou no desktop, 64×104 nativo, escala inteira 3× | [sprite antes do reinício](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-19T16-16-06-738Z-sprite-before-restart.png) |
| Salvar/reiniciar/reabrir composição | `2425bd0` + mesmo binário | mesma ROM/sessão; candidato independente `0xA490 + 192` permanece separado | passou; pixels foram lidos novamente após reinício, com identidade ROM/sessão/frame confirmada; prévia pós-reinício `fullyVisible=true`, `unobstructed=true`, hit-test em `IMG` | [sprite após reinício](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/inspection-2026-09-19T16-16-06-738Z-sprite-after-restart.png) |
| Negativo de wizard/obstrução | `2425bd0` + mesmo binário | mesma sessão persistida | clique nativo rejeitado com wizard visível; `unobstructed=false`, `selectionUnchanged=true`, `syntheticEvents=false` | [log E2E final no HEAD](/mnt/sdcard/Projects/RetroDevStudio/src-tauri/target-test/validation/sprite-frame-01-e2e-final-head.log) |
| Cancelamento | herdado do executor no PR #70 | ROM `558bea…` | não repetido por esta alteração de composição | evidência histórica do PR #70; não atribuir à nova prova |

O PR #70 permanece preservado e sem merge. A integração desta fatia será proposta em branch/PR separado, sem restaurar arquivos antigos por cópia indiscriminada.
