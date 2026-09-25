# Perfil: Kosinski (variante base, não-modular) — fase 2 concluída

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

Demais fatos (confirmados):
- bit 1 → literal; bits 0,0 → inline `len=((h<<1)|l)+2` (2..5),
  `dist=0x100 - byte` (byte 0 → 256); bits 0,1 → separado Low/High,
  `Count3=High&7`: `≠0 → len=Count3+2` (2..9, 2 bytes); `==0` → 3º byte `c`:
  `0 → FIM` (decoder para AÍ; nada após o terminator é consumido),
  `1 → 'continue'` sem cópia (quirk, golden m06), senão `len=c+1` (3..256);
  `dist = 0x2000 − (((High&0xF8)<<5)|Low)` (1..0x2000).
- Cópia byte a byte com eco/sobreposição (LZSS clássico).
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
  reproduzidos pelo espelho (`RT-OK+MIRROR`).
- 8 goldens artesanais (literais+EOD, inline, separado 2-byte no limite
  Count3, match longo 256×dist 8192, quirk continue, eco com dist=histórico,
  forma 3-byte len 10) → publicados somente com `koscmp -x` decodificando
  para a saída exata (`GOLDEN-CONFIRMED`).
- Regenerável: `bash scripts/rex_profiles/codecs/kosinski/build-vectors.sh`
  (timeout em toda chamada ao oráculo; aborta se o espelho divergir).
- Hash agregado/documento: ver `data/rex_profiles/codec/kosinski/evidence/`.

## Pendências deste perfil

- [ ] Implementação Rust do produto (decode+encode) contra estes vetores —
      exige janela de job pesado do integrador.
- [ ] Negativos estruturados do produto (truncado/invalid-reference/
      excessive-output/work-limit/cancelamento) — contrato v1 §4.
- [ ] Modo modular (`-m`): capacidade separada, blocked.
- [ ] Caso de recurso real em ROM (identificação) — domínio do integrador.
