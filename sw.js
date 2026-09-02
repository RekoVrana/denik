/* Service worker — Deník staveb Rekonstrukce Vrána */
const CACHE = 'vrana-denik-v36';
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

/* ---- UPOZORNĚNÍ ----
   Tohle je jediná část Deníku, která běží i se zavřenou aplikací — proto
   upozornění zobrazuje service worker, ne stránka.

   Most posílá schválně JEN data, žádný hotový text k zobrazení. Kdyby
   posílal hotové upozornění, zobrazil by ho prohlížeč sám po svém a my
   bychom neuhlídali ani slučování, ani kam ťuknutí vede. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (chyba) { d = {}; }
  const o = d.data || d.notification || d;
  const titul = o.titul || o.title || 'Deník staveb';
  const telo = o.telo || o.body || '';
  /* Upozornění se MUSÍ opravdu zobrazit. Když ho service worker spolkne,
     prohlížeč to považuje za zneužití a po pár případech nám posílání
     zakáže úplně — proto se ukáže vždycky, i když je appka zrovna otevřená. */
  e.waitUntil(self.registration.showNotification(titul, {
    body: telo,
    icon: './icon-192.png',
    badge: './icon-192.png',
    lang: 'cs',
    /* Stejná značka = nové upozornění nahradí starší místo toho, aby se
       vršila. Ze šablony vzniká i dvacet úkolů naráz a bez tohohle by
       člověku naráz nacinkalo dvacetkrát — a hned si to vypnul. */
    tag: o.tag || 'denik',
    renotify: true,
    data: { url: o.url || './' }
  }));
});
/* Ťuknutí musí otevřít to, čeho se upozornění týká — ne domovskou stránku.
   A když už Deník někde otevřený je, použije se to okno místo dalšího. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const cil = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(okna => {
    for (const o of okna) {
      if (o.url.startsWith(self.registration.scope) && 'focus' in o) {
        return ('navigate' in o ? o.navigate(cil).catch(() => o) : Promise.resolve(o)).then(x => (x || o).focus());
      }
    }
    return self.clients.openWindow(cil);
  }));
});
