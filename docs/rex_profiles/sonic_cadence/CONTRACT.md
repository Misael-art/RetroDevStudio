# CONTRATO de cadência — Sonic 1 `id_Wait` (SonAni_Wait)

Classificação: **provado estaticamente contra a ROM pinada; duração efetiva
medida em frames emulados na Etapa 4 — veredito `H_N+1` (byte N ⇒ o frame
ficou visível por N+1 frames de tela em NTSC)**. Nada aqui depende de nome de
arquivo, aparência, tamanho ou "parece uma animação".

Verificador independente (não importa nenhum módulo de produto):
`scripts/qa/sonic-cadence-contract.mjs`. Relatório da corrida:
`data/rex_profiles/sonic_cadence/evidence/2026-10-02-contract/contract-verification.json`
(16/16 checks, rc=0). Verificador do oracle de runtime:
`scripts/qa/sonic-cadence-runtime-oracle.mjs`, com manifesto, seis séries
corridas e veredito em
`data/rex_profiles/sonic_cadence/evidence/2026-10-03-oracle/`
(allPass=true, hipótese única `H_N+1` sobre A/B/C). Referências de semântica: cópia pinada do s1disasm
rev00 em `~/.cache/rex-corpus-d/s1disasm` (HEAD `064e3c6`), arquivos
`_incObj/01 Sonic.asm` e `_anim/Sonic.asm`.

## 1. Identidade e variante da ROM

- Arquivo: `Sonic the Hedgehog (USA, Europe).bin`, 531577 bytes.
- SHA-256: `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`.
- Variante: REV00 (USA/Europe), conforme perfil assistido já documentado da
  consolidação (`docs/rex_profiles/sonic_multiframe/REPORT.md`).
- Extra de 7289 bytes após o offset `0x80000` é resíduo de dump ("ESE_S1_TC");
  fora de todo intervalo deste contrato.

## 2. Convenção de endereçamento (comprovada, sem viés)

O `.bin` é dump raw padrão: **offset de arquivo = endereço CPU − `$100000`**
(ROM mapeada em `$000000`, então para endereços `$0xxxxx` arquivo == CPU).
Evidências independentes, cada uma insuficiente sozinha:

- vetor de CPU em file `0x0` (SSP `$00FFFE00`); header `"SEGA"` em file `0x100`;
- SHA da arte crua pinado no produto casa com os bytes em file `0x21AFE`;
- o operando absolute-long `$00013B48` do `lea` de `Sonic_Animate` aponta
  exatamente para o conteúdo da tabela em file `0x13B48`;
- disassemblagem m68k limpa do código nos offsets de arquivo (via
  `m68k-elf-objdump` com wrapper `.incbin`).

A hipótese errônea de viés `0xFF` (pre-header) foi testada e **refutada**: ela
desalinharia as três âncoras acima simultaneamente.

## 3. Tabela e sequência-alvo

- Tabela `Ani_Sonic`: file **`0x13B48`**, 31 palavras big-endian = offset
  **relativo à base da tabela** até cada script. Scripts a partir de `0x13B86`.
- Sequência-alvo: anim **5** (`id_Wait`), script em file **`0x13BAE`**.
- Layout do script (bytes literais na ROM):
  `17 | 01×12, 03, 02, 02, 02, 03, 04 | FE 02`
  - byte 0 = intervalo, raw `$17` = 23, bit 7 claro → não especial;
  - 18 frames (índices de arte, ordem exata acima);
  - terminador `afBack $FE` com k=2 → retrocede 2 frames e repete para sempre
    os dois últimos (`03`,`04` = batida de pé).
- Periodicidade medida no loop estável (fase da batida de pé): troca de frame
  a cada 24 frames de tela com byte 23 (moda cobre 0,99 dos gaps; 77
  transições na run A1 do oracle). O ciclo completo das 18 passagens não é
  afirmado: um gap atípico de 72 frames aparece uma vez na transição interna
  do script e nenhuma fórmula de ciclo total foi provada. A fórmula anterior
  "18 × 23 ticks" foi substituída por esta medição.

## 4. Consumidor e referências comprovadas

- Prólogo de `Sonic_Animate` (padrão de bytes
  `43F9 00013B48 7000 1028 001C B028 001D`) ocorre **exatamente uma vez** no
  arquivo, em `0x139C4`; a sequência absoluta `00 01 3B 48` ocorre **exatamente
  uma vez**, em `0x139C6`, dentro desse prólogo → **um único leitor da tabela**.
- Sites que armazenam `obAnim` com `move.b #id,$1C(a0)` (encoding `117C 00ii 001C`,
  conferido montando com `m68k-elf-as` da toolchain SGDK pinada):
  - `id_Wait` (5): `0x12F02`, `0x131C2` (dentro de `Sonic_Move`);
  - `id_Stop` (19): `0x130D2`, `0x13138`; `id_Death` (24): `0x1B0CC`;
    `id_Hurt` (26): `0x1B066`.
- Caso reservado verificado como contraste: `id_Death` (24) em `0x13C18` é
  script de frame único (`03 4D FF 00`) — inapropriado como alvo de cadência.
- Excluídos do alvo por motivo documentado: Walk/Run/Roll (intervalo raw com
  bit 7 → handler especial dependente de velocidade/inércia; **não** é duração
  constante), `id_Warp*`/`Spring`/`GetAir`/`Null`/`Float4` (terminador `afChange`
  encadeia para outra animação), frames únicos.

## 5. Semântica do campo de duração

Caminho não-especial de `Sonic_Animate` (`_incObj/01 Sonic.asm`, Após o `bra.s
DoAni` do handler especial):

```
subq.b #1, obTimeFrame(a0)
bpl  WaitNextAni            ; >=0 continua segurando o frame atual
move.b d0, obTimeFrame(a0)  ; d0 = byte de intervalo lido do script
avança para o próximo frame do script (aplicando afBack/afEnd/afChange)
```

- **Duração efetiva (medida — Etapa 4)**: byte N ⇒ o frame fica visível por
  **N+1 frames de tela** em NTSC. Veredito `H_N+1` único sobre as três
  corridas do oracle: moda dos gaps = 24 (byte 23), 41 (byte 40), 61 (byte
  60), com razão ≥ 0,95 e reload do contador igual ao byte do arquivo em cada
  variante. Evidência: `data/rex_profiles/sonic_cadence/evidence/2026-10-03-oracle/`
  (`veredito.json`, allPass=true). O contrato anterior NÃO afirmava byte N =
  N frames antes desta medição; agora afirma byte N = N+1 frames exibidos,
  somente para NTSC e o caminho não-especial.
- **Unidade**: tick da rotina de objetos do jogo, igual a 1 frame de tela no
  caminho normal de `Sonic_Animate` (chamada 1× por VBlank em 60 Hz NTSC/PAL-50;
  PAL-60 não medido — permanece explícito como não medido).
- **Previsão para a UI**: duração prevista de exibição = (byte + 1) frames de
  tela; em 60 Hz, `(byte + 1) / 60` segundos. A prévia da interface toca no
  ritmo medido; continua rotulada como prévia e nunca usada como prova.
- **Velocidade de apresentação da prévia na UI**: propriedade da UI, nunca
  usada como prova de duração; rotulada como prévia.
- Ao trocar de anim (`obAnim != obPrevAni`): `obAniFrame=0`, `obTimeFrame=0` e
  o primeiro frame é carregado no mesmo tick — o efeito exato dessa
  transição não foi medido isoladamente; os gaps medidos são do regime
  estacionário.

## 6. Comandos de fim/retorno/mudança

- `$FF` `afEnd`: volta ao primeiro frame do script (loop completo).
- `$FE k`: volta k frames e continua (usado pelo alvo com k=2).
- `$FD id`: `afChange` — troca para a anim `id` sem resetar posição; o alvo não
  contém esse token. Os três tokens nunca aparecem como frame no alvo (frames
  `$01..$04`), verificado byte a byte (check `sem-colisao-de-token`).

## 7. Limites editáveis e valores reservados

- Editável: **`$01..$7F`** no byte `0x13BAE` (intervalo do alvo).
- Reservado `$00`: comportamento degenerado (avanço a cada tick) não comprovado
  neste pipeline; recusado até medição própria.
- Reservado `$80..$FF`: bit 7 ⇒ handler especial walk/run/roll com outra
  semântica de tempo (dependente de velocidade) — recusado.
- `$FD..$FF` jamais serão aceitos como valor de frame (são tokens de script).
- Qualquer outro byte do script (frames, terminador) e qualquer outro arquivo
  da ROM é fora de escopo: recusado.

## 8. Bytes que podem mudar e compartilhamento

- Único byte editável: **file `0x13BAE`** (1 byte por operação de cadência).
- Os 31 bytes de intervalo são endereços distintos (check
  `intervalo-nao-compartilhado`: 31/31 únicos). O byte do alvo não pertence a
  nenhum outro script, à tabela, nem a qualquer área de arte/paleta/mapping
  usada pelo perfil multiframe.
- Nenhum outro script referencia o script do alvo (cada offset da tabela é
  usado por exatamente uma animação; tabela tem 31 entradas para 31 scripts).
- Consequência: nenhuma confirmação de compartilhamento é necessária nesta
  operação — o contrato a dispensa por prova de unicidade, não por omissão.

## 9. Critérios de recusa (backend)

Recusar, sem escrever nada: ROM com SHA fora do pino ou variante divergente;
conteúdo da tabela ≠ esperado nos endereços do contrato; byte `0x13BAE` ≠
`$17` antes da escrita (origem adulterada); animação não listada; valor fora
de `$01..$7F` ou igual ao atual (no-op explícito, não erro silencioso); script
com tokens desconhecidos; qualquer tentativa de escrever fora do intervalo de
1 byte.

## 10. Caminho de execução para alcançar a animação no jogo

`Sonic_Move` (`_incObj/01 Sonic.asm`) define `obAnim=id_Wait` quando Sonic está
parado em chão plano (`angle` snap 0) com `obInertia=$0000` e sem direção
apertada (rótulo `.notright`, ~linhas 408–410; os dois sites `0x12F02`/`0x131C2`
são exatamente esse caminho). Em jogo: soltar todos os botões após parar de
caminhar em terreno plano → Sonic entra em `id_Wait` e o loop da batida de pé
roda indefinidamente. A Etapa 5 alcança esse estado por input nativo na Game
View, sem injeção direta de estado (uma sonda técnica separada, se usada, é
rotulada como sonda).

## 11. O que este contrato NÃO afirma

- Não afirma comportamento em PAL (nem PAL-50 nem PAL-60) nem em modo
  especial de stage (fora do alvo); a medição `H_N+1` vale para o caminho
  não-especial em NTSC.
- Não é recuperação automática: a identificação é assistida pelo perfil rev00 +
  verificação byte a byte desta ROM; outras ROMs/variantes serão recusadas até
  contrato próprio.
- Não autoriza mudar número de frames, ordem, terminadores ou qualquer outro
  byte da tabela/scripts nesta missão.
