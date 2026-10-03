# Evidência: barreira incremental de frames no Build & Run

Este pacote registra o fechamento local da falha de comparação do tilemap na
reabertura do projeto de referência. Ele não contém ROM, PNG, captura RGBA,
assets comerciais ou o relatório E2E bruto. O relatório bruto e logs ficam no
diretório local ignorado e são identificados abaixo por caminho e SHA-256.

O código provado está no commit `8166d4f1d0f105e04cd1faf3a43601da19ad7e2d`;
o binário testado é identificado pelo SHA em `reference-desktop.json`. O
replay `reference-platformer` terminou 16/16. O gate só aceita o framebuffer
quando a ROM compilada tem a mesma identidade da Game View, a sessão Joypad é
nova, o envio não está em hold e pelo menos dez frames renderizados avançam
depois do primeiro frame observado na sessão. Se o contador reiniciar, a
âncora é refeita; um contador antigo preservado por rebuild de ROM idêntica não
serve como crédito.

## Reexecução local

No host certificado e com a ROM/projeto de referência autoral disponível:

```sh
rtk proxy npm test -- --run scripts/e2e-build-frame.test.mjs
rtk proxy python3 src-tauri/target-test/validation/sonic-multiframe/reference-replay-r2.py reference-ci-barrier-r2.log
rtk proxy npm run host:certify
```

O helper de replay, binário, relatório bruto, logs e JSONs mutáveis do host são
locais e ignorados pelo Git. O manifesto fixa seus hashes como evidência local;
o pacote versionado contém somente resumos sem dados de ROM/imagem.

## Resultado

Seis testes focados passam. A mutação que remove o requisito de avanço de dez
frames faz falhar exatamente os dois testes de contador retido/resetado; com o
gate restaurado, passam. O E2E em WebKit/Xvfb validado completou as 16 etapas,
e a célula de tilemap pintada `0→2` permaneceu idêntica entre a ROM autorada e a
reaberta (`1bd5bd07`). A certificação do host ficou READY; veja os resumos e o
manifesto para os contadores, IDs de job e hashes completos.

CI foi consultado por SHA. A fotografia inicial de jobs em andamento não foi
tratada como veredito; `ci-terminal-8166d4f.json` registra a consulta posterior
terminal de 2026-10-02T23:26:04Z: seis checks success, zero falhas e zero
pendências.
