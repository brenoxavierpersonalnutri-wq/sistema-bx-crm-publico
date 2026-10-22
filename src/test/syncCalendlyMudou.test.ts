import { describe, expect, it } from "vitest";
import { precisaGravar } from "../../supabase/functions/sync-calendly/mudou";

/** Como a função monta o registro antes de gravar. */
function registro(extra: Record<string, unknown> = {}) {
    return {
        calendly_event_uri: "https://api.calendly.com/eventos/abc",
        client_name: "Maria",
        client_email: "maria@exemplo.com",
        date: "2026-10-01",
        start_time: "2026-10-01T14:00:00.000000Z",
        end_time: "2026-10-01T14:30:00.000000Z",
        status: "não convertido",
        event_type_name: "Avaliação",
        calendly_status: "active",
        updated_at: new Date().toISOString(),
        ...extra,
    };
}

/** Como a mesma linha volta do Postgres. */
function gravada(extra: Record<string, unknown> = {}) {
    return {
        calendly_event_uri: "https://api.calendly.com/eventos/abc",
        client_name: "Maria",
        client_email: "maria@exemplo.com",
        client_phone: null,
        date: "2026-10-01",
        start_time: "2026-10-01T14:00:00+00:00",
        end_time: "2026-10-01T14:30:00+00:00",
        status: "não convertido",
        event_type_name: "Avaliação",
        calendly_status: "active",
        ...extra,
    };
}

describe("só grava o que mudou", () => {
    it("não regrava consulta idêntica — era o desperdício de toda rodada", () => {
        expect(precisaGravar(registro(), gravada())).toBe(false);
    });

    it("updated_at sozinho não conta como mudança", () => {
        const novo = registro({ updated_at: "2099-01-01T00:00:00.000Z" });
        expect(precisaGravar(novo, gravada())).toBe(false);
    });

    it("data em formato diferente do Postgres não conta como mudança", () => {
        // "…000000Z" contra "…+00:00" é o mesmo instante escrito de dois jeitos.
        // Comparar como texto faria a função regravar tudo, sempre.
        expect(precisaGravar(registro(), gravada())).toBe(false);
    });

    it("grava quando a consulta ainda não existe", () => {
        expect(precisaGravar(registro(), undefined)).toBe(true);
        expect(precisaGravar(registro(), null)).toBe(true);
    });

    it("grava quando o nome muda", () => {
        expect(precisaGravar(registro({ client_name: "Maria Silva" }), gravada())).toBe(true);
    });

    it("grava quando o evento é cancelado", () => {
        const novo = registro({ calendly_status: "canceled", status: "no-show" });
        expect(precisaGravar(novo, gravada())).toBe(true);
    });

    it("grava quando o horário muda de verdade", () => {
        const novo = registro({ start_time: "2026-10-01T15:00:00.000000Z" });
        expect(precisaGravar(novo, gravada())).toBe(true);
    });

    it("grava quando chega telefone que não estava lá", () => {
        expect(precisaGravar(registro({ client_phone: "31999999999" }), gravada())).toBe(true);
    });

    it("telefone igual não conta como mudança", () => {
        expect(
            precisaGravar(
                registro({ client_phone: "31999999999" }),
                gravada({ client_phone: "31999999999" })
            )
        ).toBe(false);
    });

    it("vazio e nulo são a mesma ausência", () => {
        expect(precisaGravar(registro({ client_email: "" }), gravada({ client_email: null }))).toBe(false);
    });

    it("na dúvida grava: campo que o banco não devolveu", () => {
        const semNome = gravada();
        delete (semNome as Record<string, unknown>).client_name;
        expect(precisaGravar(registro(), semNome)).toBe(true);
    });
});
