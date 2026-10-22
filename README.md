# Sistema BX (CRM) — cópia pública

O Sistema BX é o CRM que o Breno Xavier usa na operação de consultoria fitness: funil de leads e formulários de
qualificação, agenda de avaliações, CRM de WhatsApp (conversas, fluxos, grupos e agentes de IA), Instagram Direct,
checkout e webhooks de pagamento, rotador de páginas com métricas da Meta, lives e webinars, e painéis de vendas.

## Stack

- Front: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, React Router
- Back: Supabase (PostgreSQL, RLS, migrations em `supabase/migrations`) e Edge Functions em Deno (`supabase/functions`)
- Cloudflare Pages Functions (`functions/`)
- Serviços de apoio em VPS (`infra/`): proxy de WhatsApp (OpenWA), LiveKit, integrações Instagram, Google e Zernio
- Testes: Vitest e testes SQL (`supabase/tests`)

## O que é esta cópia

É um snapshot educacional do código em 22/10/2026, publicado sem histórico de commits e sem dados:

- nenhuma chave, token ou `.env` (use o `.env.example` e configure os secrets no seu projeto);
- IDs de projeto Supabase, endereço da VPS, contas de anúncio, pixel, templates e grupos trocados por placeholders;
- telefones e e-mails trocados por valores fictícios;
- fotos de pessoas reais e prints de painel retirados (veja os arquivos `IMAGENS-RETIRADAS.md`);
- os workflows do GitHub Actions ficam desligados em `docs/github-workflows-exemplo/` (copie para `.github/workflows/` se quiser usar).

Não há suporte nem garantia de funcionamento: para rodar, você precisa do seu próprio projeto Supabase, aplicar as
migrations e configurar as integrações.

```sh
npm install
cp .env.example .env   # preencha com os dados do seu projeto
npm run dev
```
