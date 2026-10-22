// Tags do contato (whatsapp_contacts.tags). Pôr uma tag nova dispara as regras "recebeu a tag".
// As opções vêm das tags que já existem no sistema (SeletorTags), com "+ Criar tag".
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { db, normalizarTag } from "@/lib/crmAutomacoes";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { mesclarTags } from "@/lib/crm/tags";

/** `numeroId`: a conversa daquele número (o mesmo telefone em outro número é outro contato). */
export function TagsContato({ phone, numeroId = null }: { phone: string; numeroId?: string | null }) {
  const { toast } = useToast();
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      let q = db.from("whatsapp_contacts").select("tags").eq("phone", phone);
      if (numeroId) q = q.eq("numero_id", numeroId);
      const { data } = await q.limit(1);
      setTags(data?.[0]?.tags ?? []);
    })();
  }, [phone, numeroId]);

  const gravar = async (lista: string[]) => {
    let q = db.from("whatsapp_contacts").update({ tags: lista }).eq("phone", phone);
    if (numeroId) q = q.eq("numero_id", numeroId);
    const { error } = await q;
    if (error) return toast({ title: "Não salvou a tag", description: error.message, variant: "destructive" });
    setTags(lista);
  };

  return (
    <div className="space-y-2 mb-4">
      <p className="text-sm font-medium">Tags</p>
      <SeletorTags multiplo valor={tags} onMudar={(lista) => gravar(mesclarTags(tags, lista))} placeholder="Escolher ou criar tag" />
    </div>
  );
}
