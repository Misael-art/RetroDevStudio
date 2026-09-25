# Plano REX: endereçamento, codecs e recursos editáveis

Este plano é uma proposta de execução, não um aceite de implementação.
Base local conferida: `0d8c413ff818de04f6c9f9f1bd8a5ed614b14862`, branch
`codex/collect-counter-goal`. Corpus local preservado e não rastreado.
O CI remoto desta base não foi reconsultado nesta elaboração.

## Estado e limites

O executor anterior registra no mesmo app SHA-256
`9a6afe4b7c822b0ab750f8b518bb16376dae75b2698406161f3683d442d8a696`:
coleta 4/4, independência 6/6, NodeGraph 13/13, referência 16/16.
A guarda de event_start foi corrigida por entidade/nó. O salto falhou
por sincronização do harness com apoio e soltura consumidos pelo jogo.
São provas do executor, não reexecuções desta revisão.

O PR #77 depende do #76, que depende do #75 e de bases anteriores.
Não fazer merge/release nesta missão. Preservar essa cadeia e revisar
alterações do harness (incluindo áudio/volatile) sem simplesmente afrouxar gates.

Autoria funcional não equivale a recuperar lógica comercial. Normalização,
mapeamento de memória, codecs, descoberta de recursos, desmontagem de CPU,
recuperação de lógica e geração de jogo são capacidades separadas.

## Objetivo mensurável

Construir um sistema extensível de perfis, começando por recursos gráficos:
ROM -> origem verificável -> descompressão -> prévia -> edição -> recompressão
-> reinserção em cópia -> patch -> efeito no jogo.

"100%" significa todos os critérios do corpus congelado de uma versão do
perfil passaram, com denominador publicado. Não significa todos os jogos,
variantes ou caminhos de execução possíveis. Unknown continua explícito.

Cinco perfis de endereçamento iniciais, escolhidos pelo contexto MD/SNES,
NÃO apresentados como os cinco mais populares:
1. Mega Drive linear.
2. Mega Drive mapper SSF2 (janelas, registradores e estado explícitos).
3. SNES LoROM padrão.
4. SNES HiROM padrão.
5. SNES ExHiROM padrão.

LoROM/HiROM/ExHiROM são mapas de memória; não são três técnicas de compressão
nem necessariamente troca dinâmica de bancos. Coprocessadores e mappers
especiais ficam fora até terem perfil próprio. Header não prova sozinho o mapa.

Cinco codecs iniciais MD, escolhidos para aproximar SGDK e corpus Sonic:
1. aPLib, com variante fixada.
2. LZ4W SGDK, incluindo declaração explícita sobre dicionário externo.
3. Nemesis, variante delimitada.
4. Kosinski, variante delimitada; modular é capacidade separada.
5. Enigma, variante delimitada.

Não alegar frequência estatística dessa seleção. Saxman e codecs SNES
ficam no backlog. Um recurso usa o codec efetivamente comprovado, nunca o
codec suposto a partir do nome do jogo ou da extensão do arquivo.

## Ondas por dependência, sem prazo fictício

Onda 0: integrador confirma base, contratos e corpus; trabalhadores podem
levantar fontes e fixtures antes de congelar os contratos.
Onda 1: MD linear/SSF2 e aPLib/LZ4W testados; integrar um recurso real
comprimido até edição/reinserção, inicialmente com offset assistido.
Onda 2: LoROM/HiROM/ExHiROM e Nemesis/Kosinski/Enigma por perfil;
segundo recurso em ROM independente, preservando o primeiro.
Onda 3: ampliar descoberta automática e observação de carregamento real,
com taxa de acerto separada da correção do decoder.
Onda 4: rotina real delimitada -> IR -> nós, com controle de efeitos e
equivalência observada. Não é trabalho automático dos agentes de codecs.

## Recursos e isolamento

Snapshot do host: 8 CPUs lógicas, 14 GiB RAM total, ~6,1 GiB disponível,
3 GiB swap ocupada, 122 GiB livres no volume Home. Reavaliar antes de executar.

Executar 3 agentes: integrador médio + A endereçamento/corpus + B codecs.
Não iniciar um quarto agente neste host por padrão.
Somente um job pesado de Rust/SGDK/Ghidra/Tauri/WebDriver por vez.
Agentes A/B fazem principalmente leitura, fixtures e testes pequenos.
Integrador agenda os testes pesados; não usar espera infinita por lock.
Começar com até 2 jobs de compilação; reduzir conforme memória real.
Com menos de 3 GiB disponíveis ou crescimento persistente de swap, adiar
novos jobs pesados. Não matar processos alheios ou limpar corpus.

Integrador cria worktrees leves no Home para A/B a partir da mesma base.
Não copiar corpus, node_modules ou target para cada agente; corpus read-only.
Não compartilhar arquivos gerados por compilações simultâneas. Não alterar
branch do checkout de outro agente. Não trabalhar nos antigos resíduos do SD.

Propriedade proposta (confirmar inexistência/conflitos antes de criar):
- Integrador: registro de módulos, IPC/UI, manifests comuns, integração,
  docs de estado, ledger global, compilador/emulador e CI.
- A: scripts/rex_profiles/addressing/, data/rex_profiles/addressing/ e
  docs/rex_profiles/addressing/.
- B: scripts/rex_profiles/codecs/, data/rex_profiles/codecs/ e
  docs/rex_profiles/codecs/.
- Testes de cada agente escrevem apenas em sua saída isolada, nunca no
  ledger comum. O integrador incorpora manifests validados.

Scripts de referência não devem virar backend paralelo permanente. Portar
ou adaptar ao Rust canônico exige teste diferencial e revisão do integrador.

## Contratos que o integrador deve congelar

Perfil: id/version/platform, variante, suporte, fonte+commit+licença, limites.
Evidência: hash da ROM original/normalizada, transformação, intervalo,
origem conhecida, resultado esperado independente, ferramenta/versão,
estado de bancos e timestamp/evento quando necessário.

Endereçamento: CPU address + estado do mapper -> ROM offset OU região
não-ROM/ambígua/unsupported; inversão retorna aliases, não um endereço
arbitrário. Reads podem cruzar fronteiras e devem retornar segmentos.

Codec: bytes consumidos, saída, limites de memória/trabalho, variante e
dicionário/contexto necessários. Truncamento, referência inválida, overflow,
saída excessiva e cancelamento são erros estruturados.

Recurso comprimido: proveniência por bloco/segmentos. Não fingir que cada
byte decodificado corresponde linearmente a um offset da ROM.
Exibir status separado: candidato, identificado com evidência, decodificado,
editável, reinserível, executado com efeito observado.

## Gates de cada perfil

- Vetores de fronteira e negativos, mais corpus holdout separado do ajuste.
- Referência independente fixada por commit, não encoder/decoder do produto
  usados como única prova um do outro.
- Codec: decode(produto, encode(referência, dados)) == dados e vice-versa
  quando encoder estiver implementado. Golden literal adicional.
- Recompressão não precisa produzir bytes comprimidos idênticos; preservar
  o bloco original no no-op quando o contrato promete patch sem alterações.
- Zero divergências no corpus aceito e zero falsos positivos no conjunto
  negativo declarado; publicar contagens, não extrapolar para todas as ROMs.
- Pelo menos um recurso com origem externa conhecida por perfil antes de
  alegar aplicabilidade real; sem corpus legítimo, declarar fixture-only.
- Reinserção: preservar base; recusar estouro, dependências desconhecidas,
  expansão ou realocação sem contrato. Atualizar apenas ponteiros/checksums
  efetivamente conhecidos; patch aplicado deve gerar o hash esperado.
- Runtime: fonte reconstituída igual não basta; para edição, observar efeito
  específico com controle original/no-op/modificado e inputs equivalentes.

Não dividir ROM em cinco fatias arbitrárias: instruções, streams e tabelas
podem cruzar os cortes. Dividir por recurso/rotina/banco comprovado, registrando
dependências. Estados de mapper fazem parte da identidade de uma observação.

## Fontes iniciais (fixar commit antes de usá-las como oráculo)

- SGDK: https://github.com/Stephane-D/SGDK/blob/master/inc/tools.h
- mdcomp: https://github.com/flamewing/mdcomp
- Genesis Plus GX: https://github.com/ekeeke/Genesis-Plus-GX/blob/master/core/cart_hw/md_cart.c
- PVSnesLib: https://github.com/alekmaul/pvsneslib/wiki/HiRom-and-FastRom
- SNES framework: https://github.com/Yoshifanatic1/SNES-ROM-Framework

Ler licenças antes de copiar/incorporar código. O Genesis Plus GX tem
restrições próprias; consultar não concede permissão para transplantar.
Não baixar/publicar ROMs comerciais nem publicar bytes extraídos delas.
Fixtures autorais ou redistribuíveis; corpus BYOR permanece local.

## Entrega

Cada perfil tem status por capacidade e evidência, não um único badge verde.
Commits pequenos e PRs dependentes; sem merge/release. CI acompanhado por
consultas pontuais. Não declarar monitoramento ativo após encerrar a sessão.
Checkpoint antes de interrupção: HEAD, último resultado, hipótese, próximo
comando e bloqueio. Não parar na primeira tabela: completar o escopo delimitado.
