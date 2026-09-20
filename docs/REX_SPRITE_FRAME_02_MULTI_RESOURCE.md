# REX Sprite-Frame-02 — matriz verificável

Status: Experimental, branch dependente, sem merge. Esta fatia compõe frames assistidos por metadados doador; não é extração automática geral, animação nem remontagem do jogo.

## Matriz

| Cenário | Commit/binário | ROM ou fixture | Resultado | Evidência |
|---|---|---|---|---|
| `spr_ryo_100/frame-0` e `frame-1` | evidência histórica da integração #71; binário SHA `082c66d2ab319a64025b627daf5a5a74cbaf49752e57490ea23ab4c985b812e2` | HAMOOPIG `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`; fonte `100.png` `1ff180a0737f5b3c8c156effc481de037d2daba1bce4993dda54598bbd7aa63b` | Passou: pixels RGBA independentes, escala CSS 3× (`192×312`), offsets e proveniência | `src-tauri/target-test/validation/inspection-2026-09-20T13-53-39-175Z-sprite-frame-0.png`, `...sprite-frame-1.png`; log E2E da execução histórica |
| `spr_ryo_100/frame-2`, `frame-3`, `frame-4` | evidência histórica da integração #71; binário SHA `082c66d2ab319a64025b627daf5a5a74cbaf49752e57490ea23ab4c985b812e2` | HAMOOPIG `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9`; frame 4 deduplica os bytes de frame 2 | Passou: oráculo independente, hash de canvas, stale preview removida na troca; frame 4 alias documentado | `...13-53-39-175Z-sprite-frame-2.png`, `...sprite-frame-3.png`, `...sprite-frame-4.png`; log E2E da execução histórica |
| `spr_spark0/frame-0` antes/depois de reinício | código da branch #71 + ajuste de layout; binário SHA `743e22d58668a47734b1ace47fd597e35554303c9e2527765d6a3f9ed0fba476` | Taiketsu `3967996af4efe197284dd80e48a3b457aa381f8e0ba098851b5dbb59fc42bc7c`; fonte `spr_spark0.png` `cafaf180ba006903242aa822fb3c0dceb42424a9e0bd07a5a19b75f33a4bf196`; tiles `0x80060+0x120`, paleta `0x2e134+0x20`, descritor `0x22f94` | Passou: seleção nativa, composição, pixels independentes antes/depois `601829b5a8ab8853fdc1d9047f95ecdfcc6e0f91f73a88ae226ad55c3e70679f`, persistência/reabertura e dimensões CSS `72×72` (3× de `24×24`) | `src-tauri/target-test/validation/inspection-2026-09-20T14-24-19-785Z-sprite-spark0-before-restart.png`; `...sprite-spark0-after-restart.png`; sessão `inspection-1789914271-00000000` |
| Cancelamento separado | código da branch #71 + harness corrigido; binário SHA `743e22d58668a47734b1ace47fd597e35554303c9e2527765d6a3f9ed0fba476` | HAMOOPIG `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9` | Passou: `run=cancelled` e `session=cancelled`; não aceitou conclusão rápida como cancelamento | sessão `inspection-1789914403-00000000`; log `test:e2e:desktop:inspection:cancel` |

## Proveniência e limites

- Bytes compilados, offsets, descritores e paleta são recuperados e validados contra a ROM BYOR identificada.
- Nome do recurso, frame, posições, flips, transparência e transformação do compilador dependem do projeto doador e estão rotulados na UI como composição assistida.
- O teste compara índices/RGBA com oráculo independente; hash PNG e hash dos pixels permanecem distintos.
- A evidência Ryo é histórica e está explicitamente vinculada ao binário `082c66d…`; a prova Taiketsu e o cancelamento foram reexecutados no binário `743e22d…`. Nenhum resultado histórico é promovido silenciosamente ao novo binário.
- O runner WebDriver registrou uma tentativa transitória de conexão recusada ao iniciar `tauri-driver`; as execuções que fecharam a prova continuaram com WebKitWebDriver nativo e não usaram IPC direto para aprovar a UI.
