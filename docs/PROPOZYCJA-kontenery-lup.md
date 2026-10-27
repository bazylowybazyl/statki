# PROPOZYCJA: kontenery-łup (2026-10-27)

> Etap 1 sesji „kontenery-łup”: rozpoznanie i propozycja, bez zmian w grze. Zniszczony frachtowiec gubi część
> ładunku jako kontenery dryfujące w przestrzeni, a gracz może je zebrać. Ten dokument opisuje stan dziś
> (fakty z plik:linia), gotowe klocki, propozycję, plan etapów i decyzje „na strzała”. Budowa (etap 2) rusza
> po decyzjach.

## 1. Stan dziś: co się dzieje z ładunkiem zniszczonego frachtowca

**Krótko: nic nie wyrzuca kontenerów do przestrzeni.** Ładunek zniszczonego frachtowca zostaje w rekordzie
zlecenia w świecie ruchu jako „wrak” i nikt go stamtąd nie zabiera, ani gra, ani złomiarze. Piraci też nie,
jeśli zestrzelił go gracz.

### 1.1 Encja bańki zniszczona bez awansu (jeden strzał, hipercruise, holownik, pełny limit awansów)

- `damageTrafficActor` → `destroyTrafficActor` (`src/game/trafficBubble.js:317`, `:330`): encja znika z listy,
  gra wysyła `destroyCourse(a.id, { x, y, reason, byPirates: false })` (`:340`), hak `onDestroyed` (`:342`).
- Hak gry robi tylko wybuch: `onTrafficActorDestroyed` → `triggerReactorBlow3D` (`index.html:16322`). W grze nie ma
  wraku ani ładunku (potwierdza `docs/E6-banka-w-grze.md:102`).
- Reputacja nie spada: `registerFactionKill` (`index.html:19834`) woła tylko śmierć NPC (`applyDamageToNPC`), a ta
  ścieżka go omija. To luka niezależna od kontenerów, § 6.

### 1.2 Awansowany NPC (trafiony frachtowiec, `src/game/trafficPromotion.js`)

- NPC powstaje z encji (`spawnTrafficNpc`, `index.html:16551`) bez żadnego pola ładunku; `trafficPromotion.js`
  ładunku nie zna.
- Śmierć: zwykła ścieżka NPC — wybuch ze zbiornika (`fuelTankBlast`, `index.html:23918`) i wrak z kadłuba
  (`createWreckage`, `:23923`). Werdykt `dead` → `trafficV2.destroyCourse(id, { reason: 'player', byPirates: false })`
  (`index.html:16716`).
- Wrak gry ma tylko złom kadłuba (`ensureSalvageManifest`, `src/game/salvage.js:186`). Ładunku kursu w nim nie ma
  (`docs/E6-banka-w-grze.md:195`, „Ładunek i łup”).

### 1.3 Świat ruchu (worker)

- `destroyed` → `destroyCourse` → `strikeCourse` (`src/game/traffic/trafficCore.js:545`,
  `src/game/traffic/trafficDirector.js:1691`, `:1623`).
- Księga: `wreckShipmentOrder(order, 'wreck:<kurs>', null, …)` (`trafficDirector.js:1651`). Bez inwentarza wraku
  partia zostaje w rekordzie zlecenia: `status: wreck`, `owner: wreck`, `cargoLocation: 'record'`
  (`src/game/traffic/shipmentOrders.js:461–499`). Z tego stanu nic jej nie wyprowadza.
- Statusy na odzysk już są, ale nieużywane: `SHIPMENT_STATUS.RECOVERED` (`shipmentOrders.js:52–58`), właściciel
  `SHIPMENT_OWNER_KIND.PLAYER` (`:61–66`), walidacja `recovered` / `playerInventory` (`:587–596`). Brakuje tylko
  przejścia `wreck → recovered`.
- Hak `director.onWreck` domyślnie `null` (`trafficDirector.js:207`) i nikt go nie ustawia.
- Łup do kryjówki piratów (`depositLoot`, 55% — `lootRecovery`, `src/game/traffic/piracy.js:41`, `:174`) idzie tylko
  przy `byPirates` (`trafficDirector.js:1658`). Gracz wysyła `false`.
- Wrak trafia do `director.wrecks` (`trafficDirector.js:1668`) i do gry jako `tick.wrecks` (`collectWrecks`,
  `trafficCore.js:993`): kurs, x, y, kadłub, frakcja, wartość, `resourceId`, `units`, zlecenie.
- **Gra tego nie odbiera.** Most trzyma ogon `recentWrecks` i emituje `'wrecks'` (`src/game/trafficBridge.js:526–531`),
  ale `index.html` słucha tylko `error`, `warmup`, `market` (`:15948–15954`) i `belt-holes` (`:27673`).
- `tick` przychodzi tylko po pełnym kroku świata (`trafficCore.js:277–283`), a krok trwa 5 s
  (`TRAFFIC_STEP_SECONDS`, `src/game/traffic/trafficWorld.js:53`). Rekord wraku dociera więc do gry nawet 5 s po
  wybuchu. Na zrzut kontenerów w chwili śmierci to za późno (§ 3.1).
- Wyprawy górnicze niosą urobek w worku `payload.harvest`, bez `units` (`trafficDirector.js:1454–1468`). Rekord wraku
  ma wtedy `units` 0, a ładunek ginie z widoku.

### 1.4 Wraki gry i złom (`src/game/salvage.js`)

- Manifest łupu przewiduje ładunek: `_extraSalvage` dokładany do materiałów (`salvage.js:172–178`), a `_cargoManifest`
  czytają `hasSalvage` / `describeSalvage` (`:286–323`), zimne wraki (`src/game/coldWrecks.js:95`) i blokady
  despawnu (`index.html:26082`, `:27333`).
- **Obu pól nic nie zapisuje** (poza testami: `tests/coldWrecks*.test.mjs`). `hullBodies.js:3391`, `:3487` dają `null`.
  To martwa ścieżka. `docs/SPEC-ekonomia-i-logistyka.md:19`, `:117` opisuje ją jako działającą, a to nieaktualne.
- Gracz odzyskuje złom na dwa sposoby. Cięcie w polu: `takeFieldCut` → `addToPlayerCargo` (`index.html:15542`,
  `:15409`). Hol do doku: `deliverWreckToDock` → `adjustStationStock` do magazynu stacji, broń do inwentarza
  (`index.html:15666`).

### 1.5 Złomiarze, megafrachtowiec, ładunek w bańce

- Złomiarze ruchu biorą wyłącznie wraki wojny `war.wrecks` (`src/game/traffic/scrapperFleets.js:141`), nie wraki
  kursów z ładunkiem.
- Pociąg megafrachtowca (`src/game/megafreighterTrain.js`) to sama kinematyka wagonów, bez ładunku. Megafrachtowiec
  ruchu jest jednym sprite'em i awansuje jak każdy frachtowiec.
- `writeBubbleCargo` (`src/game/traffic/bubbleCargo.js:44`) podaje ładunek tylko encji na postoju LOAD / UNLOAD,
  na potrzeby obrazu E12. Encja w locie nie mówi grze, co wiezie.

## 2. Co jest gotowe

| Klocek | Gdzie | Do czego się przyda |
|---|---|---|
| Rodziny kontenerów: zbiornik / zsyp / standard + hazmat | `src/data/cargoContainers.js:55` (`containerFamilyOf`), `:64` (`isHazmatCargo`), `:104` (`containerLook` — farba, akcent, rama z ziarna i numeru) | Wygląd łupu 1:1 jak w E12: towar wyznacza rodzinę i barwę. |
| Kontener 16 × 8 × 8 j. | `src/data/cargoBays.js:43` (`CARGO_CONTAINER`), tony na kontener `:46–48` (2 t — wariant dema, „do decyzji”) | Bryła i skala łupu. |
| Materiał kontenerów TSL | `src/3d/cargo/containers.tsl.js` (instancje 20 × f32, `CargoContainers`) | Wzór i światło. Dziś kontener ma tylko kurs (yaw) i nie ma dna, bo stoi w ładowni. Łup potrzebuje wariantu: pełna bryła i obrót 3D. |
| Ładownie floty i rój E12 | `src/3d/cargo/portCargo3D.js`, `src/render/blocks/cargoOpsBlock.js`, `TRAFFIC_CARGO_BAY_HULLS` (`cargoBays.js:237`) | Miejsce ładowni na kadłubie: kontenery wylatują z luku, nie ze środka. |
| Maska pokładu nad wyrwą | `cargoDeckMask` (`src/game/cargoPortOps.js:1036`, `HullBodies.probe`) | Etap „wyrwa w ładowni”: które sloty leżą nad zniszczonymi komórkami. |
| Mocowania na komórkach kadłuba | `createHullMountSet` / `bindHullMount` (`src/game/hullMounts.js:93`, `:71`) | To samo, w wersji na żywym statku. |
| Wiązka ściągająca kopalni | `src/game/asteroidMiningRig.js:57–61` (zasięg 3600 j., chwyt 260 j., udźwig 450 t, 12 celów), `_stepTractor` `:558`, `asteroidMining.js:2505` (`tractor()`, limit `maxOre` = wolne miejsce) | Gotowy wzór zbierania: przyciąganie, chwyt przy statku, limit ładowni, lista najbliższych celów bez alokacji. |
| Ładownia gracza | `PLAYER.cargo` (`index.html:14195`), `addToPlayerCargo` (`:15409`, przyjmuje do udźwigu), `getPlayerCargoFree` (`:14712`) | Łup trafia tu jak urobek i złom z cięcia. |
| Sprzedaż jedną ekonomią | `handleTrade` (`index.html:15327`: `getTradeOffer`, `adjustStationStock`, port skupuje do `offer.buy`) | Łup sprzedaje się w terminalu bez nowego kodu. |
| Luk Atlasa pokazuje ładunek | `playerCargoRecord` (`index.html:16756`; wypełnienie = masa / `cargoCap`) | Zebrane kontenery widać w luku przy terminalu. |
| Hol i holownik | `startWreckTow` (`index.html:15556`), `TowSystem`, holownik serwisowy (reguła `holownik`) | Hol jest do wraków. Na kontenery to zbyt ciężki mechanizm (§ 3.4). |
| Fregata zwiadu | `src/game/scoutBay.js` (luk Atlasa, stery gracza, maskowanie I, oko 3) | Wariant „cichego zbieracza” na później. |
| Drony naprawcze | `src/game/repairRig.js` (lot w układzie celu, dok na grzbiecie) | Wzór lotu dronów ładunkowych na później. |
| Mgła wojny | `SensorSystem.hides` / `pointVisible(x, y)` (`src/game/sensorSystem.js:114`, `:118`) | Kontener poza czujnikami jest niewidoczny i nie da się go namierzyć. |
| Reputacja | `REPUTATION_EVENTS` (`src/data/factions.js:262`), `registerFactionKill` (`index.html:19834`) | Kara za zestrzelenie już jest dla NPC. |

**Skala — główny problem do decyzji.** Atlas ma w ekonomii `cargoCap` 20 t (`BASE_PLAYER_PROFILE`,
`index.html:14153`), a jego luk fizycznie mieści 1200 kontenerów, czyli 2400 t przy 2 t na kontener (pomiar
`cargoCapacityTable`, 2026-10-27; komentarz `AGENT:` w `cargoBays.js:115` przewiduje ładowność z geometrii).
Frachtowce wożą `VAN_CLASSES` (`shipmentOrders.js:30`): van 60, hauler 160, bulk 380, heavy 900, mega 2400 t
(jednostki świata, te same co w terminalu i w `PLAYER.cargo`). Przy 20 t gracz zabierze z wraku dalekiego
frachtowca najwyżej jedną paczkę. Łup byłby symboliczny, a dzisiejsze 20 t w luku wygląda jak 1200 kontenerów.

| Klasa | Pełny ładunek [t] | Przetrwa 55% [t] | Paczek | t / paczkę |
|---|---|---|---|---|
| van (prom) | 60 | 33 | 2 | 16,5 |
| hauler (kontenerowiec) | 160 | 88 | 4 | 22 |
| bulk (daleki frachtowiec) | 380 | 209 | 6 | ~35 |
| heavy (ciężki frachtowiec) | 900 | 495 | 10 | ~50 |
| mega (megafrachtowiec) | 2400 | 1320 | 16 | ~83 |

## 3. Propozycja

### 3.1 Skąd się biorą kontenery

- **Gra zna ładunek encji, zanim ta zginie: manifest encji z workera.** Rekord wraku przychodzi do 5 s za późno
  (§ 1.3), a bufor aktorów ma ładunek tylko na postoju. Proponuję boczną listę w wiadomości `actors`, jak `docks`
  / `undocked`: `cargo: [{ id, res, units, mass }]` przy materializacji encji i przy zmianie ładunku, wysyłaną
  tylko jako zmiany. `ACTOR_STRIDE` (20) zostaje bez zmian. Urobek górnika (`harvest`) wchodzi jako największe pozycje
  worka (najwyżej 3). Promy z ludźmi (`passengers`), puste przeloty (`deadhead`), okręty, zapas floty i postój
  manifestu nie mają.
  - Przy okazji HUD celu może pokazać, co wiezie frachtowiec („stal 380 t”). Gracz-pirat wybiera ofiarę, a nie
    strzela w ciemno.
- **Kiedy (MVP): przy zniszczeniu.** Są dwie ścieżki i jedna wspólna funkcja `spillCargoAt(…)`:
  1. encja bez awansu — w `onTrafficActorDestroyed` (poza i ruch encji z chwili śmierci);
  2. awansowany NPC — przy werdykcie `dead` (poza NPC, ruch wraku). Miejsce wybuchu zbiornika (`tankBlast`) daje
     kierunek rozrzutu.
- **Ile:** 55% masy partii przetrwa (ta sama liczba co łup piratów, `PIRACY_MODEL.lootRecovery`, więc jedna stała
  dla gracza i AI), reszta spłonęła. Paczek tyle, ile w tabeli § 2 (2 / 4 / 6 / 10 / 16 na klasę), po równo masy;
  ostatnia zabiera resztę zaokrągleń. Podział jest deterministyczny z numeru kursu (`cargoHash01(kurs, i)`), bez
  `Math.random`.
- **Przy rozpadzie i wyrwie w ładowni (etap 3, osobno):** wrak awansowanego frachtowca traci sloty ładowni nad
  martwymi komórkami (`cargoDeckMask` / mocowania na komórkach). Wtedy paczki wypadają, zanim statek zginie. To
  zmienia ładunek ŻYWEGO kursu, więc potrzebna jest wiadomość `cargo-spill { course, units }` i przejście księgi
  „część partii → wrak”. Odkładam to, żeby MVP nie ruszał symulacji.
- **Zniszczenie przez piratów w rekordach** (przechwyt bez gracza) dalej oddaje łup do kryjówki. Kontenery
  powstają tylko tam, gdzie gra widzi wybuch (bańka).

### 3.2 Jak lecą

- **Start:** losowy slot ładowni kadłuba (`TRAFFIC_CARGO_BAY_HULLS` → geometria luku w układzie statku), żeby
  kontenery wylatywały z luku, nie ze środka. Kadłub bez ładowni: środek obrysu ± 30% długości.
- **Prędkość:** 100% prędkości wraku (dziedziczenie, jak pociski i odłamy), plus pęd od środka wybuchu 40–140 j./s,
  plus mały rozrzut boczny. Obrót: spin 0,2–1,2 rad/s wokół losowej osi (obraz). W rozgrywce liczy się tylko
  kąt w płaszczyźnie.
- **Ruch:** prosty dryf w 2D bez tarcia, z lekkim tłumieniem do 15 j./s po 20 s. Bez kolizji z kadłubami
  i pociskami (duchy, § 5, D11) — kontener ma 16 j., a kadłuby 300–2760 j.
- **Czas życia:** 5 min czasu gry. W ostatnich 10 s kontener gaśnie (lampka mruga szybciej) i znika: ładunek
  przepada, w księdze zostaje jako wrak. Znika też dalej niż 50 km od gracza (`WRECK_DESPAWN_DIST`).
- **Pula:** 256 kontenerów naraz (tablice typowane, x / y jako `Float64Array` — świat 5–10 mln j.). Pełna pula →
  nowa paczka dokleja się do najbliższego kontenera tego samego towaru. Najstarszych nie kasujemy, bo gracz
  właśnie do nich leci.

### 3.3 Jak wyglądają

- Te same kontenery co w E12: rodzina, farba i akcent z `containerLook(towar, kurs, numer)`, hazmat w żółte pasy.
  Paczka ma moduł kontenerów wg masy: do 16 t — 1 kontener, do 64 t — 2 × 2, wyżej — 2 × 2 × 2, spięte ramą.
- **Materiał:** wariant „luzem” na grafie `containers.tsl.js` — pełna bryła z dnem, obrót z kwaternionu instancji,
  światło słońca w płaszczyźnie gry (`sunVisibility` / `sunFill`). Bez cienia ładowni. Graf powstaje raz na
  wariant (zasada żelazna 4), jeden rysunek na wszystkie kontenery.
- **Lampka-boja:** mały emiter HDR (> 1, łapie bloom) mrugający co 1,5 s, żeby kontener było widać z daleka.
  Wyłącza się mgłą wojny.
- **Radar:** rekord `radarFeed.collect` (rodzaj „kontener”, punkt bez wektora) w zasięgu czujników. Na CIC nie.

### 3.4 Jak się je zbiera — warianty

| Wariant | Jak działa | Plusy | Minusy | Koszt | Ocena |
|---|---|---|---|---|---|
| **A. Przelot nad kontenerem** | kontener w promieniu chwytu przy luku Atlasa (~300 j.) i prędkość względna < 300 j./s → do ładowni | najprostszy, czytelny, zero nowych klawiszy | Atlas (1800 j.) musi trafić w 16-j. kontener; gonienie dryfujących męczy | mały | dobry jako koniec innych wariantów |
| **B. Wiązka ściągająca** (wzór kopalni) | kontenery w 3,6 km przyciągane do luku, chwyt jak w A; najwyżej 12 naraz; nie łapie, czego ładownia nie zmieści | gotowy wzór (`_stepTractor`), satysfakcjonujący obraz, działa w walce | kolizja klawisza T (`tgt.paint` / `tgt.priority`, `src/input/inputActions.js:167`) | mały–średni | **rekomendacja**: włączona sama, gdy kontener jest w zasięgu, gracz leci < 400 j./s i ładownia ma miejsce; bez klawisza |
| **C. Drony ładunkowe z luku Atlasa** | drony E12 (klasa L) wylatują, chwytają paczkę, wracają do otwartego luku | najładniejsze, spójne z portami E12 | nowy lot dronów w układzie nosiciela (wzór `repairRig`), obraz roju poza portem, otwarty luk w walce | duży | etap 4 jako ulepszenie B |
| **D. Holownik / hol** | lina do kontenera i do doku (jak wrak) | jest `TowSystem` | hol do wraków setek ton; na 16-j. kontener to ceremonia; holownik serwisowy to okręt wsparcia, nie zbieracz | średni | **nie**. Hol zostaje do kadłuba wraku |
| **E. Fregata zwiadu** | gracz prowadzi fregatę, przelot (A) jej małą ładownią (6 kontenerów), rozładunek po lądowaniu w luku | zbieranie pod maskowaniem (I), w mgle, z dala od Atlasa | mała ładownia, druga ładownia w logice, przełączanie sterów | średni | etap 4 (dobre dla pirata: „cichy zbieracz”) |

**Rekomendacja MVP:** B + A. Wiązka działa sama (nic do wciskania). Kontener dociągnięty do luku wchodzi
w chwycie. Paczka większa niż wolne miejsce oddaje tyle, ile wejdzie, a reszta dalej dryfuje z mniejszą masą
(jak `maxOre` w kopalni). Luk Atlasa otwiera się, gdy wiązka coś ciągnie (`_playerCargoDoor`), więc paczkę
widać, jak wjeżdża.

### 3.5 Gdzie ląduje łup

- **Ładownia gracza:** `addToPlayerCargo({ [towar]: sztuki })`, w jednostkach świata, jak cięcie wraku.
  Komunikat HUD `+ stal 35 t` (`pushZoneMessage`, z ogranicznikiem jak przy cięciu).
- **Sprzedaż:** terminal „Handel” bez zmian. Port skupuje do swojego celu (`offer.buy`) i płaci `bid`, reszta zostaje
  w ładowni. Towar wraca do gospodarki przez `adjustStationStock`, czyli jedną drogą.
- **Księga (worker):** opcjonalna wiadomość `cargo-recovered { course, resourceId, units }` → nowa
  `recoverShipmentOrder(order, 'player', units)` (część partii: `wreck → recovered`, właściciel PLAYER,
  `playerInventory`), statystyka `director.stats.recoveredByPlayer`. Symulacja się nie zmienia: towar opuścił
  gospodarkę przy załadunku i wraca dopiero sprzedażą. Bez wiadomości nic się nie dubluje, bo wrak kursu nie idzie
  do kryjówki (`byPirates: false`), a złomiarze go nie biorą.
- **Zapis:** bez zmian. `PLAYER.cargo` nie ma dziś zapisu (`index.html:14224`: „jak ładownia: bez zapisu
  w localStorage”), kontenery w przestrzeni nie przeżywają F5 (jak wraki), a kursy i zlecenia startują od nowa
  po wczytaniu ekonomii (reguła `ruch-v2`, „Zapis ekonomii”). `economySave.js` bez zmian.

### 3.6 Wpływ na ekonomię i piractwo

- **Gracz jako pirat już działa po stronie świata:** zestrzelony kurs to strata przewoźnika
  (`closeCourseResources … lost`), wpis `recordLaneLoss`, więc frakcja wzmacnia patrol na tym szlaku. Kontenery
  dodają tylko łup, który wcześniej przepadał.
- **Kradzież od frakcji:** kara jest przy zestrzeleniu (`killedShip` −6, kapitał −14). Do naprawy: encja zniszczona
  bez awansu reputacji dziś nie rusza (§ 1.1). Proponuję wołać to samo co `registerFactionKill` w
  `onTrafficActorDestroyed`. Znakowania „gorącego towaru” (paser w kryjówkach, kara za sprzedaż łupu właścicielowi)
  w MVP nie ma — decyzja D6.
- **Mgła wojny:** kontener ukryty poza czujnikami (`SensorSystem.pointVisible`). Wiązka łapie tylko widoczne
  kontenery. Radar i lampka gasną w mgle.
- **Piraci AI:** w MVP nie zbierają. W etapie 4 awansowany pirat albo rajder w bańce może podlatywać do
  kontenerów w 5 km (konkurencja o łup, „kradną sprzed nosa”). Przechwyty w rekordach dalej dają 55% do kryjówki.
- **Bramka bilansu:** bez zmian. W symulacji nie ma gracza, a `cargo-recovered` to tylko statystyka. Weryfikacja:
  `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` przed i po, wynik identyczny.

### 3.7 Wydajność i szew renderu (`AGENTS.md`)

- **Logika** `src/game/lootContainers.js` (czysta, bez three i DOM): pula SoA (`Float64Array` x / y,
  `Float32Array` vx / vy / kąt / spin / masa / sztuki / wiek, `Int16Array` towar, `Int32Array` kurs i ziarno, flagi).
  Krok w `physicsStep` po bańce: dryf, wiek, wiązka (najbliższe 12 bez alokacji, jak `_considerTractor`),
  chwyt. Koszt O(n), n ≤ 256. Zbiórka i zrzut to zdarzenia, a nie pętle gorące. Stałe „na sekundę”, bez
  `stepDecay120`.
- **Render:** nowy blok migawki `loot` (`src/render/blocks/lootBlock.js`, faza begin, HEAD + 256 × ~10 f64 ≈ 20 KB):
  poza z interpolacją renderu, kwaternion obrotu liczony po stronie renderu z ziarna i wieku (gra nie liczy obrotu
  3D), kod wyglądu, siła wiązki, zanik. Moduł `src/3d/cargo/lootContainers3D.js` w workerze renderu (tryb `off` —
  ta sama ramka na stronie). Rozgrzewka `Core3D.warmup.add({ name: 'kontenery-łup', phase: 'after' })`. Promień wiązki
  w tym samym bloku, tym samym wzorem co wiązka kopalni (do sprawdzenia, czy `miningView` da się użyć bez kopalni).
- **Zdarzenia** (błysk przy chwycie) jako rekord strumienia rozkazów, nie wywołanie modułu renderu.
- Szew gra ↔ render nie rośnie: moduł renderu czyta tylko blok. Strażnik `tests/szewRenderu.test.mjs`.

### 3.8 Testy

- `tests/lootContainers.test.mjs`: podział partii (suma ≤ 55% masy, determinizm z kursu, ostatnia paczka bierze
  resztę), dryf i tłumienie, czas życia, pełna pula (doklejanie tego samego towaru), wiązka (zasięg, 12 celów,
  bez celów niewidocznych w mgle), chwyt częściowy przy pełnej ładowni (reszta dryfuje), zero alokacji w kroku
  (licznik obiektów w pętli 10 tys. kroków).
- Manifest encji w protokole (`tests/workerBubble.test.mjs`): lista tylko zmian, urobek górnika z worka, promy bez
  manifestu.
- Księga: `recoverShipmentOrder` (część, całość, podwójny odzysk odrzucony, `validateShipmentOrder` czysty)
  w `scripts/tests/shipmentOrders.test.mjs`. Symulacja ruchu liczba w liczbę bez zmian.
- Blok `loot`: koduj / dekoduj, WGSL wariantu „luzem” buduje się w Node, wpis w rozgrzewce, strażniki
  `graBezGlsl` i `szewRenderu`.
- Gra: `scripts/webgpu/kontenery-gra.mjs` (harness CDP, `__harness.step`): bańka przy Ziemi → ostrzał frachtowca
  z ładunkiem → awans → śmierć → N kontenerów → podlot → wiązka → `PLAYER.cargo` rośnie → terminal sprzedaje.
  Do tego encja bez awansu (jeden strzał), zrzuty w `off` i `renderWorker=1`, 0 pipeline'ów synchronicznych.

## 4. Plan etapów

| Etap | Zakres | Pliki | Zależności |
|---|---|---|---|
| **K1 — logika i łup (MVP)** | manifest encji z workera; `lootContainers.js` (pula, zrzut, dryf, czas życia, wiązka, chwyt); klej w bloku „BAŃKA RUCHU v2 W GRZE” (obie ścieżki śmierci); `addToPlayerCargo` i komunikaty; reputacja przy zniszczeniu bez awansu; podgląd na kanwie 2D (kółko z kolorem rodziny) do czasu K2; testy jednostkowe | `src/game/lootContainers.js` (nowy), `src/game/traffic/workerBubble.js`, `trafficProtocol.js`, `src/game/trafficBubble.js`, `index.html` | decyzje D1–D5, D10 |
| **K2 — obraz** | blok `loot`, wariant „luzem” materiału kontenerów, `lootContainers3D.js`, rozgrzewka, lampka HDR, promień wiązki, otwieranie luku Atlasa przy wiązce, radar, mgła; harness `kontenery-gra.mjs` | `src/render/blocks/lootBlock.js`, `src/3d/cargo/containers.tsl.js` (wariant), `src/3d/cargo/lootContainers3D.js`, `src/ui/radar/radarFeed.js` | K1, D8 |
| **K3 — księga i wyrwa w ładowni** | `cargo-recovered` → `recoverShipmentOrder` (statystyka); wysyp z luku przy wyrwie w ładowni awansowanego frachtowca (`cargoDeckMask`, `cargo-spill`, przejście części partii do wraku); bramka bilansu na 3 ziarnach | `shipmentOrders.js`, `trafficDirector.js`, `trafficCore.js`, `index.html` | K1, D9 |
| **K4 — ulepszenia (osobne decyzje)** | drony ładunkowe z luku Atlasa; fregata zwiadu jako zbieracz; piraci AI zbierający kontenery; gorący towar i paser; zestrzeliwanie kontenerów (hazmat i amunicja wybuchają) | — | K2 |

## 5. Decyzje „na strzała”

Pytanie, a po strzałce rekomendacja domyślna.

1. **D1. Ładowność Atlasa.** Zostaje 20 t (łup symboliczny), ładowność z geometrii luku (1200 kontenerów × 2 t,
   bez pola myśliwców i stanowiska fregaty ≈ 1,8–2,0 tys. t, pomiar `scripts/hangary-pomiar.mjs`) albo coś
   pośrodku (np. 400 t, klasa bulk)? → **Z geometrii luku.** Luk już pokazuje ładunek jako kontenery
   (dziś 20 t wygląda jak 1200 kontenerów), a komentarz `AGENT:` w `cargoBays.js` to przewiduje. Uwaga: zmienia też
   handel (gracz wozi jak ciężki frachtowiec, ogranicza go oferta portu i kredyty) i kopalnię (rzadziej „ładownia
   pełna”). Bezpieczniejsza alternatywa to 400 t.
2. **D2. Ile ładunku przetrwa?** → **55% masy** (ta sama stała co łup piratów), reszta spłonęła. Nic nie zostaje
   we wraku kadłuba (martwe `_cargoManifest` sprzątnąć osobno albo wpiąć w K4).
3. **D3. Kiedy wypada?** → **MVP tylko przy zniszczeniu** (obie ścieżki: bez awansu i awansowany NPC). Wysyp przy
   wyrwie w ładowni żywego statku — K3.
4. **D4. Jak zbierać?** → **Wiązka bez klawisza** (sama, gdy kontener w 3,6 km, gracz < 400 j./s, ładownia ma
   miejsce) **+ chwyt przelotem** przy luku. Drony i fregata — K4. Hol nie.
5. **D5. Czas życia i limit?** → **5 min gry, pula 256**, przy przepełnieniu doklejanie do kontenera tego samego
   towaru; znika dalej niż 50 km od gracza.
6. **D6. Gorący towar?** (sprzedaż łupu właścicielowi = kara, paser u piratów) → **Nie w MVP.** Kara jest przy
   zestrzeleniu; znakowanie w K4.
7. **D7. Czy piraci AI zbierają kontenery w bańce?** → **Nie w MVP**, K4.
8. **D8. Widoczność?** → **Radar (punkt w zasięgu czujników) + mrugająca lampka HDR + mgła wojny chowa.** Bez CIC.
9. **D9. Zgłaszać odzysk do księgi?** → **Tak, w K3**, tylko jako statystyka i status `recovered`; symulacja bez zmian.
10. **D10. Manifest encji w bańce** (gra wie, co wiezie frachtowiec, zanim go zestrzeli; HUD celu „stal 380 t”)?
    → **Tak.** Bez niego zrzut w chwili wybuchu jest niemożliwy (rekord wraku przychodzi do 5 s później).
11. **D11. Kolizje kontenerów?** → **Duchy w MVP** (bez zderzeń z kadłubami, bez trafień); zestrzeliwanie w K4.
12. **D12. Zapis?** → **Bez zmian** (ładownia bez zapisu jak dziś, kontenery nie przeżywają F5).
13. **D13. Reputacja przy zniszczeniu encji bez awansu** (dziś zero)? → **Tak, jak `registerFactionKill`**, w K1.

## 6. Zauważone przy okazji (poza zakresem)

- `_extraSalvage` / `_cargoManifest` w `salvage.js` to martwa ścieżka; `docs/SPEC-ekonomia-i-logistyka.md:19`, `:117`
  opisuje ją jako działającą.
- `tick.wrecks` i `recentWrecks` w moście nikt w grze nie czyta (`trafficBridge.js:526`).
- Rekord wraku wyprawy górniczej ma `units` 0, bo urobek jest w `payload.harvest`
  (`trafficCore.js:1010–1011`).
- Zniszczenie encji ruchu bez awansu nie zbija reputacji (§ 1.1, D13).
