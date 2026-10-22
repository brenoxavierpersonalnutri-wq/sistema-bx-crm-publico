import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** O que ela estava fazendo quando a pergunta apareceu. */
export interface ContextoTroca {
  modo: "alimento" | "refeicao";
  alimentos: string[];
  trocas: string[];
}

const CHAVE = "sub-pesquisa";
/** Depois de responder ou dispensar, a tela só volta a perguntar daqui a tanto. */
const DESCANSO_DIAS = 45;

function podePerguntar(): boolean {
  try {
    const quando = Number(localStorage.getItem(CHAVE) ?? 0);
    if (!quando) return true;
    return Date.now() - quando > DESCANSO_DIAS * 24 * 60 * 60 * 1000;
  } catch {
    // storage bloqueado: pergunta uma vez por visita, não trava a tela
    return true;
  }
}

function anota() {
  try {
    localStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    // sem storage, a pergunta volta na próxima visita — não é problema
  }
}

/**
 * A pergunta de satisfação, que só aparece depois que ela conseguiu a troca.
 * Primeiro a nota, que é um toque; as duas perguntas abertas só abrem depois,
 * pra quem quiser escrever. Responder ou dispensar tira ela do caminho por 45
 * dias.
 */
export function PesquisaTroca({ contexto }: { contexto: ContextoTroca | null }) {
  const [visivel, setVisivel] = useState(false);
  const [nota, setNota] = useState<number | null>(null);
  const [naoAchou, setNaoAchou] = useState("");
  const [sugestao, setSugestao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState("");

  // espera ela ler a troca antes de perguntar qualquer coisa
  useEffect(() => {
    if (!contexto || visivel || pronto || !podePerguntar()) return;
    const t = setTimeout(() => setVisivel(true), 4000);
    return () => clearTimeout(t);
  }, [contexto, visivel, pronto]);

  if (!visivel || !contexto) return null;

  function dispensa() {
    anota();
    setVisivel(false);
  }

  async function envia(comTexto: boolean) {
    if (nota === null) return;
    setEnviando(true);
    setErro("");
    try {
      const { error } = await supabase.from("feedback_substituicoes" as never).insert({
        nota,
        nao_achou: comTexto ? naoAchou.trim() || null : null,
        sugestao: comTexto ? sugestao.trim() || null : null,
        modo: contexto!.modo,
        alimentos: contexto!.alimentos.slice(0, 10),
        trocas: contexto!.trocas.slice(0, 10),
      } as never);
      if (error) throw error;
      anota();
      setPronto(true);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "não consegui enviar");
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <div className="sub-cartao sub-pesquisa pronta">
        <p className="sub-linha-dieta">
          <Check className="mr-2 inline h-4 w-4" />
          Obrigado. Isso vira melhoria aqui dentro.
        </p>
      </div>
    );
  }

  return (
    <div className="sub-cartao sub-pesquisa">
      <button type="button" className="sub-pesquisa-x" onClick={dispensa} aria-label="Agora não">
        <X className="h-4 w-4" />
      </button>

      <h3>De 0 a 10, o quanto essa troca te ajudou?</h3>
      <div className="sub-notas" role="group" aria-label="Nota de 0 a 10">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            className="sub-nota"
            aria-pressed={nota === n}
            onClick={() => setNota(n)}
          >
            {n}
          </button>
        ))}
      </div>

      {nota !== null && (
        <div className="sub-pesquisa-texto">
          <label htmlFor="sub-nao-achou">Procurou algum alimento e não achou?</label>
          <textarea
            id="sub-nao-achou"
            rows={2}
            value={naoAchou}
            onChange={(e) => setNaoAchou(e.target.value.slice(0, 500))}
            placeholder="Escreve o nome do que faltou"
          />

          <label htmlFor="sub-sugestao">O que tu mudaria aqui?</label>
          <textarea
            id="sub-sugestao"
            rows={2}
            value={sugestao}
            onChange={(e) => setSugestao(e.target.value.slice(0, 500))}
            placeholder="Pode ser uma frase"
          />

          {erro && <p className="sub-medida sub-aviso">{erro}. Tenta de novo em alguns segundos.</p>}

          <div className="sub-pesquisa-fim">
            <button type="button" className="sub-botao-trocar" disabled={enviando} onClick={() => envia(true)}>
              {enviando ? "Enviando..." : "Enviar"}
            </button>
            <button type="button" className="sub-voltar" disabled={enviando} onClick={() => envia(false)}>
              mandar só a nota
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
