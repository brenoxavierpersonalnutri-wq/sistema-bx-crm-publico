import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type Publicacao, PENDENTES, ROTULO_STATUS, ROTULO_TIPO, cancelar } from "@/lib/conteudo/publicacoes";

const COR: Record<Publicacao["status"], string> = {
  enviando: "bg-amber-100 text-amber-900",
  agendado: "bg-amber-100 text-amber-900",
  publicando: "bg-amber-100 text-amber-900",
  publicado: "bg-emerald-100 text-emerald-900",
  erro: "bg-red-100 text-red-900",
  cancelado: "bg-muted text-muted-foreground",
};

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

interface Props {
  aberto: boolean;
  onAbrir: (v: boolean) => void;
  lista: Publicacao[];
  erroLista: string | null;
  carregando: boolean;
  onRecarregar: () => void;
}

function Item({ p, onCancelar }: { p: Publicacao; onCancelar?: (p: Publicacao) => void }) {
  return (
    <li className="rounded-md border p-3 text-sm space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={COR[p.status]}>{ROTULO_STATUS[p.status]}</Badge>
        <span className="font-medium">@{p.conta_nome || "?"}</span>
        <span className="text-muted-foreground">{ROTULO_TIPO[p.tipo]}</span>
      </div>
      <p className="line-clamp-2">{p.card_texto || p.legenda || "(sem texto)"}</p>
      <p className="text-xs text-muted-foreground">
        {p.status === "publicado" && p.publicado_em ? `publicado ${quando(p.publicado_em)}` : p.agendado_para ? `${p.agora ? "enviado para" : "agendado para"} ${quando(p.agendado_para)}` : `criado ${quando(p.criado_em)}`}
        {p.perfil ? ` · ${p.perfil}` : ""}
      </p>
      {p.status === "erro" && p.erro && <p className="text-xs text-destructive">{p.erro}</p>}
      <div className="flex gap-2 pt-1">
        {p.link_post && (
          <a href={p.link_post} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline">
            Ver post <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {onCancelar && (p.status === "agendado" || p.status === "enviando") && (
          <Button variant="outline" size="sm" className="h-7" onClick={() => onCancelar(p)}>Cancelar agendamento</Button>
        )}
      </div>
    </li>
  );
}

export function AgendadosSheet({ aberto, onAbrir, lista, erroLista, carregando, onRecarregar }: Props) {
  const [alvo, setAlvo] = useState<Publicacao | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const pendentes = lista.filter((p) => PENDENTES.includes(p.status))
    .sort((a, b) => (a.agendado_para || "").localeCompare(b.agendado_para || ""));
  const historico = lista.filter((p) => !PENDENTES.includes(p.status));

  const confirmar = async () => {
    if (!alvo) return;
    setCancelando(true);
    try {
      await cancelar(alvo.id);
      toast.success("Agendamento cancelado");
      onRecarregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelando(false);
      setAlvo(null);
    }
  };

  return (
    <>
      <Sheet open={aberto} onOpenChange={onAbrir}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between pr-6">
              Instagram (Zernio)
              <Button variant="ghost" size="sm" onClick={onRecarregar} disabled={carregando}>
                {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </SheetTitle>
            <SheetDescription>Agendados e histórico do que saiu pelo board.</SheetDescription>
          </SheetHeader>
          {erroLista ? (
            <p className="mt-4 text-sm text-destructive">{erroLista}</p>
          ) : (
            <Tabs defaultValue="agendados" className="mt-4">
              <TabsList>
                <TabsTrigger value="agendados">Agendados ({pendentes.length})</TabsTrigger>
                <TabsTrigger value="historico">Histórico ({historico.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="agendados">
                {pendentes.length === 0 ? <p className="text-sm text-muted-foreground py-6">Nada agendado.</p> : (
                  <ul className="space-y-2">{pendentes.map((p) => <Item key={p.id} p={p} onCancelar={setAlvo} />)}</ul>
                )}
              </TabsContent>
              <TabsContent value="historico">
                {historico.length === 0 ? <p className="text-sm text-muted-foreground py-6">Nada ainda.</p> : (
                  <ul className="space-y-2">{historico.map((p) => <Item key={p.id} p={p} />)}</ul>
                )}
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={!!alvo} onOpenChange={(v) => { if (!v && !cancelando) setAlvo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {alvo ? `@${alvo.conta_nome || "?"} · ${quando(alvo.agendado_para)}. O post é apagado da fila da Zernio e não sai.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando}>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmar(); }} disabled={cancelando}>
              {cancelando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancelar agendamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
