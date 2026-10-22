import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Users, DollarSign, Plus, Table, User, Search, 
  Calendar, ArrowRight, Filter, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type Lead = {
  id: string;
  click_id: string;
  email: string | null;
  phone: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  page_url: string;
  created_at: string;
  total_sales?: number;
};

export function LTVStatsTab() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Manual Sale State
  const [saleEmail, setSaleEmail] = useState("");
  const [saleValue, setSaleValue] = useState("");
  const [isInserting, setIsInserting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchLeads = async () => {
    if (!profile) return;
    try {
      setLoading(true);
      const { data: leadsData, error: leadsError } = await supabase
        .from("leads_tracking")
        .select("*")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false });

      if (leadsError) throw leadsError;

      const { data: salesData, error: salesError } = await supabase
        .from("sales_events")
        .select("lead_id, value")
        .eq("profile_id", profile.id);

      if (salesError) throw salesError;

      const leadsWithSales = (leadsData || []).map(lead => {
        const leadSales = (salesData || []).filter(s => s.lead_id === lead.id);
        const totalValue = leadSales.reduce((acc, curr) => acc + Number(curr.value), 0);
        return { ...lead, total_sales: totalValue };
      });

      setLeads(leadsWithSales);
    } catch (error: any) {
      console.error(error);
      toast.error("Erro ao buscar leads de LTV");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [profile]);

  const handleAddManualSale = async () => {
    if (!profile) return;
    if (!saleEmail || !saleValue) {
      toast.error("Preencha o e-mail ou telefone e o valor.");
      return;
    }

    setIsInserting(true);
    try {
      // Find the lead by email/phone
      const leadMatch = leads.find(l => 
        (l.email && l.email.toLowerCase() === saleEmail.toLowerCase()) || 
        (l.phone && l.phone === saleEmail)
      );

      // Create Sale Event
      const { error } = await supabase.from("sales_events").insert({
        profile_id: profile.id,
        lead_id: leadMatch ? leadMatch.id : null,
        value: Number(saleValue),
        source: "MANUAL",
        customer_email: leadMatch ? null : saleEmail, // If no match, save it just to know
        customer_phone: leadMatch ? null : saleEmail
      });

      if (error) throw error;
      
      toast.success(leadMatch 
        ? `Venda atribuída com sucesso ao Lead da campanha: ${leadMatch.utm_campaign || 'Desconhecida'}!`
        : "Venda registrada, mas nenhum Lead foi encontrado (Venda orgânica)."
      );
      
      setDialogOpen(false);
      setSaleEmail("");
      setSaleValue("");
      fetchLeads(); // Refresh table
    } catch (error: any) {
      toast.error("Erro ao registrar venda: " + error.message);
    } finally {
      setIsInserting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">LTV & Vendas WhatsApp (30 Dias)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cruze e atribua o lucro ao Lead captado nos últimos 30 dias.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shrink-0 bg-green-600 hover:bg-green-700">
              <Plus className="h-4 w-4" /> Venda Manual (Wpp)
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar Venda Manual</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>E-mail ou Telefone do Lead</Label>
                <Input 
                  placeholder="exemplo@gmail.com ou 11999999999" 
                  value={saleEmail}
                  onChange={(e) => setSaleEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">O sistema tentará achar o clique original deste usuário.</p>
              </div>
              <div className="space-y-2">
                <Label>Valor da Venda (R$)</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  placeholder="97.00" 
                  value={saleValue}
                  onChange={(e) => setSaleValue(e.target.value)}
                />
              </div>
              <Button onClick={handleAddManualSale} disabled={isInserting} className="w-full">
                {isInserting ? "Salvando..." : "Confirmar Venda"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-6 py-4 font-medium">Lead (ID)</th>
                <th className="px-6 py-4 font-medium">Data Entrada</th>
                <th className="px-6 py-4 font-medium">Origem (UTM)</th>
                <th className="px-6 py-4 font-medium">Landing Page</th>
                <th className="px-6 py-4 font-medium text-right">LTV Retornado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    Buscando Leads e Vendas...
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center mb-4">
                        <Users className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-base font-medium text-foreground">Ainda não há leads captados.</p>
                      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                        Instale o pixel nas suas páginas e rode os links para começar a ver o funil de LTV.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{lead.email || lead.phone || "Anônimo"}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate w-24" title={lead.click_id}>
                            {lead.click_id.substring(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {format(new Date(lead.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {lead.utm_campaign ? (
                          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                            C: {lead.utm_campaign}
                          </Badge>
                        ) : <span className="text-muted-foreground">-</span>}
                        {lead.utm_content && (
                          <Badge variant="outline" className="bg-secondary">
                            Ad: {lead.utm_content}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="truncate w-40 inline-block text-xs text-muted-foreground" title={lead.page_url}>
                        {lead.page_url.replace(/^https?:\/\//, '')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {lead.total_sales && lead.total_sales > 0 ? (
                        <div className="inline-flex items-center font-medium text-green-600 bg-green-500/10 px-2.5 py-1 rounded-full">
                          <DollarSign className="h-3.5 w-3.5 mr-0.5" />
                          {lead.total_sales.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">R$ 0,00</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
