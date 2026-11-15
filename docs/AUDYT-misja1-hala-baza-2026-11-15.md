# Wydajność misji 1: hala K-7, wylot, baza piratów (2026-11-15)

Zgłoszenie użytkownika (PerfHUD, 5120 × 1440, preset Ultra, render 125 %, bez limitu klatek, tryb worker):

1. start gry w hali K-7 — ~120 kl/s i duża kolejka GPU (59 ms),
2. po wylocie z hali gra laguje „jakby coś wczytywała”, po chwili drugi freeze,
3. po wylocie z hali skok kl/s,
4. przy bazie piratów 50–120 kl/s, „było 200”; doszły zasięgi radaru i „silnik fizyki 3D”.

Narzędzie: `node scripts/webgpu/misja1-trasa-gra.mjs [--etap hala|baza|oba] [--ab 1] [--profil 1]` — kampania jak
u gracza (samouczek, intro, ODDOKOWANIE, W przez bramę G-01), sonda GPU workera (`sondaGpuWorkera.mjs`), dziennik
klatek strony (rAF) i workera (przerwy między renderami z pipeline'ami, nowymi zasobami i wysyłkami tej klatki),
profile CPU strony i workera przez wylot, A/B w pauzie (każdy korzeń sceny workera i każdy krok `Core3D.fx` po kolei).
Warunki: headless w takcie monitora (240 Hz), `grafika=ultra`, 5120 × 1440, render w workerze. Na tej samej karcie
aplikacja ChatGPT (Codex) stale brała ~20–26 % silnika 3D (liczniki `\GPU Engine(*engtype_3D)`), u gracza też.
Przebiegi: `.tmp/misja1-trasa/run2` (przed poprawką, pełny), `run3-po` (hala i wylot po poprawce), `run4-baza-po`.

## 1. Hala K-7 — karta ~7,4 ms na klatkę

Okno `dok` (Atlas w stanowisku C-01): obraz 115 /s, karta 99 %, GPU render 7,47 ms + compute 0,57 ms, kolejka GPU
śr. 76 ms (gracz: 59 ms). Passy: gry (ortho) 3,0, tła 2,7, maska słońca 1,1–1,5, post 0,17, FG 0,12; compute: bloom
0,45, symulacja pyłu hali 0,12.

A/B w pauzie (Δ GPU render przy zdjęciu rzeczy; okna bazowe 7,35–7,56 ms, szum ±0,3 ms):

| rzecz | Δ render | gdzie |
|---|---|---|
| warstwy pyłu hali (`HallDust`: `HallDustBack` + `HallDustFront`) | −2,35 ms | pass gry 3,0 → 0,46 ms |
| ring Ziemi z halą K-7 (`HaloRing`) | −2,24 ms | pass tła 2,86 → 0,40 ms |
| kadłub Atlasa (`hullSkinBatch`, z lampami pokładowymi) | −0,22 ms | |
| niebo i gwiazdy (trzy korzenie) | −0,55 ms | |
| obudowa reaktora, cień i okna mostka | −0,44 ms | |

Pył hali: dwie płaskie siatki na całą domenę hali (`gasFieldLayer.js`) — każdy piksel hali przechodzi listę świateł
komórki siatki świateł (`grid.loop`) CZTERY razy: raz w warstwie przedniej, trzy w tylnej (światło + dwie wysokości
mgiełki snopów). Hala wrzuca do siatki 8 lamp (zasięg 2,5–2,7 km), 8 reflektorów (3,6–4,6 km) i do 193 migających
soczewek — każda komórka hali ma co najmniej kilkanaście świateł. Przy Ultra to ~11,5 Mpx (6400 × 1800). Dawny pomiar
warstw (~0,04 ms, reguła `pyl-hal-k7`) był przy 1600 × 900 i przed reflektorami podejścia.

„Duża kolejka” to zaległość karty zajętej w 99 % (wiek obrazu pacera + kompozytor × czas klatki GPU), nie osobny błąd
(jak `AUDYT-wydajnosc-baza-gpu-2026-10-28.md` § 9.1). Po wylocie z hali karta liczy 2,9–3,9 ms — stąd „boost”.

Pamięć karty (nvidia-smi, cała karta): w hali ~10,8–11,0 GB przy ~2–3 GB innych programów (po poprawce z § 3 — 11,8 GB:
woksele gotowe wcześniej). Pierwszy przebieg BEZ taktu (headless bez limitu klatek) brał ~10,6 GB samej przeglądarki i
kolejkę ~0,8 s — sztuczna zaległość; dlatego narzędzie domyślnie idzie w takcie (`--takt 1`).

## 2. Wylot z hali — dwa przestoje obrazu (przed poprawką)

Misja tworzy bazę piratów w chwili wylotu (faza `course`, `StoryGame._spawnSite`: budowle, teren skały, 48 okrętów —
9 fregat PD, 17 niszczycieli, 9 fregat laserowych, 10 pancerników, 3 supercapitale). Na stronie to 12,6 ms
(`spawnPirateBase` 7,4 ms, 48 × `spawnShip` łącznie 3 ms); kadłuby na belkach powstają leniwie z budżetem 6 ms na
klatkę, ale pierwsza budowa każdego typu czyta sprite (`getImageData` ~50–60 ms łącznie) i strona wysyła nowe obrazy
do workera (`createImageBitmap` ~45 ms) — kilka klatek po 40–50 ms.

Worker (render.worker.js) dostawał wtedy zdarzenia `attach` i `bodies`:

- **przerwa 623 ms** zaraz po wylocie: `attachWorldBodies` → `prebuildPirateBaseBodies` — kratownice 52 kawałków bazy
  (`pirateBaseSolidOf` 369 ms: wokselizacja brył wieży i dysku, `buildBeamStructure`; rastry płaskich kawałków
  `structureFor` 151 ms) jednym zadaniem; strona liczy te same kratownice na ekranie ładowania, worker nie;
- **przerwy 325 + 203 ms ~5 s później**: budowa wokseli przy attach (`wGrze.zbuduj`) — 468 MB nowych buforów i tekstur,
  27 pipeline'ów compute utworzonych synchronicznie w JEDNYM zadaniu (`for … await renderer.computeAsync(k)` — po init
  kończy się mikrozadaniem, więc pętla nie oddaje wątku), 29 modułów shaderów; worker potem stoi bezczynnie, a strona
  czeka na kompozytor — proces GPU kompiluje shadery.

Profil workera przez wylot: ciągi pracy > 40 ms — 581, 201, 61, 50, 42 ms.

## 3. Poprawka (bez zmiany obrazu)

- Strona podaje workerowi w obu przygotowaniach sceny flagę `{ pirateBase: storyCampaign }` (`index.html`,
  `rwHost.prepare` — nowy szósty argument w `renderWorkerHost.js`).
- Worker w pierwszym przygotowaniu (pod kurtyną ładowania) robi `startPirateBasePrep`: moduły bazy, bryła
  (`pirateBasePrebuilt` — ta sama, którą weźmie attach), kratownice kawałków (pamięć po układzie bazy) i budowa
  wokseli w tle (`preparePirateBaseVoxels` → `wGrze.przygotuj()`); przygotowanie po klatce zero czeka na woksele
  najwyżej 6 s.
- `wGrze.start()` bierze tę samą obietnicę budowy; pierwszy start nie wczytuje węzłów drugi raz (`swieze`).
- Kernele rozgrzewki wokseli (`solver.rozgrzej`, `obraz.rozgrzejKernele`) po jednym na zadanie (`setTimeout` 0).

Wynik (`run3-po`, ta sama trasa):

| | przed | po |
|---|---|---|
| najdłuższa przerwa obrazu workera przy wylocie | 623 ms | 59 ms |
| przestój ~5 s po wylocie | 325 + 203 ms | brak (maks. 10 ms) |
| ciągi pracy workera > 40 ms przez wylot | 5 | 0 |
| start kampanii (klik → gra) | 23,3 s | 23,5 s |
| woksele | budowa po wylocie | gotowe pod kurtyną (7,9 s w tle, ~10 s przed grą) |
| GPU w hali (dok) | 7,47 + 0,57 ms | 7,36 + 0,57 ms |

Kratownice pod kurtyną: 0,5–0,9 s (worker przygotowuje wtedy też ringi). Skok `?story=shipyard`: woksele gotowe od
razu (dawniej 5,7 s po starcie fazy), koszt GPU bazy bez zmian. Pipeline'y synchroniczne 0, błędy 0. Testy:
`szewRenderu`, `pirateBase*`, `rozgrzewka*`, `shaderPrewarm`, `woksele*Wgsl`, `wokseleLiny`, `wokseleBaza`,
`worldBodies3D` — zielone.

Zostaje na stronie: pierwsze kadłuby piratów przy wylocie (kilka klatek po ~45 ms: `getImageData` sprite'ów i wysyłka
obrazów do workera) — kandydat: w kampanii przygotować struktury kadłubów i bitmapy pięciu typów okrętów bazy pod
kurtyną.

## 4. Baza piratów — karta ~4,7 ms na klatkę (bez walki)

Skok `?story=shipyard`, Atlas 3,5 km od habitatu, mgła wojny wyłączona, kamera statku. Zoom 0,04 (jak u gracza):
obraz 172 /s, GPU 4,67 + 0,42 ms (tło 2,0, maska słońca 1,45, FG 0,81, post 0,19); zoom 0,14: 144 /s, GPU 5,75 +
0,56 ms (tło 2,35, maska słońca 2,05, FG 0,86).

A/B w pauzie przy zoomie 0,04 (okna bazowe 4,56–4,67 ms):

| rzecz | Δ render |
|---|---|
| woksele bazy — cały korzeń `Woksele bazy` | −2,96 ms (tło 1,9 → 0,5, FG 0,8 → 0, maska słońca −0,4) |
| woksele — same siatki `Wok*` | −1,51 ms (tło 1,9 → 0,78, FG → 0) |
| planetoida (`PirateRock`) | −0,26 ms |
| czujniki: krok `fx:czujniki` / tafla granicy | −0,18 / −0,12 ms |
| czujniki wył. (strona, `Czujka.input.off`) | +0,04 ms (szum) |

Woksele (124 tys. węzłów, dwa rysunki — tło i FG — każdy przez WSZYSTKIE instancje, węzeł z drugiej strony przekroju
zwija się w wierzchołku) kosztują 1,5–3 ms, prawie niezależnie od zoomu (0,04 ↔ 0,14: tło i FG ±0,3 ms, choć baza na
ekranie jest dużo większa) — koszt idzie z wierzchołków i instancji, nie z pikseli. Zasięgi radaru (czujniki) — ~0,1–0,2
ms, nie one obniżyły kl/s. Maska słońca 1,1–2,1 ms przy Ultra w każdym miejscu (pełna rozdzielczość, marsz SDF kadłubów).
U gracza w walce (39 NPC, wraki, tarcze, efekty) dochodzi reszta sceny — GPU 7,8 + 2,3 ms na zrzucie zgłoszenia.

## 5. Co zostaje (decyzje użytkownika)

1. Render 125 % (Ultra = nadpróbkowanie) — 1,56 × pikseli względem 100 %; największa pojedyncza dźwignia (pył, ring,
   maska słońca, bloom skalują się z pikselami).
2. Pył hali bez zmiany obrazu: trzy pętle świateł warstwy tylnej w jednej (ta sama lista komórki, trzy wysokości) —
   mniej odczytów bufora świateł; ze zmianą obrazu: warstwy w połowie rozdzielczości.
3. Maska słońca w połowie rozdzielczości (miększe brzegi cieni).
4. Woksele: osobne listy węzłów dla passa tła i FG (połowa pracy wierzchołków) albo LOD przy dalekim zoomie.
5. Kadłuby piratów przy wylocie — przygotowanie pod kurtyną (§ 3).
6. Aplikacja ChatGPT zabiera ~25 % silnika 3D karty — gra jest ograniczona przez kartę.
