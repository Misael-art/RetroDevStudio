# Perfil: Kosinski (variante base, não-modular) — fase 2 + negativos concluídos

Status: **Experimental — vetores fixados pelo oráculo externo mdcomp koscmp;
implementação de produto não começada** (aguarda janela do integrador).

Propriedade: scripts/rex_profiles/codecs/kosinski/,
data/rex_profiles/codec/kosinski/, docs/rex_profiles/codecs/kosinski.md.

## Referência fixada (oráculo externo, nada transplantado)

| Papel | Artefato | Pin | Licença |
|---|---|---|---|
| encoder/decoder de referência | mdcomp `koscmp` (C++, `src/lib/kosinski.cc`) | commit `72c6df405a75d322c5b3722da46c3abb864d3793` | LGPL-3.0 — **somente ferramenta externa**; proibido transplantar código ao produto |

Paridade com um segundo descodificador independente (drives 68k clássicos de
Sonic) **não foi executada** nesta rodada → capacidade declarada `blocked` no
manifest. Ao contrário de aPLib (2 oráculos multi-autores), aqui há 1 oráculo.

## Especificação do formato (MEDIDA, não presumida)

Dois erros da derivação inicial (baseada só em memória do "formato clássico")
foram corrigidos por calibração 12/12 contra streams reais do koscmp:

1. **O descritor NÃO é um byte de tag MSB→LSB.** É uma palavra de **16 bits
   em 2 bytes little-endian**, consumida **LSB→MSB** (`descriptor_t=uint16_t`,
   `descriptor_endian_t=LittleEndian`, `DescriptorLittleEndianBits=true` em
   `kosinski.cc:49-67` + `ibitstream` de `bitstream.hh`).
2. **EARLY FETCH** (`NeedEarlyDescriptor=true`): a próxima palavra de
   descritor é lida **imediatamente após o 16º bit consumido** — os 2 bytes
   caem na stream ANTES de quaisquer bytes de dados seguintes. Um token cujo
   último descritor bit é o 16º tem seus dados após o placeholder novo.
   Modelo completo em `kos_mirror.py` (docstring) e escritor `Kos` em
   `gen_vectors.py`; paridade validada 12/12.
2b. **Vetores discriminantes da fronteira (m09/m10, confirmados pelo
   oráculo):** m09 = 16 literais — o 16º bit do descritor dispara o early
   fetch, então o byte de dados do 16º literal cai em offset **19**, depois do
   placeholder da segunda palavra (asserção explícita no gerador); m10 = token
   inline cujos bits de comprimento **atravessam** a borda de 16 bits — o byte
   de `dist` entra em offset **17**, após o placeholder. Um leitor "late fetch"
   (descritor só lido no início do próximo token) desloca todos os bytes
   seguintes e é **rejeitado** por `koscmp -x` → os goldens não seriam
   confirmados. A confirmação pelo oráculo é o discriminante da prova.

Demais fatos (confirmados):
- bit 1 → literal; bits 0,0 → inline `len=((h<<1)|l)+2` (2..5),
  `dist=0x100 - byte` (byte 0 → 256); bits 0,1 → separado Low/High,
  `Count3=High&7`: `≠0 → len=Count3+2` (2..9, 2 bytes); `==0` → 3º byte `c`:
  `0 → FIM` (decoder para AÍ; nada após o terminator é consumido — e o
  koscmp ainda emite 1 byte de padding depois dele, ver abaixo),
  `1 → 'continue'` sem cópia (quirk, golden m06), senão `len=c+1` (3..256);
  `dist = 0x2000 − (((High&0xF8)<<5)|Low)` (1..0x2000).
- Cópia byte a byte com eco/sobreposição (LZSS clássico).
- **`bytes_consumed` MEDIDO no oráculo:** o `koscmp` pode emitir **1 byte de
  padding após o terminator** (`… 00 F0 00 00`, observado nas 12 streams
  reais). O decoder para no terminator → contrato: `bytes_consumed <= len(stream)`,
  não necessariamente `==`. Espelho strict bate 12/12 com essa semântica.
- Encoder mdcomp usa parser ótimo (não-guloso): recompressão do produto não
  precisa reproduzir bytes idênticos, só decodificação exata nos dois sentidos.
- O oráculo **não valida nada**: truncado de 1 byte foi ACEITO com saída
  maior que a esperada; `dist` fora do histórico lê posição inválida do
  stringstream (comportamento não-determinístico). Erros estruturados do
  contrato v1 (`truncated`, `invalid-reference`, `excessive-output`,
  `work-limit`) são obrigações do produto **sem espelho no oráculo**.

## Vetores publicados (fixture-only, autoral)

- 12 plains (fronteiras: vazio, 1 byte, inline 256, janelas 40k/2k, len 256,
  texto/aleatório/tiles, runs ruidosos) → roundtrip exato pelo oráculo +
  reproduzidos pelo espelho (`RT-OK+MIRROR`) **e** reproduzidos pelo espelho
  em **modo contrato (strict)** nas streams reais do oráculo (12/12).
- 10 goldens artesanais (literais+EOD, inline, separado 2-byte no limite
  Count3, match longo 256×dist 8192, quirk continue, eco com dist=histórico,
  forma 3-byte len 10, **m09/m10 early-fetch**) → publicados somente com
  `koscmp -x` decodificando para a saída exata (`GOLDEN-CONFIRMED`).
  Em modo strict: 9/9 OK, com **exceção declarada m02** — literal único SEM
  terminator (o nome diz "with_eod" por engano histórico; preserved para não
  alterar fixture publicada): aceito pelo oráculo por exaustão, seria
  `truncated` sob o contrato do produto.
- 5 negativos `negative-spec` (k01 EOF após literal sem terminator →
  `truncated`; k02 separado truncado no byte de dados → `truncated`;
  k03 separado dist=3 sobre histórico vazio → `invalid-reference`;
  k04 inline dist=256 sobre 1 byte → `invalid-reference`; k05 stream
  **bem-formada** de 512 bytes de saída com `max_out=16` →
  `excessive-output`) — derivados do **contrato/formato**, auto-verificados
  pelo espelho strict; **o oráculo não é executado sobre eles** (a referência
  não valida — defeito registrado pelas sondas do build). k05 prova que o
  limite é obrigação do produto, não defeito da entrada.
- Regenerável: `bash scripts/rex_profiles/codecs/kosinski/build-vectors.sh`
  (timeout em toda chamada ao oráculo; aborta se o espelho divergir em
  qualquer camada; república limpa das subáreas de vetores).
- Hash agregado/documento: ver `data/rex_profiles/codec/kosinski/evidence/`
  (`agregado=ea866df797126230b36e27b76ca569d4fd8528d291e86fe578491998ec3d96d1`,
  reproduzido 2× com valor idêntico; receita canônica no evidence).

## Pendências deste perfil

- [x] Negativos estruturados do produto (truncado/invalid-reference/
      excessive-output) — 5 vectors `negative-spec` derivados do contrato v1,
      espelho strict como verificador; `work-limit`/`cancelamento` são
      semantics de execução do produto (sem espelho em stream; cobertos pelo
      contrato, não por vetores).
- [x] Fronteira de early-fetch com vetores discriminantes (m09/m10).
- [ ] Implementação Rust do produto (decode+encode) contra estes vetores —
      exige janela de job pesado do integrador.
- [ ] Modo modular (`-m`): capacidade separada, blocked.
- [ ] Caso de recurso real em ROM (identificação) — domínio do integrador.
