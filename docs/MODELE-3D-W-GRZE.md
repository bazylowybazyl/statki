# Modele 3D statków i broni w grze 2D + kamery 3D (2026-09-30)

Opcja nowej gry, nie tryb gry: po kliknięciu „Nowa gra” panel „Tryb gry” ma dwa przełączniki — **Statki 2D / 3D**
i **Bronie 2D / 3D** (każda kombinacja). Rozgrywka jest ta sama w każdym wariancie: kamera z góry, sterowanie,
kadłuby, kolizje, HP i trafienia liczone jak dotąd ze sprite'a. Różni się tylko obraz. Wybór zapamiętany
(`localStorage`: `sc_ships3d`, `sc_weapons3d`), działa od razu — także w trakcie gry (konsola:
`setVisualMode(statki3D, bronie3D)`).

Tło: 2026-09-29/30 powstała pełna gra 3D (lot w 3D, kamery z dema Atlasa, kadłuby 3D na silniku belek) — użytkownikowi
się nie spodobała i jest wycofana (kopia: `Documents/statki-gra3d-kopia-2026-09-30.zip`, baza `d4ec8ba`). Z niej zostały
modele (`src/3d/ships3d/`) i skóra FFD, przepięta na kadłuby 2D.

## Statki 3D

- Które encje: gracz (profil kadłuba — `model3DProfileId`), NPC z profilu sprite'a (`getNpcHullRenderProfileId`),
  moduły megafrachtowca z typu, wraki i odłamy — model rodu (`hull.dmgKey`). Myśliwce zostają sprite'ami. Rejestr modeli:
  `SHIP3D_MODELS` (`src/3d/ships3d/ships/ships3D.js`).
- Skóra sprite'a nie jest rysowana (`hexShips3D` — `setBeamSkinSuppressor`), zamiast niej `syncShipModels3D`
  (`src/3d/ships3d/shipModels3DGame.js`) rysuje model w pozie skóry: korzeń = początek ciała kadłuba, θ = −(kąt + obrót
  sprite'a), środek sprite'a w układzie ciała = `latticeMin + anchorD`, skala sprite'a.
- Model jest **skórą FFD na węzłach kadłuba 2D** (`hullSkin3D.js`): każdy wierzchołek idzie za przesunięciem węzłów
  komórki pod sobą (kratownica ma jedną warstwę — cała wysokość modelu nad węzłem), a fragment znika, gdy przeważają
  martwe węzły. Wgniecenia, kratery, cięcia, rozpad i wraki wyglądają jak na sprite'cie. Bez miejsca w polu (2 mln
  komórek) — bryła sztywna.
- Z gry zostają: dysze MAIN / WARP / SIDE, lampy pozycyjne FG, tarcze, efekty broni i trafień, cień sylwetki (SDF
  sprite'a). Lampy i reflektory samego modelu to kule HDR (jedna geometria instancji na model, miganie w shaderze).
- **Rany na modelu** (`hullSkin3D.js` → `applyHullSkinDamage`): ta sama mapa ran co skóra sprite'a (`HullDamageMap`,
  slot rodu `hull.dmgKey`, `bind` co klatkę w `syncSkin`), czytana po uv skóry z położenia w kratownicy — na całej bryle,
  także na burtach: osmalenie i lej (albedo + `aoNode` + szorstkość — model świeci głównie odbiciem mapy otoczenia, samo
  albedo prawie nie ciemniało), żar ciała czarnego i poświata jonowa w emisji. Brzeg dziury poszarpany tym samym szumem
  co skóra sprite'a, z ciemnym pasem rozdarcia (jak `hullTearFray`).
- **Przekrój w dziurach** (kamery 3D; z góry ścianki stoją bokiem): `syncCutWalls` stawia pionowe prostokąty na krawędziach
  żywa ↔ zniszczona komórka (też na styku kawałków wraku), od dna do pokładu modelu (`heightAt` / `bottomAt`), na aktualnych
  pozycjach węzłów; materiał `makeHullCutMaterial` — ciemna blacha z liniami pokładów i wręgami, osmalenie i żar z mapy ran.
  Przebudowa tylko przy zmianie węzłów (`hull.revision`).
- Brak na modelu: ośrodka pyłu pasa asteroid (`hullVolume`), odbłysku reflektorów innych okrętów, przestrzelin małego kalibru.

## Bronie 3D

- Wieże z `src/3d/ships3d/weapons/weapons3D.js` w miejscach wieżyczek gry: rekordy `Turret2D.recordsFor(encja)` tej
  klatki (pozycja, kurs lufy, odrzut), na modelu (wysokość pokładu z modelu) albo na sprite'cie. Kanwa nie rysuje wieżyczek
  z modelem 3D (`Turret2D.skipDraw`); hangary i Hexlance wieżyczek nie mają.
- LOD jak `Turret2D`: poniżej 2 px na ekranie wieży nie ma.
- **Partie** (`src/3d/ships3d/turretBatch3D.js`, 2026-10-07): jeden rysunek na RODZINĘ broni (`WEAPON3D_FAMILY`, 24
  rodziny) dla wszystkich wież tej rodziny w kadrze — dawniej każda wieża była drzewem siatek (pierścień, obudowa, każda
  lufa, wirnik: 3–6 rysunków po ~15–20 µs CPU w three r183). Geometria rodziny = scalone części z atrybutem `aTurPart`
  (część, przesunięcie kopii lufy), `Mesh` + `InstancedBufferGeometry` z jednym przeplecionym buforem instancji (rekord
  wieży: podstawa względem początku przy kamerze i skala, kurs lufy i kadłuba, pochylenie, odrzut, wirnik, warstwa głębi),
  jeden materiał `TurretBatchNodeMaterial` (materiał broni z pozą części liczoną w etapie wierzchołków — pozycja i
  normalna jak `InstanceNode` three), wysyłka zakresem (`zakresyWysylki.js`). Stan wieży (pochylenie wyrzutni, kąt
  wirnika, wylot dla `turretMuzzleZ`) zostaje w `shipModels3DGame.js` (`TurretState`). Poza części = dawne drzewo
  `Object3D` (lustro CPU `turretVertexCpu`, test `tests/turretBatch3D.test.mjs`); A/B obrazu na zatrzymanej klatce —
  różnice tylko pojedyncze piksele krawędzi świecących pasków. Bitwa 166 okrętów (`.tmp/bronie3d-ab.mjs`): zoom 0,1 —
  dawniej 873 rysunki i 27 fps, teraz +7 rysunków względem broni 2D i fps jak 2D.

## Dysze SIDE 3D (2026-10-07) — w każdym wariancie wyglądu

Prośba użytkownika: „dorobić modele dysz bocznych SIDE … Terra Nova = biel, Atlas, frachtowce = szary — dopasuj
kolorystycznie”, a przy okazji „wykorzystaj WebGPU do nowych efektów dysz SIDE (obecne są mega stare po WebGL)”.

- **Model** (`src/3d/ships3d/thrusters/sideThruster3D.js`): sponson przykręcony do kadłuba (płyta z fazą, pasek
  frakcji, pokrywy, obrotnica — obraca się z kadłubem, wzdłuż wydechu w spoczynku) i obrotowa dysza (platforma, jarzmo
  z czopem, komora z kopułką, kołnierz gardzieli, dzwon z obręczami i jasną wargą, ciemne wnętrze z żarem gardzieli,
  siłowniki) za kierunkiem wydechu — dysza SIDE jest wektorowana (`nozzleDeg` w gimbalu ±90° wokół `baseDeg`).
  Oś obrotu = marker dyszy z edytora, wylot dzwonu `SIDE_NOZZLE_MOUTH` (1,8) × promień wylotu przed nią — tam zaczyna
  się struga. Promień wylotu `SIDE_NOZZLE_RADIUS` (15 j.) × skala klasy kadłuba (jak płomień) × skala sprite'a.
- **Farba** frakcji kadłuba: Terra Nova kremowa biel, Atlas chłodny szary, frachtowce i megafrachtowiec szary cywilny
  z bursztynowym paskiem, piraci rdza z czerwonym pasem (`sideThrusterPaletteFor` z profilu kadłuba; barwy zmierzone
  na sprite'ach). Cztery palety w JEDNYM materiale — `createShipMaterial({ palettes, paletteIndex })`, indeks z
  rekordu instancji (bez `palettes` graf i WGSL materiałów okrętów i wież bez zmian).
- **Rysunek**: jedna partia (`src/3d/ships3d/thrusterBatch3D.js`, wzór partii wież), jeden rysunek na wszystkie dysze
  w kadrze. Pozycje, kąty, ciąg i żar z listy klatki `SideNozzleFrame` (`src/3d/sideNozzleFrame.js`), którą pisze
  `EngineVfxSystem` w pętli płomieni SIDE — maskowanie (próg 0,5), odpadanie z kadłubem (`hullMounts.js`) i zdublowane
  markery (jedna bryła) rozstrzyga tam. `shipModels3DGame.js` (`syncSideNozzles`): kadr, LOD (pół szerokości
  sponsonu ≥ 1,5 px), wysokość i warstwa głębi — na sprite'cie `SLAB_NOZZLE_ON_SPRITE`, na modelu 3D oś dzwonu w
  połowie burty (`SLAB_NOZZLE_ON_MODEL`; skrzynki RCS bryły kadłuba wyłączone — `buildShip3D(id, { rcs: false })`).
  Żar dzwonu (ciemna czerwień przy gardzieli) z żaru strugi.
- **Struga i gaz na WebGPU** (`src/3d/sideJets3D.js`, zamiast `engineExhaustBatch.js`): praca impulsowa jak w
  prawdziwych RCS (PWM ~6 Hz przy niepełnym ciągu, ciągła od 80%), analityczny pióropusz próżniowy w TSL (dysk
  wylotu, rdzeń, stożek z włóknami z szumu płynącymi od wylotu), gaz w pulach GPU efektów broni (opar strugi, kłąb na
  początku impulsu, błysk i iskry przy zimnym zapłonie, obłok po wyłączeniu — compute), światło na blasze w siatce
  świateł; barwa z palety strugi MAIN okrętu. Płomyk dyżurny w wylocie (szybki lot — jaśniej).
- **NPC**: baza kąta dysz SIDE = kąt markera edytora (wydech na zewnątrz burty), jak u gracza — do 2026-10-07 baza
  ±90° kierowała płomienie wzdłuż kadłuba, a w zakresie gimbala także pod kadłub (`npcHardpointRuntime.js`).
- **Frachtowce**: wahadłowiec, kontenerowiec, frachtowiec dalekiego zasięgu, ciężki frachtowiec i lokomotywa
  megafrachtowca — po 4 dysze SIDE w narożnikach kadłuba (szary cywilny). Wpisy edytora `sideOnly`
  (`hardpointEditorDefaults.js`): runtime NPC bierze z nich same dysze SIDE — bez MAIN (ścieżka lotu bez zmian), bez
  gniazd, rdzeni i świateł — dopiero z kadłubem (skala markerów z obrazu kadłuba). Oś dyszy ~0,5 promienia wylotu w głąb
  od krawędzi alfy, sponson poza lukami ładowni i strefą mostka. Wagony i ogon składu oraz furgony ładunku (sprite
  fregaty) — bez dysz. Zrzuty: sceny `fr_*` w `dysze-side-gra.mjs`, test `tests/freighterSideThrusters.test.mjs`.
- **A/B** (konsola): `setSideNozzles3D(false)` — bez modeli (struga wraca na marker), `SideJets3D.enabled = false` —
  dawny płomień SIDE; strojenie `SideJetTune`. Zrzuty: `node scripts/webgpu/dysze-side-gra.mjs [--warianty
  2d,pol,spokoj,3d,ab,stary] [--lot 1]` (pomiar czasu klatki nowe ↔ stare w locie), testy `tests/sideThrusters3D.test.mjs`.

## Kamery 3D (`src/game/game3D.js`, `camera3DRig.js`, `view3D.js`) — sam widok

`K` / `Shift+K` — następna / poprzednia kamera: klasyczna (gra z góry, domyślna), z góry w perspektywie, taktyczna,
pościg, orbita, kinowa; `Home` — ustawienia domyślne; strzałki — obrót kamery (pościg i kino przechodzą w orbitę).
Wybór w `localStorage` (`sc_camera3d`). Rozgrywka zostaje w płaszczyźnie: fizyka, sterowanie, trafienia i AI jak w 2D.

- Core3D `free3d`: wszystkie passy kamerą perspektywy ze wspólną głębią, niebo-sfera (`sky3D.js`), efekty broni
  zwrócone do kamery (`tsl/billboard3D.js`: `billboardOffset`, `streakAcross`), ring i pas asteroid liczone z kamery
  perspektywy (`haloRingGame._copyFreeCamera`, `asteroidBelt._computeView3D`). Planety zostają na starych miejscach
  (tło z paralaksą pod płaszczyzną, planety ringów w płaszczyźnie) — tylko kadr liczony kulą w stożku kamery.
- `worldToScreen` / `screenToWorld` (index.html) rzutują przez `View3D`, gdy kamera jest 3D — HUD i celowanie myszą
  (punkt na płaszczyźnie gry) działają w każdej kamerze.
- W kamerze 3D statki i bronie są ZAWSZE modelami (`setShipModels3DView`; sprite i wieżyczki kanwy leżałyby płasko),
  a model pisze prawdziwą głębię (warstwa ortho wyłączona). LOD wież z rzutu perspektywy.
- **Ostrzał z burt**: błysk wylotu na wysokości lufy wieży 3D (`WeaponFx.muzzleZOf` = `turretMuzzleZ`), pocisk startuje
  z wysokości lufy strzelca (`b.visZ0`) i schodzi do płaszczyzny (τ = 0,25 s — `syncShotVisualHeights`), więc trafia w
  burtę celu. Tylko obraz: lot i trafienia liczy gra w 2D. Wiązki i rakiety — jeszcze na wysokości płaszczyzny.
- Podzielony ekran: zawsze kamera klasyczna.

## Głębia w kamerze ortho (`src/3d/ships3d/modelSlabDepth.js`)

Kamera statków patrzy prosto w dół, więc wysokość bryły nie zmienia obrazu, tylko kolejność głębi. Model rysuje
prawdziwą bryłę (światło, odblaski, maska słońca), ale głębię (`depthNode`) zapisuje ściśniętą do cienkiej warstwy tam,
gdzie w 2D leżała skóra sprite'a — per obiekt `userData.slab = (zb, zt, lo, hi)`:

| Obiekt | Warstwa z | Nad nim | Pod nim |
| --- | --- | --- | --- |
| kadłub | [−10,4; −5,3] | struga MAIN (−5), sprite'y (0), poświata poszycia (2), pociski i efekty (14–15) | skały pasa (≤ ~−11), mgła |
| wieże na modelu | [−4,6; −0,4] | sprite'y, efekty | pokład kadłuba |
| wieże na sprite'ach | [0,05; 1,8] | poświata poszycia, efekty | skóra sprite'a |

Precyzja: `depth24plus`, near 1 / far 400 000 → ~0,024 j. na stopień głębi (~210 stopni na kadłub).

## Narzędzia

- `node scripts/webgpu/modele3d-gra.mjs [--warianty 2d2d,3d3d,3d2d,2d3d] [--kamery chase,orbit,cinema,tactical,top]
  [--fokus cel] [--odleglosc 1.0] [--bez-pauzy] [--env 3,5] [--eval "…"]` — panel „Nowa gra”, mała bitwa z kraterami,
  pauza i wszystkie warianty na tej samej klatce (cała bitwa, Atlas, pancernik z kraterami), kamery 3D (z `--fokus cel` —
  wokół uszkodzonego pancernika), potem ciąg W; `raport.json` z błędami konsoli i liczbą modeli / wież / draw calli.
- Testy: `tests/modele3dGra.test.mjs` (wybór, kratownica skóry, kolejność warstw, wpięcie), partie wież —
  `turretBatch3D` (układ rekordu, scalone rodziny, poza części vs dawne drzewo, WGSL bez GPU), modele — `atlas3dModel`,
  `fleet3dModel`, `auto3dModel`.
