"""Testa as mensagens no topo da tela e o gesto de deslizar para sumir."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8144', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8144/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "1", "endereco": ""}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "VW", "modelo": "Gol", "km": 80000}],
      "servicos": []}
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

def rect(pg, sel): return pg.evaluate(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return {{top: r.top, bottom: r.bottom, left: r.left, right: r.right}}; }})()")
def visivel(pg):
    r = rect(pg, '#toast'); return r['bottom'] > 0 and r['left'] < 390 and r['right'] > 0 and pg.evaluate("$('#toast').classList.contains('show')")

def arrastar(pg, dx):
    r = rect(pg, '#toast'); y = (r['top'] + r['bottom']) / 2; x = (r['left'] + r['right']) / 2
    pg.evaluate(f"""(() => {{ const t = $('#toast'); const ev = (type, x) => t.dispatchEvent(new PointerEvent(type, {{ clientX: x, clientY: {y}, pointerId: 1, bubbles: true, pointerType: 'touch', isPrimary: true }}));
      ev('pointerdown', {x}); for (let i = 1; i <= 5; i++) ev('pointermove', {x} + {dx} * i / 5); ev('pointerup', {x} + {dx}); }})()""")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                      service_workers='block', locale='pt-BR')
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("localStorage.setItem('oficina_db_v1', %s)" % json.dumps(json.dumps(DB)))
    pg = c.new_page(); errs = []; dialogs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    pg.goto(BASE + '#servicos'); pg.wait_for_selector('#main h1')
    check('sem mensagem ao abrir', not visivel(pg))

    # salvar serviço: mensagem de sucesso no topo
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    pg.select_option('#mf [name="veiculoId"]', 'v1'); pg.fill('#mf [name="descricao"]', 'Troca de óleo'); pg.fill('#mf [name="maoDeObra"]', '80')
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(400)
    r, nav = rect(pg, '#toast'), rect(pg, 'nav')
    check('sucesso aparece no topo da tela', visivel(pg) and r['top'] < 60 and r['bottom'] < 200, r)
    check('não cobre o menu de baixo', r['bottom'] < nav['top'], (r, nav))
    check('cor de sucesso', pg.evaluate("$('#toast').classList.contains('ok')") and pg.inner_text('#toast') == 'Serviço salvo')
    pg.screenshot(path=f'{OUT}/sucesso.png')

    # deslizar pouco: volta para o lugar
    arrastar(pg, 30); pg.wait_for_timeout(350)
    check('deslizar pouco: mensagem continua', visivel(pg) and abs(rect(pg, '#toast')['left'] - r['left']) < 2)
    # deslizar para a direita: some
    arrastar(pg, 160); pg.wait_for_timeout(400)
    check('deslizar para a direita: some', not visivel(pg))

    # erro: no topo, por cima do formulário, sem janela do navegador
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf'); pg.select_option('#mf [name="veiculoId"]', 'v1'); pg.fill('#mf [name="descricao"]', 'X'); pg.fill('#mf [name="pecas"]', 'abc'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(400)
    check('erro aparece no topo, com cor de erro', visivel(pg) and pg.evaluate("$('#toast').classList.contains('erro')") and 'Valor inválido' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    check('erro fica por cima do formulário', pg.evaluate("(() => { const r = $('#toast').getBoundingClientRect(); return document.elementFromPoint(r.left + r.width/2, r.top + r.height/2).id === 'toast'; })()"))
    check('erro não usa mais a janela de alerta do navegador', not dialogs, dialogs)
    check('formulário continua aberto', pg.locator('#modal.open').count() == 1)
    pg.screenshot(path=f'{OUT}/erro.png')
    arrastar(pg, -160); pg.wait_for_timeout(400)
    check('deslizar para a esquerda: some', not visivel(pg))

    # some sozinha
    pg.evaluate("toast('Teste')"); pg.wait_for_timeout(300); check('mensagem nova reaparece depois de deslizar', visivel(pg))
    pg.wait_for_timeout(3700); check('sucesso some sozinha', not visivel(pg))
    pg.evaluate("erro('Falhou')"); pg.wait_for_timeout(4000); check('erro fica mais tempo na tela', visivel(pg))
    pg.wait_for_timeout(2500); check('erro também some sozinho', not visivel(pg))
    check('sem erros de JavaScript', not errs, errs)

    # computador também no topo
    pg.set_viewport_size({'width': 1280, 'height': 860}); pg.evaluate("toast('Cliente salvo')"); pg.wait_for_timeout(400)
    check('computador: também no topo', rect(pg, '#toast')['top'] < 60)
    pg.screenshot(path=f'{OUT}/pc.png')
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
