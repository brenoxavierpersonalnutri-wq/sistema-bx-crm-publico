import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useEtapas } from "@/hooks/useEtapas";
import { ETAPAS_SISTEMA } from "../../../supabase/functions/_shared/etapas.ts";

/**
 * As 5 etapas de sempre, só como FALLBACK (antes da migration de crm_etapas). As colunas reais vêm de
 * useEtapas() (tabela crm_etapas, editável em "Configurar etapas"). Não use isto para montar tela nova.
 */
export const KANBAN_COLUMNS = ETAPAS_SISTEMA.map((e) => ({ id: e.slug, title: e.nome }));

interface WhatsAppContact {
  id: string;
  phone: string;
  name: string;
  stage: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface KanbanBoardProps {
  onCardClick?: (card: WhatsAppContact) => void;
  selectedCardId?: string | null;
}

const KanbanBoard = ({ onCardClick, selectedCardId }: KanbanBoardProps) => {
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [loading, setLoading] = useState(true);
  const { colunasKanban } = useEtapas();
  // ativas + arquivadas/desconhecidas que ainda têm contato (ninguém some do quadro)
  const colunas = colunasKanban(contacts.map((c) => c.stage));

  const fetchContacts = async () => {
    const { data, error } = await supabase
      .from("whatsapp_contacts")
      .select("*")
      .order("updated_at", { ascending: false });

    if (!error && data) {
      setContacts(data as WhatsAppContact[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchContacts();

    // Realtime subscription
    const channel = supabase
      .channel("whatsapp_contacts_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_contacts" },
        () => {
          fetchContacts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleDragStart = (e: React.DragEvent, contactId: string) => {
    e.dataTransfer.setData("contactId", contactId);
  };

  const handleDrop = async (e: React.DragEvent, newStage: string) => {
    e.preventDefault();
    const contactId = e.dataTransfer.getData("contactId");
    if (!contactId) return;

    // Optimistic update
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, stage: newStage } : c))
    );

    const { error } = await supabase
      .from("whatsapp_contacts")
      .update({ stage: newStage, updated_at: new Date().toISOString() })
      .eq("id", contactId);
    if (error) fetchContacts(); // etapa inexistente (FK) ou sem permissão: volta ao que está no banco
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (loading) {
    return (
      <div className="flex gap-4 p-4">
        {colunas.map((col) => (
          <div key={col.id} className="min-w-[280px] w-[280px] space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 h-full p-2">
      {colunas.map((column) => (
        <div
          key={column.id}
          className="min-w-[280px] w-[280px] flex flex-col bg-muted/30 rounded-lg p-3 border border-border/50"
          onDrop={(e) => handleDrop(e, column.id)}
          onDragOver={handleDragOver}
        >
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: column.cor }} aria-hidden />
              {column.title}
            </h3>
            <Badge variant="secondary" className="bg-background shadow-sm">
              {contacts.filter((c) => c.stage === column.id).length}
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
            {contacts
              .filter((c) => c.stage === column.id)
              .map((contact) => {
                const isSelected = selectedCardId === contact.id;
                return (
                  <Card
                    key={contact.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, contact.id)}
                    onClick={() => onCardClick && onCardClick(contact)}
                    className={`cursor-pointer transition-all ${
                      isSelected
                        ? "ring-2 ring-green-500 shadow-md scale-[1.02]"
                        : "hover:border-primary/40 shadow-sm"
                    }`}
                  >
                    <CardHeader className="p-3 pb-2 flex flex-row items-center space-y-0 gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback
                          className={
                            isSelected ? "bg-green-100 text-green-700" : ""
                          }
                        >
                          {(contact.name || contact.phone)
                            .substring(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <CardTitle className="text-sm font-medium leading-none">
                        {contact.name || contact.phone}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-1">
                      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                        {contact.phone}
                      </p>
                      {contact.notes && (
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                          {contact.notes}
                        </p>
                      )}
                      <div className="flex items-center justify-end">
                        <span className="text-[10px] text-muted-foreground font-medium bg-muted px-2 py-1 rounded">
                          {new Date(contact.updated_at).toLocaleDateString(
                            "pt-BR",
                            { day: "2-digit", month: "short" }
                          )}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

            {contacts.filter((c) => c.stage === column.id).length === 0 && (
              <div className="text-center py-8 text-xs text-muted-foreground">
                Arraste cards aqui
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default KanbanBoard;
