# Auditoria — MUGEN → SGDK (RetroDev × SGDK Forge)

Data: 2026-09-28. Frente: `codex/rex-mugen-sgdk`. Worktree:
`/home/misael/Projects/REX-MUGEN-SGDK-2026-09-28`. Base: `a08c2c680c6dd76eaf8d3ad6b5502a1db6532ccc`.
Host: `npm run host:diagnose` → **READY** (fingerprint `60249508…`).

## 1. Fontes auditadas

### RetroDev (base `a08c2c6`)

| Área | Local |
|---|---|
| importador | `src-tauri/src/core/project_mgr.rs` 5850–8200 (`import_mugen_project`, `parse_mugen_air`, `extract_mugen_sff_v1`, `compose_mugen_character_atlas`, `mugen_actions_to_animation_defs`, `mugen_collision_component_from_actions`, `imported_mugen_fighting_logic_graph`) |
| comandos | `core/input_commands.rs`, o parser canônico de notação |
| execução | `compiler/ast_generator.rs` (FSM, `input_command`, `sprite_anim`, `set_velocity`, `set_position`, `action_sound`), `compiler/sgdk_emitter.rs` (`.res`, `SPR_setAnim`) |
| paletização | `compiler/build_orch.rs::write_indexed_bmp_8bit_with_canvas_palette_limit` |
| testes | `project_mgr.rs`: `import_mugen_character_converts_cmd_air_cns_st_to_fighting_nodes`, `import_mugen_reimport_keeps_commands_and_graph_idempotent`, `smoke_import_mugen_project_is_idempotent`, `mugen_handles_*` |
| status declarado | roadmap: `mugen` Experimental, "falta prova ROM/Libretro para samples reais" |

### SGDK Forge — somente leitura

- **Cópia com o estado relevante:** `/mnt/sdcard/SGDKForge`, git
  `b659306663abf3e8c17016d28e43cebe52c41562` (2026-09-28 14:18 -0300), 80 entradas locais.
- `/home/misael/Projects/Sgdk Forge` não é repositório e contém só `SGDK_Engines`, sem o
  conversor.
- **Licença:** MIT na raiz (`LICENSE` sha256 `0b685fab…`). O runtime C (`mg_*.c`) tem como
  base o HAMOOPIG, de terceiros e com licença não verificada. **Não é copiado.**
- **Arquivos consultados** (sha256, 16 hex; estado git):

| sha256 | estado | arquivo (`tools/mugen2sgdk_forge/…`) |
|---|---|---|
| `2942ba2b878cda68` | limpo | `mugen2sgdk_forge/parsers/sff.py` |
| `b914b9f69aac03bd` | limpo | `mugen2sgdk_forge/parsers/air.py` |
| `21e3d4c2ec1ac28c` | limpo | `parsers/cmd.py` |
| `e44d420619c223fd` | limpo | `parsers/cns.py` |
| `60a39b730e934280` | limpo | `converters/sprites.py` |
| `12f00cea721574b1` | limpo | `provenance.py` |
| `9bd07ed3722ba29f` / `fef51865042274ee` / `ef609ad7927492aa` | limpo | `ir/expr.py` / `ir/controllers.py` / `ir/vm.py` |
| `1d9b8e8238d12071` / `5a791dafce7b2a2f` / `2b9451157ec762bc` | limpo | `runtime/mg_vm.c` / `mg_char.c` / `mg_fight.c` |
| `ae263dc06eef76fd` | **M** | `perf/read_sram_metrics.py` |
| `b52ede32cb0de97d` | **??** | `perf/observer_ab.py` |
| `3be1583d02530e41` / `a7279042a70a1649` | limpo | `doc/ROADMAP.md` / `doc/BASELINE_E0.md` |

Nenhum binário, script de bootstrap ou teste do doador foi executado.

## 2. Matriz

Legenda da decisão: **R** reutilizar, **A** adaptar, **S** substituir, **P** portar conceito
(reescrito, sem copiar código), **—** fora do perfil.

| Capacidade | RetroDev hoje | Forge | Prova disponível | Decisão | Limitação / risco |
|---|---|---|---|---|---|
| **SFF v1** (PCX 8 bpp, links, paleta compartilhada) | Rust `extract_mugen_sff_v1` → RGBA; fallback `work/*_sff` com PNGs pré-extraídos | Python + Pillow, índices 8 bits + paleta; v2 recusado | RD: fixture sem SFF real (PNGs em `work/`); Forge: Ken (conteúdo de terceiros) | **A**: parser Rust único na crate, que **preserva índices e paleta**, limita tamanho e contagem e diagnostica links | SFF v2 fora do perfil (os dois recusam) |
| **AIR**: tempos | `duration.max(1)`: **−1 vira 1 em silêncio**; `frames` com `filter_map` **desalinha** das durações quando falta sprite | preserva −1; `time` por frame | RD: teste só verifica duração 3 | **S**: parser da crate | −1 em frame não final: sem equivalente direto |
| **AIR**: CLSN | decide default × por-frame pela **posição**, não pelo cabeçalho; sem normalização | pelo cabeçalho; normaliza x1≤x2 | nenhum teste com CLSN em múltiplos frames | **S** | — |
| **AIR**: flip/blend | `parts[5..]` descarta vazios: `,,A` vira flip "A" (**ambíguo**) | posicional: campo 5 = flip, 6 = blend | nenhuma | **S** | blend sem equivalente no VDP: **não suportado**, diagnosticado |
| AIR: proveniência | sem linha; duplicatas e linhas inválidas ignoradas em silêncio | linha por frame; avisa duplicata | — | **S** | — |
| **Eixo/origem** | atlas com âncora comum por eixo do sprite (**preservado**) | célula ancorada no eixo | teste de atlas | **R** | célula = união de todos os sprites (custo de VRAM) |
| **Offset x/y por frame** | só metadado (`mugen_frames`) | usado pelo runtime HAMOOPIG | — | **A**: aplicado em execução | — |
| **Tempos na ROM** | emissor **ignora** `frame_durations`: `.res` com um único `time` por asset | tabela própria no runtime C | — | **A**: `rescomp` SGDK 2.11 aceita `[[t,t][t]]` por frame (`bin/rescomp.txt:361`), com `timer` `u8` | `loopstart ≠ 0` exige callback (`Animation.loop` não é exposto pelo `rescomp`) |
| **Flip por frame** | ignorado no emissor | runtime | — | **A**: `SPR_setHFlip`/`SPR_setVFlip` via `FrameChangeCallback` | — |
| **Colisão** | 1 AABB = união das Clsn2 do 1º frame da ação 0; Clsn1 descartado na execução | tabelas Clsn1/Clsn2 por frame | teste só verifica existência | **A**: tabela por frame, emitida | caixas são retângulos; sem rotação/escala |
| **Paleta** | ordem de chegada; acima do limite, cor mais próxima **em silêncio**; sem grade de 9 bits do VDP | 15 cores + 0, grade VDP, pixels aproximados contados | — | **P**: quantização na grade VDP com contagem e diagnóstico | múltiplas paletas (.act) fora do perfil |
| **CMD** | `input_commands.rs` (canônico): notação `_2,_3,_6,_P`, janela, perfil MD | parser Python próprio | teste `hadouken` | **R** | modificadores `/`, `~`, `$`, `>` ver `input_commands.rs` |
| **CNS/ST** → estados | FSM do produto: `ChangeState`, `ChangeAnim`, `VelSet`, `PosAdd/PosSet`, `PlaySnd`; `HitDef` vira bridge; resto `mugen_unsupported_controller` | compilador de expressões + VM de bytecode em C | teste de nós | **R** + endurecer triggers | expressões MUGEN gerais: **não suportadas** (sem VM) |
| **Runtime de luta** | FSM e nós do emissor SGDK | HAMOOPIG + VM (`mg_*`), 60 fps não atingido (E3b "16% acima do orçamento") | Forge: BlastEm (Ken) | **—**: nada copiado | licença e acoplamento |
| **Proveniência** | `external_source_refs` por arquivo | manifesto por símbolo com hash + anotações humanas | — | **P**: registro por recurso/comportamento com origem, hash, transformação, destino e classificação | — |
| **Telemetria** | `rom_mastering`, `project_capability`, leitura de memória pelo core | sonda `MDRT` na ROM + SRAM + BlastEm; PC histogram | Forge: capturas locais | **P** com separação A/B/C/D; nesta frente só **A** (estático) e **C** (core) | B (instrumentação) exige custo declarado; fora do 1º perfil |
| Som (SND) | `load_mugen_sounds` | `snd.py` | — | **R** | fora do 1º perfil |
| Stage / screenpack | existe | parcial | — | **—** | fora do 1º perfil |

## 3. Decisão: núcleo Python isolado × porte

| Critério | Reusar núcleo Python do Forge | Portar os módulos necessários para Rust |
|---|---|---|
| regra do produto | `AGENTS.md`: "não use Python no runtime do app" → só serviria como ferramenta externa | compatível |
| instalação/distribuição | exigiria Python + Pillow no host do usuário | nenhuma dependência nova (a crate não depende de nada) |
| duplicidade | criaria um 2º parser AIR/SFF ao lado do Rust existente | substitui o parser existente: **uma** implementação |
| determinismo/testes | pytest separado, fora dos gates do produto | `cargo test` na crate + gates do produto |
| segurança | executar um pacote de terceiros não verificado | código revisado; limites explícitos |
| custo | baixo inicial, alto de manutenção | parsers AIR (~150 linhas) + SFF v1/PCX (~150) + paleta; a lógica de luta continua no NodeGraph |

**Decisão: portar conceitos para Rust** (sem copiar código), apenas do que o 1º perfil usa.
A VM/runtime C do Forge não é portada. Os comportamentos seguem a FSM do NodeGraph, que o
emissor já compila.
