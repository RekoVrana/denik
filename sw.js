/* Service worker — Deník staveb Rekonstrukce Vrána */
const CACHE = 'vrana-denik-v5';
const ASSETS = ['./', './index.html', './app.js', './vypocty.js', './navod.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
/* Stranka si muze rict o okamzite prevzeti nove verze (tlacitko Aktualizovat). */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // app shell: network-first (aby update prošel), fallback cache
  /* POZOR: GitHub Pages posila u souboru 'cache-control: max-age=600', takze
     obycejny fetch() dostane z HTTP cache prohlizece az 10 minut starou verzi
     a nova verze na telefon dorazi se zpozdenim. { cache: 'reload' } tuhle
     mezipamet obejde a jde vzdy na server. Offline to nevadi — pri vypadku
     site se stejne sahne do nasi vlastni cache nize. */
  if (url.origin === location.origin) {
    const cerstve = new Request(e.request, { cache: 'reload' });
    e.respondWith(
      fetch(cerstve).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
    );
  } else if (url.hostname === 'www.gstatic.com' || url.hostname === 'unpkg.com') {
    // firebase SDK + Leaflet: cache-first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return res; })));
  }
});
