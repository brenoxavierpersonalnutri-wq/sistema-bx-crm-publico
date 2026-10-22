// Marca do palco: cor (live_rooms.cor), logo (overlay "logo") e estilo das faixas (conteudo.tema).
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { db, type LiveOverlay, type LiveRoom } from "@/lib/lives/api";
import { alternarOverlay, criarOverlay, sincronizarCena } from "@/lib/lives/overlays";
import { TEMAS_FAIXA, type TemaFaixa } from "@/lib/lives/layout";
import { cn } from "@/lib/utils";

const PALETA = ["#10b981", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#0f172a"];

interface Props {
  sala: LiveRoom;
  overlays: LiveOverlay[];
  tema: TemaFaixa;
  onTema: (t: TemaFaixa) => void;
  recarregar: () => void;
  demo?: boolean;
}

export function PainelMarca({ sala, overlays, tema, onTema, recarregar, demo }: Props) {
  const logo = overlays.find((o) => o.tipo === "logo");
  const [url, setUrl] = useState(logo?.conteudo.url_imagem ?? "");
  useEffect(() => setUrl(logo?.conteudo.url_imagem ?? ""), [logo?.conteudo.url_imagem]);
  const cor = sala.cor ?? "#10b981";

  const salvarCor = async (c: string) => {
    if (demo) return;
    const { error } = await db.from("live_rooms").update({ cor: c }).eq("id", sala.id);
    if (error) return toast.error(error.message);
    recarregar();
    await sincronizarCena(sala.id);
  };

  const salvarLogo = async () => {
    if (demo) return;
    if (!/^https:\/\//.test(url.trim())) return toast.error("Use a URL https de uma imagem (PNG transparente fica melhor)");
    if (logo) {
      const { error } = await db.from("live_overlays").update({ conteudo: { ...logo.conteudo, url_imagem: url.trim() } }).eq("id", logo.id);
      if (error) return toast.error(error.message);
      await sincronizarCena(sala.id);
    } else if (!(await criarOverlay(sala.id, "logo", { url_imagem: url.trim() }, overlays.length, true))) return;
    else await sincronizarCena(sala.id);
    recarregar();
  };

  const trocarTema = async (t: TemaFaixa) => {
    onTema(t);
    if (demo) return;
    const faixas = overlays.filter((o) => o.tipo === "lower_third");
    await Promise.all(faixas.map((o) => db.from("live_overlays").update({ conteudo: { ...o.conteudo, tema: t } }).eq("id", o.id)));
    if (faixas.length) {
      recarregar();
      await sincronizarCena(sala.id);
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <Label>Cor da marca</Label>
        <div className="flex flex-wrap items-center gap-2">
          {PALETA.map((c) => (
            <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => salvarCor(c)} className={cn("h-7 w-7 rounded-full border-2", cor === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />
          ))}
          <input type="color" aria-label="Outra cor" value={cor} onChange={(e) => salvarCor(e.target.value)} className="h-7 w-9 cursor-pointer rounded border bg-transparent" />
        </div>
        <p className="text-[11px] text-muted-foreground">Usada nas faixas, banners e no fundo do avatar de quem está sem câmera.</p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Logo</Label>
          {logo && <Switch checked={logo.visivel} onCheckedChange={async (v) => !demo && (await alternarOverlay(sala.id, logo, v)) && recarregar()} aria-label="Mostrar logo" />}
        </div>
        {logo?.conteudo.url_imagem && <img src={logo.conteudo.url_imagem} alt="Logo atual" className="h-12 rounded border bg-muted object-contain p-1" />}
        <div className="flex gap-2">
          <Input className="h-8" placeholder="https://... (PNG transparente)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button size="sm" onClick={salvarLogo}>Salvar</Button>
        </div>
      </section>

      <section className="space-y-2">
        <Label>Estilo das faixas</Label>
        <div className="grid gap-2">
          {TEMAS_FAIXA.map((t) => (
            <button key={t.key} type="button" onClick={() => trocarTema(t.key)} className={cn("flex items-center gap-3 rounded-md border p-2 text-left text-sm", tema === t.key && "border-primary bg-primary/5")}>
              <span className="w-16 shrink-0 overflow-hidden rounded-sm">
                {t.key === "bloco" && <span className="block h-4 px-1 text-[10px] font-bold leading-4 text-white" style={{ background: cor }}>Nome</span>}
                {t.key === "escuro" && <span className="block h-4 bg-neutral-900 px-1 text-[10px] font-bold leading-4 text-white" style={{ borderLeft: `3px solid ${cor}` }}>Nome</span>}
                {t.key === "claro" && <span className="block h-4 border bg-white px-1 text-[10px] font-bold leading-4 text-neutral-900" style={{ borderLeft: `3px solid ${cor}` }}>Nome</span>}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
