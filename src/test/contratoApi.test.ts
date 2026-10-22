import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

// Guarda contra deriva: o contrato OpenAPI, a Edge Function e o cliente
// TypeScript descrevem a mesma API. Quem mexer num sem mexer nos outros
// quebra o app nativo em produção — e aqui isso aparece antes.

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

type Spec = { paths: Record<string, Record<string, unknown>> };

function rotasDoContrato(): Set<string> {
  const spec = parse(ler("docs/mobile-api.yaml")) as Spec;
  const rotas = new Set<string>();
  for (const [caminho, ops] of Object.entries(spec.paths)) {
    for (const metodo of Object.keys(ops)) {
      if (["get", "post", "delete", "put", "patch"].includes(metodo)) {
        rotas.add(`${metodo.toUpperCase()} ${caminho.replace(/^\//, "")}`);
      }
    }
  }
  return rotas;
}

function rotasDaFuncao(): Set<string> {
  const src = ler("supabase/functions/mobile-v1/index.ts");
  const bloco = src.match(/const ROTAS: Rota\[\] = \[(.*?)\n\];/s);
  if (!bloco) throw new Error("Não achei o array ROTAS no index.ts da função");

  const rotas = new Set<string>();
  for (const m of bloco[1].matchAll(/metodo:\s*"(\w+)",\s*caminho:\s*"([^"]+)"/g)) {
    rotas.add(`${m[1]} ${m[2]}`);
  }
  return rotas;
}

describe("contrato da API mobile", () => {
  it("todo endpoint documentado existe na Edge Function", () => {
    const orfas = [...rotasDoContrato()].filter((r) => !rotasDaFuncao().has(r));
    expect(orfas, "documentadas mas não implementadas").toEqual([]);
  });

  it("todo endpoint da Edge Function está documentado", () => {
    const naoDocumentadas = [...rotasDaFuncao()].filter((r) => !rotasDoContrato().has(r));
    expect(naoDocumentadas, "implementadas mas fora do contrato").toEqual([]);
  });

  it("o cliente TypeScript cobre todos os endpoints", () => {
    const cliente = ler("mobile-client/src/cliente.ts");
    const semMetodo = [...rotasDaFuncao()].filter((r) => !cliente.includes(`"${r.split(" ")[1]}"`));
    expect(semMetodo, "endpoints sem método no cliente").toEqual([]);
  });

  it("a API tem os endpoints que as lojas exigem", () => {
    const rotas = rotasDaFuncao();
    // Apple Review 5.1.1(v): app com criação de conta precisa permitir excluir
    expect(rotas.has("DELETE conta")).toBe(true);
    // LGPD art. 18: titular pode pedir os próprios dados
    expect(rotas.has("GET exportar")).toBe(true);
  });

  it("o arquivo único para o painel do Supabase está em dia", () => {
    // Quem publica pelo painel cola docs/deploy/mobile-v1-arquivo-unico.ts.
    // Se ele ficar para trás da function modular, o deploy sobe código velho
    // sem ninguém perceber.
    expect(() =>
      execFileSync("node", ["scripts/gerar-bundle-edge.mjs", "--check"], {
        cwd: raiz,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("o contrato declara autenticação por bearer token", () => {
    const spec = parse(ler("docs/mobile-api.yaml")) as {
      components: { securitySchemes: Record<string, { scheme?: string }> };
    };
    expect(spec.components.securitySchemes.TokenAluna.scheme).toBe("bearer");
  });
});
