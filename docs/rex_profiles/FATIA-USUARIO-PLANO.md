# Fatia do usuário: inspecionar → reconhecer por consumidor → visualizar com identidade → editar → persistir → BPS → executar e observar

**Status:** Contrato e plano (sem implementação nesta missão). Implementação de
superfícies compartilhadas (IPC/UI/registry) será feita pelo integrador na branch
de integração, dentro do escopo autorizado. Tudo permanece `Experimental`.

## 1. Escolha da cadeia (e por que as alternativas estão descartadas)

**Cadeia escolhida: sprite do Sonic 1 (frente D)** — `Map_Sonic` → DPLC → arte →
paleta, com **duas** fontes independentes já provadas (oráculo do s1disasm fixado
`064e3c6` byte-idêntico ao oráculo do piloto) e o papel do DPLC (tile_slot = ordem
de carga, não índice de arte) registrado antes da interpretação. É a única cadeia
com (a) consumidor de leitura conhecido, (b) prova de composição byte-idêntica e
(c) superfície já existente no produto (`sprite_composition.rs` + E2E) lendo os
mesmos endereços.

**Descartadas, com motivo registrado:**
- *Layouts "de fases especiais" Enigma do #97:* o review independente provou que
  `$FF4000` é WRAM e o consumo pós-decode é um layout 64×64 de IDs de bloco em
  bytes — os vínculos gráficos publicados no PR #97 (nametable VDP 64×32, paleta,
  flips como campos consumidos) estão **retirados até a frente B corrigir**. Não
  há consumo de tiles/paleta provado para esses blocos.
- *Arte Kosinski da frente A:* o ciclo codec (consumidor `$3F09A`, variante base,
  saída vs `koscmp`) está provado, mas o fluxo de arte→VRAM→tela do Kosinski não
  está ligado ao layout de sprites — unir "por pertencerem ao mesmo jogo" é
  associação não provada (a mesma regra que retirou os vínculos do #97).
- *LZ4W/HAMOOPIG:* cadeia de edição já provada no produto, mas é outra fatia
  (recurso comprimido), não o caminho de reconhecimento por consumidor desta
  fatia; pode ser a continuação natural depois.

## 2. Contrato da fatia (estados cumulativos, herdados de CONTRACTS v1)

Para **um** frame do Sonic na ROM BYOR pinada (`c7da53a1…`), o usuário deve
conseguir, sem sair do app:

| # | Passo | Estado cumulativo | Contrato de aceite |
|---|-------|-------------------|--------------------|
| 1 | Inspecionar | `candidate` | O painel lista o frame do perfil D com os endereços absolutos por campo (map/DPLC/arte/paleta) e a identidade da ROM por SHA-256; sem SHA não há listagem. |
| 2 | Reconhecer por consumidor | `identified` | O registro carrega a evidência de leitura (tabela → entrada → peças → slots) com os endereços e o padrão de bytes conferido; rotulo explícito "reconhecido por leitura estática do perfil D, duas fontes independentes". |
| 3 | Visualizar com identidade | `decoded` | Render RGBA do frame **byte-idêntico ao oráculo** (hash do RGBA publicado no perfil D: `fb492caf…` para `fr_Stop1`); a prévia mostra proveniência (ROM, offsets, hash do RGBA) e o rótulo `Experimental`. |
| 4 | Editar | `editable` | Edição restrita a pixels da arte do frame com transação canônica (`reinsert_transaction`): identidade da ROM, no-op explícito, dependentes verificados, sem expansão de ROM (recusa estruturada `needs_space`). |
| 5 | Persistir | `reinsertable` | Re-codificação confinada aos bytes do recurso editado; re-decode do stream reinserido reproduz a edição; os demais frames verificam byte a byte idênticos. |
| 6 | BPS | — | Patch gerado pelo pipeline canônico contra a cópia da base, com hash exato registrado; re-aplicação do patch à base reproduz a ROM modificada (hash). |
| 7 | Executar e observar | `observed` | A ROM modificada roda no core Libretro; timeline determinística original-vs-modificada com frames capturados; a observação é publicada como `observed` + `coverage` (regiões amostradas), nunca como prova universal. |

**Não-alegações permanentes:** nada disto declara equivalência com o motor
original, conversão integral do personagem (4 frames + sequência de um total de
88), render BG/sombra (`pri` não modelado), DPLC incremental persistente, ou
observação universal do jogo.

## 3. Plano de implementação (arquivos e ordem)

1. **Perfil no produto (só leitura):** estender o leitor existente
   (`src-tauri/src/tools/reverse/` — superfície do piloto `sprite_composition`)
   para expor os frames do perfil D com endereços por campo; **sem** duplicar o
   leitor D (`scripts/rex_corpus_d/` permanece fonte de pesquisa, consumido como
   especificação; qualquer reuso é port declarado, não import).
2. **IPC + UI no Reverse Workspace:** aba "Recursos por consumidor" reutilizando o
   shell canônico (nada de segundo shell): listagem (passo 1), prévia RGBA com
   hash vs oráculo (passo 3), formulário de edição pixel-a-pixel herdado do
   fluxo LZ4W (passo 4) e painel de transação/BPS já canônicos (passos 5–6).
3. **E2E:** novo cenário `sprite-consumer-slice` no harness desktop canônico
   (`scripts/e2e-tauri-build-run.mjs`), cobrindo os 7 passos no mesmo binário,
   com negativos (ROM de identidade errada recusada; dependente alterado recusado;
   edição sem espaço recusada) e a linha de observação com `coverage`.
4. **Gates:** além da barra padrão, a matriz do roadmap ganha a linha da fatia
   (`Experimental`), e o Memory Bank registra os estados cumulativos por passo.

## 4. Critérios de aceite da fatia

- Os 7 passos verdes **no mesmo binário canônico** construído pelo pipeline
  oficial, num único E2E, com os negativos falhando como esperado.
- Hash do RGBA do render == hash do oráculo para o frame base (sem edição) e ==
  hash esperado após a edição canônica registrada.
- Nenhum vínculo não provado exibido: se um campo não tem consumidor provado, ele
  não aparece como "reconhecido" — aparece com a referência faltante.
- Documentação (`ROADMAP`, `Memory Bank`, `README` se visível ao usuário)
  atualizada na mesma sessão com rótulo `Experimental`.
