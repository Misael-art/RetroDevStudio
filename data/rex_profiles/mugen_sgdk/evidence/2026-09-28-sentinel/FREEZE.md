# Congelamento do conversor antes da 2a amostra (Sentinel)

registrado_em: 2026-09-28T16:01:47-03:00
commit: 7db7c142cd15949b269e24ce851469d2d47cec7e

```
56e5351ab418744dad6c7a9422751dd73656a01b78c0be20074685caebc825a6  crates/rex-mugen/src/air.rs
4770308a43aef5f19a3be03bc123ffc159b0f0393e506c1a2ea6e8fb763fd3c5  crates/rex-mugen/src/sff.rs
e655e1767c3fcf34e4c4e420d56980cd53aca757d0607c77c5625b1d62e84fd8  crates/rex-mugen/src/palette.rs
92a72bc9242b89f0ca619eb613516d2f3add1d17ea94e41c80047911dd9d7777  crates/rex-mugen/src/plan.rs
13e06155fd4a671511f8b2df72dea196b093b8caf10b8e008df905cb498fa4fc  crates/rex-mugen/src/diag.rs
7fd2dd605c099dfc4415421247f49e10500278b07fd345a39348d04c32338d39  src-tauri/src/core/mugen_profile.rs
72973720ecf4c0ea1fe1dd155c8b0adf49931b40124889ff24a29b8e7d38b0fb  src-tauri/src/compiler/mugen_runtime.rs
```

Nota: mugen_profile.rs contem os testes; o que congela e o codigo de producao acima dos testes (funcoes convert_character_v1 e wire_behavior_v1).
Regra: se o conversor mudar por causa da Sentinel, ela passa a regressao e a alegacao de generalizacao exige nova amostra.
