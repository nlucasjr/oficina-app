"""Confere os arquivos do app sem abrir o navegador: arquivos citados existem,
versão do app.js bate com o version.json e o JavaScript não tem erro de sintaxe."""
import json, os, re, shutil, subprocess, sys

ROOT = sys.argv[1]
ok_all = True
def check(name, cond, extra=''):
    global ok_all
    ok_all &= bool(cond)
    print(('ok   ' if cond else 'FALHOU ') + name + (f'  ({extra})' if extra else ''))

def ler(nome):
    with open(os.path.join(ROOT, nome), encoding='utf-8') as f:
        return f.read()
existe = lambda p: os.path.isfile(os.path.join(ROOT, p))

# arquivos citados no index.html, no manifest e no service worker
html = ler('index.html')
locais = [u for u in re.findall(r'(?:src|href)="([^"#:]+)"', html) if not u.startswith('//')]
faltando = [u for u in locais if not existe(u)]
check('index.html: todos os arquivos citados existem', not faltando, faltando)
manifest = json.loads(ler('manifest.json'))
faltando = [i['src'] for i in manifest.get('icons', []) if not existe(i['src'])]
check('manifest.json: ícones existem', not faltando, faltando)
sw = ler('sw.js')
shell = re.findall(r"'([^']+)'", sw[sw.index('const SHELL'):sw.index('];', sw.index('const SHELL'))])
faltando = [u for u in shell if u != './' and not existe(u)]
check('sw.js: arquivos guardados para uso offline existem', not faltando, faltando)
scripts = re.findall(r'<script src="([^":]+)"', html)
fora = [s for s in scripts if s not in shell]
check('sw.js: todo script do app está na lista offline', not fora, fora)
cdn_html = re.findall(r'src="(https://cdn[^"]+)"', html)
cdn_sw = re.findall(r"'(https://cdn[^']+)'", sw)
check('sw.js: bibliotecas da CDN iguais às do index.html', sorted(cdn_html) == sorted(cdn_sw), (cdn_html, cdn_sw))

# versão
app = ler('app.js')
num = lambda nome: int(re.search(rf'const {nome} = (\d+);', app).group(1))
major, code, patch, compat = num('VERSION_MAJOR'), num('VERSION_CODE'), num('VERSION_PATCH'), num('COMPAT_MINIMA')
vj = json.loads(ler('version.json'))
check('version.json igual ao app.js', vj.get('versionCode') == code and vj.get('versao') == code and vj.get('versionName') == f'{major}.{code}.{patch}',
      (vj, f'{major}.{code}.{patch}'))
check('versão mínima compatível não passa da versão atual', compat <= code, (compat, code))

# sintaxe do JavaScript (precisa do Node; sem ele, pula)
arquivos_js = ['app.js', 'nota.js', 'cloud.js', 'sw.js', 'config.js']
if shutil.which('node'):
    for f in arquivos_js:
        r = subprocess.run(['node', '--check', os.path.join(ROOT, f)], capture_output=True, text=True)
        check(f'{f}: sem erro de sintaxe', r.returncode == 0, r.stderr.strip()[-300:])
else:
    print('pulado: sintaxe do JavaScript (Node não instalado; os testes no navegador também pegam esses erros)')

print('\nRESULTADO:', 'todos passaram' if ok_all else 'HÁ FALHAS')
sys.exit(0 if ok_all else 1)
