# Proposta de texto para o Memory Bank (frente MUGEN → SGDK, PR #85)

Texto sugerido. O integrador decide onde e se entra; esta frente não edita
`docs/06_AI_MEMORY_BANK.md`.

> **2026-09-28 — MUGEN → SGDK, perfil `mugen.character.v1` (Experimental), PR #85 (draft).**
>
> **Pela interface (E2E desktop `--scenario mugen-import`, binário `07b5af2b…`):**
> - importar um personagem pelo assistente;
> - ver o painel de compatibilidade (7 categorias × 4 classes em linguagem simples, perdas item a
>   item, relatório técnico);
> - compilar com a SGDK oficial e ver o personagem no core;
> - editar a posição no Inspector, salvar, reiniciar, reabrir e recompilar, com o efeito provado
>   por pixels;
> - uma importação recusada (caminho fora do pacote) mostra a causa e não deixa projeto.
>
> **Só técnico** (core direto, previsão registrada antes; amostras Probe, Sentinel e Warden):
> - tempo por frame, `Loopstart`, flip/offset e janela da Clsn1;
> - `ChangeState` por comando/`stateno`/`AnimTime = 0`;
> - edição de durações.
>
> **Não suportado:** SFF v2, som ligado, stage, colisão lógica, blend, facing e expressões
> gerais.
>
> **Pendências:**
> - Inspector com campo "FPS" sem efeito em animações MUGEN;
> - sem UI para durações e `loop_start`;
> - painel sem reabertura;
> - comando pelo teclado não coberto no E2E.
>
> Maturidade: importador **Experimental**; crate `rex-mugen` em `biblioteca-implementada`.
