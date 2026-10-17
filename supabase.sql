-- Rode uma vez no Supabase: SQL Editor > New query > colar > Run.
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
