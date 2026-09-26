# Prompt completo — retomada do integrador REX

Você assume o RetroDev Studio sem contexto prévio. Retome o trabalho existente;
não reinicie a implementação. Sua missão é consolidar a correção LZ4W e obter
uma edição de recurso comprimido com efeito causal demonstrado no aplicativo.
Trabalhe em incrementos pequenos, com checkpoint durável e provas independentes.

## 1. Ambiente e preservação

Diretório canônico:
`/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21`

Leia instruções aplicáveis e `/home/misael/.codex/RTK.md` antes dos comandos.
Não use os antigos diretórios do SD como base. Não limpe arquivos alheios.

Snapshot conferido durante este handoff (reconfirme antes de agir):
- branch integradora: `codex/rex-integrator-profiles-codecs`, PR #78;
- HEAD local: `7e19d6a`, sete commits à frente da referência origin local;
- `docs/06_AI_MEMORY_BANK.md` tem modificação não commitada: PRESERVAR;
- untracked: `.mimosa/`, `src-tauri/.mimosa/`, `APJ-unpack`, `apultra-decode`,
  `a.out`, `src-tauri/src-tauri/`, `data/canonical-local-2026-09-21/`;
- não execute esses binários desconhecidos só pelo nome, não os apague nem
  os adicione ao staging em bloco. Verifique origem caso precise usá-los;
- A: `/home/misael/RDS-REX-A-addressing`, branch `codex/rex-a-addressing`,
  HEAD `dbdc122`, PR #80;
- B: `/home/misael/Projects/REX-B-CODECS-2026-09-24`, branch
  `codex/rex-b-codecs`, HEAD `9b2389d`, PR #79.

Sete commits locais, em ordem:
`e942848`, `0e91ea1`, `ca1e685`, `6598261`, `8df377c`, `79dd3df`, `7e19d6a`.
Não os perca com reset/checkout e não envie sem revisar o conjunto.
Confirme o remoto via fetch seguro; ahead local não substitui consulta remota.

Um job pesado por vez: Rust, SGDK, Tauri, MAME, Ghidra ou WebDriver.
Verifique memória, swap e espaço; não encerre processos de outras sessões.
Identifique qualquer varredura antiga antes de iniciar outra. Se for deste
trabalho, guarde checkpoint e encerre de forma controlada quando redundante.
Não rode varredura infinita em background nem monitores permanentes de CI.

## 2. Estado do projeto

Autoria de jogos existe com NodeGraph, comportamentos independentes,
coleta/contador/objetivo, build e teclado real. A base anterior `0d8c413`
tem provas registradas de coleta 4/4, independência 6/6, NodeGraph 13/13 e
referência 16/16. Não reabra defeitos anteriores sem evidência nova.

REX é Experimental: inspeção/edição limitada de recursos e recuperação
delimitada de lógica. Não é decompilador universal ou recuperação de Sonic.
PR #78 depende da cadeia anterior #77/#76/#75. Não presumir integração em main.
Não fazer merge de PR, release ou promoção de maturidade nesta missão.

Leia nesta ordem, sem tratar todo texto histórico como estado atual:
1. alteração local e topo de `docs/06_AI_MEMORY_BANK.md`;
2. `docs/rex_profiles/ROUND_STATE.md` e `CONTRACTS.md`;
3. documentos e evidências recentes de A/B nos seus worktrees;
4. diff dos sete commits locais;
5. testes e implementação dos módulos abaixo.

Arquivos principais:
- `src-tauri/src/tools/reverse/decomp/rex_codecs.rs`;
- `src-tauri/src/tools/reverse/decomp/rex_resources.rs`;
- `scripts/e2e-tauri-build-run.mjs` (cenário rex-lz4w-effect);
- componentes/IPC da aba Recursos comprimidos: localizar por referências;
- `docs/handoffs/REX_PARALLEL_PLAN.md` (metas maiores, não ampliar esta rodada).

## 3. O que foi implementado e o que foi retratado

Existe LZ4W Rust com dicionário anterior ao stream, preview e edição pela UI,
transação com identidade SHA, limites, no-op, dependentes conhecidos, cópia
sem expansão, BPS e reaplicação com hash exato.

Tiles MD são chunky: nibble alto = pixel esquerdo. Já foram consolidados
md_pixel_location/md_read_pixel_index/md_write_pixel_index e golden literal
12 34 56 78 -> 1..8. Não reintroduzir bitplanes. A grade de prévia também foi
corrigida porque lia a faixa linear com coordenadas erradas fora do tile 0.

ROM HAMOOPIG BYOR: 917504 bytes, SHA-256
`558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`.
Localizar a referência no corpus canônico; não buscar outra ROM como substituta.

Alvo histórico:
- TileSet @0x25788: compression=2, numTile=9, stream=0xc8cc8;
- SpriteFrame @0x25790 -> SpriteDefinition @0x258e8;
- paleta real referenciada: 0x221e6;
- 288 bytes de tiles descomprimidos, 144 bytes de stream consumidos;
- NÃO são nove paletas. A leitura palette-like era um alias dentro do header.

Retratações obrigatórias:
- “paleta comprovada” e “transparência tornada opaca” estão invalidadas;
- recolorimento amplo não foi prova causal: o loop livre dessintonizava runs;
- E2E atual registra bloqueio semântico e igualdade nos frames observados;
- um cenário diagnóstico que termina verde com semanticState=BLOQUEADO
  não significa que a meta de efeito visual passou.

## 4. Resultados novos de A/B que prevalecem sobre checkpoints antigos

A provou a cadeia estática do alvo: classificação tile suportada por layout,
referências e dados. Isso não comprova carregamento ou visibilidade.

A sugeriu que encurtar/recompactar poderia deslocar o stream vizinho.
Não adote isso como fato: a transação atual sobrescreve em posição fixa,
sem expansão. Comprimento diferente não desloca vizinhos nesse contrato.
Verifique bytes/ponteiros; dependências de dicionário são questão separada.

B executou o desempacotador oficial 68000 em MAME e comparou bytes completos:
- pequenos casos + stream original: 68000 == jar == esperado;
- stream Rust antigo r10: divergência real no byte 160;
- r11 mínimo: match longo não-ROM off=16590, formato inválido para o alvo;
- r12: off=16385 EXATO é aceito igualmente por 68000 e jar;
- r13: stream da correção atual concorda no 68000, mas ocupa 150 > 144 bytes.

Causa comprovada: aritmética word assinada no decoder 68000; o encoder antigo
aceitava offsets longos não-ROM excessivos. Limite original 0x8000 era errado.
Código atual usa 0x4000 (16384). Ele é UM word mais conservativo que o caso
16385 comprovado. Não confunda limite de janela de busca com distância
codificável; trate ambos separadamente e confira a convenção de +1.

Replay B:
`data/rex_profiles/codec/lz4w-sgdk/evidence/rust-streams-2026-09-26/reproduce.sh`
no worktree B. Examine script, documentação, dependências e corpus antes de
executar. Bytes BYOR e captures podem estar fora do Git. Não os publique.

O integrador encontrou outra edição que cabe: byte 30 00->F0, pixel
(tile=0, linha=7, coluna=4), mantendo 159 recursos verificados preservados.
O efeito desse alvo no gameplay permanece sem demonstração.

A identificou um alvo alternativo realmente observado na tela de título:
TiledImage @0x21b5c, APLIB TileSet 500 tiles @0x2e4d4 (4485->16000 bytes),
TileMap 40x28 @0x2d534 (1196->2240), Palette @0x2cbe8.
Correspondência registrada: 95,90%. O residual foi atribuído a sobreposição
de cores de outra paleta, mas coincidência de cores e referência estática não
comprovam sozinhas todo o compositor/oclusão. Verifique antes de promover.

## 5. Plano de retomada — execute nesta ordem

ETAPA A — preservar e reconciliar (sem build inicialmente)
Registre Git, diffs, HEADs A/B, processos e evidências. Preserve alteração
pendente do Memory Bank. Atualize a matriz com capacidades e retratações.
Não marque a suíte de A/B como integrada apenas porque existe em outro worktree.
Use commits específicos revisados quando necessário, sem merge de PR remoto,
sem importar indiscriminadamente toda a história e sem editar arquivos alheios.

ETAPA B — fechar o contrato do codec
Reproduza r11/r12/r13 com o oráculo 68000 e seu encoder atual.
Adicione regressões de fronteira 16384/16385/16386, entrada truncada, fonte-ROM
versus fonte-RAM e saída completa. O máximo aceito deve corresponder ao contrato
medido. Encoder pode escolher janela menor por estratégia, mas decoder não
deve declarar stream válido inválido por confusão de constantes.
Teste fora do roundtrip interno: Rust encode -> 68000 decode é obrigatório.
Preserve a verificação de roundtrip dentro da transação e a recusa needs_space.
Não tente fazer a edição de 150 bytes caber num slot de 144 por sobrescrita.

ETAPA C — corrigir a precisão da observação
Snapshots de WRAM/VRAM iguais por 900 frames comprovam ausência de diferença
observada, NÃO que a rotina nunca executou: escrita pode ser transitória ou
ser sobrescrita entre amostras. Não rotule isso como prova de não-carregamento.
Para afirmar consumo, observe chamada/entrada de descompressão, destino ou
transferência a VRAM, com hashes e parâmetros quando a infraestrutura permitir.
Mantenha original/original e no-op. Execução medida não pode misturar loop
livre com step determinístico. UI normal é prova de apresentação separada.

ETAPA D — obter um alvo útil, sem repetir busca cega
Escolha recurso com uso demonstrado, não apenas pattern matching agnóstico de
paleta. Defina edição e efeito esperado antes de executar.
Faça uma busca limitada e registrada nos recursos LZ4W comprovados em tela,
reutilizando índice de dicionário e preservando todas as recusas.
Se nenhuma edição couber, registre esse limite e avance para o alvo APLIB
visível já localizado: implementar aPLib no Rust canônico com vetores de B e
oráculos independentes, mesma transação/UI. Isso é continuação autorizada,
não precisa pedir novo GO. Não promova isso como fechamento da prova LZ4W.

Alternativamente, uma ROM autoral SGDK com recurso LZ4W explicitamente exibido
pode certificar a cadeia controlada; rotule fixture autoral, não sucesso BYOR.
Não modifique a ROM comercial para forçar artificialmente o recurso a aparecer
e então declarar que o jogo original o utiliza.

Sem espaço comprovado para reinserção: não expandir ROM nem realocar ponteiros
sem projeto específico de realocação/dependências. Não há autorização para
essa expansão estrutural nesta rodada. Continue nas provas independentes úteis.

ETAPA E — prova pelo produto
UI: abrir base, selecionar recurso, visualizar, editar, salvar/reabrir,
exportar BPS, reaplicar à base e executar resultado.
Fixe app/core/ROM/patch e sequência de input. Compare original/no-op/modificado.
Comprove a mudança esperada no recurso efetivamente usado, incluindo mapping,
flips/paleta quando pertinentes. Não aceite apenas framebuffer diferente.
Canvas deve apresentar a saída correspondente ao core; não escreva em VRAM
nem use overlays para fabricar o resultado.

Aceites BYOR exigem arquivo e identidade; ausência falha no comando de aceite,
sem return silencioso contado como PASS. Testes sintéticos continuam separados.
Negativos: base errada, dicionário ausente/errado, stream inválido, falta de
espaço, dependente conhecido alterado, patch errado, resposta obsoleta na UI.

## 6. Qualidade, gates e publicação

Não reescreva módulos inteiros para defeito localizado. Não enfraqueça asserts.
Oráculo compartilhando fórmula não é independente; mantenha goldens literais,
referências fixadas e execução real 68000. Preserve o código legítimo anterior.

Comece com testes focados; depois cargo fmt --check, clippy, Rust, lint,
TypeScript, frontend, check:tree e host:certify conforme scripts existentes.
Build canônico inclui frontend. Reexecute provas afetadas no MESMO binário,
preservando autoria/coleta/salto/NodeGraph se caminhos comuns mudarem.
Não exigir todas as suítes caras a cada edição mínima.

Revise os sete commits locais, novos commits e staging. Faça commits coesos,
push para a branch correta e atualize PR #78 com o estado real. Consulte CI
pontualmente; o verde de 0ba067b não certifica o HEAD local posterior.
Composio local é a via preferida para GitHub quando disponível.
Sem merge/release; preserve branches base dos PRs dependentes.

Leve scripts/provas necessários que estejam em /tmp para local durável
adequado, separando código redistribuível e corpus local privado. Hashes e
receitas versionados; bytes comerciais não staged.

Checkpoint obrigatório a cada etapa: HEAD, alterações não commitadas, hipótese,
evidência a favor/contra, último comando/resultados, próximo comando e bloqueio.
Não deixe varreduras sem orçamento nem prometa monitoramento após encerrar.

Continue até completar o marco delimitado ou registrar impedimento externo
concreto. Não pare após um teste verde, um push ou um diagnóstico se houver
trabalho independente autorizado. Não declare concluída a meta visual enquanto
semanticState estiver BLOQUEADO. Entregue capacidades aprovadas separadamente.
