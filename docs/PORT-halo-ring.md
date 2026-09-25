# Port ringu „Halo” do gry — notatka (M5 2026-09-23, port 2026-09-25)

> Stan: **podpięty do gry 2026-09-25** (§ „W grze” niżej) — ring Ziemi i Marsa, stacja-port
> w hali K-7, kolizje, tryb jakości „Ultra”; stary ring (`planetaryRing3D.js`, `ringCity*.js`)
> usunięty. Demo `dema/halo_ring_demo.html` zostaje warsztatem ringu. Decyzje użytkownika:
> `docs/BRIEF-ring-halo.md` §1 (habitat w stronę kosmosu, port ringu zastępuje stację Ziemi,
> stacje docelowo w deep space, **płaszczyzna gry na środku wstęgi, doki wpięte w podłogę
> habitatu** — 2026-09-23).
>
> Sekcje „Co zastępuje co” … „Budżet” opisują ring z dema (projekt); stan gry — „W grze”
> i dalej.

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

## API modułu (w grze woła je `HaloRingGame`, § „W grze”)

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
- bake map: plac (`haloCivicAt`, uniformy `uLandmark*`, najwyżej 12) — płasko na
  wysokości placu, ląd, bez rzek, zabudowy i lasu; pod kamienną płytą rdzeń bez drzew (waga
  ogrodu → szkło), wokół trawnik z rampą do terenu, dalej park (sekcja niżej).
  `HaloWorldMaps.setCivic({ landmarks, domes })` piecze ponownie mapę niską i odczyt CPU
  (wysokość placu dla lotu i kamery);
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

## Kopuły, parki i gatunki drzew (2026-09-25)

Prośba użytkownika: „dodaj kopuły, landmarki bez pustego otoczenia — niech stoją w parku jak
w dwóch innych demach, dodaj różne typy drzew”.
- **Park** (ECUMENE `createParks`/`createForests` + strefa PARK z `orbital_ring_demo_2`): wokół
  płyty budowli płaski trawnik z 3 pawilonami (pokład, słupki, dach-ogród, ciepłe światło), dalej
  park — prostokąt o zaokrąglonych narożnikach, granica zafalowana szumem. Bake: zabudowa
  wycięta, las = kępy z szumu (skala 230 j.) + podłoga 0,08 (pojedyncze drzewa na trawnikach),
  staw z plażą obok placu, gdy teren niski (woda w terenie leży na poziomie 0, więc staw tylko
  przy placu ≤ 26 j.). Waga parku w **kanale R mapy B** (dawna waga „krajobrazu” nieużywana
  w runtime). Shader terenu rysuje z niej trawnik z pasami koszenia, żwirowe ścieżki (siatka
  140 × 104 j. zakotwiczona w świecie, zakrzywiona NISKIMI oktawami szumu — mip 4 kafla
  3300 j.; drobne oktawy dawały wzór pęknięć), skosy w części komórek, kwietniki z obwódką
  żywopłotu, korony pojedynczych drzew z daleka i nocą latarnie na części skrzyżowań (stałe
  światło, nie ruch);
- **kopuły-biosfery** (`haloRingDomes.js`): 12 z planu ECUMENE (`DOME_PLANS`, sektory o tych
  samych nazwach), typy wnętrz z demo_2 (las, tropiki, ogród botaniczny, park rekreacyjny,
  dzicz, akwarium). Rozstawienie jak budowle (`haloPlaceCivic`, wspólny kontekst
  `haloCivicContext` — odstępy parków budowli i kopuł), płaski pas + rampa + park. Wnętrze
  piecze bake wg typu (jak `domeInterior` w demo_2): woda, las, park, wzgórza i **klimat**
  (tropiki 0,9/0,95 → palmy, dzicz 0,34 → iglaste); kopuły z wodą mają podłogę ≤ 12 j.
  Szkło: osobny zestaw `glass` w planie dachu → jedna przezroczysta siatka półkuli
  (`HaloMega_domeGlass`, **1 draw call** na wszystkie kopuły, renderOrder 30, bez zapisu
  głębi): żebra (16 południków, 6 równoleżników), siatka rombów z mipową średnią z daleka,
  Fresnel z odbiciem nieba, odblask GGX, barwa wg typu, nocą słaba poświata przy podstawie
  i lampy na żebrach. Kołnierz, hale wejściowe (fasada emisji 7) i światła obwodu/szczytu
  w zestawie punktów orientacyjnych — 0 nowych draw calli poza szkłem. Bez świateł wnętrza
  (za dnia wisiały w powietrzu jak kule);
- **gatunki drzew** (`haloRingCity.js`, `makeTreeKit`): jedna geometria indeksowana
  (192 wierzchołki — mniej niż dawna korona z ikosaedru bez indeksów): pień wspólny + liściaste
  (4 kule), iglaste (3 piętra stożków), topola (wrzeciono), palma (7 liści-pióropuszy o
  przekroju Λ zamkniętym spodem, wygięty pień). Gatunek w shaderze z klimatu mapy A: chłód →
  iglaste, ciepło + wilgoć (kopuły tropikalne, ciepłe plaże) → palmy, nad rzeką i losowo →
  topole, reszta liściaste (6–26% w odmianach ozdobnych: miedź, złoto — więcej w chłodzie).
  Wierzchołki innych gatunków zapadają się zaraz po odczycie mapy A, puste sloty po B/C;
- demo: **K** / Shift+K (kolejna kopuła), `?dome=i[&cam=game&zoom=…&night=1]`,
  `__halo.dome(i, opts)`, `__halo.domes`; zrzuty `--set domes`. Zmierzone: 16–27 draw calli,
  1,9–4,9 ms @1440p, HDR ≤ 1,02, NaN 0. Testy: `haloRingDomes.test.mjs`,
  `haloRingTrees.test.mjs`, park i staw w `haloRingLandmarks.test.mjs`.

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
ściana w FG to +4–6; stanowiska zatok i megabudowle bez nowych draw calli, szkło kopuł +1), 1,9–4,9 ms/klatkę; kinowe 29–33
(szeroki plan z trzema kompleksami 50), do ~5,5 ms.
Zero alokacji na klatkę (bufory instancji przepisywane tylko przy zmianie wyboru segmentów).
Budynki miasta: kawałki wzdłuż ringu wybierane z kadru, horyzontu wypukłej podłogi i rozmiaru
w pikselach (`HaloCityChunkSet`), płynne znikanie w shaderze — bez twardej granicy w kadrze.

## W grze (port 2026-09-25)

Moduły kleju (poza nimi gra woła tylko to, co niżej):
- `src/3d/haloRing/haloRingGame.js` — `HaloRingGame`: ring Ziemi i Marsa (ta sama bryła, promień
  planety z `resolveRingPlanetWorldRadius`, ziarno 1337 / 4099), grupa w środku planety obrócona
  tak, żeby port wypadł pod kątem dawnej stacji (`haloRingRotation`); tworzony leniwie, gdy środek
  kadru jest bliżej planety niż 420 tys. j. (bake map przy pierwszym podejściu). Co klatkę renderu:
  kamera = replika `Core3D.cameraPersp` TEJ klatki (FOV, wysokość z bufora composera i zoomu,
  `cam` ze wstrząsem — ring liczy pozycje względem kamery, kamera z poprzedniej klatki
  przesuwałaby go względem sceny), słońce (azymut do Słońca gry minus obrót ringu, wysokość 49°),
  zanik dachów hal i zatok przy statku (`K7RoofFade`), wycięcie górnej ściany nad halą / zatoką (0)
  i kołem nad statkiem (1), lampy hal nocą (cień planety), okluder smug
  `Core3D.setShaftRingOccluder` (także poza kadrem), jakość z `OPTIONS.planetQuality`. Podzielony
  ekran: ring ukryty (RTE liczy się dla jednej kamery).
- `src/game/haloRingPlanets.js` — czyste: planety z ringiem, kąt stacji, obrót, przejścia świat gry
  ↔ układ lokalny ringu, `computeHaloPortStation(planet)` (stacja-port).
- `src/game/haloRingCollision.js` — `HaloRingCollider`: płyta ringu z terenem, ściany portu (SAT),
  `pointInSlab` dla pocisków; zero alokacji.

`index.html`:
- **stacje**: Ziemia i Mars → stacja-port w hali K-7 kompleksu 0 (`computeHaloPortStation`): środek
  hali (r = podłoga + 3 825), `ringPort`, `isCollidable: false` (pociski i kolizje stacji jej nie
  łapią — przeszkodą jest ring), `terminalRange: 5600` (terminal w całej hali), 4 porty ruchu NPC
  na płycie przed bramą (z huba 8 100, x ±900 / ±2 600), brama warp za płytą (z 10 200). Bryła 3D
  stacji pominięta (`stations3D.js`); ikony domyślnej infrastruktury (stocznie, panele, magazyny)
  nie rysują się na dachu hali (`infrastructureUI.js`) — widać je w edytorze infrastruktury,
  ekonomia i czujniki bez zmian;
- **start**: `initHaloRings()` w DOMContentLoaded po `initPlanets3D` (jakość z `sc_planet_quality`);
- **render**: `haloRings.update(frameDt, cam, { sun, ship, quality, splitScreen })` po
  `updatePlanets3D`, przed `updateStations3D` i `updateHexShips3D` (tam `Core3D.render`); PerfHUD
  `render3dRingsUpdateTime`;
- **fizyka**: `stepShipRingCollisions(dt)` po asteroidach, przed destruktorem — gracz i P2: płyta
  + ściany portu, NPC: tylko płyta; komunikat „RING: PŁYTA HABITATU — PRZELOT TYLKO TRANZYTEM” /
  „PORT: OGRANICZENIE KADŁUBA” przy uderzeniu > 150 j/s;
- **pociski**: `haloRings.pointInSlab` — trafienie w płytę = efekt uderzenia i koniec pocisku;
- usunięte ścieżki starego ringu: render i pętla `RingCityFlight`, cele wiązek i destruktora
  w segmentach ringu, sweep pocisków po ringu, encje ringu w `renderEntities`, `ZonePainterUI`,
  tuner kolorów ringu, `isRingSegment`;
- **konsola / dev**: `HaloRingDebug.goto('earth' | 'mars', 'port' | 'hall' | 'transit')`,
  `.at(klucz, kątLokalny, promień, kurs)`, `.zoom(z)`, `.stats()`;
  `?dev&haloTest=earth&haloAt=port|hall|transit` stawia statek przy ringu na starcie.

### Kolizje (ring = przeszkoda)

- płyta podłogi z kadłubem przecina z = 0: od kadłuba (`back` 41 800) do podłogi (42 252) plus
  teren z mapy CPU (`terrainHeightAt` na z = 0, co najmniej 7 j. płyty) i 14 j. prześwitu.
  Wierzchołki obrysu statku (8 punktów) w płycie → wypchnięcie promieniowe na stronę środka
  statku (habitat albo kadłub), prędkość w głąb płyty zerowana, bez odbicia i bez obrażeń;
- tranzyty (4 osie co 90°, ±45° od hal): korytarz ±570 j. wzdłuż ringu otwarty — Atlas (806 j.)
  przechodzi dziobem;
- ściany portu (hala K-7, zatoki, kołnierze, słupki): SAT z minimalnym wektorem przesunięcia,
  3 iteracje, tylko statki graczy (NPC do portu nie wlatują);
- zmierzone w grze (headless, 2026-09-25): statek wstawiony w płytę od strony habitatu → nad
  teren (R 42 152 → 42 746), od strony kadłuba → pod kadłub (41 900 → 41 416); taran 1 500 j/s →
  stop na terenie (R 43 321, v = 0, komunikat); ten sam lot w oś tranzytu → przelot przez tunel
  (R 45 252 → 40 183).

### Jakość i tryb „Ultra” (LOD)

„Jakość planet i ringu” (`OPTIONS.planetQuality`, zapis `sc_planet_quality`) → `HALO_QUALITY`
(low / medium / high / ultra: mapy 4K / 8K / 12K / 16K, MSAA, CDLOD); zmiana w biegu =
`ring.setQuality` (ponowny bake map). Blok `lod` per jakość (`haloQualityLod`): low / medium / high
= progi strojone w demie (`HALO_LOD_BASE`), **ultra** = `HALO_LOD_ULTRA` (prośba użytkownika
2026-09-25: z daleka okna budynków i więcej detalu):

| próg | bazowo | ultra |
|---|---|---|
| wygaszanie okien i wzorów (`uDetailScale`) | 1 | 1,8 |
| opadanie miasta z odległości kamery [j.] | 17 000–30 000 | 36 000–64 000 |
| kawałek miasta od / budynek opada [px] | 1,0 / 0,6–1,6 | 0,55 / 0,3–0,9 |
| kawałki miasta naraz | 96 / 128 | 192 / 256 |
| drzewa: siatka / wysokość kamery [j.] / rozmiar [px] | 128 / 2 500 / 1,5 | 192 / 4 200 / 0,9 |
| detal megastruktury [j.] | 14 000–20 000 | 26 000–38 000 |
| kompleks portu obcinany poniżej [px] | 3 | 1,5 |

### Budżet w grze (headless Chrome, 1920×1080, 2026-09-25)

Cała klatka gry (wszystkie passy Core3D) z ringiem w kadrze: 41–54 draw calle;
`haloRings.update` 0,1–0,3 ms CPU; „Ultra” w kadrze miasta do ~11 mln trójkątów. Bez błędów
shaderów.

### Usunięte przy porcie

`src/3d/planetaryRing3D.js`, `src/3d/ringCity{Assets,BakedSurface,BatchedBuildings,Buildings,
Flight,Infrastructure,Mood,SkyDome,Surface,Traffic,ZoneGrid}.js`, `ringMegastructureVisuals.js`,
`ringColorConfig.js`, `src/ui/ringColorTunerPanel.js`, `src/ui/zonePainterUI.js`, hook
`__planetaryRingsDebug` (i suwak masy ringu w panelu mas destruktora). Obwiednia promieniowa
i promień stacji: `computeHaloRingLayout` (`haloRingLayout.js`) zamiast
`computePlanetaryRingLayout` / `computeRingStationOrbitRadius`. `assets/synthcity` używa już tylko
stare demo `dema/ringprocedural.html`.

### Testy

Usunięte (sprawdzały źródło starego ringu): `ringArcGeometry`, `ringBakedCitySurface`,
`ringCityFlight`, `ringCityMood`, `ringCitySurfaceFrame`, `ringCityTraffic`, `ringColorConfig`,
`ringLegacyCleanup`, `ringLogisticsBand`, `ringMegastructureVisuals`, `ringPerformanceLod`,
`storefrontInstance`. Przepisane: `shadowShaftsQuality` (okluder z `haloRingGame.js`),
`scaleTuning`, `ringPlanetAnchoring`, `hudRadarWiring`, `haloRingLayout`,
`helpers/beamShotHarness.mjs`. Nowy `haloRingGame.test.mjs` (planety i obrót, stacja-port, płyta,
tranzyty, ściany portu, obrys statku, LOD ultra, wpięcie w index.html i UI).
Testy dema: `haloRingLayout.test.mjs` (geometria, płaszczyzna gry na środku, widoczność z kamery gry),
`haloRingRoofPlan.test.mjs` (detal na dachu, doki wpięte w podłogę w pasie z = 0, tunele tranzytów
przez całą płytę, determinizm), `haloPortK7.test.mjs` (K-7 na podłodze, miejsca rozłączne,
osie tranzytów co 90°, strefy, kołnierz w kolizjach), `haloPortTraffic.test.mjs` (port w formacie
ruchu v2), `haloPortBays.test.mjs` (zatoki: stanowiska, pasy, aleja, kadłuby gracza, dokowanie
każdym kadłubem, scena kompleksu, port bez udawanego życia), `haloRingLandmarks.test.mjs`
(megabudowle: sektory, place pod płaszczyzną gry i z dala od portu, teren, bryły na placu,
wariant Halo).

### Narzędzie: zrzuty prawdziwej gry

`node .tmp/halo-game-shots.mjs --out <katalog> [--cfg shots.json] [--q "haloAt=hall"] [--goto transit]`
— Vite + headless Chrome (CDP), gra z `?dev&haloTest=earth`, start trybu jednoosobowego, kadry
ustawiane przez `HaloRingDebug` (`js` w `shots.json`), po kadrze statystyki ringu, draw calle,
trójkąty, pozycja statku i opcjonalne `post` (wyrażenie liczone po czekaniu). Start gry headless
trwa 1–2 min (skrypt czeka do 4 min i wypisuje postęp ładowania).

### Do przestrojenia (otwarte)

- `uRingShadow*` w `planet3d.assets.js`: dziś promień = środek obwiedni, zasięg ×1,15 (jak stary
  ring); docelowo krawędź kadłuba 41 800, zasięg ≈ 1 952 (szerokość dachu) — wzorzec: analityczny
  `haloRingBlock` z kamery kinowej dema.
- kokpit: przycisk lotu nad ringiem (dawny `RingCityFlight`) wyłączony z opisem „w przygotowaniu”
  — docelowo kamera kinowa dema (`dema/halo_ring_demo.js`, dynamiczny near).

## Po porcie (gameplay)

- dokowanie gracza w hali K-7: rejestr stanowisk `createPortRegistry` + automat `PortDocking`
  (`haloPortDocking.js`) z napędem gry zamiast modelu lotu K-7; do tego czasu terminal stacji
  działa w całej hali (`terminalRange`), stanowiska stoją wolne;
- wiązki (beam, Hexlance) przechodzą przez płytę — blokują ją tylko pociski;
- ruch NPC: dziś porty stacji-portu na płycie przed bramą hali; kolejki portu z ruchu v2
  (`buildHaloPortTrafficLayout`) przy wdrożeniu ruchu v2 — ring nie ma ruchu zastępczego
  (`haloRingTraffic.js` usunięty 2026-09-24);
- podzielony ekran: ring ukryty (RTE na jedną kamerę) — potrzebny drugi zestaw uniformów kamery;
- działki na dachu (`plan.lanes.rowA/rowB`) → budynki gracza (krok 3 ekonomii).
