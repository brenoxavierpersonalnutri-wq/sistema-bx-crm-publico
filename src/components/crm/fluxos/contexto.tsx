// Fonte de dados + rota base das telas de fluxo (real em /crm/automacao, fictícia em /dev/automacao-v2).
import { createContext, useContext, type ReactNode } from "react";
import { fonteSupabase, type FonteFluxos } from "@/lib/crm/fluxosConstrutor";

interface Ctx { fonte: FonteFluxos; base: string }
const Contexto = createContext<Ctx>({ fonte: fonteSupabase, base: "/crm/automacao" });

export function ProvedorFluxos({ fonte, base, children }: Ctx & { children: ReactNode }) {
  return <Contexto.Provider value={{ fonte, base }}>{children}</Contexto.Provider>;
}

export const useFluxos = () => useContext(Contexto);
