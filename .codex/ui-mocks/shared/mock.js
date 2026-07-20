const $ = (value) => value;

const icon = (name, {decorative = true, className = ""} = {}) =>
  `<span class="rds-icon rds-icon-${name} ${className}" ${decorative ? 'aria-hidden="true"' : ''}></span>`;

const workspaceMeta = {
  SC: ["Scene", "view-columns-3"], GM: ["Game", "gamepad"], EX: ["Explorer", "folder"],
  LG: ["Logic", "network"], AT: ["Art Studio", "palette"], FX: ["RetroFX", "sparks"], DB: ["Debug", "bug"],
};

const iconButton = (name, label, action, pressed = false) =>
  `<button class="button ghost icon-button" type="button" data-action="${action}" aria-label="${label}" title="${label}" ${pressed ? 'aria-pressed="true"' : ''}>${icon(name)}</button>`;

const rail = (active = "SC") => `
  <aside class="rail" aria-label="Workspaces">
    <div class="rail-label">CORE</div>
    ${["SC","GM","EX"].map(id => `<button class="rail-item ${active===id?"active":""}" aria-label="${workspaceMeta[id][0]}" title="${workspaceMeta[id][0]}">${icon(workspaceMeta[id][1])}</button>`).join("")}
    <div class="rail-label">AUT.</div>
    ${["LG","AT","FX"].map(id => `<button class="rail-item ${active===id?"active":""}" aria-label="${workspaceMeta[id][0]}" title="${workspaceMeta[id][0]}">${icon(workspaceMeta[id][1])}</button>`).join("")}
    <div class="rail-label">DEBUG</div>
    <button class="rail-item ${active==="DB"?"active":""}" aria-label="Debug" title="Debug">${icon("bug")}</button>
  </aside>`;

const topbar = ({blocked=false}={}) => `
  <header class="topbar">
    <button class="button ghost icon-button" aria-label="Menu principal" title="Menu principal">${icon("menu")}</button>
    <div class="brand">RETRODEV STUDIO</div>
    <div class="project-path">QA_RC_SGDK / scenes/main.json</div>
    <select class="select" aria-label="Plataforma"><option>MD</option></select>
    <button class="button ${blocked?"danger":"success"}">${icon(blocked?"warning-triangle":"play")}${blocked?"Build bloqueado":"Build & Run"}</button>
    <button class="button ghost">${icon("play")}Play</button>
    <button class="button ghost">${icon("square")}Parar</button>
    <span class="chip ${blocked?"danger":"success"}">${blocked?"2 correções":"Pronto"}</span>
    <div class="topbar-spacer"></div>
    <span class="chip optional-label">VRAM 5 / 64 KB</span>
    <button class="button ghost optional-label">${icon("maximize")}Foco</button>
    <button class="button ghost">${icon("terminal")}Console</button>
    <button class="button ghost icon-button" aria-label="Mais ações" title="Mais ações">${icon("more-horiz")}</button>
  </header>`;

const status = (mode="warning") => `
  <footer class="statusbar">
    <div class="status-message"><span class="dot ${mode}"></span> ${mode==="danger"?"Build bloqueado: o Runtime SGDK precisa ser configurado.":"Cena salva · validação de hardware atualizada há 8 s"}</div>
    <div class="status-item"><span class="dot ${mode}"></span> Build ${mode==="danger"?"bloqueado":"com aviso"}</div>
    <div class="status-item"><span class="dot success"></span> Importação concluída</div>
    <div class="status-item"><span class="dot success"></span> Emulação carregada</div>
    <button class="button ghost">${mode==="danger"?"Configurar runtime":"Ver diagnóstico"}</button>
  </footer>`;

const guide = (eyebrow,title,sub,cta="Expandir guia") => `<div class="guide"><div class="guide-copy"><div class="eyebrow">${eyebrow}</div><div class="guide-title">${title}</div><div class="guide-sub">${sub}</div></div><div class="layout-toolbar" role="toolbar" aria-label="Ajuste do layout"><button class="button ghost" data-layout-preset="auto" title="Ajustar automaticamente">${icon("magic-wand")}<span>Auto</span></button><button class="button ghost" data-layout-preset="focus" title="Modo foco">${icon("maximize")}<span>Foco</span></button><button class="button ghost icon-button" data-layout-preset="balanced" aria-label="Restaurar layout balanceado" title="Restaurar layout balanceado">${icon("refresh-double")}</button></div><button class="button primary">${cta}</button><button class="button ghost icon-button" aria-label="Ajuda" title="Ajuda">${icon("help-circle")}</button></div>`;

const shell = ({active="SC",blocked=false,guideHtml="",content,statusMode="warning"}) => `<div class="app">${topbar({blocked})}<div class="workspace">${rail(active)}<section class="surface">${guideHtml}${content}</section></div>${status(statusMode)}</div>`;

const hierarchy = () => `<aside class="panel"><div class="panel-header"><span class="panel-title">Hierarchy</span><div class="grow"></div><button class="button ghost icon-button">+</button></div><div class="panel-body stack"><div class="row"><button class="button ghost grow">Cena importada</button><button class="button ghost">Nova</button></div><div class="alert info"><div class="alert-copy"><strong>Cena pronta para autoria</strong>7 entidades · 3 fontes reais</div><button class="button ghost">Detalhes</button></div><div class="section-label">Cena</div><div class="tree-row">⌄ Main Camera</div><div class="tree-row active">◇ hero <span class="chip success">Jogador</span></div><div class="tree-row">◇ foe <span class="chip warning">Inimigo</span></div><div class="tree-row">▦ world_map</div><div class="section-label">Camadas</div><div class="tree-row">◉ Gameplay</div><div class="tree-row">◉ Cenário</div></div></aside>`;

const inspector = () => `<aside class="panel"><div class="panel-header"><span class="panel-title">Inspector</span><div class="grow"></div><div class="tabs"><button class="tab active">Propriedades</button><button class="tab">Tools</button></div></div><div class="panel-body stack"><div class="row"><div class="dep-icon">SP</div><div><div class="card-title">hero</div><div class="helper">Jogador · Mega Drive</div></div><div class="grow"></div><span class="chip success">Salvo</span></div><div class="section-label">Transform</div><div class="prop"><span>Posição X</span><strong>48</strong></div><div class="prop"><span>Posição Y</span><strong>88</strong></div><div class="prop"><span>Largura</span><strong>32</strong></div><div class="prop"><span>Altura</span><strong>32</strong></div><div class="section-label">Sprite</div><div class="card"><div class="asset-preview">▦</div><div class="card-title">hero-1.png</div><div class="card-sub">Asset carregado · paleta 1 · prioridade alta</div></div><div class="alert warning"><div class="alert-copy"><strong>1 ajuste recomendado</strong>O sprite usa staging de autoria. Normalize antes do release.</div><button class="button ghost">Corrigir</button></div></div></aside>`;

const scene = () => shell({active:"SC",blocked:true,statusMode:"danger",guideHtml:guide("Scene workspace","Componha a cena sem perder o fluxo de build.","Selecione, ajuste e valide; avisos ficam fora do palco.","Abrir Asset Browser"),content:`<div class="workspace-grid">${hierarchy()}<main class="stage"><div class="panel-header"><button class="button primary">Selecionar</button><button class="button ghost">Pintar</button><button class="button ghost">Apagar</button><div class="separator" style="width:1px;height:22px"></div><button class="button ghost">Grid</button><button class="button ghost">Guias</button><button class="button ghost">Visualização ▾</button><div class="grow"></div><span class="chip">100%</span></div><div class="alert danger" style="position:absolute;left:14px;top:56px;right:14px;z-index:2"><div class="alert-copy"><strong>Build bloqueado</strong>O SGDK não foi localizado. A cena continua editável.</div><button class="button danger">Configurar Runtime</button></div><div class="canvas-window"><div class="sprite" style="left:38%;top:36%">hero</div><div class="sprite" style="left:68%;top:62%;background:#c75b65">foe</div></div><div class="hud-card"><div class="eyebrow">Contexto da seleção</div><div class="card-title" style="margin-top:5px">hero · Jogador</div><div class="card-sub">48, 88 · 32×32 · 3 fontes rastreáveis</div><div class="row" style="margin-top:9px"><span class="chip success">3/80 sprites</span><span class="chip">Solo desligado</span></div></div></main>${inspector()}</div>`});

const game = () => shell({active:"GM",guideHtml:guide("Game workspace","Teste o runtime com os controles essenciais sempre visíveis.","Ferramentas de replay e state ficam em Mais controles.","Executar Build & Run"),content:`<main class="game-shell"><div class="game-stage"><div class="game-frame"><div class="game-overlay"><strong>60 FPS</strong><span>Sprites 3 / 80</span><span>DMA 2 KB / 7 KB</span></div><div class="sprite" style="left:44%;top:54%">hero</div><span class="chip" style="position:absolute;right:10px;bottom:10px">320×224 · escala 3×</span></div></div><div class="game-controls"><button class="button primary">Pausar</button><button class="button ghost" disabled>Avançar 1 frame</button><button class="button ghost">Salvar estado</button><button class="button ghost">Carregar estado</button><button class="button ghost">Áudio ligado</button><button class="button ghost">Mais controles ▾</button><div class="grow"></div><span class="helper">Canvas do jogo · Z=A · X=B · C=C · Enter=Start · Setas=D-Pad</span></div></main>`});

const explorer = () => shell({active:"EX",guideHtml:guide("Explorer","Encontre um asset e continue a tarefa sem trocar de catálogo.","As ações canônicas ficam disponíveis na árvore e na grade.","Importar Asset"),content:`<div class="asset-layout"><aside class="panel"><div class="panel-header"><span class="panel-title">Projeto</span></div><div class="panel-body"><div class="tree-row">⌄ assets</div><div class="tree-row tree-indent active">▣ sprites <span class="chip">12</span></div><div class="tree-row tree-indent">▦ tilemaps <span class="chip">4</span></div><div class="tree-row tree-indent">♫ audio <span class="chip">8</span></div><div class="tree-row">⌄ scenes</div><div class="tree-row tree-indent">◇ main.json</div></div></aside><main class="panel"><div class="panel-header"><input class="input grow" aria-label="Buscar assets" placeholder="Buscar por nome, tipo ou referência"><div class="tabs"><button class="tab active">Grade</button><button class="tab">Lista</button></div></div><div class="panel-body"><div class="row" style="margin-bottom:10px"><span class="chip success">Canônicos 18</span><span class="chip">Em uso 11</span><span class="chip warning">Órfãos 2</span><button class="button ghost">Filtros ▾</button></div><div class="asset-grid">${["hero-1.png","hero-run.png","foe.png","world-map.png","hud.png","jump.wav"].map((n,i)=>`<article class="card asset-card ${i===0?"selected":""}" tabindex="0"><div class="asset-preview">${i===5?"♫":"▦"}</div><div class="card-title">${n}</div><div class="card-sub">${i===0?"3 referências · dentro do budget":"Pronto para uso"}</div></article>`).join("")}</div></div></main><aside class="panel"><div class="panel-header"><span class="panel-title">Detalhes</span></div><div class="panel-body stack"><div class="asset-preview" style="height:150px">▦</div><div class="card-title">hero-1.png</div><div class="card-sub">32×32 · PNG · paleta 1<br>Usado em main.json por hero.</div><button class="button primary">Instanciar na cena</button><button class="button ghost">Abrir no Art Studio</button><button class="button ghost">Focar referência</button></div></aside></div>`});

const logic = () => shell({active:"LG",guideHtml:guide("Logic workspace","Edite a lógica e mantenha contexto, problemas e hardware legíveis.","Ações de teclado têm a mesma capacidade do drag.","Validar grafo"),content:`<div class="workspace-grid" style="grid-template-columns:220px minmax(0,1fr) 310px"><aside class="panel"><div class="panel-header"><input class="input" placeholder="Buscar nó" aria-label="Buscar nó"></div><div class="panel-body stack"><div class="section-label">Eventos</div><button class="palette-item">⚡ Ao iniciar</button><button class="palette-item">⚡ A cada frame</button><div class="section-label">Movimento</div><button class="palette-item">↗ Mover sprite</button><button class="palette-item">▣ Tocar animação</button><div class="section-label">Alternativa ao drag</div><button class="button ghost">Adicionar por comando…</button></div></aside><main class="node-canvas"><div class="node" style="left:12%;top:16%"><div class="node-head">Ao iniciar</div><div class="node-body row"><span class="grow">Evento</span><span class="port"></span></div></div><div class="connection" style="left:30%;top:25%;width:180px;transform:rotate(8deg)"></div><div class="node" style="left:44%;top:24%"><div class="node-head" style="background:#285d58">Mover sprite</div><div class="node-body stack"><div class="row"><span class="port"></span><span class="grow">hero</span><span class="port"></span></div><div>Delta X <strong>3</strong></div></div></div><div class="empty" style="position:absolute;left:24%;right:18%;bottom:12px;min-height:80px;padding:8px"><p><strong>Teclado:</strong> Tab seleciona nós · setas movem · C conecta · Delete abre confirmação</p></div></main><aside class="panel"><div class="panel-header"><span class="panel-title">Contexto</span></div><div class="panel-body stack"><div class="tabs"><button class="tab active">Resumo</button><button class="tab">Problemas <span class="chip danger">1</span></button><button class="tab">Fonte</button></div><div class="card"><div class="eyebrow">hero</div><div class="card-title">2 nós · 1 conexão</div><div class="card-sub">Source mapping: src/main.c</div></div><div class="alert warning"><div class="alert-copy"><strong>Heurística Experimental</strong>O grafo ajuda a autoria, mas não representa toda a AST/FSM real do doador.</div></div><div class="card"><div class="section-label">Hardware</div><div class="prop"><span>Sprites/frame</span><strong>3 / 80</strong></div><div class="prop"><span>Scanline</span><strong>1 / 20</strong></div></div></div></aside></div>`});

const artFx = () => shell({active:"AT",guideHtml:guide("Art + FX","Prepare arte e efeitos com maturidade explícita.","Fluxo orientado: fonte, animação, validação e exportação.","Importar imagem"),content:`<div class="panel-header"><div class="tabs"><button class="tab active">Art Studio <span class="chip experimental">Experimental</span></button><button class="tab">RetroFX <span class="chip experimental">Experimental</span></button></div><div class="grow"></div><span class="chip warning">Alterações locais</span><button class="button primary">Salvar rascunho</button></div><div class="art-layout" style="flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr)"><main class="panel"><div class="panel-body" style="height:100%"><div class="stack"><div class="row"><div><div class="eyebrow">1 · Fonte</div><div class="card-title">hero-sheet.png</div></div><div class="grow"></div><button class="button ghost">Substituir</button><span class="chip success">Carregada</span></div><div class="card" style="height:320px;display:grid;place-items:center;background:#0a0e17"><div style="display:grid;grid-template-columns:repeat(6,42px);gap:4px">${Array.from({length:18},(_,i)=>`<button class="sprite" style="position:static;width:42px;height:42px;transform:none">${i+1}</button>`).join("")}</div></div><div><div class="row"><div><div class="eyebrow">2 · Timeline</div><div class="card-title">run · 8 frames · 12 FPS</div></div><div class="grow"></div><button class="button ghost">◀</button><button class="button primary">Reproduzir</button><button class="button ghost">▶</button></div><div class="row" style="margin-top:8px">${Array.from({length:8},(_,i)=>`<div class="card" style="width:54px;height:58px;padding:5px;text-align:center"><strong>${i+1}</strong><div class="helper">83ms</div></div>`).join("")}</div></div></div></div></main><aside class="panel"><div class="panel-header"><div class="tabs"><button class="tab active">Animação</button><button class="tab">Exportar</button><button class="tab">Diagnóstico</button></div></div><div class="panel-body stack"><div class="card"><div class="section-label">Preview</div><div class="asset-preview" style="height:130px">hero</div><span class="chip success">Dentro dos limites</span></div><div class="field"><label>Nome da sequência</label><input class="input" value="run"></div><div class="row"><div class="field grow"><label>FPS</label><input class="input" value="12"></div><div class="field grow"><label>Loop</label><select class="input"><option>Automático</option></select></div></div><div class="alert info"><div class="alert-copy"><strong>Próxima ação</strong>Gere o asset canônico antes de aplicar na cena.</div></div><button class="button primary">Gerar em assets/sprites</button><button class="button ghost">Aplicar na entidade hero</button></div></aside></div>`});

const debugTools = () => shell({active:"DB",guideHtml:guide("Debug workspace","Escolha uma tarefa técnica sem perder o contexto da cena.","A navegação adapta-se à largura real deste painel.","Abrir Profiler"),content:`<div class="tool-layout"><nav class="tool-nav"><div class="section-label" style="margin:6px">Configurar</div><button class="tool-link active"><span>RD</span><span>Runtime Setup</span></button><button class="tool-link"><span>PT</span><span>Patch Studio</span></button><div class="section-label" style="margin:16px 6px 6px">Analisar</div><button class="tool-link"><span>DP</span><span>Profiler</span></button><button class="tool-link"><span>MM</span><span>Memória</span></button><div class="section-label" style="margin:16px 6px 6px">Experimental</div><button class="tool-link"><span>RV</span><span>Engenharia reversa</span></button><button class="tool-link"><span>PX</span><span>Parity / Cycle</span></button></nav><main class="tool-main"><div class="row"><div><div class="eyebrow">Configure</div><h1 style="margin:4px 0 0;font-size:20px">Runtime Setup</h1><p class="helper">Dependências oficiais, toolchains e estado do runtime.</p></div><div class="grow"></div><span class="chip">Debug</span><button class="button ghost">Revalidar</button></div><div class="alert warning" style="margin:14px 0"><div class="alert-copy"><strong>1 dependência bloqueia o Build & Run</strong>O SGDK não foi encontrado no caminho configurado.</div><button class="button primary">Corrigir agora</button></div><div class="stack"><div class="card dep-card"><div class="dep-icon">J</div><div><div class="card-title">JDK 21</div><div class="card-sub">Instalado · Temurin LTS</div></div><span class="chip success">Pronto</span></div><div class="card dep-card"><div class="dep-icon">SG</div><div><div class="card-title">SGDK</div><div class="card-sub">Necessário para projetos Mega Drive.</div></div><button class="button danger">Configurar</button></div><div class="card dep-card"><div class="dep-icon">LR</div><div><div class="card-title">Core Libretro</div><div class="card-sub">Genesis Plus GX · versão detectada</div></div><span class="chip success">Pronto</span></div></div></main></div>`});

const runtime = () => shell({active:"DB",blocked:true,statusMode:"danger",guideHtml:guide("Runtime Setup","Recupere o fluxo Build & Run com diagnóstico local.","Nenhuma falha é apresentada como ambiente vazio.","Revalidar ambiente"),content:`<main class="tool-main"><div class="row"><div><div class="eyebrow">Dependências oficiais</div><h1 style="margin:4px 0 0;font-size:20px">Configure o runtime</h1><p class="helper">Instalações permanecem locais e usam apenas fontes oficiais.</p></div><div class="grow"></div><span class="chip danger">Build bloqueado</span></div><div class="alert danger" style="margin:14px 0"><div class="alert-copy"><strong>Não foi possível validar o SGDK</strong><b>O que quebrou:</b> o caminho salvo não existe.<br><b>Por que importa:</b> projetos Mega Drive não podem gerar ROM.<br><b>Onde corrigir:</b> SGDK → Caminho local.</div><button class="button danger">Escolher pasta</button><button class="button ghost">Ver Console</button></div><div class="stack"><div class="card dep-card"><div class="dep-icon">J</div><div><div class="card-title">JDK 21</div><div class="card-sub">C:\Program Files\Eclipse Adoptium · 21.0.6</div></div><span class="chip success">Instalado</span></div><div class="card dep-card"><div class="dep-icon">SG</div><div><div class="card-title">SGDK</div><div class="card-sub">Caminho inválido · necessário para Mega Drive</div></div><button class="button danger">Corrigir</button></div><div class="card dep-card"><div class="dep-icon">PV</div><div><div class="card-title">PVSnesLib</div><div class="card-sub">Instalação em andamento · fonte oficial</div><div class="progress" style="margin-top:8px"><span style="width:62%"></span></div></div><button class="button ghost">62%</button></div><div class="card dep-card"><div class="dep-icon">LR</div><div><div class="card-title">Cores Libretro</div><div class="card-sub">2 instalados · Genesis Plus GX e Snes9x</div></div><span class="chip success">Pronto</span></div></div><div class="card" style="margin-top:14px"><div class="row"><div><div class="card-title">Build multi-target</div><div class="card-sub">Disponível quando os dois toolchains estiverem prontos.</div></div><div class="grow"></div><button class="button ghost" disabled>Build em MD + SNES</button></div></div></main>`});

const consoleScreen = () => shell({active:"SC",statusMode:"danger",guideHtml:guide("Diagnóstico acionável","O erro mais relevante está selecionado e ligado à próxima ação.","Novas mensagens não interrompem a leitura.","Tentar Build novamente"),content:`<div class="workspace-grid">${hierarchy()}<main class="stage"><div class="canvas-window"><div class="sprite" style="left:42%;top:45%">hero</div></div></main>${inspector()}</div><section class="console-drawer"><div class="console-list"><div class="row" style="padding:0 7px 8px"><strong>Console</strong><span class="chip danger">1 erro</span><span class="chip warning">2 avisos</span><div class="grow"></div><button class="button ghost">Filtros</button><button class="button ghost">Limpar</button></div><div class="log-row"><span>20:41:08</span><span class="log-level">INFO</span><span>Cena salva com sucesso.</span></div><div class="log-row active"><span>20:41:12</span><span class="log-level err">ERRO</span><span>[Build] SGDK não encontrado no caminho configurado.</span></div><div class="log-row"><span>20:41:13</span><span class="log-level warn">AVISO</span><span>Hardware snapshot desatualizado.</span></div><div class="alert info" style="margin:8px"><div class="alert-copy"><strong>3 novas mensagens</strong>O acompanhamento automático foi pausado enquanto você lê.</div><button class="button ghost">Ir para o fim</button></div></div><aside class="console-detail"><div class="eyebrow">Build · Erro</div><h2 style="font-size:15px;margin:6px 0">SGDK não encontrado</h2><div class="stack"><div><div class="section-label">Por que importa</div><p class="card-sub">Sem o toolchain, a ROM Mega Drive não pode ser gerada.</p></div><div><div class="section-label">Onde corrigir</div><p class="card-sub">Debug → Runtime Setup → SGDK.</p></div><button class="button primary">Abrir Runtime Setup</button><button class="button ghost">Copiar diagnóstico</button><button class="button ghost">Copiar caminho</button></div></aside></section>`});

const commandDialog = () => shell({active:"SC",guideHtml:guide("Scene workspace","Continue a tarefa pelo teclado.","A Command Palette explica por que um comando está indisponível."),content:`<div class="workspace-grid">${hierarchy()}<main class="stage"><div class="canvas-window"></div></main>${inspector()}</div><div class="modal-layer"><section class="command" role="dialog" aria-modal="true" aria-labelledby="command-title"><div class="command-search"><span style="font-size:18px">⌕</span><input value="build" aria-label="Buscar comando"><span class="shortcut">Esc</span></div><div class="command-list"><div class="command-group" id="command-title">Projeto</div><div class="command-item active"><div class="command-icon">▶</div><div><div class="card-title">Build & Run</div><div class="card-sub">Salvar, validar, gerar ROM e iniciar emulação.</div></div><span class="shortcut">Ctrl+B</span></div><div class="command-item"><div class="command-icon">⚙</div><div><div class="card-title">Configurar Runtime</div><div class="card-sub">Corrige o bloqueio atual do SGDK.</div></div><span class="chip danger">Recomendado</span></div><div class="command-group">Comandos indisponíveis</div><div class="command-item" style="opacity:.72"><div class="command-icon">↻</div><div><div class="card-title">Revalidar cena</div><div class="card-sub">Abra um projeto e selecione uma cena para habilitar.</div></div><span class="chip">Bloqueado</span></div></div><div class="dialog-footer"><span class="helper">↑↓ navegar · Enter executar · Tab ações · Esc fechar</span><button class="button ghost">Editar atalhos</button></div></section></div>`});

const reverseEvidence = () => shell({active:"DB",guideHtml:guide("Laboratório de evidências","Compare execuções sem prometer equivalência que o runtime não mede.","Reverse, Parity e Cycle permanecem Experimental.","Nova captura"),content:`<div class="evidence-layout"><nav class="tool-nav"><span class="chip experimental" style="margin:4px 4px 12px">Experimental</span><button class="tool-link active"><span>PX</span><span>Parity Capture</span></button><button class="tool-link"><span>CC</span><span>Cross-Core</span></button><button class="tool-link"><span>CY</span><span>Cycle Report</span></button><button class="tool-link"><span>RV</span><span>Reverse Workspace</span></button></nav><main class="evidence-main"><div class="row"><div><div class="eyebrow">Gameplay Parity</div><h1 style="margin:4px 0 0;font-size:20px">Evidência da execução</h1><p class="helper">Compara observações disponíveis; não prova gameplay 1:1 nem cycle accuracy.</p></div><div class="grow"></div><button class="button primary">Executar captura</button></div><div class="readiness" style="margin:14px 0"><div class="metric"><span class="helper">ROM</span><strong style="color:var(--rds-success)">Pronta</strong></div><div class="metric"><span class="helper">Golden input</span><strong style="color:var(--rds-success)">Carregado</strong></div><div class="metric"><span class="helper">Core</span><strong>Genesis Plus GX</strong></div><div class="metric"><span class="helper">Frames</span><strong>120</strong></div></div><div class="tabs" style="width:max-content;margin-bottom:12px"><button class="tab active">Resultado</button><button class="tab">Divergências <span class="chip danger">2</span></button><button class="tab">Limitações <span class="chip warning">4</span></button><button class="tab">Arquivos</button></div><div class="alert warning"><div class="alert-copy"><strong>Evidência insuficiente para equivalência</strong>Os frame hashes divergiram em 2 pontos. Savestate entre cores é formato opaco e não conta como estado comparável.</div><button class="button ghost">Ver divergências</button></div><div class="stack" style="margin-top:12px"><div class="card"><div class="row"><div><div class="section-label">Observações comparáveis</div><div class="card-title">Framebuffer · áudio observado · WRAM</div></div><div class="grow"></div><span class="chip warning">Divergência observada</span></div></div><div class="card"><div class="section-label">Não medido por este harness</div><div class="row" style="margin-top:8px"><span class="chip">Cycle accuracy</span><span class="chip">Audio exact match</span><span class="chip">VDP scanline trace</span><span class="chip">DMA timing</span></div></div><div class="card"><div class="row"><div><div class="section-label">Relatório</div><div class="card-sub">.rds/reports/cross-core-parity-report.json</div></div><div class="grow"></div><button class="button ghost">Copiar caminho</button><button class="button ghost">Mostrar na pasta</button></div></div></div></main></div>`});

const primitives = () => `<main class="specimen"><div class="specimen-head"><div class="eyebrow">RetroDev UI foundation</div><h1 style="margin:6px 0;font-size:26px">Tokens e primitivas para uma IDE densa, legível e acessível</h1><p class="helper">Tema escuro atual; nomes semânticos preparados para tema claro futuro. Alvos ≥24 px, foco visível e status por ícone + texto.</p></div><div class="specimen-grid"><section class="card stack"><div class="card-title">Ações</div><div class="row" style="flex-wrap:wrap"><button class="button primary">Ação principal</button><button class="button">Secundária</button><button class="button ghost">Ghost</button><button class="button danger">Excluir</button><button class="button" disabled>Carregando…</button></div><div class="row"><span class="chip success">Pronto</span><span class="chip warning">Atenção</span><span class="chip danger">Bloqueado</span><span class="chip experimental">Experimental</span></div></section><section class="card stack"><div class="card-title">Campos</div><div class="field"><label for="project">Nome do projeto</label><input id="project" class="input" value="MeuJogo"><div class="helper">Usado no diretório e no manifesto do projeto.</div></div><div class="field"><label for="path">Pasta do SGDK</label><div class="row"><input id="path" class="input grow" value="C:\\Toolchains\\sgdk"><button class="button">Escolher</button></div></div></section><section class="card stack"><div class="card-title">Feedback</div><div class="alert danger"><div class="alert-copy"><strong>Build bloqueado</strong>O SGDK não foi localizado. Configure o caminho para gerar a ROM.</div><button class="button danger">Corrigir</button></div><div class="alert info"><div class="alert-copy"><strong>Rascunho salvo</strong>A cena foi preservada localmente há 8 segundos.</div></div></section><section class="card"><div class="card-title">Estado vazio</div><div class="empty"><div><div class="empty-icon">◇</div><h3>Nenhuma cena aberta</h3><p>Abra uma cena existente ou crie a primeira cena para começar a autoria.</p><button class="button primary">Criar primeira cena</button></div></div></section><section class="card" style="grid-column:1/-1"><div class="card-title" style="margin-bottom:10px">Tokens de cor semânticos</div><div class="swatches">${[["Base","var(--rds-bg)"],["Painel","var(--rds-surface-1)"],["Elevado","var(--rds-surface-3)"],["Ação","var(--rds-primary)"],["Sucesso","var(--rds-success)"],["Aviso","var(--rds-warning)"],["Erro","var(--rds-danger)"],["Experimental","var(--rds-experimental)"],["Texto","var(--rds-text)"],["Secundário","var(--rds-text-secondary)"],["Borda","var(--rds-border)"],["Foco","var(--rds-focus)"]].map(([n,c])=>`<div class="swatch" style="background:${c};color:${["Base","Painel","Elevado","Borda"].includes(n)?"var(--rds-text)":"#08101f"}">${n}</div>`).join("")}</div></section></div></main>`;

const wizard = () => `${shell({active:"SC",guideHtml:guide("Primeiro projeto","Crie um projeto editável e chegue ao primeiro playtest.","Importar projeto externo é uma rota separada.","Abrir projeto existente"),content:`<div class="workspace-grid">${hierarchy()}<main class="stage"></main>${inspector()}</div>`})}<div class="modal-layer"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-title"><header class="dialog-header"><div class="grow"><div class="eyebrow">Primeiro projeto</div><h1 id="wizard-title">Crie seu jogo em três passos</h1><p>Escolha um ponto de partida; você poderá alterar target e assets depois.</p></div><button class="button ghost icon-button" aria-label="Fechar">×</button></header><div class="dialog-body"><div class="stepper"><div class="step done"><span class="step-num">✓</span>Template</div><div class="step active"><span class="step-num">2</span>Plataforma e destino</div><div class="step"><span class="step-num">3</span>Revisão</div></div><div class="alert danger" style="margin-bottom:12px"><div class="alert-copy"><strong>O catálogo não pôde ser atualizado</strong>Os templates locais continuam disponíveis. Verifique a conexão e tente novamente.</div><button class="button ghost">Tentar novamente</button></div><div class="template-grid"><article class="card template-card selected"><div class="template-art"></div><div class="card-title">Plataforma 16-bit</div><div class="card-sub">Cena, jogador e câmera prontos.</div></article><article class="card template-card"><div class="template-art" style="background:linear-gradient(135deg,#4b2256,#8d4d91,#432b71)"></div><div class="card-title">Run and gun</div><div class="card-sub">Movimento, inimigo e HUD.</div></article><article class="card template-card"><div class="template-art" style="background:linear-gradient(135deg,#1d4655,#368785,#1a3f5c)"></div><div class="card-title">Projeto vazio</div><div class="card-sub">Estrutura mínima e guiada.</div></article></div><div class="row" style="margin-top:14px"><div class="field grow"><label for="name">Nome do projeto</label><input id="name" class="input" value="MeuJogo"><div class="helper">Destino: Projetos/MeuJogo</div></div><div class="field grow"><label for="target">Plataforma</label><select id="target" class="input"><option>Mega Drive</option><option>SNES</option></select><div class="helper">Pode ser alterada no projeto.</div></div><div class="field grow"><label for="folder">Pasta base</label><div class="row"><input id="folder" class="input" value="Projetos"><button class="button">Escolher</button></div><div class="helper">Será criada uma subpasta segura.</div></div></div></div><footer class="dialog-footer"><button class="button ghost">Importar projeto externo</button><div class="row"><button class="button ghost">Voltar</button><button class="button primary">Revisar projeto</button></div></footer></section></div>`;

const renderers = {"design-system":primitives,wizard,scene,game,explorer,logic,"art-fx":artFx,"debug-tools":debugTools,"runtime-setup":runtime,"console-states":consoleScreen,"command-dialog":commandDialog,"reverse-evidence":reverseEvidence};
const key = document.body.dataset.screen || "design-system";
document.getElementById("mock-root").innerHTML = $(renderers[key]());

const buttonIconRules = [
  [/build|executar|reproduzir|play|pausar/i, "play"], [/parar/i, "square"],
  [/console|diagnóstico/i, "terminal"], [/revalidar|tentar novamente|restaurar/i, "refresh-double"],
  [/configur|corrigir|ajuste/i, "settings"], [/importar/i, "import"], [/buscar|filtros/i, "search"],
  [/adicionar|nova|criar/i, "plus"], [/abrir|mostrar|detalhes|focar referência/i, "open-new-window"],
  [/grade/i, "view-grid"], [/lista/i, "list"], [/selecionar/i, "cursor-pointer"],
  [/pintar|editar/i, "edit-pencil"], [/apagar|limpar|excluir/i, "erase"], [/ajuda/i, "help-circle"],
  [/salvar|gerar|copiar/i, "check-circle"], [/mais|visualização/i, "more-horiz"],
];

function decorateActionIcons(root = document) {
  root.querySelectorAll("button").forEach((button) => {
    if (button.querySelector(".rds-icon")) return;
    const label = (button.textContent || button.getAttribute("aria-label") || "").trim();
    if (button.getAttribute("aria-label") === "Fechar" || label === "×") {
      button.innerHTML = icon("xmark");
      button.title = "Fechar";
      return;
    }
    const match = buttonIconRules.find(([pattern]) => pattern.test(label));
    if (match) button.insertAdjacentHTML("afterbegin", icon(match[1]));
  });

  const toolIcons = {"Runtime Setup":"settings","Patch Studio":"edit-pencil","Profiler":"terminal","Memória":"view-grid","Engenharia reversa":"bug","Parity / Cycle":"network","Parity Capture":"network","Cross-Core":"refresh-double","Cycle Report":"terminal","Reverse Workspace":"bug"};
  root.querySelectorAll(".tool-link").forEach((item) => {
    const label = item.lastElementChild?.textContent?.trim();
    if (label && toolIcons[label] && item.firstElementChild) item.firstElementChild.innerHTML = icon(toolIcons[label]);
  });

  const commandIcons = ["play", "settings", "refresh-double"];
  root.querySelectorAll(".command-icon").forEach((item, index) => item.innerHTML = icon(commandIcons[index] || "terminal"));
  const commandSearch = root.querySelector(".command-search > span:first-child");
  if (commandSearch) commandSearch.innerHTML = icon("search", {className:"icon-lg"});
}

function panelControls(label, compact = false) {
  return `<div class="panel-controls" role="toolbar" aria-label="Controles de ${label}">
    ${iconButton("pin", `Fixar ${label}`, "pin", true)}
    ${iconButton("eye-closed", `Auto-ocultar ${label}`, "auto-hide")}
    ${compact ? "" : iconButton("open-new-window", `Tornar ${label} flutuante`, "float")}
  </div>`;
}

function enhancePanels() {
  document.querySelectorAll(".panel").forEach((panel, index) => {
    const header = panel.querySelector(":scope > .panel-header");
    const title = header?.querySelector(".panel-title")?.textContent?.trim() || `Painel ${index + 1}`;
    panel.id ||= `mock-panel-${index + 1}`;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", title);
    if (header && !header.querySelector(".panel-controls")) header.insertAdjacentHTML("beforeend", panelControls(title, header.querySelector(".tabs") !== null));
  });

  document.querySelectorAll(".tool-nav").forEach((nav, index) => {
    nav.id ||= `mock-nav-${index + 1}`;
    nav.setAttribute("aria-label", "Navegação redimensionável");
  });
}

function makeUtilityBox(box, title) {
  if (box.classList.contains("utility-movable")) return;
  box.classList.add("utility-movable");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "false");
  box.setAttribute("aria-label", title);
  box.insertAdjacentHTML("afterbegin", `<div class="utility-titlebar" data-drag-handle title="Arraste para mover">
    <span class="drag-grip">${icon("drag")}</span><strong>${title}</strong><span class="grow"></span>
    ${iconButton("pin", `Fixar ${title}`, "pin", true)}
    ${iconButton("eye-closed", `Auto-ocultar ${title}`, "auto-hide")}
    ${iconButton("open-new-window", `Encaixar ou flutuar ${title}`, "float")}
  </div><span class="resize-corner" aria-hidden="true"></span>`);
}

function enhanceUtilityWindows() {
  const hud = document.querySelector(".hud-card");
  if (hud) makeUtilityBox(hud, "Contexto da seleção");
  const metrics = document.querySelector(".game-overlay");
  if (metrics) makeUtilityBox(metrics, "Métricas do runtime");

  document.querySelectorAll(".specimen .alert.info,.console-drawer .alert.info,.tool-main .alert.info,.evidence-main .alert.info").forEach((alert) => {
    alert.classList.add("auto-hide-capable");
    if (!alert.querySelector(".info-controls")) alert.insertAdjacentHTML("beforeend", `<div class="info-controls" role="toolbar" aria-label="Controles da informação">${iconButton("pin", "Fixar informação", "pin", true)}${iconButton("eye-closed", "Auto-ocultar informação", "auto-hide")}</div>`);
  });

  const dialogHeader = document.querySelector(".dialog > .dialog-header");
  if (dialogHeader && !dialogHeader.querySelector(".window-controls")) {
    const close = dialogHeader.querySelector('[aria-label="Fechar"]');
    close?.insertAdjacentHTML("beforebegin", `<div class="window-controls" role="toolbar" aria-label="Controles da janela">${iconButton("magic-wand", "Ajustar ao conteúdo", "fit")}${iconButton("maximize", "Maximizar janela", "maximize")}</div>`);
    dialogHeader.setAttribute("data-drag-handle", "");
    document.querySelector(".dialog")?.insertAdjacentHTML("beforeend", '<span class="resize-corner" aria-hidden="true"></span>');
  }

  const consoleDrawer = document.querySelector(".console-drawer");
  if (consoleDrawer) consoleDrawer.insertAdjacentHTML("afterbegin", `<button class="drawer-resize-handle" role="separator" aria-label="Redimensionar Console" aria-orientation="horizontal" aria-valuemin="160" aria-valuemax="65" aria-valuenow="300" title="Arraste; duplo clique ajusta automaticamente"><span>${icon("drag")}</span></button>`);
}

function layoutChildren(layout) {
  return [...layout.children].filter((child) => !child.classList.contains("layout-splitter"));
}

function applyLayoutPreset(layout, preset = "balanced") {
  const children = layoutChildren(layout);
  const width = layout.clientWidth;
  if (children.length === 3) {
    const left = preset === "focus" ? 48 : preset === "auto" ? Math.max(180, Math.min(260, Math.round(width * .18))) : 220;
    const right = preset === "focus" ? 48 : preset === "auto" ? Math.max(270, Math.min(380, Math.round(width * .24))) : 320;
    layout.style.gridTemplateColumns = `${left}px minmax(320px,1fr) ${right}px`;
  } else if (children.length === 2 && layout.classList.contains("console-drawer")) {
    const right = preset === "focus" ? 48 : preset === "auto" ? Math.max(280, Math.min(420, Math.round(width * .27))) : 330;
    layout.style.gridTemplateColumns = `minmax(320px,1fr) ${right}px`;
  } else if (children.length === 2 && layout.classList.contains("art-layout")) {
    const right = preset === "focus" ? 48 : preset === "auto" ? Math.max(280, Math.min(440, Math.round(width * .28))) : Math.max(280, Math.min(460, Math.round(width * .33)));
    layout.style.gridTemplateColumns = `minmax(420px,1fr) ${right}px`;
  } else if (children.length === 2) {
    const left = preset === "focus" ? 48 : preset === "auto" ? Math.max(150, Math.min(280, Math.round(width * .17))) : (layout.classList.contains("evidence-layout") ? 220 : 190);
    layout.style.gridTemplateColumns = `${left}px minmax(320px,1fr)`;
  }
  layout.dataset.layoutPreset = preset;
  requestAnimationFrame(() => updateSplitters(layout));
}

function updateSplitters(layout) {
  const children = layoutChildren(layout);
  const rect = layout.getBoundingClientRect();
  layout.querySelectorAll(".layout-splitter").forEach((splitter, index) => {
    const childRect = children[index].getBoundingClientRect();
    splitter.style.left = `${Math.round(childRect.right - rect.left - 4)}px`;
    splitter.setAttribute("aria-valuenow", String(Math.round(childRect.width)));
    splitter.setAttribute("aria-valuetext", `${children[index].getAttribute("aria-label") || "Painel"}, ${Math.round(childRect.width)} pixels`);
  });
}

function makeLayoutResizable(layout) {
  const children = layoutChildren(layout);
  if (children.length < 2 || layout.dataset.resizable === "true") return;
  layout.dataset.resizable = "true";
  layout.classList.add("resizable-layout");
  children.slice(0, -1).forEach((child, index) => {
    const splitter = document.createElement("button");
    splitter.type = "button";
    splitter.className = "layout-splitter";
    splitter.setAttribute("role", "separator");
    splitter.setAttribute("aria-label", `Redimensionar ${child.getAttribute("aria-label") || `painel ${index + 1}`}`);
    splitter.setAttribute("aria-orientation", "vertical");
    splitter.setAttribute("aria-valuemin", "48");
    splitter.setAttribute("aria-valuemax", "560");
    splitter.innerHTML = `<span class="splitter-grip">${icon("drag")}</span><span class="resize-measure" aria-hidden="true"></span>`;
    layout.appendChild(splitter);

    const resizeTo = (clientX) => {
      const rect = layout.getBoundingClientRect();
      const current = layoutChildren(layout).map((item) => item.getBoundingClientRect().width);
      if (children.length === 3 && index === 0) {
        const left = Math.max(48, Math.min(480, clientX - rect.left));
        layout.style.gridTemplateColumns = `${left}px minmax(320px,1fr) ${current[2]}px`;
      } else if (children.length === 3) {
        const right = Math.max(48, Math.min(560, rect.right - clientX));
        layout.style.gridTemplateColumns = `${current[0]}px minmax(320px,1fr) ${right}px`;
      } else if (layout.classList.contains("console-drawer")) {
        const right = Math.max(260, Math.min(520, rect.right - clientX));
        layout.style.gridTemplateColumns = `minmax(320px,1fr) ${right}px`;
      } else if (layout.classList.contains("art-layout")) {
        const right = Math.max(280, Math.min(560, rect.right - clientX));
        layout.style.gridTemplateColumns = `minmax(420px,1fr) ${right}px`;
      } else {
        const left = Math.max(48, Math.min(480, clientX - rect.left));
        layout.style.gridTemplateColumns = `${left}px minmax(320px,1fr)`;
      }
      layout.dataset.layoutPreset = "manual";
      updateSplitters(layout);
    };
    splitter.addEventListener("pointerdown", (event) => {
      splitter.setPointerCapture(event.pointerId);
      splitter.classList.add("is-resizing");
      resizeTo(event.clientX);
    });
    splitter.addEventListener("pointermove", (event) => {
      if (splitter.hasPointerCapture(event.pointerId)) resizeTo(event.clientX);
    });
    splitter.addEventListener("pointerup", (event) => {
      if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
      splitter.classList.remove("is-resizing");
    });
    splitter.addEventListener("dblclick", () => applyLayoutPreset(layout, "auto"));
    splitter.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter") return applyLayoutPreset(layout, "auto");
      const step = event.shiftKey ? 32 : 8;
      const currentX = splitter.getBoundingClientRect().left + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : event.key === "Home" ? -9999 : 9999);
      resizeTo(currentX);
    });
  });
  requestAnimationFrame(() => updateSplitters(layout));
}

function enableDragging() {
  document.querySelectorAll("[data-drag-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button,input,select")) return;
      const target = handle.closest(".utility-movable,.dialog");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      target.style.position = "fixed";
      target.style.left = `${rect.left}px`;
      target.style.top = `${rect.top}px`;
      target.style.width = `${rect.width}px`;
      target.style.height = `${rect.height}px`;
      target.style.margin = "0";
      target.style.transform = "none";
      target.style.zIndex = "40";
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        if (!handle.hasPointerCapture(moveEvent.pointerId)) return;
        const left = Math.max(12, Math.min(innerWidth - 48, moveEvent.clientX - offsetX));
        const top = Math.max(12, Math.min(innerHeight - 48, moveEvent.clientY - offsetY));
        target.style.left = `${left}px`;
        target.style.top = `${top}px`;
      };
      const stop = (upEvent) => {
        if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
    });
  });
}

function enhanceDesignSystem() {
  const grid = document.querySelector(".specimen-grid");
  if (!grid) return;
  const feedback = [...grid.querySelectorAll(":scope > section")].find((section) => section.querySelector(".card-title")?.textContent === "Feedback");
  const contract = `<section class="card panel-contract" style="grid-column:1/-1"><div class="row"><div><div class="eyebrow">Painéis adaptáveis</div><div class="card-title">Manual, automático, flutuante e auto-ocultável</div><div class="card-sub">Divisores têm área de captura de 8 px, teclado e presets. Informação não crítica pode recolher; bloqueios nunca somem.</div></div><div class="grow"></div><div class="layout-toolbar">${iconButton("magic-wand", "Ajustar automaticamente", "fit")}${iconButton("maximize", "Modo foco", "maximize")}${iconButton("refresh-double", "Restaurar layout", "reset")}</div></div><div class="panel-demo"><aside><div class="utility-titlebar"><span>${icon("tree")}</span><strong>Hierarchy</strong><span class="grow"></span>${iconButton("pin", "Fixar Hierarchy", "pin", true)}${iconButton("eye-closed", "Auto-ocultar Hierarchy", "auto-hide")}</div><div class="panel-demo-body">Painel 230 px</div></aside><button class="demo-splitter" role="separator" aria-orientation="vertical" aria-valuenow="230" aria-label="Redimensionar Hierarchy">${icon("drag")}</button><main><div class="panel-demo-body">Área principal preservada</div></main><div class="auto-hide-tab">${icon("info-circle")} Contexto <span class="chip">3</span></div></div></section>`;
  if (feedback) feedback.insertAdjacentHTML("beforebegin", contract); else grid.insertAdjacentHTML("beforeend", contract);
}

function bindActions() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "pin") {
      const pressed = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(pressed));
      button.innerHTML = icon(pressed ? "pin" : "pin-slash");
    }
    if (action === "auto-hide") {
      const target = button.closest(".utility-movable,.alert.info,.panel");
      target?.classList.toggle("is-auto-hidden");
      button.setAttribute("aria-pressed", String(target?.classList.contains("is-auto-hidden")));
    }
    if (action === "maximize") {
      const target = button.closest(".dialog,.utility-movable");
      target?.classList.toggle("is-maximized");
    }
    const preset = button.dataset.layoutPreset;
    if (preset) document.querySelectorAll(".resizable-layout").forEach((layout) => applyLayoutPreset(layout, preset));
  });
}

enhanceDesignSystem();
enhancePanels();
enhanceUtilityWindows();
decorateActionIcons();
document.querySelectorAll(".workspace-grid,.asset-layout,.art-layout,.tool-layout,.evidence-layout,.console-drawer").forEach(makeLayoutResizable);
enableDragging();
bindActions();
window.addEventListener("resize", () => document.querySelectorAll(".resizable-layout").forEach(updateSplitters));
