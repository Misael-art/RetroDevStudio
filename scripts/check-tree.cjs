#!/usr/bin/env node
/**
 * check-tree.cjs - Valida a arvore de diretorios conforme docs/08_TREE_ARCHITECTURE.md
 * Uso: node scripts/check-tree.cjs (execute na raiz do projeto)
 * Cross-platform (Node.js).
 *
 * A gate e propositalmente estreita: ela rejeita o que nao esta declarado.
 * `crates/` e permitido como contentor de bibliotecas Rust autonomas, mas so
 * sob registro em `crates/registry.json` — verificar a raca inteira nao e o
 * objetivo; impedir modulo nao declarado e.
 */

const fs = require("fs");
const path = require("path");

// RDS_CHECK_TREE_ROOT existe para os testes cobrirem casos que nao podem
// acontecer na raca real (diretorio estranho, registro incompleto).
const root = process.env.RDS_CHECK_TREE_ROOT
  ? path.resolve(process.env.RDS_CHECK_TREE_ROOT)
  : path.resolve(__dirname, "..");
const allowedDirs = [
  ".github",
  "crates",
  "data",
  "docs",
  "src",
  "src-tauri",
  "toolchains",
  "scripts",
];
// Agent/session metadata is intentionally outside the product tree and must
// not make the repository gate fail while other sessions are active.
const ignoreDirs = [
  ".git",
  "node_modules",
  "target",
  "dist",
  ".cursor",
  ".vscode",
  ".claude",
  ".mimosa",
  ".zcode",
];
// Unicos arquivos soltos aceitos dentro de crates/. O registro e a unica fonte
// da lista de pacotes; o README documenta o conteiner, nao substitui registro.
const cratesFilesPermitidos = ["registry.json", "README.md"];
const REGISTRO_CRATES = path.join("crates", "registry.json");

function falha(mensagens) {
  console.error("ERRO: Estrutura fora de docs/08_TREE_ARCHITECTURE.md:");
  mensagens.forEach((m) => console.error("  -", m));
  console.error("Diretorios permitidos na raiz:", allowedDirs.join(", "));
  console.error("Consulte docs/08_TREE_ARCHITECTURE.md antes de criar pastas.");
  process.exit(1);
}

if (!fs.existsSync(path.join(root, "docs", "08_TREE_ARCHITECTURE.md"))) {
  console.error("ERRO: Execute este script na raiz do repositorio RetroDev Studio (onde esta a pasta docs).");
  process.exit(1);
}

const entries = fs.readdirSync(root, { withFileTypes: true });
const invalid = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => !allowedDirs.includes(name) && !ignoreDirs.includes(name));

if (invalid.length > 0) {
  console.error("ERRO: Diretorios na raiz que nao estao em docs/08_TREE_ARCHITECTURE.md:");
  invalid.forEach((directory) => console.error("  -", directory));
  console.error("Diretorios permitidos na raiz:", allowedDirs.join(", "));
  console.error("Consulte docs/08_TREE_ARCHITECTURE.md antes de criar pastas.");
  process.exit(1);
}

const problemas = [];

// --- crates/: contentor declarado, nao caixa livre -------------------------
const cratesDir = path.join(root, "crates");
if (fs.existsSync(cratesDir)) {
  const registroPath = path.join(root, REGISTRO_CRATES);
  let pacotes = null;
  if (!fs.existsSync(registroPath)) {
    problemas.push(
      `${REGISTRO_CRATES} nao existe. crates/ so e aceito com registro explicito de pacotes.`,
    );
  } else {
    let registro;
    try {
      registro = JSON.parse(fs.readFileSync(registroPath, "utf8"));
    } catch (e) {
      problemas.push(`${REGISTRO_CRATES} nao e JSON valido: ${e.message}`);
    }
    if (registro) {
      if (registro.schema !== "rex-crate-registry/v1") {
        problemas.push(
          `${REGISTRO_CRATES}: schema esperado rex-crate-registry/v1, encontrado ${String(registro.schema)}`,
        );
      }
      if (!Array.isArray(registro.pacotes)) {
        problemas.push(`${REGISTRO_CRATES}: campo "pacotes" precisa ser uma lista.`);
      } else {
        pacotes = registro.pacotes;
      }
    }
  }

  if (pacotes) {
    const nomes = [];
    for (const pacote of pacotes) {
      const nome = pacote && pacote.nome;
      if (!nome || typeof nome !== "string") {
        problemas.push(`${REGISTRO_CRATES}: pacote sem campo "nome" (string).`);
        continue;
      }
      if (nomes.includes(nome)) {
        problemas.push(`${REGISTRO_CRATES}: pacote "${nome}" declarado duas vezes.`);
        continue;
      }
      nomes.push(nome);

      // O manifesto e sempre crates/<nome>/Cargo.toml: um registro que aponta
      // para fora de crates/ deixaria de ser um registro de modulos.
      const manifestoEsperado = path.join("crates", nome, "Cargo.toml");
      if (pacote.manifesto && path.normalize(pacote.manifesto) !== manifestoEsperado) {
        problemas.push(
          `${REGISTRO_CRATES}: pacote "${nome}" declara manifesto ${pacote.manifesto}; esperado ${manifestoEsperado}.`,
        );
      }
      if (!fs.existsSync(path.join(root, manifestoEsperado))) {
        problemas.push(
          `pacote registrado ausente: ${manifestoEsperado} nao existe. Um pacote esperado e reprovado, nao ignorado.`,
        );
      }
    }

    for (const entry of fs.readdirSync(cratesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!nomes.includes(entry.name)) {
          problemas.push(
            `crates/${entry.name} nao esta em ${REGISTRO_CRATES}. Modulo novo se registra antes de existir.`,
          );
        }
      } else if (!cratesFilesPermitidos.includes(entry.name)) {
        problemas.push(
          `crates/${entry.name} e arquivo solto: so ${cratesFilesPermitidos.join(", ")} sao aceitos nesse nivel.`,
        );
      }
    }
  }
}

if (problemas.length > 0) falha(problemas);

console.log("OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.");
process.exit(0);
