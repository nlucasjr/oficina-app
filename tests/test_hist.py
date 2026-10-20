"""Testa a nova versão (histórico de serviços): migração, cadastros, serviços, km, dono na época, sincronização."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8127', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8127/'

# dados no formato da versão anterior (orçamentos, peças, campos extras)
ANTIGO = {
  "config": {"nome": "Mecânica Rodrigues", "telefone": "67 98131-2502", "margem": 30},
  "clientes": [
    {"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "doc": "123.456.789-00", "email": "joao@x.com", "endereco": "Rua das Flores, 120", "obs": "cliente antigo"},
    {"id": "c2", "nome": "Maria Souza", "telefone": "67 98888-1111", "endereco": "Av. Brasil, 50"}],
  "veiculos": [
    {"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "ano": "2018", "cor": "Prata", "chassi": "9BW123", "km": 80000},
    {"id": "v2", "clienteId": "c2", "placa": "QWE4R56", "marca": "Fiat", "modelo": "Argo", "ano": "2021", "km": 30000}],
  "pecas": [{"id": "p1", "nome": "Óleo 5W30", "custo": 32, "preco": 45}],
  "orcamentos": [
    {"id": "o1", "numero": 1, "data": "2026-09-10", "status": "concluido", "clienteId": "c1", "veiculoId": "v1", "km": 82000, "desconto": 10,
     "itens": [{"tipo": "peca", "descricao": "Óleo 5W30", "qtd": 4, "valor": 45, "unidade": "L"}, {"tipo": "servico", "descricao": "Troca de óleo", "qtd": 1, "valor": 60}]},
    {"id": "o2", "numero": 2, "data": "2026-10-01", "status": "aprovado", "clienteId": "c2", "veiculoId": "v2", "km": 31000,
     "itens": [{"tipo": "servico", "descricao": "Alinhamento", "qtd": 1, "valor": 120}]},
    {"id": "o3", "numero": 3, "data": "2026-10-05", "status": "aberto", "clienteId": "c1", "veiculoId": "v1", "km": 83000,
     "itens": [{"tipo": "servico", "descricao": "Não aprovado ainda", "qtd": 1, "valor": 999}]},
    {"id": "o4", "numero": 4, "data": "2026-10-06", "status": "recusado", "clienteId": "c1", "veiculoId": "v1", "km": 83500,
     "itens": [{"tipo": "servico", "descricao": "Recusado", "qtd": 1, "valor": 500}]}],
  "seq": 5}

ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

def shot(pg, name, full=False):
    pg.wait_for_timeout(250); pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)

def contexto(b, mobile=True, seed=True):
    opts = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True) if mobile \
        else dict(viewport={'width': 1280, 'height': 800})
    ctx = b.new_context(service_workers='block', **opts)
    ctx.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    ctx.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    if seed:
        ctx.add_init_script("if(!localStorage.getItem('seeded')){localStorage.setItem('oficina_db_v1', %s);localStorage.setItem('seeded','1')}"
                            % json.dumps(json.dumps(ANTIGO)))
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    return pg, errs

def modal_fill(pg, vals):
    for k, v in vals.items():
        el = pg.locator(f'#mf [name="{k}"]')
        if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(v)
        else: el.fill(str(v))

with sync_playwright() as p:
    b = p.chromium.launch()
    relogio.fixar(b)
    pg, errs = contexto(b)
    dialogs = []
    def on_dialog(d):
        dialogs.append(d.message)
        (d.dismiss() if getattr(pg, '_dismiss', False) else d.accept())
    pg.on('dialog', on_dialog)
    pg.goto(BASE + '#painel'); pg.wait_for_selector('.stats')
    get = lambda js: pg.evaluate(js)

    # ---------- dados antigos ----------
    check('orçamentos e peças antigos são ignorados', get('Object.keys(db).sort().join()') == 'clientes,config,servicos,veiculos',
          get('Object.keys(db).sort().join()'))
    check('histórico de serviços começa vazio', len(get('db.servicos')) == 0)
    v1 = get("db.veiculos.find(v => v.id === 'v1')")
    check('veículo mantém marca e modelo separados', v1['marca'] == 'Volkswagen' and v1['modelo'] == 'Gol 1.0')

    # ---------- telas ----------
    check('menu com 5 itens: Painel, Serviços, Veículos, Clientes, Ajustes',
          [t.strip() for t in pg.locator('#nav a .lbl').all_inner_texts()] == ['Painel', 'Serviços', 'Veículos', 'Clientes', 'Ajustes'])
    pg.goto(BASE + '#orcamentos'); pg.wait_for_timeout(150)
    check('endereço antigo de orçamentos cai no painel', pg.inner_text('h1') == 'Painel')
    shot(pg, 'm-painel')
    pg.goto(BASE + '#veiculos'); pg.wait_for_timeout(150)
    check('lista de veículos mostra marca + modelo, dono e km', all(t in pg.inner_text('#main') for t in ['Volkswagen Gol 1.0', 'João Pereira', '80.000 km']),
          pg.inner_text('#main')[:200])
    shot(pg, 'm-veiculos')

    textos = ''
    for h in ['#painel', '#servicos', '#veiculos', '#veiculo/v1', '#clientes', '#cliente/c1', '#config']:
        pg.goto(BASE + h); pg.wait_for_timeout(120); textos += pg.inner_text('#main') + '\n'
    proibidos = [w for w in ['CPF', 'CNPJ', 'E-mail', 'Chassi', 'Cor:', 'Ano', 'Orçamento', 'WhatsApp'] if w in textos]
    check('nenhuma tela mostra os campos/funções removidos', not proibidos, proibidos)

    pg.goto(BASE + '#veiculos'); pg.click('[data-act="novoVeiculo"]'); pg.wait_for_selector('#mf')
    campos = pg.eval_on_selector_all('#mf [name]', 'els => els.map(e => e.name)')
    check('formulário do veículo: dono, placa, marca, modelo, km', campos == ['clienteId', 'placa', 'marca', 'modelo', 'km'], campos)
    pg.click('[data-close]')
    pg.goto(BASE + '#clientes'); pg.click('[data-act="novoCliente"]'); pg.wait_for_selector('#mf')
    campos = pg.eval_on_selector_all('#mf [name]', 'els => els.map(e => e.name)')
    check('formulário do cliente: nome, telefone, endereço', campos == ['nome', 'telefone', 'endereco'], campos)
    pg.click('[data-close]')

    # ---------- registrar serviço ----------
    pg.goto(BASE + '#veiculo/v1'); pg.wait_for_timeout(150)
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    check('registrar a partir do veículo já vem com o veículo e a data de hoje',
          pg.input_value('#mf [name="veiculoId"]') == 'v1' and pg.input_value('#mf [name="data"]') == get('today()'))
    shot(pg, 'm-modal-servico')
    modal_fill(pg, {'data': '2026-10-15', 'km': '85400', 'descricao': 'Troca de pastilhas dianteiras\nRevisão dos freios', 'maoDeObra': '280'})
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    novo = get("db.servicos.find(s => s.km === 85400)")
    check('serviço salvo com data, km, descrição e valor', novo and novo['data'] == '2026-10-15' and novo['valor'] == 280)
    check('serviço guarda o dono da época', novo and novo['clienteId'] == 'c1')
    check('km do veículo atualizado pelo novo serviço', get("db.veiculos.find(v => v.id === 'v1').km") == 85400)
    check('histórico do veículo mostra o serviço', 'Troca de pastilhas dianteiras' in pg.inner_text('.sv-lista'))

    # serviço antigo lançado depois: não muda o km atual
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    modal_fill(pg, {'data': '2026-05-02', 'km': '76000', 'descricao': 'Troca de bateria', 'maoDeObra': '450'})
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('serviço com data antiga não reduz o km atual', get("db.veiculos.find(v => v.id === 'v1').km") == 85400)
    datas = get("servicosDoVeiculo('v1').map(s => s.data)")
    check('histórico em ordem do mais recente para o mais antigo', datas == sorted(datas, reverse=True), datas)

    # km menor num serviço mais novo: pergunta antes
    dialogs.clear(); pg._dismiss = True
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    modal_fill(pg, {'data': '2026-10-18', 'km': '8540', 'descricao': 'Lavagem', 'maoDeObra': '50'})
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('km menor que o anterior pede confirmação', dialogs and 'menor' in dialogs[0], dialogs)
    check('ao cancelar, não salva', get("db.servicos.filter(s => s.descricao === 'Lavagem').length") == 0)
    pg._dismiss = False
    pg.fill('#mf [name="km"]', '85900'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('km atual acompanha o serviço mais recente', get("db.veiculos.find(v => v.id === 'v1').km") == 85900)
    shot(pg, 'm-veiculo', full=True)

    # troca de dono: histórico mantém o dono da época
    pg.click('[data-act="editVeiculo"]'); pg.wait_for_selector('#mf')
    modal_fill(pg, {'clienteId': 'c2'}); pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    hist = pg.inner_text('.sv-lista')
    check('após vender o carro, histórico mostra "Dono na época: João Pereira"', 'Dono na época: João Pereira' in hist)
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    modal_fill(pg, {'data': '2026-10-19', 'km': '86000', 'descricao': 'Troca de óleo', 'maoDeObra': '200'})
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('serviço novo fica com o dono novo', get("db.servicos.find(s => s.km === 86000).clienteId") == 'c2')
    pg.goto(BASE + '#cliente/c1'); pg.wait_for_timeout(150)
    check('ficha do antigo dono continua com os serviços da época dele', 'Troca de pastilhas' in pg.inner_text('#main'))
    shot(pg, 'm-cliente', full=True)

    # editar e excluir serviço
    pg.goto(BASE + '#veiculo/v1'); pg.wait_for_timeout(150)
    pg.click('.sv:has-text("Troca de óleo")'); pg.wait_for_selector('.sd-valores')
    check('clicar no serviço abre a tela do serviço', '#servico/' in pg.url and pg.locator('[data-act="editServico"]').count() == 1)
    pg.click('[data-act="del"][data-kind="servico"]'); pg.wait_for_timeout(350)
    check('depois de excluir volta para a ficha do veículo', pg.url.endswith('#veiculo/v1'), pg.url)
    check('excluir serviço remove e recalcula o km', get("db.servicos.some(s => s.km === 86000)") is False
          and get("db.veiculos.find(v => v.id === 'v1').km") == 85900)

    # regras de exclusão
    dialogs.clear()
    pg.click('[data-act="del"][data-kind="veiculo"]'); pg.wait_for_timeout(150)
    check('veículo com histórico não pode ser excluído', 'serviços no histórico' in pg.inner_text('#toast') and get("!!getVeiculo('v1')"))
    dialogs.clear()
    pg.goto(BASE + '#cliente/c2'); pg.click('[data-act="del"][data-kind="cliente"]'); pg.wait_for_timeout(150)
    check('cliente dono de veículos não pode ser excluído', 'dono de veículos' in pg.inner_text('#toast'))

    # busca
    pg.goto(BASE + '#servicos'); pg.fill('#fBusca', 'pastilhas'); pg.wait_for_timeout(400)
    check('busca de serviços por descrição', pg.locator('.sv').count() == 1 and 'pastilhas' in pg.inner_text('.sv-lista'))
    pg.fill('#fBusca', 'ABC1D23'); pg.wait_for_timeout(400)
    check('busca de serviços por placa', pg.locator('.sv').count() == 3, pg.locator('.sv').count())
    pg.fill('#fBusca', ''); pg.wait_for_timeout(400)
    shot(pg, 'm-servicos')

    # info no celular
    info = pg.evaluate("""() => ({ scroll: document.documentElement.scrollWidth > innerWidth,
      nav: getComputedStyle(document.querySelector('#nav')).position })""")
    check('celular: sem rolagem lateral e barra inferior fixa', not info['scroll'] and info['nav'] == 'fixed', info)
    check('celular: sem erros de JavaScript', not errs, errs)

    # ---------- sincronização com a nuvem (simulada) ----------
    pg2, errs2 = contexto(b, seed=False)
    pg2.goto(BASE + '#painel'); pg2.wait_for_selector('.stats')
    rows = [{'tipo': 'config', 'id': 'main', 'data': ANTIGO['config']}] + \
           [{'tipo': t, 'id': r['id'], 'data': r} for t in ['clientes', 'veiculos', 'pecas', 'orcamentos'] for r in ANTIGO[t]]
    res = pg2.evaluate("""async (rows) => {
      const ups = [], dels = [];
      window.__renders = 0; const r0 = window.render; window.render = () => { __renders++; r0(); };
      window.__rows = rows;
      cloud.sb = { from: () => ({
        upsert: async (x) => { ups.push(...x); return { error: null }; },
        delete: () => ({ match: async (m) => { dels.push(m); return { error: null }; } }),
        select: () => { const o = { eq: () => o, range: async () => ({ data: window.__rows, error: null }), then: (a, b) => Promise.resolve({ data: [], error: null }).then(a, b) }; return o; } }) };
      cloud.apply(rows); cloud.on = true;
      const tipos = Object.keys(db).sort().join();
      await cloud.flush();
      const sem = { ups: ups.length, dels: dels.length };
      const antes = __renders; await cloud.refresh(); const rendersRefresh = __renders - antes;
      db.servicos.push({ id: 's1', veiculoId: 'v1', clienteId: 'c1', data: '2026-10-19', km: 81000, descricao: 'Teste', valor: 10 });
      await cloud.flush();
      return { tipos, sem, rendersRefresh, ups: ups.map(u => u.tipo + '|' + u.id), dels };
    }""", rows)
    check('nuvem: lê só clientes, veículos, serviços e configuração', res['tipos'] == 'clientes,config,servicos,veiculos', res['tipos'])
    check('nuvem: ao entrar não envia nem apaga nada', res['sem'] == {'ups': 0, 'dels': 0}, res['sem'])
    check('nuvem: atualização automática não redesenha a tela à toa', res['rendersRefresh'] == 0, res['rendersRefresh'])
    check('nuvem: novo serviço é enviado como tipo "servicos"', res['ups'] == ['servicos|s1'], res['ups'])
    check('nuvem: o app nunca apaga orçamentos/peças por conta própria', res['dels'] == [], res['dels'])
    check('nuvem: sem erros de JavaScript', not errs2, errs2)

    # ---------- computador ----------
    pd, errs3 = contexto(b, mobile=False)
    pd.goto(BASE + '#painel'); pd.wait_for_selector('.stats')
    pd.evaluate("""() => { db.servicos.push(
      { id: 'd1', veiculoId: 'v1', clienteId: 'c1', data: '2026-10-15', km: 85400, descricao: 'Troca de pastilhas dianteiras\\nRevisão dos freios', valor: 280 },
      { id: 'd2', veiculoId: 'v1', clienteId: 'c1', data: '2026-07-02', km: 81200, descricao: 'Troca de óleo 5W30 e filtro', valor: 230 },
      { id: 'd3', veiculoId: 'v2', clienteId: 'c2', data: '2026-10-01', km: 31000, descricao: 'Alinhamento e balanceamento', valor: 120 });
      atualizarKm(getVeiculo('v1')); atualizarKm(getVeiculo('v2')); save(); }""")
    pd.goto(BASE + '#veiculo/v1'); pd.wait_for_selector('.ficha'); shot(pd, 'd-veiculo')
    pd.goto(BASE + '#servicos'); pd.wait_for_selector('.sv-lista'); shot(pd, 'd-servicos')
    check('computador: sem erros de JavaScript', not errs3, errs3)
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
