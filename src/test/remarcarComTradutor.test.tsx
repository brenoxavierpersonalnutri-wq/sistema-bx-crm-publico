import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Bug de 14/10/2026 (vídeo da SDR, Android + Chrome): remarcar consulta,
// escolher a data nova, dar OK — a tela ficava branca e a página recarregava
// do topo. O Chrome estava traduzindo a página (index.html dizia lang="en").
// A tradução troca os textos por <font>; quando o React tira da tela um texto
// que o tradutor já trocou, lança NotFoundError, derruba o app inteiro e a
// recuperação de "pedaço sumido" recarregava a página porque o erro vinha de
// /assets/*.js.

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

const gravacoes = vi.hoisted(() => ({ n: 0 }));
// Objeto estável: um `user` novo a cada render faz os efeitos da tabela girarem sem fim.
const authFixo = vi.hoisted(() => ({ user: { id: "u1" }, isAdmin: true, allowedModules: [] as string[] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authFixo }));
vi.mock("@/hooks/useConsultations", () => {
    const m = () => ({ mutate: () => { gravacoes.n++; }, mutateAsync: async () => { gravacoes.n++; }, isPending: false });
    return { useUpdateConsultation: m, useCreateAlunaFromConsultation: m, useDeleteAlunaByConsultation: m, useDeleteConsultation: m, useAddConsultation: m };
});
vi.mock("@/integrations/supabase/client", () => {
    const semana = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "09:00", end: "18:00" }]]));
    const agenda = [{ booked_slots_map: {}, capacity_per_slot: 1, slot_gap_minutes: 40, max_daily_bookings: 12, availability_weekly: semana, availability_overrides: {} }];
    const vazio: any = {};
    for (const k of ["select", "eq", "neq", "in", "is", "order", "limit", "range", "gte", "lte", "not", "or", "ilike", "insert", "update", "delete", "upsert"]) vazio[k] = () => vazio;
    vazio.maybeSingle = async () => ({ data: null, error: null });
    vazio.single = async () => ({ data: null, error: null });
    vazio.then = (ok: any, falha: any) => Promise.resolve({ data: [], error: null }).then(ok, falha);
    return { supabase: { from: () => vazio, rpc: async () => ({ data: agenda, error: null }) } };
});

const { ConsultationTable } = await import("@/components/ConsultationTable");
const { TelaComErro } = await import("@/components/TelaComErro");
const { ehErroDeChunk, recuperarDeChunkQueSumiu, reiniciarRecuperacaoParaTeste, CHAVE_RECUPERACAO } = await import("@/lib/recuperacaoDeChunk");

const alice: any = {
    id: "c1", clientName: "Alice Vitória", clientPhone: "5511999999999", date: "2026-10-14",
    startTime: "2026-10-14T11:00:00-03:00", endTime: null, status: "pendente", leadQuality: "morno", observation: "",
    attended: null, converted: null, closerObservation: "", receivedReminderMessages: null, via: "trafego", ticketValue: null,
    paymentMethod: null, gaveSignal: null, signalValue: null, signalFollowUpDate: null, signalResiduePaid: null, negotiating: null,
};

/** O que o tradutor do Chrome faz com cada texto: tira o nó e põe <font><font>texto</font></font> no lugar. */
function traduzirComoOChrome(raiz: Node) {
    const andarilho = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const textos: Text[] = [];
    while (andarilho.nextNode()) {
        const t = andarilho.currentNode as Text;
        if (t.data.trim() && t.parentNode?.nodeName !== "FONT") textos.push(t);
    }
    for (const t of textos) {
        const f = document.createElement("font");
        const g = document.createElement("font");
        g.appendChild(document.createTextNode(t.data));
        f.appendChild(g);
        t.parentNode!.replaceChild(f, t);
    }
}

async function esperar(ms = 80) {
    await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe("index.html não deixa o Chrome traduzir a página", () => {
    const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

    it("declara português e translate=no", () => {
        expect(html).toMatch(/<html[^>]*\blang="pt-BR"/);
        expect(html).toMatch(/<html[^>]*\btranslate="no"/);
        expect(html).not.toMatch(/<html[^>]*\blang="en"/);
    });

    it("tem a meta notranslate do Google", () => {
        expect(html).toMatch(/<meta\s+name="google"\s+content="notranslate"\s*\/?>/);
    });
});

describe("erro comum da tela não recarrega a página", () => {
    it("o NotFoundError do React com o tradutor, vindo do bundle, não é pedaço sumido", () => {
        const bundle = "https://equipe.brenoxavier.com.br/assets/index-Ab12Cd34.js";
        expect(ehErroDeChunk("NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.", bundle)).toBe(false);
        expect(ehErroDeChunk("Uncaught TypeError: Cannot read properties of undefined (reading 'x')", bundle)).toBe(false);
    });

    it("continua reconhecendo pedaço sumido de verdade", () => {
        expect(ehErroDeChunk("Script error.", "https://app/assets/Home-9f2a.js")).toBe(true);
        expect(ehErroDeChunk("Uncaught SyntaxError: Unexpected token '<'", "https://app/assets/Home-9f2a.js")).toBe(true);
        expect(ehErroDeChunk("Failed to fetch dynamically imported module: https://app/assets/Index-1.js")).toBe(true);
    });
});

describe("recuperação de pedaço sumido continua (agora também chamada pela rede de segurança)", () => {
    it("recarrega no import preguiçoso que falhou e não recarrega no erro do tradutor", async () => {
        sessionStorage.removeItem(CHAVE_RECUPERACAO);
        reiniciarRecuperacaoParaTeste();
        const recarregar = vi.fn();
        // A recarga agora vem depois de limpar o cache do pedaço (assíncrono).
        const limpar = vi.fn(async () => {});
        expect(recuperarDeChunkQueSumiu("Failed to fetch dynamically imported module: https://app/assets/Index-1.js", "", recarregar, limpar)).toBe(true);
        await new Promise((ok) => setTimeout(ok, 0));
        expect(recarregar).toHaveBeenCalledTimes(1);
        expect(recuperarDeChunkQueSumiu("The node to be removed is not a child of this node.", "https://app/assets/index-1.js", recarregar, limpar)).toBe(false);
        await new Promise((ok) => setTimeout(ok, 0));
        expect(recarregar).toHaveBeenCalledTimes(1);
        sessionStorage.removeItem(CHAVE_RECUPERACAO);
        reiniciarRecuperacaoParaTeste();
    });
});

describe("remarcar consulta com o tradutor do Chrome ligado", { timeout: 30_000 }, () => {
    function montar() {
        const qc = new QueryClient();
        return render(
            <QueryClientProvider client={qc}>
                <TelaComErro chave="/vendas">
                    <ConsultationTable consultations={[alice]} />
                </TelaComErro>
            </QueryClientProvider>,
        );
    }

    it("trocar a data não grava nada: só o Salvar grava", async () => {
        gravacoes.n = 0;
        const r = montar();
        fireEvent.click(document.querySelector("svg.lucide-clock")!.closest("button")!);
        await esperar();
        const data = document.querySelector('input[type="date"]') as HTMLInputElement;
        expect(data.value).toBe("2026-10-14");
        fireEvent.change(data, { target: { value: "2026-10-15" } });
        await esperar();
        expect(gravacoes.n).toBe(0);
        expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-10-15");
        fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
        expect(gravacoes.n).toBe(1);
        r.unmount();
    });

    it("quando o tradutor quebra a tela: aviso visível com Recarregar, sem derrubar o app", async () => {
        const silenciar = vi.spyOn(console, "error").mockImplementation(() => {});
        montar();
        fireEvent.click(document.querySelector("svg.lucide-clock")!.closest("button")!);
        await esperar();
        traduzirComoOChrome(document.body);
        fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-10-15" } });
        await esperar();
        traduzirComoOChrome(document.body);
        // Fechar o popover (o que o Android fez depois do OK) tira da tela o
        // "11:00" que o tradutor trocou — é aqui que o React lança NotFoundError.
        await act(async () => {
            fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
            await new Promise((r) => setTimeout(r, 80));
        });
        const aviso = screen.getByRole("alert");
        expect(aviso).toHaveTextContent("Esta tela teve um problema");
        expect(aviso).toHaveTextContent("Desfazer");
        expect(aviso.className).toContain("fixed");
        expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
        // Remontar empilharia tela nova sob a velha: não oferece.
        expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
        expect(silenciar.mock.calls.some((c) => String(c[1] ?? c[0]).includes("not a child of this node"))).toBe(true);
        silenciar.mockRestore();
    });
});

describe("rede de segurança das telas", () => {
    it("erro comum: aviso com 'Tentar de novo', que remonta a tela", async () => {
        const silenciar = vi.spyOn(console, "error").mockImplementation(() => {});
        let quebrar = true;
        function Tela() {
            if (quebrar) throw new TypeError("Cannot read properties of undefined (reading 'x')");
            return <p>tela ok</p>;
        }
        render(<TelaComErro chave="/x"><Tela /></TelaComErro>);
        expect(screen.getByRole("alert")).toHaveTextContent("Esta tela teve um problema");
        quebrar = false;
        fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
        expect(screen.getByText("tela ok")).toBeInTheDocument();
        silenciar.mockRestore();
    });

    it("trocar de rota limpa o erro", () => {
        const silenciar = vi.spyOn(console, "error").mockImplementation(() => {});
        function Tela({ quebra }: { quebra: boolean }) {
            if (quebra) throw new Error("boom");
            return <p>outra tela</p>;
        }
        const r = render(<TelaComErro chave="/a"><Tela quebra /></TelaComErro>);
        expect(screen.getByRole("alert")).toBeInTheDocument();
        r.rerender(<TelaComErro chave="/b"><Tela quebra={false} /></TelaComErro>);
        expect(screen.getByText("outra tela")).toBeInTheDocument();
        silenciar.mockRestore();
    });
});
