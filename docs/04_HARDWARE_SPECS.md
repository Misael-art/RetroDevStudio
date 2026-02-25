# 🧮 04 - HARDWARE SPECS & REGRAS DE VALIDAÇÃO MATEMÁTICA
**Status:** Imutável (Baseado em silício real)

> ⚠️ **ATENÇÃO AGENTES DE IA (DIRETRIZ MATEMÁTICA ABSOLUTA):** 
> Este documento contém as leis físicas dos consoles 16-bits. **VOCÊ NÃO PODE ALTERAR ESTES NÚMEROS.** 
> Se o usuário solicitar a renderização de algo que ultrapasse os limites definidos aqui (ex: 81 sprites no Mega Drive), você DEVE recusar, alertar sobre o limite de hardware e sugerir técnicas de contorno (ex: multiplexing, flickering). Ao gerar código C ou Assembly, você DEVE criar validações que respeitem estas tabelas.

---

## 🔵 1. SEGA MEGA DRIVE / GENESIS (Perfil de Hardware)

### 🧠 Processamento e Memória
* **CPU Principal:** Motorola 68000 @ 7.67 MHz (NTSC) / 7.60 MHz (PAL)
* **Co-processador (Áudio):** Zilog Z80 @ 3.58 MHz
* **Work RAM (WRAM):** 64 KB (Limite absoluto para variáveis do jogo)
* **Video RAM (VRAM):** 64 KB (Armazena Tiles, Sprite maps, Scroll tables)
* **Audio RAM (ARAM):** 8 KB

### 📺 Gráficos (VDP - Video Display Processor)
* **Resolução Padrão:** 320x224 pixels (Modo H40 - Recomendado) ou 256x224 (Modo H32).
* **Tile Size:** 8x8 pixels (Ocupa 32 bytes na VRAM em 4bpp).
* **Planos de Fundo (Backgrounds):** 
  * 2 Planos com Scroll (Scroll A e Scroll B).
  * 1 Plano Fixo (Window Plane - Substitui parte do Scroll A, não tem scroll próprio, usado para HUDs).
* **Paleta de Cores:** 
  * Total de cores possíveis: 512 (RGB 9-bit).
  * Cores simultâneas na tela: 64 cores (4 paletas de 16 cores).
  * *Atenção:* O índice 0 de cada paleta é sempre transparente. Na prática, são 60 cores utilizáveis.

### 👾 Sprites
* **Limite Total em Tela:** 80 sprites (Modo H40).
* **Limite por Scanline:** 20 sprites (ou 320 pixels de largura de sprite por linha de varredura. Se passar disso, o hardware para de desenhar a linha, causando *drop* de sprites).
* **Tamanhos Permitidos:** Qualquer combinação de grade de 8x8 até 32x32 (ex: 8x8, 8x16, 16x24, 32x32). O hardware não suporta sprites 64x64 nativamente (devem ser montados unindo vários sprites - *Meta-sprites*).

### 🎵 Áudio
* **Sintetizador FM:** YM2612 (6 canais FM). O Canal 6 pode ser usado para reproduzir samples de voz (PCM 8-bit), mas exige uso intensivo do Z80 ou CPU.
* **Gerador de Som Programável (PSG):** SN76489 (3 canais de onda quadrada + 1 canal de ruído branco).

---

## 🟣 2. SUPER NINTENDO (SNES) (Perfil de Hardware)
*(Para Fase 2)*

### 🧠 Processamento e Memória
* **CPU Principal:** Ricoh 5A22 (Custom WDC 65C816) @ 3.58 MHz (Variável dependendo do FastROM/SlowROM).
* **Co-processador (Áudio):** Sony SPC700 @ 1.024 MHz
* **Work RAM (WRAM):** 128 KB
* **Video RAM (VRAM):** 64 KB
* **Audio RAM (ARAM):** 64 KB (Exclusiva do SPC700, inacessível diretamente pela CPU principal após o boot).

### 📺 Gráficos (PPU - Picture Processing Unit)
* **Resolução Padrão:** 256x224 pixels. (Suporta 512x224 ou 512x448 interlaçado, com penalidades severas de performance e VRAM).
* **Tile Size:** 8x8 ou 16x16 pixels.
* **Planos de Fundo (Modos principais):**
  * **Mode 1 (Padrão):** 2 planos com paletas de 16 cores + 1 plano com paleta de 4 cores.
  * **Mode 7:** 1 plano com 256 cores, permite rotação e escala por hardware (Matriz Afim).
* **Paleta de Cores (CGRAM):** 
  * Total de cores possíveis: 32.768 (RGB 15-bit).
  * Cores simultâneas na tela: 256 cores (geralmente divididas em 8 paletas de 16 para BG e 8 paletas de 16 para Sprites).

### 👾 Sprites (OAM)
* **Limite Total em Tela:** 128 sprites.
* **Limite por Scanline:** 32 sprites (ou 272 pixels de largura por linha de varredura).
* **Tamanhos Permitidos:** O SNES suporta sprites de 8x8 até 64x64, **PORÉM**, você só pode escolher **DOIS** tamanhos por frame para todo o jogo (ex: Todos os sprites do jogo devem ser ou 8x8 ou 16x16. Para fazer um chefão 64x64 nesse cenário, o dev deve juntar vários sprites de 16x16).

---

## 🚦 3. REGRAS DA "HARDWARE CONSTRAINT ENGINE"

Sempre que a IA ou o Backend Rust for compilar uma *Scene* (UGDM) para C/Assembly, as seguintes validações matemáticas OBRIGATÓRIAS devem ocorrer antes de chamar o compilador:

### Validação de VRAM (O Gargalo Crítico)
* **Regra:** A soma do peso de todos os Tileset Backgrounds + Tiles de Sprites carregados na memória ao mesmo tempo **NÃO PODE EXCEDER** 64 KB (65.536 bytes).
* **Lógica do Motor:** 
  1 tile (8x8 em 4bpp) = 32 bytes.
  Se a UI tenta injetar 2100 tiles na cena (2100 * 32 = 67.200 bytes), o build **DEVE FALHAR** no Editor com o erro: `"VRAM Overflow: A cena consome 67.2KB. O limite do console é 64KB."`

### Validação de DMA (Direct Memory Access)
* **Regra:** Não é possível transferir a VRAM inteira em um único frame (1/60 de segundo). A transferência só pode ocorrer de forma segura durante o **VBlank** (o tempo em que o feixe de elétrons da TV volta do fim para o começo da tela).
* **Mega Drive (VBlank Window):** Permite transferir cerca de ~7.2 KB de dados por frame (H40, NTSC).
* **Lógica do Motor:** Se a IA ou o usuário programar uma animação que tenta atualizar os tiles de um chefe inteiro (ex: 10 KB de dados de sprite) no mesmo frame (60 FPS), o build **DEVE AVISAR**: `"DMA Bandwidth Exceeded. Isso causará artefatos visuais ou slowdown. Considere carregar a animação antecipadamente ou dividir a transferência em 2 frames."`

### Resumo de Constraints para a Engine:
| Métrica | Limite Mega Drive (H40) | Limite SNES | Ação do Editor RetroDev |
| :--- | :--- | :--- | :--- |
| **Sprites / Tela** | Max 80 | Max 128 | Bloqueio no Spawn (Erro) |
| **Sprites / Scanline**| Max 20 | Max 32 | Alerta Visual (Flicker Warning) |
| **VRAM Total** | 64 KB | 64 KB | Hard Crash/Erro de Build |
| **Tamanho ROM** | Max 4 MB (Sem mapper) | Max 4 MB (HiROM) | Alerta de Mapeamento Extra |
| **Paletas** | 4 de 16 cores | 16 de 16 cores | Conversão automática (Asset Converter) |