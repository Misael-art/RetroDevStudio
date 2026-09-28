# Reprodução mínima — checksum `0x18E` após patch (PR #84)

Destinatário: integrador (dono de `build_orch`, `rom_mastering` e da política).
Nada nesta reprodução altera arquivo compartilhado.

## Funções envolvidas

| Função | Onde | Algoritmo | Papel |
|---|---|---|---|
| `sgdk_checksum` | `src-tauri/src/core/rom_mastering.rs:283` | XOR de todas as palavras BE da ROM, exceto `0x18E` (SGDK sizebnd 2.11) | o que o pipeline **grava** |
| masterização | `src-tauri/src/compiler/build_orch.rs:2272` | aplica o header do projeto e regrava `0x18E` com `sgdk_checksum` | produz a ROM-base |
| `megadrive_checksum` | `src-tauri/src/core/rom_mastering.rs:268` | soma BE de `0x200` ao fim, truncada a 16 bits | a soma tradicional |
| `inspect_rom_mastering` | `src-tauri/src/core/rom_mastering.rs:44` | aceita soma MD **ou** XOR SGDK; senão, `mismatch` | inspeção do produto |
| `md_checksum` | `crates/rex-gameplay/src/patch.rs:32` | mesmo algoritmo de `megadrive_checksum` | o que o patcher conhece |
| `finish` | `crates/rex-gameplay/src/patch.rs:94` | reescreve `0x18E` **somente se** `md_checksum(base) == gravado` | a política atual |

## A aparente contradição sobre a soma tradicional

Os textos da rodada 1 diziam que "o SGDK grava um valor que não é a soma padrão" e que o
patcher "atualiza o checksum se a base tinha checksum válido". As duas frases são verdadeiras,
mas "válido" ali significa **válido pela soma MD**, a única convenção que o patcher conhece:

1. A base do pipeline guarda `14BB`, que é o XOR SGDK. A soma MD dela é `CE17`.
2. Para o patcher, portanto, a base "não tem checksum válido" e ele não mexe em `0x18E`.
3. A saída continua com `14BB`, mas agora o XOR dela é `14B5`. O produto a inspeciona como
   `mismatch`.

Portanto, a frase "o patcher não adivinha a convenção" (corpo do PR na rodada 1) é imprecisa:
a convenção existe no próprio produto (`sgdk_checksum`). O patcher só não a implementa.
A observação `gravado + soma = 0xE2D2`, feita durante o diagnóstico da rodada 1, foi uma
coincidência desta edição e não é o algoritmo.

## Valores (ROMs reais da rodada 2, `run-1790615546422567756`)

| ROM | SHA-256 | gravado | XOR SGDK | soma MD | inspeção |
|---|---|---|---|---|---|
| original t6 (base) | `86c4e90d…4f7e` | `14BB` | `14BB` | `CE17` | `matching_sgdk` |
| patch t12 | `4030ec74…b1db` | `14BB` | `14B5` | `CE1D` | **`mismatch`** |
| recompilação SGDK t12 | `06fe310e…104f` | `14B5` | `14B5` | `CE1D` | (não aplicável) |

A única mudança de conteúdo é `0x961`: `0x05 → 0x0B` (`MOVEQ #K,D2`, `K = T − 1 = 11`).
Portanto `XOR(saída) = 14BB ⊕ (05 ⊕ 0B) = 14B5`. Com esse valor em `0x18E`, a saída do patch
fica byte a byte igual à recompilação SGDK.

## Comandos

1. **Sem SGDK, em cerca de 1 s** (reprodução mínima, com referência XOR independente e o
   controle com base de soma MD):

   ```
   cd crates/rex-gameplay
   cargo test --test checksum_repro -- --nocapture
   # base stored=B433 xor=B433 md=Some(FAC5) | patch stored=B433 xor=B43D md=Some(FACB)
   ```

2. **Com SGDK e core** (gera as ROMs reais; o campo `checksum` sai em `report.json`):

   ```
   CARGO_TARGET_DIR=$PWD/target cargo test --manifest-path src-tauri/Cargo.toml --lib rex_gameplay -- --include-ignored --nocapture --test-threads=1
   ```

3. **Conferência avulsa de qualquer ROM:**

   ```
   node -e 'const b=require("fs").readFileSync(process.argv[1]);let s=0,x=0;for(let i=0;i<b.length;i+=2){const w=b.readUInt16BE(i);if(i>=0x200)s=(s+w)&0xffff;if(i!=0x18e)x^=w}console.log(b.readUInt16BE(0x18e).toString(16),x.toString(16),s.toString(16))' ROM.bin
   ```

## Decisão pendente (do integrador)

As opções A e B estão em `INTEGRATION_PROPOSAL.md` §5. O core não valida o campo, e nada
aqui prova compatibilidade com hardware.
