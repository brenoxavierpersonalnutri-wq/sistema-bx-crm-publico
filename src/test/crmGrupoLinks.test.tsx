import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn() },
}));

import {
  abrirLinkCurto,
  avisoLink,
  problemaLink,
  slugLinkValido,
  urlCurta,
  urlDestinoValida,
} from "@/lib/crmGrupoLinks";
import LinkCurtoPublico from "@/pages/LinkCurtoPublico";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

describe("regras dos links curtos", () => {
  it("url curta por tipo", () => {
    expect(urlCurta("mgmd", "grupo")).toBe("equipe.brenoxavier.com.br/grupo/mgmd");
    expect(urlCurta("feedback", "link")).toBe("equipe.brenoxavier.com.br/ir/feedback");
    expect(urlCurta("elite", "grupo", true)).toBe("https://equipe.brenoxavier.com.br/grupo/elite");
  });

  it("slug e url", () => {
    expect(slugLinkValido("plataforma")).toBe(true);
    expect(slugLinkValido("MGMD")).toBe(false);
    expect(slugLinkValido("a b")).toBe(false);
    expect(slugLinkValido("")).toBe(false);
    expect(urlDestinoValida("https://chat.whatsapp.com/AbC123")).toBe(true);
    expect(urlDestinoValida("https://forms.gle/x")).toBe(true);
    expect(urlDestinoValida("http://chat.whatsapp.com/x")).toBe(false);
    expect(urlDestinoValida("javascript:alert(1)")).toBe(false);
  });

  it("ativo exige url https; grupo fora do WhatsApp só avisa", () => {
    expect(problemaLink({ tipo: "grupo", url: null, ativo: true })).toMatch(/Cole o link/);
    expect(problemaLink({ tipo: "grupo", url: "", ativo: false })).toBeNull();
    expect(problemaLink({ tipo: "link", url: "http://x.com", ativo: false })).toMatch(/https/);
    expect(problemaLink({ tipo: "grupo", url: "https://forms.gle/x", ativo: true })).toBeNull();
    expect(avisoLink({ tipo: "grupo", url: "https://forms.gle/x" })).toMatch(/convite/);
    expect(avisoLink({ tipo: "grupo", url: "https://chat.whatsapp.com/AbC" })).toBeNull();
    expect(avisoLink({ tipo: "link", url: "https://forms.gle/x" })).toBeNull();
  });
});

describe("abrirLinkCurto (RPC crm_grupo_link_abrir)", () => {
  beforeEach(() => rpc.mockReset());

  it("manda slug minúsculo e o tipo", async () => {
    rpc.mockResolvedValue({ data: "https://chat.whatsapp.com/AbC", error: null });
    expect(await abrirLinkCurto("MGMD", "grupo")).toEqual({ tipo: "ok", url: "https://chat.whatsapp.com/AbC" });
    expect(rpc).toHaveBeenCalledWith("crm_grupo_link_abrir", { p_slug: "mgmd", p_tipo: "grupo" });
  });

  it("null ou destino não-https = indisponível; slug inválido nem chama", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await abrirLinkCurto("elite", "grupo")).toEqual({ tipo: "indisponivel" });
    rpc.mockResolvedValue({ data: "javascript:alert(1)", error: null });
    expect(await abrirLinkCurto("elite", "grupo")).toEqual({ tipo: "indisponivel" });
    rpc.mockClear();
    expect(await abrirLinkCurto("../x", "link")).toEqual({ tipo: "indisponivel" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("erro do banco vira erro", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await abrirLinkCurto("mgmd", "grupo")).toEqual({ tipo: "erro", mensagem: "boom" });
  });
});

describe("página pública /grupo/:slug e /ir/:slug", () => {
  const replace = vi.fn();
  const original = window.location;
  beforeEach(() => {
    rpc.mockReset();
    replace.mockReset();
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, replace } });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  const montar = (caminho: string) =>
    render(
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/grupo/:slug" element={<LinkCurtoPublico tipo="grupo" />} />
          <Route path="/ir/:slug" element={<LinkCurtoPublico tipo="link" />} />
        </Routes>
      </MemoryRouter>,
    );

  it("mostra 'Abrindo o grupo…' e redireciona com replace + botão de reserva", async () => {
    let resolver: (v: unknown) => void = () => {};
    rpc.mockReturnValue(new Promise((r) => { resolver = r; }));
    montar("/grupo/mgmd");
    expect(screen.getByText("Abrindo o grupo…")).toBeInTheDocument();
    resolver({ data: "https://chat.whatsapp.com/AbC", error: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://chat.whatsapp.com/AbC"));
    expect(screen.getByRole("link", { name: "Entrar no grupo" })).toHaveAttribute("href", "https://chat.whatsapp.com/AbC");
    expect(rpc).toHaveBeenCalledWith("crm_grupo_link_abrir", { p_slug: "mgmd", p_tipo: "grupo" });
  });

  it("/ir/feedback usa o tipo link", async () => {
    rpc.mockResolvedValue({ data: "https://forms.gle/abc", error: null });
    montar("/ir/feedback");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://forms.gle/abc"));
    expect(rpc).toHaveBeenCalledWith("crm_grupo_link_abrir", { p_slug: "feedback", p_tipo: "link" });
  });

  it("inexistente/inativo: 'Link indisponível, fale com a consultoria'", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    montar("/grupo/naoexiste");
    expect(await screen.findByText("Link indisponível, fale com a consultoria.")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("erro: botão Tentar de novo chama de novo", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "rede" } });
    rpc.mockResolvedValueOnce({ data: "https://chat.whatsapp.com/AbC", error: null });
    montar("/grupo/elite");
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://chat.whatsapp.com/AbC"));
  });
});

describe("rotas e migration", () => {
  it("rotas públicas, sem ProtectedRoute", () => {
    const app = ler("src/App.tsx");
    const g = app.split("\n").find((l) => l.includes('path="/grupo/:slug"')) ?? "";
    const i = app.split("\n").find((l) => l.includes('path="/ir/:slug"')) ?? "";
    expect(g).toContain('<LinkCurtoPublico tipo="grupo" />');
    expect(i).toContain('<LinkCurtoPublico tipo="link" />');
    expect(g + i).not.toContain("ProtectedRoute");
  });

  it("Cloudflare serve a SPA em qualquer rota", () => {
    expect(ler("public/_redirects")).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
    expect(ler("wrangler.jsonc")).toContain('"not_found_handling": "single-page-application"');
  });

  it("migration: RLS, RPC definer só p/ anon, https, seed inativo", () => {
    const sql = ler("supabase/migrations/20261104100000_crm_grupo_links.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.crm_grupo_links FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT [^;]*crm_grupo_links TO [^;]*anon/);
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.crm_grupo_link_abrir(text, text) TO anon, authenticated");
    expect(sql).toContain("url ~ '^https://[^[:space:]]+$'");
    expect(sql).toContain("CHECK (tipo IN ('grupo', 'link'))");
    for (const s of ["mgmd", "elite", "plataforma", "feedback"]) expect(sql).toMatch(new RegExp(`\\('${s}',[^)]*NULL, false\\)`));
    expect(sql).toContain("ON CONFLICT (slug) DO NOTHING");
  });
});
