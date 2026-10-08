# Audyt wydajności — wielkie bitwy flot (2026-10-07)

Piraci vs Terra Nova, dwa składy na stronę:

- **V1**: 50 fregat, 20 niszczycieli, 10 pancerników, 3 supercapitale (83 na stronę, 166 okrętów),
- **V2**: 30 fregat, 30 niszczycieli, 20 pancerników, 5 supercapitali (85 na stronę, 170 okrętów).

Plus przebiegi kontrolne: V1 bez supercapitali, V1 z `?physHz=60`, V2 przy domyślnym zoomie gry.

## 1. Metoda

- Prawdziwa gra na tej maszynie: Vite + headless Chrome z GPU (WebGPU, D3D12), 1920 × 1080, rAF bez limitu.
  Swobodna gra (kampania zamraża świat w scenach), statek gracza przeniesiony między orbity Wenus i Ziemi
  (936 tys. j. od najbliższej planety / stacji — bez ringu i pasa asteroid), gracz nieśmiertelny (dolewka
  kadłuba i tarczy), `--seed 7`. Zoom 0,1 (cała bitwa w kadrze — najgorszy przypadek dla renderu), jeden
  przebieg przy zoomie 0,45 (domyślny zoom statku: kadr ~4 km).
- Narzędzie: `node scripts/profil-bitwy-flot.mjs --sklad 50,20,10,3` (nowe; opis w nagłówku pliku):
  próbki PerfHUD co 3 s, profile CPU (Profiler CDP) w zadanych chwilach, `--diag 1` — pary narrowphase
  silnika belek, wywołania WebGPU na klatkę, obiekty renderu three, tryb słownikowy i mapy V8 obiektów gry.
- Liczby bezwzględne z PerfHUD (bez profilera). Profil CPU kosztuje ~20% klatki i przy wklejaniu funkcji
  przez V8 bywa, że przypisuje czas złej nazwie — rozkłady podaję na poziomie podsystemów.
- Bitwa jest chaotyczna mimo ziarna (czas rzeczywisty): dwa przebiegi tego samego składu różnią się w fazie
  walki nawet o 40% fps. Wnioski opierają się na kilku przebiegach i na kosztach na krok / na klatkę, nie na
  pojedynczej liczbie fps.

## 2. Wyniki

fps średnio (w nawiasie minimum próbki 3 s). Zoom 0,1, fizyka 120 Hz, o ile nie zaznaczono.

| Przebieg | Szczyt (t 5–15 s) | Walka | Końcówka (wraki) | Po bitwie |
|---|---|---|---|---|
| V1 50/20/10/3 (2 przebiegi) | 60–67 (42) | 40–64 (34) | 59 (47) | 111 |
| V2 30/30/20/5 (2 przebiegi) | 51–63 (44) | 54–66 (27) | 45–55 (33) | 68–123 |
| V1 **bez supercapitali** 50/20/10/0 | 90 (76) | 73 (53) | 73 | 126 |
| V1 **`?physHz=60`** | 83 (79) | 70 (53) | 79 (64) | 103 |
| V2 **zoom 0,45** | 201 (179) | 171 (92) | — | — |

Drugi przebieg V1 i V2 to przebieg diagnostyczny (`--diag 1`, opakowania kosztują ~0,1–0,3 ms) — inna
realizacja tej samej bitwy. Pojawienie się flot (pierwsze 3 s): 29–36 fps, p95 79–92 ms (przy zoomie 0,45:
151 fps, p95 16 ms).

Faza walki w liczbach (V1, przebieg A, 40 fps): klatka 25,3 ms = **fizyka 14,1** (4,38 ms/krok × 3,2 kroku)
+ **render i reszta 11,2** (rysowanie 10,3: U hex 4,7, Core3D 3,7). GPU 1,6 ms, 45 draw calli,
~3 mln trójkątów. **GPU się nudzi — całość ogranicza jeden wątek CPU.**

## 3. Model klatki

Krok fizyki jest stały (1/120 s), więc fizyka to podatek **120 × koszt kroku** na sekundę, niezależnie od fps.
Przy 4,4 ms/krok to 526 ms/s — **53% wątku głównego, zanim narysuje się choć jedna klatka**. Reszta sekundy
dzieli się na klatki po D ms (render, UI, efekty). Punkt stały: `T = D / (1 − 0,12 · S)` (S — ms na krok,
T, D — ms na klatkę). V1 walka: S = 4,38, D = 11,2 → T = 23,6 ms (zmierzone 25,3 z ogonem).

Pochodne w tym punkcie: **1 ms zaoszczędzona w kroku = ~5,4 ms na klatce**, 1 ms per klatkę = ~2,1 ms.
Każdy koszt „na krok” jest więc ~2,5× ważniejszy od kosztu „na klatkę”.

`?physHz=60` (gotowe, czeka na A/B rozgrywki od 2026-09-24): krok drożeje do ~5,8 ms (każdy krok niesie
1/3 mózgów AI zamiast 1/6), ale kroków jest o połowę mniej — fizyka spada z 432–526 do ~350 ms/s,
walka V1: 70 fps zamiast 40–64. Wtedy render staje się większą częścią klatki (58%).

## 4. Fizyka — gdzie idzie krok

Profil szczytu (V2, t = 8–14 s, 3,8 ms/krok pod profilerem; V1 wygląda tak samo):

| Część | ms/krok | Udział | Uwagi |
|---|---|---|---|
| Mózgi AI (20 Hz, fazowane, ~28 wywołań/krok) | 1,36 | 36% | ~50 µs na wywołanie; niżej rozbicie |
| Lot NPC (`stepShipFlight`) | 0,29 | 8% | w tym stan dysz do VFX (30 Hz) ~0,1 |
| Silnik belek (`HullBodies.step`) | 0,60 | 16% | w fazie wraków 1,0–1,7 (pkt 5.5) |
| Pociski i trafienia | 0,29 | 8% | promienie tarcz co krok, dźwięk trafienia w tarczę |
| PD gracza (`ciwsStep`) | 0,22 | 6% | pkt 5.4 |
| Integralność gniazd | 0,19 | 5% | pkt 5.4 |
| Kolizje z ringiem (żadnego ringu w pobliżu) | 0,12 | 3% | pkt 5.4 |
| Kierowanie ogniem gracza | 0,11 | 3% | |
| Ekonomia stacji / infrastruktura, rdzenie, czujniki | 0,16 | 4% | logika gospodarki co krok 120 Hz |
| reszta (`physicsStep` własny, budzenie wraków…) | ~0,45 | 12% | |

Mózg (V1, na krok, ~1,5 ms): `commitCapitalFlight` 0,92 — z czego **unik ruchu `computeTrafficAvoidance` 0,46**
(razem z zapytaniem siatki), **separacja `applySeparationForces` 0,30** (m.in. promienie tarcz par liczone
łańcuchem funkcji, `HullBodies.hasContact`, wrogość par), reszta 0,16; wybór celów broni
(`processAutonomousWeapons`) 0,29; szyk (`steerWithFormation`) 0,25.

## 5. Wąskie gardła (ranking wg zysku)

### 5.1 Supercapitale są nieproporcjonalnie drogie

Kontrola V1 bez supercapitali: **6 supercapitali (3,6% floty) obniża fps o ~40–45%** — szczyt 90 → 60–67,
walka 73 → 40–64. Wnoszą +60% węzłów kadłubów (27,9 → 44,6 tys.) i +153 działa (w tym 27 specjalnych).
Różnica profili: fizyka **+0,94 ms/krok** (pętla PD gracza po wszystkich NPC z wrogością frakcji +0,21, sondy
integralności 56 gniazd na okręt +0,15, mózgi +0,35, silnik belek +0,19, pociski +0,12), render
**+1,8–3,4 ms/klatkę** (U hex +0,9 — dysze, światła kadłubów; Core3D +0,7 — głównie wysyłki atrybutów
i wiązań three). To nie jedna usterka — supercapital
mnoży koszty z punktów niżej, więc ich naprawa najmocniej odczuwa się w bitwach z supercapitalami.

### 5.2 AI: unik ruchu przegląda całą flotę (−0,3…−0,5 ms/krok)

`computeTrafficAvoidance` (`src/ai/capitalAI.js:59`) pyta siatkę AI o promień do `AVOID_RANGE_MAX` = 6 km
(`:57`). Siatka ma komórki 600 j. (`src/ai/aiSpatialGrid.js:13`), a zapytanie szersze niż 16 komórek
(`:113`) zwraca **wszystkie** byty — każdy mózg iteruje ~170 sąsiadów, ~80 ns na sąsiada. Ten koszt to w dużej
mierze odczyty pól: **~150 NPC ma 63–71 różnych klas ukrytych V8** (po ~117 pól, dopisywanych w różnej
kolejności), więc każde miejsce czytające `o.x`, `o.vx`, `o.radius` jest megamorficzne.
Naprawa: migawka sąsiadów w tablicach typowanych (x, y, vx, vy, r, m) budowana raz na takt AI w
`rebuildAIGrid` + druga, gruba siatka dla dużych promieni zamiast „całej listy”; ewentualnie K najbliższych
po czasie zbliżenia. Obok niej separacja (`applySeparationForces`, 0,30 ms/krok, zapytanie 900 j.) liczy dla
każdej pary promienie tarcz łańcuchem funkcji (`shieldPairStandoff`, `index.html:3143`, z domknięciem na
wywołanie) — promień tarczy z migawki tego samego taktu.

### 5.3 `?physHz=60` — największa pojedyncza dźwignia, decyzja rozgrywki

Patrz pkt 3. Zmierzone w tej bitwie: fizyka ~350 zamiast 432–526 ms/s, walka V1 70 fps. Koszt: wierność
taranu i zgniotu (stare pomiary z 2026-09-24: taran 400 j/s — 95,0% vs 90,7% zniszczenia celu).

### 5.4 Rzeczy niefizyczne liczone w każdym kroku 120 Hz (−0,5…−0,7 ms/krok razem)

- **PD gracza** (`ciwsStep`, `index.html:19784`): dla KAŻDEGO działka PD w każdym kroku pętla po wszystkich NPC
  (`:19839`, `:19849`) z `isHostileNpc` (frakcje) i `isFighterNPC` (`:20153` — `String(type).toLowerCase()`
  na każde porównanie; podobnie `isFlakWeapon`, `src/game/flakSystem.js:62`). W tej bitwie **nie ma ani jednego
  myśliwca** — cała pętla jest pusta pracą. Naprawa: lista wrogich myśliwców (i kadłubów przy PD CHIP)
  raz na krok, jak już jest bufor rakiet. ~0,2 ms/krok, więcej przy większej liczbie działek PD.
- **Kolizje z ringiem** (`stepShipRingCollisions`, `index.html:24356`): każdy NPC co krok kopiowany do bryły
  kolizji i sprawdzany z 3 ringami, także 900 tys. j. od najbliższego. Bramka odległości od ringów. ~0,12–0,15.
- **Integralność gniazd** (`updateEntityHardpointIntegrity`, `index.html:4866`): co 0,08 s na okręt sonduje
  wszystkie gniazda (do 5 sond `HullBodies.probe` każde), także w nietkniętym kadłubie. Bramka wersji struktury
  (zmiana `activeNodes` / `liveBeams` ciała). ~0,1–0,18.
- **Gospodarka w kroku**: `InfrastructureUI.update`, `updateStationEconomies`, `updateCargoFleet`
  (`index.html:22547–22554`) co krok 120 Hz — do logiki klatki albo niższej częstotliwości. ~0,06.
- **Dźwięk trafienia w tarczę** (`index.html:21185`): każde trafienie na mapie tworzy `BufferSource` + `Gain`,
  bez limitu głosów i bez odległości. ~0,05 + wątek audio + kakofonia. Limit głosów / tylko w kadrze.
- **Promienie tarcz** (`stampBulletCollisionRadii` `index.html:20700`, `shieldPairStandoff` `:3143`): łańcuch
  `getEntityShieldBaseRadius` → profil → `getEntityShieldBlockingProgress` dla każdej encji co krok i dla każdej
  pary w separacji. Cache raz na klatkę. ~0,05–0,1.

### 5.5 Silnik belek: narrowphase nie patrzy, ile się nakłada (faza wraków −0,4…−1,0 ms/krok)

`--diag 1`, V2: w walce narrowphase jest tania (0,15–0,3 ms/krok), ale **76–97% par, które do niej dochodzą,
w ogóle się nie dotyka**. W fazie wraków: **wrak × wrak** 8–38 par/krok z kontaktem w 1–18%, 250–950 węzłów
na parę; dwa pirackie supercapitale lecące obok siebie: 2,1 tys. węzłów skanowanych na parę na krok, 0% kontaktu.
Narrowphase 1,0–1,5 ms/krok, „kolizje” w HUD 2,9–7,5 ms/klatkę, fps 27–45.

- `collideBodies` (`src/game/destructorBeams3D.js:1160`) iteruje **wszystkie** węzły mniejszego ciała
  (`:1199`), dla każdego `matVec` + `matVecT`, choć pudła nachodzą zwykle rogiem. Naprawa: pudło drugiego ciała
  przenieść do układu lokalnego iterowanego i chodzić tylko po jego kubełkach hasza w tym obszarze (albo tani
  test w układzie lokalnym przed obrotem).
- `_refreshHash` (`:479`) przebudowuje lokalny hasz węzłów ciała co krok, w którym jest gospodarzem pary — także
  uśpionego wraku, którego kształt się nie zmienia. Naprawa: znacznik zmiany kształtu.
- `pairFilter` (`src/game/hullBodies.js:1468`) wyłącza tylko pary dwóch „zimnych” wraków (`isColdWreck`
  `:1459`); świeże, dryfujące wraki po wybuchach mielą się pełną narrowphase. Naprawa: wrak × wrak rzadziej
  (np. co 4. krok) albo próg prędkości względnej.

### 5.6 Render CPU (−1…−1,5 ms/klatkę przy pełnym kadrze)

Szczyt V1 (7,9 ms/klatkę pod profilerem):

| Część | ms/klatkę |
|---|---|
| `updateHexShips3D` | 3,0 — dysze 1,2 (hasz slotów FNV liczony co klatkę na okręt `engineVfxSystem.js:340/764`), światła kadłubów 0,5 + emitery 0,4, wieżyczki 0,22, WeaponFx 0,17 |
| Core3D | 2,9 — pass sceny 1,4, klatka efektów GPU 0,9, post 0,18, maska słońca 0,12 |
| 2D / UI | ~1,2 — `bridge3D.update` 0,3, znaczniki kontaktów 0,26, tarcze 0,2, sylwetka okrętu 0,2 (co klatkę), wieżyczki 2D 0,11, celownik 0,1, etykiety planet 0,09 (900 tys. j. od planet) |
| natywne | `(program)` ~1,1, `writeBuffer` 0,65–1,25, `submit` 0,19 |

WebGPU (`--diag`): **200–280 `writeBuffer` i ~22 `submit` na klatkę**, 0,7–2,5 MB/klatkę (rośnie w fazie
wraków). Klatka efektów to głównie stały koszt osobnych `renderer.compute` (dym rakiet ×3, tarcze, spawn i update
broni) — każde z własnym `submit`. AGENTS.md już zaleca jedną listę kerneli na klatkę.

Przy zoomie 0,45 render spada z 7,8 do 3,0 ms (dysze 1,2 → 0,2, światła kadłubów 0,57 → 0,01, wysyłki three
0,7 → 0,05, efekty 0,94 → 0,3) — odcinanie poza kadrem działa; koszt renderu to koszt **widocznych** okrętów.
Obiekty renderu three nie są przebudowywane co klatkę (`--diag`: 0 na klatkę; skoki `getAttributes` w profilach
to jednorazowe tworzenie przy pierwszych efektach — pierwsze wybuchy reaktorów, nowe partie skór).

### 5.7 Skok przy pojawieniu się floty

Pierwsze 3–5 s po pojawieniu się 166–170 okrętów: 29–36 fps, p95 80–92 ms, 3,3–3,9 kroku na klatkę. Pierwsze
decyzje mózgów są droższe (~67 µs zamiast ~50), do tego budowa kadłubów (budżet 6 ms/klatkę), wypiek map
powierzchni i cieni SDF, pierwsze efekty. Przy zoomie 0,45 skoku prawie nie ma (151 fps) — to głównie wizualia
widocznych okrętów. W grze wezwania przylatują warpem rozłożone w czasie, ale fale fabuły (odwet) przychodzą
grupami.

### 5.8 Kształty obiektów V8 (długofalowo)

- NPC: ~117–122 pola, **63–71 klas ukrytych na ~150 obiektów** — wszystkie pętle po NPC (AI, pociski, render)
  czytają pola megamorficznie. Naprawa systemowa: komplet gorących pól w `makeNPCBase` w stałej kolejności,
  bez dopisywania `npc.__x` w biegu. Zysk trudny do oszacowania (rząd 5–15% kodu dotykającego NPC).
- Ciała silnika belek **pirackich fregat** (i tylko ich, 23–50 szt.) są w trybie słownikowym, choć klucze i ich
  kolejność są identyczne jak w szybkich ciałach — przyczyna nieustalona (podejrzenie: `delete` / redefinicja
  właściwości gdzieś na ścieżce pirackiej fregaty). Wpływ mały (gorące pętle silnika wyciągają tablice do zmiennych).

## 6. Szacunek łączny

V1 walka (40 fps, S = 4,4, D = 11,2): punkty 5.2 + 5.4 (−1,0…−1,2 ms/krok) i 5.6 (−1,5 ms/klatkę) dają z modelu
S ≈ 3,2, D ≈ 9,7 → **~60–65 fps** bez zmiany kroku 120 Hz; z `?physHz=60` dodatkowo ~75+. Faza wraków V2
(45–55 fps) zyskuje głównie z 5.5. Liczby z modelu — każda naprawa do potwierdzenia A/B tym samym narzędziem
(kilka przebiegów na przemian, bo bitwa jest chaotyczna).

## 7. Pułapka narzędzia

`spawnCallInShip` z kapitałem (supercapital, piracki supercapital, lotniskowiec) czyta pozycję z `opts.pos`
(`resolveCapitalSpawnPos`, `index.html:7949`), a okręty wsparcia z `opts.spawnPos`. Bez `pos` wszystkie kapitały
lądują 1 AU przed dziobem gracza **w jednym punkcie** (10 supercapitali w stosie: 45 par/krok, 16 tys. kontaktów,
6,5 ms/krok samej narrowphase). Gra jest w porządku — tryb LINIE i Rezerwa podają oba pola — ale skrypt podający
tylko `spawnPos` mierzy co innego. `profil-bitwy-flot.mjs` podaje oba.

## 8. Workery (pytanie z 2026-10-07)

- **Stan**: bitwa jest w 100% na wątku głównym. W workerach działają tylko zadania poboczne: wypiek map
  powierzchni kadłubów (`src/3d/hullSurface.js`), olbrzymie asteroidy (`src/game/asteroidGiantBuilder.js`),
  ruch v2 pod `?trafficV2`. Rusztowanie `src/physics/` (worker fizyki i AI, `PhysicsKernel` / `AiKernel` / `hexArena`,
  pierścienie SPSC i potrójne bufory na `SharedArrayBuffer`) powstało pod stary silnik heksów i nic go nie zasila
  (także pod `?workerPhysicsV2` — tylko `step` bez ciał). `SharedArrayBuffer` i `Atomics` są dostępne: izolacja
  cross-origin włączona w `vite.config.js` i `electron/main.js`.
- **Przeszkody**: symulacja to obiekty JS (NPC ~117 pól, `bullets`, wywołania zwrotne), a pętla pocisków co krok
  synchronicznie pyta silnik belek (`HullBodies.sweep` / `impact` / `probe`). Wątek główny nie może czekać
  (`Atomics.wait` zabronione), a `postMessage` 120 razy na sekundę jest za wolne — zostaje układ potokowy
  z opóźnieniem taktu.
- **Sufit**: nawet cała fizyka poza wątkiem głównym przy widoku całej bitwy (zoom 0,1) zostawia render i UI
  ~11 ms/klatkę → ~90 fps. Przy zoomie 0,45 render ~3 ms → ~290 fps.
- **Kolejność**: (1) poprawki jednowątkowe z § 5 i decyzja `?physHz=60`; (2) pierwszy worker — kernele
  sąsiedztwa AI (unik + separacja, 0,76 ms/krok) na migawce w tablicach typowanych: 20 Hz, opóźnienie taktu nic
  nie zmienia (~42 → ~50 fps w modelu V1); (3) silnik belek na własność workera (wspólne magazyny węzłów,
  trafienia jako rozkazy, wraki jako zdarzenia) dopiero po pomiarze fazy wraków po krokach 1–2 — duży refaktor;
  (4) renderu (OffscreenCanvas + WebGPU w workerze) nie przenosić — wymagałoby przepisania całej warstwy 3D.
