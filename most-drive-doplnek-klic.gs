/* ============================================================
   DOPLNĚK PRO „Vrana Drive Most (denik)" — klíč proti duplikátům
   ============================================================
   PROČ: Google občas místo odpovědi mostu vrátí stránku „nenalezeno".
   Fotka se na Disk nahrála, ale aplikace se to nedozvěděla, a tak ji
   za 90 s poslala znovu — na Disku pak byla dvakrát i třikrát a v appce
   pořád „čekala na odeslání" (Falát, 6.–7. 10. 2026).

   CO DĚLÁ: aplikace posílá s každým souborem svůj klíč (pole `klic`).
   Most ho uloží do popisu souboru. Když přijde stejný klíč podruhé,
   soubor znovu nezakládá a vrátí ten, který už existuje. Aplikace se
   navíc umí zeptat jen podle klíče (akce `findByKey`), aniž by posílala
   znovu 3 MB dat.

   JAK NASADIT (ve skriptu mostu, Rozšíření → Apps Script):
   1. Celý tento soubor vložit jako nový soubor skriptu (Soubor → +).
   2. V doPost, hned za rozpoznání akce, přidat tyto dva řádky:

        if (p.action === 'findByKey') return odpovedJson(najdiPodleKlice(p.klic));

      a v obsluze akce `upload` PŘED vytvořením souboru:

        var uz = p.klic ? najdiPodleKlice(p.klic) : null;
        if (uz && uz.fileId) return odpovedJson({ ok: true, fileId: uz.fileId, jizBylo: true });

      a PO vytvoření souboru (proměnná se souborem se jmenuje podle kódu
      mostu, typicky `file`):

        if (p.klic) file.setDescription('klic:' + p.klic);

   3. Implementovat → Spravovat implementace → tužka → Verze: Nová → Implementovat.
      Adresa mostu se tím NEMĚNÍ.

   Dokud doplněk není nasazen, aplikace funguje jako dřív (na neznámou
   akci most odpoví chybou a fronta to tiše přejde). */

function odpovedJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Najde soubor podle klíče uloženého v popisu. Hledá po celém Disku,
   ke kterému má skript přístup (včetně sdílených disků), jen nesmazané. */
function najdiPodleKlice(klic) {
  if (!klic || !/^[a-f0-9]{16,48}$/.test(String(klic))) return { ok: true, fileId: '' };
  var it = DriveApp.searchFiles("fullText contains 'klic:" + klic + "' and trashed = false");
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getDescription() || '') === 'klic:' + klic) return { ok: true, fileId: f.getId() };
  }
  return { ok: true, fileId: '' };
}
