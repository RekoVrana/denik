/* ============================================================
   DENÍK STAVEB — Rekonstrukce Vrána s.r.o.
   Ostrá verze v1 (Etapy 1+2+jádro 3 dle MASTER_PLAN_v4 + dodatky #30–37)
   PWA + Firebase (Auth, Firestore offline) + Google Drive přes Apps Script
   ============================================================ */
/* Cislo verze: zvednout pri KAZDEM nasazeni. Ukazuje se v hlavicce
   a na prihlasovaci obrazovce, aby slo na telefonu poznat, jestli uz
   dorazila nova verze — bez toho se to nedalo zjistit vubec. */
const VERZE = '29. 8. 2026 p';

'use strict';
const CFG = window.VRANA_CONFIG;
const CONFIGURED = CFG.firebase.apiKey !== 'VYPLNIT';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/>/g, '&gt;');
const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const DAYS2 = ['NE', 'PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO'];
function isoToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtISO(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return d + '. ' + m + '. ' + y; }
function fmtISOFull(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return DAYS[dt.getDay()] + ' ' + d + '. ' + m + '. ' + y; }
function dchipOf(iso) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return [DAYS2[dt.getDay()], d + '.' + m + '.']; }
function fmtTs(ts) { if (!ts) return '—'; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
/* POZOR: hodina MUSI mit vedouci nulu. Drive se ukladalo "7:31" a razeni
   podle textu pak davalo "16:00" PRED "7:00" (jednicka je pred sedmickou),
   takze kdo prisel pred 10:00 a odesel po 10:00, zustal navzdy "v praci". */
function nowTime() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
/* Klic pro razeni pichnuti: LOGICKY cas udalosti (datum + cas), ne cas
   zapisu do databaze. Rucne doplneny zaznam (zapomenuty prichod od vedeni)
   ma cas zapisu klidne o den pozdeji nez udalost — razeni podle zapisu pak
   potkalo Odchod pred Prichodem: den vysel na nulu a mobil tvrdil "jsi
   porad v praci". Casy se scitaji jako CISLA, takze stara chyba "16:00"
   pred "7:00" (textove razeni bez vedouci nuly) se vratit nemuze. */
function attKey(a) {
  const t = String((a && a.time) || '0:0').split(':').map(Number);
  const d = new Date((a && a.date) || '1970-01-01');
  return (d.getTime() / 1000) + (t[0] || 0) * 3600 + (t[1] || 0) * 60;
}
/* Cas zapisu — jen ROZHODCI pri shode na stejnou minutu (dve pichnuti ve
   stejne minute). Bez serveroveho casu jde o cerstvy lokalni zapis, ktery
   jeste neprosel serverem — tedy nejnovejsi. */
function attZapsano(a) {
  if (a && a.createdAt && a.createdAt.seconds) return a.createdAt.seconds + (a.createdAt.nanoseconds || 0) / 1e9;
  return Number.MAX_SAFE_INTEGER;
}
function attCmp(a, b) { return (attKey(a) - attKey(b)) || (attZapsano(a) - attZapsano(b)); }
function daysBetween(isoA, isoB) { return Math.round((new Date(isoB) - new Date(isoA)) / 86400000); }
function shiftISO(iso, days) { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function kc(n) { return (Math.round(n) || 0).toLocaleString('cs-CZ'); }
function fmtH(h) { const m = Math.round((h || 0) * 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' h'; }
function uid8() { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 22; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
function ini(u) { return ((u.jmeno || '?')[0] + ((u.prijmeni || '')[0] || '')).toUpperCase(); }
function fullName(u) { return (u.jmeno || '') + ' ' + (u.prijmeni || ''); }
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/* ---------- aktualizace aplikace ----------
   Nainstalovana PWA si drzi starou verzi, dokud service worker nedostane
   novou. Uzivatel by jinak musel mazat ikonu z plochy a pridavat znovu.
   Proto: appka si novou verzi hleda sama (pri otevreni, pri navratu z pozadi
   a jednou za pul hodiny) a nabidne ji pruhem dole. Plus tlacitko ⟳ v hlavicce. */
function updBar() {
  const el = document.getElementById('updbar');
  if (!el) return;
  el.innerHTML = S.updateReady ? `<div class="updbar">
    <span style="font-size:20px">🔄</span>
    <div style="flex:1"><b>Je hotová nová verze</b><small>Aktualizace trvá pár vteřin.</small></div>
    <button class="btn amber sm" onclick="aktualizovatApp()">Aktualizovat</button>
    <button class="btn dark sm" onclick="S.updateReady=false;updBar()">Později</button>
  </div>` : '';
}
async function aktualizovatApp() {
  if (S.updating) return;
  S.updating = true; render();
  try {
    /* Service worker rovnou odhlasit — po nacteni se zaregistruje znovu
       a cerstvy. "Jemna" aktualizace pres reg.update() nechavala na Macu
       bezet stary a aplikace zustavala zamrzla na stare verzi. */
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
      for (const r of regs) await r.unregister().catch(() => {});
    }
    if (window.caches) {
      const klice = await caches.keys();
      await Promise.all(klice.map(k => caches.delete(k)));
    }
  } catch (e) { /* i kdyz se neco nepovede, stejne zkusime nacist znovu */ }
  // cache-busting parametr — iOS umi byt hodne tvrdohlave
  const u = new URL(location.href);
  u.searchParams.set('v', String(Date.now()).slice(-8));
  location.replace(u.toString());
}
/* Majak verze: malicky soubor verze.txt se meni s kazdym nasazenim.
   Hlidani pres service worker totiz zabere JEN kdyz se zmeni sw.js —
   a ten se meni vzacne. Zmena samotne aplikace tak drive zadne
   "je nova verze" nevyvolala a telefony zustavaly na stare. */
async function zkontrolujVerzi() {
  if (!navigator.onLine) return;               // offline srovnani nema smysl
  try {
    const r = await fetch('verze.txt?ts=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = (await r.text()).trim();
    if (v && v !== VERZE) { S.updateReady = true; updBar(); render(); }
  } catch (e) { /* bez site apod. — zkusi se to znovu za chvili */ }
}

function hlidatAktualizace(reg) {
  S.swReg = reg;
  if (reg.waiting && navigator.serviceWorker.controller) { S.updateReady = true; updBar(); }
  reg.addEventListener('updatefound', () => {
    const novy = reg.installing;
    if (!novy) return;
    novy.addEventListener('statechange', () => {
      if (novy.state === 'installed' && navigator.serviceWorker.controller) { S.updateReady = true; updBar(); }
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { reg.update().catch(() => {}); zkontrolujVerzi(); }
  });
  setInterval(() => { reg.update().catch(() => {}); zkontrolujVerzi(); }, 10 * 60 * 1000);
  zkontrolujVerzi();
}

/* ---------- instalace na plochu ---------- */
const UA = navigator.userAgent || '';
const JE_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const JE_IOS_CHROME = JE_IOS && /CriOS|FxiOS|EdgiOS/.test(UA);
const JE_ANDROID = /Android/.test(UA);
function jeNaPlose() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
/* Android/desktop Chrome nabidne skutecnou instalaci pres tuhle udalost.
   iOS ji neumi — tam musime ukazat postup rucne. */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; render(); });
window.addEventListener('appinstalled', () => { S.installPrompt = null; toast('Nainstalováno na plochu ✓'); render(); });

async function pridatNaPlochu() {
  if (S.installPrompt) {                       // Android / desktop Chrome
    S.installPrompt.prompt();
    try { await S.installPrompt.userChoice; } catch (e) {}
    S.installPrompt = null; render(); return;
  }
  if (JE_IOS_CHROME) {
    modal(`<h3>📲 Přidat Deník na plochu</h3>
      <div class="howto">
        <div class="note" style="margin-top:0">V Chromu na iPhonu to spolehlivě nejde. Otevři si Deník
        v <b>Safari</b> — tam to je na dvě ťuknutí a aplikace pak funguje líp (celá obrazovka, vlastní povolení polohy).</div>
        <ol>
          <li>Zkopíruj odkaz tlačítkem níž</li>
          <li>Otevři <b>Safari</b> a vlož ho do adresního řádku</li>
          <li>Ťukni na <span class="k">Sdílet ⬆️</span> dole uprostřed</li>
          <li>Sjeď dolů na <span class="k">Přidat na plochu</span> → <span class="k">Přidat</span></li>
        </ol>
      </div>
      <div class="aprv"><button class="btn amber" onclick="kopirovatOdkaz()">📋 Zkopírovat odkaz</button>
      <button class="btn ghost" onclick="closeModal()">Zavřít</button></div>`);
    return;
  }
  if (JE_IOS) {
    modal(`<h3>📲 Přidat Deník na plochu</h3>
      <div class="howto">Bude z toho ikona jako u normální aplikace — otevře se na celou obrazovku.
        <ol>
          <li>Ťukni na <span class="k">Sdílet ⬆️</span> dole uprostřed obrazovky</li>
          <li>Sjeď v nabídce dolů na <span class="k">Přidat na plochu</span></li>
          <li>Vpravo nahoře <span class="k">Přidat</span></li>
        </ol>
      </div>
      <div class="aprv"><button class="btn amber" onclick="closeModal()">Rozumím</button></div>`);
    return;
  }
  modal(`<h3>📲 Přidat Deník na plochu</h3>
    <div class="howto">
      <ol>
        <li>Otevři nabídku prohlížeče — <span class="k">⋮</span> ${JE_ANDROID ? 'vpravo nahoře' : 'nebo ikona instalace v adresním řádku'}</li>
        <li>Vyber <span class="k">${JE_ANDROID ? 'Přidat na plochu' : 'Nainstalovat aplikaci'}</span></li>
        <li>Potvrď <span class="k">Přidat</span></li>
      </ol>
    </div>
    <div class="aprv"><button class="btn amber" onclick="closeModal()">Rozumím</button></div>`);
}
function kopirovatOdkaz() {
  const url = location.origin + location.pathname;
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Odkaz zkopírován ✓'), () => toast(url));
  else toast(url);
}

/* ---------- firebase init ---------- */
let db = null, auth = null;
if (CONFIGURED) {
  firebase.initializeApp(CFG.firebase);
  db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  auth = firebase.auth();
}
const FV = () => firebase.firestore.FieldValue.serverTimestamp();

/* ---------- state ---------- */
const S = {
  portalToken: new URLSearchParams(location.search).get('p'),
  authUser: null, meAuth: null, me: null, roster: [], appCfg: null,
  users: [], projects: [], entries: [], tasks: [], attendance: [], viceprace: [], sazby: {}, zadosti: [],
  portal: null, portalFeed: [], portalVp: [], portalDocs: [],
  /* admin-only tajnosti (S2/S4/S5): tokeny portalu, kontakty lidi a interni
     poznamky bydli v samostatnych kolekcich, ktere cte jen vedeni */
  portaly: {}, kontakty: {}, entriesInterni: {},
  view: 'nastenka', nastenkaTab: 'prehled', tickety: [], adminFilter: null, detail: null,
  projDetailId: null, projDetailTab: 'info', newUserType: null, editUserId: null, newUserActive: null,
  ukolyView: 'seznam', orgFilter: 'vse', taskFormOpen: false, attFormOpen: false, vpFormOpen: false,
  hlaseni: [], subProject: null, subPocet: 1, subOdchodOpen: false, subZaznam: '',
  podkladyStav: null, podkladyCesta: [], poznamky: [], poznamkaEdit: null, entryEdit: null,
  taskFoto: [],
  klice: [],
  /* galerie fotek (viz sekce GALERIE FOTEK): filtry a kolik dlazdic uz kreslime */
  fgFrom: '', fgTo: '', fgProj: null, fgAutor: '', fgZobrazeno: 60,
  repWorkers: [], repProjects: [], repLoaded: false, repFrom: isoToday().slice(0, 8) + '01', repTo: isoToday(),
  workerProject: null, draftPhotos: [], draftAtts: [], uploading: 0, signFor: null, tplOpen: false,
  loginMode: 'teren', loginWorker: null, loginHledani: null,
  online: navigator.onLine, unsub: [],
  searchQ: '', geoHits: [], geoLabel: null, loginMsg: null, myPos: null, posAsked: false, checking: null, installPrompt: null, swReg: null, updateReady: false, updating: false,
  frontaPocet: 0
};
window.addEventListener('online', () => { S.online = true; render(); });
window.addEventListener('offline', () => { S.online = false; render(); });

/* ---------- pamet rozepsanych formularu ----------
   render() prekresluje celou obrazovku a deje se to pri KAZDE zmene v databazi
   — staci, aby nekdo v terenu pichnul prichod. Bez tohohle by kazdemu, kdo
   prave pise, zmizel rozepsany text: zapis do deniku, zneni pro investora,
   novy ukol. Proto se pred prekreslenim obsah policek schova a po nem vrati,
   vcetne kurzoru. Po uspesnem ulozeni se pamet toho formulare zahodi
   (zapomen...), aby se ulozeny text nevracel do prazdneho formulare. */
const FORMMEM = {};
function pamatovatelne(el) {
  return el && el.id && el.type !== 'file' && el.type !== 'button' && el.type !== 'submit';
}
function schovatFormulare() {
  const root = $('#root'); if (!root) return;
  root.querySelectorAll('input[id],textarea[id],select[id]').forEach(el => {
    if (!pamatovatelne(el)) return;
    FORMMEM[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  });
  const a = document.activeElement;
  FORMMEM.__fokus = (a && a.id && root.contains(a) && pamatovatelne(a)) ? a.id : null;
  FORMMEM.__kurzor = null;
  if (a && FORMMEM.__fokus) { try { FORMMEM.__kurzor = [a.selectionStart, a.selectionEnd]; } catch (e) {} }
}
function vratitFormulare() {
  const root = $('#root'); if (!root) return;
  root.querySelectorAll('input[id],textarea[id],select[id]').forEach(el => {
    if (!pamatovatelne(el) || !(el.id in FORMMEM)) return;
    const v = FORMMEM[el.id];
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v;
    else if (el.value !== v) el.value = v;
  });
  const f = FORMMEM.__fokus;
  if (!f) return;
  const el = document.getElementById(f);
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
    if (FORMMEM.__kurzor && el.setSelectionRange) el.setSelectionRange(FORMMEM.__kurzor[0], FORMMEM.__kurzor[1]);
  } catch (e) {}
}
/* Po ulozeni musi zmizet i to, co je jeste v policku na obrazovce — jinak by
   ho hned pri dalsim prekresleni schovatFormulare() zase nacetlo zpatky
   a ulozeny text by se vratil do prazdneho formulare. */
function zapomen(...ids) {
  ids.forEach(i => {
    delete FORMMEM[i];
    const el = document.getElementById(i);
    if (!el || !pamatovatelne(el)) return;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = el.defaultChecked;
    else if (el.tagName !== 'SELECT') el.value = el.defaultValue || '';
  });
}
function zapomenVse() { Object.keys(FORMMEM).forEach(k => { delete FORMMEM[k]; }); }

/* ---------- data listeners ---------- */
function clearSubs() { S.unsub.forEach(u => { try { u(); } catch (e) {} }); S.unsub = []; }
function listen(col, target, opts) {
  let q = db.collection(col);
  if (opts && opts.where) opts.where.forEach(w => q = q.where(...w));
  S.unsub.push(q.onSnapshot(snap => {
    const zive = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (opts && opts.okno) {
      /* Kolekce s 30dennim oknem (viz OKNO_DNU): snapshot je pravda jen
         UVNITR okna. Kompletni nahrada pole by zahodila rucne dotazene
         starsi zaznamy (report, tisk deniku) — proto se sleva, viz slozOkno(). */
      S.zivyOkno[target] = zive;
      slozOkno(target);
    } else {
      S[target] = zive;
      if (opts && opts.sort) S[target].sort(opts.sort);
    }
    render();
  }, err => console.warn('listener ' + col, err)));
}
/* Cteni, ktere jednou zopakuje, kdyz ho databaze odmitne proto, ze jeste
   nezna prihlaseneho uzivatele. Jina odmitnuti propousti dal — ta znamenaji
   skutecne chybejici opravneni a nemaji se zamlcovat. */
async function ctiSPokusem(cti, prodleva) {
  try { return await cti(); }
  catch (e) {
    if (e && e.code === 'permission-denied') {
      await new Promise(r => setTimeout(r, prodleva || 700));
      return await cti();
    }
    throw e;
  }
}
const taskSort = (a, b) => (a.term || '').localeCompare(b.term || '');
function listenMojeUkoly() {
  /* POZOR na zavod: profil (S.me) se nacita az PO spusteni posluchacu,
     takze tady jeste nemusi byt. users_auth (S.meAuth) uz nacteny je
     a userDocId nese — jinak ukoly mlcky zustaly prazdne do restartu. */
  const mid = (S.meAuth && S.meAuth.userDocId) || (S.me && S.me.id) || '__nikdo__';
  const casti = { prideleno: [], zadal: [] };
  const slozit = () => {
    const mapa = new Map();
    casti.prideleno.concat(casti.zadal).forEach(t => mapa.set(t.id, t));
    S.tasks = [...mapa.values()].sort(taskSort);
    render();
  };
  [['respId', 'prideleno'], ['zadalId', 'zadal']].forEach(([pole, kam]) => {
    S.unsub.push(db.collection('tasks').where(pole, '==', mid).onSnapshot(snap => {
      casti[kam] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      slozit();
    }, err => console.warn('ukoly/' + pole, err)));
  });
}

/* ---------- kolik dat drzime naživo ----------
   Firestore uctuje kazdy precteny zaznam. Kdyz aplikace pri kazdem otevreni
   stahovala celou historii, rostla cena s kazdym dnem provozu — za rok by
   jedno otevreni stalo pres 4 000 cteni a bezplatny strop 50 000/den by
   doslo po jedenacti otevrenich. Proto zive sledujeme jen posledni mesic.
   Starsi data se dotahuji, az kdyz si o ne nekdo rekne (report za minuly
   mesic). POZOR: bez toho dotahovani by report za starsi obdobi tise
   ukazal nuly — a to je podklad pro vyplaty. */
const OKNO_DNU = 30;
function oknoOd() { return shiftISO(isoToday(), -OKNO_DNU); }

/* ---- slevani ziveho okna s dotazenym archivem ----
   Starsi zaznamy dotazene na pozadani (report, tisk deniku) drive zily
   primo v S.attendance / S.entries — jenze kazdy dalsi snapshot (kdokoli
   pichl prichod, vedeni cokoli schvalilo) pole kompletne nahradil a dotazene
   zaznamy beze stopy zahodil. A protoze si S.dotazeno pamatuje "uz stazeno",
   podruhe se nedotahly → report za minuly mesic ukazal nuly (podklad vyplat).
   Proto dotazene zaznamy ziji ve vlastnim archivu a po kazdem snapshotu se
   k oknu prikladaji znovu. Snapshot zustava pravdou UVNITR okna (smazane
   zmizi, upravene se obnovi), archiv doplnuje jen zaznamy PRED oknem. */
const OKNO_SORT = {
  entries: (a, b) => (b.date || '').localeCompare(a.date || '') || (((b.createdAt && b.createdAt.seconds) || 0) - (((a.createdAt && a.createdAt.seconds) || 0))),
  attendance: (a, b) => attCmp(b, a)
};
S.archiv = S.archiv || { attendance: new Map(), entries: new Map() };
S.zivyOkno = S.zivyOkno || {};        // posledni zivy snapshot kazde okenni kolekce
S.pendingZive = S.pendingZive || [];  // zapisy cekajici na schvaleni, bez ohledu na okno (viz startData)
function slozOkno(target) {
  const okno = S.zivyOkno[target] || [];
  const mam = new Set(okno.map(d => d.id));
  const vysledek = okno.slice();
  const od = oknoOd();
  (S.archiv[target] || new Map()).forEach((d, id) => {
    /* jen zaznamy pred oknem — uvnitr okna je pravdou snapshot,
       smazane se nesmi z archivu krisit */
    if (!mam.has(id) && (d.date || '') < od) { vysledek.push(d); mam.add(id); }
  });
  if (target === 'entries') S.pendingZive.forEach(d => {
    if (!mam.has(d.id)) { vysledek.push(d); mam.add(d.id); }
  });
  S[target] = vysledek;
  if (OKNO_SORT[target]) S[target].sort(OKNO_SORT[target]);
}
/* Dotazene starsi zaznamy jdou do archivu a hned se slejou do S[target].
   Kdyz zivy posluchac jeste nevystrelil (start bez signalu), primichaji se
   postaru primo — archiv je srovna pri prvnim snapshotu. */
function archivujDotazene(target, docs) {
  docs.forEach(d => S.archiv[target].set(d.id, d));
  if (S.zivyOkno[target]) slozOkno(target);
  else {
    const mam = new Set(S[target].map(x => x.id));
    docs.forEach(d => { if (!mam.has(d.id)) S[target].push(d); });
    if (OKNO_SORT[target]) S[target].sort(OKNO_SORT[target]);
  }
}

/* Uz dotazene starsi useky, at se totez nestahuje dvakrat.
   (Dotazene zaznamy drzi archiv vyse, takze "uz stazeno" plati trvale —
   snapshot je uz nezahazuje.) */
S.dotazeno = S.dotazeno || [];
async function dotahniDochazku(from, to) {
  if (!from || !to || from > to) return;
  if (from >= oknoOd()) return;                       // uz to mame naživo
  const klic = from + '..' + to;
  if (S.dotazeno.includes(klic)) return;
  S.dotahuji = true; render();
  try {
    const snap = await db.collection('attendance')
      .where('date', '>=', from).where('date', '<=', to).get();
    archivujDotazene('attendance', snap.docs.map(d => ({ id: d.id, ...d.data() })));
    S.dotazeno.push(klic);
  } catch (e) {
    toast('Starší docházku se nepodařilo načíst: ' + (e.code || e.message));
  }
  S.dotahuji = false; render();
}

/* Fotky u ukolu jsou docasne — po vyrizeni nemaji hodnotu a jen by
   plnily databazi. Den po odskrtnuti (dokud jde vraceni, mazat nesmime)
   je vedeni pri startu potichu uklidi. */
async function uklidFotekUkolu() {
  try {
    const snap = await db.collection('tasks').where('stav', '==', 'hotovo').get();
    const dnes = isoToday();
    let uklizeno = 0;
    for (const d of snap.docs) {
      const t = d.data();
      if (!(t.photos || []).length) continue;
      /* Mazat jen s prokazatelne prosslou lhutou: hotovoDne existuje
         a je starsi nez dnes. Ukol bez hotovoDne se NEuklizi — radsi
         fotka navic v databazi nez nevratne smazana. */
      if (!t.hotovoDne || t.hotovoDne >= dnes) continue;    // jeste jde vratit
      for (const f of t.photos) await db.collection('fotonahledy').doc(f.id).delete().catch(() => {});
      await db.collection('tasks').doc(d.id).update({ photos: [] }).catch(() => {});
      if (++uklizeno >= 20) break;                           // po davkach, at start nezdrzi
    }
  } catch (e) { console.warn('uklid fotek ukolu', e); }
}

/* ============ TICKETY ============
   Kdokoli z aplikace nahlasi, ze neco nefunguje, nebo navrhne zlepseni.
   Vedeni tickety vidi vsechny, vyrizuje je (s volitelnou odpovedi,
   kterou autor uvidi) a maze. Zadal Marco 28. 8. 2026. */
function ticketDialog() {
  const moje = S.tickety.filter(t => S.authUser && t.authUid === S.authUser.uid);
  modal(`<h3>💬 Nahlásit / navrhnout</h3>
    <label>O co jde?</label>
    <select id="tic-typ">
      <option value="chyba">🐞 Něco nefunguje</option>
      <option value="napad">💡 Nápad na zlepšení / novou funkci</option>
    </select>
    <label>Popiš to *</label>
    <textarea id="tic-text" placeholder="Co se stalo, kde v aplikaci, co jsi čekal…"></textarea>
    <div class="aprv"><button class="btn amber" onclick="odeslatTicket()">📤 Odeslat</button>
      <button class="btn ghost" onclick="closeModal()">Zavřít</button></div>
    ${moje.length ? `<h4 style="margin-top:14px">Moje hlášení</h4>
      ${moje.map(t => `<div class="urow" style="align-items:flex-start"><span>${t.typ === 'chyba' ? '🐞' : '💡'}</span>
        <div><b>${esc((t.text || '').slice(0, 70))}${(t.text || '').length > 70 ? '…' : ''}</b><br>
          <span class="muted">${fmtISO(t.date)} · </span>${t.stav === 'vyrizeno' ? '<span class="badge b-ok">vyřízeno</span>' : '<span class="badge b-wait">čeká</span>'}
          ${t.odpoved ? `<br><span class="muted">Odpověď: ${esc(t.odpoved)}</span>` : ''}</div></div>`).join('')}` : ''}`);
}
async function odeslatTicket() {
  const text = $('#tic-text').value.trim();
  if (!text) { toast('Popiš, o co jde'); return; }
  try {
    await db.collection('tickety').add({
      typ: $('#tic-typ').value, text, autorId: S.me ? S.me.id : '', autorJmeno: fullName(S.me || {}),
      authUid: S.authUser.uid, stav: 'novy', date: isoToday(), time: nowTime(), createdAt: FV()
    });
    closeModal(); toast('Odesláno — díky! ✓');
  } catch (e) { toast('Nepovedlo se odeslat: ' + (e.code || e.message)); }
}
async function ticketVyridit(id) {
  const odpoved = await zeptejSe('Vyřídit ticket', 'Odpověď pro autora je nepovinná — uvidí ji u svého hlášení.', '', true);
  if (odpoved === null) return;
  await db.collection('tickety').doc(id).update({ stav: 'vyrizeno', odpoved: odpoved.trim() })
    .then(() => toast('Vyřízeno ✓')).catch(e => toast('Nejde: ' + (e.code || e.message)));
}
/* Vyrizeno omylem, nebo se vada vratila — ticket musi jit otevrit zpatky.
   Odpoved se maze, patrila k minulemu kolu; jinak by autor videl "ceka"
   a pod tim odpoved, ktera uz neplati. */
async function ticketZnovuOtevrit(id) {
  if (!await potvrd('Otevřít ticket znovu?\n\nVrátí se mezi čekající a dosavadní odpověď se smaže.', 'Otevřít znovu')) return;
  await db.collection('tickety').doc(id).update({ stav: 'novy', odpoved: firebase.firestore.FieldValue.delete() })
    .then(() => toast('Ticket je zase mezi čekajícími ✓')).catch(e => toast('Nejde: ' + (e.code || e.message)));
}
async function ticketSmazat(id) {
  if (!await potvrd('Smazat ticket?')) return;
  await db.collection('tickety').doc(id).delete().catch(e => toast('Nejde: ' + (e.code || e.message)));
}
function nastenkaTickety() {
  /* Vyrizene se sbaluji — jinak seznam jen roste a to, co doopravdy ceka,
     se v nem ztrati. Radek je pro oba stavy stejny, lisi se jen tlacitko. */
  const cekaji = S.tickety.filter(t => t.stav !== 'vyrizeno');
  const hotove = S.tickety.filter(t => t.stav === 'vyrizeno');
  const radek = t => `<div class="urow" style="align-items:flex-start"><span style="font-size:17px">${t.typ === 'chyba' ? '🐞' : '💡'}</span>
      <div><b>${esc(t.text || '')}</b><br>
        <span class="muted">${esc(t.autorJmeno || '')} · ${fmtISO(t.date)} ${t.time || ''}</span>
        ${t.odpoved ? `<br><span class="muted">Odpověď: ${esc(t.odpoved)}</span>` : ''}</div>
      <span style="margin-left:auto;white-space:nowrap">${t.stav === 'vyrizeno'
        ? `<span class="badge b-ok">vyřízeno</span> <button class="btn ghost sm" onclick="ticketZnovuOtevrit('${t.id}')">↩ Otevřít znovu</button>`
        : `<button class="btn ok sm" onclick="ticketVyridit('${t.id}')">✓ Vyřídit</button>`}
        <span class="lnk" style="font-size:12px;margin-left:8px" onclick="ticketSmazat('${t.id}')">✕</span></span>
    </div>`;
  return `<main><div class="card">
    <h3>💬 Tickety od lidí <span class="muted" style="font-weight:400">— chyby a nápady</span></h3>
    ${cekaji.map(radek).join('') || (hotove.length
      ? '<div class="muted">Nic nečeká — všechno je vyřízené.</div>'
      : '<div class="empty">Zatím žádné tickety. Lidi je posílají tlačítkem 💬 v hlavičce.</div>')}
    ${hotove.length ? `<div class="aprv" style="margin-top:10px">
      <button class="btn ghost sm" onclick="S.ticketyHotoveOpen=!S.ticketyHotoveOpen;render()">✓ Vyřízené (${hotove.length}) ${S.ticketyHotoveOpen ? '▲' : '▼'}</button></div>
      ${S.ticketyHotoveOpen ? hotove.map(radek).join('') : ''}` : ''}
  </div></main>`;
}

function startData() {
  const role = S.meAuth.role; // 'admin' | 'worker' | 'sub'
  /* Cerstve prihlaseni = cerstve slozky slevani; jinak by po odhlaseni
     a prihlaseni jineho uctu zustaly slozene zaznamy z minule seance. */
  S.archiv = { attendance: new Map(), entries: new Map() };
  S.zivyOkno = {}; S.pendingZive = [];
  /* admin-only tajnosti zacinaji prazdne — po odhlaseni admina nesmi
     zustat v pameti pro dalsi prihlaseni jine role */
  S.portaly = {}; S.kontakty = {}; S.entriesInterni = {};
  S.dotazeno = []; S.dotazenoZapisy = []; S.dotazenoTisk = []; S.zapisyOd = null;
  listen('projects', 'projects', { sort: (a, b) => (b.active - a.active) || String(a.cn || a.name).localeCompare(String(b.cn || b.name), 'cs') });
  /* razeni okennich kolekci drzi OKNO_SORT, at je stejne pro snapshot i archiv */
  listen('entries', 'entries', { where: [['date', '>=', oknoOd()]], okno: true });
  /* Ukoly: vedeni vidi vsechny, ostatni jen sve. Pravidla databaze dotaz
     bud cele povoli, nebo cely odmitnou — filtrovat za nas neumi. Proto se
     pracovnik pta dvema dotazy (co mam prideleno / co jsem zadal) a vysledky
     se slozi dohromady. */
  /* POZOR: tohle if/else je jeden celek pro UKOLY — nevkladat mezi ne nic.
     Presne tim tu vznikla chyba: vlozeny blok hlaseni si prisvojil "else"
     a subdodavatelum se ukoly prestaly nacitat uplne. */
  if (role === 'admin') listen('tasks', 'tasks', { sort: taskSort });
  else listenMojeUkoly();
  /* Hlaseni subdodavatelu: vedeni vidi vse (v okne), sub jen svoje. */
  const hlasSort = (a, b) => ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || ''));
  if (role === 'admin') listen('hlaseni', 'hlaseni', { where: [['date', '>=', oknoOd()]], sort: hlasSort });
  else if (role === 'sub') listen('hlaseni', 'hlaseni', { where: [['authUid', '==', S.authUser.uid]], sort: hlasSort });
  listen('klice', 'klice', {});
  /* Poznamky: vedeni vidi vsechny, ostatni jen ty sve. Filtrovat musi
     uz dotaz — pravidla umi cely dotaz jen povolit, nebo odmitnout.
     Kazdy klic (vsichni / parta / ja) ma vlastni posluchac a vysledky
     se skladaji dohromady, stejne jako u ukolu. */
  const pzSort = (a, b) => (a.nadpis || '').localeCompare(b.nadpis || '', 'cs');
  if (role === 'admin') { listen('poznamky', 'poznamky', { sort: pzSort }); prevedStarePoznamky(); uklidRosterAdminy(); prevedTajnosti(); prevedKontaktyInvestoru(); uklidTypySubu(); prevedSazbyNaHistorii(); setTimeout(dorovnejPortaly, 6000); }
  else {
    const pzMid = (S.meAuth && S.meAuth.userDocId) || '__nikdo__';
    listenPoznamky(role === 'sub' ? ['vsichni', pzMid] : ['vsichni', 'parta', pzMid]);
  }
  /* tajny klic k mostu — bez nej se soubory z Drive oteviraji postaru
     (pres Google), s nim je vydava most primo aplikaci */
  db.collection('config').doc('tajne').get().then(d => { S.tajne = d.exists ? d.data() : null; }).catch(() => {});
  /* Tickety: kazdy vidi sve, vedeni vsechny. */
  const tsort = (a, b) => ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || ''));
  if (role === 'admin') listen('tickety', 'tickety', { sort: tsort });
  else listen('tickety', 'tickety', { where: [['authUid', '==', S.authUser.uid]], sort: tsort });
  listen('users', 'users', { sort: (a, b) => (a.prijmeni || '').localeCompare(b.prijmeni || '', 'cs') });
  if (role === 'admin') {
    listen('attendance', 'attendance', { where: [['date', '>=', oknoOd()]], okno: true });
    /* Pending zapisy CELE, bez okna: zapis cekajici na schvaleni dele nez
       mesic by jinak vypadl ze schvalovani i z citace na nastence a nikdo
       by nevedel, ze neco visi. Pendingu je vzdy hrstka, cteni skoro nic
       nestoji. Duplicity s oknem resi slozOkno() podle id. */
    S.unsub.push(db.collection('entries').where('status', '==', 'pending').onSnapshot(s => {
      S.pendingZive = s.docs.map(d => ({ id: d.id, ...d.data() }));
      slozOkno('entries');
      render();
    }, err => console.warn('pending entries', err)));
    setTimeout(uklidFotekUkolu, 8000);
    listen('viceprace', 'viceprace', {});
    listen('zadosti', 'zadosti', { sort: (a, b) => (b.date || '').localeCompare(a.date || '') });
    S.unsub.push(db.collection('sazby').onSnapshot(s => { S.sazby = {}; s.docs.forEach(d => S.sazby[d.id] = d.data()); render(); }, () => {}));
    /* admin-only tajnosti (S2/S4/S5): presunuta pole z /projects, /users
       a /entries — ctou se jen tady, v admin vetvi */
    S.unsub.push(db.collection('portaly').onSnapshot(s => { S.portaly = {}; s.docs.forEach(d => S.portaly[d.id] = d.data()); render(); }, () => {}));
    S.unsub.push(db.collection('kontakty').onSnapshot(s => { S.kontakty = {}; s.docs.forEach(d => S.kontakty[d.id] = d.data()); render(); }, () => {}));
    S.unsub.push(db.collection('entries_interni').onSnapshot(s => { S.entriesInterni = {}; s.docs.forEach(d => S.entriesInterni[d.id] = d.data()); render(); }, () => {}));
    // akce investorů ze všech portálů
    S.unsub.push(db.collectionGroup('actions').where('handled', '==', false).onSnapshot(s => {
      s.docs.forEach(d => handlePortalAction(d));
    }, err => console.warn('actions', err)));
  } else {
    listen('attendance', 'attendance', { where: [['authUid', '==', S.authUser.uid]], sort: (a, b) => attCmp(b, a) });
    listen('zadosti', 'zadosti', { where: [['authUid', '==', S.authUser.uid]], sort: (a, b) => (b.date || '').localeCompare(a.date || '') });
  }
}
function startPortal() {
  const t = S.portalToken;
  S.unsub.push(db.collection('portals').doc(t).onSnapshot(d => { S.portal = d.exists ? { id: d.id, ...d.data() } : false; render(); }, () => { S.portal = false; render(); }));
  S.unsub.push(db.collection('portals').doc(t).collection('feed').onSnapshot(s => { S.portalFeed = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || '')); render(); }, () => {}));
  S.unsub.push(db.collection('portals').doc(t).collection('vp').onSnapshot(s => { S.portalVp = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {}));
  S.unsub.push(db.collection('portals').doc(t).collection('docs').onSnapshot(s => { S.portalDocs = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {}));
}

/* ---------- lookups ---------- */
const proj = id => S.projects.find(p => p.id === id);
/* ---- admin-only tajnosti (S2/S4/S5, audit 28. 8.) ----
   Firestore vraci vzdy CELY dokument — citliva pole nejde skryt pravidlem.
   Proto token portalu, kontakty lidi a interni poznamky bydli ve vlastnich
   admin-only kolekcich (/portaly, /kontakty, /entries_interni) a saha se
   k nim jen pres tyto pomocniky. Ne-adminum vraceji prazdno. */
function tokenPortalu(pid) { return ((S.portaly || {})[pid] || {}).token || null; }
async function tokenPortaluAsync(pid) {
  /* Zavod snapshotu: akce muze prijit driv, nez se kolekce /portaly
     nacte — pak se token docte primo z databaze (jen admin ho smi). */
  const t = tokenPortalu(pid); if (t) return t;
  const d = await db.collection('portaly').doc(pid).get().catch(() => null);
  return d && d.exists ? (d.data().token || null) : null;
}
function interniPozn(eid) { return ((S.entriesInterni || {})[eid] || {}).text || ''; }
function kontaktOsoby(udi) { return (S.kontakty || {})[udi] || {}; }
/* Kontakt na INVESTORA (S4b). Byval ulozeny primo na stavbe — jenze /projects
   cte kazdy prihlaseny vcetne externiho subdodavatele a databaze vydava vzdy
   CELY dokument, takze spolu s nazvem stavby chodil subovi do telefonu i mail
   a telefon klienta. Ted bydli v admin-only /kontakty pod klicem
   „projekt_<id>" — u stavby uz ta pole vubec nejsou. */
function kontaktKlicStavby(pid) { return 'projekt_' + pid; }
function kontaktStavby(pid) { return (S.kontakty || {})[kontaktKlicStavby(pid)] || {}; }
/* Ukol si drzi ID osoby (respId). Drive se ukladalo jen jmeno jako text, takze
   po oprave preklepu v prijmeni ukol osirel a cloveku zmizel z mobilu.
   Jmeno se dal uklada taky — kvuli starym ukolum a kvuli exportu. */
function respName(t) {
  const u = t && t.respId ? S.users.find(x => x.id === t.respId) : null;
  return u ? fullName(u) : ((t && t.resp) || '');
}
/* Naléhavost úkolu se pozná barevným prouzkem, ne cudnou poznamkou —
   na stavbe se na telefon kouka vterinu, ne minutu. */
/* Odpovedi u ukolu: kratka konverzace primo pod ukolem ("hotovo, ale
   chybelo lepidlo"). Pridat ji smi ten, kdo ukol vidi — prijemce,
   zadavatel, vedeni. */
async function ukolOdpovedet(id) {
  const inp = $('#up-' + id); if (!inp) return;
  const text = inp.value.trim(); if (!text) { toast('Napiš odpověď'); return; }
  try {
    await db.collection('tasks').doc(id).update({
      odpovedi: firebase.firestore.FieldValue.arrayUnion({
        autorId: S.me ? S.me.id : '', autorJmeno: fullName(S.me || {}),
        text, date: isoToday(), time: nowTime()
      })
    });
    inp.value = ''; toast('Odpověď přidána ✓');
  } catch (e) { toast('Nejde přidat: ' + (e.code || e.message)); }
}
function ukolDetailHtml(t) {
  return `
    ${t.popis ? `<div class="muted" style="font-size:13.5px;margin-top:4px;white-space:pre-line">${esc(t.popis)}</div>` : ''}
    ${(t.odpovedi || []).length ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
      ${t.odpovedi.map(o => `<div style="background:#f4f6f9;border-radius:8px;padding:6px 10px;font-size:13px">
        <b>${esc(o.autorJmeno || '')}</b> <span class="muted">${fmtISO(o.date)} ${o.time || ''}</span><br>
        <span style="white-space:pre-line">${esc(o.text || '')}</span></div>`).join('')}
    </div>` : ''}
    <div style="display:flex;gap:7px;margin-top:8px">
      <input type="text" id="up-${t.id}" placeholder="Napsat odpověď…" style="flex:1;min-width:0"
             onclick="event.stopPropagation()" onkeydown="event.stopPropagation();if(event.key==='Enter')ukolOdpovedet('${t.id}')">
      <button class="btn dark sm" style="flex:none" onclick="event.stopPropagation();ukolOdpovedet('${t.id}')">Odpovědět</button>
    </div>`;
}
function fotkyUkolu(t) {
  if (!(t.photos || []).length) return '';
  return `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${t.photos.map(f =>
    `<span onclick="event.stopPropagation();otevritFoto('${f.id}','','${esc(t.title)}',this)" style="cursor:pointer"><img src="${f.thumb}" style="width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"></span>`).join('')}</div>`;
}
function ukolModal(id) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  modal(`<h3>📌 ${esc(t.title)}</h3>
    <div class="muted" style="font-size:13px">🏗 ${esc((proj(t.pid) || {}).name || '')} · zadal <b>${esc(t.zadal || '?')}</b> ➜ <b>${esc(t.resp || 'nikomu')}</b> · ${terminChip(t)} ${(t.photos || []).length ? '📷' + t.photos.length : ''}</div>
    ${fotkyUkolu(t)}
    ${ukolDetailHtml(t)}
    <div class="aprv"><button class="btn dark" onclick="closeModal()">Zavřít</button></div>`);
}
function ukolNaleh(t) {
  const d = isoToday();
  if (!t.term) return '';
  return t.term < d ? 'po' : t.term === d ? 'dnes' : '';
}
function terminChip(t) {
  const d = isoToday();
  if (!t.term) return '';
  if (t.term < d) return '<span class="badge b-red">❗ po termínu</span>';
  if (t.term === d) return '<span class="badge b-wait">📅 dnes</span>';
  return '<span class="badge b-int">📅 do ' + fmtISO(t.term) + '</span>';
}

function jeMuj(t) {
  if (!S.me) return false;
  if (t.respId) return t.respId === S.me.id;
  return t.resp === fullName(S.me) || (t.res || []).includes(fullName(S.me));
}
const userById = id => S.users.find(u => u.id === id);
/* Komu se da zadat ukol (a predat klic): jen lide z firmy — kancelar,
   parta a subdodavatele (ti maji vlastni vchod, viewSub). Investor je
   klient — ukol mu nikdo zadavat nema. */
function lideProUkoly() {
  return S.users.filter(u => u.active !== false && u.typ && (u.typ.kanc || u.typ.teren || u.typ.sub) && !u.typ.inv)
    .sort((a, b) => (a.prijmeni || '').localeCompare(b.prijmeni || '', 'cs'));
}
function entriesOf(pid) { return S.entries.filter(e => e.pid === pid); }
function pendingEntries() { return S.entries.filter(e => e.status === 'pending'); }
function isOverdue(t) { return t.stav !== 'hotovo' && t.stav !== 'sablona' && t.term && t.term < isoToday(); }
const STAVY = { nove: 'Nové', probiha: 'Probíhá', kontrola: 'Ke kontrole', hotovo: 'Hotovo' };
const STAVCOLOR = { nove: 'b-int', probiha: 'b-wait', kontrola: 'b-wait', hotovo: 'b-ok' };
const VPSTAV = { navrh: ['b-int', '✏️ čeká na nacenění'], u_investora: ['b-wait', '⏳ u investora'], schvaleno: ['b-ok', '✓ schváleno'], zamitnuto: ['b-red', '✕ zamítnuto'], papir: ['b-ok', '✓ schváleno papírově'] };
function sBadge(s) { return s === 'approved' ? '<span class="badge b-ok">✓ schváleno</span>' : s === 'pending' ? '<span class="badge b-wait">⏳ čeká</span>' : '<span class="badge b-int">🔒 interní</span>'; }

/* ---------- mapy (Leaflet + OpenStreetMap, bez klíče a zdarma) ---------- */
const MAPS = {};
function mountMaps() {
  if (typeof L === 'undefined') return;
  document.querySelectorAll('[data-map]').forEach(el => {
    const lat = parseFloat(el.dataset.lat), lng = parseFloat(el.dataset.lng);
    if (el._map || !isFinite(lat) || !isFinite(lng)) return;
    const drag = el.dataset.drag === '1';
    const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const marker = L.marker([lat, lng], { draggable: drag }).addTo(map);
    if (drag) marker.on('dragend', () => {
      const c = marker.getLatLng();
      const a = $('#pf-lat'), b = $('#pf-lng');
      if (a) a.value = c.lat.toFixed(7);
      if (b) b.value = c.lng.toFixed(7);
      /* Popisek platil pro adresu z vyhledavani. Po pretazeni uz spendlik
         nikde nesedi — lepsi zadny popisek nez lzivy. */
      S.geoLabel = '';
      const info = $('#pf-geoinfo');
      if (info) { info.style.display = 'none'; info.innerHTML = ''; }
    });
    el._map = map;
    MAPS[el.dataset.map] = { map, marker };
    setTimeout(() => map.invalidateSize(), 60);
  });
}
function showFormMap(lat, lng) {
  const el = $('#pf-mapwrap'), hint = $('#pf-maphint');
  if (!el) return;
  el.style.display = ''; if (hint) hint.style.display = '';
  el.dataset.lat = lat; el.dataset.lng = lng;
  if (el._map && MAPS.form) {
    MAPS.form.map.setView([lat, lng], 18);
    MAPS.form.marker.setLatLng([lat, lng]);
    setTimeout(() => MAPS.form.map.invalidateSize(), 60);
  } else mountMaps();
}
/* Souradnice z formulare. Cesky telefon i cesky clovek pisou desetinnou
   CARKU — parseFloat zna jen tecku a z „50,0236914" udelal rovnych 50,
   coz je stavba o padesat kilometru vedle a check-in nikomu nesedne. */
function gpsCislo(v) {
  const n = parseFloat(String(v == null ? '' : v).trim().replace(',', '.'));
  return isFinite(n) ? n : NaN;
}
/* Hrube hranice Ceska — nechceme presnost na metr, chceme chytit preklep,
   prohozene lat/lng a nulu uprostred Atlantiku. */
function gpsVCesku(lat, lng) {
  return isFinite(lat) && isFinite(lng) && lat >= 48 && lat <= 52 && lng >= 12 && lng <= 19;
}
function mapFromInputs() {
  const lat = gpsCislo($('#pf-lat').value), lng = gpsCislo($('#pf-lng').value);
  /* Rucne prepsana souradnice uz neodpovida nalezene adrese — popisek
     „Spendlik nastaven podle: …" by lhal, tak ho zahazujeme. Prazdny
     retezec (ne null) = uzivatel ho vedome zrusil. */
  S.geoLabel = '';
  const info = $('#pf-geoinfo');
  if (info) { info.style.display = 'none'; info.innerHTML = ''; }
  if (gpsVCesku(lat, lng)) showFormMap(lat, lng);
}
/* adresa -> souradnice pres Nominatim (OpenStreetMap)
   POZOR: nikdy nebrat mlcky prvni vysledek. "Nadrazni 15, Brno" vraci jako
   prvni Bedrichovice u Slapanic. Uzivatel musi vzdy videt, co dostal. */
async function geocodeAddress() {
  const q = ($('#pf-addr').value || '').trim();
  const box = $('#pf-geohits'), info = $('#pf-geoinfo');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  if (info) info.style.display = 'none';
  if (!q) { toast('Nejdřív vyplň adresu'); return; }
  if (!S.online) { toast('Hledání adresy potřebuje internet'); return; }
  toast('Hledám adresu…');
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=cz&q=' + encodeURIComponent(q);
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const j = await res.json();
    if (!j || !j.length) { toast('Adresu se nepodařilo najít — zkus ji napsat jinak'); return; }
    S.geoHits = j;
    if (j.length === 1) { pickGeo(0); return; }
    if (!box) return;
    box.style.display = '';
    box.innerHTML = `<div class="inote"><b>Našel jsem ${j.length} možností.</b> Vyber tu správnou —
      dokud nevybereš, GPS se nenastaví. (Stejná ulice bývá v desítkách měst.)</div>` +
      j.map((d, i) => `<div class="urow" style="cursor:pointer;border-radius:8px;padding:9px 8px;align-items:flex-start"
        onclick="pickGeo(${i})"><span class="uav" style="margin-top:1px">${i + 1}</span>
        <span style="line-height:1.4">${esc(d.display_name)}</span></div>`).join('');
  } catch (e) { toast('Hledání se nepovedlo — zkus to znovu'); }
}
function pickGeo(i) {
  const d = (S.geoHits || [])[i]; if (!d) return;
  const lat = +parseFloat(d.lat).toFixed(7), lng = +parseFloat(d.lon).toFixed(7);
  $('#pf-lat').value = lat; $('#pf-lng').value = lng;
  S.geoLabel = d.display_name;
  const box = $('#pf-geohits');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  const info = $('#pf-geoinfo');
  if (info) { info.style.display = ''; info.innerHTML = '📍 <b>Nastaveno podle:</b> ' + esc(d.display_name); }
  showFormMap(lat, lng);
  toast('GPS nastavena ✓ Zkontroluj špendlík na mapě');
}

/* ---------- Drive most (Apps Script) ---------- */
async function driveCall(payload) {
  if (!CFG.scriptUrl) throw new Error('Drive most není nastaven (config.js → scriptUrl)');
  const res = await fetch(CFG.scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j;
}
function driveViewUrl(id) { return 'https://drive.google.com/file/d/' + id + '/view'; }
/* Nazev pro ulozeni souboru z mostu. Odkaz na blob: nejde otevrit do noveho
   okna (prohlizece to blokuji a v aplikaci na plose telefonu to nefunguje
   vubec) — musi mit priznak download, a k nemu rozumne jmeno s priponou. */
function nazevKeStazeni(titulek, mime) {
  const pripony = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const zaklad = String(titulek || 'soubor').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'soubor';
  const pripona = pripony[mime] || (String(mime || '').split('/')[1] || '').replace(/[^a-z0-9]/gi, '').slice(0, 5);
  return /\.[a-z0-9]{2,5}$/i.test(zaklad) || !pripona ? zaklad : zaklad + '.' + pripona;
}

/* ---------- fronta na Drive ----------
   Drive se puvodne fotka v plne kvalite zahodila, kdyz byl telefon offline —
   v zaznamu zustal jen maly nahled a original uz nikde nebyl. Presne v suterenu
   a v jadru, kde neni signal, se ale foti to nejdulezitejsi.
   Ted se plna verze ulozi do telefonu (IndexedDB, na rozdil od localStorage
   uveze i stovky MB) a odesle se sama, jakmile je signal. Zaznam v deniku
   vznikne hned, driveId se do nej doplni pozdeji. */
const FRONTA = { db: 'vrana-fronta', store: 'soubory' };
let _frontaBezi = false;
function frontaOpen() {
  return new Promise((ok, no) => {
    if (!window.indexedDB) return no(new Error('bez IndexedDB'));
    const r = indexedDB.open(FRONTA.db, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(FRONTA.store)) r.result.createObjectStore(FRONTA.store, { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
function frontaTx(mode, fn) {
  return frontaOpen().then(d => new Promise((ok, no) => {
    const t = d.transaction(FRONTA.store, mode), st = t.objectStore(FRONTA.store);
    let vysledek; try { vysledek = fn(st); } catch (e) { return no(e); }
    t.oncomplete = () => ok(vysledek && vysledek.result !== undefined ? vysledek.result : vysledek);
    t.onerror = () => no(t.error);
  }));
}
async function frontaPridat(polozka) {
  await frontaTx('readwrite', st => st.add(polozka));
  await frontaSpocitat();
}
async function frontaVse() {
  try { return await frontaTx('readonly', st => st.getAll()) || []; } catch (e) { return []; }
}
async function frontaSmazat(id) { try { await frontaTx('readwrite', st => st.delete(id)); } catch (e) {} }
async function frontaSpocitat() {
  try { const v = await frontaVse(); S.frontaPocet = v.length; } catch (e) { S.frontaPocet = 0; }
  render();
}
/* Odesle vsechno, co ceka. Bezi po jedne polozce, aby se dva zapisy do stejneho
   deniku neprepsaly navzajem. Co se nepovede, zustane ve fronte na priste. */
const FRONTA_POKUSU = 5;   // po kolika marnych pokusech (mimo vypadku site) polozku vzdame
/* Vypadek site vypada jinak nez odmitnuti mostem: fetch spadne na TypeError
   („Failed to fetch" / „Load failed"), zadna odpoved nedorazi. Takovy pokus
   se nesmi pocitat, jinak by pulden bez signalu smazal partě fotky. */
function jeVypadekSite(e) {
  if (!navigator.onLine || !S.online) return true;
  if (e instanceof TypeError) return true;
  return /failed to fetch|load failed|network|timed? ?out/i.test(String((e && e.message) || ''));
}
async function frontaOdeslat() {
  if (_frontaBezi || !S.online || !CFG.scriptUrl) return;
  /* Zamek MUSI byt driv nez prvni await — jinak dve soucasna volani
     (navrat signalu, casovac po 90 s, odeslani zapisu) projdou obe
     a tataz fotka se na Drive nahraje dvakrat. */
  _frontaBezi = true;
  const cekaji = await frontaVse();
  if (!cekaji.length) { _frontaBezi = false; return; }
  S.uploading++; render();
  let zmeskano = 0;
  try {
    for (const it of cekaji) {
      if (!S.online) break;
      try {
        let fileId = it.fileId;
        if (!fileId) {
          const j = await driveCall({
            action: 'upload', folderId: it.folderId || '', rootId: CFG.driveRootFolderId,
            cn: it.cn, client: it.client, folderName: it.folderName || '', date: it.date, name: it.name,
            druh: it.druh || 'foto',          // most podle toho vybere podsložku v 09_Denik_staveb
            data: String(it.data).split(',')[1], mime: it.mime || 'application/octet-stream'
          });
          fileId = j.fileId;
          /* Most odpovedel, ale soubor nezalozil. Opakovani nepomuze a zapis
             `undefined` by Firestore odmitl — polozku proto rovnou vzdame,
             at nedrzi frontu (za ni cekaji dalsi fotky i selfie z dochazky). */
          if (!fileId) {
            console.warn('fronta: most nevratil fileId — polozka vyrazena', it.name || '');
            await frontaSmazat(it.id);
            zmeskano++;
            continue;
          }
          /* fileId si ulozime do polozky HNED: kdyz zapis do zaznamu nevyjde,
             pristi pokus uz fotku NEnahrava na Drive znovu (zadne duplikaty),
             jen dopise driveId. Data fotky uz nejsou potreba. */
          it.fileId = fileId; delete it.data;
          try { await frontaTx('readwrite', st => st.put(it)); } catch (e2) { console.warn('fronta put', e2); }
        }
        await frontaZapsatDoZaznamu(it, fileId);
        await frontaSmazat(it.id);
      } catch (e) {
        /* permission-denied = TRVALA chyba: zaznam mezitim opustil stav
           pending (vedeni ho schvalilo / dalo jen interni / smazalo) a autor
           uz do nej zapsat nesmi. Polozku vyradime — jinak by navzdy
           blokovala celou frontu (selfie z dochazky, dalsi fotky). */
        if (e && e.code === 'permission-denied') {
          console.warn('fronta: polozka vyrazena — do zaznamu uz nejde zapsat', it.entryId || it.attendanceId || '', e);
          await frontaSmazat(it.id);
          continue;
        }
        /* Vypadl signal? Nic nepocitame a zkusime priste — parta foti
           v suterenech, kde je bez signalu klidne cely den. */
        if (jeVypadekSite(e)) { console.warn('fronta: bez signalu, zkusim priste', e); break; }
        /* Most odpovedel, ale polozku odmitl (moc velky soubor, chyba v
           zaznamu). Opakovani nejspis nepomuze — po par pokusech ji vzdame,
           jinak by zablokovala celou frontu navzdy a za ni by uz neproslo
           nic: dalsi fotky, prilohy ani selfie z dochazky. */
        it.pokusy = (it.pokusy || 0) + 1;
        if (it.pokusy >= FRONTA_POKUSU) {
          console.warn('fronta: polozka vzdana po ' + it.pokusy + ' pokusech', it.name || '', e);
          await frontaSmazat(it.id);
          zmeskano++;
          continue;
        }
        try { await frontaTx('readwrite', st => st.put(it)); } catch (e3) {}
        console.warn('fronta', e);
        continue;   /* dalsi polozky nedrzime — jedna vadna nesmi zastavit vsechny */
      }
    }
  } finally {
    _frontaBezi = false; S.uploading--;
    if (zmeskano) toast('⚠ ' + zmeskano + (zmeskano === 1 ? ' soubor se nepodařilo odeslat' : ' souborů se nepodařilo odeslat') + ' — zkus je přidat znovu.');
    await frontaSpocitat();
  }
}
async function frontaZapsatDoZaznamu(it, fileId) {
  if (it.druh === 'selfie') {
    if (!it.attendanceId) return;
    await db.collection('attendance').doc(it.attendanceId).update({ selfieDriveId: fileId }).catch(() => {});
    return;
  }
  if (!it.entryId) return;
  const ref = db.collection('entries').doc(it.entryId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const e = snap.data();
  if (it.druh === 'foto' || it.druh === 'nahled') {
    /* Na fotku ted jdou na Drive DVA soubory a kazdy ma v zaznamu sve pole:
       - 'nahled' (prohlizeci kopie 1600 px) -> driveId — z nej cte prohlizeni,
         galerie i portal, presne jako driv;
       - 'foto' s priznakem original -> origId — puvodni soubor z telefonu
         i s metadaty (datum, GPS), otevira ho „Plné rozlišení".
       Polozka 'foto' BEZ priznaku je jeste ze stare fronty (pred touto
       zmenou) — byla to prohlizeci kopie, patri tedy dal do driveId. */
    const pole = (it.druh === 'foto' && it.original) ? 'origId' : 'driveId';
    const photos = (e.photos || []).map(ph => ph.id === it.photoId ? { ...ph, [pole]: fileId } : ph);
    await ref.update({ photos });
    /* Zrcadleni na portal smi jen admin — u pracovnika by spadlo i po
       uspesnem zapisu fotek a polozka by se vracela do fronty. Portal se
       stejne prekresli, kdyz vedeni zaznam schvali nebo prepne fotku. */
    if (e.status === 'approved' && S.meAuth && S.meAuth.role === 'admin') {
      try { await mirrorEntry({ ...e, id: it.entryId, photos }); } catch (err) { console.warn('zrcadleni po fronte', err); }
    }
  } else {
    const attachments = [...(e.attachments || []), { name: it.name, driveId: fileId, mime: it.mime || '' }];
    await ref.update({ attachments });
  }
}
window.addEventListener('online', () => setTimeout(frontaOdeslat, 1500));
setInterval(() => { if (S.online) frontaOdeslat(); }, 90000);

/* ---------- image pipeline ---------- */
function fileToImage(file) {
  return new Promise((ok, no) => { const img = new Image(); img.onload = () => ok(img); img.onerror = no; img.src = URL.createObjectURL(file); });
}
function scaleJpeg(img, maxPx, q) {
  const r = Math.min(1, maxPx / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
/* Zmensi hotovou data-URL fotku v prohlizeci. Most vraci rovnou 1600px
   verzi (Google zmensovani na serveru odmita) — na portal ale staci
   1100 px jako driv, at ma dokument ~220 kB a ne pres pul mega.
   Kdyz se zmenseni nepovede, vrati se original — je pod limitem 1 MB,
   takze fotku neni duvod zahazovat. */
function zmensitDataUrl(dataUrl, maxPx, q) {
  return new Promise(ok => {
    const img = new Image();
    img.onload = () => { try { ok(scaleJpeg(img, maxPx, q)); } catch (e) { ok(dataUrl); } };
    img.onerror = () => ok(dataUrl);
    img.src = dataUrl;
  });
}
/* Strop poctu fotek na jeden zaznam: dokument ma limit 1 MB a kazdy nahled
   nese ~25-60 kB — bez stropu by se zaznam s 20+ fotkami tise neulozil,
   ale uzivatel by videl "ulozeno". Osm sedi na kalkulaci u fotonahledu. */
const MAX_FOTEK_ZAZNAMU = 8;
/* Nahradni dlazdice pro fotku, ktere prohlizec neumi vyrobit nahled
   (typicky HEIC mimo iPhone) — bez ni by v mrizce strasil rozbity obrazek. */
const NAHLED_NEDOSTUPNY = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#d8dde3"/><text x="60" y="58" font-size="34" text-anchor="middle">📷</text><text x="60" y="88" font-size="12" text-anchor="middle" fill="#556">bez náhledu</text></svg>');
/* Strop pro original: most (Apps Script) ma limit na velikost pozadavku
   a prilohy uz dnes jedou s 15 MB — vetsi soubor by pri odesilani stejne
   spadl a donekonecna blokoval frontu. Bezna fotka z iPhonu ma 3-5 MB. */
const MAX_ORIGINAL_MB = 15;
async function processPhotos(files, label) {
  for (const f of files) {
    if (S.draftPhotos.length >= MAX_FOTEK_ZAZNAMU) {
      oznam('Do jednoho záznamu jde nejvíc ' + MAX_FOTEK_ZAZNAMU + ' fotek — víc by se nevešlo a záznam by se neuložil.\nDalší fotky prosím přidej do nového zápisu.');
      break;
    }
    /* ORIGINAL: bajty presne tak, jak prisly z telefonu. Prekresleni pres
       platno (scaleJpeg) zahodi datum porizeni, GPS a dalsi metadata — pro
       denik, ktery muze slouzit jako doklad, se proto original uklada
       vedle zmensenin a nahraje se na Drive netknuty. */
    let orig = null;
    if (f.size > MAX_ORIGINAL_MB * 1024 * 1024) {
      toast('⚠ ' + (f.name || 'Soubor') + ' má přes ' + MAX_ORIGINAL_MB + ' MB — na Drive půjde jen zmenšená kopie (bez metadat).');
    } else {
      try {
        const data = await new Promise((ok, ne) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ne(r.error); r.readAsDataURL(f); });
        orig = { data, mime: f.type || 'application/octet-stream', name: f.name || '' };
      } catch (e) { console.warn('original fotky se nepodarilo precist', e); }
    }
    try {
      const img = await fileToImage(f);
      const thumb = scaleJpeg(img, 360, 0.62);
      /* Stredni verze (1100 px) se u zapisu uz nikam neuklada — do databaze
         nejde (~220 kB na fotku by pri tisicich fotek vycerpalo 1GB limit)
         a na Drive jde verze 1600 px. Nepocitame ji tedy vubec: osm fotek
         by jinak drzelo v pameti telefonu megabajty navic zbytecne.
         Fotky UKOLU maji svou vlastni cestu a stredni verzi si dal delaji. */
      const full = scaleJpeg(img, 1600, 0.82);
      S.draftPhotos.push({ tmp: uid8(), thumb, full, orig, label: label || f.name.replace(/\.[^.]+$/, ''), status: 'pending', driveId: null });
      URL.revokeObjectURL(img.src);
    } catch (e) {
      /* Prohlizec fotku nedokazal dekodovat (napr. HEIC na pocitaci).
         Kdyz mame aspon original, fotka NESMI propadnout: nahraje se on,
         jen dlazdice zustane bez nahledu a clovek dostane hlasku. */
      if (orig) {
        S.draftPhotos.push({ tmp: uid8(), thumb: NAHLED_NEDOSTUPNY, full: null, orig, label: label || (f.name || '').replace(/\.[^.]+$/, ''), status: 'pending', driveId: null });
        toast('⚠ Náhled fotky ' + (f.name || '') + ' se nepodařilo vyrobit — originál se ale na Drive nahraje.');
      } else toast('Fotku se nepodařilo načíst: ' + f.name);
    }
  }
  render();
}
/* Fotky uz se nenahravaji pred ulozenim zaznamu. Zaznam vznikne hned (i bez
   signalu) a plne verze se postavi do fronty — odeslou se samy. */
/* Pripona pro original na Drive: z puvodniho jmena souboru, jinak podle
   mime — HEIC z iPhonu nesmi skoncit s priponou .jpg, to by mátlo. */
function priponaSouboru(name, mime) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name || '');
  if (m) return '.' + m[1].toLowerCase();
  const mapa = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif', 'image/tiff': '.tif' };
  return mapa[(mime || '').toLowerCase()] || '.bin';
}
/* Nazev slozky zakazky na Disku — tvar z master planu:
   CN<cislo>_<Prijmeni>_<Lokalita>, bez diakritiky (tu sundava most).
   Nazev stavby uz ten tvar nese obracene ("Machuldova - Sasek"), takze
   staci prohodit; kdyz chybi, poskladame ho z klienta a adresy.
   Posila se mostu, aby si slozku nepojmenovaval po svem — driv z toho
   vznikaly duplikaty typu "CN..._Josef_Sasek_a_Miloslava_Saskova_SYSTEM",
   ktere pak stinily tu pravou pri cteni nabidky. */
function nazevSlozkyZakazky(p) {
  if (!p) return '';
  /* Nazev stavby uz ten tvar nese obracene („Machuldova - Sasek"), takze
     staci prohodit. Delitko muze byt spojovnik i pomlcka. Kdyz se nazev
     nerozpadne (treba „TEST — zkusebni stavba"), poskladame nazev
     z adresy a klienta — jinak by v nem skoncil cely nazev stavby. */
  const casti = String(p.name || '').split(/\s+[-–—]\s+/);
  const zAdresy = String(p.address || '').split(/[\s,]/).filter(Boolean)[0] || '';
  const zKlienta = String(p.client || '').split(' a ')[0].trim().split(/\s+/).pop() || '';
  const lokalita = (casti.length > 1 ? casti[0] : zAdresy).trim();
  const prijmeni = (casti.length > 1 ? casti[1] : zKlienta).trim();
  return [String(p.cn || '').trim(), prijmeni, lokalita].filter(Boolean).join('_');
}
async function zaraditFotky(p, entryId, den) {
  const out = [];
  for (const ph of S.draftPhotos) {
    const id = uid8();
    /* driveId = prohlizeci kopie (jako dosud), origId = puvodni soubor
       s metadaty — obe doplni fronta, az se soubory nahraji na Drive. */
    out.push({ id, thumb: ph.thumb, label: ph.label, status: 'pending', driveId: null, origId: null });
    /* Stredni verze se do /fotonahledy UZ NEUKLADA: velka verze lezi na
       Drive a most ji umi vydat (getPhoto), takze by tu jen zabirala
       ~220 kB na fotku a tisice fotek by vycerpaly 1GB limit databaze.
       Stare fotky svuj nahled v /fotonahledy maji dal — slouzi jako zaloha. */
    /* nazev souboru = prijmeni nahravajiciho — iPhone posila "image",
       coz na Drive nic nerika; datum a cas prida most na zacatek */
    const jmeno = (S.me && S.me.prijmeni) || fullName(S.me || {}) || 'foto';
    /* Datum patri ZAPISU, ne dnesku — u zpetne psaneho zapisu se jinak
       fotky na Disku pojmenovaly podle dne odeslani a pri dohledavani
       "co bylo v patek" nesedely. Totez plati pro prilohy. */
    const spol = { entryId, photoId: id, folderId: (p && p.driveFolderId) || '', cn: (p && p.cn) || '', client: (p && p.client) || '', folderName: nazevSlozkyZakazky(p), date: den || isoToday() };
    /* Kazda polozka ma svuj try. Kdyby byly spolecne a selhala prvni
       (typicky plna pamet telefonu), druha by se uz ani nezkusila. */
    let mamNahled = false;
    try {
      /* PROHLIZECI KOPIE (1600 px JPEG) — druh 'nahled', at ji most odlisi
         od originalu. Jeji fileId se zapise do driveId, takze prohlizeni,
         galerie i portal jedou beze zmeny. */
      if (ph.full) { await frontaPridat({ druh: 'nahled', name: jmeno + '.jpg', mime: 'image/jpeg', data: ph.full, ...spol }); mamNahled = true; }
    } catch (e) { console.warn('fronta nahled', e); }
    try {
      /* ORIGINAL tak, jak prisel z telefonu — vcetne data porizeni a GPS.
         Skutecny mime i pripona (klidne HEIC); priznak original rika
         fronte, ze jeho fileId patri do origId, ne do driveId. */
      if (ph.orig) await frontaPridat({ druh: 'foto', original: true, name: jmeno + priponaSouboru(ph.orig.name, ph.orig.mime), mime: ph.orig.mime, data: ph.orig.data, ...spol });
    } catch (e) {
      /* Original se nevesel, ale prohlizeci kopie ano — to je porad dobra
         fotka, jen bez data a GPS. Hlasit se musi jen skutecny problem. */
      console.warn('fronta original', e);
      if (!mamNahled) toast('⚠ Fotku se nepodařilo uložit do fronty — zkus ji přidat znovu.');
      else toast('⚠ Fotka se uloží, ale bez původních dat (datum, poloha) — v telefonu došlo místo.');
    }
    if (!mamNahled && !ph.orig) toast('⚠ Fotku se nepodařilo uložit do fronty — zkus ji přidat znovu.');
  }
  S.draftPhotos = [];
  return out;
}
/* Zruseni rozepsaneho zapisu. Fotky se musi zahodit spolu s textem —
   kdyby zustaly v pameti, splnily by o den pozdeji podminku „aspon jedna
   fotka" a pripnuly by se k uplne jinemu zapisu, klidne na jine stavbe. */
function zrusitRozepsanyZapis() {
  S.subOdchodOpen = false; S.subZaznam = '';
  S.draftPhotos = []; S.draftAtts = [];
  render();
}
async function zaraditPrilohy(p, entryId) {
  for (const at of (S.draftAtts || [])) {
    try {
      await frontaPridat({
        druh: 'priloha', entryId, name: at.name, mime: at.mime || 'application/octet-stream',
        data: at.data, folderId: (p && p.driveFolderId) || '', cn: (p && p.cn) || '', client: (p && p.client) || '', folderName: nazevSlozkyZakazky(p), date: isoToday()
      });
    } catch (e) { console.warn('fronta priloha', e); toast('⚠ Přílohu ' + at.name + ' se nepodařilo uložit do fronty'); }
  }
  S.draftAtts = [];
}

/* ---------- přílohy záznamu ---------- */
function processAtts(files) {
  [...files].forEach(f => {
    if (f.size > 15 * 1024 * 1024) { toast('Příloha ' + f.name + ' je moc velká (max 15 MB)'); return; }
    const rd = new FileReader();
    rd.onload = () => { (S.draftAtts = S.draftAtts || []).push({ name: f.name, mime: f.type || '', data: rd.result }); render(); };
    rd.readAsDataURL(f);
  });
}
async function addAttsToEntry(eid, files) {
  const list = [...files]; if (!list.length) return;
  const e = S.entries.find(x => x.id === eid); if (!e) return;
  const p = proj(e.pid) || {};
  for (const f of list) {
    if (f.size > 15 * 1024 * 1024) { toast('Moc velké (max 15 MB): ' + f.name); continue; }
    const data = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    try {
      await frontaPridat({ druh: 'priloha', entryId: eid, name: f.name, mime: f.type || 'application/octet-stream',
        data, folderId: p.driveFolderId || '', cn: p.cn || '', client: p.client || '', folderName: nazevSlozkyZakazky(p), date: e.date });
    } catch (err) { console.warn(err); toast('⚠ ' + f.name + ' se nepodařilo uložit do fronty'); }
  }
  toast(S.online ? 'Nahrávám na Drive…' : 'Uloženo — odešle se, až bude signál ✓');
  frontaOdeslat();
}

/* ---------- počasí (Open-Meteo, dle GPS projektu) ---------- */
const WMO = { 0: 'jasno ☀️', 1: 'převážně jasno 🌤', 2: 'polojasno ⛅', 3: 'zataženo ☁️', 45: 'mlha 🌫', 48: 'mlha 🌫', 51: 'mrholení 🌦', 53: 'mrholení 🌦', 55: 'mrholení 🌧', 61: 'slabý déšť 🌦', 63: 'déšť 🌧', 65: 'silný déšť 🌧', 66: 'mrznoucí déšť 🌧', 67: 'mrznoucí déšť 🌧', 71: 'slabé sněžení 🌨', 73: 'sněžení 🌨', 75: 'silné sněžení ❄️', 77: 'sněhová zrna 🌨', 80: 'přeháňky 🌦', 81: 'přeháňky 🌧', 82: 'silné přeháňky ⛈', 85: 'sněhové přeháňky 🌨', 86: 'sněhové přeháňky ❄️', 95: 'bouřky ⛈', 96: 'bouřky s kroupami ⛈', 99: 'bouřky s kroupami ⛈' };
async function fetchWeather(p, date) {
  if (!p || !p.gps || !p.gps.lat || !S.online) return null;
  try {
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.gps.lat + '&longitude=' + p.gps.lng + '&daily=weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum&timezone=Europe%2FPrague&start_date=' + date + '&end_date=' + date;
    const r = await fetch(u); const j = await r.json(); const d = j.daily;
    if (!d || !d.time || !d.time.length) return null;
    const srz = d.precipitation_sum[0];
    return ((WMO[d.weather_code[0]] || '') + ' · ' + Math.round(d.temperature_2m_min[0]) + ' až ' + Math.round(d.temperature_2m_max[0]) + ' °C' + (srz ? ' · srážky ' + srz + ' mm' : '')).trim();
  } catch (e) { return null; }
}

/* ---------- osoby na staveništi (z docházky) ---------- */
function attOn(pid, date) {
  const per = {};
  /* Jen prichod a odchod — pauza ma vlastni zaznamy a bez tohohle filtru
     by se zapnuta pauza pocitala jako odchod ze stavby. */
  S.attendance.filter(a => a.pid === pid && a.date === date
    && (a.akce === 'Příchod' || a.akce === 'Odchod')).forEach(a => {
    const k = a.userDocId || a.userName;
    per[k] = per[k] || { name: a.userName || fullName(userById(a.userDocId) || {}) || '?', prichod: '', odchod: '' };
    if (a.akce === 'Příchod') { if (!per[k].prichod || a.time < per[k].prichod) per[k].prichod = a.time; }
    else { if (!per[k].odchod || a.time > per[k].odchod) per[k].odchod = a.time; }
  });
  return Object.values(per).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

/* ---------- záznamy: workflow ---------- */
/* Rozdeleni textu na jednotlive prace: kazdy radek je polozka a dlouhy
   odstavec se rozpadne na vety (tecka/vykricnik/otaznik + mezera + velke
   pismeno). Odrazky na zacatku radku se orezou.
   POZOR (S19): drive se to delalo regularnim vyrazem s lookbehind
   "(?<=[.!?])". Ten iPhony starsi nez iOS 16.4 neumi a spadly uz pri
   nacitani celeho app.js — pracovnik videl bilou obrazovku a vubec se
   neprihlasil. Proto stejny vysledek jinak: pred zacatek nove vety
   vlozime radkovy zlom a delime uz jen podle radku. */
function rozdelNaVety(txt) {
  return String(txt == null ? '' : txt)
    .replace(/([.!?])\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/g, '$1\n$2')
    .split(/\n+/)
    .map(s => s.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean);
}
/* Zaznam se zaklada s ID vyrobenym v telefonu, ne az po odpovedi serveru —
   diky tomu funguje zapis i bez signalu a fotky uz vedi, kam patri. */
async function addEntry(pid, author, txt, persons, date) {
  const p = proj(pid);
  const works = txt ? rozdelNaVety(txt) : [];
  const d = date || isoToday();
  const ref = db.collection('entries').doc();
  const photos = await zaraditFotky(p, ref.id, d);
  await zaraditPrilohy(p, ref.id);
  ref.set({
    pid, date: d, createdAt: FV(), author, authorUid: S.authUser.uid,
    /* Pocet osob se NEVYMYSLI: kdyz neni znamy (zapis od party), zustane
       null a zobrazeni ho bere z dochazky. Drive tu bylo "|| 1" a kazdy
       zapis pracovnika pak v deniku i PDF lhal "1 os." (zadani 25. 8.). */
    persons: persons || null, works: works.length ? works : ['(jen fotodokumentace)'],
    /* interni poznamka uz na zapisu nebydli — zapisy ctou vsechny role,
       poznamka vedeni je v admin-only /entries_interni (S5) */
    client: txt || 'Fotodokumentace z průběhu prací.', status: 'pending', photos
  }).catch(e => {
    console.warn('zapis zaznamu', e);
    /* Online chyba znamena, ze zaznam OPRAVDU nevznikl (napr. prekroceny
       limit dokumentu) — bez hlasky by uzivatel videl "ulozeno ✓" a zapis
       by tise zmizel. Offline se nehlasi nic: Firestore si zapis podrzi
       a odesle sam, az bude signal. */
    if (S.online) oznam('⚠ Záznam se NEPODAŘILO uložit (' + (e.code || e.message || e) + ').\nZkus to prosím znovu, případně s méně fotkami.');
  });
  frontaOdeslat();
  fetchWeather(p, d).then(w => { if (w) ref.update({ weather: w }).catch(() => {}); });
}
/* Fotky v zaznamu dopisuje i fronta na telefonu (driveId, origId), a to
   kdykoli — treba prave ted. Kdo mení stav fotek, musi proto vyjit z CERSTVE
   verze dokumentu, ne z kopie z posluchace; jinak by odkazy na Drive prepsal
   starsi verzi a fotka by uz navzdy zustala jen jako mala dlazdice.
   Kdyz se cerstva verze precist neda (offline), pouzije se kopie — to je
   porad lepsi nez akci vedeni odmitnout. */
async function cerstveFotky(id, zaloha) {
  try {
    const snap = await db.collection('entries').doc(id).get();
    if (snap.exists && Array.isArray(snap.data().photos)) return snap.data().photos;
  } catch (e) { console.warn('cerstve fotky', e); }
  return zaloha || [];
}
async function approveEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  const ta = document.getElementById('ct-' + id);
  const clientTxt = ta ? (ta.value.trim() || e.client) : e.client;
  /* Bez osetreni se pri vypadku site nestalo NIC — zadna hlaska, zadna
     fajfka — a vedeni si myslelo, ze schvalilo. Vzor je v delEntry. */
  let photos;
  try {
    photos = (await cerstveFotky(id, e.photos)).map(ph => ph.status === 'pending' ? { ...ph, status: 'approved' } : ph);
    await db.collection('entries').doc(id).update({ status: 'approved', client: clientTxt, photos, approvedAt: FV(), approvedBy: fullName(S.me || {}) });
  } catch (err) { toast('Nepovedlo se schválit: ' + (err.code || err.message)); return; }
  zapomen('ct-' + id);
  /* Zrcadleni na portal smi selhat samo o sobe — zapis uz schvaleny je
     a dorovnejPortaly() ho pri pristim prihlaseni vedeni dozene. */
  let zrcadleno = true;
  try { await mirrorEntry({ ...e, status: 'approved', client: clientTxt, photos }); }
  catch (err) { zrcadleno = false; console.warn('zrcadleni po schvaleni', err); }
  notifyMail('entry', e.pid, clientTxt);
  toast(zrcadleno ? 'Schváleno — investor teď záznam uvidí ✓' : 'Schváleno ✓ — portál se srovná, až bude signál');
}
async function keepInternalEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  try {
    const photos = (await cerstveFotky(id, e.photos)).map(ph => ({ ...ph, status: 'internal' }));
    await db.collection('entries').doc(id).update({ status: 'internal', photos });
  } catch (err) { toast('Nepovedlo se označit jako interní: ' + (err.code || err.message)); return; }
  /* token portalu uz neni na projektu, ale v admin-only /portaly (S2) */
  const tok = await tokenPortaluAsync(e.pid).catch(() => null);
  if (tok) {
    await db.collection('portals').doc(tok).collection('feed').doc(id).delete().catch(() => {});
    /* velke fotky zapisu pryc z portalu — interni zapis tam nema co nechat */
    for (const ph of (e.photos || [])) if (ph.id) db.collection('portals').doc(tok).collection('fotky').doc(ph.id).delete().catch(() => {});
  }
  toast('Označeno jako interní — investor neuvidí');
}
/* Cesta zpet od schvaleneho zapisu: kdyz se do zneni pro investora vloudi
   chyba, musi jit zapis z portalu stahnout. Dela presne totez co "jen
   interni" (feed i velke fotky mizi z portalu), jen se na to napred pta —
   tenhle zapis uz investor videl. */
async function stahnoutZPortalu(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  if (!await potvrd('Stáhnout záznam z portálu investora?\n\n' + fmtISOFull(e.date) +
    '\n\nInvestor ho přestane vidět a stane se z něj interní záznam. Vrátit ho ke schválení jde kdykoli potom.', 'Stáhnout')) return;
  await keepInternalEntry(id);
}
/* Zapis v urednim deniku slo drive napsat jen jednou. Preklep ve vete, ktera
   jde do PDF a na portal investora, se nedal spravit vubec — pole works se
   nikde needitovalo a "Zneni pro investora" bylo k mani jen u zapisu, ktery
   cekal na schvaleni. Opravit ho smi vedeni; po ulozeni se portal srovna. */
function zapisEditHtml(e) {
  if (S.entryEdit !== e.id) {
    return `<ul class="worklist">${(e.works || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      <div class="aprv"><button class="btn ghost sm" onclick="otevriZapis('${e.id}')">✏️ Opravit zápis</button></div>`;
  }
  return `<label>Provedené práce <span class="muted" style="text-transform:none;font-weight:400">— jedna odrážka na řádek</span></label>
    <textarea id="ze-w-${e.id}" style="min-height:96px">${esc((e.works || []).join('\n'))}</textarea>
    ${e.status !== 'pending' ? `<label>Znění pro investora</label>
    <textarea id="ze-c-${e.id}" style="min-height:70px">${esc(e.client || '')}</textarea>` : ''}
    <div class="aprv"><button class="btn amber sm" onclick="ulozZapis('${e.id}')">💾 Uložit opravu</button>
      <button class="btn ghost sm" onclick="zrusZapisEdit('${e.id}')">Zrušit</button></div>
    <div class="note">${e.status === 'pending'
      ? 'Znění pro investora se upravuje vedle, v kartě „Znění pro investora".'
      : 'U schváleného záznamu se oprava hned promítne i na portál investora.'}</div>`;
}
function otevriZapis(id) { S.entryEdit = id; render(); }
function zrusZapisEdit(id) { zapomen('ze-w-' + id, 'ze-c-' + id); S.entryEdit = null; render(); }
async function ulozZapis(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  const works = ($('#ze-w-' + id).value || '').split('\n').map(r => r.trim()).filter(Boolean);
  if (!works.length) { toast('Zápis nesmí zůstat prázdný'); return; }
  const ct = $('#ze-c-' + id);
  const client = ct ? (ct.value || '').trim() : (e.client || '');
  try {
    await db.collection('entries').doc(id).update({ works, client,
      upravenoKym: fullName(S.me || {}), upravenoAt: FV() });
  } catch (err) { toast('Nejde uložit: ' + (err.code || err.message)); return; }
  S.entryEdit = null;
  /* Schvaleny zapis uz na portale je — po oprave se tam musi poslat znovu,
     jinak by investor cetl porad tu starou verzi. */
  let zrcadleno = true;
  if (e.status === 'approved') {
    try { await mirrorEntry({ ...e, works, client }); }
    catch (err) { zrcadleno = false; console.warn('zrcadleni po oprave zapisu', err); }
  }
  toast(zrcadleno ? 'Zápis opraven ✓' : 'Opraveno ✓ — portál se srovná, až bude signál');
  render();
  /* Az po prekresleni — stejny duvod jako u poznamky: zapomen() vrati
     policka na zneni PRED opravou a render() by si je stihl nacist zpatky. */
  zapomen('ze-w-' + id, 'ze-c-' + id);
}
async function vratKeSchvaleni(id) {
  try {
    await db.collection('entries').doc(id).update({ status: 'pending' });
    toast('Vráceno ke schválení ✓'); render();
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
async function mirrorEntry(e) {
  // STRUKTURÁLNÍ ZÁRUKA #31: na portál se fyzicky kopíruje JEN klientský text a schválené fotky.
  const tok = await tokenPortaluAsync(e.pid); // token bydli v admin-only /portaly (S2)
  /* Stavba bez portalu je bezny stav (investor ho nemusi mit) — mlcet je
     tu spravne. Ale kdyz portal existuje a zrcadleni presto selze, nesmi
     to zapadnout: investor by zapis nevidel a vedeni by o tom nevedelo.
     Proto se pripadna chyba hlasi a dorovnaPortaly() to pak dozene. */
  if (!tok) return;
  const feedRef = db.collection('portals').doc(tok).collection('feed').doc(e.id);
  /* Velka fotka pro investora se kopiruje do /portals/{token}/fotky/{id} —
     investor neni prihlaseny, takze na most (potrebuje klic) ani na Drive
     (soukromy) nedosahne, a svoji verejnou kopii proto POTREBUJE. Zdroj:
     nove fotky uz stredni verzi v /fotonahledy nemaji, takze se velka verze
     bere z mostu (getPhoto z Drive — zrcadli vedeni, to je prihlasene a klic
     ma) a v prohlizeci se zmensi na 1100 px jako driv; /fotonahledy zustava
     jako zaloha pro stare fotky. KAZDA fotka ma VLASTNI dokument (~200 kB,
     limit dokumentu je 1 MB). Co uz je zkopirovane, se pozna z markeru
     fotoId v minulem feed dokumentu — NE vypisem /fotky, ten by stahoval
     vsechny velke dokumenty najednou.
     fotoId: id = velka verze na portalu je; '' = zadny zdroj neexistuje
     a uz ani nevznikne (stara fotka bez nahledu i bez Drive) — znovu se
     nezkousi; null = kopie se zatim nepovedla (napr. fotka jeste ceka ve
     fronte na Drive), dorovnejPortaly() ji zkusi znovu. */
  const stary = await feedRef.get().catch(() => null);
  const uzMa = {};
  if (stary && stary.exists) for (const ph of (stary.data().photos || [])) {
    if (ph.id && ph.fotoId !== undefined) uzMa[ph.id] = ph.fotoId;
  }
  const photos = [];
  for (const ph of (e.photos || []).filter(x => x.status === 'approved')) {
    let fotoId = (ph.id && uzMa[ph.id] != null) ? uzMa[ph.id] : null;
    if (fotoId === null && ph.id) {
      try {
        let data = null;
        /* (a) most: velka verze z Drive — jediny zdroj pro nove fotky */
        const klic = S.tajne && S.tajne.mostKlic;
        if (ph.driveId && klic && CFG.scriptUrl && S.online) {
          try {
            const j = await driveCall({ action: 'getPhoto', fileId: ph.driveId, sirka: 1100, klic });
            if (j.ok && j.data) data = await zmensitDataUrl('data:' + (j.mime || 'image/jpeg') + ';base64,' + j.data, 1100, 0.72);
            else console.warn('most getPhoto pro portal', j.error);
          } catch (err2) { console.warn('most getPhoto pro portal', err2); }
        }
        /* (b) zaloha: stredni verze z /fotonahledy — stare fotky ji tam maji */
        if (!data) {
          const d = await db.collection('fotonahledy').doc(ph.id).get();
          if (d.exists && d.data().data) data = d.data().data;
        }
        if (data) {
          await db.collection('portals').doc(tok).collection('fotky').doc(ph.id).set({ data, entryId: e.id, date: e.date || '' });
          fotoId = ph.id;
        }
        /* zadny zdroj: kdyz fotka NEMA driveId, mohla by ho jeste dostat
           z fronty — fotoId zustava null a dorovnejPortaly to dozene.
           '' (definitivne vzdat) se uz nastavovat nesmi, protoze by nove
           fotce cekajici ve fronte navzdy uprel velkou verzi na portalu. */
      } catch (err) { console.warn('kopie velke fotky na portal', err); }  // fotoId zustava null → dorovna se
    }
    photos.push({ id: ph.id || '', thumb: ph.thumb, driveId: ph.driveId || null, label: ph.label || '', fotoId: ph.id ? fotoId : '' });
  }
  /* fotka uz neni schvalena (prepnuta na interni / smazana) → jeji velka
     verze nesmi na portalu zustat */
  const aktualni = new Set(photos.map(ph => ph.id));
  for (const id of Object.keys(uzMa)) {
    if (uzMa[id] && !aktualni.has(id)) db.collection('portals').doc(tok).collection('fotky').doc(id).delete().catch(() => {});
  }
  await feedRef.set({ date: e.date, client: e.client, photos })
    .catch(e2 => { console.warn('zrcadleni na portal selhalo', e2); throw e2; });
}

/* Portal investora se sam dorovna (29. 8.).
   Zrcadleni na portal bezi ve chvili schvaleni zapisu. Kdyz se to tehdy
   nepovede — vypadek site, nebo aplikace jeste s ulozenou starsi verzi —
   zapis uz na portal nikdy nedorazi a nikdo to nepozna: investor jen nic
   nevidi. Vedeni proto pri prihlaseni srovna kazdy portal se schvalenymi
   zapisy a doplni, co chybi. Cte se jen seznam ID, takze to skoro nic
   nestoji, a opakovany beh nic nezkazi. */
async function dorovnejPortaly() {
  for (const pid of Object.keys(S.portaly || {})) {
    const tok = tokenPortalu(pid); if (!tok) continue;
    /* Dokumenty pro investora, ktere maji jen odkaz na Disk a ne kopii —
       ty si investor neotevre (Disk po nem chce prihlaseni ke Googlu).
       Doplni se pri prihlaseni vedeni, ktere jako jedine ma klic k mostu. */
    const dk = await db.collection('portals').doc(tok).collection('docs').get().catch(() => null);
    if (dk) for (const d of dk.docs) {
      if (d.data().pripraveno || !d.data().driveId) continue;
      await kopieDokNaPortal(tok, d.id, d.data().driveId).catch(() => {});
    }
    const schvalene = S.entries.filter(e => e.pid === pid && e.status === 'approved');
    if (!schvalene.length) continue;
    const feed = await db.collection('portals').doc(tok).collection('feed').get().catch(() => null);
    if (!feed) continue;
    const uzTam = new Set(feed.docs.map(d => d.id));
    const chybi = schvalene.filter(e => !uzTam.has(e.id));
    for (const e of chybi) await mirrorEntry(e).catch(() => {});
    /* Dorovnat i velke fotky: feed dokument s fotkou bez markeru fotoId
       (zrcadleny starsi verzi aplikace, nebo se kopie tehdy nepovedla)
       se zrcadli znovu — mirrorEntry doplni jen to, co chybi.
       Porovnani == null schvalne: pokryva undefined i null. */
    const bezFotek = schvalene.filter(e => {
      const fd = feed.docs.find(d => d.id === e.id);
      return fd && (fd.data().photos || []).some(ph => ph.fotoId == null);
    });
    for (const e of bezFotek) await mirrorEntry(e).catch(() => {});
    if (chybi.length || bezFotek.length) console.log('portal ' + ((proj(pid) || {}).name || pid) + ': doplneno ' + chybi.length + ' zaznamu, ' + bezFotek.length + ' zaznamu s fotkami');
  }
}
async function cyclePhoto(eid, phid) {
  const e = S.entries.find(x => x.id === eid); if (!e) return;
  let photos;
  try {
    photos = (await cerstveFotky(eid, e.photos)).map(ph => ph.id === phid ? { ...ph, status: ph.status === 'pending' ? 'approved' : ph.status === 'approved' ? 'internal' : 'pending' } : ph);
    await db.collection('entries').doc(eid).update({ photos });
  } catch (err) { toast('Nepovedlo se přepnout fotku: ' + (err.code || err.message)); return; }
  if (e.status === 'approved') {
    try { await mirrorEntry({ ...e, photos }); }
    catch (err) { console.warn('zrcadleni po prepnuti fotky', err); toast('Fotka přepnuta ✓ — portál se srovná, až bude signál'); }
  }
}

/* ---------- e-mail notifikace přes Apps Script (volitelné) ---------- */
function notifyMail(kind, pid, text) {
  if (!CFG.scriptUrl) return;
  const p = proj(pid); if (!p) return;
  const mail = kontaktStavby(pid).email || '';   // S4b: kontakt uz neni na stavbe
  if (!mail) return;
  const tok = tokenPortalu(pid); // token bydli v admin-only /portaly (S2); posila jen vedeni, ma ho nactene
  driveCall({ action: 'notify', to: mail, kind, project: p.name, client: p.client, text: (text || '').slice(0, 500), portalUrl: tok ? location.origin + location.pathname + '?p=' + tok : '' }).catch(() => {});
}

/* ---------- portal akce (schválení vícepráce investorem) ---------- */
async function handlePortalAction(docSnap) {
  const a = docSnap.data();
  try {
    if (a.type === 'vp' && a.vpid) {
      const ref = db.collection('viceprace').doc(a.vpid);
      /* Zavod snapshotu: akce z portalu muze dorazit driv nez seznam
         vicepraci. Kdyby se akce oznacila za vyrizenou hned, schvaleni
         investora by se tise ztratilo — proto se vp pripadne docte primo
         z databaze a handled se zapisuje AZ po skutecnem zpracovani.
         Nenalezena vp se necha nevyrizena na dalsi snapshot. */
      let vp = S.viceprace.find(x => x.id === a.vpid);
      if (!vp) {
        const doc = await ref.get().catch(() => null);
        if (doc && doc.exists) vp = { id: doc.id, ...doc.data() };
      }
      if (!vp) return;
      if (vp.stav === 'u_investora') {
        const stav = a.action === 'approve' ? 'schvaleno' : 'zamitnuto';
        const podpis = (vp.clientName || '') + (a.action === 'approve' ? ' — schváleno jedním klikem na portálu, ' : ' — zamítnuto na portálu, ') + fmtISO(isoToday());
        await ref.update({ stav, podpis, resolvedAt: FV() });
        /* token je v admin-only /portaly (S2); async docteni kryje zavod se snapshotem */
        const tok = await tokenPortaluAsync(vp.pid);
        if (tok) await db.collection('portals').doc(tok).collection('vp').doc(a.vpid).set({ title: vp.title, popis: vp.popis, cena: vp.cena, stav, podpis }, { merge: true });
        toast(a.action === 'approve' ? '📬 Investor schválil vícepráci: ' + vp.title : '📬 Investor zamítl vícepráci: ' + vp.title);
      }
    }
    await docSnap.ref.update({ handled: true });
  } catch (e) { console.warn('action', e); }
}

/* ============ RENDER ROOT ============ */
function render() {
  const root = $('#root');
  if (S.authState === 'loading' && CONFIGURED && !S.portalToken) return;
  // rozepsany text se schova pred prekreslenim a hned potom vrati zpatky
  schovatFormulare();
  if (!CONFIGURED) root.innerHTML = viewNotConfigured();
  else if (S.portalToken) root.innerHTML = viewPortal();
  else if (!S.authUser || !S.meAuth) root.innerHTML = viewLogin();
  else root.innerHTML = (S.meAuth.role === 'admin') ? viewAdmin() : (S.meAuth.role === 'sub' ? viewSub() : viewWorker());
  vratitFormulare();
  if (S.signFor) setTimeout(sigInit, 0);
  setTimeout(mountMaps, 0);
  if (typeof zkontrolovatPauzu === 'function') setTimeout(zkontrolovatPauzu, 0);
  updBar();
}
function viewNotConfigured() {
  return `<div class="login"><div class="lbox"><div class="lg">🏗 REKONSTRUKCE <em>VRÁNA</em></div>
  <div class="ls">Deník staveb — systém není nakonfigurován</div>
  <div class="note">Chybí Firebase konfigurace v <b>config.js</b>. Postup najdeš v SETUP.md — nebo požádej Clauda, ať setup dokončí.</div></div></div>`;
}

/* ============ AUTH ============ */
function initAuth() {
  S.authState = 'loading';
  auth.onAuthStateChanged(async u => {
    if (S.bootstrapping) return; // založení systému právě probíhá — nechat doSetup doběhnout
    clearSubs(); zapomenVse();
    S.authUser = u; S.meAuth = null; S.me = null;
    if (u) {
      try {
        /* POZOR na zavod pri prvnim prihlaseni: Firebase nejdriv overi heslo
           a teprve potom preda databazi totoznost prihlaseneho. Kdyz se
           zeptame driv, pravidla nas vidi jako neprihlaseneho a odmitnou nas
           s "permission-denied" — projevovalo se to tak, ze prvni pokus vzdy
           selhal a druhy uz prosel. Vynutime token a pripadne zopakujeme. */
        try { await u.getIdToken(); } catch (e) {}
        let d = await ctiSPokusem(() => db.collection('users_auth').doc(u.uid).get());
        if (!d.exists) { // krátké čekání — zápis role mohl ještě probíhat
          await new Promise(r => setTimeout(r, 1500));
          d = await ctiSPokusem(() => db.collection('users_auth').doc(u.uid).get());
        }
        if (d.exists) {
          S.meAuth = d.data();
          const me = await ctiSPokusem(() => db.collection('users').doc(S.meAuth.userDocId).get());
          S.me = me.exists ? { id: me.id, ...me.data() } : null;
          S.authState = 'in'; startData(); render(); return;
        } else {
          await auth.signOut();
          S.loginMsg = 'Heslo bylo správně, ale účet nemá přidělená práva. Ať ho vedení otevře v sekci Uživatelé a uloží — práva se tím srovnají.';
        }
      } catch (e) {
        console.warn(e);
        S.loginMsg = 'Přihlášení se nedokončilo: ' + (e.code || e.message);
        await auth.signOut();
      }
    }
    S.authState = 'out';
    loadRoster(); render();
  });
}
async function loadRoster() {
  try {
    const s = await db.collection('roster').get();
    S.roster = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.prijmeni || '').localeCompare(b.prijmeni || '', 'cs'));
    const c = await db.collection('config').doc('app').get();
    S.appCfg = c.exists ? c.data() : null;
  } catch (e) { console.warn(e); }
  render();
}
/* Zarizeni si pamatuje sve lidi — na prihlasovaci obrazovce se neukazuje
   cela parta (soukromi + prehlednost). Prvni pouziti: najdes se hledanim
   podle prijmeni a zarizeni si te zapamatuje. */
function mojiLide() {
  try { return JSON.parse(localStorage.getItem('denik_lide') || '[]'); } catch (e) { return []; }
}
function zapamatujCloveka(id) {
  try {
    const l = mojiLide();
    if (!l.includes(id)) { l.push(id); localStorage.setItem('denik_lide', JSON.stringify(l)); }
  } catch (e) {}
}
function zapomenCloveka(id) {
  try { localStorage.setItem('denik_lide', JSON.stringify(mojiLide().filter(x => x !== id))); } catch (e) {}
  render();
}
function vyberCloveka(id) {
  const r = S.roster.find(x => x.id === id); if (!r) return;
  zapamatujCloveka(id);
  S.loginHledani = null;
  S.loginWorker = { id: r.id, jmeno: r.jmeno, prijmeni: r.prijmeni, authEmail: r.authEmail };
  render();
}
function viewLogin() {
  const m = S.loginMode;
  const teren = S.roster.filter(r => r.role !== 'admin');
  const needsSetup = S.appCfg === null && S.roster.length === 0;
  return `<div class="login"><div class="lbox">
    <div class="lg">🏗 REKONSTRUKCE <em>VRÁNA</em></div>
    <div class="ls">Deník staveb</div>
    ${needsSetup ? `
      <div class="note" style="margin-bottom:10px">👋 <b>První spuštění.</b> Založ účet vedení (Zdeno / Marco):</div>
      <label>Jméno a příjmení</label><input type="text" id="su-name" placeholder="Zdeno Balúch">
      <label>E-mail</label><input type="email" id="su-email" placeholder="zdeno@rekovrana.cz">
      <label>Heslo (min. 6 znaků)</label><input type="password" id="su-pass">
      <div class="aprv"><button class="btn amber" style="width:100%;justify-content:center" onclick="doSetup()">🚀 Založit systém</button></div>
    ` : `
      <div class="chipselect" style="justify-content:center;margin-bottom:14px">
        <button class="${m === 'teren' ? 'active' : ''}" onclick="S.loginMode='teren';render()">👷 Pracovníci</button>
        <button class="${m === 'kanc' ? 'active' : ''}" onclick="S.loginMode='kanc';render()">🗂 Vedení / kancelář</button>
      </div>
      ${m === 'kanc' ? `
        <label>E-mail</label><input type="email" id="li-email" autocomplete="username">
        <label>Heslo</label><input type="password" id="li-pass" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">
        <div class="aprv"><button class="btn amber" style="width:100%;justify-content:center" onclick="doLogin()">Přihlásit</button></div>
      ` : S.loginWorker ? `
        <div class="urow" style="border:none"><span class="uav">${ini(S.loginWorker)}</span><b>${esc(fullName(S.loginWorker))}</b>
          <span class="lnk" style="margin-left:auto;font-size:12px" onclick="S.loginWorker=null;render()">změnit</span></div>
        <label>PIN</label><input type="password" id="li-pin" inputmode="numeric" placeholder="6 číslic" onkeydown="if(event.key==='Enter')doWorkerLogin()">
        <div class="aprv"><button class="btn amber" style="width:100%;justify-content:center" onclick="doWorkerLogin()">Přihlásit</button></div>
      ` : `
        ${(() => {
          const ulozeni = mojiLide().map(id => teren.find(r => r.id === id)).filter(Boolean);
          if (S.loginHledani === null || S.loginHledani === undefined) {
            if (!ulozeni.length && teren.length) { /* prvni pouziti zarizeni -> rovnou hledani */ }
            else if (ulozeni.length) return `
              <label>Kdo jsi?</label>
              <div class="rosterlist">${ulozeni.map(r => `
                <div class="urow" onclick="vyberCloveka('${r.id}')">
                  <span class="uav">${ini(r)}</span><b>${esc(fullName(r))}</b>
                  <span class="lnk" style="margin-left:auto;font-size:12px" onclick="event.stopPropagation();zapomenCloveka('${r.id}')" title="Odebrat z tohoto zařízení">✕</span></div>`).join('')}</div>
              <div class="aprv"><button class="btn ghost sm" onclick="S.loginHledani='';render()">➕ Přidat další osobu</button></div>`;
          }
          const q = (S.loginHledani || '').trim().toLowerCase();
          const shoda = q.length >= 2 ? teren.filter(r => ((r.prijmeni || '') + ' ' + (r.jmeno || '')).toLowerCase().includes(q)).slice(0, 6) : [];
          return `
            <label>Najdi se podle příjmení</label>
            <input type="text" id="li-hledat" placeholder="např. Novák" value="${esc(S.loginHledani || '')}"
                   oninput="S.loginHledani=this.value;render();setTimeout(()=>{const e=document.querySelector('#li-hledat');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length)}},0)">
            <div class="rosterlist">${shoda.map(r => `
              <div class="urow" onclick="vyberCloveka('${r.id}')">
                <span class="uav">${ini(r)}</span><b>${esc(fullName(r))}</b><span class="muted" style="margin-left:auto">${esc(r.popis || '')}</span></div>`).join('')
              || (q.length >= 2 ? '<div class="empty">Nikdo takový tu není.<br><span class="muted">Zkontroluj překlep, nebo ať tě vedení založí v sekci Uživatelé.</span></div>'
                                : '<div class="empty muted">Napiš aspoň 2 písmena.</div>')}</div>
            ${mojiLide().length ? `<div class="aprv"><button class="btn ghost sm" onclick="S.loginHledani=null;render()">← Zpět</button></div>` : ''}`;
        })()}
      `}
    `}
    ${S.loginMsg ? `<div class="lerr" style="display:block">${esc(S.loginMsg)}</div>` : ''}
    <div class="lerr" id="lerr"></div>
    ${jeNaPlose() ? '' : `<button class="instbox" onclick="pridatNaPlochu()">
      <span class="ic">📲</span>
      <span><b>Přidat Deník na plochu</b>
      <span>${S.installPrompt ? 'Jedno ťuknutí a máš ho jako aplikaci — bez hledání odkazu.'
        : JE_IOS ? 'Vznikne ikona jako u běžné aplikace. Ukážu ti jak.'
        : 'Ať ho nemusíš pokaždé hledat. Ukážu ti jak.'}</span></span>
    </button>`}
    <div class="ls" style="margin-top:14px;margin-bottom:0">${CFG.firmName} · verze ${VERZE}${S.online ? '' : ' · ⚠ offline'}</div>
    <div class="ls" style="margin-top:6px;margin-bottom:0"><span class="lnk" onclick="aktualizovatApp()">${S.updating ? '⏳ stahuji novou verzi…' : '⟳ Zkontrolovat aktualizaci'}</span></div>
  </div></div>`;
}
/* Firebase vraci kody; uzivateli je musime prelozit. Drive se vsechny chyby
   ukazovaly jako "Nesprávný PIN", takze nikdo nepoznal chybejici ucet od
   preklepu ani od vypadku site. */
function authErrText(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found')
    return 'Nesedí heslo/PIN — nebo účet ještě není dokončený. Ať ti vedení zkusí PIN nastavit znovu.';
  if (c === 'auth/too-many-requests') return 'Moc pokusů po sobě. Zkus to za pár minut, nebo si nech nastavit nový PIN.';
  if (c === 'auth/network-request-failed') return 'Nejsi připojený k internetu.';
  if (c === 'auth/user-disabled') return 'Účet je zablokovaný — ozvi se vedení.';
  if (c === 'auth/invalid-email') return 'Účet je poškozený (chybná adresa). Ať ti ho vedení založí znovu.';
  return 'Přihlášení se nepodařilo (' + (c || 'neznámá chyba') + ').';
}
function lerr(msg) { S.loginMsg = null; const e = $('#lerr'); if (e) { e.textContent = msg; e.style.display = 'block'; } }
async function doLogin() {
  try { await auth.signInWithEmailAndPassword($('#li-email').value.trim(), $('#li-pass').value); }
  catch (e) { lerr(authErrText(e)); }
}
async function doWorkerLogin() {
  const pin = $('#li-pin').value.trim();
  if (pin.length < 6) { lerr('PIN má aspoň 6 znaků.'); return; }
  if (!S.loginWorker.authEmail) { lerr('Účet nemá přihlašovací adresu — ať ti vedení vytvoří přihlášení znovu.'); return; }
  try { await auth.signInWithEmailAndPassword(S.loginWorker.authEmail, pin); }
  catch (e) { lerr(authErrText(e)); }
}
async function doSetup() {
  const name = $('#su-name').value.trim(), email = $('#su-email').value.trim(), pass = $('#su-pass').value;
  if (!name || !email || pass.length < 6) { lerr('Vyplň jméno, e-mail a heslo (min. 6 znaků).'); return; }
  S.bootstrapping = true;
  try {
    let cred;
    try {
      cred = await auth.createUserWithEmailAndPassword(email, pass);
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        // účet už existuje (např. z předchozího pokusu) — přihlásíme se a dokončíme založení
        cred = await auth.signInWithEmailAndPassword(email, pass);
      } else throw e;
    }
    const [jmeno, ...rest] = name.split(' ');
    // znovupoužij případný users doc z dřívějšího pokusu (a ukliď duplicity)
    // hleda se podle authEmail — kontaktni email uz v /users neni (S4)
    const dup = await db.collection('users').where('authEmail', '==', email).get();
    let udocId;
    if (dup.docs.length) {
      udocId = dup.docs[0].id;
      await db.collection('users').doc(udocId).update({ jmeno, prijmeni: rest.join(' '), authEmail: email, uid: cred.user.uid, active: true });
      for (const d of dup.docs.slice(1)) await d.ref.delete().catch(() => {});
    } else {
      const udoc = await db.collection('users').add({ jmeno, prijmeni: rest.join(' '), kod: '001', typ: { kanc: 1, teren: 1, inv: 0, sub: 0 }, role: 'Admin · vedení', active: true, authEmail: email, uid: cred.user.uid });
      udocId = udoc.id;
    }
    await db.collection('users_auth').doc(cred.user.uid).set({ role: 'admin', userDocId: udocId, name });
    /* Kontaktni e-mail patri do admin-only /kontakty (S4) — /users ctou
       vsechny role. Zapis az PO users_auth, aby uz platilo isAdmin(). */
    await db.collection('kontakty').doc(udocId).set({ email, tel: '' }).catch(() => {});
    /* Vedeni se do /roster NEZAPISUJE (B6). Roster je verejne citelny —
       potrebuje ho prihlasovaci obrazovka party — a nesl by tak
       prihlasovaci e-mail vedeni i priznak, ktery ucet je admin.
       Vedeni se prihlasuje e-mailem a heslem, ktere zada rucne,
       a prihlasovaci obrazovka adminy z rosteru stejne filtruje pryc. */
    await db.collection('config').doc('app').set({ setupDone: true, createdAt: FV(), version: 1 });
    toast('Systém založen ✓ Vítej!');
    S.bootstrapping = false;
    location.reload();
  } catch (e) {
    S.bootstrapping = false;
    lerr(e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
      ? 'Účet s tímto e-mailem už existuje, ale heslo nesedí. Zadej stejné heslo jako při prvním pokusu.'
      : 'Chyba: ' + e.message);
  }
}
async function odhlasitDotaz() {
  if (await potvrd('Odhlásit se?', 'Odhlásit')) doLogout();
}
async function smazVicepraci(id) {
  const v = S.viceprace.find(x => x.id === id); if (!v) return;
  const uInvestora = v.stav === 'u_investora';
  if (!await potvrd('Smazat vícepráci „' + v.title + '"?' +
    (uInvestora ? '\n\nPrávě čeká u investora — z jeho portálu zmizí a schválit ji už nepůjde.'
                : '\n\nZmizí i z portálu investora.') +
    '\n\nSmazání nejde vrátit zpět.', 'Smazat')) return;
  try {
    /* Kopie pro investora bydli v portals/{token}/vp/{id} — bez uklidu by mu
       na portale strasila navzdy vcetne tlacitka Schvalit. Vzor je v delEntry. */
    const tok = await tokenPortaluAsync(v.pid);
    if (tok) await db.collection('portals').doc(tok).collection('vp').doc(id).delete().catch(() => {});
    await db.collection('viceprace').doc(id).delete();
    toast('Vícepráce smazána ✓');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
/* Cesta zpet u vicepraci: co je u investora, jde stahnout (treba spatna cena);
   co investor zamitl, jde precenit a poslat znovu. Obojim se vraci stav na
   'navrh' a kopie MUSI zmizet z portalu — jinak by tam investorovi visela
   nabidka, ktera uz neplati, a mohl by ji porad odklikat. */
async function vpZpetKPreceneni(id) {
  const v = S.viceprace.find(x => x.id === id); if (!v) return;
  const uInvestora = v.stav === 'u_investora';
  if (!await potvrd(uInvestora
    ? 'Stáhnout „' + v.title + '" zpět k přecenění?\n\nInvestorovi zmizí z portálu a schválit ji už nepůjde. Až ji naceníš znovu, pošle se mu nová.'
    : 'Přecenit „' + v.title + '" a poslat znovu?\n\nVícepráce se vrátí mezi nenaceněné. Zapíšeš novou cenu a odešleš ji investorovi znovu.',
    uInvestora ? 'Stáhnout zpět' : 'Přecenit')) return;
  try {
    const tok = await tokenPortaluAsync(v.pid);
    if (tok) await db.collection('portals').doc(tok).collection('vp').doc(id).delete().catch(() => {});
    await db.collection('viceprace').doc(id).update({
      stav: 'navrh',
      podpis: firebase.firestore.FieldValue.delete(),
      resolvedAt: firebase.firestore.FieldValue.delete()
    });
    toast(uInvestora ? 'Staženo zpět — můžeš nacenit znovu ✓' : 'Vráceno k přecenění ✓');
    render();
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
function doLogout() { auth.signOut(); }

/* ============ ADMIN (Vedení) ============ */
function topbar() {
  return `<div class="topbar">
    <span class="logo">🏗 REKONSTRUKCE <em>VRÁNA</em> <span style="color:#8b98a5;font-weight:500">· Deník staveb</span></span>
    <span class="sp"></span>
    <span class="offdot ${S.online ? '' : 'off'}">${S.online ? '' : '⚠ OFFLINE — změny se uloží po připojení'}</span>
    ${S.uploading ? '<span class="badge b-wait">📤 nahrávám na Drive…</span>' : ''}
    ${S.frontaPocet ? `<span class="badge ${S.online ? 'b-wait' : 'b-int'}" title="Fotky a přílohy čekají, až bude signál. Neztratí se — appka je odešle sama.">🕓 ${S.frontaPocet} čeká na odeslání</span>` : ''}
    <button class="btn ghost sm" style="padding:6px 10px" title="Nahlásit chybu nebo navrhnout zlepšení" onclick="ticketDialog()">💬</button>
    <span class="muted" style="font-size:10.5px;white-space:nowrap" title="Verze aplikace">${VERZE}</span>
    <button class="btn ghost sm" title="Zkontrolovat a stáhnout novou verzi" onclick="aktualizovatApp()" style="padding:6px 10px">${S.updating ? '<span class="updspin"></span>' : '⟳'}</button>
    <div class="avatar" title="Odhlásit" onclick="odhlasitDotaz()">${S.me ? ini(S.me) : '?'}</div>
  </div>`;
}
function sidebar() {
  const n = pendingEntries().length;
  const gpsBad = S.attendance.filter(gpsPodezrela).length;
  const items = [
    { k: 'nastenka', ic: '📊', t: 'Nástěnka' },
    { k: 'projekty', ic: '🛠️', t: 'Projekty' },
    { k: 'denik', ic: '📓', t: 'Stavební deník' },
    { k: 'fotky', ic: '🖼', t: 'Fotky' },
    { k: 'schvaleni', ic: '✅', t: 'Schvalování', bdg: n || '' },
    { k: 'uzivatele', ic: '👥', t: 'Uživatelé' },
    { k: 'organizace', ic: '🏢', t: 'Organizace', bdg: gpsBad || '' },
    { k: 'ukoly', ic: '📌', t: 'Úkoly', bdg: S.tasks.filter(isOverdue).length || '' },
    { k: 'viceprace', ic: '🧾', t: 'Vícepráce', bdg: S.viceprace.filter(v => v.stav === 'navrh' || v.stav === 'u_investora').length || '' },
    { k: 'reporty', ic: '📈', t: 'Reporty' },
  ];
  const map = { projdetail: 'projekty', newuser: 'uzivatele', novy: 'denik' };
  const active = S.detail ? 'denik' : (map[S.view] || S.view);
  return `<div class="side">${items.map(i => `
    <div class="it ${active === i.k ? 'active' : ''}" onclick="goPage('${i.k}')">
      <span class="ic">${i.ic}</span>${i.t}${i.bdg ? `<span class="bdg">${i.bdg}</span>` : ''}
    </div>`).join('')}</div>`;
}
function goPage(k) { S.view = k; S.detail = null; render(); }
function viewAdmin() {
  let body = '';
  if (S.detail) body = pgDetail();
  else if (S.view === 'nastenka') body = pgNastenka();
  else if (S.view === 'projekty') body = pgProjekty();
  else if (S.view === 'projdetail') body = pgProjDetail();
  else if (S.view === 'fotky') body = pgFotky();
  else if (S.view === 'schvaleni') body = pgSchvaleni();
  else if (S.view === 'novy') body = pgNovy();
  else if (S.view === 'uzivatele') body = pgUzivatele();
  else if (S.view === 'newuser') body = pgNewUser();
  else if (S.view === 'organizace') body = pgOrganizace();
  else if (S.view === 'ukoly') body = pgUkoly();
  else if (S.view === 'viceprace') body = pgViceprace();
  else if (S.view === 'reporty') body = pgReporty();
  else body = pgDenik();
  return topbar() + `<div class="shell">${sidebar()}<div class="content">${body}</div></div>`;
}

/* ---- Nástěnka ---- */
function pgNastenka() {
  const nt = S.nastenkaTab;
  let body = nt === 'dochazka' ? nastenkaDochazka() : nt === 'ukoly' ? nastenkaUkoly() : nt === 'tickety' ? nastenkaTickety() : nastenkaPrehled();
  return `
  <div class="strip"><h1>Nástěnka</h1><span class="sp"></span><span class="muted">${fmtISOFull(isoToday())}</span></div>
  <div class="sectabs">
    <div class="t ${nt === 'prehled' ? 'active' : ''}" onclick="S.nastenkaTab='prehled';render()">📊 Přehled</div>
    <div class="t ${nt === 'dochazka' ? 'active' : ''}" onclick="S.nastenkaTab='dochazka';render()">⏱ Docházka</div>
    <div class="t ${nt === 'ukoly' ? 'active' : ''}" onclick="S.nastenkaTab='ukoly';render()">📌 Úkoly ${S.tasks.filter(isOverdue).length ? `<span class="badge b-red">${S.tasks.filter(isOverdue).length}</span>` : ''}</div>
    <div class="t ${nt === 'tickety' ? 'active' : ''}" onclick="S.nastenkaTab='tickety';render()">💬 Tickety ${S.tickety.filter(t => t.stav !== 'vyrizeno').length ? `<span class="badge b-red">${S.tickety.filter(t => t.stav !== 'vyrizeno').length}</span>` : ''}</div>
    <div class="t" onclick="goPage('viceprace')">🧾 Vícepráce ${S.viceprace.filter(v => v.stav === 'u_investora' || v.stav === 'navrh').length ? `<span class="badge b-wait">${S.viceprace.filter(v => v.stav === 'u_investora' || v.stav === 'navrh').length}</span>` : ''}</div>
  </div>${body}`;
}
function nastenkaPrehled() {
  const n = pendingEntries().length;
  const act = S.projects.filter(p => p.active);
  const noToday = act.filter(p => !entriesOf(p.id).some(e => e.date === isoToday()));
  const lastPhotos = S.entries.flatMap(e => (e.photos || []).map(ph => ({ ...ph, pn: (proj(e.pid) || {}).name }))).slice(0, 6);
  return `<main>
    <div class="stats">
      <div class="stat" onclick="goPage('schvaleni')"><span class="sic">⏳</span><span class="st2">Čeká na schválení</span><span class="sn ${n ? 'warn' : ''}">${n}</span></div>
      <div class="stat" onclick="goPage('denik')"><span class="sic">📓</span><span class="st2">Denní záznamy za 30 dní</span><span class="sn">${S.entries.length}</span></div>
      <div class="stat" onclick="goPage('projekty')"><span class="sic">🛠️</span><span class="st2">Aktivní projekty</span><span class="sn">${act.length}</span></div>
      <div class="stat"><span class="sic">⚠️</span><span class="st2">Dnes bez zápisu</span><span class="sn ${noToday.length ? 'warn' : ''}">${noToday.length}</span></div>
    </div>
    <div class="grid2">
      <div class="card">
        <h3>⚠️ Kontrola — aktivní projekty bez dnešního zápisu</h3>
        ${noToday.length ? noToday.map(p => `
          <div class="urow" style="cursor:pointer" onclick="S.adminFilter='${p.id}';goPage('denik')">
            <span style="color:var(--red)">🏗</span><b>${esc(p.name)}</b>
            <span class="muted" style="margin-left:auto">poslední: ${entriesOf(p.id)[0] ? fmtISO(entriesOf(p.id)[0].date) : '—'}</span>
          </div>`).join('') : '<div class="empty">Všechny projekty mají dnešní zápis ✓</div>'}
      </div>
      <div class="card">
        <h3>📷 Poslední média ze staveb</h3>
        ${lastPhotos.length ? `<div class="photos">${lastPhotos.map(ph => phTile(ph, false)).join('')}</div>` : '<div class="empty">Zatím žádné fotky.</div>'}
      </div>
    </div>
    <div class="card">
      <h3>📓 Poslední záznamy</h3>
      ${S.entries.slice(0, 5).map(e => { const p = proj(e.pid) || {}; return `
        <div class="urow" style="cursor:pointer" onclick="openDetail('${e.id}')">
          <span class="uav">${(e.author || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
          <div><b>${esc(p.name || '')}</b> — ${fmtISOFull(e.date)}<br><span class="muted">${esc(e.author)} · ${(e.works || []).length} položek</span></div>
          <span style="margin-left:auto">${sBadge(e.status)}</span>
        </div>`; }).join('') || '<div class="empty">Zatím žádné záznamy.</div>'}
    </div>
  </main>`;
}
function nastenkaDochazka() {
  const TOL = CFG.gpsTolerance || 100;
  const last = {};
  /* Jen prichod a odchod — pauza ma vlastni zaznamy a bez tohohle filtru
     by nastenka hlasila obedvajiciho jako "nepritomen" (stejny filtr
     pouziva mojeSmena i attOn). */
  S.attendance.filter(a => a.akce === 'Příchod' || a.akce === 'Odchod')
    .sort(attCmp).forEach(a => last[a.userDocId] = a);
  const inWork = Object.values(last).filter(a => a.akce === 'Příchod' && a.date === isoToday());
  const susp = S.attendance.filter(gpsPodezrela);
  const teren = S.users.filter(u => u.typ && u.typ.teren && !u.typ.kanc && u.active !== false);
  /* "Nepritomni" se drive pocitali odectenim dvou ruznych mnozin: pocet
     terennich minus pocet VSECH, kdo maji otevreny prichod (tedy i lidi,
     kteri v seznamu terennich vubec nejsou). Ted je to poctivy vycet:
     terenni minus ti, kdo jsou dnes v praci, minus ti, kterym visi smena
     z minuleho dne — ta ma vlastni stav, protoze to neni nepritomnost,
     ale zapomenuty odchod. */
  const dnesVPraci = new Set(inWork.map(a => a.userDocId));
  const visiIds = new Set(Object.values(last).filter(a => a.akce === 'Příchod' && a.date < isoToday()).map(a => a.userDocId));
  const visi = teren.filter(u => visiIds.has(u.id));
  const nepritomni = teren.filter(u => !dnesVPraci.has(u.id) && !visiIds.has(u.id));
  return `<main>
    <div class="stats">
      <div class="stat" style="cursor:default" title="Seznam je hned pod dlaždicemi."><span class="sic">💼</span><span class="st2">V práci teď</span><span class="sn">${inWork.length}</span></div>
      <div class="stat" style="cursor:default" title="Terénní pracovníci, kteří si dnes nepíchli příchod. Seznam je hned pod dlaždicemi."><span class="sic">🏠</span><span class="st2">Nepřítomní</span><span class="sn">${nepritomni.length}</span></div>
      <div class="stat" onclick="S.orgFilter='vse';goPage('organizace')" title="Někdo si píchnul příchod a už nepíchnul odchod. Do hodin se ten den nezapočítá."><span class="sic">🕗</span><span class="st2">Neuzavřená směna</span><span class="sn ${visi.length ? 'warn' : ''}">${visi.length}</span></div>
      <div class="stat" onclick="S.orgFilter='zadosti';goPage('organizace')"><span class="sic">⏳</span><span class="st2">Žádosti o doplnění</span><span class="sn ${cekajiciZadosti().length ? 'warn' : ''}">${cekajiciZadosti().length}</span></div>
      <div class="stat" onclick="S.orgFilter='gps';goPage('organizace')"><span class="sic">📍</span><span class="st2">Podezřelá GPS (&gt;${TOL} m)</span><span class="sn ${susp.length ? 'warn' : ''}">${susp.length}</span></div>
      <div class="stat" onclick="S.orgFilter='vse';goPage('organizace')"><span class="sic">🗂</span><span class="st2">Záznamů docházky</span><span class="sn">${S.attendance.length}</span></div>
    </div>
    <div class="card">
      <h3>💼 Stavy pracovníků — kdo je kde</h3>
      ${teren.map(u => { const a = last[u.id]; const ap = a ? proj(a.pid) : null;
        const on = !!a && a.akce === 'Příchod' && a.date === isoToday();
        const visiTomu = !!a && a.akce === 'Příchod' && a.date < isoToday(); return `
        <div class="urow"><span class="uav">${ini(u)}</span><b>${esc(fullName(u))}</b>
        ${on ? `<span class="badge b-ok">✓ v práci — ${esc((ap || {}).name || '')} (od ${a.time})</span>`
          : visiTomu ? `<span class="badge b-wait" title="Píchnul příchod a nepíchnul odchod. Den se do hodin nezapočítá, dokud se to nedoplní.">🕗 neuzavřená směna od ${fmtISO(a.date)} ${a.time}</span>`
          : `<span class="badge b-int">nepřítomen</span>`}
        <span class="muted" style="margin-left:auto">${a ? `poslední: ${a.akce} ${fmtISO(a.date)} ${a.time}${gpsPodezrela(a) ? ' <b style="color:var(--red)">⚠ GPS ' + Math.round(a.gps).toLocaleString('cs') + ' m</b>' : ''}` : 'žádný záznam'}</span></div>`; }).join('') || '<div class="empty">Žádní terénní pracovníci.</div>'}
      <div class="note">Podezřelé GPS odchylky (nad ${TOL} m) se hlásí rovnou tady — odbavit je jde v Organizaci tlačítkem ✓ Prověřeno. „Neuzavřená směna" znamená zapomenutý odchod, ne nepřítomnost.</div>
    </div>
  </main>`;
}
function nastenkaUkoly() {
  const od = S.tasks.filter(isOverdue);
  const ke = S.tasks.filter(t => t.stav === 'kontrola');
  return `<main>
    <div class="stats">
      <div class="stat" onclick="goPage('ukoly')"><span class="sic">📌</span><span class="st2">Všechny úkoly</span><span class="sn">${S.tasks.filter(t => t.stav !== 'sablona').length}</span></div>
      <div class="stat"><span class="sic">⏰</span><span class="st2">Po termínu</span><span class="sn ${od.length ? 'warn' : ''}">${od.length}</span></div>
      <div class="stat"><span class="sic">🔍</span><span class="st2">Ke kontrole</span><span class="sn">${ke.length}</span></div>
      <div class="stat"><span class="sic">✅</span><span class="st2">Hotovo</span><span class="sn">${S.tasks.filter(t => t.stav === 'hotovo').length}</span></div>
    </div>
    <div class="card">
      <h3>⏰ Úkoly po termínu — vyřešit hned</h3>
      ${od.length ? od.map(t => `
        <div class="urow"><span style="color:var(--red)">❗</span><div><b>${esc(t.title)}</b><br><span class="muted">${esc((proj(t.pid) || {}).name || '')} · ${esc(respName(t))} · termín ${fmtISO(t.term)} <b style="color:var(--red)">(${daysBetween(t.term, isoToday())} dní po termínu)</b></span></div>
        <span style="margin-left:auto;display:flex;gap:6px"><button class="btn ok sm" onclick="taskDone('${t.id}')">✓ Hotovo</button><button class="btn ghost sm" onclick="taskShift('${t.id}')">+3 dny</button></span></div>`).join('')
      : '<div class="empty">🎉 Žádné úkoly po termínu.</div>'}
    </div>
    <div class="card">
      <h3>🔍 Ke kontrole</h3>
      ${ke.length ? ke.map(t => `<div class="urow"><span>🔍</span><div><b>${esc(t.title)}</b><br><span class="muted">${esc((proj(t.pid) || {}).name || '')} · řeší ${esc((t.res || []).join(', '))}</span></div>
        <span style="margin-left:auto"><button class="btn ok sm" onclick="taskDone('${t.id}')">✓ Schválit hotové</button></span></div>`).join('') : '<div class="empty">Nic ke kontrole.</div>'}
    </div>
  </main>`;
}

/* ---- Projekty ---- */
function pgProjekty() {
  return `
  <div class="strip"><h1>Projekty</h1><span class="sp"></span><button class="btn amber" onclick="projectForm()">➕ PŘIDAT</button></div>
  <main>
    ${(() => {
      const skryte = stavbySkrytePart();
      if (!skryte.length) return '';
      const kolik = skryte.length === 1 ? '1 stavba je v realizaci, ale parta ji nevidí'
        : skryte.length < 5 ? skryte.length + ' stavby jsou v realizaci, ale parta je nevidí'
        : skryte.length + ' staveb je v realizaci, ale parta je nevidí';
      return `<div class="inote">
        <b>⚠ ${kolik}.</b> Nemůže si na ně píchnout docházku ani napsat zápis.
        ${skryte.map(x => `<div class="urow" style="border:0;padding:5px 0">
          <span>🏗</span><b>${esc(x.name)}</b>
          <span class="muted">${esc(x.cn || '')}</span>
          <button class="btn ghost sm" style="margin-left:auto" onclick="toggleActive('${x.id}')">👁 Zapnout partě</button>
        </div>`).join('')}
        ${skryte.length > 1 ? `<div class="aprv"><button class="btn amber sm" onclick="zapniVsemVidi()">👁 Zapnout u všech (${skryte.length})</button></div>` : ''}
      </div>`;
    })()}
    <div class="tablecard">
      <div style="overflow-x:auto"><table>
        <tr><th>Název stavby</th><th>Zodpovědný</th><th>Vidí parta</th><th>Stav</th><th>Zakázka</th><th>Investor</th><th>Adresa</th><th>Deník</th><th>Průběh</th></tr>
        ${S.projects.map(p => `
        <tr class="click" onclick="openProj('${p.id}')">
          <td><span class="lnk">${esc(p.name)}</span></td>
          <td class="muted">${esc(p.resp || '')}</td>
          <td onclick="event.stopPropagation();toggleActive('${p.id}')" title="Zapnuto = stavba je v seznamu, kde si parta píchá docházku"><span class="toggle ${p.active ? 'on' : ''}"><i></i></span></td>
          <td>${esc(p.stav || '')}</td>
          <td>${esc((p.cn || '').replace('CN', ''))}</td>
          <td>${esc(p.client || '')}</td>
          <td class="muted">${esc(p.address || '')}</td>
          <td onclick="event.stopPropagation();S.adminFilter='${p.id}';goPage('denik')"><span class="lnk">📓 otevřít</span></td>
          ${/* Prubeh se pocita z harmonogramu (projProgress). Bez harmonogramu ho nezname
              — ukazujeme „—", ne lzive 0 %. A tecka za procenty jen kdyz je i faze. */''}
          <td style="min-width:110px">${projProgress(p) != null ? `<div class="prog"><i style="width:${projProgress(p)}%"></i></div>` : ''}<span class="muted" style="font-size:11px">${projProgress(p) != null ? projProgress(p) + ' %' : '—'}${projPhase(p) ? ' · ' + esc(projPhase(p)) : ''}</span></td>
        </tr>`).join('')}
      </table></div>
      <div class="pagefoot"><span>${S.projects.length} projektů</span></div>
    </div>
  </main>`;
}
async function toggleActive(pid) { const p = proj(pid); await db.collection('projects').doc(pid).update({ active: !p.active }); }
/* Stavba v realizaci, kterou parta nevidi, nebyla nikde videt. Devet
   z dvanacti staveb melo „Vidi parta" vypnute — parta si na ne nemohla
   pichnout ani napsat zapis a vedeni o tom nevedelo. */
function stavbySkrytePart() {
  return S.projects.filter(x => (x.stav || '') === 'Realizace' && !x.active);
}
async function zapniVsemVidi() {
  const skryte = stavbySkrytePart();
  if (!skryte.length) return;
  if (!await potvrd('Zapnout „Vidí parta" u ' + skryte.length + ' staveb v realizaci?\n\n' +
    skryte.map(x => '· ' + x.name).join('\n') + '\n\nObjeví se partě v seznamu, kde si píchá docházku a zakládá zápisy.', 'Ano, zapnout')) return;
  for (const x of skryte) await db.collection('projects').doc(x.id).update({ active: true }).catch(() => {});
  toast('Hotovo ✓ — parta stavby vidí');
}
function openProj(id) { S.projDetailId = id; S.projDetailTab = 'info'; S.view = 'projdetail'; render(); }
function projectForm(id) {
  const p = id ? proj(id) : {};
  S.geoHits = []; S.geoLabel = null;
  modal(`<h3>${id ? '✏️ Upravit projekt' : '➕ Nový projekt'}</h3>
      <div><label>Číslo zakázky (CN)</label>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input type="text" id="pf-cn" value="${esc(p.cn || '')}" placeholder="CN20260055"
               onkeydown="if(event.key==='Enter'){event.preventDefault();nacistZakazku();}">
        <button class="btn dark" style="flex:none;white-space:nowrap" onclick="nacistZakazku()">🔎 Načíst z disku</button>
      </div>
      <div class="note" id="pf-cnstav" style="display:none"></div></div>
    <label>Název stavby *</label><input type="text" id="pf-name" value="${esc(p.name || '')}" placeholder="Novodvorská - Pecka">
    <label>Investor</label><input type="text" id="pf-client" value="${esc(p.client || '')}">
    <div class="frow">
      ${/* S4b: kontakty klienta se ctou z admin-only /kontakty, ne ze stavby */''}
      <div><label>E-mail investora</label><input type="email" id="pf-cmail" value="${esc(kontaktStavby(p.id || '').email || '')}"></div>
      <div><label>Telefon investora</label><input type="tel" id="pf-cphone" value="${esc(kontaktStavby(p.id || '').tel || '')}" placeholder="602 285 581"></div>
    </div>
    <label>Adresa realizace</label>
    <div style="display:flex;gap:8px;align-items:stretch">
      <input type="text" id="pf-addr" value="${esc(p.address || '')}" placeholder="Novodvorská 413/135, Praha 4"
             onkeydown="if(event.key==='Enter'){event.preventDefault();geocodeAddress();}">
      <button class="btn dark" style="flex:none" onclick="geocodeAddress()">📍 Najít</button>
    </div>
    <div id="pf-geohits" style="display:none"></div>
    <div class="note" id="pf-geoinfo" style="display:none"></div>
    <label>Typ projektu</label><input type="text" id="pf-type" value="${esc(p.type || '')}" placeholder="Kompletní rekonstrukce · 3+kk panelák">
    <div class="frow">
      <div><label>Zodpovědný</label><input type="text" id="pf-resp" value="${esc(p.resp || 'Zdeno Balúch')}"></div>
      <div><label>Stav projektu</label><select id="pf-stav">${
        /* "Nabidka" tu byla, ale zakazka ve fazi nabidky jeste neni stavba a do
           deniku nepatri. Kdyby ji nekterá stará zakázka mela zapsanou, necháme
           ji ve výběru — jinak by se pri ulozeni tise prepsala na "Realizace". */
        ['Realizace', 'Příprava', 'Dokončeno'].concat(
          p.stav && ['Realizace', 'Příprava', 'Dokončeno'].indexOf(p.stav) < 0 ? [p.stav] : []
        ).map(s => `<option ${p.stav === s ? 'selected' : ''}>${esc(s)}</option>`).join('')
      }</select></div>
    </div>
    ${/* Rucni pole „Prubeh (%)" je pryc — mely jsme dva zdroje pravdy (rucni cislo
        vs. vypocet z milniku) a prepisovaly se navzajem. Ted plati jen harmonogram.
        Faze jde rucne jen dokud stavba nema milniky; pak ji urcuje harmonogram. */''}
    ${id ? `<div class="frow">
      <div><label>Fáze</label><input type="text" id="pf-phase" value="${esc(p.phase || '')}" placeholder="Hrubé rozvody"${(p.milestones || []).length ? ' disabled' : ''}></div>
    </div>
    <div class="note">Průběh (%) se počítá automaticky z harmonogramu — postup nastavíš u milníků v detailu projektu.${(p.milestones || []).length ? ' Fázi teď určuje harmonogram (první nedokončený milník).' : ''}</div>` : ''}
    <div class="frow">
      <div><label>GPS lat</label><input type="text" id="pf-lat" value="${p.gps ? p.gps.lat : ''}" placeholder="50.0236914" oninput="mapFromInputs()"></div>
      <div><label>GPS lng</label><input type="text" id="pf-lng" value="${p.gps ? p.gps.lng : ''}" placeholder="14.4368684" oninput="mapFromInputs()"></div>
    </div>
    <div class="mapreal" id="pf-mapwrap" data-map="form" data-drag="1"
         data-lat="${p.gps ? p.gps.lat : ''}" data-lng="${p.gps ? p.gps.lng : ''}"
         style="${p.gps ? '' : 'display:none'}"></div>
    <div class="note" id="pf-maphint" style="${p.gps ? '' : 'display:none'}">
      Špendlík přetáhni přesně tam, kde se parta hlásí. Proti tomuhle bodu se ověřuje check-in (povolená odchylka ${CFG.gpsTolerance || 100} m).
    </div>
    <label>Složka zakázky na Drive</label>
    <div style="display:flex;gap:8px;align-items:stretch">
      <input type="text" id="pf-drive" value="${esc(p.driveFolderId || '')}" placeholder="najdi tlačítkem podle čísla zakázky">
      <button class="btn dark" style="flex:none" onclick="najdiDriveSlozku()">🔍 Najít</button>
    </div>
    <div class="note" id="pf-drivestav" style="display:none"></div>
    <div class="muted" style="font-size:11.5px;margin-top:4px">Sem chodí fotky, přílohy i docházka — do podsložky <b>09_Denik_staveb</b>. Když zůstane prázdné, most si založí vlastní složku vedle té tvojí.</div>
    <label>Plán předání</label><input type="text" id="pf-hand" value="${esc(p.handover || '')}" placeholder="plán předání 24. 7. 2026">
    <div class="aprv"><button class="btn amber" onclick="saveProject('${id || ''}')">💾 Uložit</button><button class="btn ghost" onclick="closeModal()">Zrušit</button></div>`);
}
/* Slozka zakazky na Drive se hleda podle CN — nazvy slozek zacinaji cislem
   zakazky (CN20260053_Sasek_Machuldova), takze staci porovnat zacatek.
   Dokud je pole prazdne, most si zaklada vlastni slozku "..._SYSTEM" vedle
   te skutecne, coz je presne to, cemu se chceme vyhnout. */
function driveStav(text, barva) {
  const el = $('#pf-drivestav');
  if (el) { el.innerHTML = text; el.style.display = text ? '' : 'none'; el.style.color = barva || ''; }
}
async function najdiDriveSlozku(tiche) {
  const cn = ($('#pf-cn') ? $('#pf-cn').value : '').trim();
  if (!cn) { if (!tiche) toast('Nejdřív vyplň číslo zakázky (CN)'); return false; }
  if (!CFG.scriptUrl) { if (!tiche) toast('Drive most není nastavený'); return false; }
  if (!S.online) { if (!tiche) toast('Hledání potřebuje internet'); return false; }
  driveStav('<span class="spin"></span> Hledám složku na Drive…');
  try {
    const j = await driveCall({ action: 'findFolder', cn, rootId: CFG.driveRootFolderId });
    const nalezene = j.folders || [];
    if (nalezene.length === 1) {
      $('#pf-drive').value = nalezene[0].id;
      driveStav('✅ Nalezeno: <b>' + esc(nalezene[0].name) + '</b>', 'var(--ok)');
      return true;
    }
    if (nalezene.length === 0) {
      if (tiche) { driveStav('⚠ Složka pro ' + esc(cn) + ' na Drive není — soubory půjdou do náhradní složky.', 'var(--wait)'); return false; }
      const navrh = cn + '_' + (($('#pf-client').value || '').trim().split(/\s+/).pop() || 'zakazka');
      const jmeno = await zeptejSe('Založit složku na Drive', 'Složka pro ' + cn + ' na Drive neexistuje. Uprav název, nebo zruš.', navrh);
      if (!jmeno) { driveStav('Složka nenalezena — pole zůstalo prázdné.', 'var(--wait)'); return false; }
      const k = await driveCall({ action: 'createFolder', name: jmeno, rootId: CFG.driveRootFolderId });
      if (k.id) { $('#pf-drive').value = k.id; driveStav('✅ Založeno: <b>' + esc(k.name) + '</b>', 'var(--ok)'); return true; }
      driveStav('Založení se nepovedlo: ' + esc(k.error || '?'), 'var(--red)'); return false;
    }
    // vic shod -> at vybere clovek
    driveStav('Našel jsem ' + nalezene.length + ' složek — vyber:', '');
    modal(`<h3>📁 Která složka to je?</h3>
      <div class="note" style="margin-top:0">Číslu <b>${esc(cn)}</b> odpovídá víc složek.</div>
      <div class="rosterlist">${nalezene.map(f => `
        <div class="urow" onclick="vyberDriveSlozku('${f.id}','${esc(f.name).replace(/'/g, "&#39;")}')">
          <span>📁</span><b>${esc(f.name)}</b></div>`).join('')}</div>
      <div class="aprv"><button class="btn ghost" onclick="closeModal()">Zrušit</button></div>`);
    return false;
  } catch (e) {
    driveStav('Hledání se nepovedlo: ' + esc(e.message || ''), 'var(--red)');
    return false;
  }
}
function vyberDriveSlozku(id, jmeno) {
  closeModal();
  if ($('#pf-drive')) $('#pf-drive').value = id;
  driveStav('✅ Vybráno: <b>' + esc(jmeno) + '</b>', 'var(--ok)');
}

/* Precte, co jde, ze slozky zakazky na Drive — hlavne ze smlouvy.
   Zamerne prepisuje jen PRAZDNA policka: co uzivatel napsal rukou, ma prednost.
   Co se nenajde, zustane prazdne; zalozeni zakazky to nikdy nezablokuje. */
async function nacistZakazku() {
  const cn = ($('#pf-cn') ? $('#pf-cn').value : '').trim();
  const st = $('#pf-cnstav');
  const hlas = (html, barva) => { if (st) { st.innerHTML = html; st.style.display = ''; st.style.color = barva || ''; } };
  if (!cn) { toast('Nejdřív vyplň číslo zakázky (CN)'); return; }
  if (!CFG.scriptUrl) { toast('Drive most není nastavený'); return; }
  if (!S.online) { toast('Načítání potřebuje internet'); return; }

  /* Kdyz uz stavba svou slozku zna, ctem PRIMO z ni a nehledame podle cisla
     zakazky. Hledani podle cisla je krehke: staci, aby v 01_Aktivni_zakazky
     lezely dve slozky zacinajici stejnym CN (treba prazdny duplikat), a most
     sahne po te spatne — vratil by „nalezeno", ale bez jedineho dokumentu. */
  const znamaSlozka = ($('#pf-drive') ? $('#pf-drive').value : '').trim();
  hlas('<span class="spin"></span> ' + (znamaSlozka ? 'Čtu složku zakázky…' : 'Hledám na Disku…'));
  let j;
  try { j = await driveCall({ action: 'readProject', cn, folderId: znamaSlozka, rootId: CFG.driveRootFolderId }); }
  catch (e) { hlas('Načtení se nepovedlo: ' + esc(e.message || ''), 'var(--red)'); return; }

  if (!j.nalezeno) { hlas('⚠ ' + esc(j.duvod || 'Složka nenalezena.'), 'var(--wait)'); return; }

  const mapa = [
    ['#pf-drive',  j.folderId,  'složka na Drive'],
    ['#pf-client', j.klient,    'investor'],
    ['#pf-cmail',  j.email,     'e-mail investora'],
    ['#pf-cphone', j.telefon,   'telefon investora'],
    ['#pf-addr',   j.adresa,    'adresa realizace'],
    ['#pf-type',   j.typ,       'typ projektu'],
    ['#pf-hand',   j.dokonceni, 'plán předání']
  ];
  const doplneno = [], preskoceno = [];
  mapa.forEach(([sel, hodnota, popis]) => {
    const el = $(sel);
    if (!el || !hodnota) return;
    if (el.value.trim()) { if (el.value.trim() !== String(hodnota)) preskoceno.push(popis); return; }
    el.value = hodnota; doplneno.push(popis);
  });

  // nazev stavby poskladame z ulice a prijmeni — stejny tvar jako u ostatnich staveb
  const nm = $('#pf-name');
  if (nm && !nm.value.trim() && j.adresa && j.klient) {
    const ulice = String(j.adresa).split(/[\s,]/)[0];
    const prijmeni = String(j.klient).split(' a ')[0].trim().split(/\s+/).pop();
    if (ulice && prijmeni) { nm.value = ulice + ' - ' + prijmeni; doplneno.push('název stavby'); }
  }

  const chybi = [
    !j.klient && 'investor', !j.email && 'e-mail investora',
    !j.adresa && 'adresa', !j.dokonceni && 'termín dokončení'
  ].filter(Boolean);

  let zprava = '✅ Načteno z: <b>' + esc((j.zdroje || []).join(' + ') || 'složky') + '</b>';
  if (doplneno.length) zprava += '<br>Doplněno: ' + esc(doplneno.join(', '));
  if (preskoceno.length) zprava += '<br><span style="color:var(--wait)">Nepřepsáno (máš tam své): ' + esc(preskoceno.join(', ')) + '</span>';
  if (chybi.length) zprava += '<br><span style="color:var(--wait)">Nenašel jsem: ' + esc(chybi.join(', ')) + ' — doplň ručně</span>';
  if (j.cena) zprava += '<br><span class="muted">Cena díla dle smlouvy: ' + esc(j.cena) + '</span>';
  if (j.zahajeni) zprava += '<br><span class="muted">Předání staveniště: ' + esc(j.zahajeni) + '</span>';
  hlas(zprava, 'var(--ok)');

  if ($('#pf-addr') && $('#pf-addr').value.trim() && !$('#pf-lat').value.trim()) geocodeAddress();
}
async function saveProject(id) {
  const name = $('#pf-name').value.trim();
  if (!name) { toast('Vyplň název stavby'); return; }
  // novy projekt bez slozky -> zkusit ji najit potichu, at to uzivatel nemusi resit
  if (!id && !$('#pf-drive').value.trim() && ($('#pf-cn').value || '').trim()) {
    await najdiDriveSlozku(true);
  }
  const lat = gpsCislo($('#pf-lat').value), lng = gpsCislo($('#pf-lng').value);
  const prevGps = id ? ((proj(id) || {}).gps || null) : null;
  /* Prazdna GPS je v poradku (stavba bez check-inu). Vyplnena, ale mimo
     Cesko, uz ne — to je vzdycky preklep nebo prohozene pole. */
  const gpsVyplnena = ($('#pf-lat').value || '').trim() !== '' || ($('#pf-lng').value || '').trim() !== '';
  if (gpsVyplnena && !gpsVCesku(lat, lng)) {
    toast('GPS je mimo Česko — zkontroluj souřadnice (šířka 48–52, délka 12–19)');
    return;
  }
  const data = {
    name, cn: $('#pf-cn').value.trim(), client: $('#pf-client').value.trim(),
    address: $('#pf-addr').value.trim(), type: $('#pf-type').value.trim(),
    resp: $('#pf-resp').value.trim(), stav: $('#pf-stav').value,
    /* Faze se pri zalozeni nezadava — u stavby, ktera jeste nezacala, nema co
       rikat. Prubeh (%) se rucne neuklada vubec: pocita se vyhradne
       z harmonogramu (msRecalc) a zapisuji ho jen funkce milniku. */
    phase: $('#pf-phase') ? $('#pf-phase').value.trim() : '',
    /* Popisek: S.geoLabel === '' znamena „uzivatel spendlik pretahl nebo
       souradnice prepsal rucne" — starou adresu tam nechat NESMIME, lhala by.
       null znamena „v tomhle formulari se s GPS nehnulo" -> drzime puvodni. */
    gps: gpsVCesku(lat, lng) ? { lat, lng, tol: CFG.gpsTolerance || 100, label: (S.geoLabel != null ? S.geoLabel : ((prevGps && prevGps.label) || '')) } : null,
    driveFolderId: $('#pf-drive').value.trim(), handover: $('#pf-hand').value.trim()
  };
  // Kdyz uz stavba ma harmonogram, fazi urcuje on — rucni text z formulare
  // by se pri pristi zmene milniku stejne prepsal, tak at nemate uzivatele.
  if (id) {
    const prev = proj(id) || {};
    if ((prev.milestones || []).length) data.phase = msRecalc(prev.milestones, prev).phase;
  }
  /* S4b: kontakt na klienta se cte z formulare DRIV nez se ulozi stavba —
     zapis spusti posluchace a ten formular prekresli, takze by se hodnoty
     ztratily. (Stejna past uz jednou sebrala sazby v karte uzivatele.) */
  const kMail = ($('#pf-cmail') ? $('#pf-cmail').value : '').trim();
  const kTel = ($('#pf-cphone') ? $('#pf-cphone').value : '').trim();

  /* Stav stavby a prepinac „Vidi parta" doted zily kazdy zvlast: stavbu slo
     oznacit za dokoncenou a parta si na ni pichala dal. Ptame se az po
     zapisu, takze puvodni hodnoty si musime sebrat TED. */
  const drivStav = id ? ((proj(id) || {}).stav || '') : '';
  const drivVidi = id ? !!(proj(id) || {}).active : false;

  let pid = id;
  if (id) await db.collection('projects').doc(id).update(data);
  else { const ref = await db.collection('projects').add({ ...data, active: true, milestones: [], createdAt: FV() }); pid = ref.id; }

  /* Kontakt na klienta NEPATRI na stavbu — /projects cte cela parta i externi
     subdodavatele a databaze vydava vzdy cely dokument. Uklada se proto do
     admin-only /kontakty; prazdny formular zaznam uklidi. */
  if (pid) {
    if (kMail || kTel) await db.collection('kontakty').doc(kontaktKlicStavby(pid)).set({ email: kMail, tel: kTel }).catch(() => {});
    else await db.collection('kontakty').doc(kontaktKlicStavby(pid)).delete().catch(() => {});
  }
  /* Portal investora dorovnat HNED. Casovac to jinak stihne az za minutu
     a jen dokud ma vedeni appku otevrenou — adresa, jmeno investora, typ
     a plan predani by se k nemu jinak dostaly klidne az druhy den. */
  if (pid) syncPortalHeader({ ...(proj(pid) || {}), ...data, id: pid }).catch(() => {});
  /* Dokonceno + „Vidi parta" uz nezijou kazdy zvlast. Nic se nerusi
     natvrdo — jen se zeptame. */
  if (id && data.stav === 'Dokončeno' && drivStav !== 'Dokončeno' && drivVidi) {
    if (await potvrd('Stavba „' + name + '" je teď označená jako Dokončeno.\n\n' +
      'Má ji parta přestat vidět? Zmizí ze seznamu, kde si píchá docházku a zakládá zápisy — hotové záznamy a deník zůstanou.\n\n' +
      'Kdykoli ji vrátíš přepínačem „Vidí parta" v seznamu Projekty.', 'Ano, schovat partě')) {
      await db.collection('projects').doc(id).update({ active: false }).catch(() => {});
    }
  }
  closeModal(); toast('Projekt uložen ✓');
}

/* ---- Detail projektu ---- */
function pgProjDetail() {
  const p = proj(S.projDetailId);
  if (!p) return '<main><div class="empty">Projekt nenalezen.</div></main>';
  const t = S.projDetailTab;
  let body = '';
  if (t === 'info') {
    const _tok = tokenPortalu(p.id); // token bydli v admin-only /portaly (S2)
    const portalUrl = _tok ? location.origin + location.pathname + '?p=' + _tok : null;
    body = `<main><div class="grid2">
      <div class="card">
        <h3>ℹ️ Základní informace</h3>
        <div class="kv"><span>Název</span><b>${esc(p.name)}</b></div>
        <div class="kv"><span>Zakázka</span><b>${esc(p.cn)}</b></div>
        ${(() => { const k = kontaktStavby(p.id); return `
        <div class="kv"><span>Investor</span><span>${esc(p.client)}${k.email ? ' · ' + esc(k.email) : ''}${k.tel ? ' · <a href="tel:' + esc(String(k.tel).replace(/\s/g, '')) + '">' + esc(k.tel) + '</a>' : ''}</span></div>`; })()}
        <div class="kv"><span>Adresa</span><span>${esc(p.address)}</span></div>
        <div class="kv"><span>Typ</span><span>${esc(p.type || '—')}</span></div>
        <div class="kv"><span>Stav</span><span>${esc(p.stav)}${projPhase(p) ? ' · ' + esc(projPhase(p)) : ''} · ${projProgress(p) != null ? projProgress(p) + ' %' : 'harmonogram nezadán'}</span></div>
        <div class="kv"><span>Drive složka</span><span>${p.driveFolderId ? `<a href="https://drive.google.com/drive/folders/${p.driveFolderId}" target="_blank">📁 otevřít</a>` : '<span class="muted">vytvoří se s první fotkou</span>'}</span></div>
        <div class="aprv"><button class="btn amber" onclick="projectForm('${p.id}')">✏️ Upravit</button>
          <button class="btn ghost" onclick="delProject('${p.id}')">🗑 Smazat stavbu</button></div>
      </div>
      ${sekceKliceProjektu(p)}
      ${kartaPodklady(p)}
      <div class="card">
        <h3>📍 Pozice projektu (GPS check-in)</h3>
        ${p.gps ? `
          <div class="mapreal" data-map="det" data-drag="0" data-lat="${p.gps.lat}" data-lng="${p.gps.lng}"></div>
          <div class="kv" style="margin-top:10px"><span>${esc(p.address || '—')}</span>
            <span class="muted">${p.gps.lat}, ${p.gps.lng} · ±${p.gps.tol || 100} m</span></div>
          ${p.gps.label ? `<div class="note" style="margin-top:4px">📍 Špendlík nastaven podle: ${esc(p.gps.label)}</div>` : ''}
          <div class="aprv">
            <a class="btn ghost sm" target="_blank" href="https://mapy.cz/zakladni?q=${p.gps.lat}%2C${p.gps.lng}">🗺 Mapy.cz</a>
            <a class="btn ghost sm" target="_blank" href="https://www.google.com/maps?q=${p.gps.lat},${p.gps.lng}">🗺 Google Maps</a>
            <button class="btn ghost sm" onclick="gpsFromHere('${p.id}')">◎ Nastavit podle mojí polohy</button>
          </div>`
        : `<div class="mapbox"><span class="pin">📍</span><b>${esc(p.address || 'bez adresy')}</b>
             <span>⚠ GPS není nastavena — check-in nebude ověřovat polohu</span></div>
           <div class="aprv">
             <button class="btn amber sm" onclick="projectForm('${p.id}')">✏️ Doplnit adresu a najít na mapě</button>
             <button class="btn ghost sm" onclick="gpsFromHere('${p.id}')">◎ Nastavit podle mojí polohy</button>
           </div>`}
      </div>
      <div class="card">
        <h3>🏠 Portál investora</h3>
        ${portalUrl ? `
          <div class="note" style="word-break:break-all">🔗 <b>${portalUrl}</b></div>
          <div class="aprv">
            <button class="btn amber sm" onclick="navigator.clipboard.writeText('${portalUrl}').then(()=>toast('Odkaz zkopírován ✓'))">📋 Kopírovat odkaz</button>
            <button class="btn ghost sm" onclick="window.open('${portalUrl}','_blank')">👁 Náhled portálu</button>
          </div>
          <div class="note">Investor vidí jen schválené zápisy a fotky (#31). Odkaz mu pošli e-mailem — bez instalace a hesla.</div>
          <div class="aprv">
            <button class="btn ghost sm" onclick="novyPortal('${p.id}')">🔄 Vydat nový odkaz</button>
            <button class="btn ghost sm" onclick="zrusPortal('${p.id}')">🗑 Zrušit portál</button>
          </div>
          <div class="note">Zrušením odkaz okamžitě přestane fungovat — na to sáhni, když se s investorem rozejdete. Nový odkaz starý zneplatní.</div>`
        : `<div class="empty">Portál zatím není vytvořen.</div>
          <div class="aprv"><button class="btn amber" onclick="createPortal('${p.id}')">🔗 Vytvořit portál investora</button></div>`}
      </div>
      <div class="card">
        <h3>📅 Harmonogram — milníky</h3>
        ${/* Milnik ma postup 0–100 % (milePct). Tlacitka 0/25/50/75/100 jsou na
            telefonu rychlejsi nez posuvnik (zadny jemny tah prstem, jeden tuk).
            Kolecko odskrtava hotovo (100 %) / vraci na 0 %. */''}
        ${(p.milestones || []).map((m, i) => { const pct = milePct(m); const cls = pct === 100 ? 'done' : pct > 0 ? 'now' : 'next'; return `
          <div class="mile ${cls}"><div class="dot" style="cursor:pointer" title="Odškrtnout hotovo / vrátit" onclick="setMilePct('${p.id}',${i},${pct === 100 ? 0 : 100})">${pct === 100 ? '✓' : pct > 0 ? '●' : ''}</div>
          <div style="flex:1">
            <div style="cursor:pointer" title="Ťukni pro přejmenování" onclick="prejmenujMile('${p.id}',${i})">${cls === 'now' ? '<b>' + esc(m.t) + ' — probíhá</b>' : esc(m.t)}${m.dur ? ' <span class="muted" style="font-size:11px">(' + esc(m.dur) + ')</span>' : ''}</div>
            <div style="display:flex;gap:5px;align-items:center;margin-top:5px;flex-wrap:wrap">
              ${[0, 25, 50, 75, 100].map(v => `<button onclick="setMilePct('${p.id}',${i},${v})" style="width:40px;padding:4px 0;border:1px solid var(--line);border-radius:7px;cursor:pointer;font-size:12px;${v === pct ? 'background:var(--amber);font-weight:700' : 'background:var(--int-soft)'}">${v}</button>`).join('')}
              <span class="muted" style="font-size:11px">${pct} %</span>
            </div>
          </div>
          <span class="lnk" style="font-size:11px" onclick="delMile('${p.id}',${i})">✕</span></div>`; }).join('') || '<div class="empty">Zatím žádné milníky.</div>'}
        <div class="aprv"><input type="text" id="mile-t" placeholder="Nový milník…" style="max-width:260px"><button class="btn ghost sm" onclick="addMile('${p.id}')">➕ Přidat</button></div>
        <div class="note">Postup milníku nastavíš tlačítky, kolečko odškrtne hotovo. Průběh stavby (%) je průměr milníků a fáze = první nedokončený milník. Milníky vidí investor na portálu.</div>
      </div>
    </div></main>`;
  } else if (t === 'media') {
    /* Stara zalozka "Média" (plochy seznam malych dlazdic) je NAHRAZENA
       galerii — ukazovala stejna data, jen hur: bez filtru, bez listovani
       a bez moznosti dohlednout dal nez mesic. Vsechno, co umela (otevreni
       fotky, prepinani stavu ⏳→✓→🔒), umi galerie taky. */
    body = `<main>${fgTelo(p.id)}</main>`;
  } else if (t === 'podklady') {
    const docs = p.stavbaDocs || [];
    body = `<main><div class="card">
      <h3>📐 Podklady stavby <span class="muted" style="font-weight:400">— půdorysy, vizualizace, výkresy · vidí je i parta v mobilu</span></h3>
      ${docs.map((d, i) => `<div class="urow" style="cursor:pointer" onclick="openDriveDoc('${d.driveId}','${esc(d.name)}')"><span>${(d.mime || '').includes('pdf') ? '📄' : '🖼'}</span><b>${esc(d.name)}</b><span class="muted" style="margin-left:auto">zobrazit</span><span class="lnk" style="font-size:11px;margin-left:10px" onclick="event.stopPropagation();delStavbaDoc('${p.id}',${i})">✕</span></div>`).join('') || '<div class="empty">Zatím žádné podklady.</div>'}
      <div class="formsec"><h4>➕ Nahrát soubor (PDF půdorys, vizualizace…)</h4>
        <input type="file" id="sd-file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple onchange="uploadStavbaDocs('${p.id}',this.files)">
        <div class="note">${S.uploading ? '<b>Nahrávám…</b> ' : ''}Soubor se uloží do složky zakázky na Drive. Partě se zobrazí přímo v apce ve vestavěném prohlížeči (#36) — listování a zoom, bez stahování, i na telefonu.</div>
      </div>
      <div class="formsec"><h4>Nebo přidej soubor, který už na Drive je</h4>
        <div class="frow">
          <div><label>Název</label><input type="text" id="sd-title" placeholder="Půdorys 1. NP"></div>
          <div><label>Drive ID nebo odkaz</label><input type="text" id="sd-id" placeholder="https://drive.google.com/file/d/…"></div>
        </div>
        <div class="aprv"><button class="btn amber sm" onclick="addStavbaDocLink('${p.id}')">💾 Přidat</button></div>
      </div>
    </div></main>`;
  } else if (t === 'ukoly') {
    const tk = S.tasks.filter(x => x.pid === p.id && x.stav !== 'sablona');
    body = `<main><div class="card">
      <h3>📌 Úkoly na projektu (${tk.length})</h3>
      ${tk.map(x => `<div class="urow"><span>${x.stav === 'hotovo' ? '✅' : isOverdue(x) ? '❗' : '📌'}</span><div><b>${esc(x.title)}</b><br><span class="muted">${esc(respName(x))} · termín ${fmtISO(x.term)}</span></div>
        <span style="margin-left:auto"><span class="badge ${STAVCOLOR[x.stav]}">${STAVY[x.stav]}</span></span></div>`).join('') || '<div class="empty">Žádné úkoly.</div>'}
      <div class="aprv"><button class="btn amber sm" onclick="S.taskFormOpen=true;goPage('ukoly')">➕ Přidat úkol</button></div>
    </div></main>`;
  } else if (t === 'poznamky') {
    body = `<main>${kartaPoznamky(p)}</main>`;
  } else if (t === 'dokumenty') {
    body = pgProjDocs(p);
  }
  return `
  <div class="strip"><span class="back" onclick="goPage('projekty')">←</span><h1>${esc(p.name)}</h1><span class="sp"></span></div>
  <div class="sectabs">
    <div class="t ${t === 'info' ? 'active' : ''}" onclick="S.projDetailTab='info';render()">ℹ️ Základní informace</div>
    <div class="t ${t === 'media' ? 'active' : ''}" onclick="S.projDetailTab='media';render()">🖼 Fotky</div>
    <div class="t ${t === 'podklady' ? 'active' : ''}" onclick="S.projDetailTab='podklady';render()">📐 Podklady stavby (${(p.stavbaDocs || []).length})</div>
    <div class="t ${t === 'dokumenty' ? 'active' : ''}" onclick="S.projDetailTab='dokumenty';render()">📁 Dokumenty pro investora</div>
    <div class="t ${t === 'ukoly' ? 'active' : ''}" onclick="S.projDetailTab='ukoly';render()">📌 Úkoly (${S.tasks.filter(x => x.pid === p.id && x.stav !== 'hotovo' && x.stav !== 'sablona').length})</div>
    <div class="t ${t === 'poznamky' ? 'active' : ''}" onclick="S.projDetailTab='poznamky';render()">📝 Poznámky (${S.poznamky.filter(z => z.pid === p.id).length})</div>
    <div class="t" onclick="S.adminFilter='${p.id}';goPage('denik')">📓 Stavební deník</div>
  </div>${body}`;
}
function pgProjDocs(p) {
  const docs = p.portalDocs || [];
  return `<main><div class="card">
    <h3>📁 Dokumenty viditelné investorovi na portálu</h3>
    ${docs.map((d, i) => `<div class="urow"><span>${d.mime && d.mime.includes('image') ? '🖼' : '📄'}</span><b>${esc(d.title)}</b>
      <span class="muted" style="margin-left:auto">Drive</span><span class="lnk" style="font-size:11px" onclick="delPortalDoc('${p.id}',${i})">✕ odebrat</span></div>`).join('') || '<div class="empty">Zatím žádné dokumenty na portálu.</div>'}
    <div class="formsec"><h4>➕ Přidat dokument (soubor musí být na Drive)</h4>
      <label>Název pro investora</label><input type="text" id="pd-title" placeholder="Smlouva o dílo">
      <label>Drive ID souboru nebo odkaz</label><input type="text" id="pd-id" placeholder="https://drive.google.com/file/d/…">
      <div class="aprv"><button class="btn amber sm" onclick="addPortalDoc('${p.id}')">💾 Přidat na portál</button></div>
      <div class="note">Smlouva, klientské PDF nabídky, vizualizace… Soubor zůstává na Drive, portál drží jen odkaz (#30). Investor si ho otevře přímo na portálu.</div>
    </div>
  </div></main>`;
}
async function uploadStavbaDocs(pid, files) {
  const p = proj(pid); if (!p) return;
  for (const f of [...files]) {
    if (f.size > 15 * 1024 * 1024) { toast('Moc velké (max 15 MB): ' + f.name); continue; }
    const data = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    try {
      S.uploading++; render();
      const j = await driveCall({ action: 'upload', folderId: p.driveFolderId || '', rootId: CFG.driveRootFolderId, cn: p.cn, client: p.client, date: isoToday(), name: f.name, druh: 'podklad', data: data.split(',')[1], mime: f.type || 'application/octet-stream' });
      const cur = (proj(pid).stavbaDocs) || [];
      await db.collection('projects').doc(pid).update({ stavbaDocs: [...cur, { name: f.name, driveId: j.fileId, mime: f.type || '' }] });
    } catch (e) { console.warn(e); toast('⚠ ' + f.name + ' se nenahrál (Drive most)'); }
    finally { S.uploading--; render(); }
  }
  toast('Podklady nahrány ✓');
}
async function addStavbaDocLink(pid) {
  const title = $('#sd-title').value.trim(); const raw = $('#sd-id').value.trim();
  if (!title || !raw) { toast('Vyplň název i Drive odkaz'); return; }
  const m = raw.match(/[-\w]{25,}/); if (!m) { toast('Nepoznávám Drive ID/odkaz'); return; }
  const p = proj(pid);
  await db.collection('projects').doc(pid).update({ stavbaDocs: [...(p.stavbaDocs || []), { name: title, driveId: m[0], mime: raw.toLowerCase().includes('pdf') ? 'application/pdf' : '' }] });
  $('#sd-title').value = ''; $('#sd-id').value = ''; zapomen('sd-title', 'sd-id');
  toast('Podklad přidán ✓');
}
async function delStavbaDoc(pid, i) {
  const p = proj(pid); const docs = (p.stavbaDocs || []).slice(); docs.splice(i, 1);
  await db.collection('projects').doc(pid).update({ stavbaDocs: docs });
}
/* Strop kopie dokumentu na portal. Jeden zaznam v databazi uvezme 1 MB
   i s hlavickou, takze base64 (o tretinu delsi nez soubor) musi zustat pod
   tim. 650 kB souboru je bezna smlouva i vetsi pudorys. */
const MAX_PORTAL_DOK_KB = 650;
/* Investorovi nestaci ODKAZ na Disk: soubor vydava most a ten chce tajny
   klic, ktery ma jen prihlaseny clovek. Investor prihlaseny neni, takze
   dostal prihlasovaci stranku Googlu — a vedeni o tom nevedelo, protoze
   jemu se soubor otevrel normalne. Kopie se proto uklada primo k portalu,
   uplne stejne jako velke fotky. */
/* Investor si dokument otevre z kopie ulozene u portalu — na Disk se
   nesaha vubec, takze ho Google o nic nezada. */
async function portalDok(id) {
  const d = (S.portalDocs || []).find(x => x.id === id);
  /* Titulek si dohledame sami — driv se predaval v onclick a apostrof
     v nazvu souboru cely klik rozbil (esc() dela z ' entitu, kterou
     prohlizec dekoduje driv, nez to dostane JS). */
  const titulek = (d && d.title) || 'Dokument';
  if (!d || !d.pripraveno) { oznam('Dokument se ještě připravuje. Zkuste to prosím za chvíli.'); return; }
  let url;
  try {
    /* Obsah az ted, jednim dotazem — v seznamu, ktery se poslouchá naživo,
       by se stahoval porad dokola. */
    const sn = await db.collection('portals').doc(S.portalToken).collection('soubory').doc(id).get();
    const data = sn.exists ? sn.data().data : null;
    if (!data) { oznam('Dokument se nepodařilo načíst. Zkuste to prosím znovu.'); return; }
    const bajty = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    url = URL.createObjectURL(new Blob([bajty], { type: d.mime || 'application/octet-stream' }));
  } catch (e) { oznam('Dokument se nepodařilo otevřít.'); return; }
  const jePdf = (d.mime || '').indexOf('pdf') >= 0;
  const jeObrazek = (d.mime || '').indexOf('image/') === 0;
  $('#viewer').innerHTML = `<div class="viewer" onclick="if(event.target===this)closeDoc()"><div class="vwrap">
    <div class="vhead"><b style="flex:1;min-width:120px">${esc(titulek)}</b>
      <a class="btn amber sm" href="${url}" download="${esc(nazevKeStazeni(titulek, d.mime))}">⬇ Uložit</a>
      <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
    <div class="vbody">${jeObrazek ? `<img src="${url}" style="max-width:100%;display:block;margin:0 auto">`
      : jePdf ? `<iframe src="${url}" style="width:100%;height:78vh;border:0"></iframe>`
      : `<div class="note">Tenhle typ souboru se v prohlížeči neukáže — stáhněte si ho tlačítkem ⬇ Uložit nahoře.</div>`}</div>
  </div></div>`;
}
async function kopieDokNaPortal(tok, docId, driveId) {
  const klic = S.tajne && S.tajne.mostKlic;
  if (!tok || !klic || !CFG.scriptUrl || !S.online) return { ok: false, duvod: 'offline' };
  try {
    const j = await driveCall({ action: 'getFile', fileId: driveId, klic });
    if (!j.ok || !j.data) return { ok: false, duvod: j.error || 'Disk soubor nevydal' };
    const kb = Math.round(j.data.length * 3 / 4 / 1024);
    if (kb > MAX_PORTAL_DOK_KB) return { ok: false, duvod: 'velky', kb };
    /* Obsah souboru bydli VEDLE seznamu, ne v nem. Seznam dokumentu portal
       poslouchá naživo, takze by investor stahoval megabajty pokazde, kdyz
       portal jen otevre — a to typicky na mobilnich datech. */
    await db.collection('portals').doc(tok).collection('soubory').doc(docId).set({ data: j.data, mime: j.mime || '' });
    await db.collection('portals').doc(tok).collection('docs').doc(docId).set({ mime: j.mime || '', pripraveno: true }, { merge: true });
    return { ok: true, kb };
  } catch (e) { return { ok: false, duvod: e.message || 'nepovedlo se' }; }
}
async function addPortalDoc(pid) {
  const p = proj(pid);
  const title = $('#pd-title').value.trim();
  let raw = $('#pd-id').value.trim();
  const m = raw.match(/[-\w]{25,}/);
  if (!title || !m) { toast('Vyplň název a Drive ID/odkaz'); return; }
  const docs = [...(p.portalDocs || []), { title, driveId: m[0], mime: '' }];
  await db.collection('projects').doc(pid).update({ portalDocs: docs });
  const tok = await tokenPortaluAsync(pid); // token je v admin-only /portaly (S2)
  let hlaska = 'Dokument přidán na portál ✓';
  if (tok) {
    const ref = await db.collection('portals').doc(tok).collection('docs').add({ title, driveId: m[0] });
    const k = await kopieDokNaPortal(tok, ref.id, m[0]);
    if (!k.ok) hlaska = k.duvod === 'velky'
      ? '⚠ Dokument je moc velký (' + k.kb + ' kB) — investor si ho na portálu neotevře. Pošli mu ho radši mailem.'
      : '⚠ Dokument se na portál nepodařilo zkopírovat — investor si ho zatím neotevře. Zkus to znovu.';
  }
  $('#pd-title').value = ''; $('#pd-id').value = ''; zapomen('pd-title', 'pd-id');
  toast(hlaska);
}
async function delPortalDoc(pid, i) {
  const p = proj(pid);
  const docs = (p.portalDocs || []).slice(); const rm = docs.splice(i, 1)[0];
  await db.collection('projects').doc(pid).update({ portalDocs: docs });
  const tok = await tokenPortaluAsync(pid); // token je v admin-only /portaly (S2)
  if (tok && rm) {
    const s = await db.collection('portals').doc(tok).collection('docs').where('driveId', '==', rm.driveId).get();
    for (const d of s.docs) {
      /* obsah lezi vedle v /soubory — bez uklidu by tam zustal jako sirotek */
      await db.collection('portals').doc(tok).collection('soubory').doc(d.id).delete().catch(() => {});
      await d.ref.delete().catch(() => {});
    }
  }
}
/* Smaze cely portal investora — dokument i vsechny podkolekce. Odkaz tim
   okamzite prestane fungovat. Bez ptani: ptaji se volajici. */
async function smazPortalData(pid) {
  const tok = await tokenPortaluAsync(pid); // token je v admin-only /portaly (S2)
  if (tok) {
    /* 'fotky' = velke kopie fotek pro investora, 'actions' = jeho schvaleni
       viceprace. Bez uklidu by v databazi zustali sirotci bez portalu. */
    for (const kol of ['feed', 'vp', 'docs', 'soubory', 'fotky', 'actions']) {
      const sn = await db.collection('portals').doc(tok).collection(kol).get().catch(() => null);
      if (sn) for (const d of sn.docs) await d.ref.delete().catch(() => {});
    }
    await db.collection('portals').doc(tok).delete().catch(() => {});
  }
  await db.collection('portaly').doc(pid).delete().catch(() => {});
  /* Pamet dorovnat HNED: tokenPortalu() cte z S.portaly a posluchac dorazi
     az za chvili — jinak by createPortal videl stary token a novy portal
     odmitl zalozit. */
  if (S.portaly) delete S.portaly[pid];
  return tok;
}
async function zrusPortal(pid) {
  const p = proj(pid); if (!p) return;
  if (!await potvrd('Zrušit portál investora u stavby „' + p.name + '"?\n\n' +
    'Odkaz, který investor má, okamžitě přestane fungovat. Smažou se i zápisy, fotky, vícepráce a dokumenty, které se na portál kopírovaly.\n\n' +
    'V Deníku nic nezmizí — jde jen o kopii pro investora. Portál se dá kdykoli vytvořit znovu, ale bude mít jiný odkaz.', 'Ano, zrušit portál')) return;
  try {
    await smazPortalData(pid);
    toast('Portál zrušen ✓ — odkaz už nefunguje');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
  render();
}
async function novyPortal(pid) {
  const p = proj(pid); if (!p) return;
  if (!await potvrd('Vydat nový odkaz na portál u stavby „' + p.name + '"?\n\n' +
    'Starý odkaz okamžitě přestane fungovat — kdo ho má, ten se dovnitř už nedostane. Nový odkaz musíš investorovi poslat znovu.\n\n' +
    'Schválené zápisy a fotky se na nový portál nakopírují samy.', 'Ano, vydat nový')) return;
  try {
    await smazPortalData(pid);
    await createPortal(pid);
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
  render();
}
async function createPortal(pid) {
  const p = proj(pid);
  /* Dvojklik / druhy admin: novy token by investorovi zneplatnil uz
     poslany odkaz. Kdyz portal existuje, nic se nezaklada. */
  if (await tokenPortaluAsync(pid)) { toast('Portál už existuje — odkaz je v detailu projektu'); render(); return; }
  const token = uid8() + uid8().slice(0, 10);
  await db.collection('portals').doc(token).set({ pid, client: p.client || '', name: p.name, createdAt: FV() });
  /* Token bydli v admin-only /portaly, NE na projektu (S2) — projekt ctou
     vsechny role vcetne externiho suba a kdo zna token, umi podvrhnout
     schvaleni viceprace investorem. */
  await db.collection('portaly').doc(pid).set({ token });
  /* zrcadli už schválené záznamy — přes mirrorEntry, ať se s nimi zkopírují
     i velké verze fotek do /fotky (dřív tu byla kopie kódu bez fotek) */
  for (const e of entriesOf(pid).filter(x => x.status === 'approved')) {
    await mirrorEntry(e).catch(err => console.warn('zrcadleni pri zalozeni portalu', err));
  }
  for (const d of (p.portalDocs || [])) {
    const ref = await db.collection('portals').doc(token).collection('docs').add({ title: d.title, driveId: d.driveId });
    /* kopie souboru rovnou s sebou — bez ni si ji investor neotevre */
    await kopieDokNaPortal(token, ref.id, d.driveId);
  }
  /* Hlavicka portalu (adresa, typ, plan predani, milniky) — bez tohohle by
     investor do minuty videl jen jmeno stavby a jmeno sebe sama. */
  await syncPortalHeader(p, token).catch(() => {});
  toast('Portál vytvořen ✓ — odkaz najdeš v detailu projektu');
}
function gpsFromHere(pid) {
  if (!navigator.geolocation) { toast('Zařízení nedává polohu'); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = +pos.coords.latitude.toFixed(7), lng = +pos.coords.longitude.toFixed(7);
    /* Telefon obcas vrati nesmysl (nula uprostred oceanu, poloha z jine site).
       Radeji nic nez spendlik, proti kteremu se pak nikdo neprihlasi. */
    if (!gpsVCesku(lat, lng)) { toast('Poloha vyšla mimo Česko — zkus to venku nebo zadej souřadnice ručně'); return; }
    /* Popisek se ZAHAZUJE: „Nastaveno podle: Novodvorska 413/135" platilo
       pro nalezenou adresu, ne pro misto, kde zrovna stojim. */
    await db.collection('projects').doc(pid).update({ gps: { lat, lng, tol: CFG.gpsTolerance || 100, label: '' } });
    toast('GPS nastavena podle aktuální polohy ✓');
  }, () => toast('Polohu se nepodařilo zjistit'), { enableHighAccuracy: true, timeout: 10000 });
}
// Prubeh stavby ma JEDEN zdroj pravdy: harmonogram (milniky). Rucni pole je pryc —
// dva zdroje se prepisovaly navzajem a portal pak ukazoval nesmysly („0 % · Dokončeno").
// Milnik: { t: text, p: postup 0–100, s: 'next'|'now'|'done' (odvozene, drzime kvuli
// starym datum a portalum), volitelne dur: odhad doby („2–3 týdny"). Stary milnik bez
// „p" se bere: hotovy = 100 %, jinak 0 %.
function milePct(m) {
  const v = typeof m.p === 'number' ? m.p : (m.s === 'done' ? 100 : 0);
  return Math.min(100, Math.max(0, Math.round(v)));
}
// Prubeh = prumer postupu vsech milniku, cela procenta. Faze = prvni rozdelany
// milnik (0<p<100), jinak prvni nedokonceny; vse hotovo → „Dokončeno".
// Bez milniku prubeh NEZNAME → progress: null (zobrazuje se „—", ne 0 %).
function msRecalc(ms, p) {
  if (!ms || !ms.length) return { progress: null, phase: (p && p.phase) || '' };
  const progress = Math.round(ms.reduce((a, m) => a + milePct(m), 0) / ms.length);
  const run = ms.find(m => { const v = milePct(m); return v > 0 && v < 100; });
  const open = ms.find(m => milePct(m) < 100);
  return { progress, phase: run ? run.t : (open ? open.t : 'Dokončeno') };
}
// Prubeh pro zobrazeni — pocita se zivy z milniku, aby stary rucne zapsany
// progress v databazi nemohl lhat. null = harmonogram nezadan.
function projProgress(p) { return msRecalc((p && p.milestones) || [], p || {}).progress; }
/* Faze se odvozuje ZIVE z harmonogramu, stejne jako prubeh. Ulozene pole
   phase je jen posledni znamy stav — kdyz se milnik zmenil jinde (nebo
   zustalo z doby rucniho zadavani), ukazovalo to nesmysl typu
   "0 % · Dokonceno". Bez harmonogramu plati rucne zadana faze. */
function projPhase(p) {
  const ms = (p && p.milestones) || [];
  return ms.length ? msRecalc(ms, p || {}).phase : ((p && p.phase) || '');
}
// Spolecny zapis: milniky vzdy, progress/phase jen kdyz se opravdu zmenily
// (zadne zbytecne zapisy, zadne prekreslovaci smycky).
async function ulozMilniky(pid, ms) {
  const p = proj(pid); const r = msRecalc(ms, p);
  const upd = { milestones: ms };
  if (r.progress !== (typeof p.progress === 'number' ? p.progress : null)) upd.progress = r.progress;
  if (r.phase !== (p.phase || '')) upd.phase = r.phase;
  await db.collection('projects').doc(pid).update(upd);
  /* Portal investora dorovnat HNED. Casovac to jinak stihne az za minutu
     a jen dokud ma vedeni appku otevrenou — kdo posune milnik a zavre ji,
     nechal by investora koukat na stare procento klidne do dalsiho dne. */
  syncPortalHeader({ ...p, milestones: ms, progress: r.progress, phase: r.phase }).catch(() => {});
}
// Nastavi postup milniku (tlacitka 0/25/75/… i odskrtnuti kolecka = 100 %).
async function setMilePct(pid, i, pct) {
  const p = proj(pid); const ms = (p.milestones || []).map(m => ({ ...m }));
  if (!ms[i]) return;
  ms[i].p = Math.min(100, Math.max(0, Math.round(pct) || 0));
  ms[i].s = ms[i].p === 100 ? 'done' : ms[i].p > 0 ? 'now' : 'next';
  await ulozMilniky(pid, ms);
}
async function addMile(pid) {
  const t = $('#mile-t').value.trim(); if (!t) return;
  const p = proj(pid); const ms = [...(p.milestones || []), { t, s: 'next', p: 0 }];
  $('#mile-t').value = ''; zapomen('mile-t');
  await ulozMilniky(pid, ms);
}
async function delMile(pid, i) {
  const p = proj(pid); const ms = (p.milestones || []).slice();
  if (!ms[i]) return;
  /* Doted stacilo jedno tuknuti na krizek — a zmena se hned propsala
     investorovi na portal. Vratit to nejde. */
  if (!await potvrd('Smazat milník „' + (ms[i].t || '') + '"?\n\n' +
    'Zmizí i investorovi na portálu a přepočítá se průběh stavby. Vrátit to nejde — jen napsat milník znovu.', 'Ano, smazat')) return;
  ms.splice(i, 1);
  await ulozMilniky(pid, ms);
}
/* Preklep v nazvu sel opravit jen tak, ze se milnik smazal a napsal znovu
   — a tim se ztratil i jeho postup. Ted staci klepnout na text. */
async function prejmenujMile(pid, i) {
  const p = proj(pid); const ms = (p.milestones || []).map(m => ({ ...m }));
  if (!ms[i]) return;
  const t = await zeptejSe('✏️ Přejmenovat milník', 'Název vidí i investor na portálu. Postup milníku zůstane, jak je.', ms[i].t || '');
  if (t === null) return;
  const novy = String(t).trim();
  if (!novy) { toast('Název milníku nesmí být prázdný'); return; }
  if (novy === (ms[i].t || '')) return;
  ms[i].t = novy;
  await ulozMilniky(pid, ms);
  toast('Milník přejmenován ✓');
}


/* ---- fotka: dlaždice ---- */
function phTile(ph, clientView, eid) {
  const st = clientView ? '' : `<span class="st" ${eid ? `onclick="event.stopPropagation();cyclePhoto('${eid}','${ph.id}')"` : ''}>${ph.status === 'approved' ? '✓' : ph.status === 'pending' ? '⏳' : '🔒'}</span>`;
  return `<div class="ph" onclick="otevritFoto('${ph.id || ''}','${ph.driveId || ''}','${esc(ph.label)}',this,'${ph.origId || ''}')">
    <img src="${ph.thumb}" alt="">${st}<small>${esc(ph.label || '')}</small></div>`;
}
/* Tlacitko "Plne rozliseni (Drive)" jen pro prihlasene: firemni Drive je
   soukromy a investora na portalu by odkaz jen poslal na prihlasovaci
   obrazovku Googlu se zadosti o pristup — nikdy by mu nefungoval. */
function openPhoto(driveId, label, el, origId) {
  const img = el ? el.querySelector('img') : null;
  const src = img ? img.src : '';
  /* „Plné rozlišení" otevira prednostne ORIGINAL (origId) — ten nese datum
     porizeni a GPS. Stare fotky original nemaji, tam se otevre prohlizeci
     kopie (driveId) jako driv. */
  const plneId = origId || driveId;
  $('#viewer').innerHTML = `<div class="viewer" onclick="if(event.target===this)closeDoc()"><div class="vwrap">
    <div class="vhead"><b style="flex:1;min-width:120px">${esc(label)}</b>
      ${/* Plne rozliseni vydava MOST, ne Google — stejne jako u priloh a
            podkladu. Driv to byl primy odkaz na drive.google.com, takze to
            po kazdem chtelo ucet Google (a parta ho nema vubec). Most soubor
            vyda i cloveku bez uctu a klic pritom neopousti server. */''}
      ${plneId && !S.portalToken ? `<button class="btn ghost sm" onclick="openDriveDoc('${plneId}','${esc(label)}')">🔍 Plné rozlišení</button>` : '<span class="badge b-int">jen náhled</span>'}
      <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
    <div class="vbody" style="padding:0;align-items:center"><img src="${src}" style="width:100%;max-height:80vh"></div></div></div>`;
}
function closeDoc() { $('#viewer').innerHTML = ''; }
/* Fotka se otevre hned z maleho nahledu a lepsi kvalita se doplni vzapeti.
   Poradi zdroju: (a) most vyda velkou verzi z Drive (getPhoto) — nove fotky
   uz stredni verzi v databazi nemaji; (b) /fotonahledy jako zaloha pro stare
   fotky, ktere tam nahled jeste maji; (c) kdyz nic z toho, zustane maly
   nahled a nic nespadne (typicky offline). Parta nepotrebuje ucet Google —
   klic k mostu ma z databaze kazdy prihlaseny. */
async function otevritFoto(photoId, driveId, label, el, origId) {
  openPhoto(driveId, label, el, origId);
  const v = $('#viewer');
  const img = v && v.querySelector('.vbody img');
  if (!img || (!photoId && !driveId)) return;
  /* kratky naznak nacitani pres nahledem — at clovek vidi, ze se neco deje */
  const body = img.parentElement;
  body.style.position = 'relative';
  const hint = document.createElement('div');
  hint.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.55);color:#fff;padding:4px 12px;border-radius:99px;font-size:12px;white-space:nowrap';
  hint.innerHTML = '<span class="spin"></span> Načítám lepší kvalitu…';
  body.appendChild(hint);
  try {
    /* (a) most: velka verze primo z Drive. Vola se az PO tuknuti na fotku,
       takze bezne listovani mrizkou most nezatezuje. */
    const klic = S.tajne && S.tajne.mostKlic;
    if (driveId && klic && CFG.scriptUrl && S.online) {
      try {
        const j = await driveCall({ action: 'getPhoto', fileId: driveId, sirka: 1600, klic });
        if (j.ok && j.data) {
          /* uzivatel mohl mezitim otevrit jinou fotku nebo prohlizec zavrit */
          if (img.isConnected) img.src = 'data:' + (j.mime || 'image/jpeg') + ';base64,' + j.data;
          return;   // uspech — /fotonahledy uz necist, at se nestahuje dvakrat
        }
        console.warn('most getPhoto', j.error);
      } catch (e) { console.warn('most getPhoto', e); }
    }
    /* (b) zaloha: stredni verze z /fotonahledy — maji ji jen STARE fotky
       (nove se tam uz neukladaji), a hodi se i kdyz most zrovna selze */
    if (!photoId || !img.isConnected) return;
    const d = await db.collection('fotonahledy').doc(photoId).get();
    if (d.exists && d.data().data && img.isConnected) img.src = d.data().data;
  } catch (e) { /* (c) nic nedorazilo — zustava maly nahled, to neni chyba */ }
  finally { hint.remove(); }
}
/* Totez pro portal investora: velka verze se cte z verejne kopie
   /portals/{token}/fotky (na /fotonahledy ani na Drive neprihlaseny
   investor nedosahne) — a az po tuknuti, at se stovky kB nestahuji
   zbytecne u kazde fotky. Bez kopie (stara fotka) zustane maly nahled. */
async function otevritFotoPortal(fotoId, label, el) {
  openPhoto('', label, el);   // bez Drive tlacitka — investorovi nikdy fungovat nemuze
  if (!fotoId || !S.portalToken) return;
  try {
    const d = await db.collection('portals').doc(S.portalToken).collection('fotky').doc(fotoId).get();
    if (!d.exists || !d.data().data) return;
    const v = $('#viewer');
    const img = v && v.querySelector('.vbody img');
    if (img) img.src = d.data().data;
    const badge = v && v.querySelector('.vhead .badge');   // "jen nahled" uz neplati
    if (badge) badge.remove();
  } catch (e) { /* velka verze nedorazila — zustava maly nahled */ }
}
/* Priloha muze byt trojiho druhu a kazda se otevira jinak:
   - driveId  -> lezi na Drive
   - data     -> stara priloha vlozena primo do zaznamu (pred frontou)
   - ani jedno -> jeste ceka ve fronte, nebo se nahrani nepovedlo */
function otevritPrilohu(eid, i) {
  const e = (S.entries || []).find(x => x.id === eid);
  const a = e && (e.attachments || [])[i];
  if (!a) { toast('Příloha nenalezena'); return; }
  if (a.driveId) return openDriveDoc(a.driveId, a.name);
  if (a.data) {
    const obrazek = (a.mime || '').indexOf('image/') === 0;
    $('#viewer').innerHTML = `<div class="viewer" onclick="if(event.target===this)closeDoc()"><div class="vwrap">
      <div class="vhead"><b style="flex:1;min-width:120px">${esc(a.name)}</b>
        <a class="btn ghost sm" href="${a.data}" download="${esc(a.name)}">⬇ Stáhnout</a>
        <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
      <div class="vbody" style="padding:0;align-items:center">${obrazek
        ? `<img src="${a.data}" style="width:100%;max-height:80vh">`
        : '<div class="empty" style="padding:30px">Náhled tohohle typu souboru neumíme — stáhni si ho tlačítkem nahoře.</div>'}</div></div></div>`;
    return;
  }
  openDriveDoc('', a.name);
}
async function openDriveDoc(driveId, title) {
  /* Bez platneho ID by se do adresy Drive dostalo prazdno nebo "undefined"
     a Google vrati vlastni stranku "400 — pozadavek nema spravny format". */
  if (!driveId || driveId === 'undefined' || driveId === 'null') {
    modal(`<h3>📎 ${esc(title || 'Příloha')}</h3>
      <div class="note">Tenhle soubor na Drive není. Buď ještě čeká ve frontě na odeslání, nebo se ho nepodařilo nahrát.</div>
      <div class="aprv"><button class="btn dark" onclick="closeModal()">Rozumím</button></div>`);
    return;
  }
  /* Soubor vydava MOST (action getFile) — telefon se s Googlem nebavi,
     takze funguje i pro partu bez uctu Google. Google iframe zustava jen
     jako zaloha, kdyz most nebo klic nejsou po ruce. */
  const klic = S.tajne && S.tajne.mostKlic;
  if (klic && CFG.scriptUrl && S.online) {
    $('#viewer').innerHTML = `<div class="viewer"><div class="vwrap">
      <div class="vhead"><b style="flex:1;min-width:120px">${esc(title)}</b>
        <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
      <div class="vbody" style="align-items:center;justify-content:center;min-height:30vh">
        <div class="loading"><span class="spin"></span>Stahuji soubor…</div></div></div></div>`;
    try {
      const j = await driveCall({ action: 'getFile', fileId: driveId, klic });
      if (j.ok) {
        const bajty = Uint8Array.from(atob(j.data), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bajty], { type: j.mime || 'application/octet-stream' }));
        const mm = (j.mime || '').toLowerCase();
        /* Original z iPhonu byva HEIC/HEIF — do <img> ho cpat nejde, vetsina
           prohlizecu ho neumi a ukazala by rozbity obrazek. Zobrazi se jen
           formaty, ktere prohlizece bezne umeji; u ostatnich obrazku dostane
           clovek srozumitelnou hlasku + tlacitko Uložit nahore uz existuje. */
        const jeObrazek = mm.indexOf('image/') === 0;
        const zobrazitelny = /^image\/(jpe?g|png|webp|gif|avif|svg)/.test(mm);
        $('#viewer').innerHTML = `<div class="viewer" onclick="if(event.target===this)closeDoc()"><div class="vwrap">
          <div class="vhead"><b style="flex:1;min-width:120px">${esc(title)}</b>
            <a class="btn ghost sm" href="${url}" download="${esc(nazevKeStazeni(title, j.mime))}">⬇ Uložit do telefonu</a>
            <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
          <div class="vbody" style="padding:0;align-items:center">${zobrazitelny
            ? `<img src="${url}" style="width:100%;max-height:80vh">`
            : jeObrazek
              ? `<div class="empty" style="padding:30px">Tenhle formát fotky (${esc(j.mime || '')}) prohlížeč zobrazit neumí.<br>Originál i s datem pořízení a polohou si ulož tlačítkem „⬇ Uložit do telefonu" nahoře.</div>`
              : `<iframe src="${url}" style="width:100%;height:80vh;border:0"></iframe>`}</div></div></div>`;
        return;
      }
      console.warn('most getFile', j.error);
    } catch (e) { console.warn('most getFile', e); }
  }
  // zaloha: Google iframe — funguje jen prihlasenym ke Googlu (vedeni)
  $('#viewer').innerHTML = `<div class="viewer" onclick="if(event.target===this)closeDoc()"><div class="vwrap">
    <div class="vhead"><b style="flex:1;min-width:120px">${esc(title)}</b>
      <a class="btn ghost sm" href="${driveViewUrl(driveId)}" target="_blank">📁 Otevřít na Drive</a>
      <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
    <div class="vbody"><iframe src="https://drive.google.com/file/d/${driveId}/preview" allow="autoplay"></iframe></div></div></div>`;
}
/* Nahrada za systemovy prompt(): ten v aplikaci na plose (PWA) nefunguje
   — na iPhonu ho system proste nezobrazi a tlacitko vypada, jako by bylo
   mrtve. Vlastni okenko funguje vsude stejne. Vraci Promise s textem,
   nebo null pri zruseni. */
/* Nahrada za confirm()/await oznam() — v aplikaci pridane na plochu se
   systemova okna na iPhonu vubec nezobrazi (stejne jako prompt). */
function potvrd(text, tlacitko) {
  return new Promise(hotovo => {
    window._potvrdHotovo = v => { window._potvrdHotovo = null; closeModal(); hotovo(v); };
    modal(`<h3>❓ Opravdu?</h3>
      <div style="white-space:pre-line;margin:6px 0 2px">${esc(text)}</div>
      <div class="aprv">
        <button class="btn amber" onclick="window._potvrdHotovo(true)">${esc(tlacitko || 'Ano')}</button>
        <button class="btn ghost" onclick="window._potvrdHotovo(false)">Zrušit</button>
      </div>`);
  });
}
function oznam(text) {
  return new Promise(hotovo => {
    window._potvrdHotovo = () => { window._potvrdHotovo = null; closeModal(); hotovo(); };
    modal(`<h3>ℹ️ Upozornění</h3>
      <div style="white-space:pre-line;margin:6px 0 2px">${esc(text)}</div>
      <div class="aprv"><button class="btn amber" onclick="window._potvrdHotovo()">Rozumím</button></div>`);
  });
}
function zeptejSe(nadpis, popis, vychozi, viceradkove) {
  return new Promise(hotovo => {
    window._zeptejSeHotovo = v => { window._zeptejSeHotovo = null; closeModal(); hotovo(v); };
    modal(`<h3>${esc(nadpis)}</h3>
      ${popis ? `<div class="note" style="margin-top:0">${esc(popis)}</div>` : ''}
      ${viceradkove
        ? `<textarea id="zs-v" style="min-height:80px">${esc(vychozi || '')}</textarea>`
        : `<input type="text" id="zs-v" value="${esc(vychozi || '')}" onkeydown="if(event.key==='Enter')window._zeptejSeHotovo(document.querySelector('#zs-v').value)">`}
      <div class="aprv">
        <button class="btn amber" onclick="window._zeptejSeHotovo(document.querySelector('#zs-v').value)">Potvrdit</button>
        <button class="btn ghost" onclick="window._zeptejSeHotovo(null)">Zrušit</button>
      </div>`);
    setTimeout(() => { const el = document.querySelector('#zs-v'); if (el) { el.focus(); el.select && el.select(); } }, 60);
  });
}

function modal(html) {
  $('#modal').innerHTML = `<div class="modal" onclick="if(event.target===this)closeModal()"><div class="mbox">${html}</div></div>`;
  setTimeout(mountMaps, 0);
}
function closeModal() { $('#modal').innerHTML = ''; }

/* ============ GALERIE FOTEK ============
   Fotky ziji na zaznamech deniku (entry.photos) — galerie je jen jiny pohled
   na stejna data: mrizka po dnech, nejnovejsi nahore, s kontextem (zakazka,
   autor, veta ze zapisu), ktery Google Fotky nemaji. Mrizka kresli VYHRADNE
   male nahledy (thumb) z pameti — velka verze se dotahuje z mostu az po
   tuknuti na fotku, stejne jako u otevritFoto. Obe galerie (u zakazky
   i pres vsechny stavby) sdileji fgTelo(). */

/* Vybere fotky podle filtru a prilepi k nim kontext ze zapisu.
   pid = galerie jedne zakazky; null = pres vsechny stavby (plati S.fgProj).
   S.entries uz jsou serazene od nejnovejsich, takze vysledek taky. */
function fotkyVyber(pid) {
  const od = S.fgFrom || '', do_ = S.fgTo || '';
  const seznam = [];
  S.entries.forEach(e => {
    if (pid ? e.pid !== pid : (S.fgProj && e.pid !== S.fgProj)) return;
    if (od && e.date < od) return;
    if (do_ && e.date > do_) return;
    if (S.fgAutor && (e.author || '') !== S.fgAutor) return;
    (e.photos || []).forEach(ph => {
      if (!ph.thumb) return;   // bez nahledu neni co kreslit (fotka jeste ve fronte)
      seznam.push({ ...ph, eid: e.id, date: e.date, author: e.author || '', pid: e.pid, veta: fotoVeta(e) });
    });
  });
  return seznam;
}
/* Veta ze zapisu pod velkou fotkou: prvni radek zneni pro investora,
   jinak prvni polozka praci. Zkracena, at nepretece pres obrazovku. */
function fotoVeta(e) {
  const t = ((e.client || '').trim().split('\n')[0] || (e.works || [])[0] || '').trim();
  return t.length > 160 ? t.slice(0, 157) + '…' : t;
}

/* Lista filtru: obdobi od–do, zakazka (jen pres vsechny stavby), kdo fotil.
   Zamerne jen nativni policka — na telefonu se ovladaji palcem nejlip. */
function fgFiltry(pid) {
  const autori = [...new Set(S.entries
    .filter(e => (e.photos || []).length && (!pid || e.pid === pid))
    .map(e => e.author).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  const aktivni = S.fgFrom || S.fgTo || (!pid && S.fgProj) || S.fgAutor;
  return `<div class="fgbar">
    <input type="date" id="fg-od" value="${S.fgFrom || ''}" title="Od" onchange="fgObdobi()">
    <span class="muted">–</span>
    <input type="date" id="fg-do" value="${S.fgTo || ''}" title="Do" onchange="fgObdobi()">
    ${pid ? '' : `<select id="fg-proj" onchange="S.fgProj=this.value||null;S.fgZobrazeno=60;render()">
      <option value="">Všechny zakázky</option>
      ${S.projects.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs')).map(p => `<option value="${p.id}" ${S.fgProj === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>`}
    <select id="fg-autor" onchange="S.fgAutor=this.value;S.fgZobrazeno=60;render()">
      <option value="">Všichni fotili</option>
      ${autori.map(a => `<option value="${esc(a)}" ${S.fgAutor === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
    </select>
    ${aktivni ? `<button class="btn ghost sm" onclick="fgReset()">✕ Zrušit filtry</button>` : ''}
  </div>`;
}
/* Zmena obdobi. Kdyz „od" saha pred zive okno (OKNO_DNU), starsi zapisy se
   dotahnou samy — stejny mechanismus jako u reportu. Bez toho by filtr na
   brezen tise ukazal prazdno a vypadalo by to, ze se tehdy nefotilo. */
async function fgObdobi() {
  S.fgFrom = ($('#fg-od') && $('#fg-od').value) || '';
  S.fgTo = ($('#fg-do') && $('#fg-do').value) || '';
  S.fgZobrazeno = 60;
  if (S.fgFrom && S.fgFrom < oknoOd()) {
    S.dotahuji = true; render();
    await dotahniZapisyProReport(S.fgFrom, shiftISO(oknoOd(), -1));
    S.dotahuji = false;
  }
  render();
}
function fgReset() {
  S.fgFrom = ''; S.fgTo = ''; S.fgProj = null; S.fgAutor = ''; S.fgZobrazeno = 60;
  /* Policka je nutne vyprazdnit PRIMO v DOM jeste pred prekreslenim:
     pamet formularu (FORMMEM) si pri renderu ulozi aktualni hodnoty
     a vratila by stare datum zpatky — zapomen() tu nestaci, protoze
     defaultValue policka nese hodnotu z minuleho prekresleni. */
  ['fg-od', 'fg-do', 'fg-proj', 'fg-autor'].forEach(i => {
    delete FORMMEM[i];
    const el = document.getElementById(i);
    if (el) el.value = '';
  });
  render();
}

/* Telo galerie — mrizka seskupena po dnech (pres vsechny stavby po dnech
   a zakazkach), tlacitko „Zobrazit dalsi" a „Nacist starsi" z deniku.
   Kresli se jen prvnich S.fgZobrazeno dlazdic, at stovky fotek nezaseknou
   telefon; prohlizec ale listuje pres CELY vyber (_fgSeznam). */
function fgTelo(pid) {
  const vse = fotkyVyber(pid);
  window._fgSeznam = vse;
  const limit = S.fgZobrazeno || 60;
  const fotky = vse.slice(0, limit);
  const skupiny = [];
  let posl = null;
  fotky.forEach((f, i) => {
    const klic = f.date + (pid ? '' : '|' + f.pid);
    if (!posl || posl.klic !== klic) { posl = { klic, date: f.date, pid: f.pid, fotky: [] }; skupiny.push(posl); }
    posl.fotky.push({ f, i });
  });
  return `
    ${fgFiltry(pid)}
    ${skupiny.map(sk => {
      const p = proj(sk.pid) || {};
      const autori = [...new Set(sk.fotky.map(x => x.f.author).filter(Boolean))];
      return `<div class="fgday">
        <div class="fghead"><b>${fmtISOFull(sk.date)}</b>
          ${pid ? '' : `<span class="pn">🛠 ${esc(p.name || '')}</span>`}
          <span class="n">${esc(autori.join(', '))}${autori.length ? ' · ' : ''}${sk.fotky.length} ${sk.fotky.length === 1 ? 'fotka' : sk.fotky.length <= 4 ? 'fotky' : 'fotek'}</span>
        </div>
        <div class="fgrid">${sk.fotky.map(x => fgDlazdice(x.f, x.i)).join('')}</div>
      </div>`;
    }).join('') || `<div class="card"><div class="empty">📷 Žádné fotky${(S.fgFrom || S.fgTo || S.fgAutor || (!pid && S.fgProj)) ? ' pro zvolené filtry' : ' za posledních ' + OKNO_DNU + ' dní'}.<br><span class="muted">Zkus „⤓ Načíst starší" nebo uprav filtry.</span></div></div>`}
    <div class="aprv" style="justify-content:center;margin-bottom:14px">
      ${vse.length > limit ? `<button class="btn ghost" onclick="S.fgZobrazeno=${limit + 120};render()">⤓ Zobrazit další (zbývá ${vse.length - limit})</button>` : ''}
      <button class="btn ghost sm" onclick="dotahniZapisy()">${S.dotahuji ? '⏳ načítám…' : '⤓ Načíst starší z databáze'}</button>
    </div>
    <div class="note">Ťukni na fotku a listuj prstem (na počítači šipkami). Klik na štítek stavu = přepnout ⏳ čeká → ✓ klient → 🔒 interní — k investorovi jde fotka až po schválení (#31).</div>`;
}
/* Ctvercova dlazdice — jen thumb z pameti + stitek stavu jako u phTile.
   Popisek fotky nezere misto v mrizce, ukaze se az u velke verze. */
function fgDlazdice(f, i) {
  return `<div class="fg" onclick="fgOpen(${i})">
    <img src="${f.thumb}" alt="">
    <span class="st" title="Přepnout stav" onclick="event.stopPropagation();cyclePhoto('${f.eid}','${f.id}')">${f.status === 'approved' ? '✓' : f.status === 'pending' ? '⏳' : '🔒'}</span>
  </div>`;
}

/* ---- prohlizec pres celou obrazovku ----
   Otevre se hned s malym nahledem a velka verze se doplni z mostu (stejne
   zdroje jako otevritFoto: getPhoto z Drive, zaloha /fotonahledy). Listuje
   se prstem, sipkami na klavesnici i tlacitky; zavreni ✕ nebo Esc.
   Uz stazene velke verze drzi maly mezipamet, at se pri listovani tam
   a zpatky nestahuji znovu. */
window._fgSeznam = window._fgSeznam || [];
window._fgIdx = 0;
const _fgCache = new Map();
let _fgNacitam = 0;   // poradove cislo nacitani — ochrana proti zavodu pri rychlem listovani
function fgOpen(i) {
  window._fgIdx = i;
  /* Seznam se pri kazdem prekresleni sklada znovu (a prekresluje se i kdyz
     jen ubyde polozka fronty). Bez zapamatovaneho id by clovek po sipce
     skocil na uplne jinou fotku, nez cekal. */
  const f0 = (window._fgSeznam || [])[i];
  window._fgId = f0 ? (f0.id || '') : '';
  $('#viewer').innerHTML = `<div class="fviewer">
    <div class="fvtop">
      <span id="fv-count" class="muted"></span>
      <span class="sp"></span>
      <span id="fv-drive"></span>
      <button class="fvbtn" onclick="fgZavri()">✕ Zavřít</button>
    </div>
    <div class="fvbody" id="fv-body">
      <button class="fvnav prev" id="fv-prev" onclick="fgKrok(-1)">‹</button>
      <img id="fv-img" alt="">
      <button class="fvnav next" id="fv-next" onclick="fgKrok(1)">›</button>
      <div class="fvhint" id="fv-hint" style="display:none"><span class="spin"></span> Načítám plnou kvalitu…</div>
    </div>
    <div class="fvcap" id="fv-cap"></div>
  </div>`;
  /* listovani prstem: vodorovny tah aspon 45 px, ktery je jasne vodorovnejsi
     nez svisly (jinak by kazdy pokus o zoom prehazoval fotky) */
  const b = $('#fv-body');
  let x0 = null, y0 = null;
  b.addEventListener('touchstart', ev => { if (ev.touches.length !== 1) { x0 = null; return; } x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; }, { passive: true });
  b.addEventListener('touchend', ev => {
    if (x0 == null || !ev.changedTouches.length) return;
    const dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) fgKrok(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.removeEventListener('keydown', fgKlavesy);   // pojistka proti dvojimu naveseni
  document.addEventListener('keydown', fgKlavesy);
  fgUkaz();
}
function fgKlavesy(ev) {
  /* nektera prostredi hlasi sipky postaru jako "Left"/"Right" */
  if (ev.key === 'Escape' || ev.key === 'Esc') fgZavri();
  else if (ev.key === 'ArrowLeft' || ev.key === 'Left') fgKrok(-1);
  else if (ev.key === 'ArrowRight' || ev.key === 'Right') fgKrok(1);
}
function fgZavri() { document.removeEventListener('keydown', fgKlavesy); closeDoc(); }
function fgKrok(smer) {
  const n = window._fgIdx + smer;
  if (n < 0 || n >= window._fgSeznam.length) return;
  window._fgIdx = n; fgUkaz();
}
/* Prekresli prohlizec pro aktualni fotku: hned thumb (nebo velkou z cache),
   kontext pod fotkou, pak potichu dotahne velkou verzi. */
async function fgUkaz() {
  /* Kdyz se seznam mezitim preskladal, dohledame fotku podle id — jinak
     by sipky listovaly v necem jinem, nez co je zrovna videt. */
  if (window._fgId) {
    const j = (window._fgSeznam || []).findIndex(x => x && x.id === window._fgId);
    if (j >= 0 && j !== window._fgIdx) window._fgIdx = j;
  }
  const f = window._fgSeznam[window._fgIdx];
  const img = $('#fv-img');
  if (!f || !img) return;
  window._fgId = f.id || '';
  const moje = ++_fgNacitam;
  img.src = (f.id && _fgCache.get(f.id)) || f.thumb;
  const p = proj(f.pid) || {};
  $('#fv-count').textContent = (window._fgIdx + 1) + ' / ' + window._fgSeznam.length;
  $('#fv-cap').innerHTML = `<b>${fmtISOFull(f.date)}</b>
    <span>🛠 ${esc(p.name || '—')} · 👷 ${esc(f.author || '—')}${f.label ? ' · 📷 ' + esc(f.label) : ''}</span>
    ${f.veta ? `<em>„${esc(f.veta)}"</em>` : ''}`;
  /* Plne rozliseni z Drive — jen kdyz fotka na Drive opravdu je
     (original origId, nebo aspon prohlizeci kopie driveId) */
  $('#fv-drive').innerHTML = (f.origId || f.driveId) ? `<button class="fvbtn" onclick="fgDrive()">🔍 Plné rozlišení</button>` : '';
  const prev = $('#fv-prev'), next = $('#fv-next');
  if (prev) prev.disabled = window._fgIdx === 0;
  if (next) next.disabled = window._fgIdx === window._fgSeznam.length - 1;
  if (f.id && _fgCache.has(f.id)) return;
  const hint = $('#fv-hint');
  if (hint && (f.driveId || f.id)) hint.style.display = '';
  const velka = await fgVelka(f);
  if (moje !== _fgNacitam) return;   // uzivatel uz mezitim odlistoval jinam
  if (hint) hint.style.display = 'none';
  if (velka) {
    if (f.id) _fgCache.set(f.id, velka);
    if (_fgCache.size > 25) _fgCache.delete(_fgCache.keys().next().value);   // strop pameti
    if (img.isConnected) img.src = velka;
  }
}
/* Velka verze fotky — stejne poradi zdroju jako otevritFoto:
   (a) most vyda velkou verzi z Drive, (b) /fotonahledy jako zaloha pro
   stare fotky, (c) nic — zustane maly nahled (typicky offline). */
async function fgVelka(f) {
  try {
    const klic = S.tajne && S.tajne.mostKlic;
    if (f.driveId && klic && CFG.scriptUrl && S.online) {
      try {
        const j = await driveCall({ action: 'getPhoto', fileId: f.driveId, sirka: 1600, klic });
        if (j.ok && j.data) return 'data:' + (j.mime || 'image/jpeg') + ';base64,' + j.data;
        console.warn('galerie getPhoto', j.error);
      } catch (e) { console.warn('galerie getPhoto', e); }
    }
    if (f.id) {
      const d = await db.collection('fotonahledy').doc(f.id).get();
      if (d.exists && d.data().data) return d.data().data;
    }
  } catch (e) { /* zadny zdroj — neni to chyba */ }
  return null;
}
function fgDrive() {
  const f = window._fgSeznam[window._fgIdx];
  if (!f || (!f.origId && !f.driveId)) return;
  /* openDriveDoc prevezme #viewer — klavesy galerie se musi odvesit,
     jinak by Esc a sipky strasily nad cizim oknem */
  document.removeEventListener('keydown', fgKlavesy);
  /* prednostne original s metadaty, jinak prohlizeci kopie jako driv */
  openDriveDoc(f.origId || f.driveId, (proj(f.pid) || {}).name || f.label || 'Fotka');
}

/* ---- stranka Fotky (menu vedeni) — galerie pres vsechny stavby ---- */
function pgFotky() {
  return `
  <div class="strip"><h1>Fotky ze staveb</h1><span class="sp"></span><span class="muted">co se kde dělo — napříč zakázkami</span></div>
  <div class="sectabs">
    <div class="t active">🖼 Galerie</div>
    <div class="t" style="margin-left:auto;color:var(--navy)" onclick="dotahniZapisy()">${S.dotahuji ? '⏳ načítám…' : '⤓ Načíst starší'}</div>
  </div>
  <main>${fgTelo(null)}</main>`;
}

/* ---- Stavební deník ---- */
function pgDenik() {
  const f = S.adminFilter;
  const q = (S.searchQ || '').toLowerCase();
  let rows = S.entries.filter(e => !f || e.pid === f);
  if (q) rows = rows.filter(e => JSON.stringify([e.author, e.works, e.client, (proj(e.pid) || {}).name]).toLowerCase().includes(q));
  const fp = f ? proj(f) : null;
  return `
  <div class="strip"><h1>Denní záznamy</h1><span class="sp"></span>
    ${fp ? `<div class="proj"><b>${esc(fp.name)}</b><br><small>${esc(fp.cn)}</small></div>` : ''}
    <button class="btn ghost" onclick="S.printOpen=!S.printOpen;render()">🖨 TISK / PDF</button>
    <button class="btn amber" onclick="goPage('novy')">➕ PŘIDAT</button></div>
  <div class="sectabs">
    <div class="t active">📓 Denní záznamy</div>
    <div class="t" style="margin-left:auto;color:var(--navy)" onclick="dotahniZapisy()">${S.dotahuji ? '⏳ načítám…' : '⤓ Načíst starší'}</div>
    ${f ? `<div class="t" onclick="S.adminFilter=null;render()">✕ Zrušit filtr projektu</div>` : ''}
  </div>
  <main>
    ${S.printOpen ? `
    <div class="card">
      <h3>🖨 Tisk / export deníku do PDF</h3>
      <div class="frow">
        <div><label>Projekt</label><select id="pr-p">${S.projects.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs')).map(p => `<option value="${p.id}" ${(f || '') === p.id ? 'selected' : ''}>${esc(p.name)} (${esc(p.cn)})</option>`).join('')}</select></div>
        <div><label>Verze</label><select id="pr-v"><option value="klient">Klientská — jen schválené zápisy</option><option value="komplet">Kompletní — vše včetně interních</option></select></div>
      </div>
      <div class="frow">
        <div><label>Od (nepovinné)</label><input type="date" id="pr-f"></div>
        <div><label>Do (nepovinné)</label><input type="date" id="pr-t"></div>
      </div>
      <div class="aprv"><button class="btn amber" onclick="printDenik()">🖨 Vygenerovat</button><span class="muted" style="align-self:center">otevře se náhled — ulož jako PDF nebo vytiskni</span></div>
    </div>` : ''}
    <div class="tablecard">
      <div class="tabletools"><div class="search"><input id="q-denik" placeholder="Hledat v záznamech" value="${esc(S.searchQ)}" oninput="S.searchQ=this.value;render()"></div></div>
      <div style="overflow-x:auto"><table>
        <tr><th>Datum</th><th>Vytvořeno</th><th>Projekt</th><th>Autor zápisu</th><th>Práce</th><th>Fotky</th><th>Osoby</th><th>Stav (klient)</th></tr>
        ${rows.map(e => { const p = proj(e.pid) || {}; return `
        <tr class="click" onclick="openDetail('${e.id}')">
          <td><span class="lnk">${fmtISO(e.date)}</span></td>
          <td class="muted">${fmtTs(e.createdAt)}</td>
          <td>${esc(p.name || '')}</td>
          <td>${esc(e.author)}</td>
          <td>🛠️ <span class="muted">${(e.works || []).length} pol.</span></td>
          <td>${(e.photos || []).length ? '📷 ' + e.photos.length : '<span class="muted">—</span>'}</td>
          <td>${e.persons ? '👥 ' + e.persons : '<span class="muted">—</span>'}</td>
          <td>${sBadge(e.status)}</td>
        </tr>`; }).join('')}
      </table></div>
      <div class="pagefoot"><span>${rows.length} záznamů</span></div>
    </div>
    <div class="note">Tok: pracovník zapíše → ⏳ čeká → vedení schválí → ✓ investor vidí na portálu.</div>
  </main>`;
}

/* ---- Detail dne ---- */
function openDetail(id) { S.detail = id; render(); }
/* ---- podpis záznamu (canvas) ---- */
window._sigPaths = [];
function sigCanvas() { return document.getElementById('sig-pad'); }
function sigRedraw() {
  const c = sigCanvas(); if (!c) return;
  const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
  x.lineWidth = 2.2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#16324c';
  (window._sigPaths || []).forEach(p => { if (p.length < 2) return; x.beginPath(); x.moveTo(p[0][0], p[0][1]); p.slice(1).forEach(pt => x.lineTo(pt[0], pt[1])); x.stroke(); });
}
function sigInit() {
  const c = sigCanvas(); if (!c || c._bound) { sigRedraw(); return; }
  c._bound = true;
  const pos = ev => { const r = c.getBoundingClientRect(); return [(ev.clientX - r.left) * c.width / r.width, (ev.clientY - r.top) * c.height / r.height]; };
  c.onpointerdown = ev => { ev.preventDefault(); c.setPointerCapture(ev.pointerId); window._sigPaths.push([pos(ev)]); };
  c.onpointermove = ev => { if (ev.buttons !== 1) return; ev.preventDefault(); const p = window._sigPaths[window._sigPaths.length - 1]; if (p) { p.push(pos(ev)); sigRedraw(); } };
  sigRedraw();
}
function sigClear() { window._sigPaths = []; sigRedraw(); }
async function sigSave(eid) {
  const c = sigCanvas(); if (!c || !(window._sigPaths || []).some(p => p.length > 1)) { toast('Nejdřív se podepiš'); return; }
  const jmeno = ($('#sig-name') && $('#sig-name').value.trim()) || '—';
  await db.collection('entries').doc(eid).update({ podpis: { img: c.toDataURL('image/png'), jmeno, at: isoToday() } });
  S.signFor = null; window._sigPaths = [];
  toast('Podpis uložen ✓');
}
async function sigRemove(eid) {
  await db.collection('entries').doc(eid).update({ podpis: firebase.firestore.FieldValue.delete() });
  toast('Podpis odstraněn');
}

function pgDetail() {
  const e = S.entries.find(x => x.id === S.detail);
  if (!e) { S.detail = null; return pgDenik(); }
  const p = proj(e.pid) || {};
  const pes = entriesOf(e.pid);
  return `
  <div class="strip"><span class="back" onclick="S.detail=null;render()">←</span><h1>Denní záznam</h1><span class="sp"></span>
    ${e.status === 'pending' ? `<button class="btn ok" onclick="approveEntry('${e.id}')">✓ SCHVÁLIT PRO INVESTORA</button><button class="btn dark" onclick="keepInternalEntry('${e.id}')">🔒 JEN INTERNÍ</button>` : ''}
    <button class="btn ghost sm" title="Smazat záznam" onclick="delEntry('${e.id}')">🗑</button>
    <div class="proj"><b>${esc(p.name || '')}</b><br><small>${esc(p.cn || '')} · ${esc(p.client || '')}</small></div>
  </div>
  <div class="datestrip">
    ${pes.slice().reverse().map(x => { const dc = dchipOf(x.date); return `
      <div class="dchip ${x.id === e.id ? 'active' : ''}" onclick="openDetail('${x.id}')"><small>${dc[0]}</small><b>${dc[1]}</b><span class="dot" style="background:${x.status === 'approved' ? 'var(--ok)' : x.status === 'pending' ? 'var(--wait)' : 'var(--int)'}"></span></div>`; }).join('')}
    <span class="muted" style="margin-left:auto;white-space:nowrap">📅 ${fmtISOFull(e.date)}</span>
  </div>
  <main>
    <div class="grid-detail">
      <div>
        <div class="card">
          <div class="chip-author">👷 ${esc(e.author)}${e.persons ? ' · ' + e.persons + ' os.' : ''}</div>
          ${e.weather ? `<div class="muted" style="margin:6px 0 2px">🌤 ${esc(e.weather)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center"><h3>Provedené práce</h3>${sBadge(e.status)}</div>
          ${zapisEditHtml(e)}
          <div class="inote">🔒 <b>Interní poznámka</b> <span style="font-weight:400">— investor ji nikdy neuvidí</span>
            <textarea id="int-${e.id}" style="min-height:56px;margin-top:6px" placeholder="Co nechceš, aby viděl klient…">${esc(interniPozn(e.id))}</textarea>
            <div class="aprv" style="margin-top:8px">
              <button class="btn ghost sm" onclick="saveInternal('${e.id}')">💾 Uložit</button>
              ${interniPozn(e.id) ? `<button class="btn ghost sm" onclick="delInternal('${e.id}')">🗑 Smazat</button>
              <button class="btn ghost sm" onclick="noteToTask('${e.id}')">📌 Převést na úkol</button>` : ''}
            </div>
          </div>
        </div>
        <div class="card">
          <h3>📷 Média na záznamu <span class="muted" style="font-weight:400">— klik na štítek: ⏳ čeká → ✓ klient → 🔒 interní</span></h3>
          ${(e.photos || []).length ? `<div class="photos">${e.photos.map(ph => phTile(ph, false, e.id)).join('')}</div>` : '<div class="muted" style="margin-top:8px">Média na záznamu: 0</div>'}
        </div>
      </div>
      <div>
        <div class="card">
          <h3>🏠 Znění pro investora</h3>
          ${e.status === 'pending'
            ? `<div class="muted" style="margin-bottom:6px">Uprav před schválením — tohle uvidí klient:</div><textarea id="ct-${e.id}">${esc(e.client)}</textarea>
              <div class="aprv"><button class="btn ok" onclick="approveEntry('${e.id}')">✓ Schválit</button><button class="btn dark" onclick="keepInternalEntry('${e.id}')">🔒 Jen interní</button></div>`
            : e.status === 'approved'
              ? `<div>${esc(e.client).replace(/\n/g, '<br>')}</div><div class="note" style="margin-top:10px">Investor tento text vidí na svém portálu ✓ ${e.approvedBy ? '· schválil(a) ' + esc(e.approvedBy) : ''}</div>
                <div class="aprv"><button class="btn ghost sm" onclick="otevriZapis('${e.id}')">✏️ Opravit znění</button>
                  <button class="btn dark sm" onclick="stahnoutZPortalu('${e.id}')">🔒 Stáhnout z portálu</button></div>`
              : `<div class="muted">Záznam je interní — investor jej nevidí.</div><div class="aprv"><button class="btn ok sm" onclick="vratKeSchvaleni('${e.id}')">↩ Vrátit ke schválení</button>
                  <button class="btn ghost sm" onclick="otevriZapis('${e.id}')">✏️ Opravit zápis</button></div>`}
        </div>
        <div class="card">
          <h3>👥 Osoby na staveništi <span class="muted" style="font-weight:400">— z docházky</span></h3>
          ${(() => { const os = attOn(e.pid, e.date); return os.length ? os.map(o => `<div class="kv"><span>${esc(o.name)}</span><b>${o.prichod || '—'} – ${o.odchod || '—'}</b></div>`).join('') : '<div class="muted">K tomuto dni není v systému docházka.</div>'; })()}
        </div>
        <div class="card">
          <h3>📎 Přílohy</h3>
          <div class="note" style="margin-top:0">Přílohy se investorovi neposílají — na portál se zrcadlí jen text pro klienta a schválené fotky, v PDF deníku se vypíše pouze název přílohy. Co má investor vidět, patří do textu zápisu nebo mezi fotky.</div>
          ${(e.attachments || []).map((a, i) => `<div class="urow" style="cursor:pointer" onclick="otevritPrilohu('${e.id}',${i})"><span>${(a.mime || '').includes('pdf') ? '📄' : '🖼'}</span><b>${esc(a.name)}</b><span class="muted" style="margin-left:auto">${a.driveId ? 'zobrazit' : a.data ? 'zobrazit' : 'čeká na odeslání'}</span></div>`).join('') || '<div class="muted">Žádné přílohy.</div>'}
          <div class="aprv"><input type="file" id="att-${e.id}" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onchange="addAttsToEntry('${e.id}',this.files)"></div>
        </div>
        <div class="card">
          <h3>✍ Podpis záznamu</h3>
          ${e.podpis ? `<img src="${e.podpis.img}" style="max-width:240px;border:1px solid var(--line);border-radius:6px;background:#fff"><div class="muted" style="margin-top:4px">${esc(e.podpis.jmeno)} · ${fmtISO(e.podpis.at)}</div><div class="aprv"><button class="btn ghost sm" onclick="sigRemove('${e.id}')">✕ Odstranit podpis</button></div>`
    : S.signFor === e.id ? `
            <label>Jméno podepisujícího</label><input type="text" id="sig-name" value="${esc(p.client || '')}">
            <canvas id="sig-pad" width="460" height="150" style="width:100%;max-width:460px;border:1.5px dashed #9aa7b5;border-radius:8px;background:#fff;touch-action:none;margin-top:6px"></canvas>
            <div class="aprv"><button class="btn amber sm" onclick="sigSave('${e.id}')">💾 Uložit podpis</button><button class="btn ghost sm" onclick="sigClear()">↺ Znovu</button><button class="btn ghost sm" onclick="S.signFor=null;window._sigPaths=[];render()">Zrušit</button></div>
            <div class="note">Podepiš prstem nebo myší — např. investor při kontrolním dnu. Podpis se ukáže i v PDF exportu deníku.</div>`
    : `<div class="muted">Záznam není podepsán.</div><div class="aprv"><button class="btn ghost sm" onclick="S.signFor='${e.id}';window._sigPaths=[];render()">✍ Podepsat</button></div>`}
        </div>
        <div class="card">
          <h3>ℹ️ Projekt</h3>
          <div class="kv"><span>Zakázka</span><b>${esc(p.cn || '')}</b></div>
          <div class="kv"><span>Investor</span><span>${esc(p.client || '')}</span></div>
          <div class="kv"><span>Fáze</span><span>${esc(projPhase(p) || '—')} (${projProgress(p) != null ? projProgress(p) + ' %' : 'harmonogram nezadán'})</span></div>
        </div>
      </div>
    </div>
  </main>`;
}
/* Poznamku slo drive napsat jen jednou — jakmile byla ulozena, policko zmizelo
   a nesla ani opravit, ani smazat. Ted je to normalni editovatelne pole. */
async function saveInternal(eid) {
  const t = $('#int-' + eid).value.trim();
  /* Poznamka bydli v admin-only /entries_interni (S5) — zapis samotny
     ctou vsechny role a Firestore neumi skryt jedno pole. */
  if (t) await db.collection('entries_interni').doc(eid).set({ text: t });
  else await db.collection('entries_interni').doc(eid).delete().catch(() => {});
  zapomen('int-' + eid);
  toast(t ? 'Interní poznámka uložena ✓' : 'Interní poznámka smazána');
}
async function delInternal(eid) {
  if (!await potvrd('Smazat interní poznámku?')) return;
  await db.collection('entries_interni').doc(eid).delete().catch(() => {});
  zapomen('int-' + eid);
  toast('Interní poznámka smazána');
}
async function noteToTask(eid) {
  const e = S.entries.find(x => x.id === eid);
  const pozn = interniPozn(eid);
  if (!pozn) { toast('Zápis nemá interní poznámku'); return; }
  await db.collection('tasks').add({ title: pozn.split('—')[0].trim().slice(0, 120), zadalId: S.me ? S.me.id : '', zadal: fullName(S.me || {}), pid: e.pid, respId: S.me ? S.me.id : '', resp: fullName(S.me || {}), created: isoToday(), term: shiftISO(isoToday(), 2), stav: 'nove', res: [fullName(S.me || {})], src: 'z deníku ' + fmtISO(e.date), createdAt: FV() });
  toast('Interní poznámka převedena na úkol ✓');
}

/* ---- Schvalování ---- */
function pgSchvaleni() {
  const items = pendingEntries();
  return `
  <div class="strip"><h1>Schvalování</h1><span class="sp"></span><span class="muted">${items.length} čeká</span></div>
  <main>
    ${items.length ? items.map(e => { const p = proj(e.pid) || {}; return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
          <h3>${esc(p.name || '')} — ${fmtISOFull(e.date)}</h3><span class="badge b-wait">⏳ čeká</span>
        </div>
        <div class="muted">Zapsal: ${esc(e.author)} · ${fmtTs(e.createdAt)}</div>
        <ul class="worklist">${(e.works || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
        ${interniPozn(e.id) ? `<div class="inote">🔒 ${esc(interniPozn(e.id))}</div>` : ''}
        ${(e.photos || []).length ? `<div class="photos">${e.photos.map(ph => phTile(ph, false, e.id)).join('')}</div>` : ''}
        <label>Znění pro investora</label>
        <textarea id="ct-${e.id}">${esc(e.client)}</textarea>
        <div class="aprv">
          <button class="btn ok" onclick="approveEntry('${e.id}')">✓ Schválit pro investora</button>
          <button class="btn dark" onclick="keepInternalEntry('${e.id}')">🔒 Ponechat jen interní</button>
          <button class="btn ghost sm" onclick="openDetail('${e.id}')">Otevřít detail</button>
        </div>
      </div>`; }).join('')
    : `<div class="card"><div class="empty">🎉 Nic nečeká na schválení.<br><span class="muted">Nové zápisy pracovníků se objeví tady.</span></div></div>`}
    <div class="note">Zásada (#31): investor nikdy nevidí nic neschváleného. Fotky 🔒 zůstávají navždy interní.</div>
  </main>`;
}

/* ---- Tisk / PDF export deníku ---- */
/* Naživo je jen posledni mesic (OKNO_DNU) — oficialni denik ale musi
   obsahovat celou historii stavby. Pred tiskem se proto zapisy stavby
   dotahnou z databaze (jednou za seanci; archiv je pak drzi, viz slozOkno).
   U stavby zalozene az uvnitr okna neni co dotahovat. */
S.dotazenoTisk = S.dotazenoTisk || [];
async function dotahniProTisk(pid, from) {
  if (from && from >= oknoOd()) return;             // tiskne se jen usek, ktery mame naživo
  if (S.dotazenoTisk.includes(pid)) return;
  const p = proj(pid);
  const vznik = p && p.createdAt && p.createdAt.toDate ? p.createdAt.toDate().toISOString().slice(0, 10) : null;
  if (vznik && vznik >= oknoOd()) return;           // mlada stavba — starsi zapisy mit nemuze
  S.dotahuji = true; render();
  try {
    const snap = await db.collection('entries').where('pid', '==', pid).get();
    archivujDotazene('entries', snap.docs.map(d => ({ id: d.id, ...d.data() })));
    S.dotazenoTisk.push(pid);
  } catch (e) {
    /* bez spojeni radsi tisknout s varovanim nez vubec */
    await oznam('⚠ Starší zápisy se nepodařilo načíst (' + (e.code || e.message) + ').\n\nTisk obsáhne jen posledních ' + OKNO_DNU + ' dní!');
  }
  S.dotahuji = false; render();
}
async function printDenik() {
  const pid = $('#pr-p').value, verze = $('#pr-v').value, from = $('#pr-f').value, to = $('#pr-t').value;
  const p = proj(pid); if (!p) { toast('Vyber projekt'); return; }
  /* Nove okno musi otevrit primo klik — po await by ho prohlizec zablokoval. */
  const w = window.open('', '_blank');
  if (!w) { toast('Prohlížeč zablokoval nové okno — povol vyskakovací okna'); return; }
  w.document.write('<!DOCTYPE html><meta charset="utf-8"><p style="font-family:sans-serif;color:#555">Připravuji deník…</p>');
  await dotahniProTisk(pid, from);
  let list = S.entries.filter(e => e.pid === pid);
  if (verze === 'klient') list = list.filter(e => e.status === 'approved');
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);
  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!list.length) { w.close(); toast('Žádné záznamy pro zvolený výběr'); return; }
  /* dochazka pro radek "Na stavenisti" u dnu pred oknem (dotahne se jednou,
     archiv ji drzi; pri selhani se jen u starych dnu radek nevypise) */
  if ((list[0].date || '') < oknoOd()) await dotahniDochazku(list[0].date, to || isoToday());
  const perioda = (from || to) ? `${from ? fmtISO(from) : '…'} – ${to ? fmtISO(to) : '…'}` : `${fmtISO(list[0].date)} – ${fmtISO(list[list.length - 1].date)}`;
  const bloky = list.map(e => `
    <div class="zaznam">
      <div class="zhead"><b>${fmtISOFull(e.date)}</b><span>${esc(e.author)}${e.persons ? ' · osob na staveništi: ' + e.persons : ''}${e.status === 'approved' ? '' : e.status === 'internal' ? ' · INTERNÍ' : ' · neschváleno'}</span></div>
      ${e.weather ? `<div class="meta">Počasí: ${esc(e.weather)}</div>` : ''}
      ${(() => { const os = attOn(e.pid, e.date); return os.length ? `<div class="meta">Na staveništi: ${os.map(o => esc(o.name) + (o.prichod || o.odchod ? ' (' + (o.prichod || '—') + '–' + (o.odchod || '—') + ')' : '')).join(', ')}</div>` : ''; })()}
      <ul>${(e.works || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      ${(e.attachments || []).length ? `<div class="meta">Přílohy: ${e.attachments.map(a => esc(a.name)).join(', ')}</div>` : ''}
      ${e.podpis ? `<div class="zpodpis"><img src="${e.podpis.img}">podepsáno: ${esc(e.podpis.jmeno)} · ${fmtISO(e.podpis.at)}</div>` : ''}
      ${verze === 'komplet' && interniPozn(e.id) ? `<div class="interni">Interní poznámka: ${esc(interniPozn(e.id))}</div>` : ''}
      ${(e.photos || []).filter(ph => verze === 'komplet' || ph.status === 'approved').length ? `<div class="fotky">${(e.photos || []).filter(ph => verze === 'komplet' || ph.status === 'approved').map(ph => `<img src="${ph.thumb}">`).join('')}</div>` : ''}
    </div>`).join('');
  const html = `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><title>Stavební deník — ${esc(p.name)}</title>
  <style>
    body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:40px;font-size:13px;line-height:1.45}
    h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;font-weight:normal;margin:0 0 18px;color:#444}
    .hlava{display:flex;justify-content:space-between;border-bottom:3px solid #1a3c5e;padding-bottom:12px;margin-bottom:6px}
    .hlava .firma{text-align:right;font-size:11px;color:#333}
    table.info{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:12px}
    table.info td{border:1px solid #bbb;padding:5px 8px}table.info td:first-child{background:#f2f5f8;width:160px;font-weight:bold}
    .zaznam{border:1px solid #ccc;border-radius:4px;padding:10px 14px;margin-bottom:10px;page-break-inside:avoid}
    .zhead{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding-bottom:5px;margin-bottom:6px}
    .zhead span{color:#555;font-size:11.5px}
    ul{margin:4px 0 4px 18px;padding:0}li{margin-bottom:2px}
    .interni{background:#fdf6e3;border-left:3px solid #c9a227;padding:5px 8px;margin-top:6px;font-size:12px;white-space:pre-wrap}
    .meta{font-size:11.5px;color:#555;margin:2px 0}
    .zpodpis{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11px;color:#555}.zpodpis img{height:44px;border:1px solid #ddd;border-radius:3px;background:#fff}
    .fotky{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.fotky img{height:85px;border:1px solid #ccc;border-radius:3px}
    .podpisy{display:flex;justify-content:space-between;margin-top:50px;page-break-inside:avoid}
    .podpisy div{width:42%;border-top:1px solid #333;padding-top:6px;font-size:12px;text-align:center}
    .pata{margin-top:26px;font-size:10px;color:#777;text-align:center}
    @media print{body{margin:12mm}}
  </style></head><body>
  <div class="hlava">
    <div><h1>STAVEBNÍ DENÍK${verze === 'klient' ? '' : ' — kompletní interní verze'}</h1><h2>${esc(p.name)} · zakázka ${esc(p.cn || '')}</h2></div>
    <div class="firma"><b>Rekonstrukce Vrána s.r.o.</b><br>IČ: 198 53 572<br>Ještědská 121, Kunratice, 148 00 Praha 4<br>tel. 702 111 001 · info@rekovrana.cz</div>
  </div>
  <table class="info">
    <tr><td>Stavba / adresa</td><td>${esc(p.address || '')}</td></tr>
    <tr><td>Investor</td><td>${esc(p.client || '')}</td></tr>
    <tr><td>Typ projektu</td><td>${esc(p.type || '')}</td></tr>
    <tr><td>Období</td><td>${perioda} · ${list.length} denních záznamů</td></tr>
  </table>
  ${bloky}
  <div class="podpisy"><div>za zhotovitele<br>(Rekonstrukce Vrána s.r.o.)</div><div>za objednatele<br>(${esc(p.client || 'investor')})</div></div>
  <div class="pata">Vygenerováno ze systému Deník staveb Rekonstrukce Vrána · ${fmtISOFull(isoToday())}</div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))<\/script>
  </body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

/* ---- Nový záznam (admin) ---- */
function pgNovy() {
  return `
  <div class="strip"><span class="back" onclick="goPage('denik')">←</span><h1>Nový denní záznam</h1><span class="sp"></span></div>
  <main style="max-width:640px">
    <div class="card">
      <label>Projekt</label>
      <select id="np">${S.projects.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.cn)})</option>`).join('')}</select>
      <label>Autor zápisu</label>
      <select id="na">${S.users.filter(u => u.active !== false && u.typ && (u.typ.teren || u.typ.kanc || u.typ.sub)).map(u => `<option ${S.me && u.id === S.me.id ? 'selected' : ''}>${esc(fullName(u))}</option>`).join('')}</select>
      <label>Datum zápisu</label><input type="date" id="nd" value="${isoToday()}" max="${isoToday()}">
      <label>Provedené práce</label>
      <textarea id="nt" placeholder="Každá věta / řádek = jedna odrážka zápisu…"></textarea>
      <label>Fotky</label>
      <input type="file" id="nph" accept="image/*" multiple onchange="processPhotos(this.files)">
      <div class="photos">${S.draftPhotos.map((p, i) => `<div class="ph"><img src="${p.thumb}"><span class="del" onclick="S.draftPhotos.splice(${i},1);render()">✕</span><small>${esc(p.label)}</small></div>`).join('')}</div>
      <label>Přílohy (PDF, dokumenty)</label>
      <input type="file" id="natt" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" multiple onchange="processAtts(this.files)">
      ${(S.draftAtts || []).length ? `<div style="margin-top:6px">${S.draftAtts.map((a, i) => `<div class="urow"><span>📎</span><b>${esc(a.name)}</b><span class="lnk" style="margin-left:auto" onclick="S.draftAtts.splice(${i},1);render()">✕</span></div>`).join('')}</div>` : ''}
      <div class="aprv"><button class="btn amber" id="save-entry" onclick="submitNew()">💾 ULOŽIT ZÁZNAM</button><span class="muted" style="align-self:center">→ zařadí se do fronty schvalování</span></div>
    </div>
  </main>`;
}
async function submitNew() {
  // pocet osob se nezadava — bere se z dochazky (zadani 25. 8.)
  const pid = $('#np').value, author = $('#na').value, txt = $('#nt').value.trim();
  const date = $('#nd') ? ($('#nd').value || isoToday()) : isoToday();
  if (!pid) { toast('Není vybraný projekt'); return; }
  if (date > isoToday()) { toast('Datum zápisu nemůže být v budoucnosti'); return; }
  if (!txt && !S.draftPhotos.length) { toast('Napiš text nebo přidej fotku'); return; }
  $('#save-entry').disabled = true;
  await addEntry(pid, author, txt, null, date);
  zapomen('nt');
  goPage('denik'); toast(date === isoToday() ? 'Záznam uložen — čeká na schválení ✓' : 'Záznam za ' + fmtISO(date) + ' uložen — čeká na schválení ✓');
}

/* ---- Organizace — docházka ---- */

/* Kdy je odchylka OBVINENI a kdy jen nepresne mereni.
   Telefon umi vratit polohu z wifi nebo ze site — ta byva klidne kilometry
   vedle a aplikace to pak ukazovala jako "podezrela GPS". Mereni, ktere si
   samo pripousti vetsi chybu, nez je povolena odchylka, nedokazuje nic.
   Stara data presnost ulozenou nemaji — u tech se nic nemeni. */
function gpsPresnostOk(a) {
  return !a || a.gpsPresnost == null || a.gpsPresnost <= (CFG.gpsTolerance || 100);
}
function gpsPodezrela(a) {
  return !!a && a.gps > (CFG.gpsTolerance || 100) && gpsPresnostOk(a) && !a.gpsProvereno;
}
/* Jedno misto, kde se kresli bunka "GPS odchylka" — tabulka i nastenka. */
function gpsBunka(a) {
  const TOL = CFG.gpsTolerance || 100;
  if (a.gps == null) return '<span class="muted">bez GPS</span>';
  const odch = Math.round(a.gps).toLocaleString('cs');
  if (a.gps <= TOL) return `<span class="muted">${odch} m</span>`;
  if (!gpsPresnostOk(a)) return `<span class="muted" title="Telefon polohu jen odhadl (z wifi nebo ze sítě), ne z GPS. Odchylka ${odch} m z toho nic nedokazuje.">poloha nepřesná (±${Math.round(a.gpsPresnost).toLocaleString('cs')} m)</span>`;
  if (a.gpsProvereno) return `<span class="muted" title="Prověřil(a) ${esc(a.gpsProvereno.kdo || '')}">${odch} m · ✓ prověřeno</span>`;
  return `<b style="color:var(--red)">⚠ ${odch} m</b>`;
}
/* Podezrelou polohu musi jit odbavit. Driv sla jen opravit nebo smazat —
   a cervene cislo v listě svitilo dal cely mesic, takze prestalo cokoli
   znamenat. Zaznam zustava, jen zesedne a vypadne z pocitadla. */
async function attGpsProvereno(id) {
  const a = S.attendance.find(x => x.id === id); if (!a) return;
  if (!await potvrd('Označit polohu jako prověřenou?\n\n' + (a.userName || '?') + ' — ' +
               fmtISO(a.date) + ' ' + a.time + '\n\nZáznam zůstane, jen přestane svítit červeně a zmizí z počítadla.')) return;
  try {
    await db.collection('attendance').doc(id).update({
      gpsProvereno: { kdo: fullName(S.me || {}), kdy: new Date().toISOString() }
    });
    toast('Prověřeno ✓');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
function pgOrganizace() {
  const TOL = CFG.gpsTolerance || 100;
  const f = S.orgFilter;
  let rows = S.attendance.slice();
  /* Zaznam dochazky "ceka na schvaleni" uz neexistuje — schvalovani se
     prestehovalo do /zadosti (pracovnik posle zadost, vedeni ji promeni
     v zaznam). Filtr na schvaleno===false proto zmizel, byl vzdycky prazdny
     a tabulka pod cislem v zalozce ukazovala 0 zaznamu. */
  if (f === 'gps') rows = rows.filter(gpsPodezrela);
  // filtr podle pracovníka a projektu
  if (S.orgUser) rows = rows.filter(a => a.userDocId === S.orgUser);
  if (S.orgProj) rows = rows.filter(a => a.pid === S.orgProj);
  const attIds = new Set(S.attendance.map(a => a.userDocId));
  const filtUsers = S.users.filter(u => (u.typ && u.typ.teren) || attIds.has(u.id))
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'cs'));
  return `
  <div class="strip"><h1>Organizace — Záznamy docházky</h1><span class="sp"></span>
    <button class="btn amber" onclick="S.attFormOpen=!S.attFormOpen;render()">➕ PŘIDAT PRACOVNÍ DEN</button></div>
  <div class="sectabs">
    <div class="t ${f === 'vse' ? 'active' : ''}" onclick="S.orgFilter='vse';render()">🗂 Všechny záznamy</div>
    <div class="t ${f === 'gps' ? 'active' : ''}" onclick="S.orgFilter='gps';render()">📍 Podezřelá GPS (${S.attendance.filter(gpsPodezrela).length})</div>
    <div class="t ${f === 'zadosti' ? 'active' : ''}" onclick="S.orgFilter='zadosti';render()">🕗 Žádosti o doplnění (${cekajiciZadosti().length})</div>
    <div class="t ${f === 'subi' ? 'active' : ''}" onclick="S.orgFilter='subi';render()">🧰 Subdodavatelé (${S.hlaseni.length})</div>
  </div>
  ${f === 'subi' ? `<main>
    <div class="tablecard"><table>
      <tr><th>Datum</th><th>Příchod</th><th>Odchod</th><th>Doba</th><th>Subdodavatel</th><th>Stavba</th><th>Lidí</th><th>Činnost</th><th></th></tr>
      ${S.hlaseni.map(h => `<tr>
        <td>${fmtISO(h.date)}</td><td>${h.prichod || h.time || ''}</td>
        <td>${h.odchod || '<span class="badge b-wait">na stavbě</span>'}</td>
        <td>${h.odchod ? dobaText(h.prichod || h.time, h.odchod) : (h.date === isoToday() ? dobaText(h.prichod || h.time) + '…' : '<b style="color:var(--red)">bez odchodu</b>')}</td>
        <td><span class="uav" style="margin-right:6px">${ini(userById(h.userDocId) || { jmeno: h.userName })}</span>${esc(h.userName || '')}</td>
        <td>${esc((proj(h.pid) || {}).name || '')}</td>
        <td style="text-align:center"><b>${h.pocet || 1}</b></td>
        <td>${esc(h.cinnost || '')}${h.zaznam ? `<br><span class="muted" title="${esc(h.zaznam)}">📝 ${esc(h.zaznam.slice(0, 60))}${h.zaznam.length > 60 ? '…' : ''}</span>` : ''}</td>
        <td><span class="lnk" onclick="subSmazatHlaseni('${h.id}')">✕</span></td>
      </tr>`).join('') || '<tr><td colspan="9"><div class="empty">Zatím žádná hlášení. Subdodavatelé je zapisují ve svém vchodu.</div></td></tr>'}
    </table></div>
    <div class="note">Hlášení přítomnosti od subdodavatelů — kdo, kde, s kolika lidmi a co dělali. Podklad pro měsíční kontrolu fakturace. Hodiny se z nich nepočítají.</div>
  </main>` : `<main>
    ${cekajiciZadosti().length ? `
    <div class="card" style="border:2px solid var(--amber)">
      <h3>🕗 Žádosti od party — doplnění zapomenutého odchodu (${cekajiciZadosti().length})</h3>
      <div class="note" style="margin-top:0">Do docházky se nic nezapsalo. Zápis vznikne až tím, že žádost schválíš.</div>
      ${cekajiciZadosti().map(z => `
        <div class="urow" style="align-items:flex-start;padding:11px 4px">
          <span class="uav" style="margin-top:2px">${ini(userById(z.userDocId) || { jmeno: z.userName })}</span>
          <div style="flex:1">
            <b>${esc(z.userName || '')}</b> — odchod <b>${fmtISO(z.date)} v ${esc(z.time)}</b>
            ${z.pauza ? ` <span class="badge b-int">pauza ${z.pauza} min</span>` : ''}
            <br><span class="muted">${esc((proj(z.pid) || {}).name || '')} · příchod byl ${fmtISO(z.prichodDate || z.date)} v ${esc(z.prichodTime || '?')}</span>
            ${z.poznamka ? `<br><span class="muted">„${esc(z.poznamka)}"</span>` : ''}
          </div>
          <span style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn ok sm" onclick="zadostSchvalit('${z.id}')">✓ Schválit a zapsat</button>
            <button class="btn red sm" onclick="zadostZamitnout('${z.id}')">✕ Zamítnout</button>
          </span>
        </div>`).join('')}
    </div>` : ''}
    ${f === 'zadosti' && !cekajiciZadosti().length ? `
    <div class="card">
      <h3>🕗 Žádosti o doplnění</h3>
      <div class="empty">Žádná žádost nečeká. Když někdo z party zapomene píchnout odchod a doplní ho z mobilu, objeví se to tady.</div>
    </div>` : ''}
    ${S.attFormOpen ? `
    <div class="card">
      <h3>➕ Přidat pracovní den (ručně — když pracovník zapomene)</h3>
      <div class="frow">
        <div><label>Terénní pracovník</label><select id="at-u">${S.users.filter(u => u.typ && u.typ.teren && u.active !== false).map(u => `<option value="${u.id}">${esc(fullName(u))}</option>`).join('')}</select></div>
        <div><label>Projekt</label><select id="at-p">${S.projects.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      <div class="frow">
        <div><label>Činnost</label><select id="at-a"><option>Příchod</option><option>Odchod</option></select></div>
        <div><label>Datum a čas</label><div class="frow"><input type="date" id="at-d" value="${isoToday()}"><input type="time" id="at-t" value="07:00"></div></div>
      </div>
      <label>Pauza na oběd (minuty)</label>
      <input type="number" id="at-pauza" value="0" min="0" max="240" step="5" style="max-width:140px">
      <div class="note">Zadává se u odchodu. Odečte se od odpracovaných hodin za ten den. <b>Vyplněné číslo přebíjí pauzu z časovače</b> — když si ten den pracovník pauzu ťukal v mobilu, počítá se tvoje hodnota, ne jeho. Nula = nechat pauzu z časovače.</div>
      <div class="aprv"><button class="btn amber" onclick="addAtt()">💾 ULOŽIT</button><span class="muted" style="align-self:center">označí se „opraveno administrátorem"</span></div>
    </div>` : ''}
    <div class="card">
      <div class="frow">
        <div><label>Filtr — pracovník</label><select onchange="S.orgUser=this.value;render()">
          <option value="">Všichni pracovníci</option>
          ${filtUsers.map(u => `<option value="${u.id}" ${S.orgUser === u.id ? 'selected' : ''}>${esc(fullName(u))}</option>`).join('')}
        </select></div>
        <div><label>Filtr — projekt</label><select onchange="S.orgProj=this.value;render()">
          <option value="">Všechny projekty</option>
          ${S.projects.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs')).map(p => `<option value="${p.id}" ${S.orgProj === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>
      </div>
      ${(S.orgUser || S.orgProj) ? `<div class="aprv"><button class="btn ghost sm" onclick="S.orgUser='';S.orgProj='';render()">✕ Zrušit filtr</button><span class="muted" style="align-self:center">zobrazeno ${rows.length} z ${S.attendance.length} záznamů</span></div>` : ''}
    </div>
    <div class="tablecard">
      <div style="overflow-x:auto"><table>
        <tr><th>Terénní pracovník</th><th>Činnost</th><th>Na projektu</th><th>Datum a čas</th><th>GPS odchylka</th><th>Foto</th><th></th></tr>
        ${rows.map(a => { const u = userById(a.userDocId) || { jmeno: a.userName || '?', prijmeni: '' }; return `
        <tr${a.gpsProvereno ? ' style="opacity:.62"' : ''}>
          <td><span class="uav" style="margin-right:6px">${ini(u)}</span>${esc(fullName(u))}</td>
          <td><span class="badge ${a.akce === 'Příchod' ? 'b-ok' : 'b-int'}">${a.akce}</span></td>
          <td>${esc((proj(a.pid) || {}).name || a.projName || '')}</td>
          <td>${fmtISO(a.date)} ${a.time}${a.pauza ? `<br><span class="badge b-int" title="Pauzu zadalo ručně vedení — přebíjí pauzu z časovače v mobilu.">🥪 pauza ${a.pauza} min · ručně</span>` : ''}${a.upraveno ? `<br><span class="badge b-wait" title="${esc(a.upraveno.duvod || '')}">✏️ opraveno — ${esc(a.upraveno.kdo || '')}</span>` : ''}${a.zapsal ? `<br><span class="badge b-wait">✍ zapsalo vedení — ${esc(a.zapsal.kdo || '')}</span>` : ''}</td>
          <td>${gpsBunka(a)}</td>
          <td>${a.selfie ? `<img src="${a.selfie}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="openPhoto('${a.selfieDriveId || ''}','ověřovací foto — ${esc(a.userName || '')}',this.parentElement)">` : a.manual ? '<span class="badge b-wait">admin</span>' : '<b style="color:var(--red)">chybí</b>'}</td>
          <td style="white-space:nowrap">
            ${gpsPodezrela(a) ? `<button class="btn ok sm" title="Poloha je v pořádku — odbavit" onclick="attGpsProvereno('${a.id}')">✓ Prověřeno</button>` : ''}
            <button class="btn ghost sm" title="Opravit" onclick="attUpravitForm('${a.id}')">✏️</button>
            <button class="btn ghost sm" title="Smazat" onclick="attSmazat('${a.id}')">🗑</button>
          </td>
        </tr>`; }).join('') || `<tr><td colspan="7"><div class="empty">${
          f === 'gps' ? 'Žádná podezřelá GPS — všechna píchnutí sedí na stavbu, nebo jsi je už prověřil ✓'
          : (S.orgUser || S.orgProj) ? 'Tomuto filtru neodpovídá žádný záznam. Zruš ho tlačítkem ✕ o kus výš.'
          : 'Zatím žádné záznamy docházky. Objeví se tu, jakmile si někdo z party píchne příchod.'}</div></td></tr>`}
      </table></div>
      <div class="pagefoot"><span>${rows.length} záznamů</span></div>
    </div>
    <div class="note">GPS nad povolenou odchylku (${TOL} m) se hlásí ⚠ — ale jen tehdy, když telefon polohu opravdu změřil. Když ji jen odhadl ze sítě, píše se „poloha nepřesná" a za podezřelou se to nepočítá. Odchylku, kterou jsi prověřil tlačítkem <b>✓ Prověřeno</b>, zešedne a zmizí z počítadla. Záznam jde <b>✏️ opravit</b> nebo <b>🗑 smazat</b> — u opravy se uloží kdo, kdy a proč, ať je to při sporu o výplatu dohledatelné. Měsíční kontrola hodin Ruslana (#25) = záložka Reporty.</div>
  </main>`}`;
}
/* POZOR na authUid: rozhoduje o tom, komu se zaznam v mobilu ZOBRAZI.
   Drive se sem psalo uid toho, kdo zaznam pridal (tedy vedeni), takze oprava
   se k pracovnikovi nikdy nedostala — jeho telefon dal tvrdil "jsi v praci"
   a rano nesel pichnout prichod. Musi to byt uid toho, KOHO se zaznam tyka. */
function authUidOsoby(u) { return (u && u.uid) || (S.authUser ? S.authUser.uid : ''); }
async function addAtt() {
  const userDocId = $('#at-u').value, pid = $('#at-p').value, akce = $('#at-a').value;
  const date = $('#at-d').value || isoToday(), time = $('#at-t').value || '07:00';
  const pauza = Math.max(0, parseInt(($('#at-pauza') || {}).value, 10) || 0);
  const u = userById(userDocId);
  if (!u) { toast('Vyber pracovníka'); return; }
  if (!u.uid) toast('⚠ Pracovník zatím nemá přihlášení — v jeho mobilu se záznam ukáže až potom');
  await db.collection('attendance').add({
    userDocId, userName: fullName(u), authUid: authUidOsoby(u), akce, pid, date, time,
    gps: null, selfie: null, manual: true, schvaleno: true, pauza,
    zapsal: { kdo: fullName(S.me || {}), kdy: new Date().toISOString() }, createdAt: FV()
  });
  S.attFormOpen = false; toast('Záznam přidán (opraveno administrátorem)'); render();
}

/* Opravy dochazky. Kazda zmena nese stopu (kdo, kdy) — u evidence hodin
   musi byt dohledatelne, kdo do zaznamu sahnul. */
function attUpravitForm(id) {
  const a = S.attendance.find(x => x.id === id); if (!a) return;
  const u = userById(a.userDocId) || {};
  modal(`<h3>✏️ Opravit záznam docházky</h3>
    <div class="note" style="margin-top:0">${esc(fullName(u) || a.userName || '?')} ·
      původně <b>${esc(a.akce)}</b> ${fmtISO(a.date)} ${esc(a.time)}</div>
    <div class="frow">
      <div><label>Činnost</label><select id="ae-a">
        ${/* Pauzovy zaznam se opravou nesmi tise zmenit na Prichod (drive tu
            byly jen Prichod/Odchod a u Pauzy nebylo nic selected → ulozil se
            Prichod a pauza se prestala odecitat). Nabizi se proto jen dvojice
            akci stejneho druhu a skutecna akce je predvybrana. */''}
        ${(a.akce === 'Pauza' || a.akce === 'Konec pauzy' ? ['Pauza', 'Konec pauzy'] : ['Příchod', 'Odchod']).map(x => `<option ${a.akce === x ? 'selected' : ''}>${x}</option>`).join('')}
      </select></div>
      <div><label>Stavba</label><select id="ae-p">
        ${S.projects.map(p => `<option value="${p.id}" ${p.id === a.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></div>
    </div>
    <div class="frow">
      <div><label>Datum</label><input type="date" id="ae-d" value="${esc(a.date || isoToday())}"></div>
      <div><label>Čas</label><input type="time" id="ae-t" value="${esc(String(a.time || '07:00').split(':').map((x, i) => i === 0 ? String(x).padStart(2, '0') : x).join(':'))}"></div>
    </div>
    <label>Pauza na oběd (minuty)</label>
    <input type="number" id="ae-pauza" value="${a.pauza || 0}" min="0" max="240" step="5" style="max-width:140px">
    <div class="note" style="margin-top:6px">Vyplněné číslo <b>přebíjí pauzu z časovače</b> za ten den. Nula = nechat, co naťukal pracovník v mobilu.${
      S.attendance.some(x => x.userDocId === a.userDocId && x.date === a.date && (x.akce === 'Pauza' || x.akce === 'Konec pauzy'))
        ? ' <b style="color:var(--red)">Pozor: ' + fmtISO(a.date) + ' už pauza z časovače existuje — vyplněním ji přepíšeš.</b>' : ''}</div>
    <label>Důvod opravy (uvidí ho vedení u záznamu)</label>
    <input type="text" id="ae-duvod" placeholder="např. zapomněl píchnout odchod, nahlásil telefonem">
    <div class="aprv">
      <button class="btn amber" onclick="attUlozit('${id}')">💾 Uložit opravu</button>
      <button class="btn ghost" onclick="closeModal()">Zrušit</button>
    </div>`);
}
async function attUlozit(id) {
  const a = S.attendance.find(x => x.id === id); if (!a) return;
  const t = $('#ae-t').value || '07:00';
  const u = userById(a.userDocId);
  const zmeny = {
    akce: $('#ae-a').value, pid: $('#ae-p').value,
    date: $('#ae-d').value || isoToday(), time: t,
    pauza: Math.max(0, parseInt($('#ae-pauza').value, 10) || 0),
    upraveno: { kdo: fullName(S.me || {}), kdy: new Date().toISOString(), duvod: $('#ae-duvod').value.trim() }
  };
  // spravi i stare zaznamy, ktere se pracovnikovi v mobilu nezobrazovaly
  if (u && u.uid && a.authUid !== u.uid) zmeny.authUid = u.uid;
  try {
    await db.collection('attendance').doc(id).update(zmeny);
    closeModal(); toast('Záznam opraven ✓');
  } catch (e) { toast('Oprava se nepovedla: ' + (e.code || e.message)); }
}
/* attSchvalit / attZamitnout tu byvaly, ale nemely co schvalovat: zaznam
   dochazky se schvaleno===false uz zadne misto v aplikaci nevyrobi.
   Schvalovani zije v /zadosti — viz zadostSchvalit a zadostZamitnout. */
async function attSmazat(id) {
  const a = S.attendance.find(x => x.id === id); if (!a) return;
  const u = userById(a.userDocId) || {};
  if (!await potvrd('Opravdu smazat tento záznam?\n\n' + (fullName(u) || a.userName || '?') + ' — ' +
               a.akce + ' ' + fmtISO(a.date) + ' ' + a.time + '\n\nSmazání nejde vrátit zpět.')) return;
  try { await db.collection('attendance').doc(id).delete(); toast('Záznam smazán ✓'); }
  catch (e) { toast('Smazání se nepovedlo: ' + (e.code || e.message)); }
}

/* ---- Úkoly ---- */
function pgUkoly() {
  const v = S.ukolyView;
  return `
  <div class="strip"><h1>Úkoly</h1><span class="sp"></span>
    <button class="btn ${v === 'kanban' ? 'amber' : 'ghost'} sm" onclick="S.ukolyView='kanban';render()">▦ KANBAN</button>
    <button class="btn ${v === 'seznam' ? 'amber' : 'ghost'} sm" onclick="S.ukolyView='seznam';render()">≡ SEZNAM</button>
    <button class="btn ghost sm" onclick="S.tplOpen=!S.tplOpen;render()">📋 ŠABLONY</button>
    <button class="btn amber" onclick="S.taskFormOpen=!S.taskFormOpen;render()">➕ PŘIDAT</button></div>
  <main>
    ${S.tplOpen ? (() => { const tpls = S.tasks.filter(t => t.stav === 'sablona'); return `
    <div class="card">
      <h3>📋 Šablony úkolů</h3>
      ${tpls.map(tp => `<div class="urow"><span>📋</span><b>${esc(tp.title)}</b><span class="muted" style="margin-left:auto">${(tp.items || []).length} úkolů</span><span class="lnk" style="font-size:11px;margin-left:10px" onclick="smazSablonu('${tp.id}')">✕ smazat</span></div>`).join('') || '<div class="muted">Zatím žádné šablony.</div>'}
      ${tpls.length ? `<div class="formsec"><h4>▶ Aplikovat šablonu na projekt</h4>
        <div class="frow">
          <div><label>Šablona</label><select id="tp-s">${tpls.map(tp => `<option value="${tp.id}">${esc(tp.title)}</option>`).join('')}</select></div>
          <div><label>Projekt</label><select id="tp-p">${S.projects.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        </div>
        <div class="frow">
          <div><label>Začátek (den 0)</label><input type="date" id="tp-d" value="${isoToday()}"></div>
          <div><label>Odpovědná osoba</label><select id="tp-r"><option value="">— vyber, komu —</option>${lideProUkoly().map(u => `<option value="${u.id}">${esc(fullName(u))}</option>`).join('')}</select></div>
        </div>
        <div class="aprv"><button class="btn amber sm" onclick="tplApply()">▶ Vytvořit úkoly</button></div>
      </div>` : ''}
      <div class="formsec"><h4>➕ Nová šablona</h4>
        <label>Název šablony</label><input type="text" id="tp-n" placeholder="Předání bytu">
        <label>Úkoly — jeden na řádek, volitelně „| +dny" (termín ode dne aplikace)</label>
        <textarea id="tp-i" placeholder="Fotodokumentace předání | +0&#10;Revize elektro — protokol | +3&#10;Podepsat předávací protokol | +5"></textarea>
        <div class="aprv"><button class="btn amber sm" onclick="tplSave()">💾 Uložit šablonu</button></div>
      </div>
    </div>`; })() : ''}
    ${S.taskFormOpen ? `
    <div class="card">
      <h3>➕ Nový úkol</h3>
      <label>Nadpis *</label><input type="text" id="tk-t" placeholder="Co je potřeba udělat">
      <label>Popis (nepovinný) <span class="muted" style="text-transform:none;font-weight:400">— enter dělá odrážku</span></label><textarea id="tk-popis" placeholder="- podrobnost&#10;- další bod" style="min-height:54px"></textarea>
      <div class="frow">
        <div><label>Projekt</label><select id="tk-p">${S.projects.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Odpovědná osoba</label><select id="tk-r">${lideProUkoly().map(u => `<option value="${u.id}">${esc(fullName(u))}</option>`).join('')}</select></div>
      </div>
      <label>Termín</label><input type="date" id="tk-d" value="${shiftISO(isoToday(), 3)}">
      <div class="aprv"><button class="btn amber" onclick="addTask()">💾 ULOŽIT ÚKOL</button></div>
    </div>` : ''}
    ${v === 'seznam' ? ukolySeznam() : ukolyKanban()}
    <div class="note">Úkoly po termínu se eskalují na nástěnku s tlačítky Hotovo / +3 dny. Interní poznámky z deníku jdou převést na úkol jedním klikem.</div>
  </main>`;
}
function ukolySeznam() {
  const rows = S.tasks.filter(t => t.stav !== 'sablona').sort((a, b) => (a.stav === 'hotovo') - (b.stav === 'hotovo') || (a.term || '').localeCompare(b.term || ''));
  return `<div class="tablecard">
    <div style="overflow-x:auto"><table>
      <tr><th style="width:30px"></th><th>Název</th><th>Projekt</th><th>Odpovědná osoba</th><th>Stav</th><th>Vytvořeno</th><th>Termín</th><th></th></tr>
      ${rows.map(t => `
      <tr style="${isOverdue(t) ? 'background:#fdeceb' : ''}">
        <td><input type="checkbox" ${t.stav === 'hotovo' ? 'checked' : ''} onclick="taskDone('${t.id}')"></td>
        <td style="cursor:pointer" onclick="ukolModal('${t.id}')"><b>${esc(t.title)}</b>${(t.odpovedi || []).length ? ` <span class="muted">💬${t.odpovedi.length}</span>` : ''}${(t.photos || []).length ? ` <span class="muted">📷${t.photos.length}</span>` : ''}${t.popis ? `<br><span class="muted" style="font-weight:400">${esc(t.popis.slice(0, 90))}</span>` : ''}${t.src ? ` <span class="badge b-int">${esc(t.src)}</span>` : ''}</td>
        <td>${esc((proj(t.pid) || {}).name || '')}</td>
        <td>${esc(respName(t))}</td>
        <td><span class="badge ${STAVCOLOR[t.stav]}">${STAVY[t.stav]}</span></td>
        <td class="muted">${fmtISO(t.created)}</td>
        <td>${isOverdue(t) ? `<b style="color:var(--red)">❗ ${fmtISO(t.term)} (${daysBetween(t.term, isoToday())} d. po termínu)</b>` : fmtISO(t.term)}</td>
        <td style="white-space:nowrap">${t.stav !== 'hotovo' ? `<button class="btn ok sm" onclick="taskNext('${t.id}')">→ ${STAVY[nextStav(t.stav)]}</button>` : ''}
          <button class="btn ghost sm" title="Upravit úkol" onclick="ukolUpravit('${t.id}')">✏️</button>
          <button class="btn ghost sm" title="Smazat úkol" onclick="delTask('${t.id}')">🗑</button></td>
      </tr>`).join('')}
    </table></div>
    <div class="pagefoot"><span>${rows.length} úkolů</span></div>
  </div>`;
}
function ukolyKanban() {
  const cols = ['nove', 'probiha', 'kontrola', 'hotovo'];
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
    ${cols.map(c => `
    <div style="background:#e7ebf0;border-radius:10px;padding:10px">
      <div style="font-weight:800;font-size:12px;color:#42505e;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">${STAVY[c]} (${S.tasks.filter(t => t.stav === c).length})</div>
      ${S.tasks.filter(t => t.stav === c).map(t => `
        <div class="card" style="padding:10px 12px;margin-bottom:8px;${isOverdue(t) ? 'border-left:3px solid var(--red)' : ''}">
          <b style="font-size:13px">${esc(t.title)}</b>
          <div class="muted" style="font-size:11.5px;margin:4px 0">${esc((proj(t.pid) || {}).name || '')} · ${esc(respName(t))}</div>
          <div style="font-size:11.5px">${isOverdue(t) ? `<b style="color:var(--red)">❗ ${fmtISO(t.term)}</b>` : `📅 ${fmtISO(t.term)}`}</div>
          <div style="display:flex;gap:4px;margin-top:8px">
            ${c !== 'nove' ? `<button class="btn ghost sm" style="padding:3px 8px" onclick="taskMove('${t.id}',-1)">←</button>` : ''}
            ${c !== 'hotovo' ? `<button class="btn amber sm" style="padding:3px 8px" onclick="taskMove('${t.id}',1)">→</button>` : ''}
            <button class="btn ghost sm" style="padding:3px 8px;margin-left:auto" title="Upravit úkol" onclick="ukolUpravit('${t.id}')">✏️</button>
            <button class="btn ghost sm" style="padding:3px 8px" title="Smazat úkol" onclick="delTask('${t.id}')">🗑</button>
          </div>
        </div>`).join('') || '<div class="muted" style="font-size:12px;text-align:center;padding:10px">prázdné</div>'}
    </div>`).join('')}
  </div>`;
}
function nextStav(s) { return s === 'nove' ? 'probiha' : s === 'probiha' ? 'kontrola' : 'hotovo'; }
async function tplSave() {
  const n = $('#tp-n').value.trim(); if (!n) { toast('Vyplň název šablony'); return; }
  const items = $('#tp-i').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)\s*\|\s*\+?(\d+)\s*$/);
    return m ? { title: m[1].trim(), off: parseInt(m[2]) || 0 } : { title: l, off: 0 };
  });
  if (!items.length) { toast('Přidej aspoň jeden úkol'); return; }
  await db.collection('tasks').add({ title: n, stav: 'sablona', items, createdAt: FV() });
  $('#tp-n').value = ''; $('#tp-i').value = ''; zapomen('tp-n', 'tp-i');
  toast('Šablona uložena ✓ (' + items.length + ' úkolů)');
}
async function tplApply() {
  const tpl = S.tasks.find(t => t.id === $('#tp-s').value); if (!tpl) return;
  const pid = $('#tp-p').value, start = $('#tp-d').value || isoToday(), respId = $('#tp-r').value;
  /* Drive se daly ze sablony vyrobit ukoly bez odpovedne osoby — nikomu se
     neukazaly a nikdo o nich nevedel. */
  if (!pid) { toast('Vyber stavbu'); return; }
  if (!respId) { toast('Vyber, komu úkoly patří'); return; }
  const ru = userById(respId); if (!ru) { toast('Vybraného člověka nenacházím — zkus to znovu'); return; }
  const resp = fullName(ru);
  try {
    for (const it of (tpl.items || [])) {
      await db.collection('tasks').add({ title: it.title, zadalId: S.me ? S.me.id : '', zadal: fullName(S.me || {}), pid, respId, resp, created: isoToday(), term: shiftISO(start, it.off || 0), stav: 'nove', res: [resp], src: 'ze šablony ' + tpl.title, createdAt: FV() });
    }
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); render(); return; }
  S.tplOpen = false;
  toast('Vytvořeno ' + (tpl.items || []).length + ' úkolů ze šablony ✓');
  render();
}
/* Prechod na hotovo musi zapsat i hotovoDne (stejne jako taskDone) — je to
   ochranna lhuta pro uklid fotek. Bez nej by uklid smazal fotky ukolu jeste
   tyz den. Pri odchodu z hotovo se hotovoDne cisti, aby slo vraceni. */
async function taskNext(id) { const t = S.tasks.find(x => x.id === id); const stav = nextStav(t.stav); await db.collection('tasks').doc(id).update({ stav, hotovoDne: stav === 'hotovo' ? isoToday() : '' }); }
async function taskMove(id, dir) { const order = ['nove', 'probiha', 'kontrola', 'hotovo']; const t = S.tasks.find(x => x.id === id); const i = order.indexOf(t.stav) + dir; if (i >= 0 && i < 4) await db.collection('tasks').doc(id).update({ stav: order[i], hotovoDne: order[i] === 'hotovo' ? isoToday() : '' }); }
/* Ukol si pamatuje, KDY byl odskrtnut — aby ho pracovnik jeste tentyz den
   videl a mohl vratit, kdyz ho ťuknul omylem. Druhy den uz zmizi. */
async function taskDone(id) {
  const t = S.tasks.find(x => x.id === id);
  const uzHotovy = t.stav === 'hotovo';
  await db.collection('tasks').doc(id).update({
    stav: uzHotovy ? 'nove' : 'hotovo',
    hotovoDne: uzHotovy ? '' : isoToday()
  });
}
/* Posouva se od DNESKA, ne od stareho terminu. U ukolu 14 dni po terminu
   by "+3 dny" jinak spadlo zase do minulosti, radek by zustal cerveny
   a tlacitko by vypadalo rozbite. */
async function taskShift(id) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  const zaklad = (t.term && t.term > isoToday()) ? t.term : isoToday();
  const novy = shiftISO(zaklad, 3);
  try {
    await db.collection('tasks').doc(id).update({ term: novy });
    toast('Termín posunut na ' + fmtISO(novy));
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
/* Sablona se drive mazala jednim kliknutim primo z HTML — bez otazky
   a bez hlasky, kdyz se mazani nepovedlo. Tuknuti vedle na mobilu tak
   nenavratne smazalo dvanact ukolu. */
/* Ukol slo drive jen smazat a zalozit znovu — spolu s nim se ale ztratily
   odpovedi i fotky. Upravit ho smi VEDENI a ten, KDO UKOL ZADAL
   (rozhodnuti Marca 29. 8. 2026). Kdo ukol jen dostal, upravovat nesmi —
   ten ho odskrtne jako hotovy, pripadne odpovi. Pravidla databaze to drzi
   stejne (bod 16), takze i pres REST plati totez. */
function ukolUpravit(id) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  /* moje id v /users — users_auth je nacteny driv nez profil, tak se bere
     prednostne odtud (stejne jako listenMojeUkoly) */
  const mid = (S.meAuth && S.meAuth.userDocId) || (S.me && S.me.id) || '';
  const jsemVedeni = !!(S.meAuth && S.meAuth.role === 'admin');
  if (!jsemVedeni && !(mid && t.zadalId === mid)) { toast('Upravit úkol může vedení a ten, kdo ho zadal'); return; }
  /* i stavba, ktera uz neni aktivni, musi ve vyberu zustat — jinak by se
     ukol pri ulozeni tise prehodil na uplne jinou zakazku */
  const stavby = S.projects.filter(x => x.active !== false || x.id === t.pid);
  /* stejna past u lidi: kdo uz ve firme neni, v nabidce chybi, nic by nebylo
     vybrane a ulozeni by spadlo na „Vyber, komu ukol patri" i pri pouhe
     oprave preklepu v nadpisu. lideProUkoly() vraci novy seznam, unshift
     tedy nesaha na S.users. */
  const lide = lideProUkoly();
  const puvodni = t.respId ? userById(t.respId) : null;
  if (puvodni && !lide.some(u => u.id === puvodni.id)) lide.unshift(puvodni);
  modal(`<h3>✏️ Upravit úkol</h3>
    <label>Nadpis *</label>
    <input type="text" id="ue-t" value="${esc(t.title || '')}">
    <label>Popis <span class="muted" style="text-transform:none;font-weight:400">— podrobnosti, nepovinné</span></label>
    <textarea id="ue-popis" style="min-height:54px">${esc(t.popis || '')}</textarea>
    <label>Komu</label>
    <select id="ue-r">
      <option value="">— vyber, komu —</option>
      ${lide.map(u => `<option value="${u.id}" ${u.id === t.respId ? 'selected' : ''}>${esc(fullName(u))}</option>`).join('')}
    </select>
    <label>Stavba</label>
    <select id="ue-p">${stavby.map(x => `<option value="${x.id}" ${x.id === t.pid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <label>Termín</label>
    <input type="date" id="ue-d" value="${esc(t.term || '')}">
    <div class="aprv"><button class="btn amber" onclick="ulozUkol('${t.id}')">💾 Uložit změny</button>
      <button class="btn ghost" onclick="closeModal()">Zrušit</button></div>
    <div class="note">Odpovědi i fotky u úkolu zůstanou. Když úkol přehodíš na někoho jiného, původnímu z aplikace zmizí.</div>`);
  setTimeout(() => { const el = document.querySelector('#ue-t'); if (el) el.focus(); }, 60);
}
async function ulozUkol(id) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  const title = ($('#ue-t').value || '').trim();
  if (!title) { toast('Nadpis nesmí být prázdný'); return; }
  const respId = $('#ue-r').value, ru = userById(respId);
  if (!respId || !ru) { toast('Vyber, komu úkol patří'); return; }
  try {
    /* Stav ukolu se tady schvalne nemeni — ten resi odskrtnuti (taskDone)
       a sipky na kanbanu. zadalId zustava, kdo ukol zadal se neprepisuje. */
    await db.collection('tasks').doc(id).update({
      title, popis: ($('#ue-popis') ? ($('#ue-popis').value || '').trim() : ''),
      /* Kdyby stavba v nabidce nebyla (uz neexistuje), zapsalo by se prazdno
         a ukol by se odpojil od zakazky. Radeji nechame puvodni. */
      pid: $('#ue-p').value || t.pid || '', respId, resp: fullName(ru), res: [fullName(ru)],
      term: $('#ue-d').value || t.term || ''
    });
    closeModal(); toast('Úkol upraven ✓'); render();
  } catch (e) { toast('Nejde uložit: ' + (e.code || e.message)); }
}
async function smazSablonu(id) {
  const tp = S.tasks.find(x => x.id === id); if (!tp) return;
  if (!await potvrd('Smazat šablonu?\n\n„' + (tp.title || '') + '" · ' + (tp.items || []).length +
    ' úkolů\n\nÚkoly, které z ní už vznikly, zůstanou. Smazání nejde vrátit zpět.')) return;
  try { await db.collection('tasks').doc(id).delete(); toast('Šablona smazána ✓'); }
  catch (e) { toast('Nejde smazat: ' + (e.code || e.message)); }
}
async function addTask() {
  const title = $('#tk-t').value.trim();
  if (!title) { toast('Vyplň název úkolu'); return; }
  const respId = $('#tk-r').value, ru = userById(respId);
  /* Stejna pojistka jako ve verzi pro teren: bez vybrane osoby by ukol
     nikomu nepatril a nikde by se neukazal. */
  if (!respId || !ru) { toast('Vyber, komu úkol patří'); return; }
  try {
    await db.collection('tasks').add({
      title, popis: ($('#tk-popis') ? $('#tk-popis').value.trim() : ''),
      zadalId: S.me ? S.me.id : '', zadal: fullName(S.me || {}), pid: $('#tk-p').value, respId, resp: fullName(ru), created: isoToday(),
      term: $('#tk-d').value || shiftISO(isoToday(), 3), stav: 'nove', res: [fullName(ru)], createdAt: FV()
    });
  } catch (e) { toast('Nepovedlo se uložit: ' + (e.code || e.message)); return; }
  /* Zapomenout se musi i popis — drive se cistil jen nadpis, takze popis
     predchoziho ukolu se pri dalsim otevreni formulare vratil zpatky
     a odpovedny dostal cizi zadani. */
  $('#tk-t').value = '';
  if ($('#tk-popis')) $('#tk-popis').value = '';
  zapomen('tk-t', 'tk-popis');
  S.taskFormOpen = false; toast('Úkol přidán ✓'); render();
}

/* ---- Vícepráce ---- */
function pgViceprace() {
  const order = { navrh: 0, u_investora: 1, schvaleno: 2, papir: 2, zamitnuto: 3 };
  const items = S.viceprace.slice().sort((a, b) => order[a.stav] - order[b.stav]);
  return `
  <div class="strip"><h1>Vícepráce</h1><span class="sp"></span>
    <button class="btn amber" onclick="S.vpFormOpen=!S.vpFormOpen;render()">➕ NOVÁ VÍCEPRÁCE</button></div>
  <main>
    ${S.vpFormOpen ? `
    <div class="card">
      <h3>➕ Nová vícepráce</h3>
      <label>Název *</label><input type="text" id="vp-t" placeholder="Výměna hliníkového vedení v ložnici">
      <div class="frow">
        <div><label>Projekt</label><select id="vp-p">${S.projects.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Zdroj</label><select id="vp-z"><option value="stavba">🏗 ze stavby / deníku</option><option value="drive">📁 PDF na Drive</option></select></div>
      </div>
      <label>Popis</label><textarea id="vp-pop" style="min-height:60px"></textarea>
      <label>Drive ID / odkaz na PDF (jen u zdroje Drive)</label><input type="text" id="vp-f" placeholder="https://drive.google.com/file/d/…">
      <div class="aprv"><button class="btn amber" onclick="addVp()">💾 Uložit (→ čeká na nacenění)</button></div>
    </div>` : ''}
    ${items.map(v => { const p = proj(v.pid) || {}; const [cls, txt] = VPSTAV[v.stav] || VPSTAV.navrh; return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
        <h3>${esc(v.title)}</h3><span class="badge ${cls}">${txt}</span>
      </div>
      <div class="muted">${esc(p.name || '')} · ${esc(p.cn || '')} · zdroj: ${v.zdroj === 'drive' ? `📁 z Drive${v.driveId ? ` — <span class="lnk" onclick="openDriveDoc('${v.driveId}','${esc(v.title)}')">otevřít PDF</span>` : ''}` : '🏗 ze stavby / deníku'}</div>
      <div style="margin:8px 0">${esc(v.popis || '')}</div>
      ${v.cena ? `<div style="font-size:16px;font-weight:800;color:var(--navy)">${kc(v.cena)} Kč <span class="muted" style="font-weight:400;font-size:12px">bez DPH · DPH 12 % jako součást díla</span></div>` : ''}
      ${v.podpis ? `<div class="note" style="margin-top:8px">✍️ ${esc(v.podpis)} · nezapomeň propsat do listu Vícepráce v CN (#24)</div>` : ''}
      <div class="aprv">
        ${v.stav === 'navrh' ? `<input type="number" id="vpc-${v.id}" placeholder="Cena v Kč" style="max-width:140px" value="${v.cena || ''}"><button class="btn amber sm" onclick="vpNacenit('${v.id}')">💰 Nacenit a poslat investorovi</button>` : ''}
        ${v.stav === 'u_investora' ? `<button class="btn dark sm" onclick="vpPapir('${v.id}')">🖨 Klient bez PC — podpis na stavbě</button>
          <span class="muted" style="align-self:center;font-size:11.5px">investor vidí na portálu tlačítko Schválit</span>` : ''}
        ${v.stav === 'u_investora' ? `<button class="btn ghost sm" onclick="vpZpetKPreceneni('${v.id}')">↩ Stáhnout zpět k přecenění</button>` : ''}
        ${v.stav === 'zamitnuto' ? `<button class="btn amber sm" onclick="vpZpetKPreceneni('${v.id}')">💰 Přecenit a poslat znovu</button>` : ''}
        <button class="btn ghost sm" title="Smazat vícepráci" onclick="smazVicepraci('${v.id}')">🗑</button>
      </div>
    </div>`; }).join('') || '<div class="card"><div class="empty">Zatím žádné vícepráce.</div></div>'}
    <div class="note">Tok (#35): záznam → nacenění → schválení investorem (klik na portálu, nebo papír u klienta bez PC) → propis do listu Vícepráce v CN + PDF do složky zakázky na Drive.</div>
  </main>`;
}
async function addVp() {
  const title = $('#vp-t').value.trim();
  if (!title) { toast('Vyplň název'); return; }
  const raw = $('#vp-f').value.trim(); const m = raw.match(/[-\w]{25,}/);
  await db.collection('viceprace').add({ pid: $('#vp-p').value, title, popis: $('#vp-pop').value.trim(), cena: 0, stav: 'navrh', zdroj: $('#vp-z').value, driveId: m ? m[0] : null, createdAt: FV(), createdBy: fullName(S.me || {}) });
  zapomen('vp-t', 'vp-pop', 'vp-f');
  S.vpFormOpen = false; toast('Vícepráce založena — čeká na nacenění'); render();
}
async function vpNacenit(id) {
  const c = parseFloat($('#vpc-' + id).value);
  if (!c) { toast('Zadej cenu'); return; }
  const v = S.viceprace.find(x => x.id === id);
  const p = proj(v.pid);
  zapomen('vpc-' + id);
  await db.collection('viceprace').doc(id).update({ cena: c, stav: 'u_investora', clientName: (p || {}).client || '' });
  const tok = await tokenPortaluAsync(v.pid); // token je v admin-only /portaly (S2)
  if (tok) {
    await db.collection('portals').doc(tok).collection('vp').doc(id).set({ title: v.title, popis: v.popis || '', cena: c, stav: 'u_investora' });
    notifyMail('vp', v.pid, v.title + ' — ' + kc(c) + ' Kč');
    toast('Posláno investorovi ke schválení + notifikace 📬');
  } else toast('Naceněno ✓ — projekt nemá portál, schválení vyřiď papírově');
  render();
}
async function vpPapir(id) {
  const v = S.viceprace.find(x => x.id === id);
  await db.collection('viceprace').doc(id).update({ stav: 'papir', podpis: 'podepsáno papírově na stavbě ' + fmtISO(isoToday()) + ' (sken na Drive)' });
  const tok = await tokenPortaluAsync(v.pid); // token je v admin-only /portaly (S2)
  if (tok) await db.collection('portals').doc(tok).collection('vp').doc(id).set({ title: v.title, popis: v.popis || '', cena: v.cena, stav: 'schvaleno', podpis: 'schváleno papírově na stavbě' }, { merge: true });
  toast('Označeno jako schválené papírově ✓');
}

/* ---- Hodinova sazba a jeji historie (#34) ----
   Sazba zije v /sazby/{userId} jako { h, c, hist }. Pole h a c jsou POSLEDNI
   (aktualni) sazba — kvuli seznamu uzivatelu a starym datum. hist je pole
   zaznamu { od:'YYYY-MM-DD', h, c, kdo, kdy }.
   Duvod: report nasobil hodiny za JAKEKOLI obdobi dnesni sazbou, takze
   po zvyseni sazby se prepocitala i uz vyplacena minulost — cerven vytisteny
   v cervnu na 48 000 dnes ukazoval 52 800. Ted se kazdy den ocenuje sazbou
   platnou TEN den.
   Proc pole a ne podkolekce: report potrebuje historii vsech vybranych lidi
   naraz, takze by slo o collectionGroup dotaz — a ten chce vlastni zastupne
   pravidlo i rucni index. Presne na tom uz jednou uvazl souhlas investora
   pres /actions. Navic sazba a jeji historie se musi menit jednim zapisem.
   POZOR: uvnitr pole nejde pouzit serverTimestamp (Firestore zapis odmitne),
   proto je 'kdy' obycejne datum. */
const SAZBA_ODJAKZIVA = '2000-01-01';   /* sazba, ktera platila jeste pred zavedenim historie */

/* Zaznamy historie serazene podle data, bez smeti. */
function sazbaHist(s) {
  return (s && Array.isArray(s.hist) ? s.hist : [])
    .filter(z => z && typeof z.od === 'string' && z.od && typeof z.h === 'number')
    .slice().sort((a, b) => a.od < b.od ? -1 : a.od > b.od ? 1 : 0);
}
/* Sazba platna pro cloveka v konkretni den; null = sazba k tomu dni neni.
   - bez historie plati aktualni sazba (stara data — jinak by se vsem lidem
     vynulovaly uz vytistene reporty),
   - den PRED prvnim zaznamem dostane nejstarsi znamou sazbu, ne tu dnesni,
   - zaznam s h == 0 znamena „tady sazba skoncila" (clovek prestal byt
     v parte); dny od nej dal jsou zase bez sazby. */
function sazbaKeDni(udi, den) {
  const s = S.sazby[udi];
  if (!s) return null;
  const hist = sazbaHist(s);
  if (!hist.length) return s.h ? { h: s.h, c: s.c || 0, od: null } : null;
  let plati = null;
  for (const z of hist) { if (z.od <= den) plati = z; else break; }
  if (!plati) plati = hist[0];
  return plati.h ? { h: plati.h, c: plati.c || 0, od: plati.od } : null;
}
/* Penize za jednu bunku reportu — den po dni, sazbou platnou ten den.
   Kdyby rozpad po dnech chybel (starsi verze v telefonu), spocita se cela
   bunka sazbou platnou k poslednimu dni obdobi — report nikdy nespadne
   a nikdy neukaze nulu misto penez. */
function penizeZaHodiny(udi, h) {
  const dny = (h && Array.isArray(h.poDnech) && h.poDnech.length)
    ? h.poDnech : [{ den: S.repTo || isoToday(), h: (h && h.h) || 0 }];
  let hruba = 0, cista = 0, maCistou = false, hodBezSazby = 0;
  const pouzite = {};
  dny.forEach(d => {
    const hod = d.h || 0;
    const s = sazbaKeDni(udi, d.den);
    if (!s) { hodBezSazby += hod; return; }
    hruba += hod * s.h;
    /* Bez ciste sazby dostane clovek celou hrubou — stejne to pocital
       i dosavadni export, aby souhrny sedely. */
    cista += hod * (s.c || s.h);
    if (s.c) maCistou = true;
    const k = s.h + '|' + (s.c || 0);
    if (!pouzite[k]) pouzite[k] = { h: s.h, c: s.c || 0, od: s.od, hod: 0, dni: 0 };
    pouzite[k].hod += hod;
    if (hod > 0) pouzite[k].dni++;
  });
  const sazby = Object.keys(pouzite).map(k => pouzite[k]).sort((a, b) => a.h - b.h);
  return { hruba, cista, maCistou, hodBezSazby, sazby };
}
/* Popisek sazeb pod bunkou reportu. Jedna sazba = presne stejny vzhled
   jako driv. Vic sazeb = vypsat kazdou zvlast i s tim, kolik hodin a dnu
   na ni padlo — at si to Katka umi prepocitat na papire. */
function sazbyPopisek(p) {
  const chybi = p.hodBezSazby > 0 ? `<span class="badge b-red">${p.sazby.length ? fmtH(p.hodBezSazby) + ' bez sazby!' : 'chybí sazba!'}</span>` : '';
  if (!p.sazby.length) return chybi || '<span class="badge b-red">chybí sazba!</span>';
  if (p.sazby.length === 1) {
    const s = p.sazby[0];
    return (s.c ? `<span class="badge b-wait">hrubá ${s.h}</span> <span class="badge b-ok">čistá ${s.c}</span>`
                : `<span class="badge b-wait">${s.h} Kč/h</span>`) + (chybi ? '<br>' + chybi : '');
  }
  const n = p.sazby.length;
  return `<span class="badge b-wait">⇄ v období ${n} ${n < 5 ? 'sazby' : 'sazeb'}</span><br>`
    + p.sazby.map(s => `<span class="muted" style="font-size:11px">${s.h} Kč/h${s.c ? ` (čistá ${s.c})` : ''} · ${fmtH(s.hod)} · ${s.dni} ${s.dni === 1 ? 'den' : s.dni < 5 ? 'dny' : 'dní'}</span>`).join('<br>')
    + (chybi ? '<br>' + chybi : '');
}
/* Poskladá novy obsah dokumentu /sazby/{id} vcetne historie.
   Vraci null, kdyz se nema nic menit — bez toho by kazde otevreni
   a ulozeni karty pridalo dalsi zbytecny zaznam. */
function sazbySloz(stara, od, h, c) {
  const hist = sazbaHist(stara);
  /* Stara sazba bez historie dostane zaznam „odjakziva". Bez nej by se
     vsechny uz vytistene reporty prepocitaly novou sazbou. */
  if (!hist.length && stara && stara.h) {
    const p0 = { od: SAZBA_ODJAKZIVA, h: stara.h, kdo: 'převod dat', kdy: isoToday() };
    if (stara.c) p0.c = stara.c;
    hist.push(p0);
  }
  let plati = null;
  for (const z of hist) { if (z.od <= od) plati = z; else break; }
  if (plati && plati.h === h && (plati.c || 0) === (c || 0) && !hist.some(z => z.od === od)) return null;
  const zaznam = { od, h, kdo: fullName(S.me || {}).trim() || 'vedení', kdy: isoToday() };
  if (c) zaznam.c = c;
  const i = hist.findIndex(z => z.od === od);
  if (i >= 0) hist[i] = zaznam; else hist.push(zaznam);
  hist.sort((a, b) => a.od < b.od ? -1 : a.od > b.od ? 1 : 0);
  const posl = hist[hist.length - 1];
  const out = { hist };
  if (posl.h) { out.h = posl.h; if (posl.c) out.c = posl.c; }
  return out;
}
/* ---- Reporty — hodiny z docházky ---- */
/* Hodiny za obdobi. Vlastni matematika je ve vypocty.js, aby se dala
   otestovat samostatne — otevri test.html a uvidis zelena/cervena. */
function hoursFromAttendance(from, to) {
  /* Seskupuje se podle CLOVEKA A STAVBY, ne podle dne — smenu pres pulnoc
     musi rozdelit az Vypocty.spocitejSmeny(), ktere odchod v 6:00 rano
     pripoji ke smene z predchoziho vecera. Driv se seskupovalo i podle dne
     a nocni smena se rozpadla na dva prazdne dny; osm hodin zmizelo.
     Do parovani se proto pousti i den PO konci obdobi (odchod z posledni
     noci), ale zapocita se jen smena, jejiz DEN PRICHODU do obdobi patri. */
  const doPlus1 = shiftISO(to, 1);
  const byKey = {};
  S.attendance.filter(a => a.date >= from && a.date <= doPlus1 && jeSchvaleno(a)).forEach(a => {
    const k = a.userDocId + '|' + a.pid;
    (byKey[k] = byKey[k] || []).push(a);
  });
  const out = {};
  Object.entries(byKey).forEach(([k, recs]) => {
    const [udi, pid] = k.split('|');
    Vypocty.spocitejSmeny(recs).forEach(d => {
      if (d.den < from || d.den > to) return;     /* smena mimo obdobi */
      out[udi] = out[udi] || {};
      out[udi][pid] = out[udi][pid] || { h: 0, dni: 0, incomplete: 0, pauzaMin: 0, pauzaRucni: false, poDnech: [] };
      out[udi][pid].h += d.minuty / 60;
      out[udi][pid].pauzaMin += d.pauzaMin;
      if (d.pauzaRucni) out[udi][pid].pauzaRucni = true;   /* aspon jeden den ma pauzu od vedeni */
      out[udi][pid].dni++;
      if (d.nedokonceno) out[udi][pid].incomplete++;
      /* Rozpad po dnech — potrebuje ho vyplata, kdyz se cloveku behem
         obdobi zmenila sazba: kazdy den se nasobi tou, ktera tehdy platila. */
      out[udi][pid].poDnech.push({ den: d.den, h: d.minuty / 60 });
    });
  });
  return out;
}
/* Koho report nabizi. Neaktivni clovek tu MUSI byt taky — jinak se mu neda
   spocitat posledni vyplata, a aplikace pritom u mazani sama radi „prepni ho
   na neaktivniho". Odlisi se sedou, nevynecha se. Aktivni jdou napred. */
function repTerenni() {
  return S.users.filter(u => u.typ && u.typ.teren && !u.typ.kanc)
    .sort((a, b) => (a.active === false ? 1 : 0) - (b.active === false ? 1 : 0));
}
/* Prazdne policko „Od" drive propustilo do reportu vsechno, co bylo v pameti
   (podminka a.date >= '' plati vzdycky), a nadpis pritom ukazoval prazdne
   obdobi. Radeji nic nez spatny podklad pro vyplaty. */
function repObdobiOk() { return !!(S.repFrom && S.repTo && S.repFrom <= S.repTo); }
function pgReporty() {
  const teren = repTerenni();
  const sel = S.repWorkers, selP = S.repProjects;
  return `
  <div class="strip"><h1>Reporty — Odpracované hodiny na projektu</h1><span class="sp"></span></div>
  <main>
    <div class="card">
      <h3>📋 Přehled odpracovaných hodin</h3>
      <div class="grid2">
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
            <label>Terénní pracovníci (${sel.length} z ${teren.length})</label>
            <button class="btn ghost sm" onclick="repVsichniW()">${teren.length && teren.every(u => sel.includes(u.id)) ? '✕ Zrušit výběr' : '✓ Vybrat všechny'}</button>
          </div>
          <div class="chipselect">${teren.map(u => { const ne = u.active === false; return `<button class="${sel.includes(u.id) ? 'active' : ''}" style="${ne ? 'opacity:.55' : ''}" onclick="repTogW('${u.id}')">${esc(fullName(u))}${ne ? ' · neaktivní' : ''}${S.sazby[u.id] ? '' : ' ⚠'}</button>`; }).join('') || '<span class="muted">žádní pracovníci</span>'}</div>
        </div>
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
            <label>Projekty (${selP.length} z ${S.projects.length})</label>
            <button class="btn ghost sm" onclick="repVsechnyP()">${S.projects.length && S.projects.every(p => selP.includes(p.id)) ? '✕ Zrušit výběr' : '✓ Vybrat všechny'}</button>
          </div>
          <div class="chipselect">${S.projects.map(p => `<button class="${selP.includes(p.id) ? 'active' : ''}" onclick="repTogP('${p.id}')">${esc(p.name)}</button>`).join('')}</div>
        </div>
      </div>
      <div class="aprv" style="align-items:center">
        <span class="muted">Od</span><input type="date" id="rep-from" value="${S.repFrom}" style="max-width:150px" onchange="S.repFrom=this.value;S.repLoaded=false;render()">
        <span class="muted">do</span><input type="date" id="rep-to" value="${S.repTo}" style="max-width:150px" onchange="S.repTo=this.value;S.repLoaded=false;render()">
        <button class="btn amber" onclick="nactiReport()">${S.dotahuji ? '<span class="spin"></span> NAČÍTÁM…' : 'NAČÍST REPORT'}</button>
      </div>
    </div>
    ${!repObdobiOk() ? `<div class="note" style="color:var(--red)">⚠ <b>Vyplň celé období.</b> Chybí datum „Od" nebo „do", nebo je „Od" později. Report se nenačte — bez období by se do výplat započítalo všechno, co je zrovna v paměti.</div>`
      : S.repFrom < oknoOd() ? `<div class="note">📅 Období sahá před posledních ${OKNO_DNU} dní — starší docházka se dotáhne z databáze při načtení reportu.</div>` : ''}
    ${S.repLoaded ? repTable() : `
    <div class="card"><div class="empty">ℹ️ Žádný report není načten<br><span class="muted">1. Vyber pracovníky · 2. Vyber projekty · 3. Načíst report</span></div></div>`}
  </main>`;
}
/* Report za starsi obdobi potrebuje data, ktera nemame naživo (viz OKNO_DNU).
   Bez tohohle by tabulka tise ukazala nuly — a to je podklad pro vyplaty. */
/* Zapisy starsi nez okno nejsou naživo — dotahnou se na pozadani. */
/* Kam az jsme se prohledali. Driv se mez pocitala z nejstarsiho zapisu
   v pameti — a kdyz byl usek prazdny, nic nepribylo, mez se neposunula
   a dalsi tuknuti prohledalo tentyz prazdny usek porad dokola. Diru delsi
   nez tri mesice tak neslo prekonat vubec a hlaska tvrdila „starsi zapisy
   uz nejsou", i kdyz jich v databazi lezely stovky. */
async function dotahniZapisy() {
  const zPameti = S.entries.reduce((m, e) => (e.date && e.date < m ? e.date : m), oknoOd());
  let mez = (S.zapisyOd && S.zapisyOd < zPameti) ? S.zapisyOd : zPameti;
  const zacatek = mez;
  S.dotahuji = true; render();
  let pribylo = 0;
  try {
    for (let kolo = 0; kolo < 3; kolo++) {
      const do_ = shiftISO(mez, -1), od = shiftISO(mez, -91);
      const snap = await db.collection('entries').where('date', '>=', od).where('date', '<=', do_).get();
      const mam = new Set(S.entries.map(e => e.id));
      pribylo += snap.docs.filter(d => !mam.has(d.id)).length;
      archivujDotazene('entries', snap.docs.map(d => ({ id: d.id, ...d.data() })));
      mez = od; S.zapisyOd = od;                 /* posunout VZDY, i kdyz bylo prazdno */
      if (pribylo) break;
    }
    toast(pribylo
      ? 'Načteno ' + pribylo + ' starších zápisů ✓'
      : 'V období od ' + fmtISO(S.zapisyOd) + ' do ' + fmtISO(shiftISO(zacatek, -1)) + ' nic není — ťukni znovu pro ještě starší.');
  } catch (e) { toast('Nepovedlo se načíst: ' + (e.code || e.message)); }
  S.dotahuji = false; render();
}

/* Krizova kontrola reportu ("chybi zapis") porovnava dochazku se zapisy
   deniku — jenze naživo je jen okno poslednich 30 dni. Bez dotazeni zapisu
   za zvolene obdobi by u kazdeho starsiho dne falesne svitilo "chybi zapis"
   a vedeni by pred vyplatou proverovalo neexistujici diry. */
S.dotazenoZapisy = S.dotazenoZapisy || [];
async function dotahniZapisyProReport(from, to) {
  if (!from || !to || from > to) return;
  if (from >= oknoOd()) return;                       // uz to mame naživo
  const klic = from + '..' + to;
  if (S.dotazenoZapisy.includes(klic)) return;
  try {
    const snap = await db.collection('entries')
      .where('date', '>=', from).where('date', '<=', to).get();
    archivujDotazene('entries', snap.docs.map(d => ({ id: d.id, ...d.data() })));
    S.dotazenoZapisy.push(klic);
  } catch (e) {
    toast('Starší zápisy deníku se nepodařilo načíst: ' + (e.code || e.message));
  }
}

async function nactiReport() {
  if (!repObdobiOk()) { S.repLoaded = false; toast('Vyplň celé období.'); render(); return; }
  await dotahniDochazku(S.repFrom, S.repTo);
  await dotahniZapisyProReport(S.repFrom, S.repTo);
  S.repLoaded = true; render();
}

/* Zmena vyberu uz tabulku neschovava — dochazka za obdobi je v pameti, staci
   ji prepocitat. Z databaze se dotahuje jen pri zmene obdobi, to hlidaji
   policka s datem (ta S.repLoaded shazuji dal). */
function repTogW(id) { const i = S.repWorkers.indexOf(id); i >= 0 ? S.repWorkers.splice(i, 1) : S.repWorkers.push(id); render(); }
function repTogP(id) { const i = S.repProjects.indexOf(id); i >= 0 ? S.repProjects.splice(i, 1) : S.repProjects.push(id); render(); }
function repVsichniW() {
  const t = repTerenni();
  const vse = t.length && t.every(u => S.repWorkers.includes(u.id));
  S.repWorkers = vse ? [] : t.map(u => u.id);
  render();
}
function repVsechnyP() {
  const vse = S.projects.length && S.projects.every(p => S.repProjects.includes(p.id));
  S.repProjects = vse ? [] : S.projects.map(p => p.id);
  render();
}
function repTable() {
  const sel = S.repWorkers, selP = S.repProjects;
  if (!repObdobiOk()) return '<div class="card"><div class="empty">Vyplň celé období.</div></div>';
  if (!sel.length || !selP.length) return '<div class="card"><div class="empty">Vyber aspoň jednoho pracovníka a projekt.</div></div>';
  const H = hoursFromAttendance(S.repFrom, S.repTo);
  let totKc = 0, totC = 0, totH = 0, missing = [], anyCista = false, anyIncomplete = false;
  const rows = sel.map(udi => {
    const u = userById(udi); if (!u) return '';
    let rowKc = 0, rowC = 0, rowH = 0, rowBez = 0, rowCista = false, rowVice = false;
    const cells = selP.map(pid => {
      const h = H[udi] && H[udi][pid];
      if (!h || (!h.h && !h.incomplete)) return '<td class="muted" style="text-align:center">—</td>';
      if (h.incomplete) anyIncomplete = true;
      /* Penize den po dni, sazbou platnou ten den (#34 — historie sazeb).
         Driv se cela bunka nasobila DNESNI sazbou, takze zvyseni sazby
         zpetne prepsalo i uz vyplacene mesice. */
      const p = penizeZaHodiny(udi, h);
      rowKc += p.hruba; rowC += p.cista; rowH += h.h; rowBez += p.hodBezSazby;
      if (p.maCistou) { rowCista = true; anyCista = true; }
      if (p.sazby.length > 1) rowVice = true;
      return `<td style="text-align:center"><b>${p.sazby.length ? kc(p.hruba) + ' Kč' : '⚠'}</b><br><span class="muted">${fmtH(h.h)} · ${h.dni} ${h.dni === 1 ? 'den' : h.dni < 5 ? 'dny' : 'dní'}${h.pauzaMin ? ` · <span title="${h.pauzaRucni ? 'Část pauzy zadalo ručně vedení — ta přebíjí časovač v mobilu.' : 'odečtená pauza na oběd'}">− pauza ${h.pauzaMin} min${h.pauzaRucni ? ' ✏️' : ''}</span>` : ''}${h.incomplete ? ` · <b style="color:var(--red)">${h.incomplete}× neúplný den</b>` : ''}</span><br>${sazbyPopisek(p)}</td>`;
    });
    if (rowBez > 0) missing.push(fullName(u));
    totKc += rowKc; totC += rowC; totH += rowH;
    const diff = rowCista ? rowKc - rowC : 0;
    return `<tr><td><span class="uav" style="margin-right:6px">${ini(u)}</span>${esc(fullName(u))}<br><span class="muted" style="margin-left:34px">${esc(u.role || '')}</span>${rowVice ? '<br><span class="badge b-wait" style="margin-left:34px">sazba se v období měnila</span>' : ''}</td>${cells.join('')}<td style="text-align:center"><b>${kc(rowKc)} Kč${rowBez > 0 ? ' ⚠' : ''}</b>${diff > 0 ? `<br><span class="muted">čistá: ${kc(rowC)} Kč</span><br><span class="badge b-wait">vedoucímu party: ${kc(diff)} Kč</span>` : ''}</td><td style="text-align:center"><b>${fmtH(rowH)}</b></td></tr>`;
  });
  // křížová kontrola proti deníku (#25)
  /* Hodiny na stavbach, ktere NEJSOU zaskrtnute. Jedna zapomenuta stavba
     jinak tise ubere hodiny z vyplaty a nikde to nebylo videt. Bere se to
     ze stejneho H jako tabulka, takze i tady plati „jen schvalena dochazka". */
  const mimo = {};
  let mimoH = 0;
  sel.forEach(udi => {
    const byPid = H[udi] || {};
    Object.keys(byPid).forEach(pid => {
      if (selP.includes(pid)) return;
      const h = byPid[pid];
      if (!h.h && !h.incomplete) return;
      mimo[pid] = (mimo[pid] || 0) + h.h;
      mimoH += h.h;
    });
  });
  const mimoSeznam = Object.keys(mimo).sort((a, b) => mimo[b] - mimo[a]);
  // křížová kontrola (#25): dny z DOCHÁZKY vs. existence zápisu v deníku pro stejný projekt a den
  /* Stejny filtr jako u vypoctu hodin: jen vybrane stavby a jen schvalena
     dochazka. Drive to prochazelo vsechny stavby i neschvalene zaznamy,
     takze tabulka a kontrola mluvily kazda o necem jinem. */
  const entryDaySet = new Set(S.entries.map(e => e.date + '|' + e.pid));
  const attPairs = {};
  S.attendance.filter(a => a.date >= S.repFrom && a.date <= S.repTo && sel.includes(a.userDocId)
    && selP.includes(a.pid) && jeSchvaleno(a)).forEach(a => {
    (attPairs[a.userDocId] = attPairs[a.userDocId] || new Set()).add(a.date + '|' + a.pid);
  });
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <h3>🗓 Přehled za období ${fmtISO(S.repFrom)} – ${fmtISO(S.repTo)}</h3>
      <button class="btn dark sm" onclick="repExport()">⬇ Export CSV</button>
    </div>
    ${missing.length ? `<div class="inote">⚠ <b>Chybí hodinová sazba:</b> ${missing.map(esc).join(', ')} — hodiny se evidují, ale nepočítají do Kč. Doplň v Uživatelé.</div>` : ''}
    ${anyIncomplete ? `<div class="inote">⚠ Některé dny mají jen příchod nebo jen odchod — hodiny z nich se nepočítají. Doplň ručně v Organizaci.</div>` : ''}
    <div style="overflow-x:auto;margin-top:10px"><table>
      <tr><th>Terénní pracovník</th>${selP.map(pid => `<th style="text-align:center">🏠 ${esc((proj(pid) || {}).name || '')}</th>`).join('')}<th style="text-align:center">Celkem</th><th style="text-align:center">Celkem hodin</th></tr>
      ${rows.join('')}
      <tr style="background:var(--amber-soft)"><td><b>Celkem</b></td>${selP.map(() => '<td></td>').join('')}<td style="text-align:center"><b style="color:var(--amber-d)">${kc(totKc)} Kč</b>${anyCista ? `<br><span class="muted">čistá: ${kc(totC)} Kč · rozdíl: ${kc(totKc - totC)} Kč</span>` : ''}</td><td style="text-align:center"><b style="color:var(--amber-d)">${fmtH(totH)}</b></td></tr>
    </table></div>
    ${mimoSeznam.length ? `<div style="background:#fdeceb;border:1px dashed #e6a79f;border-radius:8px;padding:9px 12px;font-size:12.5px;margin-top:10px;color:var(--red)">
      ⚠ <b>Pozor — ${mimoSeznam.length === 1 ? 'jedna stavba není ve výběru' : 'některé stavby nejsou ve výběru'}.</b>
      Vybraní lidé mají v tomto období ještě <b>${fmtH(mimoH)}</b> na stavbách, které nejsou zaškrtnuté:
      ${mimoSeznam.map(pid => `${esc((proj(pid) || {}).name || 'smazaná stavba')} (${fmtH(mimo[pid])})`).join(', ')}.
      Tyhle hodiny se do tabulky ani do exportu nepočítají — pokud tam patří, zaškrtni je nahoře.
    </div>` : ''}
    <div class="card" style="margin-top:12px;background:#f8fafc">
      <h3>🔎 Křížová kontrola proti deníku (#25)</h3>
      ${sel.map(udi => { const u = userById(udi); if (!u) return ''; const pairs = [...(attPairs[udi] || [])]; const missing = pairs.filter(k => !entryDaySet.has(k)); const okk = missing.length === 0; return `
        <div class="urow"><span>${okk ? '✅' : '⚠️'}</span><b>${esc(fullName(u))}</b>
        <span class="muted" style="margin-left:auto">docházka: <b>${pairs.length} dní</b> · deník existuje pro <b>${pairs.length - missing.length}</b> z nich${okk ? '' : ` — <b style="color:var(--red)">chybí zápis: ${missing.slice(0, 5).map(k => fmtISO(k.split('|')[0]) + ' (' + esc((proj(k.split('|')[1]) || {}).name || '?') + ')').join(', ')}${missing.length > 5 ? ' +' + (missing.length - 5) + ' dalších' : ''}</b>`}</span></div>`; }).join('')}
      <div class="note">Kontroluje se: každý den z docházky má mít deníkový zápis na stejném projektu. Chybějící dny prověř před proplacením (#25).</div>
    </div>
  </div>`;
}
/* CSV pro ucetni. Kazda hodnota je v uvozovkach a uvozovka uvnitr se zdvojuje —
   nazev stavby se strednikem uz nerozhodi sloupce. Cisla maji desetinnou carku,
   at je cesky Excel nebere jako text. */
function repCsvPole(v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }
function repCsvRadek(pole) { return pole.map(repCsvPole).join(';') + '\n'; }
function repCsvCislo(n) { return String(n).replace('.', ','); }
function repExport() {
  if (!repObdobiOk()) { toast('Vyplň celé období.'); return; }
  const H = hoursFromAttendance(S.repFrom, S.repTo);
  let csv = repCsvRadek(['Pracovnik', 'Projekt', 'Hodiny', 'Dny', 'Neuplne dny', 'Pauza (min)', 'Sazba plati od', 'Sazba hruba', 'Sazba cista', 'Kc hruba', 'Kc cista']);
  let tH = 0, tDni = 0, tNeu = 0, tPauza = 0, tHruba = 0, tCista = 0;
  S.repWorkers.forEach(udi => {
    const u = userById(udi); if (!u) return;
    S.repProjects.forEach(pid => {
      const h = H[udi] && H[udi][pid]; if (!h) return;
      const p = penizeZaHodiny(udi, h);
      const jmenoP = (proj(pid) || {}).name || 'smazaná stavba';
      /* Kdyz se sazba behem obdobi menila, ma stavba VIC RADKU — jeden za
         kazdou sazbu, at si to Katka umi prepocitat na papire. Dny, neuplne
         dny a pauza patri celemu obdobi, ne jedne sazbe, proto jsou jen
         na prvnim radku — soucet CELKEM pak vyjde stejne. */
      const casti = p.sazby.slice();
      if (p.hodBezSazby > 0) casti.push({ h: 0, c: 0, od: null, hod: p.hodBezSazby, dni: 0 });
      if (!casti.length) casti.push({ h: 0, c: 0, od: null, hod: h.h, dni: 0 });
      casti.forEach((cst, i) => {
        /* Bez ciste sazby dostane clovek celou hrubou, takze „Kc cista" = hruba. */
        const hruba = cst.h ? cst.hod * cst.h : 0;
        const cista = cst.h ? cst.hod * (cst.c || cst.h) : 0;
        csv += repCsvRadek([fullName(u), jmenoP,
          repCsvCislo(cst.hod.toFixed(2)), i ? '' : h.dni, i ? '' : (h.incomplete || 0), i ? '' : (h.pauzaMin || 0),
          (cst.od && cst.od !== SAZBA_ODJAKZIVA) ? cst.od : '',
          cst.h ? repCsvCislo(cst.h) : '', cst.c ? repCsvCislo(cst.c) : '',
          cst.h ? Math.round(hruba) : '', cst.h ? Math.round(cista) : '']);
      });
      tH += h.h; tDni += h.dni; tNeu += h.incomplete || 0; tPauza += h.pauzaMin || 0;
      tHruba += p.hruba; tCista += p.cista;
    });
  });
  /* Souhrn se scita z nezaokrouhlenych castek a zaokrouhli se az tady —
     stejne jako radek „Celkem" v tabulce, jinak by se lisily o par korun. */
  csv += repCsvRadek(['CELKEM', '', repCsvCislo(tH.toFixed(2)), tDni, tNeu, tPauza, '', '', Math.round(tHruba), Math.round(tCista)]);
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = 'report_hodiny_' + S.repFrom + '_' + S.repTo + '.csv'; a.click();
}

/* ---- Uživatelé ---- */

/* Filtr skupin je VICENASOBNY — Marco chce vidět třeba vedení a suby naráz.
   S.uzivateleFiltr je pole klíčů typu ('kanc','teren','sub','inv').
   Prázdné pole = všichni. Starší uložený stav byl jeden řetězec, proto
   se tu pro jistotu srovnává na pole. */
function uzFiltrPole() {
  const f = S.uzivateleFiltr;
  if (Array.isArray(f)) return f;
  S.uzivateleFiltr = f ? [f] : [];
  return S.uzivateleFiltr;
}
function uzFiltrZapnuty(k) {
  const f = uzFiltrPole();
  return k ? f.indexOf(k) >= 0 : f.length === 0;
}
function uzFiltrPrepni(k) {
  const f = uzFiltrPole();
  if (!k) S.uzivateleFiltr = [];                 /* „Všichni" filtr zruší */
  else {
    const i = f.indexOf(k);
    S.uzivateleFiltr = i >= 0 ? f.filter(x => x !== k) : f.concat([k]);
  }
  render();
}
/* Člověk se ukáže, když patří aspoň do jedné vybrané skupiny. */
function uzFiltrovani() {
  const f = uzFiltrPole();
  if (!f.length) return S.users;
  return S.users.filter(u => f.some(k => (u.typ || {})[k]));
}

/* Dva lide se stejnym jmenem se na prihlasovaci obrazovce nedaji rozeznat
   (roster vypisuje jen jmeno a popis) a odpracovane hodiny se pak tise deli
   mezi dve totoznosti. Seznam uzivatelu na to proto upozorni. */
function jmenoKlic(u) { return fullName(u).trim().replace(/\s+/g, ' ').toLowerCase(); }
function jmenovciMapa() {
  const m = {};
  S.users.forEach(u => { const k = jmenoKlic(u); if (k) m[k] = (m[k] || 0) + 1; });
  return m;
}
function pgUzivatele() {
  const JMENOVCI = jmenovciMapa();
  const jsouJmenovci = Object.keys(JMENOVCI).some(k => JMENOVCI[k] > 1);
  return `
  <div class="strip"><h1>Uživatelé</h1><span class="sp"></span><button class="btn amber" onclick="S.newUserType=null;S.editUserId=null;S.newUserActive=null;goPage('newuser')">➕ PŘIDAT</button></div>
  <main>
    <div class="card">
      <h3>🔑 Jak fungují práva — jednoduše (#33)</h3>
      <div class="urow"><span class="uav">🗂</span><b>Vedení</b><span class="muted" style="margin-left:auto">vše, všude — schvaluje zápisy, fotky, hodiny, vícepráce</span></div>
      <div class="urow"><span class="uav">👷</span><b>Pracovník</b><span class="muted" style="margin-left:auto">zápis, fotky, docházka · ceny nevidí nikdy</span></div>
      <div class="urow"><span class="uav">🔧</span><b>Subdodavatel</b><span class="muted" style="margin-left:auto">jako pracovník · klientské ceny a marže nevidí — hlídá struktura</span></div>
      <div class="urow"><span class="uav">🏠</span><b>Investor</b><span class="muted" style="margin-left:auto">jen portál přes odkaz: schválené zápisy a fotky</span></div>
    </div>
    <div class="tablecard">
      <div class="uktabs" style="padding:10px 12px 0;flex-wrap:wrap">
        ${[['', '👥 Všichni'], ['kanc', '🗂 Vedení'], ['teren', '👷 Parta'], ['sub', '🔧 Subdodavatelé'], ['inv', '🏠 Investoři']].map(([k, t]) => `
          <div class="t ${uzFiltrZapnuty(k) ? 'active' : ''}" onclick="uzFiltrPrepni('${k}')">${t} · ${k ? S.users.filter(u => (u.typ || {})[k]).length : S.users.length}</div>`).join('')}
      </div>
      <div style="overflow-x:auto"><table>
        <tr><th></th><th>Jméno</th><th>Email</th><th>Kancelářský</th><th>Terénní</th><th>Investor</th><th>Sub</th><th>Sazba hrubá / čistá</th><th>Popis</th><th>Přihlášení</th><th></th></tr>
        ${uzFiltrovani().map(u => { const t = u.typ || {}; const s = S.sazby[u.id]; return `
        <tr style="${u.active === false ? 'opacity:.5' : ''}">
          <td><span class="uav">${ini(u)}</span></td>
          <td><b>${esc(fullName(u))}</b>${(JMENOVCI[jmenoKlic(u)] || 1) > 1
            ? `<br><span class="badge b-red" style="margin-top:3px">⚠ ${JMENOVCI[jmenoKlic(u)] === 2 ? 'Dva účty' : JMENOVCI[jmenoKlic(u)] + (JMENOVCI[jmenoKlic(u)] < 5 ? ' účty' : ' účtů')} se stejným jménem</span>` : ''}</td>
          <td class="muted">${esc(kontaktOsoby(u.id).email || '—')}</td>
          <td style="text-align:center">${t.kanc ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td style="text-align:center">${t.teren ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td style="text-align:center">${t.inv ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td style="text-align:center">${t.sub ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td>${s && s.h ? `<b>${s.h} Kč/h</b>${s.c ? ` / <span style="color:var(--ok);font-weight:700">${s.c} Kč/h</span>` : ''}${sazbaHist(s).length > 1 ? `<br><span class="muted" style="font-size:11px">od ${fmtISO(sazbaHist(s)[sazbaHist(s).length - 1].od)} · ${sazbaHist(s).length}× měněno</span>` : ''}` : (t.teren && !t.kanc ? '<b style="color:var(--red)">⚠ chybí</b>' : '<span class="muted">—</span>')}</td>
          <td>${esc(u.role || '—')}</td>
          <td style="white-space:nowrap">${u.uid
            ? `<span class="badge b-ok">✓ má účet</span><br><button class="btn ghost sm" style="margin-top:4px" onclick="pinForm('${u.id}')">🔑 nový PIN</button>
               <button class="btn ghost sm" style="margin-top:4px" title="Zrušit přihlášení" onclick="zrusitPrihlaseni('${u.id}')">🚫</button>`
            : (t.inv ? '<span class="muted">portál</span>' : `<button class="btn ghost sm" onclick="loginForm('${u.id}')">🔑 vytvořit</button>`)}</td>
          <td style="white-space:nowrap"><span class="lnk" onclick="editUser('${u.id}')">✏️</span>
            <span class="lnk" style="margin-left:8px" title="Smazat uživatele" onclick="delUser('${u.id}')">🗑</span></td>
        </tr>`; }).join('')}
      </table></div>
      <div class="pagefoot"><span>${uzFiltrovani().length} z ${S.users.length} uživatelů</span></div>
    </div>
    <div class="note">Čistá sazba (#34) je citlivý údaj — vidí ji jen Vedení. „Vytvořit přihlášení" založí pracovníkovi PIN pro mobilní přihlášení.</div>
    ${jsouJmenovci ? `<div class="note" style="color:var(--red)">⚠ <b>Dva účty se stejným jménem.</b>
      Na přihlašovací obrazovce se nedají rozeznat — kdo si vybere ten druhý, odpracuje si hodiny pod jinou identitou
      a ve výplatách i v deníku pak člověk vypadá, že tam půl měsíce nebyl.<br>
      <b>Co s tím:</b> otevři si u obou docházku a zjisti, který účet se opravdu používá.
      Ten druhý přepni na <b>neaktivního</b> a zruš mu přihlášení (🚫) — historie zůstane dohledatelná.
      Když jde opravdu o dva různé lidi, odliš je ve jméně (třeba „Marco Mercuri ml.").</div>` : ''}
  </main>`;
}
function loginForm(udi) {
  const u = userById(udi);
  modal(`<h3>🔑 Přihlášení pro: ${esc(fullName(u))}</h3>
    <div class="note">Pracovník se přihlásí tak, že na úvodní obrazovce klepne na své jméno a zadá PIN.</div>
    <label>PIN (min. 6 číslic)</label><input type="text" id="lf-pin" inputmode="numeric" placeholder="např. 738291">
    <label>Popisek na přihlašovací obrazovce</label><input type="text" id="lf-pop" value="${esc(u.role || '')}">
    <div class="aprv"><button class="btn amber" onclick="createLogin('${udi}')">💾 Vytvořit účet</button><button class="btn ghost" onclick="closeModal()">Zrušit</button></div>`);
}
async function createLogin(udi) {
  const pin = $('#lf-pin').value.trim();
  if (pin.length < 6) { toast('PIN musí mít aspoň 6 znaků'); return; }
  const u = userById(udi);
  /* Prihlasovaci adresa se cisluje stejne jako u resetPin (pinVerze).
     Ucet ve Firebase Authentication z prohlizece smazat nejde — po zruseni
     prihlaseni tam adresa zustava obsazena a druhy pokus by narazil na
     „ucet uz existuje" a clovek by se nedal zapojit zpatky.
     Verze 1 = adresa bez cisla, aby uz zalozene ucty platily dal. */
  const verze = u.pinVerze || 1;
  const authEmail = 'u' + udi.toLowerCase() + (verze > 1 ? '.v' + verze : '') + '@denik.rekovrana.cz';
  try {
    const secondary = firebase.apps.find(a => a.name === 'sec') || firebase.initializeApp(CFG.firebase, 'sec');
    const cred = await secondary.auth().createUserWithEmailAndPassword(authEmail, pin);
    const role = roleOfTypeKey(typeKeyOfUser(u));
    await db.collection('users_auth').doc(cred.user.uid).set({ role, userDocId: udi, name: fullName(u) });
    await db.collection('users').doc(udi).update({ uid: cred.user.uid, authEmail, pinVerze: verze });
    /* Do verejneho rosteru jde jen parta a subdodavatele — ti se pres nej
       hledaji na prihlasovaci obrazovce. Vedeni (admin) tam nepatri (B6):
       roster cte kdokoli z internetu a vydal by prihlasovaci e-mail
       vedeni i to, ktery ucet je admin. */
    if (role !== 'admin') {
      await db.collection('roster').doc(udi).set({ jmeno: u.jmeno, prijmeni: u.prijmeni, authEmail, role, popis: $('#lf-pop').value.trim() });
    } else {
      await db.collection('roster').doc(udi).delete().catch(() => {});
    }
    await secondary.auth().signOut();
    closeModal(); toast('Účet vytvořen ✓ PIN předej pracovníkovi.');
  } catch (e) {
    /* Zbyla adresa ze zruseneho prihlaseni (nebo z doby pred cislovanim):
       zvednout pinVerze a nechat vedeni tuknout znovu — druhy pokus uz
       sklada jinou adresu a projde. Nic se nemusi migrovat. */
    if (e.code === 'auth/email-already-in-use') {
      await db.collection('users').doc(udi).update({ pinVerze: verze + 1 }).catch(() => {});
      toast('Adresa byla obsazená — ťukni prosím na „Vytvořit účet" ještě jednou.');
    } else toast('Chyba: ' + e.message);
  }
}
/* ---- zmena PINu a zruseni prihlaseni (B1) ----
   Firebase z prohlizece neumi zmenit heslo cizimu uctu — to svede jen server.
   Delame to tedy oklikou: zalozi se novy prihlasovaci ucet s novym PINem
   a staremu se odeberou prava (smaze se jeho zaznam v users_auth). Starym
   PINem uz se pak nikdo nikam nedostane. Dochazka a zadosti se prepnou na
   novy ucet, aby pracovnik neprisel o svou historii a o rozdelanou smenu. */
function pinForm(udi) {
  const u = userById(udi); if (!u) return;
  modal(`<h3>🔑 Nový PIN pro: ${esc(fullName(u))}</h3>
    <div class="note" style="margin-top:0">Starý PIN okamžitě přestane platit. Nový mu předej osobně —
      nikde se nedá zpětně zobrazit.</div>
    <label>Nový PIN (min. 6 číslic)</label><input type="text" id="pin-novy" inputmode="numeric" placeholder="např. 481207">
    <label>Popisek na přihlašovací obrazovce</label><input type="text" id="pin-pop" value="${esc(u.role || '')}">
    <div class="aprv"><button class="btn amber" onclick="resetPin('${udi}')">💾 Nastavit nový PIN</button>
    <button class="btn ghost" onclick="closeModal()">Zrušit</button></div>`);
}
/* Prevod historie na novy prihlasovaci ucet (S20).
   Vse, co si mobil vybira podle authUid, musi po vymene PINu ukazovat
   na novy ucet — jinak to clovek vubec neuvidi a pravidla mu to ani
   neprectou. Pta se primo databaze, ne pameti: vedeni ma nactene jen
   posledni mesic, takze starsi zaznamy by v pameti chybely.
   POZNAMKA: fotonahledy nesou autorUid, ale pravidla u nich zakazuji
   jakoukoli zmenu (allow update: if false) — prevest je nejde. Dopad je
   maly: nahledy se zobrazuji vsem, jen si je autor po vymene PINu nesmaze
   sam (smaze je vedeni). */
async function prenesNaNovyUcet(staryUid, novyUid) {
  const KDE = [['tickety', 'authUid'], ['hlaseni', 'authUid'], ['attendance', 'authUid'], ['zadosti', 'authUid'], ['entries', 'authorUid']];
  let n = 0;
  for (const dvojice of KDE) {
    const kolekce = dvojice[0], pole = dvojice[1];
    try {
      const s = await db.collection(kolekce).where(pole, '==', staryUid).get();
      for (const d of s.docs) {
        const zmena = {}; zmena[pole] = novyUid;
        await d.ref.update(zmena).then(() => { n++; }).catch(() => {});
      }
    } catch (e) { console.warn('prevod ' + kolekce + ' na novy ucet', e); }
  }
  return n;
}
async function resetPin(udi) {
  const pin = ($('#pin-novy').value || '').trim();
  if (pin.length < 6) { toast('PIN musí mít aspoň 6 znaků'); return; }
  const u = userById(udi); if (!u) return;
  const verze = (u.pinVerze || 1) + 1;
  const authEmail = 'u' + udi.toLowerCase() + '.v' + verze + '@denik.rekovrana.cz';
  const staryUid = u.uid || null;
  try {
    const secondary = firebase.apps.find(a => a.name === 'sec') || firebase.initializeApp(CFG.firebase, 'sec');
    const cred = await secondary.auth().createUserWithEmailAndPassword(authEmail, pin);
    const role = roleOfTypeKey(typeKeyOfUser(u));
    await db.collection('users_auth').doc(cred.user.uid).set({ role, userDocId: udi, name: fullName(u) });
    await db.collection('users').doc(udi).update({ uid: cred.user.uid, authEmail, pinVerze: verze });
    /* Vedeni (admin) do verejneho rosteru nepatri — viz B6 u createLogin. */
    if (role !== 'admin') {
      await db.collection('roster').doc(udi).set({ jmeno: u.jmeno, prijmeni: u.prijmeni, authEmail, role, popis: ($('#pin-pop').value || '').trim() }, { merge: true });
    } else {
      await db.collection('roster').doc(udi).delete().catch(() => {});
    }
    if (staryUid) await db.collection('users_auth').doc(staryUid).delete().catch(() => {});
    // historie je navazana na ucet — prepnout, jinak by pracovnik videl prazdno
    // (u clovka, ktery je ve firme dele, to par vterin trva — proto hlaska)
    toast('Nový PIN platí ✓ Přenáším historii na nový účet…');
    let presunuto = 0;
    for (const a of S.attendance.filter(x => x.userDocId === udi && x.authUid !== cred.user.uid)) {
      await db.collection('attendance').doc(a.id).update({ authUid: cred.user.uid }).catch(() => {}); presunuto++;
    }
    for (const z of S.zadosti.filter(x => x.userDocId === udi && x.authUid !== cred.user.uid)) {
      await db.collection('zadosti').doc(z.id).update({ authUid: cred.user.uid }).catch(() => {});
    }
    /* Na starem uctu visi i dalsi veci, ktere se v mobilu vybiraji podle
       authUid (S20). Pamet vedeni je omezena 30dennim oknem, proto se
       ptame primo databaze podle stareho uid — jinak by starsi zaznamy
       zustaly viset na uctu, ktery uz nikdo nepouziva:
         tickety   — hlaseni chyb a odpovedi vedeni (bez prevodu je
                     pracovnik po vymene PINu vubec neuvidi, pravidla
                     mu je neprectou),
         hlaseni   — prichody/odchody subdodavatelu,
         entries   — zapisy v deniku (authorUid rozhoduje o tom, jestli
                     smi autor jeste opravit svuj zapis a jestli fronta
                     doplni fotky nahrane na Drive az po odeslani). */
    if (staryUid) presunuto += await prenesNaNovyUcet(staryUid, cred.user.uid);
    await secondary.auth().signOut();
    closeModal();
    toast('Nový PIN nastaven ✓ Starý už neplatí' + (presunuto ? ' · historie přenesena (' + presunuto + ' záznamů)' : '') + '.');
  } catch (e) {
    toast('Nepovedlo se: ' + (e.code === 'auth/email-already-in-use' ? 'zkus to prosím ještě jednou' : (e.code || e.message)));
  }
}
async function zrusitPrihlaseni(udi) {
  const u = userById(udi); if (!u || !u.uid) return;
  if (!await potvrd('Zrušit přihlášení pro ' + fullName(u) + '?\n\nJeho PIN přestane platit a zmizí z přihlašovací obrazovky.\nZáznamy docházky a zápisy v deníku zůstanou.')) return;
  try {
    await db.collection('users_auth').doc(u.uid).delete().catch(() => {});
    await db.collection('roster').doc(udi).delete().catch(() => {});
    /* Ucet v Authentication zustava — smazat ho jde jen ze serveru. Proto
       se zvedne pinVerze: az bude clovek potrebovat prihlaseni znovu,
       createLogin mu poskladá NOVOU adresu a nenarazi na „ucet uz existuje".
       Bez tohohle se zrusene prihlaseni uz nikdy nedalo zalozit. */
    await db.collection('users').doc(udi).update({
      uid: firebase.firestore.FieldValue.delete(),
      authEmail: firebase.firestore.FieldValue.delete(),
      pinVerze: (u.pinVerze || 1) + 1
    });
    toast('Přihlášení zrušeno ✓ Až mu ho budeš vytvářet znovu, dostane novou adresu.');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}

/* ---- mazani (B2) ----
   Co je podkladem pro vyplatu nebo pro stavebni denik, se nemaze potichu.
   Proto: dokud na veci visi dochazka nebo zapisy, nabidne se jen deaktivace
   a rekne se proc. Prazdna polozka (preklep, testovaci zaznam) jde pryc. */
async function delTask(id) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  if (!await potvrd('Smazat úkol?\n\n„' + (t.title || '') + '"\n\nSmazání nejde vrátit zpět.')) return;
  const _t = S.tasks.find(x => x.id === id) || {};
  for (const f of (_t.photos || [])) db.collection('fotonahledy').doc(f.id).delete().catch(() => {});
  try { await db.collection('tasks').doc(id).delete(); toast('Úkol smazán ✓'); }
  catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
async function delEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  const p = proj(e.pid) || {};
  if (!await potvrd('Smazat denní záznam?\n\n' + fmtISOFull(e.date) + ' · ' + (p.name || '') + '\nZapsal: ' + (e.author || '') +
    '\n\nZmizí i z portálu investora. Smazání nejde vrátit zpět.')) return;
  try {
    const tok = await tokenPortaluAsync(e.pid); // token je v admin-only /portaly (S2)
    if (tok) await db.collection('portals').doc(tok).collection('feed').doc(id).delete().catch(() => {});
    for (const ph of (e.photos || [])) {
      if (ph.id) db.collection('fotonahledy').doc(ph.id).delete().catch(() => {});
      /* velka kopie fotky na portalu — bez uklidu by tam strasila navzdy */
      if (ph.id && tok) db.collection('portals').doc(tok).collection('fotky').doc(ph.id).delete().catch(() => {});
    }
    /* interni poznamka bydli v /entries_interni (S5) — uklidit s ni */
    db.collection('entries_interni').doc(id).delete().catch(() => {});
    await db.collection('entries').doc(id).delete();
    S.detail = null; toast('Záznam smazán ✓'); render();
  } catch (err) { toast('Nepovedlo se: ' + (err.code || err.message)); }
}
async function delProject(pid) {
  const p = proj(pid); if (!p) return;
  /* Pocty, pojistka i mazani MUSI jit z databaze, ne z pameti — naživo je
     jen posledni mesic (OKNO_DNU). Z pameti by pojistka mlcela u starsi
     stavby a mazani by nechalo v databazi sirotky bez projektu. */
  let ent, att, tsk, vpr, hls, kli, fot, pzn;
  try {
    [ent, att, tsk, vpr, hls, kli, fot, pzn] = await Promise.all([
      db.collection('entries').where('pid', '==', pid).get(),
      db.collection('attendance').where('pid', '==', pid).get(),
      db.collection('tasks').where('pid', '==', pid).get(),
      db.collection('viceprace').where('pid', '==', pid).get(),
      db.collection('hlaseni').where('pid', '==', pid).get(),
      db.collection('klice').where('pid', '==', pid).get(),
      db.collection('fotonahledy').where('pid', '==', pid).get(),
      /* Poznamky ke stavbe (kody od dveri, kontakty na spravce) se vazou
         pres pid a doted po smazani stavby zustavaly v databazi jako
         sirotci — nikde uz se nezobrazily a nikdo je nesmazal. */
      db.collection('poznamky').where('pid', '==', pid).get()
    ]);
  } catch (e) {
    await oznam('Nepodařilo se ověřit, co na stavbě visí (' + (e.code || e.message) + ').\n\nBez toho se stavba nemaže — zkus to znovu s připojením.');
    return;
  }
  const zapisu = ent.size, dochazky = att.size, hlaseni = hls.size, klicu = kli.size, poznamek = pzn.size;
  const ukolu = tsk.docs.filter(d => (d.data().stav || '') !== 'sablona').length;
  const vp = vpr.size;
  if (dochazky || hlaseni) {
    await oznam('Stavbu „' + p.name + '" smazat nejde.\n\nVisí na ní ' + dochazky + ' záznamů docházky' + (hlaseni ? ' a ' + hlaseni + ' hlášení subdodavatelů' : '') + ' — to je podklad pro výplaty a fakturaci ' +
      'a nesmí zmizet.\n\nPřepni ji na neaktivní: zmizí z výběru na stavbě i z nabídky nových zápisů, ale historie zůstane.');
    return;
  }
  const drzene = kli.docs.filter(d => d.data().drzitelId).length;
  if (drzene) {
    await oznam('Stavbu „' + p.name + '" smazat nejde.\n\nNěkdo pořád drží ' + drzene + ' jejích klíčů. Nejdřív je v evidenci klíčů nech vrátit, pak jdi mazat.');
    return;
  }
  if (!await potvrd('Opravdu smazat stavbu „' + p.name + '"?\n\nSmaže se i: ' + zapisu + ' zápisů deníku, ' + ukolu + ' úkolů, ' + vp +
    ' víceprací' + (klicu ? ', ' + klicu + ' klíčů' : '') + ' a portál investora.\n\nSmazání nejde vrátit zpět.')) return;
  if (zapisu + ukolu + vp > 0 && !await potvrd('Ještě jednou pro jistotu — smazat ' + (zapisu + ukolu + vp) + ' navázaných záznamů?')) return;
  try {
    /* maze se PRESNE to, co nasly dotazy vyse — vsechno vazane na pid */
    for (const d of ent.docs) {
      /* interni poznamky zapisu bydli v /entries_interni (S5) — bez
         tohohle by po smazani stavby zustaly sirotci poznamky */
      db.collection('entries_interni').doc(d.id).delete().catch(() => {});
      await d.ref.delete().catch(() => {});
    }
    for (const d of tsk.docs) await d.ref.delete().catch(() => {});
    for (const d of vpr.docs) await d.ref.delete().catch(() => {});
    for (const d of kli.docs) await d.ref.delete().catch(() => {});
    /* fotonahledy zapisu i ukolu stavby — delEntry je uklizi, tady se doted neuklizely vubec */
    for (const d of fot.docs) await d.ref.delete().catch(() => {});
    /* poznamky ke stavbe — vazou se pres pid, doted se neuklizely vubec */
    for (const d of pzn.docs) await d.ref.delete().catch(() => {});
    /* zapisy stavby pryc i z archivu slevani, at v Deniku nestrasi duchove */
    S.archiv.entries.forEach((d, id) => { if (d.pid === pid) S.archiv.entries.delete(id); });
    slozOkno('entries');
    const tok = await tokenPortaluAsync(pid); // token je v admin-only /portaly (S2)
    if (tok) {
      /* 'fotky' = velke kopie fotek pro investora — mazou se s portalem */
      /* 'actions' = souhlasy investora s vicepracemi. Doted zustavaly
         v databazi i po smazani stavby. */
      for (const kol of ['feed', 'vp', 'docs', 'soubory', 'fotky', 'actions']) {
        const sn = await db.collection('portals').doc(tok).collection(kol).get().catch(() => null);
        if (sn) for (const d of sn.docs) await d.ref.delete().catch(() => {});
      }
      await db.collection('portals').doc(tok).delete().catch(() => {});
    }
    await db.collection('portaly').doc(pid).delete().catch(() => {}); // i zaznam s tokenem
    await db.collection('projects').doc(pid).delete();
    S.projDetailId = null; goPage('projekty'); toast('Stavba smazána ✓');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
async function delUser(udi) {
  const u = userById(udi); if (!u) return;
  /* Pojistka z databaze, ne z pameti (30denni okno) — clovek neaktivni pres
     mesic by jinak sel smazat i s celou mzdovou historii. Sub navic dochazku
     nema (pise hlaseni) a kdokoli muze zrovna drzet klic od stavby. */
  const nic = { docs: [], size: 0 };
  let att, attU, entA, entU, hls, kli;
  try {
    [att, attU, entA, entU, hls, kli] = await Promise.all([
      db.collection('attendance').where('userDocId', '==', udi).get(),
      u.uid ? db.collection('attendance').where('authUid', '==', u.uid).get() : Promise.resolve(nic),
      db.collection('entries').where('author', '==', fullName(u)).get(),
      u.uid ? db.collection('entries').where('authorUid', '==', u.uid).get() : Promise.resolve(nic),
      db.collection('hlaseni').where('userDocId', '==', udi).get(),
      db.collection('klice').where('drzitelId', '==', udi).get()
    ]);
  } catch (e) {
    await oznam('Nepodařilo se ověřit historii uživatele (' + (e.code || e.message) + ').\n\nBez toho se nemaže — zkus to znovu s připojením.');
    return;
  }
  const dochazky = new Set([...att.docs, ...attU.docs].map(d => d.id)).size;
  const zapisu = new Set([...entA.docs, ...entU.docs].map(d => d.id)).size;
  const hlaseni = hls.size;
  if (dochazky || zapisu || hlaseni) {
    await oznam(fullName(u) + ' smazat nejde.\n\nMá ' + dochazky + ' záznamů docházky, ' + zapisu + ' zápisů v deníku a ' + hlaseni + ' hlášení — ' +
      'to je podklad pro výplaty, fakturaci a stavební deník.\n\nMísto smazání: zruš mu přihlášení (🚫) a přepni ho na neaktivního. ' +
      'Zmizí ze všech výběrů, ale historie zůstane dohledatelná.');
    return;
  }
  if (kli.size) {
    await oznam(fullName(u) + ' smazat nejde.\n\nDrží ' + kli.size + ' klíčů. Nejdřív je v evidenci klíčů předej někomu jinému nebo vrať do kanceláře.');
    return;
  }
  if (!await potvrd('Opravdu smazat ' + fullName(u) + '?\n\nNemá žádnou docházku, zápisy ani hlášení. Smazání nejde vrátit zpět.')) return;
  try {
    if (u.uid) await db.collection('users_auth').doc(u.uid).delete().catch(() => {});
    await db.collection('roster').doc(udi).delete().catch(() => {});
    await db.collection('sazby').doc(udi).delete().catch(() => {});
    await db.collection('kontakty').doc(udi).delete().catch(() => {}); // kontakty bydli zvlast (S4)
    for (const t of S.tasks.filter(x => x.respId === udi)) await db.collection('tasks').doc(t.id).update({ respId: '' }).catch(() => {});
    await db.collection('users').doc(udi).delete();
    goPage('uzivatele'); toast('Uživatel smazán ✓');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}

/* Role pro prihlaseni se odvozuje JEN tady, aby se createLogin a saveUser
   nemohly rozejit. Drive se pri zmene typu uzivatele role v roster/users_auth
   neprepsala a clovek zustal treba adminem. */
function roleOfTypeKey(k) { return k === 'kanc' ? 'admin' : k === 'sub' ? 'sub' : 'worker'; }
function typeKeyOfUser(u) {
  const t = (u && u.typ) || {};
  return t.kanc ? 'kanc' : t.inv ? 'inv' : t.sub ? 'sub' : 'teren';
}
/* newUserActive = prepinac „Aktivni uzivatel" v pameti. Nuluje se pri kazdem
   otevreni formulare, jinak by se stav prenesl na dalsiho cloveka. */
const POLE_UZIVATELE = ['nu-j', 'nu-p', 'nu-tel', 'nu-e', 'nu-sh', 'nu-sc', 'nu-sod', 'nu-r'];
function editUser(udi) { zapomen(...POLE_UZIVATELE); S.editUserId = udi; S.newUserType = null; S.newUserActive = null; goPage('newuser'); }
/* Smazani omylem zadane sazby. Dokument se prepisuje CELY (set bez merge),
   protoze se meni pole i aktualni h/c — merge by stare h/c nechal viset. */
async function smazSazbuOd(udi, od) {
  const s = S.sazby[udi]; if (!s) return;
  const hist = sazbaHist(s).filter(z => z.od !== od);
  if (!await potvrd('Smazat záznam sazby platný od ' + (od === SAZBA_ODJAKZIVA ? 'nepaměti' : fmtISO(od)) + '?\n\n'
    + 'Report za dny, které tahle sazba pokrývala, se přepočítá '
    + (hist.length ? 'předchozí sazbou.' : 'aktuální sazbou.'), 'Smazat')) return;
  const posl = hist.length ? hist[hist.length - 1] : null;
  const nova = posl
    ? (posl.c ? { h: posl.h, c: posl.c, hist } : { h: posl.h, hist })
    : (s.c ? { h: s.h, c: s.c, hist: [] } : { h: s.h, hist: [] });
  try { await db.collection('sazby').doc(udi).set(nova); toast('Záznam sazby smazán ✓'); }
  catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
function pgNewUser() {
  const edit = S.editUserId ? userById(S.editUserId) : null;
  const t = S.newUserType || (edit ? (edit.typ.kanc ? 'kanc' : edit.typ.inv ? 'inv' : edit.typ.sub ? 'sub' : 'teren') : null);
  const s = edit ? S.sazby[edit.id] : null;
  const TYPES = [{ k: 'kanc', t: 'Kancelářský (Vedení)', ic: '🖥' }, { k: 'teren', t: 'Terénní pracovník', ic: '📱' }, { k: 'inv', t: 'Investor', ic: '💰' }, { k: 'sub', t: 'Subdodavatel', ic: '👥' }];
  return `
  <div class="strip"><span class="back" onclick="goPage('uzivatele')">←</span><h1>${edit ? 'Upravit uživatele' : 'Uživatelé — nový'}</h1><span class="sp"></span><button class="btn amber" onclick="saveUser()">💾 ULOŽIT</button></div>
  <main style="max-width:680px">
    <div class="card">
      <h3>🔑 Typ přístupu</h3>
      <div class="typecards">${TYPES.map(x => `<div class="tcard ${t === x.k ? 'sel' : ''}" onclick="S.newUserType='${x.k}';render()">${x.t}<span class="tic">${x.ic}</span></div>`).join('')}</div>
      ${t ? `
      <div class="formsec">
        <h4>👤 Osobní údaje</h4>
        <div class="frow">
          <div><label>Jméno *</label><input type="text" id="nu-j" value="${esc(edit ? edit.jmeno : '')}"></div>
          <div><label>Příjmení *</label><input type="text" id="nu-p" value="${esc(edit ? edit.prijmeni : '')}"></div>
        </div>
        <div class="frow">
          <div><label>Telefon</label><input type="text" id="nu-tel" value="${esc(edit ? kontaktOsoby(edit.id).tel || '' : '')}" placeholder="+420"></div>
          <div><label>Email</label><input type="text" id="nu-e" value="${esc(edit ? kontaktOsoby(edit.id).email || '' : '')}"></div>
        </div>
      </div>
      ${t === 'teren' ? `
      <div class="formsec">
        <h4>⏱ Sazby (#34) — vidí jen Vedení</h4>
        <div class="note" style="margin-top:0">Subdodavatel sazbu nemá — hodiny nevykazuje, fakturuje práci.</div>
        <div class="frow">
          <div><label>Hrubá sazba Kč/h *</label><input type="number" id="nu-sh" value="${s && s.h ? s.h : ''}" placeholder="co stojí hodina firmu"></div>
          <div><label>Čistá sazba Kč/h (volitelná)</label><input type="number" id="nu-sc" value="${s && s.c ? s.c : ''}" placeholder="co pracovník reálně dostane"></div>
        </div>
        <div class="frow">
          <div><label>Platí od</label><input type="date" id="nu-sod" value="${isoToday()}"></div>
          <div><div class="note" style="margin-top:22px">Sazba se zpětně nepřepisuje. Report za starší měsíce zůstane na staré sazbě.</div></div>
        </div>
        <div class="note">Čistou vyplň u pracovníků, kterým vedoucí party sráží z hodinovky — report pak rozdíl ukáže automaticky.</div>
        ${edit && sazbaHist(s).length ? `
        <div class="formsec">
          <h4>📜 Dosavadní sazby</h4>
          ${sazbaHist(s).slice().reverse().map((z, i) => `
          <div class="urow">
            <span>${i === 0 ? '▶' : '·'}</span>
            <b>${z.h ? z.h + ' Kč/h' : 'sazba ukončena'}</b>${z.c ? ` <span class="muted">(čistá ${z.c} Kč/h)</span>` : ''}
            <span style="margin-left:8px">od <b>${z.od === SAZBA_ODJAKZIVA ? 'odjakživa' : fmtISO(z.od)}</b></span>
            ${i === 0 ? '<span class="badge b-ok" style="margin-left:8px">platí teď</span>' : ''}
            <span class="muted" style="margin-left:auto;font-size:11px">${esc(z.kdo || '')}${z.kdy ? ' · ' + fmtISO(z.kdy) : ''}</span>
            <span class="lnk" style="margin-left:10px" title="Smazat záznam" onclick="smazSazbuOd('${edit.id}','${z.od}')">🗑</span>
          </div>`).join('')}
          <div class="note">Smazání záznamu přepočítá report za období, které tou sazbou pokrývalo. Maž jen překlepy.</div>
        </div>` : ''}
      </div>` : ''}
      <div class="formsec">
        <h4>🏷 Popis</h4>
        <label>Popis — ukáže se pod jménem na přihlašovací obrazovce</label>
        <input type="text" id="nu-r" value="${esc(edit ? edit.role || '' : '')}" placeholder="např. Vedoucí party, Subdodavatel — elektro…">
      </div>
      ${/* Prepinac se drive ukladal SAM, hned po tuknuti — odchod pres „←"
           uz zmenu nevratil a tichou chybu zapisu (bez catch) se clovek
           nedozvedel. Ted zije v pameti a uklada se s celym formularem. */''}
      ${edit ? (() => { const akt = S.newUserActive != null ? S.newUserActive : edit.active !== false; return `
      <div class="formsec"><label style="display:flex;align-items:center;gap:8px;text-transform:none"><span class="toggle ${akt ? 'on' : ''}" onclick="S.newUserActive=${!akt};render()"><i></i></span> Aktivní uživatel</label>
        ${akt !== (edit.active !== false) ? '<div class="note" style="margin-top:6px">Změna se uloží až tlačítkem <b>💾 ULOŽIT</b>.</div>' : ''}</div>`; })() : ''}
      ` : '<div class="empty">Nejdřív vyber typ přístupu ↑</div>'}
    </div>
  </main>`;
}
/* Hromadna zmena jednoho pole ve vice dokumentech. Po jednom by se u cloveka
   s rocni historii cekalo pul minuty — do jedne davky se vejde 500 zmen. */
async function prepisPole(docs, zmena) {
  let n = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    const cast = docs.slice(i, i + 400);
    cast.forEach(d => b.update(d.ref, zmena));
    await b.commit();
    n += cast.length;
  }
  return n;
}
async function saveUser() {
  const edit = S.editUserId ? userById(S.editUserId) : null;
  const typKey = S.newUserType || (edit ? (edit.typ.kanc ? 'kanc' : edit.typ.inv ? 'inv' : edit.typ.sub ? 'sub' : 'teren') : null);
  if (!typKey) { toast('Vyber typ přístupu'); return; }
  const j = $('#nu-j').value.trim(), p = $('#nu-p').value.trim();
  if (!j || !p) { toast('Vyplň jméno a příjmení'); return; }
  /* Kontakty (email, telefon) NEJDOU do /users — ten ctou vsechny role
     vcetne externiho suba. Bydli v admin-only /kontakty (S4). Precist je
     nutne HNED, ze stejneho duvodu jako sazby nize (render maze formular). */
  const kEmail = $('#nu-e').value.trim(), kTel = $('#nu-tel') ? $('#nu-tel').value.trim() : '';
  const data = {
    jmeno: j, prijmeni: p,
    /* Typ je presne to, co vedeni zaskrtlo. Driv se subovi tise pridavalo
       i 'teren', aby prosel filtrem "komu jde zadat ukol" — obezlicka, ktera
       delala ze suba pracovnika i tam, kam nepatri (rucni doplneni dochazky,
       seznam dochazky). Seznamy se ted ptaji na suba rovnou. */
    typ: { kanc: typKey === 'kanc' ? 1 : 0, teren: (typKey === 'kanc' || typKey === 'teren') ? 1 : 0, inv: typKey === 'inv' ? 1 : 0, sub: typKey === 'sub' ? 1 : 0 },
    /* prepinac „Aktivni uzivatel" zije jen v pameti a uklada se az tady,
       stejne jako vsechna ostatni policka formulare */
    role: $('#nu-r').value.trim(), active: S.newUserActive != null ? S.newUserActive : (edit ? edit.active !== false : true)
  };
  // FIX: sazby přečíst z formuláře PŘED zápisem do users — await níže spustí onSnapshot render(),
  // který formulář překreslí a vyprázdní, takže se sazba nikdy neuložila (a existující se mazala).
  const shEl = $('#nu-sh'), scEl = $('#nu-sc'), sodEl = $('#nu-sod');
  const shVal = shEl ? parseFloat(shEl.value) : null, scVal = scEl ? parseFloat(scEl.value) : null;
  /* „Plati od" ze stejneho duvodu a na stejnem miste jako sazby — po awaitu
     nize uz formular neexistuje. Prazdne policko = ode dneska. */
  const sodVal = (sodEl && sodEl.value) ? sodEl.value : isoToday();
  let docId;
  if (edit) { await db.collection('users').doc(edit.id).update(data); docId = edit.id; }
  else { const ref = await db.collection('users').add({ ...data, createdAt: FV() }); docId = ref.id; }
  /* kontakty do admin-only /kontakty (S4); prazdny formular = uklidit zaznam */
  if (kEmail || kTel) await db.collection('kontakty').doc(docId).set({ email: kEmail, tel: kTel });
  else await db.collection('kontakty').doc(docId).delete().catch(() => {});
  /* Sazbu ma jen parta. Report vybira z repTerenni(), a ta bere
     `teren && !kanc` — vedeni, sub ani investor se do vyplat nedostanou.
     U vsech trech se pole se sazbou ve formulari vubec nevykresli, takze
     starou hodnotu je nutne smazat natvrdo: jinak by v seznamu uzivatelu
     dal svitilo treba „300 Kc/h", ktere uz nikdo neumi odstranit
     a v reportu se nikdy neobjevi. */
  /* Dokument se uz NEMAZE: v hist jsou sazby, kterymi uz byly vyplaceny
     minule mesice, a bez nich by report za cerven ukazal „chybi sazba".
     Misto smazani se pripoji zaznam s h == 0 = „tady sazba skoncila":
     minulost zustava ocenena, budoucnost uz sazbu nema. */
  const staraS = S.sazby[docId] || null;
  if (typKey === 'sub' || typKey === 'inv' || typKey === 'kanc') {
    if (staraS && (staraS.h || sazbaHist(staraS).length)) {
      const konec = sazbySloz(staraS, isoToday(), 0, 0);
      if (konec) await db.collection('sazby').doc(docId).set(konec).catch(() => {});
    }
  } else if (shEl) {
    if (shVal) {
      const nova = sazbySloz(staraS, sodVal, shVal, scVal || 0);
      if (nova) await db.collection('sazby').doc(docId).set(nova);
    } else if (staraS && (staraS.h || sazbaHist(staraS).length)) {
      const konec = sazbySloz(staraS, isoToday(), 0, 0);
      if (konec) await db.collection('sazby').doc(docId).set(konec).catch(() => {});
    }
  }
  // Ma uz clovek prihlaseni? Pak srovnat roli i jmeno i tam, jinak by mu
  // pri zmene typu zustala stara prava a na prihlasovaci obrazovce spatna sekce.
  let roleChanged = false;
  if (edit && edit.uid) {
    const newRole = roleOfTypeKey(typKey);
    const oldRole = roleOfTypeKey(typeKeyOfUser(edit));
    roleChanged = newRole !== oldRole;
    try {
      /* Vedeni (admin) ve verejnem rosteru byt nesmi (B6). Kdyz nekdo
         na vedeni prejde, jeho zaznam z rosteru zmizi; kdyz z vedeni
         naopak sestoupi do party, zaznam se zalozi vcetne prihlasovaci
         adresy, aby se na mobilu mel pres co prihlasit. */
      if (newRole === 'admin') {
        await db.collection('roster').doc(docId).delete().catch(() => {});
      } else {
        const zapis = { jmeno: j, prijmeni: p, role: newRole };
        if (edit.authEmail) zapis.authEmail = edit.authEmail;
        await db.collection('roster').doc(docId).set(zapis, { merge: true });
      }
      await db.collection('users_auth').doc(edit.uid).set({ role: newRole, name: j + ' ' + p }, { merge: true });
    } catch (e) { toast('⚠ Kartu jsem uložil, ale práva se nepodařilo srovnat: ' + e.message); }
  }
  // Prejmenovani: jmeno je v ukolech, zaznamech a dochazce ulozene jako text.
  // Bez tohohle by clovek po oprave preklepu prisel o svoje ukoly a v deniku
  // by u starych zapisu zustalo stare jmeno.
  const stareJmeno = edit ? fullName(edit).trim() : '';
  const noveJmeno = (j + ' ' + p).trim();
  let opraveno = 0;
  if (edit && stareJmeno && stareJmeno !== noveJmeno) {
    /* Jmenovec: kdyz totez jmeno nosi jeste nekdo dalsi, nesmi se
       prejmenovavat podle TEXTU — prepsali bychom i cizi zapisy.
       U takoveho cloveka jdeme jen podle jeho prihlasovaciho uctu. */
    const jmenovec = S.users.some(x => x.id !== docId && fullName(x).trim() === stareJmeno);
    toast('Přepisuji jméno i ve starších záznamech…');
    try {
      for (const t of S.tasks.filter(x => x.respId === docId || (!jmenovec && x.resp === stareJmeno))) {
        const res = (t.res || []).map(x => x === stareJmeno ? noveJmeno : x);
        await db.collection('tasks').doc(t.id).update({ respId: docId, resp: noveJmeno, res });
        opraveno++;
      }
      /* Zapisy, dochazka a hlaseni se hledaji v DATABAZI, ne v pameti: naživo
         je jen poslednich 30 dni, takze ve starsim deniku by preklep zustal —
         a delUser, ktery se pta databaze uz na NOVE jmeno, by ty starsi zapisy
         nenasel a nabidl by cloveka smazat, i kdyz po nem zaznamy zustavaji.
         Cena: jednorazove radove stovky cteni pri oprave jmena. */
      const zapisy = new Map();
      if (edit.uid) (await db.collection('entries').where('authorUid', '==', edit.uid).get())
        .docs.forEach(d => zapisy.set(d.id, d));
      if (!jmenovec) (await db.collection('entries').where('author', '==', stareJmeno).get())
        .docs.forEach(d => zapisy.set(d.id, d));
      opraveno += await prepisPole([...zapisy.values()].filter(d => d.data().author !== noveJmeno), { author: noveJmeno });
      const dch = await db.collection('attendance').where('userDocId', '==', docId).get();
      opraveno += await prepisPole(dch.docs.filter(d => d.data().userName !== noveJmeno), { userName: noveJmeno });
      const hls = await db.collection('hlaseni').where('userDocId', '==', docId).get();
      opraveno += await prepisPole(hls.docs.filter(d => d.data().userName !== noveJmeno), { userName: noveJmeno });
      if (jmenovec && !edit.uid) toast('⚠ Stejné jméno má i někdo další a tenhle člověk nemá přihlášení — starší zápisy jsem raději nepřepisoval, aby se nepřepsaly cizí.');
    } catch (e) { toast('⚠ Jméno jsem změnil, ale ne všude se to propsalo: ' + (e.code || e.message)); }
    // jmeno srovnat i v rosteru — ale jen u party a subu, vedeni v rosteru byt nema (B6)
    /* update, ne set(merge): kdo v rosteru zaznam nema (nema prihlaseni),
       tomu ho prejmenovani nesmi zalozit — na prihlasovaci obrazovce by se
       ukazalo jeho jmeno a po zadani PINu by narazil na „ucet nema adresu". */
    if (roleOfTypeKey(typKey) !== 'admin')
      await db.collection('roster').doc(docId).update({ jmeno: j, prijmeni: p }).catch(() => {});
  }
  /* Policka formulare musi z pameti pryc. Jinak je vratitFormulare() nalije
     do karty DALSIHO cloveka a v sazbe by svitilo cizi cislo. */
  zapomen(...POLE_UZIVATELE);
  goPage('uzivatele');
  toast(edit
    ? (roleChanged ? 'Uživatel upraven ✓ Práva srovnána — musí se znovu přihlásit.'
      : opraveno ? 'Uživatel upraven ✓ Jméno přepsáno i u ' + opraveno + ' navázaných záznamů.'
      : 'Uživatel upraven ✓')
    : 'Uživatel přidán ✓ Přihlášení mu vytvoř tlačítkem 🔑');
}

/* ============ PRACOVNÍK / SUB (mobil) ============ */

/* Polohu si rekneme jednou pri otevreni obrazovky — na pichnuti ji stejne
   potrebujeme. Kdyz ji nedostaneme, nic se nerozbije, jen se neradi podle
   vzdalenosti. */
/* Stav smeny = posledni MUJ zaznam dochazky. Zadne dva prichody po sobe:
   kdyz jsem v praci, jde jen odejit, a naopak. */
/* Stare zaznamy pole "schvaleno" nemaji — ty plati. Ceka se jen na to,
   co je vylozene schvaleno === false (doplnil pracovnik zpetne). */
function jeSchvaleno(a) { return !a || a.schvaleno !== false; }
/* Zapomenuty odchod NEJDE zapsat rovnou do dochazky — pracovnik posle ZADOST
   (kolekce zadosti) a teprve vedeni ji promeni v zaznam dochazky. Do hodin se
   tak nikdy nedostane nic, co vedeni nevidelo. */
function cekajiciZadosti() { return S.zadosti.filter(z => z.stav === 'ceka'); }
function mojeZadostOdchod() { return S.zadosti.find(z => z.typ === 'odchod' && z.stav === 'ceka') || null; }
function mojeZamitnuteZadosti() { return S.zadosti.filter(z => z.stav === 'zamitnuto' && !z.videno); }

/* POZOR: pauza ma vlastni zaznamy v dochazce, ale o stavu smeny nerozhoduje.
   Bez tohohle filtru by clovek zapnutim pauzy "prestal byt v praci". */
function mojeSmena() {
  const mine = S.attendance.filter(a => (!S.me || a.userDocId === S.me.id)
    && (a.akce === 'Příchod' || a.akce === 'Odchod'));
  const posledni = mine.length ? mine[0] : null;          // S.attendance je razena sestupne
  const vPraci = !!(posledni && posledni.akce === 'Příchod');
  return { posledni, vPraci, pid: vPraci ? posledni.pid : null, zeVcerejska: vPraci && posledni.date !== isoToday() };
}
function zacatekSmeny(a) {
  const t = String((a && a.time) || '0:0').split(':').map(Number);
  const d = new Date(((a && a.date) || isoToday()) + 'T00:00:00');
  d.setHours(t[0] || 0, t[1] || 0, 0, 0);
  return d;
}
function trvaniOd(a) {
  const min = Math.max(0, Math.round((Date.now() - zacatekSmeny(a).getTime()) / 60000));
  return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
}
/* Cas se prepisuje primo v DOM, ne pres render() — jinak by se pracovnikovi
   pri psani mazal rozepsany zapis do deniku. */
/* POZOR: na iPhonu se aplikace po zamknuti nebo prepnuti zmrazi a odpocty
   v ni prestanou bezet. Upozorneni na dlouhou pauzu se proto NEDA postavit
   na tikajicim casovaci — clovek by musel hodinu koukat do displeje.
   Misto toho se delka pauzy pokazde DOPOCITA z casu jejiho zacatku, a to
   i ve chvili, kdy se uzivatel k aplikaci vrati. */
function zkontrolovatPauzu() {
  const bezici = (typeof mojePauza === 'function' && S.me) ? mojePauza() : null;
  if (!bezici) { S.pauzaPripomenuto = false; S.pauzaMinut = 0; return; }
  const minut = Math.floor((Date.now() - zacatekSmeny(bezici).getTime()) / 60000);
  S.pauzaMinut = minut;
  const ep = document.getElementById('w-pauza');
  if (ep) ep.textContent = trvaniOd(bezici);
  const box = document.getElementById('w-pauzabox');
  if (box) box.classList.toggle('dlouha', minut >= 60);
  if (minut >= 60 && !S.pauzaPripomenuto) {
    S.pauzaPripomenuto = true;
    toast('🥪 Pauza běží už ' + trvaniOd(bezici) + ' — nezapomněl jsi ji vypnout?');
  }
}
/* Navrat k aplikaci je jediny okamzik, kdy se na iPhonu da spolehnout,
   ze kod zase bezi — tak se pauza kontroluje prave tam. */
document.addEventListener('visibilitychange', () => { if (!document.hidden) zkontrolovatPauzu(); });
window.addEventListener('focus', zkontrolovatPauzu);

setInterval(() => {
  zkontrolovatPauzu();
  const el = document.getElementById('w-cas');
  if (!el) return;
  const sm = mojeSmena();
  if (sm.vPraci && sm.posledni) el.textContent = trvaniOd(sm.posledni);
}, 30000);

/* Pauza na obed. Drzi se v telefonu do konce dne — kdyz appku zavre a zase
   otevre, zustane zaply. Do dochazky se zapise az u odchodu. */
/* Pauza je skutecny casovac: zacatek i konec se zapisuji do dochazky jako
   samostatne zaznamy. Prezije to zavreny telefon, vedeni pauzu vidi a muze ji
   opravit, a hodiny se pocitaji ze stejneho zdroje jako pichnuti.
   Driv to byl prepinac na pevnych 30 minut ulozeny jen v pameti telefonu. */
function mojePauza() {
  const mine = S.attendance.filter(a => (!S.me || a.userDocId === S.me.id)
    && (a.akce === 'Pauza' || a.akce === 'Konec pauzy'));
  const posl = mine.length ? mine[0] : null;
  return (posl && posl.akce === 'Pauza') ? posl : null;   // vraci bezici pauzu
}
function zapisPauzu(akce, pid) {
  return db.collection('attendance').add({
    userDocId: S.me ? S.me.id : '', userName: fullName(S.me || {}), authUid: S.authUser.uid,
    akce, pid, date: isoToday(), time: nowTime(), gps: null, selfie: null,
    manual: false, createdAt: FV()
  });
}
async function zacitPauzu() {
  const sm = mojeSmena();
  if (!sm.vPraci) { toast('Pauzu jde zapnout jen během směny'); return; }
  /* Prepinac je hned nad tlacitkem ODCHOD, takze se da tuknout omylem.
     Proto potvrzeni — spatne zapnuta pauza ubira hodiny z vyplaty. */
  if (!await potvrd('Začít pauzu?\n\nČas pauzy se odečte od dnešních hodin.')) return;
  try { await zapisPauzu('Pauza', sm.pid); S.pauzaPripomenuto = false; toast('Pauza běží ⏸'); }
  catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
async function ukoncitPauzu(tiche) {
  const b = mojePauza(); if (!b) return false;
  try { await zapisPauzu('Konec pauzy', b.pid); if (!tiche) toast('Pauza ukončena ✓'); return true; }
  catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); return false; }
}

function ensureMyPos() {
  if (S.posAsked || !navigator.geolocation) return;
  S.posAsked = true;
  navigator.geolocation.getCurrentPosition(
    pos => { S.myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; render(); },
    () => { S.myPos = null; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 });
}
function fmtDist(m) {
  if (m == null) return '';
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km';
}
/* Kde jsem naposledy pichnul — to je nejlepsi odhad, kde jsem i dnes.
   Bere se z docasnosti, ne z pameti telefonu, aby to preslo i na novy mobil. */
function lastUsedProjectId() {
  const mine = S.attendance.filter(a => !S.me || a.userDocId === S.me.id);
  return mine.length ? mine[0].pid : null;
}
/* Poradi seznamu:
   - kdyz zname polohu -> rozhoduje vzdalenost (stojim na stavbe = jsem tady).
     Pouhe "naposledy" by clovekovi nabidlo stavbu 4 km daleko, i kdyz stoji
     8 m od jine. Posledni pouzita zustava oznacena, jen neni automaticky prvni.
   - kdyz polohu nemame (nepovoleno, suteren, stary telefon) -> naposledy pouzita
     nahore, zbytek abecedne.
   - stavby bez GPS nejdou seradit, jdou na konec s poznamkou. */
/* Parte se ukazuji jen stavby s active=true. Prepina se to prepinacem
   ve sloupci "Vidi parta" v tabulce Projekty — zamerne to NEplyne ze stavu
   projektu, aby na tutez vec nebyly dve cesty, ktere se prebijeji. */
function workerProjectList() {
  const last = lastUsedProjectId();
  const items = S.projects.filter(x => x.active).map(x => ({
    p: x,
    dist: (S.myPos && x.gps) ? haversine(S.myPos.lat, S.myPos.lng, x.gps.lat, x.gps.lng) : null,
    last: x.id === last
  }));
  const podleVzdalenosti = items.some(i => i.dist != null);
  return items.sort((a, b) => {
    if (a.dist != null && b.dist != null) return a.dist - b.dist;
    if (a.dist != null) return -1;
    if (b.dist != null) return 1;
    if (!podleVzdalenosti && a.last !== b.last) return a.last ? -1 : 1;
    if (!!a.p.gps !== !!b.p.gps) return a.p.gps ? -1 : 1;  // bez GPS vzdy na konec
    return String(a.p.name).localeCompare(String(b.p.name), 'cs');
  });
}

/* ============ PODKLADY STAVBY (zive z Drive) ============
   Slozka 09_Denik_staveb/Podklady vcetne podslozek (SIKO, dvere...).
   Vedeni je sklada primo na Drive, aplikace je jen ukazuje a soubory
   vydava most — funguje i bez uctu Google. Zadal Marco 28. 8. 2026. */
async function nactiPodklady(p, folderId) {
  const klic = S.tajne && S.tajne.mostKlic;
  if (!klic || !CFG.scriptUrl) { S.podkladyStav = { chyba: 'Most není nastavený' }; render(); return; }
  S.podkladyStav = { nacita: true }; render();
  try {
    /* Kdyz zakazka zna svou slozku na Drive, jdeme primo pres ni —
       hledani podle CN by trefilo nahradni slozku "..._SYSTEM", kterou si
       most zalozil driv, nez se ID doplnilo. */
    /* Nejjistejsi je primy odkaz na slozku Podklady (podkladyFolderId
       u zakazky) — hledani podle CN by trefilo nahradni slozku _SYSTEM.
       projektId umi az novejsi verze mostu, proto az jako druha volba. */
    const primo = folderId || (p && p.podkladyFolderId) || '';
    const j = await driveCall(primo
      ? { action: 'listPodklady', folderId: primo, klic }
      : { action: 'listPodklady', projektId: (p && p.driveFolderId) || '', cn: (p && p.cn) || '', client: (p && p.client) || '', rootId: CFG.driveRootFolderId, klic });
    S.podkladyStav = j.ok ? { id: j.id, folders: j.folders || [], files: j.files || [] } : { chyba: j.error || 'Nepovedlo se' };
    /* Kdyz most slozku nasel, zapamatujeme si ji u zakazky — priste uz se
       nehleda a nezalezi na verzi mostu. Automaticke napojeni.
       POZOR: uklada se JEN kdyz slozka neco obsahuje — prazdny vysledek
       muze znamenat, ze most trefil nahradni slozku _SYSTEM, a to bychom
       si zapamatovali natrvalo. */
    const nasloObsah = j.ok && ((j.folders || []).length || (j.files || []).length);
    if (nasloObsah && j.id && p && p.id && !p.podkladyFolderId && !folderId) {
      db.collection('projects').doc(p.id).update({ podkladyFolderId: j.id }).catch(() => {});
    }
  } catch (e) { S.podkladyStav = { chyba: e.message || 'Nepovedlo se' }; }
  render();
}
function doPodslozky(id, nazev) {
  S.podkladyCesta.push({ id, nazev });
  nactiPodklady(null, id);
}
function zpetVPodkladech() {
  S.podkladyCesta.pop();
  const posl = S.podkladyCesta[S.podkladyCesta.length - 1];
  if (posl) nactiPodklady(null, posl.id);
  else { S.podkladyStav = null; render(); }
}
function kartaPodklady(p) {
  if (!p) return '';
  const st = S.podkladyStav;
  const cesta = S.podkladyCesta;
  const docs = p.stavbaDocs || [];
  return `<div class="card">
    <h3>📐 Podklady stavby <span class="muted" style="font-weight:400">— z Drive</span></h3>
    ${docs.length ? docs.map(d => `<div class="urow" style="cursor:pointer" onclick="openDriveDoc('${d.driveId}','${esc(d.name)}')"><span>${(d.mime || '').includes('pdf') ? '📄' : '🖼'}</span><b>${esc(d.name)}</b><span class="muted" style="margin-left:auto">otevřít</span></div>`).join('') : ''}
    ${!st ? `<div class="aprv"><button class="btn dark sm" onclick="S.podkladyCesta=[];nactiPodklady(proj('${p.id}'))">📂 Zobrazit podklady</button></div>`
      : st.nacita ? '<div class="loading"><span class="spin"></span>Načítám z Drive…</div>'
      : st.chyba ? `<div class="note">${esc(st.chyba)}</div><div class="aprv"><button class="btn ghost sm" onclick="S.podkladyStav=null;render()">Zpět</button>${S.meAuth && S.meAuth.role === 'admin' ? `<button class="btn dark sm" onclick="napojPodklady('${p.id}')">🔗 Napojit složku odkazem</button>` : ''}</div>`
      : `${cesta.length ? `<div class="urow" style="cursor:pointer" onclick="zpetVPodkladech()"><span>⬅</span><b>${esc(cesta.map(c => c.nazev).join(' / '))}</b></div>` : (S.meAuth && S.meAuth.role === 'admin' ? `<div class="aprv" style="justify-content:flex-end"><span class="lnk" style="font-size:12px" onclick="napojPodklady('${p.id}')">🔗 napojit jinou složku</span></div>` : '')}
        ${st.folders.map(f => `<div class="urow" style="cursor:pointer" onclick="doPodslozky('${f.id}','${esc(f.name)}')"><span>📁</span><b>${esc(f.name)}</b><span class="muted" style="margin-left:auto">otevřít</span></div>`).join('')}
        ${st.files.map(f => `<div class="urow" style="cursor:pointer" onclick="openDriveDoc('${f.id}','${esc(f.name)}')"><span>${(f.mime || '').includes('pdf') ? '📄' : (f.mime || '').indexOf('image/') === 0 ? '🖼' : '📎'}</span><b>${esc(f.name)}</b><span class="muted" style="margin-left:auto">${f.size ? Math.round(f.size / 1024) + ' kB' : ''}</span></div>`).join('')}
        ${(!st.folders.length && !st.files.length) ? `<div class="empty">Tady zatím nic není.</div>${S.meAuth && S.meAuth.role === 'admin' && !p.podkladyFolderId ? `<div class="aprv"><button class="btn dark sm" onclick="napojPodklady('${p.id}')">🔗 Napojit složku odkazem</button></div><div class="note">Když vidíš prázdno, i když na Drive něco máš, most trefil jinou složku — napoj ji odkazem, je to jednou a napořád.</div>` : ''}` : ''}`}
  </div>`;
}

/* ============ POZNAMKY KE STAVBE ============
   Veci, ktere u stavby ZUSTAVAJI (kody, kontakty, "voda se zavira v
   suterenu"). Nadpis + text, ktery jde upravovat, a komentare pod tim.
   Zadal Marco 28. 8. 2026. */
/* Starsi data poznamek prevadi vedeni pri prihlaseni:
   1) poznamky s jednim polem viditelnost dostanou seznam vidi,
   2) uplne stare poznamky z dob Stavaria (pole notes primo u zakazky,
      bez nadpisu a bez prav) se prestehuji do kolekce poznamky
      jako "jen vedeni" a u zakazky se smazou. */
async function prevedStarePoznamky() {
  const FVD = firebase.firestore.FieldValue;
  const snap = await db.collection('poznamky').get().catch(() => null);
  if (snap) for (const d of snap.docs.filter(x => !Array.isArray(x.data().vidi))) {
    await d.ref.update({ vidi: [d.data().viditelnost || 'vsichni'], viditelnost: FVD.delete() }).catch(() => {});
  }
  const ps = await db.collection('projects').get().catch(() => null);
  if (ps) for (const d of ps.docs.filter(x => (x.data().notes || []).length)) {
    for (const n of d.data().notes) {
      await db.collection('poznamky').add({ pid: d.id,
        nadpis: (n.text || '').split('\n')[0].slice(0, 48) || 'Poznámka',
        text: (n.text || '') + '\n— ' + (n.author || '?') + ', ' + fmtISO(n.date),
        komentare: [], vidi: ['vedeni'], vidiJmena: [],
        autorId: '', autor: n.author || '', createdAt: FV() }).catch(() => {});
    }
    await d.ref.update({ notes: FVD.delete() }).catch(() => {});
  }
}
/* Jednorazovy uklid rosteru (B6) — bezi pri prihlaseni vedeni, stejne
   jako prevod starych poznamek. Kolekce /roster je verejne citelna (bez
   ni by se parta na prihlasovaci obrazovce nenasla) a driv se do ni
   zapisovalo i vedeni — vcetne prihlasovaciho e-mailu a priznaku role
   'admin'. Kdokoli z internetu si tak stahl e-mail admina i s tim, na
   ktery ucet utocit. Nove uz se admin do rosteru nezapisuje; tohle
   dorovnava uz zalozene ucty.
   MAZE VYHRADNE zaznamy s role == 'admin'. Parta (worker) ani
   subdodavatele (sub) se nedotknou — ti se pres roster prihlasuji. */
async function uklidRosterAdminy() {
  const snap = await db.collection('roster').get().catch(() => null);
  if (!snap) return;
  const adminy = snap.docs.filter(d => (d.data() || {}).role === 'admin');
  if (!adminy.length) return;
  let smazano = 0;
  for (const d of adminy) await d.ref.delete().then(() => { smazano++; }).catch(() => {});
  // S.roster se pouziva jen na prihlasovaci obrazovce a ta si ho po
  // odhlaseni nacita znovu (loadRoster) — prekreslovat tady netreba.
  if (smazano) console.log('roster: odstraněno ' + smazano + ' záznamů vedení (veřejný seznam už nenese e-mail admina)');
}

/* Jednorazovy prevod citlivych poli (S2/S4/S5, audit 28. 8.) — bezi pri
   prihlaseni vedeni, po vzoru prevodu starych poznamek. Firestore vraci
   vzdy cely dokument, takze portalToken (/projects), kontakty (/users)
   a interni poznamky (/entries) cetl i externi subdodavatel. Presouva se
   do admin-only kolekci /portaly, /kontakty a /entries_interni.
   Bezpecnost prevodu:
   - stare pole se maze AZ po uspesnem zapisu na nove misto (pri chybe
     site se nic neztrati, pristi prihlaseni to dokonci),
   - novy dokument se zaklada jen kdyz jeste neexistuje — soubeh dvou
     adminu ani opakovany beh nic neprepise (idempotence),
   - po ciste dokoncenem prubehu se do config/app zapise priznak,
     aby se pri kazdem prihlaseni necetly cele kolekce znovu. */
/* Jednorazovy uklid typu subdodavatelu (29. 8.).
   Driv appka subovi tise pridavala priznak 'teren', aby prosel filtrem
   "komu jde zadat ukol nebo predat klic". Dusledek: sub se tvaril jako
   pracovnik i tam, kam nepatri — v nabidce rucniho doplneni dochazky
   a v seznamu dochazky, kde pritom zadnou dochazku nema (ma hlaseni).
   Filtry se ted ptaji na suba primo, takze ten priznak muze pryc.
   Zaroven se subovi maze hodinova sazba: hodiny nevykazuje, fakturuje praci. */
async function uklidTypySubu() {
  const snap = await db.collection('users').get().catch(() => null);
  if (!snap) return;
  let typu = 0, sazeb = 0;
  for (const d of snap.docs) {
    const t = d.data().typ || {};
    if (!t.sub || !t.teren) continue;                 // resi jen suby s prebytecnym 'teren'
    await d.ref.update({ typ: { ...t, teren: 0 } }).then(() => { typu++; }).catch(() => {});
    const sz = await db.collection('sazby').doc(d.id).get().catch(() => null);
    if (sz && sz.exists) await sz.ref.delete().then(() => { sazeb++; }).catch(() => {});
  }
  if (typu) console.log('typy subu srovnany: ' + typu + ' (zrusenych sazeb: ' + sazeb + ')');
}

async function prevedTajnosti() {
  const FVD = firebase.firestore.FieldValue;
  try {
    const cfg = await db.collection('config').doc('app').get();
    if (cfg.exists && cfg.data().tajnostiPrevedeny) return;
  } catch (e) { return; } // bez spojeni se prevod nezkousi
  let cisto = true;
  /* zapis na nove misto (jen neni-li), pak smaz stara pole; pri chybe nic nemazat */
  const presun = async (novyRef, data, staryRef, smazPole) => {
    try {
      const ex = await novyRef.get();
      if (!ex.exists) await novyRef.set(data);
      await staryRef.update(smazPole);
    } catch (e) { cisto = false; }
  };
  const uklid = async (staryRef, smazPole) => {
    try { await staryRef.update(smazPole); } catch (e) { cisto = false; }
  };
  // S2: portalToken z /projects -> /portaly/{pid}
  const ps = await db.collection('projects').get().catch(() => null);
  if (!ps) cisto = false;
  if (ps) for (const d of ps.docs.filter(x => x.data().portalToken !== undefined)) {
    const tok = d.data().portalToken;
    if (tok) await presun(db.collection('portaly').doc(d.id), { token: tok }, d.ref, { portalToken: FVD.delete() });
    else await uklid(d.ref, { portalToken: FVD.delete() });
  }
  // S4: email a telefon z /users -> /kontakty/{userDocId}
  const us = await db.collection('users').get().catch(() => null);
  if (!us) cisto = false;
  if (us) for (const d of us.docs.filter(x => x.data().email !== undefined || x.data().tel !== undefined)) {
    const v = d.data();
    const smaz = { email: FVD.delete(), tel: FVD.delete() };
    if ((v.email || '').trim() || (v.tel || '').trim())
      await presun(db.collection('kontakty').doc(d.id), { email: v.email || '', tel: v.tel || '' }, d.ref, smaz);
    else await uklid(d.ref, smaz);
  }
  // S5: interni poznamka z /entries -> /entries_interni/{entryId}
  const es = await db.collection('entries').get().catch(() => null);
  if (!es) cisto = false;
  if (es) for (const d of es.docs.filter(x => x.data().internal !== undefined)) {
    const t = (d.data().internal || '').trim();
    if (t) await presun(db.collection('entries_interni').doc(d.id), { text: t }, d.ref, { internal: FVD.delete() });
    else await uklid(d.ref, { internal: FVD.delete() });
  }
  if (cisto) await db.collection('config').doc('app').set({ tajnostiPrevedeny: true }, { merge: true }).catch(() => {});
}

/* S4b — kontakty klienta ze stavby do admin-only /kontakty.
   Vlastni priznak, protoze prevedTajnosti uz ma svuj nastaveny a znovu
   by se nespustil. Stejny postup: nejdriv zapsat na nove misto, teprve pak
   smazat stare pole; kdyz cokoli selze, priznak se nenastavi a priste se to
   dozene. Pozor: stara data uz nekomu v telefonu byt mohou — timhle se
   zavrou dvere do budoucna, minulost to nevrati. */
async function prevedKontaktyInvestoru() {
  const FVD = firebase.firestore.FieldValue;
  try {
    const cfg = await db.collection('config').doc('app').get();
    if (cfg.exists && cfg.data().kontaktyKlientuPrevedeny) return;
  } catch (e) { return; }              // bez spojeni se prevod nezkousi
  let cisto = true;
  const ps = await db.collection('projects').get().catch(() => null);
  if (!ps) return;
  for (const d of ps.docs) {
    const v = d.data();
    if (v.investorEmail === undefined && v.investorPhone === undefined) continue;
    const smaz = { investorEmail: FVD.delete(), investorPhone: FVD.delete() };
    const mail = (v.investorEmail || '').trim(), tel = (v.investorPhone || '').trim();
    try {
      if (mail || tel) {
        const ref = db.collection('kontakty').doc(kontaktKlicStavby(d.id));
        const ex = await ref.get();
        if (!ex.exists) await ref.set({ email: mail, tel });
      }
      await d.ref.update(smaz);
    } catch (e) { cisto = false; }
  }
  if (cisto) await db.collection('config').doc('app').set({ kontaktyKlientuPrevedeny: true }, { merge: true }).catch(() => {});
}

/* Jednorazovy prevod sazeb na historii (#34). Kdo ma sazbu a nema historii,
   dostane prvni zaznam s datem „odjakziva" — sazba v /sazby je jedina, jakou
   aplikace kdy znala, a vsechny uz vytistene reporty jsou spocitane s ni.
   Dnesni datum by tuhle pravdu prepsalo: v karte uzivatele by pak stalo
   „300 Kc/h od 29. 8. 2026" u sazby, ktera platila od ledna. */
async function prevedSazbyNaHistorii() {
  try {
    const cfg = await db.collection('config').doc('app').get();
    if (cfg.exists && cfg.data().sazbyHistoriePrevedeny) return;
  } catch (e) { return; }                   /* bez spojeni se prevod nezkousi */
  const snap = await db.collection('sazby').get().catch(() => null);
  if (!snap) return;
  let cisto = true, zalozeno = 0;
  for (const d of snap.docs) {
    const v = d.data() || {};
    if (Array.isArray(v.hist) && v.hist.length) continue;   /* uz ma historii */
    if (!v.h) continue;                                     /* nema co prevadet */
    const z = { od: SAZBA_ODJAKZIVA, h: v.h, kdo: 'převod dat', kdy: isoToday() };
    if (v.c) z.c = v.c;
    /* merge: h a c se nesahaji, pridava se jen pole hist */
    try { await d.ref.set({ hist: [z] }, { merge: true }); zalozeno++; }
    catch (e) { cisto = false; }
  }
  if (zalozeno) console.log('historie sazeb zalozena: ' + zalozeno);
  if (cisto) await db.collection('config').doc('app').set({ sazbyHistoriePrevedeny: true }, { merge: true }).catch(() => {});
}

/* Jeden posluchac na kazdy klic viditelnosti; vysledky se skladaji. */
function listenPoznamky(klice) {
  const casti = {};
  const slozit = () => {
    const mapa = new Map();
    Object.values(casti).flat().forEach(z => mapa.set(z.id, z));
    S.poznamky = [...mapa.values()].sort((a, b) => (a.nadpis || '').localeCompare(b.nadpis || '', 'cs'));
    render();
  };
  klice.forEach(k => {
    S.unsub.push(db.collection('poznamky').where('vidi', 'array-contains', k).onSnapshot(snap => {
      casti[k] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      slozit();
    }, err => console.warn('poznamky/' + k, err)));
  });
}

/* Seznam lidi pro vyber "kdo poznamku uvidi" (bez vedeni — to vidi vse). */
async function nactiPzLide() {
  if (S.pzLide) return S.pzLide;
  const snap = await db.collection('users').get().catch(() => null);
  S.pzLide = !snap ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }))
    // jen parta a subdodavatele — vedeni vidi vse a investor sem nepatri
    .filter(u => ['teren', 'sub'].includes(typeKeyOfUser(u)))
    .map(u => ({ id: u.id, jmeno: fullName(u) }))
    .sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs'));
  return S.pzLide;
}

/* Lidsky popis, komu se poznamka ukazuje. */
/* Autor je ve vidi vzdy (pzSAutorem) — do popisku se ale nepocita.
   Popisek ma rikat, komu se poznamka ukazuje NAVIC krome autora. */
function vidiBezAutora(z) {
  const v = z.vidi || (z.viditelnost ? [z.viditelnost] : ['vsichni']);
  return v.filter(x => x !== z.autorId);
}
function vidiPopis(z) {
  const v = vidiBezAutora(z);
  if (!v.length || (v.length === 1 && v[0] === 'vedeni')) return '🗂 Jen vedení';
  if (v.includes('vsichni')) return '👥 Všichni na stavbě';
  const kusy = [];
  if (v.includes('parta')) kusy.push('👷 Naši lidé');
  const lide = v.filter(x => !['vsichni', 'parta', 'vedeni'].includes(x));
  if (lide.length) kusy.push('👤 ' + (esc((z.vidiJmena || []).join(', ')) || lide.length + ' lidí'));
  return kusy.join(' + ') || '🗂 Jen vedení';
}
function vidiBarva(z) {
  const v = vidiBezAutora(z);
  if (!v.length || (v.length === 1 && v[0] === 'vedeni')) return 'b-red';
  return v.includes('vsichni') ? 'b-int' : 'b-wait';
}

/* Autor MUSI byt vzdy mezi temi, kdo poznamku uvidi. Jinak si ji sam nenacte —
   pravidla databaze mu ji zpatky nepusti a posluchac ji nedostane: obrazovka
   blikne, nic se nestane a v databazi zustane prazdna poznamka. Tykalo se to
   tri pripadu: nic nezaskrtnuto (jen vedeni), zaskrtnut jen nekdo jiny, a suba,
   ktery zaskrtne "Nasi lide" (na klic parta jeho posluchac neposloucha). */
function pzSAutorem(v, autorId) {
  /* autorId === undefined = nova poznamka, autor jsem ja.
     autorId '' = poznamka BEZ autora (prevedena ze stareho projects.notes) —
     tam se id vedouciho, ktery ji zrovna upravuje, dosadit NESMI: stitek by
     se z „Jen vedeni" prehodil na „1 lidi" a seznam vidi by bobtnal
     o id kazdeho, kdo na ni sahne. */
  const ja = autorId === undefined
    ? ((S.meAuth && S.meAuth.userDocId) || (S.me && S.me.id) || '')
    : autorId;
  return (ja && !v.includes(ja)) ? [...v, ja] : v;
}
/* Zaskrtavaci vyber viditelnosti — skupiny i konkretni lide, klidne vic naraz. */
function pzVidiHtml(z) {
  const v = (z && (z.vidi || (z.viditelnost ? [z.viditelnost] : []))) || [];
  /* Kazde policko potrebuje vlastni id — bez nej ho pamet formulare (FORMMEM)
     nepozna a pri prekresleni (a to nastava pri KAZDE zmene v databazi, staci
     ciziho pichnuti prichodu) vrati zaskrtnuti na ulozeny stav. Kdo mezitim
     zaskrtal tri lidi, ulozil by starou viditelnost a nedozvedel se to.
     data-kl drzi sber u sveho formulare — muze byt otevrena uprava jedne
     poznamky a zaroven modal nove. */
  const kl = z ? z.id : 'nova';
  const autor = (z && z.autorId) || (S.meAuth && S.meAuth.userDocId) || (S.me && S.me.id) || '';
  const chk = (val, popis) => `<label style="display:flex;gap:9px;align-items:center;font-weight:400;margin:0;cursor:pointer">
      <input type="checkbox" class="pz-vd" id="pz-vd-${kl}-${val}" data-kl="${kl}" value="${val}" ${v.includes(val) ? 'checked' : ''} style="width:auto;margin:0"> ${popis}</label>`;
  return `<label>Kdo ji uvidí <span class="muted" style="font-weight:400">— klidně víc možností naráz</span></label>
    <div style="display:flex;flex-direction:column;gap:7px;border:1px solid var(--line);border-radius:10px;padding:10px 13px;max-height:220px;overflow-y:auto">
      ${chk('vsichni', '👥 Všichni na stavbě')}
      ${chk('parta', '👷 Naši lidé (celá parta)')}
      ${(S.pzLide || []).filter(u => u.id !== autor).map(u => chk(u.id, '👤 ' + esc(u.jmeno))).join('')}
    </div>
    <div class="note">Nic nezaškrtneš → poznámku vidí jen vedení. Vedení vidí všechny poznámky vždy. Autor svoji poznámku vidí vždycky.</div>`;
}
function pzVidiSebrat(kl, autorId) {
  const v = [...document.querySelectorAll('.pz-vd[data-kl="' + (kl || 'nova') + '"]:checked')].map(x => x.value);
  return { vidi: pzSAutorem(v.length ? v : ['vedeni'], autorId),
           vidiJmena: (S.pzLide || []).filter(u => v.includes(u.id)).map(u => u.jmeno) };
}
function kartaPoznamky(p) {
  if (!p) return '';
  const mp = S.poznamky.filter(z => z.pid === p.id);
  return `<div class="card">
    <h3>📝 Poznámky ke stavbě <span class="muted" style="font-weight:400">— ${esc(p.name || '')}</span></h3>
    ${mp.map(z => S.poznamkaEdit === z.id ? `
      <div class="ukform" style="margin-bottom:8px">
        <label>Nadpis</label><input type="text" id="pz-n-${z.id}" value="${esc(z.nadpis || '')}">
        ${pzVidiHtml(z)}
        <label>Text</label><textarea id="pz-t-${z.id}" style="min-height:70px">${esc(z.text || '')}</textarea>
        <div class="aprv"><button class="btn amber sm" onclick="ulozPoznamku('${z.id}')">Uložit</button>
          <button class="btn ghost sm" onclick="zapomenPz('${z.id}');S.poznamkaEdit=null;render()">Zrušit</button>
          <span class="lnk" style="margin-left:auto" onclick="smazPoznamku('${z.id}')">✕ smazat</span></div>
      </div>` : `
      <div style="border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b style="flex:1;min-width:120px">${esc(z.nadpis || '')}</b>
          <span class="badge ${vidiBarva(z)}">${vidiPopis(z)}</span>
          ${(S.meAuth && (S.meAuth.role === 'admin' || z.autorId === S.meAuth.userDocId)) ? `<span class="lnk" style="font-size:12px" onclick="otevriPoznamku('${z.id}')">upravit</span>` : ''}</div>
        <div class="muted" style="white-space:pre-line;font-size:14px;margin-top:3px">${esc(z.text || '')}</div>
        ${(z.komentare || []).length ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
          ${z.komentare.map(k => `<div style="background:#f4f6f9;border-radius:8px;padding:6px 10px;font-size:13px">
            <b>${esc(k.autor || '')}</b> <span class="muted">${fmtISO(k.date)} ${k.time || ''}</span><br>
            <span style="white-space:pre-line">${esc(k.text || '')}</span></div>`).join('')}</div>` : ''}
        <div style="display:flex;gap:7px;margin-top:8px">
          <input type="text" id="pk-${z.id}" placeholder="Komentář…" style="flex:1;min-width:0"
                 onkeydown="if(event.key==='Enter')komentujPoznamku('${z.id}')">
          <button class="btn dark sm" style="flex:none" onclick="komentujPoznamku('${z.id}')">Přidat</button>
        </div>
      </div>`).join('')}
    <div class="aprv"><button class="btn dark sm" onclick="novaPoznamka('${p.id}')">➕ Nová poznámka</button></div>
  </div>`;
}
async function otevriPoznamku(id) {
  await nactiPzLide();
  S.poznamkaEdit = id; render();
}
async function novaPoznamka(pid) {
  await nactiPzLide();
  const v = await new Promise(hotovo => {
    window._pzHotovo = x => { window._pzHotovo = null; closeModal(); hotovo(x); };
    modal(`<h3>📝 Nová poznámka — ${esc((proj(pid) || {}).name || '')}</h3>
      <label>Nadpis *</label>
      <input type="text" id="pz-nadpis" placeholder="">
      ${pzVidiHtml(null)}
      <div class="aprv">
        <button class="btn amber" onclick="window._pzHotovo({n:document.querySelector('#pz-nadpis').value,v:pzVidiSebrat('nova')})">Vytvořit</button>
        <button class="btn ghost" onclick="window._pzHotovo(null)">Zrušit</button>
      </div>`);
    setTimeout(() => { const el = document.querySelector('#pz-nadpis'); if (el) el.focus(); }, 60);
  });
  if (!v || !v.n || !v.n.trim()) return;
  const r = await db.collection('poznamky').add({ pid, nadpis: v.n.trim(), text: '', komentare: [],
    vidi: v.v.vidi, vidiJmena: v.v.vidiJmena,
    autorId: (S.meAuth && S.meAuth.userDocId) || (S.me && S.me.id) || '',
    autor: fullName(S.me || {}), createdAt: FV() })
    .catch(e => { toast('Nejde přidat: ' + (e.code || e.message)); return null; });
  if (r) { S.poznamkaEdit = r.id; render(); }
}
/* Po ulozeni i po zruseni musi pamet formulare (FORMMEM) pustit — jinak by
   se pri dalsim otevreni vratil stary text i stara zaskrtnuti. */
function pzPolicka(id) {
  return ['pz-n-' + id, 'pz-t-' + id,
    ...[...document.querySelectorAll('.pz-vd[data-kl="' + id + '"]')].map(x => x.id)];
}
function zapomenPz(id) { zapomen(...pzPolicka(id)); }
async function ulozPoznamku(id) {
  const n = ($('#pz-n-' + id).value || '').trim();
  const t = $('#pz-t-' + id).value.trim();
  if (!n) { toast('Nadpis nesmí být prázdný'); return; }
  /* autora bere z ulozeneho zaznamu — vedeni upravuje i cizi poznamky
     a nesmi z nich autora vystrnadit */
  const v = pzVidiSebrat(id, ((S.poznamky.find(z => z.id === id) || {}).autorId) || '');
  /* POZOR: driv tu byl "return" uvnitr .catch — ten ukoncil jen tu vnitrni
     funkci, ne ulozPoznamku. Chybovou hlasku proto hned prekrylo "Uloženo ✓"
     a formular se zavrel, i kdyz se nic neulozilo. */
  try {
    await db.collection('poznamky').doc(id).update({ nadpis: n, text: t,
      vidi: v.vidi, vidiJmena: v.vidiJmena, viditelnost: firebase.firestore.FieldValue.delete() });
  } catch (e) { toast('Nejde uložit: ' + (e.code || e.message)); return; }
  /* Zapomenout se musi az PO prekresleni. zapomen() vrati policka na
     defaultValue — tedy na stav PRED upravou — a schovatFormulare() na
     zacatku render() si je v tu chvili jeste stihne nacist zpatky do pameti
     formulare, protoze formular je porad na obrazovce. Pri pristim otevreni
     poznamky by se pak nadpis, text i zaskrtnuti tise vratily na stare
     hodnoty a clovek by si vlastni zmenu prepsal zpatky. */
  const policka = pzPolicka(id);
  S.poznamkaEdit = null; toast('Uloženo ✓'); render();
  zapomen(...policka);
}
async function smazPoznamku(id) {
  if (!await potvrd('Smazat poznámku i s komentáři?')) return;
  await db.collection('poznamky').doc(id).delete()
    .then(() => { S.poznamkaEdit = null; toast('Smazáno ✓'); })
    .catch(e => toast('Nejde smazat: ' + (e.code || e.message)));
}
async function komentujPoznamku(id) {
  const inp = $('#pk-' + id); const text = inp.value.trim();
  if (!text) return;
  await db.collection('poznamky').doc(id).update({
    komentare: firebase.firestore.FieldValue.arrayUnion({
      autor: fullName(S.me || {}), text, date: isoToday(), time: nowTime() })
  }).then(() => { inp.value = ''; }).catch(e => toast('Nejde: ' + (e.code || e.message)));
}

/* ============ EVIDENCE KLICU ============
   Ke kazde zakazce par klicu (pocet volitelny). Predava je vedeni nebo
   ten, kdo klic prave drzi. Prijemce prevzeti potvrzuje, ale predani
   plati hned — potvrzeni je stvrzenka, ne podminka (Marco 27. 8. 2026).
   Cela historie predani zustava u klice. */
function kartaKlice() {
  const moje = S.klice.filter(k => S.me && k.drzitelId === S.me.id);
  if (!moje.length) return '';
  return `<div class="card">
    <h3>🔑 Klíče u mě (${moje.length})</h3>
    ${moje.map(k => { const pr = proj(k.pid) || {}; return `
    <div class="urow" style="align-items:flex-start"><span style="font-size:17px">🔑</span>
      <div><b>${esc(k.nazev)}</b> · ${esc(pr.name || '')}<br>
        ${k.potvrzeno ? `<span class="muted">převzetí potvrzeno</span>`
          : `<span class="badge b-wait">čeká na tvoje potvrzení</span> <span class="lnk" onclick="potvrditKlic('${k.id}')">✓ Mám ho</span>`}
      </div>
      <button class="btn ghost sm" style="margin-left:auto;flex:none" onclick="predatKlicDialog('${k.id}')">Předat</button>
    </div>`; }).join('')}
    <div class="note">Když klíč někomu dáš, zapiš to hned tlačítkem Předat — ať se ví, kde klíče jsou.</div>
  </div>`;
}

function sekceKliceProjektu(p) {
  const ks = S.klice.filter(k => k.pid === p.id);
  return `<div class="card">
    <h3>🔑 Klíče zakázky (${ks.length})</h3>
    ${ks.map(k => `<div class="urow" style="align-items:flex-start"><span>🔑</span>
      <div><b>${esc(k.nazev)}</b><br>
        <span class="muted">drží: <b>${esc(k.drzitelJmeno || '— kancelář')}</b>${k.drzitelJmeno ? (k.potvrzeno ? ' · potvrzeno' : ' · <span style="color:var(--wait)">nepotvrzeno</span>') : ''}</span></div>
      <span style="margin-left:auto;white-space:nowrap">
        <button class="btn ghost sm" onclick="predatKlicDialog('${k.id}')">Předat</button>
        <span class="lnk" style="font-size:12px;margin-left:8px" onclick="historieKlice('${k.id}')">historie</span>
        <span class="lnk" style="font-size:12px;margin-left:8px" onclick="smazatKlic('${k.id}')">✕</span>
      </span></div>`).join('') || '<div class="muted">Zatím žádné klíče.</div>'}
    <div class="aprv"><button class="btn dark sm" onclick="pridatKlic('${p.id}')">➕ Přidat klíč</button></div>
  </div>`;
}

/* Kdyz most slozku sam nenajde (starsi verze / slozka vznikla driv nez
   se vyplnilo ID zakazky), da se napojit odkazem z Drive — jednou a dost. */
async function napojPodklady(pid) {
  const p = proj(pid); if (!p) return;
  const vstup = await zeptejSe('Napojit složku Podklady', 'Otevři na Drive složku 09_Denik_staveb/Podklady té zakázky a zkopíruj sem odkaz z adresního řádku prohlížeče.', '');
  if (!vstup) return;
  const m = String(vstup).match(/[-\w]{25,}/);
  if (!m) { toast('V odkazu nevidím ID složky'); return; }
  await db.collection('projects').doc(pid).update({ podkladyFolderId: m[0] })
    .then(() => { toast('Složka napojena ✓'); S.podkladyStav = null; S.podkladyCesta = []; render(); })
    .catch(e => toast('Nejde uložit: ' + (e.code || e.message)));
}

async function pridatKlic(pid) {
  const n = S.klice.filter(k => k.pid === pid).length + 1;
  const nazev = await zeptejSe('Přidat klíč', 'Jak se klíč jmenuje.', 'Klíč č. ' + n);
  if (!nazev) return;
  await db.collection('klice').add({ pid, nazev: nazev.trim(), drzitelId: '', drzitelJmeno: '', potvrzeno: true, historie: [], createdAt: FV() })
    .then(() => toast('Klíč přidán ✓')).catch(e => toast('Nejde přidat: ' + (e.code || e.message)));
}
async function smazatKlic(id) {
  const k = S.klice.find(x => x.id === id); if (!k) return;
  if (!await potvrd('Smazat „' + k.nazev + '" včetně historie předání?')) return;
  await db.collection('klice').doc(id).delete().catch(e => toast('Nejde smazat: ' + (e.code || e.message)));
}
function predatKlicDialog(id) {
  const k = S.klice.find(x => x.id === id); if (!k) return;
  modal(`<h3>🔑 Předat ${esc(k.nazev)}</h3>
    <label>Komu</label>
    <select id="pk-komu">
      <option value="">— vyber —</option>
      ${k.drzitelId ? `<option value="__kancelar__">🏢 — vrátit do kanceláře —</option>` : ''}
      ${lideProUkoly().filter(u => u.id !== k.drzitelId).map(u => `<option value="${u.id}">${esc(fullName(u))}</option>`).join('')}
    </select>
    <div class="aprv"><button class="btn amber" onclick="predatKlic('${id}')">Předat</button>
      <button class="btn ghost" onclick="closeModal()">Zrušit</button></div>
    <div class="note">Předání platí hned. ${esc(k.nazev)} se objeví příjemci v aplikaci a ten potvrdí převzetí.
      Když klíč nesete zpátky do kanceláře, vyberte „vrátit do kanceláře" — pak ho nedrží nikdo.</div>`);
}
async function predatKlic(id) {
  const k = S.klice.find(x => x.id === id); if (!k) return;
  const komuId = $('#pk-komu').value; if (!komuId) { toast('Vyber, komu klíč předáváš'); return; }
  /* Vraceni do kancelare: klic pak nedrzi nikdo, takze neni kdo by prevzeti
     potvrzoval — proto potvrzeno rovnou. Do historie se to zapsat MUSI,
     jinak by klic navzdy koncil u posledniho cloveka. Bez teto cesty nesla
     smazat stavba (delProject na drzene klice ceka a radil neco, co v
     aplikaci neexistovalo). */
  if (komuId === '__kancelar__') {
    const zpet = { odId: k.drzitelId || '', odJmeno: k.drzitelJmeno || 'kancelář', komuId: '', komuJmeno: 'kancelář',
                   date: isoToday(), time: nowTime(), potvrzeno: true };
    try {
      await db.collection('klice').doc(id).update({
        drzitelId: '', drzitelJmeno: '', potvrzeno: true,
        historie: firebase.firestore.FieldValue.arrayUnion(zpet)
      });
      closeModal(); toast('Klíč je zpátky v kanceláři ✓');
    } catch (e) { toast('Nejde vrátit: ' + (e.code || e.message)); }
    return;
  }
  const ku = userById(komuId); if (!ku) return;
  const zapis = { odId: k.drzitelId || '', odJmeno: k.drzitelJmeno || 'kancelář', komuId, komuJmeno: fullName(ku),
                  date: isoToday(), time: nowTime(), potvrzeno: false };
  try {
    await db.collection('klice').doc(id).update({
      drzitelId: komuId, drzitelJmeno: fullName(ku), potvrzeno: false,
      historie: firebase.firestore.FieldValue.arrayUnion(zapis)
    });
    closeModal(); toast('Předáno — ' + fullName(ku) + ' potvrdí převzetí ✓');
  } catch (e) { toast('Nejde předat: ' + (e.code || e.message)); }
}
async function potvrditKlic(id) {
  const k = S.klice.find(x => x.id === id); if (!k) return;
  const h = [...(k.historie || [])];
  if (h.length) h[h.length - 1] = { ...h[h.length - 1], potvrzeno: true, potvrzenoDate: isoToday(), potvrzenoTime: nowTime() };
  try { await db.collection('klice').doc(id).update({ potvrzeno: true, historie: h }); toast('Převzetí potvrzeno ✓'); }
  catch (e) { toast('Nejde potvrdit: ' + (e.code || e.message)); }
}
function historieKlice(id) {
  const k = S.klice.find(x => x.id === id); if (!k) return;
  const h = [...(k.historie || [])].reverse();
  modal(`<h3>🔑 ${esc(k.nazev)} — historie předání</h3>
    ${h.map(z => `<div class="urow" style="align-items:flex-start"><span>${z.potvrzeno ? '✅' : '⏳'}</span>
      <div><b>${esc(z.odJmeno)}</b> → <b>${esc(z.komuJmeno)}</b><br>
        <span class="muted">${fmtISO(z.date)} ${z.time}${z.potvrzeno ? ` · potvrzeno ${z.potvrzenoDate ? fmtISO(z.potvrzenoDate) + ' ' + (z.potvrzenoTime || '') : ''}` : ' · zatím nepotvrzeno'}</span></div></div>`).join('')
      || '<div class="muted">Zatím žádné předání.</div>'}
    <div class="aprv"><button class="btn dark" onclick="closeModal()">Zavřít</button></div>`);
}

/* Karta ukolu je spolecna pro pracovnika i subdodavatele — jeden kod,
   jedno chovani, jedna udrzba. */
function kartaUkoly(p) {
  const myTasks = S.tasks.filter(t => t.stav !== 'hotovo' && t.stav !== 'sablona' && jeMuj(t));
  const ut = S.ukolTab || 'moje';
  /* Dnes odskrtnute — zustavaji videt do konce dne, at jde omyl vzit zpet. */
  const hotoveDnes = S.tasks.filter(t => t.stav === 'hotovo' && t.hotovoDne === isoToday() && jeMuj(t));
  /* Co jsem zadal nekomu jinemu — vlastni ukoly uz jsou o kus vys. */
  const zadaneMnou = S.tasks.filter(t => t.stav !== 'hotovo' && t.stav !== 'sablona'
    && S.me && t.zadalId === S.me.id && t.respId !== S.me.id);
  return `    <div class="card">
      <div class="ukhead">
        <h3 style="margin:0;flex:1">📌 Úkoly</h3>
        <button class="btn ${S.wtaskOpen ? 'ghost' : 'dark'} sm" onclick="S.wtaskOpen=!S.wtaskOpen;if(!S.wtaskOpen)S.taskFoto=[];render()">${S.wtaskOpen ? '✕ Zavřít' : '＋ Zadat'}</button>
      </div>
      ${S.wtaskOpen ? `
      <div class="ukform">
        <label>Nadpis *</label>
        <input type="text" id="wtk-t" placeholder="Dovézt lepidlo na obklady">
        <label>Popis <span class="muted" style="text-transform:none;font-weight:400">— podrobnosti, nepovinné</span></label>
        <textarea id="wtk-popis" placeholder="Jaké lepidlo, kolik, kam přesně…" style="min-height:54px"></textarea>
        <div class="frow">
          <div><label>Komu</label>
            <select id="wtk-r">
              <option value="">— vyber, komu —</option>
              ${S.me ? `<option value="${S.me.id}">🙋 Já sám (${esc(fullName(S.me))})</option>` : ''}
              ${lideProUkoly().filter(u => !S.me || u.id !== S.me.id).map(u => `<option value="${u.id}">${esc(fullName(u))}</option>`).join('')}
            </select></div>
          <div><label>Termín</label><input type="date" id="wtk-d" value="${shiftISO(isoToday(), 3)}"></div>
        </div>
        <label>Stavba</label>
        <select id="wtk-p">${S.projects.filter(x => x.active !== false).map(x => `<option value="${x.id}" ${p && x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <label>Fotka k úkolu <span class="muted" style="text-transform:none;font-weight:400">— vyfoť nebo přilož · po vyřízení úkolu se fotky smažou</span></label>
        <label class="btn dark sm" style="display:inline-flex;align-items:center;gap:7px;cursor:pointer">📷 Vyfotit / vybrat z galerie<input type="file" accept="image/*" multiple hidden onchange="ukolFotoPridat(this.files)"></label>
        ${(S.taskFoto || []).length ? `<div class="photos">${S.taskFoto.map((f, i) => `<div class="ph"><img src="${f.thumb}"><span class="del" onclick="S.taskFoto.splice(${i},1);render()">✕</span></div>`).join('')}</div>` : ''}
        <div class="aprv"><button class="btn amber" onclick="workerAddTask()">➕ Zadat úkol</button></div>
      </div>` : ''}
      <div class="uktabs">
        <div class="t ${ut === 'moje' ? 'active' : ''}" onclick="S.ukolTab='moje';render()">Moje${myTasks.length ? ' · ' + myTasks.length : ''}</div>
        <div class="t ${ut === 'zadal' ? 'active' : ''}" onclick="S.ukolTab='zadal';render()">Zadal jsem${zadaneMnou.length ? ' · ' + zadaneMnou.length : ''}</div>
      </div>
      ${ut === 'moje' ? `<div class="uk">
        ${myTasks.map(t => `<div class="ukol ${ukolNaleh(t)}">
          <span class="bx" onclick="taskDone('${t.id}')" title="Označit jako hotové"></span>
          <div style="cursor:pointer" onclick="S.ukolDetail=S.ukolDetail==='${t.id}'?null:'${t.id}';render()"><div class="tt">${esc(t.title)}${(t.odpovedi || []).length ? ` <span class="muted" style="font-weight:400">💬${t.odpovedi.length}</span>` : ''}</div>
            ${S.ukolDetail === t.id ? ukolDetailHtml(t) : (t.popis ? `<div class="muted" style="font-size:13px;margin-top:2px">${esc(t.popis.split('\n')[0].slice(0, 90))}${(t.popis.length > 90 || t.popis.includes('\n')) ? '…' : ''}</div>` : '')}
            <div class="mt">${terminChip(t)}<span>🏗 ${esc((proj(t.pid) || {}).name || '')}</span>${t.zadal ? `<span>👤 zadal ${esc(t.zadal)}</span>` : ''}${t.resp && (!S.me || t.respId !== S.me.id) ? `<span>➜ ${esc(t.resp)}</span>` : ''}${S.me && t.zadalId === S.me.id ? `<span class="lnk" style="margin-left:auto" onclick="event.stopPropagation();ukolUpravit('${t.id}')">✏️ upravit</span><span class="lnk" onclick="event.stopPropagation();smazatMujUkol('${t.id}')">✕ zrušit</span>` : ''}</div>
            ${fotkyUkolu(t)}
          </div></div>`).join('')}
        ${hotoveDnes.map(t => `<div class="ukol hot">
          <span class="bx on" onclick="taskDone('${t.id}')" title="Vrátit mezi nehotové">✓</span>
          <div style="cursor:pointer" onclick="S.ukolDetail=S.ukolDetail==='${t.id}'?null:'${t.id}';render()"><div class="tt">${esc(t.title)}${(t.odpovedi || []).length ? ` <span class="muted" style="font-weight:400">💬${t.odpovedi.length}</span>` : ''}</div><div class="mt"><span>Hotovo dnes — ťuknutím vrátíš</span></div></div></div>`).join('')}
        ${(!myTasks.length && !hotoveDnes.length) ? '<div class="empty">Žádné úkoly. Můžeš dělat svoje. 👍</div>' : ''}
      </div>` : `<div class="uk">
        ${zadaneMnou.map(t => `<div class="ukol ${ukolNaleh(t)}">
          <span class="uav">${ini(userById(t.respId) || { jmeno: t.resp || '?', prijmeni: '' })}</span>
          <div style="cursor:pointer" onclick="S.ukolDetail=S.ukolDetail==='${t.id}'?null:'${t.id}';render()"><div class="tt">${esc(t.title)}${(t.odpovedi || []).length ? ` <span class="muted" style="font-weight:400">💬${t.odpovedi.length}</span>` : ''}</div>
            ${S.ukolDetail === t.id ? ukolDetailHtml(t) : (t.popis ? `<div class="muted" style="font-size:13px;margin-top:2px">${esc(t.popis.split('\n')[0].slice(0, 90))}${(t.popis.length > 90 || t.popis.includes('\n')) ? '…' : ''}</div>` : '')}
            <div class="mt">${terminChip(t)}<span class="badge ${STAVCOLOR[t.stav] || 'b-int'}">${STAVY[t.stav] || t.stav}</span><span>➜ ${esc(t.resp || 'nikomu')}</span>
              <span class="lnk" style="margin-left:auto" onclick="event.stopPropagation();ukolUpravit('${t.id}')">✏️ upravit</span>
              <span class="lnk" onclick="event.stopPropagation();smazatMujUkol('${t.id}')">✕ zrušit</span></div>
            ${fotkyUkolu(t)}
          </div></div>`).join('')}
        ${!zadaneMnou.length ? '<div class="empty">Zatím jsi nikomu nic nezadal.</div>' : ''}
      </div>`}
    </div>`;
}

/* ============ VCHOD SUBDODAVATELE ============
   Sub NEPICHA hodiny — fakturuje praci podle smlouvy. Hlasi ale navstevu
   stavby s prichodem a odchodem, aby vedeni videlo, jak dlouho tam byl:
   - PRICHOD: stavba + kolik jich je + co tam budou delat
   - ODCHOD: vyzva k sepsani zaznamu a nahrani fotek toho, co udelali;
     zaznam jde do deniku ke schvaleni jako kazdy jiny zapis.
   Zadal Marco 27. 8. 2026 (upresneno tehoz dne vecer). */
function viewSub() {
  const otevrena = S.hlaseni.find(h => h.date === isoToday() && !h.odchod);
  const hotoveDnesNav = S.hlaseni.filter(h => h.date === isoToday() && h.odchod);
  if (!S.subProject && S.projects.length) {
    const list = S.projects.filter(x => x.active !== false);
    S.subProject = list.length ? list[0].id : S.projects[0].id;
  }
  const p = proj(otevrena ? otevrena.pid : S.subProject);
  return topbar() + `<div class="shell"><div class="content">
  <div class="strip"><h1>Můj den na stavbě</h1><span class="sp"></span><span class="muted">${fmtISOFull(isoToday())}</span></div>
  <main class="mobilewrap">
    ${typeof navodHtml === "function" ? navodHtml('sub') : ""}
    <div class="card">
      <h3>🧰 ${otevrena ? 'Jsem na stavbě' : 'Příchod na stavbu'}</h3>
      ${otevrena ? `
        <div class="urow" style="align-items:flex-start"><span style="font-size:19px">🏗</span>
          <div><b>${esc((proj(otevrena.pid) || {}).name || '')}</b><br>
            <span class="muted">od ${otevrena.prichod || otevrena.time || ''} · ${otevrena.pocet} ${otevrena.pocet === 1 ? 'člověk' : otevrena.pocet <= 4 ? 'lidi' : 'lidí'} · ${esc(otevrena.cinnost || '')}</span><br>
            <b style="color:var(--ok)">Na stavbě ${dobaText(otevrena.prichod || otevrena.time)}</b></div></div>
        ${S.subOdchodOpen ? `
        <div class="ukform" style="margin-top:10px">
          <label>Co jste dnes udělali? *</label>
          <textarea id="so-z" placeholder="Rozvody vody v koupelně hotové, zbývá napojit pračku…">${esc(S.subZaznam || '')}</textarea>
          <label>Fotky toho, co jste udělali</label>
          <label class="btn dark sm" style="display:inline-flex;align-items:center;gap:7px;cursor:pointer">📷 Vyfotit / vybrat z galerie<input type="file" accept="image/*" multiple hidden onchange="S.subZaznam=document.querySelector('#so-z').value;processPhotos(this.files)"></label>
          <div class="photos">${S.draftPhotos.map((ph, i) => `<div class="ph"><img src="${ph.thumb}"><span class="del" onclick="S.draftPhotos.splice(${i},1);render()">✕</span></div>`).join('')}</div>
          <div class="aprv">
            <button class="btn amber velke" onclick="subOdchod()">🏁 ODESLAT A ZAPSAT ODCHOD</button>
            <button class="btn ghost" onclick="zrusitRozepsanyZapis()">Zpět</button>
          </div>
          <div class="note">Záznam s fotkami jde vedení ke schválení — jako zápis do deníku.</div>
        </div>` : `
        <div class="aprv" style="margin-top:10px"><button class="btn dark velke" onclick="S.subOdchodOpen=true;render()">🏁 ZAPSAT ODCHOD</button></div>
        <div class="note">Při odchodu tě to vyzve sepsat, co jste udělali, a přidat fotky.</div>`}
      ` : `
        <label>Stavba * <span class="muted" style="text-transform:none;font-weight:400">· vpravo kolik vás tu je (i s tebou)</span></label>
        <div style="display:flex;gap:8px;align-items:stretch">
          <select id="sh-p" style="flex:1;min-width:0" onchange="S.subProject=this.value;render()">
            <option value="">— vyber stavbu —</option>
            ${S.projects.filter(x => x.active !== false).map(x => `<option value="${x.id}" ${S.subProject === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
          <input type="number" id="sh-n" min="1" max="30" value="${S.subPocet || 1}" title="Kolik vás tu je (i s tebou)" style="width:74px;flex:none;text-align:center">
        </div>
        <label>Co tu dnes budete dělat? *</label>
        <input type="text" id="sh-c" placeholder="Rozvody vody v koupelně, 2. patro" onkeydown="if(event.key==='Enter')subPrichod()">
        <div class="aprv"><button class="btn amber velke" onclick="subPrichod()">✅ ZAPSAT PŘÍCHOD</button></div>
        <div class="note">Hlášení vidí vedení — je to záznam pro kontrolu.</div>`}
      ${hotoveDnesNav.length ? `<div style="margin-top:10px">
        ${hotoveDnesNav.map(h => `<div class="urow"><span>✅</span><div><b>${esc((proj(h.pid) || {}).name || '')}</b><br>
          <span class="muted">${h.prichod || h.time || ''}–${h.odchod} (${dobaText(h.prichod || h.time, h.odchod)}) · ${h.pocet} lidí · ${esc(h.cinnost || '')}</span></div>
          <span class="lnk" style="margin-left:auto" onclick="subSmazatHlaseni('${h.id}')">✕</span></div>`).join('')}
      </div>` : ''}
    </div>
    ${kartaUkoly(p)}
    ${kartaKlice()}
    ${kartaPodklady(p)}
    ${kartaPoznamky(p)}
  </main></div></div>`;
}

/* Doba mezi dvema casy "HH:MM" jako lidsky text. Bez odchodu se meri do ted. */
function dobaText(od, do_) {
  if (!od) return '';
  const [oh, om] = od.split(':').map(Number);
  let kh, km;
  if (do_) { [kh, km] = do_.split(':').map(Number); }
  else { const d = new Date(); kh = d.getHours(); km = d.getMinutes(); }
  let min = (kh * 60 + km) - (oh * 60 + om);
  if (min < 0) min += 24 * 60;                       // smena pres pulnoc — konec je "driv" jen v ramci HH:MM
  return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
}

async function subPrichod() {
  const pid = $('#sh-p').value, n = Math.max(1, parseInt($('#sh-n').value) || 1), c = $('#sh-c').value.trim();
  if (!pid) { toast('Vyber stavbu'); return; }
  if (!c) { toast('Napiš, co tu dnes budete dělat'); return; }
  S.subProject = pid; S.subPocet = n;
  try {
    await db.collection('hlaseni').add({
      userDocId: S.me ? S.me.id : '', userName: fullName(S.me || {}), authUid: S.authUser.uid,
      pid, date: isoToday(), prichod: nowTime(), odchod: null, pocet: n, cinnost: c, createdAt: FV()
    });
    zapomen('sh-c');
    toast('Příchod zapsán ✓'); render();
  } catch (e) { toast('Nepovedlo se zapsat: ' + (e.code || e.message)); }
}

async function subOdchod() {
  const otevrena = S.hlaseni.find(h => h.date === isoToday() && !h.odchod);
  if (!otevrena) { S.subOdchodOpen = false; render(); return; }
  const text = $('#so-z').value.trim();
  if (!text) { toast('Sepiš aspoň větu, co jste udělali'); return; }
  /* Fotka je u odchodu subdodavatele povinna stejne jako u party. */
  if (!S.draftPhotos.length) { toast('📷 Přidej aspoň jednu fotku — bez ní odchod zapsat nejde'); return; }
  try {
    /* zaznam + fotky jdou do deniku ke schvaleni stejne jako od party;
       pocet osob = kolik jich sub nahlasil pri prichodu (sub nema dochazku,
       ze ktere by se dal pocet dopocitat) */
    await addEntry(otevrena.pid, fullName(S.me || {}), text, otevrena.pocet);
    await db.collection('hlaseni').doc(otevrena.id).update({ odchod: nowTime(), zaznam: text });
    S.subOdchodOpen = false; S.subZaznam = '';
    zapomen('so-z');
    toast('Odchod zapsán — záznam šel vedení ke schválení ✓'); render();
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
async function subSmazatHlaseni(id) {
  const h = S.hlaseni.find(x => x.id === id); if (!h) return;
  if (!await potvrd('Smazat dnešní hlášení?')) return;
  try { await db.collection('hlaseni').doc(id).delete(); toast('Smazáno ✓'); }
  catch (e) { toast('Nejde smazat: ' + (e.code || e.message)); }
}

function viewWorker() {
  ensureMyPos();
  const sm = mojeSmena();
  const zadost = mojeZadostOdchod();
  const zamitnute = mojeZamitnuteZadosti();
  /* Odeslana zadost o doplneni odchodu = smena je pro obrazovku UZAVRENA.
     Drive tu cekajici zadost zobrazila jen box "Čeká na vedení" bez tlacitek
     a pracovnik rano nemohl pichnout prichod noveho dne. Do hodin se stejne
     nic nezapocte, dokud zadost neprojde schvalenim.
     Plati to jen pro prichod, KE KTEREMU zadost patri (prichodId) — jakmile
     si clovek pichne novy den, bezi mu normalni smena i s cekajici zadosti. */
  const vPraciUI = sm.vPraci && !(zadost && sm.posledni && zadost.prichodId === sm.posledni.id);
  if (vPraciUI) S.workerProject = sm.pid;          // behem smeny se stavba neprepina
  if (!S.workerProject && S.projects.length) {
    const list = workerProjectList();
    S.workerProject = list.length ? list[0].p.id : S.projects[0].id;
  }
  const p = proj(S.workerProject);
  const myEntries = p ? entriesOf(p.id).slice(0, 8) : [];
  const myAtt = S.attendance.filter(a => a.date === isoToday());
  const lastAct = myAtt[0];
  return topbar() + `<div class="shell"><div class="content">
  <div class="strip"><h1>Můj den na stavbě</h1><span class="sp"></span><span class="muted">${fmtISOFull(isoToday())}</span></div>
  <main class="mobilewrap">
    ${typeof navodHtml === "function" ? navodHtml('worker') : ""}
    <div class="card">
      <label style="margin-top:0">Stavba</label>
      ${vPraciUI ? `
        <div class="zamcena"><span class="zam">🔒</span>${esc((proj(sm.pid) || {}).name || 'neznámá stavba')}</div>
        <div class="muted" style="margin-top:6px;font-size:12px">Stavbu jde změnit až po odchodu — nebo tlačítkem „Přejít na jinou stavbu".</div>
      ` : `
        <select id="w-proj" style="font-size:16px" onchange="S.workerProject=this.value;S.draftPhotos=[];S.draftAtts=[];render()">
          ${workerProjectList().map(it => `<option value="${it.p.id}" ${it.p.id === S.workerProject ? 'selected' : ''}>${esc(it.p.name)}${
            it.last ? ' · naposledy' : ''}${it.dist != null ? ' · ' + fmtDist(it.dist) : it.p.gps ? '' : ' · bez GPS'}</option>`).join('')}
        </select>
        ${p ? `<div class="muted" style="margin-top:8px">${esc(p.address || '')}${
          !p.gps ? ' <b style="color:var(--wait)">· stavba nemá GPS, poloha se neověří</b>' : ''}</div>` : ''}
      `}

      <label>⏱ Docházka</label>
      ${zamitnute.map(z => `<div class="inote" style="background:#fdeceb;border-color:#e9b5b0;color:#8a2c22">
        <b>✕ Vedení zamítlo doplněný odchod</b> (${fmtISO(z.date)} v ${esc(z.time)})${z.duvod ? '<br>Důvod: ' + esc(z.duvod) : ''}
        <div style="margin-top:6px"><button class="btn ghost sm" onclick="zadostVzitNaVedomi('${z.id}')">Rozumím</button></div>
      </div>`).join('')}
      ${zadost ? `
        <div class="smena" style="background:var(--wait-soft);border-color:#ecd9a0">
          <div class="muted" style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--wait)">Čeká na vedení</div>
          <div class="cas" style="color:var(--wait);font-size:17px">Odchod ${fmtISO(zadost.date)} v ${esc(zadost.time)}</div>
          <div class="kde" style="color:#7c5806">Žádost je odeslaná. Do docházky se zapíše, až ji vedení schválí — hodiny se do té doby nepočítají.${vPraciUI ? '' : ' Dnešní příchod můžeš zapsat normálně.'}</div>
        </div>
      ` : ''}
      ${vPraciUI && sm.zeVcerejska ? `
        <div class="smena" style="background:var(--wait-soft);border-color:#ecd9a0">
          <div class="muted" style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--wait)">Neuzavřený den</div>
          <div class="cas" style="color:var(--wait);font-size:17px">Příchod ${fmtISO(sm.posledni.date)} v ${esc(sm.posledni.time)} — bez odchodu</div>
          <div class="kde" style="color:#7c5806">Doplň, kdy jsi odešel. Vedení to schválí a den se uzavře.</div>
        </div>
        <button class="btn amber velke" onclick="doplnitOdchodForm()">🕗 POŽÁDAT O DOPLNĚNÍ ODCHODU</button>
        <button class="btn ghost velke" ${S.checking ? 'disabled' : ''} onclick="workerCheck('Odchod')" style="margin-top:8px">${S.checking === 'Odchod' ? '⏳ ZAPISUJI…' : '🏁 Jsem tu pořád — zapsat odchod teď'}</button>
      ` : vPraciUI ? `
        <div class="smena">
          <div class="muted" style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#3c6b4c">V práci</div>
          <div class="cas" id="w-cas">${trvaniOd(sm.posledni)}</div>
          <div class="kde">od ${sm.posledni.time}${sm.zeVcerejska ? ' <b>(' + fmtISO(sm.posledni.date) + ' — neuzavřeno!)</b>' : ''} · ${esc((proj(sm.pid) || {}).name || '')}</div>
        </div>
        ${(() => { const b = mojePauza(); return b ? `
        <div class="pauzabox bezi${S.pauzaMinut >= 60 ? ' dlouha' : ''}" id="w-pauzabox" onclick="ukoncitPauzu()">
          <span class="toggle on"><i></i></span>
          <div style="flex:1"><b>🥪 Pauza běží — <span id="w-pauza">${trvaniOd(b)}</span></b>
          <small>Ťukni, až se vrátíš do práce. Čas pauzy se odečte od hodin.</small></div>
        </div>` : `
        <div class="pauzabox" onclick="zacitPauzu()">
          <span class="toggle"><i></i></span>
          <div style="flex:1"><b>🥪 Začít pauzu</b>
          <small>Zapni, když jdeš na oběd. Odečte se od dnešních hodin.</small></div>
        </div>`; })()}
        <button class="btn dark velke" ${S.checking ? 'disabled' : ''} onclick="workerCheck('Odchod')">${S.checking === 'Odchod' ? '⏳ ZAPISUJI…' : '🏁 ZAPSAT ODCHOD'}</button>
        <button class="btn ghost velke" ${S.checking ? 'disabled' : ''} onclick="prechodForm()" style="margin-top:8px">${S.checking === 'Přechod' ? '⏳ PŘESOUVÁM…' : '🔄 Přejít na jinou stavbu'}</button>
      ` : `
        <div class="smena mimo">
          <div class="cas">${sm.posledni ? 'Naposledy: ' + sm.posledni.akce.toLowerCase() + ' ' + fmtISO(sm.posledni.date) + ' v ' + sm.posledni.time : 'Zatím žádná docházka'}</div>
        </div>
        <button class="btn ok velke" ${S.checking ? 'disabled' : ''} onclick="workerCheck('Příchod')">${S.checking === 'Příchod' ? '⏳ ZAPISUJI…' : '📍 ZAPSAT PŘÍCHOD'}</button>
      `}
      <div class="note">Po ťuknutí se otevře foťák — vyfoť se na stavbě. Fotka se uloží do složky zakázky na Drive. Zároveň se ověří poloha proti GPS stavby (±${CFG.gpsTolerance || 100} m).</div>
    </div>
    ${kartaUkoly(p)}
    ${kartaKlice()}
    ${kartaPodklady(p)}
    ${kartaPoznamky(p)}
    <div class="card">
      <h3>✍️ Nový zápis do deníku</h3>
      <textarea id="wt" placeholder="Co se dnes dělalo… každá věta = jedna odrážka"></textarea>
      <label>Fotky z dneška</label>
      <label class="btn dark sm" style="display:inline-flex;align-items:center;gap:7px;cursor:pointer">📷 Vyfotit / vybrat z galerie<input type="file" id="wph" accept="image/*" multiple hidden onchange="processPhotos(this.files)"></label>
      <div class="photos">${S.draftPhotos.map((ph, i) => `<div class="ph"><img src="${ph.thumb}"><span class="del" onclick="S.draftPhotos.splice(${i},1);render()">✕</span><small>${esc(ph.label)}</small></div>`).join('')}</div>
      <div class="aprv"><button class="btn amber" id="w-save" onclick="workerSubmit()">📤 ODESLAT ZÁPIS</button></div>
      <div class="note">Zápis jde vedení ke schválení — investor ho zatím nevidí. ${S.online ? '' : '<b>Jsi offline — text se odešle po připojení, fotky přidej pak.</b>'}</div>
    </div>
    <div class="card">
      <h3>Poslední zápisy — ${p ? esc(p.name) : ''}</h3>
      ${myEntries.map(e => `
        <div style="border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${fmtISOFull(e.date)}</b>${sBadge(e.status)}</div>
          <div class="muted">${esc(e.author)}</div>
          <ul class="worklist">${(e.works || []).slice(0, 2).map(w => `<li>${esc(w)}</li>`).join('')}${(e.works || []).length > 2 ? `<li class="muted">… +${e.works.length - 2} další</li>` : ''}</ul>
        </div>`).join('') || '<div class="empty">Zatím žádné zápisy.</div>'}
    </div>
  </main></div></div>`;
}
/* Ziskani polohy: nejdriv rychly pokus (sit/wifi, klidne i fix stary minutu),
   teprve pak presny GPS. Puvodne se rovnou chtela vysoka presnost s limitem
   12 s — na mobilu v barake to casto vyprsi a pichnuti se ulozilo bez polohy,
   aniz by si toho kdokoli vsiml. */
/* Overovaci foto. Pouzivame skryty vstup se souborem a capture="user"
   (predni foto-aparat), ne getUserMedia — na iOS je to spolehlivejsi
   a nechce dalsi opravneni.
   POZOR: .click() musi probehnout jeste v ramci uzivatelova tuknuti,
   takze se tahle funkce vola PRED jakymkoli await. */
/* Overovaci foto. Na telefonu otevreme rovnou fotoaparat pres skryty vstup
   se souborem — na iOS je to spolehlivejsi nez webkamera. Na pocitaci ale
   prohlizec pokyn "otevri fotak" ignoruje a nabidne vyber souboru z disku,
   takze tam sahneme po webkamere. */
function jeDotykove() {
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}
function poriditSelfie() {
  if (jeDotykove()) return selfieZFotaku();
  /* Na pocitaci nejdriv webkamera. Kdyz nepujde (obsazena jinou aplikaci,
     zakazany pristup), spadneme na vyber souboru — fotka je porad potreba,
     jen se vezme odjinud. Zablokovat cloveka u pocitace by bylo horsi. */
  return selfieZKamery().then(v => v || selfieZFotaku());
}
function selfieZKamery() {
  return new Promise(hotovo => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return hotovo(null);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        const box = document.createElement('div');
        box.className = 'modal';
        box.innerHTML = `<div class="mbox" style="max-width:420px">
          <h3>📷 Ověřovací foto</h3>
          <video id="cam-v" autoplay playsinline muted style="width:100%;border-radius:10px;background:#000"></video>
          <div class="aprv" style="margin-top:12px">
            <button class="btn ghost" id="cam-x">Zrušit</button>
            <button class="btn amber" id="cam-ok">📸 Vyfotit</button>
          </div></div>`;
        document.body.appendChild(box);
        const v = box.querySelector('#cam-v');
        v.srcObject = stream;
        const konec = vysledek => {
          stream.getTracks().forEach(t => t.stop());
          box.remove();
          hotovo(vysledek);
        };
        box.querySelector('#cam-x').onclick = () => konec(null);
        box.querySelector('#cam-ok').onclick = () => {
          const c = document.createElement('canvas');
          c.width = v.videoWidth || 640;
          c.height = v.videoHeight || 480;
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          konec({ nahled: scaleJpeg(c, 320, 0.62), plna: scaleJpeg(c, 1280, 0.85) });
        };
      })
      .catch(() => hotovo(null));
  });
}
function selfieZFotaku() {
  return new Promise(hotovo => {
    if (!window.FileReader) return hotovo(null);
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.setAttribute('accept', 'image/*');
    /* capture MUSI pres setAttribute — jako vlastnost ji nekdy prohlizec
       zahodí a pak iOS nabidne i vyber z galerie. Overovaci foto ma byt
       vzdy cerstve z fotaku. */
    inp.setAttribute('capture', 'user');
    inp.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(inp);
    let vyrizeno = false, zpracovava = false;
    const konec = v => { if (vyrizeno) return; vyrizeno = true; try { inp.remove(); } catch (e) {} hotovo(v); };
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return konec(null);
      zpracovava = true;
      try {
        const img = await fileToImage(f);
        /* nahled zustane v databazi (rychly seznam, funguje offline),
           plna verze putuje na Drive do slozky zakazky */
        const nahled = scaleJpeg(img, 320, 0.62);
        const plna = scaleJpeg(img, 1280, 0.85);
        URL.revokeObjectURL(img.src);
        konec({ nahled, plna });
      } catch (e) { konec(null); }
    };
    /* Kdyz uzivatel foceni zrusi, onchange se nespusti — poznáme to az podle
       navratu na stranku. Kratka prodleva, at nepredbehneme zpracovani fotky. */
    const zpet = () => {
      window.removeEventListener('focus', zpet);
      setTimeout(() => { if (!zpracovava) konec(null); }, 1500);
    };
    window.addEventListener('focus', zpet);
    inp.click();
  });
}

/* Ulozi overovaci foto na Drive do slozky zakazky. Kdyz to nevyjde
   (offline, most nedostupny), pichnuti se presto zapise — jen s nahledem. */
/* Overovaci foto jde do stejne fronty jako fotky z deniku. Drive se posilalo
   rovnou na Drive a kdyz nebyl signal, plna verze se zahodila — v zaznamu
   zustal jen maly nahled. Ted se plna verze ulozi do telefonu a odesle se
   sama, jakmile je signal; odkaz se do zaznamu dochazky doplni pozdeji. */
async function zaraditSelfie(p, attendanceId, foto, akce) {
  if (!foto || !foto.plna) return;
  const kdo = fullName(S.me || {}).replace(/\s+/g, '-');
  const jmeno = 'dochazka_' + akce + '_' + kdo + '_' + isoToday() + '_' + nowTime().replace(':', '-');
  try {
    await frontaPridat({
      druh: 'selfie', attendanceId, name: jmeno + '.jpg', mime: 'image/jpeg', data: foto.plna,
      folderId: (p && p.driveFolderId) || '', cn: (p && p.cn) || '', client: (p && p.client) || '', folderName: nazevSlozkyZakazky(p), date: isoToday()
    });
  } catch (e) { console.warn('fronta selfie', e); }
}

function getPos(opts) {
  return new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, opts));
}
/* Rychla varianta (bez zapnute GPS) umi vratit polohu z wifi nebo ze site —
   klidne desitky kilometru vedle. Aplikace to pak vedeni ukazala jako
   "podezrela GPS", tedy jako obvineni, ze clovek pichnul odjinud.
   Proto: rychle mereni si nechame jen tehdy, kdyz si samo pripousti mensi
   chybu, nez je povolena odchylka. Jinak se zeptame jeste jednou poradne. */
async function acquirePos() {
  const TOL = CFG.gpsTolerance || 100;
  let rychla = null;
  try { rychla = await getPos({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }); }
  catch (e) { /* nevadi, zkusime presnou */ }
  if (rychla && rychla.coords && rychla.coords.accuracy != null && rychla.coords.accuracy <= TOL) return rychla;
  /* Presne mereni ma smysl zkusit, ale ne za cenu pulminuty cekani u KAZDEHO
     pichnuti. Kdyz uz nejakou polohu mame, dame GPS jen 8 vterin — venku to
     staci a uvnitr baraku se stejne nedocka, jen bychom cloveka drzeli
     u telefonu. Kdyz nemame nic, plnych 20 vterin plati dal. */
  const limit = rychla ? 8000 : 20000;
  try { return await getPos({ enableHighAccuracy: true, timeout: limit, maximumAge: 0 }); }
  catch (e) { if (rychla) return rychla; throw e; }
}
function posErrText(e) {
  if (!e) return 'Polohu se nepodařilo zjistit.';
  if (e.code === 1) return JE_IOS
    ? 'Poloha je zakázaná.\n\nNa iPhonu ji zapneš takto:\n1) Nastavení → Soukromí a zabezpečení → Polohové služby\n2) Zapnout nahoře, pak sjet na svůj prohlížeč\n3) Nastavit "Při používání aplikace" + Přesná poloha\n4) Vrátit se sem a stránku načíst znovu'
    : 'Poloha je zakázaná — povol ji v nastavení prohlížeče pro tuto stránku a stránku načti znovu.';
  if (e.code === 2) return 'Telefon polohu nezjistil (slabý signál, uvnitř budovy).';
  if (e.code === 3) return 'Zjišťování polohy trvalo moc dlouho.';
  return 'Polohu se nepodařilo zjistit.';
}
/* Ukol z terenu. Zadat ho smi kdokoli komukoli — vedeni pak vidi vsechny,
   ostatni jen co maji prideleno nebo sami zadali (viz listenMojeUkoly). */
/* Zrusit ukol smi ten, kdo ho zadal (a vedeni). Kdo ho ma prideleny, ho
   muze odskrtnout jako hotovy, ale ne smazat — jinak by slo zadani zahodit. */
async function smazatMujUkol(id) {
  const t = S.tasks.find(x => x.id === id);
  if (!t) return;
  if (!await potvrd('Zrušit úkol „' + t.title + '"?\n\nZmizí i tomu, komu jsi ho zadal.')) return;
  for (const f of (t.photos || [])) db.collection('fotonahledy').doc(f.id).delete().catch(() => {});
  try { await db.collection('tasks').doc(id).delete(); toast('Úkol zrušen ✓'); }
  catch (e) { toast('Nepovedlo se zrušit: ' + (e.code || e.message)); }
}

/* Fotky k ukolu: maly nahled primo v ukolu (at je videt, o co jde) a
   stredni verze v /fotonahledy, aby sla fotka po tuknuti otevrit ostre.
   U zapisu do deniku se stredni verze zrusila (velka lezi na Drive a
   vyda ji most), ale fotky ukolu na Drive NEJDOU — bez nahledu by po
   nich zbyla jen rozmazana dlazdice. Misto to neohrozi: po vyrizeni
   ukolu je uklidFotekUkolu smaze. Nejvyse 6 fotek na ukol. */
async function ukolFotoPridat(files) {
  for (const f of files) {
    if ((S.taskFoto || []).length >= 6) { toast('Nejvýš 6 fotek k úkolu'); break; }
    try {
      const img = await fileToImage(f);
      S.taskFoto.push({ id: uid8(), thumb: scaleJpeg(img, 360, 0.62), mid: scaleJpeg(img, 1100, 0.72) });
      URL.revokeObjectURL(img.src);
    } catch (e) { toast('Fotku se nepodařilo načíst'); }
  }
  render();
}

async function workerAddTask() {
  const title = $('#wtk-t').value.trim();
  if (!title) { toast('Napiš, co je potřeba udělat'); return; }
  const respId = $('#wtk-r').value, ru = userById(respId);
  /* Drive bylo policko predvyplnene na sebe, takze kdo ho preskocil, zadal
     ukol tise sam sobe a pak ho hledal v "Zadal jsem". Ted se musi vybrat. */
  if (!respId) { toast('Vyber, komu úkol patří'); return; }
  try {
    const fotky = (S.taskFoto || []).map(f => ({ id: f.id, thumb: f.thumb }));
    /* VYJIMKA: fotky UKOLU si stredni verzi v /fotonahledy nechavaji.
       U zapisu do deniku se zrusila, protoze velka verze lezi na Drive
       a most ji vyda. Fotky ukolu ale na Drive VUBEC nejdou — bez nahledu
       v databazi by po nich zbyla jen rozmazana dlazdice 360 px.
       Misto to neohrozi: po vyrizeni ukolu je uklidFotekUkolu smaze. */
    for (const f of (S.taskFoto || [])) {
      if (f.mid) db.collection('fotonahledy').doc(f.id)
        .set({ data: f.mid, pid: $('#wtk-p').value, entryId: '', date: isoToday(), autorUid: S.authUser.uid, createdAt: FV() })
        .catch(() => {});
    }
    await db.collection('tasks').add({
      title, zadalId: S.me ? S.me.id : '', zadal: fullName(S.me || {}),
      pid: $('#wtk-p').value, respId, resp: ru ? fullName(ru) : '',
      created: isoToday(), term: $('#wtk-d').value || shiftISO(isoToday(), 3),
      popis: ($('#wtk-popis') ? $('#wtk-popis').value.trim() : ''),
      stav: 'nove', res: ru ? [fullName(ru)] : [], photos: fotky, createdAt: FV()
    });
    S.taskFoto = [];
    /* Skocit na zalozku, kde ukol doopravdy skoncil — at ho clovek nehleda. */
    const sobe = S.me && respId === S.me.id;
    S.ukolTab = sobe ? 'moje' : 'zadal';
    S.wtaskOpen = false;
    toast(sobe ? 'Úkol přidán mezi tvoje ✓' : 'Úkol zadán — ' + (ru ? fullName(ru) : '') + ' ✓');
    render();
  } catch (e) { toast('Nepovedlo se zadat: ' + (e.code || e.message)); }
}

async function workerCheck(akce) {
  if (S.checking) return;
  const p = proj(S.workerProject);
  if (!p) { toast('Vyber stavbu'); return; }

  // pojistka: dvakrat po sobe tatáž akce nedava smysl (tlacitko uz to hlida)
  // — ledaze OTEVRENY prichod ceka na doplneny odchod u vedeni (zadost se
  //   pozna podle prichodId): pak novy prichod projit MUSI, jinak by
  //   cekajici zadost blokovala cely dnesek
  const sm = mojeSmena();
  const zadostNaOtevreny = (z => z && sm.posledni && z.prichodId === sm.posledni.id)(mojeZadostOdchod());
  if (sm.vPraci && akce === 'Příchod' && !zadostNaOtevreny) { toast('Už jsi v práci — nejdřív zapiš odchod'); return; }
  if (!sm.vPraci && akce === 'Odchod') { toast('Nejsi v práci — nejdřív zapiš příchod'); return; }

  /* Foťák spustit HNED (jeste v ramci tuknuti), polohu zjistovat soubezne —
     usetri to par vterin, protoze GPS bezi, zatimco clovek fotí. */
  const fotoSlib = poriditSelfie();
  const polohaSlib = (p.gps && navigator.geolocation)
    ? acquirePos().then(pos => ({ pos })).catch(err => ({ err }))
    : Promise.resolve(null);

  S.checking = akce; render();

  /* ID zaznamu vyrobi telefon, ne server — diky tomu pichnuti projde i bez
     signalu (Firestore ho posle sam, az bude) a selfie uz vi, kam patri.
     Zapis se zamerne neceka: offline by se na nej cekalo do nekonecna
     a tlacitko by zustalo viset na "ZAPISUJI…". */
  const save = async (gpsDev, foto, presnost) => {
    /* Pauza uz neni cislo u odchodu — ma vlastni zaznamy. Kdyz nekdo odchazi
       s bezici pauzou, uzavreme ji, jinak by bezela dal a ubirala hodiny. */
    const ref = db.collection('attendance').doc();
    if (foto) await zaraditSelfie(p, ref.id, foto, akce);
    ref.set({
      userDocId: S.me ? S.me.id : '', userName: fullName(S.me || {}), authUid: S.authUser.uid,
      akce, pid: p.id, date: isoToday(), time: nowTime(), gps: gpsDev,
      /* K odchylce se uklada i to, jak presne telefon meril. Bez toho neslo
         poznat, jestli je 800 m podvod, nebo poloha odhadnuta z wifi. */
      gpsPresnost: (presnost == null ? null : Math.round(presnost)),
      selfie: foto ? foto.nahled : null, selfieDriveId: null,
      manual: false, createdAt: FV()
    }).catch(e => console.warn('zapis dochazky', e));
    if (akce === 'Odchod') await ukoncitPauzu(true);
    frontaOdeslat();
    toast(akce + ' zapsán' + (gpsDev != null ? ' — poloha sedí (' + gpsDev + ' m)' : ' BEZ OVĚŘENÍ POLOHY')
      + (foto ? (S.online ? ' 📷' : ' 📷 odešle se, až bude signál') : '') + ' ✓');
  };

  try {
    const selfie = await fotoSlib;
    /* Foto je povinne (rozhodnuti 25. 8.). Kdo nepusti foťák, nepichne si —
       proto je hlaska konkretni, at clovek vi, co ma udelat, nez zavola vedeni. */
    if (!selfie) {
      await oznam('Bez ověřovacího fota nejde ' + akce.toLowerCase() + ' zapsat.\n\n'
        + 'Zkus to znovu. Když se foťák neotevře, povol aplikaci přístup k fotoaparátu '
        + 'v nastavení telefonu — a když to nepůjde ani pak, ozvi se vedení, doplní ti to ručně.');
      S.checking = null; render(); return;
    }
    if (!p.gps) {
      if (!await potvrd('Stavba „' + p.name + '" nemá zadané GPS, takže polohu nelze ověřit.\n\nZapsat ' +
                   akce.toLowerCase() + ' bez ověření?')) { S.checking = null; render(); return; }
      await save(null, selfie);
    } else {
      const r = await polohaSlib;
      if (r && r.pos) {
        await save(haversine(r.pos.coords.latitude, r.pos.coords.longitude, p.gps.lat, p.gps.lng), selfie, r.pos.coords.accuracy);
      } else {
        if (!await potvrd(posErrText(r && r.err) + '\n\nZapsat ' + akce.toLowerCase() + ' bez ověření polohy?')) {
          S.checking = null; render(); return;
        }
        await save(null, selfie);
      }
    }
  } catch (e) { toast('Zápis se nepovedl: ' + (e.code || e.message)); }
  S.checking = null; render();
}

/* Zapomenuty odchod. Pracovnik ho doplni sam, ale je to jen NAVRH —
   do hodin se zapocita az po schvaleni vedenim. */
function doplnitOdchodForm() {
  const sm = mojeSmena();
  if (!sm.vPraci) return;
  const p = proj(sm.pid) || {};
  modal(`<h3>🕗 Doplnit chybějící odchod</h3>
    <div class="inote" style="margin-top:0">Máš otevřený příchod z <b>${fmtISO(sm.posledni.date)}</b> od ${esc(sm.posledni.time)},
      stavba ${esc(p.name || '')}.<br>Doplň, kdy jsi ve skutečnosti odešel. <b>Odejde to vedení jako žádost</b> — do docházky se to zapíše, až ji schválí.</div>
    <div class="frow">
      <div><label>Datum odchodu</label><input type="date" id="do-d" value="${esc(sm.posledni.date)}"></div>
      <div><label>Čas odchodu</label><input type="time" id="do-t" value="16:00"></div>
    </div>
    <label>Pauza na oběd</label>
    <select id="do-pauza"><option value="0">bez pauzy</option><option value="30">30 minut</option><option value="60">60 minut</option></select>
    <label>Proč jsi nepíchnul (uvidí vedení)</label>
    <input type="text" id="do-pozn" placeholder="např. vybil se mi telefon">
    <div class="note">Tohle je jen žádost. Do docházky se nic nezapíše, dokud ji vedení neschválí.</div>
    <div class="aprv"><button class="btn amber" onclick="doplnitOdchod()">📤 Odeslat žádost vedení</button>
    <button class="btn ghost" onclick="closeModal()">Zrušit</button></div>`);
}
async function doplnitOdchod() {
  const sm = mojeSmena(); if (!sm.vPraci) return;
  if (mojeZadostOdchod()) { toast('Žádost už čeká u vedení'); closeModal(); return; }
  const cas = $('#do-t').value || '16:00';
  const datum = $('#do-d').value || sm.posledni.date;
  if (datum < sm.posledni.date || (datum === sm.posledni.date && cas <= sm.posledni.time)) {
    toast('Odchod musí být později než příchod v ' + sm.posledni.time); return;
  }
  try {
    // nececkame na server do nekonecna — bez signalu by okno zustalo viset;
    // Firestore zapis stejne dorucil sam, az bude pripojeni
    const zapis = db.collection('zadosti').add({
      typ: 'odchod', stav: 'ceka',
      userDocId: S.me ? S.me.id : '', userName: fullName(S.me || {}), authUid: S.authUser.uid,
      pid: sm.pid, date: datum, time: cas,
      pauza: Math.max(0, parseInt($('#do-pauza').value, 10) || 0),
      prichodId: sm.posledni.id, prichodDate: sm.posledni.date, prichodTime: sm.posledni.time,
      poznamka: $('#do-pozn').value.trim(), createdAt: FV()
    });
    zapis.catch(e => toast('Žádost se neuložila: ' + (e.code || e.message)));
    await Promise.race([zapis, new Promise(r => setTimeout(r, 1500))]);
    closeModal();
    toast(S.online ? 'Žádost odeslaná vedení ✓ Do hodin se započítá až po schválení.'
                   : 'Žádost uložena — odejde vedení, až bude signál ✓');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
/* Vedeni zadost schvali -> teprve TED vznikne zaznam dochazky. Zapisuje ho
   vedeni, ale pod uctem pracovnika, aby ho mel videt i on ve svem mobilu. */
async function zadostSchvalit(id) {
  const z = S.zadosti.find(x => x.id === id); if (!z) return;
  try {
    await db.collection('attendance').add({
      userDocId: z.userDocId, userName: z.userName, authUid: z.authUid,
      akce: 'Odchod', pid: z.pid, date: z.date, time: z.time,
      gps: null, selfie: null, manual: true, schvaleno: true, pauza: z.pauza || 0,
      poznamka: z.poznamka || '', zeZadosti: id,
      zapsal: { kdo: fullName(S.me || {}), kdy: new Date().toISOString() }, createdAt: FV()
    });
    await db.collection('zadosti').doc(id).update({
      stav: 'schvaleno', vyrizeno: { kdo: fullName(S.me || {}), kdy: new Date().toISOString() }
    });
    toast('Schváleno ✓ Odchod zapsán, hodiny se započítají.');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
async function zadostZamitnout(id) {
  const z = S.zadosti.find(x => x.id === id); if (!z) return;
  const duvod = await zeptejSe('Zamítnout žádost', 'Proč žádost zamítáš? Uvidí to pracovník.', '');
  if (duvod === null) return;
  try {
    await db.collection('zadosti').doc(id).update({
      stav: 'zamitnuto', duvod: (duvod || '').trim(),
      vyrizeno: { kdo: fullName(S.me || {}), kdy: new Date().toISOString() }
    });
    toast('Zamítnuto — den zůstává neuzavřený.');
  } catch (e) { toast('Nepovedlo se: ' + (e.code || e.message)); }
}
async function zadostVzitNaVedomi(id) {
  try { await db.collection('zadosti').doc(id).update({ videno: true }); } catch (e) {}
}

/* Prechod mezi stavbami behem dne: zapise odchod tady a prichod tam.
   Poloha se meri JEDNOU a porovna se s obema stavbami zvlast. */
function prechodForm() {
  const sm = mojeSmena();
  const tady = proj(sm.pid);
  const kam = workerProjectList().filter(it => it.p.id !== sm.pid);
  if (!kam.length) { toast('Není kam přejít — je jen jedna aktivní stavba'); return; }
  modal(`<h3>🔄 Přejít na jinou stavbu</h3>
    <div class="note" style="margin-top:0">Zapíšu <b>odchod</b> z ${esc((tady || {}).name || '—')}
      a rovnou <b>příchod</b> na vybranou stavbu. Poloha se ověří u obou.</div>
    <label>Kam jedeš</label>
    <select id="pr-kam" style="font-size:16px">
      ${kam.map(it => `<option value="${it.p.id}">${esc(it.p.name)}${it.dist != null ? ' · ' + fmtDist(it.dist) : it.p.gps ? '' : ' · bez GPS'}</option>`).join('')}
    </select>
    <div class="aprv"><button class="btn amber" onclick="workerPrechod()">🔄 Přejít</button>
    <button class="btn ghost" onclick="closeModal()">Zrušit</button></div>`);
}
async function workerPrechod() {
  const novePid = $('#pr-kam').value;
  const sm = mojeSmena();
  const zTady = proj(sm.pid), naTam = proj(novePid);
  if (!zTady || !naTam) { toast('Stavba nenalezena'); return; }
  const fotoSlib = poriditSelfie();          // jeste v ramci tuknuti
  closeModal();
  S.checking = 'Přechod'; render();
  const selfie = await fotoSlib;             // jedna fotka pro oba zaznamy
  let pos = null;
  if (navigator.geolocation) { try { pos = await acquirePos(); } catch (e) {} }
  const odch = (pos && zTady.gps) ? haversine(pos.coords.latitude, pos.coords.longitude, zTady.gps.lat, zTady.gps.lng) : null;
  const prich = (pos && naTam.gps) ? haversine(pos.coords.latitude, pos.coords.longitude, naTam.gps.lat, naTam.gps.lng) : null;
  /* K odchylce se uklada i to, jak presne telefon meril — bez toho neslo
     poznat, jestli je 800 m podvod, nebo poloha odhadnuta z wifi. */
  const presnost = (pos && pos.coords && pos.coords.accuracy != null) ? Math.round(pos.coords.accuracy) : null;
  const spolecne = { userDocId: S.me ? S.me.id : '', userName: fullName(S.me || {}), authUid: S.authUser.uid,
    date: isoToday(), selfie: selfie ? selfie.nahled : null, selfieDriveId: null, manual: false, gpsPresnost: presnost };
  try {
    // ID obou zaznamu vyrobi telefon — prechod tak projde i bez signalu.
    // Fotka je jedna spolecna, na Drive ji navazeme na zaznam odchodu.
    const refOdchod = db.collection('attendance').doc();
    const refPrichod = db.collection('attendance').doc();
    if (selfie) await zaraditSelfie(zTady, refOdchod.id, selfie, 'Prechod');
    refOdchod.set({ ...spolecne, akce: 'Odchod', pid: zTady.id, time: nowTime(), gps: odch, createdAt: FV() })
      .catch(e => console.warn('prechod odchod', e));
    await ukoncitPauzu(true);   // pauza patri ke stavbe, ze ktere odchazi
    refPrichod.set({ ...spolecne, akce: 'Příchod', pid: naTam.id, time: nowTime(), gps: prich, createdAt: FV() })
      .catch(e => console.warn('prechod prichod', e));
    S.workerProject = naTam.id;
    frontaOdeslat();
    toast('Přesun zapsán ✓ Jsi na stavbě ' + naTam.name + (selfie && !S.online ? ' · fotka se odešle, až bude signál' : ''));
  } catch (e) { toast('Přesun se nepovedl: ' + (e.code || e.message)); }
  S.checking = null; render();
}

async function workerSubmit() {
  const txt = $('#wt').value.trim();
  /* Zapis ze stavby musi mit text I fotku (rozhodnuti Marca 29. 8.).
     Driv stacilo jedno z toho, takze vetsina zapisu chodila bez
     fotodokumentace. Vedeni ma vlastni formular bez teto podminky —
     doplnuje zapisy z kancelare, kde fotit neni co. */
  if (!txt) { toast('Napiš, co jste dnes dělali'); return; }
  if (!S.draftPhotos.length) { toast('📷 Přidej aspoň jednu fotku — bez ní zápis odeslat nejde'); return; }
  $('#w-save').disabled = true;
  /* Pocet osob pracovnik nezadava — kdo byl na stavbe, je videt z dochazky
     a rucni cislo bylo jen dalsi udaj, ktery mohl byt spatne. */
  await addEntry(S.workerProject, fullName(S.me || {}), txt, null);
  zapomen('wt');
  toast('Odesláno — čeká na schválení vedením ✓'); render();
}

/* ============ PORTÁL INVESTORA ============ */
function viewPortal() {
  if (S.portal === null) return '<div class="loading"><span class="spin" style="width:26px;height:26px"></span>Načítám portál…</div>';
  if (S.portal === false) return `<div class="login"><div class="lbox"><div class="lg">🏗 REKONSTRUKCE <em>VRÁNA</em></div><div class="ls">Portál nenalezen — zkontroluj odkaz, nebo se ozvi: ${CFG.firmContact}</div></div></div>`;
  const P = S.portal;
  // živá data projektu na portálu drží mirror v portals/{token} — základ (progress, milníky) se syncuje při schvalování; fallback: co je v portal docu
  const vps = S.portalVp.filter(v => v.stav === 'u_investora');
  const done = S.portalVp.filter(v => v.stav === 'schvaleno' || v.stav === 'papir');
  return `
  <div class="topbar"><span class="logo">🏗 REKONSTRUKCE <em>VRÁNA</em> <span style="color:#8b98a5;font-weight:500">· Portál investora</span></span><span class="sp"></span></div>
  <div class="content"><main style="max-width:760px;margin:0 auto">
    <div class="hero">
      <div class="hm">Rekonstrukce pro: <b style="color:#fff">${esc(P.client || '')}</b></div>
      <h2 style="margin:3px 0 2px">${esc(P.address || P.name || '')}</h2>
      <div class="hm">${esc(P.type || '')}</div>
      ${/* Prubeh na portalu se pocita z milniku v mirroru — kdyz harmonogram neni,
          radek s procenty vubec neukazujeme (radsi nic nez lzive „Hotovo 0 %"). */''}
      ${(() => { const pr = projProgress(P), fz = projPhase(P); return pr != null
        ? `<div class="prog"><i style="width:${pr}%"></i></div><div class="hm">Hotovo ${pr} % ${fz ? '· fáze: ' + esc(fz) : ''} ${P.handover ? '· ' + esc(P.handover) : ''}</div>`
        : ((fz || P.handover) ? `<div class="hm">${fz ? 'fáze: ' + esc(fz) : ''}${fz && P.handover ? ' · ' : ''}${esc(P.handover || '')}</div>` : ''); })()}
    </div>
    ${(vps.length || done.length) ? `
    <div class="card" ${vps.length ? 'style="border:2px solid var(--amber)"' : ''}>
      <h3>🧾 Vícepráce ${vps.length ? `<span class="badge b-wait">⏳ ${vps.length} ke schválení</span>` : ''}</h3>
      ${vps.map(v => `
        <div style="border:1px solid var(--line);border-radius:9px;padding:11px 13px;margin-bottom:9px">
          <b>${esc(v.title)}</b>
          <div class="muted" style="margin:4px 0">${esc(v.popis || '')}</div>
          <div style="font-size:16px;font-weight:800;color:var(--navy)">${kc(v.cena)} Kč <span class="muted" style="font-size:11px;font-weight:400">bez DPH · DPH 12 % jako součást díla</span></div>
          <div class="aprv">
            <button class="btn ok" onclick="portalVpAction('${v.id}','approve')">✓ Schválit (podpis jedním klikem)</button>
            <button class="btn ghost sm" onclick="portalVpAction('${v.id}','reject')">✕ Zamítnout</button>
          </div>
        </div>`).join('')}
      ${done.map(v => `<div class="urow"><span>✅</span><div>${esc(v.title)} — <b>${kc(v.cena)} Kč</b><br><span class="muted" style="font-size:11.5px">${esc(v.podpis || '')}</span></div></div>`).join('')}
    </div>` : ''}
    ${(P.milestones || []).length ? `<div class="card">
      <h3>📅 Harmonogram</h3>
      ${/* Stav milniku na portalu se bere z postupu (milePct) — funguje i pro stara data bez „p". */''}
      ${P.milestones.map(m => { const pc = milePct(m); const cls = pc === 100 ? 'done' : pc > 0 ? 'now' : 'next'; return `<div class="mile ${cls}"><div class="dot">${pc === 100 ? '✓' : pc > 0 ? '●' : ''}</div><div>${cls === 'now' ? '<b>' + esc(m.t) + ' — probíhá (' + pc + ' %)</b>' : esc(m.t)}${m.dur ? ' <span class="muted" style="font-size:11px">(' + esc(m.dur) + ')</span>' : ''}</div></div>`; }).join('')}
    </div>` : ''}
    ${S.portalDocs.length ? `<div class="card">
      <h3>📁 Dokumenty</h3>
      ${S.portalDocs.map(d => d.pripraveno
        ? `<div class="urow" style="cursor:pointer" onclick="portalDok('${d.id}')"><span>📄</span><b>${esc(d.title)}</b><span class="muted" style="margin-left:auto">zobrazit</span></div>`
        : `<div class="urow"><span>📄</span><b>${esc(d.title)}</b><span class="muted" style="margin-left:auto">připravuje se</span></div>`).join('')}
    </div>` : ''}
    <div class="card">
      <h3>📓 Průběh stavby <span class="muted" style="font-weight:400">— zápisy a fotky</span></h3>
      ${S.portalFeed.length ? S.portalFeed.map((e, i) => `
        <div style="border:1px solid var(--line);border-radius:9px;padding:11px 13px;margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${fmtISOFull(e.date)}</b>${i === 0 ? '<span class="badge b-ok">nové</span>' : ''}</div>
          <div style="margin-top:4px">${esc(e.client).replace(/\n/g, '<br>')}</div>
          ${(e.photos || []).length ? `<div class="photos">${e.photos.map(ph => `<div class="ph" onclick="otevritFotoPortal('${ph.fotoId || ''}','${esc(ph.label)}',this)"><img src="${ph.thumb}"><small>${esc(ph.label || '')}</small></div>`).join('')}</div>` : ''}
        </div>`).join('') : '<div class="empty">Zatím žádné zápisy.</div>'}
    </div>
    <div class="card">
      <h3>ℹ️ Vaše stavba</h3>
      <div class="kv"><span>Zhotovitel</span><span>${CFG.firmName}</span></div>
      <div class="kv"><span>Kontakt</span><span>${CFG.firmContact}</span></div>
    </div>
  </main></div>`;
}
async function portalVpAction(vpid, action) {
  if (action === 'approve' && !await potvrd('Schválit vícepráci? Kliknutí platí jako odsouhlasení ceny.')) return;
  await db.collection('portals').doc(S.portalToken).collection('actions').add({ type: 'vp', vpid, action, ts: FV(), handled: false });
  // optimisticky schovej tlačítka
  const v = S.portalVp.find(x => x.id === vpid);
  if (v) v.stav = action === 'approve' ? 'schvaleno' : 'zamitnuto';
  toast(action === 'approve' ? 'Děkujeme — vícepráce schválena ✓' : 'Zamítnuto — ozveme se Vám.');
  render();
}

/* ---- sync portal hlavičky při změně projektu ---- */
async function syncPortalHeader(p, tokZnamy) {
  /* tokZnamy: pri zakladani portalu je token cerstve zapsany a v pameti
     (S.portaly) jeste nemusi byt — posluchac dorazi az za chvili. */
  const tok = tokZnamy || tokenPortalu(p.id); // token je v admin-only /portaly (S2); bezi jen u admina s nactenym seznamem
  if (!tok) return;
  // Do mirroru jde prubeh i faze uz odvozene z harmonogramu (ne stary rucni
  // zapis) — portal pak nemuze ukazat jine cislo nez detail projektu.
  const r = msRecalc(p.milestones || [], p);
  await db.collection('portals').doc(tok).set({
    pid: p.id, client: p.client || '', name: p.name, address: p.address || '', type: p.type || '',
    progress: r.progress, phase: r.phase, handover: p.handover || '', milestones: p.milestones || []
  }, { merge: true }).catch(() => {});
}
// automaticky syncuj portal hlavičky když se změní projekty (levné — jen při renderu adminů)
let _lastPortalSync = 0;
setInterval(() => {
  if (!S.meAuth || S.meAuth.role !== 'admin' || !S.online) return;
  if (Date.now() - _lastPortalSync < 60000) return;
  _lastPortalSync = Date.now();
  S.projects.filter(p => tokenPortalu(p.id)).forEach(p => syncPortalHeader(p));
}, 65000);

/* ============ VÝCHOZÍ DATA (pilot Pecka + Šaarová) ============ */
async function seedData() {
  /* Pojistka (S21): seed patri VYHRADNE do cerstve zalozeneho, prazdneho
     systemu. V ostrem provozu by zalozil druhou sadu uzivatelu s realnymi
     e-maily a sazbami — proto se pta primo databaze, ne pameti (ta ma jen
     30denni okno). Ucty vedeni se nepocitaji: to je prave ten clovek, ktery
     system zaklada. */
  try {
    const [us, att, ent] = await Promise.all([
      db.collection('users').get(),
      db.collection('attendance').limit(1).get(),
      db.collection('entries').limit(1).get()
    ]);
    const lide = us.docs.filter(d => !((d.data().typ || {}).kanc)).length;
    if (lide || att.size || ent.size) {
      const co = [];
      if (lide) co.push(lide + ' lidí mimo vedení');
      if (att.size) co.push('docházku');
      if (ent.size) co.push('zápisy v deníku');
      await oznam('Pilotní data nahrát nejde — systém se už používá.\n\nUž obsahuje ' + co.join(', ') + '.\n\n' +
        'Seed by založil druhou sadu uživatelů se stejnými e-maily a sazbami. Novou zakázku založ ručně v sekci Projekty.');
      return;
    }
  } catch (e) {
    await oznam('Nepodařilo se ověřit, jestli je systém prázdný (' + (e.code || e.message) + ').\n\nBez toho se pilotní data nenahrávají — zkus to znovu s připojením.');
    return;
  }
  if (!await potvrd('Nahrát výchozí data pilotních zakázek (Pecka CN20260055, Šaarová CN20260060)?')) return;
  const batchAdd = async (col, data) => (await db.collection(col).add(data)).id;
  const pecka = await batchAdd('projects', {
    kod: '020', cn: 'CN20260055', client: 'Štěpán Pecka', name: 'Novodvorská - Pecka', address: 'Novodvorská 413/135, Praha 4',
    type: 'Kompletní rekonstrukce · 3+kk panelák, 70 m²', resp: 'Zdeno Balúch', stav: 'Realizace', phase: 'Kompletace a montáže zařízení', progress: 79, // = prumer milniku niz
    active: true, gps: { lat: 50.0236914, lng: 14.4368684, tol: 100 }, handover: 'plán předání 24. 7. 2026', driveFolderId: '',
    milestones: [{ t: 'Přípravné práce, demontáže', s: 'done', p: 100 }, { t: 'SDK konstrukce, elektro, ZTI, VZT', s: 'done', p: 100 }, { t: 'Obklady, dlažba, hydroizolace', s: 'done', p: 100 }, { t: 'Nivelace a pokládka vinylu', s: 'done', p: 100 }, { t: 'Malování', s: 'done', p: 100 }, { t: 'Kompletace a montáže zařízení', s: 'now', p: 50 }, { t: 'Úklid a předání', s: 'next', p: 0 }], createdAt: FV()
  });
  const saarova = await batchAdd('projects', {
    kod: '028', cn: 'CN20260060', client: 'Šárka Šaarová', name: 'V Předpolí - Šaarová', address: 'V Předpolí 1472/27, Praha 10',
    type: 'Komplet reko · činžovní dům', resp: 'Zdeno Balúch', stav: 'Realizace', phase: 'Elektro a ZTI — hrubé rozvody', progress: 30, // = prumer milniku niz
    active: true, gps: { lat: 50.0712, lng: 14.4990, tol: 100 }, handover: 'dle harmonogramu', driveFolderId: '',
    milestones: [{ t: 'Přípravné práce, demontáže', s: 'done', p: 100 }, { t: 'Elektro a ZTI — hrubé rozvody', s: 'now', p: 50 }, { t: 'SDK konstrukce', s: 'next', p: 0 }, { t: 'Obklady, dlažba', s: 'next', p: 0 }, { t: 'Podlahy, malování, kompletace', s: 'next', p: 0 }], createdAt: FV()
  });
  const U = [
    { jmeno: 'Ruslan', prijmeni: 'Gorbunov', email: 'gorbunovruslan430@gmail.com', typ: { kanc: 0, teren: 1, inv: 0, sub: 0 }, role: 'Vedoucí party Ruslan', sazba: { h: 300 } },
    { jmeno: 'Vasyl', prijmeni: 'Fedorin', email: 'vasilfedorin0@gmail.com', typ: { kanc: 0, teren: 1, inv: 0, sub: 0 }, role: '', sazba: { h: 275, c: 230 } },
    { jmeno: 'Oleg', prijmeni: 'Starostag', email: 'olegstarostak570@gmail.com', typ: { kanc: 0, teren: 1, inv: 0, sub: 0 }, role: '' },
    { jmeno: 'Lukáš', prijmeni: 'Poštolka', email: 'postolin@gmail.com', typ: { kanc: 0, teren: 0, inv: 0, sub: 1 }, role: 'Subdodavatel — elektro' },
    { jmeno: 'Marek', prijmeni: 'Valečko', email: 'marekvalecko@seznam.cz', typ: { kanc: 0, teren: 0, inv: 0, sub: 1 }, role: 'Subdodavatel — voda / topení' },
    { jmeno: 'DS', prijmeni: 'Podlahy', email: 'dspodlahy@email.cz', typ: { kanc: 0, teren: 0, inv: 0, sub: 1 }, role: 'Subdodavatel — podlahy' },
    { jmeno: 'David', prijmeni: 'Falat', email: 'falyn.ji@seznam.cz', typ: { kanc: 1, teren: 1, inv: 0, sub: 0 }, role: 'Vedoucí projektu' },
    { jmeno: 'Štěpán', prijmeni: 'Pecka', email: 'stepan.pecka@seznam.cz', typ: { kanc: 0, teren: 0, inv: 1, sub: 0 }, role: 'Investor (Novodvorská)' },
    { jmeno: 'Šárka', prijmeni: 'Šaarová', email: 'saarovas@seznam.cz', typ: { kanc: 0, teren: 0, inv: 1, sub: 0 }, role: 'Investor (V Předpolí)' }
  ];
  for (const u of U) {
    /* email jde do admin-only /kontakty, ne do /users (S4) */
    const { sazba, email, ...rest } = u;
    const id = await batchAdd('users', { ...rest, active: true, createdAt: FV() });
    if (sazba) await db.collection('sazby').doc(id).set(sazba);
    if (email) await db.collection('kontakty').doc(id).set({ email, tel: '' });
  }
  await batchAdd('tasks', { title: 'Krytka tlačítka WC — dovézt a domontovat', pid: pecka, resp: 'Marek Valečko', created: isoToday(), term: shiftISO(isoToday(), 1), stav: 'nove', res: ['Marek Valečko'], src: 'z deníku', createdAt: FV() });
  await batchAdd('tasks', { title: 'Fotodokumentace pro předání (Pecka)', pid: pecka, resp: 'David Falat', created: isoToday(), term: shiftISO(isoToday(), 4), stav: 'nove', res: ['David Falat'], createdAt: FV() });
  await batchAdd('tasks', { title: 'Konzultace: hliníkové vedení v ložnici → nacenit vícepráci', pid: saarova, resp: 'Zdeno Balúch', created: isoToday(), term: shiftISO(isoToday(), 2), stav: 'nove', res: ['Zdeno Balúch', 'Lukáš Poštolka'], src: 'z deníku', createdAt: FV() });
  await batchAdd('viceprace', { pid: saarova, title: 'Výměna hliníkového vedení v ložnici', popis: 'Nález z deníku — původní Al vedení pod omítkou, nutná výměna: drážky, kabeláž CYKY, zapravení.', cena: 0, stav: 'navrh', zdroj: 'stavba', createdAt: FV() });
  toast('Výchozí data nahrána ✓ (2 projekty, ' + U.length + ' uživatelů)');
}
/* tlačítko seed na nástěnce, když je systém opravdu prázdný.
   POZOR (S21): nestačí „nemá projekty" — v ostrém systému může vedení
   smazat poslední zakázku, a přitom tam jsou lidi a docházka. Proto se
   ukáže, jen když kromě vedení nikdo neexistuje. Vlastní seedData si to
   ještě jednou ověří přímo v databázi. */
const _origNastenkaPrehled = nastenkaPrehled;
nastenkaPrehled = function () {
  const lideMimoVedeni = S.users.filter(u => !(u.typ || {}).kanc).length;
  if (!S.projects.length && !lideMimoVedeni) return `<main><div class="card"><div class="empty">👋 Systém je prázdný.<br><br>
    <button class="btn amber" onclick="seedData()">📦 Nahrát pilotní zakázky (Pecka + Šaarová)</button>
    <span class="muted" style="display:block;margin-top:8px">nebo založ projekt ručně v sekci Projekty</span></div></div></main>`;
  return _origNastenkaPrehled();
};

/* ============ INIT ============ */
if (CONFIGURED) {
  if (S.portalToken) { startPortal(); render(); }
  else { initAuth(); frontaSpocitat().then(() => frontaOdeslat()); }
} else { render(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(hlidatAktualizace).catch(() => {});
  });
}
/* Majak verze bezi VZDY — i bez service workeru a i na http (lokalni
   nahled). Service worker vyse je jen doprava; o tom, ze existuje nova
   verze, rozhoduje verze.txt. */
window.addEventListener('load', () => {
  setTimeout(zkontrolujVerzi, 3000);
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) zkontrolujVerzi(); });
    setInterval(zkontrolujVerzi, 10 * 60 * 1000);
  }
});

