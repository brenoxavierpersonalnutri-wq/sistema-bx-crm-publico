// Destinos da live: vários ao mesmo tempo (YouTube + Instagram + RTMP), cada um com o interruptor "Transmitir
// para este destino nesta live". O Ir ao vivo abre UM Egress com as URLs de todos os ligados; se um cair,
// os outros seguem e a linha dele mostra o motivo. Ao vivo, ligar/desligar soma ou tira (UpdateStream).
// A chave vai direto para a edge function (cifrada lá); a tela só vê o final dela.
// YouTube: o padrão é "Conectar conta do YouTube" (PainelYoutube, OAuth); colar chave fica em "Avançado".
// Instagram: cartão próprio (PainelInstagram), chave por live.
import { useState } from "react";
import { Trash2, Cloud, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { acaoLive } from "@/lib/lives/acoes";
import { db, SERVIDORES_RTMP, type LiveDestino, type LiveRoom } from "@/lib/lives/api";
import { PainelYoutube } from "@/components/lives/estudio/PainelYoutube";
import { PainelInstagram } from "@/components/lives/estudio/PainelInstagram";
import { detalheDestino, linkYoutube } from "@/lib/lives/youtube";
import { destinoInstagram, estadoNestaLive, resumoLigados, ROTULO_INTERRUPTOR } from "@/lib/lives/destinos";

export function PainelDestinos({ sala, destinos, recarregar }: { sala: LiveRoom; destinos: LiveDestino[]; recarregar: () => void }) {
  const [tipo, setTipo] = useState<LiveDestino["tipo"]>("youtube");
  const [servidor, setServidor] = useState(SERVIDORES_RTMP.youtube.servidor);
  const [chave, setChave] = useState("");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [avancado, setAvancado] = useState(false);

  const trocarTipo = (t: LiveDestino["tipo"]) => {
    setTipo(t);
    setServidor(SERVIDORES_RTMP[t].servidor);
  };

  const salvar = async () => {
    setSalvando(true);
    const r = await acaoLive("salvar-destino", { room_id: sala.id, tipo, nome: nome || SERVIDORES_RTMP[tipo].rotulo, rtmp_url: servidor, chave }, "Destino salvo (chave cifrada)");
    setSalvando(false);
    if (r) {
      setChave(""); setNome("");
      recarregar();
    }
  };

  const alternar = async (d: LiveDestino, ativo: boolean) => {
    if (await acaoLive("destino-ativo", { destino_id: d.id, ativo })) recarregar();
  };

  const apagar = async (d: LiveDestino) => {
    if (d.no_ar) return toast.error("Desligue o destino antes de apagar");
    const { error } = await db.from("live_destinations").delete().eq("id", d.id);
    if (error) toast.error(error.message);
    recarregar();
  };

  const criarCf = async () => {
    if (await acaoLive("criar-cf-input", { room_id: sala.id }, "Webinário próprio conectado: a página /w recebe o vídeo desta sala")) recarregar();
  };

  const aoVivo = sala.status === "ao_vivo";
  const insta = destinoInstagram(destinos);

  return (
    <div className="space-y-3">
      {destinos.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-xs font-medium">Destinos desta live</div>
          <p className="text-[11px] text-muted-foreground">
            {resumoLigados(destinos)} {aoVivo
              ? "Ao vivo: ligar ou desligar soma ou tira só aquele destino, sem parar os outros."
              : "Escolha quais ligar antes de Ir ao vivo."}
          </p>
        </div>
      )}
      {destinos.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm truncate flex items-center gap-1.5">
              {d.nome} {d.no_ar && <Badge className="bg-red-600 text-white">no ar</Badge>}
            </div>
            <div className="text-[11px] text-muted-foreground truncate" title={detalheDestino(d)}>{detalheDestino(d)}</div>
            {d.modo !== "youtube_api" && estadoNestaLive(d, aoVivo) && (
              <div className="text-[11px] text-destructive break-words">{estadoNestaLive(d, aoVivo)}</div>
            )}
            {d.tipo === "instagram" && !d.no_ar && (
              <button type="button" className="text-[11px] text-primary underline" onClick={() => trocarTipo("instagram")}>colar a chave desta live</button>
            )}
            {d.modo === "youtube_api" && d.yt_video_id && (
              <a href={linkYoutube(d.yt_video_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary underline">
                ver no YouTube <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] leading-tight text-muted-foreground max-w-[7.5rem] text-right">
              <span>{ROTULO_INTERRUPTOR}</span>
              <Switch aria-label={`${ROTULO_INTERRUPTOR}: ${d.nome}`} checked={d.ativo} onCheckedChange={(v) => alternar(d, v)} />
            </label>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => apagar(d)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      {!sala.cf_live_input_uid && (
        <Button size="sm" variant="outline" className="w-full" onClick={criarCf}><Cloud className="h-4 w-4 mr-1" />Conectar webinário próprio (Cloudflare Stream)</Button>
      )}
      {sala.cf_hls_url && (
        <p className="text-[11px] text-muted-foreground break-all">HLS: {sala.cf_hls_url} {sala.cf_conectado ? "· recebendo" : ""}</p>
      )}
      <div className="border-t pt-3 space-y-2">
        <div className="text-xs font-medium">Adicionar destino</div>
        <Select value={tipo} onValueChange={(v) => trocarTipo(v as LiveDestino["tipo"])}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["youtube", "instagram", "facebook", "custom"] as const).map((t) => (
              <SelectItem key={t} value={t}>{SERVIDORES_RTMP[t].rotulo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tipo === "youtube" && <PainelYoutube sala={sala} recarregar={recarregar} />}
        {tipo === "youtube" && (
          <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setAvancado((v) => !v)}>
            {avancado ? "Esconder a opção manual" : "Avançado: colar servidor e chave manualmente"}
          </button>
        )}
        {tipo === "instagram" && <PainelInstagram key={insta?.id ?? "novo"} sala={sala} atual={insta} recarregar={recarregar} />}
        {((tipo !== "youtube" && tipo !== "instagram") || (tipo === "youtube" && avancado)) && (
          <>
            <p className="text-[11px] text-muted-foreground">{SERVIDORES_RTMP[tipo].ajuda}</p>
            <Input className="h-8" placeholder="Nome (opcional)" value={nome} onChange={(e) => setNome(e.target.value)} />
            <Input className="h-8" placeholder="rtmp(s)://servidor" value={servidor} onChange={(e) => setServidor(e.target.value)} />
            <Input className="h-8" type="password" autoComplete="off" placeholder="Chave de transmissão" value={chave} onChange={(e) => setChave(e.target.value)} />
            <Button size="sm" className="w-full" disabled={salvando || !chave || !servidor} onClick={salvar}>Salvar destino</Button>
          </>
        )}
      </div>
    </div>
  );
}
