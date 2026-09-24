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
| dok/stacja Ziemi na orbicie 46 020 | port ringu: **4 kompleksy co 90°** (pierwszy przy kącie stacji), w każdym **3 doki: hala K-7 pośrodku** (28 stanowisk, 4 capital) i **po jednej otwartej zatoce z każdej strony** ze stanowiskami w standardzie K-7 (2 pasy MEGA + 4 L, 4 M, 4 S), wszystko **wpięte w podłogę habitatu na środku wstęgi**, w płaszczyźnie gry |
| „teoretyczny” dok ruchu v2 (`buildStationDocks`, 4 pomosty × 13 × mnożnik) | `buildHaloPortTrafficLayout()` z `src/3d/haloRing/haloPortTraffic.js` — ten sam format (`berths`, `docks`, `parkingRadius`), 224 stanowiska: 16 capital, 16 mega, 48 L, 64 M, 80 S |
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
  Przy porcie: kolizja 2D płyty z terenem (wierzchołki kadłuba nad wysokością terenu z mapy CPU
  na z = 0 — góry to przeszkoda) poza korytarzami tranzytów + ściany tuneli i portali (demo:
  `_groundConstraint` w `dema/halo_ring_k7_flight.js`, `buildPortCollision` w
  `haloPortDocking.js`; klawisz T = skok przed najbliższy tranzyt);
- zatoki i K-7 w BG (pokłady pod statkami), suwnice/dach hali w FG;
- płyty portu w mapach terenu (szablon `haloPortTemplate` → `uPortTile/uPortRects/uPortZones`:
  K-7, 2 zatoki, tranzyt co 90°): płasko, bez zabudowy i lasu, goły metal z liniami;
  przejaśnienie w chmurach nad portem;
- **strefy tylko wokół doków** (poprawki użytkownika 2026-09-23: dok wbity w ziemię generuje
  wokół siebie przemysł, przemysł TYLKO wokół doków, obok mogą być góry): od płyty doku pas
  fabryczny (`HALO_PORT.zoneInd` 1 000 j.), dalej osady (`zoneRes` 2 800 j.) — tylko tam, gdzie
  teren sektora nie ma gór — potem sektor jak był. W poprzek wstęgi strefy węższe (×0,6), więc
  **góry sektora przy brzegach wstęgi (górna i dolna ściana) mogą stać tuż obok doków — nie
  muszą** (zależy od sektora). Żaden sektor nie jest już przemysłowy (PORT KEPLER = krajobraz
  z górami przy ścianach, HEPHAESTUS = krajobraz, DAEDALUS = szkło). **Osłona**: nad płytą doku
  i portalu tranzytu (od płyty do górnej ściany, w pasie płyty wzdłuż ringu) teren zostaje niski
  — w kamerze gry to, co leży nad płaszczyzną gry, jest bliżej kamery i zasłoniłoby dok. Tranzyty
  bez stref. Liczone w bake'u map (`haloPortZones` w `haloRingGLSL.js` / `haloRingWorldGen.js`),
  kawałki miasta 3D biorą te same zasięgi;
- dolna ściana od środka jest bliżej kamery (z = −2 700 zamiast −5 750) — widać ją większą.

## Port Ziemi w ruchu v2 (2026-09-23)

Zmierzone symulacją ruchu v2 (`scripts/symulacja-ruchu.mjs` + pomiar zajętości stanowisk Ziemi,
gospodarka ×60 jak w demie ruch-v2, 90–120 min gry):

| port Ziemi | stanowisk | kolejka na redzie (średnio / szczyt) |
|---|---|---|
| teoretyczny ruchu v2 (4 pomosty × 13 × 5) | 260 | 0 / 0 |
| 1 × K-7 (2 capital, bez zatok) | 26 | 169 / 395 |
| 4 × K-7 (2 capital) + 3 zatoki przy każdej | 116 | 1,3 / 42 |
| 4 × K-7 (4 capital) + 3 zatoki mega przy każdej | 124 | 0 / 0 |
| 4 × K-7 + 3 otwarte zatoki (pas MEGA + 2 L, 2 M, 2 S) przy każdej | 196 | 0 / 0 |
| **4 × K-7 + 2 zatoki po bokach (2 pasy MEGA + 4 L, 4 M, 4 S)** | **224** | **0 / 0** |

Szczyty zajętości w teoretycznym porcie: S 40, M 45, L 28, capital 9, mega 7 (capital zajmują
`heavy_freighter`, mega — `megafreighter`, który nie mieści się w hali, stąd zatoki). W porcie
224 stanowisk (×60, 120 min): S 46/80, M 50/64, L 28/48, capital 9/16, mega 8/16. Wszystkie
kadłuby, które ruch v2 przydziela do klas, fizycznie mieszczą się na stanowiskach K-7 / w zatoce
(test `tests/haloPortTraffic.test.mjs`). Punkty podejścia: przed bramą, którą statek wchodzi
(capital — koniec własnego pasa za G-01, grzebienie — przed bramą boczną), zatoka — nad wylotem
pasa MEGA / alei grzebienia.

## Otwarte zatoki i kadłuby gracza (2026-09-23, układ 2026-09-24)

Poprawka użytkownika: gracz będzie latał frachtowcami i innymi statkami jak NPC, więc dokuje także
poza K-7 — „w K-7 masz sloty, takie same sloty muszą się pojawić w otwartych dokach”. Poprawka
graficzna 2026-09-24: **3 doki w kompleksie zamiast 4** — K-7 pośrodku i po jednej zatoce z każdej
strony (`HALO_PORT.dockOffsets` ±9 700), zatoki powiększone, żeby pokryły stanowiska usuniętej
trzeciej (kompleks: 21 → 28 stanowisk w zatokach, 3 → 4 pasy MEGA).
- `haloPortBays.js` — układ zatoki w formacie stanowisk K-7 (wnętrze 5 800 × 3 400 j., głębokość
  od podłogi `HALO_PORT.bayDepth`), symetryczny: **2 pasy MEGA przy ścianach** prosto od wylotu,
  dziobem do podłogi (pole 2 900 × 1 150, megafrachtowiec 2 760 × 912, też capital), **grzbiety
  serwisowe** i **podwójny grzebień jak boczne banki K-7** (wspólna aleja 900 j. pośrodku,
  stanowiska L/M/S dziobem do grzbietu, te same pola i limity co w K-7 — `K7_BANK_SLOTS`).
  Słupki serwisowe i paliwowe, nogi suwnic, `baySolidList` (render + kolizje); stanowiska wolne
  (bez statków NPC);
- render: stanowiska zatok nagrywa `buildK7Scene` hali kompleksu (przejście ramek zatoka → hub),
  w tych samych instancjach i draw callach (pola, pasy, napisy, lampki stanu, strzałki, szyny pasów
  MEGA, grzbiety z rurociągiem); bryła zatoki (pokład bez znaczeń, ściany, kołnierz, klin) w
  megastrukturze; **suwnice tylko nad pasami MEGA** (most od bieżni na ścianie do nogi na grzbiecie,
  jak suwnice stanowisk capital K-7) — grzebień pośrodku czytelny w kamerze gry;
- krzywizna ringu: hub i zatoka są styczne do podłogi na środku, a pod ich krawędziami podłoga
  opada o x²/2R (zatoka ~140 j., kołnierz K-7 ~380 j.) — bryły styku z podłogą (słupy i
  podstawa-terminal kołnierza, ściany, klin) sięgają do niej, żeby końce nie wisiały nad terenem;
- `haloPortHulls.js` — kadłuby gracza jak NPC ruchu v2: Atlas, megafrachtowiec, ciężki frachtowiec
  (sprite zastępczy: frachtowiec dalekiego zasięgu), frachtowiec dalekiego zasięgu, kontenerowiec,
  prom; wymiary jak `getHullRenderSize`, wypukłe obrysy kolizji z kanału alfa sprite'ów, klasa
  stanowiska = `hullFootprint` ruchu v2, strojenie lotu;
- `haloPortDocking.js` — rejestr 224 stanowisk (4 hale + 8 zatok) w układzie huba hali gracza
  i jeden automat dokowania: capital K-7 z suwnicą i wężami (9,3 / 9,5 s), pozostałe — mocowanie
  magnetyczne i rękaw serwisowy (4,6 / 4,2 s); pole STOP, kurs ≤ 7°, prędkość ≤ 30; świat kolizji
  portu `buildPortCollision`;
- **ring nie udaje życia** (decyzja użytkownika 2026-09-24: statki i ruch wdrażane osobno):
  usunięty ruch zastępczy (`haloRingTraffic.js` — frachtowce wokół ringu i okręty liniowe na
  pasach MEGA), zaparkowane statki NPC z dema ECUMENE i nocne światła aut na głównych ulicach
  miast (latarnie zostają, bez ruchu); wszystkie stanowiska wolne. Pociągi maglevu na dachu
  zostają (część megastruktury, nie ruch statków). Statki NPC,
  zajętość stanowisk i ich kolizje dołoży system ruchu (adapter `haloPortTraffic.js`, stanowiska
  `berth.occupied`, przedmioty ruchome `K7CollisionWorld.refresh`);
- demo: klawisz **V** zmienia kadłub, `?hull=container_ship`, `?berth=Z02-M02` (pasy MEGA:
  `Z02-MG1`, `Z02-MG2`), API
  `__halo.flight.hull() / berth() / place() / berthState`.
Merkury (bez ringu) potrzebuje w szczycie: M 48, L 24, S 16, capital 8, mega 8 — pod przyszły megadok.

## Megabudowle — landmarki miast (2026-09-24)

Pierwsza rzecz „pożyczona” z innych dem (decyzja użytkownika: ring dopracowujemy elementami
z `orbital_ring_gameplay_hub_v3.html` i `orbital_ring_demo_2.html`): 9 megabudowli ECUMENE
(brama z mieszkalnymi mostami, tarasowa „góra” z ogrodami, iglica z trzech rdzeni, most) jako
punkty orientacyjne sektorów miast.
- `haloRingLandmarks.js` — specyfikacje z ECUMENE (wymiary, nazwy) trafiają do sektorów miast
  o tych samych nazwach (HELIX ×3, MERIDIAN ×2, AXIOM ×2, DAEDALUS; KEPLER TRANSIT NEXUS
  w VESPER, obok portu). Rozstawienie: **dolna połowa wstęgi** — plac z rampą kończy się 120 j.
  pod płaszczyzną gry (budowla nie jest przeszkodą lotu, kolizje niepotrzebne), w kamerze gry
  widać front (+z) jak rysunek elewacji zwisający od linii podłogi nad dolną ścianą; górna
  połowa leży przy kamerze i rosłaby w powiększeniu jak dach. Poza tym z dala od kompleksów
  portu (razem ze strefami) i tranzytów, na suchym i płaskim terenie z mapy CPU sprzed placów;
- bake map: plac (`haloLandmarkPlaza`, uniformy `uLandmark*`, najwyżej 12) — płasko na
  wysokości placu, ląd, bez rzek, zabudowy i lasu; pod kamienną płytą rdzeń bez drzew (waga
  ogrodu → szkło), wokół trawnik z rampą do terenu. `HaloWorldMaps.setLandmarks` piecze
  ponownie mapę niską i odczyt CPU (wysokość placu dla lotu i kamery);
- render: bryły w zestawie punktów orientacyjnych megastruktury (BG, bez zaniku z odległością)
  — **0 nowych draw calli** (~450 prostopadłościanów + ~100 świateł pozycyjnych). Prymityw
  stawiany na podłodze kwaternionem (lokalne z → góra mieszkańców), więc okna, dach i fazki
  liczą się w jego osiach. Palety 24–28 (kamień, mosiądz, pas świetlny, rama fasady ciepłej
  — piaskowiec i szkło z brązu — i chłodnej — stal), emisja 7 = fasada: kondygnacje 4,5 j.,
  przęsła 5 j., pas stropu co 12 kondygnacji; okna nocą w trzech skalach (okno → grupa 3 × 3
  okien → pas 12 kondygnacji), więc z daleka wieża nie zlewa się w jednolitą taflę;
- API ringu `landmarks`; demo: **M** / Shift+M (kolejna budowla: w kamerze kinowej ujęcie od
  frontu, w kamerze gry nad budowlą), `?landmark=i[&cam=game&zoom=…&night=1]`,
  `__halo.landmark(i, opts)`; zrzuty `--set landmarks`.

## Port K-7 (dok gameplayowy, decyzja użytkownika 2026-09-23)

Hala K-7 z dema ECUMENE (`dema/orbital_ring_gameplay_hub_v3.html`) przeniesiona (3 bramy, suwnice,
węże od rufy, sekwencje dokowania 9,3/9,5 s, zanik dachu); od 2026-09-23 **28 stanowisk, 4 capital**
(hala 10 440 j. szerokości, brama główna 6 180 j. — każde capital ma własny pas). Na ringu 4 hale:
hala gracza przy kącie stacji (lot, dokowanie), 3 statyczne (obcinane poza kadrem, za horyzontem
podłogi i za planetą):
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
  hale K-7 wszystkich kompleksów, zatoki (ściany, kołnierze, słupki, nogi suwnic), tranzyty
  i podłoga z terenem.
- rozgrywka w demie: `dema/halo_ring_k7_flight.js` (tryb „Lot”, klawisz L; V = kadłub).

## Budżet (zmierzone, RTX 5080, 1440p, jakość „Wysoka”)

Tryb gry i lotu: **18–34 draw calle** (limit 40; z K-7 i zatokami w kadrze 31–34 — górna
ściana w FG to +4–6; stanowiska zatok i megabudowle bez nowych draw calli), 1,9–4,2 ms/klatkę; kinowe 29–31
(szeroki plan z trzema kompleksami 50), do ~5,5 ms.
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
przez całą płytę, determinizm), `haloPortK7.test.mjs` (K-7 na podłodze, miejsca rozłączne,
osie tranzytów co 90°, strefy, kołnierz w kolizjach), `haloPortTraffic.test.mjs` (port w formacie
ruchu v2), `haloPortBays.test.mjs` (zatoki: stanowiska, pasy, aleja, kadłuby gracza, dokowanie
każdym kadłubem, scena kompleksu, port bez udawanego życia), `haloRingLandmarks.test.mjs`
(megabudowle: sektory, place pod płaszczyzną gry i z dala od portu, teren, bryły na placu,
wariant Halo).

## Po porcie (gameplay, poza demem)

Doki: rejestr stanowisk `createPortRegistry` + automat `PortDocking` (haloPortDocking.js) →
dokowanie gracza w grze (model lotu K-7 zastąpić napędem gry); kolejki portu z ruchu v2
(`buildHaloPortTrafficLayout`).
Działki na dachu (`plan.lanes.rowA/rowB`) → budynki gracza (krok 3 ekonomii). Ruch statków:
wyłącznie z systemu ruchu v2 (osobne wdrożenie) — ring nie ma już ruchu zastępczego
(`haloRingTraffic.js` usunięty 2026-09-24).
