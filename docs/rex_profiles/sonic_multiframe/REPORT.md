# Sonic 1: composição e pintura de múltiplos frames (Experimental)

Base da proposta: `0ef540e95463faf74bc32202744ed27872592d8e` (#98, ainda aberta ao iniciar).
Branch isolada: `codex/rex-sonic-multiframe-ui`. Nenhuma worktree de outro agente foi alterada.

## Escopo

Perfil assistido para a ROM BYOR normalizada `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`.
Dez frames: stand (1), wait-1 (2), look-up (5), caminhada (6..11), run-1 (30).
Mapping `0x211e2`, DPLC `0x217fe`, arte crua `0x21afe+0xa120`, paleta `0x2388`.
Nomes e endereços vêm do perfil assistido Rev00 já documentado; não são descoberta universal.

A leitura e a pintura usam uma geometria única: slot de mapping → DPLC → tile de arte → byte/nibble.
Peças VDP usam células por coluna; pixels usam nibble alto primeiro. Flips locais são resolvidos
antes da edição; a âncora fica explícita. Banco de paleta não comprovado, peças sobrepostas,
VRAM herdada, frame desconhecido e bytes fora do recurso são recusados.

A interface permite escolher os frames, pintar pela paleta real, usar índice 0 transparente,
desfazer até 100 pinturas ainda na fila, verificar dependências e confirmar compartilhamento. O retângulo
anterior permanece disponível. Pintura e paleta acumulam na cópia revalidada; BPS continua
no pipeline existente, sobre a base original. Não há encoder ou formato novo de ROM.

## Achado que invalida a prévia anterior

A prévia Sonic herdada e o compositor de pesquisa D usavam ordem por linha dentro de cada
peça VDP. O golden `ce95ea66…40d4` compartilhava esse erro. Concordância dos dois resultados
não comprovava o layout do hardware. O renderer HAMOOPIG já usava a ordem por coluna.

Os testes literais novos falharam antes da correção: o 2×2 trocava verde e azul; pintar (8,8)
do stand atingia tile 4 em vez de tile 5. A correção usa a mesma resolução para ambos.
O stand corrigido tem RGBA SHA-256 `7354bcfb6af04b6dc5d95c56adbaca232f9658a5edb0cb4dbd98a98582c462e7`.
Referência primária: https://github.com/Stephane-D/SGDK/wiki/Tuto-Sprites (ordem vertical das células).
As provas antigas e seus artefatos permanecem históricos. Cópias editadas antigas não são
reescritas: seus bytes são preservados; a intenção em coordenadas daquela versão não é recertificada.
A frente D precisa corrigir seu compositor e seus oráculos no próprio território.

Outro defeito corrigido: a edição anterior partia da base em cada chamada e perdia a pintura
ou paleta anterior. Agora a origem é a última cópia verificada; operações Sonic são serializadas.
Uma resposta de composição pendente é invalidada já ao selecionar outro frame, mesmo sem
pedir uma segunda composição. Respostas de edição de outra sessão não substituem a sessão atual.

## Provas locais executadas

- Golden autoral 2×2 assimétrico: coluna, DPLC não-identidade, canais, transparência e flips.
- BYOR no backend: dez PNGs, recusa de compartilhamento e coordenada não mapeada; duas pinturas
  e paleta acumuladas, salvar/remover a sessão da memória/reabrir do disco; base byte-idêntica.
- `scripts/qa/sonic-multiframe-oracle.py`: Python/Pillow externo, sem import do runtime;
  itera os tiles por ordinal. Dez PNGs comparados byte a byte; vinte controles (ordem e pixel)
  discriminantes. Galeria e imagens comerciais ficam em `target-test/validation/`, ignorado pelo Git.
- Segunda referência JS externa com golden autoral (`scripts/qa/test-sonic-frame-reference.mjs`).
- UI: treze testes focados; seleção pendente, transparência, desfazer, lacuna, dependências
  e recusa preservando a fila.
- Frontend completo: 903 passed / 6 skipped. Backend: 839 passed / 76 ignored.
- fmt, clippy lib/default com `-D warnings`, lint, TypeScript, check:tree e crates:gates passaram.
- host:certify executado, rc=0. O resumo operacional do host será vinculado na evidência final.

## Reprodução

```sh
RDS_DECOMP_WORK=/diretorio/isolado RDS_SONIC_MULTIFRAME_ROM=/caminho/BYOR.bin \
cargo test --manifest-path src-tauri/Cargo.toml --lib \
sonic_multiframe_byor_accumulates_and_reopens_without_touching_base -- --ignored --nocapture --test-threads=1
python3 -B scripts/qa/sonic-multiframe-oracle.py --rom /caminho/BYOR.bin \
--report /diretorio/isolado/sonic-multiframe-proof.json
node scripts/qa/test-sonic-frame-reference.mjs
```

## Histórico: estado no primeiro commit de implementação (`b9a0229`)

Build canônico e cenário desktop `sonic-multiframe` ainda pendentes neste checkpoint.
O cenário exige composição dos dez frames, pintura nativa, confirmação, acúmulo de paleta,
BPS, reinício real, reabertura e pixels independentes com hit-test desobstruído.
A comparação no core é uma prova separada; prévia não é efeito de jogo.
Não há recuperação geral de animação, cadência do jogo, lógica ou suporte universal.
Sem merge, release ou promoção de maturidade.

## Estado final medido em 2026-10-02

Código do produto e frontend: `f646ccf6de220f38dc9bf2b175cd56d79ff4be82`.
Binário canônico: `src-tauri/target-test/debug/retro-dev-studio`, SHA-256
`1845aebf1597a18cab74dd763d03fcf75c25ef2ec834c165fed5dc9529ccb8b0`.
Os commits posteriores deste fechamento alteram documentação/evidência; não são
atribuídos como frontend do binário testado. A proposta depende da #98 em `0ef540e`;
essa PR estava OPEN, sem merge, nas duas leituras desta rodada. #97 e #84 continuam fora.

| Prova nova nesta rodada | Resultado medido | Limite |
| --- | --- | --- |
| `sonic-multiframe`, desktop real | Dez frames selecionados por controle nativo, RGBA independente exato, escala inteira, centro e quatro cantos com hit-test em IMG | Composição estática assistida; não recupera a cadência do jogo |
| Pintura e paleta | Pintura nativa exige confirmação de tiles compartilhados; edição posterior de paleta preserva a pintura; BPS reaplicado reproduz a cópia | Alteração da cópia; original somente leitura |
| Salvar → reiniciar app → reabrir | Frame caminhada-1, cópia editada e pixels restaurados; wizard tratado por controles visíveis; imagem desobstruída e metadados abaixo | A fila de pinturas ainda não aplicadas não é persistida |
| `inspection-sonic-tiles`, mesmo binário final | Recusas de coordenada fora do mapping e compartilhamento; edição, BPS, aplicação, 1200 frames no core e reabertura passaram; 96 pixels diferentes em x=74..85, y=170..177 | É a edição do stand. Não prova execução dos dez frames, movimento ou salto por teclado |
| BYOR backend + Pillow | Dez PNGs exatos; vinte controles de ordem/pixel discriminantes; duas pinturas e paleta acumulam; base preservada | Prova técnica local separada da prova desktop |

O relatório desktop multi-frame registra `runtime_effect: "not measured in this scenario"`.
Seu ROM editado é `21e54148e82ba3769c29911e4a698b6fa5a99c50bc4a2cd0a8a759e152eb3dce`;
BPS `3ba1566fc26836e13eb123b5c2abdfe13a2ebb79b4b474d713ff5193a3e96089`;
walk-1 reaberto RGBA `cd2f5cd5555a1bd2a720a957a4c6218bd724b1f334ef7908308fd5f8466bf4d1`.
A edição stand da regressão é outra ROM:
`7b3801f791264b56f68bcecdfa524ac1664b227933cdea46dbcdbd4edbf6dabf`;
framebuffers base/aplicado
`680faf48878e4639d956c78f9807de72ba070e2e32508c94dfa674b42c9d0cd8` /
`ffcca5dba8daf32ede0ed42b052ce4a79485e681043c51a5ecc7f48d52eb346c`.
O teste técnico `sonic1_stand_tile_reinsertion_observed_in_game` também passou
(outra edição: 155 bytes, 293 pixels); ele não é somado à prova UI de 96 pixels.

### Gates e segurança

`host:certify` final rc=0: **READY**, SGDK/PVSnesLib oficiais `Success: true`,
frontend **906 passed / 3 skipped**, Rust **839 passed / 0 failed / 76 ignored**.
O frontend direto anterior foi **903/6**: os mesmos 909 testes, com três testes
dependentes de toolchain executados na certificação. Foco UI **13/13**,
fmt, clippy lib/default `-D warnings`, lint, TypeScript, check:tree,
crates:gates (quatro pacotes) e sintaxe do harness passaram.
Fingerprint `60249508aff61897cdd43160d4716b2344d69282507a36c5a457c0028143f6e2`;
lock `dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377`.

O `npm run security:audit` padrão retornou `EALLOWSCRIPTS` por conflito com a
configuração npm do usuário. A execução isolada com `NPM_CONFIG_USERCONFIG=/dev/null`
preservou a `.npmrc` e a política `allowScripts` do projeto e passou no limiar
`--audit-level=high`, com **quatro achados moderados** da família Vitest
(`GHSA-82fw-gwwq-j7x9`). Não é auditoria sem vulnerabilidades; atualização dos
devtools fica com o integrador. `cargo audit` rc=0 com **oito avisos permitidos**.
Nenhuma dependência runtime, instalação de sistema ou política global foi alterada.

### Display e tentativas anteriores

Depois da desconexão do monitor externo, o display físico não satisfazia 1920×1080.
As provas finais usam Xvfb externo de QA, extraído de pacote Manjaro fixado e com
assinatura verificada (`gpgv` rc=0), sem sudo/instalação global. A execução verifica
o SHA do Xvfb, cria display autenticado sem TCP e encerra só os próprios processos.
A renderização é do app real/WebKit e do core Libretro; não é screenshot manual
no monitor físico. A configuração dos monitores do usuário permanece intacta.

Tentativas intermediárias são históricas: run1 parou na variável de timeout
ausente do harness; run3 foi interrompido pela mudança do display; run4 expirou
na conferência da paleta sem causa estabelecida; run5 exigia texto `1` quando o
controle numérico apresentava `01`. A correção confere `valueAsNumber` após a
digitação nativa e os bytes da cópia contra a referência independente. Essas
corridas não contam como prova final; run6 e as duas execuções finais passaram.

### Evidência durável e reprodução desktop

Pacote versionado: `data/rex_profiles/sonic_multiframe/evidence/2026-10-02/manifest.json`.
Os relatórios versionados removem PNG base64 e arrays RGBA comerciais. O manifesto
fixa 58 identidades de artefatos por SHA-256, inclusive fontes de QA, resumos,
logs locais, binário e capturas. Os arquivos comerciais e o app permanecem locais,
em caminhos ignorados; os hashes não tornam esses arquivos provisionáveis no CI.

```sh
rtk proxy python3 -B scripts/qa/run-sonic-desktop-isolated.py \
  --xvfb /home/misael/.cache/retrodevstudio/qa-xvfb/21.1.24-1/Xvfb \
  --xvfb-sha256 5bfd315a8c7bc626d0b183d176e130c34f910a4a1279d9d53ea45769f62a3351 \
  --rom /caminho/BYOR.bin --app src-tauri/target-test/debug/retro-dev-studio \
  --work /diretorio/isolado --log /diretorio/isolado/desktop.log
```

Repetir com `--scenario inspection-sonic-tiles` para a regressão de efeito no jogo.
O setup aproveita o bootstrap/workspace existente do harness; as interações
centrais de frame, pintura, confirmação, paleta, BPS e reabertura usam controles
nativos. Nenhum avanço direto no core é atribuído como gameplay pelo teclado.

### Pendências com dono e limite de entrega

- Integrador: revisar a proposta após a #98, preservar o checkpoint da consolidação
  e não incorporar os vínculos gráficos P1 da #97 sem correção independente.
- Frente D: corrigir a ordem de células no compositor de pesquisa e regenerar seus
  oráculos; concordância com o antigo golden não comprova o layout VDP.
- Segurança/devtools: tratar os quatro moderados npm em fatia própria; nenhum
  `npm audit fix` foi executado sobre `node_modules` compartilhado.
- Expansão do perfil: animação/cadência em jogo, mais frames/ROMs, novos bancos de
  paleta e peças sobrepostas precisam de contrato e prova próprios.

O desfazer deste editor age na fila pendente, não no histórico de ROMs aplicadas;
trocar o frame descarta a fila pendente. RGB333 da prévia não certifica o DAC do
hardware. MUGEN, ADDQ/branch-compare e trajetórias Sonic por teclado não foram
reexecutados nesta rodada. **Experimental, proposta isolada; sem merge/release.**

## Adendo: identidade do framebuffer no E2E de referência

A proposta foi publicada como PR draft #99. No SHA documental `86fb1b8`, os
quatro jobs validate/linux-validate e o desktop do push passaram. O desktop
do PR falhou na comparação exata da célula pintada depois de reabrir o projeto
de referência; a mesma falha foi reproduzida localmente. A repetição remota única
passou. A falha inicial permanece na evidência, sem atribuição a pressão de
memória ou a flutuação como causa estabelecida.

O collector herdado aceitava apenas log de build concluído, status ativo e
canvas não preto. O código do app publica o log antes de terminar a carga
assíncrona da ROM. A captura podia portanto ser da ROM anterior ou do boot;
uma execução instrumentada registrou só 689 pixels não pretos no primeiro
build. Essa condição insuficiente foi demonstrada no código e nos testes;
os pixels esperados/recebidos das duas falhas iniciais não haviam sido gravados,
então não são usados para afirmar uma causa dinâmica mais específica.

`5b9d2b96a4e6fd47ba938b88b33a463398d96ef4` reforça somente o harness: SHA
da ROM compilada igual ao da Game View, sessão de input nova e fora de hold,
e pelo menos dez frames renderizados (o boot autoral atual tem oito VBlanks).
A comparação de pixels da célula continua exata e com o mesmo orçamento.
Agora, uma falha grava baseline, último frame, identidade e pixels da célula.
Os quatro testes controlados falham ao restaurar a aceitação antiga; restaurada
a barreira, passam. O primeiro ensaio do teste falhou no loader Vite do shebang,
sem executar testes, e não foi contado como mutação discriminante. O probe final
executa o módulo Node real em subprocesso, sem cópia da função avaliada.

O cenário `reference-platformer` passou **16/16** com essa barreira no mesmo app
`1845aebf…b8b0`/frontend `f646ccf`; pintura e reabertura têm ROI `1bd5bd07`,
com identidade da ROM conferida e sessão nova. Seus caminhos de build são
locais reutilizáveis, não cópias imutáveis de cada ROM intermediária; os hashes
foram conferidos durante a execução e não são apresentados como bytes ainda
presentes naqueles caminhos. Isto é autoria do template, não recuperação de jogo.

Nova certificação rc=0: **READY**, SGDK/PVSnesLib `Success: true`, frontend
**910/3** (913 totais, quatro testes novos), Rust **839/0/76**. As provas Sonic
anteriores são preservadas no mesmo binário; não se atribui o E2E de referência
como execução dos dez frames Sonic. O CI dos SHAs posteriores deve ser lido
na PR por SHA, sem transformar ausência, pending ou uma repetição em PASS inicial.

Pacote complementar:
`data/rex_profiles/sonic_multiframe/evidence/2026-10-02-frame-barrier/`.
Na auditoria do pacote anterior, **57/58** identidades foram reconfirmadas;
as fontes de QA históricas foram lidas dos blobs `f646ccf`, pois o harness mudou.
O único arquivo não recuperável no caminho original é `host-readiness.json`,
sobrescrito pela certificação seguinte. O log histórico READY continua íntegro.
A nova certificação usa uma cópia congelada do JSON; a limitação anterior está
em `historical-audit.json`, sem alteração retroativa do manifesto antigo.

### Barreira incremental e replay final — `8166d4f`

A revisão do primeiro gate encontrou outro caso válido: uma recompilação da
mesma ROM pode criar uma sessão de input nova sem zerar o contador de frames da
Game View. Comparar o contador apenas com o mínimo absoluto `10` ainda aceitaria
frames antigos. O harness agora ancora o contador no primeiro frame observado
depois da nova sessão e só aceita captura depois de mais dez frames; se o
renderer zera o contador, ele estabelece uma nova âncora. A identidade da ROM,
a sessão diferente da anterior, ausência de hold, canvas não preto e o gate de
pixels exato continuam obrigatórios.

Os seis testes focados passaram pelo runner Vitest (`npm test -- --run
scripts/e2e-build-frame.test.mjs`): 6/6. Na mutação que retirou o requisito de
avanço incremental, os dois testes de contador retido/resetado falharam e os
outros quatro passaram (rc=1, resultado esperado); com o código restaurado, os
seis passaram. Uma chamada exploratória com `node --test` não é válida para
esse arquivo, que importa Vitest, e não foi contada como teste de produto.

O `reference-platformer` foi reexecutado no harness `8166d4f` e no app
`1845aebf…b8b0`: 16/16 passos. O teste pintou a célula `(linha 25, coluna 1,
índice 1001)` de `0→2`; a ROM autorada e a ROM reaberta têm o mesmo SHA
`fbbdd384…16511d4a`, a célula mudou de hash `11cc6cc5` para `1bd5bd07`, e o
hash `1bd5bd07` foi observado novamente após reabrir. A Game View reportou 40
frames tanto no estado editado como no reaberto, com sessões diferentes e
`input_hold=false`. ROM original e ROM editada do limiar também estão pinadas
no resumo de evidência. O relatório bruto permanece local porque é um artefato
de execução; o resumo versionado não carrega arrays de pixels.

Certificação do mesmo HEAD: READY, frontend **912 passed / 3 skipped**,
Rust **839 passed / 0 failed / 76 ignored**, `check:tree`, lint, TypeScript,
Clippy `-D warnings`, Rust serial e upstream oficiais SGDK/PVSnesLib
`Success: true`. Fingerprint `60249508…14f6e2`, lock
`dd99a22f…ac011377`. O total de frontend aumentou em dois testes porque o gate
ganhou as duas regressões de contador.

Na consulta inicial, `linux-validate` push/PR e `desktop-smoke` push estavam
SUCCESS; `validate` push/PR e `desktop-smoke` PR ainda estavam `in_progress`.
Consulta terminal ao mesmo SHA às 23:26:04Z confirmou **6/6 success**, zero
falhas e zero pendências. Sem merge, release ou promoção: PR #99 segue draft,
dependente da #98. O pacote complementar
`data/rex_profiles/sonic_multiframe/evidence/2026-10-02-frame-barrier-r2/`
fixa os resumos, hashes e caminhos locais necessários para auditar esta rodada.
