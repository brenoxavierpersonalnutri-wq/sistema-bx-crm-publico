// Acesso ao banco da área de conteúdos. O RLS já decide o que cada lado enxerga:
// o time gerencia tudo, a aluna só vê o que está publicado e liberado pro plano
// dela. Aqui não tem regra de permissão duplicada — só consulta.
import { supabase } from "@/integrations/supabase/client";
import type {
  ConteudoAula,
  ConteudoModulo,
  ConteudoProduto,
  ConteudoProgresso,
  ModuloComAulas,
  ProdutoComModulos,
} from "./types";

// A tabela ainda não está nos tipos gerados do Supabase; o cast segue a mesma
// convenção do resto do projeto.
const tabela = (nome: string) => supabase.from(nome as never);

/**
 * A árvore inteira: produtos, seus módulos e as aulas de cada módulo. Três
 * consultas em paralelo e a montagem em memória — é bem menos ida e volta que
 * pedir as aulas produto a produto.
 */
export async function fetchProdutosComModulos(): Promise<ProdutoComModulos[]> {
  const [{ data: produtos, error: e1 }, { data: modulos, error: e2 }, { data: aulas, error: e3 }] =
    await Promise.all([
      tabela("conteudo_produtos").select("*").order("ordem").order("created_at"),
      tabela("conteudo_modulos").select("*").order("ordem").order("created_at"),
      tabela("conteudo_aulas").select("*").order("ordem").order("created_at"),
    ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const aulasPorModulo = new Map<string, ConteudoAula[]>();
  ((aulas ?? []) as unknown as ConteudoAula[]).forEach((a) => {
    if (!aulasPorModulo.has(a.modulo_id)) aulasPorModulo.set(a.modulo_id, []);
    aulasPorModulo.get(a.modulo_id)!.push(a);
  });

  const modulosPorProduto = new Map<string, ModuloComAulas[]>();
  ((modulos ?? []) as unknown as ConteudoModulo[]).forEach((m) => {
    // Módulo sem produto é rascunho: não entra em lugar nenhum.
    if (!m.produto_id) return;
    const comAulas: ModuloComAulas = { ...m, aulas: aulasPorModulo.get(m.id) ?? [] };
    if (!modulosPorProduto.has(m.produto_id)) modulosPorProduto.set(m.produto_id, []);
    modulosPorProduto.get(m.produto_id)!.push(comAulas);
  });

  return ((produtos ?? []) as unknown as ConteudoProduto[]).map((p) => ({
    ...p,
    modulos: modulosPorProduto.get(p.id) ?? [],
  }));
}

export async function salvarProduto(produto: Partial<ConteudoProduto>): Promise<ConteudoProduto> {
  const { data, error } = await tabela("conteudo_produtos")
    .upsert({ ...produto, updated_at: new Date().toISOString() } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ConteudoProduto;
}

export async function apagarProduto(id: string): Promise<void> {
  const { error } = await tabela("conteudo_produtos").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchModulosComAulas(): Promise<ModuloComAulas[]> {
  const [{ data: modulos, error: e1 }, { data: aulas, error: e2 }] = await Promise.all([
    tabela("conteudo_modulos").select("*").order("ordem").order("created_at"),
    tabela("conteudo_aulas").select("*").order("ordem").order("created_at"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const porModulo = new Map<string, ConteudoAula[]>();
  ((aulas ?? []) as unknown as ConteudoAula[]).forEach((a) => {
    if (!porModulo.has(a.modulo_id)) porModulo.set(a.modulo_id, []);
    porModulo.get(a.modulo_id)!.push(a);
  });

  return ((modulos ?? []) as unknown as ConteudoModulo[]).map((m) => ({
    ...m,
    aulas: porModulo.get(m.id) ?? [],
  }));
}

export async function fetchProgresso(alunaId: string): Promise<ConteudoProgresso[]> {
  const { data, error } = await tabela("conteudo_progresso")
    .select("*")
    .eq("aluna_id", alunaId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ConteudoProgresso[];
}

/**
 * Grava onde a aluna parou. Chamado enquanto o vídeo roda, então é upsert puro:
 * a última escrita ganha e nada trava a reprodução se falhar.
 */
export async function salvarProgresso(
  alunaId: string,
  aulaId: string,
  segundos: number,
  concluida: boolean,
): Promise<void> {
  const { error } = await tabela("conteudo_progresso").upsert(
    {
      aluna_id: alunaId,
      aula_id: aulaId,
      segundos: Math.max(0, Math.floor(segundos)),
      concluida,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "aluna_id,aula_id" },
  );
  if (error) throw error;
}

/** URL assinada de um vídeo ou capa do bucket privado. */
export async function urlDoArquivo(path: string, segundos = 60 * 60 * 4): Promise<string> {
  const { data, error } = await supabase.storage.from("conteudos").createSignedUrl(path, segundos);
  if (error) throw error;
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Painel do time
// ---------------------------------------------------------------------------

export async function salvarModulo(modulo: Partial<ConteudoModulo>): Promise<ConteudoModulo> {
  const { data, error } = await tabela("conteudo_modulos")
    .upsert({ ...modulo, updated_at: new Date().toISOString() } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ConteudoModulo;
}

export async function apagarModulo(id: string): Promise<void> {
  const { error } = await tabela("conteudo_modulos").delete().eq("id", id);
  if (error) throw error;
}

export async function salvarAula(aula: Partial<ConteudoAula>): Promise<ConteudoAula> {
  const { data, error } = await tabela("conteudo_aulas")
    .upsert({ ...aula, updated_at: new Date().toISOString() } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ConteudoAula;
}

export async function apagarAula(id: string): Promise<void> {
  const { error } = await tabela("conteudo_aulas").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Sobe um arquivo pro bucket e devolve o caminho. O nome é higienizado porque o
 * storage rejeita acento e espaço no path.
 */
export async function subirArquivo(
  file: File,
  pasta: "videos" | "capas",
  onProgresso?: (pct: number) => void,
): Promise<string> {
  const limpo = file.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
  const path = `${pasta}/${Date.now()}-${limpo}`;

  onProgresso?.(5);
  const { error } = await supabase.storage.from("conteudos").upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  onProgresso?.(100);
  return path;
}
