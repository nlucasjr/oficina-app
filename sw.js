/* Service worker do app Oficina.
   - Arquivos do app: tenta a rede primeiro (assim as atualizações chegam logo)
     e usa a cópia guardada só quando estiver sem sinal.
   - Biblioteca do Supabase (CDN): fica guardada depois do primeiro uso.
   - Supabase (login e dados): nunca passa pelo cache, vai sempre direto para a rede.
   Ao mudar a lista de arquivos ou as versões das bibliotecas, aumente o número em CACHE. */
const CACHE = 'oficina-v5';

const SHELL = [
  './', 'index.html', 'style.css', 'config.js', 'app.js', 'nota.js', 'cloud.js',
  'logo.png', 'logo-branco.png', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js',
];
const CDN_HOSTS = ['cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // um arquivo que falhe não impede os outros de serem guardados
    await Promise.allSettled([
      ...SHELL.map((u) => c.add(u)),
      ...CDN.map((u) => fetch(u, { mode: 'no-cors' }).then((r) => c.put(u, r))),
    ]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req)); return; }
  if (url.origin !== self.location.origin) return; // Supabase e o resto: direto para a rede
  if (url.pathname.endsWith('/version.json')) return; // aviso de versão nova: sempre da rede, sem cache
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    // no-cache: confere com o servidor antes de usar a cópia do navegador
    const res = await fetch(req.url, { cache: 'no-cache', signal: AbortSignal.timeout(6000) });
    if (res.ok) c.put(req.url, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req.url, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const home = await c.match('index.html');
      if (home) return home;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req.url, res.clone());
  return res;
}
