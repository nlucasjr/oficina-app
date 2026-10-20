"""Corrida: abrir uma janela logo após outra fechar não pode quebrar o botão voltar."""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8135', '--bind', '127.0.0.1'], cwd=sys.argv[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); B = 'http://127.0.0.1:8135/'
DB = {"config": {}, "clientes": [{"id": "c1", "nome": "João", "telefone": "1", "endereco": ""}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "VW", "modelo": "Gol", "km": 1}], "servicos": []}
ok = True
with sync_playwright() as p:
    b = p.chromium.launch()
    relogio.fixar(b)
    c = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, service_workers='block')
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("localStorage.setItem('oficina_db_v1', %s);" % json.dumps(json.dumps(DB)))
    pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + '#painel'); pg.wait_for_selector('.stats'); pg.goto(B + '#clientes'); pg.wait_for_selector('#main h1')
    for i in range(5):
        # fecha e reabre no mesmo instante (antes de o "voltar" interno terminar)
        pg.evaluate("() => { editCliente('c1'); closeModal(); editCliente('c1'); }")
        pg.wait_for_timeout(250)
        aberto = pg.locator('#modal.open').count() == 1
        pg.go_back(); pg.wait_for_timeout(250)
        r = aberto and pg.locator('#modal.open').count() == 0 and pg.url.endswith('#clientes')
        print(('ok   ' if r else 'FALHOU ') + f'rodada {i+1}: voltar fecha a janela reaberta e continua em Clientes ({pg.url})')
        ok &= r
    print(('ok   ' if not errs else 'FALHOU ') + 'sem erros de JavaScript', errs or '')
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok and not errs else 'HÁ FALHAS')
sys.exit(0 if (ok and not errs) else 1)
