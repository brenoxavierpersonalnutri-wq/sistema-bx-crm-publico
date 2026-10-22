// /crm/configuracoes — atalhos para o que se configura no CRM (abre os editores que já existem).
import { useState } from "react";
import { Bot, ListOrdered, QrCode, Workflow, type LucideIcon } from "lucide-react";
import { ItemCartaoCRM, TituloPaginaCRM } from "@/components/crm/ui/SecaoCRM";
import { AgentesIAModal } from "@/components/crm/AgentesIAModal";
import { RoteirosEditorModal } from "@/components/crm/RoteirosEditorModal";
import { AutomacoesModal } from "@/components/crm/automacoes/AutomacoesModal";

type Modal = "agentes" | "roteiros" | "automacoes" | null;

function Opcao({ Icone, titulo, texto, onClick, to }: { Icone: LucideIcon; titulo: string; texto: string; onClick?: () => void; to?: string }) {
  return (
    <ItemCartaoCRM
      to={to}
      onClick={onClick}
      className="bg-card py-4"
      icone={<span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-secondary"><Icone className="h-5 w-5 text-primary" /></span>}
      titulo={titulo}
      subtitulo={texto}
    />
  );
}

export default function ConfiguracoesCRM() {
  const [aberto, setAberto] = useState<Modal>(null);
  const fechar = () => setAberto(null);
  return (
    <div className="px-4 py-5 md:px-8 md:py-7 space-y-5">
      <TituloPaginaCRM titulo="Configurações" descricao="Atalhos para o que se ajusta no CRM." />
      <div className="grid max-w-4xl gap-3 md:grid-cols-2">
        <Opcao Icone={Bot} titulo="Agentes de IA" texto="Quem responde cada etapa, o tom e o modo de teste." onClick={() => setAberto("agentes")} />
        <Opcao Icone={ListOrdered} titulo="Roteiros" texto="Mensagens prontas por etapa do funil." onClick={() => setAberto("roteiros")} />
        <Opcao Icone={Workflow} titulo="Automações e limites" texto="Regras, campanhas, templates e limites de envio." onClick={() => setAberto("automacoes")} />
        <Opcao Icone={QrCode} titulo="Conexões" texto="Números de WhatsApp e Instagram." to="/crm/conexoes" />
      </div>
      <AgentesIAModal isOpen={aberto === "agentes"} onClose={fechar} />
      <RoteirosEditorModal isOpen={aberto === "roteiros"} onClose={fechar} />
      <AutomacoesModal isOpen={aberto === "automacoes"} onClose={fechar} />
    </div>
  );
}
