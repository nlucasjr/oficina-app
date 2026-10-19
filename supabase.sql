-- Rode no Supabase: SQL Editor > New query > colar > Run.
-- Pode ser rodado de novo a qualquer momento sem perder dados;
-- faça isso sempre que este arquivo mudar.

-- Cada cliente, veículo e serviço é uma linha desta tabela (dados em JSON).
create table if not exists public.registros (
  tipo text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tipo, id)
);

alter table public.registros enable row level security;

-- Só usuários logados (criados por você no painel) leem e gravam.
drop policy if exists "usuarios logados" on public.registros;
create policy "usuarios logados" on public.registros
  for all to authenticated using (true) with check (true);

revoke all on public.registros from anon;
grant select, insert, update, delete on public.registros to authenticated;

-- ---------------------------------------------------------------------
-- Limpeza da versão anterior do app: orçamentos, peças, numeração e link
-- de aprovação para o cliente não existem mais.
-- ---------------------------------------------------------------------
delete from public.registros where tipo in ('orcamentos', 'pecas');
drop trigger if exists preservar_resposta_cliente on public.registros;
drop function if exists public.preservar_resposta_cliente();
drop function if exists public.responder_orcamento(text, boolean, text);
drop function if exists public.orcamento_publico(text);
drop function if exists public.orcamento_visao_cliente(public.registros);
drop index if exists public.registros_orcamento_token_idx;
drop function if exists public.proximo_numero_orcamento();
drop sequence if exists public.orcamento_numero_seq;
