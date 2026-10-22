// "Conectar conta do YouTube" (como o StreamYard): login do Google num popup, canal com foto/nome e os campos
// da transmissão (título, descrição, privacidade). A chave nasce no Ir ao vivo, dentro do live-control.
import { useCallback, useEffect, useState } from "react";
import { Youtube, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { acaoLive } from "@/lib/lives/acoes";
import type { LiveRoom } from "@/lib/lives/api";
import {
  canalPadraoYt, conectarYoutubePopup, definirCanalPadrao, desconectarContaYt, listarContasYt, ouvirRetornoYt, PRIVACIDADES_YT,
  type ContaYoutube, type PrivacidadeYt,
} from "@/lib/lives/youtube";

export function PainelYoutube({ sala, recarregar }: { sala: LiveRoom; recarregar: () => void }) {
  const [contas, setContas] = useState<ContaYoutube[]>([]);
  const [contaId, setContaId] = useState("");
  const [conectando, setConectando] = useState(false);
  const [titulo, setTitulo] = useState(sala.titulo.slice(0, 100));
  const [descricao, setDescricao] = useState("");
  const [privacidade, setPrivacidade] = useState<PrivacidadeYt>("unlisted");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const cs = (await listarContasYt()).filter((c) => c.status === "conectado");
    setContas(cs);
    setContaId((atual) => (cs.some((c) => c.id === atual) ? atual : canalPadraoYt(cs)?.id ?? ""));
  }, []);

  useEffect(() => {
    carregar();
    // o popup pode avisar depois que a janela "fechou" (a página do Google corta o opener)
    return ouvirRetornoYt((m) => {
      carregar();
      if (m.status === "ok") toast.success(`YouTube conectado${m.motivo ? `: ${m.motivo}` : ""}`, { id: "yt-oauth" });
      else toast.error(`YouTube: ${m.motivo ?? "não conectou"}`, { id: "yt-oauth" });
    });
  }, [carregar]);

  const conectar = async () => {
    setConectando(true);
    try {
      const m = await conectarYoutubePopup();
      if (m.status === "erro" && m.motivo !== "janela fechada") toast.error(`YouTube: ${m.motivo ?? "não conectou"}`, { id: "yt-oauth" });
      else if (m.status === "ok") toast.success(`YouTube conectado${m.motivo ? `: ${m.motivo}` : ""}`, { id: "yt-oauth" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConectando(false);
      carregar();
    }
  };

  const desconectar = async (c: ContaYoutube) => {
    if (!confirm(`Desconectar o canal ${c.titulo}? Destinos ligados a ele param de funcionar até conectar de novo.`)) return;
    try {
      await desconectarContaYt(c.id);
      toast.success("Canal desconectado");
    } catch (e) {
      toast.error((e as Error).message);
    }
    carregar();
  };

  const tornarPadrao = async (c: ContaYoutube) => {
    try {
      await definirCanalPadrao(c.id);
      toast.success(`${c.titulo} é o canal padrão: lives novas entram nele sozinhas`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    carregar();
  };

  const adicionar = async () => {
    setSalvando(true);
    const r = await acaoLive("salvar-destino-youtube", { room_id: sala.id, yt_conta_id: contaId, titulo, descricao, privacidade }, "Destino YouTube adicionado: a transmissão é criada no canal quando você for ao vivo");
    setSalvando(false);
    if (r) recarregar();
  };

  const conta = contas.find((c) => c.id === contaId);

  return (
    <div className="space-y-2">
      {!contas.length && (
        <p className="text-[11px] text-muted-foreground">Entre com a conta Google do canal. A transmissão é criada no YouTube sozinha, sem copiar chave.</p>
      )}
      {contas.length > 0 && (
        <ul className="space-y-1.5" aria-label="Canais do YouTube conectados">
          {contas.map((c) => {
            const padrao = canalPadraoYt(contas)?.id === c.id;
            return (
              <li key={c.id} className="flex items-center gap-2 rounded-md border p-2">
                {c.foto_url
                  ? <img src={c.foto_url} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                  : <Youtube className="h-6 w-6 text-red-600" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{c.titulo || "Canal do YouTube"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {padrao ? "padrão: lives novas entram neste canal" : "conectado"}
                  </div>
                </div>
                {!padrao && contas.length > 1 && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => tornarPadrao(c)}>Tornar padrão</Button>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Desconectar ${c.titulo}`} onClick={() => desconectar(c)}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button size="sm" variant={conta ? "outline" : "default"} className="w-full" disabled={conectando} onClick={conectar}>
        <Youtube className="h-4 w-4 mr-1" />{conectando ? "Aguardando o login no Google…" : conta ? "Conectar outro canal" : "Conectar conta do YouTube"}
      </Button>
      {conta && (
        <div className="space-y-2 border-t pt-2">
          <p className="text-[11px] text-muted-foreground">O canal padrão já entra sozinho em toda live. Use abaixo só para pôr outro canal nesta live.</p>
          {contas.length > 1 && (
            <Select value={contaId} onValueChange={setContaId}>
              <SelectTrigger className="h-8" aria-label="Canal do destino"><SelectValue placeholder="Canal" /></SelectTrigger>
              <SelectContent>{contas.map((c) => <SelectItem key={c.id} value={c.id}>{c.titulo}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Input className="h-8" maxLength={100} placeholder="Título da transmissão" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <Textarea className="text-sm" rows={3} maxLength={5000} placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          <Select value={privacidade} onValueChange={(v) => setPrivacidade(v as PrivacidadeYt)}>
            <SelectTrigger className="h-8" aria-label="Privacidade"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIVACIDADES_YT.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="w-full" disabled={salvando || !titulo.trim()} onClick={adicionar}>Adicionar destino YouTube</Button>
        </div>
      )}
    </div>
  );
}
