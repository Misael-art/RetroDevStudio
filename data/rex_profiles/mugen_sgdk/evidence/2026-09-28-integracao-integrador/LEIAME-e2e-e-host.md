# E2E desktop `mugen-import` no tronco do integrador — condición do host e execucións

Data: 2026-09-29 (UTC). Branch `codex/rex-integrator-mugen-85`, merge `b410de0`
(pais: `e319fb9` tronco do integrador + `bd02e3c` HEAD do PR #85).

## Resultado entregado

`e2e-mugen-import-run7.log` + `e2e-mugen-import-report-run7.json` + 6 capturas
(`e2e-run7-*.png`). Veredicto.

- Binario probado: `src-tauri/target-test/debug/retro-dev-studio`
  SHA-256 `1b46ff504ba3aacab59f27c3c3bb664fcf0d83428fc1499207acc507d31abb09`
  (o `sha256` do `testedApplication` do informe é o deste binario; as capturas e
  as mostras de píxeles pertencen a esta mesma execución).
- Fixture: `crates/rex-mugen/fixtures/probe` copiada ao directorio de traballo de
  validación con SHA-256 por ficheiro (recomparable coas 5 hashes do informe).
- ROM orixinal `10658a6c44af86f0c5e58c66d924570095cfdca8efc3abe7d28f290b50874c72`
  vs ROM editada `5a6aff76a7fd3756c5fc010cb460f5616096ebdc1b063df73bf77b6274600fae`
  — distintas, como esixe a proba de que non se reutilizou unha resposta antiga.

## Condicionante do host (non defecto do produto nin do PR)

O escenario pide unha xanela de 1920x1080 CSS. Nesta máquina o output primario
pasou a ser o panel eDP rotado (`1280x800+0+0`) e o monitor externo grande é
`DP-1 3456x1458+1281+0`; o compositor recorta calquera xanela colocada en (0,0)
ao tamaño do panel, de xeito que `setSessionWindowRect` nunca acadaba o obxectivo
(`inner=948x564, outer=1280x762`, factor físico/CSS 1,35).

Para obter exactamente o mesmo viewport da proba da frente (1920x1080 CSS) usouse
un vigía externo (`/tmp/rds-win-watch4.sh`, fóra do repo) que movía e redimensionaba
**só a xanela da app de proba** ao monitor externo con tamaño físico 2592x1458
(2592/1,35 = 1920, 1458/1,35 = 1080). Non se mudou a configuración de pantallas do
operador, nin se tocou o harness para aceptar outra xeometría. O rexistro do vigía
conserva as aplicacións de xeometría durante a fase de redimensionado.

## Execucións descartables (mantidas por honestidade, NON son a evidencia)

- `e2e-mugen-import-CONCURRENT-LAUNCH-discarded.log` — lanza duplicada por un `&`
  mal posto; as dúas carreiras competiron por `dist/` e unha non compilou.
- `e2e-mugen-import-run2.log` — mesma falla de competición en `dist/`.
- `PROBE-placement-discardable.log` — proba de colocación: a xanela quedou en
  1920x1080 CSS (confirmou o factor 1,35) pero o harness comparaba contra o seu
  propio obxectivo, así que reprobou.
- `e2e-mugen-import-run4.log` — **verede coa aserción antiga**; conservado porque
  é a execución que destapou o defecto da aserción (ver abaixo).
- `PROBE-resize-before-watcher-discardable.log`, `e2e-mugen-import-run5.log`,
  `e2e-mugen-import-run6.log` — fallan a fase de redimensionado porque o vigía non
  estaba activo (run5) ou porque estaba activo pero só miraba a primeira xanela
  coincidida, que entón era un orfo dunha execución anterior (run6).

## Dous achados do propio harness (superficie do integrador)

1. **Aserción de proxecto fantasma non discriminante** (Corrixida antes de run7,
   `scripts/e2e-tauri-build-run.mjs`, paso `negative_path_escape`). Comparaba só o
   *conteo* de cartafoles `Mugen_Escape_*` antes e despois; se xa existise un
   cartafol dunha execución anterior, un fantasma desa mesma execución pasaría
   desapercibido. Agora exíxese ademais que `escapeName` desta execución non estea
   no disco. A execución verde entregada (run7) xa leva a aserción reforzada:
   `escapeName = Mugen_Escape_1790650044699` non existe; o único `leftovers` é
   `Mugen_Escape_1790639205721`, que **non é un fantasma MUGEN**: contén
   `project.rds` con `template_id = "starter_guided"`, `source_kind = "builtin"` e
   `imported_at_ms = 1790640543662` (2026-09-28T21:09:03 local), é dicir, creouno
   o fluxo de onboarding da rodada da frente a partir dun nome de wizard que ficou
   pendurado. Queda en `~/Documents/RetroDevProjects` como estaba; non o borrei.
2. **Fuga de proceso tras o reinicio**: `runMugenImportScenario` reinicia a app e,
   ao rematar, queda unha instancia de `retro-dev-studio` viva (pasou en run4 e en
   run7). Non invalída a proba, pero sucia o desktop e confunde calquera vixía
   de xanelas. Rexistrado como límite; non se corrixiu nesta rodada.
