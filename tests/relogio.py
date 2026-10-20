"""Relógio fixo para os testes: os dados de exemplo são de outubro de 2026
(ex.: "Serviços no mês"), então todo navegador aberto pelos testes acha
que hoje é 19/10/2026, não importa quando o teste roda.
Defina TESTE_DATA (ex.: 2027-03-10T12:00:00-04:00) para testar outra data."""
import os

DATA = os.environ.get('TESTE_DATA', '2026-10-19T12:00:00-04:00')


def fixar(browser):
    original = browser.new_context

    def new_context(*args, **kwargs):
        kwargs.setdefault('timezone_id', 'America/Manaus')
        ctx = original(*args, **kwargs)
        ctx.clock.set_fixed_time(DATA)
        return ctx

    browser.new_context = new_context
    browser.new_page = lambda *a, **k: new_context(*a, **k).new_page()
    return browser
