"""Testa mão de obra, peças e total por serviço."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8131', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8131/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "endereco": "Rua A, 1"}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 80000}],
      "servicos": [{"id": "antigo", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-02", "km": 80000,
                    "descricao": "Serviço registrado antes da divisão", "valor": 300, "criado": "2026-10-02T10:00:00Z"}]}
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

def ctx(b, mobile=True):
    opts = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True) if mobile \
        else dict(viewport={'width': 1280, 'height': 760})
    c = b.new_context(service_workers='block', locale='pt-BR', timezone_id='America/Manaus', **opts)
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("if(!localStorage.getItem('seeded')){localStorage.setItem('oficina_db_v1', %s);localStorage.setItem('seeded','1')}" % json.dumps(json.dumps(DB)))
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.set_fixed_time('2026-10-19T17:00:00-04:00')
    return pg, errs

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    pg, errs = ctx(b)
    get = lambda js: pg.evaluate(js)
    pg.goto(BASE + '#veiculo/v1'); pg.wait_for_selector('.ficha')

    # ---------- novo serviço ----------
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    campos = [n for n in pg.eval_on_selector_all('#mf [name]', 'els => els.map(e => e.name)') if not n.startswith(('nc_', 'nv_'))]
    check('formulário tem mão de obra e peças no lugar de valor', campos == ['veiculoId', 'data', 'km', 'descricao', 'maoDeObra', 'pecas'], campos)
    check('total começa vazio', pg.inner_text('#totalServico') == '—')
    pg.fill('#mf [name="km"]', '81000'); pg.fill('#mf [name="descricao"]', 'Troca de pastilhas')
    pg.fill('#mf [name="maoDeObra"]', '150'); pg.wait_for_timeout(50)
    check('total atualiza ao digitar a mão de obra', pg.inner_text('#totalServico') == 'R$\xa0150,00', pg.inner_text('#totalServico'))
    pg.fill('#mf [name="pecas"]', '235,50'); pg.wait_for_timeout(50)
    check('total soma mão de obra + peças (aceita vírgula)', pg.inner_text('#totalServico') == 'R$\xa0385,50', pg.inner_text('#totalServico'))
    pg.screenshot(path=f'{OUT}/m-form.png')
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    s = get("db.servicos.find(s => s.descricao === 'Troca de pastilhas')")
    check('serviço salvo com mão de obra, peças e total', s and s['maoDeObra'] == 150 and s['pecas'] == 235.5 and s['valor'] == 385.5, s)

    # só mão de obra
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    pg.fill('#mf [name="descricao"]', 'Alinhamento'); pg.fill('#mf [name="maoDeObra"]', '80')
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    s2 = get("db.servicos.find(s => s.descricao === 'Alinhamento')")
    check('só mão de obra: total = mão de obra', s2['valor'] == 80 and s2['pecas'] == '', s2)
    # sem valores
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    pg.fill('#mf [name="descricao"]', 'Avaliação gratuita'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('sem valores: total vazio', get("db.servicos.find(s => s.descricao === 'Avaliação gratuita').valor") == '')

    # ---------- histórico e totais ----------
    tl = pg.inner_text('.sv-lista')
    check('histórico mostra mão de obra e peças do serviço', 'Mão de obra R$\xa0150,00' in tl and 'Peças R$\xa0235,50' in tl, tl)
    check('histórico mostra o total', 'R$\xa0385,50' in tl)
    info = pg.inner_text('.sv-resumo').upper()
    check('ficha do veículo soma mão de obra e peças', 'MÃO DE OBRA\nR$\xa0230,00' in info and 'PEÇAS\nR$\xa0235,50' in info, info)
    check('ficha do veículo soma o total (com o serviço antigo)', 'TOTAL\nR$\xa0765,50' in info, info)
    pg.screenshot(path=f'{OUT}/m-veiculo.png', full_page=True)

    # ---------- serviço antigo (só total) ----------
    editar(pg, '.sv:has-text("antes da divisão")')
    check('serviço antigo: mostra o total guardado', pg.inner_text('#totalServico') == 'R$\xa0300,00')
    check('serviço antigo: explica que foi registrado antes da divisão', any('antes da divisão' in t for t in pg.locator('#mf .hint').all_inner_texts()))
    pg.fill('#mf [name="km"]', '80100'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('editar sem preencher valores mantém o total antigo', get("getServico('antigo').valor") == 300)
    editar(pg, '.sv:has-text("antes da divisão")')
    pg.fill('#mf [name="maoDeObra"]', '100'); pg.fill('#mf [name="pecas"]', '250'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    a = get("getServico('antigo')")
    check('preencher divide e recalcula o total', a['maoDeObra'] == 100 and a['pecas'] == 250 and a['valor'] == 350, a)

    # ---------- listas e painel ----------
    pg.goto(BASE + '#servicos'); pg.wait_for_selector('.sv-lista')
    resumo = pg.inner_text('.sv-resumo').upper()
    check('resumo da lista: mão de obra, peças e total', 'MÃO DE OBRA\nR$\xa0330,00' in resumo and 'PEÇAS\nR$\xa0485,50' in resumo
          and 'TOTAL\nR$\xa0815,50' in resumo, resumo)
    card = '.sv:has-text("Troca de pastilhas")'
    check('cartão do serviço mostra mão de obra, peças e total', pg.inner_text(card + ' .sv-total') == 'R$\xa0385,50'
          and 'Mão de obra R$\xa0150,00' in pg.inner_text(card + ' .sv-partes') and 'Peças R$\xa0235,50' in pg.inner_text(card + ' .sv-partes'), pg.inner_text(card))
    check('celular: serviço sem valores não mostra linhas vazias', pg.locator('.sv:has-text("Avaliação gratuita") .sv-partes').count() == 0)
    pg.screenshot(path=f'{OUT}/m-servicos.png')
    pg.goto(BASE + '#painel'); pg.wait_for_selector('.stats')
    st = pg.inner_text('.stats')
    check('painel: mão de obra e peças do mês', 'Mão de obra no mês\nR$\xa0330,00' in st and 'Peças no mês\nR$\xa0485,50' in st, st)
    check('painel: faturado no mês = total', 'Faturado no mês\nR$\xa0815,50' in st)
    pg.screenshot(path=f'{OUT}/m-painel.png')
    check('sem rolagem lateral no celular', not pg.evaluate('document.documentElement.scrollWidth > innerWidth'))
    check('celular sem erros de JavaScript', not errs, errs)

    # ---------- formatos de valor ----------
    pg.goto(BASE + '#veiculo/v1'); pg.wait_for_selector('.ficha')
    for txt, esperado in [('1.234,56', 1234.56), ('R$ 80', 80), ('80.5', 80.5), ('1.500', 1500)]:
        pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
        pg.fill('#mf [name="descricao"]', 'Formato ' + txt); pg.fill('#mf [name="maoDeObra"]', txt)
        pg.click('#mf .btn.primary'); pg.wait_for_timeout(150)
        got = get(f"db.servicos.find(s => s.descricao === 'Formato {txt}')?.maoDeObra")
        check(f'aceita o valor "{txt}"', got == esperado, got)
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    pg.fill('#mf [name="descricao"]', 'Inválido'); pg.fill('#mf [name="pecas"]', 'abc')
    pg.click('#mf .btn.primary'); pg.wait_for_timeout(150)
    check('valor inválido: avisa e não salva', 'Valor inválido' in pg.inner_text('#toast')
          and not get("db.servicos.some(s => s.descricao === 'Inválido')") and pg.locator('#mf').count() == 1)
    pg.fill('#mf [name="pecas"]', '45'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(150)
    editar(pg, '.sv:has-text("Troca de pastilhas")')
    check('ao editar, valores aparecem com vírgula', pg.input_value('#mf [name="pecas"]') == '235,50', pg.input_value('#mf [name="pecas"]'))
    pg.click('[data-close]'); pg.wait_for_timeout(200)

    # ---------- botão voltar do celular ----------
    pg.goto(BASE + '#veiculos'); pg.wait_for_timeout(100)
    pg.goto(BASE + '#veiculo/v1'); pg.wait_for_selector('.ficha')
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    pg.go_back(); pg.wait_for_timeout(300)
    check('voltar com a janela aberta fecha só a janela', pg.locator('#modal.open').count() == 0 and pg.url.endswith('#veiculo/v1'), pg.url)
    pg.go_back(); pg.wait_for_timeout(300)
    check('voltar de novo vai para a tela anterior', pg.url.endswith('#veiculos'), pg.url)
    pg.go_forward(); pg.wait_for_timeout(300)
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf'); pg.click('[data-close]'); pg.wait_for_timeout(300)
    check('cancelar fecha a janela e continua na mesma tela', pg.url.endswith('#veiculo/v1') and pg.locator('#modal.open').count() == 0)
    pg.go_back(); pg.wait_for_timeout(300)
    check('depois de cancelar, um voltar vai para a tela anterior', pg.url.endswith('#veiculos'), pg.url)
    pg.goto(BASE + '#veiculo/v1'); pg.wait_for_selector('.ficha')
    pg.click('[data-act="novoServico"]'); pg.wait_for_selector('#mf')
    pg.fill('#mf [name="descricao"]', 'Teste voltar'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(300)
    check('salvar fecha a janela e continua na mesma tela', pg.url.endswith('#veiculo/v1') and pg.locator('#modal.open').count() == 0)
    pg.go_back(); pg.wait_for_timeout(300)
    check('depois de salvar, um voltar vai para a tela anterior', not pg.url.endswith('#veiculo/v1'), pg.url)
    # cadastro em sequência: sem cliente, "Novo veículo" abre o cliente e depois o veículo
    pg.evaluate("db.clientes = []; db.veiculos = []; db.servicos = []; save()")
    pg.goto(BASE + '#veiculos'); pg.wait_for_timeout(150)
    pg.click('[data-act="novoVeiculo"]'); pg.wait_for_selector('#mf')
    pg.fill('#mf [name="nome"]', 'Maria'); pg.fill('#mf [name="telefone"]', '67 98888-1111')
    pg.click('#mf .btn.primary')
    try: pg.wait_for_selector('#mf [name="placa"]', timeout=3000)
    except Exception: pass
    check('cadastro em sequência: após o cliente abre o veículo', pg.locator('#mf [name="placa"]').count() == 1)
    pg.go_back(); pg.wait_for_timeout(300)
    check('voltar fecha a janela do veículo e fica em Veículos', pg.locator('#modal.open').count() == 0 and pg.url.endswith('#veiculos'), pg.url)
    check('celular sem erros de JavaScript (final)', not errs, errs)

    pd, errs2 = ctx(b, mobile=False)
    pd.goto(BASE + '#servicos'); pd.wait_for_selector('.sv-lista')
    card = pd.locator('.sv:has-text("Serviço registrado antes da divisão")')
    check('computador: serviço antigo mostra o total, sem linha de mão de obra/peças', card.locator('.sv-total').inner_text() == 'R$\xa0300,00' and card.locator('.sv-partes').count() == 0, card.inner_text())
    check('computador: sem rolagem lateral', not pd.evaluate('document.documentElement.scrollWidth > innerWidth'))
    pd.screenshot(path=f'{OUT}/d-servicos.png')
    pd.goto(BASE + '#veiculo/v1'); pd.click('[data-act="novoServico"]'); pd.wait_for_selector('#mf'); pd.screenshot(path=f'{OUT}/d-form.png')
    check('computador sem erros de JavaScript', not errs2, errs2)
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
