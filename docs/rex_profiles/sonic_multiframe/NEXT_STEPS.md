# Capacidade real e continuidade organizada — 2026-10-02

Este parecer separa as provas executadas nesta proposta das provas herdadas dos
relatórios da consolidação. Não substitui a revisão de cada perfil ou autoriza
merge remoto. #98 continua aberta em `0ef540e`; #99 é a proposta dependente de
composição/pintura Sonic. #97 tem P1 semântico e fica fora. #84 também fica fora.

## O projeto já faz

| Frente | Capacidade demonstrada | Natureza e limite da prova |
| --- | --- | --- |
| Criação de jogo | Template autoral, grafo, build SGDK, execução, pintura de mapa, edição de limiar e persistência | `reference-platformer` reexecutado: 16 etapas. Não é recuperação da lógica de um jogo comercial. A comparação controlada das passagens e a prova de teclado têm métodos próprios no relatório. |
| Edição de ROM Sonic | Dez frames compostos por mapping/DPLC, pintura e paleta cumulativas, confirmação de compartilhamento, BPS e reinício/reabertura | Prova desktop nova, RGBA independente e inspeção visual. Perfil assistido de uma ROM fixada por SHA; não é identificação automática de qualquer personagem. |
| Efeito da edição no jogo | Edição do stand executada na ROM aplicada: 96 pixels alterados no Sonic | Prova nova e separada das dez prévias. Não demonstra que todas as animações ou dez frames editados foram consumidos pelo jogo. |
| Recursos comprimidos | Ciclos delimitados aPLib/LZ4W, contexto de mapa/paleta e transação com preservação de vizinhos | Herdado dos pacotes do integrador. Cada recurso e fixture tem seu escopo; repack fora do slot não está autorizado por essa prova. |
| MUGEN | Ken real, importação visual, duração por quadro, locomoção e cadeia parcial CMD/CNS | Herdado da #98. Não reexecutado nesta proposta. Estado autoral substituto e controladores não convertidos continuam explícitos; não há conversão integral do motor. |
| Endereçamento/codecs | Perfis de banco, tradutores e codecs com testes e comparações próprias | Componentes e pesquisa úteis; disponibilidade em crate/CLI não implica disponibilidade na UI ou consumo em jogo. |
| Recuperação de lógica | Perfis delimitados ADDQ/branch-compare e trabalho de rotina de gameplay | As provas são específicas. Não existe decompilação geral para código C/nós equivalente ao jogo inteiro. |
| Música/áudio | Áudio autoral no pipeline e pesquisa de estruturas de drivers | Pesquisa de músicas não é editor musical nem equivalência sonora. Tabelas opacas, comandos desconhecidos e loopback não medido permanecem assim. |

O salto atual é um fluxo visual de edição com identidade, coordenadas corretas e
efeito observável. O próximo salto deve completar uma operação que uma pessoa
consiga repetir, não aumentar uma contagem de codecs sem consumidor comprovado.

## Ordem recomendada

1. Integrador: fechar a validação de destino da #98 e revisar #99. O display
   virtual autenticado resolve a geometria do teste sem alterar monitores ou
   exigir instalação global. Merge depende da autorização do operador.
2. Em paralelo, B corrige o significado dos recursos da #97, e D corrige a
   ordem das células VDP de seu compositor. Seus territórios não precisam
   modificar o app ou a documentação comum.
3. Depois da geometria validada, preparar uma edição de cadência de **uma
   sequência Sonic de duração fixa comprovada**, com BPS e efeito em jogo.
   Caminhada dependente de velocidade não deve ser apresentada como duração
   constante. Essa sequência é uma nova missão, não capacidade já entregue.
4. Só então ampliar para outros recursos/ROMs e avaliar recuperação de lógica
   ou música. Cada expansão exige prova de consumidor, não só decode plausível.

Não há porcentagem defensável de “decompilador universal”. Para acompanhar
progresso, registrar por perfil: corpus identificado, estruturas conhecidas,
consumidor estático, consumo observado, edição, reinserção, efeito e limites.
Bytes desconhecidos continuam desconhecidos. Restrições de hardware devem ser
separadas de limitações do conversor atual; uma técnica de extensão precisa de
medição no pipeline e no core, não de uma afirmação de possibilidade.

## Regras comuns aos próximos agentes

- Ler RTK/AGENTS e os documentos obrigatórios; verificar estado real, base,
  worktree, pins e host. O canônico fica em
  `/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21`.
  Não trabalhar nos resíduos do SD nem trocar a branch do checkout de outro agente.
- Usar worktree/branch próprias, território explícito, zero novas dependências
  runtime sem autorização. Documentos comuns/registro são do integrador.
- Ler corpus BYOR sem modificar ou versionar ROM/PNG/RGBA comerciais. Fonte
  autoral, hipótese, unknown e recuperação comprovada são classes distintas.
- No host, uma compilação pesada ou E2E por vez; enquanto isso, outras frentes
  fazem leituras, contratos, fixtures e testes pequenos. Não deixar watchers.
- Não aceitar frame antigo, input por intenção, clique por DOM oculto ou screenshot
  obstruída como prova. Registrar app/frontend/harness/core/ROM por SHA.
- Evidências ficam em diretório exclusivo; congelar cópias dos JSONs que o host
  reescreve. Verificar os hashes contra os bytes e os nomes de etapas reais.
- Continuar autonomamente até os critérios finitos da missão. CI pendente não
  é entrega verde. Só interromper trabalho dependente por falta real de dado,
  autorização indispensável ou recurso; avançar no trabalho independente e
  deixar checkpoint reproduzível. Não inventar resultado para evitar bloqueio.
- Sem limpeza alheia, force push, merge/release ou promoção não autorizados.
  Se houver autorização de merge específica já registrada, executá-la após os
  gates do destino; não pedir novamente o mesmo GO.

## Prompt: integrador

Você assume a consolidação sem apagar o trabalho anterior. Reconcilie o estado
remoto antes de agir: #98 `0ef540e`, #99 sobre ela; #97 bloqueada; #84 separada.
Verifique se esses estados mudaram. Preserve os commits e os checkpoints de
outras sessões. Não adote contagem de testes ou CI de outro SHA como resultado seu.

Missão completa: preparar um destino revisável para #98 e #99, com suas provas
afetadas executadas no binário canônico do destino. Primeiro leia a revisão e
o relatório Sonic `docs/rex_profiles/sonic_multiframe/REPORT.md`. A prévia antiga
Sonic e o compositor de D compartilhavam a ordem errada por linha. O produto de
#99 usa coluna; stand correto RGBA `7354bcfb6af04b6dc5d95c56adbaca232f9658a5edb0cb4dbd98a98582c462e7`.
Não incorpore de novo o antigo golden como referência correta.

Execute serialmente os cenários afetados MUGEN com sprites reais e seus oráculos,
`reference-platformer`, `sonic-multiframe` e `inspection-sonic-tiles`. O corpus
de Ken/Sonic é local, não provisionável no CI. O Xvfb externo de QA já foi
verificado no cache; SHA do executável
`5bfd315a8c7bc626d0b183d176e130c34f910a4a1279d9d53ea45769f62a3351`.
Use display autenticado e processos próprios, sem alterar o monitor do usuário.

O harness de #99 exige ROM compilada = ROM da Game View, sessão nova, hold
encerrado e dez frames renderizados antes de coletar o framebuffer. Preserve
essa barreira: o log de build aparece antes da carga terminar. Não substitua
teclado nativo por input direto no core em um critério de interação do usuário.
Não substitua Ken real por fixture geométrica. Registrar negativos, reabertura
visual, processos encerrados, resultados novos/herdados e limites.

Fechar também check:tree, frontend, Rust, fmt/clippy, crates:gates e host:certify
conforme AGENTS. Resolver falhas com causa/regressão, não afrouxando assertions.
Conferir o CI do SHA publicado pontualmente; preparar um único fechamento
documental, sem ciclo de commit por consulta. Entregar PR de destino, artefatos
congelados e reprodução. Merge remoto só quando a autorização específica existir.

## Prompt: agente B

Você assume exclusivamente a correção semântica da #97. Parta do pin e de
`PROMPT_B_CORRECAO_CONTEXTO.md`, localizando o arquivo na branch de B antes de
escrever. Não alterar produto, crates, harness comum, Memory Bank ou ROUND_STATE.
Trabalhe no território próprio da pesquisa de B; publique commits aditivos.

A paridade dos codecs é útil e deve permanecer. O P1 é a interpretação:
`$FF4000` é WRAM; o consumidor observado copia layout 64×64 de IDs de bloco,
com stride 128, para `$FF1020`. Não é nametable VDP 64×32. Os 196 casos de
Pulseman são streams compatíveis até que consumidor e classe sejam provados.

Entregue o ciclo inteiro: contrato separado de codec/estrutura/consumidor;
regressões que falhem na interpretação antiga; leitor/layout correto; composição
somente dos campos comprovados; lista localizada de unknown; evidência por
instruções/ponteiros; artefatos antigos explicitamente superados sem apagá-los.
Negativos reais obrigatórios: ROM errada, sítio alterado, destino alterado,
stream fora da tabela, geometria errada e consumidor ausente. Decode duplo é
determinismo, não negativo de identidade. Compare saídas com referências pinadas;
controle sem referência fica not-evidenced.

Persistir resultados do corpus reservado sem ajustar o detector depois de olhar
os resultados. Acrescentar relatório com teste nomeado por critério, SHA, comando,
rc e limitações. Publicar e passar a revisão independente; não encerrar em “docs
corrigidos” enquanto o leitor/teste ainda aceitar a geometria antiga. Observação
em emulação que exigir o único slot pesado deve ser preparada para o integrador,
sem alegar que foi executada. A classe gráfica fica pendente até prova suficiente.

## Prompt: agente D

Você assume a pesquisa de mapping/DPLC/animação Sonic no território de D.
Preserve a entrega anterior, mas reavalie a ordem de células de cada peça VDP:
é por coluna. A concordância com `ce95ea66…40d4` não era prova independente,
pois o piloto e a pesquisa compartilhavam a ordem por linha. Não editar o app,
Memory Bank ou o namespace de B; consumidor de produto pertence ao integrador.

Entregar: golden literal autoral assimétrico 2×2 ou 2×3 com expectativa escrita
sem usar o compositor; regressão RED com ordem por linha; correção única da
geometria incluindo flip de peça e âncora; recomposição dos frames já provados;
galeria real para inspeção visual e comparação com referência independente.
DPLC continua slot de carga, não índice de arte. Índice transparente, lacunas,
peças sobrepostas e paleta desconhecida não podem ser preenchidos por adivinhação.
Não mudar a escala de cor apenas para fazer uma comparação passar.

Fechar os negativos de ordem/flip/slot e registrar que cópias antigas conservam
seus bytes, sem recertificar intenção das coordenadas usadas naquela versão.
Depois, preparar **uma sequência de duração fixa** para a próxima edição de
animação: identificar tabela, consumidor, instruções de controle, duração e
todos os frames necessários; decodificar também um caso reservado e registrar
saltos/mudanças de animação desconhecidos. Não assumir duração fixa de caminhada
dependente da velocidade. Entrega inclui modelo serializável, endereços e
intervalos, dependências, comandos de prova e plano de mutação/efeito no core.
O resultado desta perna é o contrato e a pesquisa comprovada, sem alegar UI ou
efeito em jogo que o integrador ainda não executou.

## Prompt: próxima frente de produto, após os contratos acima

Missão: editar a cadência de uma animação Sonic real delimitada, pela interface,
salvar/reabrir, exportar/aplicar BPS e demonstrar o efeito no core. Iniciar apenas
quando o contrato de D para essa sequência estiver publicado e revisado. Use
worktree própria sobre a base integrada aprovada; reserve os arquivos de UI/IPC
com o integrador para evitar edição concorrente das mesmas superfícies.

Reutilizar a composição/pintura de #99 e os componentes visuais existentes.
Mostrar thumbnails reais, nomes de quadros, duração na unidade comprovada e
preview identificada como preview. O usuário deve entender origem, alterações
compartilhadas e unknown. Não criar motor de animação paralelo ou sprite falso.

No backend, a mudança só pode tocar os bytes/intervalos autorizados pelo perfil,
com identidade da base, cópia cumulativa e dependências revalidadas. Não alterar
codecs/mapper nem realocar recursos nesta missão. Original/no-op e mudança de
duração devem ser comparados com inputs/estado comuns, ao longo de frames
controlados. A referência independente prevê as transições antes da medição;
nomes de animação ou hash diferente não provam cadência.

Critérios de entrega: escolha/edição por controles nativos; recusa de parâmetro
inválido, ROM/frame errados e resposta antiga; persistência após reinício real;
BPS byte-exato/base intacta; efeito temporal em jogo e controle no-op; capturas
desobstruídas; gates e CI no SHA correto. Se a sequência escolhida depender de
velocidade ou estado não comprovado, trocar o alvo antes de implementar em vez
de fabricar um tempo fixo. A classificação permanece Experimental e delimitada.
