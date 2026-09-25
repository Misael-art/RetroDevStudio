# Prompt — agente B, codecs e oráculos

Leia docs/handoffs/REX_PARALLEL_PLAN.md e o contrato congelado do integrador.
Trabalhe apenas no worktree/branch atribuídos; não altere checkout alheio.
Propriedade: scripts/rex_profiles/codecs/, data/rex_profiles/codecs/,
docs/rex_profiles/codecs/. Não altere UI/IPC, manifests comuns ou ledger global.

Missão: produzir cinco adaptadores/perfis de codec com vetores independentes,
decodificação e recompressão verificadas. Ordem: aPLib, LZ4W SGDK, Nemesis,
Kosinski, Enigma. Uma variante por vez; modular/dicionários são capacidades
explicitamente declaradas. Não suponha que os cinco existem no corpus local.

Para cada codec:
1. Fixe implementação de referência, commit, licença, formato e variante.
   SGDK é fonte para aPLib/LZ4W; mdcomp é referência para codecs clássicos.
   Não transplante código antes de avaliar a licença. Nunca ajuste a referência
   para fazer a implementação sob teste passar.
2. Prepare vetores pequenos com resultados conhecidos, incluindo literals,
   runs/backreferences conforme o formato e fronteiras. Separe holdout que não
   foi usado no ajuste. Dados de teste redistribuíveis; BYOR apenas local.
3. Implemente conforme contrato ou adapte ferramenta existente de forma
   explícita. Declare se é adaptador externo ou implementação nativa, jamais
   dois nomes para a mesma função apresentados como oráculos independentes.
4. Teste truncamento em posições relevantes, offsets inválidos, terminador,
   overflow, saída excessiva, trabalho máximo e cancelamento. Nenhum panic,
   leitura fora do buffer ou loop sem limite. Validar antes de alocar.
5. Decoder do produto deve ler stream da referência e produzir dados exatos.
   Encoder do produto deve gerar stream que a referência decodifique exato.
   Roundtrip apenas interno não basta. Inclua golden literal independente.
6. Registre entrada consumida, saída/hash e dicionário/contexto. Sucesso de
   decode não prova identificação: separadamente liste como o stream foi
   localizado e confirmado. Evite varrer todo offset com todos codecs.
7. Preserve original comprimido para no-op quando aplicável; recompressão
   equivalente não precisa reproduzir o mesmo stream. Não sobrescreva bytes
   vizinhos quando o resultado crescer; retorne necessidade de espaço.
8. Entregue ao integrador um caso de recurso conhecido para visualização,
   edição e reinserção. Não declare essa etapa executada só porque o decoder
   passou. Sem evidência real, rotule fixture-only.

Trate LZ4W com dependência externa como dependência, não como stream autônomo.
O codec pode servir a vários tipos de dados: não rotule toda saída como sprite.
Não invente mapeamento linear entre bytes descomprimidos e offsets comprimidos.

Não rode full Rust, Tauri, emuladores ou compressores pesados em paralelo com
outro agente. Peça janela ao integrador; faça um codec/teste pequeno por vez.
Continue por entregas delimitadas até os cinco perfis. Se um bloquear, registre
o motivo e avance no próximo independente, sem declarar o perfil pronto.

Commits coesos por perfil, push e PR dependente; sem merge/release. Checkpoint
com hashes, testes, falhas e próximo passo antes de qualquer interrupção.
