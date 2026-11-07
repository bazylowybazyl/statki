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

- Generator NIE jest wpięty w grę (2026-11-08): demo `dema/generator-planet.html`, wpięcie robi orkiestrator po ocenie
  użytkownika (kroki: `docs/OPIS-generator-planet.md` § „Wpięcie w grę”). Rodzaje (`planetGenTypes.js`): `terran`,
  `ocean`, `desert`, `rocky`, `ice`, `volcanic`, `barren`, `toxic`, `gas`, `ice_giant` — identyfikatory WSPÓLNE z mapą
  gwiezdną (`src/game/sector/`) i tabelą układów (`src/data/starSystems.js`); zmiana id = zmiana we wszystkich.
- Przebieg: `describePlanet({ type, seed, r? })` (`planetGenSpec.js`, czysty JS, losowanie `planetGenRng.js` — strumienie
  per cel z ziarna, nie `Math.random` ani `fxRandom`) → `PlanetGenBaker.bakeSystem(opisy, { size })`
  (`planetGenBaker.js`) → tekstury o rolach `PLANET_MAPS` (dzień sRGB, normalne R = wschód / G = północ, połysk R8,
  noc sRGB, chmury sRGB) → materiały GRY (`planetGenBody.js`: `planetSurfaceUniforms` = kształt `DirectPlanet.uniforms`).
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
  dopisek, rodzaje gry i ich WGSL bez zmian), pasy i wiry PER OBIEKT (`PerObjectUniformArrayNode` — aktualizacja na obiekt,
  bufor grupy obiektu jest osobny na obiekt renderu), profil wiatru — tekstura per obiekt, promień modelu stały
  (`GEN_GAS_RADIUS`), czapy polarne bez osobnego ruchu. Mapa dnia (`planetGenGasBake.tsl.js`) rysuje wiry w miejscach
  rekordów silnika (te same `look.vortices`).
- Pierścienie (część olbrzymów, `planetGenRing.js`): profil promieniowy z ziarna na CPU (1024 × 1), materiał TSL z cieniem
  planety; cienia pierścieni na tarczy brak (graf powierzchni gry go nie ma).

## Zasady i pułapki

- Nowy rodzaj z powierzchnią: `field()` + `color(F)` + `uniformsFor(spec, ctx)` w `SOLID_TYPES` (kontrakt kanałów pola,
  `probeQ`, `norm`, `spec`, `civ`), wygląd w `planetGenSpec.js` (`LOOKS`, mgiełka, chmury, noc), id w `planetGenTypes.js`
  i w mapie gwiezdnej; test `tests/planetGen.test.mjs` (WGSL wszystkich przejść, zmienność strukturalna).
- Wartość przypisana KOMÓRCE Worleya (hasz najbliższej) skacze tam, gdzie zmienia się druga najbliższa — kanciaste lądy,
  wielokąty śniegu, proste krawędzie. Wartości płyt: `pgCellsSmooth` (średnia ważona e^(−k·d²)); granice F2 − F1 są ciągłe.
- Normalne przycięte (`norm[2]` — największe nachylenie): graf powierzchni gry nie ma samocienia, więc stoki kraterów
  i gór z mocną mapą normalnych świecą daleko za terminatorem.
- Mgiełka: niebieska tylko nad ciemnym gruntem i wodą, ze słabo rozjechanymi współczynnikami — ekstynkcja zabiera błękit
  z jasnego lądu, rozpraszanie go dokłada (fiolet na pustyniach). Pustynie i rdza — mgiełka płowa (test).
- `GasGiantAtmosphere` ustawia `needsUpdate` na mapie dnia — na teksturze celu renderu gubi to próbnik w grupie wiązań
  (`createBindGroup … resource undefined`): `GenGasAtmosphere` dostaje mapę `null` (cel wypieku ma już `RepeatWrapping`).
- Tekstura podawana węzłowi tekstury PER OBIEKT (profil wiatru) musi być na GPU przed pierwszym rysunkiem
  (`renderer.initTexture` w bakerze) — inaczej pusty próbnik w grupie wiązań.
- Odczyt GPU → CPU (`readRenderTargetPixelsAsync`, `onSubmittedWorkDone`) czeka na takt urządzenia: przy rysowanych
  klatkach w headless ~200 ms na odczyt — stąd jedna próba na UKŁAD. Czas GPU mierzy `generator-planet-pomiar.mjs`
  (klatki wstrzymane, znaczniki czasu); czas w rogu dema przy siatce jest orientacyjny.
- Stałe krawędzie `smoothstep` rosnąco (pułapka 6 — pilnuje test); odwrócone przez `inv(lo, hi, x)`.
- Funkcje z `setLayout` płaskie (pułapka 35): `pgCraterOctave` nie woła szumu z layoutem — nieregularność obrysu
  z sinusów kierunku.
- Wzory regularne wyglądają na doklejone: równe łańcuchy wysp, konfetti jasnych plamek, idealne okręgi kraterów,
  koncentryczne spirale cyklonów, warstwice na płaskim — losuj rozmiar i obecność, nieregularność obrysu, smugi z szumu.

## Narzędzia

- Demo: `dema/generator-planet.html` (`?rodzaj=…|mieszane`, `?ziarno=N`, `?planeta=rodzaj:ziarno`, `?roz=1024|2048|4096`,
  `?pora=0…180` — 90 jak w grze, `?test=1`), `window.__gen` (`buildGrid`, `openClose`, `mapPng(warstwa)` — płaska mapa).
- Zrzuty: `node scripts/webgpu/generator-planet-demo.mjs --rodzaje terran,gas --zblizenia terran:21 --mapy 1
  [--mieszane 1 --ziarno 7 --out .tmp/generator-planet/<tag>]`.
- Czasy i pamięć: `node scripts/webgpu/generator-planet-pomiar.mjs [--roz 1024,2048,4096 --uklad terran,rocky,…]`.
- Testy: `node --test tests/planetGen.test.mjs`.
