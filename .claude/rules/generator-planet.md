---
paths:
  - "src/3d/planetGen/**"
  - "dema/generator-planet.html"
  - "dema/generator-planet.js"
  - "scripts/webgpu/generator-planet-*.mjs"
  - "tests/planetGen.test.mjs"
---

# Generator planet z ziarna (wypiek map na GPU)

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe
> i indeks reguł: `AGENTS.md`. Opis, decyzje, czasy i pamięć: `docs/OPIS-generator-planet.md`. Planety Układu
> Słonecznego (mapy ze skryptów Pythona) — reguła `planety`.

## Stan

- Generator NIE jest wpięty w grę (2026-11-08, runda 2 grafiki tego dnia): demo `dema/generator-planet.html`, wpięcie robi orkiestrator po ocenie
  użytkownika (kroki: `docs/OPIS-generator-planet.md` § „Wpięcie w grę”). Rodzaje (`planetGenTypes.js`): `terran`,
  `ocean`, `desert`, `rocky`, `ice`, `volcanic`, `barren`, `toxic`, `gas`, `ice_giant` — identyfikatory WSPÓLNE z mapą
  gwiezdną (`src/game/sector/`) i tabelą układów (`src/data/starSystems.js`); zmiana id = zmiana we wszystkich.
- Przebieg: `describePlanet({ type, seed, r?, ruins? })` (`planetGenSpec.js`, czysty JS, losowanie `planetGenRng.js` —
  strumienie per cel z ziarna, nie `Math.random` ani `fxRandom`) → `PlanetGenBaker.bakeSystem(opisy, { size })`
  (`planetGenBaker.js`) → tekstury (dzień sRGB — pod morzem barwa gruntu, alfa = lód morski; RZEŹBA RGBA16F: wysokość
  [km], nachylenie wschód / północ [km/km], szorstkość; połysk R8 bez morza; noc sRGB; chmury sRGB) → materiały
  GENERATORA nad grafami gry (`planetGenBody.js`: `planetSurfaceUniforms` = kształt `DirectPlanet.uniforms` + klucze
  generatora): `'genSolid'` (`planetGenSurface.tsl.js`), `'genClouds'` (`planetGenClouds.tsl.js`), `'genGas'`.
- MATERIAŁY GENERATORA = grafy gry z HAKAMI (`registerPlanetFlowKind(…, { surface })`, `registerPlanetCloudKind`,
  `planet3d.assets.tsl.js`): to samo światło, terminator, pas zachodu, mgiełka, cień ringu, noc, bloom co Ziemia; hak
  dokłada rzeźbę z cieniem terenu (promień po mipmapach mapy rzeźby + horyzont z wysokości), detal ponad rozdzielczość
  mapy (oktawy szumu z pochodnymi, gasną poniżej ~3 px), morze w shaderze (brzeg z progu wysokości z szerokością
  z pochodnej ekranu), ruiny; chmury — erozję brzegów. Decyzja i koszt klatki: `docs/OPIS-generator-planet.md` § 1a.
- RUINY (decyzja użytkownika 2026-11-08, wszystkie planety): `spec.ruins` (z ziarna albo z danych gry), obraz w shaderze
  (`planetGenRuins.tsl.js`, rekordy `uRuin0…15` per obiekt), świecą w dzień i w nocy, jasność = wartość
  (`setRuinValue` — przeszukane gasną). Rozgrywka eksploracji — w grze, nie tu.
- WYPIEK, nie szum w shaderze klatki (decyzja i liczby — opis): grafy wypieku RAZ na rodzaj × przejście (`graph(klucz)`:
  `field:<rodzaj>`, `day:<rodzaj>`, wspólne `normal`, `spec`, `night`, `clouds`, `gas`), wartości planety w uniformach.
  Przejścia quada do celów renderu (`QuadMesh`), piksel celu (y od góry) ↔ uv = ((x + ½) / W, (y + ½) / H) — WGSL czyta
  v = 0 z górnego wiersza (pułapka 4), więc mapa wpina się w graf gry bez odwracania; kierunek na kuli jak w
  `SphereGeometry` (biegun N = +Y, v = 1).
- KONTRAKT KANAŁÓW POLA (RGBA32F, `planetGenSolid.tsl.js`): x — wysokość [km] (planety z wodą: 0 = poziom morza),
  y — ciecz poza morzem (jeziora solanki, lawa; czytają ją wspólne POŁYSK i NOC), z — maska rodzaju, w — wartość PRÓBY
  (pole bazowe, z którego baker liczy kwantyle w ułamkach `probeQ` rodzaju → `uQ`: próg oceanu z udziału wody, mórz wydm,
  mórz lawy). Próby wszystkich planet układu idą naraz z JEDNYM odczytem CPU (`bakeSystem`).
- OLBRZYMY na wspólnym silniku żywej atmosfery (`gasGiantAtmosphere.js` / `.tsl.js` — ten sam co Jowisz i Saturn):
  jeden rodzaj grafu `'genGas'` dla wszystkich planet generatora (`registerPlanetFlowKind` w `planet3d.assets.tsl.js` —
  dopisek, rodzaje gry i ich WGSL bez zmian), pasy i wiry PER OBIEKT (`PerObjectUniformArrayNode`, `planetGenNodes.js` —
  aktualizacja na obiekt, bufor grupy obiektu jest osobny na obiekt renderu), profil wiatru — tekstura per obiekt, promień
  modelu stały (`GEN_GAS_RADIUS`), CZAPY POLARNE silnika (`GEN_GAS_POLES`, granica 72°: ruch wokół bieguna, jądro
  sztywne). Mapa dnia (`planetGenGasBake.tsl.js`) rysuje wiry w miejscach rekordów silnika (te same `look.vortices`)
  i bieguny z ziarna (`look.polar`: gromada cyklonów / sześciokąt / mgła).
- Pierścienie (część olbrzymów, `planetGenRing.js`): profil promieniowy z ziarna na CPU (1024 × 1), materiał TSL z cieniem
  planety; CIEŃ PIERŚCIENI NA TARCZY w haku `'genGas'` (pierścienie równikowe — płaszczyzna y = 0 w układzie kuli,
  `uGgRing` + `ringTexture`). Decyzja użytkownika 2026-11-08: pierścienie wpinane do gry razem z olbrzymami.

## Zasady i pułapki

- Nowy rodzaj z powierzchnią: `field()` + `color(F)` + `uniformsFor(spec, ctx)` w `SOLID_TYPES` (kontrakt kanałów pola,
  `probeQ`, `spec`, `civ`), wygląd w `planetGenSpec.js` (`LOOKS`, `RELIEF` — przesadzenie rzeźby i cienia, detal,
  szorstkość; mgiełka, chmury, noc), id w `planetGenTypes.js` i w mapie gwiezdnej; test `tests/planetGen.test.mjs`
  (WGSL wszystkich przejść i materiałów, zmienność strukturalna).
- Haki grafów gry: bez haka gałęzie JS w `buildSurfaceGraph` / `buildCloudGraph` nie budują nic nowego — po zmianie
  haka porównaj WGSL `'surface'`, `'jupiter'`, `'saturn'`, `'clouds'` przed i po (bajt w bajt; testy sprawdzają, że
  graf gry nie ma `pgNoised`). Hak jest wołany raz, przed gałęziami: pochodne (`fwidth`) i próbki z pochodnymi licz
  w nim od razu do zmiennych (pułapki 15, 29); w pętlach i gałęziach — próbki z poziomem (`.level()`).
- `new THREE.Vector4()` ma w = 1: puste miejsce rekordu (ruina, wir…) zeruj jawnie `(0, 0, 0, 0)` — w = 1 jako promień
  ruiny pokrył całą planetę „gruzem” (albedo ×0,14, bez błędu; szukane próbami A/B na jednym kadrze).
- Kod w gałęzi z warunkiem z uniformu ma być skończony dla KAŻDEGO piksela i każdego (także pustego) rekordu —
  dzielenie przez max(r, ε), współrzędne przycięte, bez odwróconych krawędzi `smoothstep` z dynamicznymi krawędziami.
- Wynik pętli rozwiniętej (wiele miejsc) składaj przez zmienne MIEJSCA przypisane w gałęzi i jedno działanie po niej
  (wzór `ruinsShade`), nie mnożeniem wspólnej zmiennej w zagnieżdżonych gałęziach.
- Wartość przypisana KOMÓRCE Worleya (hasz najbliższej) skacze tam, gdzie zmienia się druga najbliższa — kanciaste lądy,
  wielokąty śniegu, proste krawędzie. Wartości płyt: `pgCellsSmooth` (średnia ważona e^(−k·d²)); granice F2 − F1 są ciągłe.
- Rzeźba bez przycinania tylko RAZEM z cieniem terenu: graf powierzchni gry nie ma samocienia, więc mocne normalne bez
  cienia (horyzont + promień) świecą daleko za terminatorem — hak `'genSolid'` liczy oba.
- Mgiełka: niebieska tylko nad ciemnym gruntem i wodą, ze słabo rozjechanymi współczynnikami — ekstynkcja zabiera błękit
  z jasnego lądu, rozpraszanie go dokłada (fiolet na pustyniach). Pustynie i rdza — mgiełka płowa (test).
- `GasGiantAtmosphere` ustawia `needsUpdate` na mapie dnia — na teksturze celu renderu gubi to próbnik w grupie wiązań
  (`createBindGroup … resource undefined`): `GenGasAtmosphere` dostaje mapę `null` (cel wypieku ma już `RepeatWrapping`).
- Tekstura podawana węzłowi tekstury PER OBIEKT (profil wiatru) musi być na GPU przed pierwszym rysunkiem
  (`renderer.initTexture` w bakerze) — inaczej pusty próbnik w grupie wiązań.
- Odczyt GPU → CPU (`readRenderTargetPixelsAsync`, `onSubmittedWorkDone`) czeka na takt urządzenia: przy rysowanych
  klatkach w headless ~200 ms na odczyt — stąd jedna próba na UKŁAD. Czas GPU mierzy `generator-planet-pomiar.mjs`
  (klatki wstrzymane, znaczniki czasu); czas w rogu dema przy siatce jest orientacyjny.
- Pochodne pola (normalne, nachylenie, krzywizna w barwach) — operatory izotropowe (Sobel 3 × 3, laplasjan 3 × 3):
  krzyż ±1 / ±2 teksele daje na kraterach kilku tekseli odpowiedź w kształcie rombu, a ostry próg krzywizny —
  1-tekselowe schodkowe obwódki. Najmniejsza oktawa kraterów ma średnicę ≥ 8 tekseli (`craterRecords`).
- Stałe krawędzie `smoothstep` rosnąco (pułapka 6 — pilnuje test); odwrócone przez `inv(lo, hi, x)`.
- Funkcje z `setLayout` płaskie (pułapka 35): `pgCraterOctave` nie woła szumu z layoutem — nieregularność obrysu
  z sinusów kierunku.
- Wzory regularne wyglądają na doklejone: równe łańcuchy wysp, konfetti jasnych plamek, idealne okręgi kraterów,
  koncentryczne spirale cyklonów, warstwice na płaskim — losuj rozmiar i obecność, nieregularność obrysu, smugi z szumu.

## Narzędzia

- Demo: `dema/generator-planet.html` (`?rodzaj=…|mieszane`, `?ziarno=N`, `?planeta=rodzaj:ziarno`, `?roz=1024|2048|4096`,
  `?pora=0…180` — 90 jak w grze, `?test=1`), `window.__gen` (`buildGrid`, `openClose`, `mapPng(warstwa)` — płaska mapa,
  `scene`, `cameras()`).
- Próby A/B na jednym kadrze: `node scripts/webgpu/generator-planet-proby.mjs --planeta rocky:3 --kadr 1.6,0.6,0.15
  --wariant "nazwa=kod;;…"` (kod na `B` / `U` / `G`; `window.__zrzut` → plik .txt).
- Koszt klatki materiałów: wariant prób z `G.S.paused = true`, `G.renderer.render(G.scene, G.cameras().close)` i
  `resolveTimestampsAsync('render')` na klatkę (mediana) — czas z biegnących klatek dema przepełnia pulę znaczników.
- Zrzuty: `node scripts/webgpu/generator-planet-demo.mjs --rodzaje terran,gas --zblizenia terran:21 --mapy 1
  [--mieszane 1 --ziarno 7 --out .tmp/generator-planet/<tag>]`.
- Czasy i pamięć: `node scripts/webgpu/generator-planet-pomiar.mjs [--roz 1024,2048,4096 --uklad terran,rocky,…]`.
- Testy: `node --test tests/planetGen.test.mjs`.
