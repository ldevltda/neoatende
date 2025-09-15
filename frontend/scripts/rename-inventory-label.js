// frontend/scripts/rename-inventory-label.js
/**
 * Substitui todos os labels "Estoque (API)" por "Integrações (APIs Externas)"
 * em arquivos .js, .jsx, .ts, .tsx, .json, .md do diretório ../src.
 *
 * Uso:
 *   node scripts/rename-inventory-label.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "src");
const exts = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".md"]);

const FROM = "Estoque (API)";
const TO = "Integrações (APIs Externas)";

let touched = 0;
let checked = 0;

function walk(p) {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(p)) walk(path.join(p, f));
  } else {
    checked++;
    const ext = path.extname(p);
    if (!exts.has(ext)) return;
    const content = fs.readFileSync(p, "utf8");
    if (content.includes(FROM)) {
      const next = content.split(FROM).join(TO);
      fs.writeFileSync(p, next, "utf8");
      touched++;
      console.log("✓ atualizado:", path.relative(ROOT, p));
    }
  }
}

console.log("Procurando labels para renomear em:", ROOT);
walk(ROOT);
console.log(`Concluído. Arquivos verificados: ${checked}. Arquivos alterados: ${touched}.`);
