# 05 - UGDM (Universal Game Data Model) - Especificacao Tecnica
**Status:** Definitivo
**Dependencias:** `02_TECH_STACK.md`, `04_HARDWARE_SPECS.md`

> **ATENCAO AGENTES DE IA (DIRETRIZ DE MODELAGEM):**
> O UGDM e o formato central de dados do RetroDev Studio. Todo jogo e representado como UGDM antes de ser compilado para qualquer plataforma.
> **REGRA ABSOLUTA:** Nenhuma struct, campo ou enum do UGDM pode conter referencias diretas a registradores, enderecos de memoria ou nomes de hardware especificos (ex: VDP, PPU, OAM, CRAM). A traducao para hardware ocorre EXCLUSIVAMENTE nos Hardware Profiles (`src-tauri/src/hardware/`).
> Se voce precisar representar "paleta de cores", use `ColorPalette` — NUNCA `CRAM` ou `VDP_PAL`.

---

## 1. PRINCIPIOS DE DESIGN

1. **Agnostico:** O UGDM descreve jogos em termos matematicos e logicos, sem dependencia de plataforma.
2. **Serializavel:** Tudo e JSON puro, compativel com Git (diff-friendly).
3. **Validavel:** Cada campo tem tipo, range e restricoes documentados. O backend Rust valida o schema antes de compilar.
4. **Extensivel:** Novos componentes podem ser adicionados sem quebrar projetos existentes (campos opcionais com defaults).

---

## 2. ESTRUTURA DO ARQUIVO DE PROJETO (`.rds`)

Um projeto RetroDev e um diretorio contendo:

```text
MeuJogo/
  project.rds          # Metadados do projeto (target, versao, config)
  scenes/
    title_screen.json   # Cena: tela de titulo
    level_01.json       # Cena: fase 1
  assets/
    sprites/            # PNGs de sprites organizados
    tilesets/            # PNGs de tilesets
    audio/              # Arquivos de audio (VGM, WAV para conversao)
  prefabs/
    player.json         # Entidades reutilizaveis
```

---

## 3. SCHEMA: PROJECT (project.rds)

```json
{
  "rds_version": "1.0.0",
  "name": "MeuJogo",
  "target": "megadrive",
  "resolution": { "width": 320, "height": 224 },
  "fps": 60,
  "palette_mode": "4x16",
  "entry_scene": "scenes/title_screen.json",
  "build": {
    "output_dir": "build/",
    "optimization": "size"
  }
}
```

### Campos Obrigatorios

| Campo | Tipo | Valores Aceitos | Descricao |
|-------|------|----------------|-----------|
| `rds_version` | string | SemVer | Versao do schema UGDM |
| `name` | string | — | Nome do projeto |
| `target` | string | `"megadrive"`, `"snes"` | Plataforma alvo (define qual Hardware Profile usar) |
| `resolution` | object | Fixo por target | Resolucao nativa do console |
| `fps` | number | `60` (NTSC), `50` (PAL) | Taxa de quadros alvo |
| `entry_scene` | string | path relativo | Cena inicial ao rodar o jogo |

**Regra para IA:** O campo `target` determina qual Hardware Profile (doc 04) sera usado para validacao. Nunca assuma valores — leia o `project.rds`.

---

## 4. SCHEMA: SCENE (scenes/*.json)

Uma cena e a unidade basica de jogo (fase, menu, cutscene).

```json
{
  "scene_id": "level_01",
  "display_name": "Fase 1 - Green Hill",
  "background_layers": [
    {
      "layer_id": "bg_far",
      "depth": 0,
      "tileset": "assets/tilesets/sky.png",
      "scroll_speed": { "x": 0.5, "y": 0.0 },
      "tilemap": "assets/tilesets/sky_map.json"
    },
    {
      "layer_id": "bg_near",
      "depth": 1,
      "tileset": "assets/tilesets/ground.png",
      "scroll_speed": { "x": 1.0, "y": 0.0 },
      "tilemap": "assets/tilesets/ground_map.json"
    }
  ],
  "entities": [
    {
      "entity_id": "player_1",
      "prefab": "prefabs/player.json",
      "transform": { "x": 32, "y": 160 },
      "components": {}
    },
    {
      "entity_id": "enemy_01",
      "prefab": null,
      "transform": { "x": 200, "y": 160 },
      "components": {
        "sprite": {
          "asset": "assets/sprites/badnik.png",
          "frame_width": 24,
          "frame_height": 24,
          "animations": {
            "walk": { "frames": [0, 1, 2, 3], "fps": 8, "loop": true }
          }
        },
        "collision": {
          "shape": "aabb",
          "width": 24,
          "height": 24,
          "solid": true
        }
      }
    }
  ],
  "palettes": [
    { "slot": 0, "colors": ["#000000", "#2244AA", "#44AAFF", "#FFFFFF", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000"] }
  ]
}
```

### Regras de Validacao da Scene

| Regra | Descricao | Acao ao Violar |
|-------|-----------|----------------|
| Max entities | Depende do `target` (MD: 80 sprites, SNES: 128) | Erro de build |
| Max background_layers | MD: 2 scroll + 1 window, SNES: varia por mode | Erro de build |
| Palette slots | MD: 4 slots de 16 cores, SNES: 16 slots de 16 | Erro se exceder |
| VRAM total | Soma de todos tiles carregados <= 64KB | Erro de build |

---

## 5. SCHEMA: ENTITY (Unidade Basica de Jogo)

Uma entidade e qualquer "coisa" na cena: jogador, inimigo, item, trigger, HUD element.

```json
{
  "entity_id": "player_1",
  "prefab": "prefabs/player.json",
  "transform": { "x": 0, "y": 0 },
  "components": {
    "sprite": { },
    "collision": { },
    "input": { },
    "physics": { },
    "audio": { },
    "logic": { },
    "custom": { }
  }
}
```

### Transform (Obrigatorio)

| Campo | Tipo | Descricao |
|-------|------|-----------|
| `x` | integer | Posicao horizontal em pixels (0 = esquerda) |
| `y` | integer | Posicao vertical em pixels (0 = topo) |

**Regra:** Coordenadas sao SEMPRE em pixels inteiros. Nao use float. Hardware 16-bit opera em inteiros.

---

## 6. SCHEMA: COMPONENTS (Modular e Extensivel)

### 6.1 Sprite Component

```json
{
  "sprite": {
    "asset": "assets/sprites/player.png",
    "frame_width": 16,
    "frame_height": 24,
    "pivot": { "x": 8, "y": 24 },
    "palette_slot": 0,
    "animations": {
      "idle": { "frames": [0], "fps": 1, "loop": true },
      "walk": { "frames": [1, 2, 3, 4], "fps": 10, "loop": true },
      "jump": { "frames": [5], "fps": 1, "loop": false }
    },
    "priority": "foreground"
  }
}
```

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|------------|-----------|
| `asset` | string | Sim | Caminho relativo ao PNG do spritesheet |
| `frame_width` | integer | Sim | Largura de cada frame em pixels (multiplo de 8) |
| `frame_height` | integer | Sim | Altura de cada frame em pixels (multiplo de 8) |
| `pivot` | object | Nao | Ponto de ancora (default: centro-inferior) |
| `palette_slot` | integer | Nao | Indice da paleta (0-3 MD, 0-15 SNES). Default: 0 |
| `animations` | object | Nao | Mapa nome->animacao |
| `priority` | string | Nao | `"foreground"` ou `"background"`. Default: `"foreground"` |

**Regra para IA:** `frame_width` e `frame_height` DEVEM ser multiplos de 8. Se o usuario especificar 17x25, o build DEVE falhar com: `"Sprite dimensions must be multiples of 8 (tile-aligned). Got 17x25."`

### 6.2 Collision Component

```json
{
  "collision": {
    "shape": "aabb",
    "width": 16,
    "height": 24,
    "offset": { "x": 0, "y": 0 },
    "solid": true,
    "layer": "player",
    "collides_with": ["enemy", "collectible", "terrain"]
  }
}
```

### 6.3 Input Component

```json
{
  "input": {
    "device": "joypad_1",
    "mapping": {
      "move_left": "DPAD_LEFT",
      "move_right": "DPAD_RIGHT",
      "jump": "BUTTON_A",
      "attack": "BUTTON_B"
    }
  }
}
```

**Valores de botao validos (agnoisticos):**
`DPAD_UP`, `DPAD_DOWN`, `DPAD_LEFT`, `DPAD_RIGHT`, `BUTTON_A`, `BUTTON_B`, `BUTTON_C`, `BUTTON_X`, `BUTTON_Y`, `BUTTON_Z`, `START`, `SELECT`

**Regra:** O Hardware Profile mapeia esses nomes para os botoes reais. MD tem A/B/C/Start. SNES tem A/B/X/Y/L/R/Start/Select. O UGDM usa o superconjunto; o Profile descarta os invalidos.

### 6.4 Physics Component (Simplificado)

```json
{
  "physics": {
    "gravity": true,
    "gravity_strength": 6,
    "max_velocity": { "x": 4, "y": 8 },
    "friction": 2,
    "bounce": 0
  }
}
```

**Regra:** Todos os valores sao inteiros representando subpixels (1/16 de pixel por frame). Isso reflete a matematica de ponto fixo usada em hardware 16-bit. Nao use floats.

### 6.5 Audio Component

```json
{
  "audio": {
    "sfx": {
      "jump": "assets/audio/jump.wav",
      "hit": "assets/audio/hit.wav"
    },
    "bgm": "assets/audio/level1.vgm"
  }
}
```

### 6.6 Logic Component (Referencia ao NodeGraph)

```json
{
  "logic": {
    "graph": "graphs/player_controller.json",
    "variables": {
      "health": { "type": "int", "default": 3, "min": 0, "max": 99 },
      "score": { "type": "int", "default": 0, "min": 0, "max": 999999 }
    }
  }
}
```

**Regra:** Variaveis de logica usam APENAS tipos suportados por hardware 16-bit: `int` (16-bit signed, -32768 a 32767), `uint` (16-bit unsigned, 0 a 65535), `bool`, `byte` (8-bit unsigned). Nao use `float`, `string` ou `array` como variaveis de jogo.

---

## 7. SCHEMA: PREFAB (Entidade Reutilizavel)

Um prefab e um template de entidade. Ao instanciar, a Scene pode sobrescrever campos especificos.

```json
{
  "prefab_id": "player",
  "base_entity": {
    "transform": { "x": 0, "y": 0 },
    "components": {
      "sprite": { "asset": "assets/sprites/player.png", "frame_width": 16, "frame_height": 24 },
      "collision": { "shape": "aabb", "width": 16, "height": 24, "solid": true, "layer": "player" },
      "input": { "device": "joypad_1" },
      "physics": { "gravity": true, "gravity_strength": 6 },
      "logic": { "graph": "graphs/player_controller.json" }
    }
  }
}
```

**Regra de Merge:** Quando a Scene referencia um prefab e tambem define `components`, os campos da Scene tem prioridade (override). O backend Rust faz o deep merge.

---

## 8. REGRAS DE VALIDACAO UGDM (CHECKLIST PARA IA)

Antes de gerar codigo C a partir de um UGDM, o backend Rust DEVE executar estas validacoes na ordem:

| # | Validacao | Fonte da Regra | Acao ao Falhar |
|---|-----------|---------------|----------------|
| 1 | `rds_version` e compativel | Este doc | Erro fatal |
| 2 | `target` e valido | `02_TECH_STACK.md` | Erro fatal |
| 3 | Todos os `asset` paths existem no disco | Filesystem | Erro fatal |
| 4 | `frame_width` e `frame_height` sao multiplos de 8 | Este doc | Erro fatal |
| 5 | Total de sprites na scene <= limite do target | `04_HARDWARE_SPECS.md` | Erro fatal |
| 6 | Total de VRAM (tiles) <= 64KB | `04_HARDWARE_SPECS.md` | Erro fatal |
| 7 | Palettes nao excedem slots do target | `04_HARDWARE_SPECS.md` | Erro fatal |
| 8 | Variaveis de logica usam tipos validos | Este doc (secao 6.6) | Erro fatal |
| 9 | Background layers nao excedem limites do target | `04_HARDWARE_SPECS.md` | Erro fatal |
| 10 | DMA bandwidth por frame estimada | `04_HARDWARE_SPECS.md` | Warning |

---

## 9. FLUXO DE COMPILACAO (UGDM -> ROM)

```text
[project.rds] --> Rust: Carrega e valida schema
       |
       v
[scenes/*.json] --> Rust: Resolve prefabs (deep merge)
       |
       v
[UGDM Validado] --> Rust: Hardware Profile filtra para target
       |
       v
[AST Intermediaria] --> Rust: Gera codigo C (SGDK) ou ASM (PVSnesLib)
       |
       v
[main.c + resources.res] --> GCC m68k (subprocesso)
       |
       v
[out.md] --> ROM pronta para emulacao
```

**Regra para IA:** Este fluxo e sequencial e determinisitco. Nenhuma etapa pode ser pulada. Se a validacao (passo 3) falhar, o compilador NAO deve ser invocado.

---

**[Fim da Especificacao UGDM]**
*Este documento define o contrato entre o Editor (React) e o Backend (Rust). Qualquer alteracao neste schema requer atualizacao simultanea em: este documento, os structs Rust em `src-tauri/src/ugdm/`, e os tipos TypeScript em `src/core/ipc/`.*
