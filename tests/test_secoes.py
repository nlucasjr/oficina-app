"""Testa as seções 'Novo cliente' e 'Novo veículo' dentro do formulário de serviço."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8133', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8133/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "endereco": "Rua A, 1"}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 80000}],
      "servicos": []}
def editar(pg, sel=None):
    """Abre a tela do serviço (se o cartão estiver na tela) e toca em "Editar serviço"."""
    if sel and pg.locator(sel).count():
        pg.click(sel); pg.wait_for_selector('.sd-valores')
    pg.click('[data-act="editServico"]'); pg.wait_for_selector('#mf')

ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

def novo_ctx(b, dados):
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                      service_workers='block', locale='pt-BR')
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("if(!localStorage.getItem('seeded')){localStorage.setItem('oficina_db_v1', %s);localStorage.setItem('seeded','1')}" % json.dumps(json.dumps(dados)))
    pg = c.new_page(); errs = []; dialogs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    return pg, errs, dialogs

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    pg, errs, dialogs = novo_ctx(b, DB)
    get = lambda js: pg.evaluate(js)
    abrir = lambda: (pg.goto(BASE + '#servicos'), pg.click('[data-act="novoServico"]'), pg.wait_for_selector('#mf'))

    abrir()
    ordem = pg.eval_on_selector_all('#mf details.sub-form summary', 'els => els.map(e => e.innerText.trim())')
    check('seções na ordem: Novo cliente, depois Novo veículo', ordem == ['Novo cliente', 'Novo veículo'], ordem)
    check('seções começam fechadas', not get("$('#dNovoCliente').open") and not get("$('#dNovoVeiculo').open"))
    check('não há mais botões que abrem outra janela', pg.locator('#mf [data-novo]').count() == 0)
    pg.screenshot(path=f'{OUT}/fechadas.png')

    # serviço normal continua igual
    pg.select_option('#mf [name="veiculoId"]', 'v1'); pg.fill('#mf [name="descricao"]', 'Serviço normal'); pg.fill('#mf [name="maoDeObra"]', '50')
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('serviço em veículo existente continua funcionando', get("db.servicos.some(s => s.descricao === 'Serviço normal' && s.veiculoId === 'v1')"))

    # ---------- só novo veículo (dono existente) ----------
    abrir()
    pg.click('#dNovoVeiculo summary'); pg.wait_for_timeout(100)
    check('abrir "Novo veículo" desativa a escolha do veículo', pg.is_disabled('#mf [name="veiculoId"]'))
    check('"Novo cliente (acima)" escondido enquanto o novo cliente está fechado',
          get("$('#mf [name=nv_dono] option[value=__novo__]').hidden"))
    pg.select_option('#mf [name="nv_dono"]', 'c1'); pg.fill('#mf [name="nv_placa"]', 'qwe-4r56')
    pg.fill('#mf [name="nv_marca"]', 'Fiat'); pg.fill('#mf [name="nv_modelo"]', 'Argo')
    pg.fill('#mf [name="km"]', '31000'); pg.fill('#mf [name="descricao"]', 'Alinhamento'); pg.fill('#mf [name="maoDeObra"]', '120')
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(250)
    v = get("db.veiculos.find(v => v.placa === 'QWE4R56')")
    s = get("db.servicos.find(s => s.descricao === 'Alinhamento')")
    check('cria o veículo novo com dono, marca, modelo e km', v and v['clienteId'] == 'c1' and v['marca'] == 'Fiat' and v['km'] == 31000, v)
    check('serviço fica no veículo novo, com o dono certo', s and s['veiculoId'] == v['id'] and s['clienteId'] == 'c1' and s['valor'] == 120, s)
    check('aviso "Veículo e serviço salvos"', 'Veículo e serviço salvos' in pg.inner_text('#toast'))

    # ---------- novo cliente + novo veículo ----------
    abrir()
    pg.fill('#mf [name="descricao"]', 'Troca de embreagem'); pg.fill('#mf [name="maoDeObra"]', '450'); pg.fill('#mf [name="pecas"]', '1.000')
    pg.click('#dNovoCliente summary'); pg.wait_for_timeout(150)
    check('abrir "Novo cliente" abre também o veículo', get("$('#dNovoVeiculo').open"))
    check('dono do veículo novo já é o novo cliente', pg.input_value('#mf [name="nv_dono"]') == '__novo__')
    pg.fill('#mf [name="nc_nome"]', 'Carlos Lima'); pg.fill('#mf [name="nc_telefone"]', '67 99777-2020'); pg.fill('#mf [name="nc_endereco"]', 'Rua Sete, 88')
    pg.fill('#mf [name="nv_placa"]', 'RTY7U89'); pg.fill('#mf [name="nv_marca"]', 'Chevrolet'); pg.fill('#mf [name="nv_modelo"]', 'Onix')
    pg.screenshot(path=f'{OUT}/abertas.png', full_page=False)
    pg.locator('#mf [name="nv_modelo"]').scroll_into_view_if_needed(); pg.screenshot(path=f'{OUT}/abertas-2.png')
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(250)
    cl = get("db.clientes.find(c => c.nome === 'Carlos Lima')")
    v2 = get("db.veiculos.find(v => v.placa === 'RTY7U89')")
    s2 = get("db.servicos.find(s => s.descricao === 'Troca de embreagem')")
    check('cria o cliente novo', cl and cl['telefone'] == '67 99777-2020' and cl['endereco'] == 'Rua Sete, 88', cl)
    check('cria o veículo do cliente novo', v2 and v2['clienteId'] == cl['id'], v2)
    check('serviço salvo no veículo novo, dono = cliente novo, total certo',
          s2 and s2['veiculoId'] == v2['id'] and s2['clienteId'] == cl['id'] and s2['valor'] == 1450, s2)
    check('aviso "Cliente, veículo e serviço salvos"', 'Cliente, veículo e serviço salvos' in pg.inner_text('#toast'))

    # ---------- validações: nada é criado pela metade ----------
    nC, nV, nS = get('db.clientes.length'), get('db.veiculos.length'), get('db.servicos.length')
    abrir(); pg.fill('#mf [name="descricao"]', 'X'); pg.click('#dNovoCliente summary'); pg.wait_for_timeout(100)
    pg.fill('#mf [name="nc_nome"]', 'Sem telefone'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(150)
    check('cliente sem telefone: avisa', 'nome e telefone' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.fill('#mf [name="nc_telefone"]', '67 9000-0000'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(150)
    check('veículo sem placa/modelo: avisa', 'placa e modelo' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.fill('#mf [name="nv_placa"]', 'ABC1D23'); pg.fill('#mf [name="nv_modelo"]', 'Gol'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(150)
    check('placa já cadastrada: avisa', 'Já existe um veículo com essa placa' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    check('nada foi criado pela metade', (get('db.clientes.length'), get('db.veiculos.length'), get('db.servicos.length')) == (nC, nV, nS))
    pg.click('[data-close]'); pg.wait_for_timeout(200)

    # fechar as seções volta ao normal
    abrir(); pg.click('#dNovoVeiculo summary'); pg.wait_for_timeout(100); pg.click('#dNovoVeiculo summary'); pg.wait_for_timeout(100)
    check('fechar "Novo veículo" reativa a escolha do veículo', not pg.is_disabled('#mf [name="veiculoId"]'))
    pg.click('[data-close]'); pg.wait_for_timeout(200)

    # ---------- editar serviço: sem as seções ----------
    pg.goto(BASE + '#servicos'); pg.wait_for_selector('.sv-lista')
    editar(pg, '.sv:has-text("Alinhamento")')
    check('editar serviço: título "Editar serviço"', pg.inner_text('.modal-card h3') == 'Editar serviço')
    check('editar serviço: sem "Novo cliente" e "Novo veículo"', pg.locator('#mf details.sub-form').count() == 0)
    check('editar serviço: escolha do veículo ativa', not pg.is_disabled('#mf [name="veiculoId"]'))
    pg.screenshot(path=f'{OUT}/editar.png')
    pg.fill('#mf [name="pecas"]', '30'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(250)
    s_ed = get("db.servicos.find(s => s.descricao === 'Alinhamento')")
    check('editar serviço continua salvando', s_ed['pecas'] == 30 and s_ed['valor'] == 150 and pg.locator('#modal.open').count() == 0, s_ed)
    abrir()
    check('registrar serviço continua com as seções', pg.locator('#mf details.sub-form').count() == 2)
    pg.click('[data-close]'); pg.wait_for_timeout(200)

    # voltar do celular fecha o formulário
    pg.goto(BASE + '#painel'); pg.wait_for_selector('.stats'); abrir(); pg.click('#dNovoCliente summary')
    pg.go_back(); pg.wait_for_timeout(300)
    check('voltar do celular fecha o formulário', pg.locator('#modal.open').count() == 0 and pg.url.endswith('#servicos'), pg.url)
    check('sem erros de JavaScript', not errs, errs)

    # ---------- banco vazio: já abre o que falta ----------
    pg2, errs2, _ = novo_ctx(b, {"config": {"nome": "Mecânica Rodrigues"}, "clientes": [], "veiculos": [], "servicos": []})
    pg2.goto(BASE + '#servicos'); pg2.click('[data-act="novoServico"]'); pg2.wait_for_selector('#mf'); pg2.wait_for_timeout(150)
    check('sem clientes: abre o serviço com Novo cliente e Novo veículo abertos',
          pg2.evaluate("$('#dNovoCliente').open && $('#dNovoVeiculo').open"))
    check('sem erros de JavaScript (banco vazio)', not errs2, errs2)
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
