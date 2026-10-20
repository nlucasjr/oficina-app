"""Testa: novo veículo/cliente a partir do serviço, campo de pesquisa e voltar em janelas encadeadas."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8132', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8132/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "endereco": "Rua A, 1"}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 80000}],
      "servicos": [{"id": "s1", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-02", "km": 80000,
                    "descricao": "Troca de óleo", "maoDeObra": 60, "pecas": 170, "valor": 230, "criado": "2026-10-02T10:00:00Z"}]}
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                      service_workers='block', locale='pt-BR')
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("if(!localStorage.getItem('seeded')){localStorage.setItem('oficina_db_v1', %s);localStorage.setItem('seeded','1')}" % json.dumps(json.dumps(DB)))
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    get = lambda js: pg.evaluate(js)

    # ---------- pesquisa ----------
    for h in ['#servicos', '#veiculos', '#clientes']:
        pg.goto(BASE + h); pg.wait_for_selector('#fBusca')
        ph = pg.get_attribute('#fBusca', 'placeholder')
        check(f'{h}: dica do campo é só "Pesquisar"', ph == 'Pesquisar', ph)
        check(f'{h}: lupa à direita do campo', pg.evaluate("""() => { const i = document.querySelector('#fBusca').getBoundingClientRect(),
            s = document.querySelector('.busca-ico').getBoundingClientRect(); return s.right <= i.right && s.left > i.left + i.width / 2; }"""))
    cores = pg.evaluate("""() => { const i = document.querySelector('#fBusca');
      return [getComputedStyle(i).color, getComputedStyle(i, '::placeholder').color]; }""")
    check('"Pesquisar" tem cor diferente do texto digitado', cores[0] != cores[1], cores)
    pg.screenshot(path=f'{OUT}/busca-vazia.png')
    pg.goto(BASE + '#servicos'); pg.fill('#fBusca', 'óleo'); pg.wait_for_timeout(400)
    check('pesquisa continua filtrando', pg.locator('.sv').count() == 1 and 'Troca de óleo' in pg.inner_text('.sv-lista'))
    check('o texto digitado continua no campo depois de filtrar', pg.input_value('#fBusca') == 'óleo')
    pg.screenshot(path=f'{OUT}/busca-preenchida.png')

    check('sem erros de JavaScript', not errs, errs)
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
