/* Login e sincronização com Supabase.
   Cada cliente, veículo, peça e orçamento é uma linha da tabela "registros".
   Só as linhas que mudaram são enviadas, então dois computadores podem
   trabalhar ao mesmo tempo sem apagar o que o outro fez.
   Sem config.js preenchido, o app roda em modo local (só neste navegador). */

const TIPOS = ['clientes', 'veiculos', 'pecas', 'orcamentos'];
const CFG = window.OFICINA_CONFIG || {};

const cloud = {
  on: false,
  sb: null,
  synced: new Map(), // "tipo|id" -> JSON enviado por último
  dirty: false,
  syncing: false,
  timer: null,

  snapshot() {
    const m = new Map();
    for (const t of TIPOS) for (const r of db[t]) m.set(t + '|' + r.id, JSON.stringify(r));
    m.set('config|main', JSON.stringify(db.config));
    return m;
  },

  schedule() {
    if (!cloud.on) return;
    cloud.dirty = true; setSync('pending');
    clearTimeout(cloud.timer); cloud.timer = setTimeout(cloud.flush, 400);
  },

  async flush() {
    if (cloud.syncing) { cloud.timer = setTimeout(cloud.flush, 400); return; }
    cloud.syncing = true; cloud.dirty = false;
    const snap = cloud.snapshot();
    const up = [], del = [];
    for (const [k, v] of snap) if (cloud.synced.get(k) !== v) {
      const [tipo, id] = k.split('|');
      up.push({ tipo, id, data: JSON.parse(v), updated_at: new Date().toISOString() });
    }
    for (const k of cloud.synced.keys()) if (!snap.has(k)) del.push(k);
    try {
      for (let i = 0; i < up.length; i += 200) {
        const { error } = await cloud.sb.from('registros').upsert(up.slice(i, i + 200));
        if (error) throw error;
      }
      for (const k of del) {
        const [tipo, id] = k.split('|');
        const { error } = await cloud.sb.from('registros').delete().match({ tipo, id });
        if (error) throw error;
      }
      up.forEach(r => cloud.synced.set(r.tipo + '|' + r.id, JSON.stringify(r.data)));
      del.forEach(k => cloud.synced.delete(k));
      setSync(cloud.dirty ? 'pending' : 'ok');
    } catch (e) {
      console.error('Falha ao sincronizar', e);
      cloud.dirty = true; setSync('error');
      clearTimeout(cloud.timer); cloud.timer = setTimeout(cloud.flush, 5000);
    } finally { cloud.syncing = false; }
  },

  async pull() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await cloud.sb.from('registros').select('tipo,id,data').range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows;
  },

  apply(rows) {
    const d = blankDB(), synced = new Map();
    for (const r of rows) {
      if (r.tipo === 'config') d.config = { ...d.config, ...r.data };
      else if (TIPOS.includes(r.tipo)) d[r.tipo].push(r.data);
      synced.set(r.tipo + '|' + r.id, JSON.stringify(r.data));
    }
    db = d; cloud.synced = synced;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* cache opcional */ }
  },

  // Busca alterações feitas em outro computador (sem atrapalhar quem está editando)
  async refresh() {
    if (!cloud.on || cloud.dirty || cloud.syncing || $('#modal').classList.contains('open')) return;
    try {
      const rows = await cloud.pull();
      if (cloud.dirty) return;
      const before = JSON.stringify([...cloud.synced].sort());
      const after = JSON.stringify(rows.map(r => [r.tipo + '|' + r.id, JSON.stringify(r.data)]).sort());
      if (before === after) return;
      cloud.apply(rows);
      if (!location.hash.startsWith('#orcamento/')) render();
    } catch (e) { setSync('error'); }
  },
};
window.cloud = cloud;

function setSync(state) {
  const el = $('#syncStatus'); if (!el) return;
  const map = {
    ok: ['Salvo na nuvem', 'ok'], pending: ['Salvando...', 'pending'],
    error: ['Sem conexão, tentando de novo', 'error'], local: ['Modo local (sem nuvem)', 'pending'],
  };
  const [txt, cls] = map[state];
  el.textContent = '● ' + txt; el.className = 'sync ' + cls;
}

function showLogin(msg) {
  $('#login').hidden = false;
  $('#loginErr').textContent = msg || '';
  setTimeout(() => $('#loginEmail').focus(), 30);
}

async function startCloud(session) {
  $('#login').hidden = true;
  $('#userBox').hidden = false;
  $('#userEmail').textContent = session.user.email;
  $('#main').innerHTML = '<div class="card empty">Carregando dados...</div>';
  try {
    const rows = await cloud.pull();
    const local = loadDB();
    const temLocal = TIPOS.some(t => local[t].length);
    if (!rows.length && temLocal) {
      // primeira vez na nuvem: leva os dados que já estavam neste navegador
      db = local; cloud.synced = new Map(); cloud.on = true;
      render(); cloud.schedule(); toast('Dados deste computador enviados para a nuvem');
      return;
    }
    cloud.apply(rows); cloud.on = true; setSync('ok'); render();
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="card empty">Não foi possível carregar os dados (${esc(e.message || e)}).
      <br><br><button class="btn primary" onclick="location.reload()">Tentar de novo</button></div>`;
    setSync('error');
  }
}

async function boot() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
    setSync('local'); render(); return;
  }
  cloud.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#loginForm button'); btn.disabled = true; $('#loginErr').textContent = '';
    const { data, error } = await cloud.sb.auth.signInWithPassword({
      email: $('#loginEmail').value.trim(), password: $('#loginPass').value,
    });
    btn.disabled = false;
    if (error) { $('#loginErr').textContent = 'E-mail ou senha incorretos.'; return; }
    $('#loginPass').value = '';
    startCloud(data.session);
  };
  $('#logoutBtn').onclick = async () => {
    if (cloud.dirty && !confirm('Ainda há alterações sendo salvas. Sair mesmo assim?')) return;
    await cloud.sb.auth.signOut();
    localStorage.removeItem(DB_KEY);
    location.reload();
  };
  const { data } = await cloud.sb.auth.getSession();
  if (data.session) startCloud(data.session); else showLogin();

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloud.refresh(); });
  setInterval(cloud.refresh, 60000);
  window.addEventListener('beforeunload', e => { if (cloud.dirty || cloud.syncing) { e.preventDefault(); e.returnValue = ''; } });
}

boot();
