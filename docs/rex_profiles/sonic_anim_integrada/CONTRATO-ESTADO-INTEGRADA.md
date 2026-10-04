# CONTRATO de estado integrado — edição de animação Sonic 1 (pixel + paleta + cadência)

Perfil: `sonic_anim_integrada` (jornada integrada sobre as frentes provadas
`sonic_multiframe` e `sonic_cadence`). Classificação: **Experimental / local
profile validation**. Este contrato CONSOLIDA os contratos publicados
(`docs/rex_profiles/sonic_multiframe/REPORT.md`,
`docs/rex_profiles/sonic_cadence/CONTRACT.md`) sem reescrevê-los: nada aqui
reafirma o que eles não afirmam (PAL, outros cores, "qualquer animação",
recuperação geral).

Escopo do contrato: um único estado de trabalho precisa sustentar as três
camadas de edição **simultaneamente e em qualquer ordem**, e uma edição não
pode desfazer silenciosamente outra.

## 1. Identidade de base e de cópia

- Base: `Sonic the Hedgehog (USA, Europe).bin`, 531577 bytes, SHA-256
  `c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb`
  (pino do corpus BYOR; nunca versionada; lida via `RDS_INSPECTION_ROM`).
- Cada operação de edição produz **um novo arquivo imutável** em
  `<RDS_DECOMP_WORK>/extract/<base_sha>/edits/`, nomeado pelo próprio SHA,
  com diff cumulativo contra a base contido exclusivamente na whitelist de
  regiões (`sprite_composition.rs:584-591`): região de arte, região de
  paleta e o byte `0x13BAE`. A base nunca é aberta para escrita.
- A origem de cada edição é a **última cópia verificada** (`session.edit`),
  revalidada por SHA — não a base. Isso já é comportamento do produto; este
  contrato o congela como invariante.
- Cópia tem identidade verificável: a cadeia `base_sha → edit_sha` é
  reproduzível; BPS(base → cópia) reaplicado sobre a base **reproduz a cópia
  byte a byte**, e a base permanece byte-idêntica ao pino.

## 2. Sequência suportada e distinções obrigatórias

- Sequência-alvo: animação **5** (`id_Wait`) da tabela `Ani_Sonic` em
  `0x13B48`; script em `0x13BAE`; layout
  `17 | 01×12, 03, 02, 02, 02, 03, 04 | FE 02` (18 quadros).
- **Entrada da sequência** = offset relativo na tabela (31 palavras
  big-endian); não é um quadro e não é editável nesta missão.
- **Quadro desenhado referenciado** = índice de arte do script (`01..04`),
  resolvido por slot de mapping → DPLC → tile → nibble; os 10 quadros
  compostos pelo perfil multiframe são desenhos, não a sequência inteira.
- **Duração efetiva** = tempo que o quadro fica em tela. Veredito medido
  `H_N+1`: byte N ⇒ N+1 frames de tela em NTSC, caminho não-especial.
  A UI mostra a previsão `(byte+1)` e **nunca** rotula duração como FPS.
- **Repetição/terminador** = `FE k` (retrocede k; alvo usa k=2, batida de
  pé indefinida), `FF afEnd`, `FD afChange` (ausente no alvo). Terminadores
  e índices de quadro NÃO são editáveis nesta missão; só o byte de intervalo.

## 3. Unidade e valores

- Unidade: tick da rotina de objetos = 1 frame de tela em 60 Hz (NTSC).
  PAL e demais modos permanecem **não medidos**; declarados como tal.
- Editável (cadência): `$01..$7F` em `0x13BAE`, 1 byte por operação.
  Reservados recusados: `$00`, `$80..$FF` (handler especial), tokens
  `$FD..$FF` jamais aceitos como quadro.
- Editável (pixel): nibbles de tiles mapeados do quadro selecionado, sem
  compartilhamento DPLC não confirmado (guarda existente).
- Editável (paleta): palavras RGB333 dos índices 1..15; índice 0 é
  transparência e é recusado.

## 4. Operações acumuláveis (o núcleo da integração)

- Operações: pintura de N pixels, mudança de 1 cor de paleta, mudança de 1
  byte de intervalo. Domínios de bytes **disjuntos** por construção
  (arte × paleta × `0x13BAE`; unicidade do byte de cadência provada no
  contrato de cadência, §8).
- Invariante de comutatividade: para qualquer par de edições de domínios
  distintos, a cópia final é **byte a byte idêntica** nas duas ordens, e
  contém exatamente a união dos diffs. Provas exigidas:
  pixel→cadência preserva pixel; cadência→pixel preserva cadência;
  paleta preserva ambos; edição tripla em duas ordens converge.
- Serialização já existente (`SONIC_EDIT_GUARD`) é mantida; duas operações
  nunca partem da mesma cópia obsoleta.

## 5. Persistência, proveniência e restauração

- Sessão `rex-inspection-session/v1` persiste em JSON; reabrir deve
  restaurar **o conjunto** (cópia + pixels + paleta + cadência) e a
  **proveniência de cada domínio aplicado** — não apenas o último.
  Implementação atual guarda um único registro `session.edit` (última
  operação); este contrato exige o histórico cumulativo por domínio
  (formato, offsets, valores anteriores/sucessivos, SHA da cópia resultante).
- Reabrir recompõe a sequência a partir dos BYTES da cópia (duração lida de
  `0x13BAE`, arte/paleta do pipeline), nunca de memória de UI.
- **Restaurar um domínio não apaga os outros**: restaurar a cadência escreve
  `$17` em `0x13BAE` mantendo diffs de arte/paleta; restaurar a paleta mantém
  pixel e cadência. Restauração é uma edição comum (composição reversa), sem
  segundo patcher.
- No-op é **resultado explícito**, não erro: pedir valor igual ao atual
  (qualquer domínio) devolve `ok` com classificação `noop`, sem criar
  arquivo, sem mover a cadeia de SHA, com mensagem em linguagem de usuário.
  Idempotência legítima não é apresentada como falha técnica.
- Selecionar outra moldura/sessão invalida respostas pendentes (guardas de
  sequência existentes por domínio); resposta de edição de sessão antiga não
  substitui a sessão atual.

## 6. Compartilhamento

- Cadência: 1 byte único, sem compartilhamento (provado por unicidade no
  contrato de cadência).
- Pixel: tile compartilhado por mais de um DPLC exige confirmação explícita
  (guarda existente `sonic-paint-confirm-shared`).
- Paleta: banco Rev00 do perfil; bancos não comprovados permanecem recusados.

## 7. Erros e limites (recusar sem escrever)

- SHA da base fora do pino, tabela/script divergente do contrato, byte
  corrente ≠ esperado para a origem alegada: recusar, nada escrito.
- Qualquer diff fora da whitelist de regiões: recusar (gate cumulativo já
  existe em `read_sonic_session_rom`).
- Valores reservados/fora do domínio editável: recusar com explicação.
- Limites de lote de amostragem no core: `SAMPLED_RUN_MAX_FRAMES=10_000`,
  janela ≤ 512 bytes; lote longo de diagnóstico NUNCA é anexado ao fluxo
  normal de edição (existe perna separada de observação).
- Truncamento, execução parcial ou ausência de amostras deve aparecer no
  resultado; nunca escondido.

## 8. Identidade da ROM executada (auditoria exigida pela missão)

- Situação atual: `emulator_run_frames_sampled`, `emulator_observe` e o
  harness de paridade calculam `rom_sha256` lendo o **caminho em disco** no
  momento da chamada. Isso prova "arquivo atual neste caminho", não
  "bytes que o core carregou e executou".
- Este contrato exige: identidade capturada **na carga do core**
  (`load_rom` guarda o SHA-256 dos bytes efetivamente carregados na sessão
  do core) e reportada em toda leitura derivada da execução.
- Semântica dos campos em resultados de execução: `loaded_rom_sha256`
  (bytes em execução) é a identidade autoritativa; se o arquivo do caminho
  em disco divergir, o resultado declara a divergência explicitamente
  (`disk_file_sha256`, `disk_matches_loaded: false`) — a amostragem continua
  refletindo a ROM **carregada**, e "ROM carregada" ≠ "arquivo no caminho".
- Corpus original intocado: o teste de troca pós-carga usa cópia em scratch
  isolado, nunca o arquivo BYOR pinado.

## 9. O que este contrato NÃO afirma

- Não amplia o domínio editável além das três camadas atuais; não autoriza
  mudar número de quadros, ordem, terminadores, mapeamento ou DPLC.
- Não afirma PAL, outros cores, outros jogos, "qualquer animação".
- Não introduz encoder nem formato de ROM novo; BPS/IPS permanecem no
  `patch_studio` canônico (não se cria outro patcher).
- Prévia da UI continua demonstração; prova de duração é só a medição no
  core (H_N+1) ou jornada desktop com verificador independente.
