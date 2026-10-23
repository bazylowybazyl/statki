---
paths:
  - "src/3d/planet3d.assets*.js"
  - "src/3d/planetMaps.js"
  - "src/3d/earthBite*.js"
  - "src/data/earthBite.js"
  - "src/3d/moonSurface.tsl.js"
  - "src/3d/jupiterAtmosphere*.js"
  - "src/3d/saturnAtmosphere*.js"
  - "src/3d/gasGiantAtmosphere*.js"
  - "src/data/saturnAtmosphere.js"
  - "src/data/smallBodies.js"
  - "src/3d/smallBodyShape.js"
  - "scripts/planety/**"
  - "dema/planety-webgpu.html"
  - "src/3d/earthSpin.js"
  - "dema/planety-slup.js"
  - "scripts/webgpu/slup-demo.mjs"
  - "scripts/webgpu/korek-gra.mjs"
  - "tests/earthBitePlant.test.mjs"
---

# Planety, słońce, księżyce i małe ciała; generator map planet

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`planet3d.assets.js`** — aktywna warstwa planet/słońca (API globalne: `initPlanets3D`, `updatePlanets3D`, `drawPlanets3D`).

- **`scripts/planety/`** — generator map planet (Python + numpy, offline): Ziemia „zajechana” (oceany wypompowane na ring, przemysł, pył) z WIELKIM GRYZEM w środku Afryki (bryła 3D w grze: `src/3d/earthBite*.js`, dane `src/data/earthBite.js`) i Mars w trakcie terraformacji — z ETOPO 2022 i MOLA (domena publiczna). Ścieżki map `src/3d/planetMaps.js` (A/B: `?planety=stare`). Demo wypieku na materiałach gry (glob, płaskie warstwy, A/B, miejsca): `dema/planety-webgpu.html`. Opis: § „Planety i słońce”, `docs/PLANETY-GENERATOR.md`. Małe ciała (Ceres ze stolicą Unii Pasa, Westa, Pallas, Hygiea, Psyche, Pluton, Charon — mozaiki Dawn / New Horizons i proceduralnie): `male_ciala.py`, dane gry `src/data/smallBodies.js`.

## Planety i słońce

- MAPY Ziemi i Marsa z generatora (2026-10-08, `scripts/planety/`, `docs/PLANETY-GENERATOR.md`; decyzje użytkownika: Ziemia prawdziwa — kontynenty z ETOPO, Mars — stały wygląd, dziura po materiale na ring jako bryła 3D). Ścieżki, mgiełka, połysk i chmury per planeta: `PLANET_MAPS` (`src/3d/planetMaps.js` — gra i tło menu). Chmury: barwa z chromy tekstury (pył), jasność z maski. Mapy normalnych w konwencji shadera: R = wschód, G = północ (dawna `earth_normal.jpg` miała G odwrócony).

- WIELKI GRYZ ZIEMI (2026-10-21, decyzje użytkownika po A/B w demie: „ugryzione jabłko” zamiast kopalni na Saharze, rozmiar 0,46 R — do jądra, środek 10° N 15° E nad jeziorem Czad, wcięcie w obrysie fizyczne; 2026-10-22: BEZ klamer nad otworem — „wywal te 4 paski”, otwór trzyma pole siłowe; na dnie elektrownia „KOREK” z promieniem energii do orbity i windami do ringu — § „Elektrownia KOREK i doba Ziemi wokół osi ringu”). Kula gryzu o promieniu β(φ, ψ) ze środkiem C NA powierzchni (R = 1): β = radiusR · (1 + płaty · wL(ψ) + łuki zębów · wT(ψ)), wagi gasną ku dnu (dno okrągłe) — ŁUKI ZĘBÓW na brzegu z ostrzami do środka, bruzdy schodzą po ścianie. Kształt ANALITYCZNY: kula Ziemi wycina wszystko bliżej C niż β + `cutPad` (`uPitMode = 1`, discard), ŁATA = ściany i dno (C + β u) + kołnierz brzegu na kuli (`uPitMode = 2`), dziecko siatki kuli na tym samym grafie powierzchni (te same mapy, szew niewidoczny). Fragment łaty liczy wprost: normalną z gradientu β, cień ścian drugim przecięciem promienia ku słońcu z kulą gryzu (wyjście przez otwór = słońce, w skałę = cień), barwę skał, żar, pole siłowe ścian w języku tarcz (heksy tylko w plamach naporu, poświata pod kątem i w cieniu) i światło dna na ścianach („piec”: przy dnie pełne, ku brzegowi gaśnie do `forgeTop`). ŚCIANA (krytyk KOREK-a 2026-10-22: beżowo-liliowy „marmur” w poziome pasy — okładzina elektrowni wyglądała jak klatka na gołej skale, jama nie czytała się w głąb): skała płaszcza — perydotyt (oliwkowa czerń, zielonkawe bloki, rdzawe przebarwienia), głębiej ciemny brąz, BEZ pasów (plamy i smugi wzdłuż spadku: szum w kierunku od osi gryzu × głębokość), przypalona ku brzegowi (sadza w smugach — ciągnie przypalony pas wypieku brzegu) i przy jeziorze (szkliwo, czerwony żar skały); albedo ~0,03–0,09 — w słońcu niewiele jaśniejsza od metalu elektrowni. Nie wracaj do pasów ani do ridged value noise jako ciemnych linii (na płaskich fragmentach szumu linia rozlewa się w plamę „moro”). JEZIORO (~2 500 K: płyty zastygającej skorupy — Voronoi — szwy z żółtobiałym rdzeniem i pomarańczowymi brzegami, rzeki ze ścian, punkty hut): skorupa prawie czarna (albedo ~0,018 — słońce jej nie rozjaśnia), żar w grafie planety PO cieniu ringu, tylko przez ekstynkcję — świeci tak samo w dzień i w nocy. Detal drobniejszy niż piksel gaśnie do średniej, cienkie linie grubieją z zachowaniem energii (`pix = |fwidth(p)|` liczony POZA gałęziami) — z daleka bez migotania. Mgiełka we wnętrzu: masa powietrza z punktu, w którym promień widzenia wchodzi do otworu (normalna promieniowa ściany za limbem dawała mleczną taflę), × `pitAir` (atmosfera stoi nad otworem), welon w jamie bez zabarwienia (niebieskawy na ciemnej skale = liliowy połysk); kamera w jamie (kadry szczegółów dema) — bez powietrza (odcinek do kamery nie wychodzi z kuli). Nastawy: `EARTH_BITE_TSL` (`earthBite.tsl.js`); A/B 2026-10-22: `docs/PLANETY-GENERATOR.md` § Elektrownia KOREK. Połysk wody i światła miast z map nie sięgają ścian ani dna (`pitOwn`). Uniform `uBite` (vec4: C w układzie obiektu + radiusR) jest w `SURFACE_KEYS`, `CLOUD_KEYS` (chmury obracają się szybciej niż grunt — `earthBiteCenterIn` w `_orient` co klatkę; nad otworem chmur nie ma) i `RING_ATMOSPHERE_KEYS` (+ `uBiteEast`; dysk poświaty gaśnie nad otworem i nad wyciętym punktem limbu — WCIĘCIE W OBRYSIE). Geometria: przy C na limbie wcięcie w obrysie to PŁASKIE cięcie z łukami zębów o głębokości β²/2 (~680 km przy 0,46 R) — kula gryzu zdejmuje z powierzchni czaszę; przez otwór widać żarzące się ściany. Tło menu ma to samo (`createMenuEarthMaterial(…, { pitMode: 1 | 2 })`, poświata `createMenuAtmosphereMaterial(…, { bite: true })` z `uEarthInv`). Świadomie BEZ gryzu: tarcza cienia słońca (`pushShaftDiscWorld` + `discSunVisibilityCpu` — gryz zmienia przekrój Ziemi w płaszczyźnie gry tylko na bocznej krawędzi względem słońca, o ≤ β²/2; maska i lustro CPU zostają zgodne) i podkład radaru (`radarTerrain.js` pokazuje ciało ROZGRYWKI — studnie, objazdy i kolizje 2D bez zmian, gryz to obraz). β w TRZECH kopiach z jednych danych `src/data/earthBite.js` (blok JSON czyta Python): `scripts/planety/gryz.py` (`beta_brzeg` — wypiek brzegu: przypalony pas, hałdy, fronty koparek w łukach zębów, huty, obwodnica, tory wyrzutni masy, nocą poszarpana łuna; wnętrze ciemne, bez chmur, normalne płaskie), `src/3d/earthBiteShape.js` (CPU: siatki, lustra), `src/3d/earthBite.tsl.js` (`betaNode`). Zmiana wzoru = wszystkie trzy + ponowny wypiek Ziemi (`tests/earthBite.test.mjs`); A/B rozmiaru: `ziemia.py --gryz 0.30 --wyj .tmp/planety-gryz/030`, demo `dema/planety-webgpu.html?gryz=0.30&mapyGryz=.tmp/planety-gryz/030`, zrzuty demo `node scripts/webgpu/gryz-demo.mjs [--tag x --query …]`. Nowy uniform w grafie powierzchni = klucz w `SURFACE_KEYS` i w `uniforms` KAŻDEGO `DirectPlanet` (perObject czyta `material.uniforms[klucz].value`) i w atrapach testów (`planet3dTSL`, `jupiterAtmosphere`, `saturnAtmosphere`). Funkcje pomocnicze z `select` budują się jako `if` PRZED `main` — sprawdzenia „pierwszej gałęzi” w testach WGSL szukają w ciele `main`.

- Zrzuty map w grze: `node scripts/webgpu/planety-mapy-gra.mjs [--query planety=stare --tag stare] [--obok stare]`.

## Elektrownia KOREK i doba Ziemi wokół osi ringu

- DOBA ZIEMI WOKÓŁ OSI RINGU (decyzja użytkownika 2026-10-22: „winda ma być do ringu planetarnego”, wariant „Ziemia
  wokół osi ringu”; `src/3d/earthSpin.js`): oś obrotu prostopadła do płaszczyzny gry (ku kamerze), biegun obrotu =
  `EARTH_SPIN.poleLat / poleLon` (biegun północny), kwaternion siatki = baza (oś → +Z sceny) · obrót wokół osi obiektu
  (`DirectPlanet._spinQuat`, także chmury i soczewka). Ring gry jest w układzie Ziemi RÓWNIKOWY i stoi względem gruntu —
  ring rozgrywki (kolizje, K-7, tranzyty) bez zmian. Kamera gry patrzy na biegun, tarcza obraca się jak koło, gryz (10° N)
  krąży PRZY KRAWĘDZI TARCZY — widać wcięcie w obrysie, korek na dnie jest pod powierzchnią. Kod, który ustawia gryz na
  tarczy, obraca wokół Z sceny (wzór `scripts/webgpu/korek-gra.mjs`, `planety-mapy-gra.mjs` przy `e._spinAxis`), nie
  wokół Y. Tło menu ma własną Ziemię i obrót wokół Y (bez zmian). Dysk poświaty limbu gaśnie nad promieniem
  przechodzącym przez kulę gryzu (`buildRingAtmosphereGraph`, punkt promienia najbliższy środkowi gryzu) — dysk leży
  w płaszczyźnie środka planety, a ściana gryzu przy limbie leży za nim (bez tego granatowy nalot we wcięciu).

- ELEKTROWNIA „KOREK” (`src/3d/earthBitePlant*.js`, brief i kontrakt: `docs/BRIEF-korek.md`): czarna megabudowla na
  dnie gryzu (korek zatykający jądro z akceleratorem wylotu), obudowa dziury (korona brzegu z masztami pola, żebra
  i galerie ścian, brama promienia na osi 270°, przewody i podstacje), promień energii do odbiornika na orbicie
  (1,075 R, magazyn, nadajnik), promień przekaźnikowy do ringu i WINDY DO RINGU (kotwice na placach korony, liny do
  szyny w wewnętrznej krawędzi ringu — szyna obraca się z Ziemią, wózki, kabiny na GPU). Obraz (zasada żelazna 1).
  Budowa: komponenty (`Cork`, `Lining`, `Elevators`, `Orbital`, `Beam`) oddają części w RAMIE ELEKTROWNI
  (`earthBitePlantFrame.js`: Y = oś gryzu, początek na dnie) z atrybutem `aPart` (rodzaj powierzchni `PART`, ziarno,
  z, w; z < 0 — własne uv części), orkiestrator scala je w JEDEN rysunek metalu i JEDEN przepływu (przewody, liny),
  promień ma własne siatki osłon (jasność analityczna), kabiny — dodatek `extras` (jeden rysunek). Wspólne uniformy
  (`PLANT_KEYS`) dzielą z kulą `sunPosition`, `uBite`, `uSunShadowRecv`; graf każdego materiału raz na moduł; model
  światła wspólny (`plantLightContext` / `plantLighting`, węzły współdzielone przez `plantVar` — pułapka 40 w regule
  `webgpu-tsl`). Ring w układzie Ziemi stoi, więc przekaźnik i liny są STAŁE (`attachRing(earthSpinAxis())`,
  `PLANT_LAYOUT.ringInnerR` = `radii.min` ringu Ziemi / R — test). W grze: dziecko kuli Ziemi (`DirectPlanet._ensurePlant`),
  bryły buduje rozgrzewka ekranu ładowania (`'elektrownia KOREK (gryz Ziemi)'`, warstwa 6, faza `loading` — ~0,5 s CPU,
  menu nie czeka), zegar z doby (`plant.update`, zawinięcie co 4 096 s). Kadr gry z biegunem obrotu to w ramie gryzu
  ZAWSZE ten sam rzut (z północy, ~10° nad płaszczyzną elektrowni) — FASADA BOHATERA: południowa korona i górny pas
  południowej ściany; południk gryzu (90°, 270°) rzutuje się na promień, więc tam nie ma wind (`L.elevators` = 0, 60,
  …, 300). Hierarchia jasności w kadrze gry: promień > liny wind > korona i maszty > cięciwy pola i listwy.
  Budżet (test): metal ≤ 600 tys. wierzchołków, przepływ ≤ 150 tys., razem ≤ 900 tys. Narzędzia: test
  `tests/earthBitePlant.test.mjs` (kontrakt, budżet, WGSL wszystkich siatek, ziarna, ring, wpięcie), demo
  `dema/planety-webgpu.html?korek=1` (dodatek `dema/planety-slup.js`: `__slup.viewGame` — kadr gry znad bieguna,
  `__slup.viewPlant` — kadr w ramie elektrowni), zrzuty `node scripts/webgpu/slup-demo.mjs --tylko gra,szczegoly`
  (grupy ról: mat, cork, lining, orbit, beam, elev; `--korek 0` — sam gryz w tych samych kadrach), w grze `node scripts/webgpu/korek-gra.mjs [--query renderWorker=1]`
  (kadry gryzu i odbiornika, koszt GPU z elektrownią i bez, pipeline'y synchroniczne). Zasady wyglądu (runda 5):
  światło pozycyjne na bryle to stalowa oprawa z soczewką na JEDNEJ ścianie (BEACON tylko tam — pudełko BEACON świeci
  środkiem każdej ściany i za dnia czyta się jak kostka do gry); cewka na małym walcu albo pierścieniu — własne uv
  (z < 0, faza |z|; uzwojenia w poprzek uv.x), bo rzut pudełkowy daje ukośne paski jak litery; szeroka listwa w rzucie
  pudełkowym to kratka rurek — listwy wąskie albo z własnym uv; okna z bliska przez `windowPane` (rama, szprosy, głębia,
  nasycony bursztyn — jasne duże pole po ACES bieleje w krem); pasy okien świecą GRUPAMI (ciemne / przygaszone / zapalone
  komórki, klatki schodowe — pionowe akcenty), a rzędy świateł odcinkami — równe linie z daleka to „drabinka”; nocą
  ciemna baza z plamami naświetlaczy (szeroka poświata lamp zlewała się w brązowe wypełnienie płaszczyzn). Słup dymu nad gryzem
  (`src/3d/earthBitePlume*.js`, `?slup=1`) to porzucony prototyp — poza grą.

- KSIĘŻYCE (2026-10-08, `scripts/planety/ksiezyce.py`, `MOON_MAPS` w `planetMaps.js`, `docs/PLANETY-GENERATOR.md` § Księżyce): mapy dzień / noc / normalne z rolą w ekonomii (Luna — stocznia, depoty i garnizony Terra Nova; Io — odkrywki metalu Konsorcjum; Europa — cięcia lodu Unii Pasa po prawdziwych lineae; Ganimedes, Kallisto — depoty Konsorcjum); materiał `src/3d/moonSurface.tsl.js` (MeshStandardNodeMaterial, hak modelu oświetlenia: słońce gry świeci z PŁASZCZYZNY GRY — Słońce − środek, z = 0, jak planety — otoczenie sceny × 0,12, światła nocne z `emissiveMap` zapalane zmrokiem i w cieniu planety; graf raz na wariant, kierunek w `material.uniforms.uSunDir`). Nowy księżyc = wpis w `MOON_MAPS` po `id` strojenia.

- MAŁE CIAŁA (2026-10-12, strumień C planu `docs/PLAN-pas-realizm.md`; decyzja użytkownika: duże ciała pasa jako ciała, na Ceres STOLICA UNII PASA): Ceres, Westa, Pallas, Hygiea, Psyche, Pluton z Charonem. Dane — JEDNO źródło `src/data/smallBodies.js` (AU mapy wg umowy planu: liniowo Mars 33 ↔ Jowisz 50,2 — Ceres 38,81, Westa 36,92, Pallas 38,84, Hygiea 40,55, Psyche 39,55, Pluton 127; promień = skala Luny 9 072 j. ściśnięta pierwiastkiem — Ceres 4 717 j., Psyche 2 293, Pluton 7 503; osie, typ, rola, stacje). KĄT: planety mają losowe kąty, więc `angle` to kąt preferowany, a ostateczny daje `resolveSmallBodyAngles` z położeń świata (blok „MAŁE CIAŁA” w `index.html`): ciało pasa poza torem kampanii (Ziemia → baza piratów — `StoryGame._shipyardCenter` na tych samych danych, studnia + 120 tys. j.), z dala od planet z księżycami i olbrzymów pasa (`planBeltGiantSites`), Pluton 90–180° od Neptuna; te same kąty dostaje ruch v2 (`planetAngles` → `trafficWorld.smallBodyOutposts`: węzły 'ceres' / 'vesta' w punkcie stacji gry). Gra: obiekty `window.smallBodies` (pola jak planety: x, y, r, `orbitZone` — `planetOrbitRadii` działa) w `detectZones` (warp × 0,3, hamowanie grawitacyjne), objazdach TRAVEL TO (`getCruiseGravityObstacles`, `getTravelWells`), celu / starcie i zwolnieniu skoku (`warpPlanetNear`, `planPlayerWarp`), podpisach, radarze i CIC (`hudRadarWorldFeatures`, `drawSolarSystem`). Stacje Unii (`createSmallBodyStations`: „Ceres — Stolica Unii” — bryła stacji Marsa z `MODEL_URLS.ceres`, ~7× większa od `r` stacji; „Westa — Huta Unii” — model domyślny) to zwykłe stacje gry (rynek, dok, frakcja `belt_union`). Skały pola omijają ciała i stacje: `field.setExclusions([...giants.exclusions(), ...smallBodyExclusions(...)])` po `createAsteroidBelt` (nowe wołanie `giants.applyExclusions` zdjęłoby wyłączenia ciał). Render: `DirectSmallBody` (`planet3d.assets.js`) — pass ring-planet (warstwa 6, ortho, bez paralaksy), środek pod płaszczyzną (szczyt z = −400), materiał księżyców z maską słońca (program Luny), kształt bryły z mapy promienia (`src/3d/smallBodyShape.js`: PNG 16 bitów RG, zakres w bloku `SMALL_BODY_SHAPE` `planetMaps.js` — czyta go też generator), doba i nachylenie osi, smuga cienia (`pushShaftDiscWorld`), soczewka świata, rozgrzewka `małe ciała (…)`. Mapy: `scripts/planety/male_ciala.py`, `SMALL_BODY_MAPS` (`docs/PLANETY-GENERATOR.md` § Małe ciała). Nowe ciało = wpis w `smallBodies.js` + `SMALL_BODY_MAPS` + generator. Testy `tests/smallBodies.test.mjs`, w grze `node scripts/webgpu/male-ciala-gra.mjs`, demo `dema/planety-webgpu.html?cialo=ceres|westa|pallas|hygiea|psyche|pluton|charon`.

- ŻYWA ATMOSFERA JOWISZA (2026-10-08, prośba użytkownika: „animowana atmosfera z wielkim wirującym okiem”; `src/3d/jupiterAtmosphere.js` — dane, pasy, wiry, zegar; `jupiterAtmosphere.tsl.js` — barwa dnia z przepływu). Rodzaj grafu `'jupiter'` w `planet3d.assets.tsl.js` = graf powierzchni z `flow` (te same oświetlenie, terminator, pas zachodu, cień ringu, bloom), tylko próbka mapy dnia idzie przez przepływ; inne planety mają WGSL bez zmian, klucze Jowisza (`JUPITER_UNIFORM_KEYS`) dopisuje `JupiterAtmosphere` tylko do jego `uniforms` (nie do `SURFACE_KEYS`). Dwie warstwy ruchu: (1) SZTYWNY, nieograniczony, liczony na CPU w double co klatkę (`_spin` → `jupiterAtm.step()`): pasy-segmenty między lokalnymi minimami profilu wiatru z Cassini (Porco 2003, tabela BAA) jadą każdy swoją średnią prędkością kątową (tablica uniformów `jupiterBands`, na granicy ±0,6° przenikanie barwą — bez narastającego ścinania), wiry leżą w segmentach-plateau (`jupiterBandSegments`), jądro GRS obraca się sztywnie po elipsie (`jupiterVortices`, kąt z CPU); (2) RESZTA w shaderze dwiema fazami przenikanymi (flow map): szybsze dżety w segmencie, kołnierz wirów, turbulencja curl3D ze ścinania — sama mapa przepływu NIE wystarcza (średni wiek próbki stały → w pierwszym rzędzie obraz stoi; zmierzone w zrzutach). Czas = czas gry (`SimClock.render`; w pauzie stoi) × `JupiterAtmTune.timeScale`, przy zbliżeniu wolniej (`zoomFollow`). Próbki mapy tylko z gradientem nieprzesuniętego uv albo poziomem (dowolny przepływ sterowania, bez szwu mipmap). Mapa `jupiter_cassini_color.jpg` (PIA07782 → `scripts/planety/jowisz.py`); położenia wirów zmierzone NA TEJ MAPIE — nowa mapa = nowy pomiar `JUPITER_VORTICES`. Strojenie `window.JupiterAtmTune` (`on: 0` — sama mapa), testy `tests/jupiterAtmosphere.test.mjs`, w grze `node scripts/webgpu/jowisz-gra.mjs` (arkusze ruchu, GIF GRS, A/B, zegar w pauzie, pipeline'y w klatce — 0, koszt GPU).

- ŻYWA ATMOSFERA SATURNA (2026-10-09, prośba użytkownika: „animowana atmosfera Saturna — cyklony, ruchoma atmosfera”; pierścienie przecinające płaszczyznę gry — następna tura). WSPÓLNY SILNIK gazowych olbrzymów `src/3d/gasGiantAtmosphere.js` (model planety: profil wiatru, granice pasów, wiry, czapy polarne, klucze uniformów, nazwy buforów; klasa zegara) + `gasGiantAtmosphere.tsl.js` (barwa dnia z przepływu) — Jowisz jest jego modelem (`JUPITER_MODEL`, API i WGSL bez zmian), Saturn — `src/3d/saturnAtmosphere.js` (rodzaj grafu `'saturn'`, klucze `uSat*`, bufory `saturnBands` / `saturnVortices`). Dane (profil wiatru Cassini, sześciokąt, czapy, burza 2011, wiry) — JEDNO źródło `src/data/saturnAtmosphere.js`, czyta je też generator mapy `scripts/planety/saturn.py` (zmiana położeń = ponowny wypiek). CZAPY POLARNE: za granicą czapy ruch po liniach prądu wokół bieguna (na północy po SZEŚCIOKĄCIE — kształt `polygonShapeCpu`, lustro w generatorze), jądro wiru polarnego obracane sztywnie (kąt w double), segment nad czapą bez ruchu sztywnego. Nowy gazowy olbrzym = nowy `GasGiantModel` + rodzaj w `BUILDERS` (`planet3d.assets.tsl.js`). Opis i źródła: `docs/PLANETY-GENERATOR.md` § Saturn, testy `tests/saturnAtmosphere.test.mjs`, demo `dema/planety-webgpu.html?cialo=saturn`, strojenie `window.SaturnAtmTune`.

- `initPlanets3D(planets, SUN)` — inicjalizacja.

- `updatePlanets3D(dt, cam)` — aktualizacja. W skoku gracza ciała rozstawia soczewka świata (`applyWarpWorldLens`, reguła `warp` — SOCZEWKA ŚWIATA); planeta z ringiem „Halo” publikuje przy tym slot ringu (`warpRingLensSlot` → `WARP_RING_LENS`: obraz, skala, obrót przelotu — ring jedzie z planetą, reguła `ring-halo`), poza soczewką `on = false`. Planeta, do której gracz przyleciał skokiem, zostaje z ustawieniem tarczy z soczewki (`DirectPlanet._lensFace` — pasy do kierunku przylotu, bez obrotu przy końcu soczewki); zwykła klatka orientuje bryłę przez `_orient(null, this._lensFace)` — nowa ścieżka orientacji planety też je składa.

- Planety są częścią wizualnej warstwy 3D, gameplay nadal jest liczony w 2D.

- Halo (poświata limbu) Ziemi i Marsa: `createRingAtmosphere` w `planet3d.assets.js` — płaski dysk w passie ortho z modelem atmosfery z tła menu (cięciwa przez powłokę R + H, gęstość e^(−h/Hs)), gaśnie do zera na brzegu powłoki. Nie wracaj do powłoki-kuli z maską Fresnela: przy 1,21 R dawała kropkowany łuk, przy 1,034 R ~1% jasności (halo znikało).

- Noc i pas zachodu (2026-10-06, decyzja użytkownika po A/B: noc czarna i NIEprzezroczysta, „prawdziwy ładny pas zachodu”): powierzchnia bez światła otoczenia i szerokiego terminatora (dawne `uAmbient` / `uSunWrap` / `sunsetTint` powierzchni usunięte — dawały szaroniebieską noc Marsa i Jowisza i gruby czerwony pas Ziemi), nocą tylko miasta z mapy nocy (ląd w świetle księżyca odcięty progiem). Pas zachodu z przepuszczalności atmosfery (`SUNSET`, `sunTransmittance`, `sunsetGlow` w `planet3d.assets.tsl.js`): masa powietrza z wysokości słońca, współczynniki = `uHazeBeta × uHazeStrength` planety (Ziemia: złoto → pomarańcz → czerwień, Mars lekko błękitnieje), łuna powietrza tuż za terminatorem gruntu, chmury dłużej oświetlone i barwione tym samym światłem; planety bez mgiełki — zwykły terminator. Nie wracaj do doklejonego pasa barwy ani do przezroczystej nocy (w A/B mgławica przez planetę = hologram). Zrzuty w grze: `node scripts/webgpu/planety-noc-gra.mjs [--tag x --obok A,B]`.

- Materiały w TSL (port WebGPU, zadanie 05): `src/3d/planet3d.assets.tsl.js`. Graf RAZ na rodzaj (powierzchnia,
  chmury, poświata planet tła i księżyców, poświata limbu, słońce), każde ciało dostaje lekki `PlanetBodyNodeMaterial`
  z tymi samymi węzłami; wartości per ciało w `material.uniforms` (obiekty `{ value }` — kontrakt
  `window.EARTH.uniforms.*Texture.value` / `cloudUniforms` dla tła menu bez zmian), tekstury per ciało przez
  `PlanetObjectTextureNode`. Mgławica (`uniforms.map.value` pożycza tło menu) i gwiazdy — węzły za adapterem uniformów.
  Maska słońca: JEDEN import z `sunShadowMask.js` (TSL, zadanie 03) — `sunVisibility()` na ciałach przy ringu
  (`uSunShadowRecv = 1`; planety tła w perspektywie jej nie czytają), `sunShaftBackdrop()` na mgławicy i gwiazdach.

- Gwiazdy (`StarSystem`): WebGPU rysuje punkty zawsze po 1 px, więc to `Mesh` z `InstancedBufferGeometry` (kwadrat ×
  26 000, dane gwiazd w JEDNYM przeplecionym buforze instancji — limit 8 buforów wierzchołków) i kwadrat punktu z GL
  (bok gl_PointSize obcięty do ≥ 1 px, gl_PointCoord z rogów, t w dół). Nie wracaj do `THREE.Points` z rozmiarem.
  Skok (zadanie 22): smugi PŁASKIE wzdłuż kursu i front wyjścia od dziobu z `WARP_STARS` (`src/3d/warp/stars.js`, pisze
  tylko sterownik warpa — nie prędkość lotu); dawne rozciąganie i „bicz” przy wyjściu usunięte. Bez warpa gałąź punktu
  jak przed zadaniem 22.

- Poświata limbu: blend ONE/ONE przez `CustomBlending` — `NodeMaterial` z `premultipliedAlpha = true` mnożyłby kolor
  przez alfę w shaderze (ShaderMaterial z tą flagą zmieniał tylko blend).

- A/B planet, księżyców i stacji w prawdziwej grze (harness nie ma kadru z Ziemią przy ringu):
  `node scripts/webgpu/planety-gra.mjs [--root <worktree tagu webgl-baseline>]`, porównanie `porownaj.mjs`.
