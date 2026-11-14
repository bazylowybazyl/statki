# Dzielnica ringu „Zakłady elektroniki” (`?d=elektronika`) — prototyp układu, niewpięty w grę

Drugi przemysł Ziemi (22% mocy): układy scalone, optyka, taśma nadprzewodząca. Dzielnica „czysta”: równe jasne hale,
siatki wentylatorów, szkło i chłodne światło; w przestrzeń wystają trzy pola radiatorów i tunel kolimatora.
Kontrakt wtyczki i zestaw wspólny: `../README.md`. Test: `node --test tests/ringDzielnicaElektronika.test.mjs`.

## Co stoi (łuk 14 400 j., s −7 200…+7 200; zasięg w przestrzeń do v = 13 700)

| Część | Gdzie (s; v) | Co |
|---|---|---|
| Rząd przy ringu | cały łuk; 0…1 000 | 3 magazyny wyrobów (UKŁADY 2 160 × 650 j., OPTYKA 1 040 × 650, TAŚMA 1 960 × 650) ze wskaźnikiem zapasu, 13 doków S / M / L (ekspedycja kurierska, laboratoria), pawilony laboratoriów za dokami, dyspozytornia, 3 łączniki nad drogą do zakładów (FG, na wieżach) |
| Pas frontowy zakładów | cały łuk; 3 600…4 700 | 6 doków dostaw od drogi (po L + M na zakład), przyjęcia wsadu, śluza ekspedycji układów, ekspedycje optyki i taśmy |
| Fabryka układów | −7 200…−2 400; do 8 600 | dwie hale czyste 2 260 × 2 400 i 2 540 × 2 400 j. z magistralą mediów i dwoma mostami przerzutu, port krzemu (2 doki L od strony przestrzeni, 12 silosów), oddział oczyszczania krzemu (4 kolumny, 2 reaktory, wymiennik) |
| Zakład optyki | −2 400…+2 200; do 7 600 | hodowla kryształu (10 pieców), szlifiernia z dachem pilastym, napylarnia próżniowa (4 komory), montaż i metrologia z wieżą; kopuła prób (promień 470 j., v 7 600…8 850) i tunel kolimatora na pirsie do v = 12 900 |
| Stacja zasilania | +700…+2 200; 7 600…9 400 | reaktor, maszynownia, 12 transformatorów, szyny zasilania wzdłuż tylnych krawędzi pokładów |
| Zakład taśmy | +2 200…+7 200; do 8 200 | hala powlekania 2 960 × 1 100 j. z trzema wieżami, plac szpul 1 860 × 1 250 j. z suwnicą bramową, kriogenika (sprężarkownia, 3 kolumny chłodu, 3 baterie wymienników, 3 skraplacze), farma 8 zbiorników helu i azotu |
| Pola radiatorów | trzony w s = −3 700, +1 500, +5 000 | układy: 6 par paneli 950 × 560 j. (v 8 600…13 700); zasilanie: 4 pary 760 × 520 (9 400…12 700); kriogenika: 6 par 900 × 540 (8 200…13 300) |

Budowle (4): rząd przy ringu, fabryka układów, zakład optyki ze stacją zasilania, zakład taśmy — po ~1,1–1,5 tys.
instancji (budżet 6 tys.), po 8 lamp, grupy ruchome: kopuła 1, suwnica 3.

## Towary i drogi

| Towar | Kierunek | Droga |
|---|---|---|
| `silicon_ore` | wsad | kolej (przystanek s −6 550, strona zakładów), doki L od przestrzeni (port krzemu), dok L od drogi |
| `nickel_ore` | wsad | zatoka ciężarówek s −3 950, dok M od drogi |
| `raw_crystal` | wsad | kolej s +500, zatoka s −1 950, doki L / M od drogi |
| `rare_earth_ore` | wsad | kolej s +5 500 |
| `copper_wire`, `nickel_superalloy` | wsad (z huty) | zatoki s +2 750 i s +6 300, doki M / L od drogi |
| `chips` | wyrób | zatoka przy śluzie s −2 900; łącznikiem do magazynu → zatoka s −3 900 i kolej s −4 750 (strona ringu), doki kurierskie S / M |
| `optic_lens` | wyrób | zatoka s +1 800; łącznikiem do magazynu → zatoka s −200, doki kurierskie |
| `superconductor` | wyrób | zatoka s +6 850; łącznikiem do magazynu → zatoka s +5 300 i kolej s +4 300, doki kurierskie |

## Ruch w demie (`ruch.js`, czasy umowne; tempo z panelu)

Trzy linie robią partie (praca → wysyłka → co 5 partii przezbrojenie; lampy stanu na halach i łącznikach, rząd lampek
postępu na attyce). Radiatory żarzą się w takt kroków linii (kanał `fill`: im większe obciążenie, tym dalej od trzonu
sięga żar). Magazyny pokazują zapas; pełny magazyn opróżnia kurs transportu. Po partii soczewek kopuła obraca szczelinę
i w tunelu kolimatora biegną światła próby. Suwnica wozi szpule od wylotu hali do rampy ekspedycji. Statki: trzech
dostawców na drodze i masowiec z rudą krzemu w doku od strony przestrzeni (przylot, postój, odejście rufą).

## Zasady i pułapki tej wtyczki

- Budynki są prostokątne w RAMCE PROSTEJ (`frameAt(sc, vc)`: u wzdłuż stycznej, w wzdłuż promienia, jednostki świata);
  pokłady to wycinki pierścienia. Budynek zgłasza obrys (`K.claim`, `hala({ name })`) — test sprawdza, że leży na bryłach.
- Materiały w shaderze budowli: `steel` to płyty (ciemniejsze), `rail` jest gładki i w świetle lamp najjaśniejszy —
  z niego są dachy głównych hal i płyty placów; `floor` i `deckPad` wychodzą prawie czarne (nie używać na płyty placów);
  `copper` i `paint` dają beż — tylko jako kolektory i żebra wymienników.
- Lampy (`pushLamp`) muszą wisieć WYSOKO nad dachami (y ≈ 1 000–1 500), bo światło liczy się z kąta padania;
  rodzaj 2 = chłodne, 1 = ciepłe.
- Napis na płycie placu potrzebuje y = `DECK + 7` (domyślne y leży pod płytą).
- Pas `EL.keep` = 280 j. przy licu drogi jest wolny od budynków: stoją tam wysięgniki zatok, obudowy wind peronów
  i wieże łączników. Gospodarz nie stawia bramownic (`lintelSkip` na całą długość) — wypadałyby nad wylotami doków.
- Suwnica jedzie po prostej (±800 j. w ramce placu), nie po łuku — tory placu też są proste.
