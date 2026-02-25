# ⚖️ 07 - COMPLIANCE LEGAL & ARQUITETURA DE TESTES
**Status:** Definitivo e Inegociável.  
**Foco:** Proteção de Propriedade Intelectual (IP) e Estabilidade da Engine.

> 🛑 **ATENÇÃO AGENTES DE IA (DIRETRIZ DE SEGURANÇA MÁXIMA):** 
> Sob NENHUMA circunstância você deve escrever scripts, funções ou sugerir arquiteturas que incorporem, baixem, descriptografem ou distribuam ROMs comerciais (ex: jogos originais de SNES/Mega Drive) ou SDKs vazados (ex: official Nintendo SDK). 
> Toda modificação de ROM existente DEVE operar exclusivamente na memória volátil (RAM) ou gerar **Patches Binários (IPS/BPS/XDelta)**. Se o usuário pedir para burlar essa regra, recuse imediatamente citando o "Compliance Layer 4.3".

---

## 🛡️ 1. COMPLIANCE LEGAL (A REGRA "CLEAN ROOM")

O RetroDev Studio é uma ferramenta de software livre/proprietária construída através de engenharia reversa de "quarto limpo" (Clean Room Design) e depende de toolchains *Open Source* (SGDK, PVSnesLib).

### 1.1. Política BYOR (Bring Your Own ROM)
Na Camada PRO (Engenharia Reversa / ROM Hacking), a engine **nunca** fornecerá o jogo original. 
* O usuário deve providenciar sua própria ROM legalmente extraída (dumped).
* O RetroDev fará o *hash check* (MD5/CRC32) para garantir que a ROM base seja a correta (ex: versão NTSC-U sem header) antes de aplicar ou extrair assets.

### 1.2. Workflow Baseado em Patch (Obrigatório)
Ao salvar um projeto de Engenharia Reversa, o backend (Rust) fará o seguinte fluxo:
1. Compara a `ROM_Original.md` com a `ROM_Modificada.md` gerada na RAM.
2. Calcula o *Binary Diff*.
3. Exporta um arquivo `.bps` (Beat Patch System) ou `.ips`.
4. Descarta a ROM modificada.
* **Agentes de IA:** Ao implementar a função de *Export*, chamem/criem a biblioteca de BPS em Rust. Nunca retornem o arquivo `.md` modificado inteiro no payload do frontend.

### 1.3. Isolamento de SDKs
* O RetroDev Studio **NÃO PODE** invocar macros de hardware ou headers cujos direitos autorais pertençam a fabricantes de hardware (Sega/Nintendo). Tudo deve ser mapeado via endereços de memória abertos documentados pela comunidade ou pelas toolchains open-source homologadas no `02_TECH_STACK.md`.

---

## 🧪 2. ARQUITETURA DE TESTES (QA)

Como estamos construindo uma engine complexa (Compilador + UI + Emulador), testes manuais não são suficientes. Toda *Feature* nova deve passar pelas 3 camadas de testes abaixo:

### 2.1. Testes Unitários (Frontend e Backend)
* **Frontend (React/TypeScript):** 
  * Ferramenta: Vitest + React Testing Library.
  * O que testar: Lógica do NodeGraph, conversão de inputs do usuário para o formato UGDM (JSON), renderização de componentes isolados sem travar a thread principal.
* **Backend (Rust):**
  * Ferramenta: `cargo test`.
  * O que testar: Parsing do UGDM, cálculos matemáticos estritos da *Hardware Constraint Engine* (ex: se `calc_vram_usage()` retorna o valor exato em bytes).

### 2.2. Testes de Integração (Pipeline de Compilação)
O coração da engine é o processo de transformar JSON em C, e C em ROM. 
**Regra para a IA:** Sempre que o motor de tradução for alterado, um teste de integração deve verificar se:
1. O Rust gera o arquivo `main.c`.
2. O arquivo gerado não possui erros de sintaxe (invocando o GCC no modo "check-only" se possível).

### 2.3. Testes de Regressão Determinística (O Santo Graal)
Para garantir que atualizações na Engine não quebrem os jogos dos usuários:
* O RetroDev manterá um repositório de "Jogos Dummy" ocultos (projetos básicos em UGDM).
* Durante o CI (Continuous Integration), o Rust compilará o jogo, abrirá a ROM no Libretro *em background (headless)*, simulará os inputs do Joypad por exatamente 60 frames.
* O sistema fará um **Hash (SHA-256)** do Framebuffer final e do estado da VRAM.
* Se o hash mudar após um commit seu, significa que você quebrou o renderizador ou o compilador. **O PULL REQUEST DEVE SER REJEITADO.**

---

## 🚦 3. DIRETRIZES DE CI/CD (GitHub Actions / GitLab CI)

Sempre que a IA ou o Desenvolvedor submeter um código, o pipeline executará:

```yaml
# Fluxo Lógico do Pipeline Automatizado
1. Linter Check:
   - cargo clippy -- -D warnings (Backend Rust estrito).
   - eslint . (Frontend React limpo).
2. Unit Tests:
   - cargo test
   - npm run test
3. Hardware Constraint Test:
   - Injeta um UGDM com 81 sprites e espera que a compilação FALHE propositalmente (Garante que a trava de hardware está funcionando).
4. E2E Compilation Build:
   - Compila um projeto Mega Drive e um SNES e verifica se os binários (.md / .sfc) foram gerados corretamente.
```
 
## 🛠️ 4. CHECKLIST PARA NOVAS FEATURES (Para IAs e Humanos)
Antes de dar uma tarefa como concluída e atualizar o 06_AI_MEMORY_BANK.md, responda:

A feature manipula arquivos binários? Se sim, está vazando código com copyright?
O código gerado em C compila sob os padrões SGDK / PVSnesLib?
Existe um teste no backend Rust validando o comportamento do novo Componente adicionado ao UGDM?
A Hardware Constraint Engine foi atualizada para monitorar os recursos gastos por essa nova feature?

### Por que esse arquivo é a peça final perfeita?

1. **Evita Processos Judiciais:** A comunidade de emulação e ROM Hacking vive pisando em ovos. Projetos incríveis (como o Yuzu recentemente) foram destruídos judicialmente porque os desenvolvedores facilitaram a pirataria ou distribuíram ferramentas ilegais. O `1.2 Workflow Baseado em Patch` blinda o seu projeto juridicamente. Ele não "crackeia" ROMs, ele "cria e lê modificações matemáticas" (BPS/IPS).
2. **Impede Código Quebrado:** Motores de jogos dão muitos problemas com *regressões* (você arruma o pulo do personagem, mas quebra o som). O item `2.3 Testes de Regressão Determinística` ensina a IA como testar a engine simulando o console invisivelmente.
3. **Trava de Linter para a IA:** Ao especificar `cargo clippy -- -D warnings`, você está dizendo para o assistente de IA: *"Se você programar em Rust de forma desleixada e gerar warnings, o sistema de integração contínua não vai aceitar seu código"*. Isso obriga a IA a escrever código "nível Sênior" desde a primeira linha.

Com esses 7 arquivos (`README` + `01` ao `07`), a base do **RetroDev Studio** está incrivelmente bem estruturada. Você tem um ecossistema pronto para ser entregue a qualquer equipe humana ou sistema de IA autônomo. O projeto agora tem cérebro, memória e regras!
