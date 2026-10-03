# Sentinel — resultado (2a amostra, agora REGRESSAO)

Previsao registrada em `crates/rex-mugen/src/fixture.rs::sentinel` (commit 7cb48a7),
antes de qualquer execucao, com o conversor congelado em 7db7c14 (`FREEZE.md`).

| Item | Previsto | 1a execucao | Situacao |
|---|---|---|---|
| celula 40x48, eixo (20,48) | sim | sim | confirmado |
| paleta aproximada, 2 px fundidos | sim | sim | confirmado |
| anim 0 direto; 210 aproximado (blend) | sim | sim | confirmado |
| anim 99 (sprite ausente) aproximado, frame vazio | aproximado | **ROM travou (ADDRESS ERROR)** | **defeito do conversor** |
| Kick direto; Taunt/Alt/Push nao suportados; Back direto; statedef 230 aproximado | sim | sim | confirmado |
| idle 8+8 com Clsn2 1 depois 2 | — (ROM travada) | — | confirmado apos a correcao |
| chute 4 / 5 com flip V abaixo do eixo / parado (-1) | sim | — | confirmado apos a correcao (geometria) |
| Clsn1 5 quadros | sim | — | confirmado apos a correcao |

Defeito: uma action com frame sem sprite virava linha toda transparente no atlas; o
`rescomp` para no primeiro frame vazio, gerou 2 de 4 animacoes e o `SPR_setAnim(spr, 3)`
acessou fora -> ADDRESS ERROR em `updateFrame` (0x9BE4). Correcao: action com sprite
ausente **nao e convertida** (`unsupported`, erro com a linha). Como o conversor mudou por
causa da Sentinel, ela passa a **regressao**; a alegacao de generalizacao exige a 3a amostra.

Observacao de diagnostico (instrumentacao, nao conversor): o marcador planejado (116,170)
para o frame com flip V caia na faixa colorida espelhada; a imagem mostrou a geometria
prevista (sprite abaixo do eixo, perna em y 168..171). Marcador trocado para (116,160).
