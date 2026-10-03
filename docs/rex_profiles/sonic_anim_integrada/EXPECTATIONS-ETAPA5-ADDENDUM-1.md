# Addendum-1 (congelado) — run-1 da jornada integrada: FAIL em PASSO 5 e correção do DRIVER

Congelado **antes** de aplicar a correção e antes de reexecutar (regra do
"Critério de veredito" em EXPECTATIONS-INTEGRADA.md: desvio vira FAIL com
série bruta persistida; correção entra por adendo prévio). Este adendo NÃO
reescreve nenhuma expectativa E1–E10; ele corrige o **harness** que assertou
uma semântica que nunca esteve congelada.

## Série bruta da run-1 (2026-10-03)

- Relatório: `~/rds-scratch/anim-integrada-journey-20261003-01/evidence-run1/inspection-2026-10-03T11-57-37-695Z-anim-integrada/report.json` (SHA-256 `2b45421c2cbeb58c9330ba5a737289075f7d528bd955ae8ae594334423d8cbc2`), log `run.log` (SHA-256 `65e2bbebc5555834b20c2ef859ca51fdae8412ef2194b749870392512d8b045d`), screenshot do PASSO 2 persistida junto.
- Verificação: 11 checks executados; **10 verdes** (passo1.byor_pinado,
  passo2.id_wait_18_quadros, passo2.original_23_previsao_24,
  passo2.linguagem_iniciante, passo3.pintura_offset_unico,
  passo3.copia_so_pixel, passo4.mensagem_com_sha_da_copia_acumulada,
  passo5.nibble_cru, passo5.diff_exatamente_dois_bytes,
  passo5.copia_identica_mutacao_independente), **1 vermelho**:
  `passo5.byte_cadencia_cru` com `observed {byte: 40, format:
  "sonic1_wait_interval_byte", changed_offsets: [80814, 139582]}`.
- A cópia acumulada bate byte a byte com a mutação independente
  (`3274e7c4…a9778a` = esperado; diff bruto contra a base = exatamente
  `0x13BAE` e `0x2213E`). Nenhuma expectativa E1/E5 falhou.

## Causa

O DRIVER assertou `edit.changed_offsets === [0x13BAE]` (domínio único). O
produto reporta `changed_offsets`/`bytes_changed` como **diff cumulativa
base→cópia** (inspeção em `src-tauri/src/tools/reverse/decomp/inspection.rs:1398`),
sendo o diff **por operação** registrado no ledger (`offsets`, `old_bytes`,
`new_bytes` por entrada, :1443-1486). A semântica congelada em E1 é a
cumulativa ("Diff cumulativo da cópia final contra a base: exatamente os
bytes...") — que passou na leitura crua do arquivo. O harness cobrava uma
semântica que o contrato nunca congelou; isso é defeito de teste, não do
produto.

## Correções do driver (entram por este adendo, antes da reexecução)

- **R-1 (PASSO 5)**: `passo5.byte_cadencia_cru` passa a exigir byte 40 +
  formato `sonic1_wait_interval_byte` + `changed_offsets` igual ao conjunto
  cumulativo congelado `[80814, 139582]` (ordem ascendente) +
  `bytes_changed === 2`. A leitura crua do arquivo (diff exatamente dois
  bytes) continua assertada separadamente, como estava.
- **R-2 (PASSO 10)**: o `waitFor` da restauração deixa de condicionar em
  `changed_offsets` (polling por caminho da cópia + SHA esperado); o check
  nomeado passa a exigir, além dos bytes crus (23 no intervalo, pixel
  intacto, diff bruto = só `0x2213E`), que o diff cumulativo reportado pelo
  produto seja exatamente `[139582]` com `bytes_changed === 1`
  (autoconsistência reportado≠observado fica assim discriminante).
- **R-3 (PASSO 9)**: reforço dentro da mesma expectativa E2 (não é mudança
  de comportamento): o ledger reaberto precisa trazer por domínio o offset e
  os bytes anterior→sucessivo crus (cadência `[23]→[40]` em `0x13BAE`;
  pintura `[byte_base]→[byte_pintado]` em `0x2213E`), além de SHA de cópia
  por entrada.
- **R-4 (PASSO 8)**: a sonda do wizard espera o mount (até 15 s) antes de
  classificar, para não passar vacuamente por leitura pré-render; a ausência
  estável continua registrada como observação crua no relatório.

## O que NÃO muda

Expectativas E1–E10 permanecem as congeladas em a657423. Números esperados
(23→24, 40→41, dois bytes, SHA da jornada) são os mesmos. Rodada nova só é
vermelho contra o congelado; a run-1 fica persistida como histórico honesto.
