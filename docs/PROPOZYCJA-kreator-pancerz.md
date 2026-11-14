# Propozycja: ciągły pancerz z obrysu (kreator, temat 2)

Stan: PROTOTYP w kreatorze (2026-11-14, etap 1): pole projektu `shell` (`src/game/hullDesign/hullDesignShell.js`,
rozwijane w `expandHullDesign`), drednot przebudowany na skorupę z rowem osi; flota TN bez skorupy. Opis stanu: reguła
`kreator-kadlubow` § „Pancerz z obrysu”; A/B z kompozytora: `node scripts/webgpu/kreator-pancerz-ab.mjs`; test:
`tests/hullDesignShell.test.mjs`. Dokument niżej to propozycja z makietą (makieta CPU zastąpiona prototypem; kadry
makiety zostały w `.tmp/kreator/pancerz-makieta/`).

## Skąd „łatanina”

Ocena: „pancerz wciąż jest modułowy … generator musi mieć możliwość narysowania ciągłego kadłuba bez przerwań”.
Przyczyny w dzisiejszym kreatorze (drednot: ~70 klocków-płyt na burtę):

1. **Każdy klocek to osobna płyta.** Płyta = obrys klocka minus pas `gap / 2` wokół sąsiadów, więc między każdą parą
   jest szew (4 jd) albo ciemny rów (12 jd). Kompozytor liczy profil z pola płyty: każda dostaje własną ścianę, fazę,
   „poduszkę” (9 jd), linię przy krawędzi (5 jd), nity i grubą płytę. Ten sam ozdobny brzeg powtórzony 70 razy to
   właśnie wrażenie kafelków.
2. **Siatka paneli kompozytora idzie wzdłuż osi, nie wzdłuż burt.** Panele (`part1(x)`, `part1(|y|)`: 76 × 150 jd) to
   cegiełki ułożone równolegle do osi okrętu. Na ostrzu 1 : 4 przecinają burtę pod kątem, więc z bliska widać schodki.
3. **Rytm z równych kafli.** Pas burtowy ostrza to siedem równych równoległoboków, pas wewnętrzny jest schodkowy
   (na przemian poziom 1 i 2): z daleka czyta się powtarzalna płytka, a nie jedna skorupa.

**Co da się zdjąć samym projektem (makieta to robi):** jedna płyta zamiast wielu (suma geometryczna, bez szwów),
`panels: 0` (bez siatki wzdłuż osi), rytm z rowków projektu (`grooves`), otwarcia z klocków-wycięć.
**Co wymaga generatora:** policzenie skorupy i rytmu z sylwetki jako jednej cechy projektu, którą gracz może postawić
(dziś wynikiem jest wielokąt i rowki z setkami punktów — nie do zbudowania w edytorze), oraz wpusty z innym profilem niż rowek.

## Narzędzie „pancerz z obrysu”

Skorupa = sylwetka ramy (suma pełnych obrysów klocków) minus OTWARCIA. Otwarcia to zwykłe klocki-wycięcia poziomu 1:
rów osi (`axisTrench` — trapezy na osi z „pióra” stacji), wnęka silników, wnęki dysz. Brzeg płyty przy burcie jak
dziś (`clip 0` + 1,5 jd), więc alfa i belki się nie zmieniają. Rytm rysują rowki, liczone z ODLEGŁOŚCI OD BRZEGU SKORUPY
(transformata ośmiokątna — w narożach wklęsłych fazy 45° jak linie TN; za wąskie kawałki znikają same):

| parametr [jd] | co robi |
|---|---|
| `rim` | obwódka: izolinia wzdłuż całej sylwetki i wokół każdego otwarcia |
| `bands`, `bandStep` | pasy równoległe do burt (kolejne izolinie) |
| `ribStep` | żebra poprzeczne do osi w strefie pasów, krok od x = 0 |
| `inset { lo, hi, step, cut, axis, ch }` | wpusty „płyta w płycie”: strefa lo…hi od brzegu pocięta co `step` i wzdłuż osi, każdy kawałek w obwódce z fazą `ch` |
| `keel` | stępka: rowek wzdłuż osi tam, gdzie nie ma rowu |

Deterministyczne (bez losowania), lustro z konstrukcji (rowki z burty y ≤ 0, siatka symetryczna). Rytmy:
**A „obwódka i wpusty”** (jak wzór), **B „pasy wzdłuż burt”**, **C „pasy i żebra”** (`HD_SHELL_RHYTHMS`).

## Format i edytor

- Nowe pole projektu `shell: { rhythm, rim, bands, bandStep, ribStep, inset, keel, grooveW }` (brak pola — jak dziś).
  Przy włączonej skorupie klocki poziomu 1 stają się sylwetką (rama), płytę daje skorupa; klocki poziomu ≥ 2 to dalej
  nadbudówki leżące NA skorupie; klocki-wycięcia poziomu 1 to otwarcia.
- `isPlayerBuildable`: sprawdza tylko zakresy parametrów `shell` i nazwę rytmu (jak kasztel). Otwarcia to klocki na
  siatce — przechodzą dzisiejszy strażnik.
- Stocznia: w „Kształtach” karta „Pancerz z obrysu” (włącz/wyłącz) i trzy karty rytmu z miniaturami; na karcie okrętu
  suwaki obwódki, pasów, żeber i wpustów; karty „Rów osi” (trapezy-wycięcia na osi, uchwyty stacji) i „Wnęka”
  (wycięcie z fazą). Gracz nie rysuje linii: kładzie kształt i otwarcia, rytm liczy generator.

## Co zmienia się w kodzie (etap prototypu)

- `expandHullDesign` (`hullDesignSchema.js`): po `expandHullBlocks` przy `design.shell` — klocki poziomu 1 jako rama,
  płyta 'poly' poziomu 1 = sylwetka − wycięcia (suma geometryczna, bez szwów) i rowki rytmu do `expanded.grooves`
  (oznaczone `shell`). Kod z `hullDesignShell.js`.
- `hullDesignBuild.js`: `shell` w kluczu kształtu (`kGeo` przez `expanded.shapes`, rowki przez `kGroove`) — trafia tam
  sam, bo zmienia rozwinięcie; NIE może trafić do pomijanych przez `hullDesignLookKey`.
- `hullDesignGeometry.js`: bez zmian (rowki już mają etap i pole). Ewentualnie siatka odległości skorupy na siatce
  pola geometrii, żeby nie liczyć drugiej.
- Kompozytor — **dziś nic nie trzeba** (wszystkie kadry makiety to prawdziwy kompozytor, bez nakładki CPU). Do decyzji
  (pytania 4–5): profil „wpust” (płyta w obwódce obniżona albo podniesiona o ~1 jd zamiast samego rowka) — nowe pole
  znaku w teksturze rowków; ton wpustów (wzór ma jaśniejsze i ciemniejsze płyty) — mapa tonu z numeru wpustu.

## Sieć systemów i rama

- Rama bez zmian (rama z klocków, `hullFrameIntegrity` = 1 kawałek we wszystkich wariantach makiety).
- Rowy przestają być korytarzami: sieć idzie POD pancerzem (A* już dziś zna płytę — koszt 4 zamiast 1), widać ją tylko
  w otwarciach. `pipeNetworkCheck` = 0 na drednocie (A/B/C, z rowem i bez), Colossusie i Bellatorze. Wyjątek: dwie dysze
  SIDE drednota na skośnej burcie rufy — kanał serwisowy nie wystarczał (przyłącze 3–4 z 12 próbek widoczne), więc makieta
  dokłada jawne wnęki dysz. W prototypie: generator sam wycina wnękę przy przyłączu paliwa (SIDE, MAIN, zbiornik), gdy
  kanał serwisowy jej nie daje.

## Budżety (pomiar `--pomiar`, CPU, minimum z 7, Node)

| okręt / rytm | narzędzie | rowki (punkty) | siatka odległości |
|---|---|---|---|
| drednot A, bez rowu | 0,17–0,20 s | 18 (≈ 820) | 3 204 × 1 532, 2,5 j. |
| drednot A / B / C z rowem | 0,14–0,25 s | 21 / 23 / 127 (1 600–2 500) | jw. |
| Colossus A | 46 ms | 10 (324) | 1 874 × 776 |
| Bellator A | 79 ms | 14 (416) | 1 811 × 1 146 |

Budowa drednota 2,8 s → +0,2 s (~7%), raster rowków to ułamek tego (długość ~50–80 tys. j. × pas 12 j.). Bez nowych
tekstur i limitów kompozytora (modules 160, maxSide 8 192 bez zmian). Pamięć siatki ~5 mln komórek (Float32 + bajt) —
do zmniejszenia o połowę liczeniem tylko burty y ≤ 0.

## Ryzyka

- **Pusto z bliska:** bez siatki paneli i bez osobnych płyt duże pola są gładkie (`a1`, `e1` dół). Wzór ma ton i wpusty;
  rowki dają linie, nie ton (pytanie 5).
- **Małe okręty tracą charakter:** Colossus i Bellator stoją na kontraście osobnych płyt i rowów (`e1`, `e2`) — dlatego
  skorupa ma być opcją, flota TN bez zmian.
- **Ostre kąty:** pasy przy szpicu i w zębach zbiegają się w gęste klinki (wariant B, `d2-*`); żebra pod kątem do
  skośnej burty (C) czytają się jak drabina.
- Metryka ośmiokątna: na burcie 1 : 4 odstęp pasów odbiega od zadanego o kilka procent (linie zostają równoległe).
- Kolejność brył: płyta skorupy łączy się z nadbudówkami przez `min` pól — pod nadbudówką szwu nie widać, bo płyta leży
  pod nią w całości; nadbudówka sięgająca brzegu skorupy może dać szew (niesprawdzone; w prototypie: przyciąć do skorupy).

## Otwarte decyzje (dla użytkownika)

1. **Który rytm dla drednota?** A — obwódka i wpusty (`d1-*`), B — pasy wzdłuż burt (`d2-*`), C — pasy i żebra
   (`d3-*`); arkusze `d0-warianty-caly.png`, `d0-warianty-dziob.png`. *Rekomendacja: A — najbliżej wzoru (kilka dużych
   płyt w płycie, obwódka wzdłuż całej sylwetki); B jako opcja gracza.*
2. **Skorupa jako opcja projektu, flota TN bez zmian?** *Rekomendacja: tak — skorupa domyślnie wyłączona; włączona dla
   drednota (i nowych dużych okrętów), Colossus / Bellator / reszta floty zostają z klocków (`e1`, `e2`).*
3. **Drednot z rowem osi jak we wzorze (`c1`–`c3`)?** *Rekomendacja: tak — rów to jedyne otwarcie, w nim kręgosłup
   nadbudówek (rdzenie, mostek) i maszynownia z tematu 1; płyta wokół bez przerw.*
4. **Wpust: tylko rowek (dziś) czy płyta w obwódce podniesiona / obniżona o ~1 jd?** *Rekomendacja: podniesiona o ~1 jd
   (zmiana kompozytora w prototypie) — z daleka rowek ginie, stopień daje światło i cień jak we wzorze.*
5. **Ton wpustów (jaśniejsze / ciemniejsze płyty jak we wzorze) i siatka paneli na skorupie?** *Rekomendacja: ton
   wpustów tak (mapa tonu z numeru wpustu, warstwa barw — pędzel może go nadpisać); siatki paneli wzdłuż osi nie
   przywracać; panele wzdłuż burt — dopiero gdy z bliska nadal będzie pusto.*
6. **Wnęki przy przyłączach paliwa: sam generator czy gracz?** *Rekomendacja: generator (gdy kanał serwisowy nie
   wystarcza) — gracz nie powinien wiedzieć o widoczności przyłączy; gracz kładzie tylko duże otwarcia (rów, wnęka
   silników).*
7. **Nadbudówki na skorupie:** pas wewnętrzny ostrza „schodkowy” (poziom 2 na przemian) zdjęty w makiecie, zostały
   nadbudówki na osi i na skrzydle. *Rekomendacja: tak zostawić — schodki to część łaty.*

## Co w makiecie jest uproszczeniem

- Warianty projektu budowane w skrypcie (`applyHullShell`): skorupa jako wielokąt 'poly' i rowki z setkami punktów —
  `isPlayerBuildable` ich nie przepuszcza; w docelowym formacie to jedno pole `shell`.
- Rów osi i wnęki ustawione ręcznie w skrypcie (stacje rowu dobrane pod gniazda broni i rdzenie), nie zaprojektowany
  kadłub; maszynownia w rowie to dzisiejsza (temat 1 — osobna makieta).
- Rytm Colossusa i Bellatora w mniejszej skali jd (obwódka 26 jd zamiast 44) — skala z długości to decyzja prototypu.
