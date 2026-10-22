import { useEffect, useState } from "react";
import { Phone, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfiguracao } from "@/hooks/useConfiguracao";
import {
  CHAVE_WHATSAPP_DO_TIME,
  WHATSAPP_DO_TIME_PADRAO,
  erroDoNumero,
  soDigitos,
} from "@/lib/destinoDasLeads";

/**
 * O WhatsApp que recebe as leads qualificadas, editável aqui na agenda.
 *
 * Fica junto da disponibilidade porque é a mesma configuração do atendimento:
 * o horário que ela marca e o número que recebe ela. Trocar aqui vale na hora,
 * sem publicar o site — as telas públicas leem este valor a cada carregamento.
 *
 * A desqualificada tem o campo dela logo abaixo, com o grupo do WhatsApp.
 */
export function DestinoDasLeads() {
  const { valorSalvo, carregando, salvando, salvar, podeEditar } =
    useConfiguracao(CHAVE_WHATSAPP_DO_TIME);
  const [valor, setValor] = useState("");

  useEffect(() => setValor(valorSalvo), [valorSalvo]);

  async function aoSalvar() {
    const digitos = soDigitos(valor);
    const problema = erroDoNumero(digitos);
    if (problema) {
      toast.error(problema);
      return;
    }
    const erro = await salvar(digitos);
    if (erro) {
      toast.error(erro);
      return;
    }
    setValor(digitos);
    toast.success("Número atualizado. As próximas leads já vão para ele.");
  }

  const emUso = valorSalvo || `${WHATSAPP_DO_TIME_PADRAO} (padrão do sistema)`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Phone className="h-4 w-4 text-primary" />
        WhatsApp que recebe as leads
      </div>
      <p className="text-xs text-slate-500">
        Número para onde a lead qualificada é mandada no fim do formulário e na confirmação
        do agendamento, já com as respostas dela na mensagem. Com DDI e DDD, ex: 5531990000104.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="5531990000104"
          disabled={carregando || !podeEditar}
          className="max-w-[240px] font-mono"
        />
        <Button
          onClick={aoSalvar}
          disabled={salvando || carregando || !podeEditar || soDigitos(valor) === valorSalvo}
        >
          <Save className="mr-2 h-4 w-4" />
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Em uso: <span className="font-mono text-slate-700">{emUso}</span>
      </p>
      {!podeEditar && (
        <p className="text-xs text-amber-600">
          Só administrador altera este número. Peça para quem tem esse acesso.
        </p>
      )}
    </div>
  );
}
