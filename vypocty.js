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
        if (otevrena === null) otevrena = naMinuty(z.time);
        // druhy zacatek po sobe: prvni plati, tenhle se zahodi
      } else if (z.akce === akceDo) {
        if (otevrena !== null) {
          var konec = naMinuty(z.time);
          if (konec > otevrena) out.push({ od: otevrena, do: konec });
          otevrena = null;
        }
        // konec bez zacatku: zahodit
      }
    });
    if (otevrena !== null) nedokoncene = 1;
    return { useky: out, otevrenyOd: otevrena, nedokoncene: nedokoncene };
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

    /* Starsi zaznamy maji pauzu jako pocet minut u odchodu (drive to byl
       prepinac na pevnych 30 min). Kdyz nove pauzove zaznamy nejsou,
       pouzije se ta stara hodnota, at se historie nerozjede. */
    if (!useky.length) {
      var stara = z.reduce(function (m, r) { return Math.max(m, parseInt(r.pauza, 10) || 0); }, 0);
      pauzaMin = Math.min(stara, pracovniMin);
    }

    return {
      minuty: Math.max(0, pracovniMin - pauzaMin),
      pracovniMin: pracovniMin,
      pauzaMin: pauzaMin,
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
    spocitejDen: spocitejDen
  };
})(typeof window !== 'undefined' ? window : this);
