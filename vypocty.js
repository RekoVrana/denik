/**
 * VYPOCTY — cista matematika dochazky.
 *
 * Zamerne tu neni zadna databaze ani okno prohlizece: jen data dovnitr,
 * cislo ven. Diky tomu se to da otestovat samostatne v test.html, kde
 * uvidis zelena a cervena. Kdyz nekdo tenhle vypocet rozbije, test to
 * chytne driv, nez to dojde do vyplaty.
 */
(function (root) {
  'use strict';

  /* "7:05" -> 425. Hodina musi mit vedouci nulu jen v ulozenych datech,
     tady si poradime i bez ni. */
  function naMinuty(t) {
    var p = String(t || '').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  /* Minuty zaznamu VCETNE posunu o dny. Smena pres pulnoc se pocita
     k dni prichodu, takze odchod v 6:00 nasledujiciho rana je 30:00 —
     osm hodin od prichodu ve 22:00. Bez toho se noc rozpadla na dva
     prazdne dny a hodiny zmizely uplne. */
  function minutyZaznamu(z) {
    return naMinuty(z && z.time) + 1440 * ((z && z._posun) || 0);
  }
  function naCas(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
  }

  /* Poradi zaznamu urcuje LOGICKY cas udalosti (datum + cas), ne cas
     zapisu do databaze. Rucne doplneny zaznam (zapomenuty prichod) ma cas
     zapisu klidne o den pozdeji nez udalost — razeni podle zapisu by pak
     potkalo Odchod pred Prichodem a den spocitalo jako nulu.
     Casy se scitaji jako CISLA, takze stara chyba "16:00" pred "7:00"
     (textove razeni bez vedouci nuly) se vratit nemuze. */
  function poradi(z) {
    var d = new Date((z && z.date) || '1970-01-01');
    return d.getTime() / 1000 + naMinuty(z && z.time) * 60;
  }
  /* Cas zapisu do databaze — jen ROZHODCI pri shode na stejnou minutu
     (dve pichnuti ve stejne minute). Zaznam bez serveroveho casu je
     cerstvy lokalni zapis, tedy nejnovejsi. */
  function casZapisu(z) {
    if (z && z.createdAt && z.createdAt.seconds) {
      return z.createdAt.seconds + (z.createdAt.nanoseconds || 0) / 1e9;
    }
    return Number.MAX_SAFE_INTEGER;
  }

  /* Poskladá dvojice zacatek->konec. Druhy zacatek po sobe se ignoruje,
     konec bez zacatku taky — kdyz clovek pichne dvakrat, nesmi to hodiny
     zdvojnasobit ani je poslat do zaporu. */
  function dvojice(zaznamy, akceOd, akceDo) {
    var serazene = zaznamy.slice().sort(function (a, b) {
      return (poradi(a) - poradi(b)) || (casZapisu(a) - casZapisu(b));
    });
    var out = [], otevrena = null, nedokoncene = 0;
    serazene.forEach(function (z) {
      if (z.akce === akceOd) {
        if (otevrena === null) otevrena = minutyZaznamu(z);
        // druhy zacatek po sobe: prvni plati, tenhle se zahodi
      } else if (z.akce === akceDo) {
        if (otevrena === null) {
          /* Konec bez zacatku: hodiny z nej neudelame, ale den je NEUPLNY.
             Driv zmizel uplne beze stopy — a report pritom slibuje, ze na
             dny "jen prichod nebo jen odchod" upozorni. */
          nedokoncene = 1;
        } else {
          var konec = minutyZaznamu(z);
          if (konec > otevrena) out.push({ od: otevrena, do: konec });
          else nedokoncene = 1;      /* konec driv nez zacatek je taky neuplny den */
          otevrena = null;
        }
      }
    });
    if (otevrena !== null) nedokoncene = 1;
    return { useky: out, otevrenyOd: otevrena, nedokoncene: nedokoncene };
  }

  /* Kolik celych dni je mezi dvema daty (YYYY-MM-DD). Pocita se v UTC,
     aby letni cas neposunul vysledek o den. */
  function dnyMezi(od, doo) {
    var a = new Date(od + 'T00:00:00Z'), b = new Date(doo + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
  }
  /* Smena pres pulnoc. Hodiny se pocitaji po dnech, takze prichod ve 22:00
     a odchod v 6:00 rano se driv rozpadl na dva prazdne dny a osm hodin
     zmizelo beze stopy. Tady se kazdemu zaznamu urci, ke KTEREMU DNI patri
     (vzdy den prichodu) a o kolik dni pozdeji se stal.

     Pres pulnoc se paruje jen odchod do 24 hodin od prichodu. Delsi mezera
     neni nocni smena, ale zapomenuty odchod — ten musi zustat neuzavrenym
     dnem, jinak by se clovek s vybitym telefonem dostal k desitkam hodin.
     Novy prichod predchozi smenu vzdycky uzavira: kdo si pichnul v pondeli
     a odchod zapomnel, ma pondeli neuplne a utery zacina nanovo. */
  function pripravSmeny(zaznamy) {
    var serazene = (zaznamy || []).slice().sort(function (a, b) {
      return (poradi(a) - poradi(b)) || (casZapisu(a) - casZapisu(b));
    });
    var otevrena = null;
    var doDvacetiCtyr = function (z) {
      return otevrena !== null && (poradi(z) - poradi(otevrena)) <= 24 * 3600;
    };
    return serazene.map(function (z) {
      var zaklad = z.date;
      if (z.akce === 'Příchod') {
        otevrena = z;
      } else if (z.akce === 'Odchod') {
        if (doDvacetiCtyr(z)) zaklad = otevrena.date;
        otevrena = null;
      } else if (doDvacetiCtyr(z)) {
        zaklad = otevrena.date;      /* pauza patri k bezici smene */
      }
      var kopie = {};
      for (var k in z) if (Object.prototype.hasOwnProperty.call(z, k)) kopie[k] = z[k];
      kopie._smenaDen = zaklad;
      kopie._posun = z.date ? dnyMezi(zaklad, z.date) : 0;
      return kopie;
    });
  }
  /* Rozdeli zaznamy jednoho cloveka na jedne stavbe na SMENY (ne na
     kalendarni dny) a kazdou spocita. Vraci pole { den, ...vysledek }. */
  function spocitejSmeny(zaznamy) {
    var podleDne = {};
    pripravSmeny(zaznamy).forEach(function (z) {
      (podleDne[z._smenaDen] = podleDne[z._smenaDen] || []).push(z);
    });
    return Object.keys(podleDne).sort().map(function (den) {
      var v = spocitejDen(podleDne[den]);
      v.den = den;
      return v;
    });
  }
  function delka(useky) {
    return useky.reduce(function (s, u) { return s + (u.do - u.od); }, 0);
  }

  /* Kolik minut pauzy padne DOVNITR pracovnich useku. Pauza mimo pracovni
     dobu se neodecita — jinak by mohla ubrat hodiny, ktere clovek stejne
     neodpracoval, nebo dokonce srazit den do zaporu. */
  function prekryvMinut(pauzy, prace) {
    var soucet = 0;
    pauzy.forEach(function (p) {
      prace.forEach(function (u) {
        var od = Math.max(p.od, u.od), doo = Math.min(p.do, u.do);
        if (doo > od) soucet += doo - od;
      });
    });
    return soucet;
  }

  /**
   * Spocita jeden den jednoho cloveka na jedne stavbe.
   * Vraci minuty, z toho pauzy, a jestli den zustal neuzavreny.
   */
  function spocitejDen(zaznamy) {
    var z = zaznamy || [];
    var prace = dvojice(z, 'Příchod', 'Odchod');
    var pauzy = dvojice(z, 'Pauza', 'Konec pauzy');

    /* Pauza, kterou clovek zapomnel ukoncit, konci poslednim odchodem.
       Bez toho by bezela dal a den by se pocital spatne. */
    var useky = pauzy.useky.slice();
    if (pauzy.otevrenyOd !== null && prace.useky.length) {
      var posledniOdchod = prace.useky[prace.useky.length - 1].do;
      if (posledniOdchod > pauzy.otevrenyOd) {
        useky.push({ od: pauzy.otevrenyOd, do: posledniOdchod, dopocitana: true });
      }
    }

    var pracovniMin = delka(prace.useky);
    var pauzaMin = prekryvMinut(useky, prace.useky);

    /* Rucne zadana pauza PREBIJI casovac. Vyplnuje ji vedeni pri oprave
       zaznamu, pri rucnim pridani dne a schvalenim zadosti o doplneny odchod —
       vzdycky proto, ze vi neco, co casovac nevi (parta byla na obede hodinu
       a nikdo nic nezmackl). Driv se cislo tise zahodilo, kdyz ten den
       existoval pauzovy zaznam z casovace. Nula = nechat casovac.
       Zaroven tim dal funguji stara data, kde pauza byla jen cislo
       u odchodu (drive to byl prepinac na pevnych 30 minut). */
    var rucni = z.reduce(function (m, r) { return Math.max(m, parseInt(r.pauza, 10) || 0); }, 0);
    if (rucni > 0) pauzaMin = Math.min(rucni, pracovniMin);

    return {
      minuty: Math.max(0, pracovniMin - pauzaMin),
      pracovniMin: pracovniMin,
      pauzaMin: pauzaMin,
      pauzaRucni: rucni > 0,
      useky: prace.useky,
      nedokonceno: prace.nedokoncene === 1,
      pauzaBezi: pauzy.otevrenyOd !== null && !prace.useky.length
    };
  }

  root.Vypocty = {
    naMinuty: naMinuty,
    naCas: naCas,
    poradi: poradi,
    dvojice: dvojice,
    dnyMezi: dnyMezi,
    pripravSmeny: pripravSmeny,
    spocitejSmeny: spocitejSmeny,
    spocitejDen: spocitejDen
  };
})(typeof window !== 'undefined' ? window : this);
