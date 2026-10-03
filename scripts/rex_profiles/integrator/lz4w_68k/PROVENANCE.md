# Proveniência do harness 68k vendorado

`lib/` contém cópias **verbatim** dos scripts de medição da agente-B, extraídas
do objeto Git do commit pinado abaixo (não do diretório de trabalho, que pode
estar sujo). São **ferramentas externas de medição**: nada daqui entra no
produto, e o produto não é alterado por elas.

Origem: `/home/misael/Projects/REX-B-CODECS-2026-09-24`
Commit: `9b2389d27c4945c2e13d4344d0ad4e341c784861`
Caminho na origem: `scripts/rex_profiles/codecs/lz4w-sgdk/variants/`
(`build-rom.sh`, `run-capture.sh`, `capture.lua`) e
`…/variants/rust_streams/` (`harness2.s`, `gen_rust_cases.py`,
`compare_rust.py`, `unpack-jar.sh`).

Receita original da agente-B (consultada, não executada daqui):
`data/rex_profiles/codec/lz4w-sgdk/evidence/rust-streams-2026-09-26/reproduce.sh`
no mesmo commit.

SHA-256 no momento do vendor (2026-09-26):

| arquivo | sha256 |
|---|---|
| `lib/build-rom.sh` | `4fa44daa60846cc5f0f95d21af56cbbf565bf833761da6f952b9a2e3fd4789c9` |
| `lib/run-capture.sh` | `29ec1781eaf5b2e72ed67d3f1c1717a9751dd6f09cb35b5538f9193f0da2eb2a` |
| `lib/capture.lua` | `600cd21ebc5d235756d49aae79ee11d774e501185e7a48b96485c2da40744f32` |
| `lib/harness2.s` | `b69f3e61b6c28483b4c806f60b1292d4fd3aabc6e59535554d3edcaab1e26a5f` |
| `lib/gen_rust_cases.py` | `0fbc608c49de7ad2847a582e629877660a490d79bf8eefacb646fa59c5270b1b` |
| `lib/compare_rust.py` | `579e2371a733be9b59d9a98ff36e48eecd0ec707681771cf70058cef0d445cf7` |
| `lib/unpack-jar.sh` | `442deabf689e738208c15d95506f526b5fe76924c1dc4004daab5d934b64d9be` |

`driver_integrator.rs` (neste diretório) é do integrador e consome o codec do
produto como cópia verbatim pinada por SHA-256 no `reproduce.sh`.

## Licenças envolvidas (medição externa, nada transplantado)

- `tools_a.s` / SGDK 2.11: MIT (dono do desempacotador 68000 usado como oráculo).
- `lz4w.jar` v1.43: ferramenta oficial do SGDK, apenas executada.
- MAME 0.289, wine: apenas executados.
- ROM BYOR: posse local somente; **nenhum byte da ROM comercial entra no git** —
  a evidência promovida é log + SHA-256 + comprimentos.
