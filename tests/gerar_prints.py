"""Gera os prints do README com dados de exemplo (fictícios)."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8128', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8128/'

DB = {
  "config": {"nome": "Mecânica Rodrigues"},
  "clientes": [
    {"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "endereco": "Rua das Flores, 120 — Centro"},
    {"id": "c2", "nome": "Maria Souza", "telefone": "(67) 98888-1111", "endereco": "Av. Brasil, 50 — Jardim América"},
    {"id": "c3", "nome": "Carlos Lima", "telefone": "(67) 99777-2020", "endereco": "Rua Sete, 88 — Vila Nova"}],
  "veiculos": [
    {"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 85400},
    {"id": "v2", "clienteId": "c2", "placa": "QWE4R56", "marca": "Fiat", "modelo": "Argo Drive", "km": 31000},
    {"id": "v3", "clienteId": "c3", "placa": "RTY7U89", "marca": "Chevrolet", "modelo": "Onix LT", "km": 52300},
    {"id": "v4", "clienteId": "c1", "placa": "JKL2M34", "marca": "Honda", "modelo": "Fit EX", "km": 120500}],
  "servicos": [
    {"id": "s1", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-15", "km": 85400, "descricao": "Troca de pastilhas dianteiras\nRevisão dos freios", "maoDeObra": 180, "pecas": 100, "valor": 280, "criado": "2026-10-15T10:00:00Z"},
    {"id": "s2", "veiculoId": "v1", "clienteId": "c1", "data": "2026-07-02", "km": 81200, "descricao": "Troca de óleo 5W30 e filtro de óleo", "maoDeObra": 60, "pecas": 170, "valor": 230, "criado": "2026-07-02T10:00:00Z"},
    {"id": "s3", "veiculoId": "v1", "clienteId": "c3", "data": "2025-11-20", "km": 72800, "descricao": "Troca da correia dentada e tensor", "maoDeObra": 350, "pecas": 300, "valor": 650, "criado": "2025-11-20T10:00:00Z"},
    {"id": "s4", "veiculoId": "v2", "clienteId": "c2", "data": "2026-10-08", "km": 31000, "descricao": "Alinhamento e balanceamento", "maoDeObra": 120, "pecas": "", "valor": 120, "criado": "2026-10-08T10:00:00Z"},
    {"id": "s5", "veiculoId": "v3", "clienteId": "c3", "data": "2026-10-03", "km": 52300, "descricao": "Troca do kit de embreagem", "maoDeObra": 450, "pecas": 1000, "valor": 1450, "criado": "2026-10-03T10:00:00Z"},
    {"id": "s6", "veiculoId": "v4", "clienteId": "c1", "data": "2026-09-12", "km": 120500, "descricao": "Revisão completa: óleo, filtros e velas", "maoDeObra": 220, "pecas": 300, "valor": 520, "criado": "2026-09-12T10:00:00Z"},
    {"id": "s7", "veiculoId": "v2", "clienteId": "c2", "data": "2026-04-18", "km": 24900, "descricao": "Troca de óleo e filtro", "maoDeObra": 60, "pecas": 150, "valor": 210, "criado": "2026-04-18T10:00:00Z"}]}

def ctx(b, mobile):
    opts = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True) if mobile \
        else dict(viewport={'width': 1280, 'height': 720}, device_scale_factor=1)
    c = b.new_context(service_workers='block', locale='pt-BR', timezone_id='America/Cuiaba', **opts)
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("localStorage.setItem('oficina_db_v1', %s);" % json.dumps(json.dumps(DB)))
    pg = c.new_page()
    pg.clock.set_fixed_time('2026-10-19T12:00:00-04:00')
    return pg

def abrir(pg, h, sel='#main'):
    pg.goto(BASE + h); pg.wait_for_selector(sel)
    pg.evaluate("setSync('ok')")  # mostra o status normal de uso com a nuvem
    pg.wait_for_timeout(250)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'], env={**os.environ, 'LANG': 'pt_BR.UTF-8', 'LANGUAGE': 'pt_BR'})
    m = ctx(b, True)
    abrir(m, '#painel', '.stats'); m.screenshot(path=f'{OUT}/celular-painel.png')
    abrir(m, '#veiculo/v1', '.ficha'); m.screenshot(path=f'{OUT}/celular-historico.png')
    abrir(m, '#servicos', '.sv-lista'); m.screenshot(path=f'{OUT}/celular-servicos.png')
    abrir(m, '#veiculo/v1', '.ficha'); m.click('[data-act="novoServico"]'); m.wait_for_selector('#mf')
    m.fill('#mf [name="km"]', '86100'); m.fill('#mf [name="descricao"]', 'Troca de óleo 5W30 e filtro de óleo')
    m.fill('#mf [name="maoDeObra"]', '60'); m.fill('#mf [name="pecas"]', '170'); m.locator('#mf [name="pecas"]').blur(); m.wait_for_timeout(200)
    m.screenshot(path=f'{OUT}/celular-registrar.png')
    d = ctx(b, False)
    abrir(d, '#veiculo/v1', '.ficha'); d.screenshot(path=f'{OUT}/computador-historico.png')
    abrir(d, '#servicos', '.sv-lista'); d.screenshot(path=f'{OUT}/computador-servicos.png')
    b.close()
srv.terminate()
print('ok')
