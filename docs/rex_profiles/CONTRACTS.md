# Contratos REX v1 — congelados pelo integrador

Base canônica: `0d8c413ff818de04f6c9f9f1bd8a5ed614b14862` (branch integradora
`codex/rex-integrator-profiles-codecs`). Esta é a versão **v1** dos contratos da
rodada REX de endereçamento/codecs. Qualquer mudança exige versão nova (v2)
publicada pelo integrador com justificativa; consumidores nunca adivinham
mudanças nem implementam além do que está escrito aqui. Plano de fundo:
`docs/handoffs/REX_PARALLEL_PLAN.md`.

Propriedade de arquivos: A é dono de `scripts/rex_profiles/addressing/`,
`data/rex_profiles/addressing/` e `docs/rex_profiles/addressing/`; B é dono de
`scripts/rex_profiles/codecs/`, `data/rex_profiles/codecs/` e
`docs/rex_profiles/codecs/`. O integrador é o único a alterar arquivos comuns
(este contrato, `ROUND_STATE.md`, IPC/UI, manifests incorporados, ledger e CI).

## 1. Contrato de perfil (`ProfileManifest`)

Cada perfil entrega um manifest imutável em
`data/rex_profiles/<kind>/<profile_id>/manifest.json` com:

```json
{
  "contract_version": 1,
  "id": "kebab-case-estavel",
  "kind": "addressing" | "codec",
  "version": 1,
  "platform": "mega-drive" | "snes",
  "variant": "descricao-exata-da-variante",
  "support": "fixture-only" | "corpus-identified" | "blocked",
  "blocked_reason": "obrigatorio quando support=blocked",
  "source": {
    "name": "nome da fonte primaria",
    "url": "url fixada",
    "commit": "sha do commit fixado",
    "license": "identificador SPDX ou nome",
    "license_url": "url da licenca conferida"
  },
  "capabilities": { "nome-capacidade": "blocked" | "fixture" | "verified" },
  "limits": ["limitacao explicita"]
}
```

Regras: `id` nunca muda depois de publicado; correção gera `version+1` em
arquivo novo ao lado do anterior ( histórico preservado). `capabilities` usa
`verified` somente com evidência na seção 2; `fixture` significa prova sintética
autoral; `blocked` exige `blocked_reason`. Nenhum perfil é apresentado como
"mais popular": a seleção é contextual (MD/SNES, SGDK/corpus Sonic).

## 2. Contrato de evidência (`EvidenceRecord`)

Toda alegação de capacidade vem com evidência registrada em
`data/rex_profiles/<kind>/<profile_id>/evidence/`:

```json
{
  "claim": "capacidade alegada",
  "rom": {
    "sha256": "hash do arquivo testado",
    "size_bytes": 123,
    "format": "raw | smd | byteswap16 | fixture",
    "normalization": [ { "step": "nome", "sha256_after": "..." } ]
  },
  "locator": { "kind": "offset-range" | "cpu-address", "offset": 0, "length": 0 },
  "bank_state": { "registradores relevantes quando o mapper tem estado" },
  "expected": {
    "tool": "ferramenta independente (nunca o codigo sob teste)",
    "version": "versao/commit da ferramenta",
    "output_sha256": "hash do resultado esperado",
    "output_len": 0,
    "pinned_before_implementation": true
  },
  "provenance": "authored-fixture" | "corpus-byor" | "external-known",
  "negatives": [ { "input": "...", "expected_error": "..." } ],
  "timestamp": "ISO-8601 ou evento deterministico equivalente"
}
```

O resultado esperado é fixado pela referência independente **antes** da
implementação sob teste; ajustar a referência para o código passar invalida a
evidência. Prova sintética nunca vira prova de jogo real (`provenance`
distingue). Negativos são obrigatórios e separados dos positivos.

## 3. Contrato de endereçamento

Funções puras de tradução, sem estado global escondido:

- `translate(cpu_address, mapper_state) -> { region: "rom", offset } |
  { region: "ram"|"io"|..., offset } |
  { error: { code: "ambiguous" | "unsupported" | "out-of-range", detail } }`.
  Header não prova o mapa sozinho; sem informação suficiente, retorna
  `ambiguous`, nunca um palpite.
- `invert(rom_offset, mapper_state) -> { aliases: [cpu_address...] }` retorna
  **todos** os aliases suportados pelo perfil no estado dado; nunca um
  endereço arbitrário. Lista vazia é resposta válida.
- `read(cpu_address, length, mapper_state, rom)` pode cruzar fronteiras de
  janela/banco e retorna `{ segments: [{ region, offset, bytes }] }`.
- Erros nunca são convertidos em offset 0; nenhum panic; validar antes de
  alocar; ROM menor que a janela mapeada é erro `out-of-range` na leitura do
  trecho faltante, não clamp silencioso.
- SSF2 (mapper com estado): escritas nos registradores do cartucho mudam
  traduções seguintes; o `mapper_state` faz parte da identidade da observação.
  O perfil não trata o arquivo como tendo um único estado de bancos.
- Endereçamento SNES (LoROM/HiROM/ExHiROM) é **apenas** mapa de memória: não
  implica suporte de codecs SNES nem compilação de lógica recuperada. Esses
  estados são independentes e registrados separadamente na matriz.

## 4. Contrato de codec

- `decode(stream, limits) -> { data, bytes_consumed } | erro estruturado` com
  códigos `truncated`, `invalid-reference`, `overflow`, `excessive-output`,
  `work-limit`, `cancelled`. `bytes_consumed` é obrigatório e exato.
- `encode(data, limits) -> stream | { error, needs_space }`: nunca escreve
  bytes vizinhos; crescimento além do espaço disponível retorna
  `needs_space`, não truncamento silencioso.
- `limits` explícitos: memória máxima, trabalho máximo (operações), saída
  máxima, e cancelamento cooperativo. Validar antes de alocar; nenhum panic,
  leitura fora do buffer ou loop sem limite.
- Variante e dicionário/contexto são declarados no manifest. LZ4W SGDK com
  dicionário externo é **dependência declarada**, não stream autônomo.
- Oráculo: implementação de referência externa fixada por commit (SGDK para
  aPLib/LZ4W; mdcomp para Nemesis/Kosinski/Enigma, após avaliação de licença).
  Aceite exige `decode(produto, encode(ref, dados)) == dados` **e**
  `decode(ref, encode(produto, dados)) == dados`, além de golden literal
  independente. Roundtrip puramente interno não é prova.
- Recompressão não precisa reproduzir bytes idênticos; no-op preserva o bloco
  original byte a byte quando o contrato promete patch sem alterações.
- Sucesso de decode não prova identificação: como o stream foi localizado e
  confirmado no ROM é registrado separadamente (seção 5). Não varrer todos os
  offsets com todos os codecs.

## 5. Contrato de recurso comprimido

- Proveniência por bloco/segmentos: cada trecho decodificado carrega sua
  origem (offset do stream, contexto do codec). É proibido fingir mapeamento
  linear entre bytes decodificados e offsets da ROM.
- Status separados e cumulativos, cada um só marcado com evidência:
  `candidate` -> `identified` -> `decoded` -> `editable` -> `reinsertable` ->
  `observed_effect`. Um recurso `decoded` não é `editable` por consequência.
- Reinserção: preserva a base; recusa estouro do espaço comprovadamente
  disponível; não expande ROM, não realoca dados, não altera ponteiros sem
  perfil testado; atualiza apenas ponteiros/checksums efetivamente conhecidos;
  o patch aplicado deve gerar o hash esperado publicitado.
- Edição com efeito observado exige controle original/no-op/modificado com
  inputs equivalentes e reabertura do projeto. Fonte reconstituída igual não
  basta.

## Estado desta versão

v1 congelada em 2026-09-24 pelo integrador da rodada. Nenhum consumidor pode
estender o contrato unilateralmente; pedidos de mudança viram v2 com diff
declarado.
