import { useState, FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const GOLD = "#c9a876";
const BG = "#0a0a0a";
const SURFACE = "#141414";
const BORDER = "#2a2a2a";
const TEXT = "#f5f5f5";
const MUTED = "#a3a3a3";

const FORMATOS = [
  "Troca de serviço (consultoria completa: treino + dieta comigo direto)",
  "Indicações remuneradas (R$ 100 a R$ 250 por aluna)",
  "Plano de carreira (valor fixo mensal)",
  "Entrar no ecossistema com marcas de suplementos e parceiras",
  "Crescimento na rede social e aprendizado",
];

function Scale({
  value,
  onChange,
  name,
  leftLabel,
  rightLabel,
}: {
  value: number | null;
  onChange: (n: number) => void;
  name: string;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={name}>
        {Array.from({ length: 11 }).map((_, i) => {
          const active = value === i;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(i)}
              className="h-10 w-10 rounded-md text-sm font-semibold transition-colors focus:outline-none focus:ring-2"
              style={{
                background: active ? GOLD : "transparent",
                color: active ? "#0a0a0a" : TEXT,
                border: `1px solid ${active ? GOLD : BORDER}`,
              }}
            >
              {i}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-xs" style={{ color: MUTED }}>
        <span>0 = {leftLabel}</span>
        <span>10 = {rightLabel}</span>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" style={{ color: TEXT }}>
        {label} {required && <span style={{ color: GOLD }}>*</span>}
      </label>
      {hint && <p className="text-xs" style={{ color: MUTED }}>{hint}</p>}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#0f0f0f",
  border: `1px solid ${BORDER}`,
  color: TEXT,
  borderRadius: 8,
};

export default function Parceria() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const refSlug = params.get("ref") || params.get("utm_content") || null;

  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    idade: "",
    cidade: "",
    whatsapp: "",
    instagram: "",
    seguidores: "",
    media_stories: "",
    media_comentarios: "",
    publico_cliente: "",
    comunidade: "",
    objetivo: "",
    motivo_interesse: "",
    retorno_financeiro: "",
    contribuicao: "",
    observacao: "",
  });
  const [redeAtivo, setRedeAtivo] = useState<number | null>(null);
  const [interesseCrescer, setInteresseCrescer] = useState<number | null>(null);
  const [querParceria, setQuerParceria] = useState<number | null>(null);
  const [formatos, setFormatos] = useState<string[]>([]);
  const [interesse, setInteresse] = useState<"sim" | "nao" | null>(null);
  // Qual campo obrigatório ficou em branco. Antes só existia um aviso genérico
  // no fim: a pessoa respondia tudo, levava erro e desistia sem saber o que faltava.
  const [faltou, setFaltou] = useState<string | null>(null);

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const toggleFormato = (f: string) =>
    setFormatos((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const pendencias: { campo: string; aviso: string }[] = [
      { campo: "rede_ativo", aviso: redeAtivo === null ? "Escolha um número de 0 a 10" : "" },
      { campo: "interesse_crescer", aviso: interesseCrescer === null ? "Escolha um número de 0 a 10" : "" },
      { campo: "formatos", aviso: formatos.length === 0 ? "Marque ao menos uma opção" : "" },
      { campo: "quer_parceria", aviso: querParceria === null ? "Escolha um número de 0 a 10" : "" },
      { campo: "interesse", aviso: interesse === null ? "Responda sim ou não" : "" },
    ].filter((x) => x.aviso);

    if (pendencias.length) {
      const primeiro = pendencias[0];
      setFaltou(primeiro.campo);
      document.getElementById(`campo-${primeiro.campo}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast({
        title: pendencias.length === 1 ? "Falta responder 1 pergunta" : `Faltam ${pendencias.length} perguntas`,
        description: "Rolei a página até a primeira. Ela está marcada em vermelho.",
        variant: "destructive",
      });
      return;
    }
    setFaltou(null);
    setSubmitting(true);
    try {
      const slug = `${(form.instagram || form.nome).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}-${Math.random().toString(36).slice(2, 7)}`;
      const qualificada = interesse === "sim";
      const notasArr: string[] = [];
      notasArr.push(`interesse=${interesse}`);
      if (refSlug) notasArr.push(`ref=${refSlug}`);
      const { error } = await supabase.from("candidaturas_parceria").insert({
        nome: form.nome,
        idade: form.idade ? Number(form.idade) : null,
        cidade: form.cidade,
        whatsapp: form.whatsapp,
        instagram: form.instagram,
        seguidores: form.seguidores ? Number(form.seguidores) : null,
        media_stories: form.media_stories ? Number(form.media_stories) : null,
        media_comentarios: form.media_comentarios ? Number(form.media_comentarios) : null,
        publico_cliente: form.publico_cliente,
        comunidade: form.comunidade,
        objetivo: form.objetivo,
        motivo_interesse: form.motivo_interesse,
        rede_ativo: redeAtivo,
        interesse_crescer: interesseCrescer,
        retorno_financeiro: form.retorno_financeiro,
        interesse_formato: formatos,
        contribuicao: form.contribuicao,
        quer_parceria: querParceria,
        observacao: form.observacao,
        slug,
        // Responder "não" é a influencer dizendo que não quer -- não é o Breno
        // recusando. Marcar como recusada escondia a candidatura do time, que
        // perdia gente que talvez só não tivesse entendido o formato.
        status: "pendente",
        notas: notasArr.join(" · "),
      });
      if (error) throw error;
      try {
        (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq?.("track", "Lead");
      } catch { /* ignore */ }
      if (qualificada) {
        const msg = encodeURIComponent("Ei Breno, estou com interesse sobre nossa parceria, podemos conversar agora?");
        window.location.href = `https://wa.me/5531970000105?text=${msg}`;
      } else {
        navigate("/parceria/obrigado");
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "Algo deu errado",
        description: "Tenta de novo ou me chama no direct.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
  };

  return (
    <div style={{ background: BG, color: TEXT, fontFamily: "Inter, system-ui, sans-serif" }} className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-10 md:py-16 space-y-8">
        <header className="text-center space-y-3">
          <p className="text-xs md:text-sm tracking-[0.2em] font-semibold" style={{ color: GOLD }}>
            BRENO XAVIER · ED FÍSICA. NUTRIÇÃO
          </p>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">Seleção de Parceria</h1>
          <p className="text-base md:text-lg" style={{ color: MUTED }}>
            Pela primeira vez tô abrindo vagas de parceria com criadoras de conteúdo. Esse formulário é a primeira etapa
            da pré seleção.
          </p>
        </header>

        <section style={cardStyle} className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">Como funciona</h2>
          <p style={{ color: MUTED }} className="text-sm leading-relaxed">
            Hoje a gente tem propostas em andamento com marcas de suplementos e outras do ramo fitness. A ideia é montar
            um ecossistema onde todo mundo sai beneficiado: você, suas seguidoras e as marcas envolvidas.
          </p>
          <p style={{ color: TEXT }} className="text-sm font-medium">Os formatos disponíveis hoje:</p>
          <ul className="space-y-3 text-sm" style={{ color: MUTED }}>
            <li className="flex gap-3">
              <span style={{ color: GOLD }}>•</span>
              <span><span style={{ color: TEXT }} className="font-medium">Troca de serviço:</span> você ganha a consultoria completa (treino + dieta comigo direto — caso já tenha um dos dois, podemos combinar apenas um serviço). Hoje tenho programas individuais de R$ 1.500 a R$ 3.000 e planos de R$ 100 a R$ 300 por mês.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: GOLD }}>•</span>
              <span><span style={{ color: TEXT }} className="font-medium">Indicação remunerada:</span> R$ 100 a R$ 250 por cada aluna que vier pelo seu perfil. Isso será combinado após validação dessa parceria.</span>
            </li>
            <li className="flex gap-3">
              <span style={{ color: GOLD }}>•</span>
              <span><span style={{ color: TEXT }} className="font-medium">Plano de carreira:</span> parceiras com bom resultado passam pra valor fixo mensal, dentro do ecossistema com as marcas.</span>
            </li>
          </ul>
        </section>

        <form onSubmit={onSubmit} className="space-y-6">
          {/* BLOCO 1 */}
          <fieldset style={cardStyle} className="p-6 space-y-5">
            <legend className="text-lg font-semibold px-2 -ml-2">Sobre você</legend>
            <Field label="Nome completo" required>
              <input required value={form.nome} onChange={upd("nome")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Idade" required>
              <input required type="number" inputMode="numeric" value={form.idade} onChange={upd("idade")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Cidade e Estado" required>
              <input required value={form.cidade} onChange={upd("cidade")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="WhatsApp" required>
              <input required type="tel" value={form.whatsapp} onChange={upd("whatsapp")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
          </fieldset>

          {/* BLOCO 2 */}
          <fieldset style={cardStyle} className="p-6 space-y-5">
            <legend className="text-lg font-semibold px-2 -ml-2">Seu Instagram</legend>
            <Field label="@ do Instagram" required>
              <input required value={form.instagram} onChange={upd("instagram")} placeholder="@seuuser" className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Quantos seguidores você tem hoje?" required>
              <input required type="number" inputMode="numeric" value={form.seguidores} onChange={upd("seguidores")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Média de visualizações nos Stories" hint="Faça a média das últimas 5 publicações" required>
              <input required type="number" inputMode="numeric" value={form.media_stories} onChange={upd("media_stories")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Média de comentários por post no feed" required>
              <input required type="number" inputMode="numeric" value={form.media_comentarios} onChange={upd("media_comentarios")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Quantas seguidoras você acredita que se encaixam no perfil de cliente potencial?" hint="Mulheres 24 a 45 buscando corpo definido / consultoria fitness" required>
              <input required value={form.publico_cliente} onChange={upd("publico_cliente")} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Você já tem alguma comunidade fechada?" hint="Grupo de WhatsApp, lista VIP, close friends, etc. Se sim, conta um pouco." required>
              <textarea required value={form.comunidade} onChange={upd("comunidade")} rows={3} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
          </fieldset>

          {/* BLOCO 3 */}
          <fieldset style={cardStyle} className="p-6 space-y-5">
            <legend className="text-lg font-semibold px-2 -ml-2">Seu objetivo e visão</legend>
            <Field label="Qual seu objetivo com seu corpo hoje?" required>
              <textarea required value={form.objetivo} onChange={upd("objetivo")} rows={3} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <Field label="Por que essa parceria te interessou?" required>
              <textarea required value={form.motivo_interesse} onChange={upd("motivo_interesse")} rows={3} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <div id="campo-rede_ativo">
              <Field label="O quanto você enxerga sua rede social como um ativo profissional hoje?" required>
                <Scale name="rede_ativo" value={redeAtivo} onChange={(v) => { setRedeAtivo(v); setFaltou(null); }} leftLabel="só uso por hobby" rightLabel="é minha principal fonte de renda" />
                {faltou === "rede_ativo" && (
                  <p className="text-sm font-semibold mt-1" style={{ color: "#dc2626" }}>Escolha um número de 0 a 10</p>
                )}
              </Field>
            </div>
            <div id="campo-interesse_crescer">
              <Field label="O quanto você tem interesse em crescer na rede social?" required>
                <Scale name="interesse_crescer" value={interesseCrescer} onChange={(v) => { setInteresseCrescer(v); setFaltou(null); }} leftLabel="nenhum" rightLabel="é minha prioridade" />
                {faltou === "interesse_crescer" && (
                  <p className="text-sm font-semibold mt-1" style={{ color: "#dc2626" }}>Escolha um número de 0 a 10</p>
                )}
              </Field>
            </div>
            <Field label="Hoje você tem retorno financeiro do seu Instagram?" hint="Faturamento aproximado, tipo de receita (vendas, parcerias, divulgações)" required>
              <textarea required value={form.retorno_financeiro} onChange={upd("retorno_financeiro")} rows={3} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
          </fieldset>

          {/* BLOCO 4 */}
          <fieldset style={cardStyle} className="p-6 space-y-5">
            <legend className="text-lg font-semibold px-2 -ml-2">Sobre a parceria</legend>
            <div
              className="p-3 text-sm rounded-md"
              style={{
                background: "rgba(201,168,118,0.08)",
                borderLeft: `3px solid ${GOLD}`,
                color: TEXT,
              }}
            >
              Nas opções abaixo você pode marcar mais de uma alternativa.
            </div>
            <div id="campo-formatos">
            <Field label="O que é MAIS interessante pra você nessa parceria?" required>
              <div className="space-y-2">
                {FORMATOS.map((f) => {
                  const checked = formatos.includes(f);
                  return (
                    <label key={f} className="flex items-start gap-3 cursor-pointer p-3 rounded-md transition-colors" style={{ border: `1px solid ${checked ? GOLD : BORDER}`, background: checked ? "rgba(201,168,118,0.06)" : "transparent" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleFormato(f)} className="mt-0.5 h-4 w-4 accent-current" style={{ accentColor: GOLD }} />
                      <span className="text-sm" style={{ color: TEXT }}>{f}</span>
                    </label>
                  );
                })}
              </div>
              {faltou === "formatos" && (
                <p className="text-sm font-semibold mt-1" style={{ color: "#dc2626" }}>Marque ao menos uma opção</p>
              )}
            </Field>
            </div>
            <Field label="O que você está disposta (ou o que normalmente entrega) numa parceria?" hint="Frequência de stories, posts, formato de divulgação, etc." required>
              <textarea required value={form.contribuicao} onChange={upd("contribuicao")} rows={3} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <div id="campo-quer_parceria">
              <Field label="De 0 a 10, o quanto você QUER que essa parceria aconteça?" required>
                <Scale name="quer_parceria" value={querParceria} onChange={(v) => { setQuerParceria(v); setFaltou(null); }} leftLabel="pouco" rightLabel="quero MUITO" />
                {faltou === "quer_parceria" && (
                  <p className="text-sm font-semibold mt-1" style={{ color: "#dc2626" }}>Escolha um número de 0 a 10</p>
                )}
              </Field>
            </div>
            <Field label="Algo a mais que eu precise saber sobre você?">
              <textarea value={form.observacao} onChange={upd("observacao")} rows={3} className="w-full px-3 py-2.5" style={inputStyle} />
            </Field>
            <div id="campo-interesse">
            <Field label="Você tem interesse em seguir com essa parceria?" hint="Sua resposta não descarta a candidatura — o Breno olha todas." required>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: "sim" as const, label: "Sim, quero seguir" },
                  { v: "nao" as const, label: "Não tenho interesse" },
                ].map((opt) => {
                  const active = interesse === opt.v;
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => { setInteresse(opt.v); setFaltou(null); }}
                      className="py-3 px-3 rounded-md text-sm font-semibold transition-colors"
                      style={{
                        background: active ? GOLD : "transparent",
                        color: active ? "#0a0a0a" : TEXT,
                        border: `1px solid ${active ? GOLD : BORDER}`,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {faltou === "interesse" && (
                <p className="text-sm font-semibold mt-1" style={{ color: "#dc2626" }}>Responda sim ou não</p>
              )}
            </Field>
            </div>
          </fieldset>

          <div className="flex flex-col items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full max-w-[320px] py-3.5 rounded-md text-sm font-bold tracking-wide transition-opacity disabled:opacity-60"
              style={{ background: GOLD, color: "#0a0a0a" }}
            >
              {submitting ? "ENVIANDO..." : "ENVIAR CANDIDATURA"}
            </button>
            <p className="text-xs text-center max-w-md" style={{ color: MUTED }}>
              As vagas são limitadas. As selecionadas serão chamadas pro grupo fechado em até 48h.
            </p>
          </div>
        </form>

        <footer className="text-center text-xs pt-6" style={{ color: MUTED }}>
          @brenoxavieer_ · 31 9 7000-0106 · www.brenoxavier.com.br
        </footer>
      </main>
    </div>
  );
}
