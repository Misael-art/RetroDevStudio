# 12 - PLANO: DECOMPILACAO PAREADA (MATCHING DECOMPILATION) VIA GHIDRA + LLM + EMULADOR

## Programa REX — reconstrução, extração e edição verificáveis

**Revisão de planejamento: 2026-09-10.** Pedido do operador: máxima abrangência de formatos, dados organizados e editáveis, lógica por nós e criação de jogos novos. Este programa é a proposta de implantação solicitada; sua existência não declara capacidades implementadas nem autoriza despesas, dependências novas, envio de ROMs a serviços externos ou merge automático. Quando o operador entregar o prompt ao executor, ele poderá executar as etapas sucessivas aqui descritas, respeitando gates e restrições concretas. As antigas fases e o prompt v2 abaixo ficam como histórico; o prompt vigente é `PROMPT_AGENTE_RECONSTRUCAO_ROM.md`. Decisões arquiteturais consolidadas permanecem preservadas; eventual conflito deve ser apontado com proposta concreta, não alterado silenciosamente.

### REX 1. Resultado desejado e limites de garantia

Entregar quatro fluxos distintos na mesma aplicação:

1. **Explorar:** abrir ROM, identificar hardware, navegar bytes/código/recursos com procedência e incerteza.
2. **Modificar com preservação:** editar recursos ou parâmetros suportados, exportar patch e manter trechos não reconstruídos intactos.
3. **Reconstruir por nós:** recuperar comportamento de um subconjunto comprovado, editá-lo, compilar e validar o resultado; não converter funções desconhecidas em operações vazias.
4. **Criar do zero:** construir jogo sem ROM doadora com cenas, atores, animações, lógica, áudio e exportação suportada.

“Todos os formatos” é uma direção de expansão, não uma promessa binária. Suporte depende de plataforma, revisão do hardware, mapper/coprocessador, contêiner, compressão, engine e operação. Uma extensão reconhecida não garante extração; extração não garante semântica; pseudocódigo não garante recompilação. Análise estática/dinâmica finita não recupera de forma universal todas as intenções, nomes e estados possíveis de um programa. O produto deve ser completo nos perfis publicados, extensível fora deles e explícito ao encontrar desconhecidos.

Critério de qualidade: nenhum sucesso silencioso com perda; resultados reproduzíveis; origem consultável; edição reversível; diferenças explicadas; listas de suporte específicas. Testes fornecem evidência nos cenários executados, não prova de equivalência universal.

### REX 2. Baseline que não pode ser confundido com a meta

- Branch de trabalho desta revisão: `codex/import-decomp-review`, HEAD de produto observado `7da13104bdf4f0fb13d382c87d5814cbe7ebefda`. PR #61 em draft após contestação visual. O próximo executor deve consultar Git/CI novamente, sem tomar este snapshot como estado atual eterno.
- HAMOOPIG padrão: `/mnt/sdcard/SGDKForge/SGDK_projects/HAMOOPIG [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]/out/rom.bin`; 917504 bytes; SHA-256 `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`.
- Taiketsu complementar: `/mnt/sdcard/SGDKForge/SGDK_projects/TAIKETSU ULTRA HERO GENESIS [VER.001] [SGDK 211] [GEN] [ENGINE] [FIGHTING]/out/rom.bin`; SHA-256 `3967996af4efe197284dd80e48a3b457aa381f8e0ba098851b5dbb59fc42bc7c`.
- HAMOOPIG íntegro no backend Genesis Plus GX após 180 frames: prova em `/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/hamoopig/backend-reference.json`. Não certifica botão, input, FPS sustentado ou reconstrução.
- A prévia regenerada do Taiketsu combina recursos com lógica parcial. Evitar crash de VRAM não resolveu equivalência; estados/animações não devem virar atores simultâneos nem compartilhar paleta arbitrariamente.
- Núcleo estático decomp existe na branch de revisão, sem editor completo de ROM→nodes. Rebuild duplo de fontes conhecidas é controle de determinismo, não decompilação recuperada.
- Sonic indicado pelo operador: `/home/misael/emulation/roms/genesis/Sonic the Hedgehog (USA, Europe).bin`. Ainda não analisado; primeiro calcular hash e identificar revisão. Não assumir offsets, engine, algoritmo ou suporte pelo nome.
- Dois projetos já portados para SGDK 2.11 não provam migração automática de 1.60/1.80/2.00. Assets ausentes permanecem faltantes identificados, sem inventar substitutos.

### REX 3. Matriz de abrangência e níveis de suporte

Cada perfil registra independentemente `identify`, `inspect_code`, `extract`, `edit_asset`, `edit_logic`, `rebuild`, `emulate`, `export_patch`. Estados por capacidade: `unsupported`, `experimental`, `verified_for_profile`; incluir SHA/corpus/versão/data/evidência. Publicar limitações por recurso, nunca um selo genérico “ROM suportada”.

| Onda | Família planejada | Variações a inventariar e validar | Condição para avançar |
|---|---|---|---|
| 1 | Mega Drive/Genesis cartucho | imagens raw .bin/.md/.gen, dumps intercalados .smd, byte order, regiões, SRAM/EEPROM, variantes de mapeamento | Perfil específico reconhecido por conteúdo; transformação reversível; negativo fora do perfil |
| 2 | SNES cartucho | .sfc/.smc, header de copiador, LoROM/HiROM e extensões, SRAM, coprocessadores individualmente | Backend e compilação próprios; evidência equivalente à onda 1 |
| 3 | Master System/Game Gear; NES; GB/GBC | contêineres e mappers de cada família, bancos de código/dados, formatos gráficos/áudio | Estudo técnico e aprovação de toolchains/cores que faltarem; entrega por mapper |
| 4 | GBA e outras plataformas de cartucho; N64 | CPUs/endianness/compressores e, quando aplicável, microcódigo e gráficos 3D | IR/extensões específicas, orçamento e benchmark; sem adaptação nominal apenas |
| 5 | Mega-CD/32X, PS1/Saturn e outros discos | sistemas multi-CPU, tabelas de faixas, ISO/BIN+CUE/CHD, áudio, BIOS quando necessária | Preservação das faixas e temporização; suporte real do core e ferramentas aprovadas |
| 6 | Arcade e sistemas adicionais | conjuntos de chips/ROMs, relações parent/clone, descritores, BIOS, layouts de placas | Perfil por placa e revisão, hashes do conjunto; não interpretar ZIP como um único jogo |
| Contínua | Empacotamento e formatos não reconhecidos | ZIP/7z/GZIP conforme dependências existentes; arquivos múltiplos, patches IPS/BPS | Seleção explícita de membro; limites de expansão; nunca escolher arbitrariamente o primeiro .bin |

As ondas 3–6 são roadmap de expansão, sem data firme ou declaração de suporte. “Custom”, dumps danificados, cifrados, imagens parciais e chips desconhecidos devem gerar relatório útil de bloqueio; não tentar normalização destrutiva. BIOS/chaves/ROMs não são provisionamento automático. Formato de dump, engine e versão do SDK são eixos diferentes.

### REX 4. Arquitetura proposta, integrada ao que existe

Fluxo: bytes originais → identificação/normalização reversível → mapa de memória e recursos → análise estática + observações de runtime → IR com evidências → projeto editável → patch ou compilação → comparação.

| Componente | Responsabilidade | Local canônico a estender |
|---|---|---|
| Loader/plataforma | Limites, detecção, bancos, endereço de CPU versus offset de arquivo, mapeamento de normalização | `tools/reverse/loader.rs`, `platform.rs`, `manifest.rs` |
| Recursos | Tiles, paletas, metassprites, mapas, áudio, textos e codecs reconhecidos | `graphics.rs`, `audio.rs`, `text.rs` |
| Código/decomp | CFG, referências, funções, evidência de símbolos, IR baixo nível, fingerprints | `code.rs`, `tools/reverse/decomp/` |
| Observação | Capturas e metadados de core; eventos de acesso quando efetivamente disponíveis | `trace.rs`, `emulator/libretro_ffi.rs`, parity harness existente |
| Projeção/edição | Recursos e comportamentos recuperados → UGDM, preservação de desconhecidos | `projection.rs`, `annotations.rs`, UGDM e project manager |
| Nós/build | Semântica tipada, validação, AST, emitters e source map existentes | `src/core/nodegraph/`, `compiler/ast_generator.rs`, `build_orch.rs` |
| UI/IPC | Sessões canceláveis, catálogo, revisão de evidências, edição e erro acionável | ReverseWorkspace, NodeGraphEditor e serviços IPC existentes |

Não reativar o compilador TypeScript legado como pipeline de produção. Não criar scanner/store/harness duplicado. As interfaces abaixo são contratos a projetar e testar, não APIs já disponíveis.

Manifesto versionado mínimo: `schema_version`, original SHA/tamanho, container+member, hash normalizado, transformações reversíveis, hardware/mapper/region, revisão de ferramenta/core, lista de recursos e dependências, lacunas e ledger de alterações. Cada recurso tem ID estável, intervalo(s) de origem, endereço/banco, codec e parâmetros, hash raw/decodificado, paleta associada, referências/aliases, categoria, nome inferido versus confirmado e evidências. Conservar blocos desconhecidos como desconhecidos.

Cada afirmação semântica registra `declared`, `observed`, `inferred` ou `unknown`, origem e escopo. Confiança não é porcentagem inventada: usar regra/proveniência e calibração em corpus conhecido. Salvamento transacional, schema migrations, locks, retomada após crash e invalidação de cache por hash+versão+opções. IDs de recursos não mudam apenas por renomear o arquivo.

### REX 5. Pacotes de implementação e critérios de aceite

| ID | Trabalho concreto | Dependências | Evidência exigida |
|---|---|---|---|
| REX-00 | Auditar branch/CI, registrar baseline, corrigir claims e fixar corpus | Nenhuma | Manifesto com hashes; reproduzir positivo HAM e negativo da prévia; nenhuma ROM original alterada |
| REX-01 | Schema de capacidades/proveniência e ledger comparável | 00 | Round-trip, migration, corrupção, concorrência, identidade estável, estados desconhecidos preservados |
| REX-02 | Identificação e normalização MD + contêineres | 01 | Fixtures por variante; desfazer transformação restitui SHA original; truncado/ambíguo retorna erro correto |
| REX-03 | Corpus e oráculos independentes | 00–02 | Separação por projeto entre calibração e holdout; export do compilador/fonte usado só no oráculo, não vazando para entrada ROM-only |
| REX-04 | Extração visual MD organizada | 02–03 | Tiles/paletas/flip/prioridade/transparência/metassprites/animação/planos/mapeamento espacial corretos em fixtures; todo recurso exportado aponta à origem |
| REX-05 | Codecs e reinserção reversível | 04 | decode→encode→decode igual; tamanho/relocações/referências corrigidos; entrada malformada não causa overrun |
| REX-06 | Runtime e correlação com ROM | 03–04 | Frames+input+estado com core e versão; fonte de cada observação identificada; indisponibilidade de PC/VDP marcada missing |
| REX-07 | Editor de recursos e patch preservador | 04–06 | Editar pela UI, salvar/reabrir, desfazer/refazer, exportar/aplicar patch à base correta; base errada rejeitada; diferença só no escopo esperado |
| REX-08 | Desmontagem/IR de comportamento | 03,06 | CFG e referências corretos em corpus com símbolos; flags, largura, signedness, overflow, bancos, interrupções e acessos IO preservados |
| REX-09 | Recuperação estruturada | 08 | Tabelas de estados, atores, câmera, colisões e chamadas reconhecidas com evidência; indireções não resolvidas bloqueiam promessas de completude |
| REX-10 | Projeção IR→nodes e execução compilada | 09 | Cada nó tem semântica e origem; testes diferenciais nó→C→ROM; unsupported bloqueante; sem bridge no-op |
| REX-11 | Criação do zero pelo caminho canônico | 01,10 subset | Jogo pequeno completo feito pela UI, sem fonte/doador: menu, movimento, animação, colisão, objetivo/fim/reinício, áudio quando perfil suportar; save/reopen/build/run |
| REX-12 | Migração SGDK versionada | 03; em paralelo a 04–09 | Casos reais 1.60/1.80/2.00 e controle 2.11; precondições verificadas, dry-run/diff, idempotência e rollback; build e paridade dos cenários |
| REX-13 | Reconstrução integrada HAM/Taiketsu | 05–12 | Reimport sem alterações comparado à referência; editar comportamento e recurso via UI; recompilar e comparar delta esperado; lacunas mantidas visíveis |
| REX-14 | Sonic piloto BYOR | 02–10 | Hash/revisão confirmados; reconhecer e editar um recurso, depois um parâmetro de lógica por nós com prova; desconhecidos preservados; patch reproduzível |
| REX-15 | Robustez/release do perfil MD | 07,10–14 | Gates Linux/Windows no mesmo SHA; corpus holdout, UX/acessibilidade, recuperação de falhas, desempenho e pacote instalado |
| REX-16 | SNES e ondas seguintes | 15 | Repetir contratos/testes/oráculos por plataforma; não promover recursos só por compartilhar UI |

**REX-04/05 em detalhe.** Separar imagem bruta, tiles, composição e animação. Conservar índice da cor, palette bank, prioridade, flips, origem e duração, pivô/hitbox quando comprovados. Mapas: tiles/metatiles/chunks, camadas, colisão separada e scroll. Não agrupar por proximidade de bytes como fato; oferecer agrupamento manual persistente. Compressão: catálogo de codecs por engine/assinatura com verificação de saída e consumo exato de entrada; compressão desconhecida fica bloco opaco. Mudança de tamanho exige espaço comprovadamente livre, relocation e referências conhecidas; bloquear caso contrário. No-op export deve ser byte-exato preservando payload original; recompressão diferente pode ser aceita como semântica equivalente somente no modo explicitamente rotulado.

**Áudio/texto.** Distinguir amostras PCM, comandos de driver/música, instrumentos e áudio renderizado. WAV gravado durante execução não é recuperação da trilha editável. Drivers desconhecidos permanecem opacos; preservar parâmetros de loop, pitch e temporização comprovados. Texto requer encoding/tabela, terminadores e ponteiros, sem interpretar bytes arbitrários como strings confiáveis.

**REX-08/10 em detalhe.** Manter uma IR de baixo nível por CPU e uma representação de alto nível agnóstica para nós. Não forçar assembly otimizado em C/SGDK sem preservar comportamento. Agrupar por módulo/ator/estado com subgrafos, navegação para instrução, busca, filtros e layout estável; evitar grafo gigante de cada instrução. Blocos opacos podem ser preservados no patch, mas não apresentados como lógica visual editável. Bridge só executável se ABI, entrada/saída, memória, registradores/clobbers, calling convention, endereços e relocação estiverem comprovados; caso contrário bloquear compilação dessa modificação. Não reutilizar uma ROM anterior quando o build falhar. Provar que o código gerado editado foi usado por hash e por efeito observável.

**REX-12 em detalhe.** Detectar versão por metadata/headers/API com ambiguidade explícita; não pelo nome da pasta ou fingerprint isolado. Comparar changelogs/headers oficiais fixados. Regras devem operar sobre contexto sintático/símbolos, não substituições globais: `sprite.h` e `sound.h` podem ser headers gerados de recursos. Cobrir SPR_init/addSpriteEx/flags, paletas, VDP, DMA, chamadas de frame, timers, áudio/Z80, rescomp, boot/linker e make flags conforme mudança real constatada. Boot customizado nunca substituído automaticamente só para compilar. Build em cópia limpa do projeto, preservar original e manifestar regra/origem/diff. Para cada versão, ao menos fixture mínima, fixture de estresse e projeto independente holdout; se corpus não existir, marcar a célula não medida. Mudança de compilador pode alterar comportamento indefinido: diagnosticar, não “corrigir” arbitrariamente. Distinguir migração com fonte de ROM→nodes; Sonic não deve ser pressuposto SGDK.

**REX-14 em detalhe.** Primeiro modo leitura com inventário e identificação; depois alteração visual pequena reversível; depois uma variável/rotina bem delimitada. Preferir codec e descritor reutilizáveis, com fixture aberta equivalente. Anotações de revisão do Sonic podem enriquecer plugin de perfil, mas não ensinar offsets de uma revisão como regra universal. Não anunciar “editar o Sonic inteiro” a partir de uma paleta ou velocidade alterada. Caso o motor não recupere uma função, registrar a lacuna e preservar os bytes.

### REX 6. Gates que impedem repetir o falso positivo

1. **Identidade:** original e candidata com SHA-256, input e cenário definidos; sem misturar ROM compilada anterior, ROM do autor e prévia de recursos.
2. **Extração:** no corpus conhecido, comparar recursos com export/oráculo independente, incluindo índices de paleta, composição e referências. Cobertura = recursos corretos / recursos esperados conhecidos; itens não localizados entram no denominador. Em ROM sem ground truth, cobertura total é desconhecida.
3. **No-op:** exportação preservadora sem edição recompõe exatamente a imagem original; reconstrução por compilador tem gate separado, pois layout diferente pode ser válido. Igualdade de objetos é medida separadamente de igualdade da ROM.
4. **Controle negativo:** trocar paleta, eliminar transição, inverter input, congelar loop ou impedir patch deve reprovar pelo motivo esperado. Captura não preta, botão enabled oculto ou mensagem “ativo” não são sucesso suficiente.
5. **Paridade observada:** mesmo core/config/ROM inicial, reset, SRAM conhecida, inputs por frame, sementes/RTC quando aplicáveis; checkpoints de framebuffer, áudio, RAM e estado pertinente. Comparar regiões disponíveis simetricamente. Ausência de dado é missing, nunca igualdade.
6. **Mudança intencional:** preservar todos os cenários de controle e verificar delta específico. Não comparar ROM modificada à original esperando igualdade completa; registrar quais saídas devem mudar e quais devem permanecer.
7. **CPU/VDP:** Libretro comum não garante tracing de PC, DMA ou registradores por ciclo. Declarar capacidade por core; extensão de instrumentação exige desenho próprio e validação. Não inventar medição com contador de sprites estático.
8. **Interface:** executar abrir→navegar→editar→salvar→fechar→reabrir→build/patch→run pelos controles visíveis, com prova dos bytes carregados. IPC direto complementa e não substitui o teste de UI.
9. **Desempenho:** medir FPS realmente apresentado, distribuição de frame times p50/p95/p99, áudio underruns, RAM e tempo de import; não usar overlay fixo como medição. Meta inicial NTSC: 10 minutos de cenário sustentado próximo da cadência do core, sem pausas/congelamentos ou underruns; medir PAL separadamente. Fixar tolerâncias no REX-03 antes do teste, considerando host e orçamento, sem relaxar após falha. Hardware real constitui gate distinto, não inferido dos emuladores.
10. **Sem regressões:** casos de borda, save/reload, janela pequena e escala 100/150/200%, teclado e leitor de tela, cancelamento, falta de disco, processo interrompido, caminho Unicode/longos e erros de permissões. Processos externos com timeout/limite de saída e paths sem shell injection; arquivos malformados sem panic, acesso fora de limites ou expansão ilimitada.

Para promoção de um perfil, todas as fixtures mandatórias passam, zero perda silenciosa conhecida, zero blocker no fluxo certificado, todas lacunas listadas. Função descoberta não conta como convertida; função de biblioteca não mascara lógica de jogo ausente. Medir tanto cobertura por quantidade quanto cobertura ponderada dos comportamentos necessários ao cenário. Manter conjunto holdout de projetos independentes (não apenas variantes do mesmo jogo) e uma sessão exploratória não usada para ajustar o extrator. Nenhum percentual isolado autoriza suporte completo.

### REX 7. Cronograma estimativo e caminho crítico

Estimativa de engenharia para **um executor dedicado com revisão humana regular**, sem novos bloqueios de infraestrutura; semanas de trabalho, não promessa de prazo nem estimativa de tokens. Incerteza alta nas fases de reconstrução. Reestimar após REX-03 com throughput medido. Expandir para todas as plataformas é programa contínuo, sem data de conclusão universal.

| Janela orientativa | Entrega | Complexidade | Tipo de agente |
|---|---|---|---|
| Semanas 1–2 | REX-00/01/03: baseline, contratos, corpus e gates | Alta no contrato; média no inventário | Capaz para desenho; executor simples para metadados verificáveis |
| Semanas 3–5 | REX-02/04: loader e catálogo visual MD | Alta | Capaz para layout/formatos; simples para UI já contratada |
| Semanas 6–8 | REX-05/06/07: codec, observação, patch de recurso | Muito alta | Capaz para codecs/relocação; revisão independente |
| Semanas 9–11 | REX-12 e início REX-08: migração e IR | Muito alta | Capaz com domínio de compiladores |
| Semanas 12–16 | REX-09/10/11: lógica, nós e jogo do zero | Pesquisa, muito alta | Capaz; não delegar equivalência a executor simples |
| Semanas 17–20 | REX-13/14: verticais HAM/Taiketsu e Sonic restrito | Muito alta, pode exceder janela | Capaz + revisão de evidências |
| Semanas 21–24 | REX-15: hardening do perfil MD publicado | Alta | Capaz em regressões; simples em QA repetível |
| Após gate MD | REX-16 SNES; ondas posteriores | Estimar após spike de 1–2 semanas por família | Especialização por plataforma |

Este é cenário inicial de cerca de **24 semanas para um perfil MD delimitado**, não para reconstruir todo jogo Mega Drive. Fronteiras semânticas, codecs desconhecidos ou falta de corpus podem ampliar substancialmente o prazo. Checkpoints quinzenais devem reduzir escopo publicado ou revisar estimativa com evidência; nunca relaxar aceite para caber na data.

Caminho crítico: contrato → identificação → oráculos → recursos e observação → IR → nós → rebuild/paridade → hardening. Migração de fontes e editor de jogo novo podem avançar após seus contratos sem aguardar todo o piloto comercial. Uma entrega útil antecipada é explorar/editar recursos por patch, enquanto reconstrução completa permanece pendente.

Paralelismo opcional, apenas quando explicitamente ativado: integrador dono de schema/IPC/docs; A dono de loader/codecs/recursos; B dono de análise/IR/SGDK; C dono de UI/UX/QA após contrato. Cada branch com allowlist e fixtures; arquivos centrais (`lib.rs`, `project_mgr.rs`, emitter, schemas, locks) com um único responsável. Integrar contrato antes dos consumidores, gates no destino, sem compartilhamento de builds/SRAM mutáveis. O executor único pode cumprir os papéis sequencialmente. Não abrir agentes automaticamente por este plano.

### REX 8. Métricas, acompanhamento e definição de entrega

Usar o ledger existente, estendendo-o por migration. Para cada ticket/execução: ID, status (`planned/in_progress/blocked/verified`), responsável, commit/base/branch/PR, dependências, hipótese, comando, exit code, corpus/hash, core/toolchain, cenário/input, métricas antes/depois, evidências positivas e negativas, limitações e próximo passo. Não sobrescrever resultados antigos; nova execução aponta à anterior. Schema inválido/corrompido não reinicia ledger silenciosamente.

Painel comparativo mínimo: perfis identificados versus testados; recursos corretos/esperados; bytes com origem mapeada; referências não resolvidas; funções recuperadas/esperadas; nós compilados versus bridges/lacunas; comportamentos exigidos/provados; no-op byte-exato; patches aplicados e revertidos; divergências por frame; tempo/memória; bugs reabertos; testes ignorados; custo de ferramenta quando existir. Percentuais sem denominador e corpus não são aceitos. Curva de “aprendizado” só com ganho medido em holdout, não com aumento de catálogo.

Entrega por fatia: código integrado, teste de falha anterior quando correção, testes focados e gates aplicáveis, relatório real, docs atualizados, commit coerente, push e PR revisável. Gates integrais para alterações de produto: `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`; `npm run host:certify` ao tocar build/host/emulação/toolchains e validação manual oficial. Segurança/dependências: auditorias canônicas quando aplicáveis. Documentação isolada: estrutura, links e diff; não anunciar suíte de produto reexecutada.

PR inclui problema, perfil suportado, alteração observável, evidência antes/depois, comandos, SHA, corpus e limites. Verificar CI do HEAD final e preservar diagnósticos de falhas; sem bypass de branch protection. PR #61 continua sob investigação até revisão explícita dos itens pendentes. Merge obedece autorização e política real, não é consequência automática de checks verdes.

Distribuição: ROMs comerciais, assets extraídos e disassembly permanecem BYOR locais; exportar patch com hash da base e manifesto de aplicação. Projeto novo usa assets com origem/licença registrada. Não enviar corpus a modelo remoto sem autorização específica; LLM não é dependência da primeira entrega. Qualquer proposta futura de LLM deve ter limite de custo, isolamento, validação de saída e parada em não convergência; nunca autoridade para declarar equivalência.

### REX 9. Fontes técnicas e decisões abertas

Fontes primárias consultadas em 2026-09-10; execução deve fixar tag/commit dos artefatos utilizados, não seguir `master` silenciosamente:

- [SGDK releases](https://github.com/Stephane-D/SGDK/releases): confirma versões e mudanças de APIs/rescomp/compilador que exigem migração por regra, não renomeação global.
- [Ghidra oficial](https://github.com/NationalSecurityAgency/ghidra): infraestrutura de análise/desmontagem/decompilação; não constitui conversor automático de jogos para UGDM.
- [Contrato Libretro](https://github.com/libretro/libretro-common/blob/master/include/libretro.h): interfaces de execução, callbacks e memória; tracing de hardware deve ser demonstrado por implementação/capacidade do core.

Decisões abertas a resolver por spike: mapa de instrumentação disponível em cada core; representação lossless da IR e blocos opacos; estratégia segura de relocation; codecs do corpus; orçamento de parsing e cache; tolerâncias de paridade/performance; conjunto mínimo publicável de nodes; toolchain específica das novas plataformas. Dependência nova só após proposta e aprovação. Não confundir essas decisões abertas com funcionalidades existentes.

---

## Histórico v2 e resultados anteriores (não usar como prompt vigente)


**Status:** Documento de planejamento — superficie `Experimental`
**Versao:** 2.0
**Ultima revisao:** 2026-07-08 (v2 — triagem por tier, curriculo de aprendizado, biblioteca de insumo local, host Linux; scripts versionados fail-hard com testes automatizados negativos, Ghidra boundary benchmark medido com min/max honestos, harness reference/candidate com caminhos explicitos e comparacao de regiao simetrica)
**Objetivo:** Converter ROM de **Mega Drive primeiro** (SNES/PVSnesLib **deferido** para uma fase posterior, fora do escopo atual) em projeto `.rds` editavel + codigo C SGDK compilavel, usando matching decompilation assistida por LLM com verificacao byte-a-byte via um comparador de objetos proprio (`object_diff.rs`), e alimentar de forma sistematica a cobertura logica do NodeGraph ate suportar construcao/analise de jogos 100% por nodes.

> **Estado real (2026-07-08, comprovado):** NAO existe pipeline de decompilacao (scanner de ROMs, ledger de produto, embeddings, LLM e UI de decompilacao continuam **BLOQUEADOS**, nao autorizados). Existem spikes Experimentais **versionados** em `scripts/decomp/` (nao mais so em `~/.retrodev/decomp_work/`, que continua sendo apenas o diretorio de saida/BYOR fora do repo): comparacao binaria M68K com build-duplo reproduzivel (`build_reproducible.sh`), fingerprint v2 por symbol-table com SHA-256 completo (`fingerprint_v2.sh`), holdout Tier 0 sem vazamento (`holdout_v2.sh`), e boundary benchmark Ghidra headless (`ghidra_boundary.sh`). Todos os quatro scripts sao **fail-hard**: falham (exit != 0) com corpus vazio, ELF ausente ou amostra faltante, nunca declaram sucesso silencioso, e sao cobertos por `scripts/decomp/decomp-scripts.test.mjs` (testes negativos + fixture sintetica BYOR-safe). Toolchain: `m68k-elf-gcc` 16, `genesis_plus_gx_libretro.so` e **Ghidra 12.1.2 + jdk21-openjdk (instalados via repo oficial Arch `extra`)** presentes. Boundary benchmark **medido** em execucao limpa e isolada (10/10 amostras OK, `GATE PASSED`): **release -O3 LTO precisao[min=0,587 max=0,738] / recall[min=0,512 max=0,841]**; **debug -O1 precisao[min=0,850 max=0,873] / recall[min=0,940 max=0,957]** (5 projetos x 2 perfis; ver `scripts/decomp/ghidra_boundary_sample.json`). O minimo do perfil release (`Custom Font`) e um resultado real medido, nao descartado. O numero de cobertura por fingerprint v1 (60,3%) foi **descartado como preliminar/inflado**; o numero valido e `unique_resolution_rate~13,2%` do holdout v2 sem vazamento (identidade de bytes com proveniencia unica, **NAO** recuperacao semantica — ver `scripts/decomp/README.md`). Uma fixture SGDK aberta e reutilizada (`src-tauri/tests/fixtures/sgdk_spike/`) por evidencia dinamica real-core Control/Positive/Negative (harness de paridade referencia/candidata), com o build canonico agora feito pelos proprios testes Rust (`parity_fixture_*`), nao mais por script. O comando IPC `parity_run_reference_candidate` aceita `reference_rom_path`/`candidate_rom_path` explicitos como caminho de evidencia profissional (a descoberta por diretorio via `find_first_rom_artifact` vira fallback legado `directory_scan_legacy`); `compare_reference_candidate` compara `label`/`region_id`/`available`/`size`/`sha256` sobre a uniao de regioes dos dois lados (regiao ausente/extra bloqueia `ObservedStateParity`, nao vira apenas limitation); `aggregate_functional_evidence` exige `scenario_id` DISTINTO (derivado de ROMs+golden+frame_count) para `FunctionalEvidence` — um cenario duplicado nunca conta como dois.

**Direcao executiva recomendada:** tratar esta frente primeiro como um **pipeline de aprendizado e cobertura de nodes**, nao como uma corrida para decompilar jogos comerciais famosos. A primeira entrega profissional deve ser: scanner da biblioteca BYOR + triagem por tier + ledger de aprendizado + fingerprint SGDK + Ghidra export estatico, tudo testado e sem LLM no caminho critico. So depois disso o agente deve abrir matching assistido por LLM em Tier 0/Tier 1. ROM comercial entra apenas quando a base ja aprendeu com corpus SGDK e homebrews, e sempre como reconstrucao funcional/nodes/bridges, sem claim de `MatchExact`.

> **Estado real (2026-09-09, Fase 0 Sprint 1 + Etapa A sob GO formal do operador):** o nucleo estatico da Fase 0 existe e e testado em `src-tauri/src/tools/reverse/decomp/` (sem LLM, sem UI, sem comandos Tauri): `triage.rs` (header SEGA + tier heuristico), `symbols.rs` (parser nm/`nm -S`), `rom_library.rs` (pares BYOR + `DecompLedger` `decomp-ledger/v1` em `RDS_DECOMP_WORK`), `ghidra_bridge.rs` (analyzeHeadless `68000:BE:32:default` com o postscript do spike; fail-hard sem Ghidra), `fingerprint.rs` (SHA-256 por funcao) e `object_diff.rs` (objdump `-dr` normalizado por simbolo), orquestrados por `decomp_orch.rs` (runner `#[ignore]` `decomp_etapa_a_tier0_pairs`). **Etapa A executada em 3 pares Tier 0** (relatorio `target-test/validation/decomp/etapa-a-report.json`; ledger em `RDS_DECOMP_WORK`): `SMOKE_TEST` e `BLUE_CIRCUIT` fecharam **self-compare deterministico** (ROM do rebuild duplo identica byte-a-byte; objetos 2/2 exatos); `TaiketsuUltraHeroGenesis` medido contra o ground truth real (`symbol.txt`: 1.536 funcoes de texto, 1.295 hashes unicos) com boundary Ghidra **precision 1,0 / recall 0,113** (174/174 entradas corretas — release build do autor, coerente com o perfil release do benchmark do spike) e **rebuild duplo nao reproduzivel** no host (boot customizado do autor referencia `registerState`, ausente na lib SGDK 2.11/gcc 13.2 do host) — registrado como nota honesta, sem claim de MatchExact. Dependencia: `sha2 = "0.10"` promovida a direta (ja era transitive no `Cargo.lock`; nenhum codigo novo vendorizado). LLM e UI continuam **BLOQUEADOS** (Etapa B so com as metricas da Etapa A registradas, conforme curriculo).

---

## 0. HIERARQUIA E CONTEXTO

Este documento define o escopo da **decompilacao pareada** como superficie experimental dentro do RetroDev Studio. Nao substitui nem promove nenhuma superficie existente.

Hierarquia de verdade entre documentos (completa, conforme `docs/00_AI_DIRECTIVES.md`):
`docs/06_AI_MEMORY_BANK.md` > `docs/03_ROADMAP_MVP.md` > `docs/09_AGENT_DEV_MODE.md` > `docs/08_TREE_ARCHITECTURE.md` > `docs/02_TECH_STACK.md` > `docs/07_TEST_AND_COMPLIANCE.md` > `README.md`/`CLAUDE.md` > este documento (menor autoridade; nao promove nem substitui nenhuma superficie existente).

Leitura obrigatoria antes de implementar qualquer item deste plano:
1. `docs/06_AI_MEMORY_BANK.md` — estado operacional atual
2. `docs/06_CURRENT_WAVE_AI_BANK.md` — wave ativa
3. `docs/03_ROADMAP_MVP.md` — fases e superficies do produto
4. `docs/08_TREE_ARCHITECTURE.md` — estrutura de diretorios
5. `docs/09_AGENT_DEV_MODE.md` — modo agente, gates, antipoluicao
6. `docs/11_CROSS_PLATFORM_PLAN.md` — adaptacao Linux/Windows (pre-requisito de host)
7. Este documento

---

## 1. O QUE MUDOU NA V2 (RESUMO DA REVISAO)

| # | Mudanca | Motivo |
|---|---------|--------|
| 1 | **Sistema de tiers + triagem automatica de ROM** antes de qualquer gasto de LLM | Matching decompilation para C so e possivel em ROM compilada com GCC/SGDK. Jogos comerciais dos anos 90 sao assembly manual: para eles o alvo passa a ser reconstrucao funcional (assets + trace + FSM), nunca claim de match |
| 2 | **Curriculo de aprendizado Tier 0 → Tier 2** usando o corpus SGDK local como ground truth de custo zero | O corpus (`SGDK_Engines`, 122 projetos catalogados, 68 com ROM+C reais) calibra o pipeline inteiro sem depender de API |
| 3 | **Biblioteca de insumo do host registrada** (`/home/misael/Emulation/roms/{megadrive,megadrivejp,genesis,genesiswide}`) com classificacao preliminar | O agente executor prioriza ROMs que maximizam aprendizado transferivel |
| 4 | **Dois niveis de verificacao:** `MatchExact` (object_diff byte-a-byte) e `MatchFunctional` (parity_harness canonico com estado VRAM/CRAM/RAM apos N frames) | Reusa `parity_harness.rs` da rodada 77 em vez de criar verificador paralelo; destrava valor em ROMs sem toolchain reproduzivel |
| 5 | **Fingerprinting do runtime SGDK como entregavel de primeira classe** | Em ROM SGDK, 30-60% das funcoes sao biblioteca conhecida: resolvidas por hash, sem LLM, ancorando fronteiras de funcao e convencoes |
| 6 | **Caminhos de modulo corrigidos para a arvore canonica** (`src-tauri/src/tools/reverse/decomp/`) | `docs/08` exige reverse core em `tools/reverse/`; v1 propunha modulos paralelos em `tools/` |
| 7 | **Fase -1 de host readiness (Linux + Windows)** amarrada ao `docs/11` | Este host e Linux: `m68k-elf-gcc`, `genesis_plus_gx_libretro.so`, Ghidra 12.1.2 e jdk21-openjdk **provisionados** (repo oficial Arch `extra`). PVSnesLib Linux e cores Libretro adicionais (segundo core cross-core) continuam pendentes de provisionamento sob demanda |
| 8 | **Base de conhecimento com metricas de curva de aprendizado** e **Node Coverage Index** | O objetivo final do usuario e cobertura logica por nodes; cada ROM precisa reduzir o custo da proxima e ampliar o vocabulario de nodes |
| 9 | **Governanca de orcamento LLM** (tetos por sessao/ROM, ledger, kill-switch, BYOK, opcao local) | Sem teto, o loop iterativo pode queimar orcamento em funcao nao convergente |
| 10 | **Guardrails legais/BYOR reforcados** | ROM nunca entra no repo; disassembly de ROM comercial so vai para API externa com opt-in explicito; saidas ficam locais |

---

## 2. INSUMO REAL DO HOST ATUAL

### 2.1 Biblioteca de ROMs (BYOR — leitura apenas, nunca copiar para o repo)

| Diretorio | Conteudo em 2026-07-04 | Uso no plano |
|-----------|------------------------|--------------|
| `/home/misael/Emulation/roms/genesis` | 77 ROMs zipadas: maioria comerciais com traducao PtBr + ~15 homebrews/unlicensed brasileiros | Fonte principal de Tier 1 (homebrew SGDK) e Tier 2 (comercial asm) |
| `/home/misael/Emulation/roms/megadrive` | 3 ROMs: Doom 32X MD+, MK2 MD+, RocketPanda | RocketPanda candidato Tier 1; os MD+/32X sao Tier 3 (fora de escopo) |
| `/home/misael/Emulation/roms/megadrivejp` | vazio (so metadata) | Monitorado; triagem dinamica quando receber ROMs |
| `/home/misael/Emulation/roms/genesiswide` | vazio (so metadata) | Monitorado; hacks widescreen nao sao alvo de match |

Regras:
- Os caminhos acima sao **insumo local do host atual**, passados por configuracao (`RDS_ROM_LIBRARY_DIRS`, lista separada por `:`), nunca hardcoded em codigo de produto.
- Os arquivos `metadata.txt` (ES-DE) podem enriquecer a triagem com titulo/descricao; parsing best-effort, nunca obrigatorio.
- ROM zipada e aceita (`.zip` com `.md/.gen/.bin` interno); o loader canonico ja resolve isso ou sera estendido na Fase 0.

### 2.2 Corpus SGDK local (ground truth)

- Caminho neste host: `/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines` (no host Windows institucional: `F:\Projects\MegaDrive_DEV\SGDK_Engines`).
- 122 projetos catalogados; **68 com C original + ROM compilada e emulacao visivel provada** (validacao rodada 44).
- SGDK 2.11 disponivel em `/mnt/sdcard/Projects/MegaDrive_DEV/sdk/sgdk-2.11` e `toolchains/sgdk` (binarios Windows; ver Fase -1 para Linux).
- Uso: **Tier 0** — como temos o par (C, ROM) verdadeiro, todo o pipeline (Ghidra → funcoes → recompila → object_diff → 100%) e calibravel de forma deterministica e barata, e o corpus de embeddings/few-shot nasce daqui.

### 2.3 Classificacao preliminar da biblioteca (a confirmar pela triagem automatica)

**A triagem automatica decide, nao o nome do arquivo.** A lista abaixo e hipotese inicial para ordenar o trabalho:

| Tier | Criterio | Candidatos provaveis (biblioteca atual) |
|------|----------|------------------------------------------|
| **Tier 0 — Calibracao** | Par (C, ROM) conhecido, toolchain conhecida | Projetos do corpus `SGDK_Engines` (fora da biblioteca de ROMs) |
| **Tier 1 — Matching viavel** | ROM homebrew moderna, assinatura SGDK/GCC detectada | `RocketPanda_Final_1_0`, `Super Spin (Preview)`, `Pigsy Castlevania SotN Demo` (x2), `MegaFinal Fight` (x2), `Windjammers (Pyron) Alpha 8`, `Dino Fighters beta`, `DarkStalkers Demo#70`, `Fatal Fury One v1.5`, `Fatal Fury Rheo Bout` (x2), `RBFFG_vLite2-0`, `Kunio School Fighters beta`, `Guerra dos Monstros`, `Miniplanets REMIX` |
| **Tier 2 — Reconstrucao funcional (asm comercial)** | ROM comercial anos 90, assembly manual; alvo = assets + trace + FSM/nodes + bridges, **sem claim de match C** | Todos os comerciais PtBr: Sonic, Streets of Rage 1-3, Golden Axe 1-3, Shinobi, Vectorman, Aladdin, MUSHA, Monster World IV, etc. Hacks de ROM comercial (`Sonic Delta Reloaded`, `Mortal Kombat Arcade Edition`, `Golden Axe Plus`) tambem sao Tier 2 |
| **Tier 3 — Fora de escopo / hostil** | Hardware fora do alvo, protecao, mapper exotico | `Doom 32X MD+` (codigo SH2 do 32X), `Mortal Kombat II MD+` (audio MD+/MegaSD), `Paprium` (protecao anti-dump + chip custom DT128M16VA1LT) |

Notas honestas:
- `Miniplanets` pode ser assembly artesanal (autor historicamente usa asm); a triagem decide.
- Hacks de jogos comerciais herdam a base assembly do jogo original → Tier 2 por definicao.
- Tier 3 fica **bloqueado por configuracao** (lista negativa) para impedir queima de orcamento acidental.

### 2.4 Prioridade operacional da biblioteca atual

Depois do Tier 0 no corpus SGDK, a fila BYOR deve maximizar aprendizado transferivel:

1. **Primeira fila Tier 1 pequena/barata:** `Guerra dos Monstros (Unl)` (~73 KB), `Miniplanets REMIX` (~148 KB; triagem decide se e C/SGDK ou asm), `Super Spin (Preview Version)` (~170 KB), `DarkStalkers (Demo#70)` (~289 KB), `RocketPanda_Final_1_0` (~390 KB), `Windjammers (Pyrons Layr) Demo Alpha 8` (~491 KB), `Dino Fighters beta` (~591 KB).
2. **Segunda fila Tier 1 maior:** `MegaFinal Fight`, `Pigsy Castlevania SotN Demo`, `Fatal Fury One`, `Fatal Fury Rheo Bout`, `RBFFG_vLite2-0`, `Kunio School Fighters`. Bons para ampliar patterns, mas caros demais para serem a primeira prova.
3. **Tier 2 controlado:** comerciais traduzidos e hacks comerciais (`Sonic`, `Streets of Rage`, `Golden Axe`, `Shinobi`, `MUSHA`, `Sonic Delta Reloaded`, `Mortal Kombat Arcade Edition`) so depois de haver fingerprints/embeddings/ledger maduros; objetivo = assets + trace + FSM/nodes + bridges.
4. **Quarentena/Tier 3 inicial:** `Doom 32X MD+`, `Mortal Kombat II MD+` e `Paprium`. Nao entram na fila automatica enquanto nao houver escopo especifico para 32X/MD+/protecao/chip custom.

Regra de ouro para o agente: se uma ROM famosa parece atraente, mas nao melhora a curva de aprendizado (`one_shot_rate`, `avg_cost_per_function`, `node_coverage`), ela nao e a proxima ROM certa.

---

## 3. TESE DE APRENDIZADO E CURRICULO

O objetivo estrategico nao e "decompilar N ROMs"; e **construir um sistema que aprende**: cada ROM processada deve reduzir o custo da proxima e ampliar a cobertura logica do NodeGraph. Tres mecanismos:

1. **Fingerprint DB (conhecimento exato):** hash de bytes (e hash normalizado, tolerante a relocacao) de todas as funcoes das libs SGDK (todas as versoes que conseguirmos compilar: 1.62/1.7x/1.8/2.11) e das funcoes ja pareadas. Em ROM nova, resolve biblioteca inteira sem LLM.
2. **Embedding store (conhecimento aproximado):** exemplos (assembly ↔ C pareado) indexados por similaridade para few-shot. Nasce do Tier 0 (corpus) e cresce com cada match novo.
3. **Pattern → Node library (conhecimento estrutural):** padroes semanticos reconhecidos (FSM, input handling, animacao, movimento, scroll, colisao AABB, spawn/destroy, timer, audio trigger) mapeados para o vocabulario de nodes existente do `NodeGraphEditor`/`nodeCompiler.ts`. Cada padrao sem node correspondente vira item de backlog do vocabulario de nodes — e assim a decompilacao alimenta diretamente a meta de producao de jogos sem codigo.

### 3.1 Curriculo (ordem obrigatoria de execucao)

```
Etapa A (Tier 0): 3 projetos pequenos do corpus (ex.: "Adding Music", "Animation
         Control", um hello-world) → certificar pipeline Ghidra→diff determinístico,
         SEM LLM no caminho critico.
Etapa B (Tier 0): 10+ projetos do corpus com LLM ligado em modo barato → medir taxa
         de one-shot, calibrar prompts/feedback, popular embeddings + fingerprints.
Etapa C (Tier 1): 1 homebrew simples da biblioteca (ex.: Super Spin Preview ou
         RocketPanda) → primeira ROM sem fonte; meta >=60% funcoes resolvidas
         (fingerprint + match) na primeira passada.
Etapa D (Tier 1): 3+ homebrews adicionais → meta >=80% em pelo menos 1; medir curva
         de aprendizado (custo/funcao deve cair entre ROMs).
Etapa E (Tier 2): 1 comercial bem documentado (ex.: Sonic 1 PtBr — existe disasm
         comunitario publico para usar como baseline de VALIDACAO de fronteiras de
         funcao, sem importar codigo) → assets + trace + FSM/nodes, claim de
         reconstrucao funcional apenas.
Etapa F: consolidacao → relatorio de aprendizado, Node Coverage Index, backlog de
         nodes, decisao de promocao Experimental → Em hardening.
```

Regra dura: **nao pular etapa**. A etapa seguinte so abre quando a metrica de saida da anterior for registrada no relatorio de conhecimento (secao 8).

---

## 4. ARQUITETURA GERAL (v2)

```
ROM (.md/.gen/.bin/.sfc/.zip)
    │
    ├──▶ [TRIAGE] ────────────▶ tier, toolchain provavel, assinatura SGDK, mapper,
    │                           tamanho, riscos → decide o caminho e o orcamento
    │
    ├──▶ [GHIDRA HEADLESS] ───▶ Funcoes, CFG, assembly, structs, strings, xrefs
    │         │
    │         └─▶ [FINGERPRINT] ─▶ funcoes de lib SGDK resolvidas sem LLM
    │
    ├──▶ [EMULADOR LIBRETRO] ──▶ PCs executados, VRAM/CRAM/SAT dump, audio, inputs
    │
    ├──▶ [KNOWLEDGE BASE] ─────▶ fingerprints + embeddings + pattern→node library
    │
    └──▶ caminho por tier:
          Tier 0/1 ─▶ [LLM LOOP] ─▶ C candidato → compila → object_diff
          │                │ match 100% → MatchExact
          │                │ sem toolchain exata → parity_harness → MatchFunctional
          │                └─ feedback (Markdown) → nova iteracao (com teto)
          │
          Tier 2 ──▶ [TRACE + PATTERN MINING] ─▶ FSM/behaviors + assets
          │            (sem claim de match; bridges asm anotadas)
          ▼
    C pareado / comportamento reconstruido + Assets extraidos
          │
          ▼
    PROJECAO UGDM (.rds) — nodes onde ha padrao reconhecido, bridge no resto
          │
          ▼
    EXPORTACAO SGDK (projeto compilavel) + Node Coverage Report
```

### 4.1 Niveis de verificacao (novo na v2)

| Nivel | Verificador | Claim permitido |
|-------|-------------|------------------|
| `MatchExact` | `object_diff` byte-a-byte no `.o`, toolchain identica | "funcao pareada" |
| `MatchFunctional` | `parity_harness.rs` canonico: mesmo estado (framebuffer hash, RAM/VRAM/CRAM relevantes) apos N frames com script de input deterministico, comparando ROM original vs ROM reconstruida | "funcao/modulo funcionalmente equivalente" — **nunca** "pareada" |
| `Bridge` | nenhum | codigo original preservado como asm/C anotado; sempre rotulado |

O `parity_harness` ja existe e e canonico (rodada 77). A decompilacao **consome** esse harness; nao cria comparador proprio de runtime.

---

## 5. FASES E TAREFAS

### Fase -1 — Host Readiness (pre-requisito, alinhada ao docs/11)

**Objetivo:** os gates minimos e as ferramentas externas do pipeline funcionam no host ativo (Linux hoje; Windows institucional continua suportado).

| Item | Linux (este host) | Windows |
|------|-------------------|---------|
| Ghidra | `sudo pacman -S ghidra` (12.1.2-1 no repo extra; puxa JDK como dependencia) ou tarball oficial + `RETRODEV_GHIDRA_HOME` | Tarball oficial + `RETRODEV_GHIDRA_HOME` |
| JDK 21+ | **Host tem OpenJDK 17** (Ghidra 12 exige 21). `sudo pacman -S jdk21-openjdk` e apontar Ghidra para ele | `toolchains/jdk` ou Temurin 21 |
| `m68k-elf-binutils` | **Presente** (2.46.1, tem `m68k-elf-as`) | via SGDK |
| `m68k-elf-gcc` | **AUSENTE e nao ha no repo oficial.** Rotas: (a) AUR (`paru -S m68k-elf-gcc`, `yay`/`paru` presentes); (b) Marsdev (build script community); (c) build do gcc-m68k do fonte; (d) fallback: `gcc.exe` do SGDK via WINE. **Bloqueia todo `MatchExact` que recompila** ate resolver | `toolchains/sgdk/bin/gcc.exe` (nativo) |
| `sjasm`/`sjasmplus` | **AUSENTE.** Build do fonte (necessario para o caminho Z80 do SGDK) | via SGDK |
| SGDK 2.11 | `common.mk` ja tem branch Linux (usa `m68k-elf-*` do PATH + JRE). Corpus e SDK locais presentes | `toolchains/sgdk` (binarios `.exe`) |
| Cores Libretro | **So `.dll` Windows** em `toolchains/libretro/cores`. Baixar `.so` Linux (Genesis Plus GX) do buildbot. **Bloqueia Fase 1 (assets) e `MatchFunctional`** ate resolver | `.dll` presentes |
| WebDriver | `chromedriver` (pacman) para E2E, quando aplicavel | `msedgedriver` |
| `node_modules` | **Ja reinstalado p/ Linux** (`@rollup/rollup-linux-x64-gnu` presente) | `win32-x64` |
| `tauri.conf.json` | **Ja corrigido** (`beforeDevCommand: "npm run dev"`, sem `cmd /c`) | original |

> **Atualizacao de provisionamento (2026-07-06):** a tabela acima e o diagnostico historico de 2026-07-04 (antes de qualquer instalacao). Desde entao, `m68k-elf-gcc` 16.1.0 (AUR), `genesis_plus_gx_libretro.so` (buildbot oficial) e **Ghidra 12.1.2 + jdk21-openjdk (repo oficial Arch `extra`, via `sudo pacman -S`)** foram instalados com autorizacao explicita, cada instalacao registrada em `scripts/decomp/README.md`. `sjasm`/`sjasmplus` e um segundo core Libretro (para cross-core) continuam ausentes/pendentes.

**Gate Fase -1 (Linux):** `npm run check:tree`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `cargo clippy --lib -- -D warnings`, `cargo test --lib -- --nocapture --test-threads=1` verdes; `ghidra` e `jdk21` instalados e detectaveis; `m68k-elf-gcc` resolvido por uma das rotas acima; pelo menos `genesis_plus_gx_libretro.so` presente. Sem esse gate, o pipeline abaixo roda apenas no modo estatico.

> **Status de provisionamento (2026-07-05, comprovado):** `m68k-elf-gcc` 16.1.0 instalado via AUR (build em background + install foreground por `bigsudo`/pkexec) e `genesis_plus_gx_libretro.so` (buildbot) presente em `toolchains/libretro/cores/`. **Fase 2b desbloqueada:** build duplo reproduzivel provado 5/5 (rom.bin byte-identico entre builds independentes; ver `~/.retrodev/decomp_work/PHASE2B_DOUBLE_BUILD.md`). Ghidra + JDK21 seguem opcionais/pendentes (so afetam Ghidra export e boundary precision/recall). Notas: SGDK `libmd.a` release e LTO-13 (incompativel com gcc16) → usar debug `libmd_debug.a`; gcc14+ exige `-fpermissive` para o corpus legado; `convsym`/`padROM` nativos do SGDK ainda faltam no Linux (rodam apos o rom.bin).

**Consequencia na ordem de execucao (critica para este host):**
- **Funciona hoje no Linux, sem cross-gcc nem cores `.so`:** triagem, Ghidra headless (analise estatica), Fingerprint DB a partir de artefatos ja compilados do corpus, `object_diff` em nivel de disassembly, Embedding store, ROM library scanner, ledger, scaffolding do orquestrador. → **Fase 0 comeca primeiro.**
- **Precisa de `m68k-elf-gcc`:** recompilar C → `.o` para `MatchExact` (Tier 0 self-compare e candidatos Tier 1). → depende do bootstrap.
- **Precisa de core `.so`:** Fase 1 (extracao de assets) e `MatchFunctional` via `parity_harness`. → depende do bootstrap.
- **Nenhuma dependencia nova entra no binario do app.** Ghidra, JDK21, cross-gcc, sjasm e cores sao ferramentas externas (BYOR / instalacao sob demanda), refletidas em `docs/02_TECH_STACK.md` antes de qualquer uso.

---

### Fase 0 — Nucleo do pipeline (modo estatico primeiro)

**Arvore canonica (docs/08):** todo o nucleo novo vive em `src-tauri/src/tools/reverse/decomp/`, nao em modulos paralelos em `tools/`.

```
src-tauri/src/tools/reverse/decomp/
├── mod.rs              # re-exports + orquestrador de sessao
├── triage.rs           # 0.1 — classifica ROM: tier, toolchain provavel, mapper, riscos
├── rom_library.rs      # 0.2 — scanner dos dirs BYOR + corpus, dedup por sha256, ledger, fila de curriculo
├── ghidra_bridge.rs    # 0.3 — invoca Ghidra headless, parseia JSON
├── fingerprint.rs      # 0.4 — DB de hashes de funcoes de lib SGDK e funcoes ja pareadas
├── object_diff.rs      # 0.5 — comparador .o/disasm byte-a-byte + feedback markdown
├── llm_decomp.rs       # 0.6 — cliente LLM + prompt engine + governanca de orcamento
├── embedding_search.rs # 0.7 — few-shot por similaridade
└── decomp_orch.rs      # 0.8 — loop por funcao, tiers, MatchExact/MatchFunctional, ledger
```
`scripts/ghidra_export.py` — script Jython rodado pelo Ghidra headless.

Config recomendada para o scanner local:

```bash
export RDS_ROM_LIBRARY_DIRS="/home/misael/Emulation/roms/megadrive:/home/misael/Emulation/roms/megadrivejp:/home/misael/Emulation/roms/genesis:/home/misael/Emulation/roms/genesiswide"
```

**0.1 `triage.rs`** — decide o caminho e o orcamento antes de gastar LLM.
- Entrada: ROM (resolve `.zip`). Detecta target/mapper/tamanho, procura assinatura SGDK/GCC (strings de runtime, padroes de prologo GCC m68k), estima nº de funcoes via Ghidra.
- Saida: `TriageReport { tier, likely_toolchain, sgdk_signature: bool, mapper, size, risks, recommended_path, budget_cap }`.
- Tier 3 e lista negativa entram bloqueados (`out_of_scope`), sem gasto.
- Testes: `triage_flags_32x_as_out_of_scope`, `triage_detects_sgdk_signature`, `triage_assigns_commercial_to_tier2`.

**0.2 `rom_library.rs`** — o motor de curriculo.
- Escaneia `RDS_ROM_LIBRARY_DIRS` (BYOR) + corpus SGDK. Descompacta para `~/.retrodev/decomp_work/` (fora do repo), dedup por SHA-256, le `metadata.txt` best-effort.
- Classifica `provenance: {homebrew_src | homebrew_bin | commercial}` e `redistributable: bool` (so `homebrew_src` exporta exemplos).
- Emite `CurriculumQueue` ordenada por tier/dificuldade e mantem `DecompLedger` (`~/.retrodev/decomp_work/ledger.json`): por ROM → status, funcoes pareadas, custo, one-shot rate, node coverage. Base para retomar e para o relatorio da secao 8.
- Testes: `rom_library_ranks_homebrew_before_commercial`, `rom_library_dedupes_by_hash`, `ledger_persists_and_resumes`, `rom_library_marks_commercial_non_redistributable`.

**0.3 `ghidra_bridge.rs`** + `ghidra_export.py` — abre ROM, roda auto-analise, exporta funcoes (limites, assembly, bytes, stack frame, calls/called_by, signature), structs, strings e call graph para JSON. Cachear por `{rom_hash}.ghidra.json`. Requer Ghidra + JDK21 (Fase -1).
- Testes: `ghidra_bridge_parses_export_json`, `ghidra_bridge_handles_missing_ghidra`.

**0.4 `fingerprint.rs`** — entregavel de primeira classe. Hash de bytes + hash normalizado (tolerante a relocacao) de funcoes das libs SGDK que conseguirmos compilar (1.62/1.7x/1.8/2.11) e de toda funcao ja pareada. Em ROM nova, resolve a biblioteca inteira sem LLM e ancora fronteiras de funcao.
- Testes: `fingerprint_matches_known_sgdk_function`, `fingerprint_normalized_survives_relocation`.

**0.5 `object_diff.rs`** — compara `.o`/disasm byte-a-byte, gera `ObjectDiffResult { match_percent, mismatches, markdown_report }` com sugestoes acionaveis (register mismatch, struct offset, branch target, constante). No Linux sem cross-gcc, opera no modo disasm-vs-disasm (Ghidra do candidato vs Ghidra do original); com cross-gcc, compara `.o` reais.
- Testes: `object_diff_identical`, `object_diff_reports_register_mismatch`, `object_diff_reports_struct_offset`, `object_diff_valid_markdown`.

**0.6 `llm_decomp.rs`** — cliente LLM + prompt engine (system/user templates de matching decompilation) + **governanca de orcamento**: teto por funcao/ROM/sessao, ledger de custo, kill-switch, BYOK via env, opcao de modelo local. Nunca envia disasm de ROM `commercial` para API externa sem opt-in explicito.
- Testes: `llm_builds_valid_prompt`, `llm_respects_budget_cap`, `llm_blocks_commercial_without_optin`, `llm_handles_api_error`.

**0.7 `embedding_search.rs`** — indexa pares (assembly ↔ C pareado) e busca top-K por similaridade para few-shot. Cache em `~/.retrodev/decomp_embeddings/`. Nasce do Tier 0.
- Testes: `embedding_exact_match`, `embedding_similarity_ranking`, `embedding_persist_load_idempotent`.

**0.8 `decomp_orch.rs`** — loop por funcao com prioridade (chamadas por main, runtime SGDK via fingerprint = gratis, alta similaridade, funcoes pequenas, structs resolvidas, complexas por ultimo), status por funcao (`Pending/InProgress/MatchExact/MatchFunctional/Bridge/Blocked`), roteamento por tier, e persistencia no ledger para retomar.
- Testes: `orch_prioritizes_runtime_matches_first`, `orch_completes_simple_function`, `orch_caches_progress_and_resumes`, `orch_routes_tier2_to_functional`.

---

### Fase 1 — Extracao de assets via emulador (gated: core `.so`)

Reusa `src-tauri/src/emulator/libretro_ffi.rs` (que ja expoe `audio_buffer` e captura de estado da rodada 77) e `src-tauri/src/tools/reverse/graphics.rs`/`audio.rs`.

- **1.1 VRAM/CRAM/SAT/plane dump** — hook a cada N frames: VDP registers, tile patterns, CRAM, SAT decodificada, plane A/B/window. Requer core que exponha `retro_get_memory_data(VIDEO_RAM)` (Genesis Plus GX expoe).
- **1.2 Reconstrucao de sprites** — agrupa SAT + tiles + flip + paleta → PNG; detecta frames de animacao por mudanca de pattern.
- **1.3 Audio** — WAV do `audio_buffer` (ja possivel), VGM via hook YM2612, deteccao de driver (XGM/SMPS/GEMS).
- Testes: `vram_decodes_tilemap`, `reconstruct_sprite_builds_image`, `audio_wav_valid_header`, `audio_detects_driver_signature`.

Enquanto nao houver `.so` Linux, esta fase fica **Blocked** no host atual (marcada no ledger), sem mascarar como pendente silenciosa.

---

### Fase 2 — Loop de matching + reconstrucao Tier 2

- **2.1 Priorizacao de ROM e de funcao** — a fila de ROMs vem do `rom_library` (curriculo por tier); dentro da ROM, `decomp_orch` prioriza funcoes conforme 0.8. **Regra de aceleracao:** apos cada ROM, recomputar `one_shot_rate` e `avg_cost_per_function` (secao 8); se nao melhora ao longo do tier, corrigir o motor (embeddings/fingerprint/pattern) antes de gastar na proxima ROM.
- **2.2 Estrategia de prompts por complexidade** — `estimate_complexity()` por tamanho/branches/calls/jump tables define max iteracoes e teto de tokens (trivial one-shot → muito complexa ate 50 iteracoes com teto).
- **2.3 Struct recovery** (`struct_recovery.rs`) — infere structs por padrao `deslocamento(registrador)`, refina por feedback do object_diff, agrupa funcoes por struct; UI de anotacao manual reusa o annotation system existente.
- **2.4 Tier 2 — pattern mining (sem claim de match)** — para ROM comercial (assembly artesanal): trace dinamico + mineracao de padroes → FSM/behaviors + assets; funcoes viram `Bridge` anotada. Verdade = `MatchFunctional` via `parity_harness`, nunca `MatchExact`.
- Testes: `struct_recovery_infers_from_access`, `struct_recovery_refines_from_diff`, `complexity_estimation_bands`, `tier2_never_claims_matchexact`.

---

### Fase 3 — Projecao UGDM + cobertura de NodeGraph

**Arquivo a implementar:** `src-tauri/src/tools/reverse/projection.rs` (hoje retorna `supported: false`).

- Tilemaps extraidos → `Scene` + `TilemapComponent`; sprites → `Entity` + `SpriteComponent` + animacoes.
- Funcao decompilada com padrao reconhecido → nodes reais via o vocabulario ja declarado em `NodeGraphEditor.tsx`/`nodeCompiler.ts` (FSM, input, movimento, animacao, camera, timer, spawn, audio, tilemap, hardware budget). Sem padrao → `bridge_unconverted_source` com C/asm preservado.
- **Pattern → Node library**: cada padrao recorrente sem node correspondente vira item de backlog do vocabulario de nodes (secao 8, Node Coverage Index). Assim a decompilacao alimenta diretamente a meta de producao sem codigo.
- **Analise via nodes** (nao so construcao): o mesmo grafo alimenta a visao "grafo de logica" do ReverseWorkspace para *ler* um jogo importado.
- Limite honesto: ate a pattern library crescer, a maioria das funcoes complexas continua bridge; `node_coverage` sobe ao longo dos tiers, nao e um estado "pronto".

---

### Fase 4 — Exportacao SGDK compilavel

`export_sgdk_project()` gera `Makefile` + `src/` (C decompilado) + `res/rescomp.txt` + `inc/structs.h` + `assets/` (sprites/tilemaps/audio) + `build/`.
- Validacao: `make` → `.bin`/`.md`; roda no emulador integrado (framebuffer visivel); se o hash da ROM gerada bater com a original → **decompilacao pareada completa** daquela ROM.
- Testes: `export_sgdk_project_layout`, `exported_project_compiles` (gated: cross-gcc), `roundtrip_rom_hash_when_exact`.

---

### Fase 5 — Frontend Reverse Workspace v2

Modificar `src/components/tools/ReverseWorkspace.tsx` e `src/core/ipc/toolsService.ts`. Abas novas, todas **Experimental**: **Library/Curriculum** (fila por tier, ledger, KPIs), **Decomp** (funcoes com status/log/progresso), **Sprites**, **Tilemaps**, **Audio**, **Export**. Erros sempre acionaveis; nada anuncia sucesso sem backend confirmado.

---

## 6. CONTRATO IPC (definir cedo p/ paralelismo)

Comandos Tauri novos em `src-tauri/src/lib.rs` + wrappers em `src/core/ipc/toolsService.ts`:

```typescript
// Biblioteca / curriculo
export function decompScanLibrary(dirs: string[]): Promise<CurriculumQueue>;
export function decompLedger(): Promise<DecompLedger>;
export function decompTriage(romPath: string): Promise<TriageReport>;
// Sessao de decompilacao
export function decompStart(romPath: string): Promise<DecompSession>;
export function decompStatus(sessionId: string): Promise<DecompSession>;
export function decompProcessNext(sessionId: string): Promise<DecompFunctionStatus>;
export function decompResolveStructs(sessionId: string, structDefs: string): Promise<void>;
export function decompExportProject(sessionId: string, outputDir: string): Promise<string>;
export function decompExportSgdk(sessionId: string, outputDir: string): Promise<string>;
// Extracao de assets (gated: core .so)
export function extractSprites(romPath: string): Promise<ExtractedSprite[]>;
export function extractTilemaps(romPath: string): Promise<Tilemap[]>;
export function extractAudioRom(romPath: string, outputDir: string): Promise<AudioExtraction[]>;
```
`DecompSession.functions[].status` inclui `match_exact | match_functional | bridge | blocked` (alinhado a 4.1).

---

## 7. ARQUIVOS A CRIAR / MODIFICAR

**Criar** (todos sob `src-tauri/src/tools/reverse/decomp/`, exceto o script): `triage.rs`, `rom_library.rs`, `ghidra_bridge.rs`, `fingerprint.rs`, `object_diff.rs`, `llm_decomp.rs`, `embedding_search.rs`, `decomp_orch.rs`, `struct_recovery.rs`; e `scripts/ghidra_export.py`.
**Modificar:** `src-tauri/src/tools/reverse/mod.rs` (registrar `pub mod decomp`), `projection.rs` (implementar projecao/export), `graphics.rs`/`audio.rs` (reconstrucao), `emulator/libretro_ffi.rs` (captura VRAM/YM2612), `lib.rs` (+comandos), `toolsService.ts` + `ReverseWorkspace.tsx` (abas). Reusar `parity_harness.rs` (nao duplicar verificador de runtime).

---

## 8. RELATORIO DE CONHECIMENTO E METRICAS DE APRENDIZADO

O ledger e o painel Library/Curriculum expoem, por tier e agregado — este e o criterio objetivo do "avancar mais rapido":

| Metrica | Significado | Direcao esperada |
|---------|-------------|------------------|
| `one_shot_rate` | % de funcoes pareadas na 1ª iteracao | **sobe** com o corpus |
| `avg_iterations_per_match` | iteracoes medias ate match | **cai** |
| `avg_cost_per_function` | custo LLM medio por funcao | **cai** |
| `runtime_match_rate` | % resolvido de graca por fingerprint SGDK | **sobe** |
| `corpus_size` | nº de exemplos no embedding store | **cresce** |
| `node_coverage` (Node Coverage Index) | % de funcoes pareadas convertidas em nodes (vs bridge) | **sobe** |

Se `one_shot_rate` sobe e `avg_cost_per_function` cai ao longo dos tiers, o motor esta de fato aprendendo. A abertura de cada etapa do curriculo (secao 3.1) exige registrar a metrica de saida da etapa anterior aqui.

---

## 9. TESTES E GATES

- Testes unitarios por modulo conforme as Fases 0-4 acima (todos `cargo test --lib`).
- Gate por etapa do curriculo: T0 (self-compare 100% em ≥10 projetos; ≥500 funcoes indexadas), T1 (≥80% match em ≥10 projetos; one-shot crescente), Tier 1 biblioteca (≥1 homebrew >60% resolvido + roda no emulador), Tier 2 (assets+trace+FSM sem violacao de compliance).
- Barra minima do projeto sempre verde: `check:tree`, `lint`, `tsc --noEmit`, `npm test`, `cargo clippy -- -D warnings`, `cargo test --lib`.
- Promocao `Experimental → Em hardening` exige: ≥10 ROMs Tier 0/1 com >80% funcoes resolvidas, ≥3 projetos SGDK exportados que compilam e rodam, extracao de sprites validada visualmente em ≥5 ROMs, e curva de aprendizado (secao 8) comprovadamente favoravel.

---

## 10. CUSTO DE LLM E GOVERNANCA

| Item | Estimativa |
|------|------------|
| Tokens/funcao media | ~4000 |
| Iteracoes media/funcao | ~5 (cai com o corpus) |
| Funcoes/ROM SGDK tipica | ~500 (menos as resolvidas por fingerprint) |
| Custo/ROM (modelo premium) | ~$30-$80 |
| Custo/ROM (modelo economico) | ~$5-$15 |

Fingerprint (runtime SGDK) e cache de funcoes repetidas reduzem drasticamente o custo real. **Teto por sessao/ROM + kill-switch + BYOK** sao obrigatorios (0.6). Disasm de ROM `commercial` so vai para API externa com opt-in explicito.

---

## 11. RISCOS E MITIGACOES

| Risco | Mitigacao |
|-------|-----------|
| `m68k-elf-gcc` ausente no Linux | Bootstrap (Fase -1); ate la, modo disasm-vs-disasm e Tier 0 por artefatos existentes |
| Core `.so` ausente | Fase 1 e `MatchFunctional` ficam `Blocked` no ledger, sem mascarar |
| ROM comercial nunca dara `MatchExact` | Rotear para Tier 2 (`MatchFunctional`/bridge) desde a triagem; nunca prometer match |
| Ghidra quebra com mapper exotico | Fallback para disasm limitado + marcar `non_decompilable` |
| LLM nao converge | Teto de iteracoes/orcamento → vira bridge |
| Struct recovery erra e bloqueia cadeia | UI de anotacao manual (annotation system existente) |
| Custo inviavel | Fingerprint agressivo, cache, modelo economico default, BYOK |
| Compliance | ROM nunca no repo; so `homebrew_src` exporta exemplos; opt-in p/ comercial |

---

## 12. DECISOES ARQUITETURAIS CONSOLIDADAS (v2)

1. **Ground-truth-first:** calibrar todo o pipeline no corpus SGDK (par C↔ROM conhecido) antes de gastar LLM em ROM sem fonte.
2. **Curriculo por tier obrigatorio:** nao pular etapa; cada ROM deve baratear a proxima e ampliar o vocabulario de nodes.
3. **Dois niveis de verificacao:** `MatchExact` (object_diff) e `MatchFunctional` (parity_harness canonico). ROM comercial nunca reivindica `MatchExact`.
4. **Fingerprint do runtime SGDK e entregavel de primeira classe** (resolve 30-60% sem LLM).
5. **Nucleo em `tools/reverse/decomp/`** — arvore canonica, sem modulos paralelos.
6. **Reusar `parity_harness`, `libretro_ffi`, `build_orch`, `nodeCompiler`** — nao duplicar.
7. **Sem dependencia nova de runtime no app;** Ghidra/JDK/cross-gcc/cores/LLM sao externos, refletidos em `docs/02`.
8. **A decompilacao serve a cobertura de nodes;** o entregavel de produto e o Node Coverage Index subindo, rumo a construcao/analise/producao de jogos sem codigo.

---

## 13. REFERENCIAS

- **Metodologia:** "Retro Game Decompilation Using AI" (Macabeus / Codeminer42) — matching decompilation com LLM + comparacao de objetos.
- **Ferramentas:** Ghidra (NSA), decomp.me, m2c, Marsdev (toolchain m68k Linux). **Nota M68K:** a comparacao byte-a-byte de M68K deste plano usa o comparador proprio `object_diff.rs` sobre `m68k-elf-binutils` (objdump/objcopy), **comprovado** para M68K (spike `m68k_fp`/`m68k_spike`). Nao assumir que o `objdiff` externo (decomp.me) suporta M68K — sua compatibilidade M68K nao foi provada e nao e dependencia deste plano.
- **Arquitetura existente do RDS:** `src-tauri/src/tools/reverse/`, `asset_extractor.rs`, `emulator/libretro_ffi.rs`, `compiler/build_orch.rs`, `compiler/sgdk_emitter.rs`, `parity_harness.rs`, `src/components/nodegraph/NodeGraphEditor.tsx`, `src/core/nodegraph/nodeCompiler.ts`.
- **Corpus SGDK:** 122 projetos catalogados, 68 com build/ROM real — `/mnt/sdcard/Projects/MegaDrive_DEV/SGDK_Engines` (Linux) / `F:\Projects\MegaDrive_DEV\SGDK_Engines` (Windows institucional).
- **Biblioteca BYOR local:** `/home/misael/Emulation/roms/{megadrive,megadrivejp,genesis,genesiswide}`.

---

## APENDICE A — PROMPT DE ARRANQUE DO AGENTE EXECUTOR

> Colar como primeira mensagem para o agente que vai implementar. Ele cobre infra → dependencias → decompilacao → aprendizado, em ordem, com gates e compliance.

```
Voce vai implementar, de forma incremental e honesta, a superficie Experimental de
Decompilacao Pareada do RetroDev Studio, seguindo docs/12_DECOMPILACAO_PAREADA_PLANO.md
(v2). NAO antecipe fases nem declare pronto o que os gates nao sustentam.

CONTEXTO OBRIGATORIO (leia antes de qualquer codigo, nesta ordem):
  docs/06_AI_MEMORY_BANK.md, docs/06_CURRENT_WAVE_AI_BANK.md, docs/03_ROADMAP_MVP.md,
  docs/08_TREE_ARCHITECTURE.md, docs/09_AGENT_DEV_MODE.md, docs/11_CROSS_PLATFORM_PLAN.md,
  docs/12_DECOMPILACAO_PAREADA_PLANO.md.
Responda "[Contexto Carregado]" + um plano curto antes de escrever codigo.

REGRAS DURAS:
  - Nucleo novo SOMENTE em src-tauri/src/tools/reverse/decomp/. Nada de modulo paralelo.
  - Nenhuma dependencia nova de runtime no binario do app. Ghidra/JDK/cross-gcc/cores/LLM
    sao ferramentas externas; se adotar alguma, atualize docs/02_TECH_STACK.md e peca
    aprovacao antes.
  - Compliance BYOR: ROM nunca entra no repo. Trabalho em ~/.retrodev/decomp_work/.
    So material 'homebrew_src' pode gerar exemplos exportaveis. Disasm de ROM comercial
    so vai para API externa com opt-in explicito.
  - Toda superficie nova nasce Experimental, com erro acionavel e sem claim inflado.
  - Barra minima verde a cada entrega: npm run check:tree; npm run lint; npx tsc --noEmit;
    npm test; cargo clippy --lib -- -D warnings; cargo test --lib -- --nocapture --test-threads=1.

SPRINT 0 — HOST READINESS (Fase -1) + REGISTRO DE BLOQUEIOS:
  1. Diagnosticar, antes de instalar qualquer coisa: ghidra/analyzeHeadless, java --version,
     m68k-elf-gcc, m68k-elf-as, sjasm/sjasmplus, genesis_plus_gx_libretro.so, SGDK local,
     corpus SGDK_Engines e node_modules Linux.
  2. Se faltar dependencia externa, registre a rota: Ghidra 12 + JDK 21, m68k-elf-gcc
     (AUR/Marsdev/build do fonte/SGDK via WINE), core .so oficial do buildbot Libretro.
     Nao use sudo/AUR/download binario sem autorizacao humana explicita.
  3. Rodar a barra minima possivel no Linux e registrar o que passou/bloqueou.
  4. Entregavel: relatorio de host readiness + plano de bootstrap. Faltas de m68k-elf-gcc
     ou core .so bloqueiam MatchExact/Assets/MatchFunctional, mas NAO bloqueiam o Sprint 1
     estatico.

SPRINT 1 — NUCLEO ESTATICO (Fase 0), sem LLM e sem UI, na ordem:
  rom_library.rs (scanner+ledger+curriculo) → triage.rs → ghidra_bridge.rs (+ghidra_export.py)
  → fingerprint.rs → object_diff.rs (modo disasm) → embedding_search.rs → decomp_orch.rs
  (scaffold). Cada modulo com seus testes cargo. Use:
  RDS_ROM_LIBRARY_DIRS=/home/misael/Emulation/roms/megadrive:/home/misael/Emulation/roms/megadrivejp:/home/misael/Emulation/roms/genesis:/home/misael/Emulation/roms/genesiswide
  Scanear a biblioteca BYOR e o corpus SGDK; produzir CurriculumQueue e DecompLedger.
  Primeira fila apos Tier 0: Guerra dos Monstros, Miniplanets, Super Spin, DarkStalkers,
  RocketPanda, Windjammers, Dino Fighters. Nao ligar LLM ainda.

SPRINT 2 — TIER 0 (ground truth). Comece por 3 projetos pequenos do corpus SGDK_Engines
  (ex.: 'Adding Music', 'Animation Control', um hello-world): Ghidra → recompila C original
  → object_diff deve dar 100% (self-compare). Popular fingerprints + embeddings. Depois
  ligue o LLM em modo barato/BYOK com teto, em 10+ projetos, e meça one_shot_rate. Registre
  as metricas da secao 8 no ledger. Gate T0/T1 antes de avancar.

SPRINT 3 — TIER 1 (primeira ROM sem fonte). RocketPanda_Final_1_0 ou um homebrew pequeno do
  dir genesis (Super Spin, Guerra dos Monstros, Miniplanets). Meta: >=60% funcoes resolvidas
  (fingerprint+match) na 1a passada; provar que o corpus dos sprints anteriores acelerou
  (custo/funcao menor). Se a metrica nao melhora, conserte o motor antes da proxima ROM.

SPRINT 4+ — ASSETS (Fase 1, quando core .so existir), TIER 2 (reconstrucao funcional de
  comercial via parity_harness, sem claim de match), PROJECAO/NODES (Fase 3, alimentar o
  Node Coverage Index) e EXPORT SGDK (Fase 4). Frontend (Fase 5) quando os comandos IPC
  estiverem estaveis.

A CADA SPRINT: rode os gates, atualize o ledger e as metricas da secao 8, atualize
docs/06_CURRENT_WAVE_AI_BANK.md e docs/03_ROADMAP_MVP.md se o estado real mudou, e faca
commit coerente. Uma ROM so "avanca" o curriculo quando a metrica de saida esta registrada.
Prefira estado honesto e testado a aparencia de avanco.
```
