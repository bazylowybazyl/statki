# Budowle portowe (Z7) — stocznia z rojem dronów, hangar postojowy, boje redy

Stan 2026-09-27: **moduły i demo gotowe, w grze NIC nie jest wpięte.** Wpięcie w ringi (Ziemia,
Mars, Jowisz) dopiero po uzgodnieniu z użytkownikiem (Z6 zrobione); megadoki planet bez ringu — Z8.
Plan całości: `docs/PLAN-ruch-v2-w-grze.md` (§ 1.4, § 2, § 3.3).

Stocznia przerobiona 2026-09-27 wg szkicu użytkownika (pierwsza wersja — pochylnie z dwiema
suwnicami, żuraw, hala prefabrykacji i suchy dok — odrzucona): taśma z kontenerami wzdłuż ringu
i trzonem do piasty, dwie pochylnie po bokach trzonu, **kadłub buduje rój dronów**, na pochylni
**jeden dźwig** (dwa mijałyby się; dźwig tylko przenosi ciężkie bloki), piasta z placami postoju
i refitu — **Ziemia: okrąg z wypustkami, inne frakcje: litera U** (stocznie frakcji się różnią).

## Pliki (`src/3d/portBuildings/`)

| plik | co | Three |
|---|---|---|
| `portBuildingStyle.js` | hak stylu per planeta: `resolvePortBuildingStyle(klucz \| profil \| profile.port \| styl megadoku)` → rodzina `k7` / `vault` / `radiator`, paleta K-7, emisja HDR, barwy i rytm boi, `shipyardHub` (`radial` Ziemia / `u` inni) | nie |
| `portShipyardLayout.js` | układ stoczni: galeria z taśmą wzdłuż ringu, trzon, pochylnie (`SHIPYARD_MODEL.slots`, po dwie strony), dźwig, stacja taśmy, stojak dronów, piasta (okrąg / U) z placami K-7, składy refitu; etapy budowy kadłuba; `slipStatesFromYard(yard)` z rejestru `shipyards.js` | nie |
| `portShipyardSwarm.js` | rój dronów (rekordy `CARGO_DRONE` Z5), taśma i stacje (kontenery), cykl dźwigu, drony refitu; `pushShipyardSwarm` → `CargoContainers3D` / `CargoDrones3D` | nie |
| `portHangarLayout.js` | układ hangaru: bębny z kołyskami (dok bębnowy B-5), zatoka ciężka (windy capital/mega), bramy IN/OUT, pas kolejki; `planHangarCapacity(n)` | nie |
| `portBuoyLayout.js` | boje z planu redy `buildPortParking` (Z2): narożniki, brzegi, końce rzędów; `buoyFlash` = lustro shadera | nie |
| `portModuleTraffic.js` | ramki (`portModuleFrame`, `portRingModuleFrame`), przejście układ ↔ gra, adapter do formatu `buildStationDocks`, świat kolizji (`K7CollisionWorld`), `portModuleCargoPose` (poza dla Z5) | nie |
| `portBuildingScene.js` | budowa scen jako dane instancji (rejestrator jak `haloPortK7Build.js`): zestawy BG / FG / dach, grupy ruchome, kanały efektów | nie |
| `portBuildings3D.js` | render: `PortShipyard3D` (+ `pushCargo`), `PortHangar3D` (wspólny shader, dwa modele światła) | tak |
| `portHullBuild3D.js` | kadłub w budowie na pochylni (sprite okrętu z maską etapów + iskry spawania) | tak |
| `portBuoys3D.js` | `PortBuoys3D`: pływaki (BG) i błyski (FG), co klatkę tylko boje w kadrze | tak |

Demo: `dema/budowle-portowe.html` (+ `.js`, zrzuty `node dema/budowle-portowe-shots.js [katalog]`).
Testy: `tests/portBuildings.test.mjs`.

**Suchy dok piratów (2026-10-05, misja 1 — W GRZE):** ta sama podstawa (rejestrator, shader, `PortBuilding3D`), pliki
`pirateDryDockLayout.js` (układ wg szkicu użytkownika i poprawki tego dnia: trzon, zamknięty parking z 10 okrętami burta
w burtę, cienkimi bramami taranowymi i masztami reflektorów, hala jak K-7 wpięta w trzon, brama od kosmosu; bez suwnic),
`pirateDryDockScene.js` (bryły; kawałki = grupy), `pirateDryDock3D.js` (render: alarm, wylot, dach, lampki stanowisk,
`breakChunk` / `ramChunk` / `hideChunk`, reflektory w siatce świateł `pushGridLights`, pochylnie z `PortHullBuild3D`),
`pirateDryDockChunks.js` (bryły kawałków → trójkąty / rzut z góry dla silnika zniszczeń), styl `PIRATE_PORT_STYLE`
(`resolvePortBuildingStyle('pirate')` — jak sprite'y „Iron Skull”, bez czaszek). Demo `dema/suchy-dok-piratow.html`, opis
w AGENTS.md § „Suchy dok piratów”. Zmiany wspólnego kodu budowli: tryb efektu `PB_FX.alarm` (9 — kogut przy kanale ≥ 0,5),
GRUPA UKRYTA (macierz grupy z `elements[15] = 0` — cała grupa poza bryłą obcinania; tak schowa się statyczny odpowiednik
kawałka, gdy przejmie go ciało silnika zniszczeń) i STOŻEK (`PortRecorder.cone`, geometria 8-boczna — kolce; płaski
stożek = ośmiokątna rama włazu).

## Układ lokalny i stanowiska

Jak hub K-7 (`haloPortK7Layout.js`): x wzdłuż (ringu albo lica megadoku), z na zewnątrz
(tył budowli na podłodze habitatu / przy korpusie stacji, przód w kosmos), y = wysokość nad
pokładem w konwencji K-7 (`k7HeightToZ`: płaszczyzna gry y = 116 = z świata 0, nad nią ×0,42).
Na ringu tył = `K7_PLACEMENT.backZ` (250, płyta portu), na megadoku `backZ: 0`.

Stocznia (`createShipyardLayout({ id, slips = 2, hub, backZ, rootDepth })`, 6,9 × 10,1 tys. j.
okrąg / 6,9 × 9,5 tys. j. U):
- galeria (300 j.) wzdłuż ringu: dwa podajniki taśmy z głowic na końcach schodzą się na
  obrotnicy przy trzonie; trzon 900 j. z taśmą pośrodku do rdzenia piasty / terminalu U; korzeń
  1650 j. (na ringu przechodzi przez wąwóz habitatu), kołnierz wpięcia = dwa słupy (przeszkody);
- pochylnia 1300 × 1900: łoże 1500 × 700 (max 1250 × 500 — nosiciel), szyny dźwigu na dłuższych
  krawędziach, stojak roju (24 miejsca), wieże narożne; stacja taśmy na krawędzi trzonu (3 windy
  modułów + miejsce bloku dźwigu); zejście dziobem ku piaście;
- piasta okrąg (Ziemia): tarcza R 1500, rdzeń R 380 (terminal taśmy, gniazdo dronów, wieża),
  4 place M przy rdzeniu, wypustki: capital (Atlas 1800 × 806, refit) na 0°, L na ±60°,
  nosiciel na ±120°, dwa składy refitu przy trzonie;
- piasta U (inne frakcje): belka z terminalem, dwa ramiona 5000 j., otwarty basen z placami na
  kratownicach (2 × capital przy belce, 4 × L przy ramionach), 8 × M na zewnątrz ramion.

Stanowiska w formacie K-7 (`id, size, kind, x, z, angle, width/length, padLength/padBeam,
maxLength/maxBeam, capture, approach|launch, stopPoint, lane, occupied, reserved, serviceAnchors`):

- pochylnia: `size 'SLIP'`, `kind 'slip'`, dziób ku piaście (+π/2); nie cumuje się na niej —
  adapter daje ją w `yards` (poza, kurs, punkt zejścia). Pas zejścia wolny od brył (test);
- plac piasty: `kind 'pad'`, dowolny kurs (dziób do środka piasty / ku ramieniu U), obrys pola
  `shipyardPadPoly(b)` (obrócony), `width/length` = obwiednia osiowa; adapter daje dok
  `shipyard-pads` z rolą **`military`** (okręt po produkcji czeka na przydział floty) i
  `service: 'refit'`; `role: PORT_SERVICE_ROLE` robi z placów wyłącznie remont;
- hangar: `hangar-in` (punkt przechwytu POD DACHEM za bramą IN) i `hangar-out` (punkt
  pojawienia się za bramą OUT) — adapter daje `hangars[0] = { x, y, capacity, entry, exit, queue }`;
  do redy: `buildPortParking(layout, stacja, { hangar: { x, y, capacity } })`.

Bryły (`shipyardSolidList` / `hangarSolidList`, jak `baySolidList`) są wspólne dla renderu i
kolizji; `buildPortModuleCollision(layout)` robi z nich `K7CollisionWorld`. Przeszkody stoczni:
kołnierz, wieże pochylni, rdzeń / terminal i bloki U, wieże serwisowe placów; pokłady (trzon,
pochylnie, tarcza, wypustki) leżą pod płaszczyzną gry. Dźwigi jeżdżą nad nią (FG, poza listą).

## Rój, taśma, dźwig (`portShipyardSwarm.js`)

- Pozy liczone z czasu (bez stanu poza numerami cykli wejścia / zejścia z roju): dron ma stały
  okres (~38 s), cykl: przelot nad stację taśmy → chwyt modułu → przelot nad czoło budowy →
  odłożenie (moduł wtapia się w poszycie) → praca przy czole. Liczba dronów w roju wg etapu
  (stępka 8, wręgi 14, poszycie 20, wyposażenie 12) + spawacze nad czołem. Wejście do roju od
  następnego cyklu drona (start ze stojaka), zejście: dron kończy cykl i wraca na stojak —
  bez przeskoków (test ciągłości).
- Taśma: dwa podajniki, kontener wyjeżdża windą na początku, zjeżdża windą przed terminalem;
  stacja: skrzynia znika z chwytem drona i po chwili wyjeżdża nowa.
- Dźwig (jeden na pochylnię): stacja taśmy (wysięgnik nad trzonem) → czoło budowy z blokiem
  (reaktor, łoże uzbrojenia, silnik, podtrzymanie życia) → odłożenie → powrót (okres 48 s).
- Refit: drony ze składu przy rdzeniu kursują do statku na placu (`state.refit`).
- Rysowanie przez Z5 (bez nowych renderów): gospodarz woła po `begin()` renderów
  `yard.pushCargo(CargoContainers3D, CargoDrones3D, portModuleCargoPose(ramka ruchu, stacja))`;
  rekordy w układzie budowli (u = x, v = z). Wysokość cienia (`setDeckZ`) per skrzynia / dron:
  taśma, stacja, kadłub, pokład.

## Render (AGENTS.md)

- Bez renderera: obiekty do sceny gospodarza (`Core3D.scene` albo grupa ringu), `setLayers(1, 2)`:
  BG pod statkami (galeria, trzon, taśma, pochylnie, tarcza, place), FG nad nimi (dźwigi, wieże,
  kołnierz, rdzeń piasty, terminal i bloki U, dach hangaru). Kontenery i drony: warstwa 0 (świat,
  paralaksa Z5), światła dronów FG.
- Precyzja float32: dane instancji względem korzenia budowli, korzeń w `root.matrix` (układ →
  scena gospodarza; three składa `modelViewMatrix` w double). Boje: dane co klatkę względem
  `sceneOriginNearCamera`; kontenery i drony — początek Z5 przy kamerze.
- Światło: `light: 'space'` (megadok, demo) — słońce gry z wysokością 49° (`setSun({ sun, at })`),
  cień planety od gospodarza (`visibility`) × maska cieni Core3D (`sunVisibility`/`sunFill`);
  `light: 'halo'` + `haloUniforms` (uniformy ringu) — model ringu jak hala K-7 (`haloSunVisibility`,
  światło planety). Programy obu trybów kompilują się bez błędów (demo: `__port.checkHaloShaders()`).
- Emisja w paśmie 0,9–1,4 (paleta profilu), iskry spawania i rdzenie boi drobne, do ~6. Światła
  biegnące taśmy (impuls z prędkością taśmy) są drobnymi punktami, nie pasem.
- Płyty nachodzące (trzon na tarczę / belkę, wypustki, ramiona U) mają wierzch 3 j. niżej —
  przy near = 100 kamery BG rozdzielczość głębi przy zoomie 0,07 to ~0,4 j.
- Szkielet kadłuba (stępka, wręgi) ma szerokość linii ≥ ~½ px — nie znika z daleka.
- Draw calle: stocznia 7 (+ Z5: 2 na wszystkie kontenery i drony), hangar ≤ 10, boje 2. Zero
  alokacji na klatkę w `update` i w kroku roju (~0,05 ms na stocznię).

Stan na klatkę (`update(dt, state)`):
- stocznia: `slips` = `slipStatesFromYard(yard)` (kadłub rośnie przez czas budowy klasy),
  `launch[i]` (światła pasa zejścia), `pads: { [id]: 1 zajęty | 2 refit }` (lampy placów, flagi
  bitowe kanałów), `refit: [{ pad, length, beam, work }]`, `belt` (false = stoi), `daylight`;
- hangar: `fill[]` (zajętość bębnów), `events: [{ drum, dir }]` (obrót o gniazdo przy
  przyjęciu / wydaniu), `queue` (liczba w kolejce), `gateIn` (0 stój / 1 wlot), `gateOut`, `heavy`.

## Wpięcie — faza 2 (po uzgodnieniu)

Ring (pułapki systemu miejsc — lista z zadania Z7):
- `HALO_PORT_RECTS = 5` (4 zajęte, 1 wolny) w `haloRingUniforms.js` i tablice GLSL
  `uPortRects[5]` / `uPortZones[5]` + pętle `i < 5` w `haloRingGLSL.js` — zmieniać razem;
  szablon miejsc powtarza się na KAŻDY kompleks (`haloPortTemplate`) — budowla tylko przy jednym
  kompleksie wymaga osobnej listy; tranzyt musi zostać ostatnim prostokątem;
- do zmiany też: `haloPortBays.js:156`, `haloRingRoofPlan.js:321-339`, `haloRing/index.js:111-135`,
  `createPortRegistry`/`buildPortCollision` (`haloPortDocking.js`), `haloRingCollision.js:143-151`,
  `haloRingGame.js:83-84`, `haloPortTraffic.js`, test `tests/haloPortK7.test.mjs:156`;
- wolna podłoga: ~18,7 tys. j. łuku między zatoką a tranzytem po obu stronach kompleksu (Ziemia),
  ~12 tys. (Mars). Stocznia ma 6,9 tys. j. szerokości (galeria taśmy), hangar 300 miejsc w jednym
  rzędzie 12,6 × 5,6 tys.;
- taśma galerii ma w grze ciągnąć się dalej wzdłuż ringu (od zatok / K-7) — w demie kończy się
  głowicami podajników; teren podłogi pod galerią musi być spłaszczony (prostokąt miejsca);
- krzywizna podłogi: szeroka budowla to cięciwa — pod końcami podłoga opada o x²/2R (galeria
  6,9 tys. j.: ~140 j., hangar 12,6 tys. j.: ~470 j.) — tył trzeba wpuścić do podłogi jak kołnierz
  K-7 (`toFloor` w `buildHabitatPlug`);
- render: korzeń jako dziecko grupy ringu, ramka `portRingModuleFrame(layout, θ)` (bez obrotu
  grupy), `light: 'halo'`, `haloUniforms: ring.uniforms`; ruch i kolizje: ramka z obrotem
  (`haloRingRotation`), jak `buildHaloPortTrafficLayout`; poza Z5: `portModuleCargoPose` z ramki
  z obrotem.

Megadok (Z8): `portModuleFrame(x, y, kąt)` wokół stacji, gospodarz = grupa w środku stacji,
styl megadoku jako obiekt w kształcie `profile.port` (+ `buildings: { family, walls, buoy,
shipyardHub }`).

## Do decyzji użytkownika

1. Rozmiar hangaru: pojemność robią poziomy bębnów (niewidoczne), ale szerokość rośnie z liczbą
   bębnów — Saturn (472) = 5 bębnów w 2 rzędach 9,9 × 8,6 tys. j.
2. Pochylnia jest pod nosiciela, więc fregata (192 × 144) wygląda na niej na zgubioną — czy
   stocznie mają mieć osobne małe pochylnie (ekonomia ma dziś 2 miejsca budowy bez klasy).
3. Place piasty: dziś postój floty po produkcji (rola `military`) z refitem — kto przydziela refit
   (gracz / Atlas — Z10, naprawy floty po wojnie) i ile placów ma dostać każda frakcja.
4. Gdzie na ringu: stocznia i hangar po dwóch stronach kompleksu wymagają ≥ 6 prostokątów miejsc.
