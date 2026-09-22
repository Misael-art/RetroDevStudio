# Snapshot seguro do RetroDev Studio — 2026-09-21

Este documento identifica a linha coesa preservada antes da formatação do host.
Ele não substitui os artefatos locais BYOR, que permanecem fora do Git.

## Linha coesa para retomar

- Repositório: `https://github.com/Misael-art/RetroDevStudio`
- Branch: `codex/rex-sonic1-pilot`
- Commit: `4f8d5817cb2fdf87b3706a50056fb8beac2f538e`
- PR: `#74`, aberto, sem merge
- Base: `origin/main` em `616abdbcceb787879a7a1f2071c46919ed71bb06`
- Host: `linux/x64/biglinux`
- Host fingerprint: `60249508aff61897cdd43160d4716b2344d69282507a36c5a457c0028143f6e2`
- Lock de toolchain: `dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377`

O commit acima foi enviado para `origin/codex/rex-sonic1-pilot`. O branch contém
a cadeia ancestral de REX-04, incluindo holdout, scanner, oráculo independente de
paletas, inspeção IPC/UI, composição de frames e o piloto Sonic 1.

## Corpus BYOR

- Caminho local: `/home/misael/emulation/roms/genesis/Sonic the Hedgehog (USA, Europe).bin`
- Tamanho: `531577` bytes
- SHA-256: `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`
- A ROM não foi adicionada ao Git nem enviada ao GitHub.

## Evidência funcional já registrada

O piloto registra no Memory Bank e em `docs/REX_SONIC1_PILOT.md` a execução da
ROM base e modificada pela superfície canônica de emulação, com observação de
frames, framebuffer, ACK de input, trajetória por WRAM, movimento, salto,
pausa/retomada, salvar/reiniciar/reabrir e preservação da BYOR. A prova continua
Experimental e assistida; não declara extração universal, isolamento de paleta ou
recuperação de lógica/nós.

## Worktrees preservados separadamente

As alterações locais que não pertencem à linha coesa foram commitadas e publicadas
em branches de holdout, sem merge automático:

| Conteúdo | Commit | Branch remoto |
|---|---|---|
| Diálogos nativos fora da thread principal | `5e26333` | `codex/holdout-reproducibility-program-wip-20260921` |
| Diagnósticos extras de reabertura | `c1fd0f1` | `codex/holdout-reopen-harness-wip-20260921` |
| UI overhaul pendente e testes associados | `b96527d` | `codex/ui-overhaul-fase-a` |

Os branches históricos de REX-04 e dos frames permanecem no remoto. A comparação
de ancestralidade confirmou que seus commits relevantes já estão alcançáveis a
partir do commit coeso acima; não foi feita cópia indiscriminada de arquivos.

## Itens que não são release

`.mimosa/`, `.zcode/` e `.claude/cleanup-backups/` são logs, caches e backups de
sessões do agente, não fontes do produto. Permanecem intocados no host para
preservar o holdout local, mas não entram no snapshot Git nem na release.

## Retomada após a formatação

```sh
git clone https://github.com/Misael-art/RetroDevStudio.git
cd RetroDevStudio
git checkout codex/rex-sonic1-pilot
git rev-parse HEAD
```

O valor esperado de `git rev-parse HEAD` é o commit indicado acima. Reobter a ROM
BYOR somente de uma cópia que confirme o SHA registrado antes de executar testes.
