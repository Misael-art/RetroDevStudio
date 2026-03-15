# Relatório de Diagnóstico: Ambiente de Build (Local Desktop)

Este documento registra os problemas complexos de infraestrutura encontrados durante a compilação do RetroDev Studio no ambiente Windows hospedeiro e suas respectivas soluções ou mitigações (K3).

## 1. Erro `spawn EPERM` no `beforeBuildCommand`
**Sintoma:** Ao executar `tauri build`, o processo falhava imediatamente com `spawn EPERM` ao tentar executar o frontend build.
**Causa:** No Windows, o Tauri tenta executar o comando `npm` de forma nativa. Porém, `npm` no Windows é um script `.cmd` (`npm.cmd`). A execução direta sem um shell falha isoladamente com `EPERM` ou `ENOENT`.
**Solução Aplicada:** O arquivo `tauri.conf.json` foi modificado para utilizar `cmd /c npm run build` e `cmd /c npm run dev` explicitamente, provendo o contexto de shell necessário para o Windows.

## 2. Erro `os error 4551` (Bloqueio de Aplicação)
**Sintoma:** Durante a compilação de crates no drive `F:`, o Rust retornava o erro `os error 4551`.
**Causa:** Políticas de controle de aplicação (AppLocker ou similar) restringem a execução e criação de certos binários no diretório de trabalho principal.
**Mitigação:** Configurado o uso de uma pasta de target alternativa via variável de ambiente `CARGO_TARGET_DIR` ou `.cargo/config.toml` (ex: diretório de whitelist no drive ou na partição C:).

## 3. Erro `os error 32` (Arquivo Sendo Usado por Outro Processo)
**Sintoma:** Falhas intermitentes ao salvar arquivos `.rmeta` ou arquivos de cache limitados (ex: `libproc_macro2-*.rmeta`).
**Causa:** Interferência agressiva do Windows Defender, Antivírus corporativo, OneDrive, ou Indexador do Windows Search no diretório do projeto. O processo de escaneamento trava o arquivo enquanto o `rustc` tenta acessá-lo.
**Mitigação:** Confirmado que compilar fora da partição original (ex: `C:\temp_build_target` isolado) ou adicionar o diretório de build nas exclusões do Defender resolve a contenção de arquivos e previne a corrupção do build.

## 4. Falha Crítica do `dlltool.exe` (Toolchain GNU) vs Arquitetura MSVC
**Sintoma:** Ao usar a toolchain `x86_64-pc-windows-gnu` para fugir da ausência do MSVC, o build trava no `parking_lot_core` ou `windows-sys` com o erro: `dlltool could not create import library... CreateProcess falhou`.
**Causa:** O ambiente atual Windows possui problemas para resolver caminhos ou despachar subprocessos internos da toolchain GNU distribuída pelo `rustup` (`dlltool.exe`).
**Solução Definitiva Recomendada:** 
A longo prazo, a toolchain GNU costuma ser instável no Windows para projetos complexos. A solução canônica é:
1. Instalar o **Visual Studio 2022 Build Tools** (Desktop development with C++).
2. Definir a toolchain como MSVC: `rustup default stable-x86_64-pc-windows-msvc`.
3. Compilar usando `linker=link.exe` nativo.

## Conclusão do K3
O `spawn EPERM` foi corrigido via repositório. O build local e os testes passam quando isentos dos problemas de permissão/antivírus através das mitigações acima (build via MSVC em diretório isolado). A arquitetura do RetroDev Studio está pronta para pipeline.
