import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import boardHtml from "@/content/board-conteudo.html?raw";
import {
  conferirMidias, localParaIsoComFuso, podePublicar, tipoDoArquivo, ultimaPorCard, type Publicacao,
} from "@/lib/conteudo/publicacoes";
import { getModuleByPath, podeAbrirRota } from "@/lib/modules";

const pub = (o: Partial<Publicacao>): Publicacao => ({
  id: "1", card_ref: "breno-fit|viral|x", perfil: "breno-fit", card_texto: "t", conta_id: "65f1c0a9e2b5af0012ab34cd",
  conta_nome: "brenoxavier", tipo: "feed", legenda: "l", midias: [], agora: false, agendado_para: null, status: "agendado",
  zernio_post_id: null, link_post: null, erro: null, criado_em: "2026-10-21T10:00:00Z", atualizado_em: "2026-10-21T10:00:00Z",
  publicado_em: null, ...o,
});

describe("conteudo: publicar no Instagram", () => {
  it("módulo conteudo libera o botão sem trancar o board para quem não tem", () => {
    expect(podePublicar(false, [])).toBe(false);
    expect(podePublicar(false, ["conteudo"])).toBe(true);
    expect(podePublicar(true, [])).toBe(true);
    expect(getModuleByPath("/conteudo")).toBeNull();
    expect(podeAbrirRota("/conteudo", false, [])).toBe(true);
  });

  it("regras de mídia iguais às do serviço", () => {
    const img = { url: "https://x/a.jpg", tipo: "image" as const };
    const vid = { url: "https://x/a.mp4", tipo: "video" as const };
    expect(conferirMidias("feed", [img])).toBeNull();
    expect(conferirMidias("feed", [vid])).toMatch(/1 imagem/);
    expect(conferirMidias("reels", [vid])).toBeNull();
    expect(conferirMidias("reels", [img])).toMatch(/1 vídeo/);
    expect(conferirMidias("carrossel", [img])).toMatch(/2 a 10/);
    expect(conferirMidias("carrossel", Array(11).fill(img))).toMatch(/10/);
    expect(conferirMidias("story", [vid])).toBeNull();
    expect(tipoDoArquivo("video/quicktime")).toBe("video");
    expect(tipoDoArquivo("application/pdf")).toBeNull();
  });

  it("datetime-local vira ISO com o fuso do navegador (o mesmo instante)", () => {
    const iso = localParaIsoComFuso("2026-10-22T09:30")!;
    expect(iso).toMatch(/^2026-10-22T09:30:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getTime()).toBe(new Date(2026, 9, 22, 9, 30).getTime());
    expect(localParaIsoComFuso("ontem")).toBeNull();
  });

  it("selo do card = publicação mais recente daquele card", () => {
    const m = ultimaPorCard([
      pub({ id: "b", status: "publicado", link_post: "https://www.instagram.com/p/B/", criado_em: "2026-10-21T12:00:00Z" }),
      pub({ id: "a", status: "erro", erro: "x", criado_em: "2026-10-21T11:00:00Z" }),
    ]);
    expect(m["breno-fit|viral|x"]).toMatchObject({ status: "publicado", link: "https://www.instagram.com/p/B/" });
  });

  it("board: só mostra o botão com permissão e pinta o selo vindo do CRM", async () => {
    const dom = new JSDOM(boardHtml, {
      runScripts: "dangerously",
      url: "https://equipe.brenoxavier.com.br/conteudo",
      // o jsdom não tem structuredClone (o navegador tem); o board usa para copiar a base
      beforeParse(win) { (win as unknown as { structuredClone: (v: unknown) => unknown }).structuredClone = (v) => JSON.parse(JSON.stringify(v)); },
    });
    const w = dom.window;
    const doc = w.document;
    const card = doc.querySelector(".card") as HTMLElement;
    expect(card.dataset.ref).toMatch(/^breno-fit\|viral\|[0-9a-z]+$/);
    expect(card.querySelector(".ig")).not.toBeNull();
    expect(doc.body.classList.contains("pode-publicar")).toBe(false);

    const enviar = (data: unknown, source: unknown = w.parent) =>
      w.dispatchEvent(new w.MessageEvent("message", { data, source: source as Window }));
    enviar({ fonte: "outro", tipo: "config", podePublicar: true });
    expect(doc.body.classList.contains("pode-publicar")).toBe(false);
    enviar({ fonte: "crm-conteudo", tipo: "config", podePublicar: true });
    expect(doc.body.classList.contains("pode-publicar")).toBe(true);

    const ref = card.dataset.ref!;
    enviar({ fonte: "crm-conteudo", tipo: "status", itens: { [ref]: { status: "publicado", link: "https://www.instagram.com/p/OK/", conta: "brenoxavier" } } });
    const selo = card.querySelector(".pub") as HTMLElement;
    expect(selo.className).toContain("publicado");
    expect(selo.textContent).toContain("Publicado · @brenoxavier");
    expect((selo.querySelector("a") as HTMLAnchorElement).href).toBe("https://www.instagram.com/p/OK/");

    enviar({ fonte: "crm-conteudo", tipo: "status", itens: { [ref]: { status: "publicado", link: "javascript:alert(1)" } } });
    expect(selo.querySelector("a")).toBeNull();
    enviar({ fonte: "crm-conteudo", tipo: "status", itens: { [ref]: { status: "erro", erro: "<img src=x onerror=alert(1)>" } } });
    expect(selo.querySelector("img")).toBeNull();
    expect(selo.textContent).toContain("<img");
    w.close();
  });
});
