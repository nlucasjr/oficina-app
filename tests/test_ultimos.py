"""Testa a linha do tempo de últimos serviços no Painel."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8134', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8134/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "1", "endereco": ""},
                   {"id": "c2", "nome": "Maria <b>Souza</b>", "telefone": "2", "endereco": ""}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 80000},
                   {"id": "v2", "clienteId": "c2", "placa": "QWE4R56", "marca": "Fiat", "modelo": "Argo", "km": 30000}],
      "servicos": [{"id": "s1", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-01", "km": 79000, "descricao": "Óleo", "maoDeObra": 50, "pecas": 150, "valor": 200},
                   {"id": "s2", "veiculoId": "v2", "clienteId": "c2", "data": "2026-10-10", "km": 30000, "descricao": "Freios", "maoDeObra": 120, "pecas": 315.5, "valor": 435.5}]}
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    for nome, vp in [('celular', {'width': 390, 'height': 844}), ('pc', {'width': 1280, 'height': 860})]:
        c = b.new_context(viewport=vp, device_scale_factor=2, service_workers='block', locale='pt-BR')
        c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
        c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
        c.add_init_script("localStorage.setItem('oficina_db_v1', %s)" % json.dumps(json.dumps(DB)))
        pg = c.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '#painel'); pg.wait_for_selector('.stats')
        itens = pg.locator('.ultimos .tl-item')
        check(f'[{nome}] linha do tempo no lugar da tabela', itens.count() == 2 and pg.locator('.card table.list').count() == 0)
        linhas = [l.strip() for l in itens.nth(0).inner_text().split('\n') if l.strip()]
        check(f'[{nome}] mais recente primeiro: cliente, placa, modelo, total (uma embaixo da outra)',
              linhas == ['Maria <b>Souza</b>', 'QWE4R56', 'Argo', 'R$\xa0435,50'], linhas)
        tops = itens.nth(0).evaluate("el => [...el.children].map(d => Math.round(d.getBoundingClientRect().top))")
        check(f'[{nome}] cada informação numa linha', tops == sorted(tops) and len(set(tops)) == 4, tops)
        check(f'[{nome}] sem data, km ou descrição', 'Freios' not in linhas and '30.000' not in ' '.join(linhas))
        pg.screenshot(path=f'{OUT}/painel-{nome}.png', full_page=True)
        itens.nth(1).click(); pg.wait_for_selector('.sd-valores')
        check(f'[{nome}] tocar abre a tela do serviço', pg.url.endswith('#servico/s1'), pg.url)
        check(f'[{nome}] sem erros de JavaScript', not errs, errs)
        c.close()
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
