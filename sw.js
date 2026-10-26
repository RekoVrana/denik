/* Service worker — Deník staveb Rekonstrukce Vrána */
const CACHE = 'vrana-denik-v69';
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

/* ---- NAHRÁVÁNÍ NA POZADÍ (Background Fetch, Android Chrome) ----
   Appka na telefonu neumí nic poslat, když je zavřená nebo displej zhasne.
   Na Androidu jde nahrání předat systému: telefon ho dokončí sám a ukazuje
   průběh v oznámeních jako u stahování. Sem přijde výsledek — odpověď
   mostu s fileId se zapíše k položce fronty v IndexedDB (stejná databáze,
   jakou používá appka) a appka ji při příštím otevření jen dopíše do
   záznamu. iPhone tohle neumí, tam zůstává nahrávání při otevřené appce.
   Zadal Marco 23. 10. 2026 („aby se nahrávalo i při zavřené aplikaci"). */
const FRONTA_DB = 'vrana-fronta', FRONTA_STORE = 'soubory';
function frontaDbOtevrit() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(FRONTA_DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(FRONTA_STORE)) r.result.createObjectStore(FRONTA_STORE, { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
function frontaDbUprav(id, fn) {
  return frontaDbOtevrit().then(d => new Promise((ok, no) => {
    const t = d.transaction(FRONTA_STORE, 'readwrite'), st = t.objectStore(FRONTA_STORE);
    const g = st.get(id);
    g.onsuccess = () => { const it = g.result; if (it) { fn(it); st.put(it); } };
    t.oncomplete = () => ok(); t.onerror = () => no(t.error);
  }));
}
/* Značka registrace je „fronta-<id položky>-<klíč>" — z ní se pozná položka. */
function frontaIdZeZnacky(z) { const m = /^fronta-(\d+)-/.exec(z || ''); return m ? Number(m[1]) : null; }

self.addEventListener('backgroundfetchsuccess', e => {
  const reg = e.registration, id = frontaIdZeZnacky(reg.id);
  e.waitUntil((async () => {
    let fileId = '';
    try {
      const zaznamy = await reg.matchAll();
      for (const z of zaznamy) {
        const odp = await z.responseReady;
        const txt = await odp.text();
        try { const j = JSON.parse(txt); if (j && j.fileId) fileId = j.fileId; } catch (e2) {}
      }
    } catch (e2) {}
    if (id != null) {
      /* fileId známe → data fotky už netřeba, appka jen dopíše odkaz do
         záznamu. Bez fileId (most odpověděl stránkou místo dat) se položka
         jen uvolní a appka ji dohledá podle klíče. */
      await frontaDbUprav(id, it => { it.pozadi = false; if (fileId) { it.fileId = fileId; delete it.data; } }).catch(() => {});
    }
    try { await e.updateUI({ title: fileId ? 'Deník: fotka je na Disku ✓' : 'Deník: fotka dorazila, appka ji dopíše' }); } catch (e2) {}
  })());
});
function frontaDbCti(id) {
  return frontaDbOtevrit().then(d => new Promise((ok, no) => {
    const g = d.transaction(FRONTA_STORE, 'readonly').objectStore(FRONTA_STORE).get(id);
    g.onsuccess = () => ok(g.result || null); g.onerror = () => no(g.error);
  }));
}
/* Nahrání „selhalo" nejčastěji jen proto, že Google po uložení přesměroval
   na stránku „nenalezeno" (zhruba každé třetí volání). Soubor na Disku
   přitom už je. Než to vzdáme, zeptáme se mostu podle klíče — tenhle
   dotaz jde po obyčejné cestě, která přesměrování zvládne. Když se najde,
   položka je hotová i bez otevření appky. */
async function frontaDohledatPodleKlice(it) {
  if (!it || !it.most || !it.klic) return '';
  try {
    const odp = await fetch(it.most, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'findByKey', klic: it.klic }) });
    const j = JSON.parse(await odp.text());
    return (j && j.fileId) || '';
  } catch (e) { return ''; }
}
function frontaPozadiSelhalo(e, titul) {
  const id = frontaIdZeZnacky(e.registration.id);
  e.waitUntil((async () => {
    let nalezeno = '';
    if (id != null) {
      const it = await frontaDbCti(id).catch(() => null);
      nalezeno = await frontaDohledatPodleKlice(it);
      await frontaDbUprav(id, x => { x.pozadi = false; if (nalezeno) { x.fileId = nalezeno; delete x.data; } }).catch(() => {});
    }
    try { await e.updateUI({ title: nalezeno ? 'Deník: fotka je na Disku ✓' : titul }); } catch (e2) {}
  })());
}
self.addEventListener('backgroundfetchfail', e => frontaPozadiSelhalo(e, 'Deník: nahrání nedoběhlo, appka to zkusí znovu'));
self.addEventListener('backgroundfetchabort', e => frontaPozadiSelhalo(e, 'Deník: nahrání zrušeno'));
self.addEventListener('backgroundfetchclick', e => {
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(okna => {
    for (const o of okna) if (o.url.startsWith(self.registration.scope) && 'focus' in o) return o.focus();
    return self.clients.openWindow('./');
  }));
});
