/* Service worker — Deník staveb Rekonstrukce Vrána */
const CACHE = 'vrana-denik-v22';
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
    /* Majak verze se NECACHUJE a pri vypadku site se nenahrazuje nicim jinym.
       Driv se pri chybe vracela ulozena index.html (fallback plati pro kazdy
       pozadavek) — stranka ji vzala jako obsah verze.txt, neshodla se
       s VERZE a donekonecna nabizela aktualizaci, ktera nemela co stahnout. */
    if (url.pathname.endsWith('verze.txt')) {
      e.respondWith(fetch(new Request(e.request, { cache: 'reload' })));
      return;
    }
    /* NEJDRIV Z PAMETI, novou verzi stahnout na pozadi.
       Driv se pri KAZDEM otevreni stahoval cely pulmegabajt znovu (a schvalne
       se obchazela i pamet prohlizece) — na jedne carce signalu to znamenalo
       deset az ctyricet vterin bile obrazovky. A iPhone appku na pozadi
       zabiji casto, takze to parta platila nekolikrat denne, prave kdyz si
       chtela jen pichnout prichod.
       O nove verzi se clovek stejne dozvi z majaku verze.txt (lista dole),
       takze se tim nic neztraci — jen se to nemusi cekat. */
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then(ulozene => {
        const zeSite = fetch(new Request(e.request, { cache: 'reload' }))
          .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
          /* Nahradni index.html jen pro NAVIGACI (otevreni stranky) — u skriptu
             a dat by prohlizec dostal HTML misto toho, co cekal. */
          .catch(() => ulozene || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
        return ulozene || zeSite;
      })
    );
  } else if (url.hostname === 'www.gstatic.com' || url.hostname === 'unpkg.com') {
    // firebase SDK + Leaflet: cache-first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return res; })));
  }
});
