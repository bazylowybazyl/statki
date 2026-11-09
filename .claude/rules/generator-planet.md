---
paths:
  - "src/3d/planetGen/**"
  - "dema/generator-planet.html"
  - "dema/generator-planet.js"
  - "dema/planeta-zblizenie.html"
  - "dema/planeta-zblizenie.js"
  - "scripts/webgpu/generator-planet-*.mjs"
  - "scripts/webgpu/planeta-zblizenie-demo.mjs"
  - "tests/planetGen.test.mjs"
  - "tests/planetGenNear.test.mjs"
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

## Planeta z bliska (demo `dema/planeta-zblizenie.html`, niewpięte)

- WYCINEK MAPY POD KAMERĄ (`planetGenPatch.js`, opis i liczby: `docs/OPIS-generator-planet.md` § 10): te same grafy
  wypieku w OKNIE kadru (`bakeCoords` — gałąź okna `uWin` + `uFrX / Y / Z`; `C.lat` / `C.u` to prawdziwa szerokość
  i długość, odległości tekseli — `C.latGrid`, `C.stE`, `C.stN`). Układ okna = jedna z sześciu ścian sześcianu, siatka
  stała (teksel mapy planety / 2^poziom, początek co 16 tekseli) — przesunięte okno daje te same teksele. Dwa miejsca
  A / B z przenikaniem; wypiek W PASACH po kroku na klatkę (`patchSteps`, `bakePatchStep`). Cel pola wypiekacza służy
  wycinkom — nie wołaj `releaseScratch`, póki wycinki żyją.
- Materiały: `'genSolidNear'` (`planetGenSurfaceNear.tsl.js`: wycinki, detal na drabinie stałych oktaw, cień terenu
  po wycinku, żar i dryf lawy, fale i iskrzenie morza, rzeki, cień chmur i pióropusza), `'genCloudsNear'`
  (`planetGenCloudsNear.tsl.js`: okno mapy chmur, światło z grubości chmur ku słońcu — bez marszu promienia),
  bryła pióropusza erupcji (`planetGenPlume.tsl.js`: marsz promienia w pętli, ta sama gęstość daje cień na gruncie).
  Składanie: `planetGenNear.js` (`createGenNearBody`). Dalsze planety zostają na `'genSolid'`.
- Rodzaj gotowy do okna ma pole ZGODNE MIĘDZY POZIOMAMI: fbm z `full = true` (dzielnik = suma całego szeregu — kolejna
  oktawa dokłada detal i nie przeskalowuje progów z próby), sufity `pgOctavesFor` ponad mapy planety, obiekty
  wchodzące bramką z rozmiaru w tekselach (`C.stN`), linie nie węższe niż ~1,3 teksela z zachowaniem energii. Zrobione:
  `volcanic`, `terran` / `ocean`, chmury.
- Obiekty w komórkach (wulkany, kaldery, kratery) — pętla po 27 komórkach, każde miejsce dokłada własny profil
  gasnący w promieniu 1 komórki (`forSites`, wzór `pgCraterOctave`). „Hasz najbliższej komórki × profil odległości”
  urywa profil na krawędzi komórki — z orbity niewidoczne, z bliska uskoki i wielokąty.
- Przesunięcie dziedziny szumu (`seedOffset`) zostaje MAŁE (< 7): float32 przy setkach ma krok ~3·10⁻⁵ rad = teksel
  wycinka. Drobny detal (kłęby chmur, plamistość) w dziedzinie SUROWEJ (kierunek + ziarno): dziedzina odkształcona
  (`pgWarp`) albo skręcona (cyklony) rozciąga go w smugi.
- Gałąź z warunkiem z uniformu liczy się także WYŁĄCZONA (kompilator GPU spekulatywnie): `normalize(0)` i
  `atan2(0, 0)` w gałęzi okna przy zerach w uniformach dały NaN w polu całej planety. Dzielenie przez
  `max(długość, ε)`, uniformy wyłączonej gałęzi skończone i niezdegenerowane.
- Nożyce przy rysunku do celu: prostokąt z `renderTarget.scissor`, ale włącza je `renderer.setScissorTest(true)`
  (flaga celu nic nie robi — pas rysował cały cel); czyszczenie nie zna nożyc (`autoClear = false` na pasy).
- Szumu pióropusza i chmur nie przesuwaj promieniście o stałą długość (okrąg tego promienia trafia w jeden punkt
  szumu — współśrodkowe pręgi); ruch w miejscu = przesuw wzdłuż osi przez cienką warstwę.
- Odcień żaru z palety planety tylko słaby (potęga ~0,12): barwa sRGB lawy to liniowo ~(1; 0,15; 0,01) i mnożenie
  przez nią zostawia samą czerwień — barwę niesie temperatura.

## Widok orbitalny: powłoki liczone marszem promienia (demo, niewpięte; opis i koszt: `docs/OPIS-generator-planet.md` § 10.8)

- Powłoki nad planetą to kule jednostkowe (promień daje graf), dzieci kuli planety, bez odcinania kadrem; promień
  widzenia w układzie obiektu z `shellRay` (`planetGenShell.tsl.js`) — kamera perspektywiczna (z pozycji kamery)
  i ortho gry (stały kierunek) jednym grafem. `createGenNearBody`: `setCamera(camera)` i `setSun(dir)` co klatkę,
  `setCloudMode('volume' | 'flat' | 'off')`, `setAtmosphere(on)`. Kolejność rysunku: chmury 5, atmosfera 6, zorza 7,
  pióropusz 10 (`renderOrder`).
- Tekstura szumu 3D (`planetGenNoise3D.js`, 64³, okres 1, z haszu na CPU) jest wspólna dla chmur, zorzy i cienia
  kłębów na gruncie. Próbki w pętli i gałęziach z jawnym poziomem (`texture3D(t, uvw, float(0))`, `.level()`).
- CHMURY JAKO BRYŁA (`planetGenCloudVolume.tsl.js`): gęstość = (szum kształtu − próg) · K; próg z POKRYCIA mapy
  chmur i WYSOKOŚCI w powłoce (`puffThreshold`: 0,71 − 0,43 · pokrycie + wysokość · 0,27…0,52 — liczby z kwantyli
  kanału R szumu, pilnuje test). Szum kształtu w dwóch skalach (`puffNoise`), erozja brzegów tylko wewnątrz kłębu,
  ława warstwowa przy dużym pokryciu (`sheetDensity`). Zmiana progu albo szumu = zmiana także cienia na gruncie —
  materiał powierzchni woła te same funkcje (`puffShape`, `puffThreshold`, `cloudCover`, `sheetDensity`).
- Gęstość „pokrycie × profil wysokości + szum” daje gładką masę (wygląd bitej śmietany); kłęby jednej skali —
  z daleka równy „popcorn” i widoczny okres kafla szumu. Kopuły wychodzą z progu rosnącego z wysokością.
- Jasność chmur w jednostkach grafu gry: oświetlony wierzchołek ~0,9 (pod progiem bloomu), faza pod słońce
  przycięta (Henyey–Greenstein bez przycięcia to ×5 — prześwietlona cała ława), słońce bez mnożenia przez jasność
  ponad 1. Zorza i krawędź atmosfery to emitery HDR — jasność dobieraj na kadrze, w którym leżą na krawędzi tarczy
  (droga promienia przez powłokę jest tam wielokrotnie dłuższa niż z góry).
- ATMOSFERA: faza Rayleigha w jednostkach grafu gry to 3 / 16 · (1 + cos²) (bez podzielenia przez 4π wybiela kadr);
  droga słońca z funkcji Chapmana z gałęzią za terminatorem (przez punkt promienia najbliższy planecie) — droga
  „jak na horyzoncie” zostawia za terminatorem jasny, blady pas. Powłoka dokłada rozpraszanie nad tarczą, więc
  barwa mgiełki grafu gry idzie przy niej ×0,6 (`setAtmosphere`); ekstynkcja i barwy zachodu grafu gry zostają.
- Oszczędności marszu: liczba kroków z długości odcinka w powłoce (16–44), pokrycie z mapy raz na krok (służy też
  bliskiej próbce światła), nocna strona bez próbek światła, odcinek o zerowym średnim pokryciu (próbka z mipmapy
  obejmującej odcinek) bez marszu. Dalsza dźwignia przy wpięciu: pół rozdzielczości.
- Kamera orbitalna dema stoi względem miejsca-bohatera (`orbitAt`), słońce w widoku orbitalnym wyżej (34° za
  terminatorem); `advance()` ustawia kamerę orbitalną przed krokami (kierunki kadru dla wycinka biorą jej macierz).

## Zasady i pułapki

- `PlanetGenBaker.compile` podbija `renderer.info.calls` z 0 na 1 przed kompilacją (three r183, pułapka 45 w regule
  `webgpu-tsl`): bez tego wypiek zrobiony przed pierwszym renderem renderera rysuje próbę ze stanem z kompilacji —
  pusty cel, kwantyle 1, planeta z wodą samym oceanem. Objaw „sam ocean, 0 wybrzeży” = sprawdź `baked.levels.uQ`.
- Wiersz celu wypieku rośnie ku PÓŁNOCY (piksel y = 0 to v = 0 = biegun S): różnica po y jest pochodną na północ —
  bez minusa (odwrócona rzeźba N–S nie rzuca się w oczy przy słońcu ze wschodu; próba: słońce z północy, oświetlona
  ma być ściana krateru zwrócona ku słońcu).
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
- Planeta z bliska: demo `dema/planeta-zblizenie.html` (`?styl=popiol|lawa|siarka|terran`, `?wycinek=2048|4096`,
  `?wycinki=0`, `?erupcja=0`, `?gpu=1`, `?widok=orbita|gora`, `?bryla=0|1`, `?chmury=0…1`, `window.__zbl`: `setView`,
  `goVent`, `setViewMode`, `orbitAt`, `advance(s)`, `measureGpu(n, pre)`, `snapshot()`), zrzuty
  `node scripts/webgpu/planeta-zblizenie-demo.mjs --styl terran --kadry planeta,daleko,wulkan,blisko,bez-wycinka`
  (orbitalne: `orbita,orbita-plaska,orbita-blisko,orbita-daleko,orbita-noc,orbita-zorza` albo
  `orbita-nazwa:dAz,dEl,odległość,px,py[,1]`), testy `node --test tests/planetGenNear.test.mjs`.
