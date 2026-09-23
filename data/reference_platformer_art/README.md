# Reference Platformer — arte original

Estas duas imagens são conceitos originais gerados para o template builtin `reference_platformer`:

- `fox-concept.png`: raposinha aventureira kawaii com cachecol vermelho e espada de madeira, em cinco poses.
- `environment-concept.png`: portão de madeira, bandeira de chegada, terreno, nuvens e céu.

Modo de geração: imagens raster novas, sem imagem de referência e sem ativos comerciais. Direção visual: pixel art 16-bit legível, formas fofas porém corajosas, silhuetas claras e cores quentes para a personagem contra céu azul.

## Raposa: candidato de integração

O conceito de cinco poses foi separado mecanicamente em `fox-frame-{0..4}-source.png`, centralizado em cinco telas 512×512 e reunido em `fox-five-frame-source.png`. O SGDK Forge converteu o conjunto para `fox-five-frame-32-candidate.png` (160×32, cinco quadros 32×32, 15 cores visíveis, índice 0 transparente), usando o spec `fox-five-frame-convert-32.json`. Job imutável: `fox_five_frame_32_control/6e2081f30dc244e8`; SHA-256 do PNG: `20bc7c5906a415d2ef8a38b21a7ad18930b9946b6fa62eeede4acfc15e3a972c`.

O backend usa `fox-five-frame-32-runtime.png` no template em vez de desenhar a raposa por caracteres em Rust. Essa cópia tem PNG RGBA (necessário para o decoder do WebView) e os mesmos pixels RGBA do PNG indexado do Forge: SHA-256 dos pixels brutos `605d25582856b511307adddb083684ab4cc4007e2219a761a9b4175943ece1b6`; SHA-256 do arquivo RGBA `8f104172610518705021450603f04bfd4d2fc0ed997e7c71de21cdb54874c735`. A conversão técnica **não equivale a aprovação visual**: o SGDK Forge classifica a saída como `technical_candidate` e exige revisão humana antes de promovê-la a arte final. O teste no desktop e a decisão visual continuam necessários. As sondas 16×16 e 24×24 foram rejeitadas por perderem rosto e espada; 48×48 e 64×64 melhoram detalhes, mas mudariam mais a escala e a jogabilidade da fase. A escolha experimental de 32×32 preserva a legibilidade sem aceitar automaticamente uma das sondas maiores.

## Portão e bandeira

Do conceito de ambiente foram produzidas duas fontes isoladas novas, `gate-source.png` e `goal-flag-source.png`. O SGDK Forge gerou candidatos técnicos indexados, e cópias RGBA de pixels idênticos foram colocadas no template para leitura segura pelo WebView:

- Portão fechado: `gate-24x32-runtime.png`, 24×32; job `gate_24x32_control/0e03fcad24713a68`; SHA-256 do arquivo `a63bf02ab318607fb768054a31b9495756d5501488145a2608ae0d996d02d0f5`; SHA-256 dos pixels RGBA `248d6ac6a0ad337ae6b24b3600a3a21e66c61e26de91d74ac43345c4f778f2ce`. O bloqueador físico também mede 24×32; abrir a passagem continua removendo esse bloqueio.
- Bandeira de chegada: `goal-flag-16x32-runtime.png`, 16×32; job `goal_flag_16x32_control/92adcc1cdf06cb15`; SHA-256 do arquivo `3422d4cd0db2f5e9c3b5038c3fbc2210a14a41ae635c2c2776a856a99faeb6bf`; SHA-256 dos pixels RGBA `f604de87f8e060f70c92440a85ebe87660fbb1a785b6a84126860458aba53445`. O sensor de vitória permanece independente do desenho.

## Paisagem do cenário

`stage-scene-concept.png` é o conceito gerado para a paisagem; a edição `stage-backdrop-source.png` removeu piso e plataforma para que a imagem não insinuasse colisões inexistentes. O SGDK Forge traduziu o fundo para 320×224 e 10 cores visíveis no job `fox_stage_backdrop_10_control/ec6421319a78f856`; o PNG indexado `stage-backdrop-320x224-10-candidate.png` tem SHA-256 `b9a01ad8a6520f6a405e2d1ed87a416a317ec272fecf8341548d4c7d6b8461bd`. O backend o usa somente como fundo da imagem PPM do tileset. Piso nas linhas 26–27 e plataforma na linha 21 continuam alinhados ao mapa de colisão, com os seis tons de grama/terra/tijolo existentes; a paleta final do cenário ocupa 16 cores. O candidato anterior de 15 cores (`stage-backdrop-320x224-candidate.png`, job `bbd1e3d8ac6240ca`) foi mantido apenas como sonda: não deixava espaço para os materiais do primeiro plano no mesmo slot.

O fundo melhora nuvens, montanhas e floresta, mas grama, terra e tijolo do primeiro plano **ainda são provisórios**, gerados pelo backend. A saída do Forge é `technical_candidate`, não aprovação estética. Raposa, portão, bandeira e fundo são candidatos visuais integrados para teste; nenhuma ROM ou asset BYOR foi incorporado.

## Provas da integração (2026-09-23)

| Cenário | Binário SHA-256 | Resultado e evidência versionada |
| --- | --- | --- |
| Autoria guiada, viewport, salvar/reiniciar/reabrir e vitória pelo teclado | `f87636051d8866464bf34dcb241f39fde5ea67124f9efc0b3d7c5db2ce9619b9` | 10/10 passos; `doc/evidence/authoring-acceptance-2026-09-23T22-00-59-691Z-report.json`; capturas `…-01-guided-editor-loaded.png`, `…-07-reopened.png`, `…-08-victory.png`. O canvas mostrou 49 pixels de pelagem, 14 da espada, 36161 de céu e 5852 de montanhas antes de editar; após reabrir, os recursos e a paisagem foram lidos novamente. ROM jogada SHA-256 `d300878b3f41edf870c4506386ad5f7fb87c5d44e610e6258b3c4c0936eeb6ec`. |
| Platformer de referência: edição, colisão, passagens, movimento, salto, pausa e persistência | mesmo binário | 16/16 passos; `doc/evidence/reference-platformer-2026-09-23T22-02-03-162Z-report.json`; captura `…-04-gameplay-controls.png`. |
| Contrato nativo de dimensões, transparência e paletas | teste Rust `reference_platformer_art_fits_native_sizes_and_md_palette_slots` | passou: raposa 160×32, portão 24×32, bandeira 16×32, cenário opaco 320×224, até 16 cores por slot. |

As capturas anteriores em `target-test/validation` permanecem como histórico do cenário pré-paisagem. A aprovação humana da direção de arte e a substituição definitiva dos tiles do primeiro plano continuam pendentes. O template segue **Experimental**.
