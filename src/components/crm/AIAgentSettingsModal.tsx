import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Save, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MODELO_CONVERSA, MODELOS_CLAUDE, resolverModelo } from "@/lib/crm/iaClaude";

interface AIAgentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIAgentSettingsModal({ isOpen, onClose }: AIAgentSettingsModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [temperature, setTemperature] = useState([0.7]);
  const [model, setModel] = useState<string>(MODELO_CONVERSA);
  const [active, setActive] = useState(false);
  const [contextEnabled, setContextEnabled] = useState(true);
  const [prompt, setPrompt] = useState(`SUPORTE
  
SE O LEAD perguntar se pode enviar as fotos para avaliação por aqui (pela conversa), responda:
Pode sim, por gentileza!

SE O LEAD PERGUNTAR QUALQUER COISA SOBRE O DESAFIO ou dificuldade para acessar o produto, RESPONDA
Pra pegar seu treino e dieta do Desafio, é só acessar o e-mail que você recebeu...`);

  // Load settings from DB
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      setFetching(true);
      const { data, error } = await supabase
        .from("ai_agent_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (data) {
        setSettingsId(data.id);
        setModel(resolverModelo(data.model));
        setPrompt(data.prompt || "");
        setTemperature([Number(data.temperature) || 0.7]);
        setActive(data.active || false);
        setContextEnabled(data.context_enabled ?? true);
      }
      setFetching(false);
    })();
  }, [isOpen]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {
        model,
        prompt,
        temperature: temperature[0],
        active,
        context_enabled: contextEnabled,
        updated_at: new Date().toISOString(),
      };

      if (settingsId) {
        await supabase
          .from("ai_agent_settings")
          .update(payload)
          .eq("id", settingsId);
      } else {
        const { data } = await supabase
          .from("ai_agent_settings")
          .insert(payload)
          .select("id")
          .single();
        if (data) setSettingsId(data.id);
      }

      toast({
        title: "Agente IA atualizado",
        description: "As diretrizes foram salvas com sucesso.",
      });
      onClose();
    } catch {
      toast({
        title: "Erro",
        description: "Falha ao salvar configurações.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-500" />
            Configurações do Agente IA
          </DialogTitle>
          <DialogDescription>
            Configure as regras de atendimento e o comportamento do robô.
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid gap-6 py-4">
              <div className="flex items-center space-x-2 bg-green-50 dark:bg-green-950/30 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <Checkbox
                  id="active"
                  checked={active}
                  onCheckedChange={(v) => setActive(!!v)}
                  className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                />
                <div className="grid leading-none">
                  <label htmlFor="active" className="text-sm font-medium leading-none">
                    Agente IA Ativo
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Quando ativo, o agente responde automaticamente novas mensagens de leads.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Modelo de IA</Label>
                  <Select value={resolverModelo(model)} onValueChange={setModel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      {MODELOS_CLAUDE.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label>Temperatura: {temperature[0].toFixed(1)}</Label>
                    <span className="text-[10px] text-muted-foreground uppercase opacity-70 border px-1.5 py-0.5 rounded">
                      {temperature[0] > 0.6 ? "Criativo" : "Previsível"}
                    </span>
                  </div>
                  <Slider
                    value={temperature}
                    onValueChange={setTemperature}
                    max={1}
                    step={0.1}
                    className="py-1"
                  />
                </div>
              </div>

              <div className="grid gap-2 mt-2">
                <Label htmlFor="prompt" className="flex items-center justify-between text-sm font-medium">
                  <span>Instruções (Prompt Base)</span>
                  <span className="text-xs text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                    Avançado
                  </span>
                </Label>
                <Textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="font-mono text-xs min-h-[250px] leading-relaxed resize-y bg-muted/30 focus-visible:ring-indigo-500/50"
                  placeholder="Descreva aqui o passo a passo para o atendimento do agente..."
                />
              </div>

              <div className="flex items-center space-x-2 bg-muted p-3 rounded-lg border">
                <Checkbox
                  id="context"
                  checked={contextEnabled}
                  onCheckedChange={(v) => setContextEnabled(!!v)}
                  className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                />
                <div className="grid leading-none">
                  <label htmlFor="context" className="text-sm font-medium leading-none">
                    Habilitar histórico de contexto
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Aumenta o uso de tokens, mas o Agente lembrará do que o lead falou nas últimas horas.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[120px]"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Salvar Regras
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
