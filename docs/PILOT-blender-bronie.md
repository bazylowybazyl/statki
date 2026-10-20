# Modele broni z Blendera: pilot Yamato i Tempest — 2026-10-13

Pytanie użytkownika: czy Claude w Blenderze zrobi wyraźnie lepsze modele broni niż obecne z `weapons3D.js`?
Pilot na jednej rodzinie: `yamato` (`special_yamato_cannon`). Od 2026-10-13 w grze (sekcja „Integracja w grze”).
Ten sam dzień: Tempest Ion (`tempest1`, `tempest2`) i Lanca (`lance`) (sekcja „Tempest i Lanca”); wszystkie
rodziny w grze z LOD wg oddalenia kamery (sekcja „LOD wg oddalenia kamery”). 2026-10-20: Promień Śmierci „Gungnir”
(sekcja „Promień Śmierci”).

## Jak powstał model

- Blender 5.0.1 w tle (`--background`), skrypt `scripts/blender/yamato.py`: bryły z kodu (bmesh), fazy (Bevel)
  z normalnymi ważonymi powierzchnią (Weighted Normal), wycięcia (Boolean EXACT), AO wypieczone w kolor
  wierzchołków (Cycles, OptiX), eksport GLB (standard glTF, +Y w górę). Budowa ~0,3 s, AO ~1 s, podgląd
  Cycles ~2,5 s na kadr.
- Układ jak w grze (czop, trzy kopie lufy, wylot `muzzleX` = 42 od czopu, części `ring` / `housing` / `barrel`),
  materiały = nazwy wpisów palety (`SHIP3D_MAT` → atrybut `aMat`), AO w `COLOR_0`.
- Wygląd wg sprite'a `assets/weapons/yamato-atlas-v2.png`: płyty pancerza z pasem szewronu na dziobie, grzbiet
  z czterema ogniwami (cyjan na końcach), maszynownia z kratkami i światłami, uszy dalmierza z soczewkami, bębny
  jarzm w otworach lico, żebrowane chłodnice luf, bloki wylotu z hamulcem i świecącym kanałem.
- `--lod 1` — ten sam skrypt bez faz i drobnych detali (lamele, kopułki, obejmy, wycięcia serwisowe).

## Liczby

| model | trójkąty rodziny (pierścień + obudowa + 3 lufy) | GLB |
|---|---|---|
| dziś (`weapons3D.js`) | 1 112 | — |
| Blender LOD0 | 32 194 (2 108 + 9 482 + 3 × 6 868) | 686 KB |
| Blender LOD1 | 5 370 (332 + 1 534 + 3 × 1 168) | 177 KB |

## Wynik (A/B na tym samym kadrze)

- **Zoom gry 1,8 i 0,9** (wieża ~100–250 px, wycinki 1:1): Blender wyraźnie lepszy — fazy, wnęki, płyty
  z jasnymi krawędziami, żebra luf; wieża pasuje do szczegółowości sprite'a kadłuba. Stara: dysk z klockiem
  i trzema świecącymi paskami.
- **Zoom 0,45** (~60 px): obie czytelne; nowa drobniejsza („ziarnista”), stara bardziej „świecąca” — rzecz gustu.
- **Zoom 0,22** (domyślny kadr gry): różnicy praktycznie nie ma.
- **Kamery 3D (K) i galeria dema**: największa różnica na korzyść Blendera.
- **LOD1 przy zoomach gry ≈ LOD0** — 5,4 tys. trójkątów wystarcza poza zbliżeniami 3D.
- **AO z wierzchołków**: subtelne (`aoNode` — tylko światło pośrednie, otoczenie PMREM); w demie od pilota, w grze
  od integracji (atrybut `aAO` partii wież).

Zrzuty (poza repo, `.tmp/blender/`) odtwarzają skrypty:

- `node scripts/webgpu/bronie-blender-gra.mjs` — gra, „Bronie 3D”, wieże Yamato i Yamato L na Atlasie
  (`DevScene.mountSpecial`), warianty stary (`?bronieGlb=`) / Blender / własne listy rodzin, zoomy 0,22–1,8, tryby 2D / 3D kadłuba;
- `node scripts/webgpu/bronie-blender-ab.mjs` — demo `dema/atlas3d-webgpu.html` (galeria, Atlas z góry w skali gry,
  ukos 3D), warianty stary / Blender / bez AO / LOD1;
- `blender … --python scripts/blender/yamato.py -- --render .tmp/blender/yamato` — podgląd Cycles A/B
  (odniesienie: `node scripts/blender/stary-model-obj.mjs`).

Demo: `dema/atlas3d-webgpu.html?bronie=blender` (pole „Yamato z Blendera” w panelu), `&lod=1`, `&ao=0..1`.

## Integracja w grze — zrobione 2026-10-13 (decyzja użytkownika „wpiąć”)

- Loader `src/3d/ships3d/weapons/weaponGlb.js` (`parseWeaponGlb` — GLTFLoader.parse, działa w Node) z rejestrem
  OGÓLNYM: rodzina → `assets/weapons3d/<plik>.glb` (+ `_lod1`; `yamato2` → plik `yamato`). W grze aktywne
  `WEAPON_GLB_GAME` (najpierw `yamato`, `yamato2` na LOD0; od decyzji „LOD z oddalaniem kamery” pięć rodzin w trybie
  AUTO — sekcja niżej); przełącznik A/B bez zmian w kodzie: `?bronieGlb=yamato@auto,tempest2@1` (bez przyrostka —
  LOD0, `@1` — LOD1, `@auto` — wg ekranu; `?bronieGlb=` — żadna rodzina) albo `window.__WEAPON_GLB`. Pliki przeniesione z `dema/atlas3d-webgpu/blender/`
  do `assets/weapons3d/` (skrypt Blendera zapisuje tam domyślnie); demo `?bronie=blender` (Yamato, Yamato L,
  Tempest 1 / 2 — brak pliku = budowniczy) albo `?bronie=tempest1,tempest2@1` czyta je przez ten sam loader.
- `buildWeapon3D(rodzina)` oddaje części z GLB (`WeaponGlbPart`: build / toGeometry / vcount jak MeshBuilder3D,
  `model.source = 'glb'`), układ z `FAMILIES`; `{ builder: true }` — dawny model. Decyzja raz na rodzinę i sesję.
- Wczytanie: od importu `shipModels3DGame.js` (menu), `startGame` czeka (`prepareShipModels3D`, limit 5 s) obok
  dźwięków — przed pierwszą klatką gry i rozgrzewką ekranu ładowania.
- AO: atrybut `aAO` w partii wież (`turretBatch3D.js`; 6 buforów geometrii + 1 instancji) i `aoNode` materiału
  partii; rodziny z budowniczego AO = 1. Wieże dalej w PARTII rodziny (`Mesh` + `InstancedBufferGeometry`,
  jeden rysunek na wszystkie wieże rodziny — nie `THREE.InstancedMesh`, którego uuid wchodzi do klucza programu).
- Yamato L (`yamato2`) = te same części, dwie skrajne kopie lufy (otwór środkowy w obudowie pusty — jak w modelu
  z budowniczego).
- Testy `tests/weaponGlb.test.mjs` (format, paleta, budżet trójkątów, układ — wylot = `muzzleX`, rejestr, partia
  z AO i ten sam klucz geometrii co rodziny z budowniczego); A/B w grze `node scripts/webgpu/bronie-blender-gra.mjs`
  (warianty = listy rodzin w `?bronieGlb=`: `stary` — pusta, `blender` — `--glb` albo rodziny gry,
  `nazwa:a+b@1` — własna; broń spoza special na zaczepy main).
- Otwarte: inne rodziny (skrypty `scripts/blender/<rodzina>.py`, rodziny masowe na LOD1), AO w modelach kadłubów.

## Tempest i Lanca (2026-10-13; w grze od tego samego dnia — LOD AUTO, sekcja niżej)

- Skrypt `scripts/blender/tempest.py` (rodziny `tempest1` — jedna lufa: `railgun_mk1`, `tempest_ion_s` / `l` / `mk1`;
  `tempest2` — dwie lufy: `railgun_mk2`, `tempest_ion_mk2`; `lance` — Lanca: korpus Tempesta, długa lufa, magenta)
  na wspólnych narzędziach `scripts/blender/bryly.py` (wydzielonych z `yamato.py`, który ma jeszcze własną kopię).
  Opcje: `--rodziny`, `--lod 1`, `--plyty BRIGHT|STEEL`, `--render` (A/B w Cycles; odniesienie
  `node scripts/blender/stary-model-obj.mjs --rodzina <rodzina> --out .tmp/blender/ref-<rodzina>`).
- Wygląd wg `tempest-single-atlas-v1.png` / `tempest-twin-atlas-v2.png`: niska kanciasta obudowa ze schodkowymi
  barkami; lufa leży w OTWARTYM OD GÓRY kanale na czopie z łożyskami (od góry widać zamek jak na sprite'cie,
  podniesienie do 70° bez otworu w licu); jarzmo U wokół kanału, płyty pancerza z jasnymi krawędziami, kratki
  i światła rufy, środkowy suwak z żebrami; lufa: zamek z płytą i światłem, kratka, zwężenie, akcelerator z trzema
  (Lanca: czterema) cewkami z żebrami i okienkiem, ciemny rowek z kreskami światła, szyjka, blok wylotu z emiterem.
  Płyty dachu BRIGHT (A/B: przy STEEL wieża ginęła na kadłubie — dużo ciemnych szczelin i kanałów).
- Układ jak `tempest()` w `weapons3D.js`: czop (9; 5,0), lufy y = 0 albo ±5, wylot 25 (Lanca 39) od czopu.

| rodzina | dziś | Blender LOD0 | Blender LOD1 |
|---|---|---|---|
| `tempest1` | 810 | 3 912 | 896 |
| `tempest2` (2 lufy) | 1 220 | 6 388 | 1 432 |
| `lance` | 986 | 4 124 | 936 |

- Wynik (A/B w grze — `bronie-blender-gra.mjs`, w demie — `bronie-blender-ab.mjs --rodzina tempest2`, Cycles):
  Tempest jest MAŁY (rozmiar S–L: ~4 px przy zoomie 0,22, ~70 px przy maksymalnym 3,2), więc z góry zysk jest
  niewielki — przy 1,8–3,2 wieża czytelniejsza i „prawdziwa”, stara bardziej świeci; w kamerach 3D (K), galerii
  i zbliżeniach różnica wyraźna. LOD1 kosztuje ≈ tyle co budowniczy (+10–17%) i przy zoomach gry wygląda prawie
  jak LOD0 — tu zysk daje forma wg sprite'a, nie liczba trójkątów.
- Rodzina MASOWA: Atlas w grze swobodnej ma na main `tempest_ion_l` (tempest1, 15 wież), NPC Terra Nova —
  `railgun_mk2` (tempest2). W grze na LOD1 przy każdym zoomie z góry (tryb AUTO — sekcja „LOD wg oddalenia kamery”).
- A/B w grze przez rejestr (lista rodzin w `?bronieGlb=`): `node scripts/webgpu/bronie-blender-gra.mjs --bronie railgun_mk2
  --glb tempest2 --warianty "stary,blender,lod1:tempest2@1" [--zoomy 0.9,1.8,3.2] [--kamery3d tactical,orbit]`
  (2026-10-13: tempest2 z GLB, 15 wież w jednym rysunku, 0 pipeline'ów synchronicznych, 0 budów w klatce).
  Testy: `tests/weaponGlb.test.mjs` — format, paleta, AO, budżet (LOD1 ≤ budowniczy + 25%), układ (wylot = `muzzleX`,
  obrys obudowy i pierścienia jak budowniczy), rejestr z listą `tempest2@1`.

## LOD wg oddalenia kamery — w grze od 2026-10-13 (decyzja użytkownika „włącz na stałe LOD z oddalaniem kamery”)

- `WEAPON_GLB_GAME` = `yamato`, `yamato2`, `tempest1`, `tempest2`, `lance` w trybie AUTO (`WEAPON_GLB_AUTO`): w pamięci
  oba pliki rodziny (LOD0 i `_lod1`), wieża wybiera LOD co klatkę z promienia sylwetki na ekranie
  rpx = `spec.r` Turret2D × skala rozmiaru (S 0,52 / M 0,76 / L 1,02 / Capital 1,75) × zoom (kamery 3D — zoom
  z perspektywy w miejscu wieży, `zoomAt`).
- Progi z histerezą (`weaponGlbLodFor`): LOD0 od 160 px (`WEAPON_GLB_LOD0_PX`), z powrotem LOD1 poniżej 128 px
  (`WEAPON_GLB_LOD1_PX`), pierwszy wybór przy 144 px — wieża nie miga przy zoomie wokół progu.
- Rysunek: rodzina AUTO ma dwie partie — np. `yamato` (LOD0) i `yamato@1` (LOD1), każda jednym rysunkiem dla
  wszystkich swoich wież; ten sam układ atrybutów, więc ten sam pipeline. Rozgrzewka (wpis „modele 3D statków
  i broni”) robi obie partie każdej rodziny AUTO — geometria LOD0 (Yamato ~47 tys. wierzchołków) liczona
  i wysłana na ekranie ładowania, nie w klatce pierwszego zbliżenia.

| rodzina (rozmiar) | rpx przy zoomie 1 | LOD0 od zoomu | LOD1 poniżej zoomu |
|---|---|---|---|
| `yamato` — Yamato (Capital) | 101,5 | 1,58 | 1,26 |
| `yamato2` — Yamato L (L) | 59,2 | 2,70 | 2,16 |
| `lance` — Lanca L / M | 51 / 38 | 3,14 / — | 2,51 / — |
| `tempest1`, `tempest2` (S / M / L) | 20,8 / 30,4 / 40,8 | — | — |

  „—” = nigdy przy zoomie gry (maks. 3,2). Kamery 3D — te same progi z perspektywy.
- Pomiar w grze (`bronie-blender-gra.mjs`, Atlas): Yamato z góry przy 0,9 — 6 wież w `yamato@1`, przy 1,8 i 3,2 —
  6 w `yamato` (partia `yamato@1` pusta i ukryta); Tempest (`tempest_ion_l` i `railgun_mk2`, po 15 wież) — LOD1 przy
  0,9 / 1,8 / 3,2; kamery 3D (taktyczna, orbita, zoom 3,2) — Yamato 4 wieże w kadrze na LOD0, Tempest 4 na LOD1.
  0 pipeline'ów synchronicznych, 0 budów w klatce, bez błędów konsoli.
- A/B Tempesta LOD0 ↔ LOD1 z góry przy 1,8 / 2,4 / 3,2 (`--warianty "lod0:tempest1+tempest2,lod1:tempest1@1+tempest2@1"`):
  przy maks. 3,2 wieża ma ~60 px długości, różnią się tylko drobne ciemne detale przy zamku — dlatego Tempest zostaje
  na LOD1 przy każdym zoomie gry (LOD0 włączy się sam, gdy wieża urośnie na ekranie powyżej 160 px).
- Build: Vite zabiera pliki z `assets/weapons3d/` (glob z `new URL(…${plik}.glb, import.meta.url)` — sprawdzone
  `vite build`: 8 plików, ~1,7 MB); parsowanie wszystkich ~25 ms (wczytanie w tle od menu).
- Widoczne przy „Bronie 3D” (panel Nowa gra; domyślnie 2D — wieżyczki kanwy) i w kamerach 3D (K), gdzie bronie
  są zawsze modelami.
- A/B: `?bronieGlb=yamato@1,tempest1` (LOD na stałe), `@auto` — AUTO, `?bronieGlb=` — dawne modele;
  `node scripts/webgpu/bronie-blender-gra.mjs --bronie special_yamato_cannon,railgun_mk2 --warianty blender
  --zoomy 0.9,1.8,3.2 --tryby 2d3d --kamery3d tactical,orbit --zoom3d 3.2` (log: wieże w partii LOD0 / LOD1 na kadr).
- Testy: `tests/weaponGlb.test.mjs` („LOD wg oddalenia kamery (tryb AUTO)” — histereza, progi, części na LOD,
  tablice partii), `tests/turretBatch3D.test.mjs` (partia rodziny × LOD w `syncTurrets`).

## Promień Śmierci „Gungnir” (2026-10-20; wygląd zaakceptowany przez użytkownika — „zostaw w rejestrze gry”)

- Zlecenie: wieża superbroni `death_ray` (rodzina `deathRay`) jako wbudowana wieża jednego celu supercapitala Terra Nova
  (Colossus, gniazdo `builtin` na dziobie — gniazdo i AI robi osobna sesja). Skrypt `scripts/blender/deathRay.py`
  (wspólne `bryly.py`: doszła paleta `E_MINT` i `add_loft` — bryła przez kolejne przekroje, zęby zbiegające się ku osi),
  pliki `assets/weapons3d/deathRay.glb` / `deathRay_lod1.glb`, w rejestrze gry `WEAPON_GLB_GAME.deathRay` = AUTO.
- Wygląd wg kadłuba Colossusa (`src/assets/ships/terransupercapital.png`: jasne płyty ze ściętymi rogami, ciemne rowy
  z przewodami, okrągłe włazy w ośmiokątnych blokach): obrotnica r 25 ze śrubami, ośmioboczna obudowa z jarzmem —
  lufa w kanale otwartym od góry i od przodu (od góry widać zamek; podniesienie do 50° bez otworu w licu, wzór
  Tempesta), cztery kapsuły kondensatorów na burtach, rowy policzków z przewodami i miętową żyłką, grzbiet z dwiema
  kratkami i włazem, kratki rufy; lufa: zamek z jasną płytą i czterema miętowymi szczelinami, akcelerator (rura r 3,6)
  z trzema kołnierzami i żebrami cewek nad świecącym paskiem grzbietu, przewody po bokach, stożkowa głowica z jasnym
  pierścieniem, wnęka ze świecącą soczewką (kopułka) i korona czterech zębów po przekątnych (z góry dwa kolce jak
  sylwetka `SPECS.deathRay`) zbiegających się do wylotu.
- Układ bez zmian: czop (16; 7,4), wylot 62 w układzie wieży = `muzzleX` 46 (czubki zębów), pochylenie −5…50°.

| model | trójkąty (pierścień + obudowa + lufa) | GLB |
|---|---|---|
| dziś (`weapons3D.js`) | 1 430 (212 + 410 + 808) | — |
| Blender LOD0 | 12 550 (956 + 6 798 + 4 796) | 583 KB |
| Blender LOD1 | 3 524 (332 + 1 504 + 1 688) | 228 KB |

  LOD1 bez faz, śrub, lamel, przewodów bocznych lufy i włazu; żebra cewek i szczeliny zamka ZOSTAJĄ (z góry to główny
  rysunek lufy — bez nich LOD1 miał gładką rurę z dwoma świecącymi paskami). Wieża jednego okrętu — budżet LOD1 nie
  musi trzymać się „budowniczy + 25%” rodzin masowych (3,5 tys. ≈ 2,5 × budowniczy, limit 6 tys.).
- LOD AUTO: sylwetka r 64 × Capital 1,75 = 112 px przy zoomie 1 → LOD0 od zoomu ~1,43, z powrotem LOD1 poniżej ~1,14
  (zmierzone w grze: 0,35 / 0,9 / 1,4 — `deathRay@1`, 1,8 / 3,2 — `deathRay`; kamery 3D z bliska — prawie wszystkie LOD0).
- Pomiar w grze (`node scripts/webgpu/wieza-promienia-gra.mjs` — Colossus z `DevScene.equipDeathRay`, na tej gałęzi
  promień na 9 gniazdach special; oraz `bronie-blender-gra.mjs --bronie death_ray --zaczep special` na Atlasie): tryb off
  i worker — 0 pipeline'ów synchronicznych, 0 błędów konsoli (poza favicon), partia `deathRay` / `deathRay@1` jednym
  rysunkiem.
- Wynik A/B (użytkownik zaakceptował wygląd 2026-10-20): z góry przy 1,8–3,2 Blender czytelniejszy — obrotnica, cztery kapsuły
  z miętowymi punktami, świecący zamek, żebrowana lufa i korona; stary to dysk z płaskim klockiem i kratką. Przy 0,9
  (LOD1) oba czytelne, nowy drobniejszy. W kamerach 3D największa różnica: stary — kanciasta skrzynka z rurą i świecącą
  głowicą, nowy — bryła z jarzmem, kołnierzami i koroną. Słabości: obudowa ma ciemne, gładkie ściany boczne (z góry nie
  widać, w 3D tak); paleta broni nie ma bieli Colossusa (`BRIGHT` #959eaa to najjaśniejszy materiał), więc wieża jest
  ciemniejsza od kadłuba; zęby korony z bliska wyglądają jak klatka z kanciastych prętów.
- Lekcja (bloom gry): pierwsza wersja miała świecące całe rdzenie kapsuł (tarcze r 2), oba przewody rowów i trzy paski
  akceleratora — w kamerze 3D z bloomem gry wieża zlewała się w zieloną plamę (podgląd Cycles tego nie pokazuje). Teraz
  świeci mało: punkty r 0,75 w ciemnym szkle kapsuł, żyłka na dnie rowu, pasek grzbietu, szczeliny zamka, soczewka,
  żyłki zębów. Oceniaj ilość emisji w grze (kamera 3D), nie w Cyclesie.
- Pułapki harnessów: `bronie-blender-gra.mjs` zostawiał kamerę 3D w preferencjach — drugi wariant (świeża strona)
  startował w kamerze 3D i jego „kadry z góry” były z perspektywy (poprawione: powrót do `classic` po kadrach 3D);
  w drugim wariancie kamery 3D bywa brak tekstury pokładu modelu kadłuba (sprawdzone odwróconą kolejnością — dotyczy
  wariantu, który idzie drugi, także starego modelu; nie GLB). Kadry kamer 3D w trybie worker nie przełączają się
  przez ten harness (tylko off).

## Integracja w grze — plan pilota

1. Loader GLB w `src/` (logika z `dema/atlas3d-webgpu/blenderBronie.js`: nazwa materiału → `aMat`, rzut pudełkowy
   uv jak `MeshBuilder3D`, glTF +Y → Z w górę), rejestr rodzin z GLB, wczytanie przed wpisem rozgrzewki
   „modele 3D statków i broni” (ekran ładowania); bez pliku — budowniczy jak dziś.
2. `buildWeapon3D` oddaje części z GLB w formacie `MeshBuilder3D.build()` — partia wież (`turretBatch3D.js`)
   bez zmian (sprawdzone w grze podmianą w skrypcie: działa, 0 błędów WebGPU).
3. AO w grze: atrybut `aAO` (7. bufor wierzchołków z 8 albo razem z `aMat` jako vec2) + `aoNode`
   w `createTurretBatchMaterial`; rodziny z budowniczego AO = 1.
4. Budżet: rodziny masowe (CIWS, Tempest, flak — setki wież w bitwie) na poziomie LOD1 (≤ ~2–5 tys. trójkątów);
   LOD0 tylko dla wież dużych na ekranie (druga partia rodziny wg rozmiaru na ekranie) albo wcale — zrobione
   2026-10-13 (sekcja „LOD wg oddalenia kamery”).
5. Testy: format loadera, budżet trójkątów na rodzinę, układ (wylot = `muzzleX`, części na miejscu).
6. Każda rodzina: skrypt `scripts/blender/<rodzina>.py` (wspólne pomocniki do wydzielenia z `yamato.py`),
   A/B tymi samymi narzędziami; kierunek wizualny (sprite rodziny, prompt atlasu) — decyzja użytkownika.
