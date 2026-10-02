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
desfazer até 100 pinturas, verificar dependências e confirmar compartilhamento. O retângulo
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

## Estado no commit de implementação

Build canônico e cenário desktop `sonic-multiframe` ainda pendentes neste checkpoint.
O cenário exige composição dos dez frames, pintura nativa, confirmação, acúmulo de paleta,
BPS, reinício real, reabertura e pixels independentes com hit-test desobstruído.
A comparação no core é uma prova separada; prévia não é efeito de jogo.
Não há recuperação geral de animação, cadência do jogo, lógica ou suporte universal.
Sem merge, release ou promoção de maturidade.
