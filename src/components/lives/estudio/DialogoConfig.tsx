// Configurações do estúdio (engrenagem): trocar câmera, microfone e alto-falante sem sair da sala,
// desfocar o fundo e decidir se a prévia aparece na próxima entrada.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SeletoresDispositivo, useAparelhos, type EscolhaDispositivos } from "@/components/lives/estudio/Dispositivos";
import { OpcoesVideo } from "@/components/lives/estudio/OpcoesVideo";
import { lerPrefs, prefsDaEscolha, salvarPrefs } from "@/lib/lives/dispositivos";

export function DialogoConfig({ aberto, onFechar, escolha, onTrocar, nivel, desfocar, onDesfocar, erroFundo, usuario }: {
  aberto: boolean;
  onFechar: () => void;
  escolha: EscolhaDispositivos;
  onTrocar: (e: EscolhaDispositivos) => void;
  nivel?: number;
  desfocar?: boolean;
  onDesfocar?: (v: boolean) => void;
  erroFundo?: string | null;
  /** dono das preferências salvas; sem ele, nada é salvo */
  usuario?: string | null;
}) {
  const aparelhos = useAparelhos(aberto);
  const [sempreMostrar, setSempreMostrar] = useState(() => lerPrefs(usuario).sempreMostrarPrevia);
  const trocar = (e: EscolhaDispositivos) => {
    onTrocar(e);
    if (usuario !== undefined) salvarPrefs(usuario, prefsDaEscolha(e, aparelhos));
  };
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>Câmera, microfone e alto-falante usados no estúdio. A troca vale na hora, sem sair da sala.</DialogDescription>
        </DialogHeader>
        <SeletoresDispositivo escolha={escolha} onTrocar={trocar} nivel={nivel} aparelhos={aparelhos} />
        {onDesfocar && (
          <OpcoesVideo
            desfocar={!!desfocar}
            onDesfocar={(v) => {
              onDesfocar(v);
              if (usuario !== undefined) salvarPrefs(usuario, { desfocar: v });
            }}
            erroFundo={erroFundo}
            sempreMostrar={sempreMostrar}
            onSempreMostrar={usuario !== undefined ? (v) => { setSempreMostrar(v); salvarPrefs(usuario, { sempreMostrarPrevia: v }); } : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
