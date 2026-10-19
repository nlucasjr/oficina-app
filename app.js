/* Oficina — histórico de serviços dos veículos e de seus donos.
   Guarda clientes (nome, telefone, endereço), veículos (placa, modelo, km, dono)
   e os serviços feitos em cada veículo (data, km na época, o que foi feito, valor
   e quem era o dono naquele dia). Sincronização com a nuvem: cloud.js. */

const DB_KEY = "oficina_db_v1";

// ---------- versão do app ----------
// A cada versão publicada: aumente APP_VERSAO aqui e em version.json (mesmo número).
// Se a mudança altera o formato dos dados (uma versão antiga estragaria ou
// apagaria dados novos), iguale também COMPAT_MINIMA a APP_VERSAO: as versões
// mais antigas que ela ficam impedidas de gravar até serem atualizadas.
const APP_VERSAO = 5;
const COMPAT_MINIMA = 4;

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const temNum = (v) => v !== "" && v !== null && v !== undefined && !isNaN(parseFloat(v));
const brl = (v) =>
  num(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const fmtDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const kmFmt = (v) => (temNum(v) ? num(v).toLocaleString("pt-BR") + " km" : "—");
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// ---------- dados ----------
function blankDB() {
  return {
    config: { nome: "Mecânica Rodrigues" },
    clientes: [],
    veiculos: [],
    servicos: [],
  };
}

// Junta os dados lidos com o formato atual. Só os tipos usados pelo app
// entram; restos da versão anterior (orçamentos, peças) são ignorados.
function normalizar(d) {
  const b = blankDB();
  if (!d || typeof d !== "object") return b;
  return {
    config: { ...b.config, ...d.config },
    clientes: Array.isArray(d.clientes) ? d.clientes : [],
    veiculos: Array.isArray(d.veiculos) ? d.veiculos : [],
    servicos: Array.isArray(d.servicos) ? d.servicos : [],
  };
}

function loadDB() {
  try {
    return normalizar(JSON.parse(localStorage.getItem(DB_KEY)));
  } catch (e) {
    return blankDB(); // dados corrompidos: começa vazio
  }
}
let db = loadDB();

function save() {
  if (window.cloud?.bloqueado) return bloquearDesatualizado();
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    if (!window.cloud?.on)
      alert("Não foi possível salvar (armazenamento cheio?). Faça um backup em Ajustes.");
  }
  window.cloud?.schedule();
}

const getCliente = (id) => db.clientes.find((c) => c.id === id);
const getVeiculo = (id) => db.veiculos.find((v) => v.id === id);
const getServico = (id) => db.servicos.find((s) => s.id === id);
// serviços mais recentes primeiro (mesma data: maior km primeiro)
const ordenarServicos = (list) =>
  list
    .slice()
    .sort(
      (a, b) =>
        String(b.data || "").localeCompare(String(a.data || "")) ||
        num(b.km) - num(a.km) ||
        String(b.criado || "").localeCompare(String(a.criado || "")),
    );
const servicosDoVeiculo = (id) => ordenarServicos(db.servicos.filter((s) => s.veiculoId === id));
const nomeVeiculo = (v) => (v ? [v.marca, v.modelo].filter(Boolean).join(" ") : "");
// Km atual do veículo = km do serviço mais recente que tem km informado.
function atualizarKm(v) {
  if (!v) return;
  const ult = servicosDoVeiculo(v.id).find((s) => temNum(s.km));
  if (ult) v.km = num(ult.km);
}
const totalValor = (list) => list.reduce((s, x) => s + num(x.valor), 0);

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3500);
}
const plate = (p) => (p ? `<span class="plate">${esc(p)}</span>` : "");
const telLink = (t) =>
  t ? `<a href="tel:${esc(String(t).replace(/[^\d+]/g, ""))}">${esc(t)}</a>` : "—";

// ---------- formulários em janela ----------
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
    input = `<textarea name="${f.k}" rows="${f.rows || 3}" ${req} placeholder="${esc(f.ph || "")}">${esc(v)}</textarea>`;
  } else {
    const extra =
      f.type === "number"
        ? `step="${f.step || "any"}" min="0" inputmode="${f.step === "1" ? "numeric" : "decimal"}"`
        : f.type === "tel"
          ? 'inputmode="tel" autocomplete="tel"'
          : "";
    input = `<input name="${f.k}" type="${f.type || "text"}" value="${esc(v)}" ${extra} ${req} placeholder="${esc(f.ph || "")}">`;
  }
  return `<div class="${cls}"><label>${esc(f.label)}${f.required ? " *" : ""}</label>${input}${
    f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""
  }</div>`;
}

function formModal(title, fields, data, onSave, opts = {}) {
  const m = $("#modal");
  m.innerHTML = `<div class="modal-card"><h3>${esc(title)}</h3>
    <form id="mf"><div class="grid">${fields.map((f) => fieldHTML(f, data[f.k])).join("")}</div>
    <div class="modal-actions">
      ${opts.onDelete ? `<button type="button" class="btn danger" data-del>Excluir</button><span class="grow"></span>` : ""}
      <button type="button" class="btn" data-close>Cancelar</button>
      <button class="btn primary">Salvar</button></div></form></div>`;
  m.classList.add("open");
  $("[data-close]", m).onclick = closeModal;
  if (opts.onDelete) $("[data-del]", m).onclick = opts.onDelete;
  $("#mf").onsubmit = (e) => {
    e.preventDefault();
    const vals = {};
    for (const f of fields) {
      const el = $(`[name="${f.k}"]`, m);
      vals[f.k] = f.type === "number" ? (el.value === "" ? "" : num(el.value)) : el.value.trim();
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

// ---------- clientes ----------
const clienteFields = () => [
  { k: "nome", label: "Nome", required: true, full: true },
  { k: "telefone", label: "Telefone", type: "tel", required: true, ph: "(67) 98888-7777" },
  { k: "endereco", label: "Endereço", full: true },
];
function editCliente(id, after) {
  const c = id ? getCliente(id) : {};
  formModal(id ? "Editar cliente" : "Novo cliente", clienteFields(), c, (vals) => {
    if (id) Object.assign(c, vals);
    else {
      vals.id = uid();
      vals.criado = today();
      db.clientes.push(vals);
    }
    save();
    toast("Cliente salvo");
    after ? after(id || vals.id) : render();
  });
}

// ---------- veículos ----------
const veiculoFields = () => [
  {
    k: "clienteId",
    label: "Dono",
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
  {
    k: "km",
    label: "Km atual",
    type: "number",
    step: "1",
    hint: "Atualiza sozinho a cada serviço registrado com km.",
  },
];
function editVeiculo(id, preset = {}, after) {
  if (!db.clientes.length) {
    toast("Cadastre o dono (cliente) primeiro");
    return editCliente(null, () => editVeiculo(id, preset, after));
  }
  const v = id ? getVeiculo(id) : { ...preset };
  formModal(id ? "Editar veículo" : "Novo veículo", veiculoFields(), v, (vals) => {
    vals.placa = vals.placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!vals.placa) {
      alert("Informe a placa.");
      return false;
    }
    const dup = db.veiculos.find((x) => x.placa === vals.placa && x.id !== id);
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
  });
}

// ---------- serviços ----------
const servicoFields = () => [
  {
    k: "veiculoId",
    label: "Veículo",
    type: "select",
    required: true,
    full: true,
    options: [
      { v: "", l: "— selecione —" },
      ...db.veiculos
        .slice()
        .sort((a, b) => a.placa.localeCompare(b.placa))
        .map((v) => ({
          v: v.id,
          l: [v.placa, nomeVeiculo(v), getCliente(v.clienteId)?.nome].filter(Boolean).join(" · "),
        })),
    ],
  },
  { k: "data", label: "Data do serviço", type: "date", required: true },
  { k: "km", label: "Km no dia", type: "number", step: "1", ph: "Ex.: 85400" },
  {
    k: "descricao",
    label: "O que foi feito",
    type: "textarea",
    rows: 4,
    required: true,
    full: true,
    ph: "Ex.: Troca de óleo 5W30 e filtro de óleo",
  },
  { k: "valor", label: "Valor (R$)", type: "number", step: "0.01", ph: "0,00" },
];

function editServico(id, preset = {}) {
  if (!db.veiculos.length) {
    toast("Cadastre um veículo primeiro");
    return editVeiculo(null, {}, (vid) => editServico(null, { veiculoId: vid }));
  }
  const s = id ? getServico(id) : { data: today(), ...preset };
  if (!s) return;
  formModal(
    id ? "Editar serviço" : "Registrar serviço",
    servicoFields(),
    s,
    (vals) => {
      const v = getVeiculo(vals.veiculoId);
      if (!v) {
        alert("Escolha o veículo.");
        return false;
      }
      if (!vals.descricao) {
        alert("Descreva o que foi feito.");
        return false;
      }
      // km menor que o de um serviço anterior costuma ser erro de digitação
      if (vals.km !== "") {
        const antes = db.servicos.filter(
          (x) => x.veiculoId === v.id && x.id !== id && temNum(x.km) && String(x.data) <= vals.data,
        );
        const maior = antes.reduce((m, x) => (num(x.km) > num(m?.km) ? x : m), null);
        if (
          maior &&
          vals.km < num(maior.km) &&
          !confirm(
            `O km informado (${kmFmt(vals.km)}) é menor que o do serviço de ${fmtDate(maior.data)} (${kmFmt(maior.km)}). Salvar mesmo assim?`,
          )
        )
          return false;
      }
      // dono na época: o dono atual do veículo quando o serviço é registrado
      const veiculoAntes = id ? getVeiculo(s.veiculoId) : null;
      if (!id || s.veiculoId !== vals.veiculoId || !s.clienteId) vals.clienteId = v.clienteId;
      if (id) Object.assign(s, vals);
      else {
        vals.id = uid();
        vals.criado = new Date().toISOString();
        db.servicos.push(vals);
      }
      atualizarKm(v);
      if (veiculoAntes && veiculoAntes !== v) atualizarKm(veiculoAntes);
      save();
      toast("Serviço salvo");
      render();
    },
    id ? { onDelete: () => removeItem("servico", id) } : {},
  );
}

function removeItem(kind, id) {
  if (kind === "cliente") {
    if (db.veiculos.some((v) => v.clienteId === id))
      return alert("Este cliente é dono de veículos. Passe os veículos para outro dono ou exclua-os antes.");
    if (db.servicos.some((s) => s.clienteId === id))
      return alert("Este cliente aparece no histórico de serviços e não pode ser excluído.");
    if (!confirm("Excluir este cliente?")) return;
    db.clientes = db.clientes.filter((c) => c.id !== id);
    save();
    location.hash = "#clientes";
  } else if (kind === "veiculo") {
    if (db.servicos.some((s) => s.veiculoId === id))
      return alert("Este veículo tem serviços no histórico. Exclua os serviços antes.");
    if (!confirm("Excluir este veículo?")) return;
    db.veiculos = db.veiculos.filter((v) => v.id !== id);
    save();
    location.hash = "#veiculos";
  } else if (kind === "servico") {
    if (!confirm("Excluir este serviço do histórico?")) return;
    const v = getVeiculo(getServico(id)?.veiculoId);
    db.servicos = db.servicos.filter((s) => s.id !== id);
    atualizarKm(v);
    save();
    closeModal();
    toast("Serviço excluído");
    render();
  }
}

// ---------- telas ----------
// Lista de serviços (no celular cada linha vira um cartão)
function servicoTabela(list, { veiculo = true, dono = true, vazio = "Nenhum serviço registrado" } = {}) {
  const head = `<tr><th>Data</th>${veiculo ? "<th>Veículo</th>" : ""}<th>Serviço</th><th>Km</th>${
    dono ? "<th>Dono na época</th>" : ""
  }<th class="num">Valor</th></tr>`;
  const cols = 4 + (veiculo ? 1 : 0) + (dono ? 1 : 0);
  const rows = list.length
    ? ordenarServicos(list)
        .map((s) => {
          const v = getVeiculo(s.veiculoId),
            c = getCliente(s.clienteId);
          return `<tr class="click" data-servico="${esc(s.id)}">
        <td class="c2 sub">${fmtDate(s.data)}</td>
        ${veiculo ? `<td class="c1 strong">${plate(v?.placa)} ${esc(v ? nomeVeiculo(v) : "Veículo removido")}</td>` : ""}
        <td class="c1 desc"><span class="clamp">${esc(s.descricao)}</span></td>
        <td class="c1 sub nowrap" data-l="Km">${kmFmt(s.km)}</td>
        ${dono ? `<td class="c1 sub" data-l="Dono">${esc(c?.nome || "—")}</td>` : ""}
        <td class="num c2 o-1 nowrap"><b>${temNum(s.valor) ? brl(s.valor) : "—"}</b></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="${cols}" class="empty">${vazio}</td></tr>`;
  return `<div class="table-wrap"><table class="list"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

const btnServico = (vid = "", txt = "+ Registrar serviço", cls = "btn primary") =>
  `<button class="${cls}" data-act="novoServico" data-veiculo="${esc(vid)}">${txt}</button>`;

const views = {
  painel() {
    const mes = today().slice(0, 7);
    const doMes = db.servicos.filter((s) => String(s.data || "").startsWith(mes));
    return `<div class="page-head"><h1>Painel</h1><div class="actions">${btnServico()}</div></div>
      <div class="stats">
        <div class="stat"><div class="l">Veículos</div><div class="v">${db.veiculos.length}</div></div>
        <div class="stat"><div class="l">Clientes</div><div class="v">${db.clientes.length}</div></div>
        <div class="stat"><div class="l">Serviços no mês</div><div class="v">${doMes.length}</div></div>
        <div class="stat"><div class="l">Faturado no mês</div><div class="v">${brl(totalValor(doMes))}</div></div>
      </div>
      <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Últimos serviços</h2>
        <a class="btn sm" href="#servicos">Ver todos</a></div>
        ${servicoTabela(ordenarServicos(db.servicos).slice(0, 8))}</div>`;
  },

  servicos(_, q) {
    const busca = norm(q.q);
    const list = db.servicos.filter((s) => {
      if (!busca) return true;
      const v = getVeiculo(s.veiculoId),
        c = getCliente(s.clienteId);
      return norm(`${v?.placa} ${nomeVeiculo(v)} ${c?.nome} ${s.descricao} ${fmtDate(s.data)}`).includes(busca);
    });
    return `<div class="page-head"><h1>Serviços</h1>${btnServico()}</div>
      <div class="toolbar"><input id="fBusca" type="search" placeholder="Buscar placa, modelo, cliente, serviço..." value="${esc(q.q || "")}"></div>
      <p class="muted resumo">${list.length} ${list.length === 1 ? "serviço" : "serviços"} · ${brl(totalValor(list))}</p>
      <div class="card">${servicoTabela(list, { vazio: busca ? "Nenhum serviço encontrado" : "Nenhum serviço registrado" })}</div>`;
  },

  veiculos(_, q) {
    const busca = norm(q.q);
    const list = db.veiculos
      .filter((v) => !busca || norm(`${v.placa} ${nomeVeiculo(v)} ${getCliente(v.clienteId)?.nome}`).includes(busca))
      .sort((a, b) => a.placa.localeCompare(b.placa));
    return `<div class="page-head"><h1>Veículos</h1><button class="btn primary" data-act="novoVeiculo">+ Novo veículo</button></div>
      <div class="toolbar"><input id="fBusca" type="search" placeholder="Buscar placa, marca, modelo, dono..." value="${esc(q.q || "")}"></div>
      <div class="card"><div class="table-wrap"><table class="list">
      <thead><tr><th>Placa</th><th>Veículo</th><th>Dono</th><th>Km atual</th><th>Último serviço</th></tr></thead><tbody>
      ${
        list.length
          ? list
              .map((v) => {
                const ult = servicosDoVeiculo(v.id)[0];
                return `<tr class="click" data-href="#veiculo/${v.id}"><td class="c2">${plate(v.placa)}</td>
          <td class="c1 strong">${esc(nomeVeiculo(v)) || "—"}</td>
          <td class="c1 sub">${esc(getCliente(v.clienteId)?.nome || "—")}</td>
          <td class="c1 sub nowrap" data-l="Km">${kmFmt(v.km)}</td>
          <td class="c1 sub" data-l="Último serviço">${ult ? fmtDate(ult.data) : "—"}</td></tr>`;
              })
              .join("")
          : `<tr><td colspan="5" class="empty">${busca ? "Nenhum veículo encontrado" : "Nenhum veículo cadastrado"}</td></tr>`
      }
      </tbody></table></div></div>`;
  },

  veiculo([id]) {
    const v = getVeiculo(id);
    if (!v) return notFound();
    const c = getCliente(v.clienteId);
    const hist = servicosDoVeiculo(id);
    return `<div class="page-head"><div><a href="#veiculos" class="muted">← Veículos</a>
      <h1>${plate(v.placa)} ${esc(nomeVeiculo(v))}</h1></div>
      <div class="actions">${btnServico(id)}
        <button class="btn" data-act="editVeiculo" data-id="${id}">Editar</button>
        <button class="btn danger" data-act="del" data-kind="veiculo" data-id="${id}">Excluir</button>
      </div></div>
      <div class="card"><div class="info-list">
        <div><span>Dono atual</span>${c ? `<a href="#cliente/${c.id}">${esc(c.nome)}</a>` : "—"}</div>
        <div><span>Telefone</span>${telLink(c?.telefone)}</div>
        <div><span>Km atual</span>${kmFmt(v.km)}</div>
        <div><span>Serviços</span>${hist.length} · ${brl(totalValor(hist))}</div>
      </div></div>
      <div class="card"><h2>Histórico de serviços</h2>
      ${
        hist.length
          ? `<div class="timeline">${hist
              .map((s) => {
                const dono = getCliente(s.clienteId);
                return `<div class="tl-item click" data-servico="${esc(s.id)}">
          <div class="tl-head"><b>${fmtDate(s.data)}</b><span class="muted">${kmFmt(s.km)}</span>
            <b class="tl-valor">${temNum(s.valor) ? brl(s.valor) : ""}</b></div>
          <div class="tl-desc">${esc(s.descricao)}</div>
          ${s.clienteId && s.clienteId !== v.clienteId ? `<div class="muted tl-dono">Dono na época: ${esc(dono?.nome || "—")}</div>` : ""}
        </div>`;
              })
              .join("")}</div>`
          : `<p class="empty">Nenhum serviço registrado ainda.</p>`
      }
      </div>`;
  },

  clientes(_, q) {
    const busca = norm(q.q);
    const list = db.clientes
      .filter((c) => !busca || norm(`${c.nome} ${c.telefone} ${c.endereco}`).includes(busca))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    return `<div class="page-head"><h1>Clientes</h1><button class="btn primary" data-act="novoCliente">+ Novo cliente</button></div>
      <div class="toolbar"><input id="fBusca" type="search" placeholder="Buscar nome, telefone, endereço..." value="${esc(q.q || "")}"></div>
      <div class="card"><div class="table-wrap"><table class="list">
      <thead><tr><th>Nome</th><th>Telefone</th><th>Veículos</th><th class="num">Serviços</th></tr></thead><tbody>
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
        <td class="num c2 sub" data-l="Serviços">${db.servicos.filter((s) => s.clienteId === c.id).length}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="4" class="empty">${busca ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</td></tr>`
      }
      </tbody></table></div></div>`;
  },

  cliente([id]) {
    const c = getCliente(id);
    if (!c) return notFound();
    const veics = db.veiculos.filter((v) => v.clienteId === id).sort((a, b) => a.placa.localeCompare(b.placa));
    const servs = db.servicos.filter((s) => s.clienteId === id);
    return `<div class="page-head"><div><a href="#clientes" class="muted">← Clientes</a><h1>${esc(c.nome)}</h1></div>
      <div class="actions">
        <button class="btn" data-act="editCliente" data-id="${id}">Editar</button>
        <button class="btn danger" data-act="del" data-kind="cliente" data-id="${id}">Excluir</button>
      </div></div>
      <div class="card"><div class="info-list">
        <div><span>Telefone</span>${telLink(c.telefone)}</div>
        <div><span>Endereço</span>${esc(c.endereco) || "—"}</div>
      </div></div>
      <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Veículos</h2>
        <button class="btn sm" data-act="novoVeiculo" data-cliente="${id}">+ Adicionar veículo</button></div>
        <div class="table-wrap"><table class="list"><thead><tr><th>Placa</th><th>Veículo</th><th>Km atual</th><th></th></tr></thead><tbody>
        ${
          veics.length
            ? veics
                .map(
                  (v) => `<tr class="click" data-href="#veiculo/${v.id}"><td class="c2">${plate(v.placa)}</td>
          <td class="c1 strong">${esc(nomeVeiculo(v)) || "—"}</td><td class="c1 sub nowrap" data-l="Km">${kmFmt(v.km)}</td>
          <td class="num c2">${btnServico(v.id, "+ Serviço", "btn sm")}</td></tr>`,
                )
                .join("")
            : `<tr><td colspan="4" class="empty">Nenhum veículo</td></tr>`
        }
        </tbody></table></div></div>
      <div class="card"><h2>Serviços feitos para este cliente</h2>
        ${servicoTabela(servs, { dono: false })}</div>`;
  },

  config() {
    return `<div class="page-head"><h1>Ajustes</h1></div>
      <div class="card"><h2>Backup dos dados</h2>
        <p class="muted">${
          window.cloud?.on
            ? "Os dados ficam salvos na nuvem e aparecem em todos os aparelhos em que você entrar. O backup é uma cópia extra num arquivo."
            : "Sem nuvem, os dados ficam só neste navegador. Faça backup com frequência e use o arquivo para passar os dados para outro aparelho."
        }</p>
        <div class="actions"><button class="btn" data-act="exportar">⬇ Baixar backup</button>
        <label class="btn" style="margin:0;color:var(--text)">⬆ Restaurar backup<input type="file" id="importInput" accept="application/json" hidden></label></div>
      </div>
      <div class="card"><h2>Sobre o app</h2>
        <div class="info-list">
          <div><span>Versão</span><b id="appVersao">${APP_VERSAO}</b></div>
          <div><span>Dados</span>${window.cloud?.on ? "Salvos na nuvem" : "Só neste aparelho (modo local)"}</div>
        </div>
        <div class="actions" style="margin-top:14px"><button class="btn" data-act="procurarAtualizacao">↻ Procurar atualização</button></div>
      </div>`;
  },
};

function notFound() {
  return `<div class="card empty">Registro não encontrado. <a href="#painel">Voltar ao painel</a></div>`;
}

// ---------- ações ----------
const actions = {
  novoCliente: () => editCliente(null),
  editCliente: (b) => editCliente(b.dataset.id),
  novoVeiculo: (b) => editVeiculo(null, { clienteId: b.dataset.cliente || "" }),
  editVeiculo: (b) => editVeiculo(b.dataset.id),
  novoServico: (b) => editServico(null, b.dataset.veiculo ? { veiculoId: b.dataset.veiculo } : {}),
  del: (b) => removeItem(b.dataset.kind, b.dataset.id),
  atualizarApp: () => location.reload(),
  procurarAtualizacao: async (b) => {
    b.disabled = true;
    const nova = await verificarAtualizacao();
    b.disabled = false;
    if (nova === false) toast(`Você já está na versão mais recente (${APP_VERSAO}).`);
    else if (nova === null) toast("Não foi possível verificar agora. Confira a internet.");
  },
  exportar: () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `backup-oficina-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b) {
    e.preventDefault();
    actions[b.dataset.act]?.(b);
    return;
  }
  if (e.target.closest("a,button,input,select,textarea,label")) return;
  const sv = e.target.closest("[data-servico]");
  if (sv) return editServico(sv.dataset.servico);
  const tr = e.target.closest("tr[data-href]");
  if (tr) location.hash = tr.dataset.href;
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "fBusca") return;
  const [path] = location.hash.slice(1).split("?");
  const b = e.target.value;
  history.replaceState(null, "", "#" + path + (b ? "?" + new URLSearchParams({ q: b }) : ""));
  clearTimeout(window._ft);
  window._ft = setTimeout(() => {
    const pos = e.target.selectionStart;
    render();
    const el = $("#fBusca");
    el?.focus();
    if (el?.setSelectionRange && pos != null) el.setSelectionRange(pos, pos);
  }, 200);
});

document.addEventListener("change", (e) => {
  if (e.target.id === "importInput" && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.clientes)) throw new Error("formato");
        if (!confirm("Restaurar este backup? Os dados atuais serão substituídos.")) return;
        db = normalizar(d);
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
  $("#main").innerHTML = (views[name] || views.painel)(args, q);
  const section = { cliente: "clientes", veiculo: "veiculos" }[name] || (views[name] ? name : "painel");
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === section));
}
// ---------- atualização do app ----------
// Confere se o site já tem uma versão mais nova que esta e avisa.
// Devolve true se há versão nova, false se não há, null se não deu para conferir.
async function verificarAtualizacao() {
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    const v = await r.json();
    if (num(v.versao) > APP_VERSAO) {
      avisoAtualizacao();
      return true;
    }
    return false;
  } catch (e) {
    return null; // sem internet: tenta de novo depois
  }
}
function avisoAtualizacao() {
  if ($("#upd")) return;
  const el = document.createElement("div");
  el.id = "upd";
  el.className = "upd";
  el.setAttribute("role", "status");
  el.innerHTML = `<span>Nova versão do app disponível.</span>
    <button class="btn sm primary" data-act="atualizarApp">Atualizar</button>`;
  document.body.appendChild(el);
}
// Chamado por cloud.js quando o banco exige uma versão mais nova que esta
function bloquearDesatualizado() {
  closeModal();
  if ($("#bloqueio")) return;
  const el = document.createElement("div");
  el.id = "bloqueio";
  el.className = "login";
  el.innerHTML = `<div class="login-card bloqueio-card">
    <div class="brand dark"><img class="brand-logo" src="logo-branco.png" alt="Mecânica Rodrigues"></div>
    <h2>Atualize o app</h2>
    <p class="muted">Os dados já foram atualizados por uma versão mais nova do app. Para não estragar nada,
      esta versão não pode mais salvar.</p>
    <button class="btn primary" style="width:100%;justify-content:center" data-act="atualizarApp">Atualizar agora</button>
    <p class="muted bloqueio-dica">Se continuar aparecendo, feche o app por completo e abra de novo.</p>
  </div>`;
  document.body.appendChild(el);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") verificarAtualizacao();
});
setInterval(verificarAtualizacao, 5 * 60 * 1000);
setTimeout(verificarAtualizacao, 15000);

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});
// render() inicial é chamado por cloud.js depois do login
