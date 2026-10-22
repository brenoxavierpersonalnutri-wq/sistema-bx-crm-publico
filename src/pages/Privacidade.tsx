import { useSearchParams } from "react-router-dom";

const EMAIL = "suporte@dominio.com";
const URL_EXCLUSAO = "https://SEU_PROJECT_REF.supabase.co/functions/v1/instagram-oauth?evento=excluir";

function codigoValido(bruto: string | null): string | null {
  if (!bruto) return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(bruto) ? bruto : null;
}

export default function Privacidade() {
  const [params] = useSearchParams();
  const codigo = codigoValido(params.get("pedido"));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-4 py-10 sm:py-16 space-y-8 leading-relaxed">
        {codigo && (
          <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm sm:text-base">
            Recebemos seu pedido de exclusão de dados. Código de confirmação: <strong className="break-all">{codigo}</strong>.
            Os dados ligados ao seu Instagram foram desvinculados e o token de acesso apagado; o histórico restante é removido em até 15 dias.
          </div>
        )}

        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground">Última atualização: 21 de outubro de 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Quem somos</h2>
          <p>
            Esta política vale para o Sistema BX, o CRM de atendimento da equipe de Breno Xavier, disponível em
            equipe.brenoxavier.com.br. O responsável pelo tratamento dos dados descritos aqui é BRENO XAVIER BG FITNESS LTDA,
            CNPJ 63.702.235/0001-45. Para qualquer
            assunto de privacidade, fale com a gente pelo e-mail{" "}
            <a className="underline" href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Quais dados coletamos</h2>
          <p>Coletamos apenas o que chega até nós quando você fala com a equipe ou preenche algo em nossas páginas.</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Formulários do site: os dados que você mesmo digita, como nome, telefone, e-mail e respostas.</li>
            <li>WhatsApp: número, nome, mensagens e mídias trocadas com a equipe.</li>
            <li>
              Instagram Direct, por meio da Instagram API with Instagram Login: o identificador da sua conta (IGSID), o @usuário,
              o nome, a foto de perfil, e as mensagens e mídias trocadas no Direct com a conta profissional conectada.
            </li>
            <li>Facebook: mensagens trocadas com a nossa Página e dados básicos do perfil de quem fala com ela.</li>
            <li>Anúncios da Meta: métricas das nossas próprias campanhas (alcance, cliques, custos e conversões), sem dados individuais de quem viu o anúncio.</li>
            <li>Dados técnicos mínimos, como data e hora de acesso e informações do navegador, necessários para o sistema funcionar com segurança.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Para que usamos</h2>
          <p>
            Usamos os dados para responder você, organizar o atendimento, manter o histórico da conversa e fazer agendamentos.
            Não vendemos dados pessoais e não os usamos para publicidade de terceiros.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Com quem compartilhamos</h2>
          <p>
            Compartilhamos apenas o necessário com operadores de infraestrutura: o Supabase, para banco de dados e funções; a Meta
            Platforms, por onde passam as mensagens de Instagram e WhatsApp; e provedores de hospedagem do site. Eles tratam os
            dados somente para prestar o serviço a nós.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Por quanto tempo guardamos</h2>
          <p>
            Guardamos os dados enquanto houver relação de atendimento ou até você pedir a exclusão. Os tokens de acesso do Instagram
            ficam guardados de forma cifrada e são apagados quando a conta é desconectada ou quando a Meta avisa que a autorização
            foi removida.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Segurança</h2>
          <p>
            Adotamos medidas técnicas e organizacionais para proteger os dados: acesso restrito à equipe, conexões protegidas e
            credenciais cifradas. Nenhum sistema é totalmente imune a falhas, e por isso limitamos o que coletamos ao necessário.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Seus direitos (LGPD)</h2>
          <p>
            Pela Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode pedir acesso aos seus dados, correção de dados
            incorretos, exclusão e revogação de qualquer consentimento dado. Basta escrever para{" "}
            <a className="underline" href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          </p>
        </section>

        <section className="space-y-3" id="exclusao">
          <h2 className="text-xl font-semibold">Como pedir a exclusão dos seus dados</h2>
          <p>Há dois caminhos, e o prazo de atendimento é de até 15 dias.</p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              Por e-mail: escreva para <a className="underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> com o assunto
              “Exclusão de dados”.
            </li>
            <li>
              Pelo próprio Instagram: vá em Configurações, Apps e sites, e remova o aplicativo. Isso dispara um pedido automático de
              exclusão para o endereço <span className="break-all">{URL_EXCLUSAO}</span>. Você recebe um código de confirmação
              para acompanhar o pedido.
            </li>
          </ol>
        </section>
      </article>
    </main>
  );
}
