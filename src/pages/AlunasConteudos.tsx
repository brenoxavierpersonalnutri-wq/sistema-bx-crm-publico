import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ChevronDown, ChevronRight, EyeOff, Film, Loader2, Package,
  Pencil, Plus, Star, Trash2, Upload, Youtube,
} from "lucide-react";
import { toast } from "sonner";
import {
  apagarAula, apagarModulo, apagarProduto, fetchProdutosComModulos,
  salvarAula, salvarModulo, salvarProduto, subirArquivo,
} from "@/lib/conteudos/store";
import { capaDaAula, duracaoLegivel } from "@/lib/conteudos/types";
import type {
  ConteudoAula, ConteudoModulo, ConteudoProduto, ModuloComAulas, ProdutoComModulos,
} from "@/lib/conteudos/types";
import { parseYoutubeId } from "@/lib/appAluna/types";

const vazioProduto: Partial<ConteudoProduto> = {
  titulo: "", descricao: "", programa: "", ordem: 0, publicado: true,
};
const vazioModulo: Partial<ConteudoModulo> = {
  titulo: "", descricao: "", ordem: 0, publicado: true,
};
const vazioAula: Partial<ConteudoAula> = {
  titulo: "", descricao: "", tipo: "youtube", youtube_id: "", ordem: 0,
  publicado: true, destaque: false,
};

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
const btnPrimario =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
const btnFantasma = "rounded-lg border border-border px-4 py-2 text-sm";

function Campo({
  label, children, dica,
}: { label: string; children: React.ReactNode; dica?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-muted-foreground">{dica}</span>}
    </label>
  );
}

function Rascunho() {
  return (
    <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
      <EyeOff className="h-3 w-3" />
      rascunho
    </span>
  );
}

export default function AlunasConteudos() {
  const qc = useQueryClient();
  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ["conteudo-produtos-admin"],
    queryFn: fetchProdutosComModulos,
  });

  // Null = lista de produtos. Com id = dentro do produto, vendo os módulos.
  const [produtoAbertoId, setProdutoAbertoId] = useState<string | null>(null);
  const [editandoProduto, setEditandoProduto] = useState<Partial<ConteudoProduto> | null>(null);
  const [editandoModulo, setEditandoModulo] = useState<Partial<ConteudoModulo> | null>(null);
  const [editandoAula, setEditandoAula] = useState<Partial<ConteudoAula> | null>(null);
  const [modulosAbertos, setModulosAbertos] = useState<Record<string, boolean>>({});
  const [subindo, setSubindo] = useState(false);
  const arquivoVideo = useRef<HTMLInputElement>(null);
  const arquivoCapa = useRef<HTMLInputElement>(null);

  const produtoAberto = useMemo(
    () => produtos.find((p: ProdutoComModulos) => p.id === produtoAbertoId) ?? null,
    [produtos, produtoAbertoId],
  );

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["conteudo-produtos-admin"] });
    void qc.invalidateQueries({ queryKey: ["conteudo-produtos"] });
  };

  const erro = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Não deu pra salvar");

  const mProduto = useMutation({
    mutationFn: salvarProduto,
    onSuccess: () => { toast.success("Produto salvo"); setEditandoProduto(null); recarregar(); },
    onError: erro,
  });
  const mModulo = useMutation({
    mutationFn: salvarModulo,
    onSuccess: () => { toast.success("Módulo salvo"); setEditandoModulo(null); recarregar(); },
    onError: erro,
  });
  const mAula = useMutation({
    mutationFn: salvarAula,
    onSuccess: () => { toast.success("Aula salva"); setEditandoAula(null); recarregar(); },
    onError: erro,
  });
  const mApagarProduto = useMutation({
    mutationFn: apagarProduto,
    onSuccess: () => { toast.success("Produto apagado"); setProdutoAbertoId(null); recarregar(); },
    onError: erro,
  });
  const mApagarModulo = useMutation({
    mutationFn: apagarModulo,
    onSuccess: () => { toast.success("Módulo apagado"); recarregar(); },
    onError: erro,
  });
  const mApagarAula = useMutation({
    mutationFn: apagarAula,
    onSuccess: () => { toast.success("Aula apagada"); recarregar(); },
    onError: erro,
  });

  async function subir(tipo: "videos" | "capas", file: File) {
    setSubindo(true);
    try {
      const path = await subirArquivo(file, tipo);
      if (tipo === "videos") {
        setEditandoAula((a) => ({ ...a, tipo: "upload", video_path: path, youtube_id: "" }));
        toast.success("Vídeo enviado");
      } else {
        setEditandoAula((a) => ({ ...a, capa_url: path }));
        toast.success("Capa enviada");
      }
    } catch (e: unknown) {
      erro(e);
    } finally {
      setSubindo(false);
    }
  }

  const contaAulas = (m: ModuloComAulas[]) => m.reduce((acc, mod) => acc + mod.aulas.length, 0);

  // ------------------------------------------------------------ formulários

  const formProduto = editandoProduto && (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-card p-4">
      <h2 className="font-semibold">{editandoProduto.id ? "Editar produto" : "Novo produto"}</h2>
      <Campo label="Nome do produto">
        <input
          className={inputCls}
          value={editandoProduto.titulo ?? ""}
          onChange={(e) => setEditandoProduto({ ...editandoProduto, titulo: e.target.value })}
          placeholder="Plataforma Magra e Definida"
        />
      </Campo>
      <Campo label="Descrição">
        <textarea
          className={inputCls}
          rows={2}
          value={editandoProduto.descricao ?? ""}
          onChange={(e) => setEditandoProduto({ ...editandoProduto, descricao: e.target.value })}
        />
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          label="Programa"
          dica="Vazio libera pra todas as alunas. Preenchido, só pra quem está nesse plano."
        >
          <input
            className={inputCls}
            value={editandoProduto.programa ?? ""}
            onChange={(e) => setEditandoProduto({ ...editandoProduto, programa: e.target.value })}
            placeholder="Ex.: MGMD"
          />
        </Campo>
        <Campo label="Ordem">
          <input
            type="number"
            className={inputCls}
            value={editandoProduto.ordem ?? 0}
            onChange={(e) => setEditandoProduto({ ...editandoProduto, ordem: Number(e.target.value) })}
          />
        </Campo>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={editandoProduto.publicado ?? true}
          onChange={(e) => setEditandoProduto({ ...editandoProduto, publicado: e.target.checked })}
        />
        Publicado
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!editandoProduto.titulo?.trim() || mProduto.isPending}
          onClick={() => mProduto.mutate(editandoProduto)}
          className={btnPrimario}
        >
          {mProduto.isPending ? "Salvando..." : "Salvar produto"}
        </button>
        <button type="button" onClick={() => setEditandoProduto(null)} className={btnFantasma}>
          Cancelar
        </button>
      </div>
    </div>
  );

  const formModulo = editandoModulo && (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-card p-4">
      <h2 className="font-semibold">{editandoModulo.id ? "Editar módulo" : "Novo módulo"}</h2>
      <Campo label="Título do módulo">
        <input
          className={inputCls}
          value={editandoModulo.titulo ?? ""}
          onChange={(e) => setEditandoModulo({ ...editandoModulo, titulo: e.target.value })}
          placeholder="Boas vindas"
        />
      </Campo>
      <Campo label="Descrição">
        <textarea
          className={inputCls}
          rows={2}
          value={editandoModulo.descricao ?? ""}
          onChange={(e) => setEditandoModulo({ ...editandoModulo, descricao: e.target.value })}
        />
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Ordem">
          <input
            type="number"
            className={inputCls}
            value={editandoModulo.ordem ?? 0}
            onChange={(e) => setEditandoModulo({ ...editandoModulo, ordem: Number(e.target.value) })}
          />
        </Campo>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={editandoModulo.publicado ?? true}
            onChange={(e) => setEditandoModulo({ ...editandoModulo, publicado: e.target.checked })}
          />
          Publicado
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!editandoModulo.titulo?.trim() || mModulo.isPending}
          onClick={() => mModulo.mutate(editandoModulo)}
          className={btnPrimario}
        >
          {mModulo.isPending ? "Salvando..." : "Salvar módulo"}
        </button>
        <button type="button" onClick={() => setEditandoModulo(null)} className={btnFantasma}>
          Cancelar
        </button>
      </div>
    </div>
  );

  const formAula = editandoAula && (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-card p-4">
      <h2 className="font-semibold">{editandoAula.id ? "Editar aula" : "Nova aula"}</h2>
      <Campo label="Título da aula">
        <input
          className={inputCls}
          value={editandoAula.titulo ?? ""}
          onChange={(e) => setEditandoAula({ ...editandoAula, titulo: e.target.value })}
          placeholder="Seja bem vinda! Comece por aqui"
        />
      </Campo>
      <Campo label="Descrição">
        <textarea
          className={inputCls}
          rows={2}
          value={editandoAula.descricao ?? ""}
          onChange={(e) => setEditandoAula({ ...editandoAula, descricao: e.target.value })}
        />
      </Campo>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditandoAula({ ...editandoAula, tipo: "youtube" })}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
              editandoAula.tipo === "youtube"
                ? "bg-primary text-primary-foreground"
                : "border border-border"
            }`}
          >
            <Youtube className="h-4 w-4" />
            Link do YouTube
          </button>
          <button
            type="button"
            onClick={() => setEditandoAula({ ...editandoAula, tipo: "upload" })}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
              editandoAula.tipo === "upload"
                ? "bg-primary text-primary-foreground"
                : "border border-border"
            }`}
          >
            <Film className="h-4 w-4" />
            Subir o vídeo
          </button>
        </div>

        {editandoAula.tipo === "youtube" ? (
          <Campo
            label="Link ou ID do YouTube"
            dica="A aula toca aqui dentro do app. A aluna não é jogada pro YouTube."
          >
            <input
              className={inputCls}
              value={editandoAula.youtube_id ?? ""}
              onChange={(e) =>
                setEditandoAula({
                  ...editandoAula,
                  youtube_id: parseYoutubeId(e.target.value) ?? e.target.value,
                })
              }
              placeholder="https://youtu.be/..."
            />
          </Campo>
        ) : (
          <div>
            <input
              ref={arquivoVideo}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subir("videos", f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={subindo}
              onClick={() => arquivoVideo.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {editandoAula.video_path ? "Trocar o vídeo" : "Escolher arquivo de vídeo"}
            </button>
            {editandoAula.video_path && (
              <p className="mt-1 text-xs text-muted-foreground">{editandoAula.video_path}</p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo label="Duração (segundos)" dica="Opcional, mostra o tempo na capa.">
          <input
            type="number"
            className={inputCls}
            value={editandoAula.duracao_segundos ?? ""}
            onChange={(e) =>
              setEditandoAula({
                ...editandoAula,
                duracao_segundos: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </Campo>
        <Campo label="Ordem">
          <input
            type="number"
            className={inputCls}
            value={editandoAula.ordem ?? 0}
            onChange={(e) => setEditandoAula({ ...editandoAula, ordem: Number(e.target.value) })}
          />
        </Campo>
        <Campo label="Capa" dica="Sem capa, o YouTube entra com a dele.">
          <input
            ref={arquivoCapa}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir("capas", f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={subindo}
            onClick={() => arquivoCapa.current?.click()}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            {editandoAula.capa_url ? "Trocar capa" : "Subir capa"}
          </button>
        </Campo>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={editandoAula.publicado ?? true}
            onChange={(e) => setEditandoAula({ ...editandoAula, publicado: e.target.checked })}
          />
          Publicada
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={editandoAula.destaque ?? false}
            onChange={(e) => setEditandoAula({ ...editandoAula, destaque: e.target.checked })}
          />
          Destaque do topo
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!editandoAula.titulo?.trim() || mAula.isPending}
          onClick={() => mAula.mutate(editandoAula)}
          className={btnPrimario}
        >
          {mAula.isPending ? "Salvando..." : "Salvar aula"}
        </button>
        <button type="button" onClick={() => setEditandoAula(null)} className={btnFantasma}>
          Cancelar
        </button>
      </div>
    </div>
  );

  // ------------------------------------------------------------ dentro do produto

  if (produtoAberto) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setProdutoAbertoId(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Voltar pros produtos"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 truncate text-xl font-bold">
                  {produtoAberto.titulo}
                  {!produtoAberto.publicado && <Rascunho />}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {produtoAberto.modulos.length} módulo(s), {contaAulas(produtoAberto.modulos)} aula(s)
                  {produtoAberto.programa?.trim()
                    ? ` · só ${produtoAberto.programa}`
                    : " · todas as alunas"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditandoAula(null);
                setEditandoModulo({
                  ...vazioModulo,
                  produto_id: produtoAberto.id,
                  ordem: produtoAberto.modulos.length,
                });
              }}
              className={`flex items-center gap-2 ${btnPrimario}`}
            >
              <Plus className="h-4 w-4" />
              Novo módulo
            </button>
          </div>

          {formModulo}
          {formAula}

          {produtoAberto.modulos.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
              <p className="font-semibold">Nenhum módulo neste produto</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Cria o primeiro módulo e sobe as aulas dentro dele.
              </p>
            </div>
          ) : (
            produtoAberto.modulos.map((modulo: ModuloComAulas) => {
              const aberto = modulosAbertos[modulo.id] !== false;
              return (
                <div key={modulo.id} className="rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <button
                      type="button"
                      onClick={() => setModulosAbertos((s) => ({ ...s, [modulo.id]: !aberto }))}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      {aberto ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 font-semibold">
                          <span className="truncate">{modulo.titulo}</span>
                          {!modulo.publicado && <Rascunho />}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {modulo.aulas.length} aula(s)
                        </span>
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditandoModulo(null);
                          setEditandoAula({
                            ...vazioAula,
                            modulo_id: modulo.id,
                            ordem: modulo.aulas.length,
                          });
                        }}
                        className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                      >
                        <Plus className="h-3 w-3" />
                        Aula
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditandoAula(null); setEditandoModulo(modulo); }}
                        className="rounded-lg border border-border p-1.5 text-muted-foreground"
                        aria-label="Editar módulo"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Apagar "${modulo.titulo}" e todas as aulas dele?`)) {
                            mApagarModulo.mutate(modulo.id);
                          }
                        }}
                        className="rounded-lg border border-border p-1.5 text-destructive"
                        aria-label="Apagar módulo"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {aberto && modulo.aulas.length > 0 && (
                    <ul className="space-y-2 border-t border-border p-4 pt-3">
                      {modulo.aulas.map((aula: ConteudoAula) => {
                        const capa = capaDaAula(aula);
                        return (
                          <li
                            key={aula.id}
                            className="flex items-center gap-3 rounded-lg border border-border/60 p-2"
                          >
                            <span className="h-12 w-20 shrink-0 overflow-hidden rounded bg-muted">
                              {capa ? (
                                <img src={capa} alt="" loading="lazy" className="h-full w-full object-cover" />
                              ) : (
                                <span className="flex h-full w-full items-center justify-center">
                                  <Film className="h-4 w-4 text-muted-foreground" />
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                                {aula.destaque && (
                                  <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />
                                )}
                                {aula.titulo}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {aula.tipo === "youtube" ? "YouTube" : "Vídeo próprio"}
                                {duracaoLegivel(aula.duracao_segundos) &&
                                  ` · ${duracaoLegivel(aula.duracao_segundos)}`}
                                {!aula.publicado && " · rascunho"}
                              </span>
                            </span>
                            <span className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={() => { setEditandoModulo(null); setEditandoAula(aula); }}
                                className="rounded-lg border border-border p-1.5 text-muted-foreground"
                                aria-label="Editar aula"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`Apagar a aula "${aula.titulo}"?`)) {
                                    mApagarAula.mutate(aula.id);
                                  }
                                }}
                                className="rounded-lg border border-border p-1.5 text-destructive"
                                aria-label="Apagar aula"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ lista de produtos

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/alunas" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold">Conteúdos das alunas</h1>
              <p className="text-sm text-muted-foreground">
                Produto, módulos dentro dele, e as aulas dentro dos módulos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditandoProduto({ ...vazioProduto, ordem: produtos.length })}
            className={`flex items-center gap-2 ${btnPrimario}`}
          >
            <Plus className="h-4 w-4" />
            Novo produto
          </button>
        </div>

        {formProduto}

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : produtos.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
            <Package className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-semibold">Nenhum produto ainda</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cria o primeiro produto (ex.: Plataforma Magra e Definida) e monta os módulos dentro.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {produtos.map((produto: ProdutoComModulos) => (
              <div key={produto.id} className="rounded-xl border border-border bg-card p-4">
                <button
                  type="button"
                  onClick={() => setProdutoAbertoId(produto.id)}
                  className="w-full text-left"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{produto.titulo}</span>
                    {!produto.publicado && <Rascunho />}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {produto.modulos.length} módulo(s), {contaAulas(produto.modulos)} aula(s)
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {produto.programa?.trim() ? `só ${produto.programa}` : "todas as alunas"}
                  </span>
                </button>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setProdutoAbertoId(produto.id)}
                    className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    Abrir módulos
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditandoProduto(produto)}
                    className="rounded-lg border border-border p-1.5 text-muted-foreground"
                    aria-label="Editar produto"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Apagar "${produto.titulo}" com todos os módulos e aulas?`)) {
                        mApagarProduto.mutate(produto.id);
                      }
                    }}
                    className="rounded-lg border border-border p-1.5 text-destructive"
                    aria-label="Apagar produto"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A aluna vê isso em /aluna/conteudos, na aba Aulas.
        </p>
      </div>
    </div>
  );
}
