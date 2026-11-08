# PROPOZYCJA — ekonomia ruchu v2 przy wielu układach gwiezdnych (E18)

Spisana 2026-11-08 i uzupełniona tego samego dnia o decyzje użytkownika (§ 10.1). To PROJEKT, nie zmiana gry: kodu w `src/` nie ruszałem. Stan wyjściowy to lokalny `main` z 2026-11-08 (`3fb88830`): przebudowa ekonomii E1–E17 scalona, mapa gwiezdna i rejestr układów w `main`, do gry niewpięte. Plan ekonomii: `docs/PLAN-ekonomia-rynki.md` (§ 3.6 kierunek, § 4 zadania E18–E21, § 7 decyzje). Zasady obszarów: reguły `ruch-v2`, `uklady-gwiezdne`, `mapa-gwiezdna`; mapa i floty: `docs/PLAN-mapa-gwiezdna.md`; komputer handlowy: `docs/E7-gracz-na-rynku.md`.

**Ramy od użytkownika (nie do zmiany):**
- z 2026-11-07:
  - układów jest dużo i są proceduralne (z ziarna);
  - gospodarki układów są niezależne, a bez gracza uproszczone;
  - między układami ruszają się tylko floty kupieckie i wojsko, więc koszt rośnie liniowo z liczbą układów;
  - gra ładuje jeden układ na stronę, a przejście do innego układu to przeładowanie strony;
- z 2026-11-08:
  - układ bez gracza liczy się W TLE;
  - pełny zapis (te same statki po powrocie) ma układ bieżący i 3 ostatnio odwiedzone, a pozostałe układy zapisują tylko stan modelu w tle;
  - import i eksport w układzie gracza są WIDOCZNE: konwoje wchodzą rogami świata i rozładowują się w portach;
  - ceny NIE są na mapie gwiezdnej. Pokazuje je komputer handlowy („kto ile za co płaci”, § 9), więc model w tle liczy się na stację (rynek);
  - floty sektora (konwoje kupieckie, patrole, piraci) są zawsze WSZYSTKIE. Liczy je mapa gwiezdna niezależnie od liczby pełnych zapisów, a ich migawka idzie w zapisie gracza.

**Pomiary.** Skrypty leżą poza repozytorium, w `.tmp/e18/` worktree E18 (kopia: notatki sesji, `E18-skrypty/`):
- `pelna2.mjs` — pełna symulacja Układu Słonecznego (240 min, presja 1, magazyny ×4, skala ×60) z próbką co minutę i migawką magazynów stacji co godzinę;
- `dluga.mjs` — to samo przez 600 min (ziarno 7);
- `rynki-model.mjs` i `rynki-kalibracja.mjs` — model w tle na rynek i jego kalibracja;
- `model.mjs` i `kalibracja.mjs` — wektor układu (pomiar porównawczy);
- `generator.mjs` i `uklady.mjs` — prototyp generatora na sektorze `generateSector({ seed: 1 })`;
- `wejscie.mjs` i `wejscie-rynki.mjs` — start świata ruchu z zapisu, z modelu i od zera;
- `zapis-statkow.mjs` i `kursy.mjs` — pełny zapis ze statkami;
- `zapytanie.mjs` — koszt zapytania komputera;
- `handel.mjs`, `floty.mjs`, `rogi.mjs` — konwoje i przewijanie flot.

Pomiary szły w ciszy innych sesji; w tle działał tylko serwer Vite użytkownika.

## 0. W skrócie

- **Generator (§ 1).** Rynki układu powstają z wpisu rejestru (`systemRegistryEntry`): planety, pasy i `sector.faction`, `zone`, `pirateBase`, `gate`. Każdy rodzaj planety ma szablon na analogii z Układu Słonecznego (archetypy, wydobycie, osada, habitat). Pas planetoid daje pola i stację pasa, pas lodowy — pola z uranem. Moc zakładów domyka się do pokrycia popytu ≥ 95%. Sektor z ziarna 1:
  - 26 układów rdzenia ma 121 rynków (100 czynnych), po 2–8 na układ, wobec 34 rynków Układu Słonecznego;
  - przewóz wewnętrzny to mediana 0,20 przewozu Słońca;
  - 7 kryjówek ma po jednym rynku, a 126 układów pogranicza nie ma gospodarki.
- **Model w tle NA RYNEK (§ 2).** Każdy rynek układu bez gracza ma własny magazyn 64 towarów, swoje linie receptur, wydobycie, byt i stocznię (logika `runStationEconomy`). Przewóz między rynkami jest abstrakcyjny: nadwyżka idzie do odbiorców pod zapasem roboczym, z limitem przepustowości z planu, opóźnieniem i stratą 5%. Na Układzie Słonecznym, wobec migawek stacji pełnej symulacji (ziarna 7, 11, 23, godziny 1–4):
  - zapełnienie pary rynek–towar różni się średnio o 3,4–3,5 pkt proc., a 91–92% par mieści się w 10 pkt;
  - cena skupu (bez głodu) różni się o 3,4–3,5%;
  - **najlepszego kupca trafia w 86–87% towarów**, a 77–78% z trzech najlepszych to te same rynki. Dla porównania: zapas z chwili 0 bez zmian trafia w 60%, a prawdziwy wektor układu rozłożony równo na rynki — w 55%.

  Koszt: **2,3–4,1 µs na rynek i krok 60 s**, czyli przy 160 układach × 10 rynków 3,7–6,6 ms na minutę gry. Realny sektor (~140 rynków) to 0,3–0,6 ms na minutę. Nadrobienie 10 h Słońca (27 rynków) zajmuje 42–66 ms.
- **Wejście (§ 3).** Świat ruchu startuje z magazynów modelu na rynek. Po 10 min świata jest 1700–1755 kursów (prawdziwy bieg: 1486), a zapełnienie różni się o 1,6–3,4 pkt, więc wystarcza **rozgrzewka 10 min (~1,2–1,8 s CPU)** zamiast dzisiejszych 60 min (6–10 s). Pełny zapis (układ bieżący + 3 ostatnie) dokłada te same statki: kursy, które skończyły się pod nieobecność gracza, rozlicza do magazynów; trwające stawia w punkcie trasy z zegara kursu. Kursy są krótkie (mediana 6,7 min, p90 9 min), więc po ≥ 10 min nieobecności prawie wszystkie statki stoją już w portach docelowych.
- **Zapis (§ 4).** Dzisiejszy zapis `economy` to 16–18,8 KB (24,5 KB po 10 h), a wczytanie (`restoreEconomyState`) trwa 31 ms. Stan statków przy skali gry ×60 to 9,9 tys. statków, 1303 kursy, 922 trwające zlecenia i 4958 wraków po 4 h. Jako JSON bez historii to 4,2–6,6 MB, po gzip 0,28–0,64 MB. Pełny zapis idzie więc do plików (Electron: katalog `userData`, przeglądarka: IndexedDB), a nie do localStorage. Stan modelu w tle to ~0,4 KB na rynek (~80 KB realnego sektora).
- **Konwoje (§ 5).** Dziś 24 konwoje bez ładunku. Ładowność to 4,5–18 tys. t (mediana 10,3 tys.), a konwój zawija do portu ~25 razy na godzinę. Ceny między układami rozjeżdżają się do ×4,6 wartości; 76 z 92 kierunków szlaków ma opłacalny pełny ładunek z zyskiem ~0,67 mln CR na kurs, więc ładunek ogranicza reguła (§ 5.2). Przewinięcie flot o 10 h trwa 3,8 s.
- **Granica (§ 6).** Rynek graniczny stoi w rogu świata z największym handlem. Przewoźnicy ruchu v2 obsługują go przez API rynku: eksport to `declareDemand`, import to zapas ponad próg nadwyżki. Konwój wchodzi rogiem jako grupa kursów widoczna w bańce i rozładowuje się w porcie.
- **Komputer handlowy (§ 9).** Odpowiada na pytanie, kto ile płaci za towar z ładowni, na stację i z układem. Źródła:
  - w układzie strony kopia rynku z mostu (`getTradeEconomy` / `getTradeOffer`);
  - w innych układach model w tle w workerze ruchu.

  Zapytanie po 1500 rynkach trwa 95 µs na towar (cała ładownia: 0,5 ms), więc „chwila liczenia” to droga wiadomości do workera (1–2 klatki) i ewentualne opóźnienie przekaźników (D14). Część dla jednego układu da się zrobić już teraz (E22a).
- **Decyzje (§ 10).** D1–D4 rozstrzygnął użytkownik; D5–D18 czekają, z rekomendacjami. Wdrożenie: E19 (generator i świat ruchu z rynków układu), E20 (model w tle na rynek, pełny zapis ze statkami, pliki), E21 (handel konwojów i rynek graniczny), E22 (komputer: kto ile płaci). Każde zadanie przechodzi bramkę bilansu z Układem Słonecznym liczba w liczbę.

## 1. Generator rynków z opisu układu

### 1.1 Wejście i ranga układu

Wejściem jest wpis rejestru z sektora (`systemRegistryEntry`, `src/game/sector/sectorRegistry.js`):
- planety `{ id: 'p<n>', type, seed, orbitAU, baseR }`;
- pasy `{ id: 'pas<n>', kind: 'asteroid' | 'ice', innerAU, outerAU }`;
- blok `sector`: `faction`, `zone`, `pirateBase`, `gate`, `seed`.

Generator czyta tylko wpis i niczego w nim nie zmienia: `starSystems.js` i `src/game/sector/` zostają tylko do odczytu.

| ranga | warunek | ziarno 1 | gospodarka |
|---|---|---|---|
| stolica frakcji | `zone: core` i `gate` (siedziby z bramą) | 6 + Słońce | pełna, większa moc |
| rdzeń | `zone: core`, bez bramy | 20 | pełna, moc ×0,55 |
| kryjówka | `pirateBase` | 7 | jeden rynek kryjówki, bez przemysłu |
| pogranicze | reszta | 126 | brak (pola wydobywcze bez właściciela, D5) |

Stolice z ziarna 1 to Alfa Centauri, Wolf 359, Syriusz, Epsilon Eridani, 61 Cygni i Wega. Gospodarkę ma 33 ze 160 układów (26 proceduralnych w rdzeniu i 7 kryjówek) plus Układ Słoneczny.

### 1.2 Rodzaj planety → rynek

Każdy rodzaj ma szablon na analogii z Układu Słonecznego: role (`INDUSTRY_ARCHETYPES`), skład wydobycia (wzór `PLANET_YIELD`), moc, osadę i habitat. Planeta poza stolicą zostaje rynkiem z prawdopodobieństwem `p`; planeta niewylosowana to rynek opuszczony (działka, jak Neptun).

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
- **Habitat** (obsada, workforce) dostaje każda planeta `terran` i `ocean` z rynkiem. Układ bez nich ma stację mieszkalną przy stolicy (`population: { habitat }`). Podaż habitatów to 1,28 × rotacja potrzebnej obsady (zapas 28%, jak w Układzie Słonecznym: 521 tys. osób/h wobec 407 tys./h rotacji), dzielona między habitaty.
- **Księżyce.** Generator sektora ich nie robi (`moons: []`). Do czasu księżyców w rejestrze wydobycie olbrzymów obejmuje też ich księżyce, tak jak dziś skład Jowisza zawiera lód z Europy. Rynki-kopalnie księżyców wchodzą, gdy rejestr dostanie księżyce (D6).

### 1.3 Pasy

- **Pas planetoid** daje dwie rzeczy:
  - pola wydobywcze `miningFields.js` z pasa wpisu (`innerAU`–`outerAU`), ze składem: Fe 0,28, Ni 0,20, C 0,22, Si 0,14, Ti 0,06, Pt 0,04, lód 0,06 (wnętrze metaliczne, zewnątrz węgiel — do strojenia przystankami jak w `BELT_DEFINITIONS`);
  - **stację pasa** (analog Westy i Ceres): rynek na orbicie środka pasa z rolami huta + rafineria pasa, mocą 3,5–5 × ranga, osadą 0,4–0,5 i własnym złożem `rate` 1,6–2,4 (skład Westy z węglem Ceres).
- **Pas lodowy** daje pola z lodem 0,62, uranem 0,12, węglem 0,16 i kryształem 0,10. Rynku tam nie ma, tak jak w Kuiperze.

### 1.4 Kryjówka, brama, rynek graniczny

- **Kryjówka w rdzeniu** (analog Złomowiska) powstaje z szansą 0,45: orbita 0,55–0,8 najdalszej planety, 3 stanowiska, frakcja piratów. Piractwo wewnątrz układu działa na niej tak jak dziś.
- **Układ kryjówki z sektora** (`pirateBase`) ma jeden rynek kryjówki: za pasem planetoid albo na orbicie zewnętrznej, 4 stanowiska. Planety są opuszczone. Tu trafia łup z napadów na konwoje (§ 5.3).
- **Brama wewnątrz układu** (hub `gate`) stoi tylko przy stolicy i tylko wtedy, gdy układ ma ≥ 5 planet: brama potrzebuje drugiej w zasięgu, a w małym układzie jest zbędna.
- **Rynek graniczny** `granica-<róg>` stoi przy rogu świata (§ 6).

### 1.5 Domknięcie mocy

Losowa moc nie domyka bilansu. Bez domknięcia w prototypie niemal wszystkie podzespoły okrętowe (awionika, rdzenie, napędy, silniki hipercruise i warp, emitery tarcz) miały pokrycie popytu < 95%. Powód: pobór stoczni (`FLEET_DEMAND` × skala wojskowa) rośnie z osadą każdego rynku z przemysłem, a stocznia stolicy dostawała ułamek mocy. W Układzie Słonecznym tę liczbę dobrano ręcznie (Ziemia 20,8, Mars 16,8).

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
- Id rynków są LOKALNE (reguła `uklady-gwiezdne`): `p<n>` (rynek planety ma id planety, tak jak dziś `earth`), `stacja-pasa`, `kryjowka`, `granica-<róg>`. Globalny id na mapie, w zapisie i w komputerze handlowym to `globalBodyId(układ, id)`.
- Kolejność tabeli rynków jest częścią danych, tak jak `MARKET_DEFS`: planety po orbicie, stacja pasa, kryjówka, rynek graniczny. Rynek dodany później idzie na koniec.
- Zmiana generatora, która zmienia rynki przy tym samym ziarnie, podnosi `SYSTEM_MARKETS_VERSION`. Zapis układu (§ 4) ją niesie, a inna wersja oznacza zapis pominięty i układ od nowa z modelu.

### 1.7 Wynik na sektorze z ziarna 1

| ranga | układów | rynków (czynnych z kryjówką) | moc | przewóz z planu (skala 1) | obsada (×60) | import (×60) |
|---|---|---|---|---|---|---|
| Słońce | 1 | 34 (27) | 81,8 | 11 855 t/h | ~305 tys. | — |
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

## 2. Model w tle: na rynek

### 2.1 Dwie rzeczy: model w tle i pełny zapis

To dwie osobne warstwy, które łatwo pomylić:

| | model w tle | pełny zapis |
|---|---|---|
| co to jest | żywe zapasy, ceny i głód KAŻDEGO RYNKU we wszystkich układach z gospodarką poza układem strony | szczegóły świata ruchu jednego układu: statki (gdzie stoją, co wiozą), kursy w locie, zlecenia, wraki, kolejki portów, rezerwacje |
| kiedy działa | cały czas, krok co 60 s gry (D1: w tle) | tylko przy wejściu do układu (wczytanie) i wyjściu (zapis) |
| po co | ceny i zapasy dla komputera handlowego (kto ile płaci, § 9), handel konwojów (§ 5), start świata ruchu przy wejściu (§ 3) | „te same statki” po powrocie do niedawno odwiedzonego układu |
| ile układów | wszystkie z gospodarką (realnie ~34, najwyżej 160) | układ bieżący + 3 ostatnio odwiedzone (D2) |
| koszt | 2,3–4,1 µs na rynek i krok | 0,28–0,64 MB gzip na układ, zapis i wczytanie w workerze (§ 4) |

Model w tle liczy się na RYNEK, a nie jeden wektor na układ. Komputer handlowy ma powiedzieć, która stacja ile płaci (§ 9), a sam wektor układu tego nie wie. Rozłożenie nawet prawdziwego wektora układu na rynki trafia najlepszego kupca tylko w 55% towarów (§ 2.3). Wektor układu zostaje jako suma po rynkach — do handlu konwojów (cena eksportu i importu układu, § 5.2) i do statystyk.

Floty sektora (konwoje kupieckie, patrole, piraci) nie należą do żadnej z tych warstw. Liczy je zawsze mapa gwiezdna, wszystkie naraz, a ich migawka (`fleetSnapshot`) idzie w zapisie gracza (D2 nie zmienia ich liczby).

### 2.2 Stan i krok modelu na rynek

Rynek w modelu to rekord liczb (bez kursów, statków i portów):
- `S[64]` — zapas;
- `C[64]` — pojemność (z zapisu albo z `addMarket`: baza ×4 × skala + premie budynków);
- `D[64]` — długość głodu w sekundach;
- plan z mapy przemysłu układu, liczony raz:
  - linie receptur z mocą (`lineWeight`);
  - wydobycie (`yield`);
  - byt i pobór wojskowy (`systemDemandFor(…, {})`);
  - pobór stoczni (`FLEET_DEMAND` × skala wojskowa × 0,5);
  - flagi „używa” (`stationWantsResource`) i „produkuje” (`getStationOutputs`);
  - zużycie brutto na sekundę (`stationConsumptionRates`);
- rura dostaw `pipe[3][64]` — towar w drodze do rynku, który dojdzie w kolejnych krokach.

Układ w modelu to lista rynków + przewóz z planu `H[64]` (dopasowanie nadwyżek do niedoborów jak w `stationHaulTonnage`) + zegar.

Krok układu o 60 s gry (3 cykle gospodarki):
1. **Każdy rynek, co cykl**, robi to samo co `runStationEconomy`: wydobycie (wartość oczekiwana zamiast losowania typu), receptury po kolei na własnym magazynie (wsad do zera, linia stoi, gdy wszystkie wyjścia pełne), byt i stocznia. Obsada (workforce) jak w świecie: podaż habitatu i rotacja `N / T`.
2. **Dostawy z rury** trafiają do magazynów (do pojemności).
3. **Przewóz, dla każdego towaru osobno:**
   - oferta rynku to zapas ponad próg: producent i rynek, który towaru nie używa — ponad max(0,3; `offerFloorFill` 0,25) pojemności, a odbiorca, który sam go nie robi — ponad 0,7 (próg nadwyżki planisty);
   - potrzeba rynku, który towar używa: `0,25 · C + zużycie · 900 s · 1,15 − S − w rurze` (zapas roboczy `inventorySafetyFill` + zużycie w czasie dostawy, jak `buyOrderUnits`);
   - przewóz = min(Σ ofert, Σ potrzeb, H · skala · krok), rozdzielony proporcjonalnie;
   - towar schodzi z magazynów oferujących od razu i wchodzi do rury odbiorców z opóźnieniem 3 kroków (3 min) i stratą 5% (piractwo, wraki).
4. **Głód** rynku rośnie, gdy zapas ≤ 8% pojemności, a rynek towaru używa; odpuszcza ×3 szybciej (`PRICE_MODEL`).

Cena rynku liczy się tym samym wzorem co `resourcePrice`: wartość × niedobór × profil frakcji × głód, z rozstępem. Skup (bid) i ilość, którą rynek kupi (do `restockTarget`), liczą się jak `portOfferFromQuote`, więc komputer pokazuje te same liczby, które gracz zobaczy w terminalu po przylocie. Krok nie alokuje: tablice typowane, plan liczony raz.

Parametry (siatka na ziarnie 7, § 2.3): próg oferty 0,3, horyzont potrzeby 900 s, przepustowość ×1 planu, opóźnienie 3 kroki, strata 0,05, stocznie ×0,5. Opóźnienie 1 albo 3 i próg 0,3–0,7 dają ten sam wynik w granicy 0,2 pkt.

### 2.3 Kalibracja na Układzie Słonecznym

Metoda: model startuje z magazynów świata ruchu w chwili 0 (te same co pełna symulacja). Porównanie idzie z migawką magazynów wszystkich stacji pełnej symulacji co godzinę (godziny 1–4), na 530 parach rynek–towar, które rynek obraca (producent albo odbiorca, bez obsady). Cenę porównuję bez głodu, bo migawka stacji go nie niesie.

| miara (godziny 1–4) | ziarno 7 | ziarno 11 | ziarno 23 | zapas z chwili 0 bez zmian | prawdziwy wektor układu rozłożony równo |
|---|---|---|---|---|---|
| zapełnienie pary: średni błąd | 3,4 pkt | 3,4 pkt | 3,5 pkt | 11,1 pkt | 13,8 pkt |
| pary w granicy 10 pkt | 92% | 91% | 91% | 69% | 42% |
| cena skupu (bez głodu): średni błąd | 3,4% | 3,5% | 3,5% | 14,8% | 13,7% |
| najlepszy kupiec towaru trafiony | 86% | 87% | 86% | 60% | 55% |
| wspólne rynki w trzech najlepszych | 78% | 78% | 77% | 65% | 49% |

„Najlepszy kupiec trafiony” znaczy: dla towaru, którego używają co najmniej 3 rynki, rynek z najwyższą ceną skupu w modelu jest tym samym rynkiem co w pełnej symulacji albo ma tę samą cenę w granicy 2%. Wektor układu rozłożony równo jest gorszy niż zapas z chwili 0, bo ceny rynków różnią się nierównością zapasów, a nie poziomem układu.

**Długi horyzont** (bieg 10 h, ziarno 7; model startuje z migawki stacji w chwili wyjścia):

| wyjście (zapełnienie / najlepszy kupiec) | godz. 2 | godz. 3 | godz. 5 | godz. 6 | godz. 8 | godz. 10 |
|---|---|---|---|---|---|---|
| w 1. h | 3,0 pkt / 81% | 4,0 pkt / 83% | 4,9 pkt / 88% | — | 6,2 pkt / 88% | 8,3 pkt / 71% |
| w 4. h | — | — | 2,6 pkt / 92% | 3,9 pkt / 92% | 5,2 pkt / 86% | 7,5 pkt / 73% |

Część błędu po 8. h to sama pełna symulacja, która od ~6. h traci kursy: z 1559 do 791 w 10. h, a zapas stali spada z 24 do 12%, amunicji kinetycznej z 38 do 15%. Bramka bilansu mierzy 4 h i tego nie widzi (§ 11).

**Tolerancja do bramki modelu (E20, propozycja, D15)** — na trzech ziarnach w godzinach 1–4:
- średni błąd zapełnienia par ≤ 4 pkt i ≥ 88% par w granicy 10 pkt;
- cena skupu ≤ 5%;
- najlepszy kupiec trafiony ≥ 80%.

### 2.4 Wektor układu (pomiar porównawczy)

Przed decyzją o modelu na rynek zmierzyłem prostszy wariant: jeden wektor towarów na układ, bez przewozu (`model.mjs`). Zostaje jako suma po rynkach (cena układu do handlu konwojów i do statystyk), a jego wyniki pokazują, ile kosztuje dokładność:
- zapełnienie układu różni się od pełnej symulacji o 1,5 pkt (56–57 z 63 towarów w granicy 5 pkt);
- cena bez głodu różni się o 6,9%, a z głodem przeniesionym z ostatniej wizyty o 5,6–9,9%;
- koszt: 2,5 µs na układ i krok.

Pełna symulacja na poziomie układu prawie nie zależy od ziarna: rozrzut 0,46 pkt i 0,5% ceny. Wektor układu ma więc jeden stan ustalony, ale nie mówi, która stacja ile płaci (patrz ostatnia kolumna tabeli § 2.3). Dwie rzeczy z tego pomiaru weszły do modelu na rynek:
- **pułap gromadzenia**: producent stoi pełny, a odbiorca trzyma tylko zapas roboczy — w modelu na rynek wynika to wprost z progów oferty i potrzeby;
- **produkcja bez dławienia transportem**: linie Słońca pracują z wydajnością 99,3% planu (wartością); niżej są tylko wodór (58%), stal (87%) i amunicja (95%).

### 2.5 Koszt i gdzie liczy się model

- Krok 60 s: **2,3–4,1 µs na rynek** (1500 rynków = 60 kopii modelu Słońca: 3,5–6,2 ms na krok, mediana z 5).
  - 160 układów × 10 rynków (1600 rynków, ×64 towary): **3,7–6,6 ms na minutę gry**, czyli 0,06–0,11 ms na sekundę gry;
  - realny sektor z ziarna 1 (27 rynków Słońca, ~100 rynków 26 układów rdzenia, 7 kryjówek): ~140 rynków, 0,3–0,6 ms na minutę gry.
- Nadrobienie 10 h układu Słońca (27 rynków, 600 kroków): 42–66 ms; układ proceduralny z 5 rynkami: ~10 ms.
- Model to czysty moduł (bez DOM, three i `window`, jak `trafficWorld.js`).
  - **W układzie** liczy go worker ruchu, obok świata ruchu strony. Krok rusza, gdy zegar świata minie pełną minutę (`advance` z gry), więc pauza zatrzymuje też inne układy. Krok idzie w kawałkach między krokami świata (`schedule`, jak rozgrzewka), żeby 6 ms przy 1600 rynkach nie spadło na jeden krok świata.
  - **W strefie międzygwiezdnej** (lekka strona strefy, bez świata ruchu) liczy go ten sam worker bez świata ruchu, na zegarze strefy.
- Czas nieobecności liczy się zegarem gry z zapisu gracza (`zoneClock` + czas w układach), a nie zegarem ściany. Gra zamknięta nie posuwa gospodarki.

## 3. Wejście do układu i wyjście

### 3.1 Pomiar: z czego startuje świat ruchu

Ziarno 7, bieg 4 h, potem świat ruchu zbudowany od nowa (bez kursów, firm i kupców z biegu) z magazynami nałożonymi różnymi sposobami. Następnie 60 min świata i porównanie z prawdziwą kontynuacją (ten sam bieg w 5. h: 1486 kursów).

| start | kursy po 10 / 30 / 60 min | błąd zapełnienia rynków po 60 min |
|---|---|---|
| F — magazyny z biegu (dzisiejszy zapis `economy`) | 1380 / 1589 / 1477 | 0,9 pkt |
| MR3 — magazyny z 3. h + 1 h modelu na rynek (wyjście i powrót po godzinie) | 1700 / 1568 / 1464 | 1,6 pkt |
| MR0 — model na rynek od początku gry do 4. h (układ nigdy nieodwiedzony) | 1755 / 1937 / 1991 | 3,4 pkt |
| M4 — wzór zapełnienia rynków z 3. h (1 B na parę) × wektor układu z 4. h | 1465 / 1624 / 1434 | 1,4 pkt |
| M2 — zapas startowy rynków × wektor układu | 137 / 345 / 883 | 5,9 pkt |
| M3 — równe zapełnienie S / C we wszystkich rynkach | 202 / 234 / 472 | 10,9 pkt |
| 0 — od zera (jak dziś) | 154 / 316 / 754 | 8,3 pkt |

Ruch bierze się z nierówności między rynkami (kto ma nadwyżkę, a kto jest pod zapasem roboczym), a nie z poziomu układu. Model na rynek tę nierówność liczy, więc świat ruchu z jego magazynów w 10 min dochodzi do ruchu prawdziwego biegu. Układ nigdy nieodwiedzony (MR0) ma o ~20–35% więcej kursów niż prawdziwy bieg, bo model nie zna kursów w locie, a świat startuje z nowymi firmami — do sprawdzenia bramką E20. Sam wektor układu rozłożony dowolną regułą (M2, M3) daje ruch słabszy niż od zera.

### 3.2 Wejście (rekomendacja)

1. Strona z `?uklad=<id>` (albo `systemId` z zapisu gracza) buduje świat ruchu z rynków układu (§ 1). Generator działa w workerze ruchu przy `init`; dziś `buildTrafficWorld` trwa 44–64 ms.
2. **Magazyny rynków** biorą się z modelu w tle (zapas i głód rynku). Model chodził przez całą nieobecność, więc nadrobienia nie ma. Rejestr pasa i flota frakcji też pochodzą ze stanu modelu (§ 4.2).
3. **Statki:**
   - układ z pełnym zapisem (bieżący + 3 ostatnie, D2) — statki, kursy, zlecenia i wraki z zapisu, z rozliczeniem nieobecności (§ 3.3);
   - pozostałe — statki od nowa, jak dziś po wczytaniu.
4. **Rozgrzewka 10 min świata** (`warmup: 600`; ~1,2–1,8 s CPU workera — 60 min świata z odtworzonym ruchem to 7,0–10,5 s w Node) w obu przypadkach. Wystarcza, bo kursy trwają mediana 6,7 min, p90 9 min (§ 3.3).
5. **Pierwszy start sektora** („Nowa gra”, D17): zamiast 60 min pełnego świata — 60 min modelu na rynek (Słońce: 27 rynków × 60 kroków ≈ 4–7 ms), potem 10 min świata. Rozgrzewka przy nowej grze skraca się z 6–10 s do ~1,5–2 s. Wymaga sprawdzenia bramką E20, bo przebieg ruchu w pierwszej godzinie się zmienia.
6. **Konwoje**, które przybyły pod nieobecność gracza, są już w magazynie rynku granicznego modelu (§ 5.4).

### 3.3 Pełny zapis: co wraca po nieobecności

Pomiar (ziarno 7, skala ×60, po 4 h): 1303 kursy w locie; zostało im do końca mediana 3,4 min, p90 6,8 min, najdłużej 111 min (holowniki i wyprawy górnicze). Statków jest 9854: 1120 w drodze i 8734 w portach, w 939 grupach (firma, klasa, port). Po ≥ 10 min nieobecności ponad 90% kursów z zapisu jest więc już skończonych, a „te same statki” oznaczają głównie te same statki w tych portach, w których skończyły kursy.

Zasada księgowa: **ładunek kursu należy albo do kursu, albo do magazynu (albo rury modelu) — nigdy do obu.**

1. **Przy wyjściu** zapis bierze statki, kursy, trwające zlecenia i wraki. Ładunek kursów w locie trafia do rury modelu rynku docelowego jako dostawa w chwili `eta`. Dzięki temu model przez nieobecność widzi towar, który dojedzie.
2. **Przy wejściu, przed rozgrzewką**, dla każdego kursu z zapisu:
   - **skończony** (`eta ≤ teraz`): dostawy nie robi się drugi raz, bo model już ją wliczył (rura). Kurs dostaje stan końcowy (`delivered`), zlecenie przechodzi w `DELIVERED`, a statek staje w porcie docelowym (`PARKED`, `stationId` = cel, bez stanowiska). Kurs bez ładunku (pusty przelot, powrót promu) tylko przestawia statek;
   - **trwający**: kurs zostaje i dostaje zegar świata przesunięty o nieobecność. Pozycja na trasie liczy się z etapu i czasu (kursy są analityczne: `stages`, `stageElapsed`, `eta`). Jego ładunek trzeba zdjąć z rury modelu, bo wróci do kursu. Kurs na stanowisku w porcie dokańcza postój.
   - **przechwyt pod nieobecność**: brak. Straty piractwa liczył model (5% przewozu); kurs z zapisu dolatuje.
3. **Odbudowuje się od zera**, bo liczy je sam świat w rozgrzewce: kolejki portów i rezerwacje stanowisk, księga rynku (`rebuildReservations` z trwających kursów), oferty, notowania, rotacja garnizonu, kampanie wojenne, rejdy i przemyt.
4. **Wraca z zapisu**: kapitał firm i ich statki (z liczbą kursów), kupcy (kapitał, karawany), postęp pochylni stoczni i wraki (te, których złomiarze nie zebrali).
5. **Statek awansowany do pełnego NPC** w bańce (reguła `ruch-banka`) w chwili wyjścia wraca do zapisu jako statek bańki z kursem, tak jak dziś przy końcu walki.

Po nieobecności dłuższej niż najdłuższy kurs (D18: próg 2 h) zapis statków sprowadza się do rozstawienia ich po portach. Kursy z zapisu można wtedy pominąć, a ich ładunek jest już w modelu.

### 3.4 Wyjście

Przy wyjściu (gracz w rogu świata, „opuść układ”, zapis, przeładowanie strony) worker ruchu oddaje:
- **stan modelu dla układu** (rynek po rynku: zapas, głód, pojemność; rura z ładunkiem kursów w locie; flota frakcji `world.shipyards.fleets`; rejestr pasa; zegar). Od tej chwili układ liczy model w tle;
- **pełny zapis** (statki, kursy, zlecenia, wraki, firmy, kupcy, stocznie), gdy układ jest wśród 3 ostatnio odwiedzonych. Najstarszy z czterech wypada z pełnego zapisu i zostaje z samym stanem modelu.

Plan modelu (linie, wydobycie, byt) generator liczy na nowo z wpisu, więc się go nie zapisuje.

## 4. Zapis ekonomii na układ

### 4.1 Pomiar

- **Dzisiejszy `economy`** (`exportEconomyState`: magazyny 34 rynków z głodem, rejestr pasa, flota frakcji): 16 KB po 60 min, 18,3–18,8 KB po 4 h (ziarna 7 / 11 / 23; 48–69 komórek pasa), 24,5 KB po 10 h (321 komórek). Wczytanie na świeży świat (`JSON.parse` + `restoreEconomyState`) trwa **31 ms**. Statków ani kursów w nim nie ma, nawet po F5 — „te same statki” to nowa rzecz w E20.
- **Stan statków** przy skali gry ×60 (świat jak w grze; liczby orkiestratora — 659 statków, ~0,5 MB — są ze skali testu `economySave`, gdzie statków jest ~15× mniej):

| po | statki | zlecenia: dostarczone / wraki / trwające | kursy w locie | wraki | JSON bez historii | gzip | `JSON.parse` |
|---|---|---|---|---|---|---|---|
| 60 min | 9931 (2,3 MB) | 1648 / 223 / 433 (trwające 391 KB) | 754 (1,4 MB) | 532 (115 KB) | 4,2 MB | 284 KB (40 ms) | 24 ms |
| 240 min | 9854 (2,3 MB) | 19 523 / 3098 / 922 (trwające 834 KB) | 1303 (2,4 MB) | 4958 (1,1 MB) | 6,6 MB | 643 KB (73 ms) | 39 ms |

- Historia zleceń (dostarczone i rozbite) to po 4 h **20,5 MB** i rośnie z czasem gry — nie wchodzi do zapisu. Wraki rosną (4958 po 4 h); do zapisu idą te, które leżą na mapie, bez historii zebranych.
- Płytki JSON rekordów niesie pola robocze (np. `viewState` kursu, zagnieżdżone etapy). Zwarty zapis (statek: id, firma, klasa, kadłub, port, stan, kurs — ~40 B; statki w porcie mogą iść grupami firma–klasa–port, 939 grup) to szacunek ~0,3–0,6 MB bez kompresji i ~0,1 MB po gzip na układ wielkości Słońca. Układ proceduralny ma 0,2–0,5 przewozu Słońca, więc odpowiednio mniej.
- **Limit localStorage.** Przeglądarka aplikacji Claude (Chromium 152) zmieściła w jednym kluczu źródła example.com 52,4 mln znaków (test zapisu z bisekcją, klucz usunięty). W Chrome użytkownika i w paczce Electron nie mierzyłem; ostrożnie liczę 5 mln znaków na całe źródło gry. Pełny zapis 4 układów w płytkim JSON (4 × 4–7 MB) by się nie zmieścił, w gzip (4 × 0,3–0,6 MB) — ledwo, obok innych kluczy.

### 4.2 Format i miejsce

| zapis | treść | rozmiar | gdzie |
|---|---|---|---|
| stan modelu w tle | `{ version, sectorSeed, sectorVersion, clock, systems: { id: { marketsVersion, markets: { id: [zapas, głód] po towarach, które rynek obraca }, pipe, fleets, mining } } }` | ~0,4 KB na rynek (~20 towarów × 2 liczby); realny sektor ~140 rynków ≈ 60–80 KB; 1600 rynków ≈ 0,64 MB | localStorage `sector-economy` (do ~1 MB); powyżej — jak pełny zapis |
| pełny zapis układu (bieżący + 3) | dzisiejszy `economy` + statki, kursy w locie, zlecenia trwające, wraki na mapie, firmy, kupcy, pochylnie | 0,1–0,64 MB gzip na układ (zwarty: ~0,1 MB) | **Electron: pliki** `Dokumenty\HULLFALL\zapisy\ekonomia-<systemId>.json.gz`; **przeglądarka: IndexedDB** |
| zapis gracza | jak dziś (`game`, `src/game/playerSave.js`) + migawka flot sektora (wszystkie floty, 21 KB), eksploracja | dziś kilka KB + 21 KB | localStorage `game` |

- **Electron.** `electron/main.js` już ustawia `userData` na `Dokumenty\HULLFALL` i zapisuje tam plik stanu startu (`fs.writeFileSync`). Pełny zapis ekonomii dostaje dwa kanały IPC przez `preload.js`: zapis pliku (zapis do pliku tymczasowego i `rename`, jak dziś) i odczyt. Kompresja i `JSON.parse` idą w workerze ruchu (`CompressionStream('gzip')`, 40–73 ms, poza wątkiem gry), a strona przekazuje gotowe bajty.
- **Przeglądarka (`npm run dev`, Chrome).** IndexedDB, bo jej limit liczy się od miejsca na dysku, a nie 5 MB, i zapisuje asynchronicznie (`beforeunload` nie czeka na zapis asynchroniczny, więc pełny zapis idzie przy wyjściu z układu i co autozapis, a przy zamknięciu strony zostaje dzisiejszy synchroniczny `economy`).
- **Czas wczytania** przy wejściu: gzip i `JSON.parse` 40–110 ms + odtworzenie statków i kursów (szacunek < 100 ms) + budowa świata 44–64 ms + rozgrzewka 10 min (1,2–1,8 s). Razem ~1,5–2 s na ekranie ładowania, niezależnie od liczby układów w zapisie.
- **`ECONOMY_SAVE_VERSION` 3**: pole `systemId` (domyślnie `'sol'`), `systemMarketsVersion` (§ 1.6), statki (`fleet`), stan modelu przy wyjściu. Zapis wersji 2 wczytuje się jako zapis Słońca bez statków — świat ruchu Słońca się nie zmienia, więc migracja jest bezpieczna. Stała w `index.html` i `economySave.js` rośnie razem (strażnik `tests/graczNaRynku.test.mjs`).
- „Nowa gra” kasuje wszystkie zapisy ekonomii: `economy`, `sector-economy`, pliki i IndexedDB. `?reset=economy` obejmuje to samo.
- Wyrwy pasa są trwałe (pas się nie regeneruje), więc rejestr pasa każdego układu żyje w stanie modelu, a nie tylko w pełnym zapisie. Model po nieobecności wydobywa z pól z uwzględnieniem ubytku.

## 5. Handel konwojów sektora

### 5.1 Dziś

- Mapa gwiezdna liczy zawsze wszystkie floty sektora (ziarno 1: 24 konwoje, 10 patroli, 10 band), niezależnie od tego, który układ ma pełny zapis. Migawka flot (21 KB) idzie w zapisie gracza.
- Konwój co postój losuje cel wagą handlu (Słońce 5, nazwani 2,5, reszta rdzenia 1) i nie niesie ładunku (pole `loot` znaczy tylko „jest co łupić”).
- Ładowność z `fleetComposition`, przy przeliczeniu kadłubów sektora na klasy ruchu v2 (prom → hauler 160 t, kontenerowiec → bulk 380 t, frachtowiec dalekiego zasięgu → heavy 900 t, ciężki → mega 2400 t): **4480–18 120 t, mediana 10 300 t, razem 248 tys. t**.
- Rytm: ~25 zawinięć do portu na konwój na godzinę gry (602 w godzinie dla 24 konwojów). Przelot do sąsiada to ~20–40 s, postój 8–22 s.

### 5.2 Ładunek z modelu w tle

Ceny układu do handlu konwojów pochodzą z modelu na rynek:
- cena kupna w A to najniższa cena sprzedaży (ask) rynków A z ofertą;
- cena sprzedaży w B to najwyższa cena skupu (bid) rynków B, które towar skupują.

Konwój ładuje i rozładowuje się zawsze na rynku granicznym (§ 6), a dalej towar rozwozi przewóz modelu albo — w układzie strony — przewoźnicy ruchu v2.

Pomiar (`handel.mjs`, wektor układu z generatora, 240 min od zapasu startowego, marża na każdym szlaku rdzenia w obie strony, kupno × 1,06, sprzedaż × 0,94, próg opłacalności +15%):
- ceny układów rozjeżdżają się do **×4,6 wartości towaru**, bo import bez dostaw idzie na zero z pełnym głodem. Największy rozrzut mają miedź, przewód, glin, ruda żelaza, tytan, kryształ, polimer, stal, nadstop i uran (każdy 1,0–4,6 × wartość);
- **76 z 92** kierunków szlaków ma opłacalny ładunek, który wypełnia całą ładownię (mediana 10 300 t), z zyskiem **~0,67 mln CR na kurs** (p90 1,06 mln);
- 26 układów potrzebuje razem 1,83 mln t/h importu (§ 1.7), a konwoje przy 25 zawinięciach na godzinę przewiozłyby do ~6,2 mln t/h. Flota wystarcza, ale jej rytm jest za szybki dla ekonomii: bez ograniczeń konwój zawinąłby z pełną ładownią co ~2,5 min.

Reguła ładunku (E21):
1. Przy odlocie z A konwój wybiera spośród 3 układów losowanych dziś wagą handlu ten z najlepszą łączną marżą (D9). Dzisiejsze losowanie zostaje jako zapas, gdy żaden nie daje marży.
2. Ładunek to najwyżej 3 towary według marży na tonę. Ilość każdego to minimum z:
   - ładowności;
   - oferty rynków A (zapas ponad próg oferty);
   - skupu rynków B do progu nadwyżki (`0,7 · C − S`, łącznie z towarem w drodze);
   - potrzeby B na 2 h (popyt − podaż układu × 2 h).
3. Kupno zdejmuje towar z rynków A przy odlocie (w układzie strony — z rynku granicznego, `takeStock`), sprzedaż kładzie go do rynku granicznego B przy przybyciu. Rozliczenie idzie po cenach z chwili zdarzenia, więc z każdym kursem marża maleje, a ceny się zbiegają.
4. Kredyty konwoju nie wchodzą do gospodarki układów: konwój jest flotą frakcji, a zysk to tylko statystyka do UI i strojenia. Przy ~0,67 mln CR na kurs kredyty płynące do frakcji albo firm zalałyby gospodarkę.
5. Rekord floty dostaje pole `cargo` (`{ towar: ilość }`, najwyżej 3 wpisy, stały kształt jak inne pola rekordu — reguła `mapa-gwiezdna`). Migawka zapisu gracza je niesie.

### 5.3 Napad

Napad piratów (`resolveContact`, wygrana piratów) przenosi `cargo` konwoju do łupu bandy (`f.cargo`), a przy powrocie bandy do kryjówki — do magazynu rynku kryjówki w modelu jej układu. Konwój ucieka bez ładunku (`loot = false`, jak dziś); odparty napad zostawia ładunek. Łup kryjówki wraca na rynek dopiero przez paserkę ruchu v2, gdy kryjówka ma pełny świat, czyli gdy gracz jest w jej układzie (D12).

### 5.4 Rozliczenie przy przybyciu

- **Układ B bez gracza**: ładunek trafia do rynku granicznego B w modelu w chwili przybycia (`arriveAt`), a przewóz modelu rozwozi go do odbiorców.
- **Układ B to układ strony**: konwój wchodzi rogiem jako grupa kursów (§ 6.3), a ładunek idzie do rynku granicznego przez `adjustStationStock` / `stockDelta` (most), gdy konwój dociera do jego doków.
- **Gracz wraca do układu B**: konwoje, które przybyły pod jego nieobecność, są już w magazynach modelu, a magazyny świata ruchu przy wejściu pochodzą z modelu (§ 3.2). Nie potrzeba osobnej kolejki rozliczeń.
- **Zachowanie masy** (test E21): Σ zapasów rynków wszystkich układów + rury + `cargo` konwojów + łup band zmienia się tylko o produkcję, zużycie i straty modeli. Konwój nie drukuje towaru.

### 5.5 Przewijanie flot

- `advanceFleets` (krok 0,1 s): **1 h gry = 0,38 s, 10 h = 3,8 s** (36 tys. kroków na godzinę, 44 floty).
- Po powrocie do strefy z 30 min w układzie to 0,2 s, ale po kilku godzinach w układzie przewijanie zajęłoby kilka sekund na ekranie ładowania strefy.
- Propozycja (D10) dla sesji mapy gwiezdnej: przewijanie powyżej 10 min krokiem 1 s (×10 mniej, ~0,4 s na 10 h), bo ruch floty w strefie nie potrzebuje 10 Hz, gdy nikt nie patrzy. Determinizm zostaje: ta sama długość nieobecności zawsze idzie tym samym krokiem. Handel konwojów liczy się w zdarzeniach odlotu i przybycia, więc krok nie zmienia rozliczeń.

## 6. Granica układu strony

### 6.1 Rynek graniczny

- Układ rdzenia dostaje JEDEN rynek graniczny `granica-<róg>` w rogu świata (`JUMP_CORNERS`: NE / NW / SW / SE), którym wchodzi najwięcej handlu (suma wag handlu sąsiadów ze szlaków przypisanych do rogu):
  - `kind: outpost`, `position: { source: 'point', x, y }` przy rogu świata, wewnątrz pudła 12 mln j. (róg leży ~201 AU mapy od gwiazdy, za Kuiperem);
  - frakcja właściciela układu, doki `megadock` (konwój to 6–19 dużych kadłubów);
  - bez przemysłu, bez ludności, z małą obsadą portu.

  Szlak przypisuje się do rogu z kierunku do sąsiada na mapie (ten sam kierunek co wejście `worldEntryFromJump`). W ziarnie 1 układ rdzenia ma 2–5 szlaków (mediana 4), a szlaki wchodzą 1 rogiem w 1 układzie, 2 rogami w 9, 3 w 7 i wszystkimi 4 w 10. Rynek na każdym używanym rogu dałby więc zwykle 3–4 rynki graniczne. Konwój z innego rogu leci przez układ do rynku granicznego (bok pudła to 12 mln j., hipercruise 20–40 tys. j./s: 5–10 min) — to widoczny przelot, a nie strata (D11).
- Rynek graniczny jest zwykłym rynkiem także w modelu w tle, więc komputer handlowy widzi jego ceny jak każdej stacji.

### 6.2 Przewoźnicy ruchu v2: eksport i import

API rynku wystarcza, bez kodu planisty:
- **Eksport.** Rozkład konwojów (§ 5.2) wie, co konwój zabierze przy następnym zawinięciu do układu strony. Rynek graniczny zgłasza popyt `declareDemand(granica, towar, { floor: plan eksportu })`, więc planista i kupcy wiozą towar z rynków-producentów do rogu, a konwój zdejmuje go przy odlocie (`takeStock`).
- **Import.** Ładunek konwoju trafia do magazynu granicznego (`putStock` przez `stockDelta`). Zapas ponad próg nadwyżki (70%) wystawia ofertę sprzedaży (`postOffers`), a planista rozwozi go do odbiorców jak każdą nadwyżkę.
- Do czasu E21 (bez konwojów z ładunkiem) rynek graniczny w E19 dostaje **dowóz stały**: co cykl gospodarki kładzie import (towary bez producenta w układzie) w ilości (popyt − podaż) × 1,1, po cenie układu. Bez tego układ z importem głodowałby na stałe, a bramka bilansu by go odrzuciła.

### 6.3 Konwój w bańce (D3: widoczny)

- Przybycie konwoju do układu strony to grupa kursów ruchu v2 od rogu do doków rynku granicznego (kurs rodzaju `convoy` w `courseRegistry`, kadłuby z `fleetComposition` → klasy ruchu: frachtowce + eskorta fregat). Bańka pokazuje je jak inne kursy, gdy gracz jest w promieniu. Rozładunek ma postój jak megafrachtowiec, z dronami przeładunku E12.
- Róg leży 8,5 mln j. od gwiazdy, więc konwój zobaczy gracz, który wraca do strefy albo czeka na granicy. Radar i CIC (warstwa HANDEL) pokażą go zawsze. Przelot konwoju przez układ od rogu do rogu (szlak tranzytowy) to tylko rekord kursu, bez rozładunku.
- Napad na konwój w układzie strony to zwykłe piractwo ruchu v2 (`rollPiracy`) na kursach konwoju; łup idzie do kryjówki układu, jeśli ją ma.

## 7. Wojsko (szkic)

- **Dziś.** 10 patroli w sektorze (po 2 na frakcję rdzenia, ~30 okrętów każdy). Rozbity patrol znika i wraca z bazy po 150–300 s bez kosztu. Siła starcia pochodzi z `strength`, a nie ze składu.
- **Propozycja.** Flota frakcji jest wspólna dla świata ruchu i modelu w tle:
  - okręty gotowe frakcji w układzie to `fleets[frakcja][klasa]` — z zapisu w układzie strony albo ze stanu modelu w pozostałych;
  - stocznie modelu (pobór stoczni na rynkach) budują okręty w tempie: zużyte podzespoły / koszt okrętu ważony doktryną (`WARSHIP_CLASSES`). W Układzie Słonecznym to ~200–217 okrętów/h (795–867 w 4 h przy ziarnach 7, 11, 23);
  - patrol sektora po rozbiciu odradza się dopiero wtedy, gdy frakcja ma w swoich układach ~30 gotowych okrętów: zdejmuje je z floty układów frakcji, proporcjonalnie do zapasu. Bez okrętów patrol czeka, a piraci zyskują;
  - strata patrolu tworzy popyt: mnożnik poboru stoczni frakcji w modelu rośnie o udział strat z ostatniej godziny (do ×2), więc ceny podzespołów w układach frakcji rosną, a konwoje je tam wiozą.
- **Wojna między frakcjami** wewnątrz układu proceduralnego nie istnieje, bo właściciel jest jeden; w Układzie Słonecznym zostaje bez zmian. Wojna między układami (frakcja zajmuje układ) to osobny etap, poza E19–E22.

## 8. Gracz

- **Handel między układami.** Gracz kupuje w terminalu portu układu strony, leci przez strefę z ładownią (kredyty i ładownia należą do gracza, `src/game/playerSave.js`) i sprzedaje w innym układzie — tak jak konwój, po cenie z oferty portu (`getTradeOffer`). Przy marży konwoju z § 5.2 (~65 CR/t) ładownia 400 t to ~26 tys. CR na kurs. Ograniczają go ładownia i paliwo w strefie (50 ly zasięgu). Sprzedaż gracza w układzie strony to zwykłe `adjustStationStock`, więc przy wyjściu przechodzi do modelu.
- **Mapa gwiezdna nie pokazuje cen** (D4). Skąd gracz wie, gdzie sprzedać — § 9.
- **Kontrakty obsady** (workforce W5–W7, osobna sesja `workforce-w5-w7`) idą przez API ofert rynku, więc komputer handlowy pokaże je tym samym zapytaniem (towar `workforce`, § 9.6).

## 9. Komputer handlowy: kto ile płaci

Decyzja użytkownika (2026-11-08): żeby zobaczyć ceny, gracz podpina się do komputera handlowego. Przykład: lód w ładowni — gracz najeżdża na niego, a komputer pokazuje kupców (stacja, układ, cena). Komputer może chwilę liczyć, z wskaźnikiem, ale musi pokazać wynik.

### 9.1 Co pokazuje

Zapytanie „kto kupuje towar X” (i odwrotne „kto sprzedaje X”) zwraca listę rynków, posortowaną domyślnie po cenie. W wierszu:
- stacja i układ (nazwa, `globalBodyId`);
- cena skupu (`bid` — z reputacją gracza u frakcji rynku, `getFactionPriceMultiplier`, jak w terminalu);
- ile rynek kupi (`buy` z `portOfferFromQuote`: do `restockTarget`, z towarem w drodze); „ma dość” i „nie skupuje” jak w terminalu;
- droga: w układzie strony — odległość i czas lotu (hipercruise / warp z `travelNetwork`), w innych — skoki i ly szlaku (`lanePath`) + paliwo strefy;
- wiek danych („teraz”, „sprzed 3 h — ostatnia wizyta”);
- zysk wobec ceny, za którą gracz kupił towar (ładownia pamięta średnią cenę zakupu partii — nowe pole w zapisie gracza).

Domyślnie widać 10 najlepszych. Filtry: tylko ten układ, w zasięgu paliwa, bez wrogich frakcji, zysk na tonę zamiast ceny.

### 9.2 Źródło danych i szczegółowość

Szczegółowość jest zawsze ta sama: rynek (stacja).

| gdzie | źródło | dokładność |
|---|---|---|
| układ strony | kopia rynku z mostu: `getTradeEconomy(id)` (zapas, pojemność, głód, `bid` / `ask`) i `getTradeOffer` (`sell` / `buy` z bufora `MARKET_FIELD.SELL` / `BUY`) | dokładnie to, co pokaże terminal po przylocie (ta sama kopia) |
| inne układy z gospodarką | model w tle na rynek, w workerze ruchu: cena wzorem `resourcePrice` i ilość wzorem `portOfferFromQuote` na zapasie modelu | cena skupu ± 3,5%, najlepszy kupiec trafiony w 86–87% (§ 2.3) |
| kryjówki piratów | nic, dopóki gracz w nich nie był; potem paser jak dziś | — |

Model nie zna rezerwacji z pojedynczych kursów, więc ilość „kupi” w innym układzie to szacunek. Komputer pokazuje ją z dopiskiem „ok.”, a cenę — przed przylotem i po zmianie zapasu przez konwoje.

### 9.3 Świeżość (D13)

- **Rdzeń** (promień rdzenia + 3 ly, jak widoczność flot w `fleetVisibleToPlayer`): na bieżąco ze stanu modelu, przez sieć przekaźników.
- **Poza zasięgiem przekaźników** (dalsze układy rdzenia, gdy gracz jest na pograniczu, i kryjówki): ceny z ostatniej wizyty albo z ostatniego połączenia z przekaźnikami. To WIEDZA GRACZA: migawka ceny skupu i sprzedaży na rynek dla towarów, które rynek obraca (~0,2 KB na rynek; ~30 KB dla realnego sektora). Leży w zapisie gracza, a nie w modelu, bo model zawsze liczy dalej.
- Model chodzi dla wszystkich układów niezależnie od tego, co wie gracz; świeżość to tylko reguła pokazywania.

### 9.4 Koszt zapytania i „chwila liczenia”

- Pomiar (`zapytanie.mjs`, 1500 rynków = 60 kopii modelu Słońca): zapytanie o jeden towar — przejście po rynkach, cena, ilość, sortowanie — trwa **95 µs mediana, 0,9 ms najwięcej**. Cała ładownia (10 towarów) to **0,5 ms**. Realny sektor (~140 rynków) to ułamek tego.
- Rachunek idzie więc w workerze ruchu, a nie na stronie, bo stan modelu jest tylko tam. Zapytanie to wiadomość `trade-buyers { resourceId, filters }`, a odpowiedź przychodzi w następnej wiadomości workera: 1–2 klatki (16–33 ms przy 60 Hz), bez wpływu na klatkę gry.
- „Chwila liczenia” nie wynika z kosztu rachunku. Wskaźnik pokazuje się, dopóki nie przyjdzie odpowiedź z workera (zwykle niewidoczny). Do decyzji (D14), czy dodać opóźnienie przekaźników do danych z innych układów (np. 0,3 s na skok szlaku, ≤ 2 s), żeby wskaźnik coś znaczył. Rekomendacja: tak, krótkie i tylko dla innych układów; układ strony odpowiada od razu.
- Droga (skoki, ly) z grafu szlaków: `laneNext` jest już policzone w sektorze (bez kosztu). Czas lotu w układzie strony — z `travelNetwork` (wycena trasy), w workerze.

### 9.5 Miejsce w interfejsie

1. **Ładownia.** Tablet kokpitu ma dziś w stopce tylko „ŁADOWNIA x / y” (`cockpitUI.js`). Nowa karta „Ładownia” pokazuje listę towarów; najechanie (albo wybór padem) na wiersz otwiera panel kupców z § 9.1. To jest przykład użytkownika.
2. **Terminal portu, karta „Handel”** (E7: Towar / Ładownia / Port ma / Port sprzedaje / Port skupuje). Najechanie na wiersz z towarem w ładowni pokazuje obok „lepiej zapłacą”: 3 najlepszych kupców poza tym portem z różnicą ceny. Najechanie na „Port sprzedaje” pokazuje, kto kupi drożej.
3. **Komputer handlowy w CIC** (warstwa HANDEL, klawisz H, E7 § 2). Panel „Kupcy towaru” z wyborem towaru i pełną listą z filtrami. Na mapie układu strony rynki z listy dostają znacznik ceny; kupcy z innych układów są w liście ze wskazaniem rogu wyjścia.
4. **Strefa międzygwiezdna.** Ta sama lista (bez mapy cen — D4), z odległością w ly i paliwem.

### 9.6 Kontrakty obsady

Sesja `workforce-w5-w7` wystawia kontrakty obsady przez API ofert rynku (skup `workforce`). Zapytanie „kto kupuje” dla towaru `workforce` pokaże je bez nowego kodu: rynek, ile osób, ile płaci, z modułem pasażerskim Atlasa jako „ładownią”. W modelu w tle obsada liczy się jak w świecie (podaż habitatu, rotacja), więc kontrakty innych układów też będą widoczne.

### 9.7 Wdrożenie (E22)

- **E22a — jeden układ, już teraz** (zależy tylko od E7 i mostu, bez E19–E21):
  - `TrafficBridge.findTradePartners(resourceId, side, filters)` na kopii rynku z mostu, liczone na stronie: 34 rynki Słońca, mikrosekundy, bez workera;
  - karta „Ładownia” w tablecie, podpowiedź w terminalu, panel „Kupcy towaru” w CIC;
  - średnia cena zakupu partii w ładowni (zapis gracza).

  Testy: wynik jak terminal (ta sama kopia), sortowanie, „ma dość” i „nie skupuje”. Gra: `scripts/webgpu/rynek-gra.mjs` rozszerzony o zapytanie z ładowni.
- **E22b — wiele układów** (po E20, z E21 dla rynku granicznego):
  - wiadomość workera `trade-buyers` łączy kopię mostu (układ strony) z modelem w tle (inne układy) i wiedzą gracza (świeżość D13);
  - droga z `lanePath`, opóźnienie przekaźników (D14), wskaźnik liczenia.

  Testy: zgodność modelu z kopią w układzie strony (ten sam rynek po wejściu ma ceny modelu sprzed wejścia ± tolerancja D15); wiedza gracza w zapisie.

## 10. Decyzje i wdrożenie

### 10.1 Decyzje użytkownika (2026-11-08)

| # | decyzja | wynik |
|---|---|---|
| D1 (§ 7 planu) | Układ bez gracza | **liczony w tle** — model na rynek (§ 2) |
| D2 (§ 7 planu) | Ile układów ma pełny zapis | **układ bieżący + 3 ostatnio odwiedzone** (statki, kursy, zlecenia — § 3.3); pozostałe: stan modelu w tle (§ 4.2). Floty sektora zawsze wszystkie |
| D3 (§ 7 planu) | Import i eksport w układzie gracza | **widoczne** — konwoje wchodzą rogami i rozładowują się w porcie (§ 6.3) |
| D4 (§ 7 planu) | Ceny innych układów | **nie na mapie gwiezdnej**, tylko komputer handlowy (§ 9) |

### 10.2 Decyzje do podjęcia (rekomendacja pierwsza)

| # | decyzja | rekomendacja | inne warianty |
|---|---|---|---|
| D5 | Pogranicze: gospodarka czy nie | **bez gospodarki** (pola wydobywcze dla gracza, opuszczone placówki z łupem jak Neptun); niezależne placówki z paliwem — osobna decyzja później | małe placówki niezależnych w ~15% pogranicza (nowa frakcja) |
| D6 | Księżyce w układach proceduralnych | **wydobycie księżyców wliczone w olbrzyma**; rynki-kopalnie na księżycach wtedy, gdy rejestr dostanie księżyce | rynki księżyców od razu jako placówki bez ciała w obrazie |
| D7 | Skala gospodarki | **×60 wszędzie** — ceny i zapasy porównywalne między układami (konwoje, gracz, komputer) | większa skala małych układów, żeby ruch był gęstszy |
| D8 | Udział importu | **przyciąć w E19 do ≤ 30% przewozu wewnętrznego** (mniejsza moc linii zależnych od importu); prototyp: mediana 49%, razem 43% | zostawić (rynek graniczny najruchliwszym portem połowy układów) |
| D9 | Cel konwoju | **najlepsza marża z 3 celów losowanych wagą handlu**, ładunek z § 5.2 | dziś (los wagą handlu), ładunek tylko po drodze |
| D10 | Przewijanie flot przy długiej nieobecności | **krok 1 s powyżej 10 min** (10 h: 3,8 s → ~0,4 s) — zadanie sesji mapy gwiezdnej | krok 0,1 s zawsze; limit przewijania do 2 h |
| D11 | Rynek graniczny | **jeden na układ, w rogu z największym handlem**, megadok; konwoje z innych rogów lecą do niego przez układ (5–10 min) | jeden na każdy używany róg (w ziarnie 1 zwykle 3–4 rynki) |
| D12 | Łup z napadów w strefie | **do magazynu kryjówki układu bandy**; na rynek wraca przez paserkę przy pełnym świecie kryjówki | znika (strata konwoju bez paserki) |
| D13 | Świeżość cen w komputerze | **rdzeń na bieżąco przez przekaźniki, dalej — wiedza z ostatniej wizyty** | wszystko na bieżąco; wszystko z ostatniej wizyty |
| D14 | „Chwila liczenia” | **opóźnienie przekaźników dla innych układów (0,3 s na skok, ≤ 2 s)**, układ strony od razu | tylko czas odpowiedzi workera (1–2 klatki — wskaźnik prawie niewidoczny) |
| D15 | Tolerancja modelu w bramce E20 | **zapełnienie par ≤ 4 pkt i ≥ 88% w 10 pkt, cena skupu ≤ 5%, najlepszy kupiec ≥ 80%** (3 ziarna, godziny 1–4) | luźniejsza (6 pkt, 8%, 70%) |
| D16 | Gdzie pełny zapis | **Electron: pliki gzip w `Dokumenty\HULLFALL\zapisy`; przeglądarka: IndexedDB**; stan modelu w localStorage | wszystko w IndexedDB (także w Electron) |
| D17 | Rozgrzewka przy nowej grze | **60 min modelu na rynek (~5 ms) + 10 min świata** (~1,5–2 s zamiast 6–10 s), jeśli bramka E20 przejdzie | zostawić 60 min pełnego świata |
| D18 | Pełny zapis po długiej nieobecności | **powyżej 2 h — tylko rozstawienie statków po portach** (kursy z zapisu pominięte, ładunek w modelu) | zawsze pełne odtworzenie kursów |

Do tego jedno zgłoszenie spoza zakresu: pełna symulacja Układu Słonecznego po ~6–8 h traci połowę kursów i zapasu stali (§ 2.3, § 11). Propozycja: osobna sesja, która przedłuży bramkę bilansu do 8–10 h i znajdzie przyczynę (flota przewoźników, kapitał firm, wyczerpanie pól?).

### 10.3 Kroki wdrożenia

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
  - `tests/systemMarkets.test.mjs`: determinizm bit w bit, id lokalne i unikalne, kolejność, wersja, pokrycie ≥ 95% dla towarów z producentem, import ≤ 30%, każdy układ rdzenia ma byt lokalnie albo w dowozie stałym, każdy rynek z wydobyciem w danych wydobywa w pierwszym cyklu;
  - `tests/starSystems.test.mjs` bez zmian;
  - suity ruchu w `npm test` (`trafficWorld`, `stationEconomy` § 12 — migawka Słońca bez zmian).
- Bramki:
  - Słońce liczba w liczbę;
  - **bramka na 3 układach z ziarna 1** (Alfa Centauri, Tau Ceti, Gwiazda Barnarda): `node scripts/bramka-bilansu.mjs --uklad <id>` (nowa opcja; świat z `systemRegistryEntry`). Progi jak § 5 planu, przy czym głód nie obejmuje towarów z dowozu stałego, a tick ma być ≤ 10 ms (prototyp: przewóz 0,20–0,52 Słońca);
  - start gry w układzie proceduralnym: 0 pipeline'ów synchronicznych (porty E14, bańka).

**E20 — model w tle na rynek i zapis na układ** (zależy od E18; do chwili wpięcia równolegle z E19, wspólny plik tylko `economySave.js`):
- Pliki:
  - nowy `src/game/traffic/marketModel.js` — `createMarketModel(def | world)`, `stepMarketModel`, `marketQuote(model, rynek, towar, out)` (cena i ilość jak `resourcePrice` / `portOfferFromQuote`), `modelFromWorld(world)` (wyjście, § 3.4), `applyModelToWorld(world, model)` (wejście, § 3.2), plan z mapy przemysłu;
  - `economySave.js` (v3: `systemId`, `systemMarketsVersion`, statki, kursy, zlecenia trwające, wraki, firmy, kupcy, pochylnie; migracja v2 → `sol`);
  - nowy `src/game/traffic/fleetSave.js` (zwarty zapis statków i kursów, rozliczenie nieobecności § 3.3);
  - `trafficCore.js` (modele układów w workerze, krok co minutę świata w kawałkach, wiadomości `sector-economy-*`, gzip w workerze);
  - `electron/main.js` + `preload.js` (kanały IPC zapisu i odczytu plików ekonomii), IndexedDB w przeglądarce;
  - `index.html` (`sector-economy`, LRU 3 pełnych zapisów, „Nowa gra”, `?reset=economy`);
  - narzędzie `scripts/model-rynkow-kalibracja.mjs` (z `.tmp/e18/rynki-kalibracja.mjs` + próbkowanie z `pelna2.mjs`).
- Testy:
  - `scripts/tests/economySave.test.mjs` (v3, migracja, statki: zapis → odczyt → te same id i porty);
  - nowy `tests/marketModel.test.mjs` (bez alokacji w kroku — `untilSteady`; zachowanie masy z rurą; nadrobienie 10 h bez NaN; zgodność ceny z `resourcePrice` na tym samym zapasie);
  - nowy `tests/fleetSave.test.mjs` (kurs skończony pod nieobecność nie dostarcza drugi raz; trwający wraca z ładunkiem zdjętym z rury);
  - `tests/graczNaRynku.test.mjs` (stała wersji).
- Bramki:
  - Słońce liczba w liczbę bez wyjścia z układu;
  - kalibracja w progach D15 na ziarnach 7, 11, 23;
  - wejście: ≥ 90% kursów prawdziwego biegu po 10 min rozgrzewki (pomiar F / MR3), dla MR0 ≤ 140%;
  - `scripts/webgpu/rynek-gra.mjs`: zapis → F5 → wczytanie bez zmian; wyjście → powrót → te same statki w portach;
  - Electron: zapis pliku przy wyjściu i odczyt przy wejściu (paczka, `electron/`).

**E21 — handel między układami** (zależy od E19, E20 i wpięcia strefy w grę, `PLAN-mapa-gwiezdna.md` „Wpięcie w grę”):
- Pliki:
  - `src/game/sector/sectorFleets.js` (pole `cargo`, napad przenosi ładunek, przewijanie D10 — przez sesję mapy gwiezdnej albo za jej zgodą);
  - nowy `src/game/sector/sectorTrade.js` (wybór celu i ładunku z modelu, rozliczenie przybycia; czysty moduł);
  - rynek graniczny z eksportem i importem (`declareDemand`, `stockDelta`) zamiast dowozu stałego;
  - kurs `convoy` w `courseRegistry.js`, `trafficDirector.js` i w bańce (`workerBubble.js`, kadłuby z `fleetComposition`).
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

**E22 — komputer handlowy: kto ile płaci** (§ 9.7):
- **E22a** (jeden układ, od razu): pliki `src/game/trafficBridge.js` (`findTradePartners`), `src/ui/cockpitUI.js` (karta „Ładownia”), terminal w `index.html` (karta „Handel”), `src/ui/cicTradeLayer.js` (panel „Kupcy towaru”), zapis gracza (średnia cena zakupu). Testy: zgodność z ofertą terminalu, sortowanie i filtry. Gra: `rynek-gra.mjs`.
- **E22b** (wiele układów, po E20): wiadomość `trade-buyers` w `trafficCore.js` / `trafficProtocol.js`, wiedza gracza (D13) w zapisie gracza, opóźnienie przekaźników (D14), droga z `lanePath`. Testy: łączenie źródeł, świeżość, czas odpowiedzi.

## 11. Ryzyka

- **Długa gra w Układzie Słonecznym.** Pełna symulacja po ~6–8 h traci połowę kursów (1559 → 791) i zapasu stali (24 → 12%), a bramka mierzy 4 h. Model w tle tego nie oddaje, a start świata z modelu może ten spadek maskować albo przyspieszać. To pierwsza rzecz do zbadania przed E20.
- **Import.** Prototyp generatora daje udział importu z medianą 49%. Bez przycięcia (D8) rynek graniczny staje się najruchliwszym portem, a układ — zależny od konwojów, których przed E21 nie ma. Dowóz stały w E19 to proteza.
- **Sprzężenie z tabelami Słońca** (§ 1.8): 11 miejsc w ruchu v2 czyta tabele Słońca po id. Każde musi dostać dane z parametru z domyślną tabelą Słońca. Pominięte miejsce w układzie proceduralnym nie rzuci błędu, tylko po cichu zostawi rynek bez wydobycia albo przemysłu.
- **Model a pola wydobywcze.** Model na rynek liczy wydobycie planet, ale nie wyprawy górnicze w pola: urobek z pól (w Słońcu w 4 h: 12,4 tys. jedn. rudy uranu z Kuipera, 4,4 tys. krzemu i 1,6 tys. miedzi z pasa) jest w nim tylko przez przewóz z planu. Przy układach, których przemysł zależy od pól (Tau Ceti, Syriusz), błąd będzie większy niż na Słońcu. E20 dokłada pola jako źródło na rynku-odbiorcy wyprawy i kalibruje też na układzie z bramki E19.
- **Wejście z modelu w układzie nieodwiedzonym** daje o ~20–35% więcej kursów niż prawdziwy bieg (MR0). Bramka E20 sprawdzi to na 3 ziarnach i na układach proceduralnych.
- **Pełny zapis ze statkami** to nowa rzecz: dziś po F5 statki startują od nowa. Odtworzenie kursów (etapy, stanowiska, bańka, awansowani NPC) może trafić w wiele miejsc ruchu v2. D18 (po 2 h — tylko rozstawienie po portach) ogranicza ryzyko.
- **Konwoje i pieniądze.** Zysk ~0,67 mln CR na kurs przy 25 zawinięciach na godzinę. Kredyty konwojów nie mogą trafić do frakcji ani firm (§ 5.2).
- **Pamięć i pliki.** localStorage w Electron niezmierzony (pomiar z przeglądarki aplikacji, 52 mln znaków, nie przenosi się na paczkę). Pełny zapis w plikach wymaga IPC i obsługi błędów zapisu (dysk pełny, przerwany zapis — plik tymczasowy i `rename`).
- **Nie zrobione w E18:** generator nie był sprawdzony pełną symulacją ruchu (świat ruchu z rynków układu wymaga zmian z § 1.8, czyli E19). Przewóz i tick układów proceduralnych to szacunek z planu, a nie pomiar. Zwarty format zapisu statków (~0,1 MB gzip) to szacunek, zmierzony jest płytki JSON. Cena z głodem w modelu na rynek nie była porównana na poziomie stacji (migawka stacji nie niesie głodu).
