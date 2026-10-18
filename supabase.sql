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

-- Numeração dos orçamentos feita pelo banco: dois aparelhos salvando ao mesmo
-- tempo nunca recebem o mesmo número. Pode rodar de novo sem problema.
create sequence if not exists public.orcamento_numero_seq;

create or replace function public.proximo_numero_orcamento()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  maior bigint;
  n bigint;
begin
  -- uma chamada por vez
  perform pg_advisory_xact_lock(hashtext('proximo_numero_orcamento'));
  -- nunca devolve um número já usado (orçamentos antigos, backups restaurados etc.)
  select coalesce(max((data->>'numero')::numeric)::bigint, 0) into maior
    from public.registros
   where tipo = 'orcamentos' and (data->>'numero') ~ '^[0-9]+$';
  n := nextval('public.orcamento_numero_seq');
  if n <= maior then
    n := maior + 1;
    perform setval('public.orcamento_numero_seq', n);
  end if;
  return n;
end;
$$;

revoke all on function public.proximo_numero_orcamento() from public, anon;
grant execute on function public.proximo_numero_orcamento() to authenticated;
