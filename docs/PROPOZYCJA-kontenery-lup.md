# PROPOZYCJA: kontenery-łup (2026-10-27)

> Etap 1 sesji „kontenery-łup”: rozpoznanie i propozycja, bez zmian w grze. Zniszczony frachtowiec gubi część
> ładunku jako kontenery dryfujące w przestrzeni, a gracz może je zebrać. Ten dokument opisuje stan dziś
> (fakty z plik:linia), gotowe klocki, propozycję, plan etapów i decyzje „na strzała”. Budowa (etap 2) rusza
> po decyzjach.

## Stan budowy

- **K1 (2026-10-27, gałąź `claude/kontenery-lup-7ab0cf`):** manifest ładunku encji z workera (`actors.manifests`),
  pula paczek z wiązką (`src/game/lootContainers.js`), gniazdo ZBIÓRKA (`src/data/lootGear.js`, WYPOSAŻENIE, zapis),
  zrzut przy obu ścieżkach śmierci, kara reputacji za zestrzelenie bez awansu, podgląd na kanwie 2D, narzędzie
  `scripts/webgpu/kontenery-gra.mjs`. Opis obszaru: reguła `kontenery-lup`. Decyzje orkiestratora: D2, D3, D5–D17
  jak w § 5 (domyślne), D4 i D1 — użytkownik.
- **D1 (osobny commit):** ładowność Atlasa 400 t (`ATLAS_CARGO_CAP`, `src/data/playerHullCatalog.js`) — skutki w § 6.
- **K2 (2026-10-27):** obraz 3D — blok migawki `loot` (worker = off), paczki jako moduły kontenerów E12 wg masy
  w wariancie oświetlenia łupu (`{ loot: true }`), lampka-boja HDR (najmniej 3,5 px), wiązka jako strumień świecących
  punktów, rozgrzewka (faza `'after'`), mgła wojny i soczewka skoku liczone przez grę; ślady „kontener” na radarze
  (`radarFeed.collect`, D8). Dwa rysunki na wszystkie paczki. Podgląd 2D z K1 usunięty. Opis: reguła `kontenery-lup`,
  § „Obraz (K2)”. ZALEGŁE z K2: otwieranie luku Atlasa przy chwycie — luk jest domyślnie zamknięty (decyzja
  użytkownika 2026-10-26: otwiera go tylko terminal), więc otwieranie przy wiązce czeka na jego zgodę.
- Dalej: K3 (drony, D17 — 16 t), K4 (księga, wyrwa w ładowni), K5.

## 1. Stan przed K1: co się działo z ładunkiem zniszczonego frachtowca

**Krótko: nic nie wyrzuca kontenerów do przestrzeni.** Ładunek zniszczonego frachtowca zostaje w rekordzie
zlecenia w świecie ruchu jako „wrak” i nikt go stamtąd nie zabiera, ani gra, ani złomiarze. Piraci też nie,
jeśli zestrzelił go gracz.

### 1.1 Encja bańki zniszczona bez awansu (jeden strzał, hipercruise, holownik, pełny limit awansów)

- `damageTrafficActor` → `destroyTrafficActor` (`src/game/trafficBubble.js:317`, `:330`): encja znika z listy,
  gra wysyła `destroyCourse(a.id, { x, y, reason, byPirates: false })` (`:340`), hak `onDestroyed` (`:342`).
- Hak gry robi tylko wybuch: `onTrafficActorDestroyed` → `triggerReactorBlow3D` (`index.html:16322`). W grze nie ma
  wraku ani ładunku (potwierdza `docs/E6-banka-w-grze.md:102`).
- Reputacja nie spada: `registerFactionKill` (`index.html:19834`) woła tylko śmierć NPC (`applyDamageToNPC`), a ta
  ścieżka go omija. To luka niezależna od kontenerów, § 7 (naprawiona w K1 — D13).

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
- **Przy rozpadzie i wyrwie w ładowni (etap K4, osobno):** wrak awansowanego frachtowca traci sloty ładowni nad
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
| **A. Przelot nad kontenerem** | kontener w promieniu chwytu przy luku Atlasa (~300 j.) i prędkość względna < 300 j./s → do ładowni | najprostszy, czytelny, zero nowych klawiszy | Atlas (1800 j.) musi trafić w 16-j. kontener; gonienie dryfujących męczy | mały | tylko jako koniec pracy wiązki i drona |
| **B. Wiązka ściągająca** (wzór kopalni) | kontenery w 3,6 km przyciągane do luku, chwyt jak w A; najwyżej 12 naraz; nie łapie, czego ładownia nie zmieści | gotowy wzór (`_stepTractor`), satysfakcjonujący obraz, działa w walce | kolizja klawisza T (`tgt.paint` / `tgt.priority`, `src/input/inputActions.js:167`) | mały–średni | **wybrana** (sprzęt do montażu, § 3.5): włączona sama, gdy kontener jest w zasięgu, gracz leci < 400 j./s i ładownia ma miejsce; bez klawisza |
| **C. Drony ładunkowe z luku Atlasa** | drony E12 (klasa L) wylatują, chwytają paczkę, wracają do otwartego luku | najładniejsze, spójne z portami E12 | nowy lot dronów w układzie nosiciela (wzór `repairRig`), obraz roju poza portem, otwarty luk w walce | duży | **wybrana** (sprzęt do montażu zamiast wiązki, § 3.5) |
| **D. Holownik / hol** | lina do kontenera i do doku (jak wrak) | jest `TowSystem` | hol do wraków setek ton; na 16-j. kontener to ceremonia; holownik serwisowy to okręt wsparcia, nie zbieracz | średni | **nie**. Hol zostaje do kadłuba wraku |
| **E. Fregata zwiadu** | gracz prowadzi fregatę, przelot (A) jej małą ładownią (6 kontenerów), rozładunek po lądowaniu w luku | zbieranie pod maskowaniem (I), w mgle, z dala od Atlasa | mała ładownia, druga ładownia w logice, przełączanie sterów | średni | K5 (dobre dla pirata: „cichy zbieracz”) |

**Decyzja użytkownika (2026-10-27):** „wiązka lub drony. dodaj opcje montowania dronów, wiązki do zbierania
lootu”. Zbieranie robi sprzęt zamontowany na okręcie: wiązka ściągająca ALBO drony zbierające (§ 3.5). Chwyt
przelotem (A) nie jest osobnym sposobem, tylko końcem pracy wiązki i drona (paczka przy luku wchodzi do
ładowni). Hol (D) odpada, fregata (E) zostaje na później.

W obu wariantach paczka większa niż wolne miejsce oddaje tyle, ile wejdzie, a reszta dalej dryfuje z mniejszą
masą (jak `maxOre` w kopalni). Luk otwiera się, gdy paczka dolatuje (`_playerCargoDoor`), więc widać, jak
wjeżdża.

### 3.5 Montaż: gniazdo ZBIÓRKA

Wzór: system F (`HULL_SHIP_SYSTEMS`, wybór jednego z listy kadłuba, część w hangarze). Każdy kadłub gracza
dostaje jedno gniazdo ZBIÓRKA z wyborem: pusto, wiązka albo drony.

- **Dane:** `src/data/lootGear.js` (nowy, czyste dane): `LOOT_GEAR` (definicje i liczby na klasę),
  `HULL_LOOT_GEAR` (kadłub → dostępne opcje), `LOOT_GEAR_PART_PRICES`. Część leży w `PLAYER.partStock`
  (jak moduły i silniki manewrowe), wybór w `PLAYER.hullLootGear[kadłub]`.
- **Zapis:** pole `hullLootGear` obok `hullModules` / `hullSystems` w `serializePlayerFitState` /
  `restorePlayerFitState` (`index.html:13849`, walidacja po id jak `hullSystems`). Test w
  `tests/playerFitSave.test.mjs`.
- **UI:** czwarta sekcja „ZBIÓRKA” w refit ręcznym WYPOSAŻENIA obok MODUŁ / SYSTEM F / CHIPY
  (`src/ui/station/fittingPanel.js:117–121`), z ceną brakującej części; pasek stanu i pasek ZMIAN pokazują
  wybór. Karty automatu (UNIWERSALNA itd.) gniazda nie ruszają — zostaje, co zamontowane.
- **Bez sprzętu** kontenery widać (radar, lampka), ale zebrać ich się nie da. HUD przy kontenerze w 4 km:
  „BRAK SPRZĘTU ZBIÓRKI — wiązka albo drony (WYPOSAŻENIE)”.

| | **Wiązka ściągająca** (`loot_tractor`) | **Drony zbierające** (`loot_drones`) |
|---|---|---|
| Jak działa | projektor przy luku; sama łapie najbliższe widoczne kontenery w zasięgu i ciągnie je do luku | drony wylatują z luku same, każdy bierze jedną paczkę i wraca; luk otwiera się na powrót |
| Zasięg | Atlas 3,6 km (jak wiązka kopalni), krążownik / lotniskowiec 3 km, niszczyciel 2 km, fregata 1,5 km | Atlas 8 km od statku, pozostałe kadłuby z zatoką 6 km |
| Naraz | 4 paczki (Atlas), 2 (reszta) | liczba dronów: Atlas 6, Citadella 6, Colossus 4, Bellator 3, Iron Skull 2 |
| Warunek | statek wolniej niż 400 j./s (tryb BOJOWY, bez dopalacza); dalej wiązka puszcza | statek w trybie BOJOWYM (hipercruise i warp → drony wracają i porzucają paczki); drony 900 j./s puste, 450 j./s z paczką |
| Słabość | trzeba zwolnić i podlecieć, jedna wiązka na raz kilka paczek | drony da się zestrzelić (jak drony naprawcze; paczka spada z powrotem w przestrzeń), uzupełnia je dok; zatoka zabiera miejsce w ładowni |
| Koszt | część 8000 CR | część 14 000 CR + dron 900 CR; zatoka −6 slotów luku (Atlas: 6 × moduł 2 × 2 × 2 = 48 kontenerów, przy 2 t ≈ −96 t ładowności) |
| Dostępność | każdy kadłub gracza | kadłuby z ładownią na zatokę: Atlas, Bellator, Citadella, Colossus, Iron Skull (fregaty, Hasta i Reaver — tylko wiązka) |
| Obraz | promień z projektora do paczek (jak wiązka kopalni) | drony E12 (klasa L, chwyt 2 × 2) z paczką pod spodem, światła pozycyjne |

- **Atlas fabrycznie z wiązką** (w komplecie startowym `FIT_KIT_PARTS`, jak domyślny system F), drony do kupienia
  w porcie. Tak gracz od razu może zbierać, a drony są wyborem: wolniej, dalej, bez zwalniania.
- **Wiązka kopalni** (tryb N, klawisz T) zostaje osobno. Scalenie w jeden projektor „skały i kontenery” to osobna
  decyzja na później (§ 7).
- **Logika dronów:** lot w układzie nosiciela jak drony naprawcze (`repairRig.js`: start i powrót do doku na
  grzbiecie). Cel to kontener, nie komórka kadłuba. Trafienia dronów tą samą drogą co drony naprawcze
  (`RepairSwarm` — pociski, wiązki, flak, wybuchy).

### 3.6 Gdzie ląduje łup

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

### 3.7 Wpływ na ekonomię i piractwo

- **Gracz jako pirat już działa po stronie świata:** zestrzelony kurs to strata przewoźnika
  (`closeCourseResources … lost`), wpis `recordLaneLoss`, więc frakcja wzmacnia patrol na tym szlaku. Kontenery
  dodają tylko łup, który wcześniej przepadał.
- **Kradzież od frakcji:** kara jest przy zestrzeleniu (`killedShip` −6, kapitał −14). Do naprawy: encja zniszczona
  bez awansu reputacji dziś nie rusza (§ 1.1). Proponuję wołać to samo co `registerFactionKill` w
  `onTrafficActorDestroyed`. Znakowania „gorącego towaru” (paser w kryjówkach, kara za sprzedaż łupu właścicielowi)
  w MVP nie ma — decyzja D6.
- **Mgła wojny:** kontener ukryty poza czujnikami (`SensorSystem.pointVisible`). Wiązka łapie tylko widoczne
  kontenery. Radar i lampka gasną w mgle.
- **Piraci AI:** w MVP nie zbierają. W K5 awansowany pirat albo rajder w bańce może podlatywać do
  kontenerów w 5 km (konkurencja o łup, „kradną sprzed nosa”). Przechwyty w rekordach dalej dają 55% do kryjówki.
- **Bramka bilansu:** bez zmian. W symulacji nie ma gracza, a `cargo-recovered` to tylko statystyka. Weryfikacja:
  `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` przed i po, wynik identyczny.

### 3.8 Wydajność i szew renderu (`AGENTS.md`)

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
- **Drony zbierające:** stan w `lootContainers.js` (najwyżej 8 dronów gracza, tablice typowane: poza w układzie
  nosiciela, faza, cel, punkty życia). Krok w `physicsStep` przed kolizjami pocisków, trafienia przez obwiednię
  dronów jak `RepairSwarm.out` (0 dronów w powietrzu = nic do sprawdzania). Obraz: drony w tym samym bloku `loot`
  (poza, kurs, niesiona paczka), siatka drona E12 klasy L — do sprawdzenia w K3, czy materiał roju działa bez ramy
  slotów (inaczej wariant bez ramy, graf raz).
- **Zdarzenia** (błysk przy chwycie) jako rekord strumienia rozkazów, nie wywołanie modułu renderu.
- Szew gra ↔ render nie rośnie: moduł renderu czyta tylko blok. Strażnik `tests/szewRenderu.test.mjs`.

### 3.9 Testy

- `tests/lootContainers.test.mjs`: podział partii (suma ≤ 55% masy, determinizm z kursu, ostatnia paczka bierze
  resztę), dryf i tłumienie, czas życia, pełna pula (doklejanie tego samego towaru), wiązka (zasięg, 12 celów,
  bez celów niewidocznych w mgle), chwyt częściowy przy pełnej ładowni (reszta dryfuje), zero alokacji w kroku
  (licznik obiektów w pętli 10 tys. kroków).
- Manifest encji w protokole (`tests/workerBubble.test.mjs`): lista tylko zmian, urobek górnika z worka, promy bez
  manifestu.
- Księga: `recoverShipmentOrder` (część, całość, podwójny odzysk odrzucony, `validateShipmentOrder` czysty)
  w `scripts/tests/shipmentOrders.test.mjs`. Symulacja ruchu liczba w liczbę bez zmian.
- Gniazdo ZBIÓRKA (`tests/lootGear.test.mjs`, `tests/playerFitSave.test.mjs`): opcje per kadłub (drony tylko z
  zatoką), cena brakującej części, zapis → F5 → wczytanie, nieznane id odrzucone, ładowność minus zatoka dronów,
  bez sprzętu brak zbiórki.
- Drony: wylot, chwyt, powrót z paczką, porzucenie przy hipercruisie, zestrzelony dron gubi paczkę w przestrzeń,
  uzupełnienie w doku.
- Blok `loot`: koduj / dekoduj, WGSL wariantu „luzem” buduje się w Node, wpis w rozgrzewce, strażniki
  `graBezGlsl` i `szewRenderu`.
- Gra: `scripts/webgpu/kontenery-gra.mjs` (harness CDP, `__harness.step`): bańka przy Ziemi → ostrzał frachtowca
  z ładunkiem → awans → śmierć → N kontenerów → podlot → wiązka → `PLAYER.cargo` rośnie → terminal sprzedaje.
  Do tego encja bez awansu (jeden strzał), zrzuty w `off` i `renderWorker=1`, 0 pipeline'ów synchronicznych.

## 4. Plan etapów

| Etap | Zakres | Pliki | Zależności |
|---|---|---|---|
| **K1 — logika, łup i wiązka (MVP)** | manifest encji z workera; `lootContainers.js` (pula, zrzut, dryf, czas życia, wiązka, chwyt); gniazdo ZBIÓRKA (`src/data/lootGear.js`, `hullLootGear` w zapisie, sekcja w refit ręcznym, część w komplecie startowym Atlasa); klej w bloku „BAŃKA RUCHU v2 W GRZE” (obie ścieżki śmierci); `addToPlayerCargo` i komunikaty; reputacja przy zniszczeniu bez awansu; podgląd na kanwie 2D (kółko z kolorem rodziny, linia wiązki) do czasu K2; testy jednostkowe | `src/game/lootContainers.js`, `src/data/lootGear.js` (nowe), `src/game/traffic/workerBubble.js`, `trafficProtocol.js`, `src/game/trafficBubble.js`, `src/ui/station/fittingPanel.js`, `index.html` | D1–D5, D10, D14–D17 |
| **K2 — obraz** | blok `loot`, wariant „luzem” materiału kontenerów, `lootContainers3D.js`, rozgrzewka, lampka HDR, promień wiązki, otwieranie luku przy chwycie, radar, mgła; harness `kontenery-gra.mjs` | `src/render/blocks/lootBlock.js`, `src/3d/cargo/containers.tsl.js` (wariant), `src/3d/cargo/lootContainers3D.js`, `src/ui/radar/radarFeed.js` | K1, D8 |
| **K3 — drony zbierające** | opcja `loot_drones` w gnieździe ZBIÓRKA: lot dronów w układzie nosiciela, chwyt i powrót z paczką, porzucenie w hipercruisie / warpie, trafienia dronów, uzupełnianie w doku, zatoka odejmuje ładowność; obraz dronów w bloku `loot` | `src/game/lootContainers.js` (drony), `src/data/lootGear.js`, `src/3d/cargo/lootContainers3D.js`, `index.html` | K2 |
| **K4 — księga i wyrwa w ładowni** | `cargo-recovered` → `recoverShipmentOrder` (statystyka); wysyp z luku przy wyrwie w ładowni awansowanego frachtowca (`cargoDeckMask`, `cargo-spill`, przejście części partii do wraku); bramka bilansu na 3 ziarnach | `shipmentOrders.js`, `trafficDirector.js`, `trafficCore.js`, `index.html` | K1, D9 |
| **K5 — ulepszenia (osobne decyzje)** | fregata zwiadu jako zbieracz; piraci AI zbierający kontenery (ten sam sprzęt z `lootGear.js`); gorący towar i paser; zestrzeliwanie kontenerów (hazmat i amunicja wybuchają) | — | K2 |

## 5. Decyzje „na strzała”

Pytanie, a po strzałce rekomendacja domyślna.

1. **D1. Ładowność Atlasa.** Zostaje 20 t (łup symboliczny), ładowność z geometrii luku (1200 kontenerów × 2 t,
   bez pola myśliwców i stanowiska fregaty ≈ 1,8–2,0 tys. t, pomiar `scripts/hangary-pomiar.mjs`) albo coś
   pośrodku (np. 400 t, klasa bulk)? → **Z geometrii luku.** Luk już pokazuje ładunek jako kontenery
   (dziś 20 t wygląda jak 1200 kontenerów), a komentarz `AGENT:` w `cargoBays.js` to przewiduje. Uwaga: zmienia też
   handel (gracz wozi jak ciężki frachtowiec, ogranicza go oferta portu i kredyty) i kopalnię (rzadziej „ładownia
   pełna”). Bezpieczniejsza alternatywa to 400 t.
2. **D2. Ile ładunku przetrwa?** → **55% masy** (ta sama stała co łup piratów), reszta spłonęła. Nic nie zostaje
   we wraku kadłuba (martwe `_cargoManifest` sprzątnąć osobno albo wpiąć w K5).
3. **D3. Kiedy wypada?** → **MVP tylko przy zniszczeniu** (obie ścieżki: bez awansu i awansowany NPC). Wysyp przy
   wyrwie w ładowni żywego statku — K4.
4. **D4. Jak zbierać? — ROZSTRZYGNIĘTE przez użytkownika (2026-10-27):** „wiązka lub drony. dodaj opcje montowania
   dronów, wiązki do zbierania lootu”. Sprzęt do montażu w gnieździe ZBIÓRKA (§ 3.5); hol nie, fregata w K5.
5. **D5. Czas życia i limit?** → **5 min gry, pula 256**, przy przepełnieniu doklejanie do kontenera tego samego
   towaru; znika dalej niż 50 km od gracza.
6. **D6. Gorący towar?** (sprzedaż łupu właścicielowi = kara, paser u piratów) → **Nie w MVP.** Kara jest przy
   zestrzeleniu; znakowanie w K5.
7. **D7. Czy piraci AI zbierają kontenery w bańce?** → **Nie w MVP**, K5.
8. **D8. Widoczność?** → **Radar (punkt w zasięgu czujników) + mrugająca lampka HDR + mgła wojny chowa.** Bez CIC.
9. **D9. Zgłaszać odzysk do księgi?** → **Tak, w K4**, tylko jako statystyka i status `recovered`; symulacja bez zmian.
10. **D10. Manifest encji w bańce** (gra wie, co wiezie frachtowiec, zanim go zestrzeli; HUD celu „stal 380 t”)?
    → **Tak.** Bez niego zrzut w chwili wybuchu jest niemożliwy (rekord wraku przychodzi do 5 s później).
11. **D11. Kolizje kontenerów?** → **Duchy w MVP** (bez zderzeń z kadłubami, bez trafień); zestrzeliwanie w K5.
12. **D12. Zapis?** → **Bez zmian** (ładownia bez zapisu jak dziś, kontenery nie przeżywają F5).
13. **D13. Reputacja przy zniszczeniu encji bez awansu** (dziś zero)? → **Tak, jak `registerFactionKill`**, w K1.
14. **D14. Wiązka albo drony, czy oba naraz?** → **Jedno gniazdo, jeden wybór** (jak system F): wiązka albo drony.
15. **D15. Bez sprzętu da się zbierać?** → **Nie.** Kontenery widać, HUD podpowiada WYPOSAŻENIE.
16. **D16. Co ma Atlas na start?** → **Wiązkę w komplecie startowym**; drony za część 14 000 CR + 900 CR za drona.
17. **D17. Drony zabierają ładowność? — ROZSTRZYGNIĘTE przez użytkownika (2026-10-27):** „D17: zatoka dronów zabiera
    16 t (proporcjonalnie do miejsca w luku).” W K3: odliczenie = ładowność × (sloty zatoki / sloty luku) — Atlas
    400 t × 6 / 150 = 16 t; liczba z proporcji slotów (nie na sztywno), z testem. Skład naprawczy na razie bez zmian.

## 6. D1 — ładowność Atlasa 400 t: skutki (pomiar 2026-10-27)

Decyzja użytkownika: „nienei bezpieczniejsza opcja” — 400 t (klasa bulk) zamiast geometrii luku (~2,4 tys. t).

- **Obraz luku:** bez zmian w kodzie. Wypełnienie luku = masa ładunku / `cargoCap` (`playerCargoRecord`), więc
  pełne 400 t to pełny luk (1200 kontenerów obrazu ≈ 0,33 t na kontener). Kontener w obrazie jest widokiem liczby
  (jak w E12), nie jednostką ekonomii.
- **Handel** (świat ruchu po 1 h, ziarna 7 / 11 / 23, okazje z księgi rynku `findTradeOpportunities`, ten sam
  rachunek co kupcy):

  | Ziarno | 20 t: najlepszy kurs | 400 t: najlepszy kurs | Zmiana zysku | Przy 1200 CR startu |
  |---|---|---|---|---|
  | 7 | weapon_mount 4 szt. (20 t), koszt 5,9 tys., zysk 13,5 tys. CR | weapon_mount 7 szt. (35 t), koszt 10,4 tys., zysk 23,6 tys. | +75% | bez zmian (3,2 tys.) |
  | 11 | avionics 10 szt. (20 t), zysk 10,8 tys. | avionics 13 szt. (26 t), zysk 14,0 tys. | +30% | bez zmian (2,3 tys.) |
  | 23 | weapon_mount 4 szt., zysk 13,5 tys. | reactor_core 8 szt. (48 t), zysk 16,5 tys. | +22% | bez zmian (3,2 tys.) |

  Najlepsze kursy ogranicza głębokość rynku (ile port sprzeda i ile przyjmie), nie ładownia: przy 400 t okazji
  wypełniających ≥ 95% ładowni jest 36–49 z 200 (przy 20 t — 84–94). Zysk na kurs rośnie o 20–75% i wymaga
  6–10 tys. CR kapitału; na starcie (1200 CR) nic się nie zmienia. Komputer handlowy CIC już liczy okazje dla
  ładowni 380 t (`tradeSummary.js`), więc teraz zgadza się z Atlasem. Strojenia nie proponuję.
- **Kopalnia** (`asteroidMiningRig.js`, limit `cargoFree`): skała miedzi r ≈ 650 j. daje ~140 t rudy. Przy 20 t
  „ładownia pełna” przychodziło po ~1/7 pierwszej skały; przy 400 t — po ~2,9 skały. Udźwig wiązki kopalni
  (najcięższy odłam 450 t) bez zmian. Strojenia nie proponuję.
- **Naprawa w polu** (drony R, materiał z ładowni): 20 t stali = 800 komórek ≈ ¼ kadłuba Atlasa; 400 t stali =
  16 000 komórek ≈ 5 kadłubów. Ładownia przestaje ograniczać naprawę — zostają kredyty (stal ~16 CR/t: 400 t ≈
  6,4 tys. CR), czas pracy dronów i słabsze łaty (`patchHpMul`). Tu może się rozjechać: jeśli naprawa w polu okaże
  się za mocna, propozycja — osobny „skład naprawczy” (np. 40 t materiału dla dronów) albo droższy odrost
  (`cellsPerUnit`). Nie zmieniam bez decyzji.
- **Łup:** zrzut pełnego dalekiego frachtowca (209 t) mieści się w całości, ciężkiego (495 t) — w 80%.
- **D17 przy 400 t:** −96 t za zatokę dronów to 24% ładowności — za dużo. Propozycja: odliczenie proporcjonalne
  do miejsca w luku — zatoka zajmuje 6 ze 150 slotów luku (4%), czyli **−16 t** (albo okrągłe −20 t = 5%).
- **(a) Tabela ładowności kadłubów gracza — ZATWIERDZONA przez użytkownika 2026-10-27 („Zatwierdzam tabelę
  ładowności kadłubów gracza w tej postaci (Bellator 150 t, Iron Skull 180 t).”), w danych:
  `src/data/playerHullCatalog.js` (`cargoCap`) i lustro `cargoToday` w `src/data/cargoBays.js`.** Ramy użytkownika (2026-10-27): „Megafrachtowiec jak klasa mega 2400 t, kapitałowe 300–600 t”,
  Atlas 400 t jako punkt odniesienia, reszta wg rozmiaru i roli (fregaty — mało). Kadłuby i rozmiar (dłuższy bok
  rysunku, `getHullRenderSize`) z `src/data/playerHullCatalog.js`; luk = kontenery ładowni z geometrii
  (`cargoCapacityTable`, obraz).

  | id | Nazwa | Klasa / rola | Długość [j.] | Luk [kont.] | cargoCap przed 2026-10-27 [t] | cargoCap w danych [t] | Uzasadnienie |
  |---|---|---|---|---|---|---|---|
  | `pirate_frigate` | Marauder | fregata (piracka, zdobyczna) | 192 | 1 | 12 | 15 | Najmniejszy kadłub z jednym kontenerem w luku — tylko łup z jednej paczki. |
  | `frigate` | Custos | fregata Terra Nova | 192 | 6 | 16 | 20 | Fregata eskortowa: ładownia na części i amunicję, nie na handel. |
  | `corvus` | Corvus | fregata rakietowa (niezależna) | 216 | — | 24 | 25 | Nieco większa od Custosa; magazyny rakiet zjadają resztę kadłuba. |
  | `pirate_destroyer` | Reaver | niszczyciel (piracki) | 360 | 8 | 22 | 40 | Piracki rajder: większy od Hasty i żyje z łupu — ładownia większa niż dziś. |
  | `destroyer` | Hasta | niszczyciel Terra Nova | 288 | 9 | 30 | 40 | Niszczyciel — dwa razy fregata; nadal nie frachtowiec. |
  | `battleship` | Bellator | pancernik Terra Nova | 624 | 136 | 40 | 150 | Pancernik (rynek: klasa `battleship`, poniżej kapitałowych) — luk na 136 kontenerów; pierwszy kadłub, którym da się sensownie zbierać łup. |
  | `pirate_battleship` | Iron Skull | pancernik piracki | 720 | 84 | 32 | 180 | Większy od Bellatora i piracki — ładownia na łup, choć luk mniejszy. |
  | `carrier` | Citadella | lotniskowiec floty (kapitałowy) | 1080 | 528 | 80 | 300 | Dolna granica kapitałowych — hangary myśliwców zabierają miejsce ładunkowi. |
  | `atlas` | Atlas | niezależny superkapitał (start) | 1800 | 1200 | 400 | 400 | Punkt odniesienia (D1). |
  | `supercapital` | Colossus | superkapitał Terra Nova | 1560 | 560 | 120 | 500 | Największy okręt wojenny; ponad Atlasem, poniżej górnej granicy 600 t (okręt liniowy, nie transportowiec). |
  | `megafreighter` | Megafreighter | pociąg towarowy (przemysłowy) | 2760 × 8 modułów | 6 wagonów | 600 | 2400 | Klasa `mega` ruchu (`VAN_CLASSES`: 2400 t) — ten sam frachtowiec co w ruchu v2. |

  Skutki (pomiar 2026-10-27; ceny, handel, kopalnia, cięcie, naprawa):
  - **Ceny** (`src/data/playerHullMarket.js`, `tests/playerHullMarket.test.mjs` „ceny rosną z możliwościami”): ceny
    to stałe, ładowność do nich NIE wchodzi; test sprawdza tylko kolejność cen (fregata < niszczyciel < pancernik <
    lotniskowiec < megafrachtowiec < superkapitał, pirackie taniej) — tabela go nie łamie. Megafrachtowiec za 36 tys.
    dostaje 6× ładowność Atlasa (sens dla frachtowca); Iron Skull ma większą ładownię niż droższy Bellator — celowa
    nisza piracka.
  - **Handel** (świat ruchu po 1 h, ziarna 7 / 11 / 23, najlepszy kurs z księgi rynku): 150–500 t daje TEN SAM
    najlepszy kurs co 400 t (13,5–23,6 tys. CR zysku — kurs ogranicza głębokość rynku, nie ładownia), 20 t —
    10,8–13,5 tys. Ładownia 2400 t: 48,9–71,1 tys. CR zysku na kurs, ale wymaga 92–98 tys. CR kapitału. Czyli dla
    okrętów 150–500 t zmiana handlu jest mała; megafrachtowiec staje się prawdziwym transportowcem dla bogatego gracza.
  - **Kopalnia** (`asteroidMiningRig.js`, limit `getPlayerCargoFree` każdego kadłuba): skała miedzi ~140 t rudy →
    „ładownia pełna” po ~1 skale (Bellator 150 t), ~2 (Citadella), ~3,6 (Colossus), ~17 skałach (megafrachtowiec).
  - **Cięcie wraku w polu** (~5 t/s): pełna ładownia po ~30 s (Bellator), ~60 s (Citadella), ~100 s (Colossus),
    ~8 min (megafrachtowiec) — hamulec „ładownia pełna” praktycznie znika dla kapitałowych.
  - **Naprawa w polu** (drony R biorą stal z ładowni): ładownia przestaje ograniczać naprawę także na kapitałowych
    (jak przy Atlasie, § 6 wyżej); skład naprawczy — do decyzji po grze.
  - **Przesiadka** z ładunkiem ponad ładowność nowego kadłuba — odmowa w hangarze (przegląd K1 #7), więc zmniejszenie
    ładowności przy przesiadce nie gubi towaru.
- **(b) Cięcie wraku w polu** (`updateFieldSalvage`, `FIELD_CUT_SHARDS_PER_SECOND` 34 heksów/s, ~0,15 t złomu i stali
  na heks): ~5 t/s, więc „ładownia pełna” przy 20 t przychodziła po ~4 s, przy 400 t — po ~80 s cięcia. Hamulec
  ładowni praktycznie znika; zostaje czas stania przy wraku (cięcie w zasięgu 900 j., w polu bitwy). Opcje: bez zmian
  (rekomendacja — sprawdzić w grze) albo wolniejsze cięcie (np. × 0,5).
- **(c) Ceny ładunków górniczych** (`src/data/miningCharges.js`) liczone pod 20 t: pełna ładownia rudy miedzi to dziś
  3200 CR zamiast 160, więc ten sam ładunek zwraca się ~7× lepiej na skałę. Opcje: bez zmian (rekomendacja do testu
  w grze) albo ceny × 4 (S 32, M 100, L 320, XL 1000 CR). Komentarz w pliku opisuje kalibrację; cen nie ruszałem.
- **Testy:** `cargoBays`, `playerHullMarket` (ceny kadłubów nie czytają ładowności), `playerFitSave`, `repairRig`,
  `repairBlock`, `asteroidMining*`, `portCargo`, `scoutBay` — 134 / 134.

## 7. Zauważone przy okazji (poza zakresem)

- `_extraSalvage` / `_cargoManifest` w `salvage.js` to martwa ścieżka; `docs/SPEC-ekonomia-i-logistyka.md:19`, `:117`
  opisuje ją jako działającą.
- `tick.wrecks` i `recentWrecks` w moście nikt w grze nie czyta (`trafficBridge.js:526`).
- Rekord wraku wyprawy górniczej ma `units` 0, bo urobek jest w `payload.harvest`
  (`trafficCore.js:1010–1011`).
- Zniszczenie encji ruchu bez awansu nie zbija reputacji (§ 1.1, D13).
- Paczki w otwartej przestrzeni były ciemne: materiał kontenerów E12 (wspólny z przeładunkiem) świeci słońcem prawie
  poziomym (`setCargoSun`, z = 0,02 — jak kadłuby), a poza ładownią nie ma lamp wnętrza. NAPRAWIONE w K2: wariant
  materiału `{ loot: true }` ze słońcem `LOOT_CARGO_LIGHT` 50° i wypełnieniem (`ac6ec728`); kontenery E12 bez zmian.
- Automatyczne wieże Atlasa (tryb AUTO) same ostrzeliwują statki ruchu, które mają urazę do gracza po jego ostrzale
  (awans do NPC, `playerGrudge`): w przebiegu `kontenery-gra.mjs` po kilku strzałach gracza wokół toczyła się bitwa
  z kolejnymi frachtowcami i ich zniszczeniami (wiele zrzutów naraz). Zachowanie istniejące przed K1 — do oceny,
  czy wieże AUTO powinny strzelać do cywilów z urazą.
- Wiązka kopalni (tryb N, klawisz T) jest dziś zawsze na Atlasie, poza wyposażeniem. Po gnieździe ZBIÓRKA może
  przejść do tego samego sprzętu (jeden projektor na skały i kontenery) — osobna decyzja.
