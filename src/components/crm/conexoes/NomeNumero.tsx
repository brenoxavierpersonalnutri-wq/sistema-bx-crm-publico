// Nome (rótulo) do número do WhatsApp em /crm/conexoes: edição inline no cartão e campo no modal do QR.
// Só o `apelido` muda; a sessão do OpenWA continua a mesma. Quem salva é o pai (onSalvar), que lança Error.
import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NOME_NUMERO_MAX, normalizarNomeNumero } from "@/lib/crm/renomearNumero";

type Salvar = (nome: string) => Promise<void>;
type Validar = (nome: string) => string | null;

function useEdicaoNome(atual: string, validar: Validar, onSalvar: Salvar) {
  const [valor, setValor] = useState(atual);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(atual); setErro(null); }, [atual]);
  const mudou = normalizarNomeNumero(valor) !== normalizarNomeNumero(atual);

  const salvar = async (): Promise<boolean> => {
    if (!mudou) return true;
    const e = validar(valor);
    if (e) { setErro(e); return false; }
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(normalizarNomeNumero(valor));
      return true;
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não consegui salvar o nome.");
      return false;
    } finally {
      setSalvando(false);
    }
  };
  const mudar = (v: string) => { setValor(v); if (erro) setErro(null); };
  return { valor, mudar, setValor, erro, setErro, salvando, mudou, salvar };
}

/** Nome do cartão com lápis: clica, edita, Enter/Salvar grava, Esc/Cancelar volta. */
export function NomeEditavel({ nome, podeEditar, validar, onSalvar }: {
  nome: string;
  podeEditar: boolean;
  validar: Validar;
  onSalvar: Salvar;
}) {
  const [editando, setEditando] = useState(false);
  const ed = useEdicaoNome(nome, validar, onSalvar);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editando) ref.current?.select(); }, [editando]);

  const cancelar = () => { ed.setValor(nome); ed.setErro(null); setEditando(false); };
  const salvar = async () => { if (await ed.salvar()) setEditando(false); };

  if (!editando) {
    return (
      <span className="flex items-center gap-1 min-w-0">
        <span className="truncate" data-testid="nome-numero">{nome}</span>
        {podeEditar && (
          <Button
            type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground"
            aria-label={`Editar nome de ${nome}`} title="Editar nome" onClick={() => setEditando(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1 min-w-0 w-full">
      <span className="flex items-center gap-1">
        <Input
          ref={ref}
          value={ed.valor}
          maxLength={NOME_NUMERO_MAX + 10}
          aria-label="Nome do número"
          aria-invalid={!!ed.erro}
          className="h-7 text-sm"
          disabled={ed.salvando}
          onChange={(e) => ed.mudar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void salvar(); }
            if (e.key === "Escape") { e.preventDefault(); cancelar(); }
          }}
        />
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-emerald-600" aria-label="Salvar nome" onClick={() => void salvar()} disabled={ed.salvando}>
          {ed.salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Cancelar edição do nome" onClick={cancelar} disabled={ed.salvando}>
          <X className="h-4 w-4" />
        </Button>
      </span>
      {ed.erro && <span role="alert" className="text-xs font-normal text-destructive">{ed.erro}</span>}
    </span>
  );
}

/**
 * Campo "Nome deste número" do modal do QR. Pré-preenchido com o nome atual; salva no botão e, se ficou
 * algo digitado sem salvar, o modal grava sozinho quando o número conecta (`pendenteRef`).
 */
export function CampoNomeNumero({ nome, validar, onSalvar, pendenteRef }: {
  nome: string;
  validar: Validar;
  onSalvar: Salvar;
  /** O modal lê daqui o "salvar o que ficou pendente" na hora de conectar. */
  pendenteRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const id = useId();
  const ed = useEdicaoNome(nome, validar, onSalvar);
  if (pendenteRef) pendenteRef.current = ed.mudou ? ed.salvar : null;

  return (
    <div className="w-full space-y-1.5 text-left">
      <Label htmlFor={id}>Nome deste número</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={ed.valor}
          maxLength={NOME_NUMERO_MAX + 10}
          placeholder="Ex.: Comercial Fit 2"
          aria-invalid={!!ed.erro}
          disabled={ed.salvando}
          onChange={(e) => ed.mudar(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void ed.salvar(); } }}
        />
        <Button type="button" variant="outline" onClick={() => void ed.salvar()} disabled={!ed.mudou || ed.salvando}>
          {ed.salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar nome"}
        </Button>
      </div>
      {ed.erro
        ? <p role="alert" className="text-xs text-destructive">{ed.erro}</p>
        : <p className="text-xs text-muted-foreground">É o nome que o time vê em Conversas, nos selos e nos fluxos. A conexão não muda.</p>}
    </div>
  );
}
