/* ============================================================
   DENÍK STAVEB — Rekonstrukce Vrána s.r.o.
   Ostrá verze v1 (Etapy 1+2+jádro 3 dle MASTER_PLAN_v4 + dodatky #30–37)
   PWA + Firebase (Auth, Firestore offline) + Google Drive přes Apps Script
   ============================================================ */
'use strict';
const CFG = window.VRANA_CONFIG;
const CONFIGURED = CFG.firebase.apiKey !== 'VYPLNIT';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const DAYS2 = ['NE', 'PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO'];
function isoToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtISO(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return d + '. ' + m + '. ' + y; }
function fmtISOFull(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return DAYS[dt.getDay()] + ' ' + d + '. ' + m + '. ' + y; }
function dchipOf(iso) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return [DAYS2[dt.getDay()], d + '.' + m + '.']; }
function fmtTs(ts) { if (!ts) return '—'; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
function nowTime() { const d = new Date(); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
function daysBetween(isoA, isoB) { return Math.round((new Date(isoB) - new Date(isoA)) / 86400000); }
function shiftISO(iso, days) { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function kc(n) { return (Math.round(n) || 0).toLocaleString('cs-CZ'); }
function fmtH(h) { return Math.floor(h) + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0') + ' h'; }
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
  users: [], projects: [], entries: [], tasks: [], attendance: [], viceprace: [], sazby: {},
  portal: null, portalFeed: [], portalVp: [], portalDocs: [],
  view: 'nastenka', nastenkaTab: 'prehled', adminFilter: null, detail: null,
  projDetailId: null, projDetailTab: 'info', newUserType: null, editUserId: null,
  ukolyView: 'seznam', orgFilter: 'vse', taskFormOpen: false, attFormOpen: false, vpFormOpen: false,
  repWorkers: [], repProjects: [], repLoaded: false, repFrom: isoToday().slice(0, 8) + '01', repTo: isoToday(),
  workerProject: null, draftPhotos: [], draftAtts: [], uploading: 0, signFor: null, tplOpen: false,
  loginMode: 'teren', loginWorker: null,
  online: navigator.onLine, unsub: [],
  denikTab: 'zaznamy', searchQ: ''
};
window.addEventListener('online', () => { S.online = true; render(); });
window.addEventListener('offline', () => { S.online = false; render(); });

/* ---------- data listeners ---------- */
function clearSubs() { S.unsub.forEach(u => { try { u(); } catch (e) {} }); S.unsub = []; }
function listen(col, target, opts) {
  let q = db.collection(col);
  if (opts && opts.where) opts.where.forEach(w => q = q.where(...w));
  S.unsub.push(q.onSnapshot(snap => {
    S[target] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (opts && opts.sort) S[target].sort(opts.sort);
    render();
  }, err => console.warn('listener ' + col, err)));
}
function startData() {
  const role = S.meAuth.role; // 'admin' | 'worker' | 'sub'
  listen('projects', 'projects', { sort: (a, b) => (b.active - a.active) || String(a.kod).localeCompare(String(b.kod)) });
  listen('entries', 'entries', { sort: (a, b) => (b.date || '').localeCompare(a.date || '') || ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0) });
  listen('tasks', 'tasks', { sort: (a, b) => (a.term || '').localeCompare(b.term || '') });
  listen('users', 'users', { sort: (a, b) => (a.prijmeni || '').localeCompare(b.prijmeni || '', 'cs') });
  if (role === 'admin') {
    listen('attendance', 'attendance', { sort: (a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) });
    listen('viceprace', 'viceprace', {});
    S.unsub.push(db.collection('sazby').onSnapshot(s => { S.sazby = {}; s.docs.forEach(d => S.sazby[d.id] = d.data()); render(); }, () => {}));
    // akce investorů ze všech portálů
    S.unsub.push(db.collectionGroup('actions').where('handled', '==', false).onSnapshot(s => {
      s.docs.forEach(d => handlePortalAction(d));
    }, err => console.warn('actions', err)));
  } else {
    listen('attendance', 'attendance', { where: [['authUid', '==', S.authUser.uid]], sort: (a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) });
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
const userById = id => S.users.find(u => u.id === id);
function entriesOf(pid) { return S.entries.filter(e => e.pid === pid); }
function pendingEntries() { return S.entries.filter(e => e.status === 'pending'); }
function isOverdue(t) { return t.stav !== 'hotovo' && t.stav !== 'sablona' && t.term && t.term < isoToday(); }
const STAVY = { nove: 'Nové', probiha: 'Probíhá', kontrola: 'Ke kontrole', hotovo: 'Hotovo' };
const STAVCOLOR = { nove: 'b-int', probiha: 'b-wait', kontrola: 'b-wait', hotovo: 'b-ok' };
const VPSTAV = { navrh: ['b-int', '✏️ čeká na nacenění'], u_investora: ['b-wait', '⏳ u investora'], schvaleno: ['b-ok', '✓ schváleno'], zamitnuto: ['b-red', '✕ zamítnuto'], papir: ['b-ok', '✓ schváleno papírově'] };
function sBadge(s) { return s === 'approved' ? '<span class="badge b-ok">✓ schváleno</span>' : s === 'pending' ? '<span class="badge b-wait">⏳ čeká</span>' : '<span class="badge b-int">🔒 interní</span>'; }

/* ---------- Drive most (Apps Script) ---------- */
async function driveCall(payload) {
  if (!CFG.scriptUrl) throw new Error('Drive most není nastaven (config.js → scriptUrl)');
  const res = await fetch(CFG.scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j;
}
async function uploadPhotoToDrive(p, dataUrl, name) {
  const j = await driveCall({ action: 'upload', folderId: p.driveFolderId || '', rootId: CFG.driveRootFolderId, cn: p.cn, client: p.client, date: isoToday(), name, data: dataUrl.split(',')[1], mime: 'image/jpeg' });
  return j.fileId;
}
function driveViewUrl(id) { return 'https://drive.google.com/file/d/' + id + '/view'; }

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
async function processPhotos(files, label) {
  for (const f of files) {
    try {
      const img = await fileToImage(f);
      const thumb = scaleJpeg(img, 360, 0.62);
      const full = scaleJpeg(img, 1600, 0.82);
      S.draftPhotos.push({ tmp: uid8(), thumb, full, label: label || f.name.replace(/\.[^.]+$/, ''), status: 'pending', driveId: null });
      URL.revokeObjectURL(img.src);
    } catch (e) { toast('Fotku se nepodařilo načíst: ' + f.name); }
  }
  render();
}
async function uploadDraftPhotos(p) {
  // nahraje full verze na Drive (pokud je most), vrátí pole fotek pro záznam
  const out = [];
  for (const ph of S.draftPhotos) {
    let driveId = null;
    if (CFG.scriptUrl && S.online) {
      try { S.uploading++; render(); driveId = await uploadPhotoToDrive(p, ph.full, ph.label); }
      catch (e) { console.warn(e); toast('⚠ Fotka se na Drive nenahrála — uložen jen náhled'); }
      finally { S.uploading--; }
    }
    out.push({ id: uid8(), thumb: ph.thumb, label: ph.label, status: 'pending', driveId });
  }
  S.draftPhotos = [];
  return out;
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
async function uploadDraftAtts(p) {
  const out = [];
  for (const at of (S.draftAtts || [])) {
    if (!CFG.scriptUrl || !S.online) { toast('⚠ Příloha ' + at.name + ' se nenahrála — Drive most / offline'); continue; }
    try {
      S.uploading++; render();
      const j = await driveCall({ action: 'upload', folderId: p.driveFolderId || '', rootId: CFG.driveRootFolderId, cn: p.cn, client: p.client, date: isoToday(), name: at.name, data: at.data.split(',')[1], mime: at.mime || 'application/octet-stream' });
      out.push({ name: at.name, driveId: j.fileId, mime: at.mime || '' });
    } catch (e) { console.warn(e); toast('⚠ Příloha ' + at.name + ' se na Drive nenahrála'); }
    finally { S.uploading--; }
  }
  S.draftAtts = [];
  return out;
}
async function addAttsToEntry(eid, files) {
  const list = [...files]; if (!list.length) return;
  for (const f of list) {
    const e = S.entries.find(x => x.id === eid); if (!e) return;
    const p = proj(e.pid) || {};
    if (f.size > 15 * 1024 * 1024) { toast('Moc velké (max 15 MB): ' + f.name); continue; }
    const data = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    try {
      S.uploading++; render();
      const j = await driveCall({ action: 'upload', folderId: p.driveFolderId || '', rootId: CFG.driveRootFolderId, cn: p.cn, client: p.client, date: e.date, name: f.name, data: data.split(',')[1], mime: f.type || 'application/octet-stream' });
      await db.collection('entries').doc(eid).update({ attachments: [...(e.attachments || []), { name: f.name, driveId: j.fileId, mime: f.type || '' }] });
    } catch (err) { console.warn(err); toast('⚠ ' + f.name + ' se nenahrál (Drive most)'); }
    finally { S.uploading--; render(); }
  }
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
  S.attendance.filter(a => a.pid === pid && a.date === date).forEach(a => {
    const k = a.userDocId || a.userName;
    per[k] = per[k] || { name: a.userName || fullName(userById(a.userDocId) || {}) || '?', prichod: '', odchod: '' };
    if (a.akce === 'Příchod') { if (!per[k].prichod || a.time < per[k].prichod) per[k].prichod = a.time; }
    else { if (!per[k].odchod || a.time > per[k].odchod) per[k].odchod = a.time; }
  });
  return Object.values(per).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

/* ---------- záznamy: workflow ---------- */
async function addEntry(pid, author, txt, persons, date) {
  const p = proj(pid);
  const photos = await uploadDraftPhotos(p);
  const attachments = await uploadDraftAtts(p);
  const works = txt ? txt.split(/[\n]+|(?<=[.!?])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/).map(s => s.trim().replace(/^[-•]\s*/, '')).filter(Boolean) : [];
  const d = date || isoToday();
  const ref = await db.collection('entries').add({
    pid, date: d, createdAt: FV(), author, authorUid: S.authUser.uid,
    persons: persons || 1, works: works.length ? works : ['(jen fotodokumentace)'],
    internal: '', client: txt || 'Fotodokumentace z průběhu prací.', status: 'pending', photos
  });
  if (attachments.length) await db.collection('entries').doc(ref.id).update({ attachments }).catch(() => {});
  fetchWeather(p, d).then(w => { if (w) db.collection('entries').doc(ref.id).update({ weather: w }).catch(() => {}); });
}
async function approveEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  const ta = document.getElementById('ct-' + id);
  const clientTxt = ta ? (ta.value.trim() || e.client) : e.client;
  const photos = (e.photos || []).map(ph => ph.status === 'pending' ? { ...ph, status: 'approved' } : ph);
  await db.collection('entries').doc(id).update({ status: 'approved', client: clientTxt, photos, approvedAt: FV(), approvedBy: fullName(S.me || {}) });
  await mirrorEntry({ ...e, status: 'approved', client: clientTxt, photos });
  notifyMail('entry', e.pid, clientTxt);
  toast('Schváleno — investor teď záznam uvidí ✓');
}
async function keepInternalEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  const photos = (e.photos || []).map(ph => ({ ...ph, status: 'internal' }));
  await db.collection('entries').doc(id).update({ status: 'internal', photos });
  const p = proj(e.pid);
  if (p && p.portalToken) await db.collection('portals').doc(p.portalToken).collection('feed').doc(id).delete().catch(() => {});
  toast('Označeno jako interní — investor neuvidí');
}
async function mirrorEntry(e) {
  // STRUKTURÁLNÍ ZÁRUKA #31: na portál se fyzicky kopíruje JEN klientský text a schválené fotky.
  const p = proj(e.pid);
  if (!p || !p.portalToken) return;
  await db.collection('portals').doc(p.portalToken).collection('feed').doc(e.id).set({
    date: e.date, client: e.client,
    photos: (e.photos || []).filter(ph => ph.status === 'approved').map(ph => ({ thumb: ph.thumb, driveId: ph.driveId || null, label: ph.label || '' }))
  });
}
async function cyclePhoto(eid, phid) {
  const e = S.entries.find(x => x.id === eid); if (!e) return;
  const photos = e.photos.map(ph => ph.id === phid ? { ...ph, status: ph.status === 'pending' ? 'approved' : ph.status === 'approved' ? 'internal' : 'pending' } : ph);
  await db.collection('entries').doc(eid).update({ photos });
  if (e.status === 'approved') await mirrorEntry({ ...e, photos });
}

/* ---------- e-mail notifikace přes Apps Script (volitelné) ---------- */
function notifyMail(kind, pid, text) {
  if (!CFG.scriptUrl) return;
  const p = proj(pid); if (!p || !p.investorEmail) return;
  driveCall({ action: 'notify', to: p.investorEmail, kind, project: p.name, client: p.client, text: (text || '').slice(0, 500), portalUrl: p.portalToken ? location.origin + location.pathname + '?p=' + p.portalToken : '' }).catch(() => {});
}

/* ---------- portal akce (schválení vícepráce investorem) ---------- */
async function handlePortalAction(docSnap) {
  const a = docSnap.data();
  try {
    if (a.type === 'vp' && a.vpid) {
      const ref = db.collection('viceprace').doc(a.vpid);
      const vp = S.viceprace.find(x => x.id === a.vpid);
      if (vp && vp.stav === 'u_investora') {
        const stav = a.action === 'approve' ? 'schvaleno' : 'zamitnuto';
        const podpis = (vp.clientName || '') + (a.action === 'approve' ? ' — schváleno jedním klikem na portálu, ' : ' — zamítnuto na portálu, ') + fmtISO(isoToday());
        await ref.update({ stav, podpis, resolvedAt: FV() });
        const p = proj(vp.pid);
        if (p && p.portalToken) await db.collection('portals').doc(p.portalToken).collection('vp').doc(a.vpid).set({ title: vp.title, popis: vp.popis, cena: vp.cena, stav, podpis }, { merge: true });
        toast(a.action === 'approve' ? '📬 Investor schválil vícepráci: ' + vp.title : '📬 Investor zamítl vícepráci: ' + vp.title);
      }
    }
    await docSnap.ref.update({ handled: true });
  } catch (e) { console.warn('action', e); }
}

/* ============ RENDER ROOT ============ */
function render() {
  const root = $('#root');
  if (!CONFIGURED) { root.innerHTML = viewNotConfigured(); return; }
  if (S.portalToken) { root.innerHTML = viewPortal(); return; }
  if (S.authState === 'loading') { return; }
  if (!S.authUser || !S.meAuth) { root.innerHTML = viewLogin(); return; }
  const role = S.meAuth.role;
  root.innerHTML = (role === 'admin') ? viewAdmin() : viewWorker();
  if (S.signFor) setTimeout(sigInit, 0);
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
    clearSubs();
    S.authUser = u; S.meAuth = null; S.me = null;
    if (u) {
      try {
        let d = await db.collection('users_auth').doc(u.uid).get();
        if (!d.exists) { // krátké čekání — zápis role mohl ještě probíhat
          await new Promise(r => setTimeout(r, 1500));
          d = await db.collection('users_auth').doc(u.uid).get();
        }
        if (d.exists) {
          S.meAuth = d.data();
          const me = await db.collection('users').doc(S.meAuth.userDocId).get();
          S.me = me.exists ? { id: me.id, ...me.data() } : null;
          S.authState = 'in'; startData(); render(); return;
        } else { await auth.signOut(); toast('Účet nemá přiřazenou roli — kontaktuj vedení.'); }
      } catch (e) { console.warn(e); toast('Chyba přihlášení: ' + e.message); await auth.signOut(); }
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
        <button class="${m === 'teren' ? 'active' : ''}" onclick="S.loginMode='teren';render()">👷 Stavba</button>
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
        <label>Kdo jsi?</label>
        <div class="rosterlist">${teren.length ? teren.map(r => `
          <div class="urow" onclick='S.loginWorker=${JSON.stringify({ id: r.id, jmeno: r.jmeno, prijmeni: r.prijmeni, authEmail: r.authEmail }).replace(/'/g, "&#39;")};render()'>
            <span class="uav">${ini(r)}</span><b>${esc(fullName(r))}</b><span class="muted" style="margin-left:auto">${esc(r.popis || '')}</span></div>`).join('')
        : '<div class="empty">Zatím žádní pracovníci.<br><span class="muted">Vedení je založí v sekci Uživatelé.</span></div>'}</div>
      `}
    `}
    <div class="lerr" id="lerr"></div>
    <div class="ls" style="margin-top:14px;margin-bottom:0">${CFG.firmName} · ${S.online ? '' : '⚠ offline'}</div>
  </div></div>`;
}
function lerr(msg) { const e = $('#lerr'); if (e) { e.textContent = msg; e.style.display = 'block'; } }
async function doLogin() {
  try { await auth.signInWithEmailAndPassword($('#li-email').value.trim(), $('#li-pass').value); }
  catch (e) { lerr('Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.'); }
}
async function doWorkerLogin() {
  const pin = $('#li-pin').value.trim();
  if (pin.length < 6) { lerr('PIN má aspoň 6 znaků.'); return; }
  try { await auth.signInWithEmailAndPassword(S.loginWorker.authEmail, pin); }
  catch (e) { lerr('Nesprávný PIN.'); }
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
    const dup = await db.collection('users').where('email', '==', email).get();
    let udocId;
    if (dup.docs.length) {
      udocId = dup.docs[0].id;
      await db.collection('users').doc(udocId).update({ jmeno, prijmeni: rest.join(' '), authEmail: email, uid: cred.user.uid, active: true });
      for (const d of dup.docs.slice(1)) await d.ref.delete().catch(() => {});
    } else {
      const udoc = await db.collection('users').add({ jmeno, prijmeni: rest.join(' '), email, kod: '001', typ: { kanc: 1, teren: 1, inv: 0, sub: 0 }, role: 'Admin · vedení', skupina: '', active: true, authEmail: email, uid: cred.user.uid, notU: 1, notD: 1 });
      udocId = udoc.id;
    }
    await db.collection('users_auth').doc(cred.user.uid).set({ role: 'admin', userDocId: udocId, name });
    await db.collection('roster').doc(udocId).set({ jmeno, prijmeni: rest.join(' '), authEmail: email, role: 'admin', popis: 'vedení' });
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
function doLogout() { auth.signOut(); }

/* ============ ADMIN (Vedení) ============ */
function topbar() {
  return `<div class="topbar">
    <span class="logo">🏗 REKONSTRUKCE <em>VRÁNA</em> <span style="color:#8b98a5;font-weight:500">· Deník staveb</span></span>
    <span class="sp"></span>
    <span class="offdot ${S.online ? '' : 'off'}">${S.online ? '' : '⚠ OFFLINE — změny se uloží po připojení'}</span>
    ${S.uploading ? '<span class="badge b-wait">📤 nahrávám fotky…</span>' : ''}
    <div class="avatar" title="Odhlásit" onclick="if(confirm('Odhlásit se?'))doLogout()">${S.me ? ini(S.me) : '?'}</div>
  </div>`;
}
function sidebar() {
  const n = pendingEntries().length;
  const gpsBad = S.attendance.filter(a => a.gps > (CFG.gpsTolerance || 100)).length;
  const items = [
    { k: 'nastenka', ic: '📊', t: 'Nástěnka' },
    { k: 'projekty', ic: '🛠️', t: 'Projekty' },
    { k: 'denik', ic: '📓', t: 'Stavební deník' },
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
  let body = nt === 'dochazka' ? nastenkaDochazka() : nt === 'ukoly' ? nastenkaUkoly() : nastenkaPrehled();
  return `
  <div class="strip"><h1>Nástěnka</h1><span class="sp"></span><span class="muted">${fmtISOFull(isoToday())}</span></div>
  <div class="sectabs">
    <div class="t ${nt === 'prehled' ? 'active' : ''}" onclick="S.nastenkaTab='prehled';render()">📊 Přehled</div>
    <div class="t ${nt === 'dochazka' ? 'active' : ''}" onclick="S.nastenkaTab='dochazka';render()">⏱ Docházka</div>
    <div class="t ${nt === 'ukoly' ? 'active' : ''}" onclick="S.nastenkaTab='ukoly';render()">📌 Úkoly ${S.tasks.filter(isOverdue).length ? `<span class="badge b-red">${S.tasks.filter(isOverdue).length}</span>` : ''}</div>
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
      <div class="stat" onclick="goPage('denik')"><span class="sic">📓</span><span class="st2">Denní záznamy celkem</span><span class="sn">${S.entries.length}</span></div>
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
  S.attendance.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).forEach(a => last[a.userDocId] = a);
  const inWork = Object.values(last).filter(a => a.akce === 'Příchod' && a.date === isoToday());
  const susp = S.attendance.filter(a => a.gps > TOL);
  const teren = S.users.filter(u => u.typ && u.typ.teren && !u.typ.kanc && u.active !== false);
  return `<main>
    <div class="stats">
      <div class="stat"><span class="sic">💼</span><span class="st2">V práci teď</span><span class="sn">${inWork.length}</span></div>
      <div class="stat"><span class="sic">🏠</span><span class="st2">Nepřítomní</span><span class="sn">${Math.max(0, teren.length - inWork.length)}</span></div>
      <div class="stat" onclick="S.orgFilter='gps';goPage('organizace')"><span class="sic">📍</span><span class="st2">Podezřelá GPS (&gt;${TOL} m)</span><span class="sn ${susp.length ? 'warn' : ''}">${susp.length}</span></div>
      <div class="stat" onclick="goPage('organizace')"><span class="sic">🗂</span><span class="st2">Záznamů docházky</span><span class="sn">${S.attendance.length}</span></div>
    </div>
    <div class="card">
      <h3>💼 Stavy pracovníků — kdo je kde</h3>
      ${teren.map(u => { const a = last[u.id]; const on = a && a.akce === 'Příchod' && a.date === isoToday(); const ap = a ? proj(a.pid) : null; return `
        <div class="urow"><span class="uav">${ini(u)}</span><b>${esc(fullName(u))}</b>
        ${on ? `<span class="badge b-ok">✓ v práci — ${esc((ap || {}).name || '')} (od ${a.time})</span>` : `<span class="badge b-int">nepřítomen</span>`}
        <span class="muted" style="margin-left:auto">${a ? `poslední: ${a.akce} ${fmtISO(a.date)} ${a.time}${a.gps > TOL ? ' <b style="color:var(--red)">⚠ GPS ' + a.gps.toLocaleString('cs') + ' m</b>' : ''}` : 'žádný záznam'}</span></div>`; }).join('') || '<div class="empty">Žádní terénní pracovníci.</div>'}
      <div class="note">Podezřelé GPS odchylky (nad ${TOL} m) se hlásí rovnou tady — detail v Organizace.</div>
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
        <div class="urow"><span style="color:var(--red)">❗</span><div><b>${esc(t.title)}</b><br><span class="muted">${esc((proj(t.pid) || {}).name || '')} · ${esc(t.resp || '')} · termín ${fmtISO(t.term)} <b style="color:var(--red)">(${daysBetween(t.term, isoToday())} dní po termínu)</b></span></div>
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
    <div class="tablecard">
      <div style="overflow-x:auto"><table>
        <tr><th>Kód</th><th>Název stavby</th><th>Zodpovědný</th><th>Aktivní</th><th>Stav</th><th>Zakázka</th><th>Investor</th><th>Adresa</th><th>Deník</th><th>Průběh</th></tr>
        ${S.projects.map(p => `
        <tr class="click" onclick="openProj('${p.id}')">
          <td>${esc(p.kod)}</td>
          <td><span class="lnk">${esc(p.name)}</span></td>
          <td class="muted">${esc(p.resp || '')}</td>
          <td onclick="event.stopPropagation();toggleActive('${p.id}')"><span class="toggle ${p.active ? 'on' : ''}"><i></i></span></td>
          <td>${esc(p.stav || '')}</td>
          <td>${esc((p.cn || '').replace('CN', ''))}</td>
          <td>${esc(p.client || '')}</td>
          <td class="muted">${esc(p.address || '')}</td>
          <td onclick="event.stopPropagation();S.adminFilter='${p.id}';goPage('denik')"><span class="lnk">📓 otevřít</span></td>
          <td style="min-width:110px"><div class="prog"><i style="width:${p.progress || 0}%"></i></div><span class="muted" style="font-size:11px">${p.progress || 0} % · ${esc(p.phase || '')}</span></td>
        </tr>`).join('')}
      </table></div>
      <div class="pagefoot"><span>${S.projects.length} projektů</span></div>
    </div>
  </main>`;
}
async function toggleActive(pid) { const p = proj(pid); await db.collection('projects').doc(pid).update({ active: !p.active }); }
function openProj(id) { S.projDetailId = id; S.projDetailTab = 'info'; S.view = 'projdetail'; render(); }
function projectForm(id) {
  const p = id ? proj(id) : {};
  modal(`<h3>${id ? '✏️ Upravit projekt' : '➕ Nový projekt'}</h3>
    <label>Název stavby *</label><input type="text" id="pf-name" value="${esc(p.name || '')}" placeholder="Novodvorská - Pecka">
    <div class="frow">
      <div><label>Kód stavby</label><input type="text" id="pf-kod" value="${esc(p.kod || '')}" placeholder="020"></div>
      <div><label>Číslo zakázky (CN)</label><input type="text" id="pf-cn" value="${esc(p.cn || '')}" placeholder="CN20260055"></div>
    </div>
    <label>Investor</label><input type="text" id="pf-client" value="${esc(p.client || '')}">
    <label>E-mail investora (notifikace portálu)</label><input type="email" id="pf-cmail" value="${esc(p.investorEmail || '')}">
    <label>Adresa</label><input type="text" id="pf-addr" value="${esc(p.address || '')}">
    <label>Typ projektu</label><input type="text" id="pf-type" value="${esc(p.type || '')}" placeholder="Kompletní rekonstrukce · 3+kk panelák">
    <div class="frow">
      <div><label>Zodpovědný</label><input type="text" id="pf-resp" value="${esc(p.resp || 'Zdeno Balúch')}"></div>
      <div><label>Stav projektu</label><select id="pf-stav">${['Realizace', 'Příprava', 'Nabídka', 'Dokončeno'].map(s => `<option ${p.stav === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="frow">
      <div><label>Fáze</label><input type="text" id="pf-phase" value="${esc(p.phase || '')}" placeholder="Hrubé rozvody"></div>
      <div><label>Průběh (%)</label><input type="number" id="pf-prog" value="${p.progress || 0}" min="0" max="100"></div>
    </div>
    <div class="frow">
      <div><label>GPS lat</label><input type="text" id="pf-lat" value="${p.gps ? p.gps.lat : ''}" placeholder="50.0236914"></div>
      <div><label>GPS lng</label><input type="text" id="pf-lng" value="${p.gps ? p.gps.lng : ''}" placeholder="14.4368684"></div>
    </div>
    <label>ID složky zakázky na Drive (pro fotky)</label><input type="text" id="pf-drive" value="${esc(p.driveFolderId || '')}" placeholder="nech prázdné — vytvoří se automaticky">
    <label>Plán předání</label><input type="text" id="pf-hand" value="${esc(p.handover || '')}" placeholder="plán předání 24. 7. 2026">
    <div class="aprv"><button class="btn amber" onclick="saveProject('${id || ''}')">💾 Uložit</button><button class="btn ghost" onclick="closeModal()">Zrušit</button></div>`);
}
async function saveProject(id) {
  const name = $('#pf-name').value.trim();
  if (!name) { toast('Vyplň název stavby'); return; }
  const lat = parseFloat($('#pf-lat').value), lng = parseFloat($('#pf-lng').value);
  const data = {
    name, kod: $('#pf-kod').value.trim(), cn: $('#pf-cn').value.trim(), client: $('#pf-client').value.trim(),
    investorEmail: $('#pf-cmail').value.trim(), address: $('#pf-addr').value.trim(), type: $('#pf-type').value.trim(),
    resp: $('#pf-resp').value.trim(), stav: $('#pf-stav').value, phase: $('#pf-phase').value.trim(),
    progress: Math.min(100, Math.max(0, parseInt($('#pf-prog').value) || 0)),
    gps: (lat && lng) ? { lat, lng, tol: CFG.gpsTolerance || 100 } : null,
    driveFolderId: $('#pf-drive').value.trim(), handover: $('#pf-hand').value.trim()
  };
  if (id) await db.collection('projects').doc(id).update(data);
  else await db.collection('projects').add({ ...data, active: true, milestones: [], createdAt: FV() });
  closeModal(); toast('Projekt uložen ✓');
}

/* ---- Detail projektu ---- */
function pgProjDetail() {
  const p = proj(S.projDetailId);
  if (!p) return '<main><div class="empty">Projekt nenalezen.</div></main>';
  const t = S.projDetailTab;
  let body = '';
  if (t === 'info') {
    const portalUrl = p.portalToken ? location.origin + location.pathname + '?p=' + p.portalToken : null;
    body = `<main><div class="grid2">
      <div class="card">
        <h3>ℹ️ Základní informace</h3>
        <div class="kv"><span>Název</span><b>${esc(p.name)}</b></div>
        <div class="kv"><span>Zakázka</span><b>${esc(p.cn)}</b></div>
        <div class="kv"><span>Investor</span><span>${esc(p.client)} ${p.investorEmail ? '· ' + esc(p.investorEmail) : ''}</span></div>
        <div class="kv"><span>Adresa</span><span>${esc(p.address)}</span></div>
        <div class="kv"><span>Typ</span><span>${esc(p.type || '—')}</span></div>
        <div class="kv"><span>Stav</span><span>${esc(p.stav)} · ${esc(p.phase || '')} (${p.progress || 0} %)</span></div>
        <div class="kv"><span>Drive složka</span><span>${p.driveFolderId ? `<a href="https://drive.google.com/drive/folders/${p.driveFolderId}" target="_blank">📁 otevřít</a>` : '<span class="muted">vytvoří se s první fotkou</span>'}</span></div>
        <div class="aprv"><button class="btn amber" onclick="projectForm('${p.id}')">✏️ Upravit</button></div>
      </div>
      <div class="card">
        <h3>📍 Pozice projektu (GPS check-in)</h3>
        <div class="mapbox"><span class="pin">📍</span><b>${esc(p.address)}</b>
          <span>${p.gps ? `GPS: ${p.gps.lat}, ${p.gps.lng} · povolená odchylka ${p.gps.tol || 100} m` : '⚠ GPS není nastavena — check-in nebude ověřovat polohu'}</span>
          ${p.gps ? `<a href="https://mapy.cz/turisticka?q=${p.gps.lat}%2C${p.gps.lng}" target="_blank" class="lnk">otevřít na mapě</a>` : ''}</div>
        <div class="aprv"><button class="btn ghost sm" onclick="gpsFromHere('${p.id}')">◎ Nastavit GPS podle mojí polohy</button></div>
      </div>
      <div class="card">
        <h3>🏠 Portál investora</h3>
        ${portalUrl ? `
          <div class="note" style="word-break:break-all">🔗 <b>${portalUrl}</b></div>
          <div class="aprv">
            <button class="btn amber sm" onclick="navigator.clipboard.writeText('${portalUrl}').then(()=>toast('Odkaz zkopírován ✓'))">📋 Kopírovat odkaz</button>
            <button class="btn ghost sm" onclick="window.open('${portalUrl}','_blank')">👁 Náhled portálu</button>
          </div>
          <div class="note">Investor vidí jen schválené zápisy a fotky (#31). Odkaz mu pošli e-mailem — bez instalace a hesla.</div>`
        : `<div class="empty">Portál zatím není vytvořen.</div>
          <div class="aprv"><button class="btn amber" onclick="createPortal('${p.id}')">🔗 Vytvořit portál investora</button></div>`}
      </div>
      <div class="card">
        <h3>📅 Harmonogram — milníky</h3>
        ${(p.milestones || []).map((m, i) => `<div class="mile ${m.s}"><div class="dot" style="cursor:pointer" onclick="cycleMile('${p.id}',${i})">${m.s === 'done' ? '✓' : m.s === 'now' ? '●' : ''}</div><div style="flex:1">${m.s === 'now' ? '<b>' + esc(m.t) + ' — probíhá</b>' : esc(m.t)}</div><span class="lnk" style="font-size:11px" onclick="delMile('${p.id}',${i})">✕</span></div>`).join('') || '<div class="empty">Zatím žádné milníky.</div>'}
        <div class="aprv"><input type="text" id="mile-t" placeholder="Nový milník…" style="max-width:260px"><button class="btn ghost sm" onclick="addMile('${p.id}')">➕ Přidat</button></div>
        <div class="note">Klik na kolečko přepíná stav: čeká → probíhá → hotovo. Milníky vidí investor na portálu.</div>
      </div>
    </div></main>`;
  } else if (t === 'media') {
    const phs = entriesOf(p.id).flatMap(e => (e.photos || []).map(ph => ({ ...ph, eid: e.id, date: e.date, author: e.author, epending: e.status === 'pending' })));
    const byDate = {};
    phs.forEach(ph => (byDate[ph.date] = byDate[ph.date] || []).push(ph));
    body = `<main><div class="card">
      <h3>🖼 Všechna média na stavbě (${phs.length})</h3>
      ${Object.entries(byDate).map(([d, list]) => `
        <label>${fmtISO(d)} · ${esc(list[0].author || '')}</label>
        <div class="photos">${list.map(ph => phTile(ph, false, ph.eid)).join('')}</div>`).join('') || '<div class="empty">Zatím žádná média.</div>'}
      <div class="note">Výchozí stav fotky je vždy „⏳ čeká" — k investorovi jde až po schválení (#31). Klik na fotku = otevřít, klik na štítek stavu = přepnout ⏳→✓→🔒. Plné rozlišení bydlí na Drive ve složce zakázky.</div>
    </div></main>`;
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
      ${tk.map(x => `<div class="urow"><span>${x.stav === 'hotovo' ? '✅' : isOverdue(x) ? '❗' : '📌'}</span><div><b>${esc(x.title)}</b><br><span class="muted">${esc(x.resp || '')} · termín ${fmtISO(x.term)}</span></div>
        <span style="margin-left:auto"><span class="badge ${STAVCOLOR[x.stav]}">${STAVY[x.stav]}</span></span></div>`).join('') || '<div class="empty">Žádné úkoly.</div>'}
      <div class="aprv"><button class="btn amber sm" onclick="S.taskFormOpen=true;goPage('ukoly')">➕ Přidat úkol</button></div>
    </div></main>`;
  } else if (t === 'poznamky') {
    body = `<main><div class="card">
      <h3>📝 Poznámky k projektu</h3>
      ${(p.notes || []).map(n => `<div class="urow"><span>📝</span><div><b>${esc(n.author)}</b> · <span class="muted">${fmtISO(n.date)}</span><br>${esc(n.text)}</div></div>`).join('') || '<div class="empty">Zatím žádné poznámky.</div>'}
      <label>Nová poznámka</label><textarea id="pn-t" style="min-height:60px"></textarea>
      <div class="aprv"><button class="btn amber sm" onclick="addNote('${p.id}')">💾 Uložit poznámku</button></div>
    </div></main>`;
  } else if (t === 'dokumenty') {
    body = pgProjDocs(p);
  }
  return `
  <div class="strip"><span class="back" onclick="goPage('projekty')">←</span><h1>${esc(p.name)}</h1><span class="sp"></span></div>
  <div class="sectabs">
    <div class="t ${t === 'info' ? 'active' : ''}" onclick="S.projDetailTab='info';render()">ℹ️ Základní informace</div>
    <div class="t ${t === 'media' ? 'active' : ''}" onclick="S.projDetailTab='media';render()">🖼 Média</div>
    <div class="t ${t === 'podklady' ? 'active' : ''}" onclick="S.projDetailTab='podklady';render()">📐 Podklady stavby (${(p.stavbaDocs || []).length})</div>
    <div class="t ${t === 'dokumenty' ? 'active' : ''}" onclick="S.projDetailTab='dokumenty';render()">📁 Dokumenty pro investora</div>
    <div class="t ${t === 'ukoly' ? 'active' : ''}" onclick="S.projDetailTab='ukoly';render()">📌 Úkoly (${S.tasks.filter(x => x.pid === p.id && x.stav !== 'hotovo' && x.stav !== 'sablona').length})</div>
    <div class="t ${t === 'poznamky' ? 'active' : ''}" onclick="S.projDetailTab='poznamky';render()">📝 Poznámky</div>
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
      const j = await driveCall({ action: 'upload', folderId: p.driveFolderId || '', rootId: CFG.driveRootFolderId, cn: p.cn, client: p.client, date: isoToday(), name: f.name, data: data.split(',')[1], mime: f.type || 'application/octet-stream' });
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
  toast('Podklad přidán ✓');
}
async function delStavbaDoc(pid, i) {
  const p = proj(pid); const docs = (p.stavbaDocs || []).slice(); docs.splice(i, 1);
  await db.collection('projects').doc(pid).update({ stavbaDocs: docs });
}
async function addPortalDoc(pid) {
  const p = proj(pid);
  const title = $('#pd-title').value.trim();
  let raw = $('#pd-id').value.trim();
  const m = raw.match(/[-\w]{25,}/);
  if (!title || !m) { toast('Vyplň název a Drive ID/odkaz'); return; }
  const docs = [...(p.portalDocs || []), { title, driveId: m[0], mime: '' }];
  await db.collection('projects').doc(pid).update({ portalDocs: docs });
  if (p.portalToken) await db.collection('portals').doc(p.portalToken).collection('docs').add({ title, driveId: m[0] });
  toast('Dokument přidán na portál ✓');
}
async function delPortalDoc(pid, i) {
  const p = proj(pid);
  const docs = (p.portalDocs || []).slice(); const rm = docs.splice(i, 1)[0];
  await db.collection('projects').doc(pid).update({ portalDocs: docs });
  if (p.portalToken && rm) {
    const s = await db.collection('portals').doc(p.portalToken).collection('docs').where('driveId', '==', rm.driveId).get();
    s.docs.forEach(d => d.ref.delete());
  }
}
async function createPortal(pid) {
  const p = proj(pid);
  const token = uid8() + uid8().slice(0, 10);
  await db.collection('portals').doc(token).set({ pid, client: p.client || '', name: p.name, createdAt: FV() });
  await db.collection('projects').doc(pid).update({ portalToken: token });
  // zrcadli už schválené záznamy
  for (const e of entriesOf(pid).filter(x => x.status === 'approved')) {
    await db.collection('portals').doc(token).collection('feed').doc(e.id).set({
      date: e.date, client: e.client,
      photos: (e.photos || []).filter(ph => ph.status === 'approved').map(ph => ({ thumb: ph.thumb, driveId: ph.driveId || null, label: ph.label || '' }))
    });
  }
  for (const d of (p.portalDocs || [])) await db.collection('portals').doc(token).collection('docs').add({ title: d.title, driveId: d.driveId });
  toast('Portál vytvořen ✓ — odkaz najdeš v detailu projektu');
}
function gpsFromHere(pid) {
  if (!navigator.geolocation) { toast('Zařízení nedává polohu'); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    await db.collection('projects').doc(pid).update({ gps: { lat: +pos.coords.latitude.toFixed(7), lng: +pos.coords.longitude.toFixed(7), tol: CFG.gpsTolerance || 100 } });
    toast('GPS nastavena podle aktuální polohy ✓');
  }, () => toast('Polohu se nepodařilo zjistit'), { enableHighAccuracy: true, timeout: 10000 });
}
// FIX: průběh (%) a fáze se přepočítají z milníků při každé změně.
// Vzorec: hotový milník = plná váha, probíhající = poloviční. Fáze = první probíhající milník;
// když jsou všechny hotové → „Dokončeno". Bez milníků se průběh nemění (zůstává ruční).
function msRecalc(ms, p) {
  if (!ms || !ms.length) return {};
  const done = ms.filter(m => m.s === 'done').length, now = ms.filter(m => m.s === 'now').length;
  const progress = Math.round((done + now * 0.5) / ms.length * 100);
  const firstNow = ms.find(m => m.s === 'now');
  const phase = firstNow ? firstNow.t : (done === ms.length ? 'Dokončeno' : (p.phase || ''));
  return { progress, phase };
}
async function cycleMile(pid, i) {
  const p = proj(pid); const ms = (p.milestones || []).slice();
  ms[i].s = ms[i].s === 'next' ? 'now' : ms[i].s === 'now' ? 'done' : 'next';
  await db.collection('projects').doc(pid).update({ milestones: ms, ...msRecalc(ms, p) });
}
async function addMile(pid) {
  const t = $('#mile-t').value.trim(); if (!t) return;
  const p = proj(pid); const ms = [...(p.milestones || []), { t, s: 'next' }];
  await db.collection('projects').doc(pid).update({ milestones: ms, ...msRecalc(ms, p) });
}
async function delMile(pid, i) {
  const p = proj(pid); const ms = (p.milestones || []).slice(); ms.splice(i, 1);
  await db.collection('projects').doc(pid).update({ milestones: ms, ...msRecalc(ms, p) });
}
async function addNote(pid) {
  const t = $('#pn-t').value.trim(); if (!t) { toast('Napiš text poznámky'); return; }
  const p = proj(pid);
  await db.collection('projects').doc(pid).update({ notes: [{ date: isoToday(), author: fullName(S.me || {}), text: t }, ...(p.notes || [])] });
  toast('Poznámka uložena ✓');
}

/* ---- fotka: dlaždice ---- */
function phTile(ph, clientView, eid) {
  const st = clientView ? '' : `<span class="st" ${eid ? `onclick="event.stopPropagation();cyclePhoto('${eid}','${ph.id}')"` : ''}>${ph.status === 'approved' ? '✓' : ph.status === 'pending' ? '⏳' : '🔒'}</span>`;
  return `<div class="ph" onclick="openPhoto('${ph.driveId || ''}','${esc(ph.label)}',this)">
    <img src="${ph.thumb}" alt="">${st}<small>${esc(ph.label || '')}</small></div>`;
}
function openPhoto(driveId, label, el) {
  const img = el ? el.querySelector('img') : null;
  const src = img ? img.src : '';
  $('#viewer').innerHTML = `<div class="viewer" onclick="if(event.target===this)closeDoc()"><div class="vwrap">
    <div class="vhead"><b style="flex:1;min-width:120px">${label}</b>
      ${driveId ? `<a class="btn ghost sm" href="${driveViewUrl(driveId)}" target="_blank">📁 Plné rozlišení (Drive)</a>` : '<span class="badge b-int">jen náhled</span>'}
      <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
    <div class="vbody" style="padding:0;align-items:center"><img src="${src}" style="width:100%;max-height:80vh"></div></div></div>`;
}
function closeDoc() { $('#viewer').innerHTML = ''; }
function openDriveDoc(driveId, title) {
  $('#viewer').innerHTML = `<div class="viewer" onclick="if(event.target===this)closeDoc()"><div class="vwrap">
    <div class="vhead"><b style="flex:1;min-width:120px">${esc(title)}</b>
      <a class="btn ghost sm" href="${driveViewUrl(driveId)}" target="_blank">📁 Otevřít na Drive</a>
      <button class="btn dark sm" onclick="closeDoc()">✕ Zavřít</button></div>
    <div class="vbody"><iframe src="https://drive.google.com/file/d/${driveId}/preview" allow="autoplay"></iframe></div></div></div>`;
}
function modal(html) { $('#modal').innerHTML = `<div class="modal" onclick="if(event.target===this)closeModal()"><div class="mbox">${html}</div></div>`; }
function closeModal() { $('#modal').innerHTML = ''; }

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
      <div class="tabletools"><div class="search"><input placeholder="Hledat v záznamech" value="${esc(S.searchQ)}" oninput="S.searchQ=this.value;render();this.focus();this.setSelectionRange(this.value.length,this.value.length)"></div></div>
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
          <div class="chip-author">👷 ${esc(e.author)} · ${e.persons || 1} os.</div>
          ${e.weather ? `<div class="muted" style="margin:6px 0 2px">🌤 ${esc(e.weather)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center"><h3>Provedené práce</h3>${sBadge(e.status)}</div>
          <ul class="worklist">${(e.works || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
          ${e.internal ? `<div class="inote">🔒 <b>Interní poznámka</b> (investor nikdy neuvidí): ${esc(e.internal)}
            <div style="margin-top:6px"><button class="btn ghost sm" onclick="noteToTask('${e.id}')">📌 Převést na úkol</button></div></div>` : `
            <div class="aprv"><input type="text" id="int-${e.id}" placeholder="Přidat interní poznámku…" style="max-width:320px"><button class="btn ghost sm" onclick="addInternal('${e.id}')">🔒 Uložit interní</button></div>`}
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
              ? `<div>${esc(e.client).replace(/\n/g, '<br>')}</div><div class="note" style="margin-top:10px">Investor tento text vidí na svém portálu ✓ ${e.approvedBy ? '· schválil(a) ' + esc(e.approvedBy) : ''}</div>`
              : `<div class="muted">Záznam je interní — investor jej nevidí.</div><div class="aprv"><button class="btn ok sm" onclick="db.collection('entries').doc('${e.id}').update({status:'pending'}).then(render)">↩ Vrátit ke schválení</button></div>`}
        </div>
        <div class="card">
          <h3>👥 Osoby na staveništi <span class="muted" style="font-weight:400">— z docházky</span></h3>
          ${(() => { const os = attOn(e.pid, e.date); return os.length ? os.map(o => `<div class="kv"><span>${esc(o.name)}</span><b>${o.prichod || '—'} – ${o.odchod || '—'}</b></div>`).join('') : '<div class="muted">K tomuto dni není v systému docházka.</div>'; })()}
        </div>
        <div class="card">
          <h3>📎 Přílohy</h3>
          ${(e.attachments || []).map(a => `<div class="urow" style="cursor:pointer" onclick="openDriveDoc('${a.driveId}','${esc(a.name)}')"><span>${(a.mime || '').includes('pdf') ? '📄' : '🖼'}</span><b>${esc(a.name)}</b><span class="muted" style="margin-left:auto">zobrazit</span></div>`).join('') || '<div class="muted">Žádné přílohy.</div>'}
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
          <div class="kv"><span>Fáze</span><span>${esc(p.phase || '')} (${p.progress || 0} %)</span></div>
        </div>
      </div>
    </div>
  </main>`;
}
async function addInternal(eid) {
  const t = $('#int-' + eid).value.trim(); if (!t) return;
  await db.collection('entries').doc(eid).update({ internal: t });
}
async function noteToTask(eid) {
  const e = S.entries.find(x => x.id === eid);
  await db.collection('tasks').add({ title: e.internal.split('—')[0].trim().slice(0, 120), pid: e.pid, resp: fullName(S.me || {}), created: isoToday(), term: shiftISO(isoToday(), 2), stav: 'nove', res: [fullName(S.me || {})], src: 'z deníku ' + fmtISO(e.date), createdAt: FV() });
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
        ${e.internal ? `<div class="inote">🔒 ${esc(e.internal)}</div>` : ''}
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
function printDenik() {
  const pid = $('#pr-p').value, verze = $('#pr-v').value, from = $('#pr-f').value, to = $('#pr-t').value;
  const p = proj(pid); if (!p) { toast('Vyber projekt'); return; }
  let list = S.entries.filter(e => e.pid === pid);
  if (verze === 'klient') list = list.filter(e => e.status === 'approved');
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);
  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!list.length) { toast('Žádné záznamy pro zvolený výběr'); return; }
  const perioda = (from || to) ? `${from ? fmtISO(from) : '…'} – ${to ? fmtISO(to) : '…'}` : `${fmtISO(list[0].date)} – ${fmtISO(list[list.length - 1].date)}`;
  const bloky = list.map(e => `
    <div class="zaznam">
      <div class="zhead"><b>${fmtISOFull(e.date)}</b><span>${esc(e.author)}${e.persons ? ' · osob na staveništi: ' + e.persons : ''}${e.status === 'approved' ? '' : e.status === 'internal' ? ' · INTERNÍ' : ' · neschváleno'}</span></div>
      ${e.weather ? `<div class="meta">Počasí: ${esc(e.weather)}</div>` : ''}
      ${(() => { const os = attOn(e.pid, e.date); return os.length ? `<div class="meta">Na staveništi: ${os.map(o => esc(o.name) + (o.prichod || o.odchod ? ' (' + (o.prichod || '—') + '–' + (o.odchod || '—') + ')' : '')).join(', ')}</div>` : ''; })()}
      <ul>${(e.works || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      ${(e.attachments || []).length ? `<div class="meta">Přílohy: ${e.attachments.map(a => esc(a.name)).join(', ')}</div>` : ''}
      ${e.podpis ? `<div class="zpodpis"><img src="${e.podpis.img}">podepsáno: ${esc(e.podpis.jmeno)} · ${fmtISO(e.podpis.at)}</div>` : ''}
      ${verze === 'komplet' && e.internal ? `<div class="interni">Interní poznámka: ${esc(e.internal)}</div>` : ''}
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
  const w = window.open('', '_blank');
  if (!w) { toast('Prohlížeč zablokoval nové okno — povol vyskakovací okna'); return; }
  w.document.write(html); w.document.close();
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
      <select id="na">${S.users.filter(u => u.active !== false && u.typ && (u.typ.teren || u.typ.kanc)).map(u => `<option ${S.me && u.id === S.me.id ? 'selected' : ''}>${esc(fullName(u))}</option>`).join('')}</select>
      <div class="frow">
        <div><label>Datum zápisu</label><input type="date" id="nd" value="${isoToday()}" max="${isoToday()}"></div>
        <div><label>Počet osob na staveništi</label><input type="number" id="npers" value="1" min="1"></div>
      </div>
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
  const pid = $('#np').value, author = $('#na').value, txt = $('#nt').value.trim(), pers = parseInt($('#npers').value) || 1;
  const date = $('#nd') ? ($('#nd').value || isoToday()) : isoToday();
  if (!pid) { toast('Není vybraný projekt'); return; }
  if (date > isoToday()) { toast('Datum zápisu nemůže být v budoucnosti'); return; }
  if (!txt && !S.draftPhotos.length) { toast('Napiš text nebo přidej fotku'); return; }
  $('#save-entry').disabled = true;
  await addEntry(pid, author, txt, pers, date);
  goPage('denik'); toast(date === isoToday() ? 'Záznam uložen — čeká na schválení ✓' : 'Záznam za ' + fmtISO(date) + ' uložen — čeká na schválení ✓');
}

/* ---- Organizace — docházka ---- */
function pgOrganizace() {
  const TOL = CFG.gpsTolerance || 100;
  const f = S.orgFilter;
  let rows = S.attendance.slice();
  if (f === 'gps') rows = rows.filter(a => a.gps > TOL);
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
    <div class="t ${f === 'gps' ? 'active' : ''}" onclick="S.orgFilter='gps';render()">📍 Podezřelá GPS (${S.attendance.filter(a => a.gps > TOL).length})</div>
  </div>
  <main>
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
        <tr><th>Terénní pracovník</th><th>Skupina</th><th>Činnost</th><th>Na projektu</th><th>Datum a čas</th><th>GPS odchylka</th><th>Foto</th></tr>
        ${rows.map(a => { const u = userById(a.userDocId) || { jmeno: a.userName || '?', prijmeni: '' }; return `
        <tr>
          <td><span class="uav" style="margin-right:6px">${ini(u)}</span>${esc(fullName(u))}</td>
          <td class="muted">${esc(u.skupina || '—')}</td>
          <td><span class="badge ${a.akce === 'Příchod' ? 'b-ok' : 'b-int'}">${a.akce}</span></td>
          <td>${esc((proj(a.pid) || {}).name || a.projName || '')}</td>
          <td>${fmtISO(a.date)} ${a.time}</td>
          <td>${a.gps == null ? '<span class="muted">bez GPS</span>' : a.gps > TOL ? `<b style="color:var(--red)">⚠ ${a.gps.toLocaleString('cs')} m</b>` : `<span class="muted">${a.gps} m</span>`}</td>
          <td>${a.selfie ? `<img src="${a.selfie}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="openPhoto('','ověřovací foto',this.parentElement)">` : a.manual ? '<span class="badge b-wait">admin</span>' : '<b style="color:var(--red)">chybí</b>'}</td>
        </tr>`; }).join('')}
      </table></div>
      <div class="pagefoot"><span>${rows.length} záznamů</span></div>
    </div>
    <div class="note">GPS nad povolenou odchylku (${TOL} m) se flaguje ⚠ a chybějící ověřovací foto je vidět hned. Měsíční kontrola hodin Ruslana (#25) = záložka Reporty.</div>
  </main>`;
}
async function addAtt() {
  const userDocId = $('#at-u').value, pid = $('#at-p').value, akce = $('#at-a').value;
  const date = $('#at-d').value || isoToday(), time = $('#at-t').value || '07:00';
  const u = userById(userDocId);
  await db.collection('attendance').add({ userDocId, userName: fullName(u), authUid: S.authUser.uid, akce, pid, date, time, gps: null, selfie: null, manual: true, createdAt: FV() });
  S.attFormOpen = false; toast('Záznam přidán (opraveno administrátorem)'); render();
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
      ${tpls.map(tp => `<div class="urow"><span>📋</span><b>${esc(tp.title)}</b><span class="muted" style="margin-left:auto">${(tp.items || []).length} úkolů</span><span class="lnk" style="font-size:11px;margin-left:10px" onclick="db.collection('tasks').doc('${tp.id}').delete().then(()=>toast('Šablona smazána'))">✕ smazat</span></div>`).join('') || '<div class="muted">Zatím žádné šablony.</div>'}
      ${tpls.length ? `<div class="formsec"><h4>▶ Aplikovat šablonu na projekt</h4>
        <div class="frow">
          <div><label>Šablona</label><select id="tp-s">${tpls.map(tp => `<option value="${tp.id}">${esc(tp.title)}</option>`).join('')}</select></div>
          <div><label>Projekt</label><select id="tp-p">${S.projects.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        </div>
        <div class="frow">
          <div><label>Začátek (den 0)</label><input type="date" id="tp-d" value="${isoToday()}"></div>
          <div><label>Odpovědná osoba</label><select id="tp-r">${S.users.filter(u => u.active !== false && u.typ && u.typ.kanc).map(u => `<option>${esc(fullName(u))}</option>`).join('')}</select></div>
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
      <label>Název *</label><input type="text" id="tk-t" placeholder="Co je potřeba udělat">
      <div class="frow">
        <div><label>Projekt</label><select id="tk-p">${S.projects.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Odpovědná osoba</label><select id="tk-r">${S.users.filter(u => u.active !== false).map(u => `<option>${esc(fullName(u))}</option>`).join('')}</select></div>
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
        <td><b>${esc(t.title)}</b>${t.src ? ` <span class="badge b-int">${esc(t.src)}</span>` : ''}</td>
        <td>${esc((proj(t.pid) || {}).name || '')}</td>
        <td>${esc(t.resp || '')}</td>
        <td><span class="badge ${STAVCOLOR[t.stav]}">${STAVY[t.stav]}</span></td>
        <td class="muted">${fmtISO(t.created)}</td>
        <td>${isOverdue(t) ? `<b style="color:var(--red)">❗ ${fmtISO(t.term)} (${daysBetween(t.term, isoToday())} d. po termínu)</b>` : fmtISO(t.term)}</td>
        <td>${t.stav !== 'hotovo' ? `<button class="btn ok sm" onclick="taskNext('${t.id}')">→ ${STAVY[nextStav(t.stav)]}</button>` : ''}</td>
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
          <div class="muted" style="font-size:11.5px;margin:4px 0">${esc((proj(t.pid) || {}).name || '')} · ${esc(t.resp || '')}</div>
          <div style="font-size:11.5px">${isOverdue(t) ? `<b style="color:var(--red)">❗ ${fmtISO(t.term)}</b>` : `📅 ${fmtISO(t.term)}`}</div>
          <div style="display:flex;gap:4px;margin-top:8px">
            ${c !== 'nove' ? `<button class="btn ghost sm" style="padding:3px 8px" onclick="taskMove('${t.id}',-1)">←</button>` : ''}
            ${c !== 'hotovo' ? `<button class="btn amber sm" style="padding:3px 8px" onclick="taskMove('${t.id}',1)">→</button>` : ''}
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
  $('#tp-n').value = ''; $('#tp-i').value = '';
  toast('Šablona uložena ✓ (' + items.length + ' úkolů)');
}
async function tplApply() {
  const tpl = S.tasks.find(t => t.id === $('#tp-s').value); if (!tpl) return;
  const pid = $('#tp-p').value, start = $('#tp-d').value || isoToday(), resp = $('#tp-r').value;
  for (const it of (tpl.items || [])) {
    await db.collection('tasks').add({ title: it.title, pid, resp, created: isoToday(), term: shiftISO(start, it.off || 0), stav: 'nove', res: [resp], src: 'ze šablony ' + tpl.title, createdAt: FV() });
  }
  S.tplOpen = false;
  toast('Vytvořeno ' + (tpl.items || []).length + ' úkolů ze šablony ✓');
}
async function taskNext(id) { const t = S.tasks.find(x => x.id === id); await db.collection('tasks').doc(id).update({ stav: nextStav(t.stav) }); }
async function taskMove(id, dir) { const order = ['nove', 'probiha', 'kontrola', 'hotovo']; const t = S.tasks.find(x => x.id === id); const i = order.indexOf(t.stav) + dir; if (i >= 0 && i < 4) await db.collection('tasks').doc(id).update({ stav: order[i] }); }
async function taskDone(id) { const t = S.tasks.find(x => x.id === id); await db.collection('tasks').doc(id).update({ stav: t.stav === 'hotovo' ? 'nove' : 'hotovo' }); }
async function taskShift(id) { const t = S.tasks.find(x => x.id === id); await db.collection('tasks').doc(id).update({ term: shiftISO(t.term, 3) }); toast('Termín posunut'); }
async function addTask() {
  const title = $('#tk-t').value.trim();
  if (!title) { toast('Vyplň název úkolu'); return; }
  await db.collection('tasks').add({ title, pid: $('#tk-p').value, resp: $('#tk-r').value, created: isoToday(), term: $('#tk-d').value || shiftISO(isoToday(), 3), stav: 'nove', res: [$('#tk-r').value], createdAt: FV() });
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
        ${(v.stav === 'schvaleno' || v.stav === 'papir' || v.stav === 'zamitnuto') ? `<button class="btn ghost sm" onclick="if(confirm('Smazat vícepráci?'))db.collection('viceprace').doc('${v.id}').delete()">🗑</button>` : ''}
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
  S.vpFormOpen = false; toast('Vícepráce založena — čeká na nacenění'); render();
}
async function vpNacenit(id) {
  const c = parseFloat($('#vpc-' + id).value);
  if (!c) { toast('Zadej cenu'); return; }
  const v = S.viceprace.find(x => x.id === id);
  const p = proj(v.pid);
  await db.collection('viceprace').doc(id).update({ cena: c, stav: 'u_investora', clientName: (p || {}).client || '' });
  if (p && p.portalToken) {
    await db.collection('portals').doc(p.portalToken).collection('vp').doc(id).set({ title: v.title, popis: v.popis || '', cena: c, stav: 'u_investora' });
    notifyMail('vp', v.pid, v.title + ' — ' + kc(c) + ' Kč');
    toast('Posláno investorovi ke schválení + notifikace 📬');
  } else toast('Naceněno ✓ — projekt nemá portál, schválení vyřiď papírově');
  render();
}
async function vpPapir(id) {
  const v = S.viceprace.find(x => x.id === id);
  await db.collection('viceprace').doc(id).update({ stav: 'papir', podpis: 'podepsáno papírově na stavbě ' + fmtISO(isoToday()) + ' (sken na Drive)' });
  const p = proj(v.pid);
  if (p && p.portalToken) await db.collection('portals').doc(p.portalToken).collection('vp').doc(id).set({ title: v.title, popis: v.popis || '', cena: v.cena, stav: 'schvaleno', podpis: 'schváleno papírově na stavbě' }, { merge: true });
  toast('Označeno jako schválené papírově ✓');
}

/* ---- Reporty — hodiny z docházky ---- */
function hoursFromAttendance(from, to) {
  // páruje Příchod/Odchod po dnech: {userDocId: {pid: {h, dni, incomplete}}}
  const toMin = t => { const p = String(t || '').split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); };
  const byKey = {};
  S.attendance.filter(a => a.date >= from && a.date <= to).forEach(a => {
    const k = a.userDocId + '|' + a.pid + '|' + a.date;
    (byKey[k] = byKey[k] || []).push(a);
  });
  const out = {};
  Object.entries(byKey).forEach(([k, recs]) => {
    const [udi, pid] = k.split('|');
    const prichody = recs.filter(r => r.akce === 'Příchod').map(r => toMin(r.time));
    const odchody = recs.filter(r => r.akce === 'Odchod').map(r => toMin(r.time));
    out[udi] = out[udi] || {};
    out[udi][pid] = out[udi][pid] || { h: 0, dni: 0, incomplete: 0 };
    if (prichody.length && odchody.length && Math.max(...odchody) > Math.min(...prichody)) {
      out[udi][pid].h += (Math.max(...odchody) - Math.min(...prichody)) / 60;
      out[udi][pid].dni++;
    } else { out[udi][pid].incomplete++; out[udi][pid].dni++; }
  });
  return out;
}
function pgReporty() {
  const teren = S.users.filter(u => u.typ && u.typ.teren && !u.typ.kanc && !u.typ.sub && u.active !== false);
  const sel = S.repWorkers, selP = S.repProjects;
  return `
  <div class="strip"><h1>Reporty — Odpracované hodiny na projektu</h1><span class="sp"></span></div>
  <main>
    <div class="card">
      <h3>📋 Přehled odpracovaných hodin</h3>
      <div class="grid2">
        <div>
          <label>Terénní pracovníci (${sel.length})</label>
          <div class="chipselect">${teren.map(u => `<button class="${sel.includes(u.id) ? 'active' : ''}" onclick="repTogW('${u.id}')">${esc(fullName(u))}${S.sazby[u.id] ? '' : ' ⚠'}</button>`).join('') || '<span class="muted">žádní pracovníci</span>'}</div>
        </div>
        <div>
          <label>Projekty (${selP.length})</label>
          <div class="chipselect">${S.projects.map(p => `<button class="${selP.includes(p.id) ? 'active' : ''}" onclick="repTogP('${p.id}')">${esc(p.name)}</button>`).join('')}</div>
        </div>
      </div>
      <div class="aprv" style="align-items:center">
        <span class="muted">Od</span><input type="date" id="rep-from" value="${S.repFrom}" style="max-width:150px" onchange="S.repFrom=this.value">
        <span class="muted">do</span><input type="date" id="rep-to" value="${S.repTo}" style="max-width:150px" onchange="S.repTo=this.value">
        <button class="btn amber" onclick="S.repLoaded=true;render()">NAČÍST REPORT</button>
      </div>
    </div>
    ${S.repLoaded ? repTable() : `
    <div class="card"><div class="empty">ℹ️ Žádný report není načten<br><span class="muted">1. Vyber pracovníky · 2. Vyber projekty · 3. Načíst report</span></div></div>`}
  </main>`;
}
function repTogW(id) { const i = S.repWorkers.indexOf(id); i >= 0 ? S.repWorkers.splice(i, 1) : S.repWorkers.push(id); S.repLoaded = false; render(); }
function repTogP(id) { const i = S.repProjects.indexOf(id); i >= 0 ? S.repProjects.splice(i, 1) : S.repProjects.push(id); S.repLoaded = false; render(); }
function repTable() {
  const sel = S.repWorkers, selP = S.repProjects;
  if (!sel.length || !selP.length) return '<div class="card"><div class="empty">Vyber aspoň jednoho pracovníka a projekt.</div></div>';
  const H = hoursFromAttendance(S.repFrom, S.repTo);
  let totKc = 0, totC = 0, totH = 0, missing = [], anyCista = false, anyIncomplete = false;
  const rows = sel.map(udi => {
    const u = userById(udi); if (!u) return '';
    const s = S.sazby[udi];
    let rowKc = 0, rowC = 0, rowH = 0;
    const cells = selP.map(pid => {
      const h = H[udi] && H[udi][pid];
      if (!h || (!h.h && !h.incomplete)) return '<td class="muted" style="text-align:center">—</td>';
      if (h.incomplete) anyIncomplete = true;
      const kcv = s ? h.h * s.h : 0, cc = (s && s.c) ? h.h * s.c : 0;
      rowKc += kcv; rowC += cc; rowH += h.h;
      return `<td style="text-align:center"><b>${s ? kc(kcv) + ' Kč' : '⚠'}</b><br><span class="muted">${fmtH(h.h)} · ${h.dni} dní${h.incomplete ? ` · <b style="color:var(--red)">${h.incomplete}× neúplný den</b>` : ''}</span><br>${s ? (s.c ? `<span class="badge b-wait">hrubá ${s.h}</span> <span class="badge b-ok">čistá ${s.c}</span>` : `<span class="badge b-wait">${s.h} Kč/h</span>`) : '<span class="badge b-red">chybí sazba!</span>'}</td>`;
    });
    if (!s && rowH > 0) missing.push(fullName(u));
    if (s && s.c && rowH > 0) anyCista = true;
    totKc += rowKc; totC += (s && s.c) ? rowC : rowKc; totH += rowH;
    const diff = (s && s.c) ? rowKc - rowC : 0;
    return `<tr><td><span class="uav" style="margin-right:6px">${ini(u)}</span>${esc(fullName(u))}<br><span class="muted" style="margin-left:34px">${esc(u.skupina || '')}</span></td>${cells.join('')}<td style="text-align:center"><b>${s ? kc(rowKc) + ' Kč' : '⚠'}</b>${diff > 0 ? `<br><span class="muted">čistá: ${kc(rowC)} Kč</span><br><span class="badge b-wait">vedoucímu party: ${kc(diff)} Kč</span>` : ''}</td><td style="text-align:center"><b>${fmtH(rowH)}</b></td></tr>`;
  });
  // křížová kontrola proti deníku (#25)
  // křížová kontrola (#25): dny z DOCHÁZKY vs. existence zápisu v deníku pro stejný projekt a den
  const entryDaySet = new Set(S.entries.map(e => e.date + '|' + e.pid));
  const attPairs = {};
  S.attendance.filter(a => a.date >= S.repFrom && a.date <= S.repTo && sel.includes(a.userDocId)).forEach(a => {
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
    <div class="card" style="margin-top:12px;background:#f8fafc">
      <h3>🔎 Křížová kontrola proti deníku (#25)</h3>
      ${sel.map(udi => { const u = userById(udi); if (!u) return ''; const pairs = [...(attPairs[udi] || [])]; const missing = pairs.filter(k => !entryDaySet.has(k)); const okk = missing.length === 0; return `
        <div class="urow"><span>${okk ? '✅' : '⚠️'}</span><b>${esc(fullName(u))}</b>
        <span class="muted" style="margin-left:auto">docházka: <b>${pairs.length} dní</b> · deník existuje pro <b>${pairs.length - missing.length}</b> z nich${okk ? '' : ` — <b style="color:var(--red)">chybí zápis: ${missing.slice(0, 5).map(k => fmtISO(k.split('|')[0]) + ' (' + esc((proj(k.split('|')[1]) || {}).name || '?') + ')').join(', ')}${missing.length > 5 ? ' +' + (missing.length - 5) + ' dalších' : ''}</b>`}</span></div>`; }).join('')}
      <div class="note">Kontroluje se: každý den z docházky má mít deníkový zápis na stejném projektu. Chybějící dny prověř před proplacením (#25).</div>
    </div>
  </div>`;
}
function repExport() {
  const H = hoursFromAttendance(S.repFrom, S.repTo);
  let csv = 'Pracovnik;Projekt;Hodiny;Dny;Sazba hruba;Sazba cista;Kc hruba\n';
  S.repWorkers.forEach(udi => {
    const u = userById(udi); const s = S.sazby[udi] || {};
    S.repProjects.forEach(pid => {
      const h = H[udi] && H[udi][pid]; if (!h) return;
      csv += [fullName(u), (proj(pid) || {}).name, h.h.toFixed(2), h.dni, s.h || '', s.c || '', s.h ? Math.round(h.h * s.h) : ''].join(';') + '\n';
    });
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = 'report_hodiny_' + S.repFrom + '_' + S.repTo + '.csv'; a.click();
}

/* ---- Uživatelé ---- */
function pgUzivatele() {
  return `
  <div class="strip"><h1>Uživatelé</h1><span class="sp"></span><button class="btn amber" onclick="S.newUserType=null;S.editUserId=null;goPage('newuser')">➕ PŘIDAT</button></div>
  <main>
    <div class="card">
      <h3>🔑 Jak fungují práva — jednoduše (#33)</h3>
      <div class="urow"><span class="uav">🗂</span><b>Vedení</b><span class="muted" style="margin-left:auto">vše, všude — schvaluje zápisy, fotky, hodiny, vícepráce</span></div>
      <div class="urow"><span class="uav">👷</span><b>Pracovník</b><span class="muted" style="margin-left:auto">zápis, fotky, docházka · ceny nevidí nikdy</span></div>
      <div class="urow"><span class="uav">🔧</span><b>Subdodavatel</b><span class="muted" style="margin-left:auto">jako pracovník · klientské ceny a marže nevidí — hlídá struktura</span></div>
      <div class="urow"><span class="uav">🏠</span><b>Investor</b><span class="muted" style="margin-left:auto">jen portál přes odkaz: schválené zápisy a fotky</span></div>
    </div>
    <div class="tablecard">
      <div style="overflow-x:auto"><table>
        <tr><th></th><th>Jméno</th><th>Email</th><th>Kancelářský</th><th>Terénní</th><th>Investor</th><th>Sub</th><th>Sazba hrubá / čistá</th><th>Role / skupina</th><th>Přihlášení</th><th></th></tr>
        ${S.users.map(u => { const t = u.typ || {}; const s = S.sazby[u.id]; return `
        <tr style="${u.active === false ? 'opacity:.5' : ''}">
          <td><span class="uav">${ini(u)}</span></td>
          <td><b>${esc(fullName(u))}</b></td>
          <td class="muted">${esc(u.email || '—')}</td>
          <td style="text-align:center">${t.kanc ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td style="text-align:center">${t.teren ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td style="text-align:center">${t.inv ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td style="text-align:center">${t.sub ? '<span class="ck on">✓</span>' : '<span class="ck"></span>'}</td>
          <td>${s ? `<b>${s.h} Kč/h</b>${s.c ? ` / <span style="color:var(--ok);font-weight:700">${s.c} Kč/h</span>` : ''}` : (t.teren && !t.kanc && !t.sub ? '<b style="color:var(--red)">⚠ chybí</b>' : '<span class="muted">—</span>')}</td>
          <td>${esc(u.role || '—')}${u.skupina ? ` <span class="muted">· ${esc(u.skupina)}</span>` : ''}</td>
          <td>${u.uid ? '<span class="badge b-ok">✓ má účet</span>' : (t.inv ? '<span class="muted">portál</span>' : `<button class="btn ghost sm" onclick="loginForm('${u.id}')">🔑 vytvořit</button>`)}</td>
          <td><span class="lnk" onclick="editUser('${u.id}')">✏️</span></td>
        </tr>`; }).join('')}
      </table></div>
      <div class="pagefoot"><span>${S.users.length} uživatelů</span></div>
    </div>
    <div class="note">Čistá sazba (#34) je citlivý údaj — vidí ji jen Vedení. „Vytvořit přihlášení" založí pracovníkovi PIN pro mobilní přihlášení.</div>
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
  const authEmail = 'u' + udi.toLowerCase() + '@denik.rekovrana.cz';
  try {
    const secondary = firebase.apps.find(a => a.name === 'sec') || firebase.initializeApp(CFG.firebase, 'sec');
    const cred = await secondary.auth().createUserWithEmailAndPassword(authEmail, pin);
    const role = (u.typ && u.typ.kanc) ? 'admin' : (u.typ && u.typ.sub) ? 'sub' : 'worker';
    await db.collection('users_auth').doc(cred.user.uid).set({ role, userDocId: udi, name: fullName(u) });
    await db.collection('users').doc(udi).update({ uid: cred.user.uid, authEmail });
    await db.collection('roster').doc(udi).set({ jmeno: u.jmeno, prijmeni: u.prijmeni, authEmail, role, popis: $('#lf-pop').value.trim() });
    await secondary.auth().signOut();
    closeModal(); toast('Účet vytvořen ✓ PIN předej pracovníkovi.');
  } catch (e) { toast('Chyba: ' + (e.code === 'auth/email-already-in-use' ? 'účet už existuje' : e.message)); }
}
function editUser(udi) { S.editUserId = udi; S.newUserType = null; goPage('newuser'); }
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
          <div><label>Telefon</label><input type="text" id="nu-tel" value="${esc(edit ? edit.tel || '' : '')}" placeholder="+420"></div>
          <div><label>Email</label><input type="text" id="nu-e" value="${esc(edit ? edit.email || '' : '')}"></div>
        </div>
      </div>
      ${(t === 'teren' || t === 'sub') ? `
      <div class="formsec">
        <h4>⏱ Sazby (#34) — vidí jen Vedení</h4>
        <div class="frow">
          <div><label>Hrubá sazba Kč/h ${t === 'teren' ? '*' : ''}</label><input type="number" id="nu-sh" value="${s ? s.h : ''}" placeholder="co stojí hodina firmu"></div>
          <div><label>Čistá sazba Kč/h (volitelná)</label><input type="number" id="nu-sc" value="${s && s.c ? s.c : ''}" placeholder="co pracovník reálně dostane"></div>
        </div>
        <div class="note">Čistou vyplň u pracovníků, kterým vedoucí party sráží z hodinovky — report pak rozdíl ukáže automaticky.</div>
      </div>` : ''}
      <div class="formsec">
        <h4>👥 Skupiny a role</h4>
        <label>Skupina</label>
        <select id="nu-s">${['', 'Zaměstnanci', 'Subdodavatelé'].map(g => `<option ${edit && edit.skupina === g ? 'selected' : ''}>${g || 'Bez skupiny'}</option>`).join('')}</select>
        <label>Role (jen popisek)</label>
        <input type="text" id="nu-r" value="${esc(edit ? edit.role || '' : '')}" placeholder="např. Vedoucí party, Subdodavatel — elektro…">
      </div>
      ${edit ? `<div class="formsec"><label style="display:flex;align-items:center;gap:8px;text-transform:none"><span class="toggle ${edit.active !== false ? 'on' : ''}" onclick="db.collection('users').doc('${edit.id}').update({active:${edit.active === false}}).then(render)"><i></i></span> Aktivní uživatel</label></div>` : ''}
      ` : '<div class="empty">Nejdřív vyber typ přístupu ↑</div>'}
    </div>
  </main>`;
}
async function saveUser() {
  const t = S.newUserType || (S.editUserId ? null : null);
  const edit = S.editUserId ? userById(S.editUserId) : null;
  const typKey = S.newUserType || (edit ? (edit.typ.kanc ? 'kanc' : edit.typ.inv ? 'inv' : edit.typ.sub ? 'sub' : 'teren') : null);
  if (!typKey) { toast('Vyber typ přístupu'); return; }
  const j = $('#nu-j').value.trim(), p = $('#nu-p').value.trim();
  if (!j || !p) { toast('Vyplň jméno a příjmení'); return; }
  const data = {
    jmeno: j, prijmeni: p, email: $('#nu-e').value.trim(), tel: $('#nu-tel') ? $('#nu-tel').value.trim() : '',
    typ: { kanc: typKey === 'kanc' ? 1 : 0, teren: (typKey === 'kanc' || typKey === 'teren' || typKey === 'sub') ? 1 : 0, inv: typKey === 'inv' ? 1 : 0, sub: typKey === 'sub' ? 1 : 0 },
    role: $('#nu-r').value.trim(), skupina: $('#nu-s').value === 'Bez skupiny' ? '' : $('#nu-s').value, active: edit ? edit.active !== false : true
  };
  // FIX: sazby přečíst z formuláře PŘED zápisem do users — await níže spustí onSnapshot render(),
  // který formulář překreslí a vyprázdní, takže se sazba nikdy neuložila (a existující se mazala).
  const shEl = $('#nu-sh'), scEl = $('#nu-sc');
  const shVal = shEl ? parseFloat(shEl.value) : null, scVal = scEl ? parseFloat(scEl.value) : null;
  let docId;
  if (edit) { await db.collection('users').doc(edit.id).update(data); docId = edit.id; }
  else { const ref = await db.collection('users').add({ ...data, createdAt: FV() }); docId = ref.id; }
  if (shEl) {
    if (shVal) await db.collection('sazby').doc(docId).set(scVal ? { h: shVal, c: scVal } : { h: shVal });
    else await db.collection('sazby').doc(docId).delete().catch(() => {});
  }
  goPage('uzivatele'); toast(edit ? 'Uživatel upraven ✓' : 'Uživatel přidán ✓ Přihlášení mu vytvoř tlačítkem 🔑');
}

/* ============ PRACOVNÍK / SUB (mobil) ============ */
function viewWorker() {
  if (!S.workerProject && S.projects.length) S.workerProject = (S.projects.find(p => p.active) || S.projects[0]).id;
  const p = proj(S.workerProject);
  const myEntries = p ? entriesOf(p.id).slice(0, 8) : [];
  const myAtt = S.attendance.filter(a => a.date === isoToday());
  const lastAct = myAtt[0];
  const myTasks = S.tasks.filter(t => t.stav !== 'hotovo' && t.stav !== 'sablona' && S.me && (t.resp === fullName(S.me) || (t.res || []).includes(fullName(S.me))));
  return topbar() + `<div class="shell"><div class="content">
  <div class="strip"><h1>Můj den na stavbě</h1><span class="sp"></span><span class="muted">${fmtISOFull(isoToday())}</span></div>
  <main class="mobilewrap">
    <div class="card">
      <label style="margin-top:0">Stavba</label>
      <div class="chipselect">${S.projects.filter(x => x.active).map(x => `<button class="${x.id === S.workerProject ? 'active' : ''}" onclick="S.workerProject='${x.id}';render()">${esc(x.name)}</button>`).join('')}</div>
      ${p ? `<div class="muted" style="margin-top:8px">${esc(p.address || '')}</div>` : ''}
      <label>⏱ Docházka (GPS check-in)</label>
      <div class="aprv" style="margin-top:2px">
        <button class="btn ok" id="chk-in" onclick="workerCheck('Příchod')">📍 PŘÍCHOD</button>
        <button class="btn dark" id="chk-out" onclick="workerCheck('Odchod')">🏁 ODCHOD</button>
        ${lastAct ? `<span class="badge ${lastAct.akce === 'Příchod' ? 'b-ok' : 'b-int'}" style="align-self:center">dnes: ${lastAct.akce} ${lastAct.time}${lastAct.gps != null ? ' · GPS ' + lastAct.gps + ' m' : ''}</span>` : ''}
      </div>
      <div class="note">Poloha se ověří proti GPS stavby (±${CFG.gpsTolerance || 100} m) + ověřovací foto.</div>
    </div>
    ${p && (p.stavbaDocs || []).length ? `<div class="card">
      <h3>📐 Podklady stavby <span class="muted" style="font-weight:400">— půdorysy, vizualizace</span></h3>
      ${(p.stavbaDocs || []).map(d => `<div class="urow" style="cursor:pointer" onclick="openDriveDoc('${d.driveId}','${esc(d.name)}')"><span>${(d.mime || '').includes('pdf') ? '📄' : '🖼'}</span><b>${esc(d.name)}</b><span class="muted" style="margin-left:auto">otevřít</span></div>`).join('')}
    </div>` : ''}
    ${myTasks.length ? `<div class="card">
      <h3>📌 Moje úkoly (${myTasks.length})</h3>
      ${myTasks.map(t => `<div class="urow"><span>${isOverdue(t) ? '❗' : '📌'}</span><div><b>${esc(t.title)}</b><br><span class="muted">${esc((proj(t.pid) || {}).name || '')} · termín ${fmtISO(t.term)}</span></div>
        <span style="margin-left:auto"><button class="btn ok sm" onclick="taskNext('${t.id}')">✓</button></span></div>`).join('')}
    </div>` : ''}
    <div class="card">
      <h3>✍️ Nový zápis do deníku</h3>
      <textarea id="wt" placeholder="Co se dnes dělalo… každá věta = jedna odrážka"></textarea>
      <label>Počet osob</label><input type="number" id="wpers" value="1" min="1" style="max-width:110px">
      <label>Fotky z dneška</label>
      <input type="file" id="wph" accept="image/*" capture="environment" multiple onchange="processPhotos(this.files)">
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
function workerCheck(akce) {
  const p = proj(S.workerProject);
  if (!p) { toast('Vyber stavbu'); return; }
  const btn = $(akce === 'Příchod' ? '#chk-in' : '#chk-out'); if (btn) btn.disabled = true;
  const save = async (gpsDev) => {
    await db.collection('attendance').add({
      userDocId: S.me ? S.me.id : '', userName: fullName(S.me || {}), authUid: S.authUser.uid,
      akce, pid: p.id, date: isoToday(), time: nowTime(), gps: gpsDev, selfie: null, manual: false, createdAt: FV()
    });
    toast(akce + ' zaznamenán' + (gpsDev != null ? ' — GPS ' + gpsDev + ' m' : ' (bez GPS)') + ' ✓');
    render();
  };
  if (navigator.geolocation && p.gps) {
    navigator.geolocation.getCurrentPosition(
      pos => save(haversine(pos.coords.latitude, pos.coords.longitude, p.gps.lat, p.gps.lng)),
      () => save(null), { enableHighAccuracy: true, timeout: 12000 });
  } else save(null);
}
async function workerSubmit() {
  const txt = $('#wt').value.trim();
  if (!txt && !S.draftPhotos.length) { toast('Napiš text nebo přidej fotku'); return; }
  $('#w-save').disabled = true;
  await addEntry(S.workerProject, fullName(S.me || {}), txt, parseInt($('#wpers').value) || 1);
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
      ${P.progress != null ? `<div class="prog"><i style="width:${P.progress}%"></i></div><div class="hm">Hotovo ${P.progress} % ${P.phase ? '· fáze: ' + esc(P.phase) : ''} ${P.handover ? '· ' + esc(P.handover) : ''}</div>` : ''}
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
      ${P.milestones.map(m => `<div class="mile ${m.s}"><div class="dot">${m.s === 'done' ? '✓' : m.s === 'now' ? '●' : ''}</div><div>${m.s === 'now' ? '<b>' + esc(m.t) + ' — probíhá</b>' : esc(m.t)}</div></div>`).join('')}
    </div>` : ''}
    ${S.portalDocs.length ? `<div class="card">
      <h3>📁 Dokumenty</h3>
      ${S.portalDocs.map(d => `<div class="urow" style="cursor:pointer" onclick="openDriveDoc('${d.driveId}','${esc(d.title)}')"><span>📄</span><b>${esc(d.title)}</b><span class="muted" style="margin-left:auto">zobrazit</span></div>`).join('')}
    </div>` : ''}
    <div class="card">
      <h3>📓 Průběh stavby <span class="muted" style="font-weight:400">— zápisy a fotky</span></h3>
      ${S.portalFeed.length ? S.portalFeed.map((e, i) => `
        <div style="border:1px solid var(--line);border-radius:9px;padding:11px 13px;margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${fmtISOFull(e.date)}</b>${i === 0 ? '<span class="badge b-ok">nové</span>' : ''}</div>
          <div style="margin-top:4px">${esc(e.client).replace(/\n/g, '<br>')}</div>
          ${(e.photos || []).length ? `<div class="photos">${e.photos.map(ph => `<div class="ph" onclick="openPhoto('${ph.driveId || ''}','${esc(ph.label)}',this)"><img src="${ph.thumb}"><small>${esc(ph.label || '')}</small></div>`).join('')}</div>` : ''}
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
  if (action === 'approve' && !confirm('Schválit vícepráci? Kliknutí platí jako odsouhlasení ceny.')) return;
  await db.collection('portals').doc(S.portalToken).collection('actions').add({ type: 'vp', vpid, action, ts: FV(), handled: false });
  // optimisticky schovej tlačítka
  const v = S.portalVp.find(x => x.id === vpid);
  if (v) v.stav = action === 'approve' ? 'schvaleno' : 'zamitnuto';
  toast(action === 'approve' ? 'Děkujeme — vícepráce schválena ✓' : 'Zamítnuto — ozveme se Vám.');
  render();
}

/* ---- sync portal hlavičky při změně projektu ---- */
async function syncPortalHeader(p) {
  if (!p.portalToken) return;
  await db.collection('portals').doc(p.portalToken).set({
    pid: p.id, client: p.client || '', name: p.name, address: p.address || '', type: p.type || '',
    progress: p.progress || 0, phase: p.phase || '', handover: p.handover || '', milestones: p.milestones || []
  }, { merge: true }).catch(() => {});
}
// automaticky syncuj portal hlavičky když se změní projekty (levné — jen při renderu adminů)
let _lastPortalSync = 0;
setInterval(() => {
  if (!S.meAuth || S.meAuth.role !== 'admin' || !S.online) return;
  if (Date.now() - _lastPortalSync < 60000) return;
  _lastPortalSync = Date.now();
  S.projects.filter(p => p.portalToken).forEach(p => syncPortalHeader(p));
}, 65000);

/* ============ VÝCHOZÍ DATA (pilot Pecka + Šaarová) ============ */
async function seedData() {
  if (!confirm('Nahrát výchozí data pilotních zakázek (Pecka CN20260055, Šaarová CN20260060)?')) return;
  const batchAdd = async (col, data) => (await db.collection(col).add(data)).id;
  const pecka = await batchAdd('projects', {
    kod: '020', cn: 'CN20260055', client: 'Štěpán Pecka', name: 'Novodvorská - Pecka', address: 'Novodvorská 413/135, Praha 4',
    type: 'Kompletní rekonstrukce · 3+kk panelák, 70 m²', resp: 'Zdeno Balúch', stav: 'Realizace', phase: 'Kompletace', progress: 88,
    active: true, gps: { lat: 50.0236914, lng: 14.4368684, tol: 100 }, handover: 'plán předání 24. 7. 2026', driveFolderId: '', investorEmail: '',
    milestones: [{ t: 'Přípravné práce, demontáže', s: 'done' }, { t: 'SDK konstrukce, elektro, ZTI, VZT', s: 'done' }, { t: 'Obklady, dlažba, hydroizolace', s: 'done' }, { t: 'Nivelace a pokládka vinylu', s: 'done' }, { t: 'Malování', s: 'done' }, { t: 'Kompletace a montáže zařízení', s: 'now' }, { t: 'Úklid a předání', s: 'next' }], createdAt: FV()
  });
  const saarova = await batchAdd('projects', {
    kod: '028', cn: 'CN20260060', client: 'Šárka Šaarová', name: 'V Předpolí - Šaarová', address: 'V Předpolí 1472/27, Praha 10',
    type: 'Komplet reko · činžovní dům', resp: 'Zdeno Balúch', stav: 'Realizace', phase: 'Hrubé rozvody', progress: 35,
    active: true, gps: { lat: 50.0712, lng: 14.4990, tol: 100 }, handover: 'dle harmonogramu', driveFolderId: '', investorEmail: '',
    milestones: [{ t: 'Přípravné práce, demontáže', s: 'done' }, { t: 'Elektro a ZTI — hrubé rozvody', s: 'now' }, { t: 'SDK konstrukce', s: 'next' }, { t: 'Obklady, dlažba', s: 'next' }, { t: 'Podlahy, malování, kompletace', s: 'next' }], createdAt: FV()
  });
  const U = [
    { jmeno: 'Ruslan', prijmeni: 'Gorbunov', email: 'gorbunovruslan430@gmail.com', typ: { kanc: 0, teren: 1, inv: 0, sub: 0 }, role: 'Vedoucí party Ruslan', skupina: 'Zaměstnanci', sazba: { h: 300 } },
    { jmeno: 'Vasyl', prijmeni: 'Fedorin', email: 'vasilfedorin0@gmail.com', typ: { kanc: 0, teren: 1, inv: 0, sub: 0 }, role: '', skupina: 'Zaměstnanci', sazba: { h: 275, c: 230 } },
    { jmeno: 'Oleg', prijmeni: 'Starostag', email: 'olegstarostak570@gmail.com', typ: { kanc: 0, teren: 1, inv: 0, sub: 0 }, role: '', skupina: 'Zaměstnanci' },
    { jmeno: 'Lukáš', prijmeni: 'Poštolka', email: 'postolin@gmail.com', typ: { kanc: 0, teren: 1, inv: 0, sub: 1 }, role: 'Subdodavatel — elektro', skupina: 'Subdodavatelé' },
    { jmeno: 'Marek', prijmeni: 'Valečko', email: 'marekvalecko@seznam.cz', typ: { kanc: 0, teren: 1, inv: 0, sub: 1 }, role: 'Subdodavatel — voda / topení', skupina: 'Subdodavatelé' },
    { jmeno: 'DS', prijmeni: 'Podlahy', email: 'dspodlahy@email.cz', typ: { kanc: 0, teren: 1, inv: 0, sub: 1 }, role: 'Subdodavatel — podlahy', skupina: 'Subdodavatelé' },
    { jmeno: 'David', prijmeni: 'Falat', email: 'falyn.ji@seznam.cz', typ: { kanc: 1, teren: 1, inv: 0, sub: 0 }, role: 'Vedoucí projektu', skupina: '' },
    { jmeno: 'Štěpán', prijmeni: 'Pecka', email: 'stepan.pecka@seznam.cz', typ: { kanc: 0, teren: 0, inv: 1, sub: 0 }, role: 'Investor (Novodvorská)', skupina: '' },
    { jmeno: 'Šárka', prijmeni: 'Šaarová', email: 'saarovas@seznam.cz', typ: { kanc: 0, teren: 0, inv: 1, sub: 0 }, role: 'Investor (V Předpolí)', skupina: '' }
  ];
  for (const u of U) {
    const { sazba, ...rest } = u;
    const id = await batchAdd('users', { ...rest, active: true, createdAt: FV() });
    if (sazba) await db.collection('sazby').doc(id).set(sazba);
  }
  await batchAdd('tasks', { title: 'Krytka tlačítka WC — dovézt a domontovat', pid: pecka, resp: 'Marek Valečko', created: isoToday(), term: shiftISO(isoToday(), 1), stav: 'nove', res: ['Marek Valečko'], src: 'z deníku', createdAt: FV() });
  await batchAdd('tasks', { title: 'Fotodokumentace pro předání (Pecka)', pid: pecka, resp: 'David Falat', created: isoToday(), term: shiftISO(isoToday(), 4), stav: 'nove', res: ['David Falat'], createdAt: FV() });
  await batchAdd('tasks', { title: 'Konzultace: hliníkové vedení v ložnici → nacenit vícepráci', pid: saarova, resp: 'Zdeno Balúch', created: isoToday(), term: shiftISO(isoToday(), 2), stav: 'nove', res: ['Zdeno Balúch', 'Lukáš Poštolka'], src: 'z deníku', createdAt: FV() });
  await batchAdd('viceprace', { pid: saarova, title: 'Výměna hliníkového vedení v ložnici', popis: 'Nález z deníku — původní Al vedení pod omítkou, nutná výměna: drážky, kabeláž CYKY, zapravení.', cena: 0, stav: 'navrh', zdroj: 'stavba', createdAt: FV() });
  toast('Výchozí data nahrána ✓ (2 projekty, ' + U.length + ' uživatelů)');
}
// tlačítko seed na nástěnce, když je systém prázdný
const _origNastenkaPrehled = nastenkaPrehled;
nastenkaPrehled = function () {
  if (!S.projects.length) return `<main><div class="card"><div class="empty">👋 Systém je prázdný.<br><br>
    <button class="btn amber" onclick="seedData()">📦 Nahrát pilotní zakázky (Pecka + Šaarová)</button>
    <span class="muted" style="display:block;margin-top:8px">nebo založ projekt ručně v sekci Projekty</span></div></div></main>`;
  return _origNastenkaPrehled();
};

/* ============ INIT ============ */
if (CONFIGURED) {
  if (S.portalToken) { startPortal(); render(); }
  else initAuth();
} else { render(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

