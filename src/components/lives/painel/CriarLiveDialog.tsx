// Modal de criação: título, descrição, data/hora opcional e destinos (cartões).
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IconeDestino } from "@/components/lives/painel/IconeDestino";
import type { LiveDestino } from "@/lib/lives/api";
import { CARTOES_DESTINO, type TipoCriacao } from "@/lib/lives/painel";
import { cn } from "@/lib/utils";
import { SeletorCanalYt } from "@/components/lives/SeletorCanalYt";
import { useContasYt } from "@/lib/lives/useContasYt";

export interface DadosCriacao {
  tipo: TipoCriacao;
  titulo: string;
  descricao: string;
  quando: string; // datetime-local ou ""
  destinos: LiveDestino["tipo"][];
  /** canal do YouTube do destino automático (só live; vazio = canal padrão) */
  ytContaId?: string;
}

const TITULO: Record<TipoCriacao, { titulo: string; desc: string; padrao: string }> = {
  live: { titulo: "Criar live", desc: "Transmita ao mesmo tempo para todos os destinos escolhidos.", padrao: "Nova live" },
  gravacao: { titulo: "Criar gravação", desc: "Use o estúdio para gravar sem transmitir.", padrao: "Nova gravação" },
  webinario: { titulo: "Criar webinário", desc: "Página própria com inscrição, chat, ofertas e lembretes.", padrao: "Nova aula" },
};

export function CriarLiveDialog({ tipo, aberto, onFechar, onCriar, criando }: {
  tipo: TipoCriacao | null;
  aberto: boolean;
  onFechar: () => void;
  onCriar: (d: DadosCriacao) => void;
  criando?: boolean;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [quando, setQuando] = useState("");
  const [destinos, setDestinos] = useState<LiveDestino["tipo"][]>([]);
  const { contas, padrao } = useContasYt(aberto && tipo === "live");
  const [canal, setCanal] = useState("");
  useEffect(() => setCanal(padrao?.id ?? ""), [padrao?.id]);
  useEffect(() => {
    if (!aberto) return;
    setTitulo("");
    setDescricao("");
    setQuando("");
    setDestinos(tipo === "webinario" ? ["cloudflare"] : []);
  }, [aberto, tipo]);
  if (!tipo) return null;
  const t = TITULO[tipo];
  const alternar = (k: LiveDestino["tipo"]) => setDestinos((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.titulo}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="criar-titulo">Título</Label>
            <Input id="criar-titulo" autoFocus placeholder={t.padrao} maxLength={160} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="criar-desc">Descrição</Label>
            <Textarea id="criar-desc" rows={3} placeholder="Sobre o que é (aparece nos destinos e na página do webinário)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="criar-quando">Data e hora (opcional)</Label>
            <Input id="criar-quando" type="datetime-local" className="w-full sm:w-64" value={quando} onChange={(e) => setQuando(e.target.value)} />
            <p className="text-xs text-muted-foreground">Sem data, você entra no estúdio agora. Com data, fica em Próximas.</p>
          </div>
          {tipo === "live" && <SeletorCanalYt id="criar-canal-yt" contas={contas} valor={canal} onChange={setCanal} />}
          {tipo !== "gravacao" && (
            <div className="space-y-2">
              <Label>Destinos</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CARTOES_DESTINO.map((c) => {
                  const marcado = destinos.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-pressed={marcado}
                      onClick={() => alternar(c.key)}
                      className={cn("relative flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted", marcado && "border-primary bg-primary/5")}
                    >
                      <IconeDestino tipo={c.key} className="h-9 w-9" />
                      <span className="text-sm font-medium">{c.rotulo}</span>
                      <span className="text-[11px] leading-snug text-muted-foreground">{c.ajuda}</span>
                      {marcado && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">As chaves de transmissão você cola dentro do estúdio, na aba Destinos (ficam cifradas).</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={criando} onClick={() => onCriar({ tipo, titulo: titulo.trim() || t.padrao, descricao: descricao.trim(), quando, destinos, ytContaId: canal || undefined })}>
            {criando ? "Criando…" : quando ? "Agendar" : "Criar e abrir o estúdio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
