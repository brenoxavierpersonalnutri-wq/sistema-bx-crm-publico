import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { limparERecarregar, recuperarDeChunkQueSumiu } from "@/lib/recuperacaoDeChunk";

/**
 * Rede de segurança das telas.
 *
 * Sem ela, qualquer erro de tela derrubava o app inteiro: o React desmonta
 * tudo (tela branca) e, como o erro vinha de um arquivo /assets/*.js, a
 * recuperação de pedaço sumido recarregava a página — a pessoa perdia o que
 * estava fazendo sem entender por quê. Foi o caso da SDR remarcando consulta
 * no celular com o tradutor do Chrome ligado.
 *
 * Aqui a tela que quebrou vira um aviso com "Tentar de novo", que remonta só
 * a tela (login, cache de dados e o resto do app continuam onde estavam).
 * Trocar de rota também limpa o erro, pela `chave`.
 */
interface Props {
    children: ReactNode;
    /** Muda quando a rota muda: tela nova, chance nova. */
    chave?: string;
}

interface Estado {
    erro: Error | null;
    chaveDoErro?: string;
}

export class TelaComErro extends Component<Props, Estado> {
    state: Estado = { erro: null };

    static getDerivedStateFromError(erro: Error): Partial<Estado> {
        return { erro };
    }

    static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
        if (estado.erro && estado.chaveDoErro !== undefined && props.chave !== estado.chaveDoErro) {
            return { erro: null, chaveDoErro: undefined };
        }
        if (estado.erro && estado.chaveDoErro === undefined) {
            return { chaveDoErro: props.chave };
        }
        return null;
    }

    componentDidCatch(erro: Error, info: ErrorInfo) {
        console.error("[TelaComErro]", erro, info.componentStack);
        // Pedaço que sumiu depois de publicar (import preguiçoso que falhou):
        // esse erro agora para aqui e não chega mais à janela, então a
        // recuperação de antes (recarregar, com teto) é chamada daqui.
        recuperarDeChunkQueSumiu(erro?.message ?? "");
    }

    tentarDeNovo = () => this.setState({ erro: null, chaveDoErro: undefined });

    render() {
        if (!this.state.erro) return this.props.children;
        const domQuebrado = ehDomMexidoPorFora(this.state.erro);
        // Camada fixa por cima de tudo: quando o DOM foi mexido por fora (tradutor),
        // o React não consegue tirar a tela velha, e um aviso "normal" ia parar
        // embaixo dela, fora da vista (medido no Chrome headless: y=4023 de 4543).
        return (
            <div
                role="alert"
                className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-4 px-6 text-center"
                // Acima dos portais do Radix (popover/select ficam em z-50 no <body>
                // e, órfãos, continuariam por cima do aviso).
                style={{ zIndex: 2147483000 }}
            >
                <div className="space-y-1 max-w-sm">
                    <p className="font-semibold">Esta tela teve um problema</p>
                    <p className="text-sm text-muted-foreground">
                        {domQuebrado
                            ? "Parece que o tradutor do navegador mexeu na página. Se aparecer \"Página traduzida\", toque em \"Desfazer\" ou desligue a tradução deste site, e recarregue."
                            : "Tente de novo. Se continuar, recarregue a página."}
                    </p>
                </div>
                <div className="flex gap-2">
                    {/* Com o DOM mexido, remontar só empilharia uma tela nova sob a velha. */}
                    {!domQuebrado && <Button onClick={this.tentarDeNovo}>Tentar de novo</Button>}
                    {/* Pedaço do app com HTML no cache: limpa antes, senão recarregar traz o mesmo erro. */}
                    <Button
                        variant={domQuebrado ? "default" : "outline"}
                        onClick={() => limparERecarregar(this.state.erro?.message ?? "")}
                    >
                        Recarregar
                    </Button>
                </div>
            </div>
        );
    }
}

/** O erro que o React lança quando alguém de fora (tradutor, extensão) trocou nós que eram dele. */
export function ehDomMexidoPorFora(erro: unknown): boolean {
    const e = erro as { name?: unknown; message?: unknown } | null;
    const nome = typeof e?.name === "string" ? e.name : "";
    const msg = typeof e?.message === "string" ? e.message : "";
    return (
        nome === "NotFoundError" ||
        /removeChild|insertBefore|not a child of this node/i.test(msg)
    );
}
