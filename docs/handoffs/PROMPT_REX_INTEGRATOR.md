# Prompt — integrador médio

Você coordena uma rodada REX do RetroDev Studio. Leia integralmente
docs/handoffs/REX_PARALLEL_PLAN.md; ele define escopo, recursos e gates.
Diretório canônico: /home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21.
Leia instruções locais, RTK, Memory Bank e Current Wave. Não apague corpus.

Sua prioridade é preservar a autoria funcional em 0d8c413, conferir a cadeia
de PRs #75/#76/#77 e construir integração comprovada de recursos comprimidos.
Não fazer merge/release. Não assumir que main contém as branches empilhadas.

Execute em ordem:
1. Confirme Git, CI do HEAD efetivo, provas/hashes e diferenças de harness.
   Não reabra defeitos encerrados sem evidência nova. Atualize estado documental
   atrasado, distinguindo provas do executor de sua validação independente.
2. Crie branch integradora e worktrees leves isolados A/B no Home, mesma base.
   Publique contratos pequenos de perfil/evidência/mapeamento/codec.
   Só você altera arquivos comuns, IPC/UI, manifests, ledger e CI.
3. Entregue os prompts A e B. Eles levantam fontes e fixtures em paralelo;
   implementação contratual começa após o contrato congelado. Mudanças de
   contrato devem ser versionadas, nunca adivinhadas pelos consumidores.
4. Reserve um único job pesado. A/B não iniciam compilação completa por conta
   própria. Registre limites e dono da execução; não mate processos alheios.
5. Revise um perfil por vez. Exija oráculo externo, negativos e versão/variante.
   Não aceite bytes aleatórios que por acaso descomprimem como identificação.
6. Integre primeiro MD linear/SSF2 e aPLib/LZ4W. Para um recurso realmente
   identificado no corpus, faça ROM -> decode -> prévia -> edição -> encode
   -> reinserção -> patch -> jogo. Use o pipeline canônico Rust/IPC/UI.
   Offset/codec assistidos são aceitáveis se claramente rotulados; não venda
   esse fluxo como detecção automática. O recurso real determina qual codec
   usar. Ausência de corpus exige fixture autoral, não evidência inventada.
7. Comece com reinserção limitada ao espaço comprovadamente disponível.
   Não expanda ROM, realoque dados ou altere ponteiros sem perfil testado.
   Gere cópia e patch; preserve original. Confirme efeito visual específico
   com original/no-op/editado e reabertura do projeto.
8. Após a primeira integração, receba os perfis restantes em incrementos,
   preservando regressões. Endereçamento SNES não implica suporte de codecs
   SNES ou compilação da lógica recuperada. Mantenha esses estados separados.

Não implemente decompilação universal nem um novo emulador nesta rodada.
Não deixe scripts auxiliares virarem uma segunda arquitetura de produto.
Revise resultados dos agentes: autoridade é a evidência, não o resumo deles.

Aceite da rodada: cinco perfis de endereçamento e cinco codecs com matriz
honesta de capacidades; primeira cadeia real comprimida editável e reinserível
executada no produto; itens sem suporte permanecem explicitamente bloqueados.
Não marque o objetivo completo se perfis faltarem. Avance em trabalho
independente quando um perfil bloquear; registre a dependência exata.

Execute testes focados a cada alteração e gates completos no destino de
integração conforme escopo. Reexecute provas afetadas no mesmo binário
canônico; preserve autoria/coleta/salto/NodeGraph. Commits coesos, push, PRs
dependentes, CI por consultas pontuais; sem merge/release.

Ao parar, grave checkpoint reproduzível. Não encerre após abrir PR ou após
uma fixture verde se ainda puder trabalhar dentro do escopo autorizado.
