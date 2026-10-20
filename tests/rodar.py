"""Roda todos os testes do app.

Uso (na pasta do projeto):
    python tests/rodar.py            todos os testes
    python tests/rodar.py nota telas só os testes com esses nomes

Termina com código 0 se tudo passou e 1 se algo falhou (é assim que o
GitHub Actions sabe se pode publicar o site). Os prints de tela gerados
pelos testes ficam em tests/saida/.
Um teste que falha é repetido uma vez: se passar na segunda, conta como
aprovado, mas aparece marcado como "instável" no resumo."""
import glob, os, subprocess, sys, time

AQUI = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(AQUI)
SAIDA = os.path.join(AQUI, 'saida')


def rodar(arquivo):
    nome = os.path.basename(arquivo)[5:-3]
    out = os.path.join(SAIDA, nome)
    os.makedirs(out, exist_ok=True)
    inicio = time.time()
    try:
        r = subprocess.run([sys.executable, arquivo, ROOT, out], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=600, cwd=ROOT)
        codigo, texto = r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        codigo, texto = 1, f'{e.stdout or ""}\nTEMPO ESGOTADO (10 min)'
    return codigo == 0, texto, time.time() - inicio


def main():
    filtros = sys.argv[1:]
    arquivos = sorted(glob.glob(os.path.join(AQUI, 'test_*.py')))
    if filtros:
        arquivos = [a for a in arquivos if any(f in os.path.basename(a) for f in filtros)]
    if not arquivos:
        print('Nenhum teste encontrado.')
        return 1
    resultados = []
    for arq in arquivos:
        nome = os.path.basename(arq)[5:-3]
        print(f'▶ {nome} ...', flush=True)
        ok, texto, seg = rodar(arq)
        instavel = False
        if not ok:
            print(texto)
            print(f'  falhou; repetindo {nome} uma vez...', flush=True)
            ok, texto2, seg2 = rodar(arq)
            instavel = ok
            seg += seg2
            if not ok:
                print(texto2)
        aprovados = texto.count('\nok   ') + texto.startswith('ok   ')
        pulado = 'pulado:' in texto
        resultados.append((nome, ok, instavel, pulado, seg))
        estado = 'OK' if ok else 'FALHOU'
        print(f'  {estado}{" (instável)" if instavel else ""}{" (partes puladas)" if pulado else ""} em {seg:.0f}s'
              + (f', {aprovados} verificações' if ok and not instavel else ''), flush=True)

    print('\n' + '=' * 50)
    for nome, ok, instavel, pulado, seg in resultados:
        marca = '✔' if ok else '✘'
        extra = ' instável' if instavel else ''
        extra += ' (com partes puladas)' if pulado else ''
        print(f' {marca} {nome:<10} {seg:5.0f}s{extra}')
    falhas = [r[0] for r in resultados if not r[1]]
    print('=' * 50)
    if falhas:
        print(f'FALHARAM: {", ".join(falhas)}')
        return 1
    print(f'Todos os {len(resultados)} testes passaram.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
