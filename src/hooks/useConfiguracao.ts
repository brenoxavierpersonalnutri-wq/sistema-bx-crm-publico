import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { comLimiteDeTempo, textoDeErro } from "@/lib/chamadaAoBanco";

/**
 * Lê e grava uma configuração de `app_settings`.
 *
 * A parte chata — carregar, gravar, saber se deu certo — é igual pra toda
 * configuração; o que muda de uma pra outra é a validação e o texto da tela.
 * Então isto cuida só da ida ao banco.
 *
 * Quem grava precisa ser admin: a política da tabela libera leitura pra todo
 * mundo e escrita só pra admin. Por isso `podeEditar` vem daqui — mostrar o
 * campo editável pra quem não pode salvar só produz um erro de permissão que
 * a pessoa não sabe interpretar.
 */
export function useConfiguracao(chave: string) {
    const { isAdmin } = useAuth();
    const [valorSalvo, setValorSalvo] = useState("");
    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    useEffect(() => {
        let cancelado = false;

        comLimiteDeTempo(
            Promise.resolve(
                supabase.from("app_settings").select("value").eq("key", chave).maybeSingle(),
            ),
        )
            .then(({ data, error }) => {
                if (cancelado) return;
                if (error) setErro(textoDeErro(error, "Não consegui carregar esta configuração"));
                setValorSalvo(data?.value ?? "");
            })
            .catch((e: unknown) => {
                if (!cancelado) setErro(textoDeErro(e, "Não consegui carregar esta configuração"));
            })
            .finally(() => {
                if (!cancelado) setCarregando(false);
            });

        return () => {
            cancelado = true;
        };
    }, [chave]);

    /** Grava e devolve o erro em texto, ou null quando deu certo. */
    const salvar = useCallback(
        async (valor: string): Promise<string | null> => {
            setSalvando(true);
            try {
                const { error } = await comLimiteDeTempo(
                    Promise.resolve(
                        supabase
                            .from("app_settings")
                            .upsert({ key: chave, value: valor }, { onConflict: "key" }),
                    ),
                );
                if (error) return textoDeErro(error, "Não consegui salvar");
                setValorSalvo(valor);
                return null;
            } catch (e: unknown) {
                return textoDeErro(e, "Não consegui salvar");
            } finally {
                setSalvando(false);
            }
        },
        [chave],
    );

    return { valorSalvo, carregando, salvando, erro, salvar, podeEditar: isAdmin };
}
