// Configuração do número de WhatsApp que recebe as mensagens dos novos leads.
// Persistido em app_settings.sdr_whatsapp_phone — a página /agendar lê esse valor
// em tempo real, então trocar aqui atualiza o sistema todo automaticamente.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Phone, Save } from "lucide-react";

const SETTING_KEY = "sdr_whatsapp_phone";

export function SdrPhoneSetting() {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTING_KEY)
      .maybeSingle()
      .then(({ data }) => {
        setValue(data?.value ?? "");
        setSaved(data?.value ?? "");
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 12 || !digits.startsWith("55")) {
      toast({
        title: "Número inválido",
        description: "Use o formato com DDI e DDD, ex: 5531990000104",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: SETTING_KEY, value: digits }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    setSaved(digits);
    setValue(digits);
    toast({ title: "Número atualizado", description: "Novos leads já vão para esse WhatsApp." });
  };

  return (
    <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground text-sm font-bold uppercase tracking-wider">
        <Phone size={16} /> WhatsApp dos novos leads
      </div>
      <p className="text-xs text-muted-foreground">
        Número que recebe as mensagens dos leads qualificados na tela de confirmação.
        Formato com DDI + DDD, ex: 5531990000104.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="5531990000104"
          disabled={loading}
          className="max-w-[240px] font-mono"
        />
        <Button onClick={handleSave} disabled={saving || loading || value.replace(/\D/g, "") === saved}>
          <Save size={16} className="mr-2" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
      {saved && (
        <p className="text-xs text-muted-foreground">
          Atual: <span className="font-mono text-foreground">{saved}</span>
        </p>
      )}
    </div>
  );
}
