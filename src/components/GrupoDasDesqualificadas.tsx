import { useEffect, useState } from "react";
import { Users, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfiguracao } from "@/hooks/useConfiguracao";
import {
  CHAVE_GRUPO_DESQUALIFICADAS,
  GRUPO_PADRAO,
  erroDoLinkDoGrupo,
} from "@/lib/grupoDesqualificadas";

/**
 * O grupo que recebe as desqualificadas, editável aqui junto do número do time.
 *
 * Fica nesta tela pelo mesmo motivo do outro campo: é destino de lead, e trocar
 * aqui vale na hora, sem publicar o site. Convite de grupo do WhatsApp expira e
 * é revogado — se o destino só se trocasse com deploy, voltaria a quebrar
 * calado, que foi o que aconteceu com o botão antigo.
 */
export function GrupoDasDesqualificadas() {
  const { valorSalvo, carregando, salvando, salvar, podeEditar } =
    useConfiguracao(CHAVE_GRUPO_DESQUALIFICADAS);
  const [valor, setValor] = useState("");

  useEffect(() => setValor(valorSalvo), [valorSalvo]);

  async function aoSalvar() {
    const limpo = valor.trim();
    const problema = erroDoLinkDoGrupo(limpo);
    if (problema) {
      toast.error(problema);
      return;
    }
    const erro = await salvar(limpo);
    if (erro) {
      toast.error(erro);
      return;
    }
    setValor(limpo);
    toast.success("Grupo atualizado. As próximas desqualificadas já vão para ele.");
  }

  const emUso = valorSalvo || `${GRUPO_PADRAO} (padrão do sistema)`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Users className="h-4 w-4 text-primary" />
        Grupo que recebe as desqualificadas
      </div>
      <p className="text-xs text-slate-500">
        Link de convite do grupo para onde vai quem não foi selecionada, no botão do fim do
        formulário. Cole o convite inteiro, ex: https://chat.whatsapp.com/XXXX. Quando o
        convite do grupo for trocado ou revogado, atualize aqui.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="https://chat.whatsapp.com/..."
          disabled={carregando || !podeEditar}
          className="max-w-[420px] font-mono text-xs"
        />
        <Button
          onClick={aoSalvar}
          disabled={salvando || carregando || !podeEditar || valor.trim() === valorSalvo}
        >
          <Save className="mr-2 h-4 w-4" />
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
      <p className="text-xs text-slate-500 break-all">
        Em uso: <span className="font-mono text-slate-700">{emUso}</span>
      </p>
      {!podeEditar && (
        <p className="text-xs text-amber-600">
          Só administrador altera este link. Peça para quem tem esse acesso.
        </p>
      )}
    </div>
  );
}
