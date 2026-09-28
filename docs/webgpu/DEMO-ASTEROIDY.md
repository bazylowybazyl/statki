# Demo WebGPU: nowe pole asteroid — sceny, światło wolumetryczne, pioruny

`dema/asteroidy-webgpu.html` (+ `dema/asteroidy-webgpu.js`, moduły w `dema/asteroidy-webgpu/`).
Port dema WebGL `dema/asteroidy.html` na `WebGPURenderer` + TSL — **te same dziesięć scen**
(klawisze 1–9, 0) — plus to, czego WebGL nie robi: światło wolumetryczne z cieniami skał, setki
świateł w jednej siatce, nowe pioruny, iskry na GPU. Gra, `Core3D` i demo WebGL bez zmian.
Start: `npm run dev` → `/dema/asteroidy-webgpu.html` (parametry: `?scene=storm&zoom=0.5&lights=512`).

## Sceny

| Klawisz | Scena | Co pokazuje |
|---|---|---|
| 1 | Galeria typów | skała neutralna, 7 rud, skała energetyczna — z minerałami (kryształy, lód, uran, kwarc) |
| 2 | Galeria kształtów | 10 rodzin × 4 warianty |
| 3 | Olbrzymy | 5 brył z tunelami / szczelinami / jaskinią; ▶ przelot = autopilot trasą, przekrój pod stropem |
| 4 | Olbrzym w polu | Labirynt na obrzeżu gęstego pola (Enter = przelot) |
| 5 | Gęste pole | Atlas + eskorta w rdzeniu pola |
| 6 | Przelot | radialnie od słońca w głąb pola — coraz ciemniej |
| 7 | Głąb pola | noc: słońce przesłonięte, świecą reflektory i skały |
| 8 | Rzadki pas | pełne słońce |
| 9 | Pas Kuipera | lodowe pole |
| 0 | Burza | skały energetyczne w mroku, pioruny (P = piorun na żądanie, działa też w innych scenach) |
| G | Kopalnia | skała testowa (typ z panelu), drony z laserami, ładunki, wiązka ściągająca, skaner — fizyka wydobycia (`docs/ASTEROIDY-FIZYKA.md`); tryb G działa też w scenach pola |

Miejsca scen liczone jak w demie WebGL (`world.js`: `findSpot`, `freeSpotNear`, `findDeepSpot`,
`findSparseSpot`, `findStormSpot`, rząd olbrzymów i olbrzym pola z wykluczeniem skał). Cień pól
(`FieldSunOcclusion.precomputeAll`) liczony raz na starcie (~1 s), jak na ekranie ładowania gry.

## Moduły

| Plik | Co robi |
|---|---|
| `world.js` | słońce, mapa układu, `AsteroidBeltField`, miejsca wszystkich scen, olbrzymy, cień pól |
| `rockBank.js` | bank 40 kształtów pieczony w TSL do tablic tekstur, odczyt promienia (`radiusAt`), siatki LOD |
| `rockNoise.js` | objętość szumu skał 64³ i szumu ośrodka 96³ (kłęby, włókna) — compute do `Storage3DTexture` |
| `rockMaterial.js` | `RockNodeMaterial` (programy powierzchni typów), mapa cienia skał; rozbłysk pęknięć przy uderzeniu pioruna (`S.strikes`), poświata krawędzi w mroku |
| `rockLayers.js` | warstwy pasm pola (komórki z budżetem, LOD per skała) + `RockSet` (skały podane wprost — galerie); dopisywanie minerałów |
| `minerals.js` | minerały (port `rockMinerals3D.js`): szablony z map promienia, szkło z załamaniem i śledzeniem ściany wyjścia graniastosłupa |
| `lights.js` | siatka świateł (≤ 1536, listy komórek), `GridLighting` dla three, światła statków (profile `FIELD_SHIP_LIGHTS`, `CAVE_SHIP_LIGHTS`) |
| `spotShadows.js` | **atlas map cienia** (2048 × 1024 HalfFloat): kafel 2 × 2 na reflektory dalekie statku, kafel 1 × 1 na każdy reflektor boczny; rzucający cień wybierani na CPU w niskim LOD |
| `volumetrics.js` | **światło wolumetryczne** — ośrodek (froxele, compute), dno ośrodka, `sample(P)` dla materiałów |
| `storm.js` | burze: symulator z `src/game/asteroidStorms.js`, nowy kształt i przebieg piorunów, łańcuch świateł kanału, rozbłyski skał, łuki, trzaski |
| `sparks.js` | iskry na GPU (compute: emisja z kolejki, ruch; render smugami) |
| `giants.js` | olbrzymy (port `giantRock3D.js`): SDF z workerów, pieczenie światła w compute, raymarching z głębią i przekrojem |
| `ship.js` | kadłub jako kwad z tekstury (normalna z luminancji), dysze, lampy pozycyjne |
| `fog.js` | płaty mgły z `beltDust3D.js` (płytkie w passie gry, głębokie w passie tła) |
| `minedRocks.js` | skały w WYDOBYCIU (`src/game/asteroidMining.js`): atlas 3D siatek ciał (compute), zewnętrze materiałem skał w trybie `carve`, wnętrze raymarchingiem (ściany otworów i przełomy: warstwy, ruda, rdzeń, żar cięcia), okruchy jako skały banku |
| `miningRig.js` | kopalnia w demie: drony z laserami i reflektorami, ładunki S–XL, detonacja, wiązka ściągająca, skaner, HUD |
| `sky.js` | gwiazdy, mgławica, zasłona gęstego pola, noc w polu, błyski burzy w chmurach |
| `sunMap.js` | mapa pola nad kadrem (RGBA16F): transmitancja słońca, pył, lód, burza |
| `dynamics.js`, `glowSprites.js`, `surfaceLighting.js`, `tslCommon.js` | wybuchy / pociski / flary / świecące skały, duszki blasku, model światła powierzchni, wspólne TSL (ACES gry) |

## Decyzje

- **Pył fizyczny usunięty (decyzja użytkownika 2026-09-27: „zbyt gęsty i agresywny, wdrożę go
  inaczej”).** Usunięty cały moduł `dust.js` (compute 2²¹ drobin), suwaki i przełączniki; pole
  odległości kadłubów (służyło tylko pyłowi) też. Mgła (płaty) zostaje.
- **Światło wolumetryczne zamiast pyłu jako ośrodka smug.** Płyta wokół płaszczyzny gry
  (z od −760 do +380, miękkie brzegi), gęstość = pył pola z mapy pola × szum 3D (kłęby 5 oktaw +
  włókna grzbietowe, kontrast progami; szum GRADIENTOWY — szum wartości progowany kontrastem układał
  się w kratkę, smugi miały prostokątne plamy wyrównane do ekranu; rozkład kanałów dopasowany do
  dawnego, więc pokrycie pyłu to samo). Siatka froxeli wyrównana do kamery ortho, zakotwiczona
  w świecie (bez pływania), ~4–6 px na kolumnę, najwyżej ~420 kolumn w poprzek, 40 plastrów.
  Jeden przebieg compute na kolumnę (komórka siatki świateł wspólna dla całej kolumny): wszystkie
  światła, faza Henyeya–Greensteina (g = 0,3), bliskie pole lampy ~1/d (smuga zaczyna się jasno),
  cienie z atlasu, ekstynkcja; w teksturze 3D całka od góry (rgb) i transmitancja (a).
  Złożenie bez bufora głębi, jeden właściciel piksela: kadłuby i olbrzymy dodają całkę do swojej
  wysokości (`sample()`, pod dnem ośrodka pełna kolumna), **skały gry i minerały na nich — do
  stropu warstwy skał** (`S.rockLayerTop`, z = 0), a „dno ośrodka” (kwad z testem głębi na
  z = −29 000, pod wszystkim, co rysuje pass gry) kładzie pełną kolumnę tylko na tło.
  Dlaczego strop warstwy, a nie powierzchnia (drugie zgłoszenie użytkownika 2026-09-27: „w nocy
  kawałek dużej skały jest bez światła, a reszta robi się bardzo jasna”): widoczna półkula dużej
  skały PLAY sięga od z ≈ −2000 do ≈ 0, więc przechodzi przez dno płyty (−760). Stoki pod dnem
  łapały pełną, jasną kolumnę smugi (białe koło), wierzch nad dnem tylko część (ciemny „kawałek”);
  skała cała pod dnem była białą tarczą. Zrzut diagnostyczny (barwa: pod / nad dnem) pokrywał się
  z plamami ze zrzutów użytkownika. Teraz cała skała ma jedną mgłę (kolumna nad warstwą skał,
  ~30% pełnej), pełna kolumna i cienie skał w smudze zostają nad tłem między skałami. Świecący
  pył nad skałą dokłada jej światła (`S.fogLit` 1,5 × albedo × rgb kolumny, mocniej ku górze —
  rozproszenie w dół ≈ to, które widzi kamera). Wcześniejsza wersja (kwad tuż pod zBot +
  `sample()` = (0, 1) pod dnem) usuwała tylko podwójne liczenie pyłu, nie sam podział skały.
  Odczyt: filtr B-spline z 4 próbek trójliniowych (trójliniowy robił schodki na wąskich smugach).
- **Każde światło ma własny ułamek rozpraszania w pyle** (`scatter`, L1.w): reflektor daleki 0,8,
  boczny 0,16 (stożek jest szeroki — w kolumnie zbiera ~4× więcej niż daleki), światło dookoła
  0,06, czerwień lamp 0,2, kanał pioruna 0,12, świecące skały 0,1–0,12, dysze 0,18, flary 0,02
  (setki flar dawały kolorowe „bokeh” na cały kadr). Stożki reflektorów z brzegiem smoothstep² —
  bez twardych „łopat wiatraka”.
- **Reflektory boczne mocniejsze niż w WebGL** (prośba użytkownika: „tam ledwo świeciły”): moc
  1,0 → 2,8, zasięg 0,55 → 0,9 długości kadłuba (800–3400 j.), stożek 110° → 76°, pochylenie
  16° → 10°, każdy z własną mapą cienia skał.
- **Reflektory dalekie (dziób) 36°** — 30° było za wąsko (prośba użytkownika 2026-09-27:
  „delikatnie poszerz”).
- **Głęboka noc — czarna poza światłami** (prośba użytkownika 2026-09-27: „jeszcze ciemniej,
  wciąż dużo rzeczy widać”). Pomiar A/B w głębi pola bez świateł statku: kadr rozjaśniały flary
  (~połowa), przesiane słońce przy T ≈ 0,03, otoczenie i poświata krawędzi. Teraz:
  - słońce w rdzeniu gaśnie szybciej niż transmitancja: poniżej T = 0,12 jasność
    ∝ T · smoothstep(0, 0,12, T) (`nightKnee` w `asteroidy-webgpu.js`; dostają ją materiały, mgła,
    niebo i olbrzymy, miejsca scen i HUD liczą z samej T) — w głębi ~7× ciemniej, gęste pole
    (T ≈ 0,18) bez zmian;
  - bez poświaty krawędzi skał w mroku, otoczenie × (1 − mrok · 0,96) zamiast 0,92;
  - flary słabsze (światło × 0,55, blask 3,2 → 1,7) i domyślnie mniej (liczba świateł 96 → 64);
  - gwiazdy w prześwitach zasłony gasną w rdzeniu (słońce przy kamerze < 0,1).
  Wynik: kadr głębi bez świateł statku średnio 4,1 → 1,3 (na 255), pikseli > 8 z 12% do 1%.
  Zasłona nieba z łuną od strony słońca i błyski burzy w chmurach zostały.
- **Pioruny (nowe):** kanał główny z meandrami i zygzakiem, gałęzie z pod-gałęziami (część
  „martwa” — świeci tylko w liderze), końce na GÓRNEJ powierzchni skał od strony partnera i kanał
  wygięty łukiem ku kamerze (inaczej skały po drodze go zasłaniały). Przebieg: lider krokowy
  0,14–0,28 s (skoki z przestojami, jasny czubek), udar główny (biel), 0–3 udary powrotne po tym
  samym kanale (drobne przesunięcie = migotanie), poświata stygnącego kanału (fiolet, ~0,4 s).
  Render: segmenty-kapsuły z mieszaniem MAX (bez jasnych kropek na łączeniach), rdzeń HDR cienki
  z dolną granicą w pikselach. Światło: łańcuch świateł siatki wzdłuż kanału (co ~450 j.),
  czubek lidera, gałęzie, błyski w chmurach głęboko pod płaszczyzną. W miejscu uderzenia:
  rozbłysk pęknięć skał energetycznych, snop iskier na GPU, błysk i stygnący żar, łuki po skale.
- **Kadłub nie łapie własnych lamp** (flaga właściciela w świetle) — jak wcześniej.
- **Precyzja.** Lokalny początek sceny przy kamerze (double na CPU, przeskok po 20 tys. j.);
  faza szumu ośrodka i mgły liczona na CPU; `renderer.highPrecision = true`.

## three r183 pod WebGPU — ustalenia z dema

- **Limit 12 buforów uniform na etap shadera** (domyślny): każdy `uniformArray` to osobny bufor.
  Materiał skał przekroczył go po dodaniu danych cieni (16 > 12, walidacja pipeline'u) —
  tablice typów skał i dane atlasu cieni spakowane w po jednej tablicy.
- **`renderer.setAnimationLoop(null)` zdejmuje tylko callback** — wewnętrzna pętla rAF działa
  dalej, a numer klatki węzłów (`nodeFrame.frameId`) rośnie tylko w niej. `pass()` i `BloomNode`
  mają `updateBeforeType = FRAME`, więc kilka `pipeline.render()` w jednym zadaniu renderuje passy
  sceny RAZ (reszta pokazuje obraz pierwszego). Demo przy krokach ręcznych (`__demo.step`) woła
  `renderer._nodes.nodeFrame.update()` (pole prywatne); w pętli rAF nie trzeba.
- `NodeMaterial.setupDepth` buduje `depthNode` PRZED `fragmentNode` — wynik raymarchingu
  (olbrzymy) to zmienna (`toVar`) liczona w węźle głębi i czytana przez fragment.
- `Storage3DTexture` z `type = HalfFloatType` → `rgba16float`; `textureStore` z compute, potem
  próbkowanie w materiałach i w innym compute (`texture3D(...).level(0)` = `textureSampleLevel`).
- `THREE.MaxEquation` w `CustomBlending` → operacja `max` (czynniki muszą być `One`).
- Kafle atlasu: `renderTarget.viewport` (piksele od lewego górnego rogu); `renderer.clear()`
  czyści cały cel (nożyczki ignoruje), więc atlas czyszczony raz na klatkę.
- Nazwy zmiennych `Loop` zależą od pozycji parametru, nie od zagnieżdżenia — zagnieżdżone pętle
  dostają jawne `name`.
- Wcześniejsze ustalenia (cele tablicowe, padding 256 B odczytu, `Return()` w compute, limity
  urządzenia, `positionViewDirection` w ortho, własny `LightingModel`) — bez zmian, patrz historia pliku.

## Do portu w grze

Demo to warstwa RENDERU nowego pola asteroid na WebGPU. Dane i logika pola już są w grze
(`src/game/`: `AsteroidBeltField`, `FieldSunOcclusion`, `asteroidStorms.js`, `asteroidGiants.js`
+ `GiantBuilder`, `asteroidRockKinds.js`) — demo czyta je bez kopii. Odpowiednik WebGL (klej
`src/3d/asteroidBelt3D.js`, warstwy `src/3d/rocks/*`, `beltDust3D`, `beltStorm3D`, `fieldLights3D`)
usunęło zadanie 21 — demo WebGL `dema/asteroidy.html` działa z tagu `webgl-baseline`. Klej WebGPU
(`start()` + `frame()` w `dema/asteroidy-webgpu.js`) jest w grze jako moduł pasa — patrz „Stan w grze” niżej.

**Moduły produkcyjne** (`dema/asteroidy-webgpu/`, każdy z komentarzem API w nagłówku):

| Moduł | Tworzenie | Co klatkę |
|---|---|---|
| `rockBank.js` | `await new RockShapeBankGPU().bake(renderer)` — 40 kształtów, siatki LOD (`ROCK_LODS`, `pickRockLod`), `radiusAt()` na CPU | — |
| `rockNoise.js` | `createRockNoiseVolume(renderer, 64)`, `createMediumNoiseVolume(renderer, 96)` | — |
| `rockMaterial.js` | `createRockShared(bank, noise)` (wspólne uniformy: słońce, otoczenie, czas, typy, `volume`, `strikes`), `RockNodeMaterial({ shared, backdrop })` | `shared.time`, `shared.sunDir`, `shared.sunOcc` |
| `rockLayers.js` | `RockLayer({ scene, bank, material, field, bandIndex, perspective, zOf, sunT, minerals, minPx, maxLod })` — pasmo PLAY w passie gry (ortho), RUBBLE/MID/DEEP w passie tła; `RockSet` — skały podane wprost (np. skały z HP) | `update({ cam, viewW, viewH, focalPx, time, budgetMs })` (komórki z budżetem czasu, LOD per skała), `setOrigin()` przy przeskoku początku, `forEachLoaded(cb)` do trafień i świateł |
| `minerals.js` | `MineralTemplates(bank)`, `MineralMaterial`, `MineralLayer` (podpinany do warstwy / zestawu) | przez warstwę |
| `lights.js` | `LightGrid`, `renderer.lighting = new GridLighting(grid)` (materiały czytają siatkę jak światła three), `addShipLights(...)` z profilami `FIELD_SHIP_LIGHTS` / `CAVE_SHIP_LIGHTS` (runtime świateł gry `shipLightRuntime.js`) | `grid.begin()` → `add(...)` → `build(x0, y0, x1, y1)` (prostokąt kadru w scenie) |
| `spotShadows.js` | `ShadowAtlas({ bank, source: playMaterial })`, `grid.shadows = atlas` | `begin()` → `request()` (z `addShipLights`) → `gather(playLayer)` → `render(renderer)` |
| `volumetrics.js` | `VolumeLight({ renderer, grid, fieldMap, scene: fgScene, maxW, maxH })`, `shared.volume = volume` PRZED kompilacją materiałów | `update({ camX, camY, zoom, viewW, viewH, time, originX, originY })` + `compute()` po `grid.build` i `atlas.render` |
| `sunMap.js` | `FieldMap` (R słońce, G pył, B lód, A burza) | `update({ cam, viewW, viewH, focalPx, originX, originY, sunT, field })` |
| `storm.js`, `sparks.js` | `StormSystem({ scene, field, shared, sparks })`, `Sparks({ renderer, scene })` | `storm.update(frame, { layer, zOf })`, `addLights`, `addGlows`; `sparks.update(dt, zoom)`, `shift(dx, dy)` przy przeskoku |
| `giants.js` | `GiantView` (SDF z workerów `GiantBuilder`, `bake(sun)`) | `update(frame, focus)`, `setVisible()` |
| `fog.js`, `glowSprites.js`, `surfaceLighting.js`, `tslCommon.js` | `BeltFog`, `GlowSprites`, `SurfaceLightingModel`, ACES gry i oktaedry | `fog.update`, `glow.begin/add/commit` |

**Tylko pokaz — nie przenosić:** `world.js` (miejsca scen, słońce dema), `ship.js` (`DemoHull`:
kadłub jako kwad tekstury — w grze kadłuby z Core3D, trzeba im dodać `volume.sample` jak
w `HullNodeMaterial.setupOutput`), `dynamics.js` (wybuchy, pociski i flary dema; flary tylko dopełniają
liczbę świateł), `sky.js` (w grze tło ma własne niebo — z dema warto wziąć zasłonę pola i nocną
łunę), galerie, autopilot i panel w `asteroidy-webgpu.js`.

**Kolejność klatki** (`frame()` dema): ruch i kamera → przeskok lokalnego początku sceny (double na
CPU, co 20 tys. j.: `setOrigin` warstw, `sparks.shift`) → kamery (gra: ortho z góry, z = 30 000,
near 1, far 60 000; tło: perspektywa) → słońce → kadłuby → `layer.update` (gra + 3 pasma tła) →
olbrzymy → źródła światła → `fieldMap.update` → mgła → burza → siatka świateł i atlas
(`begin`/`request`/`gather`, `build`) → `shadows.render` → `volume.update` + `compute` → iskry →
duszki → niebo → `pipeline.render()` (pass gry + pass tła, złożenie gra + tło·(1 − alfa gry),
bloom, ACES gry).

**Warunki, które łatwo zgubić przy porcie:**
- Skały pasma PLAY leżą POD płaszczyzną gry (`zOf = −1,45 r · max(skala)`, z minerałami 1,62),
  kadłuby na z ≈ 0 zawsze nad nimi; ośrodek smug sięga od z = −760 do 380.
- Każdy materiał passa gry łączy ośrodek przez `volume.sample(P)` (`col·a + rgb`): kadłuby
  i olbrzymy w swoim `positionWorld`, skały gry i minerały na nich z z = max(P.z,
  `rockLayerTop`); kwad dna ośrodka jest w scenie passa gry (renderOrder 12, przed duszkami)
  i leży POD wszystkim (z = −29 000) — każda nowa powierzchnia z zapisem głębi w passie gry musi
  sama wołać `sample()`, inaczej zostanie bez pyłu.
- Transmitancja słońca do renderu idzie przez `nightKnee` (głęboka noc), do logiki — sama T.
- Limit 12 buforów uniform na etap shadera (każdy `uniformArray` to bufor) — w materiale skał
  jest już na styk; nowe tablice pakować do istniejących.
- Siatka świateł to kopia w 3 demach (tu, `bronie-webgpu/lightGrid.js`, `rakiety-webgpu/lights.js`):
  ta wersja ma rozpraszanie w pyle per światło (L1.w), mapę cienia (L3.z) i właściciela (L3.w).

**Wydajność** (RTX 5080, 2560 × 1440, zegar GPU z panelu): 1,5–3 ms w scenach pola (skały
0,4–1,4 mln trójkątów, ośrodek ~100 tys. kolumn × 40 plastrów, atlas 6–24 map cienia), ~4 ms przy
1024 światłach. CPU dema w headless 6–13 ms na klatkę — do zmierzenia w grze (`layer.update`
z budżetem, `grid.build`, `atlas.gather`, burza).

**Rozgrywka — co jest w demie, a czego nie ma:**
- kolizje statków z olbrzymami: są (`giant.collideCircle` na SDF, `collideShipWithGiants`);
  z małymi skałami: brak (leżą pod płaszczyzną — statki latają nad nimi);
- rudy i minerały: wygląd + **fizyka wydobycia** (scena Kopalnia, `docs/ASTEROIDY-FIZYKA.md`): laser drona kopie
  do rdzenia (skład skorupa → płaszcz → rdzeń), piła, ładunki z pękaniem zależnym od materiału, odłamy i okruchy,
  wiązka ściągająca do ładowni; logika w `src/game/asteroidMining.js` (bez three, testy), w grze od zadania 21b (platforma `asteroidMiningRig.js`, tryb `N`; `docs/ASTEROIDY-FIZYKA.md` § „W grze”);
- niszczenie skał pociskami: brak (pociski dema wybuchają na kole skały — sam efekt);
- burze: symulator gry (`StormSimulator`), pioruny i trafienia tylko wizualnie, bez obrażeń;
- cień pól na słońcu: `FieldSunOcclusion.precomputeAll` (~1 s) — w grze na ekran ładowania.

### Stan w grze (zadanie 21, 2026-09-28)

Moduły dema są w `src/3d/asteroids/` pod tymi samymi nazwami (poza: `sunMap.js` → `fieldMap.js`, `sky.js` →
`beltVeil.js` — sama zasłona pola, nocna łuna i błyski burzy nad niebem gry; `lights.js` → siatka gry
`src/3d/fx/lightGrid.js` z 12). Nowe: `asteroidBelt.js` (klej `start()` / `frame()`), `beltMedium.js` (ośrodek
wydzielony z `volumetrics.js` jako jeden obiekt gry — czytają go skały, minerały, olbrzymy i kadłuby przez hak
`hullVolume`), `src/game/asteroidBeltGiants.js` (miejsca, budowa, kolizje). Opis dla agentów: `agents.md` § „Pas asteroid”.

Różnice względem dema (świadome):
- Złożenie: passy Core3D (PLAY i płytka mgła w passie gry, warstwa 0; RUBBLE/MID/DEEP, głęboka mgła i zasłona w passie
  tła, warstwa 1), post gry (bloom ×3 `BLOOM_ZGODNOSC_WEBGL`, ACES gry; barwy pasa przez kolano bloomu z 22 —
  `beltBloomKnee`, nadmiar ponad próg ×1/3 jak poświata dema) — nie `RenderPipeline` dema. Niebo gry z 05 (mgławica,
  gwiazdy) zamiast nieba dema; kwad dna ośrodka w passie gry z renderOrder −50 (przed efektami gry).
- Współrzędne: początek przy kamerze z `Core3D.fx.origin` (przeskok 20 tys. j. jak w demie, ale wspólny z pulami efektów);
  shadery pasa bez `positionWorld` (varying pozycji lokalnej, środek płatu mgły z CPU, mapa pola i ośrodek w układzie
  lokalnym). Iskry przesuwa kernel `FxPoolOrigin`, nie własne `shift`.
- Światło: materiały pasa gaszą światła sceny Core3D i biorą słońce pasa (`BELT_SUN_LIGHT`); światła statków gry
  (`addShipLights`, profil pola / jaskini) dla gracza i najbliższych środka kadru — `maxLitShips` 6 (ryzyko `ITEM_CAP`
  z 12); flar dema (`dynamics.js`) nie ma, światła wybuchów i pocisków dają efekty gry (17–19) przez `Core3D.fx.lights`.
  Świecące skały (kryształ, uran, energetyczna) jak w demie; światła dysz z dema — nie przeniesione.
- Kadłuby: materiał kadłubów gry (04) czyta ośrodek (`hullVolume`) i — od scalenia 18-C — siatkę świateł
  (`hullEffectLights`): w głębokiej nocy kadłub świeci światłem dookoła, reflektorami innych statków, piorunami
  i świecącymi skałami (własne lampy kadłuba pomija właściciel siatki). Flar dema nie ma, więc noc jest ciemniejsza.
- Burza: los efektów z `fxRandom` (harness ziarni go razem z `Math.random`) zamiast `Math.random`.
- Podzielony ekran: jeden widok pasa = suma kadrów obu graczy (strumień skał, światła, ośrodek).
- Rozgrywka: kolizje statków (gracz, P2, NPC) tylko z olbrzymami (`collideShip`: koła wzdłuż osi, koło ≤ pasmo SDF,
  odbicie 0,3, bez obrażeń), pociski gasną w skale olbrzyma (`pointBlocked`); 5 olbrzymów przy rdzeniach pasa
  (pierwszy = Labirynt dema w tym samym miejscu), budowa SDF w workerach, gdy kamera / statek < 420 tys. j.
- Zrzuty obok dema: `scripts/webgpu/asteroidy-demo.mjs` (demo) i sesja `pas` w `zrzuty.mjs` / `asteroidy-gra.mjs` (gra)
  w tych samych miejscach i zoomie; burza powtarzalna (`STORM_STAGE`: ten sam los symulatora, piorun i błysk w chmurach) —
  bez niej fioletowa łuna zależy od chwilowego błysku w chmurach (rozproszenie 0,8).

**Wydajność w grze — stan końcowy** (po scaleniu 15–19 i 22; headless Chrome, RTX 5080, 1920 × 1080, czas
rzeczywisty; `asteroidy-gra.mjs --wydajnosc`: konfiguracje w świeżych stronach, 3 przebiegi na przemian, mediana median,
w nawiasie rozrzut przebiegów; inne sesje pracowały na tym samym GPU/CPU, a bitwa co przebieg toczy się inaczej —
czasy klatki bitew są szumem, koszt pasa mierzy A/B niżej):

| konfiguracja | klatka [ms] | CPU `Core3D` [ms] | GPU [ms] | CPU pasa [ms] | draw calle |
|---|---|---|---|---|---:|
| próżnia, sam gracz, zoom 0,12 | 3,96 (3,93–3,96) | 3,18 | 0,33 | — | 24 |
| gęste pole, sam gracz, zoom 0,12 (6,5 tys. skał, 28 świateł) | 5,37 (3,19–6,01) | 4,48 (2,82–5,07) | 1,85 | 0,67 (0,37–0,75) | 53 |
| gęste pole, zoom 1 (1522 skały, 6 map cienia) | 5,45 (4,54–6,60) | 4,55 (3,87–5,22) | 1,49 | 0,51 (0,34–0,62) | 55 |
| bitwa 24 × 24 w próżni, zoom 0,12 | 13,83 (10,25–15,59) | 5,97 (4,84–6,24) | 0,77 | — | 99 |
| bitwa 24 × 24 w gęstym polu, zoom 0,12 | 8,09 (7,35–17,88) | 4,71 (4,40–8,38) | 2,34 | 0,70 (0,52–1,02) | 129 |

A/B w jednej stronie (`asteroidy-gra.mjs --ab --rundy 3`, bitwa 24 × 24 w polu, warianty na przemian, mediany rund):
bez pasa 2,93 ms CPU `Core3D` / 0,86 ms GPU; pas bez map cienia 3,36 / 2,29; pas domyślny (`maxShadowShips` 2: 4–7 map)
3,80 / 2,28 (krok pasa 0,40 ms); pas z mapami dla wszystkich 6 statków (11–12 map) 5,21 / 2,30. Narzut pasa w bitwie:
~0,9 ms CPU i ~1,4 ms GPU. Dwie poprawki po pierwszym pomiarze (przed nimi ~2–3 ms CPU): bufory pasa bez
`DynamicDrawUsage` (three r183 wysyłał je przy KAŻDYM renderze, ~1 MB na klatkę przy zoomie 0,12) i budżet map cienia
(każda mapa to osobny render atlasu, ~0,1–0,2 ms CPU). Siatka świateł w bitwie do 8,8 tys. elementów, 0 odrzuconych
(`ITEM_CAP` 262 tys.). Do 23: mapy cienia w jednym renderze atlasu zamiast renderu na mapę, koszt passów pasa przy
dalekim zoomie (kubełki LOD, 8 płatów mgły).

## Uproszczenia względem dema WebGL i braki

- Kadłuby to kwady z tekstury: bez heksów / belek, lakieru, własnych lamp w shaderze kadłuba,
  cieni kadłubów (SDF) i odblasku.
- Bez przesłaniania słońca suwakiem siły i suwaka gęstości pól (wymagają przeliczenia cienia pól);
  jest przełącznik „słońce przesłonięte”.
- Szum skał i olbrzymów bez mipmap (tekstury storage 3D) — przy mocnym oddaleniu drobny szum
  olbrzyma bywa ziarnisty.
- Cień w smugach rzucają tylko skały gry; minerały, kadłuby i olbrzymy nie.
- Pomiary wydajności — po stronie użytkownika (panel: FPS, CPU, GPU render / compute, światła,
  kolumny ośrodka, mapy cienia, draw calle). Orientacyjnie (RTX 5080, 2560 × 1440): 1,5–3 ms GPU
  w scenach pola, ~4 ms przy 1024 światłach.
