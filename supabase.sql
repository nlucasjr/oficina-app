-- Rode no Supabase: SQL Editor > New query > colar > Run.
-- Pode ser rodado de novo a qualquer momento sem perder dados;
-- faça isso sempre que este arquivo mudar.
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

-- =====================================================================
-- Link de aprovação para o cliente (página orcamento.html, sem login).
-- Cada orçamento tem um código secreto em data->>'token'. Quem tem o link
-- vê SÓ aquele orçamento (sem custos internos) e pode aprovar ou recusar.
-- A tabela continua fechada para visitantes: eles só usam estas funções.
-- =====================================================================
create index if not exists registros_orcamento_token_idx
  on public.registros ((data->>'token')) where tipo = 'orcamentos';

-- O que o cliente pode ver de um orçamento (uso interno das funções abaixo)
create or replace function public.orcamento_visao_cliente(r public.registros)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'numero', r.data->'numero', 'data', r.data->'data', 'validade', r.data->'validade',
    'status', coalesce(r.data->'status', '"aberto"'), 'km', r.data->'km',
    'problema', r.data->'problema', 'obs', r.data->'obs', 'desconto', r.data->'desconto',
    'pagamento', r.data->'pagamento', 'prazo', r.data->'prazo', 'resposta', r.data->'resposta',
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', i->'tipo', 'descricao', i->'descricao',
               'qtd', i->'qtd', 'valor', i->'valor', 'unidade', i->'unidade') order by n)
        from jsonb_array_elements(case when jsonb_typeof(r.data->'itens') = 'array'
                                       then r.data->'itens' else '[]'::jsonb end)
             with ordinality as t(i, n)), '[]'::jsonb),
    'cliente', (select jsonb_build_object('nome', c.data->'nome')
                  from public.registros c where c.tipo = 'clientes' and c.id = r.data->>'clienteId'),
    'veiculo', (select jsonb_build_object('placa', v.data->'placa', 'marca', v.data->'marca',
                         'modelo', v.data->'modelo', 'ano', v.data->'ano', 'cor', v.data->'cor')
                  from public.registros v where v.tipo = 'veiculos' and v.id = r.data->>'veiculoId'),
    'oficina', (select jsonb_build_object('nome', o.data->'nome', 'cnpj', o.data->'cnpj',
                         'telefone', o.data->'telefone', 'email', o.data->'email',
                         'endereco', o.data->'endereco', 'rodape', o.data->'rodape')
                  from public.registros o where o.tipo = 'config' and o.id = 'main'),
    'hoje', to_jsonb((now() at time zone 'America/Campo_Grande')::date)
  );
$$;
revoke all on function public.orcamento_visao_cliente(public.registros) from public, anon, authenticated;

-- Ver o orçamento pelo link
create or replace function public.orcamento_publico(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.registros;
begin
  if p_token is null or length(p_token) < 20 then
    return null;
  end if;
  select * into r from public.registros
   where tipo = 'orcamentos' and data->>'token' = p_token
   limit 1;
  if not found then
    return null;
  end if;
  return public.orcamento_visao_cliente(r);
end;
$$;

-- Aprovar ou recusar pelo link. Devolve {"ok": true, "orcamento": {...}}
-- ou {"erro": "nao_encontrado" | "ja_respondido" | "vencido", "orcamento": {...}}
create or replace function public.responder_orcamento(p_token text, p_aprovar boolean, p_nome text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r public.registros;
  hoje date := (now() at time zone 'America/Campo_Grande')::date;
  acao text := case when p_aprovar then 'aprovado' else 'recusado' end;
begin
  if p_token is null or length(p_token) < 20 or p_aprovar is null then
    return jsonb_build_object('erro', 'nao_encontrado');
  end if;
  select * into r from public.registros
   where tipo = 'orcamentos' and data->>'token' = p_token
   limit 1
   for update;
  if not found then
    return jsonb_build_object('erro', 'nao_encontrado');
  end if;
  if coalesce(r.data->>'status', 'aberto') <> 'aberto' then
    return jsonb_build_object('erro', 'ja_respondido', 'orcamento', public.orcamento_visao_cliente(r));
  end if;
  if (r.data->>'validade') ~ '^\d{4}-\d{2}-\d{2}$' and (r.data->>'validade')::date < hoje then
    return jsonb_build_object('erro', 'vencido', 'orcamento', public.orcamento_visao_cliente(r));
  end if;
  update public.registros
     set data = data || jsonb_build_object(
           'status', acao,
           'resposta', jsonb_build_object(
             'acao', acao,
             'nome', nullif(left(btrim(coalesce(p_nome, '')), 80), ''),
             'em', now())),
         updated_at = now()
   where tipo = r.tipo and id = r.id
   returning * into r;
  return jsonb_build_object('ok', true, 'orcamento', public.orcamento_visao_cliente(r));
end;
$$;

revoke all on function public.orcamento_publico(text) from public;
revoke all on function public.responder_orcamento(text, boolean, text) from public;
grant execute on function public.orcamento_publico(text) to anon, authenticated;
grant execute on function public.responder_orcamento(text, boolean, text) to anon, authenticated;

-- Protege a resposta do cliente: se o app salvar uma cópia antiga do
-- orçamento (sem a resposta ou sem o código do link), mantém o que já
-- estava no banco em vez de apagar.
create or replace function public.preservar_resposta_cliente()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo = 'orcamentos' then
    if old.data ? 'token' and not (new.data ? 'token') then
      new.data := new.data || jsonb_build_object('token', old.data->'token');
    end if;
    if old.data ? 'resposta' and not (new.data ? 'resposta') then
      new.data := new.data || jsonb_build_object('resposta', old.data->'resposta');
      if coalesce(new.data->>'status', 'aberto') = 'aberto' then
        new.data := new.data || jsonb_build_object('status', old.data->'status');
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists preservar_resposta_cliente on public.registros;
create trigger preservar_resposta_cliente
  before update on public.registros
  for each row execute function public.preservar_resposta_cliente();
