# Plan: pas asteroid i małe ciała — realizm (2026-10-12)

Plan prowadzi sesja-orkiestrator **„Asteroidy w Układzie Słonecznym”**. Do niej pisze się (`SendMessage`) przy blokadzie,
potrzebie cudzego pliku i po końcu etapu. Status niżej aktualizuje orkiestrator.

Punkt wyjścia: porównanie z prawdziwym Układem (2026-10-09). Już w grze: Hildy w wierzchołkach L3 / L4 / L5 (44,4 AU mapy,
`priority`), luki Kirkwooda (`kirkwoodGaps`), krawędź pasa 41,5 AU mapy (`mainOuterAu`) — `AGENTS.md` § „Pas asteroid”.

## Decyzje użytkownika (2026-10-12)

- Typy skał **C, M, V, D** i skład zmienny z odległością od Słońca — robimy. Najpierw modele w demie
  (`dema/asteroidy-webgpu`), potem gra. Ekonomię (ceny, popyt, receptury) użytkownik dostroi po wdrożeniu — tu tylko
  wpisy surowców z cenami tymczasowymi (`// AGENT: cena tymczasowa`).
- **Ceres, Westa, Pallas, Hygiea, Psyche** jako ciała; na największym (Ceres) **stolica Unii Pasa**.
- **Rumowiska** w wydobyciu — robimy (inna taktyka niż przy monolicie).
- **Wolniejszy obrót** skał — tak; bączki z grzbietem równikowym i pary z księżycem — tak.
- **Pole = rodzina kolizyjna** — plan orkiestratora (etap A2 niżej).
- **Komety** — model i wdrożenie.
- **NEA** przy Ziemi — tak, pilnując okolicy K-7 i startu kampanii.
- **Hungarie, szersi Trojańczycy z przewagą L4, budowa pasa Kuipera, Pluton** — tak.
- Zostaje bez zmian (wcześniejsze decyzje): gęstość pól, mrok rdzenia pola, burze i skały energetyczne, kryształ, uran
  tylko w Kuiperze, małe skały pod płaszczyzną gry, kolizje kadłubów tylko z olbrzymami, rozciągnięte AU mapy, lekkie
  skały (masa pod ładownię), neutralne obrzeże pola (najpierw skała płonna, ruda głębiej), piorun kulisty wyłączony w grze.

## Wspólne umowy

- **Prawdziwe AU → AU mapy:** liniowo między sąsiednimi planetami gry. Mars (1,524 AU) = 33, Jowisz (5,203 AU) = 50,2:
  mapa = 33 + (a − 1,524) · 4,675. Ziemia (1 AU) = 25 → między Ziemią a Marsem 15,27 AU mapy na AU.
  Wartości: Ceres 38,81 · Pallas 38,84 · Westa 36,92 · Hygiea 40,55 · Psyche 39,55 · Hungarie 34,2–35,2 · pas 35,5–41,5 ·
  Kirkwood 37,57 / 39,08 / 39,70 / 41,20 · Hildy 44,4 · NEA (q < 1,3 AU) ≈ 23–29,6.
- **Kuiper w grze** (125–140 AU mapy, Neptun 120): pas plutonków (3:2) 125,5–128,5 z **Plutonem na ~127**; pas klasyczny
  130–137 (zimny klasyczny — czerwony, wąski rdzeń ~132–135); urwisko ~137,5; dysk rozproszony rzadko do 140.
  Geometria — strumień E; Plutona stawia strumień C w paśmie plutonków.
- **Małe ciała** (Ceres, Westa, Pallas, Hygiea, Psyche, Pluton): dane w JEDNYM module `src/data/smallBodies.js` (tworzy C:
  id, nazwa, a w AU mapy, kąt, promień w grze, typ spektralny, rola). Czytają go: pas (wyłączenia skał wokół ciał,
  rodziny A2), ruch v2 (węzły Ceres / Westa), radar.
- **Nazwy nowych typów skał i surowców** ustala A1 i wpisuje tu (tabela „Typy”); inne strumienie używają ich po nazwie.

## Strumienie, pliki, kolejność

Każda sesja edytuje TYLKO swoje pliki. Wspólne: `index.html` (każdy swój blok), `AGENTS.md` (każdy swój akapit).

| Strumień | Sesja | Etapy | Pliki (właściciel) |
|---|---|---|---|
| **A** skład pasa | „Pas: typy skał C/M/V/D i skład” | A1 teraz: typy, modele w demie → gra, skład z odległością. A2 po A1: pole = rodzina | `src/game/asteroidRockKinds.js` (typy, etykiety, tier, WIERSZE `FAMILY_WEIGHTS_BY_TYPE`), `src/data/asteroidTypes.js` (`ASTEROID_TYPES`, pole `types` w `BELT_DEFINITIONS`, martwe pola), `src/game/asteroidBeltField.js` — tylko wybór typu (`_pickType`, prowincje / rodziny), `src/data/asteroidPhysics.js`, `src/game/asteroidMaterials.js` — tabele PER TYP, `src/3d/asteroids/rockMaterial.js` + `minerals.js`, `dema/asteroidy-webgpu/rockMaterial.js` + `minerals.js`, `src/data/resources.js` (rudy), `src/3d/asteroids/asteroidBelt.js` — tylko `GLOW_ROCK`, `src/game/asteroidStorms.js` (komentarz), `docs/webgpu/DEMO-ASTEROIDY.md` |
| **D** budowa i ruch skał | „Pas: rumowiska, bączki, pary, obrót” | D1 teraz: rumowiska w wydobyciu, rodzina kształtu „bączek”, głazy. D2 po sygnale (po A1): kolumna nowej rodziny, wolniejszy obrót i koziołkowanie, pary z księżycem | D1: `src/game/asteroidMining.js`, `asteroidMiningRig.js`, NOWY blok rumowisk w `asteroidMaterials.js` (nie tabele per typ), `src/3d/asteroids/rockBank.js` + `minedRocks.js` + `miningView.js`, `dema/asteroidy-webgpu/rockBank.js` + `minedRocks.js` + `miningRig.js` + `fragments.js`, `docs/ASTEROIDY-FIZYKA.md`. D2 dodatkowo: KOLUMNY `FAMILY_WEIGHTS_BY_TYPE`, generacja komórek w `asteroidBeltField.js` (obrót, pary), `rockLayers.js` (obie kopie), render par w `asteroidBelt.js` |
| **E** populacje | „Pas: NEA, Hungarie, Trojańczycy, Kuiper” | E0 teraz: rozpoznanie i projekt BEZ edycji plików pasa. E1 po sygnale (po A1): regiony | E1: geometria i NOWE definicje w `BELT_DEFINITIONS`, `buildBeltRegions` / regiony w `asteroidBeltField.js`, strefa HUD / warpa pasa w `index.html` (blok stref), zdarzenie przelotu NEA |
| **B** komety | „Komety: model i wdrożenie” | teraz | nowe: `src/data/comets.js`, `src/game/comet*.js`, `src/3d/comets/*`, `dema/komety-webgpu.*`; własny blok w `index.html`, wpisy rozgrzewki, rekord radaru. Komety pasa głównego (aktywne asteroidy) — później, przez orkiestratora |
| **C** ciała | „Ceres i duże ciała pasa + Pluton” | teraz | `scripts/planety/` (nowe skrypty), `public/assets/planety/…`, `src/3d/planetMaps.js`, `src/3d/planet3d.assets*.js`, `src/data/systemMap.js`, `src/data/solarSystem.js`, NOWY `src/data/smallBodies.js`, `src/game/traffic/trafficWorld.js`, `src/data/factions.js`, `src/game/stationEconomy.js`, stacja Ceres w `index.html`, `src/ui/radar/radarConfig.js`, `docs/PLANETY-GENERATOR.md`, `docs/SPEC-ekonomia-i-logistyka.md` (Unia Pasa). Wyłączenia skał wokół ciał — przez publiczne `field.exclusions`, bez edycji `asteroidBeltField.js` |

Kolejność plików pasa: A1 i E1 równolegle (E1 od 2026-10-12: A zostaje przy `_pickType` i polach `types`, E przy
regionach i polach geometrii) → D2 po A1 → A2. Sygnał „GO” wysyła orkiestrator.

## A2: pole = rodzina kolizyjna (plan orkiestratora)

- Gęste pole to młoda rodzina kolizyjna (jak Karin, 5,8 mln lat) — tłumaczy gęstość, pył i jednolity skład pola.
- Rodziny z prawdziwych, z a w AU mapy i typem macierzystym: Flora (S, 36,2), Westa (V, 36,9 — przy ciele Westy),
  Nysa-Polana (S / C, 37,2), Eunomia (S, 38,2), Koronis z Karin (S, 39,3), Eos (S / M, 40,0), Themis (C z lodem, 40,5),
  Hygiea (C, 40,55 — przy ciele Hygiei), Veritas (C, młoda, 40,7). Hildy (D), Trojańczycy (D).
- Mechanizm: każde gęste pole należy do rodziny (najbliższe ziarno rodziny po promieniu, rozrzut kątowy; rodziny ciał
  kotwiczone do pozycji ze `smallBodies.js`); rodzina daje skład (typ macierzysty dominuje rudy pola) i nazwę. Zastępuje
  albo ogranicza prowincje fbm.
- Nazwa dla gracza: skaner wydobycia i skan X w polu — np. „Rodzina Themis · węglowe, lód”.
- Bez zmian: neutralne obrzeże, udział rud z głębokością, rzadkie rudy w rdzeniu, skały energetyczne w burzach,
  położenie olbrzymów (pierścienie skanu poza lukami), udział pól 4–30%.

## E: projekt (E0, 2026-10-12 — sesja „Pas: NEA, Hungarie, Trojańczycy, Kuiper”)

Pomiary z kodu (AU mapy = 42 253,5 j.; planety mają LOSOWY kąt przy każdym starcie, `speed` 0 — regiony liczą się raz,
z pozycji planet w chwili budowy pola):
- Ziemia: orbita 1 056 338 j.; ring „Halo” do ~43,8 tys. j. od środka, strefa orbity do 46,8 tys., studnia 55,8 tys.
  (`planetOrbitRadii`); **cztery hale K-7 ~49,8 tys. j. od środka Ziemi**, bramy po skosie (stały obrót ringu, nie ku
  Słońcu); Luna 96 tys. j. Mars: orbita 1 394 366 j., studnia ~45–50 tys., Dejmos 92 tys. Neptun: Nereida 280 tys. j.
- Kampania: start w doku K-7 → wylot bramą → odcinek TRAVEL TO wzdłuż osi bramy do bazy 57 AU (`_shipyardCenter`,
  `warpIn` 60 tys. j. przed wylotem bazy) — tor PRZECINA pasmo NEA, pas główny i ew. Hildy; skok jest duchem
  (`noHullCollisions`), a małe skały i tak nie mają kolizji z kadłubami (tylko olbrzymy). Ryzyko jest więc OBRAZOWE
  i KOSZTOWE, nie rozgrywkowe: `AsteroidBelt._viewTouchesBelt` (`field.rectTouchesBelt`) włącza CAŁĄ maszynę pasa
  (ośrodek, mgła, światła, atlas cieni), gdy kadr z paralaksą + `edgeWorld` (50,7 tys. j.) dotyka regionu — przy zoomie
  0,45 to ~75 tys. j. od krawędzi regionu, przy 0,02 ~120 tys. Pasmo NEA bez wycięcia uruchomiłoby pas w doku K-7,
  w intro i w menu gry; Hungarie 34,2 AU (51 tys. j. za orbitą Marsa) — w porcie Marsa.
- Skala świata: `computeWorldUnitsPerAu` = 12 mln / (2 · (najdalsza krawędź pasa + 2)) — krawędź 140 AU Kuipera
  WYZNACZA AU. Definicja `kuiper` musi zostać z `outerAU: 140` (i id `kuiper`, `innerAU 125` — czyta je
  `trafficFields`), inaczej przesuwa się cały świat.
- Zasadzka misji 2 (`beltAmbush`) i wezwania piratów (`pickPirateCallInOrigin`) czytają pierścień `ASTEROID_BELT`
  (definicja `main`); olbrzymy skanują 37,5–45,5 AU gęstością pola — przy regule niżej gęstość pasa głównego i Hild
  zostaje bit w bit (olbrzymy, zasadzka bez zmian). Wezwania wsparcia i holownik przylatują od Ziemi — nie dotyczy.

### Zmiany w mechanice regionów (`asteroidBeltField.js`; `_pickType` nietknięte)
Nowe OPCJONALNE pola definicji (brak = dzisiejsze zachowanie, bit w bit dla `main`, `hildas`):
- `densityMul` (domyślnie 1) — mnożnik gęstości regionu; `fieldMul` (1) — mnożnik gęstych pól i obrzeża (0 = bez pól);
- `edgeAU` / `edgeInAU` — miękka krawędź regionu (dziś wspólne `edgeAu` 1,2; `edgeInAU` tylko krawędź wewnętrzna ringu);
- `profile: [[au, mnożnik], …]` — radialny profil gęstości ringu (liniowo między węzłami);
- arc: `angLeadDeg` / `angTrailDeg` (asymetryczny łuk od punktu L: ku Jowiszowi / od Jowisza), `angProfile` (gęstość
  wzdłuż łuku), `bananaK` (zwężenie promieniowe ku końcom łuku);
- `holes: [{ planet, r, soft }]` — wycięcie wokół planety (pen = min(pen, odległość − r)); działa też w
  `rectTouchesBelt` — pas nie budzi się przy K-7 / porcie Marsa;
- `ice` (0/1) — dziś `ice` tylko dla id `kuiper`; `overlay: true` + `priority` — region tylko składu i mnożnika gęstości
  (jak Hildy dziś: nie wchodzi do obwiedni);
- `avoid: { planet, halfDeg, depth }` — przerzedzenie wokół długości planety (plutonki unikają Neptuna).
Reguła: obwiednia = max po regionach smoothstep(pen_i, edge_i) × densityMul_i × profile_i (dla mnożników 1 = dziś);
gęstość × mnożnik nakładki, w której punkt leży; pola × fieldMul. Koszt `sampleMacro`: r liczone raz, region poza swoim
pasmem radialnym (z krawędzią) pomijany przed `atan2` — przy 11 regionach taniej niż dziś przy 7 (dziś każdy łuk robi
`atan2`). Pomiar µs/próbkę przed / po w E1.

### Populacje
| Region | Geometria (AU mapy) | Gęstość | Pola | Skład (A) | Uwagi |
|---|---|---|---|---|---|
| **NEA** `nea` (ring) | 21–31, profil 21:0 · 23:0,5 · 24,5:1 · 28:1 · 29,6:0,5 · 31:0 (Ateny i Atiry wewnątrz, Amory do q 1,3) | 0,25 × tło pasa (~0,03 skały D ≥ 80 na ekran przy zoomie 1) | 0 (pojedyncze skały, jak prawdziwe NEA) | S + C + trochę M (od A) | `holes`: Ziemia r 200 tys. j. (soft 30 tys.) — wolne: hale K-7 (50 tys.), studnia, Luna (96 tys.), start kampanii (dok → wylot → ładowanie skoku); bez strefy HUD |
| **Hungarie** `hungarias` (ring) | 34,2–35,1, `edgeAU` 0,25 | 0,35 (wysokie nachylenia — w przekroju 2D rzadziej) | 0,35 | najjaśniejszy typ z tabeli A (E nie ma — placeholder `silicon`) | `holes`: Mars r 160 tys. j. (port Marsa); bez strefy HUD |
| **pas główny** `main` | wewnętrzna krawędź 36 → **35,5** (4:1 / ν6 — prawdziwe 2,06 AU), `edgeInAU` 0,35; zewnętrzna bez zmian (`mainOuterAu` 41,5, krawędź 1,2) | bez zmian | bez zmian | A | rzadki przesmyk 35,1–35,45 = luka od Hungarii; strefa HUD 36 → 35,5 (czyta definicję) |
| **Grecy L4** `greeks` | łuk 25°–105° od Jowisza (punkt L 60°; ku Jowiszowi 35°, od Jowisza 45° — kijanka asymetryczna), r 50,2 ± 2,2 w środku, `bananaK` 0,5 | 1,0 | 1 | D (od A) | `angProfile`: rdzeń ±15° = 1, końce 0,35 |
| **Trojańczycy L5** `trojans` | lustro L4 (−60°) | **0,61** (L4 : L5 = 1,64 : 1) | 1 | D | |
| **Hildy** | bez zmian | | | | |
| **Kuiper** `kuiper` (ring, ZOSTAJE 125–140) | profil 125,3:0 · 126:0,55 · 128:0,55 · 128,8:0,15 · 129,8:0,15 (przerwa ν8 jak prawdziwe 40–42 AU) · 130,5:0,8 · 132:1 · 135:1 · 137,3:0,85 · 137,8:0,1 (urwisko) · 140:0,06 | jw. | × profil | A (dziś ice / crystal / uran …) | ice 1 |
| plutonki `plutinos` (nakładka) | 125,5–128,5 | `avoid` Neptun ±60°, dno 0,2 | | lód + skały (A) | Pluton (C) na ~127, poza ±60° od Neptuna — Neptun ma losowy kąt, więc kąt Plutona względem Neptuna; Nereida (280 tys. j.) wypada w dnie unikania |
| zimny klasyczny `kuiper_cold` (nakładka) | 132–135 | × 1,3 | | czerwony (D + lód, od A) | |

### Skutki
- **Strefy HUD / warpa** (`index.html`, blok stref): pas główny z definicji (35,5–47), ×0,8 jak dziś; NOWA strefa
  „Kuiper Belt” (125–140, ×0,8, niebo 0,55 — gęste pola jak w pasie); „Jupiter Trojans” (łuki L4/L5, bez kary warpa,
  niebo 0,75); NEA i Hungarie — BEZ strefy (każdy start z Ziemi przecina NEA — komunikat i kara warpa przy każdym
  wylocie to spam; plan skoku `planWarpCruise` liczy strefy po kursie, więc kara zmieniłaby czas skoku z K-7). Luki
  Kirkwooda dalej bez strefy. `skyRegion.js`: wpisy dla nowych stref (2 liczby).
- **Olbrzymy, zasadzka misji 2, wezwania piratów**: bez zmian (gęstość w 37,5–45,5 bit w bit — test położeń).
- **Radar**: podkład z `sampleMacro` — NEA rzadkie ziarno, Trojańczycy szersze; bez zmian w kodzie radaru.
- **Cień pól** (`asteroidFieldLight.js`) zbiera pasma ringów — nowe ringi (NEA, Hungarie) dokładają pasma: zmierzyć czas
  `precompute()` (dziś ~1 s) w E1, w razie potrzeby pominąć ringi bez pól (`fieldMul` 0).
- **Ruch v2** (`trafficFields`): czyta `main` / `kuiper` innerAU / outerAU — `main.innerAU` 35,5 przesuwa środek pola o
  0,25 AU (bez znaczenia).
- **Pluton** (C): umowa — kąt względem Neptuna 90°–180° (nie stała), pas plutonków go otacza; wycięcie wokół Plutona
  przez `field.exclusions` (C).

### Zdarzenie „Apophis” (opcjonalne — DO DECYZJI)
Prawdziwy przelot 13.04.2029: ~32 tys. km od Ziemi = ~5 promieni Ziemi → w grze ~40–45 tys. j. od środka, czyli PRZEZ
ring i hale K-7 — 1:1 nie da się. Propozycja: tylko gra swobodna (nigdy w kampanii ani przy `StoryGame.blocksInput`),
raz na sesję po ≥ 20 min gry albo `?apophis`: jedna skała ~1500 j. (prawdziwe 340 m) na prostej przez obszar Ziemi
w odległości 90–110 tys. j. (za studnią, poza Luną), ~2000 j/s, 3–4 min w kadrze mapy; obraz z banku skał (ciało jak
w wydobyciu — `rig`), bez kolizji, wpis na radarze, komunikat. Koszt wdrożenia: średni (ruchome ciało poza siatką pola).
Rekomendacja: NIE w E1 — osobny etap po decyzji użytkownika.

### Testy i narzędzia E1
`tests/asteroidBeltField.test.mjs`: brak skał PLAY i `rectTouchesBelt` = false przy halach K-7 (4 kompleksy) i w porcie
Marsa przy losowych kątach planet; L4 / L5 gęstość ≈ 1,64; kształt profilu NEA i Kuipera (urwisko, przerwa ν8);
plutonki rzadsze przy Neptunie; gęstość 37,5–45,5 bit w bit; skala AU niezmieniona. `scripts/pas-struktura.mjs` —
mapy NEA, Hungarii, Trojańczyków, Kuipera przed / po; zrzuty w grze; `fabula-gra.mjs` (start → skok) i
`zasadzka-gra.mjs`; koszt `sampleMacro` i `precompute()`; aktywność pasa w doku K-7 (`asteroidBelt.active` = false).

## Koordynacja (wszystkie sesje)

- **Bez commitów** (użytkownik commituje hurtem). Edycje tylko narzędziem Edit / Write na własnych plikach; żadnych
  skryptów przepisujących cały plik (CRLF w drzewie, cudza praca w toku); nigdy `git stash`. Wersja „przed” —
  `git show HEAD:plik` do kopii w scratchpadzie.
- **Pomiary wydajności** (fps, ms CPU / GPU, benchmarki): przed — `ListAgents` + `SendMessage` „START <co, ile min>” do
  sesji, które mogą mierzyć; po — „KONIEC”. Zrzuty i testy funkcjonalne — bez uzgadniania, ale bez wniosków o wydajności.
- **Testy:** `node --test "tests/*.test.mjs"` (porażki obecne na czystym HEAD nie są twoje — porównaj), build
  `npx vite build --outDir <scratchpad>/dist --emptyOutDir`. Pipeline'y synchroniczne w klatkach gry — 0 (`Core3D.warmup`).
- **Po etapie:** raport do orkiestratora (co, pliki, liczby, zrzuty, testy), akapit w `AGENTS.md`, status w tym planie.
- Oszczędnie: celowane odczyty, jeden pomiar zamiast wielu.

## Typy (uzupełnia A1)

| id | klasa | etykieta | tier | surowce | gdzie |
|---|---|---|---|---|---|
| `carbon` (ROCK_TYPES 9) | C — chondryt węglisty | węglowa | 0 | `carbon_ore` „Ruda węglista” (węgiel, organika, woda związana) | od ~37,6 AU mapy, dominuje 39,1–41,5; NEA (C) |
| `metal` (10) | M — żelazo-nikiel | metaliczna | 1 | `nickel_ore` „Ruda niklu” | szczyt ~38,6 AU mapy (37,6–40,5); NEA (trochę M) |
| `basalt` (11) | V — bazalt Westy (HED) | bazaltowa | 1 | `titanium_ore` (istniejący; ilmenit) | wewnętrzny pas, szczyt rodzina Westy ~36,9; Hungarie |
| `primitive` (12) | D / P — prymitywna | prymitywna | 0 | `ice` (istniejący; lód spod skorupy tolinów) | Hildy, Trojańczycy, zewnętrzny brzeg ≥ 40,5, Kuiper (zimny — D + lód) |
| `platinum` (13) | M bogata w platynowce | platynowce | 2 | `platinum_ore` „Platynowce” | śladowo z M (37,6–41,5), tylko w rdzeniach pól |
| `rock_c` (14) | wypełniacz bez rudy, odmiana węglowa | skała neutralna (węglowa) | — | brak (dla wydobycia = `rock`) | wygląd wypełniacza na zewnątrz: udział `dark` przystanku (0 wewnątrz → 0,95 na 41,5; Hildy, Trojańczycy, Kuiper 1) |

Stare rudy bez zmian: `iron` 0, `copper` 1, `silicon` 2 (S), `titan` 3, `crystal` 4, `ice` 5, `uran` 6, `rock` 7, `energy` 8.
Listy: `ASTEROID_TYPES` (7 rud gry, tekstury PNG — bez zmian), `SPECTRAL_ORE_TYPES` (5 nowych, `asteroidTypes.js`),
`ORE_ROCK_TYPES` = obie (`asteroidRockKinds.js`); `isNeutralType` / `isNeutralTypeId` — obie odmiany wypełniacza.

**Pole `types` definicji pasa** (A1): obiekt `{ typ: waga }` (stały skład, wypełniacz kamienny — jak dotąd) albo lista
przystanków po odległości od Słońca `[{ au, dark, ore: { typ: waga } }, …]` (liniowo między przystankami; jeden
przystanek = stały skład z `dark`). Wagi rud — klucze z kolumny id (+ stare rudy). `buildRegionComposition(types, au)`
(`asteroidBeltField.js`) robi z tego `composition` + `compStops` regionu. Propozycje dla E1: Hungarie
`[{ au: 0, dark: 0, ore: { basalt: 0.4, silicon: 0.35, iron: 0.15, titan: 0.05, crystal: 0.05 } }]` (E-typ = enstatyt —
najbliżej jasny bazalt / krzem); NEA `{ silicon: 0.45, carbon: 0.3, metal: 0.1, iron: 0.1, crystal: 0.05 }` z `dark` ~0,3;
zimny Kuiper `[{ au: 0, dark: 1, ore: { primitive: 0.55, ice: 0.35, crystal: 0.06, uran: 0.04 } }]`.

## Status

| Etap | Stan | Uwagi |
|---|---|---|
| A1 | gotowe (2026-10-12) — czeka na ocenę użytkownika | po przejściu jakości modeli (effort max): jasności z albedo (C ≈ 0,2 × S, D ≈ 0,26 × S z lekkim czerwonym nachyleniem, V ≈ 1,3 × S — najjaśniejszy), głazy C z Worleya na zawiniętej dziedzinie z antyaliasingiem, rzadkie jasne głazy obce, cienkie żyłki stopu V, plamisty lód D; typy C / M / V / D / platynowce + wypełniacz węglowy w demie i w grze, skład z odległością (przystanki `types`), prowincja rud tylko dla typów ≥ 0,08 wagi; zrzuty `.tmp/pas-typy/` (demo: galeria, zbliżenia, dystans, 8 przystanków; gra: `typy-*`, wydobycie C i M); testy `tests/asteroidSpectralTypes.test.mjs` + bloki A1 w `asteroidBeltField.test.mjs`; olbrzymy bez zmian (`pas-struktura` przed / po). Dla D: `ORE_LOOK` w obu `minedRocks.js` nie zna nowych typów (fallback skała), `body.typeId === 'rock'` w obu `miningRig` pomija `rock_c` (jest `isNeutralTypeId`) |
| A2 | gotowe (2026-10-12) — czeka na ocenę użytkownika | POLE = RODZINA: 9 rodzin pasa głównego (`src/data/asteroidFamilies.js`) + Hildy / Trojańczycy jako „rodzina” regionu; szczyty pól (`familyPeaks`) → rodzina (Westa i Hygiea przy ciałach z kątów świata — `setSmallBodyAnchors`), skład rodziny w polu z udziałem z głębokości, prowincje fbm tylko poza rodzinami; nazwa dla gracza: komunikat strefy POLE PLANETOID + dziennik + wiersz `pole:` skanera wydobycia. Skład kadrów: Westa — bazalt 53%, Koronis — krzem 38%, Themis — C z lodem 25% + C. NOWY TYP `carbon_ice` (15, `LATE_ORE_TYPES`): C z lodem w rdzeniach (szron w zimnych pułapkach, skała zostaje ciemna; kryształki lodu; rdzeń i urobek — lód), także śladowo w tle za linią śniegu. Poprawki A1: biały `ice` w polach pasa głównego ≤ 3% (test), „pieprz” na dużych C — trzy przyczyny z A/B w grze (głazy od ~7 px, wysokość głazów ∝ R, jasne łatki z `lineTint` żyłek przez próg `hasLine`) → głazy od komórki 12 px, sufit wysokości, głazy obce rzadkie, żyłki tylko w widocznym głazie. Olbrzymy, udział pól, luki bez zmian (`pas-struktura` przed / po, test). Demo: scena rodzin, przystanki gradientu w polach rodzin, galeria — rząd 4. Pipeline'y synchroniczne 0, błędy 0. Zrzuty `.tmp/pas-rodziny/` (gra: `rodzina-*`, `typy-zewn` — przed: `.tmp/pas-typy/gra/typy-zewn.png`). `ORE_LOOK` (wnętrze w wydobyciu, oba `minedRocks.js`) dla typów z widm i `carbon_ice` dopisał D, a także bączki bazaltu 0,7 → 0,2. Notatka `side-session-notes/…/a2-rodziny-kolizyjne.md` |
| B | wdrożone (2026-10-12, bez commita) — czeka na ocenę użytkownika | 4 komety z prawdziwych orbit (Halley ~0,95 AU, Hale–Bopp ~1,24 AU, 67P ~1,35 AU, Tempel 1 ~4,6 AU — uśpiona), STOJĄ jak planety (orbita → aktywność, zakrzywienie pyłu, aberracja jonowego); miejsca z kątów świata (`cometKeepOut`: strefy planet, olbrzymy i małe ciała z bloku C, L4 / L5 Jowisza, tor kampanii; `avoid`: gęste pola pasa w ich kształcie — `penetrationOf` z zapasem 2 × koma + 1,5 AU, także roje Trojańczyków 25°–105° od Jowisza po uwadze E). Warkocz pyłowy = model synchron / syndyn, jonowy z aberracją, włóknami, załamaniem i zerwaniem, koma z fontanną i cieniem jądra, dżety z obracającego się jądra, ziarna z bliska; jądro z pola odległości (tarasy, jamy, kratery; worker), cień własny z atlasu 3D. Gra: przeszkoda (obrys z góry, odbicie bez obrażeń), pociski gasną, radar (podkład + kontakt `env.bodies` KOM), CIC (orbity, warkocze), mgła — teren. Demo `dema/komety-webgpu.html`. Pipeline'y synchroniczne 0 (demo i gra), koszt +0,08–0,10 ms GPU z kometą w kadrze. Zrzuty `.tmp/komety/` (demo, gra, koszt), testy `tests/comets.test.mjs` (11), notatka `side-session-notes/…/strumien-B-komety.md`. API na później (komety pasa głównego): `CometField.addSite`, `iceSources` |
| C | wdrożone (2026-10-12, bez commita) — czeka na ocenę użytkownika | ciała z `src/data/smallBodies.js` w grze i w demie (`dema/planety-webgpu.html?cialo=ceres|westa|pallas|hygiea|psyche|pluton|charon`): Ceres ze STOLICĄ UNII PASA (miasto przy Occatorze, stacja „Ceres — Stolica Unii” z rynkiem, dokiem i frakcją `belt_union`), Westa z hutą i stacją, Pallas / Hygiea / Psyche z placówkami, Pluton z Charonem. Mapy `scripts/planety/male_ciala.py` (Dawn, New Horizons — USGS; reszta proceduralnie), bryły z mapy promienia (`src/3d/smallBodyShape.js`). KĄTY ze świata (`resolveSmallBodyAngles`: tor kampanii, planety z księżycami, olbrzymy pasa; Pluton 90–180° od Neptuna) — dla A2: położenie ciała = `smallBodyPosition(…, window.SMALL_BODY_ANGLES)`, nie kąt preferowany. Strefy i studnie jak planety (warp × 0,3, TRAVEL TO, soczewka, radar, CIC), węzły ruchu v2 'ceres' / 'vesta' w punktach stacji, wyłączenia skał przez `field.setExclusions` (scalone z olbrzymami). Notatka: `side-session-notes/…/strumien-C-male-ciala.md` |
| D1 | gotowe (2026-10-12) | rumowiska w wydobyciu (`RUBBLE_CONFIG`, `_buildRubble`, `_detonateRubble`, `_pluck`), render regolitu (kanał A atlasu), okruch-głaz; bank: bączek `top` (w polu od D2) i głazy na powierzchni. Dla A: opcjonalne pole `rubble` (mnożnik progu, 0 = nigdy) w `ROCK_FRACTURE` — progi z odporności i gęstości działają bez niego |
| D2 | gotowe (2026-10-12) — czeka na ocenę użytkownika | dane i lustra CPU: `src/game/asteroidRotation.js` (czysty). OBRÓT wolniejszy z rozrzutem: najkrótszy okres z wielkości (bariera obrotu: 30 s do 200 j. średnicy → 150 s od 450 j., olbrzymy wolniej), rozrzut × 8, 12% skał wolnych × 3–10 (`SPIN_CONFIG`). KOZIOŁKOWANIE tylko skał tła (30%, precesja wokół osi momentu pędu 0,35–1,2 × obrót; `rockSpin.tsl.js` w obu `rockMaterial.js` — skały PLAY: ten sam WGSL co przed D2, nie wystają nad z = 0). PARY Z KSIĘŻYCEM: ~10% skał PLAY 300–2000 j. (wyszło ~4,7% po wykluczeniach i nakładaniu) i 5% tła, księżyc 0,15–0,35 rozmiaru na orbicie 2,6–4,5 promienia, okres Keplera (ta sama gęstość), obrót związany; PLAY — orbita pozioma w płaszczyźnie warstwy; render: osobne kubełki instancji w `rockLayers.js` (obie kopie, ten sam materiał — 0 nowych pipeline'ów), cień księżyców w atlasie reflektorów (`forEachMoon`), przejęcie pary w wydobyciu (gra i demo) z fazy `belt.time` — partner w następnej klatce (budżet ciężkich operacji rigu). BĄCZKI: rodzina `top` na końcu `ROCK_FAMILIES` (44 kształty banku) + kolumna wag w `asteroidRockKinds.js` (C, D, krzemiany; ~6,7% skał 300–1500 j.). Testy `tests/asteroidRotation.test.mjs`, `tests/rockSpinTSL.test.mjs`; zrzuty `.tmp/webgpu/pary/` (demo: orbity, koziołkowanie, galeria kształtów; gra: `gra-pary/`) |
| E0 | gotowe (2026-10-12) | projekt w sekcji „E: projekt” |
| E1 | wdrożone (2026-10-12, bez commita) | NEA, Hungarie, Trojańczycy (kijanki, L4 : L5 = 1,64), Kuiper (profil + nakładki plutonki / zimny rdzeń), pas główny od 35,5, strefy „Kuiper Belt” / „Jupiter Trojans”, składy wg propozycji A. Budzenie pasa przy K-7 Marsa (12 kątów × 4 hale): zoom 0,45 0 → 0, 0,07 20 → 0, 0,02 60 → 52 z 96; przy K-7 Ziemi 0 / 96. Pas 37,5–45,5 bit w bit (olbrzymy bez zmian). sampleMacro: pas −10%, cały układ −14%, Kuiper −20%, NEA +31% (są tam teraz skały); precompute cienia pól +360 ms (okno NEA) — orkiestrator: `_buildWindows` w `asteroidFieldLight.js` pomija regiony z `fieldMul` 0 (okna 33–60 i 124–148 AU, precompute ~1,34 s jak przed E1). Mapy `.tmp/pas-populacje/`, raport do orkiestratora. Sprawdzone przez orkiestratora: testy pasa i cienia pól 36 / 36 |
| E2 | wdrożone (2026-10-12, bez commita) | przelot NEA „Apophis” (`src/game/neaFlyby.js`, `src/3d/neaFlyby3D.js`, blok „PRZELOT NEA” w `index.html`): gra swobodna, raz na sesję po ≥ 20 min, 90–110 tys. j. od Ziemi po stronie gracza, 2000 j./s, bez kolizji; tor omija księżyc Ziemi z renderu (przewidywanie ruchu, ≥ 25 tys. j.); skała z banku pasa (pas budzony kołem `wakeSpots`); radar `env.bodies` (wspólny z kometami); `?apophis`. Pipeline'y synchroniczne 0, koszt w kadrze +0,05 ms GPU / +0,13 ms CPU; kampania — nigdy (sprawdzone w grze). Zrzuty `.tmp/apophis/` |
