# EXPECTATIONS-VISUAL-ETAPA3 — congelado antes de implementar (2026-10-03)

Escopo: ETAPA 3 da missão visual — jornada retificada no MESMO binário final,
com a correção de apresentação como mudança de PRODUTO. Causa estabelecida na
ETAPA 1 (`evidence/2026-10-03-visual/CAUSA-MAGENTA.md`): compositor acelerado
do WebKitGTK sob janela destruída/recriada nunca repinta o bitmap do `<img>`
do palco; dados permanecem byte-exatos. A/B (relatório `89a35a2b…`) provou que
`WEBKIT_DISABLE_COMPOSITING_MODE=1` elimina o defeito com raster igual à
referência independente (0 mismatches).

Disciplina: este arquivo é commitado sozinho, antes de qualquer mudança de
código ou execução de prova. Desvio observado = FAIL/INCONCLUSIVE com série
bruta registrada; nunca reescrever o esperado depois de medir. Expectativas
congeladas de ETAPAs anteriores (ETAPA 1 do diagnóstico, `EXPECTATIONS-INTEGRADA.md`,
ADDENDUM-1/2, ETAPA 2/E2-1..E2-10) continuam valendo para os mundos em que
foram medidas; adaptações de contrato de produto mudado só podem ser
registradas AQUI, na etapa que introduz a mudança.

## E3-0 — decisão de correção congelada (PRODUTO, não ambiente)

- A correção vive no binário: no início de `app_lib::run()`
  (`src-tauri/src/lib.rs`), antes de qualquer `tauri::Builder`/webview, o
  processo define `WEBKIT_DISABLE_COMPOSITING_MODE=1` em Linux
  (`#[cfg(target_os = "linux")]`). É exatamente o mecanismo que o A/B da
  ETAPA 1 provou; o produto passa a auto-aplicá-lo.
- NÃO é correção: mitigação pelo ambiente do QA (variável exportada pelo
  runner/harness), mudança do pipeline de pixels, remoção do matte CSS
  `#ff00ff`, repaint-trigger via JS no palco, ou sleep/wait extra para
  "esconder" a defasagem. A alternativa "eliminar dependência de alpha na
  apresentação" NÃO é adotada nesta etapa: não tem A/B próprio.
- Risco registrado e aceito: renderização por software do WebKit em Linux
  (sem aceleração de compositor). Para a ferramenta de inspeção de pixel
  art em 60 Hz baixo Xvfb/host real, correção de apresentação > aceleração;
  reavaliar se houver medição de regressão perceptível de fluidez.

## E3-1 — jornada retificada roda SEM a mitigação de ambiente

- Cenario `sonic-anim-integrada` no binário final construído depois do
  último commit (gate de proveniência `__RDS_BUILD_COMMIT__` == HEAD vivo).
- O harness deve ASSERTAR no início do cenario que
  `process.env.WEBKIT_DISABLE_COMPOSITING_MODE` não está ativo
  (ausente ou ≠ "1"); com a variável ativa, a corrida é
  INCONCLUSIVE-FAIL para E3 (não conta como prova de correção de produto).
- Relatório do cenario registra `webkit_disable_compositing_mode: null` e o
  SHA-256 do binário.
- Os passos 1..10 já congelados (BYOR pinado `c7da53a1…`, pintura, cadência
  40, diff cumulativo exato de 2 bytes, BPS export/apply byte-exato, jogo da
  modificada com gate de identidade, salvar→destruir→reiniciar→reabrir,
  ledger/proveniência, restauração seletiva da duração preservando o pixel,
  base intacta) permanecem todos verdes, sem alteração de semântica.

## E3-2 — sprite VISÍVEL pós-reabertura: gate de apresentação na janela

- No PASSO 9, depois da recomposição do walk-1 na instância recriada, a
  jornada acrescenta uma observação de apresentação (nada removido):
  recorte do pixmap X11 da janela na posição declarada do palco
  (mesma machinery de `captureVisualObservation`: layout rect + borders +
  `renderPresentedFrameRaster(referencia, 3, [255,0,255])` +
  `compareWindowCropToExpected`) medido contra a referência independente
  dos bytes da cópia (a mesma já usada no `assertExactPreviewPixels` do
  PASSO 9).
- Gate: `window_crop_matches_expected === true` (mismatches === 0) e
  `canvas_matches_reference === true`. Magenta puro no recorte (nenhum
  pixel opaco do sprite no raster) FAILA o gate por construção, pois
  diverge da referência nas posições do sprite.
- Condição verificável, não sleep arbitrário: a jornada pode reavaliar o
  raster em loop `waitFor` de até 10 capturas (orçamento 20 s). A série de
  tentativas (mismatches e magenta_fraction de cada captura) é registrada no
  relatório; gate verde só com mismatches 0; estouro do orçamento = FAIL com
  série bruta. Número de tentativas > 1 é observação registrada (o fix deve
  fazer a primeira captura bater).

## E3-3 — prova analítica discriminante do gate novo (não-vacuidade)

- Antes do gate E3-2 ao vivo, o harness reexecuta a análise do recorte
  OFFLINE contra a captura defeituosa arquivada da ETAPA 1
  (`capture-inspection-2026-10-03T16-44-57-791Z-visual-o3-walk1-pos-reabertura.png`,
  SHA-256 `207b233f7ef40cda74ee55925c942d458dbcf93f0683a1c25bf910b8f81c11fe`),
  usando o retângulo/bordas registrados no relatório run-03
  (rect x=1409.84375, y=691.984375, 122×122; borders 1/1/1/1 → crop em
  x=1411, y=693, 120×120) e a referência derivada dos bytes da jornada.
- Gates: (a) o SHA-256 dos pixels da referência recomposta bate com
  `canvas_pixels_sha256` da observação o3 do run-03
  (`abbf2d5e…78ac`) — prova que o esperado offline é o mesmo bitmap medido
  na corrida do defeito; (b) `compareWindowCropToExpected` sobre a captura
  arquivada produz `mismatches > 0` — prova que o gate E3-2 reprovaria o
  mundo do defeito. Arquivo ausente ou hash divergente = FAIL/INCONCLUSIVE
  (nunca skip silencioso).

## E3-4 — adaptação do caminho de retorno do harness (hidratação E2-7)

- A ETAPA 2 mudou deliberate o contrato do remontage do painel: com sessão
  viva na mesma página, `liveInspectionCache` restaura palco/quadro ao
  remontar (gate E2-7 congelado). O wait do cenario de diagnóstico
  (`readRenderedSpriteFramePixels(...) === null` antes do "reabrir") codifica
  o produto PRÉ-E2-7 e passa a ser observação obsoleta para binários novos.
- Contrato retificado (registrado aqui, a etapa que muda o produto):
  1. no cenario `sonic-anim-visual-diagnostico` executado contra binário
     pós-ETAPA-2, a perna de retorno (apos "Parar" → voltar à inspecao)
     ASSERTA o novo comportamento: o painel remontado hidrata a sessão viva
     vinda do cache (estado de sessão presente sem navegar pelo catálogo),
     em vez de exigir quadro ausente;
  2. as etapas seguintes (selecionar walk-1, recompor, observar O2) são
     mantidas exatamente — a recomposição explicita continua sendo o caminho
     que produz a observação, nunca o elemento hidratado antigo;
  3. corridas históricas (relatórios run-03/89a35a2b) permanecem válidas para
     o binário `8cc79c72…` que mediram; nada deste item reinterpreta
     evidência medida.
- Na jornada integrada, a reinicialização é processo NOVO: o cache de módulo
  não existe, o banner de retomada (E2-7) pode aparecer; a jornada usa o
  caminho explícito refresh→selecionar→Reabrir, que deve funcionar com o
  banner presente. Gate de observação: após a reabertura explicita, o banner
  desaparece (sessão viva existe) e nenhuma sessão fantasma é criada.

## E3-5 — regressões preservadas

- Suites verdes no commit do fix + jornada: `npm test` (incl. os 29 testes
  do painel da ETAPA 2), `npx tsc --noEmit`, `npm run lint` (zero warnings),
  `npm run check:tree`, `cargo clippy --manifest-path src-tauri/Cargo.toml
  -- -D warnings`, `cargo test --lib`, `cargo fmt --check`.
- O pipeline de composição/píntura/cadência não muda de comportamento nesta
  etapa: a única mudança de produto é a flag de ambiente definida pelo
  próprio binário (E3-0). Qualquer diff adicional em src/ ou src-tauri/
  além disso exige justificativa gateada neste documento antes do commit.

## E3-6 — relatório separa as cinco dimensões

O relatório final da ETAPA 3 registra por dimensão, sem misturar:
1. integridade dos dados (canvas == referência independente em todas as
   transições; SHAs da base/cópia; ledger; BPS byte-exato);
2. apresentação visual (recorte da janela == raster esperado pós-reabertura;
   série de tentativas; prova offline E3-3);
3. persistência (salvar → destruir → reiniciar → reabrir do disco; sessão,
   edição e proveniência restauradas);
4. execução no core (jogo da modificada com gate de identidade de bytes;
   frames renderizados; pausa/parada pelo caminho real);
5. usabilidade humana (NÃO declarada nesta etapa — sem participante;
   pertence à ETAPA 4 com avaliação real).

## E3-7 — proveniência e limites

- Binário: SHA-256 gravado no relatório; construído após o último commit;
  `__RDS_BUILD_COMMIT__` == HEAD no momento da corrida; nenhum commit entre
  build e execução.
- ROMs: base BYOR `c7da53a1…` intocada ao final (gate `final.base_preservada`
  permanece); cópias e aplicadas só no diretório de prova.
- Ambiente: sem `WEBKIT_DISABLE_COMPOSITING_MODE` exportado pelo runner;
  Xvfb/BYOR nos pinos conhecidos; scratch `~/rds-scratch`.
- Limites: Linux-only (a flag não existe em Windows/macOS; nenhuma mudança
  para essas plataformas); a prova cobre o perfil assistido
  `sonic1_sonic` Rev00 demonstrado; nada daqui promove o perfil para
  não-Experimental; sem merge, release, promoção ou push forçado.

## O que NÃO é gate desta etapa

- Correção do comportamento de navegação do botão "Parar" (achado 2 da
  ETAPA 1) além do que E2-7/E3-4 já cobrem.
- Avaliação de usabilidade com participante (ETAPA 4).
- Ampliação de codecs, variantes, animações ou novos perfis.

## Provas novas versus herdadas (registro)

Novas: E3-0..E3-5 (fix no binário + assert da ausência da mitigação + gate
de raster da janela no PASSO 9 + prova offline discriminante + adaptação do
caminho de retorno). Herdadas: todos os gates da jornada
(`EXPECTATIONS-INTEGRADA.md`, ADDENDUM-1/2), ETAPA 1 (como registro histórico
do mundo pré-fix), E2-1..E2-10 (suites de componente), gates de integridade
AGENTS.md.
