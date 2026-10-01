# Prompt — agente A, endereçamento e corpus

Leia docs/handoffs/REX_PARALLEL_PLAN.md e o contrato congelado do integrador.
Trabalhe apenas no worktree/branch atribuídos; não troque a branch canônica.
Propriedade: scripts/rex_profiles/addressing/, data/rex_profiles/addressing/,
docs/rex_profiles/addressing/. Não altere IPC, UI, compilador ou ledger comum.

Missão: produzir perfis verificáveis de tradução de endereços, não recuperar
o jogo inteiro. Ordem: MD linear, MD SSF2, SNES LoROM, HiROM, ExHiROM.
Não apresente esses perfis como os cinco mappers mais usados mundialmente.

Para cada perfil, conclua antes de avançar:
1. Fixe fonte primária, commit e licença. Escreva especificação pequena:
   janelas, registradores, estado inicial, aliases, ROM/RAM/I/O e limites.
2. Crie fixture autoral com padrões distintos por banco e valores nas bordas.
   Escreva expectativas independentes, antes da implementação.
3. Implemente referência pura conforme contrato: endereço+estado -> região
   e offset ou erro; inversão retorna todos os aliases válidos suportados.
4. Teste primeiras/últimas posições, cruzamento de janela, bancos distintos
   na mesma CPU address, ROM curta, overflow, endereços não-ROM e estados
   ausentes. SSF2 deve aplicar escritas nos registradores e observar a mudança
   de leitura. Não trate o arquivo como se tivesse um único estado de bancos.
5. Compare com uma implementação independente fixada; documente casos de
   espelhamento e variantes excluídas. Header insuficiente => ambíguo/unknown.
6. Faça inventário leve do corpus autorizado, sem copiar ROMs: hash, tamanho,
   formato, hipótese, evidência e lacunas. Não atribua mapper por extensão.
7. Entregue manifests imutáveis e relatório com contagens e fronteiras.
   Prova sintética não vira prova de jogo real. Sem corpus, marque fixture-only.

Não divida ROM por intervalos arbitrários. Dependências e fronteiras precisam
ser conhecidas antes de entregar uma região a outro agente.
Não execute Ghidra em lote ou builds completos. Solicite ao integrador a
janela de qualquer verificação pesada; continue documentação/testes leves.
Não introduza bibliotecas sem necessidade nem copie código sem conferir licença.

Qualidade: sem hardcode por hash de jogo para aparentar suporte geral, sem
erros convertidos em offset 0, sem alocações proporcionais a endereço não
validado. Testes devem discriminar fórmula errada, endian e estado errado.

Commits pequenos por perfil, push e PR para branch indicada. Checkpoint com
HEAD, testes, evidências e próximo passo. Continue até os cinco perfis, ou
documente bloqueio concreto e avance no próximo independente. Não faça merge.
