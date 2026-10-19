# Port: kadłuby na silniku belek (zamiast heksowego destruktora)

Stan: 2026-09-25, etap 1 wdrożony — **statki gracza, P2, NPC i ich wraki są na silniku belek**
(`src/game/destructorBeams3D.js`, tryb płaski, solver lokalny). Encja z kadłubem ma `beamHull`,
nie `hexGrid`. Od 2026-10-11 (etap 8, § „Etap 8” niżej) **gra w ogóle nie ładuje heksowego destruktora**
(`src/game/destructor.js`, solver sprężyn GPU, arena heksów, siatka kontaktów); 2026-10-19 (etap 9, § „Etap 9”)
**usunięty z repo** razem z demami heksowymi i rusztowaniem workera fizyki v2.

## Pliki

| Plik | Rola |
|---|---|
| `src/game/hullBodies.js` | adapter gry: budowa kadłuba (siatka 15 px, `hexPerNode`), synchronizacja ruchu, krok, trafienia, zapytania, wraki, łup, odłamki, naprawa, zdarzenia zderzeń |
| `src/3d/hullDebris3D.js` | odłamki z dema (pogięte płyty i kształtowniki, instancje), jedna pula na grę; `window.spawnHullDebris` |
| `src/game/destructorBeams3D.js` | silnik; haki gry: `pairFilter`, `onContact`, `onWreck`, `onNodeDebris`, `clock`; krater (`opts.hpBudget`); `sweepLocal2D` / `probeLocal2D`; żar zgniotu (`cfg.heatGain`) |
| `src/game/beamStore3D.js` | pola węzła `heat` / `heatStamp` (tylko render) |
| `src/3d/beamHullSkin.js` | skóra gry: czworokąt na węzeł, UV jak tekstury heksów (`flipY = false`), jasność blachy, żar |
| `src/3d/hexShips3D.js` | backend skóry (`createBeamSkinMesh` / `updateBeamSkinMesh`), materiał = graf TSL skóry belek (`hexShips3D.tsl.js`, rysunek w partiach `hullSkinBatch.js` — port WebGPU, zadania 04 i 23); cień SDF z komórek (`beamShadowGrid`) |
| `src/3d/hullShadowSdf.js` | siatka komórkowa (`cellX/cellY/cellActive/cellCount/cellRadius`) obok heksów |
| `shieldSystem.js` | tarcza-obrys z węzłów spoczynkowych (`hull.shieldCells`) |
| `src/game/salvage.js` | udziały w komórkach = `hull.baseNodes`, stawki materiałów i tempo cięcia na heks (`hexPerNode`), broń przypięta do komórki `ix,iy` |

## Układy i kotwica

- Silnik: `X = x gry`, `Y = −y gry`, `θ = −(angle + spriteRotation)`, `ω = −angVel`. To układ
  renderu Core3D (x, −y) — skóra stoi wprost na ciele.
- Kotwica encji (`x, y` gry): statek = **środek sprite'a** (gniazda, dysze, światła liczą się od
  niego), wrak = **środek masy** ciała (`anchorMode: 'com'`, `hull.pivot` = piksel sprite'a środka masy).
- Środek sprite'a w układzie ciała = `latticeMin + (anchorDX, anchorDY)` — stały względem siatki,
  więc rozpad (przesunięcie `latticeMin` i `pos`) nie rusza kotwicy statku.
- Obraz kadłuba = ten sam, który dostawał `initHexBody` (sprite w rozmiarze renderu); komórka
  **15 px jak w demie** (`HULL_BODY_CONFIG.cellPx`, decyzja usera 2026-09-25). Tekstura skóry =
  pełny sprite (`visualImage`), UV znormalizowane.
- Dawna komórka 7,5 px (odstęp heksów) dawała 4× więcej węzłów (Atlas 12 288 zamiast 3 121):
  pchany okręt budził się cały i nie zasypiał (próg ruchu `0,2·cs` spada z komórką) — ciągły
  styk 2,7 ms/krok zamiast 0,13 — a kadłub pękał zamiast sprężynować jak w demie.
- Jednostką strojenia zostaje heks (`HEX_PITCH_PX` = 7,5): węzeł = `hull.hexPerNode` heksów
  (≈ 4). Tyle razy więcej HP (80 · pokrycie · hexPerNode = 320 — ten sam pancerz na
  powierzchnię), tyle waży w łupie (`salvage.js`: stawki na heks, udziały dalej w węzłach), tyle
  heksów zdejmuje cięcie wraku w polu (`fieldCutNodesPerSecond`). Krater liczy promień w heksach.

## Krok fizyki (`physicsStep`)

Gra całkuje ruch encji jak dotąd → `HullBodies.step(dt, allDestructibles)`:
`syncIn` (poza i prędkość encji → ciało), `DestructorBeams3D.update` (solver, kontakty, zgniot,
rozpady), `syncOut` (poprawka ruchu → encja; tylko gdy silnik coś zmienił). Heksowego kroku
(`DestructorSystem.update` / `updateVisuals`) od etapu 8 nie ma.

## Trafienia i zapytania (świat gry, y w dół)

- `HullBodies.sweep(e, x0, y0, x1, y1, r)` — pierwszy żywy węzeł na odcinku (pociski, PD, wiązki);
  wynik współdzielony (`hullSweepResult`), `worldX/Y` = punkt wejścia.
- `HullBodies.impact(e, x, y, dmg, vel, {radius})` — KRATER: budżet HP = `0,9 · dmg` od
  najbliższego węzła (HP węzła 320 = 4 heksy po 80), promień `heks · clamp(1,5 + √(dmg/80), 1,5, 5)`
  (heks = `cs / √hexPerNode`, w j. świata jak dawniej), wgniecenie wzdłuż pocisku. Bez promienia
  zerwań: pękają belki zabitych węzłów, reszta wg oparcia. Lekkie działa najpierw wgniatają;
  dziurę (15 j.) robi dopiero kilka trafień w to samo miejsce. `opts.craterRadius` (zadanie 25c,
  ciężka broń — promień leja rany z `hullDamageStamps.craterRadiusFor`): bez budżetu, każdy węzeł
  w promieniu ginie (`D.applyImpact` `killRadius`, odrzut blachy z haszu węzła), zasięg dziury
  w `hullImpactResult.crater`.
- `HullBodies.probe(e, x, y)` — podparcie gniazd broni i rdzeni.
- `HullBodies.cutSegment` — rzaz Hexlance (pas 35 j.); `cutOuterNode` — cięcie wraku w polu.
- Sufit HP: `getHullStructuralState` → `HullBodies.structuralState` (żywe węzły / startowe).

## Masy (od 2026-09-26)

- **Masa ciała w silniku = masa ZDERZEŃ z powierzchni kadłuba**: `massPerArea` (1,19 / j.²) ×
  Σ pokrycie · cs² — jedna gęstość dla wszystkich kadłubów jak w demie (Atlas 672 400 j.² ≈ 800 tys.).
  Zderzenie i zgniot zależą wyłącznie od STOSUNKÓW mas (`jYield` ∝ masa węzła lżejszego ciała),
  a szablony gry dawały kapitałom ~0,3 masy/j.², fregatom i niszczycielom 1,3–1,6 — mały okręt
  przepychał Atlasa jak ciężki. A/B (niszczyciel 400 j./s w burtę Atlasa): Atlas dostawał
  13–21 j./s, teraz 2–3 j./s.
- **`entity.mass` zostaje masą GRY** (ciąg dysz ∝ masa, separacja AI `1/m^0,25`, holowanie,
  asteroidy) w dotychczasowej skali szablonów; transportowiec bez masy dostaje masę zderzeń.
- `syncOut`: gdy masa ciała spadnie (także trafienie MIĘDZY krokami — wcześniej nie liczone),
  masa gry i `inertia` encji maleją w tym samym stosunku (`_massRef`) — obrót uszkodzonego statku
  się nie zmienia (ciąg rośnie z masą, bezwładność była zapamiętana ze startu).
- Wrak: masa gry = masa jego ciała × skala gry rodzica (`gameMassScale`) — holowanie jak dotąd.
- Panel deweloperski mas (`destructorMassPanel.js`) USUNIĘTY 2026-09-26 (relikt heksów): startował
  zawsze i co 1 s nadpisywał masy gry NPC klasami (kapitały, też moduły megafrachtowca i Atlas
  NPC → 100 tys.) i wartościami z localStorage. Masy gry idą teraz wyłącznie z szablonów;
  klucz `devDestructorMassConfig` został na liście `SAVE_KEYS.dev`, żeby `?reset` go sprzątnął.

## Pancerz i zgniot (2026-10-04)

`src/data/hullArmor.js` przypisuje pancerz mechaniczny do profilu kadłuba: fregata 1,
niszczyciel 1,5, pancernik 3, lotniskowiec 4, superkapitał 10, Atlas 16. Frachtowce mają
własne słabsze poszycie — duży rozmiar i masa nie oznaczają pancerza okrętu bojowego.
Wszystkie ścieżki budowy w grze (gracz, zmiana kadłuba, P2, NPC) podają `hullProfileId`;
`HullBodies.createHull` zapisuje wartość w `body.collisionArmor`. Cały wrak i odłamki
dziedziczą ją po rodzicu. Nieznany/ręczny kadłub ma 1, jak przed zmianą.

Globalne `crushStrength` i `globalBreakMul` zostają strojeniem materiału. Opór zgniotu
jest mnożony przez pancerz słabszego uczestnika (przy ciele statycznym — statku).
Podatność każdego kadłuba maleje z kwadratem jego pancerza; udziały zgniotu są
normalizowane, więc mocne poszycie przekazuje zgniot słabszej stronie. Masa nadal
wpływa na podział, impuls i obrót. Równe pancerze zachowują podział według mas;
Atlas może się niszczyć w taranie innego ciężkiego okrętu. HP i kratery od broni
nie są zmienione przez ten parametr.

Test `tests/hullCollisionArmor.test.mjs`: rząd z misji 1, prawdziwe sprite'y, szarża
z `SHIP_SYSTEMS.atlas`, zgniecenie co najmniej trzech jednostek i strata <1% kadłuba
Atlasa; także taran Atlas–Atlas, dziedziczenie pancerza oraz niezmieniony budżet broni.

## Prawo kontaktu v2 (2026-10-14, audyt `docs/AUDYT-destruktor-3d-2026-10-14.md`)

Zgłoszenie użytkownika: „ciężko miażdżyć, nienaturalnie się rozciąga, statek grzęźnie”. `createBeamConfig.contactV2`
(domyślnie false — dema i testy silnika bez zmian), gra włącza w `HullBodies.init` (`HULL_BODY_CONFIG.contactV2`).
Gałąź `DestructorBeams3D._contactV2` po zebraniu kontaktów pary:

- **Normalna z geometrii**: środek materiału A minus środek materiału B w oknie wokół styku (`_windowCentroid`, okno
  `contactNormalCells` × komórka, do × 3 z rozrzutem styku). Gdy środki się pokrywają (głęboko w materiale) — kierunek
  ruchu względnego (ciała się zbliżają) albo suma normalnych węzeł-węzeł. Rozchodzenie się wzdłuż normalnej = brak
  impulsu (wycofanie nie hamuje); korekta pozycji tylko dla pary zbliżającej się / spoczywającej (`contactRestSpeed`).
- **Granica plastyczności z frontu**: `jYield = crushStrength · pancerz · masa węzła lżejszego / cs · front · dt`,
  front = kosze komórki w poprzek normalnej (`_contactFront`; kotwica ciała zakotwiczonego = `pinYieldMul` komórek).
  Potrzebny impuls ≤ granica → styk sprężysty (płynnie od zera — trzymane W stoi albo wgniata zależnie od siły, nie od
  progu 45 j/s); większy → granica + zgniot nadmiaru.
- **Zgniot** (`_crushNodeV2`): przesunięcie o max(głębokość styku, droga zbliżania w kroku × `crushTravelMul`) z sufitem
  `crushMaxCells`, wyboczenie od ŚRODKA STYKU, prędkość węzła wzdłuż normalnej ≥ nadmiar zbliżania × udział (węzeł jedzie
  z frontem). Pęd nadany węzłom wraca reakcją na drugie ciało (materiał trzymany przez konstrukcję stawia ciągły opór).
  Belki przeciążone zgniotem pękają w tym samym kroku (`_breakOverloaded` — render nie widzi gumy).
- **Kotwice o skończonej wytrzymałości**: zgniot rusza kotwicę (`invMass 0`) najwyżej o drogę zbliżania w kroku; dalej
  niż `pinBreakCells` od spoczynku — spaw puszcza (`invMass` = 1/m, `perf.pinsReleased`, kolejka podziału — wyspa bez
  kotwicy odpada).
- Strojenie gry (`HULL_BODY_CONFIG`): `pinYieldMul` 28, `pinBreakCells` 1, `crushTravelMul` 1, `friction` 0,35,
  `crushStrength` 300 000 (bez zmian). Wynik (Atlas × bęben habitatu): 900 i 1500 j/s stają na pierścieniu wewnętrznym,
  2200 i 3000 j/s go zrywają; muśnięcie 25 j. traci 2–14% prędkości wzdłuż ruchu; 60 ≈ 120 Hz (głębokość ≤ 11%).
  Tabela przed / po — audyt § 8; pomiar `node scripts/destrukcja-taran-sym.mjs`, odbiór `tests/destrukcjaTaran.test.mjs`.
- Warstwy z (`entity.zLayer`, `pairFilter`): ciała różnych warstw się nie zderzają; w warstwie ≠ 0 zderzają się także
  encje z `isCollidable = false` (duchy budowli: dysk pod płaszczyzną gry, spadająca głowa habitatu). Wrak dziedziczy
  warstwę rodzica.

## Ciała 3D (2026-10-15)

Decyzja użytkownika: „silnik prawdziwie 3D — będzie potrzebny do fabuły, wybuchów i zniszczeń (hala K-7, ring,
budynki)”. Pierwsze użycie: wieża habitatu bazy piratów po zerwaniu szyi przechyla się powoli jak wieża, uderza BOKIEM
w koronę bębna i dysk, bok się gniecie (AGENTS.md § „Baza piratów” — SZYJA HABITATU).

Silnik był 6DoF od zawsze (poza + kwaternion, węzły w układzie ciała); gra włączała `cfg.planar` globalnie. Teraz
płaskość jest polem CIAŁA, a płaskie sceny liczą się BIT W BIT jak przed (testy silnika, ślad
`destrukcja-taran-sym.mjs` poza czasem).

- **Pola ciała** (`createBody`; ta sama kolejność w `_spawnWreck` i `createRestoredBody`, wrak dziedziczy):
  `planar` (domyślnie `cfg.planar`), `gravity` {x, y, z} [j/s²] (tylko swobodne ciało 3D — `integrate`; węzły się
  od niej nie odkształcają: zakotwiczona konstrukcja stoi bez naprężeń od ciężaru, spada to, co odpadło), `colZ0` /
  `colZ1` (słup ciała płaskiego dla brył), `joints`, `friction` (para bierze większe; null = `cfg.friction`),
  `nodeDamping` / `activeThreshold` (tłumienie węzłów i próg aktywności solvera lokalnego CIAŁA; null = konfiguracja).
- **Przeguby** (`addJoint(ciało, wx, wy, wz, { breakTilt, breakForce, up })`, `removeJoint`): kulisty, punkt ciała
  trzymany w miejscu świata; liczony w `integrate` (impuls prędkości dokładny dla jednego więzu — macierz 3 × 3
  K = m⁻¹·I − [r]×·I⁻¹·[r]×, + korekta położenia `jointBeta`); pęka przy przechyle od osi „w górę” z chwili założenia
  albo przy sile więzu.
- **Para MIESZANA** (płaskie × 3D, `_collideMixed`): ciało płaskie jest dla brył SŁUPEM — węzeł = pionowa kapsuła
  od `colZ0` do `colZ1` nad węzłem (kadłuby ± `shipColumn` 70; budowle — z wysokości swoich brył, `piece.column`).
  Iteruje się bryłę (kandydaci w obrysie słupów), najbliższy słup z siatki ciała płaskiego (tylko XY). Płat jest LITY:
  węzeł bryły we wnętrzu wychodzi PIONOWO pod prąd ruchu (głębokość pionowa najwyżej promień styku — bez katapulty),
  przy brzegu (`surface`) — w bok. Normalna pary = suma normalnych wyjścia ważona głębokością (okno środków materiału
  nie widzi słupa). Impuls (`_mixedImpulse`): ciało płaskie ma ruchliwość tylko w XY i obrotem wokół z; jego pionowy
  zgniot zdejmuje HP węzła (`_crushColumn`, `columnCrushCells` komórek = pełne HP — kolumna ginie w całości:
  ograniczenie 2,5D, AGENT: wysokości kolumn per węzeł). Broadphase liczy zakresy z tylko, gdy w kroku jest bryła.
- **Bryła × bryła** — prawo v2 bez płaszczyzny (front = liczba kontaktów).
- **Spoczynek bez zgniotu**: para z bryłą zbliżająca się wolniej niż `crushRestSpeed3D` (gra: 40 j/s) to styk
  sprężysty, także ponad granicą plastyczności. Ciężka wieża (4·10⁷ masy) na wąskiej koronie bębna (~40 węzłów frontu)
  przekraczała granicę samym ciężarem — gniotła się co krok bez końca i solver liczył ją CAŁĄ (~110 tys. belek na
  krok przez ~8 s po uderzeniu). Statyczny ciężar nie gniecie, gniecie uderzenie.
- **Tłumienie i próg brył** (gra: `HULL_BODY_CONFIG.solidNodeDamping` 0,4, `solidActiveCells` 0,4 × komórka bryły):
  kadłuby mają próg 0,4 × 15 = 6 j/s, a próg w j/s nie rośnie z komórką — kratownica wieży (komórka 45) po zgniocie
  „dzwoniła” sekundami całą długością. Z tłumieniem zgniot zostaje LOKALNY (bok), reszta wieży sztywna (Teardown),
  obszar solvera po uderzeniu ~1–4 tys. węzłów zamiast 13 tys.
- **Zamrożenie** (`freezeBody(ciało, pinEvery)`): ciało w spoczynku staje się zakotwiczone na rzadkiej siatce kotwic
  (ix, iy, iz podzielne przez `pinEvery`; bez takiego węzła — wszystkie), prędkości węzłów zero, obszar aktywny pusty,
  belki przyjmują obecną długość (kształt po zgniocie jest nowym spoczynkiem — bez naprężeń resztkowych), przeguby
  zdjęte. Trafienia i zgniot dalej je łamią (wyspa bez kotwicy odpada, ciało bez kotwic znów swobodne). Koszt kroku 0.

Gra (`HullBodies`): `createSolid(encja, struktura3D, opts)` — konstrukcja z wokselizacji (`voxelizeTriangles` →
`bridgeVoxelComponents` — mostki komórek łączą rozłączne bryły → `buildBeamStructure(…, { bulkheadEvery: 0 })`),
poza świata silnika (x gry, −y gry, z), kotwice `pins(x, y, z)`, materiał, grawitacja. Silnik CAŁKUJE bryły sam
(`HullBodies.step` → `D.integrate(solids)`), encja jest lustrem (`syncSolidOut`: x, y = −pos.y, z, quat, kąt, vx, vy,
vz). Wrak bryły — `makeSolidWreckEntity` (`solid3D`): pętla wraków gry go nie całkuje, usuwa poniżej `solidFloorZ`
(−6000); rozpad — `shatterSolid` (Voronoi 3D); odłamki węzłów z wysokością (`hullDebris3D.spawn(…, z, vz)`). Filtr
par: bryły ignorują warstwy z (zderzają się w prawdziwym z). Broń trafia bryły w PASIE gry (§ „Trafienia brył” niżej).
Zimne wraki — bryły wykluczone.
`worldBodies`: kawałek z `piece.solid3D` (+ `buildSolid()`) staje się bryłą (lista `_solids` — fizyka i render),
`detachPiece` / `breakPiece` mają gałęzie brył.

Render (`worldBodies3D.js`, `portBuildingSkin3D.js`, `portBuildings3D.tsl.js`): wypiek skóry 3D (kratownica
wielowarstwowa, `hullSkinLattice3D`, podział i kotwica w 3D), wariant grafu budowli „skin3” (FFD z 8 rogów) z cięciem
po z świata — bryła rysuje się DWIEMA siatkami: pod płaszczyzną gry w passie tła, nad nią w FG (passy czyszczą
głębię; `userData.clipZ`), poza z kwaternionu, podzbiory odłamów w 3D (`fragmentSkinSubset3D`); bryły z wyprzedzeniem
wypieku `PREBAKE_RADIUS_SOLID` (9 km). Rozgrzewka wariantu skin3 — `pirateBaseGame.js`.

Pomiar (Node, 60 Hz, szarża 3000 j/s w szyb habitatu, `node scripts/destrukcja-taran-sym.mjs --tryb szyja [--pary 1]
[--hb solidNodeDamping=…] [--neck k=v] [--solid k=v] [--mat k=v] [--odlot 1]`): przechył 1,6–3,8 ms/krok, faza
uderzenia ~2 s (solver 1–9 ms, kolizje 3–6 ms — pary mieszane ~1,5 ms; średnio ~5 ms/krok), po zamrożeniu ~1,3 ms
(sama reszta sceny). Przed poprawkami kosztu (spoczynek bez zgniotu, tłumienie brył, zamrożenie) solver po uderzeniu
liczył CAŁĄ wieżę (~110 tys. belek, 15–20 ms/krok) przez ~8 s. W przeglądarce: przechył 2–5 ms fizyki na krok,
~1,5–2 s po uderzeniu 10–17 ms (klatki ~40–45 ms), po zamrożeniu ~2 ms. W przeglądarce `node
scripts/webgpu/baza-zniszczenie-gra.mjs --tryb szyja [--kamera tactical] [--zoom 0.5] [--seria 1]` (czas kroku fizyki
i klatek w oknach 0,25 s, kadry, pipeline'y synchroniczne). Testy `tests/beamSolid3D.test.mjs` (grawitacja,
przegub, bryła na słupie płyty 60 / 120 Hz, płaskie bez ruchu w pionie, przebicie słabej płyty, mostki komórek),
odbiór scenariusza — `tests/destrukcjaTaran.test.mjs`.

### Trafienia brył: pas broni (2026-10-15)

Prośba użytkownika: „rzeczom 2D przy rzeczach 3D (misja piracka) dać hitboxy 3D, żeby mogły normalnie rozwalać świat
3D”. Rozgrywka zostaje w płaszczyźnie gry, więc rzeczy 2D dostają dla brył WYSOKOŚĆ: okręt to słup ± `shipColumn`
(pary mieszane — wyżej), broń gry (pocisk, wiązka, rzaz Hexlance'a, orka kanałów świata) leci w PASIE
|z| ≤ `HULL_BODY_CONFIG.weaponBand` (70 j. = słup okrętu). Węzeł bryły jest w pasie, gdy jego wysokość świata mieści się
w pasie poszerzonym o pół komórki (kula węzła dotyka pasa). Co bryła ma poza pasem, broń mija — jak okręt: stojąca
wieża habitatu (z 209…2324) jest nad pasem, dysk mieszkalny (z −1034…−674) POD nim — pociski, wiązki i Hexlance go
mijają, a kula fali wybuchu w płaszczyźnie gry wprawdzie sięga w dół, ale ≥ 674 j. pod punktem wybuchu kopnięcie
(∝ 1/d²) to kilka j/s (Supernowa nad dyskiem: 0 węzłów straconych); dysk w praktyce niszczą spadająca wieża i rozpad
habitatu. Przewrócona wieża (z −801…890) ma w pasie ~2 tys. z 12,7–13 tys. węzłów (przekrój 1,4–1,5 km wzdłuż
leżącej wieży).

- **Indeks pasa** (`src/game/beamBand3D.js`, bez three i DOM): węzły pasa z położeniem świata silnika (X = x gry,
  Y = −y gry, Z) w siatce 2D o boku komórki ciała (`bandIndex`; szybkie odrzucenie ciała z obwiedni lokalnej
  i `_maxDisp`) — przekrój bryły z pasem jest dla broni zwykłym ciałem płaskim w świecie: `bandSweep` (odcinek — jak
  `sweepLocal2D`), `bandProbe` (sonda), `bandCapsule` (kandydaci kapsuły, posortowani wzdłuż toru), `bandCircle`,
  `latticeWindow3D` (okno siatki ciała w 3D). Indeks żyje na ciele (`body._band`) do zmiany pozy, nowego kroku ciała
  obudzonego albo zmiany geometrii; trafienia w tym samym kroku tylko gaszą węzły (odczyt sprawdza `active`). W kolumnie
  węzłów nad jednym XY wygrywa węzeł najbliżej płaszczyzny (najmniejsze |z|) — sweep i sonda biorą ten sam.
- **HullBodies** — każde zapytanie broni przyjmuje bryłę (`hull.solid3D` → gałąź bryły; ciała płaskie bez zmian, wynik
  `z = 0`): `sweep` (`hullSweepResult.z`), `probe`, `impact` — krater w 3D: węzeł pasa najbliżej punktu, `D.applyImpact`
  w punkcie na WYSOKOŚCI węzła (promień i budżet HP jak ciała płaskiego, `craterRadius` = kula w 3D), odrzut blachy
  w 3D (`opts.kick3D` — tylko bryły gry: dema 3D i testy silnika bez zmian), wynik `hullImpactResult.z / solid / latX /
  latY / latZ` (komórki kratownicy szablonu); `cutSegment` — rzaz Hexlance'a = węzły pasa w kapsule wzdłuż toru
  (pionowa płyta przez cały pas), z `push` odłamki wzdłuż toru i impuls w 3D bryły swobodnej (`applySolidCutPush`);
  `surfaceNormal` (gradient zajętości żywych węzłów w kuli w 3D, rzucony na płaszczyznę; strop / dno → false —
  wołający bierze −kierunek lotu), `traceThrough` (przebicia Mjolnira / Valkyrie idą przez przekrój), `nodeWorld` (z),
  `solidLatticeAt(e, x, y, reach, out)` (punkt gry → komórki kratownicy, dla stempli receptur). Odłamki krateru lecą
  z wysokością (`hullDebris3D.spawn(…, z, vz)`), bez nowej ścieżki w grze: pętla pocisków, wiązki, Hexlance, PD
  i mechanika przebić wołają te same funkcje.
- **Kanały świata** (`worldChannels.js` — kawałek-bryła budowli, np. sektor dysku): orka pocisków `_plowSegment3D`
  (kandydaci z kapsuły pasa, pęd pocisku w XY, zmiana prędkości węzłów do układu ciała pełnym obrotem Rᵀ, obrót ciała
  swobodnego w 3D), wiązka `_heat3D` (plama Gaussa w 3D wokół węzła pasa, ablacja ku strzelcowi), front ciśnienia
  `_blastBody3D` (KULA wokół punktu wybuchu, ∝ 1/d²), ablacja `_ablate3D`. Prawa prędkości w komórkach ODNIESIENIA
  (`refCell` 15 — komórka ciał płaskich świata), nie bryły (45): ten sam wybuch daje ten sam ruch w jednostkach
  świata. Koszt frontu: powłoka kuli odwiedza tylko KLOCKI bryły, które przecina (`solidBricks` — węzły w klockach
  4 × 4 × 4 komórek, środek i promień z pozycji spoczynkowych + √3 · (`_maxDisp` + komórka)), a front kończy się
  tam, gdzie kopnięcie spada poniżej `blastMinKickFrac` (0,25) progu aktywności bryły (solver i tak je wygasza; moc 6 —
  zasięg działania ~0,9 km, moc 1 — ~0,4 km). Bez tego kilometrowe kule rozpadu habitatu kopały co krok wszystkie
  węzły wieży i dysku (39 tys.) o ułamki j/s: 30 wybuchów R 2 km naraz — 5,1 ms na krok brył, teraz 0,8 (Node,
  prawdziwy habitat); ciała płaskie bez zmian (2,3 ms — ta sama droga, bit w bit). `worldBodies`: bryły w orce, wiązce i fali (`_collectSolidBodies`, `stats.solids`),
  punkty budowli dalej z reguł 2D (właściciele wybuchu tylko z kawałków płaskich; bryła w kuli — `solidsInBlast` — też
  uruchamia front); rakiety (`_blastWorldBodies`) i fala rdzenia (`onDetonate`) wchodzą także przy samych bryłach.
- **Rany 3D** (`src/3d/solidWounds.js`): mapa ran sprite'a nie pasuje do bryły, która się przewraca — pole ran
  w KOMÓRKACH kratownicy szablonu (vec4: żar w chwili stempla, czas stempla, osmalenie), slot na ród (`hull.dmgKey` —
  bryła, wrak i odłamy dzielą komórki szablonu), komórki slotu w blokach 4 × 4 × 4, wysyłka zakresami bloków raz na
  klatkę (`SolidWounds.flush` na końcu `syncWorldBodies3D`), stygnięcie wzorem zamkniętym w shaderze
  (`damageCoolHeat` — jak mapa ran, bez kernela). Stemple: kratery i rzazy (hak `onImpact` → `HullDamageMap` →
  `SolidWounds.onImpact`, parametry tabeli STAMP; stempel mniejszy niż komórka — z wagą pola), receptury efektów
  (`stampRecipe` / `stampAt` / `stampKerf` → `solidLatticeAt`), rozdarcia po zgniocie (`HullBodies.onSolidNodeLost`,
  poza bronią; łączone w klatce, sufit na slot). Skóra skin3 (`portBuildings3D.tsl.js`) czyta pole trójliniowo z 8 rogów
  komórki (żar, osmalenie, lakier gaśnie), bez mapy ran sprite'a. Pamięć `WOUND_CAP` 512 Ki komórek (8 MB GPU + kopia
  CPU); habitat (wieża + 8 sektorów dysku) zajmuje ~0,27 mln.
- **Zgodność**: płaskie sceny bit w bit (ślad `destrukcja-taran-sym.mjs` — tryby domyślne i szyja — identyczny poza
  czasem kroku), bryły dem i testów silnika bez zmian (odrzut 3D tylko z `kick3D`).

Testy `tests/beamSolidHits.test.mjs` (pas: trafienie i przelot nad pasem, krater-kula i kolumna, odłamki z wysokością,
rzaz Hexlance'a w płycie, normalna i `traceThrough`, orka kanałów na obróconym kawałku-bryle, kula fali, ciepło
i ablacja, ciała płaskie z = 0, klocki frontu i odcięcie słabej fali) i `tests/solidWounds.test.mjs` (indeks bloków,
stempel — też drobny kaliber mniejszy niż komórka, ród, rozdarcia, WGSL skin3); w grze `node
scripts/webgpu/baza-zniszczenie-gra.mjs --tryb szyja --ostrzal 1 [--bronie id,id] [--serie 24] [--kamery 0]
[--profil 1]` (po osiadaniu wieży: Atlas w wolnym miejscu 3–6 km od niej, serie z lufy 1,8 km w poprzek osi wieży w
punkty jej przekroju z pasem, Hexlance z gniazd Atlasa, Yamato w dysk, Supernowa nad dyskiem; węzły wieży i dysku,
kratery, stemple ran, czasy fizyki i klatek, pipeline'y synchroniczne).

Pomiar w grze (2026-10-15, 1600 × 900, kamera klasyczna; wieża po osiadaniu 12,9 tys. węzłów, w pasie 2,1 tys.,
przekrój 1,37 km; 24 strzały na broń): Yamato — 11 kraterów, 96 węzłów; armata — 13 wgnieceń, 0 węzłów; laser
pulsacyjny — 13 trafień, 0 węzłów (żar i osmalenie); rakiety na punkt — 18 węzłów (fala); Mjolnir — 457 kraterów
rowu, 1312 węzłów (pas wieży 2,0 → 0,9 tys.: przebicia przechodzą przez cały przekrój); Hexlance (1 salwa) — 43
węzły. Yamato w dysk — 0 trafień (pod pasem). Fizyka 0,6–1,8 ms średnio na krok (szczyt 11 ms przy Mjolnirze),
klatki 4–10 ms średnio, jedna klatka > 50 ms (Mjolnir, 66 ms); pipeline'y synchroniczne w szyi i ostrzale — 0.
Supernowa nad dyskiem: 2 klatki 90–150 ms — profil CPU (`--profil 1`): kod trafień brył ≤ 1,5 ms na klatkę (przed
klockami i odcięciem słabej fali sam front na bryłach brał 43 ms w klatce rozpadu habitatu), resztę bierze wypiek
skór kawałków w klatce (`worldBodies3D.stepSkinBake` 39–49 ms po `breakPiece` z progu punktów) i strona GPU efektu.

## Zderzenia

- Filtr par: `isCollidable`, moduły jednego właściciela (poza wrakami), liny holownicze,
  dwa zimne (stare i wolne) wraki. **Wraki zderzają się z rodzicem i rodzeństwem** (odłam leci po fizyce).
- `onContact` → `HullBodies.hasContact(a, b)` (AI ustępuje fizyce, okno 0,1 s) i `CollisionFX`
  (`grind` co krok z punktami szwu, `impact` przy pierwszym zetknięciu).
- Żar (poziom zderzenia = `min(1, zbliżanie / 150)`): biało świeci BRZEG RANY — końce belek
  zerwanych w solverze do 0,12 s po styku (+ pierścień sąsiadów 0,55); zgniatana powierzchnia tylko
  `heatContact` 0,35 (pomarańcz). W skórze żar narożnika = najgorętsza z 4 komórek wokół (bez
  kwadratów pojedynczych komórek). Zanik w shaderze (0,35/s).
- Odłamki: `src/3d/hullDebris3D.js` — pogięte płyty i kształtowniki z dema (`beamDebris3D.js`),
  kolor blachy komórki, światło słońca + maska cienia, jedna pula na grę, początek przy kamerze;
  bez żaru (świecące okruchy heksów czytały się jak „odpryski” shadera). Krater wybija blachę
  wstecz, w stronę strzelca (65%), reszta przelatuje wzdłuż pocisku.
- Naprawa (R): `HullBodies.repair` BEZ solvera — węzły, długości belek i HP zbiegają wprost do
  spoczynku (stała czasowa 0,4 s) z progami domknięcia. Dawne `D.repair` budziło cały kadłub
  (Atlas 4,5 ms/krok) i nie kończyło się (solver i naprawa ciągnęły długości w przeciwne strony).

## Wraki

- Rozpad kadłuba → `onWreck` → encja wraku (pola jak `spawnWreckEntity`, łup za komórkami,
  ładunek frachtowca do jednego wraku) w `window.wrecks`.
- Śmierć NPC → `createWreckage(npc)` → `HullBodies.convertToWreck` (cały kadłub przechodzi na wrak).
  Krytyczny wybuch → `HullBodies.shatter`: rdzeń w odłamki, promieniste rzazy, pchnięcie odłamów.
- Okruch (< `splitMinNodes` węzłów) idzie w odłamki i znika. Budżet: 600 tys. węzłów wraków.
- Sen wraku: `HullBodies.sleep` / `wake`. Zimne wraki (etap 3, 2026-10-11): migawka ciała względem szablonu
  kadłuba (`src/game/hullColdSnapshot.js`), ciało zwalniane, w kadrze ciało do rysowania z migawki —
  `docs/BRIEF-zimne-wraki.md` § 11.

## Czego jeszcze nie ma (kolejne etapy)

3. ~~Zimne wraki na belkach~~ — **zrobione 2026-10-11** (`docs/BRIEF-zimne-wraki.md` § 11). Zostaje: LOD wraków
   gorących i śpiących w renderze (dziś pełna ścieżka skóry), dym / ogniska wraków (decyzja usera — wypięte).
4. ~~Mostki~~ — **zrobione 2026-10-05**: logika na komórkach siatki belek (`src/game/shipBridgeBeams.js`, backend
   stanu dla funkcji `shipBridge.js`), model 3D z wyrwami po komórkach, efekty agonii na pulach WebGPU, demo
   `dema/mostki-webgpu.html` — `docs/PORT-mostki.md` § 9.
5. Rdzenie — wersja na belkach GOTOWA w demie (2026-09-30): logika `src/game/reactorCore.js`, wybuch
   WebGPU `src/3d/reactorBlast/`, `dema/rdzen-webgpu.html`; kroki wpięcia: `docs/webgpu/DEMO-RDZEN.md` § 7.
   Stare `shipCore` / `coreFx3D` (heksy) zostają dla dema heksowego.
6. ~~Reszta~~ — panel destruktora usunięty (etap 8), radar i CIC czytają tylko `beamHull`, PerfHUD bez areny
   heksów i bez „Deformacji”.
7. Asteroidy na belkach (materiał kruchy). Do tego czasu statek bez `hexGrid` ma z heksową
   asteroidą kolizję KOŁOWĄ (`asteroidField3D`), bez zgniotu.
8. ~~Usunięcie starego silnika z gry~~ — **zrobione 2026-10-11**, § „Etap 8” niżej. Pliki silnika, dema heksowe
   i ich testy usunięte 2026-10-19 (§ „Etap 9”).

Wydajność (zmierzone 2026-09-25, headless, bez profilera — sam start profilera CDP pauzuje
stronę na ~0,5 s i fałszuje pomiar klatek; skrypty były w scratchpadzie sesji):

| scenariusz (krok kadłubów) | 7,5 px | 15 px |
|---|---|---|
| taran pancernika 500 j./s: mediana / p95 / maks | 0,8 / 2,8 / 7 ms | 0,08 / 0,8 / 1,1 ms |
| gracz trzyma W w pancernik: 1. s / dalej / po puszczeniu | 3,0 / 2,7 / 2,3 ms | 0,7 / 0,14 / 0,13 ms |
| bitwa 10 okrętów: mediana / p95 | 0,05 / 0,8 ms | 0,06 / 0,25 ms |

Skoki klatek wokół kolizji, których silnik belek NIE powodował (były przed portem):
- ROZGRZANE 2026-09-26 (`tests/shaderPrewarm.test.mjs`): pierwsza kolizja w sesji ~50 ms
  (`overlayFx`: passy kompozytora `overlay3D` + materiał iskier), pierwszy Yamato 140–200 ms,
  pierwsza tarcza-obrys ~200 ms; rail / armata / działko i tarcze kompilowały się OD NOWA po
  każdej przerwie (dispose ostatniego materiału niszczy program three). Teraz `overlay3D.prewarm`
  (start overlaya, 23 programy, ~0,5 s w headless) i `prewarmShields3D` (ekran ładowania) z
  materiałami-trzymaczami — żaden efekt ani wróg nie kompiluje programu w grze.
- pierwsze pojawienie się wroga danego typu (po rozgrzewce): ~25–40 ms = budowa konstrukcji
  kadłuba w `drawNPCPretty` + skóra i cień SDF nowego kadłuba (bez kompilacji shaderów);
- pierwsze sekundy gry: `Core3D._pumpTextureUpload` wgrywa tekstury planet 8192×4096 po jednej
  w wolnej chwili — w headless 160–435 ms na teksturę (osobne zadanie, poza pętlą gry).
- Rozpady dużych kadłubów (`findBeamBridgesStore` + `findIslands` po całym grafie) → spójność przyrostowa.
- Biała plama na dziobie niszczyciela to REFLEKTOR (światło drogowe z edytora), nie lakier ani żar.

## Etap 8: gra bez heksowego destruktora (2026-10-11)

Graf importów gry (`scripts/webgpu/grafGry.mjs` od `index.html`) nie zawiera już `destructor.js` (242 KB),
`destructorGpuSoftBody.js`, `hexArenaBridge.js`, `hexContactGrid.js`, `shipCore.js` (rdzeń heksowy) ani panelu
`destructorConfigPanel.js` (usunięty — nie miał innego konsumenta). Co z nich gra naprawdę potrzebowała, leży
w małych modułach bez silnika:

| Moduł | Co | Kto czyta w grze |
|---|---|---|
| `src/game/destructorConfig.js` | `DESTRUCTOR_CONFIG` (dane), `shardHeatNow`, `addShardHeat`, `getHexProbeDrift` | `bridge3D.js` (zanik żaru i szczyt rany modelu mostka), `hexShips3D.js` (uniformy żaru heksów) |
| `src/game/hexBodyHooks.js` | haki `refreshHexBodyCache`, `isPackedShardBoundary`, `getHexArenaStats` — wpisuje je destructor.js przy imporcie | `hexShips3D.js` (ścieżka heksowa renderu dem; w grze null — bytów z `hexGrid` nie ma) |
| `src/game/hexGridSpace.js` | przestrzeń siatki heksowej: `gridToLocal`, `localToWorld`, `worldToLocal`, kąt i skala encji | `reactor3D.js` (stany z `coreModel.js`) |

destructor.js re-eksportuje te same nazwy (dema i testy importują po staremu), shipCore.js — przestrzeń siatki;
coldWrecks.js dostaje zrzut / odtworzenie siatki heksów w opcjach (`options.hexBody`; gra go nie podaje — nic nie
zamarza po heksowemu, `recycle` podaje gra: `recycleWreckEntity`). Z gry usunięte: oba importy destruktora
w `index.html`, `window.DestructorSystem` / `initHexBody` / `DESTRUCTOR_CONFIG`, `DestructorSystem.update`
w `physicsStep` i `updateVisuals` co klatkę, gałęzie heksowe trafień (sweep pocisku, sonda pod tarczą, raymarch
wiązki z `findBeamHexShard`, szybka ścieżka PD `pdBeamFastPath.js`), wrak z listy heksów w `createWreckage`,
cięcie i recykling wraków heksowych, budżet areny heksów dla wraków (zostaje sufit węzłów belek
`enforceWreckBeamBudget`), diagnostyka bramek kolizji heksów (`ColBoundsDbg`), wiersze PerfHUD „HexArena”
i „Deformacja” z przyciskami COL. Hexlance (`superweapon.js`) tnie dalej — dawniej cała pętla cięcia stała
za `window.DestructorSystem` (bez tej poprawki superbroń przestałaby ciąć). Budżet budowy kadłubów NPC na
klatkę: `HULL_INIT_FRAME_BUDGET_MS` (dawniej `HEX_INIT_*`). Testy wiązek (`tests/helpers/beamShotHarness.mjs`,
`pdBeamFastPath`, `weaponFeelParity`) strzelają w kadłuby na belkach (`makeHullTarget`).

Zmierzone przed usunięciem (prawdziwa gra w headless Chrome, ta sama praca co stara klatka: `updateVisuals`
z pustą listą): **~2 µs CPU na klatkę**; `update` nie szedł wcale (lista heksów zawsze pusta). Prawdziwy koszt
był gdzie indziej: pierwsze `updateVisuals` budziło solver sprężyn (`DestructorGpuSoftBody._ensureInit`), który
w KAŻDEJ grze tworzył **drugie `GPUDevice`** (osobne od Core3D) z pipeline'em compute — do niczego. Do tego
~360 KB źródeł mniej do wczytania i sparsowania przy starcie.

Zostaje do sprzątnięcia (martwe, ale już bez silnika): `spawnFlyingHexDebris` / `drawFlyingHexDebris`
i drobne testy `hexGrid` w `index.html`; ścieżka heksowa `hexShips3D.js` (potrzebna demom); gałęzie `hexGrid`
w `towSystem.js`, `salvage.js`, `shipBridgeRuntime.js` (korzystają z nich destructor.js i dema heksowe).
— **sprzątnięte w etapie 9.**

## Etap 9: silnik heksów usunięty z repo (2026-10-19)

Na prośbę użytkownika usunięte w całości: silnik heksów (`destructor.js`, `destructor3D.js`, `destructorGpuSoftBody*.js`,
`hexArenaBridge.js`, `hexContactGrid.js`, `shipCore.js`, `destructorConfig.js`, `hexBodyHooks.js`, `hexGridSpace.js`),
żar rdzeni dem heksowych (`coreFx3D.js` z grafem TSL), dema heksowe (`mostki-demo`, `rdzen-demo` z narzędziami pomiarów
i zrzutów, zepsute już `asteroidy.html`), rusztowanie workera fizyki v2 (`src/physics/`, `src/benchmark/`,
`?workerPhysicsV2`, `npm run benchmark:100k`) i ich testy. Przed usunięciem przeniesione: edytor stref mostka do dema
belkowego (`dema/mostki-webgpu.html` — klawisz E albo `?edit=1`, eksport do `BRIDGE_LAYOUT_PROPOSALS`; harness
`scripts/webgpu/mostki-webgpu.mjs --tryb edytor`), testy TODO rdzeni edytora (`tests/reactorEditorCores.test.mjs`),
ogólne testy zimnych wraków (`tests/coldWrecks.test.mjs`), iskier szwu (`tests/collisionSparks.test.mjs`), ustępowania
AI przy styku kadłubów i ścieżek trafień (`tests/hullHitPaths.test.mjs`) — teraz na kadłubach belkowych.
`segmentCircleToi` (pocisk kontra cel kołowy) mieszka w `src/game/projectileTrajectory.js`.

Heksowe połówki modułów wspólnych zniknęły: siatka heksów, płyta pancerza LOD i pula szczątków GPU w `hexShips3D.js` /
`hexShips3D.tsl.js` (zostały warianty `beam`, `beamBatch`, `cloakDist`), latające heksy i gałęzie `hexGrid` w `index.html`,
wersja heksowa mostków (`shipBridge.js`, `shipBridgeRuntime.js`, `bridge3D*.js`, `bridgeFx3D.js` — model mostka bit w bit
jak przed), zrzuty heksów w `coldWrecks.js` (tylko migawki belek), `isAsteroidHex` (radar, łup, migawka renderu), obrys
tarczy z heksów (`shieldSystem.js` — kadłub na belkach albo jawny `entity.shieldOutline` dla dem), pieczenie cienia SDF
z heksów (`hullShadowSdf.js` — siatka komórek), zapas renderu do smugi zimnego wraku (`captureColdWreckImpostor` — liczy ją
gra, `coldWreckView.js`), `covers()` modelu reaktora (jedynym odbiorcą był `coreFx3D.js`); `reactor3D.js` wymaga ramy
rdzenia `frameOf` (`reactorCoreFrame`). Strażnik: `tests/graBezHeksow.test.mjs` (graf gry bez plików silnika heksów
i `src/physics/`, kod gry bez heksowych pól i API).

Zostaje celowo — nazwy z czasów heksów, bez heksowej logiki: `hexShips3D.js`, `HexBodyImpostorBatch`, `destructorBeams3D.js`,
`hideHexVisual`, `applyHexImpact` (argument `shard` zawsze `null`), jednostka strojenia `HEX_PITCH_PX` / `hexPerNode`,
`liveHexes` w streszczeniu zimnego wraku, `isAsteroidHex: false` w obiekcie wraku `hullBodies.js` (wyjątek strażnika).

## Testy i narzędzia

- `tests/hullBodies.test.mjs` — układy, sweep, krater, taran i zdarzenia, filtr par, śmierć, okruchy, łup, wybuch reaktora.
- `tests/destrukcjaTaran.test.mjs` — prawo kontaktu v2 na prawdziwym habitacie (60 i 120 Hz): pierścień trzyma 1500 j/s,
  szarża go zrywa, muśnięcie, wycofanie, niszczyciel bez porwania, scenariusz szyi.
- `node scripts/destrukcja-taran-sym.mjs [--tryb kotwice,czolo,pchanie,musniecie,wycof,statek,szyja] [--dt 60,120]
  [--v …] [--set klucz=wartość,…] [--ciag 1100]` — taran w Node na prawdziwym HullBodies + worldBodies (przed / po).
- `tests/beamGameHooks.test.mjs` — haki silnika, krater, zapytania 2D, UV skóry, cień z komórek.
- `node scripts/dym-gry-belki.mjs [--scen taran|bitwa|oba] [--s 30]` — prawdziwa gra w headless
  Chrome: kadłuby, kratery, taran, bitwa, próbki kroku, zrzuty.
