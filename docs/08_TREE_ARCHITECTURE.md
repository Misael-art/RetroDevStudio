# 🌳 08 - TREE ARCHITECTURE & DIRECTORY MAP
**Status:** Definitivo  
**Objetivo:** Padronizar a alocação de arquivos para Desenvolvedores e Agentes de IA.

> ⚠️ **ATENÇÃO AGENTES DE IA (DIRETRIZ DE NAVEGAÇÃO):** 
> Antes de criar um novo arquivo, componente React ou módulo Rust, consulte esta árvore. 
> **NÃO** crie pastas redundantes. Mantenha a separação estrita entre Frontend (`/src`) e Backend (`/src-tauri/src`). O Frontend nunca deve processar lógica pesada; o Backend nunca deve renderizar HTML/CSS.

---

## 📂 Árvore de Diretórios Completa (RetroDev Studio)

```text
RetroDevStudio/
│
├── .cursorrules                 # Cérebro da IA (Regras de comportamento para Cursor)
├── .gitignore                   # Node/Rust/Tauri/build artifacts ignorados
├── CLAUDE.md                    # Regras para Claude Code (integração CLI)
├── README.md                    # Visão geral do projeto e onboarding
├── app-icon.png                 # Fonte dos ícones (512x512 PNG — gerado por scripts/create-icon.mjs)
├── index.html                   # Entrypoint HTML do Vite
├── package.json                 # Dependências do Frontend (React/Vite/Tailwind/Zustand)
├── tsconfig.json                # Configurações do TypeScript (src/)
├── tsconfig.node.json           # Configurações do TypeScript (vite.config.ts)
├── vite.config.ts               # Bundler do Frontend (porta 1420, TailwindCSS v4 plugin)
│
├── 📁 data/                     # 📚 BASE DE CONHECIMENTO (ARQUITETURA)
│   ├── rom_teste.bin      		  # ROMs binaria de Homebrew para testes no Hardware do mega drive
│   └── sonic_test.gen      	  # ROMs comercial do somic para teste no emulador mega drive
│
├── 📁 docs/                     # 📚 BASE DE CONHECIMENTO (ARQUITETURA)
│   ├── 00_AI_DIRECTIVES.md      # Ponto de entrada para QUALQUER IA (leia primeiro)
│   ├── 01_PRD_MASTER.md         # Visão do Produto
│   ├── 02_TECH_STACK.md         # Tecnologias aprovadas (Rust + Tauri + React)
│   ├── 03_ROADMAP_MVP.md        # Fases de desenvolvimento e checkboxes de progresso
│   ├── 04_HARDWARE_SPECS.md     # Limites imutáveis dos consoles (Mega Drive/SNES)
│   ├── 05_ARCHITECTURE_UGDM.md  # Schema JSON dos jogos (.rds)
│   ├── 06_AI_MEMORY_BANK.md     # Diário de bordo da IA (estado atual + próximo passo)
│   ├── 07_TEST_AND_COMPLIANCE.md# Regras legais e de testes
│   ├── 08_TREE_ARCHITECTURE.md  # ESTE ARQUIVO (Mapa do projeto)
│   └── PROMPT_CONTINUIDADE.md   # Prompt padrão para onboarding de qualquer IA
│
├── 📁 src/                      # 🖥️ FRONTEND (UI DO EDITOR - REACT/TS)
│   ├── main.tsx                 # Entrypoint do React (monta #root)
│   ├── App.tsx                  # Layout Base do Editor (Docking System 3 painéis)
│   ├── vite-env.d.ts            # Types do Vite (/// <reference types="vite/client" />)
│   ├── 📁 assets/               # Ícones da UI, logos e fontes do Editor
│   ├── 📁 components/           # Componentes Visuais Reutilizáveis
│   │   ├── 📁 common/           # Botões, Inputs, Modais, Tabs (Dumb components)
│   │   ├── 📁 inspector/        # Painel de propriedades (Direita)
│   │   ├── 📁 hierarchy/        # Árvore de entidades da cena (Esquerda)
│   │   └── 📁 viewport/         # Emulador / Canvas WebGPU (Centro)
│   ├── 📁 core/                 # Lógica do Frontend
│   │   ├── 📁 ipc/              # Funções que chamam o Rust via invoke() Tauri
│   │   └── 📁 store/            # Estado global (Zustand) — seleção, abas, cena ativa
│   ├── 📁 styles/               # CSS Global: index.css com @import "tailwindcss"
│   └── 📁 views/                # Telas completas (SceneEditor, NodeGraphEditor, RetroFX)
│
├── 📁 src-tauri/                # ⚙️ BACKEND (CORE ENGINE - RUST)
│   ├── Cargo.toml               # Dependências: tauri 2, serde, tauri-plugin-opener
│   ├── Cargo.lock               # Lock file gerado pelo cargo (não editar)
│   ├── build.rs                 # Script de pré-compilação: tauri_build::build()
│   ├── tauri.conf.json          # Config da janela nativa, permissões IPC, bundle
│   ├── 📁 .cargo/               # Config local do cargo (não commitar secrets aqui)
│   │   └── config.toml          # jobs=2 + RUST_MIN_STACK=16MB (fix Windows stack overflow)
│   ├── 📁 capabilities/         # Permissões Tauri v2 (substituem allowlist do v1)
│   │   └── default.json         # core:default + opener:default para janela principal
│   ├── 📁 icons/                # Ícones gerados por: npm run tauri icon app-icon.png
│   │   ├── icon.ico             # Windows
│   │   ├── icon.icns            # macOS
│   │   ├── 32x32.png            # Linux/tray
│   │   ├── 128x128.png          # Linux
│   │   └── 128x128@2x.png       # Linux HiDPI
│   └── 📁 src/                  # Código fonte Rust (O Cérebro)
│       ├── main.rs              # Entry point desktop: chama app_lib::run()
│       ├── lib.rs               # Lógica principal: Builder, plugins, comandos IPC
│       ├── 📁 core/             # O "Retro Runtime Core" (RRC)
│       │   ├── memory_pool.rs   # Gerenciador estático de memória
│       │   └── project_mgr.rs   # Leitura/Escrita dos arquivos `.rds` no disco
│       ├── 📁 hardware/         # Hardware Constraint Engine & Profiles
│       │   ├── md_profile.rs    # Regras matemáticas do Mega Drive (doc 04)
│       │   └── snes_profile.rs  # Regras matemáticas do SNES
│       ├── 📁 compiler/         # Motor de Tradução (UGDM -> C/Assembly)
│       │   ├── ast_generator.rs # Árvore de sintaxe abstrata
│       │   ├── sgdk_emitter.rs  # Gera código C para Mega Drive (SGDK)
│       │   └── build_orch.rs    # Invoca GCC/Toolchain externa via subprocesso
│       ├── 📁 emulator/         # Integração FFI com Libretro
│       │   ├── libretro_ffi.rs  # Ponte FFI com C/C++ cores (Genesis Plus GX)
│       │   └── frame_buffer.rs  # Envia pixels do Rust para o Canvas React (WebGPU)
│       └── 📁 ugdm/             # Parser Universal Game Data Model
│           ├── entities.rs      # Structs baseadas no schema de docs/05
│           └── components.rs    # Transform, MetaSprite, PhysicsBody
│
├── 📁 scripts/                  # 🧰 Scripts de validação e automação
│   ├── bootstrap.ps1            # ⚠️ Setup automatizado (tem bugs de encoding — usar run-bootstrap.ps1)
│   ├── check-tree.cjs           # ✅ Valida estrutura da raiz (Node.js CJS — use este)
│   ├── check-tree.ps1           # Valida estrutura da raiz (PowerShell)
│   └── create-icon.mjs          # Gera app-icon.png 512x512 para alimentar tauri icon
│
└── 📁 toolchains/               # 🧰 COMPILADORES (IGNORADO NO GIT — baixar separadamente)
    ├── 📁 sgdk/                 # Toolchain do Mega Drive: GCC m68k + SGDK
    └── 📁 pvsneslib/            # Toolchain do SNES: WLA-DX + PVSnesLib
```

---

## 🚧 Regras de Inserção de Arquivos (Para IAs)

* **Arquivos de Interface Gráfica:** Qualquer coisa relacionada a botões, drag-and-drop, layout CSS ou renderização WebGL vai para `/src/`.
* **Arquivos de Processamento Pesado:** Leitura de arquivos `.json`, compilação de código, parseamento de ROMs, cálculos de VRAM e comunicação com o Emulador C/C++ vão para `/src-tauri/src/`.
* **Comunicação entre os dois:** Use estritamente as tipagens dentro de `/src/core/ipc/` no Frontend e funções anotadas com `#[tauri::command]` em `/src-tauri/src/main.rs`.
