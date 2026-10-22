import { describe, it, expect } from "vitest";
import {
    deveRecarregarTudo,
    faseDaEspera,
    MS_ATE_EXPLICAR,
    MS_ATE_O_GIRO,
} from "@/lib/esperaDeAcesso";

describe("faseDaEspera", () => {
    it("fica quieta no carregamento rápido, pra tela não piscar", () => {
        expect(faseDaEspera(0)).toBe("quieto");
        expect(faseDaEspera(MS_ATE_O_GIRO - 1)).toBe("quieto");
    });

    it("gira quando a espera passa a ser percebida", () => {
        expect(faseDaEspera(MS_ATE_O_GIRO)).toBe("girando");
        expect(faseDaEspera(MS_ATE_EXPLICAR - 1)).toBe("girando");
    });

    it("se explica antes de a pessoa desistir", () => {
        expect(faseDaEspera(MS_ATE_EXPLICAR)).toBe("explicando");
        expect(faseDaEspera(60_000)).toBe("explicando");
    });

    it("explica bem antes do limite de tempo da consulta, não depois", () => {
        // O limite do perfil é 15s. Avisar só no fim não serve: a mensagem
        // precisa chegar enquanto a pessoa ainda está olhando pra tela.
        expect(MS_ATE_EXPLICAR).toBeLessThan(15_000);
    });
});

describe("deveRecarregarTudo", () => {
    const USUARIO = "abc-123";

    it("recarrega quando o evento não tem usuário: é hora de ir pro login", () => {
        expect(deveRecarregarTudo("SIGNED_OUT", null, USUARIO)).toBe(true);
        expect(deveRecarregarTudo("INITIAL_SESSION", undefined, USUARIO)).toBe(true);
    });

    it("recarrega ao sair e ao mudar os dados do usuário", () => {
        expect(deveRecarregarTudo("SIGNED_OUT", USUARIO, USUARIO)).toBe(true);
        expect(deveRecarregarTudo("USER_UPDATED", USUARIO, USUARIO)).toBe(true);
    });

    it("recarrega quando entra outro usuário", () => {
        expect(deveRecarregarTudo("SIGNED_IN", "outro-456", USUARIO)).toBe(true);
    });

    it("recarrega na primeira vez, quando ninguém está sendo tratado", () => {
        expect(deveRecarregarTudo("INITIAL_SESSION", USUARIO, null)).toBe(true);
    });

    it("NÃO recarrega em evento repetido do usuário que já está sendo tratado", () => {
        // Este é o caso que travava a entrada. Com a sessão perto de expirar o
        // Supabase revalida o token de novo e de novo; cada evento refazia a
        // carga e devolvia a tela pro branco, então o giro nunca terminava.
        for (const evento of ["TOKEN_REFRESHED", "SIGNED_IN", "INITIAL_SESSION"]) {
            expect(deveRecarregarTudo(evento, USUARIO, USUARIO)).toBe(false);
        }
    });

    it("não troca a tela de erro por um giro quando o evento se repete", () => {
        // A tela de "Falha ao validar seu acesso" tem o botão de tentar de
        // novo. Substituí-la por um giro tira da pessoa a única saída que ela
        // tinha — e o botão continua funcionando porque o retry chama o
        // caminho completo direto, sem passar por esta regra.
        expect(deveRecarregarTudo("TOKEN_REFRESHED", USUARIO, USUARIO)).toBe(false);
    });
});
