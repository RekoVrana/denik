/* ============================================================
   DENÍK STAVEB — odesílatel upozornění do telefonu
   Rekonstrukce Vrána s.r.o.

   ZÁLOŽNÍ KOPIE kódu, který běží v Apps Scriptu.
   Živá verze: script.google.com → projekt „Vrana Upozorneni (denik)".
   Když se změní tam, změň i tady, ať kopie nezastará.

   ------------------------------------------------------------
   K ČEMU TO JE
   Deník je statická stránka na GitHub Pages. Umí poslat soubor, když si
   o něj telefon řekne — nic víc. Upozornění ale musí dorazit i ve chvíli,
   kdy nikdo aplikaci otevřenou nemá, takže ho musí odeslat něco, co běží
   pořád. Tohle je to něco.

   Posílají se JEN dvě věci — vědomé rozhodnutí Marca 1. 9. 2026:
     1) nový úkol pro mě
     2) večer připomenutí, že jsem pořád píchnutý na stavbě
   Víc upozornění znamená, že si je lidi vypnou, a pak jim nedorazí ani to
   jedno důležité.

   ------------------------------------------------------------
   PROČ SE TO KOUKÁ DO DATABÁZE SAMO, A NEČEKÁ, AŽ MU APLIKACE ŘEKNE

   Nabízelo by se, aby aplikace mostu zavolala: „právě jsem založil úkol,
   pošli upozornění." Jenže adresa mostu je jen odkaz — kdokoli, kdo ji
   zná, by pak mohl partě rozeslat libovolný text. Proto to takhle NENÍ.

   Most se místo toho každých pár minut podívá do databáze, co přibylo,
   a text si složí sám z toho, co tam opravdu je. Aplikace ho nevolá vůbec
   a volat nemůže. Cenou je zpoždění do pěti minut, což je u úkolu na
   stavbě jedno.

   Vedlejší výhoda: úkoly se v Deníku zakládají na čtyřech různých místech
   (formulář vedení, ze šablony, z deníku, z terénu). Takhle se pokryjí
   všechna najednou a žádné se nezapomene.

   ------------------------------------------------------------
   PROČ TO JE VLASTNÍ PROJEKT, A NE SOUČÁST MOSTU NA DRIVE

   Nabízelo by se přidat to k mostu, co už běží. Jenže ten vozí fotky
   a příloh a má nasazenou webovou adresu, na kterou volá aplikace.
   Kdyby se do něj sáhlo a něco se rozbilo, přestaly by chodit fotky.

   Takhle jsou to dvě oddělené věci: spadne-li jedna, druhá jede dál.
   Tenhle projekt navíc žádnou webovou adresu nemá a mít nemusí —
   nikdo ho zvenku nevolá, spouští ho jen hodiny.

   ------------------------------------------------------------
   ŽÁDNÝ KLÍČ SE TU NEUKLÁDÁ

   Původně to mělo jet na servisním účtu, což by znamenalo uložit sem
   soukromý klíč od databáze i od posílání — další tajemství navíc,
   které se musí hlídat.

   Není potřeba. Skript běží pod účtem, který ho založil, a Google mu
   na požádání dá dočasné oprávnění sám (ScriptApp.getOAuthToken).
   Co přesně smí, je vypsané v appsscript.json:

     script.external_request   · smí volat ven (UrlFetchApp)
     script.scriptapp          · smí mít spouštěče
     datastore                 · smí číst databázi
     firebase.messaging        · smí posílat upozornění

   Oprávnění jsou v manifestu NAPEVNO. Kdyby se odtud smazala, Apps
   Script si je domyslí sám a domyslí si míň, než je potřeba.

   ------------------------------------------------------------
   SPOUŠTĚČE
   Nastavují se jedním spuštěním funkce nastavSpoustece() z editoru.
   Klikat je ručně netřeba — a hlavně se tím nedá překlepnout čas.
   ============================================================ */

var PROJEKT = 'vrana-denik';          // Firebase projekt Deníku
var FS_KORen = 'https://firestore.googleapis.com/v1/projects/';
var LIMIT_NA_BEH = 40;     // pojistka proti lavině, viz posliDavku_

/* ---------- 1. ÚKOLY ---------- */
/* Běží každých 5 minut. Pošle upozornění o úkolech, které od minulého běhu
   někomu přibyly — ať vznikly jakkoli, nebo se na něj jen přehodily. */
function upozorneniUkoly() {
  var vl = PropertiesService.getScriptProperties();
  var od = vl.getProperty('UKOLY_OD');
  /* První spuštění: začínáme TEĎ. Bez toho by most při prvním běhu rozeslal
     upozornění na všechny úkoly, co kdy vznikly. */
  if (!od) { vl.setProperty('UKOLY_OD', new Date().toISOString()); return; }

  var ted = new Date().toISOString();
  var nove = fsDotaz_('tasks', [
    { field: 'createdAt', op: 'GREATER_THAN', ts: od }
  ]);
  /* Přehození úkolu na někoho jiného je pro toho člověka stejná novinka jako
     úkol nový — a snadno by mu uteklo, protože v seznamu se neobjeví nahoře.
     Aplikace kvůli tomu při změně odpovědného razítkuje pole respOd. */
  var prehozene = fsDotaz_('tasks', [
    { field: 'respOd', op: 'GREATER_THAN', ts: od }
  ]);

  var videl = {};
  var vsechny = [];
  nove.concat(prehozene).forEach(function (t) {
    if (videl[t.__id]) return;
    videl[t.__id] = true;
    vsechny.push(t);
  });

  /* Šablony samy o sobě nejsou úkol — je to jen předloha. */
  vsechny = vsechny.filter(function (t) { return t.stav !== 'sablona'; });
  /* Kdo si úkol zadal sám sobě, ať si o něm neposílá zprávu. */
  vsechny = vsechny.filter(function (t) { return t.respId && t.respId !== t.zadalId; });

  /* Seskupit na člověka. Ze šablony vznikne klidně dvacet úkolů naráz —
     dvacet cinknutí po sobě je nejrychlejší cesta k tomu, aby si to člověk
     vypnul. Dostane jedno. */
  var podleLidi = {};
  vsechny.forEach(function (t) {
    (podleLidi[t.respId] = podleLidi[t.respId] || []).push(t);
  });

  Object.keys(podleLidi).forEach(function (kdo) {
    var ukoly = podleLidi[kdo];
    var titul, telo, url;
    if (ukoly.length === 1) {
      titul = 'Nový úkol' + nazevStavby_(ukoly[0].pid);
      telo = ukoly[0].title || '';
      if (ukoly[0].term) telo += '  ·  do ' + datumCesky_(ukoly[0].term);
      url = './#ukol=' + ukoly[0].__id;
    } else {
      titul = 'Máš ' + pocetUkolu_(ukoly.length) + nazevStavby_(spolecnaStavba_(ukoly));
      telo = ukoly.slice(0, 3).map(function (t) { return t.title || ''; }).join(' · ');
      if (ukoly.length > 3) telo += ' …';
      url = './';
    }
    posliCloveku_(kdo, titul, telo, url, 'ukoly');
  });

  vl.setProperty('UKOLY_OD', ted);
}

/* ---------- 2. ZAPOMENUTÝ ODCHOD ---------- */
/* Běží večer. Komu zůstal jako poslední záznam Příchod, tomu připomene,
   ať se odepíše — jinak mu směna běží přes noc a hodiny sedí špatně.

   Aplikace tohle sice pozná a napíše to červeně, ALE až když ji člověk
   otevře. Kdo zapomněl odejít, ten ji večer neotevře. Přesně tuhle díru
   tohle zalepuje. */
function upozorneniOdchody() {
  /* Tři dny zpátky stačí: kdo je „píchnutý" déle, tomu už upozornění
     nepomůže a řeší to vedení ručně. Zároveň to drží dotaz malý. */
  var od = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  var zaznamy = fsDotaz_('attendance', [
    { field: 'date', op: 'GREATER_THAN_OR_EQUAL', str: od }
  ]);

  /* Pauzy se musí vynechat — jinak by „Konec pauzy" vypadal jako poslední
     akce a člověk ve směně by se schoval. Aplikace to dělá stejně
     (viz mojeSmena v app.js). */
  zaznamy = zaznamy.filter(function (a) {
    return a.akce === 'Příchod' || a.akce === 'Odchod';
  });

  var podleLidi = {};
  zaznamy.forEach(function (a) {
    if (!a.userDocId) return;
    (podleLidi[a.userDocId] = podleLidi[a.userDocId] || []).push(a);
  });

  Object.keys(podleLidi).forEach(function (kdo) {
    var mine = podleLidi[kdo].sort(poradiDochazky_);
    var posledni = mine[mine.length - 1];
    if (!posledni || posledni.akce !== 'Příchod') return;
    var telo = 'Příchod ' + (posledni.time || '')
      + (posledni.date !== dnesISO_() ? ' (' + datumCesky_(posledni.date) + ')' : '')
      + '. Nezapomněl jsi odejít?';
    posliCloveku_(kdo, 'Pořád jsi píchnutý na stavbě', telo, './', 'odchod');
  });
}

/* ---------- ODESLÁNÍ ---------- */
/* Jeden člověk může mít víc zařízení (telefon i počítač) — pošle se na
   všechna, která má zapnutá. */
function posliCloveku_(userDocId, titul, telo, url, znacka) {
  var doklady = fsDotaz_('pushtokeny', [
    { field: 'userDocId', op: 'EQUAL', str: userDocId }
  ]);
  doklady.forEach(function (d) { posliNaAdresu_(d.__id, titul, telo, url, znacka); });
}

function posliNaAdresu_(adresa, titul, telo, url, znacka) {
  if (!posliDavku_()) return;              // strop na jeden běh, viz níž
  var telo_ = {
    message: {
      token: adresa,
      /* Schválně JEN data, ne hotové upozornění. Kdyby se posílalo hotové,
         zobrazil by ho prohlížeč sám po svém a neuhlídali bychom ani
         slučování, ani kam ťuknutí vede. Text skládá service worker. */
      data: { titul: String(titul), telo: String(telo), url: String(url), tag: String(znacka) },
      webpush: { headers: { Urgency: 'high', TTL: '86400' } }
    }
  };
  var odp = UrlFetchApp.fetch(
    'https://fcm.googleapis.com/v1/projects/' + projectId_() + '/messages:send',
    {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + pristupovyToken_() },
      payload: JSON.stringify(telo_), muteHttpExceptions: true
    });
  var kod = odp.getResponseCode();
  if (kod === 200) return;

  /* Adresa zařízení propadne, když si člověk smaže Deník z plochy, přeinstaluje
     prohlížeč nebo dlouho appku neotevře. Google to hlásí jako 404 — takový
     doklad se musí zahodit, jinak by tu zůstal viset navždy a most by ho
     zkoušel při každém běhu znovu.

     Maže se JEN na 404, schválně ne na 400. Čtyřistovka totiž znamená
     „nesrozumitelný požadavek" — a to může být klidně chyba v tomhle kódu.
     Kdyby se mazalo i na ni, jedna překlepnutá úprava by při nejbližším
     běhu odpojila upozornění celé partě. Radši ať to křičí do logu. */
  if (kod === 404) {
    fsSmaz_('pushtokeny/' + adresa);
    console.warn('adresa propadla, mažu: ' + adresa.slice(0, 12) + '…');
    return;
  }
  console.error('FCM ' + kod + ': ' + odp.getContentText().slice(0, 300));
}

/* Strop na jeden běh. Kdyby se něco pokazilo (špatné datum, poškozený
   záznam), bez tohohle by most rozeslal stovky zpráv, než by si toho
   kdokoli všiml. Radši ať se to utne a je to vidět v logu. */
var _poslano = 0;
function posliDavku_() {
  _poslano++;
  if (_poslano <= LIMIT_NA_BEH) return true;
  if (_poslano === LIMIT_NA_BEH + 1) console.error('STROP: víc než ' + LIMIT_NA_BEH + ' upozornění v jednom běhu — zbytek zahozen. Něco je špatně.');
  return false;
}

/* ---------- FIRESTORE ---------- */
function fsDotaz_(kolekce, filtry) {
  var kde = filtry.map(function (f) {
    var hodnota = f.ts ? { timestampValue: f.ts } : { stringValue: f.str };
    return { fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: hodnota } };
  });
  var sq = { from: [{ collectionId: kolekce }], limit: 300 };
  /* Bez filtru se where vynechava uplne — prazdny compositeFilter Firestore
     odmita a "vsechno" se neda napsat jako podminka. */
  if (kde.length === 1) sq.where = kde[0];
  else if (kde.length > 1) sq.where = { compositeFilter: { op: 'AND', filters: kde } };
  var dotaz = { structuredQuery: sq };
  var odp = UrlFetchApp.fetch(FS_KORen + projectId_() + '/databases/(default)/documents:runQuery', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + pristupovyToken_() },
    payload: JSON.stringify(dotaz), muteHttpExceptions: true
  });
  if (odp.getResponseCode() !== 200) {
    throw new Error('Firestore ' + odp.getResponseCode() + ': ' + odp.getContentText().slice(0, 300));
  }
  var out = [];
  JSON.parse(odp.getContentText()).forEach(function (r) {
    if (!r.document) return;                       // prázdné výsledky mají jen readTime
    var o = rozbal_(r.document.fields || {});
    o.__id = r.document.name.split('/').pop();
    out.push(o);
  });
  return out;
}

function fsSmaz_(cesta) {
  UrlFetchApp.fetch(FS_KORen + projectId_() + '/databases/(default)/documents/' + cesta, {
    method: 'delete',
    headers: { Authorization: 'Bearer ' + pristupovyToken_() },
    muteHttpExceptions: true
  });
}

/* Firestore vrací hodnoty zabalené do typu ({stringValue:"x"}). Rozbalíme
   jen to, co potřebujeme — pole a mapy uvnitř nás nezajímají. */
function rozbal_(fields) {
  var o = {};
  Object.keys(fields).forEach(function (k) {
    var v = fields[k];
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('doubleValue' in v) o[k] = v.doubleValue;
    else if ('booleanValue' in v) o[k] = v.booleanValue;
    else if ('timestampValue' in v) o[k] = v.timestampValue;
    else if ('nullValue' in v) o[k] = null;
  });
  return o;
}

/* ---------- PŘIHLÁŠENÍ K GOOGLU ---------- */
/* Žádný klíč, žádné podepisování. Skript běží pod účtem, který ho založil,
   a Google mu dá dočasné oprávnění sám — v rozsahu, který je vypsaný
   v appsscript.json. Viz vysvětlení v hlavičce souboru. */
function pristupovyToken_() {
  return ScriptApp.getOAuthToken();
}
function projectId_() { return PROJEKT; }

/* ---------- DROBNOSTI ---------- */
/* Stejné řazení jako v aplikaci (attCmp): nejdřív podle dne a času píchnutí,
   a teprve při shodě podle toho, co se zapsalo dřív. Doplněný odchod tak
   nikdy nepředběhne příchod, ke kterému patří. */
function poradiDochazky_(a, b) {
  var ka = (a.date || '') + ' ' + zarovnejCas_(a.time);
  var kb = (b.date || '') + ' ' + zarovnejCas_(b.time);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
}
/* „7:05" a „17:05" se jako text řadí špatně — sedmička je až za jedničkou.
   Doplněná nula to srovná. */
function zarovnejCas_(t) {
  var c = String(t || '0:00').split(':');
  return ('0' + (c[0] || '0')).slice(-2) + ':' + ('0' + (c[1] || '0')).slice(-2);
}
function dnesISO_() {
  return Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd');
}
function datumCesky_(iso) {
  if (!iso) return '';
  var c = String(iso).split('-');
  return c.length === 3 ? Number(c[2]) + '. ' + Number(c[1]) + '.' : iso;
}
/* Název stavby do titulku — bez něj člověk neví, kam se má vydat.
   Stavby se během jednoho běhu čtou nanejvýš jednou, i kdyby úkolů byla
   spousta; běhů je 288 denně a zbytečné dotazy se sčítají. */
var _stavby = null;
function nazevStavby_(pid) {
  if (!pid) return '';
  if (!_stavby) {
    _stavby = {};
    try {
      fsDotaz_('projects', []).forEach(function (p) { _stavby[p.__id] = p.name || ''; });
    } catch (e) { console.warn('nazvy staveb se nepodarilo nacist: ' + e); }
  }
  return _stavby[pid] ? ' — ' + _stavby[pid] : '';
}
/* Když je celá dávka z jedné stavby, patří její název do titulku.
   Když jsou z různých, radši nic než název jedné náhodné. */
function spolecnaStavba_(ukoly) {
  var prvni = ukoly[0].pid || '';
  for (var i = 1; i < ukoly.length; i++) if ((ukoly[i].pid || '') !== prvni) return '';
  return prvni;
}
function pocetUkolu_(n) {
  if (n < 5) return n + ' nové úkoly';
  return n + ' nových úkolů';
}

/* ---------- ZALOŽENÍ SPOUŠTĚČŮ ----------
   Spusť jednou z editoru (Spustit → nastavSpoustece). Dá se to spustit
   klidně opakovaně — staré spouštěče téhle dvojice se nejdřív smažou,
   takže nikdy nevzniknou dva stejné, co by posílaly všechno dvakrát. */
function nastavSpoustece() {
  var moje = ['upozorneniUkoly', 'upozorneniOdchody'];
  var smazano = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (moje.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); smazano++; }
  });

  ScriptApp.newTrigger('upozorneniUkoly').timeBased().everyMinutes(5).create();
  /* Devatenáctá je schválně: parta v tu dobu bývá doma, ale ještě ne v posteli,
     a odchod si stihne opravit dřív, než se den uzavře. */
  ScriptApp.newTrigger('upozorneniOdchody').timeBased().atHour(19).everyDays(1)
    .inTimezone('Europe/Prague').create();

  console.log('Smazáno starých spouštěčů: ' + smazano);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    console.log('  · ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')');
  });
  console.log('Hotovo. Úkoly se kontrolují každých 5 minut, odchody večer v 19:00.');
}

/* ---------- RUČNÍ ZKOUŠKA ----------
   Spusť z editoru (Spustit → zkouskaUpozorneni) a koukni do logu.
   Nic neposílá — jen ověří, že se most dostane do databáze a že ví,
   kdo má upozornění zapnutá. */
function zkouskaUpozorneni() {
  console.log('Firebase projekt: ' + PROJEKT);
  var doklady = fsDotaz_('pushtokeny', []);
  console.log('Zařízení se zapnutými upozorněními: ' + doklady.length);
  doklady.forEach(function (d) { console.log('  · ' + (d.jmeno || '?') + ' — ' + (d.zarizeni || '?')); });
  console.log('Poslední kontrola úkolů: ' + (PropertiesService.getScriptProperties().getProperty('UKOLY_OD') || 'ještě neběželo'));
}
