const EMAIL = "suporte@dominio.com";

export default function Termos() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-4 py-10 sm:py-16 space-y-8 leading-relaxed">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Termos de Serviço</h1>
          <p className="text-sm text-muted-foreground">Última atualização: 21 de outubro de 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Quem somos</h2>
          <p>
            Estes termos valem para o Sistema BX, o CRM de atendimento disponível em equipe.brenoxavier.com.br, operado por
            BRENO XAVIER BG FITNESS LTDA, CNPJ 63.702.235/0001-45. Contato:{" "}
            <a className="underline" href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">O que é o serviço</h2>
          <p>
            O Sistema BX é uma ferramenta interna usada pela nossa equipe para atender pessoas que falam com a gente pelo
            Instagram, pelo Facebook, pelo WhatsApp e pelos formulários das nossas páginas, e para acompanhar o resultado dos
            nossos anúncios na Meta. O acesso ao painel é restrito a pessoas autorizadas pela empresa.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Conexão com contas da Meta</h2>
          <p>
            Quando uma conta profissional do Instagram, uma Página do Facebook ou um número de WhatsApp Business é conectado ao
            sistema, o titular autoriza a leitura e o envio de mensagens dessa conta, a leitura de dados básicos de perfil e a
            consulta de métricas de anúncios, sempre dentro das permissões concedidas na tela de autorização da Meta. A conexão
            pode ser desfeita a qualquer momento nas configurações da própria conta (Apps e sites) ou pedindo por e-mail.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Uso aceitável</h2>
          <p>
            Quem usa o painel se compromete a usá-lo apenas para o atendimento da empresa, a não enviar mensagens em massa não
            solicitadas e a respeitar as políticas da Meta e a legislação brasileira, incluindo a LGPD.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Dados pessoais</h2>
          <p>
            O tratamento de dados pessoais segue a nossa{" "}
            <a className="underline" href="/privacidade">Política de Privacidade</a>. Para pedir a exclusão dos seus dados, veja{" "}
            <a className="underline" href="/exclusao-de-dados">Exclusão de dados</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Limitações</h2>
          <p>
            O serviço depende de plataformas de terceiros, como a Meta e provedores de hospedagem, e pode ficar indisponível
            quando elas estiverem fora do ar ou mudarem suas regras. Podemos atualizar estes termos; a data no topo indica a
            versão vigente.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Foro</h2>
          <p>Estes termos seguem a legislação brasileira.</p>
        </section>
      </article>
    </main>
  );
}
