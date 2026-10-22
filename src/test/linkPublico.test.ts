import { describe, expect, it } from "vitest";
import { DOMINIO_PUBLICO, linkPublico } from "@/lib/linkPublico";

describe("linkPublico", () => {
  it("usa o domínio do Breno quando o link é gerado do preview do Lovable", () => {
    const origem = "https://id-preview--39aaf05e-53c7-4318-90c8-4f44033023d3.lovable.app";
    expect(linkPublico("/anamnese/abc123", origem)).toBe(`${DOMINIO_PUBLICO}/anamnese/abc123`);
  });

  it("usa o domínio do Breno também no lovable.app publicado", () => {
    expect(linkPublico("/feedback/mgmd", "https://equipe-breno.lovable.app")).toBe(
      `${DOMINIO_PUBLICO}/feedback/mgmd`,
    );
  });

  it("mantém o domínio dele quando já está nele", () => {
    expect(linkPublico("/aluna", DOMINIO_PUBLICO)).toBe(`${DOMINIO_PUBLICO}/aluna`);
  });

  it("segue o endereço local em desenvolvimento", () => {
    expect(linkPublico("/anamnese/x", "http://localhost:8080")).toBe("http://localhost:8080/anamnese/x");
    expect(linkPublico("/anamnese/x", "http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173/anamnese/x");
  });

  it("aceita caminho com ou sem barra na frente", () => {
    expect(linkPublico("anamnese/x", "https://qualquer.lovable.app")).toBe(`${DOMINIO_PUBLICO}/anamnese/x`);
  });

  it("não confunde um domínio que só contém 'localhost'", () => {
    expect(linkPublico("/anamnese/x", "https://localhost.exemplo.com")).toBe(
      `${DOMINIO_PUBLICO}/anamnese/x`,
    );
  });
});
