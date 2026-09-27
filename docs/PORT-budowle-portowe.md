# Budowle portowe (Z7) — stocznia, suchy dok, hangar postojowy, boje redy

Stan 2026-09-27: **moduły i demo gotowe, w grze NIC nie jest wpięte.** Wpięcie w ringi (Ziemia,
Mars, Jowisz) dopiero po Z6 i po uzgodnieniu z użytkownikiem; megadoki planet bez ringu — Z8.
Plan całości: `docs/PLAN-ruch-v2-w-grze.md` (§ 1.4, § 2, § 3.3).

## Pliki (`src/3d/portBuildings/`)

| plik | co | Three |
|---|---|---|
| `portBuildingStyle.js` | hak stylu per planeta: `resolvePortBuildingStyle(klucz \| profil \| profile.port \| styl megadoku)` → rodzina `k7` / `vault` / `radiator`, paleta K-7, emisja HDR, barwy i rytm boi | nie |
| `portShipyardLayout.js` | układ stoczni: 2 pochylnie (`SHIPYARD_MODEL.slots`), suwnice, żuraw, hala prefabrykacji, suchy dok pod Atlasa; etapy budowy kadłuba; `slipStatesFromYard(yard)` z rejestru `shipyards.js` | nie |
| `portHangarLayout.js` | układ hangaru: bębny z kołyskami (dok bębnowy B-5), zatoka ciężka (windy capital/mega), bramy IN/OUT, pas kolejki; `planHangarCapacity(n)` | nie |
| `portBuoyLayout.js` | boje z planu redy `buildPortParking` (Z2): narożniki, brzegi, końce rzędów; `buoyFlash` = lustro shadera | nie |
| `portModuleTraffic.js` | ramki (`portModuleFrame`, `portRingModuleFrame`), przejście układ ↔ gra, adapter do formatu `buildStationDocks`, świat kolizji (`K7CollisionWorld`) | nie |
| `portBuildingScene.js` | budowa scen jako dane instancji (rejestrator jak `haloPortK7Build.js`): zestawy BG / FG / dach, grupy ruchome, kanały efektów | nie |
| `portBuildings3D.js` | render: `PortShipyard3D`, `PortHangar3D` (wspólny shader, dwa modele światła) | tak |
| `portHullBuild3D.js` | kadłub w budowie na pochylni (sprite okrętu z maską etapów + iskry spawania) | tak |
| `portBuoys3D.js` | `PortBuoys3D`: pływaki (BG) i błyski (FG), co klatkę tylko boje w kadrze | tak |

Demo: `dema/budowle-portowe.html` (+ `.js`, zrzuty `node dema/budowle-portowe-shots.js [katalog]`).
Testy: `tests/portBuildings.test.mjs`.

## Układ lokalny i stanowiska

Jak hub K-7 (`haloPortK7Layout.js`): x wzdłuż (ringu albo lica megadoku), z na zewnątrz
(tył budowli na podłodze habitatu / przy korpusie stacji, przód w kosmos), y = wysokość nad
pokładem w konwencji K-7 (`k7HeightToZ`: płaszczyzna gry y = 116 = z świata 0, nad nią ×0,42).
Na ringu tył = `K7_PLACEMENT.backZ` (250, płyta portu), na megadoku `backZ: 0`.

Stanowiska w formacie K-7 (`id, size, kind, x, z, angle, width/length, padLength/padBeam,
maxLength/maxBeam, capture, approach|launch, stopPoint, lane, occupied, reserved, serviceAnchors`):

- pochylnia: `size 'SLIP'`, `kind 'slip'`, dziób w kosmos (+π/2), pole 1500 × 640, mieści
  nosiciela (1080 × 384); nie dokuje się na niej — adapter daje ją w `yards` (poza, kurs, punkt
  zejścia). Okręt schodzi dziobem prosto przed siebie (pas wolny od brył — test);
- suchy dok: `size 'CAPITAL'`, `kind 'drydock'`, pole capital K-7 (2380 × 1330, max 2050 × 1030 —
  Atlas 1800 × 806), dziób do ściany tylnej, wyjazd tyłem; rola ruchu **`service`** — `findBerth`
  z rolą `civil` / `military` go nie wybiera, `placeFleetStock` też nie (remont przydziela gracz
  albo przyszły dyspozytor napraw);
- hangar: `hangar-in` (punkt przechwytu POD DACHEM za bramą IN) i `hangar-out` (punkt
  pojawienia się za bramą OUT) — adapter daje `hangars[0] = { x, y, capacity, entry, exit, queue }`;
  do redy: `buildPortParking(layout, stacja, { hangar: { x, y, capacity } })`.

Bryły (`shipyardSolidList` / `hangarSolidList`, jak `baySolidList`) są wspólne dla renderu i
kolizji; `buildPortModuleCollision(layout)` robi z nich `K7CollisionWorld`, skrzydła drzwi
suchego doku to przedmioty ruchome (`setPortModuleDoorsOpen(col, true)`).

## Render (AGENTS.md)

- Bez renderera: obiekty do sceny gospodarza (`Core3D.scene` albo grupa ringu), `setLayers(1, 2)`:
  BG pod statkami (pokład, łoża, ściany, rusztowania), FG nad nimi (mosty suwnic, żuraw, ramiona,
  nadproża, dach hangaru), dach suchego doku w FG z zanikiem (`drydock.roofFade`, jak dach K-7).
- Precyzja float32: dane instancji względem korzenia budowli, korzeń w `root.matrix` (układ →
  scena gospodarza; three składa `modelViewMatrix` w double). Boje: dane co klatkę względem
  `sceneOriginNearCamera`.
- Światło: `light: 'space'` (megadok, demo) — słońce gry z wysokością 49° (`setSun({ sun, at })`),
  cień planety od gospodarza (`visibility`) × maska cieni Core3D (`sunVisibility`/`sunFill`);
  `light: 'halo'` + `haloUniforms` (uniformy ringu) — model ringu jak hala K-7 (`haloSunVisibility`,
  światło planety). Programy obu trybów kompilują się bez błędów (demo: `__port.checkHaloShaders()`).
- Emisja w paśmie 0,9–1,4 (paleta profilu), iskry spawania i rdzenie boi drobne, do ~6.
- Draw calle: stocznia ≤ 16 (typowo ~11), hangar ≤ 10, boje 2. Zero alokacji na klatkę w `update`.

Stan na klatkę (`update(dt, state)`):
- stocznia: `slips` = `slipStatesFromYard(yard)` (kadłub rośnie przez czas budowy klasy),
  `launch[i]` (światła pasa zejścia), `drydock: { doors, work, roofFade, service }`, `daylight`;
- hangar: `fill[]` (zajętość bębnów), `events: [{ drum, dir }]` (obrót o gniazdo przy
  przyjęciu / wydaniu), `queue` (liczba w kolejce), `gateIn` (0 stój / 1 wlot), `gateOut`, `heavy`.

## Wpięcie — faza 2 (po Z6, po uzgodnieniu)

Ring (pułapki systemu miejsc — lista z zadania Z7):
- `HALO_PORT_RECTS = 5` (4 zajęte, 1 wolny) w `haloRingUniforms.js` i tablice GLSL
  `uPortRects[5]` / `uPortZones[5]` + pętle `i < 5` w `haloRingGLSL.js` — zmieniać razem;
  szablon miejsc powtarza się na KAŻDY kompleks (`haloPortTemplate`) — budowla tylko przy jednym
  kompleksie wymaga osobnej listy; tranzyt musi zostać ostatnim prostokątem;
- do zmiany też: `haloPortBays.js:156`, `haloRingRoofPlan.js:321-339`, `haloRing/index.js:111-135`,
  `createPortRegistry`/`buildPortCollision` (`haloPortDocking.js`), `haloRingCollision.js:143-151`,
  `haloRingGame.js:83-84`, `haloPortTraffic.js`, test `tests/haloPortK7.test.mjs:156`;
- wolna podłoga: ~18,7 tys. j. łuku między zatoką a tranzytem po obu stronach kompleksu (Ziemia),
  ~12 tys. (Mars). Stocznia ma 5,0 × 3,8 tys. j., hangar 300 miejsc w jednym rzędzie 12,6 × 5,6 tys.;
- krzywizna podłogi: szeroka budowla to cięciwa — pod końcami podłoga opada o x²/2R (hangar
  12,6 tys. j.: ~470 j.) — tył trzeba wpuścić do podłogi jak kołnierz K-7 (`toFloor` w
  `buildHabitatPlug`);
- render: korzeń jako dziecko grupy ringu, ramka `portRingModuleFrame(layout, θ)` (bez obrotu
  grupy), `light: 'halo'`, `haloUniforms: ring.uniforms`; ruch i kolizje: ramka z obrotem
  (`haloRingRotation`), jak `buildHaloPortTrafficLayout`.

Megadok (Z8): `portModuleFrame(x, y, kąt)` wokół stacji, gospodarz = grupa w środku stacji,
styl megadoku jako obiekt w kształcie `profile.port` (+ `buildings: { family, walls, buoy }`).

## Do decyzji użytkownika

1. Rozmiar hangaru: pojemność robią poziomy bębnów (niewidoczne), ale szerokość rośnie z liczbą
   bębnów — Saturn (472) = 5 bębnów w 2 rzędach 9,9 × 8,6 tys. j.
2. Pochylnia jest pod nosiciela, więc fregata (192 × 144) wygląda na niej na zgubioną — czy
   stocznie mają mieć osobne małe pochylnie (ekonomia ma dziś 2 miejsca budowy bez klasy).
3. Kto używa suchego doku (rola `service`): gracz (remont/przezbrojenie Atlasa, Z10) i przyszłe
   naprawy floty po wojnie — dziś nikt go nie przydziela.
4. Gdzie na ringu: stocznia i hangar po dwóch stronach kompleksu wymagają ≥ 6 prostokątów miejsc.
