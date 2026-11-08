# PROPOZYCJA — ekonomia ruchu v2 przy wielu układach gwiezdnych (E18)

Spisana 2026-11-08. To PROJEKT do decyzji użytkownika, nie zmiana gry: kodu w `src/` nie ruszałem. Stan wyjściowy to lokalny `main` z 2026-11-08 (`3fb88830`): przebudowa ekonomii E1–E17 scalona, mapa gwiezdna i rejestr układów w `main`, do gry niewpięte. Plan ekonomii: `docs/PLAN-ekonomia-rynki.md` (§ 3.6 kierunek, § 4 zadania E18–E21, § 7 decyzje). Zasady obszarów: reguły `ruch-v2`, `uklady-gwiezdne`, `mapa-gwiezdna`; mapa i floty: `docs/PLAN-mapa-gwiezdna.md`.

**Ramy od użytkownika (2026-11-07, nie do zmiany):**
- układów jest dużo i są proceduralne (z ziarna);
- gospodarki układów są niezależne, a bez gracza uproszczone;
- między układami ruszają się tylko floty kupieckie i wojsko, więc koszt rośnie liniowo z liczbą układów;
- gra ładuje jeden układ na stronę, a przejście do innego układu to przeładowanie strony.

**Pomiary.** Skrypty leżą poza repozytorium, w `.tmp/e18/` worktree E18 (kopia: notatki sesji, `E18-skrypty/`):
- `pelna2.mjs` — pełna symulacja Układu Słonecznego (240 min, presja 1, magazyny ×4, skala ×60) z próbką wektora układu co minutę;
- `dluga.mjs` — ta sama symulacja przez 600 min (ziarno 7);
- `model.mjs` i `kalibracja.mjs` — model zbiorczy i jego kalibracja;
- `generator.mjs` i `uklady.mjs` — prototyp generatora rynków i jego wynik na sektorze `generateSector({ seed: 1 })`;
- `wejscie.mjs` — start świata ruchu z zapisu, z modelu i od zera;
- `handel.mjs` i `floty.mjs` — handel konwojów i przewijanie flot.

Pomiary szły w ciszy innych sesji; w tle działał tylko serwer Vite użytkownika.

## 0. W skrócie

- **Generator (§ 1).** Rynki układu powstają z wpisu rejestru (`systemRegistryEntry`): planety, pasy i `sector.faction`, `zone`, `pirateBase`, `gate`. Każdy rodzaj planety ma szablon zbudowany na analogii z Układu Słonecznego (archetypy, wydobycie, osada, habitat). Pas planetoid daje pola wydobywcze i stację pasa, pas lodowy daje pola z uranem. Na koniec generator domyka moc zakładów do pokrycia popytu ≥ 95%. Wynik dla sektora z ziarna 1:
  - 26 układów rdzenia ma 121 rynków (100 czynnych), czyli 2–8 na układ, przy 34 rynkach Układu Słonecznego;
  - przewóz wewnętrzny to mediana 0,20 przewozu Słońca;
  - 7 kryjówek ma po jednym rynku;
  - 126 układów pogranicza nie ma gospodarki.
- **Model zbiorczy (§ 2).** Jeden wektor 64 towarów na układ (zapas, pojemność, głód), 46 linii receptur i krok co 60 s gry. Na Układzie Słonecznym, wobec pełnej symulacji (ziarna 7, 11, 23, 240 min):
  - zapełnienie różni się średnio o 1,5 pkt proc. (56–57 z 63 towarów w granicy 5 pkt);
  - cena bez głodu różni się o 6,9%, a z głodem przeniesionym z ostatniej wizyty o 5,6–9,9%;
  - produkcja różni się o 8,4%;
  - rozrzut między ziarnami pełnej symulacji to tylko 0,46 pkt i 0,5%.

  Koszt: **2,5 µs na układ i krok**, czyli 0,4 ms na minutę gry przy 160 układach. Nadrobienie 10 h nieobecności zajmuje 1,2 ms.
- **Wejście i wyjście (§ 3).** Ruch odtwarza wzór zapełnienia rynków z ostatniej wizyty (1 bajt na parę rynek–towar, 555 B dla Słońca) przeskalowany wektorem modelu. Po 10 min świata jest 1465 kursów (prawdziwy bieg: 1486), a zapełnienie różni się o 1,4 pkt. Dlatego rozgrzewka przy powrocie trwa **10 min świata (~1,2–1,8 s CPU)**. Układ nigdy nieodwiedzony startuje tak jak dziś, z rozgrzewką 60 min (6–10 s w Node).
- **Zapis (§ 4).** Dzisiejszy zapis `economy` ma 18,3–18,8 KB po 4 h i 24,5 KB po 10 h. Przeglądarka aplikacji (Chromium 152) zmieściła w localStorage 52 mln znaków. W Chrome użytkownika i w paczce Electron nie mierzyłem, więc liczę ostrożnie 5 mln. Rekomendacja: pełny zapis każdego odwiedzonego układu (LRU 16, ~0,4 MB) plus wektory modeli wszystkich układów w jednym kluczu (~50 KB). Zapis dostaje `systemId`, a `ECONOMY_SAVE_VERSION` rośnie do 3.
- **Konwoje (§ 5).** Dziś 24 konwoje bez ładunku. Ładowność to 4,5–18 tys. t (mediana 10,3 tys. t), a każdy konwój zawija do portu ~25 razy na godzinę. Ceny modeli rozjeżdżają się między układami do ×4,6 wartości. 76 z 92 kierunków szlaków ma opłacalny ładunek, który wypełnia ładownię, a zysk to mediana ~0,67 mln CR na kurs. Ładunek trzeba więc ograniczyć regułą (§ 5.2). Przewinięcie flot o 10 h trwa 3,8 s, więc przy długiej nieobecności przewijanie potrzebuje rzadszego kroku.
- **Granica (§ 6).** Przy rogu świata, którym wchodzą szlaki, stoi rynek graniczny. Przewoźnicy ruchu v2 obsługują go przez API rynku bez nowego kodu planisty: eksport to `declareDemand`, import to zapas powyżej progu nadwyżki. Konwój sektora wchodzi rogiem jako grupa kursów widoczna w bańce.
- **Decyzje (§ 9).** D1–D14, w tym 4 decyzje z § 7 planu. Wdrożenie idzie w trzech zadaniach, każde przez bramkę bilansu z Układem Słonecznym liczba w liczbę:
  - E19: generator rynków i świat ruchu z rynków układu;
  - E20: model zbiorczy i zapis ekonomii na układ;
  - E21: handel konwojów i rynek graniczny.

## 1. Generator rynków z opisu układu

### 1.1 Wejście i ranga układu

Wejściem jest wpis rejestru z sektora (`systemRegistryEntry`, `src/game/sector/sectorRegistry.js`):
- planety `{ id: 'p<n>', type, seed, orbitAU, baseR }`;
- pasy `{ id: 'pas<n>', kind: 'asteroid' | 'ice', innerAU, outerAU }`;
- blok `sector`: `faction`, `zone`, `pirateBase`, `gate`, `seed`.

Generator czyta tylko wpis i niczego w nim nie zmienia: `starSystems.js` i `src/game/sector/` zostają tylko do odczytu.

Ranga układu wynika z bloku `sector`:

| ranga | warunek | ziarno 1 | gospodarka |
|---|---|---|---|
| stolica frakcji | `zone: core` i `gate` (siedziby z bramą) | 6 + Słońce | pełna, większa moc |
| rdzeń | `zone: core`, bez bramy | 20 | pełna, moc ×0,55 |
| kryjówka | `pirateBase` | 7 | jeden rynek kryjówki, bez przemysłu |
| pogranicze | reszta | 126 | brak (pola wydobywcze bez właściciela, D5) |

Stolice z ziarna 1 to Alfa Centauri, Wolf 359, Syriusz, Epsilon Eridani, 61 Cygni i Wega. Gospodarkę ma 33 ze 160 układów (26 proceduralnych w rdzeniu i 7 kryjówek) plus Układ Słoneczny.

### 1.2 Rodzaj planety → rynek

Każdy rodzaj ma szablon zbudowany na analogii z Układu Słonecznego: role (`INDUSTRY_ARCHETYPES`), skład wydobycia (wzór `PLANET_YIELD`), moc, osadę i habitat. Planeta poza stolicą zostaje rynkiem z prawdopodobieństwem `p`. Planeta niewylosowana to rynek opuszczony (działka, jak Neptun).

| rodzaj | analogia | role (stolica: + dodatkowe) | wydobycie (`rate`, skład) | moc (szablon, przed mnożnikami) | osada | habitat | `p` |
|---|---|---|---|---|---|---|---|
| `terran` | Ziemia | huta, elektronika, systemy, zbrojownia (+ stocznia) | brak | 14–20 | 1,6–2,2 | tak | 1,0 |
| `ocean` | — | zakłady lotne, elektronika, zakład lotniczy (+ stocznia, systemy) | 0,5–0,8: lód 0,8, kryształ, krzem, ziemie rzadkie | 6–10 | 1,1–1,5 | tak | 1,0 |
| `desert` | Mars | huta, elektronika (+ stocznia, systemy, przetop złomu, zbrojownia) | 0,9–1,2, skład Marsa | 8–14 | 0,9–1,4 | — | 0,95 |
| `rocky` | Merkury | huta (+ elektronika, stocznia, systemy) | 1,6–2,4: Fe, Ti, Si, Cu, Al | 1–3 | 0,6–0,9 | — | 0,85 |
| `toxic` | Wenus | elektronika, amunicjownia (+ huta, stocznia, systemy) | 1,1–1,5, skład Wenus | 4–7 | 0,8–1,2 | — | 0,8 |
| `volcanic` | Io | kopalnia (+ huta, stocznia, systemy) | 0,6–1,0: Fe, Ti, Cu | 0 | 0,3–0,4 | — | 0,6 |
| `barren` | Luna | kopalnia (+ huta, elektronika, stocznia) | 0,7–1,1: Al, Ti, ziemie rzadkie | 0 | 0,3 | — | 0,55 |
| `ice` | Tytan, Tryton | zakłady lotne (+ gazownia, stocznia, systemy) | 0,45–0,7: lód, metan, amoniak, kryształ, azot | 0,6–1,2 | 0,3–0,5 | — | 0,6 |
| `gas` | Jowisz, Saturn | gazownia, zakłady lotne (+ stocznia, systemy, zakład lotniczy) | 1,4–1,6, skład Jowisza | 6–11 | 1,0–1,3 | — | 0,9 |
| `ice_giant` | Uran | gazownia, zakłady lotne (+ stocznia, systemy) | 1,25–1,4, skład Urana | 3–5 | 0,8–1,0 | — | 0,75 |

Zasady szablonów:
- **Stolica** to pierwszy rodzaj z listy `terran → ocean → desert → rocky → toxic → gas → ice_giant → ice → volcanic → barren`. Dostaje role „stolicy”, zawsze zbrojownię i amunicjownię (pobór wojskowy bieżący stacji, `MILITARY_UPKEEP`), a zakład lotniczy wtedy, gdy w układzie nie ma planety oceanicznej ani gazowej. Ma też stocznię z wagą 1,6 w stolicy frakcji albo 1,0 w rdzeniu. Inne rynki z przemysłem dostają stocznię wagi 0,6, tak jak dziś (`syncShipyard`).
- **Moc**: losowanie z szablonu × ranga (stolica frakcji 1,0, rdzeń 0,55) × 1,15 dla stolicy albo 0,8 dla pozostałych rynków. Rynek z rolami ma najmniej 0,6 mocy na rolę. Kopalnia (`volcanic`, `barren`) ma moc 0 i osadę 0,3, jak księżyce-kopalnie Słońca.
- **Wzbogacalnia** (pręty paliwowe) trafia na najwyżej dwa olbrzymy i tylko wtedy, gdy układ ma pas lodowy. Uran zostaje wyłącznie w pasach lodowych, jak decyzja „uran tylko w Kuiperze”.
- **Habitat** (obsada, workforce) dostaje każda planeta `terran` i `ocean` z rynkiem. Układ bez nich ma stację mieszkalną przy stolicy (`population: { habitat }`, § 3.6 planu). Podaż habitatów to 1,28 × rotacja potrzebnej obsady (zapas 28%, jak w Układzie Słonecznym: 521 tys. osób/h wobec 407 tys./h rotacji), dzielona między habitaty.
- **Księżyce.** Generator sektora ich nie robi (`moons: []`). Do czasu księżyców w rejestrze wydobycie olbrzymów obejmuje też ich księżyce, tak jak dziś skład Jowisza zawiera lód z Europy. Rynki-kopalnie na księżycach wchodzą wtedy, gdy rejestr dostanie księżyce (D6).

### 1.3 Pasy

- **Pas planetoid** daje dwie rzeczy:
  - pola wydobywcze `miningFields.js` z pasa wpisu (`innerAU`–`outerAU`), ze składem: Fe 0,28, Ni 0,20, C 0,22, Si 0,14, Ti 0,06, Pt 0,04, lód 0,06 (wnętrze metaliczne, zewnątrz węgiel — do strojenia przystankami jak w `BELT_DEFINITIONS`);
  - **stację pasa** (analog Westy i Ceres): rynek na orbicie środka pasa z rolami huta + rafineria pasa, mocą 3,5–5 × ranga, osadą 0,4–0,5 i własnym złożem `rate` 1,6–2,4 (skład Westy z węglem Ceres).
- **Pas lodowy** daje pola z lodem 0,62, uranem 0,12, węglem 0,16 i kryształem 0,10. Rynku tam nie ma, tak jak w Kuiperze.

### 1.4 Kryjówka, brama, rynek graniczny

- **Kryjówka w rdzeniu** (analog Złomowiska) powstaje z szansą 0,45: orbita 0,55–0,8 najdalszej planety, 3 stanowiska, frakcja piratów. Piractwo wewnątrz układu działa na niej tak jak dziś.
- **Układ kryjówki z sektora** (`pirateBase`) ma jeden rynek kryjówki: za pasem planetoid albo na orbicie zewnętrznej, 4 stanowiska. Planety są w nim opuszczone. Tu trafia łup z napadów na konwoje (§ 5.3).
- **Brama wewnątrz układu** (hub `gate`) stoi tylko przy stolicy i tylko wtedy, gdy układ ma ≥ 5 planet: brama potrzebuje drugiej bramy w zasięgu, a w małym układzie jest zbędna.
- **Rynek graniczny** to `granica-<róg>` przy rogu świata (§ 6).

### 1.5 Domknięcie mocy

Losowa moc nie domyka bilansu. Bez domknięcia w prototypie niemal wszystkie podzespoły okrętowe (awionika, rdzenie, napędy, silniki hipercruise i warp, emitery tarcz) miały pokrycie popytu < 95%, bo pobór stoczni (`FLEET_DEMAND` × skala wojskowa) rośnie z osadą każdego rynku z przemysłem, a stocznia stolicy dostawała ułamek mocy. W Układzie Słonecznym tę liczbę dobrano ręcznie (Ziemia 20,8, Mars 16,8).

Generator domyka bilans pętlą, najwyżej w 8 przebiegach:
1. `buildIndustryMap` z wydobyciem rynków układu (§ 1.8).
2. Bilans układu: podaż z wydobycia i linii, popyt z linii, bytu, poboru wojskowego i stoczni.
3. Rynek z liniami, które robią towar o pokryciu < 95%, dostaje moc × (1 + min(0,6; niedobór)).

Po domknięciu zostają dwa rodzaje braków:
- **towary importowe**, czyli bez producenta w układzie. W ziarnie 1 to średnio 9 towarów na układ, najczęściej: azot (20 układów), przewód (17), nikiel z nadstopem, kompozyt i katalizator (po 15), węgiel (14), polimer, paliwo fuzyjne i materiał wybuchowy (po 13), myśliwce (11), złom (10), ziemie rzadkie i uran (po 8);
- **pojedyncze niedobory**, gdy rynek z linią ma za mało surowca (stal Alfa Centauri, glin Barnarda).

Import nie jest błędem generatora, tylko źródłem handlu między układami. Jego skala jest jednak duża (§ 1.7, D8).

### 1.6 Determinizm i identyfikatory

- Losowanie ma własny strumień `hashU32(ziarno sektora, id układu, 'ekonomia')` (`SectorRng`), zgodnie z zasadą reguły `mapa-gwiezdna`: nowa część generatora dostaje nowy strumień. Ten sam sektor i ten sam id układu dają te same rynki bit w bit, niezależnie od kolejności generacji.
- Id rynków są LOKALNE (reguła `uklady-gwiezdne`): `p<n>` (rynek planety ma id planety, tak jak dziś `earth`), `stacja-pasa`, `kryjowka`, `granica-<róg>`. Globalny id na mapie i w zapisie to `globalBodyId(układ, id)`.
- Kolejność tabeli rynków jest częścią danych, tak jak `MARKET_DEFS`: planety po orbicie, stacja pasa, kryjówka, rynek graniczny. Rynek dodany później idzie na koniec.
- Zmiana generatora, która zmienia rynki przy tym samym ziarnie, podnosi `SYSTEM_MARKETS_VERSION`. Zapis układu (§ 4) ją niesie, a inna wersja oznacza zapis pominięty i świat od zera.

### 1.7 Wynik na sektorze z ziarna 1

| ranga | układów | rynków (czynnych z kryjówką) | moc | przewóz z planu | obsada (×60) | import (×60) |
|---|---|---|---|---|---|---|
| Słońce | 1 | 34 (27) | 81,8 | 11 855 t/h (skala 1) | ~305 tys. | — |
| stolica frakcji | 6 | 2–5 (2–4), śr. 4,5 | 9–39,5, śr. 29,4 | 626–6217 t/h, śr. 3496 | śr. 97 tys. | śr. 113 tys. t/h (11–216 tys.) |
| rdzeń | 20 | 2–8 (1–7), śr. 4,7 | 3,6–37,8, śr. 19,7 | 529–5170 t/h, śr. 2455 | śr. 70 tys. | śr. 57 tys. t/h (2–143 tys.) |
| kryjówka | 7 | 1 | 0 | 0 | 0 | — |

Przykłady:
- **Alfa Centauri** (G, Terra Nova, stolica; planety: toksyczna, toksyczna, martwa, lodowy olbrzym, gazowy olbrzym; bez pasów). Rynki:
  - stolica `p1`: elektronika, amunicjownia, huta, stocznia, systemy, zbrojownia; moc 25,7;
  - `p2`: elektronika i amunicjownia, moc 3,5;
  - `p3`: opuszczony;
  - olbrzymy `p4` i `p5`: gazownia i zakłady lotne, moc 3,1 i 6,2.

  Bez skalistych planet nie ma tytanu, glinu, niklu ani węgla — to import. Eksport: miedź, lód, hel-3, metan, polimer, paliwo fuzyjne.
- **Tau Ceti** (G, Unia Pasa, rdzeń; martwa, trzy skaliste, pas planetoid i lodowy). Rynki:
  - stolica `p2`: wszystkie role montażu, moc 14,2;
  - dwie huty;
  - stacja pasa;
  - kryjówka.

  Bez olbrzymów: tlen, polimer, chłodziwo i paliwo fuzyjne to import (27 tys. t/h). Eksport metali to 666 tys. t/h nadwyżki — układ hutniczy.
- **Syriusz** (A, stolica Konsorcjum Wewnętrznego): jedna planeta wulkaniczna i pas. 2 rynki, moc 9, import tlenu, polimeru, paliwa i optyki.
- **Gwiazda Barnarda** (M, Terra Nova): skalista, pustynna (stolica jak Mars), gazowy olbrzym ze wzbogacalnią, lodowa i kryjówka. Pięć rynków; import: uran, węgiel, nikiel, złom.

Udział importu w przewozie wewnętrznym to mediana 49% (od 2% do 100%), a dla wszystkich 26 układów razem 1,83 mln t/h wobec 4,21 mln t/h przewozu wewnętrznego (43%). To dużo: rynek graniczny byłby najruchliwszym portem połowy układów (D8).

### 1.8 Co trzeba zmienić w ruchu v2 (E19)

Układ Słoneczny jest przypięty do swoich tabel po id. Każde takie miejsce dostaje dane układu z parametru, a domyślnie tabelę Słońca, więc Słońce zostaje liczba w liczbę.

| miejsce | dziś | po E19 |
|---|---|---|
| przemysł rynku | `SYSTEM_INDUSTRY_SPEC` / `STATION_INDUSTRY[id]` (`getStationIndustry`) albo `industry: { spec \| buildings }` | trzecia postać `industry: { capacity, roles, size }`, złożona przez `buildIndustryMap` rynków układu (dwuprzebiegowo, z popytem zewnętrznym jak dziś) |
| wydobycie rynku | `PLANET_YIELD[id]` w `runExtraction`, `stationNetRates`, `getStationOutputs`, `buildIndustryMap`, `stationHaulTonnage`, `systemHaulTonnage`, `syncStationWorkforce` (`mineRate`), `rollPlanetYield` | pole `yield` w `MarketDef` → `station.yield`, czytane PRZED `PLANET_YIELD` (wzór `station.industry`) |
| wielkość portów i floty przewoźników | `stationHaulTonnage()` i `systemHaulTonnage()` z mapy Słońca (`trafficWorld.js`) | z mapy przemysłu świata (`world.industryMap`) |
| sieć: planety i księżyce | `buildSystemMap` + `SYSTEM_MAP_MOONS` w `travelNetwork.js` | planety wpisu (`buildSystemMap(…, { planets, sunRadius })`), księżyce z wpisu (dziś `[]`) |
| pola górnicze | `BELT_DEFINITIONS` (`miningFields.js`, `trafficFields`) i krawędź pasa (`getOutermostBeltEdgeAu`) | pasy wpisu z modelu pól (§ 1.3); skala AU układu jak Słońca (`SOL_AU_UNITS`, propozycja z `PLAN-mapa-gwiezdna.md`) |
| stacje małych ciał | `SMALL_BODY_STATIONS` (`smallBodyMarketPlacement`) | stacja pasa z `position: { source: 'orbit' }` |
| frakcja, stocznia, ludność, brama | `getDefaultStationFaction(id)`, `SHIPYARD_WEIGHT[id]`, `POPULATION_CENTERS[id]`, `DEFAULT_GATE_HUBS` | pola `MarketDef` (`factionId`, `shipyardWeight`, `population`, `gate`) — już istnieją, generator je wypełnia |
| przewoźnicy | `buildCarriers(…, { factionOf: getDefaultStationFaction })` | `factionOf` z rynków świata |
| port K-7 i ring | `HALO_RING_PLANETS` (`ringRouter.js`, `DOCK_LAYOUT.AUTO`) | bez ringu: pomosty i doki E14 (`PORT_DOCK_PLACEMENT`, przydział z liczby stanowisk) |
| bańka | `SYSTEM_MAP_PLANETS` w `workerBubble.js` (studnie planet) | planety układu z `init` |
| dom gracza | `PLAYER_HOME_BERTHS` z `SOL_SYSTEM` | `systemHome(CURRENT_SYSTEM)` (dziś `null` dla układów proceduralnych) |

## 2. Model zbiorczy układu bez gracza

### 2.1 Stan i krok

Układ bez gracza to jeden rekord liczb, bez kursów, statków i portów:
- `S[64]` — zapas towaru w rynkach, które go obracają (producent albo odbiorca), razem z ładunkiem w drodze;
- `C[64]` — ich pojemność;
- `A[64]` — pułap gromadzenia: pojemność producentów + φ · pojemność samych odbiorców, φ = 0,3 (§ 2.2);
- `D[64]` — długość głodu w sekundach;
- plan z mapy przemysłu, liczony raz:
  - 46 linii receptur z łączną mocą (Σ `lineWeight` po rynkach);
  - wydobycie `E[64]` (planety i pola);
  - byt i pobór wojskowy `U[64]` (`systemDemandFor(…, {})`);
  - pobór stoczni `F[64]` (`FLEET_DEMAND` × skala wojskowa);
  - przewóz z planu `H[64]`, czyli dopasowanie nadwyżek do niedoborów jak w `stationHaulTonnage`;
- zegar `t`, ślad głodu z ostatniej wizyty `Dfix[64]` i flota frakcji (okręty gotowe, § 7).

Krok o n cykli gospodarki (20 s; krok domyślny 3 cykle = 60 s gry), w skali ×60 jak świat ruchu:
1. **Wydobycie**: `S += E · k`, do pułapu `A`.
2. **Receptury.** Linia stoi, gdy wszystkie jej wyjścia są na pułapie (jak `runRecipes`). Popyt wsadu wszystkich linii jest racjonowany proporcjonalnie: dostępne `max(0, S − 0,05 · C) / popyt`, a linia pracuje z najmniejszym udziałem swoich wsadów.
3. **Byt i pobór wojskowy**: `S −= min(S, U · k)`.
4. **Stocznie**: `S −= min(S, 0,5 · F · k)`.
5. **Straty w przewozie** (piractwo, wraki): `S −= min(S, 0,05 · H · k)`.
6. **Głód**: rośnie, gdy `S / C ≤ 0,08`, a odpuszcza ×3 szybciej (`PRICE_MODEL`). Ślad głodu `Dfix` z ostatniej wizyty trzyma dolną granicę do następnego wejścia (§ 2.3).

Cena układu to `wartość × niedobór(S / C) × głód(D)` — ta sama krzywa co `resourcePrice`. Mnożnik niedoboru jest liniowy w zapełnieniu, więc średnia cen rynków ważona pojemnością równa się cenie z zapełnienia układu. Różnicę robi tylko głód, który jest cechą pojedynczego rynku. Model nie alokuje w kroku: tablice typowane, plan liczony raz.

Ludzie (workforce) liczą się tak samo: podaż habitatów to wydobycie, a rotacja `N / T` to byt. Wyłączyłem ich z porównania, bo pełna symulacja trzyma obsadę ≥ 0,996 przez cały bieg.

### 2.2 Kalibracja na Układzie Słonecznym

Metoda:
1. Pełna symulacja (`scripts/symulacja-ruchu.mjs` w wersji z próbką co minutę: zapas, pojemność, ładunek w drodze, ceny ważone pojemnością rynków, które towar obracają, głód, produkcja zrealizowana).
2. Model startuje z zapasu pełnej symulacji w minucie 0.
3. Parametry dobrałem siatką na ziarnie 7, a sprawdziłem na ziarnach 11 i 23: φ ∈ {0,2…1}, straty ∈ {0…0,2}, zapas roboczy ∈ {0; 0,05}, mnożnik stoczni ∈ {0,5; 1; 1,5}.

Wynik przy φ = 0,3, stratach 0,05, zapasie roboczym 0,05 i stoczniach 0,5:

| miara (minuty 60–240) | ziarno 7 | ziarno 11 | ziarno 23 | rozrzut pełnej symulacji między ziarnami |
|---|---|---|---|---|
| zapełnienie: średni błąd (pkt proc.) | 1,51 | 1,46 | 1,51 | 0,46 |
| towary w granicy 5 pkt / 10 pkt (t = 240) | 57 / 61 z 63 | 57 / 62 | 56 / 61 | — |
| cena bez głodu: średni błąd | 6,9% | 6,9% | 7,0% | 0,5% |
| cena z głodem, model bez śladu | 15,9% | 15,8% | 16,0% | — |
| cena z głodem, ślad z wyjścia w 60. min | 5,6% | 5,6% | 5,7% | — |
| produkcja: średni błąd | 8,4% | 8,4% | 8,4% | — |

Wnioski:
- Pełna symulacja na poziomie układu prawie nie zależy od ziarna: rozrzut 0,46 pkt i 0,5% ceny. Model zbiorczy ma więc sens, bo układ ma jeden stan ustalony.
- Bez pułapu `A` (gromadzenie do pełnej pojemności) błąd zapełnienia wynosi 2,5 pkt, a rudy żelaza i tytanu idą do 99–100%, podczas gdy w pełnej symulacji stoją na 70–73%. W pełnej symulacji producent stoi pełny, a odbiorca trzyma tylko zapas roboczy (`inventorySafetyFill` 0,25 + zużycie w czasie dostawy). Pułap z φ = 0,3 oddaje to jednym parametrem.
- Największe błędy przy t = 240: ruda żelaza 70 → 92%, lód 90 → 100%, uran 14 → 5%, glin 51 → 60%, amunicja kinetyczna 38 → 45%. Uran zależy od wypraw do pól (dowóz z pola odbywa się falami), a model liczy pola jako stały strumień.
- **Pełna produkcja.** W pełnej symulacji linie pracują z wydajnością 99,3% planu (wartością). Niżej są tylko wodór (58%, bo wyjście jest pełne u producenta), stal (87%) i amunicja (95%). Przemysł Słońca nie jest więc dławiony transportem, tylko popytem i magazynem — dlatego model bez transportu wystarcza.
- **Próba z dwiema cenami** (eksportu u producentów i importu u odbiorców, z podziału `S` na dwie pule) dała gorszy wynik: błąd ceny eksportu 25%, importu 10%. Zostaje jedna cena układu, a konwój liczy marżę z rozstępu (§ 5.2).

**Tolerancja do bramki modelu (E20, propozycja):** na trzech ziarnach przy t = 60, 120, 180 i 240:
- średni błąd zapełnienia ≤ 2,5 pkt;
- ≥ 85% towarów w granicy 5 pkt;
- cena ze śladem głodu ≤ 10%;
- produkcja ≤ 10%.

### 2.3 Głód: ślad z ostatniej wizyty

Głód w pełnej symulacji siedzi u pojedynczych odbiorców. Przykład: stocznie bez własnych podzespołów (Merkury, Wenus, Saturn, Uran, Westa) mają na awionice, rdzeniach, napędach i emiterach tarcz głód ważony pojemnością ~133 min, przez co cena jest ×2. Zapełnienie układu tego nie widzi, bo producenci trzymają zapas. Dlatego przy wyjściu z układu model dostaje ślad głodu `Dfix` (średnia ważona pojemnością z rynków) i trzyma go jako dolną granicę do następnej wizyty. Dopłata za głód nasyca się po ~1 h (`duressHalfLife` 1800 s), więc zamrożenie mało szkodzi: wyjście w 60. min daje błąd ceny 5,6% przy t = 240, a wyjście w 120. min — 9,8%. Układ nigdy nieodwiedzony nie ma śladu.

### 2.4 Długi horyzont

W 10-godzinnym biegu (ziarno 7) model po wyjściu w 60. min trzyma się pełnej symulacji (średni błąd zapełnienia / ceny):

| godzina | błąd zapełnienia | błąd ceny |
|---|---|---|
| 2 | 1,5 pkt | 3,4% |
| 4 | 2,0 pkt | 5,6% |
| 6 | 2,5 pkt | 6,8% |
| 8 | 3,1 pkt | 7,1% |
| 10 | 5,3 pkt | 12,7% |

Po 8 h rozjeżdża się PEŁNA symulacja, a nie model: kursy w powietrzu spadają z 1559 (6. h) do 791 (10. h), a stal (24 → 12%), amunicja kinetyczna (38 → 15%), nikiel, glin i miedź opadają. Model zostaje w stanie ustalonym planu. To osobne znalezisko o długiej grze w Układzie Słonecznym: bramka bilansu mierzy 4 h i tego nie widzi. Zgłaszam je jako ryzyko (§ 10) i propozycję nowej sesji.

### 2.5 Koszt i gdzie liczy się model

- Krok 60 s jednego układu: **2,5 µs** (Node, mediana z 5). 160 układów to 0,4 ms na minutę gry, a 34 układy z gospodarką — 0,09 ms.
- Nadrobienie 10 h jednego układu (600 kroków): 1,2 ms. 26 układów × 240 min: 69 ms.
- Model to czysty moduł (bez DOM, three i `window`, jak `trafficWorld.js`).
  - **W układzie** liczy go worker ruchu, obok świata ruchu strony. Krok rusza wtedy, gdy zegar świata minie pełną minutę (`advance` z gry), więc pauza zatrzymuje też inne układy. Worker trzyma modele wszystkich układów z gospodarką poza bieżącym.
  - **W strefie międzygwiezdnej** (lekka strona strefy, bez świata ruchu) liczy go strona, na zegarze strefy (0,4 ms na minutę gry), albo ten sam worker bez świata.
- Czas nieobecności liczy się zegarem gry z zapisu gracza (`zoneClock` + czas w układach), a nie zegarem ściany. Gra zamknięta nie posuwa gospodarki (D1).

## 3. Wejście do układu i wyjście

### 3.1 Pomiar: z czego startuje świat ruchu

Ziarno 7:
1. Bieg 4 h.
2. Świat ruchu zbudowany od nowa (bez kursów, firm i kupców z biegu) z magazynami nałożonymi pięcioma sposobami.
3. 60 min świata i porównanie z prawdziwą kontynuacją (ten sam bieg w 5. h: 1486 kursów).

| start | kursy po 10 / 20 / 30 / 60 min | dostawy w 60 min | błąd zapełnienia rynków po 60 min |
|---|---|---|---|
| F — pełny zapis magazynów | 1380 / 1419 / 1589 / 1477 | 8428 | 0,9 pkt |
| M4 — wzór z wizyty sprzed 1 h (1 B na parę, 555 B) × wektor modelu teraz | 1465 / 1566 / 1624 / 1434 | 8338 | 1,4 pkt |
| M2 — zapas startowy rynków (`seedStationStock`) × wektor modelu | 137 / 251 / 345 / 883 | 2471 | 5,9 pkt |
| M3 — równe zapełnienie S / C we wszystkich rynkach | 202 / 199 / 234 / 472 | 894 | 10,9 pkt |
| M — odbiorcy do φ, reszta u producentów | 813 / 725 / 810 / 805 | 4170 | 16,4 pkt |
| 0 — od zera (jak dziś) | 154 / 197 / 316 / 754 | 2198 | 8,3 pkt |

Ruch nie bierze się z wektora układu, tylko z nierówności między rynkami (kto ma nadwyżkę, a kto jest pod zapasem roboczym). Wzór zapełnienia rynków z ostatniej wizyty niesie tę nierówność, więc z nim świat w 10 min dochodzi do ruchu z prawdziwego biegu. Sam wektor rozłożony dowolną regułą (M, M2, M3) daje ruch słabszy niż od zera albo podobny.

### 3.2 Wejście (rekomendacja)

1. Strona z `?uklad=<id>` (albo `systemId` z zapisu gracza) buduje świat ruchu z rynków układu (§ 1). Generator działa w workerze ruchu przy `init` (dziś `buildTrafficWorld` trwa 44–64 ms).
2. **Układ odwiedzony** (jest zapis układu, § 4):
   - magazyn każdego rynku = zapisany zapas × `S_model_teraz / S_przy_wyjściu` dla każdego towaru, przycięty do pojemności;
   - głód z zapisu, rejestr pasa i flota frakcji z zapisu, tak jak dziś `restoreEconomyState`;
   - **rozgrzewka 10 min świata** (`warmup: 600`; ~1,2–1,8 s CPU, bo 60 min świata z odtworzonym ruchem to 7,0–10,5 s w Node).
3. **Układ nieodwiedzony**: świat od zera z zapasem startowym (`seedStationStock`) i rozgrzewka 60 min jak dziś (E15: 9,5–10,3 s w workerze, 6,0–10,0 s w Node), bo wzoru nie ma. Wektor modelu (który od startu sektora chodził od tego samego zapasu startowego) przeskalowuje zapas startowy jak w M2, żeby ceny zgadzały się z mapą gwiezdną.
4. Ekran ładowania: rozgrzewka idzie już dziś w tle w menu i na ekranie ładowania. Przy powrocie do znanego układu skraca się z ~10 s do ~1,2–1,8 s.
5. Rozliczenie konwojów, które przybyły pod nieobecność gracza: § 5.4.

### 3.3 Wyjście

Przy wyjściu (gracz w rogu świata, „opuść układ”, zapis, przeładowanie strony) worker ruchu oddaje:
- **pełny zapis układu** (`exportEconomyState` + `systemId` + wektor przy wyjściu, § 4);
- **wektor modelu**:
  - `S` = zapas rynków, które towar obracają, + ładunek kursów w powietrzu (ładunek w drodze to część zapasu układu);
  - `C`, `A`;
  - ślad głodu `Dfix` (średnia ważona pojemnością);
  - flota frakcji (okręty gotowe, `world.shipyards.fleets`);
  - suma ubytku pasa na pole (wydobycie z wyrw spada z wyczerpaniem, § 2.1);
  - czas świata.

Plan modelu (linie, wydobycie, byt) generator liczy na nowo z wpisu, więc się go nie zapisuje.

Kursy w powietrzu, firmy, kupcy i stocznie startują od nowa, tak jak po dzisiejszym wczytaniu zapisu. Pomiar F pokazuje, że to wystarcza: po 10 min świata jest 1380 kursów wobec 1486.

## 4. Zapis ekonomii na układ

### 4.1 Pomiar

- `exportEconomyState` po 4 h: **18,3–18,8 KB** (ziarna 7 / 11 / 23; 48–69 komórek pasa), po 10 h: **24,5 KB** (321 komórek). Część stała to magazyny 34 rynków (~15,8 KB). Rejestr pasa rośnie z wydobyciem, ~20 znaków na komórkę.
- Zapis gry dokłada `worldSeed`, `savedAt` i `playerStations` (setki bajtów), a zapis gracza (`game`) to osobny klucz.
- **Limit localStorage.** Przeglądarka aplikacji Claude (Chromium 152) zmieściła w jednym kluczu źródła example.com 52,4 mln znaków (test zapisu z bisekcją, klucz usunięty). W Chrome użytkownika i w paczce Electron (`electron/`) nie mierzyłem. Dokumentowany limit Chromium to kilka MB na źródło, więc w budżecie liczę ostrożnie **5 mln znaków** na całe źródło gry (wszystkie klucze razem). E20 dostaje test zapisu w harnessie gry.

### 4.2 Format

| klucz | treść | rozmiar |
|---|---|---|
| `economy` | zapis bieżącego układu (jak dziś, + `systemId`); F5 i „Wczytaj” | 18–25 KB |
| `economy:<systemId>` | zapis odwiedzonego układu (LRU 16, bez bieżącego) | 18–25 KB Słońca, 4–8 KB układu proceduralnego (4–8 rynków) |
| `sector-economy` | `{ version, sectorSeed, sectorVersion, clock, systems: { id: wektor } }` — wektory modeli wszystkich układów z gospodarką | ~1,5 KB na układ (64 × zapas i głód + flota + pola), 34 układy ≈ 50 KB |

- Budżet: 16 × 25 KB + 50 KB ≈ 0,45 MB, czyli < 10% ostrożnego limitu. Rejestr pasa rośnie, więc LRU liczy też bajty (np. ≤ 1,5 MB na klucze `economy:*`). Wypchnięty układ zostaje z samym wektorem i sumą ubytku pasa na pole: wyrwy są trwałe (pas się nie regeneruje), więc rejestr pasa pchniętego układu trzeba zachować w skrócie — komórki z ubytkiem ≥ progu wyrwy (D2).
- Wektor: tablice w kolejności `RESOURCE_KEYS` z listą kluczy obok (`resources`, jak dziś), liczby zaokrąglone do 3 cyfr znaczących. Towar spoza tabeli z chwili zapisu zostaje z wartością generatora — to ta sama tolerancja co `restoreStationEconomy`.
- **`ECONOMY_SAVE_VERSION` 3.**
  - Pole `systemId` (domyślnie `'sol'`), `systemMarketsVersion` (§ 1.6), `exit` (wektor przy wyjściu do przeskalowania z § 3.2).
  - Zapis wersji 2 wczytuje się jako zapis Słońca (`systemId: 'sol'`) — świat ruchu Słońca się nie zmienia, więc migracja jest bezpieczna.
  - Stała w `index.html` i `economySave.js` rośnie razem (strażnik `tests/graczNaRynku.test.mjs`).
- „Nowa gra” kasuje wszystkie klucze `economy*` i `sector-economy`. `?reset=economy` obejmuje przedrostek (`ALL_KEYS` + przegląd kluczy z przedrostkiem).

## 5. Handel konwojów sektora

### 5.1 Dziś

- 24 konwoje (ziarno 1). Każdy co postój losuje cel wagą handlu (Słońce 5, nazwani 2,5, reszta rdzenia 1) i nie niesie ładunku (pole `loot` znaczy tylko „jest co łupić”).
- Ładowność z `fleetComposition`, przy przeliczeniu kadłubów sektora na klasy ruchu v2 (prom → hauler 160 t, kontenerowiec → bulk 380 t, frachtowiec dalekiego zasięgu → heavy 900 t, ciężki → mega 2400 t): **4480–18 120 t, mediana 10 300 t, razem 248 tys. t**.
- Rytm: ~25 zawinięć do portu na konwój na godzinę gry (602 w godzinie dla 24 konwojów). Przelot do sąsiada to ~20–40 s, postój 8–22 s.

### 5.2 Ładunek z modeli zbiorczych

Pomiar (`handel.mjs`): modele 26 układów rdzenia z generatora, 240 min od zapasu startowego, potem marża na każdym szlaku rdzenia w obie strony. Kupno po cenie układu A × 1,06, sprzedaż po cenie układu B × 0,94 (rozstęp 12%, `PRICE_MODEL.spread`), próg opłacalności +15%.
- Ceny układów rozjeżdżają się do **×4,6 wartości towaru**, bo import bez dostaw idzie na zero z pełnym głodem. Największy rozrzut mają miedź, przewód, glin, ruda żelaza, tytan, kryształ, polimer, stal, nadstop i uran (każdy 1,0–4,6 × wartość).
- **76 z 92** kierunków szlaków ma opłacalny ładunek, który wypełnia całą ładownię (mediana 10 300 t), z zyskiem **~0,67 mln CR na kurs** (p90 1,06 mln).
- Razem 26 układów potrzebuje 1,83 mln t/h importu (§ 1.7), a konwoje przy 25 zawinięciach na godzinę mogą przewieźć do ~6,2 mln t/h. Flota jest więc wystarczająca, a jej rytm za szybki dla ekonomii: bez ograniczeń konwój zawinąłby z pełną ładownią co ~2,5 min.

Reguła ładunku (propozycja do E21):
1. Przy odlocie z układu A konwój wybiera cel spośród 3 układów losowanych dziś wagą handlu: ten z najlepszą łączną marżą (D9). Dzisiejsze losowanie zostaje jako zapas, gdy żaden nie daje marży.
2. Ładunek to najwyżej 3 towary według marży na tonę. Ilość każdego to minimum z:
   - ładowności;
   - nadwyżki A ponad zapas roboczy (`S − 0,25 · C`);
   - wolnego miejsca w B do progu nadwyżki (`0,7 · C − S`);
   - potrzeby B na 2 h (`(popyt − podaż) · 2 h`).
3. Kupno zdejmuje towar z `S` modelu A przy odlocie, a sprzedaż kładzie go do B przy przybyciu (§ 5.4). Rozliczenie idzie po cenach z chwili zdarzenia, więc z każdym kursem marża maleje, a ceny się zbiegają.
4. Kredyty konwoju nie wchodzą do gospodarki układów: konwój jest flotą frakcji. Zysk to tylko statystyka do UI i strojenia.
5. Rekord floty dostaje pole `cargo` (`{ towar: ilość }`, najwyżej 3 wpisy, ustalony kształt jak inne pola rekordu — reguła `mapa-gwiezdna`). Migawka zapisu gracza je niesie.

### 5.3 Napad

Napad piratów (`resolveContact`, wygrana piratów) przenosi `cargo` konwoju do łupu bandy (`f.cargo`), a przy powrocie bandy do kryjówki — do `S` modelu układu kryjówki. Konwój ucieka bez ładunku (`loot = false`, jak dziś). Paserka działa w układzie kryjówki tak jak dziś w ruchu v2: łup leży w magazynie kryjówki, a przemytnicy sprzedają go dalej, gdy gracz jest w tym układzie. W modelu zbiorczym łup kryjówki nie wraca na rynek, dopóki układ nie ma pełnego świata (D12). Odparty napad zostawia ładunek.

### 5.4 Rozliczenie przy przybyciu

- **Układ B bez gracza**: `S_B += cargo` (do pojemności), od razu przy zdarzeniu przybycia (`arriveAt`).
- **Układ B to układ strony**: ładunek idzie do rynku granicznego (§ 6) przez `adjustStationStock` / `stockDelta` (most), gdy konwój dociera do jego doków. Wcześniej leci w bańce jako grupa kursów.
- **Gracz wraca do układu B**: konwoje, które przybyły pod jego nieobecność, są już w `S_B` i przez przeskalowanie z § 3.2 trafiają do magazynów rynków. Nie potrzeba osobnej kolejki rozliczeń (§ 3.6 planu: „rozliczenie przy wejściu”).
- **Zachowanie masy** (test E21): Σ `S` wszystkich układów + `cargo` konwojów + łup band zmienia się tylko o produkcję, zużycie i straty modeli. Konwój nie drukuje towaru.

### 5.5 Przewijanie flot

- `advanceFleets` (krok 0,1 s): **1 h gry = 0,38 s, 10 h = 3,8 s** (36 tys. kroków na godzinę, 44 floty). Migawka flot ma 21 KB.
- Po powrocie do strefy z 30 min w układzie to 0,2 s, ale po długiej sesji w układzie (kilka godzin) przewijanie zajęłoby kilka sekund na ekranie ładowania strefy.
- Propozycja (D10) dla sesji mapy gwiezdnej: przewijanie powyżej 10 min krokiem 1 s (×10 mniej, ~0,4 s na 10 h), bo ruch floty w strefie nie potrzebuje 10 Hz, gdy nikt nie patrzy. Różnica w trasach nie łamie determinizmu, bo przewijanie zawsze idzie tym samym krokiem dla tej samej długości nieobecności. Handel konwojów (§ 5.2) liczy się w zdarzeniach odlotu i przybycia, więc krok nie zmienia rozliczeń.

## 6. Granica układu strony

### 6.1 Rynek graniczny

- Układ rdzenia dostaje JEDEN rynek graniczny `granica-<róg>` w rogu świata (`JUMP_CORNERS`: NE / NW / SW / SE), którym wchodzi najwięcej handlu (suma wag handlu sąsiadów ze szlaków przypisanych do rogu):
  - `kind: outpost`, `position: { source: 'point', x, y }` przy rogu świata, wewnątrz pudła 12 mln j. (róg leży ~201 AU mapy od gwiazdy, za Kuiperem);
  - frakcja właściciela układu, doki `megadock` (konwój to 6–19 dużych kadłubów);
  - bez przemysłu, bez ludności, z małą obsadą portu.

  Szlak przypisuje się do rogu z kierunku do sąsiada na mapie (ten sam kierunek co wejście `worldEntryFromJump`). W ziarnie 1 układ rdzenia ma 2–5 szlaków (mediana 4), a szlaki wchodzą 1 rogiem w 1 układzie, 2 rogami w 9, 3 w 7 i wszystkimi 4 w 10. Rynek na każdym używanym rogu dałby więc zwykle 3–4 rynki graniczne. Konwój z innego rogu leci przez układ do rynku granicznego (bok pudła to 12 mln j., hipercruise 20–40 tys. j./s: 5–10 min) — to widoczny przelot, a nie strata (D11).
- Cena na rynku granicznym wynika z jego zapasu, jak na każdym rynku. Zapas eksportu zbiera się z planisty, a zapas importu przywozi konwój.

### 6.2 Przewoźnicy ruchu v2: eksport i import

API rynku wystarcza, bez kodu planisty:
- **Eksport.** Rozkład konwojów (§ 5.2) wie, co konwój zabierze przy następnym zawinięciu do układu strony. Rynek graniczny zgłasza popyt `declareDemand(granica, towar, { floor: plan eksportu })`, więc planista i kupcy wiozą towar z rynków-producentów do rogu, a konwój zdejmuje go przy odlocie (`takeStock`).
- **Import.** Ładunek konwoju trafia do magazynu granicznego (`putStock` przez `stockDelta`). Zapas ponad próg nadwyżki (70%) wystawia ofertę sprzedaży (`postOffers`), a planista rozwozi go do odbiorców jak każdą nadwyżkę.
- Do czasu E21 (bez konwojów z ładunkiem) rynek graniczny w E19 dostaje **dowóz stały**: co cykl gospodarki kładzie import z modelu (towary bez producenta w układzie) w ilości `popyt − podaż` × 1,1, po cenie układu. Bez tego układ z importem głodowałby na stałe, a bramka bilansu by go odrzuciła (D3).

### 6.3 Konwój w bańce

- Przybycie konwoju do układu strony to grupa kursów ruchu v2 od rogu do doków rynku granicznego (kurs rodzaju `convoy` w `courseRegistry`, kadłuby z `fleetComposition` → klasy ruchu: frachtowce + eskorta fregat). Bańka pokazuje je jak inne kursy, gdy gracz jest w promieniu. Rozładunek ma postój jak megafrachtowiec, z dronami przeładunku E12.
- Róg leży 8,5 mln j. od gwiazdy, więc konwój zobaczy gracz, który wraca do strefy albo czeka na granicy, a radar i CIC (warstwa HANDEL) pokażą go zawsze. Przelot konwoju przez układ od rogu do rogu (szlak tranzytowy) to tylko rekord kursu, bez rozładunku.
- Napad na konwój w układzie strony to zwykłe piractwo ruchu v2 (`rollPiracy`) na kursach konwoju: łup idzie do kryjówki układu, jeśli ją ma.

## 7. Wojsko (szkic)

- **Dziś.** 10 patroli w sektorze (po 2 na frakcję rdzenia, ~30 okrętów każdy). Rozbity patrol znika i wraca z bazy po 150–300 s bez kosztu. Siła starcia pochodzi z `strength`, a nie ze składu.
- **Propozycja.** Flota frakcji jest wspólna dla świata ruchu i modeli zbiorczych.
  - Okręty gotowe frakcji w układzie to `fleets[frakcja][klasa]` — z zapisu ekonomii w układzie strony albo z wektora modelu w pozostałych.
  - Stocznie modelu (pobór `F`) budują okręty w tempie: zużyte podzespoły / koszt okrętu ważony doktryną (`WARSHIP_CLASSES`). W Układzie Słonecznym to ~200–217 okrętów/h (795–867 w 4 h przy ziarnach 7, 11, 23).
  - Patrol sektora po rozbiciu odradza się dopiero wtedy, gdy frakcja ma w swoich układach ~30 gotowych okrętów: zdejmuje je z floty układów frakcji, proporcjonalnie do zapasu. Bez okrętów patrol czeka, a ruchy piratów rosną.
  - Strata patrolu tworzy popyt: mnożnik poboru stoczni frakcji w modelach rośnie o udział strat z ostatniej godziny (do ×2), więc ceny podzespołów w układach frakcji rosną, a konwoje je tam wiozą.
- **Wojna między frakcjami** wewnątrz układu proceduralnego nie istnieje, bo właściciel jest jeden; w Układzie Słonecznym zostaje bez zmian. Wojna między układami (frakcja zajmuje układ) to osobny etap, poza E19–E21.

## 8. Gracz

- **Handel między układami.** Gracz kupuje w terminalu portu układu strony, leci przez strefę z ładownią (zapis gracza: kredyty i ładownia należą do gracza, a nie do układu) i sprzedaje w innym układzie — tak jak konwój, po cenie z oferty portu (`getTradeOffer`). Przy marży konwoju z § 5.2 (~65 CR/t) ładownia 400 t to ~26 tys. CR na kurs. Ograniczają go ładownia i paliwo w strefie (50 ly zasięgu). Sprzedaż gracza w układzie strony to zwykłe `adjustStationStock`, więc przy wyjściu przechodzi do wektora modelu.
- **Ceny innych układów na mapie gwiezdnej** pochodzą z `sector-economy`. Dla każdego układu z gospodarką mapa pokazuje:
  - indeks cen (średnia ceny / wartości po towarach, które układ obraca);
  - 3 towary najtańsze (eksport) i 3 najdroższe (import) z ceną i strzałką zmiany;
  - wiek danych.

  W zasięgu przekaźników rdzenia (promień rdzenia + 3 ly, jak widoczność flot) dane idą na bieżąco z modelu; dalej — z ostatniej wizyty (migawka cen przy wyjściu z układu albo przy skanie, D4). Pogranicze bez gospodarki nie ma cen.
- **Komputer handlowy** (CIC, HANDEL) może dostać zakładkę „Sektor” z okazjami między sąsiednimi układami z tej samej księgi: marża po rozstępie, czas przelotu i paliwo. To etap po E21.

## 9. Decyzje i wdrożenie

### 9.1 Decyzje dla użytkownika (rekomendacja pierwsza)

| # | decyzja | rekomendacja | inne warianty |
|---|---|---|---|
| D1 (§ 7 planu) | Układ bez gracza: model zbiorczy w tle czy zamrożony do następnej wizyty | **model zbiorczy w tle**, krok 60 s gry, na zegarze gry (gra zamknięta = czas stoi) | zamrożony (ceny na mapie nie żyją, konwoje nie mają czym handlować) |
| D2 (§ 7 planu) | Ile układów trzyma pełny zapis | **każdy odwiedzony, LRU 16 (≤ 1,5 MB)**, reszta — wektor + skrót wyrw; pomiar: 18–25 KB na zapis, limit liczony ostrożnie na 5 mln znaków | 3 ostatnie (propozycja z planu) — przy 3 powrót do czwartego układu idzie od zera z rozgrzewką 60 min |
| D3 (§ 7 planu) | Import i eksport w układzie gracza: widoczne (konwoje rogami, rozładunek w porcie) czy samo rozliczenie liczbowe | **widoczne (E21)**; w E19 rynek graniczny z dowozem stałym importu | liczbowo przy wejściu (bez rynku granicznego; import pojawia się w magazynach po wczytaniu) |
| D4 (§ 7 planu) | Ceny innych układów na mapie | **rdzeń na bieżąco przez przekaźniki, dalej z ostatniej wizyty** | wszystko na bieżąco; wszystko z ostatniej wizyty |
| D5 | Pogranicze: gospodarka czy nie | **bez gospodarki** (pola wydobywcze dla gracza, opuszczone placówki z łupem jak Neptun); niezależne placówki z paliwem — osobna decyzja później | małe placówki niezależnych w ~15% pogranicza (nowa frakcja) |
| D6 | Księżyce w układach proceduralnych | **wydobycie księżyców wliczone w olbrzyma**, rynki-kopalnie na księżycach wtedy, gdy rejestr dostanie księżyce (sesja mapy / generatora planet) | rynki księżyców od razu jako placówki bez ciała w obrazie |
| D7 | Skala gospodarki | **×60 wszędzie** — ceny i zapasy porównywalne między układami (konwoje, gracz) | większa skala małych układów, żeby ruch był gęstszy |
| D8 | Udział importu | **przyciąć w E19 do ≤ 30% przewozu wewnętrznego** (mniejsza moc linii zależnych od importu); prototyp: mediana 49%, razem 43% | zostawić (rynek graniczny najruchliwszym portem połowy układów) |
| D9 | Cel konwoju | **najlepsza marża z 3 celów losowanych wagą handlu**, ładunek z § 5.2 | dziś (los wagą handlu), ładunek tylko po drodze |
| D10 | Przewijanie flot przy długiej nieobecności | **krok 1 s powyżej 10 min** (10 h: 3,8 s → ~0,4 s) — zadanie sesji mapy gwiezdnej | krok 0,1 s zawsze; limit przewijania do 2 h |
| D11 | Rynek graniczny | **jeden na układ, w rogu z największym handlem**, megadok; konwoje z innych rogów lecą do niego przez układ (5–10 min) | jeden na każdy używany róg (w ziarnie 1 zwykle 3–4 rynki) |
| D12 | Łup z napadów w strefie | **do magazynu kryjówki układu bandy**; na rynek wraca dopiero przy pełnym świecie kryjówki | znika (strata konwoju bez paserki) |
| D13 | Głód w modelu | **ślad głodu z ostatniej wizyty jako dolna granica** (błąd ceny 5,6–9,9%) | bez śladu (16%) |
| D14 | Tolerancja modelu w bramce E20 | **zapełnienie ≤ 2,5 pkt, ≥ 85% towarów w 5 pkt, cena ze śladem ≤ 10%, produkcja ≤ 10%** (3 ziarna, 4 h) | luźniejsza (5 pkt, 15%) |

Do tego jedno zgłoszenie spoza zakresu: pełna symulacja Układu Słonecznego po 8 h traci połowę kursów i zapasu stali (§ 2.4). Propozycja: osobna sesja, która przedłuży bramkę bilansu do 8–10 h i znajdzie przyczynę (flota przewoźników, kapitał firm, wyczerpanie pól?).

### 9.2 Kroki wdrożenia

Każdy krok: commit po każdym etapie, bramka bilansu Układu Słonecznego (`node scripts/bramka-bilansu.mjs --ziarna 7,11,23`) z wynikiem identycznym liczba w liczbę względem `main` (JSON w `.tmp/bramka-bilansu/`; czas ticku poza porównaniem), a do tego `npm test` i `node --test "tests/*.test.mjs"` bez nowych porażek względem bazy.

**E19 — rynki układu proceduralnego** (zależy od E18 i od pierwszego układu proceduralnego w grze — sesja „Ograniczenie gracza w jednym układzie”):
- Pliki:
  - nowy `src/game/traffic/systemMarkets.js` — `generateSystemMarkets(entry)` → `{ version, markets: MarketDef[], industry: { id: { capacity, roles, size } }, yields: { id: { rate, yields } }, fields, border }`, z domknięciem mocy § 1.5 i przycięciem importu D8;
  - `src/data/markets.js` (pole `yield` w `defineMarket`);
  - `src/game/stationEconomy.js` (`station.yield` przed `PLANET_YIELD`; `buildIndustryMap(spec, { yields })`; `stationHaulTonnage` i `systemHaulTonnage` z mapy świata);
  - `src/game/traffic/markets.js` (przemysł `{ capacity, roles, size }`, `yield`, stacja pasa bez `SMALL_BODY_STATIONS`);
  - `trafficWorld.js` (`buildTrafficWorld({ system })`: planety, pasy i rynki z układu; Słońce domyślnie);
  - `travelNetwork.js` (planety z opcji);
  - `miningFields.js` (pasy z opcji);
  - `workerBubble.js` (studnie z planet układu);
  - `trafficProtocol.js` i `trafficCore.js` (`init.systemId`);
  - blok „RUCH v2” w `index.html` (świat ruchu z `CURRENT_SYSTEM`; dziś w układzie proceduralnym ekonomia wyłączona);
  - rynek graniczny z dowozem stałym (§ 6.2).
- Testy:
  - `tests/systemMarkets.test.mjs`: determinizm bit w bit, id lokalne i unikalne, kolejność, wersja, pokrycie ≥ 95% dla towarów z producentem, import ≤ 30%, każdy układ rdzenia ma byt lokalnie albo w dowozie stałym;
  - `tests/starSystems.test.mjs` bez zmian;
  - suity ruchu w `npm test` (`trafficWorld`, `stationEconomy` § 12 — migawka Słońca bez zmian).
- Bramki:
  - Słońce liczba w liczbę;
  - **bramka na 3 układach z ziarna 1** (Alfa Centauri, Tau Ceti, Gwiazda Barnarda): `node scripts/bramka-bilansu.mjs --uklad <id>` (nowa opcja; świat z `systemRegistryEntry`). Progi jak § 5 planu, przy czym głód nie obejmuje towarów z dowozu stałego, a tick ma być ≤ 10 ms (prototyp: przewóz 0,20–0,52 Słońca);
  - start gry w układzie proceduralnym: 0 pipeline'ów synchronicznych (porty E14, bańka).

**E20 — model zbiorczy i zapis na układ** (zależy od E18; równolegle z E19 do chwili wpięcia, wspólny plik tylko `economySave.js`):
- Pliki:
  - nowy `src/game/traffic/systemAggregate.js` — `createAggregate(plan, …)`, `stepAggregate`, `aggregatePrice`, `aggregateFromWorld(world)` (wyjście, § 3.3), `stocksFromAggregate(world, save, agg)` (wejście, § 3.2), plan z mapy przemysłu;
  - `economySave.js` (v3: `systemId`, `systemMarketsVersion`, `exit`, migracja v2 → `sol`);
  - `trafficCore.js` (modele układów w workerze, krok co minutę świata, wiadomości `sector-economy-*`);
  - `index.html` (klucze `economy:<id>`, `sector-economy`, LRU, „Nowa gra”, `?reset=economy`);
  - narzędzie `scripts/model-zbiorczy-kalibracja.mjs` (z `.tmp/e18/kalibracja.mjs` + próbkowanie z `pelna2.mjs`).
- Testy:
  - `scripts/tests/economySave.test.mjs` (v3, migracja, przeskalowanie wejścia);
  - nowy `tests/systemAggregate.test.mjs` (bez alokacji w kroku — `untilSteady`; zachowanie masy; ślad głodu; nadrobienie 10 h = 600 kroków bez dryfu NaN);
  - `tests/graczNaRynku.test.mjs` (stała wersji).
- Bramki:
  - Słońce liczba w liczbę;
  - kalibracja w progach D14 na ziarnach 7, 11, 23;
  - wejście z zapisu: ≥ 90% kursów prawdziwego biegu po 10 min rozgrzewki (pomiar F/M4);
  - `scripts/webgpu/rynek-gra.mjs`: zapis → F5 → wczytanie bez zmian.

**E21 — handel między układami** (zależy od E19, E20 i wpięcia strefy w grę, `PLAN-mapa-gwiezdna.md` „Wpięcie w grę”):
- Pliki:
  - `src/game/sector/sectorFleets.js` (pole `cargo`, napad przenosi ładunek, przewijanie D10 — przez sesję mapy gwiezdnej albo za jej zgodą);
  - nowy `src/game/sector/sectorTrade.js` (wybór celu i ładunku z modeli, rozliczenie przybycia, czysty moduł);
  - rynek graniczny z eksportem i importem (`declareDemand`, `stockDelta`) zamiast dowozu stałego;
  - kurs `convoy` w `courseRegistry.js`, `trafficDirector.js` i w bańce (`workerBubble.js`, kadłuby z `fleetComposition`);
  - ceny na mapie gwiezdnej (dane z `sector-economy`).
- Testy:
  - determinizm handlu (ten sam sektor i te same wejścia → te same ładunki);
  - zachowanie masy (§ 5.4);
  - napad i łup;
  - migawka flot z ładunkiem;
  - koszt przewijania 10 h ≤ 0,5 s.
- Bramki:
  - Słońce liczba w liczbę bez konwojów, a z konwojami — bramka na 3 ziarnach z importem i eksportem w progach;
  - bramka 3 układów proceduralnych bez dowozu stałego (konwoje karmią import);
  - zbieżność cen: rozrzut cen sektora po 4 h ≤ ×2 wartości (dziś bez handlu ×4,6).

## 10. Ryzyka

- **Długa gra w Układzie Słonecznym.** Pełna symulacja po 8 h traci połowę kursów (1559 → 791) i zapasu stali, a bramka mierzy 4 h. Model zbiorczy tego nie odda. To pierwsza rzecz do zbadania przed E20.
- **Import.** Prototyp generatora daje udział importu z medianą 49%. Bez przycięcia (D8) rynek graniczny staje się najruchliwszym portem, a układ — zależny od konwojów, których przed E21 nie ma. Dowóz stały w E19 to proteza.
- **Sprzężenie z tabelami Słońca** (§ 1.8): 11 miejsc w ruchu v2 czyta tabele Słońca po id. Każde musi dostać dane z parametru z domyślną tabelą Słońca. Pominięte miejsce w układzie proceduralnym nie rzuci błędu, tylko po cichu zostawi rynek bez wydobycia albo przemysłu. Test generatora powinien sprawdzać, że każdy rynek z wydobyciem w danych rzeczywiście wydobywa w pierwszym cyklu.
- **Model a pola wydobywcze.** Uran i inne rudy z pól dochodzą falami wypraw (błąd modelu: uran 14 → 5%). Przy układach, których przemysł zależy od pól (Tau Ceti, Syriusz), błąd modelu będzie większy niż na Słońcu. Kalibracja E20 powinna objąć też układ z bramki E19.
- **Konwoje i pieniądze.** Zysk ~0,67 mln CR na kurs przy 25 zawinięciach na godzinę. Gdyby kredyty konwojów trafiały do frakcji albo firm, zalałyby gospodarkę, dlatego w propozycji to tylko statystyka (§ 5.2).
- **localStorage w Electron** niezmierzony. Pomiar z przeglądarki aplikacji (52 mln znaków) nie przenosi się na paczkę.
- **Rozgrzewka 10 min** po powrocie zmierzona tylko dla Słońca (pomiar F/M4). W małym układzie proceduralnym ruch może potrzebować innego czasu — E20 mierzy to na układach z bramki E19.
- Nie zrobione w E18: generator nie był sprawdzony pełną symulacją ruchu (świat ruchu z rynków układu wymaga zmian z § 1.8, czyli E19). Przewóz i tick układów proceduralnych są szacunkiem z planu, a nie pomiarem.
