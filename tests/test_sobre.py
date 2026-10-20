"""Testa o quadro 'Sobre o app' na tela Ajustes."""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8130', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8130/'
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    estado = {'v': None, 'offline': False}
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        service_workers='block', locale='pt-BR')
    ctx.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    ctx.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    def ver(r):
        if estado['offline']: return r.abort()
        if estado['v'] is None: return r.continue_()  # arquivo real do projeto
        r.fulfill(status=200, content_type='application/json', body=json.dumps({'versionCode': estado['v'], 'versionName': '1.7.2', 'versao': estado['v']}))
    ctx.route('**/version.json*', ver)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '#config'); pg.wait_for_selector('#appVersao')
    vj = json.load(open(ROOT + '/version.json', encoding='utf-8'))
    check(f"Ajustes mostra a versão {vj['versionName']} e o código {vj['versionCode']}", pg.inner_text('#appVersao') == vj['versionName'] and f"(código {vj['versionCode']})" in pg.inner_text('#main'), pg.inner_text('#main')[-120:])
    nome, codigo = pg.evaluate('VERSION_NAME'), pg.evaluate('VERSION_CODE')
    check('versionName = dígitos do versionCode (ex.: 119 -> 1.1.9)', nome == '.'.join(str(codigo).zfill(3)) and vj['versionName'] == '.'.join(str(vj['versionCode']).zfill(3)), (nome, codigo, vj))
    exemplos = pg.evaluate("[119, 120, 199, 200, 201, 1000].map(nomeDaVersao)")
    check('regra de nomes: 119=1.1.9, 120=1.2.0, 199=1.9.9, 200=2.0.0', exemplos == ['1.1.9', '1.2.0', '1.9.9', '2.0.0', '2.0.1', '10.0.0'], exemplos)
    check('app.js e version.json combinam (nome, código e campo antigo)', (pg.evaluate('VERSION_NAME'), pg.evaluate('VERSION_CODE')) == (vj['versionName'], vj['versionCode']) and vj['versao'] == vj['versionCode'], vj)
    check('mostra onde ficam os dados', 'Só neste aparelho' in pg.inner_text('#main'))
    pg.click('[data-act="procurarAtualizacao"]'); pg.wait_for_timeout(400)
    check('procurar atualização: já está na mais recente', f"versão mais recente ({vj['versionName']})" in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.screenshot(path=OUT + '/ajustes.png')
    # versão antiga do app só lê "versao": o campo continua no version.json
    check('version.json mantém o campo antigo para versões anteriores', 'versao' in vj)
    estado['offline'] = True
    pg.click('[data-act="procurarAtualizacao"]'); pg.wait_for_timeout(400)
    check('sem internet: avisa que não deu para verificar', 'Não foi possível verificar' in pg.inner_text('#toast'))
    estado['offline'] = False; estado['v'] = pg.evaluate('VERSION_CODE') + 1
    pg.click('[data-act="procurarAtualizacao"]'); pg.wait_for_timeout(400)
    check('com versão nova: aviso mostra o versionName novo', pg.locator('#upd').count() == 1 and '(1.7.2)' in pg.inner_text('#upd'), pg.inner_text('#upd') if pg.locator('#upd').count() else '')
    pg.screenshot(path=OUT + '/aviso.png')
    check('sem erros de JavaScript', not errs, errs)
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
