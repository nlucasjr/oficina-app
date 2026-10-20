"""Testa o supabase.sql num PostgreSQL de verdade, imitando os papéis do Supabase
(anon = visitante sem login, authenticated = usuário logado).
Precisa do psql e de um PostgreSQL; sem eles, o teste é pulado.
Conexão pelas variáveis padrão: PGHOST, PGPORT, PGUSER, PGPASSWORD."""
import os, shutil, subprocess, sys

ROOT = sys.argv[1]
SQL = os.path.join(ROOT, 'supabase.sql')
BANCO = 'oficina_teste'
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

def psql(sql=None, arquivo=None, banco=BANCO, papel=None):
    cmd = ['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', banco]
    entrada = (f'set role {papel};\n' if papel else '') + (sql or '')
    if arquivo:
        cmd += ['-f', arquivo]
        entrada = None
    r = subprocess.run(cmd, input=entrada, capture_output=True, text=True, timeout=60)
    return r.returncode == 0, (r.stdout + r.stderr).strip()

if not shutil.which('psql') or not psql('select 1', banco='postgres')[0]:
    print('pulado: PostgreSQL não disponível (no GitHub Actions ele roda sempre)')
    sys.exit(0)

psql(f'drop database if exists {BANCO}', banco='postgres')
check('cria o banco de teste', psql(f'create database {BANCO}', banco='postgres')[0])
psql("""do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;""")
psql('grant usage on schema public to anon, authenticated')

ok1, log1 = psql(arquivo=SQL)
ok2, log2 = psql(arquivo=SQL)
check('supabase.sql roda sem erro', ok1, log1[-400:])
check('supabase.sql pode ser rodado de novo (sem perder nada)', ok2, log2[-400:])
check('RLS ligado na tabela registros', psql("select relrowsecurity from pg_class where oid = 'public.registros'::regclass")[1] == 't')

# usuário logado: lê e grava
ok, log = psql("""insert into registros(tipo, id, data) values ('clientes', 'c1', '{"nome": "João"}');
  update registros set data = '{"nome": "João Pereira"}' where tipo = 'clientes' and id = 'c1';
  select data->>'nome' from registros where id = 'c1';""", papel='authenticated')
check('usuário logado grava, altera e lê', ok and log.endswith('João Pereira'), log)
ok, log = psql("delete from registros where id = 'c1'; select count(*) from registros where id = 'c1';", papel='authenticated')
check('usuário logado apaga', ok and log.endswith('0'), log)
psql("""insert into registros(tipo, id, data) values ('clientes', 'c2', '{"nome": "Maria"}')""", papel='authenticated')

# visitante sem login: nada
ok, log = psql('select count(*) from registros', papel='anon')
check('visitante sem login não lê', not ok and 'permission denied' in log, log)
ok, log = psql("insert into registros(tipo, id, data) values ('clientes', 'x', '{}')", papel='anon')
check('visitante sem login não grava', not ok and 'permission denied' in log, log)

# rodar de novo não apaga dados atuais; limpa só o que era da versão antiga
psql("""insert into registros(tipo, id, data) values ('orcamentos', 'o1', '{}'), ('pecas', 'p1', '{}')""")
ok, log = psql(arquivo=SQL)
contagem = psql("select string_agg(tipo || ':' || id, ',' order by tipo, id) from registros")[1]
check('rodar de novo mantém os dados e remove orçamentos/peças antigos', ok and contagem == 'clientes:c2', contagem)

psql(f'drop database if exists {BANCO}', banco='postgres')
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if ok_all else 1)
