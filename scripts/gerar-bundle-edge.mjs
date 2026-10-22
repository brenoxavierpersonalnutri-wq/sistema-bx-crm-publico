// Gera uma versão de ARQUIVO ÚNICO da function mobile-v1, para colar no editor
// de Edge Functions do painel do Supabase — que é o caminho de quem não usa o
// CLI. A versão modular (index.ts + lib.ts) continua sendo a fonte de verdade:
// é ela que o CLI publica e que os testes cobrem.
//
//   node scripts/gerar-bundle-edge.mjs           # gera
//   node scripts/gerar-bundle-edge.mjs --check   # falha se estiver desatualizado

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(resolve(raiz, p), "utf8");

const CABECALHO = `// ============================================================================
// mobile-v1 — versão de ARQUIVO ÚNICO (gerada, não edite à mão)
// ============================================================================
// Cole este arquivo inteiro no editor de Edge Functions do painel do Supabase.
//
// Gerado por scripts/gerar-bundle-edge.mjs a partir de:
//   supabase/functions/mobile-v1/index.ts
//   supabase/functions/mobile-v1/lib.ts
//
// Para mudar o comportamento, edite os originais e rode o script de novo.
// ============================================================================

`;

function gerar() {
  const lib = ler("supabase/functions/mobile-v1/lib.ts")
    // vira código local: sem export, o bundle não precisa de módulo
    .replace(/^export function /gm, "function ")
    .trim();

  const index = ler("supabase/functions/mobile-v1/index.ts");

  // Remove o import do lib.ts (o corpo dele entra inline logo abaixo)
  const semImport = index.replace(
    /import \{[^}]*\} from "\.\/lib\.ts";\n/,
    "",
  );
  if (semImport === index) {
    throw new Error("Não achei o import de ./lib.ts — o gerador saiu de sincronia com o index.ts");
  }

  // Insere o lib logo após o último import remoto, para os imports ficarem no topo
  const linhas = semImport.split("\n");
  let ultimoImport = -1;
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i].startsWith("import ")) ultimoImport = i;
  }
  if (ultimoImport === -1) throw new Error("Nenhum import encontrado no index.ts");

  linhas.splice(
    ultimoImport + 1,
    0,
    "",
    "// ---- inline de supabase/functions/mobile-v1/lib.ts -------------------------",
    "",
    lib,
    "",
    "// ---- fim do inline ---------------------------------------------------------",
  );

  return CABECALHO + linhas.join("\n");
}

const destino = "docs/deploy/mobile-v1-arquivo-unico.ts";
const gerado = gerar();

if (process.argv.includes("--check")) {
  let atual = "";
  try {
    atual = ler(destino);
  } catch {
    console.error(`FALTA ${destino} — rode: node scripts/gerar-bundle-edge.mjs`);
    process.exit(1);
  }
  if (atual !== gerado) {
    console.error(`${destino} está desatualizado — rode: node scripts/gerar-bundle-edge.mjs`);
    process.exit(1);
  }
  console.log(`${destino} está em dia.`);
} else {
  writeFileSync(resolve(raiz, destino), gerado);
  console.log(`Gerado ${destino} (${gerado.split("\n").length} linhas)`);
}
