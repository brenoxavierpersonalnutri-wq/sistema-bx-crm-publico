// Regras da lista "Quem tem acesso" (Área do Usuário).
//
// Quatro chaves por pessoa: Reavaliações, Conteúdo, Comercial (linhas em
// `user_modules`) e Admin (linha em `user_roles`). Quem liga e desliga:
//
//  - Qualquer admin, para as outras pessoas. Quem não é admin não altera nada.
//  - O dono do sistema (Breno) não perde acesso nenhum: a linha dele aparece
//    travada. No banco, um gatilho recusa qualquer remoção dos módulos ou do
//    admin dele, venha de quem vier (supabase/migrations/20261013200000_acesso_comercial.sql).
//  - Ninguém tira o PRÓPRIO admin por aqui (evita se trancar fora sem querer).
//    O banco também recusa.
//
// A tela é só a primeira barreira; quem garante é o banco (RLS + gatilhos).

import { AGENDA_ALUNAS_MODULE, AGENDA_CONTEUDO_MODULE } from "@/lib/agendaCamadas";
import { COMERCIAL_MODULE } from "@/lib/modules";

export type CampoAcesso = "reavaliacoes" | "conteudo" | "comercial" | "admin";

/** Módulo de `user_modules` por coluna (Admin mora em `user_roles`). */
export const MODULO_DO_CAMPO: Record<Exclude<CampoAcesso, "admin">, string> = {
  reavaliacoes: AGENDA_ALUNAS_MODULE,
  conteudo: AGENDA_CONTEUDO_MODULE,
  comercial: COMERCIAL_MODULE,
};

export interface QuemAltera {
  /** Id de quem está na tela. */
  euId: string | null | undefined;
  euAdmin: boolean;
  /** Id do dono do sistema, vindo do banco (`dono_do_sistema()`); null se ainda não se sabe. */
  donoId: string | null | undefined;
}

export interface Decisao {
  pode: boolean;
  motivo?: string;
}

/** A linha inteira da pessoa fica travada (dono do sistema). */
export function linhaTravada(alvoId: string, q: Pick<QuemAltera, "donoId">): boolean {
  return !!q.donoId && alvoId === q.donoId;
}

/** Pode mexer nesta chave desta pessoa? */
export function podeAlterarAcesso(alvoId: string, campo: CampoAcesso, q: QuemAltera): Decisao {
  if (!q.euAdmin) return { pode: false, motivo: "Só admin altera acessos." };
  if (linhaTravada(alvoId, q)) return { pode: false, motivo: "O dono do sistema não perde acesso." };
  if (campo === "admin" && !!q.euId && alvoId === q.euId) {
    return { pode: false, motivo: "Você não pode tirar o seu próprio admin." };
  }
  return { pode: true };
}
