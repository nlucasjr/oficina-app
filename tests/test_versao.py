"""Testa o aviso de versão nova e a trava de compatibilidade com um Supabase simulado."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8129', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8129/'

FAKE = """(rows) => {
  // tabela registros em memória, com a mesma forma de consulta usada pelo app
  window.__tab = new Map(rows.map(r => [r.tipo + '|' + r.id, r]));
  window.__ups = []; window.__dels = [];
  const q = () => {
    const f = {};
    const o = {
      eq(k, v) { f[k] = v; return o; },
      range: async () => ({ data: JSON.parse(JSON.stringify([...__tab.values()])), error: null }),
      then(res, rej) { return Promise.resolve({ data: [...__tab.values()].filter(r => Object.entries(f).every(([k, v]) => r[k] === v)).map(r => ({ data: r.data })), error: null }).then(res, rej); },
    };
    return o;
  };
  cloud.sb = { from: () => ({
    select: () => q(),
    upsert: async (x) => { for (const r of [].concat(x)) { __ups.push(r.tipo + '|' + r.id); __tab.set(r.tipo + '|' + r.id, r); } return { error: null }; },
    delete: () => ({ match: async (m) => { __dels.push(m.tipo + '|' + m.id); __tab.delete(m.tipo + '|' + m.id); return { error: null }; } }),
  }) };
}"""
ROWS = [{'tipo': 'clientes', 'id': 'c1', 'data': {'id': 'c1', 'nome': 'João', 'telefone': '67 9999', 'endereco': ''}},
        {'tipo': 'config', 'id': 'main', 'data': {'nome': 'Mecânica Rodrigues'}}]
INICIAR = """async () => { cloud.apply(await cloud.pull()); cloud.on = true; render(); cloud.checarCompat(); await new Promise(r => setTimeout(r, 150)); }"""

ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

def pagina(b, versao_site=4, site_url=None):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        service_workers='block', locale='pt-BR')
    ctx.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    cfg = {'siteUrl': site_url} if site_url else {}
    ctx.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG=%s;' % json.dumps(cfg)))
    ctx.route('**/version.json*', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'versionCode': versao_site, 'versionName': '9.9.9', 'versao': versao_site})))
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '#clientes'); pg.wait_for_selector('#main h1')
    return pg, errs

def tab(pg, k): return pg.evaluate(f"__tab.get('{k}')?.data")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    # ---------- aviso de versão nova ----------
    import re
    APP = int(re.search(r'const VERSION_CODE = (\d+);', open(ROOT + '/app.js', encoding='utf-8').read()).group(1))
    NOME = re.search(r'"versionName": "([^"]+)"', open(ROOT + '/version.json', encoding='utf-8').read()).group(1)
    COMPAT = int(re.search(r'const COMPAT_MINIMA = (\d+);', open(ROOT + '/app.js', encoding='utf-8').read()).group(1))
    pg, errs = pagina(b, versao_site=APP)
    pg.evaluate('verificarAtualizacao()'); pg.wait_for_timeout(300)
    check('site com a mesma versão: sem aviso', pg.locator('#upd').count() == 0)
    pg, errs = pagina(b, versao_site=APP + 1)
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(400)
    check('site com versão mais nova: mostra o aviso', pg.locator('#upd').count() == 1 and 'Nova versão' in pg.inner_text('#upd'))
    pg.screenshot(path=f'{OUT}/aviso.png')
    with pg.expect_navigation(): pg.click('#upd [data-act="atualizarApp"]')
    check('botão Atualizar recarrega o app', pg.url.startswith(BASE))

    # ---------- versão mínima: só o site oficial sobe ----------
    pg, errs = pagina(b)
    pg.evaluate(FAKE, ROWS); pg.evaluate(INICIAR)
    check('testando fora do site oficial: não grava versão mínima', tab(pg, 'sistema|versao') is None and pg.evaluate('__ups') == [])

    pg, errs = pagina(b, site_url=BASE)
    pg.evaluate(FAKE, ROWS); pg.evaluate(INICIAR)
    check('versão publicada no site oficial grava a versão mínima', tab(pg, 'sistema|versao') == {'minima': COMPAT, 'app': APP, 'versao': NOME}, tab(pg, 'sistema|versao'))
    pg.evaluate("db.clientes[0].nome = 'João Pereira'; save()"); pg.wait_for_timeout(800)
    check('app compatível continua gravando normalmente', 'clientes|c1' in pg.evaluate('__ups') and not pg.evaluate('cloud.bloqueado'))
    pg.evaluate("db.clientes = []; save()"); pg.wait_for_timeout(800)
    check('apagar registros não apaga a linha da versão mínima', 'sistema|versao' not in pg.evaluate('__dels') and tab(pg, 'sistema|versao'))
    check('sem erros de JavaScript', not errs, errs)

    # ---------- app desatualizado ao abrir ----------
    pg, errs = pagina(b)
    pg.evaluate(FAKE, ROWS + [{'tipo': 'sistema', 'id': 'versao', 'data': {'minima': APP + 1}}]); pg.evaluate(INICIAR)
    check('banco exige versão mais nova: bloqueia ao abrir', pg.locator('#bloqueio').count() == 1 and pg.evaluate('cloud.bloqueado'))
    check('status mostra "App desatualizado"', 'desatualizado' in pg.inner_text('#syncStatus'))
    pg.evaluate("db.clientes[0].nome = 'Alterado'; save()"); pg.wait_for_timeout(800)
    check('app bloqueado não grava nada', pg.evaluate('__ups') == [] and tab(pg, 'clientes|c1')['nome'] == 'João')
    pg.screenshot(path=f'{OUT}/bloqueio.png')

    # ---------- fica desatualizado durante o uso ----------
    pg, errs = pagina(b)
    pg.evaluate(FAKE, ROWS + [{'tipo': 'sistema', 'id': 'versao', 'data': {'minima': COMPAT}}]); pg.evaluate(INICIAR)
    check('banco com a versão mínima igual: não bloqueia', pg.locator('#bloqueio').count() == 0)
    pg.evaluate("__tab.set('sistema|versao', { tipo: 'sistema', id: 'versao', data: { minima: 99 } })")  # outra pessoa abriu a versão nova
    pg.click('[data-act="novoCliente"]'); pg.wait_for_selector('#mf')
    pg.fill('#mf [name="nome"]', 'Maria'); pg.fill('#mf [name="telefone"]', '67 98888'); pg.click('#mf .btn.primary')
    pg.wait_for_timeout(900)
    check('antes de gravar confere a versão e bloqueia sem enviar', pg.evaluate('__ups') == [] and pg.locator('#bloqueio').count() == 1,
          pg.evaluate('__ups'))
    # atualização automática também percebe
    pg, errs = pagina(b)
    pg.evaluate(FAKE, ROWS); pg.evaluate(INICIAR)
    pg.evaluate("__tab.set('sistema|versao', { tipo: 'sistema', id: 'versao', data: { minima: 99 } })")
    pg.evaluate('cloud.refresh()'); pg.wait_for_timeout(300)
    check('atualização automática também bloqueia', pg.locator('#bloqueio').count() == 1)
    check('sem erros de JavaScript', not errs, errs)
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
