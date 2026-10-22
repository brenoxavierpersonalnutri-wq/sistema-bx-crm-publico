// Setinha (^) ao lado de "Mudo" e "Desligar câmera" na barra do estúdio, como no Zoom: abre a lista de
// microfones/alto-falantes ou de câmeras com check no atual, troca ao vivo sem sair da sala, desfoque do fundo
// e atalho para as Configurações. A lista se atualiza sozinha no devicechange (AirPods, iPhone) com um aviso
// discreto; sem permissão (lista sem nomes) oferece "Permitir acesso para ver os aparelhos".
import { useEffect, useRef, type ReactNode } from "react";
import { Check, ChevronUp, Info } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAparelhos, type EscolhaDispositivos } from "@/components/lives/estudio/Dispositivos";
import { salvarCamera } from "@/lib/lives/cameras";
import {
  AJUDA_AUDIO, AJUDA_VIDEO, aparelhoAtual, avisosNovosAparelhos, prefsDaEscolha, rotuloAparelho, salvarPrefs, suportaEscolherSaida,
  temNomes, type ListaAparelhos,
} from "@/lib/lives/dispositivos";
import { cn } from "@/lib/utils";

/** O que a barra precisa para mostrar as setinhas (sem isto, os botões ficam sem menu). */
export interface ControleAparelhos {
  escolha: EscolhaDispositivos;
  onTrocar: (e: EscolhaDispositivos) => void;
  desfocar?: boolean;
  onDesfocar?: (v: boolean) => void;
  /** abre a engrenagem (Configurações) */
  onConfig?: () => void;
  /** dono das preferências salvas; undefined = não salva */
  usuario?: string | null;
}

export const TEXTO_PERMITIR = "Permitir acesso para ver os aparelhos";

type Aparelhos = ReturnType<typeof useAparelhos>;

/** Lista de aparelhos da barra + aviso discreto quando algo novo conecta (um aviso por aparelho). */
export function useAparelhosComAviso(): Aparelhos {
  const aparelhos = useAparelhos();
  const anterior = useRef<ListaAparelhos | null>(null);
  const assinatura = [...aparelhos.cameras, ...aparelhos.mics, ...aparelhos.saidas].map((d) => `${d.kind}:${d.deviceId}:${d.label}`).join("|");
  useEffect(() => {
    const atual = { cameras: aparelhos.cameras, mics: aparelhos.mics, saidas: aparelhos.saidas };
    if (anterior.current) avisosNovosAparelhos(anterior.current, atual).forEach((m) => toast(m, { duration: 3000 }));
    anterior.current = atual;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  return aparelhos;
}

async function pedirPermissao(tipo: "audio" | "video", reler: () => Promise<unknown>) {
  try {
    const s = await navigator.mediaDevices.getUserMedia(tipo === "audio" ? { audio: true } : { video: true });
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    const nome = (e as Error)?.name;
    toast.error(nome === "NotAllowedError" ? "Permissão negada: libere câmera e microfone no cadeado da barra de endereço." : "Não foi possível acessar os aparelhos.");
  }
  await reler();
}

function ItemAparelho({ marcado, onSelect, children }: { marcado: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2" aria-checked={marcado} role="menuitemradio">
      <Check className={cn("h-4 w-4 shrink-0", !marcado && "invisible")} aria-hidden />
      <span className="truncate">{children}</span>
    </DropdownMenuItem>
  );
}

function Ajuda({ texto }: { texto: string }) {
  return (
    <p className="flex gap-1.5 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="ajuda-aparelhos">
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      {texto}
    </p>
  );
}

function Setinha({ rotulo }: { rotulo: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={rotulo}
        title={rotulo}
        className="flex h-14 w-5 shrink-0 items-start justify-center rounded-md pt-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary sm:h-[60px]"
      >
        <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </DropdownMenuTrigger>
  );
}

function salvar(c: ControleAparelhos, nova: EscolhaDispositivos, aparelhos: Aparelhos) {
  c.onTrocar(nova);
  if (c.usuario !== undefined) salvarPrefs(c.usuario, prefsDaEscolha(nova, aparelhos));
}

export function MenuMicrofone({ controle, aparelhos }: { controle: ControleAparelhos; aparelhos: Aparelhos }) {
  const { mics, saidas } = aparelhos;
  const semNomes = !temNomes(mics);
  const micAtual = aparelhoAtual(mics, controle.escolha.micId);
  const saidaAtual = aparelhoAtual(saidas, controle.escolha.saidaId);
  const escolheSaida = suportaEscolherSaida();
  return (
    <DropdownMenu modal={false}>
      <Setinha rotulo="Opções de áudio" />
      <DropdownMenuContent side="top" align="start" className="w-80" data-testid="menu-microfone">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Microfone</DropdownMenuLabel>
        {semNomes ? (
          <DropdownMenuItem onSelect={() => pedirPermissao("audio", aparelhos.reler)}>{TEXTO_PERMITIR}</DropdownMenuItem>
        ) : (
          mics.map((d, i) => (
            <ItemAparelho key={d.deviceId} marcado={d.deviceId === micAtual} onSelect={() => salvar(controle, { ...controle.escolha, micId: d.deviceId }, aparelhos)}>
              {rotuloAparelho(d, i)}
            </ItemAparelho>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Alto-falante</DropdownMenuLabel>
        {!escolheSaida || !temNomes(saidas) ? (
          <>
            <ItemAparelho marcado onSelect={() => undefined}>Padrão do sistema</ItemAparelho>
            {!escolheSaida && <p className="px-2 pb-1 text-[11px] text-muted-foreground">Este navegador não deixa escolher o alto-falante aqui: o som sai pela saída escolhida no macOS.</p>}
          </>
        ) : (
          saidas.map((d, i) => (
            <ItemAparelho key={d.deviceId} marcado={d.deviceId === saidaAtual} onSelect={() => salvar(controle, { ...controle.escolha, saidaId: d.deviceId }, aparelhos)}>
              {rotuloAparelho(d, i)}
            </ItemAparelho>
          ))
        )}
        {controle.onConfig && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={controle.onConfig}>Configurações de áudio…</DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <Ajuda texto={AJUDA_AUDIO} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MenuCamera({ controle, aparelhos }: { controle: ControleAparelhos; aparelhos: Aparelhos }) {
  const { cameras } = aparelhos;
  const semNomes = !temNomes(cameras);
  const atual = aparelhoAtual(cameras, controle.escolha.cameraId);
  return (
    <DropdownMenu modal={false}>
      <Setinha rotulo="Opções de vídeo" />
      <DropdownMenuContent side="top" align="start" className="w-80" data-testid="menu-camera">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Câmera</DropdownMenuLabel>
        {semNomes ? (
          <DropdownMenuItem onSelect={() => pedirPermissao("video", aparelhos.reler)}>{TEXTO_PERMITIR}</DropdownMenuItem>
        ) : (
          cameras.map((d, i) => (
            <ItemAparelho
              key={d.deviceId}
              marcado={d.deviceId === atual}
              onSelect={() => {
                salvarCamera(d.deviceId);
                salvar(controle, { ...controle.escolha, cameraId: d.deviceId }, aparelhos);
              }}
            >
              {rotuloAparelho(d, i)}
            </ItemAparelho>
          ))
        )}
        {controle.onDesfocar && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="justify-between"
              role="menuitemcheckbox"
              aria-checked={!!controle.desfocar}
              onSelect={(e) => {
                e.preventDefault(); // o menu fica aberto para ver o efeito
                const v = !controle.desfocar;
                controle.onDesfocar?.(v);
                if (controle.usuario !== undefined) salvarPrefs(controle.usuario, { desfocar: v });
              }}
            >
              Desfocar meu plano de fundo
              <Switch checked={!!controle.desfocar} tabIndex={-1} aria-hidden className="pointer-events-none" />
            </DropdownMenuItem>
          </>
        )}
        {controle.onConfig && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={controle.onConfig}>Configurações de vídeo…</DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <Ajuda texto={AJUDA_VIDEO} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
