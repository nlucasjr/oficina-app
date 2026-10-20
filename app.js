/* Oficina — histórico de serviços dos veículos e de seus donos.
   Guarda clientes (nome, telefone, endereço), veículos (placa, modelo, km, dono)
   e os serviços feitos em cada veículo (data, km na época, o que foi feito, valor
   e quem era o dono naquele dia). Sincronização com a nuvem: cloud.js. */

const DB_KEY = "oficina_db_v1";

// ---------- versão do app (padrão Android) ----------
// VERSION_CODE: inteiro que sobe 1 a cada publicação do app. É ele que o app
//   compara para saber se há atualização e para a trava de compatibilidade.
// VERSION_NAME: o número que as pessoas veem, MAIOR.CÓDIGO.CORREÇÃO. O número do
//   meio é sempre o VERSION_CODE (montado aqui, não dá para descasar):
//   - nova publicação do app: VERSION_CODE + 1 e VERSION_PATCH volta a 0;
//   - mudança que não exige atualizar o app (README, testes): só VERSION_PATCH + 1;
//   - mudança muito grande: VERSION_MAJOR + 1.
// A cada mudança: atualize version.json com os mesmos valores (versionCode,
//   versionName e "versao", que repete o versionCode para versões antigas do app).
// COMPAT_MINIMA (um versionCode): se a mudança altera o formato dos dados
//   (uma versão antiga estragaria ou apagaria dados novos), iguale-a ao
//   VERSION_CODE; as versões mais antigas ficam impedidas de gravar até atualizar.
const VERSION_MAJOR = 1;
const VERSION_CODE = 16;
const VERSION_PATCH = 0;
const VERSION_NAME = `${VERSION_MAJOR}.${VERSION_CODE}.${VERSION_PATCH}`;
const COMPAT_MINIMA = 6;

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
      erro("Não foi possível salvar (armazenamento cheio?). Faça um backup em Ajustes.");
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
// Valores do serviço: maoDeObra + pecas = valor (total). O total fica gravado
// em "valor" para as somas. Serviços registrados antes da divisão só têm o total.
const totalValor = (list) => list.reduce((s, x) => s + num(x.valor), 0);
const somaCampo = (list, k) => list.reduce((s, x) => s + num(x[k]), 0);
const temDivisao = (s) => temNum(s.maoDeObra) || temNum(s.pecas);
const arred = (n) => Math.round(n * 100) / 100;
const valorOuTraco = (v) => (temNum(v) ? brl(v) : "—");

// Mensagem no topo da tela (sucesso ou erro); some sozinha ou deslizando para o lado
function toast(msg, tipo = "ok") {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${tipo === "erro" ? "erro" : "ok"}`;
  t.setAttribute("role", tipo === "erro" ? "alert" : "status");
  t.style.transition = "none";
  t.style.transform = t.style.opacity = "";
  void t.offsetWidth; // reinicia a animação de entrada
  t.style.transition = "";
  t.classList.add("show");
  agendarFimToast(tipo === "erro" ? 6000 : 3500);
}
const erro = (msg) => toast(msg, "erro");

function agendarFimToast(ms) {
  clearTimeout(toast._t);
  toast._t = setTimeout(() => fecharToast(), ms);
}
function fecharToast(dx = 0) {
  const t = $("#toast");
  clearTimeout(toast._t);
  if (!t || !t.classList.contains("show")) return;
  if (dx) {
    // sai para o lado do gesto
    t.style.transform = `translate(calc(-50% + ${dx > 0 ? 120 : -120}vw), 0)`;
    t.style.opacity = "0";
    setTimeout(() => {
      t.style.transition = "none";
      t.classList.remove("show");
      t.style.transform = t.style.opacity = "";
      void t.offsetWidth;
      t.style.transition = "";
    }, 220);
  } else {
    t.style.transform = t.style.opacity = "";
    t.classList.remove("show");
  }
}
// Deslizar a mensagem para o lado (dedo ou mouse) faz ela sumir
(function ligarArrasteToast() {
  const t = document.getElementById("toast");
  if (!t) return;
  let x0 = null, dx = 0;
  t.addEventListener("pointerdown", (e) => {
    if (!t.classList.contains("show")) return;
    x0 = e.clientX; dx = 0;
    clearTimeout(toast._t);
    t.style.transition = "none";
    try { t.setPointerCapture(e.pointerId); } catch {}
  });
  t.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    t.style.transform = `translate(calc(-50% + ${dx}px), 0)`;
    t.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 250));
  });
  const soltar = () => {
    if (x0 === null) return;
    x0 = null;
    t.style.transition = "";
    if (Math.abs(dx) > 60) fecharToast(dx);
    else {
      t.style.transform = t.style.opacity = "";
      agendarFimToast(2500);
    }
  };
  t.addEventListener("pointerup", soltar);
  t.addEventListener("pointercancel", soltar);
})();
const plate = (p) => (p ? `<span class="plate">${esc(p)}</span>` : "");
const telLink = (t) =>
  t ? `<a href="tel:${esc(String(t).replace(/[^\d+]/g, ""))}">${esc(t)}</a>` : "—";

// ---------- valores em dinheiro ----------
// Lê "235,50", "1.234,56", "R$ 80" ou "80.5". Devolve "" se vazio e NaN se inválido.
function lerDinheiro(txt) {
  let s = String(txt ?? "").replace(/R\$|\s/gi, "");
  if (!s) return "";
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 1.234 = mil duzentos e trinta e quatro
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return arred(parseFloat(s));
}
// número gravado vira "235,50"; texto ainda não salvo (rascunho) fica como foi digitado
const dinheiroNoCampo = (v) =>
  typeof v === "number" && !Number.isNaN(v) ? v.toFixed(2).replace(".", ",") : String(v ?? "");

// ---------- formulários em janela ----------
function fieldHTML(f, val) {
  if (f.sec) return `<div class="full form-sec">${esc(f.sec)}</div>`;
  const v = f.type === "money" ? dinheiroNoCampo(val) : (val ?? f.default ?? "");
  const cls = f.full ? "full" : f.metade ? "metade" : "";
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
  } else if (f.type === "money") {
    // texto com teclado numérico: aceita vírgula em qualquer celular
    input = `<input name="${f.k}" type="text" inputmode="decimal" autocomplete="off" value="${esc(v)}" ${req} placeholder="${esc(f.ph || "")}">`;
  } else {
    const extra =
      f.type === "number"
        ? `step="${f.step || "any"}" min="0" inputmode="${f.step === "1" ? "numeric" : "decimal"}"`
        : f.type === "tel"
          ? 'inputmode="tel" autocomplete="tel"'
          : f.caps
            ? 'autocapitalize="characters" autocomplete="off" spellcheck="false" class="maiusculas"'
            : f.palavras
              ? 'autocapitalize="words"'
              : "";
    input = `<input name="${f.k}" type="${f.type || "text"}" value="${esc(v)}" ${extra} ${req} placeholder="${esc(f.ph || "")}">`;
  }
  if (f.prefix || f.suffix)
    input = `<div class="adorno">${f.prefix ? `<span class="adorno-pre">${esc(f.prefix)}</span>` : ""}${input}${
      f.suffix ? `<span class="adorno-suf">${esc(f.suffix)}</span>` : ""
    }</div>`;
  const id = `f_${f.k}`;
  input = input.replace(`name="${f.k}"`, `name="${f.k}" id="${id}"`);
  return `<div class="${cls}"><label for="${id}">${esc(f.label)}${f.required ? ' <span class="obrig" title="obrigatório">*</span>' : ""}</label>${input}${
    f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""
  }${f.afterHTML || ""}</div>`;
}

/* Telas de edição (janelas) e o botão voltar do celular: ao abrir uma janela,
   o app cria um passo no histórico do navegador. Voltar fecha a janela em vez
   de sair da tela. Ao fechar pelo app (Salvar, Cancelar...), esse passo é
   desfeito. Janelas abertas em sequência (ex.: cadastrar o cliente e depois o
   veículo) usam o mesmo passo. */
let modalGen = 0, // muda a cada janela aberta
  modalHist = false, // existe um passo no histórico para a janela aberta
  ignorarPop = false, // o próximo "voltar" foi feito pelo próprio app
  passoPendente = false, // janela aberta enquanto esse "voltar" ainda não terminou
  modalVoltar = null; // janela aberta a partir de outra: Cancelar/voltar retorna para ela

function formModal(title, fields, data, onSave, opts = {}) {
  const m = $("#modal");
  const gen = ++modalGen;
  modalVoltar = opts.onCancel || null;
  if (!modalHist) {
    if (ignorarPop) passoPendente = true; // cria o passo quando o "voltar" anterior terminar
    else {
      history.pushState({ modal: true }, "", location.href);
      modalHist = true;
    }
  }
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="mTitulo">
    <div class="modal-head"><h3 id="mTitulo">${esc(title)}</h3>
      <button type="button" class="modal-x" data-close-x aria-label="Fechar">✕</button></div>
    <form id="mf"><div class="modal-corpo"><div class="grid">${fields.map((f) => fieldHTML(f, f.k ? data[f.k] : "")).join("")}</div>
    ${opts.extraHTML || ""}
    ${opts.onDelete ? `<div class="zona-excluir"><button type="button" class="btn danger ghost" data-del>${esc(opts.textoExcluir || "Excluir")}</button></div>` : ""}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-close>Cancelar</button>
      <button class="btn primary">Salvar</button></div></form></div>`;
  m.classList.add("open");
  $("[data-close]", m).onclick = cancelarJanela;
  $("[data-close-x]", m).onclick = cancelarJanela;
  if (opts.onDelete) $("[data-del]", m).onclick = opts.onDelete;
  if (opts.onInput) {
    $("#mf").addEventListener("input", opts.onInput);
    opts.onInput();
  }
  $("#mf").onsubmit = (e) => {
    e.preventDefault();
    const vals = {};
    for (const f of fields.filter((x) => x.k)) {
      const el = $(`[name="${f.k}"]`, m);
      if (f.type === "money") {
        vals[f.k] = lerDinheiro(el.value);
        if (Number.isNaN(vals[f.k])) {
          erro(`Valor inválido em "${f.label}". Use números, por exemplo 150 ou 235,50.`);
          el.focus();
          return;
        }
      } else vals[f.k] = f.type === "number" ? (el.value === "" ? "" : num(el.value)) : el.value.trim();
    }
    // se o salvar abriu outra janela (cadastro em sequência), ela continua aberta
    if (onSave(vals) !== false && gen === modalGen) closeModal();
  };
  // no celular, focar abre o teclado e esconde o formulário: só foca no computador
  if (!matchMedia("(max-width: 800px)").matches) setTimeout(() => $("#mf input, #mf select, #mf textarea")?.focus(), 30);
}
function fecharJanela() {
  $("#modal").classList.remove("open");
  $("#modal").innerHTML = "";
}
function closeModal() {
  if (!$("#modal").classList.contains("open")) return;
  modalVoltar = null;
  fecharJanela();
  if (modalHist) {
    modalHist = false;
    ignorarPop = true;
    history.back(); // desfaz o passo criado ao abrir
  }
}
// Cancelar, tocar fora ou Esc: volta para a janela anterior, se houver; senão fecha
function cancelarJanela() {
  if (modalVoltar) modalVoltar();
  else closeModal();
}
window.addEventListener("popstate", () => {
  if (ignorarPop) {
    ignorarPop = false;
    if (passoPendente) {
      passoPendente = false;
      if ($("#modal").classList.contains("open")) {
        history.pushState({ modal: true }, "", location.href);
        modalHist = true;
      }
    }
    return;
  }
  if (modalHist) {
    // botão voltar do celular com a janela aberta: fecha só a janela
    // (ou volta para a janela de onde ela foi aberta)
    modalHist = false;
    const voltar = modalVoltar;
    modalVoltar = null;
    fecharJanela();
    if (voltar) voltar();
  }
});
$("#modal").addEventListener("mousedown", (e) => {
  if (e.target.id === "modal") cancelarJanela();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#modal").classList.contains("open")) cancelarJanela();
});

// ---------- clientes ----------
const clienteFields = () => [
  { k: "nome", label: "Nome", required: true, full: true, palavras: true, ph: "Ex.: João Pereira" },
  { k: "telefone", label: "Telefone", type: "tel", required: true, ph: "(67) 98888-7777", full: true },
  { k: "endereco", label: "Endereço", palavras: true, ph: "Rua, número e bairro", full: true },
];
function editCliente(id, after, opts = {}) {
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
  }, opts);
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
      { v: "", l: "Escolha o dono do veículo" },
      ...db.clientes
        .slice()
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((c) => ({ v: c.id, l: c.nome })),
    ],
  },
  { sec: "Dados do veículo" },
  { k: "placa", label: "Placa", required: true, ph: "ABC1D23", caps: true, metade: true },
  { k: "marca", label: "Marca", ph: "Ex.: Volkswagen", palavras: true, metade: true },
  { k: "modelo", label: "Modelo", required: true, ph: "Ex.: Gol 1.0", palavras: true, full: true },
  {
    k: "km",
    label: "Km atual",
    type: "number",
    step: "1",
    suffix: "km",
    ph: "0",
    full: true,
    hint: "Atualiza sozinho a cada serviço registrado com km.",
  },
];
function editVeiculo(id, preset = {}, after, opts = {}) {
  if (!db.clientes.length) {
    toast("Cadastre o dono (cliente) primeiro");
    return editCliente(null, (cid) => editVeiculo(id, { ...preset, clienteId: cid }, after, opts), opts);
  }
  const v = id ? getVeiculo(id) : { ...preset };
  formModal(id ? "Editar veículo" : "Novo veículo", veiculoFields(), v, (vals) => {
    vals.placa = vals.placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!vals.placa) {
      erro("Informe a placa.");
      return false;
    }
    const dup = db.veiculos.find((x) => x.placa === vals.placa && x.id !== id);
    if (dup) {
      erro("Já existe um veículo com essa placa.");
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
  }, opts);
}

// ---------- serviços ----------
// novosCadastros: mostra as seções "Novo cliente" e "Novo veículo" (só ao registrar)
const servicoFields = (novosCadastros = true) => [
  {
    k: "veiculoId",
    label: "Veículo",
    type: "select",
    required: true,
    full: true,
    options: [
      { v: "", l: "Escolha o veículo" },
      ...db.veiculos
        .slice()
        .sort((a, b) => a.placa.localeCompare(b.placa))
        .map((v) => ({
          v: v.id,
          l: [v.placa, nomeVeiculo(v), getCliente(v.clienteId)?.nome].filter(Boolean).join(" · "),
        })),
    ],
    afterHTML: novosCadastros ? novosCadastrosHTML() : "",
  },
  { sec: "Serviço" },
  { k: "data", label: "Data do serviço", type: "date", required: true, metade: true },
  { k: "km", label: "Km no dia", type: "number", step: "1", ph: "Ex.: 85400", suffix: "km", metade: true },
  {
    k: "descricao",
    label: "O que foi feito",
    type: "textarea",
    rows: 4,
    required: true,
    full: true,
    ph: "Ex.: Troca de óleo 5W30 e filtro de óleo",
  },
  { sec: "Valores" },
  { k: "maoDeObra", label: "Mão de obra", type: "money", ph: "0,00", prefix: "R$", metade: true },
  { k: "pecas", label: "Peças", type: "money", ph: "0,00", prefix: "R$", metade: true },
];

/* "Novo cliente" e "Novo veículo" dentro do formulário de serviço: duas seções
   que abrem e fecham (nessa ordem). Os campos delas não fazem parte do serviço;
   ao Salvar, o app cria o cliente, depois o veículo e por fim o serviço. */
function novosCadastrosHTML() {
  const clientes = db.clientes.slice().sort((a, b) => a.nome.localeCompare(b.nome));
  return `<details class="sub-form" id="dNovoCliente">
      <summary>Novo cliente</summary>
      <div class="grid">
        <div class="full"><label>Nome <span class="obrig">*</span></label><input name="nc_nome" autocomplete="off" autocapitalize="words" placeholder="Ex.: João Pereira"></div>
        <div><label>Telefone <span class="obrig">*</span></label><input name="nc_telefone" type="tel" inputmode="tel" autocomplete="off" placeholder="(67) 98888-7777"></div>
        <div><label>Endereço</label><input name="nc_endereco" autocomplete="off" autocapitalize="words" placeholder="Rua, número e bairro"></div>
      </div>
    </details>
    <details class="sub-form" id="dNovoVeiculo">
      <summary>Novo veículo</summary>
      <div class="grid">
        <div class="full"><label>Dono <span class="obrig">*</span></label><select name="nv_dono">
          <option value="">Escolha o dono</option>
          <option value="__novo__" hidden disabled>Novo cliente (acima)</option>
          ${clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}
        </select></div>
        <div><label>Placa <span class="obrig">*</span></label><input name="nv_placa" class="maiusculas" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC1D23"></div>
        <div><label>Marca</label><input name="nv_marca" autocomplete="off" autocapitalize="words" placeholder="Ex.: Volkswagen"></div>
        <div class="full"><label>Modelo <span class="obrig">*</span></label><input name="nv_modelo" autocomplete="off" autocapitalize="words" placeholder="Ex.: Gol 1.0"></div>
      </div>
      <p class="hint">O serviço será registrado neste veículo novo.</p>
    </details>`;
}

// Liga as seções: abrir "Novo veículo" dispensa a escolha do veículo; abrir
// "Novo cliente" abre também o veículo, já com o novo cliente como dono.
function ligarNovosCadastros() {
  const dC = $("#dNovoCliente"),
    dV = $("#dNovoVeiculo"),
    sel = $('#mf [name="veiculoId"]'),
    dono = $('#mf [name="nv_dono"]'),
    optNovo = $('#mf [name="nv_dono"] option[value="__novo__"]');
  const sync = () => {
    sel.disabled = dV.open;
    sel.required = !dV.open;
    optNovo.hidden = optNovo.disabled = !dC.open;
    if (dC.open && !dono.value) dono.value = "__novo__";
    if (!dC.open && dono.value === "__novo__") dono.value = "";
  };
  dC.addEventListener("toggle", () => {
    sync();
    if (dC.open) {
      dV.open = true;
      dono.value = "__novo__";
      setTimeout(() => $('#mf [name="nc_nome"]')?.focus(), 30);
    }
  });
  dV.addEventListener("toggle", () => {
    if (dV.open && !dC.open) setTimeout(() => { if (dV.isConnected) (dono.value ? $('#mf [name="nv_placa"]') : dono)?.focus(); }, 30);
    sync();
  });
  sync();
}

// Lê e valida as seções abertas. Devolve { cliente, veiculo } (novos) ou null se inválido.
function lerNovosCadastros(km) {
  const val = (n) => ($(`#mf [name="${n}"]`)?.value || "").trim();
  const abrirC = !!$("#dNovoCliente")?.open, // ao editar, as seções não existem
    abrirV = !!$("#dNovoVeiculo")?.open;
  let cliente = null,
    veiculo = null;
  if (abrirC) {
    if (!val("nc_nome") || !val("nc_telefone")) {
      erro("Novo cliente: informe nome e telefone.");
      return null;
    }
    if (!abrirV) {
      erro("Cadastre também o veículo do novo cliente.");
      $("#dNovoVeiculo").open = true;
      return null;
    }
    cliente = { id: uid(), nome: val("nc_nome"), telefone: val("nc_telefone"), endereco: val("nc_endereco"), criado: today() };
  }
  if (abrirV) {
    const dono = val("nv_dono");
    const clienteId = dono === "__novo__" ? cliente?.id : getCliente(dono)?.id;
    if (!clienteId) {
      erro("Novo veículo: escolha o dono.");
      return null;
    }
    const placa = val("nv_placa").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!placa || !val("nv_modelo")) {
      erro("Novo veículo: informe placa e modelo.");
      return null;
    }
    if (db.veiculos.some((x) => x.placa === placa)) {
      erro("Já existe um veículo com essa placa. Escolha-o na lista de veículos.");
      return null;
    }
    veiculo = { id: uid(), clienteId, placa, marca: val("nv_marca"), modelo: val("nv_modelo"), km: km === "" ? "" : km, criado: today() };
  }
  return { cliente, veiculo };
}

function editServico(id, preset = {}) {
  const s = id ? getServico(id) : { data: today(), ...preset };
  if (!s) return;
  // serviço registrado antes da divisão: mantém o total se os dois campos ficarem vazios
  const totalAntigo = id && !temDivisao(s) && temNum(s.valor) ? num(s.valor) : null;
  const extraHTML = `<div class="total-servico"><span>Total do serviço</span><b id="totalServico">—</b></div>
    ${
      totalAntigo !== null
        ? `<p class="hint">Registrado antes da divisão, com total de ${brl(totalAntigo)}. Preencha mão de obra e peças para dividir; deixando os dois vazios, o total é mantido.</p>`
        : ""
    }`;
  const onInput = () => {
    const mo = lerDinheiro($('#mf [name="maoDeObra"]').value),
      pc = lerDinheiro($('#mf [name="pecas"]').value);
    const vazio = mo === "" && pc === "";
    const ok = (x) => (Number.isNaN(x) || x === "" ? 0 : x);
    $("#totalServico").textContent = vazio
      ? totalAntigo !== null
        ? brl(totalAntigo)
        : "—"
      : brl(ok(mo) + ok(pc));
  };
  formModal(
    id ? "Editar serviço" : "Registrar serviço",
    servicoFields(!id),
    s,
    (vals) => {
      const novos = lerNovosCadastros(vals.km);
      if (!novos) return false;
      const v = novos.veiculo || getVeiculo(vals.veiculoId);
      if (!v) {
        erro("Escolha o veículo ou abra “Novo veículo” para cadastrar um.");
        return false;
      }
      if (!vals.descricao) {
        erro("Descreva o que foi feito.");
        return false;
      }
      vals.veiculoId = v.id;
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
      // tudo validado: grava cliente e veículo novos antes do serviço
      if (novos.cliente) db.clientes.push(novos.cliente);
      if (novos.veiculo) db.veiculos.push(novos.veiculo);
      // total = mão de obra + peças
      if (vals.maoDeObra === "" && vals.pecas === "") vals.valor = totalAntigo !== null ? totalAntigo : "";
      else vals.valor = arred(num(vals.maoDeObra) + num(vals.pecas));
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
      toast(
        novos.cliente ? "Cliente, veículo e serviço salvos" : novos.veiculo ? "Veículo e serviço salvos" : "Serviço salvo",
      );
      render();
    },
    { extraHTML, onInput },
  );
  if (id) return; // editar serviço: sem as seções de novo cliente e novo veículo
  ligarNovosCadastros();
  // sem veículos (ou sem clientes) cadastrados: já abre as seções necessárias
  if (!db.clientes.length) $("#dNovoCliente").open = true;
  else if (!db.veiculos.length) $("#dNovoVeiculo").open = true;
}

function removeItem(kind, id) {
  if (kind === "cliente") {
    if (db.veiculos.some((v) => v.clienteId === id))
      return erro("Este cliente é dono de veículos. Passe os veículos para outro dono ou exclua-os antes.");
    if (db.servicos.some((s) => s.clienteId === id))
      return erro("Este cliente aparece no histórico de serviços e não pode ser excluído.");
    if (!confirm("Excluir este cliente?")) return;
    db.clientes = db.clientes.filter((c) => c.id !== id);
    save();
    location.hash = "#clientes";
  } else if (kind === "veiculo") {
    if (db.servicos.some((s) => s.veiculoId === id))
      return erro("Este veículo tem serviços no histórico. Exclua os serviços antes.");
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
    if (location.hash.startsWith("#servico/")) sair(v ? `#veiculo/${v.id}` : "#servicos");
    else render();
  }
}

// ---------- telas ----------
// Lista de serviços: cartões agrupados por mês
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ICO_KM = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 17a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/></svg>`;
const ICO_DONO = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>`;
const ICO_TEL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>`;
const ICO_LOCAL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`;
const ICO_DATA = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;
const ICO_SERV = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/></svg>`;
const ICO_CARRO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3zM5 11h14"/><circle cx="7.5" cy="13.5" r=".6"/><circle cx="16.5" cy="13.5" r=".6"/></svg>`;
const ICO_SETA = `<svg class="item-seta" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
const ICO_PDF = `<svg class="ico-btn" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>`;
const chip = (ico, html) => (html ? `<span class="sv-chip">${ico}${html}</span>` : "");
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const iniciais = (nome) =>
  String(nome || "?").trim().split(/\s+/).filter(Boolean).map((p) => p[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join("").toUpperCase() || "?";
// cor estável do avatar a partir do nome
const corAvatar = (nome) => {
  let h = 0;
  for (const ch of String(nome || "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
};
const avatar = (nome, cls = "") => `<span class="avatar ${cls}" style="background:${corAvatar(nome)}" aria-hidden="true">${esc(iniciais(nome))}</span>`;

// Cartão de veículo (lista de veículos e ficha do cliente)
function veiculoItem(v, { dono = true, acao = "" } = {}) {
  const c = getCliente(v.clienteId),
    hist = servicosDoVeiculo(v.id),
    ult = hist[0];
  return `<div class="item" data-href="#veiculo/${esc(v.id)}" role="link" tabindex="0">
    <span class="item-ico">${ICO_CARRO}</span>
    <div class="item-corpo">
      <div class="item-titulo">${plate(v.placa)} <span>${esc(nomeVeiculo(v)) || "—"}</span></div>
      <div class="sv-meta">
        ${dono ? chip(ICO_DONO, esc(c?.nome || "Sem dono")) : ""}
        ${chip(ICO_KM, kmFmt(v.km))}
        ${chip(ICO_SERV, plural(hist.length, "serviço", "serviços"))}
        ${ult ? chip(ICO_DATA, "Último: " + fmtDate(ult.data)) : ""}
      </div>
    </div>
    ${acao || ICO_SETA}
  </div>`;
}

// Cartão de cliente (lista de clientes)
function clienteItem(c) {
  const veics = db.veiculos.filter((v) => v.clienteId === c.id),
    nServ = db.servicos.filter((s) => s.clienteId === c.id).length;
  return `<div class="item" data-href="#cliente/${esc(c.id)}" role="link" tabindex="0">
    ${avatar(c.nome)}
    <div class="item-corpo">
      <div class="item-titulo"><span>${esc(c.nome)}</span></div>
      <div class="sv-meta">
        ${chip(ICO_TEL, esc(c.telefone))}
        ${chip(ICO_CARRO, plural(veics.length, "veículo", "veículos"))}
        ${chip(ICO_SERV, plural(nServ, "serviço", "serviços"))}
      </div>
      ${veics.length ? `<div class="item-placas">${veics.map((v) => plate(v.placa)).join("")}</div>` : ""}
    </div>
    ${ICO_SETA}
  </div>`;
}

const listaInfo = (n, um, varios, busca) =>
  `<p class="lista-info">${plural(n, um, varios)}${busca ? (n === 1 ? " encontrado" : " encontrados") : ""}</p>`;
const listaVazia = (txt, botao = "") => `<div class="card vazio"><p>${txt}</p>${botao}</div>`;
const zonaExcluir = (kind, id, txt) =>
  `<div class="zona-excluir"><button class="btn danger ghost" data-act="del" data-kind="${kind}" data-id="${esc(id)}">${txt}</button></div>`;

function mesDoServico(s) {
  const m = /^(\d{4})-(\d{2})/.exec(s.data || "");
  return m ? { chave: m[1] + "-" + m[2], nome: `${MESES[+m[2] - 1]} de ${m[1]}` } : { chave: "", nome: "Sem data" };
}

function servicoCartao(s, { dono = true, veiculo = true, donoAtual = null } = {}) {
  const v = getVeiculo(s.veiculoId),
    c = getCliente(s.clienteId);
  const [, mes, dia] = String(s.data || "").slice(0, 10).split("-");
  const meta = [
    temNum(s.km) ? `<span class="sv-chip">${ICO_KM}${kmFmt(s.km)}</span>` : "",
    dono && c && (!donoAtual || c.id !== donoAtual)
      ? `<span class="sv-chip">${ICO_DONO}${donoAtual ? "Dono na época: " : ""}${esc(c.nome)}</span>`
      : "",
  ].join("");
  return `<article class="sv click${veiculo ? "" : " sem-veiculo"}" data-servico="${esc(s.id)}" tabindex="0">
    <div class="sv-data" title="${fmtDate(s.data)}">${
      dia ? `<b>${dia}</b><span>${MESES_CURTOS[+mes - 1] || ""}</span>` : "<span>—</span>"
    }</div>
    <div class="sv-corpo">
      ${veiculo ? `<div class="sv-veiculo">${v ? `${plate(v.placa)} <span>${esc(nomeVeiculo(v))}</span>` : `<span class="muted">Veículo removido</span>`}</div>` : ""}
      <div class="sv-desc clamp">${esc(s.descricao)}</div>
      ${meta ? `<div class="sv-meta">${meta}</div>` : ""}
    </div>
    <div class="sv-valores">
      <b class="sv-total">${valorOuTraco(s.valor)}</b>
      ${
        temDivisao(s)
          ? `<div class="sv-partes">${temNum(s.maoDeObra) ? `<span>Mão de obra <b>${brl(s.maoDeObra)}</b></span>` : ""}${
              temNum(s.pecas) ? `<span>Peças <b>${brl(s.pecas)}</b></span>` : ""
            }</div>`
          : ""
      }
    </div>
  </article>`;
}

function servicoLista(list, { vazio = "Nenhum serviço registrado", ...opcoes } = {}) {
  if (!list.length) return listaVazia(vazio);
  const grupos = [];
  for (const s of ordenarServicos(list)) {
    const m = mesDoServico(s);
    if (!grupos.length || grupos.at(-1).chave !== m.chave) grupos.push({ ...m, itens: [] });
    grupos.at(-1).itens.push(s);
  }
  return `<div class="sv-lista">${grupos
    .map(
      (g) => `<section class="sv-mes">
      <header class="sv-mes-head"><h2>${g.nome}</h2><span>${g.itens.length} ${g.itens.length === 1 ? "serviço" : "serviços"} · <b>${brl(
        totalValor(g.itens),
      )}</b></span></header>
      ${g.itens.map((s) => servicoCartao(s, opcoes)).join("")}
    </section>`,
    )
    .join("")}</div>`;
}

const resumoServicos = (list) => `<div class="sv-resumo">
  <div><span>Serviços</span><b>${list.length}</b></div>
  <div><span>Mão de obra</span><b>${brl(somaCampo(list, "maoDeObra"))}</b></div>
  <div><span>Peças</span><b>${brl(somaCampo(list, "pecas"))}</b></div>
  <div class="destaque"><span>Total</span><b>${brl(totalValor(list))}</b></div>
</div>`;

// Painel: últimos serviços como linha do tempo, uma informação embaixo da outra
function ultimosServicos(list) {
  if (!list.length) return `<p class="empty">Nenhum serviço registrado</p>`;
  return `<div class="timeline ultimos">${list
    .map((s) => {
      const v = getVeiculo(s.veiculoId),
        c = getCliente(s.clienteId) || getCliente(v?.clienteId);
      return `<div class="tl-item click" data-servico="${esc(s.id)}">
        <div class="ul-cliente strong">${esc(c?.nome || "—")}</div>
        <div class="ul-placa">${v ? plate(v.placa) : "—"}</div>
        <div class="ul-modelo muted">${esc(v ? v.modelo || "—" : "Veículo removido")}</div>
        <div class="ul-total"><b>${valorOuTraco(s.valor)}</b></div>
      </div>`;
    })
    .join("")}</div>`;
}

// Campo de pesquisa: só "Pesquisar" como dica e a lupa à direita
const campoBusca = (valor) => `<div class="toolbar"><div class="busca">
  <input id="fBusca" type="search" enterkeyhint="search" autocomplete="off" placeholder="Pesquisar" aria-label="Pesquisar" value="${esc(valor || "")}">
  <svg class="busca-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
</div></div>`;

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
        <div class="stat"><div class="l">Mão de obra no mês</div><div class="v">${brl(somaCampo(doMes, "maoDeObra"))}</div></div>
        <div class="stat"><div class="l">Peças no mês</div><div class="v">${brl(somaCampo(doMes, "pecas"))}</div></div>
      </div>
      <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Últimos serviços</h2>
        <a class="btn sm" href="#servicos">Ver todos</a></div>
        ${ultimosServicos(ordenarServicos(db.servicos).slice(0, 8))}</div>`;
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
      ${campoBusca(q.q)}
      ${resumoServicos(list)}
      ${servicoLista(list, { vazio: busca ? "Nenhum serviço encontrado" : "Nenhum serviço registrado" })}`;
  },

  servico([id]) {
    const s = getServico(id);
    if (!s) return notFound();
    Nota.preparar(); // deixa o logo pronto para a nota
    const v = getVeiculo(s.veiculoId),
      c = getCliente(s.clienteId),
      donoAtual = v && getCliente(v.clienteId);
    const [ano, mes, dia] = String(s.data || "").slice(0, 10).split("-");
    const dataLonga = dia ? `${+dia} de ${MESES[+mes - 1].toLowerCase()} de ${ano}` : "Sem data";
    const criado = String(s.criado || "").slice(0, 10);
    const linhaValor = (rot, val, cls = "") => `<div class="sd-linha ${cls}"><span>${rot}</span><b>${valorOuTraco(val)}</b></div>`;
    return `<a href="#servicos" class="voltar" data-act="voltar">← Voltar</a>
      <div class="card ficha">
        <div class="ficha-topo">
          <div class="sv-data grande">${dia ? `<b>${dia}</b><span>${MESES_CURTOS[+mes - 1]}</span>` : "<span>—</span>"}</div>
          <div class="ficha-nome"><span class="sd-sobre">Serviço</span><h1>${dataLonga}</h1></div>
        </div>
        <div class="sd-bloco"><span class="ficha-rot">${ICO_SERV}O que foi feito</span><div class="sd-desc">${esc(s.descricao) || "—"}</div></div>
        <div class="ficha-dados">
          <div><span class="ficha-rot">${ICO_KM}Km no dia</span>${kmFmt(s.km)}</div>
          <div><span class="ficha-rot">${ICO_DONO}Dono na época</span>${c ? `<a href="#cliente/${c.id}">${esc(c.nome)}</a>` : "—"}</div>
          <div><span class="ficha-rot">${ICO_TEL}Telefone</span>${telLink(c?.telefone)}</div>
          ${criado ? `<div><span class="ficha-rot">${ICO_DATA}Registrado em</span>${fmtDate(criado)}</div>` : ""}
        </div>
        <div class="ficha-acoes"><button class="btn primary" data-act="editServico" data-id="${esc(id)}">Editar serviço</button>
          <button class="btn" data-act="gerarNota" data-id="${esc(id)}">${ICO_PDF}Gerar nota (PDF)</button>${
          v ? btnServico(v.id, "+ Novo serviço neste veículo", "btn") : ""
        }</div>
      </div>
      <div class="card sd-valores">
        <h2>Valores</h2>
        ${linhaValor("Mão de obra", s.maoDeObra)}
        ${linhaValor("Peças", s.pecas)}
        ${linhaValor("Total do serviço", s.valor, "sd-total")}
        ${!temDivisao(s) && temNum(s.valor) ? `<p class="hint">Registrado sem a divisão entre mão de obra e peças.</p>` : ""}
      </div>
      <h2 class="sv-titulo">Veículo</h2>
      ${v ? `<div class="itens">${veiculoItem(v)}</div>` : listaVazia("O veículo deste serviço foi removido.")}
      ${v && donoAtual && c && donoAtual.id !== c.id ? `<p class="hint sd-aviso">Hoje o veículo é de ${esc(donoAtual.nome)}.</p>` : ""}
      ${zonaExcluir("servico", id, "Excluir serviço")}`;
  },

  veiculos(_, q) {
    const busca = norm(q.q);
    const list = db.veiculos
      .filter((v) => !busca || norm(`${v.placa} ${nomeVeiculo(v)} ${getCliente(v.clienteId)?.nome}`).includes(busca))
      .sort((a, b) => a.placa.localeCompare(b.placa));
    return `<div class="page-head"><h1>Veículos</h1><button class="btn primary" data-act="novoVeiculo">+ Novo veículo</button></div>
      ${campoBusca(q.q)}
      ${
        list.length
          ? `${listaInfo(list.length, "veículo", "veículos", busca)}<div class="itens">${list.map((v) => veiculoItem(v)).join("")}</div>`
          : busca
            ? listaVazia("Nenhum veículo encontrado")
            : listaVazia("Nenhum veículo cadastrado ainda.", `<button class="btn primary" data-act="novoVeiculo">+ Cadastrar o primeiro veículo</button>`)
      }`;
  },

  veiculo([id]) {
    const v = getVeiculo(id);
    if (!v) return notFound();
    const c = getCliente(v.clienteId);
    const hist = servicosDoVeiculo(id);
    return `<a href="#veiculos" class="voltar">← Veículos</a>
      <div class="card ficha">
        <div class="ficha-topo">
          <span class="item-ico grande">${ICO_CARRO}</span>
          <div class="ficha-nome">${plate(v.placa)}<h1>${esc(nomeVeiculo(v)) || "Veículo"}</h1></div>
        </div>
        <div class="ficha-dados">
          <div><span class="ficha-rot">${ICO_DONO}Dono atual</span>${c ? `<a href="#cliente/${c.id}">${esc(c.nome)}</a>` : "—"}</div>
          <div><span class="ficha-rot">${ICO_TEL}Telefone</span>${telLink(c?.telefone)}</div>
          <div><span class="ficha-rot">${ICO_KM}Km atual</span>${kmFmt(v.km)}</div>
        </div>
        <div class="ficha-acoes">${btnServico(id)}<button class="btn" data-act="editVeiculo" data-id="${id}">Editar veículo</button></div>
      </div>
      ${resumoServicos(hist)}
      <h2 class="sv-titulo">Histórico de serviços</h2>
      ${servicoLista(hist, { veiculo: false, donoAtual: v.clienteId, vazio: "Nenhum serviço registrado ainda." })}
      ${zonaExcluir("veiculo", id, "Excluir veículo")}`;
  },

  clientes(_, q) {
    const busca = norm(q.q);
    const list = db.clientes
      .filter((c) => !busca || norm(`${c.nome} ${c.telefone} ${c.endereco}`).includes(busca))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    return `<div class="page-head"><h1>Clientes</h1><button class="btn primary" data-act="novoCliente">+ Novo cliente</button></div>
      ${campoBusca(q.q)}
      ${
        list.length
          ? `${listaInfo(list.length, "cliente", "clientes", busca)}<div class="itens">${list.map(clienteItem).join("")}</div>`
          : busca
            ? listaVazia("Nenhum cliente encontrado")
            : listaVazia("Nenhum cliente cadastrado ainda.", `<button class="btn primary" data-act="novoCliente">+ Cadastrar o primeiro cliente</button>`)
      }`;
  },

  cliente([id]) {
    const c = getCliente(id);
    if (!c) return notFound();
    const veics = db.veiculos.filter((v) => v.clienteId === id).sort((a, b) => a.placa.localeCompare(b.placa));
    const servs = db.servicos.filter((s) => s.clienteId === id);
    return `<a href="#clientes" class="voltar">← Clientes</a>
      <div class="card ficha">
        <div class="ficha-topo">${avatar(c.nome, "grande")}<div class="ficha-nome"><h1>${esc(c.nome)}</h1></div></div>
        <div class="ficha-dados">
          <div><span class="ficha-rot">${ICO_TEL}Telefone</span>${telLink(c.telefone)}</div>
          <div><span class="ficha-rot">${ICO_LOCAL}Endereço</span>${esc(c.endereco) || "—"}</div>
        </div>
        <div class="ficha-acoes"><button class="btn" data-act="editCliente" data-id="${id}">Editar cliente</button></div>
      </div>
      ${resumoServicos(servs)}
      <div class="secao-head"><h2>Veículos</h2><button class="btn sm" data-act="novoVeiculo" data-cliente="${id}">+ Adicionar veículo</button></div>
      ${
        veics.length
          ? `<div class="itens">${veics
              .map((v) => veiculoItem(v, { dono: false, acao: btnServico(v.id, "+ Serviço", "btn sm item-acao") }))
              .join("")}</div>`
          : listaVazia("Nenhum veículo deste cliente.")
      }
      <h2 class="sv-titulo">Serviços feitos para este cliente</h2>
      ${servicoLista(servs, { dono: false })}
      ${zonaExcluir("cliente", id, "Excluir cliente")}`;
  },

  config() {
    const o = db.config;
    return `<div class="page-head"><h1>Ajustes</h1></div>
      <div class="card"><div class="secao-head" style="margin-top:0"><h2>Dados da oficina</h2>
          <button class="btn sm" data-act="editOficina">Editar</button></div>
        <p class="muted" style="margin-top:0">Aparecem no topo da nota de serviço em PDF, junto com o logo.</p>
        <div class="ficha-dados oficina-dados">
          <div><span class="ficha-rot">Nome</span>${esc(o.nome) || "—"}</div>
          <div><span class="ficha-rot">${ICO_LOCAL}Endereço</span>${esc(o.endereco) || '<span class="falta">Não informado</span>'}</div>
          <div><span class="ficha-rot">${ICO_TEL}Telefone</span>${esc(o.telefone) || '<span class="falta">Não informado</span>'}</div>
          ${o.documento ? `<div><span class="ficha-rot">CNPJ/CPF</span>${esc(o.documento)}</div>` : ""}
        </div>
      </div>
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
          <div><span>Versão</span><b id="appVersao">${VERSION_NAME}</b> <span class="muted versao-codigo">(código ${VERSION_CODE})</span></div>
          <div><span>Dados</span>${window.cloud?.on ? "Salvos na nuvem" : "Só neste aparelho (modo local)"}</div>
        </div>
        <div class="actions" style="margin-top:14px"><button class="btn" data-act="procurarAtualizacao">↻ Procurar atualização</button></div>
      </div>`;
  },
};

function notFound() {
  return `<div class="card empty">Registro não encontrado. <a href="#painel">Voltar ao painel</a></div>`;
}

// ---------- nota de serviço (PDF) ----------
function editOficina(after) {
  formModal(
    "Dados da oficina",
    [
      { k: "nome", label: "Nome da oficina", required: true, full: true, palavras: true },
      { k: "endereco", label: "Endereço", full: true, palavras: true, ph: "Rua, número, bairro e cidade" },
      { k: "telefone", label: "Telefone / WhatsApp", type: "tel", metade: true, ph: "(67) 99999-0000" },
      { k: "documento", label: "CNPJ ou CPF (opcional)", metade: true },
    ],
    db.config,
    (vals) => {
      Object.assign(db.config, vals);
      save();
      toast("Dados da oficina salvos");
      after ? after() : render();
    },
  );
}
function gerarNota(id) {
  const s = getServico(id);
  if (!s) return;
  const o = db.config;
  if (!o.endereco || !o.telefone) {
    toast("Preencha o endereço e o telefone da oficina para a nota", "erro");
    return editOficina(() => {
      render();
      if (db.config.endereco && db.config.telefone) gerarNota(id);
    });
  }
  if (!Nota.pronto()) return Nota.preparar().then(() => criarNota(s));
  criarNota(s);
}
function criarNota(s) {
  const v = getVeiculo(s.veiculoId),
    c = getCliente(s.clienteId);
  let blob;
  try {
    blob = Nota.gerar({
      oficina: db.config,
      data: fmtDate(s.data),
      cliente: { nome: c?.nome, telefone: c?.telefone, endereco: c?.endereco },
      veiculo: { placa: v?.placa, nome: v ? nomeVeiculo(v) : "Veículo removido" },
      itens: String(s.descricao || "").split(/\r?\n/).map((l) => l.trim().replace(/^[-•*]\s*/, "")).filter(Boolean),
      maoDeObra: num(s.maoDeObra),
      pecas: num(s.pecas),
      total: num(s.valor),
      temDivisao: temDivisao(s),
      fmt: brl,
    });
  } catch (e) {
    console.error(e);
    return erro("Não foi possível gerar a nota.");
  }
  const nome = ["nota-servico", v?.placa, fmtDate(s.data).replace(/\//g, "-")].filter(Boolean).join("-") + ".pdf";
  entregarArquivo(blob, nome);
}
// no celular abre o "compartilhar" (WhatsApp, salvar em Arquivos...); no computador baixa
function entregarArquivo(blob, nome) {
  const baixar = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast("Nota gerada: " + nome);
  };
  let arquivo = null;
  try {
    arquivo = new File([blob], nome, { type: "application/pdf" });
  } catch {}
  const celular = matchMedia("(pointer: coarse)").matches;
  if (arquivo && celular && navigator.canShare?.({ files: [arquivo] })) {
    navigator.share({ files: [arquivo], title: nome }).catch((e) => {
      if (e?.name !== "AbortError") baixar();
    });
  } else baixar();
}

// ---------- navegação ----------
let rotaAtual = location.hash,
  rotaAnterior = null; // tela de onde se veio dentro do app (null ao abrir direto pelo link)
// "← Voltar": volta para a tela anterior do app; aberto direto pelo link, vai para a lista
function sair(padrao) {
  if (rotaAnterior && rotaAnterior !== location.hash) history.back();
  else location.replace(padrao);
}

// ---------- ações ----------
const actions = {
  editServico: (b) => editServico(b.dataset.id),
  gerarNota: (b) => gerarNota(b.dataset.id),
  editOficina: () => editOficina(),
  voltar: (b) => sair(b.getAttribute("href") || "#painel"),
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
    if (nova === false) toast(`Você já está na versão mais recente (${VERSION_NAME}).`);
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
  if (sv) return (location.hash = `#servico/${sv.dataset.servico}`);
  const tr = e.target.closest("[data-href]");
  if (tr) location.hash = tr.dataset.href;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || $("#modal").classList.contains("open")) return;
  const el = e.target.closest?.("[data-href], [data-servico]");
  if (el && el === e.target) el.click();
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
        erro("Arquivo de backup inválido.");
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
  const section = { cliente: "clientes", veiculo: "veiculos", servico: "servicos" }[name] || (views[name] ? name : "painel");
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
    const codigo = num(v.versionCode ?? v.versao);
    if (codigo > VERSION_CODE) {
      avisoAtualizacao(v.versionName);
      return true;
    }
    return false;
  } catch (e) {
    return null; // sem internet: tenta de novo depois
  }
}
function avisoAtualizacao(nome) {
  if ($("#upd")) return;
  const el = document.createElement("div");
  el.id = "upd";
  el.className = "upd";
  el.setAttribute("role", "status");
  el.innerHTML = `<span>Nova versão do app disponível${nome ? ` (${esc(nome)})` : ""}.</span>
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
  rotaAnterior = rotaAtual;
  rotaAtual = location.hash;
  render();
  window.scrollTo(0, 0);
});
// render() inicial é chamado por cloud.js depois do login
