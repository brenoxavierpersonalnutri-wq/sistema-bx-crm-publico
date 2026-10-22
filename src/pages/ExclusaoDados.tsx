const EMAIL = "suporte@dominio.com";

export default function ExclusaoDados() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-4 py-10 sm:py-16 space-y-8 leading-relaxed">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Exclusão de dados</h1>
          <p className="text-sm text-muted-foreground">Última atualização: 21 de outubro de 2026</p>
        </header>

        <section className="space-y-3">
          <p>
            Você pode pedir a exclusão dos dados que o Sistema BX (equipe.brenoxavier.com.br), operado por BRENO XAVIER BG
            FITNESS LTDA, CNPJ 63.702.235/0001-45, guarda sobre você: mensagens e mídias trocadas pelo Instagram, Facebook ou
            WhatsApp, dados de perfil (nome, @usuário, identificador da conta, foto) e o que você preencheu nos nossos
            formulários.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Como pedir</h2>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              Envie um e-mail para <a className="underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> com o assunto “Exclusão de
              dados”, informando o @ do Instagram, o nome da Página ou o número de WhatsApp usado para falar com a gente.
            </li>
            <li>
              Se você conectou uma conta ao nosso app, também pode removê-lo no Instagram ou no Facebook em Configurações, Apps e
              sites. Isso revoga o acesso na hora e gera um pedido automático de exclusão.
            </li>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">O que acontece depois</h2>
          <p>
            Confirmamos o recebimento por e-mail e concluímos a exclusão em até 15 dias. Os tokens de acesso são apagados assim que
            a conta é desconectada. Podemos manter apenas o que a lei nos obriga a guardar, como registros fiscais de compras, pelo
            prazo legal.
          </p>
        </section>

        <p className="text-sm text-muted-foreground">
          Mais detalhes na <a className="underline" href="/privacidade">Política de Privacidade</a>.
        </p>
      </article>
    </main>
  );
}
