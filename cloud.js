/* Login e sincronização com Supabase.
   Cada cliente, veículo e serviço é uma linha da tabela "registros".
   Só as linhas que mudaram são enviadas, então dois computadores podem
   trabalhar ao mesmo tempo sem apagar o que o outro fez.
   Linhas de tipos que o app não usa mais (orçamentos e peças da versão
   anterior) são ignoradas; o supabase.sql as apaga do banco.
   Sem config.js preenchido, o app roda em modo local (só neste navegador). */

const TIPOS = ['clientes', 'veiculos', 'servicos'];
const conhecido = (tipo) => tipo === 'config' || TIPOS.includes(tipo);

/* Trava de compatibilidade: a linha tipo 'sistema', id 'versao' guarda
   { minima: N }. Um app com APP_VERSAO menor que N não grava nada e pede
   atualização. Só a versão publicada no site oficial (CFG.siteUrl) sobe esse
   número, então testar uma versão nova no computador nunca trava quem usa o site. */
const SISTEMA = { tipo: 'sistema', id: 'versao' };
const publicado = () => !!CFG.siteUrl && location.href.startsWith(CFG.siteUrl);
const CFG = window.OFICINA_CONFIG || {};

const cloud = {
  on: false,
  sb: null,
  minima: 0,        // versão mínima do app exigida pelo banco
  bloqueado: false, // true = este app está desatualizado e não grava
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

  // Compara a versão exigida pelo banco com esta. Devolve false se bloqueou.
  checarCompat() {
    if (cloud.minima > APP_VERSAO) {
      cloud.bloqueado = true; clearTimeout(cloud.timer);
      setSync('old'); bloquearDesatualizado();
      return false;
    }
    if (cloud.minima < COMPAT_MINIMA && publicado() && !cloud.subindo) {
      cloud.subindo = true;
      cloud.sb.from('registros')
        .upsert({ ...SISTEMA, data: { minima: COMPAT_MINIMA, app: APP_VERSAO }, updated_at: new Date().toISOString() })
        .then(({ error }) => { if (!error) cloud.minima = COMPAT_MINIMA; })
        .finally(() => { cloud.subindo = false; });
    }
    return true;
  },

  // Lê só a linha da versão mínima (consulta pequena, feita antes de gravar)
  async lerMinima() {
    const { data, error } = await cloud.sb.from('registros').select('data')
      .eq('tipo', SISTEMA.tipo).eq('id', SISTEMA.id);
    if (error) throw error;
    return Number(data?.[0]?.data?.minima) || 0;
  },

  schedule() {
    if (!cloud.on || cloud.bloqueado) return;
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
      // antes de gravar, confere se uma versão mais nova do app já assumiu os dados
      if (up.length || del.length) {
        cloud.minima = await cloud.lerMinima();
        if (!cloud.checarCompat()) return;
      }
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

  // Monta o db a partir das linhas do banco
  apply(rows) {
    const d = blankDB(), synced = new Map();
    cloud.minima = 0;
    for (const r of rows) {
      if (r.tipo === SISTEMA.tipo && r.id === SISTEMA.id) { cloud.minima = Number(r.data?.minima) || 0; continue; }
      if (!conhecido(r.tipo)) continue; // tipos antigos: ignorados e nunca apagados por aqui
      if (r.tipo === 'config') d.config = { ...d.config, ...r.data };
      else d[r.tipo].push(r.data);
      synced.set(r.tipo + '|' + r.id, JSON.stringify(r.data));
    }
    db = d; cloud.synced = synced;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* cache opcional */ }
  },

  // Busca alterações feitas em outro computador (sem atrapalhar quem está editando)
  async refresh() {
    if (!cloud.on || cloud.bloqueado || cloud.dirty || cloud.syncing || $('#modal').classList.contains('open')) return;
    try {
      const rows = await cloud.pull();
      if (cloud.dirty) return;
      const sis = rows.find(r => r.tipo === SISTEMA.tipo && r.id === SISTEMA.id);
      cloud.minima = Number(sis?.data?.minima) || 0;
      if (!cloud.checarCompat()) return;
      const before = JSON.stringify([...cloud.synced].sort());
      const after = JSON.stringify(rows.filter(r => conhecido(r.tipo))
        .map(r => [r.tipo + '|' + r.id, JSON.stringify(r.data)]).sort());
      if (before === after) return;
      cloud.apply(rows);
      render();
    } catch (e) { setSync('error'); }
  },
};
window.cloud = cloud;

function setSync(state) {
  const el = $('#syncStatus'); if (!el) return;
  const map = {
    ok: ['Salvo na nuvem', 'ok'], pending: ['Salvando...', 'pending'],
    error: ['Sem conexão, tentando de novo', 'error'], local: ['Modo local (sem nuvem)', 'pending'],
    old: ['App desatualizado: atualize', 'error'],
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
    if (!rows.some(r => conhecido(r.tipo)) && temLocal) {
      // primeira vez na nuvem: leva os dados que já estavam neste navegador
      db = local; cloud.synced = new Map(); cloud.on = true;
      render(); cloud.schedule(); toast('Dados deste computador enviados para a nuvem');
      return;
    }
    cloud.apply(rows); cloud.on = true; setSync('ok'); render();
    cloud.checarCompat();
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
