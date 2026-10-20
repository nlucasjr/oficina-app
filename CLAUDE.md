# Regras de trabalho neste projeto

App de histórico de serviços da **Mecânica Rodrigues** (PWA em HTML/CSS/JS puro, Supabase, GitHub Pages).
Antes de mudar qualquer coisa, leia o `README.md`: ele explica a arquitetura, as regras do app, as versões e os testes.

## Comunicação
- Responder sempre em **português**.
- Textos do app em português do Brasil, linguagem simples de quem usa a oficina no dia a dia.

## Antes de mudar
- **Toda mudança visual** (telas do app ou nota em PDF): fazer **protótipo primeiro** (de preferência com algumas opções lado a lado), mostrar e **esperar aprovação** antes de implementar. O app publicado não muda durante o protótipo.
- Pedido com duas leituras possíveis: seguir a mais provável e **dizer qual foi**.
- Mudança que apaga ou altera dados existentes: **perguntar antes**.

## Ao implementar
- Criar ou atualizar os **testes** em `tests/` junto com cada mudança e rodar todos: `python tests/rodar.py`.
- Conferir o resultado visualmente no **celular e no computador** antes de entregar.
- Atualizar o **README** (e os prints, com `python tests/gerar_prints.py . docs/screenshots`, quando a tela mudar).

## Versão
- `VERSION_CODE` sobe **1 a cada mudança no app**; o nome são os dígitos do código: 119 = **1.1.9**, 120 = 1.2.0, 199 = 1.9.9, 200 = 2.0.0.
- Mudanças só no README ou nos testes **não** mudam a versão.
- Atualizar `version.json` junto com o `app.js` (`versionCode`, `versionName` e `versao`).
- `COMPAT_MINIMA` só sobe quando muda o formato dos dados. Mudou a lista de arquivos do `sw.js`: aumentar o `CACHE`.

## Git e publicação
- Trabalhar direto na branch **`main`**; commits em português dizendo o que mudou e a versão.
- **Pedir confirmação antes de enviar (push)** para a `main`.
- O GitHub Actions roda os testes a cada push e só publica no GitHub Pages se todos passarem.

## Decisões do app (não desfazer sem o dono pedir)
- **Propósito:** histórico de serviços. Sem orçamentos, sem catálogo de peças, sem WhatsApp.
  - Cliente: nome, telefone, endereço. Veículo: placa, marca, modelo, km. Serviço: data, km, o que foi feito, mão de obra, peças e total.
- O km do veículo é atualizado a cada serviço registrado.
- **Celular em primeiro lugar** (usado como PWA, inclusive no iPhone). O botão voltar do celular fecha formulários.
- **Marca/modelo mais evidente que a placa** em todo o app (placa como etiqueta menor).
- **Painel → Últimos serviços:** cliente, placa, modelo e total, um embaixo do outro, nessa ordem.
- **Mensagens** de sucesso/erro no topo da tela; somem ao deslizar para o lado.
- **Excluir** sempre longe do Salvar (no fim da página).
- **Nota em PDF** (modelo aprovado): data do serviço em destaque no canto; faixa "Nota de serviço" abaixo do cabeçalho; veículo com marca/modelo, depois "Placa:" e "Quilometragem:"; **sem** número da nota, assinaturas ou rodapé.
