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
- Drednot TN (`warships/dreadnought.js`, 8 000 × 3 816 j., 1 j. ≈ 1 m): rów osi otwiera się po zdjęciu płyt grzbietu
  (jak `openTrench` w `scripts/kreator-plytka-makieta.mjs`; przebudowa drednota z szerokim rowem trwa w innej sesji).
  Na osi rowu stoją moduły: generator tarczy (2 150, 0), projektory studni (472, 0) i (−760, 0), dwa rdzenie R7
  (−1 250, ±300), mostek główny VI (−1 900, 0); przy ścianach rowu — wewnętrzny rząd wież L ostrza.
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
- ŚWIATŁA: partia kwadów zwróconych do kamery (punkt i krótka listwa) w miejscach z generatora, addytywnie, test głębi
  (zasłania je bryła), HDR oszczędnie (rdzeń tuż nad progiem bloomu, słaba poświata), energia zachowana przy małych
  rozmiarach na ekranie (z daleka cichy połysk zamiast kropek).
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

(Dalsze sekcje — parametry, koszty, otwarte decyzje — dopisywane w trakcie pracy.)
