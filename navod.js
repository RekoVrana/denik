/* ============ KRÁTKÝ NÁVOD PRO PARTU A SUBDODAVATELE ============
   Jen to, co člověk dělá KAŽDÝ DEN. Vejde se na jednu obrazovku telefonu.
   Vyčerpávající manuál to není a být nemá — kdo si ho přečte celý, ten už
   appku umí.

   Texty jsou psané pro lidi, kteří s aplikací nikdy nedělali, a část party
   jsou Ukrajinci, kteří česky mluví, ale hůř čtou. Proto krátké věty,
   žádné cizí slovo a názvy tlačítek DOSLOVA tak, jak jsou na obrazovce
   (viewWorker / viewSub v app.js) — ať člověk hledá to samé, co vidí.

   Použití:  navodHtml('worker')  |  navodHtml('sub')   → vrací HTML (string)

   Třídy jsou stejné jako ve zbytku aplikace (card, urow, note, badge, muted),
   takže návod vypadá jako další karta, ne jako cizí těleso. */

/* Jeden krok návodu = řádek s emoji vlevo a textem vpravo. */
function navodKrok(emoji, nadpis, text) {
  return `<div class="urow" style="align-items:flex-start">
      <span style="font-size:19px;flex:none">${emoji}</span>
      <div><b>${nadpis}</b><br><span class="muted">${text}</span></div>
    </div>`;
}

/* Společný konec — je stejný pro obě role. */
function navodPata() {
  return navodKrok('💬', 'Něco nefunguje?',
      'Nahoře v liště ťukni na <b>💬</b>. Napiš, co se stalo, a ťukni <b>📤 Odeslat</b>. '
    + 'Uvidí to vedení a ozve se ti.')
  + `<div class="note">Když nemáš signál, nic se neztratí. Appka si to podrží v telefonu
      a odešle sama, až budeš mít internet.</div>`;
}

/* ---- PARTA (píchá docházku) ---- */
function navodWorker() {
  return `<div class="card">
    <h3 onclick="navodPrepni()" style="cursor:pointer;display:flex;align-items:center;gap:8px">
      📖 Návod — jak na to každý den (FAQ)
      <span class="muted" style="margin-left:auto;font-weight:400;font-size:13px">${navodOtevreny() ? 'skrýt ▲' : 'ukázat ▼'}</span></h3>
    <div style="${navodOtevreny() ? '' : 'display:none'}">

    ${navodKrok('📍', 'Přijdeš na stavbu',
        'Nahoře vyber stavbu. Ťukni <b>📍 ZAPSAT PŘÍCHOD</b>. '
      + 'Otevře se foťák — vyfoť se. <b>Bez fotky se příchod nezapíše.</b> '
      + 'Telefon zároveň zkontroluje, že jsi opravdu na té stavbě.')}

    ${navodKrok('🥪', 'Jdeš na oběd',
        'Ťukni na řádek <b>🥪 Začít pauzu</b> a potvrď. Až se vrátíš do práce, '
      + 'ťukni na ten samý řádek znovu. Čas pauzy se ti odečte z hodin.')}

    ${navodKrok('✍️', 'Napiš, co jsi dělal',
        'Dole je karta <b>✍️ Nový zápis do deníku</b>. Piš krátce, každá věta je jedna odrážka. '
      + 'Pak ťukni <b>📷 Vyfotit / vybrat z galerie</b> a přidej fotky — nejvíc 8, '
      + 'aspoň jedna musí být. '
      + 'Nakonec <b>📤 ODESLAT ZÁPIS</b>.')}

    ${navodKrok('📷', 'Fotka je povinná',
        'Bez fotky zápis odeslat nejde. Podle fotek vedení pozná, co je hotové, '
      + 'a ukazuje je zákazníkovi. Vyfoť, co jste dnes udělali.')}

    ${navodKrok('🏁', 'Odcházíš domů',
        'Ťukni <b>🏁 ZAPSAT ODCHOD</b>. Znovu se otevře foťák, vyfoť se. Tím máš den hotový.')}

    ${navodKrok('🕗', 'Zapomněl jsi odchod',
        'Druhý den nahoře uvidíš <b>Neuzavřený den</b>. Ťukni '
      + '<b>🕗 POŽÁDAT O DOPLNĚNÍ ODCHODU</b>, napiš, v kolik jsi odešel a proč jsi nepíchnul. '
      + 'Vedení to schválí a den se uzavře. <b>Do té doby se ti ty hodiny nepočítají.</b> '
      + 'Nový příchod si dneska zapíšeš normálně, čekání ti ho neblokuje.')}

    ${navodKrok('📌', 'Co máš pod docházkou',
        '<b>📌 Úkoly</b> — hotový úkol odškrtni čtverečkem vlevo. '
      + '<b>🔑 Klíče u mě</b> — když klíč někomu dáš, hned ťukni <b>Předat</b>. '
      + '<b>📐 Podklady stavby</b> — ťukni <b>📂 Zobrazit podklady</b>, jsou tam výkresy. '
      + '<b>📝 Poznámky ke stavbě</b> — kódy, kontakty, kde se zavírá voda.')}

    ${navodPata()}
    </div>
  </div>`;
}

/* ---- SUBDODAVATEL (hodiny nepíchá, hlásí návštěvu stavby) ---- */
function navodSub() {
  return `<div class="card">
    <h3 onclick="navodPrepni()" style="cursor:pointer;display:flex;align-items:center;gap:8px">
      📖 Návod — jak na to každý den (FAQ)
      <span class="muted" style="margin-left:auto;font-weight:400;font-size:13px">${navodOtevreny() ? 'skrýt ▲' : 'ukázat ▼'}</span></h3>
    <div style="${navodOtevreny() ? '' : 'display:none'}">

    ${navodKrok('🧰', 'Přijedete na stavbu',
        'Vyber stavbu. Do malého políčka vedle napiš, <b>kolik vás tu je</b> — i s tebou. '
      + 'Do řádku pod tím napiš, <b>co tu dnes budete dělat</b>. '
      + 'Ťukni <b>✅ ZAPSAT PŘÍCHOD</b>.')}

    ${navodKrok('🏁', 'Odjíždíte',
        'Ťukni <b>🏁 ZAPSAT ODCHOD</b>. Appka se zeptá <b>Co jste dnes udělali?</b> — '
      + 'napiš aspoň jednu větu, klidně krátkou.')}

    ${navodKrok('📷', 'Přidej fotky',
        'Ve stejném okně ťukni <b>📷 Vyfotit / vybrat z galerie</b> a přidej fotky toho, '
      + 'co jste udělali — nejvíc 8. <b>Bez fotky odchod zapsat nejde.</b> '
      + 'Podle fotek vedení pozná, že je práce hotová, a ukazuje je zákazníkovi. '
      + 'Nakonec ťukni <b>🏁 ODESLAT A ZAPSAT ODCHOD</b>.')}

    ${navodKrok('📓', 'Kam to jde',
        'Tvůj text i fotky jdou vedení jako zápis do deníku stavby. '
      + 'Vedení to schválí a je to hotové.')}

    ${navodKrok('📌', 'Co máš níž na obrazovce',
        '<b>📌 Úkoly</b> — hotový úkol odškrtni čtverečkem vlevo. '
      + '<b>🔑 Klíče u mě</b> — když klíč někomu dáš, hned ťukni <b>Předat</b>. '
      + '<b>📐 Podklady stavby</b> — ťukni <b>📂 Zobrazit podklady</b>, jsou tam výkresy. '
      + '<b>📝 Poznámky ke stavbě</b> — kódy, kontakty, kde se zavírá voda. '
      + '<span class="badge b-wait">pozor</span> Podklady a poznámky se ukážou, '
      + 'až nahoře vybereš stavbu.')}

    ${navodPata()}
    </div>
  </div>`;
}

/* Rozcestník. Cokoli jiného než 'sub' bere jako partu — kdyby se role
   někdy přejmenovala, dostane člověk radši návod party než prázdno. */
/* Návod si každý zavře, až ho nepotřebuje — a telefon si to zapamatuje.
   Poprvé je otevřený, ať ho člověk vůbec uvidí. */
/* Stav se drží i v paměti. Na starším iPhonu v soukromém režimu localStorage
   zápis odmítne — bez téhle pojistky by šipka pořád hlásila „skrýt" a ťuknutí
   by nedělalo nic. */
let _navodOtevren = null;
function navodOtevreny() {
  if (_navodOtevren !== null) return _navodOtevren;
  try { return localStorage.getItem('denik_navod') !== 'zavreno'; } catch (e) { return true; }
}
function navodPrepni() {
  _navodOtevren = !navodOtevreny();
  try { localStorage.setItem('denik_navod', _navodOtevren ? 'otevreno' : 'zavreno'); } catch (e) {}
  if (typeof render === 'function') render();
}
function navodHtml(role) {
  return role === 'sub' ? navodSub() : navodWorker();
}
