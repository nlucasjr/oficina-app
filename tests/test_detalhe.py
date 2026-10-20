"""Testa a tela de detalhes do serviço."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8138', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8138/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "endereco": ""},
                   {"id": "c2", "nome": "Ana Lima", "telefone": "(67) 2222", "endereco": ""}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 85400}],
      "servicos": [{"id": "s1", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-15", "km": 85400, "descricao": "Troca de pastilhas\nRevisão dos freios <b>x</b>",
                    "maoDeObra": 180, "pecas": 100, "valor": 280, "criado": "2026-10-15T13:00:00Z"},
                   {"id": "s2", "veiculoId": "v1", "clienteId": "c2", "data": "2025-03-02", "km": 60000, "descricao": "Antigo", "valor": 300},
                   {"id": "s3", "veiculoId": "vX", "clienteId": "c1", "data": "", "descricao": "Órfão"}]}
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    for nome, vp, mob in [('celular', {'width': 390, 'height': 844}, True), ('pc', {'width': 1280, 'height': 860}, False)]:
        c = b.new_context(viewport=vp, device_scale_factor=2, is_mobile=mob, has_touch=mob, service_workers='block', locale='pt-BR')
        c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
        c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
        c.add_init_script("if(location.protocol.startsWith('http') && !sessionStorage.getItem('s')){localStorage.setItem('oficina_db_v1', %s);sessionStorage.setItem('s','1')}" % json.dumps(json.dumps(DB)))
        pg = c.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: d.accept())
        t = lambda n: f'[{nome}] {n}'
        get = pg.evaluate

        pg.goto(BASE + '#servicos'); pg.wait_for_selector('.sv-lista')
        pg.click('.sv[data-servico="s1"]'); pg.wait_for_selector('.sd-valores')
        check(t('tocar no serviço abre a tela de detalhes, sem formulário'), pg.url.endswith('#servico/s1') and pg.locator('#modal.open').count() == 0)
        check(t('menu continua marcando Serviços'), pg.locator('#nav a.active').get_attribute('data-r') == 'servicos')
        m = pg.inner_text('#main')
        check(t('data por extenso'), '15 de outubro de 2026' in m)
        check(t('descrição completa, com quebra de linha e HTML escapado'), 'Troca de pastilhas\nRevisão dos freios <b>x</b>' in pg.inner_text('.sd-desc'))
        check(t('km, dono na época, telefone e data de registro'), all(x in m for x in ['85.400 km', 'João Pereira', '(67) 99123-4567', '15/10/2026']))
        linhas = pg.eval_on_selector_all('.sd-linha', 'els => els.map(e => e.innerText.replace(/\\s+/g, " ").trim())')
        check(t('valores: mão de obra, peças e total'), linhas == ['Mão de obra R$ 180,00', 'Peças R$ 100,00', 'Total do serviço R$ 280,00'], linhas)
        check(t('cartão do veículo leva à ficha'), pg.locator('.itens .item[data-href="#veiculo/v1"]').count() == 1)
        check(t('Excluir só no fim da página'), pg.locator('.zona-excluir [data-kind="servico"]').count() == 1 and pg.locator('.ficha [data-act="del"]').count() == 0)
        check(t('sem rolagem lateral'), not get('document.documentElement.scrollWidth > innerWidth'))
        pg.screenshot(path=f'{OUT}/{nome}-detalhe.png', full_page=True)

        # editar a partir da tela
        pg.click('[data-act="editServico"]'); pg.wait_for_selector('#mf')
        check(t('"Editar serviço" abre o formulário preenchido'), pg.inner_text('.modal-card h3') == 'Editar serviço' and pg.input_value('#mf [name="pecas"]') == '100,00')
        check(t('formulário sem Excluir'), pg.locator('#mf [data-del]').count() == 0)
        pg.fill('#mf [name="pecas"]', '150'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(300)
        check(t('ao salvar continua na tela, já atualizada'), pg.url.endswith('#servico/s1') and 'R$\xa0330,00' in pg.inner_text('.sd-total'), pg.inner_text('.sd-total'))
        pg.click('[data-act="editServico"]'); pg.wait_for_selector('#mf'); pg.go_back(); pg.wait_for_timeout(300)
        check(t('voltar do celular fecha só o formulário'), pg.url.endswith('#servico/s1') and pg.locator('#modal.open').count() == 0)

        # voltar
        pg.click('.voltar'); pg.wait_for_timeout(300)
        check(t('"← Voltar" volta para a lista de onde veio'), pg.url.endswith('#servicos'), pg.url)
        pg.goto(BASE + '#veiculo/v1'); pg.wait_for_selector('.ficha')
        pg.locator('.sv[data-servico="s2"]').focus(); pg.keyboard.press('Enter'); pg.wait_for_selector('.sd-valores')
        check(t('Enter no cartão abre a tela (teclado)'), pg.url.endswith('#servico/s2'))
        check(t('serviço antigo: avisa que não tem divisão'), 'sem a divisão' in pg.inner_text('.sd-valores'))
        check(t('dono na época diferente: avisa quem é o dono hoje'), 'Hoje o veículo é de João Pereira' in pg.inner_text('#main'))
        pg.go_back(); pg.wait_for_timeout(300)
        check(t('voltar do celular volta para a ficha do veículo'), pg.url.endswith('#veiculo/v1'))

        # link direto
        pg.goto('about:blank'); pg.goto(BASE + '#servico/s3'); pg.wait_for_selector('.ficha')
        check(t('serviço sem data e sem veículo não quebra'), 'Sem data' in pg.inner_text('#main') and 'veículo deste serviço foi removido' in pg.inner_text('#main'))
        pg.click('.voltar'); pg.wait_for_timeout(300)
        check(t('aberto pelo link, "← Voltar" vai para Serviços'), pg.url.endswith('#servicos'), pg.url)
        pg.goto(BASE + '#servico/naoexiste'); pg.wait_for_timeout(200)
        check(t('serviço inexistente: mensagem de não encontrado'), 'não encontrado' in pg.inner_text('#main'))

        # excluir
        pg.goto(BASE + '#servicos'); pg.wait_for_selector('.sv-lista'); pg.click('.sv[data-servico="s2"]'); pg.wait_for_selector('.sd-valores')
        pg.click('[data-act="del"][data-kind="servico"]'); pg.wait_for_timeout(400)
        check(t('excluir: remove e volta para a lista'), not get("!!getServico('s2')") and pg.url.endswith('#servicos') and 'Serviço excluído' in pg.inner_text('#toast'), pg.url)
        pg.goto('about:blank'); pg.goto(BASE + '#servico/s1'); pg.wait_for_selector('.sd-valores')
        pg.click('[data-act="del"][data-kind="servico"]'); pg.wait_for_timeout(400)
        check(t('excluir aberto pelo link: vai para a ficha do veículo'), pg.url.endswith('#veiculo/v1') and not get("!!getServico('s1')"), pg.url)
        check(t('sem erros de JavaScript'), not errs, errs)
        c.close()
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
