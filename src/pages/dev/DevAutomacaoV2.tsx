// /dev/automacao-v2 — lista e construtor de fluxos com DADOS FICTÍCIOS (só no build de desenvolvimento, sem login).
// Serve para screenshot e QA da tela sem tocar no banco.
import { useMemo } from "react";
import { Route, Routes } from "react-router-dom";
import { ProvedorFluxos } from "@/components/crm/fluxos/contexto";
import { ListaFluxos } from "@/components/crm/fluxos/ListaFluxos";
import { ConstrutorFluxo } from "@/components/crm/fluxos/ConstrutorFluxo";
import { criarFonteDemo } from "@/lib/crm/fluxosDemo";

export default function DevAutomacaoV2() {
  const fonte = useMemo(() => criarFonteDemo(), []);
  return (
    <ProvedorFluxos fonte={fonte} base="/dev/automacao-v2">
      <div className="min-h-screen bg-background">
        <div className="border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Rota de desenvolvimento: dados fictícios em memória, nada vai ao banco.
        </div>
        <Routes>
          <Route index element={<div className="px-3 py-4 md:px-6"><h2 className="mb-3 text-xl font-bold tracking-tight">Automação</h2><ListaFluxos /></div>} />
          <Route path="fluxos/:id" element={<ConstrutorFluxo />} />
        </Routes>
      </div>
    </ProvedorFluxos>
  );
}
