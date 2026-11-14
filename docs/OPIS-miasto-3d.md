# Miasto 3D na grzbiecie okrętu — opis

> Temat 3 generatora kadłubów (orkiestrator prac nad drednotem). Zabudowa „miasta” na otwartym rowie osi okrętu jako
> PRAWDZIWE bryły 3D: generator wieżowców, generator masywu i moduł renderu na Core3D, pokazane na stronie dema.
> Wpięte do dema kreatora (pole projektu `city`, § 6), niewpięte do gry (plan — § 9). Makieta płaska (gałąź
> `claude/kreator-miasto-f58236`) — odrzucona przez użytkownika 2026-11-14 („kropki są na dachu reprezentując okna od
> dachu”, „miasto będzie 3d”). Po pierwszym demie: „kamera od góry widzę, że jest ortograficzna? w grze/generatorze chcę
> 3d gta style (tak jak w grze)”, „jak wezmę »z ukosa« do góry to jest OK, ale »cały okręt« wszystko spłaszcza”.

## 1. Rozpoznanie (stan gry i kreatora, 2026-11-14)

### Kamera, czyli ile widać ścian

- Płaszczyzna gry (kadłuby, mostki, reaktory — warstwa 0, pass `ortho`) rysuje się kamerą **ORTOGRAFICZNĄ prosto
  z góry** (`Core3D.cameraOrtho`, z = 150 000, `syncCamera`): ściana pionowa ma w kadrze zerową szerokość.
- Wysokie budowle w zwykłym widoku gry (stacje, budowle świata, planetoida bazy piratów) idą passem **FG** (warstwa 2,
  `Core3D.enableForeground3D`, `makeScenePass('fg', …, 2, false)` — własna głębia): kamera PERSPEKTYWY
  `Core3D.cameraPersp` — `FLAT_PERSP_FOV` 35°, nad punktem kamery na wysokości (h / 2) / tg(17,5°) / zoom, prosto w dół
  (płaszczyzna z = 0 w tej samej skali co ortho; to, co wyżej, wychyla się ku brzegom kadru i widać ściany). Tą samą
  kamerą rysują się planety (passy tła i planet). (Pierwsza wersja tej noty podawała błędnie, że perspektywa rysuje
  tylko planety.) Demo miasta w widokach z góry używa domyślnie dokładnie tej kamery (§ 3).
- Kamery 3D gry (`src/game/game3D.js`, K / Shift+K — reguła `modele-3d`) i reżyser kadru ustawiają Core3D w tryb
  `free3d` (perspektywa, wspólna głębia): wtedy widać ściany. Ten tryb daje ujęcie „z ukosa” jak kadr odniesienia —
  demo używa go do orbity.
- Wniosek: wysokość z góry musi się czytać z **cienia rzucanego** (na kadłub i między bryłami), z **tonu i krawędzi
  dachów** (jasna faza krawędzi od słońca, ciemna od cienia — czytelne tarasy) i z **pochylonych frontów tarasów**
  (skos ściany — wzór: skos hali mostka ≥ ~50°, reguła `mostki-reaktor`), na których widać światła. Światła okien na
  pionowej ścianie są z góry niewidoczne — z góry świecą tylko szczeliny i kaniony (rzędy u podstaw ścian), uskoki
  tarasów i skosy.

### Światło i cień

- Kadłub i mostek: kierunek światła `normalize(słońce − statek, z = 600)` — słońce jest ~60 000 j. dalej, więc pada
  NIEMAL POZIOMO; dach dostaje samo otoczenie (0,24) + „poduszkową” normalną kadłuba (`hullLightAt`, bridge3D.js), ściana
  zwrócona do słońca — pełne rozproszone (1,18). Stałe `SHIP_LIGHT_DEFAULTS` (hexShips3D.js).
- Cień rzucany mostka liczy marsz po mapie wysokości modelu w stronę „słońca cieni” (ten sam azymut, wysokość
  `shadowElevDeg` 30°) i kładzie go też na otoczenie (`selfShadowAmbient` 0,55) — przy poziomym słońcu fizyczny cień
  miałby setki jednostek, a dachy świecą samym otoczeniem. Kadłuby **nie odbierają** shadow map three — cień na kadłubie
  to prostokąt POD kadłubem (z = −0,6) z testem głębi GREATER (rysuje się tylko tam, gdzie kadłub zapisał głębię:
  przycięty do sylwetki, nie wpada w wyrwy), renderOrder 11, bryła 12.
- Maska słońca Core3D (cień planet i innych kadłubów): człon słońca × `sunVisibility()`, otoczenie × `sunFill(vis)`
  (`src/3d/sunShadowMask.js`), emitery jej nie czytają.

### Jak mostek siedzi na kadłubie (wzór dla miasta)

- `src/3d/bridge3D.js` + `bridge3D.tsl.js` + `bridge3DShapes.js`: JEDEN graf i materiał bryły na wszystkie rodzaje,
  `Mesh` z `InstancedBufferGeometry` (nie `InstancedMesh` — jego uuid wchodzi do klucza programu), dane instancji
  w jednym przeplecionym buforze (limit 8 buforów wierzchołków), stałe rodzaju w `uniformArray`.
- Poza: baza osi modelu i przesunięcie w instancji liczone z pozy RENDERU kadłuba (`bridgeRenderPose` / `playerPose`
  — bez niej model drga względem skóry przy 240 Hz); duży offset świata w `mesh.position` (three składa
  `modelViewMatrix` w double), w instancji małe liczby.
- Maskowanie i „Statki 3D”: `Bridge3D.update(…, { visibility })` — gra podaje `bridgeModelVisibility` × maskowanie
  (`entityCloakVisAt`); poniżej progu instancja znika. Mgła wojny — model tylko na encjach z listy widocznych.
- Zasilanie: okna z kanałem `bridge` (`shipPowerLook`), czerwone lampy awaryjne bez prądu.
- Zniszczenia: bufor storage stanu komórek siatki belek pod modelem (R — HP, B — maska martwych sąsiadów); fragment nad
  martwą komórką → `Discard`, brzeg ciemny i żarzący się. Wrak dziedziczy rekord za ciałem silnika (`dmgKey`).
- Rozgrzewka: `Core3D.warmup.add({ name: 'mostki 3D (bridge3D)', objects: () => Bridge3D.warmupMeshes(), layer: 0,
  phase: 'loading' })`; narzędzia liczą pipeline'y synchroniczne (ma być 0).
- Demo kreatora: blok „MOSTEK 3D w gnieździe” (`dema/kreator-kadluba-webgpu.js`) montuje strefy z gniazd v 2 na belkach
  kadłuba projektu (`attachBeamBridges`), a `Bridge3D.update` rysuje je jak w grze — układ projektu = świat (kadłub
  w środku obrazu, kąt 0).
- Partia wież (`src/3d/ships3d/turretBatch3D.js`) — ten sam wzorzec: jeden rysunek, slot per obiekt w buforze.

### Kreator i drednot

- Kreator liczy PŁASKI pakiet kadłuba (albedo, mapa powierzchni, emisja) — geometrii 3D nie generuje; bryły 3D na
  kadłubie (mostki, reaktory, bronie) stawia gra osobnymi modułami. Miasto idzie tą samą drogą: czysty generator
  w `src/game/hullDesign/`, bryły w module renderu, niczego w obrazie kompozytora.
- Drednot TN (`warships/dreadnought.js`, 8 000 × 3 816 j., 1 j. ≈ 1 m; od 96a826fc): ciągła skorupa z obrysu (pole
  `shell`) z ODSŁONIĘTYM ŚRODKIEM wzdłuż osi (`axisTrench` — klocki-wycięcia poziomu 1), w którym stoją nadbudówki
  poziomu 2: klin pokładu z napisem (−1 400…−248, ±420 → ±104; na nim rdzenie R7 i projektor), grzbiety dziobowe
  (784…1 168 ±56, 1 336…1 752 ±36) i wieża mostka głównego VI (−2 100…−1 700 ±112), do tego kasztel, projektor (472, 0)
  i generator tarczy (2 150, 0); przy ścianach środka — wewnętrzny rząd wież L ostrza. Poszerzenie środka pod miasto
  (2026-11-14, ta praca): stacje ±540 przy −1 500 (było 440), ±500 przy −200 (416), ±332 przy 704 (296) — pas przy
  klinie mieści zabudowę z obu stron; testy drednota, skorupy i sieci (`pipeNetworkCheck` = 0, rama w jednym kawałku)
  przechodzą, wieże L zostają ≥ 58 j. od ściany środka.
- Układ maszynowni „płytka” (`hullDesignBoard.js`, `buildHullBoard`): na siatce PÓŁ-kadłuba (komórka 1,5 jd) daje
  dziedzinę `dom` (rama bez płyt, bez modułów, kanałów serwisowych i WIĄZEK SIECI), odległość od ściany rowu `D`
  i grubość lokalną `T` [jd]. Miasto stoi NA płytce: dziedzina i odległości z płytki, kaniony miasta odsłaniają ją.

## 2. Jak zbudowane jest miasto (decyzje architektury)

Zasada: wszystko, co da się policzyć raz, liczy CPU przy budowie projektu (czysto, deterministycznie, testowalnie);
GPU dostaje jeden graf TSL na rodzaj rysunku i dane w buforach. Tak, żeby wpięcie do gry nie wymagało przepisywania.

### Dane (CPU, czyste moduły, bez three i DOM)

- `src/game/hullDesign/hullDesignTowers.js` — GENERATOR WIEŻOWCÓW: jeden budynek = stos BRYŁ z gramatyki (cokół,
  trzon, uskoki / tarasy, skrzydła, łączniki, maszty, detal dachu) sterowanej rodziną, klasą wielkości i ziarnem.
  Bryła = graniastosłup ośmiokątny osiowy: środek, pół-wymiary, z0 / z1, faza narożników 45° (styl TN), POCHYLENIE
  ścian (wcięcie wierzchu — skos widoczny z góry), materiał, ton. Do tego MIEJSCA ŚWIATEŁ: tylko na ścianach (rzędy
  wzdłuż pięter, wnęki w szczelinach między płytami, podstawy ścian w kanionach) — nigdy na dachu.
- `src/game/hullDesign/hullDesignCity.js` — GENERATOR MASYWU: z pola kadłuba i płytki liczy zwarty grzbiet wzdłuż
  osi (cokoły-pasma, piętrzenie ku osi i dominantom, akcenty wież w rytmie, zwężanie ku dziobowi), omija moduły,
  gniazda broni (stożek ostrzału — zabudowa przy wieży niżej od linii strzału) i wiązki sieci, zostawia place przy
  rdzeniach, projektorach i mostku. Pół-kadłub + lustro, ziarno, degradacja (wąski rów / mały okręt = bez miasta).
  Wynik: tablice typowane brył i świateł + mapa wysokości do cieni.

### Obraz (`src/3d/hullCity3D/`, bez `window` / DOM / importów `src/game`)

- PARTIA BRYŁ: jeden `Mesh` + `InstancedBufferGeometry` (jeden graniastosłup ośmiokątny z wierzchem, bokami i spodem;
  kształt instancji liczy `vertexNode` z narożnika i ściany), dane brył w jednym przeplecionym buforze instancji
  (12 floatów: środek, z0 / z1, pół-wymiary, faza, pochylenie, materiał, ton, ziarno), pozycje względem środka okrętu
  (małe liczby), duży offset w `mesh.position`, obrót kadłuba w macierzy siatki. Bez odbicia osi w macierzy (pułapka
  37) — y sceny = −y projektu zapisane w danych.
- MATERIAŁ (TSL, jeden graf): ciemny masyw z panelami i pasami okien na ścianach (okna — wzór proceduralny, większość
  ciemna), jasna faza krawędzi dachów od słońca, AO kanionów z mapy wysokości, cień rzucany marszem po mapie wysokości
  w stronę „słońca cieni” (jak mostek), maska słońca Core3D. Przezroczysty z zapisem głębi i renderOrder 12 — po cieniu
  na kadłubie (11), jak bryła mostka.
- CIEŃ NA KADŁUB: jeden prostokąt pod kadłubem (z = −0,6, GREATER) w obrysie miasta wydłużonym o zasięg cienia, ten sam
  marsz.
- ŚWIATŁA: partia kwadów zwróconych do kamery w miejscach z generatora, addytywnie, test głębi (zasłania je bryła),
  HDR oszczędnie (rdzeń tuż nad progiem bloomu, słaba poświata), energia zachowana przy małych rozmiarach na ekranie
  (z daleka cichy połysk zamiast kropek).
- ROZGRZEWKA: wszystkie trzy materiały w `Core3D.warmup` (faza `loading`), 0 pipeline'ów synchronicznych.

### Wpięcie do gry później (bez przepisywania)

- Poza: siatki miasta okrętu dostają pozę renderu kadłuba (strona `bridgeRenderPose`, worker `playerPoseOf` / lustro).
- Maskowanie, „Statki 3D”, mgła wojny: jak mostek — widoczność per okręt (próg chowa partię okrętu), tylko encje
  z listy widocznych.
- Zasilanie: jasność świateł z `shipPowerLook` (kanał jak okna mostka), bez prądu — ciemne miasto, czerwone lampy.
- Zniszczenia: bryła stoi na komórkach siatki belek — gra liczy maskę martwych komórek pod bryłami (tylko przy śmierci
  węzła, jak blok obrażeń mostka), shader chowa / osmala bryły nad wyrwą; rozpad z silnikiem belek to osobny temat.
- Worker renderu: dane miasta (tablice typowane z generatora) idą do workera raz na projekt (rekord strumienia
  rozkazów z buforami przekazywanymi), poza z luster migawki; moduł nie czyta stanu gry.

## 3. Jak działa (stan 2026-11-14)

### Generator wieżowców (`src/game/hullDesign/hullDesignTowers.js`)

- `buildTower({ x, y, hw, hh, H, z0, family, seed, axis, sym, face, lights, tone, zMax })` → `{ family, cls, boxes,
  lights, top }`. Bryła: graniastosłup ośmiokątny osiowy `{ x, y, hw, hh, z0, z1, ch, bat, mat, tone }` (faza 45°,
  pochylenie = wcięcie wierzchu). Bryły nie wychodzą poza rzut budynku; `zMax` to twardy sufit (także masztów).
- Rodziny (`HD_TOWER_FAMILIES`): `slab` płyta-blok (1–3 płyty z uskokami, wnęka-szczelina między płytami, maszyny na
  dachu), `stepped` wieża z uskokami (cokół, 2–4 segmenty, korona, maszt), `twin` bliźniacze wieże z jednym albo dwoma
  łącznikami, `wedge` klin tarasów (pochylone fronty schodzące ku ścianie), `hall` hala (niski hangar z pochylonymi
  bokami i szczeliną przy okapie), `spire` iglica (dominanta: smukły ośmiokąt, kołnierz, maszt), `plate` płyta masywu
  (tylko dla masywu). Zła proporcja wybiera rodzinę zastępczą (smukły klin → wieża, wysoka hala → płyta, krótkie
  bliźniaki → wieża).
- Światła (`HD_TOWER_LIGHT`): `window` rzędy okien w grupach (hasz piętra i grupy), `seam` szczelina u stopy wyższej
  płyty, `base` podstawa ściany w kanionie, `beacon` czerwona lampa na boku masztu. Każde światło leży 0,45 j. przed
  płaszczyzną ściany z jej normalną (okno na pionowej ścianie świeci w bok; szczelina i podstawa — z odchyleniem ku
  górze), w pasie wysokości ściany poniżej górnej krawędzi; zasłonięte inną bryłą odpadają. Test pilnuje „na ścianie,
  nigdy na dachu”.
- Budynek na osi (`sym`) wychodzi w lustrze y: wybory po stronie ±y wspólne, klucze hasza świateł całkowite i liczone
  od osi, zaokrąglenie w lustrze. Budynki burt masyw odbija (`mirrorTower`).

### Masyw (`src/game/hullDesign/hullDesignCity.js`)

- `buildHullCity(pole, płytka, { variant, seed, density, height, lights })` → tablice typowane (bryła 12 floatów,
  światło 8), mapa wysokości obu burt, obrys, place, opis budynków, czasy etapów. `packHullCity(budynki)` — wspólne
  pakowanie (masyw i katalog w demie), `hullCityHeightAt` — wysokość w punkcie.
- Kolejno: siatka miasta na pół-kadłubie (komórka 2,6 · detal; drednot 3,9 j.) w pudle szerokiej części dziedziny
  płytki → maski: ROW = rama bez pancerza (L1 odkryte) RAZEM z nadbudówkami stojącymi w nim (L2 < 0 i pierścień ich
  płyty poziomu 1 do `superRing` 12 j. — L2 jest wcięte względem L1), połączony z osią przejściami ≥ 0,35 · wMin;
  dziedzina płytki (bez wiązek, modułów, kanałów) → odległości od ściany pancerza `Dw`, od przeszkód `Do` i od nadbudówek
  `Ds` (ulica ≥ `superClear` 12 j. wokół klina, grzbietów i wieży mostka) → place (moduł + luz: rdzeń 48, mostek 34, projektor
  i generator 30, inne 22 j.; pierścień wyższej zabudowy wokół rdzeni) i sufit (stożek ostrzału każdego gniazda broni:
  wierzch wieży + 0,36 · odległość od brzegu wieży z luzem 12 j.; rampa mostka: 34 j. + 0,3 · odległość — zabudowa
  schodzi tarasami ku mostkowi, mostek zwieńczeniem) → szerokość
  przekroju `Wc(x)` i wysokość `Hs(x)` (0 poniżej `wMin` 70 j., pełna 190 j. przy `wRef` 460 j.) → GRZBIET tylko tam,
  gdzie oś rowu jest otwarta (okno ±150 j., odcinek ≥ 900 j.) → aleje (co 440–700 j., 26 j.) i ulice (co 100–200 j.,
  7 j.) → poziomy zigguratu (maska r = Dw / Wc ≥ próg poziomu, odsunięcie od brzegu poziomu niżej, zachłanne prostokąty
  w odcinkach, wysokości wspólne w odcinku między alejami, front pochylony — `levelBat`) → działki tarasów i szczytu
  (prostokąty dzielone wzdłuż osi na budynki z przerwą 1,2 j. — ciągła ściana, nie osobne domy) → dominanty w rytmie
  `dom.pitch` na działkach szczytu przy osi → pakowanie (światła zasłonięte cudzymi bryłami odpadają; ponad 64 000 —
  przerzedzone haszem miejsca) → mapa wysokości (2 j./komórkę, pochylone ściany jako rampy).
- Warianty (`HD_CITY_VARIANTS`): A „grzbiet z dominantami” (3 poziomy, gęsty szczyt, dominanty co ~620 j.; domyślny),
  B „tarasy” (5 niższych poziomów, mało wież), C „skupiska wież” (niski cokół, las wież, dominanty co ~380 j.).
- Degradacja: Bellator, Citadella, Colossus i drednot z zakrytym środkiem (skorupa bez wycięć) — 0 brył (test).

### Obraz (`src/3d/hullCity3D/`) i demo

- `createHullCity3D({ scene })` → `setCity(miasto)`, `setPose(x, y, kąt)`, `setSun(x, y)`, `update(widoczność)`,
  `warmupMeshes()`, `afterWarmup()`, `dispose()`, `stats`. Strojenie `HULL_CITY3D_TUNE`, pojemność mapy wysokości
  `HULL_CITY3D_LIMITS` (3072 × 1024 r16f — drednot mieści się przy 2 j./teksel; większa mapa zmniejszana maksimum
  z komórek — przy 2048 mapa drednota szła co 4 j. i cień na białym klinie miał schodki).
- Światło: kierunek jak kadłub (słońce, z = 600 — niemal poziomo): ściany od słońca — rozproszone 1,18; dachy —
  otoczenie × `roofLight` (ściany ½), ton dachu z wysokością (niskie tarasy ciemniej, grzbiet jaśniej — z góry forma
  masywu), jasna faza krawędzi dachu (0,9 j.), AO kanionów (8 próbek mapy), cień rzucany: marsz 48 kroków od ~1 j.
  rosnących o 7,5% drogi, półcień proporcjonalny do drogi, na bryłach mały rozrzut startu w komórkach ~1 px (jak mostek), na kadłubie bez rozrzutu z szerszym półcieniem (na jasnym pancerzu rozrzut dawał ziarno) i z mipmap
  MAKSIMUM mapy wysokości (5 poziomów, 2–32 j./teksel, liczone na CPU; poziom ≈ krok marszu) — przy kroku większym niż
  teksel cień był sumą przesuniętych kopii prostokątów brył i brzeg wzdłuż słońca szedł schodkami (biały klin
  w generatorze); maksimum zamiast średniej nie skraca cienia wąskich wież. Okna: pasy
  szyb co piętro (4 j.), rzadkie tlące się okna pod progiem bloomu; jasne punkty to osobne światła.
- Światła z góry (kamera ortho), dwa tryby (`topGlow`, przełącznik w demie — G): PUNKTY — okna pionowych ścian gasną
  z kątem patrzenia, szczeliny i podstawy przygaszone (`lightsTop` 0,22); POŚWIATA — światła dna kanionów (podstawy)
  jako szerokie słabe plamy (× `glowSize` 5, siła `glowGain` 0,28), które nakładają się w miękki pas wzdłuż kanionu,
  okna gasną, szczeliny prawie (dachy przesłaniają poświatę testem głębi); lampy masztów zostają punktami. Koszt GPU
  poświaty jak punktów (kwady bez okien). Z ukosa oba tryby rysują punkty na ścianach.
- Pułapka (r183): próbki tekstury w grafie to KLONY węzła (`.sample(uv)`) z wartością z chwili budowy — podmiana
  `węzeł.value` do nich nie dochodzi, a zwykłej tekstury three nie przebuduje w miejscu na inny rozmiar. Dlatego mapa
  wysokości to jedna tekstura o stałej pojemności, a nowe miasto pisze w nią dane.
- Demo `dema/miasto-3d.html` (+ `.js`, worker `miasto-3d.worker.js`): drednot z pliku (bez przeróbek w demie)
  z kompozytora kreatora na skórze gry, mostki i reaktory gry w gniazdach, miasto z workera. Światła z góry: punkty /
  poświata (G, `?zgory=poswiata`). Widoki 1–6 (z góry: cały okręt, środek 3 600 j., 1 200 j.; z ukosa: jak kadr
  odniesienia, nisko wzdłuż środka, od dziobu; przeciąganie — orbita). KAMERA widoków z góry (P — po kolei,
  `?kamera=gra|perspektywa|plaska`): domyślnie WIDOK GRY — ortho passa gry z pochyleniem ścian miasta (§ 10);
  PERSPEKTYWA = `cameraPersp` passa FG gry (35°, wysokość (h / 2) / tg(17,5°) / zoom, prosto w dół) podana
  jako `free3d`, żeby całą scenę (kadłub, mostki, reaktory, miasto) rysowała ta sama kamera — budowle wychylają się ku
  brzegom kadru, widać ściany i okna („GTA style” — decyzja użytkownika 2026-11-14); PŁASKA — ortho passa gry (A/B).
  W widoku z góry poświata i przygaszanie świateł działają też w perspektywie (`update(…, { topView })`). Panel jest
  nieczynny do końca ładowania (przełączenie kamery niczego nie przebudowuje). Suwaki:
  kompozycja, ziarno, gęstość, wysokość, światła, słońce (azymut), cień (wysokość słońca cieni); M — miasto, L —
  światła, I — liczby. `?katalog=1` — katalog wieżowców (rodziny × 4 wielkości na jasnej płycie).

## 4. Koszty (drednot z pliku z poszerzonym środkiem, wariant A, 2026-11-14; kadr 1 600 × 900)

| Pozycja | Wartość |
|---|---|
| Budynki / bryły / światła | ~1 005 / ~2 020 / ~47 600 (z drednotem sprzed przebudowy: 1 157 / 2 843 / ~62 700) |
| Trójkąty | bryły ~57 tys. (28 na bryłę), światła ~95 tys. (2 na kwad) |
| Rysunki | 3 na miasto (bryły, cień, światła) — jeden pipeline na rodzaj |
| Pamięć GPU | ~10,4 MB: mapa wysokości 8 MB (stała, 3 072 × 1 024 r16f + mipmapy maksimum), światła ~2 MB (pojemność 65 536 × 32 B), bryły ~0,2 MB |
| Generator (worker) | płytka 0,3–0,4 s (raz na kadłub) + masyw ~0,32 s (siatka 1 321 × 140); wysyłka na GPU ~15 ms |
| GPU na klatkę (z miastem − bez) | cały okręt +0,12 ms, pas 3 600 j. +0,25 ms, 1 200 j. +0,28 ms, z ukosa +0,13 ms; poświata ≈ punkty |
| Pipeline'y synchroniczne | 0 w każdym kadrze (rozgrzewka: bryły, cień, światła; okna mostków kamerą FG) |

Koszt GPU rośnie z liczbą pikseli miasta (marsz cienia na każdym pikselu brył i cienia na kadłubie): przy 5 120 × 1 440
(~5× pikseli) szacunkowo do ~1,5 ms w zbliżeniu — do zmierzenia w grze (PerfHUD, `Core3D.gpuFrameMs`). Tańsza droga,
gdyby trzeba: mapa „wysokości oświetlenia” liczona compute raz na zmianę kierunku słońca w układzie okrętu (krok
`Core3D.addFxStep`) — wtedy cień to jedna próbka zamiast marszu.

## 5. Odstępstwa od kadru odniesienia i dlaczego

- Z GÓRY kamerą płaską (ortho passa gry) nie ma ścian — kadr odniesienia jest ukośny; demo i kreator rysują dlatego
  widoki z góry domyślnie perspektywą passa FG (§ 3, § 6), a grę — plan § 9. W płaskiej kamerze wysokość niosą: cień
  rzucany (na dachy niższych i na pancerz przy ścianie rowu), ton dachu z wysokością (umowny: wyższe jaśniej), jasna
  faza krawędzi od słońca i POCHYLONE fronty poziomów (glacis cokołu 0,55 wysokości) — w kadrze odniesienia ściany są
  pionowe. Z ukosa pochylenie frontów czyta się jak skośne płyty tarasów.
- Cień „długi na kadłub” jest krótszy niż w kadrze odniesienia: masyw schodzi tarasami do ściany rowu (sufit stożków
  ostrzału wież L przy ścianach rowu), a słońce cieni stoi na 26° (mostek — 30°). Suwak „Cień” w demie pokazuje dłuższe
  cienie przy niższym słońcu.
- Miasto jest w lustrze osi (okręt i sieć są w lustrze) — kadr odniesienia nie jest symetryczny.
- Środek drednota zajmuje biały klin pokładu z napisem (nadbudówka poziomu 2) — masyw nie jest jednym grzbietem jak
  w kadrze, tylko obramowuje klin jak plac (wieża mostka na końcu, otoczona zabudową); najwyżej rośnie przy klinie
  i za nim, w śródokręciu.
- Gęstość świateł ograniczona (uwaga o płytce „świecenie za jasne”): z ukosa okna w skupiskach, z góry przygaszone;
  w kadrze odniesienia świateł jest więcej i są jaśniejsze — suwak „Światła” do 2,5×.
- Dachy płaskie z drobną maszynerią; detal ścian (pasy okien) z bliska — bez modeli z Blendera.

## 6. Wpięcie

### Do kreatora (zrobione 2026-11-14)

- Pole projektu `city: { on, variant: 'A' | 'B' | 'C', seed, density, height, lights, glow }`
  (`normalizeHullCityField` w `normalizeHullDesign`; brak pola = bez miasta, `on: false` — wyłączone z zachowanymi
  ustawieniami; zakresy `HD_CITY_LIMITS`), strażnik `cityViolations` w `isPlayerBuildable`. Drednot ma
  `city: { on: true, variant: 'A' }`, pozostałe presety pola nie mają (test).
- Pole jest POZA kluczem kształtu (`hullDesignShapeKey` je pomija): miasto nie zmienia obrazu kadłuba, więc zmiana
  miasta nie przebudowuje kadłuba. Miasto liczy worker budowy osobną wiadomością `city` (`builder.city(opcje)`,
  klient `hullDesignBuildClient.city` → Promise) z pola i płytki OSTATNIEJ PEŁNEJ budowy; pamięć LRU(3) po kluczu
  układu + opcjach (wariant, ziarno, gęstość, wysokość). Bez pełnej budowy — wynik pusty. `lights` i `glow` to sam obraz
  (bez workera). Drednot: miasto z workera ~0,38 s po pełnej budowie, edycja nie stoi.
- Demo (`dema/kreator-kadluba-webgpu.js`, sekcja „MIASTO 3D”; operacje na polu — `dema/kreator-kadluba-miasto.js`):
  `createHullCity3D` przy starcie z wpisem rozgrzewki `miasto 3D (hullCity3D)`, `cityDemoAfterBuild` po pełnej
  budowie, `cityDemoCheck` na ścieżce barw (zmiana samego miasta), `cityDemoSync` w `render()`; w podglądzie
  przeciągania (`fast`) miasto znika i wraca po puszczeniu (nie liczy się na polu połowy rozdzielczości).
  Panel „Miasto 3D” w Warsztacie (miasto wł. / wył., kompozycja, ziarno z losowaniem, gęstość, wysokość, światła,
  poświata, kamera) i te same opcje w Stoczni (zakładka Kształty, pod pancerzem z obrysu).
- KAMERA widoku kreatora: płaska (ortho, domyślna) albo perspektywa z góry = `cameraPersp` passa FG (35°, wysokość
  (h / 2) / tg(17,5°) / zoom) podana jako `free3d` (`viewCamera()`); płaszczyzna z = 0 w tej samej skali, więc nakładki
  edytora (zaznaczenie, uchwyty, duch) trafiają bez zmian. `?kamera=perspektywa`, wybór pamięta `localStorage`
  `kreator.kamera`; harness `__kreator.setPersp`, `__kreator.city`, `__kreator.cityIdle()`.
- Zrzuty: `node scripts/webgpu/miasto-3d-kreator.mjs [--out …]` — drednot w obu kamerach (cały, środek, zbliżenie,
  mostek z klinem), panele Warsztatu i Stoczni, Colossus bez miasta; raport z pipeline'ami sync i błędami konsoli.

### Do gry

- Poza: `setPose` z pozy renderu kadłuba (strona `bridgeRenderPose`, worker `playerPoseOf`); układ projektu → świat
  przez ramę kadłuba z projektu (środek obrazu, skala 1), obrót kadłuba w macierzy grupy.
- Wiele okrętów: jeden `createHullCity3D` na okręt (3 rysunki, wspólne pipeline'y) albo partia z buforem póz (wzór
  `turretBatch3D` / mostki) przy kilku drednotach w kadrze; mapa wysokości per okręt — warstwa tablicy tekstur
  (`Core3D.uploadTextureLayer`).
- Maskowanie i „Statki 3D”: `update(widoczność)` z `bridgeModelVisibility` × `entityCloakVisAt` (próg chowa grupę);
  mgła wojny — tylko okręty z listy widocznych.
- Zasilanie: jasność świateł z `shipPowerLook` — bez prądu ciemne miasto, czerwone lampy (`beacon`).
- Zniszczenia: bryła stoi na komórkach siatki belek — maska martwych komórek pod bryłami przy śmierci węzła (jak blok
  obrażeń mostka), flaga w `iC.w` chowa / osmala bryłę; wyrwa w mapie wysokości — przeliczenie wycinka. Rozpad miasta
  z silnikiem belek (bryły jako ciała) — osobny temat.
- Worker renderu: tablice miasta raz na kadłub rekordem strumienia rozkazów (bufory przekazywane), poza z luster
  migawki; moduł nie czyta `window` / DOM / stanu gry (test).
- Rozgrzewka: wpis `miasto 3D (hullCity3D)` (bryły, cień, światła) w fazie `loading`, strona i worker.
- Słońce cieni: wspólne strojenie z mostkiem (`shadowElevDeg`) — dziś miasto 26°, mostek 30°.

## 7. Otwarte decyzje (pytania do użytkownika, z rekomendacją)

1. Która kompozycja domyślna: A (grzbiet z dominantami), B (tarasy, niższe) czy C (las wież)? — Rekomendacja: A dla
   drednota TN; C jako wariant „miasto-stolica” dla okrętów fabularnych.
2. Światła z góry (kamera gry): PUNKTY (przygaszone szczeliny i podstawy — drobne kropki wzdłuż kanionów) czy POŚWIATA
   (miękki pas światła w kanionach, bez kropek)? Z ukosa oba to punkty na ścianach. — Rekomendacja: poświata (bliżej
   „bez kropek na dachu”, ten sam koszt).
3. Długość cienia (wysokość słońca cieni): 26° (dłuższy, wyraźniejszy grzbiet) czy 30° jak mostek? — Rekomendacja:
   jedna wartość dla mostka i miasta, 26°.
4. Wysokość miasta względem mostka głównego (VI, ~32 j.): rampa wokół mostka trzyma zabudowę nisko, grzbiet sięga
   ~200 j., dominanty do ~300 j. — Rekomendacja: zostawić — mostek czytelny na placu, miasto wyższe.
5. Pochylone fronty poziomów (glacis) — czytelność z góry kosztem podobieństwa do pionowych ścian kadru odniesienia. —
   Rekomendacja: zostawić (bez nich masyw z góry był „ciemną fakturą”).
6. Poszerzenie odsłoniętego środka drednota pod miasto (±540 przy rdzeniach zamiast ±440, ±500 za klinem zamiast ±416,
   ±332 przy grzbietach zamiast ±296) — zostaje? — Rekomendacja: tak; bez niego pas przy klinie miał 20–150 j. i miasto
   rozpadało się na wąskie paski.
7. Zniszczenia miasta: chować bryły nad wyrwą (prosto, tanio) czy rozpad brył jako odłamy? — Rekomendacja: najpierw
   chowanie / osmalenie, rozpad później.
8. Jak rysować miasto w zwykłym widoku gry (§ 9): w passie FG jak stacje czy w passie gry z „pochyleniem
   perspektywy”? — Rekomendacja: pochylenie w passie gry (wariant B) razem z mostkami, rdzeniami, wieżami i dyszami.
9. Przy CAŁYM drednocie kamera gry wisi ~7 900 j. nad okrętem, a miasto ma ~166 j. — perspektywa gry (35°) pochyla je
   o ~2% odstępu od środka kadru (~15 px przy dziobie), więc „cały okręt” dalej wygląda prawie płasko (zrzut
   `a1-caly-perspektywa`). Przesadzić pochylenie (mnożnik wysokości tylko w pochyleniu, np. 3–4×) czy zostać przy
   kamerze gry? — Próba (§ 10): przesada „z oddaleniem” — 1× (prawdziwa perspektywa gry) w zbliżeniu, pełna przy
   całym okręcie. Rekomendacja: 6× z oddaleniem (cały okręt ~14%, 3 600 j. ~24%, 1 200 j. ~18% jak gra); wielkość
   dobiera użytkownik suwakiem „Pochylenie ścian”.
10. Płaskie nadbudówki kompozytora (klin z napisem, grzbiety, plac mostka) i płaskie mostki / rdzenie obok pochylonego
   miasta (§ 10): przy przesadzie wieżowce kładą się na nie i zasłaniają brzegi — trzymać miasto dalej od nich (ulica
   proporcjonalna do wysokości), dać im prawdziwą wysokość w 3D, czy przyjąć? — Rekomendacja: przy przesadzie
   z oddaleniem przyjąć (w zbliżeniu przesady nie ma, z daleka nadbudówki są drobne); mostki i rdzenie pochylić
   w grze tym samym wzorem (§ 9, lista zmian).

## 8. Jak sprawdzić

- Demo: `npm run dev` → `http://localhost:5173/dema/miasto-3d.html` (po scaleniu do main; w worktree — port jego serwera
  dev), katalog wieżowców: `…/dema/miasto-3d.html?katalog=1`.
- Zrzuty i pomiar: `node scripts/webgpu/miasto-3d-zrzuty.mjs --out .tmp/kreator/miasto-3d-v3 [--tylko id,…] [--katalog
  0|1|tylko] [--pomiar 0]` (raport.json: czasy, bryły, światła, ms GPU z miastem i bez, pipeline'y sync, błędy).
- Kreator: `/dema/kreator-kadluba-webgpu.html?preset=dreadnought&kamera=perspektywa`; zrzuty
  `node scripts/webgpu/miasto-3d-kreator.mjs` (domyślnie `.tmp/kreator/miasto-3d-v3/generator`).
- Testy: `node --test tests/hullDesignTowers.test.mjs tests/hullDesignCity.test.mjs tests/hullDesignCity3D.test.mjs`
  (w zestawie `node --test "tests/hullDesign*.test.mjs"`).

## 9. Miasto w grze w zwykłym widoku („GTA style”) — plan (etap C, bez zmian w grze)

Wymaganie (użytkownik 2026-11-14): „w grze/generatorze chcę 3d gta style (tak jak w grze)” — budowle wychylają się ku
brzegom kadru jak stacje i hale w grze, widać ściany i okna. Demo i kreator robią to kamerą free3d (wszystko jedną
kamerą perspektywy). W grze płaszczyzna okrętów idzie passem ortho, więc trzeba wybrać, gdzie rysować miasto.

### Stan gry (to, z czym miasto musi się ułożyć)

- Passy do jednego celu, kolejno: tło → planety → halo → ring-planety → warp → ORTHO (warstwa 0: kadłuby, mostki,
  rdzenie, wieże, dysze, pociski, efekty, gaz wybuchów) → TARCZE (warstwa 7, kamera ortho, test głębi ortho bez zapisu)
  → FG (warstwa 2: stacje, części baz i hal nad płaszczyzną, okna i lampy mostków — `BRIDGE3D_WINDOWS`). FG ma kamerę
  `cameraPersp` (35°, wysokość Hc = (h / 2) / tg(17,5°) / zoom nad punktem kamery, prosto w dół) i WŁASNĄ głębię
  (czyszczona) — rysuje się nad wszystkim z passa ortho.
- Głębia passa ortho (`cameraOrtho`, z = 150 000, near 1 / far 400 000, ~0,024 j. na stopień depth24): wysokość nie
  zmienia obrazu, tylko kolejność. Umowa (`src/3d/ships3d/modelSlabDepth.js`): modele kadłubów w paśmie [−10,4; −5,3],
  skóry sprite'ów z = 0, wieże i dysze na sprite'ach [0,05; 1,8] / [0,04; 1,4], tarcza z = 1 + wysokość kopuły, pociski
  i efekty z = 14–15. Bryła gazu wybuchów nie testuje głębi (leży nad tym, co przed nią w passie), żar — testuje.
- Kamery 3D gry (K / Shift+K, reżyser kadru): tryb `free3d` — wszystkie passy kamerą perspektywy, prawdziwa głębia
  (`setModelSlabDepthOn(false)`). Miasto działa w nim już dziś (demo, widok „z ukosa”); `update(…, { topView: 0 })`.

### Wariant A — miasto w passie FG (jak stacje)

- Prawdziwa perspektywa i prawdziwa głębia względem stacji i hal FG.
- FG rysuje się PO pociskach, wiązkach, wybuchach i tarczach i nie zna głębi ortho: miasto przykrywa trafienia
  i wybuchy na pokładzie drednota, kopułę jego tarczy, iskry i dym z ran — walka na grzbiecie znika pod zabudową.
- Cień na kadłubie (prostokąt pod kadłubem z testem GREATER na głębi kadłuba) musi zostać w passie ortho — w FG głębi
  kadłuba nie ma.
- Mostki, rdzenie, wieże i dysze zostają w ortho, więc stoją płasko obok wieżowców wychylonych o kilkanaście procent
  (przy zbliżeniu 1 200 j. szczyt miasta, ~166 j., wychyla się o ~18% odstępu od środka kadru, mostek nie). Przeniesienie ich do FG
  ciągnie za sobą błyski wylotów, odrzut, pasma głębi i kolejność z efektami — przebudowę całej płaszczyzny okrętu.

### Wariant B — pochylenie perspektywy w passie ortho (REKOMENDACJA)

- Kamera FG patrzy prosto w dół, więc punkt na wysokości z ląduje na ekranie w środku kadru + odstęp · Hc / (Hc − z),
  a kolejność zasłaniania to kolejność z (głębia = Hc − z). Obie rzeczy da się odtworzyć w passie ortho: wierzchołek
  liczy zwykły rzut ortho `c` punktu (x, y) z głębią z PASMA, a na wyjściu daje `vec4(c.xy, c.z · s, s)`,
  s = max(0,15; (Hc − z) / Hc). Po dzieleniu przez w: xy jak w FG, głębia z pasma, interpolacja varyingów poprawna
  perspektywicznie (okna na ścianach bez „pływania”). Hc = wysokość kamery FG z `Core3D` (uniform na widok — podzielony
  ekran ustawia go przy każdym renderze), z — wysokość nad płaszczyzną okrętu (lokalna, małe liczby).
- Kolejność z płaszczyzną okrętu bez zmian: miasto w paśmie nad skórami (z > 0) i POD pociskami i efektami (14–15) —
  pociski, wiązki, wybuchy i tarcza leżą nad miastem jak dziś nad wieżami; cień na kadłubie bez zmian.
- Jedno pasmo na okręt: wysokość z ∈ [0; Zmax okrętu] → pasmo [0,05; ~12] JEDNĄ skalą dla miasta, mostków, rdzeni, wież
  i dysz na sprite'ach (dziś `applyModelSlabDepth` mapuje każdy obiekt jego własnym [zb; zt] — wierzch 20-metrowej wieży
  i 300-metrowego wieżowca trafiłyby na tę samą głębię). Pasmo ~12 j. daje ~0,8 j. wysokości na stopień głębi
  (1,75 j. dzisiejszego pasma wież — ~5,5 j.: styki ścian z dachami migotałyby). Tarcza (z = 1 + kopuła) musi wtedy
  leżeć nad pasmem (do ustalenia: podnieść tarczę albo pasmo poniżej niej).
- Wspólny pomocnik TSL (np. `src/3d/tsl/pochylenieFg.js`: uniform Hc + przełącznik) w wierzchołkach: miasto (bryły,
  światła), bryła mostka (`bridge3D.tsl.js`), rdzeń (`reactor3D`), wieże (`turretBatch3D`), dysze SIDE
  (`thrusterBatch3D`), lampy mocowań; modele kadłubów 3D opcjonalnie. Okna i lampy mostków są już w FG (perspektywa) —
  z pochyloną bryłą trafią w nią przy każdej wysokości (dziś do sprawdzenia: przesunięcie okien wysokich mostków
  względem bryły z ortho).
- Kamery 3D (free3d): pochylenie i pasmo wyłączone tym samym przełącznikiem co `setModelSlabDepthOn`.
- Koszt: kilka działań na wierzchołek, bez nowych passów i zmian w Core3D poza uniformem Hc; worker — Hc liczy Core3D
  z kamery migawki (bez nowego pola w `RenderWorld`). Rozgrywka bez zmian (zasada żelazna 1); HUD i mysz rzutują
  płaszczyznę z = 0 przez `View3D` — bez zmian.
- Ograniczenia: stacje i części FG zawsze nad miastem (jak dziś nad okrętami); gaz wybuchów (bez testu głębi) nad
  miastem jak nad wszystkim w passie; przy bardzo bliskim zbliżeniu (Hc ≈ wysokość wieży) s obcięte do 0,15 — szczyty
  „kładą się” zamiast znikać za kamerą.
- „Cały okręt”: perspektywa gry przy całym drednocie pochyla miasto o ~2% (decyzja 9 w § 7). W wariancie B przesada
  pochylenia to mnożnik z w s (jeden uniform) — do oceny w prototypie.

### Wariant C — pochylenie tylko miasta

- Najtańszy (sam `hullCity3D`), ale mostki, rdzenie i wieże stoją płasko między pochylonymi wieżowcami — odrzucony.

### Lista zmian (wariant B, kolejno)

1. Prototyp w demie miasta i w generatorze: widok gry z pochyleniem samego miasta i przesadą — ZROBIONE (§ 10; A/B
   z perspektywą: 1× daje ten sam obraz miasta). Dalej: mostki i rdzenie w prototypie, kolejność z pociskami
   i wybuchami (galeria broni na tle drednota), migotanie pasma głębi.
2. Pomocnik `pochylenieFg` + uniform Hc w Core3D (strona i worker, podzielony ekran), przełącznik z kamer 3D.
3. Wspólne pasmo głębi okrętu w `modelSlabDepth.js` (miasto, mostki, rdzenie, wieże i dysze na sprite'ach); tarcza nad
   pasmem.
4. Pomocnik w materiałach: miasto, mostek, rdzeń, wieże, dysze SIDE, lampy mocowań; rozgrzewka bez zmian (te same
   materiały — sprawdzić 0 pipeline'ów sync).
5. Wpięcie miasta do gry (§ 6 „Do gry”: poza renderu, worker, maskowanie, mgła wojny, zasilanie, mapa ran).
6. Narzędzia: zrzuty w grze (`scripts/webgpu/*-gra.mjs`) — drednot z miastem w trzech zbliżeniach, bitwa nad
   grzbietem, kamery 3D; koszt (PerfHUD, `Core3D.gpuFrameMs`) przy 5 120 × 1 440.

## 10. Próba wariantu B: widok gry z pochyleniem (etap D — demo miasta i generator, bez zmian w grze)

Powód: „»cały okręt« wszystko spłaszcza” — prawdziwa perspektywa gry pochyla miasto przy całym drednocie o ~2%.
Próba pokazuje wariant B z PRZESADĄ, żeby użytkownik dobrał jej wielkość na żywo.

- Moduł miasta (`src/3d/hullCity3D/`, gra go nie ładuje): `update(…, { lean: { on, gain, byZoom } })` — tylko przy
  kamerze ortho. Wierzchołek brył i świateł: clip = (c.xy, c.z · s, c.w · s), s = max(0,15; 1 − g · z / Hc), Hc
  z macierzy rzutu ortho (górna krawędź / tg 17,5° = wysokość kamery FG gry), z — wysokość nad płaszczyzną okrętu.
  Głębia bez zmian, varyingi poprawne perspektywicznie. Światła okien świecą w stronę kamery wirtualnej (środek
  kadru, Hc / g), więc okna na ścianach zwróconych do środka kadru są widoczne jak w perspektywie. Cień na kadłubie
  zostaje na płaszczyźnie (jak w perspektywie: wieża pochyla się nad swoim cieniem, podstawa stoi tam, gdzie cień
  się zaczyna). Strojenie `HULL_CITY3D_TUNE.lean*`.
- PRZESADA g (0–8; 1 = prawdziwa perspektywa gry, 0 = płasko). „Z oddaleniem” (domyślnie): g_ef = 1 przy Hc ≤ 1 200 j.
  (kadr ~1 200 j. szerokości na 1 600 × 900), g przy Hc ≥ 7 000 j. (cały drednot), pomiędzy po log Hc. Szczyt
  miasta (164 j.), przesunięcie względem podstawy w ułamku odstępu od środka kadru (1 / s − 1):

  | Kadr (1 600 × 900) | Hc | 1× (gra) | 4× z oddal. | 6× z oddal. | 4× stała |
  |---|---|---|---|---|---|
  | cały drednot | 7 929 j. | 2,1% | 9,0% | 14,2% | 9,0% |
  | środek 3 600 j. | 3 211 j. | 5,4% | 15,8% (g_ef 2,7) | 24,0% (g_ef 3,8) | 25,7% |
  | zbliżenie 1 200 j. | 1 070 j. | 18,1% | 18,1% (g_ef 1) | 18,1% | 158% |

  Na ekranie użytkownika 5 120 × 1 440: cały drednot Hc ≈ 6 700 j. (6× z oddaleniem → g_ef 5,9, ~17%), kadr 1 200 j.
  szerokości Hc ≈ 535 j. — już prawdziwa perspektywa daje tam ~44% (kamera niższa przy tym samym kadrze w poziomie).
- Wynik (zrzuty `.tmp/kreator/miasto-3d-v4/`): 1× = ten sam obraz miasta co perspektywa (A/B wzoru). Cały okręt: 4–6×
  wyciąga ściany ku brzegom kadru (przy 6× ściany wieżowców przy dziobie ~70 px zamiast ~15 px przy 1×), okna świecą
  na ścianach. Środek 3 600 j.: 6× z oddaleniem (3,8×) — mocne pochylenie, budynki się nie kładą. Zbliżenie 1 200 j.:
  przesada z oddaleniem = prawdziwa perspektywa; STAŁA 4× kładzie budynki (s ≈ 0,39) i zasłania nimi klin, grzbiety
  i rdzeń — przesada stała odrzucona. Propozycja domyślna: 6× z oddaleniem.
- Miasto pochylone obok PŁASKIEGO mostka, rdzeni i nadbudówek (zrzuty `d1`–`d4`, `b-3600-*`): klin z napisem,
  grzbiety i plac mostka to obraz kompozytora (płaski), a mostek i rdzenie — modele gry rysowane ortho. W zbliżeniu
  (przesada 1×) nie razi: mostek VI ma ~32 j. wysokości, w perspektywie pochyliłby się o ~3%. Przy przesadzie razi
  w średnim kadrze: wieżowce bliżej środka kadru kładą się na rdzeń i na brzegi klina i grzbietów — rdzeń wygląda
  jak wpuszczony, nadbudówki jak namalowane (b-3600-gra-6x-zoom, d2 przy stałej 4×). Wniosek dla gry: mostki i rdzenie
  pochylić tym samym wzorem (§ 9, lista zmian), a nadbudówki kompozytora — decyzja 10 w § 7.
- Koszt GPU jak perspektywa (z miastem − bez: cały +0,13 ms, 3 600 j. +0,23 ms, 1 200 j. +0,28 ms przy 1 600 × 900),
  0 pipeline'ów synchronicznych, 0 błędów konsoli (demo i generator).
- STEROWANIE. Demo `dema/miasto-3d.html`: panel „Kamera z góry (P — po kolei)” — przyciski „Widok gry” / „Perspektywa”
  / „Płaska”, suwak „Pochylenie ścian” (0–8×), przycisk „Przesada z oddaleniem”; klawisz P przełącza kamery po kolei;
  adres `?kamera=gra|perspektywa|plaska&pochylenie=6&pochylenieZoom=0`. Generator (`dema/kreator-kadluba-webgpu.html`,
  domyślnie kamera płaska — edytor): Warsztat — sekcja „Miasto 3D”, przyciski „płaska” / „widok gry” / „perspektywa”,
  suwak „pochylenie”, przycisk „przesada z oddaleniem”; Stocznia — zakładka Kształty, na dole „Kamera”: przyciski
  „Płaska” / „Widok gry” / „Perspektywa” / „Przesada z oddaleniem” i suwak „Pochylenie ścian”; bez klawisza; adres jak
  w demie, wybór pamięta `localStorage` (`kreator.kamera`, `kreator.pochylenie`).
- Zrzuty: `node scripts/webgpu/miasto-3d-zrzuty.mjs --zestaw v4` (demo), `node scripts/webgpu/miasto-3d-kreator.mjs
  --kamery perspektywa,gra --pochylenie 6 --out .tmp/kreator/miasto-3d-v4/generator` (generator).
