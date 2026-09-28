# `crates/` — bibliotecas Rust independentes

Localizacao oficial de pacotes Rust standalone: codigo que se compila, testa e
reviewa por si so, antes de qualquer ligacao com o aplicativo. O que vive aqui
NAO esta no produto ate passar pela etapa de integracao descrita abaixo.

Nao existe `Cargo.toml` de workspace na raiz do repositorio, e nao se cria um
apenas para fazer estes pacotes compilarem. Cada pacote e invocavel pelo seu
manifesto:

```sh
cargo fmt --manifest-path crates/<nome>/Cargo.toml -- --check
cargo clippy --manifest-path crates/<nome>/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/<nome>/Cargo.toml --locked
```

Os tres comandos acima sao o gate proprio de cada pacote. `npm run crates:gates`
percorre a lista registrada.

## Registro

`registry.json` e a unica fonte de verdade sobre quais pacotes existem. O gate
`npm run check:tree` le esse arquivo e reprova quando:

- `crates/` existe sem `registry.json`;
- ha diretorio de primeiro nivel em `crates/` que nao esta declarado;
- um pacote declarado nao tem `Cargo.toml` no caminho declarado (um pacote
  esperado ausente reprova; nao e ignorado silenciosamente);
- ha arquivo solto em `crates/` fora de `registry.json` e deste `README.md`.

Manutencao do registro e do responsavel pela integracao, nao dos agentes que
entregam pacotes em paralelo.

## Escada de maturidade

Um pacote sobe de nivel somente com evidencia, e cada nivel e um registro
distinto na matriz de `docs/rex_profiles/ROUND_STATE.md`:

1. `biblioteca-implementada`
2. `gates-proprios-aprovados`
3. `backend-integrado`
4. `fluxo-do-usuario-comprovado`

## Integracao ao aplicativo

Depois da revisão do pacote, a integracao e uma entrega separada: dependencia por
path em `src-tauri/Cargo.toml` (isso nao exige workspace na raiz), adaptador no
backend e uma chamada real comprovada pelo backend, seguida de prova de fluxo
pela interface. Compilar nao significa integrado.

## Regras

- Testes ordinarios de um pacote nao podem depender de ROM BYOR. Comparacoes com
  ferramentas externas ficam identificadas a parte, com origem imutavel e
  SHA-256 registrados na evidencia.
- Nada de binarios versionados: `target/` fica fora do Git.
- Superficies compartilhadas (manifests e lockfiles, este registro, IPC, UI,
  harness principal e documentos de estado) sao do integrador.
