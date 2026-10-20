"""Testa as novas listas (veículos e clientes), fichas e formulários."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8137', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8137/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "endereco": "Rua A, 1"},
                   {"id": "c2", "nome": "Ana <b>Lima</b> de Souza Costa Ferreira", "telefone": "(67) 2", "endereco": ""},
                   {"id": "c3", "nome": "Sem Carro", "telefone": "3", "endereco": ""}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 85400},
                   {"id": "v2", "clienteId": "c2", "placa": "QWE4R56", "marca": "Fiat", "modelo": "Argo Drive 1.3 Firefly Automático", "km": ""}],
      "servicos": [{"id": "s1", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-15", "km": 85400, "descricao": "Freios", "maoDeObra": 180, "pecas": 100, "valor": 280},
                   {"id": "s2", "veiculoId": "v1", "clienteId": "c2", "data": "2025-01-10", "km": 50000, "descricao": "Óleo", "valor": 90}]}
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

def novo(b, vp, mob, dados=DB):
    c = b.new_context(viewport=vp, device_scale_factor=2, is_mobile=mob, has_touch=mob, service_workers='block', locale='pt-BR')
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('oficina_db_v1', %s);sessionStorage.setItem('s','1')}" % json.dumps(json.dumps(dados)))
    pg = c.new_page(); errs = []; dialogs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    return c, pg, errs, dialogs

def sem_estouro(pg, sel):
    return pg.evaluate(f"""[...document.querySelectorAll('{sel}')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 30))""")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    for nome, vp, mob in [('celular', {'width': 360, 'height': 800}, True), ('pc', {'width': 1280, 'height': 860}, False)]:
        c, pg, errs, dialogs = novo(b, vp, mob)
        t = lambda n: f'[{nome}] {n}'
        # ---------- veículos ----------
        pg.goto(BASE + '#veiculos'); pg.wait_for_selector('.itens')
        check(t('veículos em cartões, com contagem'), pg.locator('.item').count() == 2 and pg.inner_text('.lista-info').upper() == '2 VEÍCULOS')
        v1 = pg.inner_text('.item[data-href="#veiculo/v1"]')
        check(t('cartão do veículo: placa, nome, dono, km, serviços, último'), all(x in v1 for x in ['ABC1D23', 'Volkswagen Gol 1.0', 'João Pereira', '85.400 km', '2 serviços', 'Último: 15/10/2026']), v1)
        check(t('nada estoura nos cartões'), not sem_estouro(pg, '.item'), sem_estouro(pg, '.item'))
        check(t('sem rolagem lateral'), not pg.evaluate('document.documentElement.scrollWidth > innerWidth'))
        pg.screenshot(path=f'{OUT}/{nome}-veiculos.png', full_page=True)
        pg.fill('#fBusca', 'argo'); pg.wait_for_timeout(400)
        check(t('busca: "1 veículo encontrado"'), pg.locator('.item').count() == 1 and pg.inner_text('.lista-info').lower() == '1 veículo encontrado', pg.inner_text('.lista-info'))
        pg.fill('#fBusca', 'zzz'); pg.wait_for_timeout(400)
        check(t('busca sem resultado'), 'Nenhum veículo encontrado' in pg.inner_text('#main'))
        pg.fill('#fBusca', ''); pg.wait_for_timeout(400)
        pg.click('.item[data-href="#veiculo/v1"] .item-titulo'); pg.wait_for_selector('.ficha')
        check(t('tocar no cartão abre a ficha do veículo'), pg.url.endswith('#veiculo/v1'))
        # ---------- ficha do veículo ----------
        f = pg.inner_text('.ficha')
        check(t('ficha: placa, nome, dono, telefone, km'), all(x in f for x in ['ABC1D23', 'Volkswagen Gol 1.0', 'João Pereira', '(67) 99123-4567', '85.400 km']), f)
        check(t('ficha: telefone é link para ligar'), pg.locator('.ficha a[href^="tel:"]').count() == 1)
        check(t('histórico sem repetir o veículo em cada serviço'), pg.locator('.sv .sv-veiculo').count() == 0 and pg.locator('.sv').count() == 2)
        check(t('só mostra "Dono na época" quando era outro dono'),
              'Dono na época: Ana' in pg.inner_text('.sv[data-servico="s2"]') and 'Dono' not in pg.inner_text('.sv[data-servico="s1"]'))
        top_exc = pg.locator('.zona-excluir').bounding_box()['y']; top_hist = pg.locator('.sv').last.bounding_box()['y']
        check(t('"Excluir veículo" fica no fim da página, longe do Editar'), top_exc > top_hist and pg.locator('.ficha [data-act="del"]').count() == 0)
        check(t('nada se sobrepõe no histórico'), not sem_estouro(pg, '.sv'))
        pg.screenshot(path=f'{OUT}/{nome}-veiculo.png', full_page=True)
        pg.click('text=Excluir veículo'); pg.wait_for_timeout(200)
        check(t('excluir veículo com serviços continua bloqueado'), 'serviços no histórico' in pg.inner_text('#toast'))
        # ---------- clientes ----------
        pg.goto(BASE + '#clientes'); pg.wait_for_selector('.itens')
        check(t('clientes em cartões com iniciais'), pg.locator('.item .avatar').count() == 3 and pg.inner_text('.item[data-href="#cliente/c1"] .avatar') == 'JP')
        check(t('iniciais do nome longo: primeira e última'), pg.inner_text('.item[data-href="#cliente/c2"] .avatar') == 'AF')
        c1 = pg.inner_text('.item[data-href="#cliente/c1"]')
        check(t('cartão do cliente: telefone, veículos, serviços e placas'), all(x in c1 for x in ['(67) 99123-4567', '1 veículo', '1 serviço', 'ABC1D23']), c1)
        check(t('cliente sem carro: "0 veículos" e sem placas'), '0 veículos' in pg.inner_text('.item[data-href="#cliente/c3"]') and pg.locator('.item[data-href="#cliente/c3"] .item-placas').count() == 0)
        check(t('nome com HTML aparece escapado'), '<b>' in pg.inner_text('.item[data-href="#cliente/c2"]'))
        check(t('nada estoura nos cartões de cliente'), not sem_estouro(pg, '.item'))
        pg.screenshot(path=f'{OUT}/{nome}-clientes.png', full_page=True)
        pg.locator('.item[data-href="#cliente/c1"]').focus(); pg.keyboard.press('Enter'); pg.wait_for_selector('.ficha')
        check(t('Enter no cartão abre a ficha (teclado)'), pg.url.endswith('#cliente/c1'))
        # ---------- ficha do cliente ----------
        check(t('ficha do cliente com telefone, endereço e resumo'), all(x in pg.inner_text('#main') for x in ['(67) 99123-4567', 'Rua A, 1']) and pg.locator('.sv-resumo').count() == 1)
        pg.click('.item .item-acao'); pg.wait_for_selector('#mf')
        check(t('"+ Serviço" no veículo abre o registro com o veículo escolhido'), pg.input_value('#mf [name="veiculoId"]') == 'v1' and pg.url.endswith('#cliente/c1'))
        pg.click('[data-close-x]'); pg.wait_for_timeout(250)
        check(t('botão ✕ fecha o formulário'), pg.locator('#modal.open').count() == 0)
        pg.screenshot(path=f'{OUT}/{nome}-cliente.png', full_page=True)
        # ---------- formulários ----------
        pg.goto(BASE + '#veiculos'); pg.click('[data-act="novoVeiculo"]'); pg.wait_for_selector('#mf')
        secs = pg.eval_on_selector_all('#mf .form-sec', 'els => els.map(e => e.textContent)')
        check(t('formulário do veículo com seção "Dados do veículo"'), secs == ['Dados do veículo'], secs)
        check(t('rótulos ligados aos campos (tocar no rótulo foca o campo)'), pg.evaluate("[...document.querySelectorAll('#mf label[for]')].every(l => document.getElementById(l.htmlFor))"))
        check(t('km com "km" dentro do campo'), pg.locator('#mf .adorno:has([name="km"]) .adorno-suf').inner_text() == 'km')
        check(t('placa em maiúsculas'), pg.evaluate("getComputedStyle($('#mf [name=placa]')).textTransform") == 'uppercase')
        check(t('primeira opção do dono explica o que fazer'), 'Escolha o dono' in pg.inner_text('#mf [name="clienteId"]'))
        pg.select_option('#mf [name="clienteId"]', 'c3'); pg.fill('#mf [name="placa"]', 'zzz-9x99'); pg.fill('#mf [name="modelo"]', 'Uno')
        pg.click('#mf .btn.primary'); pg.wait_for_timeout(250)
        check(t('salvar veículo continua funcionando (placa normalizada)'), pg.evaluate("db.veiculos.some(v => v.placa === 'ZZZ9X99' && v.clienteId === 'c3')"))
        pg.goto(BASE + '#servicos'); editar(pg, '.sv[data-servico="s1"]')
        secs = pg.eval_on_selector_all('#mf .form-sec', 'els => els.map(e => e.textContent)')
        check(t('serviço com seções Serviço e Valores'), secs == ['Serviço', 'Valores'], secs)
        check(t('R$ dentro dos campos de valor'), pg.locator('#mf .adorno-pre').count() == 2)
        acoes = pg.inner_text('#mf .modal-actions')
        check(t('formulário de edição sem Excluir (fica na tela do serviço)'), 'Excluir' not in pg.inner_text('#mf'), acoes)
        if mob:
            r1 = pg.locator('#mf [name="maoDeObra"]').bounding_box(); r2 = pg.locator('#mf [name="pecas"]').bounding_box()
            d1 = pg.locator('#mf [name="data"]').bounding_box(); k1 = pg.locator('#mf [name="km"]').bounding_box()
            check(t('celular: mão de obra/peças e data/km lado a lado'), abs(r1['y'] - r2['y']) < 2 and abs(d1['y'] - k1['y']) < 2)
            pg.evaluate("$('.modal-card').scrollTop = 9999"); pg.wait_for_timeout(100)
            h = pg.locator('.modal-head').bounding_box(); cardtop = pg.locator('.modal-card').bounding_box()['y']
            check(t('celular: título e ✕ ficam visíveis ao rolar o formulário'), abs(h['y'] - cardtop) < 2, (h, cardtop))
        pg.screenshot(path=f'{OUT}/{nome}-f-servico.png')
        pg.fill('#mf [name="pecas"]', '120'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(250)
        check(t('editar serviço continua salvando'), pg.evaluate("getServico('s1').valor") == 300)
        editar(pg, '.sv[data-servico="s1"]')
        pg.go_back(); pg.wait_for_timeout(300)
        check(t('voltar do celular ainda fecha o formulário'), pg.locator('#modal.open').count() == 0 and pg.url.endswith('#servico/s1'), pg.url)
        check(t('sem erros de JavaScript'), not errs, errs)
        c.close()

    # listas vazias: convite para cadastrar
    c, pg, errs, _ = novo(b, {'width': 390, 'height': 844}, True, {"config": {"nome": "M"}, "clientes": [], "veiculos": [], "servicos": []})
    pg.goto(BASE + '#veiculos'); pg.wait_for_selector('.vazio')
    check('lista vazia de veículos convida a cadastrar', pg.locator('.vazio [data-act="novoVeiculo"]').count() == 1)
    pg.goto(BASE + '#clientes'); pg.wait_for_selector('.vazio')
    pg.click('.vazio [data-act="novoCliente"]'); pg.wait_for_selector('#mf')
    check('botão da lista vazia abre "Novo cliente"', pg.inner_text('.modal-card h3') == 'Novo cliente')
    check('sem erros de JavaScript (vazio)', not errs, errs)
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
