-- O que a aluna achou da tela de substituições, respondido logo depois que ela
-- conseguiu a troca. A tela é pública (ela não faz login pra trocar um
-- alimento), então o insert é aberto e a leitura é só de quem está logado.
create table if not exists public.feedback_substituicoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  -- de 0 a 10, o quanto a troca ajudou
  nota integer not null check (nota between 0 and 10),
  -- o que ela procurou e não achou
  nao_achou text,
  -- o que ela mudaria
  sugestao text,
  -- em que parte da tela ela estava
  modo text check (modo in ('alimento', 'refeicao')),
  -- o alimento (ou o prato) que ela trocou, e o que a tela devolveu
  alimentos text[],
  trocas text[]
);

create index if not exists feedback_substituicoes_criado_em_idx
  on public.feedback_substituicoes (criado_em desc);

alter table public.feedback_substituicoes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'feedback_substituicoes'
      and policyname = 'feedback_substituicoes_insert'
  ) then
    -- qualquer aluna responde, com ou sem login
    create policy feedback_substituicoes_insert
      on public.feedback_substituicoes
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'feedback_substituicoes'
      and policyname = 'feedback_substituicoes_select'
  ) then
    -- só o time lê as respostas
    create policy feedback_substituicoes_select
      on public.feedback_substituicoes
      for select
      to authenticated
      using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
