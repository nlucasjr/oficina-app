/* Oficina — gestão de clientes, veículos, peças e orçamentos.
   Dados ficam no localStorage do navegador. Use Configurações > Backup. */

const DB_KEY = "oficina_db_v1";
const STATUS = {
  aberto: "Em aberto",
  aprovado: "Aprovado",
  recusado: "Recusado",
  concluido: "Concluído",
};
const UNIDADES = ["un", "jogo", "par", "L", "ml", "kg", "m", "kit"];

function blankDB() {
  return {
    config: {
      nome: "Mecânica Rodrigues",
      cnpj: "",
      telefone: "67 98131-2502",
      endereco: "Av Aeroporto 359, Campo Grande, Brasil 79112090",
      email: "",
      validade: 1,
      margem: 30,
      logo: "",
      rodape:
        "Garantia de 90 dias para peças e serviços. Valores sujeitos a alteração após a validade.",
    },
    clientes: [],
    veiculos: [],
    pecas: [],
    orcamentos: [],
    seq: 1,
  };
}
function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d) {
      const b = blankDB();
      return { ...b, ...d, config: { ...b.config, ...d.config } };
    }
  } catch (e) {
    /* dados corrompidos: começa vazio */
  }
  return blankDB();
}
let db = loadDB();
function save() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    if (!window.cloud?.on)
      alert(
        "Não foi possível salvar (armazenamento cheio?). Faça um backup e remova a logo se for muito grande.",
      );
  }
  window.cloud?.schedule();
}

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = (v) => {
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const brl = (v) =>
  num(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlPdf = (v) =>
  "R$ " +
  num(v).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? d.split("-").reverse().join("/") : "");
const pad = (n) => String(n).padStart(4, "0");
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const getCliente = (id) => db.clientes.find((c) => c.id === id);
const getVeiculo = (id) => db.veiculos.find((v) => v.id === id);
const getPeca = (id) => db.pecas.find((p) => p.id === id);
const veiculoLabel = (v) =>
  v
    ? `${v.marca || ""} ${v.modelo || ""} ${v.ano || ""}`
        .replace(/\s+/g, " ")
        .trim()
    : "";

function waNumber(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

function totais(o) {
  let pecas = 0,
    servicos = 0,
    custo = 0;
  for (const it of o.itens || []) {
    const sub = num(it.qtd) * num(it.valor);
    if (it.tipo === "servico") servicos += sub;
    else {
      pecas += sub;
      custo += num(it.qtd) * num(it.custo);
    }
  }
  const bruto = pecas + servicos;
  const desconto = Math.min(num(o.desconto), bruto);
  const total = bruto - desconto;
  return {
    pecas,
    servicos,
    bruto,
    desconto,
    total,
    custo,
    lucro: total - custo,
  };
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3500);
}
const badge = (s) => `<span class="badge b-${s}">${STATUS[s] || s}</span>`;
const plate = (p) => (p ? `<span class="plate">${esc(p)}</span>` : "");

// ---------- modal / formulários ----------
function fieldHTML(f, val) {
  const v = val ?? f.default ?? "";
  const cls = f.full ? "full" : "";
  const req = f.required ? "required" : "";
  let input;
  if (f.type === "select") {
    input = `<select name="${f.k}" ${req}>${f.options
      .map(
        (o) =>
          `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? "selected" : ""}>${esc(o.l)}</option>`,
      )
      .join("")}</select>`;
  } else if (f.type === "textarea") {
    input = `<textarea name="${f.k}" rows="3">${esc(v)}</textarea>`;
  } else {
    const step =
      f.type === "number"
        ? `step="${f.step || "any"}" min="0" inputmode="${f.step === "1" ? "numeric" : "decimal"}"`
        : "";
    const extra = f.type === "tel" ? 'inputmode="tel" autocomplete="tel"' : "";
    input = `<input name="${f.k}" type="${f.type || "text"}" value="${esc(v)}" ${step} ${extra} ${req} placeholder="${esc(f.ph || "")}">`;
  }
  return `<div class="${cls}"><label>${esc(f.label)}${f.required ? " *" : ""}</label>${input}</div>`;
}

function formModal(title, fields, data, onSave) {
  const m = $("#modal");
  m.innerHTML = `<div class="modal-card"><h3>${esc(title)}</h3>
    <form id="mf"><div class="grid">${fields.map((f) => fieldHTML(f, data[f.k])).join("")}</div>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button>
    <button class="btn primary">Salvar</button></div></form></div>`;
  m.classList.add("open");
  $("[data-close]", m).onclick = closeModal;
  $("#mf").onsubmit = (e) => {
    e.preventDefault();
    const vals = {};
    for (const f of fields) {
      const el = $(`[name="${f.k}"]`, m);
      vals[f.k] = f.type === "number" ? num(el.value) : el.value.trim();
    }
    if (onSave(vals) !== false) closeModal();
  };
  setTimeout(() => $("input,select,textarea", m)?.focus(), 30);
}
function closeModal() {
  $("#modal").classList.remove("open");
  $("#modal").innerHTML = "";
}
$("#modal").addEventListener("mousedown", (e) => {
  if (e.target.id === "modal") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ---------- cadastros ----------
const clienteFields = () => [
  { k: "nome", label: "Nome", required: true, full: true },
  {
    k: "telefone",
    label: "WhatsApp / Telefone",
    type: "tel",
    required: true,
    ph: "(11) 98888-7777",
  },
  { k: "doc", label: "CPF / CNPJ" },
  { k: "email", label: "E-mail", type: "email" },
  { k: "endereco", label: "Endereço", full: true },
  { k: "obs", label: "Observações", type: "textarea", full: true },
];
function editCliente(id, after) {
  const c = id ? getCliente(id) : {};
  formModal(
    id ? "Editar cliente" : "Novo cliente",
    clienteFields(),
    c,
    (vals) => {
      if (id) Object.assign(c, vals);
      else {
        vals.id = uid();
        vals.criado = today();
        db.clientes.push(vals);
      }
      save();
      toast("Cliente salvo");
      after ? after(id || vals.id) : render();
    },
  );
}

const veiculoFields = () => [
  {
    k: "clienteId",
    label: "Cliente (proprietário)",
    type: "select",
    required: true,
    full: true,
    options: [
      { v: "", l: "— selecione —" },
      ...db.clientes
        .slice()
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((c) => ({ v: c.id, l: c.nome })),
    ],
  },
  { k: "placa", label: "Placa", required: true, ph: "ABC1D23" },
  { k: "marca", label: "Marca", ph: "Volkswagen" },
  { k: "modelo", label: "Modelo", required: true, ph: "Gol 1.0" },
  { k: "ano", label: "Ano", ph: "2018" },
  { k: "cor", label: "Cor" },
  { k: "km", label: "Km atual", type: "number", step: "1" },
  { k: "chassi", label: "Chassi", full: true },
  { k: "obs", label: "Observações", type: "textarea", full: true },
];
function editVeiculo(id, preset = {}, after) {
  if (!db.clientes.length) {
    toast("Cadastre um cliente primeiro");
    return editCliente(null);
  }
  const v = id ? getVeiculo(id) : { ...preset };
  formModal(
    id ? "Editar veículo" : "Novo veículo",
    veiculoFields(),
    v,
    (vals) => {
      vals.placa = vals.placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const dup = db.veiculos.find(
        (x) => x.placa === vals.placa && x.id !== id,
      );
      if (dup) {
        alert("Já existe um veículo com essa placa.");
        return false;
      }
      if (id) Object.assign(v, vals);
      else {
        vals.id = uid();
        vals.criado = today();
        db.veiculos.push(vals);
      }
      save();
      toast("Veículo salvo");
      after ? after(id || vals.id) : render();
    },
  );
}

const pecaFields = () => [
  {
    k: "nome",
    label: "Descrição",
    required: true,
    full: true,
    ph: "Óleo 5W30 sintético",
  },
  { k: "codigo", label: "Código / Ref." },
  { k: "marca", label: "Marca / Fabricante" },
  {
    k: "unidade",
    label: "Unidade",
    type: "select",
    options: UNIDADES.map((u) => ({ v: u, l: u })),
  },
  {
    k: "custo",
    label: "Custo (R$)",
    type: "number",
    step: "0.01",
    required: true,
  },
  {
    k: "preco",
    label: `Preço de venda (R$) — vazio = custo + ${db.config.margem}%`,
    type: "number",
    step: "0.01",
  },
  { k: "estoque", label: "Estoque", type: "number", step: "1" },
];
function editPeca(id) {
  const p = id ? getPeca(id) : {};
  formModal(
    id ? "Editar peça/material" : "Nova peça/material",
    pecaFields(),
    p,
    (vals) => {
      if (!vals.preco)
        vals.preco =
          Math.round(vals.custo * (1 + num(db.config.margem) / 100) * 100) /
          100;
      if (id) Object.assign(p, vals);
      else {
        vals.id = uid();
        db.pecas.push(vals);
      }
      save();
      toast("Peça salva");
      render();
    },
  );
}

function removeItem(kind, id) {
  if (kind === "cliente") {
    if (
      db.veiculos.some((v) => v.clienteId === id) ||
      db.orcamentos.some((o) => o.clienteId === id)
    )
      return alert("Este cliente tem veículos ou orçamentos. Remova-os antes.");
    if (!confirm("Excluir este cliente?")) return;
    db.clientes = db.clientes.filter((c) => c.id !== id);
    save();
    location.hash = "#clientes";
  } else if (kind === "veiculo") {
    if (db.orcamentos.some((o) => o.veiculoId === id))
      return alert(
        "Este veículo tem histórico de orçamentos. Remova-os antes.",
      );
    if (!confirm("Excluir este veículo?")) return;
    db.veiculos = db.veiculos.filter((v) => v.id !== id);
    save();
    location.hash = "#veiculos";
  } else if (kind === "peca") {
    if (
      !confirm("Excluir esta peça do catálogo? Orçamentos já feitos não mudam.")
    )
      return;
    db.pecas = db.pecas.filter((p) => p.id !== id);
    save();
    render();
  } else if (kind === "orcamento") {
    if (!confirm("Excluir este orçamento definitivamente?")) return;
    db.orcamentos = db.orcamentos.filter((o) => o.id !== id);
    save();
    location.hash = "#orcamentos";
  }
}

// ---------- telas ----------
function orcRows(list, showVeic = true) {
  if (!list.length)
    return `<tr><td colspan="6" class="empty">Nenhum orçamento</td></tr>`;
  return list
    .slice()
    .sort((a, b) => b.numero - a.numero)
    .map((o) => {
      const c = getCliente(o.clienteId),
        v = getVeiculo(o.veiculoId);
      return `<tr class="click" data-href="#orcamento/${o.id}">
      <td class="c1"><b>#${pad(o.numero)}</b></td><td class="c2 o9 sub">${fmtDate(o.data)}</td>
      <td class="c1 strong">${esc(c?.nome || "—")}</td>
      ${showVeic ? `<td class="c1 sub">${plate(v?.placa)} ${esc(veiculoLabel(v))}</td>` : ""}
      <td class="c2">${badge(o.status)}</td><td class="num c2"><b>${brl(totais(o).total)}</b></td></tr>`;
    })
    .join("");
}
const orcHead = (showVeic = true) =>
  `<tr><th>Nº</th><th>Data</th><th>Cliente</th>${showVeic ? "<th>Veículo</th>" : ""}<th>Status</th><th class="num">Total</th></tr>`;

const views = {
  painel() {
    const mes = today().slice(0, 7);
    const doMes = db.orcamentos.filter((o) => (o.data || "").startsWith(mes));
    const fechados = doMes.filter(
      (o) => o.status === "aprovado" || o.status === "concluido",
    );
    const fat = fechados.reduce((s, o) => s + totais(o).total, 0);
    const lucro = fechados.reduce((s, o) => s + totais(o).lucro, 0);
    return `<div class="page-head"><h1>Painel</h1>
      <div class="actions"><a class="btn primary" href="#orcamento/novo">+ Novo orçamento</a></div></div>
      <div class="stats">
        <div class="stat"><div class="l">Clientes</div><div class="v">${db.clientes.length}</div></div>
        <div class="stat"><div class="l">Veículos</div><div class="v">${db.veiculos.length}</div></div>
        <div class="stat"><div class="l">Orçamentos em aberto</div><div class="v">${db.orcamentos.filter((o) => o.status === "aberto").length}</div></div>
        <div class="stat"><div class="l">Aprovado/concluído no mês</div><div class="v">${brl(fat)}</div></div>
        <div class="stat"><div class="l">Lucro estimado no mês</div><div class="v">${brl(lucro)}</div></div>
      </div>
      <div class="card"><h2>Últimos orçamentos</h2><div class="table-wrap"><table class="list">
        <thead>${orcHead()}</thead><tbody>${orcRows(
          db.orcamentos
            .slice()
            .sort((a, b) => b.numero - a.numero)
            .slice(0, 8),
        )}</tbody></table></div></div>`;
  },

  orcamentos(_, q) {
    const st = q.status || "";
    const busca = norm(q.q);
    const list = db.orcamentos.filter((o) => {
      if (st && o.status !== st) return false;
      if (!busca) return true;
      const c = getCliente(o.clienteId),
        v = getVeiculo(o.veiculoId);
      return norm(
        `${o.numero} ${c?.nome} ${v?.placa} ${veiculoLabel(v)}`,
      ).includes(busca);
    });
    return `<div class="page-head"><h1>Orçamentos</h1><a class="btn primary" href="#orcamento/novo">+ Novo orçamento</a></div>
      <div class="toolbar">
        <input id="fBusca" placeholder="Buscar nº, cliente, placa..." value="${esc(q.q || "")}">
        <select id="fStatus"><option value="">Todos os status</option>
          ${Object.entries(STATUS)
            .map(
              ([k, l]) =>
                `<option value="${k}" ${st === k ? "selected" : ""}>${l}</option>`,
            )
            .join("")}</select>
      </div>
      <div class="card"><div class="table-wrap"><table class="list"><thead>${orcHead()}</thead><tbody>${orcRows(list)}</tbody></table></div></div>`;
  },

  clientes(_, q) {
    const busca = norm(q.q);
    const list = db.clientes
      .filter(
        (c) =>
          !busca || norm(`${c.nome} ${c.telefone} ${c.doc}`).includes(busca),
      )
      .sort((a, b) => a.nome.localeCompare(b.nome));
    return `<div class="page-head"><h1>Clientes</h1><button class="btn primary" data-act="novoCliente">+ Novo cliente</button></div>
      <div class="toolbar"><input id="fBusca" placeholder="Buscar nome, telefone, CPF..." value="${esc(q.q || "")}"></div>
      <div class="card"><div class="table-wrap"><table class="list">
      <thead><tr><th>Nome</th><th>WhatsApp</th><th>Veículos</th><th class="num">Orçamentos</th></tr></thead><tbody>
      ${
        list.length
          ? list
              .map(
                (c) => `<tr class="click" data-href="#cliente/${c.id}">
        <td class="c1 strong">${esc(c.nome)}</td><td class="c1 sub">${esc(c.telefone)}</td>
        <td class="c1">${
          db.veiculos
            .filter((v) => v.clienteId === c.id)
            .map((v) => plate(v.placa))
            .join(" ") || '<span class="muted">—</span>'
        }</td>
        <td class="num c2 sub" data-l="Orçamentos">${db.orcamentos.filter((o) => o.clienteId === c.id).length}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="4" class="empty">Nenhum cliente cadastrado</td></tr>`
      }
      </tbody></table></div></div>`;
  },

  cliente([id]) {
    const c = getCliente(id);
    if (!c) return notFound();
    const veics = db.veiculos.filter((v) => v.clienteId === id);
    const orcs = db.orcamentos.filter((o) => o.clienteId === id);
    return `<div class="page-head"><div><a href="#clientes" class="muted">← Clientes</a><h1>${esc(c.nome)}</h1></div>
      <div class="actions">
        <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${waNumber(c.telefone)}">WhatsApp</a>
        <button class="btn" data-act="editCliente" data-id="${id}">Editar</button>
        <button class="btn danger" data-act="del" data-kind="cliente" data-id="${id}">Excluir</button>
      </div></div>
      <div class="card"><div class="info-list">
        <div><span>WhatsApp</span>${esc(c.telefone)}</div><div><span>CPF/CNPJ</span>${esc(c.doc) || "—"}</div>
        <div><span>E-mail</span>${esc(c.email) || "—"}</div><div><span>Endereço</span>${esc(c.endereco) || "—"}</div>
        ${c.obs ? `<div style="grid-column:1/-1"><span>Observações</span>${esc(c.obs)}</div>` : ""}
      </div></div>
      <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Veículos</h2>
        <button class="btn sm" data-act="novoVeiculo" data-cliente="${id}">+ Adicionar veículo</button></div>
        <div class="table-wrap"><table class="list"><thead><tr><th>Placa</th><th>Veículo</th><th>Km</th><th></th></tr></thead><tbody>
        ${
          veics.length
            ? veics
                .map(
                  (
                    v,
                  ) => `<tr class="click" data-href="#veiculo/${v.id}"><td class="c2">${plate(v.placa)}</td>
          <td class="c1 strong">${esc(veiculoLabel(v)) || "—"}</td><td class="c1 sub" data-l="Km">${v.km ? num(v.km).toLocaleString("pt-BR") : "—"}</td>
          <td class="num c2"><a class="btn sm" href="#orcamento/novo?cliente=${id}&veiculo=${v.id}" data-stop>Orçar</a></td></tr>`,
                )
                .join("")
            : `<tr><td colspan="4" class="empty">Nenhum veículo</td></tr>`
        }
        </tbody></table></div></div>
      <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Orçamentos</h2>
        <a class="btn sm" href="#orcamento/novo?cliente=${id}">+ Novo orçamento</a></div>
        <div class="table-wrap"><table class="list"><thead>${orcHead()}</thead><tbody>${orcRows(orcs)}</tbody></table></div></div>`;
  },

  veiculos(_, q) {
    const busca = norm(q.q);
    const list = db.veiculos
      .filter(
        (v) =>
          !busca ||
          norm(
            `${v.placa} ${veiculoLabel(v)} ${getCliente(v.clienteId)?.nome}`,
          ).includes(busca),
      )
      .sort((a, b) => a.placa.localeCompare(b.placa));
    return `<div class="page-head"><h1>Veículos</h1><button class="btn primary" data-act="novoVeiculo">+ Novo veículo</button></div>
      <div class="toolbar"><input id="fBusca" placeholder="Buscar placa, modelo, cliente..." value="${esc(q.q || "")}"></div>
      <div class="card"><div class="table-wrap"><table class="list">
      <thead><tr><th>Placa</th><th>Veículo</th><th>Cliente</th><th>Último serviço</th></tr></thead><tbody>
      ${
        list.length
          ? list
              .map((v) => {
                const ult = db.orcamentos
                  .filter((o) => o.veiculoId === v.id)
                  .sort((a, b) =>
                    (b.data || "").localeCompare(a.data || ""),
                  )[0];
                return `<tr class="click" data-href="#veiculo/${v.id}"><td class="c2">${plate(v.placa)}</td><td class="c1 strong">${esc(veiculoLabel(v)) || "—"}</td>
          <td class="c1 sub">${esc(getCliente(v.clienteId)?.nome || "—")}</td><td class="c1 sub" data-l="Último serviço">${ult ? fmtDate(ult.data) : "—"}</td></tr>`;
              })
              .join("")
          : `<tr><td colspan="4" class="empty">Nenhum veículo cadastrado</td></tr>`
      }
      </tbody></table></div></div>`;
  },

  veiculo([id]) {
    const v = getVeiculo(id);
    if (!v) return notFound();
    const c = getCliente(v.clienteId);
    const hist = db.orcamentos
      .filter((o) => o.veiculoId === id)
      .sort(
        (a, b) =>
          (b.data || "").localeCompare(a.data || "") || b.numero - a.numero,
      );
    const gasto = hist
      .filter((o) => o.status === "aprovado" || o.status === "concluido")
      .reduce((s, o) => s + totais(o).total, 0);
    return `<div class="page-head"><div><a href="#veiculos" class="muted">← Veículos</a>
      <h1>${plate(v.placa)} ${esc(veiculoLabel(v))}</h1></div>
      <div class="actions">
        <a class="btn primary" href="#orcamento/novo?cliente=${v.clienteId}&veiculo=${id}">+ Novo orçamento</a>
        <button class="btn" data-act="editVeiculo" data-id="${id}">Editar</button>
        <button class="btn danger" data-act="del" data-kind="veiculo" data-id="${id}">Excluir</button>
      </div></div>
      <div class="card"><div class="info-list">
        <div><span>Proprietário</span>${c ? `<a href="#cliente/${c.id}">${esc(c.nome)}</a>` : "—"}</div>
        <div><span>Km atual</span>${v.km ? num(v.km).toLocaleString("pt-BR") + " km" : "—"}</div>
        <div><span>Cor</span>${esc(v.cor) || "—"}</div><div><span>Chassi</span>${esc(v.chassi) || "—"}</div>
        <div><span>Total em serviços</span>${brl(gasto)}</div>
        ${v.obs ? `<div style="grid-column:1/-1"><span>Observações</span>${esc(v.obs)}</div>` : ""}
      </div></div>
      <div class="card"><h2>Histórico do veículo</h2>
      ${
        hist.length
          ? `<div class="timeline">${hist
              .map(
                (o) => `<div class="tl-item">
          <div><a href="#orcamento/${o.id}"><b>${fmtDate(o.data)} · Orçamento #${pad(o.numero)}</b></a> ${badge(o.status)}
          <span class="muted"> ${o.km ? "· " + num(o.km).toLocaleString("pt-BR") + " km" : ""} · ${brl(totais(o).total)}</span></div>
          ${o.problema ? `<div class="muted" style="margin-top:4px">${esc(o.problema)}</div>` : ""}
          <ul>${(o.itens || []).map((it) => `<li>${esc(it.descricao)}${it.tipo !== "servico" ? ` (${num(it.qtd)} ${esc(it.unidade || "un")})` : ""}</li>`).join("")}</ul>
        </div>`,
              )
              .join("")}</div>`
          : `<p class="empty">Nenhum serviço registrado ainda.</p>`
      }
      </div>`;
  },

  pecas(_, q) {
    const busca = norm(q.q);
    const list = db.pecas
      .filter(
        (p) =>
          !busca || norm(`${p.nome} ${p.codigo} ${p.marca}`).includes(busca),
      )
      .sort((a, b) => a.nome.localeCompare(b.nome));
    return `<div class="page-head"><h1>Peças e materiais</h1><button class="btn primary" data-act="novaPeca">+ Nova peça</button></div>
      <div class="toolbar"><input id="fBusca" placeholder="Buscar descrição, código, marca..." value="${esc(q.q || "")}"></div>
      <div class="card"><div class="table-wrap"><table class="list">
      <thead><tr><th>Descrição</th><th>Código</th><th>Un.</th><th class="num">Custo</th><th class="num">Venda</th><th class="num">Margem</th><th class="num">Estoque</th><th></th></tr></thead><tbody>
      ${
        list.length
          ? list
              .map((p) => {
                const mg = num(p.custo)
                  ? ((num(p.preco) / num(p.custo) - 1) * 100).toFixed(0) + "%"
                  : "—";
                return `<tr><td class="c1"><b>${esc(p.nome)}</b>${p.marca ? `<div class="muted" style="font-size:13px">${esc(p.marca)}</div>` : ""}</td>
          <td class="c1 sub" data-l="Cód.">${esc(p.codigo) || "—"}</td><td class="hide-sm">${esc(p.unidade || "un")}</td>
          <td class="num c2 sub" data-l="Custo">${brl(p.custo)}</td><td class="num c2 o-1"><b>${brl(p.preco)}</b></td><td class="num hide-sm">${mg}</td>
          <td class="num c2 sub" data-l="Estoque">${p.estoque !== undefined && p.estoque !== "" ? num(p.estoque) : "—"}</td>
          <td class="num row-actions"><div class="actions" style="justify-content:flex-end">
            <button class="btn sm" data-act="editPeca" data-id="${p.id}">Editar</button>
            <button class="btn sm danger" data-act="del" data-kind="peca" data-id="${p.id}" aria-label="Excluir">✕</button></div></td></tr>`;
              })
              .join("")
          : `<tr><td colspan="8" class="empty">Nenhuma peça cadastrada</td></tr>`
      }
      </tbody></table></div></div>`;
  },

  config() {
    const c = db.config;
    return `<div class="page-head"><h1>Configurações</h1></div>
      <div class="card"><h2>Dados da oficina (aparecem no PDF)</h2>
      <form id="cfgForm"><div class="grid">
        ${fieldHTML({ k: "nome", label: "Nome da oficina", required: true, full: true }, c.nome)}
        ${fieldHTML({ k: "cnpj", label: "CNPJ" }, c.cnpj)}
        ${fieldHTML({ k: "telefone", label: "Telefone / WhatsApp", type: "tel" }, c.telefone)}
        ${fieldHTML({ k: "email", label: "E-mail" }, c.email)}
        ${fieldHTML({ k: "endereco", label: "Endereço", full: true }, c.endereco)}
        ${fieldHTML({ k: "validade", label: "Validade padrão (dias)", type: "number", step: "1" }, c.validade)}
        ${fieldHTML({ k: "margem", label: "Margem padrão sobre peças (%)", type: "number", step: "1" }, c.margem)}
        ${fieldHTML({ k: "rodape", label: "Texto de rodapé / garantia", type: "textarea", full: true }, c.rodape)}
        <div class="full"><label>Logo (PNG/JPG, opcional)</label>
          <div class="actions" style="align-items:center">
            ${c.logo ? `<img src="${c.logo}" alt="logo" style="height:48px;border-radius:6px;border:1px solid var(--border)">` : ""}
            <input type="file" id="logoInput" accept="image/png,image/jpeg" style="max-width:280px">
            ${c.logo ? `<button type="button" class="btn sm danger" data-act="rmLogo">Remover logo</button>` : ""}
          </div></div>
      </div><div class="modal-actions"><button class="btn primary">Salvar configurações</button></div></form></div>
      <div class="card"><h2>Backup dos dados</h2>
        <p class="muted">Os dados ficam salvos neste navegador. Faça backup com frequência e use o arquivo para passar os dados para outro computador.</p>
        <div class="actions"><button class="btn" data-act="exportar">⬇ Baixar backup</button>
        <label class="btn" style="margin:0;color:var(--text)">⬆ Restaurar backup<input type="file" id="importInput" accept="application/json" hidden></label></div>
      </div>`;
  },
};

function notFound() {
  return `<div class="card empty">Registro não encontrado. <a href="#painel">Voltar ao painel</a></div>`;
}

// ---------- editor de orçamento ----------
let draft = null;

function novoDraft(q) {
  const val = new Date();
  val.setDate(val.getDate() + num(db.config.validade || 15));
  const v = getVeiculo(q.veiculo);
  return {
    id: null,
    numero: null,
    data: today(),
    validade: val.toISOString().slice(0, 10),
    status: "aberto",
    clienteId: q.cliente || v?.clienteId || "",
    veiculoId: q.veiculo || "",
    km: v?.km || "",
    problema: "",
    obs: "",
    desconto: 0,
    pagamento: "",
    prazo: "",
    itens: [],
  };
}

function editorView(id, q) {
  if (id === "novo") {
    if (!draft || draft.id || draft._q !== JSON.stringify(q)) {
      draft = novoDraft(q);
      draft._q = JSON.stringify(q);
    }
  } else {
    const o = db.orcamentos.find((x) => x.id === id);
    if (!o) return notFound();
    if (!draft || draft.id !== id) draft = structuredClone(o);
  }
  const d = draft;
  const clientes = db.clientes
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return `<div class="page-head"><div><a href="#orcamentos" class="muted">← Orçamentos</a>
    <h1>${d.id ? "Orçamento #" + pad(d.numero) : "Novo orçamento"}</h1></div>
    <div class="actions">
      ${window.cloud?.on ? `<button class="btn" data-act="copiarLink" title="Link para o cliente ver e aprovar">🔗 Copiar link</button>` : ""}
      ${d.id ? `<button class="btn danger" data-act="del" data-kind="orcamento" data-id="${d.id}">Excluir</button>` : ""}
    </div></div>
    ${respostaClienteHTML(d)}

    <div class="card"><div class="grid">
      <div><label>Cliente *</label><div style="display:flex;gap:6px">
        <select id="eCliente"><option value="">— selecione —</option>${clientes.map((c) => `<option value="${c.id}" ${c.id === d.clienteId ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}</select>
        <button class="btn" data-act="quickCliente" title="Novo cliente">+</button></div></div>
      <div><label>Veículo *</label><div style="display:flex;gap:6px">
        <select id="eVeiculo">${veicOptions(d)}</select>
        <button class="btn" data-act="quickVeiculo" title="Novo veículo">+</button></div></div>
      <div><label>Km na entrada</label><input id="eKm" data-f="km" type="number" inputmode="numeric" min="0" value="${esc(d.km)}"></div>
      <div><label>Status</label><select data-f="status">${Object.entries(STATUS)
        .map(
          ([k, l]) =>
            `<option value="${k}" ${d.status === k ? "selected" : ""}>${l}</option>`,
        )
        .join("")}</select></div>
      <div><label>Data</label><input type="date" data-f="data" value="${esc(d.data)}"></div>
      <div><label>Válido até</label><input type="date" data-f="validade" value="${esc(d.validade)}"></div>
      <div class="full"><label>Problema relatado / diagnóstico</label><textarea data-f="problema" rows="2">${esc(d.problema)}</textarea></div>
    </div></div>

    <div class="card"><div class="page-head items-head" style="margin-bottom:10px"><h2>Itens</h2>
      <div class="actions"><button class="btn sm" data-act="addPeca">+ Peça / material</button>
      <button class="btn sm" data-act="addServico">+ Serviço / mão de obra</button></div></div>
      <div class="table-wrap"><table class="items"><thead><tr><th>Tipo</th><th>Descrição</th><th class="w-qtd">Qtd</th>
        <th class="w-val">Custo un. <span title="Interno, não sai no PDF">ⓘ</span></th><th class="w-val">Valor un.</th><th class="num">Subtotal</th><th></th></tr></thead>
        <tbody id="itemsBody">${itemsRows(d)}</tbody></table></div>
      <div class="editor-foot">
        <div class="grid">
          <div><label>Desconto (R$)</label><input type="number" inputmode="decimal" min="0" step="0.01" data-f="desconto" value="${esc(d.desconto || "")}"></div>
          <div><label>Prazo de execução</label><input data-f="prazo" value="${esc(d.prazo)}" placeholder="2 dias úteis"></div>
          <div class="full"><label>Forma de pagamento</label><input data-f="pagamento" value="${esc(d.pagamento)}" placeholder="PIX, cartão em até 3x..."></div>
          <div class="full"><label>Observações (saem no PDF)</label><textarea data-f="obs" rows="2">${esc(d.obs)}</textarea></div>
        </div>
        <div class="totals" id="totals">${totalsHTML(d)}</div>
      </div></div>

    <div class="sticky-actions">
      <button class="btn" data-act="pdf">📄 <span class="l-long">Baixar PDF</span><span class="l-short">PDF</span></button>
      <button class="btn wa" data-act="whats"><span class="l-long">Enviar no WhatsApp</span><span class="l-short">WhatsApp</span></button>
      <button class="btn primary" data-act="salvarOrc"><span class="l-long">Salvar orçamento</span><span class="l-short">Salvar</span></button>
    </div>`;
}

// Aviso no editor quando o cliente respondeu pelo link
function respostaClienteHTML(d) {
  const r = d.resposta;
  if (!r?.acao) return "";
  const em = r.em ? new Date(r.em) : null;
  const quando =
    em && !isNaN(em)
      ? ` em ${em.toLocaleDateString("pt-BR")} às ${em.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
      : "";
  const ok = r.acao === "aprovado";
  return `<div class="card resp-cliente ${ok ? "resp-ok" : "resp-no"}">
    <b>${ok ? "✓ Cliente aprovou" : "✕ Cliente recusou"} pelo link</b>${r.nome ? ` (${esc(r.nome)})` : ""}${quando}.</div>`;
}

function veicOptions(d) {
  const list = db.veiculos.filter((v) => v.clienteId === d.clienteId);
  if (!d.clienteId) return `<option value="">— escolha o cliente —</option>`;
  if (!list.length)
    return `<option value="">— cliente sem veículo, clique + —</option>`;
  return (
    `<option value="">— selecione —</option>` +
    list
      .map(
        (v) =>
          `<option value="${v.id}" ${v.id === d.veiculoId ? "selected" : ""}>${esc(v.placa)} · ${esc(veiculoLabel(v))}</option>`,
      )
      .join("")
  );
}

function itemsRows(d) {
  if (!d.itens.length)
    return `<tr><td colspan="7" class="empty">Adicione peças e serviços</td></tr>`;
  const pecasOpts = db.pecas
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return d.itens
    .map((it, i) => {
      const isP = it.tipo !== "servico";
      const desc = isP
        ? `<select data-i="${i}" data-k="pecaId" style="margin-bottom:4px"><option value="">— peça avulsa —</option>${pecasOpts
            .map(
              (p) =>
                `<option value="${p.id}" ${p.id === it.pecaId ? "selected" : ""}>${esc(p.nome)}${p.codigo ? " · " + esc(p.codigo) : ""}</option>`,
            )
            .join("")}</select>
         <input data-i="${i}" data-k="descricao" value="${esc(it.descricao)}" placeholder="Descrição da peça">`
        : `<input data-i="${i}" data-k="descricao" value="${esc(it.descricao)}" placeholder="Ex.: Troca de pastilhas dianteiras">`;
      return `<tr><td class="it-tipo"><span class="tag ${isP ? "t-peca" : "t-serv"}">${isP ? "Peça" : "Serviço"}</span></td><td class="it-desc">${desc}</td>
      <td class="it-qtd" data-l="Qtd"><input class="w-qtd" type="number" inputmode="decimal" min="0" step="any" data-i="${i}" data-k="qtd" value="${esc(it.qtd)}"></td>
      <td class="it-custo" data-l="Custo un.">${isP ? `<input class="w-val" type="number" inputmode="decimal" min="0" step="0.01" data-i="${i}" data-k="custo" value="${esc(it.custo)}">` : '<span class="muted">—</span>'}</td>
      <td class="it-valor" data-l="Valor un."><input class="w-val" type="number" inputmode="decimal" min="0" step="0.01" data-i="${i}" data-k="valor" value="${esc(it.valor)}"></td>
      <td class="num it-sub"><span class="it-sub-l">Subtotal </span><b data-sub="${i}">${brl(num(it.qtd) * num(it.valor))}</b></td>
      <td class="it-rm"><button class="btn sm danger" data-act="rmItem" data-i="${i}" aria-label="Remover item">✕</button></td></tr>`;
    })
    .join("");
}

function totalsHTML(d) {
  const t = totais(d);
  return `<div><span>Peças e materiais</span><span>${brl(t.pecas)}</span></div>
    <div><span>Serviços / mão de obra</span><span>${brl(t.servicos)}</span></div>
    ${t.desconto ? `<div><span>Desconto</span><span>− ${brl(t.desconto)}</span></div>` : ""}
    <div class="grand"><span>Total</span><span>${brl(t.total)}</span></div>
    <div class="internal"><span>Custo de material (interno)</span><span>${brl(t.custo)}</span></div>
    <div class="internal"><span>Lucro estimado (interno)</span><span>${brl(t.lucro)}</span></div>`;
}

function bindEditor() {
  const main = $("#main");
  main.addEventListener("input", onEditorInput);
  main.addEventListener("change", onEditorChange);
}
function onEditorInput(e) {
  if (!draft || !location.hash.startsWith("#orcamento/")) return;
  const el = e.target;
  if (el.dataset.f) {
    draft[el.dataset.f] = el.value;
    if (el.dataset.f === "desconto") $("#totals").innerHTML = totalsHTML(draft);
  }
  if (el.dataset.i !== undefined && el.dataset.k && el.dataset.k !== "pecaId") {
    const it = draft.itens[+el.dataset.i];
    it[el.dataset.k] = el.value;
    const sub = $(`[data-sub="${el.dataset.i}"]`);
    if (sub) sub.textContent = brl(num(it.qtd) * num(it.valor));
    $("#totals").innerHTML = totalsHTML(draft);
  }
}
function onEditorChange(e) {
  if (!draft || !location.hash.startsWith("#orcamento/")) return;
  const el = e.target;
  if (el.id === "eCliente") {
    draft.clienteId = el.value;
    draft.veiculoId = "";
    const vs = db.veiculos.filter((v) => v.clienteId === el.value);
    if (vs.length === 1) {
      draft.veiculoId = vs[0].id;
      draft.km = vs[0].km || draft.km;
    }
    $("#eVeiculo").innerHTML = veicOptions(draft);
    $("#eKm").value = draft.km || "";
  } else if (el.id === "eVeiculo") {
    draft.veiculoId = el.value;
    const v = getVeiculo(el.value);
    if (v?.km && !draft.km) {
      draft.km = v.km;
      $("#eKm").value = v.km;
    }
  } else if (el.dataset.k === "pecaId") {
    const it = draft.itens[+el.dataset.i];
    const p = getPeca(el.value);
    it.pecaId = el.value;
    if (p)
      Object.assign(it, {
        descricao: p.nome + (p.marca ? " " + p.marca : ""),
        custo: p.custo,
        valor: p.preco,
        unidade: p.unidade || "un",
      });
    $("#itemsBody").innerHTML = itemsRows(draft);
    $("#totals").innerHTML = totalsHTML(draft);
  }
}

function validarDraft() {
  if (!draft.clienteId) {
    toast("Selecione o cliente");
    return false;
  }
  if (!draft.veiculoId) {
    toast("Selecione o veículo");
    return false;
  }
  if (!draft.itens.length) {
    toast("Adicione pelo menos um item");
    return false;
  }
  return true;
}

// ---------- link de aprovação do cliente ----------
// Código aleatório (128 bits) que identifica o orçamento na página pública.
function novoToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
// Link que o cliente abre para ver e aprovar/recusar. Só existe com a nuvem
// ligada, porque a página pública lê o orçamento do Supabase.
function linkOrcamento(o) {
  if (!window.cloud?.on || !o?.token) return "";
  const cfg = window.OFICINA_CONFIG || {};
  const base = cfg.linkBase || new URL(".", location.href).href;
  return new URL("orcamento.html?t=" + encodeURIComponent(o.token), base).href;
}

// Próximo número de orçamento. Com a nuvem ligada, quem decide é o banco
// (função proximo_numero_orcamento no Supabase), então dois aparelhos nunca
// recebem o mesmo número. No modo local, é o maior número existente + 1.
const numeroLocal = () =>
  Math.max(0, ...db.orcamentos.map((x) => x.numero || 0)) + 1;
async function proximoNumero() {
  if (!window.cloud?.on) return numeroLocal();
  const { data, error } = await cloud.sb.rpc("proximo_numero_orcamento");
  if (!error && Number(data) > 0) return Number(data);
  // função ainda não criada no Supabase: segue funcionando com a numeração local
  if (error?.code === "PGRST202" || error?.code === "42883") {
    console.warn(
      "Função proximo_numero_orcamento não encontrada no Supabase. Rode o supabase.sql. Usando numeração local.",
    );
    return numeroLocal();
  }
  throw error || new Error("Resposta inválida ao pedir o número do orçamento");
}

// Garante que o rascunho tenha número antes de salvar. Só vai ao banco
// para orçamento novo; os já salvos não esperam nada.
let numerando = false;
async function numerarDraft() {
  const d = draft;
  if (!d) return false;
  if (d.numero) return true;
  if (!validarDraft() || numerando) return false;
  numerando = true;
  try {
    const n = await proximoNumero();
    if (draft !== d) return false; // saiu da tela enquanto esperava
    d.numero = n;
    return true;
  } catch (e) {
    console.error("Falha ao numerar o orçamento", e);
    toast("Sem conexão com o banco: o orçamento não foi salvo. Tente de novo.");
    return false;
  } finally {
    numerando = false;
  }
}

function salvarOrc(silent) {
  if (!validarDraft()) return null;
  const d = draft;
  d.itens = d.itens.map((it) => ({
    ...it,
    qtd: num(it.qtd),
    valor: num(it.valor),
    custo: num(it.custo),
  }));
  d.desconto = num(d.desconto);
  d.km = d.km ? num(d.km) : "";
  delete d._q;
  if (!d.token) d.token = novoToken(); // código secreto do link de aprovação
  if (!d.id) {
    d.id = uid();
    if (!d.numero) d.numero = numeroLocal(); // normalmente já veio de numerarDraft()
    db.orcamentos.push(structuredClone(d));
  } else {
    const i = db.orcamentos.findIndex((o) => o.id === d.id);
    db.orcamentos[i] = structuredClone(d);
  }
  const v = getVeiculo(d.veiculoId);
  if (v && d.km && num(d.km) > num(v.km)) v.km = num(d.km);
  save();
  if (!silent) toast("Orçamento salvo");
  if (location.hash !== "#orcamento/" + d.id)
    history.replaceState(null, "", "#orcamento/" + d.id);
  render();
  return db.orcamentos.find((o) => o.id === d.id);
}

// ---------- PDF ----------
function gerarPDF(o) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cfg = db.config,
    c = getCliente(o.clienteId) || {},
    v = getVeiculo(o.veiculoId) || {};
  const W = 210,
    M = 14;
  const dark = [28, 34, 48],
    accent = [232, 89, 12],
    grey = [107, 115, 133];
  let x = M;

  if (cfg.logo) {
    try {
      const fmt = cfg.logo.startsWith("data:image/png") ? "PNG" : "JPEG";
      const props = doc.getImageProperties(cfg.logo);
      const h = 18,
        w = Math.min(40, (props.width / props.height) * h);
      doc.addImage(cfg.logo, fmt, M, 12, w, h);
      x = M + w + 5;
    } catch (e) {
      /* logo inválida, segue sem */
    }
  }
  doc.setTextColor(...dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(cfg.nome || "Oficina", x, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...grey);
  const info = [cfg.cnpj && "CNPJ " + cfg.cnpj, cfg.telefone, cfg.email]
    .filter(Boolean)
    .join("  ·  ");
  if (info) doc.text(info, x, 22);
  if (cfg.endereco) doc.text(doc.splitTextToSize(cfg.endereco, 110), x, 26);

  doc.setTextColor(...accent);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("ORÇAMENTO", W - M, 16, { align: "right" });
  doc.setTextColor(...dark);
  doc.setFontSize(11);
  doc.text("Nº " + pad(o.numero), W - M, 22, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...grey);
  doc.text("Emissão: " + fmtDate(o.data), W - M, 27, { align: "right" });
  if (o.validade)
    doc.text("Válido até: " + fmtDate(o.validade), W - M, 31, {
      align: "right",
    });

  doc.setDrawColor(...accent);
  doc.setLineWidth(0.8);
  doc.line(M, 36, W - M, 36);

  // cliente e veículo
  const box = (title, lines, bx, bw) => {
    doc.setFillColor(246, 247, 249);
    doc.roundedRect(bx, 41, bw, 27, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...accent);
    doc.text(title, bx + 4, 47);
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    doc.text(lines[0] || "—", bx + 4, 53);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...grey);
    lines
      .slice(1)
      .filter(Boolean)
      .slice(0, 2)
      .forEach((l, i) =>
        doc.text(doc.splitTextToSize(l, bw - 8)[0], bx + 4, 58 + i * 4.5),
      );
  };
  const half = (W - 2 * M - 4) / 2;
  box(
    "CLIENTE",
    [
      c.nome,
      [c.telefone, c.doc && "Doc: " + c.doc].filter(Boolean).join("  ·  "),
      c.endereco,
    ],
    M,
    half,
  );
  box(
    "VEÍCULO",
    [
      `${v.placa || ""}  ${veiculoLabel(v)}`.trim(),
      [
        v.cor && "Cor: " + v.cor,
        o.km && "Km: " + num(o.km).toLocaleString("pt-BR"),
      ]
        .filter(Boolean)
        .join("  ·  "),
      v.chassi && "Chassi: " + v.chassi,
    ],
    M + half + 4,
    half,
  );

  let y = 74;
  if (o.problema) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...dark);
    doc.text("Problema relatado / diagnóstico", M, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...grey);
    const ls = doc.splitTextToSize(o.problema, W - 2 * M);
    doc.text(ls, M, y + 5);
    y += 5 + ls.length * 4 + 3;
  }

  const tableOpts = {
    margin: { left: M, right: M },
    theme: "striped",
    headStyles: { fillColor: dark, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 9, cellPadding: 2.2, textColor: dark },
    columnStyles: {
      1: { halign: "center", cellWidth: 22 },
      2: { halign: "right", cellWidth: 30 },
      3: { halign: "right", cellWidth: 30 },
    },
  };
  const pecas = o.itens.filter((i) => i.tipo !== "servico");
  const servs = o.itens.filter((i) => i.tipo === "servico");
  if (pecas.length) {
    doc.autoTable({
      ...tableOpts,
      startY: y,
      head: [["Peças e materiais", "Qtd", "Valor unit.", "Subtotal"]],
      body: pecas.map((i) => [
        i.descricao,
        `${num(i.qtd).toLocaleString("pt-BR")} ${i.unidade || "un"}`,
        brlPdf(i.valor),
        brlPdf(num(i.qtd) * num(i.valor)),
      ]),
    });
    y = doc.lastAutoTable.finalY + 5;
  }
  if (servs.length) {
    doc.autoTable({
      ...tableOpts,
      startY: y,
      head: [["Serviços / mão de obra", "Qtd", "Valor unit.", "Subtotal"]],
      body: servs.map((i) => [
        i.descricao,
        num(i.qtd).toLocaleString("pt-BR"),
        brlPdf(i.valor),
        brlPdf(num(i.qtd) * num(i.valor)),
      ]),
    });
    y = doc.lastAutoTable.finalY + 5;
  }

  const t = totais(o);
  if (y > 240) {
    doc.addPage();
    y = 20;
  }
  y += 3;
  const tx = W - M - 75;
  const row = (l, val, bold) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 12 : 9.5);
    doc.setTextColor(...dark);
    doc.text(l, tx, y);
    doc.text(val, W - M, y, { align: "right" });
    y += bold ? 8 : 5.5;
  };
  row("Peças e materiais", brlPdf(t.pecas));
  row("Serviços", brlPdf(t.servicos));
  if (t.desconto) row("Desconto", "- " + brlPdf(t.desconto));
  doc.setDrawColor(...dark);
  doc.setLineWidth(0.4);
  doc.line(tx, y - 2.5, W - M, y - 2.5);
  y += 3;
  row("TOTAL", brlPdf(t.total), true);

  const extra = [
    o.prazo && "Prazo de execução: " + o.prazo,
    o.pagamento && "Pagamento: " + o.pagamento,
    o.obs && "Observações: " + o.obs,
  ].filter(Boolean);
  if (extra.length) {
    y += 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...dark);
    extra.forEach((e) => {
      const ls = doc.splitTextToSize(e, W - 2 * M);
      if (y + ls.length * 4 > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(ls, M, y);
      y += ls.length * 4 + 2;
    });
  }

  // assinatura + rodapé
  if (y > 250) {
    doc.addPage();
    y = 20;
  }
  const sy = Math.max(y + 18, 255);
  doc.setDrawColor(...grey);
  doc.setLineWidth(0.2);
  doc.line(M, sy, M + 80, sy);
  doc.setFontSize(8);
  doc.setTextColor(...grey);
  doc.text("Aprovação do cliente", M, sy + 4);
  if (cfg.rodape) doc.text(doc.splitTextToSize(cfg.rodape, W - 2 * M), M, 284);
  return doc;
}

const pdfName = (o) =>
  `orcamento-${pad(o.numero)}-${(getVeiculo(o.veiculoId)?.placa || "").toLowerCase()}.pdf`;

// Botão PDF: no celular abre o compartilhamento do sistema com o arquivo
// (escolha WhatsApp, e-mail etc.); no computador baixa o arquivo.
async function enviarPDF() {
  // Orçamento novo espera o número do banco. Os já salvos não esperam nada,
  // porque o compartilhamento do celular precisa vir direto do toque.
  const novo = !draft?.numero;
  if (novo && !(await numerarDraft())) return;
  const o = salvarOrc(true);
  if (!o) return;
  const doc = gerarPDF(o),
    fname = pdfName(o);
  const file = new File([doc.output("blob")], fname, {
    type: "application/pdf",
  });
  const mobile = matchMedia("(pointer:coarse)").matches;
  if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Orçamento " + pad(o.numero) });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
      // iPhone só abre o compartilhamento direto do toque: pede um segundo toque
      if (novo && e.name === "NotAllowedError") {
        toast(`Orçamento nº ${pad(o.numero)} salvo. Toque em PDF de novo para enviar.`);
        return;
      }
    }
  }
  doc.save(fname);
  toast("PDF baixado");
}

// Texto do orçamento com a formatação do WhatsApp (*negrito*, _itálico_)
function textoOrcamento(o) {
  const cfg = db.config,
    c = getCliente(o.clienteId) || {},
    v = getVeiculo(o.veiculoId) || {},
    t = totais(o);
  // asteriscos e sublinhados digitados pelo usuário não podem quebrar a formatação
  const limpo = (s) => String(s || "").replace(/[*_~`]/g, "").trim();
  const qtd = (n) => num(n).toLocaleString("pt-BR");
  const linhaItem = (it) => {
    const desc = limpo(it.descricao) || "Item";
    const sub = brl(num(it.qtd) * num(it.valor));
    if (num(it.qtd) === 1) return `• ${desc} — ${sub}`;
    const un = it.tipo !== "servico" ? " " + (it.unidade || "un") : "";
    return `• ${desc}\n   ${qtd(it.qtd)}${un} × ${brl(it.valor)} = ${sub}`;
  };
  const pecas = o.itens.filter((i) => i.tipo !== "servico");
  const servs = o.itens.filter((i) => i.tipo === "servico");
  const primeiro = limpo(c.nome).split(" ")[0];
  const veic = [limpo(veiculoLabel(v)), v.placa && `placa ${v.placa}`]
    .filter(Boolean)
    .join(", ");

  const L = [];
  L.push(`*${limpo(cfg.nome) || "Oficina"}*`);
  L.push(`*ORÇAMENTO Nº ${pad(o.numero)}*`);
  L.push(
    [
      o.data && `Emissão: ${fmtDate(o.data)}`,
      o.validade && `Válido até: ${fmtDate(o.validade)}`,
    ]
      .filter(Boolean)
      .join("  |  "),
  );
  L.push("");
  L.push(
    `Olá${primeiro ? ", " + primeiro : ""}! Segue o orçamento${veic ? ` do seu *${veic}*` : ""}.`,
  );
  if (o.km) L.push(`Km na entrada: ${qtd(o.km)}`);
  if (o.problema) {
    L.push("", "*Problema relatado / diagnóstico*", limpo(o.problema));
  }
  if (pecas.length) {
    L.push("", "*Peças e materiais*", ...pecas.map(linhaItem));
  }
  if (servs.length) {
    L.push("", "*Serviços / mão de obra*", ...servs.map(linhaItem));
  }
  L.push("");
  if (pecas.length) L.push(`Peças: ${brl(t.pecas)}`);
  if (servs.length) L.push(`Serviços: ${brl(t.servicos)}`);
  if (t.desconto) L.push(`Desconto: − ${brl(t.desconto)}`);
  L.push(`*TOTAL: ${brl(t.total)}*`);
  const extra = [
    o.prazo && `*Prazo:* ${limpo(o.prazo)}`,
    o.pagamento && `*Pagamento:* ${limpo(o.pagamento)}`,
    o.obs && `*Observações:* ${limpo(o.obs)}`,
  ].filter(Boolean);
  if (extra.length) L.push("", ...extra);
  if (cfg.rodape) L.push("", `_${limpo(cfg.rodape)}_`);
  const link = linkOrcamento(o);
  if (link) L.push("", "*Para aprovar ou recusar o orçamento, acesse:*", link);
  L.push("", "Qualquer dúvida, estou à disposição!");
  const assina = [limpo(cfg.nome), limpo(cfg.telefone)].filter(Boolean).join(" · ");
  if (assina) L.push(`_${assina}_`);
  return L.join("\n");
}

// Botão WhatsApp: abre a conversa do cliente com o orçamento em texto.
async function enviarWhats() {
  const novo = !draft?.numero;
  if (novo && !(await numerarDraft())) return;
  const o = salvarOrc(true);
  if (!o) return;
  const tel = waNumber(getCliente(o.clienteId)?.telefone);
  // sem telefone, o WhatsApp abre a lista de contatos para escolher
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(textoOrcamento(o))}`;
  const w = window.open(url, "_blank");
  if (w) {
    try {
      w.opener = null;
    } catch (e) {
      /* outra origem, nada a fazer */
    }
    if (!tel) toast("Cliente sem telefone cadastrado: escolha o contato no WhatsApp.");
    return;
  }
  // navegador bloqueou a nova janela (comum quando o orçamento novo esperou o número)
  toast(
    novo
      ? `Orçamento nº ${pad(o.numero)} salvo. Toque em WhatsApp de novo para abrir a conversa.`
      : "O navegador bloqueou a abertura do WhatsApp. Permita pop-ups para este site.",
  );
}

// ---------- ações ----------
const actions = {
  novoCliente: () => editCliente(null),
  editCliente: (b) => editCliente(b.dataset.id),
  novoVeiculo: (b) => editVeiculo(null, { clienteId: b.dataset.cliente || "" }),
  editVeiculo: (b) => editVeiculo(b.dataset.id),
  novaPeca: () => editPeca(null),
  editPeca: (b) => editPeca(b.dataset.id),
  del: (b) => removeItem(b.dataset.kind, b.dataset.id),
  quickCliente: () =>
    editCliente(null, (id) => {
      draft.clienteId = id;
      draft.veiculoId = "";
      render();
    }),
  quickVeiculo: () => {
    if (!draft.clienteId) return toast("Selecione o cliente primeiro");
    editVeiculo(null, { clienteId: draft.clienteId }, (id) => {
      draft.veiculoId = id;
      draft.km = getVeiculo(id).km || draft.km;
      render();
    });
  },
  addPeca: () => {
    draft.itens.push({
      tipo: "peca",
      pecaId: "",
      descricao: "",
      qtd: 1,
      custo: "",
      valor: "",
      unidade: "un",
    });
    rerenderItems();
  },
  addServico: () => {
    draft.itens.push({ tipo: "servico", descricao: "", qtd: 1, valor: "" });
    rerenderItems();
  },
  rmItem: (b) => {
    draft.itens.splice(+b.dataset.i, 1);
    rerenderItems();
  },
  salvarOrc: async () => {
    if (await numerarDraft()) salvarOrc();
  },
  pdf: enviarPDF,
  whats: enviarWhats,
  copiarLink: async () => {
    // orçamento novo precisa ser salvo (e numerado) para o link existir
    if (!draft?.numero && !(await numerarDraft())) return;
    const o = salvarOrc(true);
    if (!o) return;
    const link = linkOrcamento(o);
    if (!link) return toast("O link só funciona com a nuvem ligada.");
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copiado. Cole na conversa com o cliente.");
    } catch (e) {
      prompt("Copie o link do orçamento:", link);
    }
  },
  exportar: () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `backup-oficina-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  rmLogo: () => {
    db.config.logo = "";
    save();
    render();
  },
};
function rerenderItems() {
  $("#itemsBody").innerHTML = itemsRows(draft);
  $("#totals").innerHTML = totalsHTML(draft);
  const last = $$("#itemsBody tr").pop();
  $('input[data-k="descricao"], select', last)?.focus();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b) {
    e.preventDefault();
    actions[b.dataset.act]?.(b);
    return;
  }
  if (e.target.closest("[data-stop]")) return;
  const tr = e.target.closest("tr[data-href]");
  if (tr && !e.target.closest("a,button,input,select"))
    location.hash = tr.dataset.href;
});

document.addEventListener("input", (e) => {
  if (e.target.id === "fBusca" || e.target.id === "fStatus") {
    const [path] = location.hash.slice(1).split("?");
    const p = new URLSearchParams();
    const b = $("#fBusca")?.value,
      s = $("#fStatus")?.value;
    if (b) p.set("q", b);
    if (s) p.set("status", s);
    history.replaceState(null, "", "#" + path + (p.toString() ? "?" + p : ""));
    clearTimeout(window._ft);
    window._ft = setTimeout(() => {
      const pos = e.target.selectionStart;
      render();
      const el = $("#" + e.target.id);
      el?.focus();
      if (el?.setSelectionRange && pos != null) el.setSelectionRange(pos, pos);
    }, 200);
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "cfgForm") return;
  e.preventDefault();
  const f = new FormData(e.target);
  for (const k of ["nome", "cnpj", "telefone", "email", "endereco", "rodape"])
    db.config[k] = String(f.get(k) || "").trim();
  db.config.validade = num(f.get("validade")) || 15;
  db.config.margem = num(f.get("margem"));
  save();
  toast("Configurações salvas");
  render();
});

document.addEventListener("change", (e) => {
  if (e.target.id === "logoInput" && e.target.files[0]) {
    const file = e.target.files[0];
    const img = new Image(),
      r = new FileReader();
    r.onload = () => {
      img.src = r.result;
    };
    img.onload = () => {
      // reduz para caber no armazenamento
      const s = Math.min(1, 400 / img.width),
        cv = document.createElement("canvas");
      cv.width = img.width * s;
      cv.height = img.height * s;
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      db.config.logo = cv.toDataURL(
        file.type === "image/png" ? "image/png" : "image/jpeg",
        0.9,
      );
      save();
      render();
      toast("Logo atualizada");
    };
    r.readAsDataURL(file);
  }
  if (e.target.id === "importInput" && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.clientes) || !Array.isArray(d.orcamentos))
          throw new Error("formato");
        if (
          !confirm(
            "Restaurar o backup vai SUBSTITUIR todos os dados atuais. Continuar?",
          )
        )
          return;
        db = {
          ...blankDB(),
          ...d,
          config: { ...blankDB().config, ...d.config },
        };
        save();
        toast("Backup restaurado");
        render();
      } catch (err) {
        alert("Arquivo de backup inválido.");
      }
    };
    r.readAsText(e.target.files[0]);
  }
});

// ---------- roteador ----------
function render() {
  const h = location.hash.slice(1) || "painel";
  const [path, qs] = h.split("?");
  const [name, ...args] = path.split("/");
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  if (name !== "orcamento") draft = null;
  const html =
    name === "orcamento"
      ? editorView(args[0] || "novo", q)
      : (views[name] || views.painel)(args, q);
  $("#main").innerHTML = html;
  const section =
    { cliente: "clientes", veiculo: "veiculos", orcamento: "orcamentos" }[
      name
    ] || name;
  $$("#nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.r === section),
  );
  $("#brandName").textContent = db.config.nome || "Oficina";
}
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});
bindEditor();
// render() inicial é chamado por cloud.js depois do login
