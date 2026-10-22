// Seletor de tags que PUXA as tags que já existem no sistema (crm_tags_existentes), com busca, contagem de
// uso e "+ Criar tag" ali mesmo (cria, normaliza para minúsculas-com-hífen e já seleciona).
// Um (multiplo=false) ou várias (multiplo=true). Usado no construtor de fluxos, no chat e no Banco de dados.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { filtrarTags, fonteTagsSupabase, normalizarTag, podeCriarTag, type FonteTags, type TagExistente } from "@/lib/crm/tags";

interface Props {
  valor: string[];
  onMudar: (tags: string[]) => void;
  multiplo?: boolean;
  placeholder?: string;
  fonte?: FonteTags;
  className?: string;
  /** mostra as escolhidas como chips abaixo do botão (padrão: só quando multiplo) */
  chips?: boolean;
  disabled?: boolean;
  /** rótulo acessível */
  rotulo?: string;
}

export function SeletorTags({ valor, onMudar, multiplo = false, placeholder = "Escolher tag", fonte = fonteTagsSupabase, className, chips, disabled, rotulo = "Tag" }: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<TagExistente[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const escolhidas = useMemo(() => valor.map(normalizarTag).filter(Boolean), [valor]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    fonte.listar().then((l) => { if (vivo) { setLista(l); setErro(null); } })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "falha ao ler as tags"))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [aberto, fonte]);

  const opcoes = useMemo(() => filtrarTags(lista, busca, escolhidas), [lista, busca, escolhidas]);
  const nova = podeCriarTag([...lista, ...escolhidas.map((tag) => ({ tag, uso: 0 }))], busca);

  const alternar = (t: string) => {
    if (multiplo) onMudar(escolhidas.includes(t) ? escolhidas.filter((x) => x !== t) : [...escolhidas, t]);
    else { onMudar(escolhidas[0] === t ? [] : [t]); setAberto(false); }
    setBusca("");
  };

  const criar = async () => {
    if (!nova) return;
    try {
      const t = await fonte.criar(nova);
      setLista((l) => (l.some((x) => x.tag === t) ? l : [...l, { tag: t, uso: 0 }]));
      if (multiplo) onMudar([...new Set([...escolhidas, t])]);
      else { onMudar([t]); setAberto(false); }
      setBusca("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não criou a tag");
    }
  };

  const mostrarChips = chips ?? multiplo;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={aberto} aria-label={rotulo} disabled={disabled}
            className="h-9 w-full justify-between font-normal">
            <span className={cn("truncate", !escolhidas.length && "text-muted-foreground")}>
              {escolhidas.length === 0 ? placeholder : multiplo ? `${escolhidas.length} tag(s)` : escolhidas[0]}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar ou criar tag..." value={busca} onValueChange={setBusca}
              onKeyDown={(e) => { if (e.key === "Enter" && nova && !opcoes.length) { e.preventDefault(); criar(); } }} />
            <CommandList>
              {carregando && <div className="px-3 py-2 text-xs text-muted-foreground">Carregando tags...</div>}
              {erro && <div className="px-3 py-2 text-xs text-destructive">{erro}</div>}
              {!carregando && !nova && <CommandEmpty>Nenhuma tag.</CommandEmpty>}
              {nova && (
                <CommandGroup>
                  <CommandItem value={`__criar__${nova}`} onSelect={criar}>
                    <Plus className="mr-2 h-4 w-4" />Criar tag <span className="ml-1 font-medium">{nova}</span>
                  </CommandItem>
                </CommandGroup>
              )}
              {opcoes.length > 0 && (
                <CommandGroup heading="Tags existentes">
                  {opcoes.map((o) => (
                    <CommandItem key={o.tag} value={o.tag} onSelect={() => alternar(o.tag)}>
                      <Check className={cn("mr-2 h-4 w-4", escolhidas.includes(o.tag) ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1 truncate">{o.tag}</span>
                      <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">{o.uso > 0 ? o.uso.toLocaleString("pt-BR") : ""}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {mostrarChips && escolhidas.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {escolhidas.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1">
              {t}
              <button type="button" onClick={() => onMudar(escolhidas.filter((x) => x !== t))} aria-label={`Tirar ${t}`} disabled={disabled}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
