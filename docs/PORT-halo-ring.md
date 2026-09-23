# Port ringu „Halo” do gry — notatka (M5, 2026-09-23)

> Stan: moduły `src/3d/haloRing/` gotowe i sprawdzone w `dema/halo_ring_demo.html`; do gry
> **niepodpięte**. Decyzje użytkownika: `docs/BRIEF-ring-halo.md` §1 (habitat w stronę kosmosu,
> port ringu zastępuje stację Ziemi, stacje docelowo w deep space, **płaszczyzna gry na środku
> wstęgi, doki wpięte w podłogę habitatu** — 2026-09-23).

## Co zastępuje co

| Dziś w grze | Po porcie |
|---|---|
| `src/3d/planetaryRing3D.js` (render ringu, pass FG layer 2) | `createHaloRing()` z `src/3d/haloRing/index.js`: wszystko w **BG persp, layer 1** (pod statkami) poza górną ścianą z dachem → **FG, layer 2** (leży nad płaszczyzną gry) |
| `src/3d/ringCity*.js` (miasto-pudełka, SynthCity) | teren CDLOD + mapy GPU + budynki/drzewa instancjami (`haloRingCity.js`) |
| dok/stacja Ziemi na orbicie 46 020 | port ringu przy kącie stacji: K-7 (dok gameplayowy) + 3 doki transportowe (`plan.docks`), wszystkie **wpięte w podłogę habitatu na środku wstęgi**, w płaszczyźnie gry |
| pas-hak cienia ringu w `EARTH_FRAGMENT`/`CLOUD_FRAGMENT` (`uRingShadow*`) | zostaje, ale do przestrojenia (niżej) |

Obwiednia promieniowa (41 202–43 752) jest ta sama co `computePlanetaryRingLayout` — strefy orbit,
spawn (57 252), CIC i testy `scaleTuning` nie muszą się zmieniać. Mars: `createHaloRing({ planetRadius: 30000 })`.

## Wpięcie (index.html ≈ :1179–1188, :9050, :21603, :21755)

```js
import { createHaloRing } from './src/3d/haloRing/index.js';
const halo = createHaloRing({ planetRadius, seed: 1337, quality: 'high', renderer: Core3D.renderer });
halo.group.position.set(earth.x, -earth.y, 0);   // świat 2D (x, y) → Three (x, −y, z)
halo.setLayers({ default: 1, fg: 2 });           // BG przed planetą ortho i statkami, górna ściana w FG
Core3D.scene.add(halo.group);
// co klatkę, PRZED renderem (kamera persp BG z Core3D.syncCamera):
halo.update(dt, { camera: Core3D.cameraPersp, viewportHeight: Core3D.renderer.domElement.height, gameView: true });
halo.setSun(azimuthToSun, 49 * Math.PI / 180);   // azymut do Słońca, wysokość jak DirectionalLight gry
// wycięcie dachu nad graczem pod górną ścianą (układ lokalny ringu = świat − pozycja grupy):
halo.setCutaway(1, { x: shipX - earth.x, y: -shipY + earth.y, a: 1350, b: 1350, strength: underRoof });
```

Moduł nie tworzy renderera ani canvasu (renderer tylko do bake'u map przy starcie). Pozycje liczone
względem kamery (RTE) z `group.matrixWorld` — ring może stać przy Ziemi setki tysięcy j. od początku układu.

## Płaszczyzna gry na środku wstęgi (decyzja użytkownika 2026-09-23)

`flightLevel: 0.5` (domyślnie dla habitatu w stronę kosmosu): z = 0 przecina podłogę habitatu w
połowie szerokości — wstęga leży od z = −2 950 do +3 050, środek planety na z = 0. Wcześniej (M1–M5,
dziś `flightLevel: 'roof'`, `?plane=roof` w demie) cała wstęga była pod płaszczyzną, a doki przy
dachu. Skutki dla portu:
- **górna ściana z dachem jest NAD statkami** → siatki FG (`structureTop`, dach megastruktury,
  pociągi, światła dachu). Żeby nie wrócić do „ring przykrywa statki” (stary pass FG), w kamerze
  gry (`gameView: true`) dach nad wąwozem habitatu **chowa się od krawędzi ścian ku podłodze** przy
  zoomie rozgrywki (powiększenie dachu h/(h − z) 1,12 → 1,32, czyli 1080p ≈ zoom 0,07 → 0,125;
  `HALO_FG.troughMag`), zostaje pas nad kadłubem; cały dach znika, gdy kamera zejdzie tuż nad niego
  (`fadeMag`); przy dalekim zoomie dach wraca, a `setCutaway` otwiera go nad graczem / halą K-7;
- **ring jest przeszkodą w płaszczyźnie gry**: płyta podłogi z kadłubem (r 41 800 … 42 259 +
  zabudowa) przecina z = 0; przez ring prowadzą **4 tranzyty** (jak w K-7 z ECUMENE: osie co 90°,
  ±45° i ±135° od K-7) — tunele w płycie, prześwit 1 140 j., wylot na habitat (portal na płycie)
  i na planetę (portal w kadłubie). Otwór w terenie i kadłubie wycina shader
  (`haloInTransitCut`, uniformy `uTransit*`), wyściółka i portale to bryły megastruktury (BG).
  Przy porcie: kolizja 2D pasa płyty poza korytarzami tranzytów + ściany tuneli i portali (demo:
  `_floorConstraint` i `_addTransitWalls` w `dema/halo_ring_k7_flight.js`, klawisz T = skok przed
  najbliższy tranzyt);
- doki transportowe i K-7 w BG (pokłady pod statkami), ich suwnice/dach jak dotąd;
- płyty portu w mapach terenu (`haloPortSites` → `uPortSites`, 8 miejsc: K-7, 3 doki, 4 tranzyty):
  płasko, bez zabudowy i lasu, goły metal z liniami; przejaśnienie w chmurach nad portem;
- **strefy wokół doków** (poprawka użytkownika: dok wbity w ziemię generuje wokół siebie przemysł):
  od płyty doku pas fabryczny (`HALO_PORT.zoneInd` 1 300 j.), dalej zabudowa mieszkalna (`zoneRes`
  3 300 j.), dopiero potem sektor jak był; granice zafalowane szumem, w strefie ląd zamiast morza,
  bez gór i rzek. Tranzyty mają tylko wąski pas techniczny (550 j.). Liczone w bake'u map
  (`haloPortZones` w `haloRingWorldGen.js`), kawałki miasta 3D biorą te same zasięgi;
- dolna ściana od środka jest bliżej kamery (z = −2 700 zamiast −5 750) — widać ją większą.

## Port K-7 (dok gameplayowy, decyzja użytkownika 2026-09-23)

Hala K-7 z dema ECUMENE (`dema/orbital_ring_gameplay_hub_v3.html`) przeniesiona 1:1 (układ, 26
stanowisk, 3 bramy, suwnice, węże od rufy, sekwencje dokowania 9,3/9,5 s, zanik dachu):
- `haloPortK7Layout.js` — czysta logika: układ hali, osadzenie przy kącie stacji (**ściana tylna
  hali na płycie portu na podłodze habitatu**, hala przechodzi przez wąwóz habitatu i wychodzi poza
  krawędź ścian; kołnierz na podłodze = przeszkoda lotu), kolizje (wielokąty wypukłe, SAT), automat
  dokowania, referencyjny model lotu K-7 (**przy porcie podpiąć napęd gry** — to nie
  `thrusterModel.js`), zanik dachu;
- `haloPortK7Build.js` — bryły jako dane (port funkcji budujących K-7); `haloPortK7.js` — render
  (instancje + pokład + napisy z atlasu + węże), ~11 draw calli, obcinany gdy poza kadrem;
  wpięcie w podłogę: kołnierz (słupy, nadproże, podstawa-terminal „PORT KEPLER” z oknami) i klin
  nośny pod pokładem (wielokąt wytłoczony wzdłuż x) — bez mostów i zastrzałów;
- **warstwy**: pokład, ściany, stanowiska → BG (layer 1, pod statkami); suwnice, węże i dach →
  **FG (layer 2, po świecie ortho)** — celowo nad statkiem stojącym pod mostem suwnicy;
- wysokości nad płaszczyzną lotu ściśnięte ×0,42 (`k7HeightToZ`), żeby kamera persp przy
  zoomie 3,2 (535 j. nad z = 0) była nad dachem; pokład hali na z = −116;
- stacja Ziemi na orbicie 46 020 przestaje istnieć (K-7 sięga do r ≈ 50,8 tys.); kolizje:
  K-7 (hala, kołnierz), doki transportowe (ściany boczne, kołnierze) i podłoga habitatu.
- rozgrywka w demie: `dema/halo_ring_k7_flight.js` (tryb „Lot K-7”, klawisz L).

## Budżet (zmierzone, RTX 5080, 1440p, jakość „Wysoka”)

Tryb gry: **12–34 draw calle** (limit 40; z K-7 i dokami w kadrze 31–34 — górna ściana w FG to
+4–6), 2,4–4,5 ms/klatkę; kinowe do ~6,4 ms.
Zero alokacji na klatkę (bufory instancji przepisywane tylko przy zmianie wyboru segmentów).
Budynki miasta: kawałki wzdłuż ringu wybierane z kadru, horyzontu wypukłej podłogi i rozmiaru
w pikselach (`HaloCityChunkSet`), płynne znikanie w shaderze — bez twardej granicy w kadrze.

## Do usunięcia przy porcie

- render ringu w `planetaryRing3D.js` i pass FG layer 2 dla ringów; `ringCity*.js`;
  hook `__planetaryRingsDebug`. `computeRingStationOrbitRadius` zostaje, dopóki stacja istnieje.
- okluder ringu w `core3d.js` (shadow shafts) — zastąpić pierścieniem 41 800–43 752 j., z od −2 950 do +3 050.

## Do przestrojenia

- `uRingShadow*` w `planet3d.assets.js`: promień = krawędź kadłuba 41 800, zasięg ≈ 1 952 (szerokość
  dachu); w kamerze kinowej dema cień liczy się analitycznie (`haloRingBlock`) — to wzorzec.
- `RingCityFlight` (tryb `free3d`) → kamera kinowa dema (`dema/halo_ring_demo.js`, dynamiczny near).

## Testy do przepisania

Dopasowują źródło starego ringu: `ringArcGeometry`, `ringBakedCitySurface`, `ringCityFlight`,
`ringCityMood`, `ringCitySurfaceFrame`, `ringCityTraffic`, `ringLegacyCleanup`, `ringLogisticsBand`,
`ringPerformanceLod`, `shadowShaftsQuality`, `storefrontInstance` (+ fragmenty `scaleTuning`).
Nowe: `haloRingLayout.test.mjs` (geometria, płaszczyzna gry na środku, widoczność z kamery gry),
`haloRingRoofPlan.test.mjs` (detal na dachu, doki wpięte w podłogę w pasie z = 0, tunele tranzytów
przez całą płytę, determinizm), `haloPortK7.test.mjs` (K-7 na podłodze, 8 miejsc rozłącznych,
osie tranzytów co 90°, strefy, kołnierz w kolizjach).

## Po porcie (gameplay, poza demem)

Doki: pozycje z `plan.docks` → system dokowania (sekwencja z `hangar-ring.html`), kolejki portu.
Działki na dachu (`plan.lanes.rowA/rowB`) → budynki gracza (krok 3 ekonomii). Ruch statków: dziś
proceduralny (`haloRingTraffic.js`); docelowo z systemu ruchu v2.
