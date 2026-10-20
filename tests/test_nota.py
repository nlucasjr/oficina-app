"""Testa a nota de serviço em PDF: geração, conteúdo e entrega (baixar / compartilhar)."""
import json, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright
import relogio

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8139', '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8139/'
OFICINA = {"nome": "Mecânica Rodrigues", "endereco": "Rua das Oficinas, 450 — Centro, Campo Grande/MS", "telefone": "(67) 99999-0000"}
LONGA = "\n".join([f"Item {i}: troca de peça número {i} com revisão completa do conjunto (ação, ç, ã, é, ô, ü, º, ª, –, “aspas”)" for i in range(1, 46)])
DB = {"config": dict(OFICINA),
      "clientes": [{"id": "c1", "nome": "João Pereira", "telefone": "(67) 99123-4567", "endereco": "Rua das Flores, 120 — Centro"}],
      "veiculos": [{"id": "v1", "clienteId": "c1", "placa": "ABC1D23", "marca": "Volkswagen", "modelo": "Gol 1.0", "km": 85400}],
      "servicos": [
        {"id": "s1", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-15", "km": 85400,
         "descricao": "Troca de pastilhas dianteiras\n- Revisão dos freios (fluido DOT 4)\nAlinhamento e balanceamento", "maoDeObra": 180, "pecas": 1234.5, "valor": 1414.5},
        {"id": "s2", "veiculoId": "v1", "clienteId": "c1", "data": "2025-02-01", "descricao": "Serviço antigo", "valor": 300},
        {"id": "s3", "veiculoId": "v1", "clienteId": "c1", "data": "2026-10-18", "km": 86000, "descricao": LONGA, "maoDeObra": 900, "pecas": 2100, "valor": 3000}]}
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

def pdf_info(path):
    """PDF válido? Devolve (válido, texto com \\f entre páginas, nº de páginas, log)."""
    from pypdf import PdfReader
    try:
        r = PdfReader(path, strict=True)
        paginas = [(pg.extract_text() or '') for pg in r.pages]
    except Exception as e:
        return False, '', 0, repr(e)
    log = ''
    if shutil.which('qpdf'):  # checagem extra quando o qpdf estiver instalado
        chk = subprocess.run(['qpdf', '--check', path], capture_output=True, text=True)
        log = chk.stdout + chk.stderr
        if chk.returncode != 0:
            return False, '', 0, log
    return True, '\f'.join(paginas) + '\f', len(paginas), log

def imagens_jpeg(path):
    from pypdf import PdfReader
    return [i.name for i in PdfReader(path).pages[0].images if i.name.lower().endswith(('.jpg', '.jpeg'))]

def renderizar(path, nome, dpi):
    if shutil.which('pdftoppm'):  # só para olhar a nota; opcional
        subprocess.run(['pdftoppm', '-r', str(dpi), '-png', path, os.path.join(OUT, nome)])

def ctx(b, mob, dados=DB):
    vp = {'width': 390, 'height': 844} if mob else {'width': 1280, 'height': 860}
    c = b.new_context(viewport=vp, is_mobile=mob, has_touch=mob, service_workers='block', locale='pt-BR', accept_downloads=True)
    c.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=''))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.OFICINA_CONFIG={};'))
    c.add_init_script("if(location.protocol.startsWith('http') && !sessionStorage.getItem('s')){localStorage.setItem('oficina_db_v1', %s);sessionStorage.setItem('s','1')}" % json.dumps(json.dumps(dados)))
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    return c, pg, errs

def baixar_nota(pg, sid, nomearq):
    pg.goto(BASE + f'#servico/{sid}'); pg.wait_for_selector('[data-act="gerarNota"]'); pg.wait_for_timeout(300)
    with pg.expect_download() as d:
        pg.click('[data-act="gerarNota"]')
    dl = d.value; path = os.path.join(OUT, nomearq); dl.save_as(path)
    return dl.suggested_filename, path

with sync_playwright() as p:
    b = p.chromium.launch(args=['--lang=pt-BR'])
    relogio.fixar(b)
    c, pg, errs = ctx(b, False)
    nome, path = baixar_nota(pg, 's1', 'nota-s1.pdf')
    check('computador: baixa o PDF com placa e data no nome', nome == 'nota-servico-ABC1D23-15-10-2026.pdf', nome)
    valido, txt, pags, log = pdf_info(path)
    check('PDF válido', valido, log[-300:])
    check('uma página', pags == 1, pags)
    for parte in ['Mecânica Rodrigues', 'Rua das Oficinas, 450 — Centro, Campo Grande/MS', 'Telefone: (67) 99999-0000', 'Nota de serviço', 'DATA DO SERVIÇO', '15/10/2026',
                  'João Pereira', '(67) 99123-4567', 'Rua das Flores, 120 — Centro', 'Placa: ABC1D23', 'Volkswagen Gol 1.0', 'Quilometragem: 85.400 km',
                  'SERVIÇOS REALIZADOS', 'Troca de pastilhas dianteiras', 'Revisão dos freios (fluido DOT 4)',
                  'Alinhamento e balanceamento', 'Mão de obra', 'R$ 180,00', 'Peças', 'R$ 1.234,50', 'TOTAL', 'R$ 1.414,50',
                  ]:
        check(f'nota contém "{parte}"', parte in txt.replace('\xa0', ' '))
    check('veículo: marca/modelo antes da placa', 0 <= txt.find('Volkswagen Gol 1.0') < txt.find('Placa: ABC1D23'), txt[:400])
    check('marcador "-" do texto vira item da lista (sem "- " sobrando)', '- Revisão' not in txt)
    imgs = imagens_jpeg(path)
    check('logo da oficina embutido como imagem', len(imgs) == 1, imgs)
    renderizar(path, 'nota-s1', 80)
    for fora in ['Nº', 'NOTA DE SERVIÇO', 'Km no dia', 'Comprovante', 'Assinatura', 'fiscal', 'Emitida', 'Página']:
        check(f'nota não tem "{fora}"', fora not in txt)
    check('serviço não ganha número de nota', pg.evaluate("getServico('s1').nota") is None)
    check('tela do serviço sem aviso de nota emitida', 'emitida' not in pg.inner_text('#main'))

    # serviço antigo (só total)
    nome, path = baixar_nota(pg, 's2', 'nota-s2.pdf')
    valido, txt, pags, _ = pdf_info(path)
    check('serviço sem km: sem a linha de quilometragem', 'Quilometragem' not in txt)
    check('nome do arquivo com a data do serviço', nome == 'nota-servico-ABC1D23-01-02-2025.pdf', nome)
    check('serviço só com total: sem linhas de mão de obra e peças', valido and 'TOTAL' in txt and 'R$ 300,00' in txt.replace('\xa0', ' ') and 'Mão de obra' not in txt, txt[-400:])
    
    # descrição longa: várias páginas
    nome, path = baixar_nota(pg, 's3', 'nota-s3.pdf')
    valido, txt, pags, log = pdf_info(path)
    check('descrição longa: PDF válido em mais de uma página', valido and pags >= 2, (pags, log[-200:]))
    check('todos os itens aparecem, com acentos', all(f'Item {i}:' in txt for i in range(1, 46)) and 'ação, ç, ã, é, ô, ü, º, ª, –, “aspas”' in txt)
    check('tabela continua na página seguinte, sem rodapé', 'continuação' in txt and 'Página' not in txt)
    check('total na última página', 'R$ 3.000,00' in txt.replace('\xa0', ' ').split('\f')[pags - 1])
    renderizar(path, 'nota-s3', 60)
    check('sem erros de JavaScript (computador)', not errs, errs)
    c.close()

    # sem endereço/telefone: pede os dados da oficina e depois gera
    dados = json.loads(json.dumps(DB)); dados['config'] = {"nome": "Mecânica Rodrigues"}
    c, pg, errs = ctx(b, False, dados)
    pg.goto(BASE + '#servico/s1'); pg.wait_for_selector('[data-act="gerarNota"]')
    pg.click('[data-act="gerarNota"]'); pg.wait_for_selector('#mf')
    check('sem dados da oficina: abre "Dados da oficina" e avisa', pg.inner_text('.modal-card h3') == 'Dados da oficina' and 'endereço e o telefone' in pg.inner_text('#toast'))
    pg.fill('#mf [name="endereco"]', OFICINA['endereco']); pg.fill('#mf [name="telefone"]', OFICINA['telefone'])
    with pg.expect_download() as d:
        pg.click('#mf .btn.primary')
    p2 = os.path.join(OUT, 'nota-depois.pdf'); d.value.save_as(p2)
    check('depois de salvar os dados, a nota é gerada', pdf_info(p2)[0] and 'Rua das Oficinas' in pdf_info(p2)[1])
    pg.goto(BASE + '#config'); pg.wait_for_selector('.oficina-dados')
    check('Ajustes mostra os dados da oficina', 'Rua das Oficinas, 450' in pg.inner_text('.oficina-dados') and '(67) 99999-0000' in pg.inner_text('.oficina-dados'))
    pg.click('[data-act="editOficina"]'); pg.wait_for_selector('#mf'); pg.fill('#mf [name="documento"]', '12.345.678/0001-90'); pg.click('#mf .btn.primary'); pg.wait_for_timeout(200)
    check('CNPJ opcional aparece em Ajustes', '12.345.678/0001-90' in pg.inner_text('.oficina-dados'))
    pg.screenshot(path=f'{OUT}/ajustes.png', full_page=True)
    check('sem erros de JavaScript (dados da oficina)', not errs, errs)
    c.close()

    # celular: usa o compartilhar do aparelho (WhatsApp, Arquivos...)
    c, pg, errs = ctx(b, True)
    pg.add_init_script("""navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = (d) => { window.__share = { nome: d.files[0].name, tipo: d.files[0].type, tam: d.files[0].size }; return Promise.resolve(); };""")
    pg.goto(BASE + '#servico/s1'); pg.wait_for_selector('[data-act="gerarNota"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="gerarNota"]'); pg.wait_for_timeout(500)
    sh = pg.evaluate('window.__share')
    check('celular: abre o compartilhar com o PDF', sh and sh['nome'] == 'nota-servico-ABC1D23-15-10-2026.pdf' and sh['tipo'] == 'application/pdf' and sh['tam'] > 5000, sh)
    pg.evaluate("() => { navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); }")
    with pg.expect_download() as d:
        pg.click('[data-act="gerarNota"]')
    check('celular: se o compartilhar falhar, baixa o arquivo', d.value.suggested_filename.endswith('.pdf'))
    pg.screenshot(path=f'{OUT}/celular-servico.png', full_page=True)
    check('sem erros de JavaScript (celular)', not errs, errs)
    c.close()
    b.close()
srv.terminate()
print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if (ok_all) else 1)
