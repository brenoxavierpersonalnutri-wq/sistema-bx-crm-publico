// /w/:slug — página pública de inscrição no webinário ao vivo. Guarda as UTMs da URL e,
// inscrito, leva direto para a sala pelo link mágico.
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { webinarRegister } from "@/lib/lives/api";

interface Publico { id: string; titulo: string; descricao: string | null; capa_url: string | null; sessoes: { id: string; inicia_em: string; status: string }[] }

export default function WebinarInscricao() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const [w, setW] = useState<Publico | null | undefined>(undefined);
  const [form, setForm] = useState({ nome: "", email: "", whatsapp: "", site: "" });
  const [sessao, setSessao] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const utm = useMemo(
    () => Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].map((k) => [k, params.get(k)]).filter(([, v]) => v)),
    [params],
  );

  useEffect(() => {
    (supabase as any).rpc("webinar_publico", { p_slug: slug }).then(({ data }: any) => {
      setW(data ?? null);
      if (data?.sessoes?.[0]) setSessao(data.sessoes[0].id);
      if (data?.titulo) document.title = data.titulo;
    });
  }, [slug]);

  const enviar = async () => {
    setErro(null);
    setEnviando(true);
    try {
      const r = await webinarRegister({ slug, session_id: sessao || undefined, ...form, utm });
      if (r?.sala_url) window.location.href = new URL(r.sala_url).pathname + new URL(r.sala_url).search;
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  if (w === undefined) return <div className="min-h-screen bg-[#0a0a0a]" />;
  if (w === null) return <div className="min-h-screen bg-[#0a0a0a] text-white/60 flex items-center justify-center">Webinário não encontrado.</div>;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-xl mx-auto px-4 py-10 space-y-6">
        {w.capa_url && <img src={w.capa_url} alt="" className="w-full rounded-lg" />}
        <h1 className="text-3xl font-extrabold leading-tight">{w.titulo}</h1>
        {w.descricao && <p className="text-white/70 whitespace-pre-line">{w.descricao}</p>}
        {w.sessoes.length === 0 ? (
          <p className="text-white/60">Inscrições encerradas.</p>
        ) : (
          <div className="space-y-3 bg-[#1a1a1a] border border-[#262626] rounded-lg p-5">
            {w.sessoes.length > 1 && (
              <select value={sessao} onChange={(e) => setSessao(e.target.value)} className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-3">
                {w.sessoes.map((s) => <option key={s.id} value={s.id}>{new Date(s.inicia_em).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</option>)}
              </select>
            )}
            {w.sessoes.length === 1 && (
              <p className="text-sm text-white/70">Ao vivo em {new Date(w.sessoes[0].inicia_em).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
            )}
            <input className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-3" placeholder="Seu nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            <input className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-3" type="email" placeholder="Seu melhor e-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-3" inputMode="tel" placeholder="WhatsApp com DDD (para receber o lembrete)" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            <input className="hidden" tabIndex={-1} autoComplete="off" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} aria-hidden />
            {erro && <p className="text-sm text-red-400">{erro}</p>}
            <button type="button" disabled={enviando} onClick={enviar} className="w-full py-4 rounded-lg font-extrabold uppercase bg-[#00ff00] text-black disabled:opacity-50">
              {enviando ? "Inscrevendo…" : "Quero participar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
