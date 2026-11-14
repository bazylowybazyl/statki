# Miasto 3D na grzbiecie okrętu — opis

> Temat 3 generatora kadłubów (orkiestrator prac nad drednotem). Zabudowa „miasta” na otwartym rowie osi okrętu jako
> PRAWDZIWE bryły 3D: generator wieżowców, generator masywu i moduł renderu na Core3D, pokazane na stronie dema.
> Niewpięte do kreatora ani do gry. Makieta płaska (gałąź `claude/kreator-miasto-f58236`) — odrzucona przez użytkownika
> 2026-11-14 („kropki są na dachu reprezentując okna od dachu”, „miasto będzie 3d”).

## 1. Rozpoznanie (stan gry i kreatora, 2026-11-14)

### Kamera, czyli ile widać ścian

- Płaszczyzna gry (kadłuby, mostki, reaktory — warstwa 0) rysuje się kamerą **ORTOGRAFICZNĄ prosto z góry**
  (`Core3D.cameraOrtho`, z = 150 000, `syncCamera`): ściana pionowa ma w kadrze zerową szerokość. Z góry widać tylko
  dachy, powierzchnie POCHYLONE i to, co leży w szczelinach między bryłami. Perspektywy w widoku gry nie ma (kamera
  perspektywy `FLAT_PERSP_FOV` 35° rysuje tylko planety).
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
  `HULL_CITY3D_LIMITS` (2048 × 1024 r16f — większa mapa zmniejszana maksimum z komórek).
- Światło: kierunek jak kadłub (słońce, z = 600 — niemal poziomo): ściany od słońca — rozproszone 1,18; dachy —
  otoczenie × `roofLight` (ściany ½), ton dachu z wysokością (niskie tarasy ciemniej, grzbiet jaśniej — z góry forma
  masywu), jasna faza krawędzi dachu (0,9 j.), AO kanionów (8 próbek mapy), cień rzucany: marsz 48 kroków od ~1 j.
  rosnących o 7,5% drogi, półcień proporcjonalny do drogi, rozrzut startu w komórkach ~1 px (jak mostek). Okna: pasy
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
  poświata (G, `?zgory=poswiata`). Widoki 1–6 (z góry jak w grze: cały okręt, rów 3 600 j.,
  1 200 j.; z ukosa: jak kadr odniesienia, nisko wzdłuż grzbietu, od dziobu; przeciąganie — orbita), suwaki:
  kompozycja, ziarno, gęstość, wysokość, światła, słońce (azymut), cień (wysokość słońca cieni); M — miasto, L —
  światła, I — liczby. `?katalog=1` — katalog wieżowców (rodziny × 4 wielkości na jasnej płycie).

## 4. Koszty (drednot z pliku z poszerzonym środkiem, wariant A, 2026-11-14; kadr 1 600 × 900)

| Pozycja | Wartość |
|---|---|
| Budynki / bryły / światła | ~1 005 / ~2 020 / ~47 600 (z drednotem sprzed przebudowy: 1 157 / 2 843 / ~62 700) |
| Trójkąty | bryły ~57 tys. (28 na bryłę), światła ~95 tys. (2 na kwad) |
| Rysunki | 3 na miasto (bryły, cień, światła) — jeden pipeline na rodzaj |
| Pamięć GPU | ~6,5 MB: mapa wysokości 4 MB (stała), światła ~2 MB (pojemność 65 536 × 32 B), bryły ~0,2 MB |
| Generator (worker) | płytka 0,3–0,4 s (raz na kadłub) + masyw ~0,32 s (siatka 1 321 × 140); wysyłka na GPU ~15 ms |
| GPU na klatkę (z miastem − bez) | cały okręt +0,12 ms, pas 3 600 j. +0,25 ms, 1 200 j. +0,28 ms, z ukosa +0,13 ms; poświata ≈ punkty |
| Pipeline'y synchroniczne | 0 w każdym kadrze (rozgrzewka: bryły, cień, światła; okna mostków kamerą FG) |

Koszt GPU rośnie z liczbą pikseli miasta (marsz cienia na każdym pikselu brył i cienia na kadłubie): przy 5 120 × 1 440
(~5× pikseli) szacunkowo do ~1,5 ms w zbliżeniu — do zmierzenia w grze (PerfHUD, `Core3D.gpuFrameMs`). Tańsza droga,
gdyby trzeba: mapa „wysokości oświetlenia” liczona compute raz na zmianę kierunku słońca w układzie okrętu (krok
`Core3D.addFxStep`) — wtedy cień to jedna próbka zamiast marszu.

## 5. Odstępstwa od kadru odniesienia i dlaczego

- Z GÓRY nie ma perspektywy ani ścian (kamera gry ortho) — kadr odniesienia jest ukośny. Z góry wysokość niosą: cień
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

## 6. Wpięcie (do zrobienia, nie w tej pracy)

### Do kreatora

- Pole projektu `city: { variant: 'A' | 'B' | 'C' | 'off', seed, density, height }` w `normalizeHullDesign`
  (domyślnie 'off'; projekt NPC drednota — 'A'), etap MIASTO po UKŁADZIE w `hullDesignBuild.js` (klucz = klucz układu +
  pole `city`), wynik (tablice) z workera budowy bez kopii; w demie kreatora przycisk „Miasto” i wpis `Core3D.warmup`
  jak mostek. Kompozytor NIE rysuje miasta (płaski obraz zostaje płytką pod miastem).
- Przy przeciąganiu (`fast`) miasto z pamięci (jak `boardStale`), nie liczone na polu połowy rozdzielczości.

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

## 8. Jak sprawdzić

- Demo: `npm run dev` → `http://localhost:5173/dema/miasto-3d.html` (po scaleniu do main; w worktree — port jego serwera
  dev), katalog wieżowców: `…/dema/miasto-3d.html?katalog=1`.
- Zrzuty i pomiar: `node scripts/webgpu/miasto-3d-zrzuty.mjs --out .tmp/kreator/miasto-3d-v2 [--tylko id,…] [--katalog
  0|1|tylko] [--pomiar 0]` (raport.json: czasy, bryły, światła, ms GPU z miastem i bez, pipeline'y sync, błędy).
- Testy: `node --test tests/hullDesignTowers.test.mjs tests/hullDesignCity.test.mjs tests/hullDesignCity3D.test.mjs`
  (w zestawie `node --test "tests/hullDesign*.test.mjs"`).
