// Cartão "Instagram Live": servidor RTMPS + chave da sessão (muda a cada live). A chave vai direto pro
// live-control, que cifra (AES-GCM, LIVE_CHAVES_SEGREDO) e devolve só o final ("••••1234").
// Um destino Instagram por sala: colar a chave nova edita o mesmo destino.
import { useState } from "react";
import { Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acaoLive } from "@/lib/lives/acoes";
import type { LiveDestino, LiveRoom } from "@/lib/lives/api";
import {
  INSTAGRAM_AVISO_CHAVE, INSTAGRAM_AVISO_FORMATO, INSTAGRAM_AVISO_LIMITE, INSTAGRAM_PASSOS, validarServidorInstagram,
} from "@/lib/lives/destinos";

export function PainelInstagram({ sala, atual, recarregar }: { sala: LiveRoom; atual: LiveDestino | null; recarregar: () => void }) {
  const [servidor, setServidor] = useState(atual?.rtmp_url ?? "");
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const erroServidor = servidor ? validarServidorInstagram(servidor) : null;

  const salvar = async () => {
    setSalvando(true);
    const r = await acaoLive(
      "salvar-destino",
      { room_id: sala.id, tipo: "instagram", nome: "Instagram Live", rtmp_url: servidor.trim(), chave: chave.trim(), ...(atual ? { id: atual.id } : {}) },
      atual ? "Chave do Instagram trocada (cifrada)" : "Instagram salvo (chave cifrada)",
    );
    setSalvando(false);
    if (r) {
      setChave("");
      recarregar();
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium"><Instagram className="h-4 w-4" />Instagram Live</div>
      <ol className="list-decimal pl-4 text-[11px] text-muted-foreground space-y-0.5">
        {INSTAGRAM_PASSOS.map((p) => <li key={p}>{p}</li>)}
      </ol>
      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{INSTAGRAM_AVISO_CHAVE}</p>
      <p className="text-[11px] text-muted-foreground">{INSTAGRAM_AVISO_FORMATO} {INSTAGRAM_AVISO_LIMITE}</p>
      {atual && <p className="text-[11px] text-muted-foreground">Chave guardada: {atual.chave_final}</p>}
      <label className="block text-[11px] text-muted-foreground">
        Servidor RTMP
        <Input className="h-8 mt-0.5" placeholder="rtmps://...:443/rtmp/" value={servidor} onChange={(e) => setServidor(e.target.value)} />
      </label>
      {erroServidor && <p className="text-[11px] text-destructive">{erroServidor}</p>}
      <label className="block text-[11px] text-muted-foreground">
        Chave
        <Input className="h-8 mt-0.5" type="password" autoComplete="off" placeholder={atual ? "Cole a chave desta live" : "Chave de transmissão"} value={chave} onChange={(e) => setChave(e.target.value)} />
      </label>
      <Button size="sm" className="w-full" disabled={salvando || !chave.trim() || !!validarServidorInstagram(servidor) || !!atual?.no_ar} onClick={salvar}>
        {atual ? "Trocar a chave do Instagram" : "Salvar Instagram"}
      </Button>
      {atual?.no_ar && <p className="text-[11px] text-muted-foreground">No ar agora: desligue o interruptor do Instagram para trocar a chave.</p>}
    </div>
  );
}
