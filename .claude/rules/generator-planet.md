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
  - "tests/planetGenDrainage.test.mjs"
  - "tests/planetGenTerrainMap.test.mjs"
  - "dema/mapa-terenu.html"
  - "dema/mapa-terenu.js"
  - "dema/mapa-terenu.worker.js"
  - "scripts/mapa-terenu-png.mjs"
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
  wchodzące bramką z rozmiaru w tekselach (`C.stN`), linie nie węższe niż ~1,3 teksela. Zrobione:
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

## Pogoda: ruchome chmury (demo, niewpięte; opis i koszt: `docs/OPIS-generator-planet.md` § 10.9)

- Pogoda to CZAS w grafie chmur (`planetGenBake.tsl.js`: `uWx`, `uCycS*`), nie symulacja: obraz w chwili t jest
  funkcją (ziarno, t). Bez `uWx` (zera) graf daje mapę nieruchomą, bit w bit jak przed pogodą — mapa planety
  z `bakeSystem` zostaje bez zmian. Uniformy wypieku startują od ZER (`bakeUniforms` — pułapka 46 w regule
  `webgpu-tsl`): z domyślnym w = 1 flaga `uWx.w` była włączona w PIERWSZYM wypieku mapy chmur i planeta miała inne
  chmury niż jej wycinki; sprawdzenie odczytem celu — mapa planety równa wypiekowi starym grafem. Prawo wiatru w dwóch miejscach, które muszą się zgadzać: `bandAngle` grafu i
  `windRate` / `bandAngle` w `planetGenWeather.js` (stałe `WX_BANDS`, `WX_PHASE`, `WX_SEAM` wspólne).
- Pasy wiatru jadą SZTYWNO (punkt należy do pasa o najbliższym środku), mieszanie dwóch pasów tylko w strefie
  `WX_SEAM`…0,5 szerokości pasa. Obrót ciągły z szerokością ścina wzór bez końca; mieszanie na całej szerokości pasa
  („daszek”) sprawia, że wzory mijają się wszędzie i chmury zmieniają kształt w miejscu zamiast płynąć.
- Mieszanie dwóch niezależnych szumów — z zachowaniem wariancji (`mixNoise`: średnia / √(w² + (1 − w)²)); zwykła
  średnia zostawia w strefie mieszania pas o niższym kontraście (mniej chmur wzdłuż równoleżnika).
- Ten sam podział na pasy mają: pokrycie (graf chmur), kłęby bryły (`puffNoise`), cień kłębów na gruncie i ślizg mapy
  (`wxGlideU`). Kłęby dostają BIEŻĄCY czas pogody, mapa pokrycia jest z chwili `bakedTime` i ślizga się z wiatrem pasa
  do następnego przeliczenia — kłęby z czasem mapy skakałyby przy każdej zamianie, a pokrycie bez ślizgu pulsuje
  względem kłębów.
- Mapa pogody (`PlanetGenWeather`): przeliczenie w pasach celu z JEDNĄ zamrożoną chwilą (`snapshot`) do drugiego
  celu, zamiana po ostatnim pasie; nowe przeliczenie dopiero po przesunięciu o `texelStep` teksela. Wycinek chmur pod
  kamerą tak samo zamraża chwilę na cały wypiek okna (`PlanetGenPatches.weather`, `refresh()`).
- Cyklon: oś przenosi CPU (`cycloneAt` — te same rekordy z ziarna co mapa nieruchoma, ta sama kolejność losowań),
  obrót własny to sztywny obrót szumu w tarczy z przenikaniem przy brzegu; kąt dodany do skrętu spirali nawijałby
  ramiona bez końca.
- Zmiana `texture` mapy pogody = przepięcie trzech odbiorców (`bindWeather` w `planetGenNear.js`): chmury płaskie
  (`cloudTexture`), bryła (`cloudTexture`, `uCvWx`), powierzchnia (`cloudShadowTexture`, `uGnCloudVol2 / 3`).

## Rzeki ze spływu wody i mozaika biomów (terran / ocean; opis, błędy po drodze i koszt: `docs/OPIS-generator-planet.md` § 10.10)

- Rzeki to DRZEWO ze spływu po mapie wysokości planety (`planetGenDrainage.js`, czysty JS): `bakeSystem` rysuje pole
  BEZ rzek w rozdzielczości siatki spływu, przejście `drain:<rodzaj>` (cel RGBA32F: wysokość, opad, temperatura,
  wilgotność) idzie do odczytu CPU (jeden na układ), `computeDrainage` daje teksturę RGBA8 — `baked.drainage`
  ({ texture, width, height, data, stats, uniforms, heightM, temp, moist } — trzy ostatnie to dane MIEJSCA dla
  mapy terenu, § „Mapa terenu”). Rodzaj z rzekami: `drain(F)` w `SOLID_TYPES` + `drainage: true` w `uniformsFor`. Linie zera
  szumu jako rzeki dają pętle i przecięcia — nie wracać.
- Graf pola jest jeden na rodzaj, a tekstura spływu jest per planeta: przed KAŻDYM rysunkiem pola
  `uDr: baker._bindDrain(rodzaj, baked.drainage)` (podstawia `graph.drain.value`). Bez spływu `uDr = [1, 1, 0, 0]` —
  gałąź rzek wyłączona, uniformy skończone (próba, wejście spływu).
- Kanały pola terran / ocean: y > 0 — woda słodka, y < 0 — minus wilgotność doliny (pas przy rzece), na MORZU
  y = −smuga osadu z rzek; z > 0 — pasma gór, z < 0 — dno doliny zalewowej: −0,49 · łuki dawnych koryt (0…−0,49)
  albo −(0,5 + 0,5 · łacha piasku), w pikselu WODY słodkiej z = −0,49 · muł niesiony przez wielką rzekę. Odbiorcy
  czytają `max(·, 0)` (maski, połysk); nowy odbiorca pola też.
- Tekstura spływu (RGBA8): R — kierunek do odbiorcy, G — przepływ (log), B — odległość od morza [komórki ×
  `DRAIN_SEA_K`], A — smuga osadu w morzu przy ujściach rzek (stempel wokół komórki morza, do której uchodzi
  rzeka; obejmuje też ląd przy brzegu — próbka dwuliniowa nie gaśnie na brzegu; tylko mapa całej planety).
- Geometria rzeki (`riverNet`): węzeł = środek komórki + przesunięcie z haszu (≤ `DRAIN_JITTER` = 0,22 — przy
  większym odcinki drzewa mogą się skrzyżować), bieg = łuk Béziera przez węzeł odbiorcy (`bezierNear`), meander =
  sinusoida w poprzek łuku z zerem w węzłach; liczba półfal Z SZEROKOŚCI koryta (długość fali ≈ 12 szerokości —
  stała liczba daje wielkiej rzece zęby zamka), amplituda do ~⅓ fali. Wzorzec wyglądu rzeki nizinnej (zdjęcie od
  użytkownika): ciemne koryto, jasne łachy po wewnętrznej stronie zakoli, soczyście zielona dolina z łukami
  dawnych koryt, jasne tarasy na brzegu doliny, beżowe rozgałęzione polany w ciemnym lesie — § 10.12 opisu. Szerokość z przepływu WŁASNEJ komórki (interpolacja do przepływu
  odbiorcy pogrubia dopływy — gwiazdy w zbiegach). Dolina i pas zalewowy idą wzdłuż łuku bez meandra.
- Sąsiedztwo 5 × 5 komórek daje pewne odległości do ~0,75 komórki — zasięgi doliny i pasa wilgotności są do tego
  przycięte; szersze pasy wymagają większego sąsiedztwa.
- Poziomy szczegółowości rzek: próg widoczności przepływu rośnie z tekselem celu (`lfVis`), linia węższa niż teksel
  ma ~1,3 teksela i pokrycie (w / wt)^0,7, meandry i starorzecza gasną, gdy teksel ich nie rozdziela.
- Spływ na CPU: odbiorca wybierany spośród sąsiadów zalanych WCZEŚNIEJ (bez pętli), ważony polem „ulubionego
  kierunku” (gładkim — losowanie na komórkę daje zygzak); przekątna odpada, gdy druga przekątna kwadratu 2 × 2
  niesie połączenie (bez przecięć — pilnuje test); komórka poniżej poziomu zalania dostaje koszt malejący
  z głębokością (rzeka idzie osią zagłębienia); do wysokości TRASOWANIA dochodzi szum `wander` (nie do rzeźby).
- Barwy lądu (`earthColor`) to KLASY pokrycia z ostrymi granicami: próg przez `edge(v)` (szerokość z `fwidth` celu
  wypieku — bez schodków tekseli przy powiększeniu wycinka), szum granic (`nMo`, `nBog`) od ~6 tekseli okresu, szum
  ziarna (`nD`, od 3 tekseli) tylko w fakturze, nie w progu. Wzory widoczne dopiero z bliska (wydmy, skupiska
  drzew) gasną z tekselem celu (`st`). Klimat (`earthClimate`) jest wspólny dla barw i opadu spływu.
- Dane dla gry: `riverMouths(baked.drainage)` — ujścia rzek od największej (miejsca pod miasta i porty; użytkownik
  planuje desant na powierzchnię i proceduralne miasta), `drainReceiver` — bieg rzeki komórka po komórce.

## Spójność między poziomami zbliżenia i góry (terran / ocean; opis i przyczyny: `docs/OPIS-generator-planet.md` § 10.11)

- Zasada: ten sam obszar ma wyglądać tak samo na każdym poziomie zbliżenia — zbliżenie DOKŁADA szczegół, nie zmienia
  układu (brzeg, rzeki, płaty lasu, śnieg). Sprawdzanie: seria zrzutów jednego miejsca w kilku odległościach kamery,
  nie pojedyncze kadry.
- Próg, który decyduje o KLASIE piksela (morze / ląd, las / łąka, śnieg), nie zależy od rzeczy liczonych inaczej na
  każdym poziomie: detalu dokładanego co klatkę, krzywizny i nachylenia w skali teksela, wzorów włączanych dopiero
  z bliska. Człon włączany z bliska ma średnią ZERO (skupiska drzew: stała 0,516 = średnia odległość komórek).
- Brzeg morza w materiałach: wysokość mapy + detal × `coastK` (nachylenie mapy) — sam detal na płaskiej nizinie
  wybija kałuże z pianą, inne na każdym poziomie.
- Rzeka ma z daleka być tą samą niebieską linią co z bliska: pas zalewowy tylko gdy cel go rozdziela, pokrycie wody
  węższej niż teksel (w / wt)^0,5, połysk wody słodkiej słaby. Odkształcenie biegu rzek na każdym poziomie to samo
  (długie fale), przy morzu gaśnie z kanału B siatki spływu (odległość od morza).
- Krzywa z końcem o zerowej stycznej (łuk Béziera z B = C — ujście do morza): odległość ze stycznej daje 0 w całym
  obszarze za końcem; styczną zastępuje cięciwa (`bezierNear`). Objaw: prostokąt o bokach sąsiedztwa komórek.
- GÓRY: pasma = granice zbieżne płyt + łańcuchy śródlądowe (`rangeN`); grzbiety o częstości `mountainFreq` ×
  `EARTH_RIDGE_FREQ` — przy niskiej częstości „pasmo” jest kopułą-płaskowyżem i cała leży nad linią śniegu (biała
  plama). Profil: przedgórze + grzbiet² (wąskie szczyty). Rozkład wysokości sprawdzaj odczytem mapy rzeźby
  (udział lądu w pasach co 1 km), nie na oko.
- Śnieg: próg temperatury (spadek 0,16 / km), ostra linia w górach, bez śniegu na ścianach ponad ~30% nachylenia,
  albedo poniżej progu bloomu. Materiały planet z wodą: normalne z nasyceniem dopiero powyżej ~10% nachylenia
  (nasycenie od zera spłaszcza doliny niziny), cień terenu × 3,6 (`RELIEF`), światło nieba (`skyFill`) tylko tam,
  gdzie jest ciemniej niż na płaskim gruncie — bez niego ściany gór są czarne, z dopłatą dla płaskiego cały ląd
  blednie przy niskim słońcu.
- Szum w progu pasa przy rzece: nie DODAWAĆ do wilgotności doliny (kropki pasa wzdłuż każdego strumyka) — działa
  tylko na część ponad smugę strumyka (`wetBig`). Wzory dna doliny (łachy, pasy, tarasy) gasną, gdy teksel celu ich
  nie rozdziela („koraliki”). Plaża tylko w promieniu 3 tekseli od punktu poniżej poziomu morza.

## Planeta z daleka: krajobraz jak na mapie terenu, tryb ultra (opis, liczby i błędy po drodze: `docs/OPIS-generator-planet.md` § 10.16)

- Decyzja użytkownika (2026-11-11): szczegółowość map terenu ma mieć CAŁA planeta, zaczynając od planety
  oddalonej — „bardziej szczegółowa i zbliżona do map terenów”. Osobny panel z mapą miejsca nie jest celem.
- Barwy krajobrazu planety idą z palet MAPY TERENU (`terrainLandscape(paleta)`, `TERRAIN_WATER` w
  `planetGenTerrainMap.js` → `landscapeUniforms` → `uFenA / B`, `uFenWetA / B`, `uGrassA / B`, `uMeadowA / B`,
  `uWDark`, `uWMud`, `uWIce`, `uSilt`, `uSandB`): A — klimat chłodny (tajga), B — ciepły (las równikowy), planeta
  o rdzawej roślinności — paleta czerwona; lekki odcień ku barwie lasu planety. Zmiana palety mapy terenu zmienia
  też planetę.
- TORFOWISKA I POLANY to mozaika pól w trzech skalach (komórka szumu ~120, ~33, ~9 km; `fenLayer`), z dziedziną
  odkształconą własnym szumem warstwy (sam próg szumu przy małym udziale pola daje okrągłe kropki). Warstwa,
  której teksel celu nie rozdziela, wchodzi ŚREDNIĄ (`fenMean` — udział pola jako rozjaśnienie): kraina torfowisk
  ma tę samą jasność na każdym poziomie zbliżenia. Jedna wielka plama z progu szumu o gasnących oktawach wygląda
  jak naklejka — nie wracać.
- Woda słodka: ciemna (rzeki leśne, jeziora), mętna (wielka rzeka: `RIVER_MUD_LF0 / LF1` ≈ przepływ 600–1800, od
  tej wielkości mapa terenu rysuje „wielką rzekę”), mleczny błękit (rzeki w górach). Rzeka nie ma barwy morza.
  Pas zalewowy wielkiej rzeki węższy niż teksel gaśnie ze stosunkiem szerokości (z daleka jaśniejsza wstęga doliny).
- SMUGI OSADU przy ujściach: kanał A siatki spływu → w polu próbka w punkcie przesuniętym szumem (skala w komórkach
  siatki 2048 — `kS`) → głębokość morza z ŻĄDANEJ widoczności dna (materiał pokazuje dno z wagą e^(−28 · głębokość))
  i barwa dna = muł. Liniowe spłycenie do kilku metrów daje półkę o ostrym brzegu, którą detal wysokości wynosi
  nad wodę (blady „ląd” w morzu); barwa mułu tylko pod wodą (h < 0) — wyspy na szelfie leżą po stronie morza.
- Pas o szerokości w TEKSELACH celu (plaża „nie mniej niż 2 teksele”, piana przyboju w pasie płycizny) robi wokół
  każdego lądu obwódkę, grubszą z daleka: szerokość w kilometrach, a gdy teksel jest większy — pokrycie
  (szerokość / teksel)^0,7; przybój z daleka 0,08 i tylko tam, gdzie dno opada (nachylenie mapy).
- TRYB ULTRA dema (`?ultra=1|0`, domyślnie na ekranach szerszych niż 3000 px): mapa planety 4096 × 2048, siatka
  rzek 4096 (`bakeSystem({ drainSize })` — stałe rzek są w komórkach, więc gęstsza siatka daje więcej cieńszych
  rzek i więcej prawdziwych zakrętów), okno pod kamerą 6144 × 3072. Okno ma stały kształt 2 : 1 i zapas 1,5 —
  na ekranie 5120 × 1440 okno 4096 daje 0,27–0,53 teksela na piksel.

## Płynne zbliżenie: głębokie poziomy okna pod kamerą (etap 1; opis, liczby, błędy po drodze: `docs/OPIS-generator-planet.md` § 10.18)

- Cel użytkownika: planeta sama wyostrza się do skali mapy terenu (kadr ~30 km) w każdym miejscu, bez panelu.
  Droga: te same funkcje pola i barw, tylko z drobniejszymi warstwami — spójność z poziomami dalszymi wynika
  z budowy. Mapa terenu na CPU (`planetGenTerrainMap.js`) nie jest poziomem zbliżenia planety: jej rzeka i pola
  mają własny układ.
- RZEKA (`riverNet`): sąsiedztwo 7 × 7 komórek (łuk należy do DAWCY, a leży wokół odbiorcy — jego dalszy koniec
  bywa ponad 2 komórki od niej); brzeg miękki z daleka, ostry z bliska, zawsze w 0,7 szerokości (`soft`);
  wychylenie zakola × obwiednia sin²(πt) (w węzłach łuku znika wychylenie i jego pochodna — bez załamań),
  ≤ 0,45 najmniejszego promienia łuku Béziera (większe: wstęga przecina samą siebie — „namioty” i proste cięcie
  wzdłuż osi łuku) i gasnące z kątem zakrętu; `RIVER_MEANDER` = 0,5 (zbocze zakola do ~57°; 0,7 = zęby piły);
  szerokość i muł interpolowane wzdłuż odcinka GŁÓWNEGO dawcy do wartości odbiorcy (`lfT` — bez schodka na
  łączeniu; dopływ zostaje przy swojej szerokości); muł ważony pokryciem (czysty dopływ nie maluje ciemnej wody
  na mętnej rzece).
- Odległość od koryta z przybliżenia |poprzek − m| / √(1 + m′²) jest dobra tylko PRZY korycie: poprawka stromości
  gaśnie poza ~2–6 szerokościami (`nearK`), inaczej strome zbocze zakola daje „odległość ~0” daleko od rzeki.
- POLA: pięć warstw (`fenLayer`: ~120, ~33, ~9, ~2,5, ~0,7 km; dwie drobne rzadsze), pas zarośli wokół pól
  (ten sam szum z niższym progiem), wyspy drzew z komórek w dwóch skalach (`isle`: promień z haszu, obrys
  łamany szumem — równe kółka wyglądają jak dziurkacz). Wszystko, czego cel nie rozdziela, wchodzi średnią.
- KORONY W RZEŹBIE: alfa mapy dnia na LĄDZIE = wysokość pokrycia (`EARTH_CANOPY_KM` = 0,12 km na jednostkę; na
  morzu alfa to dalej lód morski). Graf rzeźby dodaje ją do wysokości (`uRel.w`, węzeł `day` — `_reliefU` podstawia
  mapę dnia tego samego celu), więc materiał liczy światło i cień także od lasu: skraj lasu rzuca cień na
  torfowisko, korony mają fakturę (komórki ~210, ~107, ~53 m). Planeta z plików: wysokość w pliku ma już korony
  (`_reliefU(…, false)`). Drobny detal w dziedzinie surowej (`C.dir`, bez przesunięcia ziarna) — float32.
- Okno ma poziomy do 10 (demo: `?poziom=`); okna głębszych poziomów pieką się kaskadą poziom po poziomie —
  narzędzie zrzutów czeka, aż poziom się ustali. Przy stałym kształcie okna 2 : 1 poziom zależy od ułożenia
  kadru względem ściany sześcianu (ten sam kadr: poziom 8 albo 10).
- STRUMIENIE REGIONU (etap 2, `planetGenRegion.js`, opis § 10.19): gdy okno zejdzie dość głęboko, żeby zmieścić
  się w regionie (siatka 1024 × 1024 komórek ~0,5 km w układzie ściany okna, początek na stałej kracie co 64
  komórki), `PlanetGenRegionStreams.update()` zleca: pole planety w oknie regionu → odczyt CPU
  (`baker.readRegionField`) → UJŚCIA (`regionSinkHeights`: morze, woda słodka planety i pierścień brzegu regionu
  mają wysokość −1) → `computeDrainage` w workerze (`planetGenRegion.worker.js`) → tekstura → `base.region` →
  `patches.refresh()`. Graf pola rysuje ją drugim wywołaniem `riverNet` (uniformy `uDr2`, `uRg`, `uRg2`; skala =
  komórka regionu), z odkształceniem biegu gasnącym przy rzece planety i gaśnięciem przy brzegu siatki.
- Rzeki planety jako ujścia to warunek: bez nich spływ regionu rysuje drugą rzekę obok rzeki planety (dolina jest
  wycięta w wysokości). Brzeg regionu jako ujście — inaczej zlewnie przecięte krawędzią szukają drogi w środku.
- Wypiekacz podaje siatkę regionu tylko oknu w układzie TEJ SAMEJ ściany (`rg.axes !== win.frame` → gałąź
  wyłączona, uniformy skończone); liczenie nie startuje w trakcie wypieku okna (wspólny graf pola).
- Hasze węzłów siatki regionu biorą numer komórki na kracie planety (`hash: { ox, oy }` w `riverNet`) — przesunięty
  region daje tym samym komórkom te same węzły.
- NIE zrobione (kolejne etapy): zakola z symulacji wędrówki koryta i starorzecza, delta i wybrzeże z bliska
  (brzeg z szumu jest postrzępiony, piana obrysowuje każdy ząbek), pozostałe biomy; strumienie poza regionem
  (poziomy płytsze niż ~7) nie istnieją.

## Kształt brzegu przy zbliżaniu i roślinność planety (opis i przyczyny: `docs/OPIS-generator-planet.md` § 10.20)

- Szereg szumu, którego PRÓG rysuje granicę (brzeg morza, granica lasu, pola), z `gain · lakunarność > 1` ma
  w coraz drobniejszej skali coraz większe nachylenie: każda oktawa dokładana przez głębszy poziom okna otwiera
  i zamyka cieśniny, zatoki i przesmyki widoczne już poziom wyżej (użytkownik: „oddalone trzyma się, przybliżone
  ma odstępy między wyspą a lądem”), a z bliska brzeg jest strzępiony w konfetti. Takie szeregi mają OGON
  (`pgFbm(…, tail)`: oktawy ≥ `from` z `gain · 2,03 < 1`): `COAST_TAIL` — detal wybrzeża w `plates`,
  `COVER_TAIL` — `nMo`, `nD`. Pierwsze oktawy (kształt z daleka) bez zmian. Nowy szereg progowy — też z ogonem.
- Sprawdzanie spójności: ten sam kadr z różnym `?poziom=` (najgłębszy poziom okna) — brzeg ma być tą samą linią.
- ROŚLINNOŚĆ PLANETY: zestawy `zielona`, `morska`, `oliwkowa`, `czerwona`, `purpurowa`, `zlota` (+ dawna
  `rdzawa`); `PLANET_VEGETATION` (`planetGenTerrainMap.js`) mapuje zestaw na palety mapy terenu [chłodny, ciepły]
  — jedno źródło dla barw planety (`landscapeUniforms`, zestawy `VEGETATION` w `planetGenSpec.js`) i dla mapy
  miejsca (`describePlace`). `describePlanet({ …, vegetation })` nadpisuje roślinność (reszta planety z ziarna).
- Kępy drugiego gatunku (`accent` palety: czerwone korony w lesie równikowym, złote w czerwonym, morskie
  w purpurowym) — dwie skale płatów w lesie, skala nierozdzielona wchodzi średnią. Płycizna morza turkusowa,
  dno smugi osadu jasne (mleczny turkus przy ujściach) — jak morze na mapach terenu.
- Style rzek mapy terenu (ramiona delty, rzeka roztokowa, wielka rzeka z wyspami) NIE są jeszcze na planecie —
  planeta ma jeden model rzeki (łuki z zakolami); to osobny etap.

## Planety przygotowane: mapy jako pliki (opis, liczby, format: `docs/OPIS-generator-planet.md` § 10.17)

- Decyzja użytkownika (2026-11-11): planety pierwszego przejścia gry (kampania) są PRZYGOTOWANE i dostarczane jako
  pliki map („to jest pewniak”); tryb „sandbox” (nowa gra bez fabuły) generuje planety z ziarna, z ostrzeżeniem
  o czekaniu. Jeden generator dla obu — plik to zapisany wynik wypieku.
- `planetGenFiles.js`: `exportPlanet(renderer, baked)` → { meta, files }, `loadPlanet(baker, url)` → wynik o kształcie
  `bakeSystem` (przez `PlanetGenBaker.importPlanet`). Katalog planety: `meta.json` (cały `spec`, `levels` z próby,
  rozmiary), obrazy map (dzień, noc, chmury — WebP stratny; maski, połysk i alfa — PNG bezstratny), `height.i16.bin`
  (Int16 co 0,5 m, różnice w wierszu, gzip), `drain.*.bin` (siatka spływu i dane miejsc). Wiersz 0 = biegun S.
- Mapa rzeźby NIE jest w pliku: przy wczytaniu wysokość idzie do celu pola i liczy ją ten sam graf rzeźby co
  w wypieku (nachylenia, szorstkość). Mapy 8-bitowe są przepisywane do celów tego samego rodzaju co po wypieku
  (`copy8`: bajty sRGB przez krzywą odwrotną, alfa z osobnego obrazu — kanwa 2D premultiplikuje alfę, więc mapa
  z alfą idzie jako dwa obrazy).
- Okna pod kamerą planety z plików piecze dalej wypiekacz na karcie gracza — z `levels` i siatki spływu z pliku,
  więc układ rzek i brzegów jest ten sam u każdego; `spec` w pliku jest kompletny (wczytanie nie woła
  `describePlanet`). Zmiana generatora = ponowne wypalenie plików.
- Pliki spakowane gzipem mają rozszerzenie `.bin`, nie `.gz`: serwery (Vite w dev) podają `.gz`
  z `Content-Encoding: gzip` i przeglądarka rozpakowuje je sama; wczytanie rozpoznaje gzip po bajtach 1F 8B.
- `importPlanet` tworzy pipeline'y przejść przepisania synchronicznie przy pierwszym użyciu — przy wpięciu do gry
  wołać na ekranie ładowania albo dopisać do rozgrzewki.
- Narzędzia: `node scripts/webgpu/planeta-wypal.mjs --nazwa terran-21 [--styl terran --ziarno 21 --mapa 8192
  --rzeki 4096 --out .tmp/planety/<nazwa>]`, podgląd `dema/planeta-zblizenie.html?plik=<nazwa>` (albo
  `?plik=ścieżka/od/korzenia`), testy `node --test tests/planetGenFiles.test.mjs`. Gdzie pliki mają leżeć
  w wydaniu (repozytorium, LFS, osobna paczka) — do decyzji; dziś `.tmp/planety/` (poza gitem).

## Mapa terenu — trzeci poziom (prototyp; opis, wzorzec i różnice: `docs/OPIS-generator-planet.md` § 10.13–10.15)

- CEL użytkownika: ostrzał miast z orbity i desant (minigra RTS o miasta) — wokół miasta ma być krajobraz jak na
  zdjęciu satelitarnym, a biom miejsca wyznacza resztę. Planeta i zbliżenie tego nie pokażą (komórka sieci rzecznej
  planety ~17 km, zdjęcie wzorca ~30 km): krajobraz w skali miejsca robi MAPA TERENU, nie dalsze strojenie planety.
- `planetGenTerrainMap.js` (czysty JS — przeglądarka, worker, Node): `generateTerrainMap({ seed, size, extentKm,
  biome, river, veg, riverWidthM })` → warstwy: `albedo` (RGBA8 sRGB, wiersz 0 = północ), `height` [m], `cover`
  (`TERRAIN_COVER`: woda, piasek, łąka, zarośla, las, torfowisko — także pod rozgrywkę), `river` (oś [m]), `sea`.
  Biomy: `TERRAIN_MAP_BIOMES` (dziś `tajga`). Opcje ze złącza z planetą: `flowAngle` (kierunek spływu rzeki; układ
  mapy: x — wschód, y — południe), `vegTint` (mnożniki barw całej palety roślinności).
- ZŁĄCZE Z PLANETĄ (`planetGenPlace.js`, czysty JS): `describePlace(baked, kierunek)` czyta dane miejsca, które
  wypiek zostawił na CPU (`baked.drainage`: drzewo rzek, odległość od morza, `heightM` Int16 [m], `temp` / `moist`
  Uint8 — kodowanie `PLACE_T` / `PLACE_M`, ten sam klimat co barwy planety), i zwraca gotowe opcje
  `generateTerrainMap` (`map`): styl i szerokość rzeki z przepływu, kierunek spływu z pierwszych kroków w dół rzeki
  (przy delcie morze leży po właściwej stronie), roślinność, bok mapy, ziarno = (ziarno planety, komórka) — to samo
  miejsce daje tę samą mapę. Punkt w morzu przy brzegu przeskakuje na ląd, punkt obok rzeki — na największą rzekę
  okolicy (`searchKm`); otwarte morze → `{ ok: false, reason: 'morze' }`.
- Mapa terenu NIE odtwarza planety teksel w teksel: bierze z niej, CO jest w miejscu (rzeka tej wielkości płynąca
  w tę stronę, morze w tym kierunku, taki klimat), i buduje krajobraz w swojej skali. Kształt brzegu morza i bieg
  zakoli na mapie nie są kształtem z planety.
- Barwy mapy przy planecie: układ palety z klimatu miejsca (`tajga` / `tropik`; planeta o rdzawej roślinności —
  `czerwona`), odcień w połowie ku barwie lasu PLANETY (`vegTint`, siła `PLACE_TINT`). Wybór innej palety mapy
  z nazwy palety planety dawał mapę w innej barwie niż planeta widziana z orbity — nie wracać.
- Biom miejsca (`biome`: las, step, pustynia, tundra, góry, lód i śnieg) z progów klimatu planety; `supported`
  mówi, czy biom ma przepis mapy (dziś tylko las — reszta dostaje mapę lasu z dopiskiem w demie). Nowy biom =
  przepis w `generateTerrainMap` + wpis w `describePlace`.
- Tajga: linie cieków z wygładzonego rastra pokrycia (`streamCov`), brzeg torfowisk z szumem i zielonym pasem
  zarośli, faktura lasu z szumu WYSOKOŚCI koron (cieniowanie robi resztę) — szum dokładany wprost do barwy lasu
  daje płaską „kaszę”.
- STYLE RZEK (`TERRAIN_RIVERS`, wzorce — zdjęcia od użytkownika, § 10.14 opisu): `meandry` (symulacja), `wielka`
  (szerokie koryto z wyspami i bocznymi ramionami, muł), `roztoki` (żwirowe łożysko z plecionką koryt), `delta`
  (morze, ramiona delty z lejkami pływowymi, potoki pływowe, smugi osadu). Bok mapy dobieraj do stylu: wielka rzeka
  i delta ~40 km, roztoki ~12–16 km. ROŚLINNOŚĆ (`TERRAIN_VEGETATION`): `tajga`, `tropik`, `czerwona`, `purpura`,
  `zlota` — decyzja użytkownika: barwy roślin mogą być śmiałe („drzewa są nie tylko zielone”).
- Współrzędne „wzdłuż / w poprzek” rzeki (wyspy, plecionka, boczne ramiona, pas doliny) liczone od NAJBLIŻSZEGO
  węzła osi skaczą między węzłami o ~odległość × kąt załamania: oś gęsto (węzły co ⅛ szerokości koryta przy wzorach
  daleko od osi), inaczej kształty są pocięte prostymi krawędziami. Brzeg wody z kół wokół węzłów — także z punktów
  pośrednich (koła co pół szerokości dają brzeg jak sznur korali).
- Wielka rzeka z symulacji meandrów wychodzi wężem o równych pętlach — jej koryto to oś doliny z kołysaniem, a wyspy
  i ramiona są wzorem. Źródła smug osadu w morzu tylko w ujściach ramion delty; potoki pływowe tylko z większych
  cieków blisko morza, z położeniem uśrednionym wzdłuż cieku.
- Rzeka to SYMULACJA wędrówki koryta (`simulateMeanders`), nie wzór: zakola, odcięcia i starorzecza wynikają z modelu,
  a łachy, łuki dawnych koryt, zasięg doliny i sukcesja roślin — z rastra „kiedy ostatnio płynęła tu rzeka”.
  Zaburzenie startowe osi rzędu szerokości koryta i na całej długości (mniejsze zostawia górny odcinek prosty).
- Cieki: `computeDrainage` w trybie mapy lokalnej (`wrapX: false`, `rowWeight: false`, `keep: true`). Rastry
  pochodne ze spływu (wysokość nad ciekiem, wielkość cieku) WYGŁADZAĆ przed użyciem w progach — surowe skaczą na
  granicach zlewni (schodkowe brzegi torfowisk i łęgów).
- Wygląd oceniać OBOK zdjęcia wzorca w tej samej skali i z kwantyzacją palety (liczby w opisie), nie na oko.
- Wzory regularne zdradzają generator także tu: równe kółka wysp drzew, kreska przy każdym strumyku, pasmo o stałej
  szerokości — losować obecność, kształt i szerokość.
- Narzędzia: demo `dema/mapa-terenu.html` (listy rzeki i roślinności, `?rzeka=`, `?ros=`), PNG
  `node scripts/mapa-terenu-png.mjs --rzeka delta --ros tropik --km 40 --roz 2048 --ziarno 4 --out …`, testy
  `tests/planetGenTerrainMap.test.mjs`. Złącze: demo planety `dema/planeta-zblizenie.html?styl=terran` — dwuklik
  na lądzie otwiera mapę terenu miejsca (worker, `?teren=2048` — większa mapa; `window.__zbl.openPlace(kierunek)`,
  `pickDir(x, y)`, `closePlace()`, stan w `terrain`), testy `node --test tests/planetGenPlace.test.mjs`.

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
  (demo: `?ultra=1|0`, `?mapa=2048|4096|8192`, `?rzeki=1024|2048|4096`, `?wycinek=2048|4096|6144|8192`,
  `?plik=<nazwa>` — planeta z plików map, `?poziom=1…11` — najgłębszy poziom okna, `?strumienie=0`,
  `?ros=zielona|czerwona|purpurowa|zlota|morska|oliwkowa` — roślinność (także lista w panelu),
  `?region=512|1024|1536|2048` — strumienie regionu;
  orbitalne: `orbita,orbita-plaska,orbita-blisko,orbita-daleko,orbita-noc,orbita-zorza` albo
  `orbita-nazwa:dAz,dEl,odległość,px,py[,1]`; `--pogoda "0,1,2,13"` — ten sam kadr po kolejnych sekundach pogody,
  `--bez-raf 1` — start bez klatek rAF), demo: `?pogoda=0…12|off`, `?czas=`, `?mapaPogody=2048`; testy
  `node --test tests/planetGenNear.test.mjs`.
- Spływ wody: testy `node --test tests/planetGenDrainage.test.mjs` (drzewo do morza, bez pętli i przecięć, wpięcie
  w wypiek); kadry lądu z rzekami: `--kadry "lad:0.25,0.35,0.6,rzeka:0.262,0.335,3.0" --q "pogoda=off" --kod
  "window.__zbl.S.cloudsOn=false"` (planeta `terran`, ziarno 21).
