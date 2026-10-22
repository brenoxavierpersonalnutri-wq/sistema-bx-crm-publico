// Aba "Número de telefone" do modal Conectar (/crm/conexoes): a pessoa digita o número, o CRM pede ao
// OpenWA (whatsapp-qr {acao:"codigo"}) o código de 8 caracteres e mostra grande, com copiar e validade.
// Fechar ao conectar é do modal pai (nesta aba o pai só lê o status, sem buscar QR).
// 20/10/2026: o código é amarrado ao número exato da conta, e no whatsapp-web.js ele morre cedo (a página do
// OpenWA continua em modo QR). Por isso: mostra o número que vai ao WhatsApp (DDD 31+ sem o 9), um pedido por
// vez (trava em ref, não em estado), validade curta e instrução do que fazer quando o celular recusa.
import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  exibirTelefone, formatarCodigo, formatarRestante, mascararLocal, normalizarDdi, normalizarLocal, separarTelefoneBR,
  telefoneCompleto, telefoneWhatsapp,
} from "@/lib/crm/codigoPareamento";
import { pedirCodigoPadrao, VALIDADE_PADRAO_S, type PedirCodigo } from "@/lib/crm/pedirCodigoPareamento";

export function PainelCodigo({ sessao, telefoneSugerido, pedirCodigo = pedirCodigoPadrao }: {
  sessao: string;
  telefoneSugerido?: string | null;
  pedirCodigo?: PedirCodigo;
}) {
  const idDdi = useId();
  const idLocal = useId();
  const inicial = separarTelefoneBR(telefoneSugerido);
  const [ddi, setDdi] = useState(inicial.ddi);
  const [local, setLocal] = useState(inicial.local);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [expiraEm, setExpiraEm] = useState(0);
  const [agora, setAgora] = useState(() => Date.now());
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [telefoneUsado, setTelefoneUsado] = useState<string | null>(null);
  // trava síncrona: dois cliques/Enter no mesmo tick passariam pelo `gerando` (estado ainda não renderizado),
  // e cada pedido novo invalida o código anterior no WhatsApp
  const emVoo = useRef(false);

  const telefone = telefoneCompleto(ddi, local);
  const paraWhatsapp = telefone ? telefoneWhatsapp(telefone) : null;
  const restante = Math.ceil((expiraEm - agora) / 1000);
  const expirou = !!codigo && restante <= 0;

  useEffect(() => {
    if (!codigo) return;
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [codigo]);

  const gerar = async () => {
    if (emVoo.current) return; // Enter duplo / clique duplo não dispara dois pedidos
    if (!telefone) { setErro("Confira o número: DDD + número, só dígitos."); return; }
    emVoo.current = true;
    setGerando(true);
    setErro(null);
    setCopiado(false);
    try {
      // já manda no formato da conta (não depende da versão publicada da função)
      const r = await pedirCodigo(sessao, telefoneWhatsapp(telefone));
      const c = typeof r.corpo.codigo === "string" ? r.corpo.codigo : null;
      if (r.ok && c) {
        // teto de 60 s mesmo se uma função antiga disser 180
        const validade = Math.min(typeof r.corpo.validadeSegundos === "number" ? r.corpo.validadeSegundos : VALIDADE_PADRAO_S, VALIDADE_PADRAO_S);
        const t = Date.now();
        setTelefoneUsado(typeof r.corpo.telefone === "string" ? r.corpo.telefone : telefoneWhatsapp(telefone));
        setCodigo(c);
        setAgora(t);
        setExpiraEm(t + validade * 1000);
      } else if (r.ok && r.corpo.connected === true) {
        setErro("Este número já está conectado.");
      } else {
        setErro(typeof r.corpo.error === "string" ? r.corpo.error : "Não consegui gerar o código agora.");
      }
    } catch (e) {
      setErro(e instanceof Error && e.name !== "AbortError" ? e.message : "O servidor demorou demais. Tente de novo.");
    } finally {
      emVoo.current = false;
      setGerando(false);
    }
  };

  const copiar = async () => {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("Não consegui copiar: digite o código no celular.");
    }
  };

  const trocarNumero = () => { setCodigo(null); setTelefoneUsado(null); setErro(null); setCopiado(false); };

  if (codigo) {
    return (
      <div className="flex flex-col items-center gap-4 w-full" data-testid="painel-codigo">
        <p className="text-sm text-muted-foreground text-center" data-testid="numero-do-codigo">
          Código para <span className="font-medium text-foreground">{exibirTelefone(telefoneUsado ?? telefone ?? "")}</span>.
          Tem que ser o número do celular onde você vai digitar.
        </p>
        <div
          className={`font-mono text-4xl sm:text-5xl font-bold tracking-[0.2em] rounded-xl border bg-muted/40 px-6 py-5 select-all ${expirou ? "opacity-40 line-through" : ""}`}
          data-testid="codigo-grande"
          dir="ltr"
          aria-live="polite"
        >
          {formatarCodigo(codigo)}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={copiar} disabled={expirou}>
            {copiado ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
          <Button variant="outline" size="sm" onClick={gerar} disabled={gerando}>
            {gerando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            Gerar outro
          </Button>
          <Button variant="ghost" size="sm" onClick={trocarNumero} disabled={gerando}>Trocar número</Button>
        </div>
        <p className={`text-xs ${expirou ? "text-destructive" : "text-muted-foreground"}`} data-testid="validade">
          {expirou ? "Este código expirou. Gere outro." : `Digite agora: vale por no máximo ${formatarRestante(restante)}`}
        </p>
        <p className="text-xs text-muted-foreground text-center max-w-sm" data-testid="se-recusar">
          Se o celular disser "Não foi possível conectar o dispositivo", toque em Gerar outro e digite o código novo
          logo em seguida (o anterior deixa de valer). Se falhar de novo, use a aba QR code.
        </p>
        {erro && <p className="text-sm text-destructive text-center max-w-sm">{erro}</p>}
        <ol className="text-sm text-muted-foreground text-left list-decimal pl-5 space-y-0.5 max-w-sm">
          <li>No celular deste número, abra o WhatsApp.</li>
          <li>Aparelhos conectados, Conectar aparelho.</li>
          <li>Toque em "Conectar com número de telefone" e digite o código.</li>
        </ol>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Fecha sozinho quando conectar</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 w-full max-w-sm text-left"
      onSubmit={(e) => { e.preventDefault(); void gerar(); }}
      data-testid="form-codigo"
    >
      <div className="flex gap-2 items-end">
        <div className="w-20">
          <Label htmlFor={idDdi} className="text-xs">País</Label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">+</span>
            <Input
              id={idDdi}
              inputMode="numeric"
              value={ddi}
              onChange={(e) => { const d = normalizarDdi(e.target.value); setDdi(d); setLocal((l) => normalizarLocal(d, l)); }}
              className="pl-5"
              aria-label="Código do país"
            />
          </div>
        </div>
        <div className="flex-1">
          <Label htmlFor={idLocal} className="text-xs">Número com DDD</Label>
          <Input
            id={idLocal}
            inputMode="tel"
            autoComplete="tel-national"
            placeholder={ddi === "55" ? "(31) 99999-8888" : "número"}
            value={mascararLocal(ddi, local)}
            onChange={(e) => { setLocal(normalizarLocal(ddi, e.target.value)); if (erro) setErro(null); }}
            autoFocus
          />
        </div>
      </div>
      <Button type="submit" disabled={gerando || !telefone}>
        {gerando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
        {gerando ? "Gerando código (pode levar até 1 min)..." : "Gerar código"}
      </Button>
      {paraWhatsapp && (
        <p className="text-xs text-muted-foreground" data-testid="numero-para-whatsapp">
          O código vai ser pedido para <span className="font-medium text-foreground">{exibirTelefone(paraWhatsapp)}</span>
          {paraWhatsapp !== telefone ? " (é assim que o WhatsApp registra celulares de DDD 31 em diante, sem o 9)" : ""}.
          Tem que ser o número do celular onde você vai digitar o código.
        </p>
      )}
      {erro && <p className="text-sm text-destructive" role="alert">{erro}</p>}
      <p className="text-xs text-muted-foreground">
        Use o número do celular que vai ficar conectado aqui. Não peça código para um número que já está conectado em
        outro lugar: o WhatsApp pode desconectar aquele aparelho.
      </p>
    </form>
  );
}
