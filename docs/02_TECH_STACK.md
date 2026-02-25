# 🛠️ 02 - TECH STACK & ARQUITETURA DE SISTEMA
**Status:** Definitivo  
**Regra de Ouro:** Nenhuma nova tecnologia, linguagem ou framework pode ser adicionado a este projeto sem a alteração e aprovação explícita neste documento.

---

## 🎯 1. PRINCÍPIOS ARQUITETURAIS
Para manter o projeto performático, seguro e livre de "inchaço" (bloatware):
1. **Performance Nativa:** O Core da engine, a simulação de hardware e a compilação devem rodar em linguagem compilada nativa (Rust/C++).
2. **UI Moderna, mas Desacoplada:** A interface do Editor (UI) deve ser rica e componentizada, mas o seu travamento não pode afetar a thread de emulação.
3. **Zero Garbage Collection no Loop Principal:** A camada RRC (Retro Runtime Core) não pode sofrer engasgos de GC.

---

## 🏗️ 2. A STACK DEFINITIVA

### 🖥️ Camada 1: Editor / Frontend (A Interface)
* **Framework Desktop:** [Tauri](https://tauri.app/) (Substitui o Electron. Usa WebView nativo, consumindo 80% menos RAM).
* **Linguagem da UI:** TypeScript.
* **Framework de UI:** React (com Vite para build ultrarrápido).
* **Renderização do *Game View* / *NodeGraph*:** WebGPU / WebGL2 (via Canvas) comunicando-se diretamente com o backend Rust para desenhar os frames do emulador.
* **Estilização:** TailwindCSS (para garantir um design system rápido e consistente estilo Unity/VS Code).

### ⚙️ Camada 2: Backend / Core App (O Cérebro)
* **Linguagem Principal:** Rust 🦀.
    * *Por quê:* Segurança de memória absoluta (evita *segfaults* ao manipular ROMs e ponteiros), concorrência fearless (para build multi-target) e performance equivalente ao C++.
* **Comunicação UI <-> Core:** Tauri IPC (Inter-Process Communication). Todo processamento pesado (geração de AST, conversão de assets, extração de ROM) acontece em Rust; o React apenas exibe o resultado.

### 🎮 Camada 3: Emulação & Hardware Engine
* **Padrão de Integração:** [Libretro API](https://www.libretro.com/).
    * *Estratégia:* Ao invés de escrever um emulador do zero, o RetroDev Studio (em Rust) carrega "Cores" do Libretro via *FFI (Foreign Function Interface)*.
    * *Mega Drive Core:* Genesis Plus GX (C).
    * *SNES Core:* Snes9x ou bsnes (C++).
* **Manipulação de Memória (Deep Profiler):** O backend Rust intercepta a memória mapeada pelo Core Libretro para alimentar os visualizadores do Editor (VRAM heatmap, DMA timeline).

### 🧰 Camada 4: Toolchains & SDKs Alvo (A Saída)
O código exportado pelo Editor (UGDM -> C/Assembly) é compilado usando as ferramentas canônicas da comunidade retro:
* **Mega Drive / Genesis:**
    * Compilador: GCC (Toolchain m68k-elf).
    * SDK Base: [SGDK](https://github.com/Stephane-D/SGDK) (Stephane's Genesis Development Kit).
* **SNES:**
    * Compilador: WLA-DX (Assembly) ou TCC-816.
    * SDK Base: [PVSnesLib](https://github.com/alekmaul/pvsneslib).
* *Nota:* O RetroDev Studio deve embutir ou fazer o download automático dessas toolchains de forma transparente para o usuário (Dockerização interna ou binários pre-build).

### 💾 Camada 5: UGDM & Armazenamento de Dados
Como os projetos são salvos no disco:
* **Configurações e Metadados (Legibilidade):** JSON estruturado (`.rds` project files).
* **Cenas e NodeGraphs:** JSON ou YAML (fácil para versionamento no Git).
* **Assets Compilados (Alta Performance):** Formato binário customizado gerado pelo backend Rust (ex: `.chr` otimizado, `.vgm` para áudio) pronto para ser injetado na ROM.
* **ROM Patching Layer:** Algoritmos BPS e IPS nativos implementados em Rust.

---

## 🚫 3. RESTRIÇÕES RÍGIDAS (PARA AGENTES DE IA)

**Leia atentamente antes de sugerir ou escrever código:**

1. **PROIBIDO Electron:** O framework desktop é Tauri. Não sugira dependências do ecossistema Node.js que exijam binários nativos gigantes no frontend.
2. **PROIBIDO Python/Scripts Lentos no Runtime:** Nenhuma parte da compilação de cena (Scene to ROM) pode depender de scripts Python em tempo de execução. O pipeline de build é 100% Rust.
3. **Gerenciamento de Estado no React:** Use Zustand ou Context API. Não use Redux (overkill para o nosso caso de uso, que delega a maior parte do estado "real" para o backend Rust).
4. **Alocação na Simulação de Hardware:** Ao escrever código em Rust que analisa o frame do emulador (para a *Hardware Constraint Engine*), use buffers estáticos (`[u8; 65536]`). **NÃO use `Vec::new()` dentro de loops de 60Hz.**
5. **NodeGraph Logic:** A conversão de Blueprint/Nodes para código nativo (C) deve ser feita gerando uma AST (Abstract Syntax Tree) forte em Rust, que então faz o "pretty print" para código C válido do SGDK/PVSnesLib. Não faça concatenação de strings espaguete para gerar código C.

---

## 🔗 4. FLUXO DE COMPILAÇÃO MACRO (Exemplo Mega Drive)

1. Usuário clica em "Build & Run" no React (UI).
2. Tauri envia comando IPC para o Backend (Rust).
3. Rust lê o UGDM (JSON) e gera arquivos `.c` e `.res` compatíveis com o SGDK.
4. Rust chama o GCC (m68k) via subprocesso oculto.
5. GCC gera a ROM (`out.md`).
6. Rust carrega a ROM na memória e injeta no Core do Libretro.
7. O frame buffer do Libretro é passado para o frontend WebGPU a 60 FPS.