#!/usr/bin/env node
/**
 * check-tree.cjs - Valida a arvore de diretorios conforme docs/08_TREE_ARCHITECTURE.md
 * Uso: node scripts/check-tree.cjs (execute na raiz do projeto)
 * Cross-platform (Node.js).
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const allowedDirs = [".github", "data", "docs", "src", "src-tauri", "toolchains", "scripts"];
const ignoreDirs = [".git", "node_modules", "target", "dist", ".cursor", ".vscode", ".claude"];

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

console.log("OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.");
process.exit(0);
