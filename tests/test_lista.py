"""Testa a nova lista de serviços (cartões agrupados por mês)."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8136', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8136/'
DB = {"config": {"nome": "Mecânica Rodrigues"},
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "1", "endereco": ""},
                   {"id": "c2", "nome": "Maria <i>Souza</i>", "telefone": "2", "endereco": ""}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0 Trendline Completo", "km": 85400},
                   {"id": "v2", "clienteId": "c2", "placa": "QWE4R56", "marca": "Fiat", "modelo": "Argo", "km": 31000}],
      "servicos": [
        {"id": "s1", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-15", "km": 85400, "descricao": "Troca de pastilhas", "maoDeObra": 180, "pecas": 100, "valor": 280},
        {"id": "s2", "veiculoId": "v2", "clienteId": "c2", "data": "2026-10-08", "km": 31000, "descricao": "Alinhamento", "maoDeObra": 120, "valor": 120},
        {"id": "s3", "veiculoId": "v1", "clienteId": "c1", "data": "2026-09-12", "descricao": "Revisão <script>x</script>", "valor": 500},
        {"id": "s4", "veiculoId": "v2", "clienteId": "c2", "data": "2025-12-30", "km": 20000, "descricao": "Avaliação"},
        {"id": "s5", "veiculoId": "vX", "clienteId": "c1", "data": "", "descricao": "Sem data"}]}
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    for nome, vp, mob in [('celular', {'width': 360, 'height': 800}, True), ('pc', {'width': 1280, 'height': 860}, False)]:
        c = b.new_context(viewport=vp, device_scale_factor=2, is_mobile=mob, has_touch=mob, service_workers='block', locale='pt-BR')
        c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
        c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
        c.add_init_script("localStorage.setItem('oficina_db_v1', %s)" % json.dumps(json.dumps(DB)))
        pg = c.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '#servicos'); pg.wait_for_selector('.sv-lista')
        meses = pg.eval_on_selector_all('.sv-mes-head h2', 'els => els.map(e => e.textContent)')
        check(f'[{nome}] agrupado por mês, mais recente primeiro', meses == ['Outubro de 2026', 'Setembro de 2026', 'Dezembro de 2025', 'Sem data'], meses)
        out = pg.inner_text('.sv-mes:first-child .sv-mes-head span')
        check(f'[{nome}] cabeçalho do mês com quantidade e total', out == '2 serviços · R$\xa0400,00', out)
        dia = pg.inner_text('.sv[data-servico="s1"] .sv-data').split()
        check(f'[{nome}] data em destaque (dia e mês)', dia == ['15', 'OUT'] or dia == ['15', 'out'], dia)
        check(f'[{nome}] km e dono no cartão', '85.400 km' in pg.inner_text('.sv[data-servico="s1"] .sv-meta') and 'João Pereira' in pg.inner_text('.sv[data-servico="s1"] .sv-meta'))
        check(f'[{nome}] só mostra mão de obra quando não tem peças', pg.inner_text('.sv[data-servico="s2"] .sv-partes').strip() == 'Mão de obra R$\xa0120,00')
        check(f'[{nome}] sem divisão: sem linha de partes; sem km: sem chip de km',
              pg.locator('.sv[data-servico="s3"] .sv-partes').count() == 0 and 'km' not in pg.inner_text('.sv[data-servico="s3"] .sv-meta'))
        check(f'[{nome}] sem valor mostra traço', pg.inner_text('.sv[data-servico="s4"] .sv-total') == '—')
        check(f'[{nome}] veículo removido e sem data não quebram', 'Veículo removido' in pg.inner_text('.sv[data-servico="s5"]'))
        check(f'[{nome}] texto com HTML aparece escapado', pg.locator('.sv script').count() == 0 and '<script>' in pg.inner_text('.sv[data-servico="s3"]')
              and '<i>' in pg.inner_text('.sv[data-servico="s2"]'))
        sobre = pg.evaluate("""(() => { for (const el of document.querySelectorAll('.sv')) {
            const t = el.querySelector('.sv-total').getBoundingClientRect(), v = el.querySelector('.sv-veiculo').getBoundingClientRect(),
                  d = el.querySelector('.sv-desc').getBoundingClientRect();
            if (t.left < v.right - 1 && t.bottom > v.top + 1) return 'total sobre veículo ' + el.dataset.servico;
            if (d.top < t.bottom - 1 && d.right > t.left + 1) return 'descrição sob total ' + el.dataset.servico;
            if (el.scrollWidth > el.clientWidth + 1) return 'estoura ' + el.dataset.servico; } return ''; })()""")
        check(f'[{nome}] nada se sobrepõe nem estoura o cartão', not sobre, sobre)
        check(f'[{nome}] sem rolagem lateral', not pg.evaluate('document.documentElement.scrollWidth > innerWidth'))
        pg.screenshot(path=f'{OUT}/servicos-{nome}.png', full_page=True)
        pg.fill('#fBusca', 'zzzz'); pg.wait_for_timeout(400)
        check(f'[{nome}] busca sem resultado', 'Nenhum serviço encontrado' in pg.inner_text('#main') and 'SERVIÇOS\n0' in pg.inner_text('.sv-resumo').upper())
        pg.goto(BASE + '#cliente/c2'); pg.wait_for_selector('.sv-lista')
        check(f'[{nome}] ficha do cliente usa a mesma lista, sem repetir o dono', pg.locator('.sv').count() == 2 and pg.locator('.sv .sv-chip:has-text("Maria")').count() == 0)
        pg.click('.sv[data-servico="s2"]'); pg.wait_for_selector('.sd-valores')
        check(f'[{nome}] tocar no cartão abre a tela do serviço', pg.url.endswith('#servico/s2'))
        check(f'[{nome}] sem erros de JavaScript', not errs, errs)
        c.close()
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
