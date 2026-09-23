# Aceite de autoria guiada (Experimental)

Branch `codex/rex-reference-goal-pilot`. Cenário `npm run test:e2e:desktop:authoring-acceptance`.
Evidência final: `src-tauri/target-test/validation/authoring-acceptance-2026-09-23T17-10-34-246Z-report.json`,
binário `src-tauri/target-test/debug/retro-dev-studio` SHA `6cebe930605d53bed0baf85a21487613c423e2e35d60c61aa01e420f861063dc`, commit `a6c02af`.
ROM jogada `…-played.rom` SHA `d5001b5b5247901b045d0b5dc96ee61835592e1d4a3f910cecd43653264e81e5`.

O fluxo usa apenas a interface normal com input nativo do WebDriver: criar fase pelo wizard → modo Guiado →
Cenário (tijolo pintado, célula apagada, colisão liberada, Ctrl+Z/Ctrl+Y) → Personagem (duplicar bloqueador, X=120,
FPS do idle 12) → Regras (limiar da passagem principal 12, segunda passagem com limiar 60) → Sons (conclusão → `victory`,
prévia real do WAV) → Salvar (indicador "Salvo") → reiniciar o app → reabrir → Testar (Build & Run) → jogar com as setas
e Z até vencer. Nenhum `emulator_send_input` nem avanço manual de frames nesse cenário; RAM, imagem e áudio só são observados.

| Capacidade | Classificação | Evidência (execução final) |
| --- | --- | --- |
| Recursos visíveis (viewport + Inspector) antes/depois da reabertura | Funcional pela interface | contagem pronta = referenciada, 0 falhas; pixels reais do personagem/bloqueador/chão no canvas; preview 80×16 decodificado |
| Layout 1920×1080, 1366×768 e escala 125%; foco por teclado | Funcional pela interface | etapas, status de salvamento e campos essenciais visíveis e desobstruídos (hit test) |
| Salvar sem perda; reiniciar/reabrir | Funcional pela interface | tijolo, célula vazia, colisão, FPS 12, passagens (12; `passage_blocker_2`/60/`passage_2_open`) e som `victory` restaurados |
| Undo/redo | Funcional pela interface | Ctrl+Z volta a célula a 0; Ctrl+Y reaplica a célula vazia |
| Jogo pelo teclado até a vitória | Funcional pela interface | 4 ACKs nativos, 1 pulo; principal abre no score 12 (x=36), segunda no 60 (x=106); personagem cai no buraco e sai pulando; vitória em x=132, score 73; personagem visível no frame |
| Som associado no evento | Funcional pela interface (amostras do core recebidas pelo app) | 1320 Hz: 0,37 antes → 85,9 depois da vitória; 880 Hz (padrão, não associado) 12,1 depois |
| Encaminhamento ao WebAudio | Funcional (telemetria) | incluída no relatório |
| Captura acústica/loopback | Inconclusivo | não medida; `parec` não retorna amostras neste host |

Testes técnicos associados (SGDK + core oficiais): valor de tile N = tile N−1 da imagem, célula vazia em branco, 0 preserva o
mapa-base; parede lateral (para em x=80); buraco de uma célula (y=200) com saída por pulo; associação de som 880/1320 Hz;
passagens pelos dois lados; salto; animação.

Defeitos corrigidos nesta fatia: PPM carregado pelo WebView (falhava para todo sprite P6); duplicata de prefab renderizada
como objeto; override parcial de componente de prefab invalidava o salvar; salvar com falha recarregava o disco e descartava
o trabalho; a hierarquia relia a cena do disco a cada troca de workspace (descarte silencioso); edição do NodeGraph no
debounce de 600 ms ficava fora do Salvar e era descartada ao desmontar; composição do viewport omitia o mapa-base com células;
tiles pintados na ROM vinham do tileset deduplicado (diferente da paleta); "apagar" era indistinguível de "sem alteração";
Build & Run não registrava a identidade da ROM; teste de corpus corrompia variável de ambiente em paralelo.

Limites: rodar a Game View sob WebDriver neste host dá ~3–7 FPS (o jogo é jogável, porém lento); a visão "Quando → Se → Fazer"
é somente leitura e marca regras com ramo "senão" como avançadas; reordenação de frames de animação não é suportada pelo emissor
(apenas FPS); a paleta guiada fica no painel lateral; o buraco de 2 linhas é uma armadilha com o salto atual (~15 px).
Tudo segue Experimental, sem merge.

## Revisão de arte no template (branch `codex/reference-platformer-fox-art`)

A matriz acima é histórica do commit `a6c02af` e de seus placeholders; não representa a arte atualmente testada. A revisão de 2026-09-23 integra, como **candidatos técnicos**, cinco quadros 32×32 da raposinha, portão 24×32, bandeira 16×32 e paisagem Forge 320×224. O primeiro plano de grama/terra/tijolo ainda é provisório. Proveniência, jobs imutáveis, hashes e limitações: [`data/reference_platformer_art/README.md`](../data/reference_platformer_art/README.md).

O build testado tem SHA-256 `f87636051d8866464bf34dcb241f39fde5ea67124f9efc0b3d7c5db2ce9619b9`. O E2E de autoria guiada passou 10/10, agora com preview 160×32 e pixels reais de pelagem, cachecol, espada, grama, céu e montanhas no canvas antes e depois de reiniciar. O E2E de referência passou 16/16, incluindo input nativo, salto, pausas e passagem persistida. Relatórios e capturas versionados em [`data/reference_platformer_art/doc/evidence`](../data/reference_platformer_art/doc/evidence). A ROM final jogada nessa execução tem SHA-256 `d300878b3f41edf870c4506386ad5f7fb87c5d44e610e6258b3c4c0936eeb6ec`.

Isso comprova a integração funcional da arte na fase de referência, não uma aprovação estética final ou generalização de assets. Sem merge.
